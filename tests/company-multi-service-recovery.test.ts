import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompanyJobController, type CompanyCreateJobDraft, type CompanyCreateJobTransport } from "../lib/company-create-job";
import { createCompanyCreationStore, type CompanyCreationRecord } from "../lib/company-job-creation-storage";
import { JobSyncApiError, type JobSyncCompanyJobCreateInput, type JobSyncCompanyJobDetail,
  type JobSyncCompanyJobPricing, type JobSyncCompanyJobQuote, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";

vi.mock("expo-crypto", () => ({ randomUUID: () => randomUUID(),
  digestStringAsync: async (_algorithm: string, text: string) => createHash("sha256").update(text).digest("hex"),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" } }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked-device-only" }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

let actorSequence = 92000;
let keySequence = 0;
const lines = () => [{ priceBookItemId: 31, quantity: 2, vehiclePriceKey: "premium" }, { priceBookItemId: 32, quantity: 1 }];
const draft = (): Extract<CompanyCreateJobDraft, { customerId: number }> => ({ customerId: 7, lineItems: lines(),
  discount: { kind: "flat", value: 25, code: "TEST" }, date: "2026-12-01", startHour: 9, assignedEmployeeId: "jobsync-50" });
const newDraft = (): Extract<CompanyCreateJobDraft, { newCustomer: unknown }> => {
  const { customerId: _customerId, ...fields } = draft();
  return { ...fields, newCustomer: { firstName: "Casey", lastName: "Example", email: "casey@example.test" } };
};
function signed(): JobSyncNativeSession { const id = ++actorSequence; return { token: `offline-multi-${id}`, portal: "company",
  user: { id, name: "Owner", role: "owner", email: null }, company: { id: 9, name: "Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } }; }
function quote(): JobSyncCompanyJobQuote { return { lines: [
  { priceBookItemId: 31, quantity: 2, name: "Returned Service", unitPrice: 150, lineTotal: 300, durationMinutes: 120, taxable: true, vehiclePriceKey: "premium" },
  { priceBookItemId: 32, quantity: 1, name: "Second Service", unitPrice: 75, lineTotal: 75, durationMinutes: 30, taxable: false, vehiclePriceKey: null },
], subtotal: 375, discount: 25, discountKind: "flat", discountCode: "TEST", taxableSubtotal: 280,
  taxRateBps: 1000, tax: 28, total: 378, totalDurationMinutes: 150, recurrence: null,
  persistence: { taxStored: true, note: "Server persists tax." } }; }
// Save can reprice between quote and CREATE. These are canonical server fixtures,
// not expectations calculated with client discount/tax/duration formulas.
function pricing(): JobSyncCompanyJobPricing { return { lineItems: [
  { id: 501, priceBookItemId: 31, name: "Returned Service", quantity: 2, unitPrice: 160, lineTotal: 320, sortOrder: 0 },
  { id: 502, priceBookItemId: 32, name: "Second Service", quantity: 1, unitPrice: 75, lineTotal: 75, sortOrder: 0 },
], subtotalAmount: 395, discountAmount: 25, taxAmount: 29.6, taxRateBps: 1000, discountKind: "flat", discountCode: "TEST", totalAmount: 399.6 }; }
function detail(request: JobSyncCompanyJobCreateInput): JobSyncCompanyJobDetail { return { id: 84, companyId: 9,
  customerId: request.customerId ?? 73, assignedUserId: request.assignedUserId ?? null, scheduledStartAt: request.scheduledStartAt,
  scheduledEndAt: request.scheduledEndAt ?? "2026-12-01T17:30:00.000Z", amount: 399.6, pricing: pricing(),
  title: "Returned Service", serviceName: "Returned Service", status: "scheduled", customerName: "Customer", assignedName: "Member",
  addressLine1: null, city: null, updatedAt: null, photos: [], enRouteAt: null, onSiteAt: null, completedAt: null }; }
function prepared(actor: JobSyncNativeSession): CompanyCreationRecord { return { version: 1, companyId: 9, userId: actor.user.id,
  operationKey: `original-multi-${++keySequence}`, payload: { customerId: 7, priceBookServiceId: 31, lineItems: lines(),
    discount: { kind: "flat", value: 25, code: "TEST" }, assignedUserId: 50, scheduledStartAt: "2026-12-01T15:00:00.000Z" },
  timezone: "America/Chicago", phase: "prepared", jobId: null, createdAt: "2026-11-16T15:00:00.000Z", updatedAt: "2026-11-16T15:00:00.000Z" }; }
function native() { const data = new Map<string, string>(); const adapter = {
  getItemAsync: vi.fn(async (key: string) => data.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { data.delete(key); }),
}; const raw = createCompanyCreationStore({ platform: "ios", secureStore: adapter });
  const store = { read: vi.fn(raw.read), reserve: vi.fn(raw.reserve), update: vi.fn(raw.update), remove: vi.fn(raw.remove) };
  return { store, adapter, data }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function spin() { for (let index = 0; index < 400; index++) await Promise.resolve(); }
function harness(actor = signed(), protectedStore = native(), factory = createCompanyJobController) {
  let active = true;
  let saved = detail(prepared(actor).payload);
  const api = {
    session: vi.fn<CompanyCreateJobTransport["session"]>(async () => structuredClone(actor)),
    settings: vi.fn<CompanyCreateJobTransport["settings"]>(async () => ({ id: 9, name: "Company", timezone: "America/Chicago" })),
    priceBook: vi.fn<CompanyCreateJobTransport["priceBook"]>(async () => [
      { serviceId: "31", serviceTypeId: 777, name: "Returned Service", basePrice: 125, vehiclePrices: { premium: 150 }, emoji: "", description: "", features: [], imageUrl: null, sortOrder: 0 },
      { serviceId: "32", serviceTypeId: 888, name: "Second Service", basePrice: 75, vehiclePrices: {} as Record<string, number>, emoji: "", description: "", features: [], imageUrl: null, sortOrder: 1 },
    ]),
    customer: vi.fn<CompanyCreateJobTransport["customer"]>(async (_token, id) => ({ id, companyId: 9, firstName: "Casey", lastName: "Example", email: "casey@example.test" })),
    quote: vi.fn<NonNullable<CompanyCreateJobTransport["quote"]>>(async () => quote()),
    create: vi.fn<CompanyCreateJobTransport["create"]>(async (_token, _company, request) => {
      saved = detail(request); return { ...saved, companyId: 9, priceBookServiceId: request.priceBookServiceId ?? 31,
        operation: { key: request.operationKey!, state: "saved", replayed: false } };
    }),
    detail: vi.fn<CompanyCreateJobTransport["detail"]>(async () => structuredClone(saved)),
    jobs: vi.fn<CompanyCreateJobTransport["jobs"]>(async () => []),
    operation: vi.fn<NonNullable<CompanyCreateJobTransport["operation"]>>(async (_token, _company, key) => ({ key, state: "saved", jobId: 84,
      rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null })),
  };
  const onCreated = vi.fn<(job: JobSyncCompanyJobDetail, zone: string) => Promise<boolean>>(async () => true);
  const onState = vi.fn(); const verifyAssignment = vi.fn(async () => true); const newOperationKey = vi.fn(() => `multi-operation-${++keySequence}`);
  const controller = factory({ session: actor, isCurrent: () => active, transport: api, store: protectedStore.store,
    onCreated, onState, verifyAssignment, newOperationKey });
  return { ...protectedStore, actor, api, controller, onCreated, onState, verifyAssignment, newOperationKey,
    value: () => protectedStore.store.read(9, actor.user.id), stale: () => { active = false; } };
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live API forbidden"))));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("multi-service fresh quote and immutable one-POST intent", () => {
  it("line-only intent accepts actual zero-tax breakdown and explicit schedule independent from quote duration", async () => {
    const h = harness(); const input = draft(); delete input.discount; input.endHour = 10;
    const q = { ...quote(), discount: 0, discountKind: null, discountCode: null, taxRateBps: 0, tax: 0, total: 375 };
    h.api.quote.mockResolvedValue(q); const p = { ...pricing(), discountAmount: 0, discountKind: null, discountCode: null, taxAmount: 0, taxRateBps: 0, totalAmount: 395 };
    const create = h.api.create.getMockImplementation()!;
    h.api.create.mockImplementation(async (...args) => ({ ...await create(...args), pricing: p, amount: 395 }));
    h.api.detail.mockImplementation(async () => ({ ...detail(h.api.create.mock.calls[0][2]), pricing: p, amount: 395 }));
    expect(await h.controller.submit(input)).toBe(true); expect(h.api.create.mock.calls[0][2].scheduledEndAt).toBe("2026-12-01T16:00:00.000Z");
    expect(h.api.create.mock.calls[0][2]).not.toHaveProperty("discount"); expect(h.onCreated.mock.calls[0][0].pricing!.taxAmount).toBe(0); h.controller.detach();
  });
  it("discounted serviceId uses a fresh quoted single line, never the old unquoted transport path", async () => {
    const h = harness(); const input: CompanyCreateJobDraft = { customerId: 7, serviceId: "31", vehiclePriceKey: "premium",
      discount: { kind: "percent", value: 10, code: "TEN" }, date: "2026-12-01", startHour: 9 };
    const q: JobSyncCompanyJobQuote = { ...quote(), lines: [{ ...quote().lines[0], quantity: 1, lineTotal: 150, durationMinutes: 60 }],
      subtotal: 150, discount: 15, discountKind: "percent", discountCode: "TEN", taxableSubtotal: 135, tax: 13.5, total: 148.5, totalDurationMinutes: 60 };
    const p: JobSyncCompanyJobPricing = { ...pricing(), lineItems: [{ ...pricing().lineItems[0], quantity: 1, lineTotal: 160 }],
      subtotalAmount: 160, discountAmount: 16, discountKind: "percent", discountCode: "TEN", taxAmount: 14.4, totalAmount: 158.4 };
    h.api.quote.mockResolvedValue(q); const create = h.api.create.getMockImplementation()!;
    h.api.create.mockImplementation(async (...args) => ({ ...await create(...args), pricing: p, amount: 158.4 }));
    h.api.detail.mockImplementation(async () => ({ ...detail(h.api.create.mock.calls[0][2]), pricing: p, amount: 158.4 }));
    expect(await h.controller.submit(input)).toBe(true);
    expect(h.api.quote).toHaveBeenCalledWith(h.actor.token, 9, { lineItems: [{ priceBookItemId: 31, quantity: 1, vehiclePriceKey: "premium" }], discount: input.discount });
    expect(h.api.create.mock.calls[0][2].lineItems).toEqual([{ priceBookItemId: 31, quantity: 1, vehiclePriceKey: "premium" }]); h.controller.detach();
  });
  it("binds a fresh quote before key/reserve/POST, accepts canonical repricing and exact backend all-zero sortOrder", async () => {
    const h = harness(); expect(await h.controller.submit(draft())).toBe(true);
    expect(h.api.quote).toHaveBeenCalledWith(h.actor.token, 9, { lineItems: lines(), discount: { kind: "flat", value: 25, code: "TEST" } });
    expect(h.api.quote.mock.invocationCallOrder[0]).toBeLessThan(h.store.reserve.mock.invocationCallOrder[0]);
    expect(h.store.reserve.mock.invocationCallOrder[0]).toBeLessThan(h.api.create.mock.invocationCallOrder[0]);
    expect(h.api.create).toHaveBeenCalledOnce(); const body = h.api.create.mock.calls[0][2];
    expect(body).toEqual({ customerId: 7, priceBookServiceId: 31, lineItems: lines(), discount: { kind: "flat", value: 25, code: "TEST" },
      assignedUserId: 50, scheduledStartAt: "2026-12-01T15:00:00.000Z", operationKey: expect.any(String) });
    for (const value of [body, body.lineItems, body.lineItems![0], body.lineItems![1], body.discount]) expect(Object.isFrozen(value)).toBe(true);
    expect(h.onCreated).toHaveBeenCalledWith(expect.objectContaining({ amount: 399.6, pricing: pricing() }), "America/Chicago");
    expect(await h.value()).toBeNull(); h.controller.detach();
  });
  it("deep captures lines/discount/new customer before first authentication await", async () => {
    const h = harness(); const auth = deferred<JobSyncNativeSession>(); h.api.session.mockReturnValueOnce(auth.promise);
    const input = newDraft(); delete (input as any).customerId; const save = h.controller.submit(input);
    input.lineItems![0].quantity = 99; input.lineItems![0].vehiclePriceKey = "not-returned"; input.lineItems!.reverse();
    input.discount!.value = 90; input.discount!.code = "MUTATED"; input.newCustomer.firstName = "Changed"; input.startHour = 15;
    auth.resolve(h.actor); expect(await save).toBe(true);
    const body = h.api.create.mock.calls[0][2]; expect(body.lineItems).toEqual(lines()); expect(body.discount).toEqual({ kind: "flat", value: 25, code: "TEST" });
    expect(body.newCustomer).toEqual({ firstName: "Casey", lastName: "Example", email: "casey@example.test" }); expect(Object.isFrozen(body.newCustomer)).toBe(true);
    expect(body).not.toHaveProperty("customerId"); expect(body.scheduledStartAt).toBe("2026-12-01T15:00:00.000Z");
    expect(h.api.customer).toHaveBeenCalledOnce(); expect(h.api.customer).toHaveBeenCalledWith(h.actor.token, 73, 9); h.controller.detach();
  });
  it.each(["absent", "unsupported", "tax-not-stored", "wrong-id", "wrong-quantity", "wrong-tier", "reorder", "money-string", "nan", "duration", "sparse", "recurrence", "extra-field"]) ("quote %s never reserves, allocates a key or falls back", async damage => {
    const h = harness(); const q: any = quote();
    if (damage === "absent") h.api.quote = undefined as any;
    else if (damage === "unsupported") h.api.quote.mockRejectedValue(new JobSyncApiError("Unavailable", 404, "NOT_FOUND"));
    else { if (damage === "tax-not-stored") q.persistence.taxStored = false;
      if (damage === "wrong-id") q.lines[1].priceBookItemId = 999;
      if (damage === "wrong-quantity") q.lines[0].quantity = 1;
      if (damage === "wrong-tier") q.lines[0].vehiclePriceKey = null;
      if (damage === "reorder") q.lines.reverse();
      if (damage === "money-string") q.total = "378";
      if (damage === "nan") q.lines[1].lineTotal = NaN;
      if (damage === "duration") q.totalDurationMinutes = 0;
      if (damage === "sparse") delete q.lines[1];
      if (damage === "recurrence") q.recurrence = { type: "weekly" };
      if (damage === "extra-field") q.lines[1].clientTax = 0;
      h.api.quote.mockResolvedValue(q);
    }
    expect(await h.controller.submit(draft())).toBe(false); expect(h.api.create).not.toHaveBeenCalled();
    expect(h.store.reserve).not.toHaveBeenCalled(); expect(h.newOperationKey).not.toHaveBeenCalled(); expect(await h.value()).toBeNull(); h.controller.detach();
  });
  it.each(["duplicate", "fractional", "zero", "over-100", "over-50", "unknown-line", "bad-discount", "both-customers"]) ("invalid %s intent stops before first await", async damage => {
    const h = harness(); const input: any = draft();
    if (damage === "duplicate") input.lineItems[1].priceBookItemId = 31;
    if (damage === "fractional") input.lineItems[0].quantity = 1.5;
    if (damage === "zero") input.lineItems[0].quantity = 0;
    if (damage === "over-100") input.lineItems[0].quantity = 101;
    if (damage === "over-50") input.lineItems = Array.from({ length: 51 }, (_, index) => ({ priceBookItemId: index + 1, quantity: 1 }));
    if (damage === "unknown-line") input.lineItems[0].unitPrice = 1;
    if (damage === "bad-discount") input.discount = { kind: "percent", value: 101 };
    if (damage === "both-customers") input.newCustomer = { firstName: "A", lastName: "B" };
    expect(await h.controller.submit(input)).toBe(false); expect(h.api.session).not.toHaveBeenCalled(); expect(h.api.create).not.toHaveBeenCalled(); h.controller.detach();
  });
  it.each(["second-retired", "second-rate", "duplicate-catalog", "missing-required-rate", "legacy-mismatch", "tier-mismatch", "assignment"]) ("reverifies %s without quote or reservation", async damage => {
    const h = harness(); const input = draft(); const catalog = await h.api.priceBook("offline");
    if (damage === "second-retired") h.api.priceBook.mockResolvedValue(catalog.slice(0, 1));
    if (damage === "second-rate") input.lineItems![1].vehiclePriceKey = "fabricated";
    if (damage === "duplicate-catalog") h.api.priceBook.mockResolvedValue([...catalog, catalog[1]]);
    if (damage === "missing-required-rate") { h.api.priceBook.mockResolvedValue([{ ...catalog[0], basePrice: 0 }, catalog[1]]); delete input.lineItems![0].vehiclePriceKey; }
    if (damage === "legacy-mismatch") input.serviceId = "777";
    if (damage === "tier-mismatch") input.vehiclePriceKey = "fabricated";
    if (damage === "assignment") h.verifyAssignment.mockResolvedValue(false);
    expect(await h.controller.submit(input)).toBe(false); expect(h.api.quote).not.toHaveBeenCalled(); expect(h.api.create).not.toHaveBeenCalled(); expect(h.store.reserve).not.toHaveBeenCalled(); h.controller.detach();
  });
  it.each(["detach", "token", "company", "role", "actor"]) ("late quote under changed %s scope cannot reserve or create", async change => {
    const h = harness(); const waiting = deferred<JobSyncCompanyJobQuote>(); h.api.quote.mockReturnValueOnce(waiting.promise);
    const save = h.controller.submit(draft()); await spin(); expect(h.api.quote).toHaveBeenCalledOnce();
    if (change === "detach") { h.stale(); h.controller.detach(); }
    else { const actor = structuredClone(h.actor); if (change === "token") actor.token = "changed"; if (change === "company") actor.company!.id = 10;
      if (change === "role") actor.user.role = "technician"; if (change === "actor") actor.user.id++;
      h.api.session.mockResolvedValue(actor); }
    waiting.resolve(quote()); expect(await save).toBe(false); expect(h.api.create).not.toHaveBeenCalled(); expect(h.store.reserve).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("actor-wide exclusion survives a second controller and rapid taps during quote", async () => {
    const h = harness(); const waiting = deferred<JobSyncCompanyJobQuote>(); h.api.quote.mockReturnValueOnce(waiting.promise);
    const save = h.controller.submit(draft()); await spin(); const other = harness(h.actor, h);
    expect(await Promise.all([h.controller.submit(draft()), other.controller.submit(draft())])).toEqual([false, false]);
    expect(other.api.quote).not.toHaveBeenCalled(); waiting.resolve(quote()); expect(await save).toBe(true); expect(h.api.create).toHaveBeenCalledOnce();
    h.controller.detach(); other.controller.detach();
  });
});

describe("multi-service GET-only recovery and calendar acknowledgment", () => {
  it("response loss -> module restart -> operation Job ID only -> genuine detail with no nonexistent tier/duration fields", async () => {
    const h = harness(); const create = h.api.create.getMockImplementation()!;
    h.api.create.mockImplementationOnce(async (...args) => { await create(...args); throw new Error("Response lost after commit"); });
    expect(await h.controller.submit(draft())).toBe(false); const original = (await h.value())!; expect(original.phase).toBe("uncertain"); h.controller.detach();
    vi.resetModules(); const factory = (await import("../lib/company-create-job")).createCompanyJobController;
    const restart = harness({ ...h.actor, token: "renewed-offline-token" }, h, factory);
    restart.api.detail.mockResolvedValue(detail(original.payload)); restart.onCreated.mockResolvedValueOnce(false);
    expect(await restart.controller.restore()).toBe(false); expect((await restart.value())!.payload).toEqual(original.payload);
    expect(restart.controller.getState()).toMatchObject({ phase: "saved", jobId: 84 }); expect(restart.api.quote).not.toHaveBeenCalled(); expect(restart.api.create).not.toHaveBeenCalled();
    expect(restart.api.operation).toHaveBeenCalledWith(restart.actor.token, 9, original.operationKey);
    expect(await restart.controller.reconcile()).toBe(true); expect(restart.onCreated.mock.calls[0][0].pricing!.lineItems[0]).not.toHaveProperty("vehiclePriceKey");
    expect(restart.onCreated.mock.calls[0][0].pricing!.lineItems[0]).not.toHaveProperty("durationMinutes"); expect(await restart.value()).toBeNull(); restart.controller.detach();
  });
  it.each(["unknown", "pending"] as const) ("%s never quotes, rewrites intent, clears, or resends", async state => {
    const actor = signed(); const protectedStore = native(); const original = prepared(actor); await protectedStore.store.reserve(original);
    const h = harness(actor, protectedStore); h.api.operation.mockImplementation(async (_token, _company, key) => ({ key, state, jobId: null, rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null }));
    await h.controller.restore(); await h.controller.submit({ ...draft(), lineItems: [{ priceBookItemId: 32, quantity: 8 }] }); await h.controller.reconcile();
    expect(h.api.quote).not.toHaveBeenCalled(); expect(h.api.create).not.toHaveBeenCalled(); expect(h.newOperationKey).not.toHaveBeenCalled();
    expect((await h.value())!.payload).toEqual(original.payload); expect(h.store.remove).not.toHaveBeenCalled(); h.controller.detach();
  });
  it.each(["missing-pricing", "tax-null", "rate-null", "wrong-id", "wrong-quantity", "reorder", "money-string", "negative", "wrong-total", "duplicate-id", "sparse", "discount-kind", "discount-code", "missing-end"]) ("saved %s detail stays locked, never clears or calls calendar", async damage => {
    const actor = signed(); const protectedStore = native(); const original = prepared(actor); await protectedStore.store.reserve(original);
    const h = harness(actor, protectedStore); const saved: any = detail(original.payload);
    if (damage === "missing-pricing") delete saved.pricing;
    if (damage === "tax-null") saved.pricing.taxAmount = null;
    if (damage === "rate-null") saved.pricing.taxRateBps = null;
    if (damage === "wrong-id") saved.pricing.lineItems[1].priceBookItemId = 999;
    if (damage === "wrong-quantity") saved.pricing.lineItems[0].quantity = 1;
    if (damage === "reorder") saved.pricing.lineItems.reverse();
    if (damage === "money-string") saved.pricing.lineItems[0].unitPrice = "160";
    if (damage === "negative") saved.pricing.subtotalAmount = -1;
    if (damage === "wrong-total") saved.pricing.totalAmount = 378;
    if (damage === "duplicate-id") saved.pricing.lineItems[1].id = 501;
    if (damage === "sparse") delete saved.pricing.lineItems[1];
    if (damage === "discount-kind") saved.pricing.discountKind = "percent";
    if (damage === "discount-code") saved.pricing.discountCode = "OTHER";
    if (damage === "missing-end") saved.scheduledEndAt = null;
    h.api.detail.mockResolvedValue(saved); expect(await h.controller.restore()).toBe(false);
    expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 84 }); expect(h.onCreated).not.toHaveBeenCalled(); expect(h.store.remove).not.toHaveBeenCalled();
    await h.controller.submit(draft()); expect(h.api.create).not.toHaveBeenCalled(); expect(h.api.quote).not.toHaveBeenCalled(); expect((await h.value())!.payload).toEqual(original.payload); h.controller.detach();
  });
  it("malformed creation pricing remains uncertain with immutable operation, then GET-only readback recovers", async () => {
    const h = harness(); const create = h.api.create.getMockImplementation()!;
    h.api.create.mockImplementationOnce(async (...args) => { const ack = await create(...args); return { ...ack, pricing: undefined }; });
    expect(await h.controller.submit(draft())).toBe(false); expect(h.controller.getState().phase).toBe("uncertain");
    expect(h.onCreated).not.toHaveBeenCalled(); expect(await h.controller.reconcile()).toBe(true); expect(h.api.create).toHaveBeenCalledOnce(); expect(h.api.quote).toHaveBeenCalledOnce(); h.controller.detach();
  });
  it("never removes while actual calendar load is pending or acknowledges false", async () => {
    const h = harness(); const calendar = deferred<boolean>(); h.onCreated.mockReturnValueOnce(calendar.promise);
    const save = h.controller.submit(draft()); await spin(); expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 84, reconciling: true });
    expect(h.store.remove).not.toHaveBeenCalled(); expect((await h.value())!.payload.lineItems).toEqual(lines());
    calendar.resolve(false); expect(await save).toBe(false); expect(h.store.remove).not.toHaveBeenCalled();
    expect(await h.controller.reconcile()).toBe(true); expect(h.store.remove).toHaveBeenCalledOnce(); expect(h.api.create).toHaveBeenCalledOnce(); expect(h.api.quote).toHaveBeenCalledOnce(); h.controller.detach();
  });
  it("rejected intent survives failed fresh quote and only a deliberate correction/new key saves", async () => {
    const h = harness(); h.api.create.mockRejectedValueOnce(new JobSyncApiError("Invalid schedule", 400, "BAD_REQUEST")); await h.controller.submit(draft());
    const original = (await h.value())!; h.api.operation.mockImplementation(async (_token, _company, key) => ({ key, state: "rejected", jobId: null, rejectionCode: "BAD_REQUEST", rejectionMessage: "Correct schedule.", createdAt: null, updatedAt: null }));
    await h.controller.reconcile(); expect(h.controller.getState().phase).toBe("rejected");
    h.api.quote.mockRejectedValueOnce(new Error("Quote unavailable")); expect(await h.controller.submit(draft())).toBe(false);
    expect(h.store.remove).not.toHaveBeenCalled(); expect((await h.value())!.payload).toEqual(original.payload);
    expect(await h.controller.submit(draft())).toBe(true); expect(h.api.create).toHaveBeenCalledTimes(2); expect(h.api.create.mock.calls[1][2].operationKey).not.toBe(original.operationKey); h.controller.detach();
  });
  it("payload conflict cannot be unlocked by later rejected GET or changed line/discount intent", async () => {
    const h = harness(); h.api.create.mockRejectedValue(new JobSyncApiError("This Job creation operation key was already used with a different payload.", 409, "CONFLICT"));
    await h.controller.submit(draft()); const original = (await h.value())!;
    h.api.operation.mockImplementation(async (_token, _company, key) => ({ key, state: "rejected", jobId: null, rejectionCode: "BAD_REQUEST", rejectionMessage: "Rejected", createdAt: null, updatedAt: null }));
    await h.controller.reconcile(); await h.controller.submit({ ...draft(), discount: { kind: "percent", value: 10 } });
    expect(await h.value()).toEqual(original); expect(h.api.create).toHaveBeenCalledOnce(); expect(h.api.quote).toHaveBeenCalledOnce(); expect(h.store.remove).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("legacy serviceId draft and v1 legacy stored record need no quote or pricing", async () => {
    const h = harness(); h.api.quote = undefined as any;
    const create = h.api.create.getMockImplementation()!;
    h.api.create.mockImplementation(async (...args) => { const ack = await create(...args); return { ...ack, pricing: undefined, amount: 125 }; });
    h.api.detail.mockImplementation(async () => ({ ...detail({ customerId: 7, priceBookServiceId: 31, assignedUserId: 50, scheduledStartAt: "2026-12-01T15:00:00.000Z" }), amount: 125, pricing: undefined }));
    expect(await h.controller.submit({ customerId: 7, serviceId: "31", date: "2026-12-01", startHour: 9, assignedEmployeeId: "jobsync-50" })).toBe(true); h.controller.detach();
    const actor = signed(); const protectedStore = native(); const original = prepared(actor); delete original.payload.lineItems; delete original.payload.discount;
    await protectedStore.store.reserve(original); const old = harness(actor, protectedStore); old.api.quote = undefined as any;
    old.api.detail.mockResolvedValue({ ...detail(original.payload), pricing: undefined, amount: 125 });
    expect(await old.controller.restore()).toBe(true); expect(old.api.create).not.toHaveBeenCalled(); old.controller.detach();
  });
});

describe("strict additive protected v1 line/discount storage", () => {
  it("round-trips all 50 lines without requiring the optional legacy ID", async () => {
    const actor = signed(); const h = native(); const original = prepared(actor); delete original.payload.priceBookServiceId;
    original.payload.lineItems = Array.from({ length: 50 }, (_, index) => ({ priceBookItemId: index + 1, quantity: 100 }));
    expect(await h.store.reserve(original)).toBe(true); expect(await h.store.read(9, actor.user.id)).toEqual(original);
    expect(h.adapter.setItemAsync.mock.calls.at(-1)![0]).toMatch(/\.manifest$/);
  });
  it("deep captures before queue, freezes every nested layer, preserves null/absent tier and discount bytes", async () => {
    const actor = signed(); const h = native(); const original = prepared(actor); original.payload.lineItems![1].vehiclePriceKey = null;
    original.payload.discount!.code = ""; const expected = structuredClone(original); const save = h.store.reserve(original);
    original.payload.lineItems![0].quantity = 99; original.payload.discount!.value = 99;
    expect(await save).toBe(true); const recovered = (await h.store.read(9, actor.user.id))!; expect(recovered).toEqual(expected);
    for (const value of [recovered, recovered.payload, recovered.payload.lineItems, recovered.payload.lineItems![0], recovered.payload.discount]) expect(Object.isFrozen(value)).toBe(true);
    expect(await createCompanyCreationStore({ platform: "android", secureStore: h.adapter }).read(9, actor.user.id)).toEqual(expected);
    expect([...h.data.values()].every(text => /^[\x00-\x7f]*$/.test(text))).toBe(true);
  });
  it.each(["quantity", "order", "tier", "discount", "discount-code", "remove-discount", "remove-lines"]) ("immutable %s cannot update a reserved request", async damage => {
    const actor = signed(); const h = native(); const original = prepared(actor); await h.store.reserve(original);
    const next = structuredClone(original); next.phase = "uncertain";
    if (damage === "quantity") next.payload.lineItems![0].quantity = 3;
    if (damage === "order") next.payload.lineItems!.reverse();
    if (damage === "tier") next.payload.lineItems![0].vehiclePriceKey = null;
    if (damage === "discount") next.payload.discount!.value = 5;
    if (damage === "discount-code") next.payload.discount!.code = "OTHER";
    if (damage === "remove-discount") delete next.payload.discount;
    if (damage === "remove-lines") delete next.payload.lineItems;
    await expect(h.store.update(next)).rejects.toThrow("could not be verified"); expect(await h.store.read(9, actor.user.id)).toEqual(original);
  });
  it.each(["unknown-line", "unknown-discount", "duplicate", "untrimmed-tier", "untrimmed-code", "null-discount", "sparse", "legacy-mismatch", "client-price"]) ("malformed %s is rejected before protected writes", async damage => {
    const actor = signed(); const h = native(); const value: any = prepared(actor);
    if (damage === "unknown-line") value.payload.lineItems[0].durationMinutes = 60;
    if (damage === "unknown-discount") value.payload.discount.amount = 25;
    if (damage === "duplicate") value.payload.lineItems[1].priceBookItemId = 31;
    if (damage === "untrimmed-tier") value.payload.lineItems[0].vehiclePriceKey = " premium ";
    if (damage === "untrimmed-code") value.payload.discount.code = " TEST ";
    if (damage === "null-discount") value.payload.discount = null;
    if (damage === "sparse") delete value.payload.lineItems[1];
    if (damage === "legacy-mismatch") value.payload.priceBookServiceId = 32;
    if (damage === "client-price") value.payload.totalAmount = 1;
    await expect(h.store.reserve(value)).rejects.toThrow("could not be verified"); expect(h.adapter.setItemAsync).not.toHaveBeenCalled();
  });
  it("hash-valid corruption still prevents read/reserve/update/remove and retains manifest", async () => {
    const actor = signed(); const h = native(); const original = prepared(actor); await h.store.reserve(original);
    const manifestKey = `hsc_company_job_creation_v1.9.${actor.user.id}.manifest`; const manifest = JSON.parse(h.data.get(manifestKey)!);
    const chunkKey = `hsc_company_job_creation_v1.9.${actor.user.id}.${manifest.snapshot}.0`; const value = JSON.parse(h.data.get(chunkKey)!);
    value.payload.lineItems[1].taxable = false; const raw = JSON.stringify(value); h.data.set(chunkKey, raw);
    manifest.bytes = raw.length; manifest.sha256 = createHash("sha256").update(raw).digest("hex"); h.data.set(manifestKey, JSON.stringify(manifest));
    for (const action of [() => h.store.read(9, actor.user.id), () => h.store.reserve(original), () => h.store.update(original), () => h.store.remove(9, actor.user.id, original.operationKey)]) await expect(action()).rejects.toThrow("could not be verified");
    expect(h.data.has(manifestKey)).toBe(true);
  });
});
