import type {
  JobSyncCanonicalJobStatus,
  JobSyncCompanyInvoice,
  JobSyncCompanyUnpaidJob,
  JobSyncMobileJob,
  JobSyncNativeSession,
} from "@/lib/jobsync-mobile-api";

export const COMPANY_LEGACY_FALLTHROUGH_BLOCKED =
  "Company Jobs cannot use local schedule, invoice, or payment authority.";

export const COMPANY_TIMEKEEPING_LEGACY_FALLTHROUGH_BLOCKED =
  "Company Clock and Timesheets cannot use local timekeeping authority.";

export const COMPANY_TIME_OFF_LEGACY_FALLTHROUGH_BLOCKED =
  "Company Time Off cannot use local time-off authority.";

export const COMPANY_FINANCIAL_LEGACY_FALLTHROUGH_BLOCKED =
  "Company Finance, Customers, and payment surfaces cannot use local Luxury Wash financial authority.";

export const COMPANY_PRICE_BOOK_LEGACY_FALLTHROUGH_BLOCKED =
  "Company Price Book cannot use local Luxury Wash price book authority.";

export const COMPANY_PRICE_BOOK_WEB_AUTHORITY_NOTICE =
  "Create, edit, activate, and deactivate services on the Home Service Connected web Price Book. Mobile reads the same canonical catalog for Job creation.";

export const COMPANY_PAYMENT_CONTROLS = {
  card: false,
  applePay: false,
  tapToPay: false,
  savedCardCharging: false,
  paymentIntentCreation: false,
  refunds: false,
  recordPayment: false,
} as const;

export const STANDALONE_INVOICE_CLASSIFICATION = {
  table: "standalone_invoices",
  classification: "C",
  meaning: "legacy Luxury Wash standalone billing",
  companyUse: "isolated",
  secondJobReceivable: false,
  /**
   * Authority boundary (Phase 1):
   * - Job receivables/invoices/unpaid = canonical jobsync Job AR (fs_jobs + PaymentService)
   * - standalone_invoices = non-Job / Luxury Wash legacy only; never created for HSC Company Job balances
   */
  jobArAuthority: "jobsync PaymentService over fs_jobs",
} as const;

export type CompanyScheduleJobFields = {
  id: string;
  location: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  serviceTitle: string;
  serviceDescription: string;
  price: number;
  paidTotal: number;
  refundTotal: number;
  appliedEstimateCredit: number;
  balance: number;
  paymentStatus: string;
  startHour: number;
  endHour: number;
  dayIndex: number;
  weekOffset: number;
  status: "scheduled" | "on_my_way" | "arrived" | "started" | "finished" | "cancelled";
  _rawStatus: string;
  detailerName?: string;
  assignedTo?: string;
  tags: string[];
  taxAmount: number;
  discountAmount: number;
  depositAmount: number;
  upsellTotal: number;
  additionalVehicles: never[];
  createdAt: string;
};

export type CompanyJobAuthorityMode = "company" | "legacy" | "unknown";

export function isJobSyncCompanySession(session: JobSyncNativeSession | null | undefined): session is JobSyncNativeSession & { portal: "company"; token: string } {
  return session?.portal === "company" && Boolean(session.token);
}

export function resolveCompanyJobAuthority(input: {
  session?: JobSyncNativeSession | null;
  sessionLoading?: boolean;
}): CompanyJobAuthorityMode {
  if (input.sessionLoading) return "unknown";
  return isJobSyncCompanySession(input.session) ? "company" : "legacy";
}

export function usesCompanyJobAuthority(mode: CompanyJobAuthorityMode) {
  return mode === "company";
}

export function allowsLegacyJobAuthority(mode: CompanyJobAuthorityMode) {
  return mode === "legacy";
}

export function forbidLegacyCompanyJobAuthority(isCompanySession: boolean, action = "this Job action") {
  if (isCompanySession) {
    throw new Error(`${COMPANY_LEGACY_FALLTHROUGH_BLOCKED} (${action})`);
  }
}

export const resolveCompanyTimekeepingAuthority = resolveCompanyJobAuthority;
export const usesCompanyTimekeepingAuthority = usesCompanyJobAuthority;
export const allowsLegacyTimekeepingAuthority = allowsLegacyJobAuthority;
export const resolveCompanyTimeOffAuthority = resolveCompanyJobAuthority;
export const usesCompanyTimeOffAuthority = usesCompanyJobAuthority;
export const allowsLegacyTimeOffAuthority = allowsLegacyJobAuthority;
export const resolveCompanyFinancialAuthority = resolveCompanyJobAuthority;
export const usesCompanyFinancialAuthority = usesCompanyJobAuthority;
export const allowsLegacyFinancialAuthority = allowsLegacyJobAuthority;

export type CompanyFinancialScreen = "loading" | "company" | "legacy";
export type CompanyFinancialSurface =
  | "customers"
  | "customerProfile"
  | "finance"
  | "savedCards"
  | "localStripe"
  | "localEstimates"
  | "tapToPaySettings"
  | "localReceipts"
  | "localPaymentMutations"
  | "localFinanceWrites";

export const COMPANY_LOCAL_FINANCIAL_MUTATIONS = [
  "savedCards.chargeCard",
  "savedCards.saveCard",
  "savedCards.createSetupIntent",
  "savedCards.deleteCard",
  "savedCards.listCards",
  "savedCards.list",
  "stripe.createPaymentIntent",
  "stripe.scanCard",
  "stripe.refundPayment",
  "stripe.listRefunds",
  "jobs.markPaid",
  "jobs.savePayment",
  "jobs.reconcileFromStripe",
  "jobs.sendReceipt",
  "estimates.create",
  "estimates.delete",
  "estimates.listForCustomer",
  "finance.createTransaction",
  "finance.deleteTransaction",
  "finance.getSummary",
  "customers.listAll",
  "pricebook.upsert",
  "pricebook.delete",
  "pricebook.toggleActive",
  "pricebook.reorder",
  "pricebook.uploadServiceImage",
  "employee.create",
  "employee.update",
  "employee.deactivate",
] as const;

export function resolveCompanyFinancialScreen(mode: CompanyJobAuthorityMode): CompanyFinancialScreen {
  if (mode === "unknown") return "loading";
  if (mode === "company") return "company";
  return "legacy";
}

export function companyFinancialSurfaceMount(
  mode: CompanyJobAuthorityMode,
  surface: CompanyFinancialSurface,
): "blocked" | "company-canonical" | "legacy" {
  if (mode === "unknown") return "blocked";
  if (mode === "legacy") return "legacy";
  if (surface === "customers" || surface === "customerProfile" || surface === "finance") {
    return "company-canonical";
  }
  return "blocked";
}

export function companyLocalFinancialMutationAllowed(mode: CompanyJobAuthorityMode, _mutation?: string) {
  return mode === "legacy";
}

export function companyAddJobUsesCanonicalCustomers(mode: CompanyJobAuthorityMode) {
  return mode !== "legacy";
}

export function addJobLocalCustomerSearchEnabled(input: {
  allowLegacyCustomerSearch: boolean;
  searchTerm: string;
}) {
  return input.allowLegacyCustomerSearch === true && input.searchTerm.trim().length >= 2;
}

export function companyScheduleCheckoutMounted(input: {
  authority: CompanyJobAuthorityMode;
  showCheckout: boolean;
}) {
  return input.authority === "legacy" && input.showCheckout;
}

export function companyScheduleLegacyPaymentQueryEnabled(input: {
  authority: CompanyJobAuthorityMode;
  selected: boolean;
}) {
  return input.authority === "legacy" && input.selected;
}

export function resolveCompanyFinancialMountedSurface(input: {
  session?: JobSyncNativeSession | null;
  sessionLoading?: boolean;
}) {
  const authority = resolveCompanyFinancialAuthority(input);
  const screen = resolveCompanyFinancialScreen(authority);
  const legacy = screen === "legacy";
  const company = screen === "company";
  return {
    authority,
    screen,
    mountsLocalFinance: legacy,
    mountsLocalCustomers: legacy,
    mountsLocalCustomerProfile: legacy,
    mountsSavedCards: legacy,
    mountsLocalStripe: legacy,
    mountsLocalEstimates: legacy,
    mountsTapToPaySettings: legacy,
    mountsLocalReceipts: legacy,
    mountsLocalPaymentMutations: legacy,
    mountsLocalFinanceWrites: legacy,
    mountsCanonicalFinance: company,
    mountsCanonicalCustomers: company,
    mountsCanonicalCustomerProfile: company,
  };
}

export function forbidLegacyCompanyFinancialAuthority(isCompanySession: boolean, action = "this financial action") {
  if (isCompanySession) {
    throw new Error(`${COMPANY_FINANCIAL_LEGACY_FALLTHROUGH_BLOCKED} (${action})`);
  }
}

export function companyFinanceUsesCanonicalAuthority(): true {
  return true;
}

export function companyCustomersUseCanonicalRead(): true {
  return true;
}

export function companyPriceBookUsesCanonicalRead(): true {
  return true;
}

export function companyPriceBookAllowsLocalMutation(mode: CompanyJobAuthorityMode) {
  return mode === "legacy";
}

export function companyTeamMembersUseCanonicalRead(): true {
  return true;
}

export function companyTeamMemberUpdateOmitsClientRole(): true {
  return true;
}

export function companyCustomerProfileMountsLocalFinancialActions(): false {
  return false;
}

export function companySavedCardsReachable(): false {
  return false;
}

export function companyLegacyTtpSettingsReachable(): false {
  return false;
}

export function resolveCompanyFinanceDisplay(input: {
  mode: CompanyJobAuthorityMode;
  finance: { income: number | null } | null;
  error: string | null;
  loading: boolean;
}): { state: "loading" | "error" | "ready"; finance: { income: number | null } | null } {
  if (input.mode === "unknown" || input.loading) return { state: "loading", finance: null };
  if (input.mode !== "company") return { state: "error", finance: null };
  if (input.error) return { state: "error", finance: null };
  if (!input.finance) return { state: "loading", finance: null };
  return { state: "ready", finance: input.finance };
}

export function forbidLegacyCompanyTimekeeping(isCompanySession: boolean, action = "this Clock action") {
  if (isCompanySession) {
    throw new Error(`${COMPANY_TIMEKEEPING_LEGACY_FALLTHROUGH_BLOCKED} (${action})`);
  }
}

export function forbidLegacyCompanyTimeOff(isCompanySession: boolean, action = "this Time Off action") {
  if (isCompanySession) {
    throw new Error(`${COMPANY_TIME_OFF_LEGACY_FALLTHROUGH_BLOCKED} (${action})`);
  }
}

export function companyClockUsesCanonicalAuthority(): true {
  return true;
}

export function companyTimesheetsWriteLocalLedger(): false {
  return false;
}

export function companyTimeOffWritesLocalRecord(): false {
  return false;
}

export function companyTimeOffDuplicatesScheduleConflictLogic(): false {
  return false;
}

export function companyCanonicalListState(input: { loading: boolean; error: string | null; itemCount: number }): "loading" | "error" | "empty" | "ready" {
  if (input.loading) return "loading";
  if (input.error) return "error";
  return input.itemCount === 0 ? "empty" : "ready";
}

export function resolveCompanyDisplayedHours(input: {
  mode: CompanyJobAuthorityMode;
  companyHours: number | null;
  companyHoursError: string | null;
  legacyHours: number | null;
}): { state: "loading" | "error" | "ready"; hours: number | null } {
  if (input.mode === "unknown") return { state: "loading", hours: null };
  if (input.mode === "company") {
    if (input.companyHoursError) return { state: "error", hours: null };
    if (input.companyHours == null) return { state: "loading", hours: null };
    return { state: "ready", hours: input.companyHours };
  }
  return { state: "ready", hours: input.legacyHours ?? 0 };
}

export function companyCanonicalReadError(error: unknown) {
  return error instanceof Error && error.message.trim() ? error.message : COMPANY_LEGACY_FALLTHROUGH_BLOCKED;
}

export function companyScheduleWritesLocalMirror(): false {
  return false;
}

export function hourFromIso(value: string | null, fallback: number) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.getHours() + date.getMinutes() / 60;
}

export function mapCanonicalJobToScheduleFields(job: JobSyncMobileJob, fallbackLocation: string): CompanyScheduleJobFields {
  const start = job.scheduledStartAt ? new Date(job.scheduledStartAt) : new Date();
  const end = job.scheduledEndAt ? new Date(job.scheduledEndAt) : null;
  const todayMonday = new Date();
  todayMonday.setDate(todayMonday.getDate() - (todayMonday.getDay() + 6) % 7);
  todayMonday.setHours(0, 0, 0, 0);
  const dayIndex = (start.getDay() + 6) % 7;
  const scheduledMonday = new Date(start);
  scheduledMonday.setDate(start.getDate() - dayIndex);
  scheduledMonday.setHours(0, 0, 0, 0);
  const customerParts = job.customerName.split(" ").filter(Boolean);
  const uiStatus =
    job.status === "completed" ? "finished" :
    job.status === "en_route" ? "on_my_way" :
    job.status === "on_site" ? "arrived" :
    job.status === "cancelled" ? "cancelled" :
    "scheduled";
  return {
    id: String(job.id),
    location: job.city || fallbackLocation,
    firstName: customerParts[0] || "",
    lastName: customerParts.slice(1).join(" "),
    email: "",
    phone: "",
    address: job.addressLine1 || "",
    serviceTitle: job.serviceName || job.title || "Service",
    serviceDescription: job.serviceName || job.title || "",
    price: job.amount,
    paidTotal: job.paidTotal,
    refundTotal: job.refundTotal,
    appliedEstimateCredit: job.appliedEstimateCredit,
    balance: job.balance,
    paymentStatus: job.paymentStatus,
    startHour: hourFromIso(job.scheduledStartAt, 8),
    endHour: end ? hourFromIso(job.scheduledEndAt, hourFromIso(job.scheduledStartAt, 8) + 1) : hourFromIso(job.scheduledStartAt, 8) + 1,
    dayIndex,
    weekOffset: Math.round((scheduledMonday.getTime() - todayMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)),
    status: uiStatus,
    _rawStatus: job.status,
    detailerName: job.assignedName || undefined,
    assignedTo: job.assignedUserId ? `jobsync-${job.assignedUserId}` : undefined,
    tags: [],
    taxAmount: 0,
    discountAmount: 0,
    depositAmount: 0,
    upsellTotal: 0,
    additionalVehicles: [],
    createdAt: job.updatedAt || start.toISOString(),
  };
}

export function nextCanonicalJobStatus(status: string | null | undefined): JobSyncCanonicalJobStatus | null {
  switch (status) {
    case "draft":
    case "scheduled":
      return "en_route";
    case "en_route":
      return "on_site";
    case "on_site":
    case "follow_up":
      return "completed";
    default:
      return null;
  }
}

export function canonicalJobId(jobId: string | number | null | undefined): number | null {
  const raw = typeof jobId === "number" ? jobId : Number(String(jobId ?? "").replace(/^jobsync-/, ""));
  return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
}

export function companyAssignedUserId(assignedTo: string | null | undefined): number | null {
  if (!assignedTo) return null;
  if (assignedTo.startsWith("jobsync-")) {
    const id = Number(assignedTo.slice("jobsync-".length));
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
  const numeric = Number(assignedTo);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

export function companyScheduleDateTime(dateStr: string, hour: number): string {
  const hours = Math.floor(hour);
  const minutes = hour % 1 >= 0.5 ? 30 : 0;
  return new Date(`${dateStr}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`).toISOString();
}

export function invoicePresentationFromCanonicalJob(job: JobSyncMobileJob | JobSyncCompanyInvoice) {
  const total = "amount" in job ? job.amount : job.total;
  const paid = "paidTotal" in job ? job.paidTotal : job.paid;
  const balance = job.balance;
  return {
    jobId: job.id,
    customerName: job.customerName,
    serviceName: job.serviceName,
    status: job.status,
    paymentStatus: job.paymentStatus,
    amount: total,
    amountPaid: paid,
    balanceDue: balance,
  };
}

export function unpaidJobFromCanonical(job: JobSyncCompanyUnpaidJob) {
  return {
    jobId: String(job.id),
    date: null,
    timeSlot: null,
    customerName: job.customerName,
    customerPhone: null,
    customerEmail: null,
    customerAddress: null,
    vehicleType: null,
    packageType: job.title,
    totalPrice: String(job.amount),
    customPrice: null,
    depositAmount: null,
    discountAmount: null,
    status: job.paymentStatus,
    assignedTo: null,
    notes: null,
    location: null,
    balanceDue: job.balance,
    paidTotal: job.paidTotal,
    amount: job.amount,
    paymentStatus: job.paymentStatus,
  };
}

export function classifyStandaloneInvoicesUse() {
  return STANDALONE_INVOICE_CLASSIFICATION;
}
