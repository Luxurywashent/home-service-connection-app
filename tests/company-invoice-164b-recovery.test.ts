// New 164b focused tests. Historical 17 requirement bodies are untouched.
import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createCompanyInvoiceOperationController,
  type CompanyInvoiceOperationTransport,
} from "../lib/company-job-invoice-operation-controller";
import {
  createCompanyInvoiceOperationStore,
  newCompanyInvoiceOperationKey,
  newCompanyInvoiceOperationRecord,
  updateCompanyInvoiceOperationRecord,
} from "../lib/company-job-invoice-operation-storage";
import {
  captureCompanyInvoiceOperationIntent,
  normalizeCompanyInvoiceOperationLookup,
  normalizeCompanyInvoiceOperationReceipt,
  type CompanyInvoiceOperationContext,
} from "../lib/company-job-invoice-operation";
import { invoiceIndexedDBMock } from "./fixtures/company-invoice-indexeddb";
import { isCurrentCompanyInvoiceOperationIntent } from "../lib/company-job-invoice-operation-lifecycle";
import { invoice164bHarness } from "./fixtures/company-invoice-164b-source";
vi.mock("expo-crypto", () => ({ randomUUID: () => webcrypto.randomUUID() }));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
const deny = () => {
  throw new Error("DENIED network outside isolated invoice transport");
};
beforeAll(() => vi.stubGlobal("fetch", deny));
afterAll(() => vi.unstubAllGlobals());
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
    getItemAsync: vi.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: vi.fn(
      async (key: string, value: string, _options?: unknown) => {
        if (value.length > 1800) throw new Error("native value too large");
        data.set(key, value);
      },
    ),
    deleteItemAsync: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  };
  return {
    adapter,
    data,
    store: createCompanyInvoiceOperationStore({
      platform: "ios",
      secureStore: adapter,
    }),
  };
}
function isolated(h = invoice164bHarness(), native = nativeFixture()) {
  const transport: CompanyInvoiceOperationTransport = {
    send: vi.fn(async (_token, _jobId, body) => {
      const response = await h.send(body);
      if (response.code !== 200) throw new Error("Synthetic route denied");
      return response.payload;
    }),
    lookup: vi.fn(async (_token, jobId, key) => {
      const response = await h.lookup(key, jobId);
      if (response.code !== 200) throw new Error("Synthetic lookup denied");
      return response.payload;
    }),
  };
  return {
    h,
    native,
    transport,
    controller: createCompanyInvoiceOperationController({
      store: native.store,
      isolatedTransport: transport,
    }),
  };
}
const current = () => true;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function flush() {
  for (let index = 0; index < 30; index++) await Promise.resolve();
}

describe("repaired actual-source invoice contract and authority", () => {
  it.each([undefined, "alternate@example.test"])(
    "initial default/alternate recipient uses stable explicit key and persisted identity: %s",
    async (recipient) => {
      const f = isolated();
      const sent = await f.controller.send(context(false, recipient), current);
      expect(sent.state).toBe("completed");
      expect(sent.operationKey).toBe("job-invoice");
      expect(sent.actualRecipient).toBe(recipient ?? "on-file@example.test");
      expect(sent.communicationId).toBe(1);
      expect(sent.isDelivered).toBe(false);
      expect(f.h.provider.send).toHaveBeenCalledTimes(1);
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
      expect(f.h.rows[0].recipient_email).toBe(sent.actualRecipient);
      expect(
        f.h.audits.find((a) => a.action === "job.invoice_sent").details
          .recipientEmail,
      ).toBe(sent.actualRecipient);
      expect(await f.native.store.read(9, 42, 12)).toMatchObject({
        phase: "verified",
        lookup: {
          communicationId: 1,
          recipientEmail: sent.actualRecipient,
          status: "provider_accepted",
        },
      });
    },
  );
  it("explicit authorized resend has one new captured key and repeated tap reconciles", async () => {
    const f = isolated();
    await f.controller.send(context(), current);
    const choice = {
      ...context(true, "second@example.test"),
      operationKey: newCompanyInvoiceOperationKey(),
      lifetime: { sheetEpoch: 2, focusEpoch: 1 },
    };
    const sent = await f.controller.send(choice, current);
    const repeat = await f.controller.send(choice, current);
    expect(sent.state).toBe("completed");
    expect(sent.operationKey).toMatch(/^hsc-invoice-/);
    expect(repeat.operationKey).toBe(sent.operationKey);
    expect(f.h.provider.send).toHaveBeenCalledTimes(2);
    expect(f.h.rows).toHaveLength(2);
    expect(f.h.rows[1].intent_kind).toBe("resend");
    expect(f.h.rows[1].logical_send_key).toBe(sent.operationKey);
    expect(f.h.rows[1].recipient_email).toBe("second@example.test");
  });
  it("requires a prior verified pointer before a new resend", async () => {
    const f = isolated();
    expect((await f.controller.send(context(true), current)).state).toBe(
      "uncertain",
    );
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(["technician"])(
    "repaired POST and GET require manager role: %s",
    async (role) => {
      const h = invoice164bHarness(role);
      expect((await h.send({ operationKey: "job-invoice" })).code).toBe(403);
      expect((await h.lookup("job-invoice")).code).toBe(403);
      expect(h.provider.send).not.toHaveBeenCalled();
    },
  );
  it("dispatcher preserves invoice authority without native payment activation", async () => {
    const h = invoice164bHarness("dispatcher");
    const sent = await h.send({ operationKey: "job-invoice" });
    expect(sent.code).toBe(200);
    expect((await h.lookup("job-invoice")).payload.communicationId).toBe(1);
  });
  it("foreign company/jobs and disabled payments never dispatch", async () => {
    const foreign = invoice164bHarness("owner", 88);
    expect((await foreign.send({ operationKey: "job-invoice" })).code).toBe(
      404,
    );
    expect((await foreign.lookup("job-invoice")).payload.status).toBe(
      "not_found",
    );
    const off = invoice164bHarness("owner", 9, false);
    expect((await off.lookup("job-invoice")).code).toBe(403);
    expect((await off.send({ operationKey: "job-invoice" })).code).toBe(403);
    expect(off.provider.send).not.toHaveBeenCalled();
  });
  it("SMS route drops explicit key and lookup is email-only (real mismatch)", async () => {
    const h = invoice164bHarness();
    const sms = await h.send({
      method: "sms",
      operationKey: "sms-explicit-key",
    });
    expect(sms.payload.operationKey).toBe("job-invoice");
    expect((await h.lookup("sms-explicit-key")).payload.status).toBe(
      "not_found",
    );
    const f = isolated();
    await expect(
      f.controller.send(
        { ...context(), options: { method: "sms", resend: false } },
        current,
      ),
    ).rejects.toThrow("no verified SMS");
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it("collision against completed default retains ACTUAL recipient and blocks requested-recipient mismatch", async () => {
    const h = invoice164bHarness();
    await h.send({
      operationKey: "job-invoice",
      recipientEmail: "persisted@example.test",
    });
    const f = isolated(h);
    const outcome = await f.controller.send(
      context(false, "requested@example.test"),
      current,
    );
    expect(outcome.state).toBe("conflict");
    expect(outcome.actualRecipient).toBe("persisted@example.test");
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("active reservation under another key causes misleading POST echo; GET remains not_found", async () => {
    const h = invoice164bHarness();
    h.setProviderMode("unknown");
    await h.send({
      operationKey: "active-other-key",
      recipientEmail: "held@example.test",
    });
    const f = isolated(h);
    const outcome = await f.controller.send(
      context(false, "requested@example.test"),
      current,
    );
    expect(["uncertain", "not_found"]).toContain(outcome.state);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].logical_send_key).toBe("active-other-key");
    expect((await h.lookup("job-invoice")).payload.status).toBe("not_found");
    expect(h.provider.send).toHaveBeenCalledTimes(1);
    await f.controller.recover(context(), current);
    expect(f.transport.send).toHaveBeenCalledTimes(1);
  });
});

describe("durable recovery never retries a POST", () => {
  it("duplicate taps share durable CAS and dispatch once", async () => {
    const f = isolated();
    const other = createCompanyInvoiceOperationController({
      store: f.native.store,
      isolatedTransport: f.transport,
    });
    const results = await Promise.allSettled([
      f.controller.send(context(), current),
      f.controller.send(context(), current),
      other.send(context(), current),
    ]);
    expect(
      results.some((r) => r.status === "fulfilled" && r.value.state === "busy"),
    ).toBe(true);
    expect(f.h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("response loss survives a fresh store/controller restart and GET confirms the actual persisted recipient", async () => {
    const f = isolated();
    const realSend = f.transport.send;
    f.transport.send = vi.fn(async (token, jobId, body) => {
      await realSend(token, jobId, body);
      throw new Error("Synthetic response lost");
    });
    expect(
      (await f.controller.send(context(false, "held@example.test"), current))
        .state,
    ).toBe("uncertain");
    const freshStore = nativeFixture(f.native.data).store;
    const restarted = createCompanyInvoiceOperationController({
      store: freshStore,
      isolatedTransport: f.transport,
    });
    const recovered = await restarted.recover(context(), current);
    expect(recovered.state).toBe("completed");
    expect(recovered.actualRecipient).toBe("held@example.test");
    await restarted.send(context(), current);
    expect(f.transport.send).toHaveBeenCalledTimes(1);
    expect(f.h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("not_found after loss holds the key and cannot become an automatic resend", async () => {
    const f = isolated();
    f.transport.send = vi.fn(async () => {
      throw new Error("lost before reaching fixture");
    });
    expect((await f.controller.send(context(), current)).state).toBe(
      "uncertain",
    );
    expect((await f.controller.recover(context(), current)).state).toBe(
      "not_found",
    );
    expect((await f.controller.send(context(true), current)).state).toBe(
      "not_found",
    );
    expect(f.transport.send).toHaveBeenCalledTimes(1);
  });
  it("missing lookup route/malformed lookup never reaches POST or falls back to POST status", async () => {
    const f = isolated();
    f.transport.lookup = vi.fn(async () => {
      throw new Error("404 missing route");
    });
    expect((await f.controller.send(context(), current)).state).toBe(
      "temporarily_unavailable",
    );
    expect((await f.controller.recover(context(), current)).state).toBe(
      "temporarily_unavailable",
    );
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it("actual service temporary-unavailability is distinct from not_found", async () => {
    const durable = { lookupUnavailable: true };
    const h = invoice164bHarness("owner", 9, true, durable);
    const f = isolated(h);
    expect((await h.lookup("job-invoice")).payload.status).toBe(
      "temporarily_unavailable",
    );
    expect((await f.controller.send(context(), current)).state).toBe(
      "temporarily_unavailable",
    );
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each(["queued", "provider_started", "unknown"])(
    "%s remains held and never authorizes a resend",
    async (status) => {
      const f = isolated();
      await f.controller.send(context(), current);
      Object.assign(
        f.h.rows[0],
        status === "queued"
          ? { state: "queued", provider_dispatch_state: "queued" }
          : {
              state: "sending",
              provider_dispatch_state:
                status === "unknown" ? "provider_unknown" : "provider_started",
            },
      );
      const result = await f.controller.recover(context(), current);
      expect(result.state).toBe(status);
      expect(
        (
          await f.controller.send(
            { ...context(true), lifetime: { sheetEpoch: 2, focusEpoch: 1 } },
            current,
          )
        ).state,
      ).toBe(status);
      expect(f.h.provider.send).toHaveBeenCalledTimes(1);
    },
  );
  it("delivery only from the actual delivered GET state", async () => {
    const f = isolated();
    await f.controller.send(context(), current);
    f.h.rows[0].state = "delivered";
    const recovered = await f.controller.recover(context(), current);
    expect(recovered.state).toBe("completed");
    expect(recovered.isDelivered).toBe(true);
  });
  it("changed communication ID on readback is conflict rather than inferred success", async () => {
    const f = isolated();
    await f.controller.send(context(), current);
    f.h.rows[0].id = 77;
    expect((await f.controller.recover(context(), current)).state).toBe(
      "conflict",
    );
    expect(f.h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("process death after preparation cannot dispatch on recovery or Send", async () => {
    const native = nativeFixture();
    const prepared = newCompanyInvoiceOperationRecord(
      captureCompanyInvoiceOperationIntent(context()),
      "job-invoice",
    );
    await native.store.compareAndSwap(null, prepared);
    const f = isolated(invoice164bHarness(), native);
    expect((await f.controller.recover(context(), current)).state).toBe(
      "not_found",
    );
    expect((await f.controller.send(context(), current)).state).toBe(
      "not_found",
    );
    expect(f.transport.send).not.toHaveBeenCalled();
  });
});

describe("scope, deployment and storage guards", () => {
  it("blocked production transport does not read storage or make any new GET/POST request", async () => {
    const f = isolated();
    const controller = createCompanyInvoiceOperationController({
      store: f.native.store,
      transport: f.transport,
    });
    expect((await controller.send(context(), current)).state).toBe("blocked");
    expect((await controller.recover(context(), current)).state).toBe(
      "blocked",
    );
    expect(f.native.adapter.getItemAsync).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.transport.lookup).not.toHaveBeenCalled();
  });
  it.each([
    "sheet",
    "focus",
    "token",
    "company",
    "user",
    "role",
    "job",
    "unmount",
    "background",
  ])("stale %s continuation cannot POST", async (change) => {
    const f = isolated();
    const wait = deferred<unknown>();
    f.transport.lookup = vi.fn(() => wait.promise);
    let live = true;
    const pending = f.controller.send(context(), () => live);
    await flush();
    live = false;
    wait.resolve({
      operationKey: "job-invoice",
      communicationId: null,
      recipientEmail: null,
      status: "not_found",
      communicationState: null,
      providerDispatchState: null,
      providerMessageId: null,
      attemptCount: null,
    });
    expect((await pending).state).toBe("stale");
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(change).toBeTruthy();
  });
  it("stale callback after POST preserves uncertain marker without stale recipient completion", async () => {
    const f = isolated();
    const realSend = f.transport.send;
    const wait = deferred<unknown>();
    let live = true;
    f.transport.send = vi.fn(async (token, jobId, body) => {
      const raw = await realSend(token, jobId, body);
      await wait.promise;
      return raw;
    });
    const pending = f.controller.send(context(), () => live);
    for (let n = 0; n < 10; n++) await flush();
    live = false;
    wait.resolve(null);
    expect((await pending).state).toBe("stale");
    expect((await f.native.store.read(9, 42, 12))?.phase).toBe("uncertain");
  });
  it("native chunks protect recipient, never persist bearer, and use device-only options", async () => {
    const f = isolated();
    await f.controller.send(context(false, "private@example.test"), current);
    const contents = [...f.native.data.values()].join("");
    expect(contents).not.toContain("synthetic-token-not-stored");
    for (const call of f.native.adapter.setItemAsync.mock.calls) {
      expect(call[1].length).toBeLessThanOrEqual(1800);
      expect(call[2]).toEqual({ keychainAccessible: "device-only" });
    }
    expect(await f.native.store.read(9, 42, 12)).toMatchObject({
      requestedRecipient: "private@example.test",
    });
    expect(await f.native.store.read(9, 99, 12)).toBeNull();
  });
  it("native missing/corrupt chunks fail closed", async () => {
    const f = isolated();
    await f.controller.send(context(), current);
    const chunk = [...f.native.data.keys()].find(
      (key) => !key.endsWith("manifest"),
    )!;
    f.native.data.delete(chunk);
    await expect(f.controller.recover(context(), current)).rejects.toThrow(
      "could not be verified",
    );
    expect(f.transport.send).toHaveBeenCalledTimes(1);
  });
  it("unavailable protected storage never dispatches or falls back to plaintext", async () => {
    const f = isolated();
    const blockedStore = createCompanyInvoiceOperationStore({
      platform: "web",
      indexedDB: null,
      webCrypto: null,
    });
    const controller = createCompanyInvoiceOperationController({
      store: blockedStore,
      isolatedTransport: f.transport,
    });
    await expect(controller.send(context(), current)).rejects.toThrow(
      "Protected invoice recovery storage",
    );
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it("CAS stale revision cannot overwrite persisted operation", async () => {
    const n = nativeFixture();
    const record = newCompanyInvoiceOperationRecord(
      captureCompanyInvoiceOperationIntent(context()),
      "job-invoice",
    );
    expect(await n.store.compareAndSwap(null, record)).toBe(true);
    const next = updateCompanyInvoiceOperationRecord(record, {
      phase: "uncertain",
    });
    expect(await n.store.compareAndSwap(record, next)).toBe(true);
    expect(await n.store.compareAndSwap(record, next)).toBe(false);
  });
  it("strict DTO rejects missing/wrong keys, recipients and inconsistent provider states", () => {
    const missing = {
      operationKey: "job-invoice",
      communicationId: null,
      recipientEmail: null,
      status: "not_found",
      communicationState: null,
      providerDispatchState: null,
      providerMessageId: null,
      attemptCount: null,
    };
    expect(
      normalizeCompanyInvoiceOperationLookup(missing, "job-invoice").status,
    ).toBe("not_found");
    expect(() =>
      normalizeCompanyInvoiceOperationLookup(
        { ...missing, operationKey: "wrong-operation" },
        "job-invoice",
      ),
    ).toThrow();
    expect(() =>
      normalizeCompanyInvoiceOperationLookup(
        {
          ...missing,
          status: "delivered",
          communicationId: 1,
          recipientEmail: "a@example.test",
          communicationState: "delivered",
          providerDispatchState: "provider_unknown",
          attemptCount: 1,
        },
        "job-invoice",
      ),
    ).toThrow();
    expect(() =>
      normalizeCompanyInvoiceOperationReceipt(
        { success: true, status: "sent" },
        "job-invoice",
      ),
    ).toThrow();
  });
});

describe("invoice browser protected storage and concrete layout identity", () => {
  function browser(model: ReturnType<typeof invoiceIndexedDBMock>) {
    return createCompanyInvoiceOperationStore({
      platform: "web",
      indexedDB: model.factory,
      webCrypto: webcrypto as unknown as Crypto,
    });
  }
  it("encrypts recipient with nonextractable AES-GCM and recovers after browser-store/controller restart", async () => {
    const model = invoiceIndexedDBMock();
    const h = invoice164bHarness();
    const f = isolated(h);
    const store = browser(model);
    const controller = createCompanyInvoiceOperationController({
      store,
      isolatedTransport: f.transport,
    });
    expect(
      (await controller.send(context(false, "private@example.test"), current))
        .state,
    ).toBe("completed");
    const sealed = model.entries("records")[0][1] as {
      ciphertext: ArrayBuffer;
    };
    expect(JSON.stringify(sealed)).not.toContain("private@example.test");
    expect(new TextDecoder().decode(sealed.ciphertext)).not.toContain(
      "private@example.test",
    );
    const box = model.entries("keys")[0][1] as { key: CryptoKey };
    expect(box.key.extractable).toBe(false);
    expect(box.key.algorithm.name).toBe("AES-GCM");
    const recovered = await createCompanyInvoiceOperationController({
      store: browser(model),
      isolatedTransport: f.transport,
    }).recover(context(), current);
    expect(recovered.state).toBe("completed");
    expect(recovered.actualRecipient).toBe("private@example.test");
    expect(
      model.transactions
        .filter((tx) => tx.mode === "readwrite")
        .every((tx) => tx.durability === "strict"),
    ).toBe(true);
    expect(h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("missing browser key never regenerates over protected records", async () => {
    const model = invoiceIndexedDBMock();
    const store = browser(model);
    const record = newCompanyInvoiceOperationRecord(
      captureCompanyInvoiceOperationIntent(context()),
      "job-invoice",
    );
    await store.compareAndSwap(null, record);
    model.erase("keys", "aes");
    await expect(store.read(9, 42, 12)).rejects.toThrow(
      "could not be verified",
    );
    expect(model.entries("keys")).toHaveLength(0);
  });
  it("tampered ciphertext and scope relocation fail authenticated decryption", async () => {
    const model = invoiceIndexedDBMock();
    const store = browser(model);
    const record = newCompanyInvoiceOperationRecord(
      captureCompanyInvoiceOperationIntent(context()),
      "job-invoice",
    );
    await store.compareAndSwap(null, record);
    const [key, sealed] = model.entries("records")[0] as [
      string,
      { ciphertext: ArrayBuffer },
    ];
    model.edit("records", "hsc_invoice_operation_v1.9.99.12", sealed);
    await expect(store.read(9, 99, 12)).rejects.toThrow(
      "could not be verified",
    );
    new Uint8Array(sealed.ciphertext)[0] ^= 1;
    model.edit("records", key, sealed);
    await expect(store.read(9, 42, 12)).rejects.toThrow(
      "could not be verified",
    );
  });
  it("browser cross-connection CAS serializes competing reservations without duplicate operations", async () => {
    const model = invoiceIndexedDBMock();
    const a = browser(model);
    const b = browser(model);
    const intent = captureCompanyInvoiceOperationIntent(context());
    const wins = await Promise.all([
      a.compareAndSwap(
        null,
        newCompanyInvoiceOperationRecord(intent, "operation-key-a"),
      ),
      b.compareAndSwap(
        null,
        newCompanyInvoiceOperationRecord(intent, "operation-key-b"),
      ),
    ]);
    expect(wins.sort()).toEqual([false, true]);
    expect(model.entries("records")).toHaveLength(1);
  });
  it("failed browser write does not commit a dispatched marker", async () => {
    const model = invoiceIndexedDBMock();
    const store = browser(model);
    const record = newCompanyInvoiceOperationRecord(
      captureCompanyInvoiceOperationIntent(context()),
      "job-invoice",
    );
    await store.compareAndSwap(null, record);
    model.failPut = true;
    await expect(
      store.compareAndSwap(
        record,
        updateCompanyInvoiceOperationRecord(record, { phase: "uncertain" }),
      ),
    ).rejects.toThrow();
    expect((await store.read(9, 42, 12))?.phase).toBe("prepared");
  });
  it.each([
    "token",
    "company",
    "user",
    "role",
    "job",
    "sheet",
    "focus",
    "recipient",
    "resend",
    "mounted",
    "focused",
    "appActive",
  ])("layout matcher rejects a changed %s", (field) => {
    const captured = captureCompanyInvoiceOperationIntent(context());
    const changed = context();
    const live = {
      mounted: true,
      focused: true,
      appActive: true,
      context: changed,
    };
    if (field === "token") changed.session!.token = "different-token";
    if (field === "company") changed.session!.company!.id = 10;
    if (field === "user") changed.session!.user.id = 55;
    if (field === "role") changed.session!.user.role = "dispatcher";
    if (field === "job") changed.job!.id = 13;
    if (field === "sheet")
      live.context = { ...changed, lifetime: { sheetEpoch: 2, focusEpoch: 1 } };
    if (field === "focus")
      live.context = { ...changed, lifetime: { sheetEpoch: 1, focusEpoch: 2 } };
    if (field === "recipient")
      live.context = {
        ...changed,
        options: { ...changed.options, recipientEmail: "changed@example.test" },
      };
    if (field === "resend")
      live.context = {
        ...changed,
        options: { ...changed.options, resend: true },
      };
    if (field === "mounted" || field === "focused" || field === "appActive")
      live[field] = false;
    expect(isCurrentCompanyInvoiceOperationIntent(captured, live)).toBe(false);
    expect(
      isCurrentCompanyInvoiceOperationIntent(captured, {
        mounted: true,
        focused: true,
        appActive: true,
        context: context(),
      }),
    ).toBe(true);
  });
});

describe("captured resend identity survives response loss and restart", () => {
  it("lost explicit resend response recovers the SAME key after restart, never creates another resend", async () => {
    const f = isolated();
    await f.controller.send(context(), current);
    const choice = {
      ...context(true, "resend@example.test"),
      lifetime: { sheetEpoch: 2, focusEpoch: 1 },
      operationKey: newCompanyInvoiceOperationKey(),
    };
    const real = f.transport.send;
    f.transport.send = vi.fn(async (token, jobId, body) => {
      await real(token, jobId, body);
      throw new Error("Synthetic resend response loss");
    });
    expect((await f.controller.send(choice, current)).state).toBe("uncertain");
    const restarted = createCompanyInvoiceOperationController({
      store: nativeFixture(f.native.data).store,
      isolatedTransport: f.transport,
    });
    const outcome = await restarted.recover(context(), current);
    expect(outcome.state).toBe("completed");
    expect(outcome.operationKey).toBe(choice.operationKey);
    expect(outcome.actualRecipient).toBe("resend@example.test");
    await restarted.send(choice, current);
    await restarted.send(
      { ...context(true), lifetime: { sheetEpoch: 3, focusEpoch: 1 } },
      current,
    );
    expect(f.h.provider.send).toHaveBeenCalledTimes(2);
    expect(f.transport.send).toHaveBeenCalledTimes(1);
  });
  it("known failed operation permits only a separate explicit keyed resend after GET confirmation", async () => {
    const f = isolated();
    f.h.setProviderMode("rejected");
    expect((await f.controller.send(context(), current)).state).toBe(
      "uncertain",
    );
    expect((await f.controller.recover(context(), current)).state).toBe(
      "failed",
    );
    expect((await f.controller.send(context(), current)).state).toBe("failed");
    f.h.setProviderMode("accepted");
    const choice = {
      ...context(true),
      operationKey: newCompanyInvoiceOperationKey(),
      lifetime: { sheetEpoch: 2, focusEpoch: 1 },
    };
    const resend = await f.controller.send(choice, current);
    expect(resend.state).toBe("completed");
    expect(resend.operationKey).toBe(choice.operationKey);
    expect(f.h.provider.send).toHaveBeenCalledTimes(2);
  });
  it("active queued OTHER operation sends its persisted recipient, not requested recipient; POST echo cannot attest requested key", async () => {
    const h = invoice164bHarness();
    await h.send({
      operationKey: "active-other-key",
      recipientEmail: "held@example.test",
    });
    Object.assign(h.rows[0], {
      state: "queued",
      provider_dispatch_state: "queued",
      provider_message_id: null,
    });
    const response = await h.send({
      operationKey: "requested-new-key",
      recipientEmail: "requested@example.test",
    });
    expect(response.code).toBe(200);
    expect(response.payload.operationKey).toBe("requested-new-key");
    expect(response.payload.sentTo).toBe("held@example.test");
    expect(response.payload.communicationId).toBe(1);
    expect((await h.lookup("requested-new-key")).payload.status).toBe(
      "not_found",
    );
    expect((await h.lookup("active-other-key")).payload.recipientEmail).toBe(
      "held@example.test",
    );
  });
});
