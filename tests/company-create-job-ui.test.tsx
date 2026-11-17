import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/company-job-creation-storage", async () => {
  const { memoryCreationStorageModule } = await import("./helpers/company-creation-memory-store");
  return memoryCreationStorageModule();
});
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyCreateJobSheet, type CompanyCreateJobSheetProps } from "../components/company-create-job-sheet";
import { JobSyncApiError, normalizeCompanyJobPricing, type JobSyncNativeSession, type JobSyncCompanyJobCreateInput, type JobSyncCompanyJobQuoteInput, type JobSyncCompanyJobQuote } from "../lib/jobsync-mobile-api";
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
let root: ReturnType<typeof createRoot>; let container: PhotoTestNode; let props: CompanyCreateJobSheetProps; let ack: any;
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
function waiting<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
// Compatibility fixtures cover one catalog unit; no backend pricing formulas are reproduced.
// Tax zero is explicit persisted server evidence here, never an absent-tax fallback.
function fixtureQuote(input: JobSyncCompanyJobQuoteInput): JobSyncCompanyJobQuote {
  expect(Object.keys(input)).toEqual(["lineItems"]);
  expect(input.lineItems).toHaveLength(1);
  const line = input.lineItems[0];
  expect(line.quantity).toBe(1);
  const service = mocks.catalog.find(row => row.serviceId === String(line.priceBookItemId));
  expect(service).toBeDefined();
  expect(input.lineItems).toEqual([{ priceBookItemId: Number(service.serviceId), quantity: 1,
    ...(line.vehiclePriceKey ? { vehiclePriceKey: line.vehiclePriceKey } : {}) }]);
  const unitPrice = line.vehiclePriceKey ? service.vehiclePrices[line.vehiclePriceKey] : service.basePrice;
  return { lines: [{ priceBookItemId: line.priceBookItemId, name: service.name, quantity: 1,
    unitPrice, lineTotal: unitPrice, durationMinutes: service.defaultDurationMinutes, taxable: false, vehiclePriceKey: line.vehiclePriceKey ?? null }],
    subtotal: unitPrice, discount: 0, discountKind: null, discountCode: null, taxableSubtotal: 0,
    taxRateBps: 0, tax: 0, total: unitPrice, totalDurationMinutes: service.defaultDurationMinutes,
    recurrence: null, persistence: { taxStored: true, note: "Isolated server fixture stores Job tax." } };
}
function fixtureSavedJob(companyId: number, input: JobSyncCompanyJobCreateInput) {
  const quote = fixtureQuote({ lineItems: input.lineItems! });
  const line = quote.lines[0];
  const saved = { id: 84, companyId, priceBookServiceId: line.priceBookItemId, customerId: input.customerId,
    assignedUserId: input.assignedUserId ?? null, scheduledStartAt: input.scheduledStartAt,
    scheduledEndAt: input.scheduledEndAt ?? "2026-12-01T16:00:00.000Z", amount: quote.total, serviceName: line.name,
    lineItems: [{ id: 600, priceBookItemId: line.priceBookItemId, name: line.name, quantity: line.quantity,
      unitPrice: line.unitPrice, lineTotal: line.lineTotal, sortOrder: 0 }],
    subtotalAmount: quote.subtotal, discountAmount: quote.discount, taxAmount: quote.tax, taxRateBps: quote.taxRateBps,
    discountKind: quote.discountKind, discountCode: quote.discountCode,
    operation: { key: input.operationKey!, state: "saved" as const, replayed: false } };
  const pricing = normalizeCompanyJobPricing(saved);
  expect(pricing).toBeTruthy();
  return { ...saved, pricing: pricing! };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.focused = true; mocks.platform = "web"; mocks.background = "#ffffff"; mocks.hasLoaded = true; mocks.loading = false; mocks.error = null;
  ack = null;
  mocks.operation.mockImplementation(async (_token, _companyId, key) => ({ key, state: ack ? "saved" : "unknown", jobId: ack?.id ?? null, rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null }));
  mocks.catalog = [{ serviceId: "31", name: "Actual Service", vehiclePrices: {}, basePrice: 125, defaultDurationMinutes: 45, features: [], description: "", sortOrder: 0, imageUrl: null, serviceTypeId: null, emoji: "" }];
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  props = { visible: true, session: actor(), initialDate: "2026-12-01", initialStartHour: 9, initialEndHour: 10, isCurrent: () => true, onClose: vi.fn(), onCreated: vi.fn() };
  mocks.signed.mockImplementation(async () => props.session); mocks.customers.mockResolvedValue([{ id: 7, name: "Actual Customer", phone: "5551234567", email: null, addressLine1: "Canonical Address", city: "Company City" }]);
  mocks.customer.mockResolvedValue({ id: 7, name: "Actual Customer", firstName: "Actual", lastName: "Customer", phone: "5551234567", email: null, addressLine1: "Canonical Address", city: "Company City", region: null, postalCode: null }); mocks.settings.mockResolvedValue({ id: 9, name: "Company", timezone: "America/Chicago" }); mocks.priceBook.mockImplementation(async () => mocks.catalog);
  mocks.verify.mockResolvedValue(true); mocks.refresh.mockResolvedValue(undefined); mocks.jobs.mockResolvedValue([]);
  mocks.quote.mockImplementation(async (_token, _companyId, input) => fixtureQuote(input));
  mocks.create.mockImplementation(async (_token, companyId, input) => {
    ack = fixtureSavedJob(companyId, input); return ack;
  });
  mocks.detail.mockImplementation(async () => ({ ...ack, photos: [], persistedPhotoIds: [] }));
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden")));
});
afterEach(async () => { await act(async () => root.unmount()); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
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
    expect(webField("Company date").react).toMatchObject({ type: "date", value: "2026-12-01", style: { backgroundColor: "#ffffff", color: "#111111" } });
    expect(field("Service address").nativeProps.style[1]).toMatchObject({ backgroundColor: "#ffffff", color: "#111111" });
    await choose(); expect(field("Service address").nativeProps.value).toBe("Canonical Address"); expect(button("Save Company Job").nativeProps.disabled).toBe(false);
    expect(container.textContent).toContain("Catalog unit rate\n$125.00"); expect(container.textContent).toContain("SERVER QUOTE · NOT YET SAVED"); expect(container.textContent).toContain("Final quote total $125.00");
    await press("Save Company Job"); expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.quote).toHaveBeenCalledTimes(2); expect(mocks.quote).toHaveBeenLastCalledWith(props.session!.token, 9, { lineItems: [{ priceBookItemId: 31, quantity: 1 }] });
    expect(mocks.create.mock.calls[0][2]).toEqual({ customerId: 7, priceBookServiceId: 31, lineItems: [{ priceBookItemId: 31, quantity: 1 }], scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T16:00:00.000Z", addressLine1: "Canonical Address", city: "Company City", operationKey: expect.any(String), notifyCustomer: true });
    expect(props.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 84, amount: 125, photos: [] }), "America/Chicago");
    expect(button("Notify customer").nativeProps).toMatchObject({ disabled: true, accessibilityRole: "switch", accessibilityState: { checked: true, disabled: true } });
    expect(container.textContent).not.toContain("Company server policy");
    for (const forbidden of ["amount", "newCustomer", "recurrence", "unitPrice", "taxAmount", "totalAmount", "durationMinutes", "vehiclePriceKey", "discount"]) expect(mocks.create.mock.calls[0][2]).not.toHaveProperty(forbidden);
  });
  it("free services remain selectable and only verified empty catalogs show empty state", async () => {
    mocks.catalog[0].basePrice = 0; await render(); await choose(); expect(button("Save Company Job").nativeProps.disabled).toBe(false);
    mocks.catalog = []; mocks.hasLoaded = false; await render(); expect(container.textContent).not.toContain("No active services");
    mocks.hasLoaded = true; await render(); expect(container.textContent).toContain("No active services");
  });
  it("a base-zero service offers only returned rate keys and requires manual selection", async () => {
    mocks.catalog[0].basePrice = 0; mocks.catalog[0].vehiclePrices = { truck: 150 };
    await render(); await choose(); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    expect(container.textContent).toContain("Service rate (required)"); expect(container.textContent).not.toContain("truck");
    await press("Service 1 rate 1 · $150.00 catalog unit"); expect(button("Save Company Job").nativeProps.disabled).toBe(false);
    await press("Save Company Job"); expect(mocks.create.mock.calls[0][2].lineItems).toEqual([{ priceBookItemId: 31, quantity: 1, vehiclePriceKey: "truck" }]); expect(mocks.create.mock.calls[0][2]).not.toHaveProperty("vehiclePriceKey");
  });
  it("unverified catalog state blocks Save even when a retained service row is rendered", async () => {
    await render(); await choose(); mocks.hasLoaded = false; await render();
    expect(button("Save Company Job").nativeProps.disabled).toBe(true); expect(container.textContent).not.toContain("No active services");
  });
  it("typing a customer name is never selection, editing query clears canonical ID", async () => {
    await render(); await input("Find Company customer", "Actual"); await chooseService(); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
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
    deferred.resolve(fixtureSavedJob(9, mocks.create.mock.calls[0][2]));
    await act(async () => {}); expect(props.onCreated).not.toHaveBeenCalled(); expect(container.textContent).toContain("Job saved"); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("timeout stays locked and offers read-only reconciliation, not a blind retry", async () => {
    await render(); await choose(); mocks.create.mockRejectedValue(new JobSyncApiError("Timed out", null, "TIMEOUT")); await press("Save Company Job");
    expect(container.textContent).toContain("may have created"); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    expect(mocks.operation).toHaveBeenCalledTimes(1);
    await press("Refresh saved Job without resending"); expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.operation).toHaveBeenCalledTimes(2); expect(mocks.jobs).not.toHaveBeenCalled(); expect(props.onCreated).not.toHaveBeenCalled();
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

describe("Phase 1 canonical customer preselection and saved calendar feedback", () => {
  const profile = (patch: Record<string, unknown> = {}) => ({ id: 7, name: "Actual Customer", firstName: "Actual", lastName: "Customer", phone: "5551234567", email: "customer@example.invalid", addressLine1: "Verified Profile Address", city: "Verified City", region: "FL", postalCode: "32501", ...patch });
  it("preselects exact canonical customer and hydrates full current contact/address, preserving schedule and notes", async () => {
    mocks.customer.mockResolvedValue(profile());
    await render({ customerPrefill: { customerId: 7, companyId: 9 } });
    expect(mocks.customer).toHaveBeenCalledWith(props.session!.token, 7);
    expect(field("Find Company customer").nativeProps.value).toBe("Actual Customer");
    expect(field("Email (optional)").nativeProps).toMatchObject({ value: "customer@example.invalid", editable: false });
    expect(field("Service address").nativeProps.value).toBe("Verified Profile Address");
    await press("More Details");
    expect(field("City").nativeProps.value).toBe("Verified City");
    expect(field("Region / state").nativeProps.value).toBe("FL");
    expect(field("Postal code").nativeProps.value).toBe("32501");
    expect(webField("Company date").react.value).toBe("2026-12-01");
    await chooseService(); await input("Start time", "10:30"); await input("End time (optional)", "11:30");
    await input("Service notes", "Operator service note"); await input("Private notes", "Operator private note");
    await press("Save Company Job");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][2]).toMatchObject({ customerId: 7, priceBookServiceId: 31, lineItems: [{ priceBookItemId: 31, quantity: 1 }], scheduledStartAt: "2026-12-01T16:30:00.000Z", scheduledEndAt: "2026-12-01T17:30:00.000Z", addressLine1: "Verified Profile Address", city: "Verified City", region: "FL", postalCode: "32501", serviceNotes: "Operator service note", privateNotes: "Operator private note" });
  });
  it("rejects other-Company provenance without looking up or selecting that customer", async () => {
    await render({ customerPrefill: { customerId: 7, companyId: 99 } });
    expect(mocks.customer).not.toHaveBeenCalled(); expect(field("Find Company customer").nativeProps.value).toBe(""); expect(field("First name").nativeProps.value).toBe("");
    expect(container.textContent).toContain("does not belong to the current Company");
    expect(button("Save Company Job").nativeProps.disabled).toBe(true);
  });
  it("rejects explicit mismatched Company in an exact-ID response", async () => {
    mocks.customer.mockResolvedValue(profile({ companyId: 99 }));
    await render({ customerPrefill: { customerId: 7, companyId: 9 } });
    expect(container.textContent).toContain("could not be verified"); expect(field("Find Company customer").nativeProps.value).toBe(""); expect(field("First name").nativeProps.value).toBe("");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects a changed canonical ID rather than trusting identical names or phone numbers", async () => {
    mocks.customer.mockResolvedValue(profile({ id: 8 }));
    await render({ customerPrefill: { customerId: 7, companyId: 9 } });
    expect(container.textContent).toContain("could not be verified"); expect(field("Find Company customer").nativeProps.value).toBe(""); expect(field("First name").nativeProps.value).toBe("");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("lets an operator replace the preselected customer deliberately and verifies the replacement", async () => {
    mocks.customers.mockResolvedValue([profile(), profile({ id: 8, name: "Different Customer", phone: "5550000000" })]);
    mocks.customer.mockImplementation(async (_token, customerId) => customerId === 8 ? profile({ id: 8, name: "Different Customer", addressLine1: "Second Profile Address" }) : profile());
    await render({ customerPrefill: { customerId: 7, companyId: 9 } });
    await input("Find Company customer", "Different"); expect(field("First name").nativeProps.value).toBe(""); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    await press("Different Customer · 5550000000");
    expect(mocks.customer).toHaveBeenLastCalledWith(props.session!.token, 8);
    expect(field("Find Company customer").nativeProps.value).toBe("Different Customer");
    expect(field("Service address").nativeProps.value).toBe("Second Profile Address");
  });
  it("does not overwrite deliberate address edits or resurrect a prefill on form refresh", async () => {
    mocks.customer.mockResolvedValue(profile()); await render({ customerPrefill: { customerId: 7, companyId: 9 } });
    await press("More Details"); await input("Service address", "Operator Job Address"); await input("Postal code", "99999");
    await press("Refresh Company form");
    expect(field("Service address").nativeProps.value).toBe("Operator Job Address"); expect(field("Postal code").nativeProps.value).toBe("99999");
    expect(mocks.customer).toHaveBeenCalledTimes(1);
    await input("Find Company customer", "Changed search"); await press("Refresh Company form");
    expect(field("Find Company customer").nativeProps.value).toBe("Changed search"); expect(field("First name").nativeProps.value).toBe(""); expect(mocks.customer).toHaveBeenCalledTimes(1);
  });
  it("ignores a late prefill after deliberate search changes", async () => {
    const deferred = waiting<any>(); mocks.customer.mockReturnValueOnce(deferred.promise);
    await render({ customerPrefill: { customerId: 7, companyId: 9 } });
    await input("Find Company customer", "Other customer");
    deferred.resolve(profile()); await act(async () => {});
    expect(field("First name").nativeProps.value).toBe(""); expect(field("Service address").nativeProps.value).toBe("");
    expect(field("Find Company customer").nativeProps.value).toBe("Other customer");
  });
  it("a late Company A detail cannot overwrite Company B after identity changes", async () => {
    const deferred = waiting<any>(); mocks.customer.mockReturnValueOnce(deferred.promise);
    await render({ customerPrefill: { customerId: 7, companyId: 9 } });
    const second = actor(); second.company = { ...second.company!, id: 10 };
    mocks.settings.mockResolvedValue({ id: 10, name: "Second Company", timezone: "America/Chicago" });
    mocks.customer.mockResolvedValue(profile({ name: "Company B Customer", addressLine1: "B Address", companyId: 10 }));
    await render({ session: second, customerPrefill: { customerId: 7, companyId: 10 } });
    deferred.resolve(profile({ name: "Company A Customer", companyId: 9 })); await act(async () => {});
    expect(field("Find Company customer").nativeProps.value).toBe("Company B Customer");
    expect(field("Find Company customer").nativeProps.value).not.toBe("Company A Customer"); expect(field("Service address").nativeProps.value).toBe("B Address");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("retains the canonical saved ID and offers read-only refresh after calendar failure", async () => {
    props.onCreated = vi.fn().mockResolvedValue(false);
    await render(); await choose(); await press("Save Company Job");
    expect(container.textContent).toContain("Job saved — calendar refresh failed."); expect(props.onCreated).toHaveBeenLastCalledWith(expect.objectContaining({ id: 84, customerId: 7, priceBookServiceId: 31, amount: 125 }), "America/Chicago");
    expect(button("Save Company Job").nativeProps.disabled).toBe(true); expect(props.onClose).not.toHaveBeenCalled();
    await render({ visible: false }); await render({ visible: true });
    expect(mocks.detail).toHaveBeenLastCalledWith(props.session!.token, 84, 9); expect(props.onCreated).toHaveBeenLastCalledWith(expect.objectContaining({ id: 84, amount: 125 }), "America/Chicago"); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    (props.onCreated as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await press("Refresh saved Job without resending");
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.detail).toHaveBeenCalledTimes(3); expect(props.onCreated).toHaveBeenCalledTimes(3);
    expect(mocks.operation).toHaveBeenCalledTimes(2); expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Phase 1 shared sheet success settlement", () => {
  it("awaits calendar confirmation before closing and disables duplicate read-only refresh", async () => {
    const deferred = waiting<boolean>(); props.onCreated = vi.fn().mockReturnValueOnce(deferred.promise);
    await render(); await choose(); await press("Save Company Job");
    expect(props.onClose).not.toHaveBeenCalled(); expect(container.textContent).toContain("Refreshing…");
    expect(button("Refresh saved Job without resending").nativeProps.disabled).toBe(true);
    const refresh = button("Refresh saved Job without resending");
    await act(async () => { refresh.nativeProps.onPress(); refresh.nativeProps.onPress(); });
    expect(mocks.detail).toHaveBeenCalledTimes(1); expect(mocks.create).toHaveBeenCalledTimes(1);
    deferred.resolve(true); await act(async () => {}); expect(props.onClose).toHaveBeenCalledTimes(1);
  });
  it("never auto-closes a known saved Job after failed confirmation, even after another read-only retry", async () => {
    props.onCreated = vi.fn().mockResolvedValue(false);
    await render(); await choose(); await press("Save Company Job"); await press("Refresh saved Job without resending");
    expect(props.onClose).not.toHaveBeenCalled(); expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Job saved — calendar refresh failed."); expect(mocks.detail).toHaveBeenLastCalledWith(props.session!.token, 84, 9); expect(props.onCreated).toHaveBeenLastCalledWith(expect.objectContaining({ id: 84, amount: 125 }), "America/Chicago");
  });
  it("lets a profile own its deferred guarded navigation without double-closing", async () => {
    await render({ closeOnSuccess: false }); await choose(); await press("Save Company Job");
    expect(props.onCreated).toHaveBeenCalledTimes(1); expect(props.onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Company calendar refreshed"); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});


describe("Phase 2 shared form durable recovery", () => {
  const op = (key: string, state: "unknown" | "pending" | "saved" | "rejected", reason?: string) => ({ key, state, jobId: state === "saved" ? 84 : null, rejectionCode: state === "rejected" ? "BAD_REQUEST" : null, rejectionMessage: reason ?? null, createdAt: null, updatedAt: null });
  it("automatically recovers a committed response loss through one status GET and canonical calendar callback, never a secondPOST", async () => {
    await render(); await choose();
    mocks.create.mockImplementationOnce(async (_token, companyId, request) => {
      ack = fixtureSavedJob(companyId, request);
      throw new Error("Response lost after isolated simulated commit");
    });
    await press("Save Company Job");
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.operation).toHaveBeenCalledTimes(1);
    expect(mocks.operation).toHaveBeenCalledWith(props.session!.token, 9, mocks.create.mock.calls[0][2].operationKey);
    expect(props.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 84, amount: 125 }), "America/Chicago");
    expect(props.onClose).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["unknown", "pending"] as const)("shows %s status and preserves the same creation key across close/reopen and repeated taps", async (state) => {
    await render(); await choose(); mocks.create.mockRejectedValue(new Error("Lost response"));
    mocks.operation.mockImplementation(async (_token, _companyId, key) => op(key, state));
    await press("Save Company Job"); const key = mocks.create.mock.calls[0][2].operationKey;
    expect(container.textContent).toContain(state); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    await press("Save Company Job"); await render({ visible: false }); await render({ visible: true });
    expect(container.textContent).toContain(state); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    await press("Refresh saved Job without resending"); expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.operation.mock.calls.every((call) => call[2] === key)).toBe(true); expect(props.onCreated).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("shows the actual authoritative rejection reason and allows only a deliberate corrected save with a new key", async () => {
    await render(); await choose(); mocks.create.mockRejectedValueOnce(new JobSyncApiError("Validation failed", 400, "BAD_REQUEST"));
    mocks.operation.mockImplementation(async (_token, _companyId, key) => op(key, "rejected", "Choose an available service rate."));
    await press("Save Company Job"); const originalKey = mocks.create.mock.calls[0][2].operationKey;
    expect(container.textContent).toContain("Choose an available service rate."); expect(container.textContent).toContain("Save corrected Job"); expect(mocks.create).toHaveBeenCalledTimes(1);
    await input("Service address", "Corrected operator address"); expect(button("Save Company Job").nativeProps.disabled).toBe(false); await press("Save Company Job");
    expect(mocks.create).toHaveBeenCalledTimes(2); expect(mocks.create.mock.calls[1][2].operationKey).not.toBe(originalKey);
    expect(mocks.create.mock.calls[1][2].addressLine1).toBe("Corrected operator address"); expect(props.onCreated).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves a payload conflict and cannot use a rejection status to overwrite or resubmit the immutable attempt", async () => {
    await render(); await choose(); mocks.create.mockRejectedValue(new JobSyncApiError("This Job creation operation key was already used with a different payload.", 409, "CONFLICT"));
    mocks.operation.mockImplementation(async (_token, _companyId, key) => op(key, "rejected", "Original payload validation failed."));
    await press("Save Company Job"); expect(container.textContent).toContain("payload conflict"); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    await input("Service address", "Forbidden replacement"); await press("Save Company Job"); await press("Refresh saved Job without resending");
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(field("Service address").nativeProps.value).toBe("Canonical Address"); expect(props.onCreated).not.toHaveBeenCalled();
  });
  it("a retained automatic status callback cannot read or close a replaced Company sheet", async () => {
    await render(); await choose(); const lookup = waiting<any>(); mocks.create.mockRejectedValue(new Error("Lost response")); mocks.operation.mockReturnValueOnce(lookup.promise);
    await press("Save Company Job"); const oldKey = mocks.create.mock.calls[0][2].operationKey;
    const replacement = actor(); replacement.company!.id = 10; await render({ session: replacement });
    lookup.resolve(op(oldKey, "saved")); await act(async () => {});
    expect(props.onCreated).not.toHaveBeenCalled(); expect(props.onClose).not.toHaveBeenCalled(); expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.detail).not.toHaveBeenCalled(); expect(container.textContent).not.toContain("Job saved"); expect(fetch).not.toHaveBeenCalled();
  });
});
