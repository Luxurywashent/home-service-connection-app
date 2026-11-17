import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CompanyCheckoutSignature, type CompanyCheckoutSignatureRef } from "./company-checkout-signature";

export type CompanyCheckoutTipSelection = 15 | 18 | 20 | 25 | "none" | "custom";
export interface CompanyCheckoutQuoteView {
  /** Server quote identity; rotate whenever principal, tip, or gross changes. */
  key: string;
  serviceAmountText: string;
  tipAmountText: string;
  totalAmountText: string;
}
export interface CompanyCheckoutSignatureDraft {
  quoteKey: string;
  /** Private local-memory PNG. Never log, persist, or use a public upload helper. */
  pngDataUrl: string;
}
export interface CompanyNativeCheckoutViewModel {
  step: "method" | "card" | "tip" | "signature";
  status: "ready" | "loading" | "processing" | "unknown" | "blocked" | "paid" | "error";
  customerName: string;
  serviceName: string;
  balanceLabel: string;
  balanceAmountText: string;
  manualCardAvailable: boolean;
  manualCardUnavailableReason?: string;
  canContinueCard: boolean;
  tipSelection: CompanyCheckoutTipSelection;
  customTipText: string;
  /** Optional amounts returned by the server, not locally calculated estimates. */
  tipOptionAmountText?: Partial<Record<15 | 18 | 20 | 25, string>>;
  quote: CompanyCheckoutQuoteView | null;
  canContinueTip: boolean;
  canConfirmPayment: boolean;
  signature: CompanyCheckoutSignatureDraft | null;
  message?: string | null;
}
export interface CompanyCheckoutCardFieldSlot {
  disabled: boolean;
  visible: boolean;
  /** Bridge must also guard its asynchronous init/tokenization completion. */
  isCurrent: () => boolean;
}
export interface CompanyNativeCheckoutFlowProps {
  visible: boolean;
  /** Parent scope/reopen/attempt epoch. Never derive permissions from this value. */
  epochKey: string | number;
  state: CompanyNativeCheckoutViewModel;
  /** Parent must include role, Company, Job, session, focus, and AppState checks. */
  isCurrent: () => boolean;
  renderCardField?: (slot: CompanyCheckoutCardFieldSlot) => React.ReactNode;
  onManualCardEntry: () => void;
  /** Tokenization only; never confirm a payment at the card-entry step. */
  onCardContinue: () => void;
  onTipSelect: (selection: CompanyCheckoutTipSelection) => void;
  onCustomTipChange: (text: string) => void;
  onTipContinue: () => void;
  onSignatureChange: (draft: CompanyCheckoutSignatureDraft | null) => void;
  /** The sole final payment action, bound to the current server quote and signature. */
  onConfirmPayment: (draft: CompanyCheckoutSignatureDraft) => void;
  onBack: () => void;
  onClose: () => void;
  onRefreshStatus: () => void;
  presentation?: "modal" | "overlay";
}

const TAP_UNAVAILABLE = "Unavailable: Tap to Pay SDK and Apple entitlements are not configured or verified. Use secure manual card entry when available.";
const PNG = /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/;
const statusText: Partial<Record<CompanyNativeCheckoutViewModel["status"], string>> = {
  loading: "Checking current checkout availability…",
  processing: "Payment is processing. Refresh status before taking any further payment action.",
  unknown: "Payment status is unknown. Refresh status; do not retry the charge.",
  blocked: "Checkout is unavailable. Refresh status to check current eligibility.",
  error: "Checkout could not continue. Refresh status before trying again.",
  paid: "Payment verified by current Company payment records.",
};

/** Presentation only: no SDK, HTTP, payment, browser navigation, or storage calls. */
export function CompanyNativeCheckoutFlow(props: CompanyNativeCheckoutFlowProps) {
  return <ScopedCompanyNativeCheckoutFlow key={props.epochKey} {...props} />;
}
function ScopedCompanyNativeCheckoutFlow(props: CompanyNativeCheckoutFlowProps) {
  const insets = useSafeAreaInsets();
  const live = useRef(props);
  const mounted = useRef(true);
  const closed = useRef(false);
  const confirmLock = useRef(false);
  const invalidSignature = useRef(true);
  const signatureRef = useRef<CompanyCheckoutSignatureRef>(null);
  const [padRevision, setPadRevision] = useState(0);
  const [drawingToken, setDrawingToken] = useState<object | null>(null);
  const [approved, setApproved] = useState<{ token: object; revision: number; png: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const state = props.state;
  const quote = state.quote;
  const quoteIdentity = JSON.stringify(quote ? [quote.key, quote.serviceAmountText, quote.tipAmountText, quote.totalAmountText] : null);
  const identity = JSON.stringify([props.epochKey, props.visible, state.step, state.status, quoteIdentity]);
  // Tokens change even when leaving and returning to the same identity. Retained events
  // can only use a committed token, never a concurrent/abandoned render.
  const eventToken = useMemo(() => ({ identity, padRevision }), [identity, padRevision]);
  const committedToken = useRef(eventToken);
  const lastIdentity = useRef(identity);
  useLayoutEffect(() => {
    live.current = props;
    committedToken.current = eventToken;
    if (lastIdentity.current !== identity) {
      lastIdentity.current = identity;
      invalidSignature.current = true;
      if (props.visible && !closed.current && props.isCurrent()) props.onSignatureChange(null);
    }
  }, [props, identity, eventToken]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; closed.current = true; };
  }, []);
  const current = () => mounted.current && !closed.current && live.current.visible
    && committedToken.current === eventToken && live.current.epochKey === props.epochKey
    && props.isCurrent() && live.current.isCurrent();
  const ready = state.status === "ready";
  const drawing = drawingToken === eventToken;
  const editable = () => current() && live.current.state.status === "ready" && !confirmLock.current;
  const manualAvailable = ready && state.manualCardAvailable && Boolean(props.renderCardField);
  const close = () => {
    if (!current()) return;
    closed.current = true; invalidSignature.current = true;
    setApproved(null); setDrawingToken(null);
    props.onSignatureChange(null); props.onClose();
  };
  const back = () => {
    if (!editable()) return;
    invalidSignature.current = true; setApproved(null);
    props.onSignatureChange(null); props.onBack();
  };
  const signatureChanged = (pngDataUrl: string | null) => {
    if (!editable() || live.current.state.step !== "signature") return;
    const currentQuote = live.current.state.quote;
    if (!currentQuote) return;
    invalidSignature.current = !pngDataUrl || pngDataUrl.length > 4 * 1024 * 1024 || !PNG.test(pngDataUrl);
    if (invalidSignature.current) { setApproved(null); props.onSignatureChange(null); }
    else {
      setApproved({ token: eventToken, revision: padRevision, png: pngDataUrl! });
      props.onSignatureChange({ quoteKey: currentQuote.key, pngDataUrl: pngDataUrl! });
    }
  };
  const validSignature = ready && Boolean(approved && approved.token === eventToken && approved.revision === padRevision
    && quote && state.signature && state.signature.quoteKey === quote.key
    && state.signature.pngDataUrl === approved.png && PNG.test(state.signature.pngDataUrl));
  const canConfirm = Boolean(state.canConfirmPayment && validSignature && !drawing && !submitted);
  const clear = () => {
    if (!editable()) return;
    invalidSignature.current = true;
    setApproved(null); setDrawingToken(null); setPadRevision((value) => value + 1);
    signatureRef.current?.clear(); props.onSignatureChange(null);
  };
  const confirm = () => {
    const latest = live.current.state;
    if (!editable() || latest.step !== "signature" || !canConfirm || invalidSignature.current
      || !approved || approved.token !== eventToken || approved.revision !== padRevision
      || !latest.canConfirmPayment || !latest.signature || !latest.quote
      || latest.signature.quoteKey !== latest.quote.key || latest.signature.pngDataUrl !== approved.png
      || !PNG.test(latest.signature.pngDataUrl)) return;
    confirmLock.current = true; setSubmitted(true); // One-shot before parent commits processing.
    setApproved(null);
    props.onConfirmPayment({ ...latest.signature });
  };
  const title = state.step === "method" ? "Checkout" : state.step === "card" ? "Credit or Debit Card" : state.step === "tip" ? "Add a Tip" : "Customer Signature";
  if (!props.visible) return null;
  const body = (
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16), maxHeight: "94%" }]}>
        <View style={styles.header}>
          {state.step !== "method" ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" disabled={!ready}
              accessibilityState={{ disabled: !ready }} onPress={back} hitSlop={4} style={styles.headerButton}>
              <Text style={styles.backText}>‹ Back</Text>
            </TouchableOpacity>
          ) : <Text accessibilityRole="header" style={styles.title}>{title}</Text>}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close checkout" onPress={close} hitSlop={6} style={styles.headerButton}>
            <Text style={styles.closeText}>×</Text>
          </TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets
          scrollEnabled={!drawing} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {state.step !== "method" && <Text accessibilityRole="header" style={styles.title}>{title}</Text>}
          {state.step === "method" && <>
            <Text style={styles.customer}>{state.customerName} · {state.serviceName}</Text>
            <View style={styles.balancePanel}>
              <Text style={styles.muted}>{state.balanceLabel}</Text>
              <Text style={styles.balanceAmount}>{state.balanceAmountText}</Text>
            </View>
            <Text style={styles.eyebrow}>SELECT PAYMENT METHOD</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Tap to Pay on iPhone unavailable"
              accessibilityHint={TAP_UNAVAILABLE} accessibilityState={{ disabled: true }} disabled onPress={() => undefined}
              style={[styles.method, styles.tapMethod]}>
              <Text style={styles.methodIcon}>▣</Text>
              <View style={styles.methodCopy}><Text style={styles.methodTitle}>Tap to Pay on iPhone</Text></View>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Manual Card Entry" disabled={!manualAvailable}
              accessibilityState={{ disabled: !manualAvailable }} onPress={() => {
                if (editable() && live.current.state.step === "method" && live.current.state.manualCardAvailable && live.current.renderCardField) props.onManualCardEntry();
              }} style={[styles.method, !manualAvailable && styles.disabled]}>
              <Text style={styles.methodIcon}>▤</Text>
              <View style={styles.methodCopy}><Text style={styles.methodTitle}>Manual Card Entry</Text><Text style={styles.muted}>Enter card details in the secure payment field</Text></View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
            {!manualAvailable && <Text style={styles.muted}>{state.manualCardUnavailableReason || "Secure card entry is unavailable in this checkout context."}</Text>}
          </>}
          {state.step === "card" && <Text style={styles.muted}>Total: <Text style={styles.blueAmount}>{state.balanceAmountText}</Text></Text>}
          {/* Keep the parent secure field mounted across card → tip → signature. Hidden fields cannot receive input. */}
          {state.step !== "method" && <View style={state.step === "card" ? styles.panel : styles.hiddenCard}
            pointerEvents={state.step === "card" && ready ? "auto" : "none"}
            accessibilityElementsHidden={state.step !== "card"} importantForAccessibility={state.step !== "card" ? "no-hide-descendants" : "auto"}>
            <Text style={styles.fieldLabel}>Card Details</Text>
            {props.renderCardField ? <SecureCardFieldSlot renderCardField={props.renderCardField} disabled={!ready || !state.manualCardAvailable || state.step !== "card"} visible={state.step === "card"} isCurrent={current} />
              : <Text style={styles.muted}>Secure native card entry is unavailable. No card details can be entered here.</Text>}
          </View>}
          {state.step === "card" && <>
            <CheckoutButton label="Continue to Tip →" onPress={() => {
              if (editable() && live.current.state.step === "card" && live.current.state.canContinueCard && live.current.state.manualCardAvailable && live.current.renderCardField) props.onCardContinue();
            }} disabled={!ready || !state.canContinueCard || !state.manualCardAvailable || !props.renderCardField} />
            <Text style={styles.securityNote}>Card details stay in the secure payment field. This step does not charge the customer.</Text>
          </>}
          {state.step === "tip" && <>
            <View style={styles.panel}>
              <SummaryRow label="Service" amount={quote?.serviceAmountText ?? state.balanceAmountText} />
              <SummaryRow label="Tip" amount={quote?.tipAmountText ?? "Awaiting quote"} />
              <View style={styles.divider} />
              <SummaryRow label="Total" amount={quote?.totalAmountText ?? "Awaiting quote"} total />
            </View>
            <Text style={styles.eyebrow}>SELECT TIP AMOUNT</Text>
            <View style={styles.tipGrid}>{([15, 18, 20, 25] as const).map((percent) => (
              <TouchableOpacity key={percent} accessibilityRole="button" accessibilityLabel={`${percent}% tip`}
                accessibilityState={{ disabled: !ready, selected: state.tipSelection === percent }} disabled={!ready}
                onPress={() => { if (editable() && live.current.state.step === "tip") { invalidSignature.current = true; props.onSignatureChange(null); props.onTipSelect(percent); } }}
                style={[styles.tipOption, state.tipSelection === percent && styles.selected, !ready && styles.disabled]}>
                <Text style={styles.tipPercent}>{percent}%</Text>
                {state.tipOptionAmountText?.[percent] && <Text style={styles.tipAmount}>{state.tipOptionAmountText[percent]}</Text>}
              </TouchableOpacity>
            ))}</View>
            <View style={styles.tipGrid}>{(["none", "custom"] as const).map((selection) => (
              <TouchableOpacity key={selection} accessibilityRole="button" accessibilityLabel={selection === "none" ? "No Tip" : "Custom tip"}
                accessibilityState={{ disabled: !ready, selected: state.tipSelection === selection }} disabled={!ready}
                onPress={() => { if (editable() && live.current.state.step === "tip") { invalidSignature.current = true; props.onSignatureChange(null); props.onTipSelect(selection); } }}
                style={[styles.tipOther, state.tipSelection === selection && styles.selected, !ready && styles.disabled]}>
                <Text style={styles.buttonText}>{selection === "none" ? "No Tip" : "Custom"}</Text>
              </TouchableOpacity>
            ))}</View>
            {state.tipSelection === "custom" && <View style={styles.panel}>
              <Text style={styles.fieldLabel}>Custom tip amount</Text>
              <TextInput accessibilityLabel="Custom tip amount" value={state.customTipText} editable={ready}
                keyboardType="decimal-pad" inputMode="decimal" maxLength={12} placeholder="0.00" placeholderTextColor={C.muted}
                style={styles.customInput} onChangeText={(text) => {
                  if (editable() && live.current.state.step === "tip" && live.current.state.tipSelection === "custom") {
                    invalidSignature.current = true; props.onSignatureChange(null); props.onCustomTipChange(text);
                  }
                }} />
              <Text style={styles.securityNote}>The server will validate this amount and return the updated total.</Text>
            </View>}
            <Text style={styles.securityNote}>Amounts shown are from the current server quote. No payment has been confirmed.</Text>
            <CheckoutButton label="Continue to Signature →" onPress={() => { if (editable() && live.current.state.step === "tip" && live.current.state.quote && live.current.state.canContinueTip) props.onTipContinue(); }} disabled={!ready || !quote || !state.canContinueTip} />
          </>}
          {state.step === "signature" && <>
            <View style={styles.panel}>
              <SummaryRow label="Credit / Debit Card" amount={quote?.totalAmountText ?? "Awaiting quote"} />
              <View style={styles.divider} />
              <SummaryRow label="Total to Charge" amount={quote?.totalAmountText ?? "Awaiting quote"} total />
            </View>
            <Text style={styles.instruction}>Sign below to authorize payment:</Text>
            <View style={styles.signaturePad}>
              {ready && quote ? <CompanyCheckoutSignature key={`${identity}:${padRevision}`} ref={signatureRef}
                disabled={!ready || submitted} isCurrent={editable} onChange={signatureChanged}
                onDrawingChange={(active) => { if (editable()) setDrawingToken(active ? eventToken : null); }} />
                : <Text style={styles.padUnavailable}>Signature entry is unavailable until checkout and totals are verified.</Text>}
            </View>
            <View style={styles.finalRow}>
              <View style={styles.clearColumn}><CheckoutButton label="Clear" onPress={clear} disabled={!ready} kind="secondary" /></View>
              <View style={styles.confirmColumn}><CheckoutButton label={`Confirm Payment · ${quote?.totalAmountText ?? "—"}`} onPress={confirm} disabled={!canConfirm} kind="confirm" /></View>
            </View>
            {!validSignature && <Text style={styles.securityNote}>A new signature for the current total is required before confirmation.</Text>}
          </>}
          {state.status === "loading" && <ActivityIndicator color={C.blue} accessibilityLabel="Checking checkout status" />}
          {(state.message || statusText[state.status]) && <Text accessibilityRole={state.status === "error" || state.status === "blocked" ? "alert" : undefined} style={styles.status}>{state.message || statusText[state.status]}</Text>}
          <CheckoutButton label="Refresh status" onPress={() => { if (current()) props.onRefreshStatus(); }} disabled={false} kind="secondary" />
          <Text style={styles.securityNote}>Closing does not cancel an in-flight charge or mark the Job paid. Payment is verified only by refreshed Company payment records.</Text>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
  return props.presentation === "overlay" ? body : <Modal visible transparent animationType="slide" onRequestClose={close}>{body}</Modal>;
}

function SecureCardFieldSlot({ renderCardField, ...slot }: CompanyCheckoutCardFieldSlot & { renderCardField: NonNullable<CompanyNativeCheckoutFlowProps["renderCardField"]> }) {
  return <>{renderCardField(slot)}</>;
}
function CheckoutButton({ label, onPress, disabled, kind = "primary" }: { label: string; onPress: () => void; disabled: boolean; kind?: "primary" | "secondary" | "confirm" }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={4}
    style={[styles.button, kind === "secondary" ? styles.secondary : kind === "confirm" ? styles.confirm : styles.primary, disabled && styles.disabled]}>
    <Text style={styles.buttonText}>{label}</Text>
  </TouchableOpacity>;
}

function SummaryRow({ label, amount, total = false }: { label: string; amount: string; total?: boolean }) {
  return <View style={styles.summaryRow}><Text style={[styles.muted, total && styles.summaryTotal]}>{label}</Text><Text style={total ? styles.blueAmount : styles.summaryAmount}>{amount}</Text></View>;
}
const C = { background: "#101319", panel: "#131b26", border: "#2e333c", text: "#f8fafc", muted: "#a5a9b2", blue: "#0068ff", purple: "#a887f2", green: "#159a57" };
const styles = StyleSheet.create({
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.64)" },
  sheet: { width: "100%", backgroundColor: C.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 12, overflow: "hidden" },
  header: { paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  headerButton: { minWidth: 48, minHeight: 48, justifyContent: "center", alignItems: "center" },
  content: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 14, gap: 18 },
  title: { color: C.text, fontSize: 25, lineHeight: 32, fontWeight: "700", flexShrink: 1 },
  backText: { color: C.blue, fontSize: 17, lineHeight: 24 }, closeText: { color: C.muted, fontSize: 36, lineHeight: 40 },
  customer: { color: C.muted, fontSize: 16, lineHeight: 23 },
  balancePanel: { borderWidth: 1, borderColor: "#164baf", backgroundColor: "#101d33", borderRadius: 18, padding: 20, alignItems: "center", gap: 8 },
  balanceAmount: { color: C.blue, fontSize: 38, lineHeight: 48, fontWeight: "800" },
  muted: { color: C.muted, fontSize: 16, lineHeight: 23 },
  eyebrow: { color: C.muted, fontSize: 12, lineHeight: 18, fontWeight: "700", letterSpacing: 1.2, marginTop: 4 },
  method: { borderRadius: 17, borderWidth: 1, borderColor: C.border, padding: 16, minHeight: 76, flexDirection: "row", alignItems: "center", gap: 14 },
  tapMethod: { borderColor: "#604494", backgroundColor: "#231e36" },
  methodIcon: { color: C.muted, fontSize: 28 }, methodCopy: { flex: 1, gap: 4 },
  methodTitle: { color: C.text, fontSize: 18, lineHeight: 24, fontWeight: "700" },
  chevron: { color: C.muted, fontSize: 26 },
  panel: { borderWidth: 1, borderColor: C.border, backgroundColor: C.panel, borderRadius: 17, padding: 16, gap: 10 },
  fieldLabel: { color: C.muted, fontSize: 15, lineHeight: 22, fontWeight: "600" },
  hiddenCard: { display: "none" },
  button: { minHeight: 52, paddingVertical: 15, paddingHorizontal: 12, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  primary: { backgroundColor: C.blue }, secondary: { borderWidth: 1, borderColor: C.border }, confirm: { backgroundColor: C.green },
  buttonText: { color: C.text, fontSize: 16, lineHeight: 22, fontWeight: "700", textAlign: "center" }, disabled: { opacity: 0.45 },
  securityNote: { color: C.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  blueAmount: { color: C.blue, fontSize: 22, lineHeight: 29, fontWeight: "800" },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  summaryAmount: { color: C.text, fontSize: 16, lineHeight: 23, fontWeight: "600", flexShrink: 1 },
  summaryTotal: { color: C.text, fontSize: 17, lineHeight: 24, fontWeight: "700" }, divider: { height: 1, backgroundColor: C.border, marginVertical: 5 },
  tipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tipOption: { flex: 1, minWidth: 58, minHeight: 72, borderWidth: 1, borderColor: C.border, borderRadius: 15, paddingVertical: 14, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", gap: 4 },
  tipPercent: { color: C.text, fontSize: 19, lineHeight: 25, fontWeight: "700" }, tipAmount: { color: C.muted, fontSize: 12, lineHeight: 18 },
  tipOther: { flex: 1, minHeight: 52, borderWidth: 1, borderColor: C.border, borderRadius: 15, padding: 12, alignItems: "center", justifyContent: "center" },
  selected: { borderColor: C.text, borderWidth: 2 },
  customInput: { minHeight: 48, color: C.text, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 12, fontSize: 18, backgroundColor: C.background },
  instruction: { color: C.text, fontSize: 16, lineHeight: 23 },
  signaturePad: { height: 240, borderRadius: 17, overflow: "hidden", backgroundColor: "#fff", borderWidth: 1, borderColor: "#dce1e7" },
  padUnavailable: { padding: 20, color: "#334155", fontSize: 15, lineHeight: 22 },
  finalRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" }, clearColumn: { flex: 1, minWidth: 72 }, confirmColumn: { flex: 2.2, minWidth: 180 },
  status: { color: C.muted, fontSize: 14, lineHeight: 21 },
});
