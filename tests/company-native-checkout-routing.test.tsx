import React, { act } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, type PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyJobCheckout } from "../components/company-job-checkout.native";
import { companyNativePaymentTransport } from "../lib/company-native-payment-api";
import type {
  CompanyNativeCheckoutController, CompanyNativeCheckoutControllerInput, NativeCheckoutState,
} from "../lib/company-native-checkout";
import type { CompanyNativeCheckoutFlowProps, CompanyCheckoutSignatureDraft } from "../components/company-native-checkout-flow";
import type { CompanySecureCardProps } from "../lib/company-secure-card";
import type { CompanyNativePaymentPointer } from "../lib/company-native-payment-storage";
import type { JobSyncCompanyJobDetail, JobSyncNativeSession } from "../lib/jobsync-mobile-api";

// Explicit .native import tests the production wrapper, not a reimplemented shell.
// ReactDOM + the minimal local DOM exercise actual hooks/effects/refs. No native
// simulator: only presentation, RN AppState/focus, protected storage and I/O are isolated.
const mocks = vi.hoisted(() => ({
  focused: true, appState: "active", realController: false,
  flow: null as CompanyNativeCheckoutFlowProps | null,
  cardProps: null as CompanySecureCardProps | null,
  factory: vi.fn(), actualFactory: null as unknown as (input: CompanyNativeCheckoutControllerInput) => CompanyNativeCheckoutController,
  inputs: [] as CompanyNativeCheckoutControllerInput[], controllers: [] as CompanyNativeCheckoutController[],
  listeners: new Set<(next: string) => void>(), remove: vi.fn(),
  session: vi.fn(), detail: vi.fn(), hostedPost: vi.fn(), manualPaid: vi.fn(), browser: vi.fn(), browserImports: 0,
  capabilities: vi.fn(),
  read: vi.fn(), reserve: vi.fn(), removePointer: vi.fn(), pointer: vi.fn(),
  tokenize: vi.fn(), confirmCard: vi.fn(), clearCard: vi.fn(), fetch: vi.fn(),
}));
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused }));
vi.mock("react-native", () => ({ AppState: {
  get currentState() { return mocks.appState; },
  addEventListener: (_name: string, listener: (next: string) => void) => {
    mocks.listeners.add(listener);
    return { remove: () => { mocks.remove(); mocks.listeners.delete(listener); } };
  },
} }));
vi.mock("expo-web-browser", () => {
  mocks.browserImports++;
  return { openBrowserAsync: mocks.browser, openAuthSessionAsync: mocks.browser };
});
vi.mock("../lib/jobsync-mobile-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/jobsync-mobile-api")>(),
  getJobSyncMobileSession: mocks.session, getJobSyncCompanyJobDetail: mocks.detail,
  createJobSyncCompanyJobCheckout: mocks.hostedPost, recordJobSyncCompanyJobPayment: mocks.manualPaid,
  getJobSyncCompanyNativePaymentCapabilities: mocks.capabilities,
}));
vi.mock("../lib/company-native-checkout", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/company-native-checkout")>();
  mocks.actualFactory = original.createCompanyNativeCheckoutController;
  return { ...original, createCompanyNativeCheckoutController: mocks.factory };
});
vi.mock("../lib/company-native-payment-storage", () => ({
  companyNativePaymentStore: { read: mocks.read, reserve: mocks.reserve, remove: mocks.removePointer },
  newCompanyNativePaymentPointer: mocks.pointer,
}));
vi.mock("../components/company-native-checkout-flow", async () => {
  const R = await import("react");
  return { CompanyNativeCheckoutFlow: (props: CompanyNativeCheckoutFlowProps) => {
    mocks.flow = props;
    return R.createElement("checkout-flow-probe", null,
      props.visible && props.state.step !== "method" ? props.renderCardField?.({
        disabled: props.state.status !== "ready" || !props.state.manualCardAvailable || props.state.step !== "card",
        visible: props.state.step === "card", isCurrent: props.isCurrent,
      }) : null);
  } };
});
vi.mock("../components/company-secure-card-field", async () => {
  const R = await import("react");
  return { CompanySecureCardField: R.forwardRef(function SecureCardProbe(props: CompanySecureCardProps, ref) {
    mocks.cardProps = props;
    R.useImperativeHandle(ref, () => ({ tokenize: mocks.tokenize, confirm: mocks.confirmCard, clear: mocks.clearCard }), []);
    return R.createElement("secure-card-probe");
  }) };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
type Props = React.ComponentProps<typeof CompanyJobCheckout>;
let companySerial = 14000;
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let props: Props;
let unmounted: boolean;
const PNG = "data:image/png;base64,aW5tZW1vcnlmaXh0dXJl";
const PM = "pm_RoutingFixtureOnly";
const SECRET = "pi_RoutingFixtureOnly_secret_FixtureOnly";
const POINTER_KEY = "hsc-native-00000000-0000-4000-8000-000000000001";
const actor = (companyId: number): JobSyncNativeSession => ({
  token: `native-routing-fixture-${companyId}`, portal: "company",
  user: { id: 42, role: "owner", name: "Fixture Owner", email: null, paymentCollectionEnabled: true },
  company: { id: companyId, name: "Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null },
});
function canonical(patch: Partial<JobSyncCompanyJobDetail> = {}): JobSyncCompanyJobDetail {
  return { id: props.jobId, companyId: patch.companyId ?? props.session.company?.id ?? 0, title: "Canonical Fixture Service", status: "scheduled",
    amount: 999, paidTotal: 250, balance: 125.25, paymentStatus: "partial", photos: [], ...patch } as JobSyncCompanyJobDetail;
}
function state(patch: Partial<NativeCheckoutState> = {}): NativeCheckoutState {
  return { phase: "blocked", detail: canonical(), configuration: null, method: null,
    methods: { card: { available: false, reason: "Verified native transport is not ready." },
      tapToPay: { available: false, reason: "Tap to Pay is not ready." } },
    card: null, tip: { kind: "none" }, quote: null, signatureApproved: false,
    canConfirm: false, busy: false, message: "Verified native transport is not ready.", ...patch };
}
function configured(patch: Partial<NativeCheckoutState> = {}): NativeCheckoutState {
  return state({ phase: "card", method: "card", message: null,
    configuration: { companyId: props.session.company!.id, nativeEnabled: true, accountId: "acct_RoutingFixtureOnly",
      publishableKey: "pk_test_RoutingFixtureOnly", currency: "usd", mode: "test" },
    methods: { card: { available: true, reason: null }, tapToPay: { available: false, reason: "Not ready" } }, ...patch });
}
function quoteState(): NativeCheckoutState {
  return configured({ phase: "signature", quote: {
    quoteId: "server-quote-routing", obligationVersion: "obligation-1", companyId: props.session.company!.id,
    jobId: props.jobId, accountId: "acct_RoutingFixtureOnly", mode: "test", currency: "usd", principalCents: 12525,
    tipCents: 432, totalCents: 12957, tip: { kind: "custom", amountCents: 432 }, expiresAt: Date.now() + 60000,
  } });
}
function stubController(input: CompanyNativeCheckoutControllerInput): CompanyNativeCheckoutController {
  let current = state();
  const c = {
    getState: () => current,
    refresh: vi.fn(async () => { input.onState(current); return false; }),
    refreshStatus: vi.fn(async () => false), selectMethod: vi.fn(() => true),
    setPaymentMethod: vi.fn(() => true), quoteTip: vi.fn(async () => true),
    back: vi.fn(() => true), continueToSignature: vi.fn(() => true),
    approveSignature: vi.fn(async () => true), confirm: vi.fn(async () => true), dispose: vi.fn(),
  } satisfies CompanyNativeCheckoutController;
  // Deliberately do not guard the dummy callback: the real wrapper owns the
  // post-disposal callback fence and must reject even a misbehaving late source.
  Object.defineProperty(c, "emit", { value: (next: NativeCheckoutState) => { current = next; input.onState(next); } });
  return c;
}
function flow() { if (!mocks.flow) throw new Error("Flow probe did not render"); return mocks.flow; }
function input(index = mocks.inputs.length - 1) { return mocks.inputs[index]; }
function controller(index = mocks.controllers.length - 1) { return mocks.controllers[index]; }
async function render(patch: Partial<Props> = {}) {
  props = { ...props, ...patch };
  await act(async () => { root.render(<CompanyJobCheckout {...props} />); });
}
async function invoke(action: () => unknown) { await act(async () => { await action(); }); }
async function emit(next: NativeCheckoutState, index = mocks.inputs.length - 1) {
  await invoke(() => input(index).onState(next));
}
async function appState(value: string) {
  await invoke(() => { mocks.appState = value; for (const listener of [...mocks.listeners]) listener(value); });
}
async function unmount() { await act(async () => { root.unmount(); }); unmounted = true; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
async function makeCardReady() {
  await emit(configured());
  if (!mocks.cardProps) throw new Error("Secure-card forwardRef probe did not mount");
  await invoke(() => {
    mocks.cardProps!.onReady?.(true);
    mocks.cardProps!.onChange({ complete: true, brand: "Visa", last4: "4242" });
  });
}
function draft(): CompanyCheckoutSignatureDraft {
  return { quoteKey: flow().state.quote!.key, pngDataUrl: PNG };
}
async function reviewCustomQuote() {
  await invoke(() => flow().onTipSelect("custom"));
  await invoke(() => flow().onCustomTipChange("4.32"));
  await emit(quoteState());
}
async function allRetainedActions(retained: CompanyNativeCheckoutFlowProps) {
  await invoke(() => {
    retained.onManualCardEntry(); retained.onCardContinue(); retained.onTipSelect(18);
    retained.onCustomTipChange("4.32"); retained.onTipContinue(); retained.onBack();
    retained.onSignatureChange({ quoteKey: "retained", pngDataUrl: PNG });
    retained.onConfirmPayment({ quoteKey: "retained", pngDataUrl: PNG });
    retained.onRefreshStatus(); retained.onClose();
  });
}
function actionCounts(c = controller()) {
  return [c.refresh, c.refreshStatus, c.selectMethod, c.setPaymentMethod, c.quoteTip, c.back,
    c.continueToSignature, c.approveSignature, c.confirm].map((fn) => vi.mocked(fn).mock.calls.length);
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.focused = true; mocks.appState = "active"; mocks.realController = false;
  mocks.flow = null; mocks.cardProps = null; mocks.inputs = []; mocks.controllers = []; mocks.listeners.clear(); unmounted = false;
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  props = { visible: true, session: actor(companySerial++), jobId: 12, customerName: "Fixture Customer",
    isCurrent: () => true, onClose: vi.fn(), onVerifiedDetail: vi.fn() };
  mocks.session.mockImplementation(async () => structuredClone(props.session));
  mocks.detail.mockImplementation(async () => canonical());
  mocks.capabilities.mockResolvedValue({ nativeEnabled: false, reason: "Native setup is not verified" });
  mocks.read.mockResolvedValue(null); mocks.reserve.mockResolvedValue(true); mocks.removePointer.mockResolvedValue(true);
  mocks.pointer.mockImplementation((companyId: number, userId: number, jobId: number): CompanyNativePaymentPointer => ({
    version: 1, companyId, userId, jobId, operationKey: POINTER_KEY, createdAt: "2026-11-17T00:00:00.000Z",
  }));
  mocks.tokenize.mockResolvedValue({ paymentMethodId: PM, brand: "Visa", last4: "4242" });
  mocks.confirmCard.mockResolvedValue({ outcome: "succeeded", intentId: "pi_RoutingFixtureOnly" });
  mocks.fetch.mockRejectedValue(new Error("Live HTTP is forbidden in native routing tests")); vi.stubGlobal("fetch", mocks.fetch);
  mocks.factory.mockImplementation((options: CompanyNativeCheckoutControllerInput) => {
    mocks.inputs.push(options);
    const c = mocks.realController ? mocks.actualFactory(options) : stubController(options);
    mocks.controllers.push(c); return c;
  });
});
afterEach(async () => {
  if (!unmounted) await unmount();
  mocks.controllers.forEach((c) => c.dispose());
  expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.hostedPost).not.toHaveBeenCalled();
  expect(mocks.manualPaid).not.toHaveBeenCalled(); expect(mocks.browser).not.toHaveBeenCalled();
  expect(mocks.browserImports).toBe(0); vi.unstubAllGlobals();
});

describe("native checkout routing and preserved parent boundaries", () => {
  it("keeps native routing implicit in both unchanged Schedule imports", () => {
    for (const file of ["schedule", "admin-schedule"]) {
      const source = readFileSync(new URL(`../app/(tabs)/${file}.tsx`, import.meta.url), "utf8");
      expect(source).toContain('import { CompanyJobCheckout } from "@/components/company-job-checkout";');
      expect(source).not.toMatch(/from ["'][^"']*company-job-checkout\.(?:native|web)["']/);
      const start = source.indexOf("<CompanyJobCheckout");
      const call = source.slice(start, source.indexOf("/>", start) + 2);
      expect(call).toContain("onVerifiedDetail="); expect(call).toContain("detail.companyId"); expect(call).toContain("detail.id");
      expect(call).toContain("detail.balance"); expect(call).toContain("detail.paymentStatus");
      expect(call).not.toMatch(/paymentStatus:\s*["']paid["']|setSelectedJob\([^\n]*paid/);
    }
  });
  it("native wrapper has no browser/hosted POST/manual mark-paid/raw-storage implementation", () => {
    const source = readFileSync(new URL("../components/company-job-checkout.native.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/export function CompanyJobCheckout/);
    expect(source).not.toMatch(/expo-web-browser|openBrowser|openAuthSession|createCompanyJobCheckoutController|createJobSyncCompanyJobCheckout|recordJobSyncCompanyJobPayment|fetch\s*\(|\.post\s*\(/);
    expect(source).not.toMatch(/AsyncStorage|localStorage|setItemAsync|uploadJobSync|uploadPhoto|dangerouslyGetFullCardDetails/);
  });
  it("feeds canonical detail/status into the real wrapper's controlled flow without hosted fallback", async () => {
    await render();
    expect(mocks.factory).toHaveBeenCalledTimes(1); expect(controller().refresh).toHaveBeenCalledTimes(1);
    expect(input().nativeTransport).toBe(companyNativePaymentTransport); // Real fail-closed adapter, not a guessed mutation.
    expect(flow().state).toMatchObject({ status: "blocked", customerName: "Fixture Customer", serviceName: "Canonical Fixture Service",
      balanceAmountText: "$125.25", manualCardAvailable: false, canContinueCard: false, signature: null });
    expect(flow().state.balanceAmountText).not.toBe("$999.00"); expect(mocks.cardProps).toBeNull();
    await invoke(() => flow().onManualCardEntry()); expect(controller().selectMethod).toHaveBeenCalledWith("card");
    expect(mocks.tokenize).not.toHaveBeenCalled(); expect(mocks.confirmCard).not.toHaveBeenCalled();
  });
});

describe("actual controller default native gate (fresh dummy reads only)", () => {
  it("keeps the actual controller's absent-transport default blocked after canonical fresh dummy reads", async () => {
    const onState = vi.fn(); const verified = vi.fn();
    const c = mocks.actualFactory({ session: props.session, jobId: props.jobId, isCurrent: () => true,
      onState, onVerifiedDetail: verified,
      readTransport: { session: mocks.session, detail: mocks.detail } });
    mocks.controllers.push(c);
    expect(await c.refresh()).toBe(false); expect(c.getState()).toMatchObject({ phase: "blocked", detail: canonical() });
    expect(onState).toHaveBeenCalledWith(expect.objectContaining({ phase: "blocked" }));
    expect(verified).toHaveBeenCalledWith(canonical()); expect(c.selectMethod("card")).toBe(false);
    expect(await c.confirm()).toBe(false); expect(mocks.capabilities).not.toHaveBeenCalled();
    expect(mocks.confirmCard).not.toHaveBeenCalled();
  });
  it.each([false, true])("actual adapter never unlocks card collection even if capability nativeEnabled=%s", async (enabled) => {
    mocks.realController = true;
    mocks.capabilities.mockResolvedValue({ nativeEnabled: enabled, companyId: props.session.company!.id,
      accountId: "acct_RoutingFixtureOnly", publishableKey: "pk_test_RoutingFixtureOnly", mode: "test", currency: "usd" });
    await render(); expect(mocks.capabilities).toHaveBeenCalledWith(props.session.token, props.jobId);
    expect(flow().state.manualCardAvailable).toBe(false); expect(flow().state.canContinueCard).toBe(false);
    expect(flow().state.status).not.toBe("ready"); expect(mocks.cardProps).toBeNull();
    await invoke(() => flow().onManualCardEntry()); await invoke(() => flow().onCardContinue());
    expect(mocks.tokenize).not.toHaveBeenCalled(); expect(mocks.confirmCard).not.toHaveBeenCalled();
    expect(mocks.pointer).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("actual adapter mutation and recovery methods reject locally without making any HTTP request", async () => {
    const transport = companyNativePaymentTransport;
    for (const method of ["quote", "approveSignature", "prepare", "authorizeConfirmation", "status"] as const) {
      // Deliberately invalid dummy arguments: these unavailable methods must
      // throw before interpreting input, retrieving secrets or issuing HTTP.
      const unavailable = transport[method] as (...args: unknown[]) => Promise<unknown>;
      await expect(unavailable({ token: props.session.token, companyId: props.session.company!.id,
        actorId: 42, jobId: 12 }, {})).rejects.toThrow(/not verified|not ready/i);
    }
    expect(mocks.capabilities).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("reads fresh Company session/detail and stays unavailable through the real fail-closed adapter", async () => {
    mocks.realController = true; await render();
    expect(mocks.session).toHaveBeenCalledWith(props.session.token);
    expect(mocks.detail).toHaveBeenCalledWith(props.session.token, 12, props.session.company!.id);
    expect(mocks.read).toHaveBeenCalledWith(props.session.company!.id, 42, 12);
    expect(props.onVerifiedDetail).toHaveBeenCalledWith(expect.objectContaining({ balance: 125.25, paymentStatus: "partial" }));
    expect(controller().getState()).toMatchObject({ phase: "blocked", detail: expect.objectContaining({ balance: 125.25 }) });
    expect(flow().state.status).toBe("blocked"); expect(flow().state.manualCardAvailable).toBe(false);
    expect(flow().state.manualCardUnavailableReason).toMatch(/verified Company native payment support|not verified/);
    await invoke(() => flow().onManualCardEntry()); await invoke(() => flow().onCardContinue());
    expect(mocks.pointer).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.tokenize).not.toHaveBeenCalled(); expect(mocks.confirmCard).not.toHaveBeenCalled();
  });
  it("acknowledges paid only when the delayed fresh canonical detail says paid AND balance zero", async () => {
    mocks.realController = true;
    const wait = deferred<JobSyncCompanyJobDetail>(); mocks.detail.mockReturnValueOnce(wait.promise); await render();
    expect(flow().state.status).toBe("loading"); expect(props.onVerifiedDetail).not.toHaveBeenCalled();
    await invoke(() => wait.resolve(canonical({ paymentStatus: "paid", balance: 0 })));
    expect(flow().state).toMatchObject({ status: "paid", balanceAmountText: "$0.00", canConfirmPayment: false });
    expect(props.onVerifiedDetail).toHaveBeenCalledTimes(1); expect(mocks.confirmCard).not.toHaveBeenCalled();
  });
  it.each([{ paymentStatus: "paid", balance: 10 }, { paymentStatus: "partial", balance: 0 }])("does not optimistically mark paid from inconsistent canonical %j", async (patch) => {
    mocks.realController = true; mocks.detail.mockImplementation(async () => canonical(patch)); await render();
    expect(flow().state.status).toBe("blocked"); expect(flow().state.status).not.toBe("paid");
  });
  it.each(["Company", "Job"])("rejects canonical detail from a different %s before notifying the parent", async (fault) => {
    mocks.realController = true;
    mocks.detail.mockImplementation(async () => canonical(fault === "Company" ? { companyId: props.session.company!.id + 1 } : { id: 13 }));
    await render(); expect(props.onVerifiedDetail).not.toHaveBeenCalled(); expect(flow().state.status).toBe("error");
  });
  it("background/foreground reacquires read-only fresh detail without SDK tokenization or automatic confirmation", async () => {
    mocks.realController = true; await render(); const before = mocks.detail.mock.calls.length;
    await appState("background"); expect(input(0).isCurrent()).toBe(false); expect(mocks.detail).toHaveBeenCalledTimes(before);
    mocks.detail.mockImplementation(async () => canonical({ balance: 0, paymentStatus: "paid" }));
    await appState("active"); expect(mocks.factory).toHaveBeenCalledTimes(2); expect(mocks.detail).toHaveBeenCalledTimes(before + 1);
    expect(flow().state.status).toBe("paid"); expect(mocks.tokenize).not.toHaveBeenCalled(); expect(mocks.confirmCard).not.toHaveBeenCalled();
    expect(mocks.pointer).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
  });
});

describe("wrapper scope, lifecycle, callback identity and stale parent fences", () => {
  it.each(["hidden", "blurred", "background", "invalid-job", "missing-company", "parent-stale"])("creates no controller while %s", async (fault) => {
    if (fault === "blurred") mocks.focused = false;
    if (fault === "background") mocks.appState = "background";
    const patch: Partial<Props> = fault === "hidden" ? { visible: false } : fault === "invalid-job" ? { jobId: 0 }
      : fault === "missing-company" ? { session: { ...props.session, company: undefined } }
      : fault === "parent-stale" ? { isCurrent: () => false } : {};
    await render(patch); expect(mocks.factory).not.toHaveBeenCalled(); expect(flow().isCurrent()).toBe(false);
    await allRetainedActions(flow()); expect(props.onClose).not.toHaveBeenCalled(); expect(props.onVerifiedDetail).not.toHaveBeenCalled();
    expect(mocks.tokenize).not.toHaveBeenCalled();
  });
  it("keeps a single controller across parent objects and newly allocated isCurrent/onVerifiedDetail callbacks", async () => {
    await render(); const original = input(); const c = controller();
    const latest = vi.fn();
    for (let n = 0; n < 3; n++) await render({ customerName: `Customer ${n}`, isCurrent: () => true, onVerifiedDetail: latest,
      session: structuredClone(props.session), onClose: vi.fn() });
    expect(mocks.factory).toHaveBeenCalledTimes(1); expect(c.dispose).not.toHaveBeenCalled(); expect(c.refresh).toHaveBeenCalledTimes(1);
    await invoke(() => original.onVerifiedDetail?.(canonical())); expect(latest).toHaveBeenCalledTimes(1);
    expect(flow().state.customerName).toBe("Customer 2");
  });
  it.each(["token", "Company", "Job", "user", "role", "permission", "logout", "focus", "AppState", "parent", "hidden", "close", "unmount"])("rejects old controller completions and parent callbacks after %s changes", async (fault) => {
    await render(); const oldInput = input(); const oldFlow = flow(); const c = controller();
    const oldDetail = canonical({ balance: 0, paymentStatus: "paid" });
    const changed = structuredClone(props.session);
    if (fault === "token") changed.token = "rotated-fixture-token";
    if (fault === "Company") changed.company!.id++;
    if (fault === "user") changed.user.id++;
    if (fault === "role") changed.user.role = "technician";
    if (fault === "permission") changed.user.paymentCollectionEnabled = false;
    if (fault === "logout") { changed.token = ""; changed.company = undefined; }
    if (["token", "Company", "user", "role", "permission", "logout"].includes(fault)) await render({ session: changed });
    if (fault === "Job") await render({ jobId: 13 });
    if (fault === "focus") { mocks.focused = false; await render(); }
    if (fault === "AppState") await appState("background");
    if (fault === "parent") await render({ isCurrent: () => false });
    if (fault === "hidden") await render({ visible: false });
    if (fault === "close") await invoke(() => oldFlow.onClose());
    if (fault === "unmount") await unmount();
    const counts = mocks.realController ? [] : actionCounts(controller());
    const closed = vi.mocked(props.onClose).mock.calls.length;
    const snapshot = flow().state;
    await invoke(() => { oldInput.onState(state({ phase: "paid", detail: oldDetail })); oldInput.onVerifiedDetail?.(oldDetail); });
    await allRetainedActions(oldFlow);
    expect(oldInput.isCurrent()).toBe(false); expect(props.onVerifiedDetail).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledTimes(closed); expect(flow().state).toEqual(snapshot);
    expect(actionCounts(controller())).toEqual(counts); expect(mocks.tokenize).not.toHaveBeenCalled(); expect(mocks.confirmCard).not.toHaveBeenCalled();
    if (fault !== "parent") expect(c.dispose).toHaveBeenCalled();
  });
  it.each(["close/reopen", "blur/refocus", "background/resume"])("does not revive retained flow callbacks after same-scope %s", async (transition) => {
    await render(); const retained = flow(); const original = input();
    if (transition === "close/reopen") { await invoke(() => retained.onClose()); await render({ visible: false }); await render({ visible: true }); }
    if (transition === "blur/refocus") { mocks.focused = false; await render(); mocks.focused = true; await render(); }
    if (transition === "background/resume") { await appState("background"); await appState("active"); }
    expect(mocks.factory).toHaveBeenCalledTimes(2); expect(original.isCurrent()).toBe(false);
    const current = controller(); const counts = actionCounts(current); const closed = vi.mocked(props.onClose).mock.calls.length;
    const snapshot = flow().state;
    await allRetainedActions(retained);
    expect(actionCounts(current)).toEqual(counts); expect(props.onClose).toHaveBeenCalledTimes(closed);
    expect(flow().state).toEqual(snapshot); expect(input().isCurrent()).toBe(true);
  });
  it("unmount removes the AppState subscription and rejects a retained listener's late active event", async () => {
    await render(); const listener = [...mocks.listeners][0]; await unmount();
    expect(mocks.listeners.size).toBe(0); expect(mocks.remove).toHaveBeenCalledTimes(1);
    await invoke(() => listener("active")); expect(mocks.factory).toHaveBeenCalledTimes(1);
    expect(input().isCurrent()).toBe(false); expect(props.onVerifiedDetail).not.toHaveBeenCalled();
  });
});

describe("secure-card and protected nonsensitive pointer wrapper wiring", () => {
  it("passes the scoped configuration to a secure forwardRef and tokenizes without confirming or local payment acknowledgement", async () => {
    await render(); await makeCardReady();
    expect(mocks.cardProps).toMatchObject({ configuration: expect.objectContaining({ accountId: "acct_RoutingFixtureOnly" }), disabled: false });
    expect(mocks.cardProps!.scopeKey).toBe(flow().epochKey); expect(mocks.cardProps!.isCurrent()).toBe(true);
    await invoke(() => flow().onCardContinue());
    expect(mocks.tokenize).toHaveBeenCalledTimes(1); expect(controller().setPaymentMethod).toHaveBeenCalledWith(PM, { brand: "Visa", last4: "4242" });
    expect(controller().quoteTip).toHaveBeenCalledWith({ kind: "none" });
    expect(mocks.confirmCard).not.toHaveBeenCalled(); expect(controller().confirm).not.toHaveBeenCalled();
    expect(props.onVerifiedDetail).not.toHaveBeenCalled(); expect(flow().state.status).not.toBe("paid");
    expect(JSON.stringify(flow().state)).not.toContain(PM); expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("drops delayed tokenization when the originating sheet closes and reopens", async () => {
    await render(); await makeCardReady(); const retained = flow(); const c = controller();
    const token = deferred<{ paymentMethodId: string; brand: string; last4: string }>(); mocks.tokenize.mockReturnValueOnce(token.promise);
    await invoke(() => retained.onCardContinue()); expect(mocks.tokenize).toHaveBeenCalledTimes(1);
    await invoke(() => retained.onClose()); await render({ visible: false }); await render({ visible: true });
    await invoke(() => token.resolve({ paymentMethodId: PM, brand: "Visa", last4: "4242" }));
    expect(c.setPaymentMethod).not.toHaveBeenCalled(); expect(controller().setPaymentMethod).not.toHaveBeenCalled();
    expect(controller().quoteTip).not.toHaveBeenCalled(); expect(mocks.confirmCard).not.toHaveBeenCalled();
  });
  it("uses the real wrapper operation closures with authenticated Company/user/Job IDs and saves only a protected pointer", async () => {
    await render(); const operations = input().operations!; const companyId = props.session.company!.id;
    expect(await operations.load({ companyId, jobId: 12 })).toBeNull(); expect(mocks.read).toHaveBeenCalledWith(companyId, 42, 12);
    const key = await operations.generateKey(); expect(mocks.pointer).toHaveBeenCalledWith(companyId, 42, 12);
    await operations.save({ companyId, jobId: 12, operationKey: key });
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    const saved = mocks.reserve.mock.calls[0][0];
    expect(saved).toEqual({ version: 1, companyId, userId: 42, jobId: 12, operationKey: POINTER_KEY, createdAt: "2026-11-17T00:00:00.000Z" });
    expect(Object.keys(saved).sort()).toEqual(["companyId", "createdAt", "jobId", "operationKey", "userId", "version"]);
    for (const privateValue of [PNG, PM, SECRET, props.session.token, "4242424242424242"]) expect(JSON.stringify(saved)).not.toContain(privateValue);
    await expect(operations.save({ companyId, jobId: 13, operationKey: key })).rejects.toThrow();
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    await invoke(() => flow().onClose()); await expect(operations.save({ companyId, jobId: 12, operationKey: key })).rejects.toThrow();
    expect(mocks.reserve).toHaveBeenCalledTimes(1); expect(mocks.removePointer).not.toHaveBeenCalled();
  });
  it("loads an existing pointer as an operation anchor without leaking the protected user ID into controller state", async () => {
    const companyId = props.session.company!.id;
    mocks.read.mockResolvedValue({ version: 1, companyId, userId: 42, jobId: 12, operationKey: POINTER_KEY, createdAt: "2026-11-17T00:00:00.000Z" });
    await render();
    expect(await input().operations!.load({ companyId, jobId: 12 })).toEqual({ companyId, jobId: 12, operationKey: POINTER_KEY });
    expect(mocks.read).toHaveBeenCalledWith(companyId, 42, 12); expect(mocks.reserve).not.toHaveBeenCalled();
    expect(JSON.stringify(flow().state)).not.toContain(POINTER_KEY);
  });
  it("keeps signature pixels in memory and calls only final deliberate controller confirmation, never marks parent paid from SDK success", async () => {
    await render(); await makeCardReady(); await reviewCustomQuote(); const signed = draft();
    await invoke(() => flow().onSignatureChange(signed));
    expect(flow().state.quote).toMatchObject({ serviceAmountText: "$125.25", tipAmountText: "$4.32", totalAmountText: "$129.57" });
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(controller().confirm).not.toHaveBeenCalled();
    await invoke(() => flow().onConfirmPayment({ ...signed, quoteKey: "different-quote" }));
    expect(controller().approveSignature).not.toHaveBeenCalled();
    await invoke(() => flow().onConfirmPayment(signed));
    expect(controller().approveSignature).toHaveBeenCalledWith({ pngDataUrl: PNG }); expect(controller().confirm).toHaveBeenCalledTimes(1);
    const provider = input().provider!;
    await invoke(() => provider.confirm({ clientSecret: SECRET, paymentMethodId: PM, configuration: configured().configuration!, isCurrent: () => true }));
    expect(mocks.confirmCard).toHaveBeenCalledWith(SECRET, PM, expect.any(Function));
    expect(props.onVerifiedDetail).not.toHaveBeenCalled(); expect(flow().state.status).not.toBe("paid");
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(JSON.stringify(flow().state)).not.toContain(SECRET);
    const unpaid = canonical(); await invoke(() => input().onVerifiedDetail?.(unpaid));
    expect(props.onVerifiedDetail).toHaveBeenCalledWith(unpaid); expect(flow().state.status).not.toBe("paid");
  });
  it("rejects provider confirmation when its controller-supplied live guard is false", async () => {
    await render(); await makeCardReady();
    await expect(input().provider!.confirm({ clientSecret: SECRET, paymentMethodId: PM, configuration: configured().configuration!, isCurrent: () => false })).rejects.toThrow();
    expect(mocks.confirmCard).not.toHaveBeenCalled();
  });
  it("rejects an SDK success completion after closing without publishing paid or retaining signature", async () => {
    await render(); await makeCardReady(); await reviewCustomQuote(); await invoke(() => flow().onSignatureChange(draft()));
    const wait = deferred<{ outcome: "succeeded"; intentId: string }>(); mocks.confirmCard.mockReturnValueOnce(wait.promise);
    const pending = input().provider!.confirm({ clientSecret: SECRET, paymentMethodId: PM, configuration: configured().configuration!, isCurrent: () => true }).catch((error: Error) => error);
    await invoke(() => flow().onClose()); await invoke(() => wait.resolve({ outcome: "succeeded", intentId: "pi_RoutingFixtureOnly" }));
    expect(await pending).toBeInstanceOf(Error); expect(flow().state.signature).toBeNull(); expect(props.onVerifiedDetail).not.toHaveBeenCalled();
    expect(mocks.clearCard).toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
  });
});

describe("verified wrapper lifecycle completion regressions", () => {
  function cardNode(node: PhotoTestNode = container): PhotoTestNode | undefined {
    return node.nodeName.toLowerCase() === "secure-card-probe" ? node : node.childNodes.map((child) => cardNode(child)).find(Boolean);
  }
  it("keeps the same secure-card host throughout signature saving, preparation and final confirmation", async () => {
    const base = quoteState().quote!;
    const quote = { ...base, tip: { kind: "none" as const }, tipCents: 0, totalCents: base.principalCents };
    const approvalWait = deferred<any>(); const prepareWait = deferred<any>();
    const transport = {
      capabilities: vi.fn(async () => configured().configuration!), quote: vi.fn(async () => quote),
      approveSignature: vi.fn((..._args: Parameters<NonNullable<CompanyNativeCheckoutControllerInput["nativeTransport"]>["approveSignature"]>) => approvalWait.promise), prepare: vi.fn(() => prepareWait.promise),
      authorizeConfirmation: vi.fn(async (_context, request) => ({ ...request, authorized: true as const, sharedLockHeld: true as const, expiresAt: Date.now() + 60000 })),
      status: vi.fn(async (_context, operationKey) => ({ companyId: props.session.company!.id, jobId: 12, operationKey, state: "unknown" as const })),
    } satisfies NonNullable<CompanyNativeCheckoutControllerInput["nativeTransport"]>;
    mocks.factory.mockImplementation((options: CompanyNativeCheckoutControllerInput) => {
      mocks.inputs.push(options);
      const c = mocks.actualFactory({ ...options, nativeTransport: transport }); mocks.controllers.push(c); return c;
    });
    await render(); await invoke(() => flow().onManualCardEntry());
    await invoke(() => { mocks.cardProps!.onReady(true); mocks.cardProps!.onChange({ complete: true, brand: "Visa", last4: "4242" }); });
    const host = cardNode(); expect(host).toBeDefined();
    await invoke(() => flow().onCardContinue()); await invoke(() => flow().onTipContinue());
    expect(flow().state.step).toBe("signature"); const signed = draft();
    await invoke(() => flow().onSignatureChange(signed)); await invoke(() => flow().onConfirmPayment(signed));
    expect(transport.approveSignature).toHaveBeenCalledTimes(1); expect(cardNode()).toBe(host);
    expect(flow().state.step).toBe("signature"); expect(mocks.cardProps!.disabled).toBe(false);
    const intent = transport.approveSignature.mock.calls[0][1].intent;
    await invoke(() => approvalWait.resolve({ intent, signatureApprovalId: "approval_fixture", privateStored: true }));
    expect(transport.prepare).toHaveBeenCalledTimes(1); expect(cardNode()).toBe(host);
    await invoke(() => prepareWait.resolve({ kind: "prepared", intent, signatureApprovalId: "approval_fixture", paymentIntentId: "pi_RoutingFixtureOnly",
      clientSecret: SECRET, unconfirmed: true, serverReauthorized: true, sharedLockHeld: true }));
    expect(mocks.confirmCard).toHaveBeenCalledTimes(1); expect(cardNode()).toBe(host);
    expect(flow().state.status).toBe("processing"); expect(mocks.removePointer).not.toHaveBeenCalled();
    await invoke(() => flow().onRefreshStatus()); expect(transport.status).toHaveBeenCalledWith(expect.anything(), POINTER_KEY);
    expect(mocks.confirmCard).toHaveBeenCalledTimes(1); expect(mocks.removePointer).not.toHaveBeenCalled();
  });
  it.each(["processing", "unknown", "blocked"] as const)("preserves the card host and original recovery pointer during %s without a paid acknowledgement", async (phase) => {
    await render(); await makeCardReady(); await reviewCustomQuote(); const host = cardNode();
    await input().operations!.generateKey();
    await emit({ ...quoteState(), phase }); expect(flow().state.step).toBe("signature"); expect(cardNode()).toBe(host);
    await invoke(() => flow().onRefreshStatus()); expect(controller().refreshStatus).toHaveBeenCalledTimes(1);
    expect(controller().refresh).toHaveBeenCalledTimes(1); expect(mocks.removePointer).not.toHaveBeenCalled();
    await invoke(() => flow().onClose()); expect(mocks.removePointer).not.toHaveBeenCalled();
  });
  it("rechecks the controller's authorization after wrapper dispatch and rejects it after close", async () => {
    await render(); await makeCardReady(); let authorized = true;
    await input().provider!.confirm({ clientSecret: SECRET, paymentMethodId: PM, configuration: configured().configuration!, isCurrent: () => authorized });
    const guard = mocks.confirmCard.mock.calls[0][2] as () => boolean;
    expect(guard()).toBe(true); authorized = false; expect(guard()).toBe(false);
    authorized = true; await invoke(() => flow().onClose()); expect(guard()).toBe(false);
  });
  it("cleans the loaded original pointer only on actual controller canonical paid/zero-balance readback", async () => {
    const companyId = props.session.company!.id;
    const pointer: CompanyNativePaymentPointer = { version: 1, companyId, userId: 42, jobId: 12, operationKey: POINTER_KEY, createdAt: "2026-11-17T00:00:00.000Z" };
    mocks.read.mockResolvedValue(pointer); mocks.realController = true;
    await render(); expect(mocks.removePointer).not.toHaveBeenCalled();
    mocks.detail.mockImplementation(async () => canonical({ paymentStatus: "paid", balance: 0 }));
    await invoke(() => flow().onRefreshStatus());
    expect(flow().state.status).toBe("paid"); expect(mocks.removePointer).toHaveBeenCalledTimes(1);
    expect(mocks.removePointer).toHaveBeenCalledWith(pointer); expect(mocks.confirmCard).not.toHaveBeenCalled();
  });
  it("paid cleanup refuses a different operation or Company and preserves canonical paid on remove failure", async () => {
    await render(); const ops = input().operations!; const companyId = props.session.company!.id;
    await ops.generateKey();
    await ops.releasePaid!({ companyId, jobId: 12, operationKey: "different-original" }); expect(mocks.removePointer).not.toHaveBeenCalled();
    await expect(ops.releasePaid!({ companyId: companyId + 1, jobId: 12, operationKey: POINTER_KEY })).rejects.toThrow();
    mocks.removePointer.mockResolvedValue(false);
    await expect(ops.releasePaid!({ companyId, jobId: 12, operationKey: POINTER_KEY })).rejects.toThrow();
    expect(mocks.removePointer).toHaveBeenCalledTimes(1);
  });
  it("a reopened epoch is not stuck loading and old tokenization cannot unlock or complete the new epoch", async () => {
    await render(); await makeCardReady(); const old = deferred<any>(); const next = deferred<any>();
    mocks.tokenize.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await invoke(() => flow().onCardContinue()); await invoke(() => flow().onClose());
    await render({ visible: false }); await render({ visible: true }); expect(flow().state.status).not.toBe("loading");
    await makeCardReady(); await invoke(() => flow().onCardContinue()); expect(mocks.tokenize).toHaveBeenCalledTimes(2);
    await invoke(() => old.resolve({ paymentMethodId: PM, brand: "Visa", last4: "4242" }));
    await invoke(() => flow().onCardContinue()); expect(mocks.tokenize).toHaveBeenCalledTimes(2);
    expect(controller().setPaymentMethod).not.toHaveBeenCalled();
    await invoke(() => next.resolve({ paymentMethodId: PM, brand: "Visa", last4: "4242" }));
    expect(controller().setPaymentMethod).toHaveBeenCalledTimes(1); expect(flow().state.status).not.toBe("loading");
  });
});
