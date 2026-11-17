import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { companyCalendarSlot } from "../lib/company-calendar";

// Executes pinned backend declarations with isolated SQL/transaction fixtures only.
// No original suites are changed, no backend bootstrap/auth/provider/native imports.
const requireFixture = createRequire(import.meta.url);
const fixture = requireFixture("/home/ubuntu/hsc-mobile-752ccca3-compatibility-20261117/creation-fixtures/source-harness.cjs");
const TOKEN = "offline-752-create-never-live";
const KEY = "hsc-create-752-preservation-original";
const START = "2026-11-20T15:00:00.000Z";
const customer = () => ({ firstName: "Casey", lastName: "Example", email: "casey@example.test", phone: "5551234567",
  addressLine1: "100 Example Street", city: "Example", region: "IL", postalCode: "60601" });
function request(h: any, mode = "existing", flow = "multi") {
  const base: any = { ...h.fixture.input(), operationKey: KEY, notifyCustomer: false };
  if (flow === "single") { delete base.lineItems; delete base.discount; base.priceBookServiceId = 71; delete base.scheduledEndAt; }
  if (mode === "new") { delete base.customerId; base.newCustomer = customer(); }
  return base;
}
function noCreatedRows(h: any) {
  expect(h.state.rows.fs_customers).toHaveLength(1);
  for (const [table, rows] of Object.entries(h.state.rows)) if (table !== "fs_customers") expect(rows).toEqual([]);
  expect(h.state.postCommitCalls).toEqual([]);
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
function runtime(h: any, lostResponse = false) {
  const calls: any[] = [];
  const signed = { token: TOKEN, portal: "company", user: { id: 801, role: "owner", name: "Fixture owner", email: null },
    company: { id: 9, name: "Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } };
  const fetch = vi.fn(async (url: string, init: any) => {
    expect(new URL(url).origin).toBe("https://fixture.invalid");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`); expect(init.cache).toBe("no-store");
    const path = new URL(url).pathname; const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, body });
    let result: any;
    if (path === "/api/mobile/v1/company/jobs" && init.method === "POST") {
      result = await h.create(body);
      if (lostResponse) throw new Error("Controlled response loss AFTER actual transaction committed");
    } else if (path === "/api/mobile/v1/company/jobs/quote" && init.method === "POST") result = await h.quote(body);
    else if (path.startsWith("/api/mobile/v1/company/jobs/operations/") && init.method === "GET") result = await h.operation(decodeURIComponent(path.split("/").at(-1)!));
    else if (/^\/api\/mobile\/v1\/jobs\/\d+$/.test(path) && init.method === "GET") result = await h.detail(Number(path.split("/").at(-1)));
    else if (path === "/api/mobile/v1/company/jobs" && init.method === "GET") result = await h.calendar(new URL(url).searchParams.get("start"), new URL(url).searchParams.get("end"));
    else if (path === "/api/mobile/v1/auth/session" && init.method === "GET") result = { status: 200, body: signed };
    else if (path === "/api/mobile/v1/company/settings" && init.method === "GET") result = { status: 200, body: { company: { id: 9, name: "Fixture Company", timezone: h.company.timezone } } };
    else if (path === "/api/mobile/v1/price-book" && init.method === "GET") result = { status: 200, body: { services: h.state.catalog.map((row: any) => ({ id: row.id, name: row.name, basePrice: row.base_price,
      vehiclePrices: row.pricing_json ?? {}, isActive: true })) } };
    else if (/^\/api\/mobile\/v1\/customers\/\d+$/.test(path) && init.method === "GET") {
      const row = h.state.rows.fs_customers.find((row: any) => row.id === Number(path.split("/").at(-1)) && row.company_id === 9);
      if (!row) throw new Error("Unknown fixture customer read");
      // Pure profile fixture from actual customer INSERT; not a live Customer GET claim.
      result = { status: 200, body: { customer: { id: row.id, companyId: row.company_id, firstName: row.first_name,
        lastName: row.last_name, email: row.email, phone: row.phone, addressLine1: row.address_line1, city: row.city, region: row.region, postalCode: row.postal_code } } };
    } else throw new Error(`Unconfigured fixture request: ${init.method} ${path}`);
    return response(result.body, result.status);
  });
  return { ...fixture.mobile(fetch), fetch, calls, signed };
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Global network forbidden"); })));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("752 canonical ordinary Company CREATE preservation", () => {
  it("pins actual source revision and original untouched historical test identities", () => {
    const identity = fixture.identity();
    expect(identity.revision).toBe("752ccca3edf69ef35ca7b1a470484f3f204f4568");
    expect(identity.suppliedRevision).toBe(identity.revision);
    const source = readFileSync(`${fixture.BACKEND}/server/mobileOperations.ts`, "utf8");
    expect(source).toContain('app.post(`${BASE}/company/jobs`, createJob)');
    expect(source).toContain('app.post(`${BASE}/jobs`, createJob)');
    expect(source).toContain('app.get(`${BASE}/company/jobs/operations/:operationKey`, jobCreationOperation)');
    expect(source).toContain('app.get(`${BASE}/jobs/operations/:operationKey`, jobCreationOperation)');
  });
  for (const mode of ["existing", "new"]) for (const flow of ["single", "multi"]) {
    it(`${mode} ${flow}: actual route/service/transaction -> strict mobile ack/detail/canonical calendar`, async () => {
      const h = fixture.harness(); const rt = runtime(h); const input = request(h, mode, flow);
      const saved = await rt.api.createJobSyncCompanyJob(TOKEN, 9, input);
      expect(saved).toMatchObject({ id: 91, companyId: 9, customerId: mode === "new" ? 42 : 41,
        priceBookServiceId: 71, assignedUserId: 81, amount: flow === "multi" ? 306 : 100,
        operation: { key: KEY, state: "saved", replayed: false } });
      expect(h.state.transactionEvents).toEqual(["begin", "commit", "release"]);
      expect(h.state.rows.fs_customers).toHaveLength(mode === "new" ? 2 : 1);
      expect(h.state.rows.fs_jobs).toHaveLength(1);
      expect(h.state.rows.fs_job_line_items).toHaveLength(flow === "multi" ? 2 : 1);
      const detail = await rt.api.getJobSyncCompanyJobDetail(TOKEN, saved.id, 9);
      const calendar = await rt.api.getJobSyncCompanyJobs(TOKEN, { start: START, end: "2026-11-21T00:00:00.000Z" });
      expect(detail).toMatchObject({ id: saved.id, companyId: 9, customerId: saved.customerId, amount: saved.amount });
      expect(calendar).toHaveLength(1);
      for (const key of ["id", "customerId", "assignedUserId", "scheduledStartAt", "scheduledEndAt", "serviceName", "status", "amount", "customerName", "assignedName", "addressLine1", "city"])
        expect(calendar[0][key]).toEqual(saved[key]);
      expect(companyCalendarSlot(calendar[0].scheduledStartAt, calendar[0].scheduledEndAt, h.company.timezone)).toEqual({ date: "2026-11-20", startHour: 9, endHour: flow === "multi" ? 12 : 10 });
      expect(h.state.postCommitCalls).toEqual([]);
      expect(h.state.rows.fs_jobs[0]).toMatchObject({ recurrence_rule_id: null, recurrence_occurrence_number: null,
        customer_notification_enabled: 0, tax_amount: flow === "multi" ? 18 : 0, tax_rate_bps: flow === "multi" ? 1000 : 0 });
      if (flow === "multi") expect(saved.pricing).toEqual({ lineItems: h.fixture.job().lineItems,
        subtotalAmount: 320, discountAmount: 32, taxAmount: 18, taxRateBps: 1000, discountKind: "percent", discountCode: "SAVE", totalAmount: 306 });
      else expect(h.state.rows.fs_job_line_items[0]).toMatchObject({ price_book_item_id: 71, quantity: 1, unit_price: 100, total_price: 100, sort_order: 0 });
    });
    it(`${mode} ${flow}: same original operation key replays 200 without customer/job/line/assignment duplication`, async () => {
      const h = fixture.harness(); const input = request(h, mode, flow);
      const first = await h.create(input); expect(first.status).toBe(201);
      const records = structuredClone(h.state.rows); const events = [...h.state.transactionEvents];
      const replay = await h.create(structuredClone(input));
      expect(replay.status).toBe(200);
      expect(replay.body.operation).toEqual({ key: KEY, state: "saved", replayed: true });
      expect(replay.body.job).toEqual(first.body.job);
      expect(h.state.rows).toEqual(records); expect(h.state.transactionEvents).toEqual(events);
      const rt = runtime(h);
      expect(await rt.api.createJobSyncCompanyJob(TOKEN, 9, input)).toMatchObject({ id: 91,
        operation: { key: KEY, state: "saved", replayed: true } });
      expect(rt.fetch).toHaveBeenCalledOnce(); expect(h.state.rows).toEqual(records);
    });
  }
  it("legacy existing one-service unkeyed request preserves catalog price/default duration and operation null", async () => {
    const h = fixture.harness(); const input = request(h, "existing", "single"); delete input.operationKey;
    const raw = await h.create(input); expect(raw.status).toBe(201); expect(raw.body.operation).toBeNull();
    expect(raw.body.job).toMatchObject({ amount: 100, priceBookServiceId: 71, scheduledEndAt: "2026-11-20T16:00:00.000Z" });
    expect(h.state.operations.size).toBe(0);
  });
  it("server mixed taxable quantities/percent discount match the existing quote structure and durable fiscal columns", async () => {
    const h = fixture.harness(); const input = request(h, "new");
    const quote = await h.quote({ lineItems: input.lineItems, discount: input.discount });
    expect(quote.status).toBe(200); expect(quote.body.quote).toEqual({ ...h.fixture.quote(), persistence: {
      taxStored: true, note: "Job creation persists the server-calculated tax amount and rate alongside the subtotal, discount, total, and service lines." } });
    const saved = await h.create(input); expect(saved.status).toBe(201);
    expect(h.state.rows.fs_jobs[0]).toMatchObject({ subtotal_amount: 320, discount_amount: 32, discount_kind: "percent",
      discount_code: "SAVE", tax_amount: 18, tax_rate_bps: 1000, amount: 306 });
    expect(saved.body.job).toMatchObject({ subtotalAmount: 320, discountAmount: 32, taxAmount: 18,
      taxRateBps: 1000, taxKnown: true, discountKind: "percent", discountCode: "SAVE", amount: 306 });
  });
  it.each(["flat", "percent"])("%s discount and changed catalog/tax are recomputed by actual server quote, not a quote echo", async kind => {
    const h = fixture.harness(); const input = request(h, "new"); input.discount = { kind, value: 10, code: "SERVER" };
    const before = await h.quote({ lineItems: input.lineItems, discount: input.discount });
    h.state.catalog[0].pricing_json.standard = 111.25; h.state.taxRateBps = 725;
    const canonical = await h.quote({ lineItems: input.lineItems, discount: input.discount });
    expect(canonical.body.quote.total).not.toBe(before.body.quote.total);
    const saved = await h.create(input); expect(saved.status).toBe(201);
    const q = canonical.body.quote;
    expect(saved.body.job).toMatchObject({ amount: q.total, subtotalAmount: q.subtotal, discountAmount: q.discount,
      taxAmount: q.tax, taxRateBps: q.taxRateBps, discountKind: q.discountKind, discountCode: q.discountCode });
    expect(saved.body.job.lineItems.map((line: any) => ({ priceBookItemId: line.priceBookItemId, quantity: line.quantity,
      unitPrice: line.unitPrice, lineTotal: line.lineTotal }))).toEqual(q.lines.map((line: any) => ({ priceBookItemId: line.priceBookItemId,
      quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal })));
  });
  it("new customer fields and separate Job address/notes are persisted, not silently dropped", async () => {
    const h = fixture.harness(); const input = { ...request(h, "new"), addressLine1: "200 Job Site", city: "Other Town",
      region: "WI", postalCode: "53001", serviceNotes: "Customer-facing instructions", privateNotes: "Private fixture note" };
    expect((await h.create(input)).status).toBe(201);
    expect(h.state.rows.fs_customers[1]).toMatchObject({ company_id: 9, first_name: "Casey", last_name: "Example",
      email: "casey@example.test", phone: "5551234567", address_line1: "100 Example Street", city: "Example", region: "IL", postal_code: "60601" });
    expect(h.state.rows.fs_customer_addresses).toHaveLength(1);
    expect(h.state.rows.fs_customer_addresses[0]).toMatchObject({ company_id: 9, customer_id: 42, is_primary: 1, address_line1: "100 Example Street" });
    expect(h.state.rows.fs_jobs[0]).toMatchObject({ customer_id: 42, address_line1: "200 Job Site", city: "Other Town", region: "WI",
      postal_code: "53001", service_notes: "Customer-facing instructions", internal_notes: "Private fixture note" });
    const detail = await h.detail(91); expect(detail.body.job).toMatchObject({ addressLine1: "200 Job Site", notes: "Customer-facing instructions", private_notes: "Private fixture note" });
  });
  it("assigned eligibility, staff lock and availability checks precede every new customer/Job write", async () => {
    const h = fixture.harness(); expect((await h.create(request(h, "new"))).status).toBe(201);
    const queries = h.state.queries;
    const lock = queries.findIndex((q: any) => q.sql.includes("SELECT id FROM company_users") && q.sql.includes("FOR UPDATE"));
    const availability = queries.findIndex((q: any) => q.sql.includes("FROM fs_schedule_blocks"));
    const customerInsert = queries.findIndex((q: any) => q.sql.startsWith("INSERT INTO fs_customers"));
    expect(lock).toBeGreaterThan(-1); expect(availability).toBeGreaterThan(lock); expect(customerInsert).toBeGreaterThan(availability);
    expect(queries[lock].inTransaction).toBe(true); expect(queries[availability].params).toEqual([9, 81, "2026-11-20"]);
  });
  it("recurrence passes through the same customer and fiscal transaction without dropping rule or per-occurrence lines", async () => {
    const h = fixture.harness(); const input = { ...request(h, "new"), recurrence: { type: "weekly", term: "1_month", dayOfWeek: 5, startDate: "2026-11-20" } };
    const raw = await h.create(input); expect(raw.status).toBe(201);
    expect(h.state.rows.fs_service_recurrence_rules).toHaveLength(1);
    const rule = h.state.rows.fs_service_recurrence_rules[0]; expect(rule).toMatchObject({ company_id: 9, job_id: 91, cadence: "weekly", weekday: 5, start_time: "09:00", duration_minutes: 180 });
    expect(raw.body.job.recurrence).toMatchObject({ ruleId: rule.id, timezone: "America/Chicago", term: "1_month", neverEnds: false });
    expect(raw.body.job.recurrence.occurrenceJobIds).toEqual(h.state.rows.fs_jobs.map((row: any) => row.id));
    expect(h.state.rows.fs_customers).toHaveLength(2);
    expect(h.state.rows.fs_jobs.length).toBeGreaterThan(1);
    for (const job of h.state.rows.fs_jobs) {
      expect(job).toMatchObject({ customer_id: 42, recurrence_rule_id: rule.id, amount: 306, subtotal_amount: 320,
        discount_amount: 32, tax_amount: 18, tax_rate_bps: 1000 });
      expect(h.state.rows.fs_job_line_items.filter((line: any) => line.job_id === job.id).map((line: any) => line.quantity)).toEqual([2, 1]);
    }
    expect(h.state.transactionEvents).toEqual(["begin", "commit", "release"]);
  });
  it("omitted notifyCustomer defaults ON and only isolated collaborator runs after commit; replay never attempts again", async () => {
    const h = fixture.harness(); const input = request(h); delete input.notifyCustomer;
    expect((await h.create(input)).status).toBe(201);
    expect(h.state.rows.fs_jobs[0].customer_notification_enabled).toBe(1);
    expect(h.state.postCommitCalls).toEqual([91]);
    expect(h.state.transactionEvents).toEqual(["begin", "commit", "release"]);
    expect((await h.create(input)).status).toBe(200); expect(h.state.postCommitCalls).toEqual([91]);
  });
});

describe("752 validation, unavailable staff, conflict and rollback leave no customer or Job duplication", () => {
  const invalid: [string, Record<string, unknown>, number][] = [
    ["both customer selectors", { customerId: 41 }, 400], ["bad customer email", { newCustomer: { ...customer(), email: "bad@" } }, 400],
    ["unknown nested customer tenant", { newCustomer: { ...customer(), companyId: 10 } }, 400],
    ["client price", { amount: 1 }, 400], ["client tax", { taxAmount: 1 }, 400], ["client company", { companyId: 10 }, 400],
    ["zero quantity", { lineItems: [{ priceBookItemId: 71, quantity: 0 }] }, 400],
    ["fractional quantity", { lineItems: [{ priceBookItemId: 71, quantity: 1.5 }] }, 400],
    ["duplicate service", { lineItems: [{ priceBookItemId: 71, quantity: 1 }, { priceBookItemId: 71, quantity: 2 }] }, 400],
    ["inactive/foreign catalog", { lineItems: [{ priceBookItemId: 999, quantity: 1 }] }, 404],
    // Actual domainHttpStatus maps PRECONDITION_FAILED to 409/CONFLICT.
    ["missing selected rate", { lineItems: [{ priceBookItemId: 71, quantity: 1, vehiclePriceKey: "absent" }] }, 409],
    ["percent over 100", { discount: { kind: "percent", value: 101 } }, 400],
    ["mismatched first service", { priceBookServiceId: 72 }, 400],
    ["invalid end", { scheduledEndAt: "2026-11-20T14:00:00.000Z" }, 400],
    ["invalid phone", { newCustomer: { ...customer(), phone: "abc" } }, 400],
    ["missing operation key", { operationKey: undefined }, 400],
  ];
  it.each(invalid)("%s rejects without new records", async (_name, patch, status) => {
    const h = fixture.harness(); const result = await h.create({ ...request(h, "new"), ...patch });
    expect(result.status).toBe(status); noCreatedRows(h); expect(h.state.transactionEvents).not.toContain("commit");
  });
  it.each(["calendar-ineligible", "approved-time-off", "schedule-block"])("%s rejects and rolls back actual keyed CREATE before new customer write", async kind => {
    const h = fixture.harness();
    if (kind === "calendar-ineligible") h.state.eligible = false;
    if (kind === "approved-time-off") h.state.timeOff = [{ company_id: 9, user_id: 81, request_status: "approved", start_date: "2026-11-20", end_date: "2026-11-20" }];
    if (kind === "schedule-block") h.state.blocks = [{ company_id: 9, employee_user_id: 81, block_date: "2026-11-20", start_hour: 10, end_hour: 11 }];
    const raw = await h.create(request(h, "new")); expect(raw.status).toBe(kind === "calendar-ineligible" ? 404 : 409);
    noCreatedRows(h); expect(h.state.transactionEvents).toEqual(["begin", "rollback", "release"]);
    expect(h.state.queries.some((q: any) => q.sql.startsWith("INSERT INTO fs_customers"))).toBe(false);
    expect((await h.operation(KEY)).body.operation).toMatchObject({ key: KEY, state: "rejected", jobId: null });
  });
  it.each(["INSERT INTO fs_customer_addresses", "INSERT INTO fs_jobs", "INSERT INTO fs_job_line_items", "INSERT INTO fs_job_events", "INSERT INTO fs_job_assignments", "UPDATE fs_job_creation_operations SET state = 'saved'"])("failure at %s rolls back customer/address/Job/lines/events/assignment/reservation", async failOn => {
    const h = fixture.harness(); h.state.failOn = failOn;
    const raw = await h.create(request(h, "new")); expect(raw.status).not.toBe(201);
    noCreatedRows(h); expect(h.state.transactionEvents).toEqual(["begin", "rollback", "release"]);
    expect(h.state.operations.size).toBe(0);
  });
  it("durably rejected unavailable request cannot create customer/Job on same-key replay even after availability changes", async () => {
    const h = fixture.harness(); const input = request(h, "new");
    h.state.blocks = [{ company_id: 9, employee_user_id: 81, block_date: "2026-11-20", start_hour: 10, end_hour: 11 }];
    expect((await h.create(input)).status).toBe(409);
    const original = structuredClone(h.state.operations); h.state.blocks = [];
    // Rejected operationReplayResult intentionally returns BAD_REQUEST while GET
    // retains its original CONFLICT rejection; neither permits a same-key create.
    expect((await h.create(input)).status).toBe(400);
    expect(h.state.operations).toEqual(original); noCreatedRows(h);
    expect(h.state.transactionEvents).toEqual(["begin", "rollback", "release"]);
    expect((await h.operation(KEY)).body.operation).toMatchObject({ key: KEY, state: "rejected", jobId: null, rejectionCode: "CONFLICT" });
  });
  it.each(["customer", "quantity", "discount", "schedule", "notes", "notification"])("same original key with changed %s conflicts without overwriting saved identity", async field => {
    const h = fixture.harness(); const input = request(h, "new"); expect((await h.create(input)).status).toBe(201);
    const records = structuredClone(h.state.rows); const op = structuredClone(h.state.operations);
    const changed = structuredClone(input);
    if (field === "customer") changed.newCustomer.email = "other@example.test";
    if (field === "quantity") changed.lineItems[0].quantity = 3;
    if (field === "discount") changed.discount.value = 20;
    if (field === "schedule") changed.scheduledStartAt = "2026-11-20T16:00:00.000Z";
    if (field === "notes") changed.privateNotes = "Changed after dispatch";
    if (field === "notification") changed.notifyCustomer = true;
    expect((await h.create(changed)).status).toBe(409);
    expect(h.state.rows).toEqual(records); expect(h.state.operations).toEqual(op);
    expect((await h.operation(KEY)).body.operation).toMatchObject({ state: "saved", jobId: 91, key: KEY });
    expect(h.state.transactionEvents).toEqual(["begin", "commit", "release"]);
  });
  it("foreign existing customer cannot create or resolve another Company's operation", async () => {
    const h = fixture.harness({ companyId: 10 }); const raw = await h.create(request(h));
    expect(raw.status).toBe(404); noCreatedRows(h);
    const other = fixture.harness(); expect((await other.operation(KEY)).body.operation).toEqual({ key: KEY, state: "unknown", jobId: null });
  });
  it("another signed Company cannot see or replay the saved original key in the same isolated database", async () => {
    const h = fixture.harness(); const input = request(h, "new"); expect((await h.create(input)).status).toBe(201);
    const savedRows = structuredClone(h.state.rows); const original = structuredClone(h.state.operations.get(`9:${KEY}`));
    h.company.companyId = 10;
    expect((await h.operation(KEY)).body.operation).toEqual({ key: KEY, state: "unknown", jobId: null });
    expect((await h.detail(91)).status).toBe(404);
    expect((await h.create(input)).status).toBe(404);
    expect(h.state.rows).toEqual(savedRows); expect(h.state.operations.get(`9:${KEY}`)).toEqual(original);
  });
  it.each(["technician", "no-transaction"])("%s blocks new-customer create and status cannot authorize writes", async mode => {
    const h = fixture.harness(mode === "technician" ? { role: "technician" } : { noConnection: true });
    // Exact DomainError PRECONDITION_FAILED wire status is 409, not 412.
    expect((await h.create(request(h, "new"))).status).toBe(mode === "technician" ? 403 : 409);
    noCreatedRows(h); expect(h.state.transactionEvents).toEqual([]);
    expect((await h.operation(KEY)).status).toBe(mode === "technician" ? 403 : 200);
  });
  it.each(["pending", "unknown"])("%s operation GET remains read-only and cannot be interpreted as absence permitting a fresh key", async state => {
    const h = fixture.harness();
    if (state === "pending") h.state.operations.set(`9:${KEY}`, { operation_key: KEY, payload_fingerprint: "fixture-fingerprint",
      state: "pending", job_id: null, rejection_code: null, rejection_message: null, created_at: null, updated_at: null });
    expect((await h.operation(KEY)).body.operation).toMatchObject({ key: KEY, state, jobId: null });
    expect((await h.operation(KEY)).body.operation).toMatchObject({ key: KEY, state, jobId: null });
    noCreatedRows(h); expect(h.state.transactionEvents).toEqual([]);
    expect(h.state.queries.every((q: any) => q.sql.startsWith("SELECT"))).toBe(true);
  });
});

describe("752 actual committed CREATE lost-response -> protected same-key GET-only recovery", () => {
  it.each(["existing", "new"])("%s immutable multi-service original intent resolves actual saved Job/detail/calendar without a second CREATE", async mode => {
    const h = fixture.harness(); const rt = runtime(h, true);
    const oldFixture = requireFixture("/home/ubuntu/hsc-authoritative-mobile-reconciliation-20261117/company-create-source-harness.cjs");
    const store = oldFixture.memoryStore(); const onCreated = vi.fn(async (detail: any, timezone: string) => {
      const calendar = await rt.api.getJobSyncCompanyJobs(TOKEN, { start: START, end: "2026-11-21T00:00:00.000Z" });
      expect(timezone).toBe("America/Chicago"); expect(calendar.map((job: any) => job.id)).toContain(detail.id); return true;
    });
    const newOperationKey = vi.fn(() => KEY);
    const controller = rt.controller.createCompanyJobController({ session: rt.signed, isCurrent: () => true, store,
      onCreated, onState: vi.fn(), newOperationKey, verifyAssignment: vi.fn(async () => true) });
    const input: any = { ...(mode === "new" ? { newCustomer: customer() } : { customerId: 41 }),
      lineItems: h.fixture.lines(), discount: h.fixture.discount(), assignedEmployeeId: "jobsync-81", date: "2026-11-20",
      startHour: 9, endHour: 12, notifyCustomer: false };
    expect(await controller.submit(input)).toBe(false);
    expect(controller.getState()).toMatchObject({ phase: "uncertain", jobId: null });
    const original = store.value(rt.signed); expect(original).toMatchObject({ operationKey: KEY, phase: "uncertain", jobId: null });
    expect(h.state.rows.fs_jobs).toHaveLength(1); expect(h.state.transactionEvents).toEqual(["begin", "commit", "release"]);
    input.lineItems[0].quantity = 99; input.discount.value = 90; if (input.newCustomer) input.newCustomer.email = "mutated@example.test";
    controller.detach();
    const reopened = rt.controller.createCompanyJobController({ session: rt.signed, isCurrent: () => true, store,
      onCreated, onState: vi.fn(), newOperationKey, verifyAssignment: vi.fn(async () => true) });
    expect(await reopened.restore()).toBe(true);
    expect(reopened.getState()).toMatchObject({ phase: "succeeded", jobId: 91 });
    expect(store.value(rt.signed)).toBeNull(); expect(newOperationKey).toHaveBeenCalledOnce(); expect(onCreated).toHaveBeenCalledOnce();
    const creates = rt.calls.filter((call: any) => call.method === "POST" && call.path === "/api/mobile/v1/company/jobs");
    expect(creates).toHaveLength(1); expect(creates[0].body.operationKey).toBe(KEY);
    expect(creates[0].body.lineItems.map((line: any) => line.quantity)).toEqual([2, 1]);
    expect(creates[0].body.discount.value).toBe(10);
    expect(rt.calls.some((call: any) => call.method === "GET" && call.path.endsWith(`/operations/${KEY}`))).toBe(true);
    expect(h.state.rows.fs_customers).toHaveLength(mode === "new" ? 2 : 1); expect(h.state.rows.fs_jobs).toHaveLength(1);
    reopened.detach();
  });
  it("exports a deterministic exact-source execution manifest for parent evidence", () => {
    fixture.harness(); const identity = fixture.identity();
    expect(Object.keys(identity.hashes)).toEqual(expect.arrayContaining(["server/mobileOperations.ts", "server/jobService.ts", "server/mobileJobQuote.ts",
      "server/customerService.ts", "server/jobCreationRecovery.ts", "server/paymentService.ts", "server/staffAvailability.ts"]));
    writeFileSync(`${fixture.OUT}/creation-fixtures/source-manifest.json`, `${JSON.stringify(identity, null, 2)}\n`);
  });
});
