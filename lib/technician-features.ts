/** HSC technicians bridge to the legacy native `detailer` role. */
export function isTechnicianRole(role: string | null | undefined): boolean {
  return role === "technician" || role === "detailer";
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
] as const;

export function isTechnicianFeatureDisabled(
  role: string | null | undefined,
  path: string,
): boolean {
  if (!isTechnicianRole(role)) return false;

  // Expo's pathname omits route groups, but menu/tab hrefs can include them.
  const pathname = path.split(/[?#]/, 1)[0]
    .split("/")
    .filter((segment) => segment && !/^\([^/]+\)$/.test(segment))
    .join("/");
  const normalizedPath = `/${pathname}`;

  return TECHNICIAN_DISABLED_ROUTES.some(
    (route) => normalizedPath === route || normalizedPath.startsWith(`${route}/`),
  );
}
