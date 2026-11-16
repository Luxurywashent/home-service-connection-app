import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync(new URL("../app/(tabs)/admin-customers.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../hooks/use-company-customers.ts", import.meta.url), "utf8");
describe("Company customer list wiring", () => {
  it("uses the authenticated Company hook/API and keeps copied queries disabled in Company mode", () => {
    expect(source).toContain('import { useCompanyCustomers } from "@/hooks/use-company-customers";');
    expect(hook).toContain('import { useJobSyncAuth } from "@/lib/jobsync-auth-context";');
    expect(hook).toContain("getJobSyncCompanyCustomers(token)");
    expect(source).toContain("enabled: !isJobSyncCompany"); expect(source).toContain("refreshCompanyCustomers");
    expect(hook).toContain("state.identity === identity"); expect(hook).toContain("scope.sequence === sequence");
  });
  it("shows current Company records and the actionable read-failure state", () => {
    expect(source).toContain("Company customer");
    expect(hook).toContain("Could not load this Company’s customers. Check your connection and pull to refresh.");
    expect(source).toContain("No customers match your search");
    expect(source).toContain("companyId: String(customerCompanyId)");
  });
});
