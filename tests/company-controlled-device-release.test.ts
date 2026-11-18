import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe("authorized internal device build availability, not Company/payment authority", () => {
  it.each([undefined, "", "true", "1", "80c059cd:old-backend:20261118", "80c059cd:b29f99b5:20261117"])("ordinary or unpinned build %s stays closed", async value => {
    vi.stubEnv("EXPO_PUBLIC_HSC_CONTROLLED_DEVICE_TESTING", value); vi.resetModules();
    const gate = await import("../lib/company-verified-contract-release");
    expect(gate.companyRecurrenceReleaseReady()).toBe(false);
    expect(gate.companyInvoiceOperationReleaseReady()).toBe(false);
    expect(() => gate.assertCompanyVerifiedContractRelease("recurrence")).toThrow("Nothing was submitted");
    expect(() => gate.assertCompanyVerifiedContractRelease("invoice")).toThrow("No new invoice operation was submitted");
  });
  it("the exact owner-authorized testing build can use repaired recurrence and GET recovery without a public release", async () => {
    vi.stubEnv("EXPO_PUBLIC_HSC_CONTROLLED_DEVICE_TESTING", "80c059cd:b29f99b5:20261118"); vi.resetModules();
    const gate = await import("../lib/company-verified-contract-release");
    expect(gate.companyRecurrenceReleaseReady()).toBe(true);
    expect(gate.companyInvoiceOperationReleaseReady()).toBe(true);
    expect(gate.COMPANY_VERIFIED_CONTRACT_RELEASE).toMatchObject({ recurrenceDeployed: false, recurrenceMigrationVerified: false, invoiceOperationsDeployed: false });
    expect(() => gate.assertCompanyVerifiedContractRelease("recurrence")).not.toThrow();
    expect(() => gate.assertCompanyVerifiedContractRelease("invoice")).not.toThrow();
  });
  it("the internal availability marker is not read by native payment transport or Company authorization", () => {
    const native = readFileSync("lib/company-native-payment-api.ts", "utf8");
    expect(native).not.toContain("HSC_CONTROLLED_DEVICE_TESTING");
    expect(native).toContain("NativeCheckoutUnavailableError");
    const fieldwork = readFileSync("lib/company-job-fieldwork.ts", "utf8");
    expect(fieldwork).not.toContain("HSC_CONTROLLED_DEVICE_TESTING");
    expect(fieldwork).toContain("company");
  });
});
