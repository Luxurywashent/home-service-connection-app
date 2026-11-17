import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  companyJobPricingMatchesInput, normalizeCompanyJobPricing, normalizeCompanyJobQuote,
  normalizeCompanyJobQuoteInput, normalizeCompanyJobLineItems, normalizeCompanyJobDiscount,
} from "../lib/company-job-pricing";

/** No backend bootstrap/imports, listeners, real SQL, communications, charges or migrations.
 * Selected exact declarations are transpiled unchanged. Only whitelisted pure modules and
 * the pinned backend fake SQL fixture may load. Failed historical-tax gates remain failures.
 */
const backendRoot = "/home/ubuntu/hsc-mobile-backend-compatibility-2818bb72-20261117/backend-source-2818bb72";
const readBackend = (file: string) => readFileSync(path.join(backendRoot, file), "utf8");
type Row = Record<string, any>;
function declarations(source: string, names: readonly string[]) {
  const file = ts.createSourceFile("isolated.ts", source, ts.ScriptTarget.Latest, true);
  const selected = new Map<string, string>();
  for (const node of file.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) selected.set(node.name.text, node.getText(file));
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) selected.set(declaration.name.text, `const ${declaration.getText(file)};`);
    }
  }
  return names.map(name => {
    if (!selected.has(name)) throw new Error(`Exact declaration missing: ${name}`);
    return selected.get(name);
  }).join("\n");
}
const deny = () => { throw new Error("Real import/network/provider access forbidden"); };
function evaluate(source: string, dependencies: Row = {}, names?: readonly string[]): Row {
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, require: deny, fetch: deny,
    process: { env: Object.freeze({}) }, Object, Array, Reflect, Error, Date, Map, Set,
    Number, String, Boolean, JSON, Intl, Buffer, Math, ...dependencies,
  });
  const js = ts.transpileModule(source + (names ? `\nmodule.exports = {${names.join(",")}};` : ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new vm.Script(js).runInContext(context, { timeout: 3000 });
  return module.exports;
}
const allowed = new Set([
  "server/domainErrors.ts", "server/companyContext.ts", "shared/companyTimezones.ts",
  "shared/priceBookConfiguration.ts", "server/priceBookPricing.ts", "server/mobileJobQuote.ts",
  "server/mobileCompanyJobDto.ts", "server/jobLifecycle.ts", "shared/jobStatuses.ts",
  "shared/jobRecurrence.ts", "server/phase2TestDb.ts", "server/companyTimezoneModel.ts",
  "shared/companyBusinessWeek.ts", "shared/timeOffAuthority.ts", "server/jobCreationRecovery.ts",
]);
const modules = new Map<string, Row>();
function pure(file: string): Row {
  if (!allowed.has(file)) return deny();
  if (modules.has(file)) return modules.get(file)!;
  const result = evaluate(readBackend(file), { require: (specifier: string) => {
    if (file === "server/jobCreationRecovery.ts" && specifier === "node:crypto") return { createHash };
    if (!specifier.startsWith(".")) return deny();
    return pure(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)).replace(/\.js$/, ".ts"));
  } });
  modules.set(file, result);
  return result;
}
const domains = pure("server/domainErrors.ts");
const companyContext = pure("server/companyContext.ts");
const quoteService = pure("server/mobileJobQuote.ts");
const customerNames = ["normalizeEmail", "normalizeCustomerPhone", "nullableText", "createCustomer"];
const customers = evaluate(declarations(readBackend("server/customerService.ts"), customerNames), {
  ...domains, requireManager: companyContext.requireManager, addNote: deny,
}, customerNames);
const lifecycle = pure("server/jobLifecycle.ts");
const recurrence = pure("shared/jobRecurrence.ts");
const confirmationNames = ["appointmentStartUnix", "sameAppointmentStart", "isAppointmentConfirmed", "confirmationStatusFromJob", "confirmationProjection"];
const confirmation = evaluate(declarations(readBackend("server/appointmentConfirmation.ts"), confirmationNames), {}, confirmationNames);
const serviceNames = ["toNumber", "iso", "MAX_JOB_FINANCIAL_AMOUNT", "roundJobFinancialAmount", "storageSafeJobFinancialAmount", "withTransaction", "insertJobEvent", "isMysqlDuplicate", "getJob", "getJobDetail", "latestBookingCommunicationOutcome", "effectiveLifecycleTimestamps", "lifecycleTimingOverrideForJob", "createJobFromPriceBook"];
const forbiddenSend = vi.fn(deny);
const service = evaluate(declarations(readBackend("server/jobService.ts"), serviceNames), {
  ...domains, ...companyContext, ...quoteService, ...customers, ...lifecycle, ...confirmation, ...recurrence,
  ...pure("server/priceBookPricing.ts"), ...pure("server/jobCreationRecovery.ts"),
  formatServiceName: (name: string) => name,
  // Finance is a read-only isolated provider; values come from the saved fake SQL Job, never client formulas.
  getJobPaymentBalance: async (db: Row, company: Row, id: number) => {
    const job = db.state.jobs.get(id);
    if (!job || job.company_id !== company.companyId) return deny();
    return { jobTotal: job.amount, paid: 0, refundTotal: 0, appliedEstimateCredit: 0, balance: job.amount, paymentStatus: "unpaid" };
  },
  generatePublicToken: () => "synthetic-token-no-network",
  attemptBookingConfirmationAfterCommit: forbiddenSend,
  lockCompanyUserForSchedule: deny, requireCalendarEligibleMember: deny, assertStaffAvailableForScheduledStart: deny,
}, serviceNames);
const mobilePayloadNames = ["positiveJobSyncId", "companyJobCreationOperationKey", "normalizeCompanyJobNewCustomer", "createJobSyncCompanyJobPayload"];
const mobilePayload = evaluate(declarations(readFileSync(path.resolve(__dirname, "../lib/jobsync-mobile-api.ts"), "utf8"), mobilePayloadNames), {
  z, normalizeCompanyJobLineItems, normalizeCompanyJobDiscount,
}, mobilePayloadNames);
const handlerNames = ["mobileJobCreateSchema", "mobileJobQuoteSchema", "mobileErrorStatus", "mobileTrpcError", "operationalError", "createJob", "quoteJob", "jobDetail", "iso"];
function handlers(fake: Row, role = "owner", companyId = 11) {
  const company = companyContext.companyContextFromSession({ userId: companyId * 10 + 1, companyId, role, name: "Synthetic Team Member", memberId: "SYNTHETIC" }, "America/Chicago");
  const errorNames = ["mobileErrorStatus", "mobileTrpcError", "operationalError"];
  const errors = evaluate(declarations(readBackend("server/mobileOperations.ts"), errorNames), { z, ...domains }, errorNames);
  const names = handlerNames.filter(name => name !== "operationalError");
  return evaluate(declarations(readBackend("server/mobileOperations.ts"), names), {
    z, ...domains, ...service, ...quoteService, ...pure("server/mobileCompanyJobDto.ts"),
    mobileCompany: async () => ({ company, db: fake.db }), signedStorageUrlFromStoredUrl: (url: string) => url,
    operationalError: (res: Row, error: unknown, fallback: string) => { fake.errors.push(error); return errors.operationalError(res, error, fallback); },
  }, names);
}
function setup() {
  const fake = pure("server/phase2TestDb.ts").createPhase2FakeDb();
  fake.seedCompany(11); fake.seedCompany(22);
  const primary = fake.state.services.get(1105);
  primary.is_taxable = 1;
  fake.state.services.set(1106, { ...primary, id: 1106, name: "Second service", base_price: 100, sedan_price: 100, suv_price: 100, truck_price: 100, van_price: 100, pricing_json: { sedan: 100 }, default_duration_minutes: 30, is_taxable: 1 });
  fake.state.settings.set(11, { default_tax_rate_bps: 825 });
  const executed: { sql: string; params: unknown[] }[] = [];
  const operations = new Map<string, Row>();
  const errors: unknown[] = [];
  const execute = fake.db.execute;
  const wrap = async (sql: string, params: unknown[] = []) => {
    executed.push({ sql, params: [...params] });
    if (sql.includes("FROM fs_company_communications") && sql.includes("purpose = 'appointment_confirmation'")) return [[]];
    if (sql.startsWith("SELECT operation_key, payload_fingerprint")) {
      const row = operations.get(`${params[0]}:${params[1]}`);
      return [row ? [{ ...row }] : []];
    }
    if (sql.startsWith("INSERT INTO fs_job_creation_operations")) {
      const key = `${params[0]}:${params[1]}`;
      if (operations.has(key) && !sql.includes("ON DUPLICATE KEY")) throw Object.assign(new Error("Synthetic duplicate"), { code: "ER_DUP_ENTRY" });
      if (!operations.has(key)) operations.set(key, { operation_key: params[1], payload_fingerprint: params[2], state: sql.includes("'rejected'") ? "rejected" : "pending", job_id: null, rejection_code: sql.includes("'rejected'") ? params[3] : null, rejection_message: sql.includes("'rejected'") ? params[4] : null, created_at: "2026-11-17T18:00:00.000Z", updated_at: "2026-11-17T18:00:00.000Z" });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("UPDATE fs_job_creation_operations SET state = 'saved'")) {
      const row = operations.get(`${params[1]}:${params[2]}`)!;
      row.state = "saved"; row.job_id = params[0]; return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("SELECT price_book_item_id FROM fs_job_line_items")) {
      return [fake.state.lineItems.filter((line: Row) => line.company_id === params[0] && line.job_id === params[1]).sort((a: Row, b: Row) => a.sort_order - b.sort_order || a.id - b.id).slice(0, 1).map((line: Row) => ({ price_book_item_id: line.price_book_item_id }))];
    }
    const result = await execute(sql, params);
    // SQL SELECT projection must be enforced: fixture objects cannot hide an omitted ordinal.
    if (sql.includes("FROM fs_job_line_items WHERE job_id = ?") && !sql.startsWith("INSERT")) {
      const selected = sql.slice(sql.indexOf("SELECT ") + 7, sql.indexOf(" FROM")).split(",").map(field => field.trim());
      return [result[0].map((line: Row) => Object.fromEntries(selected.map(field => [field, line[field]])))];
    }
    return result;
  };
  fake.db.execute = wrap;
  fake.db.getConnection = async () => ({ execute: wrap, state: fake.state, beginTransaction: async () => undefined, commit: async () => undefined, rollback: async () => undefined, release: () => undefined });
  return { ...fake, executed, errors };
}
function response() {
  const res = { statusCode: 200, body: null as any, status(code: number) { res.statusCode = code; return res; }, json(body: unknown) { res.body = JSON.parse(JSON.stringify(body)); return res; } };
  return res;
}
const lines = [{ priceBookItemId: 1105, quantity: 1, vehiclePriceKey: "sedan" }, { priceBookItemId: 1106, quantity: 2, vehiclePriceKey: "sedan" }];
const quoteInput = { lineItems: lines, discount: { kind: "percent" as const, value: 10, code: "SPRING10" } };
const strict = { requireStoredTaxEvidence: true };
async function create(fake: Row, selector: Row, key: string, overrides: Row = {}) {
  const input = mobilePayload.createJobSyncCompanyJobPayload({ ...quoteInput, ...selector, scheduledStartAt: "2026-12-01T14:00:00.000Z", operationKey: key, notifyCustomer: false, ...overrides });
  const res = response();
  await handlers(fake).createJob({ body: input }, res);
  return { res, input };
}
function fiscalRow(patch: Row = {}): Row {
  return { lineItems: [{ id: 1, priceBookItemId: 1105, name: "Server service", quantity: 1, unitPrice: 100, lineTotal: 100, sortOrder: 0 }], subtotalAmount: 100, discountAmount: 10, amount: 90, discountKind: "flat", discountCode: null, taxAmount: 0, taxRateBps: 0, ...patch };
}

describe("unpublished 2818 pricing authoritative contracts", () => {
  it("pins exact source and fake SQL provenance, not current production", () => {
    const revision = JSON.parse(readFileSync(path.join(backendRoot, "../backend-revision.json"), "utf8"));
    expect(revision.sha).toBe("2818bb72ddf4b702e213a2a702150e2657c652c9");
    for (const [file, hash] of Object.entries({
      "server/jobService.ts": "e9df7c962bbb1292e961cf0efa8a323faf11487d974d611b9d58f011e4cf0d25",
      "server/mobileOperations.ts": "c2f6f1fd38982ece0bed8f311d80ff1dd490127201845fea83effdb357713fa8",
      "server/phase2TestDb.ts": "51128336e8398fb4e301fb30352a49f851cf681e58cf2e3fac2a28d5e8819b41",
    })) expect(createHash("sha256").update(readBackend(file)).digest("hex")).toBe(hash);
    expect(() => pure("server/db.ts")).toThrow(/forbidden/);
  });
  it("executes exact quote schema/handler/service and validates the actual server quote", async () => {
    const fake = setup(); const res = response();
    await handlers(fake).quoteJob({ body: quoteInput }, res);
    expect(res.statusCode).toBe(200);
    const quote = normalizeCompanyJobQuote(res.body.quote, normalizeCompanyJobQuoteInput(quoteInput));
    expect(quote).toMatchObject({ subtotal: 449.5, discount: 44.95, tax: 33.38, taxRateBps: 825, total: 437.93, totalDurationMinutes: 150 });
    expect(fake.state.jobs.size).toBe(0);
  });
  it.each(["existing", "new"])("%s customer mobile CREATE persists ordered quantities and fiscal totals; GET/replay agrees", async kind => {
    const fake = setup(); const count = fake.state.customers.size;
    const selector = kind === "new" ? { newCustomer: { firstName: "Casey", lastName: "Example", email: "synthetic@example.invalid", addressLine1: "Synthetic address" } } : { customerId: 1101 };
    const { res, input } = await create(fake, selector, `pricing-${kind}-operation`);
    expect(res.statusCode, String(fake.errors[0])).toBe(201);
    const saved = res.body.job;
    expect(saved.companyId).toBe(11);
    expect(fake.state.customers.size).toBe(count + (kind === "new" ? 1 : 0));
    const stored = fake.state.jobs.get(saved.id);
    expect(stored).toMatchObject({ subtotal_amount: 449.5, discount_amount: 44.95, tax_amount: 33.38, tax_rate_bps: 825, amount: 437.93 });
    expect(saved.lineItems.map((line: Row) => line.sortOrder)).toEqual([0, 1]);
    expect(saved.lineItems.map((line: Row) => line.quantity)).toEqual([1, 2]);
    const pricing = normalizeCompanyJobPricing(saved, strict)!;
    expect(pricing).toMatchObject({ subtotalAmount: 449.5, discountAmount: 44.95, taxAmount: 33.38, taxRateBps: 825, totalAmount: 437.93 });
    expect(companyJobPricingMatchesInput(pricing, quoteInput)).toBe(true);
    const get = response(); await handlers(fake).jobDetail({ params: { jobId: String(saved.id) } }, get);
    expect(normalizeCompanyJobPricing(get.body.job, strict)).toEqual(pricing);
    const replay = response(); await handlers(fake).createJob({ body: input }, replay);
    expect(replay.statusCode).toBe(200); expect(replay.body.operation.replayed).toBe(true);
    expect(replay.body.job.id).toBe(saved.id); expect(normalizeCompanyJobPricing(replay.body.job, strict)).toEqual(pricing);
    expect(fake.state.jobs.size).toBe(1); expect(fake.state.lineItems).toHaveLength(2);
    expect(fake.state.customers.size).toBe(count + (kind === "new" ? 1 : 0));
    expect(forbiddenSend).not.toHaveBeenCalled();
  });
  it("selects persisted non-contiguous ordinals and tie-break IDs instead of inventing offsets or zero", async () => {
    const fake = setup(); const { res } = await create(fake, { customerId: 1101 }, "pricing-ordinal-operation");
    const id = res.body.job.id;
    fake.state.lineItems[0].sort_order = 9; fake.state.lineItems[1].sort_order = 4;
    const extra = { ...fake.state.lineItems[1], id: 999, sort_order: 4 };
    fake.state.lineItems.unshift(extra, { ...extra, id: 998, company_id: 22 });
    const get = response(); await handlers(fake).jobDetail({ params: { jobId: String(id) } }, get);
    expect(get.body.job.lineItems.map((line: Row) => [line.id, line.sortOrder])).toEqual([[2, 4], [999, 4], [1, 9]]);
    expect(normalizeCompanyJobPricing(get.body.job, strict)?.lineItems.map(line => line.sortOrder)).toEqual([4, 4, 9]);
    const query = fake.executed.find((entry: Row) => entry.sql.startsWith("SELECT id, price_book_item_id, name, quantity, unit_price, total_price, sort_order"));
    expect(query?.params).toEqual([id, 11]);
    expect(query?.sql).toContain("ORDER BY sort_order, id");
  });
  it("retains legacy single-service server pricing without introducing tax/repricing", async () => {
    const fake = setup(); const { res } = await create(fake, { customerId: 1101 }, "pricing-single-operation", { lineItems: undefined, discount: undefined, priceBookServiceId: 1105, vehiclePriceKey: "sedan" });
    expect(res.statusCode).toBe(201);
    expect(normalizeCompanyJobPricing(res.body.job, strict)).toMatchObject({ taxAmount: 0, taxRateBps: 0, totalAmount: 249.5, lineItems: [{ quantity: 1, sortOrder: 0 }] });
  });
  it.each(["null", "absent"])("OPEN backend acceptance: %s historical fiscal values must project unknown, not zero", async mode => {
    const fake = setup(); const job = fake.addJob(11, { id: 900, amount: 90, subtotal_amount: 100, discount_amount: 10 });
    if (mode === "null") { job.tax_amount = null; job.tax_rate_bps = null; }
    else { delete job.tax_amount; delete job.tax_rate_bps; }
    const get = response(); await handlers(fake).jobDetail({ params: { jobId: "900" } }, get);
    expect(get.statusCode).toBe(200);
    // Active acceptance requirement: deliberately remains a raw failing gate until backend fixes its DTO.
    expect({ taxAmount: get.body.job.taxAmount, taxRateBps: get.body.job.taxRateBps }).toEqual({ taxAmount: null, taxRateBps: null });
  });
  it.each(["null", "absent"])("mobile helper conservatively preserves %s historical tax as unknown despite backend zero", async mode => {
    const fake = setup(); const job = fake.addJob(11, { id: 900, amount: 90, subtotal_amount: 100, discount_amount: 10 });
    if (mode === "null") { job.tax_amount = null; job.tax_rate_bps = null; }
    else { delete job.tax_amount; delete job.tax_rate_bps; }
    const get = response(); await handlers(fake).jobDetail({ params: { jobId: "900" } }, get);
    const pricing = normalizeCompanyJobPricing(get.body.job, strict);
    expect(pricing).toMatchObject({ taxAmount: null, taxRateBps: null, subtotalAmount: 100, discountAmount: 10, totalAmount: 90 });
    expect(Object.isFrozen(pricing)).toBe(true);
  });
  it("technician creation and foreign customer/catalog fail without persisting prices", async () => {
    const fake = setup();
    const res = response(); await handlers(fake, "technician").createJob({ body: { customerId: 1101, ...quoteInput, scheduledStartAt: "2026-12-01T14:00:00.000Z", notifyCustomer: false } }, res);
    expect(res.statusCode).toBe(403); expect(fake.state.jobs.size).toBe(0);
    const foreign = await create(fake, { customerId: 2201 }, "pricing-foreign-customer");
    expect(foreign.res.statusCode).toBe(404); expect(fake.state.jobs.size).toBe(0);
    const catalog = await create(fake, { customerId: 1101 }, "pricing-foreign-catalog", { lineItems: [{ priceBookItemId: 2205, quantity: 1 }] });
    expect(catalog.res.statusCode).toBe(404); expect(fake.state.jobs.size).toBe(0); expect(fake.state.lineItems).toHaveLength(0);
  });
  it("dispatcher CREATE uses the same authoritative server quantities, ordinals and tax", async () => {
    const fake = setup(); const res = response();
    await handlers(fake, "dispatcher").createJob({ body: { customerId: 1101, ...quoteInput, scheduledStartAt: "2026-12-01T14:00:00.000Z", notifyCustomer: false } }, res);
    expect(res.statusCode, String(fake.errors[0])).toBe(201);
    expect(normalizeCompanyJobPricing(res.body.job, strict)).toMatchObject({ taxAmount: 33.38, taxRateBps: 825, totalAmount: 437.93 });
    expect(res.body.job.lineItems.map((line: Row) => line.sortOrder)).toEqual([0, 1]);
  });
  it.each([null, 111, 113])("same-Company technician may read authoritative pricing for assignment %j", async assignedUserId => {
    const fake = setup(); const { res } = await create(fake, { customerId: 1101 }, "pricing-tech-read-operation");
    fake.state.jobs.get(res.body.job.id).assigned_user_id = assignedUserId;
    const get = response(); await handlers(fake, "technician").jobDetail({ params: { jobId: String(res.body.job.id) } }, get);
    expect(get.statusCode).toBe(200);
    expect(normalizeCompanyJobPricing(get.body.job, strict)).toMatchObject({ taxAmount: 33.38, totalAmount: 437.93 });
  });
  it("canonical pricing GET cannot read a foreign Company Job or its line set", async () => {
    const fake = setup(); const { res } = await create(fake, { customerId: 1101 }, "pricing-tenant-read-operation");
    const get = response(); await handlers(fake, "owner", 22).jobDetail({ params: { jobId: String(res.body.job.id) } }, get);
    expect(get.statusCode).toBe(404); expect(get.body.job).toBeUndefined();
    expect(fake.state.jobs.size).toBe(1); expect(fake.state.lineItems).toHaveLength(2);
  });
});

describe("mobile fiscal availability and no client repricing", () => {
  it("known stored decimal strings and zero remain known only when canonical values agree", () => {
    expect(normalizeCompanyJobPricing(fiscalRow({ tax_amount: "0.00", tax_rate_bps: "0" }), strict)).toMatchObject({ taxAmount: 0, taxRateBps: 0 });
    expect(normalizeCompanyJobPricing(fiscalRow({ taxAmount: 8.25, taxRateBps: 825, tax_amount: "8.25", tax_rate_bps: 825 }), strict)).toMatchObject({ taxAmount: 8.25, taxRateBps: 825, totalAmount: 90 });
  });
  it.each([{ tax_amount: null }, { tax_rate_bps: null }, { tax_amount: undefined }])("explicit missing storage evidence never certifies zero %j", patch => {
    expect(normalizeCompanyJobPricing(fiscalRow({ tax_amount: 0, tax_rate_bps: 0, ...patch }))).toMatchObject({ ...(Object.hasOwn(patch, "tax_amount") ? { taxAmount: null } : { taxRateBps: null }) });
  });
  it.each([{ tax_amount: "" }, { tax_amount: "0x0" }, { tax_amount: -1 }, { tax_amount: "NaN" }, { tax_amount: " 0 " }, { tax_rate_bps: "8.25" }, { tax_amount: 1 }, { tax_rate_bps: 825 }])("malformed or conflicting evidence rejects pricing rather than synthesizing %j", patch => {
    expect(normalizeCompanyJobPricing(fiscalRow({ tax_amount: 0, tax_rate_bps: 0, ...patch }), strict)).toBeNull();
  });
  it("does not fill omitted canonical tax from a raw storage alias", () => {
    expect(normalizeCompanyJobPricing(fiscalRow({ taxAmount: undefined, taxRateBps: undefined, tax_amount: "0.00", tax_rate_bps: 0 }), strict)).toMatchObject({ taxAmount: null, taxRateBps: null });
  });
  it("preserves old canonical-only matcher fixtures but strict adapters treat absent evidence as unavailable", () => {
    const row = fiscalRow();
    expect(normalizeCompanyJobPricing(row)).toMatchObject({ taxAmount: 0, taxRateBps: 0 });
    const pricing = normalizeCompanyJobPricing(row, strict)!;
    expect(pricing).toMatchObject({ taxAmount: null, taxRateBps: null });
    expect(companyJobPricingMatchesInput(pricing, { lineItems: [{ priceBookItemId: 1105, quantity: 1 }], discount: { kind: "flat", value: 10 } })).toBe(false);
    expect(normalizeCompanyJobPricing({ amount: 90 }, strict)).toBeUndefined();
  });
  it("retains exact server amounts/quantities/order without local fiscal formulas and freezes copies", () => {
    const row = fiscalRow({ amount: 777, tax_amount: 0, tax_rate_bps: 0 });
    const pricing = normalizeCompanyJobPricing(row, strict)!;
    row.lineItems[0].quantity = 99; row.amount = 1;
    expect(pricing).toMatchObject({ totalAmount: 777, subtotalAmount: 100, discountAmount: 10, lineItems: [{ quantity: 1, lineTotal: 100, sortOrder: 0 }] });
    expect(Object.isFrozen(pricing.lineItems)).toBe(true); expect(Object.isFrozen(pricing.lineItems[0])).toBe(true);
  });
  it("does not sort malformed descending readback or demand synthetic unique/index ordinals", () => {
    const row = fiscalRow(); row.lineItems.push({ ...row.lineItems[0], id: 2, sortOrder: 0 });
    expect(normalizeCompanyJobPricing(row)?.lineItems.map(line => line.sortOrder)).toEqual([0, 0]);
    row.lineItems[0].sortOrder = 9;
    expect(normalizeCompanyJobPricing(row)).toBeNull();
  });
});
