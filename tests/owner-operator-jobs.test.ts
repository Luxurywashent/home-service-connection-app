import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  ADMIN_FIELDWORK_PENDING, COMPANY_PHOTO_MUTATIONS_PENDING, JOB_VIDEOS_ENABLED,
  companyDurationMs, companyFieldworkBlockReason, companyJobMilestoneFields, companyJobSessionKey,
  createCompanyJobController, isAssignedCompanyTechnician, nextCompanyFieldStatus,
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
  const api: CompanyJobTransport = { detail: vi.fn().mockResolvedValue(detail()), status: vi.fn().mockResolvedValue({ success: true, status: "en_route" }), list: vi.fn().mockResolvedValue([]), ...overrides };
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
  it("keeps Admin owner/dispatcher OFF and ON unverified regardless of invented capability hints", async () => {
    for (const role of ["owner", "dispatcher"] as const) {
      const actor = { ...session, user: { ...session.user, role, calendarEligible: true, availableForFieldJobs: true } };
      expect(companyFieldworkBlockReason(actor, detail())).toBe(ADMIN_FIELDWORK_PENDING);
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
  it("Company photo mutations are unavailable, no guessed endpoints or cookie fallback", () => {
    expect(COMPANY_PHOTO_MUTATIONS_PENDING).toContain("unavailable");
    const photos = source("components/company-job-photos.tsx");
    expect(photos).toContain('["Camera", "Library"]');
    expect(photos).toContain("disabled accessibilityRole");
    expect(photos).not.toMatch(/uploadPhoto|deletePhoto|trpc|fetch\(/);
    expect(source("lib/jobsync-mobile-api.ts")).not.toMatch(/requestJson\([^\n]*\/photos/);
    const hook = source("hooks/use-company-job.ts");
    expect(hook).toContain("instance.current === identity");
    expect(hook).toContain("snapshot.identity === instance.current");
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
});
