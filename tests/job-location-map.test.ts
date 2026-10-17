import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readProjectSource(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("Job detail location map", () => {
  it("uses the native Google Maps view instead of a fragile Street View image request", () => {
    const schedule = readProjectSource("app/(tabs)/admin-schedule.tsx");
    const locationMap = readProjectSource("components/job-location-map.tsx");

    expect(schedule).toContain('import { JobLocationMap } from "@/components/job-location-map";');
    expect(schedule).toContain("<JobLocationMap address={selectedJob.address} />");
    expect(schedule).not.toContain("maps.googleapis.com/maps/api/streetview");
    expect(locationMap).toContain("provider={PROVIDER_GOOGLE}");
    expect(locationMap).toContain('mapType="hybrid"');
  });

  it("retains an explicit Google Maps fallback when an address cannot be geocoded", () => {
    const locationMap = readProjectSource("components/job-location-map.tsx");

    expect(locationMap).toContain("Location.geocodeAsync(normalizedAddress)");
    expect(locationMap).toContain("Map preview unavailable");
    expect(locationMap).toContain("Open in Google Maps");
    expect(locationMap).toContain("https://www.google.com/maps/search/?api=1");
  });
});
