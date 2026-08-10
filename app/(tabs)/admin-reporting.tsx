/**
 * Admin Reporting Screen
 * - Date range picker: Today / This Week / This Month / Last Month / Custom
 * - Location filter: All / Crestview / Niceville / Destin / FWB / Pensacola
 * - Revenue summary cards (total revenue, avg per job, tips, upsells)
 * - Time on job metrics (avg hours, total hours)
 * - Package breakdown table (jobs, revenue, avg hours per package)
 * - Team member performance table (jobs, revenue, tips, avg hours)
 * - Daily revenue trend bar chart (SVG)
 */
import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  Modal,
} from "react-native";
import Svg, { Rect, Text as SvgText, G } from "react-native-svg";
import { ScreenContainer } from "@/components/screen-container";
import { CalendarPicker } from "@/components/calendar-picker";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtDec(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}
function localDateStr(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function today() { return localDateStr(); }
function weekRange() {
  const d = new Date();
  const day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - ((day + 6) % 7));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { from: localDateStr(mon), to: localDateStr(sun) };
}
function lastWeekRange() {
  const d = new Date();
  const day = d.getDay();
  // Monday of this week
  const thisMon = new Date(d); thisMon.setDate(d.getDate() - ((day + 6) % 7));
  // Sunday of last week = day before this Monday
  const lastSun = new Date(thisMon); lastSun.setDate(thisMon.getDate() - 1);
  // Monday of last week
  const lastMon = new Date(lastSun); lastMon.setDate(lastSun.getDate() - 6);
  return { from: localDateStr(lastMon), to: localDateStr(lastSun) };
}
function monthRange(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  const y = d.getFullYear(), m = d.getMonth();
  const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const last = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}
function formatMins(mins: number) {
  if (mins === 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
function formatHours(h: number) {
  if (h === 0) return "0h";
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

// ─── Date Range Presets ────────────────────────────────────────────────────────
type RangeKey = "today" | "week" | "last_week" | "month" | "last_month" | "custom";
const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today",      label: "Today" },
  { key: "week",       label: "This Week" },
  { key: "last_week",  label: "Last Week" },
  { key: "month",      label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "custom",     label: "Custom" },
];
function getRange(key: RangeKey, customFrom?: string, customTo?: string): { from: string; to: string } {
  switch (key) {
    case "today":      return { from: today(), to: today() };
    case "week":       return weekRange();
    case "last_week":  return lastWeekRange();
    case "month":      return monthRange(0);
    case "last_month": return monthRange(-1);
    case "custom":     return { from: customFrom ?? today(), to: customTo ?? today() };
  }
}

// ─── Location Options ─────────────────────────────────────────────────────────
const LOCATION_OPTIONS = [
  { slug: "",           label: "All Locations" },
  { slug: "crestview",  label: "Crestview" },
  { slug: "niceville",  label: "Niceville" },
  { slug: "destin",     label: "Destin" },
  { slug: "fwb",        label: "Fort Walton Beach" },
  { slug: "pensacola",  label: "Pensacola" },
];

// ─── Bar Chart ────────────────────────────────────────────────────────────────
function RevenueBarChart({ data, colors }: { data: { date: string; revenue: number; jobs: number }[]; colors: any }) {
  const screenWidth = Dimensions.get("window").width;
  const chartWidth = screenWidth - 48;
  const chartHeight = 120;
  const barPad = 4;
  const labelH = 20;
  const plotH = chartHeight - labelH;

  if (!data || data.length === 0) {
    return (
      <View style={{ height: chartHeight, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>No data for this period</Text>
      </View>
    );
  }

  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);
  const barWidth = Math.max(4, (chartWidth - barPad * (data.length + 1)) / data.length);

  return (
    <Svg width={chartWidth} height={chartHeight}>
      {data.map((d, i) => {
        const barH = Math.max(2, (d.revenue / maxRevenue) * plotH);
        const x = barPad + i * (barWidth + barPad);
        const y = plotH - barH;
        const isToday = d.date === today();
        return (
          <G key={d.date}>
            <Rect
              x={x}
              y={y}
              width={barWidth}
              height={barH}
              rx={3}
              fill={isToday ? colors.primary : colors.primary + "88"}
            />
            {data.length <= 14 && (
              <SvgText
                x={x + barWidth / 2}
                y={chartHeight - 4}
                fontSize={9}
                fill={colors.muted}
                textAnchor="middle"
              >
                {d.date.slice(5)}
              </SvgText>
            )}
          </G>
        );
      })}
    </Svg>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent, colors }: {
  label: string; value: string; sub?: string; accent?: boolean; colors: any;
}) {
  return (
    <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: accent ? colors.primary : colors.foreground }]}>{value}</Text>
      {sub ? <Text style={[styles.statSub, { color: colors.muted }]}>{sub}</Text> : null}
    </View>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ title, colors }: { title: string; colors: any }) {
  return (
    <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminReportingScreen() {
  const colors = useColors();
  const [rangeKey, setRangeKey] = useState<RangeKey>("week");
  const [locationSlug, setLocationSlug] = useState("");
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [customFrom, setCustomFrom] = useState<string | undefined>(undefined);
  const [customTo, setCustomTo] = useState<string | undefined>(undefined);
  // For two-step calendar selection: first tap = start, second tap = end
  const [customStep, setCustomStep] = useState<"from" | "to">("from");

  const range = useMemo(() => getRange(rangeKey, customFrom, customTo), [rangeKey, customFrom, customTo]);
  const locationLabel = LOCATION_OPTIONS.find((o) => o.slug === locationSlug)?.label ?? "All Locations";

  // ── tRPC Queries ────────────────────────────────────────────────────────────
  const summaryQ = trpc.reporting.getSummary.useQuery(
    { startDate: range.from, endDate: range.to, location: locationSlug || undefined },
    { staleTime: 60_000 }
  );
  const packageQ = trpc.reporting.getPackageBreakdown.useQuery(
    { startDate: range.from, endDate: range.to, location: locationSlug || undefined },
    { staleTime: 60_000 }
  );
  const detailerQ = trpc.reporting.getDetailerStats.useQuery(
    { startDate: range.from, endDate: range.to, location: locationSlug || undefined },
    { staleTime: 60_000 }
  );
  const trendQ = trpc.reporting.getDailyTrend.useQuery(
    { startDate: range.from, endDate: range.to, location: locationSlug || undefined },
    { staleTime: 60_000 }
  );
  const driveTimeQ = trpc.reporting.getDriveTimeStats.useQuery(
    { startDate: range.from, endDate: range.to, location: locationSlug || undefined },
    { staleTime: 60_000 }
  );
  // Only fetch city breakdown when All Locations is selected
  const cityBreakdownQ = trpc.reporting.getCityBreakdown.useQuery(
    { startDate: range.from, endDate: range.to },
    { staleTime: 60_000, enabled: !locationSlug }
  );
  // Booked Revenue — queries by job creation date
  const bookedQ = trpc.reporting.getBookedRevenue.useQuery(
    { startDate: range.from, endDate: range.to, location: locationSlug || undefined },
    { staleTime: 60_000 }
  );
  // Portal analytics — all-time, not date-range filtered
  const portalStatsQ = trpc.portalInbox.getStats.useQuery(undefined, { staleTime: 60_000 });
  const ps = portalStatsQ.data;
  // Customer activity analytics — admin-only, all-time
  const activityQ = trpc.customerActivity.getActivityStats.useQuery(undefined, { staleTime: 120_000 });
  const act = activityQ.data;
  // Abandoned cart analytics — admin-only, all-time
  const cartQ = trpc.abandonedCarts.getStats.useQuery(undefined, { staleTime: 120_000 });
  const cartData = cartQ.data;

  const isLoading = summaryQ.isLoading || packageQ.isLoading || detailerQ.isLoading || trendQ.isLoading || driveTimeQ.isLoading;
  const s = summaryQ.data;
  const packages = packageQ.data ?? [];
  const detailers = detailerQ.data ?? [];
  const trend = trendQ.data ?? [];
  const driveData = driveTimeQ.data;
  const cityBreakdown = cityBreakdownQ.data ?? [];
  const booked = bookedQ.data;

  return (
    <ScreenContainer edges={["left", "right"]} containerClassName="bg-background">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* ── Header ── */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Reporting</Text>
        </View>

        {/* ── Date Range Tabs ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {RANGE_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              onPress={() => {
                if (opt.key === "custom") {
                  // Reset custom selection and open picker
                  setCustomFrom(undefined);
                  setCustomTo(undefined);
                  setCustomStep("from");
                  setShowCustomPicker(true);
                  setRangeKey("custom");
                } else {
                  setRangeKey(opt.key);
                }
              }}
              style={[
                styles.tab,
                { backgroundColor: rangeKey === opt.key ? colors.primary : colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.tabText, { color: rangeKey === opt.key ? "#fff" : colors.foreground }]}>
                {opt.key === "custom" && customFrom ? `${customFrom}${customTo ? " → " + customTo : ""}` : opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Custom Date Range Modal ── */}
        <Modal visible={showCustomPicker} transparent animationType="slide" onRequestClose={() => setShowCustomPicker(false)}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
            <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40 }}>
              {/* Header */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 17 }}>Custom Date Range</Text>
                <TouchableOpacity onPress={() => setShowCustomPicker(false)}>
                  <Text style={{ color: colors.primary, fontSize: 16 }}>Done</Text>
                </TouchableOpacity>
              </View>
              {/* Step indicator */}
              <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 }}>
                <View style={{ flex: 1, padding: 10, borderRadius: 10, borderWidth: 2, borderColor: customStep === "from" ? colors.primary : colors.border, backgroundColor: customFrom ? colors.primary + "22" : colors.surface, alignItems: "center" }}>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>START DATE</Text>
                  <Text style={{ color: customFrom ? colors.primary : colors.muted, fontWeight: "700", fontSize: 14 }}>{customFrom ?? "Tap to select"}</Text>
                </View>
                <View style={{ flex: 1, padding: 10, borderRadius: 10, borderWidth: 2, borderColor: customStep === "to" ? colors.primary : colors.border, backgroundColor: customTo ? colors.primary + "22" : colors.surface, alignItems: "center" }}>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>END DATE</Text>
                  <Text style={{ color: customTo ? colors.primary : colors.muted, fontWeight: "700", fontSize: 14 }}>{customTo ?? "Tap to select"}</Text>
                </View>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center", marginBottom: 8 }}>
                {customStep === "from" ? "Select start date" : "Select end date"}
              </Text>
              {/* Calendar */}
              <CalendarPicker
                selectedDate={customStep === "from" ? customFrom : customTo}
                rangeStart={customFrom}
                rangeEnd={customTo}
                onSelectDate={(dateStr) => {
                  if (customStep === "from") {
                    setCustomFrom(dateStr);
                    setCustomTo(undefined);
                    setCustomStep("to");
                  } else {
                    // Ensure end >= start
                    if (customFrom && dateStr < customFrom) {
                      setCustomFrom(dateStr);
                      setCustomTo(customFrom);
                    } else {
                      setCustomTo(dateStr);
                    }
                    setCustomStep("from");
                    // Auto-close when both dates selected
                    setShowCustomPicker(false);
                  }
                }}
              />
            </View>
          </View>
        </Modal>

        {/* ── Location Filter ── */}
        <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
          <TouchableOpacity
            onPress={() => setShowLocationPicker(!showLocationPicker)}
            style={[styles.locationBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.locationBtnText, { color: colors.foreground }]}>📍 {locationLabel}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{showLocationPicker ? "▲" : "▼"}</Text>
          </TouchableOpacity>
          {showLocationPicker && (
            <View style={[styles.locationDropdown, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {LOCATION_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.slug}
                  onPress={() => { setLocationSlug(opt.slug); setShowLocationPicker(false); }}
                  style={[styles.locationOption, { borderBottomColor: colors.border }]}
                >
                  <Text style={[styles.locationOptionText, {
                    color: locationSlug === opt.slug ? colors.primary : colors.foreground,
                    fontWeight: locationSlug === opt.slug ? "700" : "400",
                  }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* ── Date Range Label ── */}
        <Text style={[styles.rangeLabel, { color: colors.muted }]}>
          {range.from === range.to ? range.from : `${range.from}  →  ${range.to}`}
        </Text>

        {isLoading ? (
          <View style={{ padding: 40, alignItems: "center" }}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{ color: colors.muted, marginTop: 12 }}>Loading report...</Text>
          </View>
        ) : (
          <>
            {/* ── Revenue Summary Cards ── */}
            <SectionHeader title="Revenue Summary" colors={colors} />
            <View style={styles.cardGrid}>
              <StatCard label="Total Revenue" value={fmt(s?.totalRevenue ?? 0)} accent colors={colors} />
              <StatCard label="Avg / Job" value={fmtDec(s?.avgRevenuePerJob ?? 0)} colors={colors} />
              <StatCard label="Tips" value={fmt(s?.totalTips ?? 0)} colors={colors} />
              <StatCard label="Upsells" value={fmt(s?.totalUpsells ?? 0)} colors={colors} />
            </View>

            {/* ── Job Count Cards ── */}
            <SectionHeader title="Job Activity" colors={colors} />
            <View style={styles.cardGrid}>
              <StatCard label="Total Jobs" value={String(s?.totalJobs ?? 0)} colors={colors} />
              <StatCard label="Completed" value={String(s?.completedJobs ?? 0)} colors={colors} />
              <StatCard label="Avg Hours / Job" value={formatHours(s?.avgJobHours ?? 0)} colors={colors} />
              <StatCard label="Total Hours" value={formatHours(s?.totalJobHours ?? 0)} colors={colors} />
            </View>

            {/* ── Daily Revenue Trend ── */}
            {trend.length > 1 && (
              <>
                <SectionHeader title="Daily Revenue Trend" colors={colors} />
                <View style={[styles.chartContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <RevenueBarChart data={trend} colors={colors} />
                  <View style={styles.chartLegend}>
                    <Text style={[styles.chartLegendText, { color: colors.muted }]}>
                      Peak: {fmt(Math.max(...trend.map((d) => d.revenue)))} on{" "}
                      {trend.reduce((a, b) => (a.revenue > b.revenue ? a : b)).date}
                    </Text>
                  </View>
                </View>
              </>
            )}

            {/* ── Package Breakdown ── */}
            {packages.length > 0 && (
              <>
                <SectionHeader title="Detail Times by Package" colors={colors} />
                <View style={[styles.tableContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  {/* Header Row */}
                  <View style={[styles.tableRow, styles.tableHeaderRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.tableHeaderCell, { color: colors.muted, flex: 2 }]}>Package</Text>
                    <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Jobs</Text>
                    <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Revenue</Text>
                    <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Avg Time</Text>
                  </View>
                  {packages.map((pkg, i) => (
                    <View
                      key={pkg.packageType}
                      style={[
                        styles.tableRow,
                        { borderBottomColor: colors.border, borderBottomWidth: i < packages.length - 1 ? 1 : 0 },
                      ]}
                    >
                      <Text style={[styles.tableCell, { color: colors.foreground, flex: 2, fontWeight: "600" }]} numberOfLines={2}>
                        {pkg.packageType}
                      </Text>
                      <Text style={[styles.tableCell, { color: colors.foreground }]}>{pkg.jobCount}</Text>
                      <Text style={[styles.tableCell, { color: colors.success ?? "#00B341" }]}>{fmt(pkg.totalRevenue)}</Text>
                      <Text style={[styles.tableCell, { color: colors.muted }]}>{formatHours(pkg.avgHours)}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* ── Team Member Performance ── */}
            {detailers.length > 0 && (
              <>
                <SectionHeader title="Team Member Performance" colors={colors} />
                <View style={[styles.tableContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  {/* Header Row */}
                  <View style={[styles.tableRow, styles.tableHeaderRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.tableHeaderCell, { color: colors.muted, flex: 2 }]}>Team Member</Text>
                    <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Jobs</Text>
                    <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Revenue</Text>
                    <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Avg/Job</Text>
                    <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Avg Hrs</Text>
                  </View>
                  {detailers.map((det, i) => (
                    <View
                      key={det.detailer}
                      style={[
                        styles.tableRow,
                        { borderBottomColor: colors.border, borderBottomWidth: i < detailers.length - 1 ? 1 : 0 },
                      ]}
                    >
                      <Text style={[styles.tableCell, { color: colors.foreground, flex: 2, fontWeight: "600" }]} numberOfLines={1}>
                        {det.detailer}
                      </Text>
                      <Text style={[styles.tableCell, { color: colors.foreground }]}>{det.jobCount}</Text>
                      <Text style={[styles.tableCell, { color: colors.success ?? "#00B341" }]}>{fmt(det.totalRevenue)}</Text>
                      <Text style={[styles.tableCell, { color: colors.muted }]}>{fmt(det.avgRevenuePerJob)}</Text>
                      <Text style={[styles.tableCell, { color: colors.muted }]}>{formatHours(det.avgHoursPerJob)}</Text>
                    </View>
                  ))}
                  {/* Totals Row */}
                  <View style={[styles.tableRow, styles.totalRow, { borderTopColor: colors.border }]}>
                    <Text style={[styles.tableCell, { color: colors.foreground, flex: 2, fontWeight: "700" }]}>TOTAL</Text>
                    <Text style={[styles.tableCell, { color: colors.foreground, fontWeight: "700" }]}>
                      {detailers.reduce((a, b) => a + b.jobCount, 0)}
                    </Text>
                    <Text style={[styles.tableCell, { color: colors.primary, fontWeight: "700" }]}>
                      {fmt(detailers.reduce((a, b) => a + b.totalRevenue, 0))}
                    </Text>
                    <Text style={[styles.tableCell, { color: colors.muted }]}>—</Text>
                    <Text style={[styles.tableCell, { color: colors.muted }]}>—</Text>
                  </View>
                </View>

                {/* Tips breakdown */}
                {detailers.some((d) => d.totalTips > 0) && (
                  <View style={[styles.tipsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.tipsTitle, { color: colors.foreground }]}>Tips Breakdown</Text>
                    {detailers.filter((d) => d.totalTips > 0).map((det) => (
                      <View key={det.detailer} style={styles.tipsRow}>
                        <Text style={[styles.tipsName, { color: colors.foreground }]}>{det.detailer}</Text>
                        <Text style={[styles.tipsAmount, { color: colors.warning ?? "#FF9500" }]}>{fmtDec(det.totalTips)}</Text>
                      </View>
                    ))}
                    <View style={[styles.tipsTotalRow, { borderTopColor: colors.border }]}>
                      <Text style={[styles.tipsName, { color: colors.foreground, fontWeight: "700" }]}>Total Tips</Text>
                      <Text style={[styles.tipsAmount, { color: colors.primary, fontWeight: "700" }]}>
                        {fmtDec(detailers.reduce((a, b) => a + b.totalTips, 0))}
                      </Text>
                    </View>
                  </View>
                )}
              </>
            )}

            {/* ── Drive Time Report ── */}
            {(driveData?.totalJobsWithDriveData ?? 0) > 0 ? (
              <>
                <SectionHeader title="Drive Time Report" colors={colors} />
                {/* Summary card */}
                <View style={[styles.tableContainer, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 8 }]}>
                  <View style={{ padding: 14 }}>
                    <Text style={[styles.statLabel, { color: colors.muted }]}>AVG DRIVE TIME (ALL JOBS)</Text>
                    <Text style={[styles.statValue, { color: colors.primary }]}>{formatMins(driveData!.avgDriveMinutes)}</Text>
                    <Text style={[styles.statSub, { color: colors.muted }]}>{driveData!.totalJobsWithDriveData} jobs with drive data</Text>
                  </View>
                </View>
                {/* By Detailer */}
                {driveData!.byDetailer.length > 0 && (
                  <View style={[styles.tableContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={[styles.tableRow, styles.tableHeaderRow, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted, flex: 2, textAlign: "left" }]}>Team Member</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Jobs</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Avg Drive</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Total Drive</Text>
                    </View>
                    {driveData!.byDetailer.map((d, i) => (
                      <View key={d.detailer} style={[styles.tableRow, { borderBottomColor: colors.border, borderBottomWidth: i < driveData!.byDetailer.length - 1 ? 1 : 0 }]}>
                        <Text style={[styles.tableCell, { color: colors.foreground, flex: 2, fontWeight: "600", textAlign: "left" }]} numberOfLines={1}>{d.detailer}</Text>
                        <Text style={[styles.tableCell, { color: colors.foreground }]}>{d.jobCount}</Text>
                        <Text style={[styles.tableCell, { color: colors.primary }]}>{formatMins(d.avgDriveMinutes)}</Text>
                        <Text style={[styles.tableCell, { color: colors.muted }]}>{formatMins(d.totalDriveMinutes)}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {/* By Location */}
                {driveData!.byLocation.length > 1 && (
                  <View style={[styles.tableContainer, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 8 }]}>
                    <View style={[styles.tableRow, styles.tableHeaderRow, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted, flex: 2, textAlign: "left" }]}>Location</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Jobs</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Avg Drive</Text>
                    </View>
                    {driveData!.byLocation.map((d, i) => (
                      <View key={d.location} style={[styles.tableRow, { borderBottomColor: colors.border, borderBottomWidth: i < driveData!.byLocation.length - 1 ? 1 : 0 }]}>
                        <Text style={[styles.tableCell, { color: colors.foreground, flex: 2, fontWeight: "600", textAlign: "left" }]} numberOfLines={1}>{d.location}</Text>
                        <Text style={[styles.tableCell, { color: colors.foreground }]}>{d.jobCount}</Text>
                        <Text style={[styles.tableCell, { color: colors.primary }]}>{formatMins(d.avgDriveMinutes)}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : (
              !isLoading && (s?.totalJobs ?? 0) > 0 && (
                <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                  <SectionHeader title="Drive Time Report" colors={colors} />
                  <View style={[styles.tableContainer, { backgroundColor: colors.surface, borderColor: colors.border, padding: 16 }]}>
                    <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center" }}>
                      Drive time data will appear here once team members start using the On My Way button.
                    </Text>
                  </View>
                </View>
              )
            )}

            {/* ── Performance by City (All Locations only) ── */}
            {!locationSlug && cityBreakdown.length > 1 && (
              <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                <SectionHeader title="Performance by City" colors={colors} />
                {/* Bar chart: revenue per city */}
                {(() => {
                  const maxRev = Math.max(...cityBreakdown.map(c => c.totalRevenue), 1);
                  return (
                    <View style={[styles.tableContainer, { backgroundColor: colors.surface, borderColor: colors.border, padding: 16, marginBottom: 8 }]}>
                      {cityBreakdown.map((c) => (
                        <View key={c.city} style={{ marginBottom: 14 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                            <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 13 }}>{c.city}</Text>
                            <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>${c.totalRevenue.toLocaleString()}</Text>
                          </View>
                          <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" }}>
                            <View style={{ height: 8, width: `${Math.round((c.totalRevenue / maxRev) * 100)}%` as any, backgroundColor: colors.primary, borderRadius: 4 }} />
                          </View>
                          <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
                            <Text style={{ color: colors.muted, fontSize: 11 }}>{c.jobCount} jobs</Text>
                            <Text style={{ color: colors.muted, fontSize: 11 }}>Avg ${c.avgRevenuePerJob}/job</Text>
                            {c.totalTips > 0 && <Text style={{ color: colors.muted, fontSize: 11 }}>Tips ${c.totalTips}</Text>}
                          </View>
                        </View>
                      ))}
                    </View>
                  );
                })()}
                {/* Summary table */}
                <View style={[styles.tableContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={[styles.tableRow, { borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 8 }]}>
                    <Text style={[styles.tableHeaderCell, { color: colors.muted, flex: 2, textAlign: "left" }]}>CITY</Text>
                    <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>JOBS</Text>
                    <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>REVENUE</Text>
                    <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>AVG/JOB</Text>
                  </View>
                  {cityBreakdown.map((c, i) => (
                    <View key={c.city} style={[styles.tableRow, { borderBottomColor: colors.border, borderBottomWidth: i < cityBreakdown.length - 1 ? 1 : 0 }]}>
                      <Text style={[styles.tableCell, { color: colors.foreground, flex: 2, fontWeight: "600", textAlign: "left" }]} numberOfLines={1}>{c.city}</Text>
                      <Text style={[styles.tableCell, { color: colors.foreground }]}>{c.jobCount}</Text>
                      <Text style={[styles.tableCell, { color: colors.primary, fontWeight: "700" }]}>${c.totalRevenue.toLocaleString()}</Text>
                      <Text style={[styles.tableCell, { color: colors.foreground }]}>${c.avgRevenuePerJob}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* ── Booked Revenue Section ── */}
            {bookedQ.isLoading ? (
              <View style={{ paddingHorizontal: 16, paddingTop: 16, alignItems: "center" }}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : booked ? (
              <>
                {/* Section header with green accent to distinguish from service-date reporting */}
                <View style={[styles.sectionHeader, { borderBottomColor: colors.border, marginTop: 8 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ width: 4, height: 18, borderRadius: 2, backgroundColor: colors.success ?? "#22C55E" }} />
                    <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Booked Revenue</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                    Jobs booked in this period (by creation date)
                  </Text>
                </View>

                {/* Summary cards */}
                <View style={styles.cardGrid}>
                  <StatCard label="Booked Revenue" value={fmt(booked.totalRevenue)} accent colors={colors} />
                  <StatCard label="Jobs Booked" value={String(booked.totalJobs)} colors={colors} />
                  <StatCard label="Avg / Job" value={fmtDec(booked.avgRevenuePerJob)} colors={colors} />
                </View>

                {/* Daily booking trend bar chart */}
                {booked.byDay.length > 1 && (
                  <View style={[styles.chartContainer, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 8 }]}>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>Daily Booking Trend</Text>
                    <RevenueBarChart data={booked.byDay} colors={colors} />
                  </View>
                )}

                {/* By Booker (who created the job) */}
                {booked.byBooker.length > 0 && (
                  <View style={[styles.tableContainer, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 8 }]}>
                    <View style={[styles.tableRow, styles.tableHeaderRow, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted, flex: 2, textAlign: "left" }]}>Booked By</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Jobs</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Revenue</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Avg/Job</Text>
                    </View>
                    {booked.byBooker.map((b, i) => (
                      <View key={b.name} style={[styles.tableRow, { borderBottomColor: colors.border, borderBottomWidth: i < booked.byBooker.length - 1 ? 1 : 0 }]}>
                        <Text style={[styles.tableCell, { color: colors.foreground, flex: 2, fontWeight: "600", textAlign: "left" }]} numberOfLines={1}>
                          {b.name}
                        </Text>
                        <Text style={[styles.tableCell, { color: colors.foreground }]}>{b.jobs}</Text>
                        <Text style={[styles.tableCell, { color: colors.success ?? "#22C55E", fontWeight: "700" }]}>{fmt(b.revenue)}</Text>
                        <Text style={[styles.tableCell, { color: colors.muted }]}>{fmtDec(b.jobs > 0 ? b.revenue / b.jobs : 0)}</Text>
                      </View>
                    ))}
                    {/* Totals row */}
                    <View style={[styles.tableRow, styles.totalRow, { borderTopColor: colors.border }]}>
                      <Text style={[styles.tableCell, { color: colors.foreground, flex: 2, fontWeight: "700", textAlign: "left" }]}>TOTAL</Text>
                      <Text style={[styles.tableCell, { color: colors.foreground, fontWeight: "700" }]}>{booked.totalJobs}</Text>
                      <Text style={[styles.tableCell, { color: colors.primary, fontWeight: "700" }]}>{fmt(booked.totalRevenue)}</Text>
                      <Text style={[styles.tableCell, { color: colors.muted }]}>—</Text>
                    </View>
                  </View>
                )}

                {/* By Package */}
                {booked.byPackage.length > 0 && (
                  <View style={[styles.tableContainer, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 8 }]}>
                    <View style={[styles.tableRow, styles.tableHeaderRow, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted, flex: 2, textAlign: "left" }]}>Package</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Jobs</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Revenue</Text>
                    </View>
                    {booked.byPackage.map((p, i) => (
                      <View key={p.pkg} style={[styles.tableRow, { borderBottomColor: colors.border, borderBottomWidth: i < booked.byPackage.length - 1 ? 1 : 0 }]}>
                        <Text style={[styles.tableCell, { color: colors.foreground, flex: 2, fontWeight: "600", textAlign: "left" }]} numberOfLines={2}>{p.pkg}</Text>
                        <Text style={[styles.tableCell, { color: colors.foreground }]}>{p.jobs}</Text>
                        <Text style={[styles.tableCell, { color: colors.success ?? "#22C55E", fontWeight: "700" }]}>{fmt(p.revenue)}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* By City */}
                {booked.byCity.length > 1 && (
                  <View style={[styles.tableContainer, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 8 }]}>
                    <View style={[styles.tableRow, styles.tableHeaderRow, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted, flex: 2, textAlign: "left" }]}>City</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Jobs</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Revenue</Text>
                    </View>
                    {booked.byCity.map((c, i) => (
                      <View key={c.city} style={[styles.tableRow, { borderBottomColor: colors.border, borderBottomWidth: i < booked.byCity.length - 1 ? 1 : 0 }]}>
                        <Text style={[styles.tableCell, { color: colors.foreground, flex: 2, fontWeight: "600", textAlign: "left" }]} numberOfLines={1}>{c.city}</Text>
                        <Text style={[styles.tableCell, { color: colors.foreground }]}>{c.jobs}</Text>
                        <Text style={[styles.tableCell, { color: colors.success ?? "#22C55E", fontWeight: "700" }]}>{fmt(c.revenue)}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : null}

            {/* ── Portal Analytics ── */}
            {portalStatsQ.isLoading ? (
              <View style={{ paddingHorizontal: 16, paddingTop: 16, alignItems: "center" }}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : ps ? (
              <>
                <View style={[styles.sectionHeader, { borderBottomColor: colors.border, marginTop: 8 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ width: 4, height: 18, borderRadius: 2, backgroundColor: "#8B5CF6" }} />
                    <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Customer Portal</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>All-time portal activity</Text>
                </View>

                {/* User stats */}
                <View style={styles.cardGrid}>
                  <StatCard label="Registered Users" value={String(ps.registeredUsers)} colors={colors} />
                  <StatCard label="New (30 days)" value={String(ps.newUsersLast30Days)} colors={colors} />
                  <StatCard label="New (7 days)" value={String(ps.newUsersLast7Days)} colors={colors} />
                </View>

                {/* Booking stats */}
                <View style={styles.cardGrid}>
                  <StatCard label="Portal Bookings" value={String(ps.totalBookings)} accent colors={colors} />
                  <StatCard label="Completed" value={String(ps.completedBookings)} colors={colors} />
                  <StatCard label="Cancelled" value={String(ps.cancelledBookings)} colors={colors} />
                </View>

                {/* Revenue stats */}
                <View style={styles.cardGrid}>
                  <StatCard label="Total Revenue" value={fmt(ps.totalRevenue)} accent colors={colors} />
                  <StatCard label="Collected" value={fmt(ps.collectedRevenue)} colors={colors} />
                  <StatCard label="Last 30 Days" value={fmt(ps.revenueLast30Days)} colors={colors} />
                </View>

                {/* Top cities */}
                {ps.topCities.length > 0 && (
                  <View style={[styles.tableContainer, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 8 }]}>
                    <View style={[styles.tableRow, styles.tableHeaderRow, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted, flex: 2, textAlign: "left" }]}>Top Cities</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Bookings</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Revenue</Text>
                    </View>
                    {ps.topCities.map((c, i) => (
                      <View key={c.city} style={[styles.tableRow, { borderBottomColor: colors.border, borderBottomWidth: i < ps.topCities.length - 1 ? 1 : 0 }]}>
                        <Text style={[styles.tableCell, { color: colors.foreground, flex: 2, fontWeight: "600", textAlign: "left" }]} numberOfLines={1}>{c.city}</Text>
                        <Text style={[styles.tableCell, { color: colors.foreground }]}>{c.bookingCount}</Text>
                        <Text style={[styles.tableCell, { color: "#8B5CF6", fontWeight: "700" }]}>{fmt(c.revenue)}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Recent signups */}
                {ps.recentSignups.length > 0 && (
                  <View style={[styles.tableContainer, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 8 }]}>
                    <View style={[styles.tableRow, styles.tableHeaderRow, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted, flex: 2, textAlign: "left" }]}>Recent Signups</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted, flex: 1.5, textAlign: "left" }]}>City</Text>
                      <Text style={[styles.tableHeaderCell, { color: colors.muted }]}>Joined</Text>
                    </View>
                    {ps.recentSignups.map((u, i) => (
                      <View key={u.email} style={[styles.tableRow, { borderBottomColor: colors.border, borderBottomWidth: i < ps.recentSignups.length - 1 ? 1 : 0 }]}>
                        <Text style={[styles.tableCell, { color: colors.foreground, flex: 2, fontWeight: "600", textAlign: "left" }]} numberOfLines={1}>{u.name || u.email}</Text>
                        <Text style={[styles.tableCell, { color: colors.muted, flex: 1.5, textAlign: "left" }]} numberOfLines={1}>{u.city || "—"}</Text>
                        <Text style={[styles.tableCell, { color: colors.muted, fontSize: 11 }]}>{u.joinedAt ? new Date(u.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : null}

            {/* ── Empty State ── */}
            {!isLoading && (s?.totalJobs ?? 0) === 0 && (
              <View style={styles.emptyState}>
                <Text style={{ fontSize: 40 }}>📊</Text>
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Jobs Found</Text>
                <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
                  No jobs scheduled for this period{locationSlug ? ` in ${locationLabel}` : ""}.
                </Text>
              </View>
            )}
          </>
        )}

        {/* ─────────────────────────────────────────────────────────────────────────────────── */}
        {/* ── App Activity Analytics (Admin-Only) ── */}
        <View style={[styles.sectionHeader, { borderBottomColor: colors.border, marginTop: 8 }]}>
          <Text style={[styles.sectionTitle, { color: "#6366F1" }]}>📱 App Activity</Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>Who’s in your app — admin only</Text>
        </View>
        {activityQ.isLoading ? (
          <ActivityIndicator style={{ marginVertical: 24 }} color={colors.primary} />
        ) : (
          <>
            <View style={styles.cardGrid}>
              <View style={[styles.statCard, { backgroundColor: "#6366F111", borderColor: "#6366F133" }]}>
                <Text style={[styles.statLabel, { color: "#6366F1" }]}>Registered Users</Text>
                <Text style={[styles.statValue, { color: colors.foreground }]}>{act?.activeUsers ?? 0}</Text>
                <Text style={[styles.statSub, { color: colors.muted }]}>have opened the app</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: "#6366F111", borderColor: "#6366F133" }]}>
                <Text style={[styles.statLabel, { color: "#6366F1" }]}>Total Sessions</Text>
                <Text style={[styles.statValue, { color: colors.foreground }]}>{act?.totalSessions ?? 0}</Text>
                <Text style={[styles.statSub, { color: colors.muted }]}>all-time app opens</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: "#6366F111", borderColor: "#6366F133" }]}>
                <Text style={[styles.statLabel, { color: "#6366F1" }]}>Active (7 days)</Text>
                <Text style={[styles.statValue, { color: colors.foreground }]}>{act?.activeUsersLast7Days ?? 0}</Text>
                <Text style={[styles.statSub, { color: colors.muted }]}>unique users</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: "#6366F111", borderColor: "#6366F133" }]}>
                <Text style={[styles.statLabel, { color: "#6366F1" }]}>Avg Session</Text>
                <Text style={[styles.statValue, { color: colors.foreground }]}>{act?.avgSessionMinutes ?? 0}m</Text>
                <Text style={[styles.statSub, { color: colors.muted }]}>per visit</Text>
              </View>
            </View>
            {/* Top active customers */}
            {(act?.topCustomers?.length ?? 0) > 0 && (
              <View style={{ marginHorizontal: 16, marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: "#6366F133", overflow: "hidden" }}>
                <View style={{ backgroundColor: "#6366F111", paddingHorizontal: 14, paddingVertical: 10 }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#6366F1" }}>Most Active Customers</Text>
                </View>
                {act!.topCustomers.slice(0, 8).map((c, i) => (
                  <View key={c.customerId} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{c.name}</Text>
                      <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>{c.email}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 2 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: "#6366F1" }}>{c.sessionCount} sessions</Text>
                      <Text style={{ fontSize: 11, color: colors.muted }}>{c.totalMinutes}m total · last seen {c.lastSeenAt ? new Date(c.lastSeenAt).toLocaleDateString() : "never"}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
            {(act?.topCustomers?.length ?? 0) === 0 && (
              <View style={{ alignItems: "center", paddingVertical: 24 }}>
                <Text style={{ color: colors.muted, fontSize: 14 }}>No activity recorded yet — data will appear as customers use the app</Text>
              </View>
            )}
          </>
        )}

        {/* ── Abandoned Cart Analytics (Admin-Only) ── */}
        <View style={[styles.sectionHeader, { borderBottomColor: colors.border, marginTop: 16 }]}>
          <Text style={[styles.sectionTitle, { color: "#F59E0B" }]}>🛒 Abandoned Carts</Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>Portal app vs website — admin only</Text>
        </View>
        {cartQ.isLoading ? (
          <ActivityIndicator style={{ marginVertical: 24 }} color={colors.primary} />
        ) : (
          <>
            {(cartData?.bySource?.length ?? 0) === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 24 }}>
                <Text style={{ color: colors.muted, fontSize: 14 }}>No abandoned cart data yet — data will appear as customers start booking</Text>
              </View>
            ) : (
              <>
                {/* Source breakdown cards */}
                {cartData!.bySource.map((src) => (
                  <View key={src.source} style={{ marginHorizontal: 16, marginBottom: 10, borderRadius: 12, borderWidth: 1, borderColor: src.source === "portal_app" ? "#8B5CF633" : "#0EA5E933", overflow: "hidden" }}>
                    <View style={{ backgroundColor: src.source === "portal_app" || src.source === "portal" ? "#06B6D411" : "#0EA5E911", paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: src.source === "portal_app" || src.source === "portal" ? "#06B6D4" : "#0EA5E9" }}>
                        {src.source === "portal_app" ? "📱 Portal App" : src.source === "portal" ? "🔐 Portal" : "🌐 Website"}
                      </Text>
                    </View>
                    <View style={styles.cardGrid}>
                      <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <Text style={[styles.statLabel, { color: colors.muted }]}>Total Carts</Text>
                        <Text style={[styles.statValue, { color: colors.foreground }]}>{src.total}</Text>
                      </View>
                      <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <Text style={[styles.statLabel, { color: colors.muted }]}>Abandoned</Text>
                        <Text style={[styles.statValue, { color: "#F59E0B" }]}>{src.abandoned}</Text>
                      </View>
                      <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <Text style={[styles.statLabel, { color: colors.muted }]}>Completed</Text>
                        <Text style={[styles.statValue, { color: colors.success ?? "#22C55E" }]}>{src.completed}</Text>
                      </View>
                      <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <Text style={[styles.statLabel, { color: colors.muted }]}>Conversion</Text>
                        <Text style={[styles.statValue, { color: colors.foreground }]}>{src.conversionRate}%</Text>
                      </View>
                    </View>
                    <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
                      <Text style={{ fontSize: 13, color: colors.muted }}>
                        Lost revenue: <Text style={{ fontWeight: "700", color: "#F59E0B" }}>${src.totalAbandonedValue.toFixed(0)}</Text>
                        {"  ·  "}Last 30 days: <Text style={{ fontWeight: "600", color: colors.foreground }}>{src.abandonedLast30Days} abandoned</Text>
                      </Text>
                    </View>
                  </View>
                ))}
                {/* Drop-off step breakdown */}
                {(cartData?.dropOffByStep?.length ?? 0) > 0 && (
                  <View style={{ marginHorizontal: 16, marginBottom: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
                    <View style={{ backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 10 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>Where Customers Drop Off</Text>
                    </View>
                    {cartData!.dropOffByStep.map((step, i) => (
                      <View key={`${step.step}-${step.source}`} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "500" }}>{step.step.replace(/_/g, " ")}</Text>
                          <Text style={{ fontSize: 12, color: step.source === "portal_app" || step.source === "portal" ? "#06B6D4" : "#0EA5E9" }}>{step.source === "portal_app" ? "📱 Portal App" : step.source === "portal" ? "🔐 Portal" : "🌐 Website"}</Text>
                        </View>
                        <Text style={{ fontSize: 16, fontWeight: "700", color: "#F59E0B" }}>{step.count}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {/* Recent abandoned carts */}
                {(cartData?.recentAbandoned?.length ?? 0) > 0 && (
                  <View style={{ marginHorizontal: 16, marginBottom: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
                    <View style={{ backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 10 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>Recent Abandoned Carts</Text>
                    </View>
                    {cartData!.recentAbandoned.slice(0, 8).map((cart, i) => (
                      <View key={cart.cartId} style={{ paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{cart.customerName}</Text>
                          <Text style={{ fontSize: 12, color: cart.source === "portal_app" ? "#8B5CF6" : "#0EA5E9", fontWeight: "600" }}>{cart.source === "portal_app" ? "📱 App" : "🌐 Web"}</Text>
                        </View>
                        <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>{cart.packageName}{cart.city ? ` · ${cart.city}` : ""}{cart.estimatedTotal ? ` · $${cart.estimatedTotal.toFixed(0)}` : ""}</Text>
                        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>Stopped at: {cart.stepReached.replace(/_/g, " ")} · {new Date(cart.createdAt).toLocaleDateString()}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  tabRow: {
    marginBottom: 12,
    marginTop: 4,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
  },
  locationBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  locationBtnText: {
    fontSize: 14,
    fontWeight: "500",
  },
  locationDropdown: {
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
    overflow: "hidden",
  },
  locationOption: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  locationOptionText: {
    fontSize: 14,
  },
  rangeLabel: {
    fontSize: 12,
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: 0.3,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 16,
    borderBottomWidth: 1,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 4,
  },
  statCard: {
    flex: 1,
    minWidth: "44%",
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  statSub: {
    fontSize: 11,
    marginTop: 2,
  },
  chartContainer: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 4,
  },
  chartLegend: {
    marginTop: 6,
    alignItems: "center",
  },
  chartLegendText: {
    fontSize: 11,
  },
  tableContainer: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tableHeaderRow: {
    borderBottomWidth: 1,
  },
  tableHeaderCell: {
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    textAlign: "right",
  },
  tableCell: {
    flex: 1,
    fontSize: 13,
    textAlign: "right",
  },
  totalRow: {
    borderTopWidth: 1,
  },
  tipsCard: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 4,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 10,
  },
  tipsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  tipsTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    paddingTop: 8,
    marginTop: 4,
  },
  tipsName: {
    fontSize: 14,
  },
  tipsAmount: {
    fontSize: 14,
    fontWeight: "600",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
  },
});
