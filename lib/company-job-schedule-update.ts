import {
  getJobSyncCompanyJobDetail,
  getJobSyncCompanySettings,
  getJobSyncMobileSession,
  type JobSyncCompanyJobDetail,
  type JobSyncCompanySettings,
  type JobSyncNativeSession,
} from "./jobsync-mobile-api";
import { companyCalendarInstant, companyCalendarSlot } from "./company-calendar";

/** Exact 66141 schedule PATCH; assignment is always explicit, including null. */
export type CompanyJobScheduleMutation = {
  scheduledStartAt: string;
  scheduledEndAt: string;
  assignedUserId: number | null;
  expectedUpdatedAt: string;
};
/** Parent supplies the existing bearer adapter. No second origin/fetch or assignment write. */
export type CompanyJobScheduleWriter = (
  token: string,
  jobId: number,
  input: CompanyJobScheduleMutation,
) => Promise<unknown>;
export type CompanyJobScheduleSnapshot = {
  id: number;
  companyId: number;
  updatedAt: string | null;
  assignedUserId: number | null;
  date: string;
  startHour: number;
  endHour: number;
};
export type CompanyJobScheduleDraft = Pick<CompanyJobScheduleSnapshot, "date" | "startHour" | "endHour" | "assignedUserId">;
export type CompanyJobScheduleTransport = {
  session: typeof getJobSyncMobileSession;
  detail: typeof getJobSyncCompanyJobDetail;
  /** Must enforce requireTimezone:true; unknown settings cannot use a default zone. */
  settings: (token: string) => Promise<JobSyncCompanySettings>;
};
const transport: CompanyJobScheduleTransport = {
  session: getJobSyncMobileSession,
  detail: getJobSyncCompanyJobDetail,
  settings: (token) => getJobSyncCompanySettings(token, { requireTimezone: true }),
};
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const instant = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const sameInstant = (a: unknown, b: unknown) => instant(a) && instant(b) && Date.parse(a) === Date.parse(b);

export function companyJobScheduleScope(session: JobSyncNativeSession | null): string | null {
  if (session?.portal !== "company" || typeof session.token !== "string" || !session.token
    || /[\u0000-\u0020\u007f]/.test(session.token) || !positive(session.company?.id)
    || !positive(session.user.id) || !["owner", "dispatcher"].includes(session.user.role)) return null;
  return JSON.stringify([session.portal, session.token, session.company.id, session.user.id, session.user.role]);
}

/** Reject calendar rollover, silent timezone fallback, DST gaps and repeated wall times. */
export function companyJobScheduleInstant(date: string, hour: number, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(hour) || hour < 0 || hour > 24
    || Math.abs(hour * 60 - Math.round(hour * 60)) > 1e-7) throw new Error("Choose a valid Company date and minute-aligned time.");
  const [year, month, day] = date.split("-").map(Number);
  const midnight = new Date(Date.UTC(year, month - 1, day));
  if (year < 2000 || midnight.toISOString().slice(0, 10) !== date) throw new Error("Choose a real Company calendar date.");
  if (typeof timezone !== "string" || !timezone.trim()) throw new Error("The Company timezone is unavailable. Refresh before saving.");
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch { throw new Error("The Company timezone is invalid. Refresh before saving."); }
  const expectedDate = hour === 24 ? new Date(midnight.getTime() + 86_400_000).toISOString().slice(0, 10) : date;
  const minutes = hour === 24 ? 0 : Math.round(hour * 60);
  const matches = (value: number) => {
    const parts = formatter.formatToParts(new Date(value));
    const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
    return `${read("year")}-${read("month")}-${read("day")}` === expectedDate
      && Number(read("hour")) * 60 + Number(read("minute")) === minutes;
  };
  const iso = companyCalendarInstant(expectedDate, minutes / 60, timezone);
  if (!iso || !matches(Date.parse(iso))) throw new Error("That Company time does not exist because of a clock change. Choose another time.");
  // Minute resolution matches the editor; a wide window also catches non-hour and date-line folds.
  for (let offset = -26 * 60; offset <= 26 * 60; offset++) {
    if (offset && matches(Date.parse(iso) + offset * 60_000)) throw new Error("That Company time repeats during a clock change. Choose an unambiguous time.");
  }
  return iso;
}

/** The exact handler returns no version or Company ID; GET must establish those independently. */
export function verifyCompanyJobScheduleAck(payload: unknown, jobId: number, input: CompanyJobScheduleMutation): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const row = payload as Record<string, unknown>;
  return ["success", "jobId", "assignedUserId", "scheduledStartAt", "scheduledEndAt"].every((field) => Object.hasOwn(row, field))
    && row.success === true && row.jobId === jobId && row.assignedUserId === input.assignedUserId
    && sameInstant(row.scheduledStartAt, input.scheduledStartAt) && sameInstant(row.scheduledEndAt, input.scheduledEndAt);
}

// Job-wide locks survive controller/sheet remounts and token/role changes. No tokens/drafts are stored.
const writes = new Set<string>();
const unresolved = new Set<string>();
const lockKey = (companyId: number, jobId: number) => JSON.stringify([companyId, jobId]);
export function companyJobScheduleWriteBlocked(session: JobSyncNativeSession | null, jobId: number): boolean {
  if (!companyJobScheduleScope(session) || !positive(jobId)) return true;
  const key = lockKey(session!.company!.id, jobId);
  return writes.has(key) || unresolved.has(key);
}
export type CompanyJobScheduleResult = {
  status: "saved" | "blocked" | "conflict" | "uncertain" | "stale";
  message: string;
  detail?: JobSyncCompanyJobDetail;
  timezone?: string;
};
const interrupted = (): CompanyJobScheduleResult => ({ status: "stale", message: "Calendar editing was interrupted. Refresh and review before editing again." });
const uncertain = (): CompanyJobScheduleResult => ({ status: "uncertain", message: "Schedule save could not be confirmed. Refresh and review the current Job; do not resend blindly." });

/** Finite manager controller: one combined PATCH at most, fresh auth/detail/settings and canonical GET. */
export function createCompanyJobScheduleUpdateController(input: {
  session: JobSyncNativeSession;
  baseline: CompanyJobScheduleSnapshot;
  /** Parent captures identity, calendar/sheet/focus generations before any await. */
  isCurrent: () => boolean;
  verifyAssignment: (employeeId: string) => Promise<boolean>;
  write: CompanyJobScheduleWriter;
  api?: CompanyJobScheduleTransport;
  /** Optional real list/readback callback; false must never be reported as success. */
  onVerified?: (detail: JobSyncCompanyJobDetail, timezone: string) => Promise<boolean>;
}) {
  const original = { ...input.session, user: { ...input.session.user }, company: input.session.company ? { ...input.session.company } : undefined };
  const baseline = Object.freeze({ ...input.baseline });
  const scope = companyJobScheduleScope(original);
  const key = lockKey(baseline.companyId, baseline.id);
  const api = input.api ?? transport;
  let busy = false;
  let consumed = false;
  const current = () => Boolean(scope) && companyJobScheduleScope(input.session) === scope && input.isCurrent();
  const validDetail = (detail: JobSyncCompanyJobDetail) => detail.id === baseline.id && detail.companyId === original.company?.id
    && positive(detail.customerId) && instant(detail.updatedAt) && instant(detail.scheduledStartAt) && instant(detail.scheduledEndAt)
    && (detail.assignedUserId === null || positive(detail.assignedUserId)) && detail.status !== "cancelled";
  async function authenticate() {
    const actor = await api.session(original.token);
    if (!current()) return false;
    if (companyJobScheduleScope(actor) !== scope) throw new Error("Fresh Company management access could not be verified.");
    return true;
  }
  async function read() {
    if (!current() || !await authenticate()) return null;
    const detail = await api.detail(original.token, baseline.id, original.company!.id);
    if (!current()) return null;
    const settings = await api.settings(original.token);
    if (!current()) return null;
    if (!validDetail(detail) || settings.id !== original.company?.id) throw new Error("Current Company Job and settings could not be verified.");
    // Validate timezone even during read-only uncertainty reconciliation.
    if (!settings.timezone?.trim()) throw new Error("The Company timezone is missing.");
    new Intl.DateTimeFormat("en-US", { timeZone: settings.timezone }).format();
    if (!await authenticate() || !current()) return null;
    return { detail, timezone: settings.timezone };
  }
  return {
    /** Explicit read-only review unlocks future NEW controllers; it never retries this consumed edit. */
    async refresh(): Promise<{ detail: JobSyncCompanyJobDetail; timezone: string } | null> {
      if (busy || writes.has(key) || !current() || baseline.companyId !== original.company?.id || !positive(baseline.id)) return null;
      busy = true;
      writes.add(key); // Review cannot clear a newer concurrent mutation's uncertainty.
      try {
        const canonical = await read();
        if (!canonical || !current()) return null;
        if (input.onVerified && !await input.onVerified(canonical.detail, canonical.timezone)) return null;
        if (!current()) return null;
        unresolved.delete(key);
        return canonical;
      } catch { return null; } finally { busy = false; writes.delete(key); }
    },
    async save(draft: CompanyJobScheduleDraft): Promise<CompanyJobScheduleResult> {
      if (busy || consumed || companyJobScheduleWriteBlocked(original, baseline.id) || !current())
        return { status: "blocked", message: "Refresh and review this Company's calendar before editing again." };
      if (baseline.companyId !== original.company?.id || !instant(baseline.updatedAt)
        || (baseline.assignedUserId !== null && !positive(baseline.assignedUserId)))
        return { status: "blocked", message: "This Company Job version or assignment could not be verified. Refresh before editing." };
      const intent = Object.freeze({ ...draft }); // Capture immutable time/lane before any await.
      busy = true;
      writes.add(key);
      let attempted = false;
      try {
        const fresh = await read();
        if (!fresh || !current()) return interrupted();
        const slot = companyCalendarSlot(fresh.detail.scheduledStartAt, fresh.detail.scheduledEndAt, fresh.timezone);
        if (fresh.detail.updatedAt !== baseline.updatedAt || fresh.detail.assignedUserId !== baseline.assignedUserId
          || !slot || slot.date !== baseline.date || slot.startHour !== baseline.startHour || slot.endHour !== baseline.endHour)
          return { status: "conflict", message: "This Job or its schedule changed. Refresh and review before editing." };
        if (intent.assignedUserId !== null && !positive(intent.assignedUserId)) throw new Error("Choose a verified Company Team Member.");
        if (intent.startHour >= 24 || intent.endHour <= intent.startHour) throw new Error("Choose a valid Company time range ending after its start.");
        const mutation: CompanyJobScheduleMutation = Object.freeze({
          scheduledStartAt: companyJobScheduleInstant(intent.date, intent.startHour, fresh.timezone),
          scheduledEndAt: companyJobScheduleInstant(intent.date, intent.endHour, fresh.timezone),
          assignedUserId: intent.assignedUserId,
          expectedUpdatedAt: fresh.detail.updatedAt!,
        });
        if (Date.parse(mutation.scheduledEndAt) <= Date.parse(mutation.scheduledStartAt)) throw new Error("Choose an end after the start.");
        if (intent.assignedUserId !== baseline.assignedUserId && intent.assignedUserId !== null
          && !await input.verifyAssignment(`jobsync-${intent.assignedUserId}`)) throw new Error("This member is not a current Company field-assignment candidate. Refresh and select again.");
        if (!current() || !await authenticate() || !current()) return interrupted();
        consumed = true;
        attempted = true;
        unresolved.add(key);
        let ack: unknown;
        try { ack = await input.write(original.token, baseline.id, mutation); }
        catch { /* Transport failure can follow a committed write: read only, never resend. */ }
        if (!current()) return interrupted();
        const acknowledged = verifyCompanyJobScheduleAck(ack, baseline.id, mutation);
        const canonical = await read(); // GET even when PATCH acknowledgment is missing/malformed.
        if (!canonical || !current()) return interrupted();
        if (!acknowledged || canonical.detail.assignedUserId !== mutation.assignedUserId
          || !sameInstant(canonical.detail.scheduledStartAt, mutation.scheduledStartAt)
          || !sameInstant(canonical.detail.scheduledEndAt, mutation.scheduledEndAt)) return uncertain();
        if (input.onVerified && !await input.onVerified(canonical.detail, canonical.timezone)) return uncertain();
        if (!current()) return interrupted();
        unresolved.delete(key);
        return { status: "saved", message: "Schedule saved and verified.", ...canonical };
      } catch (error) {
        if (!current()) return interrupted();
        return attempted ? uncertain() : { status: "blocked", message: error instanceof Error
          && /^(Choose |That Company time |The Company timezone |This member )/.test(error.message)
          ? error.message : "Fresh Company access, Job or settings could not be verified. Refresh before editing." };
      } finally {
        busy = false;
        writes.delete(key);
      }
    },
  };
}
