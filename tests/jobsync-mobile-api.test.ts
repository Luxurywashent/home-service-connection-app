import { describe, expect, it } from "vitest";

import {
  createJobSyncBearerHeaders,
  createJobSyncCompanyMemberUpdatePayload,
  createJobSyncMobileLoginPayload,
  extractJobSyncMobileToken,
  normalizeJobSyncCompanyMemberDetail,
  normalizeJobSyncCompanyRoster,
  normalizeJobSyncMobileSession,
  normalizeHomeServiceConnectedTimeState,
  normalizeHomeServiceConnectedChatGroups,
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
});
