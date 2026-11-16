import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { normalizeCompanyJobNewCustomer, type JobSyncCompanyJobCreateInput, type JobSyncCompanyJobCustomerSelector } from "./jobsync-mobile-api";

export type CompanyCreationRecord = {
  version: 1;
  companyId: number;
  userId: number;
  operationKey: string;
  payload: JobSyncCompanyJobCreateInput;
  timezone: string;
  phase: "prepared" | "uncertain" | "saved" | "rejected" | "conflict";
  jobId: number | null;
  /** Saved canonical ID is metadata, never a replacement for nested intent. */
  resolvedCustomerId?: number;
  rejectionCode?: string | null;
  rejectionMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};
export interface CompanyCreationStore {
  read(companyId: number, userId: number): Promise<CompanyCreationRecord | null>;
  reserve(record: CompanyCreationRecord): Promise<boolean>;
  update(record: CompanyCreationRecord): Promise<boolean>;
  remove(companyId: number, userId: number, operationKey: string): Promise<boolean>;
}

type NativeStore = Pick<typeof SecureStore, "getItemAsync" | "setItemAsync" | "deleteItemAsync">;
type BrowserCrypto = Pick<Window["crypto"], "subtle" | "getRandomValues">;
export type CompanyCreationStoreOptions = {
  platform?: string;
  secureStore?: NativeStore;
  indexedDB?: IDBFactory | null;
  webCrypto?: BrowserCrypto | null;
};
const PREFIX = "hsc_company_job_creation_v1";
const CHUNK_SIZE = 1800; // ASCII bytes, strictly below the platform's ~2 KiB limit.
const MAX_BYTES = 100_000;
const MAX_CHUNKS = Math.ceil(MAX_BYTES / CHUNK_SIZE);
const DB_NAME = "hsc-company-job-creation-v1";
const KEY_NAME = "aes-gcm-v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nativeQueues = new WeakMap<NativeStore, Map<string, Promise<unknown>>>();
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const unavailable = () => new Error("Protected Company Job recovery storage is unavailable. Do not submit another Job.");
const corrupt = () => new Error("Company Job recovery storage could not be verified. Do not submit another Job.");
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function shape(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  if (!object(value) || required.some((key) => !Object.hasOwn(value, key))
    || Reflect.ownKeys(value).some((key) => typeof key !== "string" || ![...required, ...optional].includes(key))) throw corrupt();
}
function instant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}
function operation(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
function scope(companyId: number, userId: number) {
  if (!positive(companyId) || !positive(userId)) throw corrupt();
  return `${PREFIX}.${companyId}.${userId}`;
}
function uuid() {
  const value = Crypto.randomUUID();
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw unavailable();
  return value;
}
export function newCompanyCreationOperationKey(): string { return `hsc-job-${uuid()}`; }

const textLimits = { addressLine1: 255, city: 96, region: 96, postalCode: 24, serviceNotes: 4000, privateNotes: 4000 } as const;
function payloadCopy(value: unknown): JobSyncCompanyJobCreateInput {
  shape(value, ["priceBookServiceId", "scheduledStartAt"],
    ["customerId", "newCustomer", "vehiclePriceKey", "assignedUserId", "scheduledEndAt", ...Object.keys(textLimits)]);
  if (Object.hasOwn(value, "customerId") === Object.hasOwn(value, "newCustomer")
    || (Object.hasOwn(value, "customerId") && !positive(value.customerId))
    || !positive(value.priceBookServiceId) || !instant(value.scheduledStartAt)) throw corrupt();
  let selector: JobSyncCompanyJobCustomerSelector;
  if (Object.hasOwn(value, "newCustomer")) {
    try {
      const nested = normalizeCompanyJobNewCustomer(value.newCustomer);
      // Recovery never silently repairs/normalizes a corrupted stored intent.
      const source = value.newCustomer as Record<string, unknown>;
      if (Object.keys(source).length !== Object.keys(nested).length
        || Object.keys(source).some((key) => source[key] !== nested[key as keyof typeof nested])) throw corrupt();
      selector = { newCustomer: nested };
    } catch { throw corrupt(); }
  } else selector = { customerId: value.customerId as number };
  const result: JobSyncCompanyJobCreateInput = {
    ...selector, priceBookServiceId: value.priceBookServiceId, scheduledStartAt: value.scheduledStartAt,
  };
  if (value.scheduledEndAt !== undefined) {
    if (!instant(value.scheduledEndAt) || Date.parse(value.scheduledEndAt) <= Date.parse(value.scheduledStartAt)) throw corrupt();
    result.scheduledEndAt = value.scheduledEndAt;
  }
  if (value.assignedUserId !== undefined) {
    if (value.assignedUserId !== null && !positive(value.assignedUserId)) throw corrupt();
    result.assignedUserId = value.assignedUserId;
  }
  if (value.vehiclePriceKey !== undefined) {
    if (value.vehiclePriceKey !== null && (typeof value.vehiclePriceKey !== "string"
      || !value.vehiclePriceKey.trim() || value.vehiclePriceKey.length > 64 || value.vehiclePriceKey !== value.vehiclePriceKey.trim())) throw corrupt();
    result.vehiclePriceKey = value.vehiclePriceKey;
  }
  for (const key of Object.keys(textLimits) as (keyof typeof textLimits)[]) {
    const field = value[key];
    if (field === undefined) continue;
    if (typeof field !== "string" || field.length > textLimits[key]) throw corrupt();
    result[key] = field; // Preserve the exact submitted text; never normalize on recovery.
  }
  return Object.freeze(result);
}
function recordCopy(value: unknown, companyId?: number, userId?: number): CompanyCreationRecord {
  shape(value, ["version", "companyId", "userId", "operationKey", "payload", "timezone", "phase", "jobId", "createdAt", "updatedAt"],
    ["rejectionCode", "rejectionMessage", "resolvedCustomerId"]);
  if (value.version !== 1 || !positive(value.companyId) || !positive(value.userId)
    || (companyId !== undefined && value.companyId !== companyId) || (userId !== undefined && value.userId !== userId)
    || !operation(value.operationKey) || typeof value.timezone !== "string" || !value.timezone.trim()
    || value.timezone.length > 128 || value.timezone !== value.timezone.trim()
    || !["prepared", "uncertain", "saved", "rejected", "conflict"].includes(value.phase as string)
    || (value.jobId !== null && !positive(value.jobId)) || (value.phase === "saved" && !positive(value.jobId))
    || (["prepared", "rejected"].includes(value.phase as string) && value.jobId !== null)
    || !instant(value.createdAt) || !instant(value.updatedAt) || Date.parse(value.updatedAt) < Date.parse(value.createdAt)) throw corrupt();
  try { new Intl.DateTimeFormat("en-US", { timeZone: value.timezone }); } catch { throw corrupt(); }
  const result: CompanyCreationRecord = {
    version: 1, companyId: value.companyId, userId: value.userId, operationKey: value.operationKey,
    payload: payloadCopy(value.payload), timezone: value.timezone, phase: value.phase as CompanyCreationRecord["phase"],
    jobId: value.jobId as number | null, createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
  if (Object.hasOwn(value, "resolvedCustomerId")) {
    if (!positive(value.resolvedCustomerId) || !positive(value.jobId)
      || (result.payload.customerId !== undefined && value.resolvedCustomerId !== result.payload.customerId)) throw corrupt();
    result.resolvedCustomerId = value.resolvedCustomerId;
  }
  for (const [key, limit] of [["rejectionCode", 128], ["rejectionMessage", 4000]] as const) {
    const field = value[key];
    if (field === undefined) continue;
    if (field !== null && (typeof field !== "string" || field.length > limit)) throw corrupt();
    result[key] = field;
  }
  return Object.freeze(result);
}
function ascii(value: unknown) {
  const serialized = JSON.stringify(value).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  if (serialized.length > MAX_BYTES) throw corrupt();
  return serialized;
}
function parse(value: string): unknown {
  try { return JSON.parse(value); } catch { throw corrupt(); }
}
function compatible(previous: CompanyCreationRecord, next: CompanyCreationRecord) {
  if (previous.createdAt !== next.createdAt || previous.timezone !== next.timezone
    || ascii(previous.payload) !== ascii(next.payload) || Date.parse(next.updatedAt) < Date.parse(previous.updatedAt)
    || (previous.resolvedCustomerId !== undefined && next.resolvedCustomerId !== previous.resolvedCustomerId)
    || (previous.jobId !== null && (next.jobId !== previous.jobId || !["saved", "conflict"].includes(next.phase)))
    || (previous.phase === "saved" && next.phase !== "saved")) throw corrupt();
}
function serialized<T>(adapter: NativeStore, actor: string, work: () => Promise<T>): Promise<T> {
  let queues = nativeQueues.get(adapter);
  if (!queues) nativeQueues.set(adapter, queues = new Map());
  const tail = (queues.get(actor) ?? Promise.resolve()).catch(() => undefined).then(work);
  queues.set(actor, tail);
  void tail.finally(() => { if (queues!.get(actor) === tail) queues!.delete(actor); }).catch(() => undefined);
  return tail;
}

type Manifest = {
  version: 1; companyId: number; userId: number; operationKey: string;
  snapshot: string; chunks: number; bytes: number; sha256: string;
};
function manifestCopy(value: unknown, companyId: number, userId: number): Manifest {
  shape(value, ["version", "companyId", "userId", "operationKey", "snapshot", "chunks", "bytes", "sha256"]);
  if (value.version !== 1 || value.companyId !== companyId || value.userId !== userId || !operation(value.operationKey)
    || typeof value.snapshot !== "string" || !UUID_PATTERN.test(value.snapshot)
    || !positive(value.chunks) || value.chunks > MAX_CHUNKS || !positive(value.bytes) || value.bytes > MAX_BYTES
    || value.chunks !== Math.ceil(value.bytes / CHUNK_SIZE) || typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256)) throw corrupt();
  return value as Manifest;
}
const digest = (value: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
function nativeStore(adapter: NativeStore): CompanyCreationStore {
  const manifestKey = (actor: string) => `${actor}.manifest`;
  const chunkKey = (actor: string, manifest: Manifest, index: number) => `${actor}.${manifest.snapshot}.${index}`;
  async function load(companyId: number, userId: number) {
    const actor = scope(companyId, userId);
    const raw = await adapter.getItemAsync(manifestKey(actor), secureOptions);
    if (raw === null) return { record: null, manifest: null };
    if (typeof raw !== "string" || raw.length >= 1900) throw corrupt();
    const manifest = manifestCopy(parse(raw), companyId, userId);
    let data = "";
    for (let index = 0; index < manifest.chunks; index++) {
      const chunk = await adapter.getItemAsync(chunkKey(actor, manifest, index), secureOptions);
      const expected = index === manifest.chunks - 1 ? manifest.bytes - index * CHUNK_SIZE : CHUNK_SIZE;
      if (typeof chunk !== "string" || chunk.length !== expected || /[^\x00-\x7f]/.test(chunk)) throw corrupt();
      data += chunk;
    }
    if (data.length !== manifest.bytes || await digest(data) !== manifest.sha256) throw corrupt();
    const record = recordCopy(parse(data), companyId, userId);
    if (record.operationKey !== manifest.operationKey) throw corrupt();
    return { record, manifest };
  }
  async function cleanup(actor: string, manifest: Manifest | null) {
    if (!manifest) return;
    for (let index = 0; index < manifest.chunks; index++) {
      // The committed manifest alone controls presence. Cleanup cannot undo it.
      try { await adapter.deleteItemAsync(chunkKey(actor, manifest, index), secureOptions); } catch { /* protected orphan; no plaintext/logging */ }
    }
  }
  async function write(record: CompanyCreationRecord, previous: Manifest | null) {
    const actor = scope(record.companyId, record.userId);
    const data = ascii(record);
    const manifest: Manifest = { version: 1, companyId: record.companyId, userId: record.userId, operationKey: record.operationKey,
      snapshot: uuid(), chunks: Math.ceil(data.length / CHUNK_SIZE), bytes: data.length, sha256: await digest(data) };
    if (previous?.snapshot === manifest.snapshot) throw unavailable();
    for (let index = 0; index < manifest.chunks; index++) {
      await adapter.setItemAsync(chunkKey(actor, manifest, index), data.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE), secureOptions);
    }
    // Never overwrite chunks in the currently committed snapshot. A failed or
    // ambiguous manifest write leaves both snapshots intact for fail-closed reads.
    await adapter.setItemAsync(manifestKey(actor), ascii(manifest), secureOptions);
    await cleanup(actor, previous);
  }
  return {
    read: async (companyId, userId) => serialized(adapter, scope(companyId, userId), async () => (await load(companyId, userId)).record),
    async reserve(value) {
      const record = recordCopy(value); // Capture before the first await / queue.
      return serialized(adapter, scope(record.companyId, record.userId), async () => {
        const previous = await load(record.companyId, record.userId);
        if (previous.record) return false;
        await write(record, null); return true;
      });
    },
    async update(value) {
      const record = recordCopy(value);
      return serialized(adapter, scope(record.companyId, record.userId), async () => {
        const previous = await load(record.companyId, record.userId);
        if (!previous.record || previous.record.operationKey !== record.operationKey) return false;
        compatible(previous.record, record);
        await write(record, previous.manifest); return true;
      });
    },
    async remove(companyId, userId, operationKey) {
      if (!operation(operationKey)) throw corrupt();
      return serialized(adapter, scope(companyId, userId), async () => {
        const previous = await load(companyId, userId);
        if (!previous.record || previous.record.operationKey !== operationKey) return false;
        // Only the controller may call this after actual calendar confirmation.
        await adapter.deleteItemAsync(manifestKey(scope(companyId, userId)), secureOptions);
        await cleanup(scope(companyId, userId), previous.manifest); return true;
      });
    },
  };
}

type KeyBox = { version: 1; id: string; key: CryptoKey };
type Envelope = { version: 1; companyId: number; userId: number; keyId: string; revision: string; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer };
function keyBox(value: unknown): KeyBox {
  shape(value, ["version", "id", "key"]);
  const key = value.key as CryptoKey | undefined;
  if (value.version !== 1 || typeof value.id !== "string" || !UUID_PATTERN.test(value.id)
    || !key || key.type !== "secret" || key.extractable !== false || key.algorithm?.name !== "AES-GCM"
    || (key.algorithm as AesKeyAlgorithm).length !== 256 || key.usages.length !== 2
    || !key.usages.includes("encrypt") || !key.usages.includes("decrypt")) throw corrupt();
  return value as KeyBox;
}
function envelope(value: unknown, companyId: number, userId: number, keyId: string): Envelope {
  shape(value, ["version", "companyId", "userId", "keyId", "revision", "iv", "ciphertext"]);
  if (value.version !== 1 || value.companyId !== companyId || value.userId !== userId || value.keyId !== keyId
    || typeof value.revision !== "string" || !UUID_PATTERN.test(value.revision)
    || !(value.iv instanceof Uint8Array) || value.iv.length !== 12 || !(value.ciphertext instanceof ArrayBuffer)
    || value.ciphertext.byteLength < 16 || value.ciphertext.byteLength > MAX_BYTES + 16) throw corrupt();
  return value as Envelope;
}
function bytes(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(value, (char) => char.charCodeAt(0)); }
function equalBytes(a: ArrayBuffer | Uint8Array, b: ArrayBuffer | Uint8Array) {
  const x = a instanceof Uint8Array ? a : new Uint8Array(a);
  const y = b instanceof Uint8Array ? b : new Uint8Array(b);
  return x.length === y.length && x.every((value, index) => value === y[index]);
}
function sameEnvelope(a: Envelope | null, b: Envelope | null) {
  return a === null || b === null ? a === b : a.revision === b.revision && a.keyId === b.keyId
    && a.companyId === b.companyId && a.userId === b.userId && equalBytes(a.iv, b.iv) && equalBytes(a.ciphertext, b.ciphertext);
}
function openDB(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    let failed = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore("keys");
      request.result.createObjectStore("records");
    };
    request.onerror = () => { failed = true; reject(unavailable()); };
    request.onblocked = () => { failed = true; reject(unavailable()); };
    request.onsuccess = () => {
      if (failed) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
// No asynchronous crypto inside a live IDB transaction: callbacks synchronously
// queue all dependent writes; resolve only on commit, never on request success.
function transaction<T>(db: IDBDatabase, mode: IDBTransactionMode, work: (tx: CallbackTransaction, done: (value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = mode === "readwrite" ? db.transaction(["keys", "records"], mode, { durability: "strict" })
      : db.transaction(["keys", "records"], mode);
    let result: T;
    let finished = false;
    let failure: unknown;
    const abort = (error: unknown) => { failure = error; try { tx.abort(); } catch { reject(error); } };
    tx.onabort = () => reject(failure ?? unavailable());
    tx.onerror = () => { failure ??= unavailable(); };
    tx.oncomplete = () => finished ? resolve(result) : reject(corrupt());
    // Exceptions in request handlers must abort rather than commit partial work.
    const originalStore = tx.objectStore.bind(tx);
    const safeTx = { objectStore: (name: string) => {
      const store = originalStore(name);
      return {
        get: (key: IDBValidKey, callback: (value: unknown) => void) => {
          const request = store.get(key);
          request.onsuccess = () => { try { callback(request.result); } catch (error) { abort(error); } };
        },
        count: (key: IDBValidKey | undefined, callback: (value: number) => void) => {
          const request = key === undefined ? store.count() : store.count(key);
          request.onsuccess = () => { try { callback(request.result); } catch (error) { abort(error); } };
        },
        put: (value: unknown, key: IDBValidKey) => store.put(value, key),
        delete: (key: IDBValidKey) => store.delete(key),
      };
    } };
    try { work(safeTx, (value) => { result = value; finished = true; }); } catch (error) { abort(error); }
  });
}
// These narrow callback helpers are deliberately not promise-based: an await
// between IDB reads and writes can auto-commit a transaction in real browsers.
type CallbackStore = {
  get(key: IDBValidKey, callback: (value: unknown) => void): void;
  count(key: IDBValidKey | undefined, callback: (value: number) => void): void;
  put(value: unknown, key: IDBValidKey): void;
  delete(key: IDBValidKey): void;
};
type CallbackTransaction = { objectStore(name: string): CallbackStore };
const stores = (tx: CallbackTransaction) => ({ keys: tx.objectStore("keys"), records: tx.objectStore("records") });
function webStore(options: CompanyCreationStoreOptions): CompanyCreationStore {
  async function access<T>(work: (db: IDBDatabase, crypto: BrowserCrypto) => Promise<T>) {
    const crypto = options.webCrypto === undefined ? globalThis.crypto : options.webCrypto;
    const factory = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
    if (!crypto?.subtle || typeof crypto.getRandomValues !== "function" || !factory || typeof factory.open !== "function") throw unavailable();
    let db: IDBDatabase | undefined;
    try { db = await openDB(factory); return await work(db, crypto); }
    catch (error) { if (error instanceof Error && [corrupt().message, unavailable().message].includes(error.message)) throw error; throw unavailable(); }
    finally { db?.close(); }
  }
  async function ensureKey(db: IDBDatabase, crypto: BrowserCrypto) {
    const existing = await transaction<KeyBox | null>(db, "readonly", (tx, done) => {
      const { keys } = stores(tx);
      keys.count(KEY_NAME, (count) => keys.get(KEY_NAME, (value) => done(count ? keyBox(value) : null)));
    });
    if (existing) return existing;
    const generated: KeyBox = { version: 1, id: uuid(), key: await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]) };
    keyBox(generated);
    return transaction<KeyBox>(db, "readwrite", (tx, done) => {
      const { keys, records } = stores(tx);
      keys.count(KEY_NAME, (count) => keys.get(KEY_NAME, (value) => {
        if (count) { done(keyBox(value)); return; }
        records.count(undefined, (recordCount) => {
          if (recordCount !== 0) throw corrupt(); // Never silently replace a lost encryption key.
          keys.put(generated, KEY_NAME); done(generated);
        });
      }));
    });
  }
  async function load(db: IDBDatabase, crypto: BrowserCrypto, companyId: number, userId: number) {
    await ensureKey(db, crypto);
    const actor = scope(companyId, userId);
    const snapshot = await transaction<{ box: KeyBox; encrypted: Envelope | null }>(db, "readonly", (tx, done) => {
      const { keys, records } = stores(tx);
      keys.get(KEY_NAME, (value) => {
        const box = keyBox(value);
        records.count(actor, (count) => records.get(actor, (raw) => done({ box, encrypted: count ? envelope(raw, companyId, userId, box.id) : null })));
      });
    });
    if (!snapshot.encrypted) return { ...snapshot, record: null };
    const encrypted = snapshot.encrypted;
    let plaintext: ArrayBuffer;
    try { plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: encrypted.iv, additionalData: bytes(`${actor}:${encrypted.keyId}:${encrypted.revision}`), tagLength: 128 }, snapshot.box.key, encrypted.ciphertext); }
    catch { throw corrupt(); }
    const decoded = new Uint8Array(plaintext);
    if (decoded.length > MAX_BYTES || decoded.some((value) => value > 127)) throw corrupt();
    let data = "";
    for (const value of decoded) data += String.fromCharCode(value);
    return { ...snapshot, record: recordCopy(parse(data), companyId, userId) };
  }
  async function mutate(companyId: number, userId: number, operationKey: string, next: CompanyCreationRecord | null, reserve: boolean) {
    const actor = scope(companyId, userId);
    return access(async (db, crypto) => {
      for (let retry = 0; retry < 8; retry++) {
        const previous = await load(db, crypto, companyId, userId);
        if (reserve ? previous.record !== null : !previous.record || previous.record.operationKey !== operationKey) return false;
        if (previous.record && next) compatible(previous.record, next);
        let encrypted: Envelope | null = null;
        if (next) {
          const revision = uuid();
          const iv = crypto.getRandomValues(new Uint8Array(12));
          encrypted = { version: 1, companyId, userId, keyId: previous.box.id, revision, iv,
            ciphertext: await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: bytes(`${actor}:${previous.box.id}:${revision}`), tagLength: 128 }, previous.box.key, bytes(ascii(next))) };
        }
        const committed = await transaction<boolean>(db, "readwrite", (tx, done) => {
          const { keys, records } = stores(tx);
          keys.get(KEY_NAME, (value) => {
            if (keyBox(value).id !== previous.box.id) throw corrupt();
            records.count(actor, (count) => records.get(actor, (raw) => {
              const current = count ? envelope(raw, companyId, userId, previous.box.id) : null;
              if (!sameEnvelope(current, previous.encrypted)) { done(false); return; }
              if (encrypted) records.put(encrypted, actor); else records.delete(actor);
              done(true);
            }));
          });
        });
        if (committed) return true;
      }
      throw unavailable(); // Excessive contention is never treated as absence.
    });
  }
  return {
    async read(companyId, userId) { scope(companyId, userId); return access(async (db, crypto) => (await load(db, crypto, companyId, userId)).record); },
    async reserve(value) { const record = recordCopy(value); return mutate(record.companyId, record.userId, record.operationKey, record, true); },
    async update(value) { const record = recordCopy(value); return mutate(record.companyId, record.userId, record.operationKey, record, false); },
    async remove(companyId, userId, operationKey) { if (!operation(operationKey)) throw corrupt(); return mutate(companyId, userId, operationKey, null, false); },
  };
}

/** Injectable adapters for focused offline tests; never a plaintext fallback. */
export function createCompanyCreationStore(options: CompanyCreationStoreOptions = {}): CompanyCreationStore {
  const platform = options.platform ?? Platform.OS;
  if (platform === "web") return webStore(options);
  if (platform === "ios" || platform === "android") return nativeStore(options.secureStore ?? SecureStore);
  return {
    read: async () => { throw unavailable(); }, reserve: async () => { throw unavailable(); },
    update: async () => { throw unavailable(); }, remove: async () => { throw unavailable(); },
  };
}
export const companyCreationStore = createCompanyCreationStore();
