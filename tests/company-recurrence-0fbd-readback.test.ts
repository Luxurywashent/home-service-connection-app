import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authority, dates, declarations, fixture, readBackend, response, sourceHashes, extractedDeclarations } from "/home/ubuntu/hsc-mobile-0fbd-final-integration-20261117/recurrence-fixtures/exact-source-fixture";
import { normalizeCompanyJobRecurrence, normalizeCompanyJobRecurrenceReadback, companyJobRecurrenceUnavailableMessage,
  verifyCompanyJobSavedSeries, type CompanyJobRecurrenceInput } from "../lib/company-job-recurrence";
import { createCompanyCreationStore, type CompanyCreationRecord } from "../lib/company-job-creation-storage";
import { createCompanyJobController, type CompanyCreateJobTransport } from "../lib/company-create-job";
import { normalizeJobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";

vi.mock("expo-crypto", () => ({ randomUUID, digestStringAsync: async (_algorithm: string, text: string) => createHash("sha256").update(text).digest("hex"), CryptoDigestAlgorithm: { SHA256: "SHA-256" } }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only", getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

type Row = Record<string, any>; // Isolated exact backend wire JSON; not production models.
const types = ["weekly", "biweekly", "monthly_date", "monthly_ordinal"] as const;
const terms = ["1_month", "3_months", "6_months", "1_year", "never_ends"] as const;
const rule = (type: CompanyJobRecurrenceInput["type"] = "weekly", term: CompanyJobRecurrenceInput["term"] = "1_month"): CompanyJobRecurrenceInput => ({
  type, term, startDate: "2026-12-01", ...(type !== "monthly_date" ? { dayOfWeek: 2 } : {}), ...(type === "monthly_ordinal" ? { ordinal: -1 as const } : {}),
});
// Original acceptance input facts, including the 150-minute multiservice quantity quote.
const base = { customerId: 41, lineItems: [{ priceBookItemId: 71, quantity: 2 }, { priceBookItemId: 72, quantity: 1 }],
  scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T17:30:00.000Z", operationKey: "mock-recurrence-752-001", notifyCustomer: false };
const wire = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;
const evidence: Row[] = [];
async function saved(options: Parameters<typeof fixture>[0] = {}, recurrence = rule(), extra: Row = {}) {
  const fake = fixture(options), created = response();
  await fake.routes.createJob({ body: { ...base, recurrence, ...extra } }, created);
  expect(created.statusCode).toBe(201);
  const body = wire<Row>(created.body), jobId = body.job.id;
  const read = response(); await fake.routes.jobRecurrenceSeries({ params: { jobId: String(jobId) } }, read);
  expect(read.statusCode).toBe(200);
  return { fake, body, raw: wire<Row>(read.body), jobId };
}
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden"))); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
afterAll(() => writeFileSync("/home/ubuntu/hsc-mobile-0fbd-final-integration-20261117/recurrence-source-results.json", JSON.stringify({ decision: "BLOCKED", sourceHashes: Object.fromEntries(sourceHashes), extractedDeclarations, evidence }, null, 2) + "\n"));

describe("exact 0fbd canonical raw recurrence GET: read-only, not a persistence certificate", () => {
  it("binds loaded exact handlers/services to independently recorded candidate identities", () => {
    const provenance = JSON.parse(readFileSync("/home/ubuntu/hsc-mobile-0fbd-final-integration-20261117/acceptance-source-body-provenance.json", "utf8"));
    expect(JSON.stringify(provenance)).toContain("0fbd3b673eaadb0a1e646c2003b806d439c87088");
    expect(createHash("sha256").update(readBackend("server/jobService.ts")).digest("hex")).toBe("4ca840c26049c4216ba37655db95d31a58a20f6509e59331d9daa5e26b9972c5");
    expect(createHash("sha256").update(readBackend("server/mobileOperations.ts")).digest("hex")).toBe("8aec14141fca91a26c0120427d16b7a195b262771ca0b87814dcecc64601d928");
    expect(readFileSync("/home/ubuntu/hsc-mobile-0fbd-final-integration-20261117/recurrence-fixtures/exact-source-fixture.ts", "utf8"))
      .toBe(readFileSync("/home/ubuntu/hsc-mobile-0fbd-final-integration-20261117/acceptance-run/recurrence-fixtures/exact-source-fixture.ts", "utf8"));
  });
  it.each(types)("normalizes actual %s GET without adding request fields", async type => {
    const h = await saved({ mysqlDates: true }, rule(type));
    const read = normalizeCompanyJobRecurrenceReadback(h.raw, h.jobId);
    expect(read).toEqual(h.raw); expect(Object.isFrozen(read)).toBe(true); expect(Object.isFrozen(read.recurrence)).toBe(true);
    expect(Object.isFrozen(read.occurrences)).toBe(true); expect(read.occurrences.every(Object.isFrozen)).toBe(true);
    for (const field of ["companyId", "customerId", "operationKey", "timezone", "term", "count", "neverEnds", "occurrenceJobIds"]) expect(read).not.toHaveProperty(field);
    expect(read.recurrence).not.toHaveProperty("startDate"); expect(read.recurrence).not.toHaveProperty("jobId");
    if (type === "monthly_ordinal") expect(read.recurrence?.ordinalWeek).toBe(5); // Never rewrite stored 5 as requested -1.
    h.raw.occurrences[0].status = "changed"; expect(read.occurrences[0].status).toBe("scheduled");
    evidence.push({ type, read });
  });
  it.each(terms)("retains actual saved date/end state for %s without inventing a term", async term => {
    const recurrence = rule("weekly", term), h = await saved({}, recurrence);
    const read = normalizeCompanyJobRecurrenceReadback(h.raw, h.jobId);
    const expected = dates.buildStoredRecurrenceRule(recurrence, recurrence.startDate);
    expect(read.recurrence?.startsOn).toBe(expected.firstDate); expect(read.recurrence?.endsOn).toBe(expected.rule.endDate ?? null);
    expect(read.occurrences).toHaveLength(dates.generateRecurringDates(expected.firstDate, expected.rule).length);
    if (term === "never_ends") expect(read.occurrences).toHaveLength(13);
    expect(read).not.toHaveProperty("term"); expect(read.recurrence).not.toHaveProperty("term");
  });
  it("nondefault timezone is valid CREATE metadata but absent from durable rule/GET", async () => {
    const h = await saved({ timezone: "Australia/Lord_Howe" }, rule(), { scheduledStartAt: "2026-11-30T22:00:00.000Z", scheduledEndAt: "2026-12-01T00:30:00.000Z" });
    const read = normalizeCompanyJobRecurrenceReadback(h.raw, h.jobId);
    expect(h.body.job.recurrence.timezone).toBe("Australia/Lord_Howe"); expect(read.recurrence?.startTime).toBe("09:00");
    expect(read.occurrences[0].scheduledStartAt).toBe("2026-11-30T22:00:00.000Z");
    expect(read).not.toHaveProperty("timezone"); expect(h.fake.state().rules[0]).not.toHaveProperty("timezone");
    expect(() => verifyCompanyJobSavedSeries(read, { companyId: 9, customerId: 41, jobId: h.jobId, operationKey: base.operationKey,
      recurrence: rule(), scheduledStartAt: "2026-11-30T22:00:00.000Z" })).toThrow();
    evidence.push({ nondefaultTimezone: { createMetadata: h.body.job.recurrence, storedRule: h.fake.state().rules[0], read } });
  });
  it.each([undefined, base.scheduledEndAt])("every actual occurrence has server 150-minute duration and canonical stored quantity/pricing for end %s", async end => {
    const h = await saved({}, rule(), { scheduledEndAt: end });
    const read = normalizeCompanyJobRecurrenceReadback(h.raw, h.jobId);
    expect(read.recurrence?.durationMinutes).toBe(150);
    const details = await Promise.all(read.occurrences.map(async row => wire<Row>(await h.fake.service.getJobDetail(h.fake.db, authority(), row.jobId))));
    for (const detail of details) {
      expect(detail.company_id).toBe(9); expect(detail.customerId).toBe(41); expect(detail.recurrenceRuleId).toBe(301);
      expect(Date.parse(detail.scheduledEndAt) - Date.parse(detail.scheduledStartAt)).toBe(9_000_000);
      expect(detail.lineItems.map((line: Row) => [line.priceBookItemId, line.quantity])).toEqual([[71, 2], [72, 1]]);
      expect([detail.subtotalAmount, detail.discountAmount, detail.taxAmount, detail.taxRateBps, detail.amount]).toEqual([250, 0, 10, 500, 260]);
    }
    // These canonical detail facts are real; they still do not prove original rule timezone/anchor or snapshot consistency.
    evidence.push({ end: end ?? "Auto", read, details });
  });
  it("actual one-year Chicago slots traverse DST while retaining server wall time/duration, without persisting timezone proof", async () => {
    const h = await saved({}, rule("weekly", "1_year"), { scheduledEndAt: undefined });
    const read = normalizeCompanyJobRecurrenceReadback(h.raw, h.jobId);
    const wall = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    for (const row of read.occurrences) {
      expect(wall.format(new Date(row.scheduledStartAt!))).toBe("09:00");
      expect(Date.parse(row.scheduledEndAt!) - Date.parse(row.scheduledStartAt!)).toBe(9_000_000);
    }
    expect(new Set(read.occurrences.map(row => row.scheduledStartAt!.slice(11, 16)))).toEqual(new Set(["15:00", "14:00"]));
    expect(read).not.toHaveProperty("timezone");
  });
  it("raw series siblings expose no customer binding, although individual canonical Job GET detects a changed customer", async () => {
    const h = await saved(); h.fake.state().jobs[1].customer_id = 42;
    const result = response(); await h.fake.routes.jobRecurrenceSeries({ params: { jobId: String(h.jobId) } }, result);
    const read = normalizeCompanyJobRecurrenceReadback(wire(result.body), h.jobId);
    expect(read.occurrences[1]).not.toHaveProperty("customerId"); expect(read.occurrences[1]).not.toHaveProperty("companyId");
    const sibling = await h.fake.service.getJobDetail(h.fake.db, authority(), read.occurrences[1].jobId);
    expect(sibling.customerId).toBe(42); expect(sibling.company_id).toBe(9);
  });
  it("actual separate SELECTs can observe different rule/occurrence edit states without shared snapshot proof", async () => {
    const h = await saved(), execute = h.fake.db.execute;
    h.fake.db.execute = vi.fn(async (sql: string, params?: unknown[]) => {
      const result = await execute(sql, params);
      if (sql.includes("FROM fs_service_recurrence_rules WHERE")) {
        // Clone the already-read result, then simulate a concurrent edit before
        // the actual next SELECT. No source changes, request echo or replacement SQL.
        const previousRule = structuredClone(result);
        h.fake.state().rules[0].is_active = 0; h.fake.state().jobs[1].status = "cancelled";
        return previousRule;
      }
      return result;
    });
    const raw = await h.fake.service.getJobRecurrenceSeries(h.fake.db, authority(), h.jobId);
    const read = normalizeCompanyJobRecurrenceReadback(wire(raw), h.jobId);
    expect(read.recurrence?.isActive).toBe(true); expect(read.occurrences[1].status).toBe("cancelled");
    expect(h.fake.state().rules[0].is_active).toBe(0); expect(read).not.toHaveProperty("snapshot");
  });
  it("saved operation GET matches original key/Job but deliberately omits stored payload fingerprint", async () => {
    const h = await saved(), result = response();
    await h.fake.routes.jobCreationOperation({ params: { operationKey: base.operationKey } }, result);
    const operation = wire<Row>(result.body).operation;
    expect(operation).toMatchObject({ key: base.operationKey, state: "saved", jobId: h.jobId });
    expect(h.fake.state().operations[0].payload_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(operation).not.toHaveProperty("payloadFingerprint"); expect(operation).not.toHaveProperty("customerId");
    expect(h.fake.state().rules[0].job_id).toBe(h.jobId); expect(h.raw.recurrence).not.toHaveProperty("jobId");
    evidence.push({ operation, storedOperation: h.fake.state().operations[0] });
  });
  it("stored first-date conversion collapses distinct requested anchors and term is not persisted", async () => {
    const a = await saved({}, { ...rule(), startDate: "2026-11-30" });
    const b = await saved({}, rule());
    expect(a.raw.recurrence).toEqual(b.raw.recurrence);
    expect(a.fake.state().operations[0].payload_fingerprint).toBe(b.fake.state().operations[0].payload_fingerprint);
    expect(a.raw.recurrence.startsOn).toBe("2026-12-01");
    evidence.push({ collapsedOriginalStartDates: ["2026-11-30", "2026-12-01"], persistedRule: a.raw.recurrence });
  });
  it("actual cross-Company and revoked GETs cannot disclose recurrence data", async () => {
    const h = await saved();
    for (const req of [{ companyId: 10 }, { denied: true }]) {
      const result = response(); await h.fake.routes.jobRecurrenceSeries({ ...req, params: { jobId: String(h.jobId) } }, result);
      expect(result.statusCode).toBe(req.denied ? 401 : 404); expect(result.body).not.toHaveProperty("recurrence");
    }
  });
  it("current GET cannot certify original complete IDs or rule anchor: removed sibling/changed stored anchor are not exposed", async () => {
    const h = await saved();
    h.fake.state().jobs.splice(1, 1); h.fake.state().rules[0].job_id = 999;
    const result = response(); await h.fake.routes.jobRecurrenceSeries({ params: { jobId: String(h.jobId) } }, result);
    const raw = wire<Row>(result.body), read = normalizeCompanyJobRecurrenceReadback(raw, h.jobId);
    expect(read.occurrences.map(row => row.occurrenceNumber)).toEqual([0, 2, 3, 4]);
    expect(read.recurrence).not.toHaveProperty("jobId"); expect(read).not.toHaveProperty("count");
    expect(read).not.toHaveProperty("complete"); expect(result.statusCode).toBe(200);
  });
  it("cancellation and edited occurrence instants remain current read-only facts, not repaired recurrence", async () => {
    const h = await saved(); Object.assign(h.fake.state().rules[0], { is_active: 0, cancelled_from_occurrence_number: 2 });
    Object.assign(h.fake.state().jobs[1], { status: "cancelled", scheduled_end_at: null });
    const result = response(); await h.fake.routes.jobRecurrenceSeries({ params: { jobId: String(h.jobId) } }, result);
    const read = normalizeCompanyJobRecurrenceReadback(wire(result.body), h.jobId);
    expect(read.recurrence?.isActive).toBe(false); expect(read.recurrence?.cancelledFromOccurrenceNumber).toBe(2);
    expect(read.occurrences[1].status).toBe("cancelled"); expect(read.occurrences[1].scheduledEndAt).toBeNull();
  });
  it("source exposes row update times but no rule version/shared GET snapshot or complete-series count", () => {
    const get = declarations(readBackend("server/jobService.ts"), ["getJobRecurrenceSeries"]);
    expect(get).toContain("updated_at"); expect(get).not.toContain("withTransaction");
    expect(get).not.toMatch(/snapshot|version|expectedCount|COUNT\(/); expect(get).not.toContain("timezone");
    const operation = declarations(readBackend("server/mobileOperations.ts"), ["jobCreationOperation"]);
    expect(operation).not.toContain("payloadFingerprint");
  });
  it.each(["jobId", "key", "duplicate", "order", "date", "timezoneEcho", "receipt", "accessor", "sparse"])("rejects malformed raw GET %s without synthesis", async kind => {
    const h = await saved(), raw = h.raw;
    if (kind === "jobId") raw.jobId = 502;
    if (kind === "key") raw.occurrences[0].occurrenceKey = "302:0";
    if (kind === "duplicate") raw.occurrences[1].jobId = raw.occurrences[0].jobId;
    if (kind === "order") raw.occurrences.reverse();
    if (kind === "date") raw.recurrence.startsOn = "2026-02-30";
    if (kind === "timezoneEcho") raw.timezone = h.body.job.recurrence.timezone;
    if (kind === "receipt") Object.assign(raw, h.body.job.recurrence);
    if (kind === "accessor") Object.defineProperty(raw.recurrence, "startTime", { get: () => { throw new Error("getter must not run"); }, enumerable: true });
    if (kind === "sparse") delete raw.occurrences[1];
    expect(() => normalizeCompanyJobRecurrenceReadback(raw, h.jobId)).toThrow(/original request remains locked/);
  });
  it("actual non-recurring GET preserves null recurrence instead of treating one saved Job as a series", async () => {
    const h = await saved({}, rule(), { recurrence: undefined });
    const read = normalizeCompanyJobRecurrenceReadback(h.raw, h.jobId);
    expect(read.recurrence).toBeNull(); expect(read.occurrences).toHaveLength(1);
    expect(read.occurrences[0].occurrenceNumber).toBeNull(); expect(read.occurrences[0].occurrenceKey).toBeNull();
  });
});

let actorId = 91000;
function actor(): JobSyncNativeSession { return { token: `offline-recurrence-${++actorId}`, portal: "company", user: { id: actorId, role: "owner", name: "Owner", email: null },
  company: { id: 9, name: "Company", slug: "unit", logoUrl: null, primaryColor: null, accentColor: null } }; }
function storage() {
  const data = new Map<string, string>();
  const adapter = { getItemAsync: vi.fn(async (key: string) => data.get(key) ?? null), setItemAsync: vi.fn(async (key: string, value: string) => { data.set(key, value); }), deleteItemAsync: vi.fn(async (key: string) => { data.delete(key); }) };
  const api = createCompanyCreationStore({ platform: "ios", secureStore: adapter });
  const remove = vi.spyOn(api, "remove");
  return { api, adapter, remove };
}
async function harness() {
  const h = await saved(), signed = actor(), store = storage(), onCreated = vi.fn(async () => true), onState = vi.fn(), newKey = vi.fn(() => "must-not-be-generated");
  const api = { session: vi.fn(async () => signed), settings: vi.fn(async () => ({ id: 9, name: "Company", timezone: "America/Chicago" })),
    customer: vi.fn(async () => ({ id: 41, companyId: 9 })), priceBook: vi.fn(async () => []), quote: vi.fn(), create: vi.fn(), jobs: vi.fn(async () => []),
    detail: vi.fn(async (_token: string, jobId: number, companyId: number) => {
      const detail = normalizeJobSyncCompanyJobDetail({ job: wire(await h.fake.service.getJobDetail(h.fake.db, authority(), jobId)) }, jobId, companyId);
      if (!detail) throw new Error("Actual canonical detail normalization failed"); return detail;
    }), operation: vi.fn(async (_token: string, _companyId: number, operationKey: string) => {
      const result = response(); await h.fake.routes.jobCreationOperation({ params: { operationKey } }, result); return wire<Row>(result.body).operation;
    }), series: vi.fn(async () => { throw new Error("A semantic series echo is not authorized"); }),
  };
  const typedApi: CompanyCreateJobTransport = api;
  const input = { session: signed, transport: typedApi, store: store.api, isCurrent: () => true, verifyAssignment: vi.fn(async () => true), onCreated, onState, newOperationKey: newKey };
  const controller = createCompanyJobController(input);
  const { operationKey, ...payload } = base;
  const record: CompanyCreationRecord = { version: 1, companyId: 9, userId: signed.user.id, operationKey,
    payload: { ...payload, recurrence: normalizeCompanyJobRecurrence(rule()) }, timezone: "America/Chicago", phase: "uncertain", jobId: null,
    createdAt: "2026-11-17T12:00:00.000Z", updatedAt: "2026-11-17T12:00:00.000Z" };
  return { ...h, signed, store, api, input, controller, onCreated, onState, newKey, record };
}
describe("connected real form-controller path fails closed despite optional semantic series transport", () => {
  it.each(types)("blocks %s before any key/reservation/POST or preflight reads", async type => {
    const h = await harness();
    expect(await h.controller.submit({ customerId: 41, lineItems: base.lineItems, date: "2026-12-01", startHour: 9, recurrence: rule(type) })).toBe(false);
    expect(h.controller.getState().message).toBe(companyJobRecurrenceUnavailableMessage);
    for (const method of [h.api.create, h.api.quote, h.api.session, h.api.series, h.newKey, h.store.adapter.setItemAsync]) expect(method).not.toHaveBeenCalled();
    h.controller.detach();
  });
  it("new customer with ongoing multiservice quantities cannot downgrade to one Job", async () => {
    const h = await harness();
    expect(await h.controller.submit({ newCustomer: { firstName: "Casey", lastName: "Example" }, lineItems: base.lineItems,
      date: "2026-12-01", startHour: 9, recurrence: rule("weekly", "never_ends") })).toBe(false);
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.store.adapter.setItemAsync).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("lost CREATE/restart uses GET original key, keeps saved identity and never clears/calls calendar from incomplete proof", async () => {
    const h = await harness(); expect(await h.store.api.reserve(h.record)).toBe(true);
    expect(await h.controller.restore()).toBe(false);
    expect(h.api.operation).toHaveBeenCalledWith(h.signed.token, 9, base.operationKey);
    expect(h.api.detail).toHaveBeenCalledWith(h.signed.token, 501, 9); expect(h.controller.getState().phase).toBe("saved");
    expect(h.controller.getState().detailError).toBe(companyJobRecurrenceUnavailableMessage);
    expect((await h.store.api.read(9, h.signed.user.id))?.jobId).toBe(501); expect(h.onCreated).not.toHaveBeenCalled();
    h.controller.detach();
    const restarted = createCompanyJobController(h.input); expect(await restarted.restore()).toBe(false);
    expect(h.api.operation).toHaveBeenLastCalledWith(h.signed.token, 9, base.operationKey);
    expect(await h.store.api.read(9, h.signed.user.id)).not.toBeNull();
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.api.series).not.toHaveBeenCalled(); expect(h.newKey).not.toHaveBeenCalled();
    expect(h.onCreated).not.toHaveBeenCalled(); expect(h.store.remove).not.toHaveBeenCalled(); restarted.detach();
  });
  it("actual unknown operation is not absence proof and cannot auto-POST or generate a replacement", async () => {
    const h = await harness(); h.fake.state().operations.length = 0; await h.store.api.reserve(h.record);
    expect(await h.controller.restore()).toBe(false); expect(h.controller.getState().phase).toBe("uncertain");
    expect(await h.controller.reconcile()).toBe(false); expect(h.api.operation).toHaveBeenCalledTimes(2);
    expect(h.api.operation.mock.calls.every(call => call[2] === base.operationKey)).toBe(true);
    expect(h.api.detail).not.toHaveBeenCalled(); expect(h.api.create).not.toHaveBeenCalled(); expect(h.newKey).not.toHaveBeenCalled();
    expect((await h.store.api.read(9, h.signed.user.id))?.operationKey).toBe(base.operationKey); h.controller.detach();
  });
  it.each(["operationJob", "customer", "company", "schedule", "pricing"])("mismatched %s binding retains durable original request without calendar callback", async kind => {
    const h = await harness(); await h.store.api.reserve({ ...h.record, phase: "saved", jobId: 501 });
    if (kind === "operationJob") h.fake.state().operations[0].job_id = 502;
    if (kind === "customer") h.fake.state().jobs[0].customer_id = 42;
    if (kind === "company") h.fake.state().jobs[0].company_id = 10;
    if (kind === "schedule") h.fake.state().jobs[0].scheduled_start_at = new Date("2026-12-01T16:00:00.000Z");
    if (kind === "pricing") h.fake.state().lineItems[0].quantity = 1;
    expect(await h.controller.restore()).toBe(false); expect(h.controller.getState().phase).toBe("saved");
    expect(await h.store.api.read(9, h.signed.user.id)).not.toBeNull(); expect(h.onCreated).not.toHaveBeenCalled(); expect(h.api.create).not.toHaveBeenCalled(); h.controller.detach();
  });
});
