import { createHash, randomUUID, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companyCreationStore, createCompanyCreationStore, newCompanyCreationOperationKey, type CompanyCreationRecord, type CompanyCreationStoreOptions } from "../lib/company-job-creation-storage";

const mocks = vi.hoisted(() => ({
  uuid: vi.fn(), digest: vi.fn(), get: vi.fn(), set: vi.fn(), remove: vi.fn(), platform: { OS: "ios" },
}));
vi.mock("expo-crypto", () => ({ randomUUID: mocks.uuid, digestStringAsync: mocks.digest, CryptoDigestAlgorithm: { SHA256: "SHA-256" } }));
vi.mock("expo-secure-store", () => ({ getItemAsync: mocks.get, setItemAsync: mocks.set, deleteItemAsync: mocks.remove, WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked-device-only" }));
vi.mock("react-native", () => ({ Platform: mocks.platform }));

const protectedOptions = { keychainAccessible: "unlocked-device-only" };
const PREFIX = "hsc_company_job_creation_v1";
const actor = (companyId = 9, userId = 42) => `${PREFIX}.${companyId}.${userId}`;
const manifestKey = (companyId = 9, userId = 42) => `${actor(companyId, userId)}.manifest`;
function record(changes: Partial<CompanyCreationRecord> = {}): CompanyCreationRecord {
  return {
    version: 1, companyId: 9, userId: 42, operationKey: "hsc-job-operation-a",
    payload: { customerId: 14, priceBookServiceId: 20, scheduledStartAt: "2026-11-20T15:00:00.000Z", scheduledEndAt: "2026-11-20T16:00:00.000Z", addressLine1: "Fixture address", serviceNotes: "Fixture service note" },
    timezone: "America/Chicago", phase: "prepared", jobId: null,
    createdAt: "2026-11-15T20:00:00.000Z", updatedAt: "2026-11-15T20:00:00.000Z", ...changes,
  };
}
function changed(value: CompanyCreationRecord, changes: Partial<CompanyCreationRecord> = {}): CompanyCreationRecord {
  return { ...value, phase: "uncertain", updatedAt: "2026-11-15T20:01:00.000Z", ...changes };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
let secureData: Map<string, string>;
beforeEach(() => {
  vi.clearAllMocks(); mocks.platform.OS = "ios";
  mocks.uuid.mockImplementation(() => randomUUID());
  mocks.digest.mockImplementation(async (_algorithm: string, value: string) => createHash("sha256").update(value).digest("hex"));
  secureData = new Map();
  mocks.get.mockImplementation(async (key: string) => secureData.get(key) ?? null);
  mocks.set.mockImplementation(async (key: string, value: string) => { secureData.set(key, value); });
  mocks.remove.mockImplementation(async (key: string) => { secureData.delete(key); });
});
afterEach(() => { vi.unstubAllGlobals(); });

// Offline IndexedDB model: requests are queued asynchronously; each transaction
// works on structured clones, is serialized across connections, and commits or
// rolls back as a unit. A request's success is deliberately NOT its tx commit.
type MockRequest = { result?: unknown; error?: Error; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void; onblocked?: () => void };
type MockTx = { oncomplete?: () => void; onabort?: () => void; onerror?: () => void; abort(): void; objectStore(name: string): { get(key: string): MockRequest; count(key?: string): MockRequest; put(value: unknown, key: string): MockRequest; delete(key: string): MockRequest } };
function indexedDBMock() {
  let data = new Map<string, Map<string, unknown>>();
  const pending: (() => void)[] = [];
  let busy = false;
  const model = {
    failCommit: false, failOpen: false, blocked: false, failPut: false,
    transactions: [] as { mode: IDBTransactionMode; durability?: string }[],
    close: vi.fn(),
    entries: (store: string) => [...(data.get(store) ?? new Map()).entries()],
    edit: (store: string, key: string, value: unknown) => { data.get(store)!.set(key, structuredClone(value)); },
    erase: (store: string, key: string) => { data.get(store)!.delete(key); },
    factory: undefined as unknown as IDBFactory,
  };
  const startNext = () => {
    if (busy || !pending.length) return;
    busy = true; pending.shift()!();
  };
  const db = {
    onversionchange: undefined as undefined | (() => void),
    close: model.close,
    createObjectStore(name: string) { if (data.has(name)) throw new Error("duplicate store"); data.set(name, new Map()); },
    transaction(_names: string[], mode: IDBTransactionMode, options?: { durability?: string }): MockTx {
      model.transactions.push({ mode, durability: options?.durability });
      let aborted = false;
      let started = false;
      let running = false;
      let ended = false;
      let local: Map<string, Map<string, unknown>>;
      const requests: (() => void)[] = [];
      const finish = () => {
        if (ended) return;
        ended = true;
        busy = false;
        queueMicrotask(startNext);
      };
      const fail = () => {
        aborted = true;
        if (started) { tx.onabort?.(); finish(); }
      };
      const process = () => {
        if (aborted || ended || !started || running) return;
        running = true;
        queueMicrotask(() => {
          running = false;
          if (aborted || ended) return;
          const work = requests.shift();
          if (work) { work(); process(); return; }
          if (model.failCommit && mode === "readwrite") { model.failCommit = false; fail(); return; }
          if (mode === "readwrite") data = local;
          tx.oncomplete?.(); finish();
        });
      };
      const request = (work: () => unknown): MockRequest => {
        const req: MockRequest = {};
        requests.push(() => {
          try { req.result = work(); req.onsuccess?.(); }
          catch (error) { req.error = error as Error; req.onerror?.(); tx.onerror?.(); fail(); }
        });
        process(); return req;
      };
      const tx: MockTx = {
        abort: fail,
        objectStore(name: string) {
          return {
            get: (key) => request(() => structuredClone(local.get(name)!.get(key))),
            count: (key) => request(() => key === undefined ? local.get(name)!.size : Number(local.get(name)!.has(key))),
            put: (value, key) => {
              const cloned = structuredClone(value); // May throw DataCloneError synchronously.
              return request(() => { if (model.failPut) { model.failPut = false; throw new Error("mock put failure"); } local.get(name)!.set(key, cloned); return key; });
            },
            delete: (key) => request(() => { local.get(name)!.delete(key); }),
          };
        },
      };
      pending.push(() => {
        started = true;
        if (aborted) { tx.onabort?.(); finish(); return; }
        local = new Map([...data].map(([name, values]) => [name, new Map([...values].map(([key, value]) => [key, structuredClone(value)]))]));
        process();
      });
      queueMicrotask(startNext);
      return tx;
    },
  };
  model.factory = { open: () => {
    const request: MockRequest = {};
    queueMicrotask(() => {
      if (model.failOpen) { request.error = new Error("mock opening failure"); request.onerror?.(); return; }
      if (model.blocked) { request.onblocked?.(); return; }
      request.result = db;
      if (!data.size) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  } } as unknown as IDBFactory;
  return model;
}
function browserStore(model: ReturnType<typeof indexedDBMock>, extra: CompanyCreationStoreOptions = {}) {
  return createCompanyCreationStore({ platform: "web", indexedDB: model.factory,
    webCrypto: webcrypto as unknown as NonNullable<CompanyCreationStoreOptions["webCrypto"]>, ...extra });
}

describe("Company creation operation keys", () => {
  it("uses the Expo cryptographic UUID generator without a timestamp/random fallback", () => {
    mocks.uuid.mockReturnValue("12345678-1234-4123-8123-123456789abc");
    expect(newCompanyCreationOperationKey()).toBe("hsc-job-12345678-1234-4123-8123-123456789abc");
    expect(mocks.uuid).toHaveBeenCalledTimes(1);
    mocks.uuid.mockImplementation(() => { throw new Error("mock crypto unavailable"); });
    expect(() => newCompanyCreationOperationKey()).toThrow();
  });
});

describe("native protected Company creation snapshots", () => {
  it("is absent until reserved, is actor scoped, and persists the exact immutable payload", async () => {
    const value = record();
    expect(await companyCreationStore.read(9, 42)).toBeNull();
    expect(await companyCreationStore.reserve(value)).toBe(true);
    expect(await createCompanyCreationStore({ platform: "android" }).read(9, 42)).toEqual(value);
    expect(await companyCreationStore.read(10, 42)).toBeNull();
    expect(await companyCreationStore.read(9, 43)).toBeNull();
    const restored = await companyCreationStore.read(9, 42);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored!.payload)).toBe(true);
    expect(mocks.get.mock.calls.every(([, options]) => JSON.stringify(options) === JSON.stringify(protectedOptions))).toBe(true);
    expect(mocks.set.mock.calls.every(([, , options]) => JSON.stringify(options) === JSON.stringify(protectedOptions))).toBe(true);
  });

  it("chunks two maximum non-ASCII notes into bounded ASCII and commits the manifest last", async () => {
    const value = record();
    value.payload = { ...value.payload, serviceNotes: "界".repeat(4000), privateNotes: "é".repeat(4000) };
    expect(await companyCreationStore.reserve(value)).toBe(true);
    const writes = mocks.set.mock.calls;
    expect(writes.length).toBeGreaterThan(20);
    expect(writes.at(-1)![0]).toBe(manifestKey());
    for (const [, content] of writes) { expect(content.length).toBeLessThan(1900); expect(content).toMatch(/^[\x00-\x7f]*$/); }
    expect(await companyCreationStore.read(9, 42)).toEqual(value);
  });

  it("captures a defensive copy before waiting in the actor queue", async () => {
    const value = record();
    const reserve = companyCreationStore.reserve(value);
    value.payload.serviceNotes = "mutated after call";
    value.phase = "rejected";
    await reserve;
    expect((await companyCreationStore.read(9, 42))!.payload.serviceNotes).toBe("Fixture service note");
    expect((await companyCreationStore.read(9, 42))!.phase).toBe("prepared");
  });

  it("serializes concurrent native reads/writes across factories and only one reserve wins", async () => {
    const stores = [companyCreationStore, createCompanyCreationStore({ platform: "ios" })];
    const values = [record(), record({ operationKey: "hsc-job-operation-b" })];
    expect(await Promise.all(stores.map((store, index) => store.reserve(values[index])))).toEqual([true, false]);
    const gate = deferred<void>();
    const oldSet = mocks.set.getMockImplementation()!;
    mocks.set.mockImplementation(async (key, value, options) => { if (key.endsWith(".manifest")) await gate.promise; return oldSet(key, value, options); });
    const update = stores[0].update(changed(values[0]));
    let readDone = false;
    const read = stores[1].read(9, 42).then((value) => { readDone = true; return value; });
    await Promise.resolve(); await Promise.resolve();
    expect(readDone).toBe(false);
    gate.resolve(); expect(await update).toBe(true);
    expect((await read)!.phase).toBe("uncertain");
  });

  it("does not clear a newer operation with stale update/remove calls", async () => {
    const first = record(); const next = record({ operationKey: "hsc-job-operation-b" });
    expect(await companyCreationStore.update(changed(first))).toBe(false);
    await companyCreationStore.reserve(first);
    expect(await companyCreationStore.reserve(next)).toBe(false);
    expect(await companyCreationStore.remove(9, 42, next.operationKey)).toBe(false);
    expect(await companyCreationStore.update(changed(next))).toBe(false);
    expect(await companyCreationStore.remove(9, 42, first.operationKey)).toBe(true);
    expect(await companyCreationStore.reserve(next)).toBe(true);
    expect(await companyCreationStore.remove(9, 42, first.operationKey)).toBe(false);
    expect(await companyCreationStore.update(changed(first))).toBe(false);
    expect(await companyCreationStore.read(9, 42)).toEqual(next);
  });

  it.each(["chunk", "manifest"])("preserves the previous committed lock if an update fails at a %s", async (where) => {
    const first = record(); await companyCreationStore.reserve(first);
    const oldManifest = secureData.get(manifestKey());
    mocks.set.mockImplementation(async (key, value) => {
      if (where === "manifest" ? key.endsWith(".manifest") : !key.endsWith(".manifest")) throw new Error("mock write failure");
      secureData.set(key, value);
    });
    await expect(companyCreationStore.update(changed(first))).rejects.toThrow("mock write failure");
    expect(secureData.get(manifestKey())).toBe(oldManifest);
    expect(await companyCreationStore.read(9, 42)).toEqual(first);
    expect(await companyCreationStore.reserve(record({ operationKey: "hsc-job-operation-b" }))).toBe(false);
  });

  it("retains a newly committed snapshot if the manifest write succeeded before rejecting", async () => {
    const first = record(); await companyCreationStore.reserve(first);
    mocks.set.mockImplementation(async (key, value) => { secureData.set(key, value); if (key.endsWith(".manifest")) throw new Error("mock ambiguous commit"); });
    await expect(companyCreationStore.update(changed(first))).rejects.toThrow();
    expect((await companyCreationStore.read(9, 42))!.phase).toBe("uncertain");
    expect(await companyCreationStore.reserve(record({ operationKey: "hsc-job-operation-b" }))).toBe(false);
  });

  it("uses manifest deletion as the commit and never treats cleanup failure as failed removal", async () => {
    const first = record(); await companyCreationStore.reserve(first);
    mocks.remove.mockImplementation(async (key) => { if (!key.endsWith(".manifest")) throw new Error("mock cleanup failure"); secureData.delete(key); });
    expect(await companyCreationStore.remove(9, 42, first.operationKey)).toBe(true);
    expect(mocks.remove.mock.calls[0]).toEqual([manifestKey(), protectedOptions]);
    expect(await companyCreationStore.read(9, 42)).toBeNull();
    expect(await companyCreationStore.reserve(record({ operationKey: "hsc-job-operation-b" }))).toBe(true);
  });

  it("does not automatically delete saved records and preserves their lock on deletion failure", async () => {
    const first = record(); await companyCreationStore.reserve(first);
    const saved = changed(first, { phase: "saved", jobId: 81 });
    expect(await companyCreationStore.update(saved)).toBe(true);
    expect(await companyCreationStore.read(9, 42)).toEqual(saved);
    mocks.remove.mockRejectedValue(new Error("mock delete failure"));
    await expect(companyCreationStore.remove(9, 42, first.operationKey)).rejects.toThrow();
    expect(await companyCreationStore.read(9, 42)).toEqual(saved);
  });

  it.each(["invalid-json", "wrong-company", "extra-field", "missing-chunk", "edited-chunk", "wrong-length", "wrong-operation"])("fails closed on %s native corruption for read/reserve/update/remove", async (damage) => {
    const first = record(); await companyCreationStore.reserve(first);
    const manifest = JSON.parse(secureData.get(manifestKey())!);
    const firstChunk = `${actor()}.${manifest.snapshot}.0`;
    if (damage === "invalid-json") secureData.set(manifestKey(), "broken-json");
    if (damage === "wrong-company") { manifest.companyId = 10; secureData.set(manifestKey(), JSON.stringify(manifest)); }
    if (damage === "extra-field") { manifest.token = "forbidden"; secureData.set(manifestKey(), JSON.stringify(manifest)); }
    if (damage === "missing-chunk") secureData.delete(firstChunk);
    if (damage === "edited-chunk") secureData.set(firstChunk, secureData.get(firstChunk)!.replace("Fixture", "FixturX"));
    if (damage === "wrong-length") secureData.set(firstChunk, secureData.get(firstChunk)! + " ");
    if (damage === "wrong-operation") { manifest.operationKey = "hsc-job-operation-b"; secureData.set(manifestKey(), JSON.stringify(manifest)); }
    await expect(companyCreationStore.read(9, 42)).rejects.toThrow("could not be verified");
    await expect(companyCreationStore.reserve(first)).rejects.toThrow("could not be verified");
    await expect(companyCreationStore.update(changed(first))).rejects.toThrow("could not be verified");
    await expect(companyCreationStore.remove(9, 42, first.operationKey)).rejects.toThrow("could not be verified");
  });

  it("fails closed on record shape corruption even if chunk hash and manifest remain consistent", async () => {
    const first = record(); await companyCreationStore.reserve(first);
    const manifest = JSON.parse(secureData.get(manifestKey())!);
    const key = `${actor()}.${manifest.snapshot}.0`;
    const data = JSON.parse(secureData.get(key)!);
    data.payload.email = "must-not-persist@example.invalid";
    const raw = JSON.stringify(data);
    secureData.set(key, raw); manifest.bytes = raw.length;
    manifest.sha256 = createHash("sha256").update(raw).digest("hex");
    secureData.set(manifestKey(), JSON.stringify(manifest));
    await expect(companyCreationStore.read(9, 42)).rejects.toThrow("could not be verified");
  });

  it("does not fall back when the protected native store is locked/unavailable", async () => {
    mocks.get.mockRejectedValue(new Error("mock device locked"));
    await expect(companyCreationStore.read(9, 42)).rejects.toThrow("mock device locked");
    await expect(companyCreationStore.reserve(record())).rejects.toThrow("mock device locked");
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("never overwrites live chunks if a cryptographic snapshot ID is unexpectedly repeated", async () => {
    const value = record(); await companyCreationStore.reserve(value);
    const manifest = JSON.parse(secureData.get(manifestKey())!);
    mocks.uuid.mockReturnValue(manifest.snapshot);
    mocks.set.mockClear();
    await expect(companyCreationStore.update(changed(value))).rejects.toThrow("unavailable");
    expect(mocks.set).not.toHaveBeenCalled();
    expect(await companyCreationStore.read(9, 42)).toEqual(value);
  });
});

describe("strict immutable records across both backends", () => {
  for (const backend of ["native", "web"] as const) {
    const setup = () => backend === "native" ? companyCreationStore : browserStore(indexedDBMock());
    it.each([
      ["unknown record field", (r: any) => { r.bearerToken = "forbidden"; }],
      ["unknown payload field", (r: any) => { r.payload.customerName = "forbidden"; }],
      ["nested payload object", (r: any) => { r.payload.serviceNotes = { token: "forbidden" }; }],
      ["invalid ID", (r: any) => { r.payload.customerId = 0; }],
      ["overflow ID", (r: any) => { r.userId = Number.MAX_SAFE_INTEGER + 1; }],
      ["invalid operation", (r: any) => { r.operationKey = "bad"; }],
      ["invalid scheduled date", (r: any) => { r.payload.scheduledStartAt = "2026-02-30T15:00:00.000Z"; }],
      ["reversed dates", (r: any) => { r.payload.scheduledEndAt = r.payload.scheduledStartAt; }],
      ["too-long note", (r: any) => { r.payload.privateNotes = "x".repeat(4001); }],
      ["invalid timezone", (r: any) => { r.timezone = "not/a/timezone"; }],
      ["invalid phase", (r: any) => { r.phase = "succeeded"; }],
      ["missing saved ID", (r: any) => { r.phase = "saved"; }],
      ["invalid timestamp", (r: any) => { r.updatedAt = "tomorrow"; }],
      ["missing version", (r: any) => { delete r.version; }],
    ] as const)(`${backend}: rejects %s without writing`, async (_name, damage) => {
      const store = setup(); const value = record(); damage(value);
      await expect(store.reserve(value)).rejects.toThrow("could not be verified");
      expect(await store.read(9, 42)).toBeNull();
    });
    it(`${backend}: enforces immutable payload/timezone/createdAt and accepts reordered payload fields`, async () => {
      const store = setup(); const value = record(); await store.reserve(value);
      for (const candidate of [
        changed(value, { payload: { ...value.payload, customerId: 99 } }),
        changed(value, { timezone: "UTC" }), changed(value, { createdAt: "2026-11-15T19:00:00.000Z" }),
        changed(value, { updatedAt: "2026-11-15T19:00:00.000Z" }),
      ]) await expect(store.update(candidate)).rejects.toThrow("could not be verified");
      const reordered = Object.fromEntries(Object.entries(value.payload).reverse()) as CompanyCreationRecord["payload"];
      expect(await store.update(changed(value, { payload: reordered }))).toBe(true);
      expect((await store.read(9, 42))!.payload).toEqual(value.payload);
    });
    it(`${backend}: keeps a known saved ID and never regresses saved state`, async () => {
      const store = setup(); const value = record(); await store.reserve(value);
      const saved = changed(value, { phase: "saved", jobId: 81 }); await store.update(saved);
      for (const candidate of [changed(saved, { jobId: null }), changed(saved, { jobId: 82, phase: "saved" }), changed(saved, { phase: "uncertain" }), changed(saved, { phase: "rejected" }), changed(saved, { phase: "conflict" })]) {
        await expect(store.update(candidate)).rejects.toThrow("could not be verified");
      }
      expect(await store.read(9, 42)).toEqual(saved);
    });
  }
});

describe("encrypted web Company creation storage", () => {
  it("stores a structured-cloned nonextractable AES-GCM key and only ciphertext, restoring after a fresh connection", async () => {
    const model = indexedDBMock(); const store = browserStore(model); const first = record();
    expect(await store.reserve(first)).toBe(true);
    expect(await browserStore(model).read(9, 42)).toEqual(first);
    expect(await store.read(10, 42)).toBeNull(); expect(await store.read(9, 43)).toBeNull();
    const [, box] = model.entries("keys")[0] as [string, { key: CryptoKey }];
    expect(box.key.type).toBe("secret"); expect(box.key.extractable).toBe(false); expect(box.key.algorithm.name).toBe("AES-GCM");
    await expect(webcrypto.subtle.exportKey("raw", box.key as any)).rejects.toThrow();
    const [, encrypted] = model.entries("records")[0] as [string, any];
    expect(Object.keys(encrypted).sort()).toEqual(["version", "companyId", "userId", "keyId", "revision", "iv", "ciphertext"].sort());
    expect(encrypted.ciphertext).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.from(encrypted.ciphertext).toString()).not.toContain("Fixture");
    expect(JSON.stringify(encrypted)).not.toContain(first.operationKey);
    expect(model.transactions.filter((tx) => tx.mode === "readwrite").every((tx) => tx.durability === "strict")).toBe(true);
  });

  it("handles concurrent cross-connection reservations and updates with atomic CAS", async () => {
    const model = indexedDBMock(); const a = browserStore(model); const b = browserStore(model);
    const first = record(); const next = record({ operationKey: "hsc-job-operation-b" });
    const results = await Promise.all([a.reserve(first), b.reserve(next)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = (await a.read(9, 42))!;
    const loser = winner.operationKey === first.operationKey ? next : first;
    expect(await b.update(changed(loser))).toBe(false);
    expect(await b.remove(9, 42, loser.operationKey)).toBe(false);
    const sameUpdates = await Promise.all([a.update(changed(winner)), b.update(changed(winner))]);
    expect(sameUpdates).toEqual([true, true]);
    const keys = model.entries("keys"); expect(keys).toHaveLength(1);
    expect((await a.read(9, 42))!.operationKey).toBe(winner.operationKey);
  });

  it("does not let a delayed stale encrypted update replace a newer operation", async () => {
    const model = indexedDBMock(); const a = browserStore(model); const b = browserStore(model);
    const first = record(); const next = record({ operationKey: "hsc-job-operation-b" });
    await a.reserve(first);
    const waiting = deferred<void>(); const started = deferred<void>();
    const wrapped = {
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      subtle: {
        generateKey: webcrypto.subtle.generateKey.bind(webcrypto.subtle),
        decrypt: webcrypto.subtle.decrypt.bind(webcrypto.subtle),
        encrypt: async (...args: Parameters<typeof webcrypto.subtle.encrypt>) => { started.resolve(); await waiting.promise; return webcrypto.subtle.encrypt(...args); },
      },
    } as unknown as NonNullable<CompanyCreationStoreOptions["webCrypto"]>;
    const delayed = browserStore(model, { webCrypto: wrapped }).update(changed(first));
    await started.promise;
    expect(await b.remove(9, 42, first.operationKey)).toBe(true);
    expect(await b.reserve(next)).toBe(true);
    waiting.resolve(); expect(await delayed).toBe(false);
    expect(await a.read(9, 42)).toEqual(next);
  });

  it("changes IV/revision on every write and supports max non-ASCII notes", async () => {
    const model = indexedDBMock(); const store = browserStore(model); const first = record();
    first.payload.privateNotes = "界".repeat(4000); first.payload.serviceNotes = "é".repeat(4000);
    await store.reserve(first);
    const before = structuredClone(model.entries("records")[0][1]) as any;
    expect(await store.update(changed(first))).toBe(true);
    const after = model.entries("records")[0][1] as any;
    expect(after.revision).not.toBe(before.revision); expect(after.iv).not.toEqual(before.iv);
    expect(await store.read(9, 42)).toEqual(changed(first));
  });

  it("does not acknowledge request success when the transaction later aborts", async () => {
    const model = indexedDBMock(); const store = browserStore(model); const first = record();
    await store.reserve(first); model.failCommit = true;
    await expect(store.update(changed(first))).rejects.toThrow("unavailable");
    expect(await store.read(9, 42)).toEqual(first);
    expect(await store.reserve(record({ operationKey: "hsc-job-operation-b" }))).toBe(false);
    model.failCommit = true;
    await expect(store.remove(9, 42, first.operationKey)).rejects.toThrow("unavailable");
    expect(await store.read(9, 42)).toEqual(first);
  });

  it("fails closed and retains the prior record on IDB put errors", async () => {
    const model = indexedDBMock(); const store = browserStore(model); const first = record();
    await store.reserve(first); model.failPut = true;
    await expect(store.update(changed(first))).rejects.toThrow("unavailable");
    expect(await store.read(9, 42)).toEqual(first);
  });

  it.each(["ciphertext", "scope", "extra-field", "revision", "missing-key", "invalid-key", "present-undefined"])("fails closed on %s corruption for all operations", async (damage) => {
    const model = indexedDBMock(); const store = browserStore(model); const first = record(); await store.reserve(first);
    const [key, raw] = model.entries("records")[0]; const encrypted = structuredClone(raw) as any;
    if (damage === "ciphertext") new Uint8Array(encrypted.ciphertext)[0] ^= 1;
    if (damage === "scope") encrypted.companyId = 10;
    if (damage === "extra-field") encrypted.payload = first.payload;
    if (damage === "revision") encrypted.revision = randomUUID();
    if (damage === "missing-key") model.erase("keys", "aes-gcm-v1");
    if (damage === "invalid-key") model.edit("keys", "aes-gcm-v1", { version: 1, id: randomUUID(), key: { extractable: true } });
    model.edit("records", key, damage === "present-undefined" ? undefined : encrypted);
    await expect(store.read(9, 42)).rejects.toThrow("could not be verified");
    await expect(store.reserve(first)).rejects.toThrow("could not be verified");
    await expect(store.update(changed(first))).rejects.toThrow("could not be verified");
    await expect(store.remove(9, 42, first.operationKey)).rejects.toThrow("could not be verified");
  });

  it("never uses plaintext localStorage on unsupported/blocked browsers", async () => {
    const fallback = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("localStorage", fallback);
    for (const options of [{ indexedDB: null }, { webCrypto: null }, { webCrypto: {} as any }]) {
      const store = browserStore(indexedDBMock(), options);
      await expect(store.read(9, 42)).rejects.toThrow("unavailable");
      await expect(store.reserve(record())).rejects.toThrow("unavailable");
    }
    for (const reason of ["blocked", "failOpen"] as const) {
      const model = indexedDBMock(); model[reason] = true;
      await expect(browserStore(model).reserve(record())).rejects.toThrow("unavailable");
    }
    expect(fallback.getItem).not.toHaveBeenCalled(); expect(fallback.setItem).not.toHaveBeenCalled(); expect(fallback.removeItem).not.toHaveBeenCalled();
    await expect(createCompanyCreationStore({ platform: "unsupported" }).reserve(record())).rejects.toThrow("unavailable");
  });

  it("validates the decrypted record scope and payload even when AES-GCM authentication passes", async () => {
    const model = indexedDBMock(); const store = browserStore(model); const first = record();
    await store.reserve(first);
    const [key, raw] = model.entries("records")[0]; const encrypted = structuredClone(raw) as any;
    const box = model.entries("keys")[0][1] as { key: CryptoKey };
    const aad = new TextEncoder().encode(`${actor()}:${encrypted.keyId}:${encrypted.revision}`);
    for (const invalid of [
      { ...first, userId: 43 },
      { ...first, payload: { ...first.payload, phone: "forbidden contact" } },
      { ...first, phase: "saved", jobId: null },
    ]) {
      encrypted.ciphertext = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: encrypted.iv, additionalData: aad }, box.key as any, new TextEncoder().encode(JSON.stringify(invalid)));
      model.edit("records", key, encrypted);
      await expect(store.read(9, 42)).rejects.toThrow("could not be verified");
      await expect(store.reserve(first)).rejects.toThrow("could not be verified");
    }
  });
});
