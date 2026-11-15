import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { companyJobSessionKey, createCompanyJobController, type CompanyJobState } from "@/lib/company-job-fieldwork";
import type { JobSyncMobileJob, JobSyncNativeSession } from "@/lib/jobsync-mobile-api";

const empty: CompanyJobState = { detail: null, loading: false, pending: false, error: null, success: null };
export function useCompanyJob(session: JobSyncNativeSession | null, jobId: number | null, onList?: (jobs: JobSyncMobileJob[]) => void) {
  const key = companyJobSessionKey(session, jobId);
  const live = useRef({ key, onList, mounted: true });
  live.current.key = key;
  live.current.onList = onList;
  const instance = useRef<object | null>(null);
  const [snapshot, setSnapshot] = useState<{ key: string | null; identity: object | null; state: CompanyJobState }>({ key: null, identity: null, state: empty });
  const controller = useMemo(() => {
    const identity = {};
    instance.current = identity;
    if (!key || !session || !jobId) return null;
    return createCompanyJobController({
      session, jobId,
      isCurrent: () => live.current.mounted && live.current.key === key && instance.current === identity,
      onState: (state) => setSnapshot({ key, identity, state }),
      onList: (jobs) => live.current.onList?.(jobs),
    });
  }, [key]); // Key contains the complete signed identity, role, token and Job.
  useEffect(() => {
    live.current.mounted = true;
    return () => { live.current.mounted = false; };
  }, []);
  useFocusEffect(useCallback(() => { void controller?.refresh(); }, [controller]));
  const state = snapshot.key === key && snapshot.identity === instance.current ? snapshot.state : { ...empty, loading: Boolean(key) };
  return { ...state, refresh: () => controller?.refresh(), advance: (target: "en_route" | "on_site" | "completed") => controller?.advance(target) ?? Promise.resolve(false) };
}
