import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { getJobProgressTransition } from "../lib/job-progress";
import { getCompanyJobBillingState, positiveJobSyncId } from "../lib/jobsync-mobile-api";
import { isAssignedCompanyTechnician } from "../lib/company-job-fieldwork";

// Execute the production AST node, not a duplicated policy implementation or a
// full-screen mount. All external side effects are injected offline spies.
const source = readFileSync("app/(tabs)/schedule.tsx", "utf8");
const ast = ts.createSourceFile("schedule.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function nodes(root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  function visit(node: ts.Node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(root); return found;
}
const screen = nodes(ast, (node) => ts.isFunctionDeclaration(node) && node.name?.text === "ScheduleScreen")[0];
const checkout = nodes(ast, (node) => ts.isFunctionDeclaration(node) && node.name?.text === "CheckoutModal")[0];
const notes = nodes(ast, (node) => ts.isFunctionDeclaration(node) && node.name?.text === "PrivateNotesCard")[0];
function expression(name: string, root = screen) {
  const node = nodes(root, (node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === name)[0] as ts.VariableDeclaration;
  if (!node?.initializer) throw new Error(`Missing production initializer: ${name}`);
  return node.initializer.getText(ast);
}
function execute(text: string, context: Record<string, any>) {
  const code = ts.transpileModule(`const extracted = (${text});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  return new Function(...Object.keys(context), `${code}; return extracted;`)(...Object.values(context));
}
function handler(name: string, context: Record<string, any>, root = screen) { return execute(expression(name, root), context); }
function effect(fragment: string) {
  const call = nodes(screen, (node) => ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes(fragment))[0] as ts.CallExpression;
  if (!call) throw new Error(`Missing effect: ${fragment}`);
  return call.arguments[0].getText(ast);
}
function deferred<T = any>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
const companySession = { token: "offline-token", portal: "company", company: { id: 9 }, user: { id: 41, role: "technician", calendarEligible: false } };
const legacyJob = { id: "legacy-job", firstName: "Legacy", lastName: "Customer", address: "100 Main St", price: 100, status: "on_my_way", weekOffset: 0, dayIndex: 0, photos: ["file://one", "file://two"], upsellIds: [], upsellQtys: {} };
function fixture(overrides: Record<string, any> = {}) {
  const spyMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue({ success: true, photos: [] }) });
  const ref = { current: { key: "scope", generation: 1, companyMode: false, mounted: true, focused: true, focusGeneration: 1 } };
  const locks = { current: new Set<string>() };
  const state = { jobs: (overrides.jobs ?? [overrides.selectedJob ?? legacyJob]) as any[], selected: (overrides.selectedJob ?? legacyJob) as any, addr: [] as any[] };
  const updates = { jobs: vi.fn(), selected: vi.fn(), addr: vi.fn() };
  const context: Record<string, any> = {
    companyJobMode: false, authLoading: false, jobSyncLoading: false, hasJobSyncEmployee: false, isJobSyncCompany: false,
    employee: { employeeId: "local-41", fullName: "Legacy Technician", role: "detailer", sessionSource: "local", upsellBonusPct: 40 },
    jobSyncSession: null, selectedJob: legacyJob, jobs: [legacyJob], legacyMediaSessionRef: ref, actionKey: "scope", actionGeneration: 1,
    legacyTokenIdentity: "local-token", scheduleLegacyTokenIdentity: () => "local-token", legacyWriteLocksRef: locks,
    jobsRef: { current: state.jobs }, storageKeyRef: { current: "legacy-cache" }, AsyncStorage: { setItem: vi.fn(), getItem: vi.fn().mockResolvedValue(null), removeItem: vi.fn().mockResolvedValue(null) },
    setJobs: (value: any) => { updates.jobs(value); state.jobs = typeof value === "function" ? value(state.jobs) : value; },
    setSelectedJob: (value: any) => { updates.selected(value); state.selected = typeof value === "function" ? value(state.selected) : value; },
    setAddrPhotos: (value: any) => { updates.addr(value); state.addr = value; },
    Alert: { alert: vi.fn() }, Platform: { OS: "web" }, Haptics: { notificationAsync: vi.fn(), NotificationFeedbackType: { Success: "success", Error: "error" } },
    ImagePicker: { launchImageLibraryAsync: vi.fn().mockResolvedValue({ canceled: false, assets: [{ base64: "YQ==", mimeType: "image/jpeg" }] }), MediaTypeOptions: { Images: "images" } },
    uploadAddrPhotoMutation: spyMutation(), jobStatusMutation: spyMutation(), jobUpsertMutation: spyMutation(), jobMetaMutation: spyMutation(),
    stampTimestampMutation: spyMutation(), portalBookingStatusMutation: spyMutation(), jobSavePaymentMutation: spyMutation(), portalBookingPaymentMutation: spyMutation(),
    performanceUpsertMutation: spyMutation(), refundPaymentMutation: spyMutation(), jobDeleteMutation: spyMutation(),
    startLocationSharing: vi.fn(), stopLocationSharing: vi.fn(), getJobProgressTransition, COMPANY_PHOTO_MUTATIONS_PENDING: "Legacy route unavailable for Company Jobs",
    utils: { jobs: { listByLocation: { fetch: vi.fn().mockResolvedValue([]) }, getAddressPhotos: { fetch: vi.fn().mockResolvedValue([]) }, getPhotos: { fetch: vi.fn().mockResolvedValue({ urls: [] }) } }, customer: { listByLocation: { fetch: vi.fn().mockResolvedValue([]) } }, performance: { getDateRange: { invalidate: vi.fn() } } },
    setAddrPhotoUploading: vi.fn(), setSavingMeta: vi.fn(), setSavingUpsells: vi.fn(), setShowUpsellPanel: vi.fn(), setUpsellIds: vi.fn(), setUpsellQtys: vi.fn(),
    setCustomUpsellName: vi.fn(), setCustomUpsellPrice: vi.fn(), setShowCheckout: vi.fn(), setIsRefunding: vi.fn(), setViewingAddrPhoto: vi.fn(),
    addrPhotos: [], upsellIds: [], upsellQtys: {}, customUpsellName: "Offline add-on", customUpsellPrice: "25", ADDONS: [],
    checkoutJobRef: { current: legacyJob }, checkoutScopeRef: { current: null }, checkoutRenderOrigin: null, checkoutTimerRef: { current: null },
    checkoutIdentity: "checkout-scope", checkoutLiveRef: { current: { identity: "checkout-scope", generation: 1, selectedId: undefined } },
    setTimeout, clearTimeout, fetch: vi.fn().mockRejectedValue(new Error("Unexpected offline transport")),
    PAYMENT_METHOD_LABELS: { cash: "Cash", credit_debit: "Card" }, scheduleReadEpochRef: { current: 0 }, companyScheduleSessionRef: { current: companySession.token },
    setCompanyCalendarError: vi.fn(), setCompanyTimezone: vi.fn(), setWeekOffset: vi.fn(), setSelectedDay: vi.fn(), highlightJobHandledRef: { current: null }, highlightJobId: "missing",
    positiveJobSyncId, isAssignedCompanyTechnician, APP_API_BASE: "https://legacy.invalid", _schedPackages: [], PACKAGES: [], getWeekDates: () => [new Date("2026-11-15T12:00:00Z")],
    localDateStr: () => "2026-11-15", parseLocalDate: (value: string) => new Date(value), selectedLocation: "crestview", formatHour: (value: any) => String(value),
    ...overrides,
  };
  context.captureScreenAction = handler("captureScreenAction", context);
  context.captureLegacyAction = handler("captureLegacyAction", context);
  context.claimLegacyWrite = handler("claimLegacyWrite", context);
  context.persistJobs = handler("persistJobs", context);
  context.jobToServerPayload = vi.fn().mockReturnValue({ jobId: context.selectedJob?.id });
  context.syncJobToServer = handler("syncJobToServer", context);
  context.syncUpsellsToServer = handler("syncUpsellsToServer", context);
  return { context, ref, locks, state, updates, invalidate: () => { ref.current.generation += 1; } };
}
function noWrites(context: Record<string, any>) {
  for (const name of ["jobStatusMutation", "jobUpsertMutation", "jobMetaMutation", "stampTimestampMutation", "portalBookingStatusMutation", "jobSavePaymentMutation", "portalBookingPaymentMutation", "performanceUpsertMutation", "uploadAddrPhotoMutation", "refundPaymentMutation"]) {
    expect(context[name].mutate).not.toHaveBeenCalled(); expect(context[name].mutateAsync).not.toHaveBeenCalled();
  }
  expect(context.AsyncStorage.setItem).not.toHaveBeenCalled();
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("technician schedule actual extracted legacy callbacks (offline, not full-screen mount)", () => {
  it.each(["technician", "owner", "dispatcher"])("blocks Company %s Save/Sync upsells, metadata, progress and Location Add at handler entry", async (role) => {
    const f = fixture({ companyJobMode: true, isJobSyncCompany: true, jobSyncSession: { ...companySession, user: { ...companySession.user, role } }, selectedJob: { ...legacyJob, id: "47", companyId: 9 } });
    await handler("saveUpsells", f.context)(); f.context.syncUpsellsToServer(f.context.selectedJob); f.context.syncJobToServer(f.context.selectedJob);
    await handler("saveJobTags", f.context)(f.context.selectedJob, ["tag"]);
    await handler("saveTaxAmount", f.context)(f.context.selectedJob, 5);
    handler("advanceStatus", f.context)(f.context.selectedJob); await handler("handleAddAddrPhoto", f.context)();
    noWrites(f.context); expect(f.context.ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled(); expect(f.updates.jobs).not.toHaveBeenCalled();
  });
  it.each(["generation", "company", "blur", "unmount", "token"])("old callback is denied after %s invalidation", async (change) => {
    const f = fixture(); const save = handler("saveUpsells", f.context); const advance = handler("advanceStatus", f.context); const add = handler("handleAddAddrPhoto", f.context);
    if (change === "generation") f.invalidate(); if (change === "company") f.ref.current.companyMode = true;
    if (change === "blur") f.ref.current.focused = false; if (change === "unmount") f.ref.current.mounted = false;
    if (change === "token") f.context.scheduleLegacyTokenIdentity = () => "changed-token";
    // Token getter closure itself uses an injected mutable token cell below.
    if (change === "token") f.invalidate();
    await save(); advance(legacyJob); await add(); noWrites(f.context);
  });
  it("runtime guard detects local token changes without rerender", () => {
    let token = "local-token"; const f = fixture({ scheduleLegacyTokenIdentity: () => token }); const allowed = f.context.captureLegacyAction(legacyJob);
    expect(allowed()).toBe(true); token = "replacement"; expect(allowed()).toBe(false); token = "local-token"; f.invalidate(); expect(allowed()).toBe(false);
  });
  it("preserves same-scope legacy Save/Sync upsells and synchronously excludes repeat writes", async () => {
    const f = fixture(); const save = handler("saveUpsells", f.context); await save(); await save(); f.context.syncUpsellsToServer(legacyJob);
    expect(f.context.jobStatusMutation.mutate).toHaveBeenCalledTimes(1); expect(f.context.jobUpsertMutation.mutate).toHaveBeenCalledTimes(1);
    expect(f.context.jobStatusMutation.mutate.mock.calls[0][0]).toMatchObject({ jobId: "legacy-job", status: "in_progress", upsellTotal: 25 });
    expect(f.state.selected.upsellTotal).toBe(25); expect(f.context.AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  });
  it("same-scope legacy metadata retains exact tags/tax endpoint bodies", async () => {
    const f = fixture(); await handler("saveJobTags", f.context)(legacyJob, ["existing"]); await handler("saveTaxAmount", f.context)(legacyJob, 12.5);
    expect(f.context.jobMetaMutation.mutateAsync).toHaveBeenNthCalledWith(1, { jobId: "legacy-job", tags: '["existing"]' });
    expect(f.context.jobMetaMutation.mutateAsync).toHaveBeenNthCalledWith(2, { jobId: "legacy-job", taxAmount: "12.50" });
  });
  it("same-scope legacy Arrived advances once and preserves portal mirror; away/back rejects old handler", () => {
    const job = { ...legacyJob, id: "portal_bk_1", bookingId: "bk_1" }; const f = fixture({ selectedJob: job, jobs: [job] }); const advance = handler("advanceStatus", f.context);
    advance(job); advance(job);
    expect(f.context.stampTimestampMutation.mutate).toHaveBeenCalledTimes(1); expect(f.context.stampTimestampMutation.mutate.mock.calls[0][0].field).toBe("arrivedAt");
    expect(f.context.portalBookingStatusMutation.mutate).toHaveBeenCalledOnce(); expect(f.context.jobStatusMutation.mutate).toHaveBeenCalledOnce();
    f.invalidate(); f.ref.current.companyMode = true; f.invalidate(); f.ref.current.companyMode = false; advance(job); expect(f.context.jobStatusMutation.mutate).toHaveBeenCalledOnce();
  });
  it("local-photo Delete Alert is current-scope/one-shot and sends no server delete", () => {
    const f = fixture(); handler("deletePhoto", f.context)("file://one"); const confirm = f.context.Alert.alert.mock.calls[0][2][1].onPress;
    confirm(); confirm(); expect(f.state.selected.photos).toEqual(["file://two"]); expect(f.context.AsyncStorage.setItem).toHaveBeenCalledOnce();
    const stale = fixture(); handler("deletePhoto", stale.context)("file://one"); stale.invalidate(); stale.context.Alert.alert.mock.calls[0][2][1].onPress(); noWrites(stale.context);
  });
  it("delayed Location picker is locked, and stale response sends no upload", async () => {
    const pick = deferred(); const f = fixture(); f.context.ImagePicker.launchImageLibraryAsync.mockReturnValue(pick.promise);
    const add = handler("handleAddAddrPhoto", f.context); const first = add(); await add(); expect(f.context.ImagePicker.launchImageLibraryAsync).toHaveBeenCalledOnce();
    f.invalidate(); pick.resolve({ canceled: false, assets: [{ base64: "YQ==" }] }); await first; noWrites(f.context); expect(f.updates.addr).not.toHaveBeenCalled();
  });
  it("legacy Location upload retains address key/labels and rejects post-upload stale gallery", async () => {
    const ack = deferred(); const f = fixture(); f.context.uploadAddrPhotoMutation.mutateAsync.mockReturnValue(ack.promise);
    const add = handler("handleAddAddrPhoto", f.context); const work = add(); await Promise.resolve();
    expect(f.context.uploadAddrPhotoMutation.mutateAsync).toHaveBeenCalledWith({ addressKey: "100-main-st", base64: "YQ==", mimeType: "image/jpeg", uploadedBy: "Legacy Technician", uploadedByRole: "detailer" });
    f.invalidate(); ack.resolve({ success: true, photos: [{ photoId: "legacy-photo" }] }); await work; expect(f.updates.addr).not.toHaveBeenCalled();
    const good = fixture(); good.context.uploadAddrPhotoMutation.mutateAsync.mockResolvedValue({ success: true, photos: [{ photoId: "preserved" }] }); await handler("handleAddAddrPhoto", good.context)(); expect(good.state.addr).toEqual([{ photoId: "preserved" }]);
  });
  it("legacy address/gallery readbacks cannot repopulate a switched Job", async () => {
    const address = deferred(); const gallery = deferred(); const f = fixture(); f.context.utils.jobs.getAddressPhotos.fetch.mockReturnValue(address.promise); f.context.utils.jobs.getPhotos.fetch.mockReturnValue(gallery.promise);
    const cleanup = execute(effect("Live-refresh photo URLs"), f.context)(); f.invalidate(); cleanup();
    address.resolve([{ photoId: "stale" }]); gallery.resolve({ urls: ["https://legacy.invalid/photo"] }); await Promise.resolve();
    expect(f.state.addr).toEqual([]); expect(f.updates.selected).not.toHaveBeenCalled();
  });
  it("legacy list that becomes stale never sends subsequent portal lookup or cache merge", async () => {
    const read = deferred(); const f = fixture(); f.context.utils.jobs.listByLocation.fetch.mockReturnValue(read.promise);
    const sync = handler("syncServerJobs", f.context); const work = sync("crestview", f.context.employee); expect(f.context.utils.jobs.listByLocation.fetch).toHaveBeenCalledOnce();
    f.invalidate(); read.resolve([]); await work; expect(f.context.utils.customer.listByLocation.fetch).not.toHaveBeenCalled(); noWrites(f.context);
  });
  it("current legacy list/portal empty refresh is retained and writes only its own cache", async () => {
    const f = fixture(); await handler("syncServerJobs", f.context)("crestview", f.context.employee);
    expect(f.context.utils.jobs.listByLocation.fetch).toHaveBeenCalledOnce(); expect(f.context.utils.customer.listByLocation.fetch).toHaveBeenCalledOnce(); expect(f.context.AsyncStorage.setItem).toHaveBeenCalledWith("legacy-cache", "[]");
  });
  it.each(["47", "portal_47", "online_47", "0", "-1", "9007199254740992"])("unmatched Company highlight %s never calls legacy booking detail", (id) => {
    const f = fixture({ companyJobMode: true, isJobSyncCompany: true, jobSyncSession: companySession, jobs: [], highlightJobId: id }); execute(effect("encodeURIComponent(highlightJobId)"), f.context)();
    expect(f.context.fetch).not.toHaveBeenCalled(); expect(f.updates.selected).not.toHaveBeenCalled(); expect(f.context.setCompanyCalendarError).toHaveBeenCalledWith(expect.stringContaining("unavailable"));
  });
  it("Company highlight opens only signed numeric canonical assigned row, independent of display name", () => {
    const job = { ...legacyJob, id: "47", companyId: 9, assignedUserId: 41, detailerName: "Different Name" }; const f = fixture({ companyJobMode: true, isJobSyncCompany: true, jobSyncSession: companySession, jobs: [job], highlightJobId: "47" });
    execute(effect("encodeURIComponent(highlightJobId)"), f.context)(); expect(f.state.selected).toEqual(job); expect(f.context.fetch).not.toHaveBeenCalled();
    for (const bad of [{ ...job, companyId: 10 }, { ...job, assignedUserId: 42 }, { ...job, companyId: undefined }]) {
      const denied = fixture({ companyJobMode: true, isJobSyncCompany: true, jobSyncSession: companySession, jobs: [bad], highlightJobId: "47" }); execute(effect("encodeURIComponent(highlightJobId)"), denied.context)(); expect(denied.updates.selected).not.toHaveBeenCalled();
    }
  });
  it("actual visibility predicate is numeric for Company, preserves legacy name match", () => {
    const same = { ...legacyJob, id: "47", companyId: 9, assignedUserId: 41, detailerName: "Different Name" }; const other = { ...same, id: "48", assignedUserId: 42, detailerName: "Legacy Technician" };
    const f = fixture({ companyJobMode: true, isJobSyncCompany: true, jobSyncSession: companySession, jobs: [same, other, legacyJob], myName: "legacy technician", myId: "local-41", isAdminRole: false });
    expect(execute(expression("visibleJobs"), f.context)).toEqual([same]);
    const local = fixture({ jobs: [{ ...legacyJob, detailerName: "Legacy Technician" }], myName: "legacy technician", myId: "local-41", isAdminRole: false }); expect(execute(expression("visibleJobs"), local.context)).toHaveLength(1);
  });
});

describe("technician retained checkout callbacks, no charges or business writes", () => {
  const payment = { method: "cash", subtotal: 100, tipAmount: 0, total: 100, paidAt: "2026-11-15T12:00:00Z" };
  function billingFixture(overrides: Record<string, any> = {}) {
    const f = fixture(overrides); const scope = { isCurrent: f.context.captureScreenAction(), completed: false, identity: "checkout-scope", generation: 1 };
    f.context.checkoutScopeRef.current = scope; f.context.checkoutRenderOrigin = scope; f.context.canUseLegacyBilling = handler("canUseLegacyBilling", f.context); return f;
  }
  it.each(["company", "stale", "new-checkout"])("retained completion rejects %s before local paid/finished/payment/status/performance", (change) => {
    const f = billingFixture(); const complete = handler("handlePaymentComplete", f.context);
    if (change === "company") f.ref.current.companyMode = true;
    if (change === "stale") f.invalidate();
    if (change === "new-checkout") f.context.checkoutScopeRef.current = { ...f.context.checkoutScopeRef.current };
    complete(payment); noWrites(f.context); expect(f.context.fetch).not.toHaveBeenCalled();
  });
  it("legacy completion is one-shot; late performance response after scope switch cannot upsert", async () => {
    const read = deferred(); const f = billingFixture(); f.context.fetch.mockReturnValue(read.promise); const complete = handler("handlePaymentComplete", f.context);
    complete(payment); complete(payment); expect(f.context.jobStatusMutation.mutate).toHaveBeenCalledOnce(); expect(f.context.jobSavePaymentMutation.mutate).toHaveBeenCalledOnce(); expect(f.context.AsyncStorage.setItem).toHaveBeenCalledOnce();
    f.invalidate(); const json = vi.fn().mockResolvedValue({}); read.resolve({ json }); await Promise.resolve(); await Promise.resolve(); expect(json).not.toHaveBeenCalled(); expect(f.context.performanceUpsertMutation.mutate).not.toHaveBeenCalled();
  });
  it("checkout open timer and close-return timer cannot resurrect a blurred/changed scope", () => {
    vi.useFakeTimers(); const f = fixture(); handler("openCheckout", f.context)(legacyJob); f.ref.current.focusGeneration += 1; vi.runAllTimers(); expect(f.context.setShowCheckout).not.toHaveBeenCalledWith(true);
    const closing = billingFixture(); handler("closeCheckout", closing.context)(); closing.ref.current.focused = false; vi.runAllTimers(); expect(closing.updates.selected).not.toHaveBeenCalled();
  });
  it("same-scope checkout open/close preserves the entry and return navigation", () => {
    vi.useFakeTimers(); const f = fixture(); handler("openCheckout", f.context)(legacyJob); vi.advanceTimersByTime(350); expect(f.context.setShowCheckout).toHaveBeenCalledWith(true);
    f.context.checkoutRenderOrigin = f.context.checkoutScopeRef.current; handler("closeCheckout", f.context)(); vi.advanceTimersByTime(300); expect(f.state.selected).toEqual(legacyJob);
  });
  it("Company or stale actual signature callback does not record completion", async () => {
    const f = fixture(); const ctx = { isBillingCurrent: () => false, paymentInFlightRef: { current: false }, paymentConsumedRef: { current: false }, hasSignature: true, setIsProcessing: vi.fn(), onComplete: vi.fn() };
    await handler("handleConfirm", ctx, checkout)(); expect(ctx.onComplete).not.toHaveBeenCalled(); expect(ctx.setIsProcessing).not.toHaveBeenCalled(); noWrites(f.context);
  });
  it("saved-card query's actual enabled expression and charge callback reject Company/current-scope failure", async () => {
    const query = nodes(checkout, (node) => ts.isCallExpression(node) && node.expression.getText(ast) === "trpc.savedCards.list.useQuery")[0] as ts.CallExpression;
    const options = execute(query.arguments[1].getText(ast), { jobCustomerKey: "phone:5555551212", visible: true, isBillingCurrent: () => false }); expect(options.enabled).toBe(false);
    const render = expression("renderCardOnFileConfirm", checkout);
    const node = nodes(checkout, (node) => ts.isJsxAttribute(node) && node.name.getText(ast) === "onPress" && node.getText(ast).includes("chargeCardOnFileMutation.mutateAsync"))[0] as ts.JsxAttribute;
    const callback = (node.initializer as ts.JsxExpression).expression!.getText(ast);
    const charge = vi.fn(); const ctx = { savedCard: { stripeCustomerId: "offline-card" }, isBillingCurrent: () => false, paymentInFlightRef: { current: false }, paymentConsumedRef: { current: false }, chargeCardOnFileMutation: { mutateAsync: charge }, setIsProcessing: vi.fn() };
    await execute(callback, ctx)(); expect(charge).not.toHaveBeenCalled(); expect(render).toContain("isBillingCurrent");
  });
  it("refund Alert retained after Job/session switch cannot charge or locally record refund", async () => {
    const f = fixture({ selectedJob: { ...legacyJob, payment: { ...payment, method: "credit_debit", paymentIntentId: "pi_offline" } } }); await handler("handleRefund", f.context)(); f.invalidate();
    await f.context.Alert.alert.mock.calls[0][2][1].onPress(); noWrites(f.context);
  });
});

describe("private-note actual callbacks and explicit source invariants", () => {
  it("actual retained note Delete confirmation is scope-checked before HTTP and late state", async () => {
    let current = true; const fetch = vi.fn().mockResolvedValue({}); const onNotesChange = vi.fn(); const ctx = { current: () => current, notePendingRef: { current: false }, Alert: { alert: vi.fn() }, fetch, APP_API_BASE: "https://legacy.invalid", job: legacyJob, currentEmployeeId: "local-41", currentRole: "detailer", notes: [{ id: "note" }], onNotesChange };
    handler("deleteNote", ctx, notes)("note"); current = false; await ctx.Alert.alert.mock.calls[0][2][1].onPress(); expect(fetch).not.toHaveBeenCalled(); expect(onNotesChange).not.toHaveBeenCalled();
    current = true; handler("deleteNote", ctx, notes)("note"); const confirm = ctx.Alert.alert.mock.calls[1][2][1].onPress; await confirm(); await confirm(); expect(fetch).toHaveBeenCalledOnce(); expect(onNotesChange).toHaveBeenCalledWith([]);
  });
  it("Company financial unknown is not synthesized to zero/paid and current balance/status are authoritative", () => {
    expect(getCompanyJobBillingState({})).toEqual({ balance: null, paymentStatus: null, isPaid: null, canCollect: false });
    expect(getCompanyJobBillingState({ balance: 25, paymentStatus: "partial" })).toEqual({ balance: 25, paymentStatus: "partial", isPaid: false, canCollect: true });
    expect(getCompanyJobBillingState({ balance: 0, paymentStatus: "paid" }).isPaid).toBe(true);
  });
  it("source invariants only: SDK57 focus, canonical components, guarded unsupported surfaces, finance pass-through and videos stay disabled", () => {
    expect((ast as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics).toHaveLength(0); expect(source).toContain('useLocalSearchParams, useFocusEffect } from "expo-router"');
    expect(source).toContain("<CompanyJobProgress"); expect(source).toContain("<CompanyJobPhotos"); expect(source).toContain("if (companyJobMode) return visibleJobs;");
    expect(source).toContain("{!companyJobMode && showUpsellPanel"); expect(source).toContain("visible={!companyJobMode && showEditServicesSheet}"); expect(source).toContain("{!companyJobMode && viewingAddrPhoto");
    for (const field of ["paidTotal", "refundTotal", "appliedEstimateCredit", "balance", "paymentStatus"]) expect(source).toContain(`${field}: job.${field}`);
    expect(source).toContain("{JOB_VIDEOS_ENABLED &&"); expect(source).not.toContain("updateJobSyncCompanyJobStatus("); expect(source).not.toContain("/api/mobile/v1/jobs/${job.id}/payments");
  });
});

describe("actual technician card billing expressions, not synthesized PaymentRecord", () => {
  const paidConditions = nodes(ast, (node) => ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    && node.left.getText(ast).includes("getCompanyJobBillingState(job).isPaid === true")) as ts.BinaryExpression[];
  const balanceBorders = nodes(ast, (node) => ts.isPropertyAssignment(node) && node.name.getText(ast) === "borderWidth"
    && node.initializer.getText(ast).includes("getCompanyJobBillingState(job).canCollect")) as ts.PropertyAssignment[];
  it.each([
    { label: "canonical paid without local PaymentRecord", job: { companyId: 9, status: "finished", balance: 0, paymentStatus: "paid" }, paid: true, border: 1 },
    { label: "canonical partial ignores stale local PaymentRecord", job: { companyId: 9, status: "finished", balance: 20, paymentStatus: "partial", payment: { amount: 100 } }, paid: false, border: 2.5 },
    { label: "unknown canonical billing does not claim paid or overdue", job: { companyId: 9, status: "finished", payment: { amount: 100 } }, paid: false, border: 1 },
    { label: "inconsistent canonical paid label does not create paid indicator", job: { companyId: 9, status: "finished", balance: 20, paymentStatus: "paid" }, paid: false, border: 1 },
    { label: "genuine legacy paid behavior remains", job: { status: "finished", payment: { amount: 100 }, price: 100 }, paid: true, border: 1 },
    { label: "genuine legacy unpaid behavior remains", job: { status: "finished", price: 100 }, paid: false, border: 2.5 },
  ])("$label", ({ job, paid, border }) => {
    expect(paidConditions).toHaveLength(2);
    expect(balanceBorders).toHaveLength(2);
    for (const condition of paidConditions) expect(execute(condition.left.getText(ast), { job, getCompanyJobBillingState })).toBe(paid);
    for (const property of balanceBorders) expect(execute(property.initializer.getText(ast), { job, getCompanyJobBillingState })).toBe(border);
  });
});

describe("same-Job lifecycle freshness without resetting genuine legacy media", () => {
  it("actual media identity stays stable for status/version changes and changes for Job identity", () => {
    const f = fixture();
    const identity = expression("legacyMediaIdentity");
    const original = execute(identity, f.context);
    f.context.selectedJob = { ...legacyJob, status: "arrived", updatedAt: "2026-11-15T15:18:00Z" };
    expect(execute(identity, f.context)).toBe(original);
    f.context.selectedJob = { ...f.context.selectedJob, id: "another-legacy-job" };
    expect(execute(identity, f.context)).not.toBe(original);
  });
  it("retained legacy Arrived callback cannot stamp/status/cache after the same Job progressed", () => {
    const f = fixture();
    const advance = handler("advanceStatus", f.context);
    f.context.jobsRef.current = [{ ...legacyJob, status: "finished" }];
    advance(legacyJob);
    noWrites(f.context);
    expect(f.updates.jobs).not.toHaveBeenCalled();
    expect(f.updates.selected).not.toHaveBeenCalled();
  });
});
