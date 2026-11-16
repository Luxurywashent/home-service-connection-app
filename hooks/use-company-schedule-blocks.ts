import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { CompanyScheduleBlocksLifecycle, isCompanyScheduleBlockDate, type CompanyScheduleBlockScope, type CompanyScheduleBlockState } from "@/lib/company-schedule-blocks";
import { companyProfileSessionKey } from "@/lib/profile-fieldwork-policy";

const emptyState: CompanyScheduleBlockState = { rows: [], loading: false, pending: false, error: null, createHeld: false, readVerified: false };

/** The domain stays memory-only and owns all synchronous write locks/generations.
 * Render reads an immutable snapshot; only committed scopes bind the lifecycle.
 */
function createStore() {
  const lifecycle = new CompanyScheduleBlocksLifecycle();
  const listeners = new Set<() => void>();
  let boundControl: string | null = null;
  let snapshot: { control: string | null; state: CompanyScheduleBlockState; actions: ReturnType<CompanyScheduleBlocksLifecycle["capture"]> } = { control: boundControl, state: lifecycle.state, actions: lifecycle.capture() };
  const publish = () => {
    snapshot = { ...snapshot, state: lifecycle.state };
    listeners.forEach((listener) => listener());
  };
  lifecycle.onChange = publish;
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    mount: () => lifecycle.mount(),
    unmount: () => { boundControl = null; lifecycle.unmount(); },
    commit: (scope: CompanyScheduleBlockScope, control: string) => {
      if (boundControl === control) return;
      lifecycle.bind(scope);
      boundControl = control;
      snapshot = { control, state: lifecycle.state, actions: lifecycle.capture() };
      listeners.forEach((listener) => listener());
    },
    refresh: (control: string) => boundControl === control ? snapshot.actions.refresh() : Promise.resolve(false),
  };
}

export function useCompanyScheduleBlocks({ session, focused, enabled, date, boundary }: CompanyScheduleBlockScope, refreshKey: number) {
  const [store] = useState(createStore);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const sessionKey = companyProfileSessionKey(session);
  const key = focused && enabled && sessionKey && date && isCompanyScheduleBlockDate(date)
    ? JSON.stringify([sessionKey, date, boundary]) : null;
  const binding = JSON.stringify([key, focused, enabled, sessionKey, date, boundary]);
  const bound = snapshot.control === binding;

  useLayoutEffect(() => {
    store.mount();
    return () => store.unmount();
  }, [store]);
  useLayoutEffect(() => {
    store.commit({ session, focused, enabled, date, boundary }, binding);
  }, [store, session, focused, enabled, date, boundary, binding]);
  useEffect(() => { void store.refresh(binding); }, [store, binding, refreshKey]);

  // A render for a not-yet-committed Company/date must never expose old rows or
  // usable old actions. Retained committed actions keep the domain epoch checks.
  return {
    ...(bound ? snapshot.state : { ...emptyState, loading: Boolean(key) }),
    current: () => bound && snapshot.actions.current(),
    refresh: () => bound ? snapshot.actions.refresh() : Promise.resolve(false),
    create: (...args: Parameters<typeof snapshot.actions.create>) => bound ? snapshot.actions.create(...args) : Promise.resolve(false),
    remove: (...args: Parameters<typeof snapshot.actions.remove>) => bound ? snapshot.actions.remove(...args) : Promise.resolve(false),
    binding,
  };
}
