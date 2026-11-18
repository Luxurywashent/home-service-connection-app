import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createCompanyJobController, type CompanyCreateJobTransport } from "../lib/company-create-job";
import { createCompanyCreationStore, type CompanyCreationRecord } from "../lib/company-job-creation-storage";
import { normalizeCompanyJobB29RecurrenceReadback, verifyCompanyJobB29RecurrenceReadback,
  normalizeCompanyJobRecurrenceReceipt, companyJobRecurrenceCalendarDates, type CompanyJobRecurrenceInput, type CompanyJobB29RecurrenceExpected } from "../lib/company-job-recurrence";
import { captureCompanyJobB29OriginalIntent, companyJobB29OriginalIntentJson } from "../lib/company-job-recurrence-b29-intent";
import { normalizeCompanyJobQuote, normalizeJobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";
import { companyRecurrenceReleaseReady } from "../lib/company-verified-contract-release";
import { authority, dates, fixture, recovery, response, sourceHashes, readBackend, type Row } from "./recurrence-fixtures/b29-source-fixture";
vi.mock("expo-crypto", () => ({ randomUUID: () => randomUUID(), CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digestStringAsync: async (_algorithm: unknown, input: string) => createHash("sha256").update(input).digest("hex") }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "protected", getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
const wire = <T = Row>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;
const rule = (type: CompanyJobRecurrenceInput["type"] = "weekly", term: CompanyJobRecurrenceInput["term"] = "1_month", startDate = "2026-11-30"): CompanyJobRecurrenceInput => ({ type, term, startDate, ...(type !== "monthly_date" ? { dayOfWeek: 2 } : {}), ...(type === "monthly_ordinal" ? { ordinal: -1 as const } : {}) });
const base = { customerId: 41, priceBookServiceId: 71, lineItems: [{ priceBookItemId: 71, quantity: 2 }, { priceBookItemId: 72, quantity: 1 }], discount: { kind: "percent" as const, value: 10, code: "TEN" }, assignedUserId: 8, scheduledStartAt: "2026-12-01T15:00:00.000Z", operationKey: "hsc-b29-offline-recurrence-001", notifyCustomer: false };
const evidence: unknown[] = [];
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Production HTTP forbidden"))); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
afterAll(() => writeFileSync("/home/ubuntu/hsc-mobile-b29-final-compatibility-20261117/recurrence-b29-raw-evidence.json", JSON.stringify({ candidateOnly: true, livePersistenceCertified: false, productionReleaseReady: companyRecurrenceReleaseReady(), sourceHashes: Object.fromEntries(sourceHashes), actualRuntimeResponses: evidence }, null, 2) + "\n"));
async function saved(recurrence = rule(), options: Parameters<typeof fixture>[0] = {}, extra: Row = {}) {
  const fake = fixture(options), created = response();
  const request = { ...base, recurrence, ...extra };
  await fake.routes.createJob({ body: wire(request) }, created);
  expect(created.statusCode, JSON.stringify(created.body)).toBe(201);
  const body = wire<{ job: Row; operation: Row }>(created.body), jobId = body.job.id as number;
  const read = response(); await fake.routes.jobRecurrenceSeries({ params: { jobId: String(jobId) } }, read);
  expect(read.statusCode, JSON.stringify(read.body)).toBe(200);
  const raw = wire(read.body);
  evidence.push(wire({ request, create: created.body, recurrenceGet: read.body }));
  const detail = normalizeJobSyncCompanyJobDetail({ job: wire(await fake.service.getJobDetail(fake.db, authority(), jobId)) }, jobId, 9);
  expect(detail?.pricing).toBeDefined();
  const expected: CompanyJobB29RecurrenceExpected = { companyId: 9, customerId: detail!.customerId!, jobId, operationKey: request.operationKey, recurrence,
    timezone: options.timezone ?? "America/Chicago", scheduledStartAt: request.scheduledStartAt,
    operationPayloadFingerprint: (await captureCompanyJobB29OriginalIntent(9, request.operationKey, request)).payloadFingerprint, pricing: detail!.pricing! };
  return { fake, body, jobId, raw, expected, request };
}
let userId = 291000;
function actor(): JobSyncNativeSession { return { token: `isolated-b29-${++userId}`, portal: "company", user: { id: userId, role: "owner", name: "Owner", email: null }, company: { id: 9, name: "Company", slug: "offline", logoUrl: null, primaryColor: null, accentColor: null } }; }
function storage() {
  const data = new Map<string, string>();
  const adapter = { getItemAsync: vi.fn(async (key: string) => data.get(key) ?? null), setItemAsync: vi.fn(async (key: string, text: string) => { data.set(key, text); }), deleteItemAsync: vi.fn(async (key: string) => { data.delete(key); }) };
  const store = createCompanyCreationStore({ platform: "ios", secureStore: adapter });
  return { store, adapter, remove: vi.spyOn(store, "remove") };
}
function harness(fake = fixture(), isolated = true) {
  const session = actor(), secure = storage(), onCreated = vi.fn(async () => true);
  const detail = async (_token: string, jobId: number, companyId: number) => {
    const read = normalizeJobSyncCompanyJobDetail({ job: wire(await fake.service.getJobDetail(fake.db, authority(), jobId)) }, jobId, companyId);
    if (!read) throw new Error("Exact b29 detail could not normalize"); return read;
  };
  const api: CompanyCreateJobTransport = {
    ...(isolated ? { recurrenceEnvironment: "isolated-fixture" as const } : {}), session: vi.fn(async () => session),
    settings: vi.fn(async () => ({ id: 9, timezone: "America/Chicago" }) as Awaited<ReturnType<CompanyCreateJobTransport["settings"]>>),
    priceBook: vi.fn(async () => [{ serviceId: "71", name: "First", basePrice: 100, vehiclePrices: { sedan: 120 } }, { serviceId: "72", name: "Second", basePrice: 50, vehiclePrices: {} }] as Awaited<ReturnType<CompanyCreateJobTransport["priceBook"]>>),
    customer: vi.fn(async (_token, id) => ({ id, companyId: 9 })), jobs: vi.fn(async () => []), detail: vi.fn(detail),
    quote: vi.fn(async (_token, _company, input) => { const res = response(); await fake.routes.quoteJob({ body: input }, res); const quote = normalizeCompanyJobQuote(wire<{ quote: unknown }>(res.body).quote, input); if (!quote) throw new Error("Exact quote unavailable"); return quote; }),
    create: vi.fn(async (_token, companyId, input) => {
      const res = response(); await fake.routes.createJob({ body: wire(input) }, res);
      if (![200, 201].includes(res.statusCode)) throw new Error(JSON.stringify(res.body));
      const body = wire<{ job: Row; operation: { key: string; state: "saved"; replayed: boolean } }>(res.body), id = body.job.id as number;
      const canonical = await detail("", id, companyId);
      return { ...canonical, companyId, priceBookServiceId: body.job.priceBookServiceId as number | null, operation: body.operation,
        ...(input.recurrence ? { recurrence: normalizeCompanyJobRecurrenceReceipt(body.job.recurrence, input.recurrence, id) } : {}) };
    }),
    operation: vi.fn(async (_token, _company, operationKey) => { const res = response(); await fake.routes.jobCreationOperation({ params: { operationKey } }, res); return wire<{ operation: Awaited<ReturnType<NonNullable<CompanyCreateJobTransport["operation"]>>> }>(res.body).operation; }),
    recurrenceReadback: vi.fn(async (_token, _company, jobId) => { const res = response(); await fake.routes.jobRecurrenceSeries({ params: { jobId: String(jobId) } }, res); return wire(res.body); }),
  };
  const controller = createCompanyJobController({ session, isCurrent: () => true, verifyAssignment: vi.fn(async () => true), onState: vi.fn(), onCreated, transport: api, store: secure.store, newOperationKey: () => `hsc-b29-controller-${session.user.id}` });
  const draft = { customerId: 41, serviceId: "71", lineItems: base.lineItems, discount: base.discount, assignedEmployeeId: "jobsync-8", date: "2026-11-30", startHour: 9, recurrence: rule(), notifyCustomer: false, privateNotes: "Private note", serviceNotes: "Service note", addressLine1: "10 Test Street", city: "Test City", region: "IL", postalCode: "60601" };
  return { fake, session, secure, onCreated, api, controller, draft };
}

describe("b29 exact source persisted recurrence candidate, not production release", () => {
  it.each(["weekly", "biweekly", "monthly_date", "monthly_ordinal"] as const)("verifies exact %s saved dates, financial SQL and complete series", async type => {
    const recurrence = rule(type), first = dates.buildStoredRecurrenceRule(recurrence, recurrence.startDate).firstDate;
    const h = await saved(recurrence, {}, { scheduledStartAt: `${first}T15:00:00.000Z` });
    const result = verifyCompanyJobB29RecurrenceReadback(h.raw, h.expected);
    expect(result.count).toBe(h.fake.state().jobs.length); expect(result.occurrenceJobIds).toEqual(h.fake.state().jobs.map(row => row.id));
    expect(h.fake.state().rules[0]).toMatchObject({ requested_start_date: recurrence.startDate, starts_on: first, operation_key: base.operationKey, initial_occurrence_count: result.count });
    expect(h.fake.state().jobs.every(row => row.discount_amount === 25 && row.tax_amount === 9 && row.tax_rate_bps === 500 && row.amount === 234)).toBe(true);
    expect(h.fake.state().lineItems).toHaveLength(result.count * 2); expect(h.fake.state().assignments).toHaveLength(result.count);
    expect(h.fake.connection.beginTransaction).toHaveBeenCalled(); expect(h.fake.connection.commit).toHaveBeenCalled(); expect(companyRecurrenceReleaseReady()).toBe(false);
  });
  it.each(["1_month", "3_months", "6_months", "1_year", "never_ends"] as const)("validates %s full materialized term", async term => {
    const h = await saved(rule("weekly", term)); const result = verifyCompanyJobB29RecurrenceReadback(h.raw, h.expected);
    const built = dates.buildStoredRecurrenceRule(h.request.recurrence, h.request.recurrence.startDate);
    expect(result.count).toBe(dates.generateRecurringDates(built.firstDate, built.rule).length);
    if (term === "never_ends") expect(result.count).toBe(13);
  });
  it("actual mobile route hashes original date rather than effective first date", async () => {
    const a = await saved(), b = await saved({ ...rule(), startDate: "2026-12-01" });
    expect(a.fake.state().rules[0].starts_on).toBe(b.fake.state().rules[0].starts_on);
    expect(a.fake.state().operations[0].payload_fingerprint).not.toBe(b.fake.state().operations[0].payload_fingerprint);
    const read = response(); await a.fake.routes.jobCreationOperation({ params: { operationKey: base.operationKey } }, read);
    expect(wire<{ operation: Row }>(read.body).operation.payloadFingerprint).toBe(a.expected.operationPayloadFingerprint);
    expect(a.expected.operationPayloadFingerprint).toBe(recovery.jobCreationPayloadFingerprint({ companyId: 9, request: a.fake.routes.mobileJobCreateSchema.parse(a.request) }));
  });
  it("matches backend notify default, property order, UTF-8 and omission without learning GET", async () => {
    const payload = { ...base, recurrence: rule(), privateNotes: " café 漢字 ".trim() }; delete (payload as Partial<typeof payload>).notifyCustomer;
    const expected = await captureCompanyJobB29OriginalIntent(9, base.operationKey, payload);
    expect(expected.payloadFingerprint).toBe(recovery.jobCreationPayloadFingerprint({ companyId: 9, request: fixture().routes.mobileJobCreateSchema.parse(payload) }));
    expect(normalizeCompanyJobB29RecurrenceReadback((await saved()).raw, 501).recurrence.requestedStartDate).toBe(rule().startDate);
    expect(companyJobB29OriginalIntentJson(9, base.operationKey, payload)).toContain('"notifyCustomer":true');
  });
  it.each(["assignment", "rate", "quantity", "discountValue", "discountCode", "requestedDate", "notify", "notes", "address", "newCustomer"])("actual b29 operation rejects changed original %s without another series", async kind => {
    const h = await saved(), changed = wire(h.request);
    if (kind === "assignment") changed.assignedUserId = null;
    if (kind === "rate") (changed.lineItems as Row[])[0].vehiclePriceKey = "sedan";
    if (kind === "quantity") (changed.lineItems as Row[])[0].quantity = 1;
    if (kind === "discountValue") (changed.discount as Row).value = 11;
    if (kind === "discountCode") (changed.discount as Row).code = "OTHER";
    if (kind === "requestedDate") (changed.recurrence as Row).startDate = "2026-12-01";
    if (kind === "notify") changed.notifyCustomer = true;
    if (kind === "notes") changed.privateNotes = "Changed note";
    if (kind === "address") changed.addressLine1 = "Changed address";
    if (kind === "newCustomer") { delete changed.customerId; changed.newCustomer = { firstName: "Changed", lastName: "Customer" }; }
    const res = response(); await h.fake.routes.createJob({ body: changed }, res);
    expect(res.statusCode).toBe(409); expect(h.fake.state().jobs).toHaveLength(h.body.job.recurrence ? (h.body.job.recurrence as Row).count as number : 0);
    expect((await captureCompanyJobB29OriginalIntent(9, base.operationKey, changed)).payloadFingerprint).not.toBe(h.expected.operationPayloadFingerprint);
    expect(h.fake.state().operations).toHaveLength(1);
  });
  it("exact same-key replay returns original anchor and no second materialization", async () => {
    const h = await saved(), count = h.fake.state().jobs.length, res = response(); await h.fake.routes.createJob({ body: h.request }, res);
    expect(res.statusCode).toBe(200); expect(wire<{ job: Row; operation: Row }>(res.body)).toMatchObject({ job: { id: h.jobId }, operation: { key: base.operationKey, replayed: true } });
    expect(h.fake.state().jobs).toHaveLength(count); expect(h.fake.state().rules).toHaveLength(1);
  });
  it("actual new-customer recurrence preserves transactional customer identity and immutable contact fingerprint", async () => {
    const h = await saved(rule(), {}, { customerId: undefined, newCustomer: { firstName: "Casey", lastName: "Example", email: "casey@example.test", addressLine1: "New Customer Street" } });
    const result = verifyCompanyJobB29RecurrenceReadback(h.raw, h.expected);
    expect(h.fake.state().customers).toHaveLength(1); expect(result.customerId).toBe(h.fake.state().customers[0].id);
    expect(h.fake.state().jobs.every(row => row.customer_id === result.customerId && row.address_line1 === "New Customer Street")).toBe(true);
    const changed = wire(h.request); (changed.newCustomer as Row).email = "changed@example.test";
    const res = response(); await h.fake.routes.createJob({ body: changed }, res);
    expect(res.statusCode).toBe(409); expect(h.fake.state().customers).toHaveLength(1);
  });
  it.each([1, 2, 3, 4, -1] as const)("monthly ordinal %s matches persisted weekday and original requested date", async ordinal => {
    const recurrence = { ...rule("monthly_ordinal"), ordinal }, first = dates.buildStoredRecurrenceRule(recurrence, recurrence.startDate).firstDate;
    const h = await saved(recurrence, {}, { scheduledStartAt: `${first}T15:00:00.000Z` });
    expect(verifyCompanyJobB29RecurrenceReadback(h.raw, h.expected).recurrence.ordinal).toBe(ordinal);
    expect(h.fake.state().rules[0].ordinal_week).toBe(ordinal === -1 ? 5 : ordinal);
  });
  it("monthly date clamps February and Company wall time crosses UTC date without client appointments", async () => {
    const h = await saved(rule("monthly_date", "3_months", "2027-01-31"), { timezone: "Australia/Lord_Howe" }, { scheduledStartAt: "2027-01-30T22:00:00.000Z" });
    const result = verifyCompanyJobB29RecurrenceReadback(h.raw, h.expected);
    expect(companyJobRecurrenceCalendarDates(result)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  });
  it("strict fixture rejects unhandled SQL and fake late line failure rolls back all saved series", async () => {
    const fake = fixture({ failLine: 3 }), res = response();
    await expect(fake.db.execute("SELECT invented_evidence FROM imaginary_table")).rejects.toThrow(/Unhandled fake SQL/);
    await fake.routes.createJob({ body: { ...base, recurrence: rule() } }, res);
    expect(res.statusCode).toBe(400); expect(fake.state().jobs).toHaveLength(0); expect(fake.state().rules).toHaveLength(0); expect(fake.state().operations).toHaveLength(0); expect(fake.booking).not.toHaveBeenCalled(); expect(fake.connection.rollback).toHaveBeenCalled();
  });
  it("real route Company authorization is retained and recurrence route is exact unwrapped JSON", async () => {
    const source = readBackend("server/mobileOperations.ts"); expect(source).toContain('app.get(`${BASE}/company/jobs/:jobId/recurrence`, jobRecurrenceSeries)');
    const fake = fixture(), denied = response(); await fake.routes.createJob({ role: "technician", body: { ...base, recurrence: rule() } }, denied);
    expect(denied.statusCode).toBe(403); expect(fake.state().jobs).toHaveLength(0);
    const h = await saved(), foreign = response(); await h.fake.routes.jobRecurrenceSeries({ companyId: 10, params: { jobId: String(h.jobId) } }, foreign); expect(foreign.statusCode).toBe(404);
  });
  it("source limitation: financial consistentSnapshot can be true without an actual transaction connection", async () => {
    const h = await saved(), before = h.fake.connection.beginTransaction.mock.calls.length;
    const raw = wire<any>(await h.fake.service.getJobRecurrenceSeries({ execute: h.fake.db.execute }, authority(), h.jobId));
    expect(raw.verification.consistentSnapshot).toBe(true); expect(h.fake.connection.beginTransaction).toHaveBeenCalledTimes(before);
    // Financial equality is not transaction isolation or live persistence proof.
    expect(companyRecurrenceReleaseReady()).toBe(false);
  });
  it("source limitation: absent initial count uses max-index fallback; finite-term mobile proof still catches trailing loss", async () => {
    const h = await saved(); delete h.fake.state().rules[0].initial_occurrence_count; h.fake.state().jobs.pop();
    const raw = wire<any>(await h.fake.service.getJobRecurrenceSeries(h.fake.db, authority(), h.jobId));
    expect(raw.verification.complete).toBe(true); expect(raw.verification.expectedOccurrenceCount).toBe(h.fake.state().jobs.length);
    expect(() => verifyCompanyJobB29RecurrenceReadback(raw, h.expected)).toThrow(); expect(companyRecurrenceReleaseReady()).toBe(false);
  });
  it("source limitation: coherent current financial edits do not alter the original operation fingerprint", async () => {
    const h = await saved(), fingerprint = h.fake.state().operations[0].payload_fingerprint;
    for (const job of h.fake.state().jobs) job.amount = 999;
    const raw = wire<any>(await h.fake.service.getJobRecurrenceSeries(h.fake.db, authority(), h.jobId));
    expect(raw.recurrence.operationPayloadFingerprint).toBe(fingerprint); expect(raw.verification.financialSnapshotVersion).not.toBe((h.raw.verification as Row).financialSnapshotVersion);
    expect(raw.verification.complete).toBe(true); expect(raw.pricing.total).toBe(999);
    // Current equal financial rows are readback evidence, not an immutable
    // creation-time tax/rate/amount certificate. No client recalculation here.
    expect(() => verifyCompanyJobB29RecurrenceReadback(raw, h.expected)).toThrow(); expect(companyRecurrenceReleaseReady()).toBe(false);
  });
});

describe("b29 rejects unproven or changed persisted evidence", () => {
  it.each(["missingFingerprint", "changedFingerprint", "missingRequestedDate", "changedRequestedDate", "wrongTenant", "wrongCustomer", "wrongKey", "wrongFrequency", "wrongWeekday", "wrongOrdinal", "wrongTerm", "wrongTimezone", "wrongAnchor", "duplicate", "reordered", "missing", "trailing", "rootSchedule", "siblingSchedule", "duration", "tax", "discount", "lines", "ruleVersion", "rowVersion", "operationBound", "financialVersion", "unexpectedField"])("locks %s evidence", async kind => {
    const h = await saved(), raw = wire<any>(h.raw);
    if (kind === "missingFingerprint") raw.recurrence.operationPayloadFingerprint = null;
    if (kind === "changedFingerprint") raw.recurrence.operationPayloadFingerprint = "a".repeat(64);
    if (kind === "missingRequestedDate") raw.recurrence.requestedStartDate = null;
    if (kind === "changedRequestedDate") raw.recurrence.requestedStartDate = "2026-12-01";
    if (kind === "wrongTenant") raw.companyId = 10;
    if (kind === "wrongCustomer") raw.customerId = 42;
    if (kind === "wrongKey") raw.recurrence.operationKey = "another-operation";
    if (kind === "wrongFrequency") raw.recurrence.cadence = "biweekly";
    if (kind === "wrongWeekday") raw.recurrence.weekday = 3;
    if (kind === "wrongOrdinal") raw.recurrence.ordinalWeek = 5;
    if (kind === "wrongTerm") raw.recurrence.requestedTerm = "3_months";
    if (kind === "wrongTimezone") raw.recurrence.creationTimezone = "UTC";
    if (kind === "wrongAnchor") raw.recurrence.anchorJobId = 502;
    if (kind === "duplicate") raw.occurrences[1].jobId = raw.occurrences[0].jobId;
    if (kind === "reordered") raw.occurrences.reverse();
    if (kind === "missing") raw.occurrences.splice(1, 1);
    if (kind === "trailing") raw.occurrences.pop();
    if (kind === "rootSchedule") raw.occurrences[0].scheduledStartAt = "2026-12-01T16:00:00.000Z";
    if (kind === "siblingSchedule") raw.occurrences[1].scheduledStartAt = "2026-12-08T16:00:00.000Z";
    if (kind === "duration") raw.pricing.durationMinutes += 1;
    if (kind === "tax") raw.pricing.tax += 1;
    if (kind === "discount") raw.pricing.discount += 1;
    if (kind === "lines") raw.pricing.lineItems[0].unitPrice += 1;
    if (kind === "ruleVersion") raw.recurrence.updatedAt = "2026-11-18T12:00:00.000Z";
    if (kind === "rowVersion") raw.occurrences[0].updatedAt = null;
    if (kind === "operationBound") raw.verification.operationBound = false;
    if (kind === "financialVersion") raw.verification.financialSnapshotVersion = "[]";
    if (kind === "unexpectedField") raw.recurrence.originalDateEcho = rule().startDate;
    expect(() => verifyCompanyJobB29RecurrenceReadback(raw, h.expected)).toThrow();
  });
  it.each(["trailing", "missing", "rootPrice", "siblingPrice", "linePrice", "lostOperation", "missingOriginalDate", "changedOriginalDate", "missingFingerprint", "changedFingerprint"])("actual SQL readback detects %s persistence mutation", async kind => {
    const h = await saved();
    if (kind === "trailing") h.fake.state().jobs.pop();
    if (kind === "missing") h.fake.state().jobs.splice(1, 1);
    if (kind === "rootPrice") h.fake.state().jobs[0].amount = 999;
    if (kind === "siblingPrice") h.fake.state().jobs[1].tax_amount = 999;
    if (kind === "linePrice") h.fake.state().lineItems[2].unit_price = 999;
    if (kind === "lostOperation") h.fake.state().operations.splice(0);
    if (kind === "missingOriginalDate") delete h.fake.state().rules[0].requested_start_date;
    if (kind === "changedOriginalDate") h.fake.state().rules[0].requested_start_date = "2026-12-01";
    if (kind === "missingFingerprint") delete h.fake.state().operations[0].payload_fingerprint;
    if (kind === "changedFingerprint") h.fake.state().operations[0].payload_fingerprint = "a".repeat(64);
    const read = response(); await h.fake.routes.jobRecurrenceSeries({ params: { jobId: String(h.jobId) } }, read);
    expect(() => verifyCompanyJobB29RecurrenceReadback(wire(read.body), h.expected)).toThrow();
  });
  it("does not let a GET hash become the expected original intent", async () => {
    const h = await saved(); const expected = { ...h.expected, operationPayloadFingerprint: undefined };
    expect(() => verifyCompanyJobB29RecurrenceReadback(h.raw, expected as unknown as CompanyJobB29RecurrenceExpected)).toThrow(/legacy recovery record/);
  });
});

describe("b29 durable controller recovery and full handoff", () => {
  it("complete source-proven series invokes canonical three-argument calendar handoff and removes only after true", async () => {
    const h = harness(); expect(await h.controller.submit(h.draft)).toBe(true);
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.api.recurrenceReadback).toHaveBeenCalledTimes(2);
    expect(h.onCreated).toHaveBeenCalledTimes(1); expect(h.onCreated.mock.calls[0]).toHaveLength(3);
    expect(h.controller.getState().savedSeries?.count).toBe(h.fake.state().jobs.length);
    expect(h.secure.remove).toHaveBeenCalledTimes(1); expect(await h.secure.store.read(9, h.session.user.id)).toBeNull();
    expect(h.fake.state().jobs[0]).toMatchObject({ assigned_user_id: 8, internal_notes: "Private note", service_notes: "Service note", address_line1: "10 Test Street", customer_notification_enabled: 0 });
  });
  it("production is disabled before quote, reservation, POST or calendar callback", async () => {
    const h = harness(fixture(), false); expect(await h.controller.submit(h.draft)).toBe(false);
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.api.quote).not.toHaveBeenCalled(); expect(h.onCreated).not.toHaveBeenCalled(); expect(companyRecurrenceReleaseReady()).toBe(false);
  });
  it.each(["missingFingerprint", "changedFingerprint", "assignment", "rootFinancial", "siblingFinancial", "twoReadVersion", "twoReadSchedule"])("unproven %s remains durable with no successful callback or removal", async kind => {
    const h = harness();
    if (kind === "missingFingerprint" || kind === "changedFingerprint") {
      const operation = h.api.operation!; h.api.operation = vi.fn(async (...args: Parameters<typeof operation>) => { const read = await operation(...args) as Row; return { ...read, payloadFingerprint: kind === "missingFingerprint" ? undefined : "b".repeat(64) } as Awaited<ReturnType<typeof operation>>; });
    } else if (["assignment", "rootFinancial", "siblingFinancial"].includes(kind)) {
      const create = h.api.create; h.api.create = vi.fn(async (...args: Parameters<typeof create>) => { const ack = await create(...args); if (kind === "assignment") h.fake.state().jobs[1].assigned_user_id = 88; if (kind === "rootFinancial") h.fake.state().jobs[0].discount_amount = 99; if (kind === "siblingFinancial") h.fake.state().jobs[1].tax_amount = 99; return ack; });
    } else {
      const read = h.api.recurrenceReadback!; let count = 0; h.api.recurrenceReadback = vi.fn(async (...args: Parameters<typeof read>) => { count += 1; if (count === 2) { if (kind === "twoReadVersion") h.fake.state().rules[0].updated_at = "2026-11-18T12:00:00.000Z"; else h.fake.state().jobs[1].scheduled_start_at = new Date("2026-12-08T16:00:00.000Z"); } return read(...args); });
    }
    expect(await h.controller.submit(h.draft)).toBe(false); expect(h.onCreated).not.toHaveBeenCalled(); expect(h.secure.remove).not.toHaveBeenCalled();
    const record = await h.secure.store.read(9, h.session.user.id); expect(record?.recurrenceOriginalIntent).toBeDefined();
    expect(await h.controller.submit(h.draft)).toBe(false); expect(h.api.create).toHaveBeenCalledTimes(1);
  });
  it("lost response restart uses original key and pointer, no second POST, then complete proof permits handoff", async () => {
    const h = harness(), create = h.api.create;
    h.api.create = vi.fn(async (...args: Parameters<typeof create>) => { await create(...args); throw new Error("lost response"); });
    expect(await h.controller.submit(h.draft)).toBe(false);
    const original = await h.secure.store.read(9, h.session.user.id); expect(original?.jobId).toBeNull(); expect(original?.phase).toBe("uncertain"); h.controller.detach();
    vi.resetModules(); // Destroy the controller actors map, not merely its view.
    const { createCompanyJobController: restartFactory } = await import("../lib/company-create-job");
    const restarted = restartFactory({ session: h.session, isCurrent: () => true, verifyAssignment: async () => true, onState: vi.fn(), onCreated: h.onCreated, transport: h.api, store: h.secure.store });
    expect(await restarted.restore()).toBe(true); expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.api.operation).toHaveBeenCalledWith(h.session.token, 9, original!.operationKey); expect(h.onCreated).toHaveBeenCalledTimes(1);
  });
  it.each(["unknown", "pending", "unavailable", "unboundRejected"])("lost response %s keeps original key and durable lock without callback or second POST", async kind => {
    const h = harness(), create = h.api.create;
    h.api.create = vi.fn(async (...args: Parameters<typeof create>) => { await create(...args); throw new Error("lost response"); });
    expect(await h.controller.submit(h.draft)).toBe(false); const original = await h.secure.store.read(9, h.session.user.id);
    h.api.operation = vi.fn(async () => {
      if (kind === "unavailable") throw new Error("operation temporarily unavailable");
      return { key: original!.operationKey, state: (kind === "unboundRejected" ? "rejected" : kind) as "rejected" | "unknown" | "pending", jobId: null,
        rejectionCode: kind === "unboundRejected" ? "BAD_REQUEST" : null, rejectionMessage: kind === "unboundRejected" ? "Rejected different intent" : null, createdAt: null, updatedAt: null };
    });
    h.controller.detach();
    const restarted = createCompanyJobController({ session: h.session, isCurrent: () => true, verifyAssignment: async () => true, onState: vi.fn(), onCreated: h.onCreated, transport: h.api, store: h.secure.store });
    expect(await restarted.restore()).toBe(false); expect(await restarted.submit(h.draft)).toBe(false);
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.onCreated).not.toHaveBeenCalled(); expect(h.secure.remove).not.toHaveBeenCalled();
    expect((await h.secure.store.read(9, h.session.user.id))?.operationKey).toBe(original!.operationKey);
  });
  it("one-time original flow retains assignment, multiple services, notes, address and notify opt-out", async () => {
    const h = harness(); const { recurrence: _recurrence, ...draft } = h.draft;
    expect(await h.controller.submit(draft)).toBe(true); expect(h.api.recurrenceReadback).not.toHaveBeenCalled();
    expect(h.onCreated.mock.calls[0]).toHaveLength(2); expect(h.fake.state().jobs).toHaveLength(1);
    expect(h.fake.state().jobs[0]).toMatchObject({ assigned_user_id: 8, service_notes: draft.serviceNotes, internal_notes: draft.privateNotes, address_line1: draft.addressLine1, customer_notification_enabled: 0 });
  });
  it("calendar false keeps full series and original pointer; next GET-only reconciliation may complete", async () => {
    const h = harness(); h.onCreated.mockResolvedValue(false);
    expect(await h.controller.submit(h.draft)).toBe(false); expect(h.secure.remove).not.toHaveBeenCalled(); expect(h.controller.getState().savedSeries).toBeDefined();
    const original = await h.secure.store.read(9, h.session.user.id); h.onCreated.mockResolvedValue(true);
    expect(await h.controller.reconcile()).toBe(true); expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.api.operation).toHaveBeenCalledWith(h.session.token, 9, original!.operationKey);
  });
  it("old v1 recurrence remains readable, cannot adopt fingerprint, and stays GET-only locked", async () => {
    const h = harness(); const savedSource = await saved(); const now = "2026-11-17T12:00:00.000Z";
    const payload = { ...savedSource.request }; delete (payload as Partial<typeof payload>).operationKey;
    const record: CompanyCreationRecord = { version: 1, companyId: 9, userId: h.session.user.id, operationKey: base.operationKey, timezone: "America/Chicago", phase: "saved", jobId: savedSource.jobId, payload, createdAt: now, updatedAt: now };
    expect(await h.secure.store.reserve(record)).toBe(true);
    expect(await h.controller.restore()).toBe(false); expect(h.controller.getState().detailError).toMatch(/legacy recurring request/);
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.onCreated).not.toHaveBeenCalled(); expect(h.secure.remove).not.toHaveBeenCalled();
    const forged = { ...record, recurrenceOriginalIntent: await captureCompanyJobB29OriginalIntent(9, record.operationKey, record.payload) };
    await expect(h.secure.store.update(forged)).rejects.toThrow(/recovery storage/);
    expect((await h.secure.store.read(9, h.session.user.id))?.recurrenceOriginalIntent).toBeUndefined();
  });
  it("immutable original journal rejects changed fingerprint, version, financial intent, date and assignment", async () => {
    const h = harness(); h.onCreated.mockResolvedValue(false); await h.controller.submit(h.draft); const original = (await h.secure.store.read(9, h.session.user.id))!;
    const changes = [ { ...original, recurrenceOriginalIntent: { ...original.recurrenceOriginalIntent!, payloadFingerprint: "a".repeat(64) } },
      { ...original, recurrenceOriginalIntent: { ...original.recurrenceOriginalIntent!, version: "future" } }, { ...original, payload: { ...original.payload, assignedUserId: 88 } },
      { ...original, payload: { ...original.payload, discount: { kind: "flat", value: 50 } } }, { ...original, payload: { ...original.payload, recurrence: { ...original.payload.recurrence!, startDate: "2026-12-01" } } } ];
    for (const changed of changes) await expect(h.secure.store.update(changed as CompanyCreationRecord)).rejects.toThrow();
    expect(await h.secure.store.read(9, h.session.user.id)).toEqual(original);
  });
});
