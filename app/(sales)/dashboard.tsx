import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, Platform, Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import Svg, { Circle } from "react-native-svg";

// ─── Helpers ────────────────────────────────────────────────────────────────

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface PerfStats {
  today: { jobsBooked: number; revenueScheduled: number };
  week: { jobsBooked: number; revenueScheduled: number };
  allTime: { jobsBooked: number; revenueScheduled: number };
}

type ItemType = "door_hangers" | "business_cards" | "yard_signs" | "table_toppers";

interface LoggedEntry {
  uri: string;
  latitude: number;
  longitude: number;
  address: string;
  itemType: ItemType;
  savedAt: string;
}

const ITEM_TYPES: { type: ItemType; label: string; emoji: string }[] = [
  { type: "door_hangers", label: "Door Hangers", emoji: "🚪" },
  { type: "business_cards", label: "Business Cards", emoji: "💼" },
  { type: "yard_signs", label: "Yard Signs", emoji: "🏷️" },
  { type: "table_toppers", label: "Table Toppers", emoji: "📋" },
];

// ─── Sub-components ──────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  sub: string;
  accent: string;
  icon: string;
  colors: any;
}

function StatCard({ label, value, sub, accent, icon, colors }: StatCardProps) {
  return (
    <View style={{
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      gap: 4,
    }}>
      <Text style={{ fontSize: 22 }}>{icon}</Text>
      <Text style={{ fontSize: 22, fontWeight: "900", color: accent }}>{value}</Text>
      <Text style={{ fontSize: 12, fontWeight: "700", color: colors.foreground }}>{label}</Text>
      <Text style={{ fontSize: 11, color: colors.muted }}>{sub}</Text>
    </View>
  );
}

function ProgressBar({ label, count, goal, accent, colors, isCurrency }: {
  label: string; count: number; goal: number; accent: string; colors: any; isCurrency?: boolean;
}) {
  const pct = Math.min(Math.round((count / Math.max(goal, 1)) * 100), 100);
  const display = isCurrency ? formatCurrency(count) : String(count);
  const goalDisplay = isCurrency ? formatCurrency(goal) : String(goal);
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{label}</Text>
        <Text style={{ fontSize: 13, color: colors.muted }}>{display} / {goalDisplay}</Text>
      </View>
      <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" }}>
        <View style={{ height: "100%", width: `${pct}%`, backgroundColor: accent, borderRadius: 4 }} />
      </View>
    </View>
  );
}

function RingProgress({ size, strokeWidth, percent, color, bgColor, children }: {
  size: number; strokeWidth: number; percent: number; color: string; bgColor: string; children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={bgColor} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color} strokeWidth={strokeWidth} fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round" rotation="-90" origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      {children}
    </View>
  );
}

function MiniRingCard({ label, emoji, count, goal, accentColor, bgColor }: {
  label: string; emoji: string; count: number; goal: number; accentColor: string; bgColor: string;
}) {
  const pct = Math.min(Math.round((count / Math.max(goal, 1)) * 100), 100);
  const isComplete = count >= goal;
  return (
    <View style={{
      flex: 1, backgroundColor: bgColor, borderRadius: 18, padding: 14, alignItems: "center", gap: 8,
      borderWidth: 1.5, borderColor: isComplete ? accentColor + "80" : "rgba(255,255,255,0.08)",
    }}>
      <RingProgress size={64} strokeWidth={6} percent={pct} color={isComplete ? accentColor : accentColor + "CC"} bgColor="rgba(255,255,255,0.1)">
        <Text style={{ fontSize: 20 }}>{emoji}</Text>
      </RingProgress>
      <View style={{ alignItems: "center", gap: 2 }}>
        <Text style={{ fontSize: 18, fontWeight: "900", color: "#fff" }}>{count}</Text>
        <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", fontWeight: "600" }}>of {goal}</Text>
        <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", fontWeight: "700", textAlign: "center" }} numberOfLines={1}>{label}</Text>
      </View>
      {isComplete && (
        <View style={{ backgroundColor: accentColor + "30", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ fontSize: 10, color: accentColor, fontWeight: "800" }}>✓ Done</Text>
        </View>
      )}
    </View>
  );
}

// ─── Inline PhotoLogger (embedded, no route navigation) ──────────────────────

function InlinePhotoLogger({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const [selectedItemType, setSelectedItemType] = useState<ItemType | null>(null);
  const [loggedEntries, setLoggedEntries] = useState<LoggedEntry[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [locationPermission, requestLocationPermission] = Location.useForegroundPermissions();
  const cachedLocation = useRef<{ latitude: number; longitude: number; address: string } | null>(null);
  const isFetchingLocation = useRef(false);

  const createEntryMutation = trpc.doorHanger.createEntry.useMutation();

  useEffect(() => {
    (async () => {
      let granted = locationPermission?.granted;
      if (!granted) {
        const result = await requestLocationPermission();
        granted = result.granted;
        if (!granted && !result.canAskAgain) {
          Alert.alert("Location Access Required", "Enable location in Settings to geo-tag entries.");
        }
      }
      if (granted) prefetchLocation();
    })();
  }, []);

  const prefetchLocation = async () => {
    if (isFetchingLocation.current) return;
    isFetchingLocation.current = true;
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;
      let address = "Unknown location";
      try {
        const geo = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (geo.length > 0) {
          const { streetNumber, street, city, region, postalCode } = geo[0];
          address = [streetNumber, street, city, region, postalCode].filter(Boolean).join(" ");
        }
      } catch {}
      cachedLocation.current = { latitude, longitude, address };
    } catch {}
    finally { isFetchingLocation.current = false; }
  };

  const getLocation = async (): Promise<{ latitude: number; longitude: number; address: string }> => {
    if (cachedLocation.current) { const loc = cachedLocation.current; prefetchLocation(); return loc; }
    try {
      const loc = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      if (loc && (loc as any).coords) {
        const { latitude, longitude } = (loc as any).coords;
        let address = "Unknown location";
        try {
          const geo = await Promise.race([Location.reverseGeocodeAsync({ latitude, longitude }), new Promise<[]>((resolve) => setTimeout(() => resolve([]), 4000))]);
          if ((geo as any).length > 0) {
            const { streetNumber, street, city, region, postalCode } = (geo as any)[0];
            address = [streetNumber, street, city, region, postalCode].filter(Boolean).join(" ");
          }
        } catch {}
        return { latitude, longitude, address };
      }
    } catch {}
    return { latitude: 0, longitude: 0, address: "Location unavailable" };
  };

  const autoSaveEntry = async (uri: string, itemType: ItemType) => {
    if (!employee?.employeeId) { Alert.alert("Not Logged In", "Please log in to log entries."); return; }
    setIsSaving(true);
    const safetyTimer = setTimeout(() => setIsSaving(false), 20000);
    try {
      const locationData = await getLocation();
      const today = new Date().toISOString().split("T")[0];
      await Promise.race([
        createEntryMutation.mutateAsync({
          employeeId: employee.employeeId, date: today,
          address: locationData.address, city: employee.city || "Unknown",
          outreachType: itemType, quantityDistributed: 1,
          latitude: locationData.latitude, longitude: locationData.longitude,
          photoUrls: [uri],
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Save timed out")), 15000)),
      ]);
      setLoggedEntries((prev) => [{
        uri, latitude: locationData.latitude, longitude: locationData.longitude,
        address: locationData.address, itemType,
        savedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }, ...prev]);
    } catch (err: any) {
      Alert.alert("Save Failed", err?.message || "Could not save entry. Please try again.");
    } finally { clearTimeout(safetyTimer); setIsSaving(false); }
  };

  const launchCamera = async (type: ItemType) => {
    try {
      // Always request permission first — required for iOS to show the camera
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Camera Permission Required",
          "Please allow camera access in Settings → Home Service Connection → Camera.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, allowsEditing: false });
      if (!result.canceled && result.assets.length > 0) await autoSaveEntry(result.assets[0].uri, type);
    } catch { Alert.alert("Camera Error", "Could not open camera. Please try again."); }
  };

  const handleSelectItemType = async (type: ItemType) => { setSelectedItemType(type); await launchCamera(type); };
  const getLabel = (type: ItemType) => ITEM_TYPES.find((t) => t.type === type)?.label ?? type;

  // ── Item type selector ──
  if (selectedItemType === null) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        <Text style={{ fontSize: 22, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>Log Items</Text>
        <Text style={{ color: colors.muted, marginBottom: 24, fontSize: 14 }}>Select item type — camera opens automatically.</Text>
        <View style={{ gap: 12 }}>
          {ITEM_TYPES.map((item) => (
            <TouchableOpacity
              key={item.type}
              onPress={() => handleSelectItemType(item.type)}
              style={{
                backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
                borderRadius: 14, padding: 18, flexDirection: "row", alignItems: "center", gap: 14,
              }}
            >
              <Text style={{ fontSize: 30 }}>{item.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 16 }}>{item.label}</Text>
                <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>Tap to open camera</Text>
              </View>
              <Text style={{ color: colors.primary, fontSize: 20 }}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  // ── Active logging screen ──
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      {/* Header */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <View>
          <Text style={{ fontSize: 22, fontWeight: "700", color: colors.foreground }}>
            {ITEM_TYPES.find((t) => t.type === selectedItemType)?.emoji} {getLabel(selectedItemType)}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>{loggedEntries.length} logged this session</Text>
        </View>
        <TouchableOpacity
          onPress={() => { setSelectedItemType(null); setLoggedEntries([]); }}
          style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
        >
          <Text style={{ color: colors.muted, fontWeight: "600" }}>← Back</Text>
        </TouchableOpacity>
      </View>

      {isSaving && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: 10, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.primary }}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={{ color: colors.primary, fontWeight: "600" }}>Saving entry with location...</Text>
        </View>
      )}

      <TouchableOpacity
        onPress={() => launchCamera(selectedItemType!)}
        disabled={isSaving}
        style={{ backgroundColor: colors.primary, borderRadius: 14, padding: 18, alignItems: "center", marginBottom: 24, opacity: isSaving ? 0.6 : 1 }}
      >
        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>📷 Take Another Photo</Text>
      </TouchableOpacity>

      {loggedEntries.length > 0 && (
        <>
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginBottom: 12 }}>✅ Logged This Session</Text>
          {loggedEntries.map((entry, index) => (
            <View key={index} style={{ backgroundColor: colors.surface, borderRadius: 12, marginBottom: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
              <View style={{ padding: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontWeight: "600", color: colors.foreground, fontSize: 14 }}>{getLabel(entry.itemType)}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{entry.savedAt}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }} numberOfLines={2}>
                  📍 {entry.latitude !== 0 ? entry.address : "Location unavailable"}
                </Text>
                {entry.latitude !== 0 && (
                  <Text style={{ color: colors.success, fontSize: 11, marginTop: 2 }}>
                    ✓ GPS: {entry.latitude.toFixed(5)}, {entry.longitude.toFixed(5)}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

// ─── JobHistoryRow ───────────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case "completed": return "#22C55E";
    case "cancelled": return "#EF4444";
    case "in_progress": return "#F59E0B";
    default: return "#2563EB";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "completed": return "Completed";
    case "cancelled": return "Cancelled";
    case "in_progress": return "In Progress";
    case "confirmed": return "Confirmed";
    default: return "Pending";
  }
}

function JobHistoryRow({ job, colors }: { job: any; colors: any }) {
  const price = job.totalPrice ? `$${Number(job.totalPrice).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—";
  const service = job.packageType || job.serviceDescription || "Detail Service";
  const customer = job.customerName || "Customer";
  const sc = statusColor(job.status);
  return (
    <View style={{
      backgroundColor: colors.surface, borderRadius: 14, padding: 14,
      borderWidth: 1, borderColor: colors.border,
      flexDirection: "row", alignItems: "center", gap: 12,
    }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: sc + "18", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 20 }}>🚗</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontWeight: "700", color: colors.foreground, fontSize: 14 }} numberOfLines={1}>{customer}</Text>
          <Text style={{ fontWeight: "800", color: sc, fontSize: 14 }}>{price}</Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{service}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
          <Text style={{ fontSize: 11, color: colors.muted }}>📅 {job.date}</Text>
          <View style={{ backgroundColor: sc + "20", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ fontSize: 10, fontWeight: "700", color: sc }}>{statusLabel(job.status)}</Text>
          </View>
          {job.location ? <Text style={{ fontSize: 11, color: colors.muted }}>📍 {job.location}</Text> : null}
        </View>
      </View>
    </View>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function SalesDashboard() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"today" | "week" | "alltime">("today");
  const [showLogModal, setShowLogModal] = useState(false);
  const [showJobsModal, setShowJobsModal] = useState(false);
  const today = todayLocal();

  const DAILY_JOBS_GOAL = 5;
  const DAILY_REVENUE_GOAL = 2500;

  // Sales performance
  const statsQuery = trpc.salesPerformance.getStats.useQuery(
    { employeeId: employee?.employeeId ?? "" },
    { enabled: !!employee?.employeeId, refetchInterval: 30000 }
  );

  // Callbacks
  const callbacksQuery = trpc.salesCallback.listMine.useQuery(
    { employeeId: employee?.employeeId ?? "" },
    { enabled: !!employee?.employeeId, refetchInterval: 30000 }
  );

  // Jobs booked by this rep
  const jobsHistoryQuery = trpc.jobs.listByCreatedBy.useQuery(
    { createdBy: employee?.employeeId ?? "", limit: 200 },
    { enabled: !!employee?.employeeId, refetchInterval: 60000 }
  );

  // Door hanger stats
  const dhStatsQuery = trpc.doorHanger.getStats.useQuery(
    { dateFrom: today, dateTo: today } as any,
    { refetchInterval: 30000 }
  );
  const dhGoalsQuery = trpc.doorHanger.getGoals.useQuery({} as any);

  const [dhStats, setDhStats] = useState<any>(null);
  const [dhGoals, setDhGoals] = useState<any>(null);
  const [suggestedCity, setSuggestedCity] = useState<any>(null);

  // Get suggested door hanger location
  const suggestedCityQuery = trpc.doorHanger.getSuggestedCity.useQuery(
    undefined,
    { refetchInterval: 60000 }
  );

  useEffect(() => {
    if (suggestedCityQuery.data) {
      setSuggestedCity(suggestedCityQuery.data);
    }
  }, [suggestedCityQuery.data]);

  const handleTakeMeThere = async () => {
    if (!suggestedCity?.startingAddress) return;
    
    const address = encodeURIComponent(suggestedCity.startingAddress);
    const url = Platform.OS === 'ios'
      ? `maps://maps.apple.com/?address=${address}`
      : `https://maps.google.com/?q=${address}`;
    
    try {
      await Linking.openURL(url);
      // Clear the suggestion after navigation
      setSuggestedCity(null);
    } catch (err) {
      Alert.alert('Error', 'Could not open maps application');
    }
  };

  useEffect(() => {
    if (dhStatsQuery.data !== undefined || dhStatsQuery.isError) {
      const s = dhStatsQuery.data as any;
      setDhStats(s ? { doorHangers: 0, businessCards: 0, yardSigns: 0, tableToppers: 0, ...s } : { doorHangers: 0, businessCards: 0, yardSigns: 0, tableToppers: 0 });
    }
  }, [dhStatsQuery.data, dhStatsQuery.isError]);

  useEffect(() => {
    if (dhGoalsQuery.data !== undefined || dhGoalsQuery.isError) {
      setDhGoals(dhGoalsQuery.data || { dailyDoorHangerGoal: 50, dailyBusinessCardGoal: 20, dailyYardSignGoal: 2, dailyTableTopperGoal: 5 });
    }
  }, [dhGoalsQuery.data, dhGoalsQuery.isError]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Promise.all([statsQuery.refetch(), callbacksQuery.refetch(), dhStatsQuery.refetch(), dhGoalsQuery.refetch(), jobsHistoryQuery.refetch()]);
    setRefreshing(false);
  }, [statsQuery, callbacksQuery, dhStatsQuery, dhGoalsQuery]);

  const stats: PerfStats = statsQuery.data ?? {
    today: { jobsBooked: 0, revenueScheduled: 0 },
    week: { jobsBooked: 0, revenueScheduled: 0 },
    allTime: { jobsBooked: 0, revenueScheduled: 0 },
  };

  const callbacks = callbacksQuery.data ?? [];
  const scheduledCallbacks = callbacks.filter((c: any) => c.status === "scheduled").length;
  const completedCallbacks = callbacks.filter((c: any) => c.status === "completed").length;
  const conversionRate = (scheduledCallbacks + completedCallbacks) > 0
    ? Math.round((completedCallbacks / (scheduledCallbacks + completedCallbacks)) * 100) : 0;

  const todayJobs = stats.today.jobsBooked;
  const todayRevenue = stats.today.revenueScheduled;
  const todayJobPct = Math.min(Math.round((todayJobs / DAILY_JOBS_GOAL) * 100), 100);

  const motivationalMsg = () => {
    if (todayJobs === 0) return "Let's get that first booking! 💪";
    if (todayJobPct < 50) return "Great start — keep pushing! 🔥";
    if (todayJobPct < 100) return "Almost there — finish strong! ⚡";
    return "Daily goal crushed! You're on fire! 🏆";
  };

  const activeStats = activeTab === "today" ? stats.today : activeTab === "week" ? stats.week : stats.allTime;
  const tabLabel = activeTab === "today" ? "Today" : activeTab === "week" ? "This Week" : "All Time";

  // Door hanger values
  const dh = dhStats?.doorHangers || 0;
  const bc = dhStats?.businessCards || 0;
  const ys = dhStats?.yardSigns || 0;
  const tt = dhStats?.tableToppers || 0;
  const dhGoal = dhGoals?.dailyDoorHangerGoal || 50;
  const bcGoal = dhGoals?.dailyBusinessCardGoal || 20;
  const ysGoal = dhGoals?.dailyYardSignGoal || 2;
  const ttGoal = dhGoals?.dailyTableTopperGoal || 5;
  const totalDH = dh + bc + ys + tt;
  const totalDHGoal = dhGoal + bcGoal + ysGoal + ttGoal;
  const dhOverallPct = Math.min(Math.round((totalDH / Math.max(totalDHGoal, 1)) * 100), 100);
  const dhRingColor = dhOverallPct >= 100 ? "#4ADE80" : dhOverallPct >= 75 ? "#FBBF24" : "#60A5FA";

  const darkBg = "#0D1117";
  const cardBg = "#161B22";

  if (statsQuery.isLoading) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color="#2563EB" />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <>
      <ScreenContainer edges={["left", "right"]} className="flex-1 px-0">
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563EB" />}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* ── Hero Header ── */}
          <View style={{
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 28,
            backgroundColor: "#1E3A8A",
          }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 4 }}>
              {formatDate(new Date())}
            </Text>
            <Text style={{ fontSize: 26, fontWeight: "900", color: "#fff" }}>
              {getGreeting()}, {(employee?.fullName ?? "Team Member").split(" ")[0]}! 👋
            </Text>
            <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 4 }}>
              {motivationalMsg()}
            </Text>

            {/* Today's headline numbers */}
            <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
              <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 14, padding: 14, alignItems: "center" }}>
                <Text style={{ fontSize: 32, fontWeight: "900", color: "#fff" }}>{todayJobs}</Text>
                <Text style={{ fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.7)", marginTop: 2 }}>Jobs Booked</Text>
                <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Goal: {DAILY_JOBS_GOAL}</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 14, padding: 14, alignItems: "center" }}>
                <Text style={{ fontSize: 28, fontWeight: "900", color: "#34D399" }}>{formatCurrency(todayRevenue)}</Text>
                <Text style={{ fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.7)", marginTop: 2 }}>Revenue</Text>
                <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Goal: {formatCurrency(DAILY_REVENUE_GOAL)}</Text>
              </View>
            </View>
          </View>

          {/* ── Door Hanger Suggested Location ── */}
          {suggestedCity && (
            <View style={{ marginHorizontal: 16, marginTop: 20 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>
                📍 Suggested Door Hanger Location
              </Text>
              <View style={{ backgroundColor: "#1E3A8A", borderRadius: 16, padding: 16, gap: 12 }}>
                <View>
                  <Text style={{ fontSize: 22, fontWeight: "900", color: "#fff", marginBottom: 2 }}>
                    {suggestedCity.city}
                  </Text>
                  <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                    {suggestedCity.percentBooked}% booked this week • {suggestedCity.jobCount} scheduled jobs
                  </Text>
                </View>
                <View style={{ backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 12, padding: 12 }}>
                  <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginBottom: 4 }}>Starting Address</Text>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }} numberOfLines={2}>
                    {suggestedCity.startingAddress}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleTakeMeThere}
                  style={{ backgroundColor: "#fff", borderRadius: 12, paddingVertical: 13, alignItems: "center" }}
                >
                  <Text style={{ color: "#1E3A8A", fontWeight: "800", fontSize: 14 }}>📍 Take Me There</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}



          {/* ── Projected Paycheck (Door Hangers) ── */}
          <View style={{ marginHorizontal: 16, marginTop: 20 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>
              Door Hanger Earnings
            </Text>
            <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 28, fontWeight: "900", color: "#34D399" }}>${((dhStats?.doorHangers || 0) * 0.25).toFixed(2)}</Text>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>This Week's Projected Paycheck</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{(dhStats?.doorHangers || 0)} photos × $0.25</Text>
            </View>
          </View>

          {/* ── Period Stats ── */}
          <View style={{ marginHorizontal: 16, marginTop: 20 }}>
            <View style={{ flexDirection: "row", backgroundColor: colors.surface, borderRadius: 12, padding: 4, marginBottom: 14, borderWidth: 1, borderColor: colors.border }}>
              {(["today", "week", "alltime"] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setActiveTab(t);
                  }}
                  style={{ flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 10, backgroundColor: activeTab === t ? "#2563EB" : "transparent" }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "700", color: activeTab === t ? "#fff" : colors.muted }}>
                    {t === "today" ? "Today" : t === "week" ? "Week" : "All Time"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <StatCard label="Jobs Booked" value={String(activeStats.jobsBooked)} sub={tabLabel} accent="#2563EB" icon="📋" colors={colors} />
              <StatCard label="Revenue" value={formatCurrency(activeStats.revenueScheduled)} sub={tabLabel} accent="#9333EA" icon="💰" colors={colors} />
            </View>
          </View>

          {/* ── Jobs Booked History ── */}
          <View style={{ marginHorizontal: 16, marginTop: 20 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>
                Jobs Booked History
              </Text>
              <TouchableOpacity
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowJobsModal(true);
                }}
                style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#2563EB" + "18", borderRadius: 10 }}
              >
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#2563EB" }}>View All →</Text>
              </TouchableOpacity>
            </View>

            {/* Preview: last 3 jobs */}
            {jobsHistoryQuery.isLoading ? (
              <ActivityIndicator size="small" color="#2563EB" style={{ marginVertical: 12 }} />
            ) : (jobsHistoryQuery.data ?? []).length === 0 ? (
              <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 20, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 24, marginBottom: 8 }}>📋</Text>
                <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center" }}>No jobs booked yet.{"\n"}Booked jobs will appear here.</Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {(jobsHistoryQuery.data ?? []).slice(0, 3).map((job: any) => (
                  <JobHistoryRow key={job.jobId} job={job} colors={colors} />
                ))}
                {(jobsHistoryQuery.data ?? []).length > 3 && (
                  <TouchableOpacity
                    onPress={() => setShowJobsModal(true)}
                    style={{ paddingVertical: 12, alignItems: "center", backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}
                  >
                    <Text style={{ color: "#2563EB", fontWeight: "700", fontSize: 13 }}>+ {(jobsHistoryQuery.data ?? []).length - 3} more jobs — View All</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* ── Callbacks Summary ── */}
          <View style={{ marginHorizontal: 16, marginTop: 20 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>
              Callbacks
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <StatCard label="Scheduled" value={String(scheduledCallbacks)} sub="Pending calls" accent="#F59E0B" icon="📞" colors={colors} />
              <StatCard label="Completed" value={String(completedCallbacks)} sub="Calls done" accent="#22C55E" icon="✅" colors={colors} />
              <StatCard label="Conversion" value={`${conversionRate}%`} sub="Rate" accent="#EC4899" icon="🎯" colors={colors} />
            </View>
          </View>

          {/* ── Door Hanger Distribution ── */}
          <View style={{ marginHorizontal: 16, marginTop: 24 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>
                Door Hanger Distribution
              </Text>
              <View style={{ backgroundColor: dhRingColor + "20", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ fontSize: 13, fontWeight: "800", color: dhRingColor }}>{dhOverallPct}% overall</Text>
              </View>
            </View>

            {/* Ring cards */}
            <View style={{ backgroundColor: darkBg, borderRadius: 20, padding: 14, gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <MiniRingCard label="Door Hangers" emoji="🚪" count={dh} goal={dhGoal} accentColor="#60A5FA" bgColor={cardBg} />
                <MiniRingCard label="Business Cards" emoji="💼" count={bc} goal={bcGoal} accentColor="#34D399" bgColor={cardBg} />
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <MiniRingCard label="Yard Signs" emoji="🏷️" count={ys} goal={ysGoal} accentColor="#FB923C" bgColor={cardBg} />
                <MiniRingCard label="Table Toppers" emoji="📋" count={tt} goal={ttGoal} accentColor="#C084FC" bgColor={cardBg} />
              </View>

              {/* Log New Entry button — stays on this screen */}
              <TouchableOpacity
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setShowLogModal(true);
                }}
                style={{
                  backgroundColor: "#2563EB", borderRadius: 14, padding: 16,
                  flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
                  marginTop: 4,
                  shadowColor: "#2563EB", shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
                }}
              >
                <Text style={{ fontSize: 20 }}>📷</Text>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Log New Entry</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Quick Actions ── */}
          <View style={{ marginHorizontal: 16, marginTop: 24 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>
              Quick Actions
            </Text>
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity
                  onPress={() => {}}
                  style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: colors.border }}
                >
                  <Text style={{ fontSize: 20, marginBottom: 4 }}>💬</Text>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>Team Chat</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {}}
                  style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: colors.border }}
                >
                  <Text style={{ fontSize: 20, marginBottom: 4 }}>🎓</Text>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>Training</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      </ScreenContainer>

      {/* ── Log Entry Modal (slides up, stays in context) ── */}
      <Modal
        visible={showLogModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowLogModal(false)}
      >
        <ScreenContainer edges={["left", "right"]} className="flex-1">
          {/* Modal header — includes top safe area so back button is always tappable */}
          <View style={{
            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            paddingHorizontal: 20,
            paddingTop: 16,
            paddingBottom: 14,
            borderBottomWidth: 1, borderBottomColor: colors.border,
            backgroundColor: colors.background,
          }}>
            <TouchableOpacity
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowLogModal(false);
              }}
              style={{
                flexDirection: "row", alignItems: "center", gap: 6,
                paddingVertical: 8, paddingHorizontal: 12,
                backgroundColor: colors.surface, borderRadius: 10,
                borderWidth: 1, borderColor: colors.border,
              }}
            >
              <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "700" }}>←</Text>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>Back to Dashboard</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground }}>Log Entry</Text>
            <View style={{ width: 120 }} />
          </View>

          {/* Logger content */}
          <View style={{ flex: 1 }}>
            <InlinePhotoLogger onClose={() => setShowLogModal(false)} />
          </View>
        </ScreenContainer>
      </Modal>

      {/* ── Jobs History Modal ── */}
      <Modal
        visible={showJobsModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowJobsModal(false)}
      >
        <ScreenContainer edges={["top", "left", "right"]} className="flex-1">
          {/* Header — includes top safe area so back button is always tappable */}
          <View style={{
            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            paddingHorizontal: 20,
            paddingTop: 16,
            paddingBottom: 14,
            borderBottomWidth: 1, borderBottomColor: colors.border,
            backgroundColor: colors.background,
          }}>
            <TouchableOpacity
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowJobsModal(false);
              }}
              style={{
                flexDirection: "row", alignItems: "center", gap: 6,
                paddingVertical: 8, paddingHorizontal: 12,
                backgroundColor: colors.surface, borderRadius: 10,
                borderWidth: 1, borderColor: colors.border,
              }}
            >
              <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "700" }}>←</Text>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>Back to Dashboard</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground }}>Jobs Booked</Text>
            <View style={{ width: 120 }} />
          </View>

          {/* Job count summary */}
          <View style={{ paddingHorizontal: 20, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              <Text style={{ fontWeight: "700", color: colors.foreground }}>{(jobsHistoryQuery.data ?? []).length}</Text> jobs booked by you — newest first
            </Text>
          </View>

          {/* List */}
          {jobsHistoryQuery.isLoading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator size="large" color="#2563EB" />
            </View>
          ) : (jobsHistoryQuery.data ?? []).length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
              <Text style={{ fontSize: 40, marginBottom: 16 }}>📋</Text>
              <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>No jobs yet</Text>
              <Text style={{ color: colors.muted, fontSize: 14, textAlign: "center" }}>Jobs you book will appear here with customer details, service, and status.</Text>
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
            >
              {(jobsHistoryQuery.data ?? []).map((job: any) => (
                <JobHistoryRow key={job.jobId} job={job} colors={colors} />
              ))}
            </ScrollView>
          )}
        </ScreenContainer>
      </Modal>
    </>
  );
}
