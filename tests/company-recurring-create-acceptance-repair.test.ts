import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { normalizeCompanyJobRecurrence } from "../lib/company-job-recurrence";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeCompanyJobDiscount, normalizeCompanyJobLineItems,
  normalizeCompanyJobQuote, normalizeCompanyJobQuoteInput,
} from "../lib/company-job-pricing";

/**
 * Defect-reproduction/contract-boundary checks, NOT recurring-create success.
 * Execute selected declarations from the supplied published source only. Do not
 * import backend bootstrap, open HTTP listeners, authenticate, or touch SQL/native
 * storage/providers. A quote is not authority to enable unsupported creation.
 */
const mobileRoot = path.resolve(__dirname, "..");
const readinessRoot = "/home/ubuntu/hsc-mobile-release-readiness-20261117";
const backendRoot = path.join(readinessRoot, "backend-source-66141c98");
const backendRevision = "66141c98aec493861acc7cfdc85d7ebeea7009da";
const readMobile = (file: string) => readFileSync(path.join(mobileRoot, file), "utf8");
const readBackend = (file: string) => readFileSync(path.join(backendRoot, file), "utf8");

function declarations(source: string, names: readonly string[]): string {
  const file = ts.createSourceFile("contract.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const selected = new Map<string, string>();
  for (const node of file.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      selected.set(node.name.text, node.getText(file));
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) {
          selected.set(declaration.name.text, `const ${declaration.getText(file)};`);
        }
      }
    }
  }
  return names.map(name => {
    const declaration = selected.get(name);
    if (!declaration) throw new Error(`Missing exact source declaration: ${name}`);
    return declaration;
  }).join("\n");
}

function evaluate<T>(source: string, dependencies: Record<string, unknown>, names: readonly string[]): T {
  const module = { exports: {} };
  const deny = () => { throw new Error("Forbidden backend import, network or provider access"); };
  const context = vm.createContext({
    module, exports: module.exports, require: deny, fetch: deny,
    process: { env: Object.freeze({}) }, Object, Array, Reflect, Error,
    ...dependencies,
  });
  const js = ts.transpileModule(`${source}\nmodule.exports = { ${names.join(",")} };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new vm.Script(js).runInContext(context, { timeout: 2000 });
  return module.exports as T;
}

const pricing = { normalizeCompanyJobLineItems, normalizeCompanyJobDiscount };
const apiNames = ["positiveJobSyncId", "companyJobCreationOperationKey", "normalizeCompanyJobNewCustomer", "createJobSyncCompanyJobPayload"];
const api = evaluate<{
  createJobSyncCompanyJobPayload: (input: unknown) => Record<string, unknown>;
  normalizeCompanyJobNewCustomer: (input: unknown) => unknown;
}>(declarations(readMobile("lib/jobsync-mobile-api.ts"), apiNames), { ...pricing, z }, apiNames);
const storageNames = ["corrupt", "positive", "object", "shape", "instant", "textLimits", "canonicalNested", "payloadCopy"];
const storage = evaluate<{ payloadCopy: (input: unknown) => Record<string, unknown> }>(
  declarations(readMobile("lib/company-job-creation-storage.ts"), storageNames),
  { ...pricing, normalizeCompanyJobNewCustomer: api.normalizeCompanyJobNewCustomer, normalizeCompanyJobRecurrence }, ["payloadCopy"],
);

class DomainError extends Error {}
const sql = vi.fn(() => { throw new Error("Forbidden SQL"); });
const create = vi.fn(() => { throw new Error("Forbidden creation service"); });
const detail = vi.fn(() => { throw new Error("Forbidden Job detail read"); });
const auth = vi.fn(async () => ({
  company: { companyId: 9, userId: 8, role: "owner", permissions: { canManageJobs: true } },
  db: { execute: sql },
}));
const backendNames = ["mobileJobCreateSchema", "mobileJobQuoteSchema", "operationalError", "createJob"];
function response() {
  const result = {
    statusCode: 200, body: undefined as unknown,
    status(code: number) { result.statusCode = code; return result; },
    json(body: unknown) { result.body = body; return result; },
  };
  return result;
}
const backend = evaluate<{
  mobileJobCreateSchema: z.ZodType;
  mobileJobQuoteSchema: z.ZodType;
  createJob: (request: { body: unknown }, result: ReturnType<typeof response>) => Promise<unknown>;
}>(declarations(readBackend("server/mobileOperations.ts"), backendNames), {
  z, DomainError, mobileCompany: auth, createJobFromPriceBook: create, getJobDetail: detail,
  projectMobileCompanyJob: () => { throw new Error("Forbidden DTO projection"); },
  domainHttpStatus: () => { throw new Error("Unexpected domain error"); },
  domainMobileCode: () => { throw new Error("Unexpected domain error"); },
  mobileTrpcError: () => null, mobileErrorStatus: () => null,
}, backendNames);

const lines = [{ priceBookItemId: 71, quantity: 2 }, { priceBookItemId: 72, quantity: 1 }];
const base = {
  customerId: 41, lineItems: lines, scheduledStartAt: "2026-12-01T15:00:00.000Z",
  operationKey: "mock-recurring-operation-001", notifyCustomer: false,
};
const rules = [
  { type: "weekly", term: "3_months", dayOfWeek: 2, startDate: "2026-12-01" },
  { type: "biweekly", term: "6_months", dayOfWeek: 2, startDate: "2026-12-01" },
  { type: "monthly_date", term: "1_year", startDate: "2026-12-01" },
  { type: "monthly_ordinal", term: "never_ends", dayOfWeek: 2, ordinal: -1, startDate: "2026-12-01" },
];

beforeEach(() => { vi.clearAllMocks(); });

describe("published 66141 recurring-create contract remains blocked", () => {
  it("is bound to the recorded exact supplied backend revision", () => {
    const revision = JSON.parse(readFileSync(path.join(readinessRoot, "backend-revision.json"), "utf8"));
    expect(revision.sha).toBe(backendRevision);
  });

  it("control: retains canonical single-Job multiservice intent, durable key and booking OFF", () => {
    const payload = api.createJobSyncCompanyJobPayload(base);
    expect(payload).toEqual(base);
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.lineItems)).toBe(true);
    const { operationKey: _key, ...durable } = base;
    expect(storage.payloadCopy(durable)).toEqual(durable);
  });

  it("control: new customer remains one immutable keyed multiservice request", () => {
    const { customerId: _customerId, ...rest } = base;
    const input = { ...rest, newCustomer: { firstName: "Casey", lastName: "Example" } };
    expect(api.createJobSyncCompanyJobPayload(input)).toEqual(input);
    const { operationKey: _key, ...durable } = input;
    expect(storage.payloadCopy(durable)).toEqual(durable);
  });

  it("control: current backend create accepts a keyed non-recurring multiservice request", () => {
    expect(backend.mobileJobCreateSchema.parse(base)).toEqual(base);
  });

  it.each(rules)("quote supports $type but strict create rejects the exact same rule", recurrence => {
    const quote = backend.mobileJobQuoteSchema.parse({ lineItems: lines, recurrence }) as { recurrence: unknown };
    expect(quote.recurrence).toEqual(recurrence);
    const result = backend.mobileJobCreateSchema.safeParse({ ...base, recurrence });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "unrecognized_keys", keys: ["recurrence"] }),
      ]));
    }
  });

  it.each(rules)("actual create handler rejects $type with no SQL, creation or readback", async recurrence => {
    const res = response();
    await backend.createJob({ body: { ...base, recurrence } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "BAD_REQUEST", message: expect.stringMatching(/recurrence/) } });
    expect(auth).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
  });

  it("current line-item mobile adapter refuses recurrence rather than pretending it is saved", () => {
    expect(() => api.createJobSyncCompanyJobPayload({ ...base, recurrence: rules[0] })).toThrow(/Recurring Job saving is unavailable/);
  });

  it("new-customer adapter also rejects recurrence before an unsupported customer/series request", () => {
    const { customerId: _customerId, ...rest } = base;
    expect(() => api.createJobSyncCompanyJobPayload({ ...rest,
      newCustomer: { firstName: "Casey", lastName: "Example" }, recurrence: rules[0],
    })).toThrow(/Recurring Job saving is unavailable/);
  });

  it("legacy-shaped single-service recurrence is rejected rather than silently discarded", () => {
    expect(() => api.createJobSyncCompanyJobPayload({ customerId: 41, priceBookServiceId: 71,
      scheduledStartAt: base.scheduledStartAt, operationKey: base.operationKey, recurrence: rules[0],
    })).toThrow(/Recurring Job saving is unavailable/);
  });

  it("protected recovery retains frozen valid recurrence intent without enabling unsupported writes", () => {
    const { operationKey: _key, ...durable } = base;
    const payload = storage.payloadCopy({ ...durable, recurrence: rules[0] });
    expect(payload).toMatchObject({ ...durable, recurrence: rules[0] });
    expect(Object.isFrozen(payload.recurrence)).toBe(true);
  });

  it("quote-only support cannot bypass mobile quote intent or response validation", () => {
    expect(normalizeCompanyJobQuoteInput({ lineItems: lines }).lineItems).toEqual(lines);
    expect(() => normalizeCompanyJobQuoteInput({ lineItems: lines, recurrence: rules[0] })).toThrow(/quote fields could not be verified/);
    const quote = {
      lines: [
        { priceBookItemId: 71, name: "First", quantity: 2, unitPrice: 100, lineTotal: 200, durationMinutes: 120, taxable: false, vehiclePriceKey: null },
        { priceBookItemId: 72, name: "Second", quantity: 1, unitPrice: 50, lineTotal: 50, durationMinutes: 60, taxable: false, vehiclePriceKey: null },
      ],
      subtotal: 250, discount: 0, discountKind: null, discountCode: null, taxableSubtotal: 0,
      taxRateBps: 0, tax: 0, total: 250, totalDurationMinutes: 180, recurrence: null,
      persistence: { taxStored: true, note: "Mock server-calculated totals." },
    };
    expect(normalizeCompanyJobQuote(quote, { lineItems: lines })).not.toBeNull();
    expect(normalizeCompanyJobQuote({ ...quote, recurrence: rules[0] }, { lineItems: lines })).toBeNull();
  });

  it("route registration provides create/quote/recovery but no canonical recurring-create route", () => {
    const registrar = declarations(readBackend("server/mobileOperations.ts"), ["registerMobileOperationalRoutes"]);
    expect(registrar).toContain('app.post(`${BASE}/company/jobs`, createJob)');
    expect(registrar).toContain('app.post(`${BASE}/company/jobs/quote`, quoteJob)');
    expect(registrar).toContain('app.get(`${BASE}/company/jobs/operations/:operationKey`, jobCreationOperation)');
    expect(registrar).not.toMatch(/app\.(post|put|patch)\([^\n]*(?:recurr|series)/i);
  });

  it("mobile service has an unused recurrence type, one insert and only a Job operation outcome", () => {
    const source = readBackend("server/jobService.ts");
    expect(source).toContain("recurrence?: MobileJobRecurrenceInput");
    const service = declarations(source, ["createJobFromPriceBook"]);
    expect(service).not.toContain("input.recurrence");
    expect(service).not.toContain("recurringJobSlots");
    expect(service).not.toContain("recurrence_rule_id");
    expect(service.match(/INSERT INTO fs_jobs /g)).toHaveLength(1);
    const recovery = declarations(readBackend("server/jobCreationRecovery.ts"), ["getJobCreationOperation", "operationReplayResult"]);
    expect(recovery).toContain("job_id");
    expect(recovery).not.toMatch(/recurrence_rule_id|seriesId|recurrenceCount/);
  });

  it("existing web model supplies rule/occurrence identity, not mobile durable-series acceptance", () => {
    const web = declarations(readBackend("server/jobService.ts"), ["createJob"]);
    expect(web).toContain("recurringJobSlots(input.recurrence, company.timezone)");
    expect(web).toContain("INSERT INTO fs_service_recurrence_rules");
    expect(web).toContain("recurrence_occurrence_key");
    expect(web).toContain("recurrenceCount: scheduledSlots.length");
    expect(web).not.toContain("operationKey");
    expect(readBackend("shared/jobRecurrence.ts")).toContain("NEVER_ENDING_RECURRENCE_JOB_COUNT = 13");
    expect(readBackend("migrations/20261115_recurring_job_series_identity.sql")).toContain("uq_fs_jobs_company_recurrence_occurrence");
  });
});
