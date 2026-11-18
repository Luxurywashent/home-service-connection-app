import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/company-job-creation-storage", async () => {
  const { memoryCreationStorageModule } = await import("./helpers/company-creation-memory-store");
  return memoryCreationStorageModule();
});
import { companyCalendarDateAtPosition, companyCalendarSlot, companyCalendarWeekPosition } from "../lib/company-calendar";
import { companyCreateJobAllowed } from "../lib/company-create-job";
import type { JobSyncNativeSession } from "../lib/jobsync-mobile-api";
function source(role: "admin" | "technician") { return readFileSync(role === "admin" ? "app/(tabs)/admin-schedule.tsx" : "app/(tabs)/schedule.tsx", "utf8"); }
function expression(text: string, name: string) {
  const sf = ts.createSourceFile("screen.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let found: ts.VariableDeclaration | undefined;
  const walk = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(sf) === name) found = n; ts.forEachChild(n, walk); }; walk(sf);
  if (!found?.initializer) throw new Error("Missing actual screen handler"); return found.initializer.getText(sf);
}
function callback(text: string, name: string) {
  const sf = ts.createSourceFile("screen.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let found: ts.JsxAttribute | undefined;
  const walk = (n: ts.Node) => { if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(sf) === "CompanyCreateJobSheet") found = n.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(sf) === name) as ts.JsxAttribute; ts.forEachChild(n, walk); }; walk(sf);
  const init = found?.initializer; if (!init || !ts.isJsxExpression(init) || !init.expression) throw new Error("Missing Company form callback"); return init.expression.getText(sf);
}
function execute(text: string, context: Record<string, any>) {
  const code = ts.transpileModule(`const fn=(${text});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), `${code};return fn;`)(...Object.values(context));
}
const actor: JobSyncNativeSession = { token: "routing-fixture", portal: "company", user: { id: 14, role: "owner", name: "Owner", email: null }, company: { id: 9, name: "Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } };
const detail = { id: 91, companyId: 9, scheduledStartAt: "2026-11-20T15:00:00Z", scheduledEndAt: "2026-11-20T17:00:00Z" };
function openContext() {
  return { companyJobMode: true, jobSyncLoading: false, isFocused: true, jobSyncSession: actor, companyCreateJobAllowed,
    managementActionRef: { current: { mounted: true, focused: true, companyMode: true } },
    calendarScopeRef: { current: { key: "scope", generation: 2 } }, calendarScopeKey: "scope", renderedAddCalendarGeneration: 2,
    weekOffset: 0, selectedDay: 2, companyTimezone: "America/Chicago", companyCalendarDateAtPosition,
    setCustomerPrefill: vi.fn(), setAddJobDate: vi.fn(), setAddStartHour: vi.fn(), setAddEndHour: vi.fn(), setShowAddModal: vi.fn() };
}
function refreshContext() {
  return { isCurrentCompanyAdd: vi.fn(() => true), jobSyncSession: actor, companyCalendarSlot, companyCalendarWeekPosition,
    syncCompanyJobs: vi.fn(async () => true), setWeekOffset: vi.fn(), setSelectedDay: vi.fn(), setShowAddModal: vi.fn() };
}
describe("actual screen Company Add Job isolation", () => {
  it.each(["admin", "technician"] as const)("keeps legacy New Job hidden in Company %s mode", role => {
    const text = source(role); expect(text).toContain("{companyJobMode && showAddModal && <CompanyCreateJobSheet"); expect(text).toContain("visible={showAddModal && !companyJobMode}"); expect(text).toContain("key={addSheetEpoch}"); expect(text).toContain("addSheetEpochRef.current++");
    const section = text.slice(text.indexOf("{companyJobMode && showAddModal && <CompanyCreateJobSheet"), text.indexOf("<Modal visible={showAddModal && !companyJobMode}"));
    for (const forbidden of ["Date.now", "persistJobs", "jobUpsertMutation", "notifyCustomer", "createRecurring"]) expect(section).not.toContain(forbidden);
  });
  it.each(["admin", "technician"] as const)("denies retained legacy save in Company %s mode before local or server writes", role => {
    const persistJobs = vi.fn(); const jobUpsertMutation = { mutate: vi.fn() };
    execute(expression(source(role), role === "admin" ? "saveAdminJob" : "saveJob"), { companyJobMode: true, persistJobs, jobUpsertMutation })();
    expect(persistJobs).not.toHaveBeenCalled(); expect(jobUpsertMutation.mutate).not.toHaveBeenCalled();
  });
  it("opens signed Company admin creation with selected Company day and no name autoassignment", () => {
    const context = openContext(); execute(expression(source("admin"), "openAdd"), context)();
    expect(context.setShowAddModal).toHaveBeenCalledWith(true); expect(context.setCustomerPrefill).toHaveBeenCalledWith(null);
    expect(context.setAddJobDate).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });
  it.each(["technician", "platform_owner"])("denies Company creation to non-manager %s", role => {
    const context = openContext(); context.jobSyncSession = { ...actor, user: { ...actor.user, role: role as typeof actor.user.role } };
    execute(expression(source("admin"), "openAdd"), context)(); expect(context.setShowAddModal).not.toHaveBeenCalled();
  });
  it("awaits canonical admin list refresh before selecting the saved day and does not close mid-callback", async () => {
    const context = refreshContext(); let resolve!: (value: boolean) => void;
    context.syncCompanyJobs.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; }));
    const fn = execute(callback(source("admin"), "onCreated"), context); const pending = fn(detail, "America/Chicago");
    expect(context.setSelectedDay).not.toHaveBeenCalled(); expect(context.setShowAddModal).not.toHaveBeenCalled();
    resolve(true); expect(await pending).toBe(true); expect(context.syncCompanyJobs).toHaveBeenCalledWith(context.isCurrentCompanyAdd, 91, detail, undefined);
    expect(context.setSelectedDay).toHaveBeenCalledWith(4); expect(context.setShowAddModal).not.toHaveBeenCalled();
    context.isCurrentCompanyAdd.mockReturnValue(false); expect(await fn(detail, "America/Chicago")).toBe(false); expect(context.syncCompanyJobs).toHaveBeenCalledTimes(1);
  });
  it("wrong Company never refreshes or navigates another calendar", async () => {
    const context = refreshContext(); context.jobSyncSession = { ...actor, company: { ...actor.company!, id: 10 } };
    expect(await execute(callback(source("admin"), "onCreated"), context)(detail, "America/Chicago")).toBe(false); expect(context.syncCompanyJobs).not.toHaveBeenCalled();
  });
});
