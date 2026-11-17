import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import {
  companyJobTagsBlockReason, companyJobTagsSessionKey, createCompanyJobTagsController,
  emptyCompanyJobTagsState, normalizeCompanyJobTagName,
  type CompanyJobTag, type CompanyJobTagsController, type CompanyJobTagsState,
} from "../lib/company-job-tags";
import { useCompanyJobTags } from "../hooks/use-company-job-tags";
import { useCompanyJobOperation, useCompanyJobOperationEpoch } from "../hooks/use-company-job-operation";
import { JobSyncApiError, type JobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";

const lifecycle = vi.hoisted(() => ({
  focused: true, appState: { currentState: "active", addEventListener: vi.fn() }, listeners: new Set<(state: string) => void>(),
}));
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
vi.mock("react-native", () => ({ AppState: lifecycle.appState }));
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
let actorId = 800;
function session(role: JobSyncNativeSession["user"]["role"] = "owner"): JobSyncNativeSession {
  return { token: `mock-only-tags-${actorId}`, portal: "company", user: { id: actorId, role, name: "Fixture", email: null, calendarEligible: false, paymentCollectionEnabled: false },
    company: { id: 9, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } };
}
function detail(patch: Partial<JobSyncCompanyJobDetail> = {}): JobSyncCompanyJobDetail {
  return { id: 44, customerId: 70, companyId: 9, assignedUserId: actorId, title: "Fixture Job", serviceName: "Fixture", status: "completed",
    scheduledStartAt: null, scheduledEndAt: null, updatedAt: null, addressLine1: null, city: null, amount: 0, customerName: "Fixture", assignedName: null,
    enRouteAt: null, onSiteAt: null, completedAt: null, photos: [], ...patch };
}
function tag(id = 31, name = "Priority", jobId = 44): CompanyJobTag {
  return { id, jobId, ...normalizeCompanyJobTagName(name), createdBy: actorId, createdAt: "2026-11-17 12:00:00", updatedAt: null };
}
function fixture(initial: CompanyJobTag[] = []) {
  const saved = initial.map((item) => ({ ...item }));
  let nextId = 100;
  const api = {
    session: vi.fn(async () => session()), detail: vi.fn(async () => detail()),
    list: vi.fn(async () => saved.map((item) => ({ ...item }))),
    add: vi.fn(async (_token: string, jobId: number, input: { name: string }) => {
      const added = tag(nextId++, input.name, jobId); saved.push(added); return { ...added };
    }),
    remove: vi.fn(async (_token: string, jobId: number, tagId: number) => {
      const index = saved.findIndex((item) => item.id === tagId);
      if (index < 0) throw new JobSyncApiError("Mock missing tag", 404, "NOT_FOUND");
      saved.splice(index, 1); return { success: true as const, jobId, tagId };
    }),
  };
  return { saved, api };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const controllers: CompanyJobTagsController[] = [];
function makeController(f = fixture(), actor = session(), jobId = 44) {
  let state = { ...emptyCompanyJobTagsState };
  let current = true;
  const states: CompanyJobTagsState[] = [];
  const controller = createCompanyJobTagsController({ session: actor, jobId, api: f.api, isCurrent: () => current,
    onState: (next) => { state = next; states.push(next); } });
  controllers.push(controller);
  return { controller, get state() { return state; }, states, f, setCurrent: (next: boolean) => { current = next; } };
}
beforeEach(() => {
  actorId++;
  lifecycle.focused = true; lifecycle.appState.currentState = "active"; lifecycle.listeners.clear();
  lifecycle.appState.addEventListener.mockReset().mockImplementation((_event, listener) => {
    lifecycle.listeners.add(listener); return { remove: () => lifecycle.listeners.delete(listener) };
  });
  // Catch accidental transport fallback. Every operation in this file is dependency-injected.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live HTTP prohibited in tag controller tests"); }));
});
afterEach(() => { controllers.splice(0).forEach((controller) => controller.dispose()); vi.unstubAllGlobals(); });

describe("Company Job tag controller — isolated canonical contract", () => {
  it("normalizes exact NFKC/whitespace/case semantics and UTF-16 length", () => {
    expect(normalizeCompanyJobTagName("  ＰＲＩＯＲＩＴＹ\n \t Tag ")).toEqual({ displayName: "PRIORITY Tag", normalizedName: "priority tag" });
    expect(normalizeCompanyJobTagName("😀".repeat(32)).displayName.length).toBe(64);
    expect(() => normalizeCompanyJobTagName("😀".repeat(33))).toThrow("64");
  });
  it.each(["", "   ", "a\u0000b", "a\u007fb", "x".repeat(65)])("rejects invalid name %# without a transport write", async (name) => {
    const c = makeController(); await c.controller.refresh();
    expect(await c.controller.add(name)).toBe(false); expect(c.f.api.add).not.toHaveBeenCalled();
  });
  it.each(["owner", "dispatcher", "technician"] as const)("allows exact %s authority on terminal Jobs independent of calendar/payment/version", async (role) => {
    const f = fixture(); f.api.session.mockResolvedValue(session(role)); const c = makeController(f, session(role));
    await c.controller.refresh(); expect(c.state.tags).toEqual([]); expect(await c.controller.add("One")).toBe(true);
  });
  it.each([null, 999])("denies technician with assignee %s even if detail read succeeded", async (assignedUserId) => {
    const f = fixture(); f.api.session.mockResolvedValue(session("technician")); f.api.detail.mockResolvedValue(detail({ assignedUserId }));
    const c = makeController(f, session("technician")); await c.controller.refresh();
    expect(c.state.tags).toBeNull(); expect(await c.controller.add("One")).toBe(false); expect(f.api.add).not.toHaveBeenCalled();
  });
  it("rejects platform/unsupported roles and unsafe Job IDs without transport reads", async () => {
    const platform = session(); platform.portal = "platform";
    expect(companyJobTagsSessionKey(platform, 44)).toBeNull();
    expect(companyJobTagsSessionKey(session("operations"), 44)).toBeNull();
    expect(companyJobTagsSessionKey(session(), Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    const c = makeController(fixture(), platform); await c.controller.refresh();
    expect(c.f.api.list).not.toHaveBeenCalled(); expect(await c.controller.add("One")).toBe(false);
  });
  it.each(["token", "company", "user", "role", "portal"])("invalidates tags when live signed %s differs", async (change) => {
    const c = makeController(); await c.controller.refresh(); const changed = session();
    if (change === "token") changed.token = "mock-only-rotated";
    if (change === "company") changed.company = { ...changed.company!, id: 10 };
    if (change === "user") changed.user.id++;
    if (change === "role") changed.user.role = "dispatcher";
    if (change === "portal") changed.portal = "platform";
    c.f.api.session.mockResolvedValue(changed);
    expect(await c.controller.add("One")).toBe(false); expect(c.state.tags).toBeNull(); expect(c.f.api.add).not.toHaveBeenCalled();
  });
  it.each([{ id: 45 }, { companyId: 10 }])("denies wrong Job/tenant detail %# before write", async (patch) => {
    const c = makeController(); await c.controller.refresh(); c.f.api.detail.mockResolvedValue(detail(patch));
    expect(await c.controller.add("One")).toBe(false); expect(c.state.tags).toBeNull(); expect(c.f.api.add).not.toHaveBeenCalled();
  });
  it("rechecks assignment immediately before mutation and after acknowledgment", async () => {
    const f = fixture(); f.api.session.mockResolvedValue(session("technician")); const c = makeController(f, session("technician"));
    await c.controller.refresh(); f.api.detail.mockResolvedValue(detail({ assignedUserId: null }));
    expect(await c.controller.add("One")).toBe(false); expect(f.api.add).not.toHaveBeenCalled();
    f.api.detail.mockResolvedValue(detail()); await c.controller.refresh();
    f.api.add.mockImplementationOnce(async (_token, jobId, input) => {
      const added = tag(100, input.name, jobId); f.saved.push(added); f.api.detail.mockResolvedValue(detail({ assignedUserId: null })); return added;
    });
    expect(await c.controller.add("One")).toBe(false); expect(c.state.tags).toBeNull(); expect(c.state.reviewRequired).toBe(true);
  });
  it("preserves multiple canonical tags, server order and SQL/null timestamps; removes only one ID", async () => {
    const f = fixture([tag(3, "Zulu"), tag(1, "Alpha")]); const c = makeController(f); await c.controller.refresh();
    expect(c.state.tags?.map((item) => item.displayName)).toEqual(["Zulu", "Alpha"]);
    expect(await c.controller.add("  Ｎｅｗ\n Tag ")).toBe(true);
    expect(f.api.add).toHaveBeenCalledWith(session().token, 44, { name: "New Tag" });
    expect(await c.controller.remove(1)).toBe(true);
    expect(c.state.tags?.map((item) => item.id)).toEqual([3, 100]);
    expect(c.state.tags?.[0].createdAt).toBe("2026-11-17 12:00:00"); expect(c.state.tags?.[0].updatedAt).toBeNull();
    expect(f.api.remove).toHaveBeenCalledWith(session().token, 44, 1);
  });
  it("blocks repeated same-name add and stale/missing per-tag delete without writes", async () => {
    const c = makeController(fixture([tag()])); await c.controller.refresh();
    expect(await c.controller.add("PRIORITY")).toBe(false); expect(c.f.api.add).not.toHaveBeenCalled();
    expect(await c.controller.remove(999)).toBe(false); expect(c.f.api.remove).not.toHaveBeenCalled();
    expect(await c.controller.remove(31)).toBe(true); expect(await c.controller.remove(31)).toBe(false);
    expect(c.f.api.remove).toHaveBeenCalledTimes(1);
  });
  it("invalidates sibling in-flight canonical reads when a same-scope mutation starts", async () => {
    const f = fixture([tag()]); const first = makeController(f); const sibling = makeController(f);
    await first.controller.refresh(); await sibling.controller.refresh();
    const wait = deferred<CompanyJobTag[]>(); f.api.list.mockReturnValueOnce(wait.promise);
    const oldRead = sibling.controller.refresh();
    expect(await first.controller.remove(31)).toBe(true);
    wait.resolve([tag()]); await oldRead;
    expect(sibling.state.tags).toBeNull(); expect(await sibling.controller.remove(31)).toBe(false);
    expect(f.api.remove).toHaveBeenCalledTimes(1);
    await sibling.controller.refresh(); expect(sibling.state.tags).toEqual([]);
  });
  it.each([null, [tag(1), tag(1)], [tag(1, "One"), tag(2, "ONE")], [{ ...tag(), jobId: 99 }], [{ ...tag(), createdAt: undefined }], [{ ...tag(), id: Number.MAX_SAFE_INTEGER + 1 }]])("fails closed on malformed canonical collection %#", async (payload) => {
    const c = makeController(); c.f.api.list.mockResolvedValue(payload as CompanyJobTag[]); await c.controller.refresh();
    expect(c.state.tags).toBeNull(); expect(c.state.error).not.toBeNull(); expect(await c.controller.add("One")).toBe(false);
  });
  it("does not publish optimistic tags while awaiting acknowledgment", async () => {
    const c = makeController(); await c.controller.refresh(); const waiting = deferred<CompanyJobTag>(); c.f.api.add.mockReturnValueOnce(waiting.promise);
    const write = c.controller.add("One"); await Promise.resolve(); await Promise.resolve();
    expect(c.state.pending).toBe(true); expect(c.state.tags).toEqual([]); expect(c.state.success).toBeNull();
    c.f.saved.push(tag(100, "One")); waiting.resolve(tag(100, "One")); expect(await write).toBe(true); expect(c.state.tags).toEqual([tag(100, "One")]);
  });
  it.each([{ createdBy: 999 }, { jobId: 999 }, { displayName: "Wrong" }, { normalizedName: "wrong" }, { id: 0 }])("rejects malformed/mismatched add acknowledgment %# and reconciles GET only", async (patch) => {
    const c = makeController(); await c.controller.refresh(); c.f.api.add.mockResolvedValueOnce({ ...tag(100, "One"), ...patch });
    expect(await c.controller.add("One")).toBe(false); expect(c.state.reviewRequired).toBe(true); expect(c.state.success).toBeNull();
    expect(c.f.api.add).toHaveBeenCalledTimes(1); expect(c.f.api.list).toHaveBeenCalledTimes(3);
    expect(await c.controller.add("One")).toBe(false); expect(c.f.api.add).toHaveBeenCalledTimes(1);
  });
  it.each([{ success: false }, { tagId: 999 }, { jobId: 999 }, {}])("requires strict delete acknowledgment %# then canonical absence", async (patch) => {
    const c = makeController(fixture([tag()])); await c.controller.refresh();
    c.f.api.remove.mockResolvedValueOnce(patch as unknown as { success: true; jobId: number; tagId: number });
    expect(await c.controller.remove(31)).toBe(false); expect(c.state.reviewRequired).toBe(true); expect(c.state.tags).toEqual([tag()]);
    expect(c.f.api.remove).toHaveBeenCalledTimes(1);
  });
  it("does not report success from acknowledgment if canonical persisted state disagrees", async () => {
    const c = makeController(); await c.controller.refresh(); c.f.api.add.mockResolvedValueOnce(tag(100, "One"));
    expect(await c.controller.add("One")).toBe(false); expect(c.state.tags).toEqual([]); expect(c.state.success).toBeNull(); expect(c.state.reviewRequired).toBe(true);
  });
  it("invalidates controls when acknowledged write readback and reconciliation fail", async () => {
    const c = makeController(); await c.controller.refresh();
    c.f.api.add.mockImplementationOnce(async (_token, jobId, input) => { const added = tag(100, input.name, jobId); c.f.saved.push(added); c.f.api.list.mockRejectedValue(new Error("mock-only offline")); return added; });
    expect(await c.controller.add("One")).toBe(false); expect(c.state.tags).toBeNull(); expect(c.state.actor).toBeNull();
    expect(c.state.pending).toBe(false); expect(c.state.reviewRequired).toBe(true); expect(c.f.api.add).toHaveBeenCalledTimes(1);
  });
  it.each([401, 404, 409, 503, null])("reconciles uncertain write status %s, never resends; only explicit successful review clears barrier", async (status) => {
    const c = makeController(); await c.controller.refresh(); c.f.api.add.mockImplementationOnce(async (_token, jobId, input) => {
      c.f.saved.push(tag(90, input.name, jobId)); throw new JobSyncApiError("mock-only refusal", status, status === null ? "TIMEOUT" : "CONFLICT");
    });
    expect(await c.controller.add("One")).toBe(false); expect(c.state.tags).toEqual([tag(90, "One")]); expect(c.state.reviewRequired).toBe(true);
    await c.controller.refresh(); expect(c.state.reviewRequired).toBe(true);
    expect(await c.controller.add("Two")).toBe(false); expect(c.f.api.add).toHaveBeenCalledTimes(1);
    await c.controller.review(); expect(c.state.reviewRequired).toBe(false); expect(await c.controller.add("Two")).toBe(true);
  });
  it("holds one shared mutation across controllers/remount/token rotation until settlement", async () => {
    const f = fixture(); const old = makeController(f); await old.controller.refresh(); const wait = deferred<CompanyJobTag>(); f.api.add.mockReturnValueOnce(wait.promise);
    const first = old.controller.add("One"); await Promise.resolve(); await Promise.resolve();
    expect(await old.controller.add("Two")).toBe(false); old.controller.dispose();
    const rotated = session(); rotated.token = "mock-only-rotated"; const nextFixture = fixture(); nextFixture.api.session.mockResolvedValue(rotated);
    const next = makeController(nextFixture, rotated); await next.controller.refresh(); expect(next.state.pending).toBe(true); expect(await next.controller.add("Two")).toBe(false);
    wait.resolve(tag(100, "One")); expect(await first).toBe(false); expect(next.state.reviewRequired).toBe(true);
    await next.controller.refresh(); expect(await next.controller.add("Two")).toBe(false);
    await next.controller.review(); expect(await next.controller.add("Two")).toBe(true);
    expect(f.api.add).toHaveBeenCalledTimes(1); expect(nextFixture.api.add).toHaveBeenCalledTimes(1);
  });
  it("late freshness result cannot revive a controller after a false/true lifecycle return", async () => {
    const c = makeController(); await c.controller.refresh(); const wait = deferred<JobSyncNativeSession>(); c.f.api.session.mockReturnValueOnce(wait.promise);
    const write = c.controller.add("One"); c.setCurrent(false); expect(await c.controller.add("Two")).toBe(false); c.setCurrent(true);
    wait.resolve(session()); expect(await write).toBe(false); expect(c.f.api.add).not.toHaveBeenCalled();
  });
  it("deduplicates concurrent refreshes and ignores read results after dispose", async () => {
    const c = makeController(); const wait = deferred<CompanyJobTag[]>(); c.f.api.list.mockReturnValueOnce(wait.promise);
    const first = c.controller.refresh(); await c.controller.refresh(); expect(c.f.api.list).toHaveBeenCalledTimes(1);
    const count = c.states.length; c.controller.dispose(); wait.resolve([tag()]); await first; expect(c.states).toHaveLength(count);
  });
  it("policy does not infer assignment authority from broad detail success", () => {
    expect(companyJobTagsBlockReason(session("technician"), session("technician"), detail({ assignedUserId: 999 }), 44)).toContain("assigned technician");
  });
});

describe("Company Job tag hook — accessible controls and committed real React lifecycle", () => {
  let root: ReturnType<typeof createRoot>;
  let container: PhotoTestNode;
  let latest: ReturnType<typeof useCompanyJobTags>;
  let boundary: ReturnType<typeof useCompanyJobOperation>;
  let f: ReturnType<typeof fixture>;
  let open: boolean;
  const captureCurrent = () => { const capturedOpen = open; return () => capturedOpen && open; };
  type ControlNode = PhotoTestNode & { invoke?: () => unknown };
  function control(label: string, callback: () => unknown, disabled: boolean) {
    return <button aria-label={label} disabled={disabled} ref={(node) => { if (node) (node as unknown as ControlNode).invoke = callback; }}>{label}</button>;
  }
  function Harness({ actor = session(), jobId = 44, scope = "fixture-sheet" }: { actor?: JobSyncNativeSession | null; jobId?: number | null; scope?: string }) {
    const memory = useCompanyJobOperationEpoch();
    boundary = useCompanyJobOperation(scope, captureCurrent, memory);
    latest = useCompanyJobTags(actor, jobId, f.api, boundary.isCurrent, boundary.scopeKey);
    const disabled = latest.loading || latest.pending || latest.reviewRequired || latest.tags === null;
    return <section aria-label="Company Job tags"><div role="status">{latest.loading ? "Loading tags" : latest.tags === null ? "Tags unavailable" : latest.tags.map((item) => item.displayName).join(", ")}</div>
      {latest.error && <div role="alert">{latest.error}</div>}
      {control("Add tag", () => latest.add("One"), disabled)}
      {latest.tags?.map((item) => <React.Fragment key={item.id}>{control(`Remove tag ${item.displayName}`, () => latest.remove(item.id), disabled)}</React.Fragment>)}
      {control("Refresh tags", latest.refresh, latest.pending)}{control("Review refreshed tags", latest.review, latest.pending)}
    </section>;
  }
  async function render(props: React.ComponentProps<typeof Harness> = {}) { await act(async () => root.render(<Harness {...props} />)); }
  function nodes(node = container): ControlNode[] { return [node, ...node.childNodes.flatMap((child) => nodes(child))]; }
  function button(label: string) { const result = nodes().find((node) => node.attributes["aria-label"] === label); if (!result) throw new Error(`Missing accessible control ${label}`); return result; }
  async function press(label: string) { await act(async () => { await button(label).invoke?.(); }); }
  function appState(next: string) { lifecycle.appState.currentState = next; lifecycle.listeners.forEach((listener) => listener(next)); }
  beforeEach(() => {
    f = fixture([tag()]); open = true;
    const doc = installPhotoTestDOM(); container = doc.createElement("main"); doc.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); });
  it("loads canonical multiple tags and supports accessible individual removal/add feedback", async () => {
    await render(); expect(container.textContent).toContain("Priority"); expect(button("Remove tag Priority").attributes.disabled).toBeUndefined();
    await press("Add tag"); expect(latest.tags?.map((item) => item.displayName)).toEqual(["Priority", "One"]);
    await press("Remove tag Priority"); expect(latest.tags?.map((item) => item.displayName)).toEqual(["One"]); expect(latest.success).toContain("confirmed");
  });
  it("blocks repeated taps synchronously across ordinary rerenders without optimistic tags", async () => {
    await render(); const retainedAdd = latest.add; const wait = deferred<CompanyJobTag>(); f.api.add.mockReturnValueOnce(wait.promise);
    let first!: Promise<boolean>;
    await act(async () => { first = retainedAdd("One"); expect(await retainedAdd("One")).toBe(false); });
    await render(); expect(await latest.add("One")).toBe(false); expect(f.api.add).toHaveBeenCalledTimes(1);
    expect(latest.tags?.map((item) => item.displayName)).toEqual(["Priority"]); expect(latest.success).toBeNull();
    f.saved.push(tag(100, "One")); await act(async () => { wait.resolve(tag(100, "One")); });
    expect(await first).toBe(true); expect(latest.tags?.map((item) => item.displayName)).toEqual(["Priority", "One"]);
    await act(async () => { expect(await retainedAdd("One")).toBe(false); }); expect(f.api.add).toHaveBeenCalledTimes(1);
  });
  it.each(["token", "company", "user", "role", "Job", "blur"])("old retained callbacks do not dispatch after %s identity changes", async (change) => {
    await render(); const oldAdd = latest.add; const next = session(); let jobId = 44;
    if (change === "token") next.token = "mock-only-rotated";
    if (change === "company") next.company = { ...next.company!, id: 10 };
    if (change === "user") next.user.id++;
    if (change === "role") next.user.role = "dispatcher";
    if (change === "Job") jobId = 45;
    if (change === "blur") lifecycle.focused = false;
    f.api.session.mockResolvedValue(next); f.api.detail.mockResolvedValue(detail({ id: jobId, companyId: next.company!.id }));
    await render({ actor: next, jobId }); expect(await oldAdd("Two")).toBe(false); expect(f.api.add).not.toHaveBeenCalled();
  });
  it("batched background/active invalidates retained callbacks and late reads", async () => {
    await render(); const oldAdd = latest.add; const wait = deferred<CompanyJobTag[]>(); f.api.list.mockReturnValueOnce(wait.promise);
    let oldRead!: Promise<void>; await act(async () => { oldRead = latest.refresh(); });
    await act(async () => { appState("background"); appState("active"); });
    await act(async () => { wait.resolve([tag(999, "Stale")]); await oldRead; });
    expect(latest.tags).toEqual([tag()]); expect(await oldAdd("Two")).toBe(false); expect(f.api.add).not.toHaveBeenCalled();
  });
  it("blur/refocus cannot revive retained callback or delayed pre-write freshness", async () => {
    await render(); const oldAdd = latest.add; const wait = deferred<JobSyncNativeSession>(); f.api.session.mockReturnValueOnce(wait.promise);
    let first!: Promise<boolean>; await act(async () => { first = oldAdd("One"); });
    lifecycle.focused = false; await render(); expect(latest.tags).toBeNull(); lifecycle.focused = true; await render();
    await act(async () => { wait.resolve(session()); }); expect(await first).toBe(false); expect(await oldAdd("Two")).toBe(false); expect(f.api.add).not.toHaveBeenCalled();
  });
  it("same-Job sheet close/reopen epoch synchronously invalidates old actions", async () => {
    await render(); const oldAdd = latest.add;
    await act(async () => { open = false; boundary.invalidate(); open = true; });
    expect(await oldAdd("Two")).toBe(false); expect(f.api.add).not.toHaveBeenCalled();
    await press("Add tag"); expect(f.api.add).toHaveBeenCalledTimes(1);
  });
  it("keeps uncertain write barrier across real unmount/remount and exposes explicit review", async () => {
    await render(); const wait = deferred<CompanyJobTag>(); f.api.add.mockReturnValueOnce(wait.promise);
    let first!: Promise<boolean>; await act(async () => { first = latest.add("One"); });
    await act(async () => root.unmount()); root = createRoot(container); await render(); expect(latest.pending).toBe(true);
    await act(async () => { wait.resolve(tag(100, "One")); }); expect(await first).toBe(false); expect(latest.reviewRequired).toBe(true);
    await press("Refresh tags"); expect(latest.reviewRequired).toBe(true); expect(button("Add tag").attributes.disabled).toBeDefined();
    await press("Review refreshed tags"); expect(latest.reviewRequired).toBe(false); await press("Add tag"); expect(f.api.add).toHaveBeenCalledTimes(2);
  });
  it("does not access Company transport for null/legacy identity", async () => {
    await render({ actor: null }); expect(f.api.list).not.toHaveBeenCalled(); expect(latest.tags).toBeNull(); expect(await latest.add("One")).toBe(false);
  });
});
