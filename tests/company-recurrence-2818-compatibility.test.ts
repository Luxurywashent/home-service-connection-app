import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { normalizeCompanyJobDiscount, normalizeCompanyJobLineItems } from "../lib/company-job-pricing";

/**
 * Exact unpublished 2818bb72 source execution. AST selection preserves original
 * function bodies but excludes imports/bootstrap. All SQL/auth/providers below
 * are isolated fakes. Boundary passes reproduce blockers, NOT series acceptance.
 * The final describe retains positive requirements as real failing tests.
 */
const root = "/home/ubuntu/hsc-mobile-backend-compatibility-2818bb72-20261117";
const backendRoot = path.join(root, "backend-source-2818bb72");
const readBackend = (file: string) => readFileSync(path.join(backendRoot, file), "utf8");
type Row = Record<string, unknown>;
type Sql = { execute: (sql: string, params?: unknown[]) => Promise<[Row[], unknown?]>; getConnection?: () => Promise<Sql & { beginTransaction: () => Promise<void>; commit: () => Promise<void>; rollback: () => Promise<void>; release: () => void }> };
type Company = { companyId: number; userId: number; role: string; permissions: { canManageJobs: boolean }; timezone: string; name: string; memberId: string };
type Recurrence = { type: string; term: string; dayOfWeek?: number; ordinal?: number; startDate: string };
type Slot = { date: string; scheduledStartAt: string; scheduledEndAt: string };

function declarations(source: string, names: readonly string[]) {
  const file = ts.createSourceFile("isolated-contract.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const selected = new Map<string, string>();
  for (const node of file.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      selected.set(node.name.text, node.getText(file).replace(/^export\s+/, ""));
    }
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) selected.set(declaration.name.text, `const ${declaration.getText(file)};`);
    }
    if (ts.isClassDeclaration(node) && node.name && names.includes(node.name.text)) selected.set(node.name.text, node.getText(file).replace(/^export\s+/, ""));
  }
  return names.map(name => {
    const value = selected.get(name);
    if (!value) throw new Error(`Exact source declaration missing: ${name}`);
    return value;
  }).join("\n");
}
function evaluate<T>(source: string, names: readonly string[], dependencies: Row = {}): T {
  const module = { exports: {} };
  const denied = () => { throw new Error("Forbidden backend import, real network or provider"); };
  const context = vm.createContext({ module, exports: module.exports, require: denied, fetch: denied,
    process: { env: Object.freeze({}) }, Date, Error, Object, Array, Reflect, Map, Set, Intl, setTimeout,
    ...dependencies });
  const js = ts.transpileModule(`${source}\nmodule.exports = { ${names.join(",")} };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new vm.Script(js).runInContext(context, { timeout: 2000 });
  return module.exports as T;
}
function fromBackend<T>(file: string, names: readonly string[], dependencies: Row = {}) {
  return evaluate<T>(declarations(readBackend(file), names), names, dependencies);
}
const readMobile = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8");
const mobileApiNames = ["positiveJobSyncId", "companyJobCreationOperationKey", "normalizeCompanyJobNewCustomer", "createJobSyncCompanyJobPayload"];
const mobileApi = evaluate<{
  createJobSyncCompanyJobPayload: (input: Row) => Row;
  normalizeCompanyJobNewCustomer: (input: unknown) => Row;
}>(declarations(readMobile("lib/jobsync-mobile-api.ts"), mobileApiNames), mobileApiNames,
  { normalizeCompanyJobLineItems, normalizeCompanyJobDiscount });
const mobileStorage = evaluate<{ payloadCopy: (input: Row) => Row }>(
  declarations(readMobile("lib/company-job-creation-storage.ts"), ["corrupt", "positive", "object", "shape", "instant", "textLimits", "canonicalNested", "payloadCopy"]),
  ["payloadCopy"], { normalizeCompanyJobLineItems, normalizeCompanyJobDiscount, normalizeCompanyJobNewCustomer: mobileApi.normalizeCompanyJobNewCustomer });
const errors = fromBackend<{
  DomainError: new (code: string, message: string) => Error & { code: string };
  domainHttpStatus: (error: unknown) => number;
  domainMobileCode: (error: unknown) => string;
}>("server/domainErrors.ts", ["DomainError", "domainHttpStatus", "domainMobileCode"]);
const company = fromBackend<{
  createCompanyContext: (input: Row) => Company;
  companyContextFromMobile: (claims: Row, companyId: number, timezone?: string) => Company;
  requireManager: (company: Company) => void;
  technicianScopeSql: (company: Company, options?: Row) => Row;
}>("server/companyContext.ts", ["DEFAULT_COMPANY_TIMEZONE", "isCompanyRole", "isManagerRole", "permissionsForRole", "normalizeCompanyTimezone", "createCompanyContext", "companyContextFromMobile", "requireManager", "technicianScopeSql"], {
  ...errors, isSupportedCompanyTimezone: (value: string) => ["America/Chicago", "Australia/Lord_Howe"].includes(value),
});
const authority = (role = "owner", companyId = 9) => company.createCompanyContext({ companyId, userId: 8, role, timezone: "America/Chicago" });
const recovery = fromBackend<{
  jobCreationPayloadFingerprint: (input: Row) => string;
  operationPayloadForJobCreation: (input: Row) => Row;
  getJobCreationOperation: (db: Sql, company: Company, key: string) => Promise<Row | null>;
  operationReplayResult: (operation: Row, fingerprint: string) => Row;
  normalizeJobCreationOperationKey: (input: unknown) => string | null;
}>("server/jobCreationRecovery.ts", ["stableValue", "jobCreationPayloadFingerprint", "normalizeJobCreationOperationKey", "operationPayloadForJobCreation", "operationFromRow", "getJobCreationOperation", "assertOperationPayloadMatches", "operationReplayResult", "waitForJobCreationOperation"], { ...errors, createHash });
const price = fromBackend<Row>("server/priceBookPricing.ts", ["PRICE_BOOK_VEHICLE_KEYS", "COLUMN_BY_KEY", "toDollars", "isPriceBookVehicleKey", "normalizePriceBookVehicleKey", "normalizePriceBookSelectionKey", "matchingSelectionKeys", "dollarsFromColumn", "resolvePriceBookUnitPriceCents", "priceBookItemRequiresVehiclePriceKey"], {
  ...errors, parsePriceBookPricingConfiguration: () => ({ options: [] }),
});
const quote = fromBackend<{ quoteMobileJob: (db: Sql, companyId: number, input: Row) => Promise<Row> }>("server/mobileJobQuote.ts", ["money", "normalizeDiscount", "normalizeRecurrence", "quoteMobileJob", "recurrenceSelectionFromMobile"], { ...errors, ...price });
const dates = fromBackend<{
  buildStoredRecurrenceRule: (selection: Row, requestedStartDate: string) => { rule: Row; firstDate: string };
  generateRecurringDates: (first: string, rule: Row) => string[];
  recurrenceOccurrenceKey: (ruleId: number, ordinal: number) => string;
  recurrenceLabelFromParts: (input: Row) => string | null;
}>("shared/jobRecurrence.ts", ["NEVER_ENDING_RECURRENCE_JOB_COUNT", "TERM_MONTHS", "WEEKDAY_LABELS", "ORDINAL_LABELS", "parseDateOnly", "formatDateOnly", "dateAt", "daysInMonth", "addDays", "addMonthsClamped", "ordinalWeekdayOfMonth", "firstOrdinalOccurrenceOnOrAfter", "firstWeeklyOccurrenceOnOrAfter", "buildStoredRecurrenceRule", "nextRecurringDate", "generateRecurringDates", "recurrenceOccurrenceKey", "recurrenceLabelFromParts"]);
const wallTime = fromBackend<Row>("shared/companyScheduleTime.ts", ["partsForTimezone", "timezoneOffsetMilliseconds", "companyLocalWallTimeToIso"]);
const slots = fromBackend<{ recurringJobSlots: (rule: Row, timezone: string) => Slot[] }>("server/recurringJobSchedule.ts", ["recurringJobSlots"], { ...dates, ...wallTime });
const projection = fromBackend<{ projectMobileCompanyJob: (job: Row) => Row }>("server/mobileCompanyJobDto.ts", ["asNumber", "asNullableInt", "asIso", "firstNonEmptyString", "projectMobileCompanyJob"]);

const lines = [{ priceBookItemId: 71, quantity: 2 }, { priceBookItemId: 72, quantity: 1 }];
const base: Row = { customerId: 41, lineItems: lines, scheduledStartAt: "2026-12-01T15:00:00.000Z", operationKey: "mock-recurrence-2818-001", notifyCustomer: false };
const types = ["weekly", "biweekly", "monthly_date", "monthly_ordinal"];
const terms = ["1_month", "3_months", "6_months", "1_year", "never_ends"];
const rule = (type = "weekly", term = "3_months"): Recurrence => ({ type, term, startDate: "2026-12-01", ...(type !== "monthly_date" ? { dayOfWeek: 2 } : {}), ...(type === "monthly_ordinal" ? { ordinal: -1 } : {}) });
const matrix = types.flatMap(type => terms.map(term => rule(type, term)));

function fixture(options: { failLine?: number; availabilityConflictAt?: number; missingCustomer?: boolean; missingService?: boolean; foreignMember?: boolean } = {}) {
  let state = { jobs: [] as Row[], rules: [] as Row[], lineItems: [] as Row[], customers: [] as Row[], operations: [] as Row[], assignments: [] as Row[], events: [] as Row[] };
  let snapshot = structuredClone(state);
  let lineCount = 0;
  const queries: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (sql: string, params: unknown[] = []): Promise<[Row[], unknown?]> => {
    queries.push({ sql, params });
    if (sql.includes("FROM fs_job_creation_operations")) return [state.operations.filter(row => row.company_id === params[0] && row.operation_key === params[1])];
    if (sql.startsWith("INSERT INTO fs_job_creation_operations")) {
      const existing = state.operations.find(row => row.company_id === params[0] && row.operation_key === params[1]);
      if (existing && !sql.includes("ON DUPLICATE")) throw Object.assign(new Error("duplicate operation"), { code: "ER_DUP_ENTRY" });
      if (!existing) state.operations.push({ company_id: params[0], operation_key: params[1], payload_fingerprint: params[2], state: sql.includes("'rejected'") ? "rejected" : "pending", job_id: null, rejection_code: sql.includes("'rejected'") ? params[3] : null, rejection_message: sql.includes("'rejected'") ? params[4] : null, created_at: null, updated_at: null });
      return [[]];
    }
    if (sql.startsWith("UPDATE fs_job_creation_operations")) {
      const row = state.operations.find(row => row.company_id === params[1] && row.operation_key === params[2]);
      if (!row) throw new Error("Missing fake operation");
      Object.assign(row, { state: "saved", job_id: params[0] }); return [[]];
    }
    if (sql.includes("FROM fs_customers WHERE")) return [params[0] === 41 && params[1] === 9 && !options.missingCustomer ? [{ id: 41 }] : []];
    if (sql.includes("FROM fs_price_book WHERE company_id")) return [params[0] === 9 && !options.missingService ? [
      { id: 71, name: "First", base_price: 100, default_duration_minutes: 60, is_taxable: 1 },
      { id: 72, name: "Second", base_price: 50, default_duration_minutes: 30, is_taxable: 0 },
    ].filter(row => params.slice(1).includes(row.id)) : []];
    if (sql.includes("FROM fs_price_book WHERE id")) return [params[1] === 9 && !options.missingService ? [{ id: params[0] }] : []];
    if (sql.includes("FROM fs_company_settings")) return [[{ default_tax_rate_bps: 500 }]];
    if (sql.startsWith("INSERT INTO fs_jobs")) {
      const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map(value => value.trim());
      const row: Row = { id: state.jobs.length + 501 };
      let offset = 0;
      for (const column of columns) row[column] = column === "status" ? "scheduled" : params[offset++];
      state.jobs.push(row); return [{ insertId: row.id } as unknown as Row[]];
    }
    if (sql.startsWith("INSERT INTO fs_service_recurrence_rules")) {
      const row = { id: 301, company_id: params[0], job_id: null, cadence: params[1], weekday: params[2], ordinal_week: params[3], day_of_month: params[4], starts_on: params[5], ends_on: params[6], start_time: params[7], duration_minutes: params[8] };
      state.rules.push(row); return [{ insertId: 301 } as unknown as Row[]];
    }
    if (sql.startsWith("UPDATE fs_service_recurrence_rules")) { state.rules[0].job_id = params[0] as null; return [[]]; }
    if (sql.startsWith("INSERT INTO fs_job_line_items")) {
      lineCount += 1; if (lineCount === options.failLine) throw new Error("fake late service-line failure");
      state.lineItems.push({ company_id: params[0], job_id: params[1], price_book_item_id: params[2], name: params[3], quantity: params[4], unit_price: params[5], total_price: params[6], sort_order: params[7] }); return [[]];
    }
    if (sql.startsWith("INSERT INTO fs_job_events")) { state.events.push({ company_id: params[0], job_id: params[1] }); return [[]]; }
    if (sql.startsWith("INSERT INTO fs_job_assignments")) { state.assignments.push({ company_id: params[0], job_id: params[1], user_id: params[2] }); return [[]]; }
    if (sql.includes("FROM fs_jobs j JOIN fs_customers")) {
      return [state.jobs.filter(row => row.id === params[0] && row.company_id === params[1]).map(row => {
        const recurrence = state.rules.find(rule => rule.id === row.recurrence_rule_id && rule.company_id === row.company_id);
        return { ...row, customer_name: "Casey Example", recurrence_cadence: recurrence?.cadence, recurrence_weekday: recurrence?.weekday, recurrence_ordinal_week: recurrence?.ordinal_week, recurrence_day_of_month: recurrence?.day_of_month };
      })];
    }
    if (sql.startsWith("SELECT price_book_item_id")) return [[{ price_book_item_id: 71 }]];
    if (sql.includes("FROM fs_job_line_items")) return [state.lineItems.filter(row => row.job_id === params[0] && row.company_id === params[1])];
    if (sql.startsWith("SELECT")) return [[]];
    throw new Error(`Unhandled fake SQL (no real fallback): ${sql}`);
  });
  const connection = { execute, beginTransaction: vi.fn(async () => { snapshot = structuredClone(state); }), commit: vi.fn(async () => {}), rollback: vi.fn(async () => { state = structuredClone(snapshot); }), release: vi.fn() };
  const db: Sql = { execute, getConnection: async () => connection };
  const booking = vi.fn(async () => ({ status: "unknown" }));
  const availability = vi.fn(async () => { if (availability.mock.calls.length === options.availabilityConflictAt) throw new errors.DomainError("CONFLICT", "Fake Team Member unavailable"); });
  const customer = vi.fn(async () => { state.customers.push({ id: 42, company_id: 9 }); return { id: 42 }; });
  const member = vi.fn(async (_db: Sql, context: Company, id: number) => { if (context.companyId !== 9 || id !== 8 || options.foreignMember) throw new errors.DomainError("NOT_FOUND", "Fake Team Member not in Company"); });
  const service = fromBackend<{
    createJobFromPriceBook: (db: Sql, context: Company, input: Row) => Promise<Row>;
    createJob: (db: Sql, context: Company, input: Row) => Promise<Row>;
    getJob: (db: Sql, context: Company, id: number) => Promise<Row>;
    getJobDetail: (db: Sql, context: Company, id: number) => Promise<Row>;
  }>("server/jobService.ts", ["toNumber", "iso", "MAX_JOB_FINANCIAL_AMOUNT", "roundJobFinancialAmount", "storageSafeJobFinancialAmount", "storageSafeJobFinancialTotals", "withTransaction", "insertJobEvent", "isMysqlDuplicate", "createJobFromPriceBook", "createJob", "getJob", "getJobDetail"], {
    ...errors, ...recovery, ...price, ...quote, ...dates, ...slots,
    requireManager: company.requireManager, technicianScopeSql: company.technicianScopeSql,
    createCustomer: customer, generatePublicToken: () => "fake-public-token", attemptBookingConfirmationAfterCommit: booking,
    ensureCompanyTeamPositions: vi.fn(async () => {}), lockCompanyUserForSchedule: vi.fn(async () => {}), requireCalendarEligibleMember: member, assertStaffAvailableForScheduledStart: availability, createAlert: vi.fn(async () => {}),
    confirmationProjection: () => ({ confirmationStatus: "unconfirmed", customerConfirmedAt: null }),
    latestBookingCommunicationOutcome: vi.fn(async () => ({ status: "unknown" })),
    getJobPaymentBalance: async (_db: Sql, _context: Company, id: number) => { const row = state.jobs.find(row => row.id === id); return { jobTotal: row?.amount ?? 0, paid: 0, refundTotal: 0, appliedEstimateCredit: 0, balance: row?.amount ?? 0, paymentStatus: "unpaid" }; },
    firstLifecycleTimestamps: () => ({}), effectiveLifecycleTimestamps: (value: unknown) => value, lifecycleTimingOverrideForJob: async () => null, formatServiceName: (value: unknown) => value,
  });
  const auth = vi.fn(async (req: Row) => {
    if (req.denied) throw Object.assign(new Error("Fake revoked bearer"), { status: 401 });
    return { claims: { accountId: 8, role: req.role ?? "owner" }, companyId: Number(req.companyId ?? 9), db };
  });
  const routes = fromBackend<{
    mobileJobCreateSchema: z.ZodType;
    mobileJobQuoteSchema: z.ZodType;
    createJob: (request: Row, res: ReturnType<typeof response>) => Promise<unknown>;
    quoteJob: (request: Row, res: ReturnType<typeof response>) => Promise<unknown>;
    jobCreationOperation: (request: Row, res: ReturnType<typeof response>) => Promise<unknown>;
  }>("server/mobileOperations.ts", ["mobileErrorStatus", "mobileTrpcError", "operationalError", "mobileCompany", "requireManager", "mobileJobCreateSchema", "mobileJobQuoteSchema", "createJob", "quoteJob", "jobCreationOperation"], {
    z, ...errors, ...projection, requireMobileCompany: auth, companyContextFromMobile: company.companyContextFromMobile,
    managerRoles: new Set(["owner", "dispatcher"]), MobileAuthError: class extends Error { constructor(readonly status: number, message: string) { super(message); } },
    createJobFromPriceBook: service.createJobFromPriceBook, getJobDetail: service.getJobDetail, ...recovery, ...quote,
  });
  return { state: () => state, queries, db, connection, booking, availability, customer, member, service, routes, auth };
}
function response() {
  const result = { statusCode: 200, body: undefined as unknown,
    status(value: number) { result.statusCode = value; return result; }, json(value: unknown) { result.body = value; return result; } };
  return result;
}
function webInput(recurrence: Row): Row {
  return { customerId: 41, title: "First", serviceName: "First", scheduledStartAt: base.scheduledStartAt, notifyCustomer: false,
    lineItems: [{ priceBookItemId: 71, name: "First", quantity: 2, unitPrice: 100 }, { priceBookItemId: 72, name: "Second", quantity: 1, unitPrice: 50 }], recurrence };
}
const persistedRule: Row = { cadence: "weekly", weekday: 2, startsOn: "2026-12-01", endsOn: "2026-12-15", startTime: "09:00", durationMinutes: 150 };

describe("2818 exact-source provenance and quote-only support (NOT recurring acceptance)", () => {
  it("pins the downloaded unpublished revision and critical byte hashes", () => {
    expect(JSON.parse(readFileSync(path.join(root, "backend-revision.json"), "utf8")).sha).toBe("2818bb72ddf4b702e213a2a702150e2657c652c9");
    const hashes = { "server/mobileOperations.ts": "c2f6f1fd38982ece0bed8f311d80ff1dd490127201845fea83effdb357713fa8", "server/jobService.ts": "e9df7c962bbb1292e961cf0efa8a323faf11487d974d611b9d58f011e4cf0d25", "server/jobCreationRecovery.ts": "d7c2c9c5dbd34ee539b7c31a0a43e543a701b8623044d5a9f2f1e08ca19ca67f", "server/mobileJobQuote.ts": "a3ba37ae54eb4f20f324ba610125c494fd19c32c8158bf238e99648bdcdb9e2d" };
    for (const [file, hash] of Object.entries(hashes)) expect(createHash("sha256").update(readBackend(file)).digest("hex")).toBe(hash);
  });
  it.each(matrix)("actual quote handler accepts $type / $term but creates no durable series", async recurrence => {
    const fake = fixture(); const res = response();
    await fake.routes.quoteJob({ body: { lineItems: lines, recurrence } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ quote: { recurrence, subtotal: 250, tax: 10, total: 260, totalDurationMinutes: 150 } });
    expect(fake.state().jobs).toHaveLength(0); expect(fake.state().rules).toHaveLength(0); expect(fake.state().operations).toHaveLength(0);
    expect(fake.booking).not.toHaveBeenCalled();
  });
  it.each(types)("actual strict CREATE rejects $type before SQL or customer creation", async type => {
    const fake = fixture(); const res = response();
    await fake.routes.createJob({ body: { ...base, recurrence: rule(type) } }, res);
    expect(res.statusCode).toBe(400); expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST", message: expect.stringMatching(/recurrence/) } });
    expect(fake.db.execute).not.toHaveBeenCalled(); expect(fake.customer).not.toHaveBeenCalled(); expect(fake.connection.beginTransaction).not.toHaveBeenCalled(); expect(fake.booking).not.toHaveBeenCalled();
  });
  it("new-customer recurring CREATE is rejected before a customer is inserted", async () => {
    const fake = fixture(); const res = response(); const { customerId: _customerId, ...input } = base;
    await fake.routes.createJob({ body: { ...input, newCustomer: { firstName: "Casey", lastName: "Example" }, recurrence: rule() } }, res);
    expect(res.statusCode).toBe(400); expect(fake.customer).not.toHaveBeenCalled(); expect(fake.state().customers).toHaveLength(0);
  });
  it.each([rule("weekly"), rule("biweekly"), rule("monthly_ordinal")])("actual quote service requires weekday for $type", async recurrence => {
    const fake = fixture(); const res = response(); const { dayOfWeek: _weekday, ...missing } = recurrence;
    await fake.routes.quoteJob({ body: { lineItems: lines, recurrence: missing } }, res);
    expect(res.statusCode).toBe(400); expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });
  it("monthly ordinal requires ordinal; monthly date rejects weekday/ordinal", async () => {
    for (const recurrence of [{ type: "monthly_ordinal", term: "1_month", dayOfWeek: 2, startDate: "2026-12-01" }, { ...rule("monthly_date"), dayOfWeek: 2 }]) {
      const fake = fixture(); const res = response(); await fake.routes.quoteJob({ body: { lineItems: lines, recurrence } }, res); expect(res.statusCode).toBe(400);
    }
  });
});

describe("2818 single-Job CREATE/recovery controls and bounded blocker execution", () => {
  it.each(["owner", "dispatcher"])("%s retains one keyed multiservice server-priced Job and replay", async role => {
    const fake = fixture(); const first = response();
    await fake.routes.createJob({ role, body: { ...base, discount: { kind: "percent", value: 10, code: "MOCK" } } }, first);
    expect(first.statusCode).toBe(201); expect(first.body).toMatchObject({ job: { id: 501, companyId: 9, customerId: 41, priceBookServiceId: 71, amount: 234 }, operation: { key: base.operationKey, state: "saved", replayed: false } });
    const replay = response(); await fake.routes.createJob({ role, body: { ...base, discount: { kind: "percent", value: 10, code: "MOCK" } } }, replay);
    expect(replay.statusCode).toBe(200); expect(replay.body).toMatchObject({ job: { id: 501 }, operation: { replayed: true } });
    expect(fake.state().jobs).toHaveLength(1); expect(fake.state().rules).toHaveLength(0); expect(fake.state().lineItems.map(row => row.sort_order)).toEqual([0, 1]); expect(fake.booking).not.toHaveBeenCalled();
  });
  it("new-customer non-recurring control remains one customer and Job on replay", async () => {
    const fake = fixture(); const { customerId: _customerId, ...rest } = base; const body = { ...rest, newCustomer: { firstName: "Casey", lastName: "Example" } };
    const first = response(); await fake.routes.createJob({ body }, first); const replay = response(); await fake.routes.createJob({ body }, replay);
    expect(first.statusCode).toBe(201); expect(replay.statusCode).toBe(200); expect(fake.customer).toHaveBeenCalledOnce(); expect(fake.state().jobs).toHaveLength(1);
  });
  it("strict single CREATE supplies immutable default booking ON without duplicate fake dispatch", async () => {
    const fake = fixture(); const { notifyCustomer: _notify, ...body } = base; const first = response(); await fake.routes.createJob({ body }, first);
    const replay = response(); await fake.routes.createJob({ body }, replay);
    expect(first.statusCode).toBe(201); expect(replay.statusCode).toBe(200); expect(fake.booking).toHaveBeenCalledOnce();
  });
  it("technician CREATE and operation lookup are denied before storage access", async () => {
    const fake = fixture(); const create = response(); await fake.routes.createJob({ role: "technician", body: base }, create);
    const lookup = response(); await fake.routes.jobCreationOperation({ role: "technician", params: { operationKey: base.operationKey } }, lookup);
    expect(create.statusCode).toBe(403); expect(lookup.statusCode).toBe(403); expect(fake.db.execute).not.toHaveBeenCalled();
  });
  it("revoked bearer is denied by the fake live-auth boundary without storage", async () => {
    const fake = fixture(); const res = response(); await fake.routes.createJob({ denied: true, body: base }, res);
    expect(res.statusCode).toBe(401); expect(fake.db.execute).not.toHaveBeenCalled();
  });
  it("tenant/customer and Price Book isolation roll back without saved Job", async () => {
    for (const options of [{ missingCustomer: true }, { missingService: true }]) {
      const fake = fixture(options); const res = response(); await fake.routes.createJob({ body: base }, res);
      expect(res.statusCode).toBe(404); expect(fake.state().jobs).toHaveLength(0); expect(fake.connection.rollback).toHaveBeenCalledOnce(); expect(fake.booking).not.toHaveBeenCalled();
    }
  });
  it("foreign Team Member and first-slot availability conflict roll back single CREATE", async () => {
    for (const options of [{ foreignMember: true }, { availabilityConflictAt: 1 }]) {
      const fake = fixture(options); const res = response(); await fake.routes.createJob({ body: { ...base, assignedUserId: 8 } }, res);
      expect([404, 409]).toContain(res.statusCode); expect(fake.state().jobs).toHaveLength(0); expect(fake.connection.rollback).toHaveBeenCalledOnce();
    }
  });
  it("single CREATE late line failure rolls back customer, Job and operation with no provider work", async () => {
    const fake = fixture({ failLine: 2 }); const { customerId: _id, ...rest } = base; const res = response();
    await fake.routes.createJob({ body: { ...rest, newCustomer: { firstName: "Casey", lastName: "Example" } } }, res);
    expect(res.statusCode).toBe(400); expect(fake.connection.rollback).toHaveBeenCalledOnce();
    expect(fake.state().jobs).toHaveLength(0); expect(fake.state().customers).toHaveLength(0); expect(fake.state().operations).toHaveLength(0); expect(fake.booking).not.toHaveBeenCalled();
  });
  it("same operation key changed single-Job intent conflicts; original identity survives", async () => {
    const fake = fixture(); const first = response(); await fake.routes.createJob({ body: base }, first);
    const conflict = response(); await fake.routes.createJob({ body: { ...base, scheduledStartAt: "2026-12-02T15:00:00.000Z" } }, conflict);
    expect(conflict.statusCode).toBe(409); expect(fake.state().jobs).toHaveLength(1); expect(fake.state().operations[0].job_id).toBe(501);
  });
  it("lost response operation GET recovers only one Job; another tenant cannot recover it", async () => {
    const fake = fixture(); await fake.routes.createJob({ body: base }, response());
    const saved = response(); await fake.routes.jobCreationOperation({ params: { operationKey: base.operationKey } }, saved);
    expect(saved.body).toEqual({ operation: { key: base.operationKey, state: "saved", jobId: 501, rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null } });
    const foreign = response(); await fake.routes.jobCreationOperation({ companyId: 10, params: { operationKey: base.operationKey } }, foreign);
    expect(foreign.body).toEqual({ operation: { key: base.operationKey, state: "unknown", jobId: null } });
    expect(fake.state().jobs).toHaveLength(1); expect(fake.booking).not.toHaveBeenCalled();
  });
  it.each(types)("internal mobile service silently ignores $type if strict route is bypassed (NOT acceptance)", async type => {
    const fake = fixture(); const created = await fake.service.createJobFromPriceBook(fake.db, authority(), { ...base, recurrence: rule(type), assignedUserId: 8 });
    expect(created.id).toBe(501); expect(fake.state().jobs).toHaveLength(1); expect(fake.state().rules).toHaveLength(0); expect(fake.availability).toHaveBeenCalledOnce();
    expect(created).not.toHaveProperty("recurrenceRuleId"); expect(created).not.toHaveProperty("occurrences");
    expect(fake.state().jobs[0]).not.toHaveProperty("recurrence_rule_id"); expect(fake.booking).not.toHaveBeenCalled();
  });
  it("fingerprint captures a directly supplied nested rule but does not make the service persist it", () => {
    const payload = recovery.operationPayloadForJobCreation({ ...base, recurrence: rule() });
    expect(payload).not.toHaveProperty("operationKey"); expect(payload.recurrence).toEqual(rule());
    expect(recovery.jobCreationPayloadFingerprint(payload)).not.toBe(recovery.jobCreationPayloadFingerprint({ ...payload, recurrence: rule("biweekly") }));
  });
});

describe("authoritative existing web rule/linked Job model controls (NOT mobile series acceptance)", () => {
  it("actual web service persists one rule and zero-based ordered occurrence keys with service copies", async () => {
    const fake = fixture(); const created = await fake.service.createJob(fake.db, authority(), webInput(persistedRule));
    expect(created).toMatchObject({ id: 501, customerId: 41, recurrenceCount: 3 });
    expect(fake.state().rules).toHaveLength(1); expect(fake.state().rules[0]).toMatchObject({ id: 301, company_id: 9, job_id: 501 });
    expect(fake.state().jobs.map(row => [row.recurrence_rule_id, row.recurrence_occurrence_number, row.recurrence_occurrence_key])).toEqual([[301, 0, "301:0"], [301, 1, "301:1"], [301, 2, "301:2"]]);
    expect(fake.state().lineItems).toHaveLength(6); expect(fake.state().operations).toHaveLength(0); expect(fake.booking).not.toHaveBeenCalled();
  });
  it("web all-occurrence availability guard rejection on third slot rolls back new customer and rule", async () => {
    const fake = fixture({ availabilityConflictAt: 3 }); const { customerId: _id, ...body } = webInput(persistedRule);
    await expect(fake.service.createJob(fake.db, authority(), { ...body, newCustomer: { firstName: "Casey", lastName: "Example" }, assignedUserId: 8 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fake.availability).toHaveBeenCalledTimes(3); expect(fake.connection.rollback).toHaveBeenCalledOnce(); expect(fake.state().customers).toHaveLength(0); expect(fake.state().jobs).toHaveLength(0); expect(fake.state().rules).toHaveLength(0);
  });
  it("web later-occurrence SQL failure rolls back all linked Jobs, rule and new customer", async () => {
    const fake = fixture({ failLine: 5 }); const { customerId: _id, ...body } = webInput(persistedRule);
    await expect(fake.service.createJob(fake.db, authority(), { ...body, newCustomer: { firstName: "Casey", lastName: "Example" } })).rejects.toThrow(/late service-line/);
    expect(fake.connection.rollback).toHaveBeenCalledOnce(); expect(fake.state().jobs).toHaveLength(0); expect(fake.state().rules).toHaveLength(0); expect(fake.state().customers).toHaveLength(0); expect(fake.booking).not.toHaveBeenCalled();
  });
  it("canonical getJob/getJobDetail read persisted occurrence identity but not a complete series", async () => {
    const fake = fixture(); await fake.service.createJob(fake.db, authority(), webInput(persistedRule));
    const detail = await fake.service.getJobDetail(fake.db, authority(), 502);
    expect(detail).toMatchObject({ id: 502, recurrenceRuleId: 301, recurrenceOccurrenceNumber: 1, recurrenceOccurrenceKey: "301:1", recurrenceLabel: "Recurring — Tuesday Weekly" });
    expect(detail).not.toHaveProperty("occurrences"); expect(detail).not.toHaveProperty("recurrenceCount"); expect(detail).not.toHaveProperty("recurrenceRule");
    expect(projection.projectMobileCompanyJob(detail)).not.toHaveProperty("recurrenceRuleId");
    await expect(fake.service.getJob(fake.db, authority("owner", 10), 502)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("never-ending expansion remains bounded to 13 existing-model occurrences", () => {
    const { endsOn: _end, ...recurrence } = persistedRule;
    expect(slots.recurringJobSlots(recurrence, "America/Chicago")).toHaveLength(13);
  });
  it("month-end clamps and last-weekday schedule use the authoritative model", () => {
    const monthly = dates.buildStoredRecurrenceRule({ type: "monthly_date", term: "3_months" }, "2027-01-31");
    expect(dates.generateRecurringDates(monthly.firstDate, monthly.rule)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
    const ordinal = dates.buildStoredRecurrenceRule({ type: "monthly_ordinal", term: "3_months", dayOfWeek: 2, ordinal: -1 }, "2026-12-01");
    // Finite term ends three months after firstDate: March 29, before March's last Tuesday.
    expect(ordinal.rule.endDate).toBe("2027-03-29");
    expect(dates.generateRecurringDates(ordinal.firstDate, ordinal.rule)).toEqual(["2026-12-29", "2027-01-26", "2027-02-23"]);
  });
  it("Company-local weekly 09:00 stays local across Chicago DST", () => {
    const occurrences = slots.recurringJobSlots({ ...persistedRule, weekday: 2, startsOn: "2027-03-02", endsOn: "2027-03-16" }, "America/Chicago");
    // Independently checked with Python zoneinfo: Chicago switches on March 14, 2027.
    expect(occurrences.map(slot => slot.scheduledStartAt)).toEqual(["2027-03-02T15:00:00.000Z", "2027-03-09T15:00:00.000Z", "2027-03-16T14:00:00.000Z"]);
  });
});

describe("mobile no-op integration preserves protected old operations and immutable intent", () => {
  it("old v1 omitted booking preference remains omitted rather than rewritten", () => {
    const { operationKey: _key, notifyCustomer: _notify, ...oldPayload } = base;
    const saved = mobileStorage.payloadCopy(oldPayload);
    expect(saved).toEqual(oldPayload); expect(saved).not.toHaveProperty("notifyCustomer"); expect(Object.isFrozen(saved)).toBe(true);
  });
  it("existing customer multiservices, discount and booking OFF remain canonical frozen payload", () => {
    const input: Row = { ...base, discount: { kind: "percent", value: 10, code: "MOCK" } };
    const payload = mobileApi.createJobSyncCompanyJobPayload(input);
    expect(payload).toEqual(input); expect(Object.isFrozen(payload)).toBe(true); expect(Object.isFrozen(payload.lineItems)).toBe(true);
    const { operationKey: _key, ...durable } = input;
    expect(mobileStorage.payloadCopy(durable)).toEqual(durable);
  });
  it("new customer nested fields remain independently captured and frozen", () => {
    const { customerId: _id, ...rest } = base; const newCustomer = { firstName: "Casey", lastName: "Example" };
    const payload = mobileApi.createJobSyncCompanyJobPayload({ ...rest, newCustomer });
    newCustomer.firstName = "Changed";
    expect(payload.newCustomer).toEqual({ firstName: "Casey", lastName: "Example" }); expect(Object.isFrozen(payload.newCustomer)).toBe(true);
  });
  it("line-item adapter and protected storage reject unsupported recurrence instead of claiming saved series", () => {
    expect(() => mobileApi.createJobSyncCompanyJobPayload({ ...base, recurrence: rule() })).toThrow(/fields could not be verified/);
    const { operationKey: _key, ...payload } = base;
    expect(() => mobileStorage.payloadCopy({ ...payload, recurrence: rule() })).toThrow(/recovery storage could not be verified/);
  });
  it("legacy single-service unknown recurrence omission is NOT an authorized fallback", () => {
    const legacy = mobileApi.createJobSyncCompanyJobPayload({ customerId: 41, priceBookServiceId: 71, scheduledStartAt: base.scheduledStartAt, operationKey: base.operationKey, recurrence: rule() });
    expect(legacy).not.toHaveProperty("recurrence");
  });
});

describe("ACTIVE recurring CREATE and durable saved-series acceptance requirements", () => {
  it.each(types)("CREATE must save durable $type series, not reject recurrence", async type => {
    const fake = fixture(); const res = response(); await fake.routes.createJob({ body: { ...base, recurrence: rule(type) } }, res);
    expect(res.statusCode, "Active requirement: recurring CREATE is still rejected by exact 2818 source").toBe(201);
    expect(fake.state().rules).toHaveLength(1); expect(fake.state().jobs.length).toBeGreaterThan(1);
  });
  it("saved operation readback must recover canonical rule and ordered occurrence identities", async () => {
    const fake = fixture();
    // Direct service execution proves its first-Job-only result even if parser were extended.
    await fake.service.createJobFromPriceBook(fake.db, authority(), { ...base, recurrence: rule() });
    const res = response(); await fake.routes.jobCreationOperation({ params: { operationKey: base.operationKey } }, res);
    const operation = (res.body as { operation: Row }).operation;
    expect(operation, "Active requirement: a saved single Job cannot establish a recurring series").toHaveProperty("recurrenceRuleId");
    expect(operation).toHaveProperty("occurrences");
  });
});
