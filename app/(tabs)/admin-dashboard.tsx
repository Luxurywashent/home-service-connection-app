import { useMemo, useState, useEffect, useRef } from "react";
import { Pressable } from "react-native";
import { Text, View, ScrollView, FlatList, ActivityIndicator, Modal, TouchableOpacity, Platform, StyleSheet } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useEmployeePush } from "@/hooks/use-employee-push";
import { trpc } from "@/lib/trpc";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import MapView, { Marker, Callout, PROVIDER_GOOGLE } from "react-native-maps";

function getWeekRange() {
  const now = new Date();
  const toCST = (d: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  const cstStr = toCST(now);
  const cstDate = new Date(cstStr + 'T12:00:00');
  const day = cstDate.getDay();
  const monday = new Date(cstDate);
  monday.setDate(cstDate.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: toCST(monday),
    end: toCST(sunday),
    today: cstStr,
  };
}

// Default map region (Northwest Florida)
const REGION_DEFAULT = {
  latitude: 30.52,
  longitude: -86.48,
  latitudeDelta: 0.9,
  longitudeDelta: 0.9,
};

// Custom van marker component
function VanMarker({ color, label }: { color: string; label: string }) {
  return (
    <View style={markerStyles.container}>
      <View style={[markerStyles.bubble, { backgroundColor: color, shadowColor: color }]}>
        <Text style={markerStyles.emoji}>🚐</Text>
      </View>
      <View style={[markerStyles.tail, { borderTopColor: color }]} />
      <View style={[markerStyles.labelBg, { backgroundColor: "#1e293b" }]}>
        <Text style={markerStyles.labelText} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

const markerStyles = StyleSheet.create({
  container: { alignItems: "center" },
  bubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 6,
  },
  emoji: { fontSize: 22 },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginTop: -1,
  },
  labelBg: {
    marginTop: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    maxWidth: 110,
  },
  labelText: { color: "#fff", fontSize: 10, fontWeight: "600" },
});

export default function AdminDashboard() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const router = useRouter();
  // Register push token so admins receive job and chat notifications
  useEmployeePush();
  const { start, end, today } = useMemo(() => getWeekRange(), []);
  const mapRef = useRef<MapView>(null);

  // State for day/week toggle
  const [period, setPeriod] = useState<"day" | "week">("day");

  // Queries
  const { data: detailers, isLoading: loadingDetailers } = trpc.employee.listDetailers.useQuery();
  const { data: leaderboard } = trpc.salesPerformance.getLeaderboard.useQuery(
    { date: today },
    { staleTime: 60000, refetchInterval: 60000 }
  );
  const { data: weekPerf, isLoading: loadingPerf } = trpc.performance.getAllDateRange.useQuery({ startDate: start, endDate: end });
  const { data: alerts } = trpc.alerts.getSummary.useQuery();
  const { data: portalUnreadData } = trpc.portalInbox.unreadCount.useQuery(undefined, { refetchInterval: 30000 });
  const { data: portalThreadsData } = trpc.portalInbox.listThreads.useQuery(undefined, { refetchInterval: 30000 });
  const firstUnreadThread = (portalThreadsData as any[] ?? []).find((t: any) => t.unreadCount > 0) ?? null;
  const portalUnreadCount = portalUnreadData?.count ?? 0;
  const { data: weekJobs } = trpc.jobs.listAll.useQuery(
    { startDate: start, endDate: end },
    { staleTime: 60000 }
  );
  const { data: vans } = trpc.location.getActive.useQuery(undefined, {
    refetchInterval: 30000,
  });
  // Note: We'll fetch break data from detailers' timesheet status instead
  // const { data: timesheets } = trpc.timesheet.getWeeklyLogs.useQuery(
  //   { startDate: start, endDate: end },
  //   { staleTime: 30000 }
  // );

  // Calculate metrics
  const metrics = useMemo(() => {
    if (!weekJobs) return { revenue: 0, upsellPercentage: 0, totalUpsells: 0, jobsWithUpsells: 0, totalJobs: 0 };

    const jobs = (weekJobs as any[]).filter(j =>
      ['confirmed', 'in_progress', 'completed'].includes(j.status) &&
      j.assignedTo && j.assignedTo.trim() !== ''
    );
    
    // Calculate revenue for selected period
    let revenue = 0;
    let jobsWithUpsells = 0;
    let totalUpsells = 0;

    for (const job of jobs) {
      const jobDate = job.date;
      const shouldInclude = period === "day" ? jobDate === today : true;
      
      if (shouldInclude) {
        const price = Number(job.totalPrice ?? 0);
        const discount = Number(job.discountAmount ?? 0);
        const upsellAmt = Number(job.upsellTotal ?? 0);
        // Revenue = base price + upsells - discount
        revenue += Math.max(0, price + upsellAmt - discount);
        
        if (upsellAmt > 0) {
          jobsWithUpsells++;
        }
        totalUpsells += upsellAmt;
      }
    }

    const totalJobs = jobs.filter(j => period === "day" ? j.date === today : true).length;
    const upsellPercentage = totalJobs > 0 ? (jobsWithUpsells / totalJobs) * 100 : 0;

    return { revenue, upsellPercentage, totalUpsells, jobsWithUpsells, totalJobs };
  }, [weekJobs, period, today]);

  // Break alerts feature - will be implemented with timesheet API integration
  const breakAlerts: any[] = [];

  const isLoading = loadingDetailers || loadingPerf;

  return (
    <ScreenContainer edges={["left", "right"]} className="px-5">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={{ marginTop: 8, marginBottom: 24 }}>
          <Text style={{ fontSize: 14, color: colors.muted }}>Admin Dashboard</Text>
          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.foreground }}>
            Operations Overview
          </Text>
        </View>

        {/* Portal Unread Message Banner */}
        {portalUnreadCount > 0 && firstUnreadThread && (
          <Pressable
            onPress={() => router.push({ pathname: "/(tabs)/admin-communications", params: { tab: "portal", customerId: String(firstUnreadThread.customerId) } })}
            style={({ pressed }) => ({
              backgroundColor: colors.primary + "18",
              borderRadius: 12,
              padding: 14,
              marginBottom: 16,
              borderWidth: 1,
              borderColor: colors.primary + "40",
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <View style={{ backgroundColor: "#EF4444", borderRadius: 12, minWidth: 24, height: 24, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }}>
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{portalUnreadCount > 99 ? "99+" : portalUnreadCount}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "700" }}>
                {portalUnreadCount === 1 ? "1 unread portal message" : `${portalUnreadCount} unread portal messages`}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
                {firstUnreadThread.customerName}: {firstUnreadThread.latestBody}
              </Text>
            </View>
            <Text style={{ color: colors.primary, fontSize: 16 }}>›</Text>
          </Pressable>
        )}

        {/* Alert Badges */}
        {alerts && (alerts.pendingTimeOffCount > 0 || alerts.unacknowledgedCount > 0) && (
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 20 }}>
            {alerts.pendingTimeOffCount > 0 && (
              <Pressable
                onPress={() => router.push("/(tabs)/admin-timeoff" as any)}
                style={({ pressed }) => ({ flex: 1, backgroundColor: colors.warning + "15", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.warning + "30", opacity: pressed ? 0.75 : 1 })}
              >
                <Text style={{ fontSize: 20, fontWeight: "900", color: colors.warning }}>{alerts.pendingTimeOffCount}</Text>
                <Text style={{ fontSize: 11, color: colors.warning, fontWeight: "600" }}>Pending Time Off</Text>
              </Pressable>
            )}
            {breakAlerts.length > 0 && (
              <View style={{ flex: 1, backgroundColor: colors.error + "15", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.error + "30" }}>
                <Text style={{ fontSize: 20, fontWeight: "900", color: colors.error }}>{breakAlerts.length}</Text>
                <Text style={{ fontSize: 11, color: colors.error, fontWeight: "600" }}>Missed Breaks</Text>
              </View>
            )}
          </View>
        )}

        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Revenue Section */}
            <View style={{ marginBottom: 24 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Revenue</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => {
                      setPeriod("day");
                      if ((Platform.OS as string) !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 8,
                      backgroundColor: period === "day" ? colors.primary : colors.surface,
                      borderWidth: 1,
                      borderColor: period === "day" ? colors.primary : colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "600", color: period === "day" ? "#fff" : colors.muted }}>Today</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setPeriod("week");
                      if ((Platform.OS as string) !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 8,
                      backgroundColor: period === "week" ? colors.primary : colors.surface,
                      borderWidth: 1,
                      borderColor: period === "week" ? colors.primary : colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "600", color: period === "week" ? "#fff" : colors.muted }}>This Week</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}>
                <Text style={{ fontSize: 14, color: colors.muted, marginBottom: 8 }}>{period === "day" ? "Today's" : "This Week's"} Revenue</Text>
                <Text style={{ fontSize: 48, fontWeight: "900", color: colors.primary }}>
                  ${metrics.revenue.toFixed(0)}
                </Text>
              </View>
            </View>

            {/* Upsells Section */}
            <View style={{ marginBottom: 24 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Upsells</Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}>
                  <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>Percentage</Text>
                  <Text style={{ fontSize: 36, fontWeight: "900", color: colors.primary }}>
                    {metrics.upsellPercentage.toFixed(0)}%
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>of jobs</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}>
                  <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>Total Value</Text>
                  <Text style={{ fontSize: 36, fontWeight: "900", color: colors.primary }}>
                    ${metrics.totalUpsells.toFixed(0)}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>{metrics.jobsWithUpsells} jobs</Text>
                </View>
              </View>
            </View>

            {/* Map View */}
            <View style={{ marginBottom: 24 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Team Locations</Text>
              <View style={{ height: 200, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
                {vans && vans.length > 0 ? (
                  Platform.OS === "web" ? (
                    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.surface }}>
                      <Text style={{ fontSize: 14, color: colors.muted }}>📍 Map view available on mobile</Text>
                      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Showing {vans.length} team member{vans.length !== 1 ? "s" : ""}</Text>
                    </View>
                  ) : (
                    <MapView
              provider={(Platform.OS as string) !== "web" ? PROVIDER_GOOGLE : undefined}
                      ref={mapRef}
                      style={{ flex: 1 }}
                      initialRegion={REGION_DEFAULT}
                      scrollEnabled={false}
                      zoomEnabled={false}
                    >
                      {(vans as any[]).map((van) => (
                        <Marker
                          key={van.employeeId}
                          coordinate={{
                            latitude: parseFloat(van.lat),
                            longitude: parseFloat(van.lng),
                          }}
                        >
                          <VanMarker
                            color={van.status === "on_my_way" ? "#F59E0B" : "#8B5CF6"}
                            label={van.fullName?.split(" ")[0] || "Van"}
                          />
                        </Marker>
                      ))}
                    </MapView>
                  )
                ) : (
                  <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.surface }}>
                    <Text style={{ fontSize: 14, color: colors.muted }}>📍 No active locations</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Team members appear when clocked in</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Team Efficiency Card */}
            {(() => {
              const perfRecords = (weekPerf as any[] ?? []);
              const periodRecords = perfRecords.filter((r: any) => {
                if (period === "day") return r.date === today;
                return true; // week
              });
              // Group by employeeId and average efficiency per detailer
              const byDetailer: Record<string, { name: string; scores: number[] }> = {};
              for (const r of periodRecords) {
                const eff = parseFloat(r.efficiencyPercent ?? "0");
                if (eff > 0.01) {
                  if (!byDetailer[r.employeeId]) byDetailer[r.employeeId] = { name: r.fullName ?? r.employeeId, scores: [] };
                  byDetailer[r.employeeId].scores.push(eff);
                }
              }
              const detailerAvgs = Object.values(byDetailer).map(d => d.scores.reduce((a, b) => a + b, 0) / d.scores.length);
              const teamAvg = detailerAvgs.length > 0 ? detailerAvgs.reduce((a, b) => a + b, 0) / detailerAvgs.length : null;
              const getEffColor = (score: number | null) => {
                if (score === null) return colors.muted;
                if (score >= 85) return colors.success;
                if (score >= 70) return "#F59E0B";
                return colors.error;
              };
              const getEffLabel = (score: number | null) => {
                if (score === null) return "No data";
                if (score >= 85) return "Excellent";
                if (score >= 70) return "Good";
                if (score >= 55) return "Needs Improvement";
                return "Critical";
              };
              return (
                <TouchableOpacity
                  onPress={() => { if ((Platform.OS as string) !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/(tabs)/admin-efficiency" as any); }}
                  style={{ marginBottom: 24 }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Team Efficiency</Text>
                    <Text style={{ fontSize: 11, color: colors.primary }}>View Details ›</Text>
                  </View>
                  <View style={{
                    backgroundColor: teamAvg !== null ? getEffColor(teamAvg) + "18" : colors.surface,
                    borderRadius: 16, padding: 20, borderWidth: 1.5,
                    borderColor: teamAvg !== null ? getEffColor(teamAvg) + "60" : colors.border,
                  }}>
                    {teamAvg === null ? (
                      <View style={{ alignItems: "center" }}>
                        <Text style={{ fontSize: 24 }}>⚡</Text>
                        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.muted, marginTop: 8 }}>No efficiency data yet</Text>
                        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Data appears after EOD reviews are submitted</Text>
                      </View>
                    ) : (
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <View>
                          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, letterSpacing: 0.8, textTransform: "uppercase" }}>Team Average</Text>
                          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, marginTop: 4 }}>
                            <Text style={{ fontSize: 42, fontWeight: "900", color: getEffColor(teamAvg) }}>{teamAvg.toFixed(1)}</Text>
                            <Text style={{ fontSize: 18, fontWeight: "700", color: getEffColor(teamAvg), marginBottom: 8 }}>%</Text>
                          </View>
                          <View style={{ backgroundColor: getEffColor(teamAvg) + "30", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, alignSelf: "flex-start", marginTop: 4 }}>
                            <Text style={{ fontSize: 12, fontWeight: "700", color: getEffColor(teamAvg) }}>{getEffLabel(teamAvg)}</Text>
                          </View>
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 6 }}>
                          <Text style={{ fontSize: 12, color: colors.muted }}>{detailerAvgs.length} detailer{detailerAvgs.length !== 1 ? "s" : ""}</Text>
                          <Text style={{ fontSize: 11, color: colors.muted }}>with data</Text>
                          <Text style={{ fontSize: 28 }}>⚡</Text>
                        </View>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })()}

            {/* Quick Actions */}
            <View style={{ marginBottom: 24 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Quick Actions</Text>
              <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
                <TouchableOpacity
                  onPress={() => { if ((Platform.OS as string) !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/(tabs)/admin-locations" as any); }}
                  style={{ flex: 1, minWidth: 140, backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border, alignItems: "flex-start", gap: 6 }}
                >
                  <Text style={{ fontSize: 26 }}>📍</Text>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>Manage Locations</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>Service areas & detailers</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { if ((Platform.OS as string) !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/(tabs)/admin-employees" as any); }}
                  style={{ flex: 1, minWidth: 140, backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border, alignItems: "flex-start", gap: 6 }}
                >
                  <Text style={{ fontSize: 26 }}>👥</Text>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>Manage Team</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>Employees & roles</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Break Alerts - Coming Soon */}
            <View style={{ marginBottom: 24, backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, opacity: 0.6 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.muted }}>Break Alerts</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 8 }}>Real-time break monitoring coming soon</Text>
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
