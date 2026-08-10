/**
 * stripe-payment.ts
 * Thin wrapper around @stripe/stripe-react-native confirmPayment.
 * On web or Expo Go it returns a demo-mode result so the rest of the
 * booking flow still works without a real Stripe charge.
 *
 * False-failure guard: after confirmPayment returns an error, we call the
 * server's stripe.getPaymentStatus endpoint to check whether the payment
 * intent actually succeeded before surfacing a failure to the detailer.
 * This prevents "Payment Failed" messages when the charge went through
 * (e.g. 3DS / requires_action edge cases).
 */
import { Platform } from "react-native";
import { getApiBaseUrl } from "@/constants/oauth";

export interface StripePaymentResult {
  success: boolean;
  paymentIntentId?: string;
  errorMessage?: string;
}

/** Statuses Stripe considers a successful / captured charge */
const SUCCEEDED_STATUSES = ["succeeded", "requires_capture", "processing"];

/**
 * Verify the actual status of a payment intent via the server.
 * Uses a direct HTTP fetch so this can be called outside React components.
 * Returns true if the intent is in a succeeded/captured state.
 */
async function verifyPaymentIntentSucceeded(paymentIntentId: string): Promise<boolean> {
  try {
    const baseUrl = getApiBaseUrl();
    // tRPC query via GET with input encoded as JSON in the URL
    const input = encodeURIComponent(JSON.stringify({ paymentIntentId }));
    const url = `${baseUrl}/api/trpc/stripe.getPaymentStatus?input=${input}`;
    const resp = await fetch(url, { method: "GET" });
    if (!resp.ok) return false;
    const json = await resp.json();
    // tRPC response shape: { result: { data: { status: string } } }
    const status = json?.result?.data?.status ?? json?.data?.status ?? "";
    return SUCCEEDED_STATUSES.includes(status);
  } catch {
    // If verification itself fails, don't override the original error
    return false;
  }
}

export async function processStripeCardPayment(
  clientSecret: string,
  paymentMethodId: string,
): Promise<StripePaymentResult> {
  try {
    // Only attempt real Stripe confirm on native non-Expo-Go builds
    const Constants = require("expo-constants").default;
    const isExpoGo = Constants.appOwnership === "expo";
    if (Platform.OS === "web" || isExpoGo) {
      // Demo mode — record the intent without charging
      const id = clientSecret.split("_secret_")[0];
      return { success: true, paymentIntentId: id };
    }

    const { confirmPayment } = require("@stripe/stripe-react-native");
    const { paymentIntent, error } = await confirmPayment(clientSecret, {
      paymentMethodType: "Card",
      paymentMethodData: { paymentMethodId },
    });

    if (error) {
      // Before showing a failure, verify whether the payment intent actually
      // succeeded on Stripe's side (handles 3DS / requires_action edge cases).
      const piId = paymentIntent?.id ?? clientSecret.split("_secret_")[0];
      const actuallySucceeded = await verifyPaymentIntentSucceeded(piId);
      if (actuallySucceeded) {
        console.log(`[stripe-payment] confirmPayment returned error but PI ${piId} is succeeded — treating as success`);
        return { success: true, paymentIntentId: piId };
      }
      return { success: false, errorMessage: error.message };
    }
    return { success: true, paymentIntentId: paymentIntent?.id };
  } catch (e: any) {
    return { success: false, errorMessage: e?.message ?? "Payment failed." };
  }
}

export async function processApplePayPayment(
  clientSecret: string,
  totalAmount: number,
  label: string,
): Promise<StripePaymentResult> {
  try {
    const Constants = require("expo-constants").default;
    const isExpoGo = Constants.appOwnership === "expo";
    if (Platform.OS === "web" || isExpoGo) {
      const id = clientSecret.split("_secret_")[0];
      return { success: true, paymentIntentId: id };
    }
    const { presentApplePay, confirmApplePayPayment } = require("@stripe/stripe-react-native");
    const { error: presentError } = await presentApplePay({
      cartItems: [{ label, amount: totalAmount.toFixed(2), paymentType: "Immediate" }],
      country: "US",
      currency: "USD",
    });
    if (presentError) {
      return { success: false, errorMessage: presentError.message };
    }
    const { error: confirmError } = await confirmApplePayPayment(clientSecret);
    if (confirmError) {
      // Same false-failure guard for Apple Pay
      const piId = clientSecret.split("_secret_")[0];
      const actuallySucceeded = await verifyPaymentIntentSucceeded(piId);
      if (actuallySucceeded) {
        console.log(`[stripe-payment] Apple Pay confirmError but PI ${piId} is succeeded — treating as success`);
        return { success: true, paymentIntentId: piId };
      }
      return { success: false, errorMessage: confirmError.message };
    }
    const id = clientSecret.split("_secret_")[0];
    return { success: true, paymentIntentId: id };
  } catch (e: any) {
    return { success: false, errorMessage: e?.message ?? "Apple Pay failed." };
  }
}
