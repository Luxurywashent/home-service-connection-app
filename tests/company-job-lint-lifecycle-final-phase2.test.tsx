import React, { act } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { useCompanyJob } from "../hooks/use-company-job";
import { useCompanyJobOperation, useCompanyJobOperationEpoch } from "../hooks/use-company-job-operation";
import { CompanyJobPrivateNotes } from "../components/company-job-private-notes";
import { companyPhotoScope } from "../lib/company-photo-view";
import { normalizeJobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";

const native = vi.hoisted(() => ({ focused: true, state: "active", listeners: new Set<(state: string) => void>() }));
vi.mock("expo-router", async () => {
  const R = await import("react");
  return { useIsFocused: () => native.focused, useFocusEffect: (effect: () => void | (() => void)) => {
    R.useEffect(() => { if (native.focused) return effect(); }, [effect, native.focused]);
  } };
});
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => R.createElement(name, null, props.children);
  return { AppState: { get currentState() { return native.state; }, addEventListener: (_name: string, callback: (state: string) => void) => {
    native.listeners.add(callback); return { remove: () => native.listeners.delete(callback) };
  } }, View: host("native-view"), Text: host("native-text"), TouchableOpacity: host("native-touch"),
  ActivityIndicator: host("native-spinner"), StyleSheet: { create: (styles: unknown) => styles } };
});
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ foreground: "white", muted: "gray", primary: "blue", background: "black", border: "gray", error: "red" }) }));
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
const actor: JobSyncNativeSession = { token: "offline-only-lint-lifecycle-token", portal: "company",
  user: { id: 42, role: "dispatcher", name: "Fixture", email: null, calendarEligible: false },
  company: { id: 9, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } };
const photo = { id: 5, imageUrl: "https://fixture.invalid/photo?signature=offline", caption: null, uploadedByUserId: 42, createdAt: null };
const wire = (patch: Record<string, unknown> = {}) => ({ id: 12, companyId: 9, assignedUserId: 99,
  status: "scheduled", updatedAt: "2026-11-17T03:00:00Z", photos: [photo], private_notes: "Private fixture only", ...patch });
const response = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
let root: ReturnType<typeof createRoot>; let container: PhotoTestNode;
let latest: ReturnType<typeof useCompanyJob>; let operation: ReturnType<typeof useCompanyJobOperation>;
let parentGeneration: number; let parentCurrent: boolean; let reads: number;
let fetchMock: ReturnType<typeof vi.fn>; let onList: ReturnType<typeof vi.fn>;
let jobWire: ReturnType<typeof wire>; let gate: ReturnType<typeof deferred<ReturnType<typeof response>>> | null;
const never = new Promise<never>(() => {});
function Harness({ session = actor, jobId = 12, scope = "sheet", suspended = false }: {
  session?: JobSyncNativeSession | null; jobId?: number | null; scope?: string; suspended?: boolean;
}) {
  const memory = useCompanyJobOperationEpoch();
  const guard = useCompanyJobOperation(scope, () => {
    const captured = parentGeneration;
    return () => parentCurrent && captured === parentGeneration;
  }, memory);
  const job = useCompanyJob(session, jobId, onList, guard.isCurrent, guard.scopeKey);
  React.useLayoutEffect(() => { latest = job; operation = guard; });
  if (suspended) throw never;
  return <CompanyJobPrivateNotes session={session} jobId={jobId} job={job} isCurrent={guard.isCurrent} />;
}
async function render(props: React.ComponentProps<typeof Harness> = {}, strict = false, transition = false) {
  const view = <React.Suspense fallback={<div>Suspended fixture</div>}><Harness {...props} /></React.Suspense>;
  await act(async () => {
    const update = () => root.render(strict ? <React.StrictMode>{view}</React.StrictMode> : view);
    if (transition) React.startTransition(update); else update();
  });
}
function lifecycle(state: string) { native.state = state; native.listeners.forEach((listener) => listener(state)); }
function writes() { return fetchMock.mock.calls.filter(([, init]) => init.method === "PATCH"); }
const verified = () => normalizeJobSyncCompanyJobDetail({ job: jobWire }, 12, 9)!;
beforeEach(() => {
  native.focused = true; native.state = "active"; native.listeners.clear(); parentGeneration = 0; parentCurrent = true;
  reads = 0; gate = null; onList = vi.fn(); jobWire = wire();
  const doc = installPhotoTestDOM(); container = doc.createElement("main"); doc.body.appendChild(container); root = createRoot(container);
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/api/mobile/v1/auth/session" && init.method === "GET") return response(actor);
    if (path === "/api/mobile/v1/jobs/12" && init.method === "GET") {
      reads++; if (reads === 2 && gate) return gate.promise; return response({ job: jobWire });
    }
    if (path === "/api/mobile/v1/jobs/12/status" && init.method === "PATCH") {
      jobWire = wire({ status: JSON.parse(init.body as string).status }); return response({ success: true, status: jobWire.status });
    }
    if (path === "/api/mobile/v1/company/jobs" && init.method === "GET") return response({ jobs: [jobWire] });
    throw new Error(`Unexpected explicit offline fixture request: ${init.method} ${path}`);
  }); vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe("final Phase2 lint lifecycle repairs — real React and explicit offline transport only", () => {
  it("invalidates old status and verified-photo handoff synchronously before a batched same-Job close/reopen commit", async () => {
    await render(); const old = latest; const oldGuard = operation.isCurrent; const detail = verified();
    await act(async () => {
      operation.invalidate(); operation.invalidate();
      expect(oldGuard()).toBe(false);
      expect(old.acceptVerifiedDetail(detail, companyPhotoScope(actor, 12)!)).toBe(false);
      expect(await old.advance("en_route")).toBe(false);
    });
    expect(writes()).toHaveLength(0); expect(operation.isCurrent()).toBe(true);
    await act(async () => { expect(await latest.advance("en_route")).toBe(true); });
    expect(writes()).toHaveLength(1); expect(onList).toHaveBeenCalledOnce();
    expect(latest.detail?.status).toBe("en_route"); expect(onList.mock.calls[0][0][0]).not.toHaveProperty("privateNotes");
  });
  it("does not rebind a retained parent generation on an unrelated committed render", async () => {
    await render(); const old = latest; parentGeneration++;
    await render(); expect(operation.isCurrent()).toBe(false);
    await act(async () => { expect(await old.advance("en_route")).toBe(false); });
    expect(writes()).toHaveLength(0); expect(old.acceptVerifiedDetail(verified(), companyPhotoScope(actor, 12)!)).toBe(false);
    await render({ scope: "new-parent-generation" }); expect(operation.isCurrent()).toBe(true);
  });
  it("invalidates an in-flight fresh read before PATCH when the sheet epoch changes", async () => {
    await render(); gate = deferred(); let attempt!: Promise<boolean>;
    await act(async () => { attempt = latest.advance("en_route"); }); expect(reads).toBe(2);
    await act(async () => { operation.invalidate(); });
    await act(async () => { gate!.resolve(response({ job: jobWire })); expect(await attempt).toBe(false); });
    expect(writes()).toHaveLength(0); expect(onList).not.toHaveBeenCalled(); expect(latest.success).toBeNull();
  });
  it("invalidates status and photo callbacks inside a batched background/active event before rerender", async () => {
    await render(); const old = latest;
    await act(async () => {
      lifecycle("background"); lifecycle("active");
      expect(old.acceptVerifiedDetail(verified(), companyPhotoScope(actor, 12)!)).toBe(false);
      expect(await old.advance("en_route")).toBe(false);
    });
    expect(writes()).toHaveLength(0); expect(latest.detail?.id).toBe(12);
  });
  it("hides internal snapshots while backgrounded and after closing the sheet", async () => {
    await render(); expect(container.textContent).toContain("Private fixture only");
    await act(async () => lifecycle("background")); expect(latest.detail).toBeNull(); expect(latest.verifiedPhotoDetail).toBeNull(); expect(container.textContent).toBe("");
    await act(async () => lifecycle("active")); expect(container.textContent).toContain("Private fixture only");
    await render({ jobId: null }); expect(latest.detail).toBeNull(); expect(container.textContent).toBe("");
  });
  it.each(["token", "Company", "user", "role", "calendar", "Job", "sheet", "blur"])("permanently rejects retained operations after %s changes and the original values return", async (change) => {
    await render(); const old = latest; const signed = { ...actor, user: { ...actor.user }, company: { ...actor.company! } };
    if (change === "token") signed.token = "rotated-offline-token";
    if (change === "Company") signed.company.id = 10;
    if (change === "user") signed.user.id = 99;
    if (change === "role") signed.user.role = "owner";
    if (change === "calendar") signed.user.calendarEligible = true;
    if (change === "blur") native.focused = false;
    await render({ session: signed, jobId: change === "Job" ? null : 12, scope: change === "sheet" ? "reopened" : "sheet" });
    native.focused = true; await render();
    await act(async () => { expect(await old.advance("en_route")).toBe(false); });
    expect(old.acceptVerifiedDetail(verified(), companyPhotoScope(actor, 12)!)).toBe(false); expect(writes()).toHaveLength(0);
  });
  it("does not publish the identity or controller of an abandoned suspended render", async () => {
    await render(); const old = latest; const committed = operation; const calls = fetchMock.mock.calls.length;
    await render({ scope: "never-committed", suspended: true }, false, true);
    expect(operation).toBe(committed); expect(committed.isCurrent()).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(calls);
    await render(); expect(operation.isCurrent()).toBe(true);
    await act(async () => { expect(await latest.advance("en_route")).toBe(true); }); expect(writes()).toHaveLength(1);
    expect(old.success).toBeNull();
  });
  it("keeps StrictMode cleanup/remount functional without duplicate writes", async () => {
    await render({}, true); expect(latest.detail?.id).toBe(12); let attempts!: boolean[];
    await act(async () => { attempts = await Promise.all([latest.advance("en_route"), latest.advance("en_route")]); });
    expect(attempts).toEqual([true, false]); expect(writes()).toHaveLength(1);
  });
  it("rejects an old photo handoff synchronously when a newer canonical refresh starts", async () => {
    await render(); const old = latest; const full = verified();
    await act(async () => {
      const refresh = latest.refresh();
      expect(old.acceptVerifiedDetail(full, companyPhotoScope(actor, 12)!)).toBe(false);
      await refresh;
    }); expect(latest.verifiedPhotoDetail).toBeNull(); expect(writes()).toHaveLength(0);
  });
  it("mounts the same operation helper in both existing schedules with synchronous sheet/focus invalidation", () => {
    for (const name of ["schedule", "admin-schedule"]) {
      const source = readFileSync(new URL(`../app/(tabs)/${name}.tsx`, import.meta.url), "utf8");
      expect(source).toContain("useCompanyJobOperationEpoch()");
      expect(source).toContain("invalidateCompanyJobOperation();");
      expect(source).toContain("}, isCurrentCompanyJobOperation, companyJobOperationScope)");
      expect(source).not.toContain("const statusSheetEpoch = sheetEpochRef.current");
      expect(source).not.toContain("const statusManagementGeneration = managementActionRef.current");
    }
  });
});
