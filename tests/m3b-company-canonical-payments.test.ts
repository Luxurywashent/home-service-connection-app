import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  COMPANY_PAYMENT_CONTROLS,
  allowsLegacyFinancialAuthority,
  allowsLegacyJobAuthority,
  companyCanonicalPaymentWriterAllowed,
  companyCanonicalPaymentWriterMounted,
  companyFinancialSurfaceMount,
  companyLocalFinancialMutationAllowed,
  companySavedCardsReachable,
  companyScheduleCheckoutMounted,
  resolveCompanyFinancialMountedSurface,
  resolveCompanyJobAuthority,
  usesCompanyJobAuthority,
} from "../lib/jobsync-company-authority";
import {
  COMPANY_PAYMENT_REFRESH_FAILED,
  createCanonicalCheckoutRequest,
  createCanonicalManualPaymentRequest,
  manualPaymentRequestFingerprint,
  nextManualPaymentIdempotencyKey,
  nextManualPaymentRefreshState,
  resolveCompanyPaymentActions,
  shouldResubmitManualPaymentAfterRefreshFailure,
} from "../lib/jobsync-company-payment";
import {
  createJobSyncCompanyJobCheckout,
  createManualPaymentIdempotencyKey,
  getJobSyncCompanyJobPayments,
  recordJobSyncCompanyJobPayment,
  sanitizeCompanyPaymentBody,
} from "../lib/jobsync-mobile-api";

const apiSource = readFileSync(new URL("../lib/jobsync-mobile-api.ts", import.meta.url), "utf8");
const paymentHelperSource = readFileSync(new URL("../lib/jobsync-company-payment.ts", import.meta.url), "utf8");
const collectSource = readFileSync(new URL("../components/company-collect-payment.tsx", import.meta.url), "utf8");
const scheduleSource = readFileSync(new URL("../app/(tabs)/schedule.tsx", import.meta.url), "utf8");
const adminScheduleSource = readFileSync(new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url), "utf8");
const unpaidSource = readFileSync(new URL("../app/(tabs)/admin-unpaid-jobs.tsx", import.meta.url), "utf8");
const invoicesSource = readFileSync(new URL("../app/(tabs)/admin-invoices.tsx", import.meta.url), "utf8");
const profileSource = readFileSync(new URL("../components/company-customer-profile-panel.tsx", import.meta.url), "utf8");
const financeSource = readFileSync(new URL("../components/company-finance-panel.tsx", import.meta.url), "utf8");
const checkoutSource = readFileSync(new URL("../app/(tabs)/schedule.tsx", import.meta.url), "utf8");

function mockOk(body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => body,
  } as Response);
}

function mockSequence(...responses: Array<{ ok: boolean; status?: number; body: unknown }>) {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 400),
      json: async () => response.body,
    } as Response);
  }
  return fetchMock;
}

describe("M3B authority", () => {
  it("UNKNOWN cannot mount Company or legacy payment writers", () => {
    const unknown = resolveCompanyJobAuthority({ session: null, sessionLoading: true });
    expect(unknown).toBe("unknown");
    expect(companyCanonicalPaymentWriterMounted("unknown")).toBe(false);
    expect(companyCanonicalPaymentWriterAllowed("unknown", "owner")).toBe(false);
    expect(allowsLegacyJobAuthority("unknown")).toBe(false);
    expect(allowsLegacyFinancialAuthority("unknown")).toBe(false);
    expect(companyScheduleCheckoutMounted({ authority: "unknown", showCheckout: true })).toBe(false);
    expect(companyFinancialSurfaceMount("unknown", "localStripe")).toBe("blocked");
    expect(companyFinancialSurfaceMount("unknown", "savedCards")).toBe("blocked");
    expect(collectSource).toContain('authority === "unknown"');
    expect(collectSource).toContain("return null");
  });

  it("Company cannot invoke local saved cards, Stripe, markPaid, savePayment, or reconcile", () => {
    expect(COMPANY_PAYMENT_CONTROLS).toMatchObject({
      card: false,
      applePay: false,
      tapToPay: false,
      savedCardCharging: false,
      paymentIntentCreation: false,
      refunds: false,
      recordPayment: false,
    });
    expect(companySavedCardsReachable()).toBe(false);
    expect(companyLocalFinancialMutationAllowed("company", "savedCards.chargeCard")).toBe(false);
    expect(companyLocalFinancialMutationAllowed("company", "stripe.createPaymentIntent")).toBe(false);
    expect(companyLocalFinancialMutationAllowed("company", "jobs.markPaid")).toBe(false);
    expect(companyLocalFinancialMutationAllowed("company", "jobs.savePayment")).toBe(false);
    expect(companyLocalFinancialMutationAllowed("company", "jobs.reconcileFromStripe")).toBe(false);
    expect(resolveCompanyFinancialMountedSurface({
      session: { token: "t", portal: "company", user: { id: 1, name: "Casey", email: null, role: "owner" } },
      sessionLoading: false,
    })).toMatchObject({
      mountsSavedCards: false,
      mountsLocalStripe: false,
      mountsLocalPaymentMutations: false,
      mountsLocalFinanceWrites: false,
    });
    expect(collectSource).not.toContain("trpc.savedCards");
    expect(collectSource).not.toContain("trpc.stripe");
    expect(collectSource).not.toContain("jobs.markPaid");
    expect(collectSource).not.toContain("jobs.savePayment");
    expect(collectSource).not.toContain("reconcileFromStripe");
  });

  it("keeps legacy checkout and mark-paid available only in legacy mode", () => {
    expect(companyScheduleCheckoutMounted({ authority: "legacy", showCheckout: true })).toBe(true);
    expect(companyLocalFinancialMutationAllowed("legacy", "jobs.markPaid")).toBe(true);
    expect(usesCompanyJobAuthority("legacy")).toBe(false);
    expect(checkoutSource).toContain("companyScheduleCheckoutMounted");
    expect(adminScheduleSource).toContain("allowLegacyJobAuthority");
    expect(unpaidSource).toContain("trpc.jobs.markPaid");
  });
});

describe("M3B manual payment", () => {
  it("lets authorized Company roles open Record Payment and hides it from technicians", () => {
    expect(resolveCompanyPaymentActions({ mode: "company", role: "owner", jobStatus: "completed", balance: 80 }).canRecordManual).toBe(true);
    expect(resolveCompanyPaymentActions({ mode: "company", role: "dispatcher", jobStatus: "completed", balance: 80 }).canRecordManual).toBe(true);
    expect(resolveCompanyPaymentActions({ mode: "company", role: "technician", jobStatus: "completed", balance: 80 }).canRecordManual).toBe(false);
    expect(resolveCompanyPaymentActions({ mode: "company", role: "owner", jobStatus: "scheduled", balance: 80 }).canRecordManual).toBe(false);
    expect(collectSource).toContain("Only owners and dispatchers can collect payment");
    expect(collectSource).toContain("Complete the Job before recording");
  });

  it("builds a Job ID + canonical method request without company or Stripe authority", () => {
    const request = createCanonicalManualPaymentRequest({
      jobId: 501,
      amount: 40,
      method: "cash",
      idempotencyKey: "m3b-client-key-501",
    });
    expect(request.path).toBe("/api/mobile/v1/jobs/501/payments");
    expect(request.body).toEqual({ amount: 40, method: "cash", idempotencyKey: "m3b-client-key-501" });
    expect(request.body).not.toHaveProperty("companyId");
    expect(request.body).not.toHaveProperty("company_id");
    expect(request.body).not.toHaveProperty("role");
    expect(request.body).not.toHaveProperty("ownerId");
    expect(() => sanitizeCompanyPaymentBody({ amount: 40, method: "cash", companyId: 11 } as Record<string, unknown>)).toThrow(/Company identity/);
    expect(() => createCanonicalManualPaymentRequest({ jobId: 501, amount: 40, method: "check" as "cash" })).toThrow("Choose a supported payment method.");
  });

  it("records through the canonical mobile endpoint and does not mutate Job state on failure", async () => {
    const success = mockOk({
      payment: { jobId: 501, paymentId: 9, amount: 40, method: "cash", paidTotal: 40, balance: 60, paymentStatus: "partial" },
    });
    try {
      await expect(recordJobSyncCompanyJobPayment("company-token", 501, {
        amount: 40,
        method: "cash",
        idempotencyKey: "m3b-client-key-501",
      })).resolves.toMatchObject({ jobId: 501, paymentId: 9, duplicate: false });
      expect(String(success.mock.calls[0][0])).toContain("/api/mobile/v1/jobs/501/payments");
      expect(JSON.parse(String((success.mock.calls[0][1] as RequestInit).body))).toEqual({
        amount: 40,
        method: "cash",
        idempotencyKey: "m3b-client-key-501",
      });
      expect(JSON.parse(String((success.mock.calls[0][1] as RequestInit).body))).not.toHaveProperty("companyId");
    } finally {
      success.mockRestore();
    }

    const failure = mockSequence({ ok: false, status: 400, body: { error: { message: "Enter a payment between $0.01 and $60.00." } } });
    const jobBefore = { paymentStatus: "unpaid", balance: 100 };
    try {
      await expect(recordJobSyncCompanyJobPayment("company-token", 501, {
        amount: 400,
        method: "cash",
        idempotencyKey: "m3b-overpay",
      })).rejects.toThrow("Enter a payment between $0.01 and $60.00.");
      expect(jobBefore).toEqual({ paymentStatus: "unpaid", balance: 100 });
    } finally {
      failure.mockRestore();
    }
  });

  it("retries the same idempotency key after a lost response and never resubmits after a failed refresh", async () => {
    const key = createManualPaymentIdempotencyKey();
    expect(key.startsWith("hsc-m3b-manual:")).toBe(true);
    const fetchMock = mockSequence(
      { ok: true, body: { payment: { jobId: 501, paymentId: 12, amount: 25, method: "other", paidTotal: 25, balance: 75, paymentStatus: "partial", duplicate: false } } },
      { ok: true, body: { payment: { jobId: 501, paymentId: 12, amount: 25, method: "other", paidTotal: 25, balance: 75, paymentStatus: "partial", duplicate: true } } },
    );
    try {
      const first = await recordJobSyncCompanyJobPayment("company-token", 501, { amount: 25, method: "other", idempotencyKey: key });
      const retry = await recordJobSyncCompanyJobPayment("company-token", 501, { amount: 25, method: "other", idempotencyKey: key });
      expect(first.paymentId).toBe(12);
      expect(retry.duplicate).toBe(true);
      expect(retry.paymentId).toBe(first.paymentId);
      expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).idempotencyKey).toBe(key);
      expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)).idempotencyKey).toBe(key);
    } finally {
      fetchMock.mockRestore();
    }
    expect(nextManualPaymentRefreshState({ paymentAccepted: true, refreshSucceeded: true })).toBe("recorded");
    expect(nextManualPaymentRefreshState({ paymentAccepted: true, refreshSucceeded: false })).toBe("recorded-refresh-failed");
    expect(shouldResubmitManualPaymentAfterRefreshFailure()).toBe(false);
    expect(COMPANY_PAYMENT_REFRESH_FAILED).toContain("Payment recorded.");
    expect(collectSource).toContain("COMPANY_PAYMENT_REFRESH_FAILED");
    expect(collectSource).toContain("idempotencyKeyRef");
  });

  it("rotates the idempotency key when the Job changes or the payload changes before acceptance", () => {
    const first = nextManualPaymentIdempotencyKey({
      existingKey: "hsc-m3b-manual:job-501",
      jobId: 501,
      previousJobId: 501,
      fingerprint: manualPaymentRequestFingerprint({ jobId: 501, amount: 40, method: "cash" }),
      previousFingerprint: manualPaymentRequestFingerprint({ jobId: 501, amount: 40, method: "cash" }),
      paymentAccepted: false,
      createKey: () => "should-not-rotate",
    });
    expect(first).toBe("hsc-m3b-manual:job-501");

    const switchedJob = nextManualPaymentIdempotencyKey({
      existingKey: "hsc-m3b-manual:job-501",
      jobId: 502,
      previousJobId: 501,
      fingerprint: manualPaymentRequestFingerprint({ jobId: 502, amount: 40, method: "cash" }),
      previousFingerprint: manualPaymentRequestFingerprint({ jobId: 501, amount: 40, method: "cash" }),
      paymentAccepted: false,
      createKey: () => "hsc-m3b-manual:job-502",
    });
    expect(switchedJob).toBe("hsc-m3b-manual:job-502");

    const changedAmount = nextManualPaymentIdempotencyKey({
      existingKey: "hsc-m3b-manual:job-501",
      jobId: 501,
      previousJobId: 501,
      fingerprint: manualPaymentRequestFingerprint({ jobId: 501, amount: 75, method: "cash" }),
      previousFingerprint: manualPaymentRequestFingerprint({ jobId: 501, amount: 40, method: "cash" }),
      paymentAccepted: false,
      createKey: () => "hsc-m3b-manual:job-501-75",
    });
    expect(changedAmount).toBe("hsc-m3b-manual:job-501-75");

    const keepAfterAccepted = nextManualPaymentIdempotencyKey({
      existingKey: "hsc-m3b-manual:job-501",
      jobId: 501,
      previousJobId: 501,
      fingerprint: manualPaymentRequestFingerprint({ jobId: 501, amount: 75, method: "cash" }),
      previousFingerprint: manualPaymentRequestFingerprint({ jobId: 501, amount: 40, method: "cash" }),
      paymentAccepted: true,
      createKey: () => "should-not-rotate-after-accept",
    });
    expect(keepAfterAccepted).toBe("hsc-m3b-manual:job-501");
  });
});

describe("M3B Checkout and history", () => {
  it("uses the canonical Checkout adapter without sending Stripe account authority", async () => {
    const request = createCanonicalCheckoutRequest(501);
    expect(request.path).toBe("/api/mobile/v1/jobs/501/checkout");
    expect(request.body).toEqual({});
    const fetchMock = mockOk({
      checkout: { url: "https://checkout.test/m3b", amountCents: 8000, attemptId: 44, attemptStatus: "pending", checkoutState: "open", reused: false },
    });
    try {
      await expect(createJobSyncCompanyJobCheckout("company-token", 501)).resolves.toMatchObject({
        url: "https://checkout.test/m3b",
        attemptId: 44,
        reused: false,
      });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/jobs/501/checkout");
      expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({});
      expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).not.toHaveProperty("stripeAccountId");
    } finally {
      fetchMock.mockRestore();
    }
    expect(resolveCompanyPaymentActions({ mode: "company", role: "owner", jobStatus: "scheduled", balance: 80 }).canOpenCheckout).toBe(true);
    expect(apiSource).toContain("createJobSyncCompanyJobCheckout");
    expect(apiSource).not.toContain("PaymentIntent");
    expect(collectSource).toContain("createJobSyncCompanyJobCheckout");
    expect(collectSource).not.toContain("trpc.stripe");
  });

  it("fails closed without Connect and never falls back to legacy Stripe", async () => {
    const fetchMock = mockSequence({
      ok: false,
      status: 412,
      body: { error: { message: "Connect a verified Stripe bank account before collecting card payments." } },
    });
    try {
      await expect(createJobSyncCompanyJobCheckout("company-token", 501)).rejects.toThrow("Connect a verified Stripe bank account before collecting card payments.");
    } finally {
      fetchMock.mockRestore();
    }
    expect(companyScheduleCheckoutMounted({ authority: "company", showCheckout: true })).toBe(false);
    expect(collectSource).not.toContain("AdminCheckoutModal");
    expect(collectSource).not.toContain("luxwash");
  });

  it("reads canonical Job payment history only", async () => {
    const fetchMock = mockOk({
      payments: [{ id: 3, method: "cash", status: "paid", amount: 40, createdAt: "2026-09-19T12:00:00.000Z" }],
    });
    try {
      await expect(getJobSyncCompanyJobPayments("company-token", 501)).resolves.toEqual([
        { id: 3, method: "cash", status: "paid", amount: 40, createdAt: "2026-09-19T12:00:00.000Z" },
      ]);
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/jobs/501/payments");
    } finally {
      fetchMock.mockRestore();
    }
    expect(collectSource).toContain("getJobSyncCompanyJobPayments");
    expect(collectSource).not.toContain("standalone_invoices");
    expect(collectSource).not.toContain("schedule_jobs");
    expect(profileSource).not.toContain("CompanyCollectPayment");
    expect(financeSource).not.toContain("recordJobSyncCompanyJobPayment");
    expect(financeSource).not.toContain("createTransaction");
  });
});

describe("M3B shared entry points and refresh", () => {
  it("uses one Company payment component from Job, Unpaid, and Invoice surfaces", () => {
    expect(scheduleSource).toContain("CompanyCollectPayment");
    expect(adminScheduleSource).toContain("CompanyCollectPayment");
    expect(unpaidSource).toContain("CompanyCollectPayment");
    expect(invoicesSource).toContain("CompanyCollectPayment");
    expect(unpaidSource).toContain("authority={companyAuthority}");
    expect(unpaidSource).not.toContain('authority="company"');
    expect(collectSource).toContain("Card — collected externally");
    expect(collectSource).toContain("This does not charge a card through Stripe.");
    expect(scheduleSource).toContain("key={canonicalJobId(selectedJob.id)!}");
    expect(adminScheduleSource).toContain("key={canonicalJobId(selectedJob.id)!}");
    expect(scheduleSource).toContain("refreshCompanyData({ force: true })");
    expect(adminScheduleSource).toContain("refreshCompanyData({ force: true })");
    expect(unpaidSource).toContain("refreshCompanyData({ force: true })");
    expect(invoicesSource).toContain("refreshCompanyData({ force: true })");
    expect(paymentHelperSource).toContain("shouldResubmitManualPaymentAfterRefreshFailure");
  });
});
