import React, { act } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM } from "./helpers/company-photo-test-dom";

const mocks = vi.hoisted(() => ({
  focused: true, session: null as any, loading: false, employeeLoading: false,
  employee: { employeeId: "legacy-admin", role: "admin", sessionSource: "local" } as any,
  params: { fullName: "Customer", customerId: "7", email: "customer@example.test" } as any,
  legacyPaid: true, legacyRecurring: false,
  token: "legacy-token", queries: [] as any[], mutations: {} as Record<string, any>, refs: {} as Record<string, any>,
  controls: [] as any[], alerts: vi.fn(), urls: vi.fn(), customers: vi.fn(), jobs: vi.fn(), signed: vi.fn(),
  addJob: [] as any[],
  gallery: [] as any[], controller: [] as any[], cancelCompany: vi.fn(), photoFetch: vi.fn(),
}));
vi.mock("react-native", async () => {
  const React = await import("react");
  const host = (kind: string) => (props: any) => {
    mocks.controls.push({ kind, ...props });
    if (kind === "Modal" && !props.visible) return null;
    return React.createElement("div", null, props.children);
  };
  return { Alert: { alert: mocks.alerts }, Linking: { openURL: mocks.urls }, Platform: { OS: "web" },
    StyleSheet: { create: (styles: any) => styles },
    ...Object.fromEntries(["View", "Text", "TouchableOpacity", "TextInput", "ScrollView", "FlatList", "Image", "Modal"].map((name) => [name, host(name)])) };
});
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused, useRouter: () => ({ back: vi.fn(), push: vi.fn() }), useLocalSearchParams: () => mocks.params }));
vi.mock("expo-haptics", () => ({ impactAsync: vi.fn(), notificationAsync: vi.fn(), ImpactFeedbackStyle: { Light: "light" }, NotificationFeedbackType: { Success: "success" } }));
vi.mock("react-native-maps", () => ({ default: () => null, Marker: () => null, PROVIDER_GOOGLE: "google" }));
vi.mock("@/components/screen-container", async () => {
  const React = await import("react");
  return { ScreenContainer: ({ children }: any) => React.createElement("div", null, children) };
});
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ primary: "#123456", muted: "#888888", border: "#eeeeee", success: "#00aa00" }) }));
vi.mock("@/components/add-job-modal", () => ({ AddJobModal: (props: any) => { mocks.addJob.push(props); return null; } }));
vi.mock("@/lib/jobsync-auth-context", () => ({ useJobSyncAuth: () => ({ session: mocks.session, isLoading: mocks.loading }) }));
vi.mock("@/lib/auth-context", () => ({ useEmployeeAuth: () => ({ employee: mocks.employee, loading: mocks.employeeLoading }) }));
vi.mock("@/lib/_core/auth", () => ({ getSessionToken: async () => mocks.token }));
vi.mock("@/lib/jobsync-mobile-api", async (original) => ({ ...await original<typeof import("../lib/jobsync-mobile-api")>(),
  getJobSyncCompanyCustomers: mocks.customers, getJobSyncCompanyJobs: mocks.jobs, getJobSyncMobileSession: mocks.signed }));
vi.mock("@/hooks/use-company-job", () => ({ useCompanyJob: (session: any, jobId: any) => {
  mocks.controller.push({ session, jobId });
  return { pending: false, actor: session, detail: jobId && session ? { id: jobId, companyId: session.company.id, status: "scheduled", updatedAt: "2026-11-15T12:00:00Z" } : null,
    refresh: vi.fn(), cancelManagement: mocks.cancelCompany };
} }));
vi.mock("@/components/company-job-photos", () => ({
  CompanyJobPhotos: (props: any) => { mocks.gallery.push(props); return null; }, CompanyJobPhotoPreview: () => null,
}));
vi.mock("@/lib/trpc", () => {
  const procedure = (name: string) => ({
    useQuery: (_input: any, options?: any) => {
      mocks.queries.push({ name, enabled: options?.enabled !== false });
      const refetch = mocks.refs[name] ??= vi.fn().mockResolvedValue({});
      const data: any = name === "customers.getJobs" ? { scheduleJobsList: [{ id: "legacy-7", jobId: "legacy-job", date: "2020-01-01", status: "completed", packageType: "Legacy Service", totalPrice: "50", photoUrls: '["https://legacy.test/photo.jpg"]', paymentMethod: mocks.legacyPaid ? "cash" : null, recurrenceParentId: mocks.legacyRecurring ? "series-1" : null, email: "legacy@example.test" }], onlineBookingsList: [] }
        : name === "savedCards.list" ? [{ methodId: "card", stripeCustomerId: "cus_fixture", stripePaymentMethodId: "pm_fixture", brand: "visa", last4: "4242", cardBrand: "visa", cardLast4: "4242", isDefault: 1 }] : [];
      return { data, isLoading: false, refetch };
    },
    useMutation: (callbacks?: any) => {
      const mutation = mocks.mutations[name] ??= { mutateAsync: vi.fn().mockResolvedValue({ paymentIntentId: "pi_mock" }), mutate: vi.fn(), isPending: false };
      // Store hook callbacks too; absence proves no unscoped mutation-hook completion was allocated.
      mutation.callbacks = callbacks;
      return mutation;
    },
  });
  return { trpc: new Proxy({ useUtils: () => ({ jobs: { getPhotos: { fetch: mocks.photoFetch } } }) }, { get(target, group: string) {
    if (group === "useUtils") return target.useUtils;
    return new Proxy({}, { get: (_unused, name: string) => procedure(`${group}.${name}`) });
  } }) };
});
import Screen from "../app/(tabs)/admin-customer-profile";
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
let root: ReturnType<typeof createRoot>;
let doc: ReturnType<typeof installPhotoTestDOM>;
const company = (role = "owner") => ({ token: "company-token", portal: "company", company: { id: 9, name: "Fixture" }, user: { id: 40, name: "Owner", role, calendarEligible: false } });
const canonical = (id = 21, customerId = 7) => ({ id, customerId, assignedUserId: null, title: "Canonical Service", serviceName: "Canonical Service", status: "scheduled", scheduledStartAt: "2026-12-01T10:00:00Z", scheduledEndAt: null, updatedAt: "version", amount: 90, customerName: "Customer", addressLine1: null, city: null, assignedName: null });
function text(node: any): string { if (typeof node === "string" || typeof node === "number") return String(node); if (Array.isArray(node)) return node.map(text).join(""); return node?.props ? text(node.props.children) : ""; }
function button(label: string) { const control = mocks.controls.findLast((node) => node.kind === "TouchableOpacity" && text(node.children) === label); if (!control) throw new Error(`Missing button ${label}; text=${doc.body.textContent}`); return control.onPress; }
async function render() { mocks.controls = []; await act(async () => root.render(<Screen />)); }
async function press(label: string) { await act(async () => { await button(label)(); }); }
function confirm(label: string) { const alert = mocks.alerts.mock.calls.findLast((args) => args[2]?.some((entry: any) => entry.text === label)); if (!alert) throw new Error(`Missing confirmation ${label}`); return alert[2].find((entry: any) => entry.text === label).onPress; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function openLegacy() { await press("Jobs (1)"); const row = mocks.controls.findLast((node) => node.kind === "TouchableOpacity" && text(node.children).includes("Legacy Service")); await act(async () => row.onPress()); }
function forbiddenCalls() { return ["jobs.cancel", "jobs.delete", "jobs.deleteRecurringSeries", "savedCards.chargeCard", "jobs.sendReceipt"].reduce((sum, name) => sum + (mocks.mutations[name]?.mutateAsync.mock.calls.length ?? 0), 0); }
beforeEach(() => {
  mocks.focused = true; mocks.session = null; mocks.loading = false; mocks.employeeLoading = false;
  mocks.legacyPaid = true; mocks.legacyRecurring = false;
  mocks.employee = { employeeId: "legacy-admin", role: "admin", sessionSource: "local" };
  mocks.params = { fullName: "Customer", customerId: "7", email: "customer@example.test" }; mocks.token = "legacy-token";
  mocks.queries = []; mocks.controls = []; mocks.gallery = []; mocks.controller = []; mocks.mutations = {}; mocks.refs = {};
  mocks.addJob = [];
  mocks.alerts.mockReset(); mocks.urls.mockReset(); mocks.customers.mockReset().mockResolvedValue([{ id: 7, name: "Customer" }]);
  mocks.jobs.mockReset().mockResolvedValue([canonical(), canonical(22, 8)]); mocks.signed.mockReset().mockImplementation(async () => mocks.session);
  mocks.cancelCompany.mockReset().mockResolvedValue(true); mocks.photoFetch.mockReset().mockResolvedValue({ urls: [] });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access"); }));
  doc = installPhotoTestDOM(); root = createRoot(doc.body);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("actual customer screen offline Company Job routing", () => {
  it("verifies signed customer ID, filters the canonical loaded subset, selects its DTO gallery and uses management cancel without field opt-in", async () => {
    mocks.session = company(); await render(); await press("Jobs (1)");
    expect(doc.body.textContent).toContain("Recent/loaded Company Jobs"); expect(doc.body.textContent).toContain("not complete history");
    const row = mocks.controls.findLast((node) => node.kind === "TouchableOpacity" && text(node.children).includes("Canonical Service"));
    await act(async () => row.onPress());
    expect(mocks.gallery.at(-1).jobId).toBe(21); expect(mocks.controller.at(-1).jobId).toBe(21);
    await press("Cancel Company Job (management)"); await act(async () => confirm("Cancel Company Job")());
    expect(mocks.cancelCompany).toHaveBeenCalledTimes(1); expect(forbiddenCalls()).toBe(0);
    expect(mocks.queries.filter((q) => ["customers.getJobs", "savedCards.list"].includes(q.name)).every((q) => !q.enabled)).toBe(true);
    expect(mocks.refs["customers.getJobs"]).not.toHaveBeenCalled(); expect(mocks.photoFetch).not.toHaveBeenCalled();
  });
  it("invalidates the existing Company controller between same-ID sheet selections without changing signed identity", async () => {
    mocks.session = company(); await render(); await press("Jobs (1)");
    const open = () => mocks.controls.findLast((node) => node.kind === "TouchableOpacity" && text(node.children).includes("Canonical Service")).onPress();
    await act(async () => open()); await press("Close"); const index = mocks.controller.length;
    await act(async () => open());
    expect(mocks.controller.slice(index).some((entry) => entry.session === null)).toBe(true);
    expect(mocks.controller.at(-1).session.token).toBe("company-token"); expect(mocks.controller.at(-1).jobId).toBe(21);
    expect(forbiddenCalls()).toBe(0);
  });
  it.each(["portal_7", "0", "9007199254740992", "missing"])("does not use route/contact coincidence as canonical customer evidence: %s", async (id) => {
    mocks.session = company(); mocks.params.customerId = id; await render(); await press("Jobs");
    expect(doc.body.textContent).toContain("could not be verified"); expect(doc.body.textContent).not.toContain("No jobs found");
    expect(mocks.jobs).not.toHaveBeenCalled(); expect(mocks.controller.every((entry) => entry.jobId === null)).toBe(true);
  });
  it("does not join a same-contact customer with another canonical ID", async () => {
    mocks.session = company(); mocks.customers.mockResolvedValue([{ id: 8, name: "Customer", email: mocks.params.email }]);
    await render(); await press("Jobs"); expect(doc.body.textContent).toContain("could not be verified"); expect(mocks.jobs).not.toHaveBeenCalled();
  });
  it("truthfully labels zero matching loaded Jobs, not a complete empty history/LTV", async () => {
    mocks.session = company(); mocks.jobs.mockResolvedValue([canonical(22, 8)]); await render(); await press("Jobs");
    expect(doc.body.textContent).toContain("Older Jobs may exist"); expect(doc.body.textContent).not.toContain("No jobs found");
  });
  it("shows explicit Company unavailable on authenticated list failure instead of empty history", async () => {
    mocks.session = company(); mocks.jobs.mockRejectedValue(new Error("offline")); await render(); await press("Jobs");
    expect(doc.body.textContent).toContain("Company customer Jobs unavailable"); expect(doc.body.textContent).not.toContain("No jobs found");
    expect(mocks.controller.every((entry) => entry.jobId === null)).toBe(true);
  });
  it.each(["pending", "bridge", "signed-logout"])("keeps legacy history/cards disabled for %s scope", async (state) => {
    if (state === "pending") mocks.loading = true;
    if (state === "bridge") mocks.employee.sessionSource = "jobsync";
    if (state === "signed-logout") { mocks.session = company(); await render(); mocks.session = null; }
    await render(); await press("Jobs"); expect(doc.body.textContent).toContain("unavailable");
    expect(mocks.queries.filter((q) => ["customers.getJobs", "savedCards.list"].includes(q.name)).every((q) => !q.enabled)).toBe(true);
  });
  it("rejects late old-Company customer results and follow-up list request after blur/refocus", async () => {
    mocks.session = company(); const old = deferred<any[]>(); mocks.customers.mockReturnValueOnce(old.promise); await render();
    mocks.focused = false; await render(); mocks.focused = true; mocks.customers.mockResolvedValue([{ id: 8, name: "Other" }]); await render();
    await act(async () => old.resolve([{ id: 7, name: "Customer" }])); expect(mocks.jobs).not.toHaveBeenCalled();
  });
  it("rejects retained legacy row and raw Job-photo URL callbacks after Company switch while preserving separate attachments", async () => {
    await render(); await press("Jobs (1)"); const oldRow = mocks.controls.findLast((node) => node.kind === "TouchableOpacity" && text(node.children).includes("Legacy Service")).onPress;
    await press("Attachments"); const oldPhoto = mocks.controls.findLast((node) => node.kind === "TouchableOpacity" && node.children?.props?.source?.uri)?.onPress;
    expect(oldPhoto).toBeTypeOf("function");
    mocks.session = company(); await render(); await act(async () => { oldRow(); oldPhoto?.(); });
    expect(mocks.urls).not.toHaveBeenCalled(); expect(doc.body.textContent).toContain("Separately uploaded files"); expect(forbiddenCalls()).toBe(0);
  });
});

describe("actual retained customer Job destructive/billing confirmations", () => {
  it.each(["company", "blur-return", "token", "employee", "close-reopen", "unmount"])("rejects an old cancel confirmation after %s", async (change) => {
    await render(); await openLegacy(); await press("🚫 Cancel Job"); const old = confirm("Cancel Job");
    if (change === "company") { mocks.session = company(); await render(); }
    if (change === "blur-return") { mocks.focused = false; await render(); mocks.focused = true; await render(); }
    if (change === "token") mocks.token = "rotated-token";
    if (change === "employee") { mocks.employee.employeeId = "other-admin"; await render(); }
    if (change === "close-reopen") { await press("Close"); await openLegacy(); }
    if (change === "unmount") { await act(async () => root.unmount()); root = createRoot(doc.body); }
    await act(async () => old()); expect(mocks.mutations["jobs.cancel"].mutateAsync).not.toHaveBeenCalled();
    expect(mocks.refs["customers.getJobs"]).not.toHaveBeenCalled();
  });
  it("synchronously excludes repeated legitimate cancel and preserves the legacy payload/refetch", async () => {
    await render(); await openLegacy(); await press("🚫 Cancel Job"); const callback = confirm("Cancel Job");
    await act(async () => { await Promise.all([callback(), callback()]); });
    expect(mocks.mutations["jobs.cancel"].mutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.mutations["jobs.cancel"].mutateAsync.mock.calls[0][0].jobId).toBe("legacy-job"); expect(mocks.refs["customers.getJobs"]).toHaveBeenCalledTimes(1);
  });
  it.each(["resolve", "reject"])("suppresses stale %s mutation completion: no refetch, alerts or replacement sheet close", async (outcome) => {
    await render(); await openLegacy(); await press("🚫 Cancel Job"); const pending = deferred<any>();
    mocks.mutations["jobs.cancel"].mutateAsync.mockReturnValueOnce(pending.promise); const action = confirm("Cancel Job")();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.mutations["jobs.cancel"].mutateAsync).toHaveBeenCalledTimes(1);
    mocks.session = company(); await render(); const alertCount = mocks.alerts.mock.calls.length;
    await act(async () => { pending.resolve(outcome === "resolve" ? {} : Promise.reject(new Error("late"))); await action; });
    expect(mocks.refs["customers.getJobs"]).not.toHaveBeenCalled(); expect(mocks.alerts.mock.calls.length).toBe(alertCount);
    expect(mocks.mutations["jobs.cancel"].callbacks).toBeUndefined();
  });
  it("rejects retained receipt callback and delete confirmation after Company switch", async () => {
    await render(); await openLegacy(); const receipt = button("🧾 Send Receipt to Customer"); await press("🗑 Delete Job"); const deletion = confirm("Delete Permanently");
    mocks.session = company(); await render(); await act(async () => { await receipt(); await deletion(); }); expect(forbiddenCalls()).toBe(0);
  });
  it("synchronously excludes duplicate receipt writes and rejects late success after blur", async () => {
    await render(); await openLegacy(); const callback = button("🧾 Send Receipt to Customer"), pending = deferred<any>();
    mocks.mutations["jobs.sendReceipt"].mutateAsync.mockReturnValueOnce(pending.promise);
    await act(async () => { callback(); callback(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.mutations["jobs.sendReceipt"].mutateAsync).toHaveBeenCalledTimes(1);
    mocks.focused = false; await render(); const alerts = mocks.alerts.mock.calls.length;
    await act(async () => { pending.resolve({}); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.alerts.mock.calls.length).toBe(alerts);
  });
  it("discards late legacy gallery results after Company scope change", async () => {
    const photos = deferred<{ urls: string[] }>(); mocks.photoFetch.mockReturnValueOnce(photos.promise);
    await render(); await openLegacy(); expect(mocks.photoFetch).toHaveBeenCalledTimes(1);
    mocks.session = company(); await render(); await act(async () => photos.resolve({ urls: ["https://legacy.test/late.jpg"] }));
    expect(doc.body.textContent).not.toContain("BEFORE & AFTER PHOTOS"); expect(mocks.controller.at(-1).jobId).toBe(null);
  });
  it("invalidates the actual delayed Rebook callback on blur before opening creation", async () => {
    vi.useFakeTimers(); await render(); await openLegacy(); await press("🔄 Rebook");
    mocks.focused = false; await render(); await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(mocks.addJob.at(-1).visible).toBe(false); expect(forbiddenCalls()).toBe(0);
  });
  it("preserves legitimate Rebook opening after the existing delay without issuing a write", async () => {
    vi.useFakeTimers(); await render(); await openLegacy(); await press("🔄 Rebook");
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(mocks.addJob.at(-1).visible).toBe(true); expect(forbiddenCalls()).toBe(0);
  });
  it.each(["This Job Only", "This & All Future"])("rejects retained recurring %s callback after blur/refocus", async (label) => {
    mocks.legacyRecurring = true; await render(); await openLegacy(); await press("🗑 Delete Job"); const old = confirm(label);
    mocks.focused = false; await render(); mocks.focused = true; await render(); await act(async () => old()); expect(forbiddenCalls()).toBe(0);
  });
  it.each(["company", "close", "token"])("rejects copied saved-card charge confirmation after %s", async (change) => {
    mocks.legacyPaid = false; await render(); await openLegacy(); await press("💳 Charge Card on File"); await press("Charge Card"); const old = confirm("Charge");
    if (change === "company") { mocks.session = company(); await render(); }
    if (change === "close") await press("Cancel");
    if (change === "token") mocks.token = "rotated-token";
    await act(async () => old()); expect(mocks.mutations["savedCards.chargeCard"].mutateAsync).not.toHaveBeenCalled(); expect(mocks.refs["customers.getJobs"]).not.toHaveBeenCalled();
  });
  it("synchronously excludes duplicate charge dispatch and suppresses late charge completion after Company switch", async () => {
    mocks.legacyPaid = false; await render(); await openLegacy(); await press("💳 Charge Card on File"); await press("Charge Card"); const old = confirm("Charge");
    const pending = deferred<any>(); mocks.mutations["savedCards.chargeCard"].mutateAsync.mockReturnValueOnce(pending.promise);
    await act(async () => { old(); old(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.mutations["savedCards.chargeCard"].mutateAsync).toHaveBeenCalledTimes(1);
    mocks.session = company(); await render(); const alerts = mocks.alerts.mock.calls.length;
    await act(async () => { pending.resolve({ paymentIntentId: "pi_mock" }); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.refs["customers.getJobs"]).not.toHaveBeenCalled(); expect(mocks.alerts.mock.calls.length).toBe(alerts);
    expect(mocks.mutations["savedCards.chargeCard"].callbacks).toBeUndefined();
  });
  it("rejects a delayed Company management cancellation on blur or role change", async () => {
    mocks.session = company(); await render(); await press("Jobs (1)");
    await act(async () => mocks.controls.findLast((node) => node.kind === "TouchableOpacity" && text(node.children).includes("Canonical Service")).onPress());
    await press("Cancel Company Job (management)"); const old = confirm("Cancel Company Job");
    mocks.session = company("technician"); await render(); await act(async () => old()); expect(mocks.cancelCompany).not.toHaveBeenCalled();
  });
});
