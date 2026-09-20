import {
  CANONICAL_MANUAL_PAYMENT_METHODS,
  companyCanOpenCanonicalCheckout,
  companyCanRecordCanonicalManualPayment,
  companyCanonicalPaymentWriterAllowed,
  companyCanonicalPaymentWriterMounted,
  type CompanyJobAuthorityMode,
} from "@/lib/jobsync-company-authority";
import {
  createManualPaymentIdempotencyKey,
  sanitizeCompanyPaymentBody,
  type JobSyncManualPaymentMethod,
  type JobSyncMobileJob,
} from "@/lib/jobsync-mobile-api";

export const COMPANY_PAYMENT_REFRESH_FAILED =
  "Payment recorded. Unable to refresh current balance.";

export type CompanyPaymentRefreshState = "idle" | "recorded" | "recorded-refresh-failed" | "failed";

export const CANONICAL_JOB_AR_FIELDS = [
  "paidTotal",
  "refundTotal",
  "appliedEstimateCredit",
  "balance",
  "paymentStatus",
] as const;

export function createCanonicalManualPaymentRequest(input: {
  jobId: number;
  amount: number;
  method: JobSyncManualPaymentMethod;
  idempotencyKey?: string;
}) {
  if (!Number.isSafeInteger(input.jobId) || input.jobId <= 0) {
    throw new Error("A valid Company Job ID is required.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Enter a payment greater than $0.00.");
  }
  if (!CANONICAL_MANUAL_PAYMENT_METHODS.includes(input.method)) {
    throw new Error("Choose a supported payment method.");
  }
  return {
    path: `/api/mobile/v1/jobs/${input.jobId}/payments`,
    body: sanitizeCompanyPaymentBody({
      amount: input.amount,
      method: input.method,
      idempotencyKey: input.idempotencyKey || createManualPaymentIdempotencyKey(),
    }),
  };
}

export function createCanonicalCheckoutRequest(jobId: number) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error("A valid Company Job ID is required.");
  }
  return {
    path: `/api/mobile/v1/jobs/${jobId}/checkout`,
    body: sanitizeCompanyPaymentBody({}),
  };
}

export function nextManualPaymentRefreshState(input: {
  paymentAccepted: boolean;
  refreshSucceeded: boolean;
}): CompanyPaymentRefreshState {
  if (!input.paymentAccepted) return "failed";
  return input.refreshSucceeded ? "recorded" : "recorded-refresh-failed";
}

export function shouldResubmitManualPaymentAfterRefreshFailure() {
  return false;
}

export function shouldMarkJobPaidFromCheckoutBrowserReturn() {
  return false;
}

export function manualPaymentRequestFingerprint(input: {
  jobId: number;
  amount: number;
  method: string;
}) {
  return `${input.jobId}:${input.method}:${Number(input.amount).toFixed(2)}`;
}

export function nextManualPaymentIdempotencyKey(input: {
  existingKey: string | null | undefined;
  jobId: number;
  previousJobId?: number | null;
  fingerprint: string;
  previousFingerprint?: string | null;
  paymentAccepted: boolean;
  createKey?: () => string;
}) {
  const rotateForNewJob = input.previousJobId != null && input.previousJobId !== input.jobId;
  const rotateForChangedPayload = Boolean(input.previousFingerprint)
    && input.previousFingerprint !== input.fingerprint
    && !input.paymentAccepted;
  if (rotateForNewJob || rotateForChangedPayload || !input.existingKey) {
    return (input.createKey ?? createManualPaymentIdempotencyKey)();
  }
  return input.existingKey;
}

export function companyPaymentHistoryIsCanonicalOnly(mode: CompanyJobAuthorityMode) {
  return mode === "company";
}

export function resolveCompanyPaymentActions(input: {
  mode: CompanyJobAuthorityMode;
  role: string | null | undefined;
  jobStatus: string | null | undefined;
  balance: number;
}) {
  const writerMounted = companyCanonicalPaymentWriterMounted(input.mode);
  const canWrite = companyCanonicalPaymentWriterAllowed(input.mode, input.role);
  const hasBalance = Number(input.balance) > 0;
  return {
    writerMounted,
    canWrite,
    canRecordManual: writerMounted && canWrite && hasBalance && companyCanRecordCanonicalManualPayment(input),
    canOpenCheckout: writerMounted && canWrite && hasBalance && companyCanOpenCanonicalCheckout(input),
    manualRequiresCompleted: input.jobStatus !== "completed",
  };
}

export function canonicalJobArSnapshot(job: Pick<JobSyncMobileJob, (typeof CANONICAL_JOB_AR_FIELDS)[number]>) {
  return {
    paidTotal: Number(job.paidTotal || 0),
    refundTotal: Number(job.refundTotal || 0),
    appliedEstimateCredit: Number(job.appliedEstimateCredit || 0),
    balance: Number(job.balance || 0),
    paymentStatus: job.paymentStatus || "unpaid",
  };
}

export function resolveHostedCheckoutOpenUrl(url: string | null | undefined) {
  const value = String(url || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("A secure Checkout link is not available for this Job.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("A secure Checkout link is not available for this Job.");
  }
  return parsed.toString();
}
