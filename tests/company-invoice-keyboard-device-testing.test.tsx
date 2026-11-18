import React, { act } from "react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrollView, TextInput, View, Text, TouchableOpacity, Switch } from "react-native";
import { CompanyJobKeyboardBoundary } from "../components/company-job-keyboard-boundary";
import { CompanyJobInvoiceRecipient } from "../components/company-job-invoice-recipient";
import { useCompanyJobKeyboard, type CompanyJobKeyboardTarget } from "../lib/company-job-keyboard";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";

const mocks = vi.hoisted(() => ({
  platform: "ios", state: "active", viewportHeight: 280, inputY: 430, focused: null as unknown,
  invoiceOffset: 0, detailOffset: 0, deferred: false, measurements: [] as (() => void)[], scrollTo: vi.fn(),
  listeners: new Map<string, Set<(value: unknown) => void>>(),
}));
type HostProps = Record<string, any>;
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: HostProps) => {
    const instance = R.useMemo(() => {
      const isDetail = props.testID === "detail-body" || props.testID === "detail-input";
      const native = {
        measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => {
          const measure = () => callback(0, name === "native-scroll" ? 100 : mocks.inputY - (isDetail ? mocks.detailOffset : mocks.invoiceOffset),
            320, name === "native-scroll" ? mocks.viewportHeight : 44);
          if (mocks.deferred) mocks.measurements.push(measure); else measure();
        },
        getNativeScrollRef: (): CompanyJobKeyboardTarget => native,
        scrollTo: (options: { y: number; animated: boolean }) => {
          if (isDetail) mocks.detailOffset = options.y; else mocks.invoiceOffset = options.y;
          mocks.scrollTo(native, options);
        },
      };
      return native;
    }, []);
    R.useImperativeHandle(props.ref, () => instance, [instance]);
    return R.createElement(name, { ref: (node: PhotoTestNode | null) => {
      if (node) { (node as NativeNode).nativeProps = props; (node as NativeNode).nativeInstance = instance; }
    } }, props.children);
  };
  const subscribe = (event: string, listener: (value: unknown) => void) => {
    const listeners = mocks.listeners.get(event) ?? new Set(); listeners.add(listener); mocks.listeners.set(event, listeners);
    return { remove: () => listeners.delete(listener) };
  };
  return {
    View: host("native-view"), Text: host("native-text"), ScrollView: host("native-scroll"),
    TextInput: Object.assign(host("native-input"), { State: { currentlyFocusedInput: () => mocks.focused } }),
    TouchableOpacity: host("native-button"), Switch: host("native-switch"), KeyboardAvoidingView: host("native-keyboard"),
    StyleSheet: { create: (styles: unknown) => styles }, Platform: { get OS() { return mocks.platform; } },
    Keyboard: { addListener: subscribe }, AppState: { get currentState() { return mocks.state; }, addEventListener: subscribe },
  };
});
vi.mock("@/hooks/use-job-sheet-colors", () => ({ useJobSheetColors: () => ({
  surface: "#fff", foreground: "#111", muted: "#777", border: "#ddd", warning: "#a70", error: "#a00",
}) }));

const file = new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url);
const source = readFileSync(file, "utf8");
const tree = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = [];
function visit(node: ts.Node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(tree);
function declaration(binding: string) {
  const found = nodes.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some(
    (value) => value.name.getText(tree).includes(binding)));
  if (!found) throw new Error(`Missing installed ${binding}`);
  return found.getText(tree);
}
const detailHook = declaration("detailScrollRef");
const invoiceHook = declaration("invoiceScrollRef");
const invoiceGuard = declaration("isCurrentInvoice");
const invoiceBoundary = nodes.find((node) => ts.isJsxElement(node)
  && node.openingElement.tagName.getText(tree) === "CompanyJobKeyboardBoundary"
  && node.getText(tree).includes("CompanyJobInvoiceRecipient"));
if (!invoiceBoundary) throw new Error("Invoice must own its keyboard boundary");
const overlay = invoiceBoundary.getText(tree);

/** Execute the installed hooks, captured guard and entire invoice JSX, not a reimplementation.
 * Native hosts/geometry and unrelated screen values are synthetic; this is NOT a device run.
 * Invoice send/recover callbacks are never invoked and live transport is prohibited.
 */
const contextNames = [
  "companyJobMode", "selectedJob", "showInvoiceSheet", "isCurrentCompanyJobOperation", "renderedLegacyAction",
  "companyJobOperationScope", "managementActionKey", "managementActionRef", "invoiceSessionRef", "invoiceIdentityKey",
  "invoiceKeyboardGeneration", "invoiceGeneration", "sheetEpochRef", "renderedSheetEpoch", "invoiceEpochRef", "renderedInvoiceEpoch",
  "invoiceLifecycleEpoch", "renderedInvoiceLifecycleEpoch", "jobSheetColors", "invoiceSentUrl", "companyInvoiceStatus",
  "companyInvoiceAcknowledgedRecipient", "setShowInvoiceSheet", "companyBilling", "localDateStr", "getWeekDates",
  "invoiceSending", "invoiceMethod", "invoiceLockRef", "setInvoiceMethod", "invoiceResend", "setInvoiceResend",
  "companyInvoiceRecipientEmail", "setCompanyInvoiceRecipientEmail", "companyJob", "companyInvoiceOperation", "jobSyncLoading",
  "companyInvoiceOperationReleaseReady", "COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY", "invoiceOverrideContact", "setInvoiceOverrideContact",
  "invoiceRemainingOnly",
];
const compiled = ts.transpileModule(`this.InstalledInvoice = function InstalledInvoice(values) {
  const { ${contextNames.join(", ")} } = values;
  ${detailHook}
  ${invoiceGuard}
  ${invoiceHook}
  return <>
    <CompanyJobKeyboardBoundary active={Boolean(selectedJob)} testID="detail-boundary">
      <ScrollView testID="detail-body" ref={detailScrollRef} {...detailScrollProps}>
        <TextInput testID="detail-input" onFocus={detailInputFocus} onBlur={detailInputBlur} />
      </ScrollView>
    </CompanyJobKeyboardBoundary>
    {showInvoiceSheet && selectedJob && (${overlay})}
  </>;
};`, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = vm.createContext({ React, CompanyJobKeyboardBoundary, CompanyJobInvoiceRecipient, useCompanyJobKeyboard,
  ScrollView, TextInput, View, Text, TouchableOpacity, Switch,
  AppState: { get currentState() { return mocks.state; } },
});
vm.runInContext(compiled, sandbox);
const InstalledInvoice = sandbox.InstalledInvoice as React.ComponentType<HostProps>;
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (node: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
type NativeNode = PhotoTestNode & { nativeProps: HostProps; nativeInstance: CompanyJobKeyboardTarget };
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let values: HostProps;
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function find(predicate: (node: NativeNode) => boolean) {
  const result = all().find(predicate); if (!result) throw new Error("Missing native host"); return result;
}
function byID(id: string) { return find((node) => node.nativeProps?.testID === id); }
function invoiceBody() { return find((node) => node.nodeName === "NATIVE-SCROLL" && node.nativeProps?.testID !== "detail-body"); }
function invoiceInput() { return find((node) => node.nativeProps?.accessibilityLabel === "Invoice recipient email (optional)"); }
function boundary() { return find((node) => node.nodeName === "NATIVE-KEYBOARD" && node.nativeProps?.testID !== "detail-boundary"); }
async function render(patch: HostProps = {}) {
  values = { ...values, ...patch };
  await act(async () => root.render(<InstalledInvoice {...values} />));
}
async function size(height = 1100) { await act(async () => invoiceBody().nativeProps.onContentSizeChange(320, height)); }
async function focus(node = invoiceInput()) {
  mocks.focused = node.nativeInstance;
  await act(async () => node.nativeProps.onFocus({ currentTarget: mocks.focused }));
}
async function event(name: string, value: unknown = {}) {
  await act(async () => mocks.listeners.get(name)?.forEach((listener) => listener(value)));
}
async function flush() { await act(async () => vi.advanceTimersByTime(300)); }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.platform = "ios"; mocks.state = "active";
  mocks.viewportHeight = 280; mocks.inputY = 430; mocks.focused = null; mocks.deferred = false; mocks.measurements = []; mocks.listeners.clear();
  mocks.invoiceOffset = 0; mocks.detailOffset = 0;
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  const identity = "synthetic-company:token:actor:job:focused";
  values = {
    companyJobMode: true, selectedJob: { id: "12", companyId: 9, weekOffset: 0, dayIndex: 0 }, showInvoiceSheet: true,
    isCurrentCompanyJobOperation: () => true, renderedLegacyAction: () => true,
    companyJobOperationScope: identity, managementActionKey: "legacy", managementActionRef: { current: { mounted: true, focused: true } },
    invoiceSessionRef: { current: { key: identity, generation: 0 } }, invoiceIdentityKey: identity, invoiceKeyboardGeneration: 0, invoiceGeneration: 0,
    sheetEpochRef: { current: 1 }, renderedSheetEpoch: 1, invoiceEpochRef: { current: 1 }, renderedInvoiceEpoch: 1,
    invoiceLifecycleEpoch: { getSnapshot: () => 1 }, renderedInvoiceLifecycleEpoch: 1,
    jobSheetColors: { surface: "#fff", foreground: "#111", muted: "#777", border: "#ddd", primary: "#07a", background: "#eee" },
    invoiceSentUrl: null, companyInvoiceStatus: null, companyInvoiceAcknowledgedRecipient: null,
    setShowInvoiceSheet: vi.fn(), companyBilling: { isPaid: false, balance: null, paymentStatus: null },
    localDateStr: () => "synthetic-date", getWeekDates: () => [new Date(0)], invoiceSending: false, invoiceMethod: "email",
    invoiceLockRef: { current: false }, setInvoiceMethod: vi.fn(), invoiceResend: false, setInvoiceResend: vi.fn(),
    companyInvoiceRecipientEmail: "draft@example.test", setCompanyInvoiceRecipientEmail: vi.fn(),
    companyJob: { detail: { customerEmail: "on-file@example.test" } },
    companyInvoiceOperation: { busy: false, result: null, error: null, send: vi.fn(), recover: vi.fn() }, jobSyncLoading: false,
    companyInvoiceOperationReleaseReady: () => false, COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY: { reason: "Sending remains unavailable" },
    invoiceOverrideContact: "", setInvoiceOverrideContact: vi.fn(), invoiceRemainingOnly: false,
  };
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No live transport permitted"); }));
});
afterEach(async () => {
  await act(async () => root.unmount()); expect(fetch).not.toHaveBeenCalled();
  expect(values.companyInvoiceOperation.send).not.toHaveBeenCalled(); expect(values.companyInvoiceOperation.recover).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("Installed manager invoice keyboard — source and mocked host regression, not device acceptance", () => {
  it("keeps the invoice boundary outside the underlying detail boundary and uses only its own handlers", () => {
    expect(invoiceBoundary!.parent.parent.getText(tree).startsWith("showInvoiceSheet && selectedJob")).toBe(true);
    let ancestor = invoiceBoundary!.parent;
    while (ancestor.parent) {
      if (ts.isJsxElement(ancestor)) expect(ancestor.openingElement.tagName.getText(tree)).not.toBe("CompanyJobKeyboardBoundary");
      ancestor = ancestor.parent;
    }
    expect(detailHook).toContain("Boolean(selectedJob) && !showInvoiceSheet");
    expect(invoiceHook).toContain("active: companyJobMode && Boolean(selectedJob) && showInvoiceSheet, isCurrent: isCurrentInvoice");
    expect(invoiceHook).toContain("[invoiceIdentityKey, invoiceKeyboardGeneration, companyJobOperationScope, renderedInvoiceLifecycleEpoch]");
    expect(overlay).toContain("onInputFocus={invoiceInputFocus} onInputBlur={invoiceInputBlur}");
    expect(overlay).not.toContain("detailInputFocus"); expect(overlay).not.toContain("detailInputBlur");
    expect(overlay).toContain("isCurrent={() => !invoiceLockRef.current && !companyInvoiceOperation.busy && isCurrentInvoice()}");
    expect(overlay).toContain("companyInvoiceOperationReleaseReady() ? null : COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.reason");
  });
  it.each(["ios", "android"])("preserves the design and gives the invoice a shrinking viewport without a second IME inset (%s)", async (platform) => {
    mocks.platform = platform; await render();
    expect(boundary().nativeProps).toMatchObject({ enabled: platform === "ios", behavior: platform === "ios" ? "padding" : undefined,
      style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" } });
    expect(invoiceBody().parentNode).toBe(boundary().childNodes[0]);
    expect((invoiceBody().parentNode as NativeNode).nativeProps.style).toMatchObject({ backgroundColor: "#fff", borderTopLeftRadius: 20,
      borderTopRightRadius: 20, maxHeight: "100%", flexShrink: 1, overflow: "hidden" });
    expect(invoiceBody().nativeProps).toMatchObject({ style: { flexShrink: 1 }, contentContainerStyle: { padding: 24, paddingBottom: 40 },
      automaticallyAdjustKeyboardInsets: false, keyboardShouldPersistTaps: "handled", keyboardDismissMode: "on-drag", scrollEventThrottle: 16 });
    expect(invoiceBody().nativeProps).not.toHaveProperty("contentInset"); expect(boundary().nativeProps).not.toHaveProperty("contentContainerStyle");
    expect(boundary().parentNode).toBe(byID("detail-boundary").parentNode);
  });
  it.each(["ios", "android"])("corrects only invoice scroll after measured native resize (%s)", async (platform) => {
    mocks.platform = platform; mocks.viewportHeight = 600; await render(); await size(); await focus(); await flush();
    expect(mocks.scrollTo).not.toHaveBeenCalled(); mocks.viewportHeight = 220;
    await act(async () => invoiceBody().nativeProps.onLayout({})); await flush();
    expect(mocks.scrollTo).toHaveBeenCalledWith(invoiceBody().nativeInstance, { y: 166, animated: false });
    expect(mocks.scrollTo.mock.calls.every(([target]) => target !== byID("detail-body").nativeInstance)).toBe(true);
    await event("keyboardDidShow", { endCoordinates: { height: 999 } }); await flush(); expect(mocks.scrollTo).toHaveBeenCalledOnce();
  });
  it("cancels a pending underlying detail correction when the invoice opens", async () => {
    await render({ showInvoiceSheet: false }); await act(async () => byID("detail-body").nativeProps.onContentSizeChange(320, 1100));
    mocks.deferred = true; await focus(byID("detail-input")); await flush(); expect(mocks.measurements.length).toBeGreaterThan(0);
    await render({ showInvoiceSheet: true }); await act(async () => mocks.measurements.splice(0).forEach((measure) => measure()));
    await focus(byID("detail-input")); await event("keyboardDidShow"); await flush(); expect(mocks.scrollTo).not.toHaveBeenCalled();
  });
  it.each(["signed-identity", "generation", "detail-epoch", "invoice-epoch", "lifecycle", "unfocused", "background", "close", "blur", "unmount"])(
    "drops deferred invoice measurements after %s invalidates the captured scope", async (change) => {
      await render(); await size(); mocks.deferred = true; await focus(); await flush(); expect(mocks.measurements.length).toBeGreaterThan(0);
      if (change === "signed-identity") values.invoiceSessionRef.current.key = "replacement-token:company:actor:job";
      else if (change === "generation") values.invoiceSessionRef.current.generation++;
      else if (change === "detail-epoch") values.sheetEpochRef.current++;
      else if (change === "invoice-epoch") values.invoiceEpochRef.current++;
      else if (change === "lifecycle") values.invoiceLifecycleEpoch.getSnapshot = () => 2;
      else if (change === "unfocused") values.managementActionRef.current.focused = false;
      else if (change === "background") { mocks.state = "background"; await event("change", "background"); }
      else if (change === "close") await render({ showInvoiceSheet: false });
      else if (change === "blur") await act(async () => invoiceInput().nativeProps.onBlur({}));
      else await act(async () => root.unmount());
      await act(async () => mocks.measurements.splice(0).forEach((measure) => measure())); expect(mocks.scrollTo).not.toHaveBeenCalled();
    });
  it("resets invoice extent on same-Job close/reopen and rejects retained old focus", async () => {
    await render(); await size(); const retained = invoiceInput().nativeProps.onFocus; const target = invoiceInput().nativeInstance;
    await render({ showInvoiceSheet: false }); values.invoiceEpochRef.current = 3;
    await render({ showInvoiceSheet: true, renderedInvoiceEpoch: 3, invoiceKeyboardGeneration: 2 });
    await act(async () => retained({ currentTarget: target })); await flush(); expect(mocks.scrollTo).not.toHaveBeenCalled();
    await focus(); await flush(); expect(mocks.scrollTo).not.toHaveBeenCalled();
    await size(); await flush(); expect(mocks.scrollTo).toHaveBeenCalledWith(invoiceBody().nativeInstance, { y: 106, animated: false });
  });
  it("bounds correction and lets finger drag suspend automatic reveal while keeping taps handled", async () => {
    await render(); await size(330); await focus(); await flush();
    expect(mocks.scrollTo).toHaveBeenCalledWith(invoiceBody().nativeInstance, { y: 50, animated: false });
    await act(async () => invoiceBody().nativeProps.onScrollBeginDrag({})); await size(); await event("keyboardDidShow"); await flush();
    expect(mocks.scrollTo).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    const reset = find((node) => node.nativeProps?.accessibilityLabel === "Use customer email on file");
    await act(async () => reset.nativeProps.onPress()); expect(values.setCompanyInvoiceRecipientEmail).toHaveBeenCalledWith("");
  });
  it.each(["locked", "busy", "loading", "stale"])("preserves the recipient capture guard with %s", async (change) => {
    await render(); const retained = invoiceInput().nativeProps;
    if (change === "locked") values.invoiceLockRef.current = true;
    else if (change === "busy") await render({ companyInvoiceOperation: { ...values.companyInvoiceOperation, busy: true } });
    else if (change === "loading") await render({ jobSyncLoading: true });
    else values.invoiceEpochRef.current++;
    await act(async () => { retained.onFocus({ currentTarget: invoiceInput().nativeInstance }); retained.onChangeText("late@example.test"); });
    await flush(); expect(mocks.scrollTo).not.toHaveBeenCalled(); expect(values.setCompanyInvoiceRecipientEmail).not.toHaveBeenCalled();
  });
  it("preserves Company SMS on-file-only behavior and existing method/close controls without sending", async () => {
    await render(); const picker = all().filter((node) => node.nodeName === "NATIVE-BUTTON" && Array.isArray(node.nativeProps?.style));
    await act(async () => picker[1].nativeProps.onPress()); expect(values.setInvoiceMethod).toHaveBeenCalledWith("sms");
    await render({ invoiceMethod: "sms" }); expect(all().filter((node) => node.nodeName === "NATIVE-INPUT")).toHaveLength(1); // Detail fixture only.
    expect(all().some((node) => node.textContent.includes("Text invoices use the customer phone on file"))).toBe(true);
    expect(all().some((node) => node.textContent.includes("Phone overrides are unavailable"))).toBe(true);
    const close = all().find((node) => node.nodeName === "NATIVE-BUTTON" && node.textContent === "✕")!;
    await act(async () => close.nativeProps.onPress()); expect(values.setShowInvoiceSheet).toHaveBeenCalledWith(false);
  });
  it("activates correction only for visible Company invoice sheets", async () => {
    mocks.platform = "web"; await render(); await size(); await focus(); await flush(); expect(mocks.scrollTo).not.toHaveBeenCalled();
    mocks.platform = "ios"; await render({ companyJobMode: false });
    expect(boundary().nativeProps.enabled).toBe(false); await size();
    const legacy = all().find((node) => node.nodeName === "NATIVE-INPUT" && node.nativeProps?.testID !== "detail-input")!;
    expect(legacy.nativeProps).not.toHaveProperty("onFocus"); await event("keyboardDidShow"); await flush(); expect(mocks.scrollTo).not.toHaveBeenCalled();
  });
});
