import React, { act, useCallback, useLayoutEffect, useState } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyJobTags } from "../components/company-job-tags";
import { useCompanyJobTags } from "../hooks/use-company-job-tags";
import { useCompanyJobOperation, useCompanyJobOperationEpoch } from "../hooks/use-company-job-operation";
import { createJobSyncCompanyJobTagPayload, normalizeJobSyncCompanyJobTags, normalizeJobSyncCompanyJobTagCreateAcknowledgment,
  normalizeJobSyncCompanyJobTagDeleteAcknowledgment, getJobSyncCompanyJobTags, addJobSyncCompanyJobTag, removeJobSyncCompanyJobTag,
  getJobSyncMobileSession, getJobSyncCompanyJobDetail, JobSyncApiError, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";
import type { CompanyJobTagsTransport } from "../lib/company-job-tags";

const native = vi.hoisted(() => ({ focused: true, currentState: "active", listeners: new Set<(next: string) => void>() }));
vi.mock("expo-router", async () => {
  const R = await import("react");
  return { useIsFocused: () => native.focused, useFocusEffect: (effect: () => void | (() => void)) => {
    R.useEffect(() => { if (native.focused) return effect(); }, [effect, native.focused]);
  } };
});
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => R.createElement(name, {
    ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
  }, props.children);
  return { View: host("native-view"), Text: host("native-text"), TextInput: host("native-input"),
    TouchableOpacity: host("native-touch"), ActivityIndicator: host("native-spinner"), StyleSheet: { create: (s: unknown) => s },
    AppState: { get currentState() { return native.currentState; }, addEventListener: (_event: string, listener: (next: string) => void) => {
      native.listeners.add(listener); return { remove: () => native.listeners.delete(listener) };
    } } };
});
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ primary: "blue", foreground: "white", muted: "gray", error: "red", background: "black", surface: "black", border: "gray" }) }));
const requireLocal = createRequire(import.meta.url);
const { createRoot } = requireLocal("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
const backend = requireLocal("/home/ubuntu/hsc-mobile-job-tags-20261117/permission-fixtures/backend-tag-harness.cjs");
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
let root: ReturnType<typeof createRoot>; let container: PhotoTestNode; let server: ReturnType<typeof backend.createHarness>;
let actor: JobSyncNativeSession; let jobId: number; let fetchMock: ReturnType<typeof vi.fn>; let routeAvailable: boolean;
let dropResponse: boolean; let corruptAck: boolean; let ignoreTagInReadback: boolean; let waitForPost: Promise<void> | null;
let focusInput: ReturnType<typeof vi.fn>; let blurInput: ReturnType<typeof vi.fn>; let closeReopen: () => void;
let actorId = 98000;
const api: CompanyJobTagsTransport = { session: getJobSyncMobileSession, detail: getJobSyncCompanyJobDetail,
  list: getJobSyncCompanyJobTags, add: addJobSyncCompanyJobTag, remove: removeJobSyncCompanyJobTag };
const tag = (id = 31, name = "Priority", requestedJobId = 44) => ({ id, jobId: requestedJobId, displayName: name,
  normalizedName: name.toLocaleLowerCase("en-US"), createdBy: actor.user.id, createdAt: "2026-11-17 12:00:00", updatedAt: null });
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function Harness({ variant = "admin" }: { variant?: "schedule" | "admin" }) {
  const epoch = useCompanyJobOperationEpoch(); const [open, setOpen] = useState(true);
  const capture = useCallback(() => () => open, [open]);
  const operation = useCompanyJobOperation(JSON.stringify([actor.token, jobId, open]), capture, epoch);
  const model = useCompanyJobTags(actor, open ? jobId : null, api, operation.isCurrent, operation.scopeKey);
  useLayoutEffect(() => { closeReopen = () => { epoch.invalidate(); setOpen(false); setOpen(true); }; }, [epoch]);
  return open ? <CompanyJobTags session={actor} jobId={jobId} model={model} isCurrent={operation.isCurrent}
    operationScopeKey={operation.scopeKey} variant={variant} onInputFocus={focusInput} onInputBlur={blurInput} /> : null;
}
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap(child => all(child))]; }
function control(label: string) {
  const node = all().find(item => item.nativeProps?.accessibilityLabel === label);
  if (!node) throw new Error(`Missing ${label}; UI: ${container.textContent}`);
  return node;
}
async function render(variant: "schedule" | "admin" = "admin") { await act(async () => root.render(<Harness variant={variant} />)); }
async function tap(label: string) { await act(async () => { control(label).nativeProps.onPress(); }); }
async function type(value: string) {
  await act(async () => { control("New job tag").nativeProps.onChangeText(value); });
}
function writes() { return fetchMock.mock.calls.filter(([, init]) => init.method === "POST" || init.method === "DELETE"); }
function asBackendActor() { return server.actor(actor.user.role, actor.user.id, actor.company!.id); }
async function wireDetail() {
  const row = await server.canonical.getJob(server.db, asBackendActor(), jobId);
  return { job: { ...row, id: Number(row.id), companyId: Number(row.company_id), assignedUserId: row.assigned_user_id ?? null, photos: [] } };
}
beforeEach(() => {
  native.focused = true; native.currentState = "active"; native.listeners.clear(); jobId = 44;
  actor = { token: `offline-tags-integration-${++actorId}`, portal: "company",
    user: { id: actorId, role: "owner", name: "Fixture", email: null, calendarEligible: false, paymentCollectionEnabled: false },
    company: { id: 9, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } };
  server = backend.createHarness(); server.db.jobs.get(44).assigned_user_id = actorId;
  routeAvailable = true; dropResponse = false; corruptAck = false; ignoreTagInReadback = false; waitForPost = null;
  focusInput = vi.fn(); blurInput = vi.fn(); closeReopen = () => undefined;
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/api/mobile/v1/auth/session" && init.method === "GET") return response(actor);
    if (path === `/api/mobile/v1/jobs/${jobId}` && init.method === "GET") return response(await wireDetail());
    const match = path.match(/^\/api\/mobile\/v1\/company\/jobs\/(\d+)\/tags(?:\/(\d+))?$/);
    if (!match) throw new Error(`Unexpected offline request ${init.method} ${path}`);
    if (!routeAvailable) return response({ error: { code: "NOT_FOUND", message: "Unknown mobile endpoint" } }, 404);
    const operation = init.method === "GET" ? "jobTags" : init.method === "POST" ? "addJobTagRoute" : "removeJobTagRoute";
    const result = await server.rest(operation, asBackendActor(), Number(match[1]), init.body ? JSON.parse(String(init.body)) : undefined, match[2] ? Number(match[2]) : undefined);
    if (init.method === "POST") {
      if (waitForPost) await waitForPost;
      if (dropResponse) throw new Error("Simulated lost acknowledgment after mocked persistence");
      if (corruptAck) result.body = { tag: { ...result.body.tag, jobId: 999 } };
    }
    if (init.method === "GET" && ignoreTagInReadback) result.body = { tags: [] };
    return response(result.body, result.status);
  }); vi.stubGlobal("fetch", fetchMock);
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe("exact Company Job tag adapter — mocked HTTP, strict c5758ae6 envelopes", () => {
  it("uses canonical path/headers/status/body and preserved SQL-string timestamps for all three operations", async () => {
    expect(await getJobSyncCompanyJobTags(actor.token, 44)).toEqual([]);
    const created = await addJobSyncCompanyJobTag(actor.token, 44, { name: "  ＰＲＩＯＲＩＴＹ\n\t Tag " });
    expect(created).toMatchObject({ displayName: "PRIORITY Tag", normalizedName: "priority tag", jobId: 44, createdBy: actor.user.id });
    expect(typeof created.createdAt).toBe("string");
    expect(await getJobSyncCompanyJobTags(actor.token, 44)).toEqual([created]);
    expect(await removeJobSyncCompanyJobTag(actor.token, 44, created.id)).toEqual({ success: true, jobId: 44, tagId: created.id });
    expect(await getJobSyncCompanyJobTags(actor.token, 44)).toEqual([]);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(new URL(url).pathname).toMatch(/^\/api\/mobile\/v1\/company\/jobs\/44\/tags(?:\/\d+)?$/);
      expect(init.headers.Authorization).toBe(`Bearer ${actor.token}`); expect(init).not.toHaveProperty("credentials");
      if (init.method === "POST") expect(JSON.parse(init.body)).toEqual({ name: "PRIORITY Tag" }); else expect(init).not.toHaveProperty("body");
    }
  });
  it.each([{}, null, [], { name: "" }, { name: " \n " }, { name: "a\u0000b" }, { name: "a\u007fb" }, { name: "x".repeat(65) },
    { name: "One", companyId: 9 }, { name: "One", expectedUpdatedAt: "now" }, { name: "One", idempotencyKey: "fake" }])("rejects invalid/invented create fields before any request %#", async input => {
    await expect(addJobSyncCompanyJobTag(actor.token, 44, input as any)).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("allows post-normalization limits rather than truncating raw whitespace or surrogate pairs", () => {
    expect(createJobSyncCompanyJobTagPayload({ name: `One${" ".repeat(100)}Tag` })).toEqual({ name: "One Tag" });
    expect(createJobSyncCompanyJobTagPayload({ name: "😀".repeat(32) }).name.length).toBe(64);
    expect(() => createJobSyncCompanyJobTagPayload({ name: "😀".repeat(33) })).toThrow("64");
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN])("rejects invalid Job or tag IDs before request: %s", async id => {
    await expect(getJobSyncCompanyJobTags(actor.token, id)).rejects.toThrow();
    await expect(addJobSyncCompanyJobTag(actor.token, id, { name: "One" })).rejects.toThrow();
    await expect(removeJobSyncCompanyJobTag(actor.token, 44, id)).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["", "bad token", " bad", "bad\n"]) ("rejects invalid bearers without fallback: %#", async token => {
    await expect(getJobSyncCompanyJobTags(token, 44)).rejects.toThrow();
    await expect(addJobSyncCompanyJobTag(token, 44, { name: "One" })).rejects.toThrow();
    await expect(removeJobSyncCompanyJobTag(token, 44, 31)).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([{}, [], { tags: null }, { tags: "Priority" }, { tags: [{ id: "31" }] }])("does not interpret malformed response as empty tags: %#", payload => {
    expect(normalizeJobSyncCompanyJobTags(payload, 44)).toBeNull();
  });
  it.each([{ id: "31" }, { id: 0 }, { jobId: 45 }, { createdBy: "801" }, { displayName: " Priority " }, { normalizedName: "PRIORITY" },
    { createdAt: undefined }, { updatedAt: 9 }, { createdAt: "" }])("rejects entire collection for malformed canonical record %#", patch => {
    expect(normalizeJobSyncCompanyJobTags({ tags: [{ ...tag(), ...patch }] }, 44)).toBeNull();
  });
  it("rejects duplicates, aliases, inherited envelopes and incorrect mutation acknowledgments", () => {
    expect(normalizeJobSyncCompanyJobTags({ tags: [tag(), tag()] }, 44)).toBeNull();
    expect(normalizeJobSyncCompanyJobTags({ tags: [tag(31), tag(32)] }, 44)).toBeNull();
    expect(normalizeJobSyncCompanyJobTags({ job: { tags: [tag()] } }, 44)).toBeNull();
    expect(normalizeJobSyncCompanyJobTags(Object.create({ tags: [] }), 44)).toBeNull();
    expect(normalizeJobSyncCompanyJobTagCreateAcknowledgment({ tag: tag() }, 44, { name: "Different" })).toBeNull();
    expect(normalizeJobSyncCompanyJobTagDeleteAcknowledgment({ success: true }, 44, 31)).toBeNull();
    expect(normalizeJobSyncCompanyJobTagDeleteAcknowledgment({ success: true, jobId: 44, tagId: "31" }, 44, 31)).toBeNull();
  });
  it.each([401, 403, 404, 409, 503])("preserves HTTP %s and never retries/falls back", async status => {
    fetchMock.mockResolvedValue(response({ error: { code: status === 409 ? "CONFLICT" : "NOT_FOUND", message: "Fixture failure" } }, status));
    await expect(addJobSyncCompanyJobTag(actor.token, 44, { name: "One" })).rejects.toMatchObject({ status }); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each(["GET", "POST", "DELETE"])("rejects unexpected success status for %s", async method => {
    fetchMock.mockResolvedValue(response(method === "GET" ? { tags: [] } : method === "POST" ? { tag: tag() } : { success: true, jobId: 44, tagId: 31 }, method === "POST" ? 200 : 201));
    const action = method === "GET" ? getJobSyncCompanyJobTags(actor.token, 44) : method === "POST" ? addJobSyncCompanyJobTag(actor.token, 44, { name: "Priority" }) : removeJobSyncCompanyJobTag(actor.token, 44, 31);
    await expect(action).rejects.toBeInstanceOf(JobSyncApiError); expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("real tag component -> real hook/controller -> bearer adapter -> exact pinned REST/service -> mocked SQL readback", () => {
  it.each(["owner", "dispatcher", "technician"] as const)("supports %s multiple tags, individual removal, and close/reopen canonical persistence", async role => {
    actor.user.role = role; await render(); await type("Priority");
    const add = control("Add job tag"); await act(async () => { add.nativeProps.onPress(); add.nativeProps.onPress(); });
    expect(writes()).toHaveLength(1); expect(container.textContent).toContain("Priority"); expect(container.textContent).toContain("confirmed by the backend");
    await type("Return Visit"); await tap("Add job tag"); expect(writes()).toHaveLength(2);
    expect(container.textContent).toContain("Return Visit"); await tap("Remove job tag Priority"); expect(writes()).toHaveLength(3);
    expect(container.textContent).not.toContain("Priority"); expect(container.textContent).toContain("Return Visit");
    await act(async () => closeReopen()); expect(container.textContent).toContain("Return Visit"); expect(writes()).toHaveLength(3);
    expect(server.db.jobs.get(44).internal_notes).toBe("Original private"); expect(server.db.jobs.get(44).service_notes).toBe("Customer-visible untouched");
    expect(server.effects).toHaveLength(0);
  });
  it("retains technician +Add/Done and keyboard submit while preserving canonical chips", async () => {
    actor.user.role = "technician"; await render("schedule"); await tap("Edit job tags"); await type("One");
    await act(async () => control("New job tag").nativeProps.onSubmitEditing());
    expect(container.textContent).toContain("One"); expect(writes()).toHaveLength(1);
    await tap("Edit job tags"); await type("Two"); await tap("Add job tag");
    await tap("Edit job tags"); await tap("Done editing job tags"); expect(container.textContent).toContain("One"); expect(container.textContent).toContain("Two");
  });
  it.each([45, 46])("denies technician tags on Job %s even though its canonical Job detail is readable", async id => {
    actor.user.role = "technician"; jobId = id; expect((await getJobSyncCompanyJobDetail(actor.token, jobId, 9)).id).toBe(id);
    await render(); expect(container.textContent).toMatch(/unavailable|denied|assigned technician/i); expect(writes()).toHaveLength(0);
    expect(all().some(node => node.nativeProps?.accessibilityLabel === "New job tag")).toBe(false);
  });
  it("absent routes show unavailable tags, never verified empty or legacy fallback", async () => {
    routeAvailable = false; await render(); expect(container.textContent).toMatch(/unavailable|denied/i);
    expect(container.textContent).not.toContain("No tags yet"); expect(writes()).toHaveLength(0);
    expect(fetchMock.mock.calls.every(([url]) => !url.includes("trpc") && !url.includes("customers"))).toBe(true);
  });
  it("preserves the existing parent keyboard handler connection on the active tag input", async () => {
    await render(); const input = control("New job tag"); const event = { currentTarget: {} };
    input.nativeProps.onFocus(event); input.nativeProps.onBlur(event);
    expect(focusInput).toHaveBeenCalledWith(event); expect(blurInput).toHaveBeenCalledWith(event);
  });
  it.each(["lost", "ack", "readback"])("does not report confirmed success or resend for %s response uncertainty", async defect => {
    await render(); await type("Uncertain"); if (defect === "lost") dropResponse = true; if (defect === "ack") corruptAck = true; if (defect === "readback") ignoreTagInReadback = true;
    await tap("Add job tag"); expect(writes()).toHaveLength(1); expect(server.db.tags.size).toBe(1);
    expect(container.textContent).toMatch(/unconfirmed|review/i); expect(container.textContent).not.toContain("Tag added and confirmed");
    expect(all().filter(node => node.nativeProps?.accessibilityLabel === "Add job tag").every(node => node.nativeProps.disabled === true)).toBe(true);
    await act(async () => closeReopen()); expect(writes()).toHaveLength(1); expect(container.textContent).toMatch(/review/i);
    dropResponse = false; corruptAck = false; ignoreTagInReadback = false; await tap("Refresh and review job tags");
    expect(container.textContent).toContain("Uncertain"); expect(writes()).toHaveLength(1);
  });
  it("drops old same-Job sheet callbacks and pending response without reviving old success", async () => {
    let resolve!: () => void; waitForPost = new Promise<void>(done => { resolve = done; });
    await render(); await type("Delayed"); const old = control("Add job tag").nativeProps.onPress;
    await act(async () => { old(); }); expect(writes()).toHaveLength(1);
    await act(async () => closeReopen()); await act(async () => { old(); }); expect(writes()).toHaveLength(1);
    await act(async () => resolve()); expect(container.textContent).not.toContain("Tag added and confirmed");
    await tap("Refresh and review job tags"); expect(container.textContent).toContain("Delayed"); expect(writes()).toHaveLength(1);
  });
  it("isolates already-rendered callbacks after background/active or tenant change", async () => {
    await render(); await type("Stale"); const old = control("Add job tag").nativeProps.onPress;
    await act(async () => { native.currentState = "background"; native.listeners.forEach(listener => listener("background")); native.currentState = "active"; native.listeners.forEach(listener => listener("active")); });
    await act(async () => { old(); }); expect(writes()).toHaveLength(0);
    actor = { ...actor, company: { ...actor.company!, id: 10 } }; await render(); expect(container.textContent).not.toContain("Stale"); expect(writes()).toHaveLength(0);
  });
  it("links both actual screen Company-only tag slots to the shared canonical adapter, guarded scope, and single-owner keyboard", () => {
    for (const screen of ["schedule", "admin-schedule"]) {
      const source = readFileSync(new URL(`../app/(tabs)/${screen}.tsx`, import.meta.url), "utf8");
      expect(source).toContain("const companyJobTagsApi: CompanyJobTagsTransport");
      expect(source).toContain("useCompanyJobTags(jobSyncSession, companyPhotoJobId, companyJobTagsApi");
      expect(source).toContain("{companyJobMode && <CompanyJobTags session={jobSyncSession} jobId={companyPhotoJobId}");
      expect(source).toContain("model={companyJobTags} isCurrent={isCurrentCompanyJobOperation} operationScopeKey={companyJobOperationScope}");
      expect(source).toContain("cardRef={detailTagRef} onInputFocus={detailInputFocus} onInputBlur={detailInputBlur}");
      expect(source).toContain('edges={Platform.OS === "ios" ? ["bottom"] : []}');
      expect(source).toContain('automaticallyAdjustKeyboardInsets={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"');
      expect(source).toContain("{!companyJobMode && <View ref={detailTagRef}");
    }
  });
});
