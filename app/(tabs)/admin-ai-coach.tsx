import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Alert, Modal, Platform, StyleSheet, Animated,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";

// ─── Types ────────────────────────────────────────────────────────────────────
type Period = "this_week" | "last_30_days" | "all_time";
type Location = "all" | "crestview" | "niceville" | "destin" | "fwb" | "pensacola";
type TabId = "coach" | "quickbook" | "route";

interface Insight {
  category: string;
  emoji: string;
  severity: "Critical" | "Warning" | "Positive";
  title: string;
  detail: string;
  recommendation: string;
}

interface CoachResult {
  score: number;
  scoreLabel: string;
  summary: string;
  insights: Insight[];
  stats: {
    totalJobs: number;
    totalRevenue: number;
    totalHours: number;
    totalUpsells: number;
    avgPerJob: string;
    upsellRate: string;
    location: string;
  };
}

interface ParsedBooking {
  customerName?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  vehicleType?: string | null;
  serviceType?: string | null;
  addons?: string | null;
  detailerName?: string | null;
  preferredDay?: string | null;
  preferredTime?: string | null;
  notes?: string | null;
  price?: string;
  autoAssigned?: string;
  [key: string]: string | null | undefined;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const LOCATIONS: { id: Location; label: string; emoji: string }[] = [
  { id: "all", label: "All Locations", emoji: "🌐" },
  { id: "crestview", label: "Crestview", emoji: "📍" },
  { id: "niceville", label: "Niceville", emoji: "📍" },
  { id: "destin", label: "Destin", emoji: "📍" },
  { id: "fwb", label: "Fort Walton", emoji: "📍" },
  { id: "pensacola", label: "Pensacola", emoji: "📍" },
];

const PERIODS: { id: Period; label: string }[] = [
  { id: "this_week", label: "This Week" },
  { id: "last_30_days", label: "Last 30 Days" },
  { id: "all_time", label: "All Time" },
];

const SEVERITY_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  Critical: { bg: "#EF444412", border: "#EF444430", text: "#EF4444", badge: "#EF4444" },
  Warning: { bg: "#F59E0B12", border: "#F59E0B30", text: "#F59E0B", badge: "#F59E0B" },
  Positive: { bg: "#22C55E12", border: "#22C55E30", text: "#22C55E", badge: "#22C55E" },
};

const SCORE_COLOR = (score: number) => {
  if (score >= 80) return "#22C55E";
  if (score >= 60) return "#F59E0B";
  return "#EF4444";
};

// ─── Score Ring Component ─────────────────────────────────────────────────────
function ScoreRing({ score, label }: { score: number; label: string }) {
  const color = SCORE_COLOR(score);
  const size = 140;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;

  return (
    <View style={{ alignItems: "center", gap: 8 }}>
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        {/* Background ring */}
        <View style={{
          position: "absolute", width: size, height: size, borderRadius: size / 2,
          borderWidth: strokeWidth, borderColor: "#333",
        }} />
        {/* Progress arc — simulated with a colored ring overlay */}
        <View style={{
          position: "absolute", width: size, height: size, borderRadius: size / 2,
          borderWidth: strokeWidth, borderColor: color,
          borderTopColor: score < 25 ? "#333" : color,
          borderRightColor: score < 50 ? "#333" : color,
          borderBottomColor: score < 75 ? "#333" : color,
          transform: [{ rotate: "-90deg" }],
        }} />
        <View style={{ alignItems: "center" }}>
          <Text style={{ fontSize: 36, fontWeight: "800", color }}>{score}</Text>
          <Text style={{ fontSize: 12, color: "#888", marginTop: -4 }}>/ 100</Text>
        </View>
      </View>
      <View style={{
        paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20,
        borderWidth: 1, borderColor: color + "44", backgroundColor: color + "18",
      }}>
        <Text style={{ color, fontWeight: "700", fontSize: 13 }}>{label}</Text>
      </View>
    </View>
  );
}

// ─── Insight Card ─────────────────────────────────────────────────────────────
function InsightCard({ insight }: { insight: Insight }) {
  const [expanded, setExpanded] = useState(false);
  const colors = SEVERITY_COLORS[insight.severity] ?? SEVERITY_COLORS.Warning;

  return (
    <TouchableOpacity
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.85}
      style={[s.insightCard, { backgroundColor: colors.bg, borderColor: colors.border }]}
    >
      <View style={s.insightHeader}>
        <View style={s.insightCategoryRow}>
          <Text style={{ fontSize: 20 }}>{insight.emoji}</Text>
          <Text style={{ fontSize: 11, fontWeight: "700", color: "#888", letterSpacing: 1 }}>
            {insight.category}
          </Text>
        </View>
        <View style={[s.severityBadge, { backgroundColor: colors.badge + "22", borderColor: colors.badge + "44" }]}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.badge }}>
            {insight.severity === "Positive" ? "✅" : insight.severity === "Critical" ? "🚨" : "⚠️"} {insight.severity}
          </Text>
        </View>
      </View>
      <Text style={[s.insightTitle, { color: "#fff" }]}>{insight.title}</Text>
      <Text style={{ fontSize: 13, color: "#aaa", lineHeight: 19, marginTop: 4 }} numberOfLines={expanded ? undefined : 3}>
        {insight.detail}
      </Text>
      {expanded && (
        <View style={[s.recommendationBox, { backgroundColor: "#ffffff08", borderColor: "#ffffff15" }]}>
          <Text style={{ fontSize: 13, color: "#ddd", lineHeight: 19 }}>
            💡 {insight.recommendation}
          </Text>
        </View>
      )}
      <Text style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
        {expanded ? "▲ Less" : "▼ More"}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function AdminAICoachScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>("coach");

  // ── Business Coach state ──────────────────────────────────────────────────
  const [selectedLocation, setSelectedLocation] = useState<Location>("all");
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("this_week");
  const [coachResult, setCoachResult] = useState<CoachResult | null>(null);
  const [lastRunLabel, setLastRunLabel] = useState<string | null>(null);
  const businessCoachMutation = trpc.ai.businessCoach.useMutation();

  const runAnalysis = async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await businessCoachMutation.mutateAsync({
        location: selectedLocation,
        period: selectedPeriod,
      });
      setCoachResult(result as unknown as CoachResult);
      const now = new Date();
      const locationLabel = LOCATIONS.find(l => l.id === selectedLocation)?.label ?? "All Locations";
      setLastRunLabel(`${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${locationLabel}`);
    } catch (e: unknown) {
      Alert.alert("Analysis Failed", e instanceof Error ? e.message : "Please try again.");
    }
  };

  // ── Quick Book state ──────────────────────────────────────────────────────
  const [bookingText, setBookingText] = useState("");
  const [parsedBooking, setParsedBooking] = useState<ParsedBooking | null>(null);
  const [showBookingPreview, setShowBookingPreview] = useState(false);
  const parseBookingMutation = trpc.ai.parseBooking.useMutation();
  const transcribeVoiceMutation = trpc.ai.transcribeVoice.useMutation();
  const createJobMutation = trpc.ai.createJobFromQuickBook.useMutation();
  // ── Quick Book: date/time/location pickers for missing fields ─────────────
  const [qbDate, setQbDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [qbStartHour, setQbStartHour] = useState(9);
  const [qbLocation, setQbLocation] = useState("crestview");
  const [jobCreated, setJobCreated] = useState<{ jobId: string; date: string; location: string; timeSlot: string } | null>(null);
  const CITY_SLUGS: Record<string, string> = {
    crestview: "crestview", niceville: "niceville", destin: "destin",
    "fort walton": "fwb", "fort walton beach": "fwb", fwb: "fwb", pensacola: "pensacola",
  };
  const detectLocationSlug = (city: string | null | undefined): string => {
    if (!city) return qbLocation;
    const lower = city.toLowerCase();
    for (const [key, slug] of Object.entries(CITY_SLUGS)) {
      if (lower.includes(key)) return slug;
    }
    return qbLocation;
  };
  const TIME_SLOTS = [
    { label: "7:00 AM", hour: 7 }, { label: "8:00 AM", hour: 8 }, { label: "9:00 AM", hour: 9 },
    { label: "10:00 AM", hour: 10 }, { label: "11:00 AM", hour: 11 }, { label: "12:00 PM", hour: 12 },
    { label: "1:00 PM", hour: 13 }, { label: "2:00 PM", hour: 14 }, { label: "3:00 PM", hour: 15 },
    { label: "4:00 PM", hour: 16 }, { label: "5:00 PM", hour: 17 },
  ];
  const QB_LOCATIONS = [
    { id: "crestview", label: "Crestview" }, { id: "niceville", label: "Niceville" },
    { id: "destin", label: "Destin" }, { id: "fwb", label: "Fort Walton" },
    { id: "pensacola", label: "Pensacola" },
  ];
  const confirmQuickBook = async () => {
    if (!parsedBooking) return;
    if (!parsedBooking.customerName) {
      Alert.alert("Missing Info", "Customer name is required."); return;
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const startH = qbStartHour;
      const endH = startH + 2;
      const locationSlug = detectLocationSlug(parsedBooking.city) || qbLocation;
      const result = await createJobMutation.mutateAsync({
        customerName: parsedBooking.customerName!,
        phone: parsedBooking.phone,
        email: parsedBooking.email,
        address: parsedBooking.address,
        city: parsedBooking.city,
        location: locationSlug,
        vehicleType: parsedBooking.vehicleType,
        serviceType: parsedBooking.serviceType,
        addons: parsedBooking.addons,
        detailerName: parsedBooking.detailerName,
        date: qbDate,
        startHour: startH,
        endHour: endH,
        price: parsedBooking.price,
        notes: parsedBooking.notes,
        createdBy: employee?.employeeId ?? "admin",
      });
      setJobCreated(result);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      Alert.alert("Booking Failed", e instanceof Error ? e.message : "Could not create the job. Please try again.");
    }
  };

  // ── Voice recording for Quick Book ───────────────────────────────────────
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const [isTranscribing, setIsTranscribing] = useState(false);

  useEffect(() => {
    // Request mic permission on mount
    requestRecordingPermissionsAsync();
    if (Platform.OS !== "web") {
      setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    }
  }, []);

  const startVoiceRecording = async () => {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert("Microphone Access", "Please allow microphone access in Settings to use voice input.");
        return;
      }
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch (e) {
      Alert.alert("Recording Error", "Could not start recording. Please try again.");
    }
  };

  const stopVoiceRecording = async () => {
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) return;
      setIsTranscribing(true);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Read the recorded file as base64 and send to server for transcription
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const result = await transcribeVoiceMutation.mutateAsync({ audioBase64: base64, mimeType: "audio/m4a" });
      if (result.text) {
        setBookingText((prev) => prev ? prev + " " + result.text : result.text);
      }
    } catch (e) {
      Alert.alert("Transcription Failed", "Could not transcribe audio. Please type the booking details manually.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const parseBooking = async () => {
    if (!bookingText.trim()) {
      Alert.alert("Enter booking details", "Type the customer name, service, and address.");
      return;
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await parseBookingMutation.mutateAsync({ text: bookingText });
      setParsedBooking(result as ParsedBooking);
      setShowBookingPreview(true);
    } catch (e: unknown) {
      Alert.alert("Parse Failed", e instanceof Error ? e.message : "Please try again.");
    }
  };

  // ── Route Optimizer state ─────────────────────────────────────────────────
  const [routeLocation, setRouteLocation] = useState<string>("crestview");
  const [routeDate, setRouteDate] = useState(new Date().toISOString().split("T")[0]);
  const [routePeriod, setRoutePeriod] = useState<"today" | "week">("today");
  const [routeResult, setRouteResult] = useState<string | null>(null);
  const [routeWeekLoading, setRouteWeekLoading] = useState(false);
  const optimizeRouteMutation = trpc.ai.optimizeRoute.useMutation();

  // Helper: get Mon–Sun dates for the current week (CST)
  const getWeekDates = (): string[] => {
    const toCST = (d: Date) => new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
    const now = new Date();
    const cstStr = toCST(now);
    const cstDate = new Date(cstStr + "T12:00:00");
    const day = cstDate.getDay();
    const monday = new Date(cstDate);
    monday.setDate(cstDate.getDate() - (day === 0 ? 6 : day - 1));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return toCST(d);
    });
  };

  const optimizeRoute = async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (routePeriod === "today") {
      try {
        const result = await optimizeRouteMutation.mutateAsync({ location: routeLocation, date: routeDate });
        if (result.route) {
          setRouteResult(result.route);
        } else {
          Alert.alert("No Jobs Found", result.message ?? `No jobs found for ${routeLocation} on ${routeDate}.`);
        }
      } catch (e: unknown) {
        Alert.alert("Optimization Failed", e instanceof Error ? e.message : "Please try again.");
      }
    } else {
      // Week mode: run optimizer for each day and combine
      setRouteWeekLoading(true);
      setRouteResult(null);
      try {
        const dates = getWeekDates();
        const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        const results: string[] = [];
        for (let i = 0; i < dates.length; i++) {
          try {
            const result = await optimizeRouteMutation.mutateAsync({ location: routeLocation, date: dates[i] });
            if (result.route) {
              results.push(`── ${dayNames[i]} ${dates[i]} ──\n${result.route}`);
            } else {
              results.push(`── ${dayNames[i]} ${dates[i]} ──\nNo jobs scheduled.`);
            }
          } catch {
            results.push(`── ${dayNames[i]} ${dates[i]} ──\nFailed to load.`);
          }
        }
        setRouteResult(results.join("\n\n"));
      } finally {
        setRouteWeekLoading(false);
      }
    }
  };

  const SERVICE_LABELS: Record<string, string> = {
    basic: "Basic Detail", full: "Full Detail", luxury: "Luxury Detail",
    interior: "Interior Detail", exterior: "Exterior Detail",
  };
  const VEHICLE_LABELS: Record<string, string> = {
    sedan: "Sedan/Car", suv: "SUV", xl_suv_van: "XL SUV/Van", truck: "Truck",
  };

  return (
    <ScreenContainer edges={[]} containerClassName="bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* ── Header ── */}
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 26, fontWeight: "800", color: "#fff" }}>🤖 AI Business Coach</Text>
            <Text style={{ fontSize: 13, color: "#888", marginTop: 2 }}>
              Analyzes your real job data and surfaces specific areas to improve.
            </Text>
          </View>
        </View>

        {/* ── Tab Bar ── */}
        <View style={[s.tabBar, { borderBottomColor: colors.border }]}>
          {([
            { id: "coach" as TabId, label: "✨ Coach", },
            { id: "quickbook" as TabId, label: "⚡ Quick Book" },
            { id: "route" as TabId, label: "🗺️ Route" },
          ] as { id: TabId; label: string }[]).map((tab) => (
            <TouchableOpacity
              key={tab.id}
              onPress={() => {
                setActiveTab(tab.id);
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              activeOpacity={0.8}
              style={[s.tabBtn, activeTab === tab.id && { borderBottomColor: "#2563EB", borderBottomWidth: 2 }]}
            >
              <Text style={{ fontSize: 13, fontWeight: "700", color: activeTab === tab.id ? "#2563EB" : "#888" }}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB: BUSINESS COACH
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === "coach" && (
          <View style={s.tabContent}>
            {/* Filters card */}
            <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={s.filterLabel}>LOCATION</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: "row", gap: 8, paddingRight: 8 }}>
                  {LOCATIONS.map((loc) => (
                    <TouchableOpacity
                      key={loc.id}
                      onPress={() => setSelectedLocation(loc.id)}
                      activeOpacity={0.8}
                      style={[s.filterChip, selectedLocation === loc.id && { backgroundColor: "#2563EB", borderColor: "#2563EB" }]}
                    >
                      <Text style={{ fontSize: 13, fontWeight: "600", color: selectedLocation === loc.id ? "#fff" : "#aaa" }}>
                        {loc.emoji} {loc.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={s.filterLabel}>ANALYSIS PERIOD</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                {PERIODS.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => setSelectedPeriod(p.id)}
                    activeOpacity={0.8}
                    style={[s.filterChip, { flex: 1, justifyContent: "center" }, selectedPeriod === p.id && { backgroundColor: "#2563EB", borderColor: "#2563EB" }]}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "600", color: selectedPeriod === p.id ? "#fff" : "#aaa", textAlign: "center" }}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                onPress={runAnalysis}
                disabled={businessCoachMutation.isPending}
                activeOpacity={0.85}
                style={[s.primaryBtn, businessCoachMutation.isPending && { opacity: 0.6 }]}
              >
                {businessCoachMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={s.primaryBtnText}>{coachResult ? "🔄 Re-run Analysis" : "✨ Run AI Analysis"}</Text>
                )}
              </TouchableOpacity>
              {lastRunLabel && (
                <Text style={{ fontSize: 12, color: "#666", textAlign: "center", marginTop: 8 }}>
                  Last run: {lastRunLabel}
                </Text>
              )}
            </View>

            {/* Results */}
            {!coachResult && !businessCoachMutation.isPending && (
              <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border, alignItems: "center", paddingVertical: 40 }]}>
                <Text style={{ fontSize: 48, marginBottom: 12 }}>🤖</Text>
                <Text style={{ fontSize: 18, fontWeight: "700", color: "#fff", marginBottom: 8 }}>Ready to Analyze</Text>
                <Text style={{ fontSize: 14, color: "#888", textAlign: "center", lineHeight: 20 }}>
                  Select a time period above and tap Run AI Analysis to get specific insights about your business performance, drive times, booking patterns, and team efficiency.
                </Text>
              </View>
            )}

            {businessCoachMutation.isPending && (
              <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border, alignItems: "center", paddingVertical: 40 }]}>
                <ActivityIndicator size="large" color="#2563EB" />
                <Text style={{ fontSize: 15, color: "#888", marginTop: 16 }}>Analyzing your data...</Text>
              </View>
            )}

            {coachResult && !businessCoachMutation.isPending && (
              <>
                {/* Health Score */}
                <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border, alignItems: "center" }]}>
                  <Text style={[s.filterLabel, { marginBottom: 16 }]}>BUSINESS HEALTH SCORE</Text>
                  <Text style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
                    {LOCATIONS.find(l => l.id === selectedLocation)?.label ?? "All Locations"} · {PERIODS.find(p => p.id === selectedPeriod)?.label ?? "This Week"}
                  </Text>
                  <ScoreRing score={coachResult.score} label={coachResult.scoreLabel} />
                  <Text style={{ fontSize: 14, color: "#bbb", textAlign: "center", lineHeight: 21, marginTop: 16 }}>
                    {coachResult.summary}
                  </Text>
                </View>

                {/* Stats row */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: 16, marginBottom: 4 }}>
                  <View style={{ flexDirection: "row", gap: 10, paddingRight: 8 }}>
                    {[
                      { label: "Jobs", value: String(coachResult.stats.totalJobs) },
                      { label: "Revenue", value: `$${Number(coachResult.stats.totalRevenue).toLocaleString()}` },
                      { label: "Avg/Job", value: `$${coachResult.stats.avgPerJob}` },
                      { label: "Upsell Rate", value: `${coachResult.stats.upsellRate}%` },
                      ...((coachResult.stats as any).revenuePerLaborHour ? [{ label: "Rev/Hr", value: `$${(coachResult.stats as any).revenuePerLaborHour}` }] : []),
                      ...((coachResult.stats as any).laborCostRatio ? [{ label: "Labor %", value: `${(coachResult.stats as any).laborCostRatio}%` }] : []),
                      ...((coachResult.stats as any).avgJobsPerDay ? [{ label: "Jobs/Day", value: (coachResult.stats as any).avgJobsPerDay }] : []),
                    ].map((stat) => (
                      <View key={stat.label} style={[s.statChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <Text style={{ fontSize: 16, fontWeight: "800", color: "#fff" }}>{stat.value}</Text>
                        <Text style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{stat.label}</Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>

                {/* Insights */}
                {coachResult.insights.length > 0 && (
                  <View style={{ paddingHorizontal: 16 }}>
                    <Text style={[s.filterLabel, { marginBottom: 12, marginTop: 8 }]}>INSIGHTS & RECOMMENDATIONS</Text>
                    {coachResult.insights.map((insight, i) => (
                      <InsightCard key={i} insight={insight} />
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            TAB: QUICK BOOK
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === "quickbook" && (
          <View style={s.tabContent}>
            <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: 20, fontWeight: "800", color: "#fff", marginBottom: 4 }}>⚡ AI Quick Book</Text>
              <Text style={{ fontSize: 13, color: "#888", marginBottom: 20 }}>
                Describe a booking in plain English and AI will extract all the details automatically.
              </Text>

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text style={s.filterLabel}>BOOKING DETAILS</Text>
                {/* Voice input button */}
                <TouchableOpacity
                  onPress={recorderState.isRecording ? stopVoiceRecording : startVoiceRecording}
                  disabled={isTranscribing}
                  activeOpacity={0.8}
                  style={[
                    {
                      flexDirection: "row", alignItems: "center", gap: 6,
                      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
                      borderWidth: 1,
                    },
                    recorderState.isRecording
                      ? { backgroundColor: "#EF444420", borderColor: "#EF4444" }
                      : { backgroundColor: "#0a7ea420", borderColor: "#0a7ea4" },
                  ]}
                >
                  {isTranscribing ? (
                    <ActivityIndicator size="small" color="#0a7ea4" />
                  ) : (
                    <Text style={{ fontSize: 16 }}>{recorderState.isRecording ? "⏹" : "🎙"}</Text>
                  )}
                  <Text style={{
                    fontSize: 12, fontWeight: "700",
                    color: recorderState.isRecording ? "#EF4444" : "#0a7ea4",
                  }}>
                    {isTranscribing ? "Transcribing..." : recorderState.isRecording ? "Stop" : "Speak"}
                  </Text>
                </TouchableOpacity>
              </View>
              <TextInput
                value={bookingText}
                onChangeText={setBookingText}
                placeholder={`e.g. Book John Smith, 850-555-1234, john@email.com for a luxury detail on his SUV at 420 Harbor Blvd Destin. Assign to Casey, Thursday.`}
                placeholderTextColor="#555"
                multiline
                numberOfLines={5}
                style={[s.textArea, { color: "#fff", borderColor: recorderState.isRecording ? "#EF4444" : colors.border }]}
                returnKeyType="done"
              />
              {recorderState.isRecording && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#EF4444" }} />
                  <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "600" }}>Recording... tap Stop when done</Text>
                </View>
              )}
              <Text style={{ fontSize: 12, color: "#666", marginTop: 8, lineHeight: 18 }}>
                Tap 🎙 to speak the booking details, or type below. Include: name · phone · service · vehicle · address · city · preferred day
              </Text>

              <TouchableOpacity
                onPress={parseBooking}
                disabled={parseBookingMutation.isPending || !bookingText.trim()}
                activeOpacity={0.85}
                style={[s.primaryBtn, { marginTop: 16 }, (parseBookingMutation.isPending || !bookingText.trim()) && { opacity: 0.5 }]}
              >
                {parseBookingMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={s.primaryBtnText}>Parse & Preview Booking →</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Booking Preview Modal */}
            <Modal
              visible={showBookingPreview}
              animationType="slide"
              presentationStyle="pageSheet"
              onRequestClose={() => { setShowBookingPreview(false); setJobCreated(null); }}
            >
              <View style={{ flex: 1, backgroundColor: "#0d0d0d" }}>
                {/* Header */}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: "#222" }}>
                  <Text style={{ fontSize: 18, fontWeight: "800", color: "#fff" }}>
                    {jobCreated ? "✅ Job Created!" : "📋 Booking Preview"}
                  </Text>
                  <TouchableOpacity onPress={() => { setShowBookingPreview(false); setJobCreated(null); }} activeOpacity={0.7}>
                    <Text style={{ fontSize: 22, color: "#888" }}>✕</Text>
                  </TouchableOpacity>
                </View>

                {jobCreated ? (
                  /* ── Success State ── */
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 }}>
                    <Text style={{ fontSize: 64 }}>🎉</Text>
                    <Text style={{ fontSize: 22, fontWeight: "800", color: "#22C55E", textAlign: "center" }}>Job Added to Schedule!</Text>
                    <View style={{ backgroundColor: "#22C55E18", borderColor: "#22C55E44", borderWidth: 1, borderRadius: 14, padding: 16, width: "100%", gap: 8 }}>
                      <Text style={{ fontSize: 14, color: "#22C55E", fontWeight: "700" }}>📅 {jobCreated.date}</Text>
                      <Text style={{ fontSize: 14, color: "#22C55E", fontWeight: "700" }}>🕐 {jobCreated.timeSlot}</Text>
                      <Text style={{ fontSize: 14, color: "#22C55E", fontWeight: "700" }}>📍 {QB_LOCATIONS.find(l => l.id === jobCreated.location)?.label ?? jobCreated.location}</Text>
                      <Text style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Job ID: {jobCreated.jobId}</Text>
                    </View>
                    <Text style={{ fontSize: 14, color: "#888", textAlign: "center", lineHeight: 20 }}>
                      The job is now live on the schedule. Open the Schedule tab to view and manage it.
                    </Text>
                    <TouchableOpacity
                      onPress={() => { setShowBookingPreview(false); setJobCreated(null); setBookingText(""); setParsedBooking(null); }}
                      activeOpacity={0.85}
                      style={[s.primaryBtn, { width: "100%" }]}
                    >
                      <Text style={s.primaryBtnText}>Done — Book Another</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
                    {parsedBooking && (
                      <>
                        {parsedBooking.autoAssigned === "true" && (
                          <View style={{ backgroundColor: "#2563EB18", borderColor: "#2563EB44", borderWidth: 1, borderRadius: 10, padding: 12 }}>
                            <Text style={{ color: "#2563EB", fontSize: 13 }}>ℹ️ Team member auto-assigned based on city</Text>
                          </View>
                        )}

                        {/* Parsed fields */}
                        {[
                          { label: "Customer", value: parsedBooking.customerName },
                          { label: "Phone", value: parsedBooking.phone },
                          { label: "Email", value: parsedBooking.email },
                          { label: "Address", value: parsedBooking.address },
                          { label: "City", value: parsedBooking.city },
                          { label: "Vehicle", value: parsedBooking.vehicleType ? VEHICLE_LABELS[parsedBooking.vehicleType] ?? parsedBooking.vehicleType : null },
                          { label: "Service", value: parsedBooking.serviceType ? SERVICE_LABELS[parsedBooking.serviceType] ?? parsedBooking.serviceType : null },
                          { label: "Add-ons", value: parsedBooking.addons },
                          { label: "Team Member", value: parsedBooking.detailerName },
                          { label: "Notes", value: parsedBooking.notes },
                          { label: "Est. Price", value: parsedBooking.price ? `$${parsedBooking.price}` : null },
                        ].filter(row => row.value).map((row) => (
                          <View key={row.label} style={{ flexDirection: "row", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1a1a1a" }}>
                            <Text style={{ fontSize: 13, color: "#666", width: 110 }}>{row.label}</Text>
                            <Text style={{ fontSize: 13, color: "#fff", flex: 1, fontWeight: "500" }}>{row.value}</Text>
                          </View>
                        ))}

                        {/* ── Schedule Details (required) ── */}
                        <View style={{ marginTop: 8, backgroundColor: "#111", borderRadius: 14, borderWidth: 1, borderColor: "#222", padding: 14, gap: 14 }}>
                          <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff", marginBottom: 4 }}>📅 Schedule Details</Text>

                          {/* Date */}
                          <View>
                            <Text style={[s.filterLabel, { marginBottom: 6 }]}>DATE</Text>
                            <TextInput
                              value={qbDate}
                              onChangeText={setQbDate}
                              placeholder="YYYY-MM-DD"
                              placeholderTextColor="#555"
                              style={[s.textInput, { color: "#fff", borderColor: "#333" }]}
                              returnKeyType="done"
                            />
                            {parsedBooking.preferredDay && (
                              <Text style={{ fontSize: 12, color: "#666", marginTop: 4 }}>AI detected: "{parsedBooking.preferredDay}" — enter the exact date above</Text>
                            )}
                          </View>

                          {/* Start Time */}
                          <View>
                            <Text style={[s.filterLabel, { marginBottom: 6 }]}>START TIME</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                              <View style={{ flexDirection: "row", gap: 8, paddingRight: 8 }}>
                                {TIME_SLOTS.map((slot) => (
                                  <TouchableOpacity
                                    key={slot.hour}
                                    onPress={() => setQbStartHour(slot.hour)}
                                    activeOpacity={0.8}
                                    style={[s.filterChip, qbStartHour === slot.hour && { backgroundColor: "#2563EB", borderColor: "#2563EB" }]}
                                  >
                                    <Text style={{ fontSize: 12, fontWeight: "600", color: qbStartHour === slot.hour ? "#fff" : "#aaa" }}>
                                      {slot.label}
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            </ScrollView>
                            {parsedBooking.preferredTime && (
                              <Text style={{ fontSize: 12, color: "#666", marginTop: 4 }}>AI detected: "{parsedBooking.preferredTime}"</Text>
                            )}
                          </View>

                          {/* Location */}
                          <View>
                            <Text style={[s.filterLabel, { marginBottom: 6 }]}>CITY / LOCATION</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                              <View style={{ flexDirection: "row", gap: 8, paddingRight: 8 }}>
                                {QB_LOCATIONS.map((loc) => (
                                  <TouchableOpacity
                                    key={loc.id}
                                    onPress={() => setQbLocation(loc.id)}
                                    activeOpacity={0.8}
                                    style={[s.filterChip, qbLocation === loc.id && { backgroundColor: "#2563EB", borderColor: "#2563EB" }]}
                                  >
                                    <Text style={{ fontSize: 12, fontWeight: "600", color: qbLocation === loc.id ? "#fff" : "#aaa" }}>
                                      {loc.label}
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            </ScrollView>
                            {parsedBooking.city && (
                              <Text style={{ fontSize: 12, color: "#666", marginTop: 4 }}>AI detected city: "{parsedBooking.city}"</Text>
                            )}
                          </View>
                        </View>

                        {/* Confirm Button */}
                        <TouchableOpacity
                          onPress={confirmQuickBook}
                          disabled={createJobMutation.isPending || !qbDate.match(/^\d{4}-\d{2}-\d{2}$/)}
                          activeOpacity={0.85}
                          style={[s.primaryBtn, { marginTop: 8 }, (createJobMutation.isPending || !qbDate.match(/^\d{4}-\d{2}-\d{2}$/)) && { opacity: 0.5 }]}
                        >
                          {createJobMutation.isPending ? (
                            <ActivityIndicator color="#fff" size="small" />
                          ) : (
                            <Text style={s.primaryBtnText}>✅ Confirm & Add to Schedule</Text>
                          )}
                        </TouchableOpacity>
                        {!qbDate.match(/^\d{4}-\d{2}-\d{2}$/) && (
                          <Text style={{ fontSize: 12, color: "#EF4444", textAlign: "center" }}>Enter a valid date (YYYY-MM-DD) to confirm</Text>
                        )}
                      </>
                    )}
                  </ScrollView>
                )}
              </View>
            </Modal>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            TAB: ROUTE OPTIMIZER
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === "route" && (
          <View style={s.tabContent}>
            <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: 20, fontWeight: "800", color: "#fff", marginBottom: 4 }}>🗺️ Route Optimizer</Text>
              <Text style={{ fontSize: 13, color: "#888", marginBottom: 20 }}>
                AI orders jobs by date or week to minimize drive time between stops.
              </Text>

              <Text style={[s.filterLabel, { marginBottom: 8 }]}>LOCATION</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: "row", gap: 8, paddingRight: 8 }}>
                  {LOCATIONS.filter(l => l.id !== "all").map((loc) => (
                    <TouchableOpacity
                      key={loc.id}
                      onPress={() => setRouteLocation(loc.id)}
                      activeOpacity={0.8}
                      style={[s.filterChip, routeLocation === loc.id && { backgroundColor: "#2563EB", borderColor: "#2563EB" }]}
                    >
                      <Text style={{ fontSize: 13, fontWeight: "600", color: routeLocation === loc.id ? "#fff" : "#aaa" }}>
                        {loc.emoji} {loc.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={[s.filterLabel, { marginBottom: 8 }]}>DATE RANGE</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                {(["today", "week"] as const).map((p) => (
                  <TouchableOpacity
                    key={p}
                    onPress={() => { setRoutePeriod(p); setRouteResult(null); }}
                    activeOpacity={0.8}
                    style={{
                      flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center",
                      backgroundColor: routePeriod === p ? "#2563EB" : "#1C1C1E",
                      borderWidth: 1, borderColor: routePeriod === p ? "#2563EB" : "#333",
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "700", color: routePeriod === p ? "#fff" : "#aaa" }}>
                      {p === "today" ? "Today" : "This Week"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {routePeriod === "today" && (
                <>
                  <Text style={[s.filterLabel, { marginBottom: 8 }]}>DATE</Text>
                  <TextInput
                    value={routeDate}
                    onChangeText={setRouteDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#555"
                    style={[s.textInput, { color: "#fff", borderColor: colors.border }]}
                    returnKeyType="done"
                  />
                </>
              )}
              {routePeriod === "week" && (
                <Text style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
                  Runs the optimizer for each day this week (Mon–Sun) and combines results.
                </Text>
              )}
              <TouchableOpacity
                onPress={optimizeRoute}
                disabled={optimizeRouteMutation.isPending || routeWeekLoading}
                activeOpacity={0.85}
                style={[s.primaryBtn, { marginTop: 16 }, (optimizeRouteMutation.isPending || routeWeekLoading) && { opacity: 0.6 }]}
              >
                {(optimizeRouteMutation.isPending || routeWeekLoading) ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={s.primaryBtnText}>🗺️ Optimize {routePeriod === "week" ? "Week" : "Route"}</Text>
                )}
              </TouchableOpacity>
            </View>

            {routeResult && (
              <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[s.filterLabel, { marginBottom: 12 }]}>OPTIMIZED ROUTE</Text>
                <Text style={{ fontSize: 14, color: "#ddd", lineHeight: 22, whiteSpace: "pre-wrap" } as any}>
                  {routeResult}
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingHorizontal: 8,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabContent: {
    paddingTop: 16,
    gap: 12,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  filterLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#666",
    letterSpacing: 1,
    marginBottom: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#333",
    backgroundColor: "#1a1a1a",
  },
  primaryBtn: {
    backgroundColor: "#2563EB",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
  insightCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  insightHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  insightCategoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  insightTitle: {
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  severityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  recommendationBox: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  statChip: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    alignItems: "center",
    minWidth: 80,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 120,
    textAlignVertical: "top",
    backgroundColor: "#111",
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    backgroundColor: "#111",
  },
});
