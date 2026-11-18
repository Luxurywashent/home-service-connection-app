import { z } from "zod";
import {
  captureCompanyJobInvoiceIntent,
  normalizeCompanyJobInvoiceRecipientEmail,
  type CompanyJobInvoiceIntent,
  type CompanyJobInvoiceOptions,
} from "./company-job-invoice-intent";

export const COMPANY_INVOICE_OPERATION_REVISION =
  "b29f99b5ea9581a1c5a62271cc5bd979f83df345";
export const COMPANY_INVOICE_OPERATION_STATES = [
  "queued",
  "provider_started",
  "provider_accepted",
  "delivered",
  "failed",
  "unknown",
  "not_found",
  "temporarily_unavailable",
] as const;
export const COMPANY_INVOICE_COMMUNICATION_STATES = [
  "queued",
  "sending",
  "provider_accepted",
  "delivered",
  "failed",
  "bounced",
  "complained",
  "suppressed",
  "cancelled",
] as const;
export const COMPANY_INVOICE_PROVIDER_STATES = [
  "legacy_unknown",
  "queued",
  "pre_provider",
  "provider_started",
  "provider_accepted",
  "provider_rejected",
  "provider_unknown",
] as const;
export type CompanyInvoiceOperationStatus =
  (typeof COMPANY_INVOICE_OPERATION_STATES)[number];
export type CompanyInvoiceOperationLookup = Readonly<{
  /** Optional only to preserve legacy journal types; b29 wire requires all four. */
  companyId?: number;
  jobId?: number;
  customerId?: number | null;
  intentKind?: "initial" | "resend" | "retry" | null;
  operationKey: string;
  communicationId: number | null;
  recipientEmail: string | null;
  status: CompanyInvoiceOperationStatus;
  communicationState:
    | (typeof COMPANY_INVOICE_COMMUNICATION_STATES)[number]
    | null;
  providerDispatchState:
    | (typeof COMPANY_INVOICE_PROVIDER_STATES)[number]
    | null;
  providerMessageId: string | null;
  attemptCount: number | null;
}>;
export type CompanyInvoiceOperationBody = Readonly<{
  method: "email";
  resend: boolean;
  operationKey: string;
  recipientEmail?: string;
}>;
export type CompanyInvoiceOperationReceipt = Readonly<{
  operationKey: string;
  communicationId: number;
  recipientEmail: string;
  communicationState: (typeof COMPANY_INVOICE_COMMUNICATION_STATES)[number];
  providerMessageId: string | null;
  publicUrl: string;
}>;
export type CompanyInvoiceOperationLifetime = Readonly<{
  sheetEpoch: number;
  focusEpoch: number;
}>;
export type CompanyInvoiceOperationContext = Readonly<{
  session: Parameters<typeof captureCompanyJobInvoiceIntent>[0];
  job: Parameters<typeof captureCompanyJobInvoiceIntent>[1];
  options: CompanyJobInvoiceOptions;
  lifetime: CompanyInvoiceOperationLifetime;
  /** Optional explicitly captured key. Never replace a stored uncertain key. */
  operationKey?: string;
  /** Fresh scoped canonical Customer BEFORE first POST; ignored as recovery expectation. */
  originalCustomerId?: number;
  /** Fresh on-file email BEFORE first POST when no explicit override is supplied. */
  onFileRecipientEmail?: string;
}>;
export type CompanyInvoiceOperationOriginalEvidence = Readonly<{
  customerId: number;
  recipientEmail: string;
  intentKind: "initial" | "resend";
}>;
export type CompanyInvoiceOperationLookupExpectation = Readonly<{
  companyId: number;
  jobId: number;
  customerId?: number;
  recipientEmail?: string;
  intentKind?: "initial" | "resend";
}>;
export type CompanyInvoiceOperationIntent = CompanyJobInvoiceIntent &
  Readonly<{
    lifetime: CompanyInvoiceOperationLifetime;
    operationKey: string | null;
    originalEvidence?: CompanyInvoiceOperationOriginalEvidence;
  }>;
const keySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const messageId = z.string().min(1).max(256).nullable();
const legacyLookupSchema = z
  .object({
    operationKey: keySchema,
    communicationId: id.nullable(),
    recipientEmail: z.string().trim().email().max(320).nullable(),
    status: z.enum(COMPANY_INVOICE_OPERATION_STATES),
    communicationState: z.enum(COMPANY_INVOICE_COMMUNICATION_STATES).nullable(),
    providerDispatchState: z.enum(COMPANY_INVOICE_PROVIDER_STATES).nullable(),
    providerMessageId: messageId,
    attemptCount: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
  })
  .strict();
const lookupSchema = legacyLookupSchema.extend({
  companyId: id,
  jobId: id,
  customerId: id.nullable(),
  intentKind: z.enum(["initial", "resend", "retry"]).nullable(),
});
class InvoiceOperationConflict extends Error {
  readonly code = "CONFLICT";
}
export function isCompanyInvoiceOperationConflict(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const error = value as {
    status?: unknown;
    code?: unknown;
    error?: { code?: unknown };
  };
  return (
    error.status === 409 ||
    error.code === "CONFLICT" ||
    error.error?.code === "CONFLICT"
  );
}
export function normalizeCompanyInvoiceOperationKey(value: unknown): string {
  const parsed = keySchema.safeParse(value);
  if (!parsed.success)
    throw new Error("A stable explicit invoice operation key is required.");
  return parsed.data;
}
/** Exact repaired GET response, not a Job timestamp or finance-list projection. */
export function normalizeCompanyInvoiceOperationLookup(
  value: unknown,
  operationKey: string,
  expected?: CompanyInvoiceOperationLookupExpectation,
): CompanyInvoiceOperationLookup {
  if (isCompanyInvoiceOperationConflict(value))
    throw new InvoiceOperationConflict(
      "Invoice operation identity conflicts. Do not send again.",
    );
  const parsed = lookupSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "The invoice operation lookup identity could not be verified. Do not send again.",
    );
  }
  const data = parsed.data;
  if (
    data.operationKey !== normalizeCompanyInvoiceOperationKey(operationKey) ||
    (expected &&
      (data.companyId !== expected.companyId || data.jobId !== expected.jobId))
  )
    throw new InvoiceOperationConflict(
      "The persisted invoice operation scope or key conflicts.",
    );
  const lookup = normalizePersistedLookupState(data);
  if (!["not_found", "temporarily_unavailable"].includes(data.status)) {
    if (!data.customerId || !data.intentKind)
      throw new Error(
        "The backend did not confirm original Customer and send intent.",
      );
    if (
      expected &&
      ((expected.customerId !== undefined &&
        data.customerId !== expected.customerId) ||
        (expected.intentKind !== undefined &&
          data.intentKind !== expected.intentKind) ||
        (expected.recipientEmail !== undefined &&
          lookup.recipientEmail !== expected.recipientEmail))
    )
      throw new InvoiceOperationConflict(
        "The persisted original invoice intent conflicts.",
      );
  } else if (data.customerId !== null || data.intentKind !== null) {
    throw new InvoiceOperationConflict(
      "An absent invoice operation returned original intent.",
    );
  }
  return lookup;
}
/** Storage-only decoder: never use old eight-field evidence as current GET proof. */
export function normalizeLegacyCompanyInvoiceOperationLookup(
  value: unknown,
  operationKey: string,
): CompanyInvoiceOperationLookup {
  const parsed = legacyLookupSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.operationKey !==
      normalizeCompanyInvoiceOperationKey(operationKey)
  )
    throw new Error(
      "Legacy invoice recovery journal could not be verified. Keep held.",
    );
  return normalizePersistedLookupState(parsed.data);
}
function normalizePersistedLookupState<T extends CompanyInvoiceOperationLookup>(
  data: T,
): T {
  if (
    data.status === "not_found" ||
    data.status === "temporarily_unavailable"
  ) {
    if (
      [
        data.communicationId,
        data.recipientEmail,
        data.communicationState,
        data.providerDispatchState,
        data.providerMessageId,
        data.attemptCount,
      ].some((field) => field !== null)
    ) {
      throw new Error(
        "An absent invoice operation returned conflicting persisted identity.",
      );
    }
  } else {
    if (
      !data.communicationId ||
      !data.recipientEmail ||
      !data.communicationState ||
      !data.providerDispatchState ||
      data.attemptCount === null
    ) {
      throw new Error(
        "The backend did not confirm persisted invoice recipient and communication identity.",
      );
    }
    // This is the repaired service's mapping, with unknown provider boundaries
    // taking precedence over superficially completed communication states.
    const expected =
      data.providerDispatchState === "provider_unknown" ||
      data.providerDispatchState === "legacy_unknown"
        ? "unknown"
        : data.communicationState === "delivered"
          ? "delivered"
          : data.communicationState === "provider_accepted" ||
              data.providerDispatchState === "provider_accepted"
            ? "provider_accepted"
            : ["failed", "bounced", "complained"].includes(
                  data.communicationState,
                ) || data.providerDispatchState === "provider_rejected"
              ? "failed"
              : ["provider_started", "pre_provider"].includes(
                    data.providerDispatchState,
                  ) || data.communicationState === "sending"
                ? "provider_started"
                : data.communicationState === "queued"
                  ? "queued"
                  : "unknown";
    if (expected !== data.status)
      throw new Error(
        "Invoice operation status conflicts with its persisted provider state.",
      );
  }
  return Object.freeze({
    ...data,
    recipientEmail: data.recipientEmail?.toLowerCase() ?? null,
  });
}
/** POST proves an acknowledgment only. GET must independently confirm the key. */
export function normalizeCompanyInvoiceOperationReceipt(
  value: unknown,
  operationKey: string,
): CompanyInvoiceOperationReceipt {
  const parsed = z
    .object({
      success: z.literal(true),
      operationKey: keySchema,
      deliveryId: id.nullable(),
      communicationId: id,
      providerMessageId: messageId,
      status: z.literal("sent"),
      communicationState: z.enum(COMPANY_INVOICE_COMMUNICATION_STATES),
      publicUrl: z.string().url().max(2048),
      sentTo: z.string().trim().email().max(320),
      channel: z.literal("email"),
    })
    .strict()
    .safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "The backend did not confirm this invoice operation acknowledgment. Recover with GET only.",
    );
  }
  const data = parsed.data;
  if (data.operationKey !== normalizeCompanyInvoiceOperationKey(operationKey))
    throw new InvoiceOperationConflict(
      "The invoice acknowledgment belongs to a different operation key.",
    );
  if (new URL(data.publicUrl).protocol !== "https:")
    throw new Error("Invoice acknowledgment link is invalid.");
  return Object.freeze({
    operationKey: data.operationKey,
    communicationId: data.communicationId,
    recipientEmail: data.sentTo.toLowerCase(),
    communicationState: data.communicationState,
    providerMessageId: data.providerMessageId,
    publicUrl: data.publicUrl,
  });
}
export function captureCompanyInvoiceOperationIntent(
  context: CompanyInvoiceOperationContext,
): CompanyInvoiceOperationIntent {
  // Company/user/role/Job/token/options/lifecycle are captured before key creation,
  // storage, or any asynchronous preflight. Tokens remain memory-only.
  const intent = captureCompanyJobInvoiceIntent(
    context.session,
    context.job,
    context.options,
  );
  if (intent.options.method !== "email")
    throw new Error(
      "This backend has no verified SMS invoice operation recovery. Use the existing on-file SMS workflow.",
    );
  if (
    ![context.lifetime?.sheetEpoch, context.lifetime?.focusEpoch].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
  ) {
    throw new Error(
      "A current mounted invoice sheet and focus lifetime are required.",
    );
  }
  let originalEvidence: CompanyInvoiceOperationOriginalEvidence | undefined;
  if (context.originalCustomerId !== undefined) {
    if (!id.safeParse(context.originalCustomerId).success)
      throw new Error(
        "A fresh originating Company Customer is required before invoice dispatch.",
      );
    const recipientEmail =
      intent.options.recipientEmail ??
      normalizeCompanyJobInvoiceRecipientEmail(context.onFileRecipientEmail);
    if (!recipientEmail)
      throw new Error(
        "Capture the original on-file invoice recipient before dispatch.",
      );
    originalEvidence = Object.freeze({
      customerId: context.originalCustomerId,
      recipientEmail,
      intentKind: intent.options.resend ? "resend" : "initial",
    });
  }
  return Object.freeze({
    ...intent,
    lifetime: Object.freeze({ ...context.lifetime }),
    ...(originalEvidence ? { originalEvidence } : {}),
    operationKey:
      context.operationKey === undefined
        ? null
        : normalizeCompanyInvoiceOperationKey(context.operationKey),
  });
}
export function companyInvoiceOperationBody(
  intent: CompanyInvoiceOperationIntent,
  operationKey: string,
): CompanyInvoiceOperationBody {
  return Object.freeze({
    method: "email",
    resend: intent.options.resend,
    operationKey: normalizeCompanyInvoiceOperationKey(operationKey),
    ...(intent.options.recipientEmail
      ? {
          recipientEmail: normalizeCompanyJobInvoiceRecipientEmail(
            intent.options.recipientEmail,
          ),
        }
      : {}),
  });
}
export function companyInvoiceOperationTerminal(
  lookup: CompanyInvoiceOperationLookup,
): boolean {
  return ["provider_accepted", "delivered", "failed"].includes(lookup.status);
}
