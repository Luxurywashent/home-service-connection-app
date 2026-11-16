import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createJobSyncCompanyJob, createJobSyncCompanyJobPayload, getJobSyncCompanyJobDetail,
  normalizeCompanyJobLineItems, normalizeCompanyJobDiscount, normalizeCompanyJobQuote,
  normalizeCompanyJobPricing, companyJobPricingMatchesInput, normalizeJobSyncCompanyJobDetail,
  quoteJobSyncCompanyJob, type JobSyncCompanyJobCreateInput, type JobSyncCompanyJobQuoteInput,
} from "../lib/jobsync-mobile-api";

const TOKEN = "mock-phase2b-bearer";
const COMPANY = 9;
const KEY = "mock-phase2b-operation";
const start = "2026-11-20T15:00:00.000Z";
const end = "2026-11-20T18:00:00.000Z";
const lines = () => [{ priceBookItemId: 71, quantity: 2, vehiclePriceKey: " standard " }, { priceBookItemId: 72, quantity: 1 }];
const discount = () => ({ kind: "percent" as const, value: 10, code: " SAVE " });
const quoteInput = (): JobSyncCompanyJobQuoteInput => ({ lineItems: lines(), discount: discount() });
const input = (): JobSyncCompanyJobCreateInput => ({ customerId: 41, lineItems: lines(), discount: discount(),
  assignedUserId: 81, scheduledStartAt: start, scheduledEndAt: end, operationKey: KEY });
const quote = () => ({
  lines: [{ priceBookItemId: 71, name: "First service", quantity: 2, unitPrice: 100, lineTotal: 200,
    durationMinutes: 120, taxable: true, vehiclePriceKey: "standard" },
  { priceBookItemId: 72, name: "Second service", quantity: 1, unitPrice: 120, lineTotal: 120,
    durationMinutes: 60, taxable: false, vehiclePriceKey: null }],
  subtotal: 320, discount: 32, discountKind: "percent", discountCode: "SAVE", taxableSubtotal: 180,
  taxRateBps: 1000, tax: 18, total: 306, totalDurationMinutes: 180, recurrence: null,
  persistence: { taxStored: true, note: "Server stores tax." },
});
const job = () => ({ id: 91, companyId: COMPANY, customerId: 41, priceBookServiceId: 71, assignedUserId: 81,
  title: "First service", serviceName: "First service", status: "scheduled", scheduledStartAt: start,
  scheduledEndAt: end, updatedAt: start, addressLine1: null, city: null, amount: 306,
  customerName: "Casey Example", assignedName: "Taylor Example", photos: [],
  lineItems: [{ id: 1001, priceBookItemId: 71, name: "First service", quantity: 2, unitPrice: 100, lineTotal: 200, sortOrder: 0 },
  { id: 1002, priceBookItemId: 72, name: "Second service", quantity: 1, unitPrice: 120, lineTotal: 120, sortOrder: 0 }],
  subtotalAmount: 320, discountAmount: 32, taxAmount: 18, taxRateBps: 1000, discountKind: "percent", discountCode: "SAVE",
});
const operation = { key: KEY, state: "saved", replayed: false };
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
function mock(value: unknown, status = 200) { const fetch = vi.fn().mockResolvedValue(response(value, status)); vi.stubGlobal("fetch", fetch); return fetch; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden"))));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("strict immutable Company service and discount intent", () => {
  it("copies, trims and freezes all levels without mutating input; no rates or totals are computed", () => {
    const original = input(); const body = createJobSyncCompanyJobPayload(original);
    expect(body).toEqual({ ...original, lineItems: [{ priceBookItemId: 71, quantity: 2, vehiclePriceKey: "standard" }, { priceBookItemId: 72, quantity: 1 }], discount: { kind: "percent", value: 10, code: "SAVE" } });
    expect(body).not.toHaveProperty("priceBookServiceId");
    expect(Object.isFrozen(body)).toBe(true); expect(Object.isFrozen(body.lineItems)).toBe(true);
    expect(body.lineItems!.every(Object.isFrozen)).toBe(true); expect(Object.isFrozen(body.discount)).toBe(true);
    original.lineItems![0].quantity = 10; original.discount!.code = "CHANGED";
    expect(body.lineItems![0].quantity).toBe(2); expect(body.discount!.code).toBe("SAVE");
  });
  it("preserves null and omitted tiers, zero discounts and blank optional codes", () => {
    expect(normalizeCompanyJobLineItems([{ priceBookItemId: 71, quantity: 100, vehiclePriceKey: null }])).toEqual([{ priceBookItemId: 71, quantity: 100, vehiclePriceKey: null }]);
    expect(normalizeCompanyJobDiscount({ kind: "flat", value: 0, code: " " })).toEqual({ kind: "flat", value: 0, code: "" });
    expect(normalizeCompanyJobDiscount({ kind: "flat", value: 999999999 })).toEqual({ kind: "flat", value: 999999999 });
    expect(normalizeCompanyJobDiscount({ kind: "percent", value: 100, code: "x".repeat(80) })).toMatchObject({ value: 100 });
  });
  it("accepts exactly fifty unique services and trimmed tier boundary", () => {
    expect(normalizeCompanyJobLineItems(Array.from({ length: 50 }, (_, i) => ({ priceBookItemId: i + 1, quantity: 1 })))).toHaveLength(50);
    expect(normalizeCompanyJobLineItems([{ priceBookItemId: 71, quantity: 1, vehiclePriceKey: ` ${"r".repeat(64)} ` }])[0].vehiclePriceKey).toHaveLength(64);
  });
  const badLines = [undefined, null, {}, [], new Array(1), Array.from({ length: 51 }, (_, i) => ({ priceBookItemId: i + 1, quantity: 1 })),
    [{ priceBookItemId: 71, quantity: 1 }, { priceBookItemId: 71, quantity: 2 }],
    ...[0, -1, 1.5, "71", Number.MAX_SAFE_INTEGER + 1, NaN, Infinity].map(priceBookItemId => [{ priceBookItemId, quantity: 1 }]),
    ...[undefined, 0, -1, 1.5, 101, "2", NaN, Infinity, null].map(quantity => [{ priceBookItemId: 71, quantity }]),
    ...["", " ", "x".repeat(65), 7, false, {}].map(vehiclePriceKey => [{ priceBookItemId: 71, quantity: 1, vehiclePriceKey }]),
    ...["unitPrice", "lineTotal", "durationMinutes", "taxable", "companyId", "recurrence"].map(field => [{ priceBookItemId: 71, quantity: 1, [field]: 1 }]),
    [{ priceBookItemId: 71, quantity: 1, [Symbol("extra")]: 1 }],
  ];
  it.each(badLines)("rejects malformed or unsafe lines %j before quote/CREATE", async lineItems => {
    expect(() => normalizeCompanyJobLineItems(lineItems)).toThrow();
    await expect(quoteJobSyncCompanyJob(TOKEN, COMPANY, { lineItems } as any)).rejects.toThrow();
    await expect(createJobSyncCompanyJob(TOKEN, COMPANY, { ...input(), lineItems } as any)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects accessor and non-plain nested inputs rather than retaining mutable intent", () => {
    expect(() => normalizeCompanyJobLineItems([{ get priceBookItemId() { return 71; }, quantity: 1 }])).toThrow();
    expect(() => normalizeCompanyJobDiscount(Object.create({ kind: "flat", value: 5 }))).toThrow();
    const extra: any = [{ priceBookItemId: 71, quantity: 1 }]; extra.extra = true;
    expect(() => normalizeCompanyJobLineItems(extra)).toThrow();
  });
  const badDiscounts = [null, [], {}, { kind: "fixed", value: 10 },
    ...[-1, NaN, Infinity, "10", null, 1000000000].map(value => ({ kind: "flat", value })),
    { kind: "percent", value: 100.01 }, { kind: "flat", value: 10, code: "x".repeat(81) },
    ...[null, 7, {}, []].map(code => ({ kind: "flat", value: 10, code })),
    { kind: "flat", value: 10, amount: 1 }, { kind: "flat", value: 10, recurrence: {} },
  ];
  it.each(badDiscounts)("rejects malformed discount %j before any request", async value => {
    expect(() => normalizeCompanyJobDiscount(value)).toThrow();
    await expect(quoteJobSyncCompanyJob(TOKEN, COMPANY, { ...quoteInput(), discount: value } as any)).rejects.toThrow();
    await expect(createJobSyncCompanyJob(TOKEN, COMPANY, { ...input(), discount: value } as any)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["amount", "taxRateBps", "taxAmount", "subtotalAmount", "totalDurationMinutes", "recurrence", "notifyCustomer", "companyId"])("strict new CREATE rejects forbidden field %s", async field => {
    await expect(createJobSyncCompanyJob(TOKEN, COMPANY, { ...input(), [field]: 1 } as any)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it("allows matching legacy service ID with lines but rejects first-service mismatch", async () => {
    expect(createJobSyncCompanyJobPayload({ ...input(), priceBookServiceId: 71 })).toMatchObject({ priceBookServiceId: 71 });
    await expect(createJobSyncCompanyJob(TOKEN, COMPANY, { ...input(), priceBookServiceId: 72 })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ customerId: 41, newCustomer: { firstName: "A", lastName: "B" } }, { customerId: undefined }, { customerId: "41" }, { scheduledEndAt: start }, { scheduledStartAt: "2026-02-30T15:00:00Z" }, { assignedUserId: "81" }, { operationKey: "short" }])("preserves strict selectors/schedule/assignment/key %j", async patch => {
    await expect(createJobSyncCompanyJob(TOKEN, COMPANY, { ...input(), ...patch } as any)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("read-only server quote transport and exact input binding", () => {
  it("POSTs only lines/discount once with bearer and no Company override, schedule or operation key", async () => {
    const fetch = mock({ quote: quote() }); const result = await quoteJobSyncCompanyJob(TOKEN, COMPANY, quoteInput());
    expect(result).toEqual(quote()); expect(Object.isFrozen(result.lines[0])).toBe(true);
    expect(fetch).toHaveBeenCalledOnce(); const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/mobile\/v1\/company\/jobs\/quote$/);
    expect(init).toMatchObject({ method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } });
    expect(JSON.parse(init.body)).toEqual({ lineItems: [{ priceBookItemId: 71, quantity: 2, vehiclePriceKey: "standard" }, { priceBookItemId: 72, quantity: 1 }], discount: { kind: "percent", value: 10, code: "SAVE" } });
  });
  it("captures nested intent before awaiting transport and binds against original bytes after mutation", async () => {
    const wait = deferred<Response>(); const fetch = vi.fn().mockReturnValue(wait.promise); vi.stubGlobal("fetch", fetch);
    const source = quoteInput(); const pending = quoteJobSyncCompanyJob(TOKEN, COMPANY, source);
    source.lineItems[0].quantity = 100; source.lineItems.reverse(); source.discount!.kind = "flat"; source.discount!.code = "CHANGED";
    wait.resolve(response({ quote: quote() })); expect(await pending).toEqual(quote());
    expect(JSON.parse(fetch.mock.calls[0][1].body).lineItems[0].quantity).toBe(2); expect(fetch).toHaveBeenCalledOnce();
  });
  it("returns server monetary and duration values unchanged, never derives formulas from lines", async () => {
    const authoritative = { ...quote(), subtotal: 450, discount: 12.34, taxableSubtotal: 290, tax: 23.67, total: 461.33, totalDurationMinutes: 255 };
    const fetch = mock({ quote: authoritative }); expect(await quoteJobSyncCompanyJob(TOKEN, COMPANY, quoteInput())).toEqual(authoritative); expect(fetch).toHaveBeenCalledOnce();
  });
  it("supports no discount and blank code echo null, without synthesizing tax availability", async () => {
    const noDiscount = { ...quote(), discount: 0, discountKind: null, discountCode: null };
    mock({ quote: noDiscount }); expect(await quoteJobSyncCompanyJob(TOKEN, COMPANY, { lineItems: lines() })).toEqual(noDiscount);
    const withBlank = { ...quote(), discountCode: null }; mock({ quote: withBlank });
    expect(await quoteJobSyncCompanyJob(TOKEN, COMPANY, { lineItems: lines(), discount: { kind: "percent", value: 10, code: " " } })).toEqual(withBlank);
  });
  it.each(["customerId", "companyId", "scheduledStartAt", "operationKey", "recurrence", "amount", "taxRateBps"])("rejects forbidden quote body field %s before request", async field => {
    await expect(quoteJobSyncCompanyJob(TOKEN, COMPANY, { ...quoteInput(), [field]: 1 } as any)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["", "token with spaces", null, 12])("rejects invalid bearer %j before pricing call", async token => {
    await expect(quoteJobSyncCompanyJob(token as any, COMPANY, quoteInput())).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.2, "9", null, Infinity])("rejects invalid Company %j before pricing call", async company => {
    await expect(quoteJobSyncCompanyJob(TOKEN, company as any, quoteInput())).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([null, {}, { data: { quote: quote() } }, { quote: quote(), error: {} }, { quote: null }])("rejects malformed quote envelope %j", async payload => {
    const fetch = mock(payload); await expect(quoteJobSyncCompanyJob(TOKEN, COMPANY, quoteInput())).rejects.toMatchObject({ code: "INVALID_QUOTE_RESPONSE" }); expect(fetch).toHaveBeenCalledOnce();
  });
  const badQuotePatches = [
    ...["subtotal", "discount", "taxableSubtotal", "tax", "total"].flatMap(field => [null, "1", -1].map(value => ({ [field]: value }))),
    ...[null, "1000", -1, 10001, 1000.5].map(taxRateBps => ({ taxRateBps })),
    ...[null, "180", 0, -1, 1.5].map(totalDurationMinutes => ({ totalDurationMinutes })),
    { discountKind: "flat" }, { discountKind: undefined }, { discountCode: "OTHER" }, { discountCode: " SAVE " },
    { discount: 321 }, { taxableSubtotal: 321 }, { recurrence: {} }, { recurrence: undefined },
    ...[null, {}, { taxStored: false, note: "Quote-only old deployment." }, { taxStored: "true", note: "Not trusted." }, { taxStored: true, note: " " }, { taxStored: true, note: "Stored", extra: true }].map(persistence => ({ persistence })),
    { total: undefined }, { priceLock: "invented" }, { lines: [] }, { lines: quote().lines.slice().reverse() }, { lines: [...quote().lines, quote().lines[0]] },
  ];
  it.each(badQuotePatches)("rejects malformed, unsupported or unbound quote %j with no save or retry", async patch => {
    const fetch = mock({ quote: { ...quote(), ...patch } });
    await expect(quoteJobSyncCompanyJob(TOKEN, COMPANY, quoteInput())).rejects.toMatchObject({ code: "INVALID_QUOTE_RESPONSE" }); expect(fetch).toHaveBeenCalledOnce();
  });
  const badLinePatches = [{ priceBookItemId: 72 }, { priceBookItemId: "71" }, { quantity: 1 }, { quantity: "2" },
    { vehiclePriceKey: null }, { vehiclePriceKey: " standard " }, { vehiclePriceKey: "other" }, { vehiclePriceKey: undefined },
    { name: null }, { unitPrice: null }, { unitPrice: "100" }, { unitPrice: -1 }, { lineTotal: null }, { lineTotal: "200" },
    { durationMinutes: "120" }, { durationMinutes: 0 }, { durationMinutes: 1.5 }, { taxable: 1 }, { taxable: null }, { id: 1001 }];
  it.each(badLinePatches)("rejects quote line identity/types/tier mismatch %j", async patch => {
    const expected = quote(); expected.lines[0] = { ...expected.lines[0], ...patch } as any;
    const fetch = mock({ quote: expected }); await expect(quoteJobSyncCompanyJob(TOKEN, COMPANY, quoteInput())).rejects.toMatchObject({ code: "INVALID_QUOTE_RESPONSE" }); expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([201, 202, 206, 400, 401, 403, 404, 409, 500, 503])("rejects quote HTTP%s without downgrade or follow-up calls", async status => {
    const fetch = mock({ quote: quote(), error: { code: "UNSUPPORTED", message: "Fixture unavailable" } }, status);
    await expect(quoteJobSyncCompanyJob(TOKEN, COMPANY, quoteInput())).rejects.toThrow(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("does not retry network ambiguity and preserves HTTP errors", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("Simulated lost response")); vi.stubGlobal("fetch", fetch);
    await expect(quoteJobSyncCompanyJob(TOKEN, COMPANY, quoteInput())).rejects.toThrow("Simulated lost response"); expect(fetch).toHaveBeenCalledOnce();
    mock({ error: { code: "NOT_FOUND", message: "Service not available" } }, 404);
    await expect(quoteJobSyncCompanyJob(TOKEN, COMPANY, quoteInput())).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
  it("provides the same strict pure quote validator for injected controller/UI transports", () => {
    expect(normalizeCompanyJobQuote(quote(), quoteInput())).toEqual(quote());
    expect(normalizeCompanyJobQuote({ ...quote(), persistence: { taxStored: false, note: "old" } }, quoteInput())).toBeNull();
    const changed = quoteInput(); changed.lineItems[0].quantity = 3;
    expect(normalizeCompanyJobQuote(quote(), changed)).toBeNull();
  });
  it("rejects non-finite server financial/duration values through the pure quote validator", () => {
    for (const field of ["subtotal", "discount", "taxableSubtotal", "tax", "total", "taxRateBps", "totalDurationMinutes"]) {
      expect(normalizeCompanyJobQuote({ ...quote(), [field]: NaN }, quoteInput())).toBeNull();
      expect(normalizeCompanyJobQuote({ ...quote(), [field]: Infinity }, quoteInput())).toBeNull();
    }
  });
});

describe("canonical persisted CREATE and GET pricing with legacy compatibility", () => {
  it("accepts exact backend root line shape with repeated sortOrder zero and no quote-only persisted fields", async () => {
    const fetch = mock({ job: job(), operation }, 201); const saved = await createJobSyncCompanyJob(TOKEN, COMPANY, input());
    expect(saved.pricing).toEqual({ lineItems: job().lineItems, subtotalAmount: 320, discountAmount: 32, taxAmount: 18,
      taxRateBps: 1000, discountKind: "percent", discountCode: "SAVE", totalAmount: 306 });
    expect(saved.pricing!.lineItems.map(line => line.sortOrder)).toEqual([0, 0]);
    expect(saved.pricing!.lineItems[0]).not.toHaveProperty("vehiclePriceKey"); expect(saved.pricing!.lineItems[0]).not.toHaveProperty("durationMinutes"); expect(saved.pricing!.lineItems[0]).not.toHaveProperty("taxable");
    expect(fetch).toHaveBeenCalledOnce(); expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("amount");
  });
  it("uses server persisted pricing even when Price Book/tax legitimately changed since quote", async () => {
    const changed = { ...job(), amount: 450, subtotalAmount: 500, discountAmount: 50, taxAmount: 0, taxRateBps: 0,
      lineItems: job().lineItems.map(line => ({ ...line, unitPrice: 200, lineTotal: 300 })) };
    const fetch = mock({ job: changed, operation }, 201); const saved = await createJobSyncCompanyJob(TOKEN, COMPANY, input());
    expect(saved.pricing).toMatchObject({ totalAmount: 450, subtotalAmount: 500, discountAmount: 50, taxAmount: 0 });
    expect(saved.pricing!.lineItems[0].unitPrice).toBe(200); expect(fetch).toHaveBeenCalledOnce();
  });
  it("deep captures lines, discount and same-operation new customer before transport resolves", async () => {
    const wait = deferred<Response>(); const fetch = vi.fn().mockReturnValue(wait.promise); vi.stubGlobal("fetch", fetch);
    const original: JobSyncCompanyJobCreateInput = { newCustomer: { firstName: " Casey ", lastName: " Example " }, lineItems: lines(), discount: discount(),
      scheduledStartAt: start, scheduledEndAt: end, assignedUserId: 81, operationKey: KEY };
    const pending = createJobSyncCompanyJob(TOKEN, COMPANY, original);
    original.lineItems![0].quantity = 9; original.discount!.code = "CHANGED"; original.newCustomer!.firstName = "Changed";
    wait.resolve(response({ job: job(), operation }, 201)); expect(await pending).toMatchObject({ id: 91, customerId: 41 });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ newCustomer: { firstName: "Casey", lastName: "Example" }, lineItems: [{ priceBookItemId: 71, quantity: 2 }, { priceBookItemId: 72, quantity: 1 }], discount: { code: "SAVE" } });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("accepts replay only with exact requested persisted identities, never fabricating missing lines", async () => {
    mock({ job: job(), operation: { ...operation, replayed: true } }, 200);
    expect(await createJobSyncCompanyJob(TOKEN, COMPANY, input())).toMatchObject({ operation: { replayed: true } });
    mock({ job: { ...job(), priceBookServiceId: null }, operation: { ...operation, replayed: true } }, 200);
    await expect(createJobSyncCompanyJob(TOKEN, COMPANY, input())).rejects.toMatchObject({ code: "INVALID_CREATE_RESPONSE" });
  });
  it("keeps GET/photo gallery validation and canonical saved values intact", async () => {
    const canonical = { ...job(), photos: [{ id: 301, imageUrl: "/manus-storage/companies/9/jobs/91/example.jpg", caption: null, uploadedByUserId: 81, createdAt: start }] };
    const fetch = mock({ job: canonical }); const detail = await getJobSyncCompanyJobDetail(TOKEN, 91, COMPANY);
    expect(detail.pricing?.totalAmount).toBe(306); expect(detail.persistedPhotoIds).toEqual([301]); expect(detail.photos).toHaveLength(1);
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/mobile\/v1\/jobs\/91$/); expect(fetch.mock.calls[0][1].method).toBe("GET"); expect(fetch.mock.calls[0][1]).not.toHaveProperty("body");
    expect(normalizeJobSyncCompanyJobDetail({ job: { ...canonical, photos: undefined } }, 91, COMPANY)).toBeNull();
  });
  it("preserves absent legacy pricing and refuses to guess nested pricingBreakdown", async () => {
    const { lineItems, subtotalAmount, discountAmount, taxAmount, taxRateBps, discountKind, discountCode, ...legacy } = job();
    mock({ job: { ...legacy, pricingBreakdown: { lineItems, subtotalAmount, taxAmount } } }, 201);
    const oldInput = { customerId: 41, priceBookServiceId: 71, assignedUserId: 81, scheduledStartAt: start, scheduledEndAt: end };
    expect(await createJobSyncCompanyJob(TOKEN, COMPANY, oldInput)).not.toHaveProperty("pricing");
    const detail = normalizeJobSyncCompanyJobDetail({ job: legacy }, 91, COMPANY); expect(detail).not.toBeNull(); expect(detail).not.toHaveProperty("pricing");
    expect(normalizeCompanyJobPricing(legacy)).toBeUndefined();
  });
  it("normalizes missing legacy taxes to unavailable null, but new CREATE cannot claim verification", async () => {
    const { taxAmount, taxRateBps, discountKind, discountCode, ...legacyPricing } = job();
    const detail = normalizeJobSyncCompanyJobDetail({ job: legacyPricing }, 91, COMPANY);
    expect(detail?.pricing).toMatchObject({ taxAmount: null, taxRateBps: null, discountKind: null, discountCode: null });
    mock({ job: legacyPricing, operation }, 201);
    await expect(createJobSyncCompanyJob(TOKEN, COMPANY, input())).rejects.toMatchObject({ code: "INVALID_CREATE_RESPONSE" });
  });
  it("accepts null legacy service references without inventing ID but rejects them for new request readback", async () => {
    const saved = job(); saved.lineItems[0].priceBookItemId = null as any;
    expect(normalizeJobSyncCompanyJobDetail({ job: saved }, 91, COMPANY)?.pricing?.lineItems[0].priceBookItemId).toBeNull();
    mock({ job: saved, operation }, 201); await expect(createJobSyncCompanyJob(TOKEN, COMPANY, input())).rejects.toMatchObject({ code: "INVALID_CREATE_RESPONSE" });
  });
  const badPricingPatches = [
    ...["subtotalAmount", "discountAmount", "amount"].flatMap(field => [undefined, null, "100", -1].map(value => ({ [field]: value }))),
    { discountAmount: 321 }, ...["taxAmount", "taxRateBps"].flatMap(field => ["0", -1].map(value => ({ [field]: value }))),
    { taxRateBps: 10001 }, { taxRateBps: 1000.5 }, { discountKind: "fixed" }, { discountCode: " CODE " },
    { lineItems: null }, { lineItems: {} }, { lineItems: [{ ...job().lineItems[0], id: 0 }] },
    { lineItems: [{ ...job().lineItems[0], id: "1001" }] }, { lineItems: [job().lineItems[0], job().lineItems[0]] },
    ...[{ quantity: 0 }, { quantity: "2" }, { unitPrice: null }, { unitPrice: "100" }, { lineTotal: -1 }, { sortOrder: -1 }, { sortOrder: "0" }, { name: null }, { priceBookItemId: "71" }].map(patch => ({ lineItems: [{ ...job().lineItems[0], ...patch }, job().lineItems[1]] })),
  ];
  it.each(badPricingPatches)("present malformed pricing %j fails closed for detail and CREATE", async patch => {
    const broken = { ...job(), ...patch };
    expect(normalizeJobSyncCompanyJobDetail({ job: broken }, 91, COMPANY)).toBeNull();
    const fetch = mock({ job: broken, operation }, 201); await expect(createJobSyncCompanyJob(TOKEN, COMPANY, input())).rejects.toMatchObject({ code: "INVALID_CREATE_RESPONSE" }); expect(fetch).toHaveBeenCalledOnce();
  });
  const unboundPricing = [
    { lineItems: [] }, { lineItems: job().lineItems.slice(0, 1) }, { lineItems: job().lineItems.slice().reverse() },
    { lineItems: [{ ...job().lineItems[0], priceBookItemId: 73 }, job().lineItems[1]] },
    { lineItems: [{ ...job().lineItems[0], quantity: 1 }, job().lineItems[1]] },
    { taxAmount: undefined }, { taxAmount: null }, { taxRateBps: undefined }, { taxRateBps: null },
    { discountKind: "flat" }, { discountKind: undefined }, { discountCode: "OTHER" }, { discountCode: undefined },
  ];
  it.each(unboundPricing)("unbound or incomplete new pricing %j never verifies a save", async patch => {
    const fetch = mock({ job: { ...job(), ...patch }, operation }, 201);
    await expect(createJobSyncCompanyJob(TOKEN, COMPANY, input())).rejects.toMatchObject({ code: "INVALID_CREATE_RESPONSE" }); expect(fetch).toHaveBeenCalledOnce();
  });
  it("supports persisted-order validation without requiring unique/index sortOrder", () => {
    const normalized = normalizeCompanyJobPricing(job())!;
    expect(companyJobPricingMatchesInput(normalized, { lineItems: normalizeCompanyJobLineItems(lines()), discount: normalizeCompanyJobDiscount(discount()) })).toBe(true);
    expect(companyJobPricingMatchesInput(normalized, { lineItems: normalizeCompanyJobLineItems(lines().reverse()), discount: normalizeCompanyJobDiscount(discount()) })).toBe(false);
  });
  it.each([{ totalAmount: "306" }, { subtotalAmount: undefined }, { taxAmount: NaN }, { taxRateBps: Infinity },
    { discountAmount: -1 }, { discountKind: undefined }, { discountCode: undefined }, { lineItems: undefined },
    { lineItems: [{ ...job().lineItems[0], unitPrice: "100" }, job().lineItems[1]] }])("pure injected-pricing matcher rejects malformed breakdown %j", patch => {
    expect(companyJobPricingMatchesInput({ ...normalizeCompanyJobPricing(job())!, ...patch } as any, quoteInput())).toBe(false);
  });
  it("pure injected-pricing matcher rejects malformed intent without throwing", () => {
    expect(companyJobPricingMatchesInput(normalizeCompanyJobPricing(job())!, { lineItems: null } as any)).toBe(false);
    expect(companyJobPricingMatchesInput(undefined, quoteInput())).toBe(false);
  });
  it("supports a legacy ID plus discount but keeps the new strict saved breakdown requirement", async () => {
    const saved = { ...job(), amount: 90, subtotalAmount: 100, discountAmount: 10, taxAmount: 0, taxRateBps: 0, discountKind: "flat", discountCode: null,
      lineItems: [{ ...job().lineItems[0], quantity: 1, lineTotal: 100 }] };
    mock({ job: saved, operation }, 201);
    const request = { ...input(), lineItems: undefined, priceBookServiceId: 71, discount: { kind: "flat" as const, value: 10 } };
    expect(await createJobSyncCompanyJob(TOKEN, COMPANY, request)).toMatchObject({ pricing: { totalAmount: 90 } });
  });
});


describe("actual backend new-customer Company field aliases", () => {
  const request = (): JobSyncCompanyJobCreateInput => {
    const { customerId, ...fields } = input();
    return { ...fields, newCustomer: { firstName: "Casey", lastName: "Example" } };
  };
  it("accepts actual c0c63e63 company_id on a verified new-customer multi-service save", async () => {
    const { companyId, ...row } = job();
    const fetch = mock({ job: { ...row, company_id: COMPANY }, operation }, 201);
    expect(await createJobSyncCompanyJob(TOKEN, COMPANY, request())).toMatchObject({ companyId: COMPANY, customerId: 41, id: 91, pricing: { totalAmount: 306 } });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([
    { companyId: COMPANY, company_id: COMPANY + 1 },
    { companyId: COMPANY + 1, company_id: COMPANY },
    { company_id: COMPANY + 1 },
    { company_id: "wrong-company" },
    {},
  ])("rejects absent, malformed or conflicting new-customer Company evidence %j without retry", async companyFields => {
    const { companyId, ...row } = job();
    const fetch = mock({ job: { ...row, ...companyFields }, operation }, 201);
    await expect(createJobSyncCompanyJob(TOKEN, COMPANY, request())).rejects.toMatchObject({ code: "INVALID_CREATE_RESPONSE" });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
