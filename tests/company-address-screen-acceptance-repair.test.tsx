import React, { act, useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from "react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCompanyJobOperation, useCompanyJobOperationEpoch } from "../hooks/use-company-job-operation";
import { installPhotoTestDOM, type PhotoTestNode } from "./helpers/company-photo-test-dom";

// Execute production AST statements, not the earlier report snippet or a second
// address policy. Real ReactDOM commits run the real operation hooks. Only screen
// inputs, RN primitives/lifecycle, legacy credential storage and updateMeta I/O
// are isolated. Imperative callbacks are published by useImperativeHandle after
// commit, never by render-time assignment to a ref or global.
const screenPath = path.resolve(import.meta.dirname, "../app/(tabs)/admin-schedule.tsx");
const source = readFileSync(screenPath, "utf8");
const tree = ts.createSourceFile(screenPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const screen = tree.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "AdminScheduleScreen");
if (!screen?.body) throw new Error("Missing actual AdminScheduleScreen body");
const statements = screen.body.statements;
function declaration(name: string) {
  const found = statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => {
    if (ts.isIdentifier(item.name)) return item.name.text === name;
    return item.name.elements.some((element) => ts.isBindingElement(element) && ts.isIdentifier(element.name) && element.name.text === name);
  }));
  if (!found) throw new Error(`Missing production declaration: ${name}`);
  return found.getText(tree);
}
function range(start: string, end: string) {
  const from = source.indexOf(start); const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing production extraction boundary: ${start} / ${end}`);
  const nodes = statements.filter((node) => node.getStart(tree) >= from && node.end <= to);
  if (!nodes.length) throw new Error(`Empty production AST extraction: ${start}`);
  return nodes.map((node) => node.getText(tree)).join("\n");
}
const controller = range("// HSC_LEGACY_ADDRESS_CONTROLLER_START", "// HSC_LEGACY_ADDRESS_CONTROLLER_END");
function jsxExpression(match: string) {
  let found: ts.JsxExpression | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxExpression(node) && node.expression?.getText(tree).startsWith(match)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(screen!);
  if (!found) throw new Error(`Missing actual JSX expression: ${match}`);
  return found;
}
const pencil = jsxExpression("!companyJobMode && isCurrentLegacyAddressEntry()");
const unavailable = jsxExpression("companyJobMode && <Text");
const modal = jsxExpression("showEditAddressModal && selectedJob && !companyJobMode && isCurrentLegacyAddressEditor()");
let inputChange: ts.Expression | undefined;
function findInput(node: ts.Node) {
  if (ts.isJsxAttribute(node) && node.name.getText(tree) === "onChangeText" && node.initializer
    && ts.isJsxExpression(node.initializer) && node.initializer.expression?.getText(tree).includes("isCurrentLegacyAddressEditor()")) {
    inputChange = node.initializer.expression;
  }
  ts.forEachChild(node, findInput);
}
findInput(modal);
if (!inputChange) throw new Error("Missing production address input guard");

type Job = { id: string; address: string; companyId?: number };
type Employee = { employeeId: string; role: string; sessionSource: string };
type Session = { portal: string; token: string; company: { id: number }; user: { id: number; role: string } } | null;
type State = { selectedJob: Job | null; jobs: Job[]; showEditAddressModal: boolean; editAddressDraft: string; savingAddress: boolean };
type API = {
  open: () => Promise<void>; save: () => Promise<void>; cancel: () => void; type: (value: string) => void;
  entry: () => boolean; editor: () => boolean; close: () => void; locked: () => boolean;
  setSelectedJob: React.Dispatch<React.SetStateAction<Job | null>>; setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
  state: State;
};
type Props = {
  testRef: React.RefObject<API | null>; currentEmployee: Employee | null; employeeLoading: boolean;
  jobSyncSession: Session; jobSyncLoading: boolean; isFocused: boolean; renderActualJSX: boolean;
  jobMetaMutation: { mutateAsync: (input: { jobId: string; customerAddress: string }) => Promise<unknown> };
};
type NativeNode = PhotoTestNode & { nativeProps: Record<string, unknown> };
const boundaries = {
  appState: "active", listeners: new Set<(state: string) => void>(),
  getSessionToken: vi.fn<() => Promise<string | null>>(), updateMeta: vi.fn<Props["jobMetaMutation"]["mutateAsync"]>(),
  alert: vi.fn(), fetch: vi.fn(),
};
const AppState = {
  get currentState() { return boundaries.appState; },
  addEventListener: (_name: string, listener: (state: string) => void) => {
    boundaries.listeners.add(listener); return { remove: () => boundaries.listeners.delete(listener) };
  },
};
const host = (name: string) => function NativePrimitive(props: Record<string, unknown>) {
  return React.createElement(name, {
    ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; },
  }, props.children as React.ReactNode);
};
const program = `function ExtractedAddressScreen(props) {
  const { currentEmployee, employeeLoading, jobSyncSession, jobSyncLoading, isFocused, jobMetaMutation } = props;
  function useFocusEffect(callback) { useEffect(() => isFocused ? callback() : undefined, [callback, isFocused]); }
  ${["legacyToken", "legacyTokenReady", "hasJobSyncEmployee", "sheetEpochRef", "invoiceEpochRef", "checkoutEpochRef",
    "selectedJob", "companyJobOperationEpoch", "invalidateCompanyJobOperation", "setSelectedJob", "jobs",
    "showEditAddressModal", "addressModalEpoch", "addressEntryEpoch", "addressSaveLockRef", "addressEditorScopeRef",
    "setShowEditAddressModal", "editAddressDraft", "savingAddress", "companyJobMode"].map(declaration).join("\n")}
  ${range("const managementActionKey =", "const { isCurrent: isCurrentCompanyJobOperation,")}
  ${range("useEffect(() => {\n    managementActionRef.current.mounted = true;", "// HSC_LEGACY_ADDRESS_CONTROLLER_START")}
  ${controller}
  useImperativeHandle(props.testRef, () => ({
    open: openLegacyAddressEditor, save: saveLegacyAddress, cancel: cancelLegacyAddressEditor,
    type: ${inputChange.getText(tree)}, entry: isCurrentLegacyAddressEntry, editor: isCurrentLegacyAddressEditor,
    close: () => setShowEditAddressModal(false), locked: () => addressSaveLockRef.current,
    setSelectedJob, setJobs,
    state: { selectedJob, jobs, showEditAddressModal, editAddressDraft, savingAddress }
  }));
  return props.renderActualJSX ? <>${pencil.getText(tree)}${unavailable.getText(tree)}${modal.getText(tree)}</> : null;
}`;
const compiled = ts.transpileModule(program, { fileName: "extracted-address-screen.tsx", reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } });
const environment = { React, useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore,
  useCompanyJobOperation, useCompanyJobOperationEpoch, AppState, Platform: { OS: "ios" },
  LegacyAuth: { getSessionToken: boundaries.getSessionToken }, Alert: { alert: boundaries.alert },
  TouchableOpacity: host("native-touch"), Text: host("native-text"), View: host("native-view"), TextInput: host("native-input"),
  jobSheetColors: { background: "#000", surface: "#111", foreground: "#fff", muted: "#aaa", primary: "#08f", border: "#333" },
};
const ExtractedAddressScreen = new Function(...Object.keys(environment), `${compiled.outputText}\nreturn ExtractedAddressScreen;`)(
  ...Object.values(environment)) as React.ComponentType<Props>;
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let props: Props;
let cleanupWaits: (() => void)[];
const initialJob = (): Job => ({ id: "41", address: "Old service location" });
const actor = (): NonNullable<Session> => ({ portal: "company", token: "company-fixture-only", company: { id: 8 }, user: { id: 9, role: "owner" } });
const a = () => { if (!props.testRef.current) throw new Error("No committed test API"); return props.testRef.current; };
async function invoke(callback: () => unknown) { await act(async () => { await callback(); }); }
async function render(patch: Partial<Props> = {}) {
  props = { ...props, ...patch }; await invoke(() => root.render(<ExtractedAddressScreen {...props} />));
}
async function seed(job: Job | null = initialJob()) {
  await render(); await invoke(() => { a().setSelectedJob(job); a().setJobs(job ? [job, { id: "41", companyId: 8, address: "Company snapshot" }, { id: "42", address: "Other Job" }] : []); });
}
async function opened() {
  await seed(); await invoke(() => a().open()); expect(a().state.showEditAddressModal).toBe(true);
  expect(a().editor()).toBe(true); await invoke(() => a().type("  New service location  "));
  return a();
}
async function start(callback: () => Promise<void>) {
  let task!: Promise<void>; await invoke(() => { task = callback(); }); return { task };
}
function deferred<T>(cleanupValue: T) {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  cleanupWaits.push(() => resolve(cleanupValue)); return { promise, resolve, reject };
}
async function appState(state: string) {
  await invoke(() => { boundaries.appState = state; boundaries.listeners.forEach((listener) => listener(state)); });
}
function nodes(name: string): NativeNode[] {
  const all = (node: PhotoTestNode): NativeNode[] => [node as NativeNode, ...node.childNodes.flatMap(all)];
  return all(container).filter((node) => node.nodeName.toLowerCase() === name);
}
const invalidations = ["company session", "Company provenance", "role", "employee identity", "Job identity", "session source",
  "focus", "Company loading", "employee loading", "credential snapshot", "native credential", "background roundtrip"] as const;
type Invalidation = typeof invalidations[number];
async function invalidate(kind: Invalidation) {
  if (kind === "company session") await render({ jobSyncSession: actor() });
  else if (kind === "Company provenance") await invoke(() => a().setSelectedJob({ ...initialJob(), companyId: 8 }));
  else if (kind === "role") await render({ currentEmployee: { ...props.currentEmployee!, role: "technician" } });
  else if (kind === "employee identity") await render({ currentEmployee: { ...props.currentEmployee!, employeeId: "employee-2" } });
  else if (kind === "Job identity") await invoke(() => a().setSelectedJob({ id: "42", address: "Other Job" }));
  else if (kind === "session source") await render({ currentEmployee: { ...props.currentEmployee!, sessionSource: "jobsync" } });
  else if (kind === "focus") await render({ isFocused: false });
  else if (kind === "Company loading") await render({ jobSyncLoading: true });
  else if (kind === "employee loading") await render({ employeeLoading: true });
  else if (kind === "credential snapshot") {
    boundaries.getSessionToken.mockResolvedValue("legacy-rotated-fixture"); await render({ isFocused: false }); await render({ isFocused: true });
  } else if (kind === "native credential") boundaries.getSessionToken.mockResolvedValue("legacy-rotated-fixture");
  else { await appState("background"); await appState("active"); }
}

beforeEach(() => {
  vi.clearAllMocks(); cleanupWaits = []; boundaries.appState = "active"; boundaries.listeners.clear();
  boundaries.getSessionToken.mockReset().mockResolvedValue("legacy-fixture-only");
  boundaries.updateMeta.mockReset().mockResolvedValue({ success: true });
  boundaries.fetch.mockRejectedValue(new Error("Live HTTP is forbidden in address acceptance tests")); vi.stubGlobal("fetch", boundaries.fetch);
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  props = { testRef: React.createRef<API>(), currentEmployee: { employeeId: "employee-1", role: "admin", sessionSource: "legacy" },
    employeeLoading: false, jobSyncSession: null, jobSyncLoading: false, isFocused: true, renderActualJSX: false,
    jobMetaMutation: { mutateAsync: boundaries.updateMeta } };
});
afterEach(async () => {
  await invoke(() => root.unmount()); await invoke(() => cleanupWaits.forEach((resolve) => resolve()));
  expect(boundaries.listeners.size).toBe(0); expect(boundaries.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

describe("actual AST-extracted address controller + real committed React operation hooks", () => {
  it("extracts the integrated controller and native legacy verification without syntax errors or report-snippet dependencies", () => {
    expect(compiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
    expect(controller).toContain("useCompanyJobOperation(addressIdentityKey");
    expect(controller).toContain("await jobMetaMutation.mutateAsync({ jobId: scope.jobId, customerAddress });");
    expect(program).toContain("(await LegacyAuth.getSessionToken()) !== legacyToken");
    expect(program).not.toContain("address-implementation.md");
  });
  it("opens, types and saves one real legacy scope, trimming the captured draft and updating only matching legacy rows", async () => {
    const action = await opened(); expect(boundaries.getSessionToken).toHaveBeenCalled();
    await invoke(() => action.save());
    expect(boundaries.updateMeta.mock.calls).toEqual([[{ jobId: "41", customerAddress: "New service location" }]]);
    expect(a().state).toMatchObject({ selectedJob: { id: "41", address: "New service location" }, showEditAddressModal: false, editAddressDraft: "", savingAddress: false });
    expect(a().state.jobs).toEqual([{ id: "41", address: "New service location" }, { id: "41", companyId: 8, address: "Company snapshot" }, { id: "42", address: "Other Job" }]);
    expect(action.locked()).toBe(false); expect(boundaries.alert).not.toHaveBeenCalled();
  });
  it("preserves the existing legacy whitespace-only address clear behavior", async () => {
    await opened(); await invoke(() => a().type("   ")); await invoke(() => a().save());
    expect(boundaries.updateMeta.mock.calls).toEqual([[{ jobId: "41", customerAddress: "" }]]); expect(a().state.selectedJob?.address).toBe("");
  });
  it.each(["Company session without provenance", "Company session with provenance", "Company provenance without session", "zero Company provenance"])("never opens or calls legacy updateMeta for %s", async (kind) => {
    if (kind.startsWith("Company session")) props.jobSyncSession = actor();
    const companyId = kind === "zero Company provenance" ? 0 : kind === "Company session without provenance" ? undefined : 8;
    await seed({ ...initialJob(), ...(companyId === undefined ? {} : { companyId }) }); const action = a();
    await invoke(() => { action.type("Blocked address"); action.cancel(); }); await invoke(() => action.open()); await invoke(() => action.save());
    expect(action.entry()).toBe(false); expect(action.editor()).toBe(false); expect(a().state.showEditAddressModal).toBe(false);
    expect(a().state.editAddressDraft).toBe(""); expect(boundaries.updateMeta).not.toHaveBeenCalled();
  });
  it("never promotes a retained Company callback into a later legitimate legacy scope", async () => {
    await render({ jobSyncSession: actor() }); await seed(); const stale = a(); await render({ jobSyncSession: null });
    await invoke(() => stale.open()); expect(a().state.showEditAddressModal).toBe(false);
    await invoke(() => a().open()); await invoke(() => a().type("Fresh legacy draft"));
    await invoke(() => stale.save()); expect(boundaries.updateMeta).not.toHaveBeenCalled();
    await invoke(() => a().save()); expect(boundaries.updateMeta.mock.calls).toEqual([[{ jobId: "41", customerAddress: "Fresh legacy draft" }]]);
  });
  it.each(invalidations)("fences retained open/type/cancel/save after %s changes", async (kind) => {
    const stale = await opened(); await invalidate(kind);
    const before = a().state; await invoke(() => { stale.type("Stale injected draft"); stale.cancel(); });
    await invoke(() => stale.open()); await invoke(() => stale.save());
    expect(boundaries.updateMeta).not.toHaveBeenCalled(); expect(a().state.editAddressDraft).not.toBe("Stale injected draft");
    expect(a().state.selectedJob?.address).toBe(before.selectedJob?.address); expect(boundaries.alert).not.toHaveBeenCalled();
  });
  it.each(["cancel", "external close"] as const)("%s plus same-Job reopen fences old open/type/cancel/save but allows the committed fresh editor", async (kind) => {
    await seed(); const oldEntry = a(); await invoke(() => oldEntry.open()); await invoke(() => a().type("Old draft")); const stale = a();
    await invoke(() => { if (kind === "cancel") stale.cancel(); else stale.close(); });
    await invoke(() => oldEntry.open()); expect(a().state.showEditAddressModal).toBe(false);
    await invoke(() => a().open()); await invoke(() => a().type("Reopened draft")); const fresh = a();
    await invoke(() => { stale.type("Retained draft"); stale.cancel(); }); await invoke(() => stale.open()); await invoke(() => stale.save());
    expect(boundaries.updateMeta).not.toHaveBeenCalled(); expect(a().state).toMatchObject({ showEditAddressModal: true, editAddressDraft: "Reopened draft" });
    expect(stale.editor()).toBe(false); expect(fresh.editor()).toBe(true); await invoke(() => fresh.save());
    expect(boundaries.updateMeta.mock.calls).toEqual([[{ jobId: "41", customerAddress: "Reopened draft" }]]);
  });
  it("a batched close/reopen attempt synchronously fences old entry/editor before a React commit", async () => {
    const stale = await opened(); await invoke(() => { stale.close(); stale.type("Batched stale draft"); stale.cancel(); void stale.open(); void stale.save(); });
    expect(boundaries.updateMeta).not.toHaveBeenCalled(); expect(a().state.showEditAddressModal).toBe(false);
    await invoke(() => a().open()); await invoke(() => a().type("Fresh after batch")); await invoke(() => a().save());
    expect(boundaries.updateMeta.mock.calls).toEqual([[{ jobId: "41", customerAddress: "Fresh after batch" }]]);
  });
  it("background→active invalidates a closed-editor entry callback, while a newly committed entry can still open", async () => {
    await seed(); const stale = a(); await appState("background"); await appState("active"); await invoke(() => stale.open());
    expect(a().state.showEditAddressModal).toBe(false); await invoke(() => a().open()); expect(a().state.showEditAddressModal).toBe(true);
  });
  it.each(["native credential", "company session", "focus", "background roundtrip"] as const)("discards an opening paused at native credential verification after %s", async (kind) => {
    await seed(); const hold = deferred<string | null>("legacy-fixture-only"); boundaries.getSessionToken.mockReturnValueOnce(hold.promise);
    const { task } = await start(() => a().open()); await invalidate(kind);
    await invoke(() => { hold.resolve(kind === "native credential" ? "rotated-fixture" : "legacy-fixture-only"); }); await invoke(() => task);
    expect(a().state.showEditAddressModal).toBe(false); expect(boundaries.updateMeta).not.toHaveBeenCalled();
  });
  it.each(["cancel", "external close"] as const)("holds the duplicate Save lock through %s until the pending mutation settles, without replacing the captured draft", async (kind) => {
    const stale = await opened(); const hold = deferred<unknown>({ success: true }); boundaries.updateMeta.mockReturnValueOnce(hold.promise);
    const { task } = await start(() => stale.save()); expect(boundaries.updateMeta).toHaveBeenCalledTimes(1); expect(stale.locked()).toBe(true);
    await invoke(() => stale.save()); await invoke(() => a().type("Later mutable draft"));
    await invoke(() => { if (kind === "cancel") a().cancel(); else a().close(); }); expect(stale.locked()).toBe(true);
    await invoke(() => a().open()); await invoke(() => stale.save()); expect(a().state.showEditAddressModal).toBe(false);
    expect(boundaries.updateMeta.mock.calls).toEqual([[{ jobId: "41", customerAddress: "New service location" }]]);
    await invoke(() => hold.resolve({ success: true })); await invoke(() => task);
    expect(stale.locked()).toBe(false); expect(a().state.selectedJob?.address).toBe("Old service location");
    await invoke(() => a().open()); await invoke(() => a().type("After pending settlement")); await invoke(() => a().save());
    expect(boundaries.updateMeta).toHaveBeenCalledTimes(2); expect(boundaries.updateMeta).toHaveBeenLastCalledWith({ jobId: "41", customerAddress: "After pending settlement" });
  });
  it("captures the immutable draft before asynchronous credential verification, not the subsequent typed value", async () => {
    const action = await opened(); const hold = deferred<string | null>("legacy-fixture-only"); boundaries.getSessionToken.mockReturnValueOnce(hold.promise);
    const one = await start(() => action.save()); const two = await start(() => action.save());
    await invoke(() => a().type("Typed while credential read waits")); expect(boundaries.updateMeta).not.toHaveBeenCalled();
    await invoke(() => hold.resolve("legacy-fixture-only")); await invoke(() => Promise.all([one.task, two.task]));
    expect(boundaries.updateMeta.mock.calls).toEqual([[{ jobId: "41", customerAddress: "New service location" }]]);
    expect(a().state.selectedJob?.address).toBe("New service location");
  });
  it.each(["company session", "role", "Job identity", "native credential", "background roundtrip"] as const)("fences Save paused before updateMeta at credential verification after %s", async (kind) => {
    const action = await opened(); const hold = deferred<string | null>("legacy-fixture-only"); boundaries.getSessionToken.mockReturnValueOnce(hold.promise);
    const { task } = await start(() => action.save()); expect(action.locked()).toBe(true); expect(boundaries.updateMeta).not.toHaveBeenCalled();
    await invalidate(kind); await invoke(() => hold.resolve(kind === "native credential" ? "rotated-fixture" : "legacy-fixture-only")); await invoke(() => task);
    expect(boundaries.updateMeta).not.toHaveBeenCalled(); expect(action.locked()).toBe(false); expect(boundaries.alert).not.toHaveBeenCalled();
  });
  it("a native credential mismatch remains terminal for the captured action even if the old credential later returns", async () => {
    const action = await opened(); boundaries.getSessionToken.mockResolvedValueOnce("rotated-fixture"); await invoke(() => action.save());
    boundaries.getSessionToken.mockResolvedValue("legacy-fixture-only"); await render(); await invoke(() => action.save()); await invoke(() => action.open());
    expect(action.entry()).toBe(false); expect(action.editor()).toBe(false); expect(boundaries.updateMeta).not.toHaveBeenCalled();
  });
  it("role roundtrip cannot revive earlier committed editor callbacks but permits the fresh legacy scope", async () => {
    const stale = await opened(); const employee = props.currentEmployee!; await invalidate("role"); await render({ currentEmployee: employee });
    await invoke(() => a().open()); await invoke(() => a().type("New same-Job scope"));
    await invoke(() => { stale.type("Revived stale draft"); stale.cancel(); }); await invoke(() => stale.save());
    expect(a().state.editAddressDraft).toBe("New same-Job scope"); expect(boundaries.updateMeta).not.toHaveBeenCalled();
    await invoke(() => a().save()); expect(boundaries.updateMeta.mock.calls).toEqual([[{ jobId: "41", customerAddress: "New same-Job scope" }]]);
  });
  it("same-Job explicit selection fences earlier callbacks and permits a newly committed entry", async () => {
    const stale = await opened(); await invoke(() => a().setSelectedJob({ ...initialJob() }));
    await invoke(() => { stale.type("Retained old selection"); stale.cancel(); }); await invoke(() => stale.save());
    expect(boundaries.updateMeta).not.toHaveBeenCalled(); expect(stale.entry()).toBe(false); expect(stale.editor()).toBe(false);
    expect(a().entry()).toBe(true); await invoke(() => a().open()); expect(a().state.showEditAddressModal).toBe(true);
  });
  it("successful address save permits another fresh edit on the same selected Job without a session transition", async () => {
    await opened(); await invoke(() => a().save()); expect(a().state.selectedJob?.address).toBe("New service location");
    expect(a().entry()).toBe(true); await invoke(() => a().open()); expect(a().state.showEditAddressModal).toBe(true);
    await invoke(() => a().type("Second legitimate edit")); await invoke(() => a().save());
    expect(boundaries.updateMeta).toHaveBeenCalledTimes(2); expect(a().state.selectedJob?.address).toBe("Second legitimate edit");
  });
  it.each(invalidations)("discards pending mutation success after %s without stale local updates or alerts", async (kind) => {
    const action = await opened(); const hold = deferred<unknown>({ success: true }); boundaries.updateMeta.mockReturnValueOnce(hold.promise);
    const { task } = await start(() => action.save()); expect(boundaries.updateMeta).toHaveBeenCalledTimes(1);
    await invalidate(kind); const before = a().state; await invoke(() => hold.resolve({ success: true })); await invoke(() => task);
    expect(a().state.selectedJob).toEqual(before.selectedJob); expect(a().state.jobs).toEqual(before.jobs);
    expect(action.locked()).toBe(false); expect(boundaries.alert).not.toHaveBeenCalled(); expect(boundaries.updateMeta).toHaveBeenCalledTimes(1);
  });
  it.each(["company session", "Job identity", "native credential", "background roundtrip"] as const)("discards pending mutation failure after %s, with no false current-scope error or automatic retry", async (kind) => {
    const action = await opened(); const hold = deferred<unknown>({ success: true }); boundaries.updateMeta.mockReturnValueOnce(hold.promise);
    const { task } = await start(() => action.save()); await invalidate(kind); const before = a().state;
    await invoke(() => hold.reject(new Error("Isolated uncertain mutation"))); await invoke(() => task);
    expect(a().state.selectedJob).toEqual(before.selectedJob); expect(a().state.jobs).toEqual(before.jobs);
    expect(boundaries.alert).not.toHaveBeenCalled(); expect(boundaries.updateMeta).toHaveBeenCalledTimes(1); expect(action.locked()).toBe(false);
  });
  it("reports an uncertain current legacy failure accurately without optimistic updates or a blind retry", async () => {
    const action = await opened(); boundaries.updateMeta.mockRejectedValueOnce(new Error("Isolated transport uncertainty")); await invoke(() => action.save());
    expect(boundaries.updateMeta).toHaveBeenCalledTimes(1); expect(a().state.selectedJob?.address).toBe("Old service location");
    expect(boundaries.alert.mock.calls).toEqual([["Address update not confirmed", expect.stringContaining("Refresh the Job")]]);
    expect(a().state).toMatchObject({ showEditAddressModal: true, editAddressDraft: "  New service location  ", savingAddress: false }); expect(action.locked()).toBe(false);
  });
  it("unmount fences committed entry/type/save/cancel and discards the in-flight result", async () => {
    const action = await opened(); const hold = deferred<unknown>({ success: true }); boundaries.updateMeta.mockReturnValueOnce(hold.promise);
    const { task } = await start(() => action.save()); await invoke(() => root.unmount());
    expect(action.entry()).toBe(false); expect(action.editor()).toBe(false);
    await invoke(() => { action.type("Unmounted draft"); action.cancel(); }); await invoke(() => action.open()); await invoke(() => action.save());
    await invoke(() => hold.resolve({ success: true })); await invoke(() => task);
    expect(boundaries.updateMeta).toHaveBeenCalledTimes(1); expect(boundaries.alert).not.toHaveBeenCalled(); expect(action.locked()).toBe(false);
  });
});

describe("supplemental actual address JSX wiring", () => {
  it("retains guarded legacy input/pencil/modal wiring and Company unavailability with no alternate address mutation", () => {
    expect(pencil.getText(tree)).toContain("onPress={openLegacyAddressEditor}");
    expect(modal.getText(tree)).toContain("onPress={cancelLegacyAddressEditor}"); expect(modal.getText(tree)).toContain("onPress={saveLegacyAddress}");
    expect(modal.getText(tree)).toContain("disabled={savingAddress}"); expect(unavailable.getText(tree)).toContain("Service address editing is unavailable for Company Jobs.");
    expect(source.match(/jobMetaMutation\.mutateAsync\(\{[^}]*customerAddress[^}]*\}/g)).toHaveLength(1);
    expect(source).toContain("CustomerContactActions customerId={selectedJob.customerId}"); expect(source).toContain("<JobLocationMap address={formatJobMapAddress(");
  });
  it("renders the actual pencil after committed legacy initialization and the actual modal immediately after open", async () => {
    await render({ renderActualJSX: true }); await seed();
    expect(a().entry()).toBe(true); expect(nodes("native-touch").some((node) => node.nativeProps.accessibilityLabel === "Edit legacy Job address")).toBe(true);
    await invoke(() => a().open()); expect(a().state.showEditAddressModal).toBe(true); expect(a().editor()).toBe(true);
    expect(nodes("native-input")).toHaveLength(1);
  });
  it("actual host callbacks can type/save only after an incidental post-commit render exposes the missing modal", async () => {
    await render({ renderActualJSX: true }); await seed();
    const pencilNode = nodes("native-touch").find((node) => node.nativeProps.accessibilityLabel === "Edit legacy Job address")!;
    await invoke(() => (pencilNode.nativeProps.onPress as () => Promise<void>)());
    // This extra render is deliberately explicit: it is a reproduction aid,
    // not evidence that normal open renders the modal. The preceding test must
    // keep failing until production independently exposes the editor on open.
    await render(); const input = nodes("native-input")[0]; expect(input).toBeDefined();
    await invoke(() => (input.nativeProps.onChangeText as (value: string) => void)("  Actual host draft  "));
    const save = nodes("native-touch").find((node) => node.textContent === "Save Address")!;
    expect(save.nativeProps.disabled).toBe(false); await invoke(() => (save.nativeProps.onPress as () => Promise<void>)());
    expect(boundaries.updateMeta.mock.calls).toEqual([[{ jobId: "41", customerAddress: "Actual host draft" }]]);
    expect(nodes("native-input")).toHaveLength(0); expect(a().state.selectedJob?.address).toBe("Actual host draft");
  });
  it("executes actual Company JSX as noninteractive unavailability with no editor or legacy mutation", async () => {
    await render({ renderActualJSX: true, jobSyncSession: actor() }); await seed({ ...initialJob(), companyId: 8 });
    expect(container.textContent).toContain("Service address editing is unavailable for Company Jobs.");
    expect(nodes("native-touch")).toHaveLength(0); expect(nodes("native-input")).toHaveLength(0); await invoke(() => a().open());
    expect(boundaries.updateMeta).not.toHaveBeenCalled();
  });
});
