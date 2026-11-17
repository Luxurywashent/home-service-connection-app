import type {
  JobSyncCompanyJobDetail,
  JobSyncNativeSession,
} from "./jobsync-mobile-api";

/** Detail-only data. Never add this field to calendar, customer, invoice or payment DTOs. */
export type CompanyJobPrivateNotesDetail = JobSyncCompanyJobDetail & {
  /** undefined = unavailable/unverified; null or "" = a verified empty private note. */
  privateNotes?: string | null;
};

/** Verified wire fields from getJobDetail only; no fallback to notes/serviceNotes/customer data. */
export function normalizeCompanyJobPrivateNotes(
  row: Record<string, unknown>,
): string | null | undefined {
  const hasPrivate = Object.hasOwn(row, "private_notes");
  const hasInternal = Object.hasOwn(row, "internal_notes");
  if (!hasPrivate && !hasInternal) return undefined;
  const value = hasPrivate ? row.private_notes : row.internal_notes;
  if (hasPrivate && hasInternal && row.private_notes !== row.internal_notes)
    return undefined;
  return value === null || typeof value === "string" ? value : undefined;
}

/** Matches shared/privateNotes.ts formatPrivateNotes in both exact backend snapshots. */
export function formatCompanyJobPrivateNotes(value: string | null): string {
  if (value === null) return "";
  const trimmed = value.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const records: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      if (
        records.length &&
        records.every(
          (record) =>
            record !== null &&
            typeof record === "object" &&
            !Array.isArray(record),
        )
      ) {
        const text = records
          .map((record) => {
            const note = record as Record<string, unknown>;
            return typeof note.text === "string" ? note.text.trim() : "";
          })
          .filter(Boolean)
          .join("\n\n");
        if (text) return text;
      }
    } catch {
      /* Plain legacy text remains readable; no new note records are created. */
    }
  }
  return trimmed;
}

function validId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function companyJobPrivateNotesScope(
  session: JobSyncNativeSession | null,
  jobId: number | null,
): string | null {
  if (
    session?.portal !== "company" ||
    typeof session.token !== "string" ||
    !session.token.trim() ||
    /[\u0000-\u0020\u007f]/.test(session.token) ||
    !["owner", "dispatcher", "technician"].includes(session.user.role) ||
    !validId(session.company?.id) ||
    !validId(session.user.id) ||
    !validId(jobId)
  )
    return null;
  return JSON.stringify([
    session.portal,
    session.company.id,
    session.user.id,
    session.user.role,
    session.token,
    jobId,
  ]);
}

/** Backend getJob reads are tenant-scoped; technicians may read only their assigned Job. */
export function canReadCompanyJobPrivateNotes(
  session: JobSyncNativeSession | null,
  jobId: number | null,
  job: {
    detail: CompanyJobPrivateNotesDetail | null;
    actor: JobSyncNativeSession | null;
    loading: boolean;
    pending: boolean;
    error: string | null;
  },
): boolean {
  const scope = companyJobPrivateNotesScope(session, jobId);
  const detail = job.detail;
  return Boolean(
    scope &&
    scope === companyJobPrivateNotesScope(job.actor, jobId) &&
    !job.loading &&
    !job.pending &&
    !job.error &&
    detail?.id === jobId &&
    detail?.companyId === session?.company?.id &&
    (session?.user.role !== "technician" ||
      detail?.assignedUserId === session.user.id),
  );
}

/** No mobile REST edit route exists at 002e0b8f or a07b8077; never infer one from tRPC. */
export const COMPANY_PRIVATE_NOTES_EDIT_UNAVAILABLE =
  "Read-only on mobile. Private-note editing is not connected to the Company mobile API.";
