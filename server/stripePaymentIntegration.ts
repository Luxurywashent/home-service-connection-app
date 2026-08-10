import Stripe from "stripe";
import { ENV } from "./_core/env";
import * as db from "./db";
import { loanPayments } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const stripe = new Stripe(ENV.stripeSecretKey || "", {
  apiVersion: "2024-04-10",
});

/**
 * Stripe Payment Integration for Loan Payments
 * Handles payment processing, webhooks, and reconciliation
 */

export interface CreatePaymentIntentParams {
  loanId: string;
  amount: number; // in cents
  currency?: string;
  description?: string;
  metadata?: Record<string, string>;
}

export interface PaymentWebhookData {
  type: string;
  data: {
    object: {
      id: string;
      status: string;
      amount: number;
      currency: string;
      metadata?: Record<string, string>;
    };
  };
}

/**
 * Create a Stripe Payment Intent for a loan payment
 */
export async function createPaymentIntent(params: CreatePaymentIntentParams) {
  try {
    const { loanId, amount, currency = "usd", description, metadata = {} } = params;

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      description: description || `Loan Payment - ${loanId}`,
      metadata: {
        loanId,
        ...metadata,
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    return {
      success: true,
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: paymentIntent.amount,
      status: paymentIntent.status,
    };
  } catch (error) {
    console.error("[Stripe] Error creating payment intent:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Confirm payment and record in database
 */
export async function confirmPayment(paymentIntentId: string) {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== "succeeded") {
      return {
        success: false,
        error: `Payment status is ${paymentIntent.status}, not succeeded`,
      };
    }

    const loanId = paymentIntent.metadata?.loanId;
    if (!loanId) {
      return {
        success: false,
        error: "No loanId in payment metadata",
      };
    }

    // Record payment in database
    const drizzleDb = await db.getDb();
    if (!drizzleDb) {
      return {
        success: false,
        error: "Database connection failed",
      };
    }

    const amountPaid = paymentIntent.amount / 100; // Convert from cents

// @ts-ignore
// @ts-ignore
    const today = new Date().toISOString().split('T')[0];
// @ts-ignore
    await drizzleDb.insert(loanPayments).values({
      paymentId: paymentIntentId,
      loanId,
      amountPaid: Number(amountPaid),
      paidDate: today as any,
      paymentMethod: "stripe",
      notes: `Stripe Payment Intent: ${paymentIntentId}`,
    });

    return {
      success: true,
      paymentId: paymentIntentId,
      amount: amountPaid,
      loanId,
    };
  } catch (error) {
    console.error("[Stripe] Error confirming payment:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Handle Stripe webhook events
 */
export async function handleStripeWebhook(event: PaymentWebhookData) {
  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        console.log("[Stripe] Payment succeeded:", event.data.object.id);
        return await confirmPayment(event.data.object.id);

      case "payment_intent.payment_failed":
        console.log("[Stripe] Payment failed:", event.data.object.id);
        return {
          success: true,
          message: "Payment failed event logged",
        };

      case "charge.refunded":
        console.log("[Stripe] Charge refunded:", event.data.object.id);
        return {
          success: true,
          message: "Refund event logged",
        };

      default:
        console.log("[Stripe] Unhandled event type:", event.type);
        return {
          success: true,
          message: "Event received",
        };
    }
  } catch (error) {
    console.error("[Stripe] Error handling webhook:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Create a setup intent for recurring payments
 */
export async function createSetupIntent(loanId: string) {
  try {
    const setupIntent = await stripe.setupIntents.create({
      payment_method_types: ["card"],
      metadata: {
        loanId,
      },
    });

    return {
      success: true,
      setupIntentId: setupIntent.id,
      clientSecret: setupIntent.client_secret,
    };
  } catch (error) {
    console.error("[Stripe] Error creating setup intent:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Create a subscription for recurring loan payments
 */
export async function createRecurringPaymentSubscription(params: {
  loanId: string;
  customerId: string;
  paymentMethodId: string;
  amount: number; // in cents
  frequency: "weekly" | "biweekly" | "monthly";
}) {
  try {
    const { loanId, customerId, paymentMethodId, amount, frequency } = params;

    // Map frequency to Stripe interval
    const intervalMap = {
      weekly: "week" as const,
      biweekly: "week" as const,
      monthly: "month" as const,
    };

    const interval = intervalMap[frequency];
    const intervalCount = frequency === "biweekly" ? 2 : 1;

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [
        {
          price_data: {
            currency: "usd",
            recurring: {
              interval,
              interval_count: intervalCount,
            },
            unit_amount: amount,
          } as any,
        },
      ],
      default_payment_method: paymentMethodId,
      metadata: {
        loanId,
      },
    });

    return {
      success: true,
      subscriptionId: subscription.id,
      status: subscription.status,
    };
  } catch (error) {
    console.error("[Stripe] Error creating subscription:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get payment history from Stripe
 */
export async function getPaymentHistory(loanId: string) {
  try {
    const paymentIntents = await stripe.paymentIntents.list({
      limit: 100,
    });

    const loanPaymentsList = paymentIntents.data.filter(
      (pi) => pi.metadata?.loanId === loanId && pi.status === "succeeded"
    );

    return {
      success: true,
      payments: loanPaymentsList.map((pi) => ({
        id: pi.id,
        amount: pi.amount / 100,
        currency: pi.currency,
        created: new Date(pi.created * 1000),
        status: pi.status,
      })),
    };
  } catch (error) {
    console.error("[Stripe] Error getting payment history:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Refund a payment
 */
export async function refundPayment(paymentIntentId: string, amount?: number) {
  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amount ? amount * 100 : undefined, // Convert to cents
    });

    return {
      success: true,
      refundId: refund.id,
      amount: refund.amount / 100,
      status: refund.status,
    };
  } catch (error) {
    console.error("[Stripe] Error refunding payment:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
