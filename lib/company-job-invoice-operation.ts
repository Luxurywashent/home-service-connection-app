import { z } from "zod";
import {
  captureCompanyJobInvoiceIntent,
  normalizeCompanyJobInvoiceRecipientEmail,
  type CompanyJobInvoiceIntent,
  type CompanyJobInvoiceOptions,
} from "./company-job-invoice-intent";

export const COMPANY_INVOICE_OPERATION_REVISION =
  "c24d4a1e5da9d937e68709a76ce2e2336c81b748";
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
}>;
export type CompanyInvoiceOperationIntent = CompanyJobInvoiceIntent &
  Readonly<{
    lifetime: CompanyInvoiceOperationLifetime;
    operationKey: string | null;
  }>;
const keySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const messageId = z.string().min(1).max(256).nullable();
/** Identity failures never carry the unrelated communication's data or message. */
export class CompanyInvoiceOperationConflictError extends Error {
  constructor() {
    super(
      "Invoice operation identity conflicts with this request. Keep the original key and recover with GET only.",
    );
    this.name = "CompanyInvoiceOperationConflictError";
  }
}
/** c24 emits HTTP409/CONFLICT; a typed adapter may use OPERATION_CONFLICT. */
export function isCompanyInvoiceOperationConflict(error: unknown): boolean {
  if (error instanceof CompanyInvoiceOperationConflictError) return true;
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: unknown; code?: unknown };
  return (
    value.status === 409 &&
    (value.code === "CONFLICT" || value.code === "OPERATION_CONFLICT")
  );
}
const lookupSchema = z
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
): CompanyInvoiceOperationLookup {
  const parsed = lookupSchema.safeParse(value);
  const expectedKey = normalizeCompanyInvoiceOperationKey(operationKey);
  // Check a foreign key even when unexpected populated fields make strict DTO
  // parsing fail. Never allow the caller to adopt that communication identity.
  if (
    value &&
    typeof value === "object" &&
    "operationKey" in value &&
    value.operationKey !== expectedKey
  )
    throw new CompanyInvoiceOperationConflictError();
  if (!parsed.success) {
    throw new Error(
      "The invoice operation lookup identity could not be verified. Do not send again.",
    );
  }
  const data = parsed.data;
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
      throw new CompanyInvoiceOperationConflictError();
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
  const expectedKey = normalizeCompanyInvoiceOperationKey(operationKey);
  if (
    value &&
    typeof value === "object" &&
    "operationKey" in value &&
    value.operationKey !== expectedKey
  )
    throw new CompanyInvoiceOperationConflictError();
  if (!parsed.success) {
    throw new Error(
      "The backend did not confirm this invoice operation acknowledgment. Recover with GET only.",
    );
  }
  const data = parsed.data;
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
  return Object.freeze({
    ...intent,
    lifetime: Object.freeze({ ...context.lifetime }),
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
