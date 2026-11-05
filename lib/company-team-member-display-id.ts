import type { JobSyncCompanySession } from "./jobsync-role-map";

function companyPrefix(name: string | undefined, companyId: number): string {
  const trimmed = name?.trim() ?? "";
  const prefix = trimmed
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  // Do not present the API's generic missing-name placeholder as a company name.
  return prefix && prefix !== "COMPANY-WORKSPACE" ? prefix : `COMPANY-${companyId}`;
}

/**
 * A human-readable reference for Settings only, not a login ID or API identity.
 * The authenticated Company session is authoritative; never parse another
 * cached native session to decide which Company or Team Member to display.
 */
export function getCompanyTeamMemberDisplayId(session: JobSyncCompanySession | null | undefined): string | null {
  if (session?.portal !== "company" || !session.company) return null;
  if (!Number.isSafeInteger(session.company.id) || session.company.id <= 0) return null;
  if (!Number.isSafeInteger(session.user.id) || session.user.id <= 0) return null;

  const prefix = companyPrefix(session.company.name, session.company.id);
  const suppliedCode = session.user.memberId?.trim();
  // Internal bridge IDs must never leak back into the user-facing reference.
  const memberCode = suppliedCode && !/^jobsync-/i.test(suppliedCode)
    ? suppliedCode
    : String(session.user.id);

  // Preserve an already Company-prefixed backend code without a double prefix.
  if (memberCode.toUpperCase().startsWith(`${prefix}-`)) return memberCode;
  return `${prefix}-${memberCode}`;
}
