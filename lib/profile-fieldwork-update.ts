import { getJobSyncMobileSession, normalizeJobSyncMobileSession, updateJobSyncCompanyMember, updateJobSyncCompanyOwnFieldwork, type JobSyncNativeSession } from "./jobsync-mobile-api";
import {
  canUpdateCompanyMemberFieldwork, canUpdateCompanyOwnFieldwork, companyProfileSessionKey, verifyCompanyProfileSession,
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

export type CompanyOwnFieldworkUpdateTransport = (
  token: string, input: { calendarEligibleOverride: boolean },
) => Promise<unknown>;

/** The self PATCH returns a direct Company profile, not a member envelope or replacement token. */
export function validateCompanyOwnFieldworkUpdateAcknowledgment(
  payload: unknown, session: JobSyncNativeSession, value: boolean,
): CompanyFieldworkUpdateAcknowledgment | null {
  if (!canUpdateCompanyOwnFieldwork(session) || typeof value !== "boolean") return null;
  const root = object(payload);
  const user = object(root?.user);
  const company = object(root?.company);
  if (!root || root.accountType !== "company" || !user || !company
    || user.id !== session.user.id || company.id !== session.company!.id
    || user.role !== session.user.role || user.calendarEligible !== value) return null;
  const normalized = normalizeJobSyncMobileSession(payload, session.token);
  if (!verifyCompanyProfileSession(session, normalized, Date.now())) return null;
  return { id: session.user.id, role: session.user.role, calendarEligibleOverride: value,
    message: `Server confirmed your individual override ${value ? "TRUE" : "FALSE"}; management role unchanged. Candidate lanes are not a guarantee of assignment or automatic booking.` };
}

/** Always reconcile a sent request, even if it failed or focus/identity was invalidated.
 * Reconciliation uses the captured bearer only; stale results must never reach current UI/context.
 * Local generations are not backend optimistic versions. No target ID or protected field is sent.
 */
export async function updateCompanyOwnFieldwork(input: {
  session: JobSyncNativeSession;
  value: boolean;
  isCurrent: () => boolean;
  reconcile?: (expected: JobSyncNativeSession) => Promise<JobSyncNativeSession>;
  api?: { readSession: CompanyProfileSessionTransport; update: CompanyOwnFieldworkUpdateTransport };
}): Promise<{ acknowledgment: CompanyFieldworkUpdateAcknowledgment; verified: VerifiedCompanyProfileSession }> {
  if (!canUpdateCompanyOwnFieldwork(input.session) || typeof input.value !== "boolean" || !input.isCurrent()) {
    throw new Error("A current signed Company owner or Admin self session and explicit ON/OFF are required.");
  }
  const session = { ...input.session, company: { ...input.session.company! }, user: { ...input.session.user } };
  const value = input.value;
  const current = () => input.isCurrent() && companyProfileSessionKey(input.session) === companyProfileSessionKey(session);
  const api = input.api ?? { readSession: getJobSyncMobileSession, update: updateJobSyncCompanyOwnFieldwork };
  await refreshCompanyProfileSession({ session, isCurrent: current, readSession: api.readSession });
  if (!current()) throw new Error("Company identity changed before sending. No update was sent.");
  let acknowledgment: CompanyFieldworkUpdateAcknowledgment | null = null;
  let failure: unknown;
  try {
    const payload = await api.update(session.token, { calendarEligibleOverride: value });
    acknowledgment = validateCompanyOwnFieldworkUpdateAcknowledgment(payload, session, value);
    if (!acknowledgment) throw new Error("The server did not acknowledge your exact Company, user, unchanged raw role and requested Boolean override. Do not assume it was saved.");
  } catch (error) { failure = error; }
  let verified: VerifiedCompanyProfileSession | null = null;
  try {
    // Do not skip the captured-token GET after blur/switch; only discard its result.
    const live = await (input.reconcile ? input.reconcile(session) : api.readSession(session.token));
    verified = verifyCompanyProfileSession(session, live, Date.now());
    if (!verified) throw new Error("Signed Company identity or live management role changed.");
  } catch {
    throw new Error("Could not verify the signed session after the fieldwork request. Current value is UNKNOWN; do not assume it was saved.");
  }
  if (!current()) throw new Error("Company, user, token, role or focus changed. No result was applied; refresh the current account.");
  if (failure) throw new Error(`${failure instanceof Error ? failure.message : "Fieldwork request failed."} Signed session reconciliation was attempted; no saved result is claimed.`);
  if (verified.session.user.calendarEligible !== value) throw new Error("The refreshed signed override differs from the request. Current value is UNKNOWN; no saved result is claimed.");
  return { acknowledgment: acknowledgment!, verified };
}
