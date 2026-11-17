import React, { act } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyJobPrivateNotes } from "../components/company-job-private-notes";
import { useCompanyJob } from "../hooks/use-company-job";
import { getJobSyncCompanyJobs, updateJobSyncCompanyJobPrivateNotes, uploadJobSyncCompanyJobPhoto,
  normalizeJobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";

const native = vi.hoisted(() => ({ focused: true, state: "active", listeners: new Set<(state: string) => void>() }));
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
  return { AppState: { get currentState() { return native.state; }, addEventListener: (_event: string, listener: (state: string) => void) => {
    native.listeners.add(listener); return { remove: () => native.listeners.delete(listener) };
  } }, View: host("native-view"), Text: host("native-text"), TouchableOpacity: host("native-touch"),
    TextInput: host("native-input"), ActivityIndicator: host("native-spinner"), StyleSheet: { create: (styles: unknown) => styles } };
});
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ foreground: "white", muted: "gray", primary: "blue", background: "black", border: "gray", error: "red" }) }));
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const bytes = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(509)]).toString("base64");
const V0 = "2026-11-17T04:00:00.000Z";
const V1 = "2026-11-17T04:01:00.000Z";
let root: ReturnType<typeof createRoot>; let container: PhotoTestNode; let actor: JobSyncNativeSession;
let wire: Record<string, unknown>; let fetchMock: ReturnType<typeof vi.fn>; let patchStatus: number;
let acknowledgement: unknown; let readbackNote: string | undefined; let nextUser = 94000;
let focusInput: ReturnType<typeof vi.fn>; let blurInput: ReturnType<typeof vi.fn>;
function Harness() {
  const job = useCompanyJob(actor, 12, undefined, () => true, "connected-notes");
  return <CompanyJobPrivateNotes session={actor} jobId={12} job={job} isCurrent={() => true}
    writePrivateNotes={updateJobSyncCompanyJobPrivateNotes} onInputFocus={focusInput} onInputBlur={blurInput} />;
}
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap(child => all(child))]; }
function control(label: string) {
  const node = all().find(item => item.nativeProps?.accessibilityLabel === label);
  if (!node) throw new Error(`Missing ${label}: ${container.textContent}`);
  return node;
}
async function render() { await act(async () => root.render(<Harness />)); }
async function tap(label: string) { await act(async () => { control(label).nativeProps.onPress(); }); }
async function edit(value: string) {
  await tap("Edit private job notes");
  await act(async () => { control("Edit internal Company private notes").nativeProps.onChangeText(value); });
}
function patches() { return fetchMock.mock.calls.filter(([, init]) => init.method === "PATCH"); }
beforeEach(() => {
  native.focused = true; native.state = "active"; native.listeners.clear(); patchStatus = 200; acknowledgement = undefined; readbackNote = undefined;
  actor = { token: `offline-connected-notes-${++nextUser}`, portal: "company",
    user: { id: nextUser, name: "Fixture manager", role: "owner", email: null, calendarEligible: false },
    company: { id: 9, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } };
  wire = { id: 12, companyId: 9, assignedUserId: 99, status: "scheduled", updatedAt: V0, photos: [],
    internal_notes: "Existing internal note", service_notes: "Customer-visible service note" };
  focusInput = vi.fn(); blurInput = vi.fn();
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/api/mobile/v1/auth/session" && init.method === "GET") return response(actor);
    if (path === "/api/mobile/v1/jobs/12" && init.method === "GET") return response({ job: wire });
    if (path === "/api/mobile/v1/company/jobs" && init.method === "GET") return response({ jobs: [wire] });
    if (path === "/api/mobile/v1/company/jobs/12/private-notes" && init.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      if (patchStatus !== 200) return response({ error: { code: "INTERNAL", message: "Unsafe backend message must not appear in UI" } }, patchStatus);
      expect(body.expectedUpdatedAt).toBe(V0);
      expect(wire.updatedAt).toBe(V0);
      wire = { ...wire, internal_notes: readbackNote ?? body.privateNotes, updatedAt: V1 };
      return response(acknowledgement ?? { success: true, jobId: 12, privateNotes: body.privateNotes, updatedAt: V1 });
    }
    throw new Error(`Unexpected offline request ${init.method} ${path}`);
  }); vi.stubGlobal("fetch", fetchMock);
  const doc = installPhotoTestDOM(); container = doc.createElement("main"); doc.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe("private-note canonical adapter — unpublished 2818bb72 versioned shape, mocked HTTP only", () => {
  it.each(["", "  Exact text\n<literal>  ", "x".repeat(4000)])("sends private-only text without trimming once: %#", async privateNotes => {
    const result = await updateJobSyncCompanyJobPrivateNotes(actor.token, 12, privateNotes, V0);
    expect(result).toEqual({ success: true, jobId: 12, privateNotes, updatedAt: V1 });
    expect(fetchMock).toHaveBeenCalledOnce(); const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe("/api/mobile/v1/company/jobs/12/private-notes");
    expect(init.method).toBe("PATCH"); expect(init.headers.Authorization).toBe(`Bearer ${actor.token}`);
    expect(JSON.parse(init.body)).toEqual({ privateNotes, expectedUpdatedAt: V0 }); expect(init).not.toHaveProperty("credentials");
  });
  it.each([null, {}, [], 3, "x".repeat(4001)])("rejects invalid note before HTTP: %#", async privateNotes => {
    await expect(updateJobSyncCompanyJobPrivateNotes(actor.token, 12, privateNotes as string, V0)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid Job before HTTP: %s", async jobId => {
    await expect(updateJobSyncCompanyJobPrivateNotes(actor.token, jobId, "note", V0)).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["", "bad token", " bad", "bad\n"]) ("rejects invalid bearer before HTTP: %#", async token => {
    await expect(updateJobSyncCompanyJobPrivateNotes(token, 12, "note", V0)).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409, 500, 503])("does not fall back or retry HTTP %s", async status => {
    patchStatus = status; await expect(updateJobSyncCompanyJobPrivateNotes(actor.token, 12, "note", V0)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("rejects an unexpected success status rather than guessing an acknowledgment", async () => {
    fetchMock.mockResolvedValue(response({ success: true, jobId: 12, privateNotes: "note" }, 201));
    await expect(updateJobSyncCompanyJobPrivateNotes(actor.token, 12, "note", V0)).rejects.toThrow(); expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("connected internal notes UI -> controller -> canonical adapter -> independent detail", () => {
  it.each(["owner", "dispatcher"] as const)("allows verified %s editor and canonical readback; leaves service notes untouched", async role => {
    actor = { ...actor, user: { ...actor.user, role } }; await render(); await edit("Updated internal note");
    const save = control("Save private job notes");
    await act(async () => { save.nativeProps.onPress(); save.nativeProps.onPress(); });
    expect(patches()).toHaveLength(1); expect(container.textContent).toContain("Updated internal note");
    expect(JSON.parse(String(patches()[0][1].body))).toEqual({ privateNotes: "Updated internal note", expectedUpdatedAt: V0 });
    expect(wire.updatedAt).toBe(V1);
    expect(container.textContent).not.toContain("Customer-visible service note"); expect(wire.service_notes).toBe("Customer-visible service note");
    expect(container.textContent).toContain("Internal Company only");
    expect((await getJobSyncCompanyJobs(actor.token))[0]).not.toHaveProperty("privateNotes");
  });
  it("keeps assigned technicians read-only despite the supplied manager writer", async () => {
    actor = { ...actor, user: { ...actor.user, role: "technician" } }; wire = { ...wire, assignedUserId: actor.user.id };
    await render(); expect(container.textContent).toContain("Existing internal note"); expect(container.textContent).toContain("Read-only");
    expect(all().some(node => node.nativeProps?.accessibilityLabel === "Edit private job notes")).toBe(false); expect(patches()).toHaveLength(0);
  });
  it("forwards existing keyboard focus handlers without adding another keyboard boundary", async () => {
    await render(); await tap("Edit private job notes"); const input = control("Edit internal Company private notes");
    const event = { currentTarget: {} }; input.nativeProps.onFocus(event); input.nativeProps.onBlur(event);
    expect(focusInput).toHaveBeenCalledWith(event); expect(blurInput).toHaveBeenCalledWith(event);
  });
  it("reports the pinned backend route failure safely, performs no optimistic update, and never blindly retries", async () => {
    patchStatus = 500; await render(); await edit("Must not become displayed private text"); await tap("Save private job notes");
    expect(patches()).toHaveLength(1); expect(wire.internal_notes).toBe("Existing internal note");
    expect(container.textContent).toContain("Save could not be confirmed"); expect(container.textContent).not.toContain("Unsafe backend message");
    expect(container.textContent).not.toContain("Must not become displayed private text");
    expect(all().some(node => node.nativeProps?.accessibilityLabel === "Save private job notes")).toBe(false);
    await tap("Refresh private job notes"); expect(patches()).toHaveLength(1); expect(container.textContent).toContain("Existing internal note");
  });
  it.each(["ack", "readback"])("never reports saved when %s does not bind submitted private text", async defect => {
    if (defect === "ack") acknowledgement = { success: true, jobId: 999, privateNotes: "Submitted private note" };
    else readbackNote = "Different server private note";
    await render(); await edit("Submitted private note"); await tap("Save private job notes");
    expect(patches()).toHaveLength(1); expect(container.textContent).toContain("Save could not be confirmed");
    expect(container.textContent).not.toContain("Private notes saved and verified");
  });
  it("wires both original Company slots to the same narrow writer and keyboard callbacks", () => {
    for (const screen of ["schedule", "admin-schedule"]) {
      const source = readFileSync(new URL(`../app/(tabs)/${screen}.tsx`, import.meta.url), "utf8");
      expect(source).toContain("writePrivateNotes={updateJobSyncCompanyJobPrivateNotes}");
      expect(source).toContain("onInputFocus={detailInputFocus} onInputBlur={detailInputBlur}");
      expect(source).toContain("isCurrentCompany");
    }
  });
});

describe("explicit photo metadata rejects invalid intent before HTTP and invalid persisted rows fail closed", () => {
  it.each([{ category: null }, { category: "Before" }, { category: "unknown" }, { displayOrder: null },
    { displayOrder: "1" }, { displayOrder: -1 }, { displayOrder: 100001 }, { displayOrder: 1.5 }, { displayOrder: NaN }, { displayOrder: Infinity }])("rejects invalid upload metadata %#", async metadata => {
    await expect(uploadJobSyncCompanyJobPhoto(actor.token, 12, { contentType: "image/jpeg", base64: bytes, ...metadata } as any)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not hide invalid metadata merely because its persisted photo URL is unavailable", () => {
    const job = { ...wire, photos: [{ id: 4, imageUrl: "file:///not-renderable", category: "unknown", displayOrder: 0 }] };
    expect(normalizeJobSyncCompanyJobDetail({ job }, 12, 9)).toBeNull();
  });
});
