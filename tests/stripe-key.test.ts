import { describe, it, expect } from "vitest";
import Stripe from "stripe";

describe("Stripe key validation", () => {
  it("should authenticate with Stripe and retrieve account info", async () => {
    const stripeKey = process.env.STRIPE_SK || process.env.STRIPE_SECRET_KEY;
    expect(stripeKey, "STRIPE_SECRET_KEY env var must be set").toBeTruthy();
    const stripe = new Stripe(stripeKey!, { apiVersion: "2025-03-31.basil" });
    // A simple balance retrieve is the lightest possible auth check
    const balance = await stripe.balance.retrieve();
    expect(balance.object).toBe("balance");
    console.log("✅ Stripe key is valid. Available balance:", balance.available.map(b => `${b.amount / 100} ${b.currency.toUpperCase()}`).join(", "));
  }, 15000);
});
