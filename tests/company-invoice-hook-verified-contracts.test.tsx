// Connected React + real invoice controller/protected journal + pinned fc3 backend declarations.
// No release mutation, application HTTP, payment provider, or production storage is permitted.
import React, { act, useLayoutEffect } from "react";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCompanyInvoiceOperation } from "../hooks/use-company-invoice-operation";
import {
  createCompanyInvoiceOperationController,
  type CompanyInvoiceOperationControllerOptions,
} from "../lib/company-job-invoice-operation-controller";
import {
  createCompanyInvoiceOperationStore,
  newCompanyInvoiceOperationRecord,
} from "../lib/company-job-invoice-operation-storage";
import {
  captureCompanyInvoiceOperationIntent,
  type CompanyInvoiceOperationContext,
} from "../lib/company-job-invoice-operation";
import {
  assertCompanyJobInvoiceJob,
  assertCompanyJobInvoiceSession,
  captureCompanyJobInvoiceIntent,
  createCompanyJobInvoiceOptions,
} from "../lib/company-job-invoice-intent";
import { companyInvoiceOperationReleaseReady } from "../lib/company-verified-contract-release";
import { invoiceFc3Harness } from "./fixtures/company-invoice-fc3-source";

const mocks = vi.hoisted(() => ({
  appState: "active",
  listeners: new Set<(state: string) => void>(),
  session: vi.fn(),
  detail: vi.fn(),
  productionSend: vi.fn(),
  productionLookup: vi.fn(),
  secureGet: vi.fn(),
  secureSet: vi.fn(),
  secureDelete: vi.fn(),
  uuid: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: {
    get currentState() {
      return mocks.appState;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.listeners.add(listener);
      return { remove: () => mocks.listeners.delete(listener) };
    },
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: mocks.uuid }));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
  getItemAsync: mocks.secureGet,
  setItemAsync: mocks.secureSet,
  deleteItemAsync: mocks.secureDelete,
}));
vi.mock("../lib/jobsync-mobile-api", () => ({
  getJobSyncMobileSession: mocks.session,
  getJobSyncCompanyJobDetail: mocks.detail,
  sendJobSyncCompanyInvoiceOperation: mocks.productionSend,
  getJobSyncCompanyInvoiceOperation: mocks.productionLookup,
}));

type Renderer = { update(node: React.ReactNode): void; unmount(): void };
type RendererModule = { create(node: React.ReactNode): Renderer };
// Dependency installed outside the repository; NODE_PATH supports a normal external install.
const require = createRequire(import.meta.url);
const testRenderer = (() => {
  try {
    return require("react-test-renderer") as RendererModule;
  } catch {
    return require("/tmp/hsc-invoice-hook-renderer/node_modules/react-test-renderer") as RendererModule;
  }
})();
type Input = Parameters<typeof useCompanyInvoiceOperation>[0];
type Value = ReturnType<typeof useCompanyInvoiceOperation>;
function context(
  resend = false,
  recipientEmail?: string,
): CompanyInvoiceOperationContext {
  return {
    session: {
      token: "synthetic-token-not-stored",
      portal: "company",
      company: { id: 9 },
      user: { id: 42, role: "owner" },
    },
    job: { id: 12, companyId: 9 },
    options: {
      method: "email",
      resend,
      ...(recipientEmail ? { recipientEmail } : {}),
    },
    lifetime: { sheetEpoch: 1, focusEpoch: 1 },
  };
}
function nativeFixture(data = new Map<string, string>()) {
  const adapter = {
    getItemAsync: vi.fn(
      async (key: string, _options?: unknown) => data.get(key) ?? null,
    ),
    setItemAsync: vi.fn(
      async (key: string, value: string, _options?: unknown) => {
        if (value.length > 1800)
          throw new Error("Synthetic native chunk limit");
        data.set(key, value);
      },
    ),
    deleteItemAsync: vi.fn(async (key: string, _options?: unknown) => {
      data.delete(key);
    }),
  };
  return {
    data,
    adapter,
    store: createCompanyInvoiceOperationStore({
      platform: "ios",
      secureStore: adapter,
    }),
  };
}
function isolated(h = invoiceFc3Harness(), native = nativeFixture()) {
  const transport = {
    send: vi.fn(
      async (
        _token: string,
        _jobId: number,
        body: Parameters<typeof h.send>[0],
      ) => {
        const response = await h.send(body);
        if (response.code !== 200)
          throw new Error("Synthetic invoice POST denied");
        return response.payload as unknown;
      },
    ),
    lookup: vi.fn(async (_token: string, jobId: number, key: string) => {
      const response = await h.lookup(key, jobId);
      if (response.code !== 200)
        throw new Error("Synthetic invoice GET denied");
      return response.payload as unknown;
    }),
  };
  const options: CompanyInvoiceOperationControllerOptions = {
    store: native.store,
    isolatedTransport: transport,
  };
  return { h, native, transport, options };
}
function Probe({
  input,
  observe,
}: {
  input: Input;
  observe(value: Value): void;
}) {
  const value = useCompanyInvoiceOperation(input);
  useLayoutEffect(() => {
    observe(value);
  }, [value, observe]);
  return null;
}
const roots = new Set<Renderer>();
async function mount(
  options?: CompanyInvoiceOperationControllerOptions,
  captured = context(),
  visible = true,
) {
  const observed: { value?: Value; history: Value[] } = { history: [] };
  const observe = (value: Value) => {
    observed.value = value;
    observed.history.push(value);
  };
  let input: Input = {
    context: captured,
    visible,
    focused: true,
    isCurrent: () => true,
    ...(options ? { isolatedController: options } : {}),
  };
  let root!: Renderer;
  await act(async () => {
    root = testRenderer.create(<Probe input={input} observe={observe} />);
  });
  roots.add(root);
  return {
    get value() {
      if (!observed.value) throw new Error("No layout-committed hook result");
      return observed.value;
    },
    history: observed.history,
    async update(change: Partial<Input>) {
      input = { ...input, ...change };
      await act(async () => {
        root.update(<Probe input={input} observe={observe} />);
      });
    },
    async unmount() {
      await act(async () => root.unmount());
      roots.delete(root);
    },
  };
}
async function invoke<T>(action: () => T | Promise<T>): Promise<T> {
  let value!: T;
  await act(async () => {
    value = await action();
  });
  return value;
}
async function flush() {
  await act(async () => {
    for (let index = 0; index < 120; index++) await Promise.resolve();
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function appState(next: string) {
  await act(async () => {
    mocks.appState = next;
    for (const listener of mocks.listeners) listener(next);
  });
}
async function seed(f: ReturnType<typeof isolated>, captured = context()) {
  return createCompanyInvoiceOperationController(f.options).send(
    captured,
    () => true,
  );
}
function noProductionIO() {
  expect(companyInvoiceOperationReleaseReady()).toBe(false);
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.productionSend).not.toHaveBeenCalled();
  expect(mocks.productionLookup).not.toHaveBeenCalled();
  expect(mocks.secureGet).not.toHaveBeenCalled();
  expect(mocks.secureSet).not.toHaveBeenCalled();
  expect(mocks.secureDelete).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState = "active";
  mocks.session.mockReset().mockImplementation(async () => context().session);
  mocks.detail.mockReset().mockImplementation(async () => context().job);
  mocks.uuid.mockReset().mockImplementation(() => randomUUID());
  for (const denied of [
    mocks.fetch,
    mocks.productionSend,
    mocks.productionLookup,
    mocks.secureGet,
    mocks.secureSet,
    mocks.secureDelete,
  ]) {
    denied.mockImplementation(() => {
      throw new Error("DENIED production HTTP/storage");
    });
  }
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount());
  roots.clear();
  expect(mocks.listeners.size).toBe(0);
  noProductionIO();
  vi.unstubAllGlobals();
});

// Evaluate only expressions copied from the actual admin AST, not a semantic screen stub.
const adminSource = readFileSync(
  new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url),
  "utf8",
);
const adminTree = ts.createSourceFile(
  "admin-schedule.tsx",
  adminSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function adminHandler(marker: string, bindings: Record<string, unknown>) {
  const matches: ts.JsxAttribute[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(adminTree) === "onPress" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression?.getText(adminTree).includes(marker)
    )
      matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(adminTree);
  expect(matches).toHaveLength(1);
  const attribute = matches[0].initializer as ts.JsxExpression;
  const expression = attribute.expression!;
  const code = ts.transpileModule(
    `globalThis.handler = (${expression.getText(adminTree)});`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    },
  ).outputText;
  const sandbox = vm.createContext({
    ...bindings,
    fetch: () => {
      throw new Error("DENIED copied legacy HTTP");
    },
  });
  vm.runInContext(code, sandbox, { timeout: 2000 });
  return sandbox.handler as () => Promise<void> | void;
}
function adminBindings(value: Value, method = "email", gate = true) {
  const legacy = vi.fn(async () => ({ synthetic: true }));
  const published = vi.fn();
  const captured = context();
  return {
    legacy,
    published,
    bindings: {
      companyInvoiceOperation: value,
      invoiceMethod: method,
      // Local extracted-handler deployment condition; the imported application gate stays false.
      companyInvoiceOperationReleaseReady: () => gate,
      invoiceLockRef: { current: false },
      isCurrentInvoice: () => true,
      companyJobMode: true,
      jobSyncSession: captured.session,
      selectedJob: captured.job,
      isJobSyncCompany: true,
      jobSyncLoading: false,
      positiveJobSyncId: Number,
      invoiceResend: false,
      companyInvoiceRecipientEmail: "",
      setInvoiceSending: vi.fn(),
      setInvoiceSentUrl: published,
      companyInvoiceAttemptGuardRef: {
        current: {
          begin: vi.fn(() => ({})),
          markDispatched: vi.fn(),
          finish: vi.fn(),
        },
      },
      captureCompanyJobInvoiceIntent,
      createCompanyJobInvoiceOptions,
      getJobSyncMobileSession: mocks.session,
      getJobSyncCompanyJobDetail: mocks.detail,
      assertCompanyJobInvoiceSession,
      assertCompanyJobInvoiceJob,
      sendJobSyncCompanyJobInvoice: legacy,
      validateCompanyJobInvoiceRecipientReceipt: () => ({
        communicationState: "provider_accepted",
        acknowledgedRecipient: "on-file@example.test",
        publicUrl: "synthetic.invalid",
      }),
      setCompanyInvoiceStatus: vi.fn(),
      setCompanyInvoiceAcknowledgedRecipient: vi.fn(),
      Alert: { alert: vi.fn() },
      managementActionRef: { current: { mounted: true } },
    },
  };
}

describe("connected invoice hook: release, authority, and exact GET/POST identity", () => {
  it("default release gate disables mount/reopen/recovery/send/preparation with zero HTTP or storage", async () => {
    const f = isolated();
    const productionOptions = { store: f.native.store, transport: f.transport };
    const probe = await mount(productionOptions);
    expect(probe.value.canSend).toBe(false);
    expect(await invoke(probe.value.send)).toBeNull();
    expect(await invoke(probe.value.recover)).toBeNull();
    expect(await invoke(probe.value.prepareResend)).toBe(false);
    await probe.update({ visible: false });
    await probe.update({ visible: true });
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(f.native.adapter.getItemAsync).not.toHaveBeenCalled();
    expect(f.transport.lookup).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it("uninjected application hook is inert while the real release gate is false", async () => {
    const probe = await mount();
    await invoke(probe.value.send);
    await invoke(probe.value.recover);
    expect(probe.value.canSend).toBe(false);
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([undefined, "alternate@example.test"])(
    "initial on-file/alternate uses default key and durable GET recipient: %s",
    async (recipient) => {
      const f = isolated();
      const probe = await mount(f.options, context(false, recipient));
      expect(probe.value.result?.state).toBe("not_found");
      expect(f.transport.send).not.toHaveBeenCalled();
      const initialUUIDs = mocks.uuid.mock.calls.length;
      const sent = await invoke(probe.value.send);
      expect(sent).toMatchObject({
        state: "completed",
        operationKey: "job-invoice",
        actualRecipient: recipient ?? "on-file@example.test",
        isDelivered: false,
      });
      expect(f.transport.send).toHaveBeenCalledTimes(1);
      expect(f.transport.send).toHaveBeenCalledWith(
        "synthetic-token-not-stored",
        12,
        {
          method: "email",
          resend: false,
          operationKey: "job-invoice",
          ...(recipient ? { recipientEmail: recipient } : {}),
        },
      );
      expect(f.h.provider.send).toHaveBeenCalledTimes(1);
      expect(f.transport.lookup.mock.calls.map((call) => call[2])).toEqual([
        "job-invoice",
        "job-invoice",
      ]);
      expect(probe.value.result?.actualRecipient).toBe(
        (await f.h.lookup("job-invoice")).payload.recipientEmail,
      );
      expect(await f.native.store.read(9, 42, 12)).toMatchObject({
        phase: "verified",
        requestedRecipient: recipient ?? null,
        lookup: { recipientEmail: recipient ?? "on-file@example.test" },
      });
      // UUIDs are journal revisions, not Send-created operation keys.
      expect(mocks.uuid.mock.calls.length - initialUUIDs).toBe(4);
      expect([...f.native.data.values()].join("")).not.toContain(
        "synthetic-token-not-stored",
      );
      for (const call of f.native.adapter.setItemAsync.mock.calls)
        expect(call[2]).toEqual({ keychainAccessible: "device-only" });
      expect(mocks.session).toHaveBeenCalledWith("synthetic-token-not-stored");
      expect(mocks.detail).toHaveBeenCalledWith(
        "synthetic-token-not-stored",
        12,
        9,
      );
    },
  );
  it("duplicate batched Send taps dispatch exactly once and never create a resend key", async () => {
    const f = isolated();
    const probe = await mount(f.options);
    const outcomes = await invoke(() =>
      Promise.all([probe.value.send(), probe.value.send()]),
    );
    expect(outcomes.filter((value) => value === null)).toHaveLength(1);
    expect(f.transport.send).toHaveBeenCalledTimes(1);
    expect(f.h.rows).toHaveLength(1);
    expect(f.h.rows[0].logical_send_key).toBe("job-invoice");
    await invoke(probe.value.send);
    expect(f.transport.send).toHaveBeenCalledTimes(1);
  });
  it("mount/reopen recover the retained journal with GET only and reverify authCompany/Job", async () => {
    const f = isolated();
    await seed(f, context(false, "persisted@example.test"));
    f.transport.send.mockClear();
    f.transport.lookup.mockClear();
    const probe = await mount(f.options);
    expect(probe.value.result?.actualRecipient).toBe("persisted@example.test");
    await probe.update({ visible: false });
    await probe.update({
      context: { ...context(), lifetime: { sheetEpoch: 2, focusEpoch: 1 } },
      visible: true,
    });
    expect(f.transport.lookup).toHaveBeenCalledTimes(2);
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(mocks.session).toHaveBeenCalledTimes(2);
    expect(mocks.detail).toHaveBeenCalledTimes(2);
    expect(f.h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("backend default-key collision is held without exposing foreign recipient or identity", async () => {
    const f = isolated();
    await f.h.send({
      operationKey: "job-invoice",
      recipientEmail: "persisted@example.test",
    });
    const probe = await mount(
      f.options,
      context(false, "requested@example.test"),
    );
    const outcome = await invoke(probe.value.send);
    expect(outcome).toMatchObject({
      state: "conflict",
      actualRecipient: null, communicationId: null, lookup: null, isDelivered: false,
    });
    expect(probe.value.canSend).toBe(false);
    expect(f.transport.send).not.toHaveBeenCalled();
    expect((await f.native.store.read(9, 42, 12))?.lookup).toBeNull();
    expect(probe.value.canPrepareResend).toBe(false);
  });
  it.each(["token", "company", "user", "role", "portal"])(
    "fresh signed %s mismatch blocks journal and invoice transport",
    async (field) => {
      const f = isolated();
      const fresh = structuredClone(context().session)!;
      if (field === "token") fresh.token = "different-token";
      if (field === "company") fresh.company!.id = 88;
      if (field === "user") fresh.user.id = 77;
      if (field === "role") fresh.user.role = "dispatcher";
      if (field === "portal") fresh.portal = "admin";
      mocks.session.mockResolvedValue(fresh);
      const probe = await mount(f.options);
      expect(probe.value.error).toContain("Signed Company identity changed");
      expect(probe.value.canSend).toBe(false);
      expect(mocks.detail).not.toHaveBeenCalled();
      expect(f.native.adapter.getItemAsync).not.toHaveBeenCalled();
      expect(f.transport.send).not.toHaveBeenCalled();
    },
  );
  it.each([{ id: 13, companyId: 9 }, { id: 12, companyId: 88 }, null])(
    "fresh canonical Job %j mismatch blocks invoice transport",
    async (detail) => {
      const f = isolated();
      mocks.detail.mockResolvedValue(detail);
      const probe = await mount(f.options);
      expect(probe.value.error).toContain(
        "originating Company Job is unavailable",
      );
      expect(probe.value.canSend).toBe(false);
      expect(f.native.adapter.getItemAsync).not.toHaveBeenCalled();
      expect(f.transport.send).not.toHaveBeenCalled();
    },
  );
});

describe("connected invoice hook: terminal GET, explicit key capture, restart, and uncertainty", () => {
  it.each(["completed", "failed"])(
    "separate prepareResend after %s GET creates ONE key even with batched duplicate clicks",
    async (terminal) => {
      const f = isolated();
      if (terminal === "failed") f.h.setProviderMode("rejected");
      await seed(f);
      f.h.setProviderMode("accepted");
      f.transport.send.mockClear();
      const probe = await mount(
        f.options,
        context(true, "resend@example.test"),
      );
      expect(probe.value.result?.state).toBe(terminal);
      expect(probe.value.canSend).toBe(false);
      const before = mocks.uuid.mock.calls.length;
      expect(
        await invoke(() => [
          probe.value.prepareResend(),
          probe.value.prepareResend(),
        ]),
      ).toEqual([true, true]);
      expect(mocks.uuid.mock.calls.length - before).toBe(1);
      expect(probe.value.resendPrepared).toBe(true);
      expect(f.transport.send).not.toHaveBeenCalled();
      const outcome = await invoke(probe.value.send);
      expect(outcome?.operationKey).toMatch(/^hsc-invoice-/);
      expect(f.transport.send).toHaveBeenCalledTimes(1);
      expect(f.transport.send.mock.calls[0][2]).toMatchObject({
        operationKey: outcome?.operationKey,
        resend: true,
        recipientEmail: "resend@example.test",
      });
      await invoke(probe.value.send);
      expect(f.transport.send).toHaveBeenCalledTimes(1);
      expect(f.h.rows).toHaveLength(2);
    },
  );
  it.each(["queued", "provider_started", "unknown", "not_found"])(
    "nonterminal %s GET cannot prepare a resend or make another POST",
    async (state) => {
      const f = isolated();
      await seed(f);
      if (state === "not_found") f.h.rows.splice(0);
      else
        Object.assign(
          f.h.rows[0],
          state === "queued"
            ? { state: "queued", provider_dispatch_state: "queued" }
            : {
                state: "sending",
                provider_dispatch_state:
                  state === "unknown" ? "provider_unknown" : "provider_started",
              },
        );
      f.transport.send.mockClear();
      const probe = await mount(f.options, context(true));
      expect(probe.value.result?.state).toBe(state);
      expect(probe.value.canSend).toBe(false);
      expect(await invoke(probe.value.prepareResend)).toBe(false);
      const before = mocks.uuid.mock.calls.length;
      await invoke(probe.value.send);
      expect(f.transport.send).not.toHaveBeenCalled();
      if (state === "not_found")
        expect(mocks.uuid.mock.calls.length).toBe(before);
    },
  );
  it("Send without explicit preparation is GET-only and creates no operation key", async () => {
    const f = isolated();
    await seed(f);
    f.transport.send.mockClear();
    const probe = await mount(f.options, context(true));
    await invoke(probe.value.send);
    expect(f.transport.send).not.toHaveBeenCalled();
    expect((await f.native.store.read(9, 42, 12))?.operationKey).toBe(
      "job-invoice",
    );
  });
  it("fresh hook/store restart after lost response recovers GET identity, never dispatches again", async () => {
    const f = isolated();
    const realSend = f.transport.send.getMockImplementation()!;
    f.transport.send.mockImplementation(async (...args) => {
      await realSend(...args);
      throw new Error("Synthetic lost response");
    });
    const probe = await mount(f.options, context(false, "held@example.test"));
    expect((await invoke(probe.value.send))?.state).toBe("uncertain");
    await probe.unmount();
    const fresh = nativeFixture(f.native.data);
    const restarted = await mount({ ...f.options, store: fresh.store });
    expect(restarted.value.result).toMatchObject({
      state: "completed",
      actualRecipient: "held@example.test",
    });
    await invoke(restarted.value.send);
    expect(f.transport.send).toHaveBeenCalledTimes(1);
    expect(f.h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("process death after prepared marker keeps default key on mount and Send, with zero POST", async () => {
    const f = isolated();
    await f.native.store.compareAndSwap(
      null,
      newCompanyInvoiceOperationRecord(
        captureCompanyInvoiceOperationIntent(context()),
        "job-invoice",
      ),
    );
    const probe = await mount(f.options);
    expect(probe.value.result).toMatchObject({
      state: "not_found",
      operationKey: "job-invoice",
    });
    expect(probe.value.canSend).toBe(false);
    await invoke(probe.value.send);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(["route_missing", "actual_unavailable"])(
    "%s lookup holds key and never falls back to POST",
    async (mode) => {
      const f = isolated(
        mode === "actual_unavailable"
          ? invoiceFc3Harness("owner", 9, true, { lookupUnavailable: true })
          : invoiceFc3Harness(),
      );
      if (mode === "route_missing")
        f.transport.lookup.mockRejectedValue(
          new Error("Synthetic 404 missing route"),
        );
      const probe = await mount(f.options);
      expect((await invoke(probe.value.send))?.state).toBe(
        "temporarily_unavailable",
      );
      expect(probe.value.canSend).toBe(false);
      await invoke(probe.value.recover);
      await invoke(probe.value.send);
      expect(f.transport.send).not.toHaveBeenCalled();
      expect(probe.value.result?.operationKey).toBe("job-invoice");
    },
  );
  it("active OTHER key POST echo does not authorize a completed recipient or a second POST", async () => {
    const f = isolated();
    f.h.setProviderMode("unknown");
    await f.h.send({
      operationKey: "active-other-key",
      recipientEmail: "held@example.test",
    });
    const probe = await mount(
      f.options,
      context(false, "requested@example.test"),
    );
    const sent = await invoke(probe.value.send);
    expect(["uncertain", "not_found"]).toContain(sent?.state);
    expect(probe.value.result?.actualRecipient).toBeNull();
    expect(probe.value.canSend).toBe(false);
    await invoke(probe.value.send);
    await invoke(probe.value.recover);
    expect(f.transport.send).toHaveBeenCalledTimes(1);
    expect(f.h.provider.send).toHaveBeenCalledTimes(1);
    expect(f.h.rows[0].logical_send_key).toBe("active-other-key");
  });
  it("unavailable protected storage publishes a scoped error, not permission for a POST", async () => {
    const f = isolated();
    const unavailable = createCompanyInvoiceOperationStore({
      platform: "web",
      indexedDB: null,
      webCrypto: null,
    });
    const probe = await mount({ ...f.options, store: unavailable });
    expect(probe.value.error).toContain("Protected invoice recovery storage");
    expect(probe.value.canSend).toBe(false);
    await invoke(probe.value.send);
    await invoke(probe.value.recover);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
});

const layoutChanges = [
  "recipient",
  "resend",
  "token",
  "company",
  "user",
  "role",
  "job",
  "sheet",
  "focus",
  "close",
  "blur",
  "background",
  "current",
  "unmount",
] as const;
type LayoutChange = (typeof layoutChanges)[number];
async function changeScope(
  probe: Awaited<ReturnType<typeof mount>>,
  field: LayoutChange,
  original = context(),
) {
  const next = { ...structuredClone(original) };
  if (field === "recipient")
    next.options = { ...next.options, recipientEmail: "changed@example.test" };
  if (field === "resend")
    next.options = { ...next.options, resend: !next.options.resend };
  if (field === "token") next.session!.token = "changed-token";
  if (field === "company") {
    next.session!.company!.id = 88;
    next.job!.companyId = 88;
  }
  if (field === "user") next.session!.user.id = 77;
  if (field === "role") next.session!.user.role = "dispatcher";
  if (field === "job") next.job!.id = 13;
  if (field === "sheet") next.lifetime = { ...next.lifetime, sheetEpoch: 2 };
  if (field === "focus") next.lifetime = { ...next.lifetime, focusEpoch: 2 };
  if (field === "background") return appState("background");
  if (field === "unmount") return probe.unmount();
  await probe.update({
    context: next,
    ...(field === "close" ? { visible: false } : {}),
    ...(field === "blur" ? { focused: false } : {}),
    ...(field === "current" ? { isCurrent: () => false } : {}),
  });
}

describe("connected invoice hook: layout-committed lifecycle suppresses stale async work", () => {
  it.each(layoutChanges)(
    "pending signed-session success after %s cannot reach detail/journal/POST",
    async (field) => {
      const f = isolated();
      const probe = await mount(f.options);
      const wait = deferred<unknown>();
      mocks.session.mockImplementation(() => wait.promise);
      let pending!: Promise<unknown>;
      await act(async () => {
        pending = probe.value.send();
      });
      const detailCount = mocks.detail.mock.calls.length;
      const readCount = f.native.adapter.getItemAsync.mock.calls.length;
      await changeScope(probe, field);
      await act(async () => {
        wait.resolve(context().session);
        await pending;
      });
      expect(mocks.detail.mock.calls.length).toBe(detailCount);
      expect(f.native.adapter.getItemAsync.mock.calls.length).toBe(readCount);
      expect(f.transport.send).not.toHaveBeenCalled();
      expect(probe.value.error).toBeNull();
    },
  );
  it.each(layoutChanges)(
    "pending signed-session error after %s cannot publish a stale error",
    async (field) => {
      const f = isolated();
      const probe = await mount(f.options);
      const wait = deferred<unknown>();
      mocks.session.mockImplementation(() => wait.promise);
      let pending!: Promise<unknown>;
      await act(async () => {
        pending = probe.value.send();
      });
      await changeScope(probe, field);
      await act(async () => {
        wait.reject(new Error("ORIGINATING sheet error"));
        await pending;
      });
      expect(
        probe.history.some((value) => value.error?.includes("ORIGINATING")),
      ).toBe(false);
      expect(f.transport.send).not.toHaveBeenCalled();
    },
  );
  it.each(layoutChanges)(
    "completed POST callback after %s cannot publish stale receipt or actual recipient",
    async (field) => {
      const f = isolated();
      const probe = await mount(f.options);
      const wait = deferred<void>();
      const real = f.transport.send.getMockImplementation()!;
      f.transport.send.mockImplementation(async (...args) => {
        const response = await real(...args);
        await wait.promise;
        return response;
      });
      let pending!: Promise<unknown>;
      await act(async () => {
        pending = probe.value.send();
      });
      await flush();
      expect(f.h.provider.send).toHaveBeenCalledTimes(1);
      await changeScope(probe, field);
      await act(async () => {
        wait.resolve();
        await pending;
      });
      expect(
        probe.history.some((value) => value.result?.state === "completed"),
      ).toBe(false);
      expect(
        probe.history.some((value) => value.result?.actualRecipient != null),
      ).toBe(false);
      expect((await f.native.store.read(9, 42, 12))?.phase).toBe("uncertain");
      expect(f.transport.send).toHaveBeenCalledTimes(1);
    },
  );
  it("fresh canonical detail delayed across a layout commit never reaches the controller", async () => {
    const f = isolated();
    const probe = await mount(f.options);
    const wait = deferred<unknown>();
    mocks.detail.mockImplementation(() => wait.promise);
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = probe.value.send();
    });
    await changeScope(probe, "job");
    await act(async () => {
      wait.resolve(context().job);
      await pending;
    });
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(probe.value.error).toBeNull();
  });
  it("same-scope journal error after an existing POST cannot permit another POST", async () => {
    const f = isolated();
    const probe = await mount(f.options);
    await invoke(probe.value.send);
    const chunk = [...f.native.data.keys()].find(
      (key) => !key.endsWith("manifest"),
    )!;
    f.native.data.delete(chunk);
    await invoke(probe.value.recover);
    expect(probe.value.error).toContain("could not be verified");
    expect(probe.value.canSend).toBe(false);
    await invoke(probe.value.send);
    expect(probe.value.error).toContain("could not be verified");
    expect(f.transport.send).toHaveBeenCalledTimes(1);
  });
});

describe("actual admin invoice AST branch with connected hook", () => {
  it("gated email Send calls connected hook before legacy and returns without fallback", async () => {
    const f = isolated();
    const probe = await mount(f.options);
    const source = adminBindings(probe.value);
    await invoke(
      adminHandler("const token = jobSyncSession?.token", source.bindings),
    );
    expect(f.transport.send).toHaveBeenCalledTimes(1);
    expect(probe.value.result?.actualRecipient).toBe("on-file@example.test");
    expect(source.legacy).not.toHaveBeenCalled();
    expect(source.published).not.toHaveBeenCalled();
  });
  it("gated email with held operation takes connected GET recovery only, not legacy POST", async () => {
    const f = isolated();
    await seed(f);
    f.h.rows.splice(0);
    f.transport.send.mockClear();
    const probe = await mount(f.options);
    expect(probe.value.canSend).toBe(false);
    const source = adminBindings(probe.value);
    const before = f.transport.lookup.mock.calls.length;
    await invoke(
      adminHandler("const token = jobSyncSession?.token", source.bindings),
    );
    expect(f.transport.lookup.mock.calls.length - before).toBe(1);
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(source.legacy).not.toHaveBeenCalled();
  });
  it("actual status recovery control invokes connected GET only", async () => {
    const f = isolated();
    await seed(f);
    f.transport.send.mockClear();
    const probe = await mount(f.options);
    const before = f.transport.lookup.mock.calls.length;
    await invoke(() =>
      adminHandler("void companyInvoiceOperation.recover()", {
        companyInvoiceOperation: probe.value,
        isCurrentInvoice: () => true,
      })(),
    );
    await flush();
    expect(f.transport.lookup.mock.calls.length - before).toBe(1);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it("actual explicit prepare control captures one key with no send or lookup", async () => {
    const f = isolated();
    await seed(f);
    f.transport.send.mockClear();
    const probe = await mount(f.options, context(true));
    const before = mocks.uuid.mock.calls.length;
    const beforeLookup = f.transport.lookup.mock.calls.length;
    const press = adminHandler("companyInvoiceOperation.prepareResend()", {
      companyInvoiceOperation: probe.value,
      isCurrentInvoice: () => true,
    });
    await invoke(() => {
      press();
      press();
    });
    expect(mocks.uuid.mock.calls.length - before).toBe(1);
    expect(f.transport.lookup.mock.calls.length).toBe(beforeLookup);
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(probe.value.resendPrepared).toBe(true);
  });
  it("SMS remains legacy even when the extracted email condition is ready", async () => {
    const f = isolated();
    const probe = await mount(f.options, context(), false);
    const source = adminBindings(probe.value, "sms", true);
    await invoke(
      adminHandler("const token = jobSyncSession?.token", source.bindings),
    );
    expect(source.legacy).toHaveBeenCalledWith(
      "synthetic-token-not-stored",
      12,
      { method: "sms", resend: false },
    );
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.transport.lookup).not.toHaveBeenCalled();
  });
  it("email while release is false remains legacy; no global gate activation occurs", async () => {
    const f = isolated();
    const probe = await mount(undefined, context(), false);
    const source = adminBindings(
      probe.value,
      "email",
      companyInvoiceOperationReleaseReady(),
    );
    await invoke(
      adminHandler("const token = jobSyncSession?.token", source.bindings),
    );
    expect(source.legacy).toHaveBeenCalledWith(
      "synthetic-token-not-stored",
      12,
      { method: "email", resend: false },
    );
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it("busy connected hook blocks actual admin handler before both email hook and legacy", async () => {
    const f = isolated();
    const probe = await mount(f.options);
    const wait = deferred<unknown>();
    mocks.session.mockImplementation(() => wait.promise);
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = probe.value.send();
    });
    expect(probe.value.busy).toBe(true);
    const source = adminBindings(probe.value);
    await invoke(
      adminHandler("const token = jobSyncSession?.token", source.bindings),
    );
    expect(source.legacy).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();
    await act(async () => {
      wait.resolve(context().session);
      await pending;
    });
    expect(f.transport.send).toHaveBeenCalledTimes(1);
  });
});

// These are ordinary failing regression tests, deliberately NOT it.fails/skip/todo.
// They capture observed defects in the completed parent hook without editing it.
describe("regression contracts requiring parent hook fixes", () => {
  it("retained Send callback from old sheet must not adopt a reopened current sheet", async () => {
    const f = isolated();
    const probe = await mount(f.options);
    const oldSend = probe.value.send;
    await probe.update({
      context: { ...context(), lifetime: { sheetEpoch: 2, focusEpoch: 1 } },
    });
    expect(await invoke(oldSend)).toBeNull();
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it("retained recover callback from old sheet must not operate against the reopened sheet", async () => {
    const f = isolated();
    await seed(f);
    const probe = await mount(f.options);
    const oldRecover = probe.value.recover;
    await probe.update({
      context: { ...context(), lifetime: { sheetEpoch: 2, focusEpoch: 1 } },
    });
    const reads = f.transport.lookup.mock.calls.length;
    expect(await invoke(oldRecover)).toBeNull();
    expect(f.transport.lookup.mock.calls.length).toBe(reads);
  });
  it("terminal result cannot remain authorized after a recipient option layout change", async () => {
    const f = isolated();
    await seed(f);
    const probe = await mount(f.options, context(true));
    const wait = deferred<unknown>();
    mocks.session.mockImplementation(() => wait.promise);
    await probe.update({ context: context(true, "changed@example.test") });
    expect(probe.value.canPrepareResend).toBe(false);
    expect(await invoke(probe.value.prepareResend)).toBe(false);
  });
  it("a prepared resend key cannot carry authorization across a changed recipient", async () => {
    const f = isolated();
    await seed(f);
    const probe = await mount(f.options, context(true));
    await invoke(probe.value.prepareResend);
    const wait = deferred<unknown>();
    mocks.session.mockImplementation(() => wait.promise);
    await probe.update({ context: context(true, "changed@example.test") });
    expect(probe.value.resendPrepared).toBe(false);
    expect(probe.value.canSend).toBe(false);
  });
  it("retained prepareResend cannot generate a key for an uncaptured new Company scope", async () => {
    const f = isolated();
    await seed(f);
    const probe = await mount(f.options, context(true));
    const oldPrepare = probe.value.prepareResend;
    const another = context(true);
    another.session!.company!.id = 88;
    another.job!.companyId = 88;
    await probe.update({ context: another });
    const before = mocks.uuid.mock.calls.length;
    expect(await invoke(oldPrepare)).toBe(false);
    expect(mocks.uuid.mock.calls.length).toBe(before);
  });
  it("closed sheet preparation must return false instead of throwing from capture", async () => {
    const f = isolated();
    await seed(f);
    const probe = await mount(f.options, context(true));
    await probe.update({ visible: false });
    expect(await invoke(probe.value.prepareResend)).toBe(false);
  });
  it("canPrepareResend must be false when the originating sheet is hidden", async () => {
    const f = isolated();
    await seed(f);
    const probe = await mount(f.options, context(true));
    await probe.update({ visible: false });
    expect(probe.value.canPrepareResend).toBe(false);
  });
  it("canSend must be false when the originating sheet is hidden", async () => {
    const f = isolated();
    const probe = await mount(f.options);
    await probe.update({ visible: false });
    expect(probe.value.canSend).toBe(false);
  });
});
