import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyCreateJobSheet, type CompanyCreateJobSheetProps } from "../components/company-create-job-sheet";
import { type JobSyncNativeSession, type JobSyncCompanyJobQuoteInput, type JobSyncCompanyJobQuote } from "../lib/jobsync-mobile-api";
import { normalizeCompanyJobConfirmation, companyJobConfirmationMessage } from "../lib/company-job-confirmation";

vi.mock("../lib/company-job-creation-storage", async () => {
  const { memoryCreationStorageModule } = await import("./helpers/company-creation-memory-store");
  return memoryCreationStorageModule();
});
const mocks = vi.hoisted(() => ({ focused: true, alert: vi.fn(), os: "web", signed: vi.fn(), customers: vi.fn(), customer: vi.fn(), settings: vi.fn(),
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
    AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) }, Keyboard: { addListener: () => ({ remove: vi.fn() }) },
    Alert: { alert: mocks.alert }, Platform: { get OS() { return mocks.os; } }, StyleSheet: { create: (value: any) => value } };
});
const nativeRequire = createRequire(import.meta.url);
const { createRoot } = nativeRequire("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
const safeAreaPath = nativeRequire.resolve("react-native-safe-area-context");
const originalSafeArea = nativeRequire.cache[safeAreaPath];
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
let sequence = 315000;
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
let root: ReturnType<typeof createRoot>; let container: PhotoTestNode; let props: CompanyCreateJobSheetProps; let ack: any;
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
function maybe(label: string) { return all().find((item) => item.nativeProps?.accessibilityLabel === label); }
function node(label: string) { const found = maybe(label); if (!found) throw new Error(`Missing ${label}; ${container.textContent}`); return found; }
async function render(patch: Partial<CompanyCreateJobSheetProps> = {}) { props = { ...props, ...patch }; await act(async () => root.render(<CompanyCreateJobSheet {...props} />)); }
async function press(label: string) { await act(async () => { node(label).nativeProps.onPress(); }); }
async function input(label: string, text: string) { await act(async () => { node(label).nativeProps.onChangeText(text); }); }
async function add(id = 31) { await press(maybe("Choose Service") ? "Choose Service" : "Add Another Service"); await press(`Returned service ${id}`); await press("Add selected service"); }
async function ready() { await render(); await input("Find Company customer", "Verified"); await press("Verified Customer · 5551234567"); await add(); }
beforeEach(() => {
  vi.resetAllMocks(); mocks.os = "web"; mocks.focused = true; mocks.hasLoaded = true; mocks.loading = false; mocks.error = null; ack = null;
  nativeRequire.cache[safeAreaPath] = { id: safeAreaPath, filename: safeAreaPath, loaded: true, exports: { SafeAreaView: (safeProps: Record<string, any>) => React.createElement("native-safe-area", { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = safeProps; } }, safeProps.children) } } as NodeModule;
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
  vi.stubGlobal("alert", mocks.alert);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live requests forbidden")));
});
afterEach(async () => {
  await act(async () => root.unmount()); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  if (originalSafeArea) nativeRequire.cache[safeAreaPath] = originalSafeArea; else delete nativeRequire.cache[safeAreaPath];
});

// Actual shared sheet/controller; only canonical API responses and I/O are fake.
describe("2574 confirmation feedback on the actual shared Company sheet", () => {
  it.each([
    ["provider_accepted", "provider acceptance, not verified delivery"],
    ["delivered", "reports delivery, not customer appointment confirmation"],
    ["failed", "reports a failure; the Job remains saved"],
  ])("publishes canonical %s before close only after calendar acknowledgment", async (status, wording) => {
    const confirmation = normalizeCompanyJobConfirmation({ status, communicationId: 701, recipientEmail: "private@example.test",
      reason: status === "provider_accepted" ? "provider_accepted" : status === "delivered" ? "delivered" : null,
      errorCode: status === "failed" ? "PRIVATE_PROVIDER_ERROR" : null, errorMessage: null });
    mocks.detail.mockImplementation(async () => ({ ...ack, photos: [], persistedPhotoIds: [], confirmationCommunication: confirmation }));
    await ready(); const order: string[] = [];
    mocks.alert.mockImplementation(() => { order.push("feedback"); });
    await render({ closeOnSuccess: true, onCreated: async (detail) => {
      expect(detail.confirmationCommunication).toEqual(confirmation); order.push("calendar"); return true;
    }, onClose: () => { order.push("close"); root.render(null); } });
    const retained = node("Save Company Job").nativeProps.onPress;
    await act(async () => { retained(); retained(); });
    expect(order).toEqual(["calendar", "feedback", "close"]);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const feedback = mocks.alert.mock.calls[0][0];
    expect(feedback).toContain(wording); expect(feedback).toContain("Status for this appointment time is unknown.");
    expect(feedback).toContain("Do not automatically resend or create another Job.");
    expect(feedback).not.toMatch(/private@example|PRIVATE_PROVIDER_ERROR|appointment confirmed/);
    await act(async () => retained()); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("OFF survives lost response and default ON cannot override immutable intent", async () => {
    await ready(); expect(node("Notify customer").nativeProps.accessibilityState.checked).toBe(true);
    await press("Notify customer");
    const original = mocks.create.getMockImplementation()!;
    mocks.create.mockImplementation(async (...args: any[]) => { await (original as any)(...args); throw new Error("Offline lost acknowledgment"); });
    const confirmation = normalizeCompanyJobConfirmation({ status: "suppressed", communicationId: null, recipientEmail: null,
      reason: "operator_opted_out", errorCode: null, errorMessage: null }, 0);
    mocks.detail.mockImplementation(async () => ({ ...ack, photos: [], persistedPhotoIds: [], confirmationCommunication: confirmation }));
    await press("Save Company Job");
    expect(mocks.create.mock.calls[0][2].notifyCustomer).toBe(false); expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.operation).toHaveBeenCalled(); expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(mocks.alert.mock.calls[0][0]).toContain(companyJobConfirmationMessage(false, confirmation));
    expect(mocks.alert.mock.calls[0][0]).toContain("reminders are separate and follow Company settings");
    expect(props.onCreated).toHaveBeenCalledTimes(1); await press("Save Company Job"); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
