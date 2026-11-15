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
  deleteJobSyncMobileAccount,
  getHomeServiceConnectedTimesheets,
  getJobSyncCompanyJobs,
  getJobSyncCompanyCustomers,
  normalizeHomeServiceConnectedTimesheets,
  updateJobSyncCompanyJobAssignment,
  updateJobSyncCompanyJobSchedule,
  getJobSyncCompanyJobDetail,
  normalizeJobSyncCompanyJobDetail,
  updateJobSyncCompanyJobStatus,
  sendJobSyncCompanyJobInvoice,
  positiveJobSyncId,
  JobSyncApiError,
  getJobSyncMobileSession,
  updateJobSyncCompanyMember,
  normalizeJobSyncPhotoUrl,
  cancelJobSyncCompanyJob,
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

  it("loads Company time records from the protected HSC timesheet endpoint", async () => {
    const originalBaseUrl = process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL;
    delete process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL;
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [{ id: 8, member_name: "Avery Technician", business_date: "2026-10-16", clock_in: "2026-10-16T13:00:00.000Z", clock_out: "2026-10-16T21:00:00.000Z", total_hours: "8" }],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      await expect(getHomeServiceConnectedTimesheets("company-token", { start: "2026-10-13", end: "2026-10-19", memberId: 41 })).resolves.toEqual([
        { id: 8, memberName: "Avery Technician", date: "2026-10-16", clockIn: "2026-10-16T13:00:00.000Z", clockOut: "2026-10-16T21:00:00.000Z", breakStart: null, breakEnd: null, totalHours: 8 },
      ]);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://www.homeserviceconnected.com/api/mobile/v1/time/timesheets?start=2026-10-13&end=2026-10-19&memberId=41",
        expect.objectContaining({ method: "GET", cache: "no-store", headers: expect.objectContaining({ Authorization: "Bearer company-token" }) }),
      );
    } finally {
      vi.unstubAllGlobals();
      if (originalBaseUrl === undefined) delete process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL;
      else process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL = originalBaseUrl;
    }
  });

  it("rejects invalid dates and ignores malformed Company time records", async () => {
    expect(normalizeHomeServiceConnectedTimesheets({ records: [{ id: 0, date: "not-a-date" }] })).toEqual([]);
    await expect(getHomeServiceConnectedTimesheets("company-token", { start: "2026-10-20", end: "2026-10-19" })).rejects.toThrow("valid time-reporting date range");
  });

  it("deletes only the authenticated Team Member account through the Company auth endpoint", async () => {
    const originalBaseUrl = process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL;
    delete process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL;
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deleted: true }) });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      await expect(deleteJobSyncMobileAccount("company-token")).resolves.toEqual({ deleted: true });
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://www.homeserviceconnected.com/api/mobile/v1/auth/account",
        expect.objectContaining({
          method: "DELETE",
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
        { id: 41, name: "Alex Technician", role: "technician", isActive: true, calendarEligible: true },
        { id: 42, name: "Inactive Member", role: "technician", isActive: false },
      ],
    }, 9);

    expect(roster?.company.name).toBe("Casey Services");
    expect(roster?.members).toEqual([{ id: 41, name: "Alex Technician", role: "technician", isActive: true, calendarEligible: true }]);
    expect(normalizeJobSyncCompanyRoster({ company: { id: 10, name: "Other Company" }, members: [] }, 9)).toBeNull();
  });

  it("matches the web calendar position setting instead of role-only lane eligibility", () => {
    expect(isJobSyncFieldSchedulingMember({ role: "technician", calendarEligible: true })).toBe(true);
    expect(isJobSyncFieldSchedulingMember({ role: "detailer", calendarEligible: true })).toBe(true);
    expect(isJobSyncFieldSchedulingMember({ role: "technician", calendarEligible: false })).toBe(false);
    expect(isJobSyncFieldSchedulingMember({ role: "technician" })).toBe(false);
    expect(isJobSyncFieldSchedulingMember({ role: "owner", calendarEligible: true })).toBe(false);
    expect(isJobSyncFieldSchedulingMember({ role: "dispatcher", calendarEligible: true })).toBe(false);
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
    expect(normalizeHomeServiceConnectedTimeState({
      data: { entry: { id: 18, clockIn: "2026-10-17T15:00:00.000Z", breakStart: "2026-10-17T17:00:00.000Z", breakEnd: null } },
    })).toEqual({
      isClockedIn: true,
      clockInAt: "2026-10-17T15:00:00.000Z",
      activeBreak: { isActive: true, startedAt: "2026-10-17T17:00:00.000Z" },
    });
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

  it("normalizes final-backend lifecycle/photo DTO without inventing assignment or milestones", () => {
    const detail = normalizeJobSyncCompanyJobDetail({ job: {
      id: 47, company_id: 9, assignedUserId: null, status: "on_site", updatedAt: "2026-11-14T18:00:00.000Z",
      enRouteAt: "2026-11-14T17:00:00.000Z", onSiteAt: "2026-11-14T17:20:00.000Z", completedAt: null,
      photos: [{ id: 7, imageUrl: "https://unit.test/photo.jpg", caption: "Existing caption", uploadedByUserId: 41, createdAt: "2026-11-14T17:22:00.000Z" }],
    } }, 47, 9);
    expect(detail?.assignedUserId).toBeNull();
    expect(detail?.completedAt).toBeNull();
    expect(detail?.status).toBe("on_site");
    expect(detail?.photos).toEqual([{ id: 7, imageUrl: "https://unit.test/photo.jpg", caption: "Existing caption", uploadedByUserId: 41, createdAt: "2026-11-14T17:22:00.000Z" }]);
    for (const invalid of [null, undefined, "", "bad", 0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1]) expect(positiveJobSyncId(invalid)).toBeNull();
    expect(positiveJobSyncId("41")).toBe(41);
    expect(normalizeJobSyncCompanyJobDetail({ job: { id: 47, company_id: 10 } }, 47, 9)).toBeNull();
    expect(normalizeJobSyncCompanyJobDetail({ job: { id: 48, company_id: 9 } }, 47, 9)).toBeNull();
    expect(normalizeJobSyncCompanyJobDetail({ job: { id: 47, status: "draft", photos: [], photo_urls: '["https://unit.test/stale.jpg"]' } }, 47, 9)?.photos).toEqual([]);
    expect(normalizeJobSyncCompanyJobDetail({ job: { id: 47, photos: [] } }, 47, 9)?.status).toBe("unknown");
  });

  it("uses preserved configured origin, bearer detail/status and exact canonical invoice body/publicUrl", async () => {
    vi.stubEnv("EXPO_PUBLIC_JOBSYNC_API_BASE_URL", "https://jobwash-veysiubh.manus.space");
    const mock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ job: { id: 47, company_id: 9, assignedUserId: 41, status: "on_site", updatedAt: "2026-11-14T18:00:00.000Z", photos: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, status: "completed" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, publicUrl: "https://unit.test/invoice", status: "sent", channel: "sms" }) });
    vi.stubGlobal("fetch", mock);
    try {
      const detail = await getJobSyncCompanyJobDetail("mock-company-token", 47, 9);
      await updateJobSyncCompanyJobStatus("mock-company-token", 47, { status: "completed", expectedUpdatedAt: detail.updatedAt, note: "ignored", timestamp: "ignored", intent: "ignored" } as any);
      const invoice = await sendJobSyncCompanyJobInvoice("mock-company-token", 47, { method: "sms", resend: true, overridePhone: "ignored", amount: 12 } as any);
      expect(invoice.publicUrl).toBe("https://unit.test/invoice");
      expect(invoice.status).toBe("sent");
      expect(mock).toHaveBeenNthCalledWith(1, "https://jobwash-veysiubh.manus.space/api/mobile/v1/jobs/47", expect.objectContaining({ method: "GET", cache: "no-store", headers: expect.objectContaining({ Authorization: "Bearer mock-company-token" }) }));
      expect(mock).toHaveBeenNthCalledWith(2, "https://jobwash-veysiubh.manus.space/api/mobile/v1/jobs/47/status", expect.objectContaining({ method: "PATCH", headers: expect.objectContaining({ Authorization: "Bearer mock-company-token" }), body: JSON.stringify({ status: "completed", expectedUpdatedAt: "2026-11-14T18:00:00.000Z" }) }));
      expect(mock).toHaveBeenNthCalledWith(3, "https://jobwash-veysiubh.manus.space/api/mobile/v1/jobs/47/invoice", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer mock-company-token" }), body: JSON.stringify({ method: "sms", resend: true }) }));
      expect(mock.mock.calls.some(([url]) => url.includes("trpc"))).toBe(false);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  it.each(["queued", null, undefined])("preserves queued or unknown invoice delivery status: %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, publicUrl: "https://unit.test/invoice", status }) }));
    try {
      const invoice = await sendJobSyncCompanyJobInvoice("mock-unit-token", 47, { method: "email" });
      expect(invoice.status).toBe(status === "queued" ? "queued" : null);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([[401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [404, "NOT_FOUND"], [409, "CONFLICT"], [400, "BAD_REQUEST"]])("preserves backend status/code %s instead of message-only failures", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: { code, message: "Safe backend denial" } }) }));
    try {
      await expect(updateJobSyncCompanyJobStatus("mock-unit-token", 47, { status: "en_route" })).rejects.toMatchObject({ name: "JobSyncApiError", status, code, message: "Safe backend denial" });
    } finally { vi.unstubAllGlobals(); }
  });

  it("requires acknowledged canonical status and refuses legacy invoice response/invalid IDs", async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, status: "confirmed", paymentUrl: "https://unit.test/legacy" }) });
    vi.stubGlobal("fetch", mock);
    try {
      await expect(updateJobSyncCompanyJobStatus("mock-unit-token", 47, { status: "en_route" })).rejects.toBeInstanceOf(JobSyncApiError);
      await expect(sendJobSyncCompanyJobInvoice("mock-unit-token", 47, { method: "email" })).rejects.toThrow("did not confirm");
      const calls = mock.mock.calls.length;
      await expect(getJobSyncCompanyJobDetail("mock-unit-token", 0, 9)).rejects.toThrow("invalid Job");
      await expect(updateJobSyncCompanyJobStatus("mock-unit-token", 47, { status: "arrived" as any })).rejects.toThrow("valid Company field");
      expect(mock).toHaveBeenCalledTimes(calls);
    } finally { vi.unstubAllGlobals(); }
  });

  it("preserves timeout classification for reconciliation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })));
    try {
      await expect(updateJobSyncCompanyJobStatus("mock-unit-token", 47, { status: "on_site" })).rejects.toMatchObject({ status: null, code: "TIMEOUT" });
    } finally { vi.unstubAllGlobals(); }
  });
  it("preserves raw signed Company capability true/false/null and distinguishes absence; rejects malformed projections", () => {
    const payload = { accountType: "company", user: { id: 41, name: "Owner", role: "owner" }, company: { id: 9, name: "Unit" } };
    const missing = normalizeJobSyncMobileSession(payload, "mock-token")!;
    expect(missing.user.calendarEligible).toBeUndefined();
    expect(Object.hasOwn(missing.user, "calendarEligible")).toBe(false);
    for (const calendarEligible of [true, false, null]) {
      const signed = normalizeJobSyncMobileSession({ ...payload, user: { ...payload.user, calendarEligible } }, "mock-token")!;
      expect(signed.user.calendarEligible).toBe(calendarEligible);
      expect(Object.hasOwn(signed.user, "calendarEligible")).toBe(true);
      expect(signed.user.role).toBe("owner");
    }
    for (const calendarEligible of ["true", "false", 1, 0, {}, [], "", NaN]) {
      expect(normalizeJobSyncMobileSession({ ...payload, user: { ...payload.user, calendarEligible } }, "mock-token")).toBeNull();
    }
    const hints = normalizeJobSyncMobileSession({ ...payload, calendarEligible: true, user: { ...payload.user, availableForFieldJobs: true }, company: { ...payload.company, calendarEligible: true } }, "mock-token")!;
    expect(hints.user.calendarEligible).toBeUndefined();
    const platform = normalizeJobSyncMobileSession({ accountType: "platform_admin", user: { id: 3, role: "owner", calendarEligible: true } }, "mock-token")!;
    expect(platform.user.calendarEligible).toBeUndefined();
  });
  it("reads fresh capability through the existing signed no-store auth/session route", async () => {
    vi.stubEnv("EXPO_PUBLIC_JOBSYNC_API_BASE_URL", "https://jobwash-veysiubh.manus.space");
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: { id: 41, role: "dispatcher", calendarEligible: true }, company: { id: 9, name: "Unit" } }) });
    vi.stubGlobal("fetch", mock);
    try {
      expect((await getJobSyncMobileSession("mock-token")).user.calendarEligible).toBe(true);
      expect(mock).toHaveBeenCalledWith("https://jobwash-veysiubh.manus.space/api/mobile/v1/auth/session", expect.objectContaining({ method: "GET", cache: "no-store", headers: expect.objectContaining({ Authorization: "Bearer mock-token" }) }));
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it("normalizes nullable raw member overrides without confusing position-roster eligibility", () => {
    for (const calendarEligibleOverride of [true, false, null]) {
      const roster = normalizeJobSyncCompanyRoster({ company: { id: 9 }, members: [{ id: 41, name: "Unit", role: "dispatcher", calendarEligible: true, calendarEligibleOverride }] }, 9)!;
      expect(roster.members[0].calendarEligibleOverride).toBe(calendarEligibleOverride);
      expect(roster.members[0].calendarEligible).toBe(true);
      const explicit = normalizeJobSyncCompanyMemberDetail({ member: { id: 41, name: "Unit", calendarEligibleOverride, calendarEligible: true } }, 41)!;
      expect(explicit.calendarEligibleOverride).toBe(calendarEligibleOverride);
      const existingRaw = normalizeJobSyncCompanyMemberDetail({ member: { id: 41, name: "Unit", calendarEligible: calendarEligibleOverride } }, 41)!;
      expect(existingRaw.calendarEligibleOverride).toBe(calendarEligibleOverride);
    }
    const roster = normalizeJobSyncCompanyRoster({ company: { id: 9 }, members: [{ id: 41, name: "Unit", role: "dispatcher", calendarEligible: true }] }, 9)!;
    expect(roster.members[0].calendarEligibleOverride).toBeUndefined();
    for (const calendarEligibleOverride of [undefined, "true", 1, {}]) {
      expect(normalizeJobSyncCompanyMemberDetail({ member: { id: 41, name: "Unit", calendarEligibleOverride } }, 41)?.calendarEligibleOverride).toBeUndefined();
    }
  });
  it("supports capability-only true/false member PATCH without profile or role conversion", async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", mock);
    try {
      for (const calendarEligibleOverride of [true, false]) {
        expect(createJobSyncCompanyMemberUpdatePayload({ calendarEligibleOverride })).toEqual({ calendarEligibleOverride });
        await updateJobSyncCompanyMember("mock-owner-token", 42, { calendarEligibleOverride });
        expect(mock).toHaveBeenLastCalledWith(expect.stringMatching(/\/api\/mobile\/v1\/company\/team-members\/42$/), expect.objectContaining({ method: "PATCH", headers: expect.objectContaining({ Authorization: "Bearer mock-owner-token" }), body: JSON.stringify({ calendarEligibleOverride }) }));
      }
      expect(createJobSyncCompanyMemberUpdatePayload({ calendarEligibleOverride: "true" } as any)).toEqual({});
    } finally { vi.unstubAllGlobals(); }
  });
  it("resolves only trusted managed root-relative photo paths at the configured origin, preserving signed queries", () => {
    vi.stubEnv("EXPO_PUBLIC_JOBSYNC_API_BASE_URL", "https://jobwash-veysiubh.manus.space/");
    try {
      const relative = "/manus-storage/companies/9/jobs/47/photos/photo.jpg?expires=123&signature=AbC%2B%2F%3D";
      const expected = `https://jobwash-veysiubh.manus.space${relative}`;
      expect(normalizeJobSyncPhotoUrl(relative)).toBe(expected);
      const photos = normalizeJobSyncCompanyJobDetail({ job: { id: 47, company_id: 9, photos: [{ id: 1, imageUrl: relative }] } }, 47, 9)!.photos;
      expect(photos[0].imageUrl).toBe(expected);
      const absolute = "https://cdn.example.com/photo.jpg?signature=AbC%2B123%3D";
      expect(normalizeJobSyncPhotoUrl(absolute)).toBe(absolute);
    } finally { vi.unstubAllEnvs(); }
  });
  it.each([
    "//foreign.test/api/storage/photo.jpg", "data:image/png;base64,AAA", "javascript:alert(1)", "file:///photo.jpg", "http://foreign.test/photo.jpg",
    "/photos/a.jpg", "api/storage/a.jpg", "/api/mobile/v1/jobs/47", "/api/storage/", "/api/storage/../secret", "/api/storage/./a.jpg",
    "/api/storage/%2e%2e/secret", "/api/storage/%252e%252e/secret", "/api/storage/folder/%2f..%2fsecret", "/api/storage//foreign.test/a.jpg",
    "/api/storage/\\foreign.test/a.jpg", "/api/storage/%5ca.jpg", "/api/storage/%00.jpg", "/api/storage/a.jpg\n", " /api/storage/a.jpg",
    "/api/storage/a.jpg?token=x\r\ny", "https://cdn.test/a\n.jpg", "https://user:pass@cdn.test/photo.jpg", "https://", null,
    "https://cdn.test/a/../secret.jpg", "https://cdn.test/a/%2e%2e/secret.jpg", "https://cdn.test/a/%2500.jpg", "/api/storage/%2500.jpg",
  ])("rejects unsafe/unsupported photo URL %s", (url) => {
    expect(normalizeJobSyncPhotoUrl(url)).toBeNull();
    expect(normalizeJobSyncCompanyJobDetail({ job: { id: 47, photos: [{ id: 1, image_url: url }] } }, 47, 9)?.photos).toEqual([]);
  });
  it("uses the existing canonical cancelled path with exact refreshed version body, never field status payload extensions", async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, status: "cancelled" }) });
    vi.stubGlobal("fetch", mock);
    try {
      await expect(cancelJobSyncCompanyJob("mock-owner-token", 47, { expectedUpdatedAt: "2026-11-14T18:00:00.000Z", note: "ignored", intent: "ignored" } as any)).resolves.toEqual({ success: true, status: "cancelled" });
      expect(mock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/mobile\/v1\/jobs\/47\/status$/), expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "cancelled", expectedUpdatedAt: "2026-11-14T18:00:00.000Z" }) }));
      await expect(updateJobSyncCompanyJobStatus("mock-owner-token", 47, { status: "cancelled" as any })).rejects.toThrow("valid Company field");
      await expect(cancelJobSyncCompanyJob("mock-owner-token", 47, { expectedUpdatedAt: "bad" })).rejects.toThrow("fresh Company Job version");
      expect(mock).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([
    { name: "paid", paidTotal: 200.75, refundTotal: 0, appliedEstimateCredit: 0, balance: 0, paymentStatus: "paid" },
    { name: "partial", paidTotal: 50.25, refundTotal: 0, appliedEstimateCredit: 0, balance: 150.5, paymentStatus: "partial" },
    { name: "refund reopened", paidTotal: 150.75, refundTotal: 50, appliedEstimateCredit: 0, balance: 50, paymentStatus: "partial" },
    { name: "fully refunded", paidTotal: 0, refundTotal: 200.75, appliedEstimateCredit: 0, balance: 200.75, paymentStatus: "unpaid" },
    { name: "estimate-credit partial", paidTotal: 75.5, refundTotal: 0, appliedEstimateCredit: 75.5, balance: 125.25, paymentStatus: "partial" },
    { name: "estimate-credit settled", paidTotal: 200.75, refundTotal: 0, appliedEstimateCredit: 200.75, balance: 0, paymentStatus: "paid" },
  ])("preserves canonical $name finance in actual list and detail adapters, without fabricated payments", async ({ name: _name, ...finance }) => {
    const row = { id: 47, companyId: 9, customerId: 17, amount: 200.75, status: "completed", photos: [], ...finance };
    const mock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ jobs: [row] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ job: row }) });
    vi.stubGlobal("fetch", mock);
    try {
      const [listJob] = await getJobSyncCompanyJobs("mock-company-token");
      const detail = await getJobSyncCompanyJobDetail("mock-company-token", 47, 9);
      for (const job of [listJob, detail]) {
        expect(job).toMatchObject({ amount: 200.75, ...finance });
        for (const field of ["payment", "method", "paidAt", "receipt", "tip"]) expect(job).not.toHaveProperty(field);
      }
      expect(mock).toHaveBeenCalledTimes(2);
      expect(mock.mock.calls.every(([, init]) => init.method === "GET" && init.cache === "no-store")).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it("preserves valid numeric-dollar strings through list and detail without recalculating credit/refunds", async () => {
    const row = { id: 47, companyId: 9, amount: 200.75, paidTotal: "75.50", refundTotal: "10.25", appliedEstimateCredit: "25.00", balance: "125.25", paymentStatus: "partial", photos: [] };
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs: [row] }) });
    vi.stubGlobal("fetch", mock);
    try {
      const [listJob] = await getJobSyncCompanyJobs("mock-token");
      const detail = normalizeJobSyncCompanyJobDetail({ job: row }, 47, 9);
      for (const job of [listJob, detail]) expect(job).toMatchObject({ paidTotal: 75.5, refundTotal: 10.25, appliedEstimateCredit: 25, balance: 125.25, paymentStatus: "partial" });
      expect(row.balance).toBe("125.25");
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([undefined, null, "", " ", "malformed", "0x10", "1e2", true, false, {}, [], [0], NaN, Infinity, -Infinity, -1, "-0.01"])("keeps invalid/missing financial DTO money null rather than zero: %s", async (value) => {
    const row = { id: 47, companyId: 9, photos: [], paidTotal: value, refundTotal: value, appliedEstimateCredit: value, balance: value };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs: [row] }) }));
    try {
      const [listJob] = await getJobSyncCompanyJobs("mock-token");
      const detail = normalizeJobSyncCompanyJobDetail({ job: row }, 47, 9);
      for (const job of [listJob, detail]) expect(job).toMatchObject({ paidTotal: null, refundTotal: null, appliedEstimateCredit: null, balance: null, paymentStatus: null });
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([null, "", "unknown", "refunded", "failed", "PAID", {}, 0, true])("keeps malformed/unsupported paymentStatus unknown in both adapters: %s", async (paymentStatus) => {
    const row = { id: 47, companyId: 9, photos: [], balance: 0, paidTotal: 200, refundTotal: 0, appliedEstimateCredit: 0, paymentStatus };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs: [row] }) }));
    try {
      const [listJob] = await getJobSyncCompanyJobs("mock-token");
      expect(listJob.paymentStatus).toBeNull();
      expect(normalizeJobSyncCompanyJobDetail({ job: row }, 47, 9)?.paymentStatus).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });

  it("prefers email provider acceptance over the sent compatibility alias and returns only bounded fields", async () => {
    vi.stubEnv("EXPO_PUBLIC_JOBSYNC_API_BASE_URL", "https://jobwash-veysiubh.manus.space");
    const publicUrl = "https://www.homeserviceconnected.com/invoice/opaque-token?signature=AbC%2B123";
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, status: "sent", communicationState: "provider_accepted", channel: "email", publicUrl, deliveryId: 17, communicationId: 23, providerMessageId: "sensitive-provider-id", sentTo: "private@example.test", invented: "ignored" }) });
    vi.stubGlobal("fetch", mock);
    try {
      const invoice = await sendJobSyncCompanyJobInvoice("mock-owner-token", 47, { method: "email" });
      expect(invoice).toEqual({ success: true, publicUrl, status: "provider_accepted", communicationState: "provider_accepted", channel: "email", isDelivered: false });
      expect(invoice.status).not.toBe("sent");
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock).toHaveBeenCalledWith("https://jobwash-veysiubh.manus.space/api/mobile/v1/jobs/47/invoice", expect.objectContaining({ method: "POST", cache: "no-store", headers: expect.objectContaining({ Authorization: "Bearer mock-owner-token" }), body: JSON.stringify({ method: "email" }) }));
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  it.each(["queued", "sending", "provider_accepted", "delivered", "failed", "bounced", "complained", "suppressed", "cancelled"])("preserves canonical communication state %s and marks only actual delivered as delivered", async (communicationState) => {
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, publicUrl: "https://unit.test/invoice", status: "sent", communicationState }) });
    vi.stubGlobal("fetch", mock);
    try {
      for (const method of ["email", "sms"] as const) {
        const invoice = await sendJobSyncCompanyJobInvoice("mock-token", 47, { method });
        expect(invoice.status).toBe(communicationState);
        expect(invoice.communicationState).toBe(communicationState);
        expect(invoice.isDelivered).toBe(communicationState === "delivered");
      }
      expect(mock).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([null, "", "invented_delivery", "sent", {}, [], true, 1])("does not fall back to sent/delivered aliases when canonical ledger state is malformed: %s", async (communicationState) => {
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, publicUrl: "https://unit.test/invoice", status: "delivered", communicationState }) });
    vi.stubGlobal("fetch", mock);
    try {
      for (const method of ["email", "sms"] as const) expect(await sendJobSyncCompanyJobInvoice("mock-token", 47, { method })).toMatchObject({ status: null, communicationState: null, isDelivered: false });
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(["sent", "delivered", "invented_delivery", null, undefined, {}])("does not claim email delivery from a compatibility-only status: %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, publicUrl: "https://unit.test/invoice", status }) }));
    try {
      expect(await sendJobSyncCompanyJobInvoice("mock-token", 47, { method: "email" })).toMatchObject({ status: null, communicationState: null, channel: "email", isDelivered: false });
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(["queued", "sending", "provider_accepted", "sent", "delivered", "suppressed", "failed", "unknown", null])("preserves honest SMS status without treating acknowledgment as delivery: %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, publicUrl: "https://unit.test/invoice", status, channel: "sms" }) }));
    try {
      expect(await sendJobSyncCompanyJobInvoice("mock-token", 47, { method: "sms" })).toEqual({ success: true, publicUrl: "https://unit.test/invoice", status: status === "unknown" ? null : status, communicationState: null, channel: "sms", isDelivered: status === "delivered" });
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([[403, "FORBIDDEN"], [409, "CONFLICT"]] as const)("preserves invoice backend error %s and never retries or falls back", async (status, code) => {
    const mock = vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: { code, message: "Safe invoice denial" } }) });
    vi.stubGlobal("fetch", mock);
    try {
      await expect(sendJobSyncCompanyJobInvoice("mock-token", 47, { method: "email" })).rejects.toMatchObject({ name: "JobSyncApiError", status, code });
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock.mock.calls[0][0]).toMatch(/\/api\/mobile\/v1\/jobs\/47\/invoice$/);
    } finally { vi.unstubAllGlobals(); }
  });

  it("does not retry or fall back after an uncertain invoice timeout", async () => {
    const mock = vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    vi.stubGlobal("fetch", mock);
    try {
      await expect(sendJobSyncCompanyJobInvoice("mock-token", 47, { method: "sms" })).rejects.toMatchObject({ status: null, code: "TIMEOUT" });
      expect(mock).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
});
