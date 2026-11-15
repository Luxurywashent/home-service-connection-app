import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyJobCheckout } from "../components/company-job-checkout";
import type { JobSyncCompanyJobCheckout, JobSyncCompanyJobDetail, JobSyncNativeSession } from "../lib/jobsync-mobile-api";

// Real component, real controller and real effects; only RN hosts, focus and I/O are mocked.
const mocks = vi.hoisted(() => ({
  focused: true, session: vi.fn(), detail: vi.fn(), checkout: vi.fn(), browser: vi.fn(),
  listeners: new Set<(next: string) => void>(), remove: vi.fn(),
}));
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused }));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: mocks.browser }));
vi.mock("@/hooks/use-job-sheet-colors", () => ({ useJobSheetColors: () => ({
  primary: "#4D8DFF", background: "#07111F", surface: "#102038", border: "#243754",
  foreground: "#F6F8FC", muted: "#94A3B8", error: "#F06A6A", success: "#52D3B8",
}) }));
vi.mock("../lib/jobsync-mobile-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/jobsync-mobile-api")>(),
  getJobSyncMobileSession: mocks.session, getJobSyncCompanyJobDetail: mocks.detail,
  createJobSyncCompanyJobCheckout: mocks.checkout,
}));
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, unknown>) => R.createElement(name, {
    ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
  }, props.children as React.ReactNode);
  return {
    ActivityIndicator: host("activity-indicator"), Modal: host("native-modal"), Text: host("native-text"),
    TouchableOpacity: host("native-touch"), View: host("native-view"), TextInput: host("native-input"),
    StyleSheet: { create: (value: unknown) => value },
    AppState: { addEventListener: (_name: string, listener: (next: string) => void) => {
      mocks.listeners.add(listener);
      return { remove: () => { mocks.remove(); mocks.listeners.delete(listener); } };
    } },
  };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
type Props = React.ComponentProps<typeof CompanyJobCheckout>;
const session = (): JobSyncNativeSession => ({
  token: "ui-checkout-fixture-token", portal: "company",
  user: { id: 42, role: "owner", name: "Test Owner", email: null, paymentCollectionEnabled: true },
  company: { id: 9, name: "Test Company", slug: "test", logoUrl: null, primaryColor: null, accentColor: null },
});
const detail = (patch: Partial<JobSyncCompanyJobDetail> = {}): JobSyncCompanyJobDetail => ({
  id: 12, companyId: 9, status: "scheduled", amount: 999, paidTotal: 250,
  balance: 125.25, paymentStatus: "partial", photos: [], persistedPhotoIds: [], ...patch,
} as JobSyncCompanyJobDetail);
const checkout = (patch: Partial<JobSyncCompanyJobCheckout> = {}): JobSyncCompanyJobCheckout => ({
  url: "https://checkout.stripe.com/c/pay/cs_test_UiFixtureOnly", amountCents: 12525,
  attemptId: 7, attemptStatus: "pending", checkoutState: "open", reused: false, ...patch,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let props: Props;
let unmounted: boolean;
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function nodes(name: string) { return all().filter((node) => node.nodeName.toLowerCase() === name); }
function button(label: string) {
  const found = nodes("native-touch").find((node) => node.nativeProps.accessibilityLabel === label);
  if (!found) throw new Error(`Missing ${label}; text=${container.textContent}`);
  return found;
}
function style(node: NativeNode) {
  const flatten = (value: any): any => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value || {};
  return flatten(node.nativeProps.style);
}
async function render(patch: Partial<Props> = {}) {
  props = { ...props, ...patch }; await act(async () => { root.render(<CompanyJobCheckout {...props} />); });
}
async function press(node: NativeNode) { await act(async () => { node.nativeProps.onPress(); }); }
async function foreground(next = "active") { await act(async () => { for (const listener of [...mocks.listeners]) listener(next); }); }
async function unmount() { await act(async () => { root.unmount(); }); unmounted = true; }
beforeEach(() => {
  vi.resetAllMocks(); mocks.focused = true; mocks.listeners.clear(); unmounted = false;
  mocks.session.mockImplementation(async () => session()); mocks.detail.mockImplementation(async () => detail());
  mocks.checkout.mockImplementation(async () => checkout()); mocks.browser.mockResolvedValue({ type: "cancel" });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden in UI tests")));
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  props = { visible: true, session: session(), jobId: 12, customerName: "Test Customer", isCurrent: () => true,
    onClose: vi.fn(), onVerifiedDetail: vi.fn() };
});
afterEach(async () => { if (!unmounted) await unmount(); vi.unstubAllGlobals(); });

describe("Company hosted checkout dialog (real ReactDOM)", () => {
  it("does not mount a loading child or request when hidden, unfocused or missing a Company scope", async () => {
    for (const patch of [{ visible: false }, { session: null }, { jobId: null }, { jobId: 0 }] as Partial<Props>[]) {
      await render({ visible: true, session: session(), jobId: 12, ...patch }); expect(container.textContent).toBe("");
    }
    mocks.focused = false; await render({ visible: true, session: session(), jobId: 12 });
    expect(container.textContent).toBe(""); expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled(); expect(mocks.listeners.size).toBe(0);
  });
  it("does not request or grant retained presses when the parent's captured epoch is already false", async () => {
    await render({ isCurrent: () => false });
    await press(button("Open secure card checkout")); await press(button("Refresh payment status")); await press(button("Close payment collection"));
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.detail).not.toHaveBeenCalled(); expect(mocks.checkout).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled(); expect(props.onVerifiedDetail).not.toHaveBeenCalled(); expect(mocks.browser).not.toHaveBeenCalled();
  });
  it("shows a centered named customer dialog with canonical balance and no raw card entry", async () => {
    await render(); expect(container.textContent).toContain("Collect Payment"); expect(container.textContent).toContain("Test Customer");
    expect(container.textContent).toContain("Balance Due$125.25"); expect(container.textContent).not.toContain("$999.00");
    expect(nodes("native-modal")[0].nativeProps).toMatchObject({ visible: true, transparent: true, animationType: "fade" });
    const backdrop = nodes("native-modal")[0].childNodes[0] as NativeNode;
    expect(style(backdrop)).toMatchObject({ justifyContent: "center", position: "absolute", backgroundColor: "rgba(0,0,0,0.65)" });
    expect(button("Open secure card checkout").nativeProps).toMatchObject({ accessibilityRole: "button", disabled: false });
    expect(nodes("native-input")).toHaveLength(0); expect(nodes("input")).toHaveLength(0);
    expect(container.textContent).toContain("does not collect or store card numbers"); expect(container.textContent).not.toContain(session().token);
    await render({ presentation: "overlay" }); expect(nodes("native-modal")).toHaveLength(0); expect(container.textContent).toContain("Collect Payment");
  });
  it("disables and dims pay/refresh while fresh session or checkout preparation is pending, with duplicate exclusion", async () => {
    const waiting = deferred<JobSyncNativeSession>(); mocks.session.mockReturnValueOnce(waiting.promise); await render();
    const pay = button("Open secure card checkout");
    expect(pay.nativeProps).toMatchObject({ disabled: true, accessibilityState: { disabled: true } }); expect(style(pay).opacity).toBe(0.45);
    expect(button("Refresh payment status").nativeProps.disabled).toBe(true); expect(nodes("activity-indicator")).toHaveLength(1);
    await press(pay); expect(mocks.session).toHaveBeenCalledTimes(1); expect(mocks.checkout).not.toHaveBeenCalled();
    await act(async () => { waiting.resolve(session()); });
    const creating = deferred<JobSyncCompanyJobCheckout>(); mocks.checkout.mockReturnValueOnce(creating.promise);
    const ready = button("Open secure card checkout");
    await act(async () => { ready.nativeProps.onPress(); ready.nativeProps.onPress(); });
    expect(mocks.checkout).toHaveBeenCalledTimes(1); expect(button("Open secure card checkout").nativeProps.disabled).toBe(true);
    expect(container.textContent).toContain("Opening checkout"); expect(mocks.browser).not.toHaveBeenCalled();
    await act(async () => { creating.resolve(checkout()); }); expect(mocks.browser).toHaveBeenCalledTimes(1);
  });
  it("blocks technician and a live disabled dispatcher, without offering a collect action", async () => {
    for (const role of ["technician", "dispatcher"] as const) {
      const actor = session(); actor.user.role = role;
      const fresh = structuredClone(actor); fresh.user.paymentCollectionEnabled = role === "technician";
      mocks.session.mockResolvedValue(fresh); await render({ session: actor });
      expect(nodes("native-touch").some((node) => /secure card checkout/.test(node.nativeProps.accessibilityLabel))).toBe(false);
      expect(container.textContent).toContain(role === "technician" ? "Company owner" : "does not have payment collection permission");
    }
    expect(mocks.checkout).not.toHaveBeenCalled(); expect(mocks.browser).not.toHaveBeenCalled();
  });
  it("keeps live role demotion explicit instead of using a cached owner permission", async () => {
    const fresh = session(); fresh.user.role = "technician"; mocks.session.mockResolvedValue(fresh); await render();
    expect(container.textContent).toContain("sign-in changed");
    expect(button("Open secure card checkout").nativeProps.disabled).toBe(true);
    expect(mocks.detail).not.toHaveBeenCalled(); expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it("processing attempt disables collection but leaves refresh available and never launches browser", async () => {
    mocks.checkout.mockResolvedValue(checkout({ url: null, checkoutState: "processing", attemptStatus: "processing", reused: true }));
    await render(); await press(button("Open secure card checkout"));
    const old = button("Continue secure card checkout"); expect(old.nativeProps.disabled).toBe(true); expect(style(old).opacity).toBe(0.45);
    expect(button("Refresh payment status").nativeProps.disabled).toBe(false); expect(container.textContent).toContain("do not collect a second payment");
    await press(old); await press(button("Refresh payment status")); await press(old);
    expect(mocks.checkout).toHaveBeenCalledTimes(1); expect(mocks.browser).not.toHaveBeenCalled();
  });
  it("foreground refresh waits for a known checkout then confirms only fresh canonical payment state", async () => {
    await render(); const initialReads = mocks.detail.mock.calls.length; await foreground("active");
    expect(mocks.detail).toHaveBeenCalledTimes(initialReads);
    await press(button("Open secure card checkout")); const before = mocks.detail.mock.calls.length;
    await foreground("background"); expect(mocks.detail).toHaveBeenCalledTimes(before);
    expect(container.textContent).toContain("$125.25"); expect(container.textContent).not.toContain("Payment confirmed");
    mocks.detail.mockResolvedValue(detail({ balance: 0, paymentStatus: "paid" })); await foreground();
    expect(mocks.detail).toHaveBeenCalledTimes(before + 1); expect(container.textContent).toContain("$0.00");
    expect(container.textContent).toContain("Payment confirmed by your Company's payment records");
    expect(nodes("native-touch").some((node) => /secure card checkout/.test(node.nativeProps.accessibilityLabel))).toBe(false);
    expect(mocks.checkout).toHaveBeenCalledTimes(1); expect(props.onVerifiedDetail).toHaveBeenLastCalledWith(expect.objectContaining({ balance: 0, paymentStatus: "paid" }));
    expect(fetch).not.toHaveBeenCalled();
  });
  it("browser failure surfaces honestly, can refresh, and continues the original checkout without another POST", async () => {
    mocks.browser.mockRejectedValueOnce(new Error("Fixture browser failed")); await render(); await press(button("Open secure card checkout"));
    expect(nodes("native-text").find((node) => node.nativeProps.accessibilityRole === "alert")?.textContent).toBe("Fixture browser failed");
    expect(button("Refresh payment status").nativeProps.disabled).toBe(false); await press(button("Refresh payment status"));
    await press(button("Continue secure card checkout")); expect(mocks.checkout).toHaveBeenCalledTimes(1); expect(mocks.browser).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Payment confirmed");
  });
  it("close/reopen rejects retained pay/refresh/close callbacks and pending completion from the previous dialog", async () => {
    await render(); const pay = button("Open secure card checkout"); const refresh = button("Refresh payment status"); const close = button("Close payment collection");
    const waiting = deferred<JobSyncCompanyJobCheckout>(); mocks.checkout.mockReturnValueOnce(waiting.promise);
    await press(pay); await press(close); expect(props.onClose).toHaveBeenCalledTimes(1); await render({ visible: false });
    expect(mocks.remove).toHaveBeenCalledTimes(1); expect(mocks.listeners.size).toBe(0);
    await render({ visible: true }); const reads = mocks.session.mock.calls.length; const verified = vi.mocked(props.onVerifiedDetail).mock.calls.length;
    await press(pay); await press(refresh); await press(close); await act(async () => { waiting.resolve(checkout()); });
    expect(mocks.session).toHaveBeenCalledTimes(reads); expect(props.onVerifiedDetail).toHaveBeenCalledTimes(verified);
    expect(props.onClose).toHaveBeenCalledTimes(1); expect(mocks.checkout).toHaveBeenCalledTimes(1); expect(mocks.browser).not.toHaveBeenCalled();
    expect(button("Open secure card checkout").nativeProps.disabled).toBe(false);
  });
  it("unmount removes AppState subscription and rejects retained callbacks and late browser returns", async () => {
    const browser = deferred<unknown>(); mocks.browser.mockReturnValueOnce(browser.promise); await render();
    const pay = button("Open secure card checkout"); const refresh = button("Refresh payment status"); const close = button("Close payment collection");
    const listener = [...mocks.listeners][0]; await press(pay); const verified = vi.mocked(props.onVerifiedDetail).mock.calls.length; const reads = mocks.session.mock.calls.length;
    await unmount(); await press(pay); await press(refresh); await press(close);
    await act(async () => { listener("active"); browser.resolve({ type: "success" }); });
    expect(mocks.listeners.size).toBe(0); expect(mocks.remove).toHaveBeenCalledTimes(1); expect(mocks.session).toHaveBeenCalledTimes(reads);
    expect(props.onVerifiedDetail).toHaveBeenCalledTimes(verified); expect(props.onClose).not.toHaveBeenCalled(); expect(mocks.checkout).toHaveBeenCalledTimes(1);
  });
  it("scope changes and blur discard pending creation before navigation or verified callbacks", async () => {
    for (const change of ["token", "Company", "Job", "user", "role", "focus", "parent"] as const) {
      mocks.focused = true; mocks.session.mockImplementation(async () => session()); mocks.detail.mockImplementation(async () => detail());
      await render({ visible: false }); await render({ visible: true, session: session(), jobId: 12, isCurrent: () => true });
      const pay = button("Open secure card checkout"); const waiting = deferred<JobSyncCompanyJobCheckout>(); mocks.checkout.mockReturnValueOnce(waiting.promise); await press(pay);
      const actor = session(); let jobId = 12; let isCurrent = () => true;
      if (change === "token") actor.token = "rotated-ui-fixture";
      if (change === "Company") actor.company!.id = 10;
      if (change === "Job") jobId = 13;
      if (change === "user") actor.user.id = 43;
      if (change === "role") actor.user.role = "technician";
      if (change === "focus") mocks.focused = false;
      if (change === "parent") isCurrent = () => false;
      await render({ session: actor, jobId, isCurrent }); const verified = vi.mocked(props.onVerifiedDetail).mock.calls.length;
      const posts = mocks.checkout.mock.calls.length; await press(pay); await act(async () => { waiting.resolve(checkout()); });
      expect(mocks.browser).not.toHaveBeenCalled(); expect(mocks.checkout).toHaveBeenCalledTimes(posts); expect(props.onVerifiedDetail).toHaveBeenCalledTimes(verified);
    }
  });
});
