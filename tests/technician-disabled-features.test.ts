import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getNativeEmployeeSession, type JobSyncCompanySession } from "../lib/jobsync-role-map";
import { isTechnicianFeatureDisabled, isTechnicianRole, TECHNICIAN_DISABLED_ROUTES } from "../lib/technician-features";

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const features = [
  { label: "Alerts", route: "/notifications", screen: "notifications" },
  { label: "Training", route: "/training", screen: "training" },
  { label: "Repairs", route: "/repair-request", screen: "repair-request" },
  { label: "Door Hangers", route: "/door-hangers", screen: "door-hangers" },
  { label: "EOD Check", route: "/eod-checklist", screen: "eod-checklist" },
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

  it("covers alternate admin/ops entry points and training modules/quiz deep links", () => {
    for (const route of TECHNICIAN_DISABLED_ROUTES) {
      expect(isTechnicianFeatureDisabled("detailer", route)).toBe(true);
      expect(isTechnicianFeatureDisabled("detailer", `/(tabs)${route}/42`)).toBe(true);
    }
    expect(isTechnicianFeatureDisabled("detailer", "/training/van")).toBe(true);
    expect(isTechnicianFeatureDisabled("detailer", "/training/quiz/module-42")).toBe(true);
    // Sales uses a separate group, but a technician cannot bypass the policy using that group's href.
    expect(isTechnicianFeatureDisabled("detailer", "/(sales)/notifications")).toBe(true);
    expect(isTechnicianFeatureDisabled("sales", "/(sales)/notifications")).toBe(false);
  });

  it("leaves ordinary technician work routes and similarly named unrelated routes available", () => {
    for (const route of ["/", "/schedule", "/chat", "/expenses", "/timesheet", "/profile", "/history", "/request-off", "/detailer-referral", "/training-notes", "/notifications-settings", "/repair-requested"]) {
      expect(isTechnicianFeatureDisabled("detailer", route)).toBe(false);
    }
  });

  it("filters all five entries from the technician top nav and keeps ordinary links", () => {
    const menu = source("components/ui/top-nav-menu.tsx");
    expect(menu).toMatch(/const visibleItems = allItems\.filter\([\s\S]*?isTechnicianFeatureDisabled\(currentEmployee\?\.role, item\.route\)/);
    expect(menu).toContain("{visibleItems.map((item) => {");
    expect(menu).toContain("const currentPage = visibleItems.find");
    expect(menu).toContain("if (isTechnicianFeatureDisabled(currentEmployee?.role, route)) return;");
    const visible = menuItems("DETAILER_ITEMS").filter((item) => !isTechnicianFeatureDisabled("detailer", item.route));
    expect(visible.map((item) => item.label)).toEqual(["Home", "Schedule", "Team Chat", "Expenses", "Timesheet", "Settings"]);
    for (const { label } of features) expect(visible.map((item) => item.label)).not.toContain(label);
  });

  it("preserves the existing admin/dispatcher menus and separate sales navigation", () => {
    for (const [name, role] of [["ADMIN_ALL_ITEMS", "admin"], ["OPS_MANAGER_ITEMS", "operations_manager"], ["SALES_ITEMS", "sales"], ["SALES_ITEMS", "door_hanger_rep"]]) {
      const items = menuItems(name);
      expect(items.filter((item) => !isTechnicianFeatureDisabled(role, item.route))).toEqual(items);
    }
    const sales = menuItems("SALES_ITEMS");
    expect(sales).toContainEqual({ label: "Training", route: "/(sales)/training" });
    expect(sales).toContainEqual({ label: "Alerts", route: "/(sales)/notifications" });
    expect(menuItems("OPS_MANAGER_ITEMS").map((item) => item.route)).toContain("/admin-door-hangers");
  });

  it.each(features)("hides the $label tab href for technicians while retaining existing admin exclusions", ({ screen }) => {
    const layout = source("app/(tabs)/_layout.tsx");
    const screenStart = layout.indexOf(`name="${screen}"`);
    expect(screenStart).toBeGreaterThan(-1);
    const tab = layout.slice(screenStart, layout.indexOf("</Tabs.Screen>", screenStart) === -1
      ? layout.indexOf("/>", layout.indexOf("href:", screenStart))
      : layout.indexOf("</Tabs.Screen>", screenStart));
    if (screen === "eod-checklist") {
      expect(tab).toContain('href: (!isAdmin && !isTechnician) ? ("/(tabs)/eod-checklist" as any) : null');
    } else {
      expect(tab).toContain("href: (isAdmin || isTechnician) ? null");
    }
  });

  it("redirects disabled tab routes to Home and prevents child screens mounting before redirect", () => {
    const layout = source("app/(tabs)/_layout.tsx");
    expect(layout).toContain("const currentRole = nativeJobSyncEmployee?.role ?? employee?.role;");
    expect(layout).toContain("const isDisabledTechnicianRoute = isTechnicianFeatureDisabled(currentRole, pathname);");
    expect(layout).toContain('if (isDisabledTechnicianRoute) router.replace("/(tabs)");');
    const block = layout.indexOf("if (isDisabledTechnicianRoute) return null;");
    expect(block).toBeGreaterThan(-1);
    expect(block).toBeLessThan(layout.indexOf("<Tabs\n"));
    expect(layout).toContain("loading || jobSyncLoading || !isAuthenticated || !hasMatchingCompanySession");
    expect(layout).toContain('if (isHiddenAdminRoute) router.replace("/(tabs)/admin-dashboard");');
    expect(layout).toContain("loading || jobSyncLoading || !isAdmin || isOpsManager");
  });

  it("blocks technician cold-start links in the sibling training stack", () => {
    const layout = source("app/training/_layout.tsx");
    expect(layout).toContain("if (loading || isLoading) return null;");
    expect(layout).toContain('isTechnicianFeatureDisabled(currentRole, "/training")');
    expect(layout).toContain('<Redirect href="/(tabs)" />');
    expect(layout.indexOf("<Redirect")).toBeLessThan(layout.indexOf("<Stack screenOptions"));
  });

  it("hides the dashboard EOD link and embedded Training without removing operational notifications", () => {
    const dashboard = source("app/(tabs)/index.tsx");
    expect(dashboard).toContain('const showEodChecklist = !isTechnicianFeatureDisabled(employee?.role, "/eod-checklist");');
    expect(dashboard).toContain('const showTraining = !isTechnicianFeatureDisabled(employee?.role, "/training");');
    expect(dashboard).toMatch(/\{showEodChecklist && <View[\s\S]*?router\.push\("\/\(tabs\)\/eod-checklist"\)/);
    expect(dashboard).toMatch(/\{showTraining && <View[^>]*>\s*<TrainingSection colors=\{colors\} \/>\s*<\/View>\}/);
    expect(dashboard).toContain("useEmployeePush();");
    expect(dashboard).toContain("useBreakNotifications();");
    expect(dashboard).toContain("useAfter5pmCheckIn();");
    expect(dashboard).toContain("trpc.notifications.getForEmployee.useQuery");
    expect(dashboard).toContain("<NotificationBanner");
    expect(dashboard).toContain("<MorningMeetingBanner />");
    expect(dashboard).toContain("<CompanyMeetingBanner />");
  });
});
