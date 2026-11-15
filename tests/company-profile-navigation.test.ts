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

const companyRoles = ["owner", "dispatcher", "technician"] as const;
function companySession(role: string): JobSyncCompanySession {
  return {
    portal: "company",
    company: { id: 9, name: "Navigation Test Company" },
    user: { id: 42, name: "Test Team Member", email: null, role, memberId: "TM042" },
  };
}
const native = (role: string) => getNativeEmployeeSession(companySession(role))!;
type Employee = Omit<ReturnType<typeof native>, "role" | "sessionSource"> & {
  role: string;
  sessionSource?: "jobsync" | "local";
};

let employee: Employee | null;
let session: JobSyncCompanySession | null;
let loading: boolean;
let jobSyncLoading: boolean;
let authenticated: boolean;
let pathname: string;
let effects: (() => void)[];
let childMounts: string[];
let screens: { name: string; options?: { href?: string | null } }[];
const replace = vi.fn();
const bridgeLogin = vi.fn().mockResolvedValue(undefined);
const logout = vi.fn();
const mutateAsync = vi.fn();
const registerPush = vi.fn();

function setCompany(role: string, path = "/profile") {
  session = companySession(role);
  employee = native(role);
  pathname = path;
  loading = jobSyncLoading = false;
  authenticated = true;
}

// Execute the actual layout TSX with only native/auth/service boundaries mocked.
// The post-render effect queue lets assertions detect a child mount before redirect.
// This is source-level React rendering, not an Expo/OS deep-link dispatch test.
function loadModule(path: string, mocks: Record<string, unknown>) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", "React", js)((name: string) => {
    if (!(name in mocks)) throw new Error(`Unexpected module in Company profile navigation test: ${name}`);
    return mocks[name];
  }, exports, React);
  return exports;
}

function renderLayout(group: "sales" | "tabs" = "sales") {
  effects = [];
  childMounts = [];
  screens = [];
  let SalesProfile: React.ComponentType;
  const Tabs = ({ children }: { children?: React.ReactNode }) => {
    childMounts.push(`${group} tabs`);
    screens = React.Children.toArray(children)
      .filter(React.isValidElement)
      .map((child) => (child as React.ReactElement<any>).props);
    if (group === "sales" && policy.matchesMobileRoute(pathname, ["/profile"])) {
      childMounts.push("legacy Sales profile");
      return React.createElement(SalesProfile);
    }
    return React.createElement("div", null, `${group}-tabs-mounted`);
  };
  Tabs.Screen = () => null;
  const Menu = () => {
    childMounts.push("menu");
    return React.createElement("div", null, "menu-mounted");
  };
  const query = { useQuery: () => ({ data: [] }) };
  const ScrollView = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
  const mocks: Record<string, unknown> = {
    react: { ...React, useEffect: (callback: () => void) => { effects.push(callback); } },
    "react-native": {
      View: "div", Text: "span", ScrollView, TouchableOpacity: "button", Image: "img",
      Alert: { alert: vi.fn() }, Platform: { OS: "web" }, StyleSheet: { create: (styles: unknown) => styles },
    },
    "expo-router": { Tabs, usePathname: () => pathname, useRouter: () => ({ replace }) },
    "@/hooks/use-colors": { useColors: () => ({ background: "#07111F" }) },
    "@/lib/auth-context": { useEmployeeAuth: () => ({ employee, loading, isAuthenticated: authenticated, login: bridgeLogin, logout }) },
    "@/lib/jobsync-auth-context": { useJobSyncAuth: () => ({ session, isLoading: jobSyncLoading }) },
    "@/lib/technician-features": policy,
    "@/components/ui/top-nav-menu": { TopNavMenu: Menu },
    "@/hooks/use-employee-push": { useEmployeePush: registerPush },
    "@/components/screen-container": { ScreenContainer: "div" },
    "@/components/haptic-tab": { HapticTab: () => null },
    "@/components/ui/icon-symbol": { IconSymbol: () => null },
    "@/lib/geofence-task": { startGeofencing: vi.fn(), stopGeofencing: vi.fn() },
    "@/lib/trpc": { trpc: {
      geofence: { listZones: query }, portalInbox: { unreadCount: query },
      auth: { logout: { useMutation: () => ({ mutateAsync }) } },
    } },
    "expo-haptics": { notificationAsync: vi.fn(), NotificationFeedbackType: { Warning: "warning" } },
  };
  SalesProfile = loadModule("app/(sales)/profile.tsx", mocks).default;
  const Layout = loadModule(`app/(${group})/_layout.tsx`, mocks).default;
  const html = renderToStaticMarkup(React.createElement(Layout));
  if (!html) expect(childMounts).toEqual([]); // Assert before any redirect effect runs.
  effects.forEach((effect) => effect());
  return html;
}

beforeEach(() => {
  setCompany("technician");
  effects = [];
  childMounts = [];
  screens = [];
  vi.clearAllMocks();
});

const profilePaths = [
  "/profile", // Expo usePathname omits the sibling route group.
  "/(sales)/profile",
  "/profile?staleShortcut=1#account",
  "/(sales)/profile/?coldStart=1#account",
  "homeserviceconnection:///profile?coldStart=1",
  "homeserviceconnection:///(sales)/profile?coldStart=1#account",
  "https://hsc.example/profile/?coldStart=1",
  "https://hsc.example/(sales)/profile?coldStart=1#account",
  "/(sales)/profile/account?staleNestedLink=1",
];

describe("actual Sales sibling Company profile boundary", () => {
  for (const role of companyRoles) {
    it.each(profilePaths)(`redirects ${role} from %s without mounting legacy profile/menu/push`, (path) => {
      setCompany(role, path);
      const originalSession = JSON.stringify(session);
      const originalEmployee = JSON.stringify(employee);
      expect(renderLayout()).toBe("");
      expect(childMounts).toEqual([]);
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith("/(tabs)/profile");
      expect(registerPush).not.toHaveBeenCalled();
      expect(bridgeLogin).not.toHaveBeenCalled();
      expect(mutateAsync).not.toHaveBeenCalled();
      expect(logout).not.toHaveBeenCalled();
      expect(JSON.stringify(session)).toBe(originalSession);
      expect(JSON.stringify(employee)).toBe(originalEmployee);
    });
  }

  it.each(companyRoles)("allows clean tabs profile without redirect loop for %s", (role) => {
    for (const path of ["/profile", "/(tabs)/profile", "https://hsc.example/(tabs)/profile?coldStart=1#account"]) {
      setCompany(role, path);
      replace.mockClear();
      expect(renderLayout("tabs")).toContain("tabs-tabs-mounted");
      expect(childMounts).toEqual(["menu", "tabs tabs"]);
      expect(replace).not.toHaveBeenCalled();
    }
  });

  it.each(companyRoles)("preserves unrelated sibling routes but hides the old profile href for %s", (role) => {
    for (const path of ["/chat", "/(sales)/chat", "/profile-notes"]) {
      setCompany(role, path);
      replace.mockClear();
      expect(renderLayout()).toContain("sales-tabs-mounted");
      expect(replace).not.toHaveBeenCalled();
      expect(screens.find((screen) => screen.name === "profile")?.options?.href).toBeNull();
      expect(childMounts).not.toContain("legacy Sales profile");
    }
  });
});

describe("profile alias auth readiness and cold hydration", () => {
  it.each(companyRoles)("waits for matching authenticated Company/member/role readiness for %s", (role) => {
    for (const window of ["employee-loading", "signed-loading", "no-auth", "no-bridge", "wrong-company", "wrong-id", "wrong-role", "wrong-source", "stale-local-sales"]) {
      setCompany(role, "/(sales)/profile?coldStart=1");
      loading = window === "employee-loading";
      jobSyncLoading = window === "signed-loading";
      authenticated = window !== "no-auth";
      if (window === "no-bridge") employee = null;
      if (window === "wrong-company") employee!.companyId = 99;
      if (window === "wrong-id") employee!.employeeId = "jobsync-9-99";
      if (window === "wrong-role") employee!.role = role === "technician" ? "admin" : "detailer";
      if (window === "wrong-source") employee!.sessionSource = "local";
      if (window === "stale-local-sales") employee = { ...native(role), role: "sales", sessionSource: "local" };
      replace.mockClear();
      expect(renderLayout()).toBe("");
      expect(childMounts).toEqual([]);
      expect(replace).not.toHaveBeenCalled();
    }
    setCompany(role, "/profile");
    expect(renderLayout()).toBe("");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/(tabs)/profile");
  });

  it.each(companyRoles)("never mounts the stale profile as signed hydration and native bridge catch up for %s", (role) => {
    setCompany(role, "homeserviceconnection:///(sales)/profile?coldStart=1");
    employee = { ...native(role), role: "sales", sessionSource: "local" };
    jobSyncLoading = true;
    expect(renderLayout()).toBe("");
    expect(bridgeLogin).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    jobSyncLoading = false;
    expect(renderLayout()).toBe("");
    expect(bridgeLogin).toHaveBeenCalledTimes(1);
    expect(bridgeLogin).toHaveBeenCalledWith(native(role), true);
    expect(replace).not.toHaveBeenCalled();
    employee = native(role);
    expect(renderLayout()).toBe("");
    expect(childMounts).toEqual([]);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/(tabs)/profile");
  });

  it.each(["missing-session", "unknown-role", "platform", "missing-company"])("fails closed for %s", (kind) => {
    session = kind === "missing-session" ? null : companySession(kind === "unknown-role" ? "unexpected" : "owner");
    if (kind === "platform") session!.portal = "platform";
    if (kind === "missing-company") delete session!.company;
    expect(renderLayout()).toBe("");
    expect(childMounts).toEqual([]);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(kind === "platform" ? "/platform-dashboard" : "/login");
  });
});

describe("legitimate legacy Sales profile remains separate", () => {
  it.each(["sales", "door_hanger_rep"])("retains the actual local %s profile, identity, and sign-out affordance", (role) => {
    session = null;
    employee = { ...native("technician"), employeeId: "LOCAL-SALES-042", role, sessionSource: "local" };
    for (const path of ["/profile", "/(sales)/profile?coldStart=1#account"]) {
      pathname = path;
      const html = renderLayout();
      expect(html).toContain("Employee ID");
      expect(html).toContain("LOCAL-SALES-042");
      expect(html).toContain("Sign Out");
      expect(childMounts).toContain("legacy Sales profile");
      expect(screens.find((screen) => screen.name === "profile")?.options?.href).toBeUndefined();
      expect(replace).not.toHaveBeenCalled();
      expect(mutateAsync).not.toHaveBeenCalled();
      expect(logout).not.toHaveBeenCalled();
    }
  });

  it.each(["employee-loading", "signed-loading", "no-auth", "stale-jobsync-source"])("does not mount a local Sales profile during %s", (window) => {
    session = null;
    employee = { ...native("technician"), role: "sales", sessionSource: "local" };
    loading = window === "employee-loading";
    jobSyncLoading = window === "signed-loading";
    authenticated = window !== "no-auth";
    if (window === "stale-jobsync-source") employee.sessionSource = "jobsync";
    expect(renderLayout()).toBe("");
    expect(childMounts).toEqual([]);
    expect(replace).not.toHaveBeenCalledWith("/(tabs)/profile");
  });
});
