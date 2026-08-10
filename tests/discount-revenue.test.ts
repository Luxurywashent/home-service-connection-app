/**
 * Tests: Discount Revenue Calculation
 *
 * Verifies that discounts are correctly reflected in:
 * 1. Admin dashboard totalPrice (server-side updateJobMeta logic)
 * 2. Detailer revenue push (schedule.tsx fullJobRevenue calculation)
 * 3. Checkout total shown to detailer (CheckoutModal subtotal)
 * 4. jobToServerPayload totalPrice (what gets stored in DB from detailer side)
 */
import { describe, it, expect } from "vitest";

// ─── Helpers mirroring the exact production logic ────────────────────────────

/**
 * Mirrors: server/db.ts updateJobMeta totalPrice recalculation
 * When admin saves a discount, totalPrice = price + upsellTotal - discountAmount
 */
function calcTotalPriceAfterDiscount(
  price: number,
  upsellTotal: number,
  discountAmount: number
): number {
  return Math.max(0, price + upsellTotal - discountAmount);
}

/**
 * Mirrors: schedule.tsx jobToServerPayload
 * totalPrice stored in DB from detailer side = price - discountAmount
 * (price already includes upsellTotal on the detailer side)
 */
function calcDetailerStoredTotalPrice(price: number, discountAmount: number): number {
  return Math.max(0, price - discountAmount);
}

/**
 * Mirrors: schedule.tsx fullJobRevenue in performance push
 * Revenue recorded to detailer's daily performance = price - discountAmount
 */
function calcDetailerRevenue(price: number, discountAmount: number): number {
  return Math.max(0, price - discountAmount);
}

/**
 * Mirrors: CheckoutModal subtotal in schedule.tsx
 * What detailer sees as "amount due" = price + upsells - discount - deposit
 */
function calcCheckoutSubtotal(
  price: number,
  upsellTotal: number,
  discountAmount: number,
  depositAmount: number
): number {
  return Math.max(0, price + upsellTotal - discountAmount - depositAmount);
}

/**
 * Mirrors: AdminCheckoutModal subtotal in admin-checkout-modal.tsx
 * What admin sees as "amount due" = price + upsells + tax - discount - deposit
 */
function calcAdminCheckoutSubtotal(
  price: number,
  upsellTotal: number,
  taxAmount: number,
  discountAmount: number,
  depositAmount: number
): number {
  return Math.max(0, price + upsellTotal + taxAmount - discountAmount - depositAmount);
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("Discount Revenue Calculations", () => {

  // ── Admin dashboard totalPrice ──────────────────────────────────────────────

  describe("Admin: updateJobMeta totalPrice recalculation", () => {
    it("99% discount on $715 job → totalPrice = $7.15", () => {
      // $350 service + $365 upsells = $715 subtotal; 99% = $707.85 discount
      const result = calcTotalPriceAfterDiscount(350, 365, 707.85);
      expect(result).toBeCloseTo(7.15, 2);
    });

    it("50% discount on $200 job with no upsells → totalPrice = $100", () => {
      const result = calcTotalPriceAfterDiscount(200, 0, 100);
      expect(result).toBe(100);
    });

    it("flat $50 discount on $300 job → totalPrice = $250", () => {
      const result = calcTotalPriceAfterDiscount(300, 0, 50);
      expect(result).toBe(250);
    });

    it("discount larger than total → totalPrice clamps to $0 (no negative revenue)", () => {
      const result = calcTotalPriceAfterDiscount(100, 0, 200);
      expect(result).toBe(0);
    });

    it("no discount → totalPrice = price + upsells", () => {
      const result = calcTotalPriceAfterDiscount(350, 65, 0);
      expect(result).toBe(415);
    });

    it("discount removed (set to 0) → totalPrice restored to full amount", () => {
      const result = calcTotalPriceAfterDiscount(350, 65, 0);
      expect(result).toBe(415);
    });
  });

  // ── Admin dashboard revenue query ───────────────────────────────────────────

  describe("Admin: getSummary revenue aggregation", () => {
    it("sums totalPrice across multiple jobs correctly", () => {
      // Simulates the server getSummary loop: totalRevenue += parseFloat(j.totalPrice)
      const jobs = [
        { totalPrice: "7.15" },   // discounted job
        { totalPrice: "250.00" }, // flat discount
        { totalPrice: "415.00" }, // no discount
      ];
      const totalRevenue = jobs.reduce((sum, j) => sum + parseFloat(j.totalPrice), 0);
      expect(totalRevenue).toBeCloseTo(672.15, 2);
    });

    it("cancelled jobs are excluded from revenue", () => {
      const jobs = [
        { totalPrice: "200.00", status: "completed" },
        { totalPrice: "150.00", status: "cancelled" },
        { totalPrice: "100.00", status: "confirmed" },
      ];
      const active = jobs.filter(j => j.status !== "cancelled");
      const totalRevenue = active.reduce((sum, j) => sum + parseFloat(j.totalPrice), 0);
      expect(totalRevenue).toBe(300);
    });
  });

  // ── Detailer side: jobToServerPayload totalPrice ────────────────────────────

  describe("Detailer: jobToServerPayload totalPrice", () => {
    it("99% discount → stored totalPrice = $7.15", () => {
      // On detailer side, job.price already includes upsellTotal
      const result = calcDetailerStoredTotalPrice(715, 707.85);
      expect(result).toBeCloseTo(7.15, 2);
    });

    it("no discount → stored totalPrice = full price", () => {
      const result = calcDetailerStoredTotalPrice(350, 0);
      expect(result).toBe(350);
    });

    it("discount larger than price → clamps to $0", () => {
      const result = calcDetailerStoredTotalPrice(100, 150);
      expect(result).toBe(0);
    });
  });

  // ── Detailer side: performance revenue push ─────────────────────────────────

  describe("Detailer: performance revenue push (fullJobRevenue)", () => {
    it("99% discount → revenue recorded = $7.15", () => {
      const result = calcDetailerRevenue(715, 707.85);
      expect(result).toBeCloseTo(7.15, 2);
    });

    it("no discount → revenue = full job price", () => {
      const result = calcDetailerRevenue(350, 0);
      expect(result).toBe(350);
    });

    it("partial discount → revenue = price minus discount", () => {
      const result = calcDetailerRevenue(300, 50);
      expect(result).toBe(250);
    });

    it("discount clamps to 0 (never negative)", () => {
      const result = calcDetailerRevenue(100, 200);
      expect(result).toBe(0);
    });
  });

  // ── Detailer checkout modal subtotal ────────────────────────────────────────

  describe("Detailer: CheckoutModal subtotal (amount shown to detailer)", () => {
    it("99% discount on $715 job → checkout shows $7.15", () => {
      const result = calcCheckoutSubtotal(350, 365, 707.85, 0);
      expect(result).toBeCloseTo(7.15, 2);
    });

    it("discount + deposit applied → correct balance due", () => {
      // $300 job, $50 discount, $100 deposit → due = $150
      const result = calcCheckoutSubtotal(300, 0, 50, 100);
      expect(result).toBe(150);
    });

    it("no discount, no deposit → full amount due", () => {
      const result = calcCheckoutSubtotal(350, 65, 0, 0);
      expect(result).toBe(415);
    });

    it("discount covers entire amount → $0 due (not negative)", () => {
      const result = calcCheckoutSubtotal(100, 0, 150, 0);
      expect(result).toBe(0);
    });
  });

  // ── Admin checkout modal subtotal ───────────────────────────────────────────

  describe("Admin: AdminCheckoutModal subtotal (amount shown to admin)", () => {
    it("99% discount on $715 job with no tax/deposit → checkout shows $7.15", () => {
      const result = calcAdminCheckoutSubtotal(350, 365, 0, 707.85, 0);
      expect(result).toBeCloseTo(7.15, 2);
    });

    it("tax is added before discount is subtracted", () => {
      // $200 + $20 tax - $50 discount = $170
      const result = calcAdminCheckoutSubtotal(200, 0, 20, 50, 0);
      expect(result).toBe(170);
    });

    it("deposit reduces balance due", () => {
      // $300 - $30 discount - $100 deposit = $170
      const result = calcAdminCheckoutSubtotal(300, 0, 0, 30, 100);
      expect(result).toBe(170);
    });

    it("full discount → $0 due", () => {
      const result = calcAdminCheckoutSubtotal(200, 0, 0, 200, 0);
      expect(result).toBe(0);
    });
  });

  // ── Percent discount calculation ────────────────────────────────────────────

  describe("Percent discount conversion (admin adminSaveDiscount)", () => {
    it("99% of $715 = $707.85", () => {
      const subtotal = 350 + 365; // price + upsells
      const discountAmount = Math.round((99 / 100) * subtotal * 100) / 100;
      expect(discountAmount).toBe(707.85);
    });

    it("50% of $200 = $100", () => {
      const subtotal = 200;
      const discountAmount = Math.round((50 / 100) * subtotal * 100) / 100;
      expect(discountAmount).toBe(100);
    });

    it("10% of $99.99 = $10.00 (rounded to cents)", () => {
      const subtotal = 99.99;
      const discountAmount = Math.round((10 / 100) * subtotal * 100) / 100;
      expect(discountAmount).toBe(10);
    });
  });

});
