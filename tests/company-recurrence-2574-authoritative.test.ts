import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCompanyJobRecurrence, companyJobRecurrenceFirstDate, normalizeCompanyJobRecurrenceReceipt,
  verifyCompanyJobSavedSeries, type CompanyJobRecurrenceInput, type CompanyJobSavedSeries } from "../lib/company-job-recurrence";
import { createCompanyCreationStore, type CompanyCreationRecord } from "../lib/company-job-creation-storage";
import { createCompanyJobController, type CompanyCreateJobTransport } from "../lib/company-create-job";
import type { JobSyncCompanyJobDetail, JobSyncNativeSession } from "../lib/jobsync-mobile-api";

vi.mock("expo-crypto", () => ({ randomUUID, digestStringAsync: async (_algorithm: string, text: string) => createHash("sha256").update(text).digest("hex"), CryptoDigestAlgorithm: { SHA256: "SHA-256" } }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only", getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
const backend = "/home/ubuntu/hsc-authoritative-mobile-reconciliation-20261117/backend-source-2574fb8d";
const read = (file: string) => readFileSync(path.join(backend, file), "utf8");
function declarations(source: string, names: string[]) {
  const file = ts.createSourceFile("isolated.ts", source, ts.ScriptTarget.Latest, true);
  const found = new Map<string, string>();
  for (const node of file.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) found.set(node.name.text, node.getText(file));
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) found.set(declaration.name.text, `const ${declaration.getText(file)};`);
    }
  }
  return names.map(name => { if (!found.has(name)) throw new Error(`Missing exact declaration ${name}`); return found.get(name)!; }).join("\n");
}
function evaluate<T>(source: string, names: string[], dependencies: Record<string, unknown>): T {
  const module = { exports: {} };
  const deny = () => { throw new Error("Live network/import/provider forbidden"); };
  const js = ts.transpileModule(`${source}\nmodule.exports = {${names.join(",")}};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new vm.Script(js).runInNewContext({ module, exports: module.exports, require: deny, fetch: deny,
    process: { env: {} }, Object, Array, Reflect, Date, Error, ...dependencies }, { timeout: 2000 });
  return module.exports as T;
}
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
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden"))); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("2574 exact backend evidence — schema acceptance is not durable series creation", () => {
  const schemas = evaluate<{ mobileJobCreateSchema: z.ZodType; mobileJobQuoteSchema: z.ZodType }>(declarations(read("server/mobileOperations.ts"), ["mobileJobCreateSchema", "mobileJobQuoteSchema"]), ["mobileJobCreateSchema", "mobileJobQuoteSchema"], { z });
  it.each(["weekly", "biweekly", "monthly_date", "monthly_ordinal"] as const)("accepts %s in exact CREATE and quote schemas", type => {
    const recurrence = rule(type);
    expect(schemas.mobileJobCreateSchema.parse({ ...base, recurrence })).toMatchObject({ recurrence, notifyCustomer: false });
    expect(schemas.mobileJobQuoteSchema.parse({ lineItems: [{ priceBookItemId: 31, quantity: 1 }], recurrence })).toMatchObject({ recurrence });
  });
  it("executes actual target create service and demonstrates ignored recurrence, one insert and no rule", async () => {
    class DomainError extends Error { constructor(public code: string, message?: string) { super(message ?? code); } }
    const sql = vi.fn(async (text: string) => {
      if (text.startsWith("SELECT id FROM fs_customers")) return [[{ id: 7 }]];
      return [{ insertId: 84, affectedRows: 1 }];
    });
    const db = { execute: sql };
    const notification = vi.fn();
    const service = evaluate<{ createJobFromPriceBook: (db: unknown, company: unknown, input: unknown) => Promise<{ id: number }> }>(declarations(read("server/jobService.ts"), ["createJobFromPriceBook"]), ["createJobFromPriceBook"], {
      DomainError, requireManager: () => undefined, normalizeJobCreationOperationKey: (value: unknown) => value,
      jobCreationPayloadFingerprint: () => "isolated-fingerprint", operationPayloadForJobCreation: (input: unknown) => input,
      getJobCreationOperation: async () => null, withTransaction: async (_db: unknown, work: (db: unknown) => unknown) => work(db),
      quoteMobileJob: async () => quote, generatePublicToken: () => "isolated-public-token", insertJobEvent: async () => undefined,
      attemptBookingConfirmationAfterCommit: notification,
    });
    const created = await service.createJobFromPriceBook(db, { companyId: 9, userId: 8, role: "owner", timezone: "America/Chicago" }, {
      ...base, lineItems: [{ priceBookItemId: 31, quantity: 1 }], recurrence: { cadence: "weekly", weekday: 2, startsOn: "2026-12-01", endsOn: "2027-03-01", startTime: "09:00", durationMinutes: 60 },
    });
    expect(created.id).toBe(84);
    expect(sql.mock.calls.filter(([text]) => text.startsWith("INSERT INTO fs_jobs "))).toHaveLength(1);
    expect(sql.mock.calls.some(([text]) => text.includes("fs_service_recurrence_rules") || text.includes("recurrence_rule_id"))).toBe(false);
    expect(notification).not.toHaveBeenCalled();
  });
  it("exact operation/detail routes expose no complete durable-series GET readback", () => {
    const source = read("server/mobileOperations.ts");
    const detail = declarations(source, ["jobDetail"]), operation = declarations(source, ["jobCreationOperation"]);
    expect(detail).not.toContain("occurrenceRows"); expect(detail).not.toContain("recurrence:"); expect(operation).not.toContain("recurrence");
    expect(declarations(source, ["registerMobileOperationalRoutes"])).not.toMatch(/app\.get\([^\n]*(?:series|recurrence)/);
    expect(JSON.parse(readFileSync("/home/ubuntu/hsc-authoritative-mobile-reconciliation-20261117/backend-revision.json", "utf8")).sha).toBe("2574fb8df702cb57bdb2e9317aba7b7fe7fe5e77");
  });
});
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
    const exact = evaluate<{ buildStoredRecurrenceRule: (input: unknown, date: string) => { firstDate: string } }>(declarations(read("shared/jobRecurrence.ts"), names), ["buildStoredRecurrenceRule"], {});
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
