import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, type PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyJobCheckout } from "../components/company-job-checkout.native";
import { CompanySecureCardField as NativeSecureCardField } from "../components/company-secure-card-field.native";
import type {
  CompanyNativeCheckoutController, CompanyNativeCheckoutControllerInput, NativeCheckoutConfiguration,
  NativeCheckoutConfirmationAuthorization, NativeCheckoutPrepared, NativeCheckoutProvider,
  NativeCheckoutSignatureApproval, NativeCheckoutState, NativeCheckoutTransport,
} from "../lib/company-native-checkout";
import type { CompanyNativePaymentPointer } from "../lib/company-native-payment-storage";
import type { JobSyncCompanyJobDetail, JobSyncNativeSession } from "../lib/jobsync-mobile-api";

// Connected UI only: actual wrapper + flow + native secure-card/signature bridges
// + controller. No flow probe/stub and no source-text assertions. ReactDOM drives
// real hooks/refs/effects; RN/SDK/WebView primitives and all I/O are isolated.
// The injected transport is a semantic fixture, NOT proof of a live backend adapter.
const mocks = vi.hoisted(() => ({
  focused: true, appState: "active", clock: 0, paid: false,
  listeners: new Set<(state: string) => void>(),
  factory: vi.fn(), inputs: [] as CompanyNativeCheckoutControllerInput[],
  controllers: [] as CompanyNativeCheckoutController[], states: [] as NativeCheckoutState[],
  provider: vi.fn(), guards: [] as ReturnType<typeof vi.fn<() => boolean>>[],
  session: vi.fn(), detail: vi.fn(), hosted: vi.fn(), manualPaid: vi.fn(), browser: vi.fn(), browserImports: 0,
  read: vi.fn(), reserve: vi.fn(), remove: vi.fn(), pointer: vi.fn(), fetch: vi.fn(),
  init: vi.fn(), tokenize: vi.fn(), confirm: vi.fn(), clearCard: vi.fn(),
  cardMounts: 0, cardUnmounts: 0, readSignature: vi.fn(), clearSignature: vi.fn(),
  capabilities: vi.fn(), quote: vi.fn(), approve: vi.fn(), prepare: vi.fn(), authorize: vi.fn(), status: vi.fn(),
}));
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 28, left: 0, right: 0 }) }));
vi.mock("@/hooks/use-job-sheet-colors", () => ({ useJobSheetColors: () => ({
  background: "#07111F", foreground: "#F6F8FC", muted: "#94A3B8", border: "#243754", error: "#F06A6A",
}) }));
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => R.createElement(name, {
    ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
  }, props.children);
  return {
    View: host("native-view"), Text: host("native-text"), TouchableOpacity: host("native-touch"),
    TextInput: host("native-input"), Modal: host("native-modal"), ScrollView: host("native-scroll"),
    KeyboardAvoidingView: host("native-keyboard"), ActivityIndicator: host("native-spinner"),
    StyleSheet: { create: (styles: unknown) => styles }, Platform: { OS: "ios" },
    AppState: {
      get currentState() { return mocks.appState; },
      addEventListener: (_name: string, listener: (state: string) => void) => {
        mocks.listeners.add(listener); return { remove: () => mocks.listeners.delete(listener) };
      },
    },
  };
});
vi.mock("@stripe/stripe-react-native", async () => {
  const R = await import("react");
  return {
    initStripe: mocks.init, createPaymentMethod: mocks.tokenize, confirmPayment: mocks.confirm,
    CardField: R.forwardRef(function SDKCardPrimitive(props: Record<string, any>, ref) {
      R.useImperativeHandle(ref, () => ({ clear: mocks.clearCard }), []);
      R.useEffect(() => { mocks.cardMounts++; return () => { mocks.cardUnmounts++; }; }, []);
      return R.createElement("sdk-card-field", {
        ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
      });
    }),
  };
});
// Vitest is not Metro: select the actual native implementation, not the generic
// non-collecting web fallback. This is a re-export, not a fake secure-card bridge.
vi.mock("../components/company-secure-card-field", () => import("../components/company-secure-card-field.native"));
vi.mock("react-native-signature-canvas", async () => {
  const R = await import("react");
  return { default: R.forwardRef(function SignatureCanvasPrimitive(props: Record<string, any>, ref) {
    R.useImperativeHandle(ref, () => ({ readSignature: mocks.readSignature, clearSignature: mocks.clearSignature }), []);
    return R.createElement("signature-canvas-primitive", {
      ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
    });
  }) };
});
vi.mock("../lib/jobsync-mobile-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/jobsync-mobile-api")>(),
  getJobSyncMobileSession: mocks.session, getJobSyncCompanyJobDetail: mocks.detail,
  createJobSyncCompanyJobCheckout: mocks.hosted, recordJobSyncCompanyJobPayment: mocks.manualPaid,
}));
vi.mock("../lib/company-native-payment-storage", () => ({
  companyNativePaymentStore: { read: mocks.read, reserve: mocks.reserve, remove: mocks.remove },
  newCompanyNativePaymentPointer: mocks.pointer,
}));
vi.mock("../lib/company-native-payment-api", () => ({ companyNativePaymentTransport: {
  capabilities: mocks.capabilities, quote: mocks.quote, approveSignature: mocks.approve,
  prepare: mocks.prepare, authorizeConfirmation: mocks.authorize, status: mocks.status,
} satisfies NativeCheckoutTransport }));
vi.mock("../lib/company-native-checkout", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/company-native-checkout")>();
  mocks.factory.mockImplementation((options: CompanyNativeCheckoutControllerInput) => {
    mocks.inputs.push(options);
    const provider: NativeCheckoutProvider = { confirm: (request) => {
      const guard = vi.fn(request.isCurrent); mocks.guards.push(guard);
      mocks.provider(request);
      // Instrument the authentic per-call predicate, preserving the wrapper's
      // real provider closure and the native bridge's serialized SDK dispatch.
      return options.provider!.confirm({ ...request, isCurrent: guard });
    } };
    const c = original.createCompanyNativeCheckoutController({ ...options, provider,
      now: () => mocks.clock,
      onState: (next) => { mocks.states.push(next); options.onState(next); },
    });
    for (const name of ["refresh", "setPaymentMethod", "approveSignature", "confirm"] as const) vi.spyOn(c, name);
    mocks.controllers.push(c); return c;
  });
  return { ...original, createCompanyNativeCheckoutController: mocks.factory };
});
vi.mock("expo-web-browser", () => {
  mocks.browserImports++; return { openBrowserAsync: mocks.browser, openAuthSessionAsync: mocks.browser };
});

const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
type Props = React.ComponentProps<typeof CompanyJobCheckout>;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVQImWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==";
const PM = "pm_ConnectedFixtureOnly";
const PI = "pi_ConnectedFixtureOnly";
const SECRET = `${PI}_secret_ConnectedFixtureOnly`;
const KEY = "hsc-native-00000000-0000-4000-8000-000000000071";
const CONFIRM = "Confirm Payment · $125.25";
let serial = 24000;
let props: Props;
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let extraRoots: ReturnType<typeof createRoot>[];
let cleanupWaits: (() => void)[];
const actor = (companyId: number): JobSyncNativeSession => ({
  token: `native-connected-fixture-${companyId}`, portal: "company",
  user: { id: 42, role: "owner", name: "Fixture Owner", email: null, paymentCollectionEnabled: true },
  company: { id: companyId, name: "Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null },
});
function detail(): JobSyncCompanyJobDetail {
  return { id: props.jobId, companyId: props.session.company!.id, title: "Canonical Fixture Service", status: "scheduled",
    customerId: 73, assignedUserId: null, serviceName: "Fixture Service", customerName: "Fixture Customer", assignedName: null,
    scheduledStartAt: null, scheduledEndAt: null, updatedAt: null, addressLine1: null, city: null,
    enRouteAt: null, onSiteAt: null, completedAt: null,
    amount: 999, paidTotal: mocks.paid ? 375.25 : 250, balance: mocks.paid ? 0 : 125.25,
    paymentStatus: mocks.paid ? "paid" : "partial", photos: [] };
}
function configuration(): NativeCheckoutConfiguration {
  return { companyId: props.session.company!.id, nativeEnabled: true, accountId: "acct_ConnectedFixtureOnly",
    publishableKey: "pk_test_ConnectedFixtureOnly", currency: "usd", mode: "test" };
}
function tokenResult() { return { paymentMethod: { id: PM, liveMode: false, Card: { brand: "Visa", last4: "4242" } } }; }
function sdkResult() { return { paymentIntent: { id: PI, livemode: false, status: "Succeeded" } }; }
function deferred<T>(cleanupValue: T) {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  cleanupWaits.push(() => resolve(cleanupValue));
  return { promise, resolve };
}
const all = (node: PhotoTestNode = container): NativeNode[] => [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))];
const nodes = (name: string) => all().filter((node) => node.nodeName.toLowerCase() === name);
function button(label: string): NativeNode {
  const found = nodes("native-touch").find((node) => node.nativeProps.accessibilityLabel === label);
  if (!found) throw new Error(`Missing actual checkout button: ${label}`);
  return found;
}
function c() { return mocks.controllers.at(-1)!; }
async function invoke(action: () => unknown) { await act(async () => { await action(); }); }
async function press(label: string) { await invoke(() => button(label).nativeProps.onPress()); }
async function render(patch: Partial<Props> = {}) {
  props = { ...props, ...patch }; await invoke(() => root.render(<CompanyJobCheckout {...props} />));
}
async function enterCard() {
  await render(); await press("Manual Card Entry");
  expect(nodes("sdk-card-field")).toHaveLength(1);
  await invoke(() => nodes("sdk-card-field")[0].nativeProps.onCardChange({ complete: true, brand: "Visa", last4: "4242" }));
  expect(button("Continue to Tip →").nativeProps.disabled).toBe(false);
  return nodes("sdk-card-field")[0];
}
async function enterSignature() {
  const host = await enterCard();
  await press("Continue to Tip →"); await press("Continue to Signature →");
  expect(button(CONFIRM).nativeProps.disabled).toBe(true);
  return host;
}
async function sign() {
  const canvas = nodes("signature-canvas-primitive")[0];
  expect(canvas).toBeDefined();
  await invoke(() => canvas.nativeProps.onBegin());
  await invoke(() => canvas.nativeProps.onEnd());
  expect(mocks.readSignature).toHaveBeenCalledTimes(1);
  await invoke(() => canvas.nativeProps.onOK(PNG));
  expect(button(CONFIRM).nativeProps.disabled).toBe(false);
}
function expectSameField(host: NativeNode, hidden = true) {
  expect(nodes("sdk-card-field")).toEqual([host]);
  expect(mocks.cardMounts).toBe(1); expect(mocks.cardUnmounts).toBe(0);
  expect(mocks.init).toHaveBeenCalledTimes(1);
  if (hidden) {
    let slot = host.parentNode as NativeNode | null;
    while (slot && slot.nativeProps?.importantForAccessibility === undefined) slot = slot.parentNode as NativeNode | null;
    expect(slot).not.toBeNull();
    expect(slot!.nativeProps).toMatchObject({ pointerEvents: "none", accessibilityElementsHidden: true,
      importantForAccessibility: "no-hide-descendants", style: { display: "none" } });
  }
}
function expectNoFinalAction() {
  expect(c().approveSignature).not.toHaveBeenCalled(); expect(c().confirm).not.toHaveBeenCalled();
  expect(mocks.approve).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.authorize).not.toHaveBeenCalled(); expect(mocks.provider).not.toHaveBeenCalled();
  expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks(); vi.useRealTimers();
  mocks.focused = true; mocks.appState = "active"; mocks.clock = Date.now(); mocks.paid = false;
  mocks.inputs = []; mocks.controllers = []; mocks.states = []; mocks.guards = []; mocks.listeners.clear();
  mocks.cardMounts = 0; mocks.cardUnmounts = 0; extraRoots = []; cleanupWaits = [];
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  props = { visible: true, session: actor(serial++), jobId: 12, customerName: "Fixture Customer",
    isCurrent: () => true, onClose: vi.fn(), onVerifiedDetail: vi.fn() };
  mocks.session.mockImplementation(async () => structuredClone(props.session)); mocks.detail.mockImplementation(async () => detail());
  mocks.read.mockResolvedValue(null); mocks.reserve.mockResolvedValue(true); mocks.remove.mockResolvedValue(true);
  mocks.pointer.mockImplementation((companyId: number, userId: number, jobId: number): CompanyNativePaymentPointer => ({
    version: 1, companyId, userId, jobId, operationKey: KEY, createdAt: "2026-11-17T00:00:00.000Z",
  }));
  mocks.init.mockResolvedValue(undefined); mocks.tokenize.mockResolvedValue(tokenResult()); mocks.confirm.mockResolvedValue(sdkResult());
  mocks.capabilities.mockImplementation(async () => configuration());
  mocks.quote.mockImplementation(async (_context, request: Parameters<NativeCheckoutTransport["quote"]>[1]) => ({
    quoteId: "connected-quote-fixture", obligationVersion: "connected-obligation-1", companyId: props.session.company!.id,
    jobId: 12, accountId: configuration().accountId, mode: "test", currency: "usd", principalCents: 12525,
    tipCents: 0, totalCents: 12525, tip: request.tip, expiresAt: mocks.clock + 60000,
  }));
  mocks.approve.mockImplementation(async (_context, request: Parameters<NativeCheckoutTransport["approveSignature"]>[1]) => ({
    intent: request.intent, signatureApprovalId: "approval_ConnectedFixtureOnly", privateStored: true,
  } satisfies NativeCheckoutSignatureApproval));
  mocks.prepare.mockImplementation(async (_context, request: Parameters<NativeCheckoutTransport["prepare"]>[1]) => ({
    kind: "prepared", intent: request.intent, signatureApprovalId: request.signatureApprovalId,
    paymentIntentId: PI, clientSecret: SECRET, unconfirmed: true, serverReauthorized: true, sharedLockHeld: true,
  } satisfies NativeCheckoutPrepared));
  mocks.authorize.mockImplementation(async (_context, request: Parameters<NativeCheckoutTransport["authorizeConfirmation"]>[1]) => ({
    ...request, authorized: true, sharedLockHeld: true, expiresAt: mocks.clock + 30000,
  } satisfies NativeCheckoutConfirmationAuthorization));
  mocks.status.mockImplementation(async (_context, operationKey: string) => ({ companyId: props.session.company!.id,
    jobId: 12, operationKey, state: "processing" }));
  mocks.fetch.mockRejectedValue(new Error("Live HTTP is forbidden in connected checkout UI tests")); vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(async () => {
  await invoke(() => { root.unmount(); extraRoots.forEach((other) => other.unmount()); });
  // Drain deferred I/O even on an assertion failure: do not strand the bridge's
  // process-wide provider queue or leak pending signature reads into another test.
  await invoke(() => cleanupWaits.forEach((resolve) => resolve()));
  mocks.controllers.forEach((controller) => controller.dispose());
  expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.hosted).not.toHaveBeenCalled();
  expect(mocks.manualPaid).not.toHaveBeenCalled(); expect(mocks.browser).not.toHaveBeenCalled(); expect(mocks.browserImports).toBe(0);
  expect(mocks.listeners.size).toBe(0); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("connected native checkout UI with real flow and bridges (semantic transport only)", () => {
  it("keeps one secure field from card through tip, signature, delayed private approval, preparation and final SDK confirmation; only the deliberate final button pays", async () => {
    const approval = deferred<NativeCheckoutSignatureApproval | null>(null);
    const preparation = deferred<NativeCheckoutPrepared | null>(null);
    const sdk = deferred(sdkResult());
    mocks.approve.mockReturnValueOnce(approval.promise); mocks.prepare.mockReturnValueOnce(preparation.promise); mocks.confirm.mockReturnValueOnce(sdk.promise);
    await render();
    const tap = button("Tap to Pay on iPhone unavailable");
    expect(tap.nativeProps.disabled).toBe(true); expect(tap.nativeProps.accessibilityState.disabled).toBe(true);
    expect(tap.textContent).toBe("▣Tap to Pay on iPhone"); // Removed subtitle stays removed.
    await invoke(() => tap.nativeProps.onPress()); expectNoFinalAction();
    expect(container.textContent).toContain("Fixture Customer · Canonical Fixture Service");
    expect(container.textContent).toContain("$125.25"); expect(container.textContent).not.toContain("$999.00");
    await press("Manual Card Entry");
    const host = nodes("sdk-card-field")[0]; expect(host).toBeDefined();
    expect(host.nativeProps.dangerouslyGetFullCardDetails).toBe(false);
    expect(nodes("native-input")).toHaveLength(0); expect(button("Continue to Tip →").nativeProps.disabled).toBe(true);
    await press("Continue to Tip →"); expect(mocks.tokenize).not.toHaveBeenCalled(); expectNoFinalAction();
    await invoke(() => host.nativeProps.onCardChange({ complete: true, brand: "Visa", last4: "4242" }));
    await press("Continue to Tip →");
    expect(mocks.tokenize).toHaveBeenCalledTimes(1); expect(mocks.tokenize).toHaveBeenCalledWith({ paymentMethodType: "Card" });
    expect(c().setPaymentMethod).toHaveBeenCalledWith(PM, { brand: "Visa", last4: "4242" });
    expect(container.textContent).toContain("Add a Tip"); expectSameField(host); expectNoFinalAction();
    await press("No Tip"); expectSameField(host); expectNoFinalAction();
    await press("Continue to Signature →"); expectSameField(host); expectNoFinalAction();
    await press(CONFIRM); expectNoFinalAction();
    await invoke(() => nodes("signature-canvas-primitive")[0].nativeProps.onOK(PNG)); // Unsolicited PNG is not a signature.
    expect(button(CONFIRM).nativeProps.disabled).toBe(true); expectNoFinalAction();
    await sign(); expectSameField(host); expectNoFinalAction();
    const deliberate = button(CONFIRM).nativeProps.onPress;
    await invoke(() => { deliberate(); deliberate(); });
    expect(c().approveSignature).toHaveBeenCalledTimes(1); expect(c().approveSignature).toHaveBeenCalledWith({ pngDataUrl: PNG });
    expect(mocks.approve).toHaveBeenCalledTimes(1); expect(c().confirm).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled(); expectSameField(host);
    expect(container.textContent).toContain("Privately saving customer approval; no payment has been confirmed.");
    const [context, request] = mocks.approve.mock.calls[0];
    expect(context).toEqual({ token: props.session.token, companyId: props.session.company!.id, actorId: 42, jobId: 12 });
    expect(request.evidence).toEqual({ pngDataUrl: PNG }); expect(request.intent.operationKey).toBe(KEY);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    const pointer = mocks.reserve.mock.calls[0][0];
    expect(Object.keys(pointer).sort()).toEqual(["companyId", "createdAt", "jobId", "operationKey", "userId", "version"]);
    for (const privateValue of [PNG, SECRET, PM, props.session.token]) expect(JSON.stringify(pointer)).not.toContain(privateValue);
    await invoke(() => approval.resolve({ intent: request.intent, signatureApprovalId: "approval_ConnectedFixtureOnly", privateStored: true }));
    expect(c().confirm).toHaveBeenCalledTimes(1); expect(mocks.prepare).toHaveBeenCalledTimes(1); expectSameField(host);
    expect(mocks.confirm).not.toHaveBeenCalled();
    await invoke(() => preparation.resolve({ kind: "prepared", intent: request.intent, signatureApprovalId: "approval_ConnectedFixtureOnly",
      paymentIntentId: PI, clientSecret: SECRET, unconfirmed: true, serverReauthorized: true, sharedLockHeld: true }));
    expect(mocks.authorize).toHaveBeenCalledTimes(1); expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledWith(SECRET, { paymentMethodType: "Card", paymentMethodData: { paymentMethodId: PM } });
    expectSameField(host); expect(button(CONFIRM).nativeProps.disabled).toBe(true);
    await invoke(() => { deliberate(); button(CONFIRM).nativeProps.onPress(); });
    expect(c().approveSignature).toHaveBeenCalledTimes(1); expect(c().confirm).toHaveBeenCalledTimes(1); expect(mocks.confirm).toHaveBeenCalledTimes(1);
    await invoke(() => sdk.resolve(sdkResult()));
    expectSameField(host); expect(c().getState().phase).toBe("processing"); expect(mocks.remove).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Awaiting your Company's payment records.");
    expect(props.onVerifiedDetail).not.toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: "paid" }));
    await press("Refresh status"); expectSameField(host); expect(mocks.status).toHaveBeenCalledWith(expect.anything(), KEY);
    expect(mocks.confirm).toHaveBeenCalledTimes(1); expect(mocks.remove).not.toHaveBeenCalled();
    mocks.paid = true; await press("Refresh status");
    expect(c().getState().phase).toBe("paid");
    expect(props.onVerifiedDetail).toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: "paid", balance: 0 }));
    expect(mocks.remove).toHaveBeenCalledTimes(1); expect(mocks.remove).toHaveBeenCalledWith(pointer);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(SECRET); expect(container.textContent).not.toContain(PNG);
  });

  it("fresh controller states and equivalent configuration allocations preserve mounted field readiness and entered completeness", async () => {
    const host = await enterCard(); const originalController = c();
    for (let n = 0; n < 3; n++) {
      const before = c().getState().configuration;
      await press("Refresh status");
      expect(c().getState().configuration).toEqual(before); expect(c().getState().configuration).not.toBe(before);
      await render({ session: structuredClone(props.session), isCurrent: () => true, customerName: `Fixture Customer ${n}` });
      expect(c()).toBe(originalController); expect(mocks.factory).toHaveBeenCalledTimes(1);
      expectSameField(host, false); expect(button("Continue to Tip →").nativeProps.disabled).toBe(false); expectNoFinalAction();
    }
    // No second SDK onCardChange/onReady: the retained real bridge must still be
    // complete and ready after every fresh canonical/configuration read and render.
    await press("Continue to Tip →");
    expect(mocks.tokenize).toHaveBeenCalledTimes(1); expect(c().setPaymentMethod).toHaveBeenCalledWith(PM, { brand: "Visa", last4: "4242" });
    expect(container.textContent).toContain("Add a Tip"); expectSameField(host); expectNoFinalAction();
  });

  it.each(["authorization", "quote"] as const)("rechecks the actual per-call %s expiry after the delayed SDK queue, denying confirmation without live I/O or a retry", async (boundary) => {
    const authorization = deferred<NativeCheckoutConfirmationAuthorization | null>(null);
    mocks.authorize.mockReturnValueOnce(authorization.promise);
    const host = await enterSignature(); await sign(); await press(CONFIRM);
    expect(mocks.authorize).toHaveBeenCalledTimes(1); expect(mocks.provider).not.toHaveBeenCalled(); expectSameField(host);
    const request = mocks.authorize.mock.calls[0][1] as Parameters<NativeCheckoutTransport["authorizeConfirmation"]>[1];
    const expiresAt = boundary === "authorization" ? mocks.clock + 1000 : request.intent.quote.expiresAt + 1000;
    const queue = deferred<void>(undefined); mocks.init.mockReturnValueOnce(queue.promise);
    const extraContainer = container.ownerDocument.createElement("aside"); container.ownerDocument.body.appendChild(extraContainer);
    const extra = createRoot(extraContainer); extraRoots.push(extra);
    await invoke(() => extra.render(<NativeSecureCardField configuration={configuration()} scopeKey="cancelled-queue-fixture"
      isCurrent={() => true} onReady={vi.fn()} onChange={vi.fn()} />));
    expect(mocks.init).toHaveBeenCalledTimes(2); expect(mocks.confirm).not.toHaveBeenCalled();
    // An in-flight initialization blocks the authentic module-wide SDK queue.
    // Cancel its field before resolution so it cannot replace the active account:
    // the eventual refusal must be the checkout's per-call expiry, not a scope fault.
    await invoke(() => { extra.unmount(); extraRoots = []; });
    await invoke(() => authorization.resolve({ ...request, authorized: true, sharedLockHeld: true, expiresAt }));
    expect(mocks.provider).toHaveBeenCalledTimes(1); expect(mocks.guards).toHaveLength(1);
    const guard = mocks.guards[0]; expect(guard).toHaveLastReturnedWith(true);
    const callsBeforeRelease = guard.mock.calls.length;
    expect(mocks.confirm).not.toHaveBeenCalled(); expect(nodes("sdk-card-field")).toEqual([host]);
    mocks.clock = boundary === "authorization" ? expiresAt : request.intent.quote.expiresAt;
    // Do not invoke the guard ourselves: its next call must come from the real
    // queued native bridge immediately before it would call confirmPayment.
    await invoke(() => queue.resolve(undefined));
    expect(guard.mock.calls.length).toBeGreaterThan(callsBeforeRelease); expect(guard).toHaveLastReturnedWith(false);
    expect(mocks.confirm).not.toHaveBeenCalled(); expect(c().getState().phase).toBe("unknown");
    expect(nodes("sdk-card-field")).toEqual([host]); expect(mocks.cardMounts).toBe(1); expect(mocks.cardUnmounts).toBe(0);
    expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(props.onVerifiedDetail).not.toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: "paid" }));
    await press(CONFIRM); await press("Refresh status");
    expect(c().approveSignature).toHaveBeenCalledTimes(1); expect(c().confirm).toHaveBeenCalledTimes(1);
    expect(mocks.provider).toHaveBeenCalledTimes(1); expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
});
