import { z } from "zod";

export type CompanyJobInvoiceMethod = "email" | "sms";
export type CompanyJobInvoiceOptions = Readonly<{
  method: CompanyJobInvoiceMethod;
  resend: boolean;
  /** Omitted uses contact on file; only the verified email route supports it. */
  recipientEmail?: string;
}>;

// This structural subset accepts the existing signed Company session without
// importing the shared transport (or creating a second invoice API).
type InvoiceSession = {
  token: string;
  portal: string;
  company?: { id: number };
  user: { id: number; role: string };
};
type InvoiceJob = { id: number | string; companyId?: number };

export type CompanyJobInvoiceIntent = Readonly<{
  token: string;
  companyId: number;
  userId: number;
  role: "owner" | "dispatcher";
  jobId: number;
  options: CompanyJobInvoiceOptions;
}>;

/** A new sheet starts with initial intent. Resend requires an explicit choice. */
export function createCompanyJobInvoiceOptions(
  method: CompanyJobInvoiceMethod = "email",
  resend: boolean = false,
  recipientEmail?: string,
): CompanyJobInvoiceOptions {
  if ((method !== "email" && method !== "sms") || typeof resend !== "boolean") {
    throw new Error(
      "A valid invoice delivery method and explicit resend choice are required.",
    );
  }
  const recipient = normalizeCompanyJobInvoiceRecipientEmail(recipientEmail);
  if (method === "sms" && recipient !== undefined) {
    throw new Error(
      "An invoice email recipient is only supported for email invoices.",
    );
  }
  // Exact 2818 mobile fields only; never amount, phone override or profile edits.
  return Object.freeze({
    method,
    resend,
    ...(recipient ? { recipientEmail: recipient } : {}),
  });
}

/** Blank editor input means default on-file, not an empty API email field. */
export function normalizeCompanyJobInvoiceRecipientEmail(
  value: unknown,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw new Error("Enter a valid invoice recipient email.");
  if (!value.trim()) return undefined;
  // Match the mobile route's parser, then its service's effective normalization.
  const parsed = z.string().trim().email().max(320).safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Enter a valid invoice recipient email (maximum 320 characters).",
    );
  return parsed.data.toLowerCase();
}

/** Only a valid email receipt is a destination; SMS returns an on-file label. */
export function normalizeCompanyJobInvoiceSentTo(
  value: unknown,
  method: CompanyJobInvoiceMethod,
): string | null {
  if (method !== "email" || typeof value !== "string") return null;
  try {
    return normalizeCompanyJobInvoiceRecipientEmail(value) ?? null;
  } catch {
    return null;
  }
}

function positiveId(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || !/^\d+$/.test(value))
  )
    return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** Capture primitives before the first await; caller retains sheet/focus/locks. */
export function captureCompanyJobInvoiceIntent(
  session: InvoiceSession | null | undefined,
  job: InvoiceJob | null | undefined,
  options: CompanyJobInvoiceOptions,
): CompanyJobInvoiceIntent {
  const jobId = positiveId(job?.id);
  const role = session?.user?.role;
  if (
    session?.portal !== "company" ||
    typeof session.token !== "string" ||
    !session.token.trim() ||
    typeof session.company?.id !== "number" ||
    !positiveId(session.company.id) ||
    typeof session.user?.id !== "number" ||
    !positiveId(session.user.id) ||
    (role !== "owner" && role !== "dispatcher") ||
    !jobId ||
    job?.companyId !== session.company?.id
  ) {
    throw new Error(
      "A signed manager and originating Company Job are required. Reopen the Job before sending.",
    );
  }
  return Object.freeze({
    token: session.token,
    companyId: session.company!.id,
    userId: session.user.id,
    role,
    jobId,
    options: createCompanyJobInvoiceOptions(
      options.method,
      options.resend,
      options.recipientEmail,
    ),
  });
}

/** Must be called after the existing signed session refresh, not instead of it. */
export function assertCompanyJobInvoiceSession(
  intent: CompanyJobInvoiceIntent,
  fresh: InvoiceSession | null | undefined,
): void {
  if (
    fresh?.portal !== "company" ||
    fresh.token !== intent.token ||
    fresh.company?.id !== intent.companyId ||
    fresh.user?.id !== intent.userId ||
    fresh.user?.role !== intent.role
  ) {
    throw new Error(
      "Signed Company identity changed. Reopen the Job before sending.",
    );
  }
}

/** Canonical detail must match the immutable originating Job and Company. */
export function assertCompanyJobInvoiceJob(
  intent: CompanyJobInvoiceIntent,
  detail: { id: number; companyId?: number | null } | null | undefined,
): void {
  if (detail?.id !== intent.jobId || detail?.companyId !== intent.companyId) {
    throw new Error("The originating Company Job is unavailable.");
  }
}
