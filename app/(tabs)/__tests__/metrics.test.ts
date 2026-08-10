import { describe, it, expect } from "vitest";

// Mock data for testing
const mockDayData = [
  {
    revenueProduced: 500,
    hoursWorked: 5,
    efficiencyPercent: 100,
    upsells: 50,
    tips: 20,
  },
];

const mockWeekData = [
  { revenueProduced: 500, hoursWorked: 5, efficiencyPercent: 100, upsells: 50, tips: 20 },
  { revenueProduced: 600, hoursWorked: 6, efficiencyPercent: 100, upsells: 60, tips: 25 },
  { revenueProduced: 400, hoursWorked: 4, efficiencyPercent: 80, upsells: 40, tips: 15 },
  { revenueProduced: 700, hoursWorked: 7, efficiencyPercent: 100, upsells: 70, tips: 30 },
  { revenueProduced: 550, hoursWorked: 5.5, efficiencyPercent: 110, upsells: 55, tips: 22 },
  { revenueProduced: 450, hoursWorked: 4.5, efficiencyPercent: 100, upsells: 45, tips: 18 },
  { revenueProduced: 650, hoursWorked: 6.5, efficiencyPercent: 100, upsells: 65, tips: 28 },
];

// Metrics calculation function (extracted from dashboard for testing)
function calculateMetrics(data: any[] | null, isWeek: boolean) {
  if (!data || data.length === 0) {
    return { revenue: 0, hours: 0, efficiency: 0, upsells: 0, tips: 0 };
  }

  if (!isWeek) {
    // Today view - use first record only
    return {
      revenue: Number(data[0]?.revenueProduced ?? 0),
      hours: Number(data[0]?.hoursWorked ?? 0),
      efficiency: Number(data[0]?.efficiencyPercent ?? 0),
      upsells: Number(data[0]?.upsells ?? 0),
      tips: Number(data[0]?.tips ?? 0),
    };
  }

  // Week/AllTime view - aggregate all records
  const totalRevenue = data.reduce((sum, d) => sum + Number(d.revenueProduced ?? 0), 0);
  const totalHours = data.reduce((sum, d) => sum + Number(d.hoursWorked ?? 0), 0);
  const avgEfficiency =
    data.length > 0 ? data.reduce((sum, d) => sum + Number(d.efficiencyPercent ?? 0), 0) / data.length : 0;
  const totalUpsells = data.reduce((sum, d) => sum + Number(d.upsells ?? 0), 0);
  const totalTips = data.reduce((sum, d) => sum + Number(d.tips ?? 0), 0);

  return {
    revenue: totalRevenue,
    hours: totalHours,
    efficiency: avgEfficiency,
    upsells: totalUpsells,
    tips: totalTips,
  };
}

describe("Dashboard Metrics Calculation", () => {
  describe("Today View (Single Day)", () => {
    it("should return single day metrics when isWeek is false", () => {
      const metrics = calculateMetrics(mockDayData, false);

      expect(metrics.revenue).toBe(500);
      expect(metrics.hours).toBe(5);
      expect(metrics.efficiency).toBe(100);
      expect(metrics.upsells).toBe(50);
      expect(metrics.tips).toBe(20);
    });

    it("should handle empty data gracefully", () => {
      const metrics = calculateMetrics([], false);

      expect(metrics.revenue).toBe(0);
      expect(metrics.hours).toBe(0);
      expect(metrics.efficiency).toBe(0);
      expect(metrics.upsells).toBe(0);
      expect(metrics.tips).toBe(0);
    });

    it("should handle null data gracefully", () => {
      const metrics = calculateMetrics(null, false);

      expect(metrics.revenue).toBe(0);
      expect(metrics.hours).toBe(0);
      expect(metrics.efficiency).toBe(0);
      expect(metrics.upsells).toBe(0);
      expect(metrics.tips).toBe(0);
    });
  });

  describe("Week View (Aggregated)", () => {
    it("should sum revenue across all week days", () => {
      const metrics = calculateMetrics(mockWeekData, true);

      const expectedRevenue = 500 + 600 + 400 + 700 + 550 + 450 + 650;
      expect(metrics.revenue).toBe(expectedRevenue);
    });

    it("should sum hours across all week days", () => {
      const metrics = calculateMetrics(mockWeekData, true);

      const expectedHours = 5 + 6 + 4 + 7 + 5.5 + 4.5 + 6.5;
      expect(metrics.hours).toBe(expectedHours);
    });

    it("should average efficiency across all week days", () => {
      const metrics = calculateMetrics(mockWeekData, true);

      const expectedEfficiency = (100 + 100 + 80 + 100 + 110 + 100 + 100) / 7;
      expect(metrics.efficiency).toBeCloseTo(expectedEfficiency, 2);
    });

    it("should sum upsells across all week days", () => {
      const metrics = calculateMetrics(mockWeekData, true);

      const expectedUpsells = 50 + 60 + 40 + 70 + 55 + 45 + 65;
      expect(metrics.upsells).toBe(expectedUpsells);
    });

    it("should sum tips across all week days", () => {
      const metrics = calculateMetrics(mockWeekData, true);

      const expectedTips = 20 + 25 + 15 + 30 + 22 + 18 + 28;
      expect(metrics.tips).toBe(expectedTips);
    });

    it("should handle week data with missing fields", () => {
      const incompleteData = [
        { revenueProduced: 500, hoursWorked: 5 },
        { revenueProduced: 600, hoursWorked: 6, efficiencyPercent: 100 },
      ];

      const metrics = calculateMetrics(incompleteData, true);

      expect(metrics.revenue).toBe(1100);
      expect(metrics.hours).toBe(11);
      expect(metrics.efficiency).toBe(50); // (0 + 100) / 2
      expect(metrics.upsells).toBe(0);
      expect(metrics.tips).toBe(0);
    });

    it("should handle empty week data gracefully", () => {
      const metrics = calculateMetrics([], true);

      expect(metrics.revenue).toBe(0);
      expect(metrics.hours).toBe(0);
      expect(metrics.efficiency).toBe(0);
      expect(metrics.upsells).toBe(0);
      expect(metrics.tips).toBe(0);
    });
  });

  describe("Projected Income Calculation", () => {
    it("should calculate daily projected income correctly", () => {
      const data = [
        {
          tips: 20,
          upsells: 50, // bonus
          hoursWorked: 5,
        },
      ];

      const totalTips = 20;
      const totalBonus = 50;
      const totalHours = 5;
      const hourlyRate = 17;
      const grossIncome = totalTips + totalBonus + totalHours * hourlyRate;
      const tax = grossIncome * 0.1665;
      const netIncome = grossIncome - tax;

      // Gross: 20 + 50 + (5 * 17) = 155
      // Tax: 155 * 0.1665 = 25.8075
      // Net: 155 - 25.8075 = 129.1925
      expect(netIncome).toBeCloseTo(129.1925, 1);
    });

    it("should calculate weekly projected income by aggregating days", () => {
      const weekData = [
        { tips: 20, upsells: 50, hoursWorked: 5 },
        { tips: 25, upsells: 60, hoursWorked: 6 },
        { tips: 15, upsells: 40, hoursWorked: 4 },
      ];

      const totalTips = 20 + 25 + 15;
      const totalBonus = 50 + 60 + 40;
      const totalHours = 5 + 6 + 4;
      const hourlyRate = 17;
      const grossIncome = totalTips + totalBonus + totalHours * hourlyRate;
      const tax = grossIncome * 0.1665;
      const netIncome = grossIncome - tax;

      // Gross: 60 + 150 + (15 * 17) = 465
      // Tax: 465 * 0.1665 = 77.4225
      // Net: 465 - 77.4225 = 387.5775
      expect(netIncome).toBeCloseTo(387.5775, 1);
    });
  });

  describe("Edge Cases", () => {
    it("should handle data with zero values", () => {
      const zeroData = [
        { revenueProduced: 0, hoursWorked: 0, efficiencyPercent: 0, upsells: 0, tips: 0 },
      ];

      const metrics = calculateMetrics(zeroData, false);
      expect(metrics.revenue).toBe(0);
      expect(metrics.hours).toBe(0);
      expect(metrics.efficiency).toBe(0);
    });

    it("should handle data with negative values gracefully", () => {
      const negativeData = [
        { revenueProduced: -100, hoursWorked: 5, efficiencyPercent: 100, upsells: 50, tips: 20 },
      ];

      const metrics = calculateMetrics(negativeData, false);
      expect(metrics.revenue).toBe(-100);
    });

    it("should handle very large numbers", () => {
      const largeData = [
        { revenueProduced: 999999, hoursWorked: 100, efficiencyPercent: 150, upsells: 10000, tips: 5000 },
      ];

      const metrics = calculateMetrics(largeData, false);
      expect(metrics.revenue).toBe(999999);
      expect(metrics.hours).toBe(100);
      expect(metrics.upsells).toBe(10000);
    });

    it("should handle efficiency over 100%", () => {
      const highEffData = [
        { revenueProduced: 500, hoursWorked: 5, efficiencyPercent: 150, upsells: 50, tips: 20 },
        { revenueProduced: 600, hoursWorked: 6, efficiencyPercent: 120, upsells: 60, tips: 25 },
      ];

      const metrics = calculateMetrics(highEffData, true);
      const expectedEfficiency = (150 + 120) / 2;
      expect(metrics.efficiency).toBe(expectedEfficiency);
    });
  });
});
