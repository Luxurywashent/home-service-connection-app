import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { getCompanyJobBillingState } from "../lib/company-job-billing";
import { createCompanyJobInvoiceOptions, captureCompanyJobInvoiceIntent, assertCompanyJobInvoiceSession, assertCompanyJobInvoiceJob } from "../lib/company-job-invoice-intent";

// Execute AST-extracted *actual* screen closures, not replicas. This fixture does
// not mount AdminScheduleScreen or claim native picker/provider acceptance.
const source = readFileSync(new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("admin-schedule.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const all: ts.Node[] = [];
function visit(node: ts.Node) { all.push(node); ts.forEachChild(node, visit); }
visit(tree);
function callable(node: ts.Node, context: Record<string, any>) {
  const js = ts.transpileModule(`const extracted = (${node.getText(tree)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
  return new Function(...Object.keys(context), `${js}\nreturn extracted;`)(...Object.values(context));
}
function named(name: string, context: Record<string, any>) {
  const declaration = all.find((n): n is ts.VariableDeclaration => ts.isVariableDeclaration(n) && n.name.getText(tree) === name);
  if (!declaration?.initializer) throw new Error(`Missing actual ${name}`);
  return callable(declaration.initializer, context);
}
function jsxCallback(includes: string, context: Record<string, any>, prop = "onPress") {
  const attr = all.find((n): n is ts.JsxAttribute => ts.isJsxAttribute(n) && n.name.getText(tree) === prop && n.initializer?.getText(tree).includes(includes) === true);
  if (!attr?.initializer || !ts.isJsxExpression(attr.initializer) || !attr.initializer.expression) throw new Error(`Missing actual ${prop} containing ${includes}`);
  return callable(attr.initializer.expression, context);
}
function effect(includes: string, context: Record<string, any>) {
  const call = all.find((n): n is ts.CallExpression => ts.isCallExpression(n) && n.expression.getText(tree) === "useEffect" && n.arguments[0]?.getText(tree).includes(includes) === true);
  if (!call) throw new Error(`Missing actual effect ${includes}`);
  return callable(call.arguments[0], context);
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { resolve, promise }; }
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
function legacy() {
  const scope = { key: "fixture-legacy", generation: 0, companyMode: false, mounted: true, focused: true };
  const context: Record<string, any> = {
    managementActionRef: { current: scope }, managementActionKey: scope.key, calendarScopeRef: { current: { key: "fixture-calendar", generation: 0 } }, calendarScopeKey: "fixture-calendar", sheetEpochRef: { current: 4 },
    currentEmployee: { employeeId: "fixture-admin", role: "admin", fullName: "Fixture" }, employeeLoading: false,
    legacyTokenReady: true, legacyToken: "legacy-fixture", Platform: { OS: "ios" },
    LegacyAuth: { getSessionToken: vi.fn().mockResolvedValue("legacy-fixture") },
  };
  const guard = named("captureLegacyJobAction", context)();
  return { scope, context, guard };
}
const job = (extras: Record<string, any> = {}) => ({ id: "12", address: "Fixture Street", phone: "fixture", firstName: "Fixture", lastName: "Customer", price: 300, startHour: 8, endHour: 10, dayIndex: 0, weekOffset: 0, ...extras });
function addressContext() {
  const boundary = legacy();
  const context: Record<string, any> = { ...boundary.context, renderedLegacyAction: boundary.guard,
    selectedJob: job(), addressPhotos: [{ photoId: "legacy-photo", photoUrl: "fixture.invalid/photo" }], addressPhotoLockRef: { current: false },
    ImagePicker: { MediaTypeOptions: { Images: "images" }, launchImageLibraryAsync: vi.fn().mockResolvedValue({ canceled: false, assets: [{ base64: "fixture-base64", mimeType: "image/jpeg" }] }) },
    uploadAddrPhotoMutation: { mutateAsync: vi.fn().mockResolvedValue({ success: true, photos: ["ack"] }) },
    deleteAddrPhotoMutation: { mutateAsync: vi.fn().mockResolvedValue({ success: true }) },
    setAddressPhotos: vi.fn(), setAddrPhotoUploading: vi.fn(), Alert: { alert: vi.fn() },
  };
  return { ...boundary, context };
}
function invalidate(f: ReturnType<typeof legacy>, change: string) {
  if (change === "company") f.scope.companyMode = true;
  else if (change === "blur") { f.scope.focused = false; f.scope.generation++; }
  else if (change === "unmount") f.scope.mounted = false;
  else if (change === "token") f.context.LegacyAuth.getSessionToken.mockResolvedValue("rotated-fixture");
  else if (change === "sheet") f.context.sheetEpochRef.current++;
  else { f.scope.key = "away"; f.scope.generation++; f.scope.key = "fixture-legacy"; f.scope.generation++; }
}

describe("Admin actual extracted legacy action boundary", () => {
  it.each(["company", "blur", "unmount", "token", "sheet", "away/back"])("rejects retained current-scope guard after %s", async (change) => {
    const f = legacy(); expect(f.guard()).toBe(true); expect(await f.guard.verify()).toBe(true);
    invalidate(f, change); expect(await f.guard.verify()).toBe(false);
  });
  it("does not authorize missing/loading employee or unread native token", () => {
    const f = legacy();
    for (const overrides of [{ currentEmployee: null }, { employeeLoading: true }, { legacyTokenReady: false }]) {
      expect(named("captureLegacyJobAction", { ...f.context, ...overrides })()()).toBe(false);
    }
  });
});

describe("Admin actual Location Photo add/delete callbacks", () => {
  it("true legacy upload preserves address key and legacy payload and one synchronous operation", async () => {
    const f = addressContext(); const upload = named("handleAddAddressPhoto", f.context);
    await Promise.all([upload(), upload()]);
    expect(f.context.ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
    expect(f.context.uploadAddrPhotoMutation.mutateAsync).toHaveBeenCalledWith({ addressKey: "fixture-street", base64: "fixture-base64", mimeType: "image/jpeg", uploadedBy: "Fixture", uploadedByRole: "admin" });
    expect(f.context.setAddressPhotos).toHaveBeenCalledWith(["ack"]);
  });
  it.each(["company", "blur", "unmount", "token", "sheet", "away/back"])("picker continuation after %s cannot upload or populate another gallery", async (change) => {
    const f = addressContext(); const wait = deferred<any>(); f.context.ImagePicker.launchImageLibraryAsync.mockReturnValue(wait.promise);
    const pending = named("handleAddAddressPhoto", f.context)(); await flush();
    expect(f.context.ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1); invalidate(f, change);
    wait.resolve({ canceled: false, assets: [{ base64: "fixture" }] }); await pending;
    expect(f.context.uploadAddrPhotoMutation.mutateAsync).not.toHaveBeenCalled(); expect(f.context.setAddressPhotos).not.toHaveBeenCalled();
  });
  it("legitimately sent upload cannot be unsent but its stale acknowledgment is discarded", async () => {
    const f = addressContext(); const wait = deferred<any>(); f.context.uploadAddrPhotoMutation.mutateAsync.mockReturnValue(wait.promise);
    const pending = named("handleAddAddressPhoto", f.context)(); await flush(); expect(f.context.uploadAddrPhotoMutation.mutateAsync).toHaveBeenCalledTimes(1);
    f.scope.companyMode = true; wait.resolve({ success: true, photos: ["old"] }); await pending; expect(f.context.setAddressPhotos).not.toHaveBeenCalled();
  });
  it.each(["company", "blur", "unmount", "token", "sheet", "away/back"])("retained Delete Alert after %s cannot dispatch", async (change) => {
    const f = addressContext(); await named("handleDeleteAddressPhoto", f.context)("legacy-photo");
    const confirm = f.context.Alert.alert.mock.calls[0][2][1].onPress; invalidate(f, change); await confirm();
    expect(f.context.deleteAddrPhotoMutation.mutateAsync).not.toHaveBeenCalled(); expect(f.context.setAddressPhotos).not.toHaveBeenCalled();
  });
  it("duplicate Delete confirmation calls synchronously allow one legacy request", async () => {
    const f = addressContext(); await named("handleDeleteAddressPhoto", f.context)("legacy-photo"); const confirm = f.context.Alert.alert.mock.calls[0][2][1].onPress;
    await Promise.all([confirm(), confirm()]); expect(f.context.deleteAddrPhotoMutation.mutateAsync).toHaveBeenCalledTimes(1);
  });
  it("Company address handlers never open picker or confirmation even if manually retained", async () => {
    const f = addressContext(); f.scope.companyMode = true; await named("handleAddAddressPhoto", f.context)(); await named("handleDeleteAddressPhoto", f.context)("legacy-photo");
    expect(f.context.ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled(); expect(f.context.Alert.alert).not.toHaveBeenCalled();
  });
});

function invoiceContext() {
  const f = legacy(); f.scope.companyMode = true;
  const session = { token: "company-fixture", portal: "company", company: { id: 9 }, user: { id: 42, role: "owner", calendarEligible: false } };
  const context: Record<string, any> = { ...f.context, companyJobMode: true, isJobSyncCompany: true, jobSyncLoading: false, selectedJob: job({ companyId: 9 }), jobSyncSession: session,
    invoiceIdentityKey: "invoice-fixture", invoiceSessionRef: { current: { key: "invoice-fixture", generation: 3 } }, invoiceGeneration: 3,
    renderedSheetEpoch: 4, invoiceEpochRef: { current: 2 }, renderedInvoiceEpoch: 2, showInvoiceSheet: true,
    invoiceLockRef: { current: false }, invoiceMethod: "email", invoiceResend: false,
    createCompanyJobInvoiceOptions, captureCompanyJobInvoiceIntent, assertCompanyJobInvoiceSession, assertCompanyJobInvoiceJob, positiveJobSyncId: (id: any) => /^\d+$/.test(String(id)) && Number.isSafeInteger(Number(id)) && Number(id) > 0 ? Number(id) : null,
    getJobSyncMobileSession: vi.fn().mockResolvedValue(session), getJobSyncCompanyJobDetail: vi.fn().mockResolvedValue({ id: 12, companyId: 9 }),
    sendJobSyncCompanyJobInvoice: vi.fn().mockResolvedValue({ success: true, publicUrl: "https://www.homeserviceconnected.com/invoice/fixture", status: "sent", communicationState: "provider_accepted" }),
    setInvoiceSending: vi.fn(), setInvoiceSentUrl: vi.fn(), setCompanyInvoiceStatus: vi.fn(), Alert: { alert: vi.fn() }, fetch: vi.fn(() => { throw new Error("Forbidden legacy network"); }),
  };
  context.isCurrentInvoice = named("isCurrentInvoice", context);
  return { ...f, context };
}
function invoice(f: ReturnType<typeof invoiceContext>) { return jsxCallback("sendJobSyncCompanyJobInvoice", f.context); }
function invoiceInvalidate(f: ReturnType<typeof invoiceContext>, change: string) {
  if (change === "close/reopen") { f.context.invoiceEpochRef.current++; f.context.invoiceEpochRef.current++; }
  else if (change === "sheet") f.context.sheetEpochRef.current++;
  else if (change === "blur") { f.scope.focused = false; f.context.invoiceSessionRef.current.generation++; }
  else if (change === "unmount") f.scope.mounted = false;
  else { f.context.invoiceSessionRef.current.key = change; f.context.invoiceSessionRef.current.generation++; }
}

describe("Admin actual invoice Send closure", () => {
  it("fresh same Owner OFF invoice uses exact canonical originating Job and one locked request", async () => {
    const f = invoiceContext(); const send = invoice(f); await Promise.all([send(), send()]);
    expect(f.context.getJobSyncMobileSession).toHaveBeenCalledWith("company-fixture");
    expect(f.context.getJobSyncCompanyJobDetail).toHaveBeenCalledWith("company-fixture", 12, 9);
    expect(f.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledTimes(1);
    expect(f.context.getJobSyncMobileSession).toHaveBeenCalledTimes(1);
    expect(f.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledWith("company-fixture", 12, { method: "email", resend: false });
    expect(f.context.setCompanyInvoiceStatus).toHaveBeenCalledWith("provider_accepted"); expect(f.context.fetch).not.toHaveBeenCalled();
  });
  it.each(["user", "role", "token", "company", "job", "sheet", "close/reopen", "blur", "unmount"])("retained Send after %s starts no signed read or POST", async (change) => {
    const f = invoiceContext(); const send = invoice(f); invoiceInvalidate(f, change); await send();
    expect(f.context.getJobSyncMobileSession).not.toHaveBeenCalled(); expect(f.context.sendJobSyncCompanyJobInvoice).not.toHaveBeenCalled(); expect(f.context.fetch).not.toHaveBeenCalled();
  });
  it.each(["user", "role", "company", "job", "sheet", "close/reopen", "blur", "unmount"])("scope %s during signed refresh prevents Company POST", async (change) => {
    const f = invoiceContext(); const wait = deferred<any>(); f.context.getJobSyncMobileSession.mockReturnValue(wait.promise);
    const pending = invoice(f)(); await flush(); invoiceInvalidate(f, change); wait.resolve(f.context.jobSyncSession); await pending;
    expect(f.context.getJobSyncCompanyJobDetail).not.toHaveBeenCalled(); expect(f.context.sendJobSyncCompanyJobInvoice).not.toHaveBeenCalled(); expect(f.context.fetch).not.toHaveBeenCalled();
  });
  it.each(["technician", "dispatcher", "other-user", "other-company"])("live changed %s rejects cached owner permission without POST/fallback", async (change) => {
    const f = invoiceContext(); const current = f.context.jobSyncSession;
    f.context.getJobSyncMobileSession.mockResolvedValue({ ...current, company: { id: change === "other-company" ? 99 : 9 }, user: { ...current.user, id: change === "other-user" ? 43 : 42, role: ["technician", "dispatcher"].includes(change) ? change : "owner" } });
    await invoice(f)(); expect(f.context.sendJobSyncCompanyJobInvoice).not.toHaveBeenCalled(); expect(f.context.fetch).not.toHaveBeenCalled(); expect(f.context.Alert.alert).toHaveBeenCalledTimes(1);
  });
  it("same signed dispatcher with fieldwork OFF may send management invoice", async () => {
    const f = invoiceContext(); f.context.jobSyncSession.user.role = "dispatcher"; await invoice(f)(); expect(f.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledTimes(1);
  });
  it("mismatched canonical detail prevents invoice", async () => {
    const f = invoiceContext(); f.context.getJobSyncCompanyJobDetail.mockResolvedValue({ id: 13, companyId: 9 }); await invoice(f)(); expect(f.context.sendJobSyncCompanyJobInvoice).not.toHaveBeenCalled();
  });
  it("already sent valid POST result cannot update a closed/reopened sheet", async () => {
    const f = invoiceContext(); const wait = deferred<any>(); f.context.sendJobSyncCompanyJobInvoice.mockReturnValue(wait.promise);
    const pending = invoice(f)(); await flush(); expect(f.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledTimes(1); invoiceInvalidate(f, "close/reopen");
    wait.resolve({ status: "sent", communicationState: "provider_accepted", publicUrl: "fixture" }); await pending;
    expect(f.context.setCompanyInvoiceStatus).not.toHaveBeenCalled(); expect(f.context.setInvoiceSentUrl).not.toHaveBeenCalledWith("fixture");
  });
  it.each(["timeout", "HTTP 403", "invalid acknowledgment"])("%s sends once and never falls back or auto retries", async (reason) => {
    const f = invoiceContext(); f.context.sendJobSyncCompanyJobInvoice.mockRejectedValue(new Error(reason)); await invoice(f)();
    expect(f.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledTimes(1); expect(f.context.fetch).not.toHaveBeenCalled(); expect(f.context.Alert.alert).toHaveBeenCalledTimes(1);
  });
});

describe("Admin actual legacy history, cache, gesture and dormant checkout continuations", () => {
  it("Company legacy history refuses transport even with copied contacts", async () => {
    const f = addressContext(); f.scope.companyMode = true; f.context.fetch = vi.fn(); f.context.setCustomerHistory = vi.fn(); f.context.APP_API_BASE = "https://fixture.invalid";
    await named("adminLoadCustomerHistory", f.context)(job()); expect(f.context.fetch).not.toHaveBeenCalled();
  });
  it("sent legacy history discards late response on identity change", async () => {
    const f = addressContext(); const wait = deferred<any>(); f.context.fetch = vi.fn().mockReturnValue(wait.promise); f.context.setCustomerHistory = vi.fn(); f.context.APP_API_BASE = "https://fixture.invalid";
    const pending = named("adminLoadCustomerHistory", f.context)(job()); await flush(); expect(f.context.fetch).toHaveBeenCalledTimes(1); invalidate(f, "company");
    wait.resolve({ json: vi.fn().mockResolvedValue({ result: { data: [] } }) }); await pending; expect(f.context.setCustomerHistory).not.toHaveBeenCalled();
  });
  it("late legacy cache hydration cannot populate a Company workspace", async () => {
    const f = legacy(); const wait = deferred<any>();
    const context = { ...f.context, renderedLegacyReadAction: f.guard, companyJobMode: false, STORAGE_KEY_BASE: "fixture", setJobs: vi.fn(), AsyncStorage: { getItem: vi.fn().mockReturnValue(wait.promise), removeItem: vi.fn().mockResolvedValue(undefined) } };
    const cleanup = effect("AsyncStorage.getItem(key)", context)(); await flush(); expect(context.AsyncStorage.getItem).toHaveBeenCalledTimes(1);
    invalidate(f, "company"); wait.resolve(JSON.stringify([job()])); await flush(); cleanup(); expect(context.setJobs).not.toHaveBeenCalled();
  });
  it("Company cache effect clears but never reads legacy storage", () => {
    const f = legacy(); const context = { ...f.context, companyJobMode: true, setJobs: vi.fn(), AsyncStorage: { getItem: vi.fn() } };
    effect("AsyncStorage.getItem(key)", context)(); expect(context.setJobs).toHaveBeenCalledWith([]); expect(context.AsyncStorage.getItem).not.toHaveBeenCalled();
  });
  it.each(["handleMoveAdminJob", "handleResizeAdminJob"])("queued legacy %s after Company/blur scope makes no local/status/cache write", async (name) => {
    const f = legacy(); const context = { ...f.context, renderedLegacyAction: f.guard, jobs: [job()], calendarGestureLockRef: { current: false }, isJobSyncCompany: false, setJobs: vi.fn(), jobUpsertMutation: { mutate: vi.fn() }, jobReassignMutation: { mutate: vi.fn() }, AsyncStorage: { setItem: vi.fn() } };
    const cb = named(name, context); invalidate(f, "company"); await cb("12", 9);
    expect(context.setJobs).not.toHaveBeenCalled(); expect(context.jobUpsertMutation.mutate).not.toHaveBeenCalled(); expect(context.jobReassignMutation.mutate).not.toHaveBeenCalled(); expect(context.AsyncStorage.setItem).not.toHaveBeenCalled();
  });
  it.each(["company", "sheet", "blur", "unmount"])("dormant parent checkout completion after %s cannot mutate status/payment/local/performance", async (change) => {
    const f = legacy(); const context: Record<string, any> = { ...f.context, renderedLegacyAction: f.guard, showCheckout: true, checkoutEpochRef: { current: 2 }, renderedCheckoutEpoch: 2,
      paymentActionRef: { current: null }, selectedJob: job(), setJobs: vi.fn(), setSelectedJob: vi.fn(), setShowCheckout: vi.fn(),
      jobStatusMutation: { mutate: vi.fn() }, jobSavePaymentMutation: { mutate: vi.fn() }, utils: { performance: { getDateRange: { invalidate: vi.fn() } } },
    };
    const complete = jsxCallback("const completedJob = selectedJob", context, "onComplete"); invalidate(f, change); await complete({ total: 123 });
    expect(context.setJobs).not.toHaveBeenCalled(); expect(context.setSelectedJob).not.toHaveBeenCalled(); expect(context.jobStatusMutation.mutate).not.toHaveBeenCalled(); expect(context.jobSavePaymentMutation.mutate).not.toHaveBeenCalled(); expect(context.utils.performance.getDateRange.invalidate).not.toHaveBeenCalled();
  });
});

describe("Admin actual legacy list and Company highlight effects", () => {
  it("late legacy list response cannot write current jobs/storage after entering Company", async () => {
    const f = legacy(); const wait = deferred<any>();
    const context: Record<string, any> = { ...f.context, renderedLegacyReadAction: f.guard, jobSyncLoading: false, isJobSyncCompany: false,
      companyJobMode: false, STORAGE_KEY: "fixture-cache", selectedCity: "fixture-city", setIsSyncing: vi.fn(), setJobs: vi.fn(),
      localDateStr: (date: Date) => date.toISOString().slice(0, 10), utils: { jobs: { listByLocation: { fetch: vi.fn().mockReturnValue(wait.promise) } } },
      AsyncStorage: { setItem: vi.fn() },
    };
    const cleanup = effect("const syncServerJobs = async", context)(); await flush();
    expect(context.utils.jobs.listByLocation.fetch).toHaveBeenCalledTimes(1); invalidate(f, "company"); wait.resolve([job()]); await flush(); cleanup();
    expect(context.setJobs).not.toHaveBeenCalled(); expect(context.AsyncStorage.setItem).not.toHaveBeenCalled();
  });
  it.each(["12", "booking-fixture", "012", "ob_12"])("Company highlight %s cannot use numeric collision/booking ref/legacy fallback", (id) => {
    const context: Record<string, any> = { highlightBookingId: id, highlightHandledRef: { current: null }, isFocused: true, companyJobMode: true, isJobSyncCompany: true,
      jobSyncSession: { token: "fixture", company: { id: 9 }, user: { id: 42, role: "owner" } }, jobs: [job({ bookingId: id })],
      canonicalCalendarScopeRef: { current: "current" }, canonicalCalendarKey: "current", positiveJobSyncId: (value: any) => /^\d+$/.test(value) ? Number(value) : null,
      setHighlightUnavailable: vi.fn(), fetch: vi.fn(),
    };
    effect("const highlightKey", context)(); expect(context.setHighlightUnavailable).toHaveBeenCalledWith(true); expect(context.fetch).not.toHaveBeenCalled();
  });
  it("Company highlight resolves only current canonical calendar Job", () => {
    const context: Record<string, any> = { highlightBookingId: "12", highlightHandledRef: { current: null }, isFocused: true, companyJobMode: true, isJobSyncCompany: true,
      jobSyncSession: { token: "fixture", company: { id: 9 }, user: { id: 42, role: "owner" } }, jobs: [job({ companyId: 9 })],
      canonicalCalendarScopeRef: { current: "current" }, canonicalCalendarKey: "current", positiveJobSyncId: (value: any) => Number(value),
      setHighlightUnavailable: vi.fn(), selectedCity: "fixture-city", setSelectedCity: vi.fn(), setWeekOffset: vi.fn(), setSelectedDay: vi.fn(),
      setSelectedJob: vi.fn(), setAdminEditingTime: vi.fn(), setAdminEditingPackage: vi.fn(), setAdminEditingDiscount: vi.fn(),
      setAdminEditingTax: vi.fn(), setAdminEditingDeposit: vi.fn(), setShowCustomerHistory: vi.fn(), fetch: vi.fn(),
    };
    effect("const highlightKey", context)(); expect(context.setSelectedJob).toHaveBeenCalledWith(context.jobs[0]); expect(context.fetch).not.toHaveBeenCalled();
  });
});

describe("Admin actual copied billing confirmation callbacks", () => {
  it("old charge modal confirmation after close/reopen cannot charge", async () => {
    const f = legacy(); const context: Record<string, any> = { ...f.context, renderedLegacyAction: f.guard, chargeEpochRef: { current: 2 }, renderedChargeEpoch: 2, showChargeModal: true,
      chargeLockRef: { current: false }, chargeActionRef: { current: null }, scheduleSavedCards: [{ stripePaymentMethodId: "fixture-card", stripeCustomerId: "fixture-customer" }],
      selectedChargeCardId: "fixture-card", chargeAmount: "50", selectedJob: job(), Alert: { alert: vi.fn() }, setChargingCard: vi.fn(), scheduleChargeCardMutation: { mutate: vi.fn() },
    };
    context.isCurrentCharge = named("isCurrentCharge", context);
    context.isCurrentCharge.verify = async () => context.isCurrentCharge() && await f.guard.verify();
    const open = jsxCallback("Confirm Charge", context); open(); const confirm = context.Alert.alert.mock.calls[0][2][1].onPress;
    context.chargeEpochRef.current += 2; await confirm(); expect(context.scheduleChargeCardMutation.mutate).not.toHaveBeenCalled(); expect(context.setChargingCard).not.toHaveBeenCalled();
  });
  it("duplicate real charge Alert callbacks dispatch exactly one legacy mutation", async () => {
    const f = legacy(); const context: Record<string, any> = { ...f.context, renderedLegacyAction: f.guard, chargeEpochRef: { current: 2 }, renderedChargeEpoch: 2, showChargeModal: true,
      chargeLockRef: { current: false }, chargeActionRef: { current: null }, scheduleSavedCards: [{ stripePaymentMethodId: "fixture-card", stripeCustomerId: "fixture-customer" }],
      selectedChargeCardId: "fixture-card", chargeAmount: "50", selectedJob: job(), Alert: { alert: vi.fn() }, setChargingCard: vi.fn(), scheduleChargeCardMutation: { mutate: vi.fn() },
    };
    context.isCurrentCharge = named("isCurrentCharge", context); context.isCurrentCharge.verify = async () => context.isCurrentCharge() && await f.guard.verify();
    jsxCallback("Confirm Charge", context)(); const confirm = context.Alert.alert.mock.calls[0][2][1].onPress;
    await Promise.all([confirm(), confirm()]); expect(context.scheduleChargeCardMutation.mutate).toHaveBeenCalledTimes(1);
  });
  it("retained Company refund callback cannot dispatch or change payment UI", async () => {
    const f = legacy(); f.scope.companyMode = true;
    const context: Record<string, any> = { ...f.context, renderedLegacyAction: f.guard, refundEpochRef: { current: 2 }, renderedRefundEpoch: 2, showRefundModal: true,
      refundLockRef: { current: false }, selectedJob: job({ payment: { paymentIntentId: "fixture", total: 300 } }), refundMutation: { mutateAsync: vi.fn() }, setRefundLoading: vi.fn(),
    };
    context.isCurrentRefund = named("isCurrentRefund", context); context.isCurrentRefund.verify = async () => context.isCurrentRefund() && await f.guard.verify();
    await jsxCallback("const maxCents", context)(); expect(context.refundMutation.mutateAsync).not.toHaveBeenCalled(); expect(context.setRefundLoading).not.toHaveBeenCalled();
  });
});

describe("Admin nine actual preserved destructive confirmation callbacks", () => {
  const start = source.indexOf('Alert.alert("Company management Cancel"');
  const end = source.indexOf('                {!showReassignPicker', start);
  const confirmations = all.filter((node): node is ts.ArrowFunction => ts.isArrowFunction(node) && node.getStart(tree) > start && node.end < end && /^\{\s*if \(!isCurrentAction\(\)\) return;/.test(node.body.getText(tree)));
  it("fixture resolves exactly nine original confirmation bodies", () => { expect(confirmations).toHaveLength(9); });
  it.each(Array.from({ length: 9 }, (_, index) => index))("confirmation %s synchronously allows one write and rejects stale local results", async (index) => {
    const f = legacy(); const wait = deferred<any>(); const mutate = vi.fn().mockReturnValue(wait.promise);
    const context: Record<string, any> = { ...f.context, isCurrentAction: f.guard, legacyManagementWriteLockRef: { current: false },
      selectedJob: job({ recurrenceParentId: "fixture-series" }), jobCancelMutation: { mutateAsync: mutate }, jobStatusMutation: { mutateAsync: mutate },
      jobDeleteMutation: { mutateAsync: mutate }, jobDeleteRecurringMutation: { mutateAsync: mutate }, jobCancelRecurringMutation: { mutateAsync: mutate },
      getJobDate: () => "2026-11-15", setJobs: vi.fn(), setSelectedJob: vi.fn(), forceSync: vi.fn(), Alert: { alert: vi.fn() },
      Haptics: { notificationAsync: vi.fn(), NotificationFeedbackType: { Success: "success" } },
    };
    const confirmation = callable(confirmations[index], context); const one = confirmation(); const two = confirmation(); await flush();
    expect(mutate).toHaveBeenCalledTimes(1); invalidate(f, "company"); wait.resolve({ success: true }); await Promise.all([one, two]);
    expect(context.setJobs).not.toHaveBeenCalled(); expect(context.setSelectedJob).not.toHaveBeenCalled(); expect(context.forceSync).not.toHaveBeenCalled();
    expect(context.legacyManagementWriteLockRef.current).toBe(false);
  });
});

describe("Admin wiring assertions (source checks, not mounting evidence)", () => {
  it("retains all nine legacy destructive pre/post guards and management cancellation", () => {
    const block = source.slice(source.indexOf('Alert.alert("Company management Cancel"'), source.indexOf('                {!showReassignPicker', source.indexOf('Alert.alert("Company management Cancel"')));
    expect(block.match(/onPress: async \(\) => \{\s*if \(!isCurrentAction\(\)\) return;/g)).toHaveLength(9);
    expect(block.match(/if \(!isCurrentAction\(\)\) return;/g)).toHaveLength(19);
    expect(block).toContain("void companyJob.cancelManagement()");
  });
  it("Company highlights require exact current canonical Job, never booking-reference conversion", () => {
    const highlight = source.slice(source.indexOf('const highlightHandledRef'), source.indexOf('const persistJobs'));
    expect(highlight).toContain('String(canonicalId) === highlightBookingId'); expect(highlight).toContain('j.companyId === jobSyncSession?.company?.id');
    expect(highlight.indexOf('if (companyJobMode) { setHighlightUnavailable(true); return; }')).toBeLessThan(highlight.indexOf('/api/booking/job/'));
  });
  it("Company copied billing queries, card/refund/receipt controls isolated; disabled checkout preserved", () => {
    expect(source).toContain('enabled: legacyBillingAllowed && !!scheduleCustomerKey && showChargeModal');
    expect(source).toContain('enabled: legacyBillingAllowed && !!selectedJob?.id && !!selectedJob?.payment?.paymentIntentId');
    expect(source).toContain('!companyJobMode && !selectedJob?.payment'); expect(source).toContain('<AdminCheckoutModal');
    const modal = readFileSync(new URL('../components/admin-checkout-modal.tsx', import.meta.url), 'utf8');
    expect(modal).toContain('Payments are disabled'); expect(modal).not.toContain('onComplete(');
  });
  it.each([{ balance: 0, paymentStatus: 'paid', collect: false, paid: true }, { balance: 45, paymentStatus: 'partial', collect: true, paid: false }, { balance: 300, paymentStatus: 'unpaid', collect: true, paid: false }, { balance: undefined, paymentStatus: undefined, collect: false, paid: null }])('actual shared billing state drives Company preview/collection: %j', ({ collect, paid, ...input }) => {
    const state = getCompanyJobBillingState(input); expect(state.canCollect).toBe(collect); expect(state.isPaid).toBe(paid);
    expect(source).toContain('companyJobMode ? companyBilling.canCollect : !selectedJob.payment'); expect(source).toContain('companyBilling.balance === null ? "UNKNOWN"');
  });
  it("Company acknowledgment uses communication state and never claims delivered", () => {
    expect(source).toContain('typeof data.communicationState === "string" ? data.communicationState');
    expect(source).toContain('Invoice submitted — provider accepted'); expect(source).toContain('customer delivery is not confirmed');
  });
});
