export type JobPaymentState = {
  refundedAt?: string;
} | null | undefined;

/** A refunded payment does not settle a job and may be collected again. */
export function shouldShowCollectPayment(payment: JobPaymentState): boolean {
  return !payment || Boolean(payment.refundedAt);
}

export function calculateJobCollectionAmount(
  price: number | undefined,
  upsellTotal: number | undefined,
  discountAmount: number | undefined,
): number {
  return Math.max(0, (price ?? 0) + (upsellTotal ?? 0) - (discountAmount ?? 0));
}
