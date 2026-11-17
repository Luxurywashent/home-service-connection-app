import React, { act } from "react";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyCreateJobSheet, type CompanyCreateJobSheetProps } from "../components/company-create-job-sheet";
import { createCompanyJobController, type CompanyCreateJobDraft, type CompanyCreateJobTransport } from "../lib/company-create-job";
import { createCompanyCreationStore, type CompanyCreationRecord } from "../lib/company-job-creation-storage";
import { normalizeCompanyJobPricing, type JobSyncNativeSession, type JobSyncCompanyJobCreateInput,
  type JobSyncCompanyJobQuoteInput, type JobSyncCompanyJobQuote, type JobSyncCompanyJobDetail } from "../lib/jobsync-mobile-api";

const mocks = vi.hoisted(() => ({ focused: true, signed: vi.fn(), customers: vi.fn(), customer: vi.fn(),
  settings: vi.fn(), quote: vi.fn(), create: vi.fn(), detail: vi.fn(), jobs: vi.fn(), operation: vi.fn(),
  priceBook: vi.fn(), refresh: vi.fn(), verify: vi.fn(), catalog: [] as any[], secureData: new Map<string, string>() }));
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused }));
vi.mock("expo-crypto", () => ({ randomUUID: () => randomUUID(),
  digestStringAsync: async (_algorithm: string, text: string) => createHash("sha256").update(text).digest("hex"),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" } }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked-device-only",
  getItemAsync: async (key: string) => mocks.secureData.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { mocks.secureData.set(key, value); },
  deleteItemAsync: async (key: string) => { mocks.secureData.delete(key); } }));
vi.mock("../lib/company-job-creation-storage", async original => {
  const actual = await original<typeof import("../lib/company-job-creation-storage")>();
  return { ...actual, companyCreationStore: actual.createCompanyCreationStore({ platform: "ios" }) };
});
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ foreground: "#fff", background: "#07111F", surface: "#102038", border: "#243754", primary: "#4D8DFF", muted: "#94A3B8", error: "#F06A6A" }) }));
vi.mock("@/hooks/use-company-price-book", () => ({ useCompanyPriceBook: () => ({ services: mocks.catalog, isLoading: false, error: null, hasLoaded: true, refresh: mocks.refresh }) }));
vi.mock("@/hooks/use-company-fieldwork-calendar", () => ({ useCompanyFieldworkCalendar: () => ({ members: [{ name: "Technician", employeeId: "jobsync-50" }], loading: false, error: null, verifyAssignment: mocks.verify }) }));
vi.mock("../lib/jobsync-mobile-api", async original => ({ ...await original<typeof import("../lib/jobsync-mobile-api")>(),
  getJobSyncMobileSession: mocks.signed, getJobSyncCompanyCustomers: mocks.customers, getJobSyncCompanyCustomer: mocks.customer,
  getJobSyncCompanySettings: mocks.settings, getHomeServiceConnectedPriceBook: mocks.priceBook, quoteJobSyncCompanyJob: mocks.quote,
  createJobSyncCompanyJob: mocks.create, getJobSyncCompanyJobDetail: mocks.detail, getJobSyncCompanyJobs: mocks.jobs,
  getJobSyncCompanyJobCreationOperation: mocks.operation }));
vi.mock("@react-native-community/datetimepicker", () => ({ default: () => null }));
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => R.createElement(name, { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; } }, props.children);
  return { Modal: host("native-modal"), View: host("native-view"), Text: host("native-text"), TextInput: host("native-input"),
    TouchableOpacity: host("native-touch"), ActivityIndicator: host("activity-indicator"), ScrollView: host("native-scroll"),
    KeyboardAvoidingView: host("native-keyboard"), FlatList: (props: any) => R.createElement("native-list", null, props.data.map((item: any, index: number) => R.createElement(R.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index })))),
    Platform: { OS: "web" }, StyleSheet: { create: (value: any) => value } };
});
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
let sequence = 198000;
let root: ReturnType<typeof createRoot> | undefined;
let container: PhotoTestNode;
let props: CompanyCreateJobSheetProps;
let ack: ReturnType<typeof savedJob> | null;
let createdCustomer: any;
const actor = (): JobSyncNativeSession => ({ token: `offline-notify-${++sequence}`, portal: "company",
  user: { id: sequence, name: "Owner", role: "owner", email: null }, company: { id: 9, name: "Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } });
const existing = () => ({ id: 7, companyId: 9, name: "Existing Customer", firstName: "Existing", lastName: "Customer", email: "existing@example.test", phone: null, addressLine1: null, city: null });
const newCustomer = () => ({ firstName: "Casey", lastName: "Example", email: "casey@example.test" });
const lineItems = () => [{ priceBookItemId: 31, quantity: 1 }, { priceBookItemId: 32, quantity: 1 }];
const discount = () => ({ kind: "flat" as const, value: 25, code: "TEST" });
// Canonical mock server fixtures. No notification-specific pricing calculation.
function quoteFixture(input: JobSyncCompanyJobQuoteInput): JobSyncCompanyJobQuote {
  expect(Object.keys(input).every(key => ["lineItems", "discount"].includes(key))).toBe(true);
  const two = input.lineItems.length === 2;
  const discounted = Boolean(input.discount);
  expect(input.lineItems).toEqual(two ? lineItems() : [lineItems()[0]]);
  if (discounted) expect(input.discount).toEqual(discount());
  return { lines: [{ priceBookItemId: 31, name: "Service", quantity: 1, unitPrice: 125, lineTotal: 125, durationMinutes: 45, taxable: true, vehiclePriceKey: null },
    ...(two ? [{ priceBookItemId: 32, name: "Second Service", quantity: 1, unitPrice: 75, lineTotal: 75, durationMinutes: 30, taxable: true, vehiclePriceKey: null }] : [])],
    subtotal: two ? 200 : 125, discount: discounted ? 25 : 0, discountKind: discounted ? "flat" : null, discountCode: discounted ? "TEST" : null,
    taxableSubtotal: two ? (discounted ? 175 : 200) : (discounted ? 100 : 125), taxRateBps: 1000,
    tax: two ? (discounted ? 17.5 : 20) : (discounted ? 10 : 12.5), total: two ? (discounted ? 192.5 : 220) : (discounted ? 110 : 137.5),
    totalDurationMinutes: two ? 75 : 45, recurrence: null, persistence: { taxStored: true, note: "Mock server stored tax" } };
}
function savedJob(request: JobSyncCompanyJobCreateInput) {
  const quote = quoteFixture({ lineItems: request.lineItems ?? [lineItems()[0]], ...(request.discount ? { discount: request.discount } : {}) });
  const row = { id: 84, companyId: 9, customerId: request.newCustomer ? 73 : request.customerId!, priceBookServiceId: 31,
    assignedUserId: request.assignedUserId ?? null, scheduledStartAt: request.scheduledStartAt,
    scheduledEndAt: request.scheduledEndAt ?? "2026-12-01T16:15:00.000Z", amount: quote.total,
    title: "Service", serviceName: "Service", status: "scheduled", customerName: "Customer", assignedName: null,
    addressLine1: null, city: null, updatedAt: null, photos: [], enRouteAt: null, onSiteAt: null, completedAt: null,
    lineItems: quote.lines.map((line, index) => ({ id: 600 + index, priceBookItemId: line.priceBookItemId, name: line.name,
      quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal, sortOrder: index })),
    subtotalAmount: quote.subtotal, discountAmount: quote.discount, taxAmount: quote.tax, taxRateBps: quote.taxRateBps,
    discountKind: quote.discountKind, discountCode: quote.discountCode,
    operation: { key: request.operationKey!, state: "saved" as const, replayed: false } };
  return { ...row, pricing: normalizeCompanyJobPricing(row)! };
}
function request(selector: "existing" | "new" = "existing"): JobSyncCompanyJobCreateInput {
  return { ...(selector === "new" ? { newCustomer: newCustomer() } : { customerId: 7 }), lineItems: lineItems(),
    discount: discount(), operationKey: "notify-original-operation", scheduledStartAt: "2026-12-01T15:00:00.000Z" };
}
function draft(selector: "existing" | "new" = "existing"): CompanyCreateJobDraft {
  return { ...(selector === "new" ? { newCustomer: newCustomer() } : { customerId: 7 }), lineItems: lineItems(), discount: discount(),
    date: "2026-12-01", startHour: 9, endHour: 11, assignedEmployeeId: "jobsync-50" };
}
function record(notify: boolean | "omitted" = "omitted", signed = actor()): CompanyCreationRecord {
  const { operationKey, ...payload } = request();
  return { version: 1, companyId: 9, userId: signed.user.id, operationKey: operationKey!,
    payload: { ...payload, ...(notify === "omitted" ? {} : { notifyCustomer: notify }) }, timezone: "America/Chicago", phase: "prepared", jobId: null,
    createdAt: "2026-11-16T15:00:00.000Z", updatedAt: "2026-11-16T15:00:00.000Z" };
}
function native() {
  const data = new Map<string, string>();
  const adapter = { getItemAsync: async (key: string) => data.get(key) ?? null,
    setItemAsync: async (key: string, text: string) => { data.set(key, text); }, deleteItemAsync: async (key: string) => { data.delete(key); } };
  const makeStore = () => createCompanyCreationStore({ platform: "ios", secureStore: adapter });
  return { makeStore, store: makeStore() };
}
function harness(signed = actor(), store = native().store, factory = createCompanyJobController) {
  const api: CompanyCreateJobTransport = { session: async () => signed, settings: async () => ({ id: 9, name: "Company", timezone: "America/Chicago" }),
    priceBook: async () => mocks.catalog, customer: async (_token, id) => ({ ...(id === 73 ? newCustomer() : existing()), id, companyId: 9 }),
    quote: vi.fn(async (_token, _company, input) => quoteFixture(input)), create: vi.fn(async (_token, _company, input) => savedJob(input)),
    detail: vi.fn(async () => savedJob({ ...request(), assignedUserId: 50, scheduledEndAt: "2026-12-01T17:00:00.000Z" }) as JobSyncCompanyJobDetail),
    jobs: vi.fn(async () => []), operation: vi.fn(async (_token, _company, key) => ({ key, state: "unknown" as const, jobId: null, rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null })) };
  const onCreated = vi.fn(async () => true);
  const newOperationKey = vi.fn(() => `notify-operation-${++sequence}`);
  const controller = factory({ session: signed, isCurrent: () => true, verifyAssignment: async () => true, onState: vi.fn(), onCreated, transport: api, store, newOperationKey });
  return { controller, api, onCreated, newOperationKey, signed, store };
}
function all(node = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap(child => all(child))]; }
function node(label: string) { const value = all().find(n => n.nativeProps?.accessibilityLabel === label); if (!value) throw new Error(`Missing ${label}`); return value; }
async function render(patch: Partial<CompanyCreateJobSheetProps> = {}) { props = { ...props, ...patch }; await act(async () => root!.render(<CompanyCreateJobSheet {...props} />)); }
async function press(label: string) { await act(async () => node(label).nativeProps.onPress()); }
async function input(label: string, value: string) { await act(async () => node(label).nativeProps.onChangeText(value)); }
async function fill(selector: "existing" | "new") {
  await render(selector === "existing" ? { customerPrefill: { customerId: 7, companyId: 9 } } : {});
  if (selector === "new") { await press("New Customer"); await input("First name (required)", "Casey"); await input("Last name (required)", "Example"); await input("Email (optional)", "casey@example.test"); }
  await press("Choose Service"); await press("Service"); await press("Add selected service");
  await press("Add Another Service"); await press("Second Service"); await press("Add selected service");
  await press("Flat discount"); await input("Discount value", "25"); await input("Discount code (optional)", "TEST"); await press("Technician");
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.focused = true; mocks.secureData.clear(); ack = null; createdCustomer = null;
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  props = { visible: true, session: actor(), initialDate: "2026-12-01", initialStartHour: 9, initialEndHour: 11,
    isCurrent: () => true, onClose: vi.fn(), onCreated: vi.fn().mockResolvedValue(true) };
  mocks.catalog = [{ serviceId: "31", name: "Service", basePrice: 125, vehiclePrices: {}, defaultDurationMinutes: 45 },
    { serviceId: "32", name: "Second Service", basePrice: 75, vehiclePrices: {}, defaultDurationMinutes: 30 }].map(row => ({ ...row, emoji: "", description: "", features: [], imageUrl: null, sortOrder: 0 }));
  mocks.signed.mockImplementation(async () => props.session); mocks.settings.mockResolvedValue({ id: 9, name: "Company", timezone: "America/Chicago" });
  mocks.customers.mockResolvedValue([existing()]); mocks.customer.mockImplementation(async (_token, id) => id === 73 ? createdCustomer : existing());
  mocks.priceBook.mockImplementation(async () => mocks.catalog); mocks.refresh.mockResolvedValue(undefined); mocks.verify.mockResolvedValue(true); mocks.jobs.mockResolvedValue([]);
  mocks.quote.mockImplementation(async (_token, _company, value) => quoteFixture(value));
  mocks.create.mockImplementation(async (_token, _company, value) => { if (value.newCustomer) createdCustomer = { ...value.newCustomer, id: 73, companyId: 9 }; ack = savedJob(value); return ack; });
  mocks.detail.mockImplementation(async () => ack); mocks.operation.mockImplementation(async (_token, _company, key) => ({ key, state: ack ? "saved" : "unknown", jobId: ack?.id ?? null, rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null }));
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live API forbidden")));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.unstubAllGlobals(); });

describe("Phase 2 exact notification create contract", () => {
  it.each(["existing", "new"] as const)("preserves omitted/default-on, explicit true and false for %s customers", async selector => {
    const api = await vi.importActual<typeof import("../lib/jobsync-mobile-api")>("../lib/jobsync-mobile-api");
    expect(api.createJobSyncCompanyJobPayload(request(selector))).not.toHaveProperty("notifyCustomer");
    for (const notifyCustomer of [true, false]) {
      const payload = api.createJobSyncCompanyJobPayload({ ...request(selector), notifyCustomer });
      expect(payload).toMatchObject({ notifyCustomer, lineItems: lineItems(), discount: discount() }); expect(Object.isFrozen(payload)).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([null, "false", "true", 0, 1, {}, []])("rejects invalid preference %j before any I/O for both selectors", async notifyCustomer => {
    const api = await vi.importActual<typeof import("../lib/jobsync-mobile-api")>("../lib/jobsync-mobile-api");
    for (const selector of ["existing", "new"] as const) {
      await expect(api.createJobSyncCompanyJob("offline-token", 9, { ...request(selector), notifyCustomer } as any)).rejects.toThrow("Notify customer");
      const h = harness(); await expect(h.controller.submit({ ...draft(selector), notifyCustomer } as any)).resolves.toBe(false);
      expect(h.api.create).not.toHaveBeenCalled(); expect(h.api.quote).not.toHaveBeenCalled(); h.controller.detach();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([true, false])("legacy strict-server rejection never retries/drops explicit %s", async notifyCustomer => {
    const api = await vi.importActual<typeof import("../lib/jobsync-mobile-api")>("../lib/jobsync-mobile-api");
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message: "A valid Company Job creation request is required.", code: "BAD_REQUEST" }), { status: 400, headers: { "Content-Type": "application/json" } }));
    await expect(api.createJobSyncCompanyJob("offline-token", 9, { ...request(), notifyCustomer })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce(); expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)).toHaveProperty("notifyCustomer", notifyCustomer);
  });
  it("strict quote contract rejects notification field instead of broadening preflight", async () => {
    const api = await vi.importActual<typeof import("../lib/jobsync-mobile-api")>("../lib/jobsync-mobile-api");
    await expect(api.quoteJobSyncCompanyJob("offline-token", 9, { lineItems: lineItems(), notifyCustomer: false } as any)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Phase 2 notification protected immutable intent", () => {
  it.each([true, false, "omitted"] as const)("native adapter restart preserves exact %s preference and rejects mutation/removal/addition", async preference => {
    const secured = native(); const original = record(preference);
    expect(await secured.store.reserve(original)).toBe(true);
    const restarted = secured.makeStore(); const stored = (await restarted.read(9, original.userId))!;
    expect(stored).toEqual(original); expect(Object.isFrozen(stored.payload)).toBe(true);
    const update = { ...stored, phase: "uncertain" as const, updatedAt: "2026-11-16T15:01:00.000Z" };
    expect(await restarted.update(update)).toBe(true);
    for (const next of [true, false, "omitted"] as const) {
      if (next === preference) continue;
      const { notifyCustomer: _removed, ...rest } = stored.payload;
      await expect(restarted.update({ ...update, payload: { ...rest, ...(next === "omitted" ? {} : { notifyCustomer: next }) } })).rejects.toThrow("could not be verified");
    }
    expect((await restarted.read(9, original.userId))!.payload).toEqual(original.payload); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([null, "false", 0, {}, undefined])("stored explicit invalid preference %j fails closed", async notifyCustomer => {
    const secured = native(); const value = record();
    await expect(secured.store.reserve({ ...value, payload: { ...value.payload, notifyCustomer } as any })).rejects.toThrow("could not be verified");
    expect(await secured.store.read(9, value.userId)).toBeNull();
  });
  it.each(["existing", "new"] as const)("captures false before delayed auth, persists one exact %s intent and GET-only recovers after controller restart", async selector => {
    const secured = native(); const h = harness(actor(), secured.store);
    let resolve!: (value: JobSyncNativeSession) => void;
    const delayed = new Promise<JobSyncNativeSession>(done => { resolve = done; }); h.api.session = vi.fn().mockReturnValueOnce(delayed).mockResolvedValue(h.signed);
    vi.mocked(h.api.create).mockRejectedValue(new Error("Response lost"));
    const original = { ...draft(selector), notifyCustomer: false };
    const submit = h.controller.submit(original); original.notifyCustomer = true; resolve(h.signed);
    expect(await submit).toBe(false); expect(h.api.create).toHaveBeenCalledOnce();
    const posted = vi.mocked(h.api.create).mock.calls[0][2]; expect(posted.notifyCustomer).toBe(false);
    expect(posted).toMatchObject({ lineItems: lineItems(), discount: discount(), assignedUserId: 50,
      scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T17:00:00.000Z" });
    expect(h.api.quote).toHaveBeenCalledWith(h.signed.token, 9, { lineItems: lineItems(), discount: discount() });
    const persisted = (await secured.store.read(9, h.signed.user.id))!; expect(persisted.payload.notifyCustomer).toBe(false);
    await h.controller.submit({ ...draft(selector), notifyCustomer: true }); expect(h.api.create).toHaveBeenCalledOnce(); h.controller.detach();
    vi.resetModules(); const reloaded = await import("../lib/company-create-job");
    const recovered = harness(h.signed, secured.makeStore(), reloaded.createCompanyJobController);
    vi.mocked(recovered.api.operation!).mockResolvedValue({ key: posted.operationKey!, state: "saved", jobId: 84, rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null });
    vi.mocked(recovered.api.detail).mockResolvedValue(savedJob(posted) as JobSyncCompanyJobDetail);
    expect(await recovered.controller.restore()).toBe(true); expect(recovered.api.create).not.toHaveBeenCalled(); expect(recovered.newOperationKey).not.toHaveBeenCalled();
    expect(recovered.api.operation).toHaveBeenCalledWith(h.signed.token, 9, posted.operationKey);
    expect(recovered.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 84, amount: 192.5, pricing: expect.objectContaining({ taxAmount: 17.5, discountAmount: 25 }) }), "America/Chicago");
    expect(await secured.store.read(9, h.signed.user.id)).toBeNull(); recovered.controller.detach(); expect(fetch).not.toHaveBeenCalled();
  });
  it("old omitted v1 intent restores and remains absent through unknown status refresh without POST", async () => {
    const h = harness(); const old = record("omitted", h.signed); await h.store.reserve(old);
    await h.controller.restore(); await h.controller.reconcile(); await h.controller.submit({ ...draft(), notifyCustomer: false });
    expect((await h.store.read(9, h.signed.user.id))!.payload).not.toHaveProperty("notifyCustomer");
    expect(h.api.create).not.toHaveBeenCalled(); expect(h.newOperationKey).not.toHaveBeenCalled(); h.controller.detach();
  });
});

describe("Phase 2 existing compact notification switch", () => {
  it.each(["existing", "new"] as const)("default ON and explicit opt-out preserve %s multi-service, discounts, tax, calendar and assignment", async selector => {
    await fill(selector); expect(node("Notify customer").nativeProps).toMatchObject({ accessibilityRole: "switch", accessibilityState: { checked: true, disabled: false } });
    const quoteCalls = mocks.quote.mock.calls.length; const previousSave = node("Save Company Job").nativeProps.onPress;
    await press("Notify customer"); expect(node("Notify customer").nativeProps.accessibilityState.checked).toBe(false);
    await act(async () => previousSave()); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.quote).toHaveBeenCalledTimes(quoteCalls);
    await press("Save Company Job"); expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create.mock.calls[0][2]).toMatchObject({ notifyCustomer: false, lineItems: lineItems(), discount: discount(), assignedUserId: 50,
      scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T17:00:00.000Z" });
    expect(props.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 84, amount: 192.5, pricing: expect.objectContaining({ taxAmount: 17.5 }) }), "America/Chicago");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("untouched default ON is explicit true; preference is per-Job and not Company identity", async () => {
    await fill("existing"); await press("Save Company Job"); expect(mocks.create.mock.calls[0][2].notifyCustomer).toBe(true);
    await render({ visible: false }); await render({ visible: true, session: actor() });
    expect(node("Notify customer").nativeProps.accessibilityState.checked).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it("busy/uncertain recovery locks toggle and retained handlers; no second POST or preference replacement", async () => {
    await fill("existing"); await press("Notify customer"); const toggle = node("Notify customer").nativeProps.onPress;
    mocks.create.mockRejectedValue(new Error("Response lost")); await press("Save Company Job");
    expect(node("Notify customer").nativeProps.disabled).toBe(true); await act(async () => toggle());
    expect(node("Notify customer").nativeProps.accessibilityState.checked).toBe(false);
    const stored = await createCompanyCreationStore({ platform: "ios" }).read(9, props.session!.user.id); expect(stored!.payload.notifyCustomer).toBe(false);
    await press("Refresh saved Job without resending"); expect(mocks.create).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it("stale focus/current/session handlers cannot toggle or dispatch notification intent", async () => {
    let active = true; await render({ isCurrent: () => active });
    await fill("existing"); const retained = node("Notify customer").nativeProps.onPress; active = false;
    await act(async () => retained()); expect(node("Notify customer").nativeProps.accessibilityState.checked).toBe(true);
    await render({ isCurrent: () => true, session: actor() }); await act(async () => retained());
    expect(node("Notify customer").nativeProps.accessibilityState.checked).toBe(true); mocks.focused = false; await render();
    expect(container.textContent).toBe(""); expect(mocks.create).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});
