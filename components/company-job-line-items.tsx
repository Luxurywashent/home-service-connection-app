import { StyleSheet, Text, View } from "react-native";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import { getCompanyJobBillingState, normalizeCompanyJobBillingAmount } from "@/lib/company-job-billing";

type Props = { amount: number; balance?: number | null; paymentStatus?: string | null; paidTotal?: number | null; refundTotal?: number | null; appliedEstimateCredit?: number | null };

/** Original job-sheet presentation, using canonical dollars rather than legacy payment records. */
export function CompanyJobLineItems(props: Props) {
  const colors = useJobSheetColors();
  const billing = getCompanyJobBillingState(props);
  const amount = normalizeCompanyJobBillingAmount(props.amount);
  const money = (value: number | null) => value === null ? "Unavailable" : `$${value.toFixed(2)}`;
  const extras = [
    { label: "Payments", amount: normalizeCompanyJobBillingAmount(props.paidTotal) },
    { label: "Estimate Credit", amount: normalizeCompanyJobBillingAmount(props.appliedEstimateCredit) },
    { label: "Refunds", amount: normalizeCompanyJobBillingAmount(props.refundTotal) },
  ];
  return <View style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
    <Text style={[styles.title, { color: colors.foreground }]}>💳  Line Items</Text>
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.foreground }]}>Service Total</Text>
      <Text style={[styles.label, { color: colors.foreground }]}>{money(amount)}</Text>
    </View>
    {extras.filter((extra) => extra.amount !== null && extra.amount > 0).map((extra) => <View key={extra.label} style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.muted }]}>{extra.label}</Text>
      <Text style={[styles.label, { color: colors.foreground }]}>{money(extra.amount)}</Text>
    </View>)}
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
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 14 },
  total: { fontSize: 17, fontWeight: "800" },
  balance: { flexDirection: "row", justifyContent: "space-between", borderRadius: 8, padding: 12, marginTop: 10 },
  balanceLabel: { fontSize: 15, fontWeight: "700" },
});
