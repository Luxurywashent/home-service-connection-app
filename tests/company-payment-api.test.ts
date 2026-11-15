import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createJobSyncCompanyJobCheckout,
  getJobSyncMobileSession,
  JobSyncApiError,
  normalizeJobSyncMobileSession,
  validateCompanyCheckoutUrl,
  type JobSyncCompanyJobCheckout,
} from "../lib/jobsync-mobile-api";

// Synthetic transport only. No provider/API calls, credentials, or device image access.
const ORIGIN = "https://www.homeserviceconnected.com";
const TOKEN = "mock-company-token";
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_Synthetic123";
const CHECKOUT: JobSyncCompanyJobCheckout = {
  url: CHECKOUT_URL, amountCents: 12525, attemptId: 7,
  attemptStatus: "pending", checkoutState: "open", reused: false,
};
const PROFILE = {
  accountType: "company",
  user: { id: 41, name: "Unit Dispatcher", role: "dispatcher" },
  company: { id: 9, name: "Unit Company" },
};
const INVALID_ACK = { name: "JobSyncApiError", code: "INVALID_RESPONSE" };

function response(payload: unknown, status = 201) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}
function stubResponse(payload: unknown, status = 201) {
  const fetchSpy = vi.fn().mockResolvedValue(response(payload, status));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  vi.stubEnv("EXPO_PUBLIC_JOBSYNC_API_BASE_URL", "");
  // Fail closed if any test forgets to configure fetch; never fall through to a live call.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unconfigured mock fetch")));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("signed Company payment collection projection", () => {
  it.each([true, false, null])("preserves actual camelCase Boolean/null %s without touching calendar override", (paymentCollectionEnabled) => {
    for (const calendarEligible of [true, false, null]) {
      const session = normalizeJobSyncMobileSession({ ...PROFILE, user: { ...PROFILE.user, calendarEligible, paymentCollectionEnabled } }, TOKEN)!;
      expect(session.user.paymentCollectionEnabled).toBe(paymentCollectionEnabled);
      expect(Object.hasOwn(session.user, "paymentCollectionEnabled")).toBe(true);
      expect(session.user.calendarEligible).toBe(calendarEligible);
      expect(session.user.role).toBe("dispatcher");
    }
  });

  it.each(["true", "false", "1", "0", 1, 0, "", {}, [], NaN])("rejects malformed signed collection flags without Boolean coercion: %j", (paymentCollectionEnabled) => {
    expect(normalizeJobSyncMobileSession({ ...PROFILE, user: { ...PROFILE.user, paymentCollectionEnabled } }, TOKEN)).toBeNull();
  });

  it.each(["owner", "dispatcher", "technician"])("keeps absent collection unknown for %s and ignores snake_case/role/company hints", (role) => {
    const session = normalizeJobSyncMobileSession({
      ...PROFILE, paymentCollectionEnabled: true,
      user: { ...PROFILE.user, role, payment_collection_enabled: true, canCollectPayments: true },
      company: { ...PROFILE.company, paymentCollectionEnabled: true },
    }, TOKEN)!;
    expect(Object.hasOwn(session.user, "paymentCollectionEnabled")).toBe(false);
    expect(session.user.paymentCollectionEnabled).toBeUndefined();
  });

  it("preserves technician identity even if a signed flag is true, rather than granting role capability", () => {
    const session = normalizeJobSyncMobileSession({ ...PROFILE, user: { ...PROFILE.user, role: "technician", paymentCollectionEnabled: true } }, TOKEN)!;
    expect(session.user.role).toBe("technician");
    expect(session.user.paymentCollectionEnabled).toBe(true);
  });

  it("does not project any Company collection capability onto Platform Admin", () => {
    const session = normalizeJobSyncMobileSession({ accountType: "platform_admin", user: { id: 3, role: "owner", paymentCollectionEnabled: true } }, TOKEN)!;
    expect(session.portal).toBe("platform");
    expect(Object.hasOwn(session.user, "paymentCollectionEnabled")).toBe(false);
  });

  it("rejects malformed calendar override even with a valid signed collection flag", () => {
    expect(normalizeJobSyncMobileSession({ ...PROFILE, user: { ...PROFILE.user, paymentCollectionEnabled: true, calendarEligible: "true" } }, TOKEN)).toBeNull();
  });

  it("reads live collection permission through bearer no-store session without role defaults", async () => {
    const fetchSpy = stubResponse({ ...PROFILE, user: { ...PROFILE.user, paymentCollectionEnabled: false } }, 200);
    expect((await getJobSyncMobileSession(TOKEN)).user.paymentCollectionEnabled).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(`${ORIGIN}/api/mobile/v1/auth/session`, expect.objectContaining({
      method: "GET", cache: "no-store", headers: { Accept: "application/json", Authorization: `Bearer ${TOKEN}` },
    }));
  });
});

describe("Company hosted checkout canonical transport", () => {
  it.each([200, 201])("POSTs only {} at the exact numeric Job path with bearer and projects bounded response on %s", async (status) => {
    const checkout = { ...CHECKOUT, reused: status === 200 };
    const fetchSpy = stubResponse({ checkout: { ...checkout, clientSecret: "never-expose", stripeAccountId: "ignored", paymentId: 99 }, success: true, payment: { paid: true } }, status);
    // Even runtime extra arguments cannot influence Company/account/customer/amount/redirect selection.
    const result = await (createJobSyncCompanyJobCheckout as any)(TOKEN, 47, {
      amount: 1, amountCents: 50, customerId: 99, companyId: 99,
      stripeAccountId: "forged", successUrl: "https://unsafe.test", idempotencyKey: "ignored",
    });
    expect(result).toEqual(checkout);
    expect(Object.keys(result).sort()).toEqual(["amountCents", "attemptId", "attemptStatus", "checkoutState", "reused", "url"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(`${ORIGIN}/api/mobile/v1/jobs/47/checkout`, expect.objectContaining({
      method: "POST", body: "{}", cache: "no-store", signal: expect.any(AbortSignal),
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    }));
  });

  it("preserves existing configured API origin without changing provider URL or adding fallbacks", async () => {
    vi.stubEnv("EXPO_PUBLIC_JOBSYNC_API_BASE_URL", "https://configured.test/");
    const fetchSpy = stubResponse({ checkout: CHECKOUT });
    expect((await createJobSyncCompanyJobCheckout(TOKEN, 47)).url).toBe(CHECKOUT_URL);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://configured.test/api/mobile/v1/jobs/47/checkout");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each(["processing", "creating"] as const)("returns %s with nullable URL as in-progress data, without navigation or manual payment calls", async (checkoutState) => {
    const openURL = vi.fn(); vi.stubGlobal("open", openURL);
    for (const url of [null, CHECKOUT_URL]) {
      const checkout = { ...CHECKOUT, url, checkoutState, attemptStatus: checkoutState, reused: true };
      const fetchSpy = stubResponse({ checkout }, 200);
      await expect(createJobSyncCompanyJobCheckout(TOKEN, 47)).resolves.toEqual(checkout);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe(`${ORIGIN}/api/mobile/v1/jobs/47/checkout`);
      expect(openURL).not.toHaveBeenCalled();
    }
  });

  it.each(["creating", "pending", "processing", "succeeded", "failed", "expired", "canceled"] as const)("preserves only the known attempt enum %s without inventing paid state", async (attemptStatus) => {
    const checkout = { ...CHECKOUT, checkoutState: "processing", url: null, attemptStatus };
    const fetchSpy = stubResponse({ checkout });
    expect((await createJobSyncCompanyJobCheckout(TOKEN, 47)).attemptStatus).toBe(attemptStatus);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([50, Number.MAX_SAFE_INTEGER])("accepts positive safe integer amount and attempt boundaries: %s", async (number) => {
    const checkout = { ...CHECKOUT, amountCents: number, attemptId: number };
    stubResponse({ checkout });
    await expect(createJobSyncCompanyJobCheckout(TOKEN, 47)).resolves.toEqual(checkout);
  });

  it.each([
    null, [], {}, { success: true }, { url: CHECKOUT_URL }, { data: { checkout: CHECKOUT } },
    { checkout: null }, { checkout: [] }, { checkout: {} },
    ...[undefined, null, "12525", 0, -1, 49, 50.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((amountCents) => ({ checkout: { ...CHECKOUT, amountCents } })),
    ...[undefined, null, "7", 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((attemptId) => ({ checkout: { ...CHECKOUT, attemptId } })),
    ...[undefined, null, "paid", "cancelled", "PENDING", 1, [], {}].map((attemptStatus) => ({ checkout: { ...CHECKOUT, attemptStatus } })),
    ...[undefined, null, "paid", "OPEN", 1, [], {}].map((checkoutState) => ({ checkout: { ...CHECKOUT, checkoutState } })),
    ...[undefined, null, "true", "false", 1, 0].map((reused) => ({ checkout: { ...CHECKOUT, reused } })),
    ...[undefined, null, "", "https://unsafe.test/c/pay/cs_test_fake", 1].map((url) => ({ checkout: { ...CHECKOUT, url } })),
    { checkout: { ...CHECKOUT, checkoutState: "processing", url: "javascript:alert(1)" } },
    { checkout: { ...CHECKOUT, checkoutState: "creating", url: undefined } },
  ])("rejects malformed/noncanonical acknowledgment with exactly one request: %j", async (payload) => {
    const fetchSpy = stubResponse(payload);
    await expect(createJobSyncCompanyJobCheckout(TOKEN, 47)).rejects.toMatchObject(INVALID_ACK);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([202, 204, 206])("requires a canonical 200/201 acknowledgment rather than %s", async (status) => {
    const fetchSpy = stubResponse({ checkout: CHECKOUT }, status);
    await expect(createJobSyncCompanyJobCheckout(TOKEN, 47)).rejects.toMatchObject({ ...INVALID_ACK, status });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects unreadable JSON as invalid response without retry", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => { throw new SyntaxError("Malformed JSON"); } });
    vi.stubGlobal("fetch", fetchSpy);
    await expect(createJobSyncCompanyJobCheckout(TOKEN, 47)).rejects.toMatchObject(INVALID_ACK);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("hosted checkout URL defenses", () => {
  it("preserves a validated Stripe hosted payment URL, including a safe query", () => {
    expect(validateCompanyCheckoutUrl(CHECKOUT_URL)).toBe(CHECKOUT_URL);
    const queryUrl = `${CHECKOUT_URL}?locale=en&synthetic=Ab%2B123%3D`;
    expect(validateCompanyCheckoutUrl(queryUrl)).toBe(queryUrl);
  });

  it("preserves Stripe's documented opaque provider fragment through the canonical adapter", async () => {
    // https://docs.stripe.com/api/checkout/sessions/create returns this #fidkdWx... form.
    const url = `${CHECKOUT_URL}#fidkdWxOYHwnPyd1blpxYHZxWjA0SDd%2FM2F8bUA2SDRySkFdUV81T1BSV0YxcWJc`;
    expect(validateCompanyCheckoutUrl(url)).toBe(url);
    const fetchSpy = stubResponse({ checkout: { ...CHECKOUT, url } });
    expect((await createJobSyncCompanyJobCheckout(TOKEN, 47)).url).toBe(url);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    null, undefined, {}, 1, "", "javascript:alert(1)", "data:text/html,unsafe", "file:///c/pay/cs_test_a",
    "http://checkout.stripe.com/c/pay/cs_test_a", "//checkout.stripe.com/c/pay/cs_test_a",
    "https://checkout.stripe.com.evil.test/c/pay/cs_test_a", "https://evilcheckout.stripe.com/c/pay/cs_test_a",
    "https://sub.checkout.stripe.com/c/pay/cs_test_a", "https://checkout.stripe.com./c/pay/cs_test_a",
    "https://checkout.test/c/pay/cs_test_a", "https://evil.test/checkout.stripe.com/c/pay/cs_test_a",
    "https://checkout.stripe.com@evil.test/c/pay/cs_test_a", "https://evil.test@checkout.stripe.com/c/pay/cs_test_a",
    "https://user:pass@checkout.stripe.com/c/pay/cs_test_a", "https://@checkout.stripe.com/c/pay/cs_test_a",
    "https://checkout.stripe.com:443/c/pay/cs_test_a", "https://checkout.stripe.com:8443/c/pay/cs_test_a",
    "https://checkout.stripe.com", "https://checkout.stripe.com/", "https://checkout.stripe.com/c/pay/",
    "https://checkout.stripe.com/c/pay/cs_", "https://checkout.stripe.com/c/pay/not-a-session",
    "https://checkout.stripe.com/pay/cs_test_a", "https://checkout.stripe.com/c/pay/cs_test_a/extra",
    "https://checkout.stripe.com/c/pay/cs_test_a#", "https://checkout.stripe.com/c/pay/cs_test_a#fidkdWx%0AInjected",
    "https://checkout.stripe.com/c/pay/cs_test_a/../cs_test_b", "https://checkout.stripe.com/c/pay/%2e%2e/cs_test_b",
    "https://checkout.stripe.com/c/pay/%252e%252e", "https://checkout.stripe.com/c/pay/cs_test_a%2funsafe",
    "https://checkout.stripe.com/c/pay/cs_test_a%5cunsafe", "https://checkout.stripe.com\\@evil.test/c/pay/cs_test_a",
    "https://checkout.stripe.com//c/pay/cs_test_a", "https:///checkout.stripe.com/c/pay/cs_test_a",
    " https://checkout.stripe.com/c/pay/cs_test_a", "https://checkout.stripe.com/c/pay/cs_test_a\n",
    "https://checkout.stripe.com/c/pay/cs_test_a?x=\r\nInjected", "https://checkout.stripe.com/c/pay/cs_test_a?x=%0AInjected",
    "https://checkout.stripe.com/c/pay/cs_test_a?x=%7f", "https://checkout.stripe.com/c/pay/cs_test_a?x=%GG",
    "https://%63heckout.stripe.com/c/pay/cs_test_a", "https://checkout．stripe.com/c/pay/cs_test_a",
  ])("rejects deceptive/unsafe provider URL and acknowledgment: %j", async (url) => {
    expect(validateCompanyCheckoutUrl(url)).toBeNull();
    const fetchSpy = stubResponse({ checkout: { ...CHECKOUT, url } });
    await expect(createJobSyncCompanyJobCheckout(TOKEN, 47)).rejects.toMatchObject(INVALID_ACK);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("checkout honest failures and no fallback/retry", () => {
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "47", "legacy-job-id", null])("rejects unsafe/non-numeric Job IDs locally: %j", async (id) => {
    const fetchSpy = stubResponse(null);
    await expect(createJobSyncCompanyJobCheckout(TOKEN, id as any)).rejects.toThrow("invalid Job");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(["", " ", "two tokens", "token\r\nInjected", null])("rejects unusable bearer tokens locally: %j", async (token) => {
    const fetchSpy = stubResponse(null);
    await expect(createJobSyncCompanyJobCheckout(token as any, 47)).rejects.toThrow("current Company session");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([[400, "BAD_REQUEST"], [401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [404, "NOT_FOUND"], [409, "CONFLICT"], [503, "UNAVAILABLE"]] as const)("preserves structured backend %s %s without retry/legacy/manual fallback", async (status, code) => {
    const message = status === 409 ? "Checkout is processing; reconcile the current attempt." : "Safe backend denial";
    const fetchSpy = stubResponse({ error: { code, message } }, status);
    await expect(createJobSyncCompanyJobCheckout(TOKEN, 47)).rejects.toMatchObject({ name: "JobSyncApiError", status, code, message });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(`${ORIGIN}/api/mobile/v1/jobs/47/checkout`);
  });

  it("preserves flat and non-JSON HTTP errors without inventing provider readiness", async () => {
    const flat = stubResponse({ error: "Untrusted origin." }, 403);
    await expect(createJobSyncCompanyJobCheckout(TOKEN, 47)).rejects.toMatchObject({ status: 403, code: null, message: "Untrusted origin." });
    expect(flat).toHaveBeenCalledTimes(1);
    const malformed = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError("HTML gateway response"); } });
    vi.stubGlobal("fetch", malformed);
    await expect(createJobSyncCompanyJobCheckout(TOKEN, 47)).rejects.toMatchObject({ status: 502, code: null });
    expect(malformed).toHaveBeenCalledTimes(1);
  });

  it("propagates an ambiguous network failure with no automatic retry", async () => {
    const error = new TypeError("Network request failed");
    const fetchSpy = vi.fn().mockRejectedValue(error); vi.stubGlobal("fetch", fetchSpy);
    await expect(createJobSyncCompanyJobCheckout(TOKEN, 47)).rejects.toBe(error);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retains the defensive 20-second timeout and clears timer without retry", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const assertion = expect(createJobSyncCompanyJobCheckout(TOKEN, 47)).rejects.toMatchObject({ name: "JobSyncApiError", status: null, code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(fetchSpy.mock.calls[0][1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not accept legacy PaymentIntent/paymentUrl acknowledgments", async () => {
    const fetchSpy = stubResponse({ success: true, paymentUrl: CHECKOUT_URL, clientSecret: "legacy", amount: 125.25, paymentId: 7 });
    await expect(createJobSyncCompanyJobCheckout(TOKEN, 47)).rejects.toBeInstanceOf(JobSyncApiError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
