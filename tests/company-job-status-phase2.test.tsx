import React, { act } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyJobProgress } from "../components/company-job-progress";
import {
  companyFieldworkBlockReason, companyFieldworkErrorHint, companyJobActorBlockReason,
  createCompanyJobController, isAssignedCompanyFieldActor, type CompanyJobState, type CompanyJobTransport,
} from "../lib/company-job-fieldwork";
import { JobSyncApiError, normalizeJobSyncCompanyJobDetail, type JobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";

const lifecycle = vi.hoisted(() => ({ focused: true, alert: vi.fn() }));
vi.mock("expo-router", async () => {
  const R = await import("react");
  return { useIsFocused: () => lifecycle.focused, useFocusEffect: (effect: () => void | (() => void)) => {
    const focused = lifecycle.focused;
    R.useEffect(() => { if (focused) return effect(); }, [effect, focused]);
  } };
});
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, unknown>) => R.createElement(name, {
    ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
  }, props.children as React.ReactNode);
  return { Text: host("native-text"), View: host("native-view"), TouchableOpacity: host("native-touch"),
    ActivityIndicator: host("activity-indicator"), StyleSheet: { create: (styles: unknown) => styles }, Alert: { alert: lifecycle.alert } };
});
vi.mock("@/hooks/use-job-sheet-colors", () => ({ useJobSheetColors: () => ({
  primary: "#4D8DFF", muted: "#94A3B8", error: "#F06A6A", success: "#52D3B8", surface: "#1c2028", border: "#2e333c",
}) }));

function actor(role: JobSyncNativeSession["user"]["role"] = "technician", calendarEligible?: boolean | null): JobSyncNativeSession {
  return { token: "offline-phase2-status", portal: "company", user: { id: 41, role, calendarEligible, name: "Fixture", email: null },
    company: { id: 9, name: "Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } };
}
const version = "2026-11-16T12:00:00.000Z";
const freshVersion = "2026-11-16T12:01:00.000Z";
function detail(patch: Partial<JobSyncCompanyJobDetail> & { events?: unknown[] } = {}): JobSyncCompanyJobDetail {
  return normalizeJobSyncCompanyJobDetail({ job: { id: 47, companyId: 9, assignedUserId: 41, status: "scheduled", updatedAt: version,
    enRouteAt: null, onSiteAt: null, completedAt: null, photos: [], events: [], ...patch } }, patch.id ?? 47, patch.companyId ?? 9)!;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function setup(signed = actor(), overrides: Partial<CompanyJobTransport> = {}) {
  let state!: CompanyJobState;
  let current = true;
  const onList = vi.fn();
  const api: CompanyJobTransport = { session: vi.fn().mockResolvedValue(signed), detail: vi.fn().mockResolvedValue(detail()),
    status: vi.fn().mockResolvedValue({ success: true, status: "en_route" }), cancel: vi.fn(), list: vi.fn().mockResolvedValue([]), ...overrides };
  const controller = createCompanyJobController({ session: signed, jobId: 47, api, isCurrent: () => current, onState: (next) => { state = next; }, onList });
  return { controller, api, state: () => state, onList, leave: () => { current = false; } };
}

beforeEach(() => {
  lifecycle.focused = true; lifecycle.alert.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Real network prohibited in local status tests"); }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Phase 2 verified Company status authority", () => {
  it.each(["owner", "dispatcher"] as const)("allows %s for assigned, other-assigned and unassigned Jobs independent of calendar opt-in", async (role) => {
    for (const calendarEligible of [true, false, null, undefined]) for (const assignedUserId of [41, 42, null]) {
      const signed = actor(role, calendarEligible);
      const start = detail({ assignedUserId });
      expect(companyFieldworkBlockReason(signed, start)).toBeNull();
      const test = setup(signed, { detail: vi.fn().mockResolvedValueOnce(start).mockResolvedValueOnce({ ...start, updatedAt: freshVersion })
        .mockResolvedValueOnce({ ...start, status: "en_route", enRouteAt: freshVersion }) });
      await test.controller.refresh();
      expect(await test.controller.advance("en_route")).toBe(true);
      expect(test.api.status).toHaveBeenCalledWith(signed.token, 47, { status: "en_route", expectedUpdatedAt: freshVersion });
      expect(test.api.session).toHaveBeenCalledTimes(3);
    }
  });
  it("leaves calendar assignment eligibility separate from manager status permission", () => {
    const signed = actor("owner", false);
    expect(isAssignedCompanyFieldActor(signed, detail())).toBe(false);
    expect(companyFieldworkBlockReason(signed, detail({ assignedUserId: null }))).toBeNull();
  });
  it.each([41, 42, null, 0])("retains backend technician assignment restriction for assignee %s, without permission bypass", async (assignedUserId) => {
    const start = detail({ assignedUserId });
    const test = setup(actor("technician", false), { detail: vi.fn().mockResolvedValueOnce(start).mockResolvedValueOnce(start).mockResolvedValueOnce({ ...start, status: "en_route" }) });
    await test.controller.refresh();
    expect(await test.controller.advance("en_route")).toBe(assignedUserId === 41);
    expect(test.api.status).toHaveBeenCalledTimes(assignedUserId === 41 ? 1 : 0);
    if (assignedUserId !== 41) expect(test.state().error).toContain("backend permission change");
  });
  it.each(["developer", "sales", "customer_support", "operations"] as const)("denies non-Company role %s even with invented field opt-in", async (role) => {
    const test = setup(actor(role, true)); await test.controller.refresh();
    expect(await test.controller.advance("en_route")).toBe(false);
    expect(test.api.status).not.toHaveBeenCalled();
  });
  it.each(["Company", "portal", "token", "user", "role"])("requires matching fresh signed actor %s", async (change) => {
    const signed = actor("owner"); const fresh = actor("owner");
    if (change === "Company") fresh.company!.id = 10;
    if (change === "portal") fresh.portal = "platform";
    if (change === "token") fresh.token = "rotated";
    if (change === "user") fresh.user.id = 42;
    if (change === "role") fresh.user.role = "technician";
    expect(companyJobActorBlockReason(signed, fresh)).not.toBeNull();
    const test = setup(signed, { session: vi.fn().mockResolvedValueOnce(signed).mockResolvedValue(fresh) });
    await test.controller.refresh(); expect(await test.controller.advance("en_route")).toBe(false);
    expect(test.api.status).not.toHaveBeenCalled(); expect(test.state().detail).toBeNull();
  });
  it("denies cross-Company detail independently of manager assignment", async () => {
    expect(companyFieldworkBlockReason(actor("owner"), detail({ companyId: 10 }))).toContain("current Company's Job");
    const test = setup(actor("owner"), { detail: vi.fn().mockResolvedValue(detail({ companyId: 10 })) });
    await test.controller.refresh(); expect(await test.controller.advance("en_route")).toBe(false);
    expect(test.api.status).not.toHaveBeenCalled(); expect(test.onList).not.toHaveBeenCalled();
  });
});

describe("Phase 2 transitions, fresh readback and calendar callback", () => {
  it.each([
    { start: "scheduled", target: "en_route" }, { start: "en_route", target: "on_site" },
    { start: "on_site", target: "completed" }, { start: "follow_up", target: "completed" },
  ] as const)("preserves $start -> $target and canonical milestones/history/calendar callback", async ({ start, target }) => {
    const before = detail({ status: start });
    const after = detail({ status: target, enRouteAt: version, onSiteAt: freshVersion, completedAt: target === "completed" ? freshVersion : null,
      events: [{ type: "status_change", message: `Status updated to ${target}`, createdAt: freshVersion, actorUserId: 41, actorName: "Fixture" }] });
    const test = setup(actor(), { detail: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce({ ...before, updatedAt: freshVersion }).mockResolvedValue(after),
      status: vi.fn().mockResolvedValue({ success: true, status: target }), list: vi.fn().mockResolvedValue([after]) });
    await test.controller.refresh(); expect(await test.controller.advance(target)).toBe(true);
    expect(test.api.status).toHaveBeenCalledWith(actor().token, 47, { status: target, expectedUpdatedAt: freshVersion });
    expect(test.state().detail).toEqual(after); expect(test.onList).toHaveBeenCalledOnce(); expect(test.onList).toHaveBeenCalledWith([after]);
    expect(await test.controller.advance(target)).toBe(false); expect(test.api.status).toHaveBeenCalledOnce();
  });
  it.each(["draft", "completed", "cancelled", "unknown"])("blocks unsupported or terminal %s without writes", async (status) => {
    const test = setup(actor(), { detail: vi.fn().mockResolvedValue(detail({ status })) });
    await test.controller.refresh(); expect(await test.controller.advance("en_route")).toBe(false); expect(test.api.status).not.toHaveBeenCalled();
  });
  it("blocks skipped status targets and missing versions", async () => {
    const test = setup(); await test.controller.refresh();
    expect(await test.controller.advance("completed")).toBe(false); expect(test.api.status).not.toHaveBeenCalled();
    expect(companyFieldworkBlockReason(actor(), detail({ updatedAt: null }))).toContain("version");
  });
  it("uses a synchronous rapid-tap lock through fresh reads, write and readback", async () => {
    const fresh = deferred<JobSyncCompanyJobDetail>(); const ack = deferred<{ success: true; status: "en_route" }>();
    const readback = deferred<JobSyncCompanyJobDetail>();
    const test = setup(actor(), { detail: vi.fn().mockResolvedValueOnce(detail()).mockReturnValueOnce(fresh.promise).mockReturnValueOnce(readback.promise), status: vi.fn().mockReturnValue(ack.promise) });
    await test.controller.refresh(); const work = test.controller.advance("en_route");
    expect(await test.controller.advance("en_route")).toBe(false); expect(test.api.status).not.toHaveBeenCalled();
    fresh.resolve(detail({ updatedAt: freshVersion })); await vi.waitFor(() => expect(test.api.status).toHaveBeenCalledOnce());
    expect(await test.controller.advance("en_route")).toBe(false); ack.resolve({ success: true, status: "en_route" });
    await vi.waitFor(() => expect(test.api.list).toHaveBeenCalledOnce()); expect(test.state().success).toBeNull();
    expect(await test.controller.advance("en_route")).toBe(false);
    readback.resolve(detail({ status: "en_route" })); expect(await work).toBe(true);
    expect(test.api.status).toHaveBeenCalledOnce(); expect(test.onList).toHaveBeenCalledOnce();
  });
  it.each(["reassigned", "terminal", "wrong Job", "cross Company", "offline"])("fresh technician %s check fails closed before any write", async (change) => {
    const fresh = detail(); if (change === "reassigned") fresh.assignedUserId = 42;
    if (change === "terminal") fresh.status = "completed";
    if (change === "wrong Job") fresh.id = 48;
    if (change === "cross Company") fresh.companyId = 10;
    const read = vi.fn().mockResolvedValueOnce(detail());
    if (change === "offline") read.mockRejectedValue(new Error("offline")); else read.mockResolvedValue(fresh);
    const test = setup(actor(), { detail: read }); await test.controller.refresh();
    expect(await test.controller.advance("en_route")).toBe(false); expect(test.api.status).not.toHaveBeenCalled(); expect(test.state().success).toBeNull();
  });
  it.each(["fresh read", "write", "readback"])("discards late %s after scope leave, including calendar callbacks", async (phase) => {
    const wait = deferred<any>();
    const reads = vi.fn().mockResolvedValueOnce(detail());
    if (phase === "fresh read") reads.mockReturnValueOnce(wait.promise);
    else reads.mockResolvedValueOnce(detail());
    if (phase === "readback") reads.mockReturnValueOnce(wait.promise);
    const test = setup(actor(), { detail: reads, status: phase === "write" ? vi.fn().mockReturnValue(wait.promise) : vi.fn().mockResolvedValue({ success: true, status: "en_route" }) });
    await test.controller.refresh(); const work = test.controller.advance("en_route");
    if (phase !== "fresh read") await vi.waitFor(() => expect(test.api.status).toHaveBeenCalledOnce());
    if (phase === "readback") await vi.waitFor(() => expect(test.api.list).toHaveBeenCalledOnce());
    test.leave(); wait.resolve(phase === "write" ? { success: true, status: "en_route" } : detail({ status: "en_route" }));
    expect(await work).toBe(false); expect(test.onList).not.toHaveBeenCalled(); expect(test.state().success).toBeNull();
  });
  it.each([401, 403, 404, 409, 412, null])("reconciles backend status %s denial/ambiguity without false success or duplicate writes", async (status) => {
    const test = setup(actor(), { status: vi.fn().mockRejectedValue(new JobSyncApiError("Confidential fixture", status, status === null ? "TIMEOUT" : "DENIED")) });
    await test.controller.refresh(); expect(await test.controller.advance("en_route")).toBe(false);
    expect(test.api.status).toHaveBeenCalledOnce(); expect(test.api.detail).toHaveBeenCalledTimes(3);
    expect(test.onList).toHaveBeenCalledOnce(); expect(test.state().success).toBeNull();
    const hint = companyFieldworkErrorHint(test.state().error!);
    expect(hint).not.toContain("Confidential"); expect(hint).toMatch(/refresh/i);
  });
  it("never reports success when readback differs from acknowledgment", async () => {
    const test = setup(); await test.controller.refresh(); expect(await test.controller.advance("en_route")).toBe(false);
    expect(test.state().success).toBeNull(); expect(test.state().error).toContain("refreshed progress differs");
  });
});

// Inspect and execute only the exact production policy functions with offline injections.
// Backend service imports (payments, SQL pools, notification delivery) are never loaded.
function backendFunction(source: string, name: string, context: Record<string, unknown>) {
  const ast = ts.createSourceFile("backend.ts", source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  if (!node) throw new Error(`Missing pinned backend ${name}`);
  const code = ts.transpileModule(node.getText(ast).replace(/^export\s+/, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), `${code}; return ${name};`)(...Object.values(context));
}
describe("both pinned backend actual authority (read-only production function extraction)", () => {
  it.each(["002e0b8f", "a07b8077"])("checkpoint %s grants managers but denies unassigned technician via SQL scope", async (checkpoint) => {
    const base = `/home/ubuntu/hsc-mobile-four-repairs-20261116/backend-source-${checkpoint}/server/`;
    const contextSource = readFileSync(`${base}companyContext.ts`, "utf8");
    // Admin is a Company position, not an invented fourth canonical access role.
    expect(readFileSync(`${base}mobileAuth.ts`, "utf8")).toContain("'Admin', 'dispatcher', 0, 1, 5");
    const scope = backendFunction(contextSource, "technicianScopeSql", {});
    const permissions = backendFunction(contextSource, "permissionsForRole", { isManagerRole: (role: string) => role === "owner" || role === "dispatcher" });
    const lifecycleSource = readFileSync(`${base}jobLifecycle.ts`, "utf8");
    const assertTransition = backendFunction(lifecycleSource, "assertJobStatusTransition", { FIELD_TECH_STATUSES: ["en_route", "on_site", "completed", "follow_up"],
      isJobStatus: (status: string) => ["draft", "scheduled", "en_route", "on_site", "completed", "follow_up", "cancelled"].includes(status),
      JOB_STATUS_TRANSITIONS: { scheduled: ["en_route", "on_site", "completed", "follow_up", "cancelled"], completed: [] }, DomainError: JobSyncApiError });
    const routeSource = readFileSync(`${base}mobileOperations.ts`, "utf8");
    expect(routeSource).toContain("const result = await changeJobStatus(db, company, { jobId, ...input });");
    expect(routeSource).toContain('app.patch(`${BASE}/jobs/:jobId/status`, jobStatus)');
    for (const role of ["owner", "dispatcher", "technician"]) for (const assignedUserId of [41, 42, null]) {
      const company = { companyId: 9, userId: 41, role, permissions: permissions(role) };
      expect(company.permissions.canUpdateFieldStatus).toBe(true);
      const sql = vi.fn().mockResolvedValue([{ affectedRows: 1 }]); const event = vi.fn();
      const change = backendFunction(readFileSync(`${base}jobService.ts`, "utf8"), "changeJobStatus", {
        technicianScopeSql: scope, withTransaction: async (_db: unknown, work: (db: unknown) => unknown) => work({ execute: sql }),
        requireOwnedJob: async (_db: unknown, c: typeof company, _job: number, options: { extraClause: string; extraParams: number[] }) => {
          expect(c.companyId).toBe(9);
          if (options.extraClause && assignedUserId !== options.extraParams[0]) throw new Error("Job not found in this Company.");
          return { status: "scheduled", title: "Fixture" };
        }, assertJobStatusTransition: assertTransition, optimisticClause: () => " AND updated_at = ?", optimisticParams: () => [version],
        insertJobEvent: event, writeCompanyAuditLog: vi.fn(), notifyDispatchers: vi.fn(), DomainError: Error,
      });
      if (role === "technician" && assignedUserId !== 41) { await expect(change({}, company, { jobId: 47, status: "en_route", expectedUpdatedAt: version })).rejects.toThrow("Job not found"); expect(sql).not.toHaveBeenCalled(); }
      else { await expect(change({}, company, { jobId: 47, status: "en_route", expectedUpdatedAt: version })).resolves.toMatchObject({ success: true, status: "en_route" }); expect(sql).toHaveBeenCalledOnce(); expect(event).toHaveBeenCalledOnce(); }
    }
  });
});

type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
type Props = React.ComponentProps<typeof CompanyJobProgress>;
function progressJob(signed: JobSyncNativeSession, d = detail()): Props["job"] { return { detail: d, actor: signed, pending: false, loading: false, error: null, success: null,
  refresh: vi.fn().mockResolvedValue(undefined), advance: vi.fn().mockResolvedValue(true), cancelManagement: vi.fn(), verifiedPhotoDetail: null, acceptVerifiedDetail: vi.fn() }; }
describe("Phase 2 circular progress UI and signed confirmation lifecycle", () => {
  let root: ReturnType<typeof createRoot>; let container: PhotoTestNode;
  beforeEach(() => { const doc = installPhotoTestDOM(); container = doc.createElement("main"); doc.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); });
  function nodes(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => nodes(child))]; }
  function button(label: string) { const node = nodes().find((n) => n.nativeProps?.accessibilityLabel === label); if (!node) throw new Error(`Missing ${label}`); return node; }
  async function render(signed: JobSyncNativeSession, job: Props["job"], onRefresh?: Props["onRefresh"]) { await act(async () => root.render(<CompanyJobProgress session={signed} job={job} onRefresh={onRefresh} />)); }
  it.each(["owner", "dispatcher"] as const)("keeps unassigned %s ON MY WAY enabled with field opt-in OFF and the original labels", async (role) => {
    const signed = actor(role, false); const job = progressJob(signed, detail({ assignedUserId: null })); await render(signed, job);
    expect(button("ON MY WAY").nativeProps.disabled).toBe(false);
    expect(button("ARRIVED").nativeProps.disabled).toBe(true); expect(button("FINISH").nativeProps.disabled).toBe(true);
    await act(async () => button("ON MY WAY").nativeProps.onPress()); expect(job.advance).toHaveBeenCalledWith("en_route");
  });
  it("keeps denied unassigned technician controls safe with actionable backend/admin feedback", async () => {
    const signed = actor(); const job = progressJob(signed, detail({ assignedUserId: null })); await render(signed, job);
    expect(container.textContent).toContain("Backend requires assignment. Ask a Company admin to update.");
    await act(async () => button("ON MY WAY").nativeProps.onPress()); expect(job.advance).not.toHaveBeenCalled();
  });
  it("clarifies Arrived is Start in accessibility and confirmation, preserving the existing label", async () => {
    const signed = actor("owner", false); const job = progressJob(signed, detail({ status: "en_route", assignedUserId: null })); await render(signed, job);
    expect(button("ARRIVED").nativeProps.accessibilityHint).toContain("Start the Job");
    await act(async () => { button("ARRIVED").nativeProps.onPress(); button("ARRIVED").nativeProps.onPress(); });
    expect(lifecycle.alert).toHaveBeenCalledOnce(); expect(lifecycle.alert.mock.calls[0][1]).toContain("Arrived starts the Job");
    await act(async () => { lifecycle.alert.mock.calls[0][2][1].onPress(); lifecycle.alert.mock.calls[0][2][1].onPress(); });
    expect(job.advance).toHaveBeenCalledOnce(); expect(job.advance).toHaveBeenCalledWith("on_site");
  });
  it("invalidates confirmation when the fresh actor scope changes and returns without a detail change", async () => {
    const signed = actor("owner"); const job = progressJob(signed, detail({ status: "en_route" })); await render(signed, job);
    await act(async () => button("ARRIVED").nativeProps.onPress()); const stale = lifecycle.alert.mock.calls[0][2][1].onPress;
    await render(signed, { ...job, actor: { ...signed, token: "rotated" } }); await render(signed, job);
    await act(async () => stale()); expect(job.advance).not.toHaveBeenCalled();
  });
  it("rejects mismatched signed identity even when both managers could independently operate the same Job", async () => {
    const signed = actor("owner"); const job = { ...progressJob(signed), actor: { ...signed, user: { ...signed.user, id: 42 } } };
    await render(signed, job); expect(button("ON MY WAY").nativeProps.disabled).toBe(true);
    await act(async () => button("ON MY WAY").nativeProps.onPress()); expect(job.advance).not.toHaveBeenCalled();
  });
  it("renders safe denied/error feedback and delegates refresh to the current parent callback", async () => {
    const signed = actor(); const job = { ...progressJob(signed), error: "Company Job access denied. Confidential fixture details." };
    const onRefresh = vi.fn().mockResolvedValue(undefined); await render(signed, job, onRefresh);
    expect(container.textContent).toContain("Backend denied access. Ask a Company admin, then refresh."); expect(container.textContent).not.toContain("Confidential");
    await act(async () => button("Refresh job progress").nativeProps.onPress()); expect(onRefresh).toHaveBeenCalledOnce(); expect(job.refresh).not.toHaveBeenCalled();
  });
});
