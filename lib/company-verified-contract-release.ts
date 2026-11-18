/**
 * Source/fixture verification is not deployment or migration verification.
 * These contracts are intentionally unavailable to the production application
 * until a separately authorized coordinated backend/mobile release confirms
 * both publication and the required recurrence migration. No environment flag,
 * server response, recipient edit, or repeated tap activates this gate.
 */
export const COMPANY_VERIFIED_CONTRACT_RELEASE = Object.freeze({
  recurrenceBackendRevision: "fc3bcaa78c6288b705339bd69e2fe1539c779546",
  invoiceBackendRevision: "fc3bcaa78c6288b705339bd69e2fe1539c779546",
  recurrenceDeployed: false as boolean,
  recurrenceMigrationVerified: false as boolean,
  invoiceOperationsDeployed: false as boolean,
});

export function companyRecurrenceReleaseReady(): boolean {
  return COMPANY_VERIFIED_CONTRACT_RELEASE.recurrenceDeployed
    && COMPANY_VERIFIED_CONTRACT_RELEASE.recurrenceMigrationVerified;
}

export function companyInvoiceOperationReleaseReady(): boolean {
  return COMPANY_VERIFIED_CONTRACT_RELEASE.invoiceOperationsDeployed;
}

export function assertCompanyVerifiedContractRelease(kind: "recurrence" | "invoice") {
  if (kind === "recurrence" ? !companyRecurrenceReleaseReady() : !companyInvoiceOperationReleaseReady()) {
    throw new Error(kind === "recurrence"
      ? "Recurring appointments are awaiting verified backend deployment and migration. Nothing was submitted."
      : "Invoice operation recovery is awaiting verified backend deployment. No new invoice operation was submitted.");
  }
}
