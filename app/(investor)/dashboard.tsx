import React from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useInvestorAuth } from "@/lib/investor-auth";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { router } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; label: string }> = {
    active:                { bg: "#22C55E", label: "Active" },
    repayment_in_progress: { bg: "#3B82F6", label: "In Repayment" },
    paid_in_full:          { bg: "#10B981", label: "Paid in Full" },
    pending_funding:       { bg: "#F59E0B", label: "Pending Funding" },
    delayed:               { bg: "#EF4444", label: "Delayed" },
    document_pending:      { bg: "#8B5CF6", label: "Docs Pending" },
    closed:                { bg: "#6B7280", label: "Closed" },
  };
  const cfg = map[status] ?? { bg: "#6B7280", label: status };
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg + "25", borderColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.bg }]}>{cfg.label}</Text>
    </View>
  );
}

// ─── Stat tile ────────────────────────────────────────────────────────────────
function StatTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  const colors = useColors();
  return (
    <View style={[styles.statTile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.statValue, { color: color ?? colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
      {sub ? <Text style={[styles.statSub, { color: colors.muted }]}>{sub}</Text> : null}
    </View>
  );
}

// ─── Payment row ──────────────────────────────────────────────────────────────
function PaymentRow({ payment, index }: { payment: any; index: number }) {
  const colors = useColors();
  const isPaid = payment.status === "completed";
  const isScheduled = payment.status === "scheduled" || payment.status === "pending";
  const dotColor = isPaid ? "#22C55E" : isScheduled ? "#F59E0B" : colors.muted;
  return (
    <View style={[styles.payRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.payDot, { backgroundColor: dotColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.payLabel, { color: colors.foreground }]}>
          Payment {index + 1}
          {payment.adminNotes ? `  ·  ${payment.adminNotes}` : ""}
        </Text>
        {payment.dueDate ? (
          <Text style={[styles.payDate, { color: colors.muted }]}>
            Due {new Date(payment.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            {payment.paidDate ? `  ·  Paid ${new Date(payment.paidDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        {isPaid ? (
          <Text style={[styles.payAmt, { color: "#22C55E" }]}>
            +${parseFloat(payment.amountPaid ?? "0").toLocaleString()}
          </Text>
        ) : (
          <Text style={[styles.payAmt, { color: colors.muted }]}>
            ${parseFloat(payment.amountDue ?? "0").toLocaleString()}
          </Text>
        )}
        <Text style={[styles.payStatus, { color: dotColor }]}>
          {isPaid ? "Paid" : isScheduled ? "Upcoming" : payment.status}
        </Text>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function InvestorDashboardScreen() {
  const colors = useColors();
  const { investor, token, logout } = useInvestorAuth();

  const dashboard = trpc.investor.getDashboard.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  // Fetch payment details for first investment
  const firstInvestmentId = dashboard.data?.investments?.[0]?.investmentId;
  const paymentsQuery = trpc.investor.getPayments.useQuery(
    { token: token ?? "", investmentId: firstInvestmentId ?? "" },
    { enabled: !!token && !!firstInvestmentId }
  );

  if (!token || !investor) {
    router.replace("/investor-login" as any);
    return null;
  }

  const handleLogout = () => {
    Alert.alert("Sign Out", "Sign out of the Investor Portal?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: async () => {
        await logout();
        router.replace("/investor-login" as any);
      }},
    ]);
  };

  if (dashboard.isLoading) {
    return (
      <ScreenContainer edges={["top", "left", "right"]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#7C3AED" />
          <Text style={[styles.loadingText, { color: colors.muted }]}>Loading your portfolio…</Text>
        </View>
      </ScreenContainer>
    );
  }

  const data = dashboard.data;
  const inv = data?.investments?.[0];
  const payments = paymentsQuery.data ?? [];

  // Compute key metrics
  const investmentAmount = parseFloat(inv?.investmentAmount ?? "0");
  const totalRepayment = parseFloat(inv?.totalRepaymentAmount ?? inv?.investmentAmount ?? "0");
  const amountPaid = inv?.amountPaid ?? 0;
  const remaining = Math.max(totalRepayment - amountPaid, 0);
  const returnAmount = totalRepayment - investmentAmount;
  const returnPct = investmentAmount > 0 ? ((returnAmount / investmentAmount) * 100).toFixed(1) : "0";
  const progressPct = totalRepayment > 0 ? Math.min(amountPaid / totalRepayment, 1) : 0;
  const paymentsCompleted = payments.filter((p: any) => p.status === "completed").length;
  const totalPaymentsExpected = inv?.totalPaymentsExpected ?? payments.length;
  const nextPayment = payments.find((p: any) => p.status === "scheduled" || p.status === "pending");

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.greeting, { color: colors.muted }]}>Welcome back,</Text>
            <Text style={[styles.name, { color: colors.foreground }]}>
              {investor.firstName} {investor.lastName}
            </Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn} activeOpacity={0.7}>
            <MaterialIcons name="logout" size={18} color="#7C3AED" />
          </TouchableOpacity>
        </View>

        {!inv ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <MaterialIcons name="account-balance" size={40} color={colors.muted} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Active Investments</Text>
            <Text style={[styles.emptyBody, { color: colors.muted }]}>
              Contact your account manager to get started.
            </Text>
          </View>
        ) : (
          <>
            {/* ── Investment Hero Card ── */}
            <View style={[styles.heroCard, { backgroundColor: "#7C3AED" }]}>
              <View style={styles.heroTop}>
                <View>
                  <Text style={styles.heroLabel}>Total Investment</Text>
                  <Text style={styles.heroAmount}>${investmentAmount.toLocaleString()}</Text>
                </View>
                <StatusBadge status={inv.status ?? "active"} />
              </View>

              <Text style={styles.heroDate}>
                Invested {new Date(inv.investmentDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                {inv.loanTermMonths ? `  ·  ${inv.loanTermMonths}-month term` : ""}
              </Text>

              {/* Progress bar */}
              <View style={styles.progressSection}>
                <View style={styles.progressHeader}>
                  <Text style={styles.progressLabel}>Repayment Progress</Text>
                  <Text style={styles.progressPct}>{Math.round(progressPct * 100)}%</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progressPct * 100}%` }]} />
                </View>
                <View style={styles.progressAmounts}>
                  <Text style={styles.progressAmt}>${amountPaid.toLocaleString()} received</Text>
                  <Text style={styles.progressAmt}>${totalRepayment.toLocaleString()} total</Text>
                </View>
              </View>
            </View>

            {/* ── Key Metrics ── */}
            <View style={styles.statsGrid}>
              <StatTile
                label="Total Return"
                value={`$${totalRepayment.toLocaleString()}`}
                sub={`+${returnPct}% return`}
                color="#22C55E"
              />
              <StatTile
                label="Remaining"
                value={`$${remaining.toLocaleString()}`}
                sub="still owed"
              />
              <StatTile
                label="Payments"
                value={`${paymentsCompleted} / ${totalPaymentsExpected}`}
                sub="completed"
                color="#7C3AED"
              />
              <StatTile
                label="Amount Paid"
                value={`$${amountPaid.toLocaleString()}`}
                sub="received to date"
                color="#3B82F6"
              />
            </View>

            {/* ── Next Payment ── */}
            {nextPayment && (
              <View style={[styles.nextCard, { backgroundColor: colors.surface, borderColor: "#F59E0B40" }]}>
                <View style={styles.nextCardHeader}>
                  <MaterialIcons name="schedule" size={18} color="#F59E0B" />
                  <Text style={[styles.nextCardTitle, { color: colors.foreground }]}>Next Payment Due</Text>
                </View>
                <View style={styles.nextCardRow}>
                  <View>
                    <Text style={[styles.nextAmt, { color: colors.foreground }]}>
                      ${parseFloat(nextPayment.amountDue ?? "0").toLocaleString()}
                    </Text>
                    {nextPayment.dueDate ? (
                      <Text style={[styles.nextDate, { color: colors.muted }]}>
                        Due {new Date(nextPayment.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                      </Text>
                    ) : null}
                  </View>
                  <View style={[styles.nextBadge, { backgroundColor: "#F59E0B20", borderColor: "#F59E0B" }]}>
                    <Text style={[styles.nextBadgeText, { color: "#F59E0B" }]}>Upcoming</Text>
                  </View>
                </View>
              </View>
            )}

            {/* ── Investment Notes ── */}
            {inv.notes ? (
              <View style={[styles.notesCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.notesHeader}>
                  <MaterialIcons name="info-outline" size={16} color={colors.muted} />
                  <Text style={[styles.notesTitle, { color: colors.muted }]}>Investment Notes</Text>
                </View>
                <Text style={[styles.notesBody, { color: colors.foreground }]}>{inv.notes}</Text>
              </View>
            ) : null}

            {/* ── Payment History ── */}
            <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.sectionCardHeader}>
                <Text style={[styles.sectionCardTitle, { color: colors.foreground }]}>Payment History</Text>
                <Text style={[styles.sectionCardSub, { color: colors.muted }]}>
                  {paymentsCompleted} of {totalPaymentsExpected} payments
                </Text>
              </View>
              {paymentsQuery.isLoading ? (
                <ActivityIndicator size="small" color="#7C3AED" style={{ marginVertical: 16 }} />
              ) : payments.length === 0 ? (
                <Text style={[styles.emptySmall, { color: colors.muted }]}>No payments recorded yet.</Text>
              ) : (
                payments.map((p: any, i: number) => (
                  <PaymentRow key={p.paymentId} payment={p} index={i} />
                ))
              )}
            </View>

            {/* ── Quick Links ── */}
            <Text style={[styles.quickTitle, { color: colors.muted }]}>QUICK ACCESS</Text>
            <View style={styles.quickGrid}>
              {[
                { icon: "folder" as const, label: "Documents", route: "/(investor)/documents", color: "#2563EB" },
                { icon: "campaign" as const, label: "Updates", route: "/(investor)/updates", color: "#0891B2" },
                { icon: "support-agent" as const, label: "Support", route: "/(investor)/support", color: "#DC2626" },
              ].map((item) => (
                <TouchableOpacity
                  key={item.label}
                  style={[styles.quickCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  onPress={() => router.push({ pathname: item.route as any, params: { token } })}
                  activeOpacity={0.75}
                >
                  <View style={[styles.quickIcon, { backgroundColor: item.color + "20" }]}>
                    <MaterialIcons name={item.icon} size={22} color={item.color} />
                  </View>
                  <Text style={[styles.quickLabel, { color: colors.foreground }]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Recent Updates ── */}
            {!!data?.recentUpdates?.length && (
              <>
                <Text style={[styles.quickTitle, { color: colors.muted }]}>RECENT UPDATES</Text>
                {data.recentUpdates.slice(0, 3).map((u: any) => (
                  <TouchableOpacity
                    key={u.updateId}
                    style={[styles.updateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    onPress={() => router.push({ pathname: "/(investor)/updates" as any, params: { token } })}
                    activeOpacity={0.8}
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
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 48 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontSize: 14 },

  // Header
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  greeting: { fontSize: 13 },
  name: { fontSize: 22, fontWeight: "700" },
  logoutBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#7C3AED20", justifyContent: "center", alignItems: "center" },

  // Hero card
  heroCard: { borderRadius: 20, padding: 22, marginBottom: 16 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  heroLabel: { fontSize: 12, color: "rgba(255,255,255,0.7)", marginBottom: 4, fontWeight: "600", letterSpacing: 0.5 },
  heroAmount: { fontSize: 34, fontWeight: "900", color: "#FFFFFF" },
  heroDate: { fontSize: 13, color: "rgba(255,255,255,0.65)", marginBottom: 18 },
  progressSection: { gap: 6 },
  progressHeader: { flexDirection: "row", justifyContent: "space-between" },
  progressLabel: { fontSize: 12, color: "rgba(255,255,255,0.7)" },
  progressPct: { fontSize: 12, fontWeight: "700", color: "#FFFFFF" },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.25)", overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: "#FFFFFF" },
  progressAmounts: { flexDirection: "row", justifyContent: "space-between" },
  progressAmt: { fontSize: 12, color: "rgba(255,255,255,0.65)" },

  // Stats grid
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  statTile: { width: "47.5%", borderRadius: 14, borderWidth: 1, padding: 14 },
  statValue: { fontSize: 20, fontWeight: "800", marginBottom: 2 },
  statLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4 },
  statSub: { fontSize: 11, marginTop: 2 },

  // Next payment
  nextCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16 },
  nextCardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  nextCardTitle: { fontSize: 14, fontWeight: "700" },
  nextCardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  nextAmt: { fontSize: 22, fontWeight: "800" },
  nextDate: { fontSize: 13, marginTop: 2 },
  nextBadge: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 4 },
  nextBadgeText: { fontSize: 12, fontWeight: "700" },

  // Notes
  notesCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16 },
  notesHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  notesTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4 },
  notesBody: { fontSize: 14, lineHeight: 20 },

  // Section card (payment history)
  sectionCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16 },
  sectionCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  sectionCardTitle: { fontSize: 16, fontWeight: "700" },
  sectionCardSub: { fontSize: 12 },
  payRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 0.5 },
  payDot: { width: 10, height: 10, borderRadius: 5 },
  payLabel: { fontSize: 14, fontWeight: "600" },
  payDate: { fontSize: 12, marginTop: 2 },
  payAmt: { fontSize: 15, fontWeight: "700" },
  payStatus: { fontSize: 11, fontWeight: "600", marginTop: 2 },

  // Quick links
  quickTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 10 },
  quickGrid: { flexDirection: "row", gap: 10, marginBottom: 20 },
  quickCard: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 14, alignItems: "center", gap: 8 },
  quickIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  quickLabel: { fontSize: 13, fontWeight: "600" },

  // Updates
  updateCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 10 },
  updateTitle: { fontSize: 15, fontWeight: "700", marginBottom: 2 },
  updateDate: { fontSize: 12, marginBottom: 6 },
  updateBody: { fontSize: 13, lineHeight: 18 },

  // Empty
  emptyCard: { borderRadius: 16, borderWidth: 1, padding: 40, alignItems: "center", gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptyBody: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  emptySmall: { fontSize: 13, textAlign: "center", paddingVertical: 16 },

  // Badge
  badge: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: "700" },
});
