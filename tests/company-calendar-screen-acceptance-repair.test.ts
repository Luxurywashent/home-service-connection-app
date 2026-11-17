import React, { act } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM } from "./helpers/company-photo-test-dom";
import { useCompanyJobOperation } from "../hooks/use-company-job-operation";
import {
  companyCalendarSlot,
  companyCalendarWeekPosition,
} from "../lib/company-calendar";
import {
  createCompanyJobScheduleUpdateController,
  companyJobScheduleWriteBlocked,
} from "../lib/company-job-schedule-update";
import {
  positiveJobSyncId,
  updateJobSyncCompanyJobSchedule,
  type JobSyncNativeSession,
} from "../lib/jobsync-mobile-api";

const api = vi.hoisted(() => ({
  session: vi.fn(),
  detail: vi.fn(),
  settings: vi.fn(),
  list: vi.fn(),
  assignment: vi.fn(),
}));
vi.mock("../lib/jobsync-mobile-api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getJobSyncMobileSession: api.session,
  getJobSyncCompanyJobDetail: api.detail,
  getJobSyncCompanySettings: api.settings,
  getJobSyncCompanyJobs: api.list,
  updateJobSyncCompanyJobAssignment: api.assignment,
}));

const screenPath = new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url);
const screenSource = readFileSync(screenPath, "utf8");
const tree = ts.createSourceFile(
  screenPath.pathname,
  screenSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function nodes(
  predicate: (node: ts.Node) => boolean,
  root: ts.Node = tree,
): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}
function declaration(name: string) {
  const found = nodes(
    (node) =>
      (ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name) ||
      (ts.isFunctionDeclaration(node) && node.name?.text === name),
  );
  if (found.length !== 1)
    throw new Error(
      `Expected exactly one actual declaration: ${name} (${found.length})`,
    );
  return ts.isFunctionDeclaration(found[0])
    ? found[0].getText(tree)
    : `const ${found[0].getText(tree)};`;
}
function jsxCallback(prop: string, contains: string) {
  const found = nodes(
    (node) =>
      ts.isJsxAttribute(node) &&
      node.name.getText(tree) === prop &&
      !!node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      !!node.initializer.expression &&
      node.initializer.expression.getText(tree).includes(contains),
  );
  if (found.length !== 1)
    throw new Error(
      `Expected one actual ${prop} callback containing ${contains}`,
    );
  const value = (found[0] as ts.JsxAttribute).initializer as ts.JsxExpression;
  return value.expression!.getText(tree);
}
function run(code: string, context: vm.Context) {
  const js = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  vm.runInContext(js, context, { timeout: 2000 });
}
const scopeNode = nodes(
  (node) =>
    ts.isVariableDeclaration(node) &&
    ts.isObjectBindingPattern(node.name) &&
    node.name.getText(tree).includes("isCurrentCompanyJobOperation"),
)[0] as ts.VariableDeclaration;
if (!scopeNode) throw new Error("Missing actual parent operation scope");
const readbackEffect = nodes(
  (node) =>
    ts.isCallExpression(node) &&
    node.expression.getText(tree) === "useLayoutEffect" &&
    node.arguments[0]
      ?.getText(tree)
      .includes("syncCompanyEditedJobRef.current ="),
)[0] as ts.CallExpression;
if (!readbackEffect)
  throw new Error("Missing actual edited-list readback effect");
const nativeRequire = createRequire(import.meta.url);
const { createRoot } = nativeRequire("react-dom/client") as {
  createRoot: (container: unknown) => {
    render: (node: React.ReactNode) => void;
    unmount: () => void;
  };
};
const roots: ReturnType<typeof createRoot>[] = [];
function denied() {
  throw new Error("Unmocked I/O forbidden in calendar acceptance test");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function flush() {
  for (let i = 0; i < 32; i++) await Promise.resolve();
}
let sequence = 270000;
type Row = Record<string, any>;
async function fixture(selected = false) {
  const id = ++sequence;
  const session: JobSyncNativeSession = {
    token: `offline-calendar-screen-${id}`,
    portal: "company",
    user: { id: 40, role: "owner", name: "Owner", email: null },
    company: {
      id: 9,
      name: "Fixture Company",
      slug: "fixture",
      logoUrl: null,
      primaryColor: null,
      accentColor: null,
    },
  };
  let canonical: Row = {
    id,
    companyId: 9,
    customerId: 7,
    assignedUserId: 50,
    assignedName: "Original member",
    updatedAt: "2026-11-17T15:00:00.000Z",
    scheduledStartAt: "2026-12-01T15:00:00.000Z",
    scheduledEndAt: "2026-12-01T17:00:00.000Z",
    status: "scheduled",
    customerName: "Canonical Customer",
    serviceName: "Canonical Service",
    title: "Service",
    amount: 125,
    addressLine1: "Canonical address",
    photos: [],
  };
  const baseline: Row = {
    id: String(id),
    companyId: 9,
    customerId: "7",
    assignedUserId: 50,
    assignedTo: "jobsync-50",
    detailerName: "Original member",
    updatedAt: canonical.updatedAt,
    companyDate: "2026-12-01",
    startHour: 9,
    endHour: 11,
    dayIndex: 1,
    weekOffset: 2,
    location: "crestview",
    firstName: "Canonical",
    lastName: "Customer",
    privateNotes: "Keep unrelated detail fields",
  };
  const events: string[] = [];
  const settings = {
    id: 9,
    name: "Fixture Company",
    timezone: "America/Chicago",
  };
  api.session.mockImplementation(async () => {
    events.push("session GET");
    return structuredClone(session);
  });
  api.detail.mockImplementation(async () => {
    events.push("detail GET");
    return structuredClone(canonical);
  });
  api.settings.mockImplementation(async () => {
    events.push("settings GET");
    return { ...settings };
  });
  api.list.mockImplementation(async () => {
    events.push("list GET");
    return [structuredClone(canonical)];
  });
  const http = vi.fn(
    async (
      url: string,
      init: RequestInit,
    ): Promise<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }> => {
      if (
        !url.endsWith(`/api/mobile/v1/company/jobs/${id}/schedule`) ||
        init.method !== "PATCH"
      )
        denied();
      events.push("schedule PATCH");
      const input = JSON.parse(String(init.body));
      canonical = {
        ...canonical,
        ...input,
        assignedName:
          input.assignedUserId === 60 ? "New member" : "Original member",
        updatedAt: "2026-11-17T15:01:00.000Z",
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          jobId: id,
          scheduledStartAt: input.scheduledStartAt,
          scheduledEndAt: input.scheduledEndAt,
          assignedUserId: input.assignedUserId,
        }),
      };
    },
  );
  vi.stubGlobal("fetch", http);
  const epochSource = readFileSync(
    new URL("../hooks/use-company-job-operation.ts", import.meta.url),
    "utf8",
  );
  const epochTree = ts.createSourceFile(
    "operation.ts",
    epochSource,
    ts.ScriptTarget.Latest,
    true,
  );
  const epochNode = epochTree.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "createOperationEpoch",
  )!;
  const epochContext = vm.createContext({});
  run(
    `${epochNode.getText(epochTree)}; globalThis.memory = createOperationEpoch();`,
    epochContext,
  );
  const memory = epochContext.memory;
  const state: Row = {
    jobs: [{ ...baseline }],
    selectedJob: selected ? { ...baseline } : null,
    error: null,
    timezone: null,
    editingTime: true,
    picker: true,
    weekOffset: 2,
    selectedDay: 1,
  };
  const set = (key: string) =>
    vi.fn((value: any) => {
      state[key] = typeof value === "function" ? value(state[key]) : value;
    });
  const managementActionRef = {
    current: {
      key: "rendered-management",
      generation: 0,
      companyMode: true,
      mounted: true,
      focused: true,
    },
  };
  const boundary = {
    isCurrent: vi.fn(() => true),
    verifyAssignment: vi.fn(async () => true),
  };
  const context = vm.createContext({
    React,
    useCallback: (fn: unknown) => fn,
    useCompanyJobOperation,
    companyJobOperationEpoch: memory,
    invalidateCompanyJobOperation: memory.invalidate,
    employeeLoading: false,
    jobSyncLoading: false,
    companyJobMode: true,
    hasJobSyncEmployee: true,
    currentEmployee: null,
    legacyToken: null,
    legacyTokenReady: false,
    isFocused: true,
    managementActionKey: "rendered-management",
    managementActionRef,
    calendarScopeKey: "calendar-scope",
    calendarScopeRef: { current: { key: "calendar-scope", generation: 0 } },
    sheetEpochRef: { current: 0 },
    invoiceEpochRef: { current: 0 },
    checkoutEpochRef: { current: 0 },
    invoiceSessionRef: { current: { key: "invoice-identity", generation: 0 } },
    invoiceIdentityKey: "invoice-identity",
    companyFieldworkCalendarRef: { current: boundary },
    pendingCalendarReviewRef: { current: null },
    syncCompanyEditedJobRef: { current: null },
    companyCalendarReadEpochRef: { current: 0 },
    canonicalCalendarScopeRef: { current: null },
    canonicalCalendarKey: "canonical-key",
    calendarGestureLockRef: { current: false },
    jobSyncSession: session,
    isJobSyncCompany: true,
    selectedCity: "crestview",
    weekOffset: 2,
    companyCalendarLanes: [
      { employeeId: "jobsync-50", name: "Original member" },
      { employeeId: "jobsync-60", name: "New member" },
    ],
    dynamicDetailers: {},
    FALLBACK_DETAILERS: {},
    CITY_LIST: [{ slug: "crestview", label: "Crestview" }],
    HOURS: [0, 24],
    renderedLegacyAction: Object.assign(
      vi.fn(() => false),
      { verify: vi.fn(async () => false) },
    ),
    jobUpsertMutation: { mutate: vi.fn(denied), mutateAsync: vi.fn(denied) },
    jobReassignMutation: { mutate: vi.fn(denied), mutateAsync: vi.fn(denied) },
    companyJob: {
      refresh: vi.fn(async () => {
        events.push("selected detail hook refresh");
      }),
    },
    createCompanyJobScheduleUpdateController,
    companyJobScheduleWriteBlocked,
    positiveJobSyncId,
    updateJobSyncCompanyJobSchedule,
    getJobSyncCompanyJobDetail: api.detail,
    getJobSyncCompanyJobs: api.list,
    getJobSyncCompanySettings: api.settings,
    companyCalendarSlot,
    companyCalendarWeekPosition,
    setJobs: set("jobs"),
    setSelectedJobState: set("selectedJob"),
    setCompanyCalendarError: set("error"),
    setCompanyTimezone: set("timezone"),
    setIsSyncing: vi.fn(),
    setAdminEditingTime: set("editingTime"),
    setShowReassignPicker: set("picker"),
    setWeekOffset: set("weekOffset"),
    setSelectedDay: set("selectedDay"),
    isCurrentCompanyAdd: vi.fn(() => true),
    d: { name: "New member", employeeId: "jobsync-60" },
    Alert: { alert: vi.fn() },
    AsyncStorage: { setItem: vi.fn(denied) },
    fetch: denied,
    require: denied,
    process: { env: Object.freeze({}) },
    console: { error: vi.fn() },
    Date,
    Intl,
    Error,
  });
  Object.defineProperties(context, {
    jobs: { get: () => state.jobs },
    selectedJob: { get: () => state.selectedJob },
  });
  // Commit the real operation hook against the actual AST-extracted parent scope factory.
  // Local captures preserve a render's identity rather than rebinding a retained closure.
  run(
    `globalThis.HookHost = function HookHost() {
    const managementActionKey = globalThis.managementActionKey;
    const ${scopeNode.getText(tree)};
    globalThis.isCurrentCompanyJobOperation = isCurrentCompanyJobOperation;
    return null;
  };`,
    context,
  );
  const doc = installPhotoTestDOM();
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(React.createElement(context.HookHost));
  });
  const names = [
    "companyUserId",
    "getWeekDates",
    "localDateStr",
    "setSelectedJob",
    "persistCompanyCalendarChange",
    "syncCompanyJobs",
    "refreshCompanyCalendarReview",
    "saveCompanyCalendarChange",
    "adminSaveTime",
    "handleMoveAdminJob",
    "handleResizeAdminJob",
  ];
  run(
    `(() => { const isCurrentCompanyJobOperation = globalThis.isCurrentCompanyJobOperation;\n` +
      names.map(declaration).join("\n") +
      `\n(${readbackEffect.arguments[0].getText(tree)})();
    globalThis.callbacks = { ${names.join(",")}, reassign: (${jsxCallback("onPress", "newAssignedTo: d.name")}), created: (${jsxCallback("onCreated", "syncCompanyJobs")}) }; })();`,
    context,
  );
  return {
    id,
    session,
    baseline,
    state,
    context,
    events,
    http,
    settings,
    boundary,
    memory,
    callbacks: context.callbacks as Record<
      string,
      (...args: any[]) => Promise<any>
    >,
    canonical: () => canonical,
    patchCanonical: (patch: Row) => {
      canonical = { ...canonical, ...patch };
    },
    next: (patch: Row = {}) => ({
      ...baseline,
      startHour: 10,
      endHour: 12,
      assignedTo: "jobsync-60",
      detailerName: "New member",
      ...patch,
    }),
    body: () => JSON.parse(String(http.mock.calls[0]?.[1].body)),
    invalidate: (kind: string) => {
      if (kind === "focus") managementActionRef.current.focused = false;
      else if (kind === "scope") {
        managementActionRef.current.generation++;
        managementActionRef.current.key = "new-scope";
      } else if (kind === "calendar")
        context.calendarScopeRef.current.generation++;
      else {
        context.callbacks.setSelectedJob(null);
        context.callbacks.setSelectedJob({ ...baseline });
      }
    },
  };
}
beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  vi.stubGlobal("fetch", vi.fn(denied));
});
afterEach(async () => {
  await act(async () => {
    roots.splice(0).forEach((root) => root.unmount());
  });
  vi.unstubAllGlobals();
});

function noSeparateWrite(h: Awaited<ReturnType<typeof fixture>>) {
  expect(api.assignment).not.toHaveBeenCalled();
  expect(h.context.jobReassignMutation.mutate).not.toHaveBeenCalled();
  expect(h.context.jobReassignMutation.mutateAsync).not.toHaveBeenCalled();
  expect(h.context.jobUpsertMutation.mutate).not.toHaveBeenCalled();
  expect(h.context.jobUpsertMutation.mutateAsync).not.toHaveBeenCalled();
  expect(h.context.AsyncStorage.setItem).not.toHaveBeenCalled();
}

describe("actual parent Company calendar callbacks + real atomic controller + bearer writer", () => {
  it("one combined PATCH carries complete times, lane and expected version; saved follows acknowledged detail and matching list", async () => {
    const h = await fixture(true);
    const result = await h.callbacks.persistCompanyCalendarChange(
      h.baseline,
      h.next(),
    );
    expect(result.status).toBe("saved");
    expect(h.http).toHaveBeenCalledTimes(1);
    expect(h.body()).toEqual({
      scheduledStartAt: "2026-12-01T16:00:00.000Z",
      scheduledEndAt: "2026-12-01T18:00:00.000Z",
      assignedUserId: 60,
      expectedUpdatedAt: h.baseline.updatedAt,
    });
    expect(h.http.mock.calls[0][1]).toMatchObject({
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${h.session.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    expect(api.settings).toHaveBeenCalledWith(h.session.token, {
      requireTimezone: true,
    });
    expect(h.events.indexOf("schedule PATCH")).toBeLessThan(
      h.events.lastIndexOf("detail GET"),
    );
    expect(h.events.indexOf("schedule PATCH")).toBeLessThan(
      h.events.indexOf("list GET"),
    );
    expect(h.events.at(-1)).toBe("selected detail hook refresh");
    expect(h.context.pendingCalendarReviewRef.current).toBeNull();
    expect(h.state.selectedJob).toMatchObject({
      updatedAt: h.canonical().updatedAt,
      assignedUserId: 60,
      assignedTo: "jobsync-60",
      detailerName: "New member",
      companyDate: "2026-12-01",
      startHour: 10,
      endHour: 12,
      privateNotes: "Keep unrelated detail fields",
    });
    expect(h.state.jobs[0]).toMatchObject({
      updatedAt: h.canonical().updatedAt,
      assignedUserId: 60,
      startHour: 10,
      endHour: 12,
    });
    noSeparateWrite(h);
  });
  it("does not settle saved until matching list GET finishes", async () => {
    const h = await fixture(),
      gate = deferred<Row[]>();
    api.list.mockReturnValueOnce(gate.promise);
    let settled = false;
    const saving = h.callbacks
      .persistCompanyCalendarChange(h.baseline, h.next())
      .then((value) => {
        settled = true;
        return value;
      });
    await flush();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    gate.resolve([h.canonical()]);
    expect((await saving).status).toBe("saved");
    noSeparateWrite(h);
  });
  it.each([
    { updatedAt: "2026-11-17T15:00:01.000Z" },
    { assignedUserId: 61 },
    { scheduledStartAt: "2026-12-01T14:00:00.000Z" },
    { scheduledEndAt: "2026-12-01T18:00:00.000Z" },
  ])("fresh canonical conflict %j dispatches no mutation", async (patch) => {
    const h = await fixture();
    h.patchCanonical(patch);
    const result = await h.callbacks.persistCompanyCalendarChange(
      h.baseline,
      h.next(),
    );
    expect(result.status).toBe("conflict");
    expect(h.http).not.toHaveBeenCalled();
    noSeparateWrite(h);
  });
  it.each(["", "Invented/Zone"])(
    "invalid Company timezone %s blocks without fallback or dispatch",
    async (zone) => {
      const h = await fixture();
      h.settings.timezone = zone;
      expect(
        (await h.callbacks.persistCompanyCalendarChange(h.baseline, h.next()))
          .status,
      ).toBe("blocked");
      expect(h.http).not.toHaveBeenCalled();
      noSeparateWrite(h);
    },
  );
  it.each([
    ["2026-03-08", 2.5, 4],
    ["2026-11-01", 1.5, 4],
  ])(
    "DST unsafe %s/%s blocks without dispatch",
    async (date, startHour, endHour) => {
      const h = await fixture();
      const result = await h.callbacks.persistCompanyCalendarChange(
        h.baseline,
        h.next({ companyDate: date, startHour, endHour }),
      );
      expect(result.status).toBe("blocked");
      expect(result.message).toMatch(/clock change/);
      expect(h.http).not.toHaveBeenCalled();
      noSeparateWrite(h);
    },
  );
  it("fresh candidate refusal blocks both time and lane writes", async () => {
    const h = await fixture();
    h.boundary.verifyAssignment.mockResolvedValue(false);
    expect(
      (await h.callbacks.persistCompanyCalendarChange(h.baseline, h.next()))
        .status,
    ).toBe("blocked");
    expect(h.http).not.toHaveBeenCalled();
    noSeparateWrite(h);
  });
  it.each([
    "missing-ack",
    "lost-response-after-commit",
    "wrong-detail-lane",
    "wrong-detail-time",
    "list-version-mismatch",
  ])(
    "%s shows honest banner, no blind retry; only explicit review GET unlocks new edits",
    async (failure) => {
      const h = await fixture(true),
        original = h.http.getMockImplementation()!;
      h.http.mockImplementationOnce(async (...args) => {
        const response = await original(...args);
        if (failure === "lost-response-after-commit")
          throw new Error("Socket lost after commit");
        if (failure === "missing-ack")
          return { ...response, json: async () => ({ success: true }) };
        if (failure === "wrong-detail-lane")
          h.patchCanonical({ assignedUserId: 50 });
        if (failure === "wrong-detail-time")
          h.patchCanonical({ scheduledStartAt: "2026-12-01T17:00:00.000Z" });
        return response;
      });
      if (failure === "list-version-mismatch")
        api.list.mockResolvedValue([
          { ...h.canonical(), updatedAt: "2026-11-17T15:09:00.000Z" },
        ]);
      await h.callbacks.saveCompanyCalendarChange(h.baseline, h.next());
      expect(h.context.Alert.alert).toHaveBeenCalledWith(
        "Schedule save not confirmed",
        expect.stringMatching(/could not be confirmed.*do not resend blindly/i),
      );
      expect(h.http).toHaveBeenCalledTimes(1);
      expect(companyJobScheduleWriteBlocked(h.session, h.id)).toBe(true);
      await h.callbacks.saveCompanyCalendarChange(h.state.jobs[0], h.next());
      expect(h.http).toHaveBeenCalledTimes(1);
      // Incidental GET/list readback must not clear uncertainty or unlock writes.
      api.list.mockImplementation(async () => [h.canonical()]);
      await h.callbacks.syncCompanyJobs(() => true, h.id, h.canonical());
      expect(companyJobScheduleWriteBlocked(h.session, h.id)).toBe(true);
      h.patchCanonical({
        assignedUserId: 60,
        scheduledStartAt: "2026-12-01T16:00:00.000Z",
      });
      const count = h.http.mock.calls.length;
      await h.callbacks.refreshCompanyCalendarReview();
      expect(h.http).toHaveBeenCalledTimes(count);
      expect(companyJobScheduleWriteBlocked(h.session, h.id)).toBe(false);
      expect(h.state.error).toBeNull();
      const fresh = h.state.jobs[0];
      expect(
        (
          await h.callbacks.persistCompanyCalendarChange(fresh, {
            ...fresh,
            startHour: 11,
            endHour: 13,
          })
        ).status,
      ).toBe("saved");
      expect(h.http).toHaveBeenCalledTimes(2);
      expect(
        JSON.parse(String(h.http.mock.calls[1][1].body)).expectedUpdatedAt,
      ).toBe("2026-11-17T15:01:00.000Z");
      noSeparateWrite(h);
    },
  );
  it("failed explicit review keeps unresolved lock and banner, without any write", async () => {
    const h = await fixture();
    h.http.mockRejectedValueOnce(new Error("Unknown commit"));
    await h.callbacks.saveCompanyCalendarChange(h.baseline, h.next());
    const banner = h.state.error;
    api.detail.mockRejectedValue(new Error("GET unavailable"));
    await h.callbacks.refreshCompanyCalendarReview();
    expect(h.state.error).toBe(banner);
    expect(companyJobScheduleWriteBlocked(h.session, h.id)).toBe(true);
    expect(h.http).toHaveBeenCalledTimes(1);
  });
  it("possibly committed write keeps the honest banner visible after automatic canonical GET/list readback", async () => {
    const h = await fixture(),
      original = h.http.getMockImplementation()!;
    h.http.mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error("Socket lost after commit");
    });
    await h.callbacks.saveCompanyCalendarChange(h.baseline, h.next());
    expect(h.context.Alert.alert).toHaveBeenCalledWith(
      "Schedule save not confirmed",
      expect.stringMatching(/do not resend blindly/i),
    );
    expect(companyJobScheduleWriteBlocked(h.session, h.id)).toBe(true);
    expect(
      h.state.error,
      "Automatic list GET must not erase the only explicit review banner while lock remains unresolved",
    ).toEqual(
      expect.stringMatching(/could not be confirmed.*do not resend blindly/i),
    );
  });
  it.each(["token", "tenant", "actor", "role"])(
    "changed fresh signed %s blocks dispatch",
    async (change) => {
      const h = await fixture(),
        fresh = structuredClone(h.session);
      if (change === "token") fresh.token = "changed-token";
      if (change === "tenant") fresh.company!.id = 10;
      if (change === "actor") fresh.user.id = 41;
      if (change === "role") fresh.user.role = "technician";
      api.session.mockResolvedValue(fresh);
      expect(
        (await h.callbacks.persistCompanyCalendarChange(h.baseline, h.next()))
          .status,
      ).toBe("blocked");
      expect(h.http).not.toHaveBeenCalled();
      noSeparateWrite(h);
    },
  );
  it.each(["focus", "scope", "close-reopen"])(
    "actual parent operation guard rejects retained callback after %s before dispatch",
    async (kind) => {
      const h = await fixture(true),
        gate = deferred<JobSyncNativeSession>();
      api.session.mockReturnValueOnce(gate.promise);
      const saving = h.callbacks.persistCompanyCalendarChange(
        h.baseline,
        h.next(),
      );
      await act(async () => {
        h.invalidate(kind);
      });
      gate.resolve(h.session);
      expect((await saving).status).toBe("stale");
      expect(h.http).not.toHaveBeenCalled();
      noSeparateWrite(h);
    },
  );
  it.each(["focus", "scope", "close-reopen"])(
    "%s after dispatched write suppresses stale success and retains review requirement",
    async (kind) => {
      const h = await fixture(true),
        gate = deferred<void>();
      const original = h.http.getMockImplementation()!;
      h.http.mockImplementationOnce(async (...args) => {
        const response = await original(...args);
        await gate.promise;
        return response;
      });
      const saving = h.callbacks.persistCompanyCalendarChange(
        h.baseline,
        h.next(),
      );
      await flush();
      expect(h.http).toHaveBeenCalledTimes(1);
      await act(async () => {
        h.invalidate(kind);
      });
      gate.resolve(undefined);
      expect((await saving).status).toBe("stale");
      expect(companyJobScheduleWriteBlocked(h.session, h.id)).toBe(true);
      expect(api.list).not.toHaveBeenCalled();
      expect(h.state.selectedJob?.updatedAt).toBe(h.baseline.updatedAt);
      noSeparateWrite(h);
    },
  );
  it("duplicate move/resize gestures lock synchronously before auth awaits", async () => {
    const h = await fixture(),
      gate = deferred<JobSyncNativeSession>();
    api.session.mockReturnValueOnce(gate.promise);
    const moving = h.callbacks.handleMoveAdminJob(String(h.id), 10, 1);
    expect(h.context.calendarGestureLockRef.current).toBe(true);
    await h.callbacks.handleMoveAdminJob(String(h.id), 14, 0);
    await h.callbacks.handleResizeAdminJob(String(h.id), 16);
    gate.resolve(h.session);
    await moving;
    expect(h.http).toHaveBeenCalledTimes(1);
    expect(h.body().assignedUserId).toBe(60);
    expect(h.context.calendarGestureLockRef.current).toBe(false);
    noSeparateWrite(h);
  });
  it("an unselected canonical board card can move and reassign through actual callbacks", async () => {
    const h = await fixture();
    expect(h.state.selectedJob).toBeNull();
    await h.callbacks.handleMoveAdminJob(String(h.id), 10, 1);
    expect(h.http).toHaveBeenCalledTimes(1);
    expect(h.state.error).toBeNull();
    expect(h.state.jobs[0]).toMatchObject({
      startHour: 10,
      endHour: 12,
      assignedUserId: 60,
    });
    noSeparateWrite(h);
  });
  it("unselected canonical board card resize preserves lane in the combined request", async () => {
    const h = await fixture();
    await h.callbacks.handleResizeAdminJob(String(h.id), 13);
    expect(h.http).toHaveBeenCalledTimes(1);
    expect(h.body()).toMatchObject({
      assignedUserId: 50,
      scheduledStartAt: "2026-12-01T15:00:00.000Z",
      scheduledEndAt: "2026-12-01T19:00:00.000Z",
    });
    noSeparateWrite(h);
  });
  it("selected time editor must not invalidate its own operation before the atomic write", async () => {
    const h = await fixture(true);
    await act(async () => {
      await h.callbacks.adminSaveTime(h.baseline, 10, 12, "2026-12-01", false);
    });
    expect(
      h.http,
      "Time save must dispatch rather than only painting optimistic times",
    ).toHaveBeenCalledTimes(1);
    expect(h.state.selectedJob).toMatchObject({
      startHour: 10,
      endHour: 12,
      updatedAt: "2026-11-17T15:01:00.000Z",
    });
    noSeparateWrite(h);
  });
  it("actual selected reassign picker must not invalidate itself before the atomic time/lane write", async () => {
    const h = await fixture(true);
    await act(async () => {
      await h.callbacks.reassign();
    });
    expect(
      h.http,
      "Reassignment must dispatch rather than only painting an optimistic lane",
    ).toHaveBeenCalledTimes(1);
    expect(h.state.selectedJob).toMatchObject({
      assignedUserId: 60,
      assignedTo: "jobsync-60",
      updatedAt: "2026-11-17T15:01:00.000Z",
    });
    noSeparateWrite(h);
  });
});

describe("actual ordinary creation and canonical calendar projection preservation", () => {
  it("ordinary onCreated waits for canonical list membership and navigates in Company timezone without another write", async () => {
    const h = await fixture(),
      detail = h.canonical();
    expect(await h.callbacks.created(detail, "America/Chicago")).toBe(true);
    const position = companyCalendarWeekPosition(
      "2026-12-01",
      new Date(),
      "America/Chicago",
    );
    expect(h.state.weekOffset).toBe(position.weekOffset);
    expect(h.state.selectedDay).toBe(position.dayIndex);
    expect(h.state.jobs[0]).toMatchObject({
      updatedAt: detail.updatedAt,
      assignedUserId: 50,
      assignedTo: "jobsync-50",
      companyDate: "2026-12-01",
      startHour: 9,
      endHour: 11,
    });
    expect(h.http).not.toHaveBeenCalled();
    noSeparateWrite(h);
  });
  it.each(["missing", "foreign", "stale-after-list", "invalid-slot"])(
    "creation %s never claims canonical visibility",
    async (failure) => {
      const h = await fixture(),
        detail = { ...h.canonical() };
      if (failure === "missing") api.list.mockResolvedValue([]);
      if (failure === "foreign") detail.companyId = 10;
      if (failure === "invalid-slot") detail.scheduledStartAt = null;
      if (failure === "stale-after-list")
        api.list.mockImplementation(async () => {
          h.context.isCurrentCompanyAdd.mockReturnValue(false);
          return [detail];
        });
      expect(await h.callbacks.created(detail, "America/Chicago")).toBe(false);
      expect(h.state.weekOffset).toBe(2);
      expect(h.http).not.toHaveBeenCalled();
      noSeparateWrite(h);
    },
  );
  it("selected canonical projection preserves unrelated detail fields and cannot overwrite another selected row", async () => {
    const h = await fixture(true);
    h.state.selectedJob = {
      ...h.baseline,
      id: "other",
      privateNotes: "Different row",
    };
    const other = { ...h.state.selectedJob };
    expect(
      await h.callbacks.syncCompanyJobs(() => true, h.id, h.canonical()),
    ).toBe(true);
    expect(h.state.selectedJob).toEqual(other);
    expect(h.http).not.toHaveBeenCalled();
    noSeparateWrite(h);
  });
  it("source wiring exposes explicit review banner and keeps board gesture enablement independent of selected Job identity", () => {
    const review = jsxCallback(
      "onPress",
      "void refreshCompanyCalendarReview()",
    );
    expect(review).toContain("refreshCompanyCalendarReview()");
    expect(screenSource).toContain(
      'accessibilityLabel="Refresh and review Company calendar"',
    );
    const attribute = nodes(
      (node) =>
        ts.isJsxAttribute(node) &&
        node.name.getText(tree) === "gesturesEnabled" &&
        !!node.initializer &&
        node.initializer.getText(tree).includes("showCheckout"),
    );
    expect(attribute).toHaveLength(1);
    expect(attribute[0].getText(tree)).toBe(
      "gesturesEnabled={!selectedJob && !showCheckout}",
    );
    const persist = declaration("persistCompanyCalendarChange");
    expect(persist).toContain("write: updateJobSyncCompanyJobSchedule");
    expect(persist).not.toContain("updateJobSyncCompanyJobAssignment");
    expect(jsxCallback("onCreated", "syncCompanyJobs")).toContain(
      "syncCompanyJobs(isCurrentCompanyAdd, detail.id)",
    );
  });
});

describe("actual tightened refreshCompanyCalendarReview recovery paths", () => {
  it("no pending metadata or selected lock performs ordinary canonical GET/list refresh with no write", async () => {
    const h = await fixture();
    await h.callbacks.refreshCompanyCalendarReview();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(h.state.jobs[0]).toMatchObject({
      id: String(h.id),
      updatedAt: h.baseline.updatedAt,
      startHour: 9,
      endHour: 11,
    });
    expect(api.detail).not.toHaveBeenCalled();
    expect(h.http).not.toHaveBeenCalled();
    noSeparateWrite(h);
  });
  it("same-Company selected locked Job synthesizes read-only review when another Company's metadata replaced the ref", async () => {
    const h = await fixture(true),
      original = h.http.getMockImplementation()!;
    h.http.mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error("Lost committed response");
    });
    expect(
      (await h.callbacks.persistCompanyCalendarChange(h.baseline, h.next()))
        .status,
    ).toBe("uncertain");
    const foreignMetadata = { id: h.id + 1, companyId: 10 };
    h.context.pendingCalendarReviewRef.current = foreignMetadata;
    await h.callbacks.refreshCompanyCalendarReview();
    expect(companyJobScheduleWriteBlocked(h.session, h.id)).toBe(false);
    expect(h.context.pendingCalendarReviewRef.current).toBe(foreignMetadata);
    expect(h.state.error).toBeNull();
    expect(h.http).toHaveBeenCalledTimes(1);
    expect(h.state.selectedJob).toMatchObject({
      updatedAt: "2026-11-17T15:01:00.000Z",
      assignedUserId: 60,
      startHour: 10,
      endHour: 12,
    });
    noSeparateWrite(h);
  });
  it("foreign selected row and foreign pending metadata cannot trigger that Company's detail read or unlock", async () => {
    const h = await fixture(true);
    h.state.selectedJob = { ...h.baseline, companyId: 10 };
    h.context.pendingCalendarReviewRef.current = {
      id: h.id + 1,
      companyId: 10,
    };
    await h.callbacks.refreshCompanyCalendarReview();
    expect(api.detail).not.toHaveBeenCalled();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(h.http).not.toHaveBeenCalled();
    noSeparateWrite(h);
  });
  it("retained refresh callback after blur performs no reads, writes or unlock", async () => {
    const h = await fixture();
    h.context.pendingCalendarReviewRef.current = { id: h.id, companyId: 9 };
    h.invalidate("focus");
    await h.callbacks.refreshCompanyCalendarReview();
    expect(api.session).not.toHaveBeenCalled();
    expect(api.detail).not.toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
    expect(h.http).not.toHaveBeenCalled();
    noSeparateWrite(h);
  });
  it("post-write detail GET failure remains uncertain and never blindly resends", async () => {
    const h = await fixture();
    api.detail
      .mockResolvedValueOnce(h.canonical())
      .mockRejectedValueOnce(new Error("Canonical GET unavailable"));
    expect(
      (await h.callbacks.persistCompanyCalendarChange(h.baseline, h.next()))
        .status,
    ).toBe("uncertain");
    expect(
      (await h.callbacks.persistCompanyCalendarChange(h.baseline, h.next()))
        .status,
    ).toBe("blocked");
    expect(companyJobScheduleWriteBlocked(h.session, h.id)).toBe(true);
    expect(h.http).toHaveBeenCalledTimes(1);
    noSeparateWrite(h);
  });
  it("post-write canonical list GET failure never reports saved", async () => {
    const h = await fixture();
    api.list.mockRejectedValue(new Error("List unavailable"));
    expect(
      (await h.callbacks.persistCompanyCalendarChange(h.baseline, h.next()))
        .status,
    ).toBe("uncertain");
    expect(companyJobScheduleWriteBlocked(h.session, h.id)).toBe(true);
    expect(h.http).toHaveBeenCalledTimes(1);
    noSeparateWrite(h);
  });
});
