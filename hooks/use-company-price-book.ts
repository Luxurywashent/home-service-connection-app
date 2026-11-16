import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "expo-router";

import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import {
  getHomeServiceConnectedPriceBook,
  type HomeServiceConnectedPriceBookService,
} from "@/lib/jobsync-mobile-api";

type CompanyPriceBookState = {
  identity: object | null;
  services: HomeServiceConnectedPriceBookService[];
  isLoading: boolean;
  error: string | null;
  /** True only after a successful read for this scope; failures are not known-empty. */
  hasLoaded: boolean;
};

type LiveScope = {
  identity: object | null;
  key: string | null;
  focused: boolean;
  mounted: boolean;
  sequence: number;
  inFlight: { sequence: number; promise: Promise<void> } | null;
};

const INITIAL_STATE: CompanyPriceBookState = {
  identity: null,
  services: [],
  isLoading: false,
  error: null,
  hasLoaded: false,
};

/** Reads only active services from the signed-in Company workspace. */
export function useCompanyPriceBook() {
  const { session } = useJobSyncAuth();
  const focused = useIsFocused();
  const isCompanySession = session?.portal === "company";
  const token = session?.token;
  const companyId = session?.company?.id;
  const userId = session?.user.id;
  // Memory-only scope: do not log or persist this bearer-containing key.
  const key = isCompanySession && token?.trim()
    && Number.isSafeInteger(companyId) && companyId! > 0
    && Number.isSafeInteger(userId) && userId! > 0
    ? JSON.stringify([session.portal, token, companyId, userId])
    : null;
  // Refocus (or A -> B -> A) gets a new identity, not a revived old snapshot.
  const identity = useMemo(() => ({ key, focused }), [key, focused]);
  const [state, setState] = useState<CompanyPriceBookState>(INITIAL_STATE);
  const live = useRef<LiveScope>({ identity: null, key: null, focused: false, mounted: false, sequence: 0, inFlight: null });

  // Commit-time refs: discarded renders must not invalidate the committed request.
  // Layout cleanup closes the old scope before any post-commit promise completion.
  useLayoutEffect(() => {
    const scope = live.current;
    scope.identity = identity;
    scope.key = key;
    scope.focused = focused;
    scope.mounted = true;
    scope.sequence++;
    scope.inFlight = null;
    return () => {
      scope.mounted = false;
      scope.focused = false;
      scope.identity = null;
      scope.sequence++;
      scope.inFlight = null;
    };
  }, [identity, key, focused]);

  const refresh = useCallback((): Promise<void> => {
    const scope = live.current;
    if (!key || !token || !scope.mounted || !scope.focused || scope.key !== key || scope.identity !== identity) {
      return Promise.resolve();
    }
    if (scope.inFlight) return scope.inFlight.promise;

    const sequence = ++scope.sequence;
    const isCurrent = () => scope.mounted && scope.focused && scope.key === key
      && scope.identity === identity && scope.sequence === sequence;
    setState((current) => ({
      ...(current.identity === identity ? current : INITIAL_STATE),
      identity,
      isLoading: true,
      error: null,
      hasLoaded: false,
    }));
    const promise = (async () => {
      // Install the coalescing slot before invoking even a synchronously throwing read.
      await Promise.resolve();
      try {
        if (!isCurrent()) return;
        const services = await getHomeServiceConnectedPriceBook(token);
        if (isCurrent()) setState({ identity, services, isLoading: false, error: null, hasLoaded: true });
      } catch (error) {
        if (isCurrent()) setState({
          identity,
          services: [],
          isLoading: false,
          error: error instanceof Error ? error.message : "Home Service Connected could not load this Company Price Book.",
          hasLoaded: false,
        });
      } finally {
        // An obsolete completion must not clear a newer request's coalescing slot.
        if (scope.inFlight?.sequence === sequence) scope.inFlight = null;
      }
    })();
    scope.inFlight = { sequence, promise };
    return promise;
  }, [identity, key, token]);

  // Expo focus changes re-read even when the screen stayed mounted in the navigator.
  useEffect(() => {
    if (focused) void refresh();
  }, [focused, refresh]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      const returnedToForeground = nextState === "active" && previousState !== "active";
      previousState = nextState;
      if (returnedToForeground) void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  // Render-time identity filtering prevents even a transient prior-Company snapshot.
  const visible = key && focused && state.identity === identity
    ? state
    : { ...INITIAL_STATE, isLoading: Boolean(key && focused) };
  return {
    services: visible.services,
    isLoading: visible.isLoading,
    error: visible.error,
    hasLoaded: visible.hasLoaded,
    isCompanySession,
    refresh,
  };
}
