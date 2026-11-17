import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal, ScrollView, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CompanyJobKeyboardBoundary } from "../components/company-job-keyboard-boundary";
import { companyJobFocusScrollOffset, useCompanyJobKeyboard, type CompanyJobKeyboardTarget } from "../lib/company-job-keyboard";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";

const mocks = vi.hoisted(() => ({
  platform: "ios", state: "active", nativeHeight: 280, navigationInset: 34, scrollOffset: 0,
  inputY: 430, inputHeight: 44, groupY: 418, groupHeight: 96, safeBottom: 0,
  focused: null as unknown, deferred: false, measurements: [] as (() => void)[], scrollTo: vi.fn(),
  listeners: new Map<string, Set<(value: unknown) => void>>(),
}));
type HostProps = Record<string, any>;
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: HostProps) => {
    const instance = R.useMemo(() => ({
      measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => {
        const measure = () => callback(0, name === "native-scroll" ? 100
          : name === "native-input" ? mocks.inputY - mocks.scrollOffset : mocks.groupY - mocks.scrollOffset,
        320, name === "native-scroll" ? mocks.nativeHeight - mocks.safeBottom
          : name === "native-input" ? mocks.inputHeight : mocks.groupHeight);
        if (mocks.deferred) mocks.measurements.push(measure); else measure();
      },
      getNativeScrollRef: (): CompanyJobKeyboardTarget => instance,
      scrollTo: (options: { y: number; animated: boolean }) => { mocks.scrollTo(options); mocks.scrollOffset = options.y; },
    }), []);
    R.useImperativeHandle(props.ref, () => instance, [instance]);
    return R.createElement(name, { ref: (node: PhotoTestNode | null) => {
      if (node) { (node as NativeNode).nativeProps = props; (node as NativeNode).nativeInstance = instance; }
    } }, props.children);
  };
  const subscribe = (event: string, listener: (value: unknown) => void) => {
    const listeners = mocks.listeners.get(event) ?? new Set();
    listeners.add(listener); mocks.listeners.set(event, listeners);
    return { remove: () => listeners.delete(listener) };
  };
  return {
    Modal: host("native-modal"), View: host("native-view"), ScrollView: host("native-scroll"),
    TextInput: Object.assign(host("native-input"), { State: { currentlyFocusedInput: () => mocks.focused } }),
    TouchableOpacity: host("native-button"), KeyboardAvoidingView: host("native-keyboard"),
    Platform: { get OS() { return mocks.platform; } }, Keyboard: { addListener: subscribe },
    AppState: { get currentState() { return mocks.state; }, addEventListener: subscribe },
  };
});
vi.mock("react-native-safe-area-context", async () => {
  const R = await import("react");
  return { SafeAreaView: (props: HostProps) => {
    mocks.safeBottom = props.edges.includes("bottom") ? mocks.navigationInset : 0;
    return R.createElement("native-safe-area", { ref: (node: PhotoTestNode | null) => {
      if (node) (node as NativeNode).nativeProps = props;
    } }, props.children);
  } };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (node: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
type NativeNode = PhotoTestNode & { nativeProps: HostProps; nativeInstance: CompanyJobKeyboardTarget };
type FixtureProps = { active: boolean; scope: string; body: string; group: string; callbackRevision: number };
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let props: FixtureProps;
let current: boolean;
let add: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;

/** Parent handoff fixture only: not a mounted production screen or native-device simulation. */
function TagSheetFixture({ active, scope, body, group, callbackRevision }: FixtureProps) {
  const { attachScrollRef, relatedRef, scrollProps, onInputFocus, onInputBlur } = useCompanyJobKeyboard({
    active, scopeKey: scope, isCurrent: () => current && callbackRevision >= 0,
  });
  return <Modal visible={active} transparent={false} statusBarTranslucent={false} navigationBarTranslucent={false} testID="modal">
    <CompanyJobKeyboardBoundary active={active} keyboardVerticalOffset={0} style={{ flex: 1 }} testID="boundary">
      <SafeAreaView edges={mocks.platform === "ios" ? ["bottom"] : []} style={{ flex: 1 }} testID="safe-area">
        <ScrollView key={body} ref={attachScrollRef} {...scrollProps} testID="body"
          automaticallyAdjustKeyboardInsets={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View key={group} ref={relatedRef} collapsable={false} testID="tag-controls">
            <TextInput onFocus={onInputFocus} onBlur={onInputBlur} testID="tag-input" accessibilityLabel="New Job tag" />
            <TouchableOpacity testID="add" accessibilityRole="button" accessibilityLabel="Add Job tag" onPress={add} />
            <TouchableOpacity testID="remove" accessibilityRole="button" accessibilityLabel="Remove Priority tag" onPress={remove} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </CompanyJobKeyboardBoundary>
  </Modal>;
}
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function node(id: string) {
  const found = all().find((candidate) => candidate.nativeProps?.testID === id);
  if (!found) throw new Error(`Missing ${id}`);
  return found;
}
async function render(patch: Partial<FixtureProps> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(<TagSheetFixture {...props} />));
}
async function size(height = 1100) { await act(async () => node("body").nativeProps.onContentSizeChange(320, height)); }
async function focus(numeric = false) {
  mocks.focused = node("tag-input").nativeInstance;
  await act(async () => node("tag-input").nativeProps.onFocus({ currentTarget: numeric ? 23 : mocks.focused }));
}
async function event(name: string, value: unknown = {}) {
  await act(async () => { mocks.listeners.get(name)?.forEach((listener) => listener(value)); });
}
async function flush() { await act(async () => vi.advanceTimersByTime(300)); }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.listeners.clear();
  mocks.platform = "ios"; mocks.state = "active"; mocks.nativeHeight = 280; mocks.navigationInset = 34;
  mocks.safeBottom = 0; mocks.scrollOffset = 0; mocks.inputY = 430; mocks.inputHeight = 44;
  mocks.groupY = 418; mocks.groupHeight = 96; mocks.focused = null; mocks.deferred = false; mocks.measurements = [];
  current = true; add = vi.fn(); remove = vi.fn();
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container);
  root = createRoot(container); props = { active: true, scope: "company:actor:job:sheet-epoch", body: "body-1", group: "tags", callbackRevision: 0 };
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No live transport in keyboard tests")));
});
afterEach(async () => {
  await act(async () => root.unmount()); expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("Company Job tag keyboard — mocked native geometry and exact parent ref/inset fixture", () => {
  it.each(["ios", "android", "web"])("has one IME owner, one navigation owner and no tab-bar inset on %s", async (platform) => {
    mocks.platform = platform; await render();
    expect(node("boundary").nativeProps).toMatchObject({ enabled: platform === "ios", behavior: platform === "ios" ? "padding" : undefined, keyboardVerticalOffset: 0 });
    expect(node("modal").nativeProps).toMatchObject({ transparent: false, statusBarTranslucent: false, navigationBarTranslucent: false });
    expect(node("safe-area").nativeProps.edges).toEqual(platform === "ios" ? ["bottom"] : []);
    expect(node("body").nativeProps).toMatchObject({ automaticallyAdjustKeyboardInsets: false, keyboardShouldPersistTaps: "handled", keyboardDismissMode: "on-drag" });
    expect(node("body").nativeProps).not.toHaveProperty("contentInset");
    expect(node("body").nativeProps).not.toHaveProperty("contentContainerStyle");
    expect(node("boundary").nativeProps).not.toHaveProperty("contentContainerStyle");
    expect(mocks.safeBottom).toBe(platform === "ios" ? 34 : 0);
  });
  it.each(["ios", "android"])("reveals the focused tag input plus fitting selectable controls after resize (%s)", async (platform) => {
    mocks.platform = platform; await render(); await size(); await focus(); await event("keyboardDidShow", { endCoordinates: { height: 400 } }); await flush();
    const expected = platform === "ios" ? 180 : 146;
    expect(mocks.scrollTo.mock.calls).toEqual([[{ y: expected, animated: false }]]);
    const top = 100 + 12; const bottom = 100 + mocks.nativeHeight - mocks.safeBottom - 12;
    expect(mocks.groupY - mocks.scrollOffset).toBeGreaterThanOrEqual(top);
    expect(mocks.groupY + mocks.groupHeight - mocks.scrollOffset).toBeLessThanOrEqual(bottom);
    expect(node("tag-controls").nativeProps.collapsable).toBe(false);
    expect(node("add").nativeProps).toMatchObject({ accessibilityRole: "button", accessibilityLabel: "Add Job tag" });
    expect(node("remove").nativeProps).toMatchObject({ accessibilityRole: "button", accessibilityLabel: "Remove Priority tag" });
    await act(async () => { node("add").nativeProps.onPress(); node("remove").nativeProps.onPress(); });
    expect(add).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce();
  });
  it("uses measured Android viewport, not keyboard height or a second bottom navigation inset", async () => {
    mocks.platform = "android"; mocks.nativeHeight = 600; mocks.navigationInset = 48;
    await render(); await size(); await focus(); await flush(); expect(mocks.scrollTo).not.toHaveBeenCalled();
    mocks.nativeHeight = 220;
    await act(async () => node("body").nativeProps.onLayout({ nativeEvent: { layout: { height: 220 } } })); await flush();
    expect(mocks.scrollTo).toHaveBeenLastCalledWith({ y: 206, animated: false });
    await event("keyboardDidChangeFrame", { endCoordinates: { height: 999 } }); await flush();
    expect(mocks.scrollTo).toHaveBeenCalledOnce(); expect(mocks.safeBottom).toBe(0);
  });
  it("responds to an iOS navigation inset change via measured layout without injecting padding", async () => {
    await render(); await size(); await focus(); await flush(); expect(mocks.scrollOffset).toBe(180);
    mocks.navigationInset = 20; await render();
    await act(async () => node("body").nativeProps.onLayout({})); await flush();
    expect(mocks.safeBottom).toBe(20); expect(mocks.scrollTo).toHaveBeenCalledOnce();
    mocks.navigationInset = 44; await render();
    await act(async () => node("body").nativeProps.onLayout({})); await flush();
    expect(mocks.scrollTo).toHaveBeenLastCalledWith({ y: 190, animated: false });
  });
  it("prioritizes the input when many tag chips exceed the viewport and leaves them manually scrollable", async () => {
    mocks.groupHeight = 620; await render(); await size(); await focus(); await flush();
    expect(mocks.scrollTo).toHaveBeenLastCalledWith({ y: 140, animated: false });
    await act(async () => node("body").nativeProps.onScrollBeginDrag({}));
    mocks.scrollOffset = 300; await act(async () => node("body").nativeProps.onScroll({ nativeEvent: { contentOffset: { y: 300 } } }));
    await event("keyboardDidShow"); await size(1300); await flush();
    expect(mocks.scrollTo).toHaveBeenCalledOnce(); expect(mocks.scrollOffset).toBe(300);
    await event("keyboardDidHide"); expect(mocks.scrollOffset).toBe(300);
    await focus(true); await flush(); expect(mocks.scrollTo).toHaveBeenLastCalledWith({ y: 140, animated: false });
  });
  it("resets the old native body's offset and content extent on same-Job close/reopen", async () => {
    mocks.platform = "android"; mocks.groupHeight = 620;
    await render(); await size(); await focus(); await flush(); expect(mocks.scrollOffset).toBe(106);
    mocks.scrollOffset = 300; await act(async () => node("body").nativeProps.onScroll({ nativeEvent: { contentOffset: { y: 300 } } }));
    await render({ active: false }); mocks.scrollOffset = 0;
    await render({ active: true, body: "body-2", scope: "company:actor:same-job:new-sheet-epoch" });
    await focus(); await flush(); expect(mocks.scrollTo).toHaveBeenCalledOnce(); // New extent has not been measured.
    await size(); await flush(); expect(mocks.scrollTo).toHaveBeenLastCalledWith({ y: 106, animated: false });
    expect(mocks.scrollTo).toHaveBeenCalledTimes(2);
  });
  it("retains the measured origin when only the same mounted body's scope changes", async () => {
    mocks.platform = "android"; mocks.groupHeight = 620;
    await render(); await size(); await focus(); await flush(); expect(mocks.scrollOffset).toBe(106);
    await render({ scope: "company:new-actor:same-mounted-body" }); await focus(); await flush();
    expect(mocks.scrollTo).toHaveBeenCalledOnce();
  });
  it.each(["scope", "inactive", "stale", "background", "blur", "hide", "body", "unmount"])("rejects deferred old-input measurements after %s", async (change) => {
    await render(); await size(); mocks.deferred = true; await focus(); await flush();
    expect(mocks.measurements.length).toBeGreaterThan(0);
    if (change === "scope") await render({ scope: "different-company:actor:job:epoch" });
    else if (change === "inactive") await render({ active: false });
    else if (change === "stale") current = false;
    else if (change === "background") { mocks.state = "background"; await event("change", "background"); }
    else if (change === "blur") await act(async () => node("tag-input").nativeProps.onBlur({}));
    else if (change === "hide") await event("keyboardDidHide");
    else if (change === "body") await render({ body: "replaced-body" });
    else await act(async () => root.unmount());
    await act(async () => mocks.measurements.splice(0).forEach((measurement) => measurement()));
    expect(mocks.scrollTo).not.toHaveBeenCalled();
  });
  it("does not resurrect old focus after background, but handles fresh foreground focus", async () => {
    await render(); await size(); await focus(); mocks.state = "inactive"; await event("change", "inactive");
    mocks.state = "active"; await event("change", "active"); await event("keyboardDidShow"); await flush();
    expect(mocks.scrollTo).not.toHaveBeenCalled(); await focus(); await flush(); expect(mocks.scrollTo).toHaveBeenCalledOnce();
  });
  it("coalesces tag content updates and current-guard rerenders without an input jump", async () => {
    await render(); await size(); await focus(); await flush(); expect(mocks.scrollOffset).toBe(180);
    await render({ callbackRevision: 1 }); await event("keyboardDidChangeFrame"); await flush(); expect(mocks.scrollTo).toHaveBeenCalledOnce();
    mocks.groupHeight = 116; await size(); await size(); await size();
    expect(vi.getTimerCount()).toBe(3); await flush(); expect(mocks.scrollTo).toHaveBeenLastCalledWith({ y: 200, animated: false });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("removes subscriptions and rejects retained tag focus after scope replacement/unmount", async () => {
    await render(); await size(); const oldFocus = node("tag-input").nativeProps.onFocus; const target = node("tag-input").nativeInstance;
    await render({ scope: "new-job:epoch" }); await act(async () => oldFocus({ currentTarget: target })); await flush();
    expect(mocks.scrollTo).not.toHaveBeenCalled();
    const latest = node("tag-input").nativeProps.onFocus; await act(async () => root.unmount());
    expect([...mocks.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    await act(async () => latest({ currentTarget: target })); await flush(); expect(mocks.scrollTo).not.toHaveBeenCalled();
  });
  it("bounds a final tag row correction to actual content and rejects invalid geometry", async () => {
    mocks.platform = "android"; await render(); await size(330); await focus(); await flush();
    expect(mocks.scrollTo.mock.calls).toEqual([[{ y: 50, animated: false }]]); expect(vi.getTimerCount()).toBe(0);
    expect(companyJobFocusScrollOffset({ viewport: { y: 100, height: 0 }, input: { y: 430, height: 44 }, offset: 0, contentHeight: 1100 })).toBeNull();
    expect(companyJobFocusScrollOffset({ viewport: { y: 100, height: 280 }, input: { y: 430, height: 44 }, offset: 0, contentHeight: Number.NaN })).toBeNull();
  });
  it("does not add native focus correction on web", async () => {
    mocks.platform = "web"; await render(); await size(); await focus(); await event("keyboardDidShow"); await flush();
    expect(mocks.scrollTo).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
