import type { CompanyJobScheduleMutation, CompanyJobScheduleWriter } from "./company-job-schedule-update";
import { z } from "zod";
import { assertCompanyVerifiedContractRelease } from "./company-verified-contract-release";
import { normalizeCompanyJobRecurrence, normalizeCompanyJobRecurrenceReceipt,
  normalizeCompanyJobB29RecurrenceReadback, type CompanyJobRecurrenceInput,
  type CompanyJobRecurrenceReceipt } from "./company-job-recurrence";
import { normalizeCompanyInvoiceOperationKey, normalizeCompanyInvoiceOperationLookup,
  normalizeCompanyInvoiceOperationReceipt, type CompanyInvoiceOperationBody } from "./company-job-invoice-operation";
import { normalizeCompanyJobPrivateNotes, normalizeCompanyJobPrivateNotesVersion } from "./company-job-private-notes";
import { normalizeCompanyJobConfirmation, type CompanyJobConfirmation } from "./company-job-confirmation";
import { createCompanyJobAddressPayload, normalizeCompanyJobAddressDetail, type CompanyJobAddress, type CompanyJobAddressWriter } from "./company-job-address";
import { createCompanyJobInvoiceOptions, normalizeCompanyJobInvoiceSentTo } from "./company-job-invoice-intent";
import { normalizeCompanyJobBillingAmount, normalizeCompanyJobPaymentStatus } from "./company-job-billing";
import {
  normalizeCompanyJobLineItems, normalizeCompanyJobDiscount, normalizeCompanyJobQuoteInput,
  normalizeCompanyJobQuote, normalizeCompanyJobPricing, companyJobPricingMatchesInput,
  type JobSyncCompanyJobLineInput, type JobSyncCompanyJobDiscountInput,
  type JobSyncCompanyJobQuoteInput, type JobSyncCompanyJobQuote, type JobSyncCompanyJobPricing,
} from "./company-job-pricing";
export {
  normalizeCompanyJobLineItems, normalizeCompanyJobDiscount, normalizeCompanyJobQuoteInput,
  normalizeCompanyJobQuote, normalizeCompanyJobPricing, companyJobPricingMatchesInput,
} from "./company-job-pricing";
export type {
  JobSyncCompanyJobLineInput, JobSyncCompanyJobDiscountInput, JobSyncCompanyJobQuoteInput,
  JobSyncCompanyJobQuote, JobSyncCompanyJobPricing,
} from "./company-job-pricing";
export { getCompanyJobBillingState } from "./company-job-billing";
export type JobSyncAccountType = "company" | "platform_admin";
export type JobSyncPortalKind = "company" | "platform";
export type JobSyncCompanyRole = "owner" | "dispatcher" | "technician";
export type JobSyncPlatformRole = "owner" | "developer" | "sales" | "customer_support" | "operations";

export type JobSyncNativeSession = {
  token: string;
  portal: JobSyncPortalKind;
  user: {
    id: number;
    name: string;
    email: string | null;
    role: JobSyncCompanyRole | JobSyncPlatformRole;
    memberId?: string;
    /** Raw individual override from the signed Company session, not position eligibility. */
    calendarEligible?: boolean | null;
    /** Computed live Company capability; missing/null is unknown, never inferred from role. */
    paymentCollectionEnabled?: boolean | null;
  };
  company?: {
    id: number;
    name: string;
    slug: string;
    logoUrl: string | null;
    primaryColor: string | null;
    accentColor: string | null;
  };
};

export type JobSyncCompanyMember = {
  id: number;
  name: string;
  role: string;
  isActive: boolean;
  /** Active Company-position setting returned by the HSC roster API. */
  calendarEligible?: boolean;
  /** Raw individual override when supplied; never inferred from a position or role. */
  calendarEligibleOverride?: boolean | null;
};

/**
 * Matches the Company Calendar eligibility contract used by the web
 * dispatcher. Owners and dispatchers administer the workspace, but only
 * field workers can occupy a schedule lane or receive an assignment.
 *
 * `detailer` remains a supported legacy role name for existing Companies and
 * is treated as a technician until that Company's Team Member role is updated.
 */
export function isJobSyncFieldSchedulingMember(member: Pick<JobSyncCompanyMember, "role" | "calendarEligible">): boolean {
  const role = member.role.trim().toLowerCase();
  return member.calendarEligible === true && (role === "technician" || role === "detailer");
}

export type JobSyncCompanyMemberDetail = JobSyncCompanyMember & {
  memberId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  hireDate: string | null;
  availability: string | null;
  workDays: string[];
  hourlyRate: number | null;
  upsellBonusPct: number | null;
  mysteryBonusStatus: string | null;
  assignedVehicle: {
    id: number | null;
    name: string;
    shift: string | null;
    assignedAt: string | null;
  } | null;
};

export type JobSyncCompanyRoster = {
  company: { id: number; name: string };
  members: JobSyncCompanyMember[];
};

export type JobSyncCompanyMemberUpdateInput = {
  firstName?: string;
  lastName?: string;
  role?: JobSyncCompanyRole;
  email?: string;
  phone?: string;
  city?: string;
  availability?: "available" | "busy" | "off_duty";
  calendarEligibleOverride?: boolean;
};

// Company mobile traffic must use the canonical Home Service Connected origin.
// The named legacy host currently proxies the same backend, but it must not be
// required by a shipped Company session.
const DEFAULT_JOBSYNC_BASE_URL = "https://www.homeserviceconnected.com";
const LOGIN_PATH = "/api/mobile/v1/auth/login";
const SESSION_PATH = "/api/mobile/v1/auth/session";
const ACCOUNT_PATH = "/api/mobile/v1/auth/account";
const COMPANY_JOBS_PATH = "/api/mobile/v1/company/jobs";
const COMPANY_PROFILE_PATH = "/api/mobile/v1/company/profile";
const COMPANY_TEAM_MEMBERS_PATH = "/api/mobile/v1/company/team-members";
const COMPANY_SETTINGS_PATH = "/api/mobile/v1/company/settings";
const TIME_CURRENT_PATH = "/api/mobile/v1/time/current";
const TIME_CLOCK_IN_PATH = "/api/mobile/v1/time/clock-in";
const TIME_CLOCK_OUT_PATH = "/api/mobile/v1/time/clock-out";
const TIME_BREAK_START_PATH = "/api/mobile/v1/time/breaks/start";
const TIME_BREAK_END_PATH = "/api/mobile/v1/time/breaks/end";
const TIME_TIMESHEETS_PATH = "/api/mobile/v1/time/timesheets";
const COMPANY_CHAT_GROUPS_PATH = "/api/mobile/v1/company/chat/groups";
const COMPANY_CHAT_COMMUNITY_PATH = "/api/mobile/v1/chat/community";
const COMPANY_CHAT_DIRECT_PATH = "/api/mobile/v1/chat/direct";
const COMPANY_PRICE_BOOK_PATH = "/api/mobile/v1/price-book";
const COMPANY_TIME_OFF_PATH = "/api/mobile/v1/time-off";
const COMPANY_CUSTOMERS_PATH = "/api/mobile/v1/customers";
const COMPANY_ROLES = new Set(["owner", "dispatcher", "technician"]);
const PLATFORM_ROLES = new Set(["owner", "developer", "sales", "customer_support", "operations"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstRecord(...values: unknown[]) {
  for (const value of values) {
    const record = asRecord(value);
    if (record) return record;
  }
  return null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function nullableNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function isActiveMember(value: unknown) {
  return value !== false && value !== 0 && value !== "0" && value !== "false";
}

function isCalendarEligible(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function rawNullableBoolean(value: unknown): boolean | null | undefined {
  return value === null || typeof value === "boolean" ? value : undefined;
}

function errorMessage(payload: unknown, fallback: string) {
  const root = asRecord(payload);
  const error = asRecord(root?.error);
  return firstString(
    typeof root?.error === "string" ? root.error : null,
    error?.message,
    error?.detail,
    root?.message,
    root?.detail,
  ) ?? fallback;
}

function getJobSyncBaseUrl() {
  const configured = process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL?.trim();
  return (configured || DEFAULT_JOBSYNC_BASE_URL).replace(/\/$/, "");
}

export class JobSyncApiError extends Error {
  constructor(message: string, public readonly status: number | null, public readonly code: string | null) {
    super(message);
    this.name = "JobSyncApiError";
  }
}

async function requestJson(path: string, init: RequestInit, expectedSuccessStatus?: number | readonly number[]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${getJobSyncBaseUrl()}${path}`, {
      ...init,
      // Schedule, roster, and time state are live operational data. Never let
      // a native HTTP cache replay a prior Company response as current data.
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = asRecord(asRecord(payload)?.error);
      throw new JobSyncApiError(errorMessage(payload, response.status === 401 ? "Invalid email or password." : "Home Service Connected could not complete this request."), response.status, firstString(error?.code));
    }
    if (expectedSuccessStatus !== undefined && (typeof expectedSuccessStatus === "number"
      ? response.status !== expectedSuccessStatus : !expectedSuccessStatus.includes(response.status))) {
      throw new JobSyncApiError("The backend returned an unexpected acknowledgment. Refresh before trying again.", response.status, "INVALID_RESPONSE");
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new JobSyncApiError("Home Service Connected took too long to respond. Refresh before trying again.", null, "TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function extractJobSyncMobileToken(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const auth = firstRecord(root?.auth, data?.auth);
  const session = firstRecord(root?.session, data?.session);
  return firstString(
    root?.token,
    root?.accessToken,
    root?.access_token,
    root?.bearerToken,
    data?.token,
    data?.accessToken,
    data?.access_token,
    data?.bearerToken,
    auth?.token,
    auth?.accessToken,
    session?.token,
    session?.accessToken,
    session?.bearerToken,
  );
}

export function createJobSyncMobileLoginPayload(input: { accountType: JobSyncAccountType; email: string; password: string }) {
  return {
    accountType: input.accountType,
    email: input.email.trim().toLowerCase(),
    password: input.password,
  };
}

export function createJobSyncBearerHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export type JobSyncMobileJob = {
  id: number;
  customerId: number;
  assignedUserId: number | null;
  title: string;
  serviceName: string;
  status: string;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  updatedAt: string | null;
  addressLine1: string | null;
  addressLine2?: string | null;
  city: string | null;
  region?: string | null;
  postalCode?: string | null;
  amount: number;
  customerName: string;
  assignedName: string | null;
  /** Canonical major currency units; optional for legacy fixtures, unknown when invalid. */
  paidTotal?: number | null;
  refundTotal?: number | null;
  appliedEstimateCredit?: number | null;
  balance?: number | null;
  paymentStatus?: string | null;
};

export type JobSyncCompanySettings = {
  id: number;
  name: string;
  timezone: string;
};

export type JobSyncCompanyCustomer = {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  region?: string | null;
  postalCode?: string | null;
  vehicleType?: string | null;
  updatedAt?: string | null;
  /** Optional wire provenance, not a client-supplied authorization scope. */
  companyId?: number;
};

function normalizeJobSyncMobileJob(value: unknown): JobSyncMobileJob | null {
  const row = asRecord(value) ?? {};
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    id,
    customerId: Number(row.customerId),
    assignedUserId: positiveJobSyncId(row.assignedUserId),
    title: firstString(row.title) ?? "",
    serviceName: firstString(row.serviceName) ?? "",
    status: firstString(row.status) ?? "unknown",
    scheduledStartAt: firstString(row.scheduledStartAt),
    scheduledEndAt: firstString(row.scheduledEndAt),
    updatedAt: firstString(row.updatedAt),
    addressLine1: firstString(row.addressLine1),
    addressLine2: firstString(row.addressLine2, row.address_line2),
    city: firstString(row.city),
    region: firstString(row.region, row.state),
    postalCode: firstString(row.postalCode, row.postal_code, row.zipCode),
    amount: Number(row.amount || 0),
    customerName: firstString(row.customerName) ?? "",
    assignedName: firstString(row.assignedName),
    paidTotal: normalizeCompanyJobBillingAmount(row.paidTotal),
    refundTotal: normalizeCompanyJobBillingAmount(row.refundTotal),
    appliedEstimateCredit: normalizeCompanyJobBillingAmount(row.appliedEstimateCredit),
    balance: normalizeCompanyJobBillingAmount(row.balance),
    paymentStatus: normalizeCompanyJobPaymentStatus(row.paymentStatus),
  };
}

export function normalizeJobSyncCompanySettings(payload: unknown): JobSyncCompanySettings | null {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const company = firstRecord(data.company, root?.company) ?? {};
  const id = nullableNumber(company.id, company.companyId);
  const name = firstString(company.name, company.companyName);
  if (!id || !name) return null;
  return {
    id,
    name,
    timezone: firstString(company.timezone, company.timeZone) ?? "America/Chicago",
  };
}

export function normalizeJobSyncCompanyCustomers(payload: unknown): JobSyncCompanyCustomer[] {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const customers = Array.isArray(data.customers) ? data.customers : [];
  return customers.map((value): JobSyncCompanyCustomer | null => {
    const customer = asRecord(value) ?? {};
    const id = positiveJobSyncId(customer.id ?? customer.customerId ?? customer.customer_id);
    const firstName = firstString(customer.firstName, customer.first_name) ?? "";
    const lastName = firstString(customer.lastName, customer.last_name) ?? "";
    const name = firstString(customer.name, customer.fullName, `${firstName} ${lastName}`.trim());
    if (!id || !name) return null;
    return {
      id,
      name,
      firstName: firstName || name.split(/\s+/)[0] || "",
      lastName: lastName || name.split(/\s+/).slice(1).join(" "),
      email: firstString(customer.email),
      phone: firstString(customer.phone, customer.phoneNumber),
      addressLine1: firstString(customer.addressLine1, customer.address_line1, customer.address),
      city: firstString(customer.city),
      region: firstString(customer.region, customer.state),
      postalCode: firstString(customer.postalCode, customer.postal_code, customer.zipCode),
      vehicleType: firstString(customer.vehicleType, customer.vehicle_type),
      updatedAt: firstString(customer.updatedAt, customer.updated_at),
      ...(positiveJobSyncId(customer.companyId ?? customer.company_id)
        ? { companyId: positiveJobSyncId(customer.companyId ?? customer.company_id)! } : {}),
    };
  }).filter((customer): customer is JobSyncCompanyCustomer => Boolean(customer));
}

export function filterJobSyncCompanyCustomers(customers: JobSyncCompanyCustomer[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length < 2) return [];
  return customers.filter((customer) => [
    customer.name,
    customer.firstName,
    customer.lastName,
    customer.email,
    customer.phone,
    customer.addressLine1,
    customer.city,
  ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))).slice(0, 8);
}

export async function getJobSyncCompanyJobs(token: string, range?: { start?: string; end?: string }): Promise<JobSyncMobileJob[]> {
  const search = new URLSearchParams();
  if (range?.start) search.set("start", range.start);
  if (range?.end) search.set("end", range.end);
  const jobs = new Map<number, JobSyncMobileJob>();
  const seenCursors = new Set<string>();
  for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
    const payload = asRecord(await requestJson(`${COMPANY_JOBS_PATH}${search.size ? `?${search.toString()}` : ""}`, {
      method: "GET", headers: createJobSyncBearerHeaders(token),
    })) ?? {};
    if (!Array.isArray(payload.jobs)) throw new JobSyncApiError("Could not verify the Company calendar response. Refresh to try again.", null, "INVALID_RESPONSE");
    for (const row of payload.jobs) {
      const job = normalizeJobSyncMobileJob(row);
      if (job && positiveJobSyncId(job.id)) jobs.set(job.id, job);
    }
    const next = asRecord(payload.page)?.nextCursor;
    if (next === null || next === undefined) return [...jobs.values()];
    if (typeof next !== "string" || !next || next.length > 4096 || seenCursors.has(next)) throw new JobSyncApiError("The Company calendar pagination could not be verified. Refresh to try again.", null, "INVALID_PAGINATION");
    seenCursors.add(next);
    search.set("cursor", next);
  }
  throw new JobSyncApiError("The Company calendar exceeds this refresh limit. No partial schedule was accepted.", null, "CALENDAR_REFRESH_LIMIT");
}

export type JobSyncCompanyNewCustomer = {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  city?: string;
  region?: string;
  postalCode?: string;
};
export type JobSyncCompanyJobCustomerSelector =
  | { customerId: number; newCustomer?: never }
  | { customerId?: never; newCustomer: JobSyncCompanyNewCustomer };

/** Canonical nested intent; validate/copy/freeze synchronously before any I/O. */
export function normalizeCompanyJobNewCustomer(value: unknown): JobSyncCompanyNewCustomer {
  const limits = { firstName: 120, lastName: 120, email: 320, phone: 64, addressLine1: 255, city: 96, region: 96, postalCode: 24 } as const;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some((key) => typeof key !== "string" || !Object.hasOwn(limits, key))) throw new Error("New customer fields could not be verified.");
  const row = value as Record<string, unknown>;
  const result: JobSyncCompanyNewCustomer = { firstName: "", lastName: "" };
  for (const field of Object.keys(limits) as (keyof typeof limits)[]) {
    const raw = row[field];
    const required = field === "firstName" || field === "lastName";
    const label = field === "firstName" ? "First name" : field === "lastName" ? "Last name" : field === "email" ? "Email" : field === "phone" ? "Phone" : "Customer address";
    if (raw === undefined && !required) continue;
    if (typeof raw !== "string" || raw.trim().length > limits[field]) throw new Error(`${label} exceeds its limit or is invalid.`);
    const text = raw.trim();
    if (!text) { if (required) throw new Error(`${label} is required.`); continue; }
    if (field === "email" && !z.email().safeParse(text).success) throw new Error("Email must be a valid email address.");
    if (field === "phone") {
      const digits = text.replace(/\D/g, "");
      if (![7, 10].includes(digits.length) && !(digits.length === 11 && digits.startsWith("1"))) throw new Error("Phone must contain 7 or 10 digits, or 11 digits starting with 1.");
      result.phone = digits.length === 11 ? digits.slice(1) : digits;
    } else result[field] = field === "email" ? text.toLowerCase() : text;
  }
  return Object.freeze(result);
}

export type JobSyncCompanyJobCreateInput = JobSyncCompanyJobCustomerSelector & {
  priceBookServiceId?: number;
  lineItems?: JobSyncCompanyJobLineInput[];
  discount?: JobSyncCompanyJobDiscountInput;
  vehiclePriceKey?: string | null;
  assignedUserId?: number | null;
  scheduledStartAt: string;
  scheduledEndAt?: string;
  addressLine1?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  serviceNotes?: string;
  privateNotes?: string;
  operationKey?: string;
  /** Omission retains the backend's default ON and old durable intent. */
  notifyCustomer?: boolean;
  /** Unpublished: production gate is required before recurrence requests. */
  recurrence?: CompanyJobRecurrenceInput;
};

/** CREATE is the canonical list-shaped DTO, not the detail/photo-gallery DTO. */
export type JobSyncCompanyJobCreateResult = JobSyncMobileJob & {
  companyId: number;
  /** Saved replays carry no service ID; never synthesize one from the request. */
  priceBookServiceId: number | null;
  /** Optional canonical persisted pricing; absent legacy pricing stays absent. */
  pricing?: JobSyncCompanyJobPricing;
  operation?: { key: string; state: "saved"; replayed: boolean };
  /** Detail/CREATE email record only; current-appointment binding may be unavailable. */
  confirmationCommunication?: CompanyJobConfirmation;
  /** CREATE metadata only; canonical complete-series GET is mandatory. */
  recurrence?: CompanyJobRecurrenceReceipt | null;
};

export type JobSyncCompanyJobCreationOperation = {
  key: string;
  state: "saved" | "pending" | "rejected" | "unknown";
  jobId: number | null;
  /** Optional authoritative metadata; Job detail remains the required readback. */
  customerId?: number;
  /** Persisted b29 operation evidence; omission on older responses is not invented proof. */
  payloadFingerprint?: string;
  rejectionCode: string | null;
  rejectionMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

function companyJobCreationOperationKey(value: unknown): string {
  if (typeof value !== "string") throw new Error("A valid Job creation operation key is required.");
  const key = value.trim();
  if (key.length < 8 || key.length > 128 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new Error("A valid Job creation operation key is required.");
  }
  // Encoding is necessary for opaque keys containing URL punctuation. Reject
  // unpaired surrogates rather than throwing later while constructing the GET.
  try { encodeURIComponent(key); } catch { throw new Error("A valid Job creation operation key is required."); }
  return key;
}

function hasOnlyCompanyOperationFields(row: Record<string, unknown>, fields: readonly string[]) {
  return Object.keys(row).every((key) => fields.includes(key));
}

function validCompanyOperationTimestamp(value: unknown) {
  return value === undefined || value === null || (typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19));
}

/** One bearer-scoped GET only; unknown is not proof that creation was rejected. */
export async function getJobSyncCompanyJobCreationOperation(
  token: string, companyId: number, operationKey: string,
): Promise<JobSyncCompanyJobCreationOperation> {
  requireJobSyncMutationToken(token);
  if (typeof companyId !== "number" || !Number.isSafeInteger(companyId) || companyId <= 0) throw new Error("A current Company session is required.");
  const key = companyJobCreationOperationKey(operationKey);
  const payload = asRecord(await requestJson(`${COMPANY_JOBS_PATH}/operations/${encodeURIComponent(key)}`, {
    method: "GET", headers: createJobSyncBearerHeaders(token),
  }, 200));
  const operation = asRecord(payload?.operation);
  const invalid = () => new JobSyncApiError("Could not verify this Company's Job creation operation. Refresh before trying again.", null, "INVALID_RESPONSE");
  if (!payload || !hasOnlyCompanyOperationFields(payload, ["operation"]) || !operation
    || !hasOnlyCompanyOperationFields(operation, ["key", "state", "jobId", "customerId", "payloadFingerprint", "rejectionCode", "rejectionMessage", "createdAt", "updatedAt"])
    || operation.key !== key || !["saved", "pending", "rejected", "unknown"].includes(operation.state as string)
    || (Object.hasOwn(operation, "payloadFingerprint") && (operation.state === "unknown"
      || typeof operation.payloadFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(operation.payloadFingerprint)))
    || (Object.hasOwn(operation, "customerId") && (operation.state !== "saved" || typeof operation.customerId !== "number" || positiveJobSyncId(operation.customerId) !== operation.customerId))
    || (operation.state === "saved"
      ? typeof operation.jobId !== "number" || !Number.isSafeInteger(operation.jobId) || operation.jobId <= 0
      : operation.jobId !== null)
    || !validCompanyOperationTimestamp(operation.createdAt) || !validCompanyOperationTimestamp(operation.updatedAt)) throw invalid();
  if (operation.state === "rejected") {
    if (!["BAD_REQUEST", "NOT_FOUND", "CONFLICT", "PRECONDITION_FAILED"].includes(operation.rejectionCode as string)
      || typeof operation.rejectionMessage !== "string" || !operation.rejectionMessage.trim()) throw invalid();
  } else if ((operation.rejectionCode !== undefined && operation.rejectionCode !== null)
    || (operation.rejectionMessage !== undefined && operation.rejectionMessage !== null)) throw invalid();
  return {
    key, state: operation.state as JobSyncCompanyJobCreationOperation["state"], jobId: operation.jobId as number | null,
    ...(Object.hasOwn(operation, "customerId") ? { customerId: operation.customerId as number } : {}),
    ...(Object.hasOwn(operation, "payloadFingerprint") ? { payloadFingerprint: operation.payloadFingerprint as string } : {}),
    rejectionCode: operation.rejectionCode as string | null | undefined ?? null,
    rejectionMessage: operation.rejectionMessage as string | null | undefined ?? null,
    createdAt: operation.createdAt as string | null | undefined ?? null,
    updatedAt: operation.updatedAt as string | null | undefined ?? null,
  };
}

/** Read-only pricing POST. Capture nested intent before I/O and never enable unsupported saving. */
export async function quoteJobSyncCompanyJob(
  token: string, companyId: number, input: JobSyncCompanyJobQuoteInput,
): Promise<JobSyncCompanyJobQuote> {
  requireJobSyncMutationToken(token);
  if (typeof companyId !== "number" || !Number.isSafeInteger(companyId) || companyId <= 0) throw new Error("A current Company session is required.");
  const body = normalizeCompanyJobQuoteInput(input);
  const payload = asRecord(await requestJson(`${COMPANY_JOBS_PATH}/quote`, {
    method: "POST", headers: createJobSyncBearerHeaders(token), body: JSON.stringify(body),
  }, 200));
  const quote = payload && hasOnlyCompanyOperationFields(payload, ["quote"])
    ? normalizeCompanyJobQuote(payload.quote, body) : null;
  if (!quote) throw new JobSyncApiError("Could not verify authoritative Company Job pricing and tax persistence. Refresh before saving.", null, "INVALID_QUOTE_RESPONSE");
  return quote;
}

export function createJobSyncCompanyJobPayload(input: JobSyncCompanyJobCreateInput): JobSyncCompanyJobCreateInput {
  if (!input || typeof input !== "object" || Object.hasOwn(input, "customerId") === Object.hasOwn(input, "newCustomer")) throw new Error("Choose exactly one existing or new Company customer.");
  if (Object.hasOwn(input, "recurrence")) {
    assertCompanyVerifiedContractRelease("recurrence");
    if (input.operationKey === undefined || input.scheduledEndAt !== undefined) throw new Error("Recurring creation requires a stable operation key and server-authoritative Auto duration.");
  }
  const recurrence = input.recurrence !== undefined ? normalizeCompanyJobRecurrence(input.recurrence) : undefined;
  const selector: JobSyncCompanyJobCustomerSelector = Object.hasOwn(input, "newCustomer")
    ? { newCustomer: normalizeCompanyJobNewCustomer(input.newCustomer) } : { customerId: input.customerId! };
  const newPricingFlow = input.lineItems !== undefined || input.discount !== undefined;
  if ((selector.newCustomer || newPricingFlow) && Reflect.ownKeys(input).some((key) => typeof key !== "string"
    || !["customerId", "newCustomer", "priceBookServiceId", "lineItems", "discount", "vehiclePriceKey", "assignedUserId", "scheduledStartAt", "scheduledEndAt", "addressLine1", "city", "region", "postalCode", "serviceNotes", "privateNotes", "operationKey", "notifyCustomer", "recurrence"].includes(key))) throw new Error("Company Job fields could not be verified.");
  if (input.notifyCustomer !== undefined && typeof input.notifyCustomer !== "boolean") throw new Error("Notify customer must be on or off.");
  const lineItems = input.lineItems !== undefined ? normalizeCompanyJobLineItems(input.lineItems) : undefined;
  const discount = input.discount !== undefined ? normalizeCompanyJobDiscount(input.discount) : undefined;
  if ((!selector.newCustomer && (typeof selector.customerId !== "number" || positiveJobSyncId(selector.customerId) !== selector.customerId))
    || (input.priceBookServiceId === undefined ? !lineItems : typeof input.priceBookServiceId !== "number" || positiveJobSyncId(input.priceBookServiceId) !== input.priceBookServiceId)
    || (lineItems && input.priceBookServiceId !== undefined && input.priceBookServiceId !== lineItems[0].priceBookItemId)) {
    throw new Error("Choose an existing Company customer and an active Price Book service.");
  }
  if (selector.newCustomer && input.operationKey === undefined) throw new Error("A new customer requires a secure Job creation operation key.");
  const instant = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
  if (!instant(input.scheduledStartAt) || (input.scheduledEndAt !== undefined && (!instant(input.scheduledEndAt) || Date.parse(input.scheduledEndAt) <= Date.parse(input.scheduledStartAt)))) {
    throw new Error("Choose a valid Company calendar start and end time.");
  }
  if (input.assignedUserId !== undefined && input.assignedUserId !== null && positiveJobSyncId(input.assignedUserId) !== input.assignedUserId) throw new Error("Choose an eligible Company technician.");
  const result: JobSyncCompanyJobCreateInput = { ...selector, scheduledStartAt: input.scheduledStartAt };
  if (input.priceBookServiceId !== undefined) result.priceBookServiceId = input.priceBookServiceId;
  if (lineItems) result.lineItems = lineItems;
  if (discount) result.discount = discount;
  if (recurrence) result.recurrence = recurrence;
  if (input.operationKey !== undefined) result.operationKey = companyJobCreationOperationKey(input.operationKey);
  // Never turn an opt-out into omission, including on strict legacy servers.
  // There is no retry/downgrade without this field if the server rejects it.
  if (input.notifyCustomer !== undefined) result.notifyCustomer = input.notifyCustomer;
  if (input.scheduledEndAt !== undefined) result.scheduledEndAt = input.scheduledEndAt;
  if (input.assignedUserId !== undefined) result.assignedUserId = input.assignedUserId;
  if (input.vehiclePriceKey !== undefined) {
    if (input.vehiclePriceKey !== null && (typeof input.vehiclePriceKey !== "string" || !input.vehiclePriceKey.trim() || input.vehiclePriceKey.trim().length > 64)) throw new Error("Choose a valid Price Book service rate.");
    result.vehiclePriceKey = input.vehiclePriceKey === null ? null : input.vehiclePriceKey.trim();
  }
  const limits = { addressLine1: 255, city: 96, region: 96, postalCode: 24, serviceNotes: 4000, privateNotes: 4000 } as const;
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.trim().length > limits[key]) throw new Error("A Job address or note exceeds the supported limit.");
    result[key] = value.trim();
  }
  return Object.freeze(result);
}

/** One POST only. Never retry an ambiguous creation failure or use legacy upsert. */
export async function createJobSyncCompanyJob(token: string, companyId: number, input: JobSyncCompanyJobCreateInput): Promise<JobSyncCompanyJobCreateResult> {
  requireJobSyncMutationToken(token);
  if (typeof companyId !== "number" || !Number.isSafeInteger(companyId) || companyId <= 0) throw new Error("A current Company session is required.");
  const body = createJobSyncCompanyJobPayload(input);
  const firstServiceId = body.lineItems?.[0].priceBookItemId ?? body.priceBookServiceId!;
  const newPricingFlow = body.lineItems !== undefined || body.discount !== undefined;
  const payload = asRecord(await requestJson(COMPANY_JOBS_PATH, { method: "POST", headers: createJobSyncBearerHeaders(token), body: JSON.stringify(body) }, [200, 201]));
  const row = asRecord(payload?.job);
  const job = normalizeJobSyncMobileJob(row);
  const pricing = row ? normalizeCompanyJobPricing(row, { requireStoredTaxEvidence: true }) : null;
  const operation = asRecord(payload?.operation);
  const customerMatches = Boolean(row && typeof row.customerId === "number" && positiveJobSyncId(row.customerId) === row.customerId
    && (body.newCustomer ? positiveJobSyncId(row.companyId ?? row.company_id) === companyId : row.customerId === body.customerId));
  if ((body.operationKey !== undefined && (!payload || !hasOnlyCompanyOperationFields(payload, ["job", "operation"])
    || !operation || operation.key !== body.operationKey || operation.state !== "saved"
    || typeof operation.replayed !== "boolean" || !hasOnlyCompanyOperationFields(operation, ["key", "state", "replayed"])
    || !row || typeof row.id !== "number" || !Number.isSafeInteger(row.id) || row.id <= 0
    || !customerMatches
    || (row.priceBookServiceId !== null && row.priceBookServiceId !== firstServiceId)
    || row.assignedUserId !== (body.assignedUserId ?? null)
    || typeof row.amount !== "number" || !Number.isFinite(row.amount) || row.amount < 0))
    || !row || !job || !customerMatches
    || pricing === null
    || (newPricingFlow && (!companyJobPricingMatchesInput(pricing ?? undefined, {
      lineItems: body.lineItems ?? [{ priceBookItemId: firstServiceId, quantity: 1, vehiclePriceKey: body.vehiclePriceKey }],
      ...(body.discount ? { discount: body.discount } : {}),
    }) || row.priceBookServiceId !== firstServiceId || typeof row.id !== "number" || !Number.isSafeInteger(row.id)
      || row.assignedUserId !== (body.assignedUserId ?? null)
      || !Object.hasOwn(row, "discountKind") || !Object.hasOwn(row, "discountCode")))
    || (row.priceBookServiceId === null
      ? body.operationKey === undefined || operation?.replayed !== true
      : positiveJobSyncId(row.priceBookServiceId) !== firstServiceId)
    || (row.companyId !== undefined && positiveJobSyncId(row.companyId) !== companyId)
    || (row.company_id !== undefined && positiveJobSyncId(row.company_id) !== companyId)
    || Date.parse(job.scheduledStartAt ?? "") !== Date.parse(body.scheduledStartAt)
    || (body.scheduledEndAt !== undefined && Date.parse(job.scheduledEndAt ?? "") !== Date.parse(body.scheduledEndAt))
    || (body.assignedUserId !== undefined && job.assignedUserId !== body.assignedUserId)) {
    throw new JobSyncApiError("The save response could not be verified. Refresh the Company calendar before creating this Job again.", null, "INVALID_CREATE_RESPONSE");
  }
  return {
    ...job, companyId, priceBookServiceId: row.priceBookServiceId === null ? null : positiveJobSyncId(row.priceBookServiceId)!,
    ...(pricing ? { pricing } : {}),
    confirmationCommunication: normalizeCompanyJobConfirmation(row.confirmationCommunication, row.customer_notification_enabled),
    ...(body.recurrence ? { recurrence: normalizeCompanyJobRecurrenceReceipt(row.recurrence, body.recurrence, job.id) } : {}),
    ...(body.operationKey !== undefined ? { operation: { key: body.operationKey, state: "saved" as const, replayed: operation!.replayed as boolean } } : {}),
  };
}

/** Exact unwrapped Company recurring GET. Never enrich absent server proof. */
export async function getJobSyncCompanyJobRecurrence(token: string, companyId: number, jobId: number): Promise<unknown> {
  assertCompanyVerifiedContractRelease("recurrence");
  requireJobSyncMutationToken(token); validCompanyJobId(jobId);
  if (typeof companyId !== "number" || positiveJobSyncId(companyId) !== companyId) throw new Error("A current Company session is required.");
  const raw = await requestJson(`${COMPANY_JOBS_PATH}/${jobId}/recurrence`, { method: "GET", headers: createJobSyncBearerHeaders(token) }, 200);
  const recurrence = normalizeCompanyJobB29RecurrenceReadback(raw, jobId);
  if (recurrence.companyId !== companyId) throw new JobSyncApiError("Recurring readback belongs to a different Company.", null, "INVALID_RESPONSE");
  return recurrence;
}

/** New email operation only; existing on-file email/SMS adapter remains unchanged. */
export async function sendJobSyncCompanyInvoiceOperation(token: string, jobId: number, input: CompanyInvoiceOperationBody): Promise<unknown> {
  assertCompanyVerifiedContractRelease("invoice");
  requireJobSyncMutationToken(token); validCompanyJobId(jobId);
  if (!input || input.method !== "email" || typeof input.resend !== "boolean"
    || Reflect.ownKeys(input).some(key => typeof key !== "string" || !["method", "resend", "operationKey", "recipientEmail"].includes(key))) throw new Error("A captured email invoice operation is required.");
  const options = createCompanyJobInvoiceOptions(input.method, input.resend, input.recipientEmail);
  const operationKey = normalizeCompanyInvoiceOperationKey(input.operationKey);
  const body = { method: options.method, resend: options.resend, operationKey,
    ...(options.recipientEmail ? { recipientEmail: options.recipientEmail } : {}) };
  const raw = await requestJson(`/api/mobile/v1/jobs/${jobId}/invoice`, { method: "POST", headers: createJobSyncBearerHeaders(token), body: JSON.stringify(body) }, 200);
  normalizeCompanyInvoiceOperationReceipt(raw, operationKey);
  return raw;
}

/** Non-effectful scoped lookup; not_found is not proof a lost POST had no effect. */
export async function getJobSyncCompanyInvoiceOperation(token: string, jobId: number, key: string): Promise<unknown> {
  assertCompanyVerifiedContractRelease("invoice");
  requireJobSyncMutationToken(token); validCompanyJobId(jobId);
  const operationKey = normalizeCompanyInvoiceOperationKey(key);
  const raw = await requestJson(`/api/mobile/v1/jobs/${jobId}/invoice-operation?operationKey=${encodeURIComponent(operationKey)}`, { method: "GET", headers: createJobSyncBearerHeaders(token) }, 200);
  const operation = normalizeCompanyInvoiceOperationLookup(raw, operationKey);
  if (operation.jobId !== jobId) throw new JobSyncApiError("Invoice readback belongs to a different Job.", null, "INVALID_RESPONSE");
  return operation;
}

export type JobSyncCompanyJobScheduleInput = CompanyJobScheduleMutation;

function validCompanyJobId(jobId: number) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error("Home Service Connected returned an invalid Job identifier.");
  }
}

export function positiveJobSyncId(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export type JobSyncFieldStatus = "en_route" | "on_site" | "completed";
export type JobSyncJobPhotoCategory = "before" | "after" | "damage" | "other";
export type JobSyncJobPhoto = {
  id: number;
  imageUrl: string;
  caption: string | null;
  uploadedByUserId: number | null;
  createdAt: string | null;
  /** Exact canonical metadata; older galleries may omit it. */
  category?: JobSyncJobPhotoCategory | null;
  displayOrder?: number | null;
};
export type JobSyncJobPhotoUploadInput = {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
  caption?: string;
  category?: JobSyncJobPhotoCategory;
  displayOrder?: number;
};
export type JobSyncJobPhotoUploadResponse = {
  photo: {
    id: number;
    imageUrl: string;
    caption: string | null;
    uploadedByUserId: number;
    category?: JobSyncJobPhotoCategory | null;
    displayOrder?: number | null;
  };
};
export type JobSyncCompanyJobDetail = JobSyncMobileJob & {
  /** Verified detail-only contact and legacy invoice projection, never schedule/draft data. */
  customerEmail?: string | null;
  invoiceSentAt?: string | null;
  companyId: number | null;
  /** Internal detail only; undefined means unavailable, null/empty means verified absence. */
  privateNotes?: string | null;
  /** Complete saved Job snapshot only, never customer-profile/list fallback. */
  serviceAddress?: CompanyJobAddress;
  confirmationCommunication?: CompanyJobConfirmation;
  enRouteAt: string | null;
  onSiteAt: string | null;
  completedAt: string | null;
  photos: JobSyncJobPhoto[];
  /** Complete IDs from the verified wire gallery, including photos whose URL cannot render. */
  persistedPhotoIds?: number[];
  /** Root persisted service lines/totals; unavailable legacy tax stays null. */
  pricing?: JobSyncCompanyJobPricing;
};

function serverInstant(value: unknown): string | null {
  return typeof value === "string" && value.trim() && Number.isFinite(Date.parse(value)) ? value : null;
}

// /manus-storage/ is verified at backend 16a57f2e; /api/storage/ remains legacy compatibility only.
const PHOTO_STORAGE_PREFIXES = ["/manus-storage/", "/api/storage/"];

/** Only these managed root-relative storage paths may inherit the configured API origin. */
export function normalizeJobSyncPhotoUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || /[\u0000-\u0020\u007f\\]/.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return null;
  try {
    const absoluteHttps = /^https:\/\//i.test(value);
    const storagePrefix = PHOTO_STORAGE_PREFIXES.find((prefix) => value.startsWith(prefix));
    if (!absoluteHttps && (!storagePrefix || value.startsWith("//"))) return null;
    const rawPath = absoluteHttps ? value.match(/^https:\/\/[^/?#]+([^?#]*)/i)?.[1] ?? "" : value.split(/[?#]/, 1)[0];
    if (!absoluteHttps && /%(?![0-9a-f]{2})/i.test(rawPath)) return null;
    let decoded = rawPath;
    // Inspect nested escapes before URL parsing can silently normalize traversal.
    for (let pass = 0; pass < 8; pass++) {
      if (!/%[0-9a-f]{2}/i.test(decoded)) break;
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (/%[0-9a-f]{2}/i.test(decoded) || /[\u0000-\u001f\u007f\\]/.test(decoded)
      || decoded.split("/").some((segment) => segment === "." || segment === "..")) return null;
    if (absoluteHttps) {
      const absolute = new URL(value);
      return absolute.protocol === "https:" && absolute.hostname && !absolute.username && !absolute.password ? value : null;
    }
    if (!storagePrefix || !decoded.startsWith(storagePrefix) || decoded.slice(storagePrefix.length).length === 0
      || decoded.split("/").slice(1).some((segment) => !segment)) return null;
    const base = new URL(getJobSyncBaseUrl());
    const resolved = new URL(value, base);
    // Concatenating the validated origin keeps the signed path/query byte-for-byte.
    return base.protocol === "https:" && !base.username && !base.password && resolved.origin === base.origin
      && resolved.pathname.startsWith(storagePrefix) ? `${base.origin}${value}` : null;
  } catch { return null; }
}

function validJobSyncPhotoCategory(value: unknown): value is JobSyncJobPhotoCategory {
  return value === "before" || value === "after" || value === "damage" || value === "other";
}
function validJobSyncPhotoDisplayOrder(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100000;
}
function validJobSyncPhotoReadMetadata(photo: Record<string, unknown>): boolean {
  return (photo.category === undefined || photo.category === null || validJobSyncPhotoCategory(photo.category))
    && (photo.displayOrder === undefined || photo.displayOrder === null || validJobSyncPhotoDisplayOrder(photo.displayOrder));
}
function jobSyncPhotoReadMetadata(photo: Record<string, unknown>): { category?: JobSyncJobPhotoCategory | null; displayOrder?: number | null } {
  return {
    ...(photo.category !== undefined ? { category: photo.category as JobSyncJobPhotoCategory | null } : {}),
    ...(photo.displayOrder !== undefined ? { displayOrder: photo.displayOrder as number | null } : {}),
  };
}

/** Canonical signed gallery order/metadata from f3576bcb; snake URL/date fields remain legacy compatibility. */
export function normalizeJobSyncCompanyJobDetail(payload: unknown, jobId: number, companyId: number): JobSyncCompanyJobDetail | null {
  const row = asRecord(asRecord(payload)?.job);
  const job = normalizeJobSyncMobileJob(row);
  const pricing = row ? normalizeCompanyJobPricing(row, { requireStoredTaxEvidence: true }) : null;
  const returnedCompanyId = positiveJobSyncId(row?.companyId ?? row?.company_id);
  const rawCompanyId = row?.companyId ?? row?.company_id;
  if (!positiveJobSyncId(companyId) || !row || !job || pricing === null || job.id !== jobId || (rawCompanyId !== undefined && returnedCompanyId !== companyId)) return null;
  // Missing/malformed wire galleries cannot establish absence of a persisted photo.
  if (!Array.isArray(row.photos)) return null;
  const persistedPhotoIds: number[] = [];
  const seenPhotoIds = new Set<number>();
  for (const value of row.photos) {
    const photo = asRecord(value);
    const id = positiveJobSyncId(photo?.id);
    if (!photo || !id || seenPhotoIds.has(id) || !validJobSyncPhotoReadMetadata(photo)) return null;
    seenPhotoIds.add(id);
    persistedPhotoIds.push(id);
  }
  return {
    ...job,
    companyId,
    privateNotes: normalizeCompanyJobPrivateNotes(row),
    customerEmail: normalizeCompanyJobInvoiceSentTo(row.customer_email, "email"),
    invoiceSentAt: serverInstant(row.invoiceSentAt),
    serviceAddress: normalizeCompanyJobAddressDetail(row),
    confirmationCommunication: normalizeCompanyJobConfirmation(row.confirmationCommunication, row.customer_notification_enabled),
    ...(pricing ? { pricing } : {}),
    enRouteAt: serverInstant(row.enRouteAt),
    onSiteAt: serverInstant(row.onSiteAt),
    completedAt: serverInstant(row.completedAt),
    persistedPhotoIds,
    photos: row.photos.flatMap((value) => {
      const photo = asRecord(value);
      const id = positiveJobSyncId(photo?.id);
      const imageUrl = normalizeJobSyncPhotoUrl(photo?.imageUrl !== undefined ? photo.imageUrl : photo?.image_url);
      if (!id || !imageUrl) return [];
      return [{ id, imageUrl, caption: firstString(photo?.caption), uploadedByUserId: positiveJobSyncId(photo?.uploadedByUserId), createdAt: serverInstant(photo?.createdAt !== undefined ? photo.createdAt : photo?.created_at), ...jobSyncPhotoReadMetadata(photo!) }];
    }),
  };
}

export async function getJobSyncCompanyJobDetail(token: string, jobId: number, companyId: number): Promise<JobSyncCompanyJobDetail> {
  validCompanyJobId(jobId);
  if (!token.trim() || !positiveJobSyncId(companyId)) throw new Error("A current Company session is required.");
  const detail = normalizeJobSyncCompanyJobDetail(await requestJson(`/api/mobile/v1/jobs/${jobId}`, {
    method: "GET", headers: createJobSyncBearerHeaders(token),
  }), jobId, companyId);
  if (!detail) throw new JobSyncApiError("Could not verify this Company's Job detail. Refresh the schedule.", null, "INVALID_RESPONSE");
  return detail;
}

/** Exact c5758ae6 Company Job tag resource. Not embedded in Job/customer DTOs. */
export type JobSyncCompanyJobTag = {
  id: number; jobId: number; displayName: string; normalizedName: string; createdBy: number;
  createdAt: string | null; updatedAt: string | null;
};
export type JobSyncCompanyJobTagCreateInput = { name: string };
export type JobSyncCompanyJobTagDeleteAcknowledgment = { success: true; tagId: number; jobId: number };

export function createJobSyncCompanyJobTagPayload(input: JobSyncCompanyJobTagCreateInput): JobSyncCompanyJobTagCreateInput {
  const row = asRecord(input);
  if (!row || Object.keys(row).some((key) => key !== "name") || !Object.hasOwn(row, "name") || typeof row.name !== "string") {
    throw new Error("A Company Job tag name is required.");
  }
  const name = row.name.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Tag name is required.");
  if (name.length > 64) throw new Error("Tag name must be 64 characters or fewer.");
  if (Array.from(name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error("Tag name contains an unsupported control character.");
  }
  return { name };
}
function normalizeJobSyncCompanyJobTag(value: unknown, jobId: number): JobSyncCompanyJobTag | null {
  const row = asRecord(value);
  if (!row || !Number.isSafeInteger(jobId) || jobId <= 0
    || typeof row.id !== "number" || positiveJobSyncId(row.id) === null
    || row.jobId !== jobId || typeof row.createdBy !== "number" || positiveJobSyncId(row.createdBy) === null
    || !["id", "jobId", "displayName", "normalizedName", "createdBy", "createdAt", "updatedAt"].every((key) => Object.hasOwn(row, key))
    || typeof row.normalizedName !== "string"
    || !(row.createdAt === null || (typeof row.createdAt === "string" && row.createdAt.trim()))
    || !(row.updatedAt === null || (typeof row.updatedAt === "string" && row.updatedAt.trim()))) return null;
  try {
    const { name } = createJobSyncCompanyJobTagPayload({ name: row.displayName as string });
    if (row.displayName !== name || row.normalizedName !== name.toLocaleLowerCase("en-US")) return null;
    return { id: row.id, jobId, displayName: name, normalizedName: row.normalizedName, createdBy: row.createdBy,
      createdAt: row.createdAt as string | null, updatedAt: row.updatedAt as string | null };
  } catch { return null; }
}
export function normalizeJobSyncCompanyJobTags(payload: unknown, jobId: number): JobSyncCompanyJobTag[] | null {
  const root = asRecord(payload);
  if (!root || !Object.hasOwn(root, "tags") || !Array.isArray(root.tags) || !Number.isSafeInteger(jobId) || jobId <= 0) return null;
  const tags: JobSyncCompanyJobTag[] = [];
  const ids = new Set<number>(); const names = new Set<string>();
  for (const value of root.tags) {
    const tag = normalizeJobSyncCompanyJobTag(value, jobId);
    if (!tag || ids.has(tag.id) || names.has(tag.normalizedName)) return null;
    ids.add(tag.id); names.add(tag.normalizedName); tags.push(tag);
  }
  return tags;
}
export function normalizeJobSyncCompanyJobTagCreateAcknowledgment(payload: unknown, jobId: number,
  input: JobSyncCompanyJobTagCreateInput): JobSyncCompanyJobTag | null {
  const root = asRecord(payload);
  const tag = root && Object.hasOwn(root, "tag") ? normalizeJobSyncCompanyJobTag(root.tag, jobId) : null;
  try {
    const { name } = createJobSyncCompanyJobTagPayload(input);
    return tag && tag.displayName === name && tag.normalizedName === name.toLocaleLowerCase("en-US") ? tag : null;
  } catch { return null; }
}
export function normalizeJobSyncCompanyJobTagDeleteAcknowledgment(payload: unknown, jobId: number,
  tagId: number): JobSyncCompanyJobTagDeleteAcknowledgment | null {
  const root = asRecord(payload);
  return root && ["success", "jobId", "tagId"].every((key) => Object.hasOwn(root, key))
    && Number.isSafeInteger(jobId) && jobId > 0 && Number.isSafeInteger(tagId) && tagId > 0
    && root.success === true && root.jobId === jobId && root.tagId === tagId ? { success: true, jobId, tagId } : null;
}
export async function getJobSyncCompanyJobTags(token: string, jobId: number): Promise<JobSyncCompanyJobTag[]> {
  validCompanyJobId(jobId); requireJobSyncMutationToken(token);
  const tags = normalizeJobSyncCompanyJobTags(await requestJson(`${COMPANY_JOBS_PATH}/${jobId}/tags`, {
    method: "GET", headers: createJobSyncBearerHeaders(token),
  }, 200), jobId);
  if (tags === null) throw new JobSyncApiError("The backend did not return a verified Company Job tag collection. Refresh tags.", null, "INVALID_RESPONSE");
  return tags;
}
/** One POST only; a duplicate or uncertain acknowledgment is not successful replay. */
export async function addJobSyncCompanyJobTag(token: string, jobId: number,
  input: JobSyncCompanyJobTagCreateInput): Promise<JobSyncCompanyJobTag> {
  validCompanyJobId(jobId); requireJobSyncMutationToken(token);
  const body = createJobSyncCompanyJobTagPayload(input);
  const tag = normalizeJobSyncCompanyJobTagCreateAcknowledgment(await requestJson(`${COMPANY_JOBS_PATH}/${jobId}/tags`, {
    method: "POST", headers: createJobSyncBearerHeaders(token), body: JSON.stringify(body),
  }, 201), jobId, body);
  if (!tag) throw new JobSyncApiError("The backend did not acknowledge this Company Job tag. Refresh and review tags before trying again.", null, "INVALID_RESPONSE");
  return tag;
}
/** Delete one canonical tag ID, no body/fallback/retry; readback remains controller-owned. */
export async function removeJobSyncCompanyJobTag(token: string, jobId: number,
  tagId: number): Promise<JobSyncCompanyJobTagDeleteAcknowledgment> {
  validCompanyJobId(jobId); validCompanyJobId(tagId); requireJobSyncMutationToken(token);
  const ack = normalizeJobSyncCompanyJobTagDeleteAcknowledgment(await requestJson(`${COMPANY_JOBS_PATH}/${jobId}/tags/${tagId}`, {
    method: "DELETE", headers: createJobSyncBearerHeaders(token),
  }, 200), jobId, tagId);
  if (!ack) throw new JobSyncApiError("The backend did not acknowledge removing this Company Job tag. Refresh and review tags.", null, "INVALID_RESPONSE");
  return ack;
}

function requireJobSyncMutationToken(token: string) {
  if (typeof token !== "string" || !token.trim() || /[\u0000-\u0020\u007f]/.test(token)) {
    throw new Error("A current Company session is required.");
  }
}

/** Flat projection of the exact wire { checkout: ... } acknowledgment, not payment-ledger truth. */
export type JobSyncCompanyJobCheckout = {
  url: string | null;
  amountCents: number;
  attemptId: number;
  attemptStatus: "creating" | "pending" | "processing" | "succeeded" | "failed" | "expired" | "canceled";
  checkoutState: "open" | "processing" | "creating";
  reused: boolean;
};

/** Validates provider-hosted checkout only; callers must ALSO require checkoutState === "open". */
export function validateCompanyCheckoutUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(value)
    || /%(?![0-9a-f]{2})|%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return null;
  // Inspect the raw authority too: URL parsing otherwise hides an explicit :443 port.
  // Preserve proven provider forms: opaque c/pay suffix, or live g/pay Session with optional /c/ and no query.
  const match = value.match(/^https:\/\/checkout\.stripe\.com(\/[^?#]*)(?:\?[^#]*)?(?:#[A-Za-z0-9_%+=/.-]+)?$/i);
  if (!match || (!/^\/c\/pay\/cs_[A-Za-z0-9_]+(?:%2[fF](?:[A-Za-z0-9_+=-]|%2[fFbB]|%3[dD])+)?$/.test(match[1])
    && !(/^\/g\/pay\/cs_live_[A-Za-z0-9_]+(?:\/c\/)?$/.test(match[1]) && !value.includes("?")))) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com"
      && !url.username && !url.password && !url.port && url.pathname === match[1] ? value : null;
  } catch { return null; }
}

function isPositiveCheckoutInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** One hosted checkout POST; the server selects the entire canonical balance and account. */
export async function createJobSyncCompanyJobCheckout(token: string, jobId: number): Promise<JobSyncCompanyJobCheckout> {
  validCompanyJobId(jobId);
  requireJobSyncMutationToken(token);
  const result = asRecord(await requestJson(`/api/mobile/v1/jobs/${jobId}/checkout`, {
    method: "POST", headers: createJobSyncBearerHeaders(token), body: JSON.stringify({}),
  }, [200, 201]));
  const checkout = asRecord(result?.checkout);
  const url = validateCompanyCheckoutUrl(checkout?.url);
  if (!checkout || !isPositiveCheckoutInteger(checkout.amountCents) || checkout.amountCents < 50
    || !isPositiveCheckoutInteger(checkout.attemptId)
    || !["creating", "pending", "processing", "succeeded", "failed", "expired", "canceled"].includes(checkout.attemptStatus as string)
    || !["open", "processing", "creating"].includes(checkout.checkoutState as string)
    || typeof checkout.reused !== "boolean" || (checkout.url !== null && !url)
    || (checkout.checkoutState === "open" && !url)) {
    throw new JobSyncApiError("The backend did not acknowledge a safe Company checkout. Refresh the Job before trying again.", null, "INVALID_RESPONSE");
  }
  return {
    url, amountCents: checkout.amountCents, attemptId: checkout.attemptId,
    attemptStatus: checkout.attemptStatus as JobSyncCompanyJobCheckout["attemptStatus"],
    checkoutState: checkout.checkoutState as JobSyncCompanyJobCheckout["checkoutState"],
    reused: checkout.reused,
  };
}

/** Read-only native capability probe. No unverified enablement or secret projection. */
export async function getJobSyncCompanyNativePaymentCapabilities(token: string, jobId: number): Promise<unknown> {
  validCompanyJobId(jobId);
  requireJobSyncMutationToken(token);
  return requestJson(`/api/mobile/v1/jobs/${jobId}/native-payment/capabilities`, {
    method: "GET", headers: createJobSyncBearerHeaders(token),
  });
}

/** Validate actual encoded file bytes without Buffer/atob dependencies in native bundles. */
function validateJobSyncPhotoUpload(input: JobSyncJobPhotoUploadInput) {
  if (!asRecord(input) || !["image/jpeg", "image/png", "image/webp"].includes(input.contentType)) {
    throw new Error("Choose a JPEG, PNG, or WebP still image.");
  }
  if (typeof input.caption !== "undefined" && (typeof input.caption !== "string" || input.caption.trim().length > 1000)) {
    throw new Error("Job photo captions must be 1,000 characters or fewer.");
  }
  if (input.category !== undefined && !validJobSyncPhotoCategory(input.category)) {
    throw new Error("Choose Before, After, Damage, or Other for the Job photo category.");
  }
  if (input.displayOrder !== undefined && !validJobSyncPhotoDisplayOrder(input.displayOrder)) {
    throw new Error("A valid canonical Job photo display order is required.");
  }
  if (typeof input.base64 !== "string" || input.base64.length < 16 || input.base64.length > 21_000_000) {
    throw new Error("The selected Job photo could not be read as base64.");
  }
  // Accept raw base64 or a truthful matching data URI, never an arbitrary/mislabeled prefix.
  const prefix = `data:${input.contentType};base64,`;
  const payload = input.base64.startsWith(prefix) ? input.base64.slice(prefix.length) : input.base64;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
    throw new Error("The selected Job photo could not be read as base64.");
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const encodedLength = payload.length - padding;
  if (encodedLength % 4 === 1 || (padding > 0 && (payload.length % 4 !== 0 || encodedLength % 4 !== 4 - padding))) {
    throw new Error("The selected Job photo could not be read as base64.");
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const last = alphabet.indexOf(payload[encodedLength - 1]);
  if ((encodedLength % 4 === 2 && (last & 15) !== 0) || (encodedLength % 4 === 3 && (last & 3) !== 0)) {
    throw new Error("The selected Job photo could not be read as base64.");
  }
  const byteLength = Math.floor(encodedLength * 3 / 4);
  if (byteLength > 15 * 1024 * 1024) throw new Error("Job photos must be 15 MiB or smaller.");
  const bytes: number[] = [];
  let bits = 0;
  let accumulator = 0;
  for (let index = 0; index < Math.min(encodedLength, 16); index++) {
    accumulator = (accumulator << 6) | alphabet.indexOf(payload[index]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 255);
      accumulator &= (1 << bits) - 1;
    }
  }
  const matches = input.contentType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : input.contentType === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    : [82, 73, 70, 70].every((byte, index) => bytes[index] === byte) && [87, 69, 66, 80].every((byte, index) => bytes[index + 8] === byte);
  if (!matches) throw new Error("The selected Job photo bytes do not match its JPEG, PNG, or WebP type.");
}

/** One POST only: ambiguous failures require canonical Job refresh, never blind mutation retry. */
export async function uploadJobSyncCompanyJobPhoto(
  token: string,
  jobId: number,
  input: JobSyncJobPhotoUploadInput,
): Promise<JobSyncJobPhotoUploadResponse> {
  validCompanyJobId(jobId);
  requireJobSyncMutationToken(token);
  validateJobSyncPhotoUpload(input);
  const result = asRecord(await requestJson(`/api/mobile/v1/jobs/${jobId}/photos`, {
    method: "POST", headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ contentType: input.contentType, base64: input.base64,
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
    }),
  }, 201));
  const photo = asRecord(result?.photo);
  const imageUrl = normalizeJobSyncPhotoUrl(photo?.imageUrl);
  const expectedCaption = input.caption?.trim() || null;
  if (!photo || typeof photo.id !== "number" || !positiveJobSyncId(photo.id)
    || typeof photo.uploadedByUserId !== "number" || !positiveJobSyncId(photo.uploadedByUserId)
    || !imageUrl || photo.caption !== expectedCaption || !validJobSyncPhotoReadMetadata(photo)
    || (input.category !== undefined && photo.category !== input.category)
    || (input.displayOrder !== undefined && photo.displayOrder !== input.displayOrder)) {
    throw new JobSyncApiError("The backend did not acknowledge this Job photo. Refresh the Job before trying again.", null, "INVALID_RESPONSE");
  }
  return { photo: { id: photo.id, imageUrl, caption: expectedCaption, uploadedByUserId: photo.uploadedByUserId, ...jobSyncPhotoReadMetadata(photo) } };
}

/** Exact unpublished 2818bb72 private-only versioned manager route; no retry/downgrade. */
export async function updateJobSyncCompanyJobPrivateNotes(
  token: string, jobId: number, privateNotes: string, expectedUpdatedAt: string,
): Promise<unknown> {
  validCompanyJobId(jobId);
  requireJobSyncMutationToken(token);
  const version = normalizeCompanyJobPrivateNotesVersion(expectedUpdatedAt);
  if (typeof privateNotes !== "string" || privateNotes.length > 4000 || !version) {
    throw new Error("A valid private note and current Job version are required.");
  }
  return requestJson(`/api/mobile/v1/company/jobs/${jobId}/private-notes`, {
    method: "PATCH", headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ privateNotes, expectedUpdatedAt: version }),
  }, 200);
}

/** Existing unpublished Company address route, not a customer-profile/legacy mutation. */
export const updateJobSyncCompanyJobAddress: CompanyJobAddressWriter = async (token, jobId, input) => {
  validCompanyJobId(jobId);
  requireJobSyncMutationToken(token);
  const line2 = (input as typeof input & { addressLine2?: unknown }).addressLine2;
  if (line2 !== undefined && (typeof line2 !== "string" || line2.trim())) throw new Error("Address line 2 cannot be saved by the verified backend. Leave it empty before saving.");
  const payload = createCompanyJobAddressPayload({
    addressLine1: input.addressLine1, city: input.city ?? "",
    region: input.region ?? "", postalCode: input.postalCode ?? "",
  }, input.expectedUpdatedAt);
  return requestJson(`${COMPANY_JOBS_PATH}/${jobId}/address`, {
    method: "PATCH", headers: createJobSyncBearerHeaders(token), body: JSON.stringify(payload),
  }, 200);
};

/** Removes a persisted photo from the Job, not a guarantee of physical media erasure. */
export async function deleteJobSyncCompanyJobPhoto(token: string, jobId: number, photoId: number): Promise<{ success: true }> {
  validCompanyJobId(jobId);
  requireJobSyncMutationToken(token);
  if (!Number.isSafeInteger(photoId) || photoId <= 0) throw new Error("A valid persisted Job photo identifier is required.");
  const result = asRecord(await requestJson(`/api/mobile/v1/jobs/${jobId}/photos/${photoId}`, {
    method: "DELETE", headers: createJobSyncBearerHeaders(token),
  }, 200));
  if (result?.success !== true) {
    throw new JobSyncApiError("The backend did not acknowledge Job photo removal. Refresh the Job before trying again.", null, "INVALID_RESPONSE");
  }
  return { success: true };
}

export async function updateJobSyncCompanyJobStatus(token: string, jobId: number, input: { status: JobSyncFieldStatus; expectedUpdatedAt?: string | null }) {
  validCompanyJobId(jobId);
  if (!token.trim() || !["en_route", "on_site", "completed"].includes(input.status)) throw new Error("A valid Company field status and session are required.");
  return patchJobSyncCompanyJobStatus(token, jobId, input);
}

/** A separate management action, never a fourth field-progress control. */
export async function cancelJobSyncCompanyJob(token: string, jobId: number, input: { expectedUpdatedAt: string }) {
  validCompanyJobId(jobId);
  if (!token.trim() || !serverInstant(input.expectedUpdatedAt)) throw new Error("A fresh Company Job version and session are required for management cancellation.");
  return patchJobSyncCompanyJobStatus(token, jobId, { status: "cancelled", expectedUpdatedAt: input.expectedUpdatedAt });
}

async function patchJobSyncCompanyJobStatus<T extends JobSyncFieldStatus | "cancelled">(token: string, jobId: number, input: { status: T; expectedUpdatedAt?: string | null }) {
  const result = asRecord(await requestJson(`/api/mobile/v1/jobs/${jobId}/status`, {
    method: "PATCH", headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ status: input.status, ...(input.expectedUpdatedAt ? { expectedUpdatedAt: input.expectedUpdatedAt } : {}) }),
  }));
  if (result?.success !== true || result.status !== input.status) throw new JobSyncApiError("The backend did not acknowledge Job progress. Refresh before retrying.", null, "INVALID_RESPONSE");
  return { success: true as const, status: input.status };
}

export type JobSyncCompanyJobInvoiceAcknowledgment = {
  success: true;
  publicUrl: string;
  /** Effective truthful state; email's compatibility sent alias is never delivery truth. */
  status: string | null;
  communicationState: string | null;
  channel: "email" | "sms";
  isDelivered: boolean;
  /** Backend-reported recipient; reservation-collision agreement is not yet certified. */
  sentTo: string | null;
};

// Backend 16a57f2e companyCommunicationService canonical ledger enum.
const INVOICE_COMMUNICATION_STATES = new Set(["queued", "sending", "provider_accepted", "delivered", "failed", "bounced", "complained", "suppressed", "cancelled"]);

function invoiceCommunicationState(value: unknown): string | null {
  const state = firstString(value);
  return state && INVOICE_COMMUNICATION_STATES.has(state) ? state : null;
}

export async function sendJobSyncCompanyJobInvoice(token: string, jobId: number, input: { method: "email" | "sms"; resend?: boolean; recipientEmail?: string }): Promise<JobSyncCompanyJobInvoiceAcknowledgment> {
  validCompanyJobId(jobId);
  requireJobSyncMutationToken(token);
  const options = createCompanyJobInvoiceOptions(input.method, input.resend ?? false, input.recipientEmail);
  const result = asRecord(await requestJson(`/api/mobile/v1/jobs/${jobId}/invoice`, {
    method: "POST", headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ method: options.method, ...(input.resend !== undefined ? { resend: options.resend } : {}),
      ...(options.recipientEmail !== undefined ? { recipientEmail: options.recipientEmail } : {}) }),
  }));
  if (result?.channel !== undefined && result.channel !== options.method) throw new JobSyncApiError("The backend returned a different invoice delivery channel. Review delivery before retrying.", null, "INVALID_RESPONSE");
  const publicUrl = firstString(result?.publicUrl);
  if (result?.success !== true || !publicUrl) throw new JobSyncApiError("The backend did not confirm the invoice request.", null, "INVALID_RESPONSE");
  const communicationState = invoiceCommunicationState(result.communicationState);
  const compatibilityState = firstString(result.status);
  // Present but malformed ledger state cannot fall back to a success alias.
  // Email without a ledger may retain non-delivery states, never sent/delivered.
  const status = result.communicationState !== undefined ? communicationState
    : input.method === "sms" && compatibilityState === "sent" ? "sent"
    : input.method === "email" && compatibilityState === "delivered" ? null
    : invoiceCommunicationState(compatibilityState);
  return { success: true, publicUrl, status, communicationState, channel: input.method, isDelivered: status === "delivered",
    sentTo: normalizeCompanyJobInvoiceSentTo(result.sentTo, input.method) };
}

/** Persists one atomic Company Job time/lane intent under a fresh server version. */
export const updateJobSyncCompanyJobSchedule: CompanyJobScheduleWriter = async (
  token, jobId, input: CompanyJobScheduleMutation,
): Promise<unknown> => {
  validCompanyJobId(jobId);
  requireJobSyncMutationToken(token);
  if (!input || !serverInstant(input.expectedUpdatedAt)
    || !serverInstant(input.scheduledStartAt) || !serverInstant(input.scheduledEndAt)
    || Date.parse(input.scheduledEndAt) <= Date.parse(input.scheduledStartAt)
    || (input.assignedUserId !== null && (typeof input.assignedUserId !== "number"
      || !positiveJobSyncId(input.assignedUserId)))) {
    throw new Error("A fresh version, complete schedule and verified assignment are required.");
  }
  return requestJson(`${COMPANY_JOBS_PATH}/${jobId}/schedule`, {
    method: "PATCH", headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      assignedUserId: input.assignedUserId,
      expectedUpdatedAt: input.expectedUpdatedAt,
    }),
  });
};

/** Persists a Company Job's Team Member lane, including explicit unassignment. */
export async function updateJobSyncCompanyJobAssignment(
  token: string,
  jobId: number,
  assignedUserId: number | null,
  expectedUpdatedAt?: string | null,
) {
  validCompanyJobId(jobId);
  if (assignedUserId !== null && (!Number.isSafeInteger(assignedUserId) || assignedUserId <= 0)) {
    throw new Error("Home Service Connected returned an invalid Team Member identifier.");
  }
  return requestJson(`${COMPANY_JOBS_PATH}/${jobId}/assignment`, {
    method: "PATCH",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({
      assignedUserId,
      ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    }),
  });
}

export async function getJobSyncCompanySettings(token: string, options?: { requireTimezone: boolean }): Promise<JobSyncCompanySettings> {
  const payload = await requestJson(COMPANY_SETTINGS_PATH, {
    method: "GET",
    headers: createJobSyncBearerHeaders(token),
  });
  if (options?.requireTimezone) {
    const root = asRecord(payload);
    const data = firstRecord(root?.data, root) ?? {};
    const company = firstRecord(data.company, root?.company) ?? {};
    const timezone = firstString(company.timezone, company.timeZone);
    if (!timezone) throw new JobSyncApiError("The Company timezone is missing. Refresh Company settings before creating this Job.", null, "MISSING_COMPANY_TIMEZONE");
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); }
    catch { throw new JobSyncApiError("The Company timezone is invalid. Refresh Company settings before creating this Job.", null, "INVALID_COMPANY_TIMEZONE"); }
  }
  const settings = normalizeJobSyncCompanySettings(payload);
  if (!settings) throw new Error("Home Service Connected returned invalid Company settings.");
  return settings;
}

export async function getJobSyncCompanyCustomers(token: string): Promise<JobSyncCompanyCustomer[]> {
  const customers = new Map<number, JobSyncCompanyCustomer>();
  const search = new URLSearchParams();
  const cursors = new Set<string>();
  for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
    const payload = asRecord(await requestJson(`${COMPANY_CUSTOMERS_PATH}${search.size ? `?${search.toString()}` : ""}`, {
      method: "GET", headers: createJobSyncBearerHeaders(token),
    })) ?? {};
    if (!Array.isArray(payload.customers)) throw new JobSyncApiError("Could not verify the Company customer list. Refresh to try again.", null, "INVALID_RESPONSE");
    for (const customer of normalizeJobSyncCompanyCustomers(payload)) customers.set(customer.id, customer);
    const next = asRecord(payload.page)?.nextCursor;
    if (next === null || next === undefined) return [...customers.values()];
    if (typeof next !== "string" || !next || next.length > 4096 || cursors.has(next)) throw new JobSyncApiError("The Company customer pagination could not be verified. Refresh to try again.", null, "INVALID_PAGINATION");
    cursors.add(next);
    search.set("cursor", next);
  }
  throw new JobSyncApiError("The Company customer list exceeds this refresh limit. No partial customer list was accepted.", null, "CUSTOMER_REFRESH_LIMIT");
}

export async function getJobSyncCompanyCustomer(token: string, customerId: number): Promise<JobSyncCompanyCustomer & { region: string | null; postalCode: string | null }> {
  if (!token.trim() || !positiveJobSyncId(customerId)) throw new Error("Choose an existing Company customer.");
  const payload = asRecord(await requestJson(`${COMPANY_CUSTOMERS_PATH}/${customerId}`, {
    method: "GET", headers: createJobSyncBearerHeaders(token),
  }));
  const row = asRecord(payload?.customer);
  const customer = normalizeJobSyncCompanyCustomers({ customers: row ? [row] : [] })[0];
  if (!customer || customer.id !== customerId) throw new JobSyncApiError("The selected Company customer could not be verified. Choose the customer again.", null, "INVALID_RESPONSE");
  return { ...customer, region: firstString(row?.region), postalCode: firstString(row?.postalCode) };
}

export function createJobSyncCompanyMemberUpdatePayload(input: JobSyncCompanyMemberUpdateInput) {
  return {
    ...(input.firstName !== undefined ? { firstName: input.firstName.trim() } : {}),
    ...(input.lastName !== undefined ? { lastName: input.lastName.trim() } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.email?.trim() ? { email: input.email.trim().toLowerCase() } : {}),
    ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
    ...(input.city?.trim() ? { city: input.city.trim() } : {}),
    ...(input.availability ? { availability: input.availability } : {}),
    ...(typeof input.calendarEligibleOverride === "boolean" ? { calendarEligibleOverride: input.calendarEligibleOverride } : {}),
  };
}

function normalizeCompanyRole(value: string | null): JobSyncCompanyRole | null {
  const normalized = value?.toLowerCase().replace(/[ -]+/g, "_") ?? "";
  if (normalized === "admin" || normalized === "company_admin") return "owner";
  if (normalized === "operations_manager" || normalized === "ops_manager") return "dispatcher";
  if (normalized === "detailer" || normalized === "field_technician") return "technician";
  return COMPANY_ROLES.has(normalized) ? normalized as JobSyncCompanyRole : null;
}

function normalizePlatformRole(value: string | null): JobSyncPlatformRole | null {
  const normalized = value?.toLowerCase().replace(/[ -]+/g, "_") ?? "";
  if (normalized === "admin" || normalized === "platform_admin") return "owner";
  if (normalized === "support") return "customer_support";
  return PLATFORM_ROLES.has(normalized) ? normalized as JobSyncPlatformRole : null;
}

export function normalizeJobSyncMobileSession(payload: unknown, token: string): JobSyncNativeSession | null {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const session = firstRecord(data.session, root?.session, data) ?? {};
  const profile = firstRecord(session.profile, data.profile, root?.profile, session) ?? {};
  const user = firstRecord(profile.user, session.user, data.user, root?.user, profile) ?? {};
  const company = firstRecord(profile.company, session.company, data.company, root?.company);
  const accountType = firstString(
    profile.accountType,
    session.accountType,
    data.accountType,
    root?.accountType,
    profile.portal,
    session.portal,
    data.portal,
    root?.portal,
    profile.type,
  )?.toLowerCase().replace(/[ -]+/g, "_");
  const rawRole = firstString(user.role, user.platformRole, profile.role, profile.platformRole, session.role);
  const platform = accountType === "platform_admin" || accountType === "platform" || Boolean(user.platformRole ?? profile.platformRole);
  const role = platform ? normalizePlatformRole(rawRole) : normalizeCompanyRole(rawRole);
  const userId = firstNumber(user.id, user.userId, user.ownerId, profile.userId, profile.ownerId, session.userId, session.ownerId);
  if (!role || !userId) return null;

  const normalizedUser = {
    id: userId,
    name: firstString(user.name, user.displayName, user.fullName, profile.name, profile.displayName) ?? "Home Service Connection user",
    email: firstString(user.email, profile.email),
    role,
    memberId: firstString(user.memberId, user.identifier, user.ownerIdentifier, profile.memberId, profile.identifier) ?? undefined,
  };

  if (platform) {
    return { token, portal: "platform", user: normalizedUser };
  }

  // Missing is unavailable, null is inherited/unset, and malformed is rejected.
  // Do not confer a Company capability on a platform session or use roster defaults.
  if (user.calendarEligible !== undefined && rawNullableBoolean(user.calendarEligible) === undefined) return null;
  if (user.paymentCollectionEnabled !== undefined && rawNullableBoolean(user.paymentCollectionEnabled) === undefined) return null;
  const companyId = firstNumber(company?.id, company?.companyId, profile.companyId, session.companyId, user.companyId);
  if (!companyId || !company) return null;
  return {
    token,
    portal: "company",
    user: {
      ...normalizedUser,
      ...(user.calendarEligible !== undefined ? { calendarEligible: rawNullableBoolean(user.calendarEligible) } : {}),
      ...(user.paymentCollectionEnabled !== undefined ? { paymentCollectionEnabled: rawNullableBoolean(user.paymentCollectionEnabled) } : {}),
    },
    company: {
      id: companyId,
      name: firstString(company.name, company.companyName, profile.companyName) ?? "Company workspace",
      slug: firstString(company.slug, profile.companySlug) ?? "",
      logoUrl: firstString(company.logoUrl, company.logo_url),
      primaryColor: firstString(company.primaryColor, company.primary_color),
      accentColor: firstString(company.accentColor, company.accent_color),
    },
  };
}

export async function getJobSyncMobileSession(token: string) {
  const payload = await requestJson(SESSION_PATH, {
    method: "GET",
    headers: createJobSyncBearerHeaders(token),
  });
  const session = normalizeJobSyncMobileSession(payload, token);
  if (!session) throw new Error("Home Service Connected returned an unsupported mobile session profile.");
  return session;
}

/** Returns the raw self profile so the caller can validate exact identity, role, and Boolean acknowledgment. */
export async function updateJobSyncCompanyOwnFieldwork(token: string, input: { calendarEligibleOverride: boolean }): Promise<unknown> {
  requireJobSyncMutationToken(token);
  if (!asRecord(input) || typeof input.calendarEligibleOverride !== "boolean") {
    throw new Error("An explicit Boolean field-scheduling override is required.");
  }
  return requestJson(COMPANY_PROFILE_PATH, {
    method: "PATCH", headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ calendarEligibleOverride: input.calendarEligibleOverride }),
  }, 200);
}

/** Disables only the authenticated Company Team Member's own mobile account. */
export async function deleteJobSyncMobileAccount(token: string) {
  const payload = asRecord(await requestJson(ACCOUNT_PATH, {
    method: "DELETE",
    headers: createJobSyncBearerHeaders(token),
  }));
  if (payload?.deleted !== true) {
    throw new Error("Home Service Connected could not confirm that this account was deleted.");
  }
  return { deleted: true as const };
}

export function normalizeJobSyncCompanyRoster(payload: unknown, expectedCompanyId: number): JobSyncCompanyRoster | null {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const company = firstRecord(data.company, root?.company);
  const companyId = firstNumber(company?.id, company?.companyId, data.companyId, root?.companyId);
  if (!company || companyId !== expectedCompanyId) return null;

  const rawMembers = Array.isArray(data.members) ? data.members : Array.isArray(root?.members) ? root.members : [];
  const members = rawMembers.flatMap((value) => {
    const member = asRecord(value);
    const id = firstNumber(member?.id, member?.userId, member?.memberId);
    const name = firstString(member?.name, member?.displayName, member?.fullName, [member?.firstName, member?.lastName].filter(Boolean).join(" "));
    if (!member || !id || !name || !isActiveMember(member.isActive ?? member.is_active)) return [];
    return [{
      id,
      name,
      role: firstString(member.role, member.memberRole) ?? "team_member",
      isActive: true,
      calendarEligible: isCalendarEligible(member.calendarEligible ?? member.calendar_eligible),
      ...(rawNullableBoolean(member.calendarEligibleOverride) !== undefined ? { calendarEligibleOverride: rawNullableBoolean(member.calendarEligibleOverride) } : {}),
    }];
  });

  return {
    company: { id: companyId, name: firstString(company.name, company.companyName) ?? "Company workspace" },
    members,
  };
}

export async function getJobSyncCompanyMembers(token: string, expectedCompanyId: number) {
  const payload = await requestJson(COMPANY_TEAM_MEMBERS_PATH, {
    method: "GET",
    headers: createJobSyncBearerHeaders(token),
  });
  const roster = normalizeJobSyncCompanyRoster(payload, expectedCompanyId);
  if (!roster) throw new Error("Home Service Connected returned an invalid Company team roster.");
  return roster;
}

export function normalizeJobSyncCompanyMemberDetail(payload: unknown, expectedMemberId: number): JobSyncCompanyMemberDetail | null {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const member = firstRecord(data.member, root?.member, data.profile) ?? {};
  const id = firstNumber(member.id, member.userId, member.memberId);
  if (id !== expectedMemberId || !isActiveMember(member.isActive ?? member.is_active)) return null;

  const firstName = firstString(member.firstName, member.first_name) ?? "";
  const lastName = firstString(member.lastName, member.last_name) ?? "";
  const name = firstString(member.name, member.displayName, member.fullName, `${firstName} ${lastName}`.trim());
  if (!name) return null;
  const vehicle = firstRecord(member.assignedVehicle, member.assigned_vehicle, member.vehicle);

  return {
    id,
    name,
    memberId: firstString(member.memberId, member.member_id, member.identifier),
    firstName: firstName || name.split(/\s+/)[0] || "",
    lastName: lastName || name.split(/\s+/).slice(1).join(" "),
    email: firstString(member.email),
    phone: firstString(member.phone, member.phoneNumber),
    city: firstString(member.city),
    hireDate: firstString(member.hireDate, member.hire_date, member.createdAt, member.created_at),
    role: firstString(member.role, member.memberRole) ?? "team_member",
    availability: firstString(member.availability),
    workDays: stringList(member.workDays ?? member.work_days ?? member.customWorkDays),
    hourlyRate: nullableNumber(member.hourlyRate, member.hourly_rate),
    upsellBonusPct: nullableNumber(member.upsellBonusPct, member.upsell_bonus_pct),
    mysteryBonusStatus: firstString(member.mysteryBonusStatus, member.mystery_bonus_status),
    isActive: true,
    // The existing detail route calls its raw individual override calendarEligible.
    ...(rawNullableBoolean(member.calendarEligibleOverride !== undefined ? member.calendarEligibleOverride : member.calendarEligible) !== undefined
      ? { calendarEligibleOverride: rawNullableBoolean(member.calendarEligibleOverride !== undefined ? member.calendarEligibleOverride : member.calendarEligible) } : {}),
    assignedVehicle: vehicle ? {
      id: nullableNumber(vehicle.id, vehicle.vehicleId),
      name: firstString(vehicle.name, vehicle.vehicleName, vehicle.unitNumber) ?? "Assigned vehicle",
      shift: firstString(vehicle.shift, vehicle.shiftName),
      assignedAt: firstString(vehicle.assignedAt, vehicle.assigned_at),
    } : null,
  };
}

export async function getJobSyncCompanyMemberDetail(token: string, memberId: number) {
  if (!Number.isInteger(memberId) || memberId <= 0) {
    throw new Error("Home Service Connected returned an invalid Team Member identifier.");
  }
  const payload = await requestJson(`${COMPANY_TEAM_MEMBERS_PATH}/${memberId}`, {
    method: "GET",
    headers: createJobSyncBearerHeaders(token),
  });
  const detail = normalizeJobSyncCompanyMemberDetail(payload, memberId);
  if (!detail) throw new Error("Home Service Connected returned an invalid Team Member profile.");
  return detail;
}

export async function updateJobSyncCompanyMember(
  token: string,
  memberId: number,
  input: JobSyncCompanyMemberUpdateInput,
) {
  if (!Number.isInteger(memberId) || memberId <= 0) {
    throw new Error("Home Service Connected returned an invalid Team Member identifier.");
  }
  return requestJson(`${COMPANY_TEAM_MEMBERS_PATH}/${memberId}`, {
    method: "PATCH",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify(createJobSyncCompanyMemberUpdatePayload(input)),
  });
}

export async function loginJobSyncMobile(input: { accountType: JobSyncAccountType; email: string; password: string }) {
  const payload = await requestJson(LOGIN_PATH, {
    method: "POST",
    body: JSON.stringify(createJobSyncMobileLoginPayload(input)),
  });
  const token = extractJobSyncMobileToken(payload);
  if (!token) throw new Error("Home Service Connected did not return a mobile session token.");
  return getJobSyncMobileSession(token);
}

export type HomeServiceConnectedTimeState = {
  isClockedIn: boolean;
  clockInAt: string | null;
  activeBreak: { isActive: boolean; startedAt: string | null } | null;
};

export type HomeServiceConnectedTimeRecord = {
  id: number;
  memberName: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  totalHours: number | null;
};

function normalizeHomeServiceConnectedTimeRecord(value: unknown): HomeServiceConnectedTimeRecord | null {
  const record = asRecord(value);
  const id = nullableNumber(record?.id, record?.recordId, record?.record_id);
  const date = firstString(record?.date, record?.businessDate, record?.business_date);
  if (!record || !id || !date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  return {
    id,
    memberName: firstString(record.memberName, record.member_name, record.fullName, record.full_name, record.name) ?? "Team Member",
    date: date.slice(0, 10),
    clockIn: firstString(record.clockIn, record.clock_in, record.clockInAt, record.clock_in_at),
    clockOut: firstString(record.clockOut, record.clock_out, record.clockOutAt, record.clock_out_at),
    breakStart: firstString(record.breakStart, record.break_start),
    breakEnd: firstString(record.breakEnd, record.break_end),
    totalHours: nullableNumber(record.totalHours, record.total_hours),
  };
}

/** Normalizes time records returned by the protected Company reporting route. */
export function normalizeHomeServiceConnectedTimesheets(payload: unknown): HomeServiceConnectedTimeRecord[] {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const records = Array.isArray(data.records) ? data.records : Array.isArray(root?.records) ? root.records : [];
  return records
    .map(normalizeHomeServiceConnectedTimeRecord)
    .filter((record): record is HomeServiceConnectedTimeRecord => Boolean(record));
}

/** Reads time records from the bearer-authenticated, Company-scoped API. */
export async function getHomeServiceConnectedTimesheets(
  token: string,
  input: { start: string; end: string; memberId?: number },
): Promise<HomeServiceConnectedTimeRecord[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start) || !/^\d{4}-\d{2}-\d{2}$/.test(input.end) || input.start > input.end) {
    throw new Error("A valid time-reporting date range is required.");
  }
  if (input.memberId !== undefined && (!Number.isSafeInteger(input.memberId) || input.memberId <= 0)) {
    throw new Error("Home Service Connected returned an invalid Team Member identifier.");
  }
  const query = new URLSearchParams({ start: input.start, end: input.end });
  if (input.memberId !== undefined) query.set("memberId", String(input.memberId));
  return normalizeHomeServiceConnectedTimesheets(await requestJson(`${TIME_TIMESHEETS_PATH}?${query.toString()}`, {
    method: "GET",
    headers: createJobSyncBearerHeaders(token),
  }));
}

export type HomeServiceConnectedTimeOffRequest = {
  requestId: string;
  startDate: string;
  endDate: string;
  totalDaysRequested: number;
  daysNoticeGiven: number;
  status: "pending" | "approved" | "denied";
  reason: string | null;
  managerNote: string | null;
};

function normalizeHomeServiceConnectedTimeOffRequest(value: unknown): HomeServiceConnectedTimeOffRequest | null {
  const request = asRecord(value);
  if (!request) return null;
  const id = firstString(request.requestId, firstNumber(request.id, request.request_id)?.toString());
  const startDate = firstString(request.startDate, request.start_date);
  const endDate = firstString(request.endDate, request.end_date);
  const status = firstString(request.status, request.requestStatus, request.request_status)?.toLowerCase();
  if (!id || !startDate || !endDate || !status || !["pending", "approved", "denied"].includes(status)) return null;
  return {
    requestId: id,
    startDate: startDate.slice(0, 10),
    endDate: endDate.slice(0, 10),
    totalDaysRequested: nullableNumber(request.totalDaysRequested) ?? ((nullableNumber(request.hoursRequested, request.hours_requested) ?? 0) / 8),
    daysNoticeGiven: nullableNumber(request.daysNoticeGiven, request.days_notice_given) ?? 0,
    status: status as HomeServiceConnectedTimeOffRequest["status"],
    reason: firstString(request.reason),
    managerNote: firstString(request.managerNote, request.reviewerNote, request.reviewer_note),
  };
}

export function normalizeHomeServiceConnectedTimeOff(payload: unknown) {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const requests = Array.isArray(data.requests) ? data.requests : Array.isArray(root?.requests) ? root.requests : [];
  return requests.map(normalizeHomeServiceConnectedTimeOffRequest).filter((request): request is HomeServiceConnectedTimeOffRequest => Boolean(request));
}

export async function getHomeServiceConnectedTimeOff(token: string) {
  const payload = await requestJson(COMPANY_TIME_OFF_PATH, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  return normalizeHomeServiceConnectedTimeOff(payload);
}

export async function createHomeServiceConnectedTimeOff(token: string, input: { startDate: string; endDate: string; hoursRequested: number; requestType: "vacation" | "sick" | "personal" | "other"; reason?: string }) {
  return requestJson(COMPANY_TIME_OFF_PATH, {
    method: "POST",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({
      startDate: input.startDate,
      endDate: input.endDate,
      hoursRequested: input.hoursRequested,
      requestType: input.requestType,
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
    }),
  });
}

export type HomeServiceConnectedPriceBookService = {
  serviceId: string;
  name: string;
  emoji: string;
  description: string;
  features: string[];
  vehiclePrices: Record<string, number>;
  imageUrl: string | null;
  sortOrder: number;
  serviceTypeId: number | null;
  basePrice?: number;
  defaultDurationMinutes?: number | null;
  defaultAssignedUserId?: number | null;
  pricingUnit?: string | null;
};

export type HomeServiceConnectedChatGroup = {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  isActive: boolean;
  memberIds: string[];
};

export type HomeServiceConnectedChatMessage = {
  id: string;
  senderName: string;
  senderId: string | null;
  text: string;
  createdAt: string;
};

export type HomeServiceConnectedChatGroupCreateInput = {
  name: string;
  description?: string;
  icon?: string;
  memberIds?: number[];
};

export type HomeServiceConnectedCommunityCategory = {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type HomeServiceConnectedCommunityPost = {
  id: number;
  categoryId: number | null;
  categoryName: string | null;
  categoryIcon: string | null;
  authorUserId: number;
  authorName: string;
  title: string;
  body: string;
  mediaUrl: string | null;
  isPinned: boolean;
  commentCount: number;
  likeCount: number;
  viewerLiked: boolean;
  createdAt: string;
};

export type HomeServiceConnectedCommunityComment = {
  id: number;
  authorUserId: number;
  authorName: string;
  body: string;
  createdAt: string;
};

export type HomeServiceConnectedDirectMember = {
  id: number;
  name: string;
  role: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
};

function parseJsonRecord(value: unknown) {
  if (typeof value === "string") {
    try { return asRecord(JSON.parse(value)); } catch { return null; }
  }
  return asRecord(value);
}

function priceMap(value: unknown) {
  const record = parseJsonRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, rawValue]) => {
      const amount = nullableNumber(rawValue);
      return amount !== null && amount >= 0 ? [[key, amount]] : [];
    }),
  );
}

function priceBookFeatures(value: unknown) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return stringList(parsed);
    } catch { /* The platform may return a simple comma-separated feature string. */ }
  }
  return stringList(value);
}

function isActivePriceBookService(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return !["false", "0", "no", "inactive", "archived", "disabled"].includes(normalized);
  }
  return isActiveMember(value);
}

function normalizeHomeServiceConnectedPriceBookService(value: unknown): HomeServiceConnectedPriceBookService | null {
  const service = asRecord(value);
  if (!service || !isActivePriceBookService(service.isActive ?? service.is_active ?? service.is_active_pb ?? service.status)) return null;
  const serviceId = firstString(service.serviceId, service.service_id, service.id) ?? nullableNumber(service.id)?.toString();
  const name = firstString(service.name, service.serviceName, service.service_name, service.title);
  if (!serviceId || !name) return null;
  return {
    serviceId,
    name,
    emoji: firstString(service.emoji, service.icon) ?? "🛠️",
    description: firstString(service.description, service.details) ?? "",
    features: priceBookFeatures(service.features),
    vehiclePrices: priceMap(service.vehiclePrices ?? service.vehicle_prices ?? service.prices),
    imageUrl: firstString(service.imageUrl, service.image_url, service.image_url_pb),
    sortOrder: nullableNumber(service.sortOrder, service.orderIndex, service.sort_order, service.sort_order_pb) ?? 0,
    serviceTypeId: nullableNumber(service.serviceTypeId, service.service_type_id),
    ...(normalizeCompanyJobBillingAmount(service.basePrice) !== null ? { basePrice: normalizeCompanyJobBillingAmount(service.basePrice)! } : {}),
    ...(service.defaultDurationMinutes !== undefined ? { defaultDurationMinutes: nullableNumber(service.defaultDurationMinutes) } : {}),
    ...(service.defaultAssignedUserId !== undefined ? { defaultAssignedUserId: positiveJobSyncId(service.defaultAssignedUserId) } : {}),
    ...(service.pricingUnit !== undefined ? { pricingUnit: firstString(service.pricingUnit) } : {}),
  };
}

export function normalizeHomeServiceConnectedPriceBook(payload: unknown) {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const services = Array.isArray(data.services)
    ? data.services
    : Array.isArray(data.items)
      ? data.items
      : Array.isArray(root?.services)
        ? root.services
        : Array.isArray(root?.items)
          ? root.items
          : [];
  return services
    .map(normalizeHomeServiceConnectedPriceBookService)
    .filter((service): service is HomeServiceConnectedPriceBookService => Boolean(service))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
}

export async function getHomeServiceConnectedPriceBook(token: string) {
  const payload = await requestJson(COMPANY_PRICE_BOOK_PATH, {
    method: "GET",
    headers: createJobSyncBearerHeaders(token),
  });
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root);
  if (!Array.isArray(data?.services) && !Array.isArray(data?.items) && !Array.isArray(root?.services) && !Array.isArray(root?.items)) {
    throw new JobSyncApiError("The Company Price Book response could not be verified. Tap Reload Services to try again.", null, "INVALID_PRICE_BOOK_RESPONSE");
  }
  return normalizeHomeServiceConnectedPriceBook(payload);
}

function normalizeHomeServiceConnectedChatGroup(value: unknown): HomeServiceConnectedChatGroup | null {
  const group = asRecord(value);
  if (!group) return null;
  const id = firstString(group.id, group.groupId, group.group_id, group.channelId, group.channel_id);
  const name = firstString(group.name, group.title, group.label);
  if (!id || !name) return null;
  return {
    id,
    name,
    description: firstString(group.description, group.subtitle),
    emoji: firstString(group.emoji, group.icon, group.iconEmoji) ?? "💬",
    isActive: isActiveMember(group.isActive ?? group.active ?? group.status),
    memberIds: stringList(group.memberIds ?? group.member_ids ?? group.members).map(String),
  };
}

export function normalizeHomeServiceConnectedChatGroups(payload: unknown) {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const groups = Array.isArray(data.groups) ? data.groups : Array.isArray(root?.groups) ? root.groups : Array.isArray(data.items) ? data.items : [];
  return groups.map(normalizeHomeServiceConnectedChatGroup).filter((group): group is HomeServiceConnectedChatGroup => Boolean(group?.isActive));
}

export async function getHomeServiceConnectedChatGroups(token: string) {
  const payload = await requestJson(COMPANY_CHAT_GROUPS_PATH, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  return normalizeHomeServiceConnectedChatGroups(payload);
}

export function createHomeServiceConnectedChatGroupPayload(input: HomeServiceConnectedChatGroupCreateInput) {
  const name = input.name.trim();
  if (!name) throw new Error("A group name is required.");
  const memberIds = Array.from(new Set(
    (input.memberIds ?? []).filter((memberId) => Number.isInteger(memberId) && memberId > 0),
  ));
  return {
    name,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.icon?.trim() ? { icon: input.icon.trim() } : {}),
    ...(memberIds.length ? { memberIds } : {}),
  };
}

export async function createHomeServiceConnectedChatGroup(token: string, input: HomeServiceConnectedChatGroupCreateInput) {
  return requestJson(COMPANY_CHAT_GROUPS_PATH, {
    method: "POST",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify(createHomeServiceConnectedChatGroupPayload(input)),
  });
}

export async function updateHomeServiceConnectedChatGroup(token: string, groupId: string, input: HomeServiceConnectedChatGroupCreateInput) {
  return requestJson(`${COMPANY_CHAT_GROUPS_PATH}/${encodeURIComponent(groupId)}`, {
    method: "PATCH",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify(createHomeServiceConnectedChatGroupPayload(input)),
  });
}

export async function updateHomeServiceConnectedChatGroupMembers(token: string, groupId: string, memberIds: number[]) {
  const activeMemberIds = Array.from(new Set(memberIds.filter((memberId) => Number.isInteger(memberId) && memberId > 0)));
  return requestJson(`${COMPANY_CHAT_GROUPS_PATH}/${encodeURIComponent(groupId)}/members`, {
    method: "PUT",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ memberIds: activeMemberIds }),
  });
}

export async function updateHomeServiceConnectedChatGroupStatus(token: string, groupId: string, isActive: boolean) {
  return requestJson(`${COMPANY_CHAT_GROUPS_PATH}/${encodeURIComponent(groupId)}/status`, {
    method: "PATCH",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ isActive }),
  });
}

export async function getHomeServiceConnectedGroupMessages(token: string, groupId: string) {
  const payload = await requestJson(`${COMPANY_CHAT_GROUPS_PATH}/${encodeURIComponent(groupId)}/messages`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const messages = Array.isArray(data.messages) ? data.messages : Array.isArray(root?.messages) ? root.messages : [];
  return messages.map((value) => {
    const message = asRecord(value) ?? {};
    return {
      id: firstString(message.id, message.messageId, message.message_id) ?? `${firstString(message.createdAt, message.created_at) ?? "message"}-${firstString(message.senderId, message.sender_id) ?? "sender"}`,
      senderName: firstString(message.senderName, message.sender_name, message.fullName, message.authorName) ?? "Team member",
      senderId: firstString(message.senderId, message.sender_id, message.employeeId),
      text: firstString(message.text, message.message, message.body, message.messageText) ?? "",
      createdAt: firstString(message.createdAt, message.created_at, message.sentAt) ?? new Date().toISOString(),
    } satisfies HomeServiceConnectedChatMessage;
  });
}

export async function sendHomeServiceConnectedGroupMessage(token: string, groupId: string, text: string) {
  const message = text.trim();
  if (!message) throw new Error("A message is required.");
  return requestJson(`${COMPANY_CHAT_GROUPS_PATH}/${encodeURIComponent(groupId)}/messages`, {
    method: "POST",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ message }),
  });
}

function strictBoolean(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function normalizeCommunityCategory(value: unknown): HomeServiceConnectedCommunityCategory | null {
  const category = asRecord(value);
  const id = nullableNumber(category?.id, category?.categoryId, category?.category_id);
  const name = firstString(category?.name, category?.label);
  if (!category || !id || !name) return null;
  return {
    id,
    name,
    description: firstString(category.description),
    icon: firstString(category.icon),
    sortOrder: nullableNumber(category.sortOrder, category.sort_order) ?? 0,
    isActive: isActiveMember(category.isActive ?? category.is_active ?? true),
  };
}

export function normalizeHomeServiceConnectedCommunityCategories(payload: unknown) {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const categories = Array.isArray(data.categories) ? data.categories : Array.isArray(root?.categories) ? root.categories : [];
  return categories
    .map(normalizeCommunityCategory)
    .filter((category): category is HomeServiceConnectedCommunityCategory => Boolean(category?.isActive));
}

function normalizeCommunityPost(value: unknown): HomeServiceConnectedCommunityPost | null {
  const post = asRecord(value);
  const id = nullableNumber(post?.id, post?.postId, post?.post_id);
  const authorUserId = nullableNumber(post?.authorUserId, post?.author_user_id);
  const authorName = firstString(post?.authorName, post?.author_name);
  const title = firstString(post?.title);
  const body = firstString(post?.body, post?.message);
  if (!post || !id || !authorUserId || !authorName || !title || !body) return null;
  return {
    id,
    categoryId: nullableNumber(post.categoryId, post.category_id),
    categoryName: firstString(post.categoryName, post.category_name),
    categoryIcon: firstString(post.categoryIcon, post.category_icon),
    authorUserId,
    authorName,
    title,
    body,
    mediaUrl: firstString(post.mediaUrl, post.media_url),
    isPinned: strictBoolean(post.isPinned ?? post.is_pinned),
    commentCount: nullableNumber(post.commentCount, post.comment_count) ?? 0,
    likeCount: nullableNumber(post.likeCount, post.like_count) ?? 0,
    viewerLiked: strictBoolean(post.viewerLiked ?? post.viewer_liked),
    createdAt: firstString(post.createdAt, post.created_at) ?? new Date().toISOString(),
  };
}

export function normalizeHomeServiceConnectedCommunityPosts(payload: unknown) {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const posts = Array.isArray(data.posts) ? data.posts : Array.isArray(root?.posts) ? root.posts : [];
  return posts.map(normalizeCommunityPost).filter((post): post is HomeServiceConnectedCommunityPost => Boolean(post));
}

function normalizeCommunityComment(value: unknown): HomeServiceConnectedCommunityComment | null {
  const comment = asRecord(value);
  const id = nullableNumber(comment?.id, comment?.commentId, comment?.comment_id);
  const authorUserId = nullableNumber(comment?.authorUserId, comment?.author_user_id);
  const authorName = firstString(comment?.authorName, comment?.author_name);
  const body = firstString(comment?.body, comment?.message);
  if (!comment || !id || !authorUserId || !authorName || !body) return null;
  return { id, authorUserId, authorName, body, createdAt: firstString(comment.createdAt, comment.created_at) ?? new Date().toISOString() };
}

export async function getHomeServiceConnectedCommunityCategories(token: string) {
  const payload = await requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/categories`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  return normalizeHomeServiceConnectedCommunityCategories(payload);
}

export async function createHomeServiceConnectedCommunityCategory(token: string, input: { name: string; description?: string; icon?: string; sortOrder?: number }) {
  const name = input.name.trim();
  if (!name) throw new Error("A category name is required.");
  return requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/categories`, {
    method: "POST",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ name, ...(input.description?.trim() ? { description: input.description.trim() } : {}), ...(input.icon?.trim() ? { icon: input.icon.trim() } : {}), ...(Number.isInteger(input.sortOrder) ? { sortOrder: input.sortOrder } : {}) }),
  });
}

export async function getHomeServiceConnectedCommunityPosts(token: string, categoryId?: number) {
  const query = categoryId ? `?categoryId=${encodeURIComponent(String(categoryId))}` : "";
  const payload = await requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/posts${query}`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  return normalizeHomeServiceConnectedCommunityPosts(payload);
}

export async function createHomeServiceConnectedCommunityPost(token: string, input: { categoryId?: number; title: string; body: string }) {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) throw new Error("A post title and message are required.");
  return requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/posts`, {
    method: "POST",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ ...(input.categoryId ? { categoryId: input.categoryId } : {}), title, body }),
  });
}

export async function getHomeServiceConnectedCommunityComments(token: string, postId: number) {
  const payload = await requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/posts/${encodeURIComponent(String(postId))}/comments`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const comments = Array.isArray(data.comments) ? data.comments : Array.isArray(root?.comments) ? root.comments : [];
  return comments.map(normalizeCommunityComment).filter((comment): comment is HomeServiceConnectedCommunityComment => Boolean(comment));
}

export async function createHomeServiceConnectedCommunityComment(token: string, postId: number, body: string) {
  const message = body.trim();
  if (!message) throw new Error("A comment is required.");
  return requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/posts/${encodeURIComponent(String(postId))}/comments`, { method: "POST", headers: createJobSyncBearerHeaders(token), body: JSON.stringify({ body: message }) });
}

export function toggleHomeServiceConnectedCommunityLike(token: string, postId: number) {
  return requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/posts/${encodeURIComponent(String(postId))}/like`, { method: "POST", headers: createJobSyncBearerHeaders(token) });
}

export async function getHomeServiceConnectedDirectMembers(token: string): Promise<HomeServiceConnectedDirectMember[]> {
  const payload = await requestJson(`${COMPANY_CHAT_DIRECT_PATH}/members`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const members = Array.isArray(data.members) ? data.members : Array.isArray(root?.members) ? root.members : [];
  return members.flatMap((value) => {
    const member = asRecord(value);
    const id = nullableNumber(member?.id, member?.userId);
    const name = firstString(member?.name, member?.fullName);
    return id && name ? [{ id, name, role: firstString(member?.role) ?? "Team Member", lastMessage: firstString(member?.lastMessage, member?.last_message), lastMessageAt: firstString(member?.lastMessageAt, member?.last_message_at) }] : [];
  });
}

export async function getHomeServiceConnectedDirectMessages(token: string, memberId: number) {
  const payload = await requestJson(`${COMPANY_CHAT_DIRECT_PATH}/${encodeURIComponent(String(memberId))}/messages`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const messages = Array.isArray(data.messages) ? data.messages : Array.isArray(root?.messages) ? root.messages : [];
  return messages.map((value) => {
    const message = asRecord(value) ?? {};
    return {
      id: firstString(message.id, message.messageId, message.message_id) ?? `${firstString(message.createdAt, message.created_at) ?? "message"}-${firstString(message.senderId, message.sender_id) ?? "sender"}`,
      senderName: firstString(message.senderName, message.sender_name) ?? "Team Member",
      senderId: firstString(message.senderId, message.sender_id),
      text: firstString(message.message, message.text, message.body) ?? "",
      createdAt: firstString(message.createdAt, message.created_at) ?? new Date().toISOString(),
    } satisfies HomeServiceConnectedChatMessage;
  });
}

export async function sendHomeServiceConnectedDirectMessage(token: string, memberId: number, text: string) {
  const message = text.trim();
  if (!message) throw new Error("A message is required.");
  return requestJson(`${COMPANY_CHAT_DIRECT_PATH}/${encodeURIComponent(String(memberId))}/messages`, { method: "POST", headers: createJobSyncBearerHeaders(token), body: JSON.stringify({ message }) });
}

function booleanState(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "clocked_in" || value === "active";
}

export function normalizeHomeServiceConnectedTimeState(payload: unknown): HomeServiceConnectedTimeState {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const time = firstRecord(data.time, data.current, data.state, data.status, data) ?? {};
  const entry = firstRecord(time.entry, data.entry, time.activeEntry, time.activeShift, time.activeTimesheet, time.timeEntry, data.activeEntry, data.activeShift, data.activeTimesheet, data.timeEntry);
  const activeBreak = firstRecord(time.activeBreak, data.activeBreak, entry?.activeBreak, entry?.break);
  const status = firstString(time.status, time.clockStatus, data.status, data.clockStatus, entry?.status);
  const clockInAt = firstString(time.clockInAt, time.clockInTime, data.clockInAt, data.clockInTime, entry?.clockIn, entry?.clockInAt, entry?.clockInTime, entry?.startedAt);
  const isClockedIn = booleanState(time.isClockedIn) || booleanState(data.isClockedIn) || booleanState(status) || Boolean(entry) || Boolean(clockInAt);
  const breakActive = booleanState(time.activeBreak) || booleanState(data.activeBreak) || (Boolean(activeBreak) && !firstString(activeBreak?.endedAt, activeBreak?.breakEndTime, activeBreak?.endTime)) || Boolean(entry?.breakStart && !entry?.breakEnd);
  return {
    isClockedIn,
    clockInAt,
    activeBreak: activeBreak || breakActive ? { isActive: breakActive, startedAt: firstString(activeBreak?.startedAt, activeBreak?.breakStartTime, activeBreak?.startTime, entry?.breakStart) } : null,
  };
}

export async function getHomeServiceConnectedTimeState(token: string) {
  const payload = await requestJson(TIME_CURRENT_PATH, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  return normalizeHomeServiceConnectedTimeState(payload);
}

async function performHomeServiceConnectedTimeAction(token: string, path: string) {
  return requestJson(path, { method: "POST", headers: createJobSyncBearerHeaders(token) });
}

export function clockInHomeServiceConnected(token: string) {
  return performHomeServiceConnectedTimeAction(token, TIME_CLOCK_IN_PATH);
}

export function clockOutHomeServiceConnected(token: string) {
  return performHomeServiceConnectedTimeAction(token, TIME_CLOCK_OUT_PATH);
}

export function startHomeServiceConnectedBreak(token: string) {
  return performHomeServiceConnectedTimeAction(token, TIME_BREAK_START_PATH);
}

export function endHomeServiceConnectedBreak(token: string) {
  return performHomeServiceConnectedTimeAction(token, TIME_BREAK_END_PATH);
}

// Native management adapters for the existing canonical jobs.* schedule-block authority.
// These routes require the coordinated unpublished backend repair; never fall back to legacy tRPC.
export type JobSyncCompanyScheduleBlockType = "sick_day" | "day_off" | "training" | "unavailable" | "other";
export type JobSyncCompanyScheduleBlock = {
  id: number;
  employeeUserId: number;
  employeeLabel: string;
  date: string;
  blockType: JobSyncCompanyScheduleBlockType;
  title: string;
  notes: string | null;
  startHour: number;
  endHour: number;
};
export type JobSyncCompanyScheduleBlockInput = {
  startDate: string;
  endDate: string;
  employeeId: string;
  employeeName: string;
  startHour: number;
  endHour: number;
  blockType: JobSyncCompanyScheduleBlockType;
  title: string;
  notes?: string;
};

function validCompanyScheduleBlockDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validCompanyScheduleBlockHours(startHour: unknown, endHour: unknown): boolean {
  return typeof startHour === "number" && typeof endHour === "number"
    && Number.isFinite(startHour) && Number.isFinite(endHour)
    && startHour >= 0 && endHour <= 24 && startHour < endHour;
}
function validCompanyScheduleBlockType(value: unknown): value is JobSyncCompanyScheduleBlockType {
  return value === "sick_day" || value === "day_off" || value === "training"
    || value === "unavailable" || value === "other";
}
function requireCompanyScheduleBlockScope(token: string, companyId: number) {
  if (typeof token !== "string" || !token.trim() || !Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new JobSyncApiError("A current Company management session is required.", null, "INVALID_INPUT");
  }
}
function companyScheduleBlockInvalidAck(): never {
  throw new JobSyncApiError("The schedule-block response could not be verified. Refresh the Company calendar before trying again.", null, "INVALID_RESPONSE");
}

export function normalizeJobSyncCompanyScheduleBlocks(payload: unknown, companyId: number, date: string): JobSyncCompanyScheduleBlock[] | null {
  const root = asRecord(payload);
  if (!Number.isSafeInteger(companyId) || companyId <= 0 || !validCompanyScheduleBlockDate(date)
    || !root || root.companyId !== companyId || !Array.isArray(root.blocks)) return null;
  const seen = new Set<number>();
  const result: JobSyncCompanyScheduleBlock[] = [];
  for (const raw of root.blocks) {
    const row = asRecord(raw);
    if (!row || typeof row.id !== "number" || !Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id)
      || typeof row.employeeUserId !== "number" || !Number.isSafeInteger(row.employeeUserId) || row.employeeUserId <= 0
      || typeof row.employeeLabel !== "string" || !row.employeeLabel.trim() || row.employeeLabel.length > 255
      || row.date !== date || !validCompanyScheduleBlockType(row.blockType)
      || typeof row.title !== "string" || !row.title.trim() || row.title.length > 255
      || (row.notes !== null && (typeof row.notes !== "string" || row.notes.length > 4000))
      || !validCompanyScheduleBlockHours(row.startHour, row.endHour)
      || (row.companyId !== undefined && row.companyId !== companyId)
      || (row.company_id !== undefined && row.company_id !== companyId)) return null;
    seen.add(row.id);
    result.push({ id: row.id, employeeUserId: row.employeeUserId, employeeLabel: row.employeeLabel,
      date, blockType: row.blockType, title: row.title, notes: row.notes as string | null,
      startHour: row.startHour as number, endHour: row.endHour as number });
  }
  return result;
}

export async function getJobSyncCompanyScheduleBlocks(token: string, companyId: number, date: string): Promise<JobSyncCompanyScheduleBlock[]> {
  requireCompanyScheduleBlockScope(token, companyId);
  if (!validCompanyScheduleBlockDate(date)) throw new JobSyncApiError("Choose a valid Company calendar date.", null, "INVALID_INPUT");
  const payload = await requestJson(`/api/mobile/v1/company/schedule-blocks?date=${encodeURIComponent(date)}`, {
    method: "GET", headers: { Authorization: `Bearer ${token}` },
  }, 200);
  const rows = normalizeJobSyncCompanyScheduleBlocks(payload, companyId, date);
  if (rows === null) return companyScheduleBlockInvalidAck();
  return rows;
}

export async function createJobSyncCompanyScheduleBlock(token: string, companyId: number, input: JobSyncCompanyScheduleBlockInput): Promise<{ companyId: number; count: number }> {
  requireCompanyScheduleBlockScope(token, companyId);
  if (!input || !validCompanyScheduleBlockDate(input.startDate) || !validCompanyScheduleBlockDate(input.endDate)
    || !validCompanyScheduleBlockHours(input.startHour, input.endHour) || !validCompanyScheduleBlockType(input.blockType)
    || typeof input.employeeId !== "string" || !/^\d+$/.test(input.employeeId) || !positiveJobSyncId(input.employeeId)
    || typeof input.employeeName !== "string" || !input.employeeName.trim() || input.employeeName.trim().length > 255
    || typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 255
    || (input.notes !== undefined && (typeof input.notes !== "string" || input.notes.trim().length > 4000))) {
    throw new JobSyncApiError("Choose an active Team Member, valid dates and hours, and a reason for this schedule block.", null, "INVALID_INPUT");
  }
  const expectedCount = (Date.parse(`${input.endDate}T00:00:00.000Z`) - Date.parse(`${input.startDate}T00:00:00.000Z`)) / 86_400_000 + 1;
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 366) {
    throw new JobSyncApiError("Choose a schedule-block range of 1 to 366 days.", null, "INVALID_INPUT");
  }
  const body: JobSyncCompanyScheduleBlockInput = {
    startDate: input.startDate, endDate: input.endDate, employeeId: input.employeeId,
    employeeName: input.employeeName.trim(), startHour: input.startHour, endHour: input.endHour,
    blockType: input.blockType, title: input.title.trim(),
    ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
  };
  const root = asRecord(await requestJson("/api/mobile/v1/company/schedule-blocks", {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  }, 201));
  if (!root || root.companyId !== companyId || root.count !== expectedCount) return companyScheduleBlockInvalidAck();
  return { companyId, count: expectedCount };
}

export async function deleteJobSyncCompanyScheduleBlock(token: string, companyId: number, blockId: number): Promise<{ companyId: number; success: true }> {
  requireCompanyScheduleBlockScope(token, companyId);
  if (!Number.isSafeInteger(blockId) || blockId <= 0) throw new JobSyncApiError("Choose a valid saved schedule block.", null, "INVALID_INPUT");
  const root = asRecord(await requestJson(`/api/mobile/v1/company/schedule-blocks/${blockId}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${token}` },
  }, 200));
  if (!root || root.companyId !== companyId || root.success !== true) return companyScheduleBlockInvalidAck();
  return { companyId, success: true };
}
