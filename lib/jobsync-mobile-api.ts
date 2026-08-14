export type JobSyncAccountType = "company" | "platform_admin";
export type JobSyncPortalKind = "company" | "platform";
export type JobSyncCompanyRole = "owner" | "dispatcher" | "technician";
export type JobSyncPlatformRole = "owner" | "developer" | "sales" | "customer_support" | "operations";

export type JobSyncNativeSession = {
  token: string;
  portal: JobSyncPortalKind;
  user: {
    id: number;
    name: string;
    email: string | null;
    role: JobSyncCompanyRole | JobSyncPlatformRole;
    memberId?: string;
  };
  company?: {
    id: number;
    name: string;
    slug: string;
    logoUrl: string | null;
    primaryColor: string | null;
    accentColor: string | null;
  };
};

export type JobSyncCompanyMember = {
  id: number;
  name: string;
  role: string;
  isActive: boolean;
};

export type JobSyncCompanyMemberDetail = JobSyncCompanyMember & {
  memberId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  hireDate: string | null;
  availability: string | null;
  workDays: string[];
  hourlyRate: number | null;
  upsellBonusPct: number | null;
  mysteryBonusStatus: string | null;
  assignedVehicle: {
    id: number | null;
    name: string;
    shift: string | null;
    assignedAt: string | null;
  } | null;
};

export type JobSyncCompanyRoster = {
  company: { id: number; name: string };
  members: JobSyncCompanyMember[];
};

export type JobSyncCompanyMemberUpdateInput = {
  firstName: string;
  lastName: string;
  role: JobSyncCompanyRole;
  email?: string;
  phone?: string;
  city?: string;
  availability?: "available" | "busy" | "off_duty";
};

const DEFAULT_JOBSYNC_BASE_URL = "https://jobwash-veysiubh.manus.space";
const LOGIN_PATH = "/api/mobile/v1/auth/login";
const SESSION_PATH = "/api/mobile/v1/auth/session";
const COMPANY_TEAM_MEMBERS_PATH = "/api/mobile/v1/company/team-members";
const COMPANY_ROLES = new Set(["owner", "dispatcher", "technician"]);
const PLATFORM_ROLES = new Set(["owner", "developer", "sales", "customer_support", "operations"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstRecord(...values: unknown[]) {
  for (const value of values) {
    const record = asRecord(value);
    if (record) return record;
  }
  return null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function nullableNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim()).map((item) => item.trim());
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function isActiveMember(value: unknown) {
  return value !== false && value !== 0 && value !== "0" && value !== "false";
}

function errorMessage(payload: unknown, fallback: string) {
  const root = asRecord(payload);
  const error = asRecord(root?.error);
  return firstString(error?.message, root?.message) ?? fallback;
}

function getJobSyncBaseUrl() {
  const configured = process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL?.trim();
  return (configured || DEFAULT_JOBSYNC_BASE_URL).replace(/\/$/, "");
}

async function requestJson(path: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${getJobSyncBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(errorMessage(payload, response.status === 401 ? "Invalid email or password." : "JobSync authentication is unavailable."));
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("JobSync took too long to respond. Check your connection and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function extractJobSyncMobileToken(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const auth = firstRecord(root?.auth, data?.auth);
  const session = firstRecord(root?.session, data?.session);
  return firstString(
    root?.token,
    root?.accessToken,
    root?.access_token,
    root?.bearerToken,
    data?.token,
    data?.accessToken,
    data?.access_token,
    data?.bearerToken,
    auth?.token,
    auth?.accessToken,
    session?.token,
    session?.accessToken,
    session?.bearerToken,
  );
}

export function createJobSyncMobileLoginPayload(input: { accountType: JobSyncAccountType; email: string; password: string }) {
  return {
    accountType: input.accountType,
    email: input.email.trim().toLowerCase(),
    password: input.password,
  };
}

export function createJobSyncBearerHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function createJobSyncCompanyMemberUpdatePayload(input: JobSyncCompanyMemberUpdateInput) {
  return {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    role: input.role,
    ...(input.email?.trim() ? { email: input.email.trim().toLowerCase() } : {}),
    ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
    ...(input.city?.trim() ? { city: input.city.trim() } : {}),
    ...(input.availability ? { availability: input.availability } : {}),
  };
}

function normalizeCompanyRole(value: string | null): JobSyncCompanyRole | null {
  const normalized = value?.toLowerCase().replace(/[ -]+/g, "_") ?? "";
  if (normalized === "admin" || normalized === "company_admin") return "owner";
  if (normalized === "operations_manager" || normalized === "ops_manager") return "dispatcher";
  if (normalized === "detailer" || normalized === "field_technician") return "technician";
  return COMPANY_ROLES.has(normalized) ? normalized as JobSyncCompanyRole : null;
}

function normalizePlatformRole(value: string | null): JobSyncPlatformRole | null {
  const normalized = value?.toLowerCase().replace(/[ -]+/g, "_") ?? "";
  if (normalized === "admin" || normalized === "platform_admin") return "owner";
  if (normalized === "support") return "customer_support";
  return PLATFORM_ROLES.has(normalized) ? normalized as JobSyncPlatformRole : null;
}

export function normalizeJobSyncMobileSession(payload: unknown, token: string): JobSyncNativeSession | null {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const session = firstRecord(data.session, root?.session, data) ?? {};
  const profile = firstRecord(session.profile, data.profile, root?.profile, session) ?? {};
  const user = firstRecord(profile.user, session.user, data.user, root?.user, profile) ?? {};
  const company = firstRecord(profile.company, session.company, data.company, root?.company);
  const accountType = firstString(
    profile.accountType,
    session.accountType,
    data.accountType,
    root?.accountType,
    profile.portal,
    session.portal,
    data.portal,
    root?.portal,
    profile.type,
  )?.toLowerCase().replace(/[ -]+/g, "_");
  const rawRole = firstString(user.role, user.platformRole, profile.role, profile.platformRole, session.role);
  const platform = accountType === "platform_admin" || accountType === "platform" || Boolean(user.platformRole ?? profile.platformRole);
  const role = platform ? normalizePlatformRole(rawRole) : normalizeCompanyRole(rawRole);
  const userId = firstNumber(user.id, user.userId, user.ownerId, profile.userId, profile.ownerId, session.userId, session.ownerId);
  if (!role || !userId) return null;

  const normalizedUser = {
    id: userId,
    name: firstString(user.name, user.displayName, user.fullName, profile.name, profile.displayName) ?? "Home Service Connection user",
    email: firstString(user.email, profile.email),
    role,
    memberId: firstString(user.memberId, user.identifier, user.ownerIdentifier, profile.memberId, profile.identifier) ?? undefined,
  };

  if (platform) {
    return { token, portal: "platform", user: normalizedUser };
  }

  const companyId = firstNumber(company?.id, company?.companyId, profile.companyId, session.companyId, user.companyId);
  if (!companyId || !company) return null;
  return {
    token,
    portal: "company",
    user: normalizedUser,
    company: {
      id: companyId,
      name: firstString(company.name, company.companyName, profile.companyName) ?? "Company workspace",
      slug: firstString(company.slug, profile.companySlug) ?? "",
      logoUrl: firstString(company.logoUrl, company.logo_url),
      primaryColor: firstString(company.primaryColor, company.primary_color),
      accentColor: firstString(company.accentColor, company.accent_color),
    },
  };
}

export async function getJobSyncMobileSession(token: string) {
  const payload = await requestJson(SESSION_PATH, {
    method: "GET",
    headers: createJobSyncBearerHeaders(token),
  });
  const session = normalizeJobSyncMobileSession(payload, token);
  if (!session) throw new Error("JobSync returned an unsupported mobile session profile.");
  return session;
}

export function normalizeJobSyncCompanyRoster(payload: unknown, expectedCompanyId: number): JobSyncCompanyRoster | null {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const company = firstRecord(data.company, root?.company);
  const companyId = firstNumber(company?.id, company?.companyId, data.companyId, root?.companyId);
  if (!company || companyId !== expectedCompanyId) return null;

  const rawMembers = Array.isArray(data.members) ? data.members : Array.isArray(root?.members) ? root.members : [];
  const members = rawMembers.flatMap((value) => {
    const member = asRecord(value);
    const id = firstNumber(member?.id, member?.userId, member?.memberId);
    const name = firstString(member?.name, member?.displayName, member?.fullName, [member?.firstName, member?.lastName].filter(Boolean).join(" "));
    if (!member || !id || !name || !isActiveMember(member.isActive ?? member.is_active)) return [];
    return [{
      id,
      name,
      role: firstString(member.role, member.memberRole) ?? "team_member",
      isActive: true,
    }];
  });

  return {
    company: { id: companyId, name: firstString(company.name, company.companyName) ?? "Company workspace" },
    members,
  };
}

export async function getJobSyncCompanyMembers(token: string, expectedCompanyId: number) {
  const payload = await requestJson(COMPANY_TEAM_MEMBERS_PATH, {
    method: "GET",
    headers: createJobSyncBearerHeaders(token),
  });
  const roster = normalizeJobSyncCompanyRoster(payload, expectedCompanyId);
  if (!roster) throw new Error("JobSync returned an invalid Company team roster.");
  return roster;
}

export function normalizeJobSyncCompanyMemberDetail(payload: unknown, expectedMemberId: number): JobSyncCompanyMemberDetail | null {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const member = firstRecord(data.member, root?.member, data.profile) ?? {};
  const id = firstNumber(member.id, member.userId, member.memberId);
  if (id !== expectedMemberId || !isActiveMember(member.isActive ?? member.is_active)) return null;

  const firstName = firstString(member.firstName, member.first_name) ?? "";
  const lastName = firstString(member.lastName, member.last_name) ?? "";
  const name = firstString(member.name, member.displayName, member.fullName, `${firstName} ${lastName}`.trim());
  if (!name) return null;
  const vehicle = firstRecord(member.assignedVehicle, member.assigned_vehicle, member.vehicle);

  return {
    id,
    name,
    memberId: firstString(member.memberId, member.member_id, member.identifier),
    firstName: firstName || name.split(/\s+/)[0] || "",
    lastName: lastName || name.split(/\s+/).slice(1).join(" "),
    email: firstString(member.email),
    phone: firstString(member.phone, member.phoneNumber),
    city: firstString(member.city),
    hireDate: firstString(member.hireDate, member.hire_date, member.createdAt, member.created_at),
    role: firstString(member.role, member.memberRole) ?? "team_member",
    availability: firstString(member.availability),
    workDays: stringList(member.workDays ?? member.work_days ?? member.customWorkDays),
    hourlyRate: nullableNumber(member.hourlyRate, member.hourly_rate),
    upsellBonusPct: nullableNumber(member.upsellBonusPct, member.upsell_bonus_pct),
    mysteryBonusStatus: firstString(member.mysteryBonusStatus, member.mystery_bonus_status),
    isActive: true,
    assignedVehicle: vehicle ? {
      id: nullableNumber(vehicle.id, vehicle.vehicleId),
      name: firstString(vehicle.name, vehicle.vehicleName, vehicle.unitNumber) ?? "Assigned vehicle",
      shift: firstString(vehicle.shift, vehicle.shiftName),
      assignedAt: firstString(vehicle.assignedAt, vehicle.assigned_at),
    } : null,
  };
}

export async function getJobSyncCompanyMemberDetail(token: string, memberId: number) {
  if (!Number.isInteger(memberId) || memberId <= 0) {
    throw new Error("JobSync returned an invalid Team Member identifier.");
  }
  const payload = await requestJson(`${COMPANY_TEAM_MEMBERS_PATH}/${memberId}`, {
    method: "GET",
    headers: createJobSyncBearerHeaders(token),
  });
  const detail = normalizeJobSyncCompanyMemberDetail(payload, memberId);
  if (!detail) throw new Error("JobSync returned an invalid Team Member profile.");
  return detail;
}

export async function updateJobSyncCompanyMember(
  token: string,
  memberId: number,
  input: JobSyncCompanyMemberUpdateInput,
) {
  if (!Number.isInteger(memberId) || memberId <= 0) {
    throw new Error("JobSync returned an invalid Team Member identifier.");
  }
  return requestJson(`${COMPANY_TEAM_MEMBERS_PATH}/${memberId}`, {
    method: "PATCH",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify(createJobSyncCompanyMemberUpdatePayload(input)),
  });
}

export async function loginJobSyncMobile(input: { accountType: JobSyncAccountType; email: string; password: string }) {
  const payload = await requestJson(LOGIN_PATH, {
    method: "POST",
    body: JSON.stringify(createJobSyncMobileLoginPayload(input)),
  });
  const token = extractJobSyncMobileToken(payload);
  if (!token) throw new Error("JobSync did not return a mobile bearer token.");
  return getJobSyncMobileSession(token);
}
