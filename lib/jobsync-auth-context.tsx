import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";

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
  loginCompany: async () => { throw new Error("JobSync authentication is unavailable"); },
  loginPlatform: async () => { throw new Error("JobSync authentication is unavailable"); },
  logout: async () => {},
});

export function JobSyncAuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<JobSyncNativeSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
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
        if (!cancelled) setSession(restored);
      } catch {
        await clearStoredToken().catch(() => {});
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    restore();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (nextSession: JobSyncNativeSession) => {
    setSession(nextSession);
    await storeToken(nextSession.token);
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    return nextSession;
  }, []);

  const loginCompany = useCallback(async (input: { email: string; password: string }) => {
    const result = await loginJobSyncMobile({ accountType: "company", ...input });
    return save(result);
  }, [save]);

  const loginPlatform = useCallback(async (input: { email: string; password: string }) => {
    const result = await loginJobSyncMobile({ accountType: "platform_admin", ...input });
    return save(result);
  }, [save]);

  const logout = useCallback(async () => {
    setSession(null);
    await clearStoredToken();
  }, []);

  return (
    <JobSyncAuthContext.Provider value={{ session, isLoading, loginCompany, loginPlatform, logout }}>
      {children}
    </JobSyncAuthContext.Provider>
  );
}

export function useJobSyncAuth() {
  return useContext(JobSyncAuthContext);
}
