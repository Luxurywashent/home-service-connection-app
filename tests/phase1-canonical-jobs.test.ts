/**
 * HSC Mobile Reconciliation — Phase 1
 * Jobs / Schedule / Job AR invoices / Unpaid Jobs
 *
 * Proves Company sessions consume canonical jobsync authority and do not
 * fall through to local Express/tRPC or Luxury Wash hosts for Phase 1 flows.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  COMPANY_PAYMENT_CONTROLS,
  allowsLegacyJobAuthority,
  classifyStandaloneInvoicesUse,
  companyScheduleWritesLocalMirror,
  forbidLegacyCompanyJobAuthority,
  invoicePresentationFromCanonicalJob,
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
  getJobSyncCompanyJob,
  getJobSyncCompanyJobs,
  getJobSyncCompanyUnpaidJobs,
  rescheduleJobSyncCompanyJob,
  resolveJobSyncBaseUrl,
  sanitizeCompanyMutationBody,
  updateJobSyncCompanyJobStatus,
} from "../lib/jobsync-mobile-api";

const scheduleSource = readFileSync(new URL("../app/(tabs)/schedule.tsx", import.meta.url), "utf8");
const adminScheduleSource = readFileSync(new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url), "utf8");
const addJobSource = readFileSync(new URL("../components/add-job-modal.tsx", import.meta.url), "utf8");
const invoicesSource = readFileSync(new URL("../app/(tabs)/admin-invoices.tsx", import.meta.url), "utf8");
const unpaidSource = readFileSync(new URL("../app/(tabs)/admin-unpaid-jobs.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../lib/jobsync-mobile-api.ts", import.meta.url), "utf8");
const authoritySource = readFileSync(new URL("../lib/jobsync-company-authority.ts", import.meta.url), "utf8");

const companySession = {
  token: "company-token",
  portal: "company" as const,
  user: { id: 1, name: "Casey", email: "casey@example.com", role: "owner" as const },
  company: {
    id: 9,
    name: "HSC Demo",
    slug: "hsc-demo",
    logoUrl: null,
    primaryColor: null,
    accentColor: null,
  },
};

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

describe("Phase 1 — canonical Jobs / Schedule / AR / Unpaid", () => {
  it("1. Company Job list consumes canonical HSC Jobs", async () => {
    const fetchMock = mockOk({ jobs: [canonicalJob] });
    try {
      const jobs = await getJobSyncCompanyJobs("company-token", {
        start: "2026-09-01T00:00:00.000Z",
        end: "2026-09-30T00:00:00.000Z",
      });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/company/jobs?");
      expect(jobs[0]).toMatchObject({ id: 44, amount: 249.5, balance: 199.5, paymentStatus: "partial" });
      expect(scheduleSource).toContain("getJobSyncCompanyJobs");
      expect(adminScheduleSource).toContain("getJobSyncCompanyJobs");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("2. Job detail consumes canonical Job via GET company/jobs/:id", async () => {
    // Post-hardening detail is a SUPERSET: canonical list DTO fields + leftover detail aliases.
    const detailSuperset = {
      ...canonicalJob,
      address: "1 Main St",
      address_line1: "1 Main St",
      technicianName: "Alex Tech",
      assigned_to: "Alex Tech",
      events: [],
      payments: [],
    };
    const fetchMock = mockOk({ job: detailSuperset });
    try {
      const job = await getJobSyncCompanyJob("company-token", 44);
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/company/jobs/44");
      expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "GET" }));
      expect(job).toMatchObject({
        id: 44,
        addressLine1: "1 Main St",
        assignedName: "Alex Tech",
        customerName: "Casey Owner",
        paidTotal: 50,
        balance: 199.5,
        paymentStatus: "partial",
      });
      expect(scheduleSource).toContain("getJobSyncCompanyJob");
      expect(adminScheduleSource).toContain("getJobSyncCompanyJob");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("2b. Detail refresh merge preserves address, assignee, customer, schedule, and AR", async () => {
    // Pre-fix getJobDetail shape (no addressLine1 / assignedName) — documents the wipe defect.
    const rawDetailWithoutProjection = {
      id: 44,
      customerId: 8,
      assignedUserId: 41,
      title: "Window Cleaning",
      serviceName: "Window Cleaning",
      status: "scheduled",
      scheduledStartAt: "2026-09-11T13:00:00.000Z",
      scheduledEndAt: "2026-09-11T14:30:00.000Z",
      updatedAt: "2026-09-11T12:00:00.000Z",
      address: "1 Main St",
      address_line1: "1 Main St",
      city: "Mobile",
      amount: 249.5,
      paidTotal: 50,
      refundTotal: 0,
      appliedEstimateCredit: 0,
      balance: 199.5,
      paymentStatus: "partial",
      customerName: "Casey Owner",
      technicianName: "Alex Tech",
      assigned_to: "Alex Tech",
    };

    const brokenFetch = mockOk({ job: rawDetailWithoutProjection });
    try {
      const broken = await getJobSyncCompanyJob("company-token", 44);
      const brokenMapped = mapCanonicalJobToScheduleFields(broken, "crestview");
      // Pre-fix server response would clear these after normalize.
      expect(broken.addressLine1).toBeNull();
      expect(broken.assignedName).toBeNull();
      expect(brokenMapped.address).toBe("");
      expect(brokenMapped.detailerName).toBeUndefined();
    } finally {
      brokenFetch.mockRestore();
    }

    // Post-fix projected detail (what jobsync projectMobileCompanyJob overlays).
    const projectedDetail = {
      ...rawDetailWithoutProjection,
      addressLine1: "1 Main St",
      assignedName: "Alex Tech",
    };
    const fetchMock = mockOk({ job: projectedDetail });
    try {
      const listMapped = mapCanonicalJobToScheduleFields(canonicalJob, "crestview");
      const detail = await getJobSyncCompanyJob("company-token", 44);
      const detailMapped = mapCanonicalJobToScheduleFields(detail, "crestview");
      const merged = { ...listMapped, ...detailMapped, id: String(detail.id) };

      expect(detail.addressLine1).toBe("1 Main St");
      expect(detail.assignedName).toBe("Alex Tech");
      expect(detail.customerName).toBe("Casey Owner");
      expect(detail.scheduledStartAt).toBe("2026-09-11T13:00:00.000Z");
      expect(detail.scheduledEndAt).toBe("2026-09-11T14:30:00.000Z");
      expect(detail.amount).toBe(249.5);
      expect(detail.paidTotal).toBe(50);
      expect(detail.balance).toBe(199.5);
      expect(detail.paymentStatus).toBe("partial");

      expect(merged.address).toBe("1 Main St");
      expect(merged.detailerName).toBe("Alex Tech");
      expect(merged.assignedTo).toBe("jobsync-41");
      expect(merged.firstName).toBe("Casey");
      expect(merged.lastName).toBe("Owner");
      expect(merged.price).toBe(249.5);
      expect(merged.paidTotal).toBe(50);
      expect(merged.balance).toBe(199.5);
      expect(merged.paymentStatus).toBe("partial");
      expect(merged._rawStatus).toBe("scheduled");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("3. Mobile Job creation uses canonical server authority", async () => {
    const fetchMock = mockOk({ job: canonicalJob });
    try {
      await createJobSyncCompanyJob("company-token", {
        customerId: 8,
        priceBookServiceId: 501,
        scheduledStartAt: "2026-09-11T13:00:00.000Z",
      });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/company/jobs");
      expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(body.amount).toBeUndefined();
      expect(body.companyId).toBeUndefined();
      expect(addJobSource).toContain("createJobSyncCompanyJob");
      expect(adminScheduleSource).toContain("createJobSyncCompanyJob");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("4. Canonical Job shape from web/API is readable through mobile list+detail clients", async () => {
    const listMock = mockOk({ jobs: [canonicalJob] });
    try {
      const listed = await getJobSyncCompanyJobs("company-token");
      expect(listed[0]?.id).toBe(44);
    } finally {
      listMock.mockRestore();
    }
    const detailMock = mockOk({ job: { ...canonicalJob, title: "Created on web" } });
    try {
      const detail = await getJobSyncCompanyJob("company-token", 44);
      expect(detail.title).toBe("Created on web");
      expect(apiSource).toContain("/api/mobile/v1/company/jobs");
    } finally {
      detailMock.mockRestore();
    }
  });

  it("5. Mobile Job mutation updates canonical Job (status intent only)", async () => {
    const fetchMock = mockOk({ success: true, status: "en_route" });
    try {
      await updateJobSyncCompanyJobStatus("company-token", 44, { status: "en_route" });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/company/jobs/44/status");
      expect(scheduleSource).toContain("updateJobSyncCompanyJobStatus");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("6. Assignment and schedule mutation use canonical server authority", async () => {
    const fetchMock = mockOk({
      success: true,
      assignedUserId: 41,
      jobId: 44,
      scheduledStartAt: "2026-09-12T15:00:00.000Z",
      scheduledEndAt: "2026-09-12T16:00:00.000Z",
    });
    try {
      await assignJobSyncCompanyJob("company-token", 44, { assignedUserId: 41 });
      await rescheduleJobSyncCompanyJob("company-token", 44, {
        scheduledStartAt: "2026-09-12T15:00:00.000Z",
        scheduledEndAt: "2026-09-12T16:00:00.000Z",
      });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/assignment");
      expect(String(fetchMock.mock.calls[1][0])).toContain("/schedule");
      expect(adminScheduleSource).toContain("assignJobSyncCompanyJob");
      expect(adminScheduleSource).toContain("rescheduleJobSyncCompanyJob");
      expect(companyScheduleWritesLocalMirror()).toBe(false);
      const mapped = mapCanonicalJobToScheduleFields(canonicalJob, "crestview");
      expect(mapped.assignedTo).toBe("jobsync-41");
      expect(mapped.paymentStatus).toBe("partial");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("7–8. Mobile cannot select another Company via request body; tenant is session-only", () => {
    expect(() => sanitizeCompanyMutationBody({ status: "en_route", companyId: 99 })).toThrow(
      /Company identity must come from the authenticated Home Service Connected session/,
    );
    expect(() => sanitizeCompanyMutationBody({ assignedUserId: 41, company_id: 99 })).toThrow();
    expect(() => sanitizeCompanyMutationBody({ status: "cancelled", role: "owner" })).toThrow();
    expect(() => sanitizeCompanyMutationBody({ status: "cancelled", ownerId: 1 })).toThrow();
    expect(sanitizeCompanyMutationBody({ status: "en_route" })).toEqual({ status: "en_route" });
    expect(apiSource).toContain('["companyId", "company_id", "role", "ownerId", "owner_id"]');
  });

  it("9. Invalid Job lifecycle transitions are not invented client-side; completed is terminal", () => {
    expect(nextCanonicalJobStatus("scheduled")).toBe("en_route");
    expect(nextCanonicalJobStatus("en_route")).toBe("on_site");
    expect(nextCanonicalJobStatus("on_site")).toBe("completed");
    expect(nextCanonicalJobStatus("completed")).toBeNull();
    expect(nextCanonicalJobStatus("cancelled")).toBeNull();
    expect(scheduleSource).toContain("nextCanonicalJobStatus");
    expect(scheduleSource).toContain("updateJobSyncCompanyJobStatus");
  });

  it("10. Job invoice/AR presentation derives from canonical Job obligation", async () => {
    const fetchMock = mockOk({
      invoices: [{
        id: 44,
        customerId: 8,
        customerName: "Casey Owner",
        title: "Window Cleaning",
        serviceName: "Window Cleaning",
        status: "scheduled",
        paymentStatus: "partial",
        scheduledStartAt: "2026-09-11T13:00:00.000Z",
        total: 249.5,
        paid: 50,
        balance: 199.5,
      }],
    });
    try {
      const invoices = await getJobSyncCompanyInvoices("company-token");
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/invoices");
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
      expect(invoicesSource).toContain("getJobSyncCompanyInvoices");
      expect(invoicesSource).toContain("invoicePresentationFromCanonicalJob");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("11. Unpaid Jobs derives from canonical balance/payment state", async () => {
    const fetchMock = mockOk({
      jobs: [{
        id: 44,
        title: "Window Cleaning",
        customerName: "Casey Owner",
        amount: 249.5,
        paidTotal: 50,
        balance: 199.5,
        paymentStatus: "partial",
      }],
    });
    try {
      const unpaid = await getJobSyncCompanyUnpaidJobs("company-token");
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/payments/unpaid-jobs");
      expect(unpaidJobFromCanonical(unpaid[0])).toMatchObject({
        jobId: "44",
        amount: 249.5,
        paidTotal: 50,
        balanceDue: 199.5,
        paymentStatus: "partial",
      });
      expect(unpaidSource).toContain("getJobSyncCompanyUnpaidJobs");
      expect(unpaidSource).toContain("unpaidJobFromCanonical");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("12–13. Job ops do not create standalone invoices; standalone remains legacy-isolated", () => {
    expect(classifyStandaloneInvoicesUse()).toMatchObject({
      table: "standalone_invoices",
      classification: "C",
      companyUse: "isolated",
      secondJobReceivable: false,
    });
    expect(invoicesSource).toContain("enabled: allowLegacy");
    expect(invoicesSource).toContain("standaloneInvoices");
    expect(addJobSource).not.toContain("standaloneInvoices.create");
    expect(scheduleSource).not.toContain("standaloneInvoices.create");
    expect(adminScheduleSource).not.toContain("standaloneInvoices.create");
    expect(authoritySource).toContain("legacy Luxury Wash standalone billing");
  });

  it("14. Local payment execution remains disabled; canonical collection is the only Company writer", () => {
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
    expect(unpaidSource).toContain("Card, Apple Pay, Tap to Pay, and local mark-paid stay disabled.");
    expect(scheduleSource).toContain("Card collection is disabled for Company Jobs.");
    expect(() => forbidLegacyCompanyJobAuthority(true, "savePayment")).toThrow();
  });

  it("15. HSC Company Phase 1 flows do not call Luxury Wash endpoints", () => {
    expect(resolveJobSyncBaseUrl("https://luxwashapp-n2wveyqg.manus.space")).toBe(
      "https://www.homeserviceconnected.com",
    );
    expect(resolveJobSyncBaseUrl("https://jobwash-veysiubh.manus.space")).toBe(
      "https://jobwash-veysiubh.manus.space",
    );
    expect(apiSource).toContain("homeserviceconnected.com");
    expect(apiSource).toContain("jobwash-veysiubh.manus.space");
    expect(apiSource).not.toContain("luxwashapp-n2wveyqg.manus.space");

    // Company list/create/detail/mutate paths never use APP_API_BASE
    expect(scheduleSource).toContain('const APP_API_BASE = "https://luxwashapp-n2wveyqg.manus.space"');
    expect(scheduleSource).toContain("if (!allowLegacyJobAuthority) return;");
    expect(scheduleSource).toContain('if (jobSyncSession?.portal === "company") return null;');
    expect(adminScheduleSource).toContain("if (!allowLegacyJobAuthority)");
    expect(addJobSource).toContain("Never substitute a Luxury Wash roster for a Company session");

    const mode = resolveCompanyJobAuthority({ session: companySession, sessionLoading: false });
    expect(usesCompanyJobAuthority(mode)).toBe(true);
    expect(allowsLegacyJobAuthority(mode)).toBe(false);
  });
});
