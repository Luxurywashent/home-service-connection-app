import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { companyJobConfirmationMessage, normalizeCompanyJobConfirmation } from "../lib/company-job-confirmation";

// Exact target declarations execute in a deny-by-default VM: SQL, provider,
// native storage, authentication and quote are isolated in-memory doubles.
const require = createRequire(import.meta.url);
const fixture = require("/home/ubuntu/hsc-mobile-752ccca3-compatibility-20261117/confirmation-fixtures/backend-confirmation-752.cjs");
const { backend, mobile, request } = fixture;
const wire = (status: string, communicationId: number | null = 701, reason: string | null = null) => ({
  status, communicationId, recipientEmail: communicationId ? "private@example.test" : null,
  reason, errorCode: null, errorMessage: null,
});
afterAll(() => writeFileSync("/home/ubuntu/hsc-mobile-752ccca3-compatibility-20261117/confirmation-fixtures/source-identities.json",
  JSON.stringify({ backend: fixture.B, mobile: fixture.M, sha256: Object.fromEntries(fixture.identities) }, null, 2) + "\n"));

describe("target confirmation wire compatibility without invented binding", () => {
  it.each([
    ["provider_accepted", "accepted"], ["delivered", "delivered"], ["failed", "failed"],
    ["queued", "queued"], ["deferred", "deferred"], ["in_progress", "in_progress"],
    ["suppressed", "suppressed"], ["unknown", "unknown"], ["accepted", "accepted"],
  ])("normalizes %s as %s record evidence only", (status, recordStatus) => {
    const input = Object.freeze({ ...wire(status), privateNotes: "secret", logicalSendKey: "invented-binding", operationKey: "invented-operation" });
    const result = normalizeCompanyJobConfirmation(input);
    expect(result).toEqual({ status: "unknown", recordStatus, communicationId: 701, reason: "appointment_binding_unavailable" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/secret|private@example|invented/);
    expect(companyJobConfirmationMessage(true, result)).toContain("Status for this appointment time is unknown.");
    expect(companyJobConfirmationMessage(true, result)).toContain("Do not automatically resend or create another Job.");
  });
  it("distinguishes delivery evidence from provider acceptance and customer confirmation", () => {
    const accepted = companyJobConfirmationMessage(true, normalizeCompanyJobConfirmation(wire("provider_accepted")));
    const delivered = companyJobConfirmationMessage(true, normalizeCompanyJobConfirmation(wire("delivered")));
    expect(accepted).toContain("provider acceptance, not verified delivery");
    expect(delivered).toContain("reports delivery, not customer appointment confirmation");
    expect(delivered).toContain("Status for this appointment time is unknown");
    expect(delivered).not.toMatch(/appointment confirmed|this appointment.*delivered/);
  });
  it.each([undefined, null, [], {}, "sent", wire("delivered", null), wire("provider_accepted", null),
    { ...wire("provider_accepted"), communicationId: "701" }, { ...wire("delivered"), errorMessage: {} },
    wire("already_sent"), wire("future_state")])("malformed %j fails closed", value => {
    expect(normalizeCompanyJobConfirmation(value).status).toBe("unknown");
    expect(normalizeCompanyJobConfirmation(value).recordStatus).toBe("unknown");
  });
  it.each([false, 0])("explicit stored OFF %j establishes no-row suppression", stored => {
    expect(normalizeCompanyJobConfirmation(wire("suppressed", null, "operator_opted_out"), stored)).toMatchObject({ status: "suppressed", reason: "operator_opted_out" });
  });
  it.each([undefined, null, true, 1, "0"])("does not coerce stored %j into OFF", stored => {
    expect(normalizeCompanyJobConfirmation(wire("suppressed", null, "operator_opted_out"), stored).reason).toBe("invalid_outcome");
  });
  it("OFF intent does not claim a historical email was never sent or suppress all reminders", () => {
    const result = normalizeCompanyJobConfirmation(wire("delivered"));
    const message = companyJobConfirmationMessage(false, result);
    expect(message).toContain("Booking confirmation was not requested");
    expect(message).toContain("reminders are separate and follow Company settings");
    expect(message).not.toMatch(/never sent|reports delivery|provider acceptance/);
  });
});

describe("actual 752 CREATE/detail/operation -> authoritative adapter/controller", () => {
  it.each([
    ["accepted", "provider_accepted", "accepted"], ["rejected", "failed", "failed"],
    ["failed", "in_progress", "in_progress"], ["unknown", "in_progress", "in_progress"],
    ["quiet", "deferred", "deferred"], ["queued", "queued", "queued"],
    ["reused", "provider_accepted", "accepted"], ["missing", "unknown", "unknown"], ["setting-off", "unknown", "unknown"],
  ])("%s produces canonical %s and safe %s feedback after refresh", async (mode, rawStatus, recordStatus) => {
    const h = backend(mode);
    let callback = 0;
    const m = mobile(h, { onCreated: async (detail: any, timezone: string) => {
      callback++;
      expect(detail.id).toBe(84); expect(timezone).toBe("America/Chicago");
      expect(detail.confirmationCommunication.recordStatus).toBe(recordStatus);
      return true;
    } });
    expect(await m.controller.submit(m.draft), JSON.stringify(m.controller.getState())).toBe(true);
    expect(callback).toBe(1); expect(h.db.committed).toBe(true); expect(h.db.mutations).toBe(1);
    expect((await h.get("jobDetail", 84)).payload.job.confirmationCommunication.status).toBe(rawStatus);
    const canonical = await m.api.getJobSyncCompanyJobDetail(m.actor.token, 84, 9);
    expect(canonical.confirmationCommunication.recordStatus).toBe(recordStatus);
    expect(m.controller.getState().bookingConfirmationMessage).toBe(companyJobConfirmationMessage(true, canonical.confirmationCommunication));
    expect(JSON.stringify(canonical.confirmationCommunication)).not.toMatch(/private@example|offline@example|FIXTURE_REJECTED|Private mock/);
    expect(await m.controller.submit(m.draft)).toBe(false);
    await m.controller.reconcile(); expect(m.fetchCalls.filter((r: any) => r.method === "POST")).toHaveLength(1);
    expect(h.providerCalls).toHaveLength(["missing", "setting-off", "quiet", "queued", "reused"].includes(mode) ? 0 : 1);
    m.controller.detach();
  });
  it("target delivered readback reaches the actual controller through its canonical refresh callback", async () => {
    const h = backend(), original = h.handle;
    h.handle = async (body: unknown) => { const response = await original(body); h.db.communication.state = "delivered"; h.db.communication.provider_dispatch_state = "delivered"; return response; };
    const m = mobile(h);
    expect(await m.controller.submit(m.draft)).toBe(true);
    expect(m.controller.getState().bookingConfirmationMessage).toContain("reports delivery, not customer appointment confirmation");
    expect(h.providerCalls).toHaveLength(1); m.controller.detach();
  });
  it.each([true, false])("lost response with immutable notify=%s recovers GET-only", async notify => {
    const h = backend("rejected"), original = h.handle;
    h.handle = async (body: unknown) => { await original(body); throw new Error("Offline lost response after commit"); };
    const m = mobile(h);
    expect(await m.controller.submit({ ...m.draft, notifyCustomer: notify })).toBe(false);
    expect(await m.controller.submit({ ...m.draft, notifyCustomer: !notify })).toBe(false);
    expect(await m.controller.reconcile()).toBe(true);
    expect(m.fetchCalls.map((r: any) => r.method)).toEqual(["POST", "GET", "GET"]);
    expect(m.fetchCalls[1].url).toContain(`/operations/${m.key}`);
    expect(m.fetchCalls[0].body.notifyCustomer).toBe(notify);
    expect(m.controller.getState().bookingConfirmationMessage).toContain(notify ? "reports a failure; the Job remains saved" : "was not requested");
    expect(h.providerCalls).toHaveLength(notify ? 1 : 0); expect(h.db.mutations).toBe(1); m.controller.detach();
  });
  it("process restart preserves immutable OFF and only removes intent after real calendar success", async () => {
    const h = backend(), original = h.handle;
    h.handle = async (body: unknown) => { await original(body); throw new Error("Offline lost response"); };
    const m = mobile(h); expect(await m.controller.submit({ ...m.draft, notifyCustomer: false })).toBe(false);
    const saved = await m.store.read(); expect(saved.payload.notifyCustomer).toBe(false); m.controller.detach();
    const recovered = mobile(h, { actor: m.actor, store: m.store, key: m.key, onCreated: async () => false });
    expect(await recovered.controller.reconcile()).toBe(false);
    expect(recovered.controller.getState().phase).toBe("saved");
    expect(recovered.controller.getState().bookingConfirmationMessage).toContain("was not requested");
    expect(await recovered.store.read()).toBeTruthy(); recovered.controller.detach();
    const final = mobile(h, { actor: m.actor, store: m.store, key: m.key });
    expect(await final.controller.reconcile()).toBe(true);
    expect(await final.store.read()).toBeNull();
    expect([...recovered.fetchCalls, ...final.fetchCalls].every((r: any) => r.method === "GET")).toBe(true);
    expect(h.providerCalls).toHaveLength(0); expect(h.reservations).toHaveLength(0); expect(h.db.mutations).toBe(1); final.controller.detach();
  });
  it("default ON and explicit OFF are exact server policy, not inferred from outcome", async () => {
    const h = backend(), body = request("target-default-on-001"); delete body.notifyCustomer;
    expect((await h.handle(body)).status).toBe(201); expect(h.db.job.customer_notification_enabled).toBe(1); expect(h.providerCalls).toHaveLength(1);
    const off = backend(); expect((await off.handle({ ...request("target-explicit-off-001"), notifyCustomer: false })).status).toBe(201);
    expect(off.db.job.customer_notification_enabled).toBe(0); expect(off.providerCalls).toHaveLength(0); expect(off.reservations).toHaveLength(0);
  });
  it.each(["day-before", "same-day"])("stored booking OFF does not disable %s policy", async kind => {
    const h = backend(); await h.handle({ ...request(`target-off-${kind}-001`), notifyCustomer: false });
    h.db.job.scheduled_start_at = new Date(kind === "day-before" ? "2026-11-18T20:00:00Z" : "2026-11-17T20:00:00Z");
    const sender = kind === "day-before" ? h.communication.sendAppointmentDayBeforeReminder : h.communication.sendAppointmentSameDayUnconfirmed;
    const rules = { ...h.rules, internalUnconfirmedAlert: false };
    const outcome = await sender(h.db, h.company, 84, { now: h.now, rules });
    expect(outcome.sent).toBe(true); expect(h.providerCalls).toHaveLength(1);
    expect(outcome.purpose).toBe(kind === "day-before" ? "appointment_day_before" : "appointment_same_day_unconfirmed");
  });
  it("same key replay does not recreate/resend and changing immutable OFF conflicts", async () => {
    const h = backend(), body = { ...request("target-immutable-off-001"), notifyCustomer: false };
    expect((await h.handle(body)).status).toBe(201); expect((await h.handle(body)).status).toBe(200);
    await expect(h.create({ ...body, notifyCustomer: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.db.mutations).toBe(1); expect(h.providerCalls).toHaveLength(0);
  });
  it("readback failure is recoverable without retry CREATE", async () => {
    const h = backend("detail-failed"), m = mobile(h);
    expect(await m.controller.submit(m.draft)).toBe(false); expect(await m.controller.reconcile()).toBe(true);
    expect(m.fetchCalls.map((r: any) => r.method)).toEqual(["POST", "GET", "GET"]); expect(h.providerCalls).toHaveLength(1); m.controller.detach();
  });
  it("unknown operation never proves absence or allows another POST", async () => {
    const h = backend(), m = mobile(h); h.handle = async () => { throw new Error("No response"); };
    expect(await m.controller.submit(m.draft)).toBe(false); expect(await m.controller.reconcile()).toBe(false);
    expect(await m.controller.submit(m.draft)).toBe(false); expect(m.fetchCalls.map((r: any) => r.method)).toEqual(["POST", "GET"]); m.controller.detach();
  });
  it("late callback publication is blocked when the originating focus is lost", async () => {
    const h = backend(), original = h.handle; let current = true, callback = 0;
    h.handle = async (body: unknown) => { const r = await original(body); current = false; return r; };
    const m = mobile(h, { isCurrent: () => current, onCreated: async () => { callback++; return true; } });
    expect(await m.controller.submit(m.draft)).toBe(false); expect(callback).toBe(0);
    expect(m.states.some((s: any) => s.phase === "succeeded")).toBe(false); expect(h.db.mutations).toBe(1); m.controller.detach();
  });
  it("technician/foreign tenant cannot read the manager operation or submit another CREATE", async () => {
    const h = backend(); await h.handle(request("target-authority-001"));
    Object.assign(h.company, h.load("server/companyContext.ts").createCompanyContext({ companyId: 9, userId: 801, role: "technician" }));
    expect((await h.get("jobCreationOperation", "target-authority-001")).status).toBe(403);
    await expect(h.create(request("target-denied-001"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    h.company.companyId = 10; expect((await h.get("jobDetail", 84)).payload.job).toBeUndefined();
  });
  it("outcome SQL failure cannot roll back an already committed Job", async () => {
    const h = backend(); await h.handle(request("target-outcome-read-fail-001")); h.db.outcomeFails = true;
    const r = await h.get("jobDetail", 84); expect(r.status).toBe(200); expect(r.payload.job.id).toBe(84);
    expect(r.payload.job.confirmationCommunication).toMatchObject({ status: "unknown", reason: "outcome_unavailable" });
    expect(h.db.committed).toBe(true);
  });
});

// These are active requirements, not expected failures or defect-acceptance tests.
// Backend edits are forbidden; genuine target gaps must remain visible to parent.
describe("active backend acceptance requirements — no skips or weakened assertions", () => {
  it("latest outcome must be bound to the current appointment, not a previous start", async () => {
    const h = backend(); await h.handle(request("target-current-start-required-001"));
    h.db.job.scheduled_start_at = new Date("2026-12-02T15:00:00Z");
    expect((await h.get("jobDetail", 84)).payload.job.confirmationCommunication.status).not.toBe("provider_accepted");
  });
  it("missing recipient must survive CREATE and durable canonical readback distinctly", async () => {
    const h = backend("missing"); await h.handle(request("target-missing-recipient-required-001"));
    expect((await h.get("jobDetail", 84)).payload.job.confirmationCommunication.reason).toBe("missing_recipient");
  });
  it("suppressed reservation must not become an invented failure", async () => {
    const h = backend(); await h.handle(request("target-suppressed-required-001"));
    Object.assign(h.db.communication, { state: "suppressed", provider_dispatch_state: "pre_provider" });
    expect((await h.get("jobDetail", 84)).payload.job.confirmationCommunication.status).toBe("suppressed");
  });
  it("unsupported state must stay unknown rather than become an invented failure", async () => {
    const h = backend(); await h.handle(request("target-unknown-required-001"));
    Object.assign(h.db.communication, { state: "future_state", provider_dispatch_state: "legacy_unknown" });
    expect((await h.get("jobDetail", 84)).payload.job.confirmationCommunication.status).toBe("unknown");
  });
  it("reused queued reservation must not be labelled already_sent", async () => {
    const h = backend("queued"); await h.create(request("target-queued-required-001"));
    const outcome = fixture.observed.at(-1).outcome;
    expect(outcome.sent).toBe(false); expect(outcome.reason).not.toBe("already_sent");
  });
});

describe("752 real postcommit ledger and fail-closed mobile evidence", () => {
  it("persists reservation, atomic claim, provider boundary, acceptance and audit after Job commit", async () => {
    const h = backend();
    const response = await h.handle(request("confirmation-ledger-752-001"));
    expect(response.status).toBe(201);
    expect(h.db.transactionLog).toEqual(["begin", "commit", "begin", "commit"]);
    expect(h.db.communication).toMatchObject({ state: "provider_accepted", provider_dispatch_state: "provider_accepted", attempt_count: 1 });
    expect(h.db.legacy).toMatchObject({ status: "sent", recipient_email: "offline@example.test" });
    expect(h.db.audits).toHaveLength(1);
    expect(h.db.audits[0][2]).toBe("communication.email_provider_accepted");
    expect(h.providerCalls).toHaveLength(1);
    const statements = h.db.sql.map((entry: { sql: string }) => entry.sql);
    const index = (text: string) => statements.findIndex((sql: string) => sql.startsWith(text));
    expect(index("INSERT INTO fs_jobs ")).toBeLessThan(index("INSERT INTO fs_company_communications"));
    expect(index("INSERT INTO fs_company_communications")).toBeLessThan(index("UPDATE fs_company_communications SET provider_dispatch_state = 'provider_started'"));
    expect(index("UPDATE fs_company_communications SET provider_dispatch_state = 'provider_started'")).toBeLessThan(index("UPDATE fs_company_communications SET state = 'provider_accepted'"));
  });
  it.each(["accepted", "rejected", "quiet", "queued", "missing", "setting-off"])("%s CREATE and operation/detail GET have consistent feedback without another send", async mode => {
    const h = backend(mode);
    const key = `confirmation-projection-752-${mode}`;
    const created = await h.handle(request(key));
    const calls = h.providerCalls.length;
    const operation = await h.get("jobCreationOperation", key);
    const detail = await h.get("jobDetail", 84);
    expect(created.status).toBe(201);
    expect(operation.payload.operation).toMatchObject({ key, state: "saved", jobId: 84 });
    expect(operation.payload.operation).not.toHaveProperty("confirmationCommunication");
    expect(detail.payload.job.confirmationCommunication).toEqual(created.payload.job.confirmationCommunication);
    expect(h.providerCalls).toHaveLength(calls);
    const normalized = normalizeCompanyJobConfirmation(detail.payload.job.confirmationCommunication, detail.payload.job.customer_notification_enabled);
    expect(normalized.status).toBe("unknown");
    expect(companyJobConfirmationMessage(true, normalized)).toContain("Do not automatically resend or create another Job.");
  });
  it("ambiguous provider outcome stays durably held on same-key replay and GET-only restart recovery", async () => {
    const h = backend("unknown");
    const original = h.handle;
    h.handle = async (body: unknown) => { await original(body); throw new Error("Lost postcommit reply"); };
    const m = mobile(h);
    expect(await m.controller.submit(m.draft)).toBe(false);
    expect(h.db.communication.provider_dispatch_state).toBe("provider_unknown");
    expect(h.db.audits[0][2]).toBe("communication.email_ambiguous");
    m.controller.detach();
    const recovered = mobile(h, { actor: m.actor, store: m.store, key: m.key });
    expect(await recovered.controller.reconcile()).toBe(true);
    expect(recovered.fetchCalls.map((call: { method: string }) => call.method)).toEqual(["GET", "GET"]);
    expect(h.providerCalls).toHaveLength(1);
    const replay = await original(m.fetchCalls[0].body);
    expect(replay.status).toBe(200);
    expect(replay.payload.operation.replayed).toBe(true);
    expect(h.providerCalls).toHaveLength(1);
    expect(h.db.mutations).toBe(1);
    recovered.controller.detach();
  });
});
