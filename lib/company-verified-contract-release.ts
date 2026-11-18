/**
 * Source/fixture verification is not deployment or migration verification.
 * These contracts are intentionally unavailable to the production application
 * until a separately authorized coordinated backend/mobile release confirms
 * both publication and the required recurrence migration. The owner authorized
 * the pinned internal device build below after production schema verification.
 * This availability setting adds no Company permissions and never enables payments.
 */
const controlledDeviceTesting = process.env.EXPO_PUBLIC_HSC_CONTROLLED_DEVICE_TESTING
  === "80c059cd:b29f99b5:20261118";

export const COMPANY_VERIFIED_CONTRACT_RELEASE = Object.freeze({
  recurrenceBackendRevision: "b29f99b5ea9581a1c5a62271cc5bd979f83df345",
  invoiceBackendRevision: "b29f99b5ea9581a1c5a62271cc5bd979f83df345",
  recurrenceDeployed: false as boolean,
  recurrenceMigrationVerified: false as boolean,
  invoiceOperationsDeployed: false as boolean,
});

export function companyRecurrenceReleaseReady(): boolean {
  return controlledDeviceTesting || (COMPANY_VERIFIED_CONTRACT_RELEASE.recurrenceDeployed
    && COMPANY_VERIFIED_CONTRACT_RELEASE.recurrenceMigrationVerified);
}

export function companyInvoiceOperationReleaseReady(): boolean {
  return controlledDeviceTesting || COMPANY_VERIFIED_CONTRACT_RELEASE.invoiceOperationsDeployed;
}

export function assertCompanyVerifiedContractRelease(kind: "recurrence" | "invoice") {
  if (kind === "recurrence" ? !companyRecurrenceReleaseReady() : !companyInvoiceOperationReleaseReady()) {
    throw new Error(kind === "recurrence"
      ? "Recurring appointments are awaiting verified backend deployment and migration. Nothing was submitted."
      : "Invoice operation recovery is awaiting verified backend deployment. No new invoice operation was submitted.");
  }
}
