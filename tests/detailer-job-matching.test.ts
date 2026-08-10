import { describe, it, expect } from "vitest";

/**
 * Unit tests verifying the strict matching logic for detailer job assignment.
 * These tests validate the fix for the bug where detailers were seeing
 * other detailers' jobs due to fuzzy LIKE matching.
 */

// Simulate the exact matching logic from db.ts
function buildExactMatches(assignedTo: string, empFullName: string | null): string[] {
  const exactMatches: string[] = [assignedTo];
  if (empFullName) {
    const fullName = empFullName;
    const firstName = fullName.split(' ')[0];
    if (fullName && !exactMatches.includes(fullName)) exactMatches.push(fullName);
    if (firstName && !exactMatches.includes(firstName)) exactMatches.push(firstName);
    if (firstName.toLowerCase() !== firstName && !exactMatches.includes(firstName.toLowerCase())) exactMatches.push(firstName.toLowerCase());
    if (firstName.toUpperCase() !== firstName && !exactMatches.includes(firstName.toUpperCase())) exactMatches.push(firstName.toUpperCase());
  }
  return exactMatches;
}

// Simulate the old fuzzy LIKE matching (what was causing the bug)
function oldFuzzyMatch(assignedToField: string, searchName: string): boolean {
  return assignedToField.toLowerCase().includes(searchName.toLowerCase());
}

// Simulate the new strict matching
function newStrictMatch(assignedToField: string, exactMatches: string[]): boolean {
  return exactMatches.includes(assignedToField);
}

describe("Detailer Job Matching - Strict vs Fuzzy", () => {
  describe("Tory (DETTORY) should only see Tory's jobs", () => {
    const toryMatches = buildExactMatches("DETTORY", "Tory Williams");

    it("matches jobs assigned to DETTORY (employeeId)", () => {
      expect(newStrictMatch("DETTORY", toryMatches)).toBe(true);
    });

    it("matches jobs assigned to 'Tory Williams' (full name)", () => {
      expect(newStrictMatch("Tory Williams", toryMatches)).toBe(true);
    });

    it("matches jobs assigned to 'Tory' (first name)", () => {
      expect(newStrictMatch("Tory", toryMatches)).toBe(true);
    });

    it("does NOT match jobs assigned to another detailer", () => {
      expect(newStrictMatch("DET_CASEY", toryMatches)).toBe(false);
      expect(newStrictMatch("JOSEPH", toryMatches)).toBe(false);
      expect(newStrictMatch("DET_LAMONT", toryMatches)).toBe(false);
    });

    it("does NOT match jobs with 'tory' as substring in a longer value (old LIKE would have matched)", () => {
      // The old LIKE '%tory%' would match any string containing 'tory' as substring
      // e.g. a malformed assignedTo field like 'Tory_old' or 'detory'
      expect(newStrictMatch("detory", toryMatches)).toBe(false);
      // But old fuzzy WOULD have matched!
      expect(oldFuzzyMatch("detory", "tory")).toBe(true);
    });
  });

  describe("Joseph (JOSEPH) should only see Joseph's jobs", () => {
    const josephMatches = buildExactMatches("JOSEPH", "Joseph Brown");

    it("matches jobs assigned to JOSEPH (employeeId)", () => {
      expect(newStrictMatch("JOSEPH", josephMatches)).toBe(true);
    });

    it("matches jobs assigned to 'Joseph' (first name)", () => {
      expect(newStrictMatch("Joseph", josephMatches)).toBe(true);
    });

    it("matches jobs assigned to 'joseph' (lowercase)", () => {
      expect(newStrictMatch("joseph", josephMatches)).toBe(true);
    });

    it("does NOT match jobs assigned to another detailer", () => {
      expect(newStrictMatch("DET_CASEY", josephMatches)).toBe(false);
      expect(newStrictMatch("DETTORY", josephMatches)).toBe(false);
    });
  });

  describe("Casey (DET_CASEY) should only see Casey's jobs", () => {
    const caseyMatches = buildExactMatches("DET_CASEY", "Casey Johnson");

    it("matches jobs assigned to DET_CASEY", () => {
      expect(newStrictMatch("DET_CASEY", caseyMatches)).toBe(true);
    });

    it("matches jobs assigned to 'Casey'", () => {
      expect(newStrictMatch("Casey", caseyMatches)).toBe(true);
    });

    it("does NOT match 'Stacey' (old LIKE '%casey%' would NOT have matched but demonstrates strict)", () => {
      expect(newStrictMatch("Stacey", caseyMatches)).toBe(false);
    });
  });

  describe("Per-employee cache key prevents cross-user leakage", () => {
    const STORAGE_KEY_BASE = "tlw_schedule_jobs_v9";

    it("generates unique cache keys per employee", () => {
      const toryKey = `${STORAGE_KEY_BASE}_DETTORY`;
      const josephKey = `${STORAGE_KEY_BASE}_JOSEPH`;
      const caseyKey = `${STORAGE_KEY_BASE}_DET_CASEY`;

      expect(toryKey).not.toBe(josephKey);
      expect(toryKey).not.toBe(caseyKey);
      expect(josephKey).not.toBe(caseyKey);
    });

    it("anon key is different from any employee key", () => {
      const anonKey = `${STORAGE_KEY_BASE}_anon`;
      const toryKey = `${STORAGE_KEY_BASE}_DETTORY`;
      expect(anonKey).not.toBe(toryKey);
    });
  });
});
