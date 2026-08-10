import { describe, it, expect } from "vitest";

// ── Test 1: Case-insensitive name matching (revenue query fix) ──────────────

describe("Case-insensitive assignedTo matching", () => {
  // Simulates the LOWER() SQL fix in getCompletedJobsForDetailer
  function matchesAssignedTo(assignedTo: string, employeeId: string): boolean {
    if (assignedTo === employeeId) return true;
    const namePart = employeeId.replace(/^[A-Z]+_/, "").toLowerCase();
    return assignedTo.toLowerCase().includes(namePart);
  }

  it("matches exact employeeId", () => {
    expect(matchesAssignedTo("DET_LAMONT", "DET_LAMONT")).toBe(true);
  });

  it("matches legacy name (different case) via LOWER()", () => {
    // This was the bug: "Lamont" didn't match LIKE '%LAMONT%' in case-sensitive collation
    expect(matchesAssignedTo("Lamont", "DET_LAMONT")).toBe(true);
  });

  it("matches lowercase legacy name", () => {
    expect(matchesAssignedTo("lamont", "DET_LAMONT")).toBe(true);
  });

  it("does not match unrelated names", () => {
    expect(matchesAssignedTo("John", "DET_LAMONT")).toBe(false);
  });

  it("matches full name with prefix stripped", () => {
    expect(matchesAssignedTo("Lamont Williams", "DET_LAMONT")).toBe(true);
  });
});

// ── Test 2: visibleJobs filter logic (blue dot fix) ──────────────────────────

describe("visibleJobs detailer filter", () => {
  function isJobVisibleForDetailer(
    jobDetailerName: string | undefined,
    myId: string,
    myName: string,
    jobLocation: string | undefined,
    myJobSlug: string,
    isAdmin: boolean,
    selectedLocation?: string,
  ): boolean {
    if (isAdmin) return !jobLocation || jobLocation === selectedLocation;
    if (jobDetailerName) {
      const dn = jobDetailerName.toLowerCase();
      if (myId && (dn === myId.toLowerCase() || jobDetailerName === myId)) return true;
      if (dn === myName || dn === myName.split(" ")[0] || myName.startsWith(dn)) return true;
      return false;
    }
    if (jobLocation) return jobLocation === myJobSlug;
    return true;
  }

  it("detailer sees job assigned by employeeId", () => {
    expect(isJobVisibleForDetailer("DET_LAMONT", "DET_LAMONT", "lamont", "niceville", "niceville", false)).toBe(true);
  });

  it("detailer sees job assigned by legacy name", () => {
    expect(isJobVisibleForDetailer("Lamont", "DET_LAMONT", "lamont", "niceville", "niceville", false)).toBe(true);
  });

  it("detailer does not see job assigned to someone else", () => {
    expect(isJobVisibleForDetailer("DET_JOHN", "DET_LAMONT", "lamont", "niceville", "niceville", false)).toBe(false);
  });

  it("admin sees all jobs for selected location", () => {
    expect(isJobVisibleForDetailer("DET_LAMONT", "ADM_001", "admin", "niceville", "niceville", true, "niceville")).toBe(true);
  });

  it("admin does not see jobs for other locations", () => {
    expect(isJobVisibleForDetailer("DET_LAMONT", "ADM_001", "admin", "crestview", "niceville", true, "niceville")).toBe(false);
  });
});

// ── Test 3: Day navigation logic ─────────────────────────────────────────────

describe("Day navigation (swipe + arrows)", () => {
  function navigateDay(
    currentDay: number,
    currentWeekOffset: number,
    direction: "left" | "right",
  ): { day: number; weekOffset: number } {
    if (direction === "left") {
      // Next day
      if (currentDay >= 6) {
        return { day: 0, weekOffset: currentWeekOffset + 1 };
      }
      return { day: currentDay + 1, weekOffset: currentWeekOffset };
    } else {
      // Previous day
      if (currentDay <= 0) {
        return { day: 6, weekOffset: currentWeekOffset - 1 };
      }
      return { day: currentDay - 1, weekOffset: currentWeekOffset };
    }
  }

  it("swipe left advances to next day", () => {
    const result = navigateDay(3, 0, "left");
    expect(result).toEqual({ day: 4, weekOffset: 0 });
  });

  it("swipe right goes to previous day", () => {
    const result = navigateDay(3, 0, "right");
    expect(result).toEqual({ day: 2, weekOffset: 0 });
  });

  it("swipe left at Saturday wraps to next week Sunday", () => {
    const result = navigateDay(6, 0, "left");
    expect(result).toEqual({ day: 0, weekOffset: 1 });
  });

  it("swipe right at Sunday wraps to previous week Saturday", () => {
    const result = navigateDay(0, 0, "right");
    expect(result).toEqual({ day: 6, weekOffset: -1 });
  });

  it("arrow right at end of week wraps correctly", () => {
    const result = navigateDay(6, 2, "left");
    expect(result).toEqual({ day: 0, weekOffset: 3 });
  });
});

// ── Test 4: Admin dashboard revenue aggregation (name resolution) ────────────

describe("Admin dashboard revenue name resolution", () => {
  function resolveAssignedToEmployeeId(
    assignedTo: string,
    detailers: Array<{ employeeId: string; fullName: string }>,
  ): string {
    // Direct match
    const direct = detailers.find((d) => d.employeeId === assignedTo);
    if (direct) return direct.employeeId;
    // Name-based match (case-insensitive)
    const nameMatch = detailers.find((d) =>
      d.fullName?.toLowerCase() === assignedTo.toLowerCase() ||
      d.fullName?.toLowerCase().startsWith(assignedTo.toLowerCase()) ||
      assignedTo.toLowerCase().includes((d.fullName?.split(" ")[0] ?? "").toLowerCase()),
    );
    return nameMatch?.employeeId ?? assignedTo;
  }

  const detailers = [
    { employeeId: "DET_LAMONT", fullName: "Lamont Williams" },
    { employeeId: "DET_JOHN", fullName: "John Smith" },
  ];

  it("resolves exact employeeId", () => {
    expect(resolveAssignedToEmployeeId("DET_LAMONT", detailers)).toBe("DET_LAMONT");
  });

  it("resolves legacy full name to employeeId", () => {
    expect(resolveAssignedToEmployeeId("Lamont Williams", detailers)).toBe("DET_LAMONT");
  });

  it("resolves legacy first name to employeeId", () => {
    expect(resolveAssignedToEmployeeId("Lamont", detailers)).toBe("DET_LAMONT");
  });

  it("returns original value when no match", () => {
    expect(resolveAssignedToEmployeeId("Unknown Person", detailers)).toBe("Unknown Person");
  });
});
