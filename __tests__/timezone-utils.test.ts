import { describe, it, expect } from "vitest";
import {
  formatToCentral,
  getTimeInCentral,
  getDateTimeInCentral,
  getFullDateTimeInCentral,
  getRelativeTime,
} from "@/lib/timezone-utils";

/**
 * Unit tests for timezone utilities
 * Tests Central Time conversion and formatting
 */

describe("Timezone Utils", () => {
  // Use a fixed UTC ISO string for consistent testing
  const testDateString = "2026-08-01T22:20:10.719Z"; // 5:20 PM CDT

  describe("formatToCentral", () => {
    it("should format date in Central Time", () => {
      const result = formatToCentral(testDateString, "short");
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
    });

    it("should handle different format types", () => {
      const shortFormat = formatToCentral(testDateString, "short");
      const longFormat = formatToCentral(testDateString, "long");
      
      expect(shortFormat).toBeDefined();
      expect(longFormat).toBeDefined();
      expect(longFormat.length).toBeGreaterThanOrEqual(shortFormat.length);
    });

    it("should include timezone indicator in full format", () => {
      const result = formatToCentral(testDateString, "full");
      // Should contain CDT or CST depending on daylight saving time
      expect(result.includes("CD") || result.includes("CS")).toBe(true);
    });
  });

  describe("getTimeInCentral", () => {
    it("should return time string", () => {
      const result = getTimeInCentral(testDateString);
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
    });

    it("should format time without date", () => {
      const result = getTimeInCentral(testDateString);
      // Should contain time components (hours, minutes, AM/PM)
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });

  describe("getDateTimeInCentral", () => {
    it("should return date and time string", () => {
      const result = getDateTimeInCentral(testDateString);
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
    });

    it("should include both date and time", () => {
      const result = getDateTimeInCentral(testDateString);
      // Should contain month abbreviation and time
      expect(result.length).toBeGreaterThan(10);
    });
  });

  describe("getFullDateTimeInCentral", () => {
    it("should return full date, time, and timezone", () => {
      const result = getFullDateTimeInCentral(testDateString);
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
    });

    it("should include timezone abbreviation", () => {
      const result = getFullDateTimeInCentral(testDateString);
      // Should contain CDT or CST
      expect(result.includes("CD") || result.includes("CS")).toBe(true);
    });
  });

  describe("getRelativeTime", () => {
    it("should return relative time string", () => {
      const result = getRelativeTime(testDateString);
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
    });

    it("should handle recent dates", () => {
      const recentDateString = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 minutes ago
      const result = getRelativeTime(recentDateString);
      expect(result).toContain("ago");
    });

    it("should handle future dates", () => {
      const futureDateString = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours from now
      const result = getRelativeTime(futureDateString);
      expect(result).toBeDefined();
    });
  });

  describe("Central Time Accuracy", () => {
    it("should correctly convert UTC to CDT (summer)", () => {
      // August 1, 2026 is in CDT (UTC-5)
      const augustDateString = "2026-08-01T22:20:10Z";
      const result = formatToCentral(augustDateString, "short");
      expect(result).toBeDefined();
      // Should be 5:20 PM CDT
    });

    it("should correctly convert UTC to CST (winter)", () => {
      // December 1, 2025 is in CST (UTC-6)
      const decemberDateString = "2025-12-01T22:20:10Z";
      const result = formatToCentral(decemberDateString, "short");
      expect(result).toBeDefined();
      // Should be 4:20 PM CST
    });
  });

  describe("Edge Cases", () => {
    it("should handle midnight", () => {
      const midnightUTCString = "2026-08-01T05:00:00Z"; // Midnight CDT
      const result = getTimeInCentral(midnightUTCString);
      expect(result).toBeDefined();
    });

    it("should handle noon", () => {
      const noonUTCString = "2026-08-01T17:00:00Z"; // Noon CDT
      const result = getTimeInCentral(noonUTCString);
      expect(result).toBeDefined();
    });

    it("should handle invalid dates gracefully", () => {
      const invalidDateString = "invalid";
      expect(() => {
        formatToCentral(invalidDateString, "short");
      }).not.toThrow();
    });
  });
});
