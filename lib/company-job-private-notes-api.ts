import {
  getJobSyncCompanyJobDetail,
  getJobSyncMobileSession,
  JobSyncApiError,
  type JobSyncNativeSession,
} from "./jobsync-mobile-api";
import {
  canReadCompanyJobPrivateNotes,
  companyJobPrivateNotesScope,
  canEditCompanyJobPrivateNotes,
  validCompanyJobPrivateNoteInput,
  normalizeCompanyJobPrivateNotesVersion,
  type CompanyJobPrivateNotesDetail,
} from "./company-job-private-notes";

/** Parent supplies the one existing bearer transport; no second fetch/origin implementation. */
export type CompanyJobPrivateNotesWriter = (
  token: string,
  jobId: number,
  privateNotes: string,
  expectedUpdatedAt: string,
) => Promise<unknown>;
export type CompanyJobPrivateNotesTransport = {
  session: typeof getJobSyncMobileSession;
  detail: typeof getJobSyncCompanyJobDetail;
};
const transport: CompanyJobPrivateNotesTransport = {
  session: getJobSyncMobileSession,
  detail: getJobSyncCompanyJobDetail,
};

// Actor/Company/Job locks deliberately exclude token/role and survive sheet remounts.
// Only identities/flags live here, never note text, signed tokens, drafts or response bodies.
const writes = new Set<string>();
const unresolved = new Set<string>();
function operationKey(session: JobSyncNativeSession, jobId: number): string {
  return JSON.stringify([session.company?.id, session.user.id, jobId]);
}
export function companyJobPrivateNotesWriteBlocked(
  session: JobSyncNativeSession | null,
  jobId: number | null,
): boolean {
  if (!companyJobPrivateNotesScope(session, jobId)) return true;
  const key = operationKey(session!, jobId!);
  return writes.has(key) || unresolved.has(key);
}

/** Exact 2818bb72 acknowledgment, with a verified canonical version; no aliases/coercion. */
export function verifyCompanyJobPrivateNotesAck(
  payload: unknown,
  jobId: number,
  privateNotes: string,
  expectedUpdatedAt?: string,
): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return false;
  const row = payload as Record<string, unknown>;
  const version = normalizeCompanyJobPrivateNotesVersion(row.updatedAt);
  const baseline = normalizeCompanyJobPrivateNotesVersion(expectedUpdatedAt);
  return (
    Object.hasOwn(row, "success") &&
    row.success === true &&
    Object.hasOwn(row, "jobId") &&
    row.jobId === jobId &&
    Object.hasOwn(row, "privateNotes") &&
    row.privateNotes === privateNotes &&
    Object.hasOwn(row, "updatedAt") &&
    version !== null &&
    (expectedUpdatedAt === undefined ||
      (baseline !== null && Date.parse(version) > Date.parse(baseline)))
  );
}

export type CompanyJobPrivateNotesSaveResult = {
  status: "saved" | "blocked" | "conflict" | "uncertain" | "stale";
  /** Generic safe message only; never interpolate backend text or the submitted note. */
  message: string;
};

function knownVersion(detail: CompanyJobPrivateNotesDetail): boolean {
  return normalizeCompanyJobPrivateNotesVersion(detail.updatedAt) !== null;
}

/** Narrow finite controller: one PATCH at most; no automatic retry, persistence or public DTO. */
export function createCompanyJobPrivateNotesController(input: {
  session: JobSyncNativeSession;
  jobId: number;
  detail: CompanyJobPrivateNotesDetail;
  isCurrent: () => boolean;
  write: CompanyJobPrivateNotesWriter;
  api?: CompanyJobPrivateNotesTransport;
}) {
  const original = {
    ...input.session,
    user: { ...input.session.user },
    company: input.session.company ? { ...input.session.company } : undefined,
  };
  const baseline = { ...input.detail };
  const scope = companyJobPrivateNotesScope(original, input.jobId);
  const key = operationKey(original, input.jobId);
  const api = input.api ?? transport;
  let consumed = false;
  let locked = false;
  const result = (
    status: CompanyJobPrivateNotesSaveResult["status"],
    message: string,
  ) => ({ status, message });
  const current = () => Boolean(scope) && input.isCurrent();
  async function read(): Promise<CompanyJobPrivateNotesDetail | null> {
    if (!current()) return null;
    const actor = await api.session(original.token);
    if (!current()) return null;
    if (companyJobPrivateNotesScope(actor, input.jobId) !== scope)
      throw new Error("Current Company identity could not be verified.");
    const detail = await api.detail(
      original.token,
      input.jobId,
      original.company!.id,
    );
    if (!current()) return null;
    if (
      !canReadCompanyJobPrivateNotes(original, input.jobId, {
        actor,
        detail,
        loading: false,
        pending: false,
        error: null,
      }) ||
      !knownVersion(detail) ||
      (typeof detail.privateNotes !== "string" && detail.privateNotes !== null)
    )
      throw new Error("Current private notes could not be verified.");
    return detail;
  }
  return {
    async refresh(): Promise<boolean> {
      if (locked || writes.has(key) || !current()) return false;
      locked = true;
      try {
        const detail = await read();
        if (!detail || !current()) return false;
        unresolved.delete(key);
        return true;
      } catch {
        return false;
      } finally {
        locked = false;
      }
    },
    async save(
      privateNotes: string,
    ): Promise<CompanyJobPrivateNotesSaveResult> {
      if (
        locked ||
        consumed ||
        companyJobPrivateNotesWriteBlocked(original, input.jobId) ||
        !current()
      )
        return result(
          "blocked",
          "Refresh and review private notes before editing again.",
        );
      if (
        !validCompanyJobPrivateNoteInput(privateNotes) ||
        !knownVersion(baseline) ||
        !canEditCompanyJobPrivateNotes(original, input.jobId, {
          actor: original,
          detail: baseline,
          loading: false,
          pending: false,
          error: null,
        })
      )
        return result(
          "blocked",
          "Private notes cannot be edited from this unverified Job.",
        );
      locked = true;
      writes.add(key); // Synchronous before any await, including fresh-read transport.
      let attempted = false;
      try {
        const fresh = await read();
        if (!fresh || !current())
          return result("stale", "Private-note editing was interrupted.");
        if (
          !knownVersion(fresh) ||
          normalizeCompanyJobPrivateNotesVersion(fresh.updatedAt) !==
            normalizeCompanyJobPrivateNotesVersion(baseline.updatedAt) ||
          fresh.privateNotes !== baseline.privateNotes ||
          fresh.assignedUserId !== baseline.assignedUserId
        )
          return result(
            "conflict",
            "This Job or its private notes changed. Refresh and review before editing.",
          );
        if (!current())
          return result("stale", "Private-note editing was interrupted.");
        // Exact new strict endpoint supports the canonical GET version in its atomic UPDATE predicate.
        const expectedUpdatedAt = normalizeCompanyJobPrivateNotesVersion(baseline.updatedAt)!;
        consumed = true;
        attempted = true;
        unresolved.add(key);
        const ack = await input.write(
          original.token,
          input.jobId,
          privateNotes,
          expectedUpdatedAt,
        );
        if (!current())
          return result("stale", "Private-note editing was interrupted.");
        const acknowledged = verifyCompanyJobPrivateNotesAck(
          ack,
          input.jobId,
          privateNotes,
          expectedUpdatedAt,
        );
        const detail = await read(); // Independent canonical readback even for malformed acknowledgments.
        if (!detail || !current())
          return result("stale", "Private-note editing was interrupted.");
        if (
          !acknowledged ||
          !knownVersion(detail) ||
          detail.privateNotes !== privateNotes ||
          normalizeCompanyJobPrivateNotesVersion(detail.updatedAt) !==
            normalizeCompanyJobPrivateNotesVersion((ack as Record<string, unknown>).updatedAt)
        )
          return result(
            "uncertain",
            "Save could not be confirmed. Refresh and review current private notes; do not resend blindly.",
          );
        unresolved.delete(key);
        return result("saved", "Private notes saved and verified.");
      } catch (error) {
        if (!current()) return result("stale", "Private-note editing was interrupted.");
        if (attempted && error instanceof JobSyncApiError && error.status === 409 && error.code === "CONFLICT")
          return result(
            "conflict",
            "This Job changed elsewhere. Refresh and review current private notes before editing; this save was not confirmed.",
          );
        // A failed preflight never writes. Any attempted PATCH may have committed, even after 4xx/5xx.
        return attempted
          ? result(
              "uncertain",
              "Save could not be confirmed. Refresh and review current private notes; do not resend blindly.",
            )
          : result(
              "blocked",
              "Fresh Company access or Job detail could not be verified. Refresh before editing.",
            );
      } finally {
        locked = false;
        writes.delete(key); // Transport must settle before a reopened sheet/token may write.
      }
    },
  };
}
