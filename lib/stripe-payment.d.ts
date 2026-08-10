/**
 * Type declarations for the platform-split Stripe payment helper.
 * Metro resolves to .native.ts on iOS/Android and .web.ts on web.
 */

export interface StripePaymentResult {
  success: boolean;
  paymentIntentId?: string;
  errorMessage?: string;
}

export declare function processStripeCardPayment(
  clientSecret: string,
  paymentMethodId?: string
): Promise<StripePaymentResult>;

export declare function processApplePayPayment(
  clientSecret: string,
  totalAmount: number,
  label: string
): Promise<StripePaymentResult>;
