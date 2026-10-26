import { describe, expect, it } from "vitest";

import { createJobSyncSessionGenerationGuard } from "../lib/jobsync-session-generation";

describe("JobSync auth refresh generation race", () => {
  it("rejects a stale refresh completion after logout or an account switch", () => {
    const afterLogout = createJobSyncSessionGenerationGuard();
    const logoutRefresh = afterLogout.snapshot();
    afterLogout.advance();
    expect(afterLogout.isCurrent(logoutRefresh)).toBe(false);

    const afterAccountSwitch = createJobSyncSessionGenerationGuard();
    const accountARefresh = afterAccountSwitch.snapshot();
    afterAccountSwitch.advance();
    const accountBRefresh = afterAccountSwitch.snapshot();
    expect(afterAccountSwitch.isCurrent(accountARefresh)).toBe(false);
    expect(afterAccountSwitch.isCurrent(accountBRefresh)).toBe(true);
  });
});
