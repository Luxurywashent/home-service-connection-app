import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(new URL("../app/(tabs)/admin-dashboard.tsx", import.meta.url), "utf8");
const employees = readFileSync(new URL("../app/(tabs)/admin-employees.tsx", import.meta.url), "utf8");
const customerProfile = readFileSync(new URL("../components/company-customer-profile-panel.tsx", import.meta.url), "utf8");
const customers = readFileSync(new URL("../components/company-customers-panel.tsx", import.meta.url), "utf8");
const finance = readFileSync(new URL("../components/company-finance-panel.tsx", import.meta.url), "utf8");

describe("Company canonical cross-screen refresh", () => {
  it("publishes canonical customer and roster writes through the shared revision", () => {
    expect(customerProfile).toContain("invalidateCanonicalSurfaces");
    expect(customerProfile).toContain("invalidateCanonicalSurfaces();");
    expect(employees).toContain("invalidateCanonicalSurfaces");
    expect(employees).toContain("invalidateCanonicalSurfaces();");
  });

  it("makes every related mounted Company surface consume the shared revision", () => {
    expect(dashboard).toContain("useJobSyncSync");
    expect(dashboard).toContain("revision: companySyncRevision");
    expect(dashboard).toContain("[companySyncRevision, end, jobSyncSession?.token, start]");
    expect(employees).toContain("revision: companySyncRevision");
    expect(employees).toContain("companyRosterRequest");
    expect(employees).toContain("companyMemberDetailRequest");
    expect(employees).toContain("companyRequestValue");
    expect(customerProfile).toContain("customerRequest");
    expect(customers).toContain("[revision, token]");
    expect(finance).toContain("[revision, token]");
  });
});
