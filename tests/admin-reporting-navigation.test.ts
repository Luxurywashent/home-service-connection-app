import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readProjectSource(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("admin navigation and Reporting visibility", () => {
  it("hides Finance from both admin navigation surfaces", () => {
    const menu = readProjectSource("components/ui/top-nav-menu.tsx");
    const tabLayout = readProjectSource("app/(tabs)/_layout.tsx");
    const financeTab = tabLayout.slice(
      tabLayout.indexOf('name="admin-finance"'),
      tabLayout.indexOf('name="admin-pipeline"'),
    );

    expect(menu).not.toContain('label: "Finance"');
    expect(financeTab).toContain("href: null");
  });

  it("renders Reporting as a consolidated Company-wide view without a location selector", () => {
    const reporting = readProjectSource("app/(tabs)/admin-reporting.tsx");

    expect(reporting).not.toContain("LOCATION_OPTIONS");
    expect(reporting).not.toContain("locationSlug");
    expect(reporting).not.toContain("showLocationPicker");
    expect(reporting).not.toContain("All Locations");
    expect(reporting).toContain("Reporting is consolidated across Company locations.");
  });
});
