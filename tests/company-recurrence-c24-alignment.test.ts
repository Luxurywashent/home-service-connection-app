import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authority, c24BackendSha, dates, fixture, readBackend, recovery, response, sourceHashes } from "./recurrence-fixtures/c24-source-fixture";
import { companyJobRecurrenceCalendarDates, normalizeCompanyJobDurableRecurrenceReadback,
  normalizeCompanyJobC24RecurrenceReadback, normalizeCompanyJobRecurrenceReceipt, verifyCompanyJobDurableRecurrenceReadback,
  type CompanyJobDurableRecurrenceExpected, type CompanyJobDurableRecurrenceReadback, type CompanyJobRecurrenceInput } from "../lib/company-job-recurrence";
import { createCompanyJobController, type CompanyCreateJobTransport } from "../lib/company-create-job";
import { createCompanyCreationStore, type CompanyCreationRecord } from "../lib/company-job-creation-storage";
import { normalizeJobSyncCompanyJobDetail, normalizeCompanyJobQuote, type JobSyncNativeSession, type JobSyncCompanyJobCreateResult } from "../lib/jobsync-mobile-api";
import { companyRecurrenceReleaseReady } from "../lib/company-verified-contract-release";
vi.mock("expo-crypto", () => ({ randomUUID, digestStringAsync: async (_: string, text: string) => createHash("sha256").update(text).digest("hex"), CryptoDigestAlgorithm: { SHA256: "SHA-256" } }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only", getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
const wire = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;
type Row = Record<string, unknown>;
const rule = (type: CompanyJobRecurrenceInput["type"] = "weekly", term: CompanyJobRecurrenceInput["term"] = "1_month"): CompanyJobRecurrenceInput => ({ type, term, startDate: "2026-11-30", ...(type !== "monthly_date" ? { dayOfWeek: 2 } : {}), ...(type === "monthly_ordinal" ? { ordinal: -1 as const } : {}) });
const base = { customerId: 41, priceBookServiceId: 71, lineItems: [{ priceBookItemId: 71, quantity: 2 }, { priceBookItemId: 72, quantity: 1 }], scheduledStartAt: "2026-12-01T15:00:00.000Z", operationKey: "hsc-c24-recurrence-001", notifyCustomer: false };
const evidence: unknown[] = [];
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Production HTTP forbidden"))); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
afterAll(() => writeFileSync("/home/ubuntu/hsc-mobile-c24-contract-alignment-20261117/recurrence-c24-source-execution.json", JSON.stringify({ backendSha: c24BackendSha, fixtureOnly: true, productionRecurrence: "DISABLED", sourceHashes: Object.fromEntries(sourceHashes), exactResponses: evidence }, null, 2) + "\n"));
async function read(fake: ReturnType<typeof fixture>, id = 501) {
  const res = response(); await fake.routes.jobRecurrenceSeries({ params: { jobId: String(id) } }, res);
  expect(res.statusCode).toBe(200);
  return wire<CompanyJobDurableRecurrenceReadback>(res.body);
}
async function saved(recurrence = rule(), options: Parameters<typeof fixture>[0] = {}, extra: Row = {}) {
  const fake = fixture(options), res = response();
  const first = dates.buildStoredRecurrenceRule(recurrence, recurrence.startDate).firstDate;
  const request = { ...base, scheduledStartAt: `${first}T15:00:00.000Z`, recurrence, ...extra };
  await fake.routes.createJob({ body: request }, res);
  expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
  const body = wire<{ job: Row; operation: unknown }>(res.body), raw = await read(fake, Number(body.job.id));
  const detail = normalizeJobSyncCompanyJobDetail({ job: wire(await fake.service.getJobDetail(fake.db, authority(), Number(body.job.id))) }, Number(body.job.id), 9);
  expect(detail?.pricing).toBeDefined();
  // Independent test-only PRE-WRITE server input, not a hash copied from any GET
  // or persistent row. Mobile production has no access to this captured input.
  const originalFingerprint = recovery.jobCreationPayloadFingerprint(recovery.operationPayloadForJobCreation(fake.creationInputs[0]));
  const expected: CompanyJobDurableRecurrenceExpected = { companyId: 9, customerId: detail!.customerId, jobId: detail!.id,
    operationKey: base.operationKey, recurrence, timezone: options.timezone ?? "America/Chicago", scheduledStartAt: request.scheduledStartAt,
    pricing: detail!.pricing!, operationPayloadFingerprint: originalFingerprint };
  evidence.push(wire({ request, create: res.body, recurrenceGet: raw, capturedServerCreateInput: fake.creationInputs[0], independentFixtureFingerprint: originalFingerprint }));
  return { fake, body, raw, detail: detail!, expected };
}
function verified(h: Awaited<ReturnType<typeof saved>>, value: unknown = h.raw, expected = h.expected) {
  return verifyCompanyJobDurableRecurrenceReadback(normalizeCompanyJobDurableRecurrenceReadback(value, h.expected.jobId), expected);
}
let userId = 291000;
function actor(): JobSyncNativeSession { return { token: `isolated-c24-${++userId}`, portal: "company", user: { id: userId, role: "owner", name: "Owner", email: null }, company: { id: 9, name: "Company", slug: "offline", logoUrl: null, primaryColor: null, accentColor: null } }; }
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
    if (!read) throw new Error("Exact c24 detail could not normalize"); return read;
  };
  const api: CompanyCreateJobTransport = {
    ...(isolated ? { recurrenceEnvironment: "isolated-fixture" as const } : {}), session: vi.fn(async () => session), settings: vi.fn(async () => ({ id: 9, timezone: "America/Chicago" }) as Awaited<ReturnType<CompanyCreateJobTransport["settings"]>>),
    priceBook: vi.fn(async () => [{ serviceId: "71", basePrice: 100, vehiclePrices: {} }, { serviceId: "72", basePrice: 50, vehiclePrices: {} }] as Awaited<ReturnType<CompanyCreateJobTransport["priceBook"]>>),
    customer: vi.fn(async () => ({ id: 41, companyId: 9 })), jobs: vi.fn(async () => []), detail: vi.fn(detail),
    quote: vi.fn(async (_token, _company, input) => { const res = response(); await fake.routes.quoteJob({ body: input }, res); const quote = normalizeCompanyJobQuote(wire<{ quote: unknown }>(res.body).quote, input); if (!quote) throw new Error("Exact quote unavailable"); return quote; }),
    create: vi.fn(async (_token, companyId, input) => {
      const res = response(); await fake.routes.createJob({ body: wire(input) }, res);
      if (res.statusCode !== 201 && res.statusCode !== 200) throw new Error(JSON.stringify(res.body));
      const body = wire<{ job: Row; operation: JobSyncCompanyJobCreateResult["operation"] }>(res.body), id = Number(body.job.id);
      const canonical = await detail("", id, companyId);
      return { ...canonical, companyId, priceBookServiceId: body.job.priceBookServiceId as number | null, operation: body.operation,
        ...(input.recurrence ? { recurrence: normalizeCompanyJobRecurrenceReceipt(body.job.recurrence, input.recurrence, id) } : {}) };
    }),
    operation: vi.fn(async (_token, _company, operationKey) => { const res = response(); await fake.routes.jobCreationOperation({ params: { operationKey } }, res); return wire<{ operation: Awaited<ReturnType<NonNullable<CompanyCreateJobTransport["operation"]>>> }>(res.body).operation; }),
    recurrenceReadback: vi.fn(async (_token, _company, jobId) => read(fake, jobId)),
  };
  const input = { session, transport: api, store: secure.store, isCurrent: () => true, verifyAssignment: vi.fn(async () => true), onCreated, onState: vi.fn(), newOperationKey: vi.fn(() => base.operationKey) };
  return { fake, session, secure, api, input, controller: createCompanyJobController(input), onCreated,
    draft: { customerId: 41, lineItems: wire<typeof base.lineItems>(base.lineItems), date: rule().startDate, startHour: 9, recurrence: rule(), notifyCustomer: false } };
}
describe("c24 exact source execution / persisted DTO alignment", () => {
  it("pins current authority and keeps deployment gates false", () => {
    expect(c24BackendSha).toBe("c24d4a1e5da9d937e68709a76ce2e2336c81b748");
    expect(createHash("sha256").update(readBackend("server/jobService.ts")).digest("hex")).toBe("332d98d4e0ba910ae630dcb4a0e1ad12475f0c9c7b33a115a3099aa979c99490");
    expect(createHash("sha256").update(readBackend("server/mobileOperations.ts")).digest("hex")).toBe("14d9693b496d9b7d8fe17fc78ffdec599413740347a356061adee5342501fb66");
    expect(createHash("sha256").update(readBackend("server/jobCreationRecovery.ts")).digest("hex")).toBe("d7c2c9c5dbd34ee539b7c31a0a43e543a701b8623044d5a9f2f1e08ca19ca67f");
    expect(companyRecurrenceReleaseReady()).toBe(false);
  });
  it.each(["weekly", "biweekly", "monthly_date", "monthly_ordinal"] as const)("accepts exact %s DTO without filling backend evidence", async type => {
    const h = await saved(rule(type), { mysqlDates: true });
    const normalized = normalizeCompanyJobC24RecurrenceReadback(h.raw, 501);
    expect(normalized).toEqual(h.raw); expect(Object.isFrozen(normalized)).toBe(true); expect(normalized.pricing.lineItems?.every(Object.isFrozen)).toBe(true);
    expect(normalized.recurrence).toMatchObject({ requestedStartDate: "2026-11-30", operationKey: base.operationKey, requestedTerm: "1_month", creationTimezone: "America/Chicago" });
    expect(h.fake.state().rules[0]).toMatchObject({ requested_start_date: "2026-11-30", operation_key: base.operationKey, initial_occurrence_count: h.raw.occurrences.length });
    const series = verified(h); expect(series.occurrenceJobIds).toEqual(h.raw.occurrences.map(row => row.jobId));
    expect(series.recurrence.startDate).toBe("2026-11-30"); expect(series.timezone).toBe("America/Chicago");
    expect(companyJobRecurrenceCalendarDates(series)[0]).toBe(h.raw.recurrence.startsOn);
  });
  it.each([1, 2, 3, 4, -1] as const)("verifies monthly ordinal %s independently from effective first date", async ordinal => {
    const h = await saved({ ...rule("monthly_ordinal", "3_months"), ordinal });
    expect(verified(h).recurrence.ordinal).toBe(ordinal);
    expect(h.raw.recurrence.ordinalWeek).toBe(ordinal === -1 ? 5 : ordinal);
    expect(() => verified(h, h.raw, { ...h.expected, recurrence: { ...h.expected.recurrence, ordinal: ordinal === 1 ? 2 : 1 } })).toThrow(/locked/);
  });
  it("verifies monthly date clamping without creating replacement occurrences", async () => {
    const h = await saved({ type: "monthly_date", term: "6_months", startDate: "2026-12-31" });
    const series = verified(h), localDates = companyJobRecurrenceCalendarDates(series);
    expect(localDates.slice(0, 4)).toEqual(["2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(series.occurrences.map(row => row.id)).toEqual(h.raw.occurrences.map(row => row.jobId));
  });
  it("accepts persisted zero tax without replacing it with assumed taxation", async () => {
    const h = await saved(rule(), {}, { priceBookServiceId: 72, lineItems: [{ priceBookItemId: 72, quantity: 1 }] });
    expect(h.raw.pricing.tax).toBe(0); expect(h.raw.pricing.taxRateBps).toBe(500);
    expect(verified(h).count).toBe(h.raw.occurrences.length);
  });
  it.each(["1_month", "3_months", "6_months", "1_year", "never_ends"] as const)("verifies persisted %s initial count, not a shortened series", async term => {
    const recurrence = rule("weekly", term), h = await saved(recurrence);
    const built = dates.buildStoredRecurrenceRule(recurrence, recurrence.startDate);
    expect(verified(h).count).toBe(dates.generateRecurringDates(built.firstDate, built.rule).length);
    expect(h.raw.verification.expectedOccurrenceCount).toBe(h.fake.state().rules[0].initial_occurrence_count);
    if (term === "never_ends") expect(verified(h).count).toBe(13);
  });
  it.each([undefined, { kind: "flat", value: 0 }, { kind: "flat", value: 25, code: "OFF" }, { kind: "percent", value: 10, code: "TEN" }, { kind: "flat", value: 5, code: "" }] as const)("verifies server nonzero totals/tax and discount %j", async discount => {
    const h = await saved(rule(), {}, discount ? { discount } : {});
    const quoteResponse = response(); await h.fake.routes.quoteJob({ body: { lineItems: base.lineItems, ...(discount ? { discount } : {}) } }, quoteResponse);
    const quote = wire<{ quote: { subtotal: number; discount: number; total: number; tax: number } }>(quoteResponse.body).quote;
    expect(h.raw.pricing).toMatchObject({ subtotal: quote.subtotal, discount: quote.discount, tax: quote.tax, total: quote.total, taxRateBps: 500, durationMinutes: 150 });
    expect(h.raw.pricing.subtotal).toBeGreaterThan(0); expect(h.raw.pricing.tax).toBeGreaterThan(0);
    expect(verified(h).count).toBe(h.raw.occurrences.length);
    const financialRows = JSON.parse(h.raw.verification.financialSnapshotVersion!);
    expect(financialRows.map((row: { id: number }) => row.id)).toEqual(h.raw.occurrences.map(row => row.jobId));
    expect(h.fake.state().jobs.every(row => row.subtotal_amount === quote.subtotal && row.discount_amount === quote.discount && row.tax_amount === quote.tax && row.amount === quote.total)).toBe(true);
  });
  it("different original dates sharing the same effective date have distinct persisted fingerprints", async () => {
    const a = await saved(), b = await saved({ ...rule(), startDate: "2026-12-01" });
    expect(a.raw.recurrence.startsOn).toBe(b.raw.recurrence.startsOn);
    expect(a.raw.recurrence.requestedStartDate).not.toBe(b.raw.recurrence.requestedStartDate);
    expect(a.raw.recurrence.operationPayloadFingerprint).not.toBe(b.raw.recurrence.operationPayloadFingerprint);
    expect(a.raw.recurrence.operationPayloadFingerprint).toBe(a.expected.operationPayloadFingerprint);
  });
  it("public operation GET does not expose fingerprint; raw mobile hash cannot match server-transformed input", async () => {
    const h = await saved(), res = response(); await h.fake.routes.jobCreationOperation({ params: { operationKey: base.operationKey } }, res);
    expect(wire<{ operation: Row }>(res.body).operation).not.toHaveProperty("payloadFingerprint");
    expect(recovery.jobCreationPayloadFingerprint(recovery.operationPayloadForJobCreation({ ...base, recurrence: rule() }))).not.toBe(h.expected.operationPayloadFingerprint);
    const { operationPayloadFingerprint: _hash, ...mobileExpected } = h.expected;
    expect(() => verified(h, h.raw, mobileExpected)).toThrow(/no independently comparable original fingerprint/);
  });
  it("new-customer and notify intent is included in actual source fingerprint without changing customer selection", async () => {
    const h = await saved(rule(), {}, { customerId: undefined, newCustomer: { firstName: "Casey", lastName: "Example", email: "casey@example.test" }, notifyCustomer: true });
    expect(h.expected.customerId).toBe(42); expect(h.fake.state().customers).toHaveLength(1); expect(h.fake.booking).toHaveBeenCalledTimes(1);
    expect(h.fake.creationInputs[0]).toMatchObject({ newCustomer: { firstName: "Casey", lastName: "Example", email: "casey@example.test" }, notifyCustomer: true });
    expect(verified(h).customerId).toBe(42);
  });
  it("same-key replay is idempotent and conflicting assignment/discount intent is rejected by exact server source", async () => {
    const h = await saved(), initialJobs = h.fake.state().jobs.length;
    const again = response(); await h.fake.routes.createJob({ body: { ...base, recurrence: rule() } }, again);
    expect(again.statusCode).toBe(200); expect(h.fake.state().jobs).toHaveLength(initialJobs);
    for (const extra of [{ assignedUserId: 8 }, { discount: { kind: "flat", value: 1 } }, { notifyCustomer: true }]) {
      const res = response(); await h.fake.routes.createJob({ body: { ...base, recurrence: rule(), ...extra } }, res);
      expect(res.statusCode).toBe(409); expect(h.fake.state().jobs).toHaveLength(initialJobs);
    }
  });
  it("rejects unauthorized Company writes and foreign recurrence reads through actual routes", async () => {
    const fake = fixture(), denied = response(); await fake.routes.createJob({ role: "technician", body: { ...base, recurrence: rule() } }, denied);
    expect(denied.statusCode).toBe(403); expect(fake.state().jobs).toHaveLength(0);
    const h = await saved(), foreign = response(); await h.fake.routes.jobRecurrenceSeries({ companyId: 10, params: { jobId: "501" } }, foreign);
    expect(foreign.statusCode).toBe(404);
  });
});
describe("c24 rejects incomplete / changed persisted facts and hostile raw DTOs", () => {
  it.each(["middle", "trailing", "duplicateNumber", "foreignCustomer", "inactive", "rootPrice", "siblingPrice", "siblingLine", "tax", "count", "wrongOperation", "wrongFingerprint", "originalDate", "frequency", "term", "timezone"])("rejects persisted %s mutation without inventing proof", async kind => {
    const h = await saved();
    if (kind === "middle") h.fake.state().jobs.splice(1, 1);
    if (kind === "trailing") h.fake.state().jobs.pop();
    if (kind === "duplicateNumber") h.fake.state().jobs[1].recurrence_occurrence_number = 0;
    if (kind === "foreignCustomer") h.fake.state().jobs[1].customer_id = 99;
    if (kind === "inactive") h.fake.state().rules[0].is_active = 0;
    if (kind === "rootPrice") h.fake.state().jobs[0].amount = 999;
    if (kind === "siblingPrice") h.fake.state().jobs[1].amount = 999;
    if (kind === "siblingLine") h.fake.state().lineItems.find(row => row.job_id === 502)!.unit_price = 999;
    if (kind === "tax") h.fake.state().jobs[1].tax_amount = 0;
    if (kind === "count") h.fake.state().rules[0].initial_occurrence_count = 3;
    if (kind === "wrongOperation") h.fake.state().rules[0].operation_key = "hsc-c24-wrong-key";
    if (kind === "wrongFingerprint") h.fake.state().operations[0].payload_fingerprint = "0".repeat(64);
    if (kind === "originalDate") h.fake.state().rules[0].requested_start_date = "2026-12-01";
    if (kind === "frequency") h.fake.state().rules[0].cadence = "biweekly";
    if (kind === "term") h.fake.state().rules[0].requested_term = "3_months";
    if (kind === "timezone") h.fake.state().rules[0].creation_timezone = "Pacific/Honolulu";
    expect(() => verified(h, h.raw)).not.toThrow(); // original pre-mutation DTO was genuinely verified
    const current = await read(h.fake); expect(() => verified(h, current)).toThrow(/locked/);
    if (kind === "trailing") expect(current.verification).toMatchObject({ complete: false, expectedOccurrenceCount: 5, actualOccurrenceCount: 4, missingOccurrenceNumbers: [4] });
  });
  it.each(["reordered", "duplicateId", "sparse", "accessor", "missingOriginalDate", "nullOriginalDate", "missingHash", "nullHash", "extraProof", "badSnapshot", "snapshotIds", "snapshotLines", "snapshotCount", "occurrenceTime", "tenant", "customer", "weekday", "ordinal", "version", "duration", "missingTax", "nullTax", "missingLines", "emptyLines", "operationUnbound"])("rejects raw %s mutation instead of weakening validation", async kind => {
    const h = await saved(), raw = wire<CompanyJobDurableRecurrenceReadback>(h.raw) as any;
    if (kind === "reordered") raw.occurrences.reverse();
    if (kind === "duplicateId") raw.occurrences[1].jobId = raw.occurrences[0].jobId;
    if (kind === "sparse") delete raw.occurrences[1];
    if (kind === "accessor") Object.defineProperty(raw.recurrence, "requestedStartDate", { enumerable: true, get: () => { throw new Error("Getter must not run"); } });
    if (kind === "missingOriginalDate") delete raw.recurrence.requestedStartDate;
    if (kind === "nullOriginalDate") raw.recurrence.requestedStartDate = null;
    if (kind === "missingHash") delete raw.recurrence.operationPayloadFingerprint;
    if (kind === "nullHash") raw.recurrence.operationPayloadFingerprint = null;
    if (kind === "extraProof") raw.verification.assignmentEcho = 8;
    if (kind === "badSnapshot") raw.verification.financialSnapshotVersion = "not JSON";
    if (["snapshotIds", "snapshotLines", "snapshotCount"].includes(kind)) {
      const rows = JSON.parse(raw.verification.financialSnapshotVersion);
      if (kind === "snapshotIds") rows[1].id = rows[0].id;
      if (kind === "snapshotLines") rows[1].lines[0].unitPrice = 0;
      if (kind === "snapshotCount") rows.pop();
      raw.verification.financialSnapshotVersion = JSON.stringify(rows);
    }
    if (kind === "occurrenceTime") { raw.occurrences[1].scheduledStartAt = "2026-12-09T15:00:00.000Z"; raw.occurrences[1].scheduledEndAt = "2026-12-09T17:30:00.000Z"; }
    if (kind === "tenant") raw.companyId = 10;
    if (kind === "customer") raw.customerId = 42;
    if (kind === "weekday") raw.recurrence.weekday = 3;
    if (kind === "ordinal") raw.recurrence.ordinalWeek = 1;
    if (kind === "version") raw.verification.ruleUpdatedAt = "2026-11-18T12:00:00.000Z";
    if (kind === "duration") raw.pricing.durationMinutes = 60;
    if (kind === "missingTax") delete raw.pricing.tax;
    if (kind === "nullTax") raw.pricing.tax = null;
    if (kind === "missingLines") delete raw.pricing.lineItems;
    if (kind === "emptyLines") raw.pricing.lineItems = [];
    if (kind === "operationUnbound") raw.verification.operationBound = false;
    expect(() => verified(h, raw)).toThrow();
  });
  it.each(["assignment", "rate", "discountValue"])("current identical financial rows cannot prove changed original %s intent without independent fingerprint", async kind => {
    const h = await saved(rule(), {}, { assignedUserId: 8, discount: { kind: "flat", value: 0 } });
    const changed = wire<Row>(h.fake.creationInputs[0]);
    if (kind === "assignment") changed.assignedUserId = null;
    if (kind === "rate") (changed.lineItems as Row[])[0].vehiclePriceKey = "sedan";
    if (kind === "discountValue") (changed.discount as Row).value = 1;
    const changedFingerprint = recovery.jobCreationPayloadFingerprint(recovery.operationPayloadForJobCreation(changed));
    expect(changedFingerprint).not.toBe(h.expected.operationPayloadFingerprint);
    expect(() => verified(h, h.raw, { ...h.expected, operationPayloadFingerprint: changedFingerprint })).toThrow(/locked/);
    const { operationPayloadFingerprint: _hash, ...missingProof } = h.expected;
    expect(() => verified(h, h.raw, missingProof)).toThrow(/Original assignment, service rate and discount-value intent cannot be proven/);
  });
});
describe("c24 existing controller / read-only restart recovery keeps original pointer locked", () => {
  it("submits once, snapshots immutable nested intent, validates c24 GET twice, then holds true fingerprint gap", async () => {
    const h = harness(); const pending = h.controller.submit(h.draft), duplicate = h.controller.submit(h.draft);
    expect(await pending).toBe(false); expect(await duplicate).toBe(false); expect(h.api.create).toHaveBeenCalledTimes(1);
    const record = await h.secure.store.read(9, h.session.user.id);
    expect(record).toMatchObject({ operationKey: base.operationKey, recurrenceRuleId: 301, jobId: 501, phase: "saved", payload: { recurrence: rule(), lineItems: base.lineItems, notifyCustomer: false } });
    expect(h.api.recurrenceReadback).toHaveBeenCalledTimes(2); expect(h.api.detail).toHaveBeenCalledTimes(5);
    expect(h.controller.getState().detailError).toMatch(/no independently comparable original fingerprint/);
    expect(h.onCreated).not.toHaveBeenCalled(); expect(h.secure.remove).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("lost response resumes using original operation GET and job pointer with no second POST", async () => {
    const h = harness(); let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(h.api.session).mockImplementationOnce(async () => { await hold; return h.session; });
    const real = h.api.create; h.api.create = vi.fn(async (...args: Parameters<CompanyCreateJobTransport["create"]>) => { await real(...args); throw new Error("Response lost after commit"); });
    const pending = h.controller.submit(h.draft); h.draft.lineItems[0].quantity = 1; h.draft.recurrence.startDate = "2026-12-15"; release();
    expect(await pending).toBe(false); expect(h.controller.getState().phase).toBe("uncertain"); h.controller.detach();
    const restarted = createCompanyJobController(h.input); expect(await restarted.restore()).toBe(false);
    expect(h.api.operation).toHaveBeenCalledWith(h.session.token, 9, base.operationKey); expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.input.newOperationKey).toHaveBeenCalledTimes(1);
    expect(await h.secure.store.read(9, h.session.user.id)).toMatchObject({ operationKey: base.operationKey, jobId: 501, recurrenceRuleId: 301, payload: { recurrence: rule(), lineItems: base.lineItems } });
    expect(h.onCreated).not.toHaveBeenCalled(); expect(h.secure.remove).not.toHaveBeenCalled(); restarted.detach();
  });
  it.each(["unknown", "pending", "unavailable", "wrongPointer"])("%s operation recovery never issues another write or new key", async kind => {
    const h = harness(); h.api.create = vi.fn(async () => { throw new Error("Uncertain POST"); }); await h.controller.submit(h.draft);
    h.api.operation = vi.fn(async () => { if (kind === "unavailable") throw new Error("Unavailable GET"); return { key: kind === "wrongPointer" ? "hsc-wrong-original-pointer" : base.operationKey, state: kind === "pending" ? "pending" as const : "unknown" as const, jobId: null, rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null }; });
    expect(await h.controller.reconcile()).toBe(false); expect(await h.controller.submit(h.draft)).toBe(false);
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.input.newOperationKey).toHaveBeenCalledTimes(1); expect(h.onCreated).not.toHaveBeenCalled(); expect(h.secure.remove).not.toHaveBeenCalled(); h.controller.detach();
  });
  it.each(["assignment", "rootPrice", "siblingPrice", "financialSnapshot", "ruleVersion", "count"])("rejects %s during canonical GET recovery without callback/removal", async kind => {
    const h = harness(); await h.controller.submit(h.draft);
    if (kind === "assignment") h.fake.state().jobs[1].assigned_user_id = 8;
    if (kind === "rootPrice") h.fake.state().jobs[0].amount = 999;
    if (kind === "siblingPrice") h.fake.state().jobs[1].amount = 999;
    if (kind === "count") h.fake.state().jobs.pop();
    if (kind === "financialSnapshot" || kind === "ruleVersion") {
      const original = h.api.recurrenceReadback!; let calls = 0;
      h.api.recurrenceReadback = vi.fn(async (...args: Parameters<NonNullable<CompanyCreateJobTransport["recurrenceReadback"]>>) => {
        const raw = await original(...args) as any;
        if (++calls === 2) {
          if (kind === "financialSnapshot") { const rows = JSON.parse(raw.verification.financialSnapshotVersion); rows[0].total = 999; raw.verification.financialSnapshotVersion = JSON.stringify(rows); }
          else { raw.recurrence.updatedAt = "2026-11-18T12:00:00.000Z"; raw.verification.ruleUpdatedAt = raw.recurrence.updatedAt; }
        }
        return raw;
      });
    }
    expect(await h.controller.reconcile()).toBe(false); expect(h.onCreated).not.toHaveBeenCalled(); expect(h.secure.remove).not.toHaveBeenCalled(); expect(h.api.create).toHaveBeenCalledTimes(1);
    expect((await h.secure.store.read(9, h.session.user.id))?.operationKey).toBe(base.operationKey); h.controller.detach();
  });
  it("one-time multiservice Job path and two-argument calendar callback remain unchanged", async () => {
    const h = harness(); const { recurrence: _recurrence, ...oneTime } = h.draft;
    expect(await h.controller.submit(oneTime)).toBe(true); expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.onCreated).toHaveBeenCalledTimes(1);
    expect(h.onCreated.mock.calls[0]).toHaveLength(2); expect(h.api.recurrenceReadback).not.toHaveBeenCalled(); expect(h.secure.remove).toHaveBeenCalledTimes(1); h.controller.detach();
  });
  it("blocked default transport and legacy semantic series cannot enable recurrence or call production", async () => {
    const h = harness(fixture(), false); h.api.series = vi.fn(); expect(await h.controller.submit(h.draft)).toBe(false);
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.api.quote).not.toHaveBeenCalled(); expect(h.input.newOperationKey).not.toHaveBeenCalled(); h.controller.detach();
    const defaultController = createCompanyJobController({ ...h.input, session: actor(), transport: undefined });
    expect(await defaultController.submit(h.draft)).toBe(false); expect(fetch).not.toHaveBeenCalled(); defaultController.detach();
  });
  it("blocked production restore preserves protected original intent without operation/detail calls", async () => {
    const h = harness(fixture(), false); const { operationKey, ...payload } = base;
    const record: CompanyCreationRecord = { version: 1, companyId: 9, userId: h.session.user.id, operationKey, payload: { ...payload, recurrence: rule() }, timezone: "America/Chicago", phase: "uncertain", jobId: null, createdAt: "2026-11-17T12:00:00.000Z", updatedAt: "2026-11-17T12:00:00.000Z" };
    await h.secure.store.reserve(record); expect(await h.controller.restore()).toBe(false); expect(h.api.operation).not.toHaveBeenCalled(); expect(h.api.detail).not.toHaveBeenCalled(); expect(h.api.create).not.toHaveBeenCalled(); h.controller.detach();
  });
});
