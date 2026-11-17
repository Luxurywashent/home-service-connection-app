import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// This item cannot edit the parent-owned screen. Execute the supplied integration
// snippet against isolated boundaries; retain separate failing actual-source gates
// until that parent applies it. No fixture pass certifies the production screen.
const root = path.resolve(import.meta.dirname, "..");
const report = readFileSync("/home/ubuntu/hsc-mobile-release-acceptance-repair-20261117/address-implementation.md", "utf8");
const backend = "/home/ubuntu/hsc-mobile-release-readiness-20261117/backend-source-66141c98/server";
const source = () => readFileSync(path.join(root, "app/(tabs)/admin-schedule.tsx"), "utf8");
function block(label: string) {
  const section = report.split(`<!-- ADDRESS_${label}_START -->`)[1]?.split(`<!-- ADDRESS_${label}_END -->`)[0];
  const value = section?.match(/```tsx\n([\s\S]*?)\n```/)?.[1];
  if (!value) throw new Error(`Missing address ${label} integration snippet`);
  return value;
}
const controller = ts.transpileModule(block("CONTROLLER"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
});
type Job = { id: string; address: string; companyId?: number };
type Scope = { jobId: string; isCurrent: () => boolean; verify: () => Promise<boolean> };
type Ref<T> = { current: T };
type Session = { portal: string; token: string; company: { id: number }; user: { id: number; role: string } } | null;
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  let selectedJob: Job | null = { id: "41", address: "Old service location" };
  let jobs: Job[] = [selectedJob];
  let showEditAddressModal = false;
  let editAddressDraft = "";
  let savingAddress = false;
  let companyJobMode = false;
  let jobSyncSession: Session = null;
  let jobSyncLoading = false;
  let hasJobSyncEmployee = false;
  let employeeLoading = false;
  let legacyTokenReady = true;
  let legacyToken = "legacy-test-token";
  let actualLegacyToken = legacyToken;
  let isFocused = true;
  let currentEmployee = { employeeId: "employee-1", role: "admin", sessionSource: "legacy" };
  const managementActionRef = { current: { companyMode: false, mounted: true, focused: true, generation: 0 } };
  const sheetEpochRef = { current: 1 };
  const addressModalEpochRef = { current: 0 };
  const addressSaveLockRef = { current: false };
  const addressEditorScopeRef: Ref<Scope | null> = { current: null };
  const mutation = vi.fn<(input: { jobId: string; customerAddress: string }) => Promise<unknown>>().mockResolvedValue({ success: true });
  const alert = vi.fn();
  const subscribers = new Set<(state: string) => void>();
  const AppState = { currentState: "active", addEventListener: (_event: string, callback: (state: string) => void) => {
    subscribers.add(callback); return { remove: () => subscribers.delete(callback) };
  } };
  const refs: Ref<unknown>[] = [];
  const effects: { deps: unknown[]; cleanup?: () => void }[] = [];
  let refIndex = 0;
  let effectIndex = 0;
  const pending: (() => void)[] = [];
  const setShowEditAddressModal = (visible: boolean) => { addressModalEpochRef.current++; showEditAddressModal = visible; };
  const useRef = (initial: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial });
  const useEffect = (callback: () => void | (() => void), deps: unknown[]) => {
    const index = effectIndex++;
    if (effects[index]?.deps.every((value, i) => Object.is(value, deps[i])) && effects[index].deps.length === deps.length) return;
    pending.push(() => { effects[index]?.cleanup?.(); effects[index] = { deps, cleanup: callback() || undefined }; });
  };
  const render = () => {
    refIndex = 0; effectIndex = 0;
    const generation = managementActionRef.current.generation;
    const epoch = sheetEpochRef.current;
    const capturedToken = legacyToken;
    const renderedLegacyAction = Object.assign(() => !companyJobMode && !managementActionRef.current.companyMode
      && managementActionRef.current.mounted && managementActionRef.current.focused && isFocused
      && !employeeLoading && legacyTokenReady && !jobSyncLoading && !jobSyncSession && !hasJobSyncEmployee
      && managementActionRef.current.generation === generation && sheetEpochRef.current === epoch,
    { verify: async () => {
      await Promise.resolve();
      if (actualLegacyToken !== capturedToken) { managementActionRef.current.generation++; return false; }
      return renderedLegacyAction();
    } });
    const env = { companyJobMode, selectedJob, jobSyncSession, jobSyncLoading, hasJobSyncEmployee, currentEmployee,
      employeeLoading, legacyToken, legacyTokenReady, isFocused, sheetEpochRef, managementActionRef, AppState,
      useRef, useEffect, addressModalEpochRef, addressSaveLockRef, addressEditorScopeRef, renderedLegacyAction,
      showEditAddressModal, editAddressDraft, jobMetaMutation: { mutateAsync: mutation }, Alert: { alert },
      setShowEditAddressModal, setEditAddressDraft: (value: string) => { editAddressDraft = value; },
      setSavingAddress: (value: boolean) => { savingAddress = value; },
      setSelectedJob: (update: (previous: Job | null) => Job | null) => { selectedJob = update(selectedJob); },
      setJobs: (update: (previous: Job[]) => Job[]) => { jobs = update(jobs); } };
    const evaluate = new Function(...Object.keys(env), `${controller.outputText}\nreturn {
      open: openLegacyAddressEditor, save: saveLegacyAddress, cancel: cancelLegacyAddressEditor,
      entry: isCurrentLegacyAddressEntry, editor: isCurrentLegacyAddressEditor };`);
    const result = evaluate(...Object.values(env)) as {
      open: () => Promise<void>; save: () => Promise<void>; cancel: () => void; entry: () => boolean; editor: () => boolean;
    };
    pending.splice(0).forEach((effect) => effect());
    return result;
  };
  const api = {
    render, mutation, alert, refs, addressSaveLockRef, addressModalEpochRef, addressEditorScopeRef, managementActionRef, sheetEpochRef,
    state: () => ({ selectedJob, jobs, showEditAddressModal, editAddressDraft, savingAddress }),
    draft: (value: string) => { editAddressDraft = value; },
    company: (provenance = true) => { companyJobMode = true; managementActionRef.current.companyMode = true;
      jobSyncSession = { portal: "company", token: "fake-company-token", company: { id: 8 }, user: { id: 9, role: "owner" } };
      if (provenance && selectedJob) selectedJob = { ...selectedJob, companyId: 8 }; },
    legacy: () => { companyJobMode = false; managementActionRef.current.companyMode = false; jobSyncSession = null;
      if (selectedJob) { const { companyId: _companyId, ...legacy } = selectedJob; selectedJob = legacy; } },
    job: (job: Job | null) => { selectedJob = job; sheetEpochRef.current++; managementActionRef.current.generation++; },
    provenance: () => { if (selectedJob) selectedJob = { ...selectedJob, companyId: 8 }; },
    focus: (value: boolean) => { isFocused = value; managementActionRef.current.focused = value; if (!value) managementActionRef.current.generation++; },
    background: () => { AppState.currentState = "background"; subscribers.forEach((listener) => listener("background")); },
    foreground: () => { AppState.currentState = "active"; subscribers.forEach((listener) => listener("active")); },
    unmount: () => { managementActionRef.current.mounted = false; },
    generation: () => { managementActionRef.current.generation++; },
    role: () => { currentEmployee = { ...currentEmployee, role: "technician" }; managementActionRef.current.generation++; },
    credentials: () => { actualLegacyToken = "different-test-token"; },
    loading: () => { jobSyncLoading = true; },
    legacyLoading: () => { employeeLoading = true; },
    unready: () => { legacyTokenReady = false; },
    jobsyncEmployee: () => { hasJobSyncEmployee = true; },
    tokenChange: () => { legacyToken = "new-test-token"; actualLegacyToken = legacyToken; },
  };
  return api;
}
async function opened() {
  const f = fixture();
  await f.render().open();
  expect(f.state().showEditAddressModal).toBe(true);
  f.draft("  New service location  ");
  return { f, action: f.render() };
}

describe("address parent snippet — isolated legacy-only dispatch and immutable scope", () => {
  it("has no TypeScript syntax errors in the supplied controller", () => {
    expect(controller.diagnostics?.filter((value) => value.category === ts.DiagnosticCategory.Error)).toEqual([]);
  });
  it("retains a legitimate legacy edit and dispatches its trimmed immutable address once", async () => {
    const { f, action } = await opened();
    expect(action.editor()).toBe(true);
    await action.save();
    expect(f.mutation).toHaveBeenCalledTimes(1);
    expect(f.mutation).toHaveBeenCalledWith({ jobId: "41", customerAddress: "New service location" });
    expect(f.state().selectedJob?.address).toBe("New service location");
    expect(f.state().jobs[0].address).toBe("New service location");
    expect(f.state().showEditAddressModal).toBe(false);
    expect(f.state().savingAddress).toBe(false);
  });
  it.each([true, false])("never opens in captured Company mode (provenance=%s)", async (provenance) => {
    const f = fixture(); f.company(provenance); const action = f.render();
    await action.open(); await action.save();
    expect(action.entry()).toBe(false); expect(f.state().showEditAddressModal).toBe(false); expect(f.mutation).not.toHaveBeenCalled();
  });
  it("rejects a Company-provenance Job even with no Company session", async () => {
    const f = fixture(); f.provenance(); const action = f.render(); await action.open();
    expect(action.entry()).toBe(false); expect(f.mutation).not.toHaveBeenCalled();
  });
  const invalidations = ["company", "provenance", "focus", "background", "unmount", "generation", "role", "credentials", "loading", "legacyLoading", "unready", "jobsyncEmployee", "tokenChange", "job"] as const;
  it.each(invalidations)("rejects open/editor/save after %s invalidates the captured legacy scope", async (kind) => {
    const { f, action } = await opened();
    if (kind === "focus") f.focus(false);
    else if (kind === "job") f.job({ id: "42", address: "Other Job" });
    else f[kind]();
    f.render();
    await action.open(); await action.save();
    expect(action.editor()).toBe(false); expect(f.mutation).not.toHaveBeenCalled();
    expect(f.state().selectedJob?.address).not.toBe("New service location");
  });
  it("denies a retained Company callback after transition to legacy", async () => {
    const f = fixture(); f.company(); const stale = f.render(); f.legacy(); f.render();
    await stale.open(); await stale.save(); expect(f.mutation).not.toHaveBeenCalled(); expect(f.state().showEditAddressModal).toBe(false);
  });
  it("denies background→active roundtrip callbacks even without session changes", async () => {
    const { f, action } = await opened(); f.background(); f.foreground(); await action.save();
    expect(action.editor()).toBe(false); expect(f.mutation).not.toHaveBeenCalled();
  });
  it("denies retained Save after cancel and reopen on the same Job", async () => {
    const { f, action } = await opened(); action.cancel();
    await f.render().open(); f.draft("Reopened address"); const fresh = f.render();
    await action.save(); expect(f.mutation).not.toHaveBeenCalled();
    await fresh.save(); expect(f.mutation).toHaveBeenCalledTimes(1);
    expect(f.mutation).toHaveBeenCalledWith({ jobId: "41", customerAddress: "Reopened address" });
  });
  it("fences native credential changes while opening is awaiting verification", async () => {
    const f = fixture(); const action = f.render(); const opening = action.open(); f.credentials(); await opening;
    expect(f.state().showEditAddressModal).toBe(false); expect(f.mutation).not.toHaveBeenCalled();
  });
  it("holds a synchronous lock across duplicate Save callbacks and immutable draft capture", async () => {
    const { f, action } = await opened(); const hold = deferred<unknown>(); f.mutation.mockReturnValue(hold.promise);
    const one = action.save(); const two = action.save(); f.draft("Later mutable draft");
    await Promise.resolve(); await Promise.resolve(); hold.resolve({ success: true }); await Promise.all([one, two]);
    expect(f.mutation).toHaveBeenCalledTimes(1);
    expect(f.mutation).toHaveBeenCalledWith({ jobId: "41", customerAddress: "New service location" });
  });
  it.each(["company", "job", "background", "credentials"] as const)("ignores an in-flight legacy result after %s changes", async (kind) => {
    const { f, action } = await opened(); const hold = deferred<unknown>(); f.mutation.mockReturnValue(hold.promise);
    const saving = action.save(); await vi.waitFor(() => expect(f.mutation).toHaveBeenCalledTimes(1));
    if (kind === "job") f.job({ id: "42", address: "Other Job" }); else f[kind]();
    f.render(); hold.resolve({ success: true }); await saving;
    expect(f.state().selectedJob?.address).not.toBe("New service location"); expect(f.alert).not.toHaveBeenCalled();
    expect(f.addressSaveLockRef.current).toBe(false);
  });
  it("does not blind retry or optimistically update after uncertain legacy failure", async () => {
    const { f, action } = await opened(); f.mutation.mockRejectedValue(new Error("Transport uncertain")); await action.save();
    expect(f.mutation).toHaveBeenCalledTimes(1); expect(f.state().selectedJob?.address).toBe("Old service location");
    expect(f.alert).toHaveBeenCalledWith("Address update not confirmed", expect.stringContaining("Refresh the Job"));
    expect(f.state().savingAddress).toBe(false); expect(f.addressSaveLockRef.current).toBe(false);
  });
});

describe("published 66141 source contract — address semantics, no transport executed", () => {
  it("has no Company Job address/generic metadata PATCH or PUT registration", () => {
    const operations = readFileSync(path.join(backend, "mobileOperations.ts"), "utf8");
    const routes = [...operations.matchAll(/app\.(patch|put)\(`\$\{BASE\}\/company\/jobs([^`]+)`/g)].map((match) => match[2]);
    expect(routes.sort()).toEqual(["/:jobId/assignment", "/:jobId/private-notes", "/:jobId/schedule", "/:jobId/status"]);
    expect(operations).toContain('app.patch(`${BASE}/customers/:customerId`, updateCustomer)');
  });
  it("profile PATCH updates customer/profile address storage, never the saved Job snapshot", () => {
    const customer = readFileSync(path.join(backend, "customerService.ts"), "utf8");
    const profile = customer.split("export async function updateCustomerProfile(")[1].split("export async function updateCommunicationPreferences(")[0];
    expect(profile).toContain("UPDATE fs_customers SET"); expect(profile).toContain("UPDATE fs_customer_addresses SET");
    expect(profile).not.toContain("fs_jobs");
    const primary = customer.split("async function syncLegacyPrimaryAddress(")[1].split("async function withAddressTransaction")[0];
    expect(primary).toContain("UPDATE fs_customers SET address_line1"); expect(primary).not.toContain("fs_jobs");
  });
  it("canonical Job detail derives its service address from fs_jobs, not customer primary", () => {
    const job = readFileSync(path.join(backend, "jobService.ts"), "utf8");
    expect(job).toContain("FROM fs_jobs j JOIN fs_customers c");
    expect(job).toContain("const address = job.address_line1 ? String(job.address_line1) : null;");
    expect(job).toContain("customer_address: address,"); expect(job).toContain("address: address,");
  });
});

describe("PARENT INTEGRATION ACCEPTANCE — actual mobile screen, not fixture success", () => {
  it("mounts the authorized Company editor while retaining current legacy-only pencil isolation", () => {
    const screen = source();
    expect(screen).toContain("companyJobMode && <CompanyJobAddressEditor");
    expect(screen).toContain("writeAddress={updateJobSyncCompanyJobAddress}");
    expect(screen).toContain("onVerified={onCompanyAddressVerified} onSaved={onCompanyAddressSaved}");
    expect(screen).toMatch(/!companyJobMode\s*&&\s*isCurrentLegacyAddressEntry\(\)/);
    expect(screen).toContain("onPress={openLegacyAddressEditor}");
    expect(screen).toContain("CustomerContactActions customerId={selectedJob.customerId}");
    expect(screen).toContain("<JobLocationMap address={formatJobMapAddress(");
    expect(screen).toContain("https://maps.apple.com/?q=");
  });
  it("gates actual modal, input, Cancel and Save to captured legacy scope", () => {
    const screen = source();
    expect(screen).toMatch(/showEditAddressModal\s*&&\s*selectedJob\s*&&\s*!companyJobMode\s*&&\s*isCurrentLegacyAddressEditor\(\)/);
    expect(screen).toContain("onPress={saveLegacyAddress}"); expect(screen).toContain("onPress={cancelLegacyAddressEditor}");
    expect(screen).toMatch(/onChangeText=\{\(value\) => \{ if \(isCurrentLegacyAddressEditor\(\)\) setEditAddressDraft\(value\); \}\}/);
  });
  it("routes only the existing legacy mutation through verified immutable editor scope", () => {
    const screen = source();
    expect(screen.match(/jobMetaMutation\.mutateAsync\(\{[^}]*customerAddress[^}]*\}/g)).toHaveLength(1);
    expect(screen).toContain("await jobMetaMutation.mutateAsync({ jobId: scope.jobId, customerAddress });");
    expect(screen).toContain("if (!await scope.verify()) return;");
    expect(screen).toContain("addressSaveLockRef.current = true;");
    expect(screen).toContain('AppState.addEventListener("change"');
    expect(screen).not.toContain("Changes will reflect on both admin and technician calendars immediately.");
  });
});
