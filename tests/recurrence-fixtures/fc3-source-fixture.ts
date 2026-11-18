import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { vi } from "vitest";
export const backendRoot = "/home/ubuntu/hsc-mobile-fc3-final-contract-20261117/backend-source-fc3bcaa7";
export const backendRevision = "fc3bcaa78c6288b705339bd69e2fe1539c779546";
if (JSON.parse(readFileSync(path.join(backendRoot, "..", "backend-revision.json"), "utf8")).sha !== backendRevision) throw new Error("Wrong fc3 source revision");
export const sourceHashes = new Map<string,string>();
export const extractedDeclarations: { file: string; names: readonly string[] }[] = [];
export const instances: unknown[] = [];
export const responses: unknown[] = [];
export const readBackend = (file: string) => { const absolute=path.join(backendRoot,file); const source=readFileSync(absolute,"utf8"); sourceHashes.set(absolute,createHash("sha256").update(source).digest("hex")); return source; };
type Row = Record<string, unknown>;
type Sql = { execute: (sql: string, params?: unknown[]) => Promise<[Row[], unknown?]>; getConnection?: () => Promise<Sql & { beginTransaction: () => Promise<void>; commit: () => Promise<void>; rollback: () => Promise<void>; release: () => void }> };
type Company = { companyId: number; userId: number; role: string; permissions: { canManageJobs: boolean }; timezone: string; name: string; memberId: string };
type Slot = { date: string; scheduledStartAt: string; scheduledEndAt: string };

export function declarations(source: string, names: readonly string[]) {
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
export function evaluate<T>(source: string, names: readonly string[], dependencies: Row = {}): T {
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
export function fromBackend<T>(file: string, names: readonly string[], dependencies: Row = {}) {
  extractedDeclarations.push({file:path.join(backendRoot,file),names});
  return evaluate<T>(declarations(readBackend(file), names), names, dependencies);
}
const errors = fromBackend<{
  DomainError: new (code: string, message: string) => Error & { code: string };
  domainHttpStatus: (error: unknown) => number;
  domainMobileCode: (error: unknown) => string;
}>("server/domainErrors.ts", ["DomainError", "domainHttpStatus", "domainMobileCode"]);
const company = fromBackend<{
  normalizeCompanyTimezone: (input: unknown) => string;
  createCompanyContext: (input: Row) => Company;
  loadCompanyTimezone: (db: Sql, companyId: number) => Promise<string>;
  companyContextFromMobile: (claims: Row, companyId: number, timezone?: string) => Company;
  requireManager: (company: Company) => void;
  technicianScopeSql: (company: Company, options?: Row) => Row;
}>("server/companyContext.ts", ["DEFAULT_COMPANY_TIMEZONE", "isCompanyRole", "isManagerRole", "permissionsForRole", "loadCompanyTimezone", "normalizeCompanyTimezone", "createCompanyContext", "companyContextFromMobile", "requireManager", "technicianScopeSql"], {
  ...errors, isSupportedCompanyTimezone: (value: string) => ["America/Chicago", "Australia/Lord_Howe"].includes(value),
});
export const authority = (role = "owner", companyId = 9) => company.createCompanyContext({ companyId, userId: 8, role, timezone: "America/Chicago" });
export const recovery = fromBackend<{
  jobCreationPayloadFingerprint: (input: Row) => string;
  operationPayloadForJobCreation: (input: Row) => Row;
  getJobCreationOperation: (db: Sql, company: Company, key: string) => Promise<Row | null>;
  operationReplayResult: (operation: Row, fingerprint: string) => Row;
  normalizeJobCreationOperationKey: (input: unknown) => string | null;
}>("server/jobCreationRecovery.ts", ["stableValue", "jobCreationPayloadFingerprint", "normalizeJobCreationOperationKey", "operationPayloadForJobCreation", "operationFromRow", "getJobCreationOperation", "assertOperationPayloadMatches", "operationReplayResult", "waitForJobCreationOperation"], { ...errors, createHash });
const price = fromBackend<Row>("server/priceBookPricing.ts", ["PRICE_BOOK_VEHICLE_KEYS", "COLUMN_BY_KEY", "toDollars", "isPriceBookVehicleKey", "normalizePriceBookVehicleKey", "normalizePriceBookSelectionKey", "matchingSelectionKeys", "dollarsFromColumn", "resolvePriceBookUnitPriceCents", "priceBookItemRequiresVehiclePriceKey"], {
  ...errors, parsePriceBookPricingConfiguration: () => ({ options: [] }),
});
const quote = fromBackend<{ recurrenceSelectionFromMobile: (input: Row) => Row; quoteMobileJob: (db: Sql, companyId: number, input: Row) => Promise<Row> }>("server/mobileJobQuote.ts", ["money", "normalizeDiscount", "normalizeRecurrence", "quoteMobileJob", "recurrenceSelectionFromMobile"], { ...errors, ...price });
export const dates = fromBackend<{
  buildStoredRecurrenceRule: (selection: Row, requestedStartDate: string) => { rule: Row; firstDate: string };
  generateRecurringDates: (first: string, rule: Row) => string[];
  recurrenceOccurrenceKey: (ruleId: number, ordinal: number) => string;
  recurrenceLabelFromParts: (input: Row) => string | null;
}>("shared/jobRecurrence.ts", ["NEVER_ENDING_RECURRENCE_JOB_COUNT", "TERM_MONTHS", "WEEKDAY_LABELS", "ORDINAL_LABELS", "parseDateOnly", "formatDateOnly", "dateAt", "daysInMonth", "addDays", "addMonthsClamped", "ordinalWeekdayOfMonth", "firstOrdinalOccurrenceOnOrAfter", "firstWeeklyOccurrenceOnOrAfter", "buildStoredRecurrenceRule", "nextRecurringDate", "generateRecurringDates", "recurrenceOccurrenceKey", "recurrenceLabelFromParts"]);
const wallTime = fromBackend<Row>("shared/companyScheduleTime.ts", ["partsForTimezone", "timezoneOffsetMilliseconds", "companyLocalWallTimeToIso"]);
export const slots = fromBackend<{ recurringJobSlots: (rule: Row, timezone: string) => Slot[] }>("server/recurringJobSchedule.ts", ["recurringJobSlots"], { ...dates, ...wallTime });
const projection = fromBackend<{ projectMobileCompanyJob: (job: Row) => Row }>("server/mobileCompanyJobDto.ts", ["asNumber", "asNullableInt", "asIso", "firstNonEmptyString", "projectMobileCompanyJob"]);

const localTime = fromBackend<Row>("server/companyTimezoneModel.ts", ["part", "companyLocalParts", "companyLocalDate", "companyLocalDateTime"], { normalizeCompanyTimezone: company.normalizeCompanyTimezone });
const timeOff = fromBackend<Row>("shared/timeOffAuthority.ts", ["TIME_OFF_APPROVED_AVAILABILITY_SQL", "TIME_OFF_APPROVED_UNAVAILABLE_MESSAGE", "TIME_OFF_STAFF_LOCK_SQL"]);
const actualAvailability = fromBackend<{ assertStaffAvailableForScheduledStart: (...args: unknown[]) => Promise<void>; lockCompanyUserForSchedule: (...args: unknown[]) => Promise<void> }>("server/staffAvailability.ts", ["scheduledInstant", "addLocalDate", "localSeconds", "foldBoundary", "companyLocalIntervalSegments", "companyTimezoneForAvailability", "lockCompanyUserForSchedule", "assertStaffAvailableForScheduledStart"], { ...errors, ...localTime, ...timeOff, loadCompanyTimezone: company.loadCompanyTimezone });
const actualCustomer = fromBackend<{ createCustomer: (...args: unknown[]) => Promise<Row> }>("server/customerService.ts", ["normalizeEmail", "normalizeCustomerPhone", "nullableText", "createCustomer"], { ...errors, requireManager: company.requireManager });
export function fixture(options: { failLine?: number; availabilityConflictAt?: number; missingCustomer?: boolean; missingService?: boolean; foreignMember?: boolean; timezone?: string; blockDate?: string; timeOffDate?: string; mysqlDates?: boolean } = {}) {
  let state = { jobs: [] as Row[], rules: [] as Row[], lineItems: [] as Row[], customers: [] as Row[], operations: [] as Row[], assignments: [] as Row[], events: [] as Row[] };
  let snapshot = structuredClone(state);
  let lineCount = 0;
  const queries: { sql: string; params: unknown[] }[] = [];
  let customerId = 42;
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
    if (sql.startsWith("SELECT timezone FROM companies")) return [[{ timezone: options.timezone ?? "America/Chicago" }]];
    if (sql.includes("FROM fs_time_off_requests")) return [options.timeOffDate === params[2] ? [{ id: 77 }] : []];
    if (sql.includes("FROM fs_schedule_blocks")) return [options.blockDate === params[2] ? [{ start_hour: 9, end_hour: 10 }] : []];
    if (sql.startsWith("SELECT id FROM company_users")) return [params[0] === 9 && params[1] === 8 ? [{ id: 8 }] : []];
    if (sql.startsWith("SELECT users.id FROM company_users")) return [params[0] === 8 && params[1] === 9 && !options.foreignMember ? [{ id: 8 }] : []];
    if (sql.startsWith("INSERT IGNORE INTO company_team_positions") || sql.startsWith("UPDATE company_users")) return [[]];
    if (sql.startsWith("INSERT INTO fs_customers")) {
      const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map(value => value.trim());
      const row: Row = { id: customerId++ }; columns.forEach((column, index) => { row[column] = params[index]; });
      state.customers.push(row); return [{ insertId: row.id } as unknown as Row[]];
    }
    if (sql.startsWith("INSERT INTO fs_customer_addresses")) return [[]];
    if (sql.includes("FROM fs_service_recurrence_rules WHERE")) return [state.rules.filter(row => row.id === params[0] && row.company_id === params[1]).map(row => options.mysqlDates
      ? { ...row, starts_on: new Date(`${row.starts_on}T00:00:00.000Z`), requested_start_date: row.requested_start_date == null ? null : new Date(`${row.requested_start_date}T00:00:00.000Z`), ends_on: row.ends_on == null ? null : new Date(`${row.ends_on}T00:00:00.000Z`) } : row)];
    if (sql.includes("FROM fs_jobs WHERE company_id = ? AND recurrence_rule_id = ?")) return [state.jobs.filter(row => row.company_id === params[0] && row.recurrence_rule_id === params[1]).sort((a, b) => Number(a.recurrence_occurrence_number) - Number(b.recurrence_occurrence_number))];
    if (sql.includes("FROM fs_customers WHERE")) return [params[0] === 41 && params[1] === 9 && !options.missingCustomer ? [{ id: 41 }] : []];
    if (sql.includes("FROM fs_price_book WHERE company_id")) return [params[0] === 9 && !options.missingService ? [
      { id: 71, name: "First", base_price: 100, default_duration_minutes: 60, is_taxable: 1 },
      { id: 72, name: "Second", base_price: 50, default_duration_minutes: 30, is_taxable: 0 },
    ].filter(row => params.slice(1).includes(row.id)) : []];
    if (sql.includes("FROM fs_price_book WHERE id")) return [params[1] === 9 && !options.missingService ? [{ id: params[0] }] : []];
    if (sql.includes("FROM fs_company_settings")) return [[{ default_tax_rate_bps: 500 }]];
    if (sql.startsWith("INSERT INTO fs_jobs")) {
      const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map(value => value.trim());
      const row: Row = { id: state.jobs.length + 501, updated_at: "2026-11-17T12:00:00.000Z" };
      let offset = 0;
      for (const column of columns) row[column] = column === "status" ? "scheduled" : params[offset++];
      state.jobs.push(row); return [{ insertId: row.id } as unknown as Row[]];
    }
    if (sql.startsWith("INSERT INTO fs_service_recurrence_rules")) {
      const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map(value => value.trim());
      const row: Row = { id: 301, updated_at: "2026-11-17T12:00:00.000Z", is_active: 1, cancelled_from_occurrence_number: null };
      let offset = 0;
      for (const column of columns) row[column] = column === "job_id" ? null : params[offset++];
      state.rules.push(row); return [{ insertId: 301 } as unknown as Row[]];
    }
    if (sql.startsWith("UPDATE fs_service_recurrence_rules")) { state.rules[0].job_id = params[0] as null; return [[]]; }
    if (sql.startsWith("INSERT INTO fs_job_line_items")) {
      lineCount += 1; if (lineCount === options.failLine) throw new Error("fake late service-line failure");
      state.lineItems.push({ id: lineCount + 600, company_id: params[0], job_id: params[1], price_book_item_id: params[2], name: params[3], quantity: params[4], unit_price: params[5], total_price: params[6], sort_order: params[7] }); return [[]];
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
  const availability = vi.fn(async (...args: unknown[]) => { if (availability.mock.calls.length === options.availabilityConflictAt) throw new errors.DomainError("CONFLICT", "Fake Team Member unavailable"); return actualAvailability.assertStaffAvailableForScheduledStart(...args); });
  const customer = vi.fn(actualCustomer.createCustomer);
  const member = vi.fn(async (_db: Sql, context: Company, id: number) => { if (context.companyId !== 9 || id !== 8 || options.foreignMember) throw new errors.DomainError("NOT_FOUND", "Fake Team Member not in Company"); });
  const service = fromBackend<{
    createJobFromPriceBook: (db: Sql, context: Company, input: Row) => Promise<Row>;
    createJob: (db: Sql, context: Company, input: Row) => Promise<Row>;
    getJob: (db: Sql, context: Company, id: number) => Promise<Row>;
    getJobDetail: (db: Sql, context: Company, id: number) => Promise<Row>;
    getJobRecurrenceSeries: (db: Sql, context: Company, id: number) => Promise<Row>;
  }>("server/jobService.ts", ["toNumber", "iso", "dateOnly", "MAX_JOB_FINANCIAL_AMOUNT", "roundJobFinancialAmount", "storageSafeJobFinancialAmount", "storageSafeJobFinancialTotals", "withTransaction", "insertJobEvent", "isMysqlDuplicate", "createJobFromPriceBook", "createJob", "getJob", "getJobDetail", "getJobRecurrenceSeries", "requireCalendarEligibleMember"], {
    ...errors, ...recovery, ...price, ...quote, ...dates, ...slots,
    requireManager: company.requireManager, technicianScopeSql: company.technicianScopeSql,
    createCustomer: customer, generatePublicToken: () => "fake-public-token", attemptBookingConfirmationAfterCommit: booking,
    ensureCompanyTeamPositions: vi.fn(async () => {}), lockCompanyUserForSchedule: actualAvailability.lockCompanyUserForSchedule, assertStaffAvailableForScheduledStart: availability, createAlert: vi.fn(async () => {}),
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
    jobRecurrenceSeries: (request: Row, res: ReturnType<typeof response>) => Promise<unknown>;
    jobCreationOperation: (request: Row, res: ReturnType<typeof response>) => Promise<unknown>;
  }>("server/mobileOperations.ts", ["mobileErrorStatus", "mobileTrpcError", "operationalError", "mobileCompany", "requireManager", "mobileJobCreateSchema", "mobileJobQuoteSchema", "createJob", "quoteJob", "jobCreationOperation", "jobRecurrenceSeries", "persistedRecurrenceForCreate"], {
    z, ...errors, ...projection, requireMobileCompany: auth, companyContextFromMobile: company.companyContextFromMobile,
    managerRoles: new Set(["owner", "dispatcher"]), MobileAuthError: class extends Error { constructor(readonly status: number, message: string) { super(message); } },
    getJobRecurrenceSeries: service.getJobRecurrenceSeries, ...dates, ...localTime, loadCompanyTimezone: company.loadCompanyTimezone, createJobFromPriceBook: service.createJobFromPriceBook, getJobDetail: service.getJobDetail, ...recovery, ...quote,
  });
  const instance = { state: () => state, queries, db, connection, booking, availability, customer, member, service, routes, auth };
  instances.push(instance);
  return instance;
}
export function response() {
  const result = { statusCode: 200, body: undefined as unknown,
    status(value: number) { result.statusCode = value; return result; }, json(value: unknown) { result.body = value; return result; } };
  responses.push(result);
  return result;
}
