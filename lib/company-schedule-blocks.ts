import {
  getJobSyncCompanyScheduleBlocks, createJobSyncCompanyScheduleBlock, deleteJobSyncCompanyScheduleBlock,
  getJobSyncCompanyMembers, getJobSyncMobileSession, JobSyncApiError,
  type JobSyncCompanyScheduleBlock, type JobSyncCompanyRoster, type JobSyncNativeSession,
} from "./jobsync-mobile-api";
import { companyCalendarDateAtPosition } from "./company-calendar";
import { companyProfileSessionKey, isCompanyProfileManagementSession } from "./profile-fieldwork-policy";
import { refreshCompanyProfileSession } from "./profile-fieldwork-update";

export type CompanyScheduleBlockInput = {
  startDate: string; endDate: string; employeeId: string; employeeName: string;
  startHour: number; endHour: number; blockType: JobSyncCompanyScheduleBlock["blockType"];
  title: string; notes?: string;
};
export type CompanyScheduleBlockForm = {
  employeeId: string; date: string; allDay: boolean; startHour: number; endHour: number; title: string;
};
export type CompanyScheduleBlockApi = {
  session: (token: string) => Promise<JobSyncNativeSession>;
  members: (token: string, companyId: number) => Promise<JobSyncCompanyRoster>;
  list: (token: string, companyId: number, date: string) => Promise<JobSyncCompanyScheduleBlock[]>;
  create: (token: string, companyId: number, input: CompanyScheduleBlockInput) => Promise<{ companyId: number; count: number }>;
  remove: (token: string, companyId: number, id: number) => Promise<{ companyId: number; success: true }>;
};
const nativeApi: CompanyScheduleBlockApi = {
  session: getJobSyncMobileSession, members: getJobSyncCompanyMembers,
  list: getJobSyncCompanyScheduleBlocks, create: createJobSyncCompanyScheduleBlock, remove: deleteJobSyncCompanyScheduleBlock,
};
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export function isCompanyScheduleBlockDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}
export function companyScheduleBlockDay(week: number, day: number, timezone: string | null, now = new Date()) {
  // Do not infer a Company date from the phone or the calendar helper's default zone.
  if (!timezone?.trim()) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(now); } catch { return null; }
  return companyCalendarDateAtPosition(week, day, now, timezone);
}
export function isCompanyScheduleBlockAllDay(block: Pick<JobSyncCompanyScheduleBlock, "startHour" | "endHour">) {
  return block.startHour === 0 && block.endHour === 24;
}
export function companyScheduleBlockMember(roster: JobSyncCompanyRoster, companyId: number, employeeId: string) {
  if (roster.company.id !== companyId || !/^[1-9]\d*$/.test(employeeId)) return null;
  const id = Number(employeeId);
  if (!positiveId(id) || String(id) !== employeeId) return null;
  const matches = roster.members.filter((member) => member.id === id && member.isActive === true
    && (!("companyId" in member) || (member as typeof member & { companyId: number }).companyId === companyId));
  return matches.length === 1 ? matches[0] : null;
}
export function companyScheduleBlockInput(form: CompanyScheduleBlockForm, roster: JobSyncCompanyRoster, companyId: number): CompanyScheduleBlockInput {
  const member = companyScheduleBlockMember(roster, companyId, form.employeeId);
  if (!member) throw new Error("Select a currently active member of this Company by their member ID. Refresh the team and select again.");
  if (!isCompanyScheduleBlockDate(form.date)) throw new Error("Select a valid Company calendar date.");
  const title = form.title.trim();
  if (!title || title.length > 255) throw new Error("Enter a reason between 1 and 255 characters.");
  const startHour = form.allDay ? 0 : form.startHour;
  const endHour = form.allDay ? 24 : form.endHour;
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour) || startHour < 0 || endHour > 24 || endHour <= startHour) {
    throw new Error("Select a valid time range: 0 ≤ start < end ≤ 24.");
  }
  return { startDate: form.date, endDate: form.date, employeeId: String(member.id), employeeName: member.name,
    startHour, endHour, blockType: title === "Day Off" ? "day_off" : title === "Sick" ? "sick_day" : "other", title };
}
function validRows(rows: JobSyncCompanyScheduleBlock[], date: string) {
  const ids = new Set<number>();
  for (const row of rows) {
    if (!positiveId(row.id) || ids.has(row.id) || !positiveId(row.employeeUserId) || row.date !== date
      || typeof row.employeeLabel !== "string" || !row.employeeLabel.trim() || typeof row.title !== "string" || !row.title.trim()
      || (row.notes !== null && typeof row.notes !== "string")
      || !["sick_day", "day_off", "training", "unavailable", "other"].includes(row.blockType)
      || !Number.isFinite(row.startHour) || !Number.isFinite(row.endHour) || row.startHour < 0 || row.endHour > 24 || row.endHour <= row.startHour) {
      throw new Error("Company schedule block response could not be verified. Refresh; no saved result is claimed.");
    }
    ids.add(row.id);
  }
  return rows.map((row) => ({ ...row }));
}
type CreateAttempt = { input: CompanyScheduleBlockInput; baseline: Set<number>; acknowledged: boolean };
export function soleNewCompanyScheduleBlock(rows: JobSyncCompanyScheduleBlock[], input: CompanyScheduleBlockInput, baseline: Set<number>) {
  const matching = rows.filter((row) => !baseline.has(row.id) && row.employeeUserId === Number(input.employeeId)
    && row.date === input.startDate && row.startHour === input.startHour && row.endHour === input.endHour
    && row.blockType === input.blockType && row.title === input.title && (row.notes ?? "") === (input.notes ?? ""));
  return matching.length === 1 ? matching[0] : null;
}
export type CompanyScheduleBlockScope = { session: JobSyncNativeSession | null; focused: boolean; enabled: boolean; date: string | null; boundary: string };
export type CompanyScheduleBlockState = {
  rows: JobSyncCompanyScheduleBlock[]; loading: boolean; pending: boolean; error: string | null; createHeld: boolean; readVerified: boolean;
};
const errorText = (error: unknown) => error instanceof Error ? error.message : "Could not complete the Company schedule block request.";
const unknownCreateMessage = "The block request may have been saved. Do not save again: refresh the schedule to check the original request. An empty list does not prove that no block was inserted.";

/** The actual screen lifecycle. All effects/handlers capture an immutable scope generation.
 * No legacy transport, persistence, optimistic cards, UTC hour conversion or automatic POST retry.
 * The unresolved-create hold survives date/focus/token switches within this mounted screen,
 * keyed by Company + manager (never by a logged/persisted bearer).
 */
export class CompanyScheduleBlocksLifecycle {
  state: CompanyScheduleBlockState = { rows: [], loading: false, pending: false, error: null, createHeld: false, readVerified: false };
  private scope: CompanyScheduleBlockScope | null = null;
  private key: string | null = null;
  private binding = "";
  private generation = 0;
  private readEpoch = 0;
  private mounted = true;
  private operationLock = false;
  private operationGeneration = -1;
  private uncertain = new Map<string, CreateAttempt>();
  onChange: () => void = () => {};
  constructor(private api: CompanyScheduleBlockApi = nativeApi) {}
  bind(scope: CompanyScheduleBlockScope) {
    const sessionKey = companyProfileSessionKey(scope.session);
    const key = scope.focused && scope.enabled && sessionKey && scope.date && isCompanyScheduleBlockDate(scope.date)
      ? JSON.stringify([sessionKey, scope.date, scope.boundary]) : null;
    const binding = JSON.stringify([key, scope.focused, scope.enabled, sessionKey, scope.date, scope.boundary]);
    if (binding !== this.binding) {
      this.binding = binding; this.key = key; this.generation++; this.readEpoch++;
      this.scope = { ...scope, session: scope.session ? { ...scope.session, user: { ...scope.session.user },
        ...(scope.session.company ? { company: { ...scope.session.company } } : {}) } : null };
      this.state = { rows: [], loading: Boolean(key), pending: false, error: null, createHeld: Boolean(this.attempt()), readVerified: false };
    }
    return binding;
  }
  mount() { this.mounted = true; }
  unmount() { this.mounted = false; this.generation++; this.readEpoch++; }
  private attemptKey(session = this.scope?.session) { return session?.portal === "company" && session.company ? `${session.company.id}:${session.user.id}` : null; }
  private attempt(session = this.scope?.session) { const key = this.attemptKey(session); return key ? this.uncertain.get(key) : undefined; }
  private update(current: () => boolean, patch: Partial<CompanyScheduleBlockState>) {
    if (!current()) return;
    this.state = { ...this.state, ...patch }; this.onChange();
  }
  capture() {
    const scope = this.scope;
    const key = this.key;
    const generation = this.generation;
    const current = () => this.mounted && Boolean(key) && this.key === key && this.generation === generation;
    const session = scope?.session;
    const verify = async () => {
      if (!session || !current() || !isCompanyProfileManagementSession(session)) throw new Error("Refresh the signed Company management session before managing blocks.");
      await refreshCompanyProfileSession({ session, isCurrent: current, readSession: this.api.session });
    };
    const list = async (date: string) => {
      if (!session || !current()) throw new Error("Company or calendar changed. Refresh the current schedule.");
      const rows = await this.api.list(session.token, session.company!.id, date);
      if (!current()) throw new Error("Company or calendar changed. No result was applied.");
      return validRows(rows, date);
    };
    const refresh = async (): Promise<boolean> => {
      if (!current() || !session || !scope?.date || (this.operationLock && this.operationGeneration === generation)) return false;
      const epoch = ++this.readEpoch;
      const readCurrent = () => current() && this.readEpoch === epoch;
      this.update(readCurrent, { rows: [], loading: true, error: null, createHeld: Boolean(this.attempt(session)), readVerified: false });
      try {
        await verify();
        const rows = await list(scope.date);
        await verify();
        if (!readCurrent()) return false;
        const attempt = this.attempt(session);
        let message: string | null = null;
        if (attempt) {
          const originalRows = attempt.input.startDate === scope.date ? rows : await list(attempt.input.startDate);
          await verify();
          const sole = soleNewCompanyScheduleBlock(originalRows, attempt.input, attempt.baseline);
          // An explicit new Save must not be enabled by an empty/ambiguous read-back.
          message = sole ? "The original block is now present on the server. Do not save it again. Cancel the form and verify the red card; this screen keeps duplicate creation on hold." : unknownCreateMessage;
        }
        this.update(readCurrent, { rows, loading: false, error: message, createHeld: Boolean(attempt), readVerified: true });
        return readCurrent();
      } catch (error) {
        this.update(readCurrent, { rows: [], loading: false, error: errorText(error), createHeld: Boolean(this.attempt(session)), readVerified: false });
        return false;
      }
    };
    const write = async (kind: "create" | "remove", form?: CompanyScheduleBlockForm, selectedId?: number, originCurrent: () => boolean = () => true): Promise<boolean> => {
      // Acquired before the first await, including fresh signed reads.
      if (!current() || !originCurrent() || !session || this.operationLock) return false;
      if (kind === "create" && this.attempt(session)) {
        this.update(current, { error: unknownCreateMessage, createHeld: true }); return false;
      }
      if (!this.state.readVerified || this.state.loading) {
        this.update(current, { error: "Refresh Company schedule blocks successfully before saving or removing a block." }); return false;
      }
      this.operationLock = true;
      this.operationGeneration = generation;
      ++this.readEpoch;
      this.update(current, { pending: true, error: null });
      let sent = false;
      let acknowledged = false;
      let invalidAcknowledgment = false;
      let formValidation = false;
      let attempt: CreateAttempt | undefined;
      const writeCurrent = () => current() && originCurrent();
      try {
        await verify();
        const roster = await this.api.members(session.token, session.company!.id);
        if (!writeCurrent()) return false;
        if (roster.company.id !== session.company!.id) throw new Error("The selected member belongs to another Company. Refresh and select again.");
        if (kind === "create") {
          formValidation = true;
          const input = companyScheduleBlockInput({ ...form! }, roster, session.company!.id);
          formValidation = false;
          const baseline = await list(input.startDate);
          await verify();
          if (!writeCurrent()) return false;
          attempt = { input, baseline: new Set(baseline.map((row) => row.id)), acknowledged: false };
          this.uncertain.set(this.attemptKey(session)!, attempt);
          sent = true;
          const ack = await this.api.create(session.token, session.company!.id, { ...input });
          if (ack.companyId !== session.company!.id || ack.count !== 1) {
            invalidAcknowledgment = true;
            throw new Error("The server did not acknowledge exactly one block in this Company.");
          }
          acknowledged = true; attempt.acknowledged = true;
          if (!writeCurrent()) return false;
          const rows = await list(input.startDate);
          await verify();
          if (!writeCurrent()) return false;
          if (!soleNewCompanyScheduleBlock(rows, input, attempt.baseline)) throw new Error("The acknowledged block could not be uniquely verified in the refreshed schedule. Do not save again; refresh.");
          if (scope!.date !== input.startDate) {
            const displayed = await list(scope!.date!);
            await verify();
            if (!writeCurrent()) return false;
            this.update(current, { rows: displayed, loading: false });
          } else this.update(current, { rows, loading: false });
          this.uncertain.delete(this.attemptKey(session)!);
          this.update(current, { createHeld: false, error: null, readVerified: true });
          return true;
        }
        const selected = this.state.rows.find((row) => row.id === selectedId);
        if (!positiveId(selectedId) || !selected || selected.date !== scope!.date
          || !companyScheduleBlockMember(roster, session.company!.id, String(selected.employeeUserId))) {
          throw new Error("This block or active Company member is no longer verified. Refresh before removing it.");
        }
        await verify();
        if (!writeCurrent()) return false;
        sent = true;
        const ack = await this.api.remove(session.token, session.company!.id, selectedId);
        if (ack.companyId !== session.company!.id || ack.success !== true) throw new Error("The server did not acknowledge removal in this Company.");
        acknowledged = true;
        if (!writeCurrent()) return false;
        const rows = await list(scope!.date!);
        await verify();
        if (!writeCurrent()) return false;
        if (rows.some((row) => row.id === selectedId)) throw new Error("The removed block is still present in the refreshed schedule. Refresh; no removed result is claimed.");
        this.update(current, { rows, loading: false, readVerified: true });
        return true;
      } catch (error) {
        if (kind === "create" && sent && attempt) {
          // Explicit native 4xx refusal is not an unknown transport outcome. A malformed
          // successful envelope/status is UNKNOWN even if its status happens to be 2xx.
          const rejected = !acknowledged && error instanceof JobSyncApiError && error.code !== "INVALID_RESPONSE"
            && error.status !== null && [400, 401, 403, 404, 409, 422].includes(error.status);
          if (rejected) this.uncertain.delete(this.attemptKey(session)!);
          else if (!invalidAcknowledgment && !(error instanceof JobSyncApiError && error.code === "INVALID_RESPONSE") && writeCurrent()) {
            try {
              await verify();
              const rows = await list(attempt.input.startDate);
              await verify();
              if (writeCurrent() && soleNewCompanyScheduleBlock(rows, attempt.input, attempt.baseline)) {
                const displayed = scope!.date === attempt.input.startDate ? rows : await list(scope!.date!);
                await verify();
                if (writeCurrent()) {
                  this.uncertain.delete(this.attemptKey(session)!);
                  this.update(current, { rows: displayed, loading: false, error: null, createHeld: false, readVerified: true });
                  return true;
                }
              }
            } catch { /* Keep the original unresolved request; never retry POST. */ }
          }
        }
        const held = Boolean(this.attempt(session));
        this.update(writeCurrent, { rows: formValidation ? this.state.rows : [], error: held ? `${errorText(error)} ${unknownCreateMessage}` : errorText(error),
          createHeld: held, loading: false, readVerified: formValidation ? this.state.readVerified : false });
        return false;
      } finally {
        this.operationLock = false;
        if (sent && this.attempt(session) && !originCurrent()) {
          this.update(current, { rows: [], loading: false, readVerified: false, error: unknownCreateMessage });
        }
        this.update(current, { pending: false, createHeld: Boolean(this.attempt(session)) });
      }
    };
    return { current, refresh,
      create: (form: CompanyScheduleBlockForm, originCurrent?: () => boolean) => write("create", { ...form }, undefined, originCurrent),
      remove: (id: number, originCurrent?: () => boolean) => write("remove", undefined, id, originCurrent),
    };
  }
}
