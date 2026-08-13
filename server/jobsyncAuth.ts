import { SignJWT, jwtVerify } from "jose";

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

const JOBSYNC_BASE_URL = "https://jobwash-veysiubh.manus.space";
const NATIVE_SESSION_DURATION_SECONDS = 60 * 60 * 12;

function nativeSessionSecret() {
  return new TextEncoder().encode(process.env.JWT_SECRET || "home-service-connection-native-session");
}

function trpcBody(input: Record<string, unknown>) {
  return JSON.stringify({ 0: { json: input } });
}

function getTrpcJson(payload: unknown) {
  const first = Array.isArray(payload) ? payload[0] : null;
  if (!first || typeof first !== "object") return null;
  const record = first as { result?: { data?: { json?: unknown } }; error?: unknown };
  if (record.error) return null;
  return record.result?.data?.json ?? null;
}

function getSessionCookie(response: Response, cookieName: string) {
  const raw = response.headers.get("set-cookie") || "";
  const match = raw.match(new RegExp(`(?:^|,\\s*)${cookieName}=([^;]+)`));
  return match ? `${cookieName}=${match[1]}` : null;
}

async function runMutation(procedure: string, input: Record<string, unknown>, cookieName: string) {
  const response = await fetch(`${JOBSYNC_BASE_URL}/api/trpc/${procedure}?batch=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: trpcBody(input),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !getTrpcJson(payload)) return null;
  const cookie = getSessionCookie(response, cookieName);
  return cookie ? { data: getTrpcJson(payload), cookie } : null;
}

async function runQuery(procedure: string, cookie: string) {
  const input = encodeURIComponent(JSON.stringify({ 0: { json: null } }));
  const response = await fetch(`${JOBSYNC_BASE_URL}/api/trpc/${procedure}?batch=1&input=${input}`, {
    headers: { Accept: "application/json", Cookie: cookie },
  });
  const payload = await response.json().catch(() => null);
  return response.ok ? getTrpcJson(payload) : null;
}

async function mintNativeSession(payload: Omit<JobSyncNativeSession, "token">) {
  const token = await new SignJWT({
    kind: "jobsync_native",
    portal: payload.portal,
    user: payload.user,
    company: payload.company,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(payload.user.id))
    .setIssuedAt()
    .setExpirationTime(`${NATIVE_SESSION_DURATION_SECONDS}s`)
    .sign(nativeSessionSecret());
  return { ...payload, token };
}

export async function loginJobSyncCompany(input: { email: string; password: string }): Promise<JobSyncNativeSession | null> {
  const login = await runMutation(
    "auth.emailLogin",
    { email: input.email.trim().toLowerCase(), password: input.password },
    "hsc_company_session",
  );
  if (!login) return null;

  const workspace = await runQuery("auth.workspace", login.cookie) as {
    user?: { id?: number; memberId?: string; name?: string; email?: string | null; role?: JobSyncCompanyRole };
    company?: { id?: number; name?: string; slug?: string; logoUrl?: string | null; primaryColor?: string | null; accentColor?: string | null };
  } | null;

  if (!workspace?.user?.id || !workspace.company?.id) return null;
  if (!workspace.user.role || !["owner", "dispatcher", "technician"].includes(workspace.user.role)) return null;

  return mintNativeSession({
    portal: "company",
    user: {
      id: workspace.user.id,
      name: workspace.user.name || "Company member",
      email: workspace.user.email ?? null,
      role: workspace.user.role,
      memberId: workspace.user.memberId,
    },
    company: {
      id: workspace.company.id,
      name: workspace.company.name || "Company workspace",
      slug: workspace.company.slug || "",
      logoUrl: workspace.company.logoUrl ?? null,
      primaryColor: workspace.company.primaryColor ?? null,
      accentColor: workspace.company.accentColor ?? null,
    },
  });
}

export async function loginJobSyncPlatform(input: { email: string; password: string }): Promise<JobSyncNativeSession | null> {
  const login = await runMutation(
    "platformOwnerAuth.emailLogin",
    { email: input.email.trim().toLowerCase(), password: input.password },
    "fs_platform_owner",
  );
  if (!login) return null;

  const owner = await runQuery("platformOwnerAuth.me", login.cookie) as {
    ownerId?: number;
    displayName?: string;
    identifier?: string;
    platformRole?: JobSyncPlatformRole;
  } | null;
  if (!owner?.ownerId || !owner.platformRole) return null;

  return mintNativeSession({
    portal: "platform",
    user: {
      id: owner.ownerId,
      name: owner.displayName || "Platform administrator",
      email: input.email.trim().toLowerCase(),
      role: owner.platformRole,
      memberId: owner.identifier,
    },
  });
}

export async function verifyJobSyncNativeSession(token: string): Promise<JobSyncNativeSession | null> {
  try {
    const { payload } = await jwtVerify(token, nativeSessionSecret());
    const session = payload as unknown as Omit<JobSyncNativeSession, "token"> & { kind?: string };
    if (session.kind !== "jobsync_native" || (session.portal !== "company" && session.portal !== "platform") || !session.user?.id) return null;
    return { ...session, token };
  } catch {
    return null;
  }
}

export function getJobSyncNativeDestination(session: Pick<JobSyncNativeSession, "portal" | "user">) {
  if (session.portal === "platform") return "/platform-dashboard";
  return session.user.role === "technician" ? "/(tabs)" : "/(tabs)/admin-dashboard";
}
