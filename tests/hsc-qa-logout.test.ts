import { afterEach, describe, expect, it, vi } from "vitest";
import { logoutJobSyncMobile } from "../lib/jobsync-mobile-api";
import { completeJobSyncLogout } from "../lib/jobsync-logout";
import { createJobSyncSessionGenerationGuard } from "../lib/jobsync-session-generation";

afterEach(() => vi.unstubAllGlobals());
describe("HSC-DEF-030 native Company logout — offline implementation evidence", () => {
  it("posts only the presented Company bearer to JobSync logout, without financial or credential fields", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetch);
    await logoutJobSyncMobile("synthetic-company-bearer");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/mobile\/v1\/auth\/logout$/);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { Authorization: "Bearer synthetic-company-bearer" } });
    expect(fetch.mock.calls[0][1].body).toBeUndefined();
  });

  it("revokes background activity and cached data before remote logout and persisted-session removal", async () => {
    const events: string[] = [];
    await completeJobSyncLogout({
      revokeBackground: async () => { events.push("background"); },
      clearQueries: async () => { events.push("queries"); },
      revokeRemote: async () => { events.push("server"); },
      clearStoredSession: async () => { events.push("stored"); },
    });
    expect(events).toEqual(["background", "queries", "server", "stored"]);
  });

  it("clears persisted credentials offline but does not claim that remote revocation succeeded", async () => {
    const clear = vi.fn(async () => {});
    await expect(completeJobSyncLogout({
      revokeBackground: async () => {}, clearQueries: async () => {},
      revokeRemote: async () => { throw new Error("Synthetic offline failure"); }, clearStoredSession: clear,
    })).rejects.toThrow("Synthetic offline failure");
    expect(clear).toHaveBeenCalledOnce();
  });

  it("prevents a refresh begun before logout from restoring the old Company session", () => {
    const guard = createJobSyncSessionGenerationGuard();
    const inFlightRefresh = guard.snapshot();
    guard.advance();
    expect(guard.isCurrent(inFlightRefresh)).toBe(false);
  });
});
