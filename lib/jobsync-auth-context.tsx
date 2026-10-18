import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";

import {
  getJobSyncMobileSession,
  loginJobSyncMobile,
  type JobSyncNativeSession,
} from "@/lib/jobsync-mobile-api";
import {
  JOBSYNC_MOBILE_BEARER_STORAGE_KEY,
  invalidateCompanyLocationBackgroundAuthorization,
} from "@/lib/company-location-session-authorization";
import { createJobSyncSessionGenerationGuard } from "@/lib/jobsync-session-generation";
export { getNativeEmployeeSession } from "@/lib/jobsync-role-map";
export type { JobSyncNativeSession, JobSyncPortalKind } from "@/lib/jobsync-mobile-api";

type JobSyncAuthContextValue = {
  session: JobSyncNativeSession | null;
  isLoading: boolean;
  loginCompany: (input: { email: string; password: string }) => Promise<JobSyncNativeSession>;
  loginPlatform: (input: { email: string; password: string }) => Promise<JobSyncNativeSession>;
  refresh: () => Promise<JobSyncNativeSession>;
  logout: () => Promise<void>;
};

const TOKEN_STORAGE_KEY = JOBSYNC_MOBILE_BEARER_STORAGE_KEY;
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
  refresh: async () => { throw new Error("Home Service Connected authentication is unavailable"); },
  logout: async () => {},
});

export function JobSyncAuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<JobSyncNativeSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionGeneration] = useState(createJobSyncSessionGenerationGuard);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      const restoreGeneration = sessionGeneration.snapshot();
      try {
        let token = await readStoredToken();
        if (!token) {
          const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
          if (legacy) {
            const parsed = JSON.parse(legacy) as Partial<JobSyncNativeSession>;
            token = typeof parsed.token === "string" ? parsed.token : null;
            if (token && sessionGeneration.isCurrent(restoreGeneration)) await storeToken(token);
          }
        }
        if (!token) {
          await invalidateCompanyLocationBackgroundAuthorization().catch(() => {});
          return;
        }
        const restored = await getJobSyncMobileSession(token);
        if (!cancelled && sessionGeneration.isCurrent(restoreGeneration)) setSession(restored);
      } catch {
        if (sessionGeneration.isCurrent(restoreGeneration)) {
          await invalidateCompanyLocationBackgroundAuthorization().catch(() => {});
          await clearStoredToken().catch(() => {});
          if (!cancelled && sessionGeneration.isCurrent(restoreGeneration)) setSession(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    restore();
    return () => { cancelled = true; };
  }, [sessionGeneration]);

  const save = useCallback(async (nextSession: JobSyncNativeSession) => {
    sessionGeneration.advance();
    // The native task shares device storage with the active account. Revoke it before
    // replacing the bearer so a previous account cannot publish under a new session.
    await invalidateCompanyLocationBackgroundAuthorization().catch(() => {});
    await storeToken(nextSession.token);
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    setSession(nextSession);
    return nextSession;
  }, [sessionGeneration]);

  const loginCompany = useCallback(async (input: { email: string; password: string }) => {
    const result = await loginJobSyncMobile({ accountType: "company", ...input });
    return save(result);
  }, [save]);

  const loginPlatform = useCallback(async (input: { email: string; password: string }) => {
    const result = await loginJobSyncMobile({ accountType: "platform_admin", ...input });
    return save(result);
  }, [save]);

  const logout = useCallback(async () => {
    sessionGeneration.advance();
    await invalidateCompanyLocationBackgroundAuthorization().catch(() => {});
    setSession(null);
    await clearStoredToken();
  }, [sessionGeneration]);

  const refresh = useCallback(async () => {
    const refreshGeneration = sessionGeneration.snapshot();
    const token = session?.token ?? await readStoredToken();
    if (!token) throw new Error("Home Service Connected authentication is unavailable");
    const restored = await getJobSyncMobileSession(token);
    if (sessionGeneration.isCurrent(refreshGeneration)) setSession(restored);
    return restored;
  }, [session?.token, sessionGeneration]);

  return (
    <JobSyncAuthContext.Provider value={{ session, isLoading, loginCompany, loginPlatform, refresh, logout }}>
      {children}
    </JobSyncAuthContext.Provider>
  );
}

export function useJobSyncAuth() {
  return useContext(JobSyncAuthContext);
}
