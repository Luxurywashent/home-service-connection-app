import React, { act, useLayoutEffect } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyCreateJobSheet, type CompanyCreateJobSheetProps } from "../components/company-create-job-sheet";
import { useCompanyJobQuote } from "../hooks/use-company-job-quote";
import { type JobSyncNativeSession, type JobSyncCompanyJobQuoteInput, type JobSyncCompanyJobQuote } from "../lib/jobsync-mobile-api";

vi.mock("../lib/company-job-creation-storage", async () => {
  const { memoryCreationStorageModule } = await import("./helpers/company-creation-memory-store");
  return memoryCreationStorageModule();
});
const mocks = vi.hoisted(() => ({ focused: true, signed: vi.fn(), customers: vi.fn(), customer: vi.fn(), settings: vi.fn(),
  quote: vi.fn(), create: vi.fn(), detail: vi.fn(), jobs: vi.fn(), operation: vi.fn(), priceBook: vi.fn(), refresh: vi.fn(), verify: vi.fn(),
  catalog: [] as any[], hasLoaded: true, loading: false, error: null as string | null }));
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ foreground: "#fff", background: "#fff", surface: "#fff", border: "#ccc", primary: "#0068ff", muted: "#555", error: "#b00" }) }));
vi.mock("@/hooks/use-company-price-book", () => ({ useCompanyPriceBook: () => ({ services: mocks.catalog, isLoading: mocks.loading, error: mocks.error, hasLoaded: mocks.hasLoaded, refresh: mocks.refresh }) }));
vi.mock("@/hooks/use-company-fieldwork-calendar", () => ({ useCompanyFieldworkCalendar: () => ({ members: [{ id: 50, name: "Verified member", employeeId: "jobsync-50" }], loading: false, error: null, verifyAssignment: mocks.verify }) }));
vi.mock("../lib/jobsync-mobile-api", async (original) => ({ ...await original<typeof import("../lib/jobsync-mobile-api")>(),
  getJobSyncMobileSession: mocks.signed, getJobSyncCompanyCustomers: mocks.customers, getJobSyncCompanyCustomer: mocks.customer,
  getJobSyncCompanySettings: mocks.settings, getHomeServiceConnectedPriceBook: mocks.priceBook,
  quoteJobSyncCompanyJob: mocks.quote, createJobSyncCompanyJob: mocks.create, getJobSyncCompanyJobDetail: mocks.detail,
  getJobSyncCompanyJobs: mocks.jobs, getJobSyncCompanyJobCreationOperation: mocks.operation,
}));
vi.mock("@react-native-community/datetimepicker", () => ({ default: () => null }));
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => R.createElement(name, { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; } }, props.children);
  return { Modal: host("native-modal"), View: host("native-view"), Text: host("native-text"), TextInput: host("native-input"),
    TouchableOpacity: host("native-touch"), ActivityIndicator: host("activity-indicator"), ScrollView: host("native-scroll"), KeyboardAvoidingView: host("native-keyboard"),
    FlatList: (props: any) => R.createElement("native-list", { ref: (node: any) => { if (node) node.nativeProps = props; } }, props.data.length ? props.data.map((item: any, index: number) => R.createElement(R.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index }))) : props.ListEmptyComponent),
    Platform: { OS: "web" }, StyleSheet: { create: (value: any) => value } };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
let sequence = 92000;
function actor(): JobSyncNativeSession { return { token: `offline-ui-${++sequence}`, portal: "company", user: { id: sequence, name: "Owner", email: null, role: "owner" }, company: { id: 9, name: "Company", slug: "company", logoUrl: null, primaryColor: null, accentColor: null } }; }
function service(id: number, patch: Record<string, unknown> = {}) { return { serviceId: String(id), name: `Returned service ${id}`, vehiclePrices: {}, basePrice: 125, defaultDurationMinutes: 45, features: [], description: `Returned description ${id}`, sortOrder: id, imageUrl: null, serviceTypeId: null, emoji: "", ...patch }; }
const customer = () => ({ id: 7, name: "Verified Customer", firstName: "Verified", lastName: "Customer", phone: "5551234567", email: null, addressLine1: "Canonical address", city: "Returned city", region: "FL", postalCode: "32501" });
// Deliberately different from catalog rates, and not computed in the UI or this fixture.
function quote(input: JobSyncCompanyJobQuoteInput, patch: Record<string, unknown> = {}): JobSyncCompanyJobQuote {
  return { lines: input.lineItems.map((line) => ({ priceBookItemId: line.priceBookItemId, name: `Server service ${line.priceBookItemId}`,
    quantity: line.quantity, unitPrice: 77, lineTotal: 154, durationMinutes: 47, taxable: true, vehiclePriceKey: line.vehiclePriceKey ?? null })),
    subtotal: 308, discount: input.discount ? 12 : 0, discountKind: input.discount?.kind ?? null, discountCode: input.discount?.code?.trim() || null,
    taxableSubtotal: 296, taxRateBps: 650, tax: 19.24, total: 315.24, totalDurationMinutes: 94,
    recurrence: null, persistence: { taxStored: true, note: "Server stores pricing" }, ...patch } as JobSyncCompanyJobQuote;
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let root: ReturnType<typeof createRoot>; let container: PhotoTestNode; let props: CompanyCreateJobSheetProps; let ack: any;
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function maybe(label: string) { return all().find((item) => item.nativeProps?.accessibilityLabel === label); }
function node(label: string) { const found = maybe(label); if (!found) throw new Error(`Missing ${label}; ${container.textContent}`); return found; }
function byId(id: string) { return all().find((item) => item.nativeProps?.testID === id); }
async function render(patch: Partial<CompanyCreateJobSheetProps> = {}) { props = { ...props, ...patch }; await act(async () => root.render(<CompanyCreateJobSheet {...props} />)); }
async function press(label: string) { await act(async () => { node(label).nativeProps.onPress(); }); }
async function input(label: string, text: string) { await act(async () => { node(label).nativeProps.onChangeText(text); }); }
async function add(id = 31) { await press(maybe("Choose Service") ? "Choose Service" : "Add Another Service"); await press(`Returned service ${id}`); await press("Add selected service"); }
async function ready() { await render(); await input("Find Company customer", "Verified"); await press("Verified Customer · 5551234567"); await add(); }
beforeEach(() => {
  vi.resetAllMocks(); mocks.focused = true; mocks.hasLoaded = true; mocks.loading = false; mocks.error = null; ack = null;
  const doc = installPhotoTestDOM(); container = doc.createElement("main"); doc.body.appendChild(container); root = createRoot(container);
  props = { visible: true, session: actor(), initialDate: "2026-12-01", initialStartHour: 9, initialEndHour: 10, closeOnSuccess: false, isCurrent: () => true, onClose: vi.fn(), onCreated: vi.fn() };
  mocks.catalog = [service(31), service(32), service(33, { basePrice: 0, vehiclePrices: { "returned-tier-a": 180, "returned-tier-b": 240 } })];
  mocks.signed.mockImplementation(async () => props.session); mocks.customers.mockResolvedValue([customer()]); mocks.customer.mockResolvedValue(customer());
  mocks.settings.mockResolvedValue({ id: 9, name: "Company", timezone: "America/Chicago" }); mocks.priceBook.mockImplementation(async () => mocks.catalog);
  mocks.verify.mockResolvedValue(true); mocks.refresh.mockResolvedValue(undefined); mocks.jobs.mockResolvedValue([]);
  mocks.quote.mockImplementation(async (_token, _companyId, request) => quote(request));
  mocks.operation.mockImplementation(async (_token, _companyId, key) => ({ key, state: ack ? "saved" : "unknown", jobId: ack?.id ?? null, rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null }));
  mocks.create.mockImplementation(async (_token, companyId, request) => {
    const server = quote(request);
    const pricing = { lineItems: server.lines.map((line, index) => ({ id: 600 + index, priceBookItemId: line.priceBookItemId, name: line.name, quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal, sortOrder: index })),
      subtotalAmount: server.subtotal, discountAmount: server.discount, taxAmount: server.tax, taxRateBps: server.taxRateBps, discountKind: server.discountKind, discountCode: server.discountCode, totalAmount: server.total };
    ack = { id: 84, companyId, priceBookServiceId: request.priceBookServiceId, customerId: request.customerId ?? 77, assignedUserId: request.assignedUserId ?? null,
      scheduledStartAt: request.scheduledStartAt, scheduledEndAt: request.scheduledEndAt ?? "2026-12-01T16:00:00.000Z", amount: server.total, serviceName: "Server service 31", status: "scheduled", pricing,
      operation: { key: request.operationKey, state: "saved", replayed: false } }; return ack;
  });
  mocks.detail.mockImplementation(async () => ({ ...ack, photos: [], persistedPhotoIds: [] }));
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live requests forbidden")));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe("multi-service compact sheet — actual React, real durable controller, mocked I/O", () => {
  it("adds/edits/removes returned services, retains unique IDs, and uses the same compact sheet and picker", async () => {
    await ready(); await add(32);
    expect(byId("company-booking-sheet")).toBeTruthy(); expect(byId("company-job-draft-line-31")).toBeTruthy(); expect(byId("company-job-draft-line-32")).toBeTruthy();
    await press("Add Another Service"); expect(byId("company-booking-pricebook-list")!.textContent).not.toContain("Returned service 31"); expect(byId("company-booking-pricebook-list")!.textContent).not.toContain("Returned service 32"); await press("Cancel service selection");
    await press("Returned service 31"); await press("Returned service 33"); await press("Add selected service");
    expect(byId("company-job-draft-line-31")).toBeUndefined(); expect(byId("company-job-draft-line-33")).toBeTruthy();
    await press("Remove service 1"); expect(byId("company-job-draft-line-33")).toBeUndefined(); expect(node("Service 1 quantity").nativeProps.value).toBe("1");
  });
  it("does not apply canceled or superseded picker confirmations even when their handlers are retained", async () => {
    await ready(); await press("Add Another Service"); await press("Returned service 32"); const canceled = node("Add selected service").nativeProps.onPress;
    await press("Cancel service selection"); await act(async () => canceled()); expect(byId("company-job-draft-line-32")).toBeUndefined();
    await press("Add Another Service"); await press("Returned service 32"); const superseded = node("Add selected service").nativeProps.onPress; await press("Returned service 33");
    await act(async () => superseded()); expect(byId("company-job-draft-line-32")).toBeUndefined(); expect(byId("company-booking-pricebook-overlay")).toBeTruthy();
    await press("Add selected service"); expect(byId("company-job-draft-line-33")).toBeTruthy();
  });
  it("requires integer quantities 1–100 and never sends invalid draft quantities for quote or creation", async () => {
    await ready();
    for (const invalid of ["", "0", "101", "1.5", "1e1", "-1", "garbage"]) {
      const count = mocks.quote.mock.calls.length; await input("Service 1 quantity", invalid);
      expect(node("Save Company Job").nativeProps.disabled).toBe(true); expect(byId("company-job-server-quote")).toBeUndefined(); expect(mocks.quote).toHaveBeenCalledTimes(count);
    }
    await input("Service 1 quantity", "100"); expect(mocks.quote.mock.calls.at(-1)![2].lineItems).toEqual([{ priceBookItemId: 31, quantity: 100 }]);
    expect(node("Save Company Job").nativeProps.disabled).toBe(false); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("allows only returned tiers per line and preserves quantity while editing a service", async () => {
    await ready(); await add(33); expect(node("Save Company Job").nativeProps.disabled).toBe(true);
    await press("Service 2 rate 2 · $240.00 catalog unit"); await input("Service 2 quantity", "3");
    expect(mocks.quote.mock.calls.at(-1)![2].lineItems).toEqual([{ priceBookItemId: 31, quantity: 1 }, { priceBookItemId: 33, quantity: 3, vehiclePriceKey: "returned-tier-b" }]);
    expect(container.textContent).not.toContain("SUV"); expect(container.textContent).not.toContain("Truck");
    await press("Returned service 33"); await press("Returned service 32"); await press("Add selected service");
    expect(node("Service 2 quantity").nativeProps.value).toBe("3"); expect(mocks.quote.mock.calls.at(-1)![2].lineItems[1]).toEqual({ priceBookItemId: 32, quantity: 3 });
  });
  it("supports flat/percent discount intent and optional code, with no client totals or duration arithmetic", async () => {
    await ready(); await add(32); await press("Flat discount"); expect(node("Save Company Job").nativeProps.disabled).toBe(true);
    await input("Discount value", "20"); await input("Discount code (optional)", " PROMO ");
    expect(mocks.quote.mock.calls.at(-1)![2]).toEqual({ lineItems: [{ priceBookItemId: 31, quantity: 1 }, { priceBookItemId: 32, quantity: 1 }], discount: { kind: "flat", value: 20, code: "PROMO" } });
    const summary = byId("company-job-server-quote")!.textContent;
    for (const returned of ["Unit $77.00", "Qty 1", "Line $154.00", "Subtotal $308.00", "Discount $12.00", "Tax $19.24", "Final quote total $315.24", "Combined service duration 94 min"]) expect(summary).toContain(returned);
    expect(container.textContent).toContain("Catalog unit rate"); expect(summary).not.toContain("$125.00");
    await press("Percent discount"); await input("Discount value", "101"); expect(node("Save Company Job").nativeProps.disabled).toBe(true);
    await input("Discount value", "10"); expect(mocks.quote.mock.calls.at(-1)![2].discount).toEqual({ kind: "percent", value: 10, code: "PROMO" });
    await press("No discount"); expect(mocks.quote.mock.calls.at(-1)![2]).not.toHaveProperty("discount");
  });
  it("immediately retires pricing, late responses and retained Save when a quantity changes", async () => {
    await ready(); const retainedSave = node("Save Company Job").nativeProps.onPress;
    const wait = deferred<JobSyncCompanyJobQuote>(); mocks.quote.mockReturnValueOnce(wait.promise);
    await act(async () => { node("Service 1 quantity").nativeProps.onChangeText("2"); retainedSave(); });
    expect(mocks.create).not.toHaveBeenCalled(); expect(byId("company-job-server-quote")).toBeUndefined(); expect(node("Save Company Job").nativeProps.disabled).toBe(true);
    await input("Service 1 quantity", "3"); expect(byId("company-job-server-quote")).toBeTruthy();
    await act(async () => wait.resolve(quote({ lineItems: [{ priceBookItemId: 31, quantity: 2 }] }, { total: 999 })));
    expect(byId("company-job-server-quote")!.textContent).toContain("Qty 3"); expect(container.textContent).not.toContain("$999.00");
    await act(async () => retainedSave()); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("re-quotes normalized-equivalent raw edits and leaves unchanged selection confirmation usable", async () => {
    await ready(); const oldSave = node("Save Company Job").nativeProps.onPress;
    const count = mocks.quote.mock.calls.length; await input("Service 1 quantity", "01"); expect(mocks.quote).toHaveBeenCalledTimes(count + 1);
    await act(async () => oldSave()); expect(mocks.create).not.toHaveBeenCalled();
    await press("Returned service 31"); await press("Add selected service"); expect(node("Save Company Job").nativeProps.disabled).toBe(false);
    const next = mocks.quote.mock.calls.length; await press("No discount"); expect(mocks.quote).toHaveBeenCalledTimes(next); expect(node("Save Company Job").nativeProps.disabled).toBe(false);
  });
  it("invalidates an old discount quote/code and refuses a late quote or retained handler", async () => {
    await ready(); await press("Flat discount"); await input("Discount value", "5"); await input("Discount code (optional)", "OLD");
    const oldSave = node("Save Company Job").nativeProps.onPress; const oldCodeEdit = node("Discount code (optional)").nativeProps.onChangeText;
    const wait = deferred<JobSyncCompanyJobQuote>(); mocks.quote.mockReturnValueOnce(wait.promise); await input("Discount code (optional)", "NEW");
    expect(byId("company-job-server-quote")).toBeUndefined(); await press("Percent discount");
    await act(async () => { oldCodeEdit("RETAINED"); oldSave(); wait.resolve(quote({ lineItems: [{ priceBookItemId: 31, quantity: 1 }], discount: { kind: "flat", value: 5, code: "NEW" } }, { total: 777 })); });
    expect(mocks.create).not.toHaveBeenCalled(); expect(node("Discount code (optional)").nativeProps.value).toBe("NEW");
    expect(byId("company-job-server-quote")!.textContent).toContain("(percent)"); expect(container.textContent).not.toContain("$777.00");
  });
  it("retires a quote when the catalog changes and fails closed when a selected service disappears", async () => {
    await ready(); const oldSave = node("Save Company Job").nativeProps.onPress; const wait = deferred<JobSyncCompanyJobQuote>(); mocks.quote.mockReturnValueOnce(wait.promise);
    mocks.catalog = mocks.catalog.map((row) => ({ ...row, basePrice: 999 })); await render(); expect(byId("company-job-server-quote")).toBeUndefined();
    await act(async () => oldSave()); expect(mocks.create).not.toHaveBeenCalled();
    mocks.catalog = mocks.catalog.filter((row) => row.serviceId !== "31"); await render();
    await act(async () => wait.resolve(quote({ lineItems: [{ priceBookItemId: 31, quantity: 1 }] }, { total: 999 })));
    expect(node("Save Company Job").nativeProps.disabled).toBe(true); expect(byId("company-job-server-quote")).toBeUndefined(); expect(container.textContent).toContain("Selected service is unavailable");
  });
  it("rejects retained Save after customer identity, time, assignment or notes change while preserving the bound price", async () => {
    await ready(); await press("New Customer"); await input("First name (required)", "New"); await input("Last name (required)", "Customer");
    const nameSave = node("Save Company Job").nativeProps.onPress; await input("First name (required)", "Edited"); await act(async () => nameSave()); expect(mocks.create).not.toHaveBeenCalled();
    const assignmentSave = node("Save Company Job").nativeProps.onPress; await press("Verified member"); await act(async () => assignmentSave()); expect(mocks.create).not.toHaveBeenCalled();
    await press("More Details"); const noteSave = node("Save Company Job").nativeProps.onPress; await input("Service notes", "Edited note"); await act(async () => noteSave()); expect(mocks.create).not.toHaveBeenCalled();
    const timeSave = node("Save Company Job").nativeProps.onPress;
    const time = all().find((item) => item.attributes["aria-label"] === "Start time")!;
    const reactProps = Object.entries(time).find(([key]) => key.startsWith("__reactProps"))![1] as any;
    await act(async () => reactProps.onChange({ target: { value: "09:30" } })); await act(async () => timeSave()); expect(mocks.create).not.toHaveBeenCalled();
    expect(byId("company-job-server-quote")).toBeTruthy(); expect(node("Save Company Job").nativeProps.disabled).toBe(false);
  });
  it.each(["hidden", "unfocused", "stale", "token", "tenant", "role"])("blocks retained actions and late responses after %s", async (change) => {
    await ready(); const oldSave = node("Save Company Job").nativeProps.onPress; const oldRefresh = node("Refresh server pricing").nativeProps.onPress;
    const wait = deferred<JobSyncCompanyJobQuote>(); mocks.quote.mockReturnValueOnce(wait.promise); await press("Refresh server pricing");
    const replacement = structuredClone(props.session!);
    if (change === "hidden") await render({ visible: false });
    else if (change === "unfocused") { mocks.focused = false; await render(); }
    else if (change === "stale") await render({ isCurrent: () => false });
    else { if (change === "token") replacement.token += "-changed"; if (change === "tenant") replacement.company!.id = 10; if (change === "role") replacement.user.role = "technician"; await render({ session: replacement }); }
    const requests = mocks.quote.mock.calls.length;
    await act(async () => { oldSave(); oldRefresh(); wait.resolve(quote({ lineItems: [{ priceBookItemId: 31, quantity: 1 }] }, { total: 888 })); });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.quote).toHaveBeenCalledTimes(requests); expect(container.textContent).not.toContain("$888.00");
  });
  it.each(["unpublished", "tax-not-stored", "missing-total", "missing-duration", "wrong-line", "wrong-quantity", "wrong-tier"])("fails closed for %s pricing with honest error and no save", async (failure) => {
    if (failure === "unpublished") mocks.quote.mockRejectedValue(new Error("Quote endpoint not deployed (404)"));
    else mocks.quote.mockImplementation(async (_token, _companyId, request) => {
      const result: any = quote(request);
      if (failure === "tax-not-stored") result.persistence.taxStored = false;
      if (failure === "missing-total") delete result.total;
      if (failure === "missing-duration") delete result.totalDurationMinutes;
      if (failure === "wrong-line") result.lines[0].priceBookItemId = 32;
      if (failure === "wrong-quantity") result.lines[0].quantity = 2;
      if (failure === "wrong-tier") result.lines[0].vehiclePriceKey = "not-selected";
      return result;
    });
    await ready(); expect(node("Save Company Job").nativeProps.disabled).toBe(true); expect(byId("company-job-server-quote")).toBeUndefined();
    expect(container.textContent).toContain("Server pricing is unavailable"); expect(container.textContent).toContain("stored tax support");
    await press("Save Company Job"); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("requires exact quote line order before exposing a multi-service total", async () => {
    await ready(); mocks.quote.mockImplementation(async (_token, _companyId, request) => { const result = quote(request); result.lines.reverse(); return result; });
    await add(32); expect(byId("company-job-server-quote")).toBeUndefined(); expect(node("Save Company Job").nativeProps.disabled).toBe(true); expect(container.textContent).toContain("complete bound quote");
  });
  it("submits lineItems directly through the existing controller/durable key and hides draft quote while saving/saved", async () => {
    await ready(); await add(32); await input("Service 2 quantity", "2"); await press("Verified member"); await press("More Details"); await input("Service notes", "Preserved note"); await input("Private notes", "Private draft");
    await press("Flat discount"); await input("Discount value", "20"); await input("Discount code (optional)", "PROMO");
    const save = node("Save Company Job").nativeProps.onPress;
    await act(async () => { save(); save(); });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const request = mocks.create.mock.calls[0][2];
    expect(request).toMatchObject({ customerId: 7, assignedUserId: 50, lineItems: [{ priceBookItemId: 31, quantity: 1 }, { priceBookItemId: 32, quantity: 2 }], discount: { kind: "flat", value: 20, code: "PROMO" }, serviceNotes: "Preserved note", privateNotes: "Private draft", operationKey: expect.stringMatching(/^hsc-job-test-key-/) });
    for (const forbidden of ["subtotal", "total", "tax", "duration", "recurrence", "unitPrice"]) expect(request).not.toHaveProperty(forbidden);
    expect(props.onCreated).toHaveBeenCalledTimes(1); expect(byId("company-job-server-quote")).toBeUndefined(); expect(container.textContent).not.toContain("Server quote $315.24");
    expect(container.textContent).toContain("not saved or recovered Job pricing");
  });
  it("requires a second fresh server quote in the controller and does not POST if backend goes unavailable after preview", async () => {
    await ready(); mocks.quote.mockRejectedValue(new Error("Backend quote unavailable on save")); await press("Save Company Job");
    expect(mocks.create).not.toHaveBeenCalled(); expect(container.textContent).toContain("Backend quote unavailable on save"); expect(node("Save Company Job").nativeProps.disabled).toBe(true);
  });
  it("keeps uncertain recovery GET-only and never presents edited draft pricing as the recovered Job", async () => {
    await ready(); mocks.create.mockRejectedValue(new Error("Lost response")); await press("Save Company Job");
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(node("Save Company Job").nativeProps.disabled).toBe(true); expect(byId("company-job-server-quote")).toBeUndefined();
    const count = mocks.quote.mock.calls.length; await input("Service 1 quantity", "9"); await press("Refresh saved Job without resending");
    expect(node("Service 1 quantity").nativeProps.value).toBe("1"); expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.quote).toHaveBeenCalledTimes(count); expect(props.onCreated).not.toHaveBeenCalled();
  });
  it("retains customer/time/assignment/note modes with available default ON and explicit booking-confirmation OFF capture", async () => {
    await ready(); await press("Verified member"); await press("More Details"); await input("Service notes", "Keep note"); await input("Private notes", "Keep private");
    await press("New Customer"); expect(node("Save Company Job").nativeProps.disabled).toBe(true); expect(node("First name (required)").nativeProps.value).toBe("");
    await input("First name (required)", "New"); await input("Last name (required)", "Customer"); expect(node("Save Company Job").nativeProps.disabled).toBe(false);
    expect(node("Service 1 quantity").nativeProps.value).toBe("1"); expect(node("Service notes").nativeProps.value).toBe("Keep note"); expect(node("Private notes").nativeProps.value).toBe("Keep private");
    expect(node("Verified member").nativeProps.accessibilityState.selected).toBe(true);
    expect(all().some((item) => item.tagName === "NATIVE-TEXT" && item.textContent === "Notify customer")).toBe(true);
    expect(node("Notify customer").nativeProps).toMatchObject({ accessibilityRole: "switch", disabled: false, accessibilityState: { checked: true, disabled: false } });
    const oldSave = node("Save Company Job").nativeProps.onPress; const quoteCalls = mocks.quote.mock.calls.length;
    await press("Notify customer"); expect(node("Notify customer").nativeProps.accessibilityState.checked).toBe(false);
    await act(async () => oldSave()); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.quote).toHaveBeenCalledTimes(quoteCalls);
    expect(byId("company-job-server-quote")!.textContent).toContain("Final quote total $315.24");
    mocks.customer.mockResolvedValueOnce({ id: 77, companyId: 9, firstName: "New", lastName: "Customer" });
    await press("Save Company Job"); expect(mocks.create).toHaveBeenCalledOnce();
    const request = mocks.create.mock.calls[0][2];
    expect(request).toMatchObject({ notifyCustomer: false, newCustomer: { firstName: "New", lastName: "Customer" }, assignedUserId: 50,
      lineItems: [{ priceBookItemId: 31, quantity: 1 }], serviceNotes: "Keep note", privateNotes: "Keep private",
      scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T16:00:00.000Z", operationKey: expect.stringMatching(/^hsc-job-test-key-/) });
    expect(request).not.toHaveProperty("customerId"); expect(Object.isFrozen(request)).toBe(true);
    expect(mocks.customer).toHaveBeenLastCalledWith(props.session!.token, 77, 9);
    expect(props.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 84, amount: 315.24 }), "America/Chicago");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("captures untouched default ON explicitly and resets ON for the next opened sheet", async () => {
    await ready(); expect(node("Notify customer").nativeProps.accessibilityState.checked).toBe(true);
    await press("Save Company Job"); expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.create.mock.calls[0][2].notifyCustomer).toBe(true);
    await render({ visible: false }); await render({ visible: true, session: actor() });
    expect(node("Notify customer").nativeProps).toMatchObject({ disabled: false, accessibilityState: { checked: true, disabled: false } });
    await press("Notify customer"); expect(node("Notify customer").nativeProps.accessibilityState.checked).toBe(false);
    await render({ visible: false }); await render({ visible: true, session: actor() });
    expect(node("Notify customer").nativeProps.accessibilityState.checked).toBe(true);
    expect(mocks.create).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it("locks explicit OFF through pending saved-operation recovery without another POST or draft quote", async () => {
    await ready(); await press("Notify customer"); const retainedToggle = node("Notify customer").nativeProps.onPress;
    const save = mocks.create.getMockImplementation()!;
    mocks.create.mockImplementationOnce(async (...args) => { await save(...args); throw new Error("Lost saved response"); });
    mocks.operation.mockImplementationOnce(async (_token, _companyId, key) => ({ key, state: "pending", jobId: null,
      rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null }));
    await press("Save Company Job"); expect(mocks.create).toHaveBeenCalledOnce();
    const request = mocks.create.mock.calls[0][2]; expect(request.notifyCustomer).toBe(false); expect(Object.isFrozen(request)).toBe(true);
    expect(node("Notify customer").nativeProps).toMatchObject({ disabled: true, accessibilityState: { checked: false, disabled: true } });
    await act(async () => retainedToggle()); expect(node("Notify customer").nativeProps.accessibilityState.checked).toBe(false);
    expect(byId("company-job-server-quote")).toBeUndefined(); expect(props.onCreated).not.toHaveBeenCalled();
    const quoteCalls = mocks.quote.mock.calls.length;
    await press("Refresh saved Job without resending");
    expect(mocks.operation).toHaveBeenCalledTimes(2);
    for (const [, , key] of mocks.operation.mock.calls) expect(key).toBe(request.operationKey);
    expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.quote).toHaveBeenCalledTimes(quoteCalls);
    expect(request.notifyCustomer).toBe(false); expect(byId("company-job-server-quote")).toBeUndefined();
    expect(props.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 84, amount: 315.24 }), "America/Chicago");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds the draft to 50 unique lines without hardcoded catalog choices", async () => {
    mocks.catalog = Array.from({ length: 51 }, (_, index) => service(100 + index));
    await render(); for (let id = 100; id < 150; id++) await add(id);
    expect(all().filter((item) => item.nativeProps?.testID?.startsWith("company-job-draft-line-")).length).toBe(50);
    expect(maybe("Add Another Service")).toBeUndefined(); expect(container.textContent).toContain("Maximum 50 services");
    expect(mocks.quote.mock.calls.at(-1)![2].lineItems).toHaveLength(50); expect(mocks.create).not.toHaveBeenCalled();
  });
});

let hookResult: ReturnType<typeof useCompanyJobQuote>;
const renderObserved: string[] = [];
let layoutObserved: JobSyncCompanyJobQuote | null;
function QuoteRenderEvidence({ text }: { text: string }) {
  // Child layout effects run before the harness's hook/layout effects. Keep
  // every DOM observation so a later layout-triggered render cannot erase it.
  useLayoutEffect(() => { renderObserved.push(container.textContent); });
  return <span>{text}</span>;
}
function QuoteHarness({ session, request, enabled = true, isCurrent = () => true }: { session: JobSyncNativeSession | null; request: JobSyncCompanyJobQuoteInput | null; enabled?: boolean; isCurrent?: () => boolean }) {
  const result = useCompanyJobQuote({ session, input: request, enabled, isCurrent });
  useLayoutEffect(() => { hookResult = result; layoutObserved = result.quote; });
  return <QuoteRenderEvidence text={result.quote ? `Bound ${result.quote.total}` : "No bound quote"} />;
}
describe("quote hook binding — actual render/commit lifecycle", () => {
  it("hides a previous quote in the first render and layout after inputs change, without waiting for passive effects", async () => {
    const signed = props.session!; const a = { lineItems: [{ priceBookItemId: 31, quantity: 1 }] }; const b = { lineItems: [{ priceBookItemId: 31, quantity: 2 }] };
    await act(async () => root.render(<QuoteHarness session={signed} request={a} />)); expect(hookResult.quote).toBeTruthy(); const old = hookResult.getBoundQuote; const oldRefresh = hookResult.refresh;
    mocks.quote.mockReturnValueOnce(deferred<JobSyncCompanyJobQuote>().promise);
    renderObserved.length = 0;
    await act(async () => root.render(<QuoteHarness session={signed} request={b} />)); expect(renderObserved[0]).toBe("No bound quote"); expect(layoutObserved!).toBeNull(); expect(old()).toBeNull();
    const count = mocks.quote.mock.calls.length; await act(async () => oldRefresh()); expect(mocks.quote).toHaveBeenCalledTimes(count);
  });
  it("captures/freezes nested inputs before authentication awaits and refuses a revoked signed session", async () => {
    const signed = props.session!; const auth = deferred<JobSyncNativeSession>(); const request: JobSyncCompanyJobQuoteInput = { lineItems: [{ priceBookItemId: 31, quantity: 2 }], discount: { kind: "flat", value: 5, code: "ORIGINAL" } };
    mocks.signed.mockReturnValueOnce(auth.promise);
    await act(async () => root.render(<QuoteHarness session={signed} request={request} />)); request.lineItems[0].quantity = 99; request.discount!.value = 99; request.discount!.code = "MUTATED";
    await act(async () => auth.resolve(signed)); expect(mocks.quote.mock.calls[0][2]).toEqual({ lineItems: [{ priceBookItemId: 31, quantity: 2 }], discount: { kind: "flat", value: 5, code: "ORIGINAL" } });
    expect(Object.isFrozen(mocks.quote.mock.calls[0][2])).toBe(true); expect(Object.isFrozen(mocks.quote.mock.calls[0][2].lineItems[0])).toBe(true);
    const old = hookResult.getBoundQuote; const revoked = structuredClone(signed); revoked.token = "revoked"; mocks.signed.mockResolvedValue(revoked);
    await act(async () => { void hookResult.refresh(); }); expect(hookResult.quote).toBeNull(); expect(old()).toBeNull(); expect(hookResult.error).toContain("sign-in changed");
  });
  it("does not revive A quotes or retained handlers through A→B→A, disable/enable or unmount", async () => {
    const signed = props.session!; const a = { lineItems: [{ priceBookItemId: 31, quantity: 1 }] }; const b = { lineItems: [{ priceBookItemId: 32, quantity: 1 }] };
    await act(async () => root.render(<QuoteHarness session={signed} request={a} />)); const old = hookResult.getBoundQuote;
    await act(async () => root.render(<QuoteHarness session={signed} request={b} />)); await act(async () => root.render(<QuoteHarness session={signed} request={a} />)); expect(old()).toBeNull();
    const next = hookResult.getBoundQuote; await act(async () => root.render(<QuoteHarness session={signed} request={a} enabled={false} />)); expect(hookResult.quote).toBeNull(); expect(next()).toBeNull();
    const count = mocks.quote.mock.calls.length; await act(async () => hookResult.refresh()); expect(mocks.quote).toHaveBeenCalledTimes(count);
    await act(async () => root.render(<QuoteHarness session={signed} request={a} />)); const retained = hookResult.refresh; await act(async () => root.render(null)); await act(async () => retained()); expect(mocks.quote).toHaveBeenCalledTimes(count + 1);
  });
  it("retires the binding when isCurrent becomes false and obtains a new quote on reactivation", async () => {
    const signed = props.session!; const request = { lineItems: [{ priceBookItemId: 31, quantity: 1 }] }; let current = true; const isCurrent = () => current;
    await act(async () => root.render(<QuoteHarness session={signed} request={request} isCurrent={isCurrent} />)); const retained = hookResult.getBoundQuote; expect(retained()).toBeTruthy();
    current = false; await act(async () => root.render(<QuoteHarness session={signed} request={request} isCurrent={isCurrent} />)); expect(hookResult.quote).toBeNull(); expect(retained()).toBeNull();
    mocks.quote.mockReturnValueOnce(deferred<JobSyncCompanyJobQuote>().promise); current = true;
    renderObserved.length = 0;
    await act(async () => root.render(<QuoteHarness session={signed} request={request} isCurrent={isCurrent} />)); expect(renderObserved[0]).toBe("No bound quote"); expect(hookResult.quote).toBeNull(); expect(retained()).toBeNull();
  });
});


it("refreshes pricing after fast preflight failure but creates only on a deliberate fresh Save", async () => {
  await ready();
  const retainedSave = node("Save Company Job").nativeProps.onPress;
  mocks.quote.mockRejectedValueOnce(new Error("Isolated preflight quote failed"));
  await press("Save Company Job");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.quote).toHaveBeenCalledTimes(3); // Preview, failed preflight, new read-only preview.
  expect(container.textContent).toContain("Isolated preflight quote failed");
  expect(byId("company-job-server-quote")).toBeTruthy();
  expect(node("Save Company Job").nativeProps.disabled).toBe(false);
  await act(async () => retainedSave());
  expect(mocks.create).not.toHaveBeenCalled();
  await press("Save Company Job");
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.create.mock.calls[0][2]).toMatchObject({
    lineItems: [{ priceBookItemId: 31, quantity: 1 }],
    operationKey: expect.stringMatching(/^hsc-job-test-key-/),
  });
});
