import { describe, expect, it, vi } from "vitest";

import {
  createJobSyncBearerHeaders,
  createJobSyncCompanyMemberUpdatePayload,
  createJobSyncMobileLoginPayload,
  createHomeServiceConnectedChatGroupPayload,
  extractJobSyncMobileToken,
  isJobSyncFieldSchedulingMember,
  normalizeJobSyncCompanyMemberDetail,
  normalizeJobSyncCompanyRoster,
  normalizeJobSyncMobileSession,
  normalizeHomeServiceConnectedTimeState,
  normalizeHomeServiceConnectedTimeOff,
  normalizeHomeServiceConnectedChatGroups,
  normalizeHomeServiceConnectedCommunityCategories,
  normalizeHomeServiceConnectedCommunityPosts,
  normalizeHomeServiceConnectedPriceBook,
  normalizeJobSyncCompanySettings,
  normalizeJobSyncCompanyCustomers,
  filterJobSyncCompanyCustomers,
  getJobSyncCompanyJobs,
  getJobSyncCompanyCustomers,
  updateJobSyncCompanyJobAssignment,
  updateJobSyncCompanyJobSchedule,
} from "../lib/jobsync-mobile-api";

describe("JobSync mobile API contract", () => {
  it("uses the deployed Company and Platform Admin account-type contract", () => {
    expect(createJobSyncMobileLoginPayload({ accountType: "company", email: "  USER@EXAMPLE.COM ", password: "password-123" })).toEqual({
      accountType: "company",
      email: "user@example.com",
      password: "password-123",
    });
    expect(createJobSyncMobileLoginPayload({ accountType: "platform_admin", email: "owner@example.com", password: "password-456" }).accountType).toBe("platform_admin");
  });

  it("sends restored sessions with an Authorization bearer header", () => {
    expect(createJobSyncBearerHeaders("mobile-token")).toEqual({ Authorization: "Bearer mobile-token" });
  });

  it("loads Company jobs from the canonical HSC host without a native cache", async () => {
    const originalBaseUrl = process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL;
    delete process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL;
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jobs: [] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      await expect(getJobSyncCompanyJobs("company-token")).resolves.toEqual([]);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://www.homeserviceconnected.com/api/mobile/v1/company/jobs",
        expect.objectContaining({
          cache: "no-store",
          headers: expect.objectContaining({ Authorization: "Bearer company-token" }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
      if (originalBaseUrl === undefined) delete process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL;
      else process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL = originalBaseUrl;
    }
  });

  it("loads and filters customers through the Company-scoped mobile endpoint", async () => {
    const originalBaseUrl = process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL;
    delete process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL;
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        customers: [
          { id: 17, firstName: "Robert", lastName: "Smith", email: "rob@example.com", phone: "555-0100", addressLine1: "10 Oak St", city: "Pensacola" },
          { id: 18, firstName: "Other", lastName: "Customer" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const customers = await getJobSyncCompanyCustomers("company-token");
      expect(customers).toHaveLength(2);
      expect(filterJobSyncCompanyCustomers(customers, "rob")).toEqual([expect.objectContaining({ id: 17, name: "Robert Smith" })]);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://www.homeserviceconnected.com/api/mobile/v1/customers",
        expect.objectContaining({
          cache: "no-store",
          headers: expect.objectContaining({ Authorization: "Bearer company-token" }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
      if (originalBaseUrl === undefined) delete process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL;
      else process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL = originalBaseUrl;
    }
  });

  it("persists Company schedule and lane updates through the authenticated mobile Jobs API", async () => {
    const originalBaseUrl = process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL;
    delete process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL;
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      await updateJobSyncCompanyJobSchedule("company-token", 47, {
        scheduledStartAt: "2026-10-14T14:00:00.000Z",
        scheduledEndAt: "2026-10-14T16:00:00.000Z",
        expectedUpdatedAt: "2026-10-13T20:00:00.000Z",
      });
      await updateJobSyncCompanyJobAssignment("company-token", 47, null);

      expect(fetchSpy).toHaveBeenNthCalledWith(
        1,
        "https://www.homeserviceconnected.com/api/mobile/v1/company/jobs/47/schedule",
        expect.objectContaining({
          method: "PATCH",
          cache: "no-store",
          headers: expect.objectContaining({ Authorization: "Bearer company-token" }),
          body: JSON.stringify({
            scheduledStartAt: "2026-10-14T14:00:00.000Z",
            scheduledEndAt: "2026-10-14T16:00:00.000Z",
            expectedUpdatedAt: "2026-10-13T20:00:00.000Z",
          }),
        }),
      );
      expect(fetchSpy).toHaveBeenNthCalledWith(
        2,
        "https://www.homeserviceconnected.com/api/mobile/v1/company/jobs/47/assignment",
        expect.objectContaining({
          method: "PATCH",
          cache: "no-store",
          body: JSON.stringify({ assignedUserId: null }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
      if (originalBaseUrl === undefined) delete process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL;
      else process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL = originalBaseUrl;
    }
  });

  it("rejects malformed Company customer rows", () => {
    expect(normalizeJobSyncCompanyCustomers({ customers: [{ id: 0, name: "Invalid" }, { id: 19, name: " " }] })).toEqual([]);
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

  it("normalizes active Company members and rejects a mismatched Company boundary", () => {
    const roster = normalizeJobSyncCompanyRoster({
      company: { id: 9, name: "Casey Services" },
      members: [
        { id: 41, name: "Alex Technician", role: "technician", isActive: true },
        { id: 42, name: "Inactive Member", role: "technician", isActive: false },
      ],
    }, 9);

    expect(roster?.company.name).toBe("Casey Services");
    expect(roster?.members).toEqual([{ id: 41, name: "Alex Technician", role: "technician", isActive: true }]);
    expect(normalizeJobSyncCompanyRoster({ company: { id: 10, name: "Other Company" }, members: [] }, 9)).toBeNull();
  });

  it("matches web calendar eligibility by rendering lanes for field technicians only", () => {
    expect(isJobSyncFieldSchedulingMember({ role: "technician" })).toBe(true);
    expect(isJobSyncFieldSchedulingMember({ role: "detailer" })).toBe(true);
    expect(isJobSyncFieldSchedulingMember({ role: "owner" })).toBe(false);
    expect(isJobSyncFieldSchedulingMember({ role: "dispatcher" })).toBe(false);
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

  it("normalizes Company time-off requests for employee history", () => {
    expect(normalizeHomeServiceConnectedTimeOff({
      requests: [
        { id: 7, startDate: "2026-10-12T00:00:00.000Z", endDate: "2026-10-13", hoursRequested: 16, status: "pending", reason: "Family", reviewerNote: null },
        { id: 8, startDate: "2026-10-20", endDate: "2026-10-20", status: "cancelled" },
      ],
    })).toEqual([{
      requestId: "7",
      startDate: "2026-10-12",
      endDate: "2026-10-13",
      totalDaysRequested: 2,
      daysNoticeGiven: 0,
      status: "pending",
      reason: "Family",
      managerNote: null,
    }]);
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

  it("normalizes active Company Community categories and post interactions", () => {
    expect(normalizeHomeServiceConnectedCommunityCategories({
      categories: [
        { id: 21, name: "Wins", description: "Share the good work", icon: "🏆", sortOrder: 2, isActive: true },
        { id: 22, name: "Archived", isActive: false },
      ],
    })).toEqual([
      { id: 21, name: "Wins", description: "Share the good work", icon: "🏆", sortOrder: 2, isActive: true },
    ]);

    expect(normalizeHomeServiceConnectedCommunityPosts({
      posts: [{ id: 51, category_id: 21, category_name: "Wins", category_icon: "🏆", author_user_id: 7, author_name: "Avery Stone", title: "Great review", body: "The customer thanked the team.", is_pinned: 1, comment_count: 2, like_count: 3, viewer_liked: true, created_at: "2026-09-14T18:00:00.000Z" }],
    })).toEqual([
      { id: 51, categoryId: 21, categoryName: "Wins", categoryIcon: "🏆", authorUserId: 7, authorName: "Avery Stone", title: "Great review", body: "The customer thanked the team.", mediaUrl: null, isPinned: true, commentCount: 2, likeCount: 3, viewerLiked: true, createdAt: "2026-09-14T18:00:00.000Z" },
    ]);
  });

  it("normalizes active Company Price Book services and preserves web service IDs", () => {
    expect(normalizeHomeServiceConnectedPriceBook({
      services: [
        { service_id: "svc-full", name: "Full Service", emoji: "🛠️", description: "Complete service", features: "[\"Wash\",\"Vacuum\"]", vehicle_prices: "{\"sedan\":180,\"suv\":220}", image_url_pb: "https://cdn.example.com/full.png", sort_order_pb: 2, is_active_pb: "yes" },
        { serviceId: "svc-inactive", name: "Inactive service", isActive: false },
        { serviceId: "svc-basic", name: "Basic Service", features: ["Exterior"], vehiclePrices: { sedan: 120 }, sortOrder: 1, isActive: true },
      ],
    })).toEqual([
      { serviceId: "svc-basic", name: "Basic Service", emoji: "🛠️", description: "", features: ["Exterior"], vehiclePrices: { sedan: 120 }, imageUrl: null, sortOrder: 1, serviceTypeId: null },
      { serviceId: "svc-full", name: "Full Service", emoji: "🛠️", description: "Complete service", features: ["Wash", "Vacuum"], vehiclePrices: { sedan: 180, suv: 220 }, imageUrl: "https://cdn.example.com/full.png", sortOrder: 2, serviceTypeId: null },
    ]);
  });

  it("normalizes the Company-owned timezone used to render scheduled jobs", () => {
    expect(normalizeJobSyncCompanySettings({
      company: { id: 9, name: "Lawn Sharks", timezone: "America/Chicago" },
    })).toEqual({ id: 9, name: "Lawn Sharks", timezone: "America/Chicago" });
  });
});
