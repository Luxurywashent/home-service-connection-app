import React, { act } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/company-job-creation-storage", async () => {
  const { memoryCreationStorageModule } = await import("./helpers/company-creation-memory-store");
  return memoryCreationStorageModule();
});
import { installPhotoTestDOM } from "./helpers/company-photo-test-dom";
import { createCompanyJobController } from "../lib/company-create-job";
import { JobSyncApiError } from "../lib/jobsync-mobile-api";

const mocks = vi.hoisted(() => ({
  focused: true, session: null as any, loading: false, employeeLoading: false,
  employee: { employeeId: "legacy-admin", role: "admin", sessionSource: "local" } as any,
  params: {} as any, token: "legacy-token", controls: [] as any[], sheets: [] as any[], legacy: [] as any[],
  queries: [] as any[], mutations: {} as Record<string, any>, alerts: vi.fn(), push: vi.fn(),
  customers: vi.fn(), customer: vi.fn(), jobs: vi.fn(), signed: vi.fn(), settings: vi.fn(),
}));
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (kind: string) => (props: any) => {
    mocks.controls.push({ kind, ...props });
    if (kind === "Modal" && !props.visible) return null;
    return R.createElement("div", null, props.children);
  };
  return { Alert: { alert: mocks.alerts }, Linking: { openURL: vi.fn() }, Platform: { OS: "web" }, StyleSheet: { create: (value: any) => value },
    ...Object.fromEntries(["View", "Text", "TouchableOpacity", "TextInput", "ScrollView", "FlatList", "Image", "Modal"].map((kind) => [kind, host(kind)])) };
});
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused, useLocalSearchParams: () => mocks.params, useRouter: () => ({ back: vi.fn(), push: mocks.push }) }));
vi.mock("expo-haptics", () => ({ impactAsync: vi.fn(), notificationAsync: vi.fn(), ImpactFeedbackStyle: { Light: "light" }, NotificationFeedbackType: { Success: "success" } }));
vi.mock("react-native-maps", () => ({ default: () => null, Marker: () => null, PROVIDER_GOOGLE: "google" }));
vi.mock("@/components/screen-container", async () => {
  const R = await import("react");
  return { ScreenContainer: ({ children }: any) => R.createElement("div", null, children) };
});
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ primary: "#123456", muted: "#888888", border: "#eeeeee", success: "#00aa00" }) }));
vi.mock("@/lib/jobsync-auth-context", () => ({ useJobSyncAuth: () => ({ session: mocks.session, isLoading: mocks.loading }) }));
vi.mock("@/lib/auth-context", () => ({ useEmployeeAuth: () => ({ employee: mocks.employee, loading: mocks.employeeLoading }) }));
vi.mock("@/lib/_core/auth", () => ({ getSessionToken: async () => mocks.token }));
vi.mock("@/components/add-job-modal", () => ({ AddJobModal: (props: any) => { mocks.legacy.push(props); return null; } }));
vi.mock("@/components/company-create-job-sheet", () => ({ CompanyCreateJobSheet: (props: any) => { mocks.sheets.push(props); return null; } }));
vi.mock("@/components/company-job-photos", () => ({ CompanyJobPhotos: () => null, CompanyJobPhotoPreview: () => null }));
vi.mock("@/hooks/use-company-job", () => ({ useCompanyJob: () => ({ pending: false, actor: mocks.session, detail: null, refresh: vi.fn(), cancelManagement: vi.fn() }) }));
vi.mock("@/lib/jobsync-mobile-api", async (original) => ({ ...await original<typeof import("../lib/jobsync-mobile-api")>(),
  getJobSyncCompanyCustomers: mocks.customers, getJobSyncCompanyCustomer: mocks.customer, getJobSyncCompanyJobs: mocks.jobs,
  getJobSyncMobileSession: mocks.signed, getJobSyncCompanySettings: mocks.settings }));
vi.mock("@/lib/trpc", () => ({ trpc: new Proxy({ useUtils: () => ({ jobs: { getPhotos: { fetch: vi.fn().mockResolvedValue({ urls: [] }) } } }) }, {
  get(target, group: string) {
    if (group === "useUtils") return target.useUtils;
    return new Proxy({}, { get: (_unused, action: string) => {
      const name = `${group}.${action}`;
      return { useQuery: (_input: any, options?: any) => {
        mocks.queries.push({ name, enabled: options?.enabled !== false });
        return { data: name === "customers.getJobs" ? { scheduleJobsList: [{ id: "legacy-job", jobId: "legacy-job", date: "2020-01-01", status: "completed", packageType: "Legacy Service", totalPrice: "50" }], onlineBookingsList: [] } : [], isLoading: false, refetch: vi.fn() };
      }, useMutation: () => mocks.mutations[name] ??= { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue({}) } };
    } });
  },
}) }));
import Screen from "../app/(tabs)/admin-customer-profile";
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
let root: ReturnType<typeof createRoot>;
let doc: ReturnType<typeof installPhotoTestDOM>;
let actorId = 7000;
const company = (role = "owner", companyId = 9) => ({ token: `profile-token-${++actorId}`, portal: "company", company: { id: companyId, name: "Fixture" }, user: { id: actorId, name: "Owner", role } });
const customer = (id = 7) => ({ id, name: "Canonical Customer", firstName: "Canonical", lastName: "Customer", phone: "5550000000", email: "actual@example.test", addressLine1: "Verified Address", city: "Verified City", region: "FL", postalCode: "32501" });
const canonical = (id = 21, customerId = 7) => ({ id, customerId, assignedUserId: null, title: "Canonical Service", serviceName: "Canonical Service", status: "scheduled", scheduledStartAt: "2026-12-01T15:30:00Z", scheduledEndAt: "2026-12-01T17:00:00Z", updatedAt: "version", amount: 90, customerName: "Canonical Customer", addressLine1: null, city: null, assignedName: null });
const detail = (id = 84, customerId = 7) => ({ ...canonical(id, customerId), companyId: 9, photos: [], persistedPhotoIds: [] });
function text(node: any): string { return typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : ""; }
function button(label: string) { const node = mocks.controls.findLast((node) => node.kind === "TouchableOpacity" && (node.accessibilityLabel === label || text(node.children) === label)); if (!node) throw new Error(`Missing ${label}: ${doc.body.textContent}`); return node.onPress; }
async function render() { mocks.controls = []; await act(async () => root.render(<Screen />)); }
async function press(label: string) { await act(async () => { await button(label)(); }); }
async function settleConfirmedClose() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
async function open() { await press("New Job for customer"); return mocks.sheets.at(-1); }
async function openHistory(legacy = false) { await press("Jobs (1)"); const row = mocks.controls.findLast((node) => node.kind === "TouchableOpacity" && text(node.children).includes(legacy ? "Legacy Service" : "Canonical Service")); await act(async () => row.onPress()); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function legacyWrites() { return Object.values(mocks.mutations).reduce((sum, entry) => sum + entry.mutate.mock.calls.length + entry.mutateAsync.mock.calls.length, 0); }
beforeEach(() => {
  mocks.focused = true; mocks.loading = false; mocks.employeeLoading = false; mocks.session = company();
  mocks.employee = { employeeId: "legacy-admin", role: "admin", sessionSource: "local" };
  mocks.params = { fullName: "Untrusted route name", customerId: "7", email: "untrusted@example.test", phone: "untrusted", address: "Untrusted Address" };
  mocks.token = "legacy-token"; mocks.controls = []; mocks.sheets = []; mocks.legacy = []; mocks.queries = []; mocks.mutations = {};
  mocks.alerts.mockReset(); mocks.push.mockReset(); mocks.customers.mockReset().mockResolvedValue([customer()]); mocks.customer.mockReset().mockResolvedValue(customer());
  mocks.jobs.mockReset().mockResolvedValue([canonical()]); mocks.signed.mockReset().mockImplementation(async () => mocks.session);
  mocks.settings.mockReset().mockResolvedValue({ id: 9, timezone: "America/Chicago", name: "Company" });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No live transport allowed"); })); doc = installPhotoTestDOM(); root = createRoot(doc.body);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("actual Company profile create handlers (offline React lifecycle)", () => {
  it.each(["New Job for customer", "Create Job for customer"])("routes %s to the canonical sheet with exact ID, not display/contact prefill", async (label) => {
    await render(); await press(label);
    expect(mocks.sheets.at(-1)).toMatchObject({ visible: true, session: mocks.session, customerPrefill: { customerId: 7, companyId: 9 }, initialStartHour: 9 });
    expect(mocks.sheets.at(-1)).not.toHaveProperty("prefill"); expect(mocks.legacy).toHaveLength(0); expect(legacyWrites()).toBe(0);
  });
  it("routes Company Rebook to the same guarded sheet and preserves known Company-local date/time", async () => {
    await render(); await openHistory(); const rebook = button("🔄 Rebook");
    await act(async () => { rebook(); rebook(); });
    expect(mocks.sheets.at(-1)).toMatchObject({ initialDate: "2026-12-01", initialStartHour: 9.5, initialEndHour: 11, customerPrefill: { customerId: 7, companyId: 9 } });
    expect(mocks.settings).toHaveBeenCalledTimes(1); expect(mocks.legacy).toHaveLength(0); expect(legacyWrites()).toBe(0);
  });
  it("synchronously locks rapid mixed header/action taps before signed-session lookup completes", async () => {
    await render(); const pending = deferred<any>(); mocks.signed.mockReturnValueOnce(pending.promise);
    const header = button("New Job for customer"), action = button("Create Job for customer");
    await act(async () => { header(); action(); header(); }); expect(mocks.settings).not.toHaveBeenCalled();
    await act(async () => pending.resolve(mocks.session)); expect(mocks.settings).toHaveBeenCalledTimes(1);
    await press("New Job for customer"); expect(mocks.settings).toHaveBeenCalledTimes(1); expect(legacyWrites()).toBe(0);
  });
  it.each(["pending", "employee-pending", "bridge", "provenance", "logout", "technician", "platform"])("never mounts legacy creation for %s Company scope", async (state) => {
    if (state === "logout") { await render(); mocks.session = null; }
    if (["pending", "employee-pending", "bridge", "provenance"].includes(state)) mocks.session = null;
    if (state === "pending") mocks.loading = true;
    if (state === "employee-pending") mocks.employeeLoading = true;
    if (state === "bridge") mocks.employee.sessionSource = "jobsync";
    if (state === "provenance") mocks.params.companyId = "9";
    if (state === "technician") mocks.session.user.role = "technician";
    if (state === "platform") mocks.session.portal = "platform";
    await render(); await press("New Job for customer"); await press("Create Job for customer");
    expect(mocks.sheets).toHaveLength(0); expect(mocks.legacy).toHaveLength(0); expect(legacyWrites()).toBe(0);
  });
  it.each(["portal_7", "0", "9007199254740992", "07", "missing"])("does not use contact coincidence to rescue invalid canonical ID %s", async (id) => {
    mocks.params.customerId = id; await render(); await open(); expect(mocks.sheets).toHaveLength(0); expect(mocks.customer).not.toHaveBeenCalled(); expect(legacyWrites()).toBe(0);
  });
  it("falls back to signed exact customer detail when current history could not load", async () => {
    mocks.customers.mockRejectedValue(new Error("history offline")); await render(); await open();
    expect(mocks.customer).toHaveBeenCalledWith(mocks.session.token, 7); expect(mocks.sheets.at(-1).customerPrefill).toEqual({ customerId: 7, companyId: 9 });
  });
  it.each(["wrong-id", "denied", "wrong-company", "signed-role"])("fails closed for %s authenticated customer/scope evidence", async (state) => {
    mocks.customers.mockRejectedValue(new Error("unavailable")); await render();
    if (state === "wrong-id") mocks.customer.mockResolvedValue(customer(8));
    if (state === "denied") mocks.customer.mockRejectedValue(new Error("Denied"));
    if (state === "wrong-company") mocks.params.companyId = "10";
    if (state === "signed-role") mocks.signed.mockResolvedValue({ ...mocks.session, user: { ...mocks.session.user, role: "technician" } });
    await render(); await open(); expect(mocks.sheets).toHaveLength(0); expect(mocks.legacy).toHaveLength(0); expect(legacyWrites()).toBe(0);
  });
  it.each(["blur-return", "company", "token", "role", "unmount"])("rejects late opener completion and retained header after %s", async (change) => {
    await render(); const old = button("New Job for customer"), pending = deferred<any>(); mocks.settings.mockReturnValueOnce(pending.promise);
    await press("New Job for customer");
    if (change === "blur-return") { mocks.focused = false; await render(); mocks.focused = true; await render(); }
    if (change === "company") { mocks.session = company("owner", 10); await render(); }
    if (change === "token") { mocks.session = { ...mocks.session, token: "rotated" }; await render(); }
    if (change === "role") { mocks.session = { ...mocks.session, user: { ...mocks.session.user, role: "dispatcher" } }; await render(); }
    if (change === "unmount") { await act(async () => root.unmount()); root = createRoot(doc.body); }
    await act(async () => { pending.resolve({ id: 9, timezone: "America/Chicago" }); old(); });
    expect(mocks.sheets).toHaveLength(0); expect(legacyWrites()).toBe(0);
  });
  it("does not make Company display-name/contact changes an authorization boundary", async () => {
    await render(); const sheet = await open(); mocks.params = { ...mocks.params, fullName: "Changed label", phone: "Other label" }; await render();
    expect(sheet.isCurrent()).toBe(true); expect(mocks.sheets.at(-1).customerPrefill).toEqual({ customerId: 7, companyId: 9 });
  });
  it("detail selection cancels an obsolete pending opener without leaving Rebook locked", async () => {
    await render(); const pending = deferred<any>(); mocks.settings.mockReturnValueOnce(pending.promise);
    await press("New Job for customer"); await openHistory();
    await act(async () => pending.resolve({ id: 9, timezone: "America/Chicago" })); expect(mocks.sheets).toHaveLength(0);
    await press("🔄 Rebook"); expect(mocks.sheets.at(-1).customerPrefill).toEqual({ customerId: 7, companyId: 9 }); expect(legacyWrites()).toBe(0);
  });
});

describe("profile known-saved canonical calendar acknowledgement", () => {
  it("awaits canonical GET and signed-current validation before updating verified history and closing", async () => {
    await render(); const sheet = await open(), pending = deferred<any[]>(); mocks.jobs.mockReturnValueOnce(pending.promise);
    let result: any; await act(async () => { result = sheet.onCreated(detail(), "America/Chicago"); });
    expect(sheet.isCurrent()).toBe(true); expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => { pending.resolve([canonical(), canonical(84)]); expect(await result).toBe(true); });
    await settleConfirmedClose();
    expect(sheet.isCurrent()).toBe(false); expect(doc.body.textContent).toContain("Recent/loaded Company Jobs"); expect(doc.body.textContent).toContain("Jobs (2)"); expect(legacyWrites()).toBe(0);
  });
  it("returns false and leaves known-saved sheet current on GET failure, then GET-only retry confirms", async () => {
    await render(); const sheet = await open(); mocks.jobs.mockRejectedValueOnce(new Error("offline"));
    await act(async () => expect(await sheet.onCreated(detail(), "America/Chicago")).toBe(false)); expect(sheet.isCurrent()).toBe(true);
    mocks.jobs.mockResolvedValue([canonical(), canonical(84)]);
    await act(async () => expect(await sheet.onCreated(detail(), "America/Chicago")).toBe(true)); await settleConfirmedClose(); expect(sheet.isCurrent()).toBe(false); expect(legacyWrites()).toBe(0);
  });
  it.each(["absent", "wrong-customer", "wrong-company", "bad-time", "invalid-timezone"])("keeps saved sheet open when canonical refresh is unconfirmed: %s", async (state) => {
    await render(); const sheet = await open();
    const row: any = canonical(84); if (state === "wrong-customer") row.customerId = 8; if (state === "wrong-company") row.companyId = 10; if (state === "bad-time") row.scheduledStartAt = null;
    mocks.jobs.mockResolvedValue(state === "absent" ? [] : [row]);
    await act(async () => expect(await sheet.onCreated(detail(), state === "invalid-timezone" ? "Invalid/Zone" : "America/Chicago")).toBe(false));
    expect(sheet.isCurrent()).toBe(true); expect(mocks.push).not.toHaveBeenCalled(); expect(legacyWrites()).toBe(0);
  });
  it("supports deliberate customer change by navigating the confirmed saved canonical ID, not changing profile identity", async () => {
    await render(); const sheet = await open(); mocks.jobs.mockResolvedValue([canonical(84, 8)]);
    await act(async () => expect(await sheet.onCreated(detail(84, 8), "America/Chicago")).toBe(true));
    await settleConfirmedClose();
    expect(mocks.push).toHaveBeenCalledWith({ pathname: "/(tabs)/admin-schedule", params: { highlightBookingId: "84" } }); expect(sheet.isCurrent()).toBe(false);
  });
  it("synchronously excludes duplicate retained calendar-refresh callbacks", async () => {
    await render(); const sheet = await open(), pending = deferred<any[]>(); mocks.jobs.mockReturnValueOnce(pending.promise);
    let result: any; const before = mocks.jobs.mock.calls.length;
    await act(async () => { result = sheet.onCreated(detail(), "America/Chicago"); expect(await sheet.onCreated(detail(), "America/Chicago")).toBe(false); });
    expect(mocks.jobs.mock.calls.length).toBe(before + 1);
    await act(async () => { pending.resolve([canonical(84)]); expect(await result).toBe(true); }); await settleConfirmedClose();
    expect(legacyWrites()).toBe(0);
  });
  it.each(["pre-read", "post-read"])("rejects a changed signed actor %s without calendar acknowledgment", async (stage) => {
    await render(); const sheet = await open(), original = mocks.session;
    const changed = { ...original, user: { ...original.user, role: "technician" } };
    const before = mocks.jobs.mock.calls.length;
    if (stage === "pre-read") mocks.signed.mockResolvedValueOnce(changed);
    else { mocks.signed.mockResolvedValueOnce(original).mockResolvedValueOnce(changed); mocks.jobs.mockResolvedValue([canonical(84)]); }
    await act(async () => expect(await sheet.onCreated(detail(), "America/Chicago")).toBe(false));
    expect(mocks.jobs.mock.calls.length).toBe(before + (stage === "pre-read" ? 0 : 1)); expect(sheet.isCurrent()).toBe(true); expect(mocks.push).not.toHaveBeenCalled();
  });
  it("a confirmed deferred close cannot navigate or close a replacement sheet after blur/refocus", async () => {
    vi.useFakeTimers(); await render(); const sheet = await open(); mocks.jobs.mockResolvedValue([canonical(84, 8)]);
    await act(async () => expect(await sheet.onCreated(detail(84, 8), "America/Chicago")).toBe(true));
    mocks.focused = false; await render(); mocks.focused = true; await render(); await open(); const replacement = mocks.sheets.at(-1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(replacement.isCurrent()).toBe(true); expect(mocks.push).not.toHaveBeenCalled(); expect(sheet.isCurrent()).toBe(false);
  });
  it.each(["close-reopen", "blur-return", "company", "token", "role"])("rejects retained close/success or late GET after %s without affecting replacement sheet", async (change) => {
    await render(); const sheet = await open(), pending = deferred<any[]>(); mocks.jobs.mockReturnValueOnce(pending.promise);
    let result: any; await act(async () => { result = sheet.onCreated(detail(), "America/Chicago"); });
    if (change === "close-reopen") { await act(async () => sheet.onClose()); await open(); }
    if (change === "blur-return") { mocks.focused = false; await render(); mocks.focused = true; await render(); await open(); }
    if (change === "company") { mocks.session = company("owner", 10); await render(); }
    if (change === "token") { mocks.session = { ...mocks.session, token: "rotated" }; await render(); await open(); }
    if (change === "role") { mocks.session = { ...mocks.session, user: { ...mocks.session.user, role: "dispatcher" } }; await render(); await open(); }
    const replacement = mocks.sheets.at(-1);
    await act(async () => { pending.resolve([canonical(84)]); expect(await result).toBe(false); sheet.onClose(); });
    expect(sheet.isCurrent()).toBe(false); if (change !== "company") expect(replacement.isCurrent()).toBe(true); expect(mocks.push).not.toHaveBeenCalled(); expect(legacyWrites()).toBe(0);
  });
});

describe("genuine legacy profile creation stays outside Company workspace", () => {
  it("preserves contact prefill and suppresses copied close callback after same-scope reopen", async () => {
    mocks.session = null; await render(); await press("New Job for customer"); const old = mocks.legacy.at(-1);
    expect(old.visible).toBe(true); expect(old.prefill.firstName).toBe("Untrusted");
    await act(async () => { old.onClose(); await Promise.resolve(); }); await press("New Job for customer");
    await act(async () => { old.onSaved(); await Promise.resolve(); }); expect(mocks.legacy.at(-1).visible).toBe(true); expect(mocks.sheets).toHaveLength(0); expect(legacyWrites()).toBe(0);
  });
  it.each(["current", "blur"])("retains legacy delayed Rebook safely: %s", async (state) => {
    vi.useFakeTimers(); mocks.session = null; await render(); await openHistory(true); await press("🔄 Rebook");
    if (state === "blur") { mocks.focused = false; await render(); }
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(mocks.legacy.at(-1).visible).toBe(state === "current"); expect(mocks.sheets).toHaveLength(0); expect(legacyWrites()).toBe(0);
  });
});

// Use the real controller with injected read/write mocks and the actual profile callback.
// This proves failure/unknown recovery does not allocate a second create request.
describe("profile callback plus real controller recovery (no live I/O)", () => {
  it.each(["known-saved", "unknown"])("preserves %s one-POST recovery state", async (outcome) => {
    await render(); const sheet = await open();
    const ack = { ...detail(), priceBookServiceId: 31 };
    const create = vi.fn().mockResolvedValue(ack), readDetail = vi.fn().mockResolvedValue(detail()), reads = vi.fn().mockResolvedValue([]);
    if (outcome === "unknown") create.mockRejectedValue(new JobSyncApiError("Timed out", null, "TIMEOUT"));
    else mocks.jobs.mockRejectedValue(new Error("calendar offline"));
    const onCreated = vi.fn(sheet.onCreated);
    const controller = createCompanyJobController({ session: mocks.session, isCurrent: sheet.isCurrent, onCreated, onState: vi.fn(), verifyAssignment: vi.fn().mockResolvedValue(true),
      transport: { session: mocks.signed, settings: mocks.settings, customer: mocks.customer,
        priceBook: vi.fn().mockResolvedValue([{ serviceId: "31", name: "Canonical Service", basePrice: 90, vehiclePrices: {} }]), create, detail: readDetail, jobs: reads } as any });
    const draft = { customerId: 7, serviceId: "31", date: "2026-12-01", startHour: 9.5, endHour: 11 };
    await act(async () => { await controller.submit(draft); await controller.submit(draft); });
    expect(create).toHaveBeenCalledTimes(1); expect(controller.getState().phase).toBe(outcome === "unknown" ? "uncertain" : "saved");
    expect(controller.getState().jobId).toBe(outcome === "unknown" ? null : 84);
    if (outcome === "unknown") expect(onCreated).not.toHaveBeenCalled();
    else expect(controller.getState().message).toContain("calendar refresh failed");
    mocks.jobs.mockResolvedValue([canonical(84)]);
    await act(async () => { await controller.reconcile(); });
    expect(create).toHaveBeenCalledTimes(1);
    if (outcome === "unknown") { expect(controller.getState().phase).toBe("uncertain"); expect(reads).toHaveBeenCalledTimes(1); }
    else { expect(controller.getState().phase).toBe("succeeded"); expect(readDetail).toHaveBeenCalledTimes(2); }
    controller.detach(); expect(legacyWrites()).toBe(0);
  });
});

describe("source-harness creation entrypoint boundary", () => {
  it("all actual button handlers route centrally and no Company branch can mount the legacy writer", () => {
    const source = readFileSync("app/(tabs)/admin-customer-profile.tsx", "utf8");
    const sf = ts.createSourceFile("profile.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const handlers: string[] = [];
    const visit = (node: ts.Node) => { if (ts.isJsxAttribute(node) && node.name.getText(sf) === "onPress" && node.initializer) handlers.push(node.initializer.getText(sf)); ts.forEachChild(node, visit); }; visit(sf);
    expect(handlers.filter((value) => value === "{handleOpenCreateJob}")).toHaveLength(2);
    expect(source).not.toContain("setShowAddJobModal(true)"); expect(source).toContain("{legacyReady && <AddJobModal");
    const section = source.slice(source.indexOf("const refreshCreatedCompanyJob"), source.indexOf("const handleRebook"));
    for (const forbidden of ["Date.now", "upsert", "createRecurring", "mutateAsync", "persistJobs"]) expect(section).not.toContain(forbidden);
  });
});
