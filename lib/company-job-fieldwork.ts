import {
  cancelJobSyncCompanyJob, getJobSyncMobileSession, getJobSyncCompanyJobDetail, getJobSyncCompanyJobs, updateJobSyncCompanyJobStatus,
  positiveJobSyncId, type JobSyncCompanyJobDetail, type JobSyncFieldStatus,
  type JobSyncMobileJob, type JobSyncNativeSession,
} from "./jobsync-mobile-api";

// A job-only switch. Existing stored videos and unrelated media remain untouched.
export const JOB_VIDEOS_ENABLED = false;
export const COMPANY_PHOTO_MUTATIONS_PENDING = "Camera, Library upload and deletion are unavailable: the backend has not connected bearer-authenticated Company job photo upload/delete routes. Existing server photos are read-only.";

function signedCompanyIdentity(session: JobSyncNativeSession | null) {
  return Boolean(session?.portal === "company" && session.token.trim()
    && typeof session.company?.id === "number" && positiveJobSyncId(session.company.id)
    && typeof session.user.id === "number" && positiveJobSyncId(session.user.id));
}

export function companyJobSessionKey(session: JobSyncNativeSession | null, jobId: number | null) {
  return signedCompanyIdentity(session) && typeof jobId === "number" && positiveJobSyncId(jobId)
    ? JSON.stringify([session!.company!.id, session!.user.id, session!.user.role, session!.token, jobId,
      session!.user.calendarEligible === undefined ? "unavailable" : session!.user.calendarEligible]) : null;
}

function isAssignedCompanyActor(session: JobSyncNativeSession | null, job: { companyId?: number | null; assignedUserId?: number | null }) {
  return Boolean(signedCompanyIdentity(session) && job.companyId === session!.company!.id
    && typeof job.assignedUserId === "number" && positiveJobSyncId(job.assignedUserId) && job.assignedUserId === session!.user.id);
}

// Scheduling uses of this existing technician-only predicate intentionally remain unchanged.
export function isAssignedCompanyTechnician(session: JobSyncNativeSession | null, job: { companyId?: number | null; assignedUserId?: number | null }) {
  return session?.user.role === "technician" && isAssignedCompanyActor(session, job);
}

export function isAssignedCompanyFieldActor(session: JobSyncNativeSession | null, job: { companyId?: number | null; assignedUserId?: number | null }) {
  return isAssignedCompanyActor(session, job) && (session?.user.role === "technician"
    || ((session?.user.role === "owner" || session?.user.role === "dispatcher") && session.user.calendarEligible === true));
}

export function nextCompanyFieldStatus(status: string): JobSyncFieldStatus | null {
  // follow_up -> completed is an existing backend transition, not a new status.
  return ({ scheduled: "en_route", en_route: "on_site", on_site: "completed", follow_up: "completed" } as Record<string, JobSyncFieldStatus>)[status] ?? null;
}

export function companyFieldworkBlockReason(session: JobSyncNativeSession | null, detail: JobSyncCompanyJobDetail | null): string | null {
  if (!companyJobSessionKey(session, detail?.id ?? null)) return "A fresh signed Company Job session is required.";
  if (!["technician", "owner", "dispatcher"].includes(session!.user.role)) return "This signed role cannot perform Company field progress.";
  if (session!.user.role !== "technician" && session!.user.calendarEligible !== true) return session!.user.calendarEligible === false
    ? "Available for Field Jobs is OFF in your signed session. Management permissions are unchanged."
    : "Explicit Available for Field Jobs ON is unavailable in your signed session. Refresh before performing fieldwork.";
  if (!isAssignedCompanyFieldActor(session, detail!)) return "Only the currently assigned Company field actor can update field progress. Refresh the schedule.";
  if (!detail?.updatedAt || !Number.isFinite(Date.parse(detail.updatedAt))) return "The backend Job version is unavailable. Refresh before updating progress.";
  if (!nextCompanyFieldStatus(detail.status)) return ["completed", "cancelled"].includes(detail.status)
    ? "This Job is terminal. No field progress action is available."
    : `No field action is available for backend status '${detail.status}'.`;
  return null;
}

export function companyManagementCancelBlockReason(session: JobSyncNativeSession | null, detail: JobSyncCompanyJobDetail | null): string | null {
  if (!companyJobSessionKey(session, detail?.id ?? null) || detail?.companyId !== session?.company?.id) return "A fresh signed Company Job session is required.";
  if (session?.user.role !== "owner" && session?.user.role !== "dispatcher") return "Company management cancellation requires an owner or dispatcher.";
  if (!detail?.updatedAt || !Number.isFinite(Date.parse(detail.updatedAt))) return "The backend Job version is unavailable. Refresh before cancelling.";
  if (["completed", "cancelled"].includes(detail.status)) return "This Job is terminal. Management cancellation is unavailable.";
  if (!["draft", "scheduled", "en_route", "on_site", "follow_up"].includes(detail.status)) return "This backend status does not support management cancellation.";
  return null;
}

export function companyJobDisplayFields(job: JobSyncMobileJob) {
  return {
    status: job.status === "completed" ? "finished" as const : job.status === "en_route" ? "on_my_way" as const : job.status === "on_site" ? "started" as const : job.status === "cancelled" ? "cancelled" as const : "scheduled" as const,
    _rawStatus: job.status, assignedUserId: job.assignedUserId, updatedAt: job.updatedAt,
    detailerName: job.assignedName || undefined,
  };
}

export function companyJobMilestoneFields(job: JobSyncCompanyJobDetail) {
  return {
    ...companyJobDisplayFields(job),
    onMyWayAt: job.enRouteAt ?? undefined, travelStartedAt: job.enRouteAt ?? undefined,
    arrivedAt: job.onSiteAt ?? undefined, jobStartedAt: job.onSiteAt ?? undefined,
    finishedAt: job.completedAt ?? undefined, jobFinishedAt: job.completedAt ?? undefined,
    // A successful empty gallery is authoritative. Never merge local/legacy URLs.
    photoUrls: job.photos.map((photo) => photo.imageUrl), photos: [],
  };
}

export function companyDurationMs(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const duration = Date.parse(end) - Date.parse(start);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

export type CompanyJobState = { detail: JobSyncCompanyJobDetail | null; actor: JobSyncNativeSession | null; loading: boolean; pending: boolean; error: string | null; success: string | null };
export type CompanyJobTransport = {
  session: typeof getJobSyncMobileSession;
  detail: typeof getJobSyncCompanyJobDetail;
  status: typeof updateJobSyncCompanyJobStatus;
  cancel: typeof cancelJobSyncCompanyJob;
  list: typeof getJobSyncCompanyJobs;
};
const transport: CompanyJobTransport = { session: getJobSyncMobileSession, detail: getJobSyncCompanyJobDetail, status: updateJobSyncCompanyJobStatus, cancel: cancelJobSyncCompanyJob, list: getJobSyncCompanyJobs };

/** Finite, session-isolated operations. No storage, legacy RPC, clock, tracking or finance side effects. */
export function createCompanyJobController(input: {
  session: JobSyncNativeSession; jobId: number; isCurrent: () => boolean;
  onState: (state: CompanyJobState) => void;
  onList?: (jobs: JobSyncMobileJob[]) => void;
  api?: CompanyJobTransport;
}) {
  const api = input.api ?? transport;
  // Capture identity rather than trusting a later in-place mutation of the caller's object.
  const original = { ...input.session, user: { ...input.session.user }, company: input.session.company ? { ...input.session.company } : undefined };
  let state: CompanyJobState = { detail: null, actor: null, loading: true, pending: false, error: null, success: null };
  let locked = false;
  let readVersion = 0;
  const publish = (patch: Partial<CompanyJobState>) => {
    state = { ...state, ...patch };
    if (input.isCurrent()) input.onState(state);
  };
  const read = async (refreshList = false) => {
    const version = ++readVersion;
    const [actor, detail, list] = await Promise.all([
      api.session(original.token),
      api.detail(original.token, input.jobId, original.company!.id),
      refreshList ? api.list(original.token) : Promise.resolve(null),
    ]);
    if (!input.isCurrent() || version !== readVersion) return null;
    if (!signedCompanyIdentity(actor) || actor.token !== original.token || actor.company?.id !== original.company?.id
      || actor.user.id !== original.user.id || actor.user.role !== original.user.role) {
      throw new Error("The signed Company identity or live role changed. Refresh your session before continuing.");
    }
    if (detail.id !== input.jobId || detail.companyId !== original.company?.id) throw new Error("Could not verify the current Company's Job. Refresh before continuing.");
    publish({ actor, detail, loading: false });
    if (list && input.isCurrent()) input.onList?.(list);
    return detail;
  };
  const write = async (target: JobSyncFieldStatus | "cancelled") => {
    if (locked || !input.isCurrent()) return false;
    const management = target === "cancelled";
    const block = () => management ? companyManagementCancelBlockReason(state.actor, state.detail) : companyFieldworkBlockReason(state.actor, state.detail);
    const reason = block();
    if (reason || (!management && nextCompanyFieldStatus(state.detail!.status) !== target)) {
      publish({ error: reason ?? "Job progress changed. Refresh before retrying.", success: null });
      return false;
    }
    locked = true; // Synchronous lock protects repeated taps before React rerenders.
    publish({ pending: true, success: null, error: null });
    let attemptedWrite = false;
    try {
      // Every manager control write checks the live session and Job immediately before PATCH.
      // No opt-in/assignment is required for the independent management Cancel action.
      if (management || original.user.role === "owner" || original.user.role === "dispatcher") {
        const fresh = await read();
        if (!fresh || !input.isCurrent()) return false;
        const freshReason = block();
        if (freshReason || (!management && nextCompanyFieldStatus(fresh.status) !== target)) {
          publish({ error: freshReason ?? "Job progress changed. Review the refreshed Job before retrying." });
          return false;
        }
      }
      if (!input.isCurrent()) return false;
      attemptedWrite = true;
      if (management) await api.cancel(original.token, input.jobId, { expectedUpdatedAt: state.detail!.updatedAt! });
      else await api.status(original.token, input.jobId, { status: target, expectedUpdatedAt: state.detail!.updatedAt });
      if (!input.isCurrent()) return false;
      const detail = await read(true);
      if (!detail) return false;
      if (detail.status !== target) throw new Error("The backend acknowledged the request, but refreshed progress differs. Review the current Job before retrying.");
      publish({ success: management ? "Company management cancellation confirmed by the backend." : "Job progress confirmed by the backend." });
      return true;
    } catch (error) {
      if (!input.isCurrent()) return false;
      const message = error instanceof Error ? error.message : "Could not update Company Job progress.";
      publish({ detail: null, actor: null, loading: attemptedWrite, success: null });
      if (!attemptedWrite) {
        // A failed freshness check never writes or quietly re-enables a captured opt-in.
        publish({ loading: false, error: `${message} Controls are disabled until Refresh succeeds.` });
        return false;
      }
      // Denial, 409 and ambiguous timeout/network outcomes require authoritative reconciliation.
      try {
        const detail = await read(true);
        if (detail) publish({ error: `${message} Current Job refreshed; review it before retrying.`, loading: false });
      } catch {
        publish({ detail: null, actor: null, loading: false, error: `${message} Could not refresh. Progress is disabled until Refresh succeeds.` });
      }
      return false;
    } finally {
      locked = false;
      publish({ pending: false });
    }
  };
  return {
    async refresh() {
      if (locked || !input.isCurrent()) return;
      locked = true;
      publish({ detail: null, actor: null, loading: true, error: null, success: null });
      try { await read(); }
      catch (error) { publish({ detail: null, actor: null, loading: false, error: error instanceof Error ? error.message : "Could not load Company Job detail." }); }
      finally { locked = false; }
    },
    advance: (target: JobSyncFieldStatus) => write(target),
    cancelManagement: () => write("cancelled"),
  };
}
