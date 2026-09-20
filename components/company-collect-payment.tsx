import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as WebBrowser from "expo-web-browser";

import { useColors } from "@/hooks/use-colors";
import { type CompanyJobAuthorityMode } from "@/lib/jobsync-company-authority";
import {
  COMPANY_PAYMENT_REFRESH_FAILED,
  canonicalJobArSnapshot,
  manualPaymentRequestFingerprint,
  nextManualPaymentIdempotencyKey,
  nextManualPaymentRefreshState,
  resolveCompanyPaymentActions,
  resolveHostedCheckoutOpenUrl,
  shouldMarkJobPaidFromCheckoutBrowserReturn,
} from "@/lib/jobsync-company-payment";
import {
  createJobSyncCompanyJobCheckout,
  getJobSyncCompanyJob,
  getJobSyncCompanyJobPayments,
  recordJobSyncCompanyJobPayment,
  type JobSyncCompanyJobPayment,
  type JobSyncCompanyRole,
  type JobSyncManualPaymentMethod,
  type JobSyncMobileJob,
} from "@/lib/jobsync-mobile-api";

const METHOD_OPTIONS: { id: JobSyncManualPaymentMethod; label: string; detail: string }[] = [
  { id: "cash", label: "Cash", detail: "Record cash collected" },
  { id: "card", label: "Card — collected externally", detail: "Record a card payment already collected outside this app. This does not charge a card through Stripe." },
  { id: "other", label: "Other", detail: "Check, transfer, or another supported external method" },
];

function money(value: number | null | undefined) {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

function statusLabel(status: string | null | undefined) {
  if (status === "paid") return "Paid";
  if (status === "partial") return "Partial";
  if (status === "refunded") return "Refunded";
  return "Unpaid";
}

async function openHostedCheckoutUrl(url: string) {
  const safeUrl = resolveHostedCheckoutOpenUrl(url);
  if (Platform.OS === "web") {
    await Linking.openURL(safeUrl);
    return;
  }
  await WebBrowser.openBrowserAsync(safeUrl);
}

export function CompanyCollectPayment({
  token,
  jobId,
  role,
  authority = "company",
  amount,
  paidTotal,
  balance,
  paymentStatus,
  jobStatus,
  onCanonicalRefresh,
}: {
  token: string;
  jobId: number;
  role: JobSyncCompanyRole | string;
  authority?: CompanyJobAuthorityMode;
  amount?: number;
  paidTotal?: number;
  balance?: number;
  paymentStatus?: string;
  jobStatus?: string;
  onCanonicalRefresh?: () => Promise<void> | void;
}) {
  const colors = useColors();
  const [job, setJob] = useState<JobSyncMobileJob | null>(null);
  const [payments, setPayments] = useState<JobSyncCompanyJobPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<JobSyncManualPaymentMethod>("cash");
  const [amountText, setAmountText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const requestFingerprintRef = useRef<string | null>(null);
  const paymentAcceptedRef = useRef(false);
  const submittingRef = useRef(false);
  const lastJobIdRef = useRef(jobId);

  const mounted = authority === "company";

  const displayAmount = job?.amount ?? amount ?? 0;
  const displayPaid = job?.paidTotal ?? paidTotal ?? 0;
  const displayRefund = job?.refundTotal ?? 0;
  const displayCredit = job?.appliedEstimateCredit ?? 0;
  const displayBalance = job?.balance ?? balance ?? 0;
  const displayStatus = job?.paymentStatus ?? paymentStatus ?? "unpaid";
  const displayJobStatus = job?.status ?? jobStatus ?? "";

  const actions = resolveCompanyPaymentActions({
    mode: authority,
    role,
    jobStatus: displayJobStatus,
    balance: displayBalance,
  });

  const loadCanonical = useCallback(async () => {
    const [nextJob, nextPayments] = await Promise.all([
      getJobSyncCompanyJob(token, jobId),
      getJobSyncCompanyJobPayments(token, jobId),
    ]);
    setJob(nextJob);
    setPayments(nextPayments);
    setAmountText((current) => current.trim() ? current : (nextJob.balance > 0 ? nextJob.balance.toFixed(2) : ""));
    setError(null);
    return nextJob;
  }, [jobId, token]);

  useEffect(() => {
    if (lastJobIdRef.current === jobId) return;
    lastJobIdRef.current = jobId;
    idempotencyKeyRef.current = null;
    requestFingerprintRef.current = null;
    paymentAcceptedRef.current = false;
    setNotice(null);
    setMethod("cash");
    setAmountText("");
  }, [jobId]);

  useEffect(() => {
    if (!mounted) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadCanonical()
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load Job payment state.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [loadCanonical, mounted]);

  const refreshAfterWrite = useCallback(async () => {
    try {
      await loadCanonical();
      await onCanonicalRefresh?.();
      return true;
    } catch {
      return false;
    }
  }, [loadCanonical, onCanonicalRefresh]);

  const recordPayment = useCallback(async () => {
    if (submittingRef.current || submitting || !actions.canRecordManual) return;
    const amountValue = Number(amountText);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setNotice("Enter a payment greater than $0.00.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setNotice(null);
    const fingerprint = manualPaymentRequestFingerprint({ jobId, amount: amountValue, method });
    idempotencyKeyRef.current = nextManualPaymentIdempotencyKey({
      existingKey: idempotencyKeyRef.current,
      jobId,
      previousJobId: lastJobIdRef.current,
      fingerprint,
      previousFingerprint: requestFingerprintRef.current,
      paymentAccepted: paymentAcceptedRef.current,
    });
    requestFingerprintRef.current = fingerprint;
    lastJobIdRef.current = jobId;
    try {
      await recordJobSyncCompanyJobPayment(token, jobId, {
        amount: amountValue,
        method,
        idempotencyKey: idempotencyKeyRef.current,
      });
      paymentAcceptedRef.current = true;
      const refreshed = await refreshAfterWrite();
      const state = nextManualPaymentRefreshState({ paymentAccepted: true, refreshSucceeded: refreshed });
      if (state === "recorded-refresh-failed") setNotice(COMPANY_PAYMENT_REFRESH_FAILED);
      else setNotice("Payment recorded.");
      if (refreshed) {
        idempotencyKeyRef.current = null;
        requestFingerprintRef.current = null;
        paymentAcceptedRef.current = false;
      }
    } catch (recordError) {
      setNotice(recordError instanceof Error ? recordError.message : "Payment could not be recorded.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [actions.canRecordManual, amountText, jobId, method, refreshAfterWrite, submitting, token]);

  const openCheckout = useCallback(async () => {
    if (checkoutBusy || !actions.canOpenCheckout) return;
    setCheckoutBusy(true);
    setNotice(null);
    const statusBeforeReturn = job ? canonicalJobArSnapshot(job).paymentStatus : displayStatus;
    try {
      const checkout = await createJobSyncCompanyJobCheckout(token, jobId);
      if (!checkout.url) {
        setNotice("A secure Checkout link is not available for this Job.");
        return;
      }
      await openHostedCheckoutUrl(checkout.url);
      if (shouldMarkJobPaidFromCheckoutBrowserReturn()) {
        throw new Error("Checkout return cannot mark a Job paid.");
      }
      const refreshed = await refreshAfterWrite();
      if (!refreshed) {
        setNotice("Checkout opened. Unable to refresh current balance.");
        if (job) setJob({ ...job, paymentStatus: statusBeforeReturn });
      }
    } catch (checkoutError) {
      setNotice(checkoutError instanceof Error ? checkoutError.message : "Secure Checkout is unavailable.");
    } finally {
      setCheckoutBusy(false);
    }
  }, [actions.canOpenCheckout, checkoutBusy, displayStatus, job, jobId, refreshAfterWrite, token]);

  const history = useMemo(() => payments.slice(0, 12), [payments]);

  if (authority === "unknown" || !mounted) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>Job payment</Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : error ? (
        <Text style={[styles.helper, { color: colors.muted }]}>{error}</Text>
      ) : (
        <>
          <View style={styles.row}><Text style={[styles.label, { color: colors.muted }]}>Total</Text><Text style={[styles.value, { color: colors.foreground }]}>{money(displayAmount)}</Text></View>
          <View style={styles.row}><Text style={[styles.label, { color: colors.muted }]}>Paid</Text><Text style={[styles.value, { color: colors.foreground }]}>{money(displayPaid)}</Text></View>
          {displayRefund > 0 ? (
            <View style={styles.row}><Text style={[styles.label, { color: colors.muted }]}>Refunded</Text><Text style={[styles.value, { color: colors.foreground }]}>{money(displayRefund)}</Text></View>
          ) : null}
          {displayCredit > 0 ? (
            <View style={styles.row}><Text style={[styles.label, { color: colors.muted }]}>Estimate credit</Text><Text style={[styles.value, { color: colors.foreground }]}>{money(displayCredit)}</Text></View>
          ) : null}
          <View style={styles.row}><Text style={[styles.label, { color: colors.muted }]}>Balance</Text><Text style={[styles.value, { color: colors.foreground }]}>{money(displayBalance)}</Text></View>
          <View style={styles.row}><Text style={[styles.label, { color: colors.muted }]}>Status</Text><Text style={[styles.value, { color: colors.foreground }]}>{statusLabel(displayStatus)}</Text></View>

          {history.length > 0 ? (
            <View style={styles.history}>
              <Text style={[styles.section, { color: colors.muted }]}>Payment history</Text>
              {history.map((payment) => (
                <View key={payment.id} style={styles.row}>
                  <Text style={[styles.helper, { color: colors.muted }]}>
                    {payment.method || "payment"} · {payment.status}
                  </Text>
                  <Text style={[styles.helper, { color: colors.foreground }]}>{money(payment.amount)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.helper, { color: colors.muted, marginTop: 8 }]}>No canonical payments recorded yet.</Text>
          )}

          {actions.canWrite && displayBalance > 0 ? (
            <View style={styles.actions}>
              {actions.canRecordManual ? (
                <>
                  <Text style={[styles.section, { color: colors.muted }]}>Record payment</Text>
                  <View style={styles.methods}>
                    {METHOD_OPTIONS.map((option) => (
                      <TouchableOpacity
                        key={option.id}
                        onPress={() => setMethod(option.id)}
                        style={[styles.method, { borderColor: method === option.id ? colors.primary : colors.border, backgroundColor: method === option.id ? `${colors.primary}18` : colors.background }]}
                      >
                        <Text style={{ color: method === option.id ? colors.primary : colors.foreground, fontWeight: "700", fontSize: 13 }}>{option.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={[styles.helper, { color: colors.muted }]}>{METHOD_OPTIONS.find((option) => option.id === method)?.detail}</Text>
                  <TextInput
                    value={amountText}
                    onChangeText={setAmountText}
                    keyboardType="decimal-pad"
                    placeholder={money(displayBalance)}
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                  />
                  <TouchableOpacity
                    onPress={() => void recordPayment()}
                    disabled={submitting}
                    style={[styles.button, { backgroundColor: "#16a34a", opacity: submitting ? 0.6 : 1 }]}
                  >
                    {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Record payment</Text>}
                  </TouchableOpacity>
                </>
              ) : actions.manualRequiresCompleted ? (
                <Text style={[styles.helper, { color: colors.muted }]}>Complete the Job before recording a cash, card, or other payment.</Text>
              ) : null}

              {actions.canOpenCheckout ? (
                <TouchableOpacity
                  onPress={() => void openCheckout()}
                  disabled={checkoutBusy}
                  style={[styles.button, { backgroundColor: "#0a7ea4", opacity: checkoutBusy ? 0.6 : 1 }]}
                >
                  {checkoutBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Open secure Checkout</Text>}
                </TouchableOpacity>
              ) : null}
            </View>
          ) : actions.canWrite ? (
            <Text style={[styles.helper, { color: colors.muted, marginTop: 8 }]}>This Job has no remaining balance.</Text>
          ) : (
            <Text style={[styles.helper, { color: colors.muted, marginTop: 8 }]}>Only owners and dispatchers can collect payment.</Text>
          )}

          <Text style={[styles.helper, { color: colors.muted, marginTop: 10 }]}>
            Saved cards, Apple Pay, Tap to Pay, refunds, and local Luxury Wash payments stay disabled.
          </Text>
          {notice ? <Text style={[styles.notice, { color: notice === COMPANY_PAYMENT_REFRESH_FAILED ? "#B45309" : colors.foreground }]}>{notice}</Text> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  title: { fontSize: 16, fontWeight: "800", marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3 },
  label: { fontSize: 13 },
  value: { fontSize: 14, fontWeight: "700" },
  section: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 10, marginBottom: 4 },
  helper: { fontSize: 12, lineHeight: 16 },
  history: { marginTop: 4 },
  actions: { marginTop: 8, gap: 8 },
  methods: { flexDirection: "row", gap: 8 },
  method: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  button: { borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  notice: { fontSize: 13, fontWeight: "600", marginTop: 8 },
});
