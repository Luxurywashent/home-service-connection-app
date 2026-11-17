import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installPhotoTestDOM,
  PhotoTestNode,
} from "./helpers/company-photo-test-dom";
import { CompanyPhotoDraft } from "../components/company-photo-draft";
import { CompanyJobPhotos } from "../components/company-job-photos";
import {
  COMPANY_PHOTO_DRAFT_LABEL,
  COMPANY_PHOTO_DRAFT_MAX_BYTES,
  companyPhotoDraftScope,
  prepareCompanyPhotoDraft,
  type CompanyPhotoDraftInput,
  type LocalPhotoCandidate,
} from "../lib/company-photo-draft";
import type {
  JobSyncCompanyJobDetail,
  JobSyncNativeSession,
} from "../lib/jobsync-mobile-api";

const mocks = vi.hoisted(() => ({
  focused: true,
  cameraPermission: vi.fn(),
  libraryPermission: vi.fn(),
  camera: vi.fn(),
  library: vi.fn(),
  info: vi.fn(),
  bytes: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("expo-router", () => ({
  useIsFocused: () => mocks.focused,
}));
vi.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: mocks.cameraPermission,
  requestMediaLibraryPermissionsAsync: mocks.libraryPermission,
  launchCameraAsync: mocks.camera,
  launchImageLibraryAsync: mocks.library,
}));
vi.mock("expo-file-system/legacy", () => ({ getInfoAsync: mocks.info, readAsStringAsync: mocks.bytes, EncodingType: { Base64: "base64" } }));
vi.mock("@/hooks/use-colors", () => ({
  useColors: () => ({
    primary: "blue",
    foreground: "black",
    muted: "gray",
    error: "red",
    background: "white",
    border: "gray",
  }),
}));
vi.mock("react-native", async () => {
  const R = await import("react");
  const native = (name: string) =>
    function Native(props: Record<string, unknown>) {
      return R.createElement(
        name,
        {
          ref: (node: PhotoTestNode | null) => {
            if (node) (node as NativeNode).nativeProps = props;
          },
        },
        props.children as React.ReactNode,
      );
    };
  return {
    ActivityIndicator: native("activity-indicator"),
    Image: native("native-image"),
    Text: native("native-text"),
    TouchableOpacity: native("native-touch"),
    View: native("native-view"),
    FlatList: (props: {
      data: any[];
      keyExtractor: (item: any) => string;
      renderItem: (input: { item: any }) => React.ReactNode;
    }) =>
      R.createElement(
        "native-list",
        null,
        props.data.map((item) =>
          R.createElement(
            R.Fragment,
            { key: props.keyExtractor(item) },
            props.renderItem({ item }),
          ),
        ),
      ),
    StyleSheet: { create: (styles: unknown) => styles },
    Platform: { OS: "ios" },
  };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => {
    render: (node: React.ReactNode) => void;
    unmount: () => void;
  };
};
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
const session = (): JobSyncNativeSession => ({
  token: "fixture-only-draft-token",
  portal: "company",
  user: { id: 42, role: "owner", name: "Fixture", email: null },
  company: {
    id: 9,
    name: "Fixture",
    slug: "fixture",
    logoUrl: null,
    primaryColor: null,
    accentColor: null,
  },
});
const detail = (patch: Partial<JobSyncCompanyJobDetail> = {}) =>
  ({
    id: 12,
    companyId: 9,
    assignedUserId: 42,
    status: "scheduled",
    photos: [],
    ...patch,
  }) as JobSyncCompanyJobDetail;
const input = (): CompanyPhotoDraftInput => ({
  session: session(),
  jobId: 12,
  job: { detail: detail(), loading: false, pending: false, error: null },
});
const asset = (patch: Partial<LocalPhotoCandidate> = {}) => ({
  uri: "file:///fixture/photo.jpg",
  type: "image",
  mimeType: "image/jpeg",
  fileSize: 512,
  width: 200,
  height: 100,
  ...patch,
});
const result = (patch: Partial<LocalPhotoCandidate> = {}) => ({
  canceled: false,
  assets: [asset(patch)],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let unmounted = false;
function all(node = container): NativeNode[] {
  return [
    node as NativeNode,
    ...node.childNodes.flatMap((child) => all(child)),
  ];
}
function nodes(name: string) {
  return all().filter((node) => node.nodeName.toLowerCase() === name);
}
function button(label: string) {
  const found = nodes("native-touch").find(
    (node) =>
      node.nativeProps.accessibilityLabel === label ||
      node.textContent === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function event(node: NativeNode, name = "onPress") {
  await act(async () => {
    node.nativeProps[name]?.();
  });
}
async function render(props = input()) {
  await act(async () => {
    root.render(<CompanyPhotoDraft {...props} />);
  });
}
async function settle<T>(wait: ReturnType<typeof deferred<T>>, value: T) {
  await act(async () => {
    wait.resolve(value);
  });
}
function changed(change: string): CompanyPhotoDraftInput {
  const next = input();
  if (change === "Job") {
    next.jobId = 13;
    next.job.detail = detail({ id: 13 });
  }
  if (change === "Company") {
    next.session!.company!.id = 10;
    next.job.detail = detail({ companyId: 10 });
  }
  if (change === "token") next.session!.token = "fixture-rotated-token";
  if (change === "user") next.session!.user.id = 43;
  if (change === "role") next.session!.user.role = "dispatcher";
  if (change === "capability") next.session!.user.calendarEligible = true;
  if (change === "logout") next.session = null;
  if (change === "blur") mocks.focused = false;
  if (change === "loading") next.job.loading = true;
  if (change === "pending") next.job.pending = true;
  if (change === "error") next.job.error = "Fixture denied";
  if (change === "absent detail") next.job.detail = null;
  if (change === "wrong detail Job") next.job.detail = detail({ id: 99 });
  if (change === "wrong detail Company")
    next.job.detail = detail({ companyId: 99 });
  if (change === "reassignment") {
    next.session!.user.role = "technician";
    next.job.detail = detail({ assignedUserId: 99 });
  }
  return next;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.focused = true;
  mocks.cameraPermission.mockResolvedValue({ granted: true });
  mocks.libraryPermission.mockResolvedValue({ granted: true });
  mocks.camera.mockResolvedValue(result());
  mocks.library.mockResolvedValue(result());
  mocks.info.mockResolvedValue({ exists: true, isDirectory: false, size: 512 });
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.bytes.mockResolvedValue(Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(509)]).toString("base64"));
  const document = installPhotoTestDOM();
  container = document.createElement("main");
  document.body.appendChild(container);
  root = createRoot(container);
  unmounted = false;
});
afterEach(async () => {
  if (!unmounted)
    await act(async () => {
      root.unmount();
    });
  vi.unstubAllGlobals();
});

describe("bounded local-file preparation", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])(
    "accepts readable %s and exact 15 MiB metadata",
    async (mimeType) => {
      const getInfo = vi
        .fn()
        .mockResolvedValue({
          exists: true,
          isDirectory: false,
          size: COMPANY_PHOTO_DRAFT_MAX_BYTES,
        });
      const prepared = await prepareCompanyPhotoDraft(
        asset({ mimeType, fileSize: undefined }),
        getInfo,
      );
      expect(prepared).toEqual({
        uri: asset().uri,
        mimeType,
        size: COMPANY_PHOTO_DRAFT_MAX_BYTES,
      });
      expect(getInfo).toHaveBeenCalledWith(asset().uri);
    },
  );
  it.each(["jpg", "jpeg", "png", "webp"])(
    "infers only supported %s when MIME is omitted",
    async (extension) => {
      await expect(
        prepareCompanyPhotoDraft(
          asset({
            uri: `file:///fixture/photo.${extension}`,
            mimeType: undefined,
          }),
          mocks.info,
        ),
      ).resolves.toMatchObject({ uri: `file:///fixture/photo.${extension}` });
    },
  );
  it.each([
    "image/heic",
    "image/gif",
    "image/svg+xml",
    "video/mp4",
    "application/octet-stream",
  ])(
    "rejects explicit unsupported %s even with .jpg name",
    async (mimeType) => {
      await expect(
        prepareCompanyPhotoDraft(
          asset({ mimeType, fileName: "safe.jpg" }),
          mocks.info,
        ),
      ).rejects.toThrow("Unsupported photo format");
      expect(mocks.info).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    "",
    "ph://fixture",
    "content://fixture",
    "https://fixture.invalid/photo.jpg",
    "blob:fixture",
    "file:///",
    "file://host/photo.jpg",
    "file:///fixture/photo.jpg?x=1",
  ])("rejects non-local/missing URI (%s)", async (uri) => {
    await expect(
      prepareCompanyPhotoDraft(asset({ uri }), mocks.info),
    ).rejects.toThrow("readable local file");
    expect(mocks.info).not.toHaveBeenCalled();
  });
  it.each(["video", "livePhoto", "pairedVideo"])(
    "rejects %s type even with image MIME",
    async (type) => {
      await expect(
        prepareCompanyPhotoDraft(asset({ type }), mocks.info),
      ).rejects.toThrow("Only still");
    },
  );
  it("rejects omitted MIME without a supported extension", async () => {
    await expect(
      prepareCompanyPhotoDraft(
        asset({ mimeType: undefined, uri: "file:///fixture/image" }),
        mocks.info,
      ),
    ).rejects.toThrow("missing or unsupported");
  });
  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0.5,
    COMPANY_PHOTO_DRAFT_MAX_BYTES + 1,
  ])("rejects invalid picker size %s", async (fileSize) => {
    await expect(
      prepareCompanyPhotoDraft(asset({ fileSize }), mocks.info),
    ).rejects.toThrow();
    expect(mocks.info).not.toHaveBeenCalled();
  });
  it.each([
    { exists: false, isDirectory: false, size: 512 },
    { exists: true, isDirectory: true, size: 512 },
    { exists: true, isDirectory: false },
    { exists: true, isDirectory: false, size: 0 },
    {
      exists: true,
      isDirectory: false,
      size: COMPANY_PHOTO_DRAFT_MAX_BYTES + 1,
    },
  ])("rejects missing/unreadable/invalid actual metadata %#", async (info) => {
    mocks.info.mockResolvedValue(info);
    await expect(
      prepareCompanyPhotoDraft(asset(), mocks.info),
    ).rejects.toThrow();
  });
  it("does not trust picker size over actual file metadata", async () => {
    mocks.info.mockResolvedValue({
      exists: true,
      isDirectory: false,
      size: COMPANY_PHOTO_DRAFT_MAX_BYTES + 1,
    });
    await expect(prepareCompanyPhotoDraft(asset(), mocks.info)).rejects.toThrow(
      "15 MiB",
    );
  });
  it("sanitizes native metadata errors", async () => {
    mocks.info.mockRejectedValue(new Error("fixture-native-sensitive-value"));
    await expect(prepareCompanyPhotoDraft(asset(), mocks.info)).rejects.toThrow(
      "Could not read this local photo",
    );
  });
});

describe("local draft component (real React lifecycle, mocked RN and Expo)", () => {
  it.each(["Camera", "Library"])(
    "requests %s permission, chooses images only, previews ONE draft and enables guarded upload",
    async (source) => {
      const props = input();
      const original = JSON.stringify(props.job.detail);
      await render(props);
      await event(button(source));
      const permission =
        source === "Camera" ? mocks.cameraPermission : mocks.libraryPermission;
      const picker = source === "Camera" ? mocks.camera : mocks.library;
      expect(permission).toHaveBeenCalledTimes(1);
      expect(picker).toHaveBeenCalledWith({
        mediaTypes: ["images"],
        allowsMultipleSelection: source === "Library",
        allowsEditing: false,
        base64: false,
        exif: false,
        ...(source === "Library" ? { orderedSelection: true } : {}),
      });
      expect(nodes("native-image")).toHaveLength(1);
      expect(container.textContent).toContain(COMPANY_PHOTO_DRAFT_LABEL);
      expect(container.textContent).not.toContain("signed Company account");
      expect(
        button("Upload local draft").nativeProps.disabled,
      ).toBe(false);
      expect(
        button("Upload local draft").nativeProps.onPress,
      ).toBeTypeOf("function");
      expect(JSON.stringify(props.job.detail)).toBe(original);
      expect(container.textContent).not.toContain(props.session!.token);
      await event(nodes("native-image")[0], "onLoad");
      expect(nodes("activity-indicator")).toHaveLength(0);
      await event(button("Library"));
      expect(nodes("native-image")).toHaveLength(1);
    },
  );
  it.each(["Camera", "Library"])(
    "supports %s cancellation without success or draft",
    async (source) => {
      (source === "Camera" ? mocks.camera : mocks.library).mockResolvedValue({
        canceled: true,
        assets: null,
      });
      await render();
      await event(button(source));
      expect(container.textContent).toContain("cancelled. No local draft");
      expect(nodes("native-image")).toHaveLength(0);
      expect(mocks.info).not.toHaveBeenCalled();
      expect(button(source).nativeProps.disabled).toBe(false);
    },
  );
  it.each(["Camera", "Library"])(
    "supports %s denial, retry, permission error and picker error",
    async (source) => {
      const permission =
        source === "Camera" ? mocks.cameraPermission : mocks.libraryPermission;
      const picker = source === "Camera" ? mocks.camera : mocks.library;
      permission.mockResolvedValueOnce({ granted: false, canAskAgain: false });
      await render();
      await event(button(source));
      expect(container.textContent).toContain("permission was denied");
      expect(picker).not.toHaveBeenCalled();
      permission.mockRejectedValueOnce(
        new Error("fixture-sensitive-permission"),
      );
      await event(button(`Retry ${source}`));
      expect(container.textContent).toContain("Could not request");
      picker.mockRejectedValueOnce(new Error("fixture-sensitive-picker"));
      await event(button(`Retry ${source}`));
      expect(container.textContent).toContain("Could not open");
      expect(container.textContent).not.toContain("fixture-sensitive");
      await event(button(`Retry ${source}`));
      expect(nodes("native-image")).toHaveLength(1);
    },
  );
  it.each([
    { patch: { mimeType: "image/heic" }, error: "Unsupported photo format" },
    { patch: { uri: "ph://fixture" }, error: "readable local file" },
    { patch: { fileSize: 0 }, error: "missing or empty" },
    { patch: { fileSize: COMPANY_PHOTO_DRAFT_MAX_BYTES + 1 }, error: "15 MiB" },
  ])(
    "renders preparation validation error and allows retry %#",
    async ({ patch, error }) => {
      mocks.camera.mockResolvedValueOnce(result(patch));
      await render();
      await event(button("Camera"));
      expect(container.textContent).toContain(error);
      expect(nodes("native-image")).toHaveLength(0);
      await event(button("Retry Camera"));
      expect(nodes("native-image")).toHaveLength(1);
    },
  );
  it("renders unreadable filesystem and empty/multiple asset errors without a draft", async () => {
    mocks.info.mockRejectedValueOnce(new Error("fixture-sensitive-path"));
    await render();
    await event(button("Library"));
    expect(container.textContent).toContain("Could not read this local photo");
    expect(container.textContent).not.toContain("fixture-sensitive-path");
    mocks.library.mockResolvedValueOnce({ canceled: false, assets: [] });
    await event(button("Retry Library"));
    expect(container.textContent).toContain("Select at least one still photo");
    mocks.library.mockResolvedValueOnce({
      canceled: false,
      assets: [asset(), asset()],
    });
    await event(button("Retry Library"));
    expect(nodes("native-image")).toHaveLength(1);
    expect(container.textContent).toContain("repeated selection(s) ignored");
  });
  it("discards only in-memory draft; old image callbacks cannot resurrect it", async () => {
    await render();
    await event(button("Camera"));
    const oldImage = nodes("native-image")[0];
    await event(button("Discard local draft"));
    await event(oldImage, "onError");
    expect(nodes("native-image")).toHaveLength(0);
    expect(container.textContent).not.toContain(COMPANY_PHOTO_DRAFT_LABEL);
    expect(button("Camera").nativeProps.disabled).toBe(false);
  });
  it("reports preview image error with retry and ignores callbacks from a replaced draft", async () => {
    await render();
    await event(button("Camera"));
    const oldImage = nodes("native-image")[0];
    await event(oldImage, "onError");
    expect(container.textContent).toContain("preview could not load");
    await event(button("Retry Camera"));
    await event(oldImage, "onError");
    expect(nodes("native-image")).toHaveLength(1);
    expect(container.textContent).not.toContain("preview could not load");
  });
  it("synchronously locks multiple taps during permission, picker and metadata", async () => {
    const permission = deferred<any>();
    const picker = deferred<any>();
    const info = deferred<any>();
    mocks.cameraPermission.mockReturnValue(permission.promise);
    mocks.camera.mockReturnValue(picker.promise);
    mocks.info.mockReturnValue(info.promise);
    await render();
    const camera = button("Camera");
    const library = button("Library");
    await act(async () => {
      camera.nativeProps.onPress();
      camera.nativeProps.onPress();
      library.nativeProps.onPress();
    });
    expect(mocks.cameraPermission).toHaveBeenCalledTimes(1);
    expect(mocks.libraryPermission).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(COMPANY_PHOTO_DRAFT_LABEL);
    await settle(permission, { granted: true });
    await event(camera);
    expect(mocks.camera).toHaveBeenCalledTimes(1);
    await settle(picker, result());
    await event(library);
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.libraryPermission).not.toHaveBeenCalled();
    await settle(info, { exists: true, isDirectory: false, size: 512 });
    expect(nodes("native-image")).toHaveLength(1);
    expect(button("Camera").nativeProps.disabled).toBe(false);
  });
  it.each([
    "Job",
    "Company",
    "token",
    "user",
    "role",
    "capability",
    "logout",
    "blur",
    "loading",
    "pending",
    "error",
    "absent detail",
    "wrong detail Job",
    "wrong detail Company",
    "reassignment",
  ])(
    "immediately hides and permanently invalidates the draft on %s",
    async (change) => {
      await render();
      await event(button("Camera"));
      const oldImage = nodes("native-image")[0];
      const oldDiscard = button("Discard local draft");
      await render(changed(change));
      expect(nodes("native-image")).toHaveLength(0);
      await event(oldImage, "onError");
      await event(oldDiscard);
      mocks.focused = true;
      await render();
      expect(nodes("native-image")).toHaveLength(0);
      expect(container.textContent).not.toContain(COMPANY_PHOTO_DRAFT_LABEL);
    },
  );
  for (const stage of ["permission", "picker", "filesystem"] as const) {
    it.each([
      "Job",
      "Company",
      "token",
      "user",
      "role",
      "capability",
      "logout",
      "blur",
    ])(`rejects late ${stage} response after %s change`, async (change) => {
      const wait = deferred<any>();
      if (stage === "permission")
        mocks.cameraPermission.mockReturnValueOnce(wait.promise);
      if (stage === "picker") mocks.camera.mockReturnValueOnce(wait.promise);
      if (stage === "filesystem") mocks.info.mockReturnValueOnce(wait.promise);
      await render();
      const oldPress = button("Camera").nativeProps.onPress;
      await act(async () => {
        oldPress();
      });
      await render(changed(change));
      await act(async () => {
        oldPress();
      });
      await settle(
        wait,
        stage === "permission"
          ? { granted: true }
          : stage === "picker"
            ? result()
            : { exists: true, isDirectory: false, size: 512 },
      );
      expect(nodes("native-image")).toHaveLength(0);
      if (stage === "permission") expect(mocks.camera).not.toHaveBeenCalled();
      if (stage === "picker") expect(mocks.info).not.toHaveBeenCalled();
      mocks.focused = true;
      await render();
      expect(nodes("native-image")).toHaveLength(0);
    });
  }
  it.each(["permission", "picker", "filesystem"])(
    "rejects late %s failures after unmount",
    async (stage) => {
      const wait = deferred<any>();
      if (stage === "permission")
        mocks.cameraPermission.mockReturnValueOnce(wait.promise);
      if (stage === "picker") mocks.camera.mockReturnValueOnce(wait.promise);
      if (stage === "filesystem") mocks.info.mockReturnValueOnce(wait.promise);
      await render();
      await event(button("Camera"));
      await act(async () => {
        root.unmount();
      });
      unmounted = true;
      await act(async () => {
        wait.reject(new Error("fixture-sensitive-late-native"));
      });
      expect(container.textContent).toBe("");
    },
  );
  it("an old response cannot unlock or overwrite a new scope's pending picker", async () => {
    const oldWait = deferred<any>();
    const newWait = deferred<any>();
    mocks.cameraPermission
      .mockReturnValueOnce(oldWait.promise)
      .mockReturnValueOnce(newWait.promise);
    await render();
    await event(button("Camera"));
    await render(changed("Job"));
    const newCamera = button("Camera");
    await event(newCamera);
    await settle(oldWait, { granted: true });
    await event(newCamera);
    expect(mocks.cameraPermission).toHaveBeenCalledTimes(2);
    expect(mocks.camera).not.toHaveBeenCalled();
    await settle(newWait, { granted: true });
    expect(mocks.camera).toHaveBeenCalledTimes(1);
    expect(nodes("native-image")).toHaveLength(1);
  });
  for (const stage of ["permission", "picker", "filesystem"] as const) {
    it.each(["Job", "token", "blur"])(
      `drops late ${stage} error even after leaving and returning to the same %s scope`,
      async (change) => {
        const wait = deferred<any>();
        if (stage === "permission")
          mocks.cameraPermission.mockReturnValueOnce(wait.promise);
        if (stage === "picker") mocks.camera.mockReturnValueOnce(wait.promise);
        if (stage === "filesystem")
          mocks.info.mockReturnValueOnce(wait.promise);
        await render();
        await event(button("Camera"));
        await render(changed(change));
        mocks.focused = true;
        await render();
        await event(button("Library"));
        await act(async () => {
          wait.reject(new Error("fixture-sensitive-old-scope"));
        });
        expect(nodes("native-image")).toHaveLength(1);
        expect(container.textContent).not.toContain("Could not");
        expect(container.textContent).not.toContain(
          "fixture-sensitive-old-scope",
        );
      },
    );
  }
  it.each([
    "logout",
    "loading",
    "pending",
    "error",
    "absent detail",
    "wrong detail Job",
    "wrong detail Company",
    "reassignment",
  ])("does not request permission for invalid %s scope", async (change) => {
    const props = changed(change);
    await render(props);
    expect(companyPhotoDraftScope(props)).toBeNull();
    expect(button("Camera").nativeProps.disabled).toBe(true);
    await event(button("Camera"));
    await event(button("Library"));
    expect(mocks.cameraPermission).not.toHaveBeenCalled();
    expect(mocks.libraryPermission).not.toHaveBeenCalled();
  });
  it.each(["owner", "dispatcher", "technician"] as const)(
    "allows authorized %s without manager field-opt-in restrictions",
    async (role) => {
      const props = input();
      props.session!.user.role = role;
      props.session!.user.calendarEligible = false;
      await render(props);
      expect(button("Camera").nativeProps.disabled).toBe(false);
      await event(button("Camera"));
      expect(nodes("native-image")).toHaveLength(1);
    },
  );
  it("gallery integration keeps canonical photo IDs/preview callbacks and never appends the local draft", async () => {
    const props = input();
    const canonical = {
      id: 7,
      imageUrl: "https://fixture.invalid/photo.jpg",
      caption: "Server photo",
      uploadedByUserId: 42,
      createdAt: null,
    };
    props.job.detail!.photos = [canonical];
    const onPreview = vi.fn();
    const refresh = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <CompanyJobPhotos
          {...props}
          job={{ ...props.job, refresh }}
          onPreview={onPreview}
        />,
      );
    });
    await event(button("Camera"));
    expect(nodes("native-image")).toHaveLength(2);
    expect(props.job.detail!.photos).toEqual([canonical]);
    await event(button("Server photo"));
    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({ photoId: 7, imageUrl: canonical.imageUrl }),
    );
    await event(button("Discard local draft"));
    expect(nodes("native-image")).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });
  it("canonical gallery refresh clears the draft and prevents resurrection after refresh completes", async () => {
    const props = input();
    const wait = deferred<void>();
    const onRefresh = vi.fn(() => wait.promise);
    const gallery = () => (
      <CompanyJobPhotos
        {...props}
        job={{ ...props.job, refresh: vi.fn() }}
        onPreview={vi.fn()}
        onRefresh={onRefresh}
      />
    );
    await act(async () => {
      root.render(gallery());
    });
    await event(button("Camera"));
    expect(nodes("native-image")).toHaveLength(1);
    await event(button("Refresh photos"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(nodes("native-image")).toHaveLength(0);
    expect(button("Camera").nativeProps.disabled).toBe(true);
    await settle(wait, undefined);
    expect(nodes("native-image")).toHaveLength(0);
    expect(button("Camera").nativeProps.disabled).toBe(false);
  });
});

function mockPhotoServer(options: { failure?: number; actor?: JobSyncNativeSession; readFailure?: boolean; missingUploadedId?: boolean } = {}) {
  const saved: { id: number; imageUrl: string; caption: null; uploadedByUserId: number; createdAt: null; category?: "before" | "after" | "damage" | "other"; displayOrder?: number } = { id: 7, imageUrl: "https://fixture.invalid/manus-storage/companies/9/jobs/12/photos/fixture.jpg?expires=300&signature=fixture", caption: null, uploadedByUserId: 42, createdAt: null };
  let persisted = false;
  let reads = 0;
  mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/auth/session")) return { ok: true, status: 200, json: async () => options.actor ?? session() };
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body));
      Object.assign(saved, { category: body.category ?? "other", displayOrder: body.displayOrder ?? 0 });
      persisted = true;
      return { ok: !options.failure, status: options.failure ?? 201, json: async () => options.failure ? { error: { code: "BAD_REQUEST", message: "A valid Job photo upload request is required." } } : { photo: saved } };
    }
    reads++;
    if (options.readFailure && reads > 1) throw new Error("fixture read offline");
    return { ok: true, status: 200, json: async () => ({ job: detail({ photos: persisted && !options.missingUploadedId ? [saved] : [] }) }) };
  });
  return saved;
}
async function renderUploadingGallery(props = input(), onRefresh: () => void | Promise<void> = vi.fn().mockResolvedValue(undefined)) {
  await act(async () => { root.render(<CompanyJobPhotos {...props} job={{ ...props.job, refresh: async () => { await onRefresh(); } }} onRefresh={onRefresh} onPreview={vi.fn()} />); });
}
describe("shared photo upload: actual encode, mocked bearer fetch and canonical reload", () => {
  it("sends actual fs bytes, confirms fresh gallery ID, and never saves a local draft or bare ack", async () => {
    mockPhotoServer(); const props=input(); const onRefresh=vi.fn().mockResolvedValue(undefined);
    await renderUploadingGallery(props,onRefresh); await event(button("Camera"));
    const press=button("Upload local draft").nativeProps.onPress;
    await act(async () => { press(); press(); });
    expect(mocks.bytes).toHaveBeenCalledWith(asset().uri,{encoding:"base64"});
    const writes=mocks.fetch.mock.calls.filter(([,init]) => init.method==="POST");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1].body)).toEqual({contentType:"image/jpeg",base64:await mocks.bytes.mock.results[0].value,category:"other",displayOrder:1});
    expect(writes[0][1].headers.Authorization).toBe(`Bearer ${props.session!.token}`);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("upload confirmed by fresh");
    expect(container.textContent).not.toContain(COMPANY_PHOTO_DRAFT_LABEL);
    expect(props.job.detail!.photos).toEqual([]);
    expect(nodes("native-image")).toHaveLength(1);
    expect(nodes("native-image")[0].nativeProps.source).toEqual({uri:expect.stringContaining("signature=fixture")});
  });
  it.each([{failure:400},{readFailure:true},{missingUploadedId:true}])("does not falsely save a draft or retry an uncertain upload %#", async options => {
    mockPhotoServer(options); await renderUploadingGallery(); await event(button("Library")); await event(button("Upload local draft"));
    expect(mocks.fetch.mock.calls.filter(([,init]) => init.method==="POST")).toHaveLength(1);
    expect(container.textContent).not.toContain("upload confirmed by fresh");
    expect(container.textContent).not.toContain(COMPANY_PHOTO_DRAFT_LABEL);
    expect(container.textContent).toMatch(/may already have been saved|confirmation failed|does not confirm/);
    if(options.readFailure) expect(button("Camera").nativeProps.disabled).toBe(true);
  });
  it("keeps indeterminate sending feedback and blocks all capture taps while bytes are pending", async () => {
    mockPhotoServer(); const wait=deferred<string>(); mocks.bytes.mockReturnValue(wait.promise);
    await renderUploadingGallery(); await event(button("Camera")); await event(button("Upload local draft"));
    expect(container.textContent).toContain("Checking current Company Job photo access");
    expect(button("Library").nativeProps.disabled).toBe(true);
    await event(button("Library")); expect(mocks.libraryPermission).not.toHaveBeenCalled();
    await settle(wait,Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(509)]).toString("base64"));
    expect(container.textContent).toContain("upload confirmed");
  });
  it.each(["Job","Company","token","user","role","blur","pending","reassignment"])("does not send late encoded upload after %s change or returning", async change => {
    const wait=deferred<string>(); mocks.bytes.mockReturnValue(wait.promise); mockPhotoServer();
    await renderUploadingGallery(); await event(button("Camera")); await event(button("Upload local draft"));
    await renderUploadingGallery(changed(change)); mocks.focused=true; await renderUploadingGallery();
    await settle(wait,Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(509)]).toString("base64"));
    expect(mocks.fetch.mock.calls.filter(([,init])=>init.method==="POST")).toHaveLength(0);
    expect(container.textContent).not.toContain(COMPANY_PHOTO_DRAFT_LABEL);
    expect(container.textContent).not.toContain("upload confirmed");
  });
  it("signed live-role denial preflight sends no POST and blocks unrefreshed controls", async () => {
    const actor=session(); actor.user.role="technician"; mockPhotoServer({actor});
    await renderUploadingGallery(); await event(button("Camera")); await event(button("Upload local draft"));
    expect(mocks.fetch.mock.calls.filter(([,init])=>init.method==="POST")).toHaveLength(0);
    expect(container.textContent).toContain("No photo request was sent");
    expect(button("Camera").nativeProps.disabled).toBe(true);
  });
  it("upload survives its own caller refresh draft invalidation but never resurrects the preview", async () => {
    mockPhotoServer(); const wait=deferred<void>(); const props=input(); let finish=()=>{};
    const refresh=vi.fn();
    function Sheet() {
      const [loading,setLoading]=React.useState(false);
      refresh.mockImplementation(async () => { setLoading(true); await wait.promise; setLoading(false); });
      finish=()=>wait.resolve(undefined);
      return <CompanyJobPhotos {...props} job={{...props.job,detail:loading?null:props.job.detail,loading,refresh}} onRefresh={refresh} onPreview={vi.fn()} />;
    }
    await act(async()=>root.render(<Sheet />)); await event(button("Camera")); await event(button("Upload local draft"));
    expect(container.textContent).toContain("Reloading authoritative Job photos");
    expect(container.textContent).not.toContain(COMPANY_PHOTO_DRAFT_LABEL);
    await act(async()=>finish());
    expect(container.textContent).toContain("upload confirmed");
    expect(container.textContent).not.toContain(COMPANY_PHOTO_DRAFT_LABEL);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("shared photo upload late transport and cancellation regression",()=>{
  it.each(["Job","Company","token","user","role","blur","pending","reassignment"])("drops late POST acknowledgement after %s change without refresh or saved-draft resurrection",async change=>{
    const saved=mockPhotoServer(); const server=mocks.fetch.getMockImplementation()!; const wait=deferred<any>();
    mocks.fetch.mockImplementation((url,init)=>init.method==="POST"?wait.promise:server(url,init));
    const onRefresh=vi.fn().mockResolvedValue(undefined);
    await renderUploadingGallery(input(),onRefresh);await event(button("Camera"));await event(button("Upload local draft"));
    expect(container.textContent).toContain("Sending photo");
    await renderUploadingGallery(changed(change),onRefresh);mocks.focused=true;await renderUploadingGallery(input(),onRefresh);
    await settle(wait,{ok:true,status:201,json:async()=>({photo:{...saved,category:"other",displayOrder:1}})});
    expect(onRefresh).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("upload confirmed");
    expect(container.textContent).not.toContain(COMPANY_PHOTO_DRAFT_LABEL);
  });
  it("unmount during sending drops late response and never refreshes",async()=>{
    const saved=mockPhotoServer();const server=mocks.fetch.getMockImplementation()!;const wait=deferred<any>();
    mocks.fetch.mockImplementation((url,init)=>init.method==="POST"?wait.promise:server(url,init));
    const refresh=vi.fn().mockResolvedValue(undefined);await renderUploadingGallery(input(),refresh);await event(button("Camera"));await event(button("Upload local draft"));await act(async()=>root.unmount());unmounted=true;
    await settle(wait,{ok:true,status:201,json:async()=>({photo:{...saved,category:"other",displayOrder:1}})});expect(refresh).not.toHaveBeenCalled();expect(container.textContent).toBe("");
  });
  it("timeout after mock persistence reconciles fresh gallery without replaying POST",async()=>{
    mockPhotoServer();const server=mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async(url,init)=>{const response=await server(url,init);if(init.method==="POST"){const error=new Error("mock abort");error.name="AbortError";throw error;}return response;});
    await renderUploadingGallery();await event(button("Camera"));await event(button("Upload local draft"));
    expect(mocks.fetch.mock.calls.filter(([,init])=>init.method==="POST")).toHaveLength(1);
    expect(container.textContent).toContain("may already have been saved");expect(container.textContent).toContain("duplicates are possible");expect(container.textContent).not.toContain("upload confirmed");expect(nodes("native-image")).toHaveLength(1);
  });
  it("cancelled pending operation does not resurrect its state after a fresh same-scope Job renders",async()=>{
    mockPhotoServer();const wait=deferred<string>();mocks.bytes.mockReturnValue(wait.promise);
    await renderUploadingGallery();await event(button("Camera"));await event(button("Upload local draft"));await renderUploadingGallery(changed("pending"));
    await settle(wait,Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(509)]).toString("base64"));
    await renderUploadingGallery(input());
    expect(container.textContent).not.toContain("Checking current");expect(container.textContent).not.toContain(COMPANY_PHOTO_DRAFT_LABEL);
    expect(button("Camera").nativeProps.disabled).toBe(false);
    expect(mocks.fetch.mock.calls.filter(([,init])=>init.method==="POST")).toHaveLength(0);
  });
});
