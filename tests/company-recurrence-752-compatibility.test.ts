import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authority, dates, declarations, evaluate, fixture, readBackend, response, slots } from "/home/ubuntu/hsc-mobile-752ccca3-compatibility-20261117/recurrence-fixtures/exact-source-fixture";

import { normalizeCompanyJobRecurrence, companyJobRecurrenceFirstDate, normalizeCompanyJobRecurrenceReceipt,
  verifyCompanyJobSavedSeries, type CompanyJobRecurrenceInput, type CompanyJobSavedSeries } from "../lib/company-job-recurrence";
import { createCompanyCreationStore, type CompanyCreationRecord } from "../lib/company-job-creation-storage";
import { createCompanyJobController, type CompanyCreateJobTransport } from "../lib/company-create-job";
import type { JobSyncCompanyJobDetail, JobSyncNativeSession } from "../lib/jobsync-mobile-api";
vi.mock("expo-crypto", () => ({ randomUUID, digestStringAsync: async (_algorithm: string, text: string) => createHash("sha256").update(text).digest("hex"), CryptoDigestAlgorithm: { SHA256: "SHA-256" } }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only", getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

/** Exact 752 declarations execute with transaction snapshots, SQL storage and no live imports/IO. */
const root = "/home/ubuntu/hsc-mobile-752ccca3-compatibility-20261117";
const types = ["weekly", "biweekly", "monthly_date", "monthly_ordinal"] as const;
const terms = ["1_month", "3_months", "6_months", "1_year", "never_ends"] as const;
const rule = (type: string = "weekly", term: string = "1_month", startDate = "2026-12-01") => ({ type, term, startDate,
  ...(type !== "monthly_date" ? { dayOfWeek: 2 } : {}), ...(type === "monthly_ordinal" ? { ordinal: -1 } : {}) });
const base = { customerId: 41, lineItems: [{ priceBookItemId: 71, quantity: 2 }, { priceBookItemId: 72, quantity: 1 }],
  scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T17:30:00.000Z", operationKey: "mock-recurrence-752-001", notifyCustomer: false };
type Row = Record<string, any>; // Raw isolated backend DTOs, not production API types.
function json(res: ReturnType<typeof response>): Row { return res.body as Row; }
async function create(fake: ReturnType<typeof fixture>, recurrence = rule(), extra: Row = {}) {
  const res = response(); await fake.routes.createJob({ body: { ...base, recurrence, ...extra } }, res); return res;
}
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden"))); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("752 exact-source durable recurring CREATE and reads", () => {
  it("pins exact revision and critical source bytes", () => {
    expect(JSON.parse(readFileSync(`${root}/backend-revision.json`, "utf8")).sha).toBe("752ccca3edf69ef35ca7b1a470484f3f204f4568");
    const hashes = { "server/mobileOperations.ts": "830b8d866288daa3e6be698ef399e5e43d97de4b4aa8268634e0eca8b77ddc6f", "server/jobService.ts": "d55c322a3d9fc28a961b4014bf36509c2f7c0f6ce958089cdc1dde6cc791c13f", "server/staffAvailability.ts": "3c4cf10851200c4af326b9af7c985294275b5ec71d163c501c7bbf829603de2b" };
    for (const [file, hash] of Object.entries(hashes)) expect(createHash("sha256").update(readBackend(file)).digest("hex")).toBe(hash);
  });
  it.each(types.flatMap(type => terms.map(term => ({ type, term }))))("actual CREATE persists canonical $type / $term, ordered occurrences and copied server pricing", async ({ type, term }) => {
    const fake = fixture(), recurrence = rule(type, term), result = await create(fake, recurrence, { assignedUserId: 8, discount: { kind: "percent", value: 10, code: "MOCK" } });
    expect(result.statusCode, JSON.stringify(result.body)).toBe(201);
    const state = fake.state(), canonical = dates.buildStoredRecurrenceRule(recurrence, recurrence.startDate);
    expect(state.rules).toHaveLength(1);
    expect(state.rules[0]).toMatchObject({ id: 301, company_id: 9, job_id: 501, cadence: type === "monthly_date" ? "monthly_day" : type === "monthly_ordinal" ? "monthly_weekday" : type,
      weekday: type === "monthly_date" ? null : 2, ordinal_week: type === "monthly_ordinal" ? 5 : null, day_of_month: type === "monthly_date" ? 1 : null,
      starts_on: canonical.firstDate, ends_on: canonical.rule.endDate ?? null, start_time: "09:00", duration_minutes: 150 });
    const expectedDates = dates.generateRecurringDates(canonical.firstDate, canonical.rule);
    expect(state.jobs).toHaveLength(expectedDates.length);
    expect(state.jobs.length).toBeGreaterThan(1);
    expect(state.jobs.map(row => row.recurrence_occurrence_key)).toEqual(state.jobs.map((_row, index) => `301:${index}`));
    expect(state.jobs.map(row => row.recurrence_occurrence_number)).toEqual(state.jobs.map((_row, index) => index));
    expect(fake.availability).toHaveBeenCalledTimes(state.jobs.length);
    for (const [index, row] of state.jobs.entries()) {
      expect(row).toMatchObject({ company_id: 9, customer_id: 41, recurrence_rule_id: 301, assigned_user_id: 8,
        subtotal_amount: 250, discount_amount: 25, tax_amount: 9, tax_rate_bps: 500, amount: 234 });
      expect(new Date(row.scheduled_start_at as string).toISOString().slice(0, 10)).toBe(expectedDates[index]);
      expect(new Date(row.scheduled_end_at as string).getTime() - new Date(row.scheduled_start_at as string).getTime()).toBe(150 * 60_000);
      expect(state.lineItems.filter(line => line.job_id === row.id).map(line => [line.price_book_item_id, line.quantity, line.unit_price, line.total_price, line.sort_order])).toEqual([[71, 2, 100, 200, 0], [72, 1, 50, 50, 1]]);
    }
    expect(json(result).job.recurrence.occurrenceJobIds).toEqual(state.jobs.map(row => row.id));
    expect(json(result).job.recurrence).toMatchObject({ ruleId: 301, count: state.jobs.length, timezone: "America/Chicago", term, neverEnds: term === "never_ends" });
    const read = await fake.service.getJobRecurrenceSeries(fake.db, authority(), 501);
    expect(read).toMatchObject({ jobId: 501, recurrence: { ruleId: 301, startsOn: canonical.firstDate, endsOn: canonical.rule.endDate ?? null, durationMinutes: 150, isActive: true } });
    expect((read.occurrences as Row[]).map(row => row.jobId)).toEqual(state.jobs.map(row => row.id));
    expect(fake.connection.commit).toHaveBeenCalledOnce(); expect(fake.connection.rollback).not.toHaveBeenCalled(); expect(fake.booking).not.toHaveBeenCalled();
  });
  it.each(["owner", "dispatcher"])("%s same-key replay returns existing persisted series without duplicate Jobs/customer/assignments", async role => {
    const fake = fixture(); const { customerId: _id, ...rest } = base;
    const body = { ...rest, recurrence: rule(), assignedUserId: 8, newCustomer: { firstName: "Casey", lastName: "Example", email: "casey@example.test", addressLine1: "Offline address" } };
    const first = response(); await fake.routes.createJob({ role, body }, first);
    const snapshot = structuredClone(fake.state()); const replay = response(); await fake.routes.createJob({ role, body }, replay);
    expect(first.statusCode, JSON.stringify(first.body)).toBe(201); expect(replay.statusCode).toBe(200);
    expect(fake.state()).toEqual(snapshot); expect(fake.customer).toHaveBeenCalledOnce(); expect(fake.state().customers[0]).toMatchObject({ id: 42, company_id: 9, email: "casey@example.test" });
    expect(json(replay).job.recurrence).toEqual(json(first).job.recurrence); expect(json(replay).operation).toEqual({ key: base.operationKey, state: "saved", replayed: true });
    expect(fake.booking).not.toHaveBeenCalled();
  });
  it("all-occurrence actual availability checks roll back on a later schedule block", async () => {
    const fake = fixture({ blockDate: "2026-12-15" }), result = await create(fake, rule(), { assignedUserId: 8, customerId: undefined, newCustomer: { firstName: "Casey", lastName: "Example" } });
    expect(result.statusCode).toBe(409); expect(fake.availability).toHaveBeenCalledTimes(3);
    expect(fake.queries.filter(query => query.sql.includes("FROM fs_schedule_blocks")).map(query => query.params[2])).toEqual(["2026-12-01", "2026-12-08", "2026-12-15"]);
    expect(fake.state().jobs).toHaveLength(0); expect(fake.state().rules).toHaveLength(0); expect(fake.state().customers).toHaveLength(0);
    expect(fake.connection.rollback).toHaveBeenCalledOnce(); expect(fake.connection.commit).not.toHaveBeenCalled(); expect(fake.booking).not.toHaveBeenCalled();
  });
  it("approved time-off conflict on final occurrence rolls back without customer or rule", async () => {
    const fake = fixture({ timeOffDate: "2026-12-29" }), result = await create(fake, rule(), { assignedUserId: 8 });
    expect(result.statusCode).toBe(409); expect(fake.availability).toHaveBeenCalledTimes(5);
    expect(fake.state().jobs).toHaveLength(0); expect(fake.state().rules).toHaveLength(0); expect(fake.connection.rollback).toHaveBeenCalledOnce();
  });
  it("late occurrence SQL failure atomically rolls back new customer, all Jobs, rule and operation", async () => {
    const fake = fixture({ failLine: 5 }), result = await create(fake, rule(), { customerId: undefined, newCustomer: { firstName: "Casey", lastName: "Example" } });
    expect(result.statusCode).toBe(400); expect(fake.customer).toHaveBeenCalledOnce(); expect(fake.connection.rollback).toHaveBeenCalledOnce(); expect(fake.connection.commit).not.toHaveBeenCalled();
    for (const rows of Object.values(fake.state())) expect(rows).toHaveLength(0);
    expect(fake.booking).not.toHaveBeenCalled();
  });
  it("lost response recovers via operation GET then recurrence GET with no second POST or SQL write", async () => {
    const fake = fixture(); await create(fake); const before = fake.queries.length;
    const operation = response(); await fake.routes.jobCreationOperation({ params: { operationKey: base.operationKey } }, operation);
    expect(json(operation).operation).toMatchObject({ key: base.operationKey, state: "saved", jobId: 501 });
    const series = response(); await fake.routes.jobRecurrenceSeries({ params: { jobId: String(json(operation).operation.jobId) } }, series);
    expect(series.statusCode).toBe(200); expect(json(series).occurrences.map((row: Row) => row.occurrenceKey)).toEqual(["301:0", "301:1", "301:2", "301:3", "301:4"]);
    expect(fake.queries.slice(before).every(query => query.sql.trimStart().startsWith("SELECT"))).toBe(true);
    expect(fake.connection.beginTransaction).toHaveBeenCalledOnce(); expect(fake.booking).not.toHaveBeenCalled();
  });
  it("both registered GET recurrence aliases invoke the same real handler; no recurrence POST/PATCH", async () => {
    const fake = fixture(); await create(fake);
    const source = declarations(readBackend("server/mobileOperations.ts"), ["registerMobileOperationalRoutes"]);
    const handlers: Row = { BASE: "/api/mobile/v1" };
    for (const match of source.matchAll(/app\.(?:get|post|put|patch|delete)\([^\n]+, (\w+)\)/g)) handlers[match[1]] = vi.fn();
    handlers.jobRecurrenceSeries = fake.routes.jobRecurrenceSeries;
    const registrar = evaluate<{ registerMobileOperationalRoutes: (app: Row) => void }>(source, ["registerMobileOperationalRoutes"], handlers);
    const routes: { method: string; path: string; handler: (req: Row, res: ReturnType<typeof response>) => Promise<unknown> }[] = [];
    const app = Object.fromEntries(["get", "post", "put", "patch", "delete"].map(method => [method, (path: string, handler: typeof fake.routes.jobRecurrenceSeries) => { routes.push({ method, path, handler }); }]));
    app.use = vi.fn();
    registrar.registerMobileOperationalRoutes(app);
    const aliases = routes.filter(route => route.path.endsWith("/recurrence")); expect(aliases.map(route => [route.method, route.path])).toEqual([
      ["get", "/api/mobile/v1/company/jobs/:jobId/recurrence"], ["get", "/api/mobile/v1/jobs/:jobId/recurrence"]]);
    for (const alias of aliases) { const res = response(); await alias.handler({ params: { jobId: "501" } }, res); expect(res.statusCode).toBe(200); expect(json(res).recurrence.ruleId).toBe(301); }
  });
  it("actual readback is tenant-scoped, validates Job ID and requires signed Company auth", async () => {
    const fake = fixture(); await create(fake);
    for (const [request, status] of [[{ denied: true, params: { jobId: "501" } }, 401], [{ companyId: 10, params: { jobId: "501" } }, 404], [{ params: { jobId: "0" } }, 400]] as const) {
      const res = response(); await fake.routes.jobRecurrenceSeries(request, res); expect(res.statusCode).toBe(status);
    }
    const denied = response(); await fake.routes.createJob({ role: "technician", body: { ...base, recurrence: rule() } }, denied); expect(denied.statusCode).toBe(403);
    const technicianRead = response(); await fake.routes.jobRecurrenceSeries({ role: "technician", params: { jobId: "501" } }, technicianRead); expect(technicianRead.statusCode).toBe(200); // Actual approved unassigned-read policy, not a manager-only GET.
  });
  it("changed recurrence on same operation key conflicts without replacing saved identities", async () => {
    const fake = fixture(); await create(fake); const snapshot = structuredClone(fake.state()); const result = await create(fake, rule("biweekly"));
    expect(result.statusCode).toBe(409); expect(fake.state()).toEqual(snapshot); expect(fake.connection.commit).toHaveBeenCalledOnce();
  });
  it("monthly-date month-end clamp and Chicago DST instants follow authoritative schedule", () => {
    const monthly = dates.buildStoredRecurrenceRule({ type: "monthly_date", term: "3_months" }, "2027-01-31");
    expect(dates.generateRecurringDates(monthly.firstDate, monthly.rule)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
    expect(slots.recurringJobSlots({ cadence: "weekly", weekday: 2, startsOn: "2027-03-02", endsOn: "2027-03-16", startTime: "09:00", durationMinutes: 150 }, "America/Chicago").map(row => row.scheduledStartAt)).toEqual(["2027-03-02T15:00:00.000Z", "2027-03-09T15:00:00.000Z", "2027-03-16T14:00:00.000Z"]);
  });
  it("ongoing persists active no-end rule but only 13 materialized occurrences, not unlimited Jobs", async () => {
    const fake = fixture(), result = await create(fake, rule("weekly", "never_ends")); expect(result.statusCode).toBe(201);
    expect(fake.state().rules[0]).toMatchObject({ is_active: 1, ends_on: null }); expect(fake.state().jobs).toHaveLength(13);
    const raw = await fake.service.getJobRecurrenceSeries(fake.db, authority(), 501);
    expect(raw).not.toHaveProperty("timezone"); expect(raw).not.toHaveProperty("operationKey"); expect(raw).not.toHaveProperty("customerId"); expect(raw).not.toHaveProperty("companyId");
  });
});

describe("ACTIVE recurring Save guarantee gates — no expected failures or weakened requirements", () => {
  it("REQUIREMENT: durable GET preserves canonical dates with MySQL Date decoding, not truncated Date.toString", async () => {
    const fake = fixture({ mysqlDates: true }); await create(fake);
    const result = response(); await fake.routes.jobRecurrenceSeries({ params: { jobId: "501" } }, result);
    expect(result.statusCode).toBe(200);
    expect(json(result).recurrence.startsOn).toBe("2026-12-01");
    expect(json(result).recurrence.endsOn).toBe("2027-01-01");
  });
  it("REQUIREMENT: recurrence creation preserves authenticated non-default Company timezone and first appointment", async () => {
    const fake = fixture({ timezone: "Australia/Lord_Howe" });
    const result = await create(fake, rule(), { scheduledStartAt: "2026-11-30T22:00:00.000Z", scheduledEndAt: "2026-12-01T00:30:00.000Z" });
    expect(result.statusCode).toBe(201);
    expect(json(result).job.recurrence.timezone).toBe("Australia/Lord_Howe");
    expect(json(result).job.scheduledStartAt).toBe("2026-11-30T22:00:00.000Z");
    expect(fake.state().rules[0].start_time).toBe("09:00");
  });
  it("REQUIREMENT: omitted End uses server quote duration on every recurring occurrence, not fixed 60", async () => {
    const fake = fixture(), result = await create(fake, rule(), { scheduledEndAt: undefined });
    expect(result.statusCode).toBe(201); expect(fake.state().rules[0].duration_minutes).toBe(150);
    for (const row of fake.state().jobs) expect(new Date(row.scheduled_end_at as string).getTime() - new Date(row.scheduled_start_at as string).getTime()).toBe(150 * 60_000);
  });
  it("REQUIREMENT: all-occurrence availability includes complete server duration when End is Auto", async () => {
    const fake = fixture({ blockDate: "2026-12-15" });
    // Restrict real fixture block to 10:00–11:00: outside buggy 09–10 but inside server-priced 09–11:30.
    const original = fake.db.execute; fake.db.execute = fake.connection.execute = vi.fn(async (sql: string, params?: unknown[]) => {
      const result = await original(sql, params);
      return sql.includes("FROM fs_schedule_blocks") && params?.[2] === "2026-12-15" ? [[{ start_hour: 10, end_hour: 11 }]] : result;
    });
    const result = await create(fake, rule(), { assignedUserId: 8, scheduledEndAt: undefined });
    expect(result.statusCode).toBe(409); expect(fake.connection.rollback).toHaveBeenCalledOnce(); expect(fake.state().jobs).toHaveLength(0);
  });
});

// Original focused mobile protection bodies copied unchanged; backend evidence above is separately pinned to 752.
describe("752 integration retains original protected mobile recurrence behavior", () => {
const rule = (type: CompanyJobRecurrenceInput["type"] = "weekly", term: CompanyJobRecurrenceInput["term"] = "3_months"): CompanyJobRecurrenceInput => ({ type, term, startDate: "2026-12-01",
  ...(type !== "monthly_date" ? { dayOfWeek: 2 } : {}), ...(type === "monthly_ordinal" ? { ordinal: -1 as const } : {}) });
const base = { customerId: 7, priceBookServiceId: 31, scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T16:00:00.000Z", operationKey: "isolated-operation-001", notifyCustomer: false };
const quote = { lines: [{ priceBookItemId: 31, name: "Service", quantity: 1, unitPrice: 125, lineTotal: 125, durationMinutes: 60, taxable: false, vehiclePriceKey: null }],
  subtotal: 125, discount: 0, discountKind: null, discountCode: null, taxableSubtotal: 0, taxRateBps: 0, tax: 0, total: 125, totalDurationMinutes: 60, recurrence: null,
  persistence: { taxStored: true as const, note: "Isolated authoritative fixture" } };
let actorId = 60000;
function actor(): JobSyncNativeSession { return { token: `offline-${++actorId}`, portal: "company", user: { id: actorId, role: "owner", name: "Owner", email: null },
  company: { id: 9, name: "Company", slug: "unit", logoUrl: null, primaryColor: null, accentColor: null } }; }
function store() {
  const data = new Map<string, string>();
  const adapter = { getItemAsync: vi.fn(async (key: string) => data.get(key) ?? null), setItemAsync: vi.fn(async (key: string, value: string) => { data.set(key, value); }), deleteItemAsync: vi.fn(async (key: string) => { data.delete(key); }) };
  return { api: createCompanyCreationStore({ platform: "ios", secureStore: adapter }), adapter, data };
}
function record(signed: JobSyncNativeSession, recurrence?: CompanyJobRecurrenceInput): CompanyCreationRecord {
  const { operationKey, ...payload } = base;
  return { version: 1, companyId: 9, userId: signed.user.id, operationKey, payload: { ...payload, ...(recurrence ? { recurrence } : {}) },
    timezone: "America/Chicago", phase: "prepared", jobId: null, createdAt: "2026-11-17T12:00:00.000Z", updatedAt: "2026-11-17T12:00:00.000Z" };
}
function series(signed: JobSyncNativeSession, recurrence = rule(), operationKey = base.operationKey): CompanyJobSavedSeries {
  return { companyId: 9, customerId: 7, jobId: 84, operationKey, recurrence, ruleId: 55, term: recurrence.term,
    neverEnds: recurrence.term === "never_ends", timezone: "America/Chicago", count: 2, occurrenceJobIds: [84, 85],
    occurrences: [{ id: 84, occurrenceNumber: 0, scheduledStartAt: base.scheduledStartAt, scheduledEndAt: base.scheduledEndAt },
      { id: 85, occurrenceNumber: 1, scheduledStartAt: "2026-12-08T15:00:00.000Z", scheduledEndAt: "2026-12-08T16:00:00.000Z" }] };
}
function harness(options: { durable?: boolean; signed?: JobSyncNativeSession; storage?: ReturnType<typeof store> } = {}) {
  const signed = options.signed ?? actor(), storage = options.storage ?? store();
  let active = true;
  const canonical: JobSyncCompanyJobDetail = { id: 84, companyId: 9, customerId: 7, assignedUserId: null, title: "Service", serviceName: "Service", status: "scheduled",
    scheduledStartAt: base.scheduledStartAt, scheduledEndAt: base.scheduledEndAt, updatedAt: null, amount: 125,
    addressLine1: null, city: null, customerName: "Customer", assignedName: null, photos: [], persistedPhotoIds: [], enRouteAt: null, onSiteAt: null, completedAt: null };
  const saved = series(signed);
  const api = { session: vi.fn(async () => signed), settings: vi.fn(async () => ({ id: 9, name: "Company", timezone: "America/Chicago" })),
    customer: vi.fn(async () => ({ id: 7, companyId: 9 })), priceBook: vi.fn(async () => [{ serviceId: "31", name: "Service", basePrice: 125, vehiclePrices: {}, features: [], description: "", emoji: "", imageUrl: null, sortOrder: 0, serviceTypeId: null }]),
    quote: vi.fn(async () => quote), create: vi.fn<CompanyCreateJobTransport["create"]>(async () => ({ ...canonical, companyId: 9, priceBookServiceId: 31, operation: { key: base.operationKey, state: "saved" as const, replayed: false }, recurrence: saved })),
    detail: vi.fn(async () => canonical), jobs: vi.fn(async () => []), operation: vi.fn(async (_token: string, _company: number, key: string) => ({ key, state: "saved" as const, jobId: 84, rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null })),
    ...(options.durable ? { series: vi.fn(async () => saved) } : {}) } satisfies CompanyCreateJobTransport;
  const onCreated = vi.fn(async () => true), onState = vi.fn();
  const controller = createCompanyJobController({ session: signed, transport: api, store: storage.api, isCurrent: () => active, verifyAssignment: async () => true,
    onCreated, onState, newOperationKey: () => base.operationKey });
  return { signed, storage, api, saved, canonical, onCreated, onState, controller, stale: () => { active = false; } };
}
describe("recurrence normalization and first Company date", () => {
  it.each(["weekly", "biweekly", "monthly_date", "monthly_ordinal"] as const)("copies and freezes exact %s intent", type => {
    const input = rule(type); const snapshot = normalizeCompanyJobRecurrence(input); input.term = "never_ends";
    expect(snapshot.term).toBe("3_months"); expect(Object.isFrozen(snapshot)).toBe(true);
  });
  it.each(["1_month", "3_months", "6_months", "1_year", "never_ends"] as const)("accepts term %s", term => { expect(normalizeCompanyJobRecurrence(rule("weekly", term)).term).toBe(term); });
  it.each([{}, { ...rule(), startDate: "2026-02-30" }, { ...rule(), term: "forever" }, { ...rule(), dayOfWeek: 7 }, { ...rule(), extra: true },
    { ...rule("monthly_date"), dayOfWeek: 2 }, { ...rule(), ordinal: -1 }, { ...rule("monthly_ordinal"), ordinal: 5 }])("rejects malformed intent %# without silently dropping it", input => { expect(() => normalizeCompanyJobRecurrence(input)).toThrow(); });
  it("matches exact backend first-date semantics for weekly/monthly ordinals and month rollover", () => {
    const names = ["parseDateOnly", "formatDateOnly", "dateAt", "daysInMonth", "addDays", "addMonthsClamped", "ordinalWeekdayOfMonth", "firstOrdinalOccurrenceOnOrAfter", "firstWeeklyOccurrenceOnOrAfter", "buildStoredRecurrenceRule", "TERM_MONTHS"];
    const exact = evaluate<{ buildStoredRecurrenceRule: (input: unknown, date: string) => { firstDate: string } }>(declarations(readBackend("shared/jobRecurrence.ts"), names), ["buildStoredRecurrenceRule"], {});
    for (const type of ["weekly", "biweekly", "monthly_date", "monthly_ordinal"] as const) for (const startDate of ["2026-12-01", "2026-12-31", "2027-01-31", "2028-02-29"]) {
      for (const ordinal of [1, 2, 3, 4, -1] as const) {
        const recurrence = { ...rule(type), startDate, ...(type === "monthly_ordinal" ? { ordinal } : {}) };
        expect(companyJobRecurrenceFirstDate(recurrence)).toBe(exact.buildStoredRecurrenceRule(recurrence, startDate).firstDate);
      }
    }
  });
});
describe("protected backwards-compatible recurrence intent and controller recovery", () => {
  it("retains old v1 omission and new false notify intent, deeply immutable recurrence and rule identity", async () => {
    const signed = actor(), storage = store(), previous = record(signed);
    expect(await storage.api.reserve(previous)).toBe(true); expect((await storage.api.read(9, signed.user.id))!.payload).not.toHaveProperty("recurrence");
    await storage.api.remove(9, signed.user.id, previous.operationKey);
    const next = record(signed, rule()); expect(await storage.api.reserve(next)).toBe(true);
    const saved = (await storage.api.read(9, signed.user.id))!; expect(saved.payload.notifyCustomer).toBe(false); expect(Object.isFrozen(saved.payload.recurrence)).toBe(true);
    await expect(storage.api.update({ ...saved, payload: { ...saved.payload, recurrence: rule("biweekly") } })).rejects.toThrow(/storage could not be verified/);
    await expect(storage.api.update({ ...saved, payload: { ...saved.payload, recurrence: undefined } })).rejects.toThrow();
    const settled = { ...saved, phase: "saved" as const, jobId: 84, recurrenceRuleId: 55 };
    expect(await storage.api.update(settled)).toBe(true);
    await expect(storage.api.update({ ...settled, recurrenceRuleId: 56 })).rejects.toThrow();
  });
  it("blocks target recurrence before any storage reservation or POST, not a quote-only plan", async () => {
    const h = harness();
    expect(await h.controller.submit({ customerId: 7, serviceId: "31", date: "2026-12-01", startHour: 9, endHour: 10, recurrence: rule() })).toBe(false);
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.storage.adapter.setItemAsync).not.toHaveBeenCalled(); expect(h.api.quote).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("future verified transport: one captured POST, real saved-series GET, explicit calendar success then removal", async () => {
    const h = harness({ durable: true }); const recurrence = rule();
    expect(await h.controller.submit({ customerId: 7, serviceId: "31", date: "2026-12-01", startHour: 9, endHour: 10, notifyCustomer: false, recurrence })).toBe(true);
    expect(h.api.create).toHaveBeenCalledOnce(); expect(h.api.create.mock.calls[0]).toHaveLength(3);
    expect(h.api.series).toHaveBeenCalledWith(h.signed.token, 9, 84, base.operationKey);
    expect(h.onCreated).toHaveBeenCalledWith(h.canonical, "America/Chicago", expect.objectContaining({ ruleId: 55, recurrence: rule(), occurrenceJobIds: [84, 85] }));
    expect(await h.storage.api.read(9, h.signed.user.id)).toBeNull(); h.controller.detach();
  });
  it("restart with saved operation but no durable series support retains request/false intent, no POST/callback", async () => {
    const h = harness(); await h.storage.api.reserve(record(h.signed, rule()));
    expect(await h.controller.restore()).toBe(false); expect(h.controller.getState().phase).toBe("saved");
    expect((await h.storage.api.read(9, h.signed.user.id))!.payload.notifyCustomer).toBe(false);
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.onCreated).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("restart GET-only recovery verifies complete series before canonical calendar and durable removal", async () => {
    const h = harness({ durable: true }); await h.storage.api.reserve(record(h.signed, rule()));
    expect(await h.controller.restore()).toBe(true); expect(h.api.create).not.toHaveBeenCalled(); expect(h.api.series).toHaveBeenCalledOnce();
    expect(h.onCreated).toHaveBeenCalledOnce(); expect(await h.storage.api.read(9, h.signed.user.id)).toBeNull(); h.controller.detach();
  });
  it("captures nested recurrence before the first await and prevents caller mutation during signing", async () => {
    const h = harness({ durable: true }); let release!: (session: JobSyncNativeSession) => void;
    h.api.session.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const recurrence = rule(); const pending = h.controller.submit({ customerId: 7, serviceId: "31", date: "2026-12-01", startHour: 9, endHour: 10, recurrence });
    recurrence.term = "never_ends"; release(h.signed); expect(await pending).toBe(true);
    const request = h.api.create.mock.calls[0][2]; expect(request.recurrence!.term).toBe("3_months");
    expect(Object.isFrozen(request.recurrence)).toBe(true); h.controller.detach();
  });
  it("missing CREATE series receipt still retains known Job identity and never announces recurrence success", async () => {
    const h = harness({ durable: true }); h.api.create.mockImplementationOnce(async () => ({ ...h.canonical, companyId: 9, priceBookServiceId: 31,
      operation: { key: base.operationKey, state: "saved", replayed: false }, recurrence: null }));
    expect(await h.controller.submit({ customerId: 7, serviceId: "31", date: "2026-12-01", startHour: 9, endHour: 10, recurrence: rule() })).toBe(false);
    expect((await h.storage.api.read(9, h.signed.user.id))!.jobId).toBe(84); expect(h.controller.getState().phase).toBe("saved");
    expect(h.onCreated).not.toHaveBeenCalled(); expect(h.api.create).toHaveBeenCalledOnce(); h.controller.detach();
  });
  it("a late durable-series read after sheet/actor detachment cannot refresh, publish or remove intent", async () => {
    const h = harness({ durable: true }); await h.storage.api.reserve(record(h.signed, rule()));
    let release!: (value: CompanyJobSavedSeries) => void;
    h.api.series!.mockImplementationOnce(async () => { h.stale(); return new Promise(resolve => { release = resolve; }); });
    const pending = h.controller.restore(); for (let index = 0; index < 100 && !release; index++) await Promise.resolve();
    release(h.saved); expect(await pending).toBe(false); expect(h.onCreated).not.toHaveBeenCalled();
    expect(await h.storage.api.read(9, h.signed.user.id)).not.toBeNull(); expect(h.api.create).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("series readback mismatch never clears a known saved request or calls calendar", async () => {
    const h = harness({ durable: true }); await h.storage.api.reserve(record(h.signed, rule())); h.saved.operationKey = "different-operation";
    expect(await h.controller.restore()).toBe(false); expect(h.onCreated).not.toHaveBeenCalled(); expect(h.api.create).not.toHaveBeenCalled();
    expect((await h.storage.api.read(9, h.signed.user.id))!.jobId).toBe(84); h.controller.detach();
  });
  it("calendar failure retains verified series + immutable request, then GET-only recovery succeeds", async () => {
    const h = harness({ durable: true }); await h.storage.api.reserve(record(h.signed, rule())); h.onCreated.mockResolvedValueOnce(false);
    expect(await h.controller.restore()).toBe(false); expect((await h.storage.api.read(9, h.signed.user.id))!.recurrenceRuleId).toBe(55);
    expect(await h.controller.reconcile()).toBe(true); expect(h.api.create).not.toHaveBeenCalled(); expect(h.api.series).toHaveBeenCalledTimes(2); h.controller.detach();
  });
  it.each(["companyId", "customerId", "jobId", "operationKey", "recurrence", "occurrenceJobIds", "occurrences", "term", "timezone"])("rejects malformed or mismatched series %s", field => {
    const signed = actor(), saved = series(signed);
    const values: Record<string, unknown> = { companyId: 10, customerId: 8, jobId: 85, operationKey: "other-key", recurrence: rule("biweekly"), occurrenceJobIds: [84, 84], occurrences: [], term: "never_ends", timezone: "invalid/timezone" };
    expect(() => verifyCompanyJobSavedSeries({ ...saved, [field]: values[field] }, { companyId: 9, customerId: 7, jobId: 84, operationKey: base.operationKey, recurrence: rule(), scheduledStartAt: base.scheduledStartAt })).toThrow();
  });
  it("CREATE echo cannot serve as durable GET evidence and no null receipt is accepted", () => {
    expect(() => normalizeCompanyJobRecurrenceReceipt(null, rule(), 84)).toThrow();
    const { companyId: _companyId, customerId: _customerId, operationKey: _key, jobId: _jobId, recurrence: _recurrence, ...echo } = series(actor());
    expect(() => verifyCompanyJobSavedSeries(echo, { companyId: 9, customerId: 7, jobId: 84, operationKey: base.operationKey, recurrence: rule(), scheduledStartAt: base.scheduledStartAt })).toThrow();
  });
});

});
