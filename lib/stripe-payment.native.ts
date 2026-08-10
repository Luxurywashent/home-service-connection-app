/**
 * Native-only Stripe payment helper.
 * Metro uses this file on iOS/Android only — never on web.
 *
 * Detects Expo Go via Constants.appOwnership and skips the Stripe native
 * module entirely in that environment (OnrampSdk is not in the Expo Go binary).
 */
import Constants from "expo-constants";

export interface StripePaymentResult {
  success: boolean;
  paymentIntentId?: string;
  errorMessage?: string;
}

// Detect Expo Go: appOwnership is "expo" when running inside the Expo Go app
const isExpoGo = Constants.appOwnership === "expo";

export async function processApplePayPayment(
  clientSecret: string,
  totalAmount: number,
  label: string
): Promise<StripePaymentResult> {
  if (isExpoGo) {
    return { success: true, paymentIntentId: "expo-go-apple-pay-demo" };
  }
  try {
    const { initPaymentSheet, presentPaymentSheet } = require("@stripe/stripe-react-native");
    const { error: initError } = await initPaymentSheet({
      paymentIntentClientSecret: clientSecret,
      merchantDisplayName: "Luxury Wash on Wheels",
      applePay: {
        merchantCountryCode: "US",
      },
      defaultBillingDetails: {},
    });
    if (initError) {
      return { success: false, errorMessage: initError.message || "Apple Pay setup failed" };
    }
    const { error: presentError } = await presentPaymentSheet();
    if (presentError) {
      if (presentError.code === "Canceled") {
        return { success: false, errorMessage: "Payment cancelled" };
      }
      return { success: false, errorMessage: presentError.message || "Apple Pay failed" };
    }
    // Extract paymentIntentId from clientSecret (format: pi_xxx_secret_yyy)
    const paymentIntentId = clientSecret.split("_secret_")[0];
    return { success: true, paymentIntentId };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, errorMessage: msg };
  }
}

export async function processStripeCardPayment(
  clientSecret: string,
  paymentMethodId?: string
): Promise<StripePaymentResult> {
  if (isExpoGo) {
    // Expo Go does not include the Stripe native binary — record as manual
    return { success: true, paymentIntentId: "expo-go-manual" };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { confirmPayment } = require("@stripe/stripe-react-native");
    // If we have a paymentMethodId (created while CardField was mounted), use it directly.
    // Otherwise fall back to Card type and hope CardField is still mounted (legacy path).
    const paymentMethodData = paymentMethodId
      ? { paymentMethodType: "Card" as const, paymentMethodData: { paymentMethodId } }
      : { paymentMethodType: "Card" as const };
    const { error, paymentIntent } = await confirmPayment(clientSecret, paymentMethodData);
    if (error) {
      return { success: false, errorMessage: error.message || "Payment declined" };
    }
    return { success: true, paymentIntentId: paymentIntent?.id };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, errorMessage: msg };
  }
}
