import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { z } from "zod";
import {
  normalizeCompanyInvoiceOperationKey,
  normalizeCompanyInvoiceOperationLookup,
  normalizeLegacyCompanyInvoiceOperationLookup,
  type CompanyInvoiceOperationLookup,
  type CompanyInvoiceOperationIntent,
  type CompanyInvoiceOperationOriginalEvidence,
} from "./company-job-invoice-operation";

export type CompanyInvoiceOperationRecord = Readonly<{
  version: 1;
  revision: string;
  companyId: number;
  userId: number;
  jobId: number;
  role: "owner" | "dispatcher";
  operationKey: string;
  resend: boolean;
  requestedRecipient: string | null;
  /** Optional for read-only legacy hold. New evidence is captured BEFORE first POST. */
  originalEvidence?: CompanyInvoiceOperationOriginalEvidence;
  phase: "prepared" | "uncertain" | "verified" | "conflict";
  lookup: CompanyInvoiceOperationLookup | null;
  /** POST identity must agree with GET even if the response was reused. */
  receiptIdentity: Readonly<{
    communicationId: number;
    recipientEmail: string;
  }> | null;
}>;
export interface CompanyInvoiceOperationStore {
  read(
    companyId: number,
    userId: number,
    jobId: number,
  ): Promise<CompanyInvoiceOperationRecord | null>;
  compareAndSwap(
    previous: CompanyInvoiceOperationRecord | null,
    next: CompanyInvoiceOperationRecord,
  ): Promise<boolean>;
}
type NativeStore = Pick<
  typeof SecureStore,
  "getItemAsync" | "setItemAsync" | "deleteItemAsync"
>;
type BrowserCrypto = Pick<Window["crypto"], "subtle" | "getRandomValues">;
export type CompanyInvoiceOperationStorageOptions = {
  platform?: string;
  secureStore?: NativeStore;
  indexedDB?: IDBFactory | null;
  webCrypto?: BrowserCrypto | null;
};
const unavailable = () =>
  new Error(
    "Protected invoice recovery storage is unavailable. Do not send another invoice.",
  );
const corrupt = () =>
  new Error(
    "Protected invoice recovery could not be verified. Do not send another invoice.",
  );
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const schema = z
  .object({
    version: z.literal(1),
    revision: z.string().regex(UUID),
    companyId: id,
    userId: id,
    jobId: id,
    role: z.enum(["owner", "dispatcher"]),
    operationKey: z.string(),
    resend: z.boolean(),
    requestedRecipient: z.string().email().max(320).nullable(),
    originalEvidence: z
      .object({
        customerId: id,
        recipientEmail: z.string().email().max(320),
        intentKind: z.enum(["initial", "resend"]),
      })
      .strict()
      .optional(),
    phase: z.enum(["prepared", "uncertain", "verified", "conflict"]),
    lookup: z.unknown(),
    receiptIdentity: z
      .object({
        communicationId: id,
        recipientEmail: z.string().email().max(320),
      })
      .strict()
      .nullable(),
  })
  .strict();
export function copyCompanyInvoiceOperationRecord(
  value: unknown,
): CompanyInvoiceOperationRecord {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw corrupt();
  const data = parsed.data;
  normalizeCompanyInvoiceOperationKey(data.operationKey);
  if (
    data.requestedRecipient !== null &&
    data.requestedRecipient !== data.requestedRecipient.toLowerCase()
  )
    throw corrupt();
  if (
    data.originalEvidence &&
    (data.originalEvidence.recipientEmail !==
      data.originalEvidence.recipientEmail.toLowerCase() ||
      data.originalEvidence.intentKind !==
        (data.resend ? "resend" : "initial") ||
      (data.requestedRecipient !== null &&
        data.requestedRecipient !== data.originalEvidence.recipientEmail))
  )
    throw corrupt();
  const lookup =
    data.lookup === null
      ? null
      : data.lookup &&
          typeof data.lookup === "object" &&
          "companyId" in data.lookup
        ? normalizeCompanyInvoiceOperationLookup(
            data.lookup,
            data.operationKey,
            {
              companyId: data.companyId,
              jobId: data.jobId,
              ...(data.originalEvidence ?? {}),
            },
          )
        : normalizeLegacyCompanyInvoiceOperationLookup(
            data.lookup,
            data.operationKey,
          );
  if (data.phase === "prepared" && (lookup || data.receiptIdentity))
    throw corrupt();
  if (
    data.phase === "verified" &&
    (!lookup ||
      ["not_found", "temporarily_unavailable"].includes(lookup.status))
  )
    throw corrupt();
  return Object.freeze({
    ...data,
    lookup,
    ...(data.originalEvidence
      ? { originalEvidence: Object.freeze({ ...data.originalEvidence }) }
      : {}),
    receiptIdentity: data.receiptIdentity
      ? Object.freeze({ ...data.receiptIdentity })
      : null,
  });
}
export function newCompanyInvoiceOperationKey(): string {
  return `hsc-invoice-${newRevision()}`;
}
function newRevision() {
  const value = Crypto.randomUUID();
  if (!UUID.test(value)) throw unavailable();
  return value;
}
export function newCompanyInvoiceOperationRecord(
  intent: CompanyInvoiceOperationIntent,
  operationKey: string,
): CompanyInvoiceOperationRecord {
  return copyCompanyInvoiceOperationRecord({
    version: 1,
    revision: newRevision(),
    companyId: intent.companyId,
    userId: intent.userId,
    jobId: intent.jobId,
    role: intent.role,
    operationKey,
    resend: intent.options.resend,
    requestedRecipient: intent.options.recipientEmail ?? null,
    ...(intent.originalEvidence
      ? { originalEvidence: intent.originalEvidence }
      : {}),
    phase: "prepared",
    lookup: null,
    receiptIdentity: null,
  });
}
export function updateCompanyInvoiceOperationRecord(
  record: CompanyInvoiceOperationRecord,
  change: Partial<
    Pick<CompanyInvoiceOperationRecord, "phase" | "lookup" | "receiptIdentity">
  >,
): CompanyInvoiceOperationRecord {
  return copyCompanyInvoiceOperationRecord({
    ...record,
    ...change,
    revision: newRevision(),
  });
}
const PREFIX = "hsc_invoice_operation_v1";
const MAX_BYTES = 16000;
const CHUNK_SIZE = 1800;
const secureOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
function scope(c: number, u: number, j: number) {
  if (![c, u, j].every(positive)) throw corrupt();
  return `${PREFIX}.${c}.${u}.${j}`;
}
function recordScope(record: CompanyInvoiceOperationRecord) {
  return scope(record.companyId, record.userId, record.jobId);
}
function ascii(value: unknown) {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
function parseRecord(raw: string, actor: string) {
  if (raw.length > MAX_BYTES) throw corrupt();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw corrupt();
  }
  const record = copyCompanyInvoiceOperationRecord(value);
  if (recordScope(record) !== actor) throw corrupt();
  return record;
}
function compatible(
  previous: CompanyInvoiceOperationRecord | null,
  next: CompanyInvoiceOperationRecord,
) {
  if (!previous) return;
  if (recordScope(previous) !== recordScope(next)) throw corrupt();
  if (previous.operationKey !== next.operationKey) {
    if (
      previous.phase !== "verified" ||
      !previous.originalEvidence ||
      !next.originalEvidence ||
      !previous.lookup ||
      !["provider_accepted", "delivered", "failed"].includes(
        previous.lookup.status,
      ) ||
      !next.resend ||
      next.phase !== "prepared"
    )
      throw corrupt();
  } else {
    if (
      previous.role !== next.role ||
      previous.resend !== next.resend ||
      previous.requestedRecipient !== next.requestedRecipient ||
      JSON.stringify(previous.originalEvidence) !==
        JSON.stringify(next.originalEvidence) ||
      next.phase === "prepared" ||
      (previous.phase === "conflict" && next.phase !== "conflict")
    )
      throw corrupt();
    if (
      previous.lookup?.communicationId &&
      next.lookup?.communicationId &&
      (previous.lookup.communicationId !== next.lookup.communicationId ||
        previous.lookup.recipientEmail !== next.lookup.recipientEmail)
    )
      throw corrupt();
    if (
      previous.receiptIdentity &&
      (!next.receiptIdentity ||
        JSON.stringify(previous.receiptIdentity) !==
          JSON.stringify(next.receiptIdentity))
    )
      throw corrupt();
  }
}
const queues = new WeakMap<NativeStore, Map<string, Promise<unknown>>>();
function serialized<T>(
  adapter: NativeStore,
  actor: string,
  work: () => Promise<T>,
) {
  let map = queues.get(adapter);
  if (!map) {
    map = new Map();
    queues.set(adapter, map);
  }
  const next = (map.get(actor) ?? Promise.resolve()).then(work, work);
  const settled = next.catch(() => undefined);
  map.set(actor, settled);
  void settled.then(() => {
    if (map?.get(actor) === settled) map.delete(actor);
  });
  return next;
}
type Manifest = { version: 1; revision: string; chunks: number; bytes: number };
function manifest(raw: string): Manifest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw corrupt();
  }
  const parsed = z
    .object({
      version: z.literal(1),
      revision: z.string().regex(UUID),
      chunks: z.number().int().min(1).max(9),
      bytes: z.number().int().min(1).max(MAX_BYTES),
    })
    .strict()
    .safeParse(value);
  if (
    !parsed.success ||
    Math.ceil(parsed.data.bytes / CHUNK_SIZE) !== parsed.data.chunks
  )
    throw corrupt();
  return parsed.data;
}
function nativeStore(adapter: NativeStore): CompanyInvoiceOperationStore {
  async function load(actor: string) {
    const raw = await adapter.getItemAsync(`${actor}.manifest`, secureOptions);
    if (raw === null) return { record: null, manifest: null };
    const head = manifest(raw);
    let data = "";
    for (let index = 0; index < head.chunks; index++) {
      const chunk = await adapter.getItemAsync(
        `${actor}.${head.revision}.${index}`,
        secureOptions,
      );
      if (
        chunk === null ||
        chunk.length !== Math.min(CHUNK_SIZE, head.bytes - index * CHUNK_SIZE)
      )
        throw corrupt();
      data += chunk;
    }
    const record = parseRecord(data, actor);
    if (record.revision !== head.revision) throw corrupt();
    return { record, manifest: head };
  }
  return {
    read: (c, u, j) => {
      const actor = scope(c, u, j);
      return serialized(adapter, actor, async () => (await load(actor)).record);
    },
    compareAndSwap(previousValue, nextValue) {
      const previous = previousValue
        ? copyCompanyInvoiceOperationRecord(previousValue)
        : null;
      const next = copyCompanyInvoiceOperationRecord(nextValue);
      const actor = recordScope(next);
      compatible(previous, next);
      return serialized(adapter, actor, async () => {
        const current = await load(actor);
        if ((current.record?.revision ?? null) !== (previous?.revision ?? null))
          return false;
        const raw = ascii(next);
        if (raw.length > MAX_BYTES) throw corrupt();
        const head: Manifest = {
          version: 1,
          revision: next.revision,
          bytes: raw.length,
          chunks: Math.ceil(raw.length / CHUNK_SIZE),
        };
        for (let index = 0; index < head.chunks; index++) {
          const chunkKey = `${actor}.${head.revision}.${index}`;
          const chunk = raw.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
          await adapter.setItemAsync(chunkKey, chunk, secureOptions);
          if ((await adapter.getItemAsync(chunkKey, secureOptions)) !== chunk)
            throw corrupt();
        }
        // Write and verify immutable chunks before atomically replacing the small
        // manifest. A crash before commit retains the previous dispatched pointer.
        await adapter.setItemAsync(
          `${actor}.manifest`,
          JSON.stringify(head),
          secureOptions,
        );
        if ((await load(actor)).record?.revision !== next.revision)
          throw corrupt();
        if (current.manifest) {
          // Cleanup is best effort AFTER durable commit, never undoing the pointer.
          for (let index = 0; index < current.manifest.chunks; index++) {
            await adapter
              .deleteItemAsync(
                `${actor}.${current.manifest.revision}.${index}`,
                secureOptions,
              )
              .catch(() => undefined);
          }
        }
        return true;
      });
    },
  };
}

// Browser primitives mirror the existing protected creation store: nonextractable
// AES-GCM CryptoKey in IndexedDB, authenticated ciphertext, strict commit + CAS.
const DB_NAME = "hsc-invoice-operation-v1";
type Box = { key: CryptoKey; id: string };
type Envelope = {
  keyId: string;
  revision: string;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
};
function keyBox(raw: unknown): Box {
  const value = raw as Box;
  if (
    !value ||
    typeof value.id !== "string" ||
    !UUID.test(value.id) ||
    !value.key ||
    value.key.type !== "secret" ||
    value.key.extractable ||
    value.key.algorithm.name !== "AES-GCM" ||
    (value.key.algorithm as AesKeyAlgorithm).length !== 256 ||
    value.key.usages.length !== 2 ||
    !value.key.usages.includes("encrypt") ||
    !value.key.usages.includes("decrypt")
  )
    throw corrupt();
  return value;
}
function envelope(raw: unknown, box: Box): Envelope {
  const value = raw as Envelope;
  if (
    !value ||
    value.keyId !== box.id ||
    !UUID.test(value.revision) ||
    !(value.iv instanceof Uint8Array) ||
    value.iv.length !== 12 ||
    !(value.ciphertext instanceof ArrayBuffer) ||
    value.ciphertext.byteLength < 16 ||
    value.ciphertext.byteLength > MAX_BYTES + 16
  )
    throw corrupt();
  return value;
}
function bytes(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}
function openDB(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    let failed = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore("keys");
      request.result.createObjectStore("records");
    };
    request.onerror = request.onblocked = () => {
      failed = true;
      reject(unavailable());
    };
    request.onsuccess = () => {
      if (failed) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
function transaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (
    tx: IDBTransaction,
    done: (value: T) => void,
    guard: (fn: () => void) => () => void,
  ) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx =
      mode === "readwrite"
        ? db.transaction(["keys", "records"], mode, { durability: "strict" })
        : db.transaction(["keys", "records"], mode);
    let result: T;
    let finished = false;
    let failure: unknown;
    const abort = (error: unknown) => {
      failure = error;
      try {
        tx.abort();
      } catch {
        reject(error);
      }
    };
    const guard = (fn: () => void) => () => {
      try {
        fn();
      } catch (error) {
        abort(error);
      }
    };
    tx.oncomplete = () => (finished ? resolve(result) : reject(corrupt()));
    tx.onabort = () => reject(failure ?? unavailable());
    tx.onerror = () => {
      failure ??= unavailable();
    };
    try {
      work(
        tx,
        (value) => {
          result = value;
          finished = true;
        },
        guard,
      );
    } catch (error) {
      abort(error);
    }
  });
}
function webStore(
  options: CompanyInvoiceOperationStorageOptions,
): CompanyInvoiceOperationStore {
  async function access<T>(
    work: (db: IDBDatabase, crypto: BrowserCrypto) => Promise<T>,
  ) {
    const crypto =
      options.webCrypto === undefined ? globalThis.crypto : options.webCrypto;
    const factory =
      options.indexedDB === undefined
        ? globalThis.indexedDB
        : options.indexedDB;
    if (!crypto?.subtle || !crypto.getRandomValues || !factory?.open)
      throw unavailable();
    const db = await openDB(factory);
    try {
      return await work(db, crypto);
    } finally {
      db.close();
    }
  }
  async function ensureKey(db: IDBDatabase, crypto: BrowserCrypto) {
    const existing = await transaction<Box | null>(
      db,
      "readonly",
      (tx, done, guard) => {
        const get = tx.objectStore("keys").get("aes");
        get.onsuccess = guard(() =>
          done(get.result === undefined ? null : keyBox(get.result)),
        );
      },
    );
    if (existing) return existing;
    const generated: Box = {
      id: newRevision(),
      key: await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      ),
    };
    return transaction<Box>(db, "readwrite", (tx, done, guard) => {
      const keys = tx.objectStore("keys");
      const get = keys.get("aes");
      get.onsuccess = guard(() => {
        if (get.result !== undefined) {
          done(keyBox(get.result));
          return;
        }
        const count = tx.objectStore("records").count();
        count.onsuccess = guard(() => {
          if (count.result) throw corrupt();
          keys.put(generated, "aes");
          done(generated);
        });
      });
    });
  }
  async function load(db: IDBDatabase, crypto: BrowserCrypto, actor: string) {
    await ensureKey(db, crypto);
    const snapshot = await transaction<{
      box: Box;
      encrypted: Envelope | null;
    }>(db, "readonly", (tx, done, guard) => {
      const keys = tx.objectStore("keys").get("aes");
      keys.onsuccess = guard(() => {
        const box = keyBox(keys.result);
        const get = tx.objectStore("records").get(actor);
        get.onsuccess = guard(() =>
          done({
            box,
            encrypted:
              get.result === undefined ? null : envelope(get.result, box),
          }),
        );
      });
    });
    if (!snapshot.encrypted) return { ...snapshot, record: null };
    const sealed = snapshot.encrypted;
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: sealed.iv,
          additionalData: bytes(`${actor}:${sealed.keyId}:${sealed.revision}`),
          tagLength: 128,
        },
        snapshot.box.key,
        sealed.ciphertext,
      );
    } catch {
      throw corrupt();
    }
    const data = new Uint8Array(plaintext);
    if (data.some((value) => value > 127)) throw corrupt();
    const record = parseRecord(
      Array.from(data, (value) => String.fromCharCode(value)).join(""),
      actor,
    );
    if (record.revision !== sealed.revision) throw corrupt();
    return { ...snapshot, record };
  }
  return {
    read(c, u, j) {
      const actor = scope(c, u, j);
      return access(
        async (db, crypto) => (await load(db, crypto, actor)).record,
      );
    },
    compareAndSwap(previousValue, nextValue) {
      const previous = previousValue
        ? copyCompanyInvoiceOperationRecord(previousValue)
        : null;
      const next = copyCompanyInvoiceOperationRecord(nextValue);
      compatible(previous, next);
      const actor = recordScope(next);
      return access(async (db, crypto) => {
        const snapshot = await load(db, crypto, actor);
        if (
          (snapshot.record?.revision ?? null) !== (previous?.revision ?? null)
        )
          return false;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const raw = ascii(next);
        if (raw.length > MAX_BYTES) throw corrupt();
        const sealed: Envelope = {
          keyId: snapshot.box.id,
          revision: next.revision,
          iv,
          ciphertext: await crypto.subtle.encrypt(
            {
              name: "AES-GCM",
              iv,
              additionalData: bytes(
                `${actor}:${snapshot.box.id}:${next.revision}`,
              ),
              tagLength: 128,
            },
            snapshot.box.key,
            bytes(raw),
          ),
        };
        return transaction<boolean>(db, "readwrite", (tx, done, guard) => {
          const keys = tx.objectStore("keys").get("aes");
          keys.onsuccess = guard(() => {
            if (keyBox(keys.result).id !== snapshot.box.id) throw corrupt();
            const records = tx.objectStore("records");
            const get = records.get(actor);
            get.onsuccess = guard(() => {
              const current =
                get.result === undefined
                  ? null
                  : envelope(get.result, snapshot.box);
              if (
                (current?.revision ?? null) !==
                (snapshot.encrypted?.revision ?? null)
              ) {
                done(false);
                return;
              }
              records.put(sealed, actor);
              done(true);
            });
          });
        });
      });
    },
  };
}
/** No token persistence, AsyncStorage, localStorage, or plaintext fallback. */
export function createCompanyInvoiceOperationStore(
  options: CompanyInvoiceOperationStorageOptions = {},
): CompanyInvoiceOperationStore {
  const platform = options.platform ?? Platform.OS;
  if (platform === "web") return webStore(options);
  if (platform === "ios" || platform === "android")
    return nativeStore(options.secureStore ?? SecureStore);
  return {
    read: async () => {
      throw unavailable();
    },
    compareAndSwap: async () => {
      throw unavailable();
    },
  };
}
export const companyInvoiceOperationStore =
  createCompanyInvoiceOperationStore();
