import { afterEach, describe, expect, it, vi } from "vitest";
import { getJobSyncCompanyNativePaymentCapabilities } from "../lib/jobsync-mobile-api";
import { companyNativePaymentTransport } from "../lib/company-native-payment-api";
const context = { token: "test-bearer", companyId: 8, jobId: 55, actorId: 10 };
afterEach(() => vi.unstubAllGlobals());
describe("verified native capability route, no guessed payment mutations", () => {
  it("uses the exact existing Company Job route and bearer header with GET only", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ nativeEnabled: false, reason: "backend_migration_pending" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await getJobSyncCompanyNativePaymentCapabilities(context.token, context.jobId)).toEqual({ nativeEnabled: false, reason: "backend_migration_pending" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/mobile/v1/jobs/55/native-payment/capabilities"); expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-bearer" }); expect(init.body).toBeUndefined();
  });
  it.each([0, -1, 1.5, NaN])("denies invalid Job %s before any request", async (id) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(getJobSyncCompanyNativePaymentCapabilities(context.token, id)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([false, true])("does not unlock an unverified lifecycle even if a raw response claims enabled=%s", async (enabled) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ nativeEnabled: enabled }), { status: 200 })); vi.stubGlobal("fetch", fetch);
    await expect(companyNativePaymentTransport.capabilities(context)).rejects.toThrow("setup is not verified");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("never guesses quote, signature, prepare, confirmation or recovery requests", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const api = companyNativePaymentTransport;
    const input = {} as never;
    await expect(api.quote(context, input)).rejects.toThrow();
    await expect(api.approveSignature(context, input)).rejects.toThrow();
    await expect(api.prepare(context, input)).rejects.toThrow();
    await expect(api.authorizeConfirmation(context, input)).rejects.toThrow();
    await expect(api.status(context, "hsc-native-test-key")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
