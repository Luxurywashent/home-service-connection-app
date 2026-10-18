import { useMemo, useState, useEffect, useRef } from "react";
import { Pressable } from "react-native";
import { Text, View, ScrollView, FlatList, ActivityIndicator, Modal, TouchableOpacity, Platform, StyleSheet } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import {
  getJobSyncCompanyDashboardSummary,
  getJobSyncCompanyDispatchBoard,
  isCompanyLocationStale,
  type JobSyncCompanyDashboardSummary,
  type JobSyncCompanyDispatchLocation,
} from "@/lib/jobsync-mobile-api";
import { useJobSyncSync } from "@/lib/jobsync-sync-context";
import { companyReadFailure } from "@/lib/jobsync-company-authority";
import { companyRequestLoading, companyRequestValue, type CompanyRequestResource } from "@/lib/company-request-resource";
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

type CompanySummaryRequestState = {
  summary: JobSyncCompanyDashboardSummary | null;
  error: string | null;
};

type CompanyLocationsRequestState = {
  locations: JobSyncCompanyDispatchLocation[] | null;
  error: string | null;
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
  const { session: jobSyncSession } = useJobSyncAuth();
  const { revision: companySyncRevision } = useJobSyncSync();
  const router = useRouter();
  // Register push token so admins receive job and chat notifications
  useEmployeePush();
  const { start, end, today } = useMemo(() => getWeekRange(), []);
  const mapRef = useRef<MapView>(null);

  // State for day/week toggle
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [companySummaryResource, setCompanySummaryResource] = useState<CompanyRequestResource<CompanySummaryRequestState> | null>(null);
  const [companyLocationsResource, setCompanyLocationsResource] = useState<CompanyRequestResource<CompanyLocationsRequestState> | null>(null);
  const [lastCompanySummaryResource, setLastCompanySummaryResource] = useState<CompanyRequestResource<JobSyncCompanyDashboardSummary> | null>(null);
  const [companyOperationsRetry, setCompanyOperationsRetry] = useState(0);
  const companyOperationsRequest = useMemo(() => {
    const token = jobSyncSession?.token;
    if (!token) return null;
    const sessionPeriodKey = `${token}:${period}:${today}`;
    return {
      key: `${sessionPeriodKey}:${companySyncRevision}:${companyOperationsRetry}`,
      sessionPeriodKey,
      token,
      period,
      today,
    };
  }, [companyOperationsRetry, companySyncRevision, jobSyncSession?.token, period, today]);
  const companySummaryResponse = companyRequestValue(companyOperationsRequest?.key ?? null, companySummaryResource);
  const lastCompanySummary = companyRequestValue(companyOperationsRequest?.sessionPeriodKey ?? null, lastCompanySummaryResource);
  const companySummary = companySummaryResponse?.summary ?? lastCompanySummary;
  const companySummaryError = companySummaryResponse?.error ?? null;
  const companySummaryLoading = companyRequestLoading(companyOperationsRequest?.key ?? null, companySummaryResource);
  const companySummaryStale = !companySummaryResponse?.summary && Boolean(lastCompanySummary);
  const companyLocationsResponse = companyRequestValue(companyOperationsRequest?.key ?? null, companyLocationsResource);
  const companyLocations = companyLocationsResponse?.locations ?? [];
  const companyLocationsError = companyLocationsResponse?.error ?? null;
  const companyLocationsLoading = companyRequestLoading(companyOperationsRequest?.key ?? null, companyLocationsResource);

  // Queries
  const { data: detailers, isLoading: loadingDetailers } = trpc.employee.listDetailers.useQuery(undefined, { enabled: !jobSyncSession });
  const { data: leaderboard } = trpc.salesPerformance.getLeaderboard.useQuery(
    { date: today },
    { staleTime: 60000, refetchInterval: 60000, enabled: !jobSyncSession }
  );
  const { data: weekPerf, isLoading: loadingPerf } = trpc.performance.getAllDateRange.useQuery({ startDate: start, endDate: end }, { enabled: !jobSyncSession });
  const { data: alerts } = trpc.alerts.getSummary.useQuery(undefined, { enabled: !jobSyncSession });
  const { data: portalUnreadData } = trpc.portalInbox.unreadCount.useQuery(undefined, { refetchInterval: 30000, enabled: !jobSyncSession });
  const { data: portalThreadsData } = trpc.portalInbox.listThreads.useQuery(undefined, { refetchInterval: 30000, enabled: !jobSyncSession });
  const firstUnreadThread = (portalThreadsData as any[] ?? []).find((t: any) => t.unreadCount > 0) ?? null;
  const portalUnreadCount = portalUnreadData?.count ?? 0;
  const { data: weekJobs } = trpc.jobs.listAll.useQuery(
    { startDate: start, endDate: end },
    { staleTime: 60000, enabled: !jobSyncSession }
  );
  const { data: vans } = trpc.location.getActive.useQuery(undefined, {
    refetchInterval: 30000,
    enabled: !jobSyncSession,
  });
  useEffect(() => {
    if (!companyOperationsRequest) return;
    let cancelled = false;
    const request = companyOperationsRequest;

    void getJobSyncCompanyDashboardSummary(request.token, { period: request.period })
      .then((summary) => {
        if (cancelled) return;
        setCompanySummaryResource({ requestKey: request.key, data: { summary, error: null } });
        // A prior response can only be shown after an error for this same session and period.
        setLastCompanySummaryResource({ requestKey: request.sessionPeriodKey, data: summary });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = companyReadFailure(error);
        // Navigation and native fetch cancellation are expected and should remain silent.
        if (!message) return;
        setCompanySummaryResource({ requestKey: request.key, data: { summary: null, error: message } });
      });

    void getJobSyncCompanyDispatchBoard(request.token, { date: request.today })
      .then((board) => {
        if (cancelled) return;
        setCompanyLocationsResource({ requestKey: request.key, data: { locations: board.locations, error: null } });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = companyReadFailure(error);
        // Do not turn a cancelled request into an empty, misleading dispatch board.
        if (!message) return;
        setCompanyLocationsResource({ requestKey: request.key, data: { locations: null, error: message } });
      });

    return () => { cancelled = true; };
  }, [companyOperationsRequest]);
  const retryCompanyOperations = () => {
    if (companyOperationsRequest) setCompanyOperationsRetry((retry) => retry + 1);
  };
  const dashboardJobs = jobSyncSession ? undefined : (weekJobs as any[] | undefined);
  // Note: We'll fetch break data from detailers' timesheet status instead
  // const { data: timesheets } = trpc.timesheet.getWeeklyLogs.useQuery(
  //   { startDate: start, endDate: end },
  //   { staleTime: 30000 }
  // );

  // Calculate metrics
  const metrics = useMemo(() => {
    if (!dashboardJobs) return { revenue: 0, upsellPercentage: 0, totalUpsells: 0, jobsWithUpsells: 0, totalJobs: 0 };

    const jobs = dashboardJobs.filter(j =>
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
  }, [dashboardJobs, period, today]);

  // Break alerts feature - will be implemented with timesheet API integration
  const breakAlerts: any[] = [];

  const isLoading = jobSyncSession ? companySummaryLoading && !companySummary && !companySummaryError : loadingDetailers || loadingPerf;
  const companyMoney = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
  const liveCompanyLocations = companyLocations.filter((location) => !isCompanyLocationStale(location));
  const staleCompanyLocations = companyLocations.filter((location) => isCompanyLocationStale(location));

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
              {jobSyncSession ? (
                companySummaryError && !companySummary ? (
                  <View style={{ backgroundColor: colors.error + "12", borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.error + "40" }}>
                    <Text style={{ fontSize: 16, fontWeight: "800", color: colors.error, marginBottom: 8 }}>Revenue unavailable</Text>
                    <Text style={{ fontSize: 13, color: colors.foreground, marginBottom: 12 }}>{companySummaryError}</Text>
                    <TouchableOpacity accessibilityRole="button" onPress={retryCompanyOperations} style={{ alignSelf: "flex-start", backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}>
                      <Text style={{ color: "#fff", fontWeight: "700" }}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                ) : companySummary ? (
                  <View style={{ gap: 12 }}>
                    {companySummaryStale ? (
                      <View style={{ backgroundColor: colors.warning + "18", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.warning + "40" }}>
                        <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }}>Showing the last successful summary</Text>
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{companySummaryError ?? "Refreshing canonical Company data…"}</Text>
                        <TouchableOpacity accessibilityRole="button" onPress={retryCompanyOperations} style={{ marginTop: 8 }}>
                          <Text style={{ color: colors.primary, fontWeight: "700" }}>Retry</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border }}>
                        <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>Booked</Text>
                        <Text style={{ fontSize: 28, fontWeight: "900", color: colors.primary }}>{companyMoney(companySummary.bookedRevenue)}</Text>
                        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>{companySummary.jobsBooked} jobs · {companySummary.timezone}</Text>
                      </View>
                      <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border }}>
                        <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>Collected</Text>
                        <Text style={{ fontSize: 28, fontWeight: "900", color: colors.success }}>{companyMoney(companySummary.collected)}</Text>
                        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>Payments in this period</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border }}>
                        <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>Completed value</Text>
                        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>{companyMoney(companySummary.completedJobValue)}</Text>
                      </View>
                      <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border }}>
                        <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>Outstanding</Text>
                        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>{companyMoney(companySummary.outstandingBalance)}</Text>
                        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>All open Company balances</Text>
                      </View>
                    </View>
                  </View>
                ) : (
                  <ActivityIndicator color={colors.primary} />
                )
              ) : (
                <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}>
                  <Text style={{ fontSize: 14, color: colors.muted, marginBottom: 8 }}>{period === "day" ? "Today's" : "This Week's"} Revenue</Text>
                  <Text style={{ fontSize: 48, fontWeight: "900", color: colors.primary }}>
                    ${metrics.revenue.toFixed(0)}
                  </Text>
                </View>
              )}
            </View>

            {/* Upsells Section */}
            <View style={{ marginBottom: 24 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Upsells and discounts</Text>
              {jobSyncSession ? (
                <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 8 }}>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "700" }}>Not tracked as separate totals</Text>
                  <Text style={{ fontSize: 13, color: colors.muted }}>{companySummary?.upsellDefinition ?? "Upsell dollars are not stored separately from the job amount."}</Text>
                  <Text style={{ fontSize: 13, color: colors.muted }}>{companySummary?.discountDefinition ?? "Discount dollars are not stored separately from the job amount."}</Text>
                </View>
              ) : (
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
              )}
            </View>

            {/* Map View */}
            <View style={{ marginBottom: 24 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Team Locations</Text>
              <View style={{ height: 200, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
                {jobSyncSession ? (
                  companyLocationsError && companyLocations.length === 0 ? (
                    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.surface, padding: 16 }}>
                      <Text style={{ fontSize: 14, color: colors.error, fontWeight: "700" }}>Locations unavailable</Text>
                      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4, textAlign: "center" }}>{companyLocationsError}</Text>
                      <TouchableOpacity accessibilityRole="button" onPress={retryCompanyOperations} style={{ marginTop: 10 }}>
                        <Text style={{ color: colors.primary, fontWeight: "700" }}>Retry</Text>
                      </TouchableOpacity>
                    </View>
                  ) : liveCompanyLocations.length > 0 && Platform.OS !== "web" ? (
                    <MapView
                      provider={(Platform.OS as string) !== "web" ? PROVIDER_GOOGLE : undefined}
                      ref={mapRef}
                      style={{ flex: 1 }}
                      initialRegion={REGION_DEFAULT}
                      scrollEnabled={false}
                      zoomEnabled={false}
                    >
                      {liveCompanyLocations.map((location) => (
                        <Marker
                          key={location.userId}
                          coordinate={{ latitude: location.latitude, longitude: location.longitude }}
                          title={`${location.name} · live`}
                          description={location.recordedAt ? `Updated ${new Date(location.recordedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Updated time unavailable"}
                        >
                          <VanMarker color="#8B5CF6" label={location.name.split(" ")[0] || "Tech"} />
                        </Marker>
                      ))}
                    </MapView>
                  ) : (
                    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.surface, padding: 16 }}>
                      <Text style={{ fontSize: 14, color: colors.muted }}>{companyLocationsLoading ? "Loading locations…" : liveCompanyLocations.length > 0 ? `📍 ${liveCompanyLocations.length} live location${liveCompanyLocations.length === 1 ? "" : "s"}` : "📍 No live locations"}</Text>
                      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4, textAlign: "center" }}>
                        {staleCompanyLocations.length > 0 ? `${staleCompanyLocations.length} older update${staleCompanyLocations.length === 1 ? "" : "s"} hidden. An old point is not shown as live.` : "Technicians appear after they clock in and share a fresh location."}
                      </Text>
                    </View>
                  )
                ) : vans && vans.length > 0 ? (
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
              {jobSyncSession ? (
                <View style={{ marginTop: 10, gap: 6 }}>
                  {liveCompanyLocations.map((location) => (
                    <Text key={`live-${location.userId}`} style={{ color: colors.muted, fontSize: 12 }}>
                      {location.name} · live · {location.recordedAt ? new Date(location.recordedAt).toLocaleString() : "time unavailable"}
                    </Text>
                  ))}
                  {staleCompanyLocations.map((location) => (
                    <Text key={`stale-${location.userId}`} style={{ color: colors.muted, fontSize: 12 }}>
                      {location.name} · not live · {location.recordedAt ? new Date(location.recordedAt).toLocaleString() : "time unavailable"}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>

            {/* Quick Actions */}
            <View style={{ marginBottom: 24 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Quick Actions</Text>
              <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
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
