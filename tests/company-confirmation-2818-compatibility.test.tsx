import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { normalizeCompanyJobConfirmation, companyJobConfirmationMessage } from "../lib/company-job-confirmation";

// Exact read-only TypeScript declarations/modules compiled into a deny-by-default
// VM. Authentication, quote, finance, SQL, native storage and providers are fake.
// Original fixture evidence stays frozen; integration results are reported separately.
const require = createRequire(import.meta.url);
const fixture = require("/home/ubuntu/hsc-mobile-backend-compatibility-2818bb72-20261117/confirmation-fixtures/backend-confirmation.cjs");
const { backend, mobile, request } = fixture;
const wire = (status = "accepted", communicationId: number | null = 701, reason: string | null = null) => ({
  status, communicationId, recipientEmail: communicationId ? "offline@example.test" : null, reason,
  errorCode: null, errorMessage: null,
});

describe("owned normalization and safe saved-Job wording", () => {
  it.each(["accepted", "failed", "suppressed", "queued", "deferred", "in_progress", "unknown"])("preserves %s as record evidence, never certifies current start", status => {
    const result = normalizeCompanyJobConfirmation(wire(status));
    expect(result).toMatchObject({ status: "unknown", recordStatus: status, communicationId: 701, reason: "appointment_binding_unavailable" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(companyJobConfirmationMessage(true, result)).toContain("Status for this appointment time is unknown");
    expect(companyJobConfirmationMessage(true, result)).toContain("Job saved.");
    expect(companyJobConfirmationMessage(true, result)).toContain("Do not automatically resend or create another Job");
  });
  it.each(["queued", "deferred"])("%s is not sent", status => {
    const message = companyJobConfirmationMessage(true, normalizeCompanyJobConfirmation(wire(status)));
    expect(message).toContain("not confirmed sent");
    expect(message).not.toMatch(/already_sent|email sent|email delivered/i);
  });
  it("provider acceptance is not verified delivery or customer confirmation", () => {
    const message = companyJobConfirmationMessage(true, normalizeCompanyJobConfirmation(wire()));
    expect(message).toContain("provider acceptance, not verified delivery");
    expect(message).not.toMatch(/appointment confirmed|email delivered/i);
  });
  it("keeps failure separate from save and does not leak recipient/private provider diagnostics", () => {
    const result = normalizeCompanyJobConfirmation({ ...wire("failed"), errorCode: "secret", errorMessage: "private note/token", recipientEmail: "private@example.test" });
    expect(companyJobConfirmationMessage(true, result)).toContain("reports a failure; the Job remains saved");
    expect(JSON.stringify(result) + companyJobConfirmationMessage(true, result)).not.toMatch(/secret|private note|private@example/);
  });
  it("OFF is intent only and does not imply blanket reminder suppression or certify past sends", () => {
    const message = companyJobConfirmationMessage(false, normalizeCompanyJobConfirmation(wire()));
    expect(message).toContain("Booking confirmation was not requested");
    expect(message).toContain("reminders are separate and follow Company settings");
    expect(message).not.toMatch(/never sent|delivered/);
  });
  it("accepts explicit canonical no-row stored preference suppression", () => {
    expect(normalizeCompanyJobConfirmation(wire("suppressed", null, "operator_opted_out"), 0)).toMatchObject({ status: "suppressed", reason: "operator_opted_out" });
  });
  it.each([undefined, null, 1, "0"])("does not accept no-row suppression without explicit stored OFF (%j)", stored => {
    expect(normalizeCompanyJobConfirmation(wire("suppressed", null, "operator_opted_out"), stored).status).toBe("unknown");
  });
  it.each(["not_attempted", "outcome_unavailable"])("keeps canonical no-row %s unknown", reason => {
    expect(normalizeCompanyJobConfirmation(wire("unknown", null, reason))).toMatchObject({ status: "unknown", recordStatus: "unknown", reason });
  });
  it.each([undefined, null, {}, [], true, "sent", { ...wire(), status: "delivered" }, { ...wire(), status: "already_sent" },
    { ...wire(), communicationId: "701" }, { ...wire(), communicationId: 0 }, { ...wire(), errorMessage: {} },
    { ...wire(), recipientEmail: undefined }, wire("accepted", null), wire("suppressed", null, "setting_off")])("malformed/unsupported %j never becomes success", value => {
    expect(normalizeCompanyJobConfirmation(value).status).toBe("unknown");
  });
  it("does not mutate wire or reflect extraneous secrets", () => {
    const input = Object.freeze({ ...wire(), privateNotes: "DO NOT EXPOSE", logicalSendKey: "invented-binding" });
    expect(normalizeCompanyJobConfirmation(input).status).toBe("unknown");
    expect(JSON.stringify(normalizeCompanyJobConfirmation(input))).not.toContain("DO NOT EXPOSE");
  });
});

describe("actual 2818 handlers/services -> current mobile adapter/controller", () => {
  it.each([
    ["accepted", "accepted"], ["rejected", "failed"], ["failed", "in_progress"], ["missing", "unknown"],
    ["setting-off", "unknown"], ["unknown", "in_progress"], ["quiet", "deferred"], ["queued", "queued"], ["reused", "accepted"],
  ])("%s: one POST, saved canonical Job, truthful owned record helper (%s)", async (mode, status) => {
    const h = backend(mode), m = mobile(h);
    expect(await m.controller.submit(m.draft), JSON.stringify(m.controller.getState())).toBe(true);
    expect(m.controller.getState().phase).toBe("succeeded");
    expect(h.db.committed).toBe(true); expect(h.db.mutations).toBe(1);
    const r = await h.get("jobDetail", 84);
    expect(r.status).toBe(200); expect(r.payload.job.confirmationCommunication.status).toBe(status);
    const normalized = normalizeCompanyJobConfirmation(r.payload.job.confirmationCommunication);
    expect(normalized).toEqual({ status: "unknown", recordStatus: status,
      communicationId: r.payload.job.confirmationCommunication.communicationId,
      reason: ["missing", "setting-off"].includes(mode) ? "not_attempted" : "appointment_binding_unavailable" });
    expect(companyJobConfirmationMessage(true, normalized)).toContain("Job saved");
    const detail = await m.api.getJobSyncCompanyJobDetail(m.actor.token, 84, 9);
    expect(detail.confirmationCommunication).toEqual(normalized);
    expect(Object.isFrozen(detail.confirmationCommunication)).toBe(true);
    expect(detail.confirmationCommunication).not.toHaveProperty("recipientEmail");
    expect(detail.confirmationCommunication).not.toHaveProperty("errorCode");
    expect(detail.confirmationCommunication).not.toHaveProperty("errorMessage");
    const message = m.controller.getState().bookingConfirmationMessage;
    expect(message).toBe(companyJobConfirmationMessage(true, normalized));
    if (normalized.communicationId !== null) expect(message).toContain("Status for this appointment time is unknown.");
    if (status === "accepted") expect(message).toContain("provider acceptance, not verified delivery");
    if (status === "failed") expect(message).toContain("reports a failure; the Job remains saved");
    if (["queued", "deferred"].includes(status)) expect(message).toContain("not confirmed sent");
    expect(JSON.stringify(detail.confirmationCommunication) + message).not.toMatch(/offline@example|FIXTURE_REJECTED|Private mock/);
    expect(await m.controller.submit(m.draft)).toBe(false);
    await m.controller.reconcile();
    expect(m.fetchCalls.filter((r: {method:string}) => r.method === "POST")).toHaveLength(1);
    expect(h.providerCalls).toHaveLength(["setting-off", "missing", "quiet", "queued", "reused"].includes(mode) ? 0 : 1);
    m.controller.detach();
  });
  it("lost response after commit: exact-key operation GET then Job GET recover failure, no duplicate or resend", async () => {
    const h = backend("rejected"), originalHandle = h.handle;
    let lose = true;
    h.handle = async (body: unknown) => { const response = await originalHandle(body); if (lose) { lose = false; throw new Error("Lost response after committed Job/provider rejection"); } return response; };
    const m = mobile(h);
    expect(await m.controller.submit(m.draft)).toBe(false); expect(m.controller.getState().phase).toBe("uncertain");
    expect(h.db.committed).toBe(true); expect(await m.controller.submit(m.draft)).toBe(false);
    expect(await m.controller.reconcile()).toBe(true); expect(m.controller.getState().phase).toBe("succeeded");
    expect(m.fetchCalls.map((r: {method:string}) => r.method)).toEqual(["POST", "GET", "GET"]);
    expect(m.fetchCalls[1].url).toContain(`/operations/${m.key}`);
    expect(m.fetchCalls[2].url).toMatch(/\/jobs\/84$/);
    const r = await h.get("jobDetail", 84);
    expect(r.payload.job.confirmationCommunication.status).toBe("failed");
    expect(m.controller.getState().bookingConfirmationMessage).toContain("reports a failure; the Job remains saved");
    expect(m.controller.getState().bookingConfirmationMessage).toContain("Status for this appointment time is unknown.");
    expect(h.db.mutations).toBe(1); expect(h.providerCalls).toHaveLength(1); m.controller.detach();
  });
  it("CREATE detail failure after commit is uncertain, recoverable GET-only", async () => {
    const h = backend("detail-failed"), m = mobile(h);
    expect(await m.controller.submit(m.draft)).toBe(false); expect(m.controller.getState().phase).toBe("uncertain");
    expect(await m.controller.reconcile()).toBe(true);
    expect(h.db.mutations).toBe(1); expect(h.providerCalls).toHaveLength(1);
    expect(m.fetchCalls.map((r: {method:string}) => r.method)).toEqual(["POST", "GET", "GET"]); m.controller.detach();
  });
  it("same-key same intent replay preserves one Job and one provider attempt; changed intent conflicts", async () => {
    const h = backend("accepted"), body = request("same-key-immutable-001");
    expect((await h.handle(body)).status).toBe(201);
    expect((await h.handle(body)).status).toBe(200);
    await expect(h.create({ ...body, notifyCustomer: false })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.db.mutations).toBe(1); expect(h.providerCalls).toHaveLength(1);
  });
  it("unknown operation never authorizes another POST", async () => {
    const h = backend("accepted"), m = mobile(h);
    h.handle = async () => { throw new Error("No usable response"); };
    expect(await m.controller.submit(m.draft)).toBe(false); expect(await m.controller.reconcile()).toBe(false);
    expect(m.controller.getState().phase).toBe("uncertain"); expect(await m.controller.submit(m.draft)).toBe(false);
    expect(m.fetchCalls.map((r: {method:string}) => r.method)).toEqual(["POST", "GET"]); m.controller.detach();
  });
  it("outcome SQL failure never rolls back or loses saved Job", async () => {
    const h = backend("accepted"); await h.handle(request("outcome-read-fail-001")); h.db.outcomeFails = true;
    const r = await h.get("jobDetail", 84);
    expect(r.status).toBe(200); expect(r.payload.job.id).toBe(84);
    expect(r.payload.job.confirmationCommunication).toMatchObject({ status: "unknown", reason: "outcome_unavailable" });
    expect(h.db.committed).toBe(true);
  });
  it("stored explicit OFF produces canonical suppression with no booking provider/reservation", async () => {
    const h = backend(); await h.handle({ ...request("booking-off-001"), notifyCustomer: false });
    const r = await h.get("jobDetail", 84);
    expect(r.payload.job.confirmationCommunication).toMatchObject({status:"suppressed",reason:"operator_opted_out"});
    expect(h.providerCalls).toHaveLength(0); expect(h.reservations).toHaveLength(0);
  });
  it("blur/background/closed sheet during outstanding POST suppresses late publication and duplicate submission", async () => {
    const h = backend(), original = h.handle; let current = true;
    h.handle = async (body: unknown) => { const result = await original(body); current = false; return result; };
    const m = mobile(h, { isCurrent: () => current });
    expect(await m.controller.submit(m.draft)).toBe(false);
    expect(m.states.some((s: {phase:string}) => s.phase === "succeeded")).toBe(false);
    expect(h.db.mutations).toBe(1); expect(m.fetchCalls).toHaveLength(1);
    expect(await m.controller.submit(m.draft)).toBe(false); m.controller.detach();
  });
  it("signed actor change before recovery read cannot expose outcome", async () => {
    const h = backend("detail-failed"); let revoked = false; let m: ReturnType<typeof mobile>;
    m = mobile(h, { session: async () => revoked ? { ...m.actor, user:{...m.actor.user,role:"technician"} } : m.actor });
    expect(await m.controller.submit(m.draft)).toBe(false); const count=m.fetchCalls.length; revoked=true;
    expect(await m.controller.reconcile()).toBe(false); expect(m.fetchCalls).toHaveLength(count); m.controller.detach();
  });
});

describe("canonical Company/Job read authority and exact outcome mapping", () => {
  it.each(["owner", "dispatcher", "technician"])("%s canonical same-Company read; operation is manager only", async role => {
    const h = backend(); await h.handle(request(`authority-${role}-001`));
    Object.assign(h.company, h.load("server/companyContext.ts").createCompanyContext({companyId:9,userId:801,role,timezone:"America/Chicago"}));
    expect((await h.get("jobDetail",84)).status).toBe(200);
    expect((await h.get("jobCreationOperation",`authority-${role}-001`)).status).toBe(role === "technician" ? 403 : 200);
    if(role === "technician") await expect(h.create(request("denied-technician-001"))).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it.each([null, 801, 999])("technician canonical read permits assignment %s, not an email send grant", async assigned => {
    const h=backend(); await h.handle(request(`assignment-${assigned}-001`)); h.db.job.assigned_user_id=assigned;
    Object.assign(h.company,h.load("server/companyContext.ts").createCompanyContext({companyId:9,userId:801,role:"technician"}));
    expect((await h.get("jobDetail",84)).status).toBe(200);
    await expect(h.communication.sendAppointmentBookingConfirmation(h.db,h.company,84)).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("foreign Company/Job cannot establish canonical outcome or operation", async () => {
    const h=backend(); await h.handle(request("tenant-boundary-001")); h.company.companyId=10;
    expect((await h.get("jobDetail",84)).payload.job).toBeUndefined();
    expect((await h.get("jobCreationOperation","tenant-boundary-001")).payload.operation.state).toBe("unknown");
    expect((await h.get("jobDetail",999)).payload.job).toBeUndefined();
  });
  it.each([false, 0, 1, undefined, null])("no-row notification %j exposes exact backend behavior", async notification => {
    const h=backend();
    const r=await h.detailService.latestBookingCommunicationOutcome(h.db,h.company,84,notification);
    expect(r.status).toBe(notification === false || notification === 0 || notification === null ? "suppressed" : "unknown");
  });
  it("stale accepted row actually survives a current start change (defect reproduction, not acceptance)", async () => {
    const h=backend(); await h.handle(request("stale-start-001"));
    const oldKey=h.db.communication.logical_send_key; h.db.job.scheduled_start_at=new Date("2026-12-02T15:00:00.000Z");
    const r=await h.get("jobDetail",84);
    expect(h.db.communication.logical_send_key).toBe(oldKey);
    expect(r.payload.job.confirmationCommunication.status).toBe("accepted");
    expect(normalizeCompanyJobConfirmation(r.payload.job.confirmationCommunication).status).toBe("unknown");
  });
});

describe("active acceptance requirements — failures are open, never expected defects", () => {
  it("OLD GATE 8 REQUIREMENT: saved mobile booking exposes separate email failure in canonical DTO", async () => {
    const h=backend("rejected"), r=await h.handle(request("status-acceptance-check"));
    expect(r.status).toBe(201); expect(h.db.committed).toBe(true);
    // Same failure-visibility requirement using the exact new canonical field,
    // rather than inventing the original gate's communication/notification aliases.
    expect(r.payload.job.confirmationCommunication.status).toBe("failed");
    expect(r.payload.job.confirmationCommunication.errorCode).toBe("FIXTURE_REJECTED");
  });
  it("OLD GATE 9: queued reused communication must not be labelled already_sent", async () => {
    const h=backend("queued"); await h.create(request("queued-safety-check"));
    const outcome=fixture.observed.at(-1).outcome;
    expect(outcome.sent).toBe(false); expect(outcome.reason).not.toBe("already_sent");
  });
  it("canonical latest outcome must be bound to current appointment start", async () => {
    const h=backend(); await h.handle(request("current-start-acceptance-001"));
    h.db.job.scheduled_start_at=new Date("2026-12-02T15:00:00.000Z");
    const r=await h.get("jobDetail",84);
    expect(r.payload.job.confirmationCommunication.status).not.toBe("accepted");
  });
  it("canonical delivered evidence must remain distinct from provider acceptance", async () => {
    const h=backend(); await h.handle(request("delivered-acceptance-001")); h.db.communication.state="delivered";
    const r=await h.get("jobDetail",84); expect(r.payload.job.confirmationCommunication.status).toBe("delivered");
  });
  it("canonical suppressed reservation is not mislabeled failed", async () => {
    const h=backend(); await h.handle(request("suppressed-acceptance-001"));
    Object.assign(h.db.communication,{state:"suppressed",provider_dispatch_state:"pre_provider"});
    expect((await h.get("jobDetail",84)).payload.job.confirmationCommunication.status).toBe("suppressed");
  });
  it("canonical unknown unsupported state stays unknown, not an invented failure", async () => {
    const h=backend(); await h.handle(request("future-state-acceptance-001"));
    Object.assign(h.db.communication,{state:"future_state",provider_dispatch_state:"legacy_unknown"});
    expect((await h.get("jobDetail",84)).payload.job.confirmationCommunication.status).toBe("unknown");
  });
});
