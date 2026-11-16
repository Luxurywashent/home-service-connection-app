import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { companyCalendarDateAtPosition, companyCalendarSlot, companyCalendarWeekPosition } from "../lib/company-calendar";
function source(role: "admin" | "technician") { return readFileSync(role === "admin" ? "app/(tabs)/admin-schedule.tsx" : "app/(tabs)/schedule.tsx", "utf8"); }
function expression(text: string, name: string) {
 const sf = ts.createSourceFile("screen.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);let found: ts.VariableDeclaration | undefined;
 const walk = (n: ts.Node) => { if (ts.isVariableDeclaration(n) && n.name.getText(sf) === name) found = n; ts.forEachChild(n, walk); };walk(sf);
 if (!found?.initializer) throw new Error("Missing actual screen handler");return found.initializer.getText(sf);
}
function callback(text: string, name: string) {
 const sf = ts.createSourceFile("screen.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);let found: ts.JsxAttribute | undefined;
 const walk = (n: ts.Node) => { if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(sf) === "CompanyCreateJobSheet") found = n.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(sf) === name) as ts.JsxAttribute; ts.forEachChild(n, walk); };walk(sf);
 const init = found?.initializer;if (!init || !ts.isJsxExpression(init) || !init.expression) throw new Error("Missing Company form callback");return init.expression.getText(sf);
}
function execute(text: string, context: Record<string, any>) { const code=ts.transpileModule(`const fn=(${text});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;return new Function(...Object.keys(context),`${code};return fn;`)(...Object.values(context)); }
const detail = { id: 91, companyId: 9, scheduledStartAt: "2026-11-20T15:00:00Z", scheduledEndAt: "2026-11-20T17:00:00Z" };
describe("actual screen Company Add Job isolation",()=>{
 it.each(["admin","technician"] as const)("keeps legacy New Job hidden in Company %s mode",role=>{
  const text=source(role);expect(text).toContain("{companyJobMode && showAddModal && <CompanyCreateJobSheet");expect(text).toContain("visible={showAddModal && !companyJobMode}");expect(text).toContain("key={addSheetEpoch}");expect(text).toContain("addSheetEpochRef.current++");
  const section=text.slice(text.indexOf("{companyJobMode && showAddModal && <CompanyCreateJobSheet"),text.indexOf("<Modal visible={showAddModal && !companyJobMode}"));for(const no of ["Date.now", "persistJobs", "jobUpsertMutation", "notifyCustomer", "createRecurring"])expect(section).not.toContain(no);
 });
 it.each(["admin","technician"] as const)("denies retained legacy save in Company %s mode before local or server writes",role=>{
  const persistJobs=vi.fn();const jobUpsertMutation={mutate:vi.fn()};const fn=execute(expression(source(role),role==="admin"?"saveAdminJob":"saveJob"),{companyJobMode:true,persistJobs,jobUpsertMutation});fn();expect(persistJobs).not.toHaveBeenCalled();expect(jobUpsertMutation.mutate).not.toHaveBeenCalled();
 });
 it("opens the Company admin form without any legacy technician-name autoassignment",()=>{
  const context={companyJobMode:true,isJobSyncCompany:true,jobSyncLoading:false,isFocused:true,jobSyncSession:{company:{id:9},user:{role:"owner"}},weekOffset:0,selectedDay:2,companyTimezone:"America/Chicago",companyCalendarDateAtPosition,setAddJobDate:vi.fn(),setAddStartHour:vi.fn(),setAddEndHour:vi.fn(),setShowAddModal:vi.fn()};execute(expression(source("admin"),"openAdd"),context)();expect(context.setShowAddModal).toHaveBeenCalledWith(true);expect(context.setAddJobDate).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
 });
 it.each(["technician","platform_owner"])("does not let a non-manager %s open Company admin creation",role=>{const setShowAddModal=vi.fn();execute(expression(source("admin"),"openAdd"),{companyJobMode:true,isJobSyncCompany:true,jobSyncLoading:false,isFocused:true,jobSyncSession:{company:{id:9},user:{role}},setShowAddModal})();expect(setShowAddModal).not.toHaveBeenCalled();});
 it("verified admin create callback selects the saved Company day and refreshes the canonical list",()=>{
  const ref={current:5};const ctx={addSheetEpochRef:ref,addSheetEpoch:5,managementActionRef:{current:{mounted:true,focused:true,companyMode:true}},calendarScopeRef:{current:{key:"scope"}},calendarScopeKey:"scope",jobSyncSession:{company:{id:9}},companyCalendarSlot,companyCalendarWeekPosition,setCompanyTimezone:vi.fn(),setWeekOffset:vi.fn(),setSelectedDay:vi.fn(),setShowAddModal:vi.fn(),forceSync:vi.fn()};const fn=execute(callback(source("admin"),"onCreated"),ctx);fn(detail,"America/Chicago");expect(ctx.setSelectedDay).toHaveBeenCalledWith(4);expect(ctx.setCompanyTimezone).toHaveBeenCalledWith("America/Chicago");expect(ctx.forceSync).toHaveBeenCalledOnce();ref.current++;fn(detail,"America/Chicago");expect(ctx.forceSync).toHaveBeenCalledOnce();
 });
 it("wrong Company or closed admin sheet cannot update another calendar",()=>{const forceSync=vi.fn();const ctx={addSheetEpochRef:{current:5},addSheetEpoch:5,managementActionRef:{current:{mounted:true,focused:true,companyMode:true}},calendarScopeRef:{current:{key:"scope"}},calendarScopeKey:"scope",jobSyncSession:{company:{id:10}},forceSync};execute(callback(source("admin"),"onCreated"),ctx)(detail,"America/Chicago");expect(forceSync).not.toHaveBeenCalled();});
});
