import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyJobPhotos } from "../components/company-job-photos";
import { CompanyPhotoDraft } from "../components/company-photo-draft";
import { COMPANY_PHOTO_DRAFT_LABEL } from "../lib/company-photo-draft";
import type { JobSyncCompanyJobDetail, JobSyncJobPhoto, JobSyncNativeSession } from "../lib/jobsync-mobile-api";

// Real React state/effects and real photo-operation code; only native hosts and I/O are mocked.
const mocks = vi.hoisted(() => ({
  focused: true, platform: { OS: "ios" },
  cameraPermission: vi.fn(), libraryPermission: vi.fn(), camera: vi.fn(), library: vi.fn(),
  info: vi.fn(), bytes: vi.fn(), fetch: vi.fn(),
}));
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused }));
vi.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: mocks.cameraPermission,
  requestMediaLibraryPermissionsAsync: mocks.libraryPermission,
  launchCameraAsync: mocks.camera, launchImageLibraryAsync: mocks.library,
}));
vi.mock("expo-file-system/legacy", () => ({ getInfoAsync: mocks.info, readAsStringAsync: mocks.bytes, EncodingType: { Base64: "base64" } }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({
  primary: "#4D8DFF", background: "#07111F", surface: "#102038", border: "#243754",
  foreground: "#F6F8FC", muted: "#94A3B8", error: "#F06A6A", success: "#52D3B8",
}) }));
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, unknown>) => R.createElement(name, {
    ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
  }, props.children as React.ReactNode);
  return {
    ActivityIndicator: host("activity-indicator"), Image: host("native-image"), Text: host("native-text"),
    TouchableOpacity: host("native-touch"), View: host("native-view"),
    FlatList: (props: { data: JobSyncJobPhoto[]; keyExtractor: (item: JobSyncJobPhoto) => string; renderItem: (input: { item: JobSyncJobPhoto }) => React.ReactNode }) => R.createElement("native-list", {
      ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
    }, props.data.map((item) => R.createElement(R.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item })))),
    StyleSheet: { create: (styles: unknown) => styles }, Platform: mocks.platform,
  };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
const session = (): JobSyncNativeSession => ({
  token: "design-fixture-only-token", portal: "company", user: { id: 42, role: "owner", name: "Fixture", email: null },
  company: { id: 9, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null },
});
const photo = (id = 1, signature = "A"): JobSyncJobPhoto => ({
  id, imageUrl: `https://fixture.invalid/api/storage/photo-${id}?expires=300&signature=${signature}`,
  caption: `Photo ${id}`, uploadedByUserId: 42, createdAt: null,
});
const detail = (photos: JobSyncJobPhoto[] = [], patch: Partial<JobSyncCompanyJobDetail> = {}) => ({
  id: 12, companyId: 9, assignedUserId: 42, status: "scheduled", photos, persistedPhotoIds: photos.map((item) => item.id), ...patch,
}) as JobSyncCompanyJobDetail;
const job = (d = detail()) => ({ detail: d, loading: false, pending: false, error: null as string | null, refresh: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) });
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function nodes(name: string) { return all().filter((node) => node.nodeName.toLowerCase() === name); }
function button(label: string) {
  const found = nodes("native-touch").find((node) => node.nativeProps.accessibilityLabel === label || node.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}; text=${container.textContent}`);
  return found;
}
function text(value: string) {
  const found = nodes("native-text").find((node) => node.textContent === value);
  if (!found) throw new Error(`Missing text: ${value}; text=${container.textContent}`);
  return found;
}
function style(node: NativeNode) {
  const flatten = (value: any): any => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value || {};
  return flatten(node.nativeProps.style);
}
async function render(element: React.ReactNode) { await act(async () => { root.render(element); }); }
async function event(node: NativeNode, name = "onPress") { await act(async () => { node.nativeProps[name]?.(); }); }
function gallery(props: Partial<React.ComponentProps<typeof CompanyJobPhotos>> = {}) {
  return <CompanyJobPhotos session={session()} jobId={12} job={job()} onPreview={vi.fn()} {...props} />;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
const asset = { uri: "file:///fixture/photo.jpg", type: "image", mimeType: "image/jpeg", fileSize: 512 };
const bytes = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(509)]).toString("base64");
function photoServer() {
  let stored = [photo()];
  const json = (payload: unknown, status = 200) => ({ ok: true, status, json: async () => payload });
  mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/auth/session")) return json(session());
    if (init.method === "DELETE") { stored = []; return json({ success: true }); }
    if (init.method === "POST") { const body = JSON.parse(String(init.body)); const saved = { ...photo(2, "uploaded"), caption: null, category: body.category ?? "other", displayOrder: body.displayOrder ?? 0 }; stored = [...stored, saved]; return json({ photo: saved }, 201); }
    return json({ job: detail(stored) });
  });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.focused = true; mocks.platform.OS = "ios";
  mocks.cameraPermission.mockResolvedValue({ granted: true }); mocks.libraryPermission.mockResolvedValue({ granted: true });
  mocks.camera.mockResolvedValue({ canceled: false, assets: [asset] }); mocks.library.mockResolvedValue({ canceled: false, assets: [asset] });
  mocks.info.mockResolvedValue({ exists: true, isDirectory: false, size: 512 }); mocks.bytes.mockResolvedValue(bytes);
  vi.stubGlobal("fetch", mocks.fetch);
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); }); vi.unstubAllGlobals(); });

describe("restored Company photo gallery design (real React)", () => {
  it("places muted uppercase 11px heading left and both pills right in the same header", async () => {
    await render(gallery());
    const heading = text("BEFORE & AFTER PHOTOS (0)");
    const camera = button("Camera"); const library = button("Library");
    expect(camera.parentNode).toBe(library.parentNode);
    expect(camera.parentNode?.parentNode).toBe(heading.parentNode);
    expect(style(heading)).toMatchObject({ fontSize: 11, color: "#a5a9b2", textTransform: "uppercase" });
    expect(style(heading.parentNode as NativeNode)).toMatchObject({ flexDirection: "row", alignItems: "center", justifyContent: "space-between" });
    expect(style(camera)).toMatchObject({ borderRadius: 20, backgroundColor: "#0068ff" });
    expect(style(library)).toMatchObject({ borderRadius: 20, backgroundColor: "#1c2028", borderWidth: 1, borderColor: "#2e333c" });
    expect(style(camera.childNodes[0] as NativeNode).fontSize).toBe(13);
    expect(camera.nativeProps.className).toBeUndefined(); expect(library.nativeProps.className).toBeUndefined();
  });
  it("uses a dashed rounded empty box only for authoritative complete-ID emptiness", async () => {
    await render(gallery());
    const empty = text("No before & after photos yet.");
    expect(style(empty.parentNode as NativeNode)).toMatchObject({ borderStyle: "dashed", borderRadius: 10, borderWidth: 1, paddingVertical: 20 });
    expect(container.textContent).not.toContain("Long-press");
  });
  it("does not mistake missing complete IDs or inaccessible detail for emptiness", async () => {
    await render(gallery({ job: job(detail([], { persistedPhotoIds: undefined })) }));
    expect(container.textContent).not.toContain("No before & after photos yet.");
    expect(container.textContent).toContain("Photos unavailable");
    await render(gallery({ session: null }));
    expect(container.textContent).not.toContain("No before & after photos yet.");
    expect(button("Camera").nativeProps.disabled).toBe(true);
    expect(button("Refresh photos").nativeProps.disabled).toBe(true);
  });
  it("counts all persisted IDs without rendering hidden images or calling the gallery empty", async () => {
    await render(gallery({ job: job(detail([photo()], { persistedPhotoIds: [1, 7] })) }));
    expect(container.textContent).toContain("BEFORE & AFTER PHOTOS (2)");
    expect(container.textContent).toContain("Some photo images are unavailable");
    expect(nodes("native-image")).toHaveLength(1);
    expect(container.textContent).not.toContain("No before & after photos yet.");
    await render(gallery({ job: job(detail([], { persistedPhotoIds: [7] })) }));
    expect(container.textContent).toContain("BEFORE & AFTER PHOTOS (1)");
    expect(container.textContent).toContain("Stored photo images are unavailable");
    expect(container.textContent).not.toContain("No before & after photos yet.");
  });
  it.each([{ photos: [] }, { photos: [photo()] }])("does not display idle backend, file-size, CORS or signed-link diagnostics %#", async ({ photos }) => {
    await render(gallery({ job: job(detail(photos)) }));
    expect(container.textContent).not.toMatch(/signed Company account|15 MiB|HEIC|CORS|signed link|server deletion|fresh signed access/i);
    expect(button("Refresh photos").nativeProps.accessibilityRole).toBe("button");
    expect(style(button("Refresh photos"))).toMatchObject({ paddingVertical: 4 });
    expect(container.textContent).not.toContain(session().token);
  });
  it("uses compact help only for native photos the current account can remove", async () => {
    await render(gallery({ job: job(detail([photo()])) }));
    expect(style(text("Long-press a photo to delete it."))).toMatchObject({ fontSize: 11 });
    expect(button("Remove Job photo 1").textContent).toBe("Remove");
    expect(style(button("Remove Job photo 1"))).toMatchObject({ paddingVertical: 6 });
    expect(nodes("native-list")[0].nativeProps.showsHorizontalScrollIndicator).toBe(false);
    expect(style(nodes("native-image")[0])).toMatchObject({ width: 90, height: 90, borderRadius: 8 });
  });
  it.each(["web", "other uploader", "unknown uploader"])("hides deletion help and rejects long-press for %s", async (reason) => {
    const actor = session(); let item = photo();
    if (reason === "web") mocks.platform.OS = "web";
    if (reason === "other uploader") { actor.user.role = "technician"; item = { ...item, uploadedByUserId: 43 }; }
    if (reason === "unknown uploader") item = { ...item, uploadedByUserId: null };
    await render(gallery({ session: actor, job: job(detail([item])) }));
    expect(container.textContent).not.toContain("Long-press a photo");
    expect(container.textContent).not.toContain("CORS");
    expect(button("Remove Job photo 1").nativeProps.disabled).toBe(true);
    await event(button("Photo 1"), "onLongPress");
    expect(container.textContent).not.toContain("Remove this photo from this Job?");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("routes long-press through existing confirmation, sends no early DELETE, and confirms fresh absence", async () => {
    photoServer(); const current = job(detail([photo()])); await render(gallery({ job: current }));
    await event(button("Photo 1"), "onLongPress");
    expect(container.textContent).toContain("Stored media erasure is not guaranteed");
    expect(mocks.fetch).not.toHaveBeenCalled();
    const confirm = button("Confirm remove photo from Job");
    await act(async () => { confirm.nativeProps.onPress(); confirm.nativeProps.onPress(); });
    const writes = mocks.fetch.mock.calls.filter(([, init]) => init.method === "DELETE");
    expect(writes).toHaveLength(1);
    expect(new URL(writes[0][0]).pathname).toBe("/api/mobile/v1/jobs/12/photos/1");
    expect(container.textContent).toContain("absence confirmed by fresh detail");
    expect(current.detail.photos).toHaveLength(1);
    expect(nodes("native-image")).toHaveLength(0);
  });
  it("cancel clears a long-press confirmation and stale confirm cannot remove", async () => {
    await render(gallery({ job: job(detail([photo()])) })); await event(button("Photo 1"), "onLongPress");
    const old = button("Confirm remove photo from Job"); await event(button("Cancel photo removal")); await event(old);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each(["Job", "Company", "token", "blur", "pending", "reassignment"])("rejects retained long-press callback after %s change", async (change) => {
    await render(gallery({ job: job(detail([photo()])) })); const old = button("Photo 1");
    const actor = session(); let jobId = 12; const current = job(detail([photo()]));
    if (change === "Job") { jobId = 13; current.detail = detail([photo()], { id: 13 }); }
    if (change === "Company") { actor.company!.id = 10; current.detail = detail([photo()], { companyId: 10 }); }
    if (change === "token") actor.token = "rotated-fixture";
    if (change === "blur") mocks.focused = false;
    if (change === "pending") current.pending = true;
    if (change === "reassignment") { actor.user.role = "technician"; current.detail.assignedUserId = 43; }
    await render(gallery({ session: actor, jobId, job: current })); await event(old, "onLongPress");
    expect(container.textContent).not.toContain("Remove this photo from this Job?"); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("preserves preview taps and canonical signed URL refresh rather than reloading the expired image", async () => {
    const onPreview = vi.fn(); const current = job(detail([photo()])); await render(gallery({ job: current, onPreview }));
    await event(button("Photo 1")); expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ photoId: 1, imageUrl: photo().imageUrl }));
    const oldImage = nodes("native-image")[0]; await event(oldImage, "onError");
    expect(container.textContent).toContain("Photo unavailable"); await event(button("Refresh Job photos to retry"));
    expect(current.refresh).toHaveBeenCalledTimes(1); expect(nodes("native-image")).toHaveLength(0);
    await render(gallery({ job: { ...current, detail: detail([photo(1, "renewed")]) } }));
    await event(oldImage, "onError"); expect(nodes("native-image")[0].nativeProps.source.uri).toBe(photo(1, "renewed").imageUrl);
    expect(container.textContent).not.toContain("Photo unavailable");
  });
  it("keeps actual refresh failure visible as an alert", async () => {
    await render(gallery({ onRefresh: vi.fn().mockRejectedValue(new Error("fixture offline")) }));
    await event(button("Refresh photos"));
    const alert = nodes("native-text").find((node) => node.nativeProps.accessibilityRole === "alert");
    expect(alert?.textContent).toContain("Could not refresh Company Job photos");
  });
  it("retains optional standalone draft compatibility without requiring a gallery header", async () => {
    await render(<CompanyPhotoDraft session={session()} jobId={12} job={job()} />);
    expect(button("Camera").nativeProps.disabled).toBe(false); expect(button("Library").nativeProps.disabled).toBe(false);
    expect(container.textContent).not.toContain("BEFORE & AFTER PHOTOS");
  });
  it("keeps permission and format validation errors without repeating idle technical paragraphs", async () => {
    mocks.cameraPermission.mockResolvedValueOnce({ granted: false }); await render(gallery()); await event(button("Camera"));
    expect(container.textContent).toContain("Camera permission was denied"); expect(mocks.camera).not.toHaveBeenCalled();
    mocks.camera.mockResolvedValueOnce({ canceled: false, assets: [{ ...asset, mimeType: "image/heic" }] });
    await event(button("Retry Camera")); expect(container.textContent).toContain("Unsupported photo format");
    expect(nodes("native-image")).toHaveLength(0); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("shows a local draft as not uploaded and leaves canonical detail unchanged until verification", async () => {
    const current = job(); await render(gallery({ job: current })); await event(button("Library"));
    expect(container.textContent).toContain(COMPANY_PHOTO_DRAFT_LABEL);
    expect(container.textContent).not.toContain("signed Company account"); expect(current.detail.photos).toEqual([]);
    expect(button("Upload local draft").nativeProps.disabled).toBe(false); expect(mocks.fetch).not.toHaveBeenCalled();
    await event(button("Discard local draft")); expect(container.textContent).not.toContain(COMPANY_PHOTO_DRAFT_LABEL);
  });
  it("preserves one-shot upload locks and only shows confirmed upload after canonical readback", async () => {
    photoServer(); const waiting = deferred<string>(); mocks.bytes.mockReturnValue(waiting.promise);
    const current = job(detail([photo()])); await render(gallery({ job: current })); await event(button("Camera"));
    const upload = button("Upload local draft"); await act(async () => { upload.nativeProps.onPress(); upload.nativeProps.onPress(); });
    expect(container.textContent).not.toContain(COMPANY_PHOTO_DRAFT_LABEL);
    expect(container.textContent).not.toContain("upload confirmed"); expect(button("Library").nativeProps.disabled).toBe(true);
    await event(button("Library")); expect(mocks.libraryPermission).not.toHaveBeenCalled();
    await act(async () => { waiting.resolve(bytes); });
    const writes = mocks.fetch.mock.calls.filter(([, init]) => init.method === "POST"); expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1].body)).toEqual({ contentType: "image/jpeg", base64: bytes, category: "other", displayOrder: 1 });
    expect(container.textContent).toContain("upload confirmed by fresh Company Job detail");
    expect(container.textContent).toContain("BEFORE & AFTER PHOTOS (2)"); expect(current.detail.photos).toHaveLength(1);
  });
});
