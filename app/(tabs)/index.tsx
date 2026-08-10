import { ActivityIndicator, Animated, ScrollView, Text, TouchableOpacity, View, Platform, Modal } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { TrainingSection } from "@/components/training-section";
import { WeatherForecast } from "@/components/weather-forecast";
import { TimecardDisplay } from "@/components/timecard-display";
import { NotificationBanner } from "@/components/notification-banner";
import { MorningMeetingBanner } from "@/components/morning-meeting-banner";
import { CompanyMeetingBanner } from "@/components/company-meeting-banner";

import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useBreakNotifications } from "@/hooks/use-break-notifications";
import { useAfter5pmCheckIn } from "@/hooks/use-after-5pm-check-in";
import { useEmployeePush } from "@/hooks/use-employee-push";
import { trpc } from "@/lib/trpc";
import { useRouter, useFocusEffect } from "expo-router";
import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { HeroCard } from "@/components/ui/hero-card";
import { MetricCard } from "@/components/ui/metric-card";
import { PremiumButton } from "@/components/ui/premium-button";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { Alert } from "react-native";

function toCST(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function getWeekRange() {
  const now = new Date();
  // Use CST day-of-week to determine Monday correctly
  const cstStr = toCST(now); // YYYY-MM-DD in CST
  const cstDate = new Date(cstStr + 'T12:00:00'); // local noon to avoid DST issues
  const day = cstDate.getDay();
  const monday = new Date(cstDate);
  monday.setDate(cstDate.getDate() - (day === 0 ? 6 : day - 1));
  return {
    start: toCST(monday),
    end: cstStr,
    today: cstStr,
  };
}

function getTimeBasedGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) {
    return "Good Morning";
  } else if (hour < 18) {
    return "Good Afternoon";
  } else {
    return "Good Evening";
  }
}

function TreasureChestReveal({ prizeName, prizeEmoji, onClose, colors }: {
  prizeName: string; prizeEmoji: string; onClose: () => void; colors: any;
}) {
  // Phase 1: chest drops in (0→1)
  // Phase 2: chest shakes (1→1)
  // Phase 3: lid swings open (0→1)
  // Phase 4: prize pops up from inside chest
  const chestY = useRef(new Animated.Value(-300)).current;   // starts above screen
  const chestScale = useRef(new Animated.Value(0.5)).current;
  const lidAngle = useRef(new Animated.Value(0)).current;    // 0 = closed, 1 = open
  const prizeY = useRef(new Animated.Value(0)).current;      // 0 = inside chest, -1 = popped out
  const prizeScale = useRef(new Animated.Value(0)).current;
  const prizeOpacity = useRef(new Animated.Value(0)).current;
  const sparkle1 = useRef(new Animated.Value(0)).current;
  const sparkle2 = useRef(new Animated.Value(0)).current;
  const sparkle3 = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      // 1. Chest drops in with bounce
      Animated.parallel([
        Animated.spring(chestY, {
          toValue: 0,
          tension: 80,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.spring(chestScale, {
          toValue: 1,
          tension: 80,
          friction: 8,
          useNativeDriver: true,
        }),
      ]),
      // 2. Chest shakes with excitement
      Animated.sequence([
        Animated.timing(shake, { toValue: 8, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -8, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 6, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -6, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
      ]),
      // 3. Lid swings open
      Animated.timing(lidAngle, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }),
      // 4. Prize pops out of chest + sparkles + text
      Animated.parallel([
        Animated.spring(prizeY, {
          toValue: -1,
          tension: 120,
          friction: 6,
          useNativeDriver: true,
        }),
        Animated.spring(prizeScale, {
          toValue: 1,
          tension: 120,
          friction: 6,
          useNativeDriver: true,
        }),
        Animated.timing(prizeOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(150),
          Animated.parallel([
            Animated.timing(sparkle1, { toValue: 1, duration: 400, useNativeDriver: true }),
            Animated.timing(sparkle2, { toValue: 1, duration: 500, useNativeDriver: true }),
            Animated.timing(sparkle3, { toValue: 1, duration: 450, useNativeDriver: true }),
          ]),
        ]),
        Animated.sequence([
          Animated.delay(300),
          Animated.timing(textOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]),
      ]),
    ]).start();
  }, []);

  const lidRotateInterp = lidAngle.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "-110deg"],
  });

  // Prize pops from y=0 (chest opening) to y=-110 (above chest)
  const prizeTranslateY = prizeY.interpolate({
    inputRange: [-1, 0],
    outputRange: [-110, 0],
  });

  // Sparkle positions (radiate outward)
  const s1x = sparkle1.interpolate({ inputRange: [0, 1], outputRange: [0, -60] });
  const s1y = sparkle1.interpolate({ inputRange: [0, 1], outputRange: [0, -80] });
  const s2x = sparkle2.interpolate({ inputRange: [0, 1], outputRange: [0, 70] });
  const s2y = sparkle2.interpolate({ inputRange: [0, 1], outputRange: [0, -60] });
  const s3x = sparkle3.interpolate({ inputRange: [0, 1], outputRange: [0, 0] });
  const s3y = sparkle3.interpolate({ inputRange: [0, 1], outputRange: [0, -100] });

  // Chest width/height constants
  const CW = 140; // chest width
  const CH = 80;  // chest body height
  const LH = 44;  // lid height

  return (
    <View style={{
      flex: 1, justifyContent: "center", alignItems: "center",
      backgroundColor: "rgba(0,0,0,0.75)", padding: 20,
    }}>
      {/* Sparkles */}
      <View style={{ position: "absolute", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}>
        <Animated.Text style={{
          position: "absolute", fontSize: 24,
          opacity: sparkle1,
          transform: [{ translateX: s1x }, { translateY: s1y }],
        }}>✨</Animated.Text>
        <Animated.Text style={{
          position: "absolute", fontSize: 20,
          opacity: sparkle2,
          transform: [{ translateX: s2x }, { translateY: s2y }],
        }}>⭐</Animated.Text>
        <Animated.Text style={{
          position: "absolute", fontSize: 22,
          opacity: sparkle3,
          transform: [{ translateX: s3x }, { translateY: s3y }],
        }}>✨</Animated.Text>
      </View>

      {/* Chest + Prize container */}
      <Animated.View style={{
        alignItems: "center",
        transform: [
          { translateY: chestY },
          { scale: chestScale },
          { translateX: shake },
        ],
      }}>
        {/* Prize floating above chest */}
        <Animated.View style={{
          position: "absolute",
          top: 0,
          alignSelf: "center",
          alignItems: "center",
          opacity: prizeOpacity,
          transform: [
            { translateY: prizeTranslateY },
            { scale: prizeScale },
          ],
          zIndex: 10,
        }}>
          <Text style={{ fontSize: 64 }}>{prizeEmoji}</Text>
        </Animated.View>

        {/* Chest body + lid */}
        <View style={{ width: CW, alignItems: "center", marginTop: 60 }}>
          {/* Lid — rotates around its top edge using translate trick */}
          <Animated.View style={{
            width: CW,
            height: LH,
            backgroundColor: "#92400E",
            borderTopLeftRadius: 10,
            borderTopRightRadius: 10,
            borderWidth: 3,
            borderColor: "#78350F",
            overflow: "hidden",
            transform: [
              { translateY: LH / 2 },
              { rotate: lidRotateInterp },
              { translateY: -(LH / 2) },
            ],
            zIndex: 5,
          }}>
            {/* Lid band */}
            <View style={{
              position: "absolute", bottom: 6, left: 0, right: 0, height: 10,
              backgroundColor: "#B45309",
            }} />
            {/* Lid latch */}
            <View style={{
              position: "absolute", bottom: 2, left: "50%", marginLeft: -8,
              width: 16, height: 14,
              backgroundColor: "#F59E0B",
              borderRadius: 4,
              borderWidth: 2,
              borderColor: "#D97706",
            }} />
          </Animated.View>

          {/* Chest body */}
          <View style={{
            width: CW,
            height: CH,
            backgroundColor: "#92400E",
            borderBottomLeftRadius: 10,
            borderBottomRightRadius: 10,
            borderWidth: 3,
            borderColor: "#78350F",
            borderTopWidth: 0,
            overflow: "hidden",
            justifyContent: "center",
            alignItems: "center",
          }}>
            {/* Horizontal band */}
            <View style={{
              position: "absolute", top: 14, left: 0, right: 0, height: 12,
              backgroundColor: "#B45309",
            }} />
            {/* Lock */}
            <View style={{
              width: 24, height: 20,
              backgroundColor: "#F59E0B",
              borderRadius: 4,
              borderWidth: 2,
              borderColor: "#D97706",
              marginTop: 8,
            }} />
            {/* Vertical band */}
            <View style={{
              position: "absolute", top: 0, bottom: 0,
              left: "50%", marginLeft: -6,
              width: 12,
              backgroundColor: "#B45309",
            }} />
          </View>
        </View>
      </Animated.View>

      {/* Prize name + congrats text */}
      <Animated.View style={{ alignItems: "center", marginTop: 48, opacity: textOpacity }}>
        <Text style={{ fontSize: 26, fontWeight: "900", color: "#FFF", textAlign: "center", marginBottom: 4 }}>
          {prizeName}
        </Text>
        <Text style={{ fontSize: 15, color: "#FCD34D", marginBottom: 32, textAlign: "center", fontWeight: "600" }}>
          🎉 Congratulations! You earned it!
        </Text>
        <TouchableOpacity
          onPress={onClose}
          style={{
            backgroundColor: "#D97706",
            paddingVertical: 14,
            paddingHorizontal: 48,
            borderRadius: 14,
          }}
        >
          <Text style={{ color: "#FFF", fontSize: 17, fontWeight: "800" }}>Awesome! 🙌</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// Inner component — only rendered for confirmed detailers (no role guard needed here).
function DetailerDashboard() {
  const colors = useColors();
  const { employee, isSalesRep } = useEmployeeAuth();
  const router = useRouter();

  // Initialize break notifications
  useBreakNotifications();
  useEmployeePush();
  
  // Initialize after 5 PM check-in
  const { pendingClockCheck, respondToClockCheck, responding: responding5pm } = useAfter5pmCheckIn();
  const [view, setView] = useState<"today" | "week" | "alltime">("today");
  const [showQuiz, setShowQuiz] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<"A" | "B" | "C" | "D" | null>(null);
  const [answerResult, setAnswerResult] = useState<"correct" | "incorrect" | null>(null);
  const [resultExplanation, setResultExplanation] = useState("");
  const [correctAnswerHint, setCorrectAnswerHint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPrizeReveal, setShowPrizeReveal] = useState(false);
  const [clockingInOut, setClockinginOut] = useState(false);
  const [showBreakModal, setShowBreakModal] = useState(false);
  const [selectedBreakType, setSelectedBreakType] = useState<"morning_15min" | "afternoon_15min" | "lunch_30min" | null>(null);
  const [dismissedNotifications, setDismissedNotifications] = useState<Set<string>>(new Set());
  const [suggestedCity, setSuggestedCity] = useState<any>(null);

  const weekRange = getWeekRange();
  
  // Get suggested door hanger location - only for sales reps (isSalesRep already declared above)
  const suggestedCityQuery = trpc.doorHanger.getSuggestedCity.useQuery(
    undefined,
    { refetchInterval: 60000, enabled: isSalesRep }
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
  
  // Initialize default challenge if needed
  const utils = trpc.useUtils();
  const initChallengeMutation = trpc.mysteryBonus.initializeChallenge.useMutation({
    onSuccess: () => {
      // Invalidate and refetch challenge query after successful initialization
      utils.mysteryBonus.getChallenge.invalidate();
    },
  });
  
  useEffect(() => {
    if (employee?.employeeId) {
      initChallengeMutation.mutate();
    }
  }, [employee?.employeeId, initChallengeMutation]);
  
  const metricsQuery = trpc.performance.getDateRange.useQuery(
    {
      employeeId: employee?.employeeId || "",
      startDate: view === "today" ? weekRange.today : view === "week" ? weekRange.start : "2020-01-01",
      endDate: view === "today" ? weekRange.today : view === "week" ? weekRange.end : weekRange.today,
    },
    { enabled: !!employee?.employeeId, refetchOnWindowFocus: false, staleTime: 30_000 }
  );

  // Query actual clock hours directly from clock_in_out_records (source of truth for hours)
  // This is used for Week and All Time views so hours are never missed even if daily_performance
  // record was not created on the day of clock-out.
  const clockHoursQuery = trpc.timesheet.getWeeklyHours.useQuery(
    {
      employeeId: employee?.employeeId || "",
      startDate: view === "today" ? weekRange.today : view === "week" ? weekRange.start : "2020-01-01",
      endDate: view === "today" ? weekRange.today : view === "week" ? weekRange.end : weekRange.today,
    },
    { enabled: !!employee?.employeeId, refetchOnWindowFocus: false, refetchInterval: 60000 }
  );

  // Query completed schedule jobs to include their revenue in dashboard metrics
  const completedJobsQuery = trpc.jobs.completedForDetailer.useQuery(
    {
      assignedTo: employee?.employeeId || "",
      startDate: view === "today" ? weekRange.today : view === "week" ? weekRange.start : "2020-01-01",
      endDate: view === "today" ? weekRange.today : view === "week" ? weekRange.end : weekRange.today,
    },
    { enabled: !!employee?.employeeId, refetchOnWindowFocus: false, staleTime: 60000 }
  );

  const challengeQuery = trpc.mysteryBonus.getChallenge.useQuery(
    { employeeId: employee?.employeeId || "" },
    { enabled: !!employee?.employeeId, refetchInterval: 30000, staleTime: 25000 }
  );

  const submitMutation = trpc.mysteryBonus.submitAnswer.useMutation();

  // Notification query
  const notificationsQuery = trpc.notifications.getForEmployee.useQuery(
    { employeeId: employee?.employeeId || "" },
    { enabled: !!employee?.employeeId, refetchInterval: 60000, staleTime: 55000 }
  );
  const markNotificationReadMutation = trpc.notifications.markRead.useMutation();
  const markNotificationAcknowledgedMutation = trpc.notifications.markAcknowledged.useMutation();


  // Timesheet queries and mutations
  const clockStatusQuery = trpc.timesheet.getTodayStatus.useQuery(
    { employeeId: employee?.employeeId || "" },
    { enabled: !!employee?.employeeId, refetchInterval: 60000, staleTime: 55000 }
  );
  const clockInMutation = trpc.timesheet.clockIn.useMutation();
  const clockOutMutation = trpc.timesheet.clockOut.useMutation();

  const isLoading = metricsQuery.isLoading;
  const challenge = challengeQuery.data;
  const clockStatus = clockStatusQuery.data;
  const pointsQuery = trpc.points.getMyPoints.useQuery(
    { employeeId: employee?.employeeId || "" },
    { enabled: !!employee?.employeeId, refetchInterval: 60000, staleTime: 55000 }
  );
  const myPoints = pointsQuery.data;

  // Refetch all key queries when screen comes into focus — fixes projected paycheck
  // not loading after login (employee state sets just before navigation, queries miss it)
  useFocusEffect(
    useCallback(() => {
      if (employee?.employeeId) {
        metricsQuery.refetch();
        clockHoursQuery.refetch();
        completedJobsQuery.refetch();
        clockStatusQuery.refetch();
        pointsQuery.refetch();
      }
    }, [employee?.employeeId])
  );
  const myCurrentPoints = myPoints?.currentPoints ?? 10;
  const myBonusEligible = myCurrentPoints >= 7;

    const calculateMetrics = useMemo(() => {
    const data = metricsQuery.data ?? [];
    const completedJobs = completedJobsQuery.data ?? [];

    // Revenue = sum of all scheduled jobs (confirmed + in_progress + completed) for the period.
    // This shows revenue as soon as a job is booked, not just when completed.
    // Upsell bonus = daily_performance.upsells (40% of upsell, pushed when upsells are saved).
    const jobRevenueByDate: Record<string, number> = {};
    const jobUpsellBonusByDate: Record<string, number> = {};
    const jobTipsByDate: Record<string, number> = {};
    for (const job of completedJobs) {
      const d = job.date;
      const basePrice = Number(job.totalPrice ?? 0);
      const upsellAmt = Number((job as any).upsellTotal ?? 0);
      const discount = Number(job.discountAmount ?? 0);
      // Revenue = base service price + upsells - discount (tips are EXCLUDED from revenue)
      const revenue = Math.max(0, basePrice + upsellAmt - discount);
      jobRevenueByDate[d] = (jobRevenueByDate[d] ?? 0) + revenue;
      // Upsell bonus: use per-employee rate (default 40%) of upsell total (for the bonus display card)
      const upsellBonusRate = (employee?.upsellBonusPct ?? 40) / 100;
      jobUpsellBonusByDate[d] = (jobUpsellBonusByDate[d] ?? 0) + upsellAmt * upsellBonusRate;
      // Tips: stored in schedule_jobs.tips when payment completes (credit card or cash)
      const tipAmt = Number((job as any).tips ?? 0);
      jobTipsByDate[d] = (jobTipsByDate[d] ?? 0) + tipAmt;
    }

    if (view === "today") {
      // jobRevenueByDate already includes base price + upsells - discount (computed in for-loop above)
      const scheduleRevenue = jobRevenueByDate[weekRange.today] ?? 0;
      const manualRevenue = Number(data[0]?.revenueProduced ?? 0);
      // Use schedule revenue (base + upsells) if available, otherwise fall back to daily_performance
      const revenue = scheduleRevenue > 0 ? scheduleRevenue : manualRevenue;
      // daily_performance.upsells already stores the 40% bonus (set by schedule job upsell panel).
      // Display it as-is. Fall back to schedule-derived upsell bonus if no manual record.
      const manualUpsellBonus = Number(data[0]?.upsells ?? 0);
      const scheduleUpsells = jobUpsellBonusByDate[weekRange.today] ?? 0;
      const upsells = manualUpsellBonus > 0 ? manualUpsellBonus : scheduleUpsells;
      // Tips: use schedule_jobs.tips (authoritative — set when payment completes).
      // Fall back to daily_performance.tips if no schedule jobs have tips yet.
      // Sum tips from ALL performance records for today (payment may create a separate record).
      const scheduleTips = jobTipsByDate[weekRange.today] ?? 0;
      const manualTips = data.reduce((sum, d) => sum + Number(d.tips ?? 0), 0);
      const tips = scheduleTips > 0 ? scheduleTips : manualTips;
      // Use clock_in_out_records as the authoritative source for hours (same as week/all-time).
      // daily_performance.hoursWorked can contain stale or estimated values — never use it for display.
      const todayClockHours = clockHoursQuery.data?.totalHours ?? 0;
      // Efficiency: total revenue / clock hours / $100 target (consistent with week/all-time)
      const todayEfficiency = todayClockHours > 0 ? (revenue / todayClockHours) / 100 * 100 : 0;
      return {
        revenue,
        hours: todayClockHours,
        efficiency: todayEfficiency,
        upsells,
        tips,
      };
    } else {
      // For week/all-time: pick the best daily_performance record per date for revenue/efficiency,
      // but SUM tips across ALL records for the same date (tips may be in a separate record).
      const manualByDate: Record<string, typeof data[0]> = {};
      const tipsByDate: Record<string, number> = {};
      for (const d of data) {
        // Always accumulate tips from every record for this date
        tipsByDate[d.date] = (tipsByDate[d.date] ?? 0) + Number(d.tips ?? 0);
        const existing = manualByDate[d.date];
        // Keep the record with the highest efficiency (or most revenue if efficiency ties at 0)
        if (!existing ||
            Number(d.efficiencyPercent) > Number(existing.efficiencyPercent) ||
            (Number(d.efficiencyPercent) === Number(existing.efficiencyPercent) && Number(d.revenueProduced) > Number(existing.revenueProduced))
        ) {
          manualByDate[d.date] = d;
        }
      }
      const allDates = new Set([...Object.keys(manualByDate), ...Object.keys(jobRevenueByDate)]);
      let totalRevenue = 0;
      let totalEfficiencySum = 0;
      let efficiencyCount = 0;
      let totalUpsells = 0;
      let totalTips = 0;
      for (const date of allDates) {
        const manual = manualByDate[date];
        // jobRevenueByDate already includes base price + upsells - discount (computed in for-loop above)
        const schedRev = jobRevenueByDate[date] ?? 0;
        const manualRev = Number(manual?.revenueProduced ?? 0);
        // Schedule revenue (base + upsells) is primary; fall back to manual if no schedule jobs
        totalRevenue += schedRev > 0 ? schedRev : manualRev;
        // Efficiency: include any day that has a performance record with hours > 0
        // Use != null check (not falsy) so 0% days are included in the average
        if (manual != null && Number(manual.hoursWorked) > 0) {
          totalEfficiencySum += Number(manual.efficiencyPercent ?? 0);
          efficiencyCount++;
        }
        // daily_performance.upsells already stores the 40% bonus
        const manualUpsellBonus = Number(manual?.upsells ?? 0);
        const schedUpsells = jobUpsellBonusByDate[date] ?? 0;
        totalUpsells += manualUpsellBonus > 0 ? manualUpsellBonus : schedUpsells;
        // Tips: prefer schedule_jobs.tips (set when payment completes) over daily_performance.
        // Use tipsByDate (sum of ALL performance records for this date) to avoid losing tips
        // stored in a secondary record (e.g. when payment completion creates a separate record).
        const schedTips = jobTipsByDate[date] ?? 0;
        const manualTips = tipsByDate[date] ?? 0;
        totalTips += schedTips > 0 ? schedTips : manualTips;
      }
      // Use clock_in_out_records as the authoritative source for hours (never misses a session)
      const clockHours = clockHoursQuery.data?.totalHours ?? 0;
      // Efficiency (Option B): total revenue / total hours / $100 target
      // e.g. $800 / 8 hrs / $100 = 100%. Gives a single weighted rate across all time.
      const efficiency = clockHours > 0 ? (totalRevenue / clockHours) / 100 * 100 : 0;
      return {
        revenue: totalRevenue,
        hours: clockHours,
        efficiency,
        upsells: totalUpsells,
        tips: totalTips,
      };
    }
  }, [view, metricsQuery.data, completedJobsQuery.data, clockHoursQuery.data, weekRange.today]);

  const metrics = calculateMetrics;

  // Weekly upsell total (raw dollar amount added as upsells, not the 40% bonus)
  // Always uses the full week range regardless of the current view tab
  const weeklyUpsellTotal = useMemo(() => {
    const jobs = completedJobsQuery.data ?? [];
    let total = 0;
    for (const job of jobs) {
      total += Number((job as any).upsellTotal ?? 0);
    }
    // If viewing "today" only, we still want the weekly total — re-derive from all week jobs
    // completedJobsQuery already covers week range when view === "week"
    // For "today" view, fall back to metrics.upsells / 0.4 (reverse the 40% to get raw amount)
    if (view === "today") {
      // metrics.upsells is the 40% bonus for today; extrapolate raw upsell for today
      // But we want the full week — use the jobs data which is scoped to today only
      // So just use today's raw upsell from jobs
      return total;
    }
    return total;
  }, [completedJobsQuery.data, view]);
  const WEEKLY_UPSELL_GOAL = 500;

  // Projected income uses the fully-aggregated metrics object (which merges schedule jobs +
  // daily_performance) so credit-card tips and upsell bonuses from jobs are always reflected.
  const projectedIncome = (() => {
    const hourlyRate = employee?.hourlyRate ?? 17;
    const grossIncome = metrics.tips + metrics.upsells + (metrics.hours * hourlyRate);
    const tax = grossIncome * 0.1665;
    return grossIncome - tax;
  })();

  // ─── Live Pay Ticker ───────────────────────────────────────────────────────
  // While clocked in, add live earnings on top of the stored projected income.
  // Ticks every second so the number visibly increments.
  const [liveExtraSeconds, setLiveExtraSeconds] = useState(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const isClockedIn = clockStatus?.status === "clocked_in" && clockStatus?.clockInTime;
    if (isClockedIn && view === "today") {
      // Calculate how many seconds have elapsed since clock-in that are NOT yet in stored hours
      const clockInMs = new Date(clockStatus.clockInTime!).getTime();
      const storedHours = metrics.hours; // hours already logged in DB
      const storedSeconds = storedHours * 3600;

      const getElapsed = () => {
        const elapsedMs = Date.now() - clockInMs;
        const elapsedSec = Math.max(0, elapsedMs / 1000);
        // Live extra = total elapsed minus what's already stored
        return Math.max(0, elapsedSec - storedSeconds);
      };

      setLiveExtraSeconds(getElapsed());
      tickerRef.current = setInterval(() => {
        setLiveExtraSeconds(getElapsed());
      }, 1000);
    } else {
      setLiveExtraSeconds(0);
      if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null; }
    }
    return () => { if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null; } };
  }, [clockStatus?.status, clockStatus?.clockInTime, metrics.hours, view]);

  // Live projected income = stored projected + live extra hours earnings (after tax) + upsell bonus
  const HOURLY_RATE = employee?.hourlyRate ?? 17;
  const TAX_RATE = 0.1665;
  const liveExtraEarnings = (liveExtraSeconds / 3600) * HOURLY_RATE * (1 - TAX_RATE);
  // Upsell bonus is already stored in metrics.upsells (pushed when detailer saves upsells on a job)
  // It's already included in projectedIncome via calculateProjectedIncome, so we just add live hours
  const liveProjectedIncome = projectedIncome + (view === "today" ? liveExtraEarnings : 0);
  // ─────────────────────────────────────────────────────────────────────────

  const answeredQ = Number((challenge as any)?.answeredCount ?? 0);
  const totalQ = Number((challenge as any)?.totalQuestions ?? 0);
  const prizeName = (challenge as any)?.prizeName ?? "Mystery Bonus";
  const prizeEmoji = (challenge as any)?.prizeEmoji ?? "🎁";
  const challengeTitle = (challenge as any)?.challengeTitle ?? "Mystery Challenge";

  const handleSubmitAnswer = async () => {
    if (!selectedAnswer || !challenge || !(challenge as any)?.question?.questionText || !employee) return;
    setSubmitting(true);
    try {
      const result = await submitMutation.mutateAsync({
        employeeId: employee.employeeId,
        questionId: (challenge as any).question?.questionId,
        answer: selectedAnswer as "A" | "B" | "C" | "D",
      });
      if (result.success && result.correct) {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        // Close quiz and immediately show treasure chest reveal
        setShowQuiz(false);
        setSelectedAnswer(null);
        setAnswerResult(null);
        setResultExplanation("");
        setCorrectAnswerHint("");
        setShowPrizeReveal(true);
        await utils.mysteryBonus.getChallenge.invalidate();
      } else if (result.success && !result.correct) {
        setAnswerResult("incorrect");
        const correctLetter = (result as any).correctAnswer ?? "";
        const q = (challenge as any).question;
        const correctText = correctLetter === "A" ? q?.optionA : correctLetter === "B" ? q?.optionB : correctLetter === "C" ? q?.optionC : q?.optionD ?? "";
        setCorrectAnswerHint(`The correct answer is ${correctLetter}: ${correctText}`);
        setResultExplanation((result as any).explanationIncorrect ?? "");
      }
    } catch (e) {
      console.log("Answer error:", e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNextQuestion = () => {
    setSelectedAnswer(null);
    setAnswerResult(null);
    setResultExplanation("");
    setCorrectAnswerHint("");
  };

  const handleCloseQuiz = () => {
    setShowQuiz(false);
    setShowPrizeReveal(false);
    setSelectedAnswer(null);
    setAnswerResult(null);
    setResultExplanation("");
    setCorrectAnswerHint("");
  };

  const handleDismissNotification = async (notificationId: string) => {
    setDismissedNotifications(prev => new Set([...prev, notificationId]));
    try {
      await markNotificationReadMutation.mutateAsync({
        notificationId,
        employeeId: employee?.employeeId || "",
      });
    } catch (e) {
      console.error("Error dismissing notification:", e);
    }
  };

  const handleAcknowledgeNotification = async (notificationId: string) => {
    setDismissedNotifications(prev => new Set([...prev, notificationId]));
    try {
      await markNotificationAcknowledgedMutation.mutateAsync({
        notificationId,
        employeeId: employee?.employeeId || "",
      });
    } catch (e) {
      console.error("Error acknowledging notification:", e);
    }
  };

  // Get unread notifications that haven't been dismissed
  // Exclude system-internal types that are handled by dedicated UI (e.g. clock_check_5pm hook)
  const EMPLOYEE_SYSTEM_TYPES = new Set(["clock_check_5pm", "clock_alert", "callback_reminder", "ai_booking", "job_transfer", "missed_call"]);
  const unreadNotifications = (notificationsQuery.data ?? []).filter(
    (notif: any) => notif.status === "unread" && !dismissedNotifications.has(notif.notificationId) && !EMPLOYEE_SYSTEM_TYPES.has(notif.notificationType)
  );

  const firstName = employee?.fullName?.split(" ")[0] ?? "Detailer";
  const greeting = getTimeBasedGreeting();

  return (
    <ScreenContainer className="px-0" edges={["left", "right"]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* Header Section */}
        <View style={{ paddingHorizontal: 20, paddingTop: 0, paddingBottom: 24 }}>
          <Text style={{ fontSize: 32, fontWeight: "800", color: colors.foreground }}>
            {greeting} 👋
          </Text>
          <Text style={{ fontSize: 14, color: colors.muted, marginTop: 4 }}>
            {firstName}, let's see how you're doing
          </Text>
        </View>

        {/* Morning Meeting Banner */}
        <MorningMeetingBanner />
        <CompanyMeetingBanner />

        {/* Notifications Section */}
        {unreadNotifications.length > 0 && (
          <View>
            {unreadNotifications.map((notif: any) => (
              <NotificationBanner
                key={notif.notificationId}
                notificationId={notif.notificationId}
                title={notif.title}
                message={notif.message}
                requiresAcknowledgment={notif.requiresAcknowledgment}
                notificationType={notif.notificationType}
                onDismiss={handleDismissNotification}
                onAcknowledge={handleAcknowledgeNotification}
              />
            ))}
          </View>
        )}

        {/* Suggested Door Hanger Location - Sales Reps Only */}
        {suggestedCity && (employee?.role === 'sales' || employee?.role === 'door_hanger_rep') && (
          <View style={{ marginHorizontal: 16, marginTop: 16 }}>
            <View style={{ backgroundColor: colors.primary, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 12 }}>
              <View>
                <Text style={{ fontSize: 24, fontWeight: "900", color: "#fff", marginBottom: 4 }}>
                  {suggestedCity.city}
                </Text>
                <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
                  {suggestedCity.percentBooked}% booked • {suggestedCity.jobCount} jobs
                </Text>
              </View>
              <View style={{ backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 12, padding: 12 }}>
                <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", marginBottom: 4 }}>
                  Starting Address
                </Text>
                <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }} numberOfLines={2}>
                  {suggestedCity.startingAddress}
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleTakeMeThere}
                style={{
                  backgroundColor: "#fff",
                  borderRadius: 12,
                  paddingVertical: 12,
                  alignItems: "center",
                  marginTop: 4,
                }}
              >
                <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>
                  📍 Take Me There
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}


        {isLoading ? (
          <View style={{ paddingHorizontal: 20, marginTop: 40 }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            {/* View Toggle */}
            <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
              <View style={{ flexDirection: "row", gap: 8, backgroundColor: colors.surface, padding: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
                {(["today", "week", "alltime"] as const).map((t) => (
                  <TouchableOpacity
                    key={t}
                    onPress={() => {
                      setView(t);
                      if (Platform.OS !== "web") {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }
                    }}
                    style={{ flex: 1 }}
                  >
                    <View
                      style={{
                        backgroundColor: view === t ? colors.primary : "transparent",
                        borderRadius: 10,
                        paddingVertical: 10,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          fontWeight: "600",
                          color: view === t ? "#FFFFFF" : colors.muted,
                        }}
                      >
                        {t === "today" ? "Today" : t === "week" ? "Week" : "All Time"}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Efficiency Hero Card */}
            <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>
              <HeroCard
                title="Efficiency Score"
                value={Number(metrics.efficiency).toFixed(1)}
                unit="%"
                icon="⚡"
                status={
                  Number(metrics.efficiency) >= 80
                    ? "excellent"
                    : Number(metrics.efficiency) >= 70
                    ? "good"
                    : "needs-improvement"
                }
                subtitle={
                  Number(metrics.efficiency) >= 80
                    ? "Outstanding performance!"
                    : Number(metrics.efficiency) >= 70
                    ? "Keep up the great work"
                    : "Focus on improving your speed"
                }
              />
            </View>

            {/* Accountability Points Card */}
            <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
              <View
                style={{
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 2,
                  borderColor: myBonusEligible ? (myCurrentPoints >= 8 ? colors.success : colors.warning) : colors.error,
                  backgroundColor: myBonusEligible ? (myCurrentPoints >= 8 ? colors.success + "10" : colors.warning + "10") : colors.error + "12",
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                      Accountability Points · This Week
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                      <Text style={{ fontSize: 36, fontWeight: "900", color: myBonusEligible ? (myCurrentPoints >= 8 ? colors.success : colors.warning) : colors.error }}>
                        {myCurrentPoints % 1 === 0 ? myCurrentPoints : myCurrentPoints.toFixed(1)}
                      </Text>
                      <Text style={{ fontSize: 16, fontWeight: "600", color: colors.muted }}>/10</Text>
                    </View>
                    {/* Progress bar */}
                    <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, marginTop: 8, marginBottom: 6 }}>
                      <View style={{
                        height: 6, borderRadius: 3,
                        backgroundColor: myBonusEligible ? (myCurrentPoints >= 8 ? colors.success : colors.warning) : colors.error,
                        width: `${Math.min(100, (myCurrentPoints / 10) * 100)}%`,
                      }} />
                    </View>
                    <Text style={{ fontSize: 12, color: myBonusEligible ? colors.muted : colors.error, fontWeight: myBonusEligible ? "400" : "700" }}>
                      {myBonusEligible
                        ? myCurrentPoints >= 8
                          ? "Great standing — bonus eligible ✅"
                          : "At risk — stay above 7 to keep your bonus ⚠️"
                        : "Below 7 pts — bonus money ineligible this week 🚫"}
                    </Text>
                  </View>
                  {/* Big badge */}
                  <View style={{
                    marginLeft: 16,
                    width: 64, height: 64, borderRadius: 32,
                    backgroundColor: myBonusEligible ? (myCurrentPoints >= 8 ? colors.success : colors.warning) : colors.error,
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <Text style={{ fontSize: 28 }}>{myBonusEligible ? (myCurrentPoints >= 8 ? "⭐" : "⚠️") : "🚫"}</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Key Metrics Grid */}
            <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Performance Metrics
              </Text>
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <MetricCard
                      label="Revenue"
                      value={`$${Number(metrics.revenue).toFixed(0)}`}
                      icon="💰"
                      color="primary"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MetricCard
                      label="Hours"
                      value={Number(metrics.hours).toFixed(1)}
                      unit="hrs"
                      icon="⏱️"
                      color="primary"
                    />
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    {/* Upsell Goal Card with progress bar */}
                    {(() => {
                      const rawUpsell = weeklyUpsellTotal;
                      const goal = WEEKLY_UPSELL_GOAL;
                      const pct = Math.min(rawUpsell / goal, 1);
                      const bonus = metrics.upsells; // 40% of raw upsell
                      const goalReached = rawUpsell >= goal;
                      return (
                        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: goalReached ? colors.success : colors.border, minHeight: 110, justifyContent: "space-between", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 }}>
                          {/* Header row */}
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <Text style={{ fontSize: 12, fontWeight: "500", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Upsell Goal</Text>
                            <Text style={{ fontSize: 11, color: goalReached ? colors.success : colors.muted, fontWeight: "600" }}>{goalReached ? "🎯" : `${Math.round(pct * 100)}%`}</Text>
                          </View>
                          {/* Amount */}
                          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginBottom: 6 }}>
                            <Text style={{ fontSize: 28, fontWeight: "700", color: goalReached ? colors.success : "#FFB800" }}>${rawUpsell.toFixed(0)}</Text>
                            <Text style={{ fontSize: 13, color: colors.muted }}>/ $500</Text>
                          </View>
                          {/* Progress bar */}
                          <View style={{ height: 5, backgroundColor: colors.border, borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
                            <View style={{ height: 5, width: `${Math.round(pct * 100)}%` as any, backgroundColor: goalReached ? colors.success : "#FFB800", borderRadius: 3 }} />
                          </View>
                          {/* Bonus earned */}
                          <Text style={{ fontSize: 11, color: goalReached ? colors.success : colors.muted, fontWeight: "600" }}>
                            {goalReached ? `🎉 Bonus: $${bonus.toFixed(2)}` : `Bonus earned: $${bonus.toFixed(2)}`}
                          </Text>
                        </View>
                      );
                    })()}
                  </View>
                  <View style={{ flex: 1 }}>
                    <MetricCard
                      label="Tips"
                      value={`$${Number(metrics.tips).toFixed(0)}`}
                      icon="💵"
                      color="success"
                    />
                  </View>
                </View>
              </View>
            </View>

            {/* Projected Paycheck */}
            <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
              <View
                style={{
                  backgroundColor: colors.primary + "10",
                  borderRadius: 16,
                  padding: 20,
                  borderWidth: 1,
                  borderColor: colors.primary + "30",
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Projected Paycheck
                  </Text>
                  {clockStatus?.status === "clocked_in" && view === "today" && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.success + "20", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success }} />
                      <Text style={{ fontSize: 11, fontWeight: "700", color: colors.success }}>LIVE</Text>
                    </View>
                  )}
                </View>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                  <Text style={{ fontSize: 36, fontWeight: "800", color: colors.primary }}>
                    ${liveProjectedIncome.toFixed(2)}
                  </Text>
                  <Text style={{ fontSize: 14, fontWeight: "500", color: colors.muted }}>
                    {view === "today" ? "today" : view === "week" ? "this week" : "all time"}
                  </Text>
                </View>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 8 }}>
                  {clockStatus?.status === "clocked_in" && view === "today"
                    ? "Updating in real time while clocked in"
                    : "Based on current performance metrics"}
                </Text>
              </View>
            </View>

            {/* EOD Checklist Button */}
            <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push("/(tabs)/eod-checklist");
                }}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: 16,
                  padding: 18,
                  borderWidth: 1.5,
                  borderColor: colors.border,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <View style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  backgroundColor: colors.primary + "18",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <Text style={{ fontSize: 24 }}>✅</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>End-of-Day Checklist</Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>Complete before clocking out</Text>
                </View>
                <Text style={{ fontSize: 18, color: colors.muted }}>›</Text>
              </TouchableOpacity>
            </View>

            {/* Timecard Display */}
            <TimecardDisplay />

            {/* Bonus Challenge Section — only show when challenge is active and NOT yet attempted */}
            {challenge && challenge.hasChallenge && !(challenge as any)?.alreadyAttempted && (
              <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
                <View style={{
                  backgroundColor: "#F59E0B15",
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 1.5,
                  borderColor: "#F59E0B40",
                }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <Text style={{ fontSize: 22 }}>🎁</Text>
                    <Text style={{ fontSize: 16, fontWeight: "800", color: "#D97706", flex: 1 }}>
                      Participate to earn a mystery bonus
                    </Text>
                  </View>

                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, marginBottom: 4 }}>
                    {challengeTitle}
                  </Text>

                  {totalQ > 1 && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <View style={{ flex: 1, height: 6, backgroundColor: colors.border, borderRadius: 3 }}>
                        <View style={{
                          width: `${Math.min((Number(answeredQ) / Number(totalQ)) * 100, 100)}%`,
                          height: 6,
                          backgroundColor: (challenge as any)?.attemptResult === "incorrect" ? colors.error : colors.success,
                          borderRadius: 3,
                        }} />
                      </View>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>
                        {answeredQ}/{totalQ}
                      </Text>
                    </View>
                  )}

                  <TouchableOpacity
                    onPress={() => {
                      if ((challenge as any)?.attemptResult !== "incorrect") {
                        setShowQuiz(true);
                        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }
                    }}
                    activeOpacity={0.8}
                    disabled={(challenge as any)?.attemptResult === "incorrect"}
                    style={{
                      backgroundColor: (challenge as any)?.attemptResult === "incorrect" ? colors.border : "#D97706",
                      borderRadius: 10,
                      paddingVertical: 10,
                      paddingHorizontal: 16,
                      marginTop: 8,
                    }}
                  >
                    <Text style={{ color: (challenge as any)?.attemptResult === "incorrect" ? colors.muted : "#FFFFFF", fontSize: 14, fontWeight: "700", textAlign: "center" }}>
                      {(challenge as any)?.attemptResult === "incorrect" ? "Challenge Failed"
                        : (challenge as any)?.attemptResult === "correct" ? "🏆 View Result"
                        : "Take Challenge"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Weather Forecast */}
            <View style={{ paddingHorizontal: 20 }}>
              <WeatherForecast city={employee?.city ?? null} />
            </View>

            {/* Training Section */}
            <View style={{ paddingHorizontal: 20 }}>
              <TrainingSection colors={colors} />
            </View>
          </>
        )}
      </ScrollView>

      {/* Quiz Modal — full-screen overlay matching original design */}
      <Modal
        visible={showQuiz && !!(challenge as any)?.hasChallenge}
        transparent={true}
        animationType="slide"
        onRequestClose={handleCloseQuiz}
      >
        {challenge && (challenge as any)?.question?.questionText ? (
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
            <View style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 20,
              maxHeight: "85%",
            }}>
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Header */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  <Text style={{ fontSize: 20 }}>🎁</Text>
                  <Text style={{ fontSize: 16, fontWeight: "800", color: "#D97706", flex: 1 }}>
                    {challengeTitle}
                  </Text>
                </View>

                <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground, marginBottom: 16 }}>
                  {(challenge as any).question?.questionText}
                </Text>

                {["A", "B", "C", "D"].map((letter) => {
                  const optionKey = `option${letter}` as const;
                  const optionText = (challenge as any).question?.[optionKey];
                  const isSelected = selectedAnswer === letter;
                  const isCorrect = (challenge as any).question?.correctAnswer === letter;
                  const showCorrect = answerResult && isCorrect;
                  const showIncorrect = answerResult && isSelected && !isCorrect;

                  return (
                    <TouchableOpacity
                      key={letter}
                      onPress={() => !answerResult && setSelectedAnswer(letter as "A" | "B" | "C" | "D")}
                      disabled={!!answerResult}
                      style={{
                        borderWidth: 2,
                        borderColor: showCorrect ? colors.success : showIncorrect ? colors.error : isSelected ? "#D97706" : colors.border,
                        borderRadius: 12,
                        padding: 12,
                        marginBottom: 10,
                        backgroundColor: showCorrect ? colors.success + "15" : showIncorrect ? colors.error + "15" : isSelected ? "#F59E0B15" : colors.surface,
                      }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>
                        {letter}. {optionText}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                {resultExplanation && (
                  <View style={{ marginTop: 16, padding: 12, backgroundColor: colors.surface, borderRadius: 8 }}>
                    <Text style={{ fontSize: 12, color: colors.foreground }}>
                      {resultExplanation}
                    </Text>
                  </View>
                )}

                {correctAnswerHint && (
                  <View style={{ marginTop: 8, padding: 12, backgroundColor: colors.error + "15", borderRadius: 8 }}>
                    <Text style={{ fontSize: 12, color: colors.error }}>
                      {correctAnswerHint}
                    </Text>
                  </View>
                )}

                <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
                  <TouchableOpacity
                    onPress={handleCloseQuiz}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: colors.border }}
                  >
                    <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700", textAlign: "center" }}>
                      Close
                    </Text>
                  </TouchableOpacity>

                  {answerResult === "correct" ? (
                    <TouchableOpacity
                      onPress={() => {
                        setShowPrizeReveal(true);
                        handleNextQuestion();
                      }}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: colors.success }}
                    >
                      <Text style={{ color: "#FFF", fontSize: 14, fontWeight: "700", textAlign: "center" }}>
                        Claim Prize 🎁
                      </Text>
                    </TouchableOpacity>
                  ) : answerResult === "incorrect" ? (
                    <TouchableOpacity
                      onPress={handleCloseQuiz}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: colors.error + "30" }}
                    >
                      <Text style={{ color: colors.error, fontSize: 14, fontWeight: "700", textAlign: "center" }}>
                        Close
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={handleSubmitAnswer}
                      disabled={!selectedAnswer || submitting}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: !selectedAnswer || submitting ? colors.border : "#D97706" }}
                    >
                      <Text style={{ color: !selectedAnswer || submitting ? colors.muted : "#FFF", fontSize: 14, fontWeight: "700", textAlign: "center" }}>
                        {submitting ? "Checking..." : "Submit Answer"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </ScrollView>
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,0.5)" }}>
            <View style={{ backgroundColor: colors.background, borderRadius: 16, padding: 24, alignItems: "center" }}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={{ color: colors.muted, marginTop: 12, fontSize: 14 }}>Loading challenge...</Text>
            </View>
          </View>
        )}
      </Modal>

      <Modal visible={showPrizeReveal} transparent animationType="fade" onRequestClose={() => { setShowPrizeReveal(false); handleCloseQuiz(); }}>
        <TreasureChestReveal
          prizeName={prizeName}
          prizeEmoji={prizeEmoji}
          onClose={() => {
            setShowPrizeReveal(false);
            handleCloseQuiz();
          }}
          colors={colors}
        />
      </Modal>
      {/* 5PM Clock Check Modal */}
      <Modal
        visible={!!pendingClockCheck}
        transparent
        animationType="slide"
        onRequestClose={() => {}}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <View style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 28,
            paddingBottom: 48,
          }}>
            <Text style={{ fontSize: 28, textAlign: "center", marginBottom: 8 }}>⏰</Text>
            <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground, textAlign: "center", marginBottom: 8 }}>
              Still Working?
            </Text>
            <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 20, marginBottom: 28 }}>
              Are you still on the clock? If you don't respond by 7:00 PM you will be automatically clocked out.
            </Text>
            <TouchableOpacity
              onPress={() => respondToClockCheck("still_working")}
              disabled={responding5pm}
              style={{
                backgroundColor: colors.primary,
                borderRadius: 14,
                paddingVertical: 16,
                alignItems: "center",
                marginBottom: 12,
                opacity: responding5pm ? 0.6 : 1,
              }}
            >
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
                {responding5pm ? "Saving..." : "✅ Still Working"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => respondToClockCheck("clock_me_out")}
              disabled={responding5pm}
              style={{
                backgroundColor: colors.error,
                borderRadius: 14,
                paddingVertical: 16,
                alignItems: "center",
                opacity: responding5pm ? 0.6 : 1,
              }}
            >
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
                🚪 Clock Me Out
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

/**
 * Guard wrapper — exported as the route default.
 * Redirects admins and sales reps to their correct dashboards WITHOUT rendering
 * any detailer UI first. DetailerDashboard is only mounted for actual detailers.
 */
export default function HomeScreenGuard() {
  const { employee, loading, isAdmin, isOpsManager, isDoorHangerRep, isSalesRep } = useEmployeeAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!employee) {
      router.replace("/login");
      return;
    }
    if (isOpsManager) {
      router.replace("/(tabs)/ops-dashboard" as any);
      return;
    }
    if (isAdmin) {
      router.replace("/(tabs)/admin-dashboard");
      return;
    }
    if (isDoorHangerRep || isSalesRep) {
      router.replace("/(sales)/dashboard");
    }
  }, [loading, employee, isAdmin, isOpsManager, isDoorHangerRep, isSalesRep]);

  // Show nothing until we know who the user is, or if they need to be redirected
  if (loading || !employee || isOpsManager || isAdmin || isDoorHangerRep || isSalesRep) {
    return null;
  }

  return <DetailerDashboard />;
}
