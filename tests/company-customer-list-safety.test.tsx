import React, { act, useLayoutEffect } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import type { JobSyncCompanyCustomer, JobSyncNativeSession } from "../lib/jobsync-mobile-api";
import type { EmployeeSession } from "../lib/auth-context";
import AdminCustomersScreen from "../app/(tabs)/admin-customers";

const mocks = vi.hoisted(() => ({
  focused: true,
  auth: { session: null as JobSyncNativeSession | null, isLoading: false },
  employee: { employee: null as EmployeeSession | null, loading: false },
  list: vi.fn(),
  legacy: vi.fn(),
  legacyRefetch: vi.fn(),
  push: vi.fn(),
  fetch: vi.fn(),
  appState: "active",
  listeners: new Set<(state: string) => void>(),
  lists: [] as any[],
}));
vi.mock("@/lib/jobsync-auth-context", () => ({ useJobSyncAuth: () => mocks.auth }));
vi.mock("@/lib/auth-context", () => ({ useEmployeeAuth: () => mocks.employee }));
vi.mock("@/lib/jobsync-mobile-api", async (original) => ({
  ...await original<typeof import("../lib/jobsync-mobile-api")>(),
  getJobSyncCompanyCustomers: mocks.list,
}));
vi.mock("@/lib/trpc", () => ({ trpc: { customers: { listAll: { useQuery: mocks.legacy } } } }));
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused, useRouter: () => ({ push: mocks.push }) }));
vi.mock("expo-haptics", () => ({ impactAsync: vi.fn(), ImpactFeedbackStyle: { Light: "light" } }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({
  primary: "blue", foreground: "black", muted: "gray", error: "red", background: "white", border: "gray", surface: "white", success: "green",
}) }));
vi.mock("@/components/screen-container", async () => {
  const R = await import("react");
  return { ScreenContainer: ({ children }: { children: React.ReactNode }) => R.createElement("screen", null, children) };
});
vi.mock("react-native", async () => {
  const R = await import("react");
  const native = (name: string) => function Native(props: Record<string, any>) {
    return R.createElement(name, { ref: (node: PhotoTestNode | null) => {
      if (node) (node as NativeNode).nativeProps = props;
    } }, props.children);
  };
  return {
    Text: native("native-text"), View: native("native-view"), TextInput: native("native-input"),
    TouchableOpacity: native("native-touch"), RefreshControl: native("native-refresh"),
    FlatList: (props: any) => {
      mocks.lists.push(props);
      return R.createElement("native-list", null, props.refreshControl,
        props.data.length ? props.data.map((item: any) => R.createElement(R.Fragment,
          { key: props.keyExtractor(item) }, props.renderItem({ item }))) : props.ListEmptyComponent);
    },
    StyleSheet: { create: (styles: unknown) => styles }, Platform: { OS: "web" },
    AppState: {
      get currentState() { return mocks.appState; },
      addEventListener: (_event: string, callback: (state: string) => void) => {
        mocks.listeners.add(callback);
        return { remove: () => mocks.listeners.delete(callback) };
      },
    },
  };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
const session = (): JobSyncNativeSession => ({
  token: "fixture-only-customer-token", portal: "company",
  user: { id: 42, role: "owner", name: "Fixture", email: null },
  company: { id: 9, name: "A", slug: "a", logoUrl: null, primaryColor: null, accentColor: null },
});
const localEmployee = (): EmployeeSession => ({
  employeeId: "legacy-fixture", fullName: "Legacy operator", role: "admin", sessionSource: "local",
  email: null, city: null, hireDate: null, profilePhotoUrl: null, phoneNumber: null, hourlyRate: null, upsellBonusPct: null,
});
const customer = (name = "A customer", id = 12, companyId = 9): JobSyncCompanyCustomer => ({
  id, name, firstName: name, lastName: "", phone: "555-fixture", email: "fixture@example.invalid",
  addressLine1: "Fixture address", city: "Fixture city", companyId,
});
const legacyRecord = { customerId: "legacy-12", fullName: "Legacy customer", phone: "fixture-legacy-phone", email: null,
  address: null, city: null, lifetimeValue: 150, jobCount: 2, lastServiceDate: null, firstServiceDate: null, source: "manual", isVip: true };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let unmounted = false;
let commitText: string[];
function Frame() {
  useLayoutEffect(() => { commitText.push(container.textContent); });
  return <AdminCustomersScreen />;
}
async function render() { await act(async () => { root.render(<Frame />); }); }
async function resolve(wait: ReturnType<typeof deferred<JobSyncCompanyCustomer[]>>, rows: JobSyncCompanyCustomer[]) {
  await act(async () => { wait.resolve(rows); });
}
async function reject(wait: ReturnType<typeof deferred<JobSyncCompanyCustomer[]>>) {
  await act(async () => { wait.reject(new Error("fixture-sensitive-old-error")); });
}
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function nodes(name: string) { return all().filter((node) => node.nodeName.toLowerCase() === name); }
function row(name: string) {
  const found = nodes("native-touch").find((node) => node.textContent.includes(name));
  if (!found) throw new Error(`Missing customer row ${name}`);
  return found;
}
function refresh() {
  const found = nodes("native-refresh")[0];
  if (!found) throw new Error("Missing pull-to-refresh");
  return found.nativeProps.onRefresh as () => Promise<void>;
}
async function press(handler: () => unknown) { await act(async () => { handler(); }); }
async function appState(next: string) {
  await act(async () => {
    mocks.appState = next;
    for (const callback of mocks.listeners) callback(next);
  });
}
function change(kind: string) {
  const next = session();
  if (kind === "Company") next.company!.id = 10;
  if (kind === "token") next.token = "fixture-rotated-token";
  if (kind === "user") next.user.id = 43;
  if (kind === "role") next.user.role = "dispatcher";
  if (kind === "logout") mocks.auth.session = null;
  else mocks.auth.session = next;
  if (kind === "focus") mocks.focused = false;
  if (kind === "pending") mocks.auth.isLoading = true;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.focused = true; mocks.appState = "active"; mocks.listeners.clear(); mocks.lists = [];
  mocks.auth = { session: session(), isLoading: false };
  mocks.employee = { employee: null, loading: false };
  mocks.list.mockResolvedValue([]);
  // Cached legacy rows deliberately remain available even while the query is disabled.
  mocks.legacy.mockReturnValue({ data: [legacyRecord], isLoading: false, isRefetching: false, refetch: mocks.legacyRefetch });
  mocks.legacyRefetch.mockResolvedValue(undefined);
  // Any accidentally unmocked transport is trapped; never contact a live host.
  mocks.fetch.mockRejectedValue(new Error("Unexpected transport"));
  vi.stubGlobal("fetch", mocks.fetch);
  const document = installPhotoTestDOM();
  container = document.createElement("main"); document.body.appendChild(container);
  root = createRoot(container); unmounted = false; commitText = [];
});
afterEach(async () => {
  if (!unmounted) await act(async () => { root.unmount(); });
  expect(mocks.listeners.size).toBe(0);
  expect(mocks.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("Company customers: actual React lifecycle with mocked native host and read-only transport", () => {
  it("loads canonical Company rows, searches, and navigates with canonical ID and provenance, never bearer params", async () => {
    mocks.list.mockResolvedValue([customer("Zulu"), customer("Alpha", 13)]);
    await render();
    expect(mocks.list).toHaveBeenCalledWith(session().token);
    expect(mocks.legacy.mock.calls.every(([, options]) => options.enabled === false)).toBe(true);
    expect(mocks.lists.at(-1).data.map((item: any) => item.fullName)).toEqual(["Alpha", "Zulu"]);
    await press(row("Alpha").nativeProps.onPress);
    expect(mocks.push).toHaveBeenCalledWith({ pathname: "/(tabs)/admin-customer-profile", params: expect.objectContaining({
      customerId: "13", fullName: "Alpha", phone: "555-fixture", address: "Fixture address", city: "Fixture city", companyId: "9",
    }) });
    expect(JSON.stringify(mocks.push.mock.calls)).not.toContain(session().token);
    expect(container.textContent).not.toContain("Legacy customer");
    expect(container.textContent).not.toContain("Total Lifetime Value");
    vi.useFakeTimers();
    try {
      await act(async () => { nodes("native-input")[0].nativeProps.onChangeText("zULu"); });
      await act(async () => { vi.advanceTimersByTime(300); });
      expect(mocks.lists.at(-1).data.map((item: any) => item.fullName)).toEqual(["Zulu"]);
      expect(mocks.list).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it.each(["Company", "token", "user", "role", "logout", "focus", "pending"])(
    "empties rows in the scope-change commit and blocks a retained onPress after %s", async (kind) => {
      mocks.list.mockResolvedValueOnce([customer()]);
      await render();
      const oldPress = row("A customer").nativeProps.onPress;
      const next = deferred<JobSyncCompanyCustomer[]>(); mocks.list.mockReturnValue(next.promise);
      change(kind);
      const start = commitText.length;
      await render();
      expect(commitText[start]).not.toContain("A customer");
      expect(commitText[start]).toContain("0 Company customers");
      expect(container.textContent).not.toContain("A customer");
      await press(oldPress);
      expect(mocks.push).not.toHaveBeenCalled();
      expect(mocks.legacy.mock.calls.every(([, options]) => options.enabled === false)).toBe(true);
      await resolve(next, [customer("New scope", 13, kind === "Company" ? 10 : 9)]);
      expect(container.textContent).not.toContain("A customer");
    },
  );

  for (const outcome of ["success", "failure"] as const) {
    it.each(["Company", "token", "user", "role", "logout", "focus", "pending"])(
      `drops an old request's late ${outcome} after %s`, async (kind) => {
        const old = deferred<JobSyncCompanyCustomer[]>(); const next = deferred<JobSyncCompanyCustomer[]>();
        mocks.list.mockReturnValueOnce(old.promise).mockReturnValue(next.promise);
        await render(); change(kind); await render();
        if (outcome === "success") await resolve(old, [customer()]); else await reject(old);
        expect(container.textContent).not.toContain("A customer");
        expect(container.textContent).not.toContain("Could not load");
        expect(container.textContent).not.toContain("fixture-sensitive");
        if (!["logout", "focus", "pending"].includes(kind)) {
          expect(container.textContent).toContain("Loading customers");
          await resolve(next, [customer("New scope", 13, kind === "Company" ? 10 : 9)]);
          expect(container.textContent).toContain("New scope");
        } else await resolve(next, []);
      },
    );
  }

  it.each(["Company", "token", "user", "role", "logout", "focus", "pending"])(
    "A -> changed %s -> A does not revive old request or row handlers", async (kind) => {
      const original = deferred<JobSyncCompanyCustomer[]>(); const returned = deferred<JobSyncCompanyCustomer[]>();
      mocks.list.mockResolvedValueOnce([customer()]); await render();
      const retainedRow = row("A customer").nativeProps.onPress;
      const retainedRefresh = refresh();
      mocks.list.mockReturnValueOnce(original.promise);
      await press(retainedRefresh);
      change(kind); mocks.list.mockResolvedValue([]); await render();
      mocks.auth = { session: session(), isLoading: false }; mocks.focused = true;
      mocks.list.mockReturnValue(returned.promise); await render();
      await resolve(original, [customer("Obsolete A")]);
      expect(container.textContent).not.toContain("Obsolete A");
      expect(container.textContent).toContain("Loading customers");
      const count = mocks.list.mock.calls.length;
      await press(retainedRow); await press(retainedRefresh);
      expect(mocks.push).not.toHaveBeenCalled(); expect(mocks.list).toHaveBeenCalledTimes(count);
      await resolve(returned, [customer("Fresh A", 14)]);
      expect(container.textContent).toContain("Fresh A");
      expect(container.textContent).not.toContain("A customer");
    },
  );

  it("an old completion cannot overwrite already loaded B rows", async () => {
    const old = deferred<JobSyncCompanyCustomer[]>(); mocks.list.mockReturnValueOnce(old.promise);
    await render(); change("Company"); mocks.list.mockResolvedValueOnce([customer("B customer", 14, 10)]); await render();
    await resolve(old, [customer()]);
    expect(container.textContent).toContain("B customer"); expect(container.textContent).not.toContain("A customer");
  });

  it("coalesces repeated pull/foreground refreshes and an old completion cannot unlock the new request", async () => {
    mocks.list.mockResolvedValueOnce([customer()]); await render(); const oldRefresh = refresh();
    const old = deferred<JobSyncCompanyCustomer[]>(); mocks.list.mockReturnValueOnce(old.promise);
    await act(async () => { const first = oldRefresh(); expect(oldRefresh()).toBe(first); oldRefresh(); });
    await appState("background"); await appState("active"); expect(mocks.list).toHaveBeenCalledTimes(2);
    change("Company"); const next = deferred<JobSyncCompanyCustomer[]>(); mocks.list.mockReturnValue(next.promise); await render();
    await resolve(old, [customer()]);
    await appState("background"); await appState("active"); expect(mocks.list).toHaveBeenCalledTimes(3);
    await resolve(next, [customer("B customer", 14, 10)]);
    expect(container.textContent).toContain("B customer");
    const current = refresh(); const renewed = deferred<JobSyncCompanyCustomer[]>(); mocks.list.mockReturnValue(renewed.promise);
    await act(async () => { const first = current(); expect(current()).toBe(first); });
    expect(mocks.list).toHaveBeenCalledTimes(4); await resolve(renewed, [customer("B refreshed", 15, 10)]);
    expect(container.textContent).toContain("B refreshed");
  });

  it("refreshes only on foreground transition, not active-to-active or blur, and removes listeners on unmount", async () => {
    mocks.list.mockResolvedValue([customer()]); await render();
    await appState("active"); expect(mocks.list).toHaveBeenCalledTimes(1);
    await appState("background"); await appState("active"); expect(mocks.list).toHaveBeenCalledTimes(2);
    mocks.focused = false; await render(); await appState("background"); await appState("active");
    expect(mocks.list).toHaveBeenCalledTimes(2);
    mocks.focused = true; await render(); expect(mocks.list).toHaveBeenCalledTimes(3);
    const retainedListener = [...mocks.listeners][0];
    await act(async () => { root.unmount(); }); unmounted = true;
    await press(() => { retainedListener("background"); retainedListener("active"); });
    expect(mocks.list).toHaveBeenCalledTimes(3);
  });

  it.each(["success", "failure"])("ignores late %s and retained handlers after unmount", async (outcome) => {
    mocks.list.mockResolvedValueOnce([customer()]); await render();
    const oldPress = row("A customer").nativeProps.onPress; const oldRefresh = refresh();
    const wait = deferred<JobSyncCompanyCustomer[]>(); mocks.list.mockReturnValue(wait.promise); await press(oldRefresh);
    await act(async () => { root.unmount(); }); unmounted = true;
    if (outcome === "success") await resolve(wait, [customer("Late")]); else await reject(wait);
    await press(oldPress); await press(oldRefresh);
    expect(container.textContent).toBe(""); expect(mocks.push).not.toHaveBeenCalled(); expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("shows a sanitized actionable error without legacy cached rows and permits explicit read retry", async () => {
    mocks.list.mockRejectedValueOnce(new Error("fixture-sensitive-denial")); await render();
    expect(container.textContent).toContain("Could not load this Company’s customers. Check your connection and pull to refresh.");
    expect(container.textContent).not.toContain("fixture-sensitive"); expect(container.textContent).not.toContain("Legacy customer");
    mocks.list.mockResolvedValueOnce([customer()]); await press(refresh()); expect(container.textContent).toContain("A customer");
  });

  it("rejects explicit wrong-Company provenance in a list response rather than presenting those rows", async () => {
    mocks.list.mockResolvedValueOnce([customer("Wrong company", 12, 99)]); await render();
    expect(container.textContent).not.toContain("Wrong company"); expect(container.textContent).toContain("Could not load");
  });

  it.each(["pending JobSync", "pending employee", "jobsync provenance", "companyId provenance", "signed platform", "missing Company", "blank bearer", "invalid user", "unsupported role", "logged out"])(
    "does not enable/render/refetch legacy rows in %s workspace", async (kind) => {
      mocks.auth.session = null; mocks.employee.employee = localEmployee();
      if (kind === "pending JobSync") mocks.auth.isLoading = true;
      if (kind === "pending employee") mocks.employee.loading = true;
      if (kind === "jobsync provenance") mocks.employee.employee!.sessionSource = "jobsync";
      if (kind === "companyId provenance") mocks.employee.employee!.companyId = 9;
      if (kind === "signed platform") { mocks.auth.session = session(); mocks.auth.session.portal = "platform"; }
      if (["missing Company", "blank bearer", "invalid user", "unsupported role"].includes(kind)) {
        mocks.auth.session = session();
        if (kind === "missing Company") mocks.auth.session.company = undefined;
        if (kind === "blank bearer") mocks.auth.session.token = " ";
        if (kind === "invalid user") mocks.auth.session.user.id = 0;
        if (kind === "unsupported role") mocks.auth.session.user.role = "sales";
      }
      if (kind === "logged out") mocks.employee.employee = null;
      await render(); await press(refresh());
      expect(mocks.legacy.mock.calls.every(([, options]) => options.enabled === false)).toBe(true);
      expect(container.textContent).not.toContain("Legacy customer"); expect(mocks.legacyRefetch).not.toHaveBeenCalled();
      expect(mocks.list).not.toHaveBeenCalled();
    },
  );

  it("preserves confirmed legacy search/query options, stats, VIP, navigation and pull refresh", async () => {
    mocks.auth.session = null; mocks.employee.employee = localEmployee(); await render();
    expect(mocks.legacy).toHaveBeenLastCalledWith({ search: "" }, expect.objectContaining({ enabled: true, staleTime: 600000 }));
    expect(container.textContent).toContain("Legacy customer"); expect(container.textContent).toContain("$150.00");
    expect(container.textContent).toContain("Total Lifetime Value"); expect(container.textContent).toContain("VIP");
    await press(row("Legacy customer").nativeProps.onPress);
    expect(mocks.push.mock.calls[0][0].params.customerId).toBe("legacy-12");
    expect(mocks.push.mock.calls[0][0].params.companyId).toBeUndefined();
    await press(refresh()); expect(mocks.legacyRefetch).toHaveBeenCalledTimes(1); expect(mocks.list).not.toHaveBeenCalled();
    vi.useFakeTimers();
    try {
      await act(async () => { nodes("native-input")[0].nativeProps.onChangeText("legacy"); vi.advanceTimersByTime(300); });
      await act(async () => { vi.advanceTimersByTime(300); });
      expect(mocks.legacy).toHaveBeenLastCalledWith({ search: "legacy" }, expect.objectContaining({ enabled: true, staleTime: 0, placeholderData: undefined }));
    } finally { vi.useRealTimers(); }
  });

  it("blocks a retained legacy onPress after entering a Company workspace", async () => {
    mocks.auth.session = null; mocks.employee.employee = localEmployee(); await render();
    const oldPress = row("Legacy customer").nativeProps.onPress;
    const oldRefresh = refresh();
    mocks.auth.session = session(); mocks.list.mockResolvedValue([customer()]); await render();
    await press(oldPress); await press(oldRefresh);
    expect(mocks.push).not.toHaveBeenCalled(); expect(mocks.legacyRefetch).not.toHaveBeenCalled();
  });
});
