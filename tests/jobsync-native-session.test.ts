import { describe, expect, it } from "vitest";

import { getJobSyncNativeDestination, verifyJobSyncNativeSession } from "../server/jobsyncAuth";

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
});
