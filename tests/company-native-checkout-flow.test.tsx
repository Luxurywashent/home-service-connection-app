import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyNativeCheckoutFlow, type CompanyNativeCheckoutFlowProps, type CompanyNativeCheckoutViewModel } from "../components/company-native-checkout-flow";
import { CompanyCheckoutSignature, type CompanyCheckoutSignatureRef } from "../components/company-checkout-signature.native";

const mocks = vi.hoisted(() => ({ read: vi.fn(), clear: vi.fn(), canvasProps: null as any }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 28, left: 0, right: 0 }) }));
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => function Host(props: any) {
    return R.createElement(name, { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; } }, props.children);
  };
  return {
    View: host("native-view"), Text: host("native-text"), TouchableOpacity: host("native-touch"),
    TextInput: host("native-input"), Modal: host("native-modal"), ScrollView: host("native-scroll"),
    KeyboardAvoidingView: host("native-keyboard"), ActivityIndicator: host("native-spinner"),
    StyleSheet: { create: (styles: unknown) => styles }, Platform: { OS: "ios" },
  };
});
vi.mock("react-native-signature-canvas", async () => {
  const R = await import("react");
  return { default: R.forwardRef(function MockCanvas(props: any, ref: any) {
    mocks.canvasProps = props;
    R.useImperativeHandle(ref, () => ({ readSignature: mocks.read, clearSignature: mocks.clear }));
    return R.createElement("mock-signature-canvas");
  }) };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
type NativeNode = PhotoTestNode & { nativeProps: any };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVQImWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==";
const quote = { key: "quote-fixture-1", serviceAmountText: "$250.00", tipAmountText: "$45.00", totalAmountText: "$295.00" };
const view = (patch: Partial<CompanyNativeCheckoutViewModel> = {}): CompanyNativeCheckoutViewModel => ({
  step: "method", status: "ready", customerName: "Fictional Customer", serviceName: "Lawn Service",
  balanceLabel: "Balance Due", balanceAmountText: "$250.00", manualCardAvailable: true,
  canContinueCard: true, tipSelection: 18, customTipText: "", tipOptionAmountText: { 18: "$45.00" },
  quote, canContinueTip: true, canConfirmPayment: true, signature: null, ...patch,
});
let props: CompanyNativeCheckoutFlowProps;
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let unmounted = false;
const all = (node: PhotoTestNode = container): NativeNode[] => [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))];
const nodes = (name: string) => all().filter((node) => node.nodeName.toLowerCase() === name);
function button(label: string): NativeNode {
  const found = nodes("native-touch").find((node) => node.nativeProps.accessibilityLabel === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function render(state = props.state) { props = { ...props, state }; await act(async () => root.render(<CompanyNativeCheckoutFlow {...props} />)); }
async function press(node: NativeNode) { await act(async () => node.nativeProps.onPress?.()); }
async function stroke() {
  const canvas = mocks.canvasProps;
  await act(async () => canvas.onBegin());
  await act(async () => canvas.onEnd());
  await act(async () => canvas.onOK(PNG));
}
async function acceptDraft() {
  const draft = (props.onSignatureChange as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
  await render({ ...props.state, signature: draft });
  return draft;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useRealTimers(); mocks.canvasProps = null;
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container); unmounted = false;
  props = {
    visible: true, epochKey: "fixture-epoch-1", state: view(), isCurrent: () => true,
    renderCardField: vi.fn((slot) => <div data-secure-slot={slot.visible ? "visible" : "hidden"}>Secure native field fixture</div>),
    onManualCardEntry: vi.fn(), onCardContinue: vi.fn(), onTipSelect: vi.fn(), onCustomTipChange: vi.fn(),
    onTipContinue: vi.fn(), onSignatureChange: vi.fn(), onConfirmPayment: vi.fn(), onBack: vi.fn(), onClose: vi.fn(), onRefreshStatus: vi.fn(),
  };
});
afterEach(async () => { if (!unmounted) await act(async () => root.unmount()); vi.useRealTimers(); });

describe("controlled checkout bottom sheet, actual React DOM lifecycle", () => {
  it("renders the approved bottom hierarchy, safe area, permanent unavailable tap method and accessible manual action", async () => {
    await render();
    expect(container.textContent).toContain("Fictional Customer · Lawn Service");
    expect(container.textContent).toContain("Balance Due");
    expect(container.textContent).not.toContain("Apple entitlements are not configured or verified");
    const tap = button("Tap to Pay on iPhone unavailable"); expect(tap.nativeProps.disabled).toBe(true);
    expect(tap.textContent).toBe("▣Tap to Pay on iPhone");
    expect(tap.nativeProps.accessibilityState.disabled).toBe(true);
    await press(tap); expect(props.onManualCardEntry).not.toHaveBeenCalled();
    const backdrop = nodes("native-keyboard")[0].nativeProps.style;
    expect(backdrop.justifyContent).toBe("flex-end");
    const sheet = nodes("native-view").find((node) => node.nativeProps.accessibilityViewIsModal)!;
    expect(sheet.nativeProps.style[1].paddingBottom).toBe(28);
    expect(nodes("native-scroll")[0].nativeProps.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(button("Manual Card Entry").nativeProps.accessibilityState.disabled).toBe(false);
    await press(button("Manual Card Entry")); expect(props.onManualCardEntry).toHaveBeenCalledTimes(1);
    expect(props.onConfirmPayment).not.toHaveBeenCalled(); expect(nodes("native-input")).toHaveLength(0);
  });
  it("keeps method review usable with truthful unavailable manual entry", async () => {
    await render(view({ manualCardAvailable: false, manualCardUnavailableReason: "Company payment configuration is unavailable." }));
    expect(button("Manual Card Entry").nativeProps.disabled).toBe(true);
    await press(button("Manual Card Entry")); expect(props.onManualCardEntry).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Company payment configuration is unavailable.");
    await press(button("Refresh status")); await press(button("Close checkout"));
    expect(props.onRefreshStatus).toHaveBeenCalledTimes(1); expect(props.onClose).toHaveBeenCalledTimes(1);
  });
  it("renders only an injectable secure field, never PAN/CVC inputs; card continuation does not confirm", async () => {
    await render(view({ step: "card" }));
    expect(container.textContent).toContain("Credit or Debit Card"); expect(container.textContent).toContain("Card Details");
    expect(nodes("native-input")).toHaveLength(0);
    await press(button("Continue to Tip →")); expect(props.onCardContinue).toHaveBeenCalledTimes(1);
    expect(props.onConfirmPayment).not.toHaveBeenCalled();
    await render({ ...props.state, canContinueCard: false });
    await press(button("Continue to Tip →")); expect(props.onCardContinue).toHaveBeenCalledTimes(1);
  });
  it("keeps the secure field host mounted but hidden/inaccessible across card, tip and signature", async () => {
    await render(view({ step: "card" })); const field = nodes("div")[0];
    await render({ ...props.state, step: "tip" }); expect(nodes("div")[0]).toBe(field);
    const hidden = field.parentNode as NativeNode; expect(hidden.nativeProps.style.display).toBe("none");
    expect(hidden.nativeProps.pointerEvents).toBe("none"); expect(hidden.nativeProps.importantForAccessibility).toBe("no-hide-descendants");
    await render({ ...props.state, step: "signature" }); expect(nodes("div")[0]).toBe(field);
  });
  it("fails closed without a real secure card bridge", async () => {
    props.renderCardField = undefined; await render(); expect(button("Manual Card Entry").nativeProps.disabled).toBe(true);
    await render({ ...props.state, step: "card" }); expect(button("Continue to Tip →").nativeProps.disabled).toBe(true);
    await press(button("Continue to Tip →")); expect(props.onCardContinue).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No card details can be entered here");
  });
  it("uses server totals and exposes 15/18/20/25/no/custom tips, with decimal input only for custom tip", async () => {
    await render(view({ step: "tip", quote: { ...quote, totalAmountText: "$299.37" } }));
    expect(container.textContent).toContain("$299.37"); expect(container.textContent).not.toContain("$295.00");
    for (const percent of [15, 18, 20, 25]) await press(button(`${percent}% tip`));
    await press(button("No Tip")); await press(button("Custom tip"));
    expect((props.onTipSelect as any).mock.calls.map((call: any[]) => call[0])).toEqual([15, 18, 20, 25, "none", "custom"]);
    await render({ ...props.state, tipSelection: "custom" }); const input = nodes("native-input")[0];
    expect(input.nativeProps.keyboardType).toBe("decimal-pad"); expect(input.nativeProps.accessibilityLabel).toBe("Custom tip amount");
    await act(async () => input.nativeProps.onChangeText("12.34")); expect(props.onCustomTipChange).toHaveBeenCalledWith("12.34");
    await press(button("Continue to Signature →")); expect(props.onTipContinue).toHaveBeenCalledTimes(1);
    expect(props.onConfirmPayment).not.toHaveBeenCalled();
    await render({ ...props.state, quote: null }); await press(button("Continue to Signature →")); expect(props.onTipContinue).toHaveBeenCalledTimes(1);
  });
  it("requires a new local PNG signature, then invokes the final action once only", async () => {
    await render(view({ step: "signature" }));
    expect(container.textContent).toContain("Total to Charge"); expect(container.textContent).not.toContain("Total Charged");
    const confirm = button("Confirm Payment · $295.00"); expect(confirm.nativeProps.disabled).toBe(true);
    await press(confirm); expect(props.onConfirmPayment).not.toHaveBeenCalled();
    await stroke(); const draft = await acceptDraft(); const enabled = button("Confirm Payment · $295.00");
    expect(enabled.nativeProps.disabled).toBe(false);
    await act(async () => { enabled.nativeProps.onPress(); enabled.nativeProps.onPress(); });
    expect(props.onConfirmPayment).toHaveBeenCalledTimes(1); expect(props.onConfirmPayment).toHaveBeenCalledWith(draft);
  });
  it("clear invalidates controlled evidence synchronously and rejects retained confirm and old pad replies", async () => {
    await render(view({ step: "signature" })); await stroke(); await acceptDraft();
    const confirm = button("Confirm Payment · $295.00"); const oldPad = mocks.canvasProps;
    await press(button("Clear")); await press(confirm);
    await act(async () => oldPad.onOK(PNG));
    expect(props.onConfirmPayment).not.toHaveBeenCalled(); expect((props.onSignatureChange as any).mock.calls.at(-1)[0]).toBeNull();
    expect(button("Confirm Payment · $295.00").nativeProps.disabled).toBe(true);
  });
  it.each(["key", "total", "service", "tip"])("changed quote %s invalidates signature, including when old controlled evidence remains", async (part) => {
    await render(view({ step: "signature" })); await stroke(); await acceptDraft(); const retained = button("Confirm Payment · $295.00");
    const next = { ...quote }; if (part === "key") next.key = "fixture-new"; if (part === "total") next.totalAmountText = "$300.00"; if (part === "service") next.serviceAmountText = "$255.00"; if (part === "tip") next.tipAmountText = "$50.00";
    await render({ ...props.state, quote: next }); await press(retained);
    expect(props.onConfirmPayment).not.toHaveBeenCalled(); expect((props.onSignatureChange as any).mock.calls.at(-1)[0]).toBeNull();
    expect(button(`Confirm Payment · ${next.totalAmountText}`).nativeProps.disabled).toBe(true);
  });
  it.each(["loading", "processing", "unknown", "blocked", "paid", "error"] as const)("%s status leaves truthful refresh and close, denying retained payment events", async (status) => {
    await render(view({ step: "signature" })); await stroke(); await acceptDraft(); const retained = button("Confirm Payment · $295.00");
    await render({ ...props.state, status }); await press(retained); await press(button("Confirm Payment · $295.00"));
    expect(props.onConfirmPayment).not.toHaveBeenCalled(); expect(nodes("mock-signature-canvas")).toHaveLength(0);
    await press(button("Refresh status")); expect(props.onRefreshStatus).toHaveBeenCalledTimes(1);
    await press(button("Close checkout")); expect(props.onClose).toHaveBeenCalledTimes(1);
  });
  it("close permanently denies retained card, refresh, close and signature events until a new epoch", async () => {
    await render(view({ step: "card" })); const oldContinue = button("Continue to Tip →"); const oldRefresh = button("Refresh status"); const oldClose = button("Close checkout");
    await press(oldClose); await press(oldContinue); await press(oldRefresh); await press(oldClose);
    expect(props.onCardContinue).not.toHaveBeenCalled(); expect(props.onRefreshStatus).not.toHaveBeenCalled(); expect(props.onClose).toHaveBeenCalledTimes(1);
    props = { ...props, epochKey: "fixture-epoch-2" }; await render(); await press(oldContinue); expect(props.onCardContinue).not.toHaveBeenCalled();
    await press(button("Continue to Tip →")); expect(props.onCardContinue).toHaveBeenCalledTimes(1);
  });
  it("guards current scope and unmount rather than trusting disabled attributes", async () => {
    await render(view({ step: "card" })); const retained = button("Continue to Tip →");
    props = { ...props, isCurrent: () => false }; await render(); await press(retained); await press(button("Close checkout"));
    expect(props.onCardContinue).not.toHaveBeenCalled(); expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => root.unmount()); unmounted = true; await press(retained); expect(props.onCardContinue).not.toHaveBeenCalled();
  });
});

describe("native signature asynchronous read and local WebView restrictions", () => {
  it("read returns a Promise resolved only from onOK, never from the void readSignature return", async () => {
    const ref = React.createRef<CompanyCheckoutSignatureRef>(); const onChange = vi.fn();
    await act(async () => root.render(<CompanyCheckoutSignature ref={ref} disabled={false} isCurrent={() => true} onChange={onChange} />));
    await expect(ref.current!.read()).rejects.toThrow("empty");
    await act(async () => mocks.canvasProps.onBegin()); await act(async () => mocks.canvasProps.onEnd());
    const pending = ref.current!.read(); let resolved = false; void pending.then(() => { resolved = true; });
    expect(mocks.read).toHaveBeenCalledTimes(1); expect(resolved).toBe(false);
    await act(async () => mocks.canvasProps.onOK(PNG)); await expect(pending).resolves.toBe(PNG); expect(onChange).toHaveBeenLastCalledWith(PNG);
  });
  it("clear rejects pending read and ignores old callback after remount", async () => {
    const ref = React.createRef<CompanyCheckoutSignatureRef>(); const onChange = vi.fn();
    await act(async () => root.render(<CompanyCheckoutSignature ref={ref} disabled={false} isCurrent={() => true} onChange={onChange} />));
    await act(async () => mocks.canvasProps.onBegin()); await act(async () => mocks.canvasProps.onEnd()); const old = mocks.canvasProps;
    const pending = ref.current!.read(); const rejected = expect(pending).rejects.toThrow("no longer current");
    await act(async () => ref.current!.clear()); await rejected; await act(async () => old.onOK(PNG));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
  it("blocks navigation, files, network, cookie/storage/media permissions and uses no remote assets", async () => {
    await render(view({ step: "signature" })); const canvas = mocks.canvasProps; const security = canvas.webviewProps;
    expect(security.onShouldStartLoadWithRequest({ url: "about:blank" })).toBe(true);
    for (const url of ["https://fixture.invalid", "file:///private/file", "data:text/html,fixture", "intent://fixture"]) expect(security.onShouldStartLoadWithRequest({ url })).toBe(false);
    expect(security).toMatchObject({ allowFileAccess: false, allowFileAccessFromFileURLs: false, allowUniversalAccessFromFileURLs: false, mediaCapturePermissionGrantType: "deny", domStorageEnabled: false, cacheEnabled: false, incognito: true, thirdPartyCookiesEnabled: false, sharedCookiesEnabled: false });
    const html = canvas.customHtml("/* bundled script fixture */"); expect(html).toContain("connect-src 'none'"); expect(html).toContain("img-src 'none'"); expect(html).not.toContain("https:"); expect(html).not.toContain("<img");
    expect(canvas.backgroundColor).toBe("#ffffff"); expect(canvas.imageType).toBe("image/png");
  });
  it("rejects empty, malformed and non-PNG evidence without approval", async () => {
    await render(view({ step: "signature" })); await act(async () => mocks.canvasProps.onBegin()); await act(async () => mocks.canvasProps.onEnd());
    await act(async () => mocks.canvasProps.onEmpty()); expect((props.onSignatureChange as any).mock.calls.at(-1)[0]).toBeNull();
    for (const png of ["data:image/jpeg;base64,AAAA", "data:image/png;base64,not-png", "https://fixture.invalid/signature.png"]) {
      await act(async () => mocks.canvasProps.onBegin()); await act(async () => mocks.canvasProps.onEnd()); await act(async () => mocks.canvasProps.onOK(png));
    }
    expect(props.onConfirmPayment).not.toHaveBeenCalled(); expect((props.onSignatureChange as any).mock.calls.every((call: any[]) => call[0] === null)).toBe(true);
  });
});

describe("retained-event and drawing invalidation regressions", () => {
  it("a new stroke denies a retained enabled confirm until new PNG evidence is accepted", async () => {
    await render(view({ step: "signature" })); await stroke(); await acceptDraft();
    const retained = button("Confirm Payment · $295.00");
    await act(async () => mocks.canvasProps.onBegin()); await press(retained);
    expect(props.onConfirmPayment).not.toHaveBeenCalled();
    expect(nodes("native-scroll")[0].nativeProps.scrollEnabled).toBe(false);
    await act(async () => mocks.canvasProps.onEnd()); expect(nodes("native-scroll")[0].nativeProps.scrollEnabled).toBe(true);
  });
  it("close rejects a late read and old confirm without resurrecting local evidence", async () => {
    await render(view({ step: "signature" }));
    await act(async () => mocks.canvasProps.onBegin()); await act(async () => mocks.canvasProps.onEnd());
    const retainedPad = mocks.canvasProps; const retained = button("Confirm Payment · $295.00");
    await press(button("Close checkout")); await act(async () => retainedPad.onOK(PNG)); await press(retained);
    expect(props.onConfirmPayment).not.toHaveBeenCalled(); expect((props.onSignatureChange as any).mock.calls.at(-1)[0]).toBeNull();
  });
  it("does not accept preloaded or substituted controlled evidence through a retained confirm", async () => {
    await render(view({ step: "signature", signature: { quoteKey: quote.key, pngDataUrl: PNG } }));
    expect(button("Confirm Payment · $295.00").nativeProps.disabled).toBe(true);
    await stroke(); await acceptDraft(); const retained = button("Confirm Payment · $295.00");
    await render({ ...props.state, signature: { quoteKey: quote.key, pngDataUrl: PNG.replace("AAAANS", "AAAANT") } });
    await press(retained); expect(props.onConfirmPayment).not.toHaveBeenCalled();
  });
  it("leaving and returning to a quote never restores a prior signature or old enabled event", async () => {
    await render(view({ step: "signature" })); await stroke(); await acceptDraft(); const old = button("Confirm Payment · $295.00");
    await render({ ...props.state, quote: { ...quote, key: "quote-other" } });
    await render({ ...props.state, quote }); await press(old);
    expect(button("Confirm Payment · $295.00").nativeProps.disabled).toBe(true); expect(props.onConfirmPayment).not.toHaveBeenCalled();
  });
  it("native read timeout fails closed, clears evidence and remounts rather than reusing old pending replies", async () => {
    vi.useFakeTimers(); await render(view({ step: "signature" }));
    await act(async () => mocks.canvasProps.onBegin()); await act(async () => mocks.canvasProps.onEnd()); const old = mocks.canvasProps;
    await act(async () => vi.advanceTimersByTime(5001));
    await act(async () => old.onOK(PNG));
    expect((props.onSignatureChange as any).mock.calls.at(-1)[0]).toBeNull(); expect(button("Confirm Payment · $295.00").nativeProps.disabled).toBe(true);
  });
});

describe("actual browser signature component with mocked canvas drawing surface", () => {
  async function mountWebPad() {
    const { CompanyCheckoutSignature: WebSignature } = await import("../components/company-checkout-signature.web");
    const document = container.ownerDocument;
    const originalCreate = document.createElement.bind(document);
    const context = { fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
    let capture: number | null = null;
    document.createElement = (name: string) => {
      const node = originalCreate(name) as any;
      if (name === "canvas") Object.assign(node, {
        getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 240 }),
        setPointerCapture: (id: number) => { capture = id; }, hasPointerCapture: (id: number) => capture === id,
        releasePointerCapture: () => { capture = null; }, toDataURL: () => PNG,
      });
      return node;
    };
    const ref = React.createRef<CompanyCheckoutSignatureRef>(); const onChange = vi.fn();
    await act(async () => root.render(<WebSignature ref={ref} disabled={false} isCurrent={() => true} onChange={onChange} />));
    const element = nodes("canvas")[0] as any;
    const key = Object.keys(element).find((key) => key.startsWith("__reactProps$"))!;
    const events = element[key];
    const pointer = (clientX: number, clientY: number) => ({ currentTarget: element, pointerId: 1, pointerType: "mouse", button: 0, clientX, clientY, preventDefault: vi.fn() });
    return { ref, onChange, events, context, pointer, element };
  }
  it("draws real pointer strokes on a WHITE local canvas and clears the PNG draft", async () => {
    const pad = await mountWebPad(); await expect(pad.ref.current!.read()).rejects.toThrow("empty");
    expect(pad.events.style.background).toBe("#ffffff"); expect(pad.events.style.touchAction).toBe("none");
    await act(async () => pad.events.onPointerDown(pad.pointer(20, 30)));
    await act(async () => pad.events.onPointerMove(pad.pointer(60, 80)));
    await act(async () => pad.events.onPointerUp(pad.pointer(60, 80)));
    expect(pad.context.stroke).toHaveBeenCalledTimes(1); expect(pad.onChange).toHaveBeenLastCalledWith(PNG);
    await expect(pad.ref.current!.read()).resolves.toBe(PNG);
    await act(async () => pad.ref.current!.clear()); expect(pad.onChange).toHaveBeenLastCalledWith(null);
    await expect(pad.ref.current!.read()).rejects.toThrow("empty");
  });
  it("clear or cancellation invalidates a pending pointer-up PNG before its microtask emits", async () => {
    const pad = await mountWebPad();
    await act(async () => {
      pad.events.onPointerDown(pad.pointer(10, 20)); pad.events.onPointerUp(pad.pointer(10, 20)); pad.ref.current!.clear();
    });
    expect(pad.onChange).toHaveBeenLastCalledWith(null); expect(pad.onChange.mock.calls.some(([value]) => value === PNG)).toBe(false);
    await act(async () => { pad.events.onPointerDown(pad.pointer(20, 40)); pad.events.onPointerCancel(); });
    await expect(pad.ref.current!.read()).rejects.toThrow("empty");
  });
});
