import { ScrollView, Text, View, TouchableOpacity, ActivityIndicator, Platform, Dimensions } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { useEffect, useState, useCallback } from "react";
import { useAfter5pmCheckIn } from "@/hooks/use-after-5pm-check-in";
import { useBreakNotifications } from "@/hooks/use-break-notifications";
import * as Haptics from "expo-haptics";
import { HeaderClockStatus } from "@/components/header-clock-status";
import { useRouter } from "expo-router";
import Svg, { Circle } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width: SCREEN_W } = Dimensions.get("window");

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getMotivation(pct: number): string {
  if (pct === 0) return "Let's get started — every door counts! 🚀";
  if (pct < 25) return "Great start! Keep the momentum going 💪";
  if (pct < 50) return "You're making progress — halfway there! 🔥";
  if (pct < 75) return "Strong work! Almost at your goal 🎯";
  if (pct < 100) return "So close! Push through to the finish line ⚡";
  return "Goal crushed! Outstanding performance today 🏆";
}

// Circular progress ring using SVG
function RingProgress({
  size,
  strokeWidth,
  percent,
  color,
  bgColor,
  children,
}: {
  size: number;
  strokeWidth: number;
  percent: number;
  color: string;
  bgColor: string;
  children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        {/* Background ring */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={bgColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress ring */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      {children}
    </View>
  );
}

interface MiniRingCardProps {
  label: string;
  emoji: string;
  count: number;
  goal: number;
  accentColor: string;
  bgColor: string;
}

function MiniRingCard({ label, emoji, count, goal, accentColor, bgColor }: MiniRingCardProps) {
  const pct = Math.min(Math.round((count / Math.max(goal, 1)) * 100), 100);
  const isComplete = count >= goal;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: bgColor,
        borderRadius: 18,
        padding: 14,
        alignItems: "center",
        gap: 8,
        borderWidth: 1.5,
        borderColor: isComplete ? accentColor + "80" : "rgba(255,255,255,0.08)",
      }}
    >
      <RingProgress
        size={64}
        strokeWidth={6}
        percent={pct}
        color={isComplete ? accentColor : accentColor + "CC"}
        bgColor="rgba(255,255,255,0.1)"
      >
        <Text style={{ fontSize: 20 }}>{emoji}</Text>
      </RingProgress>
      <View style={{ alignItems: "center", gap: 2 }}>
        <Text style={{ fontSize: 18, fontWeight: "900", color: "#fff" }}>{count}</Text>
        <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", fontWeight: "600" }}>of {goal}</Text>
        <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", fontWeight: "700", textAlign: "center" }} numberOfLines={1}>
          {label}
        </Text>
      </View>
      {isComplete && (
        <View style={{ backgroundColor: accentColor + "30", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ fontSize: 10, color: accentColor, fontWeight: "800" }}>✓ Done</Text>
        </View>
      )}
    </View>
  );
}

export default function DoorHangerDashboard() {
  const colors = useColors();
  const router = useRouter();
  const { employee } = useEmployeeAuth();
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<any>(null);
  const [goals, setGoals] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const today = todayLocal();

  const getStats = trpc.doorHanger.getStats.useQuery(
    { dateFrom: today, dateTo: today },
    { refetchInterval: 30000 }
  );
  const getGoals = trpc.doorHanger.getGoals.useQuery({} as any);

  useBreakNotifications();
  useAfter5pmCheckIn();

  useEffect(() => {
    if (getStats.data !== undefined || getGoals.data !== undefined || getStats.isError || getGoals.isError) {
      const s = getStats.data as any;
      const baseStats = { doorHangers: 0, businessCards: 0, yardSigns: 0, tableToppers: 0 };
      setStats(s ? { ...baseStats, ...s, tableToppers: s.tableToppers ?? 0 } : baseStats);
      setGoals(getGoals.data || { dailyDoorHangerGoal: 50, dailyBusinessCardGoal: 20, dailyYardSignGoal: 2, dailyTableTopperGoal: 5 });
      setIsLoading(false);
    }
  }, [getStats.data, getStats.isError, getGoals.data, getGoals.isError]);

  const handleRefresh = useCallback(async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await getStats.refetch();
    await getGoals.refetch();
  }, [getStats, getGoals]);

  if (isLoading) {
    return (
      <ScreenContainer edges={["left", "right"]} className="justify-center items-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </ScreenContainer>
    );
  }

  const doorHangerGoal = goals?.dailyDoorHangerGoal || 50;
  const businessCardGoal = goals?.dailyBusinessCardGoal || 20;
  const yardSignGoal = goals?.dailyYardSignGoal || 2;
  const tableTopperGoal = goals?.dailyTableTopperGoal || 5;

  const dh = stats?.doorHangers || 0;
  const bc = stats?.businessCards || 0;
  const ys = stats?.yardSigns || 0;
  const tt = stats?.tableToppers || 0;

  const totalLogged = dh + bc + ys + tt;
  const totalGoal = doorHangerGoal + businessCardGoal + yardSignGoal + tableTopperGoal;
  const overallPct = Math.min(Math.round((totalLogged / Math.max(totalGoal, 1)) * 100), 100);
  const dhPct = Math.min(Math.round((dh / Math.max(doorHangerGoal, 1)) * 100), 100);

  const ringColor = overallPct >= 100 ? "#4ADE80" : overallPct >= 75 ? "#FBBF24" : "#60A5FA";
  const firstName = (employee?.fullName || "Team Member").split(" ")[0];

  // Dark background for the whole screen
  const darkBg = "#0D1117";
  const cardBg = "#161B22";
  const cardBorder = "#21262D";

  return (
    <View style={{ flex: 1, backgroundColor: darkBg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        {/* ── HERO SECTION ── */}
        <View
          style={{
            paddingTop: insets.top + 16,
            paddingBottom: 32,
            paddingHorizontal: 20,
            alignItems: "center",
            backgroundColor: darkBg,
          }}
        >
          {/* Greeting */}
          <Text style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", fontWeight: "600", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 }}>
            {getGreeting()}
          </Text>
          <Text style={{ fontSize: 28, fontWeight: "900", color: "#fff", marginBottom: 2 }}>
            {firstName} 👋
          </Text>
          <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginBottom: 32 }}>
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </Text>

          {/* Big central ring */}
          <RingProgress
            size={180}
            strokeWidth={14}
            percent={overallPct}
            color={ringColor}
            bgColor="rgba(255,255,255,0.07)"
          >
            <View style={{ alignItems: "center" }}>
              <Text style={{ fontSize: 42, fontWeight: "900", color: "#fff" }}>{overallPct}%</Text>
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: "600" }}>OVERALL</Text>
              <Text style={{ fontSize: 18, fontWeight: "800", color: ringColor, marginTop: 2 }}>
                {totalLogged}/{totalGoal}
              </Text>
            </View>
          </RingProgress>

          {/* Motivation text */}
          <Text
            style={{
              marginTop: 20,
              fontSize: 14,
              color: "rgba(255,255,255,0.6)",
              textAlign: "center",
              fontStyle: "italic",
              paddingHorizontal: 20,
            }}
          >
            {getMotivation(overallPct)}
          </Text>
        </View>

        {/* ── MINI RING CARDS ── */}
        <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
            <MiniRingCard label="Door Hangers" emoji="🚪" count={dh} goal={doorHangerGoal} accentColor="#60A5FA" bgColor={cardBg} />
            <MiniRingCard label="Business Cards" emoji="💼" count={bc} goal={businessCardGoal} accentColor="#34D399" bgColor={cardBg} />
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <MiniRingCard label="Yard Signs" emoji="🏷️" count={ys} goal={yardSignGoal} accentColor="#FB923C" bgColor={cardBg} />
            <MiniRingCard label="Table Toppers" emoji="📋" count={tt} goal={tableTopperGoal} accentColor="#C084FC" bgColor={cardBg} />
          </View>
        </View>

        {/* ── DOOR HANGER SPOTLIGHT ── */}
        <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
          <View
            style={{
              backgroundColor: cardBg,
              borderRadius: 20,
              padding: 20,
              borderWidth: 1,
              borderColor: cardBorder,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <View>
                <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 }}>
                  Primary Goal
                </Text>
                <Text style={{ fontSize: 18, fontWeight: "800", color: "#fff", marginTop: 2 }}>
                  🚪 Door Hangers
                </Text>
              </View>
              <View
                style={{
                  backgroundColor: dhPct >= 100 ? "#4ADE8020" : dhPct >= 75 ? "#FBBF2420" : "#60A5FA20",
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                }}
              >
                <Text
                  style={{
                    fontSize: 20,
                    fontWeight: "900",
                    color: dhPct >= 100 ? "#4ADE80" : dhPct >= 75 ? "#FBBF24" : "#60A5FA",
                  }}
                >
                  {dhPct}%
                </Text>
              </View>
            </View>

            {/* Large progress bar */}
            <View style={{ height: 12, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
              <View
                style={{
                  height: "100%",
                  width: `${dhPct}%`,
                  backgroundColor: dhPct >= 100 ? "#4ADE80" : dhPct >= 75 ? "#FBBF24" : "#60A5FA",
                  borderRadius: 6,
                }}
              />
            </View>

            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{dh}</Text> distributed
              </Text>
              <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
                Goal: <Text style={{ color: "#fff", fontWeight: "800" }}>{doorHangerGoal}</Text>
              </Text>
            </View>

            {dh >= doorHangerGoal && (
              <View
                style={{
                  marginTop: 12,
                  backgroundColor: "#4ADE8015",
                  borderRadius: 10,
                  padding: 10,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: "#4ADE8030",
                }}
              >
                <Text style={{ color: "#4ADE80", fontWeight: "700", fontSize: 14 }}>
                  🏆 Daily goal achieved!
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ── QUICK ACTIONS ── */}
        <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Quick Actions
          </Text>
          <TouchableOpacity
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/(sales)/log-entry");
            }}
            style={{
              backgroundColor: "#2563EB",
              borderRadius: 16,
              padding: 18,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              marginBottom: 10,
              shadowColor: "#2563EB",
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.4,
              shadowRadius: 12,
              elevation: 8,
            }}
          >
            <Text style={{ fontSize: 22 }}>📷</Text>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16, letterSpacing: 0.3 }}>Log New Entry</Text>
          </TouchableOpacity>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push("/(sales)/dh-map");
              }}
              style={{
                flex: 1,
                backgroundColor: cardBg,
                borderRadius: 14,
                padding: 16,
                alignItems: "center",
                gap: 6,
                borderWidth: 1,
                borderColor: cardBorder,
              }}
            >
              <Text style={{ fontSize: 24 }}>🗺️</Text>
              <Text style={{ color: "rgba(255,255,255,0.7)", fontWeight: "700", fontSize: 13 }}>Map</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push("/(sales)/dh-history");
              }}
              style={{
                flex: 1,
                backgroundColor: cardBg,
                borderRadius: 14,
                padding: 16,
                alignItems: "center",
                gap: 6,
                borderWidth: 1,
                borderColor: cardBorder,
              }}
            >
              <Text style={{ fontSize: 24 }}>📋</Text>
              <Text style={{ color: "rgba(255,255,255,0.7)", fontWeight: "700", fontSize: 13 }}>History</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleRefresh}
              style={{
                flex: 1,
                backgroundColor: cardBg,
                borderRadius: 14,
                padding: 16,
                alignItems: "center",
                gap: 6,
                borderWidth: 1,
                borderColor: cardBorder,
              }}
            >
              <Text style={{ fontSize: 24 }}>↻</Text>
              <Text style={{ color: "rgba(255,255,255,0.7)", fontWeight: "700", fontSize: 13 }}>Refresh</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── CLOCK IN/OUT ── */}
        <View style={{ paddingHorizontal: 16 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Time Tracking
          </Text>
          <View
            style={{
              backgroundColor: cardBg,
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: cardBorder,
            }}
          >
            <HeaderClockStatus />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
