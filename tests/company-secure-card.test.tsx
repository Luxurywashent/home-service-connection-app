import React, { act, createRef } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanySecureCardField as NativeCardField } from "../components/company-secure-card-field.native";
import { CompanySecureCardField as WebCardField } from "../components/company-secure-card-field.web";
import { secureCardMessage, type CompanySecureCardConfiguration, type CompanySecureCardHandle, type CompanySecureCardProps } from "../lib/company-secure-card";
import config from "../app.config";

// Real React/ReactDOM, component effects, refs and process queue. Only SDK and RN hosts are mocked.
const mocks = vi.hoisted(() => ({ init: vi.fn(), tokenize: vi.fn(), confirm: vi.fn(), clear: vi.fn(), fetch: vi.fn() }));
vi.mock("@/hooks/use-job-sheet-colors", () => ({ useJobSheetColors: () => ({
  background: "#07111F", foreground: "#F6F8FC", muted: "#94A3B8", border: "#243754", error: "#F06A6A",
}) }));
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, unknown>) => R.createElement(name, {
    ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
  }, props.children as React.ReactNode);
  return { View: host("native-view"), Text: host("native-text"), TextInput: host("native-input"),
    StyleSheet: { create: (value: unknown) => value } };
});
vi.mock("@stripe/stripe-react-native", async () => {
  const R = await import("react");
  return {
    initStripe: mocks.init, createPaymentMethod: mocks.tokenize, confirmPayment: mocks.confirm,
    CardField: R.forwardRef(function MockSDKCardField(props: Record<string, unknown>, ref) {
      R.useImperativeHandle(ref, () => ({ clear: mocks.clear, focus: vi.fn(), blur: vi.fn() }), []);
      return R.createElement("sdk-card-field", {
        ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
      });
    }),
  };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
const CLIENT_SECRET = "pi_FixtureOnly_secret_SecretFixtureOnly";
const PAN = "4242424242424242";
const CVC = "123";
const SENSITIVE = `${CLIENT_SECRET} PAN=${PAN} CVC=${CVC}`;
const configuration = (mode: "live" | "test" = "test", accountId = "acct_Company9"): CompanySecureCardConfiguration => ({
  publishableKey: `pk_${mode}_FixtureOnly`, accountId, mode,
});
const input = (patch: Partial<CompanySecureCardProps> = {}): CompanySecureCardProps => ({
  configuration: configuration(), scopeKey: "company9/job12/checkout1", isCurrent: () => true,
  disabled: false, onReady: vi.fn(), onChange: vi.fn(), ...patch,
});
// PaymentMethod.liveMode and PaymentIntent.livemode intentionally match the installed SDK's exact signatures.
const tokenResult = (patch: Record<string, unknown> = {}) => ({ paymentMethod: {
  id: "pm_FixtureOnly", liveMode: false, Card: { brand: "Visa", last4: "4242" }, ...patch,
} });
const intentResult = (patch: Record<string, unknown> = {}) => ({ paymentIntent: {
  id: "pi_FixtureOnly", livemode: false, status: "Succeeded", ...patch,
} });
let pendingWaits: (() => void)[];
function deferred<T>(cleanupValue: T) {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  pendingWaits.push(() => resolve(cleanupValue));
  return { promise, resolve };
}
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let props: CompanySecureCardProps;
let handle: React.RefObject<CompanySecureCardHandle | null>;
let unmounted: boolean;
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function nodes(name: string) { return all().filter((node) => node.nodeName.toLowerCase() === name); }
async function render(patch: Partial<CompanySecureCardProps> = {}, browser = false) {
  props = { ...props, ...patch };
  await act(async () => { root.render(browser ? <WebCardField key="first" {...props} ref={handle} /> : <NativeCardField key="first" {...props} ref={handle} />); });
}
async function cardChange(details: Record<string, unknown> = { complete: true, brand: "Visa", last4: "4242" }, index = 0) {
  const field = nodes("sdk-card-field")[index];
  if (!field) throw new Error("Missing secure SDK field");
  await act(async () => { field.nativeProps.onCardChange(details); });
}
async function unmount() { await act(async () => { root.unmount(); }); unmounted = true; }
async function settle<T>(wait: ReturnType<typeof deferred<T>>, value: T) { await act(async () => { wait.resolve(value); }); }
async function outcome<T>(action: () => Promise<T>): Promise<T | Error> {
  let result!: T | Error;
  await act(async () => { result = await action().catch((error: Error) => error); });
  return result;
}
function expectOnce(callback: unknown, ...args: unknown[]) {
  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback).toHaveBeenCalledWith(...args);
}
function expectSafe(value: unknown) {
  const text = value instanceof Error ? value.message : JSON.stringify(value);
  expect(text).not.toContain(CLIENT_SECRET);
  expect(text).not.toContain(PAN);
  expect(text).not.toContain(`CVC=${CVC}`);
}
beforeEach(() => {
  vi.resetAllMocks(); pendingWaits = []; unmounted = false;
  mocks.init.mockResolvedValue(undefined); mocks.tokenize.mockResolvedValue(tokenResult()); mocks.confirm.mockResolvedValue(intentResult());
  mocks.fetch.mockRejectedValue(new Error("Network forbidden in secure-card field tests")); vi.stubGlobal("fetch", mocks.fetch);
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  props = input(); handle = createRef<CompanySecureCardHandle>();
});
afterEach(async () => {
  if (!unmounted) await unmount();
  // Never leave the module's process-wide provider queue blocked if an assertion fails.
  await act(async () => { pendingWaits.forEach((resolve) => resolve()); });
  expect(mocks.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

export const SECURE_CARD_TEST_COUNT = 55;

describe("secure card masked native SDK boundary", () => {
  it.each(["test", "live"] as const)("initializes the connected account with validated %s mode key and app return scheme", async (mode) => {
    await render({ configuration: configuration(mode) });
    expectOnce(mocks.init, { publishableKey: `pk_${mode}_FixtureOnly`, stripeAccountId: "acct_Company9",
      urlScheme: "homeserviceconnection", setReturnUrlSchemeOnAndroid: true });
    expectOnce(props.onReady, true);
    expect(nodes("sdk-card-field")).toHaveLength(1);
    expect(nodes("sdk-card-field")[0].nativeProps).toMatchObject({ dangerouslyGetFullCardDetails: false, postalCodeEnabled: true });
    expect(nodes("native-input")).toHaveLength(0); expect(nodes("input")).toHaveLength(0);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("copies only complete/brand/last4 when the event contains PAN, CVC and other full details", async () => {
    await render(); await cardChange({ complete: true, brand: "Visa", last4: "4242", number: PAN, cvc: CVC,
      expiryMonth: 12, expiryYear: 2030, postalCode: "12345", validNumber: "Valid", nested: { number: PAN } });
    expectOnce(props.onChange, { complete: true, brand: "Visa", last4: "4242" });
    expect(Object.keys(vi.mocked(props.onChange).mock.calls[0][0]).sort()).toEqual(["brand", "complete", "last4"]);
    expectSafe(vi.mocked(props.onChange).mock.calls); expectSafe(container.textContent);
    expect(mocks.tokenize).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it.each([
    { complete: "true", brand: 123, last4: PAN }, { complete: false, brand: null, last4: "123" },
    { complete: undefined, brand: {}, last4: "abcd" }, { complete: true, brand: "Visa", last4: null },
  ])("normalizes malformed masked card metadata %#", async (details) => {
    await render(); await cardChange(details);
    expect(props.onChange).toHaveBeenLastCalledWith({ complete: details.complete === true,
      brand: typeof details.brand === "string" ? details.brand : null, last4: null });
  });
  it("tokenizes only complete cards with the SDK Card signature; never confirms in tokenization", async () => {
    await render();
    expect(await outcome(() => handle.current!.tokenize())).toEqual(new Error(secureCardMessage("incomplete")));
    expect(mocks.tokenize).not.toHaveBeenCalled();
    await cardChange();
    mocks.tokenize.mockResolvedValue(tokenResult({ Card: { brand: "Visa", last4: "4242", number: PAN, cvc: CVC }, raw: SENSITIVE }));
    expect(await outcome(() => handle.current!.tokenize())).toEqual({ paymentMethodId: "pm_FixtureOnly", brand: "Visa", last4: "4242" });
    expectOnce(mocks.tokenize, { paymentMethodType: "Card" });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it.each([
    { id: "pm_Invalid-hyphen" }, { id: "pi_NotPaymentMethod" }, { liveMode: true }, { liveMode: undefined },
  ])("fails closed on invalid token identifier or mismatched SDK mode %#", async (patch) => {
    await render(); await cardChange(); mocks.tokenize.mockResolvedValue(tokenResult(patch));
    expect(await outcome(() => handle.current!.tokenize())).toEqual(new Error(secureCardMessage("tokenization")));
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("allows live tokenization only with SDK liveMode true and sanitizes token metadata", async () => {
    await render({ configuration: configuration("live") }); await cardChange();
    mocks.tokenize.mockResolvedValue(tokenResult({ liveMode: true, Card: { brand: 42, last4: PAN } }));
    expect(await outcome(() => handle.current!.tokenize())).toEqual({ paymentMethodId: "pm_FixtureOnly", brand: null, last4: null });
  });
  it("sanitizes returned SDK tokenization errors", async () => {
    await render(); await cardChange(); mocks.tokenize.mockResolvedValue({ error: { code: "Failed", message: SENSITIVE } });
    const result = await outcome(() => handle.current!.tokenize());
    expectSafe(result); expect(result).toEqual(new Error(secureCardMessage("tokenization")));
  });
  it("sanitizes THROWN tokenization SDK exceptions (no client secret/PAN/CVC escapes)", async () => {
    await render(); await cardChange(); mocks.tokenize.mockRejectedValue(new Error(SENSITIVE));
    const result = await outcome(() => handle.current!.tokenize());
    expectSafe(result); expect(result).toEqual(new Error(secureCardMessage("tokenization")));
  });
  it("clears only through the SDK ref and resets masked completeness", async () => {
    await render(); await cardChange(); await act(async () => { handle.current!.clear(); });
    expect(mocks.clear).toHaveBeenCalledTimes(1); expect(props.onChange).toHaveBeenLastCalledWith({ complete: false, brand: null, last4: null });
    expect(await outcome(() => handle.current!.tokenize())).toEqual(new Error(secureCardMessage("incomplete")));
    expect(mocks.tokenize).not.toHaveBeenCalled();
  });
});

describe("validated initialization and stale native lifecycle", () => {
  it.each([
    configuration("live"), { ...configuration(), mode: "live" as const },
    { ...configuration(), publishableKey: "sk_test_NeverASecretKey" },
    { ...configuration(), accountId: "acct_Wrong-account" }, { ...configuration(), accountId: "Company9" },
  ])("fails closed on wrong publishable-key mode or invalid connected account %#", async (invalid) => {
    // The first fixture is deliberately made the reverse mismatch: live key, test mode.
    const value = invalid.publishableKey.startsWith("pk_live_") ? { ...invalid, mode: "test" as const } : invalid;
    await render({ configuration: value });
    expect(mocks.init).not.toHaveBeenCalled(); expectOnce(props.onReady, false);
    expect(nodes("sdk-card-field")).toHaveLength(0);
    expect(nodes("native-text")[0].nativeProps.accessibilityRole).toBe("alert");
    expect(await outcome(() => handle.current!.tokenize())).toBeInstanceOf(Error);
    expect(await outcome(() => handle.current!.confirm(CLIENT_SECRET, "pm_FixtureOnly"))).toBeInstanceOf(Error);
    expect(mocks.tokenize).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("sanitizes initialization exceptions and exposes no card field", async () => {
    mocks.init.mockRejectedValue(new Error(SENSITIVE)); await render();
    expect(container.textContent).toBe(secureCardMessage("unavailable")); expectSafe(container.textContent);
    expectOnce(props.onReady, false); expect(nodes("sdk-card-field")).toHaveLength(0);
  });
  it.each(["scope", "current", "unmount"] as const)("denies late initialization readiness after %s changes", async (change) => {
    const wait = deferred<void>(undefined); mocks.init.mockReturnValueOnce(wait.promise); await render();
    const original = props; const retained = handle.current!;
    if (change === "scope") await render({ scopeKey: "company10/job12/checkout2", configuration: configuration("test", "acct_Company10"), onReady: vi.fn(), onChange: vi.fn() });
    if (change === "current") await render({ isCurrent: () => false });
    if (change === "unmount") await unmount();
    await settle(wait, undefined);
    expect(original.onReady).not.toHaveBeenCalledWith(true);
    expect(await outcome(() => retained.tokenize())).toBeInstanceOf(Error);
    if (change === "scope") {
      expectOnce(props.onReady, true);
      expect(mocks.init).toHaveBeenLastCalledWith(expect.objectContaining({ stripeAccountId: "acct_Company10" }));
    } else expect(nodes("sdk-card-field")).toHaveLength(0);
    expect(mocks.tokenize).not.toHaveBeenCalled();
  });
  it.each(["scope", "current", "unmount"] as const)("denies late tokenization response and retained handle after %s changes", async (change) => {
    await render(); await cardChange(); const retained = handle.current!;
    const wait = deferred(tokenResult()); mocks.tokenize.mockReturnValueOnce(wait.promise);
    let result!: Promise<unknown>; await act(async () => { result = retained.tokenize().catch((error) => error); });
    expect(mocks.tokenize).toHaveBeenCalledTimes(1);
    if (change === "scope") await render({ scopeKey: "company10/job12/checkout2", configuration: configuration("test", "acct_Company10") });
    if (change === "current") await render({ isCurrent: () => false });
    if (change === "unmount") await unmount();
    await settle(wait, tokenResult()); expect(await result).toEqual(new Error(secureCardMessage("expired")));
    expect(await outcome(() => retained.tokenize())).toBeInstanceOf(Error);
    expect(await outcome(() => retained.confirm(CLIENT_SECRET, "pm_FixtureOnly"))).toBeInstanceOf(Error);
    await act(async () => { retained.clear(); }); expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.tokenize).toHaveBeenCalledTimes(1); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("reads current disabled state for retained tokenization and card-change callbacks", async () => {
    await render(); await cardChange(); const retained = handle.current!; const field = nodes("sdk-card-field")[0];
    await render({ disabled: true }); const changes = vi.mocked(props.onChange).mock.calls.length;
    await act(async () => { field.nativeProps.onCardChange({ complete: true, brand: "Visa", last4: "9999", number: PAN }); });
    expect(props.onChange).toHaveBeenCalledTimes(changes);
    expect(await outcome(() => retained.tokenize())).toEqual(new Error(secureCardMessage("expired")));
    expect(mocks.tokenize).not.toHaveBeenCalled();
  });
  it("denies confirmation through a retained current handle when disabled", async () => {
    await render(); const retained = handle.current!; await render({ disabled: true });
    expect(await outcome(() => retained.confirm(CLIENT_SECRET, "pm_FixtureOnly"))).toBeInstanceOf(Error);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});

describe("one native process queue across two company fields", () => {
  it("serializes both initializations and prevents one company using the other's active account", async () => {
    const wait = deferred<void>(undefined); mocks.init.mockReturnValueOnce(wait.promise);
    const other = input({ configuration: configuration("test", "acct_Company10"), scopeKey: "company10/job12/checkout1" });
    const otherHandle = createRef<CompanySecureCardHandle>();
    await act(async () => { root.render(<><NativeCardField key="first" {...props} ref={handle} /><NativeCardField key="second" {...other} ref={otherHandle} /></>); });
    expect(mocks.init).toHaveBeenCalledTimes(1); expect(props.onReady).not.toHaveBeenCalled(); expect(other.onReady).not.toHaveBeenCalled();
    await settle(wait, undefined);
    expect(mocks.init).toHaveBeenCalledTimes(2); expect(nodes("sdk-card-field")).toHaveLength(2);
    await cardChange(undefined, 0); await cardChange(undefined, 1);
    expect(await outcome(() => handle.current!.tokenize())).toEqual(new Error(secureCardMessage("unavailable")));
    expect(await outcome(() => handle.current!.confirm(CLIENT_SECRET, "pm_FixtureOnly"))).toBeInstanceOf(Error);
    expect(mocks.tokenize).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
    expect(await outcome(() => otherHandle.current!.tokenize())).toMatchObject({ paymentMethodId: "pm_FixtureOnly" });
    expect(mocks.tokenize).toHaveBeenCalledTimes(1);
  });
  it.each(["tokenize", "confirm"] as const)("does not initialize another account while first %s is pending", async (operation) => {
    await render(); await cardChange();
    const wait = deferred<any>(operation === "tokenize" ? tokenResult() : intentResult());
    (operation === "tokenize" ? mocks.tokenize : mocks.confirm).mockReturnValueOnce(wait.promise);
    const retained = handle.current!; let result!: Promise<unknown>;
    await act(async () => { result = (operation === "tokenize" ? retained.tokenize() : retained.confirm(CLIENT_SECRET, "pm_FixtureOnly")).catch((error) => error); });
    const other = input({ configuration: configuration("test", "acct_Company10"), scopeKey: "company10/job12/checkout1" });
    const otherHandle = createRef<CompanySecureCardHandle>();
    await act(async () => { root.render(<><NativeCardField key="first" {...props} ref={handle} /><NativeCardField key="second" {...other} ref={otherHandle} /></>); });
    expect(mocks.init).toHaveBeenCalledTimes(1); expect(other.onReady).not.toHaveBeenCalled();
    await settle(wait, operation === "tokenize" ? tokenResult() : intentResult());
    expect(await result).toMatchObject(operation === "tokenize" ? { paymentMethodId: "pm_FixtureOnly" } : { outcome: "succeeded", intentId: "pi_FixtureOnly" });
    expect(mocks.init).toHaveBeenCalledTimes(2); expectOnce(other.onReady, true);
    expect(await outcome(() => retained.tokenize())).toEqual(new Error(secureCardMessage("unavailable")));
    expect(await outcome(() => retained.confirm(CLIENT_SECRET, "pm_FixtureOnly"))).toBeInstanceOf(Error);
    expect(operation === "tokenize" ? mocks.tokenize : mocks.confirm).toHaveBeenCalledTimes(1);
  });
});

describe("final native confirmation guard and outcome-only contract", () => {
  it.each([
    ["bad-secret", "pm_FixtureOnly"], ["pi_FixtureOnly_secret_Secret-Fixture", "pm_FixtureOnly"],
    [CLIENT_SECRET, "pi_NotPaymentMethod"], [CLIENT_SECRET, "pm_Bad-id"],
  ])("rejects malformed final confirmation IDs before SDK call (%s, %s)", async (secret, paymentMethodId) => {
    await render(); expect(await outcome(() => handle.current!.confirm(secret, paymentMethodId))).toEqual(new Error(secureCardMessage("unavailable")));
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it.each([
    { id: "pi_OtherIntent" }, { livemode: true }, { livemode: undefined },
  ])("returns only unknown for a wrong intent ID or mismatched SDK mode %#", async (patch) => {
    await render(); mocks.confirm.mockResolvedValue(intentResult(patch));
    expect(await outcome(() => handle.current!.confirm(CLIENT_SECRET, "pm_FixtureOnly"))).toEqual({ outcome: "unknown", message: secureCardMessage("confirmation") });
  });
  it.each([
    ["Succeeded", "succeeded"], ["Processing", "processing"], ["RequiresAction", "unknown"], ["Canceled", "unknown"],
  ])("maps SDK %s to %s without declaring the Company's ledger paid", async (status, expected) => {
    await render(); mocks.confirm.mockResolvedValue(intentResult({ status, amount: 12525, clientSecret: CLIENT_SECRET,
      raw: { number: PAN, cvc: CVC }, paymentStatus: "paid", paidTotal: 125.25, balance: 0 }));
    const result = await outcome(() => handle.current!.confirm(CLIENT_SECRET, "pm_FixtureOnly"));
    expect(result).toEqual({ outcome: expected, intentId: "pi_FixtureOnly" }); expectSafe(result);
    expect(Object.keys(result).sort()).toEqual(["intentId", "outcome"]);
    expectOnce(mocks.confirm, CLIENT_SECRET, { paymentMethodType: "Card", paymentMethodData: { paymentMethodId: "pm_FixtureOnly" } });
    expect(mocks.tokenize).not.toHaveBeenCalled();
  });
  it("uses the exact live PaymentIntent.livemode guard", async () => {
    await render({ configuration: configuration("live") });
    expect(await outcome(() => handle.current!.confirm(CLIENT_SECRET, "pm_FixtureOnly"))).toMatchObject({ outcome: "unknown" });
    mocks.confirm.mockResolvedValue(intentResult({ livemode: true }));
    expect(await outcome(() => handle.current!.confirm(CLIENT_SECRET, "pm_FixtureOnly"))).toEqual({ outcome: "succeeded", intentId: "pi_FixtureOnly" });
  });
  it.each([["Canceled", "canceled"], ["Failed", "unknown"]])("sanitizes returned SDK %s error as %s", async (code, expected) => {
    await render(); mocks.confirm.mockResolvedValue({ error: { code, message: SENSITIVE, localizedMessage: SENSITIVE } });
    const result = await outcome(() => handle.current!.confirm(CLIENT_SECRET, "pm_FixtureOnly"));
    expectSafe(result); expect(result).toEqual({ outcome: expected, message: secureCardMessage("confirmation") });
  });
  it("sanitizes THROWN confirmation SDK exceptions (no client secret/PAN/CVC escapes)", async () => {
    await render(); mocks.confirm.mockRejectedValue(new Error(SENSITIVE));
    const result = await outcome(() => handle.current!.confirm(CLIENT_SECRET, "pm_FixtureOnly"));
    expectSafe(result);
    expect(result instanceof Error ? result.message : (result as { message?: string }).message).toBe(secureCardMessage("confirmation"));
  });
  it.each(["scope", "current", "unmount"] as const)("downgrades a late succeeded intent to unknown after %s change", async (change) => {
    await render(); const retained = handle.current!; const wait = deferred(intentResult()); mocks.confirm.mockReturnValueOnce(wait.promise);
    let result!: Promise<unknown>; await act(async () => { result = retained.confirm(CLIENT_SECRET, "pm_FixtureOnly").catch((error) => error); });
    if (change === "scope") await render({ scopeKey: "company10/job12/checkout2", configuration: configuration("test", "acct_Company10") });
    if (change === "current") await render({ isCurrent: () => false });
    if (change === "unmount") await unmount();
    await settle(wait, intentResult()); expect(await result).toEqual({ outcome: "unknown", message: secureCardMessage("confirmation") });
  });
});

describe("browser fallback and minimal native payment plugin", () => {
  it("renders no PAN/CVC input and rejects native-only tokenize/confirm actions without any SDK calls", async () => {
    await render({}, true);
    expect(container.textContent).toContain("browser preview cannot collect card details");
    expectOnce(props.onReady, false); expect(props.onChange).not.toHaveBeenCalled();
    expect(nodes("sdk-card-field")).toHaveLength(0); expect(nodes("native-input")).toHaveLength(0); expect(nodes("input")).toHaveLength(0);
    expect(await outcome(() => handle.current!.tokenize())).toEqual(new Error("Native card collection requires the installed iOS or Android app."));
    expect(await outcome(() => handle.current!.confirm(CLIENT_SECRET, "pm_FixtureOnly"))).toEqual(new Error("Browser previews cannot confirm a native card payment."));
    await act(async () => { handle.current!.clear(); });
    expect(mocks.init).not.toHaveBeenCalled(); expect(mocks.tokenize).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.clear).not.toHaveBeenCalled();
  });
  it("does not report readiness for an already stale browser scope", async () => {
    await render({ isCurrent: () => false }, true); expect(props.onReady).not.toHaveBeenCalled(); expect(props.onChange).not.toHaveBeenCalled();
  });
  it("adds exactly the Stripe native config plugin with Google Pay disabled", () => {
    const plugins = config.plugins?.filter((plugin) => Array.isArray(plugin) && plugin[0] === "@stripe/stripe-react-native");
    expect(plugins).toEqual([["@stripe/stripe-react-native", { enableGooglePay: false }]]);
  });
  it("does not add a Tap to Pay/proximity-reader entitlement", () => {
    const appConfigSource = readFileSync(new URL("../app.config.ts", import.meta.url), "utf8");
    expect(appConfigSource).not.toMatch(/com\.apple\.developer\.proximity-reader|tap[- ]?to[- ]?pay|proximityReader/i);
    expect(JSON.stringify(config.ios?.entitlements ?? {})).not.toMatch(/proximity-reader|tap[- ]?to[- ]?pay/i);
  });
});
