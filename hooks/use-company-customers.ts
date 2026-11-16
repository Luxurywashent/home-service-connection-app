import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "expo-router";

import { useEmployeeAuth } from "@/lib/auth-context";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import { getJobSyncCompanyCustomers, positiveJobSyncId, type JobSyncCompanyCustomer } from "@/lib/jobsync-mobile-api";

type CustomerState = {
  identity: object | null;
  customers: JobSyncCompanyCustomer[];
  isLoading: boolean;
  error: string | null;
};
type LiveScope = {
  identity: object | null;
  mounted: boolean;
  focused: boolean;
  sequence: number;
  inFlight: { sequence: number; promise: Promise<void> } | null;
};
const EMPTY: CustomerState = { identity: null, customers: [], isLoading: false, error: null };
export const COMPANY_CUSTOMERS_UNAVAILABLE = "Could not load this Company’s customers. Check your connection and pull to refresh.";

/** Read-only, bearer-scoped customer list. No legacy fallback for an unresolved Company workspace. */
export function useCompanyCustomers() {
  const { session, isLoading: authLoading } = useJobSyncAuth();
  const { employee, loading: employeeLoading } = useEmployeeAuth();
  const focused = useIsFocused();
  const hasCompanyProvenance = employee?.sessionSource === "jobsync"
    || (employee?.companyId !== undefined && employee.companyId !== null);
  const legacyAllowed = !session && !authLoading && !employeeLoading && !hasCompanyProvenance && Boolean(employee);
  // All signed/pending/provenanced contexts fail closed, including logout without a legacy identity.
  const isCompanyMode = !legacyAllowed;
  const token = session?.token;
  const companyId = positiveJobSyncId(session?.company?.id);
  const userId = positiveJobSyncId(session?.user.id);
  const canRead = session?.portal === "company" && !authLoading && !employeeLoading
    && Boolean(token?.trim() && companyId && userId)
    && ["owner", "dispatcher", "technician"].includes(session.user.role);
  // Memory only: never log, persist, or send this bearer-containing identity key.
  const key = JSON.stringify([
    session?.portal, token, companyId, userId, session?.user.role, authLoading,
    employee?.employeeId, employee?.role, employee?.sessionSource, employee?.companyId, employeeLoading,
    isCompanyMode, canRead,
  ]);
  // A -> B -> A and refocus must create a new identity, not revive a prior snapshot.
  const identity = useMemo(() => ({ key, focused }), [key, focused]);
  const [state, setState] = useState<CustomerState>(EMPTY);
  const live = useRef<LiveScope>({ identity: null, mounted: false, focused: false, sequence: 0, inFlight: null });

  // Commit-time refs avoid invalidating active work for an abandoned render.
  useLayoutEffect(() => {
    const scope = live.current;
    scope.identity = identity;
    scope.mounted = true;
    scope.focused = focused;
    scope.sequence++;
    scope.inFlight = null;
    return () => {
      scope.mounted = false;
      scope.focused = false;
      scope.identity = null;
      scope.sequence++;
      scope.inFlight = null;
    };
  }, [identity, focused]);

  // Captured by row handlers too: retained handlers from an older scope cannot navigate.
  const isCurrent = useCallback(() => live.current.mounted && live.current.focused
    && live.current.identity === identity, [identity]);

  const refresh = useCallback((): Promise<void> => {
    const scope = live.current;
    if (!canRead || !token || !companyId || !isCurrent()) return Promise.resolve();
    if (scope.inFlight) return scope.inFlight.promise;
    const sequence = ++scope.sequence;
    const canCommit = () => isCurrent() && scope.sequence === sequence;
    setState((current) => ({
      ...(current.identity === identity ? current : EMPTY),
      identity, isLoading: true, error: null,
    }));
    const promise = (async () => {
      // Install the coalescing slot before invoking a possibly synchronous mock/transport.
      await Promise.resolve();
      try {
        if (!canCommit()) return;
        const customers = await getJobSyncCompanyCustomers(token);
        // Bearer scope is authoritative; explicit conflicting wire provenance is never displayed.
        if (customers.some((customer) => customer.companyId !== undefined && customer.companyId !== companyId)) {
          throw new Error("Company customer provenance mismatch");
        }
        if (canCommit()) setState({ identity, customers, isLoading: false, error: null });
      } catch {
        if (canCommit()) setState({ identity, customers: [], isLoading: false, error: COMPANY_CUSTOMERS_UNAVAILABLE });
      } finally {
        // An old completion must never release a newer scope's refresh lock.
        if (scope.inFlight?.sequence === sequence) scope.inFlight = null;
      }
    })();
    scope.inFlight = { sequence, promise };
    return promise;
  }, [canRead, token, companyId, identity, isCurrent]);

  useEffect(() => {
    if (focused) void refresh();
  }, [focused, refresh]);

  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      const foregrounded = next === "active" && previous !== "active";
      previous = next;
      if (foregrounded) void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  // Synchronous render filtering, not an effect-based clear after stale rows have painted.
  const visible = canRead && focused && state.identity === identity
    ? state
    : { ...EMPTY, isLoading: Boolean(canRead && focused) };
  return {
    customers: visible.customers,
    isLoading: visible.isLoading,
    error: visible.error ?? (isCompanyMode && !canRead
      ? "A current Company session is required to load customers."
      : null),
    isCompanyMode,
    legacyAllowed,
    companyId,
    identity,
    isCurrent,
    refresh,
  };
}
