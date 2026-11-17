import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useIsFocused } from "expo-router";
import * as NativeRuntime from "react-native";
import { companyJobSessionKey, createCompanyJobController, type CompanyJobState } from "@/lib/company-job-fieldwork";
import { currentCompanyGallery } from "@/lib/company-photo-view";
import { positiveJobSyncId, type JobSyncCompanyJobDetail, type JobSyncMobileJob, type JobSyncNativeSession } from "@/lib/jobsync-mobile-api";

const empty: CompanyJobState = { detail: null, actor: null, loading: false, pending: false, error: null, success: null };
// Native production supplies AppState; older isolated native hosts omit lifecycle APIs.
const appState = "AppState" in NativeRuntime ? NativeRuntime.AppState : undefined;
const foreground = () => !appState || appState.currentState === "active";
export function useCompanyJob(session: JobSyncNativeSession | null, jobId: number | null,
  onList?: (jobs: JobSyncMobileJob[]) => void, isOperationCurrent?: () => boolean, operationScopeKey?: string) {
  const key = companyJobSessionKey(session, jobId);
  const focused = useIsFocused();
  const [lifecycle, setLifecycle] = useState(0);
  const active = foreground();
  // Render has no ref reads/writes: abandoned renders cannot publish a controller or actor.
  const identity = useMemo(() => ({ key, focused, active, lifecycle, operationScopeKey }),
    [key, focused, active, lifecycle, operationScopeKey]);
  const live = useRef({ key, onList, mounted: false, focused: false, active: false });
  const instance = useRef<object | null>(null);
  const controllerRef = useRef<ReturnType<typeof createCompanyJobController> | null>(null);
  const [snapshot, setSnapshot] = useState<{ key: string | null; identity: object | null; state: CompanyJobState }>({ key: null, identity: null, state: empty });
  const [verifiedPhotos, setVerifiedPhotos] = useState<{ key: string; identity: object; parent: typeof snapshot; detail: JobSyncCompanyJobDetail } | null>(null);
  const snapshotRef = useRef(snapshot);
  useLayoutEffect(() => {
    const current = live.current;
    current.mounted = true;
    const subscription = appState?.addEventListener("change", (next) => {
      // Synchronous invalidation protects even batched background -> active transitions.
      instance.current = null;
      live.current.active = next === "active";
      setLifecycle((value) => value + 1);
    });
    return () => { current.mounted = false; instance.current = null; controllerRef.current = null; subscription?.remove(); };
  }, []);
  useLayoutEffect(() => {
    live.current.key = key;
    live.current.onList = onList;
    live.current.focused = focused;
    live.current.active = active;
    snapshotRef.current = snapshot;
    if (instance.current === identity) return;
    instance.current = identity;
    controllerRef.current = !key || !session || !jobId || !focused || !active ? null : createCompanyJobController({
      session, jobId,
      isCurrent: () => live.current.mounted && live.current.focused && live.current.active && foreground()
        && live.current.key === key && instance.current === identity && (isOperationCurrent?.() ?? true),
      onState: (state) => {
        const next = { key, identity, state };
        // A started canonical read invalidates older photo handoffs before React can batch it.
        snapshotRef.current = next;
        setSnapshot(next);
      },
      onList: (jobs) => live.current.onList?.(jobs),
    });
  });
  useFocusEffect(useCallback(() => {
    if (focused && active && instance.current === identity) void controllerRef.current?.refresh();
    return () => {
      if (instance.current === identity) { live.current.focused = false; instance.current = null; }
    };
  }, [focused, active, identity]));
  const state = focused && active && snapshot.key === key && snapshot.identity === identity ? snapshot.state : { ...empty, loading: Boolean(key) };
  // Only the operation helper's independently verified full detail is handed here. This photo-only
  // snapshot does not replace the progress controller's actor/version or turn a failed progress read
  // into success. A later controller read (including its loading/error state) supersedes it.
  const acceptVerifiedDetail = (detail: JobSyncCompanyJobDetail, expectedScope: string) => {
    if (!key || !live.current.mounted || !live.current.focused || !live.current.active || !foreground()
      || live.current.key !== key || instance.current !== identity || snapshotRef.current !== snapshot
      || !(isOperationCurrent?.() ?? true) || expectedScope !== key || state.pending || state.loading) return false;
    const photos = currentCompanyGallery({ session, jobId, job: { detail, loading: false, pending: false, error: null } });
    const ids = detail.persistedPhotoIds;
    if (photos === null || !Array.isArray(ids) || ids.some((id) => typeof id !== "number" || !positiveJobSyncId(id)) || new Set(ids).size !== ids.length || photos.some((photo) => !ids.includes(photo.id))) return false;
    setVerifiedPhotos({ key, identity, parent: snapshotRef.current, detail });
    return true;
  };
  const verifiedPhotoDetail = focused && active && verifiedPhotos?.key === key && verifiedPhotos.identity === identity && verifiedPhotos.parent === snapshot && !state.loading && !state.pending ? verifiedPhotos.detail : null;
  // Retained callbacks must not dispatch through a newer committed controller.
  const currentController = () => instance.current === identity ? controllerRef.current : null;
  return { ...state, verifiedPhotoDetail, acceptVerifiedDetail,
    refresh: () => currentController()?.refresh(), advance: (target: "en_route" | "on_site" | "completed") => currentController()?.advance(target) ?? Promise.resolve(false),
    cancelManagement: () => currentController()?.cancelManagement() ?? Promise.resolve(false) };
}
