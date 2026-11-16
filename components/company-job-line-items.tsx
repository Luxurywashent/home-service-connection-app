import { StyleSheet, Text, View } from "react-native";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import { getCompanyJobBillingState, normalizeCompanyJobBillingAmount } from "@/lib/company-job-billing";
import type { JobSyncCompanyJobPricing } from "@/lib/jobsync-mobile-api";

type Props = {
  amount: number; balance?: number | null; paymentStatus?: string | null; paidTotal?: number | null;
  refundTotal?: number | null; appliedEstimateCredit?: number | null;
  /** Only the currently scoped Company Job detail may supply persisted pricing. */
  pricing?: JobSyncCompanyJobPricing | null;
  pricingLoading?: boolean;
  pricingError?: string | null;
};

/** Existing job-sheet presentation: every financial value is server-derived. */
export function CompanyJobLineItems(props: Props) {
  const colors = useJobSheetColors();
  const billing = getCompanyJobBillingState(props);
  const pricing = !props.pricingLoading && !props.pricingError ? props.pricing : null;
  const amount = normalizeCompanyJobBillingAmount(pricing?.totalAmount ?? props.amount);
  const money = (value: number | null) => value === null ? "Unavailable" : `$${value.toFixed(2)}`;
  const extras = [
    { label: "Payments", amount: normalizeCompanyJobBillingAmount(props.paidTotal) },
    { label: "Estimate Credit", amount: normalizeCompanyJobBillingAmount(props.appliedEstimateCredit) },
    { label: "Refunds", amount: normalizeCompanyJobBillingAmount(props.refundTotal) },
  ];
  const row = (label: string, value: number | null, key = label) => <View key={key} style={[styles.row, { borderBottomColor: colors.border }]}>
    <Text style={[styles.label, styles.copy, { color: colors.muted }]}>{label}</Text>
    <Text style={[styles.label, { color: colors.foreground }]}>{money(value)}</Text>
  </View>;
  return <View style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
    <Text style={[styles.title, { color: colors.foreground }]}>💳  Line Items</Text>
    {props.pricingLoading && <Text accessibilityLabel="Loading persisted Job pricing" style={[styles.note, { color: colors.muted }]}>Loading saved service details…</Text>}
    {props.pricingError && <Text accessibilityRole="alert" style={[styles.note, { color: colors.error }]}>{props.pricingError}</Text>}
    {pricing ? <>
      {pricing.lineItems.map((line) => <View key={line.id} testID={`company-persisted-service-${line.id}`} style={[styles.row, { borderBottomColor: colors.border }]}>
        <View style={styles.copy}>
          <Text style={[styles.label, { color: colors.foreground }]}>{line.name}</Text>
          <Text style={[styles.note, { color: colors.muted }]}>Quantity {line.quantity} · Unit price {money(line.unitPrice)}</Text>
        </View>
        <Text style={[styles.label, { color: colors.foreground }]}>{money(line.lineTotal)}</Text>
      </View>)}
      {row("Subtotal", pricing.subtotalAmount)}
      {row(`Discount${pricing.discountKind === "percent" ? " (percentage)" : pricing.discountKind === "flat" ? " (flat)" : ""}${pricing.discountCode ? ` · ${pricing.discountCode}` : ""}`, pricing.discountAmount)}
      {row("Tax", pricing.taxAmount)}
    </> : <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.foreground }]}>Service Total</Text>
      <Text style={[styles.label, { color: colors.foreground }]}>{money(amount)}</Text>
    </View>}
    {extras.filter((extra) => extra.amount !== null && extra.amount > 0).map((extra) => row(extra.label, extra.amount))}
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[styles.total, { color: colors.foreground }]}>Job Total</Text>
      <Text style={[styles.total, { color: colors.primary }]}>{money(amount)}</Text>
    </View>
    <View style={[styles.balance, { backgroundColor: colors.surface }]}>
      <Text style={[styles.balanceLabel, { color: colors.foreground }]}>{billing.isPaid === true ? "Paid in Full" : "Balance Due"}</Text>
      <Text style={[styles.balanceLabel, { color: billing.isPaid === true ? colors.success : colors.primary }]}>{money(billing.balance)}</Text>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  card: { borderTopWidth: 1, borderBottomWidth: 1, paddingHorizontal: 20, paddingVertical: 18, marginBottom: 8 },
  title: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  copy: { flex: 1, minWidth: 0, gap: 3 }, label: { fontSize: 14 }, note: { fontSize: 12, lineHeight: 17 },
  total: { fontSize: 17, fontWeight: "800" },
  balance: { flexDirection: "row", justifyContent: "space-between", borderRadius: 8, padding: 12, marginTop: 10 },
  balanceLabel: { fontSize: 15, fontWeight: "700" },
});
