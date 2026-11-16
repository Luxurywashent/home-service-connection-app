import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyCreateJobSheet, type CompanyCreateJobSheetProps } from "../components/company-create-job-sheet";
import type { JobSyncNativeSession } from "../lib/jobsync-mobile-api";
vi.mock("../lib/company-job-creation-storage", async () => { const { memoryCreationStorageModule } = await import("./helpers/company-creation-memory-store"); return memoryCreationStorageModule(); });
const mocks = vi.hoisted(() => ({ focused: true, signed: vi.fn(), customers: vi.fn(), customer: vi.fn(), settings: vi.fn(), create: vi.fn(), detail: vi.fn(), jobs: vi.fn(), operation: vi.fn(), priceBook: vi.fn(), refresh: vi.fn(), verify: vi.fn(), catalog: [] as any[] }));
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ foreground: "#111", background: "#fff", surface: "#eee", border: "#ddd", primary: "#0077cc", muted: "#555", error: "#b00" }) }));
vi.mock("@/hooks/use-company-price-book", () => ({ useCompanyPriceBook: () => ({ services: mocks.catalog, isLoading: false, error: null, hasLoaded: true, refresh: mocks.refresh }) }));
vi.mock("@/hooks/use-company-fieldwork-calendar", () => ({ useCompanyFieldworkCalendar: () => ({ members: [{ name: "Technician", employeeId: "jobsync-50" }], loading: false, error: null, verifyAssignment: mocks.verify }) }));
vi.mock("../lib/jobsync-mobile-api", async original => ({ ...await original<typeof import("../lib/jobsync-mobile-api")>(), getJobSyncMobileSession: mocks.signed, getJobSyncCompanyCustomers: mocks.customers, getJobSyncCompanyCustomer: mocks.customer, getJobSyncCompanySettings: mocks.settings, getHomeServiceConnectedPriceBook: mocks.priceBook, createJobSyncCompanyJob: mocks.create, getJobSyncCompanyJobDetail: mocks.detail, getJobSyncCompanyJobs: mocks.jobs, getJobSyncCompanyJobCreationOperation: mocks.operation }));
vi.mock("@react-native-community/datetimepicker", () => ({ default: () => null }));
vi.mock("react-native", async () => {
  const R = await import("react"); const host = (name: string) => (props: Record<string, any>) => R.createElement(name, { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; } }, props.children);
  return { Modal: host("native-modal"), View: host("native-view"), Text: host("native-text"), TextInput: host("native-input"), TouchableOpacity: host("native-touch"), ActivityIndicator: host("activity-indicator"), ScrollView: host("native-scroll"), KeyboardAvoidingView: host("native-keyboard"), FlatList: (props: any) => R.createElement("native-list", null, props.data.map((item: any) => R.createElement(R.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item })))), Platform: { OS: "web" }, StyleSheet: { create: (value: any) => value } };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
let id = 57000; let root: ReturnType<typeof createRoot>; let container: PhotoTestNode; let props: CompanyCreateJobSheetProps; let ack: any; let createdCustomer: any;
function actor(): JobSyncNativeSession { const userId = ++id; return { token: `offline-ui-new-${userId}`, portal: "company", user: { id: userId, name: "Owner", role: "owner", email: null }, company: { id: 9, name: "Company", slug: "unit", logoUrl: null, primaryColor: null, accentColor: null } }; }
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap(child => all(child))]; }
function find(kind: string, label: string) { const node = all().find(n => n.nodeName === kind && n.nativeProps.accessibilityLabel === label); if (!node) throw new Error(`Missing ${label}`); return node; }
const button = (label: string) => find("NATIVE-TOUCH", label); const field = (label: string) => find("NATIVE-INPUT", label);
async function render(patch: Partial<CompanyCreateJobSheetProps> = {}) { props = { ...props, ...patch }; await act(async () => root.render(<CompanyCreateJobSheet {...props} />)); }
async function press(label: string) { await act(async () => button(label).nativeProps.onPress()); }
async function input(label: string, value: string) { await act(async () => field(label).nativeProps.onChangeText(value)); }
async function fillNew() { await press("New Customer"); await input("First name (required)", " Casey "); await input("Last name (required)", " Example "); await press("Service"); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const existing = () => ({ id: 7, companyId: 9, name: "Existing Customer", firstName: "Existing", lastName: "Customer", phone: "5551234567", email: "existing@example.test", addressLine1: "Existing Address", city: "Existing City", region: "FL", postalCode: "32501" });
beforeEach(() => {
  vi.resetAllMocks(); mocks.focused = true; ack = null; createdCustomer = null;
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  props = { visible: true, session: actor(), initialDate: "2026-12-01", initialStartHour: 9, initialEndHour: 10, isCurrent: () => true, onClose: vi.fn(), onCreated: vi.fn().mockResolvedValue(true) };
  mocks.catalog = [{ serviceId: "31", name: "Service", basePrice: 125, vehiclePrices: {}, emoji: "", description: "", features: [], imageUrl: null, sortOrder: 0, serviceTypeId: 444 }];
  mocks.signed.mockImplementation(async () => props.session); mocks.settings.mockImplementation(async () => ({ id: props.session!.company!.id, name: "Company", timezone: "America/Chicago" })); mocks.customers.mockResolvedValue([existing()]);
  mocks.customer.mockImplementation(async (_token, customerId) => customerId === 73 ? createdCustomer : existing()); mocks.priceBook.mockImplementation(async () => mocks.catalog); mocks.refresh.mockResolvedValue(undefined); mocks.verify.mockResolvedValue(true); mocks.jobs.mockResolvedValue([]);
  mocks.create.mockImplementation(async (_token, companyId, request) => {
    if (request.newCustomer) createdCustomer = { ...request.newCustomer, id: 73, companyId, name: `${request.newCustomer.firstName} ${request.newCustomer.lastName}` };
    ack = { id: 84, companyId, customerId: request.newCustomer ? 73 : request.customerId, priceBookServiceId: request.priceBookServiceId, assignedUserId: request.assignedUserId ?? null, scheduledStartAt: request.scheduledStartAt, scheduledEndAt: request.scheduledEndAt, amount: 125, operation: { key: request.operationKey, state: "saved", replayed: false } }; return ack;
  });
  mocks.detail.mockImplementation(async () => ({ ...ack, photos: [], enRouteAt: null, onSiteAt: null, completedAt: null }));
  mocks.operation.mockImplementation(async (_token, _company, key) => ({ key, state: ack ? "saved" : "unknown", jobId: ack?.id ?? null, rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null }));
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden")));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
describe("Add Job new customer additive form", () => {
  it("defaults to existing canonical prefill; mode change preserves service/rate/assignee/date/time but clears customer PII", async () => {
    mocks.catalog[0].basePrice = 0; mocks.catalog[0].vehiclePrices = { truck: 150 };
    await render({ customerPrefill: { customerId: 7, companyId: 9 } }); expect(button("Existing Customer").nativeProps.accessibilityState.selected).toBe(true); expect(field("Service address").nativeProps.value).toBe("Existing Address");
    await press("Service"); await press("truck · $150.00"); await press("Technician"); await input("Start time", "10:30"); await input("Service notes", "Job note"); await press("New Customer");
    expect(field("Service address").nativeProps.value).toBe(""); expect(container.textContent).not.toContain("existing@example.test"); expect(button("Service").nativeProps.accessibilityState.selected).toBe(true); expect(button("truck · $150.00").nativeProps.accessibilityState.selected).toBe(true); expect(button("Technician").nativeProps.accessibilityState.selected).toBe(true);
    expect(field("Company date").nativeProps.value).toBe("2026-12-01"); expect(field("Start time").nativeProps.value).toBe("10:30"); expect(field("Service notes").nativeProps.value).toBe("Job note"); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("required names and invalid optional contact have local feedback and no POST until corrected", async () => {
    await render(); await press("New Customer"); await press("Service"); expect(container.textContent).toContain("First name is required."); expect(container.textContent).toContain("Last name is required."); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    await input("First name (required)", "Casey"); await input("Last name (required)", "Example"); await input("Email (optional)", "bad@"); await input("Phone (optional)", "12"); expect(container.textContent).toContain("Email must be"); expect(container.textContent).toContain("Phone must contain"); await press("Save Company Job"); expect(mocks.create).not.toHaveBeenCalled();
    await input("Email (optional)", " "); await input("Phone (optional)", "+1 (555) 123-4567"); expect(button("Save Company Job").nativeProps.disabled).toBe(false); await press("Save Company Job");
    const payload = mocks.create.mock.calls[0][2]; expect(payload.newCustomer).toEqual({ firstName: "Casey", lastName: "Example", phone: "5551234567" }); expect(payload).not.toHaveProperty("customerId"); expect(mocks.create).toHaveBeenCalledOnce(); expect(props.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 84, customerId: 73 }), "America/Chicago");
  });
  it("seeds new customer address from current shared Job address without duplicate controls", async () => {
    await render(); await fillNew(); await input("Service address", " New Address "); await input("City", " New City "); await input("Region / state", " FL "); await input("Postal code", " 32501 "); await input("Email (optional)", " CASEY@example.test ");
    expect(all().filter(n => n.nodeName === "NATIVE-INPUT" && n.nativeProps.accessibilityLabel === "Service address")).toHaveLength(1); await press("Save Company Job"); const payload = mocks.create.mock.calls[0][2];
    expect(payload.newCustomer).toMatchObject({ firstName: "Casey", lastName: "Example", email: "casey@example.test", addressLine1: "New Address", city: "New City", region: "FL", postalCode: "32501" }); expect(payload.addressLine1).toBe("New Address"); expect(mocks.create).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["prefill", "manual"])("late %s existing lookup cannot overwrite new mode identity or address", async kind => {
    const read = deferred<any>(); mocks.customer.mockReturnValueOnce(read.promise); await render(kind === "prefill" ? { customerPrefill: { customerId: 7, companyId: 9 } } : {});
    if (kind === "manual") { await input("Find Company customer", "Existing"); await press("Existing Customer · 5551234567"); }
    await fillNew(); await input("Service address", "New Draft Address"); read.resolve(existing()); await act(async () => {});
    expect(field("First name (required)").nativeProps.value).toBe(" Casey "); expect(field("Service address").nativeProps.value).toBe("New Draft Address"); expect(container.textContent).not.toContain("Selected customer:"); expect(button("Save Company Job").nativeProps.disabled).toBe(false);
  });
  it("existing search failure does not falsely fail new creation, but signed settings are always required", async () => {
    mocks.customers.mockRejectedValue(new Error("Existing list offline")); await render(); expect(container.textContent).toContain("Existing Company customer search is unavailable"); await fillNew(); expect(container.textContent).not.toContain("Existing Company customer search is unavailable"); expect(button("Save Company Job").nativeProps.disabled).toBe(false); await press("Save Company Job"); expect(mocks.settings).toHaveBeenCalled(); expect(mocks.create).toHaveBeenCalledOnce();
  });
  it("unavailable signed Company settings block new customer even when existing search fails", async () => {
    mocks.customers.mockRejectedValue(new Error("List offline")); mocks.settings.mockRejectedValue(new Error("Company timezone unavailable")); await render(); await fillNew(); expect(container.textContent).toContain("Company timezone unavailable"); expect(button("Save Company Job").nativeProps.disabled).toBe(true); await press("Save Company Job"); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("returning to existing mode requires deliberate exact-ID selection and contains no retained new contact", async () => {
    await render(); await fillNew(); await input("Email (optional)", "new@example.test"); await input("Service address", "New Address"); await press("Existing Customer"); expect(field("Service address").nativeProps.value).toBe(""); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    await input("Find Company customer", "Existing"); await press("Existing Customer · 5551234567"); await press("Save Company Job"); expect(mocks.create.mock.calls[0][2]).toMatchObject({ customerId: 7, addressLine1: "Existing Address" }); expect(mocks.create.mock.calls[0][2]).not.toHaveProperty("newCustomer");
  });
  it("Company actor change remounts blank new fields and suppresses retained save callbacks", async () => {
    await render(); await fillNew(); await input("Email (optional)", "new@example.test"); const save = button("Save Company Job"); const second = actor(); second.company!.id = 10; await render({ session: second }); await act(async () => save.nativeProps.onPress());
    expect(button("Existing Customer").nativeProps.accessibilityState.selected).toBe(true); await press("New Customer"); expect(field("First name (required)").nativeProps.value).toBe(""); expect(field("Email (optional)").nativeProps.value).toBe(""); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("dropped response performs same-key status/detail/customer GET and calendar callback only once", async () => {
    await render(); await fillNew(); const original = mocks.create.getMockImplementation()!; mocks.create.mockImplementationOnce(async (...args) => { await original(...args); throw new Error("Simulated committed response loss"); });
    await press("Save Company Job"); expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.operation).toHaveBeenCalledWith(props.session!.token, 9, mocks.create.mock.calls[0][2].operationKey); expect(mocks.customer).toHaveBeenCalledWith(props.session!.token, 73, 9); expect(props.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 84, customerId: 73 }), "America/Chicago"); expect(props.onClose).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
});


describe("new-customer Add Job retained-handler exclusion", () => {
  it("pending duplicate Save presses produce one POST; unknown status locks mode changes and fields", async () => {
    await render(); await fillNew(); const waiting = deferred<any>(); mocks.create.mockReturnValueOnce(waiting.promise);
    const save = button("Save Company Job"); await act(async () => { save.nativeProps.onPress(); save.nativeProps.onPress(); });
    expect(mocks.create).toHaveBeenCalledOnce(); expect(button("New Customer").nativeProps.disabled).toBe(true);
    waiting.resolve(null); await act(async () => {}); expect(button("Save Company Job").nativeProps.disabled).toBe(true);
    await press("Existing Customer"); expect(field("First name (required)").nativeProps.value).toBe(" Casey ");
    await input("First name (required)", "Replacement"); expect(field("First name (required)").nativeProps.value).toBe(" Casey "); expect(mocks.create).toHaveBeenCalledOnce();
  });
  it("retained existing Save after mode change cannot dispatch stale customer intent", async () => {
    await render({ customerPrefill: { customerId: 7, companyId: 9 } }); await press("Service"); const oldSave = button("Save Company Job");
    await press("New Customer"); await act(async () => oldSave.nativeProps.onPress()); expect(mocks.create).not.toHaveBeenCalled(); expect(field("First name (required)").nativeProps.value).toBe("");
  });
});
