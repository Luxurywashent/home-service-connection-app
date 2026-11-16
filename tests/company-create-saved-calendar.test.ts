import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/company-job-creation-storage", async () => {
  const { memoryCreationStorageModule } = await import("./helpers/company-creation-memory-store");
  return memoryCreationStorageModule();
});
import { createCompanyJobController, type CompanyCreateJobDraft, type CompanyCreateJobTransport } from "../lib/company-create-job";
import { companyCreationStore } from "../lib/company-job-creation-storage";
import { JobSyncApiError, type JobSyncCompanyJobCreateResult, type JobSyncCompanyJobCreationOperation, type JobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";

let nextActor = 8100;
const draft: CompanyCreateJobDraft = { customerId: 7, serviceId: "31", date: "2026-12-01", startHour: 9.5, endHour: 11,
  addressLine1: " Canonical street ", city: "Town", region: "IL", postalCode: "12345", serviceNotes: "Service notes", privateNotes: "Private notes", assignedEmployeeId: "jobsync-50" };
function waiting<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function settle() { for (let i = 0; i < 120; i++) await Promise.resolve(); }
function harness(actor?: JobSyncNativeSession) {
  actor ??= { token: `mock-only-${++nextActor}`, portal: "company", user: { id: nextActor, name: "Owner", email: null, role: "owner" },
    company: { id: 9, name: "Company", slug: "unit", logoUrl: null, primaryColor: null, accentColor: null } };
  const origin = actor;
  let active = true; let ack!: JobSyncCompanyJobCreateResult;
  const api = {
    session: vi.fn(async () => origin), settings: vi.fn(async () => ({ id: 9, name: "Company", timezone: "America/Chicago" })),
    priceBook: vi.fn(async () => [{ serviceId: "31", name: "Canonical Service", basePrice: 125, vehiclePrices: {}, emoji: "", description: "", features: [], imageUrl: null, sortOrder: 0, serviceTypeId: 333 }]),
    customer: vi.fn(async () => ({ id: 7, companyId: 9 })),
    create: vi.fn<CompanyCreateJobTransport["create"]>(async (_token, companyId, input) => {
      if (input.customerId === undefined) throw new Error("Existing-only fixture requires its canonical customer ID");
      ack = { id: 84, companyId, customerId: input.customerId, priceBookServiceId: input.priceBookServiceId, assignedUserId: input.assignedUserId ?? null,
        scheduledStartAt: input.scheduledStartAt, scheduledEndAt: input.scheduledEndAt ?? null, amount: 125, status: "scheduled", title: "Canonical Service", serviceName: "Canonical Service", customerName: "Customer", assignedName: "Technician", addressLine1: input.addressLine1 ?? null, city: null, updatedAt: null };
      return ack;
    }),
    detail: vi.fn(async (): Promise<JobSyncCompanyJobDetail> => ({ ...ack, photos: [], persistedPhotoIds: [], enRouteAt: null, onSiteAt: null, completedAt: null })),
    jobs: vi.fn(async () => []),
    operation: vi.fn(async (_token: string, companyId: number, operationKey: string): Promise<JobSyncCompanyJobCreationOperation> => {
      const record = await companyCreationStore.read(companyId, origin.user.id);
      return { key: operationKey, state: record?.jobId ? "saved" : "unknown", jobId: record?.jobId ?? null,
        rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null };
    }),
  };
  const onCreated = vi.fn<(detail: JobSyncCompanyJobDetail, zone: string) => boolean | void | Promise<boolean | void>>(async () => true);
  const onState = vi.fn(); const verifyAssignment = vi.fn(async () => true);
  const controller = createCompanyJobController({ session: origin, isCurrent: () => active, verifyAssignment, transport: api, onCreated, onState });
  return { actor: origin, api, onCreated, onState, controller, stale: () => { active = false; } };
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden"))));
afterEach(() => vi.unstubAllGlobals());
const saved = { phase: "saved", jobId: 84, message: "Job saved — calendar refresh failed." };

function recoveredDetail(): JobSyncCompanyJobDetail {
  return { id: 84, companyId: 9, customerId: 7, assignedUserId: 50,
    scheduledStartAt: "2026-12-01T15:30:00.000Z", scheduledEndAt: "2026-12-01T17:00:00.000Z", amount: 125,
    title: "Canonical Service", serviceName: "Canonical Service", status: "scheduled", updatedAt: null,
    addressLine1: "Canonical street", city: "Town", customerName: "Customer", assignedName: "Technician",
    enRouteAt: null, onSiteAt: null, completedAt: null, photos: [], persistedPhotoIds: [] };
}

describe("known-saved calendar confirmation retains canonical ID and actor-wide one-POST lock", () => {
  it.each(["false", "sync-throw", "async-throw"])("preserves saved ID for %s callback and GET-only reconcile", async (kind) => {
    const h = harness();
    if (kind === "false") h.onCreated.mockReturnValueOnce(false);
    if (kind === "sync-throw") h.onCreated.mockImplementationOnce(() => { throw new Error("Settings read failed"); });
    if (kind === "async-throw") h.onCreated.mockRejectedValueOnce(new Error("List read failed"));
    expect(await h.controller.submit(draft)).toBe(false); expect(h.controller.getState()).toMatchObject(saved);
    if (kind !== "false") expect(h.controller.getState().detailError).toContain("read failed");
    await h.controller.submit(draft); expect(h.api.create).toHaveBeenCalledTimes(1);
    expect(await h.controller.reconcile()).toBe(true); expect(h.api.create).toHaveBeenCalledTimes(1);
    expect(h.api.detail).toHaveBeenCalledTimes(2); expect(h.controller.getState()).toMatchObject({ phase: "succeeded", jobId: 84 }); h.controller.detach();
  });
  it.each([true, undefined])("accepts backward-compatible callback confirmation %s", async (result) => {
    const h = harness(); h.onCreated.mockReturnValueOnce(result);
    expect(await h.controller.submit(draft)).toBe(true); expect(h.controller.getState().phase).toBe("succeeded");
    expect(h.api.create).toHaveBeenCalledWith(h.actor.token, 9, { customerId: 7, priceBookServiceId: 31, assignedUserId: 50,
      scheduledStartAt: "2026-12-01T15:30:00.000Z", scheduledEndAt: "2026-12-01T17:00:00.000Z", addressLine1: "Canonical street", city: "Town", region: "IL", postalCode: "12345", serviceNotes: "Service notes", privateNotes: "Private notes",
      operationKey: expect.stringMatching(/^hsc-job-test-key-\d+$/) }); h.controller.detach();
  });
  it("does not succeed or unlock while actual calendar refresh is pending; excludes double taps and second screen", async () => {
    const h = harness(); const refresh = waiting<boolean>(); h.onCreated.mockReturnValueOnce(refresh.promise);
    const submitting = h.controller.submit(draft); await settle();
    expect(h.onCreated).toHaveBeenCalledTimes(1); expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 84, reconciling: true }); expect(h.controller.isBusy()).toBe(true);
    expect(h.onState.mock.calls.some(([state]) => state.phase === "succeeded")).toBe(false);
    const other = harness(h.actor); await Promise.all([h.controller.submit(draft), other.controller.submit(draft), other.controller.reconcile()]);
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(other.api.create).not.toHaveBeenCalled();
    expect(other.controller.getState()).toMatchObject({ phase: "restoring", jobId: null });
    refresh.resolve(false); expect(await submitting).toBe(false); expect(h.controller.getState()).toMatchObject(saved);
    other.api.detail.mockResolvedValue(recoveredDetail()); other.onCreated.mockResolvedValue(false);
    expect(await other.controller.restore()).toBe(false); expect(other.controller.getState()).toMatchObject(saved);
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(other.api.create).not.toHaveBeenCalled();
    h.controller.detach(); other.controller.detach();
  });
  it("close/reopen during refresh preserves ack and never publishes stale success to a newer form", async () => {
    const h = harness(); const refresh = waiting<boolean>(); h.onCreated.mockReturnValueOnce(refresh.promise);
    const submitting = h.controller.submit(draft); await settle(); h.stale(); h.controller.detach();
    const reopened = harness(h.actor); refresh.resolve(true); expect(await submitting).toBe(false);
    expect(reopened.controller.getState()).toMatchObject({ phase: "restoring", jobId: null }); expect(reopened.onCreated).not.toHaveBeenCalled();
    expect(h.onState.mock.calls.some(([state]) => state.phase === "succeeded")).toBe(false);
    reopened.api.detail.mockResolvedValue(recoveredDetail()); reopened.onCreated.mockResolvedValue(false);
    expect(await reopened.controller.restore()).toBe(false); expect(reopened.controller.getState()).toMatchObject(saved);
    expect(await companyCreationStore.read(9, h.actor.user.id)).toMatchObject({ phase: "saved", jobId: 84 });
    reopened.onCreated.mockResolvedValue(true);
    expect(await reopened.controller.reconcile()).toBe(true); expect(reopened.api.create).not.toHaveBeenCalled();
    expect(reopened.onCreated).toHaveBeenCalledTimes(2); expect(h.api.create).toHaveBeenCalledTimes(1); reopened.controller.detach();
  });
  it("a successful onState close is allowed only after actual calendar refresh completed", async () => {
    const h = harness(); let refreshed = false;
    h.onCreated.mockImplementation(async () => { await Promise.resolve(); refreshed = true; return true; });
    h.onState.mockImplementation((state) => { if (state.phase === "succeeded") { expect(refreshed).toBe(true); h.stale(); h.controller.detach(); } });
    expect(await h.controller.submit(draft)).toBe(true); expect(h.controller.getState()).toMatchObject({ phase: "succeeded", jobId: 84 });
  });
  it.each(["id", "companyId", "customerId", "assignedUserId", "scheduledStartAt", "scheduledEndAt"])("protects original detail identity and schedule: %s", async (field) => {
    const h = harness(); const detail = h.api.detail.getMockImplementation()!;
    h.api.detail.mockImplementation(async () => ({ ...await detail(), [field]: field.startsWith("scheduled") ? "2026-12-02T17:00:00.000Z" : 999 }));
    expect(await h.controller.submit(draft)).toBe(false); expect(h.controller.getState()).toMatchObject(saved); expect(h.onCreated).not.toHaveBeenCalled();
    expect(await h.controller.submit(draft)).toBe(false); expect(h.api.create).toHaveBeenCalledTimes(1);
    expect(h.controller.getState().detailError).toContain("did not match"); h.controller.detach();
  });
  it.each([-1, NaN, Infinity])("rejects non-finite or negative canonical detail amount %s without unlocking", async (amount) => {
    const h = harness(); const detail = h.api.detail.getMockImplementation()!;
    h.api.detail.mockImplementation(async () => ({ ...await detail(), amount }));
    expect(await h.controller.submit(draft)).toBe(false); expect(h.controller.getState()).toMatchObject(saved);
    expect(h.controller.getState().detailError).toContain("did not match"); expect(h.onCreated).not.toHaveBeenCalled();
    expect(await h.controller.submit(draft)).toBe(false); expect(h.api.create).toHaveBeenCalledTimes(1); h.controller.detach();
  });
  it.each([999, 0])("accepts server-authoritative changed nonnegative amount %s and status without fabricating a price", async (amount) => {
    const h = harness(); const detail = h.api.detail.getMockImplementation()!;
    h.api.detail.mockImplementation(async () => ({ ...await detail(), amount, status: "completed" }));
    expect(await h.controller.submit(draft)).toBe(true); expect(h.api.create).toHaveBeenCalledTimes(1);
    expect(h.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 84, amount, status: "completed" }), "America/Chicago");
    expect(h.api.create.mock.calls[0][2]).not.toHaveProperty("amount");
    expect(h.controller.getState()).toMatchObject({ phase: "succeeded", jobId: 84 }); h.controller.detach();
  });
  it("known ack arriving after detach is recoverable across a new token for same Company actor", async () => {
    const h = harness(); const post = waiting<JobSyncCompanyJobCreateResult>(); h.api.create.mockReturnValueOnce(post.promise);
    const submitting = h.controller.submit(draft); await settle(); h.controller.detach();
    const reopened = harness({ ...h.actor, token: `${h.actor.token}-new` });
    post.resolve({ id: 84, companyId: 9, customerId: 7, priceBookServiceId: 31, assignedUserId: 50,
      scheduledStartAt: "2026-12-01T15:30:00.000Z", scheduledEndAt: "2026-12-01T17:00:00.000Z", amount: 125 } as JobSyncCompanyJobCreateResult);
    await submitting; expect(reopened.controller.getState()).toMatchObject({ phase: "restoring", jobId: null });
    expect(h.onCreated).not.toHaveBeenCalled(); expect(reopened.onCreated).not.toHaveBeenCalled();
    reopened.api.detail.mockResolvedValue(recoveredDetail()); reopened.onCreated.mockResolvedValue(false);
    expect(await reopened.controller.restore()).toBe(false); expect(reopened.controller.getState()).toMatchObject(saved);
    expect(reopened.api.session).toHaveBeenCalledWith(reopened.actor.token);
    await reopened.controller.submit(draft); expect(reopened.api.create).not.toHaveBeenCalled();
    reopened.onCreated.mockResolvedValue(true); expect(await reopened.controller.reconcile()).toBe(true);
    expect(reopened.api.create).not.toHaveBeenCalled(); expect(h.api.create).toHaveBeenCalledTimes(1); reopened.controller.detach();
  });
  it("malformed wrong-Company ack never publishes its ID to listeners", async () => {
    const h = harness(); h.api.create.mockResolvedValue({ id: 900, companyId: 10 } as JobSyncCompanyJobCreateResult);
    await h.controller.submit(draft); expect(h.controller.getState()).toMatchObject({ phase: "uncertain", jobId: null });
    expect(h.onState.mock.calls.some(([state]) => state.jobId === 900)).toBe(false); expect(h.onCreated).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("read-only reconciliation is synchronously locked and does not resend known saved POST", async () => {
    const h = harness(); h.onCreated.mockResolvedValueOnce(false); await h.controller.submit(draft);
    const refresh = waiting<boolean>(); h.onCreated.mockReturnValueOnce(refresh.promise);
    const reconciling = h.controller.reconcile(); await settle(); expect(await h.controller.reconcile()).toBe(false);
    expect(h.controller.getState().reconciling).toBe(true); refresh.resolve(false); await reconciling;
    expect(h.controller.getState()).toMatchObject({ ...saved, reconciling: false }); expect(h.api.create).toHaveBeenCalledTimes(1); h.controller.detach();
  });
});

describe("uncertain outcomes remain read-only and locked", () => {
  it.each([new Error("Network failed"), new JobSyncApiError("Timed out", null, "TIMEOUT"), new JobSyncApiError("Unknown postcommit", 400, "BAD_REQUEST"), new JobSyncApiError("Unavailable", 503, "INTERNAL_SERVER_ERROR")])("does not unlock on authoritative unknown lookup after %s", async (error) => {
    const h = harness(); h.api.create.mockRejectedValue(error); await h.controller.submit(draft); h.controller.detach();
    const reopened = harness(h.actor); expect(reopened.controller.getState()).toMatchObject({ phase: "restoring", jobId: null });
    await reopened.controller.reconcile(); await reopened.controller.submit(draft);
    expect(reopened.controller.getState()).toMatchObject({ phase: "uncertain", jobId: null }); expect(reopened.controller.getState().message).toContain("Do not resend");
    expect(reopened.api.create).not.toHaveBeenCalled(); expect(reopened.api.jobs).not.toHaveBeenCalled();
    expect(reopened.api.operation).toHaveBeenCalledWith(h.actor.token, 9, h.api.create.mock.calls[0][2].operationKey); reopened.controller.detach();
  });
  it("older injected transport without operation lookup cannot treat an empty calendar as proof of rejection", async () => {
    const h = harness(); h.api.create.mockRejectedValue(new Error("Network failed")); await h.controller.submit(draft); h.controller.detach();
    const onCreated = vi.fn();
    const reopened = createCompanyJobController({ session: h.actor, isCurrent: () => true, verifyAssignment: async () => true,
      transport: { ...h.api, operation: undefined }, onState: vi.fn(), onCreated });
    expect(reopened.getState()).toMatchObject({ phase: "restoring", jobId: null });
    expect(await reopened.reconcile()).toBe(false); expect(await reopened.submit(draft)).toBe(false);
    expect(reopened.getState()).toMatchObject({ phase: "uncertain", jobId: null }); expect(reopened.getState().message).toContain("not proof");
    expect(h.api.jobs).toHaveBeenCalledTimes(1); expect(h.api.operation).not.toHaveBeenCalled();
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(onCreated).not.toHaveBeenCalled(); reopened.detach();
  });
});
