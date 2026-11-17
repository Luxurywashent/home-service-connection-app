import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/company-job-creation-storage", async () => {
  const { memoryCreationStorageModule } = await import("./helpers/company-creation-memory-store");
  return memoryCreationStorageModule();
});
import { companyCreateJobAllowed, companyCreateJobInstant, createCompanyJobController, type CompanyCreateJobDraft } from "../lib/company-create-job";
import { companyCreationStore } from "../lib/company-job-creation-storage";
import { JobSyncApiError, type JobSyncCompanyJobCreateInput, type JobSyncCompanyJobCreateResult, type JobSyncCompanyJobCreationOperation, type JobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";
let nextId = 1000;
function session(id = ++nextId): JobSyncNativeSession {
  return { token: `unit-only-${id}`, portal: "company", user: { id, role: "owner", name: "Unit Owner", email: null },
    company: { id: 9, name: "Unit Company", slug: "unit", logoUrl: null, primaryColor: null, accentColor: null } };
}
const draft = (): CompanyCreateJobDraft => ({ customerId: 7, serviceId: "31", date: "2026-12-01", startHour: 9, endHour: 10, addressLine1: " Test address " });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
async function settle() { for (let i = 0; i < 120; i++) await Promise.resolve(); }
function harness(actor = session()) {
  let active = true;
  let acknowledgment: JobSyncCompanyJobCreateResult;
  const api = {
    session: vi.fn(async (): Promise<JobSyncNativeSession> => ({ ...actor, user: { ...actor.user }, company: { ...actor.company! } })),
    settings: vi.fn(async () => ({ id: actor.company!.id, name: "Unit Company", timezone: "America/Chicago" })),
    priceBook: vi.fn(async () => [{ serviceId: "31", name: "Actual service", emoji: "", description: "", features: [], vehiclePrices: {}, imageUrl: null, sortOrder: 0, serviceTypeId: 777, basePrice: 125 }]),
    customer: vi.fn(async () => ({ id: 7, companyId: actor.company!.id })),
    create: vi.fn(async (_token: string, companyId: number, input: JobSyncCompanyJobCreateInput): Promise<JobSyncCompanyJobCreateResult> => {
      if (input.customerId === undefined) throw new Error("Existing-only fixture requires its canonical customer ID");
      if (input.priceBookServiceId === undefined) throw new Error("Legacy-only fixture requires its service ID");
      acknowledgment = { id: 84, companyId, priceBookServiceId: input.priceBookServiceId, customerId: input.customerId,
        assignedUserId: input.assignedUserId ?? null, scheduledStartAt: input.scheduledStartAt, scheduledEndAt: input.scheduledEndAt ?? "2026-12-01T16:00:00.000Z",
        amount: 125, title: "Actual service", serviceName: "Actual service", customerName: "Actual customer", assignedName: null,
        status: "scheduled", updatedAt: "2026-11-15T19:00:00.000Z", addressLine1: input.addressLine1 ?? null, city: null };
      return acknowledgment;
    }),
    detail: vi.fn(async (): Promise<JobSyncCompanyJobDetail> => ({ ...acknowledgment, photos: [], persistedPhotoIds: [], enRouteAt: null, onSiteAt: null, completedAt: null })),
    jobs: vi.fn(async () => []),
    operation: vi.fn(async (_token: string, companyId: number, operationKey: string): Promise<JobSyncCompanyJobCreationOperation> => {
      const record = await companyCreationStore.read(companyId, actor.user.id);
      return { key: operationKey, state: record?.jobId ? "saved" : "unknown", jobId: record?.jobId ?? null,
        rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null };
    }),
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
    const input = { ...draft(), amount: 9999, customerName: "Never retain", notifyCustomer: false };
    expect(await h.controller.submit(input)).toBe(true);
    expect(h.api.create).toHaveBeenCalledTimes(1);
    expect(h.api.create).toHaveBeenCalledWith(h.actor.token, 9, {
      customerId: 7, priceBookServiceId: 31, scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T16:00:00.000Z", addressLine1: "Test address",
      notifyCustomer: false, operationKey: expect.stringMatching(/^hsc-job-test-key-\d+$/),
    });
    expect(h.api.session).toHaveBeenCalledWith(h.actor.token);
    expect(h.api.session.mock.calls.length).toBeGreaterThan(3);
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
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.controller.getState()).toMatchObject({ phase: "uncertain", jobId: null });
    expect(h.controller.getState().detailError).toContain("sign-in changed");
    expect(await companyCreationStore.read(9, h.actor.user.id)).toBeNull();
    h.api.session.mockResolvedValue(h.actor); expect(await h.controller.restore()).toBe(true);
    expect(h.controller.getState().phase).toBe("ready"); h.controller.detach();
  });
  it.each(["customer", "customer-company", "retired-service", "timezone", "settings-company", "assignment", "end-time", "invalid-id", "rate"]) ("rejects failed preflight without POST: %s", async (kind) => {
    const h = harness(); const input = draft();
    if (kind === "customer") h.api.customer.mockResolvedValue({ id: 8, companyId: 9 });
    if (kind === "customer-company") h.api.customer.mockResolvedValue({ id: 7, companyId: 10 });
    if (kind === "retired-service") h.api.priceBook.mockResolvedValue([]);
    if (kind === "timezone") h.api.settings.mockResolvedValue({ id: 9, name: "Company", timezone: "Wrong/Zone" });
    if (kind === "settings-company") h.api.settings.mockResolvedValue({ id: 10, name: "Company", timezone: "America/Chicago" });
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
    const h = harness(); const waiting = deferred<void>(); const create = h.api.create.getMockImplementation()!;
    h.api.create.mockImplementationOnce(async (...args) => { const ack = await create(...args); await waiting.promise; return ack; });
    const first = h.controller.submit(draft()); const duplicate = h.controller.submit(draft()); await settle();
    expect(await duplicate).toBe(false); expect(h.api.create).toHaveBeenCalledTimes(1);
    const other = harness(h.actor); expect(await other.controller.submit(draft())).toBe(false);
    expect(other.api.create).not.toHaveBeenCalled();
    waiting.resolve(); expect(await first).toBe(true);
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(other.api.create).not.toHaveBeenCalled(); h.controller.detach(); other.controller.detach();
  });
  it.each(["timeout", "network", "5xx", "unknown400", "familiar400", "401", "403"]) ("uncertain %s never blindly resends after close/reopen and authoritative unknown lookup", async (kind) => {
    const h = harness(); const error = kind === "network" ? new Error("Network failed") : new JobSyncApiError(
      kind === "familiar400" ? "A vehicle pricing tier is required for this Price Book service." : "Uncertain outcome",
      kind === "timeout" ? null : kind === "5xx" ? 503 : kind === "401" ? 401 : kind === "403" ? 403 : 400,
      kind === "timeout" ? "TIMEOUT" : kind === "401" ? "UNAUTHORIZED" : kind === "403" ? "FORBIDDEN" : "BAD_REQUEST");
    h.api.create.mockRejectedValue(error); await h.controller.submit(draft()); expect(h.controller.getState().phase).toBe("uncertain");
    h.controller.detach(); const reopened = harness(h.actor);
    expect(reopened.controller.getState()).toMatchObject({ phase: "restoring", jobId: null });
    expect(await reopened.controller.restore()).toBe(false); await reopened.controller.submit(draft()); await reopened.controller.reconcile();
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(reopened.api.create).not.toHaveBeenCalled();
    expect(reopened.api.operation).toHaveBeenCalledWith(h.actor.token, 9, h.api.create.mock.calls[0][2].operationKey);
    expect(reopened.api.jobs).not.toHaveBeenCalled(); expect(reopened.controller.getState().phase).toBe("uncertain");
    expect(reopened.controller.getState().message).toContain("Do not resend"); reopened.controller.detach();
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
    expect(h.onCreated).not.toHaveBeenCalled(); expect(reopened.controller.getState()).toMatchObject({ phase: "restoring", jobId: null });
    reopened.api.detail.mockResolvedValue({ id: 84, companyId: 9, customerId: 7, assignedUserId: null, scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T16:00:00.000Z", amount: 125, photos: [], persistedPhotoIds: [] } as any);
    reopened.onCreated.mockResolvedValue(false); expect(await reopened.controller.restore()).toBe(false);
    expect(reopened.controller.getState()).toMatchObject({ phase: "saved", jobId: 84 });
    expect(await companyCreationStore.read(9, h.actor.user.id)).toMatchObject({ phase: "saved", jobId: 84 });
    reopened.onCreated.mockResolvedValue(true); expect(await reopened.controller.reconcile()).toBe(true);
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(reopened.api.create).not.toHaveBeenCalled();
    expect(reopened.onCreated).toHaveBeenCalledTimes(2); reopened.controller.detach();
  });
  it("submitting-state invalidation after durable reserve stops POST but keeps the origin request locked", async () => {
    const h = harness();
    h.onState.mockImplementation((state) => { if (state.phase === "submitting") h.stale(); });
    await h.controller.submit(draft());
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.onCreated).not.toHaveBeenCalled(); h.controller.detach();
    const record = await companyCreationStore.read(9, h.actor.user.id);
    expect(record).toMatchObject({ phase: "prepared", jobId: null, payload: { customerId: 7, priceBookServiceId: 31 } });
    const reopened = harness(h.actor); expect(reopened.controller.getState().phase).toBe("restoring");
    expect(await reopened.controller.restore()).toBe(false); expect(reopened.controller.getState().phase).toBe("uncertain");
    expect(await reopened.controller.submit(draft())).toBe(false); await reopened.controller.reconcile();
    expect(reopened.api.create).not.toHaveBeenCalled(); expect(reopened.onCreated).not.toHaveBeenCalled();
    expect((await companyCreationStore.read(9, h.actor.user.id))?.operationKey).toBe(record!.operationKey); reopened.controller.detach();
  });
  it("a synchronous final success close happens after onCreated and releases the confirmed attempt", async () => {
    const h = harness();
    h.onState.mockImplementation((state) => { if (state.phase === "succeeded") { expect(h.onCreated).toHaveBeenCalledTimes(1); h.stale(); } });
    expect(await h.controller.submit(draft())).toBe(true);
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.api.detail).toHaveBeenCalledTimes(1);
    expect(h.controller.getState()).toMatchObject({ phase: "succeeded", jobId: 84 }); h.controller.detach();
    expect(await companyCreationStore.read(9, h.actor.user.id)).toBeNull();
    const reopened = harness(h.actor); expect(reopened.controller.getState()).toMatchObject({ phase: "restoring", jobId: null });
    expect(await reopened.controller.restore()).toBe(true); expect(reopened.controller.getState().phase).toBe("ready");
    expect(reopened.api.create).not.toHaveBeenCalled(); reopened.controller.detach();
  });
  it("only authoritative rejected status releases a familiar 400 for a deliberately corrected selection/new key", async () => {
    const h = harness(); h.api.create.mockRejectedValueOnce(new JobSyncApiError("A vehicle pricing tier is required for this Price Book service.", 400, "BAD_REQUEST"));
    expect(await h.controller.submit(draft())).toBe(false); expect(h.controller.getState().phase).toBe("uncertain");
    const original = h.api.create.mock.calls[0][2];
    expect(await h.controller.submit(draft())).toBe(false); expect(h.api.create).toHaveBeenCalledTimes(1);
    h.api.operation.mockResolvedValueOnce({ key: original.operationKey!, state: "rejected", jobId: null, rejectionCode: "BAD_REQUEST",
      rejectionMessage: "A vehicle pricing tier is required for this Price Book service.", createdAt: null, updatedAt: null });
    expect(await h.controller.reconcile()).toBe(false); expect(h.controller.getState().phase).toBe("rejected");
    expect(await companyCreationStore.read(9, h.actor.user.id)).toMatchObject({ phase: "rejected", operationKey: original.operationKey });
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.onCreated).not.toHaveBeenCalled();
    const service = (await h.api.priceBook())[0]; h.api.priceBook.mockResolvedValue([{ ...service, basePrice: 0, vehiclePrices: { sedan: 125 } }]);
    expect(await h.controller.submit({ ...draft(), vehiclePriceKey: "sedan" })).toBe(true);
    expect(h.api.create).toHaveBeenCalledTimes(2); expect(h.api.create.mock.calls[1][2]).toMatchObject({ vehiclePriceKey: "sedan" });
    expect(h.api.create.mock.calls[1][2].operationKey).not.toBe(original.operationKey);
    expect(original).not.toHaveProperty("vehiclePriceKey"); h.controller.detach();
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
