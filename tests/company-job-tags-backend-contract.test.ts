import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pinned archive declarations only: no mobile imports, backend bootstrap or live transport.
const fixtures = "/home/ubuntu/hsc-mobile-job-tags-20261117/permission-fixtures";
const offlineRequire = createRequire(import.meta.url);
const fixture = offlineRequire(`${fixtures}/backend-tag-harness.cjs`);
const notify = offlineRequire(`${fixtures}/reported-notify-harness.cjs`);
const make = (options: Record<string, unknown> = {}) => fixture.createHarness(options);
const roles = ["owner", "dispatcher", "technician"] as const;

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live HTTP forbidden"); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("c5758ae6 exact Job tag source identity and declaration isolation", () => {
  it("pins exact/reported sources, six REST and three RPC declarations; never infers live publication", () => {
    const exact = fixture.source("server/mobileOperations.ts");
    const reported = fixture.source("server/mobileOperations.ts", "reported");
    const tagRoutes = (text: string) => [...text.matchAll(/app\.(get|post|delete)\(`\$\{BASE\}([^`]+tags[^`]*)`/g)]
      .map(match => ({ method: match[1], path: match[2] }));
    expect(tagRoutes(exact)).toHaveLength(6); expect(tagRoutes(reported)).toEqual([]);
    for (const prefix of ["/company/jobs", "/jobs"]) {
      expect(tagRoutes(exact)).toContainEqual({ method: "get", path: `${prefix}/:jobId/tags` });
      expect(tagRoutes(exact)).toContainEqual({ method: "post", path: `${prefix}/:jobId/tags` });
      expect(tagRoutes(exact)).toContainEqual({ method: "delete", path: `${prefix}/:jobId/tags/:tagId` });
    }
    const h = make(); expect(Object.keys(h.rpc).sort()).toEqual(["addTag", "listTags", "removeTag"]);
    for (const name of ["listTags", "addTag", "removeTag"]) {
      expect(fixture.source("server/fieldServiceRouter.ts")).toContain(`${name}: tenantProcedure()`);
      expect(fixture.source("server/fieldServiceRouter.ts", "reported")).not.toContain(`${name}: tenantProcedure()`);
    }
    for (const relative of ["server/jobTagService.ts", "migrations/20261117_company_job_tags.sql"]) {
      expect(existsSync(`${fixture.roots.exact}/${relative}`)).toBe(true);
      expect(existsSync(`${fixture.roots.reported}/${relative}`)).toBe(false);
    }
    for (const relative of ["server/companyContext.ts", "server/jobService.ts", "server/mobileAuth.ts"])
      expect(fixture.source(relative)).toBe(fixture.source(relative, "reported"));
    for (const relative of ["server/_core/index.ts", "server/db.ts", "server/emailAdapter.ts", "server/paymentService.ts", "server/storage.ts"])
      expect(() => h.load(relative)).toThrow("not allowlisted");
  });
  it("requires the additive unique-index migration but does not execute it or embed tags in detail/list", () => {
    const migration = fixture.source("migrations/20261117_company_job_tags.sql");
    expect(fixture.hash(migration)).toBe("e903cd2e5418fcc74a105d66974aed1a9b50c12b08a60cca43969e2ba5c150af");
    expect(migration).toContain("UNIQUE KEY uq_fs_job_tags_company_job_name (company_id, job_id, normalized_name)");
    for (const relative of ["server/jobService.ts", "server/mobileCompanyJobDto.ts"])
      expect(fixture.source(relative)).not.toContain("fs_job_tags");
    const detail = fixture.declarations("server/jobService.ts", ["getJobDetail"]).text;
    expect(detail).toContain("await getJob(db, company, jobId)");
    expect(detail).not.toContain("listJobTags");
  });
});

describe("exact service normalization, canonical persistence and non-idempotent acknowledgments", () => {
  it("uses NFKC, whitespace collapse and en-US lowercase without accent/punctuation stripping", () => {
    const normalize = make().tags.normalizeJobTagName;
    expect(normalize("  Ｐｒｉｏｒｉｔｙ\n\t  Élite!  ")).toEqual({ displayName: "Priority Élite!", normalizedName: "priority élite!" });
    expect(normalize("İ")).toEqual({ displayName: "İ", normalizedName: "i\u0307" });
    expect(normalize("a" + " ".repeat(200) + "b").displayName).toBe("a b");
  });
  it("limits post-normalization UTF-16 units, not grapheme count", () => {
    const normalize = make().tags.normalizeJobTagName;
    expect(normalize("x".repeat(64)).displayName).toHaveLength(64);
    expect(normalize("😀".repeat(32)).displayName).toHaveLength(64);
    for (const value of ["x".repeat(65), "😀".repeat(33)]) expect(() => normalize(value)).toThrow("64 characters");
  });
  it.each([null, undefined, 4, {}, [], "", " \n\t ", "a\u0000b", "a\u007fb"])("rejects invalid name %j", value => {
    expect(() => make().tags.normalizeJobTagName(value)).toThrow();
  });
  it("adds/removes multiple records and canonically rereads authoritative names/order/DTOs", async () => {
    const h = make(), actor = h.actor();
    expect(await h.tags.listJobTags(h.db, actor, 44)).toEqual([]);
    const z = await h.tags.addJobTag(h.db, actor, 44, "  Zeta ");
    const a = await h.tags.addJobTag(h.db, actor, 44, "Ａlpha");
    expect(await h.tags.listJobTags(h.db, actor, 44)).toEqual([a, z]);
    expect(a).toEqual({ id: 32, jobId: 44, displayName: "Alpha", normalizedName: "alpha", createdBy: 801,
      createdAt: "2026-11-17 12:00:00", updatedAt: "2026-11-17 12:00:00" });
    expect(await h.tags.removeJobTag(h.db, actor, 44, a.id)).toEqual({ success: true, tagId: a.id, jobId: 44 });
    expect(await h.tags.listJobTags(h.db, actor, 44)).toEqual([z]);
    await h.tags.removeJobTag(h.db, actor, 44, z.id);
    expect(await h.tags.listJobTags(h.db, actor, 44)).toEqual([]);
  });
  it("preserves SQL-string, Date and null timestamps, without a version/company field", async () => {
    const h = make(); const tag = await h.tags.addJobTag(h.db, h.actor(), 44, "Priority");
    const time = new Date("2026-11-17T12:00:00Z");
    Object.assign(h.db.tags.get(tag.id), { created_at: time, updated_at: null });
    const [read] = await h.tags.listJobTags(h.db, h.actor(), 44);
    expect(read.createdAt).toBe(time); expect(read.updatedAt).toBeNull();
    expect(read).not.toHaveProperty("version"); expect(read).not.toHaveProperty("companyId");
  });
  it("duplicate-key insertion is 409 conflict, not existing-row idempotency; repeat delete is 404", async () => {
    const h = make(); const first = await h.rest("addJobTagRoute", h.actor(), 44, { name: "Priority" });
    expect(await h.rest("addJobTagRoute", h.actor(), 44, { name: "ＰＲＩＯＲＩＴＹ" }))
      .toEqual({ status: 409, body: { error: { code: "CONFLICT", message: "That tag already exists on this Job." } } });
    expect(h.db.tags.size).toBe(1); expect(h.db.tags.get(first.body.tag.id).display_name).toBe("Priority");
    expect((await h.rest("removeJobTagRoute", h.actor(), 44, undefined, first.body.tag.id)).status).toBe(200);
    expect((await h.rest("removeJobTagRoute", h.actor(), 44, undefined, first.body.tag.id)).status).toBe(404);
  });
  it("unique mock constraint settles concurrent normalized adds with one success and one conflict", async () => {
    const h = make();
    const results = await Promise.allSettled([h.tags.addJobTag(h.db, h.actor(), 44, "Priority"), h.tags.addJobTag(h.db, h.actor(), 44, "priority")]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(results.find(row => row.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(h.db.tags.size).toBe(1);
  });
  it("missing insert readback maps precondition failure to mobile 409/CONFLICT without retry", async () => {
    const h = make({ missingReadback: true });
    const reply = await h.rest("addJobTagRoute", h.actor(), 44, { name: "Priority" });
    expect(reply).toMatchObject({ status: 409, body: { error: { code: "CONFLICT" } } });
    expect(h.db.tags.size).toBe(1); // An error acknowledgment need not mean no mutation happened.
    expect(h.db.calls.filter((row: { sql: string }) => row.sql.startsWith("INSERT INTO fs_job_tags"))).toHaveLength(1);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects unsafe/invalid path ID %s", async id => {
    const h = make();
    await expect(h.tags.listJobTags(h.db, h.actor(), id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(h.tags.addJobTag(h.db, h.actor(), id, "Priority")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(h.tags.removeJobTag(h.db, h.actor(), 44, id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.db.tags.size).toBe(0);
  });
  it("binds exact tenant/Job/creator on storage and leaves parent timestamps/events untouched", async () => {
    const h = make(); const before = structuredClone(h.db.jobs.get(44));
    const tag = await h.tags.addJobTag(h.db, h.actor("dispatcher", 812), 44, "Priority");
    await h.tags.listJobTags(h.db, h.actor(), 44); await h.tags.removeJobTag(h.db, h.actor(), 44, tag.id);
    expect(h.db.calls.find((row: { sql: string }) => row.sql.startsWith("INSERT INTO fs_job_tags")).params)
      .toEqual([9, 44, "priority", "Priority", 812]);
    expect(h.db.calls.find((row: { sql: string }) => row.sql.startsWith("DELETE FROM fs_job_tags")).params).toEqual([tag.id, 9, 44]);
    expect(h.db.jobs.get(44)).toEqual(before); expect(h.db.events).toEqual([]); expect(h.effects).toEqual([]);
    expect(h.db.calls.every((row: { sql: string }) => !/UPDATE fs_jobs|fs_job_events|communications|payments/.test(row.sql))).toBe(true);
  });
  it("has no atomic assignment guard: controlled reassignment between check/insert still permits write", async () => {
    const h = make({ reassignAfterAccess: true });
    expect(await h.tags.addJobTag(h.db, h.actor("technician"), 44, "Priority")).toMatchObject({ jobId: 44 });
    expect(h.db.jobs.get(44).assigned_user_id).toBe(902);
    expect(h.db.events).toEqual([]);
    expect(h.db.calls.some((row: { sql: string }) => /FOR UPDATE|expected|version/i.test(row.sql))).toBe(false);
    await expect(h.tags.listJobTags(h.db, h.actor("technician"), 44)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("REST schemas/envelopes, unsupported versions and exact RPC declarations", () => {
  it("executes exact REST handlers and returns 200/201/200 with strict success shapes", async () => {
    const h = make();
    expect(await h.rest("jobTags")).toEqual({ status: 200, body: { tags: [] } });
    const added = await h.rest("addJobTagRoute", h.actor(), 44, { name: " Priority " });
    expect(added.status).toBe(201); expect(Object.keys(added.body)).toEqual(["tag"]);
    expect((await h.rest("jobTags")).body.tags).toEqual([added.body.tag]);
    expect(await h.rest("removeJobTagRoute", h.actor(), 44, undefined, added.body.tag.id))
      .toEqual({ status: 200, body: { success: true, tagId: added.body.tag.id, jobId: 44 } });
  });
  it.each(["companyId", "jobId", "createdBy", "expectedUpdatedAt", "version", "idempotencyKey", "tags"])("strict POST rejects invented %s instead of pretending conflict protection", async field => {
    const h = make();
    expect((await h.rest("addJobTagRoute", h.actor(), 44, { name: "Priority", [field]: "unsupported" })).status).toBe(400);
    expect(h.db.tags.size).toBe(0);
  });
  it.each([undefined, null, [], "Priority", { name: 4 }, { name: " " }, { name: "a\u0000b" }, { name: "x".repeat(65) }])("POST rejects invalid request %j", async body => {
    const h = make(); expect((await h.rest("addJobTagRoute", h.actor(), 44, body)).status).toBe(400);
    expect(h.db.tags.size).toBe(0);
  });
  it("DELETE ignores unsupported body; no expected-version/idempotency contract exists", async () => {
    const h = make(); const tag = await h.tags.addJobTag(h.db, h.actor(), 44, "Priority");
    expect((await h.rest("removeJobTagRoute", h.actor(), 44, { expectedUpdatedAt: "stale", idempotencyKey: "offline" }, tag.id)).status).toBe(200);
    // Clients must send no DELETE body; this documents absence, not a supported concurrency escape hatch.
  });
  it("RPC declared schemas execute in isolation and raw results differ from REST envelopes", async () => {
    const h = make(); const ctx = { session: h.actor() };
    expect(h.rpc.listTags.schema.parse({ jobId: 44, extra: true })).toEqual({ jobId: 44 });
    for (const operation of ["addTag", "removeTag"]) {
      const input = operation === "addTag" ? { jobId: 44, name: "Priority" } : { jobId: 44, tagId: 31 };
      expect(h.rpc[operation].schema.safeParse({ ...input, idempotencyKey: "offline" }).success).toBe(false);
      expect(h.rpc[operation].schema.safeParse({ ...input, jobId: "44" }).success).toBe(false);
    }
    const tag = await h.rpc.addTag.handler({ ctx, input: h.rpc.addTag.schema.parse({ jobId: 44, name: "Priority" }) });
    expect(tag).toMatchObject({ id: 31, jobId: 44 }); expect(tag).not.toHaveProperty("tag");
    expect(await h.rpc.listTags.handler({ ctx, input: { jobId: 44 } })).toEqual([tag]);
    expect(await h.rpc.removeTag.handler({ ctx, input: { jobId: 44, tagId: tag.id } })).toEqual({ success: true, tagId: tag.id, jobId: 44 });
  });
  it.each([401, 403, 404, 503])("preserves explicit auth status %s without reaching SQL", async status => {
    const h = make(); const error = Object.assign(new Error("Offline auth boundary"), { status });
    const reply = await h.rest("jobTags", h.actor(), 44, undefined, undefined, error);
    expect(reply.status).toBe(status); expect(h.db.calls).toEqual([]);
  });
});

describe("owner/Admin dispatcher and assigned/unassigned technician tag authority", () => {
  it.each(roles)("%s can read/add/remove assigned Job tags created by another actor", async role => {
    const h = make(); const original = await h.tags.addJobTag(h.db, h.actor("owner", 800), 44, "Original");
    const actor = h.actor(role);
    expect((await h.rest("jobTags", actor)).status).toBe(200);
    const added = await h.rest("addJobTagRoute", actor, 44, { name: "Own" }); expect(added.status).toBe(201);
    expect(added.body.tag.createdBy).toBe(actor.userId);
    expect((await h.rest("removeJobTagRoute", actor, 44, undefined, original.id)).status).toBe(200);
  });
  it.each(["owner", "dispatcher"])("%s manages unassigned and other-assignee Jobs", async role => {
    const h = make();
    for (const jobId of [45, 46]) {
      expect((await h.rest("jobTags", h.actor(role), jobId)).status).toBe(200);
      const added = await h.rest("addJobTagRoute", h.actor(role), jobId, { name: "Priority" }); expect(added.status).toBe(201);
      expect((await h.rest("removeJobTagRoute", h.actor(role), jobId, undefined, added.body.tag.id)).status).toBe(200);
    }
  });
  it.each([45, 46, 47, 999])("technician Job %s denies all tag operations before tag SQL, indistinguishably 404", async jobId => {
    const h = make();
    for (const operation of ["jobTags", "addJobTagRoute", "removeJobTagRoute"]) {
      const reply = await h.rest(operation, h.actor("technician"), jobId, { name: "Priority" }, 31);
      expect(reply).toEqual({ status: 404, body: { error: { code: "NOT_FOUND", message: "Job not found in this Company." } } });
    }
    expect(h.db.calls.every((row: { sql: string }) => !row.sql.includes("fs_job_tags"))).toBe(true);
  });
  it("wrong Company cannot list/add/remove and wrong-Job/wrong-tenant tag IDs cannot be deleted", async () => {
    const h = make(); const tag = await h.tags.addJobTag(h.db, h.actor(), 44, "Priority");
    for (const operation of ["jobTags", "addJobTagRoute", "removeJobTagRoute"])
      expect((await h.rest(operation, h.actor("owner", 801, 10), 44, { name: "Priority" }, tag.id)).status).toBe(404);
    expect((await h.rest("removeJobTagRoute", h.actor(), 45, undefined, tag.id)).status).toBe(404);
    expect((await h.rest("removeJobTagRoute", h.actor("owner", 801, 10), 47, undefined, tag.id)).status).toBe(404);
    expect(h.db.tags.has(tag.id)).toBe(true);
    expect((await h.rest("addJobTagRoute", h.actor(), 45, { name: "Priority" })).status).toBe(201); // per-Job identity
  });
  it("canonical Admin is dispatcher, not a fourth backend role or legacy bridge role", () => {
    const h = make();
    expect(fixture.source("server/jobService.ts")).toContain("VALUES (?, 'Admin', 'dispatcher', 0, 1, 5)");
    for (const role of ["admin", "operations_manager", "detailer", "platform_owner"])
      expect(() => h.actor(role)).toThrow("Your role does not allow this action");
    expect(() => h.actor("owner", 0)).toThrow("User identity");
    expect(() => h.actor("owner", 801, 0)).toThrow("Company identity");
  });
  it("exact web tenant middleware permits managers only and enforces live membership equality", async () => {
    const h = make();
    for (const role of ["owner", "dispatcher"]) expect(await h.webAuthorize(h.actor(role))).toMatchObject({ role });
    await expect(h.webAuthorize(h.actor("technician"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.webAuthorize(null)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(h.webAuthorize(h.actor(), { is_active: 0 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(h.webAuthorize(h.actor(), { role: "dispatcher" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("accessible terminal Job tags have no status/calendar/payment gate", async () => {
    const h = make();
    for (const status of ["completed", "cancelled"]) {
      h.db.jobs.get(44).status = status;
      expect((await h.rest("addJobTagRoute", h.actor("technician"), 44, { name: status })).status).toBe(201);
    }
  });
});

describe("documented mismatch, not bypass: canonical Job access is broader than tag access", () => {
  it.each([45, 46])("technician can canonically read/list/status Job %s while tag read/write is 404", async jobId => {
    const h = make(); const actor = h.actor("technician");
    expect(await h.canonical.getJob(h.db, actor, jobId)).toMatchObject({ id: jobId });
    expect((await h.canonical.listJobs(h.db, actor)).map((row: { id: number }) => row.id)).toEqual([44, 45, 46]);
    expect(await h.canonical.changeJobStatus(h.db, actor, { jobId, status: "en_route" })).toMatchObject({ success: true, status: "en_route" });
    expect((await h.rest("jobTags", actor, jobId)).status).toBe(404);
    expect((await h.rest("addJobTagRoute", actor, jobId, { name: "Priority" })).status).toBe(404);
    expect(h.effects.some((row: { label: string }) => row.label === "notification")).toBe(true); // mock only
  });
  it("status retains actual lifecycle/version conflict and same-state no-op semantics; tags have neither", async () => {
    const h = make(); const actor = h.actor("technician");
    await expect(h.canonical.changeJobStatus(h.db, actor, { jobId: 44, status: "en_route", expectedUpdatedAt: "2026-11-17T11:59:00Z" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.db.jobs.get(44).status).toBe("scheduled");
    await expect(h.canonical.changeJobStatus(h.db, actor, { jobId: 44, status: "cancelled" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await h.canonical.changeJobStatus(h.db, actor, { jobId: 44, status: "scheduled" })).toMatchObject({ idempotent: true });
    await expect(h.canonical.getJob(h.db, actor, 47)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(h.canonical.changeJobStatus(h.db, actor, { jobId: 47, status: "en_route" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.context.technicianScopeSql(actor)).toEqual({ clause: " AND j.assigned_user_id = ?", params: [801] });
    expect(h.context.technicianScopeSql(actor, { allowUnassigned: true })).toEqual({ clause: "", params: [] });
  });
});

describe("6555c8af new evidence remains separate from earlier failing f3576bcb fixtures", () => {
  it.each(["existing", "new"])("%s create OFF explicitly stores 0 and suppresses booking/quiet reservation; same-key replay stays read-only", async mode => {
    const h = notify.createHarness({ quiet: true }); const input = notify.request(mode, "multi", false);
    const created = await h.create(input);
    expect(h.db.state.jobs.get(created.id).customer_notification_enabled).toBe(0);
    expect(h.db.events.find((event: { kind: string }) => event.kind === "job-insert")).toMatchObject({ preferenceExplicit: true, storedPreference: 0 });
    expect(h.providerCalls).toEqual([]); expect(h.reservations).toEqual([]);
    expect(await h.create(input)).toMatchObject({ id: created.id, replayed: true });
    expect(h.db.state.jobs.size).toBe(1); expect(h.providerCalls).toEqual([]);
    await expect(h.create({ ...input, notifyCustomer: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.identities.find((row: { relative: string }) => row.relative === "server/jobService.ts").sha256).toBe(notify.expected["server/jobService.ts"]);
  });
  it.each(["omitted", true])("positive control %s still explicitly stores 1 and dispatches only to mock provider after commit", async preference => {
    const h = notify.createHarness(); const created = await h.create(notify.request("existing", "single", preference));
    expect(h.db.state.jobs.get(created.id).customer_notification_enabled).toBe(1);
    expect(h.providerCalls).toEqual([expect.objectContaining({ afterCommit: true, jobId: created.id })]);
  });
  it("stored OFF remains ignored by actual direct confirmation and day-before consumer (mock provider only)", async () => {
    const h = notify.createHarness(); const created = await h.create(notify.request("existing", "multi", false));
    expect(h.providerCalls).toEqual([]); expect(h.db.state.jobs.get(created.id).customer_notification_enabled).toBe(0);
    const rules = { bookingConfirmation: true, dayBeforeReminder: true, sameDayReminder: true, internalUnconfirmedAlert: false,
      reminderHour: 9, quietHoursStart: 23, quietHoursEnd: 0, templates: { bookingConfirmation: "", dayBeforeReminder: "", sameDayReminder: "" } };
    expect((await h.attemptBookingConfirmationAfterCommit(h.db, h.company, created.id, { rules })).sent).toBe(true);
    expect((await h.sendAppointmentDayBeforeReminder(h.db, h.company, created.id, { rules, now: new Date("2026-11-30T16:00:00Z") })).sent).toBe(true);
    expect(h.providerCalls).toHaveLength(2);
    expect(fixture.source("server/appointmentCommunicationService.ts", "reported")).not.toContain("customer_notification_enabled");
  });
  it("reported private-note route still constructs incomplete context and fails before SQL, unlike canonical manager service", async () => {
    const h = make();
    const reply = await h.privateRoute();
    expect(reply.error.message).toMatch(/canManageJobs/); expect(h.db.calls).toEqual([]);
    expect(h.db.jobs.get(44).internal_notes).toBe("Original private");
    await h.canonical.updateJobNotes(h.db, h.actor(), { jobId: 44, privateNotes: "Private replacement" });
    expect(h.db.jobs.get(44)).toMatchObject({ internal_notes: "Private replacement", service_notes: "Customer-visible untouched" });
    const route = fixture.declarations("server/mobileOperations.ts", ["updatePrivateJobNotes"], "reported").text;
    expect(route).toContain("const company = { companyId, userId: claims.accountId, role: claims.role, name: claims.name } as any");
    expect(route).toContain("(detail as any).private_notes ?? null");
    expect(route).not.toContain("companyContextFromMobile");
    expect(fixture.declarations("server/jobService.ts", ["updateJobNotes"], "reported").text).toContain("internal_notes = COALESCE");
  });
  it("prior f357 test evidence and source pins remain untouched and distinctly identify the old failure", () => {
    const old = readFileSync(new URL("./company-job-notify-customer-final-phase2.test.ts", import.meta.url), "utf8");
    expect(old).toContain("f3576bcb actual create path");
    expect(old).toContain("3109a39f9b407a3ba75dcfb8abc00ba13b283a6630acdca5d3bd4150850fd356");
    expect(old).toContain("KNOWN BLOCKER requirement");
  });
});
