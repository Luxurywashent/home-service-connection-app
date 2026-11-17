import React, { act } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { useCompanyJob } from "../hooks/use-company-job";
import { CompanyJobPrivateNotes } from "../components/company-job-private-notes";
import { companyPhotoScope } from "../lib/company-photo-view";
import { normalizeJobSyncCompanyJobDetail, getJobSyncCompanyJobs, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";

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
const actor: JobSyncNativeSession = { token: "offline-only-repairs-token", portal: "company",
  user: { id: 42, role: "dispatcher", name: "Admin", email: null, calendarEligible: false },
  company: { id: 9, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } };
const wire = (patch: Record<string, unknown> = {}) => ({ id: 12, companyId: 9, assignedUserId: 99,
  status: "scheduled", updatedAt: "2026-11-17T03:00:00Z", photos: [],
  private_notes: "Internal private note", notes: "Customer-visible service note", ...patch });
const response = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
let root: ReturnType<typeof createRoot>; let container: PhotoTestNode; let latest: ReturnType<typeof useCompanyJob>;
let jobWire: ReturnType<typeof wire>; let reads: number; let gate: ReturnType<typeof deferred<ReturnType<typeof response>>> | null;
let fetchMock: ReturnType<typeof vi.fn>; let onList: ReturnType<typeof vi.fn>;
function Harness({ jobId = 12, epoch = "first", current = () => true }: { jobId?: number | null; epoch?: string; current?: () => boolean }) {
  const job = useCompanyJob(actor, jobId, onList, current, epoch);
  React.useLayoutEffect(() => { latest = job; });
  return <CompanyJobPrivateNotes session={actor} jobId={jobId} job={job} isCurrent={current} />;
}
async function render(jobId: number | null = 12, epoch = "first", current: () => boolean = () => true) {
  await act(async () => root.render(<Harness jobId={jobId} epoch={epoch} current={current} />));
}
function lifecycle(state: string) { native.state = state; native.listeners.forEach((listener) => listener(state)); }
function writes() { return fetchMock.mock.calls.filter(([, init]) => init.method === "PATCH"); }
beforeEach(() => {
  native.focused = true; native.state = "active"; native.listeners.clear(); reads = 0; gate = null; jobWire = wire(); onList = vi.fn();
  const doc = installPhotoTestDOM(); container = doc.createElement("main"); doc.body.appendChild(container); root = createRoot(container);
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/api/mobile/v1/auth/session" && init.method === "GET") return response(actor);
    if (path === "/api/mobile/v1/jobs/12" && init.method === "GET") { reads++; if (reads === 2 && gate) return gate.promise; return response({ job: jobWire }); }
    if (path === "/api/mobile/v1/jobs/12/status" && init.method === "PATCH") {
      jobWire = wire({ status: JSON.parse(init.body as string).status }); return response({ success: true, status: jobWire.status });
    }
    if (path === "/api/mobile/v1/company/jobs" && init.method === "GET") return response({ jobs: [jobWire] });
    throw new Error(`Unexpected mocked request ${init.method} ${path}`);
  }); vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe("connected Phase 2 Company detail integration — only mocked transport", () => {
  it("projects persisted private notes into internal detail without adding them to calendar/list DTOs", async () => {
    await render(); expect(container.textContent).toContain("Internal private note");
    expect(container.textContent).not.toContain("Customer-visible service note");
    expect(latest.detail?.privateNotes).toBe("Internal private note");
    expect((await getJobSyncCompanyJobs(actor.token))[0]).not.toHaveProperty("privateNotes");
    expect(normalizeJobSyncCompanyJobDetail({ job: wire({ private_notes: undefined }) }, 12, 9)?.privateNotes).toBeUndefined();
  });
  it("preserves exact private text and rejects contradictory private storage aliases", () => {
    expect(normalizeJobSyncCompanyJobDetail({ job: wire({ private_notes: "  Exact note\n " }) }, 12, 9)?.privateNotes).toBe("  Exact note\n ");
    expect(normalizeJobSyncCompanyJobDetail({ job: wire({ internal_notes: "Different private note" }) }, 12, 9)?.privateNotes).toBeUndefined();
  });
  it("lets a verified unassigned Admin-position dispatcher advance once and refreshes the canonical calendar", async () => {
    await render(); await act(async () => { expect(await latest.advance("en_route")).toBe(true); });
    expect(writes()).toHaveLength(1); expect(latest.detail?.status).toBe("en_route"); expect(latest.success).toContain("confirmed");
    expect(onList).toHaveBeenCalledOnce(); expect(onList.mock.calls[0][0][0]).not.toHaveProperty("privateNotes");
  });
  it("invalidates a pre-PATCH fresh read synchronously on background even when foreground is batched", async () => {
    await render(); gate = deferred(); let attempt!: Promise<boolean>;
    await act(async () => { attempt = latest.advance("en_route"); }); expect(reads).toBe(2);
    await act(async () => { lifecycle("background"); lifecycle("active"); });
    await act(async () => { gate!.resolve(response({ job: jobWire })); expect(await attempt).toBe(false); });
    expect(writes()).toHaveLength(0); expect(onList).not.toHaveBeenCalled(); expect(latest.success).toBeNull();
  });
  it("rejects retained status and photo handoff callbacks after a same-Job sheet epoch changes", async () => {
    await render(); const old = latest; await render(12, "reopened");
    await act(async () => { expect(await old.advance("en_route")).toBe(false); });
    expect(old.acceptVerifiedDetail(latest.detail!, companyPhotoScope(actor, 12)!)).toBe(false); expect(writes()).toHaveLength(0);
  });
  it("rejects old status callbacks after close and reopen of the same Job", async () => {
    await render(); const old = latest.advance; await render(null); await render(12);
    await act(async () => { expect(await old("en_route")).toBe(false); }); expect(writes()).toHaveLength(0);
  });
  it("rejects old status callbacks after blur/refocus and hides notes while unfocused", async () => {
    await render(); const old = latest.advance; native.focused = false; await render(); expect(container.textContent).toBe("");
    native.focused = true; await render(); await act(async () => { expect(await old("en_route")).toBe(false); }); expect(writes()).toHaveLength(0);
  });
  it("does not publish old status/readback while the captured parent sheet guard is invalid", async () => {
    let current = true; await render(12, "guarded", () => current); const old = latest.advance; current = false;
    await act(async () => { expect(await old("en_route")).toBe(false); }); expect(writes()).toHaveLength(0);
  });
  it("mounts the internal card in both existing note slots and keeps Company tag mutation isolation", () => {
    const tech = readFileSync(new URL("../app/(tabs)/schedule.tsx", import.meta.url), "utf8");
    const admin = readFileSync(new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url), "utf8");
    for (const screen of [tech, admin]) {
      expect(screen).toContain("if (companyJobMode) return <CompanyJobPrivateNotes");
      expect(screen).toContain("<CompanyJobKeyboardBoundary"); expect(screen).toContain("onFocus={detailInputFocus}");
      expect(screen).toContain("automaticallyAdjustKeyboardInsets={false} keyboardShouldPersistTaps=\"handled\"");
      expect(screen).toContain("isCurrentCompanyJobOperation");
    }
    expect(tech).toContain("!companyJobMode && <View ref={detailTagRef}");
    expect(admin).toContain("job.companyId !== undefined");
  });
});
