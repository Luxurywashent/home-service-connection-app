import { describe, it, expect } from "vitest";

// ─── Time-Off Policy Validation ───
function calculateDays(start: string, end: string): number {
  const s = new Date(start + "T12:00:00");
  const e = new Date(end + "T12:00:00");
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1);
}

function calculateNotice(startDate: string, today: string): number {
  const start = new Date(startDate + "T12:00:00");
  const now = new Date(today + "T12:00:00");
  return Math.max(0, Math.round((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

function validatePolicy(days: number, notice: number): { valid: boolean; message: string } {
  if (days === 1 && notice < 5) return { valid: false, message: `1 day off requires at least 5 days notice. You have ${notice} days.` };
  if (days >= 2 && days <= 4 && notice < 14) return { valid: false, message: `${days} days off requires at least 14 days notice. You have ${notice} days.` };
  if (days >= 5 && notice < 30) return { valid: false, message: `${days} days off requires at least 30 days notice. You have ${notice} days.` };
  return { valid: true, message: "Meets policy requirements" };
}

// ─── Efficiency Color Logic ───
function getEfficiencyLevel(eff: number): "great" | "fair" | "needs_improvement" {
  if (eff >= 80) return "great";
  if (eff >= 70) return "fair";
  return "needs_improvement";
}

// ─── Role Access Logic ───
function isAdmin(role: string): boolean {
  return role === "admin" || role === "office" || role === "operations_manager";
}

describe("Time-Off Policy Validation", () => {
  it("calculates days correctly for single day", () => {
    expect(calculateDays("2026-04-15", "2026-04-15")).toBe(1);
  });

  it("calculates days correctly for multi-day range", () => {
    expect(calculateDays("2026-04-15", "2026-04-17")).toBe(3);
  });

  it("calculates days correctly for week", () => {
    expect(calculateDays("2026-04-13", "2026-04-19")).toBe(7);
  });

  it("calculates notice days correctly", () => {
    expect(calculateNotice("2026-04-10", "2026-04-01")).toBe(9);
    expect(calculateNotice("2026-04-10", "2026-04-10")).toBe(0);
    expect(calculateNotice("2026-04-10", "2026-04-15")).toBe(0); // past date, clamped to 0
  });

  it("validates 1 day off with sufficient notice (5+ days)", () => {
    const result = validatePolicy(1, 5);
    expect(result.valid).toBe(true);
  });

  it("rejects 1 day off with insufficient notice (<5 days)", () => {
    const result = validatePolicy(1, 3);
    expect(result.valid).toBe(false);
    expect(result.message).toContain("5 days notice");
  });

  it("validates 2-4 days off with sufficient notice (14+ days)", () => {
    expect(validatePolicy(2, 14).valid).toBe(true);
    expect(validatePolicy(3, 20).valid).toBe(true);
    expect(validatePolicy(4, 14).valid).toBe(true);
  });

  it("rejects 2-4 days off with insufficient notice (<14 days)", () => {
    expect(validatePolicy(2, 10).valid).toBe(false);
    expect(validatePolicy(3, 13).valid).toBe(false);
    expect(validatePolicy(4, 7).valid).toBe(false);
  });

  it("validates 5+ days off with sufficient notice (30+ days)", () => {
    expect(validatePolicy(5, 30).valid).toBe(true);
    expect(validatePolicy(7, 45).valid).toBe(true);
    expect(validatePolicy(10, 60).valid).toBe(true);
  });

  it("rejects 5+ days off with insufficient notice (<30 days)", () => {
    expect(validatePolicy(5, 20).valid).toBe(false);
    expect(validatePolicy(7, 29).valid).toBe(false);
  });
});

describe("Efficiency Color Logic", () => {
  it("returns great for 80% and above", () => {
    expect(getEfficiencyLevel(80)).toBe("great");
    expect(getEfficiencyLevel(95)).toBe("great");
    expect(getEfficiencyLevel(100)).toBe("great");
  });

  it("returns fair for 70-79%", () => {
    expect(getEfficiencyLevel(70)).toBe("fair");
    expect(getEfficiencyLevel(75)).toBe("fair");
    expect(getEfficiencyLevel(79.9)).toBe("fair");
  });

  it("returns needs_improvement for below 70%", () => {
    expect(getEfficiencyLevel(69.9)).toBe("needs_improvement");
    expect(getEfficiencyLevel(50)).toBe("needs_improvement");
    expect(getEfficiencyLevel(0)).toBe("needs_improvement");
  });
});

describe("Role Access Control", () => {
  it("identifies admin roles correctly", () => {
    expect(isAdmin("admin")).toBe(true);
    expect(isAdmin("office")).toBe(true);
    expect(isAdmin("operations_manager")).toBe(true);
  });

  it("identifies non-admin roles correctly", () => {
    expect(isAdmin("detailer")).toBe(false);
    expect(isAdmin("")).toBe(false);
    expect(isAdmin("unknown")).toBe(false);
  });
});

describe("Week Range Calculation", () => {
  function getWeekRange(dateStr: string) {
    const now = new Date(dateStr + "T12:00:00");
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      start: monday.toISOString().split("T")[0],
      end: sunday.toISOString().split("T")[0],
    };
  }

  it("calculates correct week range for a Wednesday", () => {
    const { start, end } = getWeekRange("2026-04-01"); // Wednesday
    expect(start).toBe("2026-03-30"); // Monday
    expect(end).toBe("2026-04-05"); // Sunday
  });

  it("calculates correct week range for a Monday", () => {
    const { start, end } = getWeekRange("2026-03-30"); // Monday
    expect(start).toBe("2026-03-30");
    expect(end).toBe("2026-04-05");
  });

  it("calculates correct week range for a Sunday", () => {
    const { start, end } = getWeekRange("2026-04-05"); // Sunday
    expect(start).toBe("2026-03-30");
    expect(end).toBe("2026-04-05");
  });
});

describe("Weekly Aggregation", () => {
  function aggregateWeekly(records: Array<{ date: string; revenueProduced: string; hoursWorked: string; efficiencyPercent: string; upsells: string }>) {
    if (records.length === 0) return { revenue: 0, hours: 0, efficiency: 0, bonus: 0 };
    const totalRevenue = records.reduce((s, d) => s + Number(d.revenueProduced), 0);
    const totalHours = records.reduce((s, d) => s + Number(d.hoursWorked), 0);
    const avgEfficiency = records.reduce((s, d) => s + Number(d.efficiencyPercent), 0) / records.length;
    const totalBonus = records.reduce((s, d) => s + Number(d.upsells), 0);
    return { revenue: totalRevenue, hours: totalHours, efficiency: avgEfficiency, bonus: totalBonus };
  }

  it("returns zeros for empty records", () => {
    const result = aggregateWeekly([]);
    expect(result.revenue).toBe(0);
    expect(result.hours).toBe(0);
    expect(result.efficiency).toBe(0);
    expect(result.bonus).toBe(0);
  });

  it("correctly aggregates multiple records", () => {
    const records = [
      { date: "2026-03-30", revenueProduced: "300.00", hoursWorked: "8.00", efficiencyPercent: "85.00", upsells: "50.00" },
      { date: "2026-03-31", revenueProduced: "400.00", hoursWorked: "7.50", efficiencyPercent: "75.00", upsells: "75.50" },
    ];
    const result = aggregateWeekly(records);
    expect(result.revenue).toBe(700);
    expect(result.hours).toBe(15.5);
    expect(result.efficiency).toBe(80);
    expect(result.bonus).toBeCloseTo(125.50);
  });
});

describe("Mystery Bonus Challenge Logic", () => {
  type AttemptResult = "correct" | "incorrect";

  function getChallengeStatus(
    attempts: Array<{ questionId: string; result: AttemptResult }>,
    totalQuestions: number
  ): { status: "in_progress" | "completed" | "failed"; answeredCount: number } {
    let answeredCount = 0;
    for (const a of attempts) {
      answeredCount++;
      if (a.result === "incorrect") return { status: "failed", answeredCount };
    }
    if (answeredCount >= totalQuestions) return { status: "completed", answeredCount };
    return { status: "in_progress", answeredCount };
  }

  function isChallengeExpired(expiresAt: string | null, today: string): boolean {
    if (!expiresAt) return false;
    return today > expiresAt;
  }

  function getProgressPercent(answered: number, total: number): number {
    if (total === 0) return 0;
    return Math.min(100, Math.round((answered / total) * 100));
  }

  it("returns in_progress when no questions answered", () => {
    const result = getChallengeStatus([], 3);
    expect(result.status).toBe("in_progress");
    expect(result.answeredCount).toBe(0);
  });

  it("returns in_progress when some questions answered correctly", () => {
    const result = getChallengeStatus(
      [{ questionId: "q1", result: "correct" }, { questionId: "q2", result: "correct" }],
      5
    );
    expect(result.status).toBe("in_progress");
    expect(result.answeredCount).toBe(2);
  });

  it("returns completed when all questions answered correctly", () => {
    const result = getChallengeStatus(
      [{ questionId: "q1", result: "correct" }, { questionId: "q2", result: "correct" }, { questionId: "q3", result: "correct" }],
      3
    );
    expect(result.status).toBe("completed");
    expect(result.answeredCount).toBe(3);
  });

  it("returns failed immediately when any question is incorrect", () => {
    const result = getChallengeStatus(
      [{ questionId: "q1", result: "correct" }, { questionId: "q2", result: "incorrect" }],
      5
    );
    expect(result.status).toBe("failed");
    expect(result.answeredCount).toBe(2);
  });

  it("returns failed on first question if incorrect", () => {
    const result = getChallengeStatus(
      [{ questionId: "q1", result: "incorrect" }],
      3
    );
    expect(result.status).toBe("failed");
    expect(result.answeredCount).toBe(1);
  });

  it("checks challenge expiration correctly", () => {
    expect(isChallengeExpired("2026-04-05", "2026-04-01")).toBe(false);
    expect(isChallengeExpired("2026-04-05", "2026-04-05")).toBe(false);
    expect(isChallengeExpired("2026-04-05", "2026-04-06")).toBe(true);
    expect(isChallengeExpired(null, "2026-04-01")).toBe(false);
  });

  it("calculates progress percentage correctly", () => {
    expect(getProgressPercent(0, 5)).toBe(0);
    expect(getProgressPercent(2, 5)).toBe(40);
    expect(getProgressPercent(5, 5)).toBe(100);
    expect(getProgressPercent(0, 0)).toBe(0);
  });
});

describe("Quiz Answer Validation", () => {
  function validateAnswer(selectedIndex: number, correctIndex: number): { correct: boolean } {
    return { correct: selectedIndex === correctIndex };
  }

  function parseQuizOptions(optionsJson: string): string[] {
    try {
      const parsed = JSON.parse(optionsJson);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  }

  it("validates correct answer", () => {
    expect(validateAnswer(2, 2).correct).toBe(true);
    expect(validateAnswer(0, 0).correct).toBe(true);
  });

  it("validates incorrect answer", () => {
    expect(validateAnswer(1, 2).correct).toBe(false);
    expect(validateAnswer(3, 0).correct).toBe(false);
  });

  it("parses quiz options JSON correctly", () => {
    const options = parseQuizOptions('["Option A","Option B","Option C","Option D"]');
    expect(options).toEqual(["Option A", "Option B", "Option C", "Option D"]);
    expect(options.length).toBe(4);
  });

  it("handles invalid JSON gracefully", () => {
    expect(parseQuizOptions("invalid")).toEqual([]);
    expect(parseQuizOptions("")).toEqual([]);
  });
});
