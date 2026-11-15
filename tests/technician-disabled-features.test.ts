import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getNativeEmployeeSession, type JobSyncCompanySession } from "../lib/jobsync-role-map";
import { isMobileFeatureDisabled, isTechnicianFeatureDisabled, isTechnicianRole, TECHNICIAN_DISABLED_ROUTES } from "../lib/technician-features";

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const features = [
  { label: "Alerts", route: "/notifications", screen: "notifications" },
  { label: "Training", route: "/training", screen: "training" },
  { label: "Repairs", route: "/repair-request", screen: "repair-request" },
  { label: "Door Hangers", route: "/door-hangers", screen: "door-hangers" },
  { label: "EOD Check", route: "/eod-checklist", screen: "eod-checklist" },
  { label: "Expenses", route: "/expenses", screen: "expenses" },
];

function menuItems(name: string) {
  const menu = source("components/ui/top-nav-menu.tsx");
  const array = menu.match(new RegExp(`const ${name}: MenuItem\\[\\] = \\[([\\s\\S]*?)\\n\\];`))?.[1];
  expect(array, `${name} should still exist`).toBeDefined();
  return Array.from(array!.matchAll(/label:\s*"([^"]+)"[^\n]*route:\s*"([^"]+)"/g), (match) => ({
    label: match[1], route: match[2],
  }));
}

function companySession(role: string): JobSyncCompanySession {
  return {
    portal: "company",
    user: { id: 42, name: "Test User", email: null, role },
    company: { id: 9, name: "Test Company" },
  };
}

describe("technician-disabled features", () => {
  it("recognizes HSC technicians and their native detailer bridge without restricting other roles", () => {
    expect(isTechnicianRole("technician")).toBe(true);
    expect(isTechnicianRole(getNativeEmployeeSession(companySession("technician"))?.role)).toBe(true);
    for (const role of ["owner", "dispatcher", "admin", "office", "operations_manager", "sales", "door_hanger_rep", "platform_admin", null, undefined]) {
      expect(isTechnicianRole(role)).toBe(false);
      for (const route of TECHNICIAN_DISABLED_ROUTES) {
        expect(isTechnicianFeatureDisabled(role, route)).toBe(false);
      }
    }
    for (const role of ["owner", "dispatcher"]) {
      const nativeRole = getNativeEmployeeSession(companySession(role))?.role;
      expect(isTechnicianFeatureDisabled(nativeRole, "/training")).toBe(false);
    }
  });

  it.each(features)("disables $label for technician/detailer roles including grouped, nested, and query paths", ({ route }) => {
    for (const role of ["technician", "detailer"]) {
      for (const path of [route, `${route}/`, `${route}/detail/42`, `/(tabs)${route}`, `${route}?id=42#details`]) {
        expect(isTechnicianFeatureDisabled(role, path)).toBe(true);
      }
    }
  });

  it("retains every prior exclusion and closes grouped sibling paths", () => {
    const prior = ["/notifications", "/training", "/repair-request", "/door-hangers", "/eod-checklist", "/admin-alerts", "/admin-training", "/admin-repair-equipment", "/admin-repair-history", "/admin-door-hangers", "/ops-door-hangers", "/admin-eod-review"];
    for (const route of prior) {
      expect(TECHNICIAN_DISABLED_ROUTES).toContain(route);
      expect(isTechnicianFeatureDisabled("detailer", `/(tabs)${route}/42`)).toBe(true);
    }
    for (const route of ["/training/van", "/training/quiz/module-42", "/(sales)/notifications", "/(sales)/door-hangers", "/(sales)/training"]) {
      expect(isTechnicianFeatureDisabled("detailer", route)).toBe(true);
      expect(isTechnicianFeatureDisabled("sales", route)).toBe(false);
    }
  });

  it("leaves ordinary technician work routes and similarly named unrelated routes available", () => {
    for (const route of ["/", "/schedule", "/chat", "/timesheet", "/profile", "/history", "/request-off", "/detailer-referral", "/training-notes", "/notifications-settings", "/repair-requested", "/expenses-help"]) {
      expect(isMobileFeatureDisabled("detailer", route)).toBe(false);
    }
  });

  it("filters all six entries from technician navigation and protects retained callbacks", () => {
    const menu = source("components/ui/top-nav-menu.tsx");
    expect(menu).toContain("(item) => isReady && !isMobileFeatureDisabled(currentRole, item.route)");
    expect(menu).toContain("{visibleItems.map((item) => {");
    expect(menu).toContain("const currentPage = visibleItems.find");
    expect(menu).toContain("if (!latest.isReady || isMobileFeatureDisabled(latest.currentRole, route)) return;");
    const visible = menuItems("DETAILER_ITEMS").filter((item) => !isMobileFeatureDisabled("detailer", item.route));
    expect(visible.map((item) => item.label)).toEqual(["Home", "Schedule", "Team Chat", "Timesheet", "Settings"]);
    for (const { label } of features) expect(visible.map((item) => item.label)).not.toContain(label);
  });

  it("keeps management menus stored for restoration and preserves unrelated sales links", () => {
    for (const name of ["ADMIN_ALL_ITEMS", "OPS_MANAGER_ITEMS"]) {
      const items = menuItems(name);
      expect(items.map((item) => item.route)).toContain("/admin-fleet-map");
      expect(items.map((item) => item.route)).toContain("/admin-eod-review");
    }
    expect(menuItems("ADMIN_ALL_ITEMS").map((item) => item.route)).toContain("/admin-invoices");
    for (const role of ["sales", "door_hanger_rep"]) {
      const items = menuItems("SALES_ITEMS");
      expect(items.filter((item) => !isMobileFeatureDisabled(role, item.route))).toEqual(items);
    }
    expect(menuItems("OPS_MANAGER_ITEMS").map((item) => item.route)).toContain("/expenses");
    expect(isMobileFeatureDisabled("operations_manager", "/expenses")).toBe(false);
  });

  it.each(features)("hides the $label tab href for technicians while retaining existing admin exclusions", ({ screen }) => {
    const layout = source("app/(tabs)/_layout.tsx");
    const screenStart = layout.indexOf(`name="${screen}"`);
    expect(screenStart).toBeGreaterThan(-1);
    const tab = layout.slice(screenStart, layout.indexOf("/>", layout.indexOf("href:", screenStart)));
    if (screen === "eod-checklist") {
      expect(tab).toContain('href: (!isAdmin && !isTechnician) ? ("/(tabs)/eod-checklist" as any) : null');
    } else {
      expect(tab).toContain("href: (isAdmin || isTechnician) ? null");
    }
  });

  it("shares the signed session/no-mount policy across tab and Sales layouts", () => {
    for (const path of ["app/(tabs)/_layout.tsx", "app/(sales)/_layout.tsx"]) {
      const layout = source(path);
      expect(layout).toContain("resolveMobileNavigationSession");
      expect(layout).toContain("isMobileFeatureDisabled(currentRole, pathname");
      expect(layout).toContain("router.replace(mobileRoleHome(currentRole))");
      expect(layout.indexOf("return null;")).toBeLessThan(layout.indexOf("<TopNavMenu"));
      expect(layout).not.toMatch(/const \{[^\n]*isAdmin[^\n]*\} = useEmployeeAuth/);
    }
  });

  it("blocks technician cold-start links in the sibling training stack", () => {
    const layout = source("app/training/_layout.tsx");
    expect(layout).toContain("if (loading || isLoading) return null;");
    expect(layout).toContain('isTechnicianFeatureDisabled(currentRole, "/training")');
    expect(layout).toContain('<Redirect href="/(tabs)" />');
    expect(layout.indexOf("<Redirect")).toBeLessThan(layout.indexOf("<Stack screenOptions"));
  });

  it("hides dashboard EOD and embedded Training while preserving operational notifications", () => {
    const dashboard = source("app/(tabs)/index.tsx");
    expect(dashboard).toContain('const showEodChecklist = !isTechnicianFeatureDisabled(employee?.role, "/eod-checklist");');
    expect(dashboard).toContain('const showTraining = !isTechnicianFeatureDisabled(employee?.role, "/training");');
    expect(dashboard).toMatch(/\{showEodChecklist && <View[\s\S]*?router\.push\("\/\(tabs\)\/eod-checklist"\)/);
    expect(dashboard).toMatch(/\{showTraining && <View[^>]*>\s*<TrainingSection colors=\{colors\} \/>\s*<\/View>\}/);
    for (const preserved of ["useEmployeePush();", "useBreakNotifications();", "useAfter5pmCheckIn();", "trpc.notifications.getForEmployee.useQuery", "<NotificationBanner", "<MorningMeetingBanner />", "<CompanyMeetingBanner />"]) {
      expect(dashboard).toContain(preserved);
    }
  });
});
