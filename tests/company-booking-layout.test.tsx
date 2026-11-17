import React, { act } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyCreateJobSheet, type CompanyCreateJobSheetProps } from "../components/company-create-job-sheet";
import { JobSyncApiError, normalizeCompanyJobPricing, type JobSyncNativeSession, type JobSyncCompanyJobCreateInput, type JobSyncCompanyJobQuoteInput, type JobSyncCompanyJobQuote } from "../lib/jobsync-mobile-api";
vi.mock("../lib/company-job-creation-storage", async () => {
  const { memoryCreationStorageModule } = await import("./helpers/company-creation-memory-store");
  return memoryCreationStorageModule();
});
const mocks = vi.hoisted(() => ({ focused: true, platform: "web", signed: vi.fn(), customers: vi.fn(), customer: vi.fn(), settings: vi.fn(), quote: vi.fn(), create: vi.fn(), detail: vi.fn(), jobs: vi.fn(), operation: vi.fn(), priceBook: vi.fn(), refresh: vi.fn(), verify: vi.fn(), catalog: [] as any[], hasLoaded: true, loading: false, error: null as string | null, background: "#07111F" }));
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ foreground: "#f6f8fc", background: mocks.background, surface: "#102038", border: "#243754", primary: "#4d8dff", muted: "#94a3b8", error: "#bb0000" }) }));
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
  return { default: (props: any) => R.createElement("native-picker", { ref: (node: any) => { if (node) node.nativeProps = props; } }) };
});
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => R.createElement(name, { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; } }, props.children);
  return { Modal: host("native-modal"), View: host("native-view"), Text: host("native-text"), TextInput: host("native-input"),
    TouchableOpacity: host("native-touch"), ActivityIndicator: host("activity-indicator"), ScrollView: host("native-scroll"), KeyboardAvoidingView: host("native-keyboard"),
    FlatList: (props: any) => R.createElement("native-list", { ref: (node: any) => { if (node) node.nativeProps = props; } }, props.data.length ? props.data.map((item: any, index: number) => R.createElement(R.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index }))) : props.ListEmptyComponent),
    AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) }, Keyboard: { addListener: () => ({ remove: vi.fn() }) }, Platform: { get OS() { return mocks.platform; } }, StyleSheet: { create: (value: any) => value } };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
const nativeRequire = createRequire(import.meta.url);
const safeAreaPath = nativeRequire.resolve("react-native-safe-area-context");
const originalSafeArea = nativeRequire.cache[safeAreaPath];
let id = 8000;
function actor(): JobSyncNativeSession { return { token: `booking-fixture-${++id}`, portal: "company", user: { id, name: "Owner", email: null, role: "owner" }, company: { id: 9, name: "Company", slug: "company", logoUrl: null, primaryColor: null, accentColor: null } }; }
const profile = (patch: Record<string, unknown> = {}) => ({ id: 7, name: "Actual Customer", firstName: "Actual", lastName: "Customer", phone: "5551234567", email: "customer@example.invalid", addressLine1: "Canonical Address", city: "Company City", region: "FL", postalCode: "32501", ...patch });
let root: ReturnType<typeof createRoot>; let container: PhotoTestNode; let props: CompanyCreateJobSheetProps; let ack: any;
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function node(label: string) { const found = all().find((item) => item.nativeProps?.accessibilityLabel === label); if (!found) throw new Error(`Missing ${label}; ${container.textContent}`); return found; }
function byId(testID: string) { const found = all().find((item) => item.nativeProps?.testID === testID); if (!found) throw new Error(`Missing ${testID}`); return found; }
async function render(patch: Partial<CompanyCreateJobSheetProps> = {}) { props = { ...props, ...patch }; await act(async () => { root.render(<CompanyCreateJobSheet {...props} />); }); }
async function press(label: string) { await act(async () => node(label).nativeProps.onPress()); }
async function input(label: string, value: string) { await act(async () => node(label).nativeProps.onChangeText(value)); }
async function chooseService(name = "Actual Service") { await press(all().some((item) => item.nativeProps?.accessibilityLabel === "Choose Service") ? "Choose Service" : "Add Another Service"); await press(name); await press("Add selected service"); }
async function chooseCustomer() { await input("Find Company customer", "Actual"); await press("Actual Customer · 5551234567"); }
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
  vi.resetAllMocks(); mocks.focused = true; mocks.platform = "web"; mocks.hasLoaded = true; mocks.loading = false; mocks.error = null; mocks.background = "#07111F"; ack = null;
  nativeRequire.cache[safeAreaPath] = { id: safeAreaPath, filename: safeAreaPath, loaded: true, exports: {
    SafeAreaView: (safeProps: Record<string, any>) => React.createElement("native-safe-area", { ref: (host: PhotoTestNode | null) => { if (host) (host as NativeNode).nativeProps = safeProps; } }, safeProps.children),
  } } as NodeModule;
  mocks.operation.mockImplementation(async (_token, _companyId, key) => ({ key, state: ack ? "saved" : "unknown", jobId: ack?.id ?? null, rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null }));
  mocks.catalog = [
    { serviceId: "31", name: "Actual Service", vehiclePrices: {}, basePrice: 125, defaultDurationMinutes: 45, features: [], description: "Returned catalog description", sortOrder: 0, imageUrl: null, serviceTypeId: null, emoji: "" },
    { serviceId: "32", name: "Second Service", vehiclePrices: {}, basePrice: 85, defaultDurationMinutes: 30, features: [], description: "Clean gutters and downspouts", sortOrder: 1, imageUrl: null, serviceTypeId: null, emoji: "" },
  ];
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  props = { visible: true, session: actor(), initialDate: "2026-12-01", initialStartHour: 9, initialEndHour: 10, isCurrent: () => true, onClose: vi.fn(), onCreated: vi.fn() };
  mocks.signed.mockImplementation(async () => props.session); mocks.customers.mockResolvedValue([profile()]); mocks.customer.mockResolvedValue(profile()); mocks.settings.mockResolvedValue({ id: 9, name: "Company", timezone: "America/Chicago" }); mocks.priceBook.mockImplementation(async () => mocks.catalog);
  mocks.verify.mockResolvedValue(true); mocks.refresh.mockResolvedValue(undefined); mocks.jobs.mockResolvedValue([]);
  mocks.quote.mockImplementation(async (_token, _companyId, input) => fixtureQuote(input));
  mocks.create.mockImplementation(async (_token, companyId, request) => {
    ack = fixtureSavedJob(companyId, request); return ack;
  });
  mocks.detail.mockImplementation(async () => ({ ...ack, photos: [], persistedPhotoIds: [] }));
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden")));
});
afterEach(async () => {
  await act(async () => root.unmount()); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  if (originalSafeArea) nativeRequire.cache[safeAreaPath] = originalSafeArea; else delete nativeRequire.cache[safeAreaPath];
});

describe("approved compact booking layout — actual React/controller lifecycle, mocked native hosts and I/O", () => {
  it("mounts no reads for hidden, unfocused, unauthorized, or stale sheets", async () => {
    for (const patch of [{ visible: false }, { session: null }, { isCurrent: () => false }]) { await render({ visible: true, session: actor(), isCurrent: () => true, ...patch }); expect(container.textContent).toBe(""); }
    const denied = actor(); denied.user.role = "technician"; await render({ session: denied, isCurrent: () => true }); expect(container.textContent).toBe("");
    mocks.focused = false; await render({ session: actor() }); expect(container.textContent).toBe(""); expect(mocks.signed).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("uses original scoped dark sheet tokens and preserves the light palette", async () => {
    await render(); expect(byId("company-booking-sheet").nativeProps.style[1]).toMatchObject({ backgroundColor: "#1c2028" });
    expect(node("Service address").nativeProps.style[1]).toMatchObject({ backgroundColor: "#101319", color: "#f8fafc" });
    expect(node("Save Company Job").nativeProps.style[1].backgroundColor).toBe("#0068ff");
    mocks.background = "#ffffff"; await render(); expect(byId("company-booking-sheet").nativeProps.style[1].backgroundColor).toBe("#102038"); expect(node("Service address").nativeProps.style[1].backgroundColor).toBe("#ffffff"); expect(node("Save Company Job").nativeProps.style[1].backgroundColor).toBe("#4d8dff");
  });
  it("keeps vertical address and notes fields content-sized instead of collapsing into the next label", async () => {
    await render();
    const addressStyle = (node("Service address").parentNode as NativeNode).nativeProps.style;
    expect(addressStyle[0]).toMatchObject({ flexShrink: 0 });
    expect(addressStyle[0]).not.toHaveProperty("flex");
    expect((node("First name").parentNode as NativeNode).nativeProps.style[1]).toMatchObject({ flex: 1 });
    await press("More Details");
    expect((node("Service notes").parentNode as NativeNode).nativeProps.style[0]).not.toHaveProperty("flex");
  });
  it("searches returned description in bounded overlay, requires confirmation, and cancels without changing the booking", async () => {
    await render(); expect(container.textContent).not.toContain("Second Service"); await press("Choose Service");
    expect(byId("company-booking-pricebook-list").nativeProps.keyboardShouldPersistTaps).toBe("handled");
    await input("Search Price Book services", "gutters"); expect(byId("company-booking-pricebook-list").textContent).toContain("Second Service"); expect(byId("company-booking-pricebook-list").textContent).not.toContain("Actual Service");
    await press("Second Service"); expect(node("Save Company Job").nativeProps.disabled).toBe(true); await press("Cancel service selection"); expect(container.textContent).not.toContain("Second Service");
    await chooseService(); expect(container.textContent).toContain("$125.00"); expect(container.textContent).toContain("45 min"); expect(container.textContent).not.toContain("Second Service"); expect(mocks.create).not.toHaveBeenCalled();
    expect(node("Add Another Service").nativeProps.disabled).toBe(false);
    await press("Add Another Service"); expect(byId("company-booking-pricebook-list").textContent).toContain("Second Service");
    expect(byId("company-booking-pricebook-list").textContent).not.toContain("Actual Service");
    await press("Second Service"); await press("Cancel service selection");
    expect(node("Actual Service").nativeProps.accessibilityState.selected).toBe(true);
    expect(container.textContent).not.toContain("Second Service"); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("customer choice freshly verifies canonical ID, populates paired readonly identity/contact fields, and query edits invalidate it", async () => {
    await render(); await input("Find Company customer", "Actual"); expect(byId("company-booking-customer-results").nativeProps.style[0].maxHeight).toBe(220);
    await press("Actual Customer · 5551234567"); expect(mocks.customer).toHaveBeenCalledWith(props.session!.token, 7);
    expect(node("First name").nativeProps).toMatchObject({ value: "Actual", editable: false }); expect(node("Last name").nativeProps).toMatchObject({ value: "Customer", editable: false });
    expect(node("Phone (optional)").nativeProps).toMatchObject({ value: "5551234567", editable: false }); expect(node("Email (optional)").nativeProps).toMatchObject({ value: "customer@example.invalid", editable: false });
    await input("First name", "Unauthorized edit"); expect(node("First name").nativeProps.value).toBe("Actual");
    await chooseService(); expect(node("Save Company Job").nativeProps.disabled).toBe(false); await input("Find Company customer", "Changed");
    expect(node("Save Company Job").nativeProps.disabled).toBe(true); expect(node("First name").nativeProps.value).toBe(""); expect(node("Service address").nativeProps.value).toBe("");
  });
  it("preserves service/rate, assignment, schedule and notes on mode toggles, while requiring new names and keeping contact optional", async () => {
    await render(); await chooseService(); await press("Actual Technician"); await press("More Details"); await input("Service notes", "Keep service notes"); await input("Private notes", "Keep private notes");
    await press("New Customer"); expect(node("First name (required)").nativeProps.editable).toBe(true); expect(node("Save Company Job").nativeProps.disabled).toBe(true);
    expect(byId("company-booking-name-pair").nativeProps.style.flexDirection).toBe("row"); expect(byId("company-booking-contact-pair").nativeProps.style.flexDirection).toBe("row");
    await input("First name (required)", "Casey"); await input("Last name (required)", "New"); expect(node("Save Company Job").nativeProps.disabled).toBe(false);
    await press("Existing Customer"); await chooseCustomer(); expect(node("Actual Technician").nativeProps.accessibilityState.selected).toBe(true); expect(node("Service notes").nativeProps.value).toBe("Keep service notes");
    await press("Save Company Job"); expect(mocks.verify).toHaveBeenCalledWith("jobsync-50"); expect(mocks.create.mock.calls[0][2]).toMatchObject({ customerId: 7, priceBookServiceId: 31, lineItems: [{ priceBookItemId: 31, quantity: 1 }], assignedUserId: 50, scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T16:00:00.000Z", serviceNotes: "Keep service notes", privateNotes: "Keep private notes" });
  });
  it("does not drop optional notes or address detail values after closing More Details", async () => {
    await render({ customerPrefill: { customerId: 7, companyId: 9 }, closeOnSuccess: false }); await chooseService(); await press("More Details");
    await input("Service address", "Job-only address"); await input("City", "Job City"); await input("Region / state", "NY"); await input("Postal code", "10001"); await input("Service notes", "Public note"); await input("Private notes", "Private note"); await press("More Details");
    await press("Save Company Job"); expect(mocks.create.mock.calls[0][2]).toMatchObject({ addressLine1: "Job-only address", city: "Job City", region: "NY", postalCode: "10001", serviceNotes: "Public note", privateNotes: "Private note" }); expect(props.onClose).not.toHaveBeenCalled(); expect(mocks.create.mock.calls[0][2].lineItems).toEqual([{ priceBookItemId: 31, quantity: 1 }]);
    expect(node("Notify customer").nativeProps.disabled).toBe(true); expect(mocks.create.mock.calls[0][2].notifyCustomer).toBe(true); for (const unsupported of ["quantity", "recurrence", "discount", "amount", "unitPrice", "taxAmount", "totalAmount", "durationMinutes", "vehiclePriceKey"]) expect(mocks.create.mock.calls[0][2]).not.toHaveProperty(unsupported);
  });
  it("uses generic returned service rates without vehicle category controls, and preserves the chosen rate on mode change", async () => {
    mocks.catalog[0].basePrice = 0; mocks.catalog[0].vehiclePrices = { truck: 150 }; await render(); await chooseCustomer(); await chooseService();
    expect(node("Save Company Job").nativeProps.disabled).toBe(true); expect(container.textContent).not.toContain("truck"); await press("Service 1 rate 1 · $150.00 catalog unit");
    await press("New Customer"); await input("First name (required)", "New"); await input("Last name (required)", "Customer"); await press("Save Company Job");
    expect(mocks.create.mock.calls[0][2].lineItems).toEqual([{ priceBookItemId: 31, quantity: 1, vehiclePriceKey: "truck" }]); expect(mocks.create.mock.calls[0][2]).not.toHaveProperty("vehiclePriceKey"); expect(mocks.create.mock.calls[0][2].newCustomer).toMatchObject({ firstName: "New", lastName: "Customer" });
  });
  it("free returned service prices stay selectable and unverified catalog state blocks confirmation/save", async () => {
    mocks.catalog[0].basePrice = 0; await render(); await chooseCustomer(); await chooseService(); expect(node("Save Company Job").nativeProps.disabled).toBe(false);
    mocks.hasLoaded = false; await render(); expect(node("Save Company Job").nativeProps.disabled).toBe(true); await press("Actual Service"); expect(node("Add selected service").nativeProps.disabled).toBe(true);
  });
  it("assignment denial remains actionable and never silently becomes unassigned", async () => {
    await render(); await chooseCustomer(); await chooseService(); await press("Actual Technician"); mocks.verify.mockResolvedValue(false); await press("Save Company Job");
    expect(mocks.create).not.toHaveBeenCalled(); expect(container.textContent).toContain("verified assignment candidate"); expect(node("Actual Technician").nativeProps.accessibilityState.selected).toBe(true);
  });
  it("late customer verification after query/mode/close/focus/tenant changes cannot overwrite the draft", async () => {
    for (const change of ["query", "mode", "close", "focus", "tenant"] as const) {
      await render({ visible: false }); mocks.focused = true; await render({ visible: true, session: actor(), customerPrefill: null });
      const deferred = waiting<any>(); mocks.customer.mockReturnValueOnce(deferred.promise); await input("Find Company customer", "Actual"); await press("Actual Customer · 5551234567");
      if (change === "query") await input("Find Company customer", "Other");
      if (change === "mode") await press("New Customer");
      if (change === "close") await press("Close Add Job");
      if (change === "focus") { mocks.focused = false; await render(); }
      if (change === "tenant") { const next = actor(); next.company!.id = 10; mocks.settings.mockResolvedValue({ id: 10, name: "Other", timezone: "America/Chicago" }); await render({ session: next }); }
      deferred.resolve(profile({ firstName: "Late", addressLine1: "Late stale address" })); await act(async () => {});
      expect(all().filter((item) => item.nativeProps?.value === "Late stale address")).toHaveLength(0); expect(mocks.create).not.toHaveBeenCalled();
      mocks.settings.mockResolvedValue({ id: 9, name: "Company", timezone: "America/Chicago" });
    }
  });
  it("canonical-ID mismatches are rejected and retained save/close handlers cannot act after parent epoch changes", async () => {
    mocks.customer.mockResolvedValue(profile({ id: 8 })); await render({ customerPrefill: { customerId: 7, companyId: 9 } }); expect(container.textContent).toContain("could not be verified"); expect(node("Save Company Job").nativeProps.disabled).toBe(true);
    const save = node("Save Company Job").nativeProps.onPress; const close = node("Close Add Job").nativeProps.onPress; await render({ isCurrent: () => false }); await act(async () => { save(); close(); }); expect(mocks.create).not.toHaveBeenCalled(); expect(props.onClose).not.toHaveBeenCalled();
  });
  it("ambiguous saves remain locked and only GET-only status refresh is offered", async () => {
    await render(); await chooseCustomer(); await chooseService(); mocks.create.mockRejectedValue(new JobSyncApiError("Timed out", null, "TIMEOUT")); await press("Save Company Job");
    expect(node("Save Company Job").nativeProps.disabled).toBe(true); expect(container.textContent).toContain("may have created"); await press("Refresh saved Job without resending"); expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.operation).toHaveBeenCalledTimes(2); expect(fetch).not.toHaveBeenCalled();
  });
  it("real web date/time inputs edit Company wall time through guarded React callbacks", async () => {
    await render(); await chooseCustomer(); await chooseService();
    const web = (label: string) => {
      const found = all().find((item) => item.nodeName === "INPUT" && item.attributes["aria-label"] === label)!;
      const key = Object.keys(found).find((name) => name.startsWith("__reactProps$"))!;
      return { found, react: (found as any)[key] };
    };
    expect(web("Company date").react.type).toBe("date"); expect(web("Start time").react.type).toBe("time");
    await act(async () => { web("Company date").react.onChange({ target: { value: "2026-12-02" } }); web("Start time").react.onChange({ target: { value: "10:30" } }); web("End time (optional)").react.onChange({ target: { value: "11:30" } }); });
    await press("Save Company Job"); expect(mocks.create.mock.calls[0][2]).toMatchObject({ scheduledStartAt: "2026-12-02T16:30:00.000Z", scheduledEndAt: "2026-12-02T17:30:00.000Z" });
  });
  it("duplicate retained Save taps remain one write, and Cancel invalidates late confirmation", async () => {
    await render(); await chooseCustomer(); await chooseService(); const deferred = waiting<any>(); mocks.create.mockReturnValueOnce(deferred.promise);
    const save = node("Save Company Job").nativeProps.onPress; await act(async () => { save(); save(); }); expect(mocks.create).toHaveBeenCalledTimes(1);
    await press("Cancel Add Job"); expect(props.onClose).toHaveBeenCalledTimes(1);
    deferred.resolve(fixtureSavedJob(9, mocks.create.mock.calls[0][2]));
    await act(async () => {}); expect(props.onCreated).not.toHaveBeenCalled(); expect(props.onClose).toHaveBeenCalledTimes(1);
  });
  it("known saved calendar failure stays visible and refreshes only reads before closing", async () => {
    props.onCreated = vi.fn().mockResolvedValue(false); await render(); await chooseCustomer(); await chooseService(); await press("Save Company Job");
    expect(container.textContent).toContain("Job saved — calendar refresh failed."); expect(node("Save Company Job").nativeProps.disabled).toBe(true); expect(props.onClose).not.toHaveBeenCalled();
    (props.onCreated as ReturnType<typeof vi.fn>).mockResolvedValue(true); await press("Refresh saved Job without resending"); expect(mocks.create).toHaveBeenCalledTimes(1); expect(props.onClose).toHaveBeenCalledTimes(1);
  });
  it("authoritative rejection keeps its reason visible and permits only deliberate corrected Save", async () => {
    await render(); await chooseCustomer(); await chooseService(); mocks.create.mockRejectedValueOnce(new JobSyncApiError("Validation failed", 400, "BAD_REQUEST"));
    mocks.operation.mockImplementation(async (_token, _companyId, key) => ({ key, state: "rejected", jobId: null, rejectionCode: "BAD_REQUEST", rejectionMessage: "Choose a valid service address.", createdAt: null, updatedAt: null }));
    await press("Save Company Job"); const originalKey = mocks.create.mock.calls[0][2].operationKey; expect(container.textContent).toContain("Choose a valid service address."); expect(container.textContent).toContain("Save corrected Job");
    await input("Service address", "Corrected address"); expect(node("Save Company Job").nativeProps.disabled).toBe(false); await press("Save Company Job"); expect(mocks.create).toHaveBeenCalledTimes(2); expect(mocks.create.mock.calls[1][2].operationKey).not.toBe(originalKey); expect(mocks.create.mock.calls[1][2].addressLine1).toBe("Corrected address");
  });
  it("renders compact native pickers with iOS/Android keyboard avoidance and tappable scroll handling", async () => {
    for (const [platform, behavior] of [["ios", "padding"], ["android", undefined]] as const) {
      mocks.platform = platform; await render(); expect(all().find((item) => item.nodeName === "NATIVE-KEYBOARD")!.nativeProps.behavior).toBe(behavior);
      expect(byId("company-booking-main-scroll").nativeProps).toMatchObject({ keyboardShouldPersistTaps: "handled", keyboardDismissMode: "on-drag" });
      await press("Start time"); const picker = all().find((item) => item.nodeName === "NATIVE-PICKER")!; expect(picker.nativeProps.mode).toBe("time");
      await act(async () => picker.nativeProps.onChange({}, new Date(2026, 11, 1, 10, 30))); expect(node("Start time").textContent).toBe("10:30");
      await press("End time (optional)"); await press("Use service duration"); expect(node("End time (optional)").textContent).toBe("Auto");
    }
  });
  it("contains real web date/time input semantics, paired fields, >=44pt targets, and no unsupported feature wall or wizard", () => {
    const source = readFileSync(new URL("../components/company-create-job-sheet.tsx", import.meta.url), "utf8");
    const time = readFileSync(new URL("../components/company-booking-time-field.tsx", import.meta.url), "utf8");
    expect(time).toContain('React.createElement("input"'); expect(time).toContain('"aria-label": accessibilityLabel'); expect(time).toContain('type: "date" | "time"'); expect(time).toContain("minHeight: 44");
    expect(source).toContain('keyboardShouldPersistTaps="handled"'); expect(source).toContain('keyboardDismissMode="on-drag"'); expect(source).toContain("minHeight: 44");
    for (const old of ["Create one service", "Saved base price", "Choose service rate (required)", "Assign Team Member", "Customer confirmations follow", "vehicle category", "VIP", "Next step"]) expect(source).not.toContain(old);
    expect(source).not.toContain("Job #"); expect(source).toContain("state.detailError");
  });
});
