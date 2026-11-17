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
export const companyJobRecurrenceUnavailableMessage = "Recurring saving is unavailable: Company timezone and full server-duration availability now pass the isolated 0fbd gate, but canonical saved-series GET does not expose the persisted creation timezone, rule-to-first-Job anchor, or original start-date/term and operation-payload binding. Separate GETs have no shared snapshot/version, so completeness and concurrent edits cannot be safely verified. Nothing will be submitted. Choose One appointment only if you intend to save a single Job.";
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
