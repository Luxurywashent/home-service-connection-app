import React, { act, useState } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyJobPhotos, CompanyJobPhotoPreview, type CompanyPhotoSelection } from "../components/company-job-photos";
import { CompanyJobProgress } from "../components/company-job-progress";
import { useCompanyJob } from "../hooks/use-company-job";
import { normalizeJobSyncCompanyJobDetail, type JobSyncNativeSession, type JobSyncJobPhoto } from "../lib/jobsync-mobile-api";
import { companyPhotoScope } from "../lib/company-photo-view";

const lifecycle = vi.hoisted(() => ({ focused: true, alert: vi.fn(), platform: { OS: "ios" } }));
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
vi.mock("expo-file-system/legacy", () => ({ getInfoAsync: vi.fn(), readAsStringAsync: vi.fn(), EncodingType: { Base64: "base64" } }));
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, unknown>) => R.createElement(name, {
    ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
  }, props.children as React.ReactNode);
  return {
    ActivityIndicator: host("activity-indicator"), Image: host("native-image"), Text: host("native-text"), TouchableOpacity: host("native-touch"), View: host("native-view"),
    FlatList: (props: { data: JobSyncJobPhoto[]; keyExtractor: (item: JobSyncJobPhoto) => string; renderItem: (input: { item: JobSyncJobPhoto }) => React.ReactNode }) => R.createElement("native-list", null, props.data.map((item) => R.createElement(R.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item })))),
    StyleSheet: { create: (styles: unknown) => styles }, Platform: lifecycle.platform, Alert: { alert: lifecycle.alert },
  };
});
vi.mock("@/components/company-photo-draft", async () => {
  const R = await import("react");
  return { CompanyPhotoDraft: () => R.createElement("native-local-draft") };
});
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ primary: "blue", foreground: "black", muted: "gray", error: "red", background: "white", border: "gray", success: "green" }) }));
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
const session = (): JobSyncNativeSession => ({
  token: "offline-only-owner-token", portal: "company", user: { id: 42, role: "owner", name: "Fixture", email: null, calendarEligible: true },
  company: { id: 9, name: "Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null },
});
const photo = (id = 1, signature = "A") => ({ id, imageUrl: `https://fixture.invalid/api/storage/photo-${id}?expires=300&signature=${signature}`, caption: `Photo ${id}`, uploadedByUserId: 42, createdAt: null });
const wireJob = (photos: unknown[] = [photo()], patch: Record<string, unknown> = {}) => ({
  id: 12, companyId: 9, assignedUserId: 42, status: "en_route", updatedAt: "2026-11-15T12:00:00Z", photos,
  enRouteAt: "2026-11-15T12:00:00Z", onSiteAt: null, completedAt: null, ...patch,
});
const json = (payload: unknown, status = 200) => ({ ok: true, status, json: async () => payload });
function offlineServer(options: { parentFails?: boolean; ack?: unknown; hidden?: unknown[] } = {}) {
  let removed = false;
  let afterRemovalReads = 0;
  let currentStatus = "en_route";
  let later: unknown[] | null = null;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/api/mobile/v1/auth/session" && init.method === "GET") return json(session());
    if (path === "/api/mobile/v1/jobs/12/photos/2" && init.method === "DELETE") { removed = true; return json(options.ack ?? { success: true }); }
    if (path === "/api/mobile/v1/jobs/12/status" && init.method === "PATCH") {
      currentStatus = JSON.parse(init.body as string).status;
      return json({ success: true, status: currentStatus });
    }
    if (path === "/api/mobile/v1/company/jobs" && init.method === "GET") return json({ jobs: [wireJob([], { status: currentStatus })] });
    if (path === "/api/mobile/v1/jobs/12" && init.method === "GET") {
      if (later) return json({ job: wireJob(later, { status: currentStatus }) });
      if (options.hidden) return json({ job: wireJob(options.hidden, { status: currentStatus }) });
      if (!removed) return json({ job: wireJob([photo(), photo(2)], { status: currentStatus }) });
      afterRemovalReads++;
      if (afterRemovalReads === 1 && options.parentFails) throw new Error("offline parent detail failed");
      return json({ job: wireJob([photo(1, afterRemovalReads === 1 ? "A" : "B")], { status: currentStatus }) });
    }
    throw new Error(`Unexpected offline request: ${init.method} ${path}`);
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, replace: (photos: unknown[]) => { later = photos; } };
}
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let latest: ReturnType<typeof useCompanyJob>;
function Sheet({ actor = session(), jobId = 12, progress = false }: { actor?: JobSyncNativeSession | null; jobId?: number | null; progress?: boolean }) {
  const [selection, setSelection] = useState<CompanyPhotoSelection | null>(null);
  const job = useCompanyJob(actor, jobId);
  latest = job;
  const refresh = async () => { setSelection(null); await job.refresh(); };
  return <>
    {progress ? <CompanyJobProgress session={actor} job={job} /> : <>
      <CompanyJobPhotos session={actor} jobId={jobId} job={job} onPreview={setSelection} onRefresh={refresh} />
      <CompanyJobPhotoPreview session={actor} jobId={jobId} job={job} photo={selection} onClose={() => setSelection(null)} onRefresh={refresh} />
    </>}
  </>;
}
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function nodes(name: string) { return all().filter((node) => node.nodeName.toLowerCase() === name); }
function button(label: string) {
  const node = nodes("native-touch").find((node) => node.nativeProps.accessibilityLabel === label || node.textContent === label);
  if (!node) throw new Error(`Missing ${label}; text=${container.textContent}`);
  return node;
}
async function render(element: React.ReactNode = <Sheet />) { await act(async () => { root.render(element); }); }
async function tap(node: NativeNode) { await act(async () => { node.nativeProps.onPress(); }); }
function confirmArrived() { return lifecycle.alert.mock.calls.at(-1)![2][1].onPress as () => void; }
const writes = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.filter(([, init]) => ["PATCH", "POST", "DELETE"].includes(init.method));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  lifecycle.focused = true; lifecycle.alert.mockReset();
  const doc = installPhotoTestDOM(); container = doc.createElement("main"); doc.body.appendChild(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden outside an explicit offline fixture"); }));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe("actual shared parent hook + operation + gallery + sibling preview (offline REST, real React)", () => {
  it.each([false, true])("shares independent URL B when parent URL A read fails=%s, without changing progress state", async (parentFails) => {
    const server = offlineServer({ parentFails }); await render();
    const oldTap = button("Photo 1"); const oldImage = nodes("native-image")[0];
    await tap(button("Remove Job photo 2"));
    const confirm = button("Confirm remove photo from Job");
    await act(async () => { confirm.nativeProps.onPress(); confirm.nativeProps.onPress(); });
    expect(writes(server.fetch)).toHaveLength(1);
    expect(container.textContent).toContain("absence confirmed by fresh detail");
    expect(latest.verifiedPhotoDetail?.photos[0].imageUrl).toBe(photo(1, "B").imageUrl);
    if (parentFails) { expect(latest.error).toContain("offline parent detail failed"); expect(latest.detail).toBeNull(); }
    else expect(latest.detail?.photos[0].imageUrl).toBe(photo(1, "A").imageUrl);
    expect(nodes("native-image")[0].nativeProps.source.uri).toBe(photo(1, "B").imageUrl);
    await tap(oldTap);
    expect(nodes("native-image")).toHaveLength(1);
    await act(async () => { oldImage.nativeProps.onError(); });
    expect(container.textContent).not.toContain("Photo unavailable");
    await tap(button("Photo 1"));
    expect(nodes("native-image")).toHaveLength(2);
    expect(nodes("native-image").map((node) => node.nativeProps.source.uri)).toEqual([photo(1, "B").imageUrl, photo(1, "B").imageUrl]);
    expect(button("Close photo preview")).toBeDefined();
    const paths = server.fetch.mock.calls.map(([url]) => new URL(url).pathname);
    expect(paths.every((path) => path === "/api/mobile/v1/auth/session" || path === "/api/mobile/v1/jobs/12" || path === "/api/mobile/v1/jobs/12/photos/2")).toBe(true);
  });
  it("a later canonical replacement supersedes B and rejects retained B thumbnails/preview callbacks", async () => {
    const server = offlineServer(); await render(); await tap(button("Remove Job photo 2")); await tap(button("Confirm remove photo from Job")); await tap(button("Photo 1"));
    const retainedTap = button("Photo 1"); const previewImage = nodes("native-image")[1];
    const retainedAccept = latest.acceptVerifiedDetail;
    const verifiedB = latest.verifiedPhotoDetail!;
    server.replace([photo(1, "C")]); await act(async () => { await latest.refresh(); });
    expect(latest.verifiedPhotoDetail).toBeNull();
    await act(async () => { expect(retainedAccept(verifiedB, companyPhotoScope(session(), 12)!)).toBe(false); });
    expect(nodes("native-image")).toHaveLength(1);
    expect(nodes("native-image")[0].nativeProps.source.uri).toBe(photo(1, "C").imageUrl);
    await tap(retainedTap); await act(async () => { previewImage.nativeProps.onError(); });
    expect(nodes("native-image")).toHaveLength(1);
    expect(nodes("native-text").some((node) => node.nativeProps.accessibilityRole === "alert" && node.textContent.includes("could not load"))).toBe(false);
    await tap(button("Photo 1")); expect(nodes("native-image")).toHaveLength(2);
  });
  it("does not accept a bare preview URL or acceptVerifiedDetail from an old scope even after returning", async () => {
    offlineServer(); await render(); const accept = latest.acceptVerifiedDetail;
    const canonical = normalizeJobSyncCompanyJobDetail({ job: wireJob([photo(1, "B")]) }, 12, 9)!;
    await act(async () => { expect(accept(canonical, "wrong-scope")).toBe(false); });
    const changed = session(); changed.token = "rotated-offline-token";
    await render(<Sheet actor={changed} />); await render();
    await act(async () => { expect(accept(canonical, companyPhotoScope(session(), 12)!)).toBe(false); });
    expect(latest.verifiedPhotoDetail).toBeNull();
    await render(<CompanyJobPhotoPreview session={session()} jobId={12} job={latest} photo={{ scope: companyPhotoScope(session(), 12)!, photoId: 1, imageUrl: photo(1, "B").imageUrl }} onClose={vi.fn()} />);
    expect(nodes("native-image")).toHaveLength(0);
  });
  it("malformed removal ack remains unconfirmed even when readback absence and B are shared", async () => {
    const server = offlineServer({ ack: { success: "true" } }); await render(); await tap(button("Remove Job photo 2")); await tap(button("Confirm remove photo from Job"));
    expect(writes(server.fetch)).toHaveLength(1);
    expect(container.textContent).not.toContain("absence confirmed by fresh detail");
    expect(container.textContent).toContain("request was not confirmed");
    await tap(button("Photo 1")); expect(nodes("native-image")).toHaveLength(2);
  });
  it.each([null, "http://fixture.invalid/unsafe", "file:///hidden.jpg", "/unverified-relative"])("persisted unrenderable URL %s is unavailable, not empty, and grants no deletion", async (imageUrl) => {
    const server = offlineServer({ hidden: [{ ...photo(7), imageUrl }] }); await render();
    expect(latest.detail?.persistedPhotoIds).toEqual([7]);
    expect(container.textContent).toContain("BEFORE & AFTER PHOTOS (1)");
    expect(container.textContent).toContain("images are unavailable");
    expect(container.textContent).not.toContain("No server photos");
    expect(nodes("native-image")).toHaveLength(0);
    expect(nodes("native-touch").some((node) => /Remove Job photo/.test(node.nativeProps.accessibilityLabel ?? ""))).toBe(false);
    expect(writes(server.fetch)).toHaveLength(0);
    await tap(button("Refresh photos")); expect(writes(server.fetch)).toHaveLength(0);
  });
  it("true complete-ID emptiness stays honestly empty", async () => {
    offlineServer({ hidden: [] }); await render();
    expect(latest.detail?.persistedPhotoIds).toEqual([]);
    expect(container.textContent).toContain("BEFORE & AFTER PHOTOS (0)");
    expect(container.textContent).toContain("No server photos for this Job.");
    expect(nodes("native-image")).toHaveLength(0);
  });
  it("mixed renderable and hidden persisted photos count complete IDs without rendering hidden URLs", async () => {
    offlineServer({ hidden: [photo(), { ...photo(7), imageUrl: null, uploadedByUserId: null }] }); await render();
    expect(latest.detail?.persistedPhotoIds).toEqual([1, 7]);
    expect(container.textContent).toContain("BEFORE & AFTER PHOTOS (2)");
    expect(container.textContent).toContain("Some stored server photos have unavailable images");
    expect(nodes("native-image")).toHaveLength(1);
    expect(nodes("native-touch").some((node) => node.nativeProps.accessibilityLabel === "Remove Job photo 7")).toBe(false);
  });
});

describe("actual shared progress component and controller retained callbacks (offline REST, real React)", () => {
  it.each(["pending", "loading"] as const)("transient %s invalidates an old confirmation even with the exact same detail object", async (flag) => {
    offlineServer(); await render(<Sheet progress />);
    const current = latest;
    await render(<CompanyJobProgress session={session()} job={current} />);
    await tap(button("ARRIVED")); const old = confirmArrived();
    const advance = vi.fn().mockResolvedValue(false);
    await render(<CompanyJobProgress session={session()} job={{ ...current, [flag]: true, advance }} />);
    await render(<CompanyJobProgress session={session()} job={{ ...current, advance }} />);
    await act(async () => { old(); }); expect(advance).not.toHaveBeenCalled();
    await tap(button("ARRIVED")); await act(async () => { confirmArrived()(); }); expect(advance).toHaveBeenCalledTimes(1);
  });
  it.each(["blur", "Job", "Company", "token", "user", "role", "opt-out", "refresh", "unmount"])("old Arrived confirmation cannot write after %s and return", async (change) => {
    const server = offlineServer(); await render(<Sheet progress />);
    await tap(button("ARRIVED")); const old = confirmArrived(); const oldAdvance = latest.advance;
    if (change === "blur") { lifecycle.focused = false; await render(<Sheet progress />); lifecycle.focused = true; }
    else if (change === "unmount") await render(<div />);
    else if (change === "refresh") await act(async () => { await latest.refresh(); });
    else {
      const changed = session(); let jobId: number | null = 12;
      if (change === "Job") jobId = null;
      if (change === "Company") changed.company!.id = 10;
      if (change === "token") changed.token = "rotated-offline-token";
      if (change === "user") changed.user.id = 43;
      if (change === "role") changed.user.role = "dispatcher";
      if (change === "opt-out") changed.user.calendarEligible = false;
      await render(<Sheet progress actor={changed} jobId={jobId} />);
    }
    await render(<Sheet progress />);
    await act(async () => { old(); if (change !== "refresh") expect(await oldAdvance("on_site")).toBe(false); });
    expect(writes(server.fetch)).toHaveLength(0);
    await tap(button("ARRIVED"));
    await act(async () => { const fresh = confirmArrived(); fresh(); fresh(); });
    expect(writes(server.fetch)).toHaveLength(1);
    expect(JSON.parse(writes(server.fetch)[0][1].body as string)).toEqual({ status: "on_site", expectedUpdatedAt: "2026-11-15T12:00:00Z" });
  });
  it("Not Yet cancels the retained confirmation and repeated Arrived taps open only one Alert", async () => {
    const server = offlineServer(); await render(<Sheet progress />);
    const arrived = button("ARRIVED"); await act(async () => { arrived.nativeProps.onPress(); arrived.nativeProps.onPress(); });
    expect(lifecycle.alert).toHaveBeenCalledTimes(1);
    const old = confirmArrived(); await act(async () => { lifecycle.alert.mock.calls[0][2][0].onPress(); old(); });
    expect(writes(server.fetch)).toHaveLength(0);
    await tap(button("ARRIVED")); await act(async () => { confirmArrived()(); }); expect(writes(server.fetch)).toHaveLength(1);
  });
  it("blur during manager preflight prevents PATCH and rejects delayed follow-up state", async () => {
    const server = offlineServer(); await render(<Sheet progress />); await tap(button("ARRIVED"));
    const delay = deferred<ReturnType<typeof json>>(); server.fetch.mockImplementationOnce(() => delay.promise);
    await act(async () => { confirmArrived()(); });
    lifecycle.focused = false; await render(<Sheet progress />);
    await act(async () => { delay.resolve(json(session())); });
    expect(writes(server.fetch)).toHaveLength(0);
    lifecycle.focused = true; await render(<Sheet progress />);
    expect(latest.detail?.status).toBe("en_route");
    await tap(button("ARRIVED")); await act(async () => { confirmArrived()(); }); expect(writes(server.fetch)).toHaveLength(1);
  });
  it("a legitimately sent PATCH is not unsent on blur, but emits no reconciliation follow-ups", async () => {
    const server = offlineServer(); await render(<Sheet progress />);
    const original = server.fetch.getMockImplementation()!;
    const delay = deferred<ReturnType<typeof json>>();
    server.fetch.mockImplementation(async (url, init) => init.method === "PATCH" ? delay.promise : original(url, init));
    await tap(button("ARRIVED")); await act(async () => { confirmArrived()(); });
    expect(writes(server.fetch)).toHaveLength(1);
    lifecycle.focused = false; await render(<Sheet progress />); const calls = server.fetch.mock.calls.length;
    await act(async () => { delay.resolve(json({ success: true, status: "on_site" })); });
    expect(server.fetch).toHaveBeenCalledTimes(calls);
    expect(latest.detail).toBeNull(); expect(latest.success).toBeNull();
  });
  it("genuine fresh sequential On My Way, confirmed Arrived and Finish remain available", async () => {
    const server = offlineServer(); server.replace([photo()]);
    // Return scheduled until the first real status dispatch; no duplicate action implementation.
    const original = server.fetch.getMockImplementation()!; let first = true;
    server.fetch.mockImplementation(async (url, init) => {
      if (init.method === "PATCH") first = false;
      const response = await original(url, init);
      if (first && new URL(url).pathname === "/api/mobile/v1/jobs/12") return json({ job: wireJob([photo()], { status: "scheduled" }) });
      return response;
    });
    await render(<Sheet progress />); await tap(button("ON MY WAY"));
    await tap(button("ARRIVED")); await act(async () => { confirmArrived()(); });
    await tap(button("FINISH"));
    expect(writes(server.fetch).map(([, init]) => JSON.parse(init.body as string).status)).toEqual(["en_route", "on_site", "completed"]);
    expect(latest.detail?.status).toBe("completed");
    expect(button("FINISH").nativeProps.disabled).toBe(true);
  });
});
