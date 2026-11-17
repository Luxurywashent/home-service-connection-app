import {
  getJobSyncCompanyJobDetail,
  getJobSyncMobileSession,
  type JobSyncCompanyJobDetail,
  type JobSyncNativeSession,
} from "./jobsync-mobile-api";

/** Exact unpublished 2818bb72 saved fs_jobs service-location snapshot. */
export type CompanyJobAddress = Readonly<{
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
}>;
export type CompanyJobAddressDraft = { addressLine1: string; city: string; region: string; postalCode: string };
/** All nullable fields MUST be explicit: omission clears them on this backend. */
export type CompanyJobAddressMutation = CompanyJobAddress & { addressLine1: string; expectedUpdatedAt: string };
export type CompanyJobAddressDetail = JobSyncCompanyJobDetail & { serviceAddress?: CompanyJobAddress };
export type CompanyJobAddressWriter = (token: string, jobId: number, input: CompanyJobAddressMutation) => Promise<unknown>;
export type CompanyJobAddressApi = {
  session: (token: string) => Promise<JobSyncNativeSession>;
  detail: (token: string, jobId: number, companyId: number) => Promise<CompanyJobAddressDetail>;
};
const apiDefaults: CompanyJobAddressApi = { session: getJobSyncMobileSession, detail: getJobSyncCompanyJobDetail };
const fields = { addressLine1: 255, city: 96, region: 96, postalCode: 24 } as const;
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const record = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const instant = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
const sameInstant = (a: unknown, b: unknown) => instant(a) && instant(b) && Date.parse(a) === Date.parse(b);

/** No customer-profile fallback; undefined/malformed is unavailable, never known empty. */
export function normalizeCompanyJobAddress(value: unknown): CompanyJobAddress | undefined {
  const row = record(value);
  if (!row) return undefined;
  const out: Record<string, string | null> = {};
  for (const [key, limit] of Object.entries(fields)) {
    const v = row[key];
    if (!Object.hasOwn(row, key) || (v !== null && (typeof v !== "string" || v.trim().length > limit))) return undefined;
    out[key] = typeof v === "string" ? v.trim() || null : null;
  }
  return Object.freeze(out) as CompanyJobAddress;
}

/** Parent calls this on the raw canonical DETAIL row, which includes j.*. */
export function normalizeCompanyJobAddressDetail(row: unknown): CompanyJobAddress | undefined {
  const detail = record(row);
  if (!detail || !Object.hasOwn(detail, "address_line1") || !Object.hasOwn(detail, "city")
    || !Object.hasOwn(detail, "region") || !Object.hasOwn(detail, "postal_code")) return undefined;
  const address = normalizeCompanyJobAddress({ addressLine1: detail.address_line1, city: detail.city, region: detail.region, postalCode: detail.postal_code });
  // Overlay DTO and raw snapshot must agree. List alone lacks region/postal code.
  if (!address || (Object.hasOwn(detail, "addressLine1") && detail.addressLine1 !== address.addressLine1)) return undefined;
  return address;
}
export function companyJobAddressesEqual(a: CompanyJobAddress | undefined, b: CompanyJobAddress | undefined): boolean {
  return Boolean(a && b && Object.keys(fields).every((key) => a[key as keyof CompanyJobAddress] === b[key as keyof CompanyJobAddress]));
}
export function createCompanyJobAddressPayload(draft: CompanyJobAddressDraft, expectedUpdatedAt: string): CompanyJobAddressMutation {
  const row = record(draft);
  if (!row || Object.keys(row).length !== 4 || Object.keys(row).some((key) => !Object.hasOwn(fields, key))
    || Object.keys(fields).some((key) => typeof row[key] !== "string") || !instant(expectedUpdatedAt)) throw new Error("Enter a verified Job address and refresh its version.");
  const address = normalizeCompanyJobAddress(row);
  if (!address?.addressLine1) throw new Error("Enter a street address (255 characters maximum).");
  return Object.freeze({ ...address, addressLine1: address.addressLine1, expectedUpdatedAt });
}
export function companyJobAddressScope(session: JobSyncNativeSession | null): string | null {
  if (session?.portal !== "company" || typeof session.token !== "string" || !session.token || /[\u0000-\u0020\u007f]/.test(session.token)
    || !positive(session.company?.id) || !positive(session.user?.id) || !["owner", "dispatcher"].includes(session.user.role)) return null;
  return JSON.stringify([session.portal, session.token, session.company.id, session.user.id, session.user.role]);
}
/** PATCH has no success/jobId/companyId root fields; Company authority is independently re-read. */
export function verifyCompanyJobAddressAck(payload: unknown, baseline: CompanyJobAddressDetail, mutation: CompanyJobAddressMutation): boolean {
  const root = record(payload), job = record(root?.job);
  const address = normalizeCompanyJobAddress(root?.address);
  return Boolean(root && job && address && job.id === baseline.id && job.customerId === baseline.customerId
    && (job.companyId === undefined || job.companyId === baseline.companyId)
    && job.addressLine1 === mutation.addressLine1 && job.city === mutation.city
    && instant(root.updatedAt) && sameInstant(job.updatedAt, root.updatedAt)
    // A changed snapshot with no advancing version cannot establish safe future concurrency.
    && Date.parse(root.updatedAt) > Date.parse(mutation.expectedUpdatedAt)
    && companyJobAddressesEqual(address, mutation));
}

// Company/Job lifetime fences survive sheet/controller remounts; no credentials or address drafts stored.
const writing = new Set<string>();
const unresolved = new Set<string>();
const lockKey = (companyId: number, jobId: number) => JSON.stringify([companyId, jobId]);
export function companyJobAddressWriteBlocked(session: JobSyncNativeSession | null, jobId: number): boolean {
  if (!companyJobAddressScope(session) || !positive(jobId)) return true;
  const key = lockKey(session!.company!.id, jobId);
  return writing.has(key) || unresolved.has(key);
}
export type CompanyJobAddressResult = {
  status: "saved" | "blocked" | "conflict" | "uncertain" | "stale";
  message: string;
  detail?: CompanyJobAddressDetail;
};
const interrupted = (): CompanyJobAddressResult => ({ status: "stale", message: "Address editing was interrupted. Refresh and review the Job before editing again." });
const uncertain = (): CompanyJobAddressResult => ({ status: "uncertain", message: "Address save could not be confirmed. Refresh and review the current Job; do not resend blindly." });

export function createCompanyJobAddressController(input: {
  session: JobSyncNativeSession;
  baseline: CompanyJobAddressDetail;
  isCurrent: () => boolean;
  write: CompanyJobAddressWriter;
  api?: CompanyJobAddressApi;
  /** Required real canonical detail/list/selected-row reconciliation; never optimistic submitted text. */
  onVerified: (detail: CompanyJobAddressDetail, isCurrent: () => boolean) => Promise<boolean>;
}) {
  const original = { ...input.session, user: { ...input.session.user }, company: input.session.company ? { ...input.session.company } : undefined };
  const baseline = Object.freeze({ ...input.baseline, serviceAddress: normalizeCompanyJobAddress(input.baseline.serviceAddress) });
  const scope = companyJobAddressScope(original);
  const key = lockKey(baseline.companyId ?? 0, baseline.id);
  const api = input.api ?? apiDefaults;
  let busy = false, consumed = false;
  const current = () => Boolean(scope) && companyJobAddressScope(input.session) === scope && input.isCurrent();
  const validDetail = (detail: CompanyJobAddressDetail) => detail.id === baseline.id && detail.companyId === original.company?.id
    && detail.customerId === baseline.customerId && positive(detail.customerId) && instant(detail.updatedAt)
    && Boolean(normalizeCompanyJobAddress(detail.serviceAddress))
    && detail.addressLine1 === detail.serviceAddress?.addressLine1 && detail.city === detail.serviceAddress?.city;
  async function authenticate() {
    const actor = await api.session(original.token);
    if (!current()) return false;
    if (companyJobAddressScope(actor) !== scope) throw new Error("Fresh Company management access could not be verified.");
    return true;
  }
  async function read() {
    if (!current() || !await authenticate()) return null;
    const detail = await api.detail(original.token, baseline.id, original.company!.id);
    if (!current()) return null;
    if (!validDetail(detail)) throw new Error("Canonical Job address could not be verified.");
    if (!await authenticate() || !current()) return null;
    return detail;
  }
  return {
    /** GET-only explicit review clears uncertainty for future NEW editor instances, never retries this one. */
    async refresh(): Promise<CompanyJobAddressDetail | null> {
      if (busy || writing.has(key) || !current() || baseline.companyId !== original.company?.id || !positive(baseline.id)) return null;
      busy = true; writing.add(key);
      try {
        const detail = await read();
        if (!detail || !current() || !await input.onVerified(detail, current) || !current()) return null;
        unresolved.delete(key);
        return detail;
      } catch { return null; } finally { busy = false; writing.delete(key); }
    },
    async save(draft: CompanyJobAddressDraft): Promise<CompanyJobAddressResult> {
      if (busy || consumed || companyJobAddressWriteBlocked(original, baseline.id) || !current()) return { status: "blocked", message: "Refresh and review this Company Job before editing again." };
      if (baseline.companyId !== original.company?.id || !positive(baseline.id) || !positive(baseline.customerId)
        || !instant(baseline.updatedAt) || !baseline.serviceAddress) return { status: "blocked", message: "The saved Job address or version is unavailable. Refresh before editing." };
      let mutation: CompanyJobAddressMutation;
      try { mutation = createCompanyJobAddressPayload({ ...draft }, baseline.updatedAt); }
      catch (error) { return { status: "blocked", message: error instanceof Error ? error.message : "Enter a valid service address." }; }
      if (companyJobAddressesEqual(baseline.serviceAddress, mutation)) return { status: "blocked", message: "The service address has not changed." };
      busy = true; writing.add(key);
      let attempted = false;
      try {
        const fresh = await read();
        if (!fresh || !current()) return interrupted();
        if (!sameInstant(fresh.updatedAt, baseline.updatedAt) || !companyJobAddressesEqual(fresh.serviceAddress, baseline.serviceAddress))
          return { status: "conflict", message: "This Job changed elsewhere. Refresh and review before editing." };
        if (!current() || !await authenticate() || !current()) return interrupted();
        consumed = true; attempted = true; unresolved.add(key);
        let ack: unknown;
        try { ack = await input.write(original.token, baseline.id, mutation); }
        catch { /* A lost response may follow a commit. Never automatically PATCH again. */ }
        if (!current()) return interrupted();
        const acknowledged = verifyCompanyJobAddressAck(ack, baseline, mutation);
        const detail = await read();
        if (!detail || !current()) return interrupted();
        if (!acknowledged || !sameInstant(detail.updatedAt, record(ack)?.updatedAt) || !companyJobAddressesEqual(detail.serviceAddress, mutation)) return uncertain();
        if (!await input.onVerified(detail, current) || !current()) return uncertain();
        unresolved.delete(key);
        return { status: "saved", message: "Job service address saved and verified.", detail };
      } catch {
        if (!current()) return interrupted();
        return attempted ? uncertain() : { status: "blocked", message: "Fresh Company manager access or Job address could not be verified. Refresh before editing." };
      } finally { busy = false; writing.delete(key); }
    },
  };
}
