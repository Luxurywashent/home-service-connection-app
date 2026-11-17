import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCompanyNativePaymentStore, newCompanyNativePaymentPointer } from "../lib/company-native-payment-storage";
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked-device-only" }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "12345678-1234-4123-8123-123456789abc" }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
let values: Map<string, string>;
const io = { getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() };
beforeEach(() => {
  values = new Map(); vi.resetAllMocks();
  io.getItemAsync.mockImplementation(async (key: string) => values.get(key) ?? null);
  io.setItemAsync.mockImplementation(async (key: string, value: string) => { values.set(key, value); });
  io.deleteItemAsync.mockImplementation(async (key: string) => { values.delete(key); });
});
describe("minimal protected native-payment recovery pointer", () => {
  it("persists only the verified scope and operation key with device-only keychain access", async () => {
    const store = createCompanyNativePaymentStore(io, true); const p = newCompanyNativePaymentPointer(9, 42, 12);
    expect(await store.reserve(p)).toBe(true); expect(await store.read(9, 42, 12)).toEqual(p);
    expect(io.setItemAsync).toHaveBeenCalledWith("hsc.native.payment.v1.9.42.12", JSON.stringify(p), { keychainAccessible: "unlocked-device-only" });
    expect(await store.read(10, 42, 12)).toBeNull(); expect(await store.read(9, 43, 12)).toBeNull();
    expect(await store.read(9, 42, 13)).toBeNull();
  });
  it("reserves one original operation across concurrent stores and refuses overwrite", async () => {
    const a = createCompanyNativePaymentStore(io, true), b = createCompanyNativePaymentStore(io, true);
    const p = newCompanyNativePaymentPointer(9, 42, 12), other = { ...p, operationKey: "hsc-native-22345678-1234-4123-8123-123456789abc" };
    const results = await Promise.all([a.reserve(p), b.reserve(other)]); expect(results).toEqual([true, false]);
    expect(io.setItemAsync).toHaveBeenCalledTimes(1); expect(await b.read(9, 42, 12)).toEqual(p);
    expect(await b.reserve({ ...p, createdAt: "2026-01-01T00:00:00.000Z" })).toBe(false);
    expect(await b.remove(other)).toBe(false); expect(await a.remove(p)).toBe(true);
  });
  it("rejects stored wrong-Company records and corrupt or extra sensitive fields rather than silently dropping them", async () => {
    const store = createCompanyNativePaymentStore(io, true); const p = newCompanyNativePaymentPointer(9, 42, 12);
    for (const stored of ["bad json", JSON.stringify({ ...p, companyId: 10 }), JSON.stringify({ ...p, signature: "private" }), JSON.stringify({ ...p, clientSecret: "secret" })]) {
      values.set("hsc.native.payment.v1.9.42.12", stored); await expect(store.read(9, 42, 12)).rejects.toThrow("could not be verified");
    }
    values.clear(); expect(() => store.reserve({ ...p, paymentMethodId: "pm_NotStored" } as typeof p)).toThrow();
    expect(io.setItemAsync).not.toHaveBeenCalled();
  });
  it("fails closed if a browser or failed storage cannot establish durable recovery", async () => {
    const p = newCompanyNativePaymentPointer(9, 42, 12);
    await expect(createCompanyNativePaymentStore(io, false).reserve(p)).rejects.toThrow();
    expect(io.setItemAsync).not.toHaveBeenCalled();
    io.setItemAsync.mockResolvedValue(undefined);
    await expect(createCompanyNativePaymentStore(io, true).reserve(p)).rejects.toThrow();
  });
});
