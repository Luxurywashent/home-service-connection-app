import React, { act, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, type PhotoTestNode } from "./helpers/company-photo-test-dom";
import { useCompanyJobOperation, useCompanyJobOperationEpoch } from "../hooks/use-company-job-operation";
import { useCompanyJob } from "../hooks/use-company-job";
import { CompanyJobAddressEditor } from "../components/company-job-address-editor";
import { CompanyJobInvoiceRecipient } from "../components/company-job-invoice-recipient";
import { COMPANY_JOB_ADDRESS_CONTRACT, companyJobAddressScope, companyJobAddressWriteBlocked } from "../lib/company-job-address";
import { companyJobDisplayFields } from "../lib/company-job-fieldwork";
import { assertCompanyJobInvoiceJob, assertCompanyJobInvoiceSession, captureCompanyJobInvoiceIntent, createCompanyJobInvoiceOptions } from "../lib/company-job-invoice-intent";
import { COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY, createCompanyJobInvoiceAttemptGuard, validateCompanyJobInvoiceRecipientReceipt } from "../lib/company-job-invoice-recipient";
import { getCompanyJobBillingState, positiveJobSyncId, updateJobSyncCompanyJobAddress, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";
import { AppState, Switch, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";

const mocks = vi.hoisted(() => ({ focused: true, state: "active", listeners: new Set<(state: string) => void>(), session: vi.fn(), detail: vi.fn(), list: vi.fn(), invoice: vi.fn(), legacy: vi.fn(), alert: vi.fn(), writer: null as null | ((...args: unknown[]) => unknown) }));
vi.mock("../lib/jobsync-mobile-api", async () => {
  // Do not importActual while the address/API cycle initializes: its apiDefaults
  // would bind the unmocked reads. Execute untouched primitive declarations now,
  // and lazily import the actual bearer writer only AFTER policy modules exist.
  const fs = await import("node:fs"), T = await import("typescript");
  const text = fs.readFileSync("/home/ubuntu/home-service-connection-app/lib/jobsync-mobile-api.ts", "utf8");
  const ast = T.createSourceFile("api.ts", text, T.ScriptTarget.Latest, true);
  const names = ["positiveJobSyncId", "JobSyncApiError"];
  const code = ast.statements.filter((node) => (T.isFunctionDeclaration(node) || T.isClassDeclaration(node)) && node.name && names.includes(node.name.text)).map((node) => node.getText(ast)).join("\n");
  const output = T.transpileModule(code, { compilerOptions: { target: T.ScriptTarget.ES2022, module: T.ModuleKind.CommonJS } }).outputText;
  const primitives = new Function("exports", `${output}; return {positiveJobSyncId, JobSyncApiError};`)({});
  return { ...primitives, getCompanyJobBillingState: (await import("../lib/company-job-billing")).getCompanyJobBillingState,
    getJobSyncMobileSession: mocks.session, getJobSyncCompanyJobDetail: mocks.detail, getJobSyncCompanyJobs: mocks.list, sendJobSyncCompanyJobInvoice: mocks.invoice,
    updateJobSyncCompanyJobAddress: (...args: unknown[]) => { if (!mocks.writer) throw new Error("Actual writer not bound before fixture commit"); return mocks.writer(...args); },
    updateJobSyncCompanyJobStatus: mocks.legacy, cancelJobSyncCompanyJob: mocks.legacy };
});
vi.mock("expo-router", async () => {
  const R = await import("react");
  return { useIsFocused: () => mocks.focused, useFocusEffect: (callback: () => void | (() => void)) => R.useEffect(() => mocks.focused ? callback() : undefined, [callback, mocks.focused]) };
});
vi.mock("@/hooks/use-job-sheet-colors", () => ({ useJobSheetColors: () => ({ background: "#111", surface: "#222", foreground: "#fff", muted: "#aaa", border: "#333", primary: "#08f", error: "#f00", warning: "#fa0" }) }));
type NativeNode = PhotoTestNode & { nativeProps?: Record<string, any> };
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => R.createElement(name, { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; } }, props.children);
  return { View: host("native-view"), Text: host("native-text"), TouchableOpacity: host("native-touch"), TextInput: host("native-input"), Switch: host("native-switch"), ActivityIndicator: host("native-activity"), StyleSheet: { create: (styles: unknown) => styles }, AppState: { get currentState() { return mocks.state; }, addEventListener: (_name: string, callback: (state: string) => void) => { mocks.listeners.add(callback); return { remove: () => mocks.listeners.delete(callback) }; } } };
});

// These are ACTUAL installed nodes. No replacement, insertion into source, candidate
// patch, or production module startup. External screen inputs/RN/I/O are isolated.
const rootPath = path.resolve(import.meta.dirname, "..");
const file = path.join(rootPath, "app/(tabs)/admin-schedule.tsx");
const source = readFileSync(file, "utf8");
const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const main = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "AdminScheduleScreen")!;
const statements = main.body!.statements;
function declaration(name: string) {
  const found = statements.filter((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => ts.isIdentifier(item.name) ? item.name.text === name : item.name.elements.some((element) => ts.isBindingElement(element) && ts.isIdentifier(element.name) && element.name.text === name)));
  if (found.length !== 1) throw new Error(`Expected one installed declaration: ${name}`);
  return found[0].getText(tree);
}
function range(start: string, end: string) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing installed boundary ${start}/${end}`);
  return statements.filter((node) => node.getStart(tree) >= from && node.end <= to).map((node) => node.getText(tree)).join("\n");
}
function findNodes(predicate: (node: ts.Node) => boolean) {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); };
  visit(main); return result;
}
function jsx(starts: string) {
  const found = findNodes((node) => ts.isJsxExpression(node) && Boolean(node.expression?.getText(tree).startsWith(starts)));
  if (found.length !== 1) throw new Error(`Expected one installed JSX boundary: ${starts} (${found.length})`);
  return found[0].getText(tree);
}
const openAttribute = findNodes((node) => ts.isJsxAttribute(node) && node.name.getText(tree) === "onPress" && Boolean(node.initializer?.getText(tree).includes("const remainingOnly = companyJobMode")))[0] as ts.JsxAttribute;
if (!openAttribute) throw new Error("Missing installed invoice opening button");
const openButton = openAttribute.parent.parent.parent.getText(tree);
const addressJSX = jsx("companyJobMode && <CompanyJobAddressEditor");
const invoiceJSX = jsx("showInvoiceSheet && selectedJob &&");
const productionNames = ["legacyToken", "legacyTokenReady", "hasJobSyncEmployee", "sheetEpochRef", "invoiceEpochRef", "checkoutEpochRef", "selectedJob", "companyJobOperationEpoch", "invalidateCompanyJobOperation", "setSelectedJob", "jobs", "showInvoiceSheet", "setShowInvoiceSheet", "invoiceMethod", "invoiceResend", "invoiceSending", "invoiceSentUrl", "companyInvoiceStatus", "companyInvoiceRecipientEmail", "companyInvoiceAcknowledgedRecipient", "companyInvoiceAttemptGuardRef", "invoiceRemainingOnly", "invoiceOverrideContact", "companyJobMode"];
const program = `function InstalledScreen(props) {
  const { currentEmployee, employeeLoading, jobSyncSession, jobSyncLoading, isFocused } = props;
  const isJobSyncCompany = jobSyncSession?.portal === 'company';
  ${productionNames.map(declaration).join("\n")}
  ${range("const managementActionKey =", "const captureLegacyJobAction =")}
  ${declaration("companyPhotoJobId")}
  ${declaration("companyJob")}
  ${range("// HSC_COMPANY_ADDRESS_PUBLICATION_START", "// HSC_COMPANY_ADDRESS_PUBLICATION_END")}
  ${range("const invoiceIdentityKey =", "const isCurrentCompanyPrivateNotes =")}
  ${range("const isCurrentInvoice =", "const canonicalCalendarKey =")}
  renderProbe(companyJobOperationScope, selectedJob, companyJob);
  useImperativeHandle(props.testRef, () => ({ setSelectedJob, setJobs,
    selectedJob, jobs, companyJob, current: isCurrentCompanyJobOperation,
    debug: { management: managementActionRef.current, sheet: sheetEpochRef.current, renderedSheetEpoch, invoice: invoiceSessionRef.current, invoiceIdentityKey },
    verified: onCompanyAddressVerified, saved: onCompanyAddressSaved,
    open: ${((openAttribute.initializer as ts.JsxExpression).expression!).getText(tree)},
    close: () => setShowInvoiceSheet(false), invoice: { showInvoiceSheet, invoiceMethod, invoiceResend, companyInvoiceRecipientEmail, invoiceSentUrl, companyInvoiceStatus } }));
  return <>{selectedJob && <>${addressJSX}${openButton}${invoiceJSX}</>}</>;
}`;
const compiled = ts.transpileModule(program, { fileName: "installed-screen.tsx", reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } });
if (compiled.diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error)) throw new Error(ts.formatDiagnosticsWithColorAndContext(compiled.diagnostics, { getCanonicalFileName: (name) => name, getCurrentDirectory: () => rootPath, getNewLine: () => "\n" }));
let renderCount = 0;
const environment = {
  renderProbe: (scope: string, selected: unknown, job: Record<string, unknown>) => { if (++renderCount > 100) throw new Error(`Bounded render loop: ${scope}; selected=${JSON.stringify(selected)}; loading=${job.loading}`); },
  React, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, useFocusEffect,
  useCompanyJobOperation, useCompanyJobOperationEpoch, useCompanyJob, CompanyJobAddressEditor, CompanyJobInvoiceRecipient,
  COMPANY_JOB_ADDRESS_CONTRACT, companyJobAddressScope, companyJobDisplayFields, positiveJobSyncId, updateJobSyncCompanyJobAddress,
  captureCompanyJobInvoiceIntent, createCompanyJobInvoiceOptions, assertCompanyJobInvoiceSession, assertCompanyJobInvoiceJob,
  COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY, createCompanyJobInvoiceAttemptGuard, validateCompanyJobInvoiceRecipientReceipt,
  getJobSyncCompanyJobs: mocks.list, getJobSyncMobileSession: mocks.session, getJobSyncCompanyJobDetail: mocks.detail, sendJobSyncCompanyJobInvoice: mocks.invoice,
  getCompanyJobBillingState, AppState, Switch, Text, TouchableOpacity, View, Platform: { OS: "web" },
  Alert: { alert: mocks.alert }, LegacyAuth: { getSessionToken: mocks.legacy }, renderedLegacyAction: mocks.legacy,
  detailInputFocus: vi.fn(), detailInputBlur: vi.fn(),
  jobSheetColors: { background: "#111", surface: "#222", foreground: "#fff", muted: "#aaa", border: "#333", primary: "#08f" },
  getWeekDates: () => Array.from({ length: 7 }, () => new Date("2026-12-01T12:00:00Z")), localDateStr: () => "2026-12-01",
};
const InstalledScreen = new Function(...Object.keys(environment), `${compiled.outputText}\nreturn InstalledScreen;`)(...Object.values(environment)) as React.ComponentType<Props>;
type Row = Record<string, any>;
type ScreenAPI = { setSelectedJob: React.Dispatch<React.SetStateAction<Row | null>>; setJobs: React.Dispatch<React.SetStateAction<Row[]>>; selectedJob: Row | null; jobs: Row[]; companyJob: Row; current: () => boolean; debug: Row; verified: (detail: Row, current: () => boolean) => Promise<boolean>; saved: (detail: Row) => void; open: () => void; close: () => void; invoice: Row };
type Props = { testRef: React.RefObject<ScreenAPI | null>; currentEmployee: { employeeId: string; role: string; sessionSource: string }; employeeLoading: boolean; jobSyncSession: JobSyncNativeSession; jobSyncLoading: boolean; isFocused: boolean };
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as { createRoot: (node: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
let root: ReturnType<typeof createRoot>, container: PhotoTestNode, props: Props, canonical: Row, baseline: Row, events: string[], http: ReturnType<typeof vi.fn>;
let sequence = 390000;
const api = () => { if (!props.testRef.current) throw new Error("No committed screen API"); return props.testRef.current; };
async function invoke(callback: () => unknown) { await act(async () => { await callback(); for (let i = 0; i < 24; i++) await Promise.resolve(); }); }
async function render(patch: Partial<Props> = {}) { props = { ...props, ...patch }; mocks.focused = props.isFocused; await invoke(() => root.render(<InstalledScreen {...props} />)); }
function nativeNodes() { const visit = (node: PhotoTestNode): NativeNode[] => [node as NativeNode, ...node.childNodes.flatMap(visit)]; return visit(container); }
function find(label: string) { return nativeNodes().find((node) => node.nativeProps?.accessibilityLabel === label)?.nativeProps; }
function button(text: string) { return nativeNodes().find((node) => node.nodeName.toLowerCase() === "native-touch" && node.textContent === text)?.nativeProps; }
async function press(label: string) { const node = find(label); expect(node, `Installed control ${label} must be reachable`).toBeDefined(); await invoke(() => node!.onPress()); }
async function openAddress() { await press("Edit Job address"); await invoke(() => find("Street address")!.onChangeText("  22 New Street  ")); }
async function openInvoice() { await invoke(() => api().open()); expect(api().invoice.showInvoiceSheet, JSON.stringify(api().debug)).toBe(true); }
async function send() { const node = button("Send Invoice via Email") ?? button("Request Invoice Resend via Email"); expect(node).toBeDefined(); await invoke(() => node!.onPress()); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
async function background() { await invoke(() => { mocks.state = "background"; mocks.listeners.forEach((listener) => listener("background")); }); await invoke(() => { mocks.state = "active"; mocks.listeners.forEach((listener) => listener("active")); }); }
async function invalidate(kind: string) {
  if (kind === "focus") await render({ isFocused: false });
  else if (kind === "session") await render({ jobSyncSession: { ...props.jobSyncSession, token: "rotated-offline" } });
  else if (kind === "role") await render({ jobSyncSession: { ...props.jobSyncSession, user: { ...props.jobSyncSession.user, role: "technician" } } });
  else if (kind === "Job") await invoke(() => api().setSelectedJob({ ...baseline, id: String(canonical.id + 1) }));
  else if (kind === "sheet") await invoke(() => { api().setSelectedJob(null); api().setSelectedJob({ ...baseline }); });
  else if (kind === "background") await background();
  else if (kind === "version") { canonical = { ...canonical, updatedAt: "2026-11-17T18:09:00.000Z" }; }
  else if (kind === "loading") await render({ jobSyncLoading: true });
}
beforeEach(async () => {
  renderCount = 0; mocks.focused = true; mocks.state = "active"; mocks.listeners.clear(); events = [];
  [mocks.session, mocks.detail, mocks.list, mocks.invoice, mocks.legacy, mocks.alert].forEach((mock) => mock.mockReset());
  mocks.writer = (await vi.importActual<Record<string, (...args: unknown[]) => unknown>>("../lib/jobsync-mobile-api")).updateJobSyncCompanyJobAddress;
  const id = ++sequence;
  const session: JobSyncNativeSession = { portal: "company", token: `offline-screen-${id}`, user: { id: 71, role: "owner", name: "Offline Owner", email: null }, company: { id, name: "Offline Company", slug: "offline", logoUrl: null, primaryColor: null, accentColor: null } };
  canonical = { id, companyId: id, customerId: 12, assignedUserId: 93, updatedAt: "2026-11-17T18:00:00.000Z", scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T16:00:00.000Z", addressLine1: "1 Old Street", city: "Old City", serviceAddress: { addressLine1: "1 Old Street", city: "Old City", region: "FL", postalCode: "32541" }, customerEmail: "canonical@example.test", customerName: "Canonical Customer", serviceName: "Service", title: "Service", status: "scheduled", amount: 125, photos: [], invoiceSentAt: null };
  baseline = { id: String(id), companyId: id, customerId: "12", firstName: "Canonical", lastName: "Customer", address: "1 Old Street", addressCity: "Old City", addressRegion: "FL", addressPostalCode: "32541", email: "legacy-must-not-display@example.test", privateNotes: "Keep notes", tags: ["Keep tag"], photoUrls: ["offline-photo"], startHour: 9, endHour: 10, dayIndex: 1, weekOffset: 2, updatedAt: canonical.updatedAt };
  props = { testRef: React.createRef<ScreenAPI>(), currentEmployee: { employeeId: "jobsync-71", role: "admin", sessionSource: "jobsync" }, employeeLoading: false, jobSyncSession: session, jobSyncLoading: false, isFocused: true };
  mocks.session.mockImplementation(async () => { events.push("session GET"); return structuredClone(session); });
  mocks.detail.mockImplementation(async () => { events.push("detail GET"); return structuredClone(canonical); });
  mocks.list.mockImplementation(async () => { events.push("list GET"); return [structuredClone(canonical)]; });
  mocks.invoice.mockResolvedValue({ success: true, channel: "email", publicUrl: "https://offline.invalid/invoice/opaque", communicationState: "provider_accepted", sentTo: "backend-ack@example.test" });
  mocks.legacy.mockImplementation(() => { throw new Error("Legacy fallback forbidden"); });
  http = vi.fn(async (url: string, init: RequestInit) => {
    if (!url.endsWith(`/api/mobile/v1/company/jobs/${id}/address`) || init.method !== "PATCH") throw new Error(`Unapproved offline I/O ${url}`);
    events.push("address PATCH");
    const input = JSON.parse(String(init.body));
    canonical = { ...canonical, addressLine1: input.addressLine1, city: input.city, serviceAddress: { addressLine1: input.addressLine1, city: input.city, region: input.region, postalCode: input.postalCode }, updatedAt: new Date(Date.parse(canonical.updatedAt) + 1000).toISOString() };
    return { ok: true, status: 200, json: async () => ({ job: { id, customerId: 12, addressLine1: input.addressLine1, city: input.city, updatedAt: canonical.updatedAt }, address: canonical.serviceAddress, updatedAt: canonical.updatedAt }) };
  });
  vi.stubGlobal("fetch", http);
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  await render(); await invoke(() => { api().setSelectedJob({ ...baseline }); api().setJobs([{ ...baseline }, { ...baseline, id: "other" }, { ...baseline, companyId: id + 1 }]); });
  expect(api().companyJob.detail?.serviceAddress).toEqual(canonical.serviceAddress);
  events.length = 0; mocks.session.mockClear(); mocks.detail.mockClear(); mocks.list.mockClear();
});
afterEach(async () => { await invoke(() => root.unmount()); expect(mocks.listeners.size).toBe(0); expect(mocks.legacy).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("installed admin address mount + actual parent callbacks + real committed hooks/editor/writer", () => {
  it("extracts installed AST without syntax errors or proposed-source substitutions", () => {
    expect(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error)).toEqual([]);
    expect(program).toContain("const rows = await getJobSyncCompanyJobs(session.token)");
    expect(program).toContain("await committedCompanyJobRefreshRef.current()");
  });
  it("manager opens supported fields; disabled line 2 is honest; one PATCH then canonical GET/list publishes only matching rows and refreshes the committed hook once", async () => {
    await openAddress();
    expect(find("Address line 2 (unavailable)")!.editable).toBe(false);
    expect(find("Address line 2 (unavailable)")!.onChangeText).toBeUndefined();
    expect(find("State or region")!.value).toBe("FL"); expect(find("Postal code")!.value).toBe("32541");
    await invoke(() => find("City")!.onChangeText(""));
    await press("Save Job address");
    expect(http, `${container.textContent}; sessioncalls=${mocks.session.mock.calls.length}; current=${api().current()}; debug=${JSON.stringify(api().debug)}`).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(http.mock.calls[0][1].body))).toEqual({ addressLine1: "22 New Street", city: null, region: "FL", postalCode: "32541", expectedUpdatedAt: baseline.updatedAt });
    expect(http.mock.calls[0][1]).toMatchObject({ method: "PATCH", headers: { Authorization: `Bearer ${props.jobSyncSession.token}` } });
    expect(events.indexOf("address PATCH")).toBeLessThan(events.indexOf("list GET"));
    const listIndex = events.indexOf("list GET");
    expect(events.slice(listIndex + 1).filter((event) => event === "detail GET")).toHaveLength(1);
    expect(mocks.detail).toHaveBeenCalledTimes(3); // preflight, post-PATCH, new committed scope refresh
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(api().selectedJob).toMatchObject({ address: "22 New Street", addressCity: null, addressRegion: "FL", addressPostalCode: "32541", updatedAt: canonical.updatedAt, privateNotes: "Keep notes", tags: ["Keep tag"], photoUrls: ["offline-photo"] });
    expect(api().jobs[0]).toMatchObject({ address: "22 New Street", updatedAt: canonical.updatedAt });
    expect(api().jobs.slice(1).every((row) => row.address === "1 Old Street")).toBe(true);
    expect(api().companyJob.detail?.updatedAt).toBe(canonical.updatedAt);
    expect(companyJobAddressWriteBlocked(props.jobSyncSession, canonical.id)).toBe(false);
    expect(find("Edit Job address")).toBeDefined();
  });
  it("immediate second same-Job edit uses returned version, not stale hook baseline", async () => {
    await openAddress(); await press("Save Job address");
    const returnedVersion = canonical.updatedAt;
    await press("Edit Job address"); expect(find("Street address")!.value).toBe("22 New Street");
    await invoke(() => find("Street address")!.onChangeText("33 Second Street")); await press("Save Job address");
    expect(http).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(http.mock.calls[1][1].body)).expectedUpdatedAt).toBe(returnedVersion);
    expect(api().selectedJob?.address).toBe("33 Second Street");
  });
  it("repeated address Save locks before fresh session awaits and captures the immutable draft", async () => {
    await openAddress(); const gate = deferred<JobSyncNativeSession>(); mocks.session.mockReturnValueOnce(gate.promise);
    const save = find("Save Job address")!.onPress, type = find("Street address")!.onChangeText;
    await invoke(() => { save(); save(); }); await invoke(() => type("Late mutable draft"));
    expect(http).not.toHaveBeenCalled(); await invoke(() => gate.resolve(props.jobSyncSession));
    expect(http).toHaveBeenCalledTimes(1); expect(JSON.parse(String(http.mock.calls[0][1].body)).addressLine1).toBe("22 New Street");
    expect(api().selectedJob?.address).toBe("22 New Street");
  });
  it.each(["owner", "dispatcher"])("actual manager role %s can reach the editor", async (role) => {
    const session = { ...props.jobSyncSession, user: { ...props.jobSyncSession.user, role: role as "owner" | "dispatcher" } };
    mocks.session.mockResolvedValue(session); await render({ jobSyncSession: session });
    expect(find("Edit Job address")).toBeDefined(); await press("Edit Job address"); expect(find("Street address")).toBeDefined();
  });
  it("technician receives no address edit controls and technician screen retains read-only location", async () => {
    await invalidate("role"); expect(find("Edit Job address")).toBeUndefined(); expect(find("Save Job address")).toBeUndefined(); expect(http).not.toHaveBeenCalled();
    const tech = readFileSync(path.join(rootPath, "app/(tabs)/schedule.tsx"), "utf8");
    expect(tech).not.toContain("<CompanyJobAddressEditor"); expect(tech).toContain("<JobLocationMap address={");
  });
  it.each(["session", "role", "Job", "sheet", "focus", "background", "loading"])("retained installed editor callbacks after %s cannot write or mutate a new draft", async (kind) => {
    await openAddress(); const oldSave = find("Save Job address")!.onPress, oldType = find("Street address")!.onChangeText;
    await invalidate(kind); await invoke(() => { oldType("Retained invalid draft"); oldSave(); });
    expect(http).not.toHaveBeenCalled(); expect(api().selectedJob?.address).not.toBe("Retained invalid draft");
  });
  it("cancel/reopen rejects old editor but accepts newly committed field callbacks", async () => {
    await openAddress(); const oldSave = find("Save Job address")!.onPress, oldType = find("Street address")!.onChangeText;
    await press("Cancel address edit"); await press("Edit Job address"); await invoke(() => { oldType("Stale draft"); oldSave(); });
    expect(http).not.toHaveBeenCalled(); expect(find("Street address")!.value).toBe("1 Old Street");
  });
  it("fresh version conflict performs no PATCH or optimistic publication", async () => {
    await openAddress(); await invalidate("version"); await press("Save Job address");
    expect(http).not.toHaveBeenCalled(); expect(api().selectedJob?.address).toBe("1 Old Street"); expect(container.textContent).toContain("changed elsewhere");
  });
  it.each(["token", "company", "actor", "role"])("fresh signed address %s change prevents PATCH", async (kind) => {
    await openAddress(); const fresh = structuredClone(props.jobSyncSession);
    if (kind === "token") fresh.token = "rotated"; if (kind === "company") fresh.company!.id++; if (kind === "actor") fresh.user.id++; if (kind === "role") fresh.user.role = "technician";
    mocks.session.mockResolvedValueOnce(fresh); await press("Save Job address"); expect(http).not.toHaveBeenCalled(); expect(api().selectedJob?.address).toBe("1 Old Street");
  });
  it.each(["session", "Job", "sheet", "focus", "background"])("%s while fresh address session is pending prevents PATCH", async (kind) => {
    await openAddress(); const gate = deferred<JobSyncNativeSession>(); mocks.session.mockReturnValueOnce(gate.promise);
    await press("Save Job address"); await invalidate(kind); await invoke(() => gate.resolve(props.jobSyncSession));
    expect(http).not.toHaveBeenCalled(); expect(api().selectedJob?.address).not.toBe("22 New Street");
  });
  it.each(["customerId", "updatedAt", "addressLine1", "city", "assignedUserId", "scheduledStartAt", "scheduledEndAt"])("canonical list mismatch in %s never publishes, refreshes hook, or blindly retries", async (field) => {
    mocks.list.mockImplementation(async () => { events.push("list GET"); return [{ ...structuredClone(canonical), [field]: field.endsWith("Id") ? 999 : field === "city" ? "Wrong City" : "wrong" }]; });
    await openAddress(); await press("Save Job address"); expect(http).toHaveBeenCalledTimes(1);
    expect(api().selectedJob?.address).toBe("1 Old Street"); expect(mocks.detail).toHaveBeenCalledTimes(2);
    expect(companyJobAddressWriteBlocked(props.jobSyncSession, canonical.id)).toBe(true); expect(find("Edit Job address")).toBeUndefined();
    expect(container.textContent).toContain("could not be confirmed");
  });
  it.each(["session", "Job", "sheet", "focus", "background"])("%s while canonical list verification is pending rejects publication", async (kind) => {
    await openAddress(); const gate = deferred<Row[]>(); mocks.list.mockReturnValueOnce(gate.promise);
    await press("Save Job address"); expect(http).toHaveBeenCalledTimes(1); expect(mocks.list).toHaveBeenCalledTimes(1);
    await invalidate(kind); const before = api().selectedJob; await invoke(() => gate.resolve([structuredClone(canonical)]));
    expect(api().selectedJob).toEqual(before); expect(api().selectedJob?.address).not.toBe("22 New Street"); expect(http).toHaveBeenCalledTimes(1);
  });
  it("list verification is read-only until completed; then publishes and refreshes exactly once", async () => {
    await openAddress(); const gate = deferred<Row[]>(); mocks.list.mockReturnValueOnce(gate.promise);
    await press("Save Job address"); expect(api().selectedJob?.address).toBe("1 Old Street"); expect(api().companyJob.detail?.updatedAt).toBe(baseline.updatedAt);
    expect(mocks.detail).toHaveBeenCalledTimes(2); await invoke(() => gate.resolve([structuredClone(canonical)]));
    expect(api().selectedJob?.address).toBe("22 New Street"); expect(mocks.detail).toHaveBeenCalledTimes(3);
  });
  it("lost PATCH acknowledgment leaves uncertainty and explicit review uses only GET then canonical publication", async () => {
    const original = http.getMockImplementation()!; http.mockImplementationOnce(async (...args: any[]) => { await original(...args); throw new Error("Offline response lost after commit"); });
    await openAddress(); await press("Save Job address"); expect(http).toHaveBeenCalledTimes(1); expect(api().selectedJob?.address).toBe("1 Old Street");
    await press("Refresh and review Job address"); expect(http).toHaveBeenCalledTimes(1); expect(api().selectedJob?.address).toBe("22 New Street"); expect(find("Edit Job address")).toBeDefined();
  });
});

describe("installed Company invoice sheet controls, immutable send closure and persistent attempt guard", () => {
  it("opens with canonical detail email and empty override; alternate recipient visible but target capability fails closed before signed reads/send", async () => {
    await openInvoice(); expect(find("Invoice recipient email (optional)")!.value).toBe(""); expect(container.textContent).toContain("Email on file: canonical@example.test"); expect(container.textContent).not.toContain("Email on file: legacy-must-not-display");
    await invoke(() => find("Invoice recipient email (optional)")!.onChangeText("alternate@example.test"));
    expect(api().invoice.companyInvoiceRecipientEmail).toBe("alternate@example.test"); await send();
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.invoice).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith("Send Failed", expect.stringContaining("has not passed"));
    await press("Use customer email on file"); expect(find("Invoice recipient email (optional)")!.value).toBe(""); await send();
    expect(mocks.invoice).toHaveBeenCalledWith(props.jobSyncSession.token, canonical.id, { method: "email", resend: false });
    expect(container.textContent).toContain("Backend acknowledged recipient: backend-ack@example.test"); expect(container.textContent).toContain("customer delivery is not confirmed"); expect(container.textContent).not.toContain("Invoice Sent!");
  });
  it("one initial send survives repeated close/open; only explicit resend makes a second send", async () => {
    await openInvoice(); const oldInput = find("Invoice recipient email (optional)")!.onChangeText; await send();
    for (let i = 0; i < 2; i++) { await invoke(() => api().close()); await openInvoice(); await invoke(() => oldInput("stale@example.test")); expect(api().invoice.companyInvoiceRecipientEmail).toBe(""); await send(); }
    expect(mocks.invoice).toHaveBeenCalledTimes(1);
    await invoke(() => find("Explicitly resend Company invoice")!.onValueChange(true)); await send(); expect(mocks.invoice).toHaveBeenCalledTimes(2);
    expect(mocks.invoice).toHaveBeenLastCalledWith(props.jobSyncSession.token, canonical.id, { method: "email", resend: true });
  });
  it.each(["missing-recipient", "wrong-channel", "missing-url", "timeout"])("%s receipt stays uncertain across close/open and explicit resend, with no success projection", async (kind) => {
    const receipt = { success: true, channel: kind === "wrong-channel" ? "sms" : "email", sentTo: kind === "missing-recipient" ? null : "backend@example.test", publicUrl: kind === "missing-url" ? null : "https://offline.invalid/invoice", communicationState: "provider_accepted" };
    if (kind === "timeout") mocks.invoice.mockRejectedValue(new Error("Offline response uncertainty")); else mocks.invoice.mockResolvedValue(receipt);
    await openInvoice(); await send(); expect(api().invoice.invoiceSentUrl).toBeNull(); await invoke(() => api().close()); await openInvoice(); await invoke(() => find("Explicitly resend Company invoice")!.onValueChange(true)); await send();
    expect(mocks.invoice).toHaveBeenCalledTimes(1); expect(http).not.toHaveBeenCalled(); expect(container.textContent).not.toContain("Invoice submitted — provider accepted");
  });
  it("duplicate retained send captures default options before signed reads and locks synchronously", async () => {
    await openInvoice(); const gate = deferred<JobSyncNativeSession>(); mocks.session.mockReturnValueOnce(gate.promise);
    const sendButton = button("Send Invoice via Email")!.onPress, type = find("Invoice recipient email (optional)")!.onChangeText, resend = find("Explicitly resend Company invoice")!.onValueChange;
    let task!: Promise<void>; await invoke(() => { task = sendButton(); }); await invoke(() => { type("late@example.test"); resend(true); void sendButton(); });
    expect(api().invoice.companyInvoiceRecipientEmail).toBe(""); expect(api().invoice.invoiceResend).toBe(false); await invoke(() => gate.resolve(props.jobSyncSession)); await invoke(() => task);
    expect(mocks.invoice).toHaveBeenCalledTimes(1); expect(mocks.invoice).toHaveBeenCalledWith(props.jobSyncSession.token, canonical.id, { method: "email", resend: false });
  });
  it.each(["token", "company", "actor", "role"])("fresh signed %s change prevents send", async (kind) => {
    await openInvoice(); const fresh = structuredClone(props.jobSyncSession);
    if (kind === "token") fresh.token = "rotated"; if (kind === "company") fresh.company!.id++; if (kind === "actor") fresh.user.id++; if (kind === "role") fresh.user.role = "technician";
    mocks.session.mockResolvedValueOnce(fresh); await send(); expect(mocks.invoice).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
  });
  it("already-sent canonical detail requires explicit resend even on first mounted attempt", async () => {
    canonical.invoiceSentAt = "2026-11-17T18:01:00.000Z"; await openInvoice(); await send(); expect(mocks.invoice).not.toHaveBeenCalled();
    await invoke(() => find("Explicitly resend Company invoice")!.onValueChange(true)); await send(); expect(mocks.invoice).toHaveBeenCalledTimes(1);
  });
  it.each(["session", "Job", "sheet", "focus"])("retained send after %s fails closed before any invoice request", async (kind) => {
    await openInvoice(); const oldSend = button("Send Invoice via Email")!.onPress; await invalidate(kind); await invoke(() => oldSend()); expect(mocks.invoice).not.toHaveBeenCalled();
  });
  it("stale dispatched response acknowledges the remembered attempt but cannot populate reopened sheet", async () => {
    await openInvoice(); const gate = deferred<Row>(); mocks.invoice.mockReturnValueOnce(gate.promise); let task!: Promise<void>;
    await invoke(() => { task = button("Send Invoice via Email")!.onPress(); }); expect(mocks.invoice).toHaveBeenCalledTimes(1); await invoke(() => api().close()); await openInvoice();
    await invoke(() => gate.resolve({ success: true, channel: "email", publicUrl: "https://offline.invalid/invoice", communicationState: "provider_accepted", sentTo: "backend@example.test" })); await invoke(() => task);
    expect(api().invoice.invoiceSentUrl).toBeNull(); expect(mocks.invoice).toHaveBeenCalledTimes(1);
    expect(find("Invoice recipient email (optional)")!.editable, "Fresh reopened sheet must not remain permanently busy after old send settles").toBe(true);
  });
  it("background roundtrip must reject retained invoice send, not revive a sheet callback", async () => {
    await openInvoice(); const oldSend = button("Send Invoice via Email")!.onPress; await background(); await invoke(() => oldSend()); expect(mocks.invoice).not.toHaveBeenCalled();
  });
  it("background while signed invoice session waits must prevent subsequent send", async () => {
    await openInvoice(); const gate = deferred<JobSyncNativeSession>(); mocks.session.mockReturnValueOnce(gate.promise); let task!: Promise<void>;
    await invoke(() => { task = button("Send Invoice via Email")!.onPress(); }); await background(); await invoke(() => gate.resolve(props.jobSyncSession)); await invoke(() => task);
    expect(mocks.invoice).not.toHaveBeenCalled();
  });
  it("actual SMS picker uses phone on file and no email override; wrong-channel acknowledgment is uncertain", async () => {
    await openInvoice(); await invoke(() => button("💬Text (SMS)")!.onPress()); expect(find("Invoice recipient email (optional)")).toBeUndefined(); expect(container.textContent).toContain("phone on file");
    mocks.invoice.mockResolvedValue({ success: true, channel: "email", publicUrl: "https://offline.invalid/invoice", sentTo: "backend@example.test", communicationState: "provider_accepted" });
    await invoke(() => button("Send Invoice via Text")!.onPress()); expect(mocks.invoice).toHaveBeenCalledWith(props.jobSyncSession.token, canonical.id, { method: "sms", resend: false }); expect(api().invoice.invoiceSentUrl).toBeNull();
  });
});

describe("supplemental installed AST preservation", () => {
  it("keeps private notes, tags, photos, progress and existing create entrypoints on both screens", () => {
    for (const name of ["admin-schedule", "schedule"]) {
      const text = readFileSync(path.join(rootPath, `app/(tabs)/${name}.tsx`), "utf8");
      for (const mount of ["CompanyJobPrivateNotes", "CompanyJobTags", "CompanyJobPhotos", "CompanyJobPhotoPreview", "CompanyJobProgress", "CompanyCreateJobSheet"]) expect(text).toContain(`<${mount}`);
      expect(text).toContain("customerPrefill={customerPrefill}"); expect(text).toContain("isCurrent={isCurrentCompanyAdd}");
    }
    expect(source).toContain("<CustomerContactActions customerId={selectedJob.customerId}"); expect(source).toContain("<JobLocationMap address={");
    const publications = range("// HSC_COMPANY_ADDRESS_PUBLICATION_START", "// HSC_COMPANY_ADDRESS_PUBLICATION_END");
    expect(publications).not.toContain("updateMeta"); expect(publications).not.toContain("updateJobSyncCompanyJobAddress(");
  });
  it("retains all 132 baseline direct exports and named reexports", () => {
    const expected = JSON.parse(readFileSync("/home/ubuntu/hsc-authoritative-mobile-reconciliation-20261117/api-exports-before.json", "utf8")) as string[];
    const text = readFileSync(path.join(rootPath, "lib/jobsync-mobile-api.ts"), "utf8"), ast = ts.createSourceFile("api.ts", text, ts.ScriptTarget.Latest, true);
    const exported = new Set<string>();
    for (const node of ast.statements) {
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) node.exportClause.elements.forEach((element) => exported.add(element.name.text));
      if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) exported.add(node.name.text);
        if (ts.isVariableStatement(node)) node.declarationList.declarations.forEach((item) => { if (ts.isIdentifier(item.name)) exported.add(item.name.text); });
      }
    }
    expect(expected).toHaveLength(132); expect(expected.filter((name) => !exported.has(name))).toEqual([]);
  });
});
