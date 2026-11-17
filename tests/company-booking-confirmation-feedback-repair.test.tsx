import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyCreateJobSheet, type CompanyCreateJobSheetProps } from "../components/company-create-job-sheet";
import { type JobSyncNativeSession, type JobSyncCompanyJobQuoteInput, type JobSyncCompanyJobQuote } from "../lib/jobsync-mobile-api";
import { type CompanyJobConfirmation, companyJobConfirmationMessage } from "../lib/company-job-confirmation";

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
let sequence = 195000;
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

describe("booking confirmation repair — real sheet/controller, isolated I/O", () => {
  it("defaults ON and explains booking-only OFF, not blanket reminder suppression", async () => {
    await ready(); expect(node("Notify customer").nativeProps.accessibilityState.checked).toBe(true);
    expect(container.textContent).toContain("Booking confirmation only. Day-before and same-day reminders follow Company settings.");
    await press("Notify customer"); expect(node("Notify customer").nativeProps.accessibilityState.checked).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([true, false])("presents immutable ON=%s feedback before actual form auto-close", async (on) => {
    await ready(); if (!on) await press("Notify customer");
    const events: string[] = []; mocks.alert.mockImplementation(() => { events.push("feedback"); });
    await render({ closeOnSuccess: true, onClose: () => { events.push("close"); root.render(null); } });
    const retained = node("Save Company Job").nativeProps.onPress;
    await act(async () => { retained(); retained(); });
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.create.mock.calls[0][2].notifyCustomer).toBe(on);
    expect(mocks.alert).toHaveBeenCalledTimes(1); const message = mocks.alert.mock.calls[0][0];
    expect(message).toContain("Job saved. Company calendar refreshed.");
    expect(message).toContain(companyJobConfirmationMessage(on));
    if (on) expect(message).toContain("Booking confirmation outcome is unknown");
    expect(message).toContain("Day-before and same-day reminders");
    expect(message).not.toMatch(/email (?:was )?(?:sent|delivered)|confirmation (?:was )?sent|already_sent|appointment confirmed/i);
    expect(events).toEqual(["feedback", "close"]); expect(container.textContent).toBe("");
    await act(async () => retained()); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["accepted", "provider acceptance, not verified delivery"],
    ["failed", "reports a failure; the Job remains saved"],
    ["queued", "queued, not confirmed sent"],
    ["deferred", "deferred, not confirmed sent"],
    ["suppressed", "latest booking email record reports suppression"],
    ["in_progress", "in progress; provider outcome is unknown"],
  ] as const)("presents canonical latest-record %s without claiming this appointment or authorizing resend", async (recordStatus, wording) => {
    // Injected API mocks are already normalized; raw tax/provider evidence belongs to the adapter tests.
    const confirmation: CompanyJobConfirmation = Object.freeze({ status: "unknown", recordStatus,
      communicationId: 701, reason: "appointment_binding_unavailable" });
    mocks.detail.mockImplementation(async () => ({ ...ack, photos: [], persistedPhotoIds: [], confirmationCommunication: confirmation }));
    await ready(); await press("Save Company Job");
    expect(byId("company-booking-confirmation-feedback")!.textContent).toBe(companyJobConfirmationMessage(true, confirmation));
    const message = mocks.alert.mock.calls[0][0];
    expect(message).toContain(wording); expect(message).toContain("Job saved. Company calendar refreshed.");
    expect(message).toContain("Status for this appointment time is unknown.");
    expect(message).toContain("Do not automatically resend or create another Job.");
    expect(message).not.toMatch(/email (?:was )?(?:sent|delivered)|confirmation (?:was )?sent|already_sent|appointment confirmed/i);
    expect(props.onCreated).toHaveBeenCalledTimes(1); expect(node("Save Company Job").nativeProps.disabled).toBe(true);
    await press("Save Company Job"); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("ignores an unverified CREATE record and publishes only fresh canonical detail", async () => {
    const original = mocks.create.getMockImplementation()!;
    mocks.create.mockImplementation(async (...args: any[]) => ({ ...await (original as any)(...args),
      confirmationCommunication: { status: "unknown", recordStatus: "accepted", communicationId: 701, reason: "appointment_binding_unavailable" } }));
    await ready(); await press("Save Company Job");
    expect(byId("company-booking-confirmation-feedback")!.textContent).toBe(companyJobConfirmationMessage(true));
    expect(mocks.alert.mock.calls[0][0]).not.toContain("provider acceptance");
    expect(mocks.detail).toHaveBeenCalledTimes(1); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("preserves canonical record failure after calendar refresh fails without losing or recreating the Job", async () => {
    const confirmation: CompanyJobConfirmation = { status: "unknown", recordStatus: "failed", communicationId: 701, reason: "appointment_binding_unavailable" };
    mocks.detail.mockImplementation(async () => ({ ...ack, photos: [], persistedPhotoIds: [], confirmationCommunication: confirmation }));
    await ready(); await render({ onCreated: vi.fn().mockResolvedValue(false) }); await press("Save Company Job");
    expect(container.textContent).toContain("Job saved — calendar refresh failed.");
    expect(byId("company-booking-confirmation-feedback")!.textContent).toBe(companyJobConfirmationMessage(true, confirmation));
    expect(mocks.alert).not.toHaveBeenCalled(); expect(ack.id).toBe(84);
    await press("Save Company Job"); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("recovers a failed latest record after lost CREATE acknowledgment via GET only", async () => {
    const original = mocks.create.getMockImplementation()!;
    const confirmation: CompanyJobConfirmation = { status: "unknown", recordStatus: "failed", communicationId: 701, reason: "appointment_binding_unavailable" };
    mocks.create.mockImplementation(async (...args: any[]) => { await (original as any)(...args); throw new Error("Lost acknowledgment"); });
    mocks.detail.mockImplementation(async () => ({ ...ack, photos: [], persistedPhotoIds: [], confirmationCommunication: confirmation }));
    await ready(); await press("Save Company Job");
    expect(mocks.operation).toHaveBeenCalled(); expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(byId("company-booking-confirmation-feedback")!.textContent).toBe(companyJobConfirmationMessage(true, confirmation));
    expect(props.onCreated).toHaveBeenCalledTimes(1); expect(mocks.create).toHaveBeenCalledTimes(1);
    await press("Save Company Job"); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it.each(["hidden", "unfocused", "stale"])("does not publish a canonical record arriving after the sheet becomes %s", async change => {
    const wait = deferred<any>(); mocks.detail.mockReturnValue(wait.promise);
    await ready(); await press("Save Company Job"); expect(mocks.detail).toHaveBeenCalledTimes(1);
    if (change === "hidden") await render({ visible: false });
    else if (change === "unfocused") { mocks.focused = false; await render(); }
    else await render({ isCurrent: () => false });
    await act(async () => wait.resolve({ ...ack, photos: [], persistedPhotoIds: [], confirmationCommunication: {
      status: "unknown", recordStatus: "failed", communicationId: 701, reason: "appointment_binding_unavailable" } }));
    expect(container.textContent).not.toContain("latest booking email record");
    expect(mocks.alert).not.toHaveBeenCalled(); expect(props.onCreated).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("also presents feedback for deferred-closing profile callbacks while retaining inline feedback", async () => {
    await ready(); await press("Save Company Job");
    expect(byId("company-booking-confirmation-feedback")!.textContent).toContain("outcome is unknown");
    expect(mocks.alert).toHaveBeenCalledTimes(1); expect(props.onClose).not.toHaveBeenCalled();
    expect(node("Save Company Job").nativeProps.disabled).toBe(true);
  });
  it("uses native Alert for saved feedback rather than the disappearing form", async () => {
    await ready(); mocks.os = "ios"; await render({ closeOnSuccess: true });
    await press("Save Company Job");
    expect(mocks.alert.mock.calls[0]).toEqual(["Job saved", expect.stringContaining("outcome is unknown"), [{ text: "OK", onPress: expect.any(Function) }], { cancelable: false }]);
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => mocks.alert.mock.calls[0][2][0].onPress());
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
  it("guards a retained native Alert close callback after the originating sheet is hidden", async () => {
    await ready(); mocks.os = "android"; await render({ closeOnSuccess: true }); await press("Save Company Job");
    const acknowledge = mocks.alert.mock.calls[0][2][0].onPress; await render({ visible: false });
    await act(async () => acknowledge()); expect(props.onClose).not.toHaveBeenCalled(); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("never converts a presentation exception after saving to Job/email failure or recreation", async () => {
    await ready(); await render({ closeOnSuccess: true }); mocks.alert.mockImplementation(() => { throw new Error("Presentation failed"); });
    await press("Save Company Job"); expect(props.onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Job saved. Company calendar refreshed.");
    expect(container.textContent).not.toContain("Presentation failed");
    await press("Save Company Job"); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("keeps feedback inline if web alert is unavailable", async () => {
    await ready(); await render({ closeOnSuccess: true }); vi.stubGlobal("alert", undefined);
    await press("Save Company Job"); expect(props.onClose).not.toHaveBeenCalled();
    expect(byId("company-booking-confirmation-feedback")).toBeTruthy();
  });
  it("does not claim saved or email outcome on uncertain POST; retries remain GET-only", async () => {
    await ready(); await press("Notify customer"); mocks.create.mockRejectedValue(new Error("Lost response after possible commit"));
    await press("Save Company Job"); expect(container.textContent).toContain("Creation status is unknown");
    expect(byId("company-booking-confirmation-feedback")).toBeUndefined(); expect(mocks.alert).not.toHaveBeenCalled();
    expect(props.onCreated).not.toHaveBeenCalled();
    await press("Refresh saved Job without resending"); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("recovers saved status through GET only using original OFF rather than draft/default ON", async () => {
    await ready(); await press("Notify customer"); const original = mocks.create.getMockImplementation()!;
    mocks.create.mockImplementation(async (...args: any[]) => { await (original as any)(...args); throw new Error("Lost acknowledgment"); });
    mocks.detail.mockImplementation(async () => ({ ...ack, photos: [], persistedPhotoIds: [], confirmationCommunication: {
      status: "unknown", recordStatus: "accepted", communicationId: 701, reason: "appointment_binding_unavailable" } }));
    await press("Save Company Job"); expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.operation).toHaveBeenCalled();
    expect(byId("company-booking-confirmation-feedback")!.textContent).toBe(companyJobConfirmationMessage(false));
    expect(mocks.alert.mock.calls[0][0]).not.toContain("provider acceptance");
    expect(mocks.alert.mock.calls[0][0]).toContain("was not requested");
  });
  it("captures OFF before async auth and blocks a retained editable toggle after submission", async () => {
    await ready(); await press("Notify customer"); const toggle = node("Notify customer").nativeProps.onPress;
    const auth = deferred<JobSyncNativeSession>(); mocks.signed.mockReturnValueOnce(auth.promise);
    await press("Save Company Job"); await act(async () => toggle()); await act(async () => auth.resolve(props.session!));
    expect(mocks.create.mock.calls[0][2].notifyCustomer).toBe(false);
    expect(mocks.alert.mock.calls[0][0]).toContain("was not requested");
  });
  it("keeps a saved Job/calendar refresh error separate from UNKNOWN confirmation outcome", async () => {
    await ready(); await render({ onCreated: vi.fn().mockResolvedValue(false) }); await press("Save Company Job");
    expect(container.textContent).toContain("Job saved — calendar refresh failed.");
    expect(byId("company-booking-confirmation-feedback")!.textContent).toContain("outcome is unknown");
    expect(container.textContent).not.toMatch(/email failed|email sent/i); expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("surfaces exact preflight errors without a saved/email-result claim", async () => {
    await ready(); mocks.quote.mockRejectedValueOnce(new Error("Exact preflight failure")); await press("Save Company Job");
    expect(container.textContent).toContain("Exact preflight failure"); expect(mocks.create).not.toHaveBeenCalled();
    expect(byId("company-booking-confirmation-feedback")).toBeUndefined(); expect(mocks.alert).not.toHaveBeenCalled();
  });
  it.each(["hidden", "unfocused", "stale", "token", "tenant", "role"])("blocks late saved feedback and retained Save after %s", async (change) => {
    await ready(); const retained = node("Save Company Job").nativeProps.onPress;
    const original = mocks.create.getMockImplementation()!; const wait = deferred<void>();
    mocks.create.mockImplementation(async (...args: any[]) => { const result = await (original as any)(...args); await wait.promise; return result; });
    await press("Save Company Job"); expect(mocks.create).toHaveBeenCalledTimes(1);
    const replacement = structuredClone(props.session!);
    if (change === "hidden") await render({ visible: false });
    else if (change === "unfocused") { mocks.focused = false; await render(); }
    else if (change === "stale") await render({ isCurrent: () => false });
    else { if (change === "token") replacement.token += "-changed"; if (change === "tenant") replacement.company!.id = 10; if (change === "role") replacement.user.role = "technician"; await render({ session: replacement }); }
    await act(async () => { wait.resolve(); retained(); }); expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.alert).not.toHaveBeenCalled(); expect(props.onCreated).not.toHaveBeenCalled(); expect(props.onClose).not.toHaveBeenCalled();
  });
  it("preserves new-customer, multiple-services, notes, server totals and durable OFF intent", async () => {
    await ready(); await add(32); await press("New Customer"); await input("First name (required)", "New"); await input("Last name (required)", "Customer");
    await press("More Details"); await input("Service notes", "Keep visible"); await input("Private notes", "Keep private"); await press("Notify customer");
    mocks.customer.mockResolvedValue({ id: 77, companyId: 9, firstName: "New", lastName: "Customer" }); await press("Save Company Job");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][2]).toMatchObject({ newCustomer: { firstName: "New", lastName: "Customer" },
      lineItems: [{ priceBookItemId: 31, quantity: 1 }, { priceBookItemId: 32, quantity: 1 }], notifyCustomer: false,
      serviceNotes: "Keep visible", privateNotes: "Keep private", operationKey: expect.any(String) });
    expect(ack.amount).toBe(315.24); expect(props.onCreated).toHaveBeenCalledTimes(1);
    expect(byId("company-booking-confirmation-feedback")!.textContent).toContain("was not requested");
  });
});
