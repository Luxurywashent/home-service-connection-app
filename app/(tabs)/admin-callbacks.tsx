import { useState, useMemo } from "react";
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Modal, ScrollView, Alert, TextInput, Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

type CallbackStatus = "scheduled" | "completed" | "missed" | "cancelled" | "rescheduled";

const STATUS_CONFIG: Record<CallbackStatus, { label: string; color: string; bg: string }> = {
  scheduled:   { label: "Scheduled",   color: "#1D4ED8", bg: "#DBEAFE" },
  completed:   { label: "Completed",   color: "#15803D", bg: "#DCFCE7" },
  missed:      { label: "Missed",      color: "#B91C1C", bg: "#FEE2E2" },
  cancelled:   { label: "Cancelled",   color: "#6B7280", bg: "#F3F4F6" },
  rescheduled: { label: "Rescheduled", color: "#92400E", bg: "#FEF3C7" },
};

function formatCallbackTime(isoString: string, timezone: string): string {
  const dt = new Date(isoString);
  return dt.toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: timezone,
  });
}

/** Returns a short relative label: "Today 2:30 PM", "Tomorrow 10:00 AM", or the full date string */
function formatUpcomingTime(isoString: string, timezone: string): { dayLabel: string; timeLabel: string; isToday: boolean; isTomorrow: boolean } {
  const dt = new Date(isoString);
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-US", { timeZone: timezone });
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(now.getDate() + 1);
  const tomorrowStr = tomorrowDate.toLocaleDateString("en-US", { timeZone: timezone });
  const dtStr = dt.toLocaleDateString("en-US", { timeZone: timezone });

  const timeLabel = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: timezone });

  if (dtStr === todayStr) return { dayLabel: "Today", timeLabel, isToday: true, isTomorrow: false };
  if (dtStr === tomorrowStr) return { dayLabel: "Tomorrow", timeLabel, isToday: false, isTomorrow: true };
  const dayLabel = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: timezone });
  return { dayLabel, timeLabel, isToday: false, isTomorrow: false };
}

/** Minutes until a scheduled callback */
function minutesUntil(isoString: string): number {
  return (new Date(isoString).getTime() - Date.now()) / 60000;
}

type Callback = {
  callbackId: string;
  assignedTo: string;
  assignedToName: string | null;
  prospectFirstName: string;
  prospectLastName: string;
  prospectPhone: string;
  prospectEmail: string | null;
  scheduledAt: unknown;
  timezone: string;
  notes: string | null;
  status: string;
  completedAt: unknown;
  outcome: string | null;
  ghlTriggered: string;
  ghlTriggeredAt: unknown;
  ghlResponse: string | null;
  reminderSent: string;
  createdAt: unknown;
  source?: string | null;
  referredBy?: string | null;
  referredByName?: string | null;
};

function dialPhone(phone: string) {
  const cleaned = phone.replace(/\D/g, "");
  Linking.openURL(`tel:${cleaned}`).catch(() =>
    Alert.alert("Cannot Call", "Unable to open the phone dialer on this device.")
  );
}

export default function AdminCallbacks() {
  const colors = useColors();
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CallbackStatus | "all">("all");
  const [repFilter, setRepFilter] = useState<string>("all");
  const [selectedCallback, setSelectedCallback] = useState<Callback | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [reassigning, setReassigning] = useState(false);

  const { data: callbacks = [], refetch, isLoading } = trpc.salesCallback.listAll.useQuery();
  const { data: salesReps = [] } = trpc.salesCallback.listSalesReps.useQuery();
  const updateMutation = trpc.salesCallback.updateStatus.useMutation();
  const [activeTab, setActiveTab] = useState<"callbacks" | "revenue">("callbacks");
  const [revenueValue, setRevenueValue] = useState("");
  const [savingRevenue, setSavingRevenue] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  // Aggregate metrics
  const total = callbacks.length;
  const completed = callbacks.filter(c => c.status === "completed").length;
  const missed = callbacks.filter(c => c.status === "missed").length;
  const scheduled = callbacks.filter(c => c.status === "scheduled").length;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Per-rep stats
  const repStats = useMemo(() => {
    const map: Record<string, { name: string; total: number; completed: number; missed: number }> = {};
    for (const cb of callbacks) {
      const id = cb.assignedTo;
      if (!map[id]) map[id] = { name: cb.assignedToName ?? id, total: 0, completed: 0, missed: 0 };
      map[id].total++;
      if (cb.status === "completed") map[id].completed++;
      if (cb.status === "missed") map[id].missed++;
    }
    return Object.entries(map).map(([id, s]) => ({ id, ...s, rate: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0 }));
  }, [callbacks]);

  // Revenue calculations - parse "Revenue: $1200" from outcome field
  const revenueData = useMemo(() => {
    const won = callbacks.filter(c => c.status === "completed" && c.outcome && c.outcome.startsWith("Revenue:"));
    const total = won.reduce((sum, c) => {
      const match = c.outcome?.match(/\$([\d,.]+)/);
      return sum + (match ? parseFloat(match[1].replace(/,/g, "")) : 0);
    }, 0);
    const byRep: Record<string, { name: string; total: number; count: number }> = {};
    for (const c of won) {
      const id = c.assignedTo;
      const match = c.outcome?.match(/\$([\d,.]+)/);
      const val = match ? parseFloat(match[1].replace(/,/g, "")) : 0;
      if (!byRep[id]) byRep[id] = { name: c.assignedToName ?? id, total: 0, count: 0 };
      byRep[id].total += val;
      byRep[id].count++;
    }
    return { total, count: won.length, byRep: Object.values(byRep).sort((a, b) => b.total - a.total), won };
  }, [callbacks]);

  // Upcoming callbacks: scheduled, in the next 7 days, sorted soonest first
  const upcomingCallbacks = useMemo(() => {
    const now = Date.now();
    const sevenDays = now + 7 * 24 * 60 * 60 * 1000;
    return (callbacks as Callback[])
      .filter(c => {
        if (c.status !== "scheduled") return false;
        const t = new Date(c.scheduledAt as string).getTime();
        return t >= now - 5 * 60 * 1000 && t <= sevenDays; // include up to 5 min past
      })
      .sort((a, b) => new Date(a.scheduledAt as string).getTime() - new Date(b.scheduledAt as string).getTime());
  }, [callbacks]);

  const filtered = useMemo(() => {
    let list = callbacks as Callback[];
    if (statusFilter !== "all") list = list.filter(c => c.status === statusFilter);
    if (repFilter !== "all") list = list.filter(c => c.assignedTo === repFilter);
    return list;
  }, [callbacks, statusFilter, repFilter]);

  const handleReassign = async () => {
    if (!selectedCallback || !reassignTo) return;
    const rep = salesReps.find(r => r.employeeId === reassignTo);
    setReassigning(true);
    try {
      await updateMutation.mutateAsync({
        callbackId: selectedCallback.callbackId,
        assignedTo: reassignTo,
        assignedToName: rep?.fullName ?? reassignTo,
      });
      await refetch();
      setSelectedCallback(null);
      setReassignTo("");
      Alert.alert("Reassigned", `Callback reassigned to ${rep?.fullName ?? reassignTo}`);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to reassign");
    } finally {
      setReassigning(false);
    }
  };

  const styles = StyleSheet.create({
    header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
    title: { fontSize: 22, fontWeight: "800", color: colors.foreground },
    sub: { fontSize: 14, color: colors.muted, marginTop: 2 },
    metricsGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 8, marginBottom: 14 },
    metricCard: { width: "47%", backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border },
    metricNum: { fontSize: 22, fontWeight: "800", color: colors.foreground },
    metricLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
    filterRow: { flexDirection: "row", paddingLeft: 14, paddingRight: 20, gap: 6, marginBottom: 10, alignItems: "center" },
    filterBtn: { height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
    filterBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    filterText: { fontSize: 12, fontWeight: "600", color: colors.muted, lineHeight: 16 },
    filterTextActive: { color: "#FFF" },
    card: { marginHorizontal: 14, marginBottom: 10, backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border },
    cardName: { fontSize: 15, fontWeight: "700", color: colors.foreground },
    cardRep: { fontSize: 12, color: colors.primary, marginTop: 2, fontWeight: "600" },
    cardTime: { fontSize: 12, color: colors.muted, marginTop: 4 },
    statusBadge: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, marginTop: 6 },
    statusText: { fontSize: 11, fontWeight: "700" },
    sectionTitle: { fontSize: 13, fontWeight: "700", color: colors.muted, paddingHorizontal: 14, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
    repRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
    sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.foreground, marginBottom: 14 },
    detailRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
    detailLabel: { fontSize: 13, color: colors.muted },
    detailValue: { fontSize: 13, fontWeight: "600", color: colors.foreground, flex: 1, textAlign: "right" },
    input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.foreground, marginTop: 4 },
    btn: { paddingVertical: 12, borderRadius: 10, alignItems: "center", marginTop: 8 },
  });

  const renderItem = ({ item }: { item: Callback }) => {
    const cfg = STATUS_CONFIG[item.status as CallbackStatus] ?? STATUS_CONFIG.scheduled;
    const scheduledStr = item.scheduledAt as string;
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.75} onPress={() => setSelectedCallback(item)}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardName}>{item.prospectFirstName} {item.prospectLastName}</Text>
            {item.source === "detailer_referral" && item.referredByName ? (
              <View style={{ flexDirection: "row", marginBottom: 2 }}>
                <View style={{ backgroundColor: "#7C3AED18", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: "#7C3AED44" }}>
                  <Text style={{ fontSize: 10, fontWeight: "700", color: "#7C3AED" }}>🔗 Referred by {item.referredByName}</Text>
                </View>
              </View>
            ) : null}
            <Text style={styles.cardRep}>Rep: {item.assignedToName ?? item.assignedTo}</Text>
            <Text style={styles.cardTime}>{formatCallbackTime(scheduledStr, item.timezone)}</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <View style={[styles.statusBadge, { backgroundColor: cfg.bg, marginTop: 0 }]}>
              <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
            </View>
            {/* Quick call button on every row */}
            <TouchableOpacity
              onPress={() => dialPhone(item.prospectPhone)}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#16A34A18", borderWidth: 1, borderColor: "#16A34A55", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}
              activeOpacity={0.75}
            >
              <Text style={{ fontSize: 13 }}>📞</Text>
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#16A34A" }}>Call</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const router = useRouter();

  // Upcoming section rendered inside FlatList header
  const UpcomingSection = () => {
    if (upcomingCallbacks.length === 0) return null;
    return (
      <View style={{ marginHorizontal: 14, marginBottom: 18 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <Text style={{ fontSize: 16 }}>⏰</Text>
          <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }}>Upcoming Callbacks</Text>
          <View style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: "#FFF" }}>{upcomingCallbacks.length}</Text>
          </View>
        </View>
        {upcomingCallbacks.map((cb) => {
          const scheduledStr = cb.scheduledAt as string;
          const { dayLabel, timeLabel, isToday, isTomorrow } = formatUpcomingTime(scheduledStr, cb.timezone);
          const mins = minutesUntil(scheduledStr);
          const isOverdue = mins < 0;
          const isSoon = mins >= 0 && mins <= 30;

          let urgencyColor = colors.foreground;
          let urgencyBg = colors.surface;
          let urgencyBorder = colors.border;
          let urgencyBadge: string | null = null;

          if (isOverdue) {
            urgencyColor = "#B91C1C";
            urgencyBg = "#FEF2F2";
            urgencyBorder = "#FECACA";
            urgencyBadge = "Overdue";
          } else if (isSoon) {
            urgencyColor = "#92400E";
            urgencyBg = "#FFFBEB";
            urgencyBorder = "#FDE68A";
            urgencyBadge = mins < 5 ? "Now!" : `In ${Math.round(mins)}m`;
          } else if (isToday) {
            urgencyBg = "#EFF6FF";
            urgencyBorder = "#BFDBFE";
          }

          return (
            <TouchableOpacity
              key={cb.callbackId}
              onPress={() => setSelectedCallback(cb)}
              activeOpacity={0.75}
              style={{
                backgroundColor: urgencyBg,
                borderRadius: 14,
                borderWidth: 1.5,
                borderColor: urgencyBorder,
                padding: 14,
                marginBottom: 10,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {/* Time column */}
                <View style={{ width: 72, alignItems: "center", marginRight: 12 }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: isToday || isOverdue || isSoon ? urgencyColor : colors.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>
                    {dayLabel}
                  </Text>
                  <Text style={{ fontSize: 17, fontWeight: "800", color: isOverdue || isSoon ? urgencyColor : colors.primary, marginTop: 2 }}>
                    {timeLabel}
                  </Text>
                  {urgencyBadge && (
                    <View style={{ marginTop: 4, backgroundColor: isOverdue ? "#FEE2E2" : "#FEF3C7", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 10, fontWeight: "800", color: isOverdue ? "#B91C1C" : "#92400E" }}>{urgencyBadge}</Text>
                    </View>
                  )}
                </View>

                {/* Divider */}
                <View style={{ width: 1, height: 48, backgroundColor: urgencyBorder, marginRight: 12 }} />

                {/* Info column */}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>
                    {cb.prospectFirstName} {cb.prospectLastName}
                  </Text>
                  {(cb as any).source === "detailer_referral" && (cb as any).referredByName ? (
                    <View style={{ flexDirection: "row", marginTop: 2, marginBottom: 1 }}>
                      <View style={{ backgroundColor: "#7C3AED18", borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1, borderWidth: 1, borderColor: "#7C3AED44" }}>
                        <Text style={{ fontSize: 9, fontWeight: "700", color: "#7C3AED" }}>🔗 Referred by {(cb as any).referredByName}</Text>
                      </View>
                    </View>
                  ) : null}
                  <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600", marginTop: 2 }}>
                    {cb.assignedToName ?? cb.assignedTo}
                  </Text>
                  {cb.notes ? (
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 3 }} numberOfLines={1}>{cb.notes}</Text>
                  ) : null}
                </View>

                {/* Call button */}
                <TouchableOpacity
                  onPress={() => dialPhone(cb.prospectPhone)}
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    backgroundColor: "#16A34A",
                    alignItems: "center",
                    justifyContent: "center",
                    marginLeft: 10,
                    shadowColor: "#16A34A",
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.35,
                    shadowRadius: 4,
                    elevation: 4,
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={{ fontSize: 22 }}>📞</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  return (
    <ScreenContainer edges={["left", "right"]}>
      <View style={[styles.header, { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }]}>
        <View>
          <Text style={styles.title}>Sales Callbacks</Text>
          <Text style={styles.sub}>Admin Overview</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push("/(sales)/schedule-callback" as any)}
          style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, marginTop: 4 }}
        >
          <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* Tab Switcher */}
      <View style={{ flexDirection: "row", marginHorizontal: 14, marginBottom: 14, backgroundColor: colors.surface, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: colors.border }}>
        {(["callbacks", "revenue"] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={{ flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center", backgroundColor: activeTab === tab ? colors.primary : "transparent" }}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", color: activeTab === tab ? "#FFF" : colors.muted }}>
              {tab === "callbacks" ? "📞 Callbacks" : "💰 Revenue"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === "revenue" ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Revenue Summary Cards */}
          <View style={styles.metricsGrid}>
            <View style={styles.metricCard}>
              <Text style={[styles.metricNum, { color: "#15803D" }]}>${revenueData.total.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>
              <Text style={styles.metricLabel}>Total Revenue Won</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={[styles.metricNum, { color: "#1D4ED8" }]}>{revenueData.count}</Text>
              <Text style={styles.metricLabel}>Jobs Sold</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={[styles.metricNum, { color: "#7C3AED" }]}>
                ${revenueData.count > 0 ? (revenueData.total / revenueData.count).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "0"}
              </Text>
              <Text style={styles.metricLabel}>Avg Job Value</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={[styles.metricNum, { color: completionRate >= 80 ? "#15803D" : "#92400E" }]}>{completionRate}%</Text>
              <Text style={styles.metricLabel}>Close Rate</Text>
            </View>
          </View>

          {/* Per-Rep Revenue */}
          {revenueData.byRep.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Revenue by Rep</Text>
              <View style={{ marginHorizontal: 14, marginBottom: 14, backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border }}>
                {revenueData.byRep.map((rep, i) => (
                  <View key={i} style={[styles.repRow, { paddingVertical: 10 }]}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, flex: 1 }}>{rep.name}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginRight: 12 }}>{rep.count} job{rep.count !== 1 ? "s" : ""}</Text>
                    <Text style={{ fontSize: 14, fontWeight: "800", color: "#15803D" }}>${rep.total.toLocaleString()}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Won Jobs List */}
          <Text style={styles.sectionTitle}>Won Jobs</Text>
          {revenueData.won.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 32 }}>
              <Text style={{ fontSize: 32 }}>💰</Text>
              <Text style={{ fontSize: 15, color: colors.muted, marginTop: 8 }}>No revenue recorded yet</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4, textAlign: "center", paddingHorizontal: 32 }}>
                Open a completed callback and enter the job value to track revenue.
              </Text>
            </View>
          ) : (
            revenueData.won.map((c) => {
              const match = c.outcome?.match(/\$([\d,.]+)/);
              const val = match ? parseFloat(match[1].replace(/,/g, "")) : 0;
              const scheduledStr = c.scheduledAt ? new Date(c.scheduledAt as any).toISOString() : "";
              return (
                <View key={c.callbackId} style={[styles.card, { flexDirection: "row", alignItems: "center" }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{c.prospectFirstName} {c.prospectLastName}</Text>
                    <Text style={styles.cardRep}>{c.assignedToName ?? c.assignedTo}</Text>
                    <Text style={styles.cardTime}>{formatCallbackTime(scheduledStr, c.timezone)}</Text>
                  </View>
                  <Text style={{ fontSize: 18, fontWeight: "800", color: "#15803D" }}>${val.toLocaleString()}</Text>
                </View>
              );
            })
          )}
        </ScrollView>
      ) : (
      <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
        data={isLoading ? [] : filtered}
        keyExtractor={item => item.callbackId}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={
          <>
            {/* ── Upcoming Callbacks ── */}
            {!isLoading && <UpcomingSection />}

            {/* Metrics */}
            <View style={styles.metricsGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricNum}>{total}</Text>
                <Text style={styles.metricLabel}>Total Callbacks</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={[styles.metricNum, { color: "#1D4ED8" }]}>{scheduled}</Text>
                <Text style={styles.metricLabel}>Upcoming</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={[styles.metricNum, { color: completionRate >= 80 ? "#15803D" : completionRate >= 60 ? "#92400E" : "#B91C1C" }]}>
                  {completionRate}%
                </Text>
                <Text style={styles.metricLabel}>Completion Rate</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={[styles.metricNum, { color: "#B91C1C" }]}>{missed}</Text>
                <Text style={styles.metricLabel}>Missed</Text>
              </View>
            </View>
            {/* Per-rep performance */}
            {repStats.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Team Performance</Text>
                <View style={{ marginHorizontal: 14, marginBottom: 14, backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border }}>
                  {repStats.map(rep => (
                    <View key={rep.id} style={styles.repRow}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, flex: 1 }}>{rep.name}</Text>
                      <Text style={{ fontSize: 12, color: colors.muted, marginRight: 12 }}>{rep.completed}/{rep.total}</Text>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: rep.rate >= 80 ? "#15803D" : rep.rate >= 60 ? "#92400E" : "#B91C1C" }}>
                        {rep.rate}%
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}
            {/* Status filter */}
            <Text style={[styles.sectionTitle, { marginTop: 4 }]}>All Callbacks</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }} contentContainerStyle={styles.filterRow}>
              {(["all", "scheduled", "completed", "missed", "cancelled", "rescheduled"] as const).map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.filterBtn, statusFilter === s && styles.filterBtnActive]}
                  onPress={() => setStatusFilter(s)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.filterText, statusFilter === s && styles.filterTextActive]}>
                    {s === "all" ? "All" : STATUS_CONFIG[s as CallbackStatus]?.label ?? s}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {/* Rep filter */}
            {salesReps.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={styles.filterRow}>
                <TouchableOpacity
                  style={[styles.filterBtn, repFilter === "all" && styles.filterBtnActive]}
                  onPress={() => setRepFilter("all")}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.filterText, repFilter === "all" && styles.filterTextActive]}>All Reps</Text>
                </TouchableOpacity>
                {salesReps.map(rep => (
                  <TouchableOpacity
                    key={rep.employeeId}
                    style={[styles.filterBtn, repFilter === rep.employeeId && styles.filterBtnActive]}
                    onPress={() => setRepFilter(rep.employeeId)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.filterText, repFilter === rep.employeeId && styles.filterTextActive]}>{rep.fullName}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            {isLoading && <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />}
          </>
        }
        ListEmptyComponent={
          isLoading ? null : (
            <View style={{ alignItems: "center", paddingVertical: 48 }}>
              <Text style={{ fontSize: 16, color: colors.muted, fontWeight: "600" }}>No callbacks found</Text>
            </View>
          )
        }
      />
      )}
      {/* Detail / Reassign Modal */}
      <Modal visible={!!selectedCallback} animationType="slide" transparent onRequestClose={() => setSelectedCallback(null)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            {selectedCallback && (() => {
              const cfg = STATUS_CONFIG[selectedCallback.status as CallbackStatus] ?? STATUS_CONFIG.scheduled;
              const scheduledStr = selectedCallback.scheduledAt as string;
              return (
                <>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <Text style={styles.sheetTitle}>{selectedCallback.prospectFirstName} {selectedCallback.prospectLastName}</Text>
                    <TouchableOpacity onPress={() => setSelectedCallback(null)} activeOpacity={0.7}>
                      <Text style={{ fontSize: 22, color: colors.muted }}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ backgroundColor: cfg.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start", marginBottom: 12 }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: cfg.color }}>{cfg.label}</Text>
                  </View>

                  {/* Big call button at top of sheet */}
                  <TouchableOpacity
                    onPress={() => dialPhone(selectedCallback.prospectPhone)}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#16A34A", borderRadius: 14, paddingVertical: 14, marginBottom: 16 }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontSize: 20 }}>📞</Text>
                    <View>
                      <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 16 }}>Call Now</Text>
                      <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}>{selectedCallback.prospectPhone}</Text>
                    </View>
                  </TouchableOpacity>

                  {selectedCallback.source === "detailer_referral" && selectedCallback.referredByName ? (
                    <View style={{ flexDirection: "row", marginBottom: 12 }}>
                      <View style={{ backgroundColor: "#7C3AED15", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: "#7C3AED44", flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: 14 }}>🔗</Text>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: "#7C3AED" }}>Field Referral from {selectedCallback.referredByName}</Text>
                      </View>
                    </View>
                  ) : null}
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Phone</Text>
                    <Text style={styles.detailValue}>{selectedCallback.prospectPhone}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Assigned Rep</Text>
                    <Text style={styles.detailValue}>{selectedCallback.assignedToName ?? selectedCallback.assignedTo}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Scheduled</Text>
                    <Text style={styles.detailValue}>{formatCallbackTime(scheduledStr, selectedCallback.timezone)}</Text>
                  </View>

                  {selectedCallback.notes ? (
                    <View style={{ marginTop: 8, marginBottom: 4 }}>
                      <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 3 }}>Notes</Text>
                      <Text style={{ fontSize: 13, color: colors.foreground, lineHeight: 18 }}>{selectedCallback.notes}</Text>
                    </View>
                  ) : null}

                  {/* Callback Status */}
                  <View style={{ marginTop: 16 }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, marginBottom: 6 }}>UPDATE STATUS</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        {(["completed", "missed", "cancelled", "rescheduled"] as const).map((s) => {
                          const cfg = STATUS_CONFIG[s];
                          const isActive = selectedCallback.status === s;
                          return (
                            <TouchableOpacity
                              key={s}
                              style={[styles.filterBtn, isActive && { backgroundColor: cfg.color, borderColor: cfg.color }]}
                              onPress={() => {
                                updateMutation.mutate({
                                  callbackId: selectedCallback.callbackId,
                                  status: s,
                                });
                                setSelectedCallback({ ...selectedCallback, status: s });
                                refetch();
                              }}
                              activeOpacity={0.8}
                            >
                              <Text style={[styles.filterText, isActive && { color: "#FFF" }]}>{cfg.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </ScrollView>
                  </View>
                  {/* Revenue Value */}
                  <View style={{ marginTop: 16 }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, marginBottom: 6 }}>CALLBACK REVENUE VALUE</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        value={revenueValue}
                        onChangeText={setRevenueValue}
                        placeholder="e.g. 1200"
                        placeholderTextColor={colors.muted}
                        keyboardType="numeric"
                        returnKeyType="done"
                      />
                      <TouchableOpacity
                        style={[styles.btn, { backgroundColor: colors.success, paddingHorizontal: 16, marginTop: 0 }]}
                        onPress={async () => {
                          if (!revenueValue) return;
                          setSavingRevenue(true);
                          try {
                            await updateMutation.mutateAsync({
                              callbackId: selectedCallback.callbackId,
                              outcome: `Revenue: $${revenueValue}`,
                            });
                            await refetch();
                            Alert.alert("Saved", `Revenue value $${revenueValue} saved.`);
                            setRevenueValue("");
                          } catch (e: any) {
                            Alert.alert("Error", e?.message ?? "Failed to save");
                          } finally { setSavingRevenue(false); }
                        }}
                        disabled={savingRevenue}
                        activeOpacity={0.85}
                      >
                        <Text style={{ color: "#FFF", fontWeight: "700" }}>Save</Text>
                      </TouchableOpacity>
                    </View>
                    {selectedCallback.outcome ? (
                      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>Current: {selectedCallback.outcome}</Text>
                    ) : null}
                  </View>
                  {/* Reassign */}
                  {salesReps.length > 0 && (
                    <View style={{ marginTop: 16 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, marginBottom: 6 }}>REASSIGN TO</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          {salesReps.map(rep => (
                            <TouchableOpacity
                              key={rep.employeeId}
                              style={[styles.filterBtn, reassignTo === rep.employeeId && styles.filterBtnActive]}
                              onPress={() => setReassignTo(rep.employeeId)}
                              activeOpacity={0.8}
                            >
                              <Text style={[styles.filterText, reassignTo === rep.employeeId && styles.filterTextActive]}>{rep.fullName}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView>
                      {reassignTo && reassignTo !== selectedCallback.assignedTo && (
                        <TouchableOpacity
                          style={[styles.btn, { backgroundColor: colors.primary }]}
                          onPress={handleReassign}
                          disabled={reassigning}
                          activeOpacity={0.85}
                        >
                          {reassigning ? <ActivityIndicator color="#FFF" size="small" /> : (
                            <Text style={{ color: "#FFF", fontWeight: "700" }}>Confirm Reassignment</Text>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </>
              );
            })()}
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}
