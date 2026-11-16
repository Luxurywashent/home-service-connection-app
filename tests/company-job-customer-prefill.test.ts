import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/company-job-creation-storage", async () => {
  const { memoryCreationStorageModule } = await import("./helpers/company-creation-memory-store");
  return memoryCreationStorageModule();
});
import { parseCompanyJobCustomerPrefill, verifyCompanyJobCustomerPrefill } from "../lib/company-job-customer-prefill";
import type { CompanyJobPrefillTransport } from "../lib/company-job-customer-prefill";
import type { JobSyncNativeSession } from "../lib/jobsync-mobile-api";
const actor: JobSyncNativeSession = { token: "prefill-local-fixture", portal: "company", user: { id: 14, name: "Owner", email: null, role: "owner" }, company: { id: 9, name: "Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } };
const customer = { id: 7, name: "Verified Customer", firstName: "Verified", lastName: "Customer", email: "customer@example.invalid", phone: null, addressLine1: "Canonical Address", city: "Fixture City", region: "FL", postalCode: "32501" };
afterEach(() => vi.unstubAllGlobals());
describe("Company Add Job canonical prefill candidates", () => {
  it("accepts exact positive safe numeric IDs and canonical decimal route strings", () => {
    expect(parseCompanyJobCustomerPrefill("7", "9")).toEqual({ customerId: 7, companyId: 9 });
    expect(parseCompanyJobCustomerPrefill(7, 9)).toEqual({ customerId: 7, companyId: 9 });
  });
  it.each([null, undefined, "Actual Customer", "5551234567@example.invalid", "jobsync-7", "7.0", "1e2", " 7", "07", "0", -7, 7.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, ["7"], {}])("does not infer a canonical ID from %j", (value) => {
    expect(parseCompanyJobCustomerPrefill(value, 9)).toBeNull();
    expect(parseCompanyJobCustomerPrefill(7, value)).toBeNull();
  });
  it("fresh session and exact bearer detail establish selection, with no create action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live network forbidden")));
    const api: CompanyJobPrefillTransport = { session: vi.fn().mockResolvedValue(actor), customer: vi.fn().mockResolvedValue(customer) };
    expect(await verifyCompanyJobCustomerPrefill(actor, { customerId: 7, companyId: 9 }, () => true, api)).toEqual(customer);
    expect(api.session).toHaveBeenCalledWith(actor.token); expect(api.customer).toHaveBeenCalledWith(actor.token, 7);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects wrong-Company provenance before any customer/profile request", async () => {
    const api: CompanyJobPrefillTransport = { session: vi.fn(), customer: vi.fn() };
    await expect(verifyCompanyJobCustomerPrefill(actor, { customerId: 7, companyId: 99 }, () => true, api)).rejects.toThrow("current Company");
    expect(api.session).not.toHaveBeenCalled(); expect(api.customer).not.toHaveBeenCalled();
  });
  it.each(["token", "company", "user", "role", "portal"])("rejects a changed signed %s before fetching customer detail", async (change) => {
    const signed = { ...actor, user: { ...actor.user }, company: { ...actor.company! } };
    if (change === "token") signed.token = "replaced";
    if (change === "company") signed.company.id = 10;
    if (change === "user") signed.user.id = 15;
    if (change === "role") signed.user.role = "technician";
    if (change === "portal") signed.portal = "platform";
    const api: CompanyJobPrefillTransport = { session: vi.fn().mockResolvedValue(signed), customer: vi.fn() };
    await expect(verifyCompanyJobCustomerPrefill(actor, { customerId: 7, companyId: 9 }, () => true, api)).rejects.toThrow("sign-in changed");
    expect(api.customer).not.toHaveBeenCalled();
  });
  it("does not trust same names/phones when the returned canonical ID differs", async () => {
    const api: CompanyJobPrefillTransport = { session: vi.fn().mockResolvedValue(actor), customer: vi.fn().mockResolvedValue({ ...customer, id: 8 }) };
    await expect(verifyCompanyJobCustomerPrefill(actor, { customerId: 7, companyId: 9 }, () => true, api)).rejects.toThrow("could not be verified");
  });
  it("rejects an explicit different Company in a detail response", async () => {
    const api: CompanyJobPrefillTransport = { session: vi.fn().mockResolvedValue(actor), customer: vi.fn().mockResolvedValue({ ...customer, companyId: 99 }) };
    await expect(verifyCompanyJobCustomerPrefill(actor, { customerId: 7, companyId: 9 }, () => true, api)).rejects.toThrow("could not be verified");
  });
  it("does not publish after scope becomes stale during signed-session or detail reads", async () => {
    let current = true;
    const api: CompanyJobPrefillTransport = { session: vi.fn().mockImplementation(async () => { current = false; return actor; }), customer: vi.fn() };
    expect(await verifyCompanyJobCustomerPrefill(actor, { customerId: 7, companyId: 9 }, () => current, api)).toBeNull();
    expect(api.customer).not.toHaveBeenCalled(); current = true;
    api.session = vi.fn().mockResolvedValue(actor); api.customer = vi.fn().mockImplementation(async () => { current = false; return customer; });
    expect(await verifyCompanyJobCustomerPrefill(actor, { customerId: 7, companyId: 9 }, () => current, api)).toBeNull();
  });
});
