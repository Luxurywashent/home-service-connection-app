import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createJobSyncCompanyScheduleBlock, deleteJobSyncCompanyScheduleBlock,
  getJobSyncCompanyScheduleBlocks, normalizeJobSyncCompanyScheduleBlocks,
  type JobSyncCompanyScheduleBlockInput,
} from "../lib/jobsync-mobile-api";

const COMPANY = 9;
const TOKEN = "synthetic-native-company-token";
const DATE = "2026-11-16";
const block = () => ({ id: 71, employeeUserId: 44, employeeLabel: "Sample Technician", date: DATE,
  blockType: "day_off", title: "Day Off", notes: null, startHour: 0, endHour: 24 });
const input = (): JobSyncCompanyScheduleBlockInput => ({ startDate: DATE, endDate: DATE,
  employeeId: "44", employeeName: "Sample Technician", startHour: 0, endHour: 24,
  blockType: "day_off", title: "Day Off" });
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function mock(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(response(body, status)); vi.stubGlobal("fetch", fetch); return fetch;
}
beforeEach(() => {
  vi.stubEnv("EXPO_PUBLIC_JOBSYNC_API_BASE_URL", "https://fixture-api.example");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unconfigured network is forbidden")));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("canonical native Company schedule-block transport", () => {
  it("reads only the bearer-scoped date route and preserves a verified empty list", async () => {
    const fetch = mock({ companyId: COMPANY, blocks: [] });
    expect(await getJobSyncCompanyScheduleBlocks(TOKEN, COMPANY, DATE)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`https://fixture-api.example/api/mobile/v1/company/schedule-blocks?date=${DATE}`,
      expect.objectContaining({ method: "GET", cache: "no-store", headers: { Accept: "application/json", Authorization: `Bearer ${TOKEN}` } }));
  });
  it("retains numeric identities and fractional hours instead of legacy city/name matching", async () => {
    mock({ companyId: COMPANY, blocks: [{ ...block(), startHour: 9.5, endHour: 11, blockType: "other", title: "Appointment" }] });
    expect(await getJobSyncCompanyScheduleBlocks(TOKEN, COMPANY, DATE)).toEqual([
      expect.objectContaining({ id: 71, employeeUserId: 44, startHour: 9.5, endHour: 11, title: "Appointment" }),
    ]);
  });
  it.each([null, {}, { blocks: [] }, { companyId: 10, blocks: [] }, { companyId: "9", blocks: [] }, { companyId: 9, blocks: null }])(
    "rejects an unverifiable or cross-Company list: %j", (payload) => {
      expect(normalizeJobSyncCompanyScheduleBlocks(payload, COMPANY, DATE)).toBeNull();
    });
  it.each([
    { id: "71" }, { id: 0 }, { id: 1.5 }, { employeeUserId: "44" }, { employeeUserId: -1 },
    { date: "2026-11-17" }, { date: "2026-02-30" }, { blockType: "vacation" },
    { employeeLabel: "" }, { title: " " }, { notes: undefined }, { notes: 8 },
    { startHour: "0" }, { startHour: -1 }, { startHour: 24 }, { endHour: 25 },
    { endHour: 0 }, { startHour: Number.NaN }, { companyId: 10 }, { company_id: 10 },
  ])("rejects malformed rows without silently dropping them: %j", (changes) => {
    expect(normalizeJobSyncCompanyScheduleBlocks({ companyId: COMPANY, blocks: [{ ...block(), ...changes }] }, COMPANY, DATE)).toBeNull();
  });
  it("rejects duplicate persisted IDs and preserves web-created 8–17 as partial hours", () => {
    expect(normalizeJobSyncCompanyScheduleBlocks({ companyId: COMPANY, blocks: [block(), block()] }, COMPANY, DATE)).toBeNull();
    expect(normalizeJobSyncCompanyScheduleBlocks({ companyId: COMPANY, blocks: [{ ...block(), startHour: 8, endHour: 17 }] }, COMPANY, DATE)).toEqual([
      expect.objectContaining({ startHour: 8, endHour: 17 }),
    ]);
  });
  it("sends the existing canonical all-day create contract once, stripping copied fields", async () => {
    const fetch = mock({ companyId: COMPANY, count: 1 }, 201);
    const source = { ...input(), companyId: 999, id: "client-generated", city: "legacy-city", allDay: true, createdBy: "legacy-admin" };
    expect(await createJobSyncCompanyScheduleBlock(TOKEN, COMPANY, source)).toEqual({ companyId: COMPANY, count: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://fixture-api.example/api/mobile/v1/company/schedule-blocks");
    expect(options).toMatchObject({ method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } });
    expect(JSON.parse(options.body)).toEqual(input());
  });
  it("preserves partial-day hours, supported reason and optional trimmed notes", async () => {
    const fetch = mock({ companyId: COMPANY, count: 1 }, 201);
    await createJobSyncCompanyScheduleBlock(TOKEN, COMPANY, { ...input(), startHour: 9.5, endHour: 11, blockType: "other", title: " Personal ", notes: " Note " });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ ...input(), startHour: 9.5, endHour: 11, blockType: "other", title: "Personal", notes: "Note" });
  });
  it("verifies inclusive range count rather than treating any success acknowledgment as saved", async () => {
    mock({ companyId: COMPANY, count: 2 }, 201);
    expect(await createJobSyncCompanyScheduleBlock(TOKEN, COMPANY, { ...input(), endDate: "2026-11-17" })).toEqual({ companyId: COMPANY, count: 2 });
    mock({ companyId: COMPANY, count: 1 }, 201);
    await expect(createJobSyncCompanyScheduleBlock(TOKEN, COMPANY, { ...input(), endDate: "2026-11-17" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it.each([
    { employeeId: "jobsync-44" }, { employeeId: "Sample Technician" }, { employeeId: "0" },
    { employeeName: "" }, { startDate: "2026-02-30" }, { endDate: "2026-11-15" },
    { endDate: "2028-11-16" }, { startHour: -0.5 }, { endHour: 24.5 }, { startHour: 12, endHour: 12 },
    { title: " " }, { notes: "x".repeat(4001) }, { blockType: "unsupported" },
  ])("rejects invalid input before any network dispatch: %j", async (changes) => {
    const fetch = mock({ companyId: COMPANY, count: 1 }, 201);
    await expect(createJobSyncCompanyScheduleBlock(TOKEN, COMPANY, { ...input(), ...changes } as JobSyncCompanyScheduleBlockInput)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([200, 202, 204])("rejects unexpected successful create HTTP status %s without retry", async (status) => {
    const fetch = mock({ companyId: COMPANY, count: 1 }, status);
    await expect(createJobSyncCompanyScheduleBlock(TOKEN, COMPANY, input())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([null, { companyId: 10, count: 1 }, { companyId: 9, count: "1" }, { companyId: 9, success: true }])(
    "does not accept a false create acknowledgment: %j", async (payload) => {
      const fetch = mock(payload, 201);
      await expect(createJobSyncCompanyScheduleBlock(TOKEN, COMPANY, input())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  it("deletes only a canonical saved numeric ID and exact Company acknowledgment", async () => {
    const fetch = mock({ companyId: COMPANY, success: true });
    expect(await deleteJobSyncCompanyScheduleBlock(TOKEN, COMPANY, 71)).toEqual({ companyId: COMPANY, success: true });
    expect(fetch).toHaveBeenCalledWith("https://fixture-api.example/api/mobile/v1/company/schedule-blocks/71", expect.objectContaining({ method: "DELETE", headers: { Accept: "application/json", Authorization: `Bearer ${TOKEN}` } }));
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid deletion ID %s before dispatch", async (id) => {
    const fetch = mock({ companyId: COMPANY, success: true });
    await expect(deleteJobSyncCompanyScheduleBlock(TOKEN, COMPANY, id)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([null, { companyId: 10, success: true }, { companyId: 9, success: "true" }, { companyId: 9, count: 1 }])(
    "rejects false delete acknowledgment: %j", async (payload) => {
      mock(payload);
      await expect(deleteJobSyncCompanyScheduleBlock(TOKEN, COMPANY, 71)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    });
  it.each([401, 403, 404, 409, 503])("preserves HTTP %s denial without trying a legacy endpoint", async (status) => {
    const fetch = mock({ error: { code: "NATIVE_DENIAL", message: "Blocked" } }, status);
    await expect(createJobSyncCompanyScheduleBlock(TOKEN, COMPANY, input())).rejects.toMatchObject({ status, code: "NATIVE_DENIAL" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves ambiguous network outcomes as errors with no retry or fallback", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("Response lost after possible commit")); vi.stubGlobal("fetch", fetch);
    await expect(createJobSyncCompanyScheduleBlock(TOKEN, COMPANY, input())).rejects.toThrow("Response lost");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
