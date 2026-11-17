import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useIsFocused } from "expo-router";
import * as NativeRuntime from "react-native";
import {
  LocalPhotoDraftError,
  prepareCompanyPhotoDraft,
  type CompanyPhotoDraftInput,
  type LocalPhotoCandidate,
  type LocalPhotoDraft,
  type ReadLocalFileInfo,
} from "./company-photo-draft";
import { companyPhotoScope, currentCompanyGallery } from "./company-photo-view";
import { createCompanyPhotoOperation, type CompanyPhotoOperationState } from "./company-photo-operation";

/** Category is captured with each selection, never inferred from Job status or captions.
 * Only fresh canonical metadata readback confirms persistence on the f3576bcb contract. */
export type CompanyPhotoBatchDraft = LocalPhotoDraft & {
  assetKeys: string[];
};
export type CompanyPhotoPickerAsset = LocalPhotoCandidate & { assetId?: string | null };
export type CompanyPhotoBatchResult = {
  confirmed: number;
  total: number;
  remaining: CompanyPhotoBatchDraft[];
  stopped: boolean;
};

export async function prepareCompanyPhotoBatch(
  assets: CompanyPhotoPickerAsset[],
  getInfo: ReadLocalFileInfo,
  isCurrent: () => boolean,
  category?: CompanyPhotoBatchDraft["category"],
) {
  const seen = new Set<string>();
  const drafts: CompanyPhotoBatchDraft[] = [];
  const errors: string[] = [];
  let duplicates = 0;
  for (const asset of assets) {
    if (!isCurrent()) return { drafts: [], errors: [], duplicates };
    const keys = [typeof asset.uri === "string" ? `uri:${asset.uri}` : "", asset.assetId ? `asset:${asset.assetId}` : ""].filter(Boolean);
    if (keys.some((key) => seen.has(key))) { duplicates++; continue; }
    keys.forEach((key) => seen.add(key));
    try {
      const draft = await prepareCompanyPhotoDraft(asset, getInfo);
      if (!isCurrent()) return { drafts: [], errors: [], duplicates };
      drafts.push({ ...draft, assetKeys: keys, ...(category ? { category } : {}) });
    } catch (error) {
      errors.push(error instanceof LocalPhotoDraftError ? error.message : "Could not prepare this local photo. Choose another photo and retry.");
    }
  }
  return { drafts, errors, duplicates };
}

// Memory-only actor locks survive component disposal and token/role rotation. Do not reset
// a still-running transport on blur/unmount. No token, image bytes or draft URI is persisted.
const activeActors = new Set<string>();
const lockListeners = new Set<() => void>();
const subscribeLocks = (listener: () => void) => { lockListeners.add(listener); return () => { lockListeners.delete(listener); }; };
const notifyLocks = () => lockListeners.forEach((listener) => listener());
function actorKey(input: CompanyPhotoDraftInput) {
  return input.session?.portal === "company" && input.session.company && input.jobId
    ? `${input.session.company.id}:${input.session.user.id}:${input.jobId}` : null;
}
export function companyPhotoBatchLocked(input: CompanyPhotoDraftInput) {
  const key = actorKey(input);
  return key ? activeActors.has(key) : false;
}

/** Stop at the first unconfirmed result. The attempted asset is consumed, not offered for
 * retry: even a timeout/400 may follow persistence. Only never-started drafts are retained. */
export async function uploadCompanyPhotoBatch(input: {
  actor: string;
  drafts: CompanyPhotoBatchDraft[];
  isCurrent: () => boolean;
  uploadOne: (draft: LocalPhotoDraft) => Promise<boolean>;
  onProgress: (confirmed: number, total: number, index: number) => void;
}): Promise<CompanyPhotoBatchResult> {
  const total = input.drafts.length;
  if (activeActors.has(input.actor) || !input.isCurrent()) return { confirmed: 0, total, remaining: input.drafts, stopped: true };
  activeActors.add(input.actor); // Synchronous: protects taps and reopened instances before await.
  notifyLocks();
  const consumed = new Set<string>();
  let confirmed = 0;
  try {
    for (let index = 0; index < total; index++) {
      if (!input.isCurrent()) return { confirmed, total, remaining: [], stopped: true };
      const draft = input.drafts[index];
      if (draft.assetKeys.some((key) => consumed.has(key))) {
        return { confirmed, total, remaining: input.drafts.slice(index + 1), stopped: true };
      }
      draft.assetKeys.forEach((key) => consumed.add(key));
      input.onProgress(confirmed, total, index + 1);
      let saved = false;
      try { saved = await input.uploadOne(draft); } catch { /* An external callback may fail after dispatch; never retry. */ }
      if (!input.isCurrent()) return { confirmed, total, remaining: [], stopped: true };
      if (!saved) return { confirmed, total, remaining: input.drafts.slice(index + 1), stopped: true };
      confirmed++;
      input.onProgress(confirmed, total, index + 1);
    }
    return { confirmed, total, remaining: [], stopped: false };
  } finally { activeActors.delete(input.actor); notifyLocks(); }
}

const empty: CompanyPhotoOperationState = { pending: false, message: null, error: null, detail: null };
// Older local RN test hosts have no AppState. Native production always uses the actual API.
const appState = "AppState" in NativeRuntime ? NativeRuntime.AppState : undefined;

type BatchIdentity = { scope: string | null; focused: boolean };
type BatchSnapshot = { identity: BatchIdentity; state: CompanyPhotoOperationState; parentDetail: CompanyPhotoDraftInput["job"]["detail"] };

// A memory-only lifecycle store publishes immutable render snapshots. Its synchronous methods
// are used only by committed layout effects and callbacks, never to mutate during render.
function createBatchLifecycle() {
  let value = {
    identity: null as BatchIdentity | null,
    active: false, cancelled: false, ownRefresh: false,
    startDetail: null as CompanyPhotoDraftInput["job"]["detail"],
    invalidSnapshot: null as BatchSnapshot | null,
    ticket: 0,
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

/** The existing one-shot operation owns bytes, fresh authority, POST and signed readback.
 * This wrapper owns only queue order and the same focus/identity/current-Job invalidation. */
export function useCompanyPhotoBatch(input: CompanyPhotoDraftInput & { onRefresh: () => void | Promise<void> }) {
  const focused = useIsFocused();
  const scope = companyPhotoScope(input.session, input.jobId);
  const actorLocked = useSyncExternalStore(subscribeLocks, () => companyPhotoBatchLocked(input), () => false);
  const identity = useMemo(() => ({ scope, focused }), [scope, focused]);
  const lifecycle = useMemo(() => createBatchLifecycle(), []);
  const control = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshot, lifecycle.getSnapshot);
  const mounted = useRef(true);
  const live = useRef({ input, focused, scope });
  const [snapshot, setSnapshot] = useState<BatchSnapshot | null>(null);
  const latestSnapshot = useRef(snapshot);
  const [progress, setProgress] = useState<{ identity: BatchIdentity; confirmed: number; total: number; index: number } | null>(null);
  const accessible = currentCompanyGallery(input) !== null;
  const mismatchedDetail = Boolean(input.job.detail && (input.job.detail.id !== input.jobId || input.job.detail.companyId !== input.session?.company?.id || (input.session?.user.role === "technician" && input.job.detail.assignedUserId !== input.session.user.id)));
  const invalidParent = input.job.pending || mismatchedDetail || (!control.ownRefresh && !accessible);
  // Render masking takes effect before layout publication: inaccessible old state never flashes.
  const cancelled = control.identity === identity && (control.cancelled || (control.active && invalidParent));
  useLayoutEffect(() => {
    live.current = { input, focused, scope };
    latestSnapshot.current = snapshot;
    const previous = lifecycle.getSnapshot();
    if (previous.identity !== identity) {
      lifecycle.update({ identity, active: false, cancelled: false, ownRefresh: false, ticket: previous.ticket + 1 });
    } else if (previous.active && !previous.cancelled && invalidParent) {
      lifecycle.update({ cancelled: true, invalidSnapshot: snapshot, ticket: previous.ticket + 1 });
    } else if (!previous.active && previous.cancelled && previous.startDetail !== input.job.detail && accessible) {
      lifecycle.update({ cancelled: false });
    }
  }, [input, focused, scope, identity, snapshot, lifecycle, invalidParent, accessible]);
  useLayoutEffect(() => {
    mounted.current = true;
    const subscription = appState?.addEventListener("change", (state) => {
      const previous = lifecycle.getSnapshot();
      if (state !== "active" && previous.active) lifecycle.update({ cancelled: true, invalidSnapshot: latestSnapshot.current, ticket: previous.ticket + 1 });
    });
    return () => { mounted.current = false; lifecycle.update({ ticket: lifecycle.getSnapshot().ticket + 1 }); subscription?.remove(); };
  }, [lifecycle]);
  const isCurrent = () => {
    const value = lifecycle.getSnapshot();
    const currentInput = live.current.input;
    const detail = currentInput.job.detail;
    return mounted.current && value.identity === identity && live.current.focused && live.current.scope === scope && Boolean(scope) && !value.cancelled && !currentInput.job.pending && (!detail || (detail.id === currentInput.jobId && detail.companyId === currentInput.session?.company?.id && (currentInput.session?.user.role !== "technician" || detail.assignedUserId === currentInput.session.user.id))) && (value.ownRefresh || currentCompanyGallery(currentInput) !== null) && (!appState?.currentState || appState.currentState === "active");
  };
  const visible = snapshot && snapshot !== control.invalidSnapshot && snapshot.identity === identity && focused && !cancelled;
  const state = visible ? snapshot.state : empty;
  const blocked = cancelled || actorLocked || Boolean(state.error && !state.detail && snapshot?.parentDetail === input.job.detail);
  const upload = async (drafts: CompanyPhotoBatchDraft[]): Promise<CompanyPhotoBatchResult> => {
    const actor = actorKey(input);
    const denied = { confirmed: 0, total: drafts.length, remaining: drafts, stopped: true };
    if (!actor || lifecycle.getSnapshot().active || blocked || !isCurrent() || currentCompanyGallery(live.current.input) === null || !input.session || !input.jobId || !drafts.length) return denied;
    const expectedTicket = lifecycle.getSnapshot().ticket + 1;
    lifecycle.update({ active: true, ownRefresh: false, startDetail: input.job.detail, ticket: expectedTicket });
    const current = () => isCurrent() && lifecycle.getSnapshot().ticket === expectedTicket;
    const publish = (next: CompanyPhotoOperationState) => {
      if (current()) setSnapshot({ identity, state: { ...next, pending: true }, parentDetail: live.current.input.job.detail });
    };
    publish({ ...empty, pending: true, message: "Checking current Company Job photo access…" });
    let last = { ...empty };
    const operation = createCompanyPhotoOperation({
      session: input.session, jobId: input.jobId, isCurrent: current,
      onRefresh: () => { if (current()) { lifecycle.update({ ownRefresh: true }); return live.current.input.onRefresh(); } },
      onState: (next) => { last = next; publish(next); },
    });
    try {
      const result = await uploadCompanyPhotoBatch({
        actor, drafts: drafts.map((draft) => ({ ...draft, assetKeys: [...draft.assetKeys] })), isCurrent: current,
        uploadOne: input.onUpload ?? operation.upload,
        onProgress: (confirmed, total, index) => { if (current()) setProgress({ identity, confirmed, total, index }); },
      });
      if (current()) {
        const message = result.stopped
          ? `${result.confirmed} of ${result.total} photos confirmed. Batch stopped. ${result.remaining.length} unstarted local drafts retained. Review refreshed photos before choosing any attempted photo again.`
          : `${result.confirmed} of ${result.total} photos uploaded. Photo upload confirmed by fresh Company Job detail.`;
        setSnapshot({ identity, state: { ...last, pending: false, message, error: result.stopped ? last.error ?? "A repeated or unconfirmed photo was not uploaded again. No automatic retry was sent." : null }, parentDetail: live.current.input.job.detail });
      }
      return result;
    } finally { if (lifecycle.getSnapshot().identity === identity) lifecycle.update({ active: false }); }
  };
  const canonical = state.detail && snapshot?.parentDetail === input.job.detail && currentCompanyGallery(input) !== null ? state.detail : null;
  return { ...state, detail: canonical, focused, blocked, upload, progress: visible && progress?.identity === identity ? progress : null };
}
