import {
  getJobSyncCompanyJobDetail, getJobSyncCompanyJobs, updateJobSyncCompanyJobStatus,
  positiveJobSyncId, type JobSyncCompanyJobDetail, type JobSyncFieldStatus,
  type JobSyncMobileJob, type JobSyncNativeSession,
} from "./jobsync-mobile-api";

// A job-only switch. Existing stored videos and unrelated media remain untouched.
export const JOB_VIDEOS_ENABLED = false;
export const ADMIN_FIELDWORK_PENDING = "Admin fieldwork is unavailable: the backend has not connected explicit field permission, opt-in and current-assignment authorization. Available for Field Jobs OFF/ON is not verified.";
export const COMPANY_PHOTO_MUTATIONS_PENDING = "Camera, Library upload and deletion are unavailable: the backend has not connected bearer-authenticated Company job photo upload/delete routes. Existing server photos are read-only.";

export function companyJobSessionKey(session: JobSyncNativeSession | null, jobId: number | null) {
  return session?.portal === "company" && session.token && positiveJobSyncId(session.company?.id) && positiveJobSyncId(session.user.id) && positiveJobSyncId(jobId)
    ? JSON.stringify([session.company!.id, session.user.id, session.user.role, session.token, jobId]) : null;
}

export function isAssignedCompanyTechnician(session: JobSyncNativeSession | null, job: { companyId?: number | null; assignedUserId?: number | null }) {
  return Boolean(session?.portal === "company" && session.token && session.user.role === "technician"
    && positiveJobSyncId(session.user.id) && positiveJobSyncId(session.company?.id)
    && job.companyId === session.company?.id && job.assignedUserId === session.user.id);
}

export function nextCompanyFieldStatus(status: string): JobSyncFieldStatus | null {
  // follow_up -> completed is an existing backend transition, not a new status.
  return ({ scheduled: "en_route", en_route: "on_site", on_site: "completed", follow_up: "completed" } as Record<string, JobSyncFieldStatus>)[status] ?? null;
}

export function companyFieldworkBlockReason(session: JobSyncNativeSession | null, detail: JobSyncCompanyJobDetail | null): string | null {
  if (!companyJobSessionKey(session, detail?.id ?? null)) return "A fresh signed Company Job session is required.";
  if (session?.user.role !== "technician") return ADMIN_FIELDWORK_PENDING;
  if (!isAssignedCompanyTechnician(session, detail!)) return "Only the currently assigned Company technician can update field progress. Refresh the schedule.";
  if (!detail?.updatedAt || !Number.isFinite(Date.parse(detail.updatedAt))) return "The backend Job version is unavailable. Refresh before updating progress.";
  if (!nextCompanyFieldStatus(detail.status)) return ["completed", "cancelled"].includes(detail.status)
    ? "This Job is terminal. No field progress action is available."
    : `No field action is available for backend status '${detail.status}'.`;
  return null;
}

export function companyJobDisplayFields(job: JobSyncMobileJob) {
  return {
    status: job.status === "completed" ? "finished" as const : job.status === "en_route" ? "on_my_way" as const : job.status === "on_site" ? "started" as const : "scheduled" as const,
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

export type CompanyJobState = { detail: JobSyncCompanyJobDetail | null; loading: boolean; pending: boolean; error: string | null; success: string | null };
export type CompanyJobTransport = {
  detail: typeof getJobSyncCompanyJobDetail;
  status: typeof updateJobSyncCompanyJobStatus;
  list: typeof getJobSyncCompanyJobs;
};
const transport: CompanyJobTransport = { detail: getJobSyncCompanyJobDetail, status: updateJobSyncCompanyJobStatus, list: getJobSyncCompanyJobs };

/** Finite, session-isolated operations. No storage, legacy RPC, clock, tracking or finance side effects. */
export function createCompanyJobController(input: {
  session: JobSyncNativeSession; jobId: number; isCurrent: () => boolean;
  onState: (state: CompanyJobState) => void;
  onList?: (jobs: JobSyncMobileJob[]) => void;
  api?: CompanyJobTransport;
}) {
  const api = input.api ?? transport;
  let state: CompanyJobState = { detail: null, loading: true, pending: false, error: null, success: null };
  let locked = false;
  let readVersion = 0;
  const publish = (patch: Partial<CompanyJobState>) => {
    state = { ...state, ...patch };
    if (input.isCurrent()) input.onState(state);
  };
  const read = async (refreshList = false) => {
    const version = ++readVersion;
    const [detail, list] = await Promise.all([
      api.detail(input.session.token, input.jobId, input.session.company!.id),
      refreshList ? api.list(input.session.token) : Promise.resolve(null),
    ]);
    if (!input.isCurrent() || version !== readVersion) return null;
    publish({ detail, loading: false });
    if (list) input.onList?.(list);
    return detail;
  };
  return {
    async refresh() {
      if (locked || !input.isCurrent()) return;
      locked = true;
      publish({ detail: null, loading: true, error: null, success: null });
      try { await read(); }
      catch (error) { publish({ detail: null, loading: false, error: error instanceof Error ? error.message : "Could not load Company Job detail." }); }
      finally { locked = false; }
    },
    async advance(target: JobSyncFieldStatus) {
      if (locked || !input.isCurrent()) return false;
      const reason = companyFieldworkBlockReason(input.session, state.detail);
      if (reason || nextCompanyFieldStatus(state.detail!.status) !== target) {
        publish({ error: reason ?? "Job progress changed. Refresh before retrying.", success: null });
        return false;
      }
      locked = true; // Synchronous lock protects repeated taps before React rerenders.
      publish({ pending: true, success: null, error: null });
      try {
        await api.status(input.session.token, input.jobId, { status: target, expectedUpdatedAt: state.detail!.updatedAt });
        if (!input.isCurrent()) return false;
        const detail = await read(true);
        if (!detail) return false;
        if (detail.status !== target) throw new Error("The backend acknowledged the request, but refreshed progress differs. Review the current Job before retrying.");
        publish({ success: "Job progress confirmed by the backend." });
        return true;
      } catch (error) {
        if (!input.isCurrent()) return false;
        const message = error instanceof Error ? error.message : "Could not update Company Job progress.";
        // Denial, 409 and ambiguous timeout/network outcomes all require authoritative reconciliation.
        publish({ detail: null, loading: true, success: null });
        try {
          await read(true);
          publish({ error: `${message} Current Job refreshed; review it before retrying.`, loading: false });
        } catch {
          publish({ detail: null, loading: false, error: `${message} Could not refresh. Progress is disabled until Refresh succeeds.` });
        }
        return false;
      } finally {
        locked = false;
        publish({ pending: false });
      }
    },
  };
}
