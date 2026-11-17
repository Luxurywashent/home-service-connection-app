import {
  JobSyncApiError, positiveJobSyncId,
  type JobSyncCompanyJobDetail, type JobSyncNativeSession,
} from "./jobsync-mobile-api";
import { companyJobActorBlockReason } from "./company-job-fieldwork";

/** Exact c5758ae6 tag DTO; neither Job timestamps nor tag timestamps are versions. */
export type CompanyJobTag = {
  id: number; jobId: number; displayName: string; normalizedName: string; createdBy: number;
  createdAt: string | null; updatedAt: string | null;
};
export type CompanyJobTagDeleteAcknowledgment = { success: true; tagId: number; jobId: number };
/** Inject the canonical bearer adapter. No fetch, legacy fallback, storage or automatic write retry. */
export type CompanyJobTagsTransport = {
  session: (token: string) => Promise<JobSyncNativeSession>;
  detail: (token: string, jobId: number, companyId: number) => Promise<JobSyncCompanyJobDetail>;
  list: (token: string, jobId: number) => Promise<CompanyJobTag[]>;
  add: (token: string, jobId: number, input: { name: string }) => Promise<CompanyJobTag>;
  remove: (token: string, jobId: number, tagId: number) => Promise<CompanyJobTagDeleteAcknowledgment>;
};
export type CompanyJobTagsState = {
  tags: CompanyJobTag[] | null; actor: JobSyncNativeSession | null; detail: JobSyncCompanyJobDetail | null;
  loading: boolean; pending: boolean; error: string | null; success: string | null; reviewRequired: boolean;
};
export const emptyCompanyJobTagsState: CompanyJobTagsState = {
  tags: null, actor: null, detail: null, loading: false, pending: false, error: null, success: null, reviewRequired: false,
};
const REVIEW_MESSAGE = "Tag outcome unconfirmed. Review the refreshed tags before trying again; do not repeat the request blindly.";
const BUSY_MESSAGE = "Another tag operation for this Company Job is still in flight. Wait before refreshing or changing tags.";
const validId = (value: unknown): value is number => typeof value === "number" && positiveJobSyncId(value) !== null;

/** Backend normalization order, including UTF-16 length after NFKC/whitespace folding. */
export function normalizeCompanyJobTagName(value: string) {
  if (typeof value !== "string") throw new Error("Tag name is required.");
  const displayName = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!displayName) throw new Error("Tag name is required.");
  if (displayName.length > 64) throw new Error("Tag name must be 64 characters or fewer.");
  if (Array.from(displayName).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error("Tag name contains an unsupported control character.");
  }
  return { displayName, normalizedName: displayName.toLocaleLowerCase("en-US") };
}

/** Token/role changes isolate a view, but do not create a new mutation lock identity. */
export function companyJobTagsSessionKey(session: JobSyncNativeSession | null, jobId: number | null): string | null {
  return session?.portal === "company" && typeof session.token === "string" && session.token.trim()
    && validId(session.company?.id) && validId(session.user.id) && validId(jobId)
    && ["owner", "dispatcher", "technician"].includes(session.user.role)
    ? JSON.stringify([session.company.id, session.user.id, session.user.role, session.token, jobId]) : null;
}

/** Independent tag policy: never inherit status/terminal/calendar/payment authority. */
export function companyJobTagsBlockReason(session: JobSyncNativeSession | null, actor: JobSyncNativeSession | null,
  detail: JobSyncCompanyJobDetail | null, jobId: number | null): string | null {
  if (!companyJobTagsSessionKey(session, jobId)) return "A signed Company Job session is required for tags.";
  const actorReason = companyJobActorBlockReason(session, actor);
  if (actorReason) return actorReason;
  if (!detail || detail.id !== jobId || detail.companyId !== session!.company!.id) return "Could not verify this Company's Job. Refresh tags before continuing.";
  // Exact 66141 Company Job tags are tenant-scoped, not assignee-scoped.
  return null;
}

function canonicalTag(value: unknown, jobId: number): value is CompanyJobTag {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const tag = value as CompanyJobTag;
  if (!validId(tag.id) || tag.jobId !== jobId || !validId(tag.createdBy)
    || typeof tag.displayName !== "string" || typeof tag.normalizedName !== "string"
    || !(tag.createdAt === null || (typeof tag.createdAt === "string" && Boolean(tag.createdAt.trim())))
    || !(tag.updatedAt === null || (typeof tag.updatedAt === "string" && Boolean(tag.updatedAt.trim())))) return false;
  try {
    const name = normalizeCompanyJobTagName(tag.displayName);
    return name.displayName === tag.displayName && name.normalizedName === tag.normalizedName;
  } catch { return false; }
}
function verifyTags(tags: unknown, jobId: number): CompanyJobTag[] {
  if (!Array.isArray(tags) || !tags.every((tag) => canonicalTag(tag, jobId))
    || new Set(tags.map((tag) => tag.id)).size !== tags.length
    || new Set(tags.map((tag) => tag.normalizedName)).size !== tags.length) {
    throw new JobSyncApiError("The canonical tag collection could not be verified.", null, "INVALID_RESPONSE");
  }
  return tags.map((tag) => ({ ...tag })); // Preserve canonical server order, timestamps and names.
}
function errorHint(error: unknown): string {
  if (error instanceof JobSyncApiError) {
    if (error.status === 401) return "Company session expired. Sign in again, then refresh tags.";
    if (error.status === 403 || error.status === 404) return "Job tags are unavailable or access was denied. Ask a Company admin, then refresh.";
    if (error.status === 409 || error.status === 412) return "Tag conflict. A duplicate or changed tag may exist; review the canonical tags.";
    if (error.status === 503 || error.code === "INVALID_RESPONSE") return "The backend tag API or its response is unavailable. Refresh tags when available.";
  }
  return "Could not verify Company Job tags. Refresh before continuing.";
}

// Only in-flight/review flags and listeners; no tags, bearer credentials, suggestions or persistence.
// Deliberately excludes bearer token and role, so remount/rotation cannot bypass an in-flight write.
type Guard = { pending: boolean; reviewRequired: boolean; listeners: Set<() => void> };
const guards = new Map<string, Guard>();
function getGuard(key: string): Guard {
  let guard = guards.get(key);
  if (!guard) { guard = { pending: false, reviewRequired: false, listeners: new Set() }; guards.set(key, guard); }
  return guard;
}
function notify(guard: Guard) { guard.listeners.forEach((listener) => listener()); }
function releaseUnused(key: string, guard: Guard) {
  if (!guard.pending && !guard.reviewRequired && guard.listeners.size === 0 && guards.get(key) === guard) guards.delete(key);
}

/** Finite lifecycle-isolated controller. Caller must dispose on lifecycle/sheet invalidation.
 * Every mutation refreshes actor, Company Job and canonical tags, checks authority again,
 * accepts only an exact acknowledgment, then verifies persisted state with GET.
 * Exact backend offers no atomic assignment/version/idempotency guarantee; never invent one.
 */
export function createCompanyJobTagsController(input: {
  session: JobSyncNativeSession; jobId: number; api: CompanyJobTagsTransport;
  isCurrent: () => boolean; onState: (state: CompanyJobTagsState) => void;
}) {
  const original = { ...input.session, user: { ...input.session.user }, company: input.session.company ? { ...input.session.company } : undefined };
  const scope = companyJobTagsSessionKey(original, input.jobId);
  const guardKey = JSON.stringify([original.company?.id, original.user.id, input.jobId]);
  const guard = getGuard(guardKey);
  const api = input.api;
  let state: CompanyJobTagsState = { ...emptyCompanyJobTagsState };
  let busy = false;
  let writing = false;
  let stopped = false;
  let readGeneration = 0;
  // Once false has been observed this controller can never revive, even if a parent returns true.
  const current = () => {
    if (!stopped && !input.isCurrent()) stopped = true;
    return !stopped;
  };
  const publish = (patch: Partial<CompanyJobTagsState>) => {
    state = { ...state, ...patch, pending: guard.pending, reviewRequired: guard.reviewRequired };
    if (current()) input.onState(state);
  };
  const listener = () => {
    if (guard.pending && !writing) readGeneration++;
    publish({
      ...(guard.pending && !writing ? { tags: null, actor: null, detail: null, success: null } : {}),
      ...(guard.reviewRequired ? { success: null, error: REVIEW_MESSAGE } : {}),
    });
  };
  guard.listeners.add(listener);
  const invalidateCollection = () => publish({ tags: null, actor: null, detail: null, success: null });
  const read = async () => {
    if (!scope || !current()) return null;
    const generation = ++readGeneration;
    const [actor, detail, tags] = await Promise.all([
      api.session(original.token), api.detail(original.token, input.jobId, original.company!.id), api.list(original.token, input.jobId),
    ]);
    if (!current() || generation !== readGeneration) return null;
    const reason = companyJobTagsBlockReason(original, actor, detail, input.jobId);
    if (reason) throw new Error(reason);
    const canonical = verifyTags(tags, input.jobId);
    publish({ actor, detail, tags: canonical, loading: false });
    return { actor, detail, tags: canonical };
  };
  const refresh = async (review: boolean) => {
    if (!current() || busy) return;
    if (!scope) { publish({ ...emptyCompanyJobTagsState, error: "A signed Company Job session is required for tags." }); return; }
    if (guard.pending) { publish({ error: BUSY_MESSAGE }); return; }
    busy = true;
    invalidateCollection();
    publish({ loading: true, error: guard.reviewRequired ? REVIEW_MESSAGE : null });
    try {
      const fresh = await read();
      if (!fresh || !current()) return;
      if (review) { guard.reviewRequired = false; notify(guard); }
      publish({ error: guard.reviewRequired ? REVIEW_MESSAGE : null });
    } catch (error) {
      invalidateCollection();
      publish({ error: errorHint(error) });
    } finally { busy = false; publish({ loading: false }); }
  };
  const write = async (operation: { name: string } | { tagId: number }): Promise<boolean> => {
    if (!current() || busy || !scope) return false;
    if (guard.pending || guard.reviewRequired) { publish({ error: guard.pending ? BUSY_MESSAGE : REVIEW_MESSAGE }); return false; }
    const reason = companyJobTagsBlockReason(original, state.actor, state.detail, input.jobId);
    if (reason || state.tags === null) { publish({ error: reason ?? "Refresh the canonical tags before changing them.", success: null }); return false; }
    let name: ReturnType<typeof normalizeCompanyJobTagName> | null = null;
    if ("name" in operation) {
      try { name = normalizeCompanyJobTagName(operation.name); }
      catch (error) { publish({ error: error instanceof Error ? error.message : "Invalid tag name.", success: null }); return false; }
    } else if (!validId(operation.tagId)) { publish({ error: "A canonical tag identifier is required.", success: null }); return false; }
    // Synchronous shared lock is acquired before any await; all controllers see it immediately.
    busy = true;
    writing = true;
    guard.pending = true;
    notify(guard);
    invalidateCollection();
    publish({ error: null, success: null });
    let attempted = false;
    try {
      const fresh = await read();
      if (!fresh || !current()) return false;
      if (name && fresh.tags.some((tag) => tag.normalizedName === name!.normalizedName)) {
        publish({ error: "That tag already exists on this Job." }); return false;
      }
      if ("tagId" in operation && !fresh.tags.some((tag) => tag.id === operation.tagId)) {
        publish({ error: "That tag is no longer in the canonical collection. Review the refreshed tags." }); return false;
      }
      if (!current()) return false;
      attempted = true;
      guard.reviewRequired = true; // A stale/lost lifecycle after dispatch must retain uncertainty.
      notify(guard);
      let added: CompanyJobTag | null = null;
      if (name) {
        const acknowledgment = await api.add(original.token, input.jobId, { name: name.displayName });
        if (!canonicalTag(acknowledgment, input.jobId) || acknowledgment.displayName !== name.displayName
          || acknowledgment.normalizedName !== name.normalizedName || acknowledgment.createdBy !== fresh.actor.user.id) {
          throw new JobSyncApiError("Tag add acknowledgment could not be verified.", null, "INVALID_RESPONSE");
        }
        added = acknowledgment;
      } else if ("tagId" in operation) {
        const acknowledgment = await api.remove(original.token, input.jobId, operation.tagId);
        if (acknowledgment?.success !== true || acknowledgment.jobId !== input.jobId || acknowledgment.tagId !== operation.tagId) {
          throw new JobSyncApiError("Tag remove acknowledgment could not be verified.", null, "INVALID_RESPONSE");
        }
      }
      if (!current()) return false;
      invalidateCollection();
      publish({ loading: true });
      const persisted = await read();
      if (!persisted || !current()) return false;
      const confirmed = added ? persisted.tags.some((tag) => tag.id === added!.id && tag.displayName === added!.displayName
        && tag.normalizedName === added!.normalizedName && tag.createdBy === added!.createdBy)
        : "tagId" in operation && !persisted.tags.some((tag) => tag.id === operation.tagId);
      if (!confirmed) throw new JobSyncApiError("Refreshed tags differ from the acknowledgment.", null, "INVALID_RESPONSE");
      guard.reviewRequired = false;
      notify(guard);
      publish({ error: null, success: added ? "Tag added and confirmed by the backend." : "Tag removed and confirmed by the backend." });
      return true;
    } catch (error) {
      invalidateCollection();
      if (!current()) return false;
      if (attempted) {
        // GET reconciliation only: never repeat POST/DELETE, even on a known conflict/denial.
        try { await read(); } catch { invalidateCollection(); }
        publish({ error: `${errorHint(error)} ${REVIEW_MESSAGE}`, success: null });
      } else publish({ error: errorHint(error) });
      return false;
    } finally {
      busy = false;
      writing = false;
      guard.pending = false;
      notify(guard);
      publish({ loading: false });
      releaseUnused(guardKey, guard);
    }
  };
  return {
    refresh: () => refresh(false),
    /** Explicit user review performs fresh GETs; automatic refresh cannot clear uncertain outcomes. */
    review: () => refresh(true),
    add: (name: string) => write({ name }),
    remove: (tagId: number) => write({ tagId }),
    dispose: () => { stopped = true; readGeneration++; guard.listeners.delete(listener); releaseUnused(guardKey, guard); },
  };
}
export type CompanyJobTagsController = ReturnType<typeof createCompanyJobTagsController>;
