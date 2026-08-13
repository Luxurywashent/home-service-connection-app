export type JobSyncPortal = "company" | "platform";

/**
 * The authoritative JobSync / Home Service Connection web platform.
 * Authentication, company membership, and platform-owner access remain on
 * this service so the mobile shell never creates a second credential store.
 */
export const JOBSYNC_WEB_BASE_URL = "https://jobwash-veysiubh.manus.space";

export function getJobSyncPortalUrl(portal: JobSyncPortal): string {
  return portal === "platform"
    ? `${JOBSYNC_WEB_BASE_URL}/platform/login`
    : `${JOBSYNC_WEB_BASE_URL}/login`;
}

export function isJobSyncPortal(value: unknown): value is JobSyncPortal {
  return value === "company" || value === "platform";
}
