import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const live = useRef({ key, onList, mounted: true, focused, active });
  live.current.key = key;
  live.current.onList = onList;
  live.current.focused = focused;
  live.current.active = active;
  const instance = useRef<object | null>(null);
  const [snapshot, setSnapshot] = useState<{ key: string | null; identity: object | null; state: CompanyJobState }>({ key: null, identity: null, state: empty });
  const [verifiedPhotos, setVerifiedPhotos] = useState<{ key: string; identity: object; parent: typeof snapshot; detail: JobSyncCompanyJobDetail } | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const controller = useMemo(() => {
    const identity = {};
    instance.current = identity;
    if (!key || !session || !jobId || !focused || !active) return null;
    return createCompanyJobController({
      session, jobId,
      isCurrent: () => live.current.mounted && live.current.focused && live.current.active && foreground()
        && live.current.key === key && instance.current === identity && (isOperationCurrent?.() ?? true),
      onState: (state) => setSnapshot({ key, identity, state }),
      onList: (jobs) => live.current.onList?.(jobs),
    });
  }, [key, focused, active, lifecycle, operationScopeKey]); // New lifecycle/sheet generation permanently invalidates older controllers.
  useEffect(() => {
    live.current.mounted = true;
    const subscription = appState?.addEventListener("change", (next) => {
      // Synchronous invalidation protects even batched background -> active transitions.
      instance.current = null;
      live.current.active = next === "active";
      setLifecycle((value) => value + 1);
    });
    return () => { live.current.mounted = false; instance.current = null; subscription?.remove(); };
  }, []);
  const identity = instance.current;
  useFocusEffect(useCallback(() => {
    if (focused && active) void controller?.refresh();
    return () => {
      if (instance.current === identity) { live.current.focused = false; instance.current = null; }
    };
  }, [controller, focused, active, identity]));
  const state = focused && active && snapshot.key === key && snapshot.identity === identity ? snapshot.state : { ...empty, loading: Boolean(key) };
  // Only the operation helper's independently verified full detail is handed here. This photo-only
  // snapshot does not replace the progress controller's actor/version or turn a failed progress read
  // into success. A later controller read (including its loading/error state) supersedes it.
  const acceptVerifiedDetail = (detail: JobSyncCompanyJobDetail, expectedScope: string) => {
    if (!key || !identity || !live.current.mounted || !live.current.focused || !live.current.active || !foreground()
      || live.current.key !== key || instance.current !== identity || snapshotRef.current !== snapshot
      || !(isOperationCurrent?.() ?? true) || expectedScope !== key || state.pending || state.loading) return false;
    const photos = currentCompanyGallery({ session, jobId, job: { detail, loading: false, pending: false, error: null } });
    const ids = detail.persistedPhotoIds;
    if (photos === null || !Array.isArray(ids) || ids.some((id) => typeof id !== "number" || !positiveJobSyncId(id)) || new Set(ids).size !== ids.length || photos.some((photo) => !ids.includes(photo.id))) return false;
    setVerifiedPhotos({ key, identity, parent: snapshotRef.current, detail });
    return true;
  };
  const verifiedPhotoDetail = focused && active && verifiedPhotos?.key === key && verifiedPhotos.identity === identity && verifiedPhotos.parent === snapshot && !state.loading && !state.pending ? verifiedPhotos.detail : null;
  return { ...state, verifiedPhotoDetail, acceptVerifiedDetail,
    refresh: () => controller?.refresh(), advance: (target: "en_route" | "on_site" | "completed") => controller?.advance(target) ?? Promise.resolve(false),
    cancelManagement: () => controller?.cancelManagement() ?? Promise.resolve(false) };
}
