import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  COMPANY_PHOTO_MUTATIONS_PENDING, JOB_VIDEOS_ENABLED,
  companyDurationMs, companyFieldworkBlockReason, companyJobMilestoneFields, companyJobSessionKey,
  createCompanyJobController, isAssignedCompanyTechnician, isAssignedCompanyFieldActor, companyManagementCancelBlockReason, nextCompanyFieldStatus,
  type CompanyJobState, type CompanyJobTransport,
} from "../lib/company-job-fieldwork";
import { JobSyncApiError, normalizeJobSyncCompanyJobDetail, type JobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";

const session: JobSyncNativeSession = { token: "mock-unit-token", portal: "company", user: { id: 41, role: "technician", name: "Same Name", email: null }, company: { id: 9, name: "Unit Company", slug: "unit", logoUrl: null, primaryColor: null, accentColor: null } };
const version = "2026-11-14T18:00:00.000Z";
function detail(status = "scheduled"): JobSyncCompanyJobDetail {
  return normalizeJobSyncCompanyJobDetail({ job: { id: 47, company_id: 9, customerId: 7, assignedUserId: 41, assignedName: "Different Display Name", status, updatedAt: version, enRouteAt: "2026-11-14T18:00:00.000Z", onSiteAt: "2026-11-14T18:10:00.000Z", completedAt: null, photos: [] } }, 47, 9)!;
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function setup(overrides: Partial<CompanyJobTransport> = {}, actor = session) {
  let current = true;
  let state: CompanyJobState | undefined;
  const onList = vi.fn();
  const api: CompanyJobTransport = { session: vi.fn().mockResolvedValue(actor), detail: vi.fn().mockResolvedValue(detail()), status: vi.fn().mockResolvedValue({ success: true, status: "en_route" }), cancel: vi.fn().mockResolvedValue({ success: true, status: "cancelled" }), list: vi.fn().mockResolvedValue([]), ...overrides };
  const controller = createCompanyJobController({ session: actor, jobId: 47, api, isCurrent: () => current, onState: (value) => { state = value; }, onList });
  return { controller, api, onList, state: () => state!, leave: () => { current = false; } };
}

describe("owner-operator Company canonical fieldwork", () => {
  it("uses canonical state, including reopened on_site and existing follow_up completion", () => {
    expect(nextCompanyFieldStatus("scheduled")).toBe("en_route");
    expect(nextCompanyFieldStatus("en_route")).toBe("on_site");
    expect(nextCompanyFieldStatus("on_site")).toBe("completed");
    expect(nextCompanyFieldStatus("follow_up")).toBe("completed");
    for (const status of ["draft", "unknown", "completed", "cancelled", "arrived", "started", "in_progress"]) expect(nextCompanyFieldStatus(status)).toBeNull();
  });
  it("requires numeric live Company assignment, never names, and guards cross-Company/platform", () => {
    expect(isAssignedCompanyTechnician(session, detail())).toBe(true);
    expect(isAssignedCompanyTechnician(session, { ...detail(), assignedUserId: 42 })).toBe(false);
    expect(isAssignedCompanyTechnician(session, { ...detail(), assignedUserId: null })).toBe(false);
    expect(isAssignedCompanyTechnician(session, { ...detail(), assignedUserId: 0 })).toBe(false);
    expect(isAssignedCompanyTechnician(session, { ...detail(), companyId: 10 })).toBe(false);
    expect(isAssignedCompanyTechnician({ ...session, portal: "platform" }, detail())).toBe(false);
    expect(companyJobSessionKey({ ...session, token: "" }, 47)).toBeNull();
    expect(companyJobSessionKey(session, 47)).not.toBe(companyJobSessionKey({ ...session, token: "new-mock-token" }, 47));
  });
  it("enables assigned owner/dispatcher only with explicit signed ON while retaining management role", async () => {
    for (const role of ["owner", "dispatcher"] as const) {
      const actor = { ...session, user: { ...session.user, role, calendarEligible: true } };
      expect(companyFieldworkBlockReason(actor, detail())).toBeNull();
      expect(isAssignedCompanyTechnician(actor, detail())).toBe(false);
      expect(isAssignedCompanyFieldActor(actor, detail())).toBe(true);
      const test = setup({ detail: vi.fn().mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail("en_route")) }, actor);
      await test.controller.refresh();
      expect(await test.controller.advance("en_route")).toBe(true);
      expect(test.api.session).toHaveBeenCalledTimes(3);
      expect(test.state().actor?.user.role).toBe(role);
      expect(test.api.status).toHaveBeenCalledWith(session.token, 47, { status: "en_route", expectedUpdatedAt: version });
    }
  });
  it("keeps false/null/missing/malformed manager capability unavailable, regardless of invented hints", async () => {
    for (const calendarEligible of [false, null, undefined, "true", 1, {}]) {
      const actor = { ...session, user: { ...session.user, role: "owner", calendarEligible, availableForFieldJobs: true } } as unknown as JobSyncNativeSession;
      expect(companyFieldworkBlockReason(actor, detail())).not.toBeNull();
      expect(isAssignedCompanyFieldActor(actor, detail())).toBe(false);
      const test = setup({}, actor);
      await test.controller.refresh();
      expect(await test.controller.advance("en_route")).toBe(false);
      expect(test.api.status).not.toHaveBeenCalled();
    }
  });
  it("denies invalid version and unsupported/terminal state", () => {
    expect(companyFieldworkBlockReason(session, { ...detail(), updatedAt: null })).toContain("version");
    expect(companyFieldworkBlockReason(session, detail("draft"))).toContain("draft");
    expect(companyFieldworkBlockReason(session, detail("completed"))).toContain("terminal");
    expect(companyFieldworkBlockReason(session, detail("cancelled"))).toContain("terminal");
  });
  it("uses only canonical server milestones, missing values unknown and no negative duration", () => {
    const job = detail("on_site");
    const fields = companyJobMilestoneFields(job);
    expect(fields.status).toBe("started");
    expect(nextCompanyFieldStatus(fields._rawStatus)).toBe("completed");
    expect(fields.onMyWayAt).toBe(job.enRouteAt);
    expect(fields.arrivedAt).toBe(job.onSiteAt);
    expect(fields.jobFinishedAt).toBeUndefined();
    expect(companyDurationMs(job.enRouteAt, job.onSiteAt)).toBe(600000);
    expect(companyDurationMs(job.onSiteAt, job.completedAt)).toBeNull();
    expect(companyDurationMs(job.onSiteAt, job.enRouteAt)).toBeNull();
  });
  it("locks repeat taps, awaits acknowledgement AND refreshed detail/list before success", async () => {
    const ack = deferred<{ success: true; status: "en_route" }>();
    const refreshed = deferred<JobSyncCompanyJobDetail>();
    const read = vi.fn().mockResolvedValueOnce(detail()).mockReturnValueOnce(refreshed.promise);
    const test = setup({ detail: read, status: vi.fn().mockReturnValue(ack.promise) });
    await test.controller.refresh();
    const first = test.controller.advance("en_route");
    expect(test.state().success).toBeNull();
    expect(test.state().pending).toBe(true);
    expect(await test.controller.advance("en_route")).toBe(false);
    expect(test.api.status).toHaveBeenCalledTimes(1);
    expect(test.api.status).toHaveBeenCalledWith(session.token, 47, { status: "en_route", expectedUpdatedAt: version });
    ack.resolve({ success: true, status: "en_route" });
    await Promise.resolve();
    expect(test.state().success).toBeNull();
    refreshed.resolve({ ...detail("en_route"), updatedAt: "2026-11-14T18:01:00.000Z" });
    expect(await first).toBe(true);
    expect(test.api.list).toHaveBeenCalledTimes(1);
    expect(test.state().detail?.status).toBe("en_route");
    expect(test.state().success).toContain("confirmed");
  });
  it("finishes a reopened canonical on_site Job without any photo/payment/clock requirement", async () => {
    const read = vi.fn().mockResolvedValueOnce(detail("on_site")).mockResolvedValueOnce({ ...detail("completed"), completedAt: "2026-11-14T18:20:00.000Z" });
    const test = setup({ detail: read, status: vi.fn().mockResolvedValue({ success: true, status: "completed" }) });
    await test.controller.refresh();
    expect(await test.controller.advance("completed")).toBe(true);
    expect(test.api.status).toHaveBeenCalledWith(session.token, 47, { status: "completed", expectedUpdatedAt: version });
    expect(test.state().detail?.completedAt).toBe("2026-11-14T18:20:00.000Z");
    expect(test.state().detail?.photos).toEqual([]);
  });
  it("never reports success for acknowledged status when refresh differs", async () => {
    const test = setup({ detail: vi.fn().mockResolvedValue(detail()) });
    await test.controller.refresh();
    expect(await test.controller.advance("en_route")).toBe(false);
    expect(test.state().success).toBeNull();
    expect(test.state().error).toContain("refreshed progress differs");
  });
  it.each([
    new JobSyncApiError("Reassigned", 409, "CONFLICT"), new JobSyncApiError("Denied", 403, "FORBIDDEN"),
    new JobSyncApiError("Timeout", null, "TIMEOUT"), new Error("Network disconnected"),
  ])("reconciles failed/ambiguous writes without success: %s", async (error) => {
    const test = setup({ detail: vi.fn().mockResolvedValueOnce(detail()).mockResolvedValueOnce({ ...detail(), assignedUserId: 42 }), status: vi.fn().mockRejectedValue(error) });
    await test.controller.refresh();
    expect(await test.controller.advance("en_route")).toBe(false);
    expect(test.api.detail).toHaveBeenCalledTimes(2);
    expect(test.api.list).toHaveBeenCalledTimes(1);
    expect(test.state().success).toBeNull();
    expect(test.state().error).toContain(error.message);
    expect(companyFieldworkBlockReason(session, test.state().detail)).toContain("assigned");
    expect(await test.controller.advance("en_route")).toBe(false);
    expect(test.api.status).toHaveBeenCalledTimes(1);
  });
  it("disables progress when failed acknowledgement cannot be reconciled", async () => {
    const test = setup({ detail: vi.fn().mockResolvedValueOnce(detail()).mockRejectedValue(new Error("offline")), status: vi.fn().mockRejectedValue(new JobSyncApiError("conflict", 409, "CONFLICT")) });
    await test.controller.refresh();
    expect(await test.controller.advance("en_route")).toBe(false);
    expect(test.state().detail).toBeNull();
    expect(test.state().success).toBeNull();
    expect(test.state().error).toContain("disabled until Refresh");
  });
  it("discards late photo detail and progress responses after Job/session changes", async () => {
    const late = deferred<JobSyncCompanyJobDetail>();
    const test = setup({ detail: vi.fn().mockReturnValue(late.promise) });
    const loading = test.controller.refresh();
    test.leave();
    late.resolve({ ...detail(), photos: [{ id: 1, imageUrl: "https://unit.test/old.jpg", caption: null, createdAt: version, uploadedByUserId: 41 }] });
    await loading;
    expect(test.state().detail).toBeNull();
    expect(test.onList).not.toHaveBeenCalled();
    const ack = deferred<{ success: true; status: "en_route" }>();
    const action = setup({ status: vi.fn().mockReturnValue(ack.promise) });
    await action.controller.refresh();
    const advancing = action.controller.advance("en_route");
    action.leave();
    ack.resolve({ success: true, status: "en_route" });
    expect(await advancing).toBe(false);
    expect(action.api.detail).toHaveBeenCalledTimes(1);
    expect(action.state().success).toBeNull();
  });
  it("a successful empty photo DTO clears all legacy/local gallery aliases", async () => {
    const test = setup();
    await test.controller.refresh();
    const legacy = { photoUrls: ["https://unit.test/legacy.jpg"], photos: ["file://pending.jpg"] };
    const merged = { ...legacy, ...companyJobMilestoneFields(test.state().detail!) };
    expect(merged.photoUrls).toEqual([]);
    expect(merged.photos).toEqual([]);
  });
  it.each(["en_route", "on_site", "completed"] as const)("supports the exact shared manager next action %s with the freshly read version", async (target) => {
    const start = target === "en_route" ? "scheduled" : target === "on_site" ? "en_route" : "on_site";
    const actor: JobSyncNativeSession = { ...session, user: { ...session.user, role: "dispatcher", calendarEligible: true } };
    const freshVersion = "2026-11-14T18:02:00.000Z";
    const test = setup({ detail: vi.fn().mockResolvedValueOnce(detail(start)).mockResolvedValueOnce({ ...detail(start), updatedAt: freshVersion })
      .mockResolvedValueOnce({ ...detail(target), completedAt: target === "completed" ? freshVersion : null }), status: vi.fn().mockResolvedValue({ success: true, status: target }) }, actor);
    await test.controller.refresh();
    expect(await test.controller.advance(target)).toBe(true);
    expect(test.api.status).toHaveBeenCalledWith(actor.token, 47, { status: target, expectedUpdatedAt: freshVersion });
    expect(test.api.cancel).not.toHaveBeenCalled();
    expect(test.state().actor?.user.role).toBe("dispatcher");
  });
  it.each([false, null, undefined])("refreshes manager opt-out/unavailable %s before writing, without trusting login-time ON", async (calendarEligible) => {
    const actor: JobSyncNativeSession = { ...session, user: { ...session.user, role: "owner", calendarEligible: true } };
    const test = setup({ session: vi.fn().mockResolvedValueOnce(actor).mockResolvedValue({ ...actor, user: { ...actor.user, calendarEligible } }) }, actor);
    await test.controller.refresh();
    expect(await test.controller.advance("en_route")).toBe(false);
    expect(test.api.status).not.toHaveBeenCalled();
    expect(test.state().actor?.user.calendarEligible).toBe(calendarEligible);
    expect(test.state().error).toContain("Available for Field Jobs");
  });
  it.each([42, null, "41", 0])("denies manager reassignment/non-numeric assignment %s immediately before writing", async (assignedUserId) => {
    const actor: JobSyncNativeSession = { ...session, user: { ...session.user, role: "owner", calendarEligible: true } };
    const test = setup({ detail: vi.fn().mockResolvedValueOnce(detail()).mockResolvedValue({ ...detail(), assignedUserId }) }, actor);
    await test.controller.refresh();
    expect(await test.controller.advance("en_route")).toBe(false);
    expect(test.api.status).not.toHaveBeenCalled();
    expect(test.state().error).toContain("assigned");
  });
  it("denies a manager action whose fresh Job is terminal or has a different next action", async () => {
    const actor: JobSyncNativeSession = { ...session, user: { ...session.user, role: "owner", calendarEligible: true } };
    for (const status of ["completed", "cancelled", "en_route"]) {
      const test = setup({ detail: vi.fn().mockResolvedValueOnce(detail()).mockResolvedValue(detail(status)) }, actor);
      await test.controller.refresh();
      expect(await test.controller.advance("en_route")).toBe(false);
      expect(test.api.status).not.toHaveBeenCalled();
    }
  });
  it.each(["token", "company", "user", "role", "portal", "job", "offline-session", "offline-job"])("fails closed on manager fresh %s change/error", async (change) => {
    const actor: JobSyncNativeSession = { ...session, user: { ...session.user, role: "owner", calendarEligible: true } };
    const fresh = { ...actor, user: { ...actor.user }, company: { ...actor.company! } };
    if (change === "token") fresh.token = "replacement-token";
    if (change === "company") fresh.company.id = 10;
    if (change === "user") fresh.user.id = 42;
    if (change === "role") fresh.user.role = "dispatcher";
    if (change === "portal") fresh.portal = "platform";
    const sessionRead = vi.fn().mockResolvedValueOnce(actor);
    if (change === "offline-session") sessionRead.mockRejectedValue(new Error("offline"));
    else sessionRead.mockResolvedValue(fresh);
    const detailRead = vi.fn().mockResolvedValueOnce(detail());
    if (change === "offline-job") detailRead.mockRejectedValue(new Error("offline"));
    else detailRead.mockResolvedValue(change === "job" ? { ...detail(), id: 48 } : detail());
    const test = setup({ session: sessionRead, detail: detailRead }, actor);
    await test.controller.refresh();
    expect(await test.controller.advance("en_route")).toBe(false);
    expect(test.api.status).not.toHaveBeenCalled();
    expect(test.state().actor).toBeNull();
    expect(test.state().detail).toBeNull();
    expect(test.state().error).toContain("disabled until Refresh");
  });
  it("does not render a fresh Job when its paired fresh session read fails", async () => {
    const test = setup({ session: vi.fn().mockRejectedValue(new Error("Session unavailable")) });
    await test.controller.refresh();
    expect(test.state().actor).toBeNull();
    expect(test.state().detail).toBeNull();
    expect(await test.controller.advance("en_route")).toBe(false);
    expect(test.api.status).not.toHaveBeenCalled();
  });
  it("discards late session/Job reads after a capability/token/role identity leaves, with repeat-tap protection", async () => {
    const actor: JobSyncNativeSession = { ...session, user: { ...session.user, role: "owner", calendarEligible: true } };
    const late = deferred<JobSyncNativeSession>();
    const test = setup({ session: vi.fn().mockResolvedValueOnce(actor).mockReturnValueOnce(late.promise) }, actor);
    await test.controller.refresh();
    const write = test.controller.advance("en_route");
    expect(await test.controller.advance("en_route")).toBe(false);
    expect(test.state().pending).toBe(true);
    test.leave();
    late.resolve(actor);
    expect(await write).toBe(false);
    expect(test.api.status).not.toHaveBeenCalled();
    expect(test.onList).not.toHaveBeenCalled();
    expect(test.state().success).toBeNull();
    for (const calendarEligible of [true, false, null, undefined]) {
      const key = companyJobSessionKey({ ...actor, user: { ...actor.user, calendarEligible } }, 47);
      for (const other of [true, false, null, undefined].filter((value) => value !== calendarEligible)) {
        expect(key).not.toBe(companyJobSessionKey({ ...actor, user: { ...actor.user, calendarEligible: other } }, 47));
      }
    }
  });
  it.each(["owner", "dispatcher"] as const)("keeps %s management Cancel independent of opt-in and assignment, using fresh version and canonical cancelled", async (role) => {
    const actor: JobSyncNativeSession = { ...session, user: { ...session.user, role, calendarEligible: false } };
    const freshVersion = "2026-11-14T18:03:00.000Z";
    const test = setup({ detail: vi.fn().mockResolvedValueOnce({ ...detail(), assignedUserId: 42 })
      .mockResolvedValueOnce({ ...detail(), updatedAt: freshVersion, assignedUserId: null }).mockResolvedValueOnce(detail("cancelled")) }, actor);
    await test.controller.refresh();
    expect(companyManagementCancelBlockReason(test.state().actor, test.state().detail)).toBeNull();
    expect(await test.controller.cancelManagement()).toBe(true);
    expect(test.api.cancel).toHaveBeenCalledWith(actor.token, 47, { expectedUpdatedAt: freshVersion });
    expect(test.api.status).not.toHaveBeenCalled();
    expect(test.api.list).toHaveBeenCalledTimes(1);
    expect(test.state().detail?.status).toBe("cancelled");
    expect(test.state().success).toContain("management cancellation confirmed");
  });
  it("denies Technician management Cancel and fresh terminal management cancellation", async () => {
    const technician = setup();
    await technician.controller.refresh();
    expect(await technician.controller.cancelManagement()).toBe(false);
    expect(technician.api.cancel).not.toHaveBeenCalled();
    const actor: JobSyncNativeSession = { ...session, user: { ...session.user, role: "owner", calendarEligible: false } };
    const test = setup({ detail: vi.fn().mockResolvedValueOnce(detail()).mockResolvedValue(detail("completed")) }, actor);
    await test.controller.refresh();
    expect(await test.controller.cancelManagement()).toBe(false);
    expect(test.api.cancel).not.toHaveBeenCalled();
    expect(test.state().error).toContain("terminal");
  });
  it("reconciles failed management cancellation and keeps success unavailable", async () => {
    const actor: JobSyncNativeSession = { ...session, user: { ...session.user, role: "owner" } };
    const test = setup({ cancel: vi.fn().mockRejectedValue(new JobSyncApiError("conflict", 409, "CONFLICT")) }, actor);
    await test.controller.refresh();
    expect(await test.controller.cancelManagement()).toBe(false);
    expect(test.api.detail).toHaveBeenCalledTimes(3);
    expect(test.api.list).toHaveBeenCalledTimes(1);
    expect(test.state().error).toContain("Current Job refreshed");
    expect(test.state().success).toBeNull();
  });
});

function source(path: string) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }
describe("shared job screen integration boundaries", () => {
  it("uses one shared Company UI in technician and Admin; legacy progress returns first", () => {
    const tech = source("app/(tabs)/schedule.tsx");
    const admin = source("app/(tabs)/admin-schedule.tsx");
    expect(tech).toContain("companyJobMode ? <CompanyJobProgress");
    expect(admin).toContain("if (companyJobMode) return <CompanyJobProgress");
    const advance = tech.slice(tech.indexOf("const advanceStatus ="), tech.indexOf("const deleteJob ="));
    expect(advance.indexOf("if (companyJobMode || job.companyId !== undefined) return;")).toBeLessThan(advance.indexOf("const now ="));
    for (const screen of [tech, admin]) {
      expect(screen).toContain("CompanyJobPhotos");
      expect(screen).toContain("CompanyJobPhotoPreview");
      expect(screen).toContain("companyJobMode");
    }
    const controller = source("lib/company-job-fieldwork.ts");
    expect(controller).not.toMatch(/trpc|AsyncStorage|stampTimestamp|createToken|clockIn\(/);
    // Comments mention legacy RPC, but no such imports or invocations exist.
  });
  it("disables both complete job video sections and old handlers without deleting stored data", () => {
    expect(JOB_VIDEOS_ENABLED).toBe(false);
    const tech = source("app/(tabs)/schedule.tsx");
    const customer = source("app/(tabs)/admin-customer-profile.tsx");
    expect(tech).toContain("{JOB_VIDEOS_ENABLED && <>");
    expect(customer).toContain("{JOB_VIDEOS_ENABLED && (() =>");
    expect(tech.match(/if \(!JOB_VIDEOS_ENABLED \|\| companyJobMode\) return;/g)).toHaveLength(2);
    expect(tech).not.toContain("videoUrls: []");
  });
  it("Company photo mutations use guarded shared bearer operations, no guessed endpoints or cookie fallback", () => {
    expect(COMPANY_PHOTO_MUTATIONS_PENDING).toContain("unavailable");
    const photos = source("components/company-job-photos.tsx");
    expect(photos).toContain("<CompanyPhotoDraft");
    const draft = source("components/company-photo-draft.tsx");
    expect(draft).toContain('(["Camera", "Library"] as const)');
    expect(draft).toContain('disabled={disabled}');
    expect(draft).toContain('accessibilityLabel="Upload local draft"');
    expect(source("lib/company-photo-draft.ts")).toContain("not uploaded or saved to this Job");
    expect(draft).not.toMatch(/uploadPhoto|deletePhoto|trpc|fetch\(/);
    expect(photos).not.toMatch(/uploadPhoto|deletePhoto|trpc|fetch\(/);
    const operation = source("lib/company-photo-operation.ts");
    expect(operation).toContain("uploadJobSyncCompanyJobPhoto");
    expect(operation).toContain("deleteJobSyncCompanyJobPhoto");
    expect(operation).toContain("getJobSyncMobileSession");
    expect(operation).toContain("getJobSyncCompanyJobDetail");
    expect(operation).not.toMatch(/trpc|AsyncStorage|credentials\s*:|fetch\(/);
    expect(photos).toContain('accessibilityLabel="Confirm remove photo from Job"');
    expect(photos).toContain('Platform.OS !== "web"');
    const hook = source("hooks/use-company-job.ts");
    expect(hook).toContain("instance.current === identity");
    expect(hook).toContain("focused && snapshot.key === key && snapshot.identity === identity");
    expect(hook).toContain("live.current.mounted && live.current.focused && live.current.key === key");
    const progress = source("components/company-job-progress.tsx");
    expect(progress).toContain("timeZone: timezone");
    expect(progress).toContain('return "Unknown"');
    expect(progress).toContain("Only tap Arrived when you are physically at the customer location.");
  });
  it("preserves Job invoice and collection UI while Company invoice uses only canonical request", () => {
    const admin = source("app/(tabs)/admin-schedule.tsx");
    const branch = admin.slice(admin.indexOf("if (companyJobMode) {", admin.indexOf("{/* Send button */}")), admin.indexOf("setInvoiceSending(true);\n                      try", admin.indexOf("{/* Send button */}")));
    expect(branch).toContain("sendJobSyncCompanyJobInvoice(token, jobId, { method: invoiceMethod })");
    expect(branch).toContain("data.publicUrl");
    expect(branch).toContain("return; // Never fall back");
    expect(branch).not.toMatch(/overrideEmail|overridePhone|discountAmount|paymentUrl/);
    expect(admin).toContain("AdminCheckoutModal");
    expect(source("app/(tabs)/schedule.tsx")).toContain("shouldShowCollectPayment(selectedJob.payment)");
  });
  it("separates Company management Cancel from field buttons and guards every copied destructive confirmation", () => {
    const admin = source("app/(tabs)/admin-schedule.tsx");
    const progress = source("components/company-job-progress.tsx");
    expect(progress).toContain("companyFieldworkBlockReason(job.actor, detail)");
    expect(progress).not.toMatch(/ADMIN_FIELDWORK_PENDING|cancelManagement|user.role !== "technician"/);
    expect(progress.match(/label: /g)).toHaveLength(4); // One type plus exactly three field buttons.
    const block = admin.slice(admin.indexOf('>Management actions</Text>'), admin.indexOf('                {!showReassignPicker', admin.indexOf('>Management actions</Text>')));
    expect(block).toContain('Company management Cancel');
    expect(block).toContain('void companyJob.cancelManagement()');
    expect(block).toContain('{!companyJobMode && !selectedJob?.recurrenceParentId');
    expect(block).toContain('{!companyJobMode && (selectedJob?.status');
    expect(block).toContain('{!companyJobMode && <TouchableOpacity');
    expect(block).toContain('{!companyJobMode && selectedJob?.recurrenceParentId');
    expect(block.match(/onPress: async \(\) => \{\s*if \(!isCurrentAction\(\)\) return;/g)).toHaveLength(9);
    expect(block.match(/if \(!isCurrentAction\(\)\) return;/g)).toHaveLength(19); // Before/after nine writes plus late error.
    expect(admin).toContain('managementActionRef.current.generation === generation');
    const technician = source("app/(tabs)/schedule.tsx");
    const deletion = technician.slice(technician.indexOf('const deleteJob ='), technician.indexOf('// ─── Enhanced Job Detail Helpers'));
    expect(deletion).toContain('if (companyJobMode || legacyMediaSessionRef.current.companyMode || jobToDelete?.companyId !== undefined) return;');
    expect(deletion.indexOf('legacyMediaSessionRef.current.generation !== generation')).toBeLessThan(deletion.indexOf('persistJobs('));
  });
});
