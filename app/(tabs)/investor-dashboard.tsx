import React from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useInvestorAuth } from "@/lib/investor-auth";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { router } from "expo-router";

function StatusBadge({ status }: { status: string }) {
  const colors = useColors();
  const map: Record<string, { bg: string; label: string }> = {
    active:               { bg: "#22C55E", label: "Active" },
    repayment_in_progress:{ bg: "#3B82F6", label: "Repayment" },
    paid_in_full:         { bg: "#10B981", label: "Paid in Full" },
    pending_funding:      { bg: "#F59E0B", label: "Pending" },
    delayed:              { bg: "#EF4444", label: "Delayed" },
    document_pending:     { bg: "#8B5CF6", label: "Docs Pending" },
    closed:               { bg: colors.muted, label: "Closed" },
  };
  const cfg = map[status] ?? { bg: colors.muted, label: status };
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg + "25", borderColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.bg }]}>{cfg.label}</Text>
    </View>
  );
}

function InvestmentCard({ inv, token }: { inv: any; token: string }) {
  const colors = useColors();
  const total = parseFloat(inv.totalRepaymentAmount ?? inv.investmentAmount ?? "0");
  const paid = inv.amountPaid ?? 0;
  const pct = total > 0 ? Math.min(paid / total, 1) : 0;

  return (
    <TouchableOpacity
      style={[styles.investCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => router.push({ pathname: "/(tabs)/investor-investment-detail" as any, params: { investmentId: inv.investmentId, token } })}
      activeOpacity={0.8}
    >
      <View style={styles.investCardHeader}>
        <Text style={[styles.investAmount, { color: colors.foreground }]}>
          ${parseFloat(inv.investmentAmount).toLocaleString()}
        </Text>
        <StatusBadge status={inv.status ?? "active"} />
      </View>
      <Text style={[styles.investDate, { color: colors.muted }]}>
        Invested {new Date(inv.investmentDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
      </Text>

      {/* Progress bar */}
      <View style={styles.progressRow}>
        <Text style={[styles.progressLabel, { color: colors.muted }]}>Repayment Progress</Text>
        <Text style={[styles.progressPct, { color: colors.primary }]}>{Math.round(pct * 100)}%</Text>
      </View>
      <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
        <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${pct * 100}%` }]} />
      </View>
      <View style={styles.progressAmounts}>
        <Text style={[styles.progressAmt, { color: colors.muted }]}>${paid.toLocaleString()} paid</Text>
        <Text style={[styles.progressAmt, { color: colors.muted }]}>${total.toLocaleString()} total</Text>
      </View>

      {inv.nextPayment && (
        <View style={[styles.nextPayment, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "40" }]}>
          <Text style={[styles.nextPaymentLabel, { color: colors.primary }]}>
            Next Payment: ${parseFloat(inv.nextPayment.amountDue).toLocaleString()}
            {inv.nextPayment.dueDate ? ` · Due ${new Date(inv.nextPayment.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
          </Text>
        </View>
      )}

      <Text style={[styles.viewDetails, { color: colors.primary }]}>View Details →</Text>
    </TouchableOpacity>
  );
}

export default function InvestorDashboardScreen() {
  const colors = useColors();
  const { investor, token, logout } = useInvestorAuth();

  const dashboard = trpc.investor.getDashboard.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  if (!token || !investor) {
    router.replace("/(tabs)/investor-login" as any);
    return null;
  }

  if (dashboard.isLoading) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </ScreenContainer>
    );
  }

  const data = dashboard.data;

  return (
    <ScreenContainer edges={["left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.greeting, { color: colors.muted }]}>Welcome back,</Text>
            <Text style={[styles.name, { color: colors.foreground }]}>
              {investor.firstName} {investor.lastName}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.logoutBtn, { borderColor: colors.border }]}
            onPress={logout}
          >
            <Text style={[styles.logoutText, { color: colors.muted }]}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* Quick nav */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.navRow}>
          {[
            { label: "💳 Payments", route: "/(tabs)/investor-payments" },
            { label: "📄 Documents", route: "/(tabs)/investor-documents" },
            { label: "📢 Updates", route: "/(tabs)/investor-updates" },
            { label: "🆘 Support", route: "/(tabs)/investor-support" },
          ].map((item) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.navChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => router.push({ pathname: item.route as any, params: { token } })}
            >
              <Text style={[styles.navChipText, { color: colors.foreground }]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Investments */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Your Investments</Text>
        {!data?.investments?.length ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>No active investments found.</Text>
          </View>
        ) : (
          data.investments.map((inv: any) => (
            <InvestmentCard key={inv.investmentId} inv={inv} token={token} />
          ))
        )}

        {/* Recent Updates */}
        {!!data?.recentUpdates?.length && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Updates</Text>
            {data.recentUpdates.map((u: any) => (
              <TouchableOpacity
                key={u.updateId}
                style={[styles.updateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => router.push({ pathname: "/(tabs)/investor-updates" as any, params: { token } })}
              >
                <Text style={[styles.updateTitle, { color: colors.foreground }]}>{u.title}</Text>
                <Text style={[styles.updateDate, { color: colors.muted }]}>
                  {new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </Text>
                <Text style={[styles.updateBody, { color: colors.muted }]} numberOfLines={2}>{u.body}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  greeting: { fontSize: 13 },
  name: { fontSize: 22, fontWeight: "700" },
  logoutBtn: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  logoutText: { fontSize: 13 },
  navRow: { marginBottom: 24 },
  navChip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 8, marginRight: 10 },
  navChipText: { fontSize: 14, fontWeight: "500" },
  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  investCard: { borderRadius: 16, borderWidth: 1, padding: 18, marginBottom: 16 },
  investCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  investAmount: { fontSize: 22, fontWeight: "800" },
  badge: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  investDate: { fontSize: 13, marginBottom: 14 },
  progressRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  progressLabel: { fontSize: 12 },
  progressPct: { fontSize: 12, fontWeight: "700" },
  progressTrack: { height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 4 },
  progressFill: { height: 8, borderRadius: 4 },
  progressAmounts: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  progressAmt: { fontSize: 12 },
  nextPayment: { borderRadius: 8, borderWidth: 1, padding: 10, marginBottom: 10 },
  nextPaymentLabel: { fontSize: 13, fontWeight: "600" },
  viewDetails: { fontSize: 13, fontWeight: "600", textAlign: "right" },
  emptyCard: { borderRadius: 12, borderWidth: 1, padding: 20, alignItems: "center" },
  emptyText: { fontSize: 14 },
  updateCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  updateTitle: { fontSize: 15, fontWeight: "700", marginBottom: 2 },
  updateDate: { fontSize: 12, marginBottom: 6 },
  updateBody: { fontSize: 13, lineHeight: 18 },
});
