import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyJobTags, type CompanyJobTagsProps } from "../components/company-job-tags";
import type { JobSyncNativeSession } from "../lib/jobsync-mobile-api";

const mocks = vi.hoisted(() => ({
  focused: true, state: "active", listeners: new Set<(state: string) => void>(),
  focusCleanup: null as null | (() => void),
}));
vi.mock("expo-router", async () => {
  const R = await import("react");
  return {
    useIsFocused: () => mocks.focused,
    useFocusEffect: (callback: () => void | (() => void)) => R.useEffect(() => {
      if (!mocks.focused) return;
      const cleanup = callback();
      mocks.focusCleanup = typeof cleanup === "function" ? cleanup : null;
      return () => { if (typeof cleanup === "function") cleanup(); };
    }, [callback]),
  };
});
vi.mock("@/hooks/use-job-sheet-colors", () => ({ useJobSheetColors: () => ({
  background: "#101319", surface: "#1c2028", foreground: "#f8fafc", muted: "#a5a9b2",
  border: "#2e333c", primary: "#0068ff", error: "#F06A6A",
}) }));
type NativeProps = Record<string, any>;
type NativeNode = PhotoTestNode & { nativeProps: NativeProps };
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: NativeProps) => R.createElement(name, {
    ref: (node: PhotoTestNode | null) => {
      if (node) (node as NativeNode).nativeProps = props;
      if (typeof props.ref === "function") props.ref(node);
      else if (props.ref) props.ref.current = node;
    },
  }, props.children);
  return {
    View: host("native-view"), Text: host("native-text"), TouchableOpacity: host("native-touch"),
    TextInput: host("native-input"), ActivityIndicator: host("native-activity"),
    StyleSheet: { create: (styles: unknown) => styles },
    AppState: {
      get currentState() { return mocks.state; },
      addEventListener: (_name: string, listener: (state: string) => void) => {
        mocks.listeners.add(listener);
        return { remove: () => mocks.listeners.delete(listener) };
      },
    },
  };
});
const nativeRequire = createRequire(import.meta.url);
const { createRoot } = nativeRequire("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
const tag = { id: 31, jobId: 42, displayName: "Priority", normalizedName: "priority", createdBy: 7,
  createdAt: "2026-11-17 12:00:00", updatedAt: null };
function fixture(): CompanyJobTagsProps {
  const session: JobSyncNativeSession = {
    token: "offline-ui-session", portal: "company",
    user: { id: 7, name: "Mock owner", email: null, role: "owner", calendarEligible: false },
    company: { id: 9, name: "Mock Company", slug: "mock", logoUrl: null, primaryColor: null, accentColor: null },
  };
  return {
    session, jobId: 42, isCurrent: () => true, operationScopeKey: "sheet-1", variant: "schedule",
    onInputFocus: vi.fn(), onInputBlur: vi.fn(), cardRef: vi.fn(),
    model: {
      tags: [{ ...tag }], actor: session, detail: { id: 42, companyId: 9, assignedUserId: 12 },
      loading: false, pending: false, error: null, success: null, reviewRequired: false,
      refresh: vi.fn().mockResolvedValue(undefined), review: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(false), remove: vi.fn().mockResolvedValue(false),
    },
  };
}

describe("Company Job Tags source React host — mocked/isolated, not native", () => {
  let root: ReturnType<typeof createRoot>;
  let container: PhotoTestNode;
  let props: CompanyJobTagsProps;
  function all(node = container): NativeNode[] {
    return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))];
  }
  function find(label: string) { return all().find((node) => node.nativeProps?.accessibilityLabel === label)?.nativeProps; }
  function get(label: string) {
    const node = find(label);
    if (!node) throw new Error(`Missing ${label}`);
    return node;
  }
  async function render(patch: Partial<CompanyJobTagsProps> = {}) {
    props = { ...props, ...patch };
    await act(async () => root.render(<CompanyJobTags {...props} />));
  }
  async function edit(value = "New tag") {
    if (props.variant !== "admin") await act(async () => get("Edit job tags").onPress());
    await act(async () => get("New job tag").onChangeText(value));
  }
  async function state(next: string) {
    await act(async () => { mocks.state = next; mocks.listeners.forEach((listener) => listener(next)); });
  }
  beforeEach(() => {
    mocks.focused = true; mocks.state = "active"; mocks.listeners.clear(); mocks.focusCleanup = null;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live HTTP forbidden")));
    const doc = installPhotoTestDOM();
    container = doc.createElement("main"); doc.body.appendChild(container); root = createRoot(container);
    props = fixture();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    expect(mocks.listeners.size).toBe(0); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });

  it("preserves canonical chip order, + Add/Done, whole measurable card ref and parent keyboard callbacks", async () => {
    props.model.tags!.push({ ...tag, id: 32, displayName: "Second", normalizedName: "second" });
    await render();
    expect(container.textContent).toContain("Job Tags");
    expect(container.textContent.indexOf("Priority")).toBeLessThan(container.textContent.indexOf("Second"));
    expect(find("New job tag")).toBeUndefined();
    const card = all().find((node) => node.nativeProps?.testID === "company-job-tags")!;
    expect(card.nativeProps.collapsable).toBe(false);
    expect(vi.mocked(props.cardRef as (node: unknown) => void).mock.calls.some(([node]) => node === card)).toBe(true);
    await edit("Draft");
    const input = get("New job tag");
    expect(input.returnKeyType).toBe("done");
    expect(input.maxLength).toBeUndefined(); // Limit is post-normalization, not raw native truncation.
    await act(async () => { input.onFocus({ currentTarget: {} }); input.onBlur({}); });
    expect(props.onInputFocus).toHaveBeenCalledTimes(1); expect(props.onInputBlur).toHaveBeenCalledTimes(1);
    await act(async () => get("Done editing job tags").onPress());
    expect(find("New job tag")).toBeUndefined(); expect(props.model.add).not.toHaveBeenCalled();
  });
  it("retains admin inline input and individually accessible remove buttons without a new toggle", async () => {
    await render({ variant: "admin" });
    expect(find("Edit job tags")).toBeUndefined(); expect(get("New job tag").value).toBe("");
    await act(async () => get("Remove job tag Priority").onPress());
    expect(props.model.remove).toHaveBeenCalledWith(31);
    expect(container.textContent).toContain("Priority"); // No optimistic removal.
  });
  it("does not pretend unknown/null is empty and offers a read-only Refresh action", async () => {
    await render({ model: { ...props.model, tags: null, actor: null, detail: null } });
    expect(container.textContent).toContain("not verified"); expect(container.textContent).not.toContain("No tags yet");
    expect(find("Edit job tags")).toBeUndefined();
    await act(async () => get("Refresh job tags").onPress());
    expect(props.model.refresh).toHaveBeenCalledTimes(1); expect(props.model.add).not.toHaveBeenCalled();
  });
  it("distinguishes a canonical empty collection", async () => {
    await render({ model: { ...props.model, tags: [] } });
    expect(container.textContent).toContain("No tags yet. Tap + Add"); expect(find("Edit job tags")).toBeDefined();
  });
  it("shows safe unavailable/error feedback and never fabricates suggestions", async () => {
    await render({ model: { ...props.model, tags: null, error: "Job tags are unavailable. Refresh to check." } });
    expect(container.textContent).toContain("unavailable"); expect(find("Edit job tags")).toBeUndefined();
    expect(container.textContent).not.toContain("Priority");
    expect(all().some((node) => node.nativeProps?.accessibilityRole === "alert")).toBe(true);
  });
  it.each([null, 99])("honestly denies technician read/write for assignee %s, without legacy fallback", async (assignee) => {
    const actor = { ...props.session!, user: { ...props.session!.user, role: "technician" as const } };
    await render({ session: actor, model: { ...props.model, actor, detail: { ...props.model.detail!, assignedUserId: assignee } } });
    expect(container.textContent).toContain("technicians must be assigned");
    expect(container.textContent).not.toContain("Priority"); expect(find("Edit job tags")).toBeUndefined();
    expect(props.model.add).not.toHaveBeenCalled(); expect(props.model.remove).not.toHaveBeenCalled();
  });
  it("allows an assigned technician without calendar/payment/status gates", async () => {
    const actor = { ...props.session!, user: { ...props.session!.user, role: "technician" as const, calendarEligible: false, paymentCollectionEnabled: false } };
    await render({ session: actor, model: { ...props.model, actor, detail: { ...props.model.detail!, assignedUserId: actor.user.id } } });
    await edit(); await act(async () => get("Add job tag").onPress());
    expect(props.model.add).toHaveBeenCalledTimes(1);
  });
  it("readOnly preserves verified chips but never exposes add/remove/input mutation", async () => {
    await render({ readOnly: true, variant: "admin" });
    expect(container.textContent).toContain("Priority"); expect(container.textContent).toContain("Read-only");
    expect(find("New job tag")).toBeUndefined(); expect(find("Remove job tag Priority")).toBeUndefined();
    await act(async () => get("Job tag Priority").onPress()); expect(props.model.remove).not.toHaveBeenCalled();
  });
  it("rejects normalized duplicates and canonicalizes NFKC whitespace before delegation", async () => {
    await render(); await edit(" ＰＲＩＯＲＩＴＹ \t");
    expect(get("Add job tag").disabled).toBe(true); expect(container.textContent).toContain("already exists");
    await act(async () => get("Add job tag").onPress()); expect(props.model.add).not.toHaveBeenCalled();
    await act(async () => get("New job tag").onChangeText("  Ａ  \t B  "));
    await act(async () => get("Add job tag").onPress()); expect(props.model.add).toHaveBeenCalledWith("A B");
  });
  it.each(["x".repeat(65), "bad\u0000name", "bad\u007fname", " "])("rejects invalid contract name %s", async (value) => {
    await render(); await edit(value); expect(get("Add job tag").disabled).toBe(true);
    await act(async () => get("Add job tag").onPress()); expect(props.model.add).not.toHaveBeenCalled();
  });
  it("deduplicates retained Add and keyboard submit synchronously; waits for canonical model, never optimistic success", async () => {
    const waiting = deferred<boolean>(); vi.mocked(props.model.add).mockReturnValue(waiting.promise);
    await render(); await edit("New tag");
    const add = get("Add job tag").onPress;
    const submit = get("New job tag").onSubmitEditing;
    await act(async () => { add(); add(); submit(); });
    expect(props.model.add).toHaveBeenCalledTimes(1); expect(get("Add job tag").disabled).toBe(true);
    expect(container.textContent).not.toContain("saved"); expect(props.model.tags).toEqual([tag]);
    await act(async () => waiting.resolve(true));
    expect(get("New job tag").value).toBe(""); expect(props.model.tags).toEqual([tag]);
    await act(async () => add()); expect(props.model.add).toHaveBeenCalledTimes(1);
    await render({ model: { ...props.model, tags: [{ ...tag }, { ...tag, id: 33, displayName: "New tag", normalizedName: "new tag" }], success: "Tag added and verified." } });
    expect(container.textContent).toContain("Tag added and verified."); expect(container.textContent).toContain("New tag");
  });
  it("deduplicates individual remove callbacks and keeps the chip until canonical reconciliation", async () => {
    const waiting = deferred<boolean>(); vi.mocked(props.model.remove).mockReturnValue(waiting.promise);
    await render(); await edit(); const remove = get("Remove job tag Priority").onPress;
    await act(async () => { remove(); remove(); }); expect(props.model.remove).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Priority");
    await act(async () => waiting.resolve(true)); expect(container.textContent).toContain("Priority");
    await render({ model: { ...props.model, tags: [] } }); await act(async () => remove());
    expect(props.model.remove).toHaveBeenCalledTimes(1); expect(container.textContent).not.toContain("Priority");
  });
  it("Done invalidates retained Add/change/remove in the same turn and after reopen", async () => {
    await render(); await edit();
    const add = get("Add job tag").onPress, change = get("New job tag").onChangeText, remove = get("Remove job tag Priority").onPress;
    await act(async () => { get("Done editing job tags").onPress(); add(); remove(); change("Stale"); });
    expect(props.model.add).not.toHaveBeenCalled(); expect(props.model.remove).not.toHaveBeenCalled();
    await edit("Fresh"); await act(async () => { add(); remove(); change("Stale"); });
    expect(get("New job tag").value).toBe("Fresh"); expect(props.model.add).not.toHaveBeenCalled();
  });
  it("reviewRequired blocks all writes; ordinary Refresh never invokes review or resends", async () => {
    await render({ model: { ...props.model, reviewRequired: true, error: "Change could not be confirmed." } });
    expect(find("Edit job tags")).toBeUndefined(); expect(container.textContent).toContain("no change will be resent");
    await act(async () => get("Refresh job tags").onPress());
    expect(props.model.refresh).toHaveBeenCalledTimes(1); expect(props.model.review).not.toHaveBeenCalled();
    await act(async () => get("Refresh and review job tags").onPress());
    expect(props.model.review).toHaveBeenCalledTimes(1); expect(props.model.add).not.toHaveBeenCalled();
  });
  it("false/unconfirmed outcome retains draft with no success or automatic retry", async () => {
    await render(); await edit("Unconfirmed"); await act(async () => get("Add job tag").onPress());
    expect(get("New job tag").value).toBe("Unconfirmed"); expect(container.textContent).not.toContain("verified.");
    await render({ model: { ...props.model, reviewRequired: true, error: "Add could not be confirmed. Review current tags." } });
    expect(find("New job tag")).toBeUndefined(); expect(props.model.add).toHaveBeenCalledTimes(1);
  });
  it.each(["tenant", "token", "user", "role", "job", "epoch", "guard", "actions", "actor", "assignment", "collection", "readOnly"])(
    "rejects retained Add/remove after %s changes", async (kind) => {
      await render(); await edit(); const add = get("Add job tag").onPress, remove = get("Remove job tag Priority").onPress;
      if (kind === "tenant") await render({ session: { ...props.session!, company: { ...props.session!.company!, id: 10 } } });
      if (kind === "token") await render({ session: { ...props.session!, token: "rotated" } });
      if (kind === "user") await render({ session: { ...props.session!, user: { ...props.session!.user, id: 8 } } });
      if (kind === "role") await render({ session: { ...props.session!, user: { ...props.session!.user, role: "dispatcher" } } });
      if (kind === "job") await render({ jobId: 43 });
      if (kind === "epoch") await render({ operationScopeKey: "sheet-2" });
      if (kind === "guard") await render({ isCurrent: () => false });
      if (kind === "actions") await render({ operationScopeKey: "new-controller", model: { ...props.model, add: vi.fn().mockResolvedValue(true) } });
      if (kind === "actor") await render({ model: { ...props.model, actor: null } });
      if (kind === "assignment") {
        const actor = { ...props.session!, user: { ...props.session!.user, role: "technician" as const } };
        await render({ session: actor, model: { ...props.model, actor, detail: { ...props.model.detail!, assignedUserId: null } } });
      }
      if (kind === "collection") await render({ model: { ...props.model, tags: [] } });
      if (kind === "readOnly") await render({ readOnly: true });
      await act(async () => { add(); remove(); }); expect(props.model.add).not.toHaveBeenCalled(); expect(props.model.remove).not.toHaveBeenCalled();
    },
  );
  it.each(["blur/refocus", "background/resume", "same-job close/reopen"])("never revives retained callbacks after %s", async (kind) => {
    await render(); await edit(); const add = get("Add job tag").onPress, remove = get("Remove job tag Priority").onPress;
    if (kind === "blur/refocus") {
      await act(async () => mocks.focusCleanup?.()); mocks.focused = false; await render(); mocks.focused = true; await render();
    } else if (kind === "background/resume") { await state("background"); await state("active"); }
    else { await act(async () => root.render(null)); await render({ operationScopeKey: "sheet-2" }); }
    await act(async () => { add(); remove(); }); expect(props.model.add).not.toHaveBeenCalled(); expect(props.model.remove).not.toHaveBeenCalled();
    expect(find("New job tag")).toBeUndefined();
  });
  it("ignores pending completion after close/reopen without clearing the new editor or fabricating success", async () => {
    const waiting = deferred<boolean>(); vi.mocked(props.model.add).mockReturnValue(waiting.promise);
    await render(); await edit(); await act(async () => get("Add job tag").onPress());
    await act(async () => root.render(null)); await render({ operationScopeKey: "sheet-2", model: { ...props.model, pending: true, reviewRequired: true } });
    await act(async () => waiting.resolve(true));
    expect(container.textContent).not.toContain("verified."); expect(props.model.add).toHaveBeenCalledTimes(1);
    expect(find("Edit job tags")).toBeUndefined();
  });
  it("suppresses unhandled action failures and does not expose thrown backend bodies", async () => {
    vi.mocked(props.model.add).mockRejectedValue(new Error("sensitive SQL/body"));
    await render(); await edit(); await act(async () => get("Add job tag").onPress());
    expect(container.textContent).toContain("could not be confirmed"); expect(container.textContent).not.toContain("sensitive");
    expect(props.model.add).toHaveBeenCalledTimes(1);
    expect(find("Edit job tags")).toBeUndefined();
    await act(async () => get("Refresh job tags").onPress());
    expect(find("Edit job tags")).toBeUndefined();
    await act(async () => get("Refresh and review job tags").onPress());
    expect(find("Edit job tags")).toBeDefined();
    expect(props.model.add).toHaveBeenCalledTimes(1);
  });
  it("preserves a reviewed draft across hook action reference churn and pending/readback renders", async () => {
    const waiting = deferred<boolean>();
    vi.mocked(props.model.add).mockReturnValue(waiting.promise);
    await render(); await edit("Reviewed draft");
    const original = props.model.add;
    await render({ model: { ...props.model, add: (name) => original(name), remove: (id) => props.model.remove(id),
      refresh: vi.fn().mockResolvedValue(undefined), review: vi.fn().mockResolvedValue(undefined) } });
    expect(get("New job tag").value).toBe("Reviewed draft");
    await act(async () => get("Add job tag").onPress());
    await render({ model: { ...props.model, pending: true } });
    expect(get("New job tag").value).toBe("Reviewed draft");
    expect(get("Add job tag").disabled).toBe(true);
    await render({ model: { ...props.model, pending: false, tags: [{ ...tag }, { ...tag, id: 33,
      displayName: "Reviewed draft", normalizedName: "reviewed draft" }], success: "Tag added and verified." } });
    await act(async () => waiting.resolve(true));
    expect(get("New job tag").value).toBe("");
    expect(container.textContent).toContain("Tag added and verified.");
    expect(original).toHaveBeenCalledTimes(1);
  });
});
