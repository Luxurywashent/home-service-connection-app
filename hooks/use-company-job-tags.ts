import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useIsFocused } from "expo-router";
import * as NativeRuntime from "react-native";
import {
  companyJobTagsSessionKey, createCompanyJobTagsController, emptyCompanyJobTagsState,
  type CompanyJobTagsController, type CompanyJobTagsState, type CompanyJobTagsTransport,
} from "@/lib/company-job-tags";
import type { JobSyncNativeSession } from "@/lib/jobsync-mobile-api";

const appState = "AppState" in NativeRuntime ? NativeRuntime.AppState : undefined;
const foreground = () => !appState || appState.currentState === "active";

/** Inject a stable canonical API. Pass existing operation-epoch isCurrent/scopeKey for sheets.
 * refresh = read-only automatic refresh; review = explicit user review after uncertainty.
 * Tags are never locally persisted, optimistically edited, or merged with legacy/customer tags.
 */
export function useCompanyJobTags(session: JobSyncNativeSession | null, jobId: number | null,
  api: CompanyJobTagsTransport, isOperationCurrent?: () => boolean, operationScopeKey?: string) {
  const key = companyJobTagsSessionKey(session, jobId);
  const focused = useIsFocused();
  const [lifecycle, setLifecycle] = useState(0);
  const active = foreground();
  const identity = useMemo(() => ({ key, focused, active, lifecycle, api, isOperationCurrent, operationScopeKey }),
    [key, focused, active, lifecycle, api, isOperationCurrent, operationScopeKey]);
  const live = useRef({ key, mounted: false, focused: false, active: false });
  const instance = useRef<object | null>(null);
  const controller = useRef<CompanyJobTagsController | null>(null);
  const [snapshot, setSnapshot] = useState<{ key: string | null; identity: object | null; state: CompanyJobTagsState }>({
    key: null, identity: null, state: emptyCompanyJobTagsState,
  });
  useLayoutEffect(() => {
    const current = live.current;
    current.mounted = true;
    const subscription = appState?.addEventListener("change", (next) => {
      // Invalidate immediately even if background -> active is React-batched to one render.
      instance.current = null;
      controller.current?.dispose();
      controller.current = null;
      live.current.active = next === "active";
      setLifecycle((value) => value + 1);
    });
    return () => {
      current.mounted = false;
      instance.current = null;
      controller.current?.dispose();
      controller.current = null;
      subscription?.remove();
    };
  }, []);
  useLayoutEffect(() => {
    live.current.key = key;
    live.current.focused = focused;
    live.current.active = active;
    if (instance.current === identity) return;
    controller.current?.dispose();
    instance.current = identity;
    controller.current = !key || !session || !jobId || !focused || !active ? null : createCompanyJobTagsController({
      session, jobId, api,
      isCurrent: () => live.current.mounted && live.current.focused && live.current.active && foreground()
        && live.current.key === key && instance.current === identity && (isOperationCurrent?.() ?? true),
      onState: (state) => setSnapshot({ key, identity, state }),
    });
  });
  useFocusEffect(useCallback(() => {
    if (focused && active && instance.current === identity) void controller.current?.refresh();
    return () => {
      if (instance.current === identity) {
        live.current.focused = false;
        instance.current = null;
        controller.current?.dispose();
        controller.current = null;
      }
    };
  }, [focused, active, identity]));
  const state = focused && active && snapshot.key === key && snapshot.identity === identity
    ? snapshot.state : { ...emptyCompanyJobTagsState, loading: Boolean(key && focused && active) };
  // Old callbacks capture their original identity, never a later committed controller.
  const currentController = () => instance.current === identity ? controller.current : null;
  return {
    ...state,
    refresh: () => currentController()?.refresh() ?? Promise.resolve(),
    review: () => currentController()?.review() ?? Promise.resolve(),
    add: (name: string) => currentController()?.add(name) ?? Promise.resolve(false),
    remove: (tagId: number) => currentController()?.remove(tagId) ?? Promise.resolve(false),
  };
}
