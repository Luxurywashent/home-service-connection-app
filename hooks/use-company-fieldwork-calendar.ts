import { useEffect, useMemo, useRef, useState } from "react";
import { useIsFocused } from "expo-router";
import { getJobSyncCompanyMembers, type JobSyncCompanyRoster, type JobSyncNativeSession } from "@/lib/jobsync-mobile-api";
import { composeCompanyFieldworkCalendarMembers } from "@/lib/company-fieldwork-calendar";
import { COMPANY_PROFILE_SESSION_MAX_AGE_MS, isCompanyProfileManagementSession, type VerifiedCompanyProfileSession } from "@/lib/profile-fieldwork-policy";
import { refreshCompanyProfileSession } from "@/lib/profile-fieldwork-update";

export function companyCalendarIdentityKey(session: JobSyncNativeSession | null) {
  if (session?.portal !== "company" || !session.token || !session.company?.id) return null;
  // Memory-only identity: never log or persist a bearer-containing key.
  return JSON.stringify([session.token, session.company.id, session.user.id, session.user.role,
    Object.prototype.hasOwnProperty.call(session.user, "calendarEligible"), session.user.calendarEligible]);
}
type State = { key: string | null; roster: JobSyncCompanyRoster | null; self: VerifiedCompanyProfileSession | null; loading: boolean; error: string | null };

/** Existing roster + signed self-session; no new account/calendar or server write. */
export function useCompanyFieldworkCalendar(session: JobSyncNativeSession | null, refreshKey: number) {
  const focused = useIsFocused();
  const key = companyCalendarIdentityKey(session);
  const [state, setState] = useState<State>({ key: null, roster: null, self: null, loading: true, error: null });
  const live = useRef({ key, focused, mounted: true, generation: 0 });
  if (live.current.key !== key || live.current.focused !== focused) live.current.generation++;
  live.current.key = key;
  live.current.focused = focused;
  useEffect(() => {
    live.current.mounted = true;
    return () => { live.current.mounted = false; live.current.generation++; };
  }, []);
  useEffect(() => {
    const generation = ++live.current.generation;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => alive && live.current.mounted && live.current.focused
      && live.current.key === key && live.current.generation === generation;
    setState({ key, roster: null, self: null, loading: Boolean(key && focused), error: null });
    if (!session || !key || !focused || session.portal !== "company" || !session.company) return;
    const expected = { ...session, company: { ...session.company }, user: { ...session.user } };
    void (async () => {
      try {
        const [roster, self] = await Promise.all([
          getJobSyncCompanyMembers(expected.token, expected.company.id),
          isCompanyProfileManagementSession(expected) ? refreshCompanyProfileSession({ session: expected, isCurrent: current }).catch(() => null) : Promise.resolve(null),
        ]);
        if (!current()) return;
        setState({ key, roster, self, loading: false, error: null });
        if (self) timer = setTimeout(() => {
          if (current()) setState((previous) => previous.key === key ? { ...previous, self: null } : previous);
        }, Math.max(0, COMPANY_PROFILE_SESSION_MAX_AGE_MS - (Date.now() - self.verifiedAt)));
      } catch {
        if (current()) setState({ key, roster: null, self: null, loading: false, error: "Could not refresh Company assignment candidates. Existing Job assignments were not changed." });
      }
    })();
    return () => { alive = false; live.current.generation++; if (timer) clearTimeout(timer); };
  }, [key, focused, refreshKey]);

  const members = useMemo(() => focused && state.key === key && !state.loading
    ? composeCompanyFieldworkCalendarMembers({ session, roster: state.roster, verifiedSelf: state.self, now: Date.now() })
    : [], [key, focused, state, session]);

  const verifyAssignment = async (employeeId: string) => {
    if (!session || !key || !focused || session.portal !== "company" || !session.company) return false;
    const generation = live.current.generation;
    const current = () => live.current.mounted && live.current.focused && live.current.key === key && live.current.generation === generation;
    const expected = { ...session, company: { ...session.company }, user: { ...session.user } };
    try {
      const [roster, self] = await Promise.all([
        getJobSyncCompanyMembers(expected.token, expected.company.id),
        isCompanyProfileManagementSession(expected) ? refreshCompanyProfileSession({ session: expected, isCurrent: current }) : Promise.resolve(null),
      ]);
      if (!current()) return false;
      return composeCompanyFieldworkCalendarMembers({ session: expected, roster, verifiedSelf: self, now: Date.now() })
        .some((member) => member.employeeId === employeeId);
    } catch { return false; }
  };
  const isCurrent = () => Boolean(key) && live.current.mounted && live.current.focused && live.current.key === key;
  return { members, verifyAssignment, isCurrent, loading: focused && (state.key !== key || state.loading), error: state.key === key ? state.error : null };
}
