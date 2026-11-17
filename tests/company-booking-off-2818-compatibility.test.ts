import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createJobSyncCompanyJobPayload, type JobSyncCompanyJobCreateInput } from "../lib/jobsync-mobile-api";

// Exact unpublished backend runs only through deny-by-default VM extraction and fake SQL/providers.
// Historical assertions remain separately executable in booking-off-fixtures/original-notify-gates.cjs.
const fixture = createRequire(import.meta.url)("/home/ubuntu/hsc-mobile-backend-compatibility-2818bb72-20261117/booking-off-fixtures/backend-2818bb72-notify.cjs");
const rules = { bookingConfirmation: true, dayBeforeReminder: true, sameDayReminder: true,
  internalUnconfirmedAlert: false, reminderHour: 9, quietHoursStart: 21, quietHoursEnd: 7,
  templates: { bookingConfirmation: "", dayBeforeReminder: "", sameDayReminder: "" } };
const now = new Date("2026-11-30T16:00:00.000Z");
async function savedOff() {
  const h = fixture.createHarness();
  const job = await h.create(fixture.request("existing", "multi", false));
  expect(h.db.state.jobs.get(job.id).customer_notification_enabled).toBe(0);
  expect(h.providerCalls).toHaveLength(0);
  expect(h.reservations).toHaveLength(0);
  return { h, id: job.id };
}

 describe("2818bb72 booking-only OFF: isolated actual source", () => {
  it("denies backend bootstrap, real SQL, communications and provider module loading", () => {
    const h = fixture.createHarness();
    for (const path of ["server/_core/index.ts", "server/index.ts", "server/db.ts", "server/companyCommunicationService.ts", "server/emailAdapter.ts"]) {
      expect(() => h.loadForSafetyTest(path)).toThrow(/not allowlisted/);
    }
    expect(h.providerCalls).toHaveLength(0);
    expect(h.identities.some((entry: { relative: string }) => entry.relative === "server/jobService.ts")).toBe(true);
  });

  for (const selector of ["existing", "new"]) for (const pricing of ["single", "multi"]) for (const preference of ["omitted", true, false]) {
    it(`actual mobile payload/schema/handler: ${selector}/${pricing}/${preference}, persisted preference and same-key replay`, async () => {
      const h = fixture.createHarness();
      const input = createJobSyncCompanyJobPayload(fixture.request(selector, pricing, preference) as JobSyncCompanyJobCreateInput);
      if (preference === "omitted") expect(Object.hasOwn(input, "notifyCustomer")).toBe(false);
      else expect(input.notifyCustomer).toBe(preference);
      expect(h.mobileJobCreateSchema.parse(input).notifyCustomer).toBe(preference !== false);
      const handlers = fixture.handlers(h);
      const response = fixture.response();
      await handlers.createJob({ actor: h.company, body: input }, response);
      expect(response.statusCode).toBe(201);
      expect(response.body.operation).toEqual({ key: input.operationKey, state: "saved", replayed: false });
      const id = response.body.job.id;
      expect(response.body.job.companyId).toBe(h.company.companyId);
      expect(h.db.state.jobs.get(id).customer_notification_enabled).toBe(preference === false ? 0 : 1);
      expect(response.body.job.confirmationCommunication).toMatchObject(preference === false
        ? { status: "suppressed", reason: "operator_opted_out", communicationId: null }
        : { status: "unknown", reason: "not_attempted" });
      // Fake transactional boundary intentionally does not invent canonical provider persistence.
      expect(h.providerCalls).toHaveLength(preference === false ? 0 : 1);
      if (preference !== false) expect(h.db.events.findIndex((e: { kind: string }) => e.kind === "commit"))
        .toBeLessThan(h.db.events.findIndex((e: { kind: string }) => e.kind === "mock-provider"));
      const replay = fixture.response();
      await handlers.createJob({ actor: h.company, body: structuredClone(input) }, replay);
      expect(replay.statusCode).toBe(200);
      expect(replay.body.job.id).toBe(id);
      expect(replay.body.operation.replayed).toBe(true);
      expect(h.db.state.jobs.size).toBe(1);
      expect(h.providerCalls).toHaveLength(preference === false ? 0 : 1);
      expect(h.db.state.customers.size).toBe(selector === "new" ? 2 : 1);
      const operation = fixture.response();
      await handlers.jobCreationOperation({ actor: h.company, params: { operationKey: input.operationKey } }, operation);
      expect(operation.body.operation).toMatchObject({ key: input.operationKey, state: "saved", jobId: id });
      const mismatch = fixture.response();
      await handlers.createJob({ actor: h.company, body: { ...input, notifyCustomer: preference === false } }, mismatch);
      expect(mismatch.statusCode).toBe(409);
      expect(h.db.state.jobs.size).toBe(1);
      expect(h.providerCalls).toHaveLength(preference === false ? 0 : 1);
    });
  }

  it.each([null, "false", 0])("actual REST rejects nonboolean %s before SQL/provider", async preference => {
    const h = fixture.createHarness();
    const response = fixture.response();
    await fixture.handlers(h).createJob({ actor: h.company, body: { ...fixture.request(), notifyCustomer: preference } }, response);
    expect(response.statusCode).toBe(400);
    expect(h.db.sqlCalls).toHaveLength(0);
    expect(h.providerCalls).toHaveLength(0);
  });

  it("ACTIVE REQUIREMENT: initial explicit OFF creates no public/confirmation token", async () => {
    const tokens = [];
    for (const selector of ["existing", "new"]) {
      const h = fixture.createHarness();
      const created = await h.create(fixture.request(selector, "multi", false));
      tokens.push(h.db.state.jobs.get(created.id).public_token);
      expect(h.providerCalls).toHaveLength(0);
      expect(h.reservations).toHaveLength(0);
    }
    // Requirement, NOT expected defect reproduction: 2818 CREATE still generates these tokens.
    expect(tokens.every(token => token === null || token === undefined || token === "")).toBe(true);
  });

  it.each([now, new Date("2026-11-30T04:00:00.000Z")])("stored OFF gates direct/quiet booking before token+reservation/provider at %s", async instant => {
    const { h, id } = await savedOff();
    h.db.state.jobs.get(id).public_token = null;
    const result = await h.sendAppointmentBookingConfirmation(h.db, h.company, id, { rules, now: instant });
    expect(result).toMatchObject({ suppressed: true, reason: "stored_preference_off", sent: false, deferred: false, communicationId: null });
    expect(h.db.state.jobs.get(id).public_token).toBeNull();
    expect(h.db.events.some((e: { kind: string }) => e.kind === "token-update")).toBe(false);
    expect(h.reservations).toHaveLength(0);
    expect(h.providerCalls).toHaveLength(0);
  });

  it("deferred consumer rechecks current stored OFF, cancels due queued booking, retains tenant fence and never retries", async () => {
    const { h, id } = await savedOff();
    h.db.state.jobs.get(id).public_token = null;
    const queued = h.seedQueued(id);
    const foreign = h.seedQueued(id, "appointment_confirmation", 99);
    const result = await h.dispatchDueDeferredAppointmentCommunications(h.db, h.company, { rules, now });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ suppressed: true, reason: "stored_preference_off" });
    expect(queued.state).toBe("cancelled");
    expect(queued.next_attempt_at).toBeNull();
    expect(foreign.state).toBe("queued");
    expect(h.db.state.jobs.get(id).public_token).toBeNull();
    expect(h.reservations).toHaveLength(0);
    expect(h.providerCalls).toHaveLength(0);
    await h.dispatchDueDeferredAppointmentCommunications(h.db, h.company, { rules, now });
    expect(h.providerCalls).toHaveLength(0);
  });

  it("booking ON can create a token and quiet-hours reservation; later stored OFF cancels queued work without dispatch", async () => {
    const h = fixture.createHarness({ bookingConfirmation: false });
    const created = await h.create(fixture.request("existing", "multi", true));
    const job = h.db.state.jobs.get(created.id);
    job.public_token = null;
    const deferred = await h.sendAppointmentBookingConfirmation(h.db, h.company, created.id, { rules, now: new Date("2026-11-30T04:00:00.000Z") });
    expect(deferred).toMatchObject({ deferred: true, reason: "quiet_hours", sent: false });
    expect(job.public_token).toBeTruthy();
    expect(h.reservations).toHaveLength(1);
    expect(h.providerCalls).toHaveLength(0);
    const queued = h.seedQueued(created.id);
    job.customer_notification_enabled = 0;
    const result = await h.dispatchDueDeferredAppointmentCommunications(h.db, h.company, { rules, now });
    expect(result[0]).toMatchObject({ suppressed: true, reason: "stored_preference_off" });
    expect(queued.state).toBe("cancelled");
    expect(h.reservations).toHaveLength(1);
    expect(h.providerCalls).toHaveLength(0);
    expect(h.db.events.filter((e: { kind: string }) => e.kind === "token-update")).toHaveLength(1);
  });

  it("Company booking rule OFF remains independent and stored OFF has explicit precedence when both are OFF", async () => {
    const h = fixture.createHarness({ bookingConfirmation: false });
    const created = await h.create(fixture.request("existing", "multi", true));
    expect(await h.sendAppointmentBookingConfirmation(h.db, h.company, created.id, { rules: { ...rules, bookingConfirmation: false }, now }))
      .toMatchObject({ suppressed: true, reason: "setting_off" });
    h.db.state.jobs.get(created.id).customer_notification_enabled = 0;
    expect(await h.sendAppointmentBookingConfirmation(h.db, h.company, created.id, { rules: { ...rules, bookingConfirmation: false }, now }))
      .toMatchObject({ suppressed: true, reason: "stored_preference_off" });
    expect(h.providerCalls).toHaveLength(0);
    expect(h.reservations).toHaveLength(0);
  });

  it("lost CREATE response recovers stored OFF through GET-only operation/detail without a second Job/provider call", async () => {
    const h = fixture.createHarness();
    const handlers = fixture.handlers(h);
    const input = fixture.request("new", "multi", false);
    await handlers.createJob({ actor: h.company, body: input }, fixture.response());
    const operation = fixture.response();
    await handlers.jobCreationOperation({ actor: h.company, params: { operationKey: input.operationKey } }, operation);
    const detail = await h.getJobDetail(h.db, h.company, operation.body.operation.jobId);
    expect(detail.customer_notification_enabled).toBe(0);
    expect(detail.confirmationCommunication).toMatchObject({ status: "suppressed", reason: "operator_opted_out" });
    expect(h.db.state.jobs.size).toBe(1);
    expect(h.db.state.customers.size).toBe(2);
    expect(h.providerCalls).toHaveLength(0);
  });

  it.each(["owner", "dispatcher"])("%s can invoke exact CREATE and booking gates with complete fake Company authority", async role => {
    const h = fixture.createHarness();
    const context = h.loadForSafetyTest("server/companyContext.ts");
    const actor = context.createCompanyContext({ ...h.company, role });
    const response = fixture.response();
    await fixture.handlers(h).createJob({ actor, body: fixture.request("existing", "multi", false) }, response);
    expect(response.statusCode).toBe(201);
    expect(await h.sendAppointmentBookingConfirmation(h.db, actor, response.body.job.id, { rules, now })).toMatchObject({ reason: "stored_preference_off" });
    expect(h.providerCalls).toHaveLength(0);
  });

  it("technician cannot CREATE or directly dispatch bookings; foreign Company cannot load Job or operation", async () => {
    const { h, id } = await savedOff();
    const context = h.loadForSafetyTest("server/companyContext.ts");
    const technician = context.createCompanyContext({ ...h.company, role: "technician" });
    const response = fixture.response();
    await fixture.handlers(h).createJob({ actor: technician, body: { ...fixture.request(), operationKey: "technician-attempt-2818" } }, response);
    expect(response.statusCode).toBe(403);
    await expect(h.sendAppointmentBookingConfirmation(h.db, technician, id, { rules, now })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreign = context.createCompanyContext({ ...h.company, companyId: 99 });
    expect(await h.sendAppointmentBookingConfirmation(h.db, foreign, id, { rules, now })).toMatchObject({ reason: "job_not_found", suppressed: true });
    expect(await h.recovery.getJobCreationOperation(h.db, foreign, "offline-notify-original-operation")).toBeNull();
    expect(h.db.state.jobs.size).toBe(1);
    expect(h.providerCalls).toHaveLength(0);
  });

  const reminders = [
    ["day-before", "sendAppointmentDayBeforeReminder", "dayBeforeReminder", "appointment_day_before", "2026-11-30T15:00:00.000Z", "2026-11-30T14:59:00.000Z", "2026-12-01T04:00:00.000Z"],
    ["same-day", "sendAppointmentSameDayUnconfirmed", "sameDayReminder", "appointment_same_day_unconfirmed", "2026-12-01T13:00:00.000Z", "2026-12-01T12:59:00.000Z", "2026-12-01T12:00:00.000Z"],
  ];
  for (const [label, method, setting, purpose, due, early, quiet] of reminders) {
    it(`replacement: stored booking OFF still permits eligible ${label} under its separate Company ON rule`, async () => {
      const { h, id } = await savedOff();
      expect(await h[method](h.db, h.company, id, { rules, now: new Date(due) })).toMatchObject({ sent: true, suppressed: false, purpose });
      expect(h.providerCalls).toHaveLength(1);
      expect(h.providerCalls[0].purpose).toBe(purpose);
    });
    it(`replacement: Company ${label} OFF prevents its token, reservation and provider work`, async () => {
      const { h, id } = await savedOff();
      h.db.state.jobs.get(id).public_token = null;
      expect(await h[method](h.db, h.company, id, { rules: { ...rules, [setting]: false }, now: new Date(due) })).toMatchObject({ reason: "setting_off", suppressed: true });
      expect(h.db.state.jobs.get(id).public_token).toBeNull();
      expect(h.providerCalls).toHaveLength(0);
      expect(h.reservations).toHaveLength(0);
    });
    it(`replacement: ${label} timing before its local threshold does not send/reserve`, async () => {
      const { h, id } = await savedOff();
      expect(await h[method](h.db, h.company, id, { rules: { ...rules, quietHoursStart: 23, quietHoursEnd: 0 }, now: new Date(early) })).toMatchObject({ reason: "too_early", suppressed: true });
      expect(h.providerCalls).toHaveLength(0);
      expect(h.reservations).toHaveLength(0);
    });
    it(`replacement: ${label} quiet hours defer to Company-local 07:00 rather than blanket booking opt-out`, async () => {
      const { h, id } = await savedOff();
      expect(await h[method](h.db, h.company, id, { rules, now: new Date(quiet) })).toMatchObject({ deferred: true, reason: "quiet_hours", purpose });
      expect(h.providerCalls).toHaveLength(0);
      expect(h.reservations).toHaveLength(1);
      const sql = h.db.sqlCalls.find((call: { sql: string }) => call.sql.startsWith("UPDATE fs_company_communications SET next_attempt_at"));
      expect(sql.params[0].toISOString()).toBe("2026-12-01T13:00:00.000Z");
    });
    it(`replacement: due deferred ${label} is eligible despite stored booking OFF`, async () => {
      const { h, id } = await savedOff();
      const queued = h.seedQueued(id, purpose);
      const outcomes = await h.dispatchDueDeferredAppointmentCommunications(h.db, h.company, { rules, now: new Date(due) });
      expect(outcomes[0]).toMatchObject({ sent: true, purpose });
      expect(h.providerCalls).toHaveLength(1);
      expect(queued.state).not.toBe("cancelled");
      // Fake dispatch boundary records call only, not a claim about real outbox transition/delivery.
    });
  }
});
