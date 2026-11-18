import { describe, expect, it } from "vitest";
import {
  COMPANY_VERIFIED_CONTRACT_RELEASE,
  assertCompanyVerifiedContractRelease,
  companyInvoiceOperationReleaseReady,
  companyRecurrenceReleaseReady,
} from "../lib/company-verified-contract-release";

describe("unpublished Company contracts remain unavailable to production", () => {
  it("records exact source checkpoints without declaring deployment or migration", () => {
    expect(Object.isFrozen(COMPANY_VERIFIED_CONTRACT_RELEASE)).toBe(true);
    expect(COMPANY_VERIFIED_CONTRACT_RELEASE.recurrenceBackendRevision).toBe("fc3bcaa78c6288b705339bd69e2fe1539c779546");
    expect(COMPANY_VERIFIED_CONTRACT_RELEASE.invoiceBackendRevision).toBe("fc3bcaa78c6288b705339bd69e2fe1539c779546");
    expect(COMPANY_VERIFIED_CONTRACT_RELEASE.recurrenceDeployed).toBe(false);
    expect(COMPANY_VERIFIED_CONTRACT_RELEASE.recurrenceMigrationVerified).toBe(false);
    expect(COMPANY_VERIFIED_CONTRACT_RELEASE.invoiceOperationsDeployed).toBe(false);
  });
  it("requires both deployed recurrence support and verified migration", () => {
    expect(companyRecurrenceReleaseReady()).toBe(false);
    expect(() => assertCompanyVerifiedContractRelease("recurrence")).toThrow("awaiting verified backend deployment and migration");
  });
  it("does not confuse invoice source repair with published mobile recovery", () => {
    expect(companyInvoiceOperationReleaseReady()).toBe(false);
    expect(() => assertCompanyVerifiedContractRelease("invoice")).toThrow("No new invoice operation was submitted");
  });
  it("duplicate attempts cannot change release readiness", () => {
    for (let index = 0; index < 10; index++) {
      expect(() => assertCompanyVerifiedContractRelease("recurrence")).toThrow();
      expect(() => assertCompanyVerifiedContractRelease("invoice")).toThrow();
    }
    expect(companyRecurrenceReleaseReady()).toBe(false);
    expect(companyInvoiceOperationReleaseReady()).toBe(false);
  });
});
