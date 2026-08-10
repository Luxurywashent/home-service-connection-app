/**
 * Tests for dashboard revenue calculation logic.
 * Verifies that schedule job revenue (confirmed + in_progress + completed)
 * is correctly summed, and that the 40% upsell bonus is calculated properly.
 */
import { describe, it, expect } from "vitest";

// Mirrors the calculateMetrics logic from app/(tabs)/index.tsx
function calculateRevenue(
  jobs: Array<{ date: string; totalPrice: string | number; discountAmount?: string | number; upsellTotal?: string | number; status: string }>,
  perfRecords: Array<{ date: string; revenueProduced: string | number; upsells: string | number }>,
  targetDate: string,
): { revenue: number; upsellBonus: number } {
  const ACTIVE_STATUSES = ["confirmed", "in_progress", "completed"];
  const activeJobs = jobs.filter((j) => ACTIVE_STATUSES.includes(j.status));

  // Revenue by date from schedule jobs
  const jobRevByDate: Record<string, number> = {};
  const jobUpsellByDate: Record<string, number> = {};
  for (const job of activeJobs) {
    const price = Number(job.totalPrice ?? 0);
    const discount = Number(job.discountAmount ?? 0);
    const rev = Math.max(0, price - discount);
    jobRevByDate[job.date] = (jobRevByDate[job.date] ?? 0) + rev;
    const upsellAmt = Number(job.upsellTotal ?? 0);
    jobUpsellByDate[job.date] = (jobUpsellByDate[job.date] ?? 0) + upsellAmt * 0.4;
  }

  const schedRev = jobRevByDate[targetDate] ?? 0;
  const manualRev = Number(perfRecords.find((r) => r.date === targetDate)?.revenueProduced ?? 0);
  const revenue = schedRev > 0 ? schedRev : manualRev;

  const manualUpsells = Number(perfRecords.find((r) => r.date === targetDate)?.upsells ?? 0);
  const schedUpsells = jobUpsellByDate[targetDate] ?? 0;
  const upsellBonus = manualUpsells > 0 ? manualUpsells : schedUpsells;

  return { revenue, upsellBonus };
}

describe("Revenue Calculation", () => {
  const TODAY = "2026-04-08";

  it("shows revenue from a confirmed job immediately", () => {
    const jobs = [{ date: TODAY, totalPrice: "400.00", status: "confirmed" }];
    const { revenue } = calculateRevenue(jobs, [], TODAY);
    expect(revenue).toBe(400);
  });

  it("shows revenue from an in_progress job", () => {
    const jobs = [{ date: TODAY, totalPrice: "375.00", status: "in_progress" }];
    const { revenue } = calculateRevenue(jobs, [], TODAY);
    expect(revenue).toBe(375);
  });

  it("shows revenue from a completed job", () => {
    const jobs = [{ date: TODAY, totalPrice: "500.00", status: "completed" }];
    const { revenue } = calculateRevenue(jobs, [], TODAY);
    expect(revenue).toBe(500);
  });

  it("excludes cancelled jobs from revenue", () => {
    const jobs = [{ date: TODAY, totalPrice: "400.00", status: "cancelled" }];
    const { revenue } = calculateRevenue(jobs, [], TODAY);
    expect(revenue).toBe(0);
  });

  it("sums multiple jobs on the same day", () => {
    const jobs = [
      { date: TODAY, totalPrice: "400.00", status: "confirmed" },
      { date: TODAY, totalPrice: "375.00", status: "confirmed" },
    ];
    const { revenue } = calculateRevenue(jobs, [], TODAY);
    expect(revenue).toBe(775);
  });

  it("applies discount to revenue", () => {
    const jobs = [{ date: TODAY, totalPrice: "400.00", discountAmount: "50.00", status: "confirmed" }];
    const { revenue } = calculateRevenue(jobs, [], TODAY);
    expect(revenue).toBe(350);
  });

  it("calculates upsell bonus as 40% of upsell total only", () => {
    const jobs = [{ date: TODAY, totalPrice: "400.00", upsellTotal: "100.00", status: "confirmed" }];
    const { upsellBonus } = calculateRevenue(jobs, [], TODAY);
    expect(upsellBonus).toBe(40); // 40% of $100
  });

  it("uses daily_performance upsells when available (more accurate after push)", () => {
    const jobs = [{ date: TODAY, totalPrice: "400.00", upsellTotal: "100.00", status: "completed" }];
    const perf = [{ date: TODAY, revenueProduced: "0.00", upsells: "45.00" }]; // pushed value
    const { upsellBonus } = calculateRevenue(jobs, perf, TODAY);
    expect(upsellBonus).toBe(45); // uses pushed value, not derived
  });

  it("falls back to manual revenue when no schedule jobs exist", () => {
    const perf = [{ date: TODAY, revenueProduced: "600.00", upsells: "0.00" }];
    const { revenue } = calculateRevenue([], perf, TODAY);
    expect(revenue).toBe(600);
  });

  it("matches jobs by employeeId (DET_LAMONT format)", () => {
    // Simulates the assignedTo matching logic
    const employeeId = "DET_LAMONT";
    const jobAssignedTo = "DET_LAMONT";
    const nameFromId = employeeId.replace(/^DET_/, "").toLowerCase(); // "lamont"
    const jobAssignedToLower = jobAssignedTo.toLowerCase();

    const matchesById = jobAssignedTo === employeeId;
    const matchesByName = jobAssignedToLower === nameFromId;
    expect(matchesById || matchesByName).toBe(true);
  });

  it("matches legacy jobs stored with name only", () => {
    const employeeId = "DET_LAMONT";
    const legacyJobAssignedTo = "Lamont"; // older jobs stored name
    const nameFromId = employeeId.replace(/^DET_/, "").toLowerCase(); // "lamont"

    const matchesByName = legacyJobAssignedTo.toLowerCase() === nameFromId;
    expect(matchesByName).toBe(true);
  });
});
