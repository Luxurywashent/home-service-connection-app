import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

export type CompanyNativePaymentPointer = {
  version: 1; companyId: number; userId: number; jobId: number; operationKey: string; createdAt: string;
};
export type CompanyNativePaymentStore = {
  read(companyId: number, userId: number, jobId: number): Promise<CompanyNativePaymentPointer | null>;
  reserve(pointer: CompanyNativePaymentPointer): Promise<boolean>;
  remove(pointer: CompanyNativePaymentPointer): Promise<boolean>;
};
type Store = Pick<typeof SecureStore, "getItemAsync" | "setItemAsync" | "deleteItemAsync">;
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const prefix = "hsc.native.payment.v1";
const queues = new Map<string, Promise<unknown>>();
const fail = () => new Error("Protected payment recovery could not be verified. Do not start another payment.");
function positive(n: number) { return Number.isSafeInteger(n) && n > 0; }
function key(companyId: number, userId: number, jobId: number) {
  if (![companyId, userId, jobId].every(positive)) throw fail();
  return `${prefix}.${companyId}.${userId}.${jobId}`;
}
function copy(value: unknown): CompanyNativePaymentPointer {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail();
  const p = value as CompanyNativePaymentPointer;
  if (Object.keys(p).sort().join(",") !== "companyId,createdAt,jobId,operationKey,userId,version"
    || p.version !== 1 || ![p.companyId, p.userId, p.jobId].every(positive)
    || typeof p.operationKey !== "string" || !/^hsc-native-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.operationKey)
    || typeof p.createdAt !== "string" || !Number.isFinite(Date.parse(p.createdAt))
    || new Date(p.createdAt).toISOString() !== p.createdAt) throw fail();
  return { version: 1, companyId: p.companyId, userId: p.userId, jobId: p.jobId, operationKey: p.operationKey, createdAt: p.createdAt };
}
function serialized<T>(scope: string, action: () => Promise<T>) {
  const previous = queues.get(scope) ?? Promise.resolve();
  const next = previous.then(action, action);
  queues.set(scope, next.catch(() => undefined));
  return next;
}
export function newCompanyNativePaymentPointer(companyId: number, userId: number, jobId: number): CompanyNativePaymentPointer {
  return copy({ version: 1, companyId, userId, jobId, operationKey: `hsc-native-${Crypto.randomUUID()}`, createdAt: new Date().toISOString() });
}
export function createCompanyNativePaymentStore(storage: Store = SecureStore, native = Platform.OS !== "web"): CompanyNativePaymentStore {
  async function load(scope: string, companyId: number, userId: number, jobId: number) {
    if (!native) throw fail();
    const raw = await storage.getItemAsync(scope, secureOptions);
    if (raw === null) return null;
    let pointer: CompanyNativePaymentPointer;
    try { if (raw.length > 1024) throw fail(); pointer = copy(JSON.parse(raw)); } catch { throw fail(); }
    if (pointer.companyId !== companyId || pointer.userId !== userId || pointer.jobId !== jobId) throw fail();
    return pointer;
  }
  return {
    read: (c, u, j) => { const scope = key(c, u, j); return serialized(scope, () => load(scope, c, u, j)); },
    reserve: (value) => {
      const pointer = copy(value); const scope = key(pointer.companyId, pointer.userId, pointer.jobId);
      return serialized(scope, async () => {
        const old = await load(scope, pointer.companyId, pointer.userId, pointer.jobId);
        if (old) return old.operationKey === pointer.operationKey && old.createdAt === pointer.createdAt;
        await storage.setItemAsync(scope, JSON.stringify(pointer), secureOptions);
        const result = await load(scope, pointer.companyId, pointer.userId, pointer.jobId);
        if (!result || result.operationKey !== pointer.operationKey) throw fail();
        return true;
      });
    },
    remove: (value) => {
      const pointer = copy(value); const scope = key(pointer.companyId, pointer.userId, pointer.jobId);
      return serialized(scope, async () => {
        const old = await load(scope, pointer.companyId, pointer.userId, pointer.jobId);
        if (!old || old.operationKey !== pointer.operationKey) return false;
        await storage.deleteItemAsync(scope, secureOptions);
        return (await load(scope, pointer.companyId, pointer.userId, pointer.jobId)) === null;
      });
    },
  };
}
export const companyNativePaymentStore = createCompanyNativePaymentStore();
