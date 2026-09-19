import { describe, expect, it, vi } from "vitest";

import {
  createJobSyncBearerHeaders,
  createJobSyncCompanyCustomer,
  createJobSyncCompanyJob,
  createJobSyncCompanyMemberUpdatePayload,
  createJobSyncMobileLoginPayload,
  createJobSyncPasswordResetRequestPayload,
  createHomeServiceConnectedChatGroupPayload,
  extractJobSyncMobileToken,
  assignJobSyncCompanyJob,
  getJobSyncCompanyCustomers,
  getJobSyncCompanyInvoices,
  getJobSyncCompanyJobs,
  getJobSyncCompanyUnpaidJobs,
  rescheduleJobSyncCompanyJob,
  updateJobSyncCompanyJobStatus,
  resolveJobSyncBaseUrl,
  normalizeJobSyncCompanyMemberDetail,
  normalizeJobSyncCompanyRoster,
  normalizeJobSyncMobileSession,
  normalizeJobSyncFeatureAccess,
  normalizeHomeServiceConnectedTimeState,
  normalizeHomeServiceConnectedChatGroups,
  normalizeHomeServiceConnectedCommunityCategories,
  normalizeHomeServiceConnectedCommunityPosts,
  normalizeHomeServiceConnectedPriceBook,
  normalizeJobSyncIncrementalSync,
} from "../lib/jobsync-mobile-api";
import { COMPANY_SCHEDULE_HALF_HOUR_SLOTS, companyScheduleInitialOffset, companyScheduleSlotIndex } from "../lib/jobsync-schedule-window";

describe("JobSync mobile API contract", () => {
  it("uses the deployed Company and Platform Admin account-type contract", () => {
    expect(createJobSyncMobileLoginPayload({ accountType: "company", email: "  USER@EXAMPLE.COM ", password: "password-123" })).toEqual({
      accountType: "company",
      email: "user@example.com",
      password: "password-123",
    });
    expect(createJobSyncMobileLoginPayload({ accountType: "platform_admin", email: "owner@example.com", password: "password-456" }).accountType).toBe("platform_admin");
  });

  it("creates the documented Company-only password-reset request without exposing a reset token to mobile", () => {
    expect(createJobSyncPasswordResetRequestPayload("  OWNER@EXAMPLE.COM ")).toEqual({
      email: "owner@example.com",
      accountType: "company",
    });
  });

  it("sends restored sessions with an Authorization bearer header", () => {
    expect(createJobSyncBearerHeaders("mobile-token")).toEqual({ Authorization: "Bearer mobile-token" });
  });

  it("normalizes a Company-only incremental sync signal without treating local data as authoritative", () => {
    const sync = normalizeJobSyncIncrementalSync({
      since: "2026-09-15T12:00:00.000Z",
      generatedAt: "2026-09-15T12:00:45.000Z",
      changes: {
        jobs: [{ id: 12, updatedAt: "2026-09-15T12:00:30.000Z" }, { id: "invalid" }],
        messages: [{ id: 77, createdAt: "2026-09-15T12:00:40.000Z" }],
      },
    }, "2026-09-15T11:00:00.000Z");
    expect(sync.since).toBe("2026-09-15T12:00:00.000Z");
    expect(sync.changes.jobs).toEqual([{ id: 12, updatedAt: "2026-09-15T12:00:30.000Z", createdAt: null }]);
    expect(sync.changes.messages).toEqual([{ id: 77, updatedAt: null, createdAt: "2026-09-15T12:00:40.000Z" }]);
  });

  it("normalizes an authorized Company member update payload", () => {
    expect(createJobSyncCompanyMemberUpdatePayload({
      firstName: " Alex ",
      lastName: " Smith ",
      email: " ALEX@EXAMPLE.COM ",
      phone: " 555-0100 ",
      city: " Niceville ",
      role: "technician",
      availability: "available",
    })).toEqual({
      firstName: "Alex",
      lastName: "Smith",
      email: "alex@example.com",
      phone: "555-0100",
      city: "Niceville",
      role: "technician",
      availability: "available",
    });
  });

  it("extracts a bearer token from supported login response envelopes", () => {
    expect(extractJobSyncMobileToken({ accessToken: "token-a" })).toBe("token-a");
    expect(extractJobSyncMobileToken({ data: { token: "token-b" } })).toBe("token-b");
    expect(extractJobSyncMobileToken({ session: { bearerToken: "token-c" } })).toBe("token-c");
  });

  it("normalizes a Company owner profile and Company context", () => {
    const session = normalizeJobSyncMobileSession({
      accountType: "company",
      user: { id: 41, name: "Casey Owner", email: "casey@example.com", role: "owner", memberId: "owner-9" },
      company: { id: 9, name: "Casey Services", slug: "casey-services", primaryColor: "#123456" },
    }, "company-token");

    expect(session?.portal).toBe("company");
    expect(session?.user.role).toBe("owner");
    expect(session?.company?.id).toBe(9);
    expect(session?.token).toBe("company-token");
  });

  it("normalizes a Platform Admin profile without Company context", () => {
    const session = normalizeJobSyncMobileSession({
      data: {
        accountType: "platform_admin",
        profile: { ownerId: 3, displayName: "Platform Owner", email: "owner@example.com", platformRole: "owner" },
      },
    }, "platform-token");

    expect(session?.portal).toBe("platform");
    expect(session?.user.id).toBe(3);
    expect(session?.user.role).toBe("owner");
    expect(session?.company).toBeUndefined();
  });

  it("maps API-facing role aliases to canonical JobSync roles", () => {
    const dispatcher = normalizeJobSyncMobileSession({
      accountType: "company",
      user: { id: 5, name: "Ops User", role: "operations_manager" },
      company: { id: 2, name: "Ops Company" },
    }, "ops-token");
    expect(dispatcher?.user.role).toBe("dispatcher");
  });

  it("rejects profiles without a valid identity or Company boundary", () => {
    expect(normalizeJobSyncMobileSession({ accountType: "company", user: { role: "owner" } }, "bad-token")).toBeNull();
  });

  it("normalizes Company feature access and fails closed for disabled mobile tabs", () => {
    expect(normalizeJobSyncFeatureAccess({
      features: [
        { key: "finance", isEnabled: true },
        { key: "payments", isEnabled: true },
        { key: "eod", isEnabled: false },
      ],
      mobile: { finance: true, invoices: true, eodReview: false },
    })).toEqual({
      features: { finance: true, payments: true, eod: false },
      mobile: { finance: true, invoices: true, eodReview: false },
    });

    expect(normalizeJobSyncFeatureAccess(null).mobile).toEqual({ finance: false, invoices: false, eodReview: false });
  });

  it("normalizes active Company members and rejects a mismatched Company boundary", () => {
    const roster = normalizeJobSyncCompanyRoster({
      company: { id: 9, name: "Casey Services" },
      members: [
        { id: 41, name: "Alex Technician", role: "technician", isActive: true },
        { id: 42, name: "Inactive Member", role: "technician", isActive: false },
      ],
    }, 9);

    expect(roster?.company.name).toBe("Casey Services");
    expect(roster?.members).toEqual([{
      id: 41,
      name: "Alex Technician",
      role: "technician",
      isActive: true,
      city: null,
      positionId: null,
      positionName: null,
      calendarEligible: false,
    }]);
    expect(normalizeJobSyncCompanyRoster({ company: { id: 10, name: "Other Company" }, members: [] }, 9)).toBeNull();
  });

  it("normalizes an authoritative detailed Company member profile", () => {
    const detail = normalizeJobSyncCompanyMemberDetail({
      member: {
        id: 41,
        memberId: "ANTHONY",
        firstName: "Anthony",
        lastName: "Slentz",
        email: "aslentz03@icloud.com",
        phone: "(850) 987-1000",
        city: "Destin",
        hireDate: "2026-07-01",
        role: "technician",
        availability: "available",
        workDays: ["mon", "tue", "wed", "thu"],
        hourlyRate: 17,
        upsellBonusPct: 40,
        mysteryBonusStatus: "No challenges attempted",
        assignedVehicle: { id: 12, name: "DU2", shift: "1st Shift", assignedAt: "2026-07-05" },
        isActive: true,
      },
    }, 41);

    expect(detail?.memberId).toBe("ANTHONY");
    expect(detail?.workDays).toEqual(["mon", "tue", "wed", "thu"]);
    expect(detail?.hourlyRate).toBe(17);
    expect(detail?.assignedVehicle?.name).toBe("DU2");
  });

  it("recognizes active current-time and break state response variants", () => {
    expect(normalizeHomeServiceConnectedTimeState({
      data: { current: { isClockedIn: true, clockInAt: "2026-08-16T13:00:00Z", activeBreak: { startedAt: "2026-08-16T14:00:00Z" } } },
    })).toEqual({
      isClockedIn: true,
      clockInAt: "2026-08-16T13:00:00Z",
      activeBreak: { isActive: true, startedAt: "2026-08-16T14:00:00Z" },
    });

    expect(normalizeHomeServiceConnectedTimeState({
      activeShift: { startedAt: "2026-08-16T13:00:00Z", status: "active" },
    }).isClockedIn).toBe(true);
  });

  it("normalizes active Company-managed chat groups and excludes archived groups", () => {
    expect(normalizeHomeServiceConnectedChatGroups({
      data: {
        groups: [
          { id: "grp-field", name: "Field Operations", description: "Technicians", emoji: "🛠️", isActive: true, memberIds: ["41", "42"] },
          { id: "grp-old", name: "Archived", isActive: false },
        ],
      },
    })).toEqual([
      { id: "grp-field", name: "Field Operations", description: "Technicians", emoji: "🛠️", isActive: true, memberIds: ["41", "42"] },
    ]);
  });

  it("uses the published Company chat-group create fields with numeric member IDs", () => {
    expect(createHomeServiceConnectedChatGroupPayload({
      name: " Field Operations ",
      description: " Field technicians ",
      icon: "🛠️",
      memberIds: [41, 42, 41, 0],
    })).toEqual({
      name: "Field Operations",
      description: "Field technicians",
      icon: "🛠️",
      memberIds: [41, 42],
    });
  });

  it("normalizes Company-scoped Community categories and post interactions", () => {
    expect(normalizeHomeServiceConnectedCommunityCategories({
      categories: [{ id: 21, name: "Wins", description: "Share the good work", icon: "🏆", sortOrder: 2, isActive: true }, { id: 22, name: "Archived", isActive: false }],
    })).toEqual([{ id: 21, name: "Wins", description: "Share the good work", icon: "🏆", sortOrder: 2, isActive: true }]);
    expect(normalizeHomeServiceConnectedCommunityPosts({
      posts: [{ id: 51, category_id: 21, category_name: "Wins", category_icon: "🏆", author_user_id: 7, author_name: "Avery Stone", title: "Great review", body: "The customer thanked the team.", is_pinned: 1, comment_count: 2, like_count: 3, viewer_liked: true, created_at: "2026-09-14T18:00:00.000Z" }],
    })).toEqual([{ id: 51, categoryId: 21, categoryName: "Wins", categoryIcon: "🏆", authorUserId: 7, authorName: "Avery Stone", title: "Great review", body: "The customer thanked the team.", mediaUrl: null, isPinned: true, commentCount: 2, likeCount: 3, viewerLiked: true, createdAt: "2026-09-14T18:00:00.000Z" }]);
  });

  it("normalizes only active Company Price Book services and preserves web service IDs", () => {
    expect(normalizeHomeServiceConnectedPriceBook({
      services: [
        { service_id: "svc-full", name: "Full Service", emoji: "🛠️", description: "Complete service", features: "[\"Wash\",\"Vacuum\"]", vehicle_prices: "{\"sedan\":180,\"suv\":220}", image_url_pb: "https://cdn.example.com/full.png", sort_order_pb: 2, is_active_pb: "yes" },
        { serviceId: "svc-inactive", name: "Inactive service", isActive: false },
        { serviceId: "svc-basic", name: "Basic Service", features: ["Exterior"], vehiclePrices: { sedan: 120 }, sortOrder: 1, isActive: true },
      ],
    })).toEqual([
      { serviceId: "svc-basic", name: "Basic Service", basePrice: 0, emoji: "🛠️", description: "", features: ["Exterior"], vehiclePrices: { sedan: 120 }, imageUrl: null, sortOrder: 1, serviceTypeId: null },
      { serviceId: "svc-full", name: "Full Service", basePrice: 0, emoji: "🛠️", description: "Complete service", features: ["Wash", "Vacuum"], vehiclePrices: { sedan: 180, suv: 220 }, imageUrl: "https://cdn.example.com/full.png", sortOrder: 2, serviceTypeId: null },
    ]);
  });
  it("fetches mounted Company Schedule Jobs only from the scoped Company endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ jobs: [{ id: 44, customerId: 8, title: "Lawn service", serviceName: "Mow", status: "scheduled", scheduledStartAt: "2026-09-11T13:00:00.000Z", scheduledEndAt: "2026-09-11T14:00:00.000Z", amount: 90, customerName: "Test Customer" }] }),
    } as Response);
    try {
      const jobs = await getJobSyncCompanyJobs("company-token", { start: "2026-09-11T00:00:00.000Z", end: "2026-09-12T00:00:00.000Z" });
      expect(jobs).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/mobile/v1/company/jobs?start="),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer company-token" }) }),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
  it("rejects Luxury Wash API overrides and resolves the canonical HSC production origin", () => {
    expect(resolveJobSyncBaseUrl(undefined)).toBe("https://www.homeserviceconnected.com");
    expect(resolveJobSyncBaseUrl("https://www.homeserviceconnected.com/")).toBe("https://www.homeserviceconnected.com");
    expect(resolveJobSyncBaseUrl("https://luxwashapp-n2wveyqg.manus.space")).toBe("https://www.homeserviceconnected.com");
  });
  it("keeps early and late Company Jobs inside the full-day Schedule timeline", () => {
    expect(COMPANY_SCHEDULE_HALF_HOUR_SLOTS[0]).toBe(0);
    expect(COMPANY_SCHEDULE_HALF_HOUR_SLOTS.at(-1)).toBe(23.5);
    expect(companyScheduleSlotIndex(3 + 59 / 60)).toBe(7);
    expect(companyScheduleSlotIndex(8)).toBe(16);
    expect(companyScheduleSlotIndex(23.75)).toBe(COMPANY_SCHEDULE_HALF_HOUR_SLOTS.length - 1);
    expect(companyScheduleInitialOffset(32)).toBe(512);
  });

  it("uses Company-owned customer IDs and a numeric Price Book service ID for server-priced Job creation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ job: { id: 45, customerId: 8, serviceName: "Window Cleaning", title: "Window Cleaning", status: "scheduled", scheduledStartAt: "2026-09-11T13:00:00.000Z", scheduledEndAt: "2026-09-11T14:30:00.000Z", amount: 249.5, customerName: "Test Customer" } }),
    } as Response);
    try {
      await createJobSyncCompanyJob("company-token", { customerId: 8, priceBookServiceId: 501, assignedUserId: 41, scheduledStartAt: "2026-09-11T13:00:00.000Z", privateNotes: "Gate code in CRM" });
      const [, request] = fetchMock.mock.calls[0];
      expect(fetchMock.mock.calls[0][0]).toContain("/api/mobile/v1/company/jobs");
      expect(request).toEqual(expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer company-token" }) }));
      expect(JSON.parse(String((request as RequestInit).body))).toEqual({ customerId: 8, priceBookServiceId: 501, assignedUserId: 41, scheduledStartAt: "2026-09-11T13:00:00.000Z", privateNotes: "Gate code in CRM" });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("patches Company Job schedule, assignment, and status through canonical bearer routes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, status: "en_route", assignedUserId: 41, jobId: 45, scheduledStartAt: "2026-09-11T15:00:00.000Z" }),
    } as Response);
    try {
      await updateJobSyncCompanyJobStatus("company-token", 45, { status: "en_route" });
      await assignJobSyncCompanyJob("company-token", 45, { assignedUserId: 41 });
      await rescheduleJobSyncCompanyJob("company-token", 45, { scheduledStartAt: "2026-09-11T15:00:00.000Z" });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/company/jobs/45/status");
      expect(String(fetchMock.mock.calls[1][0])).toContain("/api/mobile/v1/company/jobs/45/assignment");
      expect(String(fetchMock.mock.calls[2][0])).toContain("/api/mobile/v1/company/jobs/45/schedule");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("reads Company invoices and unpaid Jobs from canonical Job AR endpoints", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => ({ invoices: [{ id: 45, customerName: "Test Customer", title: "Window Cleaning", serviceName: "Window Cleaning", paymentStatus: "unpaid", total: 249.5, paid: 0, balance: 249.5 }] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ jobs: [{ id: 45, title: "Window Cleaning", customerName: "Test Customer", amount: 249.5, paidTotal: 0, balance: 249.5, paymentStatus: "unpaid" }] }) } as Response);
    try {
      await expect(getJobSyncCompanyInvoices("company-token")).resolves.toMatchObject([{ id: 45, total: 249.5, balance: 249.5 }]);
      await expect(getJobSyncCompanyUnpaidJobs("company-token")).resolves.toMatchObject([{ id: 45, balance: 249.5 }]);
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/invoices");
      expect(String(fetchMock.mock.calls[1][0])).toContain("/api/mobile/v1/payments/unpaid-jobs");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("reads and creates customers only through the Company-scoped mobile contract", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => ({ customers: [{ id: 8, firstName: "Test", lastName: "Customer", email: "test@example.com", phone: null, addressLine1: "1 Main St", city: "Mobile" }] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ customer: { id: 9, firstName: "New", lastName: "Customer", email: "new@example.com" } }) } as Response);
    try {
      await expect(getJobSyncCompanyCustomers("company-token")).resolves.toMatchObject([{ id: 8, name: "Test Customer" }]);
      await expect(createJobSyncCompanyCustomer("company-token", { firstName: " New ", lastName: " Customer ", email: "NEW@EXAMPLE.COM" })).resolves.toMatchObject({ id: 9, email: "new@example.com" });
      expect(fetchMock.mock.calls[0][0]).toContain("/api/mobile/v1/customers");
      expect(fetchMock.mock.calls[1][0]).toContain("/api/mobile/v1/customers");
      expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ firstName: "New", lastName: "Customer", email: "new@example.com" });
    } finally {
      fetchMock.mockRestore();
    }
  });
});
