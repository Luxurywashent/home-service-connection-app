import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "expo-router";
import type { JobSyncCompanyJobDetail, JobSyncNativeSession } from "@/lib/jobsync-mobile-api";
import { getCompanyJobBillingState } from "@/lib/company-job-billing";
import { companyCheckoutScope } from "@/lib/company-job-checkout";
import {
  createCompanyNativeCheckoutController, type CompanyNativeCheckoutController, type NativeCheckoutState,
  type NativeCheckoutTip,
} from "@/lib/company-native-checkout";
import { companyNativePaymentTransport } from "@/lib/company-native-payment-api";
import { companyNativePaymentStore, newCompanyNativePaymentPointer, type CompanyNativePaymentPointer } from "@/lib/company-native-payment-storage";
import { CompanySecureCardField } from "./company-secure-card-field";
import type { CompanySecureCardHandle, CompanySecureCardMetadata as CompanySecureCardChange } from "@/lib/company-secure-card";
import {
  CompanyNativeCheckoutFlow, type CompanyNativeCheckoutViewModel,
  type CompanyCheckoutSignatureDraft, type CompanyCheckoutTipSelection,
} from "./company-native-checkout-flow";

type Props = {
  visible: boolean; session: JobSyncNativeSession; jobId: number; customerName: string;
  isCurrent: () => boolean; onClose: () => void;
  onVerifiedDetail: (detail: JobSyncCompanyJobDetail) => void;
  presentation?: "modal" | "overlay";
};
const money = (cents: number, currency = "usd") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
/** Native Metro resolves this file; the unchanged .tsx implementation remains browser-only. */
export function CompanyJobCheckout(props: Props) {
  const focused = useIsFocused();
  const live = useRef(props); const focus = useRef(focused);
  const active = useRef(AppState.currentState === "active");
  const controller = useRef<CompanyNativeCheckoutController | null>(null);
  const secureCard = useRef<CompanySecureCardHandle>(null);
  const generation = useRef(0); const closed = useRef(false);
  const mounted = useRef(false);
  const tokenizationLock = useRef<number | null>(null);
  const hasOperation = useRef(false);
  const [snapshot, setSnapshot] = useState<{ state: NativeCheckoutState; epoch: number; step: CompanyNativeCheckoutViewModel["step"] } | null>(null);
  const state = snapshot?.state ?? null;
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [tokenizing, setTokenizing] = useState(false);
  const [card, setCard] = useState<CompanySecureCardChange>({ complete: false, brand: null, last4: null });
  const [cardReady, setCardReady] = useState(false);
  const [signature, setSignature] = useState<CompanyCheckoutSignatureDraft | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [tipChoice, setTipChoice] = useState<CompanyCheckoutTipSelection>("none");
  const scope = companyCheckoutScope(props.session, props.jobId);
  useLayoutEffect(() => { live.current = props; focus.current = focused; }, [props, focused]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (value) => {
      active.current = value === "active";
      setForeground(active.current);
      if (!active.current) { generation.current++; controller.current?.dispose(); secureCard.current?.clear(); setSignature(null); }
    });
    return () => sub.remove();
  }, []);
  const isCurrent = useCallback(() => Boolean(mounted.current && scope && !closed.current && focus.current && active.current
    && live.current.visible && live.current.isCurrent() && companyCheckoutScope(live.current.session, live.current.jobId) === scope), [scope]);
  const epoch = snapshot?.epoch;
  const flowCurrent = useCallback(() => isCurrent() && epoch !== undefined && generation.current === epoch, [isCurrent, epoch]);
  const invalidateEpoch = useCallback(() => { generation.current++; }, []);
  const clearSecureCard = useCallback(() => { secureCard.current?.clear(); }, []);
  useEffect(() => {
    const originProps = live.current;
    const session = originProps.session; const jobId = originProps.jobId;
    if (!originProps.visible || !focused || !scope || !foreground || !active.current || !originProps.isCurrent()) return;
    const captured = ++generation.current; closed.current = false;
    hasOperation.current = false; setTokenizing(false); setCardReady(false);
    setCard({ complete: false, brand: null, last4: null }); setSignature(null);
    let pointer: CompanyNativePaymentPointer | null = null;
    const current = () => captured === generation.current && isCurrent();
    const c = createCompanyNativeCheckoutController({
      session, jobId, isCurrent: current,
      onState: (next) => {
        if (current()) setSnapshot((previous) => {
          const step = ["card", "tip", "signature"].includes(next.phase) ? next.phase as "card" | "tip" | "signature"
            : next.phase === "method" || next.phase === "paid" || next.method !== "card" ? "method"
            : previous?.epoch === captured && previous.step !== "method" ? previous.step
            : next.quote ? "signature" : next.card ? "tip" : "card";
          return { state: next, epoch: captured, step };
        });
      },
      onVerifiedDetail: (detail) => { if (current()) live.current.onVerifiedDetail(detail); },
      nativeTransport: companyNativePaymentTransport,
      operations: {
        load: async () => {
          pointer = await companyNativePaymentStore.read(session.company!.id, session.user.id, jobId);
          if (current()) hasOperation.current = Boolean(pointer);
          return pointer ? { companyId: pointer.companyId, jobId: pointer.jobId, operationKey: pointer.operationKey } : null;
        },
        generateKey: () => {
          pointer = newCompanyNativePaymentPointer(session.company!.id, session.user.id, jobId);
          if (current()) hasOperation.current = true;
          return pointer.operationKey;
        },
        save: async (anchor) => {
          if (!current() || !pointer || pointer.operationKey !== anchor.operationKey || pointer.companyId !== anchor.companyId || pointer.jobId !== anchor.jobId
            || !await companyNativePaymentStore.reserve(pointer)) throw new Error("Original payment recovery could not be secured.");
        },
        // Only the controller's canonical-paid path calls this callback. Closing,
        // provider outcomes and unresolved/declined attempts never release it.
        releasePaid: async (anchor) => {
          if (anchor.companyId !== session.company!.id || anchor.jobId !== jobId) throw new Error("Original payment recovery scope changed.");
          const original = pointer ?? await companyNativePaymentStore.read(session.company!.id, session.user.id, jobId);
          if (!original || original.companyId !== anchor.companyId || original.userId !== session.user.id
            || original.jobId !== anchor.jobId || original.operationKey !== anchor.operationKey) return;
          if (!await companyNativePaymentStore.remove(original)) throw new Error("Original payment recovery cleanup could not be confirmed.");
          if (pointer?.operationKey === anchor.operationKey) pointer = null;
        },
      },
      provider: { confirm: async ({ clientSecret, paymentMethodId, isCurrent: providerCurrent }) => {
        if (!current() || !providerCurrent() || !secureCard.current) throw new Error("The current checkout changed before confirmation.");
        const result = await secureCard.current.confirm(clientSecret, paymentMethodId, () => current() && providerCurrent());
        if (!current() || !providerCurrent() || !["succeeded", "processing"].includes(result.outcome)) throw new Error("The original payment outcome must be checked.");
        return { status: result.outcome as "succeeded" | "processing" };
      } },
    });
    controller.current = c; void c.refresh();
    return () => { invalidateEpoch(); c.dispose(); if (controller.current === c) controller.current = null; clearSecureCard(); };
  }, [props.visible, focused, foreground, scope, isCurrent, invalidateEpoch, clearSecureCard]);
  const close = () => { if (!flowCurrent()) return; closed.current = true; generation.current++; controller.current?.dispose(); secureCard.current?.clear(); setSignature(null); live.current.onClose(); };
  const onCardChange = useCallback((change: CompanySecureCardChange) => { if (flowCurrent()) { setCard(change); setSignature(null); } }, [flowCurrent]);
  const readyChanged = useCallback((ready: boolean) => { if (flowCurrent()) setCardReady(ready); }, [flowCurrent]);
  const signatureChanged = useCallback((draft: CompanyCheckoutSignatureDraft | null) => { if (flowCurrent()) setSignature(draft); }, [flowCurrent]);
  const vm = useMemo<CompanyNativeCheckoutViewModel>(() => {
    const phase = state?.phase ?? "method";
    const balance = state?.detail ? getCompanyJobBillingState(state.detail).balance : null;
    const candidate = state?.quote;
    const matchesTip = candidate && (tipChoice === "none" ? candidate.tip.kind === "none"
      : tipChoice === "custom" ? candidate.tip.kind === "custom" && /^\d{1,6}(?:\.\d{0,2})?$/.test(customTip)
        && candidate.tip.amountCents === Math.round(Number(customTip) * 100)
      : candidate.tip.kind === "percentage" && candidate.tip.percent === tipChoice);
    const quote = matchesTip ? candidate : null;
    return {
      step: snapshot?.step ?? "method",
      status: state?.busy || tokenizing ? "loading" : ["processing", "unknown", "blocked", "paid", "error"].includes(phase) ? phase as "processing" | "unknown" | "blocked" | "paid" | "error" : state ? "ready" : "loading",
      customerName: props.customerName, serviceName: state?.detail?.title ?? "Job payment", balanceLabel: "Balance Due",
      balanceAmountText: balance === null ? "Not available" : money(Math.round(balance * 100)),
      manualCardAvailable: state?.methods.card.available === true,
      manualCardUnavailableReason: state?.methods.card.reason ?? "In-app card collection is awaiting verified backend support.",
      canContinueCard: cardReady && card.complete && state?.methods.card.available === true && !state.busy && !tokenizing,
      tipSelection: tipChoice,
      customTipText: customTip,
      quote: quote ? { key: JSON.stringify([quote.quoteId, quote.obligationVersion, quote.principalCents, quote.tipCents, quote.totalCents]),
        serviceAmountText: money(quote.principalCents, quote.currency), tipAmountText: money(quote.tipCents, quote.currency), totalAmountText: money(quote.totalCents, quote.currency) } : null,
      canContinueTip: Boolean(quote && !state?.busy), canConfirmPayment: Boolean(quote && signature && !state?.busy), signature, message: state?.message,
    };
  }, [state, snapshot?.step, props.customerName, cardReady, card, customTip, tipChoice, signature, tokenizing]);
  const cardContinue = async () => {
    const c = controller.current;
    if (!flowCurrent() || !c || !cardReady || !card.complete || !secureCard.current || tokenizationLock.current === generation.current) return;
    const tokenEpoch = generation.current;
    tokenizationLock.current = tokenEpoch; setTokenizing(true);
    try {
      const token = await secureCard.current.tokenize();
      if (!flowCurrent() || controller.current !== c || !token.brand || !token.last4) return;
      if (c.setPaymentMethod(token.paymentMethodId, { brand: token.brand, last4: token.last4 })) await c.quoteTip({ kind: "none" });
    } catch { if (flowCurrent() && controller.current === c) await c.refresh(); }
    finally { if (tokenizationLock.current === tokenEpoch) tokenizationLock.current = null; if (flowCurrent() && controller.current === c) setTokenizing(false); }
  };
  const selectTip = (selection: CompanyCheckoutTipSelection) => {
    if (!flowCurrent()) return; setSignature(null); setTipChoice(selection);
    if (selection === "custom") { setCustomTip(""); return; }
    const tip: NativeCheckoutTip = selection === "none" ? { kind: "none" } : { kind: "percentage", percent: selection };
    void controller.current?.quoteTip(tip);
  };
  const changeCustomTip = (value: string) => {
    if (!flowCurrent()) return; setCustomTip(value); setSignature(null);
    if (/^\d{1,6}(?:\.\d{0,2})?$/.test(value)) {
      const cents = Math.round(Number(value) * 100);
      if (Number.isSafeInteger(cents)) void controller.current?.quoteTip({ kind: "custom", amountCents: cents });
    }
  };
  const confirm = async (draft: CompanyCheckoutSignatureDraft) => {
    const c = controller.current;
    if (!flowCurrent() || !c || !signature || !vm.canConfirmPayment || draft.quoteKey !== signature.quoteKey || draft.pngDataUrl !== signature.pngDataUrl) return;
    if (await c.approveSignature({ pngDataUrl: draft.pngDataUrl }) && flowCurrent() && controller.current === c) await c.confirm();
  };
  return <CompanyNativeCheckoutFlow visible={props.visible} epochKey={`${scope ?? "invalid"}:${epoch ?? "pending"}`} state={vm} isCurrent={flowCurrent}
    presentation={props.presentation} onClose={close} onBack={() => { if (flowCurrent() && controller.current?.back()) { setSignature(null); } }}
    onManualCardEntry={() => { if (flowCurrent()) { setTipChoice("none"); setCustomTip(""); controller.current?.selectMethod("card"); } }}
    onCardContinue={() => { void cardContinue(); }} onTipSelect={selectTip} onCustomTipChange={changeCustomTip}
    onTipContinue={() => { if (flowCurrent() && vm.canContinueTip) controller.current?.continueToSignature(); }}
    onSignatureChange={signatureChanged} onConfirmPayment={(draft) => { void confirm(draft); }}
    onRefreshStatus={() => {
      if (flowCurrent()) {
        const c = controller.current;
        if (hasOperation.current || state?.signatureApproved || ["processing", "unknown"].includes(state?.phase ?? "")) void c?.refreshStatus();
        else void c?.refresh();
      }
    }}
    renderCardField={(slot) => state?.configuration ? <CompanySecureCardField ref={secureCard} scopeKey={`${scope ?? "invalid"}:${epoch ?? "pending"}`}
      configuration={state.configuration} disabled={slot.disabled && state.phase !== "processing"} isCurrent={flowCurrent} onReady={readyChanged} onChange={onCardChange} /> : null} />;
}
