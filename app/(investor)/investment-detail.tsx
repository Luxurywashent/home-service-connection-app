import React from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { router, useLocalSearchParams } from "expo-router";

function PaymentRow({ p }: { p: any }) {
  const colors = useColors();
  const statusColors: Record<string, string> = {
    completed: "#22C55E", scheduled: "#3B82F6", pending: "#F59E0B",
    missed: "#EF4444", delayed: "#F97316",
  };
  const sc = statusColors[p.status] ?? colors.muted;
  return (
    <View style={[styles.payRow, { borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.payAmount, { color: colors.foreground }]}>
          ${parseFloat(p.amountDue).toLocaleString()}
          {p.amountPaid && p.amountPaid !== p.amountDue
            ? ` (paid $${parseFloat(p.amountPaid).toLocaleString()})`
            : ""}
        </Text>
        <Text style={[styles.payDate, { color: colors.muted }]}>
          {p.dueDate ? `Due ${new Date(p.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
          {p.paidDate ? ` · Paid ${new Date(p.paidDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
        </Text>
        {p.paymentMethod ? <Text style={[styles.payMethod, { color: colors.muted }]}>{p.paymentMethod}</Text> : null}
      </View>
      <View style={[styles.payBadge, { backgroundColor: sc + "20", borderColor: sc }]}>
        <Text style={[styles.payBadgeText, { color: sc }]}>{p.status}</Text>
      </View>
    </View>
  );
}

export default function InvestorInvestmentDetailScreen() {
  const colors = useColors();
  const { investmentId, token } = useLocalSearchParams<{ investmentId: string; token: string }>();

  const payments = trpc.investor.getPayments.useQuery(
    { token: token ?? "", investmentId: investmentId ?? "" },
    { enabled: !!token && !!investmentId }
  );

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.replace("/(investor)/dashboard" as any)} style={styles.back}>
          <Text style={[styles.backText, { color: colors.primary }]}>← Back</Text>
        </TouchableOpacity>

        <Text style={[styles.title, { color: colors.foreground }]}>Payment History</Text>

        {payments.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : !payments.data?.length ? (
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>No payments recorded yet.</Text>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {payments.data.map((p: any) => <PaymentRow key={p.paymentId} p={p} />)}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  back: { marginBottom: 16 },
  backText: { fontSize: 15, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 20 },
  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  empty: { borderRadius: 12, borderWidth: 1, padding: 24, alignItems: "center" },
  emptyText: { fontSize: 14 },
  payRow: { padding: 16, borderBottomWidth: 0.5, flexDirection: "row", alignItems: "center" },
  payAmount: { fontSize: 16, fontWeight: "600", marginBottom: 2 },
  payDate: { fontSize: 12, marginBottom: 2 },
  payMethod: { fontSize: 12 },
  payBadge: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  payBadgeText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
});
