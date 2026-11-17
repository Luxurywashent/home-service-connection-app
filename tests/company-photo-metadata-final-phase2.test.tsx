import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyPhotoDraft } from "../components/company-photo-draft";
import { CompanyJobPhotos } from "../components/company-job-photos";
import { prepareCompanyPhotoBatch } from "../lib/company-photo-batch";
import { createCompanyPhotoOperation, type CompanyPhotoOperationApi, type CompanyPhotoOperationState } from "../lib/company-photo-operation";
import { companyPhotoCategoryLabel, nextCompanyPhotoDisplayOrder, type CompanyPhotoMetadata } from "../lib/company-photo-view";
import { normalizeJobSyncCompanyJobDetail, uploadJobSyncCompanyJobPhoto, type JobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";
import type { CompanyPhotoDraftInput } from "../lib/company-photo-draft";
const mocks = vi.hoisted(() => ({ focused: true, library: vi.fn(), camera: vi.fn(), info: vi.fn(), bytes: vi.fn(), fetch: vi.fn() }));
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused }));
vi.mock("expo-image-picker", () => ({ requestCameraPermissionsAsync: async () => ({ granted: true }), requestMediaLibraryPermissionsAsync: async () => ({ granted: true }), launchCameraAsync: mocks.camera, launchImageLibraryAsync: mocks.library }));
vi.mock("expo-file-system/legacy", () => ({ getInfoAsync: mocks.info, readAsStringAsync: mocks.bytes, EncodingType: { Base64: "base64" } }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ primary: "blue", foreground: "white", muted: "gray", error: "red", surface: "black", background: "black", border: "gray" }) }));
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, unknown>) => R.createElement(name, { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; } }, props.children as React.ReactNode);
  return {
    ActivityIndicator: host("activity-indicator"), Image: host("native-image"), Text: host("native-text"), TouchableOpacity: host("native-touch"), View: host("native-view"),
    FlatList: (props: { data: unknown[]; keyExtractor: (item: never) => string; renderItem: (input: { item: never; index: number }) => React.ReactNode }) => R.createElement("native-list", null, props.data.map((item, index) => R.createElement(R.Fragment, { key: props.keyExtractor(item as never) }, props.renderItem({ item: item as never, index })))),
    StyleSheet: { create: (styles: unknown) => styles }, Platform: { OS: "ios" }, AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
  };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
const actor: JobSyncNativeSession = { token: "offline-metadata-token", portal: "company", user: { id: 42, role: "owner", name: "Fixture", email: null }, company: { id: 9, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } };
const bytes = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(509)]).toString("base64");
const asset = (id: number) => ({ uri: `file:///fixture/metadata-${id}.jpg`, assetId: String(id), type: "image", mimeType: "image/jpeg", fileSize: 512 });
const photo = (id: number, metadata: CompanyPhotoMetadata = {}) => ({ id, imageUrl: `https://fixture.invalid/api/storage/metadata-${id}?expires=300&signature=fixture`, caption: null, uploadedByUserId: 42, createdAt: null, ...metadata });
const detail = (photos: ReturnType<typeof photo>[] = []) => ({ id: 12, companyId: 9, assignedUserId: 42, status: "scheduled", photos, persistedPhotoIds: photos.map((item) => item.id) }) as JobSyncCompanyJobDetail;
const props = (photos: ReturnType<typeof photo>[] = []): CompanyPhotoDraftInput => ({ session: actor, jobId: 12, job: { detail: detail(photos), loading: false, pending: false, error: null } });
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function button(label: string) { const node = all().find((item) => item.nativeProps?.accessibilityLabel === label && item.nodeName === "NATIVE-TOUCH"); if (!node) throw new Error(`Missing ${label}`); return node; }
async function tap(label: string) { await act(async () => { button(label).nativeProps.onPress(); }); }
function setupOperation(initial = detail(), responsePhoto = photo(99, { category: "before", displayOrder: 1 }), readback = detail([responsePhoto])) {
  const states: CompanyPhotoOperationState[] = [];
  const api = { session: vi.fn().mockResolvedValue(actor), detail: vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(readback), upload: vi.fn().mockResolvedValue({ photo: responsePhoto }), remove: vi.fn() };
  const operation = createCompanyPhotoOperation({ session: actor, jobId: 12, api: api as CompanyPhotoOperationApi, encode: async () => ({ contentType: "image/jpeg", base64: bytes }), isCurrent: () => true, onState: (state) => states.push(state), onRefresh: async () => undefined });
  return { api, operation, last: () => states.at(-1)! };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.focused = true;
  mocks.library.mockResolvedValue({ canceled: false, assets: [asset(1), asset(2)] }); mocks.camera.mockResolvedValue({ canceled: false, assets: [asset(3)] });
  mocks.info.mockResolvedValue({ exists: true, isDirectory: false, size: 512 }); mocks.bytes.mockResolvedValue(bytes);
  vi.stubGlobal("fetch", mocks.fetch);
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe("exact f3576bcb metadata wire contract (offline fixtures only)", () => {
  it.each(["before", "after", "damage", "other"] as const)("retains canonical %s category/order and independent null caption", (category) => {
    const normalized = normalizeJobSyncCompanyJobDetail({ job: detail([photo(1, { category, displayOrder: 8 })]) }, 12, 9);
    expect(normalized?.photos[0]).toMatchObject({ category, displayOrder: 8, caption: null });
  });
  it("preserves missing/null legacy metadata and canonical server array order", () => {
    const photos = [photo(3), photo(2, { category: null, displayOrder: null }), photo(1, { category: "damage", displayOrder: 9 })];
    const normalized = normalizeJobSyncCompanyJobDetail({ job: detail(photos) }, 12, 9)!;
    expect(normalized.photos.map((item) => item.id)).toEqual([3, 2, 1]);
    expect((normalized.photos[0] as CompanyPhotoMetadata).category).toBeUndefined();
    expect(normalized.photos[1]).toMatchObject({ category: null, displayOrder: null });
    expect(companyPhotoCategoryLabel(normalized.photos[0])).toBeNull();
  });
  it.each([{ category: "unknown" }, { category: "Before" }, { displayOrder: -1 }, { displayOrder: 100001 }, { displayOrder: 1.5 }, { displayOrder: "2" }])("does not establish canonical detail from malformed explicit metadata %j", (metadata) => {
    expect(normalizeJobSyncCompanyJobDetail({ job: detail([{ ...photo(1), ...metadata } as ReturnType<typeof photo>]) }, 12, 9)).toBeNull();
  });
  it("serializes exact camelCase metadata without manufacturing caption or altering actual bytes", async () => {
    mocks.fetch.mockResolvedValue(json({ photo: photo(1, { category: "damage", displayOrder: 15 }) }, 201));
    const payload = { contentType: "image/jpeg" as const, base64: bytes, category: "damage" as const, displayOrder: 15 };
    const response = await uploadJobSyncCompanyJobPhoto(actor.token, 12, payload);
    expect(JSON.parse(String(mocks.fetch.mock.calls[0][1].body))).toEqual(payload);
    expect(response.photo).toMatchObject({ category: "damage", displayOrder: 15, caption: null });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{ category: "after", displayOrder: 15 }, { category: "damage", displayOrder: 0 }, {}])("rejects incomplete/mismatching metadata ack with one POST %j", async (metadata) => {
    mocks.fetch.mockResolvedValue(json({ photo: photo(1, metadata as CompanyPhotoMetadata) }, 201));
    const input = { contentType: "image/jpeg" as const, base64: bytes, category: "damage" as const, displayOrder: 15 };
    await expect(uploadJobSyncCompanyJobPhoto(actor.token, 12, input)).rejects.toThrow();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("persistent category/order binding and safe append allocation", () => {
  it("allocates after canonical max, preserves legacy defaults, and never mutates original array", () => {
    const original = detail([photo(5, { displayOrder: 14 }), photo(3), photo(2, { displayOrder: null })]);
    expect(nextCompanyPhotoDisplayOrder(original)).toBe(15); expect(original.photos.map((item) => item.id)).toEqual([5, 3, 2]);
    expect(nextCompanyPhotoDisplayOrder(detail())).toBe(1);
    expect(nextCompanyPhotoDisplayOrder(detail([photo(1)]))).toBe(1);
    expect(nextCompanyPhotoDisplayOrder(detail([photo(1, { displayOrder: 99999 })]))).toBe(100000);
  });
  it.each([-1, 1.5, 100000, 100001, NaN, Infinity, "4"])("never recycles/guesses unsupported existing order %s", async (displayOrder) => {
    const initial = detail([photo(1, { displayOrder: displayOrder as number })]);
    const test = setupOperation(initial);
    expect(await test.operation.upload({ uri: asset(1).uri, mimeType: "image/jpeg", size: 512, category: "before" })).toBe(false);
    expect(test.api.upload).not.toHaveBeenCalled(); expect(test.last().error).toContain("No photo request was sent");
  });
  it("does not allocate from incomplete renderable metadata while persisted IDs include hidden photo", async () => {
    const initial = { ...detail(), persistedPhotoIds: [1] };
    const test = setupOperation(initial);
    expect(await test.operation.upload({ uri: asset(1).uri, mimeType: "image/jpeg", size: 512, category: "before" })).toBe(false);
    expect(test.api.upload).not.toHaveBeenCalled();
  });
  it.each([{ category: "after", displayOrder: 1 }, { category: "before", displayOrder: 0 }, {}])("never accepts a mismatching bare acknowledgement even when signed readback has intended metadata %j", async (metadata) => {
    const test = setupOperation(detail(), photo(99, metadata as CompanyPhotoMetadata), detail([photo(99, { category: "before", displayOrder: 1 })]));
    expect(await test.operation.upload({ uri: asset(1).uri, mimeType: "image/jpeg", size: 512, category: "before" })).toBe(false);
    expect(test.api.upload).toHaveBeenCalledTimes(1); expect(test.last().message).toBeNull();
    expect(test.last().error).toContain("uncertain");
  });
  it("does not send an unsupported category or silently default invalid intent", async () => {
    const test = setupOperation();
    expect(await test.operation.upload({ uri: asset(1).uri, mimeType: "image/jpeg", size: 512, category: "unknown" as "before" })).toBe(false);
    expect(test.api.upload).not.toHaveBeenCalled(); expect(test.last().error).toContain("No photo request was sent");
  });
  it("requires metadata+uploader bound to the acknowledged ID, not a same-caption/category different photo", async () => {
    const test = setupOperation(detail(), photo(99, { category: "before", displayOrder: 1 }), detail([photo(88, { category: "before", displayOrder: 1 })]));
    expect(await test.operation.upload({ uri: asset(1).uri, mimeType: "image/jpeg", size: 512, category: "before" })).toBe(false);
    expect(test.api.upload).toHaveBeenCalledTimes(1); expect(test.last().message).toBeNull();
  });
  it.each([{ category: "after", displayOrder: 1 }, { category: "before", displayOrder: 0 }, {}, { category: "before", displayOrder: 1, uploadedByUserId: 77 }])("signed readback mismatch is never successful %j", async (metadata) => {
    const test = setupOperation(detail(), photo(99, { category: "before", displayOrder: 1 }), detail([{ ...photo(99), ...metadata } as ReturnType<typeof photo>]));
    expect(await test.operation.upload({ uri: asset(1).uri, mimeType: "image/jpeg", size: 512, category: "before" })).toBe(false);
    expect(test.api.upload).toHaveBeenCalledTimes(1); expect(test.last().error).toContain("does not confirm");
  });
  it("captures intent before async preflight, appends after fresh detail, and reads canonical rather than ack URL", async () => {
    const ack = photo(99, { category: "before", displayOrder: 16 });
    const returned = { ...ack, imageUrl: "https://fixture.invalid/api/storage/readback?expires=400&signature=new" };
    const test = setupOperation(detail([photo(1, { displayOrder: 15 })]), ack, detail([photo(1, { displayOrder: 15 }), returned]));
    const draft = { uri: asset(1).uri, mimeType: "image/jpeg" as const, size: 512, category: "before" as "before" | "after" };
    const running = test.operation.upload(draft); draft.category = "after";
    expect(await running).toBe(true);
    expect(test.api.upload).toHaveBeenCalledWith(actor.token, 12, { contentType: "image/jpeg", base64: bytes, category: "before", displayOrder: 16 });
    expect(test.last().detail?.photos[1].imageUrl).toBe(returned.imageUrl);
  });
  it("rejects recycled pre-existing upload ID even if metadata matches", async () => {
    const test = setupOperation(detail([photo(99)]));
    expect(await test.operation.upload({ uri: asset(1).uri, mimeType: "image/jpeg", size: 512, category: "before" })).toBe(false);
    expect(test.api.upload).toHaveBeenCalledTimes(1); expect(test.last().message).toBeNull();
  });
  it("accepts fresh canonical ID metadata despite a cross-client equal order, leaving server tie order intact", async () => {
    const ack = photo(99, { category: "before", displayOrder: 1 });
    const readback = detail([photo(100, { category: "damage", displayOrder: 1 }), ack]);
    const test = setupOperation(detail(), ack, readback);
    expect(await test.operation.upload({ uri: asset(1).uri, mimeType: "image/jpeg", size: 512, category: "before" })).toBe(true);
    expect(test.last().detail?.photos.map((item) => item.id)).toEqual([100, 99]);
    expect(test.api.upload).toHaveBeenCalledTimes(1);
  });
});

describe("compact categories and canonical gallery refresh", () => {
  it.each(["before", "after", "damage", "other"] as const)("captures %s across all library images and single camera", async (category) => {
    const onUploadBatch = vi.fn().mockResolvedValue({ confirmed: 2, total: 2, remaining: [], stopped: false });
    await act(async () => root.render(<CompanyPhotoDraft {...props()} onUploadBatch={onUploadBatch} />));
    await tap(`Photo category ${companyPhotoCategoryLabel({ category })}`); await tap("Library");
    await tap("Photo category Other"); // Changes only the next selection, never existing drafts.
    await tap("Upload local draft");
    expect(onUploadBatch.mock.calls[0][0].map((draft: { category: string }) => draft.category)).toEqual([category, category]);
    await tap(`Photo category ${companyPhotoCategoryLabel({ category })}`); await tap("Camera"); await tap("Upload local draft");
    expect(onUploadBatch.mock.calls[1][0]).toHaveLength(1); expect(onUploadBatch.mock.calls[1][0][0].category).toBe(category);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("defaults to Other rather than inferring Before/After from Job status", async () => {
    const prepared = await prepareCompanyPhotoBatch([asset(1), asset(2)], mocks.info, () => true, "other");
    expect(prepared.drafts.map((draft) => draft.category)).toEqual(["other", "other"]);
    const onUploadBatch = vi.fn().mockResolvedValue({ confirmed: 2, total: 2, remaining: [], stopped: false });
    await act(async () => root.render(<CompanyPhotoDraft {...props()} onUploadBatch={onUploadBatch} />));
    expect(button("Photo category Other").nativeProps.accessibilityState.selected).toBe(true);
    await tap("Library"); await tap("Upload local draft");
    expect(onUploadBatch.mock.calls[0][0].every((draft: { category: string }) => draft.category === "other")).toBe(true);
  });
  it("persists sequential ordered batch, refreshes labels from canonical detail, and preserves old photos/null captions", async () => {
    const saved = [photo(50)];
    mocks.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
      if (_url.endsWith("/auth/session")) return json(actor);
      if (init.method === "POST") {
        const body = JSON.parse(String(init.body));
        const item = photo(50 + saved.length, { category: body.category ?? "other", displayOrder: body.displayOrder ?? 0 });
        saved.push(item); return json({ photo: item }, 201);
      }
      return json({ job: detail([...saved]) });
    });
    await act(async () => root.render(<CompanyJobPhotos {...props([photo(50)])} job={{ ...props([photo(50)]).job, refresh: async () => undefined }} onPreview={vi.fn()} />));
    await tap("Photo category Before"); await tap("Library"); await tap("Upload local draft");
    const writes = mocks.fetch.mock.calls.filter(([, init]) => init.method === "POST");
    expect(writes.map(([, init]) => JSON.parse(String(init.body)))).toEqual([1, 2].map((displayOrder) => ({ contentType: "image/jpeg", base64: bytes, category: "before", displayOrder })));
    expect(container.textContent).toContain("2 of 2 photos uploaded");
    expect(saved.map((item) => item.caption)).toEqual([null, null, null]);
    // Later canonical refresh supersedes prior verified labels, including null metadata.
    const refreshed = [photo(50), photo(51, { category: "after", displayOrder: 1 }), photo(52, { category: null, displayOrder: null })];
    await act(async () => root.render(<CompanyJobPhotos {...props(refreshed)} job={{ ...props(refreshed).job, refresh: async () => undefined }} onPreview={vi.fn()} />));
    const galleryLabels = all().filter((item) => item.nodeName === "NATIVE-TEXT" && item.parentNode?.childNodes.some((child) => child.nodeName === "NATIVE-VIEW") && ["Before", "After"].includes(item.textContent));
    expect(galleryLabels.some((item) => item.textContent === "After")).toBe(true);
  });
});
