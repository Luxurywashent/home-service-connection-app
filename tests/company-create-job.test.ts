import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { companyCreateJobAllowed, companyCreateJobInstant, createCompanyJobController, type CompanyCreateJobDraft } from "../lib/company-create-job";
import { JobSyncApiError, type JobSyncCompanyJobCreateInput, type JobSyncCompanyJobCreateResult, type JobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";
let nextId = 1000;
function session(id = ++nextId): JobSyncNativeSession {
  return { token: `unit-only-${id}`, portal: "company", user: { id, role: "owner", name: "Unit Owner", email: null },
    company: { id: 9, name: "Unit Company", slug: "unit", logoUrl: null, primaryColor: null, accentColor: null } };
}
const draft = (): CompanyCreateJobDraft => ({ customerId: 7, serviceId: "31", date: "2026-12-01", startHour: 9, endHour: 10, addressLine1: " Test address " });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
async function settle() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
function harness(actor = session()) {
  let active = true;
  let acknowledgment: JobSyncCompanyJobCreateResult;
  const api = {
    session: vi.fn(async (): Promise<JobSyncNativeSession> => ({ ...actor, user: { ...actor.user }, company: { ...actor.company! } })),
    settings: vi.fn(async () => ({ id: actor.company!.id, name: "Unit Company", timezone: "America/Chicago" })),
    priceBook: vi.fn(async () => [{ serviceId: "31", name: "Actual service", emoji: "", description: "", features: [], vehiclePrices: {}, imageUrl: null, sortOrder: 0, serviceTypeId: 777, basePrice: 125 }]),
    customer: vi.fn(async () => ({ id: 7, companyId: actor.company!.id })),
    create: vi.fn(async (_token: string, companyId: number, input: JobSyncCompanyJobCreateInput): Promise<JobSyncCompanyJobCreateResult> => {
      acknowledgment = { id: 84, companyId, priceBookServiceId: input.priceBookServiceId, customerId: input.customerId,
        assignedUserId: input.assignedUserId ?? null, scheduledStartAt: input.scheduledStartAt, scheduledEndAt: input.scheduledEndAt ?? "2026-12-01T16:00:00.000Z",
        amount: 125, title: "Actual service", serviceName: "Actual service", customerName: "Actual customer", assignedName: null,
        status: "scheduled", updatedAt: "2026-11-15T19:00:00.000Z", addressLine1: input.addressLine1 ?? null, city: null };
      return acknowledgment;
    }),
    detail: vi.fn(async (): Promise<JobSyncCompanyJobDetail> => ({ ...acknowledgment, photos: [], persistedPhotoIds: [], enRouteAt: null, onSiteAt: null, completedAt: null })),
    jobs: vi.fn(async () => []),
  };
  const onState = vi.fn(); const onCreated = vi.fn(); const verifyAssignment = vi.fn(async () => true);
  const controller = createCompanyJobController({ session: actor, isCurrent: () => active, verifyAssignment, transport: api, onState, onCreated });
  return { actor, api, controller, onState, onCreated, verifyAssignment, stale: () => { active = false; }, ack: () => acknowledgment };
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden"))));
afterEach(() => vi.unstubAllGlobals());

describe("Company create strict wall-time conversion", () => {
  it("uses Company timezone across winter/summer, fractional time and next midnight", () => {
    expect(companyCreateJobInstant("2026-12-01", 9, "America/Chicago")).toBe("2026-12-01T15:00:00.000Z");
    expect(companyCreateJobInstant("2026-07-01", 9.5, "America/Chicago")).toBe("2026-07-01T14:30:00.000Z");
    expect(companyCreateJobInstant("2026-12-01", 24, "America/Chicago")).toBe("2026-12-02T06:00:00.000Z");
    expect(companyCreateJobInstant("2026-12-01", 9, "Asia/Tokyo")).toBe("2026-12-01T00:00:00.000Z");
  });
  it.each([
    ["2026-02-30", 9, "America/Chicago"], ["2026-12-01", NaN, "America/Chicago"],
    ["2026-12-01", 9.1234, "America/Chicago"], ["2026-12-01", 9, ""], ["2026-12-01", 9, "Invalid/Zone"],
    ["2026-03-08", 2.5, "America/Chicago"], ["2026-11-01", 1.5, "America/Chicago"],
  ])("rejects invalid/unverified/DST wall time %s %s %s", (date, hour, timezone) => {
    expect(() => companyCreateJobInstant(date as string, hour as number, timezone as string)).toThrow();
  });
});
describe("Company create controller with actual orchestration and mocked reads/writes", () => {
  it("performs fresh verification, one allowlisted POST and canonical readback, never a fabricated price/ID", async () => {
    const h = harness();
    const input = { ...draft(), amount: 9999, recurrence: { type: "weekly" }, notifyCustomer: false };
    expect(await h.controller.submit(input)).toBe(true);
    expect(h.api.create).toHaveBeenCalledTimes(1);
    expect(h.api.create).toHaveBeenCalledWith(h.actor.token, 9, {
      customerId: 7, priceBookServiceId: 31, scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T16:00:00.000Z", addressLine1: "Test address",
    });
    expect(h.api.session).toHaveBeenCalledTimes(3);
    expect(h.api.customer).toHaveBeenCalledWith(h.actor.token, 7, 9);
    expect(h.api.detail).toHaveBeenCalledWith(h.actor.token, 84, 9);
    expect(h.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 84, amount: 125, photos: [] }), "America/Chicago");
    expect(h.verifyAssignment).not.toHaveBeenCalled(); expect(h.controller.getState().phase).toBe("succeeded");
    await h.controller.submit(draft()); expect(h.api.create).toHaveBeenCalledTimes(1); h.controller.detach();
  });
  it("revalidates exact selected assignment and uses the actual service ID, not serviceTypeId", async () => {
    const h = harness(); await h.controller.submit({ ...draft(), assignedEmployeeId: "jobsync-50" });
    expect(h.verifyAssignment).toHaveBeenCalledWith("jobsync-50");
    expect(h.api.create.mock.calls[0][2]).toMatchObject({ assignedUserId: 50, priceBookServiceId: 31 }); h.controller.detach();
  });
  it.each(["technician", "platform"]) ("never grants create based on legacy/admin display state: %s", async (kind) => {
    const actor = session(); if (kind === "platform") actor.portal = "platform"; else actor.user.role = "technician";
    const h = harness(actor); expect(companyCreateJobAllowed(actor)).toBe(false);
    await h.controller.submit(draft()); expect(h.api.create).not.toHaveBeenCalled(); expect(h.api.session).not.toHaveBeenCalled(); h.controller.detach();
  });
  it.each(["role", "token", "company", "user"]) ("rejects fresh signed identity change: %s", async (kind) => {
    const h = harness(); const changed = session(h.actor.user.id);
    if (kind === "role") changed.user.role = "dispatcher";
    if (kind === "token") changed.token = "changed";
    if (kind === "company") changed.company!.id = 10;
    if (kind === "user") changed.user.id++;
    h.api.session.mockResolvedValue(changed); await h.controller.submit(draft());
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.controller.getState().phase).toBe("error"); h.controller.detach();
  });
  it.each(["customer", "retired-service", "timezone", "assignment", "end-time", "invalid-id", "rate"]) ("rejects failed preflight without POST: %s", async (kind) => {
    const h = harness(); const input = draft();
    if (kind === "customer") h.api.customer.mockResolvedValue({ id: 8, companyId: 9 });
    if (kind === "retired-service") h.api.priceBook.mockResolvedValue([]);
    if (kind === "timezone") h.api.settings.mockResolvedValue({ id: 9, name: "Company", timezone: "Wrong/Zone" });
    if (kind === "assignment") { input.assignedEmployeeId = "jobsync-50"; h.verifyAssignment.mockResolvedValue(false); }
    if (kind === "end-time") input.endHour = 8;
    if (kind === "invalid-id") input.serviceId = "basic";
    if (kind === "rate") input.vehiclePriceKey = "fabricated_rate";
    await h.controller.submit(input); expect(h.api.create).not.toHaveBeenCalled(); expect(h.controller.getState().phase).toBe("error"); h.controller.detach();
  });
  it.each(["session", "priceBook", "customer", "settings", "assignment"]) ("close during %s stops before POST and permits a fresh reopen", async (stage) => {
    const h = harness(); const waiting = deferred<any>();
    const input = { ...draft(), assignedEmployeeId: "jobsync-50" };
    const target = stage === "assignment" ? h.verifyAssignment : h.api[stage as "session" | "priceBook" | "customer" | "settings"];
    target.mockReturnValueOnce(waiting.promise); const saving = h.controller.submit(input); await settle(); h.stale(); h.controller.detach();
    waiting.resolve(stage === "session" ? h.actor : stage === "priceBook" ? [] : stage === "customer" ? { id: 7 } : stage === "settings" ? { id: 9, timezone: "America/Chicago" } : true);
    await saving; expect(h.api.create).not.toHaveBeenCalled(); expect(h.onCreated).not.toHaveBeenCalled();
    const reopened = harness(h.actor); expect(await reopened.controller.submit(draft())).toBe(true); reopened.controller.detach();
  });
  it("shared synchronous locks exclude rapid presses and a second mounted screen", async () => {
    const h = harness(); const waiting = deferred<JobSyncNativeSession>(); h.api.session.mockReturnValueOnce(waiting.promise);
    const first = h.controller.submit(draft()); await h.controller.submit(draft()); const other = harness(h.actor); await other.controller.submit(draft());
    expect(h.api.session).toHaveBeenCalledTimes(1); expect(other.api.create).not.toHaveBeenCalled();
    waiting.resolve(h.actor); await first; expect(h.api.create).toHaveBeenCalledTimes(1); h.controller.detach(); other.controller.detach();
  });
  it.each(["timeout", "network", "5xx", "unknown400"]) ("uncertain %s never blindly resends even after close/reopen and empty reconciliation", async (kind) => {
    const h = harness(); const error = kind === "network" ? new Error("Network failed") : new JobSyncApiError("Uncertain outcome", kind === "timeout" ? null : kind === "5xx" ? 503 : 400, kind === "timeout" ? "TIMEOUT" : "BAD_REQUEST");
    h.api.create.mockRejectedValue(error); await h.controller.submit(draft()); expect(h.controller.getState().phase).toBe("uncertain");
    h.controller.detach(); const reopened = harness(h.actor);
    expect(reopened.controller.getState().phase).toBe("uncertain"); await reopened.controller.submit(draft()); await reopened.controller.reconcile();
    expect(reopened.api.create).not.toHaveBeenCalled(); expect(reopened.controller.getState().phase).toBe("uncertain"); expect(reopened.controller.getState().message).toContain("not proof"); reopened.controller.detach();
  });
  it("201 followed by failed or wrong canonical detail remains saved and permits GET-only recovery", async () => {
    const h = harness(); h.api.detail.mockRejectedValueOnce(new JobSyncApiError("Read auth failed", 401, "UNAUTHORIZED"));
    await h.controller.submit(draft()); expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 84 });
    await h.controller.submit(draft()); expect(h.api.create).toHaveBeenCalledTimes(1);
    expect(await h.controller.reconcile()).toBe(true); expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.onCreated).toHaveBeenCalledTimes(1); h.controller.detach();
  });
  it("close/reopen after POST keeps known ID and suppresses old callbacks, with no POST on reconciliation", async () => {
    const h = harness(); const waiting = deferred<JobSyncCompanyJobCreateResult>();
    h.api.create.mockImplementationOnce(async (_token, companyId, input) => {
      const acknowledgment = { id: 84, companyId, customerId: input.customerId, priceBookServiceId: input.priceBookServiceId, assignedUserId: null,
        scheduledStartAt: input.scheduledStartAt, scheduledEndAt: input.scheduledEndAt, amount: 125 } as JobSyncCompanyJobCreateResult;
      await waiting.promise; return acknowledgment;
    });
    const saving = h.controller.submit(draft()); await settle(); expect(h.api.create).toHaveBeenCalledTimes(1); h.controller.detach();
    const reopened = harness(h.actor); await reopened.controller.submit(draft()); expect(reopened.api.create).not.toHaveBeenCalled();
    waiting.resolve({} as any); await saving;
    expect(h.onCreated).not.toHaveBeenCalled(); expect(reopened.controller.getState()).toMatchObject({ phase: "saved", jobId: 84 });
    reopened.api.detail.mockResolvedValue({ id: 84, companyId: 9, customerId: 7, assignedUserId: null, scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T16:00:00.000Z", amount: 125, photos: [], persistedPhotoIds: [] } as any);
    await reopened.controller.reconcile(); expect(reopened.api.create).not.toHaveBeenCalled(); expect(reopened.onCreated).toHaveBeenCalledTimes(1); reopened.controller.detach();
  });
  it("a synchronous submitting-state callback invalidation stops before POST dispatch", async () => {
    const h = harness();
    h.onState.mockImplementation((state) => { if (state.phase === "submitting") h.stale(); });
    await h.controller.submit(draft());
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.onCreated).not.toHaveBeenCalled(); h.controller.detach();
    const reopened = harness(h.actor); expect(await reopened.controller.submit(draft())).toBe(true); reopened.controller.detach();
  });
  it("a synchronous success-state callback invalidation retains saved acknowledgment and suppresses onCreated", async () => {
    const h = harness();
    h.onState.mockImplementation((state) => { if (state.phase === "succeeded") h.stale(); });
    await h.controller.submit(draft());
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.api.detail).toHaveBeenCalledTimes(1); expect(h.onCreated).not.toHaveBeenCalled();
    expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 84 }); h.controller.detach();
    const reopened = harness(h.actor); await reopened.controller.submit(draft()); expect(reopened.api.create).not.toHaveBeenCalled(); reopened.controller.detach();
  });
  it("a verified tier-required rejection releases for a corrected manual selection, never an automatic fallback", async () => {
    const h = harness(); h.api.create.mockRejectedValueOnce(new JobSyncApiError("A vehicle pricing tier is required for this Price Book service.", 400, "BAD_REQUEST"));
    await h.controller.submit(draft()); expect(h.controller.getState().phase).toBe("error"); expect(h.api.create).toHaveBeenCalledTimes(1);
    await h.controller.submit(draft()); expect(h.api.create).toHaveBeenCalledTimes(2); h.controller.detach();
  });
  it("malformed acknowledged Company/price/ID is uncertain and never passes a canonical callback", async () => {
    const h = harness(); h.api.create.mockResolvedValue({ id: 84, companyId: 10, amount: -1 } as any);
    await h.controller.submit(draft()); expect(h.controller.getState().phase).toBe("uncertain"); expect(h.onCreated).not.toHaveBeenCalled(); expect(h.api.detail).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("canonical readback mismatches remain saved and locked", async () => {
    const h = harness(); h.api.detail.mockResolvedValue({ id: 84, companyId: 9, customerId: 999, amount: 125 } as any);
    await h.controller.submit(draft()); expect(h.controller.getState().phase).toBe("saved"); await h.controller.submit(draft());
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.onCreated).not.toHaveBeenCalled(); h.controller.detach();
  });
});
