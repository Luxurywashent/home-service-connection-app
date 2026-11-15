import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNativeEmployeeSession, type JobSyncCompanySession } from "../lib/jobsync-role-map";
import * as policy from "../lib/technician-features";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const companySession = (role: string): JobSyncCompanySession => ({
  portal: "company", user: { id: 42, name: "Test User", email: null, role }, company: { id: 9, name: "Test Company" },
});
const native = (role: string) => getNativeEmployeeSession(companySession(role))!;

type Employee = Omit<ReturnType<typeof native>, "role" | "sessionSource"> & { role: string; sessionSource?: "local" | "jobsync" };
let employee: Employee | null;
let session: JobSyncCompanySession | null;
let loading: boolean;
let jobSyncLoading: boolean;
let authenticated: boolean;
let pathname: string;
let legacyFlags: { isAdmin: boolean; isOpsManager: boolean; isSalesRep: boolean };
let effects: (() => void)[];
let childMounts: string[];
let queryOptions: { query: string; enabled?: boolean }[];
const replace = vi.fn();
const push = vi.fn();
const bridgeLogin = vi.fn().mockResolvedValue(undefined);

function setCompany(role: string, path: string) {
  session = companySession(role);
  employee = native(role);
  pathname = path;
}

function nativeMocks(reactHooks: object = React) {
  const Tabs = () => {
    childMounts.push("Tabs / child-query sentinel");
    return React.createElement("div", null, "tabs-mounted");
  };
  Tabs.Screen = () => null;
  const MenuSentinel = () => {
    childMounts.push("Menu / query sentinel");
    return React.createElement("div", null, "menu-mounted");
  };
  const query = (name: string, data?: unknown) => ({ useQuery: (_input: unknown, options: { enabled?: boolean } = {}) => {
    queryOptions.push({ query: name, enabled: options.enabled });
    return { data };
  } });
  const mocks: Record<string, unknown> = {
    react: reactHooks,
    "react-native": { View: "div", Text: "span", Pressable: "button", Modal: "section", ScrollView: "div", Platform: { OS: "web" }, StyleSheet: { create: (styles: unknown) => styles } },
    "expo-router": { Tabs, usePathname: () => pathname, useRouter: () => ({ replace, push }) },
    "@/hooks/use-colors": { useColors: () => ({ background: "#07111F" }) },
    "@/lib/auth-context": { useEmployeeAuth: () => ({ employee, loading, isAuthenticated: authenticated, login: bridgeLogin, logout: vi.fn(), ...legacyFlags }) },
    "@/lib/jobsync-auth-context": { useJobSyncAuth: () => ({ session, isLoading: jobSyncLoading, logout: vi.fn() }) },
    "@/lib/technician-features": policy,
    "@/components/ui/top-nav-menu": { TopNavMenu: MenuSentinel },
    "@/components/haptic-tab": { HapticTab: () => null },
    "@/components/ui/icon-symbol": { IconSymbol: () => null },
    "@/lib/geofence-task": { startGeofencing: vi.fn(), stopGeofencing: vi.fn() },
    "@/hooks/use-employee-push": { useEmployeePush: vi.fn() },
    "@/lib/trpc": { trpc: {
      geofence: { listZones: query("geofence", []) }, portalInbox: { unreadCount: query("inbox") },
      chat: { getUnreadCount: query("chat", { total: 3 }) }, fleet: { countOpenRepairs: query("repairs", 5) },
      auth: { logout: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    } },
    "expo-haptics": { impactAsync: vi.fn(), ImpactFeedbackStyle: { Light: "light" } },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "@/components/chat-unread-banner": { ChatUnreadBanner: () => null },
    "@/components/job-event-banner": { JobEventBanner: () => null },
    "@/components/header-clock-status": { HeaderClockStatus: () => null },
  };
  return mocks;
}

// Execute the real TSX module using installed TypeScript, injecting native-service mocks only.
// No Expo bundling, browser, signed API, or unavailable renderer dependency is needed.
function loadModule(path: string, mocks: Record<string, unknown>) {
  const js = ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", "React", js)((name: string) => {
    if (!(name in mocks)) throw new Error(`Unexpected module in navigation test: ${name}`);
    return mocks[name];
  }, exports, React);
  return exports;
}

function renderLayout(group = "tabs") {
  effects = [];
  childMounts = [];
  const hooks = { ...React, useEffect: (callback: () => void) => { effects.push(callback); } };
  const Layout = loadModule(`app/(${group})/_layout.tsx`, nativeMocks(hooks)).default;
  const html = renderToStaticMarkup(React.createElement(Layout));
  effects.forEach((effect) => effect());
  return html;
}

beforeEach(() => {
  setCompany("technician", "/schedule");
  loading = false;
  jobSyncLoading = false;
  authenticated = true;
  legacyFlags = { isAdmin: false, isOpsManager: false, isSalesRep: false };
  effects = [];
  childMounts = [];
  queryOptions = [];
  replace.mockClear();
  push.mockClear();
  bridgeLogin.mockClear();
});

describe("standalone mobile feature policy", () => {
  it.each(policy.ADMIN_DISABLED_STANDALONE_ROUTES)("blocks $0 for Company management and technicians, including cold URL variants", (route) => {
    for (const role of ["owner", "admin", "office", "dispatcher", "operations_manager", "technician", "detailer"]) {
      for (const path of [route, `${route}/detail/42`, `/(tabs)${route}?vanId=42#details`, `homeserviceconnection://${route}`, `https://hsc.example${route}/?id=42`]) {
        expect(policy.isMobileFeatureDisabled(role, path)).toBe(true);
      }
      expect(policy.isMobileFeatureDisabled(role, `${route}-notes`)).toBe(false);
    }
    for (const role of ["sales", "door_hanger_rep"]) expect(policy.isMobileFeatureDisabled(role, route)).toBe(false);
  });

  it("explicitly hides the Fleet map, sibling van screens, standalone Invoices and EOD tab hrefs", () => {
    const layout = source("app/(tabs)/_layout.tsx");
    for (const route of policy.ADMIN_DISABLED_STANDALONE_ROUTES) {
      const start = layout.indexOf(`name="${route.slice(1)}"`);
      expect(start).toBeGreaterThan(-1);
      const next = layout.indexOf("<Tabs.Screen", start);
      expect(layout.slice(start, next < 0 ? undefined : next)).toContain("href: null");
    }
  });

  it("keeps technician workflow and Company job billing/authorized management destinations", () => {
    for (const route of ["/", "/schedule", "/chat", "/timesheet", "/profile"]) expect(policy.isMobileFeatureDisabled("detailer", route)).toBe(false);
    for (const role of ["admin", "operations_manager"]) {
      for (const route of ["/admin-dashboard", "/admin-customers", "/admin-customer-profile", "/admin-schedule", "/admin-employees", "/admin-pricebook", "/admin-reporting", "/admin-timeoff", "/admin-timesheet", "/admin-finance", "/admin-unpaid-jobs", "/chat", "/profile", "/schedule/job/42/invoice", "/admin-schedule/job/42/payment"]) {
        expect(policy.isMobileFeatureDisabled(role, route)).toBe(false);
      }
    }
    for (const role of ["admin", "operations_manager", "sales", "door_hanger_rep"]) expect(policy.isMobileFeatureDisabled(role, "/expenses")).toBe(false);
  });

  it("does not touch standalone screen implementations, job invoice/payment source, or backend permission APIs", () => {
    for (const route of policy.ADMIN_DISABLED_STANDALONE_ROUTES) expect(source(`app/(tabs)${route}.tsx`)).not.toBe("");
    expect(source("app/(tabs)/admin-fleet-map.web.tsx")).not.toBe("");
    expect(source("app/(tabs)/expenses.tsx")).toContain("getMyExpenses");
    expect(source("app/(tabs)/admin-schedule.tsx")).toContain("Send Invoice");
    expect(source("app/(tabs)/admin-schedule.tsx")).toContain("Collect Payment");
    expect(source("app/(tabs)/admin-schedule.tsx")).toContain("<AdminCheckoutModal");
    expect(source("app/(tabs)/schedule.tsx")).toContain("Collect Payment");
    expect(source("lib/jobsync-mobile-api.ts")).toContain("Authorization: `Bearer ${token}`");
    for (const path of ["app/(tabs)/schedule.tsx", "app/(tabs)/admin-schedule.tsx", "components/admin-checkout-modal.tsx", "lib/jobsync-mobile-api.ts"]) {
      expect(source(path)).not.toContain("isMobileFeatureDisabled");
      expect(source(path)).not.toContain("ADMIN_DISABLED_STANDALONE_ROUTES");
    }
  });
});

describe("real layout no-child-mount boundaries", () => {
  it.each(["owner", "dispatcher", "technician"])("blocks every standalone destination before mounting for %s", (role) => {
    for (const route of policy.ADMIN_DISABLED_STANDALONE_ROUTES) {
      setCompany(role, `/(tabs)${route}?vanId=42#history`);
      expect(renderLayout()).toBe("");
      expect(childMounts).toEqual([]);
      expect(replace).toHaveBeenLastCalledWith(policy.mobileRoleHome(native(role).role));
    }
  });

  it.each(["tabs", "sales"])("fails closed for cold auth/bridge windows in %s and mounts only after a matching ready session", (group) => {
    setCompany("technician", group === "sales" ? "/(sales)/chat" : "/schedule");
    for (const window of ["employee-loading", "signed-loading", "no-auth", "no-bridge", "wrong-company", "wrong-id", "wrong-role", "wrong-source"]) {
      employee = native("technician");
      loading = window === "employee-loading";
      jobSyncLoading = window === "signed-loading";
      authenticated = window !== "no-auth";
      if (window === "no-bridge") employee = null;
      if (window === "wrong-company") employee!.companyId = 999;
      if (window === "wrong-id") employee!.employeeId = "jobsync-9-999";
      if (window === "wrong-role") employee!.role = "admin";
      if (window === "wrong-source") employee!.sessionSource = "local";
      replace.mockClear();
      expect(renderLayout(group)).toBe("");
      expect(childMounts).toEqual([]);
      expect(replace).not.toHaveBeenCalled();
    }
    employee = native("technician");
    loading = jobSyncLoading = false;
    authenticated = true;
    expect(renderLayout(group)).toContain("tabs-mounted");
    expect(childMounts).toHaveLength(2);
  });

  it("keeps disabled routes blocked when signed hydration finishes and native bridge catches up", () => {
    setCompany("technician", "homeserviceconnection:///expenses?oldShortcut=1");
    employee = native("owner");
    jobSyncLoading = true;
    expect(renderLayout()).toBe("");
    expect(bridgeLogin).not.toHaveBeenCalled();
    jobSyncLoading = false;
    expect(renderLayout()).toBe("");
    expect(bridgeLogin).toHaveBeenLastCalledWith(expect.objectContaining({ role: "detailer" }), true);
    expect(replace).not.toHaveBeenCalled();
    employee = native("technician");
    expect(renderLayout()).toBe("");
    expect(childMounts).toEqual([]);
    expect(replace).toHaveBeenLastCalledWith("/(tabs)");
  });

  it.each(["tabs", "sales"])("rejects invalid Company/platform/local technician sessions in %s", (group) => {
    for (const kind of ["no-signed-session", "unknown-role", "platform", "missing-company"]) {
      employee = native("technician");
      session = kind === "no-signed-session" ? null : companySession(kind === "unknown-role" ? "unexpected" : "technician");
      if (kind === "platform") session!.portal = "platform";
      if (kind === "missing-company") delete session!.company;
      replace.mockClear();
      expect(renderLayout(group)).toBe("");
      expect(childMounts).toEqual([]);
      expect(replace).toHaveBeenLastCalledWith(kind === "platform" ? "/platform-dashboard" : "/login");
    }
  });

  it.each(["notifications", "training", "door-hangers", "dashboard", "log-entry", "dh-history", "dh-map"])("closes technician Sales sibling %s while preserving legitimate local Sales access", (route) => {
    for (const path of [`/(sales)/${route}/detail/42?oldLink=1`, `/${route}?coldNativeLink=1`]) {
      setCompany("technician", path);
      expect(renderLayout("sales")).toBe("");
      expect(childMounts).toEqual([]);
      expect(replace).toHaveBeenLastCalledWith("/(tabs)");
    }
    expect(policy.isMobileFeatureDisabled("detailer", `/(sales)/${route}`)).toBe(true);
    if (["dashboard", "log-entry", "dh-history", "dh-map"].includes(route)) {
      expect(policy.isMobileFeatureDisabled("detailer", `/(tabs)/${route}`)).toBe(false);
    }
    for (const role of ["sales", "door_hanger_rep"]) {
      session = null;
      employee = { ...native("technician"), role, sessionSource: "local" };
      replace.mockClear();
      expect(renderLayout("sales")).toContain("tabs-mounted");
      expect(replace).not.toHaveBeenCalled();
    }
  });

  it("takes navigation flags only from the authenticated Company role and preserves owner fieldwork-independent management", () => {
    legacyFlags = { isAdmin: true, isOpsManager: true, isSalesRep: true };
    setCompany("technician", "/expenses");
    expect(renderLayout()).toBe("");
    expect(replace).toHaveBeenLastCalledWith("/(tabs)");
    legacyFlags = { isAdmin: false, isOpsManager: false, isSalesRep: true };
    for (const fieldwork of [false, true]) {
      setCompany("owner", "/admin-schedule");
      Object.assign(employee!, { availableForFieldJobs: fieldwork });
      expect(renderLayout()).toContain("tabs-mounted");
      expect(employee!.role).toBe("admin");
    }
  });
});

// A tiny persistent hook harness additionally checks callbacks retained across menu rerenders.
function menuHarness() {
  const refs: { current: unknown }[] = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState: (value: unknown) => [value, vi.fn()],
    useRef: (value: unknown) => refs[cursor++] ?? (refs[cursor - 1] = { current: value }),
  };
  const Menu = loadModule("components/ui/top-nav-menu.tsx", nativeMocks(hooks)).TopNavMenu;
  return () => { cursor = 0; return Menu({}); };
}

function elements(node: any): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
function text(node: any): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return node?.props ? text(node.props.children) : "";
}
function button(tree: any, label: string) {
  return elements(tree).find((element) => element.type === "button" && text(element).replace(/\s+/g, " ").trim().endsWith(label));
}

describe("real menu visibility, polling, and retained shortcuts", () => {
  it.each(["owner", "dispatcher", "technician"])("hides unavailable menu entries without repair polling for %s", (role) => {
    setCompany(role, "/chat");
    const tree = menuHarness()();
    const routes = elements(tree).filter((element) => element.type === "button" && element.key).map((element) => element.key);
    for (const route of policy.ADMIN_DISABLED_STANDALONE_ROUTES) expect(routes).not.toContain(route);
    if (role === "technician") {
      for (const route of policy.TECHNICIAN_DISABLED_ROUTES) expect(routes).not.toContain(route);
      expect(routes).toEqual(["/", "/schedule", "/chat", "/timesheet", "/profile"]);
    } else {
      for (const route of ["/admin-schedule", "/admin-customers", "/admin-employees", "/admin-timeoff"]) expect(routes).toContain(route);
    }
    expect(queryOptions).toContainEqual({ query: "repairs", enabled: false });
    expect(queryOptions).toContainEqual({ query: "chat", enabled: true });
    expect(text(tree)).toContain(role === "technician" ? "Timesheet" : "Customers");
  });

  it("ignores inconsistent cached flags in both role directions", () => {
    legacyFlags = { isAdmin: true, isOpsManager: true, isSalesRep: true };
    setCompany("technician", "/chat");
    expect(text(menuHarness()())).not.toContain("Team Members");
    setCompany("owner", "/admin-dashboard");
    legacyFlags = { isAdmin: false, isOpsManager: false, isSalesRep: true };
    expect(text(menuHarness()())).toContain("Team Members");
  });

  it("guards an old Expenses callback after role downgrade and signed hydration changes", () => {
    setCompany("dispatcher", "/chat");
    const renderMenu = menuHarness();
    const oldExpenses = button(renderMenu(), "🧾 Expenses");
    expect(oldExpenses).toBeDefined();
    oldExpenses.props.onPress();
    expect(push).toHaveBeenLastCalledWith("/expenses");
    push.mockClear();
    setCompany("technician", "/chat");
    renderMenu();
    oldExpenses.props.onPress();
    expect(push).not.toHaveBeenCalled();
    const chatButton = button(renderMenu(), "Team Chat");
    jobSyncLoading = true;
    expect(renderMenu()).toBeNull();
    chatButton.props.onPress();
    expect(push).not.toHaveBeenCalled();
    expect(queryOptions.at(-1)).toEqual({ query: "repairs", enabled: false });
    jobSyncLoading = false;
    renderMenu();
    chatButton.props.onPress();
    expect(push).toHaveBeenLastCalledWith("/chat");
  });
});
