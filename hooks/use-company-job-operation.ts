import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

function createOperationEpoch() {
  let epoch = 0;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => epoch,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    invalidate: () => { epoch++; listeners.forEach((listener) => listener()); },
  };
}

export function useCompanyJobOperationEpoch() {
  const [memory] = useState(createOperationEpoch);
  return memory;
}

/** Render identity is pure; ref-backed parent checks are captured only after commit.
 * The memory epoch invalidates callbacks immediately, including a batched same-Job close/reopen.
 * A captured parent generation is never replaced for the same operation identity.
 */
export function useCompanyJobOperation(scopeKey: string, captureCurrent: () => () => boolean,
  memory: ReturnType<typeof useCompanyJobOperationEpoch>) {
  const epoch = useSyncExternalStore(memory.subscribe, memory.getSnapshot, memory.getSnapshot);
  const identity = useMemo(() => ({ scopeKey, epoch }), [scopeKey, epoch]);
  const committed = useRef<{ identity: typeof identity; current: () => boolean } | null>(null);
  useLayoutEffect(() => {
    if (committed.current?.identity !== identity) committed.current = { identity, current: captureCurrent() };
  });
  useLayoutEffect(() => () => { committed.current = null; }, []);
  const isCurrent = useCallback(() => memory.getSnapshot() === identity.epoch
    && committed.current?.identity === identity && committed.current.current(), [memory, identity]);
  return { isCurrent, invalidate: memory.invalidate, scopeKey: JSON.stringify([scopeKey, epoch]) };
}
