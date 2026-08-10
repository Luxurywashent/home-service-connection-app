import { useEffect, useRef, useState, useMemo } from "react";
import { MorningMeetingBanner } from "@/components/morning-meeting-banner";
import { CompanyMeetingBanner } from "@/components/company-meeting-banner";
import {
  Text,
  View,
  ScrollView,
  ActivityIndicator,
  Platform,
  StyleSheet,
  TouchableOpacity,
  Pressable,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useEmployeePush } from "@/hooks/use-employee-push";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

// ─── Constants ────────────────────────────────────────────────────────────────

// Northwest Florida service area center
const REGION_DEFAULT = {
  latitude: 30.52,
  longitude: -86.48,
  latitudeDelta: 0.9,
  longitudeDelta: 0.9,
};

// Service cities with their coordinates for weather
const SERVICE_CITIES = [
  { name: "Pensacola",       lat: 30.4213, lon: -87.2169 },
  { name: "Destin",          lat: 30.3935, lon: -86.4958 },
  { name: "Fort Walton Bch", lat: 30.4057, lon: -86.6187 },
  { name: "Niceville",       lat: 30.5185, lon: -86.4772 },
  { name: "Crestview",       lat: 30.7460, lon: -86.5703 },
];

// Weather condition codes → label + emoji
function getWeatherInfo(code: number): { label: string; emoji: string; color: string } {
  if (code === 0) return { label: "Clear Sky", emoji: "☀️", color: "#F59E0B" };
  if (code <= 2) return { label: "Partly Cloudy", emoji: "⛅", color: "#94A3B8" };
  if (code === 3) return { label: "Overcast", emoji: "☁️", color: "#64748B" };
  if (code <= 49) return { label: "Foggy", emoji: "🌫️", color: "#94A3B8" };
  if (code <= 59) return { label: "Drizzle", emoji: "🌦️", color: "#60A5FA" };
  if (code <= 69) return { label: "Rain", emoji: "🌧️", color: "#3B82F6" };
  if (code <= 79) return { label: "Snow", emoji: "❄️", color: "#BAE6FD" };
  if (code <= 82) return { label: "Rain Showers", emoji: "🌧️", color: "#3B82F6" };
  if (code <= 84) return { label: "Heavy Showers", emoji: "⛈️", color: "#1D4ED8" };
  if (code <= 99) return { label: "Thunderstorm", emoji: "⛈️", color: "#7C3AED" };
  return { label: "Unknown", emoji: "🌡️", color: "#94A3B8" };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CityWeather {
  name: string;
  tempF: number;
  feelsLikeF: number;
  humidity: number;
  windMph: number;
  precipMm: number;
  weatherCode: number;
  uvIndex: number;
}

// ─── Helper: detect late clock-in (after 7:35 AM CST) ───────────────────────
function isLateClockIn(clockInIso: string): boolean {
  const dt = new Date(clockInIso);
  const cstParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(dt);
  const h = parseInt(cstParts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(cstParts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return h * 60 + m > 7 * 60 + 35; // after 7:35 AM
}

// Format ISO time → "8:42 AM"
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ─── Repair Requests At A Glance ─────────────────────────────────────────────
function RepairRequestsSection({ colors }: { colors: any }) {
  const { data: repairs, isLoading } = trpc.fleet.listRepairOrders.useQuery(
    { status: "open" },
    { refetchInterval: 60000 }
  );
  const openRepairs = (repairs as any[]) ?? [];

  return (
    <View style={{ marginBottom: 28 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>🔧 Repair Requests</Text>
        {openRepairs.length > 0 && (
          <View style={{ backgroundColor: "#EF444420", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: "#EF4444" }}>{openRepairs.length} Open</Text>
          </View>
        )}
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : openRepairs.length === 0 ? (
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 20, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ fontSize: 24, marginBottom: 6 }}>✅</Text>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.muted }}>No open repair requests</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {openRepairs.slice(0, 5).map((r: any) => {
            const priorityColor = r.priority === "high" ? "#EF4444" : r.priority === "medium" ? "#F59E0B" : "#22C55E";
            const priorityBg = r.priority === "high" ? "#EF444420" : r.priority === "medium" ? "#F59E0B20" : "#22C55E20";
            return (
              <View key={r.repairId} style={{
                backgroundColor: colors.surface,
                borderRadius: 14,
                padding: 14,
                borderWidth: 1,
                borderColor: colors.border,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
              }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                    {r.equipmentName}
                  </Text>
                  {r.subIssue ? (
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }} numberOfLines={1}>{r.subIssue}</Text>
                  ) : null}
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                    {r.employeeName ?? "Unknown"} · {r.vanName ?? ""}
                  </Text>
                </View>
                <View style={{ backgroundColor: priorityBg, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10 }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: priorityColor, textTransform: "capitalize" }}>
                    {r.priority ?? "low"}
                  </Text>
                </View>
              </View>
            );
          })}
          {openRepairs.length > 5 && (
            <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", marginTop: 4 }}>
              +{openRepairs.length - 5} more — view Repair Log for full list
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Late Clock-Ins & Clock-Outs ──────────────────────────────────────────────
function LateClockSection({ colors }: { colors: any }) {
  const { data: records, isLoading } = trpc.timesheet.getTodayClockSummary.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const allRecords = (records as any[]) ?? [];

  const lateIns = allRecords.filter((r: any) => r.clockInTime && isLateClockIn(r.clockInTime));
  // Late clock-out: clocked out after 7:00 PM CST
  const lateOuts = allRecords.filter((r: any) => {
    if (!r.clockOutTime) return false;
    const dt = new Date(r.clockOutTime);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(dt);
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    return h * 60 + m > 19 * 60; // after 7:00 PM
  });

  if (isLoading) return <ActivityIndicator color={colors.primary} style={{ marginBottom: 28 }} />;
  if (lateIns.length === 0 && lateOuts.length === 0) {
    return (
      <View style={{ marginBottom: 28 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>⏰ Attendance</Text>
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 20, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ fontSize: 24, marginBottom: 6 }}>✅</Text>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.muted }}>All team members on time today</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ marginBottom: 28 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>⏰ Attendance</Text>
        {(lateIns.length + lateOuts.length) > 0 && (
          <View style={{ backgroundColor: "#F59E0B20", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: "#F59E0B" }}>{lateIns.length + lateOuts.length} Alert{lateIns.length + lateOuts.length !== 1 ? "s" : ""}</Text>
          </View>
        )}
      </View>
      <View style={{ gap: 10 }}>
        {lateIns.map((r: any) => (
          <View key={r.recordId + "_in"} style={{
            backgroundColor: colors.surface,
            borderRadius: 14,
            padding: 14,
            borderWidth: 1,
            borderLeftWidth: 4,
            borderColor: colors.border,
            borderLeftColor: "#F59E0B",
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}>
            <Text style={{ fontSize: 24 }}>🕐</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{r.fullName}</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                Late clock-in · {fmtTime(r.clockInTime)}
              </Text>
            </View>
            <View style={{ backgroundColor: "#F59E0B20", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: "#F59E0B" }}>Late In</Text>
            </View>
          </View>
        ))}
        {lateOuts.map((r: any) => (
          <View key={r.recordId + "_out"} style={{
            backgroundColor: colors.surface,
            borderRadius: 14,
            padding: 14,
            borderWidth: 1,
            borderLeftWidth: 4,
            borderColor: colors.border,
            borderLeftColor: "#EF4444",
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}>
            <Text style={{ fontSize: 24 }}>🕔</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{r.fullName}</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                Late clock-out · {fmtTime(r.clockOutTime)}
              </Text>
            </View>
            <View style={{ backgroundColor: "#EF444420", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: "#EF4444" }}>Late Out</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Ops Daily Checklist ─────────────────────────────────────────────────────

type ChecklistField = "siteInspections" | "vanInspections" | "doorHangers" | "inventoryCheck" | "morningTeamCheckIn" | "afternoonTeamCheckIn" | "qcCallsDone";

function OpsDailyChecklistSection({ colors, opsManagerId }: { colors: any; opsManagerId: string }) {
  const utils = trpc.useUtils();
  const { data: checklist, isLoading } = trpc.ops.getDailyChecklist.useQuery(
    { opsManagerId },
    { refetchInterval: 60000 }
  );
  const updateMutation = trpc.ops.updateDailyChecklist.useMutation({
    onSuccess: () => utils.ops.getDailyChecklist.invalidate(),
  });

  function toggle(field: ChecklistField, currentVal: number, isBoolean: boolean) {
    if (isBoolean) {
      updateMutation.mutate({ opsManagerId, field, value: currentVal === 1 ? 0 : 1 });
    }
  }

  function increment(field: ChecklistField, currentVal: number) {
    updateMutation.mutate({ opsManagerId, field, value: currentVal + 1 });
  }

  const si = checklist?.siteInspections ?? 0;
  const vi = checklist?.vanInspections ?? 0;
  const dh = checklist?.doorHangers ?? 0;
  const inv = checklist?.inventoryCheck ?? 0;
  const am = checklist?.morningTeamCheckIn ?? 0;
  const pm = checklist?.afternoonTeamCheckIn ?? 0;
  const qc = checklist?.qcCallsDone ?? 0;

  const totalItems = 7;
  const completedItems = [
    si >= 2, vi >= 2, dh >= 100,
    inv === 1, am === 1, pm === 1, qc === 1,
  ].filter(Boolean).length;
  const allDone = completedItems === totalItems;

  const ACCENT = "#0a7ea4";

  function CounterRow({
    emoji, label, field, value, goal,
  }: { emoji: string; label: string; field: ChecklistField; value: number; goal: number }) {
    const done = value >= goal;
    return (
      <View style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        paddingHorizontal: 14,
        backgroundColor: done ? colors.success + "12" : colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: done ? colors.success + "40" : colors.border,
        gap: 10,
      }}>
        <Text style={{ fontSize: 20 }}>{emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{label}</Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>
            {value} / {goal} completed
          </Text>
        </View>
        {done ? (
          <Text style={{ fontSize: 20 }}>✅</Text>
        ) : (
          <TouchableOpacity
            onPress={() => {
              increment(field, value);
              if ((Platform.OS as string) !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            style={{
              backgroundColor: ACCENT,
              borderRadius: 20,
              width: 36,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700", lineHeight: 22 }}>+</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  function ToggleRow({
    emoji, label, field, value, note,
  }: { emoji: string; label: string; field: ChecklistField; value: number; note?: string }) {
    const done = value === 1;
    return (
      <TouchableOpacity
        onPress={() => {
          toggle(field, value, true);
          if ((Platform.OS as string) !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 12,
          paddingHorizontal: 14,
          backgroundColor: done ? colors.success + "12" : colors.surface,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: done ? colors.success + "40" : colors.border,
          gap: 10,
        }}
      >
        <Text style={{ fontSize: 20 }}>{emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{label}</Text>
          {note ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>{note}</Text> : null}
        </View>
        <View style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          borderWidth: 2,
          borderColor: done ? colors.success : colors.border,
          backgroundColor: done ? colors.success : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}>
          {done && <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>✓</Text>}
        </View>
      </TouchableOpacity>
    );
  }

  if (isLoading) return <ActivityIndicator color={colors.primary} style={{ marginBottom: 28 }} />;

  return (
    <View style={{ marginBottom: 28 }}>
      {/* Header */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>📋 Daily Checklist</Text>
        <View style={{
          backgroundColor: allDone ? colors.success + "20" : ACCENT + "20",
          paddingHorizontal: 10,
          paddingVertical: 3,
          borderRadius: 12,
        }}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: allDone ? colors.success : ACCENT }}>
            {completedItems}/{totalItems} Done
          </Text>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <CounterRow emoji="🔍" label="Site Inspections" field="siteInspections" value={si} goal={2} />
        <CounterRow emoji="🚐" label="Van Inspections" field="vanInspections" value={vi} goal={2} />
        <CounterRow emoji="🚪" label="Door Hangers" field="doorHangers" value={dh} goal={100} />
        <ToggleRow emoji="📦" label="Blue Box Inventory Check" field="inventoryCheck" value={inv} />
        <ToggleRow emoji="☀️" label="Morning Team Check-In" field="morningTeamCheckIn" value={am} note="Check in with all working team members before noon" />
        <ToggleRow emoji="🕑" label="Afternoon Team Check-In" field="afternoonTeamCheckIn" value={pm} note="Follow up with all Detailers around 2:30 PM" />
        <ToggleRow emoji="✅" label="QC Calls Complete" field="qcCallsDone" value={qc} note="All quality control calls done for today" />
      </View>

      {allDone && (
        <View style={{
          marginTop: 12,
          backgroundColor: colors.success + "15",
          borderRadius: 12,
          padding: 14,
          alignItems: "center",
          borderWidth: 1,
          borderColor: colors.success + "40",
        }}>
          <Text style={{ fontSize: 16, marginBottom: 4 }}>🎉</Text>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.success }}>All tasks complete for today!</Text>
        </View>
      )}
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function VanMarker({ color, label }: { color: string; label: string }) {
  return (
    <View style={markerStyles.container}>
      <View style={[markerStyles.bubble, { backgroundColor: color, shadowColor: color }]}>
        <Text style={markerStyles.emoji}>🚐</Text>
      </View>
      <View style={[markerStyles.tail, { borderTopColor: color }]} />
      <View style={[markerStyles.labelBg]}>
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
    backgroundColor: "#1e293b",
  },
  labelText: { color: "#fff", fontSize: 10, fontWeight: "600" },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function OpsDashboard() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  // Register push token so ops managers receive job and chat notifications
  useEmployeePush();

  // Portal unread messages
  const { data: portalUnreadData } = trpc.portalInbox.unreadCount.useQuery(undefined, { refetchInterval: 30000 });
  const { data: portalThreadsData } = trpc.portalInbox.listThreads.useQuery(undefined, { refetchInterval: 30000 });
  const firstUnreadThread = (portalThreadsData as any[] ?? []).find((t: any) => t.unreadCount > 0) ?? null;
  const portalUnreadCount = portalUnreadData?.count ?? 0;

  // Selected city for weather detail
  const [selectedCity, setSelectedCity] = useState(0);

  // Weather data state
  const [weatherData, setWeatherData] = useState<CityWeather[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Alerts summary (for pending time off count)
  const { data: alerts } = trpc.alerts.getSummary.useQuery(undefined, { refetchInterval: 60000 });

  // Van locations
  const { data: vans, isLoading: vansLoading, refetch: refetchVans } = trpc.location.getActive.useQuery(undefined, {
    refetchInterval: 30000,
  });

  // ── Fetch weather for all service cities ──────────────────────────────────
  const fetchWeather = async () => {
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      const results: CityWeather[] = await Promise.all(
        SERVICE_CITIES.map(async (city) => {
          const url =
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${city.lat}&longitude=${city.lon}` +
            `&current=temperature_2m,apparent_temperature,relative_humidity_2m,` +
            `wind_speed_10m,precipitation,weather_code,uv_index` +
            `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
            `&timezone=America%2FChicago`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Weather fetch failed for ${city.name}`);
          const json = await res.json();
          const c = json.current;
          return {
            name: city.name,
            tempF: Math.round(c.temperature_2m),
            feelsLikeF: Math.round(c.apparent_temperature),
            humidity: Math.round(c.relative_humidity_2m),
            windMph: Math.round(c.wind_speed_10m),
            precipMm: parseFloat((c.precipitation ?? 0).toFixed(2)),
            weatherCode: c.weather_code,
            uvIndex: Math.round(c.uv_index ?? 0),
          } as CityWeather;
        })
      );
      setWeatherData(results);
      setLastUpdated(new Date());
    } catch (e: any) {
      setWeatherError(e.message ?? "Failed to load weather");
    } finally {
      setWeatherLoading(false);
    }
  };

  useEffect(() => {
    fetchWeather();
    // Refresh every 10 minutes
    const interval = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const selectedWeather = weatherData[selectedCity] ?? null;
  const weatherInfo = selectedWeather ? getWeatherInfo(selectedWeather.weatherCode) : null;

  // UV risk label
  const uvLabel = (uv: number) => {
    if (uv <= 2) return { label: "Low", color: "#22C55E" };
    if (uv <= 5) return { label: "Moderate", color: "#F59E0B" };
    if (uv <= 7) return { label: "High", color: "#F97316" };
    if (uv <= 10) return { label: "Very High", color: "#EF4444" };
    return { label: "Extreme", color: "#7C3AED" };
  };

  const activeVans = (vans as any[]) ?? [];

  return (
    <ScreenContainer edges={["left", "right"]} className="px-5">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* ── Header ── */}
        <View style={{ marginTop: 8, marginBottom: 24 }}>
          <Text style={{ fontSize: 14, color: colors.muted }}>Operations Manager</Text>
          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.foreground }}>
            Ops Dashboard
          </Text>
        </View>

        {/* Pending Time Off Banner */}
        {(alerts as any)?.pendingTimeOffCount > 0 && (
          <Pressable
            onPress={() => router.push("/(tabs)/admin-timeoff" as any)}
            style={({ pressed }) => ({
              backgroundColor: "#F59E0B18",
              borderRadius: 12,
              padding: 14,
              marginBottom: 16,
              borderWidth: 1,
              borderColor: "#F59E0B40",
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <View style={{ backgroundColor: "#F59E0B", borderRadius: 12, minWidth: 24, height: 24, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }}>
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{(alerts as any).pendingTimeOffCount}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#F59E0B", fontSize: 13, fontWeight: "700" }}>
                {(alerts as any).pendingTimeOffCount === 1 ? "1 Pending Time Off Request" : `${(alerts as any).pendingTimeOffCount} Pending Time Off Requests`}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Tap to review and approve or deny</Text>
            </View>
            <Text style={{ color: "#F59E0B", fontSize: 16 }}>›</Text>
          </Pressable>
        )}

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

        {/* ── Weather Section ── */}
        <View style={{ marginBottom: 28 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>
              Weather
            </Text>
            {lastUpdated && (
              <Text style={{ fontSize: 11, color: colors.muted }}>
                Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </Text>
            )}
          </View>

          {/* City selector pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginBottom: 12 }}
            contentContainerStyle={{ gap: 8, paddingRight: 4 }}
          >
            {SERVICE_CITIES.map((city, idx) => {
              const isSelected = idx === selectedCity;
              const cityWeather = weatherData[idx];
              const info = cityWeather ? getWeatherInfo(cityWeather.weatherCode) : null;
              return (
                <TouchableOpacity
                  key={city.name}
                  onPress={() => {
                    setSelectedCity(idx);
                    if ((Platform.OS as string) !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 20,
                    backgroundColor: isSelected ? colors.primary : colors.surface,
                    borderWidth: 1,
                    borderColor: isSelected ? colors.primary : colors.border,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {info && <Text style={{ fontSize: 14 }}>{info.emoji}</Text>}
                  <Text style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color: isSelected ? "#fff" : colors.foreground,
                  }}>
                    {city.name}
                  </Text>
                  {cityWeather && (
                    <Text style={{
                      fontSize: 12,
                      color: isSelected ? "rgba(255,255,255,0.8)" : colors.muted,
                    }}>
                      {cityWeather.tempF}°
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Main weather card */}
          {weatherLoading ? (
            <View style={{
              backgroundColor: colors.surface,
              borderRadius: 20,
              padding: 32,
              alignItems: "center",
              borderWidth: 1,
              borderColor: colors.border,
            }}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.muted, marginTop: 8, fontSize: 13 }}>Loading weather…</Text>
            </View>
          ) : weatherError ? (
            <View style={{
              backgroundColor: colors.surface,
              borderRadius: 20,
              padding: 24,
              alignItems: "center",
              borderWidth: 1,
              borderColor: colors.error + "40",
            }}>
              <Text style={{ fontSize: 24 }}>⚠️</Text>
              <Text style={{ color: colors.error, marginTop: 8, fontSize: 13, textAlign: "center" }}>{weatherError}</Text>
              <TouchableOpacity
                onPress={fetchWeather}
                style={{ marginTop: 12, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: colors.primary, borderRadius: 12 }}
              >
                <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : selectedWeather && weatherInfo ? (
            <View style={{
              backgroundColor: colors.surface,
              borderRadius: 20,
              padding: 20,
              borderWidth: 1,
              borderColor: colors.border,
            }}>
              {/* Top row: big temp + condition */}
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
                <Text style={{ fontSize: 64, lineHeight: 72 }}>{weatherInfo.emoji}</Text>
                <View style={{ marginLeft: 16, flex: 1 }}>
                  <Text style={{ fontSize: 52, fontWeight: "900", color: colors.foreground, lineHeight: 56 }}>
                    {selectedWeather.tempF}°
                  </Text>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: weatherInfo.color }}>
                    {weatherInfo.label}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                    Feels like {selectedWeather.feelsLikeF}°F
                  </Text>
                </View>
              </View>

              {/* Detail grid */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {[
                  { icon: "💧", label: "Humidity", value: `${selectedWeather.humidity}%` },
                  { icon: "💨", label: "Wind", value: `${selectedWeather.windMph} mph` },
                  { icon: "🌧️", label: "Precip", value: `${selectedWeather.precipMm}"` },
                  {
                    icon: "☀️",
                    label: "UV Index",
                    value: `${selectedWeather.uvIndex} · ${uvLabel(selectedWeather.uvIndex).label}`,
                    valueColor: uvLabel(selectedWeather.uvIndex).color,
                  },
                ].map((item) => (
                  <View
                    key={item.label}
                    style={{
                      flex: 1,
                      minWidth: "45%",
                      backgroundColor: colors.background,
                      borderRadius: 12,
                      padding: 12,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 18, marginBottom: 4 }}>{item.icon}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted, fontWeight: "500" }}>{item.label}</Text>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: (item as any).valueColor ?? colors.foreground, marginTop: 2 }}>
                      {item.value}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Outdoor work advisory */}
              {(() => {
                const isRainy = selectedWeather.weatherCode >= 51;
                const isHotUV = selectedWeather.uvIndex >= 8;
                const isWindy = selectedWeather.windMph >= 25;
                if (!isRainy && !isHotUV && !isWindy) return null;
                const warnings: string[] = [];
                if (isRainy) warnings.push("Rain expected — schedule accordingly");
                if (isHotUV) warnings.push("Very high UV — ensure team has sun protection");
                if (isWindy) warnings.push("Strong winds — secure equipment");
                return (
                  <View style={{
                    marginTop: 12,
                    backgroundColor: colors.warning + "15",
                    borderRadius: 12,
                    padding: 12,
                    borderWidth: 1,
                    borderColor: colors.warning + "40",
                  }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: colors.warning, marginBottom: 4 }}>
                      ⚠️ Field Advisory
                    </Text>
                    {warnings.map((w) => (
                      <Text key={w} style={{ fontSize: 12, color: colors.warning, lineHeight: 18 }}>• {w}</Text>
                    ))}
                  </View>
                );
              })()}
            </View>
          ) : null}
        </View>

        {/* ── Morning Meeting Banner ── */}
        <MorningMeetingBanner />
        <CompanyMeetingBanner />

        {/* ── Repair Requests At A Glance ── */}
        <RepairRequestsSection colors={colors} />

        {/* ── Late Clock-Ins & Clock-Outs ── */}
        <LateClockSection colors={colors} />

        {/* ── Daily Ops Checklist ── */}
        {employee?.employeeId ? (
          <OpsDailyChecklistSection colors={colors} opsManagerId={employee.employeeId} />
        ) : null}

        {/* ── Team Locations Section ── */}
        <View style={{ marginBottom: 28 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>
              Team Locations
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {activeVans.length > 0 && (
                <View style={{
                  backgroundColor: colors.success + "20",
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.success + "40",
                }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.success }}>
                    {activeVans.length} Active
                  </Text>
                </View>
              )}
              <TouchableOpacity
                onPress={() => {
                  refetchVans();
                  if ((Platform.OS as string) !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <Text style={{ fontSize: 18 }}>🔄</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Map */}
          <View style={{
            height: 320,
            borderRadius: 20,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: colors.border,
          }}>
            {vansLoading ? (
              <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.surface }}>
                <ActivityIndicator color={colors.primary} />
                <Text style={{ color: colors.muted, marginTop: 8, fontSize: 13 }}>Loading locations…</Text>
              </View>
            ) : activeVans.length > 0 ? (
              Platform.OS === "web" ? (
                <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.surface }}>
                  <Text style={{ fontSize: 32, marginBottom: 8 }}>🗺️</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>
                    {activeVans.length} Team Member{activeVans.length !== 1 ? "s" : ""} Active
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
                    Map view available on mobile
                  </Text>
                  {activeVans.map((van: any) => (
                    <View key={van.employeeId} style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: 16 }}>🚐</Text>
                      <Text style={{ fontSize: 13, color: colors.foreground, fontWeight: "600" }}>
                        {van.fullName?.split(" ")[0] ?? "Van"}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.muted }}>
                        {van.lat?.toFixed(4)}, {van.lng?.toFixed(4)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <MapView
              provider={(Platform.OS as string) !== "web" ? PROVIDER_GOOGLE : undefined}
                  ref={mapRef}
                  style={{ flex: 1 }}
                  initialRegion={REGION_DEFAULT}
                  showsUserLocation={false}
                  showsMyLocationButton={false}
                >
                  {activeVans.map((van: any) => (
                    <Marker
                      key={van.employeeId}
                      coordinate={{
                        latitude: parseFloat(van.lat),
                        longitude: parseFloat(van.lng),
                      }}
                    >
                      <VanMarker
                        color={van.status === "on_my_way" ? "#F59E0B" : "#8B5CF6"}
                        label={van.fullName?.split(" ")[0] ?? "Van"}
                      />
                    </Marker>
                  ))}
                </MapView>
              )
            ) : (
              <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.surface }}>
                <Text style={{ fontSize: 32, marginBottom: 8 }}>📍</Text>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.muted }}>No active locations</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
                  Team members appear when clocked in
                </Text>
              </View>
            )}
          </View>

          {/* Active team member list below map */}
          {activeVans.length > 0 && (
            <View style={{ marginTop: 12, gap: 8 }}>
              {activeVans.map((van: any) => (
                <View
                  key={van.employeeId}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: colors.surface,
                    borderRadius: 14,
                    padding: 12,
                    borderWidth: 1,
                    borderColor: colors.border,
                    gap: 12,
                  }}
                >
                  <View style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: van.status === "on_my_way" ? "#F59E0B20" : "#8B5CF620",
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: van.status === "on_my_way" ? "#F59E0B40" : "#8B5CF640",
                  }}>
                    <Text style={{ fontSize: 20 }}>🚐</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>
                      {van.fullName ?? "Team Member"}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                      {van.city ?? "En route"} · {van.status === "on_my_way" ? "On My Way" : "Active"}
                    </Text>
                  </View>
                  <View style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 10,
                    backgroundColor: van.status === "on_my_way" ? "#F59E0B20" : "#22C55E20",
                  }}>
                    <Text style={{
                      fontSize: 11,
                      fontWeight: "700",
                      color: van.status === "on_my_way" ? "#F59E0B" : "#22C55E",
                    }}>
                      {van.status === "on_my_way" ? "On Way" : "Active"}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

      </ScrollView>
    </ScreenContainer>
  );
}
