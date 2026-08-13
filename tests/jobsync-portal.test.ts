import { describe, expect, it } from "vitest";

import { getJobSyncPortalUrl, isJobSyncPortal, JOBSYNC_WEB_BASE_URL } from "../lib/jobsync-portal";

describe("JobSync portal configuration", () => {
  it("uses the live JobSync deployment for the company portal", () => {
    expect(getJobSyncPortalUrl("company")).toBe(`${JOBSYNC_WEB_BASE_URL}/login`);
  });

  it("uses the separate platform admin route", () => {
    expect(getJobSyncPortalUrl("platform")).toBe(`${JOBSYNC_WEB_BASE_URL}/platform/login`);
  });

  it("only accepts the two supported portal types", () => {
    expect(isJobSyncPortal("company")).toBe(true);
    expect(isJobSyncPortal("platform")).toBe(true);
    expect(isJobSyncPortal("customer")).toBe(false);
  });
});
