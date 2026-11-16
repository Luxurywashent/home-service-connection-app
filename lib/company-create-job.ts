import {
  createJobSyncCompanyJob, getJobSyncCompanyJobDetail, getJobSyncCompanyJobs,
  getJobSyncCompanyCustomer, getJobSyncCompanySettings, getJobSyncMobileSession,
  getHomeServiceConnectedPriceBook, getJobSyncCompanyJobCreationOperation,
  normalizeCompanyJobNewCustomer, type JobSyncCompanyJobCustomerSelector, type JobSyncCompanyCustomer,
  type HomeServiceConnectedPriceBookService, type JobSyncCompanyJobCreateInput,
  type JobSyncCompanyJobCreateResult, type JobSyncCompanyJobDetail,
  type JobSyncCompanySettings, type JobSyncNativeSession,
} from "./jobsync-mobile-api";
import { companyCalendarInstant } from "./company-calendar";
import {
  companyCreationStore, newCompanyCreationOperationKey,
  type CompanyCreationRecord, type CompanyCreationStore,
} from "./company-job-creation-storage";

export type CompanyCreateJobDraft = JobSyncCompanyJobCustomerSelector & {
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
  phase: "ready" | "restoring" | "validating" | "submitting" | "uncertain" | "pending" | "conflict" | "rejected" | "saved" | "succeeded" | "error";
  message: string | null;
  jobId: number | null;
  reconciling?: boolean;
  /** Read/refresh/persistence diagnostic, separate from the known save outcome. */
  detailError?: string | null;
};
export type CompanyCreateJobTransport = {
  session: (token: string) => Promise<JobSyncNativeSession>;
  settings: (token: string) => Promise<JobSyncCompanySettings>;
  priceBook: (token: string) => Promise<HomeServiceConnectedPriceBookService[]>;
  customer: (token: string, id: number, companyId: number) => Promise<{ id: number; companyId?: number } & Partial<JobSyncCompanyCustomer>>;
  create: (token: string, companyId: number, input: JobSyncCompanyJobCreateInput) => Promise<JobSyncCompanyJobCreateResult>;
  detail: typeof getJobSyncCompanyJobDetail;
  jobs: typeof getJobSyncCompanyJobs;
  /** Optional only for older injected transports; absence never authorizes a resend. */
  operation?: typeof getJobSyncCompanyJobCreationOperation;
};
const transport: CompanyCreateJobTransport = {
  session: getJobSyncMobileSession, settings: (token) => getJobSyncCompanySettings(token, { requireTimezone: true }),
  priceBook: getHomeServiceConnectedPriceBook, customer: getJobSyncCompanyCustomer,
  create: createJobSyncCompanyJob, detail: getJobSyncCompanyJobDetail, jobs: getJobSyncCompanyJobs,
  operation: getJobSyncCompanyJobCreationOperation,
};
const ready = (): CompanyCreateJobState => ({ phase: "ready", message: null, jobId: null });
const restoring = (): CompanyCreateJobState => ({ phase: "restoring", message: "Restoring this Company's previous Job request…", jobId: null });
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
  for (let offset = -180; offset <= 180; offset += 15) {
    if (offset && matches(Date.parse(iso) + offset * 60_000)) throw new Error("That Company time repeats during a clock change. Choose an unambiguous time.");
  }
  return iso;
}

type Attempt = {
  state: CompanyCreateJobState;
  record?: CompanyCreationRecord;
  ack?: JobSyncCompanyJobCreateResult;
  /** A write may have completed even when its promise rejected. Never infer absence. */
  reserved: boolean;
  dirty: boolean;
};
type Actor = { hydrated: boolean; hydration?: Promise<boolean>; busy: boolean; attempt?: Attempt };
// Memory only coordinates work. It is never the production persistence mechanism,
// and detach/new controllers must not reset an actor's locks or hydration.
const actors = new Map<string, Actor>();
const listeners = new Map<string, Set<() => void>>();
const actorKey = (session: JobSyncNativeSession) => `${session.company!.id}:${session.user.id}`;
const savedMessage = "Job saved — calendar refresh failed.";
const uncertainMessage = "Creation status is unknown. This request may have created a Job. Check its creation status before creating another. Do not resend this request.";
const conflictMessage = "This creation key has a payload conflict. The original request is locked; do not resend it or create a replacement.";
const persistenceMessage = "The Job creation record could not be secured. Saving is locked; restore the request before continuing.";
function notify(key: string) { listeners.get(key)?.forEach((listener) => listener()); }
function instantEqual(a: string | null | undefined, b: string | null | undefined) {
  return Boolean(a && b && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b));
}
function immutable(record: CompanyCreationRecord): CompanyCreationRecord {
  const payload: JobSyncCompanyJobCreateInput = record.payload.newCustomer
    ? { ...record.payload, newCustomer: Object.freeze({ ...record.payload.newCustomer }) }
    : { ...record.payload };
  return Object.freeze({ ...record, payload: Object.freeze(payload) });
}
function recordState(record: CompanyCreationRecord): CompanyCreateJobState {
  if (record.jobId) return { phase: "saved", jobId: record.jobId, message: savedMessage };
  if (record.phase === "rejected") return { phase: "rejected", jobId: null, message: record.rejectionMessage || "The original Job request was rejected. Correct it and deliberately save a new request." };
  if (record.phase === "conflict") return { phase: "conflict", jobId: null, message: conflictMessage };
  return { phase: "uncertain", jobId: null, message: uncertainMessage };
}

export function createCompanyJobController(input: {
  session: JobSyncNativeSession;
  isCurrent: () => boolean;
  verifyAssignment: (employeeId: string) => Promise<boolean>;
  onState: (state: CompanyCreateJobState) => void;
  onCreated: (detail: JobSyncCompanyJobDetail, timezone: string) => boolean | void | Promise<boolean | void>;
  transport?: CompanyCreateJobTransport;
  store?: CompanyCreationStore;
  newOperationKey?: () => string;
}) {
  const api = input.transport ?? transport;
  // Even injected transports use secure production storage unless explicitly replaced.
  const store = input.store ?? companyCreationStore;
  const newKey = input.newOperationKey ?? newCompanyCreationOperationKey;
  const origin = structuredSession(input.session);
  const scope = companyCreateJobScope(origin);
  const key = companyCreateJobAllowed(origin) ? actorKey(origin) : "denied";
  let actor = actors.get(key);
  if (!actor) { actor = { hydrated: false, busy: false }; actors.set(key, actor); }
  const runtime = actor;
  let detached = false;
  let authenticated = false;
  let localState = scope ? restoring() : ready();
  let restorePromise: Promise<boolean> | undefined;
  const current = () => !detached && Boolean(scope) && input.isCurrent() && companyCreateJobScope(input.session) === scope;
  const getState = () => authenticated && runtime.hydrated ? runtime.attempt?.state ?? localState : localState;
  const publish = () => { if (current()) input.onState(getState()); };
  let set = listeners.get(key);
  if (!set) listeners.set(key, set = new Set());
  set.add(publish);
  const patch = (attempt: Attempt, state: CompanyCreateJobState) => { attempt.state = state; notify(key); };
  const diagnostic = (attempt: Attempt, error: unknown) => {
    const state = attempt.state;
    patch(attempt, { ...state, phase: attempt.record?.jobId ? "saved" : state.phase === "rejected" && attempt.dirty ? "uncertain" : state.phase,
      jobId: attempt.record?.jobId ?? state.jobId, message: attempt.record?.jobId ? savedMessage : state.message,
      detailError: error instanceof Error ? error.message : persistenceMessage });
  };
  const fresh = async () => {
    authenticated = false;
    if (!current()) return false;
    const signed = await api.session(origin.token);
    if (!current()) return false;
    if (!companyCreateJobAllowed(signed) || companyCreateJobScope(signed) !== scope) throw new Error("Your Company sign-in changed. Reopen Add Job before saving.");
    authenticated = true;
    return true;
  };
  const checkRecord = (record: CompanyCreationRecord) => {
    if (record.companyId !== origin.company!.id || record.userId !== origin.user.id
      || (record.payload.operationKey !== undefined && record.payload.operationKey !== record.operationKey)) throw new Error("The stored Job request does not match this Company account. Saving remains locked.");
    if (Object.hasOwn(record.payload, "customerId") === Object.hasOwn(record.payload, "newCustomer")
      || (Object.hasOwn(record.payload, "customerId") && !positive(record.payload.customerId))
      || (record.resolvedCustomerId !== undefined && (!positive(record.resolvedCustomerId) || !positive(record.jobId)
        || (record.payload.customerId !== undefined && record.resolvedCustomerId !== record.payload.customerId)))) throw new Error(persistenceMessage);
    if (Object.hasOwn(record.payload, "newCustomer")) {
      const normalized = normalizeCompanyJobNewCustomer(record.payload.newCustomer);
      if (Object.keys(normalized).length !== Object.keys(record.payload.newCustomer!).length
        || Object.keys(normalized).some((field) => normalized[field as keyof typeof normalized] !== record.payload.newCustomer![field as keyof typeof normalized])) throw new Error(persistenceMessage);
    }
    return immutable(record);
  };
  const hydrate = async () => {
    try {
      // Every controller authenticates independently, including when another
      // token/controller has already hydrated the same Company/user actor.
      if (!await fresh()) return false;
      if (!runtime.hydrated) {
        if (!runtime.hydration) {
          runtime.hydration = (async () => {
            const record = await store.read(origin.company!.id, origin.user.id);
            if (record && !runtime.attempt) {
              const checked = checkRecord(record);
              runtime.attempt = { record: checked, state: recordState(checked), reserved: true, dirty: false };
            }
            runtime.hydrated = true;
            return true;
          })().finally(() => { runtime.hydration = undefined; });
        }
        await runtime.hydration;
      }
      if (!await fresh() || !current()) return false;
      if (localState.phase === "restoring" || localState.phase === "uncertain" || localState.phase === "error") localState = ready();
      publish();
      return true;
    } catch (error) {
      // No stored metadata is exposed under a revoked/mismatched signed session.
      localState = { phase: "uncertain", jobId: null, message: persistenceMessage,
        detailError: error instanceof Error ? error.message : persistenceMessage };
      publish();
      return false;
    }
  };
  const update = async (attempt: Attempt, next: CompanyCreationRecord) => {
    attempt.record = immutable(next);
    attempt.dirty = true;
    if (!await store.update(attempt.record)) throw new Error(persistenceMessage);
    attempt.dirty = false;
  };
  const settleRecord = async (attempt: Attempt, changes: Partial<CompanyCreationRecord>) => {
    if (!attempt.record) throw new Error(persistenceMessage);
    await update(attempt, { ...attempt.record, ...changes, updatedAt: new Date().toISOString() });
  };
  const ensureRecorded = async (attempt: Attempt) => {
    if (!attempt.record) throw new Error(persistenceMessage);
    if (!attempt.reserved) {
      const stored = await store.read(origin.company!.id, origin.user.id);
      if (stored) {
        const checked = checkRecord(stored);
        if (checked.operationKey !== attempt.record.operationKey) {
          // A failed reservation must adopt the already durable intent, never POST.
          attempt.ack = undefined;
        }
        attempt.record = checked; attempt.dirty = false;
        patch(attempt, recordState(checked));
      } else if (!await store.reserve(attempt.record)) throw new Error(persistenceMessage);
      attempt.reserved = true;
    }
    if (attempt.dirty) await update(attempt, attempt.record);
  };
  const recoverDetail = async (attempt: Attempt) => {
    const record = attempt.record;
    if (!record?.jobId || !await fresh() || !current()) return false;
    const detail = await api.detail(origin.token, record.jobId, origin.company!.id);
    if (!current()) return false;
    const payload = record.payload;
    // Operation status returns only an ID. Never invent a create acknowledgment
    // (in particular a missing priceBookServiceId) from that ID or from detail.
    if (detail.id !== record.jobId || detail.companyId !== origin.company!.id || !positive(detail.customerId)
      || (payload.customerId !== undefined && detail.customerId !== payload.customerId)
      || (record.resolvedCustomerId !== undefined && detail.customerId !== record.resolvedCustomerId)
      || detail.assignedUserId !== (payload.assignedUserId ?? null) || !instantEqual(detail.scheduledStartAt, payload.scheduledStartAt)
      || (payload.scheduledEndAt && !instantEqual(detail.scheduledEndAt, payload.scheduledEndAt))
      || (!payload.scheduledEndAt && attempt.ack?.scheduledEndAt && !instantEqual(detail.scheduledEndAt, attempt.ack.scheduledEndAt))
      || !Number.isFinite(detail.amount) || detail.amount < 0) throw new Error("Saved Job detail did not match its Company acknowledgment or original request.");
    if (payload.newCustomer) {
      if (!await fresh() || !current()) return false;
      // The same-Company canonical Job has authoritatively resolved this ID.
      // Keep it even if profile verification fails; a later read cannot swap it.
      if (record.resolvedCustomerId === undefined) await settleRecord(attempt, { resolvedCustomerId: detail.customerId });
      if (!current()) return false;
      const customer = await api.customer(origin.token, detail.customerId, origin.company!.id);
      if (!current()) return false;
      if (customer.id !== detail.customerId || (customer.companyId !== undefined && customer.companyId !== origin.company!.id)) throw new Error("Saved customer profile did not match this Company's canonical Job.");
      const profile = normalizeCompanyJobNewCustomer({ firstName: customer.firstName, lastName: customer.lastName,
        ...Object.fromEntries((["email", "phone", "addressLine1", "city", "region", "postalCode"] as const)
          .filter((field) => customer[field] !== null && customer[field] !== undefined).map((field) => [field, customer[field]])) });
      const fields = ["firstName", "lastName", "email", "phone", "addressLine1", "city", "region", "postalCode"] as const;
      if (fields.some((field) => profile[field] !== payload.newCustomer![field])) throw new Error("Saved customer profile did not match the original new customer request.");
      if (!await fresh() || !current()) return false;
    }
    const settings = await api.settings(origin.token);
    if (!current()) return false;
    if (settings.id !== origin.company!.id || !settings.timezone?.trim()) throw new Error("The current Company schedule settings could not be verified.");
    try { new Intl.DateTimeFormat("en-US", { timeZone: settings.timezone }).format(new Date()); }
    catch { throw new Error("The current Company timezone could not be verified."); }
    // Re-authenticate after the reads and before invoking the real calendar loader.
    if (!await fresh() || !current()) return false;
    await ensureRecorded(attempt);
    if (!current()) return false;
    patch(attempt, { phase: "saved", jobId: record.jobId, message: "Job saved. Refreshing the Company calendar…", reconciling: true });
    if (!current()) return false;
    const refreshed = await input.onCreated(detail, settings.timezone);
    if (!current() || refreshed === false) {
      patch(attempt, { phase: "saved", jobId: record.jobId, message: savedMessage });
      return false;
    }
    // Only a real awaited calendar callback success authorizes removal. A
    // bootstrap callback returning false cannot erase a known saved operation.
    if (!await store.remove(origin.company!.id, origin.user.id, record.operationKey)) throw new Error(persistenceMessage);
    if (runtime.attempt === attempt) runtime.attempt = undefined;
    const succeeded = current();
    if (succeeded) localState = { phase: "succeeded", jobId: record.jobId, message: "Job saved. Company calendar refreshed." };
    notify(key);
    // A synchronous close from the confirmed-success onState notification must
    // not retroactively turn that completed calendar/removal into a failure.
    return succeeded;
  };
  const lookup = async (attempt: Attempt) => {
    if (!await fresh() || !current()) return false;
    await ensureRecorded(attempt);
    const record = attempt.record!;
    if (!current()) return false;
    if (!api.operation) {
      if (record.jobId) return recoverDetail(attempt);
      // Backward injected transport is GET-only as well; empty lists are never
      // negative proof. Production always has the operation endpoint.
      await api.jobs(origin.token);
      patch(attempt, { ...attempt.state, message: `${uncertainMessage} Calendar records refreshed; absence from this list is not proof that the Job was not saved.` });
      return false;
    }
    const operation = await api.operation(origin.token, origin.company!.id, record.operationKey);
    if (operation.key !== record.operationKey || !["unknown", "pending", "saved", "rejected"].includes(operation.state)
      || (Object.hasOwn(operation, "customerId") && (operation.state !== "saved" || !positive(operation.customerId)))
      || (operation.state === "saved" ? !positive(operation.jobId) : operation.jobId !== null)) throw new Error("The Company creation status could not be verified. The original request remains locked.");
    // A delayed status GET may outlive bearer revocation. Keep settlement to the
    // origin mandatory, but suppress metadata publication until a new signed
    // check below; callbacks always perform their own fresh authentication.
    authenticated = false;
    // Settlement is durable to the origin even if this GET's view detached.
    if (operation.state === "saved") {
      if (record.jobId && record.jobId !== operation.jobId) throw new Error("Saved operation returned a different Job ID. The original request remains locked.");
      if (operation.customerId !== undefined && ((record.resolvedCustomerId !== undefined && record.resolvedCustomerId !== operation.customerId)
        || (record.payload.customerId !== undefined && record.payload.customerId !== operation.customerId))) throw new Error("Saved operation returned a different customer ID. The original request remains locked.");
      patch(attempt, { phase: "saved", jobId: operation.jobId, message: savedMessage, reconciling: true });
      await settleRecord(attempt, { phase: "saved", jobId: operation.jobId,
        ...(operation.customerId !== undefined ? { resolvedCustomerId: operation.customerId } : {}) });
      if (!current()) return false;
      return recoverDetail(attempt);
    }
    // A known saved result and a conflict must never be downgraded/unlocked by
    // later missing/pending/rejected status (or by a mismatched detail/calendar).
    if (record.jobId) return current() ? recoverDetail(attempt) : false;
    if (record.phase === "conflict") {
      if (await fresh()) publish();
      return false;
    }
    if (operation.state === "rejected") {
      if (!["BAD_REQUEST", "NOT_FOUND", "CONFLICT", "PRECONDITION_FAILED"].includes(operation.rejectionCode ?? "")
        || !operation.rejectionMessage?.trim()) throw new Error("The rejected creation status could not be verified.");
      await settleRecord(attempt, { phase: "rejected", jobId: null, rejectionCode: operation.rejectionCode, rejectionMessage: operation.rejectionMessage });
      patch(attempt, recordState(attempt.record!));
      if (await fresh()) publish();
      return false;
    }
    await settleRecord(attempt, { phase: "uncertain", jobId: null });
    patch(attempt, { phase: operation.state === "pending" ? "pending" : "uncertain", jobId: null,
      message: operation.state === "pending" ? "The original Job request is still pending. Do not resend it or use a new key." : uncertainMessage });
    if (await fresh()) publish();
    return false;
  };
  const restore = () => {
    if (restorePromise) return restorePromise;
    restorePromise = (async () => {
      if (!await hydrate() || !current()) return false;
      const attempt = runtime.attempt;
      if (!attempt) return true;
      if (runtime.busy) return false;
      runtime.busy = true;
      patch(attempt, { ...attempt.state, reconciling: true });
      try { return await lookup(attempt); }
      catch (error) { diagnostic(attempt, error); return false; }
      finally {
        runtime.busy = false;
        if (runtime.attempt === attempt) attempt.state = { ...attempt.state, reconciling: false };
        notify(key);
      }
    })().finally(() => { restorePromise = undefined; });
    return restorePromise;
  };
  const submit = async (draft: CompanyCreateJobDraft) => {
    if (!current() || runtime.busy || localState.phase === "succeeded") return false;
    // Capture the entire intent before hydration's FIRST await, including nested
    // customer fields. Neither caller mutation nor delayed auth can change it.
    let captured: CompanyCreateJobDraft;
    try {
      if (!draft || typeof draft !== "object" || Object.hasOwn(draft, "customerId") === Object.hasOwn(draft, "newCustomer")) throw new Error("Choose exactly one existing or new Company customer.");
      if (Object.hasOwn(draft, "customerId") && !positive(draft.customerId)) throw new Error("Choose an existing Company customer.");
      if (Object.hasOwn(draft, "newCustomer") && Reflect.ownKeys(draft).some((field) => typeof field !== "string"
        || !["newCustomer", "serviceId", "assignedEmployeeId", "vehiclePriceKey", "date", "startHour", "endHour", "addressLine1", "city", "region", "postalCode", "serviceNotes", "privateNotes"].includes(field))) throw new Error("New customer Job fields could not be verified.");
      captured = Object.hasOwn(draft, "newCustomer")
        ? Object.freeze({ ...draft, newCustomer: normalizeCompanyJobNewCustomer(draft.newCustomer) }) as CompanyCreateJobDraft
        : Object.freeze({ ...draft });
    } catch (error) {
      if (!runtime.attempt) { localState = { phase: "error", jobId: null, message: error instanceof Error ? error.message : "New customer fields could not be verified." }; publish(); }
      return false;
    }
    if (!await hydrate() || !current() || runtime.busy) return false;
    const previous = runtime.attempt;
    if (previous && (previous.record?.phase !== "rejected" || previous.dirty || !previous.reserved || previous.state.phase !== "rejected")) return false;
    runtime.busy = true;
    // A rejected intent remains durable during validation, so preflight errors
    // cannot discard the rejection or the user's original immutable request.
    const attempt: Attempt = { state: { phase: "validating", jobId: null, message: "Verifying Company customer, service and schedule…" }, reserved: false, dirty: false };
    if (!previous) runtime.attempt = attempt;
    else patch(previous, { ...previous.state, reconciling: true });
    notify(key);
    let reservationStarted = false;
    try {
      if ((captured.customerId !== undefined && !positive(captured.customerId)) || !/^\d+$/.test(captured.serviceId) || !positive(Number(captured.serviceId))) throw new Error("Choose a Company customer and active Price Book service.");
      if (!await fresh() || !current()) return false;
      const services = await api.priceBook(origin.token);
      if (!current()) return false;
      const service = services.find((candidate) => candidate.serviceId === captured.serviceId);
      if (!service) throw new Error("This service is no longer in the active Company Price Book. Refresh and select again.");
      if (captured.customerId !== undefined) {
        const customer = await api.customer(origin.token, captured.customerId, origin.company!.id);
        if (!current()) return false;
        if (customer.id !== captured.customerId || (customer.companyId !== undefined && customer.companyId !== origin.company!.id)) throw new Error("The selected Company customer could not be verified. Select again.");
      }
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
        const verified = await input.verifyAssignment(captured.assignedEmployeeId);
        if (!current()) return false;
        if (!verified) throw new Error("This member is not a currently verified assignment candidate. Refresh and select again.");
        assignedUserId = Number(captured.assignedEmployeeId.slice(8));
      }
      const selector: JobSyncCompanyJobCustomerSelector = captured.newCustomer ? { newCustomer: captured.newCustomer } : { customerId: captured.customerId! };
      const payload: JobSyncCompanyJobCreateInput = { ...selector, priceBookServiceId: Number(captured.serviceId), scheduledStartAt };
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
      const operationKey = newKey();
      if (typeof operationKey !== "string" || operationKey !== operationKey.trim() || operationKey.length < 8 || operationKey.length > 128 || /[\u0000-\u001f\u007f]/.test(operationKey)
        || operationKey === previous?.record?.operationKey) throw new Error("A new secure Job creation key could not be generated. Saving is locked.");
      // Secure storage keeps the opaque key alongside the exact allowlisted
      // request fields. Reconstruct only that one key, without renormalization.
      const now = new Date().toISOString();
      attempt.record = immutable({ version: 1, companyId: origin.company!.id, userId: origin.user.id, operationKey,
        payload, timezone: settings.timezone, phase: "prepared", jobId: null, createdAt: now, updatedAt: now });
      if (previous) {
        previous.dirty = true;
        if (!await store.remove(origin.company!.id, origin.user.id, previous.record!.operationKey)) throw new Error(persistenceMessage);
        previous.dirty = false;
        runtime.attempt = attempt;
      }
      reservationStarted = true;
      // Fail closed on a failed/ambiguous reservation. It may already have written.
      if (!await store.reserve(attempt.record)) throw new Error(persistenceMessage);
      attempt.reserved = true;
      patch(attempt, { phase: "submitting", message: "Saving Job… Do not submit again.", jobId: null });
      if (!current()) {
        patch(attempt, { phase: "uncertain", message: uncertainMessage, jobId: null });
        return false;
      }
      // Fresh authentication after the durable write closes the delayed-storage
      // window. Once dispatch begins, origin settlement is independent of current().
      if (!await fresh() || !current()) {
        patch(attempt, { phase: "uncertain", message: uncertainMessage, jobId: null });
        return false;
      }
      const request = Object.freeze({ ...attempt.record.payload, operationKey: attempt.record.operationKey });
      const ack = await api.create(origin.token, origin.company!.id, request);
      if (!positive(ack.id) || ack.companyId !== origin.company!.id || !positive(ack.customerId)
        || (payload.customerId !== undefined && ack.customerId !== payload.customerId)
        || (ack.priceBookServiceId !== payload.priceBookServiceId && !(ack.priceBookServiceId === null && ack.operation?.replayed === true))
        || ack.assignedUserId !== (payload.assignedUserId ?? null) || !instantEqual(ack.scheduledStartAt, payload.scheduledStartAt)
        || (payload.scheduledEndAt && !instantEqual(ack.scheduledEndAt, payload.scheduledEndAt))
        || !Number.isFinite(ack.amount) || ack.amount < 0
        || (payload.newCustomer && (!ack.operation || typeof ack.operation.replayed !== "boolean"))
        || (ack.operation && (ack.operation.key !== operationKey || ack.operation.state !== "saved"))) throw new Error("The save response could not be verified. The original request remains locked.");
      attempt.ack = ack;
      patch(attempt, { phase: "saved", message: savedMessage, jobId: ack.id });
      await settleRecord(attempt, { phase: "saved", jobId: ack.id, ...(payload.newCustomer ? { resolvedCustomerId: ack.customerId } : {}) });
      if (!current()) return false;
      return await recoverDetail(attempt);
    } catch (error) {
      if (!reservationStarted) {
        if (runtime.attempt === attempt) runtime.attempt = undefined;
        localState = { phase: "error", jobId: null, message: error instanceof Error ? error.message : "Could not verify this Company Job." };
        if (previous) diagnostic(previous, error);
        else notify(key);
      } else {
        // Neither auth status nor a familiar validation error proves rollback.
        // Only subsequent authoritative GET rejected + durable update can unlock.
        if (!attempt.record?.jobId) {
          const conflict = Boolean(error && typeof error === "object"
            && ((error as { status?: unknown }).status === 409 || (error as { code?: unknown }).code === "CONFLICT")
            && error instanceof Error && error.message === "This Job creation operation key was already used with a different payload.");
          patch(attempt, { phase: conflict ? "conflict" : "uncertain", jobId: null, message: conflict ? conflictMessage : uncertainMessage,
            detailError: error instanceof Error ? error.message : null });
          if (attempt.reserved) {
            try { await settleRecord(attempt, { phase: conflict ? "conflict" : "uncertain" }); }
            catch (storageError) { diagnostic(attempt, storageError); }
          }
        } else diagnostic(attempt, error);
      }
      return false;
    } finally {
      runtime.busy = false;
      if (!reservationStarted && runtime.attempt === attempt) runtime.attempt = undefined;
      if (runtime.attempt) runtime.attempt.state = { ...runtime.attempt.state, reconciling: false };
      notify(key);
    }
  };
  return {
    submit, restore, reconcile: () => runtime.busy || restorePromise ? Promise.resolve(false) : restore(), getState,
    isBusy: () => !runtime.hydrated || Boolean(runtime.hydration) || runtime.busy,
    detach: () => { detached = true; set?.delete(publish); if (!set?.size) listeners.delete(key); },
  };
}
function structuredSession(session: JobSyncNativeSession): JobSyncNativeSession {
  return { ...session, user: { ...session.user }, ...(session.company ? { company: { ...session.company } } : {}) };
}
