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
const TIME_CURRENT_PATH = "/api/mobile/v1/time/current";
const TIME_CLOCK_IN_PATH = "/api/mobile/v1/time/clock-in";
const TIME_CLOCK_OUT_PATH = "/api/mobile/v1/time/clock-out";
const TIME_BREAK_START_PATH = "/api/mobile/v1/time/breaks/start";
const TIME_BREAK_END_PATH = "/api/mobile/v1/time/breaks/end";
const COMPANY_CHAT_GROUPS_PATH = "/api/mobile/v1/company/chat/groups";
const COMPANY_CHAT_COMMUNITY_PATH = "/api/mobile/v1/chat/community";
const COMPANY_CHAT_DIRECT_PATH = "/api/mobile/v1/chat/direct";
const COMPANY_PRICE_BOOK_PATH = "/api/mobile/v1/price-book";
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
  return firstString(
    typeof root?.error === "string" ? root.error : null,
    error?.message,
    error?.detail,
    root?.message,
    root?.detail,
  ) ?? fallback;
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
      throw new Error(errorMessage(payload, response.status === 401 ? "Invalid email or password." : "Home Service Connected authentication is unavailable."));
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Home Service Connected took too long to respond. Check your connection and try again.");
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
  if (!session) throw new Error("Home Service Connected returned an unsupported mobile session profile.");
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
  if (!roster) throw new Error("Home Service Connected returned an invalid Company team roster.");
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
    throw new Error("Home Service Connected returned an invalid Team Member identifier.");
  }
  const payload = await requestJson(`${COMPANY_TEAM_MEMBERS_PATH}/${memberId}`, {
    method: "GET",
    headers: createJobSyncBearerHeaders(token),
  });
  const detail = normalizeJobSyncCompanyMemberDetail(payload, memberId);
  if (!detail) throw new Error("Home Service Connected returned an invalid Team Member profile.");
  return detail;
}

export async function updateJobSyncCompanyMember(
  token: string,
  memberId: number,
  input: JobSyncCompanyMemberUpdateInput,
) {
  if (!Number.isInteger(memberId) || memberId <= 0) {
    throw new Error("Home Service Connected returned an invalid Team Member identifier.");
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
  if (!token) throw new Error("Home Service Connected did not return a mobile session token.");
  return getJobSyncMobileSession(token);
}

export type HomeServiceConnectedTimeState = {
  isClockedIn: boolean;
  clockInAt: string | null;
  activeBreak: { isActive: boolean; startedAt: string | null } | null;
};

export type HomeServiceConnectedPriceBookService = {
  serviceId: string;
  name: string;
  emoji: string;
  description: string;
  features: string[];
  vehiclePrices: Record<string, number>;
  imageUrl: string | null;
  sortOrder: number;
  serviceTypeId: number | null;
};

export type HomeServiceConnectedChatGroup = {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  isActive: boolean;
  memberIds: string[];
};

export type HomeServiceConnectedChatMessage = {
  id: string;
  senderName: string;
  senderId: string | null;
  text: string;
  createdAt: string;
};

export type HomeServiceConnectedChatGroupCreateInput = {
  name: string;
  description?: string;
  icon?: string;
  memberIds?: number[];
};

export type HomeServiceConnectedCommunityCategory = {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type HomeServiceConnectedCommunityPost = {
  id: number;
  categoryId: number | null;
  categoryName: string | null;
  categoryIcon: string | null;
  authorUserId: number;
  authorName: string;
  title: string;
  body: string;
  mediaUrl: string | null;
  isPinned: boolean;
  commentCount: number;
  likeCount: number;
  viewerLiked: boolean;
  createdAt: string;
};

export type HomeServiceConnectedCommunityComment = {
  id: number;
  authorUserId: number;
  authorName: string;
  body: string;
  createdAt: string;
};

export type HomeServiceConnectedDirectMember = {
  id: number;
  name: string;
  role: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
};

function parseJsonRecord(value: unknown) {
  if (typeof value === "string") {
    try { return asRecord(JSON.parse(value)); } catch { return null; }
  }
  return asRecord(value);
}

function priceMap(value: unknown) {
  const record = parseJsonRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, rawValue]) => {
      const amount = nullableNumber(rawValue);
      return amount !== null && amount >= 0 ? [[key, amount]] : [];
    }),
  );
}

function priceBookFeatures(value: unknown) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return stringList(parsed);
    } catch { /* The platform may return a simple comma-separated feature string. */ }
  }
  return stringList(value);
}

function isActivePriceBookService(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return !["false", "0", "no", "inactive", "archived", "disabled"].includes(normalized);
  }
  return isActiveMember(value);
}

function normalizeHomeServiceConnectedPriceBookService(value: unknown): HomeServiceConnectedPriceBookService | null {
  const service = asRecord(value);
  if (!service || !isActivePriceBookService(service.isActive ?? service.is_active ?? service.is_active_pb ?? service.status)) return null;
  const serviceId = firstString(service.serviceId, service.service_id, service.id) ?? nullableNumber(service.id)?.toString();
  const name = firstString(service.name, service.serviceName, service.service_name, service.title);
  if (!serviceId || !name) return null;
  return {
    serviceId,
    name,
    emoji: firstString(service.emoji, service.icon) ?? "🛠️",
    description: firstString(service.description, service.details) ?? "",
    features: priceBookFeatures(service.features),
    vehiclePrices: priceMap(service.vehiclePrices ?? service.vehicle_prices ?? service.prices),
    imageUrl: firstString(service.imageUrl, service.image_url, service.image_url_pb),
    sortOrder: nullableNumber(service.sortOrder, service.sort_order, service.sort_order_pb) ?? 0,
    serviceTypeId: nullableNumber(service.serviceTypeId, service.service_type_id),
  };
}

export function normalizeHomeServiceConnectedPriceBook(payload: unknown) {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const services = Array.isArray(data.services)
    ? data.services
    : Array.isArray(data.items)
      ? data.items
      : Array.isArray(root?.services)
        ? root.services
        : Array.isArray(root?.items)
          ? root.items
          : [];
  return services
    .map(normalizeHomeServiceConnectedPriceBookService)
    .filter((service): service is HomeServiceConnectedPriceBookService => Boolean(service))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
}

export async function getHomeServiceConnectedPriceBook(token: string) {
  const payload = await requestJson(COMPANY_PRICE_BOOK_PATH, {
    method: "GET",
    headers: createJobSyncBearerHeaders(token),
  });
  return normalizeHomeServiceConnectedPriceBook(payload);
}

function normalizeHomeServiceConnectedChatGroup(value: unknown): HomeServiceConnectedChatGroup | null {
  const group = asRecord(value);
  if (!group) return null;
  const id = firstString(group.id, group.groupId, group.group_id, group.channelId, group.channel_id);
  const name = firstString(group.name, group.title, group.label);
  if (!id || !name) return null;
  return {
    id,
    name,
    description: firstString(group.description, group.subtitle),
    emoji: firstString(group.emoji, group.icon, group.iconEmoji) ?? "💬",
    isActive: isActiveMember(group.isActive ?? group.active ?? group.status),
    memberIds: stringList(group.memberIds ?? group.member_ids ?? group.members).map(String),
  };
}

export function normalizeHomeServiceConnectedChatGroups(payload: unknown) {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const groups = Array.isArray(data.groups) ? data.groups : Array.isArray(root?.groups) ? root.groups : Array.isArray(data.items) ? data.items : [];
  return groups.map(normalizeHomeServiceConnectedChatGroup).filter((group): group is HomeServiceConnectedChatGroup => Boolean(group?.isActive));
}

export async function getHomeServiceConnectedChatGroups(token: string) {
  const payload = await requestJson(COMPANY_CHAT_GROUPS_PATH, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  return normalizeHomeServiceConnectedChatGroups(payload);
}

export function createHomeServiceConnectedChatGroupPayload(input: HomeServiceConnectedChatGroupCreateInput) {
  const name = input.name.trim();
  if (!name) throw new Error("A group name is required.");
  const memberIds = Array.from(new Set(
    (input.memberIds ?? []).filter((memberId) => Number.isInteger(memberId) && memberId > 0),
  ));
  return {
    name,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.icon?.trim() ? { icon: input.icon.trim() } : {}),
    ...(memberIds.length ? { memberIds } : {}),
  };
}

export async function createHomeServiceConnectedChatGroup(token: string, input: HomeServiceConnectedChatGroupCreateInput) {
  return requestJson(COMPANY_CHAT_GROUPS_PATH, {
    method: "POST",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify(createHomeServiceConnectedChatGroupPayload(input)),
  });
}

export async function updateHomeServiceConnectedChatGroup(token: string, groupId: string, input: HomeServiceConnectedChatGroupCreateInput) {
  return requestJson(`${COMPANY_CHAT_GROUPS_PATH}/${encodeURIComponent(groupId)}`, {
    method: "PATCH",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify(createHomeServiceConnectedChatGroupPayload(input)),
  });
}

export async function updateHomeServiceConnectedChatGroupMembers(token: string, groupId: string, memberIds: number[]) {
  const activeMemberIds = Array.from(new Set(memberIds.filter((memberId) => Number.isInteger(memberId) && memberId > 0)));
  return requestJson(`${COMPANY_CHAT_GROUPS_PATH}/${encodeURIComponent(groupId)}/members`, {
    method: "PUT",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ memberIds: activeMemberIds }),
  });
}

export async function updateHomeServiceConnectedChatGroupStatus(token: string, groupId: string, isActive: boolean) {
  return requestJson(`${COMPANY_CHAT_GROUPS_PATH}/${encodeURIComponent(groupId)}/status`, {
    method: "PATCH",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ isActive }),
  });
}

export async function getHomeServiceConnectedGroupMessages(token: string, groupId: string) {
  const payload = await requestJson(`${COMPANY_CHAT_GROUPS_PATH}/${encodeURIComponent(groupId)}/messages`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const messages = Array.isArray(data.messages) ? data.messages : Array.isArray(root?.messages) ? root.messages : [];
  return messages.map((value) => {
    const message = asRecord(value) ?? {};
    return {
      id: firstString(message.id, message.messageId, message.message_id) ?? `${firstString(message.createdAt, message.created_at) ?? "message"}-${firstString(message.senderId, message.sender_id) ?? "sender"}`,
      senderName: firstString(message.senderName, message.sender_name, message.fullName, message.authorName) ?? "Team member",
      senderId: firstString(message.senderId, message.sender_id, message.employeeId),
      text: firstString(message.text, message.message, message.body, message.messageText) ?? "",
      createdAt: firstString(message.createdAt, message.created_at, message.sentAt) ?? new Date().toISOString(),
    } satisfies HomeServiceConnectedChatMessage;
  });
}

export async function sendHomeServiceConnectedGroupMessage(token: string, groupId: string, text: string) {
  const message = text.trim();
  if (!message) throw new Error("A message is required.");
  return requestJson(`${COMPANY_CHAT_GROUPS_PATH}/${encodeURIComponent(groupId)}/messages`, {
    method: "POST",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ message }),
  });
}

function strictBoolean(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function normalizeCommunityCategory(value: unknown): HomeServiceConnectedCommunityCategory | null {
  const category = asRecord(value);
  const id = nullableNumber(category?.id, category?.categoryId, category?.category_id);
  const name = firstString(category?.name, category?.label);
  if (!category || !id || !name) return null;
  return {
    id,
    name,
    description: firstString(category.description),
    icon: firstString(category.icon),
    sortOrder: nullableNumber(category.sortOrder, category.sort_order) ?? 0,
    isActive: isActiveMember(category.isActive ?? category.is_active ?? true),
  };
}

export function normalizeHomeServiceConnectedCommunityCategories(payload: unknown) {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const categories = Array.isArray(data.categories) ? data.categories : Array.isArray(root?.categories) ? root.categories : [];
  return categories
    .map(normalizeCommunityCategory)
    .filter((category): category is HomeServiceConnectedCommunityCategory => Boolean(category?.isActive));
}

function normalizeCommunityPost(value: unknown): HomeServiceConnectedCommunityPost | null {
  const post = asRecord(value);
  const id = nullableNumber(post?.id, post?.postId, post?.post_id);
  const authorUserId = nullableNumber(post?.authorUserId, post?.author_user_id);
  const authorName = firstString(post?.authorName, post?.author_name);
  const title = firstString(post?.title);
  const body = firstString(post?.body, post?.message);
  if (!post || !id || !authorUserId || !authorName || !title || !body) return null;
  return {
    id,
    categoryId: nullableNumber(post.categoryId, post.category_id),
    categoryName: firstString(post.categoryName, post.category_name),
    categoryIcon: firstString(post.categoryIcon, post.category_icon),
    authorUserId,
    authorName,
    title,
    body,
    mediaUrl: firstString(post.mediaUrl, post.media_url),
    isPinned: strictBoolean(post.isPinned ?? post.is_pinned),
    commentCount: nullableNumber(post.commentCount, post.comment_count) ?? 0,
    likeCount: nullableNumber(post.likeCount, post.like_count) ?? 0,
    viewerLiked: strictBoolean(post.viewerLiked ?? post.viewer_liked),
    createdAt: firstString(post.createdAt, post.created_at) ?? new Date().toISOString(),
  };
}

export function normalizeHomeServiceConnectedCommunityPosts(payload: unknown) {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const posts = Array.isArray(data.posts) ? data.posts : Array.isArray(root?.posts) ? root.posts : [];
  return posts.map(normalizeCommunityPost).filter((post): post is HomeServiceConnectedCommunityPost => Boolean(post));
}

function normalizeCommunityComment(value: unknown): HomeServiceConnectedCommunityComment | null {
  const comment = asRecord(value);
  const id = nullableNumber(comment?.id, comment?.commentId, comment?.comment_id);
  const authorUserId = nullableNumber(comment?.authorUserId, comment?.author_user_id);
  const authorName = firstString(comment?.authorName, comment?.author_name);
  const body = firstString(comment?.body, comment?.message);
  if (!comment || !id || !authorUserId || !authorName || !body) return null;
  return { id, authorUserId, authorName, body, createdAt: firstString(comment.createdAt, comment.created_at) ?? new Date().toISOString() };
}

export async function getHomeServiceConnectedCommunityCategories(token: string) {
  const payload = await requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/categories`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  return normalizeHomeServiceConnectedCommunityCategories(payload);
}

export async function createHomeServiceConnectedCommunityCategory(token: string, input: { name: string; description?: string; icon?: string; sortOrder?: number }) {
  const name = input.name.trim();
  if (!name) throw new Error("A category name is required.");
  return requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/categories`, {
    method: "POST",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ name, ...(input.description?.trim() ? { description: input.description.trim() } : {}), ...(input.icon?.trim() ? { icon: input.icon.trim() } : {}), ...(Number.isInteger(input.sortOrder) ? { sortOrder: input.sortOrder } : {}) }),
  });
}

export async function getHomeServiceConnectedCommunityPosts(token: string, categoryId?: number) {
  const query = categoryId ? `?categoryId=${encodeURIComponent(String(categoryId))}` : "";
  const payload = await requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/posts${query}`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  return normalizeHomeServiceConnectedCommunityPosts(payload);
}

export async function createHomeServiceConnectedCommunityPost(token: string, input: { categoryId?: number; title: string; body: string }) {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) throw new Error("A post title and message are required.");
  return requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/posts`, {
    method: "POST",
    headers: createJobSyncBearerHeaders(token),
    body: JSON.stringify({ ...(input.categoryId ? { categoryId: input.categoryId } : {}), title, body }),
  });
}

export async function getHomeServiceConnectedCommunityComments(token: string, postId: number) {
  const payload = await requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/posts/${encodeURIComponent(String(postId))}/comments`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const comments = Array.isArray(data.comments) ? data.comments : Array.isArray(root?.comments) ? root.comments : [];
  return comments.map(normalizeCommunityComment).filter((comment): comment is HomeServiceConnectedCommunityComment => Boolean(comment));
}

export async function createHomeServiceConnectedCommunityComment(token: string, postId: number, body: string) {
  const message = body.trim();
  if (!message) throw new Error("A comment is required.");
  return requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/posts/${encodeURIComponent(String(postId))}/comments`, { method: "POST", headers: createJobSyncBearerHeaders(token), body: JSON.stringify({ body: message }) });
}

export function toggleHomeServiceConnectedCommunityLike(token: string, postId: number) {
  return requestJson(`${COMPANY_CHAT_COMMUNITY_PATH}/posts/${encodeURIComponent(String(postId))}/like`, { method: "POST", headers: createJobSyncBearerHeaders(token) });
}

export async function getHomeServiceConnectedDirectMembers(token: string): Promise<HomeServiceConnectedDirectMember[]> {
  const payload = await requestJson(`${COMPANY_CHAT_DIRECT_PATH}/members`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const members = Array.isArray(data.members) ? data.members : Array.isArray(root?.members) ? root.members : [];
  return members.flatMap((value) => {
    const member = asRecord(value);
    const id = nullableNumber(member?.id, member?.userId);
    const name = firstString(member?.name, member?.fullName);
    return id && name ? [{ id, name, role: firstString(member?.role) ?? "Team Member", lastMessage: firstString(member?.lastMessage, member?.last_message), lastMessageAt: firstString(member?.lastMessageAt, member?.last_message_at) }] : [];
  });
}

export async function getHomeServiceConnectedDirectMessages(token: string, memberId: number) {
  const payload = await requestJson(`${COMPANY_CHAT_DIRECT_PATH}/${encodeURIComponent(String(memberId))}/messages`, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const messages = Array.isArray(data.messages) ? data.messages : Array.isArray(root?.messages) ? root.messages : [];
  return messages.map((value) => {
    const message = asRecord(value) ?? {};
    return {
      id: firstString(message.id, message.messageId, message.message_id) ?? `${firstString(message.createdAt, message.created_at) ?? "message"}-${firstString(message.senderId, message.sender_id) ?? "sender"}`,
      senderName: firstString(message.senderName, message.sender_name) ?? "Team Member",
      senderId: firstString(message.senderId, message.sender_id),
      text: firstString(message.message, message.text, message.body) ?? "",
      createdAt: firstString(message.createdAt, message.created_at) ?? new Date().toISOString(),
    } satisfies HomeServiceConnectedChatMessage;
  });
}

export async function sendHomeServiceConnectedDirectMessage(token: string, memberId: number, text: string) {
  const message = text.trim();
  if (!message) throw new Error("A message is required.");
  return requestJson(`${COMPANY_CHAT_DIRECT_PATH}/${encodeURIComponent(String(memberId))}/messages`, { method: "POST", headers: createJobSyncBearerHeaders(token), body: JSON.stringify({ message }) });
}

function booleanState(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "clocked_in" || value === "active";
}

export function normalizeHomeServiceConnectedTimeState(payload: unknown): HomeServiceConnectedTimeState {
  const root = asRecord(payload);
  const data = firstRecord(root?.data, root) ?? {};
  const time = firstRecord(data.time, data.current, data.state, data.status, data) ?? {};
  const entry = firstRecord(time.activeEntry, time.activeShift, time.activeTimesheet, time.timeEntry, data.activeEntry, data.activeShift, data.activeTimesheet, data.timeEntry);
  const activeBreak = firstRecord(time.activeBreak, data.activeBreak, entry?.activeBreak, entry?.break);
  const status = firstString(time.status, time.clockStatus, data.status, data.clockStatus, entry?.status);
  const clockInAt = firstString(time.clockInAt, time.clockInTime, data.clockInAt, data.clockInTime, entry?.clockInAt, entry?.clockInTime, entry?.startedAt);
  const isClockedIn = booleanState(time.isClockedIn) || booleanState(data.isClockedIn) || booleanState(status) || Boolean(entry) || Boolean(clockInAt);
  const breakActive = Boolean(activeBreak) && !firstString(activeBreak?.endedAt, activeBreak?.breakEndTime, activeBreak?.endTime);
  return {
    isClockedIn,
    clockInAt,
    activeBreak: activeBreak ? { isActive: breakActive, startedAt: firstString(activeBreak.startedAt, activeBreak.breakStartTime, activeBreak.startTime) } : null,
  };
}

export async function getHomeServiceConnectedTimeState(token: string) {
  const payload = await requestJson(TIME_CURRENT_PATH, { method: "GET", headers: createJobSyncBearerHeaders(token) });
  return normalizeHomeServiceConnectedTimeState(payload);
}

async function performHomeServiceConnectedTimeAction(token: string, path: string) {
  return requestJson(path, { method: "POST", headers: createJobSyncBearerHeaders(token) });
}

export function clockInHomeServiceConnected(token: string) {
  return performHomeServiceConnectedTimeAction(token, TIME_CLOCK_IN_PATH);
}

export function clockOutHomeServiceConnected(token: string) {
  return performHomeServiceConnectedTimeAction(token, TIME_CLOCK_OUT_PATH);
}

export function startHomeServiceConnectedBreak(token: string) {
  return performHomeServiceConnectedTimeAction(token, TIME_BREAK_START_PATH);
}

export function endHomeServiceConnectedBreak(token: string) {
  return performHomeServiceConnectedTimeAction(token, TIME_BREAK_END_PATH);
}
