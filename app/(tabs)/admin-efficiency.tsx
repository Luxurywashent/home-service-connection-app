import { useState, useEffect, useMemo } from "react";
import { Text, View, ScrollView, TouchableOpacity, ActivityIndicator, Platform, StyleSheet } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";

type Period = "day" | "week" | "month";

function getDateRange(period: Period): { startDate: string; endDate: string; today: string; daysElapsed: number } {
  const now = new Date();
  const toCST = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);

  const todayStr = toCST(now);
  const todayDate = new Date(todayStr + "T12:00:00");

  if (period === "day") {
    return { startDate: todayStr, endDate: todayStr, today: todayStr, daysElapsed: 1 };
  }
  if (period === "week") {
    const day = todayDate.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const monday = new Date(todayDate);
    monday.setDate(todayDate.getDate() - (day === 0 ? 6 : day - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    // Days elapsed in Mon–Sun work week: Mon=1, Tue=2, ..., Sat=6, Sun=7
    const daysElapsed = day === 0 ? 7 : day; // Sun(0)->7, Mon(1)->1, ..., Sat(6)->6
    return { startDate: toCST(monday), endDate: toCST(sunday), today: todayStr, daysElapsed };
  }
  // month
  const firstDay = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
  const lastDay = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0);
  const daysElapsed = todayDate.getDate();
  return { startDate: toCST(firstDay), endDate: toCST(lastDay), today: todayStr, daysElapsed };
}

function getEffColor(score: number | null, colors: any): string {
  if (score === null) return colors.muted;
  if (score >= 85) return colors.success;
  if (score >= 70) return "#F59E0B";
  return colors.error;
}

function getEffLabel(score: number | null): string {
  if (score === null) return "No Data";
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 55) return "Needs Improvement";
  return "Critical";
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const colors = useColors();
  return (
    <View style={{
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
    }}>
      <Text style={{ fontSize: 10, fontWeight: "700", color: colors.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 }}>{label}</Text>
      <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>{value}</Text>
      {sub ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );
}

export default function AdminEfficiency() {
  const colors = useColors();
  const [period, setPeriod] = useState<Period>("week");
  const [selectedDetailer, setSelectedDetailer] = useState<string>("__team__");
  const [showDropdown, setShowDropdown] = useState(false);

  const { startDate, endDate, today, daysElapsed } = useMemo(() => getDateRange(period), [period]);

  // Previous period date range for trend comparison
  const { prevStartDate, prevEndDate } = useMemo(() => {
    const toCST = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Chicago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
    const start = new Date(startDate + "T12:00:00");
    const end = new Date(endDate + "T12:00:00");
    const rangeDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - rangeDays + 1);
    return { prevStartDate: toCST(prevStart), prevEndDate: toCST(prevEnd) };
  }, [startDate, endDate]);

  const { data: detailers } = trpc.employee.listDetailers.useQuery();
  const { data: perfRecords, isLoading, refetch } = trpc.performance.getAllDateRange.useQuery(
    { startDate, endDate },
    { staleTime: 30000 }
  );
  const { data: prevPerfRecords } = trpc.performance.getAllDateRange.useQuery(
    { startDate: prevStartDate, endDate: prevEndDate },
    { staleTime: 60000 }
  );
  // Fetch schedule_jobs for the same period so revenue matches the Dashboard exactly
  const { data: periodJobs } = trpc.jobs.listAll.useQuery(
    { startDate, endDate },
    { staleTime: 30000 }
  );
  const { data: prevPeriodJobs } = trpc.jobs.listAll.useQuery(
    { startDate: prevStartDate, endDate: prevEndDate },
    { staleTime: 60000 }
  );

  const [isSyncing, setIsSyncing] = useState(false);
  const resyncMutation = trpc.performance.resyncDateRange.useMutation();

  const handleResync = async () => {
    setIsSyncing(true);
    try {
      // Resync last 30 days to backfill any records with 0 efficiency
      const toCST = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(now.getDate() - 30);
      await resyncMutation.mutateAsync({ startDate: toCST(thirtyDaysAgo), endDate: toCST(now) });
      await refetch();
    } finally {
      setIsSyncing(false);
    }
  };

  // Fetch timesheet hours for the current period (actual clock-in/clock-out totals per employee)
  const { data: teamTimesheetHours } = trpc.timesheet.getTeamHoursByDateRange.useQuery(
    { startDate, endDate },
    { staleTime: 30000 }
  );
  const { data: prevTeamTimesheetHours } = trpc.timesheet.getTeamHoursByDateRange.useQuery(
    { startDate: prevStartDate, endDate: prevEndDate },
    { staleTime: 60000 }
  );

  // Build a map of employeeId -> timesheet hours for quick lookup
  const timesheetHoursMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of (teamTimesheetHours as any[] ?? [])) {
      if (row.employeeId) map[row.employeeId] = Number(row.totalHours ?? 0);
    }
    return map;
  }, [teamTimesheetHours]);

  const prevTimesheetHoursMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of (prevTeamTimesheetHours as any[] ?? [])) {
      if (row.employeeId) map[row.employeeId] = Number(row.totalHours ?? 0);
    }
    return map;
  }, [prevTeamTimesheetHours]);

  // Fetch currently clocked-in employees so we can compute live hours for "Today" view
  const { data: activeClockedIn } = trpc.timesheet.getActiveClockedIn.useQuery(
    undefined,
    { refetchInterval: 60000, enabled: period === 'day' } // refresh every 60s while on Today view
  );

  // Live tick — updates every 60 seconds so displayed hours/efficiency stay current
  const [, setTick] = useState(0);
  useEffect(() => {
    if (period !== 'day') return;
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, [period]);

  // Build a map of employeeId -> live elapsed hours for anyone currently clocked in
  const liveHoursMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (period !== 'day') return map;
    for (const rec of (activeClockedIn as any[] ?? [])) {
      if (rec.clockInTime && rec.employeeId) {
        const elapsed = (Date.now() - new Date(rec.clockInTime).getTime()) / (1000 * 60 * 60);
        map[rec.employeeId] = elapsed;
      }
    }
    return map;
  }, [activeClockedIn, period]);

  const records = (perfRecords as any[] ?? []);

  // Build per-detailer revenue map from schedule_jobs (same logic as Dashboard)
  // This ensures revenue on Efficiency screen always matches Dashboard revenue.
  const jobRevenueMap = useMemo(() => {
    const map: Record<string, { revenue: number; upsells: number; tips: number }> = {};
    const empList = (detailers as any[] ?? []);
    for (const job of (periodJobs as any[] ?? [])) {
      if (!['confirmed', 'in_progress', 'completed'].includes(job.status)) continue;
      const price = parseFloat(job.totalPrice ?? job.price ?? '0');
      const upsell = parseFloat(job.upsellTotal ?? job.upsellAmt ?? '0');
      const discount = parseFloat(job.discountAmount ?? job.discount ?? '0');
      const tips = parseFloat(job.tips ?? '0');
      const rev = Math.max(0, price + upsell - discount);
      // Resolve employeeId from assignedTo
      const assignedTo = job.assignedTo ?? '';
      const emp = empList.find((e: any) =>
        e.employeeId === assignedTo ||
        e.fullName === assignedTo ||
        (e.fullName ?? '').split(' ')[0] === assignedTo
      );
      const empId = emp?.employeeId ?? assignedTo;
      if (!empId) continue;
      if (!map[empId]) map[empId] = { revenue: 0, upsells: 0, tips: 0 };
      map[empId].revenue += rev;
      map[empId].upsells += upsell;
      map[empId].tips += tips;
    }
    return map;
  }, [periodJobs, detailers]);

  const prevJobRevenueMap = useMemo(() => {
    const map: Record<string, number> = {};
    const empList = (detailers as any[] ?? []);
    for (const job of (prevPeriodJobs as any[] ?? [])) {
      if (!['confirmed', 'in_progress', 'completed'].includes(job.status)) continue;
      const price = parseFloat(job.totalPrice ?? job.price ?? '0');
      const upsell = parseFloat(job.upsellTotal ?? job.upsellAmt ?? '0');
      const discount = parseFloat(job.discountAmount ?? job.discount ?? '0');
      const rev = Math.max(0, price + upsell - discount);
      const assignedTo = job.assignedTo ?? '';
      const emp = empList.find((e: any) =>
        e.employeeId === assignedTo ||
        e.fullName === assignedTo ||
        (e.fullName ?? '').split(' ')[0] === assignedTo
      );
      const empId = emp?.employeeId ?? assignedTo;
      if (!empId) continue;
      map[empId] = (map[empId] ?? 0) + rev;
    }
    return map;
  }, [prevPeriodJobs, detailers]);

  // Build detailer list from records + employee list
  const detailerOptions = useMemo(() => {
    const fromRecords: Record<string, string> = {};
    for (const r of records) {
      if (r.employeeId && r.fullName) fromRecords[r.employeeId] = r.fullName;
    }
    const fromEmployees: Record<string, string> = {};
    for (const e of (detailers as any[] ?? [])) {
      if (e.employeeId) fromEmployees[e.employeeId] = e.fullName ?? e.employeeId;
    }
    const merged = { ...fromEmployees, ...fromRecords };
    return Object.entries(merged).map(([id, name]) => ({ id, name: name as string })).sort((a, b) => a.name.localeCompare(b.name));
  }, [records, detailers]);

  // Aggregate metrics for selected detailer or team
  const metrics = useMemo(() => {
    const filtered = selectedDetailer === "__team__"
      ? records
      : records.filter((r: any) => r.employeeId === selectedDetailer);

    if (filtered.length === 0) return null;

    // Per-detailer averages for team efficiency
    const byDetailer: Record<string, number[]> = {};
    let totalRevenue = 0;
    let totalHours = 0;
    let totalUpsells = 0;
    let totalTips = 0;
    let recordCount = 0;

    // Collect unique employeeIds from records
    const empIds = [...new Set(filtered.map((r: any) => r.employeeId).filter(Boolean))];
    for (const empId of empIds) {
      // Revenue comes from schedule_jobs (matches Dashboard) — tips excluded
      const jobRev = jobRevenueMap[empId];
      const rev = jobRev?.revenue ?? 0;
      const ups = jobRev?.upsells ?? 0;
      const tips = jobRev?.tips ?? 0;
      // Hours: use live elapsed if currently clocked in (Today view), else use timesheet clock-in/out totals
      const timesheetHrs = timesheetHoursMap[empId] ?? 0;
      const hrs = liveHoursMap[empId] ?? timesheetHrs;

      totalRevenue += rev;
      totalHours += hrs;
      totalUpsells += ups;
      totalTips += tips;
      recordCount++;

      // Compute efficiency from live hours + revenue (tips never counted)
      const effectiveEff = rev > 0 && hrs > 0 ? (rev / hrs) : 0;
      if (effectiveEff > 0.01) {
        if (!byDetailer[empId]) byDetailer[empId] = [];
        byDetailer[empId].push(effectiveEff);
      }
    }

    // Team efficiency = average of each detailer's average
    const detailerAvgs = Object.values(byDetailer).map(scores => scores.reduce((a, b) => a + b, 0) / scores.length);
    const avgEfficiency = detailerAvgs.length > 0
      ? detailerAvgs.reduce((a, b) => a + b, 0) / detailerAvgs.length
      : null;

    const revenuePerHour = totalHours > 0 ? totalRevenue / totalHours : 0;

    return {
      avgEfficiency,
      totalRevenue,
      totalHours,
      totalUpsells,
      totalTips,
      revenuePerHour,
      recordCount,
      detailersWithData: detailerAvgs.length,
    };
  }, [records, selectedDetailer, liveHoursMap, jobRevenueMap, timesheetHoursMap]);

  // Previous period metrics for trend (uses prevJobRevenueMap for revenue)
  const prevMetrics = useMemo(() => {
    const prevRecords = (prevPerfRecords as any[] ?? []);
    const filtered = selectedDetailer === "__team__"
      ? prevRecords
      : prevRecords.filter((r: any) => r.employeeId === selectedDetailer);
    if (filtered.length === 0) return null;
    const byDetailer: Record<string, number[]> = {};
    const empIds = [...new Set(filtered.map((r: any) => r.employeeId).filter(Boolean))];
    for (const empId of empIds) {
      const rev = prevJobRevenueMap[empId] ?? 0;
      const hrs = prevTimesheetHoursMap[empId] ?? 0;
      const effectiveEff = rev > 0 && hrs > 0 ? (rev / hrs) : 0;
      if (effectiveEff > 0.01) {
        if (!byDetailer[empId]) byDetailer[empId] = [];
        byDetailer[empId].push(effectiveEff);
      }
    }
    const detailerAvgs = Object.values(byDetailer).map(scores => scores.reduce((a, b) => a + b, 0) / scores.length);
    const avgEfficiency = detailerAvgs.length > 0
      ? detailerAvgs.reduce((a, b) => a + b, 0) / detailerAvgs.length
      : null;
    return { avgEfficiency };
  }, [prevPerfRecords, selectedDetailer, prevJobRevenueMap, prevTimesheetHoursMap]);

  // Per-detailer breakdown for team view (revenue from schedule_jobs, hours from clock-in)
  const teamBreakdown = useMemo(() => {
    if (selectedDetailer !== "__team__") return [];
    // Get unique detailers from performance records
    const empMap: Record<string, string> = {};
    for (const r of records) {
      if (r.employeeId && !empMap[r.employeeId]) empMap[r.employeeId] = r.fullName ?? r.employeeId;
    }
    return Object.entries(empMap).map(([empId, name]) => {
      // Revenue from schedule_jobs (matches Dashboard, tips excluded)
      const jobRev = jobRevenueMap[empId];
      const revenue = jobRev?.revenue ?? 0;
      const upsells = jobRev?.upsells ?? 0;
      const tips = jobRev?.tips ?? 0;
      // Hours: live if clocked in (Today view), else use timesheet clock-in/out totals
      const timesheetHrs = timesheetHoursMap[empId] ?? 0;
      const hours = liveHoursMap[empId] ?? timesheetHrs;
      const avgEff = revenue > 0 && hours > 0 ? (revenue / hours) : null;
      // Flag detailers who have revenue (jobs assigned today) but no clock-in at all
      const isLiveClocked = empId in liveHoursMap;
      const noClockIn = period === 'day' && revenue > 0 && hours === 0 && !isLiveClocked;
      return { name, revenue, hours, upsells, tips, avgEff, scores: avgEff ? [avgEff] : [], noClockIn };
    }).sort((a, b) => (b.avgEff ?? -1) - (a.avgEff ?? -1));
  }, [records, selectedDetailer, liveHoursMap, jobRevenueMap, timesheetHoursMap]);

  const selectedName = selectedDetailer === "__team__"
    ? "Team Overview"
    : detailerOptions.find(d => d.id === selectedDetailer)?.name ?? "Unknown";

  const PERIODS: { key: Period; label: string }[] = [
    { key: "day", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
  ];

  return (
    <ScreenContainer edges={["left", "right"]} className="px-5">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={{ marginTop: 8, marginBottom: 20, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
          <View>
            <Text style={{ fontSize: 14, color: colors.muted }}>Admin</Text>
            <Text style={{ fontSize: 28, fontWeight: "800", color: colors.foreground }}>Efficiency</Text>
          </View>
          <TouchableOpacity
            onPress={handleResync}
            disabled={isSyncing}
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 6, opacity: isSyncing ? 0.5 : 1 }}
          >
            <Text style={{ fontSize: 13 }}>{isSyncing ? "⏳" : "🔄"}</Text>
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>{isSyncing ? "Syncing..." : "Recalculate"}</Text>
          </TouchableOpacity>
        </View>

        {/* Period Filter */}
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
          {PERIODS.map(p => (
            <TouchableOpacity
              key={p.key}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setPeriod(p.key);
              }}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 10,
                alignItems: "center",
                backgroundColor: period === p.key ? colors.primary : colors.surface,
                borderWidth: 1,
                borderColor: period === p.key ? colors.primary : colors.border,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: "700", color: period === p.key ? "#fff" : colors.muted }}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Detailer Dropdown */}
        <View style={{ marginBottom: 20 }}>
          <TouchableOpacity
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowDropdown(v => !v);
            }}
            style={{
              backgroundColor: colors.surface,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 16,
              paddingVertical: 14,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>{selectedName}</Text>
            <Text style={{ fontSize: 14, color: colors.muted }}>{showDropdown ? "▲" : "▼"}</Text>
          </TouchableOpacity>
          {showDropdown && (
            <View style={{
              backgroundColor: colors.surface,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              marginTop: 4,
              overflow: "hidden",
            }}>
              {[{ id: "__team__", name: "Team Overview" }, ...detailerOptions].map((d, idx, arr) => (
                <TouchableOpacity
                  key={d.id}
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedDetailer(d.id);
                    setShowDropdown(false);
                  }}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderBottomWidth: idx < arr.length - 1 ? 1 : 0,
                    borderBottomColor: colors.border,
                    backgroundColor: selectedDetailer === d.id ? colors.primary + "15" : "transparent",
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: selectedDetailer === d.id ? "700" : "400", color: selectedDetailer === d.id ? colors.primary : colors.foreground }}>
                    {d.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {isLoading ? (
          <View style={{ alignItems: "center", paddingVertical: 40 }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.muted, marginTop: 12 }}>Loading efficiency data...</Text>
          </View>
        ) : metrics === null ? (
          <View style={{ alignItems: "center", paddingVertical: 40, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 32 }}>⚡</Text>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.muted, marginTop: 12 }}>No data for this period</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center", paddingHorizontal: 20 }}>
              Efficiency data appears after EOD reviews are submitted
            </Text>
          </View>
        ) : (
          <>
            {/* Efficiency Score Hero */}
            <View style={{
              backgroundColor: getEffColor(metrics.avgEfficiency, colors) + "18",
              borderRadius: 20,
              padding: 24,
              borderWidth: 2,
              borderColor: getEffColor(metrics.avgEfficiency, colors) + "60",
              marginBottom: 16,
              alignItems: "center",
            }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
                {selectedDetailer === "__team__" ? "Team Efficiency Score" : "Efficiency Score"}
              </Text>
              {metrics.avgEfficiency !== null ? (
                <>
                  <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4 }}>
                    <Text style={{ fontSize: 64, fontWeight: "900", color: getEffColor(metrics.avgEfficiency, colors), lineHeight: 72 }}>
                      {metrics.avgEfficiency.toFixed(1)}
                    </Text>
                    <Text style={{ fontSize: 28, fontWeight: "700", color: getEffColor(metrics.avgEfficiency, colors), marginBottom: 12 }}>%</Text>
                  </View>
                  <View style={{ backgroundColor: getEffColor(metrics.avgEfficiency, colors) + "30", paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, marginTop: 8 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: getEffColor(metrics.avgEfficiency, colors) }}>
                      {getEffLabel(metrics.avgEfficiency)}
                    </Text>
                  </View>
                  {selectedDetailer === "__team__" && (
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 10 }}>
                      Average of {metrics.detailersWithData} detailer{metrics.detailersWithData !== 1 ? "s" : ""} with data
                    </Text>
                  )}
                  {/* Trend vs previous period */}
                  {metrics.avgEfficiency !== null && prevMetrics?.avgEfficiency !== null && prevMetrics?.avgEfficiency !== undefined && (() => {
                    const delta = metrics.avgEfficiency - prevMetrics.avgEfficiency;
                    const absDelta = Math.abs(delta);
                    const isUp = delta > 0.05;
                    const isDown = delta < -0.05;
                    const periodLabel = period === "day" ? "yesterday" : period === "week" ? "last week" : "last month";
                    const trendColor = isUp ? "#22C55E" : isDown ? "#EF4444" : colors.muted;
                    const arrow = isUp ? "↑" : isDown ? "↓" : "→";
                    return (
                      <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: trendColor + "20", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 }}>
                        <Text style={{ fontSize: 16, color: trendColor, fontWeight: "800" }}>{arrow}</Text>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: trendColor }}>
                          {absDelta < 0.05 ? "No change" : `${absDelta.toFixed(1)}% ${isUp ? "up" : "down"}`} vs {periodLabel}
                        </Text>
                      </View>
                    );
                  })()}
                </>
              ) : (
                <Text style={{ fontSize: 16, color: colors.muted, marginTop: 8 }}>No efficiency score available</Text>
              )}
            </View>

            {/* Performance Metrics Grid */}
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
              Performance Metrics
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
              <MetricCard label="Revenue" value={`$${metrics.totalRevenue.toFixed(0)}`} />
              <MetricCard label="Hours Worked" value={`${metrics.totalHours.toFixed(1)} hrs`} />
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
              <MetricCard
                label="Upsells"
                value={`$${metrics.totalUpsells.toFixed(0)}`}
                sub={metrics.totalRevenue > 0 ? `${((metrics.totalUpsells / metrics.totalRevenue) * 100).toFixed(0)}% of revenue` : undefined}
              />
              <MetricCard label="Tips" value={`$${metrics.totalTips.toFixed(0)}`} />
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
              <MetricCard
                label="Revenue / Hour"
                value={`$${metrics.revenuePerHour.toFixed(0)}`}
                sub="efficiency rate"
              />
              <MetricCard
                label="Days Tracked"
                value={`${daysElapsed}`}
                sub={selectedDetailer === "__team__" ? "across all detailers" : "this period"}
              />
            </View>

            {/* Team Breakdown (only in team view) */}
            {selectedDetailer === "__team__" && teamBreakdown.length > 0 && (
              <>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>
                  Team Member Breakdown
                </Text>
                <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden", marginBottom: 24 }}>
                  {teamBreakdown.map((d, idx) => (
                    <TouchableOpacity
                      key={d.name}
                      onPress={() => {
                        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        const found = detailerOptions.find(o => o.name === d.name);
                        if (found) setSelectedDetailer(found.id);
                      }}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        borderBottomWidth: idx < teamBreakdown.length - 1 ? 1 : 0,
                        borderBottomColor: colors.border,
                      }}
                    >
                      {/* Rank */}
                      <View style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        backgroundColor: getEffColor(d.avgEff, colors) + "20",
                        alignItems: "center",
                        justifyContent: "center",
                        marginRight: 12,
                      }}>
                        <Text style={{ fontSize: 13, fontWeight: "800", color: getEffColor(d.avgEff, colors) }}>{idx + 1}</Text>
                      </View>

                      {/* Name + label */}
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{d.name}</Text>
                          {d.noClockIn && (
                            <View style={{ backgroundColor: "#F59E0B20", borderWidth: 1, borderColor: "#F59E0B60", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 9, fontWeight: "800", color: "#F59E0B", letterSpacing: 0.3 }}>NO CLOCK-IN</Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
                          ${d.revenue.toFixed(0)} rev · {d.hours.toFixed(1)} hrs
                        </Text>
                      </View>

                      {/* Score */}
                      {d.avgEff !== null ? (
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ fontSize: 18, fontWeight: "900", color: getEffColor(d.avgEff, colors) }}>
                            {d.avgEff.toFixed(1)}%
                          </Text>
                          <Text style={{ fontSize: 10, color: getEffColor(d.avgEff, colors), fontWeight: "600" }}>
                            {getEffLabel(d.avgEff)}
                          </Text>
                        </View>
                      ) : (
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ fontSize: 12, color: colors.muted }}>No score</Text>
                          {d.noClockIn && (
                            <Text style={{ fontSize: 10, color: "#F59E0B", fontWeight: "600", marginTop: 2 }}>⚠ No clock-in</Text>
                          )}
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
