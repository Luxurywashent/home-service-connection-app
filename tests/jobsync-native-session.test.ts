import { describe, expect, it } from "vitest";

import { getJobSyncNativeDestination, verifyJobSyncNativeSession } from "../server/jobsyncAuth";
import { getNativeEmployeeSession } from "../lib/jobsync-role-map";

const companySession = (role: "owner" | "dispatcher" | "technician") => ({
  token: "test-token",
  portal: "company",
  user: { id: 42, name: "Taylor Test", email: "taylor@example.com", role, memberId: "member-42" },
  company: { id: 9, name: "Test Company", slug: "test-company", logoUrl: null, primaryColor: null, accentColor: null },
});

describe("JobSync native session routing", () => {
  it("routes a technician into the native team workspace", () => {
    expect(getJobSyncNativeDestination({ portal: "company", user: { role: "technician" } as any })).toBe("/(tabs)");
  });

  it("routes a Company owner into the native admin workspace", () => {
    expect(getJobSyncNativeDestination({ portal: "company", user: { role: "owner" } as any })).toBe("/(tabs)/admin-dashboard");
  });

  it("routes Platform Admin sessions to the native platform dashboard", () => {
    expect(getJobSyncNativeDestination({ portal: "platform", user: { role: "owner" } as any })).toBe("/platform-dashboard");
  });

  it("rejects malformed native session tokens", async () => {
    await expect(verifyJobSyncNativeSession("not-a-session-token")).resolves.toBeNull();
  });

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
