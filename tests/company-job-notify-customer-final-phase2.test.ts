import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createJobSyncCompanyJobPayload, normalizeCompanyJobPricing, quoteJobSyncCompanyJob,
  type JobSyncCompanyJobCreateInput,
  type JobSyncCompanyJobDetail, type JobSyncNativeSession,
} from "../lib/jobsync-mobile-api";
import { createCompanyCreationStore, type CompanyCreationRecord } from "../lib/company-job-creation-storage";
import { createCompanyJobController, type CompanyCreateJobDraft, type CompanyCreateJobTransport } from "../lib/company-create-job";

// Native adapters are never loaded: actual protected-store logic receives in-memory adapters only.
vi.mock("expo-crypto", () => ({ randomUUID: () => randomUUID(), CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: string, text: string) => createHash("sha256").update(text).digest("hex") }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "offline-device-only",
  getItemAsync: async () => { throw new Error("Inject explicit offline SecureStore adapter"); },
  setItemAsync: async () => { throw new Error("Inject explicit offline SecureStore adapter"); },
  deleteItemAsync: async () => { throw new Error("Inject explicit offline SecureStore adapter"); } }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

const fixture = createRequire(import.meta.url)("/home/ubuntu/hsc-mobile-final-phase2-20261116/notify-fixtures/backend-notify-harness.cjs");
const preferences = ["omitted", true, false] as const;
type Preference = typeof preferences[number];
const modes = ["existing", "new"] as const;
const pricings = ["single", "multi"] as const;
const key = "offline-notify-original-operation";
let sequence = 290000;
function request(mode: typeof modes[number] = "existing", pricing: typeof pricings[number] = "multi", preference: Preference = "omitted"): JobSyncCompanyJobCreateInput {
  return fixture.request(mode, pricing, preference);
}
function nativeStore() {
  const data = new Map<string, string>();
  const adapter = { getItemAsync: async (id: string) => data.get(id) ?? null,
    setItemAsync: async (id: string, value: string) => { data.set(id, value); },
    deleteItemAsync: async (id: string) => { data.delete(id); } };
  const makeStore = () => createCompanyCreationStore({ platform: "ios", secureStore: adapter });
  return { data, store: makeStore(), makeStore };
}
function record(mode: typeof modes[number], preference: Preference, userId: number): CompanyCreationRecord {
  const { operationKey, ...payload } = request(mode, "multi", preference);
  return { version: 1, companyId: 9, userId, operationKey: operationKey!, payload, timezone: "America/Chicago",
    phase: "prepared", jobId: null, createdAt: "2026-11-16T16:00:00.000Z", updatedAt: "2026-11-16T16:00:00.000Z" };
}
function detailFromStoredRows(h: any, jobId: number) {
  // This is an explicit fixture DTO bridge, not a claim to run the full HTTP/detail adapter.
  const job = h.db.state.jobs.get(jobId);
  if (!job || job.company_id !== 9) throw new Error("Offline canonical Job absent");
  const customer = h.db.state.customers.get(job.customer_id);
  const row = { id: job.id, companyId: job.company_id, customerId: job.customer_id,
    priceBookServiceId: h.db.state.lines.find((line: any) => line.job_id === jobId)?.price_book_item_id ?? null,
    assignedUserId: job.assigned_user_id, title: job.title, serviceName: job.service_name, status: job.status,
    scheduledStartAt: job.scheduled_start_at.toISOString(), scheduledEndAt: job.scheduled_end_at.toISOString(),
    amount: job.amount, subtotalAmount: job.subtotal_amount, discountAmount: job.discount_amount,
    taxAmount: job.tax_amount, taxRateBps: job.tax_rate_bps, discountKind: job.discount_kind, discountCode: job.discount_code,
    lineItems: h.db.state.lines.filter((line: any) => line.job_id === jobId).map((line: any) => ({ id: line.id,
      priceBookItemId: line.price_book_item_id, name: line.name, quantity: line.quantity, unitPrice: line.unit_price,
      lineTotal: line.total_price, sortOrder: line.sort_order })),
    customerName: `${customer.first_name} ${customer.last_name}`, photos: [], privateNotes: job.internal_notes,
    updatedAt: job.updated_at.toISOString(), addressLine1: job.address_line1 ?? null,
    city: job.city ?? null, assignedName: null, enRouteAt: null, onSiteAt: null, completedAt: null };
  return { ...row, pricing: normalizeCompanyJobPricing(row)! };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-16T16:00:00.000Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live HTTP forbidden in notification final tests"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("f3576bcb actual create path: offline reproduction, NOT opt-out acceptance", () => {
  it("pins actual source identities and denies backend bootstrap, DB and unreviewed modules", () => {
    const h = fixture.createHarness();
    expect(h.identities.find((row: any) => row.relative === "server/jobService.ts").sha256)
      .toBe("3109a39f9b407a3ba75dcfb8abc00ba13b283a6630acdca5d3bd4150850fd356");
    expect(h.identities.find((row: any) => row.relative === "server/mobileOperations.ts").sha256)
      .toBe("ba30dec038ccbac2fbae8f727709a8a5f297fc595ad067c05289c8fef32c981d");
    for (const module of ["server/_core/index.ts", "server/db.ts", "server/companyCommunicationService.ts", "server/emailAdapter.ts"])
      expect(() => h.loadForSafetyTest(module)).toThrow("not allowlisted");
  });
  for (const mode of modes) for (const pricing of pricings) for (const preference of preferences) {
    it(`${mode} ${pricing} ${preference}: actual INSERT defaults 1 and actual postcommit attempts booking`, async () => {
      const h = fixture.createHarness(); const input = request(mode, pricing, preference);
      expect(h.mobileJobCreateSchema.parse(input).notifyCustomer).toBe(preference !== false);
      const created = await h.create(input);
      const stored = h.db.state.jobs.get(created.id);
      expect(stored.customer_notification_enabled).toBe(1); // Reproduced defect for false, DB default assumption explicit.
      expect(h.db.events.find((event: any) => event.kind === "job-insert").preferenceExplicit).toBe(false);
      expect(h.db.sqlCalls.filter((call: any) => call.sql.startsWith("INSERT INTO fs_jobs"))).toHaveLength(1);
      expect(h.providerCalls).toEqual([expect.objectContaining({ companyId: 9, jobId: created.id,
        customerId: created.customerId, purpose: "appointment_confirmation", afterCommit: true })]);
      expect(h.db.events.findIndex((event: any) => event.kind === "commit"))
        .toBeLessThan(h.db.events.findIndex((event: any) => event.kind === "mock-provider"));
      expect(h.db.state.lines.filter((line: any) => line.job_id === created.id)).toHaveLength(pricing === "multi" ? 2 : 1);
      expect(stored).toMatchObject({ company_id: 9, internal_notes: input.privateNotes, service_notes: input.serviceNotes });
      expect(created).not.toHaveProperty("privateNotes"); expect(created).not.toHaveProperty("internal_notes");
      if (pricing === "multi") expect(created).toMatchObject({ subtotalAmount: 325, discountAmount: 25,
        taxAmount: 30, taxRateBps: 1000, amount: 330, scheduledEndAt: "2026-12-01T17:00:00.000Z" });
      else expect(created).toMatchObject({ amount: 125, taxAmount: 0, scheduledEndAt: "2026-12-01T15:45:00.000Z" });
      expect(h.db.state.customers.size).toBe(mode === "new" ? 2 : 1);
      if (mode === "new") expect(h.db.state.customerAddresses).toHaveLength(1);
    });
  }
  // Expected failures are visible requirement gates, not a claim that opt-out works.
  it.fails("KNOWN BLOCKER requirement: explicit false must transactionally store 0 on actual mobile create", async () => {
    const h = fixture.createHarness(); const created = await h.create(request("new", "multi", false));
    expect(h.db.state.jobs.get(created.id).customer_notification_enabled).toBe(0);
  });
  it.fails("KNOWN BLOCKER requirement: explicit false must suppress booking provider dispatch", async () => {
    const h = fixture.createHarness(); await h.create(request("existing", "multi", false));
    expect(h.providerCalls).toHaveLength(0); expect(h.reservations).toHaveLength(0);
  });
  it("company setting OFF suppresses booking independently, but does not persist the per-Job false", async () => {
    const h = fixture.createHarness({ bookingConfirmation: false }); const created = await h.create(request("existing", "multi", false));
    expect(h.providerCalls).toHaveLength(0); expect(h.reservations).toHaveLength(0);
    expect(h.db.state.jobs.get(created.id).customer_notification_enabled).toBe(1);
  });
  it("quiet hours incorrectly reserve false booking intent instead of suppressing it", async () => {
    const h = fixture.createHarness({ quiet: true }); await h.create(request("new", "multi", false));
    expect(h.providerCalls).toHaveLength(0); expect(h.reservations).toHaveLength(1);
    expect(h.db.events.some((event: any) => event.kind === "deferred")).toBe(true);
  });
  it.each(["lineInsertFails", "commitFails"])("%s rolls back customer/Job/lines/operation before any provider", async failure => {
    const h = fixture.createHarness({ [failure]: true });
    await expect(h.create(request("new", "multi", false))).rejects.toThrow("Offline mock");
    expect(h.db.state.customers.size).toBe(1); expect(h.db.state.jobs.size).toBe(0);
    expect(h.db.state.lines).toHaveLength(0); expect(h.db.state.operations.size).toBe(0);
    expect(h.db.state.customerAddresses).toHaveLength(0); expect(h.providerCalls).toHaveLength(0);
    expect(h.db.events.filter((event: any) => event.kind === "rollback")).toHaveLength(1);
  });
  it("provider failure is contained after commit; same-key replay does not retry notification", async () => {
    const h = fixture.createHarness({ providerFails: true }); const input = request("new", "multi", false);
    const created = await h.create(input); expect(h.db.state.jobs.size).toBe(1); expect(h.fixtureErrors).toHaveLength(1);
    expect(await h.create(input)).toMatchObject({ id: created.id, replayed: true });
    expect(h.providerCalls).toHaveLength(1); expect(h.db.state.customers.size).toBe(2);
  });
  it("actual confirmation consumer ignores even an explicit stored 0; future reminder opt-out is unestablished", async () => {
    const h = fixture.createHarness({ bookingConfirmation: false }); const created = await h.create(request("existing", "multi", false));
    h.db.state.jobs.get(created.id).customer_notification_enabled = 0; // Explicit negative SQL fixture, not real mutation.
    const rules = { bookingConfirmation: true, dayBeforeReminder: true, sameDayReminder: true,
      internalUnconfirmedAlert: false, reminderHour: 9, quietHoursStart: 23, quietHoursEnd: 0,
      templates: { bookingConfirmation: "", dayBeforeReminder: "", sameDayReminder: "" } };
    const outcome = await h.attemptBookingConfirmationAfterCommit(h.db, h.company, created.id, { rules });
    expect(outcome.sent).toBe(true); expect(h.providerCalls).toHaveLength(1);
    const reminder = await h.sendAppointmentDayBeforeReminder(h.db, h.company, created.id,
      { rules, now: new Date("2026-11-30T16:00:00.000Z") });
    expect(reminder.sent).toBe(true); expect(h.providerCalls).toHaveLength(2);
  });
  it("actual canonical getJob reads persisted preference only within signed Company/technician scope", async () => {
    const h = fixture.createHarness(); const created = await h.create(request("new", "multi", false));
    expect(await h.getJob(h.db, h.company, created.id)).toMatchObject({ id: created.id,
      customer_notification_enabled: 1, internal_notes: "Private fixture note", amount: 330 });
    await expect(h.getJob(h.db, { ...h.company, companyId: 10 }, created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(h.getJob(h.db, { ...h.company, role: "technician", userId: 901 }, created.id))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.providerCalls).toHaveLength(1);
  });
});

describe("f3576bcb exact operation-key retries/replay and different-intent conflicts", () => {
  for (const mode of modes) for (const preference of preferences) {
    it(`${mode} ${preference}: repeats replay saved ID without extra customer, INSERT, or booking`, async () => {
      const h = fixture.createHarness(); const input = request(mode, "multi", preference);
      const created = await h.create(input); const sqlCount = h.db.sqlCalls.length;
      for (let retry = 0; retry < 3; retry++) expect(await h.create(structuredClone(input)))
        .toEqual({ id: created.id, replayed: true, operationState: "saved", operationKey: key });
      expect(h.db.sqlCalls.slice(sqlCount).every((call: any) => call.sql.startsWith("SELECT operation_key"))).toBe(true);
      expect(h.db.state.jobs.size).toBe(1); expect(h.db.state.customers.size).toBe(mode === "new" ? 2 : 1);
      expect(h.providerCalls).toHaveLength(1); expect(h.db.events.filter((event: any) => event.kind === "begin")).toHaveLength(1);
      for (const changed of preferences) {
        if (changed === preference || preference !== false && changed !== false) continue; // REST omission normalizes to true.
        await expect(h.create(request(mode, "multi", changed))).rejects.toMatchObject({ code: "CONFLICT" });
      }
      expect(h.db.state.jobs.size).toBe(1); expect(h.providerCalls).toHaveLength(1);
    });
  }
  it("REST default makes omitted and true equivalent; direct service omission remains a distinct fingerprint", async () => {
    const h = fixture.createHarness(); const omitted = request(); const explicit = { ...omitted, notifyCustomer: true };
    expect(h.recovery.jobCreationPayloadFingerprint(h.recovery.operationPayloadForJobCreation(omitted)))
      .not.toBe(h.recovery.jobCreationPayloadFingerprint(h.recovery.operationPayloadForJobCreation(explicit)));
    const created = await h.create(omitted); expect(await h.create(explicit)).toMatchObject({ id: created.id, replayed: true });
    await expect(h.createJobFromPriceBook(h.db, h.company, omitted)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.providerCalls).toHaveLength(1);
  });
  it("pending original operation settles as a saved replay without entering another create transaction", async () => {
    const h = fixture.createHarness(); const input = request("new", "multi", false);
    const payload = h.mobileJobCreateSchema.parse(input);
    const fingerprint = h.recovery.jobCreationPayloadFingerprint(h.recovery.operationPayloadForJobCreation(payload));
    const operation = { company_id: 9, operation_key: key, payload_fingerprint: fingerprint, state: "pending",
      job_id: null as number | null, created_at: new Date("2026-11-16T16:00:00.000Z"), updated_at: new Date("2026-11-16T16:00:00.000Z") };
    h.db.state.operations.set(`9:${key}`, operation);
    const pending = h.create(input);
    await new Promise(resolve => setTimeout(resolve, 1));
    operation.state = "saved"; operation.job_id = 91; // Controlled other-transaction outcome, never a live record.
    expect(await pending).toMatchObject({ id: 91, replayed: true, operationKey: key });
    expect(h.db.events.some((event: any) => event.kind === "begin")).toBe(false);
    expect(h.db.state.customers.size).toBe(1); expect(h.db.state.jobs.size).toBe(0); expect(h.providerCalls).toHaveLength(0);
  });
  it("saved duplicate-key race rolls back this attempt and replays the competing durable result without booking", async () => {
    const h = fixture.createHarness(); const input = request("new", "multi", false);
    const created = await h.create(input); const originalExecute = h.db.execute.bind(h.db);
    let firstLookup = true;
    h.db.execute = async (sql: string, params: unknown[]) => {
      if (firstLookup && sql.startsWith("SELECT operation_key")) { firstLookup = false; return [[], []]; }
      return originalExecute(sql, params);
    };
    expect(await h.create(input)).toMatchObject({ id: created.id, replayed: true, operationKey: key });
    expect(h.db.events.filter((event: any) => event.kind === "rollback")).toHaveLength(1);
    expect(h.db.state.jobs.size).toBe(1); expect(h.db.state.customers.size).toBe(2); expect(h.providerCalls).toHaveLength(1);
  });
  it("Company role and tenant ownership remain required before transactional create", async () => {
    const h = fixture.createHarness();
    await expect(h.create(request(), { ...h.company, role: "technician", permissions: { canManageJobs: false } }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.create(request(), { ...h.company, companyId: 10 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.db.state.jobs.size).toBe(0); expect(h.providerCalls).toHaveLength(0);
  });
});

describe("mobile current source immutable preference, protected restart and quote exclusions", () => {
  for (const mode of modes) for (const preference of preferences) {
    it(`${mode} ${preference}: immutable durable request survives adapter restart, mutation fails closed`, async () => {
      const input = request(mode, "multi", preference); const payload = createJobSyncCompanyJobPayload(input);
      if (preference === "omitted") expect(payload).not.toHaveProperty("notifyCustomer");
      else expect(payload.notifyCustomer).toBe(preference);
      expect(Object.isFrozen(payload)).toBe(true);
      const secured = nativeStore(); const original = record(mode, preference, ++sequence);
      expect(await secured.store.reserve(original)).toBe(true);
      const restarted = secured.makeStore(); const recovered = (await restarted.read(9, original.userId))!;
      expect(recovered.payload).toEqual(original.payload); expect(Object.isFrozen(recovered.payload)).toBe(true);
      for (const changed of preferences) {
        if (changed === preference) continue;
        const changedPayload = { ...recovered.payload }; delete changedPayload.notifyCustomer;
        if (changed !== "omitted") changedPayload.notifyCustomer = changed;
        await expect(restarted.update({ ...recovered, phase: "uncertain", payload: changedPayload })).rejects.toThrow("could not be verified");
      }
      expect((await restarted.read(9, original.userId))!.payload).toEqual(original.payload);
      expect(await restarted.read(10, original.userId)).toBeNull(); expect(await restarted.read(9, original.userId + 1)).toBeNull();
    });
  }
  it.each([null, "false", 0, 1, {}])("invalid notification preference %j rejects before create I/O and protected persistence", async notifyCustomer => {
    expect(() => createJobSyncCompanyJobPayload({ ...request(), notifyCustomer } as JobSyncCompanyJobCreateInput)).toThrow("Notify customer");
    const secured = nativeStore(); const invalid = record("existing", "omitted", ++sequence);
    await expect(secured.store.reserve({ ...invalid, payload: { ...invalid.payload, notifyCustomer } } as CompanyCreationRecord))
      .rejects.toThrow("could not be verified"); expect(secured.data.size).toBe(0);
  });
  it("actual mobile and exact backend quote schemas exclude notify, private notes, customer and operation key", async () => {
    const h = fixture.createHarness(); const input = request();
    for (const excluded of ["notifyCustomer", "privateNotes", "customerId", "operationKey"]) {
      const quote = { lineItems: input.lineItems!, [excluded]: excluded === "notifyCustomer" ? false : input[excluded as keyof typeof input] };
      expect(h.mobileJobQuoteSchema.safeParse(quote).success).toBe(false);
      await expect(quoteJobSyncCompanyJob("offline-token", 9, quote)).rejects.toThrow();
    }
  });
  it.each(modes)("%s false: real mobile controller -> exact backend commit -> lost response -> durable GET-only recovery", async mode => {
    const h = fixture.createHarness(); const secured = nativeStore();
    const signed: JobSyncNativeSession = { token: "offline-notify-no-live-token", portal: "company",
      user: { id: ++sequence, name: "Fixture Owner", role: "owner", email: null },
      company: { id: 9, name: "Offline Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } };
    const input = request(mode, "multi", false);
    const draft: CompanyCreateJobDraft = { ...(mode === "new" ? { newCustomer: input.newCustomer! } : { customerId: 41 }),
      lineItems: input.lineItems, discount: input.discount, date: "2026-12-01", startHour: 9, endHour: 11,
      notifyCustomer: false, privateNotes: input.privateNotes, serviceNotes: input.serviceNotes };
    const quote = vi.fn(async (_token, _company, body) => {
      expect(Object.keys(body).sort()).toEqual(["discount", "lineItems"]);
      return h.loadForSafetyTest("server/mobileJobQuote.ts").quoteMobileJob(h.db, 9, body);
    });
    const create = vi.fn(async (_token, _company, body) => {
      const retained = (await secured.makeStore().read(9, signed.user.id))!;
      expect(retained).toMatchObject({ operationKey: body.operationKey, payload: { notifyCustomer: false } });
      expect(body.notifyCustomer).toBe(false); await h.create(createJobSyncCompanyJobPayload(body));
      throw new Error("Offline simulated response lost AFTER actual commit");
    });
    const api: CompanyCreateJobTransport = {
      session: vi.fn(async () => signed), settings: vi.fn(async () => ({ id: 9, name: "Offline Fixture Company", timezone: "America/Chicago" })),
      priceBook: vi.fn(async () => [{ serviceId: "31", basePrice: 125, vehiclePrices: {} },
        { serviceId: "32", basePrice: 75, vehiclePrices: {} }] as any),
      customer: vi.fn(async (_token, id) => {
        const customer = h.db.state.customers.get(id);
        return { id, companyId: 9, name: `${customer.first_name} ${customer.last_name}`, firstName: customer.first_name,
          lastName: customer.last_name, email: customer.email, phone: null, addressLine1: customer.address_line1 ?? null,
          city: null, region: null, postalCode: null };
      }), quote, create: create as CompanyCreateJobTransport["create"],
      detail: vi.fn(async (_token, id) => detailFromStoredRows(h, id) as JobSyncCompanyJobDetail), jobs: vi.fn(async () => []),
      operation: vi.fn(async (_token, _company, operationKey) => {
        const operation = await h.recovery.getJobCreationOperation(h.db, h.company, operationKey);
        return { key: operationKey, state: operation?.state ?? "unknown", jobId: operation?.jobId ?? null,
          rejectionCode: null, rejectionMessage: null, createdAt: operation?.createdAt ?? null, updatedAt: operation?.updatedAt ?? null };
      }),
    };
    const callback = vi.fn(async () => true); const newKey = vi.fn(() => key);
    const controller = createCompanyJobController({ session: signed, isCurrent: () => true, onState: vi.fn(), onCreated: callback,
      verifyAssignment: async () => true, transport: api, store: secured.store, newOperationKey: newKey });
    expect(await controller.submit(draft)).toBe(false);
    expect(controller.getState().phase).toBe("uncertain"); expect(create).toHaveBeenCalledOnce(); expect(quote).toHaveBeenCalledOnce();
    expect(h.db.state.jobs.size).toBe(1); expect(h.providerCalls).toHaveLength(1); // Known false defect preserved as evidence.
    const original = (await secured.makeStore().read(9, signed.user.id))!;
    expect(original.payload.notifyCustomer).toBe(false); expect(original.operationKey).toBe(key);
    expect(await controller.submit({ ...draft, notifyCustomer: true })).toBe(false); expect(create).toHaveBeenCalledOnce(); controller.detach();
    const restarted = createCompanyJobController({ session: signed, isCurrent: () => true, onState: vi.fn(), onCreated: callback,
      verifyAssignment: async () => true, transport: api, store: secured.makeStore(), newOperationKey: newKey });
    expect(await restarted.restore()).toBe(true);
    expect(api.operation).toHaveBeenCalledWith(signed.token, 9, key); expect(api.detail).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce(); expect(newKey).toHaveBeenCalledOnce(); expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ id: 91, amount: 330,
      pricing: expect.objectContaining({ taxAmount: 30, discountAmount: 25 }) }), "America/Chicago");
    expect(await secured.makeStore().read(9, signed.user.id)).toBeNull(); expect(h.providerCalls).toHaveLength(1);
    restarted.detach();
  });
});
