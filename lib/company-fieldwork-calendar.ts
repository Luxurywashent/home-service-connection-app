import { isJobSyncFieldSchedulingMember, type JobSyncCompanyMember, type JobSyncCompanyRoster, type JobSyncNativeSession } from "./jobsync-mobile-api";
import { getCompanySelfFieldworkStatus, isFreshCompanyProfileSession, isPositiveCompanyProfileId, type VerifiedCompanyProfileSession } from "./profile-fieldwork-policy";

export type CompanyFieldworkCalendarMember = JobSyncCompanyMember & {
  employeeId: `jobsync-${number}`;
  fieldworkSource: "roster-technician" | "signed-self-owner";
};

/**
 * Candidate lanes only, not assignments. Does not accept/mutate Jobs or invent identities.
 * Today's roster is position-only: never use it to infer any manager's individual opt-in.
 * The one exception is a fresh, verified signed owner matching an active exact roster row.
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

  const allowSelfOwner = session.user.role === "owner"
    && isFreshCompanyProfileSession(session, verifiedSelf, now)
    && verifiedSelf.session.user.role === "owner"
    && getCompanySelfFieldworkStatus(session, verifiedSelf, now).value === true;

  // Ambiguous duplicated self rows cannot establish an exact known active owner.
  const selfRows = roster.members.filter((member) => member?.id === session.user.id);
  const exactSelfOwner = allowSelfOwner && selfRows.length === 1
    && selfRows[0].isActive === true && selfRows[0].role === "owner";
  const seen = new Set<number>();
  return roster.members.flatMap((member): CompanyFieldworkCalendarMember[] => {
    if (!member || !isPositiveCompanyProfileId(member.id) || member.isActive !== true || typeof member.role !== "string"
      || typeof member.name !== "string" || !member.name.trim() || seen.has(member.id)) return [];
    const owner = exactSelfOwner && member.id === session.user.id && member.role === "owner";
    // Preserve ordinary technician/legacy-detailer defaults as projected by the existing adapter.
    if (!owner && !isJobSyncFieldSchedulingMember(member)) return [];
    // An identity/role disagreement about the signed owner must not slip through the technician branch.
    if (session.user.role === "owner" && member.id === session.user.id && !owner) return [];
    seen.add(member.id);
    return [{ ...member, employeeId: `jobsync-${member.id}`, fieldworkSource: owner ? "signed-self-owner" : "roster-technician" }];
  });
}
