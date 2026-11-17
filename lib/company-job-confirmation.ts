/**
 * Unpublished backend 2818bb72: Job detail/CREATE's confirmationCommunication.
 * This is NOT the customer's appointment-confirmation status.
 * The backend selects the latest Company/Job/purpose record but does not bind
 * that record to the current start or creation operation. Keep current status
 * unknown for every record; recordStatus is explicitly historical evidence.
 * No recipient, provider message/error text, public token or private note escapes.
 */
export type CompanyJobConfirmationRecordStatus =
  | "accepted" | "failed" | "suppressed" | "queued" | "deferred" | "in_progress" | "unknown";
export type CompanyJobConfirmation = Readonly<{
  status: "suppressed" | "unknown";
  recordStatus: CompanyJobConfirmationRecordStatus;
  communicationId: number | null;
  reason: "operator_opted_out" | "not_attempted" | "outcome_unavailable" | "appointment_binding_unavailable" | "invalid_outcome";
}>;

const statuses: readonly string[] = ["accepted", "failed", "suppressed", "queued", "deferred", "in_progress", "unknown"];
const unknown = (reason: CompanyJobConfirmation["reason"]): CompanyJobConfirmation => Object.freeze({
  status: "unknown", recordStatus: "unknown", communicationId: null, reason,
});
const nullableText = (value: unknown) => value === null || typeof value === "string";

/** Pass only the exact raw job.confirmationCommunication field, never aliases. */
export function normalizeCompanyJobConfirmation(value: unknown, storedNotificationEnabled?: unknown): CompanyJobConfirmation {
  if (value === undefined || value === null) return unknown("outcome_unavailable");
  if (typeof value !== "object" || Array.isArray(value)) return unknown("invalid_outcome");
  const row = value as Record<string, unknown>;
  if (!statuses.includes(row.status as string)
    || !(row.communicationId === null || (typeof row.communicationId === "number" && Number.isSafeInteger(row.communicationId) && row.communicationId > 0))
    || ![row.recipientEmail, row.reason, row.errorCode, row.errorMessage].every(nullableText)) return unknown("invalid_outcome");
  if (row.communicationId === null) {
    // Only an explicit stored preference can establish suppression without a row.
    if (row.status === "suppressed" && row.reason === "operator_opted_out"
      && (storedNotificationEnabled === false || storedNotificationEnabled === 0)
      && row.recipientEmail === null && row.errorCode === null && row.errorMessage === null) {
      return Object.freeze({ status: "suppressed", recordStatus: "suppressed", communicationId: null, reason: "operator_opted_out" });
    }
    if (row.status === "unknown" && ["not_attempted", "outcome_unavailable"].includes(row.reason as string)
      && row.recipientEmail === null && row.errorCode === null && row.errorMessage === null) {
      return unknown(row.reason as "not_attempted" | "outcome_unavailable");
    }
    return unknown("invalid_outcome");
  }
  return Object.freeze({
    status: "unknown", recordStatus: row.status as CompanyJobConfirmationRecordStatus,
    communicationId: row.communicationId, reason: "appointment_binding_unavailable",
  });
}

/** Saved-Job feedback only: never use this to acknowledge creation or authorize resend. */
export function companyJobConfirmationMessage(notifyCustomer: boolean | undefined, confirmation?: CompanyJobConfirmation): string {
  const reminders = "Day-before and same-day reminders are separate and follow Company settings.";
  if (notifyCustomer === false) return `Job saved. Booking confirmation was not requested. ${reminders}`;
  const result = confirmation ?? unknown("outcome_unavailable");
  if (result.status === "suppressed") return `Job saved. Booking confirmation is suppressed by the saved booking preference. ${reminders}`;
  const recordMessages: Record<CompanyJobConfirmationRecordStatus, string> = {
    accepted: "The latest booking email record reports provider acceptance, not verified delivery.",
    failed: "The latest booking email record reports a failure; the Job remains saved.",
    suppressed: "The latest booking email record reports suppression.",
    queued: "The latest booking email record is queued, not confirmed sent.",
    deferred: "The latest booking email record is deferred, not confirmed sent.",
    in_progress: "The latest booking email record is in progress; provider outcome is unknown.",
    unknown: "Booking confirmation outcome is unknown.",
  };
  const binding = result.communicationId !== null ? " Status for this appointment time is unknown." : "";
  return `Job saved. ${recordMessages[result.recordStatus]}${binding} Do not automatically resend or create another Job. ${reminders}`;
}
