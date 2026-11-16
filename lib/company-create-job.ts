import {
  createJobSyncCompanyJob, getJobSyncCompanyJobDetail, getJobSyncCompanyJobs,
  getJobSyncCompanyCustomer, getJobSyncCompanySettings, getJobSyncMobileSession,
  getHomeServiceConnectedPriceBook, JobSyncApiError,
  type HomeServiceConnectedPriceBookService, type JobSyncCompanyJobCreateInput,
  type JobSyncCompanyJobCreateResult, type JobSyncCompanyJobDetail,
  type JobSyncCompanySettings, type JobSyncNativeSession,
} from "./jobsync-mobile-api";
import { companyCalendarInstant } from "./company-calendar";

export type CompanyCreateJobDraft = {
  customerId: number;
  serviceId: string;
  assignedEmployeeId?: string;
  vehiclePriceKey?: string;
  date: string;
  startHour: number;
  endHour?: number;
  addressLine1?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  serviceNotes?: string;
  privateNotes?: string;
};
export type CompanyCreateJobState = {
  phase: "ready" | "validating" | "submitting" | "uncertain" | "saved" | "succeeded" | "error";
  message: string | null;
  jobId: number | null;
};
export type CompanyCreateJobTransport = {
  session: (token: string) => Promise<JobSyncNativeSession>;
  settings: (token: string) => Promise<JobSyncCompanySettings>;
  priceBook: (token: string) => Promise<HomeServiceConnectedPriceBookService[]>;
  customer: (token: string, id: number, companyId: number) => Promise<{ id: number; companyId?: number }>;
  create: (token: string, companyId: number, input: JobSyncCompanyJobCreateInput) => Promise<JobSyncCompanyJobCreateResult>;
  detail: typeof getJobSyncCompanyJobDetail;
  jobs: typeof getJobSyncCompanyJobs;
};
const transport: CompanyCreateJobTransport = {
  session: getJobSyncMobileSession, settings: (token) => getJobSyncCompanySettings(token, { requireTimezone: true }),
  priceBook: getHomeServiceConnectedPriceBook, customer: getJobSyncCompanyCustomer,
  create: createJobSyncCompanyJob, detail: getJobSyncCompanyJobDetail, jobs: getJobSyncCompanyJobs,
};
const ready = (): CompanyCreateJobState => ({ phase: "ready", message: null, jobId: null });
const positive = (id: unknown): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0;
export function companyCreateJobAllowed(session: JobSyncNativeSession | null | undefined): session is JobSyncNativeSession {
  return Boolean(session?.portal === "company" && session.token?.trim() && positive(session.company?.id)
    && positive(session.user.id) && ["owner", "dispatcher"].includes(session.user.role));
}
export function companyCreateJobScope(session: JobSyncNativeSession | null) {
  return companyCreateJobAllowed(session) ? JSON.stringify([session.portal, session.token, session.company!.id, session.user.id, session.user.role]) : null;
}
export function companyCreateJobRateKeys(service: HomeServiceConnectedPriceBookService) {
  return Object.entries(service.vehiclePrices).filter(([key, amount]) => key.length > 0 && key.length <= 64 && Number.isFinite(amount) && amount > 0).map(([key]) => key);
}

/** Strict Company wall time. Reject rollover, DST gaps and repeated times rather than guess. */
export function companyCreateJobInstant(date: string, hour: number, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(hour) || hour < 0 || hour > 24
    || Math.abs(hour * 60 - Math.round(hour * 60)) > 1e-7) throw new Error("Choose a valid Company date and minute-aligned time.");
  const [year, month, day] = date.split("-").map(Number);
  const dayInstant = new Date(Date.UTC(year, month - 1, day));
  if (year < 2000 || dayInstant.toISOString().slice(0, 10) !== date) throw new Error("Choose a real Company calendar date.");
  if (!timezone?.trim()) throw new Error("The Company timezone is unavailable. Refresh before saving.");
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch { throw new Error("The Company timezone is invalid. Refresh before saving."); }
  const expectedDate = hour === 24 ? new Date(dayInstant.getTime() + 86_400_000).toISOString().slice(0, 10) : date;
  const minutes = hour === 24 ? 0 : Math.round(hour * 60);
  const matches = (value: number) => {
    const parts = formatter.formatToParts(new Date(value));
    const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
    return `${read("year")}-${read("month")}-${read("day")}` === expectedDate && Number(read("hour")) * 60 + Number(read("minute")) === minutes;
  };
  const iso = companyCalendarInstant(expectedDate, minutes / 60, timezone);
  if (!iso || !matches(Date.parse(iso))) throw new Error("That Company time does not exist because of a clock change. Choose another time.");
  // Sample neighboring instants for a second representation of the same wall time,
  // including half-hour DST transitions (e.g. Lord Howe).
  for (let offset = -180; offset <= 180; offset += 15) {
    if (offset && matches(Date.parse(iso) + offset * 60_000)) throw new Error("That Company time repeats during a clock change. Choose an unambiguous time.");
  }
  return iso;
}

type Attempt = {
  state: CompanyCreateJobState;
  busy: boolean;
  sent: boolean;
  payload?: JobSyncCompanyJobCreateInput;
  timezone?: string;
  ack?: JobSyncCompanyJobCreateResult;
};
// Actor-wide memory-only locks span both calendar screens and sheet close/reopen.
// No token/customer PII is persisted. App restart is not an exactly-once guarantee.
const attempts = new Map<string, Attempt>();
const listeners = new Map<string, Set<() => void>>();
const actorKey = (session: JobSyncNativeSession) => `${session.company!.id}:${session.user.id}`;
const savedMessage = "Job saved, but calendar readback could not be confirmed. Refresh the calendar; do not create this Job again.";
const uncertainMessage = "This request may have created a Job. Check the Company calendar before creating another. Do not resend this request.";
function notify(key: string) { listeners.get(key)?.forEach((listener) => listener()); }
function definitiveRejection(error: unknown) {
  // Unknown BAD_REQUEST may originate after commit. Do not unlock on status alone.
  if (!(error instanceof JobSyncApiError)) return false;
  if ([401, 403].includes(error.status ?? 0)) return true;
  return ["Customer not found in this Company.", "Active Price Book service not found in this Company.",
    "A vehicle pricing tier is required for this Price Book service.", "Scheduled end time must be after the start time.",
    "That Price Book rate selection is invalid.", "That vehicle pricing key is not recognized.",
    "That Price Book rate selection is not defined on this service.", "This Price Book item does not have a valid base price.",
    "Choose a Team Member whose position is enabled for the calendar.",
    "This Team Member has approved time off on the scheduled date."].includes(error.message);
}
function instantEqual(a: string | null | undefined, b: string | null | undefined) {
  return Boolean(a && b && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b));
}

export function createCompanyJobController(input: {
  session: JobSyncNativeSession;
  isCurrent: () => boolean;
  verifyAssignment: (employeeId: string) => Promise<boolean>;
  onState: (state: CompanyCreateJobState) => void;
  onCreated: (detail: JobSyncCompanyJobDetail, timezone: string) => void;
  transport?: CompanyCreateJobTransport;
}) {
  const api = input.transport ?? transport;
  const origin = structuredSession(input.session);
  const scope = companyCreateJobScope(origin);
  const key = companyCreateJobAllowed(origin) ? actorKey(origin) : "denied";
  let detached = false;
  let localState = ready();
  const current = () => !detached && Boolean(scope) && input.isCurrent() && companyCreateJobScope(input.session) === scope;
  const getState = () => attempts.get(key)?.state ?? localState;
  const publish = () => { if (current()) input.onState(getState()); };
  let set = listeners.get(key);
  if (!set) listeners.set(key, set = new Set());
  set.add(publish);
  const patch = (attempt: Attempt, state: CompanyCreateJobState) => { attempt.state = state; notify(key); };
  const fresh = async () => {
    if (!current()) return false;
    const actor = await api.session(origin.token);
    if (!current()) return false;
    if (!companyCreateJobAllowed(actor) || companyCreateJobScope(actor) !== scope) throw new Error("Your Company sign-in changed. Reopen Add Job before saving.");
    return true;
  };
  const recoverDetail = async (attempt: Attempt) => {
    if (!attempt.ack || !attempt.timezone || !await fresh() || !current()) return false;
    const ack = attempt.ack;
    const detail = await api.detail(origin.token, ack.id, origin.company!.id);
    if (!current()) return false;
    if (detail.id !== ack.id || detail.companyId !== origin.company!.id || detail.customerId !== ack.customerId
      || detail.assignedUserId !== ack.assignedUserId || !instantEqual(detail.scheduledStartAt, ack.scheduledStartAt)
      || !instantEqual(detail.scheduledEndAt, ack.scheduledEndAt) || detail.amount !== ack.amount) throw new Error(savedMessage);
    const succeeded: CompanyCreateJobState = { phase: "succeeded", jobId: ack.id, message: "Job saved. Refreshing the Company calendar." };
    patch(attempt, succeeded);
    if (!current()) {
      patch(attempt, { phase: "saved", jobId: ack.id, message: savedMessage });
      return false;
    }
    localState = succeeded;
    input.onCreated(detail, attempt.timezone);
    attempts.delete(key);
    notify(key);
    return true;
  };
  const submit = async (draft: CompanyCreateJobDraft) => {
    if (!current() || attempts.has(key) || localState.phase === "succeeded") return false;
    const attempt: Attempt = { state: { phase: "validating", jobId: null, message: "Verifying Company customer, service and schedule…" }, busy: true, sent: false };
    attempts.set(key, attempt); notify(key);
    try {
      const captured = { ...draft };
      if (!positive(captured.customerId) || !/^\d+$/.test(captured.serviceId) || !positive(Number(captured.serviceId))) throw new Error("Choose an existing Company customer and active Price Book service.");
      if (!await fresh() || !current()) return false;
      const services = await api.priceBook(origin.token);
      if (!current()) return false;
      const service = services.find((candidate) => candidate.serviceId === captured.serviceId);
      if (!service) throw new Error("This service is no longer in the active Company Price Book. Refresh and select again.");
      const customer = await api.customer(origin.token, captured.customerId, origin.company!.id);
      if (!current()) return false;
      if (customer.id !== captured.customerId || (customer.companyId !== undefined && customer.companyId !== origin.company!.id)) throw new Error("The selected Company customer could not be verified. Select again.");
      const settings = await api.settings(origin.token);
      if (!current()) return false;
      if (settings.id !== origin.company!.id) throw new Error("The Company schedule settings could not be verified.");
      const scheduledStartAt = companyCreateJobInstant(captured.date, captured.startHour, settings.timezone);
      const scheduledEndAt = captured.endHour === undefined ? undefined : companyCreateJobInstant(captured.date, captured.endHour, settings.timezone);
      if (captured.startHour === 24 || (scheduledEndAt && Date.parse(scheduledEndAt) <= Date.parse(scheduledStartAt))) throw new Error("The scheduled end must be after the start time.");
      const rates = companyCreateJobRateKeys(service);
      if (captured.vehiclePriceKey && !rates.includes(captured.vehiclePriceKey)) throw new Error("This service rate is no longer available. Refresh and select again.");
      if ((service as HomeServiceConnectedPriceBookService & { basePrice?: number }).basePrice === 0 && rates.length && !captured.vehiclePriceKey) throw new Error("Choose a returned Price Book service rate.");
      let assignedUserId: number | undefined;
      if (captured.assignedEmployeeId) {
        if (!/^jobsync-[1-9]\d*$/.test(captured.assignedEmployeeId) || !positive(Number(captured.assignedEmployeeId.slice(8)))) throw new Error("Choose a verified Company assignment candidate.");
        if (!await input.verifyAssignment(captured.assignedEmployeeId)) throw new Error("This member is not a currently verified assignment candidate. Refresh and select again.");
        if (!current()) return false;
        assignedUserId = Number(captured.assignedEmployeeId.slice(8));
      }
      const payload: JobSyncCompanyJobCreateInput = { customerId: captured.customerId, priceBookServiceId: Number(captured.serviceId), scheduledStartAt };
      if (scheduledEndAt) payload.scheduledEndAt = scheduledEndAt;
      if (assignedUserId !== undefined) payload.assignedUserId = assignedUserId;
      if (captured.vehiclePriceKey) payload.vehiclePriceKey = captured.vehiclePriceKey;
      const limits = { addressLine1: 255, city: 96, region: 96, postalCode: 24, serviceNotes: 4000, privateNotes: 4000 } as const;
      for (const field of Object.keys(limits) as (keyof typeof limits)[]) {
        const value = captured[field];
        if (value === undefined) continue;
        if (typeof value !== "string" || value.trim().length > limits[field]) throw new Error("A Job address or note exceeds the supported limit.");
        if (value.trim()) payload[field] = value.trim();
      }
      if (!await fresh() || !current()) return false;
      attempt.payload = payload; attempt.timezone = settings.timezone;
      patch(attempt, { phase: "submitting", message: "Saving Job… Do not submit again.", jobId: null });
      if (!current()) return false;
      attempt.sent = true;
      const ack = await api.create(origin.token, origin.company!.id, payload);
      // Settling the originating attempt is mandatory even after its sheet closes.
      attempt.ack = ack;
      patch(attempt, { phase: "saved", message: savedMessage, jobId: positive(ack.id) ? ack.id : null });
      if (!positive(ack.id) || ack.companyId !== origin.company!.id || ack.customerId !== payload.customerId
        || ack.priceBookServiceId !== payload.priceBookServiceId || ack.assignedUserId !== (payload.assignedUserId ?? null)
        || !instantEqual(ack.scheduledStartAt, payload.scheduledStartAt)
        || (payload.scheduledEndAt && !instantEqual(ack.scheduledEndAt, payload.scheduledEndAt))
        || !Number.isFinite(ack.amount) || ack.amount < 0) {
        attempt.ack = undefined;
        patch(attempt, { phase: "uncertain", message: uncertainMessage, jobId: null });
        return false;
      }
      if (!current()) return false;
      return await recoverDetail(attempt);
    } catch (error) {
      if (!attempt.sent || (!attempt.ack && definitiveRejection(error))) {
        attempts.delete(key);
        localState = { phase: "error", jobId: null, message: error instanceof Error ? error.message : "Could not verify this Company Job." };
        notify(key);
      } else {
        patch(attempt, { phase: attempt.ack ? "saved" : "uncertain", message: attempt.ack ? savedMessage : uncertainMessage, jobId: attempt.ack?.id ?? null });
      }
      return false;
    } finally {
      attempt.busy = false;
      if (!attempt.sent && attempts.get(key) === attempt) attempts.delete(key);
      notify(key);
    }
  };
  const reconcile = async () => {
    const attempt = attempts.get(key);
    if (!current() || !attempt || attempt.busy) return false;
    attempt.busy = true;
    try {
      if (attempt.ack) return await recoverDetail(attempt);
      if (!await fresh() || !current()) return false;
      await api.jobs(origin.token);
      if (!current()) return false;
      patch(attempt, { ...attempt.state, message: `${uncertainMessage} Calendar records refreshed; absence from this list is not proof that the Job was not saved.` });
      return false;
    } catch {
      patch(attempt, { ...attempt.state, message: attempt.ack ? savedMessage : uncertainMessage });
      return false;
    } finally { attempt.busy = false; notify(key); }
  };
  return { submit, reconcile, getState, isBusy: () => Boolean(attempts.get(key)?.busy), detach: () => { detached = true; set?.delete(publish); if (!set?.size) listeners.delete(key); } };
}
function structuredSession(session: JobSyncNativeSession): JobSyncNativeSession {
  return { ...session, user: { ...session.user }, ...(session.company ? { company: { ...session.company } } : {}) };
}
