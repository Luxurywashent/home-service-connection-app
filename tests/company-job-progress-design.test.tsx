import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyJobProgress } from "../components/company-job-progress";
import { normalizeJobSyncCompanyJobDetail, type JobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";

// Real ReactDOM effects/ref lifecycle, with RN hosts exposing the native callbacks.
// The fieldwork permission and duration helpers and job-sheet palette hook are not mocked.
const lifecycle = vi.hoisted(() => ({ focused: true, alert: vi.fn(), dark: true }));
vi.mock("expo-router", async () => {
  const R = await import("react");
  return {
    useIsFocused: () => lifecycle.focused,
    useFocusEffect: (effect: () => void | (() => void)) => {
      const focused = lifecycle.focused;
      R.useEffect(() => { if (focused) return effect(); }, [effect, focused]);
    },
  };
});
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, unknown>) => R.createElement(name, {
    ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
  }, props.children as React.ReactNode);
  return {
    ActivityIndicator: host("activity-indicator"), Text: host("native-text"),
    TouchableOpacity: host("native-touch"), View: host("native-view"),
    StyleSheet: { create: (styles: unknown) => styles }, Alert: { alert: lifecycle.alert },
  };
});
vi.mock("@/hooks/use-colors", () => ({
  useColors: () => ({
    primary: "#4D8DFF", foreground: "#F6F8FC", muted: "#94A3B8", error: "#F06A6A",
    background: lifecycle.dark ? "#07111F" : "#ffffff", surface: lifecycle.dark ? "#102038" : "#f5f5f5",
    border: lifecycle.dark ? "#243754" : "#E5E7EB", success: "#52D3B8",
  }),
}));
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
type Props = React.ComponentProps<typeof CompanyJobProgress>;
const labels = ["ON MY WAY", "ARRIVED", "FINISH"];
const icons = ["🚚", "▶️", "⏹️"];
const statusColors = ["#F59E0B", "#10B981", "#6B7280"];
const session = (role: JobSyncNativeSession["user"]["role"] = "technician", eligible?: boolean): JobSyncNativeSession => ({
  token: "offline-only-design-token", portal: "company",
  user: { id: 42, role, name: "Fixture", email: null, calendarEligible: eligible },
  company: { id: 9, name: "Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null },
});
function detail(patch: Partial<JobSyncCompanyJobDetail> = {}): JobSyncCompanyJobDetail {
  return normalizeJobSyncCompanyJobDetail({ job: {
    id: 12, companyId: 9, assignedUserId: 42, status: "scheduled", updatedAt: "2026-11-15T12:00:00Z",
    enRouteAt: null, onSiteAt: null, completedAt: null, photos: [], ...patch,
  } }, patch.id ?? 12, patch.companyId ?? 9)!;
}
function job(d = detail(), actor: JobSyncNativeSession | null = session()): Props["job"] {
  return {
    detail: d, actor, loading: false, pending: false, error: null, success: null,
    verifiedPhotoDetail: null, acceptVerifiedDetail: vi.fn().mockReturnValue(false),
    refresh: vi.fn().mockResolvedValue(undefined), advance: vi.fn().mockResolvedValue(true),
    cancelManagement: vi.fn().mockResolvedValue(false),
  };
}
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function nodes(name: string) { return all().filter((node) => node.nodeName.toLowerCase() === name); }
function button(label: string) {
  const found = nodes("native-touch").find((node) => node.nativeProps.accessibilityLabel === label || node.textContent === label);
  if (!found) throw new Error(`Missing ${label}; text=${container.textContent}`);
  return found;
}
function flatten(style: unknown): Record<string, any> {
  return Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : (style ?? {}) as Record<string, any>;
}
function circle(control: NativeNode) { return control.childNodes[0] as NativeNode; }
async function render(props: Partial<Props> = {}) {
  await act(async () => { root.render(<CompanyJobProgress session={session()} job={job()} {...props} />); });
}
async function tap(node: NativeNode) { await act(async () => { node.nativeProps.onPress(); }); }
function confirmed() { return lifecycle.alert.mock.calls.at(-1)![2][1].onPress as () => void; }
function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  lifecycle.focused = true; lifecycle.dark = true; lifecycle.alert.mockReset();
  const doc = installPhotoTestDOM(); container = doc.createElement("main"); doc.body.appendChild(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No real network allowed in design tests"); }));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe("restored circular Company progress design (real React, mocked RN hosts)", () => {
  it("uses an inline space-around row with exact 64px outlined circles, 22px icons and uppercase labels underneath", async () => {
    await render();
    expect(nodes("native-touch")).toHaveLength(3);
    const wrapper = flatten((container.childNodes[0] as NativeNode).nativeProps.style);
    expect(wrapper).toEqual({ gap: 8 });
    for (const forbidden of ["padding", "paddingVertical", "borderWidth", "borderTopWidth", "borderBottomWidth", "backgroundColor"]) expect(wrapper).not.toHaveProperty(forbidden);
    const row = container.childNodes[0].childNodes[0] as NativeNode;
    expect(flatten(row.nativeProps.style)).toEqual({ flexDirection: "row", justifyContent: "space-around", alignItems: "center" });
    labels.forEach((label, index) => {
      const control = button(label);
      expect(control.nativeProps.accessibilityRole).toBe("button");
      expect(control.childNodes).toHaveLength(2);
      expect(flatten(circle(control).nativeProps.style)).toMatchObject({
        width: 64, height: 64, borderRadius: 32, borderWidth: 2, marginBottom: 6,
        backgroundColor: "#1c2028", borderColor: "#2e333c",
      });
      const icon = circle(control).childNodes[0] as NativeNode;
      expect(icon.textContent).toBe(icons[index]);
      expect(flatten(icon.nativeProps.style)).toMatchObject({ fontSize: 22 });
      const caption = control.childNodes[1] as NativeNode;
      expect(caption.textContent).toBe(label);
      expect(flatten(caption.nativeProps.style)).toMatchObject({ fontSize: 9, fontWeight: "700", letterSpacing: 0.5, color: statusColors[index] });
    });
  });
  it("removes diagnostic headings, unconditional refresh, unknown milestones and server-time explanations", async () => {
    await render();
    expect(container.textContent).toBe(icons.map((icon, index) => icon + labels[index]).join(""));
    for (const text of ["Job Progress", "Backend status", "Unknown", "Refresh Job", "server time", "clock-in", "Drive Time", "Job Time"]) expect(container.textContent).not.toContain(text);
    expect(nodes("activity-indicator")).toHaveLength(0);
  });
  it.each(["en_route", "on_site", "completed"] as const)("uses original %s status color for the active circle", async (status) => {
    await render({ job: job(detail({ status })) });
    const index = ["en_route", "on_site", "completed"].indexOf(status);
    expect(flatten(circle(button(labels[index])).nativeProps.style)).toMatchObject({ backgroundColor: statusColors[index], borderColor: statusColors[index] });
  });
  it("leaves the existing light-mode theme surface and border unchanged", async () => {
    lifecycle.dark = false;
    await render();
    expect(flatten(circle(button("ON MY WAY")).nativeProps.style)).toMatchObject({ backgroundColor: "#f5f5f5", borderColor: "#E5E7EB" });
  });
  it.each(["technician", "owner", "dispatcher"] as const)("uses the same circles and sequential backend targets for an assigned eligible %s", async (role) => {
    const signed = session(role, true);
    const current = job(detail(), signed);
    await render({ session: signed, job: current });
    expect(labels.map((label) => button(label).nativeProps.disabled)).toEqual([false, true, true]);
    await tap(button("FINISH")); await tap(button("ARRIVED"));
    expect(current.advance).not.toHaveBeenCalled();
    await tap(button("ON MY WAY"));
    expect(current.advance).toHaveBeenLastCalledWith("en_route");
    await render({ session: signed, job: { ...current, detail: detail({ status: "en_route" }) } });
    expect(labels.map((label) => button(label).nativeProps.disabled)).toEqual([true, false, true]);
    await tap(button("ARRIVED"));
    expect(current.advance).toHaveBeenCalledTimes(1);
    await act(async () => confirmed()());
    expect(current.advance).toHaveBeenLastCalledWith("on_site");
    await render({ session: signed, job: { ...current, detail: detail({ status: "on_site" }) } });
    expect(labels.map((label) => button(label).nativeProps.disabled)).toEqual([true, true, false]);
    await tap(button("FINISH"));
    expect(current.advance).toHaveBeenLastCalledWith("completed");
    expect(current.cancelManagement).not.toHaveBeenCalled();
  });
  it("preserves follow_up to completed as the existing Finish target", async () => {
    const current = job(detail({ status: "follow_up" }));
    await render({ job: current }); await tap(button("FINISH"));
    expect(current.advance).toHaveBeenCalledWith("completed");
  });
});

describe("progress permissions, freshness and confirmation safeguards", () => {
  it.each(["signed out", "wrong portal", "blank token", "wrong Company", "unassigned technician", "other role", "actor mismatch", "missing actor", "missing version", "completed", "cancelled", "unknown status"])("disables all controls and rejects direct native callbacks for %s", async (change) => {
    let signed: JobSyncNativeSession | null = session();
    let current = job();
    if (change === "signed out") signed = null;
    if (change === "wrong portal") signed = { ...session(), portal: "platform" };
    if (change === "blank token") signed = { ...session(), token: " " };
    if (change === "wrong Company") current.detail = detail({ companyId: 10 });
    if (change === "unassigned technician") current.detail = detail({ assignedUserId: 43 });
    if (change === "other role") signed = session("developer");
    if (change === "actor mismatch") { signed = session("owner", true); current.actor = session("dispatcher", false); }
    if (change === "missing actor") current.actor = null;
    if (change === "missing version") current.detail = detail({ updatedAt: null });
    if (["completed", "cancelled", "unknown status"].includes(change)) current.detail = detail({ status: change === "unknown status" ? "draft" : change });
    await render({ session: signed, job: current });
    for (const label of labels) {
      expect(button(label).nativeProps.disabled).toBe(true);
      expect(button(label).nativeProps.accessibilityState).toEqual({ disabled: true });
      await tap(button(label));
    }
    expect(current.advance).not.toHaveBeenCalled();
    expect(lifecycle.alert).not.toHaveBeenCalled();
    const hint = nodes("native-text").find((node) => flatten(node.nativeProps.style).flex === 1)!;
    expect(hint.textContent.length).toBeLessThanOrEqual(65);
    expect(container.textContent).not.toMatch(/turn on|enable field|change role|management permissions|backend status/i);
  });
  it("opens one Arrived confirmation, preserves the location warning and allows only one confirmed dispatch", async () => {
    const current = job(detail({ status: "en_route" }));
    await render({ job: current });
    const arrived = button("ARRIVED");
    await act(async () => { arrived.nativeProps.onPress(); arrived.nativeProps.onPress(); });
    expect(lifecycle.alert).toHaveBeenCalledTimes(1);
    expect(lifecycle.alert.mock.calls[0][0]).toBe("Mark as Arrived?");
    expect(lifecycle.alert.mock.calls[0][1]).toContain("physically at the customer location");
    expect(current.advance).not.toHaveBeenCalled();
    await act(async () => { const confirm = confirmed(); confirm(); confirm(); });
    expect(current.advance).toHaveBeenCalledTimes(1);
    expect(current.advance).toHaveBeenCalledWith("on_site");
  });
  it.each(["cancel", "dismiss"])("permanently invalidates a retained confirmation after %s", async (action) => {
    const current = job(detail({ status: "en_route" }));
    await render({ job: current }); await tap(button("ARRIVED"));
    const old = confirmed();
    await act(async () => { if (action === "cancel") lifecycle.alert.mock.calls[0][2][0].onPress(); else lifecycle.alert.mock.calls[0][3].onDismiss(); old(); });
    expect(current.advance).not.toHaveBeenCalled();
    await tap(button("ARRIVED")); await act(async () => confirmed()());
    expect(current.advance).toHaveBeenCalledTimes(1);
    expect(current.advance).toHaveBeenCalledWith("on_site");
  });
  it("keeps a synchronous action lock while advance is unresolved", async () => {
    const wait = deferred();
    const current = job(); current.advance = vi.fn(() => wait.promise);
    await render({ job: current });
    const control = button("ON MY WAY");
    await act(async () => { control.nativeProps.onPress(); control.nativeProps.onPress(); });
    expect(current.advance).toHaveBeenCalledTimes(1);
    await tap(control); expect(current.advance).toHaveBeenCalledTimes(1);
    await act(async () => wait.resolve(true));
    await tap(control); expect(current.advance).toHaveBeenCalledTimes(2);
  });
  it.each(["Job", "Company", "token", "user", "role", "opt-out", "signed out", "actor OFF", "reassignment", "version", "status", "detail refresh", "loading", "pending", "blur", "unmount"])("denies stale Arrived confirmation after %s changes and the original scope returns", async (change) => {
    const originalSession = session("owner", true);
    const current = job(detail({ status: "en_route" }), originalSession);
    const originalProps = { session: originalSession, job: current };
    await render(originalProps); await tap(button("ARRIVED"));
    const oldConfirm = confirmed();
    const oldTap = button("ARRIVED").nativeProps.onPress;
    let signed: JobSyncNativeSession | null = { ...originalSession, user: { ...originalSession.user }, company: { ...originalSession.company! } };
    let changed = { ...current };
    if (change === "Job") changed.detail = detail({ id: 13, status: "en_route" });
    if (change === "Company") { signed.company!.id = 10; changed.detail = detail({ companyId: 10, status: "en_route" }); }
    if (change === "token") signed.token = "rotated-offline-token";
    if (change === "user") signed.user.id = 43;
    if (change === "role") signed.user.role = "dispatcher";
    if (change === "opt-out") signed.user.calendarEligible = false;
    if (change === "signed out") signed = null;
    if (change === "actor OFF") { changed.actor = session("owner", false); changed.detail = detail({ status: "en_route" }); }
    if (change === "reassignment") changed.detail = detail({ status: "en_route", assignedUserId: 43 });
    if (change === "version") changed.detail = detail({ status: "en_route", updatedAt: "2026-11-15T12:01:00Z" });
    if (change === "status") changed.detail = detail({ status: "on_site" });
    if (change === "detail refresh") changed.detail = detail({ status: "en_route" });
    if (change === "loading") changed.loading = true;
    if (change === "pending") changed.pending = true;
    if (change === "blur") lifecycle.focused = false;
    if (change === "unmount") await act(async () => root.render(<div />));
    else await render({ session: signed, job: changed });
    lifecycle.focused = true; await render(originalProps);
    await act(async () => { oldConfirm(); oldTap(); });
    expect(current.advance).not.toHaveBeenCalled();
    expect(lifecycle.alert).toHaveBeenCalledTimes(1);
    await tap(button("ARRIVED")); await act(async () => confirmed()());
    expect(current.advance).toHaveBeenCalledTimes(1);
    expect(current.advance).toHaveBeenCalledWith("on_site");
  });
});

describe("compact canonical durations and conditional feedback", () => {
  it.each([
    { name: "no timestamps", patch: {} },
    { name: "travel start only", patch: { enRouteAt: "2026-11-15T12:00:00Z" } },
    { name: "job start only", patch: { onSiteAt: "2026-11-15T12:10:00Z" } },
    { name: "finish only", patch: { completedAt: "2026-11-15T12:40:00Z" } },
    { name: "invalid timestamps", patch: { enRouteAt: "invalid", onSiteAt: "invalid", completedAt: "invalid" } },
    { name: "reversed timestamps", patch: { enRouteAt: "2026-11-15T12:40:00Z", onSiteAt: "2026-11-15T12:10:00Z", completedAt: "2026-11-15T12:00:00Z" } },
  ])("shows no unknown or fabricated zero durations with $name", async ({ patch }) => {
    await render({ job: job(detail(patch)) });
    expect(container.textContent).not.toMatch(/Drive Time|Job Time|Unknown|0 min|0:00|LIVE|server time/);
  });
  it("shows only a compact measured drive duration when arrival is present but finish is absent", async () => {
    await render({ job: job(detail({ enRouteAt: "2026-11-15T12:00:00Z", onSiteAt: "2026-11-15T12:10:00Z" })) });
    expect(container.textContent).toContain("Drive Time: 10 min");
    expect(container.textContent).not.toContain("Job Time");
    const duration = nodes("native-text").find((node) => node.textContent === "Drive Time: 10 min")!;
    expect(flatten(duration.nativeProps.style)).toMatchObject({ fontSize: 11, color: "#F59E0B" });
  });
  it("shows actual drive and job durations only from both canonical server timestamp pairs", async () => {
    await render({ timezone: "America/Chicago", job: job(detail({ enRouteAt: "2026-11-15T12:00:00Z", onSiteAt: "2026-11-15T12:10:00Z", completedAt: "2026-11-15T12:40:00Z" })) });
    expect(container.textContent).toContain("Drive Time: 10 minJob Time: 30 min");
    expect(container.textContent).not.toMatch(/Unknown|server time|Nov 15|2026-/);
  });
  it.each(["loading", "pending"] as const)("shows compact %s feedback and disables actions and refresh", async (flag) => {
    const current = { ...job(), [flag]: true };
    await render({ job: current });
    expect(nodes("activity-indicator")).toHaveLength(1);
    expect(container.textContent).toContain(flag === "loading" ? "Loading progress…" : "Updating progress…");
    for (const label of labels) { expect(button(label).nativeProps.disabled).toBe(true); await tap(button(label)); }
    expect(current.advance).not.toHaveBeenCalled();
    if (flag === "loading") { expect(button("Refresh job progress").nativeProps.disabled).toBe(true); await tap(button("Refresh job progress")); expect(current.refresh).not.toHaveBeenCalled(); }
    else expect(nodes("native-touch")).toHaveLength(3);
  });
  it("shows a short actionable block hint with only a small conditional Refresh control", async () => {
    const current = job(detail({ updatedAt: null }));
    await render({ job: current });
    expect(container.textContent).toContain("Refresh this job before updating progress.");
    const refresh = button("Refresh job progress");
    expect(refresh.textContent).toBe("Refresh");
    expect(flatten(refresh.nativeProps.style)).toEqual({ paddingVertical: 4, paddingHorizontal: 4 });
    await tap(refresh); expect(current.refresh).toHaveBeenCalledTimes(1);
  });
  it("keeps errors compact and delegates retry to the parent's scoped refresh", async () => {
    const current = { ...job(), error: "Long backend failure with confidential fixture details." };
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    await render({ job: current, onRefresh });
    const alert = nodes("native-text").find((node) => node.nativeProps.accessibilityRole === "alert")!;
    expect(alert.textContent).toBe("Progress could not be confirmed. Refresh to retry.");
    expect(container.textContent).not.toContain(current.error);
    await tap(button("Refresh job progress"));
    expect(onRefresh).toHaveBeenCalledTimes(1); expect(current.refresh).not.toHaveBeenCalled();
  });
  it("rejects an old refresh callback after token change even after returning to the original token", async () => {
    const current = { ...job(), error: "Offline fixture failure" };
    const original = session();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    await render({ session: original, job: current, onRefresh });
    const old = button("Refresh job progress").nativeProps.onPress;
    await render({ session: { ...original, token: "rotated" }, job: current, onRefresh });
    await render({ session: original, job: current, onRefresh });
    await act(async () => old()); expect(onRefresh).not.toHaveBeenCalled();
    await tap(button("Refresh job progress")); expect(onRefresh).toHaveBeenCalledTimes(1);
  });
  it("shows only compact confirmed success and never adds an always-on Refresh", async () => {
    await render({ job: { ...job(), success: "Job progress confirmed by the backend." } });
    expect(container.textContent).toContain("Progress updated.");
    expect(container.textContent).not.toContain("backend");
    expect(nodes("native-touch")).toHaveLength(3);
  });
});
