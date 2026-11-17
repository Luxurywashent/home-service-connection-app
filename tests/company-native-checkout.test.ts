import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompanyNativeCheckoutController, createNativeCheckoutOperations,
  type NativeCheckoutState, type NativeCheckoutTip, type NativeCheckoutConfiguration,
  type NativeCheckoutQuote, type NativeCheckoutContext, type NativeCheckoutIntent,
  type NativeCheckoutOperationAnchor, type NativeCheckoutSignatureApproval,
  type NativeCheckoutPrepared, type NativeCheckoutConfirmationAuthorization,
  type NativeCheckoutTransport, type NativeCheckoutProvider, type NativeCheckoutOperations,
  type CompanyNativeCheckoutController,
} from "../lib/company-native-checkout";
import type { JobSyncCompanyJobDetail, JobSyncNativeSession } from "../lib/jobsync-mobile-api";

let nextCompany = 1000;
const controllers: CompanyNativeCheckoutController[] = [];
const session = (companyId: number): JobSyncNativeSession => ({
  token: `fixture-token-${companyId}`, portal: "company",
  user: { id: 42, role: "owner", name: "Fixture Owner", email: null, paymentCollectionEnabled: true },
  company: { id: companyId, name: "Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null },
});
const detail = (companyId: number, patch: Partial<JobSyncCompanyJobDetail> = {}): JobSyncCompanyJobDetail => ({
  id: 12, companyId, customerId: 80, assignedUserId: null, title: "Fixture Job", serviceName: "Fixture Service",
  customerName: "Fixture Customer", assignedName: null, status: "scheduled", amount: 500,
  paidTotal: 150, refundTotal: 20, appliedEstimateCredit: 25, balance: 125.25, paymentStatus: "partial",
  scheduledStartAt: null, scheduledEndAt: null, updatedAt: null, addressLine1: null, city: null,
  enRouteAt: null, onSiteAt: null, completedAt: null, photos: [], ...patch,
});
const NOW = 1_700_000_000_000;
const PNG = "data:image/png;base64,aW5tZW1vcnlmaXh0dXJl";
const PM = "pm_FixtureOnlyToken";
const CARD = { brand: "Visa", last4: "4242", expMonth: 12, expYear: 2030 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let n = 0; n < 24; n++) await Promise.resolve(); }
function harness(options: { companyId?: number; actor?: JobSyncNativeSession; stored?: NativeCheckoutOperationAnchor | null; now?: () => number } = {}) {
  const companyId = options.companyId ?? nextCompany++;
  const actor = options.actor ?? session(companyId);
  let isCurrent = true;
  let stored: NativeCheckoutOperationAnchor | null = options.stored ?? null;
  const states: NativeCheckoutState[] = [];
  const order: string[] = [];
  const config: NativeCheckoutConfiguration = Object.freeze({ companyId, nativeEnabled: true, publishableKey: "pk_test_FixtureOnly", accountId: "acct_FixtureOnly", mode: "test", currency: "usd" });
  const readTransport = {
    session: vi.fn(async () => structuredClone(actor)),
    detail: vi.fn(async () => detail(companyId)),
  };
  const quote = (tip: NativeCheckoutTip = { kind: "none" }, patch: Partial<NativeCheckoutQuote> = {}): NativeCheckoutQuote => ({
    quoteId: `quote_${tip.kind}`, companyId, jobId: 12, accountId: config.accountId, mode: "test", currency: "usd",
    obligationVersion: "server-obligation-v1", principalCents: 12525,
    tipCents: tip.kind === "percentage" ? 2255 : tip.kind === "custom" ? tip.amountCents : 0,
    totalCents: 12525 + (tip.kind === "percentage" ? 2255 : tip.kind === "custom" ? tip.amountCents : 0),
    tip, expiresAt: NOW + 60000, ...patch,
  });
  const operations = {
    generateKey: vi.fn(async () => `secure-fixture-operation-${companyId}`),
    load: vi.fn(async () => stored),
    save: vi.fn(async (anchor: NativeCheckoutOperationAnchor) => { order.push("protected-pointer"); stored = anchor; }),
  } satisfies NativeCheckoutOperations;
  const approved = (intent: NativeCheckoutIntent): NativeCheckoutSignatureApproval => ({ intent, signatureApprovalId: "approval_private_Fixture", privateStored: true });
  const prepared = (intent: NativeCheckoutIntent): NativeCheckoutPrepared => ({ kind: "prepared", intent,
    signatureApprovalId: "approval_private_Fixture", paymentIntentId: "pi_FixtureOnly",
    clientSecret: "pi_FixtureOnly_secret_FixtureOnly", unconfirmed: true, sharedLockHeld: true, serverReauthorized: true });
  const authorization = (intent: NativeCheckoutIntent): NativeCheckoutConfirmationAuthorization => ({ intent,
    signatureApprovalId: "approval_private_Fixture", paymentIntentId: "pi_FixtureOnly", authorized: true, sharedLockHeld: true, expiresAt: NOW + 60000 });
  const transport = {
    capabilities: vi.fn(async () => config),
    quote: vi.fn(async (_context: NativeCheckoutContext, request: { tip: NativeCheckoutTip }) => quote(request.tip)),
    approveSignature: vi.fn(async (_context: NativeCheckoutContext, request: { intent: NativeCheckoutIntent }) => { order.push("private-signature"); return approved(request.intent); }),
    prepare: vi.fn(async (_context: NativeCheckoutContext, request: { intent: NativeCheckoutIntent }) => { order.push("prepare-unconfirmed"); return prepared(request.intent); }),
    authorizeConfirmation: vi.fn(async (_context: NativeCheckoutContext, request: { intent: NativeCheckoutIntent }) => { order.push("final-server-authorization"); return authorization(request.intent); }),
    status: vi.fn(async (_context: NativeCheckoutContext, key: string) => ({ companyId, jobId: 12, operationKey: key, state: "unknown" as const })),
  } satisfies NativeCheckoutTransport;
  const provider = { confirm: vi.fn(async (_input: Parameters<NativeCheckoutProvider["confirm"]>[0]) => { order.push("provider-confirm"); return { status: "succeeded" as const }; }) } satisfies NativeCheckoutProvider;
  const onState = vi.fn((state: NativeCheckoutState) => { states.push(state); });
  const onVerifiedDetail = vi.fn();
  const controller = createCompanyNativeCheckoutController({ session: actor, jobId: 12, isCurrent: () => isCurrent,
    onState, onVerifiedDetail, readTransport, nativeTransport: transport, operations, provider, now: options.now ?? (() => NOW) });
  controllers.push(controller);
  return { controller, actor, companyId, transport, readTransport, operations, provider, onState, onVerifiedDetail,
    states, order, config, quote, approved, prepared, authorization, last: () => controller.getState(),
    stale: () => { isCurrent = false; }, stored: () => stored };
}
async function throughQuote(h: ReturnType<typeof harness>, tip: NativeCheckoutTip = { kind: "none" }) {
  expect(await h.controller.refresh()).toBe(true);
  expect(h.controller.selectMethod("card")).toBe(true);
  expect(h.controller.setPaymentMethod(PM, CARD)).toBe(true);
  expect(await h.controller.quoteTip(tip)).toBe(true);
  expect(h.last().phase).toBe("tip");
  expect(h.controller.continueToSignature()).toBe(true);
}
async function signed(h: ReturnType<typeof harness>) { await throughQuote(h); expect(await h.controller.approveSignature({ pngDataUrl: PNG })).toBe(true); }
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No live network allowed"))); });
afterEach(() => { controllers.splice(0).forEach((controller) => controller.dispose()); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("native readiness and controlled secure card entry", () => {
  it("fails closed without injected native transport and never calls hosted/public/manual payment", async () => {
    const h = harness();
    const state = vi.fn();
    const c = createCompanyNativeCheckoutController({ session: h.actor, jobId: 13, isCurrent: () => true, onState: state,
      readTransport: { session: h.readTransport.session, detail: vi.fn(async () => detail(h.companyId, { id: 13 })) } });
    controllers.push(c);
    expect(await c.refresh()).toBe(false); expect(c.getState().phase).toBe("blocked");
    expect(c.selectMethod("card")).toBe(false); expect(await c.confirm()).toBe(false);
    expect(h.transport.prepare).not.toHaveBeenCalled(); expect(h.provider.confirm).not.toHaveBeenCalled();
  });
  it.each(["native-disabled", "missing-key", "mode-key-mismatch", "wrong-company", "missing-account"])("blocks %s server capabilities", async (fault) => {
    const h = harness();
    const config = { ...h.config };
    if (fault === "native-disabled") config.nativeEnabled = false;
    if (fault === "missing-key") config.publishableKey = "";
    if (fault === "mode-key-mismatch") config.mode = "live";
    if (fault === "wrong-company") config.companyId++;
    if (fault === "missing-account") config.accountId = "";
    h.transport.capabilities.mockResolvedValue(config);
    expect(await h.controller.refresh()).toBe(false); expect(h.last().phase).toBe("blocked");
    expect(h.last().methods.card.available).toBe(false); expect(h.controller.selectMethod("card")).toBe(false);
    expect(h.provider.confirm).not.toHaveBeenCalled();
  });
  it("keeps Tap to Pay unavailable even if injected config adds a local readiness flag", async () => {
    const h = harness(); h.transport.capabilities.mockResolvedValue({ ...h.config, tapToPayEnabled: true } as NativeCheckoutConfiguration);
    await h.controller.refresh(); expect(h.last().methods.tapToPay.available).toBe(false);
    expect(h.controller.selectMethod("tap_to_pay")).toBe(false); expect(h.last().message).toContain("entitlement");
    expect(h.transport.prepare).not.toHaveBeenCalled(); expect(h.provider.confirm).not.toHaveBeenCalled();
  });
  it("accepts only pm token and masked metadata, strips extra fields from public state", async () => {
    const h = harness(); await h.controller.refresh(); h.controller.selectMethod("card");
    expect(h.controller.setPaymentMethod("4242424242424242", CARD)).toBe(false);
    expect(h.controller.setPaymentMethod(PM, { ...CARD, pan: "raw-forbidden", cvc: "raw-forbidden" } as typeof CARD)).toBe(true);
    expect(h.last().card).toEqual(CARD); expect(h.last().phase).toBe("tip");
    expect(JSON.stringify(h.states)).not.toContain(PM); expect(JSON.stringify(h.states)).not.toContain("raw-forbidden");
    expect(h.transport.prepare).not.toHaveBeenCalled(); expect(h.provider.confirm).not.toHaveBeenCalled();
  });
});

describe("authoritative quote, private signature and final-only confirmation", () => {
  it("rejects expired tip-review continuation and checks authorization expiry inside delayed provider work", async () => {
    let time = NOW;
    const h = harness({ now: () => time }); await throughQuote(h); h.controller.back();
    await h.controller.quoteTip({ kind: "none" }); time = NOW + 60001;
    expect(h.controller.continueToSignature()).toBe(false); expect(h.last().quote).toBeNull();
    time = NOW; await h.controller.quoteTip({ kind: "none" }); h.controller.continueToSignature();
    await h.controller.approveSignature({ pngDataUrl: PNG });
    h.provider.confirm.mockImplementation(async (request) => {
      expect(request.isCurrent()).toBe(true); time = NOW + 60001;
      expect(request.isCurrent()).toBe(false);
      return { status: "failed" } as never;
    });
    expect(await h.controller.confirm()).toBe(false); expect(h.last().phase).toBe("unknown");
  });
  it("captures signature pixels before any wait and sends only the original evidence to private storage", async () => {
    const h = harness(); await throughQuote(h); const gate = deferred<JobSyncNativeSession>();
    h.readTransport.session.mockReturnValueOnce(gate.promise);
    const evidence = { pngDataUrl: PNG }; const first = h.controller.approveSignature(evidence);
    evidence.pngDataUrl = "data:image/png;base64,bXV0YXRlZA=="; gate.resolve(h.actor);
    expect(await first).toBe(true);
    expect(h.transport.approveSignature).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ evidence: { pngDataUrl: PNG } }));
  });
  it("uses explicit tip review continuation and Back clears tokens/quotes before any operation", async () => {
    const h = harness(); await h.controller.refresh(); h.controller.selectMethod("card");
    expect(h.controller.back()).toBe(true); expect(h.last().phase).toBe("method");
    h.controller.selectMethod("card"); h.controller.setPaymentMethod(PM, CARD);
    expect(h.controller.continueToSignature()).toBe(false);
    await h.controller.quoteTip({ kind: "none" }); expect(h.last().phase).toBe("tip");
    expect(h.controller.continueToSignature()).toBe(true); expect(h.last().phase).toBe("signature");
    expect(h.controller.back()).toBe(true); expect(h.last()).toMatchObject({ phase: "tip", quote: null, signatureApproved: false });
    expect(h.controller.continueToSignature()).toBe(false);
    expect(h.controller.back()).toBe(true); expect(h.last()).toMatchObject({ phase: "card", card: null, quote: null });
    expect(await h.controller.quoteTip({ kind: "none" })).toBe(false);
    expect(h.transport.approveSignature).not.toHaveBeenCalled(); expect(h.transport.prepare).not.toHaveBeenCalled();
  });
  it("Back is unavailable once a signature operation exists, while busy, or after scope closes", async () => {
    const h = harness(); await signed(h); expect(h.controller.back()).toBe(false);
    expect(h.controller.continueToSignature()).toBe(false);
    h.stale(); expect(h.controller.back()).toBe(false);
    const fresh = harness(); await fresh.controller.refresh(); fresh.controller.selectMethod("card"); fresh.controller.setPaymentMethod(PM, CARD);
    const gate = deferred<NativeCheckoutQuote>(); fresh.transport.quote.mockReturnValueOnce(gate.promise);
    const pending = fresh.controller.quoteTip({ kind: "none" }); await settle();
    expect(fresh.controller.back()).toBe(false); gate.resolve(fresh.quote()); await pending;
  });
  it("charges only on a final deliberate confirm after pointer/signature/prepare/server reauthorization", async () => {
    const h = harness(); expect(await h.controller.confirm()).toBe(false);
    await throughQuote(h); expect(await h.controller.confirm()).toBe(false);
    await h.controller.approveSignature({ pngDataUrl: PNG });
    expect(h.last()).toMatchObject({ phase: "signature", signatureApproved: true, canConfirm: true });
    expect(h.transport.prepare).not.toHaveBeenCalled(); expect(h.provider.confirm).not.toHaveBeenCalled();
    expect(await h.controller.confirm()).toBe(true);
    expect(h.order).toEqual(["protected-pointer", "private-signature", "prepare-unconfirmed", "final-server-authorization", "provider-confirm"]);
    expect(h.provider.confirm).toHaveBeenCalledTimes(1);
    expect(h.provider.confirm.mock.calls[0][0]).toMatchObject({ paymentMethodId: PM, clientSecret: "pi_FixtureOnly_secret_FixtureOnly", configuration: h.config });
    expect(h.last().phase).toBe("processing"); expect(await h.controller.confirm()).toBe(false);
    expect(JSON.stringify(h.states)).not.toContain(PNG); expect(JSON.stringify(h.states)).not.toContain("_secret_");
    expect(JSON.stringify(h.states)).not.toContain("approval_private"); expect(JSON.stringify(h.stored())).not.toContain(PM);
    expect(h.stored()).toEqual({ companyId: h.companyId, jobId: 12, operationKey: `secure-fixture-operation-${h.companyId}` });
  });
  it.each([15, 18, 20, 25] as const)("passes %s percent intent to server and displays server tip, not local arithmetic", async (percent) => {
    const h = harness(); await throughQuote(h, { kind: "percentage", percent });
    expect(h.transport.quote).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: h.companyId, jobId: 12 }), expect.objectContaining({ tip: { kind: "percentage", percent } }));
    expect(h.last().quote).toMatchObject({ principalCents: 12525, tipCents: 2255, totalCents: 14780 });
    expect(h.transport.prepare).not.toHaveBeenCalled();
  });
  it("supports no/custom tip and refuses invalid or mismatched server totals", async () => {
    const h = harness(); await throughQuote(h, { kind: "custom", amountCents: 432 });
    expect(h.last().quote).toMatchObject({ tipCents: 432, totalCents: 12957 });
    expect(await h.controller.quoteTip({ kind: "custom", amountCents: -1 })).toBe(false);
    h.transport.quote.mockImplementation(async (_context, request) => h.quote(request.tip, { totalCents: 99999 }));
    expect(await h.controller.quoteTip({ kind: "none" })).toBe(false);
    expect(h.last().signatureApproved).toBe(false); expect(h.last().quote).toBeNull();
  });
  it("freezes tip input before an async pricing wait", async () => {
    const h = harness(); await h.controller.refresh(); h.controller.selectMethod("card"); h.controller.setPaymentMethod(PM, CARD);
    const gate = deferred<JobSyncNativeSession>(); h.readTransport.session.mockReturnValueOnce(gate.promise);
    const tip = { kind: "custom" as const, amountCents: 100 }; const result = h.controller.quoteTip(tip);
    tip.amountCents = 900; gate.resolve(h.actor); expect(await result).toBe(true);
    expect(h.last().quote?.tip).toEqual({ kind: "custom", amountCents: 100 });
  });
  it("rejects a private approval that is not exactly bound to quote/operation", async () => {
    const h = harness(); await throughQuote(h);
    h.transport.approveSignature.mockImplementation(async (_ctx, request) => h.approved({ ...request.intent, quote: { ...request.intent.quote, totalCents: 99999 } }));
    expect(await h.controller.approveSignature({ pngDataUrl: PNG })).toBe(false);
    expect(h.last().phase).toBe("unknown"); expect(await h.controller.confirm()).toBe(false);
    expect(h.transport.prepare).not.toHaveBeenCalled(); expect(h.provider.confirm).not.toHaveBeenCalled();
  });
  it("requires a new signature for a new quote and never mutates the signed request or generates a replacement key", async () => {
    const h = harness(); await signed(h);
    const original = h.transport.approveSignature.mock.calls[0][1].intent;
    expect(Object.isFrozen(original)).toBe(true); expect(Object.isFrozen(original.quote)).toBe(true);
    expect(await h.controller.quoteTip({ kind: "custom", amountCents: 100 })).toBe(false);
    expect(h.last().signatureApproved).toBe(false); expect(h.last().phase).toBe("unknown");
    expect(original.quote.tip).toEqual({ kind: "none" }); expect(original.quote.totalCents).toBe(12525);
    expect(await h.controller.confirm()).toBe(false); expect(h.operations.generateKey).toHaveBeenCalledTimes(1);
    expect(h.transport.prepare).not.toHaveBeenCalled();
  });
  it("stale canonical principal before final confirm causes no prepare or charge", async () => {
    const h = harness(); await signed(h); h.readTransport.detail.mockResolvedValue(detail(h.companyId, { balance: 75.25 }));
    expect(await h.controller.confirm()).toBe(false); expect(h.last().signatureApproved).toBe(false);
    expect(h.transport.prepare).not.toHaveBeenCalled(); expect(h.provider.confirm).not.toHaveBeenCalled();
  });
  it("rechecks canonical balance after prepare and refuses confirmation if principal changed", async () => {
    const h = harness(); await signed(h);
    h.readTransport.detail.mockResolvedValueOnce(detail(h.companyId)).mockResolvedValue(detail(h.companyId, { balance: 75.25 }));
    expect(await h.controller.confirm()).toBe(false); expect(h.transport.prepare).toHaveBeenCalledTimes(1);
    expect(h.transport.authorizeConfirmation).not.toHaveBeenCalled(); expect(h.provider.confirm).not.toHaveBeenCalled();
  });
  it("a private signature failure holds original operation and never exposes a PI", async () => {
    const h = harness(); await throughQuote(h); h.transport.approveSignature.mockRejectedValue(new Error(`sensitive ${PNG} ${PM}`));
    expect(await h.controller.approveSignature({ pngDataUrl: PNG })).toBe(false); expect(h.last().phase).toBe("unknown");
    expect(h.transport.prepare).not.toHaveBeenCalled(); expect(h.provider.confirm).not.toHaveBeenCalled();
    expect(h.last().message).not.toContain("sensitive");
  });
});

describe("live Company authorization and server lock acknowledgement", () => {
  it("revoked dispatcher permission after signature blocks prepare", async () => {
    const actor = session(nextCompany++); actor.user.role = "dispatcher";
    const h = harness({ companyId: actor.company!.id, actor }); await signed(h);
    h.readTransport.session.mockResolvedValue({ ...actor, user: { ...actor.user, paymentCollectionEnabled: false } });
    expect(await h.controller.confirm()).toBe(false); expect(h.last().phase).toBe("blocked");
    expect(h.transport.prepare).not.toHaveBeenCalled(); expect(h.provider.confirm).not.toHaveBeenCalled();
  });
  it("revocation during prepare prevents provider confirmation", async () => {
    const actor = session(nextCompany++); actor.user.role = "dispatcher";
    const h = harness({ companyId: actor.company!.id, actor }); await signed(h);
    h.transport.prepare.mockImplementation(async (_ctx, request) => {
      h.readTransport.session.mockResolvedValue({ ...actor, user: { ...actor.user, paymentCollectionEnabled: false } });
      return h.prepared(request.intent);
    });
    expect(await h.controller.confirm()).toBe(false); expect(h.provider.confirm).not.toHaveBeenCalled();
  });
  it.each(["hosted_active", "native_active", "permission_denied", "balance_changed"] as const)("honors %s prepare block before provider", async (reason) => {
    const h = harness(); await signed(h);
    h.transport.prepare.mockImplementation(async (_ctx, request) => ({ kind: "blocked", companyId: h.companyId, jobId: 12, operationKey: request.intent.operationKey, reason }) as never);
    expect(await h.controller.confirm()).toBe(false); expect(h.last().phase).toBe("blocked");
    expect(h.provider.confirm).not.toHaveBeenCalled(); expect(h.transport.authorizeConfirmation).not.toHaveBeenCalled();
  });
  it("requires actual final server authorization, not a local ready flag", async () => {
    const h = harness(); await signed(h);
    h.transport.authorizeConfirmation.mockImplementation(async (_ctx, request) => ({ ...h.authorization(request.intent), authorized: false }) as never);
    expect(await h.controller.confirm()).toBe(false); expect(h.last().phase).toBe("unknown");
    expect(h.provider.confirm).not.toHaveBeenCalled();
  });
  it.each(["token", "Company", "Job", "role"])("rejects fresh %s mismatch without a charge", async (scope) => {
    const h = harness(); await signed(h);
    if (scope === "token") h.readTransport.session.mockResolvedValue({ ...h.actor, token: "rotated" });
    if (scope === "Company") h.readTransport.detail.mockResolvedValue(detail(h.companyId + 1));
    if (scope === "Job") h.readTransport.detail.mockResolvedValue(detail(h.companyId, { id: 13 }));
    if (scope === "role") h.readTransport.session.mockResolvedValue({ ...h.actor, user: { ...h.actor.user, role: "technician" } });
    expect(await h.controller.confirm()).toBe(false); expect(h.transport.prepare).not.toHaveBeenCalled(); expect(h.provider.confirm).not.toHaveBeenCalled();
  });
});

describe("same-Job single-flight, close/reopen and read-only unknown recovery", () => {
  it("double final press is single-flight even while the fresh session read waits", async () => {
    const h = harness(); await signed(h);
    const gate = deferred<JobSyncNativeSession>(); h.readTransport.session.mockReturnValueOnce(gate.promise);
    const first = h.controller.confirm(); expect(await h.controller.confirm()).toBe(false); expect(await h.controller.refreshStatus()).toBe(false);
    gate.resolve(h.actor); expect(await first).toBe(true); expect(h.transport.prepare).toHaveBeenCalledTimes(1); expect(h.provider.confirm).toHaveBeenCalledTimes(1);
  });
  it("another controller for the same Job cannot race an in-flight prepare or create a new operation after reopen", async () => {
    const h = harness(); await signed(h); const gate = deferred<NativeCheckoutPrepared>();
    h.transport.prepare.mockReturnValueOnce(gate.promise); const first = h.controller.confirm(); await settle();
    const second = harness({ companyId: h.companyId });
    expect(await second.controller.refresh()).toBe(false); expect(await second.controller.confirm()).toBe(false);
    const original = h.transport.approveSignature.mock.calls[0][1].intent;
    h.controller.dispose(); gate.resolve(h.prepared(original)); expect(await first).toBe(false);
    expect(await second.controller.refresh()).toBe(true); expect(second.last().phase).toBe("unknown");
    expect(second.transport.status).toHaveBeenCalledWith(expect.anything(), original.operationKey);
    expect(second.controller.selectMethod("card")).toBe(false);
    expect(second.operations.generateKey).not.toHaveBeenCalled(); expect(second.transport.prepare).not.toHaveBeenCalled(); expect(h.provider.confirm).not.toHaveBeenCalled();
  });
  it("hydrates a protected durable pointer and only retrieves original status (never autoconfirms prepared status)", async () => {
    const companyId = nextCompany++;
    const anchor = { companyId, jobId: 12, operationKey: "secure-fixture-restored-operation" };
    const h = harness({ companyId, stored: anchor });
    h.transport.status.mockResolvedValue({ ...anchor, state: "prepared" } as never);
    expect(await h.controller.refresh()).toBe(true); expect(h.last().phase).toBe("unknown");
    expect(h.transport.status).toHaveBeenCalledWith(expect.anything(), anchor.operationKey);
    expect(await h.controller.confirm()).toBe(false); expect(h.operations.generateKey).not.toHaveBeenCalled(); expect(h.transport.prepare).not.toHaveBeenCalled(); expect(h.provider.confirm).not.toHaveBeenCalled();
  });
  it.each(["prepare", "provider"])("ambiguous %s network loss permits only read-only original status retrieval even if not found", async (boundary) => {
    const h = harness(); await signed(h);
    if (boundary === "prepare") h.transport.prepare.mockRejectedValue(new Error("network lost after server received request"));
    else h.provider.confirm.mockRejectedValue(new Error("network lost after SDK received confirmation"));
    expect(await h.controller.confirm()).toBe(false); expect(h.last().phase).toBe("unknown");
    const key = h.stored()!.operationKey;
    h.transport.status.mockResolvedValue({ companyId: h.companyId, jobId: 12, operationKey: key, state: "not_found" } as never);
    expect(await h.controller.refreshStatus()).toBe(true); expect(h.last().phase).toBe("unknown");
    expect(await h.controller.confirm()).toBe(false); expect(h.transport.prepare).toHaveBeenCalledTimes(1);
    expect(h.provider.confirm).toHaveBeenCalledTimes(boundary === "prepare" ? 0 : 1); expect(h.operations.generateKey).toHaveBeenCalledTimes(1);
    expect(h.transport.status).toHaveBeenCalledWith(expect.anything(), key);
  });
  it("keeps original recovery pointer and blocks if status response is for a different operation", async () => {
    const h = harness(); await signed(h); h.controller.dispose();
    const second = harness({ companyId: h.companyId });
    second.transport.status.mockResolvedValue({ companyId: h.companyId, jobId: 12, operationKey: "wrong-operation-key", state: "succeeded" } as never);
    expect(await second.controller.refresh()).toBe(false); expect(second.last().phase).toBe("unknown");
    expect(second.provider.confirm).not.toHaveBeenCalled(); expect(second.operations.generateKey).not.toHaveBeenCalled();
  });
  it.each(["session", "prepare", "authorization", "provider"])("drops completion and retained callbacks after closing at %s await", async (boundary) => {
    const h = harness(); await signed(h); const gate = deferred<any>();
    if (boundary === "session") h.readTransport.session.mockReturnValueOnce(gate.promise);
    if (boundary === "prepare") h.transport.prepare.mockReturnValueOnce(gate.promise);
    if (boundary === "authorization") h.transport.authorizeConfirmation.mockReturnValueOnce(gate.promise);
    if (boundary === "provider") h.provider.confirm.mockReturnValueOnce(gate.promise);
    const first = h.controller.confirm(); await settle();
    const stateCount = h.onState.mock.calls.length; const verifiedCount = h.onVerifiedDetail.mock.calls.length;
    h.stale(); const intent = h.transport.approveSignature.mock.calls[0][1].intent;
    gate.resolve(boundary === "session" ? h.actor : boundary === "prepare" ? h.prepared(intent) : boundary === "authorization" ? h.authorization(intent) : { status: "succeeded" });
    expect(await first).toBe(false); expect(h.onState).toHaveBeenCalledTimes(stateCount); expect(h.onVerifiedDetail).toHaveBeenCalledTimes(verifiedCount);
    expect(await h.controller.confirm()).toBe(false); expect(await h.controller.refresh()).toBe(false);
    expect(h.controller.setPaymentMethod(PM, CARD)).toBe(false); expect(await h.controller.approveSignature({ pngDataUrl: PNG })).toBe(false);
    if (boundary !== "provider") expect(h.provider.confirm).not.toHaveBeenCalled();
  });
  it("checks current after callbacks and prevents reservation when a callback synchronously closes the sheet", async () => {
    const h = harness(); await signed(h);
    h.onState.mockImplementation((state) => { if (state.phase === "processing") h.stale(); });
    expect(await h.controller.confirm()).toBe(false); expect(h.transport.prepare).not.toHaveBeenCalled(); expect(h.provider.confirm).not.toHaveBeenCalled();
  });
  it("captures immutable original session and drops retained handlers after an in-place scope change", async () => {
    const h = harness(); await signed(h);
    h.actor.token = "new-session-token"; h.actor.company!.id++;
    const count = h.onState.mock.calls.length; expect(await h.controller.confirm()).toBe(false);
    expect(await h.controller.refreshStatus()).toBe(false); expect(h.onState).toHaveBeenCalledTimes(count); expect(h.provider.confirm).not.toHaveBeenCalled();
  });
});

describe("ledger-only paid acknowledgement", () => {
  it("SDK success and successful attempt status are still processing until canonical paid/zero-balance readback", async () => {
    const h = harness(); await signed(h); expect(await h.controller.confirm()).toBe(true);
    expect(h.last().phase).toBe("processing"); expect(h.states.some((state) => state.phase === "paid")).toBe(false);
    h.transport.status.mockResolvedValue({ companyId: h.companyId, jobId: 12, operationKey: h.stored()!.operationKey, state: "succeeded" } as never);
    await h.controller.refreshStatus(); expect(h.last().phase).toBe("processing");
    h.readTransport.detail.mockResolvedValue(detail(h.companyId, { paymentStatus: "paid", balance: 0 }));
    expect(await h.controller.refreshStatus()).toBe(true); expect(h.last()).toMatchObject({ phase: "paid", signatureApproved: false, quote: null });
    expect(h.provider.confirm).toHaveBeenCalledTimes(1); expect(h.transport.prepare).toHaveBeenCalledTimes(1);
  });
  it.each([{ paymentStatus: "paid", balance: 10 }, { paymentStatus: "partial", balance: 0 }, { paymentStatus: null, balance: 0 }])("never calls %j canonical paid", async (patch) => {
    const h = harness(); h.readTransport.detail.mockResolvedValue(detail(h.companyId, patch));
    expect(await h.controller.refresh()).toBe(false); expect(h.last().phase).toBe("blocked"); expect(h.last().phase).not.toBe("paid");
  });
});

describe("injected protected-pointer adapter", () => {
  it("reserves an immutable nonsensitive pointer, recovers its key and cleans only on explicit canonical-paid release", async () => {
    const pointer = { version: 1 as const, companyId: 90, userId: 42, jobId: 12,
      operationKey: "hsc-native-11111111-1111-4111-8111-111111111111", createdAt: "2026-11-16T00:00:00.000Z" };
    const store = { read: vi.fn().mockResolvedValue(null), reserve: vi.fn().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(true) };
    const createPointer = vi.fn(() => pointer);
    const ops = createNativeCheckoutOperations({ companyId: 90, userId: 42, jobId: 12, store, createPointer });
    expect(await ops.load({ companyId: 90, jobId: 12 })).toBeNull();
    const key = await ops.generateKey(); const anchor = { companyId: 90, jobId: 12, operationKey: key };
    await ops.save(anchor);
    expect(Object.isFrozen(store.reserve.mock.calls[0][0])).toBe(true);
    expect(Object.keys(store.reserve.mock.calls[0][0]).sort()).toEqual(["companyId", "createdAt", "jobId", "operationKey", "userId", "version"]);
    expect(store.remove).not.toHaveBeenCalled(); expect(() => ops.generateKey()).toThrow();
    await ops.releasePaid!(anchor); expect(store.remove).toHaveBeenCalledWith(pointer);
    store.read.mockResolvedValue(pointer);
    const restored = createNativeCheckoutOperations({ companyId: 90, userId: 42, jobId: 12, store, createPointer });
    expect(await restored.load({ companyId: 90, jobId: 12 })).toEqual(anchor);
    expect(() => restored.generateKey()).toThrow(); expect(createPointer).toHaveBeenCalledTimes(1);
  });
  it("blocks a refused protected reservation before any native effect", async () => {
    const pointer = { version: 1 as const, companyId: 90, userId: 42, jobId: 12,
      operationKey: "hsc-native-22222222-2222-4222-8222-222222222222", createdAt: "2026-11-16T00:00:00.000Z" };
    const store = { read: vi.fn().mockResolvedValue(null), reserve: vi.fn().mockResolvedValue(false), remove: vi.fn().mockResolvedValue(true) };
    const ops = createNativeCheckoutOperations({ companyId: 90, userId: 42, jobId: 12, store, createPointer: () => pointer });
    const key = await ops.generateKey(); await expect(ops.save({ companyId: 90, jobId: 12, operationKey: key })).rejects.toThrow();
    expect(store.remove).not.toHaveBeenCalled();
    await expect(ops.load({ companyId: 91, jobId: 12 })).rejects.toThrow();
  });
});
