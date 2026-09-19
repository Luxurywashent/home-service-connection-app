import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { useQueryClient } from "@tanstack/react-query";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";

import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import { getJobSyncCompanyIncrementalSync } from "@/lib/jobsync-mobile-api";

type JobSyncSyncRefreshResult = { ok: boolean };
type JobSyncSyncContextValue = {
  revision: number;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  refreshCompanyData: (options?: { force?: boolean }) => Promise<JobSyncSyncRefreshResult>;
  invalidateCanonicalSurfaces: () => void;
};
const JobSyncSyncContext = createContext<JobSyncSyncContextValue>({
  revision: 0,
  isSyncing: false,
  lastSyncedAt: null,
  refreshCompanyData: async () => ({ ok: true }),
  invalidateCanonicalSurfaces: () => {},
});

function cursorKey(companyId: number) { return `hsc_jobsync_sync_cursor_v1:${companyId}`; }

export function JobSyncSyncProvider({ children }: { children: React.ReactNode }) {
  const { session } = useJobSyncAuth();
  const queryClient = useQueryClient();
  const [revision, setRevision] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const invalidateCanonicalSurfaces = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);
  const refreshCompanyData = useCallback(async (options?: { force?: boolean }): Promise<JobSyncSyncRefreshResult> => {
    const companyId = session?.portal === "company" ? session.company?.id : undefined;
    if (!companyId || !session) return { ok: false };
    const key = cursorKey(companyId);
    try {
      setIsSyncing(true);
      const cursor = await AsyncStorage.getItem(key);
      const result = await getJobSyncCompanyIncrementalSync(session.token, cursor);
      await AsyncStorage.setItem(key, result.generatedAt);
      const changed = Object.values(result.changes).some((entries) => entries.length > 0);
      setLastSyncedAt(result.generatedAt);
      if (changed || options?.force) {
        await queryClient.invalidateQueries({ type: "active" });
        setRevision((current) => current + 1);
      }
      return { ok: true };
    } catch {
      // Offline or failed requests retain last confirmed server state; no local write is treated as authoritative.
      return { ok: false };
    } finally { setIsSyncing(false); }
  }, [queryClient, session]);
  useEffect(() => { if (session?.portal === "company") void refreshCompanyData(); }, [refreshCompanyData, session?.portal]);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (next) => {
      const returning = (appState.current === "background" || appState.current === "inactive") && next === "active";
      appState.current = next;
      if (returning) void refreshCompanyData();
    });
    return () => subscription.remove();
  }, [refreshCompanyData]);
  useEffect(() => {
    if (session?.portal !== "company") return;
    let hadConnection = false;
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = Boolean(state.isConnected && state.isInternetReachable !== false);
      if (connected && hadConnection) void refreshCompanyData();
      hadConnection = connected;
    });
    return () => unsubscribe();
  }, [refreshCompanyData, session?.portal]);
  useEffect(() => {
    if (session?.portal !== "company") return;
    const timer = setInterval(() => void refreshCompanyData(), 45_000);
    return () => clearInterval(timer);
  }, [refreshCompanyData, session?.portal]);
  const value = useMemo(
    () => ({ revision, isSyncing, lastSyncedAt, refreshCompanyData, invalidateCanonicalSurfaces }),
    [invalidateCanonicalSurfaces, isSyncing, lastSyncedAt, refreshCompanyData, revision],
  );
  return <JobSyncSyncContext.Provider value={value}>{children}</JobSyncSyncContext.Provider>;
}

export function useJobSyncSync() { return useContext(JobSyncSyncContext); }
