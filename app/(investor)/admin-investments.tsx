import React, { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { router } from "expo-router";

const STATUS_COLORS: Record<string, string> = {
  pending_funding: "#F59E0B",
  active: "#3B82F6",
  repayment_in_progress: "#8B5CF6",
  paid_in_full: "#22C55E",
  delayed: "#EF4444",
  document_pending: "#F97316",
  closed: "#6B7280",
};

export default function AdminInvestmentsScreen() {
  const colors = useColors();
  const investments = trpc.investor.adminListInvestments.useQuery();

  const fmt = (v: string | number | null | undefined) => {
    if (v == null) return "—";
    const n = typeof v === "string" ? parseFloat(v) : v;
    return isNaN(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.replace("/(investor)/admin-home" as any)} style={styles.back}>
          <Text style={[styles.backText, { color: colors.primary }]}>← Dashboard</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>📈 Investments</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>All investor investments</Text>

        {investments.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : !investments.data?.length ? (
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>No investments recorded yet.</Text>
          </View>
        ) : (
          investments.data.map((inv: any) => {
            const sc = STATUS_COLORS[inv.status] ?? colors.muted;
            return (
              <View key={inv.investmentId} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <Text style={[styles.investorName, { color: colors.foreground }]}>
                    {inv.firstName} {inv.lastName}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: sc + "20", borderColor: sc }]}>
                    <Text style={[styles.badgeText, { color: sc }]}>{inv.status?.replace(/_/g, " ")}</Text>
                  </View>
                </View>
                <View style={styles.row}>
                  <Text style={[styles.label, { color: colors.muted }]}>Amount</Text>
                  <Text style={[styles.value, { color: colors.foreground }]}>{fmt(inv.investmentAmount)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={[styles.label, { color: colors.muted }]}>Total Repayment</Text>
                  <Text style={[styles.value, { color: colors.foreground }]}>{fmt(inv.totalRepaymentAmount ?? inv.agreedReturnAmount)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={[styles.label, { color: colors.muted }]}>Date</Text>
                  <Text style={[styles.value, { color: colors.muted }]}>
                    {inv.investmentDate ? new Date(inv.investmentDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                  </Text>
                </View>
                {inv.notes ? (
                  <Text style={[styles.notes, { color: colors.muted }]} numberOfLines={2}>{inv.notes}</Text>
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
  empty: { borderRadius: 12, borderWidth: 1, padding: 24, alignItems: "center" },
  emptyText: { fontSize: 14 },
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
