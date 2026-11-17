import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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

import { COMPANY_PHOTO_CATEGORIES, nextCompanyPhotoDisplayOrder, type CompanyPhotoMetadata } from "./company-photo-view";

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
    // Immutable intent: picker/UI changes cannot retag a photo while encoding or reading access.
    const draft = upload ? { ...target.draft } : null;
    let metadata: { category: NonNullable<LocalPhotoDraft["category"]>; displayOrder: number } | null = null;
    try {
      if (draft?.category !== undefined && !COMPANY_PHOTO_CATEGORIES.includes(draft.category))
        throw new LocalPhotoDraftError("Choose Before, After, Damage or Other for this photo.");
      const encoded = draft ? await (input.encode ?? ((value) => encodeCompanyPhotoDraft(value, FileSystem.getInfoAsync, (uri) => FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }))))(draft) : null;
      if (!input.isCurrent()) return false;
      const fresh = await read();
      if (!fresh || !input.isCurrent()) return false;
      if (draft?.category !== undefined) {
        try { metadata = { category: draft.category, displayOrder: nextCompanyPhotoDisplayOrder(fresh.detail) }; }
        catch { throw new LocalPhotoDraftError("Stored photo order is unavailable, invalid or at its supported limit. Refresh photos before uploading."); }
      }
      if (!upload && !canDeleteCompanyPhoto({ session: fresh.actor, jobId: input.jobId, job: { detail: fresh.detail, loading: false, pending: false, error: null } }, target.photoId)) {
        throw new Error("This photo is no longer available for removal by your signed account. Review the refreshed Job.");
      }
      if (!input.isCurrent()) return false;
      publish({ message: upload ? "Sending photo…" : "Removing photo from this Job…" });
      attempted = true;
      if (upload) {
        const payload = { ...encoded!, ...(metadata ?? {}) };
        const response = await api.upload(original.token, input.jobId, payload);
        if (!input.isCurrent()) return false;
        const photo = response?.photo;
        if (!photo || typeof photo.id !== "number" || !positiveJobSyncId(photo.id) || typeof photo.uploadedByUserId !== "number" || photo.uploadedByUserId !== original.user.id || typeof photo.imageUrl !== "string" || !/^https:\/\//.test(photo.imageUrl)) throw new Error("The backend did not provide a valid photo acknowledgement.");
        const returned = photo as typeof photo & CompanyPhotoMetadata;
        if (metadata && (returned.category !== metadata.category || returned.displayOrder !== metadata.displayOrder || fresh.photoIds.includes(photo.id)))
          throw new Error("The backend did not acknowledge this photo's category and display order.");
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
      const saved = refreshed.detail.photos.find((photo) => photo.id === uploadedId) as (JobSyncCompanyJobDetail["photos"][number] & CompanyPhotoMetadata) | undefined;
      const metadataConfirmed = !metadata || (saved?.uploadedByUserId === original.user.id && saved.category === metadata.category && saved.displayOrder === metadata.displayOrder);
      if (upload ? !saved || !metadataConfirmed : refreshed.photoIds.includes(target.photoId)) {
        publish({ message: null, error: upload ? "Upload acknowledged, but the refreshed gallery does not confirm that photo and its selected metadata. Review current photos before any deliberate new upload; it may still have been saved." : "Removal acknowledged, but the photo remains in the refreshed Job. Review current photos before trying again." });
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

type OperationIdentity = { scope: string | null; focused: boolean };
type OperationSnapshot = { identity: OperationIdentity; state: CompanyPhotoOperationState; parentDetail: JobSyncCompanyJobDetail | null };
function createOperationLifecycle() {
  let value = {
    identity: null as OperationIdentity | null, active: false, cancelled: false, ownRefresh: false,
    startDetail: null as JobSyncCompanyJobDetail | null, invalidSnapshot: null as OperationSnapshot | null, ticket: 0,
  };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update: (patch: Partial<typeof value>) => {
      value = { ...value, ...patch };
      listeners.forEach((listener) => listener());
    },
  };
}

/** Lifecycle guard is independent of draft read-scope: our own post-write refresh consumes drafts,
 * but cannot cancel the safely captured operation. Blur/identity/pending/reassignment do cancel it. */
export function useCompanyPhotoOperation(input: CompanyPhotoDraftInput & { onRefresh: () => void | Promise<void> }) {
  const focused = useIsFocused();
  const scope = companyPhotoScope(input.session, input.jobId);
  const live = useRef({ input, focused, scope });
  const mounted = useRef(true);
  const identity = useMemo(() => ({ scope, focused }), [scope, focused]);
  const lifecycle = useMemo(() => createOperationLifecycle(), []);
  const control = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshot, lifecycle.getSnapshot);
  const [snapshot, setSnapshot] = useState<OperationSnapshot | null>(null);
  const accessible = currentCompanyGallery(input) !== null;
  const mismatchedDetail = Boolean(input.job.detail && (input.job.detail.id !== input.jobId || input.job.detail.companyId !== input.session?.company?.id || (input.session?.user.role === "technician" && input.job.detail.assignedUserId !== input.session.user.id)));
  const invalidParent = input.job.pending || mismatchedDetail || (!control.ownRefresh && !accessible);
  // Mask old state during render; cancellation is published before callbacks in layout effects.
  const cancelled = control.identity === identity && (control.cancelled || (control.active && invalidParent));
  useLayoutEffect(() => {
    live.current = { input, focused, scope };
    const previous = lifecycle.getSnapshot();
    if (previous.identity !== identity) {
      lifecycle.update({ identity, active: false, cancelled: false, ownRefresh: false, ticket: previous.ticket + 1 });
    } else if (previous.active && !previous.cancelled && invalidParent) {
      lifecycle.update({ cancelled: true, invalidSnapshot: snapshot, ticket: previous.ticket + 1 });
    } else if (!previous.active && previous.cancelled && previous.startDetail !== input.job.detail && accessible) {
      lifecycle.update({ cancelled: false });
    }
  }, [input, focused, scope, identity, lifecycle, invalidParent, snapshot, accessible]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; lifecycle.update({ ticket: lifecycle.getSnapshot().ticket + 1 }); };
  }, [lifecycle]);
  const isCurrent = () => {
    const value = lifecycle.getSnapshot();
    const latest = live.current;
    return mounted.current && value.identity === identity && latest.focused && Boolean(scope) && latest.scope === scope && !value.cancelled && !latest.input.job.pending;
  };
  const begin = (kind: "upload" | "remove", value: LocalPhotoDraft | number) => {
    if (!isCurrent() || blocked || lifecycle.getSnapshot().active || currentCompanyGallery(live.current.input) === null || !input.session || !input.jobId) return Promise.resolve(false);
    const expectedTicket = lifecycle.getSnapshot().ticket + 1;
    lifecycle.update({ active: true, ownRefresh: false, startDetail: input.job.detail, ticket: expectedTicket });
    const operationCurrent = () => isCurrent() && lifecycle.getSnapshot().ticket === expectedTicket;
    const operation = createCompanyPhotoOperation({
      session: input.session, jobId: input.jobId, isCurrent: operationCurrent,
      onRefresh: () => { if (operationCurrent()) { lifecycle.update({ ownRefresh: true }); return live.current.input.onRefresh(); } },
      onState: (state) => {
        if (operationCurrent()) setSnapshot({ identity, state, parentDetail: live.current.input.job.detail });
      },
    });
    const promise = kind === "upload" ? operation.upload(value as LocalPhotoDraft) : operation.remove(value as number);
    return promise.finally(() => { if (lifecycle.getSnapshot().identity === identity) lifecycle.update({ active: false }); });
  };
  const state = snapshot && snapshot !== control.invalidSnapshot && snapshot.identity === identity && focused && !cancelled ? snapshot.state : empty;
  // A later parent canonical refresh wins; never resurrect an earlier reconciled snapshot.
  const canonical = state.detail && snapshot?.parentDetail === input.job.detail && currentCompanyGallery(input) !== null ? state.detail : null;
  const blocked = cancelled || Boolean(state.error && !state.detail && snapshot?.parentDetail === input.job.detail);
  return { ...state, detail: canonical, blocked, focused, upload: (draft: LocalPhotoDraft) => begin("upload", draft), remove: (photoId: number) => begin("remove", photoId) };
}
