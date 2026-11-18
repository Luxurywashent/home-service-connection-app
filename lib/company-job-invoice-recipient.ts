import {
  normalizeCompanyJobInvoiceSentTo,
  type CompanyJobInvoiceIntent,
} from "./company-job-invoice-intent";

/** Exact b29 source/isolated-fixture findings; not a live advertised capability. */
export const COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY = Object.freeze({
  backendRevision: "b29f99b5ea9581a1c5a62271cc5bd979f83df345",
  wireOverrideSupported: true,
  stableInitialReservation: true,
  persistedRecipientAcknowledgment: true,
  durableCommunicationIdentity: true,
  providerUnknownHeldWithoutAutomaticResend: true,
  clientOperationKeySupported: true,
  explicitResendReplaySafe: true,
  authenticatedInvoiceReadbackAvailable: true,
  restartSafeUncertainOperationRecovery: true,
  originalIntentReadbackAvailable: true,
  recoveryRequiresImmutableOriginalEvidence: true,
  legacyUnanchoredJournalsHeld: true,
  smsRestartSafeRecovery: false,
  alternateRecipientSendingEnabled: false,
  reason:
    "Alternate-recipient sending remains disabled pending separately authorized deployment and runtime verification. Pinned b29 source supports email operation keys and authenticated original Company/Job/Customer/recipient/initial-resend recovery only when the original intent was durably captured before POST. Legacy unanchored journals and unknown outcomes remain held, with no automatic resend. SMS has no verified restart-safe mobile recovery. Blank still uses the contact on file.",
});

/** Preserve existing on-file invoices; never silently discard an override. */
export function assertCompanyJobInvoiceRecipientCapability(
  intent: CompanyJobInvoiceIntent,
): void {
  if (
    intent.options.recipientEmail !== undefined &&
    !COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.alternateRecipientSendingEnabled
  ) {
    throw new Error(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.reason);
  }
}

const communicationStates = new Set([
  "queued",
  "sending",
  "provider_accepted",
  "delivered",
  "failed",
  "bounced",
  "complained",
  "suppressed",
  "cancelled",
]);

/** Do not substitute the edited/default email for a backend acknowledgment. */
export function validateCompanyJobInvoiceRecipientReceipt(
  intent: CompanyJobInvoiceIntent,
  value: unknown,
) {
  const receipt =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (
    receipt?.success !== true ||
    typeof receipt.publicUrl !== "string" ||
    !receipt.publicUrl.trim() ||
    receipt.channel !== intent.options.method
  ) {
    throw new Error(
      "The backend did not confirm this invoice request. Review communication history before another attempt.",
    );
  }
  // Supports the existing normalized adapter and exact wire response. A present
  // malformed ledger state is never replaced by the compatibility 'sent' alias.
  const candidate =
    receipt.communicationState !== undefined &&
    receipt.communicationState !== null
      ? receipt.communicationState
      : receipt.communicationState === null
        ? null
        : intent.options.method === "email" && receipt.status === "delivered"
          ? null
          : receipt.status;
  const state =
    typeof candidate === "string" && communicationStates.has(candidate)
      ? candidate
      : null;
  const acknowledgedRecipient = normalizeCompanyJobInvoiceSentTo(
    receipt.sentTo,
    intent.options.method,
  );
  if (intent.options.method === "email" && !acknowledgedRecipient) {
    throw new Error(
      "The backend did not acknowledge a valid invoice recipient. Review communication history before another attempt.",
    );
  }
  // Exact0fbd proves persisted-recipient agreement, but this compatibility
  // projection does not attest the responding server revision or retain its
  // communication ID. Do not certify an unpinned runtime receipt from those
  // source-only findings. Reuse may retain a DIFFERENT persisted recipient.
  return Object.freeze({
    publicUrl: receipt.publicUrl.trim(),
    communicationState: state,
    isDelivered: state === "delivered",
    acknowledgedRecipient,
    actualRecipient: null as string | null,
    recipientVerified: false,
  });
}

export type CompanyJobInvoiceAttempt = Readonly<{
  intent: CompanyJobInvoiceIntent;
  sequence: number;
}>;

type AttemptState = {
  attempted: boolean;
  uncertain: boolean;
  active: CompanyJobInvoiceAttempt | null;
};

/**
 * One manager-screen lifetime; retain across sheet close/open. Not durable
 * backend idempotency or a replacement for existing sheet/session/focus locks.
 * Mark uncertain only after POST starts. There is never an automatic resend.
 */
export function createCompanyJobInvoiceAttemptGuard() {
  const states = new Map<string, AttemptState>();
  let sequence = 0;
  const key = (intent: CompanyJobInvoiceIntent) =>
    JSON.stringify([
      intent.token,
      intent.companyId,
      intent.userId,
      intent.role,
      intent.jobId,
      intent.options.method,
    ]);
  return Object.freeze({
    begin(intent: CompanyJobInvoiceIntent): CompanyJobInvoiceAttempt {
      assertCompanyJobInvoiceRecipientCapability(intent);
      const id = key(intent);
      const state = states.get(id);
      if (state?.active || state?.uncertain) {
        throw new Error(
          "An invoice attempt is pending or its outcome is unknown. Review communication history before sending again.",
        );
      }
      if (state?.attempted && !intent.options.resend) {
        throw new Error(
          "An initial invoice was already attempted. A new send requires an explicit resend choice.",
        );
      }
      const attempt = Object.freeze({ intent, sequence: ++sequence });
      states.set(id, {
        attempted: state?.attempted ?? false,
        uncertain: false,
        active: attempt,
      });
      return attempt;
    },
    markDispatched(attempt: CompanyJobInvoiceAttempt): void {
      const state = states.get(key(attempt.intent));
      if (state?.active !== attempt) {
        throw new Error("The captured invoice attempt is no longer current.");
      }
      state.attempted = true;
      state.uncertain = true;
    },
    finish(
      attempt: CompanyJobInvoiceAttempt,
      outcome: "not_dispatched" | "acknowledged" | "uncertain",
    ): void {
      const state = states.get(key(attempt.intent));
      if (state?.active !== attempt) return;
      state.active = null;
      // A caller cannot clear a dispatched unknown effect using a preflight
      // cancellation label. Only a validated receipt can acknowledge it.
      if (outcome === "acknowledged") state.uncertain = false;
      else if (outcome === "uncertain") state.uncertain = true;
    },
  });
}
