import { isJobSyncFieldSchedulingMember, type JobSyncCompanyMember, type JobSyncCompanyRoster, type JobSyncNativeSession } from "./jobsync-mobile-api";
import { getCompanySelfFieldworkStatus, isFreshCompanyProfileSession, isPositiveCompanyProfileId, type VerifiedCompanyProfileSession } from "./profile-fieldwork-policy";

export type CompanyFieldworkCalendarMember = JobSyncCompanyMember & {
  employeeId: `jobsync-${number}`;
  fieldworkSource: "roster-technician" | "signed-self-owner" | "signed-self-dispatcher";
};

/**
 * Candidate lanes only, not assignments. Does not accept/mutate Jobs or invent identities.
 * Today's roster is position-only: never use it to infer any manager's individual opt-in.
 * The self-manager exception requires a fresh signed override and an active exact-role roster row.
 * Dispatcher candidates do not prove active-position or automatic-booking eligibility.
 * Caller MUST clear prior lanes on focus/refresh, identity/opt-in change, failure, blur or expiry.
 */
export function composeCompanyFieldworkCalendarMembers(input: {
  session: JobSyncNativeSession | null | undefined;
  roster: JobSyncCompanyRoster | null | undefined;
  verifiedSelf: VerifiedCompanyProfileSession | null | undefined;
  now: number;
}): CompanyFieldworkCalendarMember[] {
  const { session, roster, verifiedSelf, now } = input;
  if (!session || session.portal !== "company" || typeof session.token !== "string" || !session.token.trim()
    || !isPositiveCompanyProfileId(session.company?.id) || !isPositiveCompanyProfileId(session.user?.id)
    || !["owner", "dispatcher", "technician"].includes(session.user.role)
    || !roster || roster.company?.id !== session.company.id || !Array.isArray(roster.members)) return [];

  const managementSelf = session.user.role === "owner" || session.user.role === "dispatcher";
  const allowSelfManager = managementSelf
    && isFreshCompanyProfileSession(session, verifiedSelf, now)
    && verifiedSelf.session.user.role === session.user.role
    && getCompanySelfFieldworkStatus(session, verifiedSelf, now).value === true;

  // Ambiguous duplicated self rows cannot establish an exact known active manager.
  const selfRows = roster.members.filter((member) => member?.id === session.user.id);
  const exactSelfManager = allowSelfManager && selfRows.length === 1
    && selfRows[0].isActive === true && selfRows[0].role === session.user.role;
  const seen = new Set<number>();
  return roster.members.flatMap((member): CompanyFieldworkCalendarMember[] => {
    if (!member || !isPositiveCompanyProfileId(member.id) || member.isActive !== true || typeof member.role !== "string"
      || typeof member.name !== "string" || !member.name.trim() || seen.has(member.id)) return [];
    const self = exactSelfManager && member.id === session.user.id && member.role === session.user.role;
    // Preserve ordinary technician/legacy-detailer defaults as projected by the existing adapter.
    if (!self && !isJobSyncFieldSchedulingMember(member)) return [];
    // An identity/role disagreement about signed management self cannot slip through the technician branch.
    if (managementSelf && member.id === session.user.id && !self) return [];
    seen.add(member.id);
    return [{ ...member, employeeId: `jobsync-${member.id}`, fieldworkSource: self
      ? session.user.role === "owner" ? "signed-self-owner" : "signed-self-dispatcher" : "roster-technician" }];
  });
}
