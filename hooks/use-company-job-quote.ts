import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  getJobSyncMobileSession, normalizeCompanyJobQuoteInput, normalizeCompanyJobQuote,
  quoteJobSyncCompanyJob, type JobSyncCompanyJobQuote, type JobSyncCompanyJobQuoteInput,
  type JobSyncNativeSession,
} from "@/lib/jobsync-mobile-api";
import { companyCreateJobAllowed, companyCreateJobScope } from "@/lib/company-create-job";

type QuoteOptions = {
  session: JobSyncNativeSession | null;
  input: JobSyncCompanyJobQuoteInput | null;
  enabled: boolean;
  isCurrent: () => boolean;
  /** Catalog refreshes also retire a quote even if the selected IDs did not change. */
  revision?: unknown;
};
type QuoteState = { identity: object | null; sequence: number; quote: JobSyncCompanyJobQuote | null; loading: boolean; error: string | null };
const EMPTY: QuoteState = { identity: null, sequence: 0, quote: null, loading: false, error: null };

/** Quotes are read-only server results, never local estimates or persisted Job pricing. */
export function useCompanyJobQuote({ session, input, enabled, isCurrent, revision }: QuoteOptions) {
  const scope = companyCreateJobScope(session);
  const active = enabled && isCurrent();
  let captured: JobSyncCompanyJobQuoteInput | null = null;
  let inputError: string | null = null;
  try {
    if (input) captured = normalizeCompanyJobQuoteInput(input);
  } catch (error) { inputError = error instanceof Error ? error.message : "Review the service quantities and discount."; }
  const key = captured ? JSON.stringify(captured) : null;
  // An A -> B -> A transition cannot resurrect A's old quote or handlers.
  const identity = useMemo(() => ({ scope, key, active, inputError, revision }), [scope, key, active, inputError, revision]);
  const requestInput = useMemo(() => key ? normalizeCompanyJobQuoteInput(JSON.parse(key)) : null, [key]);
  const [state, setState] = useState<QuoteState>(EMPTY);
  const live = useRef({ identity: null as object | null, mounted: false, sequence: 0, bound: null as JobSyncCompanyJobQuote | null, current: isCurrent });
  useLayoutEffect(() => { live.current.current = isCurrent; }, [isCurrent]);
  useLayoutEffect(() => {
    const binding = live.current;
    binding.identity = identity; binding.mounted = true; binding.sequence++; binding.bound = null;
    return () => { binding.mounted = false; binding.identity = null; binding.sequence++; binding.bound = null; };
  }, [identity]);
  const allowed = useCallback(() => Boolean(active && scope && requestInput && live.current.mounted
    && live.current.identity === identity && live.current.current()), [active, scope, requestInput, identity]);
  // Invoke before a draft setter: even a retained Save in the same event batch fails closed.
  const invalidate = useCallback(() => {
    if (live.current.identity !== identity || !live.current.mounted) return;
    live.current.sequence++; live.current.bound = null;
    setState(EMPTY);
  }, [identity]);
  const refresh = useCallback(async () => {
    if (!allowed() || !session || !requestInput) return;
    const sequence = ++live.current.sequence;
    live.current.bound = null;
    const current = () => allowed() && live.current.sequence === sequence;
    setState({ identity, sequence, quote: null, loading: true, error: null });
    // All nested input is normalized/captured before the first await.
    try {
      const signed = await getJobSyncMobileSession(session.token);
      if (!current()) return;
      if (!companyCreateJobAllowed(signed) || companyCreateJobScope(signed) !== scope) throw new Error("Your Company sign-in changed. Reopen Add Job.");
      const result = await quoteJobSyncCompanyJob(signed.token, signed.company!.id, requestInput);
      if (!current()) return;
      // Reuse the API's validator, including with injected/mocked transports. No pricing math here.
      const quote = normalizeCompanyJobQuote(result, requestInput);
      if (!quote) throw new Error("The backend did not return a complete bound quote with stored Job tax support.");
      const verified = await getJobSyncMobileSession(session.token);
      if (!current()) return;
      if (!companyCreateJobAllowed(verified) || companyCreateJobScope(verified) !== scope) throw new Error("Your Company sign-in changed. Reopen Add Job.");
      live.current.bound = quote;
      setState({ identity, sequence, quote, loading: false, error: null });
    } catch (error) {
      if (current()) setState({ identity, sequence, quote: null, loading: false,
        error: `Server pricing is unavailable. A complete quote with stored tax support is required before saving. ${error instanceof Error ? error.message : "Refresh pricing or try again later."}` });
    }
  }, [allowed, session, requestInput, scope, identity]);
  useEffect(() => { void refresh(); }, [identity, refresh]);
  const visible = active && scope && state.identity === identity ? state : EMPTY;
  // This render-bound accessor deliberately cannot be reused after edits, retries or session changes.
  const getBoundQuote = useCallback(() => allowed() && live.current.sequence === state.sequence
    && live.current.bound === state.quote && state.identity === identity ? state.quote : null,
  [allowed, state, identity]);
  return { quote: visible.quote, loading: visible.loading, error: enabled ? inputError || visible.error : null, refresh, invalidate, getBoundQuote };
}
