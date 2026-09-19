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
} from "@/lib/jobsync-mobile-api";

export const COMPANY_PAYMENT_REFRESH_FAILED =
  "Payment recorded. Unable to refresh current balance.";

export type CompanyPaymentRefreshState = "idle" | "recorded" | "recorded-refresh-failed" | "failed";

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
