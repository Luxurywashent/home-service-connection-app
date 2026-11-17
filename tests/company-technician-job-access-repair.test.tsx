import React, { act, useLayoutEffect } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyJobTags } from "../components/company-job-tags";
import { CompanyJobProgress } from "../components/company-job-progress";
import { useCompanyJob } from "../hooks/use-company-job";
import { useCompanyJobTags } from "../hooks/use-company-job-tags";
import {
  addJobSyncCompanyJobTag, removeJobSyncCompanyJobTag, getJobSyncCompanyJobDetail,
  getJobSyncCompanyJobTags, getJobSyncMobileSession, type JobSyncNativeSession,
} from "../lib/jobsync-mobile-api";
import { isAssignedCompanyFieldActor, isAssignedCompanyTechnician } from "../lib/company-job-fieldwork";

// Actual mobile call chain; only native hosts, auth/session and HTTP are isolated.
// Unexpected HTTP/legacy/provider operations fail closed. Never contacts a live server.
const lifecycle = vi.hoisted(() => ({
  focused: true, state: "active", listeners: new Set<(next: string) => void>(), alert: vi.fn(),
}));
vi.mock("expo-router", async () => {
  const R = await import("react");
  return {
    useIsFocused: () => lifecycle.focused,
    useFocusEffect: (callback: () => void | (() => void)) => R.useEffect(() => {
      if (lifecycle.focused) return callback();
    }, [callback, lifecycle.focused]),
  };
});
vi.mock("@/hooks/use-job-sheet-colors", () => ({ useJobSheetColors: () => ({
  background: "white", surface: "white", foreground: "black", muted: "gray",
  border: "gray", primary: "blue", error: "red", success: "green",
}) }));
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => R.createElement(name, {
    ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
  }, props.children);
  return {
    View: host("native-view"), Text: host("native-text"), TextInput: host("native-input"),
    TouchableOpacity: host("native-touch"), ActivityIndicator: host("native-loading"),
    StyleSheet: { create: (styles: unknown) => styles }, Alert: { alert: lifecycle.alert },
    AppState: {
      get currentState() { return lifecycle.state; },
      addEventListener: (_event: string, callback: (next: string) => void) => {
        lifecycle.listeners.add(callback); return { remove: () => lifecycle.listeners.delete(callback) };
      },
    },
  };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (node: unknown) => { render: (element: React.ReactNode) => void; unmount: () => void };
};
const tagsApi = {
  session: getJobSyncMobileSession, detail: getJobSyncCompanyJobDetail,
  list: getJobSyncCompanyJobTags, add: addJobSyncCompanyJobTag, remove: removeJobSyncCompanyJobTag,
};
const initialVersion = "2026-11-17T12:00:00.000Z";
const freshVersion = "2026-11-17T12:01:00.000Z";
function session(role: JobSyncNativeSession["user"]["role"] = "technician"): JobSyncNativeSession {
  return { token: "offline-technician-repair", portal: "company",
    user: { id: 41, role, name: "Fixture", email: null, calendarEligible: false, paymentCollectionEnabled: false },
    company: { id: 9, name: "Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } };
}
const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { "Content-Type": "application/json" },
});
let actor: JobSyncNativeSession;
let savedJob: Record<string, any>;
let savedTags: Record<string, any>[];
let liveActor: JobSyncNativeSession;
let fetchMock: ReturnType<typeof vi.fn>;
let sessionDenied: boolean;
let prewrite: (() => void) | null;
let current: boolean;
let epoch: string;
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let tags: ReturnType<typeof useCompanyJobTags>;
let progress: ReturnType<typeof useCompanyJob>;
const isCurrent = () => current;
const onList = vi.fn();
function Harness() {
  const committedTags = useCompanyJobTags(actor, 47, tagsApi, isCurrent, epoch);
  const committedProgress = useCompanyJob(actor, 47, onList, isCurrent, epoch);
  useLayoutEffect(() => { tags = committedTags; progress = committedProgress; });
  return <><CompanyJobTags session={actor} jobId={47} model={committedTags} isCurrent={isCurrent}
    operationScopeKey={epoch} variant="admin" />
    <CompanyJobProgress session={actor} job={committedProgress} /></>;
}
function nodes(node = container): NativeNode[] {
  return [node as NativeNode, ...node.childNodes.flatMap((child) => nodes(child))];
}
function find(label: string) { return nodes().find((node) => node.nativeProps?.accessibilityLabel === label)?.nativeProps; }
function button(label: string) { const result = find(label); if (!result) throw new Error(`Missing ${label}`); return result; }
async function render() { await act(async () => root.render(<Harness />)); }
async function press(label: string) { await act(async () => button(label).onPress()); }
function writes() { return fetchMock.mock.calls.filter(([, init]) => init.method !== "GET"); }
function changeAppState(next: string) {
  lifecycle.state = next; lifecycle.listeners.forEach((listener) => listener(next));
}
beforeEach(() => {
  lifecycle.focused = true; lifecycle.state = "active"; lifecycle.listeners.clear(); lifecycle.alert.mockReset();
  actor = session(); liveActor = actor; current = true; epoch = "repair-sheet-1";
  sessionDenied = false; prewrite = null; onList.mockReset(); savedTags = [];
  savedJob = { id: 47, companyId: 9, customerId: 70, assignedUserId: null, title: "Fixture Job", serviceName: "Fixture",
    customerName: "Fixture", assignedName: null, status: "scheduled", updatedAt: initialVersion,
    scheduledStartAt: "2026-11-17T13:00:00Z", scheduledEndAt: "2026-11-17T14:00:00Z",
    enRouteAt: null, onSiteAt: null, completedAt: null, photos: [] };
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${actor.token}`);
    if (path.endsWith("/auth/session")) {
      prewrite?.(); prewrite = null;
      return sessionDenied ? response({ error: { message: "Fixture inactive membership" } }, 401)
        : response({ accountType: liveActor.portal, user: liveActor.user, company: liveActor.company });
    }
    if (path === "/api/mobile/v1/jobs/47" && init.method === "GET") return response({ job: { ...savedJob } });
    if (path === "/api/mobile/v1/company/jobs" && init.method === "GET") return response({ jobs: [{ ...savedJob }] });
    if (path === "/api/mobile/v1/company/jobs/47/tags") {
      if (init.method === "GET") return response({ tags: savedTags.map((tag) => ({ ...tag })) });
      if (init.method === "POST") {
        const { name } = JSON.parse(init.body as string);
        const tag = { id: 31, jobId: 47, displayName: name, normalizedName: name.toLocaleLowerCase("en-US"),
          createdBy: 41, createdAt: initialVersion, updatedAt: null };
        savedTags.push(tag); return response({ tag }, 201);
      }
    }
    if (path === "/api/mobile/v1/company/jobs/47/tags/31" && init.method === "DELETE") {
      savedTags = []; return response({ success: true, jobId: 47, tagId: 31 });
    }
    if (path === "/api/mobile/v1/jobs/47/status" && init.method === "PATCH") {
      const input = JSON.parse(init.body as string);
      expect(input.expectedUpdatedAt).toBe(savedJob.updatedAt);
      savedJob = { ...savedJob, status: input.status, updatedAt: freshVersion };
      return response({ success: true, status: input.status });
    }
    throw new Error(`Unexpected offline HTTP boundary: ${init.method} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

const authorities = (["owner", "dispatcher", "technician"] as const).flatMap((role) =>
  [41, null, 99].map((assignedUserId) => ({ role, assignedUserId })));
describe("technician-access repair: actual Company tags/progress call chain", () => {
  it.each(authorities)("$role can tag and advance same-Company Job assigned to $assignedUserId", async ({ role, assignedUserId }) => {
    actor = session(role); liveActor = actor; savedJob.assignedUserId = assignedUserId;
    await render(); expect(tags.tags).toEqual([]); expect(button("ON MY WAY").disabled).toBe(false);
    await act(async () => button("New job tag").onChangeText("Priority")); await press("Add job tag");
    expect(tags.tags?.map((tag) => tag.displayName)).toEqual(["Priority"]);
    expect(tags.success).toContain("confirmed"); await press("Remove job tag Priority"); expect(tags.tags).toEqual([]);
    savedJob.updatedAt = freshVersion;
    await press("ON MY WAY"); expect(progress.detail?.status).toBe("en_route"); expect(progress.success).toContain("confirmed");
    await press("ARRIVED"); expect(lifecycle.alert).toHaveBeenCalledTimes(1);
    await act(async () => lifecycle.alert.mock.calls[0][2][1].onPress()); expect(progress.detail?.status).toBe("on_site");
    await press("FINISH"); expect(progress.detail?.status).toBe("completed"); expect(onList).toHaveBeenCalledTimes(3);
    const mutations = writes(); expect(mutations).toHaveLength(5);
    expect(mutations.filter(([url]) => new URL(url).pathname.endsWith("/status")).map(([, init]) => JSON.parse(init.body as string).status))
      .toEqual(["en_route", "on_site", "completed"]);
    expect(container.textContent).not.toMatch(/must be assigned|requires assignment|permission change/);
    // Expanded field authority must not turn calendar/assignment policy into broad permission.
    if (role === "technician") expect(isAssignedCompanyTechnician(actor, progress.detail!)).toBe(assignedUserId === 41);
    expect(isAssignedCompanyFieldActor(actor, progress.detail!)).toBe(role === "technician" && assignedUserId === 41);
    expect(fetchMock.mock.calls.some(([url]) => /photos|invoice|payments|trpc|timesheets|location/.test(new URL(url).pathname))).toBe(false);
  });

  it.each(["role", "tenant", "user", "inactive", "job"])("fresh %s revocation prevents both actual controller mutations", async (kind) => {
    await render();
    if (kind === "role") liveActor = { ...actor, user: { ...actor.user, role: "dispatcher" } };
    if (kind === "tenant") liveActor = { ...actor, company: { ...actor.company!, id: 10 } };
    if (kind === "user") liveActor = { ...actor, user: { ...actor.user, id: 42 } };
    if (kind === "inactive") sessionDenied = true;
    if (kind === "job") savedJob.id = 48;
    await act(async () => { expect(await tags.add("Denied")).toBe(false); expect(await progress.advance("en_route")).toBe(false); });
    expect(writes()).toHaveLength(0); expect(tags.tags).toBeNull(); expect(progress.detail).toBeNull();
  });
  it.each(["unsupported-role", "platform", "unsigned"])("%s cannot gain tags or field progress authority", async (kind) => {
    if (kind === "unsupported-role") actor = session("operations");
    if (kind === "platform") actor = { ...actor, portal: "platform" };
    if (kind === "unsigned") actor = { ...actor, token: "" };
    liveActor = actor; await render();
    await act(async () => { expect(await tags.add("Denied")).toBe(false); expect(await progress.advance("en_route")).toBe(false); });
    expect(writes()).toHaveLength(0); expect(tags.tags).toBeNull();
    for (const label of ["ON MY WAY", "ARRIVED", "FINISH"]) expect(button(label).disabled).toBe(true);
  });
  it.each(["completed", "cancelled", "draft", "unknown", "version", "tenant"])("fresh %s prevents progress without broadening lifecycle", async (kind) => {
    await render();
    if (kind === "version") savedJob.updatedAt = null;
    else if (kind === "tenant") savedJob.companyId = 10;
    else savedJob.status = kind;
    await act(async () => { expect(await progress.advance("en_route")).toBe(false); });
    expect(writes()).toHaveLength(0); expect(progress.success).toBeNull();
  });
  it.each(["blur", "background", "epoch", "signed-out"])("retained tag/progress callbacks fail after %s lifecycle change", async (kind) => {
    await render(); const oldAdd = tags.add; const oldAdvance = progress.advance;
    if (kind === "blur") { lifecycle.focused = false; await render(); lifecycle.focused = true; await render(); }
    if (kind === "background") await act(async () => { changeAppState("background"); changeAppState("active"); });
    if (kind === "epoch") { epoch = "repair-sheet-2"; await render(); }
    if (kind === "signed-out") { current = false; await render(); }
    await act(async () => { expect(await oldAdd("Stale")).toBe(false); expect(await oldAdvance("en_route")).toBe(false); });
    expect(writes()).toHaveLength(0);
  });
  it("synchronously rejects duplicate controller progress and tag calls during freshness", async () => {
    await render();
    await act(async () => {
      const first = tags.add("Priority"); expect(await tags.add("Other")).toBe(false); expect(await first).toBe(true);
      const advancing = progress.advance("en_route"); expect(await progress.advance("en_route")).toBe(false); expect(await advancing).toBe(true);
    });
    expect(writes()).toHaveLength(2);
  });
  it("invalidates during prewrite freshness without a mutation or stale success", async () => {
    await render(); prewrite = () => { current = false; };
    await act(async () => { expect(await tags.add("Stale")).toBe(false); expect(await progress.advance("en_route")).toBe(false); });
    expect(writes()).toHaveLength(0); expect(tags.success).toBeNull(); expect(progress.success).toBeNull();
  });
});

describe("read-only exact 66141 authority anchors, not a live backend claim", () => {
  const backend = "/home/ubuntu/hsc-mobile-release-readiness-20261117/backend-source-66141c98/server/";
  it("retains Company tenant predicates while deliberately omitting assignment in list/detail/status/tags", () => {
    const context = readFileSync(`${backend}companyContext.ts`, "utf8");
    const service = readFileSync(`${backend}jobService.ts`, "utf8");
    const tagService = readFileSync(`${backend}jobTagService.ts`, "utf8");
    expect(context).toContain('if (company.role !== "technician" || options.allowUnassigned) return { clause: "", params: [] as number[] };');
    expect(service.match(/technicianScopeSql\(company, \{ allowUnassigned: true \}\)/g)).toHaveLength(3);
    expect(service).toContain("WHERE j.id = ? AND j.company_id = ?${tech.clause}");
    expect(tagService).toContain("SELECT id FROM fs_jobs WHERE id = ? AND company_id = ? LIMIT 1");
    expect(tagService).not.toContain("assigned_user_id = ?");
  });
  it("active live membership and role are backend prerequisites, not assignment or calendar flags", () => {
    const auth = readFileSync(`${backend}mobileAuth.ts`, "utf8");
    expect(auth).toContain("cu.is_active = 1 AND c.workspace_status = 'active'");
    expect(auth).toContain("withLiveMembershipRole(claims, profile.user.role)");
  });
});
