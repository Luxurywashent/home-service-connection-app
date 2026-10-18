export const COMPANY_LOCATION_TASK = "HSC_COMPANY_LOCATION_TASK";
export const JOBSYNC_MOBILE_BEARER_STORAGE_KEY = "hsc_jobsync_mobile_bearer_v1";
export const COMPANY_LOCATION_BACKGROUND_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

const DISCLOSURE_STORAGE_KEY_PREFIX = "hsc_company_location_disclosure_v2";
const BACKGROUND_AUTHORIZATION_STORAGE_KEY = "hsc_company_location_background_authorization_v2";

export type CompanyLocationSessionScope = {
  token: string;
  userId: number;
  companyId: number;
  role: string;
};

type CompanyLocationDisclosure = {
  version: 2;
  userId: number;
  companyId: number;
  acceptedAt: number;
};

export type CompanyLocationBackgroundAuthorization = {
  version: 2;
  token: string;
  userId: number;
  companyId: number;
  role: "technician";
  clockedIn: true;
  disclosureAcceptedAt: number;
  authorizedAt: number;
  expiresAt: number;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseStoredValue(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Rejects partial or platform sessions before they can authorize a location task. */
export function createCompanyLocationSessionScope(input: {
  token: unknown;
  userId: unknown;
  companyId: unknown;
  role: unknown;
}): CompanyLocationSessionScope | null {
  if (!isNonEmptyString(input.token) || !isPositiveInteger(input.userId) || !isPositiveInteger(input.companyId) || !isNonEmptyString(input.role)) {
    return null;
  }
  return {
    token: input.token,
    userId: input.userId,
    companyId: input.companyId,
    role: input.role,
  };
}

export function sameCompanyLocationSessionScope(
  left: Pick<CompanyLocationSessionScope, "token" | "userId" | "companyId" | "role">,
  right: Pick<CompanyLocationSessionScope, "token" | "userId" | "companyId" | "role">,
) {
  return left.token === right.token
    && left.userId === right.userId
    && left.companyId === right.companyId
    && left.role === right.role;
}

export function companyLocationDisclosureStorageKey(scope: Pick<CompanyLocationSessionScope, "userId" | "companyId">) {
  return `${DISCLOSURE_STORAGE_KEY_PREFIX}.${scope.companyId}.${scope.userId}`;
}

export function createCompanyLocationDisclosure(
  scope: Pick<CompanyLocationSessionScope, "userId" | "companyId">,
  acceptedAt = Date.now(),
): CompanyLocationDisclosure {
  return {
    version: 2,
    userId: scope.userId,
    companyId: scope.companyId,
    acceptedAt,
  };
}

export function isCompanyLocationDisclosureForScope(
  value: unknown,
  scope: Pick<CompanyLocationSessionScope, "userId" | "companyId">,
): value is CompanyLocationDisclosure {
  const record = asRecord(value);
  return record?.version === 2
    && record.userId === scope.userId
    && record.companyId === scope.companyId
    && isPositiveInteger(record.acceptedAt);
}

export function createCompanyLocationBackgroundAuthorization(
  scope: CompanyLocationSessionScope,
  disclosure: CompanyLocationDisclosure,
  now = Date.now(),
): CompanyLocationBackgroundAuthorization | null {
  if (scope.role !== "technician" || !isCompanyLocationDisclosureForScope(disclosure, scope) || !isPositiveInteger(now)) return null;
  return {
    version: 2,
    token: scope.token,
    userId: scope.userId,
    companyId: scope.companyId,
    role: "technician",
    clockedIn: true,
    disclosureAcceptedAt: disclosure.acceptedAt,
    authorizedAt: now,
    expiresAt: now + COMPANY_LOCATION_BACKGROUND_AUTHORIZATION_TTL_MS,
  };
}

/**
 * The native task must satisfy every bound value. In particular, a bearer from a
 * subsequent account cannot reuse an authorization written for a prior account.
 */
export function isCompanyLocationBackgroundAuthorizationValid(
  value: unknown,
  scope: CompanyLocationSessionScope,
  disclosure: unknown,
  now = Date.now(),
): value is CompanyLocationBackgroundAuthorization {
  const record = asRecord(value);
  if (!record || record.version !== 2 || record.role !== "technician" || record.clockedIn !== true) return false;
  if (!isPositiveInteger(record.authorizedAt) || !isPositiveInteger(record.expiresAt) || record.expiresAt <= now) return false;
  if (!sameCompanyLocationSessionScope(record as CompanyLocationSessionScope, scope)) return false;
  if (!isCompanyLocationDisclosureForScope(disclosure, scope)) return false;
  return record.disclosureAcceptedAt === disclosure.acceptedAt;
}

async function storage() {
  const { Platform } = await import("react-native");
  if (Platform.OS === "web") {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    return {
      get: (key: string) => AsyncStorage.getItem(key),
      set: (key: string, value: string) => AsyncStorage.setItem(key, value),
      remove: (key: string) => AsyncStorage.removeItem(key),
    };
  }
  const SecureStore = await import("expo-secure-store");
  return {
    get: (key: string) => SecureStore.getItemAsync(key),
    set: (key: string, value: string) => SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
    remove: (key: string) => SecureStore.deleteItemAsync(key),
  };
}

async function readJson(key: string) {
  const store = await storage();
  return parseStoredValue(await store.get(key));
}

export async function hasScopedCompanyLocationDisclosure(scope: Pick<CompanyLocationSessionScope, "userId" | "companyId">) {
  try {
    return isCompanyLocationDisclosureForScope(await readJson(companyLocationDisclosureStorageKey(scope)), scope);
  } catch {
    return false;
  }
}

export async function acceptScopedCompanyLocationDisclosure(
  scope: Pick<CompanyLocationSessionScope, "userId" | "companyId">,
  now = Date.now(),
) {
  const disclosure = createCompanyLocationDisclosure(scope, now);
  try {
    const store = await storage();
    await store.set(companyLocationDisclosureStorageKey(scope), JSON.stringify(disclosure));
    return disclosure;
  } catch {
    return null;
  }
}

export async function readCompanyLocationBackgroundAuthorization() {
  try {
    return await readJson(BACKGROUND_AUTHORIZATION_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Returns an authorization only when its matching scoped disclosure is still present and current. */
export async function readValidCompanyLocationBackgroundAuthorization(
  now = Date.now(),
): Promise<CompanyLocationBackgroundAuthorization | null> {
  const authorization = await readCompanyLocationBackgroundAuthorization();
  const scope = createCompanyLocationSessionScope({
    token: authorization?.token,
    userId: authorization?.userId,
    companyId: authorization?.companyId,
    role: authorization?.role,
  });
  if (!scope) return null;
  const disclosure = await readJson(companyLocationDisclosureStorageKey(scope));
  if (!isCompanyLocationBackgroundAuthorizationValid(authorization, scope, disclosure, now)) return null;
  return authorization;
}

export async function authorizeCompanyLocationBackgroundTracking(scope: CompanyLocationSessionScope, now = Date.now()) {
  try {
    const disclosure = await readJson(companyLocationDisclosureStorageKey(scope));
    if (!isCompanyLocationDisclosureForScope(disclosure, scope)) return false;
    const authorization = createCompanyLocationBackgroundAuthorization(scope, disclosure, now);
    if (!authorization) return false;
    const store = await storage();
    await store.set(BACKGROUND_AUTHORIZATION_STORAGE_KEY, JSON.stringify(authorization));
    return true;
  } catch {
    return false;
  }
}

export async function readStoredJobSyncMobileBearer() {
  try {
    const store = await storage();
    return await store.get(JOBSYNC_MOBILE_BEARER_STORAGE_KEY);
  } catch {
    return null;
  }
}

async function hasDifferentCurrentAuthorization(scope?: CompanyLocationSessionScope) {
  if (!scope) return false;
  const current = await readCompanyLocationBackgroundAuthorization();
  return Boolean(current && !sameCompanyLocationSessionScope(current as CompanyLocationSessionScope, scope));
}

/** Stops the one native task without touching the user's per-company disclosure record. */
export async function stopCompanyLocationBackgroundUpdates(scope?: CompanyLocationSessionScope) {
  try {
    // Do not let an old component cleanup stop a freshly-authorized new account.
    if (await hasDifferentCurrentAuthorization(scope)) return;
    const { Platform } = await import("react-native");
    if (Platform.OS === "web") return;
    const Location = await import("expo-location");
    const started = await Location.hasStartedLocationUpdatesAsync(COMPANY_LOCATION_TASK).catch(() => false);
    if (started) await Location.stopLocationUpdatesAsync(COMPANY_LOCATION_TASK).catch(() => undefined);
  } catch {
    // A failed stop must not prevent storage invalidation or session cleanup.
  }
}

/**
 * Revokes background collection on logout, clock-out, or session replacement.
 * A scoped call is safe during React cleanup: it cannot remove a new account's
 * authorization written after an account switch.
 */
export async function invalidateCompanyLocationBackgroundAuthorization(scope?: CompanyLocationSessionScope) {
  try {
    const current = await readCompanyLocationBackgroundAuthorization();
    if (scope && current && !sameCompanyLocationSessionScope(current as CompanyLocationSessionScope, scope)) return;
    const store = await storage();
    await store.remove(BACKGROUND_AUTHORIZATION_STORAGE_KEY);
  } catch {
    // Continue to stop native updates even if secure-storage cleanup is unavailable.
  }
  await stopCompanyLocationBackgroundUpdates(scope);
}
