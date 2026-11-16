import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyCreateJobSheet, type CompanyCreateJobSheetProps } from "../components/company-create-job-sheet";
import { JobSyncApiError, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";
const mocks = vi.hoisted(() => ({ focused: true, signed: vi.fn(), customers: vi.fn(), customer: vi.fn(), settings: vi.fn(), create: vi.fn(), detail: vi.fn(), jobs: vi.fn(), priceBook: vi.fn(), refresh: vi.fn(), verify: vi.fn(), catalog: [] as any[], hasLoaded: true, loading: false, error: null as string | null }));
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ foreground: "#111111", background: "#ffffff", surface: "#eeeeee", border: "#dddddd", primary: "#0077cc", muted: "#555555", error: "#bb0000" }) }));
vi.mock("@/hooks/use-company-price-book", () => ({ useCompanyPriceBook: () => ({ services: mocks.catalog, isLoading: mocks.loading, error: mocks.error, hasLoaded: mocks.hasLoaded, refresh: mocks.refresh }) }));
vi.mock("@/hooks/use-company-fieldwork-calendar", () => ({ useCompanyFieldworkCalendar: () => ({ members: [{ id: 50, name: "Actual Technician", employeeId: "jobsync-50" }], loading: false, error: null, verifyAssignment: mocks.verify }) }));
vi.mock("../lib/jobsync-mobile-api", async (original) => ({ ...await original<typeof import("../lib/jobsync-mobile-api")>(),
  getJobSyncMobileSession: mocks.signed, getJobSyncCompanyCustomers: mocks.customers, getJobSyncCompanyCustomer: mocks.customer,
  getJobSyncCompanySettings: mocks.settings, getHomeServiceConnectedPriceBook: mocks.priceBook,
  createJobSyncCompanyJob: mocks.create, getJobSyncCompanyJobDetail: mocks.detail, getJobSyncCompanyJobs: mocks.jobs,
}));
vi.mock("@react-native-community/datetimepicker", () => ({ default: () => null }));
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => R.createElement(name, { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; } }, props.children);
  return { Modal: host("native-modal"), View: host("native-view"), Text: host("native-text"), TextInput: host("native-input"),
    TouchableOpacity: host("native-touch"), ActivityIndicator: host("activity-indicator"), ScrollView: host("native-scroll"), KeyboardAvoidingView: host("native-keyboard"),
    FlatList: (props: any) => R.createElement("native-list", null, props.data.map((item: any, index: number) => R.createElement(R.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index })))),
    Platform: { OS: "web" }, StyleSheet: { create: (value: any) => value } };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
let id = 4000;
function actor(): JobSyncNativeSession { return { token: `ui-fixture-${++id}`, portal: "company", user: { id, name: "Owner", email: null, role: "owner" }, company: { id: 9, name: "Company", slug: "company", logoUrl: null, primaryColor: null, accentColor: null } }; }
let root: ReturnType<typeof createRoot>; let container: PhotoTestNode; let props: CompanyCreateJobSheetProps; let ack: any;
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function button(label: string) { const node = all().find((node) => node.nodeName === "NATIVE-TOUCH" && node.nativeProps.accessibilityLabel === label); if (!node) throw new Error(`Missing button ${label}; ${container.textContent}`); return node; }
function field(label: string) { const node = all().find((node) => node.nodeName === "NATIVE-INPUT" && node.nativeProps.accessibilityLabel === label); if (!node) throw new Error(`Missing field ${label}`); return node; }
async function render(patch: Partial<CompanyCreateJobSheetProps> = {}) { props = { ...props, ...patch }; await act(async () => { root.render(<CompanyCreateJobSheet {...props} />); }); }
async function press(label: string) { await act(async () => { button(label).nativeProps.onPress(); }); }
async function input(label: string, value: string) { await act(async () => field(label).nativeProps.onChangeText(value)); }
async function choose() { await input("Find Company customer", "Actual"); await press("Actual Customer · 5551234567"); await press("Actual Service"); }
function waiting<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks(); mocks.focused = true; mocks.hasLoaded = true; mocks.loading = false; mocks.error = null;
  mocks.catalog = [{ serviceId: "31", name: "Actual Service", vehiclePrices: {}, basePrice: 125, features: [], description: "", sortOrder: 0, imageUrl: null, serviceTypeId: null, emoji: "" }];
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  props = { visible: true, session: actor(), initialDate: "2026-12-01", initialStartHour: 9, initialEndHour: 10, isCurrent: () => true, onClose: vi.fn(), onCreated: vi.fn() };
  mocks.signed.mockImplementation(async () => props.session); mocks.customers.mockResolvedValue([{ id: 7, name: "Actual Customer", phone: "5551234567", email: null, addressLine1: "Canonical Address", city: "Company City" }]);
  mocks.customer.mockResolvedValue({ id: 7 }); mocks.settings.mockResolvedValue({ id: 9, name: "Company", timezone: "America/Chicago" }); mocks.priceBook.mockImplementation(async () => mocks.catalog);
  mocks.verify.mockResolvedValue(true); mocks.refresh.mockResolvedValue(undefined); mocks.jobs.mockResolvedValue([]);
  mocks.create.mockImplementation(async (_token, companyId, input) => {
    ack = { id: 84, companyId, priceBookServiceId: input.priceBookServiceId, customerId: input.customerId, assignedUserId: input.assignedUserId ?? null,
      scheduledStartAt: input.scheduledStartAt, scheduledEndAt: input.scheduledEndAt ?? "2026-12-01T16:00:00.000Z", amount: 125, serviceName: "Actual Service" }; return ack;
  });
  mocks.detail.mockImplementation(async () => ({ ...ack, photos: [], persistedPhotoIds: [] }));
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden")));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
describe("Company create sheet: real React lifecycle + controller, mocked native hosts/I-O", () => {
  it("hidden/unfocused/technician/platform/stale parent never mounts reads or create UI", async () => {
    for (const patch of [{ visible: false }, { session: null }, { isCurrent: () => false }] as Partial<CompanyCreateJobSheetProps>[]) {
      await render({ visible: true, session: actor(), isCurrent: () => true, ...patch }); expect(container.textContent).toBe("");
    }
    const denied = actor(); denied.user.role = "technician"; await render({ session: denied, isCurrent: () => true }); expect(container.textContent).toBe("");
    denied.portal = "platform"; denied.user.role = "owner"; await render({ session: denied }); expect(container.textContent).toBe("");
    mocks.focused = false; await render({ session: actor() }); expect(container.textContent).toBe(""); expect(mocks.signed).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("uses theme tokens, reads on open and does not create until actual ID selection + manual Save", async () => {
    await render(); expect(container.textContent).toContain("New Job"); expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(mocks.create).not.toHaveBeenCalled();
    expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    expect(field("Company date").nativeProps.style[1]).toMatchObject({ backgroundColor: "#ffffff", color: "#111111" });
    await choose(); expect(field("Service address").nativeProps.value).toBe("Canonical Address"); expect(button("Save Company Job").nativeProps.disabled).toBe(false);
    await press("Save Company Job"); expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.create.mock.calls[0][2]).toMatchObject({ customerId: 7, priceBookServiceId: 31, scheduledStartAt: "2026-12-01T15:00:00.000Z" });
    expect(props.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 84, amount: 125, photos: [] }), "America/Chicago");
    expect(container.textContent).toContain("Company server policy");
    for (const forbidden of ["notifyCustomer", "amount", "newCustomer", "recurrence", "lineItems"]) expect(mocks.create.mock.calls[0][2]).not.toHaveProperty(forbidden);
  });
  it("free services remain selectable and only verified empty catalogs show empty state", async () => {
    mocks.catalog[0].basePrice = 0; await render(); await choose(); expect(button("Save Company Job").nativeProps.disabled).toBe(false);
    mocks.catalog = []; mocks.hasLoaded = false; await render(); expect(container.textContent).not.toContain("No active services");
    mocks.hasLoaded = true; await render(); expect(container.textContent).toContain("No active services");
  });
  it("a base-zero service offers only returned rate keys and requires manual selection", async () => {
    mocks.catalog[0].basePrice = 0; mocks.catalog[0].vehiclePrices = { truck: 150 };
    await render(); await choose(); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    expect(container.textContent).toContain("Choose service rate (required)");
    await press("truck · $150.00"); expect(button("Save Company Job").nativeProps.disabled).toBe(false);
    await press("Save Company Job"); expect(mocks.create.mock.calls[0][2].vehiclePriceKey).toBe("truck");
  });
  it("unverified catalog state blocks Save even when a retained service row is rendered", async () => {
    await render(); await choose(); mocks.hasLoaded = false; await render();
    expect(button("Save Company Job").nativeProps.disabled).toBe(true); expect(container.textContent).not.toContain("No active services");
  });
  it("typing a customer name is never selection, editing query clears canonical ID", async () => {
    await render(); await input("Find Company customer", "Actual"); await press("Actual Service"); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    await press("Actual Customer · 5551234567"); expect(button("Save Company Job").nativeProps.disabled).toBe(false);
    await input("Find Company customer", "Other name"); expect(button("Save Company Job").nativeProps.disabled).toBe(true); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("selected assignment is live-revalidated and denied selection never turns into unassigned", async () => {
    await render(); await choose(); await press("Actual Technician"); mocks.verify.mockResolvedValue(false); await press("Save Company Job");
    expect(mocks.verify).toHaveBeenCalledWith("jobsync-50"); expect(mocks.create).not.toHaveBeenCalled(); expect(container.textContent).toContain("verified assignment candidate");
  });
  it("pending duplicate retained presses issue one POST and late close/reopen completion cannot mutate the new draft", async () => {
    await render(); await choose(); const deferred = waiting<any>(); mocks.create.mockReturnValueOnce(deferred.promise);
    const savedButton = button("Save Company Job"); await act(async () => { savedButton.nativeProps.onPress(); savedButton.nativeProps.onPress(); });
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    await render({ visible: false }); await render({ visible: true }); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    deferred.resolve({ id: 84, companyId: 9, customerId: 7, priceBookServiceId: 31, assignedUserId: null, scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T16:00:00.000Z", amount: 125 });
    await act(async () => {}); expect(props.onCreated).not.toHaveBeenCalled(); expect(container.textContent).toContain("Job saved"); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("timeout stays locked and offers read-only reconciliation, not a blind retry", async () => {
    await render(); await choose(); mocks.create.mockRejectedValue(new JobSyncApiError("Timed out", null, "TIMEOUT")); await press("Save Company Job");
    expect(container.textContent).toContain("may have created"); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    await press("Refresh saved Job without resending"); expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.jobs).toHaveBeenCalledTimes(1); expect(props.onCreated).not.toHaveBeenCalled();
  });
  it("known saved readback failure supports GET-only retry and canonical callback", async () => {
    await render(); await choose(); mocks.detail.mockRejectedValueOnce(new Error("Readback offline")); await press("Save Company Job");
    expect(container.textContent).toContain("Job saved"); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    await press("Refresh saved Job without resending"); expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.detail).toHaveBeenCalledTimes(2); expect(props.onCreated).toHaveBeenCalledTimes(1);
  });
  it("retained button after parent epoch changes cannot close or submit", async () => {
    await render(); await choose(); const save = button("Save Company Job"); const close = button("Close Add Job");
    props = { ...props, isCurrent: () => false }; await render(); await act(async () => { save.nativeProps.onPress(); close.nativeProps.onPress(); });
    expect(mocks.create).not.toHaveBeenCalled(); expect(props.onClose).not.toHaveBeenCalled();
  });
});
