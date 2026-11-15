import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { JobSyncAuthProvider, useJobSyncAuth } from "../lib/jobsync-auth-context";
import ProfileScreen from "../app/(tabs)/profile";
import { useCompanyFieldworkCalendar } from "../hooks/use-company-fieldwork-calendar";
import { isAssignedCompanyFieldActor } from "../lib/company-job-fieldwork";
import type { JobSyncNativeSession } from "../lib/jobsync-mobile-api";

const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
const mocks = vi.hoisted(() => ({ focused: true, storageGet: vi.fn(), storageSet: vi.fn(), storageRemove: vi.fn() }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: mocks.storageGet, setItem: mocks.storageSet, removeItem: mocks.storageRemove } }));
vi.mock("expo-secure-store", () => ({ getItemAsync: mocks.storageGet, setItemAsync: mocks.storageSet, deleteItemAsync: mocks.storageRemove }));
vi.mock("expo-router", async () => {
  const R = await import("react");
  return { useRouter: () => ({ replace: vi.fn() }), useIsFocused: () => mocks.focused,
    useFocusEffect: (callback: () => void | (() => void)) => { R.useEffect(() => mocks.focused ? callback() : undefined, [callback, mocks.focused]); } };
});
vi.mock("@/lib/auth-context", () => ({ useEmployeeAuth: () => ({ employee: { role: "admin", fullName: "Fixture Manager", email: "fixture@example.invalid" }, logout: vi.fn() }) }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ primary: "blue", foreground: "black", muted: "gray", error: "red", background: "white", border: "gray", surface: "white", success: "green" }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { employee: { resetPin: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } }, fleet: { getVanAssignment: { useQuery: () => ({ data: null, isLoading: false }) } } } }));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({ default: () => null }));
vi.mock("@/components/screen-container", async () => {
  const R = await import("react");
  return { ScreenContainer: ({ children }: { children: React.ReactNode }) => R.createElement("native-screen", null, children) };
});
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => R.createElement(name, {
    ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
  }, props.children);
  return { Text: host("native-text"), View: host("native-view"), ScrollView: host("native-scroll"), TouchableOpacity: host("native-touch"),
    TextInput: host("native-input"), ActivityIndicator: host("native-loading"), Alert: { alert: vi.fn() }, Platform: { OS: "web" },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }, useWindowDimensions: () => ({ width: 900 }) };
});

type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let auth: ReturnType<typeof useJobSyncAuth>;
let candidates: ReturnType<typeof useCompanyFieldworkCalendar>;
let fetchMock: ReturnType<typeof vi.fn>;
let db: { role: "owner" | "dispatcher" | "technician"; value: boolean | null; companyId: number; userId: number };
let patchWait: ReturnType<typeof deferred<Response>> | null;
let readWait: ReturnType<typeof deferred<Response>> | null;
let patchError: string | null;
let ackTransform: ((raw: any) => unknown) | null;
let signedReads: number;
let readFailureAt: number | null;
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function raw() { return { accountType: "company", company: { id: db.companyId, name: "Fixture", slug: "fixture" },
  user: { id: db.userId, name: "Fixture Manager", role: db.role, calendarEligible: db.value } }; }
function response(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }); }
function Harness({ profile = true }: { profile?: boolean }) {
  auth = useJobSyncAuth();
  candidates = useCompanyFieldworkCalendar(auth.session, 0);
  return <>{profile && <ProfileScreen />}<div>{candidates.members.map((member) => member.employeeId).join(",")}</div></>;
}
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function button(label: string) {
  const node = all().find((node) => node.nodeName === "NATIVE-TOUCH" && (node.nativeProps.accessibilityLabel === label || node.textContent === label));
  if (!node) throw new Error(`Missing button ${label}: ${container.textContent}`);
  return node;
}
async function press(label: string) { await act(async () => { button(label).nativeProps.onPress?.(); }); }
async function render(profile = true) { await act(async () => { root.render(<JobSyncAuthProvider><Harness profile={profile} /></JobSyncAuthProvider>); }); }
async function work() { await render(); await press("Work"); }
const onLabel = "Turn ON your field-job override";
const offLabel = "Turn OFF your field-job override";
function patches() { return fetchMock.mock.calls.filter(([, input]) => input.method === "PATCH"); }
beforeEach(() => {
  db = { role: "owner", value: false, companyId: 9, userId: 42 }; mocks.focused = true;
  patchWait = null; readWait = null; patchError = null; ackTransform = null; signedReads = 0; readFailureAt = null;
  mocks.storageGet.mockReset().mockImplementation(async (key) => key === "hsc_jobsync_mobile_bearer_v1" ? "fixture-only-token" : null);
  mocks.storageSet.mockReset(); mocks.storageRemove.mockReset();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-11-15T06:00:00Z"));
  fetchMock = vi.fn(async (url: string, input: RequestInit) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/auth/session")) {
      signedReads++;
      if (readWait) return readWait.promise;
      if (signedReads === readFailureAt) return response({ error: { message: "Fixture signed read refusal" } }, 503);
      return response(raw());
    }
    if (path.endsWith("/team-members")) return response({ company: { id: db.companyId, name: "Fixture" }, members: [
      { id: db.userId, name: "Fixture Manager", role: db.role, isActive: true, calendarEligible: true },
      { id: 50, name: "Technician", role: "technician", isActive: true, calendarEligible: true },
      { id: 51, name: "Other Admin", role: "dispatcher", isActive: true, calendarEligible: true },
    ] });
    if (path.endsWith("/company/profile") && input.method === "PATCH") {
      if (patchWait) return patchWait.promise;
      if (patchError) throw new Error(patchError);
      db.value = JSON.parse(input.body as string).calendarEligibleOverride;
      return response(ackTransform ? ackTransform(raw()) : raw());
    }
    throw new Error(`Unexpected fixture-only request ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const doc = installPhotoTestDOM(); container = doc.createElement("main"); doc.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); }); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("signed auth context refresh", () => {
  it("propagates only a newly read signed same-identity value without replacing or storing token", async () => {
    await render(false); expect(auth.session!.user.calendarEligible).toBe(false);
    const original = auth.session!; db.value = true;
    let live!: JobSyncNativeSession;
    await act(async () => { live = await auth.refreshSession(original); });
    expect(auth.session!.user.calendarEligible).toBe(true);
    expect(auth.session!.token).toBe(original.token); expect(live.token).toBe(original.token);
    expect(mocks.storageSet).not.toHaveBeenCalled(); expect(patches()).toHaveLength(0);
  });
  it.each(["user", "company"])("rejects a signed %s identity mismatch without applying it", async (change) => {
    await render(false); const original = auth.session!;
    if (change === "user") db.userId = 99; else db.companyId = 99;
    await act(async () => { await expect(auth.refreshSession(original)).rejects.toThrow("different account"); });
    expect(auth.session).toBe(original); expect(mocks.storageSet).not.toHaveBeenCalled();
  });
  it("propagates fresh live demotion, never promoting the old manager role", async () => {
    await render(false); db.role = "technician";
    await act(async () => { await auth.refreshSession(auth.session!); });
    expect(auth.session!.user.role).toBe("technician");
  });
  it("cannot restore a late refresh after logout", async () => {
    await render(false); const expected = auth.session!; readWait = deferred<Response>();
    let pending!: Promise<JobSyncNativeSession>;
    await act(async () => { pending = auth.refreshSession(expected); await auth.logout(); });
    await act(async () => { readWait!.resolve(response(raw())); await pending; });
    expect(auth.session).toBeNull();
  });
  it("reads but does not apply after caller focus invalidation or refresh refusal", async () => {
    await render(false); const original = auth.session!; db.value = true;
    await act(async () => { await auth.refreshSession(original, { isCurrent: () => false }); });
    expect(auth.session).toBe(original);
    readFailureAt = signedReads + 1;
    await act(async () => { await expect(auth.refreshSession(original)).rejects.toThrow("refusal"); });
    expect(auth.session).toBe(original);
  });
});

describe("management self profile, context and candidate integration (mocked HTTP backend only)", () => {
  it.each(["owner", "dispatcher"] as const)("persists %s ON/OFF across recreated UI and immediately updates context/candidates", async (role) => {
    db.role = role; await work();
    expect(candidates.members.map((member) => member.id)).toEqual([50]);
    expect(isAssignedCompanyFieldActor(auth.session, { companyId: 9, assignedUserId: 42 })).toBe(false);
    await press(onLabel);
    expect(patches()).toHaveLength(1); expect(JSON.parse(patches()[0][1].body)).toEqual({ calendarEligibleOverride: true });
    expect(container.textContent).toContain("ON · server TRUE"); expect(container.textContent).toContain("Server confirmed your individual override TRUE");
    expect(auth.session!.user).toMatchObject({ id: 42, role, calendarEligible: true });
    expect(isAssignedCompanyFieldActor(auth.session, { companyId: 9, assignedUserId: 42 })).toBe(true);
    expect(isAssignedCompanyFieldActor(auth.session, { companyId: 9, assignedUserId: 51 })).toBe(false);
    expect(isAssignedCompanyFieldActor(auth.session, { companyId: 10, assignedUserId: 42 })).toBe(false);
    expect(candidates.members.map((member) => member.employeeId)).toEqual(["jobsync-42", "jobsync-50"]);
    expect(candidates.members[0].fieldworkSource).toBe(role === "owner" ? "signed-self-owner" : "signed-self-dispatcher");
    await act(async () => { root.unmount(); }); root = createRoot(container);
    await work(); expect(container.textContent).toContain("ON · server TRUE");
    await press(offLabel);
    expect(container.textContent).toContain("OFF · server verified"); expect(auth.session!.user.calendarEligible).toBe(false);
    expect(isAssignedCompanyFieldActor(auth.session, { companyId: 9, assignedUserId: 42 })).toBe(false);
    expect(candidates.members.map((member) => member.id)).toEqual([50]);
    expect(patches().map(([, input]) => Object.keys(JSON.parse(input.body)))).toEqual([["calendarEligibleOverride"], ["calendarEligibleOverride"]]);
    expect(mocks.storageSet).not.toHaveBeenCalled();
  });
  it("locks retained callbacks synchronously and never shows optimistic saved ON", async () => {
    await work(); patchWait = deferred<Response>(); const enable = button(onLabel); const disable = button(offLabel);
    const oldEnable = enable.nativeProps.onPress;
    await act(async () => { enable.nativeProps.onPress(); enable.nativeProps.onPress(); disable.nativeProps.onPress(); });
    expect(patches()).toHaveLength(1); expect(button(onLabel).nativeProps.disabled).toBe(true);
    expect(container.textContent).toContain("Saving and reconciling"); expect(container.textContent).not.toContain("ON · server TRUE");
    db.value = true;
    await act(async () => { patchWait!.resolve(response(raw())); });
    expect(container.textContent).toContain("ON · server TRUE");
    await act(async () => { oldEnable(); }); expect(patches()).toHaveLength(1);
  });
  it.each(["offline", "ambiguous", "reconciliation"])("clears status and saved messaging after %s failure", async (failure) => {
    await work(); const before = signedReads;
    if (failure === "offline") patchError = "Fixture offline";
    if (failure === "ambiguous") ackTransform = (raw) => ({ member: raw.user });
    if (failure === "reconciliation") readFailureAt = signedReads + 2;
    await press(onLabel);
    expect(signedReads).toBeGreaterThanOrEqual(before + 2);
    expect(container.textContent).toContain("UNKNOWN"); expect(container.textContent).not.toContain("Server confirmed your");
    expect(button(onLabel).nativeProps.disabled).toBe(true);
  });
  it("requires fresh signed evidence at 60 seconds and rejects retained pre-retry buttons", async () => {
    await work(); const oldEnable = button(onLabel).nativeProps.onPress;
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(button(onLabel).nativeProps.disabled).toBe(true);
    await act(async () => { oldEnable(); }); expect(patches()).toHaveLength(0);
    await press("Retry signed field-job status");
    expect(button(onLabel).nativeProps.disabled).toBe(false);
    await act(async () => { oldEnable(); }); expect(patches()).toHaveLength(0);
  });
  it("retry synchronously removes signed evidence before an old ON callback can run", async () => {
    await work(); const enable = button(onLabel); const retry = button("Retry signed field-job status");
    await act(async () => { retry.nativeProps.onPress(); enable.nativeProps.onPress(); });
    expect(patches()).toHaveLength(0);
  });
  it("reconciles a late PATCH after blur but never applies its ON to UI/context", async () => {
    await work(); patchWait = deferred<Response>(); await press(onLabel); const before = signedReads;
    mocks.focused = false; await render(); db.value = true;
    await act(async () => { patchWait!.resolve(response(raw())); });
    expect(signedReads).toBe(before + 1); expect(auth.session!.user.calendarEligible).toBe(false);
    expect(container.textContent).not.toContain("Server confirmed your"); expect(candidates.members).toEqual([]);
    mocks.focused = true; await render(); expect(container.textContent).toContain("ON · server TRUE");
  });
  it("preflight demotion prevents PATCH and postwrite demotion clears manager UI", async () => {
    await work(); db.role = "technician"; await press(onLabel); expect(patches()).toHaveLength(0);
    expect(button(onLabel).nativeProps.disabled).toBe(true);
    db.role = "owner"; await press("Retry signed field-job status");
    ackTransform = (raw) => { db.role = "technician"; return raw; };
    await press(onLabel); expect(auth.session!.user.role).toBe("technician");
    expect(container.textContent).not.toContain("Available for Field Jobs"); expect(container.textContent).not.toContain("Server confirmed your");
  });
  it("does not expose manager override controls to a technician", async () => {
    db.role = "technician"; await work(); expect(container.textContent).not.toContain("Available for Field Jobs"); expect(patches()).toHaveLength(0);
  });
});

describe("signed context and profile stale-result boundaries", () => {
  it("does not apply locally mutated callback data as signed profile evidence", async () => {
    await render(false); db.value = true;
    await act(async () => { await auth.refreshSession(auth.session!, { onVerified: (live) => {
      live.user.calendarEligible = false; live.token = "manufactured-token"; live.user.role = "technician";
    } }); });
    expect(auth.session!.user).toMatchObject({ role: "owner", calendarEligible: true });
    expect(auth.session!.token).toBe("fixture-only-token"); expect(mocks.storageSet).not.toHaveBeenCalled();
  });
  it("ignores an older signed read when a newer refresh has already applied", async () => {
    await render(false); const original = auth.session!; readWait = deferred<Response>(); const firstWait = readWait;
    let first!: Promise<JobSyncNativeSession>;
    await act(async () => { first = auth.refreshSession(original); });
    readWait = null; db.value = true;
    await act(async () => { await auth.refreshSession(original); });
    const old = raw(); old.user.calendarEligible = false;
    await act(async () => { firstWait.resolve(response(old)); await first; });
    expect(auth.session!.user.calendarEligible).toBe(true);
  });
  it("never applies pending-write evidence after the original 60-second lifetime expires", async () => {
    await work(); patchWait = deferred<Response>(); await press(onLabel);
    await act(async () => { vi.advanceTimersByTime(60_000); }); db.value = true;
    const before = signedReads;
    await act(async () => { patchWait!.resolve(response(raw())); });
    expect(signedReads).toBe(before + 1); expect(auth.session!.user.calendarEligible).toBe(false);
    expect(container.textContent).not.toContain("Server confirmed your"); expect(button(onLabel).nativeProps.disabled).toBe(true);
  });
  it("discards a pending save after an independent signed capability transition", async () => {
    await work(); patchWait = deferred<Response>(); await press(onLabel); db.value = true;
    await act(async () => { await auth.refreshSession(auth.session!); });
    await act(async () => { patchWait!.resolve(response(raw())); });
    expect(container.textContent).not.toContain("Server confirmed your"); expect(container.textContent).toContain("UNKNOWN");
    expect(button(onLabel).nativeProps.disabled).toBe(true);
    await press("Retry signed field-job status"); expect(container.textContent).toContain("ON · server TRUE");
  });
  it.each(["user", "company"])("refuses a changed %s identity in postwrite signed reconciliation", async (change) => {
    await work(); patchWait = deferred<Response>(); await press(onLabel);
    const ack = raw(); ack.user.calendarEligible = true;
    if (change === "user") db.userId = 43; else db.companyId = 10;
    await act(async () => { patchWait!.resolve(response(ack)); });
    expect(auth.session!.user).toMatchObject({ id: 42, calendarEligible: false });
    expect(auth.session!.company!.id).toBe(9); expect(container.textContent).toContain("UNKNOWN");
    expect(container.textContent).not.toContain("Server confirmed your");
  });
  it("newly restored bearer cannot receive a late old-token save or acknowledgment", async () => {
    await work(); patchWait = deferred<Response>(); await press(onLabel); const oldWait = patchWait;
    const originalAck = raw(); originalAck.user.calendarEligible = true;
    await act(async () => { root.unmount(); }); root = createRoot(container);
    mocks.storageGet.mockImplementation(async (key) => key === "hsc_jobsync_mobile_bearer_v1" ? "fixture-recreated-token" : null);
    patchWait = null; await work();
    await act(async () => { oldWait.resolve(response(originalAck)); });
    expect(auth.session!.token).toBe("fixture-recreated-token"); expect(auth.session!.user.calendarEligible).toBe(false);
    expect(container.textContent).not.toContain("Server confirmed your");
    const signedCalls = fetchMock.mock.calls.filter(([url]) => new URL(url).pathname.endsWith("/auth/session"));
    expect(signedCalls.at(-1)![1].headers.Authorization).toBe("Bearer fixture-only-token");
  });
});
