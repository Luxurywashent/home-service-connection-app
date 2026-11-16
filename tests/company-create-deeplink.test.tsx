import React, { act, useEffect } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/company-job-creation-storage", async () => {
  const { memoryCreationStorageModule } = await import("./helpers/company-creation-memory-store");
  return memoryCreationStorageModule();
});
import { installPhotoTestDOM, type PhotoTestNode } from "./helpers/company-photo-test-dom";
import { companyCreateJobAllowed, companyCreateJobScope } from "../lib/company-create-job";
import { parseCompanyJobCustomerPrefill } from "../lib/company-job-customer-prefill";
import { companyCalendarDateAtPosition, companyCalendarSlot, companyCalendarWeekPosition } from "../lib/company-calendar";
import type { JobSyncNativeSession } from "../lib/jobsync-mobile-api";

type Screen = "admin" | "general";
const screens = ["admin", "general"] as const;
const sources = Object.fromEntries(screens.map((screen) => [screen, readFileSync(`app/(tabs)/${screen === "admin" ? "admin-schedule" : "schedule"}.tsx`, "utf8")])) as Record<Screen, string>;
function extract(screen: Screen, kind: "variable" | "effect" | "attribute", name: string) {
  const sf = ts.createSourceFile("screen.tsx", sources[screen], ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let found: ts.Node | undefined;
  function walk(node: ts.Node) {
    if (kind === "variable" && ts.isVariableDeclaration(node) && node.name.getText(sf) === name) found = node.initializer;
    if (kind === "effect" && ts.isCallExpression(node) && node.expression.getText(sf) === "useEffect" && node.arguments[0]?.getText(sf).includes(name)) found = node.arguments[0];
    if (kind === "attribute" && ts.isJsxSelfClosingElement(node) && node.tagName.getText(sf) === "CompanyCreateJobSheet") {
      const attribute = node.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === name) as ts.JsxAttribute | undefined;
      if (attribute?.initializer && ts.isJsxExpression(attribute.initializer)) found = attribute.initializer.expression;
    }
    ts.forEachChild(node, walk);
  }
  walk(sf); if (!found) throw new Error(`Missing actual ${screen} ${kind} ${name}`); return found.getText(sf);
}
function execute(source: string, context: Record<string, any>) {
  const code = ts.transpileModule(`const actual = (${source});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), `${code}; return actual;`)(...Object.values(context));
}
const actor = (): JobSyncNativeSession => ({ token: "mock-only-route", portal: "company", user: { id: 100, role: "owner", name: "Owner", email: null },
  company: { id: 9, name: "Company", slug: "unit", logoUrl: null, primaryColor: null, accentColor: null } });
function routeContext() {
  const jobSyncSession = actor();
  return { companyJobMode: true, jobSyncLoading: false, isFocused: true, jobSyncSession, prefillCustomerId: "7" as unknown, prefillCompanyId: "9" as unknown,
    addCompanyScope: companyCreateJobScope(jobSyncSession), companyCreateJobAllowed, parseCompanyJobCustomerPrefill,
    prefillHandledRef: { current: null as string | null }, weekOffset: 0, selectedDay: 2, companyTimezone: "America/Chicago", companyCalendarDateAtPosition,
    setCustomerPrefill: vi.fn(), setAddJobDate: vi.fn(), setAddStartHour: vi.fn(), setAddEndHour: vi.fn(), setStartHour: vi.fn(), setEndHour: vi.fn(), setShowAddDatePicker: vi.fn(), setShowAddModal: vi.fn(),
    prefillFirst: "Spoofed Name", prefillLast: "Spoofed", prefillPhone: "5550000000", prefillEmail: "spoofed@example.test", prefillAddress: "Spoofed Street",
    setAddFirstName: vi.fn(), setAddLastName: vi.fn(), setAddPhone: vi.fn(), setAddEmail: vi.fn(), setAddAddress: vi.fn(),
  };
}
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
let root: ReturnType<typeof createRoot>; let container: PhotoTestNode;
function RouteLifecycle({ screen, context }: { screen: Screen; context: ReturnType<typeof routeContext> }) {
  useEffect(() => execute(extract(screen, "effect", "parseCompanyJobCustomerPrefill"), context)(), [screen, context]);
  return null;
}
async function renderRoute(screen: Screen, context: ReturnType<typeof routeContext>) { await act(async () => root.render(<RouteLifecycle screen={screen} context={context} />)); }
function waiting<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  const document = installPhotoTestDOM(); container = document.createElement("main"); document.body.appendChild(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live transport forbidden")));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe.each(screens)("%s schedule canonical deep link: actual route effect with React lifecycle and mocked setters", (screen) => {
  it("passes only candidate canonical customer/company IDs, never name/contact strings", async () => {
    const context = routeContext(); await renderRoute(screen, context);
    expect(context.setCustomerPrefill).toHaveBeenCalledWith({ customerId: 7, companyId: 9 }); expect(context.setShowAddModal).toHaveBeenCalledOnce();
    expect(context.setAddFirstName).not.toHaveBeenCalled(); expect(context.setAddPhone).not.toHaveBeenCalled(); expect(context.setAddAddress).not.toHaveBeenCalled();
    expect(extract(screen, "attribute", "customerPrefill")).toBe("customerPrefill");
    await renderRoute(screen, { ...context }); expect(context.setShowAddModal).toHaveBeenCalledOnce();
  });
  it.each([undefined, null, "", "07", "7.0", "7e0", "-7", "0", "9007199254740992", ["7"], ["7", "8"], 7.1, {}, true])("ignores invalid customer candidate %j", async (candidate) => {
    const context = routeContext(); context.prefillCustomerId = candidate; await renderRoute(screen, context);
    expect(context.setCustomerPrefill).not.toHaveBeenCalled(); expect(context.setShowAddModal).not.toHaveBeenCalled();
  });
  it.each([undefined, "10", ["9"], "9.0", 0])("ignores missing/foreign/ambiguous company candidate %j", async (company) => {
    const context = routeContext(); context.prefillCompanyId = company; await renderRoute(screen, context); expect(context.setShowAddModal).not.toHaveBeenCalled();
  });
  it.each(["loading", "blurred", "technician", "platform", "token-missing", "user-invalid"])("never opens Company create for %s", async (kind) => {
    const context = routeContext();
    if (kind === "loading") context.jobSyncLoading = true;
    if (kind === "blurred") context.isFocused = false;
    if (kind === "technician") context.jobSyncSession.user.role = "technician";
    if (kind === "platform") context.jobSyncSession.portal = "platform";
    if (kind === "token-missing") context.jobSyncSession.token = "";
    if (kind === "user-invalid") context.jobSyncSession.user.id = 0;
    await renderRoute(screen, context); expect(context.setShowAddModal).not.toHaveBeenCalled();
  });
  it("does not consume pending link before manager auth/focus becomes valid", async () => {
    const context = routeContext(); await renderRoute(screen, { ...context, jobSyncLoading: true });
    await renderRoute(screen, { ...context, isFocused: false }); expect(context.prefillHandledRef.current).toBeNull();
    await renderRoute(screen, context); expect(context.setShowAddModal).toHaveBeenCalledOnce();
  });
  it("scopes consumption to Company identity and honors deliberate fresh customer links", async () => {
    const context = routeContext(); await renderRoute(screen, context);
    await renderRoute(screen, { ...context, prefillCustomerId: "8" }); expect(context.setCustomerPrefill).toHaveBeenLastCalledWith({ customerId: 8, companyId: 9 });
    await renderRoute(screen, { ...context, addCompanyScope: "new-session-scope" }); expect(context.setShowAddModal).toHaveBeenCalledTimes(3);
  });
  it("manual Add clears candidate identity and retains chosen start/end rather than invoking legacy writer", () => {
    const context = { ...routeContext(), isJobSyncCompany: true, captureScreenAction: () => () => true,
      managementActionRef: { current: { mounted: true, focused: true, companyMode: true } },
      calendarScopeRef: { current: { key: "scope", generation: 0 } }, calendarScopeKey: "scope", renderedAddCalendarGeneration: 0 };
    execute(extract(screen, "variable", "openAdd"), context)(9.5, 11);
    expect(context.setCustomerPrefill).toHaveBeenCalledWith(null); expect(context.setShowAddModal).toHaveBeenCalledWith(true);
    if (screen === "general") { expect(context.setStartHour).toHaveBeenCalledWith(9.5); expect(context.setEndHour).toHaveBeenCalledWith(11); }
    expect(context.setAddFirstName).not.toHaveBeenCalled();
  });
  it("retained Company legacy Save handler cannot invoke any local/server writer", () => {
    const persistJobs = vi.fn(); const mutate = vi.fn();
    execute(extract(screen, "variable", screen === "admin" ? "saveAdminJob" : "saveJob"), { companyJobMode: true, persistJobs, jobUpsertMutation: { mutate } })();
    expect(persistJobs).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
  });
});

it("admin legacy string effect is isolated from all Company/loading/bridge sessions", () => {
  const effect = extract("admin", "effect", "setAddFirstName(prefillFirst");
  const context = { ...routeContext(), employeeLoading: false, currentEmployee: { employeeId: "legacy" }, hasJobSyncEmployee: false };
  execute(effect, context)(); expect(context.setShowAddModal).not.toHaveBeenCalled();
  execute(effect, { ...context, companyJobMode: false, jobSyncLoading: true })(); expect(context.setShowAddModal).not.toHaveBeenCalled();
  execute(effect, { ...context, companyJobMode: false, jobSyncSession: null, hasJobSyncEmployee: true })(); expect(context.setShowAddModal).not.toHaveBeenCalled();
});

it.each(["scope", "generation", "blur"])("retained admin Add cannot open after %s changed", (kind) => {
  const context = { ...routeContext(), managementActionRef: { current: { mounted: true, focused: kind !== "blur", companyMode: true } },
    calendarScopeRef: { current: { key: kind === "scope" ? "new-company" : "scope", generation: kind === "generation" ? 1 : 0 } },
    calendarScopeKey: "scope", renderedAddCalendarGeneration: 0 };
  execute(extract("admin", "variable", "openAdd"), context)(); expect(context.setShowAddModal).not.toHaveBeenCalled();
});

const detail = { id: 84, companyId: 9, customerId: 7, customerName: "Actual Customer", assignedUserId: null, serviceName: "Service", title: "Service", amount: 125,
  status: "scheduled", scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T17:00:00.000Z" };
function loaderContext(screen: Screen) {
  let active = true;
  const context = { ...routeContext(), isJobSyncCompany: true, authLoading: false, employee: null, captureScreenAction: () => () => active,
    companyScheduleSessionRef: { current: "mock-only-route" }, scheduleReadEpochRef: { current: 0 }, companyCalendarReadEpochRef: { current: 0 },
    legacyMediaSessionRef: { current: { focusGeneration: 3 } }, managementActionRef: { current: { mounted: true, focused: true } }, calendarScopeRef: { current: { key: "scope", generation: 0 } },
    calendarScopeKey: "scope", canonicalCalendarScopeRef: { current: null as string | null }, canonicalCalendarKey: "canonical-scope", selectedCity: "crestview", selectedLocation: "crestview",
    companyCalendarSlot, companyCalendarWeekPosition, setCompanyTimezone: vi.fn(), setJobs: vi.fn(), setIsSyncing: vi.fn(), setCompanyCalendarError: vi.fn(),
    getJobSyncCompanyJobs: vi.fn(async () => [detail]), getJobSyncCompanySettings: vi.fn(async () => ({ id: 9, name: "Company", timezone: "America/Chicago" })),
  };
  const fn = execute(extract(screen, "variable", screen === "admin" ? "syncCompanyJobs" : "syncServerJobs"), context);
  const read = (accepted = 84, current: () => boolean = () => active) => screen === "admin" ? fn(current, accepted) : fn("crestview", null, current, accepted);
  return { context, read, stale: () => { active = false; } };
}
describe.each(screens)("%s actual canonical loader: mocked read/settings acknowledgment", (screen) => {
  it("awaits both actual list and settings and only acknowledges accepted canonical ID visible in mapping", async () => {
    const h = loaderContext(screen); const settings = waiting<any>(); h.context.getJobSyncCompanySettings.mockReturnValueOnce(settings.promise);
    const reading = h.read(); await Promise.resolve(); expect(h.context.setJobs).not.toHaveBeenCalled();
    settings.resolve({ id: 9, name: "Company", timezone: "America/Chicago" }); expect(await reading).toBe(true);
    expect(h.context.setJobs).toHaveBeenCalledWith([expect.objectContaining({ id: "84", companyId: 9, startHour: 9, endHour: 11 })]);
    expect(h.context.getJobSyncCompanySettings).toHaveBeenCalledWith("mock-only-route", { requireTimezone: true });
  });
  it.each(["missing", "cancelled", "unmappable"])("does not claim confirmed calendar for %s accepted ID", async (kind) => {
    const h = loaderContext(screen); h.context.getJobSyncCompanyJobs.mockResolvedValue(kind === "missing" ? [] : [{ ...detail, ...(kind === "cancelled" ? { status: "cancelled" } : { scheduledStartAt: null }) }] as any);
    expect(await h.read()).toBe(false);
  });
  it("throws actual refresh error separately without discarding existing mapped calendar", async () => {
    const h = loaderContext(screen); h.context.getJobSyncCompanyJobs.mockRejectedValue(new Error("Mock list unavailable"));
    await expect(h.read()).rejects.toThrow("Mock list unavailable"); expect(h.context.setJobs).not.toHaveBeenCalled();
    expect(h.context.setCompanyCalendarError).toHaveBeenLastCalledWith(expect.stringContaining("Could not refresh"));
  });
  it("rejects wrong-Company settings before publication", async () => {
    const h = loaderContext(screen); h.context.getJobSyncCompanySettings.mockResolvedValue({ id: 10, name: "Other", timezone: "America/Chicago" });
    await expect(h.read()).rejects.toThrow("could not be verified"); expect(h.context.setJobs).not.toHaveBeenCalled(); expect(h.context.setCompanyTimezone).not.toHaveBeenCalled();
  });
  it.each(["form", "scope-generation", "blur"])("suppresses stale %s publication after await", async (kind) => {
    const h = loaderContext(screen); const jobs = waiting<any>(); h.context.getJobSyncCompanyJobs.mockReturnValueOnce(jobs.promise); const reading = h.read();
    if (kind === "form") h.stale();
    if (kind === "scope-generation") { h.context.calendarScopeRef.current.generation++; h.context.legacyMediaSessionRef.current.focusGeneration++; }
    if (kind === "blur") { h.context.managementActionRef.current.focused = false; h.stale(); }
    jobs.resolve([detail]); expect(await reading).toBe(false); expect(h.context.setJobs).not.toHaveBeenCalled(); expect(h.context.setCompanyTimezone).not.toHaveBeenCalled();
  });
});

describe.each(screens)("%s actual sheet completion callback", (screen) => {
  function callbackContext() {
    let current = true; const refresh = vi.fn(async () => true);
    const context = { jobSyncSession: actor(), isCurrentCompanyAdd: () => current, companyCalendarSlot, companyCalendarWeekPosition,
      syncCompanyJobs: refresh, syncServerJobs: refresh, employee: null, selectedLocation: "crestview", cityToSlug: (city: string) => city,
      setWeekOffset: vi.fn(), setSelectedDay: vi.fn(), setShowAddModal: vi.fn(), setCompanyTimezone: vi.fn() };
    return { context, refresh, fn: execute(extract(screen, "attribute", "onCreated"), context), stale: () => { current = false; } };
  }
  it("returns true only after real loader confirmation and does not close midawait", async () => {
    const h = callbackContext(); const refresh = waiting<boolean>(); h.refresh.mockReturnValueOnce(refresh.promise);
    const created = h.fn(detail, "America/Chicago"); expect(h.context.setShowAddModal).not.toHaveBeenCalled(); expect(h.context.setWeekOffset).not.toHaveBeenCalled();
    refresh.resolve(true); expect(await created).toBe(true); expect(h.context.setWeekOffset).toHaveBeenCalledOnce(); expect(h.context.setShowAddModal).not.toHaveBeenCalled();
  });
  it("false refresh remains saved and no navigation/close occurs", async () => {
    const h = callbackContext(); h.refresh.mockResolvedValueOnce(false); expect(await h.fn(detail, "America/Chicago")).toBe(false);
    expect(h.context.setWeekOffset).not.toHaveBeenCalled(); expect(h.context.setShowAddModal).not.toHaveBeenCalled();
  });
  it("late refresh cannot navigate or close a new form", async () => {
    const h = callbackContext(); const refresh = waiting<boolean>(); h.refresh.mockReturnValueOnce(refresh.promise); const created = h.fn(detail, "America/Chicago");
    h.stale(); refresh.resolve(true); expect(await created).toBe(false); expect(h.context.setWeekOffset).not.toHaveBeenCalled(); expect(h.context.setShowAddModal).not.toHaveBeenCalled();
  });
  it("wrong Company callback does not trigger any refresh", async () => {
    const h = callbackContext(); expect(await h.fn({ ...detail, companyId: 10 }, "America/Chicago")).toBe(false); expect(h.refresh).not.toHaveBeenCalled();
  });
});
