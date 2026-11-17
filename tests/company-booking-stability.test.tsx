import React, { act } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyCreateJobSheet, type CompanyCreateJobSheetProps } from "../components/company-create-job-sheet";
import type { JobSyncNativeSession } from "../lib/jobsync-mobile-api";

const mocks = vi.hoisted(() => ({ platform: "web", focused: true, signed: vi.fn(), settings: vi.fn(), customers: vi.fn(), refresh: vi.fn(), quote: vi.fn(), create: vi.fn(), operation: vi.fn() }));
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ background: "#07111F", surface: "#102038", foreground: "#f6f8fc", muted: "#94a3b8", border: "#243754", primary: "#4d8dff", error: "#bb0000" }) }));
vi.mock("@/hooks/use-company-price-book", () => ({ useCompanyPriceBook: () => ({ services: [{ serviceId: "31", name: "Returned long service name with description", description: "Returned catalog description", features: [], vehiclePrices: {}, basePrice: 125, defaultDurationMinutes: 45 }], isLoading: false, hasLoaded: true, error: null, refresh: mocks.refresh }) }));
vi.mock("@/hooks/use-company-fieldwork-calendar", () => ({ useCompanyFieldworkCalendar: () => ({ members: [], loading: false, error: null, verifyAssignment: vi.fn() }) }));
vi.mock("../lib/company-job-creation-storage", async () => (await import("./helpers/company-creation-memory-store")).memoryCreationStorageModule());
vi.mock("../lib/jobsync-mobile-api", async original => ({ ...await original<typeof import("../lib/jobsync-mobile-api")>(), getJobSyncMobileSession: mocks.signed, getJobSyncCompanySettings: mocks.settings, getJobSyncCompanyCustomers: mocks.customers, quoteJobSyncCompanyJob: mocks.quote, createJobSyncCompanyJob: mocks.create, getJobSyncCompanyJobCreationOperation: mocks.operation }));
vi.mock("@react-native-community/datetimepicker", () => ({ default: () => null }));
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => R.createElement(name, { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; } }, props.children);
  return { Modal: host("native-modal"), View: host("native-view"), Text: host("native-text"), TextInput: host("native-input"), TouchableOpacity: host("native-touch"), ActivityIndicator: host("native-activity"), ScrollView: host("native-scroll"), KeyboardAvoidingView: host("native-keyboard"), FlatList: (props: Record<string, any>) => R.createElement("native-list", { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; } }, props.data.map((item: unknown, index: number) => R.createElement(R.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index })))), AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) }, Keyboard: { addListener: () => ({ remove: vi.fn() }) }, Platform: { get OS() { return mocks.platform; } }, StyleSheet: { create: (styles: unknown) => styles } };
});
const nativeRequire = createRequire(import.meta.url);
const { createRoot } = nativeRequire("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
const safeAreaPath = nativeRequire.resolve("react-native-safe-area-context");
const originalSafeArea = nativeRequire.cache[safeAreaPath];
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let props: CompanyCreateJobSheetProps;
let sequence = 890000;
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap(child => all(child))]; }
function byId(id: string) { const found = all().find(node => node.nativeProps?.testID === id); if (!found) throw new Error(`Missing ${id}`); return found; }
function control(label: string) { const found = all().find(node => node.nativeProps?.accessibilityLabel === label); if (!found) throw new Error(`Missing ${label}`); return found; }
function style(node: NativeNode) { return Object.assign({}, ...[node.nativeProps.style].flat().filter(Boolean)); }
async function render(patch: Partial<CompanyCreateJobSheetProps> = {}) { props = { ...props, ...patch }; await act(async () => root.render(<CompanyCreateJobSheet {...props} />)); }
async function press(label: string) { await act(async () => control(label).nativeProps.onPress()); }
async function input(label: string, value: string) { await act(async () => control(label).nativeProps.onChangeText(value)); }
beforeEach(() => {
  vi.resetAllMocks(); mocks.platform = "web"; mocks.focused = true;
  nativeRequire.cache[safeAreaPath] = { id: safeAreaPath, filename: safeAreaPath, loaded: true, exports: { SafeAreaView: (safeProps: Record<string, any>) => React.createElement("native-safe-area", { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = safeProps; } }, safeProps.children) } } as NodeModule;
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  const session: JobSyncNativeSession = { token: `offline-stability-${++sequence}`, portal: "company", user: { id: sequence, name: "Owner", role: "owner", email: null }, company: { id: 9, name: "Company", slug: "company", logoUrl: null, primaryColor: null, accentColor: null } };
  props = { visible: true, session, initialDate: "2026-12-01", isCurrent: () => true, onClose: vi.fn(), onCreated: vi.fn() };
  mocks.signed.mockResolvedValue(session); mocks.settings.mockResolvedValue({ id: 9, timezone: "America/Chicago" }); mocks.customers.mockResolvedValue([]); mocks.refresh.mockResolvedValue(undefined);
  mocks.quote.mockRejectedValue(new Error("Offline quote unavailable"));
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden")));
});
afterEach(async () => {
  await act(async () => root.unmount()); expect(fetch).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  if (originalSafeArea) nativeRequire.cache[safeAreaPath] = originalSafeArea; else delete nativeRequire.cache[safeAreaPath];
});

describe("bounded Company booking stability — React props, not native-device verification", () => {
  it.each(["ios", "android", "web"])("has one keyboard sizing owner on %s", async platform => {
    mocks.platform = platform; await render();
    const keyboard = all().find(node => node.nodeName === "NATIVE-KEYBOARD")!;
    expect(keyboard.nativeProps.enabled).toBe(platform === "ios");
    expect(keyboard.nativeProps.behavior).toBe(platform === "ios" ? "padding" : undefined);
    expect(byId("company-booking-main-scroll").nativeProps).toMatchObject({ horizontal: false, automaticallyAdjustKeyboardInsets: false, keyboardShouldPersistTaps: "handled", keyboardDismissMode: "on-drag" });
  });
  it.each(["ios", "android"])("uses installed safe-area maximum bottom edges for both action bars on %s", async platform => {
    mocks.platform = platform; await render();
    expect(byId("company-booking-viewport").nodeName).toBe("NATIVE-SAFE-AREA");
    expect(byId("company-booking-viewport").nativeProps.edges).toEqual(["top", "left", "right"]);
    expect(byId("company-booking-footer").nativeProps.edges).toEqual({ bottom: "maximum" });
    expect(style(byId("company-booking-footer")).paddingBottom).toBe(28);
    await press("Choose Service");
    expect(byId("company-booking-pricebook-footer").nativeProps.edges).toEqual({ bottom: "maximum" });
    expect(style(byId("company-booking-pricebook-footer")).paddingBottom).toBe(20);
  });
  it("keeps header and footer outside the sole main scrolling body with nonshrinking chrome", async () => {
    await render();
    const scroll = byId("company-booking-main-scroll");
    const footer = byId("company-booking-footer");
    const header = control("Close Add Job").parentNode as NativeNode;
    expect(scroll.parentNode).toBe(footer.parentNode); expect(scroll.parentNode).toBe(header.parentNode);
    expect(scroll.contains(footer)).toBe(false); expect(scroll.contains(header)).toBe(false);
    expect(style(header).flexShrink).toBe(0); expect(style(footer).flexShrink).toBe(0);
    expect(style(scroll)).toMatchObject({ flex: 1, minHeight: 0, minWidth: 0 });
    expect(style(byId("company-booking-sheet"))).toMatchObject({ height: "92%", maxHeight: "100%", minHeight: 0, flexShrink: 1, width: "100%", maxWidth: 640, overflow: "hidden" });
    expect(style(byId("company-booking-viewport"))).toMatchObject({ flex: 1, minHeight: 0, minWidth: 0 });
  });
  it("keeps picker list bounded and action chrome outside it without resizing the parent sheet", async () => {
    await render(); const sheet = byId("company-booking-sheet"); const originalStyle = style(sheet);
    await press("Choose Service"); await input("Search Price Book services", "Returned");
    const list = byId("company-booking-pricebook-list"); const footer = byId("company-booking-pricebook-footer");
    expect(list.contains(footer)).toBe(false); expect(list.parentNode).toBe(footer.parentNode);
    expect(style(list)).toMatchObject({ flex: 1, minHeight: 0, minWidth: 0 }); expect(style(footer).flexShrink).toBe(0);
    expect(style(control("Search Price Book services"))).toMatchObject({ flexShrink: 0, minWidth: 0 });
    expect(byId("company-booking-sheet")).toBe(sheet); expect(style(sheet)).toEqual(originalStyle);
  });
  it("preserves long form values and the same sheet through disclosure, picker cancellation and rerender", async () => {
    await render(); await press("New Customer"); await input("First name (required)", "Retained"); await input("Last name (required)", "Customer");
    await input("Email (optional)", "long.returned.customer.address@example.invalid"); await press("More Details"); await input("Service notes", "Retained service notes");
    const sheet = byId("company-booking-sheet"); const close = control("Close Add Job").nativeProps.onPress;
    await press("Choose Service"); await press("Cancel service selection"); await press("More Details"); await render(); await press("More Details");
    expect(byId("company-booking-sheet")).toBe(sheet); expect(control("First name (required)").nativeProps.value).toBe("Retained"); expect(control("Service notes").nativeProps.value).toBe("Retained service notes");
    await render({ isCurrent: () => false }); await act(async () => close()); expect(props.onClose).not.toHaveBeenCalled();
  });
  it("retains wrap and width bounds for paired controls and date/time without orientation or global configuration changes", async () => {
    await render(); expect(style(byId("company-booking-time-row"))).toMatchObject({ flexWrap: "wrap", gap: 8 });
    expect(style(control("Service address")).minWidth).toBe(0);
    const timeSource = readFileSync(new URL("../components/company-booking-time-field.tsx", import.meta.url), "utf8");
    expect(timeSource).toContain('maxWidth: "100%"'); expect(timeSource).toContain('minWidth: 0'); expect(timeSource).toContain('boxSizing: "border-box"');
    const source = readFileSync(new URL("../components/company-create-job-sheet.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("useWindowDimensions"); expect(source).not.toContain("Keyboard.addListener"); expect(source).toContain('flexShrink: 0');
  });
});
