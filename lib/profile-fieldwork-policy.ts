import type { JobSyncCompanyMember, JobSyncNativeSession } from "./jobsync-mobile-api";

export const PROFILE_FIELDWORK_LABEL = "Available for Field Jobs";
export const PROFILE_FIELDWORK_DESCRIPTION = "Allow this Team Member to receive scheduled Jobs while keeping their Admin permissions.";
export const PROFILE_FIELDWORK_OWNER_BLOCKED_DESCRIPTION = "Mobile cannot change this owner's field-job setting: the existing Team Member PATCH rejects every owner target, including your own account, with 403 ‘Company Owner Team Member access is protected.’ JobSync must allow a protected, capability-only owner update that preserves role, position, credentials and Company membership.";
export const PROFILE_FIELDWORK_PENDING_DESCRIPTION = "Admin defaults to OFF and keeps the Admin role. Current field-job availability is UNKNOWN because roster and member-detail reads do not reliably project the individual override. An acknowledged override update does not confirm calendar inclusion or automatic booking.";
export const COMPANY_PROFILE_SESSION_MAX_AGE_MS = 60_000;

export type CompanyProfileMember = Pick<JobSyncCompanyMember, "id" | "role" | "isActive"> & { companyId?: number };

export function isPositiveCompanyProfileId(id: unknown): id is number {
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function targetRole(member: CompanyProfileMember | null | undefined): string | null {
  return typeof member?.role === "string" ? member.role.trim().toLowerCase() : null;
}

/** Visibility only: the server verifies the bearer and live membership on every request. */
export function isCompanyProfileManagementSession(session: JobSyncNativeSession | null | undefined): session is JobSyncNativeSession {
  return record(session) && session.portal === "company"
    && typeof session.token === "string" && session.token.trim().length > 0
    && record(session.company) && isPositiveCompanyProfileId(session.company.id)
    && record(session.user) && isPositiveCompanyProfileId(session.user.id)
    && (session.user.role === "owner" || session.user.role === "dispatcher");
}

function isActiveMember(member: CompanyProfileMember | null | undefined): member is CompanyProfileMember {
  return record(member) && isPositiveCompanyProfileId(member.id) && member.isActive === true;
}

function hasMatchingScope(session: JobSyncNativeSession, member: CompanyProfileMember, companyId?: number): boolean {
  return (companyId === undefined || companyId === session.company?.id)
    && (member.companyId === undefined || member.companyId === session.company?.id);
}

/** Never send the broad role editor to owner targets or dispatcher -> dispatcher targets. */
export function canEditCompanyMemberProfile(
  session: JobSyncNativeSession | null | undefined,
  member: CompanyProfileMember | null | undefined,
  companyId?: number,
): boolean {
  if (!isCompanyProfileManagementSession(session) || !isActiveMember(member) || !hasMatchingScope(session, member, companyId)) return false;
  const role = targetRole(member);
  return role === "technician" || role === "detailer" || (role === "dispatcher" && session.user.role === "owner");
}

/** Capability writes require explicit provenance from a Company-scoped target read. */
export function canUpdateCompanyMemberFieldwork(
  session: JobSyncNativeSession | null | undefined,
  member: CompanyProfileMember | null | undefined,
  targetCompanyId: number | null | undefined,
): boolean {
  return isPositiveCompanyProfileId(targetCompanyId)
    && targetCompanyId === session?.company?.id
    && canEditCompanyMemberProfile(session, member, targetCompanyId);
}

/** Other managers' current overrides stay UNKNOWN until JobSync fixes roster/detail reads. */
export function getCompanyAdminFieldworkPolicy(
  session: JobSyncNativeSession | null | undefined,
  member: CompanyProfileMember | null | undefined,
  targetCompanyId?: number,
) {
  const visible = isCompanyProfileManagementSession(session) && isActiveMember(member)
    && hasMatchingScope(session, member, targetCompanyId)
    && ["owner", "admin", "dispatcher"].includes(targetRole(member) ?? "");
  return {
    visible,
    canEdit: visible && canUpdateCompanyMemberFieldwork(session, member, targetCompanyId),
    status: "unavailable" as const,
    value: null,
    defaultValue: false as const,
  };
}

/** Includes opt-in snapshot so an auth-context capability change invalidates prior observations. Never log/store this key. */
export function companyProfileSessionKey(session: JobSyncNativeSession | null | undefined): string | null {
  if (!isCompanyProfileManagementSession(session)) return null;
  const capability = session.user as JobSyncNativeSession["user"] & { calendarEligible?: unknown };
  const present = Object.prototype.hasOwnProperty.call(capability, "calendarEligible");
  const value = capability.calendarEligible;
  return JSON.stringify([session.portal, session.token, session.company!.id, session.user.id, session.user.role,
    present, value === true ? "true" : value === false ? "false" : value === null ? "null" : "missing-or-malformed"]);
}

/** Only construct at the successful, fresh GET auth/session boundary; a cached login session is not evidence. */
export type VerifiedCompanyProfileSession = {
  source: "signed-auth-session";
  requestKey: string;
  verifiedAt: number;
  session: JobSyncNativeSession;
};

export function verifyCompanyProfileSession(
  expected: JobSyncNativeSession | null | undefined,
  live: JobSyncNativeSession | null | undefined,
  verifiedAt: number,
): VerifiedCompanyProfileSession | null {
  const requestKey = companyProfileSessionKey(expected);
  if (!requestKey || !isCompanyProfileManagementSession(live) || !Number.isFinite(verifiedAt) || verifiedAt < 0) return null;
  if (live.token !== expected!.token || live.company!.id !== expected!.company!.id
    || live.user.id !== expected!.user.id || live.user.role !== expected!.user.role) return null;
  // Copy identity and capability so later mutation of the transport object cannot alter evidence.
  return { source: "signed-auth-session", requestKey, verifiedAt,
    session: { ...live, company: { ...live.company! }, user: { ...live.user } } };
}

export function isFreshCompanyProfileSession(
  expected: JobSyncNativeSession | null | undefined,
  verified: VerifiedCompanyProfileSession | null | undefined,
  now: number,
): verified is VerifiedCompanyProfileSession {
  if (!verified || verified.source !== "signed-auth-session" || !Number.isFinite(now)
    || !Number.isFinite(verified.verifiedAt) || verified.verifiedAt < 0) return false;
  const age = now - verified.verifiedAt;
  if (age < 0 || age >= COMPANY_PROFILE_SESSION_MAX_AGE_MS || verified.requestKey !== companyProfileSessionKey(expected)) return false;
  return verifyCompanyProfileSession(expected, verified.session, verified.verifiedAt) !== null;
}

export type CompanySelfFieldworkStatus = { status: "on" | "off" | "unknown"; value: boolean | null; reason: string };

/** Signed self override only, never roster position flags or the native display role. */
export function getCompanySelfFieldworkStatus(
  expected: JobSyncNativeSession | null | undefined,
  verified: VerifiedCompanyProfileSession | null | undefined,
  now: number,
): CompanySelfFieldworkStatus {
  if (!isFreshCompanyProfileSession(expected, verified, now)) {
    return { status: "unknown", value: null, reason: "UNKNOWN · Refresh the signed Company session to verify the current individual override. Default OFF is not a verified current value." };
  }
  const user = verified.session.user as JobSyncNativeSession["user"] & { calendarEligible?: unknown };
  if (!Object.prototype.hasOwnProperty.call(user, "calendarEligible") || (user.calendarEligible !== true && user.calendarEligible !== false && user.calendarEligible !== null)) {
    return { status: "unknown", value: null, reason: "UNKNOWN · The signed session did not provide a valid individual field-job override. Default OFF does not mean the server confirmed OFF." };
  }
  if (user.calendarEligible === true) {
    return { status: "on", value: true, reason: "ON · The server confirms your individual override is TRUE. Your management role is unchanged. Calendar inclusion and automatic booking are not fully verified." };
  }
  return { status: "off", value: false, reason: user.calendarEligible === false
    ? "OFF · The server confirms your individual override is FALSE. Your management role is unchanged."
    : "OFF · The server returned no individual override (NULL). Admin defaults to OFF; your management role is unchanged." };
}
