import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  COMPANY_FINANCIAL_LEGACY_FALLTHROUGH_BLOCKED,
  COMPANY_LOCAL_FINANCIAL_MUTATIONS,
  COMPANY_PAYMENT_CONTROLS,
  addJobLocalCustomerSearchEnabled,
  allowsLegacyFinancialAuthority,
  companyAddJobUsesCanonicalCustomers,
  companyCanonicalListState,
  companyCustomerProfileMountsLocalFinancialActions,
  companyCustomersUseCanonicalRead,
  companyFinanceUsesCanonicalAuthority,
  companyFinancialSurfaceMount,
  companyLegacyTtpSettingsReachable,
  companyLocalFinancialMutationAllowed,
  companySavedCardsReachable,
  companyScheduleCheckoutMounted,
  companyScheduleLegacyPaymentQueryEnabled,
  forbidLegacyCompanyFinancialAuthority,
  resolveCompanyFinanceDisplay,
  resolveCompanyFinancialAuthority,
  resolveCompanyFinancialMountedSurface,
  resolveCompanyFinancialScreen,
  usesCompanyFinancialAuthority,
} from "../lib/jobsync-company-authority";
import {
  getJobSyncCompanyCustomer,
  getJobSyncCompanyCustomers,
  getJobSyncCompanyFinance,
  normalizeJobSyncCompanyFinance,
} from "../lib/jobsync-mobile-api";

const financeSource = readFileSync(new URL("../app/(tabs)/admin-finance.tsx", import.meta.url), "utf8");
const customersSource = readFileSync(new URL("../app/(tabs)/admin-customers.tsx", import.meta.url), "utf8");
const salesCustomersSource = readFileSync(new URL("../app/(sales)/customers.tsx", import.meta.url), "utf8");
const profileSource = readFileSync(new URL("../app/(tabs)/admin-customer-profile.tsx", import.meta.url), "utf8");
const expensesSource = readFileSync(new URL("../app/(tabs)/expenses.tsx", import.meta.url), "utf8");
const gateSource = readFileSync(new URL("../components/company-financial-gate.tsx", import.meta.url), "utf8");
const companyFinanceSource = readFileSync(new URL("../components/company-finance-panel.tsx", import.meta.url), "utf8");
const companyCustomersSource = readFileSync(new URL("../components/company-customers-panel.tsx", import.meta.url), "utf8");
const companyProfileSource = readFileSync(new URL("../components/company-customer-profile-panel.tsx", import.meta.url), "utf8");
const invoicesSource = readFileSync(new URL("../app/(tabs)/admin-invoices.tsx", import.meta.url), "utf8");
const unpaidSource = readFileSync(new URL("../app/(tabs)/admin-unpaid-jobs.tsx", import.meta.url), "utf8");
const scheduleSource = readFileSync(new URL("../app/(tabs)/schedule.tsx", import.meta.url), "utf8");
const adminScheduleSource = readFileSync(new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url), "utf8");
const addJobSource = readFileSync(new URL("../components/add-job-modal.tsx", import.meta.url), "utf8");
const timesheetSource = readFileSync(new URL("../app/(tabs)/timesheet.tsx", import.meta.url), "utf8");
const requestOffSource = readFileSync(new URL("../app/(tabs)/request-off.tsx", import.meta.url), "utf8");
const clockHeaderSource = readFileSync(new URL("../components/header-clock-status.tsx", import.meta.url), "utf8");

const companySession = {
  token: "company-token",
  portal: "company" as const,
  user: { id: 42, name: "Alex Tech", email: "alex@example.com", role: "owner" as const },
};

function mockOk(body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => body,
  } as Response);
}

function mockFail(message: string, status = 503) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: { message } }),
  } as Response);
}

describe("M3A Company financial containment", () => {
  it("classifies UNKNOWN before any local financial surface can mount", () => {
    const unknown = resolveCompanyFinancialMountedSurface({ session: null, sessionLoading: true });
    expect(resolveCompanyFinancialAuthority({ session: null, sessionLoading: true })).toBe("unknown");
    expect(resolveCompanyFinancialScreen("unknown")).toBe("loading");
    expect(unknown.screen).toBe("loading");
    expect(unknown.mountsLocalFinance).toBe(false);
    expect(unknown.mountsLocalCustomers).toBe(false);
    expect(unknown.mountsLocalCustomerProfile).toBe(false);
    expect(unknown.mountsSavedCards).toBe(false);
    expect(unknown.mountsLocalStripe).toBe(false);
    expect(unknown.mountsLocalEstimates).toBe(false);
    expect(unknown.mountsTapToPaySettings).toBe(false);
    expect(unknown.mountsLocalReceipts).toBe(false);
    expect(unknown.mountsLocalPaymentMutations).toBe(false);
    expect(unknown.mountsLocalFinanceWrites).toBe(false);
    expect(allowsLegacyFinancialAuthority("unknown")).toBe(false);
    expect(usesCompanyFinancialAuthority("unknown")).toBe(false);
    expect(companyFinancialSurfaceMount("unknown", "finance")).toBe("blocked");
    expect(companyFinancialSurfaceMount("unknown", "customers")).toBe("blocked");
    expect(companyFinancialSurfaceMount("unknown", "customerProfile")).toBe("blocked");
    expect(companyFinancialSurfaceMount("unknown", "savedCards")).toBe("blocked");
    expect(companyFinancialSurfaceMount("unknown", "localStripe")).toBe("blocked");
    expect(companyFinancialSurfaceMount("unknown", "localEstimates")).toBe("blocked");
    expect(companyFinancialSurfaceMount("unknown", "tapToPaySettings")).toBe("blocked");
    expect(gateSource).toContain("resolveCompanyFinancialMountedSurface");
    expect(gateSource).toContain('mounted.screen === "loading"');
    expect(gateSource).toContain("legacy()");
    expect(financeSource).toContain("CompanyFinancialGate");
    expect(customersSource).toContain("CompanyFinancialGate");
    expect(profileSource).toContain("CompanyFinancialGate");
    expect(salesCustomersSource).toContain("CompanyFinancialGate");
    expect(expensesSource).toContain("CompanyFinancialGate");
  });

  it("keeps Company Finance on the canonical JobSync Finance read and off local trpc.finance", async () => {
    const fetchMock = mockOk({
      finance: {
        income: 1200,
        expenses: 400,
        netCashMovement: 800,
        collected: 900,
        outstanding: 150,
        bookedRevenue: 1100,
        invoiceCount: 3,
        billedTotal: 1100,
        collectedTotal: 900,
        openBalance: 150,
        pastDueBalance: 0,
        reportingMonth: "2026-09",
        reportingTimezone: "America/Chicago",
        transactions: [{ id: "finance-1", type: "income", category: "Job payment", amount: 900, description: "Job 44", date: "2026-09-18" }],
        definitions: { collected: "PaymentService net collections" },
      },
    });
    try {
      const finance = await getJobSyncCompanyFinance("company-token");
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/finance");
      expect(finance).toMatchObject({ income: 1200, expenses: 400, collected: 900, outstanding: 150, bookedRevenue: 1100 });
    } finally {
      fetchMock.mockRestore();
    }

    const company = resolveCompanyFinancialMountedSurface({ session: companySession, sessionLoading: false });
    expect(company.screen).toBe("company");
    expect(company.mountsCanonicalFinance).toBe(true);
    expect(company.mountsLocalFinance).toBe(false);
    expect(company.mountsLocalFinanceWrites).toBe(false);
    expect(companyFinancialSurfaceMount("company", "finance")).toBe("company-canonical");
    expect(companyFinanceUsesCanonicalAuthority()).toBe(true);
    expect(companyFinanceSource).toContain("getJobSyncCompanyFinance");
    expect(companyFinanceSource).toContain("resolveCompanyFinanceDisplay");
    expect(companyFinanceSource).not.toContain("trpc.finance");
    expect(companyFinanceSource).not.toContain("financeDb");
    expect(companyFinanceSource).not.toContain("TTPSettingsPanel");
    expect(companyFinanceSource).not.toContain("useTTP");
    expect(financeSource).toContain("CompanyFinancePanel");
    expect(financeSource).toContain("LegacyAdminFinanceScreen");
    expect(financeSource).toContain("trpc.finance.getSummary");
    expect(financeSource).toContain("TTPSettingsPanel");
  });

  it("does not treat a canonical Finance API failure as a legitimate zero", async () => {
    const fetchMock = mockFail("Home Service Connected operations are temporarily unavailable.");
    try {
      await expect(getJobSyncCompanyFinance("company-token")).rejects.toThrow(
        "Home Service Connected operations are temporarily unavailable.",
      );
    } finally {
      fetchMock.mockRestore();
    }
    expect(() => normalizeJobSyncCompanyFinance({})).toThrow("Home Service Connected returned an invalid finance response.");
    expect(() => normalizeJobSyncCompanyFinance({ finance: {} })).toThrow("Home Service Connected returned an invalid finance response.");
    const failed = resolveCompanyFinanceDisplay({
      mode: "company",
      finance: null,
      error: "Home Service Connected operations are temporarily unavailable.",
      loading: false,
    });
    expect(failed.state).toBe("error");
    expect(failed.finance).toBeNull();
    expect(companyCanonicalListState({ loading: false, error: "Home Service Connected operations are temporarily unavailable.", itemCount: 0 })).toBe("error");
    expect(companyCanonicalListState({ loading: false, error: "unavailable", itemCount: 0 })).not.toBe("empty");
    const zero = resolveCompanyFinanceDisplay({
      mode: "company",
      finance: { income: 0 },
      error: null,
      loading: false,
    });
    expect(zero.state).toBe("ready");
    expect(zero.finance?.income).toBe(0);
    expect(companyFinanceSource).toContain('display.state === "error"');
    expect(companyFinanceSource).toContain("Company Finance is unavailable");
    expect(companyFinanceSource).not.toContain("totalIncome: 0");
  });

  it("reads Company customers from canonical fs_customers and never listAll", async () => {
    const listMock = mockOk({
      customers: [{ id: 8, firstName: "Casey", lastName: "Owner", email: "casey@example.com", phone: "555-0100", addressLine1: "1 Main St", city: "Mobile" }],
    });
    try {
      const customers = await getJobSyncCompanyCustomers("company-token");
      expect(String(listMock.mock.calls[0][0])).toContain("/api/mobile/v1/customers");
      expect(customers[0]).toMatchObject({ id: 8, name: "Casey Owner" });
    } finally {
      listMock.mockRestore();
    }

    const detailMock = mockOk({
      customer: {
        id: 8,
        firstName: "Casey",
        lastName: "Owner",
        email: "casey@example.com",
        phone: "555-0100",
        addressLine1: "1 Main St",
        city: "Mobile",
        vehicle: { make: "Honda", model: "CR-V", year: "2020", type: "suv" },
        doNotService: false,
      },
    });
    try {
      const customer = await getJobSyncCompanyCustomer("company-token", 8);
      expect(String(detailMock.mock.calls[0][0])).toContain("/api/mobile/v1/customers/8");
      expect(customer).toMatchObject({ id: 8, name: "Casey Owner", vehicleMake: "Honda", doNotService: false });
    } finally {
      detailMock.mockRestore();
    }

    const company = resolveCompanyFinancialMountedSurface({ session: companySession, sessionLoading: false });
    expect(company.mountsCanonicalCustomers).toBe(true);
    expect(company.mountsLocalCustomers).toBe(false);
    expect(companyCustomersUseCanonicalRead()).toBe(true);
    expect(companyCustomersSource).toContain("getJobSyncCompanyCustomers");
    expect(companyCustomersSource).not.toContain("customers.listAll");
    expect(companyCustomersSource).not.toContain("lifetimeValue");
    expect(customersSource).toContain("CompanyCustomersPanel");
    expect(customersSource).toContain("LegacyAdminCustomersScreen");
    expect(customersSource).toContain("customers.listAll");
    expect(salesCustomersSource).toContain("CompanyCustomersPanel");
  });

  it("blocks Company customer profile from every local financial mutation", () => {
    const company = resolveCompanyFinancialMountedSurface({ session: companySession, sessionLoading: false });
    expect(company.mountsCanonicalCustomerProfile).toBe(true);
    expect(company.mountsLocalCustomerProfile).toBe(false);
    expect(company.mountsSavedCards).toBe(false);
    expect(company.mountsLocalStripe).toBe(false);
    expect(company.mountsLocalEstimates).toBe(false);
    expect(company.mountsLocalReceipts).toBe(false);
    expect(company.mountsLocalPaymentMutations).toBe(false);
    expect(companyCustomerProfileMountsLocalFinancialActions()).toBe(false);
    expect(companySavedCardsReachable()).toBe(false);
    expect(companyLocalFinancialMutationAllowed("company", "savedCards.chargeCard")).toBe(false);
    expect(companyLocalFinancialMutationAllowed("unknown", "savedCards.saveCard")).toBe(false);
    for (const mutation of COMPANY_LOCAL_FINANCIAL_MUTATIONS) {
      expect(companyLocalFinancialMutationAllowed("company", mutation)).toBe(false);
    }
    expect(() => forbidLegacyCompanyFinancialAuthority(true, "savedCards.chargeCard")).toThrow(COMPANY_FINANCIAL_LEGACY_FALLTHROUGH_BLOCKED);
    expect(companyProfileSource).toContain("getJobSyncCompanyCustomer");
    expect(companyProfileSource).not.toContain("savedCards");
    expect(companyProfileSource).not.toContain("chargeCard");
    expect(companyProfileSource).not.toContain("saveCard");
    expect(companyProfileSource).not.toContain("createSetupIntent");
    expect(companyProfileSource).not.toContain("trpc.stripe");
    expect(companyProfileSource).not.toContain("refundPayment");
    expect(companyProfileSource).not.toContain("markPaid");
    expect(companyProfileSource).not.toContain("savePayment");
    expect(companyProfileSource).not.toContain("reconcileFromStripe");
    expect(companyProfileSource).not.toContain("estimates.create");
    expect(companyProfileSource).not.toContain("estimates.delete");
    expect(companyProfileSource).not.toContain("sendReceipt");
    expect(companyProfileSource).toContain("Local saved cards, Stripe, estimates, receipts, and payment actions stay unmounted");
    expect(profileSource).toContain("CompanyCustomerProfilePanel");
    expect(profileSource).toContain("LegacyAdminCustomerProfileScreen");
    expect(profileSource).toContain("savedCards.chargeCard");
    expect(profileSource).toContain("savedCards.saveCard");
    expect(profileSource).toContain("savedCards.createSetupIntent");
    expect(profileSource).toContain("estimates.create");
    expect(profileSource).toContain("jobs.sendReceipt");
    expect(COMPANY_PAYMENT_CONTROLS).toMatchObject({
      savedCardCharging: false,
      paymentIntentCreation: false,
      refunds: false,
      recordPayment: false,
    });
  });

  it("cannot mount legacy Tap to Pay settings in Company or UNKNOWN", () => {
    expect(companyFinancialSurfaceMount("company", "tapToPaySettings")).toBe("blocked");
    expect(companyFinancialSurfaceMount("unknown", "tapToPaySettings")).toBe("blocked");
    expect(companyLegacyTtpSettingsReachable()).toBe(false);
    expect(resolveCompanyFinancialMountedSurface({ session: companySession, sessionLoading: false }).mountsTapToPaySettings).toBe(false);
    expect(companyFinanceSource).not.toContain("TTPSettingsPanel");
    expect(companyFinanceSource).not.toContain("useTTP");
    expect(financeSource).toContain("<TTPSettingsPanel");
    expect(financeSource).toContain("LegacyAdminFinanceScreen");
  });

  it("preserves explicit legacy Finance, Customers, saved cards, estimates, and TTP", () => {
    const legacy = resolveCompanyFinancialMountedSurface({ session: null, sessionLoading: false });
    expect(legacy.authority).toBe("legacy");
    expect(legacy.screen).toBe("legacy");
    expect(legacy.mountsLocalFinance).toBe(true);
    expect(legacy.mountsLocalCustomers).toBe(true);
    expect(legacy.mountsLocalCustomerProfile).toBe(true);
    expect(legacy.mountsSavedCards).toBe(true);
    expect(legacy.mountsLocalEstimates).toBe(true);
    expect(legacy.mountsTapToPaySettings).toBe(true);
    expect(allowsLegacyFinancialAuthority("legacy")).toBe(true);
    expect(companyLocalFinancialMutationAllowed("legacy", "savedCards.chargeCard")).toBe(true);
    expect(companyFinancialSurfaceMount("legacy", "finance")).toBe("legacy");
    expect(companyFinancialSurfaceMount("legacy", "savedCards")).toBe("legacy");
    expect(companyFinancialSurfaceMount("legacy", "tapToPaySettings")).toBe("legacy");
    expect(() => forbidLegacyCompanyFinancialAuthority(false, "savedCards.chargeCard")).not.toThrow();
    expect(financeSource).toContain("function LegacyAdminFinanceScreen");
    expect(financeSource).toContain("trpc.finance.createTransaction");
    expect(financeSource).toContain("TTPSettingsPanel");
    expect(customersSource).toContain("function LegacyAdminCustomersScreen");
    expect(customersSource).toContain("trpc.customers.listAll");
    expect(profileSource).toContain("function LegacyAdminCustomerProfileScreen");
    expect(profileSource).toContain("trpc.savedCards.list");
    expect(profileSource).toContain("trpc.estimates.create");
    expect(expensesSource).toContain("function LegacyExpensesScreen");
    expect(expensesSource).toContain("trpc.finance.getMyExpenses");
  });

  it("keeps M1 Job / Schedule / Invoice / Unpaid contracts intact", () => {
    expect(scheduleSource).toContain("resolveCompanyJobAuthority");
    expect(scheduleSource).toContain("Card collection is disabled for Company Jobs.");
    expect(invoicesSource).toContain("getJobSyncCompanyInvoices");
    expect(invoicesSource).toContain("enabled: allowLegacy");
    expect(unpaidSource).toContain("getJobSyncCompanyUnpaidJobs");
    expect(unpaidSource).toContain("Card, Apple Pay, Tap to Pay, and local mark-paid stay disabled.");
  });

  it("never enables Add Job listAll for Company or UNKNOWN authority", () => {
    expect(companyAddJobUsesCanonicalCustomers("unknown")).toBe(true);
    expect(companyAddJobUsesCanonicalCustomers("company")).toBe(true);
    expect(companyAddJobUsesCanonicalCustomers("legacy")).toBe(false);
    expect(addJobLocalCustomerSearchEnabled({ allowLegacyCustomerSearch: false, searchTerm: "casey" })).toBe(false);
    expect(addJobLocalCustomerSearchEnabled({ allowLegacyCustomerSearch: true, searchTerm: "c" })).toBe(false);
    expect(addJobLocalCustomerSearchEnabled({ allowLegacyCustomerSearch: true, searchTerm: "casey" })).toBe(true);
    for (const mode of ["unknown", "company"] as const) {
      expect(addJobLocalCustomerSearchEnabled({
        allowLegacyCustomerSearch: !companyAddJobUsesCanonicalCustomers(mode),
        searchTerm: "casey owner",
      })).toBe(false);
    }
    expect(addJobSource).toContain("addJobLocalCustomerSearchEnabled");
    expect(addJobSource).toContain("companyAddJobUsesCanonicalCustomers(companyAuthority)");
    expect(addJobSource).toContain("allowLegacyCustomerSearch={allowLegacy}");
    expect(addJobSource).not.toContain("companyCustomers={isJobSyncCompany ? companyCustomers : undefined}");
    expect(adminScheduleSource).toContain("addJobLocalCustomerSearchEnabled");
    expect(adminScheduleSource).toContain("companyAddJobUsesCanonicalCustomers(companyAuthority)");
    expect(adminScheduleSource).toContain("allowLegacyCustomerSearch={allowLegacyJobAuthority}");
    expect(adminScheduleSource).not.toContain("companyCustomers={isJobSyncCompany ? companyCustomers : undefined}");
    expect(adminScheduleSource).not.toContain("enabled: !companyCustomers && searchTerm.length >= 2");
    expect(addJobSource).not.toContain("enabled: !companyCustomers && searchTerm.length >= 2");
  });

  it("cannot execute Schedule legacy payment mutations or queries in Company or UNKNOWN", () => {
    expect(companyScheduleCheckoutMounted({ authority: "unknown", showCheckout: true })).toBe(false);
    expect(companyScheduleCheckoutMounted({ authority: "company", showCheckout: true })).toBe(false);
    expect(companyScheduleCheckoutMounted({ authority: "legacy", showCheckout: true })).toBe(true);
    expect(companyScheduleCheckoutMounted({ authority: "legacy", showCheckout: false })).toBe(false);
    expect(companyScheduleLegacyPaymentQueryEnabled({ authority: "unknown", selected: true })).toBe(false);
    expect(companyScheduleLegacyPaymentQueryEnabled({ authority: "company", selected: true })).toBe(false);
    expect(companyScheduleLegacyPaymentQueryEnabled({ authority: "legacy", selected: true })).toBe(true);
    expect(companyLocalFinancialMutationAllowed("unknown", "savedCards.chargeCard")).toBe(false);
    expect(companyLocalFinancialMutationAllowed("company", "stripe.refundPayment")).toBe(false);
    expect(companyLocalFinancialMutationAllowed("legacy", "stripe.refundPayment")).toBe(true);
    expect(scheduleSource).toContain("companyScheduleCheckoutMounted({ authority: companyAuthority, showCheckout })");
    expect(scheduleSource).toContain("{allowLegacyJobAuthority ? !selectedJob.payment ? (");
    expect(scheduleSource).toContain("if (!allowLegacyJobAuthority || !selectedJob?.payment) return;");
    expect(adminScheduleSource).toContain("companyScheduleLegacyPaymentQueryEnabled");
    expect(adminScheduleSource).toContain("if (!allowLegacyJobAuthority || !selectedJob?.payment?.paymentIntentId) return;");
    expect(adminScheduleSource).toContain("{selectedJob && allowLegacyJobAuthority && (");
    expect(adminScheduleSource).toContain("visible={showChargeModal && allowLegacyJobAuthority}");
    expect(adminScheduleSource).toContain("if (!allowLegacyJobAuthority) return;");
  });

  it("does not mount TTPProvider or initialize Stripe Terminal from the app tree", () => {
    const layoutSource = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
    const ttpSource = readFileSync(new URL("../lib/ttp-context.tsx", import.meta.url), "utf8");
    expect(layoutSource).not.toContain("TTPProvider");
    expect(ttpSource).not.toContain("@stripe/stripe-terminal");
    expect(ttpSource).not.toContain("StripeTerminal");
    expect(ttpSource).not.toContain("discoverReaders");
    expect(ttpSource).not.toContain("connectionToken");
    expect(ttpSource).not.toContain("PaymentIntent");
    expect(companyFinanceSource).not.toContain("TTPSettingsPanel");
  });

  it("keeps M2 Clock / Timesheets / Time Off contracts intact", () => {
    expect(clockHeaderSource).toContain("resolveCompanyTimekeepingAuthority");
    expect(timesheetSource).toContain("resolveCompanyTimekeepingAuthority");
    expect(timesheetSource).toContain("CompanyTimesheetPanel");
    expect(requestOffSource).toContain("resolveCompanyTimeOffAuthority");
  });
});
