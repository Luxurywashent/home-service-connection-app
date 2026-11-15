import { useEffect, useRef, useState } from "react";
import { useIsFocused } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import {
  deleteJobSyncCompanyJobPhoto,
  getJobSyncCompanyJobDetail,
  getJobSyncMobileSession,
  uploadJobSyncCompanyJobPhoto,
  positiveJobSyncId,
  JobSyncApiError,
  type JobSyncCompanyJobDetail,
  type JobSyncNativeSession,
} from "./jobsync-mobile-api";
import { companyPhotoScope, currentCompanyGallery, canDeleteCompanyPhoto } from "./company-photo-view";
import { encodeCompanyPhotoDraft, LocalPhotoDraftError, type CompanyPhotoDraftInput, type LocalPhotoDraft } from "./company-photo-draft";

export type CompanyPhotoOperationState = {
  pending: boolean;
  message: string | null;
  error: string | null;
  detail: JobSyncCompanyJobDetail | null;
};
const empty: CompanyPhotoOperationState = { pending: false, message: null, error: null, detail: null };
const defaultApi = {
  session: getJobSyncMobileSession,
  detail: getJobSyncCompanyJobDetail,
  upload: uploadJobSyncCompanyJobPhoto,
  remove: deleteJobSyncCompanyJobPhoto,
};
export type CompanyPhotoOperationApi = typeof defaultApi;

/** One finite attempt. Never retries a mutation, synthesizes a photo, or treats refresh resolution as readback. */
export function createCompanyPhotoOperation(input: {
  session: JobSyncNativeSession;
  jobId: number;
  isCurrent: () => boolean;
  onState: (state: CompanyPhotoOperationState) => void;
  onRefresh: () => void | Promise<void>;
  api?: CompanyPhotoOperationApi;
  encode?: (draft: LocalPhotoDraft) => ReturnType<typeof encodeCompanyPhotoDraft>;
}) {
  const original = { ...input.session, user: { ...input.session.user }, company: input.session.company ? { ...input.session.company } : undefined };
  const api = input.api ?? defaultApi;
  let state = { ...empty };
  let locked = false;
  const publish = (patch: Partial<CompanyPhotoOperationState>) => {
    state = { ...state, ...patch };
    if (input.isCurrent()) input.onState(state);
  };
  const read = async () => {
    const [actor, detail] = await Promise.all([
      api.session(original.token),
      api.detail(original.token, input.jobId, original.company!.id),
    ]);
    if (!input.isCurrent()) return null;
    if (actor.portal !== "company" || actor.token !== original.token || actor.company?.id !== original.company?.id || actor.user.id !== original.user.id || actor.user.role !== original.user.role) {
      throw new Error("The signed Company identity or live role changed. Refresh your session before continuing.");
    }
    const photos = currentCompanyGallery({ session: actor, jobId: input.jobId, job: { detail, pending: false, loading: false, error: null } });
    if (photos === null || !Array.isArray(photos)) throw new Error("Could not verify this Company's current Job photos. Refresh before continuing.");
    const photoIds = detail.persistedPhotoIds;
    if (!Array.isArray(photoIds) || photoIds.some((id) => typeof id !== "number" || !positiveJobSyncId(id))
      || new Set(photoIds).size !== photoIds.length || photos.some((photo) => !photoIds.includes(photo.id))) {
      throw new Error("The backend did not provide a complete verifiable Job photo list. Refresh before continuing.");
    }
    return { actor, detail, photoIds };
  };
  const reconcile = async () => {
    // Caller refresh clears selection/drafts and updates the existing Job sheet. Its Promise can
    // resolve after a failed load, so independently read and verify the signed canonical DTO.
    try { await input.onRefresh(); } catch { /* Readback below is the authority, not this callback. */ }
    if (!input.isCurrent()) return null;
    return read();
  };
  const run = async (target: { draft: LocalPhotoDraft } | { photoId: number }) => {
    if (locked || !input.isCurrent()) return false;
    locked = true; // Lock before the first await (including encoding/preflight).
    publish({ pending: true, message: "Checking current Company Job photo access…", error: null, detail: null });
    let attempted = false;
    let acknowledged = false;
    let uploadedId: number | null = null;
    const upload = "draft" in target;
    try {
      const encoded = upload ? await (input.encode ?? ((draft) => encodeCompanyPhotoDraft(draft, FileSystem.getInfoAsync, (uri) => FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }))))(target.draft) : null;
      if (!input.isCurrent()) return false;
      const fresh = await read();
      if (!fresh || !input.isCurrent()) return false;
      if (!upload && !canDeleteCompanyPhoto({ session: fresh.actor, jobId: input.jobId, job: { detail: fresh.detail, loading: false, pending: false, error: null } }, target.photoId)) {
        throw new Error("This photo is no longer available for removal by your signed account. Review the refreshed Job.");
      }
      if (!input.isCurrent()) return false;
      publish({ message: upload ? "Sending photo…" : "Removing photo from this Job…" });
      attempted = true;
      if (upload) {
        const response = await api.upload(original.token, input.jobId, encoded!);
        if (!input.isCurrent()) return false;
        const photo = response?.photo;
        if (!photo || typeof photo.id !== "number" || !positiveJobSyncId(photo.id) || typeof photo.uploadedByUserId !== "number" || photo.uploadedByUserId !== original.user.id || typeof photo.imageUrl !== "string" || !/^https:\/\//.test(photo.imageUrl)) throw new Error("The backend did not provide a valid photo acknowledgement.");
        uploadedId = photo.id;
      } else {
        const response = await api.remove(original.token, input.jobId, target.photoId);
        if (!input.isCurrent()) return false;
        if (response?.success !== true) throw new Error("The backend did not acknowledge photo removal.");
      }
      acknowledged = true;
      publish({ message: "Reloading authoritative Job photos…" });
      const refreshed = await reconcile();
      if (!refreshed || !input.isCurrent()) return false;
      publish({ detail: refreshed.detail });
      if (upload ? !refreshed.detail.photos.some((photo) => photo.id === uploadedId) : refreshed.photoIds.includes(target.photoId)) {
        publish({ message: null, error: upload ? "Upload acknowledged, but the refreshed gallery does not confirm that photo. Review current photos before any deliberate new upload; it may still have been saved." : "Removal acknowledged, but the photo remains in the refreshed Job. Review current photos before trying again." });
        return false;
      }
      publish({ message: upload ? "Photo upload confirmed by fresh Company Job detail." : "Photo removed from this Job and absence confirmed by fresh detail.", error: null });
      return true;
    } catch (error) {
      if (!input.isCurrent()) return false;
      // Generic 400, malformed acknowledgements and timeouts can follow persistence. Never
      // promise rollback, correlate an unknown upload by caption, or automatically repeat POST/DELETE.
      let refreshed: Awaited<ReturnType<typeof read>> = null;
      try { refreshed = await reconcile(); } catch { /* Unavailable is not an empty gallery. */ }
      if (!input.isCurrent()) return false;
      const reason = error instanceof JobSyncApiError || error instanceof LocalPhotoDraftError ? `${error.message} ` : "";
      publish({ detail: refreshed?.detail ?? null, message: null, error: reason + (!attempted
        ? "Could not verify current access or read this photo. No photo request was sent. Refresh the signed Job before choosing a photo again."
        : upload
          ? `${acknowledged ? "Upload acknowledged, but confirmation failed." : "Upload outcome is uncertain; the photo may already have been saved."} ${refreshed ? "Current Job photos refreshed. Review them before deliberately choosing and uploading again; duplicates are possible." : "Could not refresh current photos. Refresh the signed Job before any new upload."}`
          : `${acknowledged ? "Removal acknowledged, but confirmation failed." : "Removal outcome is unconfirmed; it may already have occurred."} ${refreshed ? (refreshed.photoIds.includes((target as { photoId: number }).photoId) ? "The refreshed Job still contains this photo. Review before another confirmed attempt." : "The photo is absent from the refreshed Job, but this request was not confirmed.") : "Could not refresh current photos. Refresh the signed Job before another attempt."}`) });
      return false;
    } finally {
      locked = false;
      publish({ pending: false });
    }
  };
  return { upload: (draft: LocalPhotoDraft) => run({ draft }), remove: (photoId: number) => run({ photoId }) };
}

/** Lifecycle guard is independent of draft read-scope: our own post-write refresh consumes drafts,
 * but cannot cancel the safely captured operation. Blur/identity/pending/reassignment do cancel it. */
export function useCompanyPhotoOperation(input: CompanyPhotoDraftInput & { onRefresh: () => void | Promise<void> }) {
  const focused = useIsFocused();
  const scope = companyPhotoScope(input.session, input.jobId);
  const live = useRef({ input, focused, scope });
  live.current = { input, focused, scope };
  const mounted = useRef(true);
  const identity = useRef({ scope, focused, epoch: 0 });
  if (identity.current.scope !== scope || identity.current.focused !== focused) identity.current = { scope, focused, epoch: identity.current.epoch + 1 };
  const currentIdentity = identity.current;
  const [snapshot, setSnapshot] = useState<{ identity: typeof currentIdentity; state: CompanyPhotoOperationState; parentDetail: JobSyncCompanyJobDetail | null } | null>(null);
  const operation = useRef<ReturnType<typeof createCompanyPhotoOperation> | null>(null);
  const active = useRef(false);
  const cancelled = useRef(false);
  const ownRefresh = useRef(false);
  const startDetail = useRef(input.job.detail);
  const ticket = useRef(0);
  const cancelledSnapshot = useRef<typeof snapshot>(null);
  const operationIdentity = useRef(currentIdentity);
  if (operationIdentity.current !== currentIdentity) { operationIdentity.current = currentIdentity; operation.current = null; active.current = false; cancelled.current = false; ownRefresh.current = false; }
  // Parent pending (field write) and loss of accessible identity/assignment must invalidate even
  // when the caller later returns to the same context. Loading during our own readback is expected.
  if (active.current && !cancelled.current && (input.job.pending || (!ownRefresh.current && currentCompanyGallery(input) === null) || (input.job.detail && (input.job.detail.id !== input.jobId || input.job.detail.companyId !== input.session?.company?.id || (input.session?.user.role === "technician" && input.job.detail.assignedUserId !== input.session.user.id))))) {
    cancelled.current = true;
    ticket.current++;
    cancelledSnapshot.current = snapshot;
  }
  if (!active.current && cancelled.current && startDetail.current !== input.job.detail && currentCompanyGallery(input) !== null) cancelled.current = false;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isCurrent = () => mounted.current && identity.current === currentIdentity && live.current.focused && Boolean(scope) && live.current.scope === scope && !cancelled.current;
  const begin = (kind: "upload" | "remove", value: LocalPhotoDraft | number) => {
    if (!isCurrent() || blocked || active.current || currentCompanyGallery(live.current.input) === null || !input.session || !input.jobId) return Promise.resolve(false);
    active.current = true;
    startDetail.current = input.job.detail;
    ownRefresh.current = false;
    const expectedTicket = ++ticket.current;
    const operationCurrent = () => isCurrent() && ticket.current === expectedTicket;
    operation.current = createCompanyPhotoOperation({
      session: input.session, jobId: input.jobId, isCurrent: operationCurrent,
      onRefresh: () => { if (operationCurrent()) { ownRefresh.current = true; return live.current.input.onRefresh(); } },
      onState: (state) => {
        if (operationCurrent()) setSnapshot({ identity: currentIdentity, state, parentDetail: live.current.input.job.detail });
        if (!state.pending) active.current = false;
      },
    });
    const promise = kind === "upload" ? operation.current.upload(value as LocalPhotoDraft) : operation.current.remove(value as number);
    return promise.finally(() => { if (identity.current === currentIdentity) active.current = false; });
  };
  const state = snapshot && snapshot !== cancelledSnapshot.current && snapshot.identity === currentIdentity && focused && !cancelled.current ? snapshot.state : empty;
  // A later parent canonical refresh wins; never resurrect an earlier reconciled snapshot.
  const canonical = state.detail && snapshot?.parentDetail === input.job.detail && currentCompanyGallery(input) !== null ? state.detail : null;
  const blocked = cancelled.current || Boolean(state.error && !state.detail && snapshot?.parentDetail === input.job.detail);
  return { ...state, detail: canonical, blocked, focused, upload: (draft: LocalPhotoDraft) => begin("upload", draft), remove: (photoId: number) => begin("remove", photoId) };
}
