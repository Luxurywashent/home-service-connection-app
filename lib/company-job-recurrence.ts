/** Exact mobile recurrence wire intent. No client occurrence creation or pricing. */
export const companyJobRecurrenceTypes = ["weekly", "biweekly", "monthly_date", "monthly_ordinal"] as const;
export const companyJobRecurrenceTerms = ["1_month", "3_months", "6_months", "1_year", "never_ends"] as const;
export type CompanyJobRecurrenceInput = {
  type: typeof companyJobRecurrenceTypes[number];
  term: typeof companyJobRecurrenceTerms[number];
  dayOfWeek?: number;
  ordinal?: 1 | 2 | 3 | 4 | -1;
  startDate: string;
};
export const companyJobRecurrenceUnavailableMessage = "Recurring saving is unavailable: the backend is not deployed and the recurrence migration is not verified. The fc3 source persists original start-date provenance, but canonical GET has a subtotal mismatch and does not expose operation payload binding or snapshot-bound sibling pricing. Nothing will be submitted. Choose One appointment only if you intend to save a single Job.";
const invalid = () => new Error("Choose a valid recurrence, term, Company start date, weekday and monthly occurrence.");
function plain(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
}
function ownData(row: Record<string, unknown>, fields: readonly string[]) {
  return Reflect.ownKeys(row).every(field => typeof field === "string" && fields.includes(field)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(row, field)!, "value"));
}
function dateOnly(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2000 || date.toISOString().slice(0, 10) !== value) throw invalid();
  return date;
}
/** Copies before the first await. Omitted optional fields remain omitted. */
export function normalizeCompanyJobRecurrence(value: unknown): CompanyJobRecurrenceInput {
  if (!plain(value) || !ownData(value, ["type", "term", "dayOfWeek", "ordinal", "startDate"])
    || !companyJobRecurrenceTypes.includes(value.type as CompanyJobRecurrenceInput["type"])
    || !companyJobRecurrenceTerms.includes(value.term as CompanyJobRecurrenceInput["term"])) throw invalid();
  dateOnly(value.startDate);
  const needsWeekday = value.type !== "monthly_date";
  if ((needsWeekday && value.dayOfWeek === undefined)
    || (Object.hasOwn(value, "dayOfWeek") && (typeof value.dayOfWeek !== "number" || !Number.isInteger(value.dayOfWeek) || value.dayOfWeek < 0 || value.dayOfWeek > 6))
    || (value.type === "monthly_ordinal" && ![1, 2, 3, 4, -1].includes(value.ordinal as number))
    || (value.type !== "monthly_ordinal" && Object.hasOwn(value, "ordinal"))
    || (value.type === "monthly_date" && Object.hasOwn(value, "dayOfWeek"))) throw invalid();
  return Object.freeze({ type: value.type as CompanyJobRecurrenceInput["type"], term: value.term as CompanyJobRecurrenceInput["term"],
    startDate: value.startDate as string, ...(needsWeekday ? { dayOfWeek: value.dayOfWeek as number } : {}),
    ...(value.type === "monthly_ordinal" ? { ordinal: value.ordinal as CompanyJobRecurrenceInput["ordinal"] } : {}) });
}
export function companyJobRecurrenceWeekday(date: string) { return dateOnly(date).getUTCDay(); }
/** Same first-date semantics as backend buildStoredRecurrenceRule; never materializes a series. */
export function companyJobRecurrenceFirstDate(input: CompanyJobRecurrenceInput): string {
  const rule = normalizeCompanyJobRecurrence(input), start = dateOnly(rule.startDate);
  if (rule.type === "monthly_date") return rule.startDate;
  if (rule.type !== "monthly_ordinal") {
    start.setUTCDate(start.getUTCDate() + (rule.dayOfWeek! - start.getUTCDay() + 7) % 7);
    return start.toISOString().slice(0, 10);
  }
  const candidate = (month: number) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), month, rule.ordinal === -1 ? 0 : 1));
    if (rule.ordinal === -1) date.setUTCDate(date.getUTCDate() - (date.getUTCDay() - rule.dayOfWeek! + 7) % 7);
    else date.setUTCDate(1 + (rule.dayOfWeek! - date.getUTCDay() + 7) % 7 + (rule.ordinal! - 1) * 7);
    return date.toISOString().slice(0, 10);
  };
  const month = start.getUTCMonth() + (rule.ordinal === -1 ? 1 : 0);
  const first = candidate(month);
  return first >= rule.startDate ? first : candidate(month + 1);
}
export type CompanyJobRecurrenceOccurrence = { id: number; occurrenceNumber: number; scheduledStartAt: string; scheduledEndAt: string };
/** Shape emitted by mobile CREATE when a series actually exists. Not durable GET evidence. */
export type CompanyJobRecurrenceReceipt = {
  ruleId: number; occurrenceJobIds: number[]; occurrences: CompanyJobRecurrenceOccurrence[];
  timezone: string; count: number; neverEnds: boolean; term: CompanyJobRecurrenceInput["term"];
};
/** Historical/future semantic projection, NOT the raw 0fbd GET DTO or persistence proof.
 * The 0fbd controller never accepts this projection as permission to write/unlock. */
export type CompanyJobSavedSeries = CompanyJobRecurrenceReceipt & {
  companyId: number; customerId: number; jobId: number; operationKey: string;
  recurrence: CompanyJobRecurrenceInput;
};
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const instant = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
function dense(value: unknown): value is unknown[] {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype
    && Reflect.ownKeys(value).length === value.length + 1
    && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(index))!, "value")).every(Boolean);
}
/** Exact server/jobService.ts getJobRecurrenceSeries DTO at 0fbd3b67.
 * A current materialized-row read, not an original-intent/complete-series certificate.
 * Nulls, gaps, cancellations and edited appointment times stay visible; no dates,
 * term, timezone, pricing, customer or operation identity are synthesized. */
export type CompanyJobRecurrenceReadback = {
  readonly jobId: number;
  readonly recurrence: null | {
    readonly ruleId: number;
    readonly cadence: "weekly" | "biweekly" | "monthly_day" | "monthly_weekday";
    readonly weekday: number | null;
    readonly ordinalWeek: number | null;
    readonly dayOfMonth: number | null;
    readonly startsOn: string;
    readonly endsOn: string | null;
    readonly startTime: string;
    readonly durationMinutes: number;
    readonly isActive: boolean;
    readonly cancelledFromOccurrenceNumber: number | null;
  };
  readonly occurrences: readonly {
    readonly jobId: number;
    readonly occurrenceNumber: number | null;
    readonly occurrenceKey: string | null;
    readonly status: string;
    readonly scheduledStartAt: string | null;
    readonly scheduledEndAt: string | null;
    readonly updatedAt: string | null;
  }[];
};
function exactReadbackFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return plain(value) && fields.every(field => Object.hasOwn(value, field)) && ownData(value, fields);
}
const nullableInteger = (value: unknown, min: number, max: number): value is number | null => value === null
  || (typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max);
/** Normalize only the actual canonical GET JSON, never a CREATE echo or an adapter
 * populated from the request. Even valid output must NOT enable recurring Save. */
export function normalizeCompanyJobRecurrenceReadback(value: unknown, requestedJobId: number): CompanyJobRecurrenceReadback {
  const failure = () => new Error("Canonical recurrence readback could not be verified. The original request remains locked; do not resend.");
  if (!positive(requestedJobId) || !exactReadbackFields(value, ["jobId", "recurrence", "occurrences"])
    || value.jobId !== requestedJobId || !dense(value.occurrences) || !value.occurrences.length) throw failure();
  let recurrence: CompanyJobRecurrenceReadback["recurrence"] = null;
  if (value.recurrence !== null) {
    const rule = value.recurrence;
    if (!exactReadbackFields(rule, ["ruleId", "cadence", "weekday", "ordinalWeek", "dayOfMonth", "startsOn", "endsOn", "startTime", "durationMinutes", "isActive", "cancelledFromOccurrenceNumber"])
      || !positive(rule.ruleId) || !["weekly", "biweekly", "monthly_day", "monthly_weekday"].includes(rule.cadence as string)
      || !nullableInteger(rule.weekday, 0, 6) || !nullableInteger(rule.ordinalWeek, 1, 5) || !nullableInteger(rule.dayOfMonth, 1, 31)
      || (rule.cadence === "monthly_day" ? rule.dayOfMonth === null || rule.weekday !== null || rule.ordinalWeek !== null
        : rule.weekday === null || rule.dayOfMonth !== null || (rule.cadence === "monthly_weekday" ? rule.ordinalWeek === null : rule.ordinalWeek !== null))
      || typeof rule.startTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rule.startTime)
      || rule.durationMinutes === null || !nullableInteger(rule.durationMinutes, 15, 1440) || typeof rule.isActive !== "boolean"
      || !nullableInteger(rule.cancelledFromOccurrenceNumber, 0, Number.MAX_SAFE_INTEGER)) throw failure();
    try { dateOnly(rule.startsOn); if (rule.endsOn !== null) dateOnly(rule.endsOn); } catch { throw failure(); }
    recurrence = Object.freeze({ ...rule }) as CompanyJobRecurrenceReadback["recurrence"];
  }
  const seen = new Set<number>();
  let previousNumber = -1;
  const rows = value.occurrences;
  const occurrences = rows.map(raw => {
    if (!exactReadbackFields(raw, ["jobId", "occurrenceNumber", "occurrenceKey", "status", "scheduledStartAt", "scheduledEndAt", "updatedAt"])
      || !positive(raw.jobId) || seen.has(raw.jobId) || typeof raw.status !== "string" || !raw.status.trim()
      || ![raw.scheduledStartAt, raw.scheduledEndAt, raw.updatedAt].every(item => item === null || instant(item))) throw failure();
    if (recurrence) {
      if (raw.occurrenceNumber === null || !nullableInteger(raw.occurrenceNumber, 0, Number.MAX_SAFE_INTEGER)
        || raw.occurrenceNumber <= previousNumber || raw.occurrenceKey !== `${recurrence.ruleId}:${raw.occurrenceNumber}`) throw failure();
      previousNumber = raw.occurrenceNumber;
    } else if (raw.occurrenceNumber !== null || raw.occurrenceKey !== null || raw.jobId !== requestedJobId || rows.length !== 1) throw failure();
    seen.add(raw.jobId);
    return Object.freeze({ ...raw }) as CompanyJobRecurrenceReadback["occurrences"][number];
  });
  if (!seen.has(requestedJobId)) throw failure();
  return Object.freeze({ jobId: requestedJobId, recurrence, occurrences: Object.freeze(occurrences) });
}
export function normalizeCompanyJobRecurrenceReceipt(value: unknown, intent: CompanyJobRecurrenceInput, jobId: number): CompanyJobRecurrenceReceipt {
  const request = normalizeCompanyJobRecurrence(intent);
  const failure = () => new Error("The saved recurring series could not be verified. The original request remains locked; do not resend.");
  if (!plain(value) || !positive(jobId) || !positive(value.ruleId) || !positive(value.count)
    || !dense(value.occurrenceJobIds) || !dense(value.occurrences) || value.count !== value.occurrences.length
    || value.count !== value.occurrenceJobIds.length || value.occurrenceJobIds[0] !== jobId
    || new Set(value.occurrenceJobIds).size !== value.count || !value.occurrenceJobIds.every(positive)
    || value.term !== request.term || value.neverEnds !== (request.term === "never_ends")
    || typeof value.timezone !== "string" || !value.timezone.trim() || value.timezone !== value.timezone.trim()) throw failure();
  try { new Intl.DateTimeFormat("en-US", { timeZone: value.timezone }); } catch { throw failure(); }
  const occurrences = value.occurrences.map((raw, index) => {
    if (!plain(raw) || !ownData(raw, ["id", "occurrenceNumber", "scheduledStartAt", "scheduledEndAt"])
      || raw.id !== (value.occurrenceJobIds as unknown[])[index] || raw.occurrenceNumber !== index
      || !instant(raw.scheduledStartAt) || !instant(raw.scheduledEndAt)
      || Date.parse(raw.scheduledEndAt) <= Date.parse(raw.scheduledStartAt)
      || (index > 0 && Date.parse(raw.scheduledStartAt) <= Date.parse((value.occurrences as CompanyJobRecurrenceOccurrence[])[index - 1].scheduledStartAt))) throw failure();
    return Object.freeze({ id: raw.id as number, occurrenceNumber: index, scheduledStartAt: raw.scheduledStartAt, scheduledEndAt: raw.scheduledEndAt });
  });
  return Object.freeze({ ruleId: value.ruleId, count: value.count, timezone: value.timezone, term: request.term,
    neverEnds: request.term === "never_ends", occurrenceJobIds: Object.freeze([...value.occurrenceJobIds]) as number[],
    occurrences: Object.freeze(occurrences) as CompanyJobRecurrenceOccurrence[] });
}
/** Legacy semantic shape/binding validator, retained for compatibility only.
 * It cannot establish where fields came from. The actual 0fbd raw GET omits
 * required proof; never populate this shape from request/CREATE/settings or use
 * its success to authorize a write, calendar close or recovery removal. */
export function verifyCompanyJobSavedSeries(value: unknown, expected: {
  companyId: number; customerId: number; jobId: number; operationKey: string; recurrence: CompanyJobRecurrenceInput;
  scheduledStartAt: string; scheduledEndAt?: string; ruleId?: number;
}): CompanyJobSavedSeries {
  if (!plain(value) || value.companyId !== expected.companyId || value.customerId !== expected.customerId
    || value.jobId !== expected.jobId || value.operationKey !== expected.operationKey
    || !positive(value.companyId) || !positive(value.customerId)) throw new Error("Saved series identity does not match this Company's original operation.");
  const recurrence = normalizeCompanyJobRecurrence(value.recurrence), request = normalizeCompanyJobRecurrence(expected.recurrence);
  if (Object.keys(recurrence).some(key => recurrence[key as keyof typeof recurrence] !== request[key as keyof typeof request])
    || Object.keys(recurrence).length !== Object.keys(request).length) throw new Error("The saved recurrence does not match the original request.");
  const receipt = normalizeCompanyJobRecurrenceReceipt(value, request, expected.jobId);
  if ((expected.ruleId !== undefined && receipt.ruleId !== expected.ruleId)
    || Date.parse(receipt.occurrences[0].scheduledStartAt) !== Date.parse(expected.scheduledStartAt)
    || (expected.scheduledEndAt !== undefined && Date.parse(receipt.occurrences[0].scheduledEndAt) !== Date.parse(expected.scheduledEndAt))) throw new Error("Saved series schedule or rule identity changed. Recovery remains locked.");
  return Object.freeze({ ...receipt, companyId: expected.companyId, customerId: expected.customerId,
    jobId: expected.jobId, operationKey: expected.operationKey, recurrence });
}

/** Exact unwrapped getJobRecurrenceSeries DTO in fc3bcaa7. Historical b8/final
 * DTOs omit requestedStartDate; absence stays absent and cannot prove fc3 intent.
 * Nullable provenance stays null. Never substitute CREATE/request/settings data. */
export type CompanyJobDurableRecurrenceReadback = {
  readonly companyId: number;
  readonly customerId: number;
  readonly jobId: number;
  readonly recurrence: NonNullable<CompanyJobRecurrenceReadback["recurrence"]> & {
    readonly operationKey: string | null;
    readonly requestedTerm: CompanyJobRecurrenceInput["term"] | null;
    readonly requestedStartDate?: string | null;
    readonly creationTimezone: string | null;
    readonly anchorJobId: number | null;
    readonly updatedAt: string | null;
  };
  readonly pricing: { readonly subtotal: number; readonly discount: number; readonly total: number; readonly durationMinutes: number | null };
  readonly verification: {
    readonly complete: boolean;
    readonly expectedOccurrenceCount: number;
    readonly actualOccurrenceCount: number;
    readonly missingOccurrenceNumbers: readonly number[];
    readonly consistentSnapshot: boolean;
    readonly ruleUpdatedAt: string | null;
    readonly occurrenceUpdatedAt: string | null;
  };
  readonly occurrences: readonly (CompanyJobRecurrenceReadback["occurrences"][number] & { readonly customerId: number | null })[];
};
const durableFailure = () => new Error("The canonical recurring series is incomplete or mismatched. The original request remains locked; do not resend.");
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const timestamp = (value: unknown) => value === null || instant(value);
/** Only exact recurring JSON is accepted. A null recurrence (single Job) cannot
 * become series evidence. The older raw normalizer remains unchanged for callers. */
export function normalizeCompanyJobDurableRecurrenceReadback(value: unknown, requestedJobId: number): CompanyJobDurableRecurrenceReadback {
  if (!exactReadbackFields(value, ["companyId", "customerId", "jobId", "recurrence", "pricing", "verification", "occurrences"])
    || !positive(value.companyId) || !positive(value.customerId) || value.jobId !== requestedJobId || !positive(requestedJobId)
    || !exactReadbackFields(value.recurrence, ["ruleId", "operationKey", "requestedTerm", "creationTimezone", "anchorJobId", "cadence", "weekday", "ordinalWeek", "dayOfMonth", "startsOn", "endsOn", "startTime", "durationMinutes", "isActive", "cancelledFromOccurrenceNumber", "updatedAt",
      ...(plain(value.recurrence) && Object.hasOwn(value.recurrence, "requestedStartDate") ? ["requestedStartDate"] : [])])
    || !dense(value.occurrences) || !value.occurrences.length) throw durableFailure();
  const rule = value.recurrence;
  if (Object.hasOwn(rule, "requestedStartDate") && rule.requestedStartDate !== null) {
    try { dateOnly(rule.requestedStartDate); } catch { throw durableFailure(); }
  }
  if ((rule.operationKey !== null && (typeof rule.operationKey !== "string" || rule.operationKey !== rule.operationKey.trim() || rule.operationKey.length < 8 || rule.operationKey.length > 128 || /[\u0000-\u001f\u007f]/.test(rule.operationKey)))
    || (rule.requestedTerm !== null && !companyJobRecurrenceTerms.includes(rule.requestedTerm as CompanyJobRecurrenceInput["term"]))
    || (rule.anchorJobId !== null && !positive(rule.anchorJobId)) || !timestamp(rule.updatedAt)
    || (rule.creationTimezone !== null && (typeof rule.creationTimezone !== "string" || !rule.creationTimezone.trim() || rule.creationTimezone !== rule.creationTimezone.trim()))) throw durableFailure();
  if (rule.creationTimezone !== null) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: rule.creationTimezone as string }); } catch { throw durableFailure(); }
  }
  const baseRule = Object.fromEntries(["ruleId", "cadence", "weekday", "ordinalWeek", "dayOfMonth", "startsOn", "endsOn", "startTime", "durationMinutes", "isActive", "cancelledFromOccurrenceNumber"].map(field => [field, rule[field]]));
  const baseRows = value.occurrences.map(raw => {
    if (!exactReadbackFields(raw, ["jobId", "customerId", "occurrenceNumber", "occurrenceKey", "status", "scheduledStartAt", "scheduledEndAt", "updatedAt"])
      || (raw.customerId !== null && !positive(raw.customerId))) throw durableFailure();
    return Object.fromEntries(["jobId", "occurrenceNumber", "occurrenceKey", "status", "scheduledStartAt", "scheduledEndAt", "updatedAt"].map(field => [field, raw[field]]));
  });
  // Validate the shared raw rule/occurrence fields without altering their values.
  const base = normalizeCompanyJobRecurrenceReadback({ jobId: requestedJobId, recurrence: baseRule, occurrences: baseRows }, requestedJobId);
  const pricing = value.pricing, verification = value.verification;
  if (!exactReadbackFields(pricing, ["subtotal", "discount", "total", "durationMinutes"])
    || ![pricing.subtotal, pricing.discount, pricing.total].every(nonnegative)
    || (pricing.durationMinutes !== null && !positive(pricing.durationMinutes))
    || !exactReadbackFields(verification, ["complete", "expectedOccurrenceCount", "actualOccurrenceCount", "missingOccurrenceNumbers", "consistentSnapshot", "ruleUpdatedAt", "occurrenceUpdatedAt"])
    || typeof verification.complete !== "boolean" || typeof verification.consistentSnapshot !== "boolean"
    || !nullableInteger(verification.expectedOccurrenceCount, 0, Number.MAX_SAFE_INTEGER) || verification.expectedOccurrenceCount === null
    || verification.actualOccurrenceCount !== value.occurrences.length || !dense(verification.missingOccurrenceNumbers)
    || !verification.missingOccurrenceNumbers.every(item => nullableInteger(item, 0, Number.MAX_SAFE_INTEGER) && item !== null)
    || !timestamp(verification.ruleUpdatedAt) || !timestamp(verification.occurrenceUpdatedAt)) throw durableFailure();
  return Object.freeze({ companyId: value.companyId, customerId: value.customerId, jobId: requestedJobId,
    recurrence: Object.freeze({ ...base.recurrence!, operationKey: rule.operationKey as string | null,
      requestedTerm: rule.requestedTerm as CompanyJobRecurrenceInput["term"] | null, creationTimezone: rule.creationTimezone as string | null,
      ...(Object.hasOwn(rule, "requestedStartDate") ? { requestedStartDate: rule.requestedStartDate as string | null } : {}),
      anchorJobId: rule.anchorJobId as number | null, updatedAt: rule.updatedAt as string | null }),
    pricing: Object.freeze({ ...pricing }) as CompanyJobDurableRecurrenceReadback["pricing"],
    verification: Object.freeze({ ...verification, missingOccurrenceNumbers: Object.freeze([...verification.missingOccurrenceNumbers]) }) as CompanyJobDurableRecurrenceReadback["verification"],
    occurrences: Object.freeze(base.occurrences.map((row, index) => Object.freeze({ ...row,
      customerId: (value.occurrences as Record<string, unknown>[])[index].customerId as number | null }))) });
}
export type CompanyJobDurableRecurrenceExpected = {
  companyId: number; customerId: number; jobId: number; operationKey: string;
  recurrence: CompanyJobRecurrenceInput; timezone: string; scheduledStartAt: string;
  ruleId?: number;
  pricing: { subtotalAmount: number; discountAmount: number; totalAmount: number };
};
/** Verify actual fc3 facts, including the separately persisted requested date.
 * The current DTO still lacks an operation payload fingerprint and financial
 * snapshot binding. Those omissions cannot be filled from request/CREATE.
 * Historical source DTOs remain readable but are never current-source proof. */
export function verifyCompanyJobDurableRecurrenceReadback(value: CompanyJobDurableRecurrenceReadback, expected: CompanyJobDurableRecurrenceExpected): never {
  const request = normalizeCompanyJobRecurrence(expected.recurrence), rule = value.recurrence, proof = value.verification;
  const currentSource = Object.hasOwn(rule, "requestedStartDate");
  if (currentSource && rule.requestedStartDate !== request.startDate) throw new Error("The canonical recurrence requestedStartDate is missing or does not match the immutable original date. The original request remains locked; do not resend.");
  if (currentSource && (value.pricing.subtotal !== expected.pricing.subtotalAmount || value.pricing.discount !== expected.pricing.discountAmount
    || value.pricing.total !== expected.pricing.totalAmount)) throw new Error("The fc3 canonical recurrence financial totals do not match saved Job detail (GET reads camel-case subtotal/discount from getJob's snake-case storage). The original request remains locked; do not resend.");
  const cadence = request.type === "monthly_date" ? "monthly_day" : request.type === "monthly_ordinal" ? "monthly_weekday" : request.type;
  if (value.companyId !== expected.companyId || value.customerId !== expected.customerId || value.jobId !== expected.jobId
    || rule.anchorJobId !== expected.jobId || rule.operationKey !== expected.operationKey || rule.requestedTerm !== request.term
    || rule.creationTimezone !== expected.timezone || (expected.ruleId !== undefined && rule.ruleId !== expected.ruleId)
    || rule.cadence !== cadence || rule.startsOn !== companyJobRecurrenceFirstDate(request)
    || rule.weekday !== (request.dayOfWeek ?? null) || rule.ordinalWeek !== (request.ordinal === -1 ? 5 : request.ordinal ?? null)
    || rule.dayOfMonth !== (request.type === "monthly_date" ? dateOnly(request.startDate).getUTCDate() : null)
    || !rule.isActive || rule.cancelledFromOccurrenceNumber !== null || !proof.complete || !proof.consistentSnapshot
    || !positive(proof.expectedOccurrenceCount) || proof.expectedOccurrenceCount !== proof.actualOccurrenceCount
    || proof.actualOccurrenceCount !== value.occurrences.length || proof.missingOccurrenceNumbers.length
    || rule.updatedAt === null || rule.updatedAt !== proof.ruleUpdatedAt || proof.occurrenceUpdatedAt === null
    || value.pricing.subtotal !== expected.pricing.subtotalAmount || value.pricing.discount !== expected.pricing.discountAmount
    || value.pricing.total !== expected.pricing.totalAmount || value.pricing.durationMinutes !== rule.durationMinutes) throw durableFailure();
  const first = value.occurrences[0];
  if (first.jobId !== expected.jobId || first.scheduledStartAt === null || Date.parse(first.scheduledStartAt) !== Date.parse(expected.scheduledStartAt)
    || (request.term === "never_ends" && (rule.endsOn !== null || proof.expectedOccurrenceCount !== 13))) throw durableFailure();
  if (request.term !== "never_ends") {
    const start = dateOnly(rule.startsOn), months = { "1_month": 1, "3_months": 3, "6_months": 6, "1_year": 12 }[request.term];
    const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months + 1, 0));
    last.setUTCDate(Math.min(start.getUTCDate(), last.getUTCDate()));
    if (rule.endsOn !== last.toISOString().slice(0, 10)) throw durableFailure();
  }
  const wall = new Intl.DateTimeFormat("en-US", { timeZone: expected.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  let latest = "";
  for (let index = 0; index < value.occurrences.length; index++) {
    const row = value.occurrences[index];
    if (row.occurrenceNumber !== index || row.customerId !== expected.customerId || row.status !== "scheduled" || row.updatedAt === null
      || row.scheduledStartAt === null || row.scheduledEndAt === null
      || Date.parse(row.scheduledEndAt) - Date.parse(row.scheduledStartAt) !== rule.durationMinutes * 60_000
      || (index > 0 && Date.parse(row.scheduledStartAt) <= Date.parse(value.occurrences[index - 1].scheduledStartAt!))) throw durableFailure();
    const parts = wall.formatToParts(new Date(row.scheduledStartAt));
    const read = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
    if (`${read("hour")}:${read("minute")}` !== rule.startTime) throw durableFailure();
    latest = row.updatedAt > latest ? row.updatedAt : latest;
  }
  if (latest !== proof.occurrenceUpdatedAt) throw durableFailure();
  if (currentSource) throw new Error("The fc3 canonical GET does not expose the saved operation payload fingerprint or a snapshot binding sibling financials/line items. Persisted requestedStartDate is present but is not full original-operation and pricing proof. The original request remains locked; do not resend.");
  throw new Error("The backend does not persist or expose the original recurrence startDate / operation payload binding, and its snapshot does not bind sibling pricing. The original request remains locked; do not resend.");
}
/** Calendar target dates from canonical occurrence instants, never from the
 * requested date or device timezone. This is NOT a creation-success validator. */
export function companyJobRecurrenceCalendarDates(series: Pick<CompanyJobRecurrenceReceipt, "timezone" | "occurrences">): readonly string[] {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: series.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  if (!dense(series.occurrences) || !series.occurrences.length) throw durableFailure();
  return Object.freeze([...new Set(series.occurrences.map(row => {
    if (!plain(row) || !instant(row.scheduledStartAt)) throw durableFailure();
    const parts = formatter.formatToParts(new Date(row.scheduledStartAt));
    const read = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
    return `${read("year")}-${read("month")}-${read("day")}`;
  }))]);
}
