import { describe, expect, it } from "vitest";

import { getNativeEmployeeSession } from "../lib/jobsync-role-map";

const companySession = (role: "owner" | "dispatcher" | "technician") => ({
  token: "test-token",
  portal: "company" as const,
  user: { id: 42, name: "Taylor Test", email: "taylor@example.com", role, memberId: "member-42" },
  company: { id: 9, name: "Test Company", slug: "test-company", logoUrl: null, primaryColor: null, accentColor: null },
});

describe("JobSync native session routing", () => {
  it("maps Company Owner/Admin to the native admin role", () => {
    expect(getNativeEmployeeSession(companySession("owner"))?.role).toBe("admin");
  });

  it("maps Company dispatcher to the native Operations Manager role", () => {
    expect(getNativeEmployeeSession(companySession("dispatcher"))?.role).toBe("operations_manager");
  });

  it("maps Company technician to the native Detailer role and retains Company context", () => {
    const employee = getNativeEmployeeSession(companySession("technician"));
    expect(employee?.role).toBe("detailer");
    expect(employee?.companyId).toBe(9);
    expect(employee?.companyName).toBe("Test Company");
  });
});
