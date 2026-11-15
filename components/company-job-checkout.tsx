import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useIsFocused } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import { getCompanyJobBillingState } from "@/lib/company-job-billing";
import { companyCheckoutScope, createCompanyJobCheckoutController, type CompanyCheckoutState } from "@/lib/company-job-checkout";
import type { JobSyncCompanyJobDetail, JobSyncNativeSession } from "@/lib/jobsync-mobile-api";

type Props = {
  visible: boolean;
  session: JobSyncNativeSession | null;
  jobId: number | null;
  customerName: string;
  /** Parent's captured Job/sheet/checkout epoch; never a role-derived permission. */
  isCurrent: () => boolean;
  onClose: () => void;
  onVerifiedDetail: (detail: JobSyncCompanyJobDetail) => void;
  presentation?: "modal" | "overlay";
};
const initial: CompanyCheckoutState = { phase: "loading", detail: null, checkout: null, message: null };

export function CompanyJobCheckout(props: Props) {
  const focused = useIsFocused();
  const scope = companyCheckoutScope(props.session, props.jobId);
  if (!props.visible || !focused || !scope || !props.session || !props.jobId) return null;
  return <ScopedCompanyJobCheckout key={scope} {...props} session={props.session} jobId={props.jobId} scope={scope} />;
}

function ScopedCompanyJobCheckout(props: Props & { session: JobSyncNativeSession; jobId: number; scope: string }) {
  const colors = useJobSheetColors();
  const focused = useIsFocused();
  const live = useRef(props);
  const focus = useRef(focused);
  const mounted = useRef(true);
  const [state, setState] = useState<CompanyCheckoutState>(initial);
  const controllerRef = useRef<ReturnType<typeof createCompanyJobCheckoutController> | null>(null);
  useLayoutEffect(() => { live.current = props; focus.current = focused; }, [props, focused]);
  useEffect(() => {
    mounted.current = true;
    const controller = createCompanyJobCheckoutController({
      session: props.session, jobId: props.jobId,
      isCurrent: () => mounted.current && focus.current && live.current.visible
        && companyCheckoutScope(live.current.session, live.current.jobId) === props.scope && live.current.isCurrent(),
      onState: setState,
      onVerifiedDetail: (detail) => live.current.onVerifiedDetail(detail),
      openBrowser: (url) => WebBrowser.openBrowserAsync(url),
    });
    controllerRef.current = controller;
    void controller.refresh();
    const subscription = AppState.addEventListener("change", (next) => {
      // Android browser launch may return immediately. Foregrounding still re-reads the canonical ledger.
      if (next === "active" && controller.hasCheckout()) void controller.refresh();
    });
    return () => { mounted.current = false; controller.dispose(); subscription.remove(); };
  }, [props.session, props.jobId, props.scope]);
  const billing = getCompanyJobBillingState(state.detail ?? {});
  const busy = state.phase === "loading" || state.phase === "opening";
  const canPay = (state.phase === "ready" || state.phase === "checkout") && billing.canCollect;
  const close = () => {
    if (mounted.current && focus.current && live.current.isCurrent()) live.current.onClose();
  };
  const body = <View style={styles.backdrop}>
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Collect Payment</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close payment collection" onPress={close} style={styles.close}>
          <Text style={[styles.closeText, { color: colors.muted }]}>✕</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.customer, { color: colors.foreground }]}>{props.customerName}</Text>
      <View style={[styles.balance, { backgroundColor: colors.background }]}>
        <Text style={[styles.label, { color: colors.muted }]}>Balance Due</Text>
        <Text style={[styles.amount, { color: billing.isPaid === true ? colors.success : colors.foreground }]}>
          {billing.balance === null ? "Loading current balance…" : `$${billing.balance.toFixed(2)}`}
        </Text>
      </View>
      {busy && <ActivityIndicator accessibilityLabel="Checking payment status" color={colors.primary} />}
      {state.message && <Text accessibilityRole={state.phase === "error" ? "alert" : undefined} style={[styles.note, { color: state.phase === "error" ? colors.error : colors.muted }]}>{state.message}</Text>}
      {state.phase !== "paid" && state.phase !== "blocked" && <Text style={[styles.note, { color: colors.muted }]}>Card details are entered securely in Stripe checkout. This app does not collect or store card numbers.</Text>}
      {state.phase !== "paid" && state.phase !== "blocked" && <TouchableOpacity
        accessibilityRole="button" accessibilityLabel={state.checkout ? "Continue secure card checkout" : "Open secure card checkout"}
        accessibilityState={{ disabled: !canPay }} disabled={!canPay}
        onPress={() => void controllerRef.current?.pay()}
        style={[styles.primary, { backgroundColor: colors.primary, opacity: canPay ? 1 : 0.45 }]}
      ><Text style={styles.primaryText}>{state.phase === "opening" ? "Opening checkout…" : state.phase === "processing" ? "Payment processing — refresh status" : state.checkout ? "Continue Secure Checkout" : "Pay by Card"}</Text></TouchableOpacity>}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh payment status" disabled={busy} onPress={() => void controllerRef.current?.refresh()}
        style={[styles.secondary, { borderColor: colors.border, opacity: busy ? 0.45 : 1 }]}>
        <Text style={[styles.secondaryText, { color: colors.foreground }]}>Refresh Payment Status</Text>
      </TouchableOpacity>
      <Text style={[styles.footnote, { color: colors.muted }]}>Payment is confirmed only after your Company&apos;s payment records update. Closing checkout does not mark the Job paid or finished.</Text>
    </View>
  </View>;
  return props.presentation === "overlay" ? body : <Modal visible transparent animationType="fade" onRequestClose={close}>{body}</Modal>;
}
const styles = StyleSheet.create({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", padding: 22 },
  card: { borderRadius: 18, borderWidth: 1, padding: 22, gap: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 21, lineHeight: 27, fontWeight: "700" },
  close: { padding: 6 }, closeText: { fontSize: 23, lineHeight: 27 },
  customer: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  balance: { borderRadius: 12, padding: 16, gap: 7 }, label: { fontSize: 13, lineHeight: 18 },
  amount: { fontSize: 24, lineHeight: 31, fontWeight: "800" }, note: { fontSize: 14, lineHeight: 20 },
  primary: { paddingVertical: 15, borderRadius: 12, alignItems: "center" }, primaryText: { color: "#fff", fontSize: 16, lineHeight: 22, fontWeight: "700" },
  secondary: { paddingVertical: 12, borderRadius: 12, borderWidth: 1, alignItems: "center" }, secondaryText: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  footnote: { fontSize: 12, lineHeight: 17 },
});
