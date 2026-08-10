import React from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { router } from "expo-router";

const STATUS_COLORS: Record<string, string> = {
  scheduled: "#F59E0B",
  paid: "#22C55E",
  missed: "#EF4444",
  partial: "#F97316",
};

export default function AdminPaymentsScreen() {
  const colors = useColors();
  // Reuse adminListInvestments which includes payment data per investment
  const investments = trpc.investor.adminListInvestments.useQuery();

  const fmt = (v: string | number | null | undefined) => {
    if (v == null) return "—";
    const n = typeof v === "string" ? parseFloat(v) : v;
    return isNaN(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Flatten all payments from all investments
  const allPayments: any[] = [];
  (investments.data ?? []).forEach((inv: any) => {
    (inv.payments ?? []).forEach((p: any) => {
      allPayments.push({ ...p, investorName: `${inv.firstName} ${inv.lastName}`, investmentAmount: inv.investmentAmount });
    });
  });

  // Sort by payment date descending
  allPayments.sort((a, b) => new Date(b.paymentDate ?? b.createdAt).getTime() - new Date(a.paymentDate ?? a.createdAt).getTime());

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.replace("/(investor)/admin-home" as any)} style={styles.back}>
          <Text style={[styles.backText, { color: colors.primary }]}>← Dashboard</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>💵 Payments</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>All recorded payments</Text>

        {investments.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : !allPayments.length ? (
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>No payments recorded yet.</Text>
            <Text style={[styles.emptyHint, { color: colors.muted }]}>Record payments from the Investor Detail screen.</Text>
          </View>
        ) : (
          allPayments.map((p: any, idx: number) => {
            const sc = STATUS_COLORS[p.status] ?? colors.muted;
            return (
              <View key={p.paymentId ?? idx} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <Text style={[styles.investorName, { color: colors.foreground }]}>{p.investorName}</Text>
                  <View style={[styles.badge, { backgroundColor: sc + "20", borderColor: sc }]}>
                    <Text style={[styles.badgeText, { color: sc }]}>{p.status}</Text>
                  </View>
                </View>
                <View style={styles.row}>
                  <Text style={[styles.label, { color: colors.muted }]}>Amount Paid</Text>
                  <Text style={[styles.value, { color: "#22C55E" }]}>{fmt(p.amountPaid)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={[styles.label, { color: colors.muted }]}>Payment Date</Text>
                  <Text style={[styles.value, { color: colors.muted }]}>
                    {p.paymentDate ? new Date(p.paymentDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                  </Text>
                </View>
                {p.notes ? (
                  <Text style={[styles.notes, { color: colors.muted }]} numberOfLines={2}>{p.notes}</Text>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  back: { marginBottom: 12, alignSelf: "flex-start" },
  backText: { fontSize: 15, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2, marginBottom: 20 },
  empty: { borderRadius: 12, borderWidth: 1, padding: 24, alignItems: "center", gap: 6 },
  emptyText: { fontSize: 14, fontWeight: "600" },
  emptyHint: { fontSize: 12 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  investorName: { fontSize: 15, fontWeight: "700", flex: 1, marginRight: 8 },
  badge: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  label: { fontSize: 13 },
  value: { fontSize: 13, fontWeight: "600" },
  notes: { fontSize: 12, marginTop: 8, lineHeight: 17 },
});
