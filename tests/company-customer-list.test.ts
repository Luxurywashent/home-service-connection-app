import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../app/(tabs)/admin-customers.tsx", import.meta.url), "utf8");

describe("Company customer list", () => {
  it("uses the authenticated Company customer API instead of the copied-app customer query", () => {
    expect(source).toContain('import { useJobSyncAuth } from "@/lib/jobsync-auth-context";');
    expect(source).toContain("getJobSyncCompanyCustomers");
    expect(source).toContain("enabled: !isJobSyncCompany");
    expect(source).toContain("refreshCompanyCustomers");
  });

  it("shows Company customer records and an actionable unavailable state", () => {
    expect(source).toContain("Company customer");
    expect(source).toContain("Could not load this Company’s customers. Check your connection and pull to refresh.");
    expect(source).toContain("No customers match your search");
  });
});
