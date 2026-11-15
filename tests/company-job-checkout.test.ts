import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  companyCheckoutBlockReason, companyCheckoutScope, companyPaymentCollectorAllowed,
  createCompanyJobCheckoutController, type CompanyCheckoutState,
} from "../lib/company-job-checkout";
import { JobSyncApiError, type JobSyncCompanyJobCheckout, type JobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";

// Actual controller + billing logic. Every I/O dependency is injected and synthetic.
const session = (): JobSyncNativeSession => ({
  token: "checkout-fixture-token", portal: "company",
  user: { id: 42, role: "owner", name: "Test Owner", email: null, paymentCollectionEnabled: true },
  company: { id: 9, name: "Test Company", slug: "test", logoUrl: null, primaryColor: null, accentColor: null },
});
const detail = (patch: Partial<JobSyncCompanyJobDetail> = {}): JobSyncCompanyJobDetail => ({
  id: 12, companyId: 9, status: "scheduled", amount: 500, paidTotal: 150, refundTotal: 20,
  appliedEstimateCredit: 25, balance: 125.25, paymentStatus: "partial", photos: [], persistedPhotoIds: [], ...patch,
} as JobSyncCompanyJobDetail);
const checkout = (patch: Partial<JobSyncCompanyJobCheckout> = {}): JobSyncCompanyJobCheckout => ({
  url: "https://checkout.stripe.com/c/pay/cs_test_UnitOnly", amountCents: 12525,
  attemptId: 7, attemptStatus: "pending", checkoutState: "open", reused: false, ...patch,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function harness(actor = session()) {
  let isCurrent = true;
  const states: CompanyCheckoutState[] = [];
  const transport = {
    session: vi.fn().mockImplementation(async () => structuredClone(actor)),
    detail: vi.fn().mockImplementation(async () => detail()),
    checkout: vi.fn().mockImplementation(async () => checkout()),
  };
  const onState = vi.fn((state: CompanyCheckoutState) => { states.push(state); });
  const onVerifiedDetail = vi.fn();
  const openBrowser = vi.fn().mockResolvedValue({ type: "cancel" });
  const controller = createCompanyJobCheckoutController({
    session: actor, jobId: 12, isCurrent: () => isCurrent, onState, onVerifiedDetail, openBrowser, transport,
  });
  return { actor, transport, onState, onVerifiedDetail, openBrowser, controller, states,
    last: () => states.at(-1)!, stale: () => { isCurrent = false; } };
}
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden in controller tests"))); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Company hosted checkout permissions and canonical eligibility", () => {
  it("authorizes owner independently of stored flag, dispatcher only with live true, and never technician/platform", () => {
    const actor = session(); actor.user.paymentCollectionEnabled = false;
    expect(companyPaymentCollectorAllowed(actor)).toBe(true);
    actor.user.role = "dispatcher";
    for (const flag of [false, null, undefined]) { actor.user.paymentCollectionEnabled = flag; expect(companyPaymentCollectorAllowed(actor)).toBe(false); }
    actor.user.paymentCollectionEnabled = true; expect(companyPaymentCollectorAllowed(actor)).toBe(true);
    actor.user.role = "technician"; expect(companyPaymentCollectorAllowed(actor)).toBe(false);
    actor.portal = "platform"; actor.user.role = "owner"; expect(companyPaymentCollectorAllowed(actor)).toBe(false);
    expect(companyPaymentCollectorAllowed(null)).toBe(false);
  });
  it("includes Company, user, role, token, Job and collection capability in the captured UI scope", () => {
    const original = session(); const key = companyCheckoutScope(original, 12);
    for (const change of [
      (s: JobSyncNativeSession) => { s.token = "rotated-fixture"; },
      (s: JobSyncNativeSession) => { s.company!.id = 10; },
      (s: JobSyncNativeSession) => { s.user.id = 43; },
      (s: JobSyncNativeSession) => { s.user.role = "dispatcher"; },
      (s: JobSyncNativeSession) => { s.user.paymentCollectionEnabled = false; },
    ]) { const actor = session(); change(actor); expect(companyCheckoutScope(actor, 12)).not.toBe(key); }
    expect(companyCheckoutScope(original, 13)).not.toBe(key);
    expect(companyCheckoutScope(null, 12)).toBeNull(); expect(companyCheckoutScope(original, 0)).toBeNull();
  });
  it("takes amount from fresh canonical balance, never total, paid history, refund or estimate arithmetic", async () => {
    const h = harness(); await h.controller.pay();
    expect(h.transport.checkout).toHaveBeenCalledTimes(1); expect(h.transport.checkout).toHaveBeenCalledWith(h.actor.token, 12);
    expect(h.transport.detail).toHaveBeenCalledWith(h.actor.token, 12, 9);
    expect(h.openBrowser).toHaveBeenCalledTimes(1); expect(h.openBrowser).toHaveBeenCalledWith(checkout().url);
    expect(h.last().detail?.balance).toBe(125.25); expect(h.last().phase).toBe("checkout");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["paid", { balance: 0, paymentStatus: "paid" }],
    ["unknown payment status", { paymentStatus: null }],
    ["unknown balance", { balance: null }],
    ["draft", { status: "draft" }],
    ["cancelled", { status: "cancelled" }],
    ["unknown lifecycle", { status: "unknown" }],
    ["sub-50-cent", { balance: 0.49 }],
  ] as const)("blocks %s before checkout POST or browser", async (_label, patch) => {
    const h = harness(); h.transport.detail.mockResolvedValue(detail(patch as Partial<JobSyncCompanyJobDetail>));
    expect(await h.controller.pay()).toBe(false);
    expect(h.transport.checkout).not.toHaveBeenCalled(); expect(h.openBrowser).not.toHaveBeenCalled();
    expect(["blocked", "paid"]).toContain(h.last().phase);
  });
  it("supports the exact 50-cent minimum and all supported non-completed lifecycle states", async () => {
    for (const status of ["scheduled", "en_route", "on_site", "completed", "follow_up"]) {
      expect(companyCheckoutBlockReason(session(), detail({ balance: 0.5, status }))).toBeNull();
    }
    const h = harness(); h.transport.detail.mockResolvedValue(detail({ balance: 0.5 }));
    h.transport.checkout.mockResolvedValue(checkout({ amountCents: 50 })); await h.controller.pay();
    expect(h.openBrowser).toHaveBeenCalledTimes(1);
  });
  it.each(["token", "user", "Company", "role", "portal"])("rejects fresh %s identity changes before detail/POST/browser/callback", async (change) => {
    const h = harness(); const fresh = session();
    if (change === "token") fresh.token = "rotated-fixture";
    if (change === "user") fresh.user.id = 43;
    if (change === "Company") fresh.company!.id = 10;
    if (change === "role") fresh.user.role = "technician";
    if (change === "portal") fresh.portal = "platform";
    h.transport.session.mockResolvedValue(fresh); expect(await h.controller.pay()).toBe(false);
    expect(h.last().message).toContain("sign-in changed");
    expect(h.transport.detail).not.toHaveBeenCalled(); expect(h.transport.checkout).not.toHaveBeenCalled();
    expect(h.openBrowser).not.toHaveBeenCalled(); expect(h.onVerifiedDetail).not.toHaveBeenCalled();
  });
  it("honors a freshly disabled dispatcher instead of the cached true capability", async () => {
    const actor = session(); actor.user.role = "dispatcher"; const h = harness(actor);
    const fresh = structuredClone(actor); fresh.user.paymentCollectionEnabled = false; h.transport.session.mockResolvedValue(fresh);
    expect(await h.controller.pay()).toBe(false); expect(h.last().phase).toBe("blocked");
    expect(h.transport.checkout).not.toHaveBeenCalled(); expect(h.openBrowser).not.toHaveBeenCalled();
  });
  it("denies technician even if the live flag is true", async () => {
    const actor = session(); actor.user.role = "technician"; const h = harness(actor);
    await h.controller.refresh(); await h.controller.pay();
    expect(h.last().message).toContain("Company owner"); expect(h.transport.checkout).not.toHaveBeenCalled();
  });
  it("rejects wrong Company and wrong Job canonical detail without publishing it", async () => {
    for (const patch of [{ companyId: 10 }, { id: 13 }]) {
      const h = harness(); h.transport.detail.mockResolvedValue(detail(patch)); await h.controller.pay();
      expect(h.onVerifiedDetail).not.toHaveBeenCalled(); expect(h.transport.checkout).not.toHaveBeenCalled();
      expect(h.openBrowser).not.toHaveBeenCalled(); expect(h.last().phase).toBe("error");
    }
  });
});

describe("checkout attempt lifecycle and honest browser return", () => {
  it("synchronously excludes duplicate pay and refresh invocations while session read is pending", async () => {
    const h = harness(); const waiting = deferred<JobSyncNativeSession>(); h.transport.session.mockReturnValueOnce(waiting.promise);
    const first = h.controller.pay(); expect(await h.controller.pay()).toBe(false); expect(await h.controller.refresh()).toBe(false);
    expect(h.transport.session).toHaveBeenCalledTimes(1); expect(h.transport.checkout).not.toHaveBeenCalled();
    waiting.resolve(session()); await first; expect(h.transport.checkout).toHaveBeenCalledTimes(1); expect(h.openBrowser).toHaveBeenCalledTimes(1);
  });
  it.each(["processing", "creating"] as const)("never opens or creates another checkout for a reused %s attempt with no URL", async (checkoutState) => {
    const h = harness(); h.transport.checkout.mockResolvedValue(checkout({ checkoutState, url: null, reused: true, attemptStatus: checkoutState === "processing" ? "succeeded" : "creating" }));
    expect(await h.controller.pay()).toBe(false); expect(h.last().phase).toBe("processing");
    expect(h.last().message).toContain("do not collect a second payment");
    await h.controller.pay(); await h.controller.refresh(); await h.controller.pay();
    expect(h.transport.checkout).toHaveBeenCalledTimes(1); expect(h.openBrowser).not.toHaveBeenCalled();
    expect(h.states.some((state) => state.phase === "paid")).toBe(false);
  });
  it("does not navigate to a server checkout with a different canonical amount", async () => {
    const h = harness(); h.transport.checkout.mockResolvedValue(checkout({ amountCents: 10000 }));
    expect(await h.controller.pay()).toBe(false); expect(h.last().message).toContain("balance changed");
    expect(h.openBrowser).not.toHaveBeenCalled(); await h.controller.refresh();
    expect(h.controller.hasCheckout()).toBe(false); expect(h.last().phase).toBe("ready");
  });
  it("checkout creation and provider success do not optimistically mark the ledger or Job paid", async () => {
    const h = harness(); const browser = deferred<unknown>(); h.openBrowser.mockReturnValue(browser.promise);
    const result = h.controller.pay(); await settle();
    expect(h.last()).toMatchObject({ phase: "checkout", detail: { balance: 125.25, paymentStatus: "partial", status: "scheduled" } });
    expect(h.states.some((s) => s.phase === "paid")).toBe(false);
    browser.resolve({ type: "success", url: "https://fixture.invalid/?payment=success" }); await result;
    expect(h.last().phase).toBe("checkout"); expect(h.last().detail?.paymentStatus).toBe("partial");
    expect(h.transport.checkout).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  });
  it("browser cancellation stays unpaid, while only a fresh zero-balance paid ledger confirms payment", async () => {
    const h = harness(); h.transport.detail.mockResolvedValueOnce(detail({ paymentStatus: "unpaid", balance: 125.25 }))
      .mockResolvedValueOnce(detail({ paymentStatus: "unpaid", balance: 125.25 }));
    await h.controller.pay(); expect(h.last().phase).toBe("checkout"); expect(h.last().detail?.paymentStatus).toBe("unpaid");
    h.transport.detail.mockResolvedValue(detail({ paymentStatus: "paid", balance: 0 })); await h.controller.refresh();
    expect(h.last()).toMatchObject({ phase: "paid", checkout: null, detail: { balance: 0, paymentStatus: "paid" } });
    expect(h.last().message).toContain("payment records"); expect(h.controller.hasCheckout()).toBe(false);
    await h.controller.pay(); expect(h.transport.checkout).toHaveBeenCalledTimes(1);
    const paidOnReturn = harness();
    paidOnReturn.transport.detail.mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail({ paymentStatus: "paid", balance: 0 }));
    expect(await paidOnReturn.controller.pay()).toBe(true);
    expect(paidOnReturn.last()).toMatchObject({ phase: "paid", checkout: null, detail: { balance: 0, paymentStatus: "paid" } });
    expect(paidOnReturn.onVerifiedDetail).toHaveBeenLastCalledWith(expect.objectContaining({ balance: 0, paymentStatus: "paid" }));
  });
  it("browser failure remains refreshable and continues the same hosted attempt without a new POST", async () => {
    const h = harness(); h.openBrowser.mockRejectedValueOnce(new Error("Browser fixture unavailable"));
    expect(await h.controller.pay()).toBe(false); expect(h.last().phase).toBe("error"); expect(h.controller.hasCheckout()).toBe(true);
    expect(await h.controller.refresh()).toBe(true); expect(h.last().phase).toBe("checkout");
    expect(await h.controller.pay()).toBe(true); expect(h.transport.checkout).toHaveBeenCalledTimes(1);
    expect(h.openBrowser).toHaveBeenCalledTimes(2);
    expect(h.openBrowser.mock.calls.map(([url]) => url)).toEqual([checkout().url, checkout().url]);
  });
  it("changed canonical balance invalidates the remembered checkout instead of reopening an obsolete obligation", async () => {
    const h = harness(); await h.controller.pay();
    h.transport.detail.mockResolvedValue(detail({ balance: 75.25 })); await h.controller.refresh();
    expect(h.controller.hasCheckout()).toBe(false); expect(h.last().phase).toBe("ready");
    h.transport.checkout.mockResolvedValue(checkout({ amountCents: 7525, attemptId: 8 })); await h.controller.pay();
    expect(h.transport.checkout).toHaveBeenCalledTimes(2); expect(h.last().detail?.balance).toBe(75.25);
  });
  it("preserves all supported checkout HTTP failures without automatic retry, fallback or manual paid write", async () => {
    for (const [status, code] of [[400, "BAD_REQUEST"], [401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [404, "NOT_FOUND"], [409, "CONFLICT"], [503, "UNAVAILABLE"]] as const) {
      const h = harness(); const message = `Safe fixture denial ${status}`;
      h.transport.checkout.mockRejectedValue(new JobSyncApiError(message, status, code));
      expect(await h.controller.pay()).toBe(false); await settle();
      expect(h.last()).toMatchObject({ phase: "error", message }); expect(h.transport.checkout).toHaveBeenCalledTimes(1);
      expect(h.openBrowser).not.toHaveBeenCalled(); expect(h.controller.hasCheckout()).toBe(false);
      expect(h.states.some((s) => s.phase === "paid")).toBe(false); expect(fetch).not.toHaveBeenCalled();
    }
  });
});

describe("controller stale work and callback disposal", () => {
  it("rejects entry before any await, state change or callback when the parent epoch is stale", async () => {
    const h = harness(); h.stale(); expect(await h.controller.refresh()).toBe(false); expect(await h.controller.pay()).toBe(false);
    expect(h.onState).not.toHaveBeenCalled(); expect(h.onVerifiedDetail).not.toHaveBeenCalled();
    expect(h.transport.session).not.toHaveBeenCalled(); expect(h.transport.checkout).not.toHaveBeenCalled(); expect(h.openBrowser).not.toHaveBeenCalled();
  });
  it.each(["session", "detail", "checkout", "browser", "return session", "return detail"])("drops completion after the %s await when the parent scope closes", async (boundary) => {
    const h = harness(); const gate = deferred<any>();
    if (boundary === "session") h.transport.session.mockReturnValueOnce(gate.promise);
    if (boundary === "detail") h.transport.detail.mockReturnValueOnce(gate.promise);
    if (boundary === "checkout") h.transport.checkout.mockReturnValueOnce(gate.promise);
    if (boundary === "browser") h.openBrowser.mockReturnValueOnce(gate.promise);
    if (boundary === "return session") h.transport.session.mockResolvedValueOnce(session()).mockReturnValueOnce(gate.promise);
    if (boundary === "return detail") h.transport.detail.mockResolvedValueOnce(detail()).mockReturnValueOnce(gate.promise);
    const result = h.controller.pay(); await settle();
    const stateCount = h.onState.mock.calls.length; const verifiedCount = h.onVerifiedDetail.mock.calls.length;
    const detailCount = h.transport.detail.mock.calls.length; const sessionCount = h.transport.session.mock.calls.length;
    h.stale(); gate.resolve(boundary.includes("session") ? session() : boundary.includes("detail") ? detail() : boundary === "checkout" ? checkout() : { type: "cancel" });
    expect(await result).toBe(false);
    expect(h.onState).toHaveBeenCalledTimes(stateCount); expect(h.onVerifiedDetail).toHaveBeenCalledTimes(verifiedCount);
    expect(h.transport.detail).toHaveBeenCalledTimes(detailCount); expect(h.transport.session).toHaveBeenCalledTimes(sessionCount);
    if (["session", "detail"].includes(boundary)) expect(h.transport.checkout).not.toHaveBeenCalled();
    if (["session", "detail", "checkout"].includes(boundary)) expect(h.openBrowser).not.toHaveBeenCalled();
  });
  it("suppresses stale rejected await errors and permanently rejects retained methods after disposal", async () => {
    const h = harness(); const gate = deferred<JobSyncCompanyJobCheckout>(); h.transport.checkout.mockReturnValueOnce(gate.promise);
    const result = h.controller.pay(); await settle(); const count = h.onState.mock.calls.length;
    h.controller.dispose(); gate.reject(new Error("stale fixture failure")); expect(await result).toBe(false);
    expect(h.onState).toHaveBeenCalledTimes(count); expect(h.openBrowser).not.toHaveBeenCalled();
    expect(await h.controller.refresh()).toBe(false); expect(await h.controller.pay()).toBe(false);
  });
  it("allows only current verified callbacks and stops if verification synchronously closes the parent scope", async () => {
    const h = harness(); h.onVerifiedDetail.mockImplementationOnce(() => h.stale());
    expect(await h.controller.pay()).toBe(false); expect(h.onVerifiedDetail).toHaveBeenCalledTimes(1); expect(h.onVerifiedDetail).toHaveBeenCalledWith(detail());
    expect(h.transport.checkout).not.toHaveBeenCalled(); expect(h.openBrowser).not.toHaveBeenCalled();
  });
  it("rechecks current immediately before browser navigation if checkout publication closes the scope", async () => {
    const h = harness(); h.onState.mockImplementation((state) => { if (state.phase === "checkout") h.stale(); });
    expect(await h.controller.pay()).toBe(false); expect(h.transport.checkout).toHaveBeenCalledTimes(1);
    expect(h.openBrowser).not.toHaveBeenCalled();
  });
  it("captures immutable originating scope rather than following an in-place token/Company session mutation", async () => {
    const h = harness(); const gate = deferred<JobSyncCompanyJobCheckout>(); h.transport.checkout.mockReturnValueOnce(gate.promise);
    const result = h.controller.pay(); await settle(); const count = h.onState.mock.calls.length;
    h.actor.token = "rotated-fixture"; h.actor.company!.id = 10;
    gate.resolve(checkout()); expect(await result).toBe(false);
    expect(h.openBrowser).not.toHaveBeenCalled(); expect(h.onState).toHaveBeenCalledTimes(count);
  });
});
