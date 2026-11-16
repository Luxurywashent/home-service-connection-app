import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryCreationStorageModule } from "./helpers/company-creation-memory-store";
import { createCompanyJobController, type CompanyCreateJobDraft, type CompanyCreateJobTransport } from "../lib/company-create-job";
import { createJobSyncCompanyJob, createJobSyncCompanyJobPayload, getJobSyncCompanyJobCreationOperation, normalizeCompanyJobNewCustomer,
  JobSyncApiError, type JobSyncCompanyJobCreateInput, type JobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";
vi.mock("../lib/company-job-creation-storage", async () => {
  const { memoryCreationStorageModule } = await import("./helpers/company-creation-memory-store");
  return memoryCreationStorageModule();
});
const KEY = "hsc-job-new-customer-fixture";
const nested = () => ({ firstName: " Casey ", lastName: " Example ", email: " CASEY@example.test ", phone: "+1 (555) 123-4567", addressLine1: " 10 Fixture Street ", city: " Fixture City ", region: " FL ", postalCode: " 32501 " });
const canonical = () => normalizeCompanyJobNewCustomer(nested());
const request = (): JobSyncCompanyJobCreateInput => ({ newCustomer: nested(), priceBookServiceId: 31, operationKey: KEY,
  scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T16:00:00.000Z" });
const draft = (): Extract<CompanyCreateJobDraft, { newCustomer: unknown }> => ({ newCustomer: nested(), serviceId: "31", date: "2026-12-01", startHour: 9, endHour: 10, assignedEmployeeId: "jobsync-50" });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
let nextActor = 54000;
function actor(): JobSyncNativeSession { const id = ++nextActor; return { token: `offline-new-${id}`, portal: "company", user: { id, name: "Owner", email: null, role: "owner" }, company: { id: 9, name: "Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } }; }
function job(): JobSyncCompanyJobDetail { return { id: 84, companyId: 9, customerId: 73, assignedUserId: 50, scheduledStartAt: request().scheduledStartAt, scheduledEndAt: request().scheduledEndAt!, amount: 125, status: "scheduled", title: "Service", serviceName: "Service", customerName: "Casey Example", assignedName: "Technician", updatedAt: null, addressLine1: "10 Fixture Street", city: "Fixture City", photos: [], enRouteAt: null, onSiteAt: null, completedAt: null }; }
const profile = () => ({ ...canonical(), id: 73, companyId: 9, name: "Casey Example" });
const op = (key: string, state: "saved" | "unknown" | "pending" | "rejected", extra: Record<string, unknown> = {}) => ({ key, state, jobId: state === "saved" ? 84 : null, rejectionCode: state === "rejected" ? "BAD_REQUEST" : null, rejectionMessage: state === "rejected" ? "Correct this fixture request." : null, createdAt: null, updatedAt: null, ...extra });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
async function spin() { for (let i = 0; i < 120; i++) await Promise.resolve(); }
function harness(signed = actor(), store = memoryCreationStorageModule().companyCreationStore, factory = createCompanyJobController) {
  let active = true;
  const api = {
    session: vi.fn<CompanyCreateJobTransport["session"]>(async () => structuredClone(signed)),
    settings: vi.fn<CompanyCreateJobTransport["settings"]>(async () => ({ id: 9, name: "Company", timezone: "America/Chicago" })),
    priceBook: vi.fn<CompanyCreateJobTransport["priceBook"]>(async () => [{ serviceId: "31", name: "Service", basePrice: 125, vehiclePrices: {}, emoji: "", description: "", features: [], imageUrl: null, sortOrder: 0, serviceTypeId: 444 }]),
    customer: vi.fn<CompanyCreateJobTransport["customer"]>(async () => profile()),
    create: vi.fn<CompanyCreateJobTransport["create"]>(async (_token, _company, input) => ({ ...job(), companyId: 9, priceBookServiceId: 31, operation: { key: input.operationKey!, state: "saved", replayed: false } })),
    detail: vi.fn<CompanyCreateJobTransport["detail"]>(async () => job()), jobs: vi.fn<CompanyCreateJobTransport["jobs"]>(async () => []),
    operation: vi.fn<NonNullable<CompanyCreateJobTransport["operation"]>>(async (_token, _company, key) => op(key, "unknown")),
  };
  const onCreated = vi.fn(async () => true); const newOperationKey = vi.fn(() => `${KEY}-${++nextActor}`);
  const verifyAssignment = vi.fn(async () => true);
  const controller = factory({ session: signed, isCurrent: () => active, transport: api, store, onCreated, onState: vi.fn(), verifyAssignment, newOperationKey });
  return { signed, store, api, onCreated, controller, newOperationKey, verifyAssignment, stale: () => { active = false; } };
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden"))));
afterEach(() => vi.unstubAllGlobals());
describe("new customer and Job transport: strict XOR, one POST", () => {
  it("normalizes only allowed nested fields, omits blank optional fields and freezes both levels", () => {
    const body = createJobSyncCompanyJobPayload(request());
    expect(body).not.toHaveProperty("customerId"); expect(body.newCustomer).toEqual(canonical());
    expect(Object.isFrozen(body)).toBe(true); expect(Object.isFrozen(body.newCustomer)).toBe(true);
    expect(normalizeCompanyJobNewCustomer({ firstName: " A ", lastName: " B ", email: " ", phone: " ", city: " " })).toEqual({ firstName: "A", lastName: "B" });
  });
  it.each(["5551234", "5551234567", "15551234567"])("accepts canonical phone digit shape %s", phone => expect(normalizeCompanyJobNewCustomer({ firstName: "A", lastName: "B", phone }).phone).toBe(phone.length === 11 ? phone.slice(1) : phone));
  const invalid = [null, {}, { ...nested(), firstName: " " }, { ...nested(), lastName: " " }, { ...nested(), email: "bad@" }, { ...nested(), email: "x".repeat(321) }, { ...nested(), phone: "123" }, { ...nested(), phone: "25551234567" }, { ...nested(), phone: "1".repeat(65) }, { ...nested(), firstName: "x".repeat(121) }, { ...nested(), lastName: "x".repeat(121) }, { ...nested(), addressLine1: "x".repeat(256) }, { ...nested(), city: "x".repeat(97) }, { ...nested(), region: "x".repeat(97) }, { ...nested(), postalCode: "x".repeat(25) }, { ...nested(), companyId: 99 }, { ...nested(), email: null }];
  it.each(invalid)("invalid nested customer fails before POST: %j", async value => {
    await expect(createJobSyncCompanyJob("offline", 9, { ...request(), newCustomer: value } as any)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ ...request(), customerId: 7 }, { priceBookServiceId: 31, scheduledStartAt: request().scheduledStartAt }, { ...request(), operationKey: undefined }, { ...request(), notifyCustomer: true }])("rejects selector/key/unknown request violation before POST: %j", async value => {
    await expect(createJobSyncCompanyJob("offline", 9, value as any)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it("posts customer and Job together once and accepts a positive canonical customer acknowledgment", async () => {
    const row = { ...job(), priceBookServiceId: 31 }; const input = { ...request(), assignedUserId: 50 };
    const mock = vi.fn().mockResolvedValue(response({ job: row, operation: { key: KEY, state: "saved", replayed: false } }, 201)); vi.stubGlobal("fetch", mock);
    expect(await createJobSyncCompanyJob("offline", 9, input)).toMatchObject({ id: 84, customerId: 73 });
    expect(mock).toHaveBeenCalledOnce(); expect(mock.mock.calls[0][0]).toMatch(/\/company\/jobs$/);
    const body = JSON.parse(mock.mock.calls[0][1].body); expect(body.newCustomer).toEqual(canonical()); expect(body).not.toHaveProperty("customerId");
  });
  it.each([{ customerId: 0 }, { customerId: "73" }, { companyId: 10 }])("rejects noncanonical acknowledgment without resend: %j", async patch => {
    const mock = vi.fn().mockResolvedValue(response({ job: { ...job(), priceBookServiceId: 31, ...patch }, operation: { key: KEY, state: "saved", replayed: false } }, 201)); vi.stubGlobal("fetch", mock);
    await expect(createJobSyncCompanyJob("offline", 9, { ...request(), assignedUserId: 50 })).rejects.toThrow(); expect(mock).toHaveBeenCalledOnce();
  });
  it("supports saved GET with optional canonical customer ID without requiring it", async () => {
    const mock = vi.fn().mockResolvedValueOnce(response({ operation: op(KEY, "saved") })).mockResolvedValueOnce(response({ operation: op(KEY, "saved", { customerId: 73 }) })); vi.stubGlobal("fetch", mock);
    expect(await getJobSyncCompanyJobCreationOperation("offline", 9, KEY)).not.toHaveProperty("customerId");
    expect(await getJobSyncCompanyJobCreationOperation("offline", 9, KEY)).toMatchObject({ customerId: 73 });
  });
  it.each([op(KEY, "pending", { customerId: 73 }), op(KEY, "saved", { customerId: 0 }), op(KEY, "saved", { customerId: "73" })])("rejects malformed optional saved customer metadata: %j", async operation => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ operation }))); await expect(getJobSyncCompanyJobCreationOperation("offline", 9, KEY)).rejects.toThrow();
  });
});
describe("new customer durable controller and exact-ID readback", () => {
  it("deep-captures nested caller intent before FIRST await and reserves it before the one POST", async () => {
    const h = harness(); const auth = deferred<JobSyncNativeSession>(); h.api.session.mockReturnValueOnce(auth.promise);
    const input = draft(); const saving = h.controller.submit(input); input.newCustomer.firstName = "Mutation"; input.newCustomer.email = "changed@example.test"; input.startHour = 15;
    expect(h.api.create).not.toHaveBeenCalled(); auth.resolve(h.signed); expect(await saving).toBe(true);
    expect(h.api.create).toHaveBeenCalledOnce(); const body = h.api.create.mock.calls[0][2]; expect(body.newCustomer).toEqual(canonical()); expect(Object.isFrozen(body.newCustomer)).toBe(true);
    expect(body.scheduledStartAt).toBe(request().scheduledStartAt); expect(h.api.customer).toHaveBeenCalledOnce(); expect(h.api.customer).toHaveBeenCalledWith(h.signed.token, 73, 9);
    expect(h.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 84, customerId: 73 }), "America/Chicago"); h.controller.detach();
  });
  it.each([{ firstName: "" }, { lastName: "" }, { email: "bad" }, { phone: "12" }, { city: "x".repeat(97) }, { actorId: 9 }])("invalid new intent %j never creates/reserves", async patch => {
    const h = harness(); await h.controller.submit({ ...draft(), newCustomer: { ...nested(), ...patch } } as any); expect(h.api.create).not.toHaveBeenCalled(); expect(h.newOperationKey).not.toHaveBeenCalled(); expect(await h.store.read(9, h.signed.user.id)).toBeNull(); h.controller.detach();
  });
  it.each(["unknown", "pending"] as const)("response loss and %s status stays same-key read-only across module restart", async state => {
    const h = harness(); h.api.create.mockRejectedValue(new Error("Dropped simulated response")); await h.controller.submit(draft()); const retained = (await h.store.read(9, h.signed.user.id))!;
    expect(retained.payload.newCustomer).toEqual(canonical()); h.controller.detach(); vi.resetModules();
    const restarted = harness(h.signed, h.store, (await import("../lib/company-create-job")).createCompanyJobController); restarted.api.operation.mockImplementation(async (_token, _company, key) => op(key, state));
    await restarted.controller.restore(); await restarted.controller.submit(draft()); expect(restarted.api.create).not.toHaveBeenCalled(); expect(restarted.newOperationKey).not.toHaveBeenCalled();
    expect(restarted.api.operation).toHaveBeenCalledWith(h.signed.token, 9, retained.operationKey); expect(restarted.controller.getState().phase).toBe(state === "unknown" ? "uncertain" : "pending"); restarted.controller.detach();
  });
  it("dropped response -> same key GET returning only Job ID -> exact detail/profile -> original calendar IDs", async () => {
    const h = harness(); h.api.create.mockRejectedValue(new Error("Response lost")); await h.controller.submit(draft()); const retained = (await h.store.read(9, h.signed.user.id))!; h.controller.detach(); vi.resetModules();
    const restarted = harness(h.signed, h.store, (await import("../lib/company-create-job")).createCompanyJobController); restarted.api.operation.mockImplementation(async (_token, _company, key) => op(key, "saved"));
    restarted.onCreated.mockResolvedValueOnce(false); expect(await restarted.controller.restore()).toBe(false);
    const saved = (await h.store.read(9, h.signed.user.id))!; expect(saved.resolvedCustomerId).toBe(73); expect(saved.payload).toEqual(retained.payload); expect(saved.payload).not.toHaveProperty("customerId");
    expect(restarted.api.detail).toHaveBeenCalledWith(h.signed.token, 84, 9); expect(restarted.api.customer).toHaveBeenCalledWith(h.signed.token, 73, 9);
    expect(restarted.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 84, customerId: 73 }), "America/Chicago");
    expect(await restarted.controller.reconcile()).toBe(true); expect(restarted.api.create).not.toHaveBeenCalled(); expect(h.api.create).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled(); restarted.controller.detach();
  });
  it("matches normalized profile intent rather than display names or raw email/phone formatting", async () => {
    const h = harness(); h.api.customer.mockResolvedValue({ ...profile(), email: "CASEY@example.test", phone: "+1 (555) 123-4567", name: "Different display label" }); expect(await h.controller.submit(draft())).toBe(true); h.controller.detach();
  });
  it.each([{ id: 74 }, { companyId: 10 }, { firstName: "Other" }, { email: "other@example.test" }, { phone: "5550000000" }, { addressLine1: "Other Street" }, { city: "Other" }])("saved mismatched customer %j locks and preserves canonical IDs", async patch => {
    const h = harness(); h.api.customer.mockResolvedValue({ ...profile(), ...patch }); expect(await h.controller.submit(draft())).toBe(false);
    expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 84 }); const saved = (await h.store.read(9, h.signed.user.id))!; expect(saved.resolvedCustomerId).toBe(73); expect(saved.payload.newCustomer).toEqual(canonical());
    await h.controller.submit(draft()); expect(h.api.create).toHaveBeenCalledOnce(); expect(h.onCreated).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("a different detail/customer after restart never replaces known saved metadata", async () => {
    const h = harness(); h.onCreated.mockResolvedValue(false); await h.controller.submit(draft()); h.controller.detach(); vi.resetModules();
    const restarted = harness(h.signed, h.store, (await import("../lib/company-create-job")).createCompanyJobController); restarted.api.operation.mockImplementation(async (_token, _company, key) => op(key, "saved")); restarted.api.detail.mockResolvedValue({ ...job(), customerId: 74 });
    expect(await restarted.controller.restore()).toBe(false); expect((await h.store.read(9, h.signed.user.id))!.resolvedCustomerId).toBe(73); expect(restarted.api.customer).not.toHaveBeenCalled(); expect(restarted.onCreated).not.toHaveBeenCalled(); restarted.controller.detach();
  });
  it("saved optional operation customer mismatch preserves original canonical customer", async () => {
    const h = harness(); h.onCreated.mockResolvedValue(false); await h.controller.submit(draft()); h.api.operation.mockImplementation(async (_token, _company, key) => op(key, "saved", { customerId: 74 }));
    expect(await h.controller.reconcile()).toBe(false); expect((await h.store.read(9, h.signed.user.id))!.resolvedCustomerId).toBe(73); expect(h.api.create).toHaveBeenCalledOnce(); h.controller.detach();
  });
  it("only authoritative rejection and deliberate correction allow a fresh key", async () => {
    const h = harness(); h.api.create.mockRejectedValueOnce(new Error("Dropped response")); await h.controller.submit(draft()); const old = (await h.store.read(9, h.signed.user.id))!;
    h.api.operation.mockImplementation(async (_token, _company, key) => op(key, "rejected")); await h.controller.reconcile(); expect(h.controller.getState().phase).toBe("rejected"); expect(h.api.create).toHaveBeenCalledOnce();
    const corrected = draft(); corrected.newCustomer.firstName = "Corrected"; h.api.customer.mockResolvedValue({ ...profile(), firstName: "Corrected" }); expect(await h.controller.submit(corrected)).toBe(true);
    expect(h.api.create).toHaveBeenCalledTimes(2); expect(h.api.create.mock.calls[1][2].operationKey).not.toBe(old.operationKey); expect(old.payload.newCustomer).toEqual(canonical()); h.controller.detach();
  });
  it("payload conflict remains locked despite rejected GET and edited new-customer intent", async () => {
    const h = harness(); h.api.create.mockRejectedValue(new JobSyncApiError("This Job creation operation key was already used with a different payload.", 409, "CONFLICT")); await h.controller.submit(draft());
    h.api.operation.mockImplementation(async (_token, _company, key) => op(key, "rejected")); await h.controller.reconcile(); await h.controller.submit(draft()); expect(h.controller.getState().phase).toBe("conflict"); expect(h.api.create).toHaveBeenCalledOnce(); expect(h.newOperationKey).toHaveBeenCalledOnce(); h.controller.detach();
  });
  it("fresh signed scope after delayed customer profile suppresses all callbacks when revoked", async () => {
    const h = harness(); const read = deferred<ReturnType<typeof profile>>(); h.api.customer.mockReturnValueOnce(read.promise); const saving = h.controller.submit(draft()); await spin();
    h.api.session.mockResolvedValue({ ...h.signed, user: { ...h.signed.user, role: "technician" } }); read.resolve(profile()); expect(await saving).toBe(false); expect(h.onCreated).not.toHaveBeenCalled(); expect((await h.store.read(9, h.signed.user.id))!.jobId).toBe(84); h.controller.detach();
  });
});


describe("new customer selector and read-only recovery fail-closed guards", () => {
  it.each([{ ...draft(), customerId: 7 }, { serviceId: "31", date: "2026-12-01", startHour: 9 }, { customerId: undefined, serviceId: "31", date: "2026-12-01", startHour: 9 }, { ...draft(), companyId: 99 }])("malformed draft selector/unknown fields issue no POST or key: %j", async value => {
    const h = harness(); expect(await h.controller.submit(value as any)).toBe(false); expect(h.api.create).not.toHaveBeenCalled(); expect(h.newOperationKey).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("Job-only saved GET persists canonical customer even if profile mismatches, preventing substitution on the next GET", async () => {
    const h = harness(); h.api.create.mockRejectedValue(new Error("Response lost")); await h.controller.submit(draft());
    h.api.operation.mockImplementation(async (_token, _company, key) => op(key, "saved")); h.api.customer.mockResolvedValue({ ...profile(), firstName: "Mismatch" });
    expect(await h.controller.reconcile()).toBe(false); expect((await h.store.read(9, h.signed.user.id))!.resolvedCustomerId).toBe(73);
    h.api.detail.mockResolvedValue({ ...job(), customerId: 74 }); h.api.customer.mockResolvedValue({ ...profile(), id: 74 });
    expect(await h.controller.reconcile()).toBe(false); expect((await h.store.read(9, h.signed.user.id))!.resolvedCustomerId).toBe(73); expect(h.onCreated).not.toHaveBeenCalled(); expect(h.api.create).toHaveBeenCalledOnce(); h.controller.detach();
  });
  it.each(["unknown-nested", "both-selectors", "wrong-company", "resolved-ID"])("injected durable %s corruption never enables POST or callbacks", async damage => {
    const signed = actor(); const store = memoryCreationStorageModule().companyCreationStore;
    const value: any = { version: 1, companyId: 9, userId: signed.user.id, operationKey: KEY, payload: { newCustomer: canonical(), priceBookServiceId: 31, scheduledStartAt: request().scheduledStartAt }, timezone: "America/Chicago", phase: "uncertain", jobId: null, createdAt: "2026-11-16T03:00:00.000Z", updatedAt: "2026-11-16T03:00:00.000Z" };
    value.payload.newCustomer = { ...value.payload.newCustomer };
    if (damage === "unknown-nested") value.payload.newCustomer.tenantId = 10;
    if (damage === "both-selectors") value.payload.customerId = 73;
    if (damage === "resolved-ID") value.resolvedCustomerId = 73;
    const durable = structuredClone(value); if (damage === "wrong-company") durable.companyId = 10;
    store.read = async () => durable;
    const h = harness(signed, store); expect(await h.controller.restore()).toBe(false); expect(await h.controller.submit(draft())).toBe(false);
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.api.operation).not.toHaveBeenCalled(); expect(h.onCreated).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("preserves known saved IDs on missing later status rather than using unknown as negative proof", async () => {
    const h = harness(); h.onCreated.mockResolvedValue(false); await h.controller.submit(draft());
    h.api.operation.mockImplementation(async (_token, _company, key) => op(key, "unknown")); await h.controller.reconcile();
    expect((await h.store.read(9, h.signed.user.id))!).toMatchObject({ phase: "saved", jobId: 84, resolvedCustomerId: 73 }); expect(h.api.create).toHaveBeenCalledOnce(); h.controller.detach();
  });
});
