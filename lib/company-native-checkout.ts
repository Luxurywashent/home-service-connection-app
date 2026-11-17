import {
  getJobSyncCompanyJobDetail, getJobSyncMobileSession,
  type JobSyncCompanyJobDetail, type JobSyncNativeSession,
} from "./jobsync-mobile-api";
import { getCompanyJobBillingState } from "./company-job-billing";
import {
  companyCheckoutBlockReason, companyCheckoutScope, companyPaymentCollectorAllowed,
} from "./company-job-checkout";
import type { CompanyNativePaymentPointer, CompanyNativePaymentStore } from "./company-native-payment-storage";

export type NativeCheckoutPhase = "method" | "card" | "tip" | "signature" | "processing" | "unknown" | "paid" | "error" | "blocked";
/** Only an explicitly disabled adapter may signal unavailable; it never clears an existing attempt. */
export class NativeCheckoutUnavailableError extends Error {
  constructor() { super("In-app card payment setup is not verified. No native payment was started."); this.name = "NativeCheckoutUnavailableError"; }
}
export type NativeCheckoutMethod = "card" | "tap_to_pay";
export type NativeCheckoutTip = Readonly<
  { kind: "none" } | { kind: "percentage"; percent: 15 | 18 | 20 | 25 } | { kind: "custom"; amountCents: number }
>;
export type NativeCheckoutCardMetadata = Readonly<{ brand: string; last4: string; expMonth?: number; expYear?: number }>;
export type NativeCheckoutConfiguration = Readonly<{
  companyId: number;
  nativeEnabled: boolean;
  publishableKey: string;
  accountId: string;
  mode: "test" | "live";
  currency: string;
}>;
export type NativeCheckoutQuote = Readonly<{
  quoteId: string;
  companyId: number;
  jobId: number;
  accountId: string;
  mode: "test" | "live";
  currency: string;
  obligationVersion: string;
  principalCents: number;
  tipCents: number;
  totalCents: number;
  tip: NativeCheckoutTip;
  expiresAt: number;
}>;
export type NativeCheckoutIntent = Readonly<{
  operationKey: string;
  method: "card";
  quote: NativeCheckoutQuote;
}>;
/** This context is private transport input, never controlled view state. */
export type NativeCheckoutContext = Readonly<{ token: string; companyId: number; jobId: number; actorId: number }>;
export type NativeCheckoutOperationAnchor = Readonly<{ companyId: number; jobId: number; operationKey: string }>;
/** Parent must supply cryptographic randomness and protected durable storage. No sensitive payloads. */
export interface NativeCheckoutOperations {
  generateKey(): string | Promise<string>;
  load(scope: Readonly<{ companyId: number; jobId: number }>): Promise<NativeCheckoutOperationAnchor | null>;
  save(anchor: NativeCheckoutOperationAnchor): Promise<void>;
  /** Called only after canonical paid/zero-balance readback, never on close/failure. */
  releasePaid?(anchor: NativeCheckoutOperationAnchor): Promise<void>;
}
/** No runtime native/storage import: the parent explicitly injects both dependencies. */
export function createNativeCheckoutOperations(input: {
  companyId: number; userId: number; jobId: number;
  store: CompanyNativePaymentStore;
  createPointer: (companyId: number, userId: number, jobId: number) => CompanyNativePaymentPointer;
}): NativeCheckoutOperations {
  const { companyId, userId, jobId, store, createPointer } = input;
  let pointer: CompanyNativePaymentPointer | null = null;
  const scope = (value: { companyId: number; jobId: number }) => {
    if (value.companyId !== companyId || value.jobId !== jobId) throw new Error("Protected recovery scope changed");
  };
  const copy = (value: CompanyNativePaymentPointer) => {
    if (value.companyId !== companyId || value.userId !== userId || value.jobId !== jobId || !keyValid(value.operationKey)
      || value.version !== 1 || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) throw new Error("Invalid protected pointer");
    return Object.freeze({ version: 1 as const, companyId, userId, jobId, operationKey: value.operationKey, createdAt: value.createdAt });
  };
  return {
    generateKey: () => { if (pointer) throw new Error("Original payment operation is retained"); pointer = copy(createPointer(companyId, userId, jobId)); return pointer.operationKey; },
    load: async (value) => {
      scope(value);
      const stored = await store.read(companyId, userId, jobId);
      pointer = stored ? copy(stored) : null;
      return pointer ? Object.freeze({ companyId, jobId, operationKey: pointer.operationKey }) : null;
    },
    save: async (anchor) => {
      scope(anchor);
      if (!pointer || pointer.operationKey !== anchor.operationKey || !await store.reserve(pointer)) throw new Error("Protected pointer reservation failed");
    },
    releasePaid: async (anchor) => {
      scope(anchor);
      if (!pointer) { const stored = await store.read(companyId, userId, jobId); pointer = stored ? copy(stored) : null; }
      if (!pointer || pointer.operationKey !== anchor.operationKey) return;
      if (!await store.remove(pointer)) throw new Error("Protected pointer cleanup not confirmed");
      pointer = null;
    },
  };
}
export interface NativeCheckoutReadTransport {
  session: typeof getJobSyncMobileSession;
  detail: typeof getJobSyncCompanyJobDetail;
}
export type NativeCheckoutSignatureInput = Readonly<{ pngDataUrl: string }>;
export type NativeCheckoutSignatureApproval = Readonly<{
  intent: NativeCheckoutIntent;
  signatureApprovalId: string;
  privateStored: true;
}>;
export type NativeCheckoutPrepared = Readonly<{
  kind: "prepared";
  intent: NativeCheckoutIntent;
  signatureApprovalId: string;
  paymentIntentId: string;
  clientSecret: string;
  unconfirmed: true;
  serverReauthorized: true;
  sharedLockHeld: true;
}>;
export type NativeCheckoutBlocked = Readonly<{
  kind: "blocked";
  companyId: number;
  jobId: number;
  operationKey: string;
  reason: "hosted_active" | "native_active" | "permission_denied" | "balance_changed" | "unavailable";
}>;
export type NativeCheckoutConfirmationAuthorization = Readonly<{
  intent: NativeCheckoutIntent;
  signatureApprovalId: string;
  paymentIntentId: string;
  authorized: true;
  sharedLockHeld: true;
  expiresAt: number;
}>;
export type NativeCheckoutAttemptStatus = Readonly<{
  companyId: number;
  jobId: number;
  operationKey: string;
  state: "not_found" | "approval_stored" | "prepared" | "processing" | "succeeded" | "failed" | "cancelled" | "blocked" | "unknown";
  blockingChannel?: "hosted" | "native";
}>;
/**
 * Semantic requirements, NOT an HTTP/API specification. A verified backend adapter
 * must privately store signature evidence before exposing any PI secret, reserve
 * under the shared hosted/native Job lock, and reauthorize the final confirmation.
 * No default native mutations, legacy/public/manual-paid or hosted fallback exists.
 */
export interface NativeCheckoutTransport {
  capabilities(context: NativeCheckoutContext): Promise<NativeCheckoutConfiguration>;
  quote(context: NativeCheckoutContext, request: Readonly<{ tip: NativeCheckoutTip; configuration: NativeCheckoutConfiguration }>): Promise<NativeCheckoutQuote>;
  approveSignature(context: NativeCheckoutContext, request: Readonly<{ intent: NativeCheckoutIntent; evidence: NativeCheckoutSignatureInput }>): Promise<NativeCheckoutSignatureApproval>;
  prepare(context: NativeCheckoutContext, request: Readonly<{ intent: NativeCheckoutIntent; signatureApprovalId: string }>): Promise<NativeCheckoutPrepared | NativeCheckoutBlocked>;
  authorizeConfirmation(context: NativeCheckoutContext, request: Readonly<{ intent: NativeCheckoutIntent; signatureApprovalId: string; paymentIntentId: string }>): Promise<NativeCheckoutConfirmationAuthorization | NativeCheckoutBlocked>;
  /** Read-only; must never create, confirm, resume, cancel or return secrets. */
  status(context: NativeCheckoutContext, operationKey: string): Promise<NativeCheckoutAttemptStatus>;
}
export interface NativeCheckoutProvider {
  /** The parent serializes provider account init/confirm and rechecks isCurrent after each await. */
  confirm(input: Readonly<{
    clientSecret: string;
    paymentMethodId: string;
    configuration: NativeCheckoutConfiguration;
    isCurrent: () => boolean;
  }>): Promise<Readonly<{ status: "succeeded" | "processing" | "cancelled" | "failed" }>>;
}
export type NativeCheckoutState = Readonly<{
  phase: NativeCheckoutPhase;
  detail: JobSyncCompanyJobDetail | null;
  configuration: NativeCheckoutConfiguration | null;
  method: NativeCheckoutMethod | null;
  methods: Readonly<{ card: Readonly<{ available: boolean; reason: string | null }>; tapToPay: Readonly<{ available: false; reason: string }> }>;
  card: NativeCheckoutCardMetadata | null;
  tip: NativeCheckoutTip;
  quote: NativeCheckoutQuote | null;
  signatureApproved: boolean;
  canConfirm: boolean;
  busy: boolean;
  message: string | null;
}>;
export type CompanyNativeCheckoutControllerInput = {
  session: JobSyncNativeSession;
  jobId: number;
  /** Must include current sheet epoch, session, Job, navigation focus and AppState. */
  isCurrent: () => boolean;
  onState: (state: NativeCheckoutState) => void;
  onVerifiedDetail?: (detail: JobSyncCompanyJobDetail) => void;
  readTransport?: NativeCheckoutReadTransport;
  nativeTransport?: NativeCheckoutTransport;
  provider?: NativeCheckoutProvider;
  operations?: NativeCheckoutOperations;
  now?: () => number;
};
export type CompanyNativeCheckoutController = {
  getState(): NativeCheckoutState;
  refresh(): Promise<boolean>;
  selectMethod(method: NativeCheckoutMethod): boolean;
  /** Only a provider-issued token, never card numbers/CVC or arbitrary card data. */
  setPaymentMethod(paymentMethodId: string, metadata: NativeCheckoutCardMetadata): boolean;
  quoteTip(tip: NativeCheckoutTip): Promise<boolean>;
  /** Review server-priced totals in the tip step before opening signature. */
  continueToSignature(): boolean;
  /** Only pre-operation navigation; never releases an unresolved payment. */
  back(): boolean;
  approveSignature(evidence: NativeCheckoutSignatureInput): Promise<boolean>;
  /** The only action permitted to prepare an unconfirmed PI and call provider confirmation. */
  confirm(): Promise<boolean>;
  /** Deliberate read-only recovery. Never automatically confirm a recovered attempt. */
  refreshStatus(): Promise<boolean>;
  dispose(): void;
};

const TTP_REASON = "Tap to Pay is not ready: native SDK, Apple entitlement and server support have not been verified.";
const NATIVE_REASON = "In-app card checkout is not available until verified Company native payment support is configured.";
const HOLD_REASON = "Payment outcome is not confirmed. Check the original attempt status; do not start or retry a payment.";
const LEDGER_REASON = "Awaiting your Company's payment records. Provider completion does not yet confirm this Job is paid.";
const defaultReads: NativeCheckoutReadTransport = { session: getJobSyncMobileSession, detail: getJobSyncCompanyJobDetail };
type Stage = "idle" | "approval" | "approved" | "preparing" | "confirming" | "awaiting_ledger" | "unknown" | "blocked" | "paid";
type Coordination = { busy: boolean; anchor: NativeCheckoutOperationAnchor | null; stage: Stage; hydrated: boolean };
// Bounded, shared across controllers and actors for a Company/Job. Never evict an
// unresolved operation to make room for a new charge. Durable storage covers restart.
const coordination = new Map<string, Coordination>();
const MAX_SCOPES = 64;
const cents = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 99_999_999;
const text = (value: unknown, max = 128): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u0020\u007f]/.test(value);
const keyValid = (value: unknown): value is string => text(value) && value.length >= 16 && /^[A-Za-z0-9_-]+$/.test(value);
function copyTip(value: NativeCheckoutTip): NativeCheckoutTip {
  if (value?.kind === "none") return Object.freeze({ kind: "none" });
  if (value?.kind === "percentage" && [15, 18, 20, 25].includes(value.percent)) return Object.freeze({ kind: "percentage", percent: value.percent });
  if (value?.kind === "custom" && cents(value.amountCents)) return Object.freeze({ kind: "custom", amountCents: value.amountCents });
  throw new Error("Invalid tip");
}
function tipKey(tip: NativeCheckoutTip) { return tip.kind === "percentage" ? `percentage:${tip.percent}` : tip.kind === "custom" ? `custom:${tip.amountCents}` : "none"; }
function configKey(config: NativeCheckoutConfiguration) { return JSON.stringify([config.companyId, config.nativeEnabled, config.publishableKey, config.accountId, config.mode, config.currency]); }
function quoteKey(quote: NativeCheckoutQuote) {
  return JSON.stringify([quote.quoteId, quote.companyId, quote.jobId, quote.accountId, quote.mode, quote.currency, quote.obligationVersion,
    quote.principalCents, quote.tipCents, quote.totalCents, tipKey(quote.tip), quote.expiresAt]);
}
function sameIntent(a: NativeCheckoutIntent | undefined, b: NativeCheckoutIntent) {
  try { return Boolean(a && a.operationKey === b.operationKey && a.method === b.method && quoteKey(a.quote) === quoteKey(b.quote)); } catch { return false; }
}
function balanceCents(detail: JobSyncCompanyJobDetail) {
  const balance = getCompanyJobBillingState(detail).balance;
  if (balance === null) return null;
  const result = Math.round(balance * 100);
  return cents(result) && Math.abs(balance * 100 - result) < 0.000001 ? result : null;
}
function safeCard(value: NativeCheckoutCardMetadata): NativeCheckoutCardMetadata | null {
  if (!value || typeof value.brand !== "string" || !/^[A-Za-z][A-Za-z -]{0,23}$/.test(value.brand) || !/^\d{4}$/.test(value.last4)
    || (value.expMonth !== undefined && (!Number.isInteger(value.expMonth) || value.expMonth < 1 || value.expMonth > 12))
    || (value.expYear !== undefined && (!Number.isInteger(value.expYear) || value.expYear < 2000 || value.expYear > 2200))) return null;
  return Object.freeze({ brand: value.brand, last4: value.last4,
    ...(value.expMonth === undefined ? {} : { expMonth: value.expMonth }), ...(value.expYear === undefined ? {} : { expYear: value.expYear }) });
}

export function createCompanyNativeCheckoutController(input: CompanyNativeCheckoutControllerInput): CompanyNativeCheckoutController {
  const api = input.nativeTransport;
  const reads = input.readTransport ?? defaultReads;
  const now = input.now ?? Date.now;
  const origin = companyCheckoutScope(input.session, input.jobId);
  const actor = Object.freeze({ token: input.session.token, companyId: input.session.company?.id ?? 0, actorId: input.session.user.id, jobId: input.jobId });
  const jobScope = JSON.stringify([actor.companyId, actor.jobId]);
  let shared = coordination.get(jobScope);
  if (!shared && origin && coordination.size < MAX_SCOPES) {
    shared = { busy: false, anchor: null, stage: "idle", hydrated: false };
    coordination.set(jobScope, shared);
  }
  const entry = shared;
  let disposed = false;
  let paymentMethodId: string | null = null;
  let approved: NativeCheckoutSignatureApproval | null = null;
  let signaturePaymentMethod: string | null = null;
  let ownsAnchor = false;
  let state: NativeCheckoutState = Object.freeze({
    phase: "method", detail: null, configuration: null, method: null,
    methods: Object.freeze({ card: Object.freeze({ available: false, reason: NATIVE_REASON }), tapToPay: Object.freeze({ available: false as const, reason: TTP_REASON }) }),
    card: null, tip: Object.freeze({ kind: "none" as const }), quote: null,
    signatureApproved: false, canConfirm: false, busy: false, message: null,
  });
  const current = () => !disposed && input.isCurrent() && Boolean(origin) && companyCheckoutScope(input.session, input.jobId) === origin;
  const emit = (patch: Partial<NativeCheckoutState>) => {
    if (!current()) return;
    state = Object.freeze({ ...state, ...patch });
    input.onState(state);
  };
  const invalidate = () => { approved = null; signaturePaymentMethod = null; emit({ signatureApproved: false, canConfirm: false }); };
  const hold = () => { if (entry?.anchor && entry.stage !== "paid") entry.stage = "unknown"; invalidate(); emit({ phase: "unknown", message: HOLD_REASON, busy: false }); };
  const block = (message: string) => { invalidate(); emit({ phase: "blocked", message, busy: false }); };
  const paid = (detail: JobSyncCompanyJobDetail) => {
    if (entry) entry.stage = "paid";
    approved = null; signaturePaymentMethod = null; paymentMethodId = null;
    emit({ phase: "paid", detail, quote: null, card: null, signatureApproved: false, canConfirm: false, message: "Payment confirmed by your Company's payment records." });
    // Cleanup failure cannot undo canonical payment or permit a new attempt.
    if (entry?.anchor && input.operations?.releasePaid) {
      const anchor = entry.anchor;
      try { void input.operations.releasePaid(anchor).catch(() => undefined); } catch { /* retained pointer remains conservative */ }
    }
  };
  const acquire = () => {
    if (!current() || !entry || entry.busy) return false;
    entry.busy = true;
    emit({ busy: true, canConfirm: false });
    if (!current()) { entry.busy = false; return false; }
    return true;
  };
  const release = () => {
    if (entry) entry.busy = false;
    emit({ busy: false, canConfirm: Boolean(approved && entry?.stage === "approved" && state.signatureApproved) });
  };
  const unavailable = () => {
    if (!entry) { block("Checkout recovery capacity is unavailable. Reopen later; no payment was started."); return true; }
    if (!api || !input.provider || !input.operations) { block(NATIVE_REASON); return true; }
    return false;
  };
  const hydrate = async () => {
    if (!entry || entry.hydrated) return true;
    if (!input.operations) return true;
    const anchor = await input.operations.load(Object.freeze({ companyId: actor.companyId, jobId: actor.jobId }));
    if (!current()) return false;
    if (anchor && (anchor.companyId !== actor.companyId || anchor.jobId !== actor.jobId || !keyValid(anchor.operationKey))) throw new Error("Invalid protected operation anchor");
    if (anchor) {
      if (entry.anchor && entry.anchor.operationKey !== anchor.operationKey) throw new Error("Conflicting protected operation anchor");
      entry.anchor = Object.freeze({ companyId: actor.companyId, jobId: actor.jobId, operationKey: anchor.operationKey });
      entry.stage = "unknown";
    }
    entry.hydrated = true;
    return true;
  };
  const fresh = async () => {
    if (!current()) return null;
    const live = await reads.session(actor.token);
    if (!current()) return null;
    if (live.portal !== "company" || live.token !== actor.token || live.company?.id !== actor.companyId
      || live.user.id !== actor.actorId || live.user.role !== input.session.user.role) throw new Error("Changed session");
    const raw = await reads.detail(live.token, actor.jobId, actor.companyId);
    if (!current()) return null;
    if (raw.id !== actor.jobId || raw.companyId !== actor.companyId) throw new Error("Changed Job scope");
    const detail = Object.freeze({ ...raw });
    input.onVerifiedDetail?.(detail);
    if (!current()) return null;
    emit({ detail });
    if (!current()) return null;
    return { live, detail };
  };
  const configuration = async () => {
    if (!api || !current()) return null;
    let raw: NativeCheckoutConfiguration;
    try { raw = await api.capabilities(actor); }
    catch (error) {
      if (current() && !entry?.anchor && error instanceof NativeCheckoutUnavailableError) { block(NATIVE_REASON); return null; }
      throw error;
    }
    if (!current()) return null;
    const valid = raw && raw.companyId === actor.companyId && raw.nativeEnabled === true
      && /^pk_(test|live)_[A-Za-z0-9]+$/.test(raw.publishableKey) && /^acct_[A-Za-z0-9]+$/.test(raw.accountId)
      && ["test", "live"].includes(raw.mode) && raw.publishableKey.startsWith(`pk_${raw.mode}_`) && /^[a-z]{3}$/.test(raw.currency);
    if (!valid) { block(NATIVE_REASON); return null; }
    const result: NativeCheckoutConfiguration = Object.freeze({ companyId: raw.companyId, nativeEnabled: true,
      publishableKey: raw.publishableKey, accountId: raw.accountId, mode: raw.mode, currency: raw.currency });
    if (state.configuration && configKey(state.configuration) !== configKey(result)) {
      invalidate(); emit({ quote: null, message: "The payment account changed. Review the current amount again." });
      if (entry?.anchor) { hold(); return null; }
      paymentMethodId = null; emit({ card: null, phase: "card" });
    }
    emit({ configuration: result, methods: Object.freeze({ card: Object.freeze({ available: true, reason: null }), tapToPay: Object.freeze({ available: false as const, reason: TTP_REASON }) }) });
    return current() ? result : null;
  };
  const eligible = (read: NonNullable<Awaited<ReturnType<typeof fresh>>>) => {
    if (getCompanyJobBillingState(read.detail).isPaid === true) { paid(read.detail); return false; }
    const reason = companyCheckoutBlockReason(read.live, read.detail);
    if (reason || !companyPaymentCollectorAllowed(read.live)) { block(reason ?? "Current Company payment collection permission is required."); return false; }
    return current();
  };
  const quoteCurrent = (quote: NativeCheckoutQuote, detail: JobSyncCompanyJobDetail, config: NativeCheckoutConfiguration) =>
    quote.companyId === actor.companyId && quote.jobId === actor.jobId && quote.accountId === config.accountId
    && quote.mode === config.mode && quote.currency === config.currency && quote.principalCents === balanceCents(detail) && quote.expiresAt > now();
  const validateQuote = (raw: NativeCheckoutQuote, tip: NativeCheckoutTip, detail: JobSyncCompanyJobDetail, config: NativeCheckoutConfiguration) => {
    if (!raw || !text(raw.quoteId) || !text(raw.obligationVersion) || !cents(raw.principalCents) || raw.principalCents < 50
      || !cents(raw.tipCents) || !cents(raw.totalCents) || raw.totalCents !== raw.principalCents + raw.tipCents
      || !Number.isFinite(raw.expiresAt) || !quoteCurrent(raw, detail, config) || tipKey(copyTip(raw.tip)) !== tipKey(tip)
      || (tip.kind === "none" && raw.tipCents !== 0) || (tip.kind === "custom" && raw.tipCents !== tip.amountCents)) throw new Error("Invalid server quote");
    return Object.freeze({ quoteId: raw.quoteId, companyId: raw.companyId, jobId: raw.jobId, accountId: raw.accountId,
      mode: raw.mode, currency: raw.currency, obligationVersion: raw.obligationVersion, principalCents: raw.principalCents,
      tipCents: raw.tipCents, totalCents: raw.totalCents, tip: copyTip(raw.tip), expiresAt: raw.expiresAt });
  };
  const approvalCurrent = (read: NonNullable<Awaited<ReturnType<typeof fresh>>>, config: NativeCheckoutConfiguration) => {
    if (!approved || !state.quote || !paymentMethodId || signaturePaymentMethod !== paymentMethodId
      || !sameIntent(approved.intent, Object.freeze({ operationKey: entry!.anchor!.operationKey, method: "card", quote: state.quote }))
      || !quoteCurrent(approved.intent.quote, read.detail, config)) {
      invalidate(); emit({ quote: null, phase: entry?.anchor ? "unknown" : "tip", message: "The balance or approved quote changed. No payment will be confirmed; check the original attempt before collecting again." });
      if (entry?.anchor) entry.stage = "unknown";
      return false;
    }
    return current();
  };
  const blockedAck = (ack: NativeCheckoutBlocked) => {
    if (!ack || ack.companyId !== actor.companyId || ack.jobId !== actor.jobId || ack.operationKey !== entry?.anchor?.operationKey
      || !["hosted_active", "native_active", "permission_denied", "balance_changed", "unavailable"].includes(ack.reason)) throw new Error("Invalid blocking acknowledgement");
    entry!.stage = "blocked";
    block(ack.reason === "hosted_active" ? "Hosted checkout is already active. Resolve the original payment; in-app collection is blocked."
      : ack.reason === "native_active" ? "Another native payment is already active. Check its status; do not collect again."
      : ack.reason === "permission_denied" ? "Your live Company payment collection permission was revoked. No confirmation was sent."
      : ack.reason === "balance_changed" ? "The current Job balance changed. No confirmation was sent. Check the original attempt."
      : NATIVE_REASON);
  };
  const recover = async () => {
    if (!api || !entry?.anchor || !current()) return false;
    const key = entry.anchor.operationKey;
    const status = await api.status(actor, key);
    if (!current()) return false;
    if (!status || status.companyId !== actor.companyId || status.jobId !== actor.jobId || status.operationKey !== key
      || !["not_found", "approval_stored", "prepared", "processing", "succeeded", "failed", "cancelled", "blocked", "unknown"].includes(status.state)
      || (status.blockingChannel !== undefined && !["hosted", "native"].includes(status.blockingChannel))) throw new Error("Invalid attempt status");
    invalidate();
    const read = await fresh();
    if (!read || !current()) return false;
    if (getCompanyJobBillingState(read.detail).isPaid === true) { paid(read.detail); return true; }
    if (status.state === "succeeded" || status.state === "processing") {
      entry.stage = "awaiting_ledger"; emit({ phase: "processing", message: LEDGER_REASON });
    } else if (["failed", "cancelled", "blocked"].includes(status.state)) {
      entry.stage = "blocked"; block(status.blockingChannel === "hosted" ? "Hosted checkout holds this Job. Resolve the original attempt; do not collect again." : "The original attempt requires reconciliation. No replacement or automatic retry is allowed.");
    } else hold(); // Even not_found is not authority to create another PI.
    return true;
  };
  const safeFailure = () => {
    if (entry?.anchor) hold();
    else { invalidate(); emit({ phase: "error", message: "Could not verify current Company payment data. Refresh before continuing." }); }
  };
  const refresh = async () => {
    if (!acquire()) return false;
    try {
      if (!await hydrate() || !current()) return false;
      const read = await fresh();
      if (!read || !current()) return false;
      if (getCompanyJobBillingState(read.detail).isPaid === true) { paid(read.detail); return true; }
      if (unavailable()) return false;
      if (entry!.anchor && !ownsAnchor) return await recover();
      if (!eligible(read)) return false;
      const config = await configuration();
      if (!config || !current()) return false;
      if (entry!.anchor && entry!.stage !== "approved") return await recover();
      if (approved && !approvalCurrent(read, config)) return false;
      if (state.quote && !quoteCurrent(state.quote, read.detail, config)) { invalidate(); emit({ quote: null, phase: "tip", message: "The balance changed. Review a fresh server quote." }); return false; }
      emit({ phase: approved || (state.quote && state.phase === "signature") ? "signature" : paymentMethodId ? "tip" : state.method === "card" ? "card" : "method", message: null });
      return true;
    } catch { safeFailure(); return false; } finally { release(); }
  };
  const selectMethod = (method: NativeCheckoutMethod) => {
    if (!current() || !entry || entry.busy || !["card", "tap_to_pay"].includes(method) || entry.anchor || state.phase === "paid") return false;
    if (method === "tap_to_pay") { block(TTP_REASON); return false; }
    if (!state.methods.card.available || unavailable()) return false;
    invalidate(); paymentMethodId = null;
    emit({ method: "card", card: null, quote: null, phase: "card", message: null });
    return current();
  };
  const setPaymentMethod = (token: string, metadata: NativeCheckoutCardMetadata) => {
    if (!current() || !entry || entry.busy || entry.anchor || state.method !== "card" || !state.methods.card.available || state.phase === "paid") return false;
    const masked = safeCard(metadata);
    if (!/^pm_[A-Za-z0-9]{1,120}$/.test(token) || !masked) { block("A secure provider payment token and masked card details are required."); return false; }
    invalidate(); paymentMethodId = token;
    emit({ card: masked, quote: null, phase: "tip", message: null });
    return current();
  };
  const quoteTip = async (value: NativeCheckoutTip) => {
    if (!current() || !paymentMethodId || state.method !== "card" || unavailable() || !acquire()) return false;
    // Capture caller intent synchronously before any await.
    let tip: NativeCheckoutTip;
    try { tip = copyTip(value); } catch { emit({ phase: "error", message: "Choose no tip, a supported percentage, or a valid custom tip amount." }); release(); return false; }
    const previous = state.quote;
    invalidate(); emit({ quote: null, tip, phase: "tip", message: null });
    try {
      if (!await hydrate() || !current()) return false;
      const read = await fresh();
      if (!read || !eligible(read)) return false;
      const config = await configuration();
      if (!config || !current()) return false;
      const raw = await api!.quote(actor, Object.freeze({ tip, configuration: config }));
      if (!current()) return false;
      const quote = validateQuote(raw, tip, read.detail, config);
      if (entry!.anchor) {
        // A signed operation's request never changes. Replacement needs verified cancellation.
        if (!previous || quoteKey(previous) !== quoteKey(quote)) entry!.stage = "unknown";
        emit({ quote, phase: "unknown", message: "A fresh quote invalidated signature approval. Check the original signed operation; no replacement payment will be started." });
        return false;
      }
      emit({ quote, phase: "tip", message: null });
      return true;
    } catch { safeFailure(); return false; } finally { release(); }
  };
  const continueToSignature = () => {
    if (!current() || !entry || entry.busy || entry.anchor || state.phase !== "tip"
      || !paymentMethodId || !state.quote || !state.configuration || !state.detail) return false;
    if (!quoteCurrent(state.quote, state.detail, state.configuration)) {
      invalidate(); emit({ quote: null, message: "The quote expired or balance changed. Review fresh server totals before signing." });
      return false;
    }
    emit({ phase: "signature", message: null });
    return current();
  };
  const back = () => {
    if (!current() || !entry || entry.busy || entry.anchor || !["card", "tip", "signature"].includes(state.phase)) return false;
    const from = state.phase;
    invalidate();
    if (!current()) return false;
    if (from === "card") {
      paymentMethodId = null; emit({ phase: "method", method: null, card: null, quote: null, message: null });
    } else if (from === "tip") {
      paymentMethodId = null; emit({ phase: "card", card: null, quote: null, message: null });
    } else emit({ phase: "tip", quote: null, message: "Review fresh server totals before signing again." });
    return current();
  };
  const approveSignature = async (evidence: NativeCheckoutSignatureInput) => {
    if (!current() || !paymentMethodId || !state.quote || state.phase !== "signature" || entry?.anchor || unavailable() || !acquire()) return false;
    const quote = state.quote;
    const token = paymentMethodId;
    // Capture caller-controlled evidence before any await; retain pixels only for
    // this private upload call. No durable/local cache of evidence is created.
    const pngDataUrl = evidence?.pngDataUrl;
    try {
      if (typeof pngDataUrl !== "string" || pngDataUrl.length > 2_000_000
        || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(pngDataUrl)) { emit({ phase: "signature", message: "A customer signature PNG is required." }); return false; }
      if (!await hydrate() || !current()) return false;
      if (entry!.anchor) { hold(); return false; }
      const read = await fresh();
      if (!read || !eligible(read)) return false;
      const config = await configuration();
      if (!config || !current()) return false;
      if (!quoteCurrent(quote, read.detail, config)) { invalidate(); emit({ quote: null, phase: "tip", message: "The balance or quote expired. Review a fresh server quote before signing." }); return false; }
      const operationKey = await input.operations!.generateKey();
      if (!current()) return false;
      if (!keyValid(operationKey)) throw new Error("Secure operation key required");
      const anchor = Object.freeze({ companyId: actor.companyId, jobId: actor.jobId, operationKey });
      const intent: NativeCheckoutIntent = Object.freeze({ operationKey, method: "card", quote });
      entry!.anchor = anchor; entry!.stage = "approval"; ownsAnchor = true;
      // Persist ONLY the protected nonsensitive pointer before any ambiguous mutation.
      await input.operations!.save(anchor);
      if (!current()) { entry!.stage = "unknown"; return false; }
      emit({ phase: "processing", message: "Privately saving customer approval; no payment has been confirmed." });
      if (!current()) { entry!.stage = "unknown"; return false; }
      // Signature pixels are passed once to private storage, never state/logs/local persistence.
      const ack = await api!.approveSignature(actor, Object.freeze({ intent, evidence: Object.freeze({ pngDataUrl }) }));
      if (!current()) { entry!.stage = "unknown"; return false; }
      if (!ack || ack.privateStored !== true || !text(ack.signatureApprovalId) || !sameIntent(ack.intent, intent)) throw new Error("Unbound private signature approval");
      approved = Object.freeze({ intent, privateStored: true, signatureApprovalId: ack.signatureApprovalId });
      signaturePaymentMethod = token; entry!.stage = "approved";
      emit({ phase: "signature", signatureApproved: true, message: "Signature securely saved. Review Total to Charge, then deliberately confirm." });
      return current();
    } catch { safeFailure(); return false; } finally { release(); }
  };
  const confirm = async () => {
    if (!current() || !ownsAnchor || !approved || entry?.stage !== "approved" || !state.signatureApproved || unavailable() || !acquire()) return false;
    // The immutable signed request and sensitive PM remain private throughout.
    const approval = approved;
    const token = paymentMethodId!;
    try {
      const before = await fresh();
      if (!before || !eligible(before)) return false;
      const config = await configuration();
      if (!config || !approvalCurrent(before, config)) return false;
      emit({ phase: "processing", message: "Reauthorizing the signed payment and reserving the original attempt." });
      if (!current()) return false;
      entry!.stage = "preparing";
      const prepared = await api!.prepare(actor, Object.freeze({ intent: approval.intent, signatureApprovalId: approval.signatureApprovalId }));
      if (!current()) { entry!.stage = "unknown"; return false; }
      if (prepared.kind === "blocked") { blockedAck(prepared); return false; }
      if (prepared.kind !== "prepared" || prepared.unconfirmed !== true || prepared.serverReauthorized !== true || prepared.sharedLockHeld !== true
        || prepared.signatureApprovalId !== approval.signatureApprovalId || !sameIntent(prepared.intent, approval.intent)
        || !/^pi_[A-Za-z0-9]+$/.test(prepared.paymentIntentId) || !text(prepared.clientSecret, 512)
        || !prepared.clientSecret.startsWith(`${prepared.paymentIntentId}_secret_`)) throw new Error("Invalid unconfirmed reservation");
      // Snapshot private provider handles before any further asynchronous work.
      const paymentIntentId = prepared.paymentIntentId;
      const clientSecret = prepared.clientSecret;
      const afterPrepare = await fresh();
      if (!afterPrepare || !eligible(afterPrepare)) { if (!current()) entry!.stage = "unknown"; return false; }
      const finalConfig = await configuration();
      if (!finalConfig || !approvalCurrent(afterPrepare, finalConfig)) return false;
      const authorization = await api!.authorizeConfirmation(actor, Object.freeze({ intent: approval.intent, signatureApprovalId: approval.signatureApprovalId, paymentIntentId }));
      if (!current()) { entry!.stage = "unknown"; return false; }
      if ("kind" in authorization && authorization.kind === "blocked") { blockedAck(authorization); return false; }
      const auth = authorization as NativeCheckoutConfirmationAuthorization;
      if (auth.authorized !== true || auth.sharedLockHeld !== true || !Number.isFinite(auth.expiresAt) || auth.expiresAt <= now()
        || auth.signatureApprovalId !== approval.signatureApprovalId || auth.paymentIntentId !== paymentIntentId || !sameIntent(auth.intent, approval.intent)) throw new Error("Invalid final authorization");
      if (!current() || !quoteCurrent(approval.intent.quote, afterPrepare.detail, finalConfig)) { hold(); return false; }
      entry!.stage = "confirming";
      invalidate();
      if (!current()) { entry!.stage = "unknown"; return false; }
      const authorizationExpiresAt = auth.expiresAt;
      const providerCurrent = () => current() && entry!.stage === "confirming"
        && now() < authorizationExpiresAt && now() < approval.intent.quote.expiresAt
        && state.configuration !== null && configKey(state.configuration) === configKey(finalConfig);
      // ONLY this final deliberately invoked path ever enters provider confirmation.
      if (!providerCurrent()) { hold(); return false; }
      const result = await input.provider!.confirm(Object.freeze({ clientSecret, paymentMethodId: token, configuration: finalConfig, isCurrent: providerCurrent }));
      paymentMethodId = null;
      if (!current()) { entry!.stage = "unknown"; return false; }
      if (!result || !["succeeded", "processing"].includes(result.status)) { hold(); return false; }
      entry!.stage = "awaiting_ledger";
      emit({ phase: "processing", message: LEDGER_REASON });
      if (!current()) return false;
      const ledger = await fresh();
      if (!ledger || !current()) return false;
      if (getCompanyJobBillingState(ledger.detail).isPaid === true) paid(ledger.detail);
      else emit({ phase: "processing", message: LEDGER_REASON });
      return true;
    } catch { paymentMethodId = null; safeFailure(); return false; } finally { release(); }
  };
  const refreshStatus = async () => {
    if (unavailable() || !acquire()) return false;
    try {
      if (!await hydrate() || !current()) return false;
      const read = await fresh();
      if (!read || !current()) return false;
      if (getCompanyJobBillingState(read.detail).isPaid === true) { paid(read.detail); return true; }
      if (!entry!.anchor) { block("There is no original native attempt to check. Refresh the Job before collecting."); return false; }
      return await recover();
    } catch { safeFailure(); return false; } finally { release(); }
  };
  return {
    getState: () => state, refresh, selectMethod, setPaymentMethod, quoteTip, continueToSignature, back, approveSignature, confirm, refreshStatus,
    dispose: () => {
      disposed = true; approved = null; signaturePaymentMethod = null; paymentMethodId = null;
      if (ownsAnchor && entry?.anchor && entry.stage === "approved") entry.stage = "unknown";
      // Do not release an in-flight coordinator lock or erase its recovery pointer.
      if (entry && !entry.busy && (!entry.anchor || entry.stage === "paid")) coordination.delete(jobScope);
    },
  };
}
