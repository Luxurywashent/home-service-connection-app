import { getJobSyncMobileSession, updateJobSyncCompanyMember, type JobSyncNativeSession } from "./jobsync-mobile-api";
import {
  canUpdateCompanyMemberFieldwork, companyProfileSessionKey, verifyCompanyProfileSession,
  type CompanyProfileMember, type VerifiedCompanyProfileSession,
} from "./profile-fieldwork-policy";

export type CompanyProfileSessionTransport = (token: string) => Promise<JobSyncNativeSession>;

/** Calls the existing no-store signed GET auth/session. A cached auth context is never fresh evidence. */
export async function refreshCompanyProfileSession(input: {
  session: JobSyncNativeSession;
  isCurrent: () => boolean;
  readSession?: CompanyProfileSessionTransport;
  now?: () => number;
}): Promise<VerifiedCompanyProfileSession> {
  if (!companyProfileSessionKey(input.session) || !input.isCurrent()) throw new Error("A current signed Company management session is required.");
  const expected = { ...input.session, company: { ...input.session.company! }, user: { ...input.session.user } };
  const live = await (input.readSession ?? getJobSyncMobileSession)(expected.token);
  if (!input.isCurrent()) throw new Error("Company identity changed. Refresh the current account.");
  if (companyProfileSessionKey(input.session) !== companyProfileSessionKey(expected)) throw new Error("Company identity changed. Refresh the current account.");
  const verified = verifyCompanyProfileSession(expected, live, (input.now ?? Date.now)());
  if (!verified) throw new Error("Could not verify the current Company, user and live management role. Sign in again or retry.");
  return verified;
}

export type CompanyFieldworkUpdateTransport = (
  token: string, memberId: number, input: { calendarEligibleOverride: boolean },
) => Promise<unknown>;

export type CompanyFieldworkUpdateAcknowledgment = {
  id: number;
  role: string;
  calendarEligibleOverride: boolean;
  message: string;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function validateCompanyFieldworkUpdateAcknowledgment(
  payload: unknown, target: CompanyProfileMember, value: boolean,
): CompanyFieldworkUpdateAcknowledgment | null {
  const member = object(object(payload)?.member);
  if (!member || member.id !== target.id || member.role !== target.role || (member.isActive !== undefined && member.isActive !== true)) return null;
  // Pinned PATCH's calendarEligible is the RAW stored override, not the roster effective/position flag.
  const hasOverride = Object.prototype.hasOwnProperty.call(member, "calendarEligibleOverride");
  const override = hasOverride ? member.calendarEligibleOverride : member.calendarEligible;
  if (override !== value || (hasOverride && Object.prototype.hasOwnProperty.call(member, "calendarEligible") && member.calendarEligible !== value)) return null;
  return { id: target.id, role: target.role, calendarEligibleOverride: value,
    message: `Server confirmed individual override ${value ? "TRUE" : "FALSE"}; role unchanged. Calendar inclusion and automatic booking remain unverified because roster/detail eligibility reads are incomplete.` };
}

/**
 * Explicit Enable/Disable only; NULL is inheritance, never OFF. No broad profile/role/position payload.
 * UI must synchronously lock while pending and invalidate acknowledgments on target/session change.
 * Refresh is required after ANY sent PATCH, including denial/offline/ambiguous acknowledgment.
 */
export async function updateCompanyMemberFieldwork(input: {
  session: JobSyncNativeSession;
  target: CompanyProfileMember;
  targetCompanyId: number;
  value: boolean;
  isCurrent: () => boolean;
  refresh: () => Promise<void>;
  api?: { readSession: CompanyProfileSessionTransport; update: CompanyFieldworkUpdateTransport };
}): Promise<CompanyFieldworkUpdateAcknowledgment> {
  if (typeof input.value !== "boolean" || !input.isCurrent()
    || !canUpdateCompanyMemberFieldwork(input.session, input.target, input.targetCompanyId)) {
    throw new Error("This active Company target does not permit a capability-only fieldwork update.");
  }
  // Snapshot identity before yielding so caller mutation cannot redirect a request.
  const session = { ...input.session, company: { ...input.session.company! }, user: { ...input.session.user } };
  const target = { ...input.target };
  const value = input.value;
  const targetCompanyId = input.targetCompanyId;
  const api = input.api ?? { readSession: getJobSyncMobileSession, update: updateJobSyncCompanyMember };
  const verified = await refreshCompanyProfileSession({ session, isCurrent: input.isCurrent, readSession: api.readSession });
  if (!canUpdateCompanyMemberFieldwork(verified.session, target, targetCompanyId) || !input.isCurrent()) {
    throw new Error("The current live role no longer permits this fieldwork update.");
  }
  let ack: CompanyFieldworkUpdateAcknowledgment | null = null;
  let failure: unknown;
  try {
    const payload = await api.update(session.token, target.id, { calendarEligibleOverride: value });
    if (!input.isCurrent()) throw new Error("Company or target changed while updating. No success can be claimed.");
    ack = validateCompanyFieldworkUpdateAcknowledgment(payload, target, value);
    if (!ack) throw new Error("The server did not acknowledge the exact target, unchanged role and requested override. Current value is UNKNOWN.");
    // A role change/revocation after sending invalidates success too.
    await refreshCompanyProfileSession({ session, isCurrent: input.isCurrent, readSession: api.readSession });
  } catch (error) { failure = error; }
  if (!input.isCurrent()) throw new Error("Company or target changed. Refresh the current account; no result was applied.");
  try { await input.refresh(); }
  catch { throw new Error("Could not refresh after the fieldwork request. Current value is UNKNOWN; do not assume it was saved."); }
  if (!input.isCurrent()) throw new Error("Company or target changed during refresh. No success can be claimed.");
  if (failure) throw failure;
  return ack!;
}
