import React, { act, useState } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installPhotoTestDOM,
  PhotoTestNode,
} from "./helpers/company-photo-test-dom";
import {
  CompanyJobPhotos,
  CompanyJobPhotoPreview,
  type CompanyPhotoSelection,
} from "../components/company-job-photos";
import { companyPhotoScope } from "../lib/company-photo-view";
import type {
  JobSyncNativeSession,
  JobSyncCompanyJobDetail,
  JobSyncJobPhoto,
} from "../lib/jobsync-mobile-api";

// ReactDOM is already installed. This exercises real state, effects and keyed unmounts,
// while RN host components expose their native callbacks for deterministic events.
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => {
    render: (node: React.ReactNode) => void;
    unmount: () => void;
  };
};
const lifecycle = vi.hoisted(() => ({ focused: true, platform: { OS: "ios" } }));
vi.mock("expo-router", () => ({ useIsFocused: () => lifecycle.focused }));
vi.mock("expo-file-system/legacy", () => ({ getInfoAsync: vi.fn(), readAsStringAsync: vi.fn(), EncodingType: { Base64: "base64" } }));
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
      data: JobSyncJobPhoto[];
      keyExtractor: (item: JobSyncJobPhoto) => string;
      renderItem: (input: { item: JobSyncJobPhoto }) => React.ReactNode;
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
    Platform: lifecycle.platform,
  };
});
// The actual draft component has its own 117 lifecycle/native-callback tests.
// This suite tests the gallery's exact scoped integration boundary independently.
vi.mock("@/components/company-photo-draft", async () => {
  const R = await import("react");
  return { CompanyPhotoDraft: (props: Record<string, unknown>) => R.createElement("native-local-draft", {
    ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
  }) };
});
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

type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
const fixtureSession = (
  patch: Partial<JobSyncNativeSession> = {},
): JobSyncNativeSession => ({
  token: "fixture-only-token",
  portal: "company",
  user: { id: 42, role: "owner", name: "Fixture", email: null },
  company: {
    id: 9,
    name: "Fixture Company",
    slug: "fixture",
    logoUrl: null,
    primaryColor: null,
    accentColor: null,
  },
  ...patch,
});
const photo = (id = 1, suffix = "old"): JobSyncJobPhoto => ({
  id,
  imageUrl: `https://fixture.invalid/api/storage/photo-${id}?expires=300&signature=${suffix}`,
  caption: `Photo ${id}`,
  uploadedByUserId: 42,
  createdAt: null,
});
const detail = (
  photos = [photo()],
  patch: Partial<JobSyncCompanyJobDetail> = {},
): JobSyncCompanyJobDetail =>
  ({
    id: 12,
    companyId: 9,
    assignedUserId: 42,
    photos,
    status: "scheduled",
    enRouteAt: null,
    onSiteAt: null,
    completedAt: null,
    ...patch,
  }) as JobSyncCompanyJobDetail;
const job = (d: JobSyncCompanyJobDetail | null = detail()) => ({
  detail: d,
  loading: false,
  pending: false,
  error: null as string | null,
  success: null,
  refresh: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  advance: vi.fn().mockResolvedValue(false),
});
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
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
  if (!found)
    throw new Error(`Missing button: ${label}; text=${container.textContent}`);
  return found;
}
async function event(node: NativeNode, name: string) {
  await act(async () => {
    node.nativeProps[name]?.({
      nativeEvent: { error: "fixture load failure" },
    });
  });
}
async function render(element: React.ReactNode) {
  await act(async () => {
    root.render(element);
  });
}
function gallery(
  props: Partial<React.ComponentProps<typeof CompanyJobPhotos>> = {},
) {
  return (
    <CompanyJobPhotos
      session={fixtureSession()}
      jobId={12}
      job={job()}
      onPreview={vi.fn()}
      {...props}
    />
  );
}
function preview(
  props: Partial<React.ComponentProps<typeof CompanyJobPhotoPreview>> = {},
) {
  return (
    <CompanyJobPhotoPreview
      session={fixtureSession()}
      jobId={12}
      job={job()}
      photo={{
        scope: companyPhotoScope(fixtureSession(), 12)!,
        photoId: 1,
        imageUrl: photo().imageUrl,
      }}
      onClose={vi.fn()}
      {...props}
    />
  );
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  lifecycle.focused = true;
  lifecycle.platform.OS = "ios";
  const document = installPhotoTestDOM();
  container = document.createElement("main");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  vi.restoreAllMocks();
});

describe("Company read-only photo component behavior (mocked RN, real React lifecycle)", () => {
  it("shows loading feedback and clears it only on native load", async () => {
    await render(gallery());
    expect(nodes("activity-indicator")).toHaveLength(1);
    await event(nodes("native-image")[0], "onLoad");
    expect(nodes("activity-indicator")).toHaveLength(0);
    expect(nodes("native-image")[0].nativeProps.source.uri).toBe(
      photo().imageUrl,
    );
  });
  it("reports thumbnail load failure and refreshes canonical Job instead of remounting an expired URL", async () => {
    const current = job();
    await render(gallery({ job: current }));
    await event(nodes("native-image")[0], "onError");
    expect(container.textContent).toContain("Photo unavailable");
    expect(container.textContent).toContain("signed link may have expired");
    expect(nodes("native-image")).toHaveLength(0);
    await event(button("Refresh Job photos to retry"), "onPress");
    expect(current.refresh).toHaveBeenCalledTimes(1);
    expect(nodes("native-image")).toHaveLength(0); // Same expired URL remains failed.
  });
  it("uses the parent's canonical onRefresh callback and synchronously locks repeated retries", async () => {
    const wait = deferred();
    const onRefresh = vi.fn(() => wait.promise);
    const current = job();
    await render(gallery({ job: current, onRefresh }));
    await event(nodes("native-image")[0], "onError");
    const retry = button("Refresh Job photos to retry");
    await act(async () => {
      retry.nativeProps.onPress();
      retry.nativeProps.onPress();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(current.refresh).not.toHaveBeenCalled();
    expect(nodes("native-image")).toHaveLength(0);
    expect(container.textContent).toContain("Refreshing Job photos");
    await act(async () => {
      wait.resolve();
    });
  });
  it("shows canonical refresh rejection without fake success", async () => {
    await render(
      gallery({
        onRefresh: vi.fn().mockRejectedValue(new Error("fixture offline")),
      }),
    );
    await event(button("Refresh photos"), "onPress");
    expect(container.textContent).toContain(
      "Could not refresh Company Job photos",
    );
    expect(container.textContent).not.toContain("saved");
  });
  it("accepts a renewed canonical URL only after new detail renders and rejects old image callbacks", async () => {
    const current = job();
    await render(gallery({ job: current }));
    const oldImage = nodes("native-image")[0];
    await event(oldImage, "onError");
    await render(
      gallery({ job: { ...current, detail: detail([photo(1, "renewed")]) } }),
    );
    expect(nodes("native-image")[0].nativeProps.source.uri).toBe(
      photo(1, "renewed").imageUrl,
    );
    await event(oldImage, "onError");
    expect(container.textContent).not.toContain("Photo unavailable");
    await event(nodes("native-image")[0], "onLoad");
    expect(nodes("activity-indicator")).toHaveLength(0);
  });
  it("creates stable-photo and full-session scoped preview selection on tap", async () => {
    const onPreview = vi.fn();
    await render(gallery({ onPreview }));
    await event(button("Photo 1"), "onPress");
    expect(onPreview).toHaveBeenCalledWith({
      scope: companyPhotoScope(fixtureSession(), 12),
      photoId: 1,
      imageUrl: photo().imageUrl,
    });
  });
  it("renders preview in the existing sheet without a second Modal and reports native load failure", async () => {
    await render(preview());
    expect(nodes("native-image")).toHaveLength(1);
    expect(nodes("modal")).toHaveLength(0);
    await event(nodes("native-image")[0], "onError");
    expect(container.textContent).toContain("Photo could not load");
    expect(container.textContent).toContain("JobSync must renew expired links");
    expect(button("Close photo preview")).toBeDefined();
  });
  it("preview retry refreshes canonical detail, dismisses and never reopens from a late result", async () => {
    const wait = deferred();
    const current = job();
    current.refresh.mockImplementation(() => wait.promise);
    let closeCount = 0;
    function Sheet() {
      const [selection, setSelection] = useState<CompanyPhotoSelection | null>({
        scope: companyPhotoScope(fixtureSession(), 12)!,
        photoId: 1,
        imageUrl: photo().imageUrl,
      });
      return preview({
        job: current,
        photo: selection,
        onClose: () => {
          closeCount++;
          setSelection(null);
        },
      });
    }
    await render(<Sheet />);
    await event(nodes("native-image")[0], "onError");
    await event(button("Refresh Job photos to retry"), "onPress");
    expect(current.refresh).toHaveBeenCalledTimes(1);
    expect(closeCount).toBe(1);
    expect(nodes("native-image")).toHaveLength(0);
    await act(async () => {
      wait.resolve();
    });
    expect(nodes("native-image")).toHaveLength(0);
  });
  it("resets preview image state when a different canonical photo is selected", async () => {
    const current = job(detail([photo(), photo(2)]));
    await render(preview({ job: current }));
    const oldImage = nodes("native-image")[0];
    await event(oldImage, "onError");
    await render(
      preview({
        job: current,
        photo: {
          scope: companyPhotoScope(fixtureSession(), 12)!,
          photoId: 2,
          imageUrl: photo(2).imageUrl,
        },
      }),
    );
    await event(oldImage, "onError");
    expect(nodes("native-image")[0].nativeProps.source.uri).toBe(
      photo(2).imageUrl,
    );
    expect(container.textContent).not.toContain("could not load");
  });
  it.each(["Job", "Company", "token", "user", "role"])(
    "does not reopen old preview after %s changes even if its URL exists",
    async (change) => {
      const onClose = vi.fn();
      await render(preview({ onClose }));
      let session = fixtureSession();
      let jobId = 12;
      let current = job();
      if (change === "Job") {
        jobId = 13;
        current = job(detail([photo()], { id: 13 }));
      }
      if (change === "Company") {
        session = fixtureSession({ company: { ...session.company!, id: 10 } });
        current = job(detail([photo()], { companyId: 10 }));
      }
      if (change === "token")
        session = fixtureSession({ token: "rotated-fixture" });
      if (change === "user")
        session = fixtureSession({ user: { ...session.user, id: 43 } });
      if (change === "role")
        session = fixtureSession({
          user: { ...session.user, role: "dispatcher" },
        });
      await render(preview({ onClose, session, jobId, job: current }));
      expect(nodes("native-image")).toHaveLength(0);
      expect(onClose).toHaveBeenCalled();
    },
  );
  it("treats canonical empty gallery as authoritative and clears preview without legacy fallback", async () => {
    const onClose = vi.fn();
    await render(preview({ onClose }));
    await render(preview({ onClose, job: job(detail([])) }));
    expect(onClose).toHaveBeenCalled();
    expect(nodes("native-image")).toHaveLength(0);
    await render(gallery({ job: job(detail([])) }));
    expect(container.textContent).toContain("No server photos for this Job.");
    expect(nodes("native-image")).toHaveLength(0);
  });
  it.each(["loading", "pending", "error"])(
    "hides cached gallery during canonical %s and clears its preview",
    async (state) => {
      const current = {
        ...job(),
        [state]: state === "error" ? "fixture denied" : true,
      };
      await render(gallery({ job: current }));
      expect(nodes("native-image")).toHaveLength(0);
      const onClose = vi.fn();
      await render(preview({ job: current, onClose }));
      expect(nodes("native-image")).toHaveLength(0);
      expect(onClose).toHaveBeenCalled();
      expect(container.textContent).not.toContain("No server photos");
    },
  );
  it("does not call stale gallery taps or old retries after switching Jobs", async () => {
    const onPreview = vi.fn();
    const current = job();
    await render(gallery({ job: current, onPreview }));
    const oldTap = button("Photo 1");
    await event(nodes("native-image")[0], "onError");
    const oldRetry = button("Refresh Job photos to retry");
    await render(
      gallery({
        jobId: 13,
        job: job(detail([photo()], { id: 13 })),
        onPreview,
      }),
    );
    await event(oldTap, "onPress");
    await event(oldRetry, "onPress");
    expect(onPreview).not.toHaveBeenCalled();
    expect(current.refresh).not.toHaveBeenCalled();
  });
  it("drops a late failed refresh from the previous Company", async () => {
    const wait = deferred();
    await render(gallery({ onRefresh: () => wait.promise }));
    await event(button("Refresh photos"), "onPress");
    const session = fixtureSession();
    session.company = { ...session.company!, id: 10 };
    await render(
      gallery({ session, job: job(detail([photo()], { companyId: 10 })) }),
    );
    await act(async () => {
      wait.reject(new Error("old-company-fixture"));
    });
    expect(container.textContent).not.toContain("Could not refresh");
    expect(nodes("native-image")).toHaveLength(1);
  });
  it("rejects wrong-Company detail, signed-out sessions and unassigned Technician galleries", async () => {
    const session = fixtureSession();
    await render(gallery({ job: job(detail([photo()], { companyId: 10 })) }));
    expect(nodes("native-image")).toHaveLength(0);
    await render(gallery({ session: null }));
    expect(nodes("native-image")).toHaveLength(0);
    expect(button("Refresh photos").nativeProps.disabled).toBe(true);
    await render(
      gallery({
        session: fixtureSession({
          user: { ...session.user, role: "technician", id: 43 },
        }),
      }),
    );
    expect(nodes("native-image")).toHaveLength(0);
  });
  it("passes exact signed Company Job scope and guarded upload to the one shared draft without legacy/video mutations", async () => {
    await render(gallery());
    const draft = nodes("native-local-draft");
    expect(draft).toHaveLength(1);
    expect(draft[0].nativeProps.session.company.id).toBe(9);
    expect(draft[0].nativeProps.jobId).toBe(12);
    expect(draft[0].nativeProps.job.detail.photos).toHaveLength(1);
    expect(draft[0].nativeProps.onUpload).toBeTypeOf("function");
    expect(button("Remove Job photo 1").nativeProps.disabled).toBe(false);
    expect(
      nodes("native-touch").some((node) =>
        /^(Upload|Delete|Video)/i.test(node.textContent),
      ),
    ).toBe(false);
  });
  it("clears invalid preview state so returning photos after refresh cannot resurrect it", async () => {
    let current = job();
    function Sheet() {
      const [selection, setSelection] = useState<CompanyPhotoSelection | null>({
        scope: companyPhotoScope(fixtureSession(), 12)!,
        photoId: 1,
        imageUrl: photo().imageUrl,
      });
      return preview({
        job: current,
        photo: selection,
        onClose: () => setSelection(null),
      });
    }
    await render(<Sheet />);
    expect(nodes("native-image")).toHaveLength(1);
    current = { ...current, detail: null, loading: true };
    await render(<Sheet />);
    expect(nodes("native-image")).toHaveLength(0);
    current = job();
    await render(<Sheet />);
    expect(nodes("native-image")).toHaveLength(0);
  });
  it("invalidates a preview when canonical detail renews its URL without reopening it", async () => {
    const onClose = vi.fn();
    await render(preview({ onClose }));
    await render(preview({ onClose, job: job(detail([photo(1, "renewed")])) }));
    expect(nodes("native-image")).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("requires stable photo identity, not just matching URL", async () => {
    const onClose = vi.fn();
    await render(preview({ onClose }));
    await render(
      preview({ onClose, job: job(detail([{ ...photo(), id: 99 }])) }),
    );
    expect(nodes("native-image")).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("shows an assigned Technician's server photos with shared signed operation gating", async () => {
    const session = fixtureSession();
    session.user = { ...session.user, role: "technician" };
    await render(gallery({ session }));
    expect(nodes("native-image")).toHaveLength(1);
    expect(nodes("native-local-draft")).toHaveLength(1);
    expect(nodes("native-local-draft")[0].nativeProps.session.user.role).toBe("technician");
    expect(nodes("native-local-draft")[0].nativeProps.job.detail.photos).toHaveLength(1);
  });
  it("ignores stale retries after same-Company token rotation", async () => {
    const current = job();
    await render(gallery({ job: current }));
    await event(nodes("native-image")[0], "onError");
    const oldRetry = button("Refresh Job photos to retry");
    const refreshedJob = job();
    await render(
      gallery({
        session: fixtureSession({ token: "rotated" }),
        job: refreshedJob,
      }),
    );
    await event(oldRetry, "onPress");
    expect(current.refresh).not.toHaveBeenCalled();
    expect(refreshedJob.refresh).not.toHaveBeenCalled();
    expect(nodes("native-image")).toHaveLength(1);
  });
});

function removalServer(options: { ack?: unknown; remains?: boolean; failRead?: boolean } = {}) {
  const fetch=vi.fn(); let removed=false;
  fetch.mockImplementation(async (url:string, init:RequestInit) => {
    const path=new URL(url).pathname;
    if(path.endsWith("/auth/session")) return {ok:true,status:200,json:async()=>fixtureSession()};
    if(init.method==="DELETE") { removed=true; return {ok:true,status:200,json:async()=>options.ack === undefined ? {success:true} : options.ack}; }
    if(removed && options.failRead) throw new Error("fixture read failure");
    return {ok:true,status:200,json:async()=>({job:detail(removed && !options.remains ? [] : [photo()])})};
  });
  vi.stubGlobal("fetch",fetch); return fetch;
}
describe("shared gallery removal confirmation and lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends no deletion until explicit confirm tap, then requires exact ack and fresh absence", async () => {
    const fetch=removalServer(); const current=job(); await render(gallery({job:current}));
    await event(button("Remove Job photo 1"),"onPress");
    expect(fetch).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Stored media erasure is not guaranteed");
    const confirm=button("Confirm remove photo from Job");
    await act(async()=>{ confirm.nativeProps.onPress(); confirm.nativeProps.onPress(); });
    expect(fetch.mock.calls.filter(([,init])=>init.method==="DELETE")).toHaveLength(1);
    expect(container.textContent).toContain("absence confirmed by fresh detail");
    expect(nodes("native-image")).toHaveLength(0);
    expect(current.detail!.photos).toHaveLength(1); // immutable caller snapshot, not optimistic splicing
    const write=fetch.mock.calls.find(([,init])=>init.method==="DELETE")!;
    expect(new URL(write[0]).pathname).toBe("/api/mobile/v1/jobs/12/photos/1");
    expect(write[1].body).toBeUndefined();
  });
  it.each([{ack:{success:false}},{remains:true},{failRead:true}])("never claims successful removal on ack/readback failure %#", async options=>{
    const fetch=removalServer(options); await render(gallery()); await event(button("Remove Job photo 1"),"onPress"); await event(button("Confirm remove photo from Job"),"onPress");
    expect(fetch.mock.calls.filter(([,init])=>init.method==="DELETE")).toHaveLength(1);
    expect(container.textContent).not.toContain("absence confirmed by fresh detail");
    expect(container.textContent).toMatch(/unconfirmed|remains|confirmation failed/);
    if(options.failRead) expect(button("Remove Job photo 1").nativeProps.disabled).toBe(true);
  });
  it("cancel prevents stale confirm even when a previously captured callback is tapped", async()=>{
    const fetch=removalServer(); await render(gallery()); await event(button("Remove Job photo 1"),"onPress"); const old=button("Confirm remove photo from Job"); await event(button("Cancel photo removal"),"onPress"); await event(old,"onPress"); expect(fetch).not.toHaveBeenCalled();
  });
  it("web removal remains unavailable for documented backend DELETE CORS blocker", async()=>{
    lifecycle.platform.OS="web"; const fetch=removalServer(); await render(gallery()); expect(button("Remove Job photo 1").nativeProps.disabled).toBe(true); await event(button("Remove Job photo 1"),"onPress"); expect(fetch).not.toHaveBeenCalled(); expect(container.textContent).toContain("does not allow DELETE in CORS");
  });
  it.each(["owner","dispatcher"] as const)("%s can remove other uploader photos with no assignment or opt-in", async role=>{
    const session=fixtureSession(); session.user={...session.user,role,calendarEligible:false}; await render(gallery({session,job:job(detail([{...photo(),uploadedByUserId:43}],{assignedUserId:null}))})); expect(button("Remove Job photo 1").nativeProps.disabled).toBe(false);
  });
  it("technician requires current assignment AND own canonical uploader, unknown uploader denies managers too", async()=>{
    const session=fixtureSession(); session.user.role="technician"; await render(gallery({session,job:job(detail([{...photo(),uploadedByUserId:43}]))})); expect(button("Remove Job photo 1").nativeProps.disabled).toBe(true);
    await render(gallery({job:job(detail([{...photo(),uploadedByUserId:null}]))})); expect(button("Remove Job photo 1").nativeProps.disabled).toBe(true);
    await render(gallery({session,job:job(detail([photo()],{assignedUserId:43}))})); expect(nodes("native-image")).toHaveLength(0);
  });
  it.each(["Job","Company","token","user","role","blur","pending","reassignment","refresh"])("old confirmation cannot invoke DELETE after %s change and returning", async change=>{
    const fetch=removalServer(); await render(gallery()); await event(button("Remove Job photo 1"),"onPress"); const old=button("Confirm remove photo from Job");
    let session=fixtureSession(); let jobId=12; let current=job();
    if(change==="Job") {jobId=13;current=job(detail([photo()],{id:13}));}
    if(change==="Company") {session.company!.id=10;current=job(detail([photo()],{companyId:10}));}
    if(change==="token") session.token="rotated";
    if(change==="user") session.user.id=43;
    if(change==="role") session.user.role="dispatcher";
    if(change==="blur") lifecycle.focused=false;
    if(change==="pending") current.pending=true;
    if(change==="reassignment") {session.user.role="technician";current=job(detail([photo()],{assignedUserId:43}));}
    if(change==="refresh") current={...current,loading:true,detail:null};
    await render(gallery({session,jobId,job:current})); lifecycle.focused=true; await render(gallery()); await event(old,"onPress"); expect(fetch).not.toHaveBeenCalled();
  });
  it("blur permanently clears existing preview and rejects its late native callback",async()=>{
    const close=vi.fn(); await render(preview({onClose:close}));const image=nodes("native-image")[0]; lifecycle.focused=false; await render(preview({onClose:close})); await event(image,"onError"); expect(nodes("native-image")).toHaveLength(0);expect(close).toHaveBeenCalled();
  });
});
