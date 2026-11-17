import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyPhotoDraft } from "../components/company-photo-draft";
import { CompanyJobPhotos } from "../components/company-job-photos";
import { useCompanyJob } from "../hooks/use-company-job";
import { prepareCompanyPhotoBatch, uploadCompanyPhotoBatch, useCompanyPhotoBatch } from "../lib/company-photo-batch";
import type { CompanyPhotoDraftInput } from "../lib/company-photo-draft";
import type { JobSyncCompanyJobDetail, JobSyncNativeSession } from "../lib/jobsync-mobile-api";
const mocks = vi.hoisted(() => ({
  focused: true, cameraPermission: vi.fn(), libraryPermission: vi.fn(), camera: vi.fn(), library: vi.fn(), info: vi.fn(), bytes: vi.fn(), fetch: vi.fn(),
  appState: { currentState: "active", addEventListener: vi.fn() }, listeners: new Set<(state: string) => void>(),
}));
vi.mock("expo-router", async () => {
  const R = await import("react");
  return { useIsFocused: () => mocks.focused, useFocusEffect: (effect: () => void | (() => void)) => { const focused = mocks.focused; R.useEffect(() => { if (focused) return effect(); }, [effect, focused]); } };
});
vi.mock("expo-image-picker", () => ({ requestCameraPermissionsAsync: mocks.cameraPermission, requestMediaLibraryPermissionsAsync: mocks.libraryPermission, launchCameraAsync: mocks.camera, launchImageLibraryAsync: mocks.library }));
vi.mock("expo-file-system/legacy", () => ({ getInfoAsync: mocks.info, readAsStringAsync: mocks.bytes, EncodingType: { Base64: "base64" } }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ primary: "blue", foreground: "white", muted: "gray", error: "red", surface: "black", background: "black", border: "gray" }) }));
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, unknown>) => R.createElement(name, { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; } }, props.children as React.ReactNode);
  return {
    ActivityIndicator: host("activity-indicator"), Image: host("native-image"), Text: host("native-text"), TouchableOpacity: host("native-touch"), View: host("native-view"),
    FlatList: (props: { data: any[]; keyExtractor: (item: any) => string; renderItem: (input: { item: any; index: number }) => React.ReactNode }) => R.createElement("native-list", null, props.data.map((item, index) => R.createElement(R.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index })))),
    StyleSheet: { create: (styles: unknown) => styles }, Platform: { OS: "ios" }, AppState: mocks.appState,
  };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let actorId = 100;
let props: CompanyPhotoDraftInput;
const actor = (): JobSyncNativeSession => ({ token: `offline-only-batch-token-${actorId}`, portal: "company", user: { id: actorId, role: "owner", name: "Fixture", email: null }, company: { id: 9, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } });
const detail = (photos: any[] = []) => ({ id: 12, companyId: 9, assignedUserId: actorId, status: "scheduled", photos, persistedPhotoIds: photos.map((photo) => photo.id) }) as JobSyncCompanyJobDetail;
const asset = (id: number, patch: Record<string, unknown> = {}) => ({ uri: `file:///fixture/batch-${id}.jpg`, assetId: `asset-${id}`, type: "image", mimeType: "image/jpeg", fileSize: 512, ...patch });
const bytes = (id = 1) => Buffer.concat([Buffer.from([255, 216, 255, id]), Buffer.alloc(508)]).toString("base64");
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function nodes(name: string) { return all().filter((node) => node.nodeName.toLowerCase() === name); }
function button(label: string) {
  const result = nodes("native-touch").find((node) => node.nativeProps.accessibilityLabel === label);
  if (!result) throw new Error(`Missing ${label}: ${container.textContent}`);
  return result;
}
async function tap(node: NativeNode) { await act(async () => { node.nativeProps.onPress(); }); }
async function render(next = props) { await act(async () => { root.render(<CompanyJobPhotos {...next} job={{ ...next.job, refresh: async () => undefined }} onPreview={vi.fn()} />); }); }
async function settle<T>(wait: ReturnType<typeof deferred<T>>, value: T) { await act(async () => { wait.resolve(value); }); }
const writes = () => mocks.fetch.mock.calls.filter(([, init]) => init.method === "POST");
function server(options: { failAt?: number; missingAt?: number; delayAt?: number; delay?: ReturnType<typeof deferred<any>> } = {}) {
  const saved: any[] = [];
  let count = 0;
  const events: string[] = [];
  mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/auth/session")) { events.push("session"); return json(actor()); }
    if (init.method === "POST") {
      const index = ++count;
      events.push(`post:${index}`);
      const item = { id: index, imageUrl: `https://fixture.invalid/api/storage/batch-${index}?expires=300&signature=fresh-${index}`, uploadedByUserId: actorId, caption: null, createdAt: null };
      if (options.missingAt !== index) saved.unshift(item);
      if (options.delayAt === index) return options.delay!.promise;
      if (options.failAt === index) return json({ error: { code: "BAD_REQUEST", message: "Fixture failure after persistence" } }, 400);
      return json({ photo: item }, 201);
    }
    events.push(`read:${count}`);
    return json({ job: detail([...saved]) });
  });
  return { saved, events };
}
beforeEach(() => {
  actorId++;
  vi.resetAllMocks(); mocks.focused = true; mocks.appState.currentState = "active"; mocks.listeners.clear();
  mocks.appState.addEventListener.mockImplementation((_event, fn) => { mocks.listeners.add(fn); return { remove: () => mocks.listeners.delete(fn) }; });
  mocks.cameraPermission.mockResolvedValue({ granted: true }); mocks.libraryPermission.mockResolvedValue({ granted: true });
  mocks.camera.mockResolvedValue({ canceled: false, assets: [asset(1)] }); mocks.library.mockResolvedValue({ canceled: false, assets: [asset(1), asset(2), asset(3)] });
  mocks.info.mockResolvedValue({ exists: true, isDirectory: false, size: 512 });
  mocks.bytes.mockImplementation(async (uri: string) => bytes(Number(uri.match(/batch-(\d+)/)?.[1] ?? 1)));
  vi.stubGlobal("fetch", mocks.fetch);
  props = { session: actor(), jobId: 12, job: { detail: detail(), loading: false, pending: false, error: null } };
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe("Phase 2 multiple-photo selection and ordered upload (real React lifecycle, local mocked I/O)", () => {
  it("enables ordered library multiselect in one action, keeps camera single, and removes individual/all drafts", async () => {
    await render(); await tap(button("Library"));
    expect(mocks.library).toHaveBeenCalledWith(expect.objectContaining({ allowsMultipleSelection: true, orderedSelection: true, allowsEditing: false, base64: false }));
    expect(nodes("native-image").map((node) => node.nativeProps.source.uri)).toEqual([asset(1).uri, asset(2).uri, asset(3).uri]);
    expect(button("Upload local draft").textContent).toBe("Upload 3 photos");
    await tap(button("Remove local draft 2"));
    expect(nodes("native-image").map((node) => node.nativeProps.source.uri)).toEqual([asset(1).uri, asset(3).uri]);
    await tap(button("Discard local draft")); expect(nodes("native-image")).toHaveLength(0);
    await tap(button("Camera"));
    expect(mocks.camera).toHaveBeenCalledWith(expect.objectContaining({ allowsMultipleSelection: false }));
    expect(nodes("native-image")).toHaveLength(1); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("deduplicates repeated asset IDs and repeated URIs without reordering valid assets", async () => {
    mocks.library.mockResolvedValue({ canceled: false, assets: [asset(2), asset(1), asset(2, { uri: "file:///fixture/another-copy.jpg" }), asset(1, { assetId: "other-id" }), asset(3)] });
    server(); await render(); await tap(button("Library"));
    expect(mocks.info).toHaveBeenCalledTimes(3); expect(container.textContent).toContain("2 repeated selection(s) ignored");
    await tap(button("Upload local draft"));
    expect(writes().map(([, init]) => JSON.parse(init.body).base64)).toEqual([bytes(2), bytes(1), bytes(3)]);
    expect(container.textContent).toContain("3 of 3 photos uploaded");
  });
  it("uploads strictly sequentially, reads real bytes once per asset, checks fresh authority/readback per item and blocks repeated taps", async () => {
    const wait = deferred<any>(); const fixture = server({ delayAt: 1, delay: wait });
    await render(); await tap(button("Library")); const upload = button("Upload local draft");
    await act(async () => { upload.nativeProps.onPress(); upload.nativeProps.onPress(); upload.nativeProps.onPress(); });
    expect(writes()).toHaveLength(1); expect(mocks.bytes).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Uploading photo 1 of 3 · 0 confirmed");
    expect(button("Library").nativeProps.disabled).toBe(true);
    await tap(button("Library")); expect(mocks.library).toHaveBeenCalledTimes(1);
    await settle(wait, json({ photo: fixture.saved[0] }, 201));
    expect(writes()).toHaveLength(3); expect(mocks.bytes).toHaveBeenCalledTimes(3);
    expect(writes().map(([, init]) => JSON.parse(init.body).base64)).toEqual([bytes(1), bytes(2), bytes(3)]);
    expect(writes().every(([, init]) => init.headers.Authorization === `Bearer ${props.session!.token}`)).toBe(true);
    expect(fixture.events.filter((event) => event === "session")).toHaveLength(6);
    expect(fixture.events.indexOf("read:1")).toBeLessThan(fixture.events.indexOf("post:2"));
    expect(container.textContent).toContain("3 of 3 photos uploaded");
    expect(nodes("native-image")).toHaveLength(3);
    expect(nodes("native-image").every((node) => node.nativeProps.source.uri.includes("signature=fresh"))).toBe(true);
    expect(props.job.detail!.photos).toEqual([]);
    await tap(upload); expect(writes()).toHaveLength(3);
  });
  it.each([{ failAt: 2 }, { missingAt: 2 }])("stops on partial unconfirmed upload %# and retains only unstarted drafts with no blind retry", async (options) => {
    server(options); await render(); await tap(button("Library")); await tap(button("Upload local draft"));
    expect(writes()).toHaveLength(2); expect(mocks.bytes).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("1 of 3 photos confirmed. Batch stopped");
    expect(container.textContent).toContain("1 unstarted local draft(s) retained");
    const localImages = nodes("native-image").filter((node) => node.nativeProps.source.uri.startsWith("file:"));
    expect(localImages.map((node) => node.nativeProps.source.uri)).toEqual([asset(3).uri]);
    expect(container.textContent).toMatch(/uncertain|does not confirm/);
    await tap(button("Upload local draft"));
    expect(writes()).toHaveLength(3); expect(JSON.parse(writes()[2][1].body).base64).toBe(bytes(3));
  });
  it("retains valid selections when another selected image fails native URI validation, never guessing a ph URI", async () => {
    mocks.library.mockResolvedValue({ canceled: false, assets: [asset(1), asset(2, { uri: "ph://unresolved-native-asset" }), asset(3)] });
    await render(); await tap(button("Library"));
    expect(container.textContent).toContain("readable local file"); expect(nodes("native-image")).toHaveLength(2);
    expect(mocks.info).not.toHaveBeenCalledWith("ph://unresolved-native-asset"); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each(["Company", "token", "role", "Job", "blur", "pending", "reassignment"])("cancels remaining uploads and stale callbacks after %s change", async (change) => {
    const wait = deferred<any>(); const fixture = server({ delayAt: 1, delay: wait });
    await render(); await tap(button("Library")); const oldUpload = button("Upload local draft"); await tap(oldUpload);
    const next = { ...props, session: { ...props.session!, user: { ...props.session!.user }, company: { ...props.session!.company! } }, job: { ...props.job, detail: { ...props.job.detail! } } };
    if (change === "Company") { next.session.company.id = 10; next.job.detail.companyId = 10; }
    if (change === "token") next.session.token = "rotated-offline-token";
    if (change === "role") next.session.user.role = "dispatcher";
    if (change === "Job") { next.jobId = 13; next.job.detail.id = 13; }
    if (change === "blur") mocks.focused = false;
    if (change === "pending") next.job.pending = true;
    if (change === "reassignment") { next.session.user.role = "technician"; next.job.detail.assignedUserId = 99; }
    await render(next); mocks.focused = true; await render(); await tap(oldUpload);
    await settle(wait, json({ photo: fixture.saved[0] }, 201));
    expect(writes()).toHaveLength(1); expect(mocks.bytes).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("local draft"); expect(container.textContent).not.toContain("photos uploaded");
  });
  it("reopened same actor and rotated session cannot duplicate an in-flight upload; later deliberate new action works", async () => {
    const wait = deferred<any>(); const fixture = server({ delayAt: 1, delay: wait });
    await render(); await tap(button("Library")); await tap(button("Upload local draft"));
    await act(async () => root.render(<div />));
    const rotated = { ...props, session: { ...props.session!, token: "rotated-offline-token" } };
    await render(rotated); expect(button("Library").nativeProps.disabled).toBe(true);
    await tap(button("Library")); expect(mocks.library).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(1);
    await settle(wait, json({ photo: fixture.saved[0] }, 201));
    await render(); expect(button("Library").nativeProps.disabled).toBe(false);
    mocks.library.mockResolvedValue({ canceled: false, assets: [asset(3)] });
    await tap(button("Library")); await tap(button("Upload local draft")); expect(writes()).toHaveLength(2);
  });
  it("AppState background permanently invalidates queued work and picker results even after foreground return", async () => {
    const wait = deferred<any>(); const fixture = server({ delayAt: 1, delay: wait });
    await render(); await tap(button("Library")); await tap(button("Upload local draft"));
    await act(async () => { mocks.appState.currentState = "background"; mocks.listeners.forEach((fn) => fn("background")); });
    expect(button("Library").nativeProps.disabled).toBe(true);
    await act(async () => { mocks.appState.currentState = "active"; mocks.listeners.forEach((fn) => fn("active")); });
    await settle(wait, json({ photo: fixture.saved[0] }, 201));
    expect(writes()).toHaveLength(1); expect(container.textContent).not.toContain("photos uploaded");
    await render({ ...props, job: { ...props.job, detail: detail() } });
    const pick = deferred<any>(); mocks.library.mockReturnValueOnce(pick.promise); await tap(button("Library"));
    await act(async () => { mocks.appState.currentState = "background"; mocks.listeners.forEach((fn) => fn("background")); mocks.appState.currentState = "active"; mocks.listeners.forEach((fn) => fn("active")); });
    await settle(pick, { canceled: false, assets: [asset(3)] });
    expect(nodes("native-image")).toHaveLength(0);
  });
  it("batch survives its own canonical parent refresh/loading without starting concurrent writes", async () => {
    server(); let refreshCount = 0;
    function Sheet() {
      const [loading, setLoading] = React.useState(false);
      const refresh = async () => { refreshCount++; setLoading(true); await Promise.resolve(); setLoading(false); };
      return <CompanyJobPhotos {...props} job={{ ...props.job, detail: loading ? null : props.job.detail, loading, refresh }} onRefresh={refresh} onPreview={vi.fn()} />;
    }
    await act(async () => root.render(<Sheet />)); await tap(button("Library")); await tap(button("Upload local draft"));
    expect(writes()).toHaveLength(3); expect(refreshCount).toBe(3); expect(container.textContent).toContain("3 of 3 photos uploaded");
  });
  it("actual parent hook accepts final signed batch readback, and a later canonical read supersedes it", async () => {
    const fixture = server();
    let latest!: ReturnType<typeof useCompanyJob>;
    function Sheet() {
      const job = useCompanyJob(props.session, props.jobId);
      latest = job;
      return <CompanyJobPhotos {...props} job={job} onRefresh={job.refresh} onPreview={vi.fn()} />;
    }
    await act(async () => root.render(<Sheet />)); await tap(button("Library")); await tap(button("Upload local draft"));
    expect(writes()).toHaveLength(3);
    expect(latest.verifiedPhotoDetail?.photos.map((photo) => photo.id)).toEqual([3, 2, 1]);
    expect(nodes("native-image")).toHaveLength(3);
    fixture.saved.splice(0, fixture.saved.length);
    await act(async () => { await latest.refresh(); });
    expect(latest.verifiedPhotoDetail).toBeNull(); expect(nodes("native-image")).toHaveLength(0);
    expect(container.textContent).toContain("No before & after photos yet.");
  });
  it("retains only unstarted drafts across a delayed own refresh and permits later deliberate removal/upload", async () => {
    const wait = deferred<any>();
    const onUploadBatch = vi.fn().mockReturnValueOnce(wait.promise).mockResolvedValue({ confirmed: 1, total: 1, remaining: [], stopped: false });
    await act(async () => root.render(<CompanyPhotoDraft {...props} onUploadBatch={onUploadBatch} />));
    await tap(button("Library"));
    const oldUpload = button("Upload local draft");
    await tap(oldUpload);
    const selected = onUploadBatch.mock.calls[0][0];
    await act(async () => root.render(<CompanyPhotoDraft {...props} job={{ ...props.job, loading: true, detail: null }} operationPending onUploadBatch={onUploadBatch} />));
    await settle(wait, { confirmed: 0, total: 3, remaining: selected.slice(1), stopped: true });
    expect(nodes("native-image")).toHaveLength(0);
    await act(async () => root.render(<CompanyPhotoDraft {...props} onUploadBatch={onUploadBatch} />));
    expect(nodes("native-image").map((node) => node.nativeProps.source.uri)).toEqual([asset(2).uri, asset(3).uri]);
    await tap(oldUpload);
    expect(onUploadBatch).toHaveBeenCalledTimes(1);
    await tap(button("Remove local draft 1"));
    expect(nodes("native-image").map((node) => node.nativeProps.source.uri)).toEqual([asset(3).uri]);
    await tap(button("Upload local draft"));
    expect(onUploadBatch).toHaveBeenCalledTimes(2);
    expect(onUploadBatch.mock.calls[1][0].map((draft: { uri: string }) => draft.uri)).toEqual([asset(3).uri]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("cannot resurrect removal confirmation after parent pending clears with the exact same detail object", async () => {
    const saved = { id: 1, imageUrl: "https://fixture.invalid/api/storage/photo?expires=300&signature=fresh", uploadedByUserId: actorId, caption: null, createdAt: null };
    props = { ...props, job: { ...props.job, detail: detail([saved]) } };
    await render(); await tap(button("Remove Job photo 1"));
    const oldConfirm = button("Confirm remove photo from Job");
    await render({ ...props, job: { ...props.job, pending: true } });
    await render();
    expect(nodes("native-touch").some((node) => node.nativeProps.accessibilityLabel === "Confirm remove photo from Job")).toBe(false);
    await tap(oldConfirm);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("non-remounted technician batch permanently stops after reassignment away and back to the same detail", async () => {
    const wait = deferred<boolean>();
    const onUpload = vi.fn().mockReturnValueOnce(wait.promise).mockResolvedValue(true);
    const session = { ...props.session!, user: { ...props.session!.user, role: "technician" as const } };
    const original = { ...props, session, onUpload, onRefresh: async () => undefined };
    let latest!: ReturnType<typeof useCompanyPhotoBatch>;
    function Batch({ input }: { input: typeof original }) { latest = useCompanyPhotoBatch(input); return null; }
    await act(async () => root.render(<Batch input={original} />));
    const prepared = await prepareCompanyPhotoBatch([asset(1), asset(2), asset(3)], mocks.info, () => true);
    let result!: ReturnType<typeof latest.upload>;
    await act(async () => { result = latest.upload(prepared.drafts); });
    expect(onUpload).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Batch input={{ ...original, job: { ...original.job, detail: { ...original.job.detail!, assignedUserId: 99 } } }} />));
    await act(async () => root.render(<Batch input={original} />));
    await settle(wait, true);
    expect((await result).stopped).toBe(true);
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(latest.message).toBeNull(); expect(latest.progress).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("passes captured Before/After categories through local queue snapshots unchanged without inventing backend fields", async () => {
    const before = await prepareCompanyPhotoBatch([asset(1), asset(2)], mocks.info, () => true, "before");
    const after = await prepareCompanyPhotoBatch([asset(3)], mocks.info, () => true, "after");
    const seen: string[] = [];
    const result = await uploadCompanyPhotoBatch({ actor: `local-category-${actorId}`, drafts: [...before.drafts, ...after.drafts], isCurrent: () => true, uploadOne: async (draft) => { seen.push(`${draft.uri}:${(draft as typeof before.drafts[0]).category}`); return true; }, onProgress: vi.fn() });
    expect(seen).toEqual([`${asset(1).uri}:before`, `${asset(2).uri}:before`, `${asset(3).uri}:after`]);
    expect(result.confirmed).toBe(3); expect(mocks.fetch).not.toHaveBeenCalled();
    const onUpload = vi.fn().mockResolvedValue(true);
    await act(async () => root.render(<CompanyPhotoDraft {...props} category="after" onUpload={onUpload} />));
    await tap(button("Library")); await tap(button("Upload local draft"));
    expect(onUpload.mock.calls.map(([draft]) => draft.category)).toEqual(["after", "after", "after"]);
  });
});
