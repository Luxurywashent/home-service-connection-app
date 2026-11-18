import { readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authority, backendRoot, backendRevision, dates, declarations, fixture, readBackend, response, sourceHashes } from "./recurrence-fixtures/fc3-source-fixture";
import { companyJobRecurrenceCalendarDates, normalizeCompanyJobDurableRecurrenceReadback, normalizeCompanyJobRecurrenceReceipt, verifyCompanyJobDurableRecurrenceReadback, type CompanyJobRecurrenceInput } from "../lib/company-job-recurrence";
import { createCompanyJobController, type CompanyCreateJobTransport } from "../lib/company-create-job";
import { createCompanyCreationStore } from "../lib/company-job-creation-storage";
import { normalizeJobSyncCompanyJobDetail, normalizeCompanyJobQuote, type JobSyncNativeSession, type JobSyncCompanyJobCreateResult } from "../lib/jobsync-mobile-api";
import { companyRecurrenceReleaseReady } from "../lib/company-verified-contract-release";
vi.mock("expo-crypto", () => ({ randomUUID, digestStringAsync: async (_: string, text: string) => createHash("sha256").update(text).digest("hex"), CryptoDigestAlgorithm: { SHA256: "SHA-256" } }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only", getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

const wire = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;
type Row = Record<string, unknown>;
const recurrence = { type: "weekly", term: "1_month", dayOfWeek: 2, startDate: "2026-11-30" };
const request = { customerId: 41, priceBookServiceId: 71, lineItems: [{ priceBookItemId: 71, quantity: 2 }, { priceBookItemId: 72, quantity: 1 }], scheduledStartAt: "2026-12-01T15:00:00.000Z", operationKey: "hsc-fc3-isolated-001", notifyCustomer: false, recurrence };
const evidence: unknown[] = [];
beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Production HTTP forbidden"))));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
afterAll(() => writeFileSync("/home/ubuntu/hsc-mobile-fc3-final-contract-20261117/recurrence-fc3-source-evidence.json", JSON.stringify({ backendRevision, fixtureOnly: true, sourceHashes: Object.fromEntries(sourceHashes), evidence }, null, 2) + "\n"));
async function create(input: Row = request) {
  const fake = fixture(), res = response();
  await fake.routes.createJob({ body: wire(input) }, res);
  expect(res.statusCode).toBe(201);
  evidence.push({ request: input, create: wire(res.body), storedRules: wire(fake.state().rules), storedOperations: wire(fake.state().operations) });
  return { fake, body: wire<{ job: Row }>(res.body) };
}

describe("fc3 exact isolated SQL/provider contract BEFORE mobile integration", () => {
  it("pins the authoritative metadata and extracts only fc3 source", () => {
    expect(JSON.parse(readFileSync(`${backendRoot}/../backend-revision.json`, "utf8")).sha).toBe(backendRevision);
    const source = readBackend("server/mobileOperations.ts");
    expect(createHash("sha256").update(source).digest("hex")).toBe("14d9693b496d9b7d8fe17fc78ffdec599413740347a356061adee5342501fb66");
    expect(createHash("sha256").update(readBackend("server/jobService.ts")).digest("hex")).toBe("99cee58219ffb59c24937ca31fc8f14de6caedd8c66e3371ef17105fd520730c");
    expect(createHash("sha256").update(readBackend("server/jobCreationRecovery.ts")).digest("hex")).toBe("d7c2c9c5dbd34ee539b7c31a0a43e543a701b8623044d5a9f2f1e08ca19ca67f");
    expect(declarations(source, ["registerMobileOperationalRoutes"])).toContain('app.get(`${BASE}/company/jobs/:jobId/recurrence`, jobRecurrenceSeries)');
    expect([...sourceHashes.keys()].every(file => file.startsWith(backendRoot + "/"))).toBe(true);
  });
  it("actual mobile create persists distinct requested date, effective date and original provenance", async () => {
    const { fake, body } = await create();
    expect(fake.state().rules[0]).toMatchObject({ requested_start_date: "2026-11-30", starts_on: "2026-12-01", operation_key: request.operationKey, requested_term: "1_month", creation_timezone: "America/Chicago", initial_occurrence_count: 5, job_id: 501, duration_minutes: 150 });
    expect(body.job.recurrence).toMatchObject({ count: 5, ruleId: 301, occurrenceJobIds: [501, 502, 503, 504, 505] });
    expect(fake.state().jobs).toHaveLength(5); expect(fake.state().lineItems).toHaveLength(10);
    expect(fake.state().jobs.every(row => row.subtotal_amount === 250 && row.discount_amount === 0 && row.tax_amount === 10 && row.amount === 260)).toBe(true);
    expect(fake.connection.commit).toHaveBeenCalled();
  });
  it("requested dates which share a first occurrence now yield different fingerprints and conflict on replay", async () => {
    const { fake } = await create(), before = fake.state().operations[0].payload_fingerprint;
    const res = response();
    await fake.routes.createJob({ body: { ...request, recurrence: { ...recurrence, startDate: "2026-12-01" } } }, res);
    expect(res.statusCode).toBe(409); expect(res.body).toMatchObject({ error: { code: "CONFLICT", message: "This Job creation operation key was already used with a different payload." } });
    const other = await create({ ...request, recurrence: { ...recurrence, startDate: "2026-12-01" } });
    expect(other.fake.state().operations[0].payload_fingerprint).not.toBe(before);
    expect(fake.state().jobs).toHaveLength(5);
  });
  it("canonical GET reads the persisted requested date through the actual source dateOnly helper", async () => {
    const { fake } = await create(), res = response();
    await fake.routes.jobRecurrenceSeries({ params: { jobId: "501" } }, res);
    evidence.push({ canonicalGet: wire(res.body), status: res.statusCode });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ companyId: 9, customerId: 41, jobId: 501, recurrence: { requestedStartDate: "2026-11-30", startsOn: "2026-12-01", anchorJobId: 501, operationKey: request.operationKey, requestedTerm: "1_month", creationTimezone: "America/Chicago" }, verification: { complete: true, expectedOccurrenceCount: 5, actualOccurrenceCount: 5, consistentSnapshot: true } });
    const source = readBackend("server/jobService.ts");
    expect(source).toContain("requestedStartDate: rule.requested_start_date == null ? null : dateOnly(rule.requested_start_date)");
    expect(declarations(source, ["dateOnly"])).toContain('if (value instanceof Date) return value.toISOString().slice(0, 10)');
  });
  it("null provenance GET is readable but still exposes exact subtotal and snapshot gaps", async () => {
    const { fake } = await create(); fake.state().rules[0].requested_start_date = null;
    const res = response(); await fake.routes.jobRecurrenceSeries({ params: { jobId: "501" } }, res);
    expect(res.statusCode).toBe(200);
    const raw = wire<{ recurrence: Row; pricing: Row; verification: Row; occurrences: Row[] }>(res.body);
    expect(raw.recurrence).toMatchObject({ requestedStartDate: null, operationKey: request.operationKey, requestedTerm: "1_month", creationTimezone: "America/Chicago", anchorJobId: 501 });
    expect(raw.pricing).toEqual({ subtotal: 0, discount: 0, total: 260, durationMinutes: 150 });
    expect(raw.verification).toMatchObject({ complete: true, expectedOccurrenceCount: 5, actualOccurrenceCount: 5, consistentSnapshot: true });
    expect(raw.occurrences[0]).not.toHaveProperty("pricing");
    const operation = response(); await fake.routes.jobCreationOperation({ params: { operationKey: request.operationKey } }, operation);
    expect(wire<{ operation: Row }>(operation.body).operation).not.toHaveProperty("payloadFingerprint");
    evidence.push({ negativeNullProvenanceOnly: true, canonicalGet: raw, operationGet: wire(operation.body) });
  });
});

async function canonical(fake: ReturnType<typeof fixture>, jobId = 501) {
  const res = response(); await fake.routes.jobRecurrenceSeries({ params: { jobId: String(jobId) } }, res);
  if (res.statusCode !== 200) throw new Error(JSON.stringify(res.body));
  return wire<unknown>(res.body);
}
const expected = (rule: CompanyJobRecurrenceInput, start = request.scheduledStartAt) => ({ companyId: 9, customerId: 41, jobId: 501, operationKey: request.operationKey, recurrence: rule, timezone: "America/Chicago", scheduledStartAt: start, pricing: { subtotalAmount: 250, discountAmount: 0, totalAmount: 260 } });
let actorId = 291000;
function harness(isolated = true) {
  const fake = fixture(), data = new Map<string, string>();
  const session: JobSyncNativeSession = { token: `fc3-offline-${++actorId}`, portal: "company", user: { id: actorId, role: "owner", name: "Owner", email: null }, company: { id: 9, name: "Company", slug: "offline", logoUrl: null, primaryColor: null, accentColor: null } };
  const store = createCompanyCreationStore({ platform: "ios", secureStore: { getItemAsync: async key => data.get(key) ?? null, setItemAsync: async (key, text) => { data.set(key, text); }, deleteItemAsync: async key => { data.delete(key); } } });
  const remove = vi.spyOn(store, "remove"), onCreated = vi.fn(async () => true);
  const detail: CompanyCreateJobTransport["detail"] = async (_token, id, companyId) => {
    const normalized = normalizeJobSyncCompanyJobDetail({ job: wire(await fake.service.getJobDetail(fake.db, authority(), id)) }, id, companyId);
    if (!normalized) throw new Error("fc3 canonical Job detail failed normalization"); return normalized;
  };
  const api: CompanyCreateJobTransport = {
    ...(isolated ? { recurrenceEnvironment: "isolated-fixture" as const } : {}),
    session: vi.fn(async () => session), settings: vi.fn(async () => ({ id: 9, timezone: "America/Chicago" }) as Awaited<ReturnType<CompanyCreateJobTransport["settings"]>>),
    priceBook: vi.fn(async () => [{ serviceId: "71", basePrice: 100, vehiclePrices: {} }, { serviceId: "72", basePrice: 50, vehiclePrices: {} }] as Awaited<ReturnType<CompanyCreateJobTransport["priceBook"]>>),
    customer: vi.fn(async () => ({ id: 41, companyId: 9 })), jobs: vi.fn(async () => []), detail: vi.fn(detail),
    quote: vi.fn(async (_token, _company, input) => { const res = response(); await fake.routes.quoteJob({ body: input }, res); const quote = normalizeCompanyJobQuote(wire<{ quote: unknown }>(res.body).quote, input); if (!quote) throw new Error("fc3 canonical quote unavailable"); return quote; }),
    create: vi.fn(async (_token, companyId, input) => {
      const res = response(); await fake.routes.createJob({ body: wire(input) }, res);
      if (![200, 201].includes(res.statusCode)) throw new Error(JSON.stringify(res.body));
      const body = wire<{ job: Row; operation: JobSyncCompanyJobCreateResult["operation"] }>(res.body), id = Number(body.job.id);
      const canonicalDetail = await detail("", id, companyId);
      if (typeof canonicalDetail.companyId !== "number" || canonicalDetail.companyId !== companyId) throw new Error("fc3 canonical detail Company identity mismatch");
      return { ...canonicalDetail, companyId: canonicalDetail.companyId, priceBookServiceId: body.job.priceBookServiceId as number | null, operation: body.operation,
        ...(input.recurrence ? { recurrence: normalizeCompanyJobRecurrenceReceipt(body.job.recurrence, input.recurrence, id) } : {}) };
    }),
    operation: vi.fn(async (_token, _company, operationKey) => { const res = response(); await fake.routes.jobCreationOperation({ params: { operationKey } }, res); return wire<{ operation: Awaited<ReturnType<NonNullable<CompanyCreateJobTransport["operation"]>>> }>(res.body).operation; }),
    recurrenceReadback: vi.fn(async (_token, _company, id) => canonical(fake, id)),
  };
  const input = { session, transport: api, store, isCurrent: () => true, verifyAssignment: vi.fn(async () => true), onCreated, onState: vi.fn(), newOperationKey: vi.fn(() => request.operationKey) };
  const controller = createCompanyJobController(input);
  const draft = { customerId: 41, lineItems: wire<typeof request.lineItems>(request.lineItems), date: recurrence.startDate, startHour: 9, recurrence: wire<CompanyJobRecurrenceInput>(recurrence), notifyCustomer: false };
  return { fake, session, store, remove, onCreated, api, input, controller, draft };
}

describe("fc3 exact canonical projection: current facts versus unavailable full authority", () => {
  it.each(["weekly", "biweekly", "monthly_date", "monthly_ordinal"] as const)("reads actual %s provenance, pricing and IDs without request enrichment", async type => {
    const rule: CompanyJobRecurrenceInput = { type, term: "1_month", startDate: "2026-11-30", ...(type !== "monthly_date" ? { dayOfWeek: 2 } : {}), ...(type === "monthly_ordinal" ? { ordinal: -1 as const } : {}) };
    const first = dates.buildStoredRecurrenceRule(rule, rule.startDate).firstDate;
    const fake = fixture({ mysqlDates: true }), res = response();
    await fake.routes.createJob({ body: { ...request, recurrence: rule, scheduledStartAt: `${first}T15:00:00.000Z` } }, res);
    expect(res.statusCode).toBe(201);
    const raw = await canonical(fake), read = normalizeCompanyJobDurableRecurrenceReadback(raw, 501);
    expect(read).toEqual(raw); expect(Object.isFrozen(read.recurrence)).toBe(true); expect(read.occurrences.every(Object.isFrozen)).toBe(true);
    expect(read.recurrence.requestedStartDate).toBe(rule.startDate); expect(read.recurrence.startsOn).toBe(first);
    expect(read.pricing.subtotal).toBe(0); expect(read.pricing.total).toBe(260);
    expect(() => verifyCompanyJobDurableRecurrenceReadback(read, expected(rule, `${first}T15:00:00.000Z`))).toThrow(/fc3 canonical recurrence financial totals/);
    expect(read.occurrences.map(row => row.jobId)).toEqual(fake.state().jobs.map(row => row.id));
  });
  it.each(["1_month", "3_months", "6_months", "1_year", "never_ends"] as const)("retains persisted complete %s count and detects a trailing omission", async term => {
    const rule = { ...recurrence, term }, { fake } = await create({ ...request, recurrence: rule });
    const before = normalizeCompanyJobDurableRecurrenceReadback(await canonical(fake), 501);
    expect(before.verification.expectedOccurrenceCount).toBe(fake.state().rules[0].initial_occurrence_count);
    expect(before.verification.complete).toBe(true);
    if (term === "never_ends") expect(before.occurrences).toHaveLength(13);
    fake.state().jobs.pop();
    const after = normalizeCompanyJobDurableRecurrenceReadback(await canonical(fake), 501);
    expect(after.verification.complete).toBe(false); expect(after.verification.expectedOccurrenceCount).toBe(before.occurrences.length);
    expect(after.verification.missingOccurrenceNumbers).toEqual([before.occurrences.length - 1]);
  });
  it.each(["null", "changed", "undefined", "invalid", "accessor", "wrapper", "echo", "sparse", "duplicate", "wrongKey"])("never synthesizes requested date or row identity for %s input", async kind => {
    const { fake } = await create(), raw = wire<{ recurrence: Row; occurrences: Row[] }>(await canonical(fake));
    if (kind === "null" || kind === "changed") {
      raw.recurrence.requestedStartDate = kind === "null" ? null : "2026-12-01";
      expect(() => verifyCompanyJobDurableRecurrenceReadback(normalizeCompanyJobDurableRecurrenceReadback(raw, 501), expected(recurrence as CompanyJobRecurrenceInput))).toThrow(/requestedStartDate/); return;
    }
    if (kind === "undefined") raw.recurrence.requestedStartDate = undefined;
    if (kind === "invalid") raw.recurrence.requestedStartDate = "2026-02-30";
    if (kind === "accessor") Object.defineProperty(raw.recurrence, "requestedStartDate", { enumerable: true, get: () => { throw new Error("Getter must not run"); } });
    if (kind === "echo") raw.recurrence.startDate = recurrence.startDate;
    if (kind === "sparse") delete raw.occurrences[1];
    if (kind === "duplicate") raw.occurrences[1].jobId = raw.occurrences[0].jobId;
    if (kind === "wrongKey") raw.occurrences[0].occurrenceKey = "302:0";
    expect(() => normalizeCompanyJobDurableRecurrenceReadback(kind === "wrapper" ? { series: raw } : raw, 501)).toThrow();
  });
  it("unmodified GET never proves sibling pricing snapshot: a line change is invisible to the DTO", async () => {
    const { fake } = await create(), before = await canonical(fake);
    fake.state().lineItems.find(row => row.job_id === 502)!.unit_price = 101;
    expect(await canonical(fake)).toEqual(before);
    const res = response(); await fake.routes.jobCreationOperation({ params: { operationKey: request.operationKey } }, res);
    expect(wire<{ operation: Row }>(res.body).operation).not.toHaveProperty("payloadFingerprint");
  });
  it("negative hardening only: financial repair-shaped JSON cannot bypass the missing fingerprint/snapshot authority", async () => {
    const { fake } = await create(), raw = wire<{ pricing: Row }>(await canonical(fake));
    raw.pricing.subtotal = 250; // Deliberately fabricated negative input; never a positive fc3 fixture.
    expect(() => verifyCompanyJobDurableRecurrenceReadback(normalizeCompanyJobDurableRecurrenceReadback(raw, 501), expected(recurrence as CompanyJobRecurrenceInput))).toThrow(/does not expose the saved operation payload fingerprint/);
  });
  it("calendar callback targets use canonical instants, not immutable requested date", async () => {
    const { fake } = await create(), read = normalizeCompanyJobDurableRecurrenceReadback(await canonical(fake), 501);
    const datesRead = companyJobRecurrenceCalendarDates({ timezone: read.recurrence.creationTimezone!, occurrences: read.occurrences.map(row => ({ id: row.jobId, occurrenceNumber: row.occurrenceNumber!, scheduledStartAt: row.scheduledStartAt!, scheduledEndAt: row.scheduledEndAt! })) });
    expect(datesRead[0]).toBe("2026-12-01"); expect(datesRead[0]).not.toBe(recurrence.startDate);
  });
});

describe("fc3 controller keeps immutable original operation in precise GET-only hold", () => {
  it("one POST, no callback/removal, complete actual readback holds on current financial gap", async () => {
    const h = harness(); const pending = h.controller.submit(h.draft), duplicate = h.controller.submit(h.draft);
    expect(await pending).toBe(false); expect(await duplicate).toBe(false); expect(h.api.create).toHaveBeenCalledTimes(1);
    expect(h.api.recurrenceReadback).toHaveBeenCalledTimes(2); expect(h.controller.getState().detailError).toMatch(/fc3 canonical recurrence financial totals/);
    expect(await h.store.read(9, h.session.user.id)).toMatchObject({ operationKey: request.operationKey, phase: "saved", jobId: 501, recurrenceRuleId: 301, timezone: "America/Chicago", payload: { recurrence, scheduledStartAt: request.scheduledStartAt, lineItems: request.lineItems } });
    expect(h.onCreated).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("lost POST response copies intent before auth and restores exact operation without another POST", async () => {
    const h = harness(), real = h.api.create; let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(h.api.session).mockImplementationOnce(async () => { await hold; return h.session; });
    h.api.create = vi.fn(async (...args: Parameters<CompanyCreateJobTransport["create"]>) => { await real(...args); throw new Error("Response lost after commit"); });
    const pending = h.controller.submit(h.draft); h.draft.recurrence.startDate = "2026-12-01"; h.draft.lineItems[0].quantity = 1; release();
    expect(await pending).toBe(false); expect(h.controller.getState().phase).toBe("uncertain"); h.controller.detach();
    const restarted = createCompanyJobController(h.input); expect(await restarted.restore()).toBe(false);
    expect(h.api.operation).toHaveBeenCalledWith(h.session.token, 9, request.operationKey); expect(h.api.create).toHaveBeenCalledTimes(1);
    expect((await h.store.read(9, h.session.user.id))?.payload.recurrence?.startDate).toBe("2026-11-30");
    expect(h.onCreated).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled(); restarted.detach();
  });
  it.each(["requestedDate", "customer", "incomplete", "version", "fingerprint", "financials", "unassignedAuthority"])("%s mismatch stays locked without local repair or callback", async kind => {
    const h = harness(); await h.controller.submit(h.draft);
    if (kind === "requestedDate") h.fake.state().rules[0].requested_start_date = "2026-12-01";
    if (kind === "customer") h.fake.state().jobs[1].customer_id = 42;
    if (kind === "incomplete") h.fake.state().jobs.pop();
    if (kind === "financials") h.fake.state().lineItems.find(row => row.job_id === 502)!.unit_price = 101;
    if (kind === "unassignedAuthority") h.fake.state().jobs[1].assigned_user_id = 8;
    if (kind === "version") { const read = h.api.recurrenceReadback!; let calls = 0; h.api.recurrenceReadback = vi.fn(async (...args: Parameters<NonNullable<CompanyCreateJobTransport["recurrenceReadback"]>>) => { const raw = wire<{ recurrence: Row }>(await read(...args)); if (++calls === 2) raw.recurrence.updatedAt = "2026-11-17T12:00:01.000Z"; return raw; }); }
    if (kind === "fingerprint") { h.fake.state().operations[0].payload_fingerprint = "changed-stored-fingerprint"; const read = h.api.recurrenceReadback!; h.api.recurrenceReadback = vi.fn(async (...args: Parameters<NonNullable<CompanyCreateJobTransport["recurrenceReadback"]>>) => { const raw = wire<{ pricing: Row }>(await read(...args)); raw.pricing.subtotal = 250; return raw; }); }
    expect(await h.controller.reconcile()).toBe(false); expect(await h.controller.submit(h.draft)).toBe(false); expect(h.api.create).toHaveBeenCalledTimes(1);
    expect(h.onCreated).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled(); expect((await h.store.read(9, h.session.user.id))?.operationKey).toBe(request.operationKey);
    if (kind === "requestedDate") expect(h.controller.getState().detailError).toMatch(/requestedStartDate/);
    if (kind === "version") expect(h.controller.getState().detailError).toMatch(/snapshot changed/);
    if (kind === "fingerprint") expect(h.controller.getState().detailError).toMatch(/does not expose the saved operation payload fingerprint/);
    h.controller.detach();
  });
  it.each(["unknown", "pending", "unavailable", "conflict"])("%s operation status cannot replace or retry uncertain POST", async kind => {
    const h = harness(); h.api.create = vi.fn(async () => { throw new Error("Lost POST"); }); await h.controller.submit(h.draft);
    h.api.operation = vi.fn(async () => { if (kind === "unavailable") throw new Error("GET unavailable"); return { key: kind === "conflict" ? "wrong-operation-key" : request.operationKey, state: kind === "pending" ? "pending" as const : "unknown" as const, jobId: null, rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null }; });
    expect(await h.controller.reconcile()).toBe(false); expect(await h.controller.submit(h.draft)).toBe(false);
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.input.newOperationKey).toHaveBeenCalledTimes(1); expect(h.onCreated).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("production release stays closed with no quote, creation, operation or recurrence network calls", async () => {
    const h = harness(false); expect(companyRecurrenceReleaseReady()).toBe(false);
    expect(await h.controller.submit(h.draft)).toBe(false); expect(h.api.create).not.toHaveBeenCalled(); expect(h.api.quote).not.toHaveBeenCalled(); expect(h.api.operation).not.toHaveBeenCalled(); expect(h.api.recurrenceReadback).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("one-time multiservice retains server Auto duration and two-argument awaited calendar success", async () => {
    const h = harness(), { recurrence: _recurrence, ...draft } = h.draft; draft.date = "2026-12-01";
    expect(await h.controller.submit(draft)).toBe(true); expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.api.recurrenceReadback).not.toHaveBeenCalled();
    expect(h.onCreated).toHaveBeenCalledTimes(1); expect(h.onCreated.mock.calls[0]).toHaveLength(2); expect(h.remove).toHaveBeenCalledOnce();
    expect(h.controller.getState().phase).toBe("succeeded"); expect(await h.store.read(9, h.session.user.id)).toBeNull(); h.controller.detach();
  });
});
