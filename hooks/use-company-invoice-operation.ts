import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { getJobSyncCompanyJobDetail, getJobSyncMobileSession,
  getJobSyncCompanyInvoiceOperation, sendJobSyncCompanyInvoiceOperation } from "@/lib/jobsync-mobile-api";
import { assertCompanyJobInvoiceJob, assertCompanyJobInvoiceSession } from "@/lib/company-job-invoice-intent";
import { createCompanyInvoiceOperationController, type CompanyInvoiceOperationControllerOptions,
  type CompanyInvoiceOperationResult } from "@/lib/company-job-invoice-operation-controller";
import { captureCompanyInvoiceOperationIntent, type CompanyInvoiceOperationContext,
  type CompanyInvoiceOperationIntent } from "@/lib/company-job-invoice-operation";
import { isCurrentCompanyInvoiceOperationIntent } from "@/lib/company-job-invoice-operation-lifecycle";
import { newCompanyInvoiceOperationKey } from "@/lib/company-job-invoice-operation-storage";
import { companyInvoiceOperationReleaseReady } from "@/lib/company-verified-contract-release";

/** One manager-screen controller; journal identity is never sheet state. */
export function useCompanyInvoiceOperation(input: {
  context: CompanyInvoiceOperationContext | null;
  visible: boolean;
  focused: boolean;
  isCurrent: () => boolean;
  /** Explicit isolated controller injection for offline source fixtures only. */
  isolatedController?: CompanyInvoiceOperationControllerOptions;
}) {
  const [controller] = useState(() => createCompanyInvoiceOperationController(input.isolatedController ?? {
    transport: { send: sendJobSyncCompanyInvoiceOperation, lookup: getJobSyncCompanyInvoiceOperation },
  }));
  const [published, setPublished] = useState<{ scope: string; value: CompanyInvoiceOperationResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<{ scope: string; message: string } | null>(null);
  const preparedResend = useRef<{ scope: string; key: string } | null>(null);
  const [resend, setResend] = useState<{ scope: string; key: string } | null>(null);
  const scope = JSON.stringify([input.context?.session?.token, input.context?.session?.company?.id,
    input.context?.session?.user.id, input.context?.session?.user.role, input.context?.job?.id,
    input.context?.lifetime.sheetEpoch, input.context?.lifetime.focusEpoch,
    input.context?.options.method, input.context?.options.resend,
    input.context?.options.recipientEmail?.trim().toLowerCase() ?? null, input.context?.operationKey ?? null]);
  const result = published?.scope === scope ? published.value : null;
  const error = fault?.scope === scope ? fault.message : null;
  const context = useMemo(() => input.context ? ({ ...input.context,
    ...(resend?.scope === scope && input.context.options.resend ? { operationKey: resend.key } : {}) }) : null,
  [input.context, resend, scope]);
  const explicitKey = context?.operationKey ?? null;
  const identity = useMemo(() => ({ scope, explicitKey, visible: input.visible, focused: input.focused }),
    [scope, explicitKey, input.visible, input.focused]);
  const live = useRef({ mounted: false, focused: false, appActive: false,
    context: null as CompanyInvoiceOperationContext | null,
    identity: null as typeof identity | null, current: (() => false) as () => boolean });
  const lock = useRef(false);
  useLayoutEffect(() => {
    live.current = { mounted: input.visible, focused: input.focused,
      appActive: AppState.currentState == null || AppState.currentState === "active",
      context, identity, current: input.isCurrent };
    return () => { live.current.mounted = false; };
  }, [context, identity, input.visible, input.focused, input.isCurrent]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      live.current.appActive = state === "active";
      if (state !== "active") live.current.mounted = false;
    });
    return () => subscription.remove();
  }, []);
  const current = useCallback((intent: CompanyInvoiceOperationIntent) =>
    live.current.identity === identity && live.current.current()
      && isCurrentCompanyInvoiceOperationIntent(intent, live.current), [identity]);
  const capture = useCallback(() => {
    const captured = live.current.context;
    if (!captured) throw new Error("Reopen the Company invoice sheet.");
    const intent = captureCompanyInvoiceOperationIntent(captured);
    if (!current(intent)) throw new Error("The originating invoice sheet changed.");
    return { context: captured, intent };
  }, [current]);
  const enabled = companyInvoiceOperationReleaseReady() || Boolean(input.isolatedController?.isolatedTransport);
  const run = useCallback(async (mode: "send" | "recover") => {
    if (lock.current || !enabled) return null;
    let captured: ReturnType<typeof capture>;
    try { captured = capture(); } catch { return null; }
    lock.current = true; setBusy(true); setFault(null);
    try {
      const signed = await getJobSyncMobileSession(captured.intent.token);
      if (!current(captured.intent)) return null;
      assertCompanyJobInvoiceSession(captured.intent, signed);
      const detail = await getJobSyncCompanyJobDetail(captured.intent.token, captured.intent.jobId, captured.intent.companyId);
      if (!current(captured.intent)) return null;
      assertCompanyJobInvoiceJob(captured.intent, detail);
      const next = await controller[mode](captured.context, current);
      if (!current(captured.intent) || next.state === "stale") return null;
      setPublished({ scope, value: next });
      return next;
    } catch (failure) {
      if (current(captured.intent)) setFault({ scope, message: failure instanceof Error ? failure.message
        : "Invoice status could not be verified. Recover before sending again." });
      return null;
    } finally {
      lock.current = false;
      // Busy is screen-wide; receipt/error publication remains originating-scope fenced.
      if (live.current.context && live.current.mounted) setBusy(false);
    }
  }, [enabled, capture, current, controller, scope]);
  const recover = useCallback(() => run("recover"), [run]);
  const send = useCallback(() => run("send"), [run]);
  const prepareResend = useCallback(() => {
    if (!enabled || lock.current || !["completed", "failed"].includes(result?.state ?? "")) return false;
    let captured: ReturnType<typeof capture>;
    try { captured = capture(); } catch { return false; }
    if (!captured.intent.options.resend) return false;
    const previous = preparedResend.current;
    if (previous?.scope === scope && result?.operationKey !== previous.key) return true;
    const key = newCompanyInvoiceOperationKey();
    if (!current(captured.intent)) return false;
    preparedResend.current = { scope, key }; setResend({ scope, key });
    return true;
  }, [enabled, result, capture, scope, current]);
  const committedRecovery = useRef<{ scope: string; run: typeof recover } | null>(null);
  useLayoutEffect(() => { committedRecovery.current = { scope, run: recover }; });
  useEffect(() => {
    if (!input.visible || !input.focused || !enabled) return;
    let active = true;
    void Promise.resolve().then(() => {
      const callback = committedRecovery.current;
      if (active && callback?.scope === scope) void callback.run();
    });
    return () => { active = false; };
  }, [scope, input.visible, input.focused, enabled]);
  const held = result?.operationKey != null && !["completed", "failed"].includes(result.state);
  const available = enabled && input.visible && input.focused && Boolean(context);
  return { result, busy, error, send, recover, prepareResend,
    canSend: available && !busy && !error && !held && (!context?.options.resend || resend?.scope === scope),
    resendPrepared: resend?.scope === scope,
    canPrepareResend: available && !busy && ["completed", "failed"].includes(result?.state ?? "") };
}
