import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readProjectSource(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("Company calendar and customer navigation", () => {
  it("removes the legacy city-transfer control from the Company calendar job detail", () => {
    const adminSchedule = readProjectSource("app/(tabs)/admin-schedule.tsx");

    expect(adminSchedule).not.toContain("Move to City");
    expect(adminSchedule).not.toContain("showMoveCityPicker");
    expect(adminSchedule).not.toContain("movingToCity");
  });

  it("returns customer details to the existing customer list instead of replacing it", () => {
    const profile = readProjectSource("app/(tabs)/admin-customer-profile.tsx");
    const handleBack = profile.slice(
      profile.indexOf("const handleBack"),
      profile.indexOf("const handleTab"),
    );

    expect(handleBack).toContain("router.back();");
    expect(handleBack).not.toContain("router.replace");
  });
});
