import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  COMPANY_LEGACY_FALLTHROUGH_BLOCKED,
  COMPANY_PAYMENT_CONTROLS,
  allowsLegacyJobAuthority,
  classifyStandaloneInvoicesUse,
  companyAssignedUserId,
  companyCanonicalListState,
  companyCanonicalReadError,
  companyScheduleDateTime,
  companyScheduleWritesLocalMirror,
  forbidLegacyCompanyJobAuthority,
  invoicePresentationFromCanonicalJob,
  isJobSyncCompanySession,
  mapCanonicalJobToScheduleFields,
  nextCanonicalJobStatus,
  resolveCompanyJobAuthority,
  unpaidJobFromCanonical,
  usesCompanyJobAuthority,
} from "../lib/jobsync-company-authority";
import {
  assignJobSyncCompanyJob,
  createJobSyncCompanyJob,
  getJobSyncCompanyInvoices,
  getJobSyncCompanyJobs,
  getJobSyncCompanyUnpaidJobs,
  rescheduleJobSyncCompanyJob,
  sanitizeCompanyMutationBody,
  updateJobSyncCompanyJobStatus,
} from "../lib/jobsync-mobile-api";

const scheduleSource = readFileSync(new URL("../app/(tabs)/schedule.tsx", import.meta.url), "utf8");
const adminScheduleSource = readFileSync(new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url), "utf8");
const addJobSource = readFileSync(new URL("../components/add-job-modal.tsx", import.meta.url), "utf8");
const invoicesSource = readFileSync(new URL("../app/(tabs)/admin-invoices.tsx", import.meta.url), "utf8");
const unpaidSource = readFileSync(new URL("../app/(tabs)/admin-unpaid-jobs.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../lib/jobsync-mobile-api.ts", import.meta.url), "utf8");

const canonicalJob = {
  id: 44,
  customerId: 8,
  assignedUserId: 41,
  title: "Window Cleaning",
  serviceName: "Window Cleaning",
  status: "scheduled",
  scheduledStartAt: "2026-09-11T13:00:00.000Z",
  scheduledEndAt: "2026-09-11T14:30:00.000Z",
  updatedAt: "2026-09-11T12:00:00.000Z",
  addressLine1: "1 Main St",
  city: "Mobile",
  amount: 249.5,
  paidTotal: 50,
  refundTotal: 0,
  appliedEstimateCredit: 0,
  balance: 199.5,
  paymentStatus: "partial",
  customerName: "Casey Owner",
  assignedName: "Alex Tech",
};

function mockOk(body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => body,
  } as Response);
}

describe("M1 Company Jobs / Schedule / AR", () => {
  it("keeps Company Job list and create on the canonical HSC paths", async () => {
    const fetchMock = mockOk({
      jobs: [canonicalJob],
    });
    try {
      const jobs = await getJobSyncCompanyJobs("company-token", { start: "2026-09-01T00:00:00.000Z", end: "2026-09-30T00:00:00.000Z" });
      expect(fetchMock.mock.calls[0][0]).toContain("/api/mobile/v1/company/jobs?start=");
      expect(jobs[0]).toMatchObject({ id: 44, amount: 249.5, paidTotal: 50, balance: 199.5, paymentStatus: "partial" });
    } finally {
      fetchMock.mockRestore();
    }

    const createMock = mockOk({ job: canonicalJob });
    try {
      await createJobSyncCompanyJob("company-token", { customerId: 8, priceBookServiceId: 501, scheduledStartAt: "2026-09-11T13:00:00.000Z" });
      expect(String(createMock.mock.calls[0][0])).toContain("/api/mobile/v1/company/jobs");
      expect(createMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
    } finally {
      createMock.mockRestore();
    }
  });

  it("maps Company Schedule from canonical Job fields and does not write schedule_jobs", () => {
    const mapped = mapCanonicalJobToScheduleFields(canonicalJob, "crestview");
    expect(mapped.id).toBe("44");
    expect(mapped.address).toBe("1 Main St");
    expect(mapped.serviceTitle).toBe("Window Cleaning");
    expect(mapped.price).toBe(249.5);
    expect(mapped.paidTotal).toBe(50);
    expect(mapped.balance).toBe(199.5);
    expect(mapped.paymentStatus).toBe("partial");
    expect(mapped.assignedTo).toBe("jobsync-41");
    expect(mapped.detailerName).toBe("Alex Tech");
    expect(mapped._rawStatus).toBe("scheduled");
    expect(companyScheduleWritesLocalMirror()).toBe(false);
    expect(scheduleSource).toContain("mapCanonicalJobToScheduleFields");
    expect(adminScheduleSource).toContain("mapCanonicalJobToScheduleFields");
    expect(scheduleSource).toContain("getJobSyncCompanyJobs");
    expect(scheduleSource).not.toContain("trpc.jobs.upsert.useMutation();\n    if (isJobSyncCompany)");
  });

  it("routes Company reschedule, assignment, and status to canonical Job mutations without client company overrides", async () => {
    const fetchMock = mockOk({ success: true, status: "en_route", assignedUserId: 41, jobId: 44, scheduledStartAt: "2026-09-12T15:00:00.000Z" });
    try {
      await updateJobSyncCompanyJobStatus("company-token", 44, { status: "en_route" });
      await assignJobSyncCompanyJob("company-token", 44, { assignedUserId: 41 });
      await rescheduleJobSyncCompanyJob("company-token", 44, { scheduledStartAt: "2026-09-12T15:00:00.000Z", scheduledEndAt: "2026-09-12T16:00:00.000Z" });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/company/jobs/44/status");
      expect(String(fetchMock.mock.calls[1][0])).toContain("/api/mobile/v1/company/jobs/44/assignment");
      expect(String(fetchMock.mock.calls[2][0])).toContain("/api/mobile/v1/company/jobs/44/schedule");
      for (const [, init] of fetchMock.mock.calls) {
        const body = JSON.parse(String((init as RequestInit).body));
        expect(body.companyId).toBeUndefined();
        expect(body.company_id).toBeUndefined();
        expect(body.role).toBeUndefined();
        expect(body.ownerId).toBeUndefined();
      }
      expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ status: "en_route" });
      expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ assignedUserId: 41 });
    } finally {
      fetchMock.mockRestore();
    }
    expect(nextCanonicalJobStatus("scheduled")).toBe("en_route");
    expect(nextCanonicalJobStatus("en_route")).toBe("on_site");
    expect(nextCanonicalJobStatus("on_site")).toBe("completed");
    expect(companyAssignedUserId("jobsync-41")).toBe(41);
    expect(Number.isNaN(new Date(companyScheduleDateTime("2026-09-12", 15)).getTime())).toBe(false);
    expect(scheduleSource).toContain("updateJobSyncCompanyJobStatus");
    expect(adminScheduleSource).toContain("rescheduleJobSyncCompanyJob");
    expect(adminScheduleSource).toContain("assignJobSyncCompanyJob");
  });

  it("rejects client-supplied Company identity on Job mutations", async () => {
    const fetchMock = mockOk({ success: true });
    try {
      await expect(updateJobSyncCompanyJobStatus("company-token", 44, { status: "completed", expectedUpdatedAt: "2026-09-12T15:00:00.000Z" })).resolves.toMatchObject({ success: true });
      const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
      expect(Object.keys(body)).toEqual(["status", "expectedUpdatedAt"]);
    } finally {
      fetchMock.mockRestore();
    }
    expect(apiSource).toContain('if (key in body) throw new Error("Company identity must come from the authenticated Home Service Connected session.")');
  });

  it("presents Job invoices and unpaid jobs from canonical AR and isolates standalone_invoices", async () => {
    const invoiceMock = mockOk({
      invoices: [{ id: 44, customerId: 8, customerName: "Casey Owner", title: "Window Cleaning", serviceName: "Window Cleaning", status: "scheduled", paymentStatus: "partial", scheduledStartAt: "2026-09-11T13:00:00.000Z", total: 249.5, paid: 50, balance: 199.5 }],
    });
    try {
      const invoices = await getJobSyncCompanyInvoices("company-token");
      expect(String(invoiceMock.mock.calls[0][0])).toContain("/api/mobile/v1/invoices");
      expect(invoicePresentationFromCanonicalJob(invoices[0])).toEqual({
        jobId: 44,
        customerName: "Casey Owner",
        serviceName: "Window Cleaning",
        status: "scheduled",
        paymentStatus: "partial",
        amount: 249.5,
        amountPaid: 50,
        balanceDue: 199.5,
      });
    } finally {
      invoiceMock.mockRestore();
    }

    const unpaidMock = mockOk({
      jobs: [{ id: 44, title: "Window Cleaning", customerName: "Casey Owner", amount: 249.5, paidTotal: 50, balance: 199.5, paymentStatus: "partial" }],
    });
    try {
      const unpaid = await getJobSyncCompanyUnpaidJobs("company-token");
      expect(String(unpaidMock.mock.calls[0][0])).toContain("/api/mobile/v1/payments/unpaid-jobs");
      expect(unpaidJobFromCanonical(unpaid[0])).toMatchObject({ jobId: "44", balanceDue: 199.5, paidTotal: 50, amount: 249.5, paymentStatus: "partial" });
    } finally {
      unpaidMock.mockRestore();
    }

    expect(classifyStandaloneInvoicesUse()).toMatchObject({ table: "standalone_invoices", classification: "C", companyUse: "isolated", secondJobReceivable: false });
    expect(invoicesSource).toContain("getJobSyncCompanyInvoices");
    expect(invoicesSource).toContain("enabled: allowLegacy");
    expect(invoicesSource).toContain("standaloneInvoices.list");
    expect(unpaidSource).toContain("getJobSyncCompanyUnpaidJobs");
    expect(unpaidSource).toContain("enabled: allowLegacy");
    expect(unpaidSource).toContain("companyMode");
  });

  it("keeps HSC card, Apple Pay, and Tap to Pay disabled and blocks Company fallthrough", () => {
    expect(COMPANY_PAYMENT_CONTROLS).toEqual({
      card: false,
      applePay: false,
      tapToPay: false,
      savedCardCharging: false,
      paymentIntentCreation: false,
      refunds: false,
      recordPayment: false,
    });
    expect(apiSource).toContain("recordJobSyncCompanyJobPayment");
    expect(apiSource).toContain("sanitizeCompanyPaymentBody");
    expect(scheduleSource).toContain("CompanyCollectPayment");
    expect(adminScheduleSource).toContain("!selectedJob.payment && allowLegacyJobAuthority");
    expect(unpaidSource).toContain("Card, Apple Pay, Tap to Pay, and local mark-paid stay disabled.");
    expect(() => forbidLegacyCompanyJobAuthority(true, "savePayment")).toThrow(COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
    expect(() => forbidLegacyCompanyJobAuthority(false, "savePayment")).not.toThrow();
    expect(isJobSyncCompanySession({ token: "t", portal: "company", user: { id: 1, name: "Casey", email: null, role: "owner" } })).toBe(true);
    expect(isJobSyncCompanySession({ token: "t", portal: "platform", user: { id: 1, name: "Owner", email: null, role: "owner" } })).toBe(false);
  });

  it("classifies loading or missing Company identity as unknown and does not allow legacy Job authority", () => {
    const loading = resolveCompanyJobAuthority({ session: null, sessionLoading: true });
    const restoredCompany = resolveCompanyJobAuthority({
      session: { token: "t", portal: "company", user: { id: 1, name: "Casey", email: null, role: "owner" } },
      sessionLoading: false,
    });
    const platform = resolveCompanyJobAuthority({
      session: { token: "t", portal: "platform", user: { id: 1, name: "Owner", email: null, role: "owner" } },
      sessionLoading: false,
    });
    const loggedOut = resolveCompanyJobAuthority({ session: null, sessionLoading: false });
    expect(loading).toBe("unknown");
    expect(allowsLegacyJobAuthority(loading)).toBe(false);
    expect(usesCompanyJobAuthority(loading)).toBe(false);
    expect(restoredCompany).toBe("company");
    expect(allowsLegacyJobAuthority(restoredCompany)).toBe(false);
    expect(platform).toBe("legacy");
    expect(loggedOut).toBe("legacy");
    expect(companyCanonicalListState({ loading: false, error: "Home Service Connected took too long to respond.", itemCount: 0 })).toBe("error");
    expect(companyCanonicalListState({ loading: false, error: null, itemCount: 0 })).toBe("empty");
    expect(companyCanonicalReadError(new Error("canonical unavailable"))).toBe("canonical unavailable");
    expect(scheduleSource).toContain("allowLegacyJobAuthority");
    expect(adminScheduleSource).toContain("allowLegacyJobAuthority");
    expect(invoicesSource).toContain("resolveCompanyJobAuthority");
    expect(unpaidSource).toContain("companyListState === \"error\"");
  });

  it("does not convert a Company Jobs API failure into an empty list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: "Home Service Connected operations are temporarily unavailable." } }),
    } as Response);
    try {
      await expect(getJobSyncCompanyJobs("company-token")).rejects.toThrow("Home Service Connected operations are temporarily unavailable.");
      await expect(getJobSyncCompanyInvoices("company-token")).rejects.toThrow("Home Service Connected operations are temporarily unavailable.");
      await expect(getJobSyncCompanyUnpaidJobs("company-token")).rejects.toThrow("Home Service Connected operations are temporarily unavailable.");
    } finally {
      fetchMock.mockRestore();
    }
    expect(companyCanonicalListState({ loading: false, error: "Home Service Connected operations are temporarily unavailable.", itemCount: 0 })).not.toBe("empty");
  });

  it("rejects client-supplied Company identity keys at runtime", () => {
    expect(() => sanitizeCompanyMutationBody({ status: "en_route", companyId: 11 })).toThrow("Company identity must come from the authenticated Home Service Connected session.");
    expect(() => sanitizeCompanyMutationBody({ assignedUserId: 41, role: "owner" })).toThrow("Company identity must come from the authenticated Home Service Connected session.");
    expect(sanitizeCompanyMutationBody({ status: "en_route" })).toEqual({ status: "en_route" });
  });

  it("preserves Company add-job, chat, clock, and roster contracts while disabling leftover local Job writes", () => {
    expect(addJobSource).toContain("createJobSyncCompanyJob");
    expect(addJobSource).toContain("enabled: allowLegacy && !!selectedDate && !!selectedCity");
    expect(scheduleSource).toContain('Alert.alert("Use Company Add Job"');
    expect(scheduleSource).toContain("if (!allowLegacyJobAuthority) return;");
    expect(adminScheduleSource).toContain("createJobSyncCompanyJob");
    expect(adminScheduleSource).toContain("getJobSyncCompanyMembers");
    const chatSource = readFileSync(new URL("../lib/jobsync-mobile-api.ts", import.meta.url), "utf8");
    expect(chatSource).toContain("/api/mobile/v1/company/chat/groups");
    expect(chatSource).toContain("/api/mobile/v1/time/clock-in");
    expect(chatSource).toContain("/api/mobile/v1/company/team-members");
  });
});
