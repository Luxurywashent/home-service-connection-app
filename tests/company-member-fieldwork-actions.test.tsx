import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import AdminEmployeesScreen from "../app/(tabs)/admin-employees";
import type { JobSyncNativeSession } from "../lib/jobsync-mobile-api";

// Real React state/effects and native callback invocations; all network is mocked.
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
const state = vi.hoisted(() => ({ session: null as JobSyncNativeSession | null, focused: true }));
vi.mock("expo-router", () => ({ useIsFocused: () => state.focused }));
vi.mock("@/lib/jobsync-auth-context", () => ({ useJobSyncAuth: () => ({ session: state.session }) }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ primary: "blue", foreground: "black", muted: "gray", error: "red", background: "white", border: "gray", surface: "white", success: "green", warning: "orange" }) }));
vi.mock("@/lib/trpc", () => {
  const procedure = { useQuery: () => ({ data: [], isLoading: false }), useMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }), invalidate: vi.fn() };
  const group = new Proxy({}, { get: () => procedure });
  return { trpc: new Proxy({ useUtils: () => new Proxy({}, { get: () => group }) }, { get: (target, key) => key === "useUtils" ? target.useUtils : group }) };
});
vi.mock("@/components/screen-container", async () => {
  const R = await import("react");
  return { ScreenContainer: ({ children }: { children: React.ReactNode }) => R.createElement("native-screen", null, children) };
});
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => R.createElement(name, {
    ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
  }, props.children);
  return {
    Text: host("native-text"), View: host("native-view"), ScrollView: host("native-scroll"), TouchableOpacity: host("native-touch"),
    TextInput: host("native-input"), ActivityIndicator: host("native-loading"),
    Modal: (props: Record<string, any>) => props.visible ? R.createElement(host("native-modal"), props) : null,
    FlatList: (props: Record<string, any>) => R.createElement("native-list", null, props.ListHeaderComponent,
      props.data.map((item: any) => R.createElement(R.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item })))),
    Alert: { alert: vi.fn() }, Platform: { OS: "web" }, StyleSheet: { create: (styles: unknown) => styles },
  };
});

type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
const fixtureSession = (): JobSyncNativeSession => ({
  token: "fixture-only-token", portal: "company", user: { id: 42, role: "owner", name: "Fixture Owner", email: null, calendarEligible: false },
  company: { id: 9, name: "Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null },
});
const member = (id = 7, role = "dispatcher", extra: Record<string, unknown> = {}) => ({ id, name: `Fixture Member ${id}`, role, isActive: true, ...extra });
const detail = (id = 7, role = "dispatcher", extra: Record<string, unknown> = {}) => ({ member: {
  ...member(id, role), firstName: "Fixture", lastName: `Member ${id}`, email: `fixture-${id}@example.invalid`, city: "Fixture City",
  calendarEligible: null, hourlyRate: null, upsellBonusPct: null, workDays: [], ...extra,
} });
const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let fetchMock: ReturnType<typeof vi.fn>;
let rosterMembers: ReturnType<typeof member>[];
let rosterCompanyId: number;
let rosterFailure: number | null;
let detailFailure: number | null;
let signedFailure: number | null;
let signedRole: string | null;
let signedCompanyId: number | null;
let patchStatus: number;
let ackOverride: unknown;
let patchWait: ReturnType<typeof deferred<Response>> | null;
let sessionWait: ReturnType<typeof deferred<Response>> | null;
let patchAckTransform: ((payload: any) => unknown) | null;
let signedReads: number;
let signedReadHook: ((count: number) => void) | null;
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function nodes(name: string) { return all().filter((node) => node.nodeName.toLowerCase() === name); }
function findButton(label: string) { return nodes("native-touch").find((node) => node.nativeProps.accessibilityLabel === label || node.textContent === label); }
function button(label: string) { const node = findButton(label); if (!node) throw new Error(`Missing ${label}: ${container.textContent}`); return node; }
async function press(node: NativeNode) { await act(async () => { node.nativeProps.onPress?.(); }); }
async function render() { await act(async () => { root.render(<AdminEmployeesScreen />); }); }
async function open(id = 7) {
  await render();
  const row = nodes("native-touch").find((node) => node.textContent.startsWith(`FMFixture Member ${id}`));
  if (!row) throw new Error(`Missing member row ${id}: ${container.textContent}`);
  await press(row);
}
function patches() { return fetchMock.mock.calls.filter(([, input]) => input.method === "PATCH"); }
function signedPayload() {
  const session = state.session!;
  return { user: { ...session.user, role: signedRole ?? session.user.role }, company: { ...session.company!, id: signedCompanyId ?? session.company!.id }, accountType: "company" };
}

beforeEach(() => {
  state.session = fixtureSession(); state.focused = true;
  rosterMembers = [member(), member(8), member(10, "owner"), member(11, "technician")]; rosterCompanyId = 9;
  rosterFailure = null; detailFailure = null; signedFailure = null; signedRole = null; signedCompanyId = null;
  patchStatus = 200; ackOverride = undefined; patchWait = null; sessionWait = null; patchAckTransform = null; signedReads = 0; signedReadHook = null;
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-11-15T06:00:00Z"));
  fetchMock = vi.fn(async (url: string, input: RequestInit) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/auth/session")) {
      signedReads += 1; signedReadHook?.(signedReads);
      if (sessionWait) return sessionWait.promise;
      return signedFailure ? response({ error: { message: `Fixture signed HTTP ${signedFailure}` } }, signedFailure) : response(signedPayload());
    }
    if (path.endsWith("/team-members")) return rosterFailure ? response({ error: { message: "Fixture roster refusal" } }, rosterFailure)
      : response({ company: { id: rosterCompanyId, name: "Fixture Company" }, members: rosterMembers });
    const id = Number(path.split("/").at(-1));
    if (!path.includes("/team-members/")) throw new Error(`Unexpected fixture network request ${path}`);
    if (input.method === "PATCH") {
      if (patchWait) return patchWait.promise;
      const role = rosterMembers.find((row) => row.id === id)?.role ?? "dispatcher";
      const payload = { member: { id, role, isActive: true, calendarEligible: ackOverride === undefined ? JSON.parse(input.body as string).calendarEligibleOverride : ackOverride } };
      return patchStatus === 200 ? response(patchAckTransform ? patchAckTransform(payload) : payload) : response({ error: { message: `Fixture PATCH HTTP ${patchStatus}` } }, patchStatus);
    }
    return detailFailure ? response({ error: { message: "Fixture detail refusal" } }, detailFailure)
      : response(detail(id, rosterMembers.find((row) => row.id === id)?.role));
  });
  vi.stubGlobal("fetch", fetchMock);
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("Company member fieldwork actions (real React lifecycle, mocked RN and HTTP only)", () => {
  it.each([true, false])("sends only the exact %s boolean and shows the helper acknowledgment, not calendar success", async (value) => {
    await open();
    expect(signedReads).toBe(1);
    expect(findButton("Edit")).toBeUndefined();
    expect(nodes("native-input")).toHaveLength(0);
    expect(container.textContent).toContain("Current availability UNKNOWN");
    await press(button(value ? "Enable field-job override" : "Disable field-job override"));
    expect(patches()).toHaveLength(1);
    const [url, input] = patches()[0];
    expect(new URL(url).pathname).toBe("/api/mobile/v1/company/team-members/7");
    expect(JSON.parse(input.body)).toEqual({ calendarEligibleOverride: value });
    expect(input.headers.Authorization).toBe("Bearer fixture-only-token");
    expect(signedReads).toBe(3); // opening, pre-write, post-write
    expect(fetchMock.mock.calls.filter(([url]) => new URL(url).pathname.endsWith("/team-members"))).toHaveLength(3);
    expect(fetchMock.mock.calls.filter(([url, input]) => new URL(url).pathname.endsWith("/team-members/7") && input.method === "GET")).toHaveLength(2);
    expect(container.textContent).toContain(`Server confirmed individual override ${value ? "TRUE" : "FALSE"}; role unchanged.`);
    expect(container.textContent).toContain("automatic booking remain unverified");
    expect(container.textContent).toContain("Current availability UNKNOWN");
  });
  it("synchronously locks two retained button callbacks before a React pending commit", async () => {
    await open(); patchWait = deferred<Response>();
    const enable = button("Enable field-job override"); const disable = button("Disable field-job override");
    await act(async () => { enable.nativeProps.onPress(); enable.nativeProps.onPress(); disable.nativeProps.onPress(); });
    expect(patches()).toHaveLength(1);
    expect(button("Enable field-job override").nativeProps.disabled).toBe(true);
    await act(async () => { patchWait!.resolve(response({ member: { id: 7, role: "dispatcher", calendarEligible: true } })); });
    expect(container.textContent).toContain("override TRUE; role unchanged");
  });
  it.each([401, 403, 503])("PATCH HTTP %s remains UNKNOWN, refreshes both reads, and hides authority", async (status) => {
    await open(); patchStatus = status;
    const oldEnable = button("Enable field-job override");
    await press(oldEnable);
    expect(container.textContent).toContain(`Fixture PATCH HTTP ${status}`);
    expect(container.textContent).toContain("UNKNOWN");
    expect(container.textContent).not.toContain("Server confirmed");
    expect(findButton("Enable field-job override")).toBeUndefined();
    expect(fetchMock.mock.calls.filter(([url]) => new URL(url).pathname.endsWith("/team-members"))).toHaveLength(3);
    await press(oldEnable); expect(patches()).toHaveLength(1);
  });
  it.each([401, 403, 503])("signed opening HTTP %s never grants owner actions", async (status) => {
    signedFailure = status; await open();
    expect(findButton("Enable field-job override")).toBeUndefined();
    expect(container.textContent).toContain(`Fixture signed HTTP ${status}`);
    expect(patches()).toHaveLength(0);
  });
  it.each(["dispatcher", "technician", "company-mismatch"])("a live %s session does not grant actions from cached owner UI", async (change) => {
    if (change === "company-mismatch") signedCompanyId = 10; else signedRole = change;
    await open(); expect(findButton("Enable field-job override")).toBeUndefined(); expect(patches()).toHaveLength(0);
  });
  it("waits for a signed opening GET and matching detail, never cached owner evidence", async () => {
    const wait = deferred<Response>(); sessionWait = wait; await open();
    expect(findButton("Enable field-job override")).toBeUndefined();
    expect(container.textContent).toContain("Verifying signed Company access");
    const payload = signedPayload(); sessionWait = null;
    await act(async () => { wait.resolve(response(payload)); });
    expect(button("Enable field-job override")).toBeDefined();
    expect(patches()).toHaveLength(0);
  });
  it("keeps technician editing and owner/dispatcher-target denials separate", async () => {
    await open(11); expect(button("Edit")).toBeDefined();
    await press(button("Edit")); expect(nodes("native-input").length).toBeGreaterThan(0);
    await press(button("Close")); await open(10);
    expect(findButton("Edit")).toBeUndefined(); expect(findButton("Enable field-job override")).toBeUndefined();
    expect(container.textContent).toContain("Owner targets");
    await press(button("Close")); state.session = { ...fixtureSession(), user: { ...fixtureSession().user, role: "dispatcher" } }; await open(7);
    expect(findButton("Edit")).toBeUndefined(); expect(findButton("Enable field-job override")).toBeUndefined();
  });
  it.each([null, "true", false])("rejects a nonexact enable acknowledgment (%s)", async (value) => {
    await open(); ackOverride = value; await press(button("Enable field-job override"));
    expect(container.textContent).toContain("did not acknowledge the exact target");
    expect(container.textContent).toContain("UNKNOWN"); expect(container.textContent).not.toContain("Server confirmed");
  });
  it.each(["id", "role", "inactive", "contradictory"])("rejects malformed %s acknowledgment", async (change) => {
    await open(); patchAckTransform = (payload) => ({ member: { ...payload.member,
      ...(change === "id" ? { id: 8 } : change === "role" ? { role: "technician" } : change === "inactive" ? { isActive: false } : { calendarEligibleOverride: false }),
    } });
    await press(button("Enable field-job override")); expect(container.textContent).not.toContain("Server confirmed"); expect(findButton("Enable field-job override")).toBeUndefined();
  });
  it.each(["roster", "detail"])("%s refresh failure invalidates acknowledgment and old callbacks", async (kind) => {
    await open(); const oldEnable = button("Enable field-job override");
    if (kind === "roster") rosterFailure = 503; else detailFailure = 503;
    await press(oldEnable);
    expect(container.textContent).toContain("Could not refresh after the fieldwork request");
    expect(container.textContent).toContain("UNKNOWN"); expect(container.textContent).not.toContain("Server confirmed");
    await press(oldEnable); expect(patches()).toHaveLength(1);
  });
  it("offline PATCH also propagates failure and attempts roster/detail refresh", async () => {
    await open(); patchWait = deferred<Response>(); await press(button("Enable field-job override"));
    await act(async () => { patchWait!.reject(new Error("Fixture offline")); });
    expect(container.textContent).toContain("Fixture offline"); expect(container.textContent).not.toContain("Server confirmed");
    expect(fetchMock.mock.calls.filter(([url]) => new URL(url).pathname.endsWith("/team-members"))).toHaveLength(3);
  });
  it.each(["token", "role", "company", "user", "capability", "target", "blur", "expiry", "unmount"])("drops an old acknowledgment after %s changes", async (change) => {
    await open(); const oldEnable = button("Enable field-job override"); patchWait = deferred<Response>(); await press(oldEnable);
    const old = state.session!;
    if (change === "token") state.session = { ...old, token: "fixture-rotated" };
    if (change === "role") state.session = { ...old, user: { ...old.user, role: "dispatcher" } };
    if (change === "company") { state.session = { ...old, company: { ...old.company!, id: 10 } }; rosterCompanyId = 10; }
    if (change === "user") state.session = { ...old, user: { ...old.user, id: 43 } };
    if (change === "capability") state.session = { ...old, user: { ...old.user, calendarEligible: true } };
    if (change === "target") { await press(button("Close")); await open(8); }
    else if (change === "blur") { state.focused = false; await render(); }
    else if (change === "expiry") await act(async () => { vi.advanceTimersByTime(60_000); });
    else if (change === "unmount") await act(async () => { root.unmount(); });
    else await render();
    await act(async () => { patchWait!.resolve(response({ member: { id: 7, role: "dispatcher", calendarEligible: true } })); });
    expect(container.textContent).not.toContain("Server confirmed");
    if (change !== "unmount") { await press(oldEnable); expect(patches()).toHaveLength(1); }
  });
  it("late signed refusal after target change cannot overwrite the new target", async () => {
    const wait = deferred<Response>(); sessionWait = wait;
    await open(7); await press(button("Close")); sessionWait = null; await open(8);
    expect(button("Enable field-job override")).toBeDefined();
    await act(async () => { wait.resolve(response({ error: { message: "OLD REFUSAL" } }, 403)); });
    expect(container.textContent).not.toContain("OLD REFUSAL"); expect(button("Enable field-job override")).toBeDefined();
  });
  it("prewrite and postwrite live-role refusals remove buttons and never acknowledge success", async () => {
    await open(); signedRole = "dispatcher"; await press(button("Enable field-job override"));
    expect(patches()).toHaveLength(0); expect(findButton("Enable field-job override")).toBeUndefined();
    signedRole = null; await press(button("Retry signed Company access"));
    // Choose the post-write read specifically: retry added a signed read; next is pre-write.
    const nextPostWrite = signedReads + 2;
    signedReadHook = (count) => { if (count === nextPostWrite) signedRole = "dispatcher"; };
    await press(button("Enable field-job override"));
    expect(patches()).toHaveLength(1); expect(container.textContent).not.toContain("Server confirmed"); expect(findButton("Enable field-job override")).toBeUndefined();
  });
  it("expiry removes buttons at 60 seconds; retry requires another signed read and rejects retained old actions", async () => {
    await open(); const oldEnable = button("Enable field-job override");
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(findButton("Enable field-job override")).toBeUndefined();
    await press(oldEnable); expect(patches()).toHaveLength(0);
    await press(button("Retry signed Company access")); expect(signedReads).toBe(2); expect(button("Enable field-job override")).toBeDefined();
    await press(oldEnable); expect(patches()).toHaveLength(0);
  });
  it.each(["role", "inactive", "missing", "company"])("fresh roster %s revocation cannot promote a late acknowledgment", async (kind) => {
    await open(); patchWait = deferred<Response>(); const oldEnable = button("Enable field-job override"); await press(oldEnable);
    if (kind === "role") rosterMembers = [member(7, "technician")];
    if (kind === "inactive") rosterMembers = [member(7, "dispatcher", { isActive: false })];
    if (kind === "missing") rosterMembers = [member(8)];
    if (kind === "company") rosterCompanyId = 10;
    await act(async () => { patchWait!.resolve(response({ member: { id: 7, role: "dispatcher", calendarEligible: true } })); });
    expect(container.textContent).toContain("UNKNOWN"); expect(container.textContent).not.toContain("Server confirmed");
    expect(findButton("Enable field-job override")).toBeUndefined();
    await press(oldEnable); expect(patches()).toHaveLength(1);
  });
  it("roster failure on access retry removes prior authority even if the signed owner GET succeeds", async () => {
    await open(); const oldEnable = button("Enable field-job override"); rosterFailure = 503;
    await press(button("Retry signed Company access"));
    expect(container.textContent).toContain("Fixture roster refusal"); expect(findButton("Enable field-job override")).toBeUndefined();
    await press(oldEnable); expect(patches()).toHaveLength(0);
  });
  it("a successful disable does not turn the broken NULL detail read into a verified OFF switch", async () => {
    await open(); await press(button("Disable field-job override"));
    expect(container.textContent).toContain("override FALSE; role unchanged");
    expect(container.textContent).toContain("Current availability UNKNOWN");
    expect(all().some((node) => node.nativeProps?.accessibilityRole === "switch")).toBe(false);
  });
  it("blur synchronously invalidates callbacks and focus requires fresh roster/detail/signed GET", async () => {
    await open(); const oldEnable = button("Enable field-job override");
    state.focused = false; await render(); expect(findButton("Enable field-job override")).toBeUndefined();
    await press(oldEnable); expect(patches()).toHaveLength(0);
    state.focused = true; await render(); expect(signedReads).toBe(2); expect(button("Enable field-job override")).toBeDefined();
    await press(oldEnable); expect(patches()).toHaveLength(0);
  });
  it("clears old Company roster/detail before deferred replacement reads complete", async () => {
    await open(); expect(container.textContent).toContain("fixture-7@example.invalid"); const oldEnable = button("Enable field-job override");
    const oldFetch = fetchMock.getMockImplementation()!; const wait = deferred<Response>();
    fetchMock.mockImplementation((url, input) => new URL(url).pathname.endsWith("/team-members") ? wait.promise : oldFetch(url, input));
    state.session = { ...state.session!, token: "fixture-rotated" }; await render();
    expect(container.textContent).not.toContain("fixture-7@example.invalid"); expect(container.textContent).not.toContain("Fixture Member 7");
    await press(oldEnable); expect(patches()).toHaveLength(0);
    await act(async () => { wait.resolve(response({ company: { id: 9 }, members: rosterMembers })); });
    expect(findButton("Enable field-job override")).toBeUndefined(); // Must open a scoped new row.
  });
  it("rejects mismatched roster Company provenance rather than assuming the displayed Company", async () => {
    rosterCompanyId = 10; await render();
    expect(container.textContent).not.toContain("Fixture Member 7"); expect(findButton("Enable field-job override")).toBeUndefined(); expect(patches()).toHaveLength(0);
  });
  it("a retry synchronously removes old signed evidence before retained Enable can run", async () => {
    await open(); const enable = button("Enable field-job override"); const retry = button("Retry signed Company access");
    signedFailure = 403;
    await act(async () => { retry.nativeProps.onPress(); enable.nativeProps.onPress(); });
    expect(patches()).toHaveLength(0); expect(findButton("Enable field-job override")).toBeUndefined();
    expect(container.textContent).toContain("Fixture signed HTTP 403");
  });
});
