import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companyCalendarSlot, companyCalendarWeekPosition } from "../lib/company-calendar";

type Row = Record<string, any>;
const root = path.resolve(import.meta.dirname, "..");
function installed(kind: "admin" | "technician") {
  const file = path.join(root, `app/(tabs)/${kind === "admin" ? "admin-schedule" : "schedule"}.tsx`);
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const syncName = kind === "admin" ? "syncCompanyJobs" : "syncServerJobs";
  let sync: ts.VariableDeclaration | undefined, created: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === syncName) sync = node;
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onCreated" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression?.getText(ast).includes(syncName)) created = node.initializer.expression;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!sync || !created) throw new Error(`Missing installed ${kind} create reconciliation`);
  const detail: Row = { id: 42, companyId: 9, customerId: 12, assignedUserId: 93, assignedName: "Offline member", updatedAt: "2026-11-17T18:00:00.000Z", scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T16:00:00.000Z", status: "scheduled", customerName: "Offline Customer", serviceName: "Service", addressLine1: "Offline service location", amount: 125 };
  const state: Row = { jobs: [{ id: "unrelated", companyId: 9, privateNotes: "Unrelated" }], selectedJob: null, weekOffset: 2, selectedDay: 1 };
  const set = (key: string) => vi.fn((value: any) => { state[key] = typeof value === "function" ? value(state[key]) : value; });
  const list = vi.fn(async () => [structuredClone(detail)]), settings = vi.fn(async () => ({ id: 9, timezone: "America/Chicago" })), noLegacy = vi.fn(() => { throw new Error("Legacy I/O forbidden in Company calendar acceptance"); });
  const context = vm.createContext({
    jobSyncSession: { token: "offline-calendar", company: { id: 9 }, user: { id: 71, role: kind === "admin" ? "owner" : "technician" } },
    jobSyncLoading: false, authLoading: false, isJobSyncCompany: true,
    calendarScopeRef: { current: { key: "offline-scope", generation: 0 } }, calendarScopeKey: "offline-scope",
    companyCalendarReadEpochRef: { current: 0 }, scheduleReadEpochRef: { current: 0 }, legacyMediaSessionRef: { current: { focusGeneration: 0 } },
    companyScheduleSessionRef: { current: "offline-calendar" }, managementActionRef: { current: { mounted: true, focused: true } },
    captureScreenAction: () => () => true, captureLegacyAction: noLegacy, canonicalCalendarKey: "canonical", canonicalCalendarScopeRef: { current: null },
    employee: { city: "Crestview" }, cityToSlug: () => "crestview", selectedLocation: "crestview", selectedCity: "crestview",
    getJobSyncCompanyJobs: list, getJobSyncCompanySettings: settings, companyCalendarSlot, companyCalendarWeekPosition,
    setCompanyTimezone: set("timezone"), setCompanyCalendarError: set("error"), setJobs: set("jobs"), setSelectedJob: set("selectedJob"), setIsSyncing: set("syncing"), setWeekOffset: set("weekOffset"), setSelectedDay: set("selectedDay"), isCurrentCompanyAdd: vi.fn(() => true),
    utils: { jobs: { listByLocation: { fetch: noLegacy } } }, fetch: noLegacy, AsyncStorage: { setItem: noLegacy }, console: { error: noLegacy, warn: noLegacy }, Date, Intl,
  });
  // Transpile only untouched installed declarations/callbacks; no rewrite or
  // fabricated expected-detail injection. Both functions run their real Company branches.
  const program = `const ${sync.getText(ast)}; globalThis.created = (${created.getText(ast)}); globalThis.sync = ${syncName};`;
  const output = ts.transpileModule(program, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  expect(output.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error)).toEqual([]);
  vm.runInContext(output.outputText, context, { timeout: 2000 });
  return { source, syncText: sync.getText(ast), createdText: created.getText(ast), context, state, detail, list, settings, noLegacy, created: context.created as (detail: Row, timezone: string) => Promise<boolean> };
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live HTTP forbidden"); })));
afterEach(() => vi.unstubAllGlobals());
for (const kind of ["admin", "technician"] as const) describe(`installed ${kind} Company create callback + canonical list equality`, () => {
  it("passes the actual created detail into installed sync, projects version/time/lane and returns true only after matching list", async () => {
    const h = installed(kind);
    expect(h.createdText).toContain("detail.id, detail)");
    expect(await h.created(h.detail, "America/Chicago")).toBe(true);
    expect(h.list).toHaveBeenCalledWith("offline-calendar"); expect(h.settings).toHaveBeenCalledWith("offline-calendar", { requireTimezone: true });
    expect(h.state.jobs[0]).toMatchObject({ id: "42", companyId: 9, updatedAt: h.detail.updatedAt, assignedUserId: 93, startHour: 9, endHour: 10 });
    const position = companyCalendarWeekPosition("2026-12-01", new Date(), "America/Chicago");
    expect(h.state.weekOffset).toBe(position.weekOffset); expect(h.state.selectedDay).toBe(position.dayIndex); expect(h.noLegacy).not.toHaveBeenCalled();
  });
  it.each(["missing", "version", "lane", "start", "end", "cancelled", "foreign", "invalid-slot"])("%s canonical row must not report created visibility or navigate", async (failure) => {
    const h = installed(kind), detail = { ...h.detail }, row = { ...h.detail }, baseline = structuredClone(h.state.jobs);
    if (failure === "version") row.updatedAt = "2026-11-17T18:09:00.000Z";
    if (failure === "lane") row.assignedUserId = 94;
    if (failure === "start") row.scheduledStartAt = "2026-12-01T16:00:00.000Z";
    if (failure === "end") row.scheduledEndAt = "2026-12-01T18:00:00.000Z";
    if (failure === "cancelled") row.status = "cancelled";
    if (failure === "foreign") detail.companyId = 10;
    if (failure === "invalid-slot") detail.scheduledStartAt = null;
    h.list.mockResolvedValue(failure === "missing" ? [] : [row]);
    expect(await h.created(detail, "America/Chicago")).toBe(false); expect(h.state.weekOffset).toBe(2); expect(h.state.selectedDay).toBe(1); expect(h.noLegacy).not.toHaveBeenCalled();
    if (["version", "lane", "start", "end"].includes(failure)) expect(h.state.jobs).toEqual(baseline);
  });
  it("signed scope invalidation while list waits prevents stale true and board publication", async () => {
    const h = installed(kind); let resolve!: (rows: Row[]) => void;
    h.list.mockReturnValueOnce(new Promise<Row[]>((yes) => { resolve = yes; }));
    const pending = h.created(h.detail, "America/Chicago"); h.context.isCurrentCompanyAdd.mockReturnValue(false); resolve([h.detail]);
    expect(await pending).toBe(false); expect(h.state.jobs[0].id).toBe("unrelated"); expect(h.state.weekOffset).toBe(2); expect(h.noLegacy).not.toHaveBeenCalled();
  });
  it("canonical settings from another Company cannot return true", async () => {
    const h = installed(kind); h.settings.mockResolvedValue({ id: 10, timezone: "America/Chicago" });
    await expect(h.created(h.detail, "America/Chicago")).rejects.toThrow("settings could not be verified"); expect(h.state.weekOffset).toBe(2); expect(h.noLegacy).not.toHaveBeenCalled();
  });
  it("equal ISO instants remain accepted; expected version/lane are still required", async () => {
    const h = installed(kind); h.list.mockResolvedValue([{ ...h.detail, scheduledStartAt: "2026-12-01T15:00:00Z", scheduledEndAt: "2026-12-01T16:00:00Z" }]);
    expect(await h.created(h.detail, "America/Chicago")).toBe(true); expect(h.noLegacy).not.toHaveBeenCalled();
  });
});
