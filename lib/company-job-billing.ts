export type CompanyJobBillingState = {
  balance: number | null;
  paymentStatus: string | null;
  isPaid: boolean | null;
  /** Financial presentation eligibility, not payment authorization or processor support. */
  canCollect: boolean;
};

/** Canonical DTO money is in dollars. Never infer zero from missing or invalid input. */
export function normalizeCompanyJobBillingAmount(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  const amount = typeof value === "number" ? value : Number(value.trim());
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** Backend paymentMath/paymentService expose only these canonical statuses. */
export function normalizeCompanyJobPaymentStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const status = value.trim();
  return ["unpaid", "partial", "paid"].includes(status) ? status : null;
}

/** Use authoritative balance + status, not legacy PaymentRecord or recalculated totals. */
export function getCompanyJobBillingState(input: { balance?: unknown; paymentStatus?: unknown }): CompanyJobBillingState {
  const balance = normalizeCompanyJobBillingAmount(input.balance);
  const paymentStatus = normalizeCompanyJobPaymentStatus(input.paymentStatus);
  const paid = paymentStatus === "paid" && balance === 0;
  const collectible = (paymentStatus === "unpaid" || paymentStatus === "partial") && balance !== null && balance > 0;
  return {
    balance,
    paymentStatus,
    isPaid: paid ? true : collectible ? false : null,
    canCollect: collectible,
  };
}
