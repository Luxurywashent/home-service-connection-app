import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, runInContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import { createCompanyJobCheckoutController, type CompanyCheckoutState } from "../lib/company-job-checkout";
import { createJobSyncCompanyJobCheckout, normalizeJobSyncMobileSession, validateCompanyCheckoutUrl } from "../lib/jobsync-mobile-api";

// No backend bootstrap, SDK, DB, credentials, or network is imported. These exact function
// source excerpts are pinned to the inspected backend archives caacf7af / c0c63e63;
// checkout/provider/projection bodies are identical in both. Transpilation only removes types.
// Keeping the excerpts here makes the regression portable without private backend archives.
const BACKEND_SOURCE = String.raw`
export async function createStripeConnectJobCheckoutSession(input: {
  accountId: string;
  amountCents: number;
  feeCents: number;
  productName: string;
  companyId: number;
  jobId: number;
  customerId: number | null;
  origin: string;
  successUrl?: string;
  cancelUrl?: string;
  attemptId: number;
  idempotencyKey: string;
  mode?: Exclude<StripeMode, "unknown">;
}) {
  assertProductionConnectPaymentsAllowed();
  const client = stripeConnectClientForMode(input.mode || (stripeModeForIntegration("connect") as Exclude<StripeMode, "unknown">));
  const session = await client.checkout.sessions.create({
    mode: "payment", payment_method_types: ["card"],
    line_items: [{ price_data: { currency: "usd", unit_amount: input.amountCents, product_data: { name: input.productName } }, quantity: 1 }],
    payment_intent_data: {
      application_fee_amount: input.feeCents,
      metadata: jobCheckoutMetadata(input),
    },
    metadata: jobCheckoutMetadata(input),
    customer_creation: "always", customer_email: undefined,
    success_url: input.successUrl || TEMPLATE_STARTpublicOrigin(input.origin)}/app/jobs?payment=success&session_id={CHECKOUT_SESSION_ID}TEMPLATE_END,
    cancel_url: input.cancelUrl || TEMPLATE_STARTpublicOrigin(input.origin)}/app/jobs?payment=cancelledTEMPLATE_END,
  }, { stripeAccount: input.accountId, idempotencyKey: input.idempotencyKey });
  if (!session.url) throw new Error("Stripe did not return a checkout link.");
  return {
    id: String(session.id),
    url: session.url,
    paymentIntentId: paymentIntentIdFromStripeObject(session.payment_intent),
    expiresAt: unixSecondsToDate(session.expires_at),
    status: session.status ? String(session.status) : "open",
    paymentStatus: session.payment_status ? String(session.payment_status) : "unpaid",
  };
}
function jobCheckoutMetadata(input: {
  companyId: number;
  jobId: number;
  customerId: number | null;
  accountId: string;
  attemptId: number;
}) {
  return {
    hsc_payment_kind: "job",
    hsc_company_id: String(input.companyId),
    hsc_job_id: String(input.jobId),
    hsc_customer_id: String(input.customerId || ""),
    hsc_connect_account_id: input.accountId,
    hsc_job_payment_attempt_id: String(input.attemptId),
  };
}
function paymentIntentIdFromStripeObject(value: unknown) {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "id" in value && typeof (value as { id?: unknown }).id === "string") {
    return String((value as { id: string }).id);
  }
  return null;
}
function unixSecondsToDate(value: unknown) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}
function toNumber(value: unknown) {
  return Number(value ?? 0);
}
function checkoutResult(attempt: AttemptRow, input: { reused: boolean; checkoutState: JobCheckoutState; url?: string | null }): JobCheckoutSession {
  return {
    url: input.url === undefined ? (attempt.stripe_checkout_url ? String(attempt.stripe_checkout_url) : null) : input.url,
    amountCents: toNumber(attempt.amount_cents),
    platformFeeCents: toNumber(attempt.platform_fee_cents),
    attemptId: toNumber(attempt.id),
    attemptStatus: String(attempt.status) as JobPaymentAttemptStatus,
    checkoutState: input.checkoutState,
    reused: input.reused,
    stripeIdempotencyKey: attempt.stripe_idempotency_key ? String(attempt.stripe_idempotency_key) : null,
  };
}
async function createMobileJobCheckout(req: Request, res: Response) {
  try {
    const { company, db } = await mobileCompany(req);
    requireManager(company.role);
    const jobId = Number(req.params.jobId);
    const checkout = await createCompanyJobCheckout(db, company, {
      jobId,
      origin: mobileRequestOrigin(req),
      createdVia: "mobile_card",
    });
    return res.status(checkout.reused ? 200 : 201).json({
      checkout: {
        url: checkout.url,
        amountCents: checkout.amountCents,
        attemptId: checkout.attemptId,
        attemptStatus: checkout.attemptStatus,
        checkoutState: checkout.checkoutState,
        reused: checkout.reused,
      },
    });
  } catch (error) { return operationalError(res, error, "A valid Company Checkout request is required."); }
}
// Restore nested template delimiters without interpolation by this outer fixture string.
`.replaceAll("TEMPLATE_START", "`${").replaceAll("TEMPLATE_END", "`");

const ORIGIN = "https://www.homeserviceconnected.com";
const TOKEN = "provider-compatibility-synthetic-token";
// Official public documentation URL, never a live user's URL and never navigated/fetched.
const OFFICIAL_URL = "https://checkout.stripe.com/c/pay/cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u%2FM2F8bUA2SDRySkFdUV81T1BSV0YxcWJcTUJcYW5rSzN3dzBLPUE0TzRKTTxzNFBjPWZEX1NKSkxpNTVjRjN8VHE0YicpJ2N3amhWYHdzYHcnP3F3cGApJ2lkfGpwcVF8dWAnPyd2bGtiaWBabHFgaCcpJ2BrZGdpYFVpZGZgbWppYWB3dic%2FcXdwYHgl";
// Synthetic equivalent of the separately reported private stored live Session structure.
const LIVE_G_PAY_URL = "https://checkout.stripe.com/g/pay/cs_live_Synthetic/c/#fidkdWx%2FToken%2Btail%3D";
const profile = () => ({
  accountType: "company",
  user: { id: 42, role: "owner", name: "Synthetic Owner", paymentCollectionEnabled: true },
  company: { id: 9, name: "Synthetic Company" },
});
const job = () => ({
  id: 12, companyId: 9, customerId: 41, status: "scheduled", title: "Synthetic $1 Job",
  amount: 1, paidTotal: 0, refundTotal: 0, appliedEstimateCredit: 0,
  balance: 1, paymentStatus: "unpaid", photos: [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function backendFixture(url = OFFICIAL_URL) {
  const sessionId = new URL(url).pathname.match(/\/(cs_[A-Za-z0-9_]+)/)![1];
  const mode = sessionId.startsWith("cs_live_") ? "live" : "test";
  const providerCreate = vi.fn().mockResolvedValue({
    id: sessionId, url, status: "open", payment_status: "unpaid",
    payment_intent: null, expires_at: 1900000000,
  });
  const authority = vi.fn();
  const db = Object.freeze({ syntheticOnly: true });
  const company = Object.freeze({ companyId: 9, userId: 42, role: "owner" });
  const selectConnect = vi.fn(() => ({ checkout: { sessions: { create: providerCreate } } }));
  const sandbox = createContext({
    URL, assertProductionConnectPaymentsAllowed: vi.fn(), stripeConnectClientForMode: selectConnect,
    stripeModeForIntegration: () => "test", publicOrigin: () => ORIGIN,
    mobileCompany: vi.fn(async () => ({ company, db })),
    requireManager: vi.fn(), createCompanyJobCheckout: authority, mobileRequestOrigin: () => ORIGIN,
    // Error mapping is a mocked route boundary, not a claimed backend authorization test.
    operationalError: (res: any, error: any) => res.status(409).json({ error: { code: "CONFLICT", message: error.message } }),
  });
  const source = BACKEND_SOURCE.replace(/^export\s+/gm, "");
  runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, sandbox);
  const project = (checkoutState = "open", reused = false, amountCents = "100", projectedUrl: string | null = url, attemptStatus = "pending") => {
    const result = sandbox.checkoutResult({
      id: "7", amount_cents: amountCents, platform_fee_cents: "50", status: attemptStatus,
      stripe_checkout_url: projectedUrl, stripe_idempotency_key: "hsc:job-payment-attempt:7",
    }, { checkoutState, reused, url: projectedUrl });
    authority.mockResolvedValue(result);
    return result;
  };
  const prepareOpen = async (reused = false, amountCents = "100") => {
    const session = await sandbox.createStripeConnectJobCheckoutSession({
      accountId: "acct_SyntheticOnly", mode, amountCents: 100, feeCents: 50,
      productName: "Synthetic $1 Job", companyId: 9, jobId: 12, customerId: 41,
      origin: ORIGIN, attemptId: 7, idempotencyKey: "hsc:job-payment-attempt:7",
    });
    expect(session).toMatchObject({ id: sessionId, url, paymentIntentId: null, status: "open", paymentStatus: "unpaid" });
    return project("open", reused, amountCents, session.url);
  };
  let lastWire: any;
  const respond = async () => {
    let status = 0;
    const res = { status: (value: number) => { status = value; return res; }, json: (payload: unknown) => {
      lastWire = payload;
      return { ok: status >= 200 && status < 300, status, json: async () => payload };
    } };
    return sandbox.createMobileJobCheckout({ params: { jobId: "12" }, body: {} }, res);
  };
  return { mode, providerCreate, authority, selectConnect, prepareOpen, project, respond, lastWire: () => lastWire };
}

function harness(backend: ReturnType<typeof backendFixture>, initial = profile()) {
  const actor = normalizeJobSyncMobileSession(initial, TOKEN)!;
  let freshProfile: unknown = initial;
  let freshJob: unknown = job();
  let current = true;
  const states: CompanyCheckoutState[] = [];
  const checkoutRequested = deferred<void>();
  const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.cache).toBe("no-store");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
    if (url === `${ORIGIN}/api/mobile/v1/auth/session` && init.method === "GET") {
      return { ok: true, status: 200, json: async () => freshProfile };
    }
    if (url === `${ORIGIN}/api/mobile/v1/jobs/12` && init.method === "GET") {
      return { ok: true, status: 200, json: async () => ({ job: freshJob }) };
    }
    if (url === `${ORIGIN}/api/mobile/v1/jobs/12/checkout` && init.method === "POST") {
      expect(init.body).toBe("{}");
      checkoutRequested.resolve();
      return backend.respond();
    }
    throw new Error(`Unconfigured network request forbidden: ${init.method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchSpy);
  const openBrowser = vi.fn().mockResolvedValue({ type: "cancel" });
  const onVerifiedDetail = vi.fn();
  // No injected transport: actual signed session, Job detail and checkout adapters + controller.
  const controller = createCompanyJobCheckoutController({
    session: actor, jobId: 12, isCurrent: () => current,
    onState: (state) => states.push(state), onVerifiedDetail, openBrowser,
  });
  const posts = () => fetchSpy.mock.calls.filter(([, init]) => init.method === "POST");
  return { actor, controller, states, openBrowser, onVerifiedDetail, fetchSpy, posts, checkoutRequested,
    last: () => states.at(-1)!, stale: () => { current = false; },
    setProfile: (value: unknown) => { freshProfile = value; }, setJob: (value: unknown) => { freshJob = value; } };
}

beforeEach(() => {
  vi.stubEnv("EXPO_PUBLIC_JOBSYNC_API_BASE_URL", "");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unconfigured network forbidden")));
  vi.stubGlobal("open", vi.fn(() => { throw new Error("Real browser forbidden"); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("official provider response -> exact backend DTO -> actual mobile payment flow", () => {
  it.each([OFFICIAL_URL, LIVE_G_PAY_URL].flatMap((url) => [false, true].flatMap((reused) => ["cancel", "dismiss", "success"].map((browserResult) => ({ url, reused, browserResult })))))("opens the verbatim proven provider path once for $1 = 100 cents (reused=$reused, browser=$browserResult), never a browser-confirmed paid record", async ({ url, reused, browserResult }) => {
    const backend = backendFixture(url); await backend.prepareOpen(reused);
    const h = harness(backend);
    h.openBrowser.mockResolvedValue({ type: browserResult, url: "https://synthetic.invalid/?payment=success" });
    expect(await h.controller.pay()).toBe(true);
    expect(h.posts()).toHaveLength(1);
    expect(h.openBrowser).toHaveBeenCalledTimes(1);
    expect(h.openBrowser).toHaveBeenCalledWith(url);
    expect(backend.lastWire()).toEqual({ checkout: {
      url, amountCents: 100, attemptId: 7, attemptStatus: "pending", checkoutState: "open", reused,
    } });
    expect(Object.keys(h.last().checkout!).sort()).toEqual(["amountCents", "attemptId", "attemptStatus", "checkoutState", "reused", "url"]);
    expect(h.last()).toMatchObject({ phase: "checkout", detail: { amount: 1, balance: 1, paymentStatus: "unpaid" } });
    expect(h.last().message).toContain("closing checkout does not confirm payment");
    expect(h.states.some((state) => state.phase === "paid")).toBe(false);
    expect(backend.providerCreate).toHaveBeenCalledTimes(1);
    expect(backend.selectConnect).toHaveBeenCalledTimes(1);
    expect(backend.selectConnect).toHaveBeenCalledWith(backend.mode);
    expect(backend.providerCreate).toHaveBeenCalledWith(expect.objectContaining({
      mode: "payment", payment_method_types: ["card"],
      line_items: [{ price_data: { currency: "usd", unit_amount: 100, product_data: { name: "Synthetic $1 Job" } }, quantity: 1 }],
      payment_intent_data: { application_fee_amount: 50, metadata: {
        hsc_payment_kind: "job", hsc_company_id: "9", hsc_job_id: "12", hsc_customer_id: "41",
        hsc_connect_account_id: "acct_SyntheticOnly", hsc_job_payment_attempt_id: "7",
      } },
    }), { stripeAccount: "acct_SyntheticOnly", idempotencyKey: "hsc:job-payment-attempt:7" });
    await h.controller.refresh();
    expect(h.posts()).toHaveLength(1); expect(h.openBrowser).toHaveBeenCalledTimes(1);
    expect(globalThis.open).not.toHaveBeenCalled();
  });

  it.each([OFFICIAL_URL, `${OFFICIAL_URL}#fidkdWx%2FToken%2Btail%3D`, OFFICIAL_URL.replaceAll("%2F", "%2f"), LIVE_G_PAY_URL])("keeps the provider path and optional existing fragment unchanged through 201 transport: %s", async (url) => {
    const backend = backendFixture(url); await backend.prepareOpen(); harness(backend);
    const result = await createJobSyncCompanyJobCheckout(TOKEN, 12);
    expect(result).toEqual(backend.lastWire().checkout);
    expect(result.url).toBe(url); expect(result.amountCents).toBe(100);
  });

  it("keeps Node and installed Expo WHATWG URL raw/parsed checks equivalent", () => {
    const require = createRequire(import.meta.url);
    const ExpoURL = require(require.resolve("whatwg-url-minimum", { paths: [require.resolve("expo/package.json")] })).URL;
    const values = [OFFICIAL_URL, `${OFFICIAL_URL}#fidkdWxToken`, OFFICIAL_URL.replace("%2F", "%252F"),
      OFFICIAL_URL.replace("checkout.stripe.com", "checkout.stripe.com:443"), LIVE_G_PAY_URL,
      LIVE_G_PAY_URL.replace("/c/#", "/c/?locale=en#")];
    const expected = values.map(validateCompanyCheckoutUrl);
    vi.stubGlobal("URL", ExpoURL);
    expect(values.map(validateCompanyCheckoutUrl)).toEqual(expected);
    expect(expected).toEqual([values[0], values[1], null, null, values[4], null]);
  });

  it.each(["1", "99", "101"])("does not navigate when a numeric canonical DTO amount %s differs from fresh 100-cent balance", async (amount) => {
    const backend = backendFixture(); await backend.prepareOpen(false, amount); const h = harness(backend);
    expect(await h.controller.pay()).toBe(false); expect(h.posts()).toHaveLength(1);
    expect(h.openBrowser).not.toHaveBeenCalled(); expect(h.states.some((state) => state.phase === "paid")).toBe(false);
    expect(h.last().message).toContain(amount === "1" ? "did not acknowledge" : "balance changed");
  });

  it.each(["processing", "creating"].flatMap((state) => [null, OFFICIAL_URL, LIVE_G_PAY_URL].map((url) => ({ state, url }))))("keeps an existing $state hold (url=$url), including unknown current billing, without browser or a second attempt", async ({ state, url }) => {
    const backend = backendFixture(); backend.project(state, true, "100", url, state);
    const h = harness(backend);
    expect(await h.controller.pay()).toBe(false); expect(h.last().phase).toBe("processing");
    expect(h.last().checkout).toMatchObject({ attemptId: 7, checkoutState: state, reused: true, url });
    await h.controller.pay(); await h.controller.refresh(); await h.controller.pay();
    h.setJob({ ...job(), balance: null, paymentStatus: null });
    await h.controller.refresh(); expect(h.last().phase).toBe("blocked");
    expect(h.controller.hasCheckout()).toBe(true); expect(await h.controller.pay()).toBe(false);
    h.setJob(job()); await h.controller.refresh(); expect(h.last().phase).toBe("processing");
    expect(await h.controller.pay()).toBe(false);
    expect(h.posts()).toHaveLength(1); expect(backend.authority).toHaveBeenCalledTimes(1);
    expect(backend.providerCreate).not.toHaveBeenCalled(); expect(h.openBrowser).not.toHaveBeenCalled();
    expect(h.states.some((value) => value.phase === "paid")).toBe(false);
  });

  it("preserves an uncertain existing backend attempt denial with no automatic retry, replacement or browser", async () => {
    const backend = backendFixture(); backend.authority.mockRejectedValue(new Error("Existing checkout status is uncertain; reconcile the current attempt."));
    const h = harness(backend); expect(await h.controller.pay()).toBe(false);
    await Promise.resolve(); expect(h.posts()).toHaveLength(1); expect(backend.authority).toHaveBeenCalledTimes(1);
    expect(backend.providerCreate).not.toHaveBeenCalled(); expect(h.openBrowser).not.toHaveBeenCalled();
    expect(h.last()).toMatchObject({ phase: "error", message: "Existing checkout status is uncertain; reconcile the current attempt." });
    expect(h.states.some((state) => state.phase === "paid")).toBe(false);
  });

  it("excludes duplicate taps while the actual adapter acknowledgment is pending", async () => {
    const backend = backendFixture(); const acknowledgment = await backend.prepareOpen();
    const gate = deferred<typeof acknowledgment>(); backend.authority.mockReturnValue(gate.promise);
    const h = harness(backend); const first = h.controller.pay(); await h.checkoutRequested.promise;
    expect(await h.controller.pay()).toBe(false); expect(await h.controller.refresh()).toBe(false);
    gate.resolve(acknowledgment); expect(await first).toBe(true);
    expect(h.posts()).toHaveLength(1); expect(h.openBrowser).toHaveBeenCalledTimes(1);
  });

  it.each(["epoch", "token", "Company", "user", "role", "flag"])("drops a repaired URL acknowledgment when originating %s becomes stale", async (change) => {
    const backend = backendFixture(); const acknowledgment = await backend.prepareOpen();
    const gate = deferred<typeof acknowledgment>(); backend.authority.mockReturnValue(gate.promise);
    const h = harness(backend); const first = h.controller.pay(); await h.checkoutRequested.promise;
    const stateCount = h.states.length;
    if (change === "epoch") h.stale();
    if (change === "token") h.actor.token = "rotated-synthetic-token";
    if (change === "Company") h.actor.company!.id = 10;
    if (change === "user") h.actor.user.id = 43;
    if (change === "role") h.actor.user.role = "dispatcher";
    if (change === "flag") h.actor.user.paymentCollectionEnabled = false;
    gate.resolve(acknowledgment); expect(await first).toBe(false);
    expect(h.states).toHaveLength(stateCount); expect(h.openBrowser).not.toHaveBeenCalled(); expect(h.posts()).toHaveLength(1);
  });

  it.each(["Company", "user", "role", "portal"])("rejects fresh %s identity mismatch before checkout POST", async (change) => {
    const backend = backendFixture(); backend.project(); const h = harness(backend); const fresh: any = profile();
    if (change === "Company") fresh.company.id = 10;
    if (change === "user") fresh.user.id = 43;
    if (change === "role") fresh.user.role = "technician";
    if (change === "portal") fresh.accountType = "platform_admin";
    h.setProfile(fresh); expect(await h.controller.pay()).toBe(false);
    expect(h.posts()).toHaveLength(0); expect(backend.authority).not.toHaveBeenCalled(); expect(h.openBrowser).not.toHaveBeenCalled();
  });

  it.each(["technician", "revoked dispatcher", "wrong Job", "wrong Company Job", "unknown billing"])("retains the %s pre-POST lock with the actual signed/detail adapters", async (caseName) => {
    const backend = backendFixture(); backend.project(); const initial = profile();
    if (caseName === "technician") initial.user.role = "technician";
    if (caseName === "revoked dispatcher") initial.user.role = "dispatcher";
    const h = harness(backend, initial);
    if (caseName === "revoked dispatcher") {
      const fresh = structuredClone(initial); fresh.user.paymentCollectionEnabled = false; h.setProfile(fresh);
    }
    if (caseName === "wrong Job") h.setJob({ ...job(), id: 13 });
    if (caseName === "wrong Company Job") h.setJob({ ...job(), companyId: 10 });
    if (caseName === "unknown billing") h.setJob({ ...job(), balance: null, paymentStatus: "unknown" });
    expect(await h.controller.pay()).toBe(false); expect(h.posts()).toHaveLength(0);
    expect(backend.authority).not.toHaveBeenCalled(); expect(backend.providerCreate).not.toHaveBeenCalled(); expect(h.openBrowser).not.toHaveBeenCalled();
  });
});
