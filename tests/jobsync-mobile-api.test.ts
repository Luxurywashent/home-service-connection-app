import { describe, expect, it } from "vitest";

import {
  createJobSyncBearerHeaders,
  createJobSyncCompanyMemberUpdatePayload,
  createJobSyncMobileLoginPayload,
  extractJobSyncMobileToken,
  normalizeJobSyncCompanyMemberDetail,
  normalizeJobSyncCompanyRoster,
  normalizeJobSyncMobileSession,
  normalizeJobSyncTimeCurrent,
  normalizeJobSyncTimeHistory,
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

  it("normalizes the authoritative time clock and active-break state", () => {
    const current = normalizeJobSyncTimeCurrent({
      data: {
        status: "clocked_in",
        timeEntry: {
          clockInTime: "2026-08-14T08:00:00.000Z",
          todayHours: 3.5,
          activeBreak: {
            breakId: 18,
            breakType: "lunch_30min",
            durationMinutes: 30,
            breakStartTime: "2026-08-14T11:30:00.000Z",
          },
        },
      },
    });

    expect(current).toEqual({
      status: "clocked_in",
      clockInTime: "2026-08-14T08:00:00.000Z",
      clockOutTime: null,
      activeBreak: {
        id: 18,
        type: "lunch_30min",
        durationMinutes: 30,
        breakStartTime: "2026-08-14T11:30:00.000Z",
        breakEndTime: null,
      },
      todayHours: 3.5,
    });
  });

  it("recognizes active-shift time payloads even when the server uses a clock-in flag", () => {
    const current = normalizeJobSyncTimeCurrent({
      data: {
        isClockedIn: true,
        activeShift: {
          startTime: "2026-08-14T08:00:00.000Z",
          currentBreak: {
            id: "break-4",
            startedAt: "2026-08-14T10:00:00.000Z",
          },
        },
      },
    });

    expect(current).toMatchObject({
      status: "clocked_in",
      clockInTime: "2026-08-14T08:00:00.000Z",
      activeBreak: { id: "break-4", breakStartTime: "2026-08-14T10:00:00.000Z" },
    });
  });

  it("normalizes JobSync timesheet records and embedded breaks", () => {
    const history = normalizeJobSyncTimeHistory({
      data: {
        records: [{
          id: 8,
          clockInTime: "2026-08-14T08:00:00.000Z",
          clockOutTime: "2026-08-14T12:00:00.000Z",
          totalHours: 4,
          breaks: [{
            id: 3,
            type: "lunch_30min",
            durationMinutes: 30,
            breakStartTime: "2026-08-14T10:00:00.000Z",
            breakEndTime: "2026-08-14T10:30:00.000Z",
          }],
        }],
      },
    });

    expect(history.totalHours).toBe(4);
    expect(history.logs[0]).toMatchObject({ recordId: 8, date: "2026-08-14", totalHours: 4 });
    expect(history.breaks[0]).toMatchObject({ breakId: 3, status: "taken", breakType: "lunch_30min" });
  });
});
