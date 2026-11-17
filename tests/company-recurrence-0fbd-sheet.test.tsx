import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyCreateJobSheet, type CompanyCreateJobSheetProps } from "../components/company-create-job-sheet";
import { type JobSyncNativeSession } from "../lib/jobsync-mobile-api";
vi.mock("../lib/company-job-creation-storage", async () => {
  const { memoryCreationStorageModule } = await import("./helpers/company-creation-memory-store");
  return memoryCreationStorageModule();
});
const mocks = vi.hoisted(() => ({ focused: true, platform: "web", background: "#ffffff", signed: vi.fn(), customers: vi.fn(), customer: vi.fn(), settings: vi.fn(), quote: vi.fn(), create: vi.fn(), detail: vi.fn(), jobs: vi.fn(), operation: vi.fn(), priceBook: vi.fn(), refresh: vi.fn(), verify: vi.fn(), catalog: [] as any[], hasLoaded: true, loading: false, error: null as string | null }));
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ foreground: "#111111", background: mocks.background, surface: "#eeeeee", border: "#dddddd", primary: "#0077cc", muted: "#555555", error: "#bb0000" }) }));
vi.mock("@/hooks/use-company-price-book", () => ({ useCompanyPriceBook: () => ({ services: mocks.catalog, isLoading: mocks.loading, error: mocks.error, hasLoaded: mocks.hasLoaded, refresh: mocks.refresh }) }));
vi.mock("@/hooks/use-company-fieldwork-calendar", () => ({ useCompanyFieldworkCalendar: () => ({ members: [{ id: 50, name: "Actual Technician", employeeId: "jobsync-50" }], loading: false, error: null, verifyAssignment: mocks.verify }) }));
vi.mock("../lib/jobsync-mobile-api", async (original) => ({ ...await original<typeof import("../lib/jobsync-mobile-api")>(),
  getJobSyncMobileSession: mocks.signed, getJobSyncCompanyCustomers: mocks.customers, getJobSyncCompanyCustomer: mocks.customer,
  getJobSyncCompanySettings: mocks.settings, getHomeServiceConnectedPriceBook: mocks.priceBook,
  quoteJobSyncCompanyJob: mocks.quote, createJobSyncCompanyJob: mocks.create, getJobSyncCompanyJobDetail: mocks.detail, getJobSyncCompanyJobs: mocks.jobs,
  getJobSyncCompanyJobCreationOperation: mocks.operation,
}));
vi.mock("@react-native-community/datetimepicker", async () => {
  const R = await import("react");
  return { default: (props: Record<string, any>) => R.createElement("native-picker", { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; } }) };
});
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => R.createElement(name, { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; } }, props.children);
  return { Modal: host("native-modal"), View: host("native-view"), Text: host("native-text"), TextInput: host("native-input"),
    TouchableOpacity: host("native-touch"), ActivityIndicator: host("activity-indicator"), ScrollView: host("native-scroll"), KeyboardAvoidingView: host("native-keyboard"),
    FlatList: (props: any) => R.createElement("native-list", { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; } }, props.data.length ? props.data.map((item: any, index: number) => R.createElement(R.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index }))) : props.ListEmptyComponent),
    Platform: { get OS() { return mocks.platform; } }, StyleSheet: { create: (value: any) => value } };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
let id = 4000;
function actor(): JobSyncNativeSession { return { token: `ui-fixture-${++id}`, portal: "company", user: { id, name: "Owner", email: null, role: "owner" }, company: { id: 9, name: "Company", slug: "company", logoUrl: null, primaryColor: null, accentColor: null } }; }
let root: ReturnType<typeof createRoot>; let container: PhotoTestNode; let props: CompanyCreateJobSheetProps;
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function button(label: string) { const node = all().find((node) => node.nodeName === "NATIVE-TOUCH" && node.nativeProps.accessibilityLabel === label); if (!node) throw new Error(`Missing button ${label}; ${container.textContent}`); return node; }
function field(label: string) { const node = all().find((node) => node.nodeName === "NATIVE-INPUT" && node.nativeProps.accessibilityLabel === label); if (!node) throw new Error(`Missing field ${label}`); return node; }
function webField(label: string) {
  const node = all().find((node) => node.nodeName === "INPUT" && node.attributes["aria-label"] === label);
  if (!node) throw new Error(`Missing web field ${label}`);
  const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"));
  if (!key) throw new Error(`Missing committed React props for ${label}`);
  return { node, react: (node as any)[key] };
}
async function render(patch: Partial<CompanyCreateJobSheetProps> = {}) { props = { ...props, ...patch }; await act(async () => { root.render(<CompanyCreateJobSheet {...props} />); }); }
async function press(label: string) { await act(async () => { button(label).nativeProps.onPress(); }); }
async function input(label: string, value: string) {
  await act(async () => {
    if (["Company date", "Start time", "End time (optional)"].includes(label)) webField(label).react.onChange({ target: { value } });
    else field(label).nativeProps.onChangeText(value);
  });
}
async function chooseService() { await press("Choose Service"); await press("Actual Service"); await press("Add selected service"); }
async function choose() { await input("Find Company customer", "Actual"); await press("Actual Customer · 5551234567"); await chooseService(); }
beforeEach(() => {
  vi.resetAllMocks(); mocks.focused = true; mocks.platform = "web"; mocks.background = "#ffffff"; mocks.hasLoaded = true; mocks.loading = false; mocks.error = null;
  mocks.operation.mockImplementation(async (_token, _companyId, key) => ({ key, state: "unknown", jobId: null, rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null }));
  mocks.catalog = [{ serviceId: "31", name: "Actual Service", vehiclePrices: {}, basePrice: 125, defaultDurationMinutes: 45, features: [], description: "", sortOrder: 0, imageUrl: null, serviceTypeId: null, emoji: "" }];
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  props = { visible: true, session: actor(), initialDate: "2026-12-01", initialStartHour: 9, initialEndHour: 10, isCurrent: () => true, onClose: vi.fn(), onCreated: vi.fn() };
  mocks.signed.mockImplementation(async () => props.session); mocks.customers.mockResolvedValue([{ id: 7, name: "Actual Customer", phone: "5551234567", email: null, addressLine1: "Canonical Address", city: "Company City" }]);
  mocks.customer.mockResolvedValue({ id: 7, name: "Actual Customer", firstName: "Actual", lastName: "Customer", phone: "5551234567", email: null, addressLine1: "Canonical Address", city: "Company City", region: null, postalCode: null }); mocks.settings.mockResolvedValue({ id: 9, name: "Company", timezone: "America/Chicago" }); mocks.priceBook.mockImplementation(async () => mocks.catalog);
  mocks.verify.mockResolvedValue(true); mocks.refresh.mockResolvedValue(undefined); mocks.jobs.mockResolvedValue([]);
  mocks.quote.mockResolvedValue({ lines: [{ priceBookItemId: 31, name: "Actual Service", quantity: 1, unitPrice: 125, lineTotal: 125, durationMinutes: 45, taxable: false, vehiclePriceKey: null }],
    subtotal: 125, discount: 0, discountKind: null, discountCode: null, taxableSubtotal: 0, taxRateBps: 0, tax: 0, total: 125, totalDurationMinutes: 45, recurrence: null,
    persistence: { taxStored: true, note: "Offline quote fixture only, never persisted-series proof" } });
  mocks.create.mockRejectedValue(new Error("CREATE forbidden in recurrence-only form tests"));
  mocks.detail.mockRejectedValue(new Error("No saved Job is invented in form tests"));
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden")));
});
afterEach(async () => { await act(async () => root.unmount()); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("0fbd shared form: visible recurrence controls remain safely write-disabled", () => {
  it.each(["Weekly", "Biweekly", "Monthly by date", "Monthly by ordinal weekday"])("%s disables Save and does not dispatch a lone Job", async label => {
    await render(); await choose(); expect(button("Save Company Job").nativeProps.disabled).toBe(false);
    await press(label); expect(button(label).nativeProps.accessibilityState.selected).toBe(true);
    expect(container.textContent).toContain("now pass the isolated 0fbd gate");
    expect(container.textContent).toContain("persisted creation timezone");
    expect(container.textContent).toContain("Separate GETs have no shared snapshot/version");
    expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    await press("Save Company Job"); expect(mocks.create).not.toHaveBeenCalled(); expect(props.onCreated).not.toHaveBeenCalled(); expect(props.onClose).not.toHaveBeenCalled();
    await press("One appointment"); expect(button("Save Company Job").nativeProps.disabled).toBe(false);
  });
  it("all term/ordinal controls retain honest bounded ongoing and last-month semantics", async () => {
    await render(); await press("Monthly by ordinal weekday"); await press("Friday"); await press("Last");
    expect(button("Friday").nativeProps.accessibilityState.selected).toBe(true); expect(button("Last").nativeProps.accessibilityState.selected).toBe(true);
    for (const label of ["1 month", "3 months", "6 months", "1 year", "Ongoing"]) { await press(label); expect(button(label).nativeProps.accessibilityState.selected).toBe(true); }
    expect(container.textContent).toContain("initial 13-occurrence horizon"); expect(container.textContent).toContain("automatic future expansion is not verified");
    await press("Monthly by date"); expect(container.textContent).toContain("short months use their last date");
    expect(button("Ongoing").nativeProps.accessibilityState.selected).toBe(true); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("new/existing customer, service quantity, schedule and Auto End survive recurrence edits without Save", async () => {
    await render(); await choose(); await input("Service 1 quantity", "2"); await input("End time (optional)", "");
    await press("Weekly"); await press("Ongoing"); await press("New Customer");
    await input("First name (required)", "Casey"); await input("Last name (required)", "Example");
    expect(field("Service 1 quantity").nativeProps.value).toBe("2"); expect(webField("End time (optional)").react.value).toBe("");
    expect(webField("Company date").react.value).toBe("2026-12-01"); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    await press("Save Company Job"); expect(mocks.create).not.toHaveBeenCalled();
    await press("New Customer"); expect(button("Weekly").nativeProps.accessibilityState.selected).toBe(true);
  });
  it("retained recurrence callbacks cannot change a replaced Company draft", async () => {
    await render(); const old = button("Weekly").nativeProps.onPress;
    const replacement = actor(); replacement.company!.id = 10; mocks.settings.mockResolvedValue({ id: 10, name: "Company B", timezone: "America/Chicago" });
    await render({ session: replacement }); await act(async () => old());
    expect(button("One appointment").nativeProps.accessibilityState.selected).toBe(true); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("unfocused, technician and stale scope cannot render or perform API reads", async () => {
    mocks.focused = false; await render(); expect(container.textContent).toBe("");
    mocks.focused = true; const denied = actor(); denied.user.role = "technician"; await render({ session: denied }); expect(container.textContent).toBe("");
    await render({ session: actor(), isCurrent: () => false }); expect(container.textContent).toBe("");
    expect(mocks.signed).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
});
