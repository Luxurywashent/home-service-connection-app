/** b29 mobileOperations.ts:642-646 hashes the schema-parsed request, including
 * operationKey and notifyCustomer's default, wrapped in authenticated companyId.
 * Only use the already canonical immutable journal payload before the first POST.
 * This is an expectation, never persisted backend evidence or a GET-derived hash. */
export const companyJobB29IntentVersion = "b29-mobile-request-v1" as const;
export type CompanyJobB29OriginalIntent = {
  version: typeof companyJobB29IntentVersion;
  payloadFingerprint: string;
};
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}
export function companyJobB29OriginalIntentJson(companyId: number, operationKey: string, payload: object): string {
  if (!Number.isSafeInteger(companyId) || companyId <= 0 || typeof operationKey !== "string"
    || operationKey !== operationKey.trim() || operationKey.length < 8 || operationKey.length > 128) {
    throw new Error("The original recurring request cannot be bound. Recovery remains locked.");
  }
  // Match JSON HTTP omission, then the backend's only schema default. Never add
  // recurrence/date/rates/tax/appointments or any other missing evidence here.
  const request = JSON.parse(JSON.stringify({ ...payload, operationKey })) as Record<string, unknown>;
  if (!Object.hasOwn(request, "notifyCustomer")) request.notifyCustomer = true;
  return JSON.stringify(stable({ companyId, request }));
}
export async function captureCompanyJobB29OriginalIntent(companyId: number, operationKey: string, payload: object): Promise<CompanyJobB29OriginalIntent> {
  const json = companyJobB29OriginalIntentJson(companyId, operationKey, payload);
  // Original one-time transports never need to load a new native dependency.
  const Crypto = await import("expo-crypto");
  const payloadFingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, json);
  if (!/^[0-9a-f]{64}$/.test(payloadFingerprint)) throw new Error("The original recurring request digest is unavailable. Nothing may be submitted.");
  return Object.freeze({ version: companyJobB29IntentVersion, payloadFingerprint });
}
