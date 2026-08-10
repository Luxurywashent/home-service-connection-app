/**
 * Tests for Stripe checkout flow logic.
 * Tests the pure calculation functions used in the checkout modal.
 */
import { describe, it, expect } from "vitest";

// ─── Card formatting helpers (mirrored from schedule.tsx) ─────────────────────
const fmtCard = (t: string) =>
  t.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();

const fmtExp = (t: string) => {
  const d = t.replace(/\D/g, "").slice(0, 4);
  return d.length >= 3 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

// ─── Tip calculation (mirrored from schedule.tsx) ────────────────────────────
const calcTip = (subtotal: number, pct: number | null, customStr: string): number => {
  if (pct === null) return 0;
  if (pct === -1) {
    const v = parseFloat(customStr);
    return isNaN(v) || v < 0 ? 0 : Math.round(v * 100) / 100;
  }
  return Math.round(subtotal * pct * 100) / 100;
};

// ─── Payment result helpers ───────────────────────────────────────────────────
const buildPaymentResult = (success: boolean, message: string) => ({ success, message });

describe("Card formatting", () => {
  it("formats 16-digit card number with spaces", () => {
    expect(fmtCard("4242424242424242")).toBe("4242 4242 4242 4242");
  });

  it("strips non-digits", () => {
    expect(fmtCard("4242-4242-4242-4242")).toBe("4242 4242 4242 4242");
  });

  it("truncates to 16 digits", () => {
    expect(fmtCard("42424242424242421234")).toBe("4242 4242 4242 4242");
  });

  it("formats partial card number", () => {
    expect(fmtCard("4242")).toBe("4242");
    expect(fmtCard("42424")).toBe("4242 4");
  });

  it("formats expiry MM/YY", () => {
    expect(fmtExp("1225")).toBe("12/25");
    expect(fmtExp("12")).toBe("12");
    expect(fmtExp("1")).toBe("1");
  });
});

describe("Tip calculation", () => {
  const subtotal = 250;

  it("returns 0 when no tip selected", () => {
    expect(calcTip(subtotal, null, "")).toBe(0);
  });

  it("calculates 15% tip correctly", () => {
    expect(calcTip(subtotal, 0.15, "")).toBe(37.5);
  });

  it("calculates 20% tip correctly", () => {
    expect(calcTip(subtotal, 0.20, "")).toBe(50);
  });

  it("calculates 25% tip correctly", () => {
    expect(calcTip(subtotal, 0.25, "")).toBe(62.5);
  });

  it("handles custom tip amount", () => {
    expect(calcTip(subtotal, -1, "30")).toBe(30);
    expect(calcTip(subtotal, -1, "15.50")).toBe(15.5);
  });

  it("returns 0 for invalid custom tip", () => {
    expect(calcTip(subtotal, -1, "abc")).toBe(0);
    expect(calcTip(subtotal, -1, "-5")).toBe(0);
    expect(calcTip(subtotal, -1, "")).toBe(0);
  });

  it("total = subtotal + tip", () => {
    const tip = calcTip(subtotal, 0.20, "");
    expect(subtotal + tip).toBe(300);
  });
});

describe("Payment result", () => {
  it("builds success result", () => {
    const r = buildPaymentResult(true, "Payment approved");
    expect(r.success).toBe(true);
    expect(r.message).toBe("Payment approved");
  });

  it("builds failure result", () => {
    const r = buildPaymentResult(false, "Your card was declined.");
    expect(r.success).toBe(false);
    expect(r.message).toBe("Your card was declined.");
  });
});

describe("Stripe PaymentIntent amount", () => {
  it("converts dollars to cents correctly", () => {
    expect(Math.round(250 * 100)).toBe(25000);
    expect(Math.round(350.75 * 100)).toBe(35075);
    expect(Math.round(0.99 * 100)).toBe(99);
  });

  it("handles tip in total amount", () => {
    const subtotal = 250;
    const tip = calcTip(subtotal, 0.20, "");
    const total = subtotal + tip;
    const amountCents = Math.round(total * 100);
    expect(amountCents).toBe(30000);
  });
});
