import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyCreationRecord, CompanyCreationStore } from "../lib/company-job-creation-storage";
import type { CompanyCreateJobDraft, CompanyCreateJobTransport } from "../lib/company-create-job";
import { JobSyncApiError, type JobSyncCompanyJobCreateInput, type JobSyncCompanyJobCreateResult, type JobSyncCompanyJobCreationOperation, type JobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";

const production = vi.hoisted(() => ({
  read: vi.fn(async (): Promise<null> => { throw new Error("Protected storage unavailable"); }),
  reserve: vi.fn(async () => false), update: vi.fn(async () => false), remove: vi.fn(async () => false),
  newKey: vi.fn(() => "production-secure-key"),
}));
vi.mock("../lib/company-job-creation-storage", () => ({ companyCreationStore: production, newCompanyCreationOperationKey: production.newKey }));

let nextActor = 23000;
let nextKey = 0;
const draft = (): CompanyCreateJobDraft => ({ customerId: 7, serviceId: "31", date: "2026-12-01", startHour: 9, endHour: 10,
  assignedEmployeeId: "jobsync-50", addressLine1: "  Canonical street  ", privateNotes: "  Private note  " });
function actor(companyId = 9): JobSyncNativeSession {
  const id = ++nextActor;
  return { token: `mock-only-${id}`, portal: "company", user: { id, role: "owner", name: "Owner", email: null },
    company: { id: companyId, name: "Company", slug: "unit", logoUrl: null, primaryColor: null, accentColor: null } };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
async function spin() { for (let i = 0; i < 120; i++) await Promise.resolve(); }
function memoryStore() {
  const records = new Map<string, CompanyCreationRecord>();
  const copy = (value: CompanyCreationRecord) => JSON.parse(JSON.stringify(value)) as CompanyCreationRecord;
  const key = (companyId: number, userId: number) => `${companyId}:${userId}`;
  const api = {
    read: vi.fn<CompanyCreationStore["read"]>(async (companyId, userId) => { const value = records.get(key(companyId, userId)); return value ? copy(value) : null; }),
    reserve: vi.fn<CompanyCreationStore["reserve"]>(async (record) => {
      const scope = key(record.companyId, record.userId); if (records.has(scope)) return false;
      records.set(scope, copy(record)); return true;
    }),
    update: vi.fn<CompanyCreationStore["update"]>(async (record) => {
      const scope = key(record.companyId, record.userId); const previous = records.get(scope);
      if (!previous || previous.operationKey !== record.operationKey) return false;
      if (JSON.stringify(previous.payload) !== JSON.stringify(record.payload) || previous.timezone !== record.timezone) throw new Error("Immutable request changed");
      records.set(scope, copy(record)); return true;
    }),
    remove: vi.fn<CompanyCreationStore["remove"]>(async (companyId, userId, operationKey) => {
      const scope = key(companyId, userId); if (records.get(scope)?.operationKey !== operationKey) return false;
      records.delete(scope); return true;
    }),
  };
  return { ...api, records, value: (signed: JobSyncNativeSession) => records.get(key(signed.company!.id, signed.user.id)),
    seed: (record: CompanyCreationRecord) => records.set(key(record.companyId, record.userId), copy(record)) };
}
function prepared(signed: JobSyncNativeSession, phase: CompanyCreationRecord["phase"] = "prepared"): CompanyCreationRecord {
  return { version: 1, companyId: signed.company!.id, userId: signed.user.id, operationKey: `stored-operation-${++nextKey}`,
    payload: { customerId: 7, priceBookServiceId: 31, assignedUserId: 50, scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T16:00:00.000Z", addressLine1: "Canonical street", privateNotes: "Private note" },
    timezone: "America/Chicago", phase, jobId: phase === "saved" ? 84 : null,
    createdAt: "2026-11-16T01:00:00.000Z", updatedAt: "2026-11-16T01:00:00.000Z" };
}
function detail(signed: JobSyncNativeSession, request: JobSyncCompanyJobCreateInput = prepared(signed).payload): JobSyncCompanyJobDetail {
  return { id: 84, companyId: signed.company!.id, customerId: request.customerId, assignedUserId: request.assignedUserId ?? null,
    scheduledStartAt: request.scheduledStartAt, scheduledEndAt: request.scheduledEndAt ?? "2026-12-01T16:00:00.000Z", amount: 125,
    status: "scheduled", title: "Service", serviceName: "Service", customerName: "Customer", assignedName: "Technician", updatedAt: null,
    addressLine1: request.addressLine1 ?? null, city: null, photos: [], persistedPhotoIds: [], enRouteAt: null, onSiteAt: null, completedAt: null };
}
function operation(key: string, state: JobSyncCompanyJobCreationOperation["state"], jobId: number | null = state === "saved" ? 84 : null): JobSyncCompanyJobCreationOperation {
  return { key, state, jobId, rejectionCode: state === "rejected" ? "BAD_REQUEST" : null,
    rejectionMessage: state === "rejected" ? "A vehicle pricing tier is required for this Price Book service." : null,
    createdAt: state === "unknown" ? null : "2026-11-16T01:00:00.000Z", updatedAt: state === "unknown" ? null : "2026-11-16T01:00:00.000Z" };
}
async function harness(options: { actor?: JobSyncNativeSession; store?: ReturnType<typeof memoryStore>; factory?: typeof import("../lib/company-create-job")["createCompanyJobController"]; noInjectedStore?: boolean } = {}) {
  const signed = options.actor ?? actor(); const store = options.store ?? memoryStore();
  const factory = options.factory ?? (await import("../lib/company-create-job")).createCompanyJobController;
  let active = true;
  let lastDetail = detail(signed);
  const api = {
    session: vi.fn<CompanyCreateJobTransport["session"]>(async () => ({ ...signed, user: { ...signed.user }, company: { ...signed.company! } })),
    settings: vi.fn<CompanyCreateJobTransport["settings"]>(async () => ({ id: signed.company!.id, name: "Company", timezone: "America/Chicago" })),
    priceBook: vi.fn<CompanyCreateJobTransport["priceBook"]>(async () => [{ serviceId: "31", name: "Service", serviceTypeId: 444, basePrice: 125,
      emoji: "", description: "", features: [], vehiclePrices: {}, imageUrl: null, sortOrder: 0 }]),
    customer: vi.fn<CompanyCreateJobTransport["customer"]>(async () => ({ id: 7, companyId: signed.company!.id })),
    create: vi.fn<CompanyCreateJobTransport["create"]>(async (_token, _company, request) => {
      lastDetail = detail(signed, request);
      return { ...lastDetail, companyId: signed.company!.id, priceBookServiceId: request.priceBookServiceId,
        operation: { key: request.operationKey!, state: "saved", replayed: false } };
    }),
    detail: vi.fn<CompanyCreateJobTransport["detail"]>(async () => ({ ...lastDetail })),
    jobs: vi.fn<CompanyCreateJobTransport["jobs"]>(async () => []),
    operation: vi.fn<NonNullable<CompanyCreateJobTransport["operation"]>>(async (_token, _company, key) => operation(key, "unknown")),
  };
  const onCreated = vi.fn<(detail: JobSyncCompanyJobDetail, timezone: string) => boolean | void | Promise<boolean | void>>(async () => true);
  const onState = vi.fn(); const verifyAssignment = vi.fn(async () => true);
  const newOperationKey = vi.fn(() => `new-operation-${++nextKey}`);
  const controller = factory({ session: signed, isCurrent: () => active, transport: api, onCreated, onState, verifyAssignment,
    ...(!options.noInjectedStore ? { store, newOperationKey } : {}) });
  return { actor: signed, store, api, onCreated, onState, verifyAssignment, newOperationKey, controller, stale: () => { active = false; } };
}
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden"))); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

describe("durable Company create request preparation and actor-wide exclusion", () => {
  it("defaults to protected production storage even with an injected transport; unavailable storage blocks POST", async () => {
    const h = await harness({ noInjectedStore: true });
    expect(h.controller.getState().phase).toBe("restoring");
    expect(await h.controller.submit(draft())).toBe(false);
    expect(production.read).toHaveBeenCalledWith(9, h.actor.user.id);
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.controller.isBusy()).toBe(true); h.controller.detach();
  });
  it("awaits durable reservation of immutable sanitized request/key/timezone/actor before exactly one POST", async () => {
    const h = await harness(); const writing = deferred<boolean>();
    const reserve = h.store.reserve.getMockImplementation()!;
    h.store.reserve.mockImplementationOnce(async (record) => { await writing.promise; return reserve(record); });
    const input = { ...draft(), amount: 900, recurrence: {}, notifyCustomer: false, customerName: "Never retain" };
    const saving = h.controller.submit(input); await spin();
    expect(h.store.reserve).toHaveBeenCalledTimes(1); expect(h.api.create).not.toHaveBeenCalled();
    expect(h.store.reserve.mock.calls[0][0]).toMatchObject({ companyId: 9, userId: h.actor.user.id, phase: "prepared", timezone: "America/Chicago",
      payload: { customerId: 7, priceBookServiceId: 31, assignedUserId: 50, addressLine1: "Canonical street", privateNotes: "Private note" } });
    expect(Object.isFrozen(h.store.reserve.mock.calls[0][0].payload)).toBe(true);
    input.addressLine1 = "Changed while writing";
    const other = await harness({ actor: h.actor, store: h.store });
    await Promise.all([h.controller.submit(draft()), other.controller.submit(draft()), other.controller.restore()]);
    expect(other.api.create).not.toHaveBeenCalled(); writing.resolve(true);
    expect(await saving).toBe(true); expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.newOperationKey).toHaveBeenCalledTimes(1);
    const request = h.api.create.mock.calls[0][2];
    expect(request).toEqual({ ...h.store.reserve.mock.calls[0][0].payload, operationKey: h.store.reserve.mock.calls[0][0].operationKey });
    expect(Object.keys(request)).not.toEqual(expect.arrayContaining(["amount", "recurrence", "notifyCustomer", "customerName"]));
    expect(h.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 84, amount: 125 }), "America/Chicago");
    expect(h.store.value(h.actor)).toBeUndefined(); h.controller.detach(); other.controller.detach();
  });
  it("coalesces initial hydration across concurrent controllers and taps without blind reset", async () => {
    const h = await harness(); const read = deferred<CompanyCreationRecord | null>(); h.store.read.mockReturnValueOnce(read.promise);
    const a = h.controller.restore(); const other = await harness({ actor: h.actor, store: h.store });
    const b = other.controller.restore(); const submit = h.controller.submit(draft()); await spin();
    expect(h.store.read).toHaveBeenCalledTimes(1); expect(h.api.create).not.toHaveBeenCalled();
    read.resolve(prepared(h.actor)); await Promise.all([a, b, submit]);
    expect(h.api.create).not.toHaveBeenCalled(); expect(other.api.create).not.toHaveBeenCalled();
    expect(h.api.operation.mock.calls.length + other.api.operation.mock.calls.length).toBe(1);
    expect(other.controller.getState().phase).toBe("uncertain"); h.controller.detach(); other.controller.detach();
  });
  it.each(["customer", "service", "assignment", "timezone", "end", "rate", "notes"])("preserves strict %s preflight without a durable sent record", async (kind) => {
    const h = await harness(); const input = draft();
    if (kind === "customer") h.api.customer.mockResolvedValue({ id: 8, companyId: 9 });
    if (kind === "service") h.api.priceBook.mockResolvedValue([]);
    if (kind === "assignment") h.verifyAssignment.mockResolvedValue(false);
    if (kind === "timezone") h.api.settings.mockResolvedValue({ id: 9, name: "Company", timezone: "Wrong/Zone" });
    if (kind === "end") input.endHour = 8;
    if (kind === "rate") input.vehiclePriceKey = "fabricated";
    if (kind === "notes") input.privateNotes = "x".repeat(4001);
    expect(await h.controller.submit(input)).toBe(false); expect(h.controller.getState().phase).toBe("error");
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.store.reserve).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("detachment during preflight safely clears only the unprepared in-memory validation", async () => {
    const h = await harness(); const check = deferred<{ id: number; companyId: number }>(); h.api.customer.mockReturnValueOnce(check.promise);
    const save = h.controller.submit(draft()); await spin(); h.controller.detach(); check.resolve({ id: 7, companyId: 9 }); await save;
    expect(h.store.reserve).not.toHaveBeenCalled(); const reopen = await harness({ actor: h.actor, store: h.store });
    expect(await reopen.controller.submit(draft())).toBe(true); expect(reopen.api.create).toHaveBeenCalledTimes(1); reopen.controller.detach();
  });
});

describe("restart and authoritative GET-only creation recovery", () => {
  it("recovers a lost committed response after process restart with no POST, no invented service ID and current Company timezone", async () => {
    const h = await harness(); h.api.create.mockRejectedValue(new Error("Response lost after commit"));
    expect(await h.controller.submit(draft())).toBe(false);
    const retained = h.store.value(h.actor)!; expect(retained.phase).toBe("uncertain"); h.controller.detach();
    vi.resetModules(); const factory = (await import("../lib/company-create-job")).createCompanyJobController;
    const restarted = await harness({ actor: { ...h.actor, token: `${h.actor.token}-renewed` }, store: h.store, factory });
    restarted.api.operation.mockImplementation(async (_token, _company, key) => operation(key, "saved"));
    restarted.api.settings.mockResolvedValue({ id: 9, name: "Company", timezone: "America/New_York" });
    restarted.api.detail.mockResolvedValue({ ...detail(h.actor, retained.payload), amount: 175, status: "on_site" });
    expect(restarted.controller.getState().phase).toBe("restoring");
    expect(await restarted.controller.restore()).toBe(true);
    expect(restarted.api.operation).toHaveBeenCalledWith(restarted.actor.token, 9, retained.operationKey);
    expect(restarted.api.detail).toHaveBeenCalledWith(restarted.actor.token, 84, 9);
    expect(restarted.api.create).not.toHaveBeenCalled(); expect(restarted.onCreated.mock.calls[0][0]).not.toHaveProperty("priceBookServiceId");
    expect(restarted.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 84, amount: 175, status: "on_site" }), "America/New_York");
    expect(h.api.create).toHaveBeenCalledTimes(1); restarted.controller.detach();
  });
  it.each(["pending", "unknown"] as const)("prepared crash-before-POST and %s remain locked indefinitely without new keys", async (state) => {
    const signed = actor(); const store = memoryStore(); const record = prepared(signed); store.seed(record);
    const h = await harness({ actor: signed, store }); h.api.operation.mockImplementation(async (_token, _company, key) => operation(key, state));
    await h.controller.restore(); await h.controller.submit(draft()); await h.controller.reconcile();
    expect(h.controller.getState().phase).toBe(state === "pending" ? "pending" : "uncertain");
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.newOperationKey).not.toHaveBeenCalled();
    expect(store.value(signed)?.operationKey).toBe(record.operationKey); expect(store.remove).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("familiar HTTP rejection never unlocks until authoritative rejected GET durably settles, then deliberate submit gets a new key", async () => {
    const h = await harness(); h.api.create.mockRejectedValueOnce(new JobSyncApiError("A vehicle pricing tier is required for this Price Book service.", 400, "BAD_REQUEST"));
    await h.controller.submit(draft()); const original = h.store.value(h.actor)!;
    await h.controller.submit(draft()); expect(h.api.create).toHaveBeenCalledTimes(1);
    h.api.operation.mockImplementation(async (_token, _company, key) => operation(key, "rejected"));
    const write = deferred<boolean>(); const update = h.store.update.getMockImplementation()!;
    h.store.update.mockImplementationOnce(async (record) => { await write.promise; return update(record); });
    const restore = h.controller.restore(); await spin(); await h.controller.submit(draft());
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.store.remove).not.toHaveBeenCalled();
    write.resolve(true); await restore; expect(h.controller.getState().phase).toBe("rejected");
    expect(await h.controller.submit({ ...draft(), privateNotes: "Corrected request" })).toBe(true);
    expect(h.api.create).toHaveBeenCalledTimes(2); expect(h.api.create.mock.calls[1][2].operationKey).not.toBe(original.operationKey);
    expect(h.store.remove).toHaveBeenCalledWith(9, h.actor.user.id, original.operationKey); h.controller.detach();
  });
  it("rejected settlement storage failure does not permit a corrected POST or new key", async () => {
    const signed = actor(); const store = memoryStore(); store.seed(prepared(signed)); const h = await harness({ actor: signed, store });
    h.api.operation.mockImplementation(async (_token, _company, key) => operation(key, "rejected")); store.update.mockRejectedValue(new Error("Write failed"));
    await h.controller.restore(); await h.controller.submit(draft());
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.newOperationKey).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled();
    expect(h.controller.getState().phase).toBe("uncertain"); h.controller.detach();
  });
  it("payload conflict preserves the exact immutable attempt even if a later GET says rejected", async () => {
    const h = await harness(); h.api.create.mockRejectedValueOnce(new JobSyncApiError("This Job creation operation key was already used with a different payload.", 409, "CONFLICT"));
    await h.controller.submit(draft()); const original = h.store.value(h.actor)!; expect(original.phase).toBe("conflict");
    h.api.operation.mockImplementation(async (_token, _company, key) => operation(key, "rejected"));
    await h.controller.restore(); await h.controller.submit({ ...draft(), customerId: 99 });
    expect(h.controller.getState().phase).toBe("conflict"); expect(h.api.create).toHaveBeenCalledTimes(1);
    expect(h.store.value(h.actor)).toEqual(original); expect(h.store.remove).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("an older explicitly injected transport without operation lookup cannot unlock on an empty calendar", async () => {
    const h = await harness(); h.api.operation = undefined as any; // Construction captures the same transport object.
    h.api.create.mockRejectedValue(new Error("Lost response")); await h.controller.submit(draft());
    await h.controller.restore(); await h.controller.submit(draft());
    expect(h.api.jobs).toHaveBeenCalledTimes(1); expect(h.api.create).toHaveBeenCalledTimes(1);
    expect(h.controller.getState().message).toContain("not proof"); h.controller.detach();
  });
});

describe("fail-closed persistence and scoped authentication", () => {
  it.each([401, 403])("revoked fresh session %s blocks reading/lookup/publication of persisted saved data", async (status) => {
    const signed = actor(); const store = memoryStore(); store.seed(prepared(signed, "saved")); const h = await harness({ actor: signed, store });
    h.api.session.mockRejectedValue(new JobSyncApiError("Session revoked", status, status === 401 ? "UNAUTHORIZED" : "FORBIDDEN"));
    await h.controller.restore(); await h.controller.submit(draft());
    expect(store.read).not.toHaveBeenCalled(); expect(h.api.operation).not.toHaveBeenCalled(); expect(h.api.create).not.toHaveBeenCalled();
    expect(h.onState.mock.calls.some(([state]) => state.jobId === 84)).toBe(false); expect(store.value(signed)?.jobId).toBe(84); h.controller.detach();
  });
  it("rechecks fresh signed session after delayed storage read before publishing any restored record", async () => {
    const signed = actor(); const store = memoryStore(); const h = await harness({ actor: signed, store }); const read = deferred<CompanyCreationRecord | null>();
    store.read.mockReturnValueOnce(read.promise); h.api.session.mockResolvedValueOnce(signed).mockRejectedValue(new JobSyncApiError("Revoked", 401, "UNAUTHORIZED"));
    const restore = h.controller.restore(); await spin(); read.resolve(prepared(signed, "saved")); await restore;
    expect(h.onState.mock.calls.some(([state]) => state.jobId === 84)).toBe(false); expect(h.api.operation).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("does not let a second revoked token observe another controller's hydrated actor metadata", async () => {
    const h = await harness(); h.onCreated.mockResolvedValue(false); await h.controller.submit(draft());
    const other = await harness({ actor: { ...h.actor, token: "revoked-second-token" }, store: h.store });
    other.api.session.mockRejectedValue(new JobSyncApiError("Revoked", 403, "FORBIDDEN")); await other.controller.restore();
    expect(other.controller.getState().jobId).toBeNull(); expect(other.onState.mock.calls.some(([state]) => state.jobId === 84)).toBe(false);
    expect(h.store.value(h.actor)?.jobId).toBe(84); h.controller.detach(); other.controller.detach();
  });
  it.each([401, 403, 400, 503])("POST failure %s retains durable record and does not permit a new POST", async (status) => {
    const h = await harness(); h.api.create.mockRejectedValue(new JobSyncApiError("Ambiguous failure", status, "BAD_REQUEST"));
    await h.controller.submit(draft()); await h.controller.restore(); await h.controller.submit(draft());
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.store.value(h.actor)).toMatchObject({ phase: "uncertain", jobId: null });
    expect(h.store.remove).not.toHaveBeenCalled(); h.controller.detach();
  });
  it.each(["read", "reserve"] as const)("%s errors never send and keep saving fail closed", async (stage) => {
    const h = await harness(); h.store[stage].mockRejectedValue(new Error("Protected storage write/read failed"));
    await h.controller.submit(draft()); await h.controller.submit(draft());
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.store.remove).not.toHaveBeenCalled();
    expect(h.controller.getState().phase).toBe("uncertain"); h.controller.detach();
  });
  it("ambiguous reserve that actually committed remains recoverable after restart without a POST", async () => {
    const h = await harness(); const reserve = h.store.reserve.getMockImplementation()!;
    h.store.reserve.mockImplementationOnce(async (record) => { await reserve(record); throw new Error("Manifest acknowledgment lost"); });
    await h.controller.submit(draft()); expect(h.api.create).not.toHaveBeenCalled(); const original = h.store.value(h.actor)!; h.controller.detach();
    vi.resetModules(); const factory = (await import("../lib/company-create-job")).createCompanyJobController;
    const restarted = await harness({ actor: h.actor, store: h.store, factory }); await restarted.controller.restore(); await restarted.controller.submit(draft());
    expect(restarted.api.create).not.toHaveBeenCalled(); expect(h.store.value(h.actor)?.operationKey).toBe(original.operationKey); restarted.controller.detach();
  });
  it("Company switch/detach during a delayed POST settles only the durable origin and never invokes stale callbacks", async () => {
    const h = await harness(); const post = deferred<JobSyncCompanyJobCreateResult>(); h.api.create.mockReturnValueOnce(post.promise);
    const saving = h.controller.submit(draft()); await spin(); const original = h.store.value(h.actor)!;
    h.stale(); h.controller.detach(); const switched = await harness({ actor: { ...h.actor, token: "new-company-token", company: { ...h.actor.company!, id: 10 } }, store: h.store });
    await switched.controller.restore(); const staleCalls = h.onState.mock.calls.length;
    post.resolve({ ...detail(h.actor, original.payload), companyId: 9, priceBookServiceId: 31,
      operation: { key: original.operationKey, state: "saved", replayed: false } }); await saving;
    expect(h.store.value(h.actor)).toMatchObject({ phase: "saved", jobId: 84 }); expect(h.store.value(switched.actor)).toBeUndefined();
    expect(h.onState.mock.calls.length).toBe(staleCalls); expect(h.onCreated).not.toHaveBeenCalled(); expect(switched.onCreated).not.toHaveBeenCalled();
    expect(switched.controller.getState().phase).toBe("ready"); switched.controller.detach();
  });
  it("Company switch during delayed reservation leaves an unknown durable intent but dispatches no POST", async () => {
    const h = await harness(); const write = deferred<boolean>(); const reserve = h.store.reserve.getMockImplementation()!;
    h.store.reserve.mockImplementationOnce(async (record) => { await write.promise; return reserve(record); });
    const save = h.controller.submit(draft()); await spin(); h.stale(); h.controller.detach(); write.resolve(true); await save;
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.store.value(h.actor)?.phase).toBe("prepared");
    const reopened = await harness({ actor: h.actor, store: h.store }); await reopened.controller.restore(); await reopened.controller.submit(draft());
    expect(reopened.api.create).not.toHaveBeenCalled(); expect(reopened.controller.getState().phase).toBe("uncertain"); reopened.controller.detach();
  });
});

describe("known saved durable settlement and actual calendar confirmation", () => {
  it.each(["false", "throw", "detail", "mismatch", "settings"])("retains saved canonical ID and immutable lock through %s failure", async (kind) => {
    const h = await harness();
    if (kind === "false") h.onCreated.mockResolvedValueOnce(false);
    if (kind === "throw") h.onCreated.mockRejectedValueOnce(new Error("Calendar failed"));
    if (kind === "detail") h.api.detail.mockRejectedValueOnce(new Error("Detail failed"));
    if (kind === "mismatch") h.api.detail.mockResolvedValueOnce({ ...detail(h.actor), customerId: 999 });
    if (kind === "settings") h.api.settings.mockResolvedValueOnce({ id: 9, name: "Company", timezone: "America/Chicago" }).mockRejectedValueOnce(new Error("Settings failed"));
    expect(await h.controller.submit(draft())).toBe(false); expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 84 });
    expect(h.store.value(h.actor)).toMatchObject({ phase: "saved", jobId: 84 }); expect(h.store.remove).not.toHaveBeenCalled();
    await h.controller.submit(draft()); expect(h.api.create).toHaveBeenCalledTimes(1);
    h.api.operation.mockImplementation(async (_token, _company, key) => operation(key, "saved"));
    expect(await h.controller.reconcile()).toBe(true); expect(h.api.create).toHaveBeenCalledTimes(1); h.controller.detach();
  });
  it("bootstrap restore onCreated false never erases the record, and a parallel form shares saved ID without POST", async () => {
    const signed = actor(); const store = memoryStore(); const record = prepared(signed); store.seed(record);
    const bootstrap = await harness({ actor: signed, store }); bootstrap.onCreated.mockResolvedValue(false);
    bootstrap.api.operation.mockImplementation(async (_token, _company, key) => operation(key, "saved"));
    await bootstrap.controller.restore(); expect(bootstrap.controller.getState()).toMatchObject({ phase: "saved", jobId: 84 }); expect(store.remove).not.toHaveBeenCalled();
    const form = await harness({ actor: signed, store }); form.api.operation.mockImplementation(async (_token, _company, key) => operation(key, "saved"));
    await form.controller.submit(draft()); expect(form.api.create).not.toHaveBeenCalled(); expect(await form.controller.restore()).toBe(true);
    expect(store.value(signed)).toBeUndefined(); bootstrap.controller.detach(); form.controller.detach();
  });
  it("saved update failure preserves the server-authoritative ID in memory, blocks callback/removal and never resends", async () => {
    const h = await harness(); h.store.update.mockRejectedValue(new Error("Saved record write failed")); await h.controller.submit(draft());
    expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 84 }); expect(h.onCreated).not.toHaveBeenCalled(); expect(h.store.remove).not.toHaveBeenCalled();
    await h.controller.submit(draft()); expect(h.api.create).toHaveBeenCalledTimes(1);
    h.store.update.mockImplementation(async (record) => { h.store.seed(record); return true; });
    h.api.operation.mockImplementation(async (_token, _company, key) => operation(key, "saved"));
    expect(await h.controller.restore()).toBe(true); expect(h.api.create).toHaveBeenCalledTimes(1); h.controller.detach();
  });
  it("does not remove or publish success while the real calendar refresh is pending", async () => {
    const h = await harness(); const refresh = deferred<boolean>(); h.onCreated.mockReturnValueOnce(refresh.promise);
    const save = h.controller.submit(draft()); await spin();
    expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 84, reconciling: true }); expect(h.store.remove).not.toHaveBeenCalled();
    const other = await harness({ actor: h.actor, store: h.store }); await other.controller.restore(); await other.controller.submit(draft());
    expect(other.onCreated).not.toHaveBeenCalled(); expect(other.api.create).not.toHaveBeenCalled();
    refresh.resolve(true); expect(await save).toBe(true); expect(h.store.remove).toHaveBeenCalledTimes(1); h.controller.detach(); other.controller.detach();
  });
  it.each(["throw", "false"])("remove %s after successful real callback retains saved ID and lock without resend", async (kind) => {
    const h = await harness(); if (kind === "throw") h.store.remove.mockRejectedValueOnce(new Error("Removal failed")); else h.store.remove.mockResolvedValueOnce(false);
    expect(await h.controller.submit(draft())).toBe(false);
    expect(h.onCreated).toHaveBeenCalledTimes(1); expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 84 });
    expect(h.store.value(h.actor)?.jobId).toBe(84); await h.controller.submit(draft()); expect(h.api.create).toHaveBeenCalledTimes(1);
    h.api.operation.mockImplementation(async (_token, _company, key) => operation(key, "saved"));
    expect(await h.controller.restore()).toBe(true); expect(h.api.create).toHaveBeenCalledTimes(1); h.controller.detach();
  });
  it("wrong detail customer/assignment/date after restart retains saved ID without fabricating ack or sending POST", async () => {
    const signed = actor(); const store = memoryStore(); store.seed(prepared(signed)); const h = await harness({ actor: signed, store });
    h.api.operation.mockImplementation(async (_token, _company, key) => operation(key, "saved"));
    h.api.detail.mockResolvedValue({ ...detail(signed), assignedUserId: 99, scheduledStartAt: "2026-12-02T15:00:00.000Z" });
    await h.controller.restore(); await h.controller.submit(draft());
    expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 84 }); expect(h.api.create).not.toHaveBeenCalled(); expect(h.onCreated).not.toHaveBeenCalled();
    expect(store.value(signed)).toMatchObject({ phase: "saved", jobId: 84 }); h.controller.detach();
  });
  it("known saved cannot be downgraded by a later unknown/pending/rejected lookup", async () => {
    const signed = actor(); const store = memoryStore(); store.seed(prepared(signed, "saved")); const h = await harness({ actor: signed, store });
    h.onCreated.mockResolvedValue(false);
    for (const state of ["unknown", "pending", "rejected"] as const) {
      h.api.operation.mockImplementation(async (_token, _company, key) => operation(key, state)); await h.controller.restore(); await h.controller.submit(draft());
      expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 84 }); expect(store.value(signed)).toMatchObject({ phase: "saved", jobId: 84 });
    }
    expect(h.api.create).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("synchronous submitting invalidation after persistence leaves a durable unknown lock, never a reopened new POST", async () => {
    const h = await harness(); h.onState.mockImplementation((state) => { if (state.phase === "submitting") h.stale(); });
    await h.controller.submit(draft()); expect(h.api.create).not.toHaveBeenCalled(); expect(h.store.value(h.actor)?.phase).toBe("prepared");
    h.controller.detach(); const reopened = await harness({ actor: h.actor, store: h.store }); await reopened.controller.submit(draft());
    expect(reopened.api.create).not.toHaveBeenCalled(); await reopened.controller.restore(); expect(reopened.controller.getState().phase).toBe("uncertain"); reopened.controller.detach();
  });
  it("reauthenticates after delayed durable write and blocks a revoked bearer before first POST", async () => {
    const h = await harness(); const reserve = h.store.reserve.getMockImplementation()!;
    h.store.reserve.mockImplementationOnce(async (record) => {
      const result = await reserve(record); h.api.session.mockRejectedValue(new JobSyncApiError("Revoked during write", 401, "UNAUTHORIZED")); return result;
    });
    await h.controller.submit(draft()); expect(h.api.create).not.toHaveBeenCalled(); expect(h.store.value(h.actor)).toBeDefined();
    await h.controller.submit(draft()); expect(h.api.create).not.toHaveBeenCalled(); expect(h.store.remove).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("reserve false adopts the already-durable actor operation on recovery rather than retrying either POST", async () => {
    const h = await harness(); const existing = prepared(h.actor);
    h.store.reserve.mockImplementationOnce(async () => { h.store.seed(existing); return false; });
    await h.controller.submit(draft()); expect(h.api.create).not.toHaveBeenCalled(); await h.controller.restore();
    expect(h.api.operation).toHaveBeenCalledWith(h.actor.token, 9, existing.operationKey); await h.controller.submit(draft());
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.store.value(h.actor)?.operationKey).toBe(existing.operationKey); h.controller.detach();
  });
  it("saved lookup settlement after detach writes the origin ID without invoking its calendar callback", async () => {
    const signed = actor(); const store = memoryStore(); const record = prepared(signed); store.seed(record);
    const h = await harness({ actor: signed, store }); const lookup = deferred<JobSyncCompanyJobCreationOperation>(); h.api.operation.mockReturnValueOnce(lookup.promise);
    const restore = h.controller.restore(); await spin(); h.stale(); h.controller.detach(); lookup.resolve(operation(record.operationKey, "saved")); await restore;
    expect(store.value(signed)).toMatchObject({ phase: "saved", jobId: 84 }); expect(h.onCreated).not.toHaveBeenCalled();
  });
  it("successful onState may synchronously close only after awaited calendar and record removal, without changing success", async () => {
    const h = await harness(); h.onState.mockImplementation((state) => {
      if (state.phase === "succeeded") { expect(h.store.value(h.actor)).toBeUndefined(); expect(h.onCreated).toHaveBeenCalledTimes(1); h.stale(); h.controller.detach(); }
    });
    expect(await h.controller.submit(draft())).toBe(true); expect(h.controller.getState()).toMatchObject({ phase: "succeeded", jobId: 84 });
  });
  it("duplicate reconcile returns false promptly while first real calendar recovery remains pending", async () => {
    const h = await harness(); h.onCreated.mockResolvedValueOnce(false); await h.controller.submit(draft());
    h.api.operation.mockImplementation(async (_token, _company, key) => operation(key, "saved")); const refresh = deferred<boolean>();
    h.onCreated.mockReturnValueOnce(refresh.promise); const first = h.controller.reconcile(); await spin();
    expect(await h.controller.reconcile()).toBe(false); expect(h.store.remove).not.toHaveBeenCalled();
    refresh.resolve(true); expect(await first).toBe(true); h.controller.detach();
  });
  it("ambiguous rejection removal locks until recovery and never proceeds to reserve or another POST", async () => {
    const signed = actor(); const store = memoryStore(); store.seed(prepared(signed)); const h = await harness({ actor: signed, store });
    h.api.operation.mockImplementation(async (_token, _company, key) => operation(key, "rejected")); await h.controller.restore();
    store.remove.mockRejectedValueOnce(new Error("Rejected record removal failed")); await h.controller.submit(draft());
    expect(h.controller.getState().phase).toBe("uncertain"); await h.controller.submit(draft());
    expect(h.api.create).not.toHaveBeenCalled(); expect(store.reserve).not.toHaveBeenCalled(); expect(store.remove).toHaveBeenCalledTimes(1); h.controller.detach();
  });
});


describe("exact backend mobile 409 mapping", () => {
  it("treats PRECONDITION_FAILED mapped to409CONFLICT as pending, not a payload conflict", async () => {
    const h = await harness(); h.api.create.mockRejectedValue(new JobSyncApiError("The original Job creation request is still pending. Do not retry it with a new operation key.", 409, "CONFLICT"));
    await h.controller.submit(draft()); expect(h.store.value(h.actor)!.phase).toBe("uncertain");
    h.api.operation.mockImplementation(async (_token, _company, key) => operation(key, "pending"));
    await h.controller.reconcile(); expect(h.controller.getState().phase).toBe("pending");
    await h.controller.submit(draft()); expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.newOperationKey).toHaveBeenCalledTimes(1); h.controller.detach();
  });
  it("allows a corrected intent only after a non-payload409 is authoritatively rejected and durably settled", async () => {
    const h = await harness(); h.api.create.mockRejectedValueOnce(new JobSyncApiError("This employee is not available for this schedule.", 409, "CONFLICT"));
    await h.controller.submit(draft()); const original = h.store.value(h.actor)!.operationKey;
    h.api.operation.mockImplementation(async (_token, _company, key) => operation(key, "rejected"));
    await h.controller.reconcile(); expect(h.controller.getState().phase).toBe("rejected");
    expect(await h.controller.submit({ ...draft(), startHour: 10, endHour: 11 })).toBe(true);
    expect(h.api.create).toHaveBeenCalledTimes(2); expect(h.api.create.mock.calls[1][2].operationKey).not.toBe(original); h.controller.detach();
  });
});
