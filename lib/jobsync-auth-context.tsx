import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { trpc } from "@/lib/trpc";

export type JobSyncPortalKind = "company" | "platform";
export type JobSyncNativeSession = {
  token: string;
  portal: JobSyncPortalKind;
  user: {
    id: number;
    name: string;
    email: string | null;
    role: "owner" | "dispatcher" | "technician" | "developer" | "sales" | "customer_support" | "operations";
    memberId?: string;
  };
  company?: {
    id: number;
    name: string;
    slug: string;
    logoUrl: string | null;
    primaryColor: string | null;
    accentColor: string | null;
  };
};

type JobSyncAuthContextValue = {
  session: JobSyncNativeSession | null;
  isLoading: boolean;
  loginCompany: (input: { email: string; password: string }) => Promise<JobSyncNativeSession>;
  loginPlatform: (input: { email: string; password: string }) => Promise<JobSyncNativeSession>;
  logout: () => Promise<void>;
};

const STORAGE_KEY = "hsc_jobsync_native_session";
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
  const companyLogin = trpc.jobsyncAuth.companyLogin.useMutation();
  const platformLogin = trpc.jobsyncAuth.platformLogin.useMutation();
  const sessionQuery = trpc.jobsyncAuth.me.useQuery(
    { token: session?.token ?? "" },
    { enabled: Boolean(session?.token), retry: false },
  );

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored) setSession(JSON.parse(stored) as JobSyncNativeSession);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (!session?.token || sessionQuery.isLoading) return;
    if (sessionQuery.data) {
      const verified = sessionQuery.data as JobSyncNativeSession;
      setSession(verified);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(verified)).catch(() => {});
      return;
    }
    if (sessionQuery.isError) {
      setSession(null);
      AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    }
  }, [session?.token, sessionQuery.data, sessionQuery.isError, sessionQuery.isLoading]);

  const save = useCallback(async (nextSession: JobSyncNativeSession) => {
    setSession(nextSession);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
    return nextSession;
  }, []);

  const loginCompany = useCallback(async (input: { email: string; password: string }) => {
    const result = await companyLogin.mutateAsync(input);
    return save(result as JobSyncNativeSession);
  }, [companyLogin, save]);

  const loginPlatform = useCallback(async (input: { email: string; password: string }) => {
    const result = await platformLogin.mutateAsync(input);
    return save(result as JobSyncNativeSession);
  }, [platformLogin, save]);

  const logout = useCallback(async () => {
    setSession(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
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
