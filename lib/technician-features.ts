import { getNativeEmployeeSession, type JobSyncCompanySession } from "./jobsync-role-map";

/** HSC technicians bridge to the legacy native `detailer` role. */
export function isTechnicianRole(role: string | null | undefined): boolean {
  return role === "technician" || role === "detailer";
}

export function isMobileManagementRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "office" ||
    role === "dispatcher" || role === "operations_manager";
}

export function isMobileOpsRole(role: string | null | undefined): boolean {
  return role === "dispatcher" || role === "operations_manager";
}

export function isMobileSalesRole(role: string | null | undefined): boolean {
  return role === "sales" || role === "door_hanger_rep";
}

/** Include alternate tab entry points so hiding a link cannot bypass the policy. */
export const TECHNICIAN_DISABLED_ROUTES = [
  "/notifications", // Alerts
  "/training",
  "/repair-request",
  "/door-hangers",
  "/eod-checklist",
  "/admin-alerts",
  "/admin-training",
  "/admin-repair-equipment",
  "/admin-repair-history",
  "/admin-door-hangers",
  "/ops-door-hangers",
  "/admin-eod-review",
  "/expenses",
] as const;

/** Sales aliases/embedded Door Hangers, scoped to that sibling layout only. */
export const TECHNICIAN_DISABLED_SALES_ROUTES = [
  "/dashboard", // Includes Door Hangers queries and an inline photo logger.
  "/log-entry",
  "/dh-history",
  "/dh-map",
] as const;

/** Standalone mobile surfaces only: Job invoice/payment actions remain available. */
export const ADMIN_DISABLED_STANDALONE_ROUTES = [
  "/admin-fleet-map",
  "/admin-fleet-van-detail",
  "/admin-van-assignments",
  "/admin-invoices",
  "/admin-eod-review",
] as const;

export function normalizeMobilePath(path: string): string {
  // Router pathnames omit groups; stale menu hrefs and cold URLs may include them.
  let pathname = path.split(/[?#]/, 1)[0];
  if (/^https?:\/\//i.test(pathname)) {
    pathname = new URL(pathname).pathname;
  } else {
    pathname = pathname.replace(/^[a-z][a-z\d+.-]*:\/\//i, "");
  }
  return `/${pathname.split("/")
    .filter((segment) => segment && !/^\([^/]+\)$/.test(segment))
    .join("/")}`;
}

export function matchesMobileRoute(path: string, routes: readonly string[]): boolean {
  const pathname = normalizeMobilePath(path);
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function isTechnicianFeatureDisabled(
  role: string | null | undefined,
  path: string,
): boolean {
  return isTechnicianRole(role) && matchesMobileRoute(path, TECHNICIAN_DISABLED_ROUTES);
}

export function isMobileFeatureDisabled(
  role: string | null | undefined,
  path: string,
  routeGroup?: "sales",
): boolean {
  // usePathname omits groups; the Sales layout supplies its known group explicitly.
  const isSalesPath = routeGroup === "sales" || path.split(/[?#]/, 1)[0].split("/").includes("(sales)");
  return isTechnicianFeatureDisabled(role, path) ||
    (isTechnicianRole(role) && isSalesPath && matchesMobileRoute(path, TECHNICIAN_DISABLED_SALES_ROUTES)) ||
    ((isMobileManagementRole(role) || isTechnicianRole(role)) &&
      matchesMobileRoute(path, ADMIN_DISABLED_STANDALONE_ROUTES));
}

export function mobileRoleHome(role: string | null | undefined):
  "/(tabs)" | "/(tabs)/admin-dashboard" | "/(tabs)/ops-dashboard" {
  if (isMobileOpsRole(role)) return "/(tabs)/ops-dashboard";
  return isMobileManagementRole(role) ? "/(tabs)/admin-dashboard" : "/(tabs)";
}

interface NavigationEmployee {
  employeeId: string;
  role: string;
  companyId?: number | null;
  sessionSource?: "local" | "jobsync";
}

/** This consumes the existing verified auth context; it never authenticates or upgrades a role. */
export function resolveMobileNavigationSession({
  employee, session, loading, jobSyncLoading, isAuthenticated, allowLegacySales = false,
}: {
  employee: NavigationEmployee | null;
  session: JobSyncCompanySession | null;
  loading: boolean;
  jobSyncLoading: boolean;
  isAuthenticated: boolean;
  allowLegacySales?: boolean;
}) {
  const nativeEmployee = session ? getNativeEmployeeSession(session) : null;
  const hasMatchingCompanySession = Boolean(
    nativeEmployee && employee?.sessionSource === "jobsync" &&
    employee.employeeId === nativeEmployee.employeeId &&
    employee.companyId === nativeEmployee.companyId &&
    employee.role === nativeEmployee.role,
  );
  // Do not let a persisted role/flag override the signed Company's role, even during bridging.
  const role = nativeEmployee?.role ?? (session ? undefined : employee?.role);
  // The separate, existing local Sales experience has no JobSync role mapping.
  // Only retain that fallback for genuine local sales sessions, never stale Company bridges.
  const hasLegacySalesSession = Boolean(
    allowLegacySales && !session && employee && employee.sessionSource !== "jobsync" &&
    isMobileSalesRole(employee.role),
  );
  const isReady = !loading && !jobSyncLoading && isAuthenticated &&
    (hasMatchingCompanySession || hasLegacySalesSession);
  return { nativeEmployee, hasMatchingCompanySession, hasLegacySalesSession, role, isReady };
}

/** Use the same predicate as the rendered repair badge; no unavailable-destination polling. */
export function isRepairBadgeDestination(role: string | null | undefined, path: string): boolean {
  if (isMobileFeatureDisabled(role, path)) return false;
  const pathname = normalizeMobilePath(path);
  return (pathname === "/admin-fleet-map" && isMobileManagementRole(role)) ||
    (pathname === "/repair-request" && !isMobileManagementRole(role));
}
