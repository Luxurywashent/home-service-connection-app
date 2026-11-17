import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyJobKeyboardBoundary } from "../components/company-job-keyboard-boundary";
import { companyJobFocusScrollOffset, useCompanyJobKeyboard, type CompanyJobKeyboardTarget } from "../lib/company-job-keyboard";
import { Modal, ScrollView, TextInput, TouchableOpacity, View } from "react-native";

const mocks = vi.hoisted(() => ({ platform: "ios", state: "active", offset: 0, viewportY: 100, viewportHeight: 280,
  inputY: 430, inputHeight: 44, relatedY: 418, relatedHeight: 96, focused: null as unknown,
  listeners: new Map<string, Set<(...args: any[]) => void>>(), scrollTo: vi.fn(), deferred: false,
  measurements: [] as (() => void)[] }));
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => {
    const instance = R.useMemo(() => ({
      measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => {
        const measure = () => callback(0, name === "native-scroll" ? mocks.viewportY
          : name === "native-input" ? mocks.inputY - mocks.offset : mocks.relatedY - mocks.offset,
        320, name === "native-scroll" ? mocks.viewportHeight : name === "native-input" ? mocks.inputHeight : mocks.relatedHeight);
        if (mocks.deferred) mocks.measurements.push(measure); else measure();
      },
      scrollTo: (options: { y: number; animated: boolean }) => { mocks.scrollTo(options); mocks.offset = options.y; },
      getNativeScrollRef: (): CompanyJobKeyboardTarget => instance,
    }), []);
    R.useImperativeHandle(props.ref, () => instance, [instance]);
    return R.createElement(name, { ref: (node: PhotoTestNode | null) => {
      if (node) { (node as NativeNode).nativeProps = props; (node as NativeNode).nativeInstance = instance; }
    } }, props.children);
  };
  const subscribe = (event: string, listener: (...args: any[]) => void) => {
    const listeners = mocks.listeners.get(event) ?? new Set(); listeners.add(listener); mocks.listeners.set(event, listeners);
    return { remove: () => listeners.delete(listener) };
  };
  const Input = Object.assign(host("native-input"), { State: { currentlyFocusedInput: () => mocks.focused } });
  return { Modal: host("native-modal"), View: host("native-view"), ScrollView: host("native-scroll"), TextInput: Input,
    TouchableOpacity: host("native-touch"), KeyboardAvoidingView: host("native-keyboard"), Platform: { get OS() { return mocks.platform; } },
    Keyboard: { addListener: subscribe }, AppState: { get currentState() { return mocks.state; }, addEventListener: subscribe } };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as { createRoot: (node: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any>; nativeInstance: CompanyJobKeyboardTarget };
let root: ReturnType<typeof createRoot>; let container: PhotoTestNode;
let current: boolean; let selected: ReturnType<typeof vi.fn>;
type FixtureProps = { active: boolean; scopeKey: string; related: boolean; offset: number };
let props: FixtureProps;
function ExistingModalFixture({ active, scopeKey, related, offset }: FixtureProps) {
  const { attachScrollRef, relatedRef, scrollProps, onInputFocus, onInputBlur } = useCompanyJobKeyboard({ active, isCurrent: () => current, scopeKey });
  return <Modal visible><CompanyJobKeyboardBoundary active={active} keyboardVerticalOffset={offset} testID="boundary" style={{ flex: 1 }}>
    <View testID="pinned-header" />
    <ScrollView ref={attachScrollRef} {...scrollProps} testID="body" automaticallyAdjustKeyboardInsets={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View ref={related ? relatedRef : undefined} testID="related"><TextInput testID="input" onFocus={onInputFocus} onBlur={onInputBlur} />
        <TouchableOpacity testID="existing-choice" onPress={selected} /></View>
    </ScrollView><View testID="pinned-footer" />
  </CompanyJobKeyboardBoundary></Modal>;
}
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function node(id: string) { const found = all().find((value) => value.nativeProps?.testID === id); if (!found) throw new Error(`Missing ${id}`); return found; }
async function render(patch: Partial<FixtureProps> = {}) { props = { ...props, ...patch }; await act(async () => root.render(<ExistingModalFixture {...props} />)); }
async function flush() { await act(async () => vi.advanceTimersByTime(300)); }
async function focus(nativeTarget = true) { mocks.focused = node("input").nativeInstance; await act(async () => node("input").nativeProps.onFocus({ currentTarget: nativeTarget ? mocks.focused : 17 })); }
async function event(name: string, value: unknown = {}) { await act(async () => { mocks.listeners.get(name)?.forEach((listener) => listener(value)); }); }
async function size(height = 1100) { await act(async () => node("body").nativeProps.onContentSizeChange(320, height)); }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.platform = "ios"; mocks.state = "active"; mocks.offset = 0; mocks.viewportY = 100; mocks.viewportHeight = 280;
  mocks.inputY = 430; mocks.inputHeight = 44; mocks.relatedY = 418; mocks.relatedHeight = 96; mocks.focused = null;
  mocks.deferred = false; mocks.measurements = []; mocks.listeners.clear(); current = true; selected = vi.fn();
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  props = { active: true, scopeKey: "session:tenant:job:epoch", related: false, offset: 0 };
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden")));
});
afterEach(async () => { await act(async () => root.unmount()); expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Phase 2 existing modal keyboard boundary — actual React props/focus/events, mocked native geometry", () => {
  it.each(["ios", "android", "web"])("uses one iOS avoidance and no Android/web keyboard resize (%s)", async (platform) => {
    mocks.platform = platform; await render({ offset: 21 });
    expect(node("boundary").nativeProps).toMatchObject({ enabled: platform === "ios", behavior: platform === "ios" ? "padding" : undefined, keyboardVerticalOffset: 21, style: { flex: 1 } });
    expect(node("body").nativeProps).toMatchObject({ automaticallyAdjustKeyboardInsets: false, keyboardShouldPersistTaps: "handled", keyboardDismissMode: "on-drag" });
    expect(node("pinned-header").parentNode).toBe(node("boundary")); expect(node("pinned-footer").parentNode).toBe(node("boundary"));
    expect(node("body").nativeProps).not.toHaveProperty("contentInset"); expect(node("boundary").nativeProps).not.toHaveProperty("contentContainerStyle");
  });
  it("scrolls the actual focused input by only its obscured extent, without repeated scrolling", async () => {
    await render(); await size(); await focus(); await event("keyboardDidShow"); await flush();
    expect(mocks.scrollTo.mock.calls).toEqual([[{ y: 106, animated: false }]]);
    await event("keyboardDidChangeFrame"); await flush(); expect(mocks.scrollTo).toHaveBeenCalledTimes(1);
  });
  it("keeps a fitting related selector and input visible and its existing tap handled with keyboard open", async () => {
    await render({ related: true }); await size(); await focus(); await event("keyboardDidShow"); await flush();
    expect(mocks.scrollTo).toHaveBeenLastCalledWith({ y: 146, animated: false });
    await act(async () => node("existing-choice").nativeProps.onPress()); expect(selected).toHaveBeenCalledTimes(1);
  });
  it("does not sacrifice input visibility for an oversized related control group", async () => {
    mocks.relatedHeight = 500; await render({ related: true }); await size(); await focus(); await flush();
    expect(mocks.scrollTo).toHaveBeenLastCalledWith({ y: 106, animated: false });
  });
  it("responds to Android native Modal viewport resize even without a keyboard event", async () => {
    mocks.platform = "android"; mocks.viewportHeight = 600; await render(); await size(); await focus(); await flush(); expect(mocks.scrollTo).not.toHaveBeenCalled();
    mocks.viewportHeight = 220; await act(async () => node("body").nativeProps.onLayout({ nativeEvent: { layout: { height: 220 } } })); await flush();
    expect(mocks.scrollTo).toHaveBeenLastCalledWith({ y: 166, animated: false }); expect(node("boundary").nativeProps.enabled).toBe(false);
  });
  it("bounds the correction to content extent and does not schedule an infinite retry", async () => {
    await render(); await size(330); await focus(); await flush(); expect(mocks.scrollTo).toHaveBeenLastCalledWith({ y: 50, animated: false });
    expect(mocks.scrollTo).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("coalesces a keyboard-event burst to bounded measurement passes", async () => {
    await render(); await size(); await focus(); for (let i = 0; i < 10; i++) await event("keyboardDidShow");
    expect(vi.getTimerCount()).toBe(3); await flush(); expect(vi.getTimerCount()).toBe(0); expect(mocks.scrollTo).toHaveBeenCalledTimes(1);
  });
  it.each(["blur", "hide", "inactive", "stale", "scope"])("drops deferred measurement and retained focus after %s", async (change) => {
    await render(); await size(); mocks.deferred = true; await focus(); await flush(); expect(mocks.measurements.length).toBeGreaterThan(0);
    if (change === "blur") await act(async () => node("input").nativeProps.onBlur({}));
    else if (change === "hide") await event("keyboardDidHide");
    else if (change === "inactive") { mocks.state = "background"; await event("change", "background"); }
    else if (change === "stale") current = false;
    else await render({ scopeKey: "replacement-job:epoch" });
    await act(async () => mocks.measurements.splice(0).forEach((measure) => measure())); expect(mocks.scrollTo).not.toHaveBeenCalled();
  });
  it("rejects an old focus callback after the session/tenant/job scope changes", async () => {
    await render(); await size(); const oldFocus = node("input").nativeProps.onFocus; const target = node("input").nativeInstance;
    await render({ scopeKey: "replacement-session:tenant:job:epoch" });
    await act(async () => oldFocus({ currentTarget: target })); await flush(); expect(mocks.scrollTo).not.toHaveBeenCalled();
    await focus(); await flush(); expect(mocks.scrollTo).toHaveBeenCalledTimes(1);
  });
  it("removes keyboard/AppState listeners and rejects retained handlers on unmount", async () => {
    await render(); await size(); const retained = node("input").nativeProps.onFocus; const target = node("input").nativeInstance;
    await act(async () => root.unmount()); expect([...mocks.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    await act(async () => retained({ currentTarget: target })); await flush(); expect(mocks.scrollTo).not.toHaveBeenCalled();
  });
  it("respects natural finger scrolling and preserves the user's offset on keyboard dismissal", async () => {
    await render(); await size(); await focus(); await act(async () => node("body").nativeProps.onScrollBeginDrag({}));
    mocks.offset = 70; await act(async () => node("body").nativeProps.onScroll({ nativeEvent: { contentOffset: { y: 70 } } }));
    await event("keyboardDidShow"); await flush(); expect(mocks.scrollTo).not.toHaveBeenCalled();
    await event("keyboardDidHide"); expect(mocks.offset).toBe(70);
    await focus(); await flush(); expect(mocks.scrollTo).toHaveBeenLastCalledWith({ y: 106, animated: false });
  });
  it("supports React Native numeric focus targets via the real current-input API", async () => {
    await render(); await size(); await focus(false); await flush(); expect(mocks.scrollTo).toHaveBeenCalledTimes(1);
  });
  it("does not scroll on web or for an inactive boundary", async () => {
    mocks.platform = "web"; await render(); await size(); await focus(); await flush(); expect(mocks.scrollTo).not.toHaveBeenCalled();
    mocks.platform = "ios"; await render({ active: false }); await focus(); await flush(); expect(mocks.scrollTo).not.toHaveBeenCalled(); expect(node("boundary").nativeProps.enabled).toBe(false);
  });
  it("ignores invalid/zero geometry and moves upward only as far as needed", () => {
    const input = { y: 55, height: 44 }; const viewport = { y: 100, height: 280 };
    expect(companyJobFocusScrollOffset({ input, viewport, offset: 100, contentHeight: 1100 })).toBe(43);
    expect(companyJobFocusScrollOffset({ input, viewport: { y: 100, height: 0 }, offset: 100, contentHeight: 1100 })).toBeNull();
    expect(companyJobFocusScrollOffset({ input: { y: NaN, height: 44 }, viewport, offset: 100, contentHeight: 1100 })).toBeNull();
  });
});
