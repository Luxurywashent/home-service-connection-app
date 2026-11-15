import type { JobSyncCompanyMember, JobSyncNativeSession } from "./jobsync-mobile-api";

export const PROFILE_FIELDWORK_LABEL = "Available for Field Jobs";
export const PROFILE_FIELDWORK_DESCRIPTION = "Allow this Team Member to receive scheduled Jobs while keeping their Admin permissions.";
export const PROFILE_FIELDWORK_PENDING_DESCRIPTION = "Admin defaults to OFF and keeps the Admin role. Current field-job availability is unavailable. Backend connection pending; this setting and owner profile updates cannot be changed in mobile yet.";

type CompanyProfileMember = Pick<JobSyncCompanyMember, "id" | "role" | "isActive">;

function isPositiveId(id: number | undefined): boolean {
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

/** Client visibility only; server-side signed-session authorization remains authoritative. */
export function isCompanyProfileManagementSession(session: JobSyncNativeSession | null | undefined): boolean {
  return session?.portal === "company"
    && typeof session.token === "string" && session.token.trim().length > 0
    && isPositiveId(session.company?.id)
    && isPositiveId(session.user?.id)
    && (session.user.role === "owner" || session.user.role === "dispatcher");
}

function isActiveMember(member: CompanyProfileMember | null | undefined): member is CompanyProfileMember {
  return !!member && isPositiveId(member.id) && member.isActive === true;
}

function isAdminMember(member: CompanyProfileMember): boolean {
  const role = member.role.trim().toLowerCase();
  return role === "owner" || role === "admin";
}

/** The existing mobile member PATCH rejects owner targets; never offer it as an owner editor. */
export function canEditCompanyMemberProfile(
  session: JobSyncNativeSession | null | undefined,
  member: CompanyProfileMember | null | undefined,
): boolean {
  return isCompanyProfileManagementSession(session) && isActiveMember(member)
    && ["technician", "detailer", "dispatcher"].includes(member.role.trim().toLowerCase());
}

/**
 * No reliable calendarEligibleOverride detail projection or owner mutation is wired in mobile.
 * Do not infer owner opt-in from roster calendarEligible, availability, workdays, or editable role.
 * An unknown persisted value is NOT the product's default OFF. This is not scheduling authority.
 */
export function getCompanyAdminFieldworkPolicy(
  session: JobSyncNativeSession | null | undefined,
  member: CompanyProfileMember | null | undefined,
) {
  return {
    visible: isCompanyProfileManagementSession(session) && isActiveMember(member) && isAdminMember(member),
    canEdit: false as const,
    status: "unavailable" as const,
    value: null,
    defaultValue: false as const,
  };
}
