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

export type JobSyncFeatureAccess = {
  features: Record<string, boolean>;
  mobile: {
    finance: boolean;
    invoices: boolean;
    eodReview: boolean;
  };
};

export type JobSyncCompanyMember = {
  id: number;
  name: string;
  role: string;
  isActive: boolean;
  city: string | null;
  positionId: number | null;
  positionName: string | null;
  calendarEligible: boolean;
};

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
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  city?: string;
  availability?: "available" | "busy" | "off_duty";
  /** Canonical role change path — maps to company_team_positions; never send bare `role`. */
  positionId?: number;
};

const DEFAULT_JOBSYNC_BASE_URL = "https://www.homeserviceconnected.com";
const HSC_API_HOSTS = new Set(["homeserviceconnected.com", "www.homeserviceconnected.com", "jobwash-veysiubh.manus.space"]);
const LOGIN_PATH = "/api/mobile/v1/auth/login";
const SESSION_PATH = "/api/mobile/v1/auth/session";
const PASSWORD_RESET_REQUEST_PATH = "/api/mobile/v1/auth/password-reset/request";
const COMPANY_SYNC_PATH = "/api/mobile/v1/sync";
const COMPANY_JOBS_PATH = "/api/mobile/v1/company/jobs";
const COMPANY_INVOICES_PATH = "/api/mobile/v1/invoices";
const COMPANY_UNPAID_JOBS_PATH = "/api/mobile/v1/payments/unpaid-jobs";
const COMPANY_CUSTOMERS_PATH = "/api/mobile/v1/customers";
const COMPANY_FINANCE_PATH = "/api/mobile/v1/finance";
const COMPANY_TEAM_MEMBERS_PATH = "/api/mobile/v1/company/team-members";
const COMPANY_FEATURE_ACCESS_PATH = "/api/mobile/v1/company/feature-access";
const TIME_CURRENT_PATH = "/api/mobile/v1/time/current";
const TIME_CLOCK_IN_PATH = "/api/mobile/v1/time/clock-in";
const TIME_CLOCK_OUT_PATH = "/api/mobile/v1/time/clock-out";
const TIME_BREAK_START_PATH = "/api/mobile/v1/time/breaks/start";
const TIME_BREAK_END_PATH = "/api/mobile/v1/time/breaks/end";
const TIME_TIMESHEETS_PATH = "/api/mobile/v1/time/timesheets";
const TIME_TEAM_SUMMARY_PATH = "/api/mobile/v1/time/team-summary";
const TIME_OFF_PATH = "/api/mobile/v1/time-off";
const COMPANY_CHAT_GROUPS_PATH = "/api/mobile/v1/company/chat/groups";
const COMPANY_CHAT_COMMUNITY_PATH = "/api/mobile/v1/chat/community";
const COMPANY_CHAT_DIRECT_PATH = "/api/mobile/v1/chat/direct";
const COMPANY_PRICE_BOOK_PATH = "/api/mobile/v1/price-book";
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

export function resolveJobSyncBaseUrl(configured = process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL) {
  const candidate = configured?.trim();
  if (!candidate) return DEFAULT_JOBSYNC_BASE_URL;
  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase();
    const isLocalDevelopment = process.env.NODE_ENV !== "production" && (host === "localhost" || host === "127.0.0.1");
    return HSC_API_HOSTS.has(host) || isLocalDevelopment ? candidate.replace(/\/$/, "") : DEFAULT_JOBSYNC_BASE_URL;
  } catch {
    return DEFAULT_JOBSYNC_BASE_URL;
  }
}

function getJobSyncBaseUrl() {
  return resolveJobSyncBaseUrl();
}

async function requestJson(path: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${getJobSyncBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessage(payload, response.status === 401 ? "Invalid email or password." : "Home Service Connected authentication is unavailable."));
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Home Service Connected took too long to respond. Check your connection and try again.");
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

export function createJobSyncPasswordResetRequestPayload(email: string) {
  return { email: email.trim().toLowerCase(), accountType: "company" as const };
}

export function createJobSyncBearerHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export type JobSyncSyncChange = { id: number; updatedAt?: string | null; createdAt?: string | null };
export type JobSyncIncrementalSync = { since: string; generatedAt: string; changes: Record<string, JobSyncSyncChange[]> };
export type JobSyncCanonicalJobStatus = "draft" | "scheduled" | "en_route" | "on_site" | "completed" | "follow_up" | "cancelled";
export type JobSyncPaymentStatus = "unpaid" | "partial" | "paid" | "refunded";
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
  city: string | null;
  amount: number;
  paidTotal: number;
  refundTotal: number;
  appliedEstimateCredit: number;
  balance: number;
  paymentStatus: string;
  customerName: string;
  assignedName: string | null;
};
export type JobSyncCompanyInvoice = {
  id: number;
  customerId: number | null;
  customerName: string;
  title: string;
  serviceName: string;
  status: string;
  paymentStatus: string;
  scheduledStartAt: string | null;
  total: number;
  paid: number;
  balance: number;
};
export type JobSyncCompanyUnpaidJob = {
  id: number;
  title: string;
  customerName: string;
  amount: number;
  paidTotal: number;
  balance: number;
  paymentStatus: string;
};
export type JobSyncCompanyCustomer = { id: number; firstName: string; lastName: string; name: string; email: string | null; phone: string | null; addressLine1: string | null; city: string | null; region: string | null; postalCode: string | null; vehicleType: string | null };
export type JobSyncCompanyCustomerDetail = JobSyncCompanyCustomer & {
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
  doNotService: boolean | null;
  preferredContact: string | null;
  updatedAt: string | null;
};
export type JobSyncCompanyCustomerCreateInput = { firstName: string; lastName: string; email?: string; phone?: string; addressLine1?: string; city?: string; region?: string; postalCode?: string; vehicleType?: string };
export type JobSyncCompanyCustomerUpdateInput = {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
};
export type JobSyncCompanyFinanceTransaction = {
  id: string;
  type: "income" | "expense" | string;
  category: string;
  amount: number;
  description: string | null;
  date: string | null;
  source: string | null;
};
export type JobSyncCompanyFinanceSummary = {
  income: number | null;
  expenses: number | null;
  netCashMovement: number | null;
  collected: number | null;
  outstanding: number | null;
  bookedRevenue: number | null;
  invoiceCount: number | null;
  billedTotal: number | null;
  collectedTotal: number | null;
  openBalance: number | null;
  pastDueBalance: number | null;
  reportingMonth: string | null;
  reportingTimezone: string | null;
  transactions: JobSyncCompanyFinanceTransaction[];
  definitions: Record<string, string>;
};
export type JobSyncCompanyJobCreateInput = { customerId: number; priceBookServiceId: number; assignedUserId?: number; scheduledStartAt: string; scheduledEndAt?: string; privateNotes?: string };

function normalizeJobSyncMobileJob(value: unknown): JobSyncMobileJob | null {
  const row = asRecord(value) ?? {};
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    id,
    customerId: Number(row.customerId),
    assignedUserId: Number.isSafeInteger(Number(row.assignedUserId)) ? Number(row.assignedUserId) : null,
    title: firstString(row.title) ?? "",
    serviceName: firstString(row.serviceName) ?? "",
    status: firstString(row.status) ?? "scheduled",
    scheduledStartAt: firstString(row.scheduledStartAt),
    scheduledEndAt: firstString(row.scheduledEndAt),
    updatedAt: firstString(row.updatedAt),
    addressLine1: firstString(row.addressLine1),
    city: firstString(row.city),
    amount: Number(row.amount || 0),
    paidTotal: Number(row.paidTotal || 0),
    refundTotal: Number(row.refundTotal || 0),
    appliedEstimateCredit: Number(row.appliedEstimateCredit || 0),
    balance: Number(row.balance ?? row.amount ?? 0),
    paymentStatus: firstString(row.paymentStatus) ?? "unpaid",
    customerName: firstString(row.customerName) ?? "",
    assignedName: firstString(row.assignedName),
  };
}

export function normalizeJobSyncIncrementalSync(payload: unknown, fallbackSince?: string | null): JobSyncIncrementalSync {
  const root = asRecord(payload) ?? {};
  const changesRoot = asRecord(root.changes) ?? {};
  const normalizeChanges = (value: unknown): JobSyncSyncChange[] => Array.isArray(value) ? value.map((item) => {
    const row = asRecord(item) ?? {};
    return { id: Number(row.id), updatedAt: firstString(row.updatedAt), createdAt: firstString(row.createdAt) };
  }).filter((item) => Number.isSafeInteger(item.id) && item.id > 0) : [];
  return { since: firstString(root.since) ?? fallbackSince ?? new Date(0).toISOString(), generatedAt: firstString(root.generatedAt) ?? new Date().toISOString(), changes: Object.fromEntries(Object.entries(changesRoot).map(([key, value]) => [key, normalizeChanges(value)])) };
}

export async function getJobSyncCompanyIncrementalSync(token: string, since?: string | null): Promise<JobSyncIncrementalSync> {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  return normalizeJobSyncIncrementalSync(await requestJson(`${COMPANY_SYNC_PATH}${query}`, { method: "GET", headers: createJobSyncBearerHeaders(token) }), since);
}

export async function getJobSyncCompanyJobs(token: string, range?: { start?: string; end?: string }): Promise<JobSyncMobileJob[]> {
  const search = new URLSearchParams();
  if (range?.start) search.set("start", range.start);
  if (range?.end) search.set("end", range.end);
  const payload = asRecord(await requestJson(`${COMPANY_JOBS_PATH}${search.size ? `?${search.toString()}` : ""}`, { method: "GET", headers: createJobSyncBearerHeaders(token) })) ?? {};
  return (Array.isArray(payload.jobs) ? payload.jobs : []).map(normalizeJobSyncMobileJob).filter((job): job is JobSyncMobileJob => Boolean(job));
}

function normalizeJobSyncCompanyCustomer(value: unknown): JobSyncCompanyCustomer | null {
  const row = asRecord(value) ?? {};
  const id = Number(row.id);
  const firstName = firstString(row.firstName) ?? "";
  const lastName = firstString(row.lastName) ?? "";
  if (!Number.isSafeInteger(id) || id <= 0 || !firstName || !lastName) return null;
  return {
    id,
    firstName,
    lastName,
    name: firstString(row.name) ?? `${firstName} ${lastName}`.trim(),
    email: firstString(row.email),
    phone: firstString(row.phone),
    addressLine1: firstString(row.addressLine1),
    city: firstString(row.city),
    region: firstString(row.region),
    postalCode: firstString(row.postalCode),
    vehicleType: firstString(row.vehicleType),
  };
}

export async function getJobSyncCompanyCustomers(token: string): Promise<JobSyncCompanyCustomer[]> {
  const payload = asRecord(await requestJson(COMPANY_CUSTOMERS_PATH, { method: "GET", headers: createJobSyncBearerHeaders(token) })) ?? {};
  return (Array.isArray(payload.customers) ? payload.customers : []).map(normalizeJobSyncCompanyCustomer).filter((customer): customer is JobSyncCompanyCustomer => Boolean(customer));
}

function normalizeJobSyncCompanyCustomerDetail(value: unknown): JobSyncCompanyCustomerDetail | null {
  const row = asRecord(value) ?? {};
  const base = normalizeJobSyncCompanyCustomer(row);
  if (!base) return null;
  const vehicle = asRecord(row.vehicle) ?? {};
  return {
    ...base,
    vehicleMake: firstString(row.vehicleMake, vehicle.make),
    vehicleModel: firstString(row.vehicleModel, vehicle.model),
    vehicleYear: firstString(row.vehicleYear, vehicle.year),
    vehicleType: firstString(row.vehicleType, vehicle.type) ?? base.vehicleType,
    doNotService: typeof row.doNotService === "boolean" ? row.doNotService : null,
    preferredContact: firstString(row.preferredContact),
    updatedAt: firstString(row.updatedAt),
  };
}

export function normalizeJobSyncCompanyFinance(payload: unknown): JobSyncCompanyFinanceSummary {
  const root = asRecord(payload) ?? {};
  const finance = asRecord(root.finance) ?? (root.income != null || root.collected != null || root.bookedRevenue != null ? root : null);
  if (!finance) {
    throw new Error("Home Service Connected returned an invalid finance response.");
  }
  const hasCanonicalField = ["income", "expenses", "collected", "outstanding", "bookedRevenue", "billedTotal", "openBalance"]
    .some((key) => finance[key] !== undefined && finance[key] !== null);
  if (!hasCanonicalField) {
    throw new Error("Home Service Connected returned an invalid finance response.");
  }
  const definitions = asRecord(finance.definitions) ?? {};
  return {
    income: nullableNumber(finance.income),
    expenses: nullableNumber(finance.expenses),
    netCashMovement: nullableNumber(finance.netCashMovement, finance.net),
    collected: nullableNumber(finance.collected),
    outstanding: nullableNumber(finance.outstanding),
    bookedRevenue: nullableNumber(finance.bookedRevenue),
    invoiceCount: nullableNumber(finance.invoiceCount),
    billedTotal: nullableNumber(finance.billedTotal),
    collectedTotal: nullableNumber(finance.collectedTotal),
    openBalance: nullableNumber(finance.openBalance),
    pastDueBalance: nullableNumber(finance.pastDueBalance),
    reportingMonth: firstString(finance.reportingMonth),
    reportingTimezone: firstString(finance.reportingTimezone),
    transactions: (Array.isArray(finance.transactions) ? finance.transactions : []).flatMap((item) => {
      const row = asRecord(item) ?? {};
      const id = firstString(row.id) ?? "";
      const amount = nullableNumber(row.amount);
      if (!id || amount == null) return [];
      return [{
        id,
        type: firstString(row.type) === "expense" ? "expense" : "income",
        category: firstString(row.category) ?? "Uncategorized",
        amount,
        description: firstString(row.description),
        date: firstString(row.date),
        source: firstString(row.source),
      }];
    }),
    definitions: Object.fromEntries(
      Object.entries(definitions).flatMap(([key, value]) => typeof value === "string" && value.trim() ? [[key, value.trim()]] : []),
    ),
  };
}

export async function getJobSyncCompanyCustomer(token: string, customerId: number): Promise<JobSyncCompanyCustomerDetail> {
  const payload = asRecord(await requestJson(`${COMPANY_CUSTOMERS_PATH}/${customerId}`, { method: "GET", headers: createJobSyncBearerHeaders(token) })) ?? {};
  const customer = normalizeJobSyncCompanyCustomerDetail(payload.customer ?? payload);
  if (!customer) throw new Error("Home Service Connected returned an invalid customer response.");
  return customer;
}

export async function getJobSyncCompanyFinance(token: string): Promise<JobSyncCompanyFinanceSummary> {
  return normalizeJobSyncCompanyFinance(await requestJson(COMPANY_FINANCE_PATH, { method: "GET", headers: createJobSyncBearerHeaders(token) }));
}

export async function createJobSyncCompanyCustomer(token: string, input: JobSyncCompanyCustomerCreateInput): Promise<JobSyncCompanyCustomer> {
  const payload = asRecord(await requestJson(COMPANY_CUSTOMERS_PATH, {
    method: "POST",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify(sanitizeCompanyMutationBody({
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      ...(input.email?.trim() ? { email: input.email.trim().toLowerCase() } : {}),
      ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
      ...(input.addressLine1?.trim() ? { addressLine1: input.addressLine1.trim() } : {}),
      ...(input.city?.trim() ? { city: input.city.trim() } : {}),
      ...(input.region?.trim() ? { region: input.region.trim() } : {}),
      ...(input.postalCode?.trim() ? { postalCode: input.postalCode.trim() } : {}),
      ...(input.vehicleType?.trim() ? { vehicleType: input.vehicleType.trim() } : {}),
    })),
  })) ?? {};
  const customer = normalizeJobSyncCompanyCustomer(payload.customer) ?? normalizeJobSyncCompanyCustomerDetail(payload.customer);
  if (!customer) throw new Error("Home Service Connected returned an invalid customer response.");
  return customer;
}

export function createJobSyncCompanyCustomerUpdatePayload(input: JobSyncCompanyCustomerUpdateInput) {
  return sanitizeCompanyMutationBody({
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    ...(input.email !== undefined ? { email: input.email?.trim() ? input.email.trim().toLowerCase() : null } : {}),
    ...(input.phone !== undefined ? { phone: input.phone?.trim() ? input.phone.trim() : null } : {}),
    ...(input.addressLine1 !== undefined ? { addressLine1: input.addressLine1?.trim() ? input.addressLine1.trim() : null } : {}),
    ...(input.city !== undefined ? { city: input.city?.trim() ? input.city.trim() : null } : {}),
    ...(input.region !== undefined ? { region: input.region?.trim() ? input.region.trim() : null } : {}),
    ...(input.postalCode !== undefined ? { postalCode: input.postalCode?.trim() ? input.postalCode.trim() : null } : {}),
  });
}

export async function updateJobSyncCompanyCustomer(
  token: string,
  customerId: number,
  input: JobSyncCompanyCustomerUpdateInput,
): Promise<JobSyncCompanyCustomerDetail> {
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    throw new Error("A valid Home Service Connected customer ID is required.");
  }
  const payload = asRecord(await requestJson(`${COMPANY_CUSTOMERS_PATH}/${customerId}`, {
    method: "PATCH",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify(createJobSyncCompanyCustomerUpdatePayload(input)),
  })) ?? {};
  const customer = normalizeJobSyncCompanyCustomerDetail(payload.customer ?? payload);
  if (!customer) throw new Error("Home Service Connected returned an invalid customer response.");
  return customer;
}

export async function createJobSyncCompanyJob(token: string, input: JobSyncCompanyJobCreateInput): Promise<JobSyncMobileJob> {
  const payload = asRecord(await requestJson(COMPANY_JOBS_PATH, {
    method: "POST",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({
      customerId: input.customerId,
      priceBookServiceId: input.priceBookServiceId,
      ...(input.assignedUserId ? { assignedUserId: input.assignedUserId } : {}),
      scheduledStartAt: input.scheduledStartAt,
      ...(input.scheduledEndAt ? { scheduledEndAt: input.scheduledEndAt } : {}),
      ...(input.privateNotes?.trim() ? { privateNotes: input.privateNotes.trim() } : {}),
    }),
  })) ?? {};
  const job = normalizeJobSyncMobileJob(payload.job);
  if (!job) throw new Error("Home Service Connected returned an invalid Job response.");
  return job;
}

function companyJobPath(jobId: number, suffix = "") {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) throw new Error("A valid Company Job ID is required.");
  return `${COMPANY_JOBS_PATH}/${jobId}${suffix}`;
}

export function sanitizeCompanyMutationBody(body: Record<string, unknown>) {
  const forbidden = ["companyId", "company_id", "role", "ownerId", "owner_id"];
  for (const key of forbidden) {
    if (key in body) throw new Error("Company identity must come from the authenticated Home Service Connected session.");
  }
  return body;
}

export function sanitizeCompanyTimeMutationBody(body: Record<string, unknown>) {
  const forbidden = [
    "companyId",
    "company_id",
    "role",
    "ownerId",
    "owner_id",
    "employeeId",
    "employee_id",
    "userId",
    "user_id",
    "memberUserId",
    "member_user_id",
  ];
  for (const key of forbidden) {
    if (key in body) throw new Error("Company identity must come from the authenticated Home Service Connected session.");
  }
  return body;
}

export async function getJobSyncCompanyJob(token: string, jobId: number): Promise<JobSyncMobileJob> {
  const payload = asRecord(await requestJson(companyJobPath(jobId), { method: "GET", headers: createJobSyncBearerHeaders(token) })) ?? {};
  const job = normalizeJobSyncMobileJob(payload.job ?? payload);
  if (!job) throw new Error("Home Service Connected returned an invalid Job response.");
  return job;
}

export async function updateJobSyncCompanyJobStatus(token: string, jobId: number, input: { status: JobSyncCanonicalJobStatus; expectedUpdatedAt?: string }) {
  const payload = asRecord(await requestJson(companyJobPath(jobId, "/status"), {
    method: "PATCH",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify(sanitizeCompanyMutationBody({
      status: input.status,
      ...(input.expectedUpdatedAt ? { expectedUpdatedAt: input.expectedUpdatedAt } : {}),
    })),
  })) ?? {};
  return { success: payload.success === true, status: firstString(payload.status) ?? input.status };
}

export async function assignJobSyncCompanyJob(token: string, jobId: number, input: { assignedUserId: number | null; expectedUpdatedAt?: string }) {
  const payload = asRecord(await requestJson(companyJobPath(jobId, "/assignment"), {
    method: "PATCH",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify(sanitizeCompanyMutationBody({
      assignedUserId: input.assignedUserId,
      ...(input.expectedUpdatedAt ? { expectedUpdatedAt: input.expectedUpdatedAt } : {}),
    })),
  })) ?? {};
  return { success: payload.success === true, assignedUserId: nullableNumber(payload.assignedUserId) };
}

export async function rescheduleJobSyncCompanyJob(token: string, jobId: number, input: { scheduledStartAt: string; scheduledEndAt?: string | null; expectedUpdatedAt?: string }) {
  const payload = asRecord(await requestJson(companyJobPath(jobId, "/schedule"), {
    method: "PATCH",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify(sanitizeCompanyMutationBody({
      scheduledStartAt: input.scheduledStartAt,
      ...(input.scheduledEndAt !== undefined ? { scheduledEndAt: input.scheduledEndAt } : {}),
      ...(input.expectedUpdatedAt ? { expectedUpdatedAt: input.expectedUpdatedAt } : {}),
    })),
  })) ?? {};
  return {
    success: payload.success === true,
    jobId: firstNumber(payload.jobId) ?? jobId,
    scheduledStartAt: firstString(payload.scheduledStartAt) ?? input.scheduledStartAt,
    scheduledEndAt: firstString(payload.scheduledEndAt) ?? input.scheduledEndAt ?? null,
  };
}

function normalizeJobSyncCompanyInvoice(value: unknown): JobSyncCompanyInvoice | null {
  const row = asRecord(value) ?? {};
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    id,
    customerId: Number.isSafeInteger(Number(row.customerId)) ? Number(row.customerId) : null,
    customerName: firstString(row.customerName) ?? "",
    title: firstString(row.title) ?? "",
    serviceName: firstString(row.serviceName) ?? "",
    status: firstString(row.status) ?? "scheduled",
    paymentStatus: firstString(row.paymentStatus) ?? "unpaid",
    scheduledStartAt: firstString(row.scheduledStartAt),
    total: Number(row.total || 0),
    paid: Number(row.paid || 0),
    balance: Number(row.balance || 0),
  };
}

function normalizeJobSyncCompanyUnpaidJob(value: unknown): JobSyncCompanyUnpaidJob | null {
  const row = asRecord(value) ?? {};
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    id,
    title: firstString(row.title) ?? "",
    customerName: firstString(row.customerName) ?? "",
    amount: Number(row.amount || 0),
    paidTotal: Number(row.paidTotal || 0),
    balance: Number(row.balance || 0),
    paymentStatus: firstString(row.paymentStatus) ?? "unpaid",
  };
}

export async function getJobSyncCompanyInvoices(token: string): Promise<JobSyncCompanyInvoice[]> {
  const payload = asRecord(await requestJson(COMPANY_INVOICES_PATH, { method: "GET", headers: createJobSyncBearerHeaders(token) })) ?? {};
  return (Array.isArray(payload.invoices) ? payload.invoices : []).map(normalizeJobSyncCompanyInvoice).filter((invoice): invoice is JobSyncCompanyInvoice => Boolean(invoice));
}

export async function getJobSyncCompanyUnpaidJobs(token: string): Promise<JobSyncCompanyUnpaidJob[]> {
  const payload = asRecord(await requestJson(COMPANY_UNPAID_JOBS_PATH, { method: "GET", headers: createJobSyncBearerHeaders(token) })) ?? {};
  return (Array.isArray(payload.jobs) ? payload.jobs : []).map(normalizeJobSyncCompanyUnpaidJob).filter((job): job is JobSyncCompanyUnpaidJob => Boolean(job));
}

export function createJobSyncCompanyMemberUpdatePayload(input: JobSyncCompanyMemberUpdateInput) {
  // Never send `role` — RBAC is server-derived from membership / positionId.
  return sanitizeCompanyMutationBody({
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    ...(input.email?.trim() ? { email: input.email.trim().toLowerCase() } : {}),
    ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
    ...(input.city?.trim() ? { city: input.city.trim() } : {}),
    ...(input.availability ? { availability: input.availability } : {}),
    ...(typeof input.positionId === "number" && Number.isSafeInteger(input.positionId) && input.positionId > 0
      ? { positionId: input.positionId }
      : {}),
  });
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

  const companyId = firstNumber(company?.id, company?.companyId, profile.companyId, session.companyId, user.companyId);
  if (!companyId || !company) return null;
  return {
    token,
    portal: "company",
    user: normalizedUser,
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

export function normalizeJobSyncFeatureAccess(payload: unknown): JobSyncFeatureAccess {
  const root = asRecord(payload);
  const rawFeatures = Array.isArray(root?.features) ? root.features : [];
  const features = Object.fromEntries(rawFeatures.flatMap((value) => {
    const item = asRecord(value);
    const key = firstString(item?.key);
    return key ? [[key, item?.isEnabled === true]] : [];
  }));
  const mobile = asRecord(root?.mobile) ?? {};
  return {
    features,
    mobile: {
      finance: mobile.finance === true,
      invoices: mobile.invoices === true,
      eodReview: mobile.eodReview === true,
    },
  };
}

export async function getJobSyncCompanyFeatureAccess(token: string) {
  const payload = await requestJson(COMPANY_FEATURE_ACCESS_PATH, {
    method: "GET",
    headers: createJobSyncBearerHeaders(token),
  });
  return normalizeJobSyncFeatureAccess(payload);
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

export async function requestJobSyncCompanyPasswordReset(email: string) {
  await requestJson(PASSWORD_RESET_REQUEST_PATH, {
    method: "POST",
    body: JSON.stringify(createJobSyncPasswordResetRequestPayload(email)),
  });
  return { ok: true } as const;
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
      city: firstString(member.city, member.serviceCity, member.service_city),
      positionId: firstNumber(member.positionId, member.position_id),
      positionName: firstString(member.positionName, member.position_name),
      calendarEligible: Boolean(member.calendarEligible ?? member.calendar_eligible),
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
    positionId: firstNumber(member.positionId, member.position_id),
    positionName: firstString(member.positionName, member.position_name),
    calendarEligible: Boolean(member.calendarEligible ?? member.calendar_eligible),
    availability: firstString(member.availability),
    workDays: stringList(member.workDays ?? member.work_days ?? member.customWorkDays),
    hourlyRate: nullableNumber(member.hourlyRate, member.hourly_rate),
    upsellBonusPct: nullableNumber(member.upsellBonusPct, member.upsell_bonus_pct),
    mysteryBonusStatus: firstString(member.mysteryBonusStatus, member.mystery_bonus_status),
    isActive: true,
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

export type HomeServiceConnectedTimesheetRecord = {
  id: number;
  memberName: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  totalHours: number | null;
};

export type HomeServiceConnectedTeamTimeMember = {
  id: number;
  memberId: string | null;
  name: string;
  availability: string;
  clockedIn: boolean;
  clockIn: string | null;
  todayHours: number;
};

export type HomeServiceConnectedTimeOffRequest = {
  id: number;
  userId: number;
  memberName: string;
  startDate: string;
  endDate: string;
  hoursRequested: number;
  requestType: string;
  reason: string | null;
  status: string;
  reviewerNote: string | null;
  reviewedAt: string | null;
  createdAt: string | null;
};

export type HomeServiceConnectedTimeOffList = {
  canReview: boolean;
  requests: HomeServiceConnectedTimeOffRequest[];
};

export type HomeServiceConnectedTimeOffReview = {
  success: boolean;
  requestId: number;
  status: string;
  approved: boolean;
  coveredJobIds: number[];
  inFieldJobIds: number[];
  coveredCount: number;
  inFieldCount: number;
};

export type HomeServiceConnectedTimeOffRequestType = "vacation" | "sick" | "personal" | "other";

export type HomeServiceConnectedPriceBookService = {
  serviceId: string;
  name: string;
  basePrice: number;
  emoji: string;
  description: string;
  features: string[];
  vehiclePrices: Record<string, number>;
  imageUrl: string | null;
  sortOrder: number;
  serviceTypeId: number | null;
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
    basePrice: nullableNumber(service.basePrice, service.base_price) ?? 0,
    emoji: firstString(service.emoji, service.icon) ?? "🛠️",
    description: firstString(service.description, service.details) ?? "",
    features: priceBookFeatures(service.features),
    vehiclePrices: priceMap(service.vehiclePrices ?? service.vehicle_prices ?? service.prices),
    imageUrl: firstString(service.imageUrl, service.image_url, service.image_url_pb),
    sortOrder: nullableNumber(service.sortOrder, service.sort_order, service.sort_order_pb) ?? 0,
    serviceTypeId: nullableNumber(service.serviceTypeId, service.service_type_id),
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
  return requestJson(`${COMPANY_CHAT_GROUPS_PATH}/${encodeURIComponent(groupId)}/members`, {
    method: "PUT",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ memberIds: Array.from(new Set(memberIds.filter((memberId) => Number.isInteger(memberId) && memberId > 0))) }),
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

function normalizeCommunityCategory(value: unknown): HomeServiceConnectedCommunityCategory | null {
  const category = asRecord(value);
  const id = nullableNumber(category?.id, category?.categoryId, category?.category_id);
  const name = firstString(category?.name, category?.label);
  if (!category || !id || !name) return null;
  return { id, name, description: firstString(category.description), icon: firstString(category.icon), sortOrder: nullableNumber(category.sortOrder, category.sort_order) ?? 0, isActive: isActiveMember(category.isActive ?? category.is_active ?? true) };
}

export function normalizeHomeServiceConnectedCommunityCategories(payload: unknown) {
  const root = asRecord(payload); const data = firstRecord(root?.data, root) ?? {}; const categories = Array.isArray(data.categories) ? data.categories : Array.isArray(root?.categories) ? root.categories : [];
  return categories.map(normalizeCommunityCategory).filter((category): category is HomeServiceConnectedCommunityCategory => Boolean(category?.isActive));
}

function normalizeCommunityPost(value: unknown): HomeServiceConnectedCommunityPost | null {
  const post = asRecord(value);
  const id = nullableNumber(post?.id, post?.postId, post?.post_id);
  const authorUserId = nullableNumber(post?.authorUserId, post?.author_user_id);
  const authorName = firstString(post?.authorName, post?.author_name);
  const title = firstString(post?.title);
  const body = firstString(post?.body, post?.message);
  if (!post || !id || !authorUserId || !authorName || !title || !body) return null;
  return { id, categoryId: nullableNumber(post.categoryId, post.category_id), categoryName: firstString(post.categoryName, post.category_name), categoryIcon: firstString(post.categoryIcon, post.category_icon), authorUserId, authorName, title, body, mediaUrl: firstString(post.mediaUrl, post.media_url), isPinned: isActiveMember(post.isPinned ?? post.is_pinned), commentCount: nullableNumber(post.commentCount, post.comment_count) ?? 0, likeCount: nullableNumber(post.likeCount, post.like_count) ?? 0, viewerLiked: isActiveMember(post.viewerLiked ?? post.viewer_liked), createdAt: firstString(post.createdAt, post.created_at) ?? new Date().toISOString() };
}

export function normalizeHomeServiceConnectedCommunityPosts(payload: unknown) {
  const root = asRecord(payload); const data = firstRecord(root?.data, root) ?? {}; const posts = Array.isArray(data.posts) ? data.posts : Array.isArray(root?.posts) ? root.posts : [];
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
  return requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/categories`, { method: "POST", headers: createJobSyncBearerHeaders(token), body: JSON.stringify({ name: input.name.trim(), ...(input.description?.trim() ? { description: input.description.trim() } : {}), ...(input.icon?.trim() ? { icon: input.icon.trim() } : {}), ...(Number.isInteger(input.sortOrder) ? { sortOrder: input.sortOrder } : {}) }) });
}

export async function getHomeServiceConnectedCommunityPosts(token: string, categoryId?: number) {
  const query = categoryId ? `?categoryId=${encodeURIComponent(String(categoryId))}` : "";
  const payload = await requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/posts${query}`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  return normalizeHomeServiceConnectedCommunityPosts(payload);
}

export async function createHomeServiceConnectedCommunityPost(token: string, input: { categoryId?: number; title: string; body: string }) {
  return requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/posts`, { method: "POST", headers: createJobSyncBearerHeaders(token), body: JSON.stringify({ ...(input.categoryId ? { categoryId: input.categoryId } : {}), title: input.title.trim(), body: input.body.trim() }) });
}

export async function getHomeServiceConnectedCommunityComments(token: string, postId: number) {
  const payload = await requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/posts/${encodeURIComponent(String(postId))}/comments`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  const root = asRecord(payload); const data = firstRecord(root?.data, root) ?? {}; const comments = Array.isArray(data.comments) ? data.comments : Array.isArray(root?.comments) ? root.comments : [];
  return comments.map(normalizeCommunityComment).filter((comment): comment is HomeServiceConnectedCommunityComment => Boolean(comment));
}

export async function createHomeServiceConnectedCommunityComment(token: string, postId: number, body: string) {
  return requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/posts/${encodeURIComponent(String(postId))}/comments`, { method: "POST", headers: createJobSyncBearerHeaders(token), body: JSON.stringify({ body: body.trim() }) });
}

export async function toggleHomeServiceConnectedCommunityLike(token: string, postId: number) {
  return requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/posts/${encodeURIComponent(String(postId))}/like`, { method: "POST", headers: createJobSyncBearerHeaders(token) });
}

export async function getHomeServiceConnectedDirectMembers(token: string): Promise<HomeServiceConnectedDirectMember[]> {
  const payload = await requestJson(`${COMPANY_CHAT_DIRECT_PATH}/members`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  const root = asRecord(payload); const data = firstRecord(root?.data, root) ?? {}; const members = Array.isArray(data.members) ? data.members : Array.isArray(root?.members) ? root.members : [];
  return members.flatMap((value) => { const member = asRecord(value); const id = nullableNumber(member?.id, member?.userId); const name = firstString(member?.name, member?.fullName); return id && name ? [{ id, name, role: firstString(member?.role) ?? "Team Member", lastMessage: firstString(member?.lastMessage, member?.last_message), lastMessageAt: firstString(member?.lastMessageAt, member?.last_message_at) }] : []; });
}

export async function getHomeServiceConnectedDirectMessages(token: string, memberId: number) {
  const payload = await requestJson(`${COMPANY_CHAT_DIRECT_PATH}/${encodeURIComponent(String(memberId))}/messages`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  const root = asRecord(payload); const data = firstRecord(root?.data, root) ?? {}; const messages = Array.isArray(data.messages) ? data.messages : Array.isArray(root?.messages) ? root.messages : [];
  return messages.map((value) => { const message = asRecord(value) ?? {}; return { id: firstString(message.id, message.messageId, message.message_id) ?? `${firstString(message.createdAt, message.created_at) ?? "message"}-${firstString(message.senderId, message.sender_id) ?? "sender"}`, senderName: firstString(message.senderName, message.sender_name) ?? "Team Member", senderId: firstString(message.senderId, message.sender_id), text: firstString(message.message, message.text, message.body) ?? "", createdAt: firstString(message.createdAt, message.created_at) ?? new Date().toISOString() } satisfies HomeServiceConnectedChatMessage; });
}

export async function sendHomeServiceConnectedDirectMessage(token: string, memberId: number, text: string) {
  const message = text.trim(); if (!message) throw new Error("A message is required.");
  return requestJson(`${COMPANY_CHAT_DIRECT_PATH}/${encodeURIComponent(String(memberId))}/messages`, { method: "POST", headers: createJobSyncBearerHeaders(token), body: JSON.stringify({ message }) });
}

function booleanState(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "clocked_in" || value === "active";
}

export function normalizeHomeServiceConnectedTimeState(payload: unknown): HomeServiceConnectedTimeState {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const time = firstRecord(data.time, data.current, data.state, data.status, data) ?? {};
  const entry = firstRecord(
    time.entry,
    time.activeEntry,
    time.activeShift,
    time.activeTimesheet,
    time.timeEntry,
    data.entry,
    data.activeEntry,
    data.activeShift,
    data.activeTimesheet,
    data.timeEntry,
  );
  const rawBreak = time.activeBreak ?? data.activeBreak ?? entry?.activeBreak ?? entry?.break;
  const activeBreak = asRecord(rawBreak);
  const status = firstString(time.status, time.clockStatus, data.status, data.clockStatus, entry?.status);
  const clockInAt = firstString(
    time.clockInAt,
    time.clockInTime,
    time.clockIn,
    data.clockInAt,
    data.clockInTime,
    data.clockIn,
    entry?.clockInAt,
    entry?.clockInTime,
    entry?.clockIn,
    entry?.startedAt,
  );
  const clockOutAt = firstString(entry?.clockOut, entry?.clockOutAt, entry?.clock_out, time.clockOut, data.clockOut);
  const allowedActions = Array.isArray(time.allowedActions)
    ? time.allowedActions
    : Array.isArray(data.allowedActions)
      ? data.allowedActions
      : [];
  const allowedClockedIn = allowedActions.includes("clock_out") || allowedActions.includes("break_start") || allowedActions.includes("break_end");
  const hasOpenEntry = Boolean(entry && !clockOutAt);
  const isClockedIn = booleanState(time.isClockedIn)
    || booleanState(data.isClockedIn)
    || booleanState(status)
    || hasOpenEntry
    || allowedClockedIn;
  const breakFlag = rawBreak === true || rawBreak === 1 || rawBreak === "1" || rawBreak === "true";
  const breakActive = breakFlag
    || allowedActions.includes("break_end")
    || Boolean(firstString(entry?.breakStart, entry?.break_start) && !firstString(entry?.breakEnd, entry?.break_end))
    || (Boolean(activeBreak) && !firstString(activeBreak?.endedAt, activeBreak?.breakEndTime, activeBreak?.endTime));
  return {
    isClockedIn,
    clockInAt,
    activeBreak: breakActive ? { isActive: true, startedAt: firstString(activeBreak?.startedAt, activeBreak?.breakStartTime, activeBreak?.startTime, entry?.breakStart, entry?.break_start) } : null,
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

export function normalizeHomeServiceConnectedTimesheetRecord(value: unknown): HomeServiceConnectedTimesheetRecord | null {
  const record = asRecord(value);
  const id = firstNumber(record?.id, record?.recordId);
  if (!id) return null;
  return {
    id,
    memberName: firstString(record?.memberName, record?.fullName, record?.full_name) ?? "Team Member",
    date: firstString(record?.date, record?.workDate, record?.work_date) ?? "",
    clockIn: firstString(record?.clockIn, record?.clock_in, record?.clockInAt),
    clockOut: firstString(record?.clockOut, record?.clock_out, record?.clockOutAt),
    breakStart: firstString(record?.breakStart, record?.break_start),
    breakEnd: firstString(record?.breakEnd, record?.break_end),
    totalHours: nullableNumber(record?.totalHours, record?.total_hours),
  };
}

export function normalizeHomeServiceConnectedTimesheets(payload: unknown): HomeServiceConnectedTimesheetRecord[] {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const records = Array.isArray(data.records) ? data.records : Array.isArray(root?.records) ? root.records : [];
  return records.flatMap((value) => {
    const record = normalizeHomeServiceConnectedTimesheetRecord(value);
    return record ? [record] : [];
  });
}

export function normalizeHomeServiceConnectedTeamTimeSummary(payload: unknown): HomeServiceConnectedTeamTimeMember[] {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const members = Array.isArray(data.members) ? data.members : Array.isArray(root?.members) ? root.members : [];
  return members.flatMap((value) => {
    const member = asRecord(value);
    const id = firstNumber(member?.id, member?.userId);
    const name = firstString(member?.name, member?.fullName, member?.memberName);
    if (!id || !name) return [];
    return [{
      id,
      memberId: firstString(member?.memberId, member?.member_id),
      name,
      availability: firstString(member?.availability) ?? "available",
      clockedIn: booleanState(member?.clockedIn) || Boolean(firstString(member?.clockIn, member?.clock_in)),
      clockIn: firstString(member?.clockIn, member?.clock_in),
      todayHours: nullableNumber(member?.todayHours, member?.today_hours) ?? 0,
    }];
  });
}

export function normalizeHomeServiceConnectedTimeOffRequest(value: unknown): HomeServiceConnectedTimeOffRequest | null {
  const request = asRecord(value);
  const id = firstNumber(request?.id, request?.requestId);
  if (!id) return null;
  return {
    id,
    userId: firstNumber(request?.userId, request?.user_id) ?? 0,
    memberName: firstString(request?.memberName, request?.member_name, request?.fullName) ?? "Team Member",
    startDate: firstString(request?.startDate, request?.start_date) ?? "",
    endDate: firstString(request?.endDate, request?.end_date) ?? "",
    hoursRequested: nullableNumber(request?.hoursRequested, request?.hours_requested) ?? 0,
    requestType: firstString(request?.requestType, request?.request_type) ?? "other",
    reason: firstString(request?.reason),
    status: firstString(request?.status, request?.requestStatus, request?.request_status) ?? "pending",
    reviewerNote: firstString(request?.reviewerNote, request?.reviewer_note),
    reviewedAt: firstString(request?.reviewedAt, request?.reviewed_at),
    createdAt: firstString(request?.createdAt, request?.created_at),
  };
}

export function normalizeHomeServiceConnectedTimeOffList(payload: unknown): HomeServiceConnectedTimeOffList {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const requests = Array.isArray(data.requests) ? data.requests : Array.isArray(root?.requests) ? root.requests : [];
  return {
    canReview: data.canReview === true || root?.canReview === true,
    requests: requests.flatMap((value) => {
      const request = normalizeHomeServiceConnectedTimeOffRequest(value);
      return request ? [request] : [];
    }),
  };
}

export function normalizeHomeServiceConnectedTimeOffReview(payload: unknown): HomeServiceConnectedTimeOffReview {
  const root = asRecord(payload) ?? {};
  const ids = (value: unknown) => Array.isArray(value)
    ? value.flatMap((item) => {
      const id = firstNumber(item);
      return id ? [id] : [];
    })
    : [];
  const coveredJobIds = ids(root.coveredJobIds);
  const inFieldJobIds = ids(root.inFieldJobIds);
  return {
    success: root.success !== false,
    requestId: firstNumber(root.requestId) ?? 0,
    status: firstString(root.status) ?? "pending",
    approved: root.approved === true || firstString(root.status) === "approved",
    coveredJobIds,
    inFieldJobIds,
    coveredCount: nullableNumber(root.coveredCount) ?? coveredJobIds.length,
    inFieldCount: nullableNumber(root.inFieldCount) ?? inFieldJobIds.length,
  };
}

function timeRangeQuery(input?: { start?: string; end?: string; memberId?: number }) {
  const params = new URLSearchParams();
  if (input?.start) params.set("start", input.start);
  if (input?.end) params.set("end", input.end);
  if (input?.memberId && Number.isSafeInteger(input.memberId) && input.memberId > 0) {
    params.set("memberId", String(input.memberId));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function getHomeServiceConnectedTimesheets(
  token: string,
  input?: { start?: string; end?: string; memberId?: number },
) {
  const payload = await requestJson(`${TIME_TIMESHEETS_PATH}${timeRangeQuery(input)}`, {
    method: "GET",
    headers: createJobSyncBearerHeaders(token),
  });
  return normalizeHomeServiceConnectedTimesheets(payload);
}

export async function getHomeServiceConnectedTeamTimeSummary(token: string) {
  const payload = await requestJson(TIME_TEAM_SUMMARY_PATH, {
    method: "GET",
    headers: createJobSyncBearerHeaders(token),
  });
  return normalizeHomeServiceConnectedTeamTimeSummary(payload);
}

export async function getHomeServiceConnectedTimeOff(token: string) {
  const payload = await requestJson(TIME_OFF_PATH, {
    method: "GET",
    headers: createJobSyncBearerHeaders(token),
  });
  return normalizeHomeServiceConnectedTimeOffList(payload);
}

export async function createHomeServiceConnectedTimeOff(token: string, input: {
  startDate: string;
  endDate: string;
  hoursRequested: number;
  requestType: HomeServiceConnectedTimeOffRequestType;
  reason?: string;
}) {
  return requestJson(TIME_OFF_PATH, {
    method: "POST",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify(sanitizeCompanyTimeMutationBody({
      startDate: input.startDate,
      endDate: input.endDate,
      hoursRequested: input.hoursRequested,
      requestType: input.requestType,
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
    })),
  });
}

export async function reviewHomeServiceConnectedTimeOff(
  token: string,
  requestId: number,
  input: { status: "approved" | "denied"; reviewerNote?: string },
) {
  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    throw new Error("A valid Company Time Off request ID is required.");
  }
  const payload = await requestJson(`${TIME_OFF_PATH}/${encodeURIComponent(String(requestId))}/review`, {
    method: "PATCH",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify(sanitizeCompanyTimeMutationBody({
      status: input.status,
      ...(input.reviewerNote?.trim() ? { reviewerNote: input.reviewerNote.trim() } : {}),
    })),
  });
  return normalizeHomeServiceConnectedTimeOffReview(payload);
}

export function sumHomeServiceConnectedTimesheetHours(records: HomeServiceConnectedTimesheetRecord[]) {
  return records.reduce((sum, record) => sum + (record.totalHours ?? 0), 0);
}
