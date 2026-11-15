import {
  createJobSyncCompanyJobCheckout,
  getJobSyncCompanyJobDetail,
  getJobSyncMobileSession,
  positiveJobSyncId,
  type JobSyncCompanyJobCheckout,
  type JobSyncCompanyJobDetail,
  type JobSyncNativeSession,
} from "./jobsync-mobile-api";
import { getCompanyJobBillingState } from "./company-job-billing";
import { companyJobSessionKey } from "./company-job-fieldwork";

export type CompanyCheckoutState = {
  phase: "loading" | "ready" | "opening" | "checkout" | "processing" | "paid" | "blocked" | "error";
  detail: JobSyncCompanyJobDetail | null;
  checkout: JobSyncCompanyJobCheckout | null;
  message: string | null;
};

/** The server supplies the live collection flag. Never derive it from fieldwork opt-in. */
export function companyPaymentCollectorAllowed(session: JobSyncNativeSession | null) {
  return Boolean(session?.portal === "company" && session.token.trim()
    && positiveJobSyncId(session.company?.id) && positiveJobSyncId(session.user.id)
    && (session.user.role === "owner"
      || (session.user.role === "dispatcher" && session.user.paymentCollectionEnabled === true)));
}

export function companyCheckoutScope(session: JobSyncNativeSession | null, jobId: number | null) {
  const key = companyJobSessionKey(session, jobId);
  return key ? JSON.stringify([key, session?.user.paymentCollectionEnabled ?? null]) : null;
}

export function companyCheckoutBlockReason(session: JobSyncNativeSession | null, detail: JobSyncCompanyJobDetail | null) {
  if (!companyPaymentCollectorAllowed(session)) return session?.user.role === "technician"
    ? "Payment collection requires a Company owner or an authorized admin. Ask your Company admin to collect this payment."
    : "Your current Company account does not have payment collection permission.";
  if (!detail || detail.companyId !== session?.company?.id) return "This Company Job is unavailable. Reopen the Job and try again.";
  const billing = getCompanyJobBillingState(detail);
  if (billing.isPaid === true) return "This Job is paid in full.";
  if (!billing.canCollect || billing.balance === null) return "The current Job balance is unavailable. Refresh before collecting a payment.";
  if (billing.balance < 0.5) return "Card checkout requires a remaining balance of at least $0.50.";
  if (!["scheduled", "en_route", "on_site", "completed", "follow_up"].includes(detail.status)) return "Card collection is unavailable for this Job's current status.";
  return null;
}

export type CompanyCheckoutTransport = {
  session: typeof getJobSyncMobileSession;
  detail: typeof getJobSyncCompanyJobDetail;
  checkout: typeof createJobSyncCompanyJobCheckout;
};
const transport: CompanyCheckoutTransport = {
  session: getJobSyncMobileSession, detail: getJobSyncCompanyJobDetail, checkout: createJobSyncCompanyJobCheckout,
};

/** Opening checkout is never a paid record. Only fresh Company ledger reads change displayed payment state. */
export function createCompanyJobCheckoutController(input: {
  session: JobSyncNativeSession;
  jobId: number;
  isCurrent: () => boolean;
  onState: (state: CompanyCheckoutState) => void;
  onVerifiedDetail?: (detail: JobSyncCompanyJobDetail) => void;
  openBrowser: (url: string) => Promise<unknown>;
  transport?: CompanyCheckoutTransport;
}) {
  const api = input.transport ?? transport;
  let disposed = false;
  let locked = false;
  let state: CompanyCheckoutState = { phase: "loading", detail: null, checkout: null, message: null };
  const originatingScope = companyCheckoutScope(input.session, input.jobId);
  const current = () => !disposed && input.isCurrent() && Boolean(originatingScope)
    && companyCheckoutScope(input.session, input.jobId) === originatingScope;
  const emit = (patch: Partial<CompanyCheckoutState>) => {
    if (!current()) return;
    state = { ...state, ...patch };
    input.onState(state);
  };
  const fresh = async () => {
    if (!current()) return null;
    const actor = await api.session(input.session.token);
    if (!current()) return null;
    if (actor.portal !== "company" || actor.token !== input.session.token
      || actor.company?.id !== input.session.company?.id || actor.user.id !== input.session.user.id
      || actor.user.role !== input.session.user.role) throw new Error("Your Company sign-in changed. Reopen the Job before collecting payment.");
    const detail = await api.detail(actor.token, input.jobId, actor.company!.id);
    if (!current()) return null;
    if (detail.id !== input.jobId || detail.companyId !== actor.company?.id) throw new Error("The originating Company Job is unavailable.");
    // Denied actors may read their scoped Job, but may never create checkout.
    input.onVerifiedDetail?.(detail);
    return { actor, detail };
  };
  const publish = (actor: JobSyncNativeSession, detail: JobSyncCompanyJobDetail, message: string | null = null) => {
    if (!current()) return;
    const billing = getCompanyJobBillingState(detail);
    if (billing.isPaid === true) {
      emit({ phase: "paid", detail, checkout: null, message: "Payment confirmed by your Company's payment records." });
      return;
    }
    const reason = companyCheckoutBlockReason(actor, detail);
    if (reason) { emit({ phase: "blocked", detail, message: reason }); return; }
    const changedAmount = state.checkout && state.checkout.amountCents !== Math.round(billing.balance! * 100);
    if (changedAmount) state = { ...state, checkout: null };
    emit({ detail, phase: state.checkout?.checkoutState === "processing" || state.checkout?.checkoutState === "creating"
      ? "processing" : state.checkout ? "checkout" : "ready", message });
  };
  const failure = (error: unknown) => emit({ phase: "error", message: error instanceof Error ? error.message : "Could not confirm payment status. Refresh before trying again." });
  const refresh = async () => {
    if (locked || !current()) return false;
    locked = true;
    emit({ phase: "loading", message: null });
    try {
      const read = await fresh();
      if (!read || !current()) return false;
      publish(read.actor, read.detail, state.checkout ? "Checkout has been opened. Payment is not confirmed until it appears in your Company's records." : null);
      return true;
    } catch (error) { failure(error); return false; }
    finally { locked = false; }
  };
  const pay = async () => {
    if (locked || !current() || state.checkout?.checkoutState === "processing" || state.checkout?.checkoutState === "creating") return false;
    locked = true;
    emit({ phase: "opening", message: null });
    try {
      const read = await fresh();
      if (!read || !current()) return false;
      const reason = companyCheckoutBlockReason(read.actor, read.detail);
      if (reason) { publish(read.actor, read.detail); return false; }
      const amountCents = Math.round(getCompanyJobBillingState(read.detail).balance! * 100);
      let checkout = state.checkout;
      if (!checkout || checkout.amountCents !== amountCents || checkout.checkoutState !== "open") {
        // The canonical server attempt authority reuses/reconciles existing attempts. No automatic retry.
        checkout = await api.checkout(read.actor.token, input.jobId);
        if (!current()) return false;
      }
      emit({ detail: read.detail, checkout, phase: checkout.checkoutState === "open" ? "checkout" : "processing" });
      if (checkout.amountCents !== amountCents) throw new Error("The Job balance changed while checkout was prepared. Refresh and review the current amount before continuing.");
      if (checkout.checkoutState !== "open" || !checkout.url) {
        emit({ message: "Your card checkout is being reconciled. Refresh payment status; do not collect a second payment." });
        return false;
      }
      // URL has been strictly validated by the bearer transport before it reaches the browser.
      if (!current()) return false;
      await input.openBrowser(checkout.url);
      if (!current()) return false;
      const after = await fresh();
      if (!after || !current()) return false;
      publish(after.actor, after.detail, "Secure checkout was opened. Refresh after the customer pays; closing checkout does not confirm payment.");
      return true;
    } catch (error) { failure(error); return false; }
    finally { locked = false; }
  };
  return { refresh, pay, hasCheckout: () => Boolean(state.checkout), dispose: () => { disposed = true; } };
}
