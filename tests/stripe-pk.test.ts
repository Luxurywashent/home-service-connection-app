import { describe, it, expect } from "vitest";

describe("Stripe publishable key validation", () => {
  it("should have a valid EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY set", () => {
    const pk = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    expect(pk, "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY must be set").toBeTruthy();
    expect(pk!.startsWith("pk_"), "Key must start with pk_live_ or pk_test_").toBe(true);
    console.log("✅ Stripe publishable key is set:", pk!.slice(0, 12) + "...");
  });
});
