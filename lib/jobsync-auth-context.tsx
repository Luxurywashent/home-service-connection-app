import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useCompanyCreationRecovery } from "@/hooks/use-company-creation-recovery";

import {
  getJobSyncMobileSession,
  loginJobSyncMobile,
  type JobSyncNativeSession,
} from "@/lib/jobsync-mobile-api";
export { getNativeEmployeeSession } from "@/lib/jobsync-role-map";
export type { JobSyncNativeSession, JobSyncPortalKind } from "@/lib/jobsync-mobile-api";

type JobSyncAuthContextValue = {
  session: JobSyncNativeSession | null;
  isLoading: boolean;
  loginCompany: (input: { email: string; password: string }) => Promise<JobSyncNativeSession>;
  loginPlatform: (input: { email: string; password: string }) => Promise<JobSyncNativeSession>;
  logout: () => Promise<void>;
  refreshSession: (expected: JobSyncNativeSession, options?: {
    isCurrent?: () => boolean;
    onVerified?: (live: JobSyncNativeSession) => void;
  }) => Promise<JobSyncNativeSession>;
};

const TOKEN_STORAGE_KEY = "hsc_jobsync_mobile_bearer_v1";
const LEGACY_STORAGE_KEY = "hsc_jobsync_native_session";

async function readStoredToken() {
  if (Platform.OS === "web") return AsyncStorage.getItem(TOKEN_STORAGE_KEY);
  return SecureStore.getItemAsync(TOKEN_STORAGE_KEY);
}

async function storeToken(token: string) {
  if (Platform.OS === "web") return AsyncStorage.setItem(TOKEN_STORAGE_KEY, token);
  return SecureStore.setItemAsync(TOKEN_STORAGE_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function clearStoredToken() {
  if (Platform.OS === "web") await AsyncStorage.removeItem(TOKEN_STORAGE_KEY);
  else await SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
  await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
}

const JobSyncAuthContext = createContext<JobSyncAuthContextValue>({
  session: null,
  isLoading: true,
  loginCompany: async () => { throw new Error("Home Service Connected authentication is unavailable"); },
  loginPlatform: async () => { throw new Error("Home Service Connected authentication is unavailable"); },
  logout: async () => {},
  refreshSession: async () => { throw new Error("Signed session refresh is unavailable"); },
});

export function JobSyncAuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<JobSyncNativeSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  useCompanyCreationRecovery(session, isLoading);
  const current = useRef<JobSyncNativeSession | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const applySession = useCallback((next: JobSyncNativeSession | null) => {
    generation.current++;
    current.current = next;
    setSession(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    const restore = async () => {
      try {
        let token = await readStoredToken();
        if (!token) {
          const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
          if (legacy) {
            const parsed = JSON.parse(legacy) as Partial<JobSyncNativeSession>;
            token = typeof parsed.token === "string" ? parsed.token : null;
            if (token) await storeToken(token);
          }
        }
        if (!token) return;
        const restored = await getJobSyncMobileSession(token);
        if (!cancelled) applySession(restored);
      } catch {
        await clearStoredToken().catch(() => {});
        if (!cancelled) applySession(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    restore();
    return () => { cancelled = true; mounted.current = false; generation.current++; };
  }, [applySession]);

  const save = useCallback(async (nextSession: JobSyncNativeSession) => {
    applySession(nextSession);
    await storeToken(nextSession.token);
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    return nextSession;
  }, [applySession]);

  const loginCompany = useCallback(async (input: { email: string; password: string }) => {
    const result = await loginJobSyncMobile({ accountType: "company", ...input });
    return save(result);
  }, [save]);

  const loginPlatform = useCallback(async (input: { email: string; password: string }) => {
    const result = await loginJobSyncMobile({ accountType: "platform_admin", ...input });
    return save(result);
  }, [save]);

  const logout = useCallback(async () => {
    applySession(null);
    await clearStoredToken();
  }, [applySession]);

  const refreshSession = useCallback<JobSyncAuthContextValue["refreshSession"]>(async (expected, options) => {
    const snapshot = { ...expected, user: { ...expected.user }, company: expected.company ? { ...expected.company } : undefined };
    const version = generation.current;
    const sameIdentity = (value: JobSyncNativeSession | null) => Boolean(value && value.token === snapshot.token
      && value.portal === snapshot.portal && value.user.id === snapshot.user.id && value.company?.id === snapshot.company?.id);
    // Always perform the captured-token reconciliation read, even after UI blur/switch.
    const live = await getJobSyncMobileSession(snapshot.token);
    if (!sameIdentity(live)) throw new Error("Signed session returned a different account or Company identity.");
    if (mounted.current && version === generation.current && sameIdentity(current.current)
      && current.current!.user.role === snapshot.user.role && (options?.isCurrent?.() ?? true)) {
      const signed = { ...live, user: { ...live.user }, company: live.company ? { ...live.company } : undefined };
      // Fresh live demotion must propagate too; callers cannot apply fabricated values.
      options?.onVerified?.({ ...signed, user: { ...signed.user }, company: signed.company ? { ...signed.company } : undefined });
      applySession(signed);
    }
    return live;
  }, [applySession]);

  return (
    <JobSyncAuthContext.Provider value={{ session, isLoading, loginCompany, loginPlatform, logout, refreshSession }}>
      {children}
    </JobSyncAuthContext.Provider>
  );
}

export function useJobSyncAuth() {
  return useContext(JobSyncAuthContext);
}
