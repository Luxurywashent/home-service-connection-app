/**
 * Web stub for Stripe payment helper.
 * Metro uses this file on web — no Stripe native SDK imported.
 * On web, card payments use plain inputs and are not processed via Stripe SDK.
 */

export interface StripePaymentResult {
  success: boolean;
  paymentIntentId?: string;
  errorMessage?: string;
}

export async function processStripeCardPayment(
  _clientSecret: string,
  _paymentMethodId?: string
): Promise<StripePaymentResult> {
  // Web does not use Stripe native SDK — payment recorded as cash/manual
  return { success: true, paymentIntentId: "web-manual" };
}

export async function processApplePayPayment(
  _clientSecret: string,
  _totalAmount: number,
  _label: string
): Promise<StripePaymentResult> {
  // Apple Pay is not available on web
  return { success: false, errorMessage: "Apple Pay is only available on iOS" };
}
