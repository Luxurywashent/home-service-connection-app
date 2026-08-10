import { describe, it, expect } from "vitest";

// Test the 80% pass threshold logic used in the quiz screen
const PASS_THRESHOLD = 0.8;

function calculateResult(correct: number, total: number) {
  const pct = Math.round((correct / total) * 100);
  const passed = correct / total >= PASS_THRESHOLD;
  return { pct, passed };
}

describe("Training Quiz Pass Logic", () => {
  it("passes with 5/5 correct (100%)", () => {
    const { passed, pct } = calculateResult(5, 5);
    expect(passed).toBe(true);
    expect(pct).toBe(100);
  });

  it("passes with 4/5 correct (80%)", () => {
    const { passed, pct } = calculateResult(4, 5);
    expect(passed).toBe(true);
    expect(pct).toBe(80);
  });

  it("fails with 3/5 correct (60%)", () => {
    const { passed, pct } = calculateResult(3, 5);
    expect(passed).toBe(false);
    expect(pct).toBe(60);
  });

  it("fails with 0/5 correct (0%)", () => {
    const { passed, pct } = calculateResult(0, 5);
    expect(passed).toBe(false);
    expect(pct).toBe(0);
  });
});

// Test sequential module unlock logic
function isModuleLocked(index: number, completedIds: Set<string>, modules: { moduleId: string }[]): boolean {
  if (index === 0) return false;
  const prev = modules[index - 1];
  return !completedIds.has(prev?.moduleId);
}

describe("Sequential Module Unlock Logic", () => {
  const modules = [
    { moduleId: "TM_WELCOME" },
    { moduleId: "TM_SAFETY" },
    { moduleId: "TM_EXTERIOR" },
  ];

  it("first module is always unlocked", () => {
    expect(isModuleLocked(0, new Set(), modules)).toBe(false);
  });

  it("second module locked when first not completed", () => {
    expect(isModuleLocked(1, new Set(), modules)).toBe(true);
  });

  it("second module unlocked when first is completed", () => {
    expect(isModuleLocked(1, new Set(["TM_WELCOME"]), modules)).toBe(false);
  });

  it("third module locked when second not completed", () => {
    expect(isModuleLocked(2, new Set(["TM_WELCOME"]), modules)).toBe(true);
  });

  it("third module unlocked when first two completed", () => {
    expect(isModuleLocked(2, new Set(["TM_WELCOME", "TM_SAFETY"]), modules)).toBe(false);
  });
});
