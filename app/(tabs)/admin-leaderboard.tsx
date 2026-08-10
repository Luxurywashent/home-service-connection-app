import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Dimensions,
  RefreshControl,
  Image,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { LinearGradient } from "expo-linear-gradient";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ─── Types ──────────────────────────────────────────────────────────────────
type Detailer = {
  employeeId: string;
  fullName: string;
  profilePhotoUrl: string | null;
  revenue: number;
  upsells: number;
  tips: number;
  referrals: number;
  score: number;
};

type Category = "score" | "revenue" | "referrals" | "upsells";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatMoney(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function getWeekLabel(start: string, end: string): string {
  const s = new Date(start + "T12:00:00");
  const e = new Date(end + "T12:00:00");
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}`;
}

// ─── Podium Card ─────────────────────────────────────────────────────────────
const PODIUM_COLORS = {
  1: { bg: ["#FFD700", "#FFA500"] as const, text: "#7B5800", badge: "#FFD700", height: 130 },
  2: { bg: ["#C0C0C0", "#A8A8A8"] as const, text: "#4A4A4A", badge: "#C0C0C0", height: 100 },
  3: { bg: ["#CD7F32", "#A0522D"] as const, text: "#5C2E00", badge: "#CD7F32", height: 80 },
};

function PodiumCard({
  detailer,
  rank,
  category,
  animValue,
}: {
  detailer: Detailer;
  rank: 1 | 2 | 3;
  category: Category;
  animValue: Animated.Value;
}) {
  const cfg = PODIUM_COLORS[rank];
  const isFirst = rank === 1;

  const statValue = () => {
    switch (category) {
      case "revenue": return formatMoney(detailer.revenue);
      case "referrals": return `${detailer.referrals}`;
      case "upsells": return formatMoney(detailer.upsells);
      default: return `${detailer.score.toLocaleString()}`;
    }
  };

  const statLabel = () => {
    switch (category) {
      case "revenue": return "Revenue";
      case "referrals": return "Referrals";
      case "upsells": return "Upsells";
      default: return "Score";
    }
  };

  const scale = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 1],
  });

  const opacity = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <Animated.View
      style={[
        styles.podiumWrapper,
        { transform: [{ scale }], opacity },
        rank === 1 && { zIndex: 10 },
      ]}
    >
      {/* Crown for #1 */}
      {isFirst && (
        <Text style={styles.crown}>👑</Text>
      )}

      {/* Avatar */}
      <View
        style={[
          styles.podiumAvatarRing,
          {
            borderColor: cfg.badge,
            width: isFirst ? 80 : 64,
            height: isFirst ? 80 : 64,
            borderRadius: isFirst ? 40 : 32,
          },
        ]}
      >
        {detailer.profilePhotoUrl ? (
          <Image
            source={{ uri: detailer.profilePhotoUrl }}
            style={{
              width: isFirst ? 72 : 56,
              height: isFirst ? 72 : 56,
              borderRadius: isFirst ? 36 : 28,
            }}
          />
        ) : (
          <View
            style={[
              styles.podiumAvatarInner,
              {
                width: isFirst ? 72 : 56,
                height: isFirst ? 72 : 56,
                borderRadius: isFirst ? 36 : 28,
                backgroundColor: cfg.badge,
              },
            ]}
          >
            <Text
              style={[
                styles.podiumAvatarText,
                { fontSize: isFirst ? 24 : 18, color: cfg.text },
              ]}
            >
              {getInitials(detailer.fullName)}
            </Text>
          </View>
        )}
      </View>

      {/* Name */}
      <Text
        style={[styles.podiumName, { fontSize: isFirst ? 14 : 12 }]}
        numberOfLines={1}
      >
        {detailer.fullName.split(" ")[0]}
      </Text>

      {/* Stat */}
      <Text style={[styles.podiumStat, { fontSize: isFirst ? 16 : 13, color: cfg.badge }]}>
        {statValue()}
      </Text>
      <Text style={[styles.podiumStatLabel, { fontSize: isFirst ? 10 : 9 }]}>
        {statLabel()}
      </Text>

      {/* Podium block */}
      <LinearGradient
        colors={cfg.bg}
        style={[styles.podiumBlock, { height: cfg.height }]}
      >
        <Text style={[styles.podiumRankText, { color: cfg.text }]}>#{rank}</Text>
      </LinearGradient>
    </Animated.View>
  );
}

// ─── Row Card ────────────────────────────────────────────────────────────────
function RankRow({
  detailer,
  rank,
  category,
  isTop,
  delay,
}: {
  detailer: Detailer;
  rank: number;
  category: Category;
  isTop: boolean;
  delay: number;
}) {
  const colors = useColors();
  const slideAnim = useRef(new Animated.Value(60)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 350,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 350,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const statValue = () => {
    switch (category) {
      case "revenue": return formatMoney(detailer.revenue);
      case "referrals": return `${detailer.referrals} refs`;
      case "upsells": return formatMoney(detailer.upsells);
      default: return `${detailer.score.toLocaleString()} pts`;
    }
  };

  const rankColors: Record<number, string> = {
    1: "#FFD700",
    2: "#C0C0C0",
    3: "#CD7F32",
  };
  const rankColor = rankColors[rank] ?? colors.muted;

  return (
    <Animated.View
      style={[
        styles.rowCard,
        {
          backgroundColor: isTop ? "#0a7ea408" : colors.surface,
          borderColor: isTop ? "#0a7ea430" : colors.border,
          transform: [{ translateX: slideAnim }],
          opacity: fadeAnim,
        },
      ]}
    >
      {/* Rank badge */}
      <View
        style={[
          styles.rankBadge,
          { backgroundColor: rank <= 3 ? rankColor + "22" : colors.background, borderColor: rank <= 3 ? rankColor : colors.border },
        ]}
      >
        <Text style={[styles.rankBadgeText, { color: rank <= 3 ? rankColor : colors.muted }]}>
          {rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : `#${rank}`}
        </Text>
      </View>

      {/* Avatar */}
      {detailer.profilePhotoUrl ? (
        <Image
          source={{ uri: detailer.profilePhotoUrl }}
          style={styles.rowAvatar}
        />
      ) : (
        <View style={[styles.rowAvatar, { backgroundColor: rank <= 3 ? rankColor : colors.muted }]}>
          <Text style={styles.rowAvatarText}>{getInitials(detailer.fullName)}</Text>
        </View>
      )}

      {/* Info */}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
          {detailer.fullName}
        </Text>
        <View style={styles.rowStats}>
          <Text style={[styles.rowStatChip, { color: colors.muted }]}>
            💰 {formatMoney(detailer.revenue)}
          </Text>
          <Text style={[styles.rowStatChip, { color: colors.muted }]}>
            🔗 {detailer.referrals}
          </Text>
          <Text style={[styles.rowStatChip, { color: colors.muted }]}>
            ⬆️ {formatMoney(detailer.upsells)}
          </Text>
        </View>
      </View>

      {/* Primary stat */}
      <Text style={[styles.rowPrimaryStat, { color: rank <= 3 ? rankColor : colors.primary }]}>
        {statValue()}
      </Text>
    </Animated.View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function AdminLeaderboardScreen() {
  const colors = useColors();
  const [category, setCategory] = useState<Category>("score");
  const [refreshing, setRefreshing] = useState(false);

  const podiumAnim1 = useRef(new Animated.Value(0)).current;
  const podiumAnim2 = useRef(new Animated.Value(0)).current;
  const podiumAnim3 = useRef(new Animated.Value(0)).current;

  const query = trpc.performance.weeklyDetailerLeaderboard.useQuery({});

  const rawList: Detailer[] = (query.data?.leaderboard ?? []) as Detailer[];

  // Sort by selected category
  const sorted = [...rawList].sort((a, b) => {
    switch (category) {
      case "revenue": return b.revenue - a.revenue;
      case "referrals": return b.referrals - a.referrals;
      case "upsells": return b.upsells - a.upsells;
      default: return b.score - a.score;
    }
  });

  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  // Animate podium on load
  useEffect(() => {
    if (sorted.length > 0) {
      Animated.stagger(120, [
        Animated.spring(podiumAnim2, { toValue: 1, useNativeDriver: true, tension: 80, friction: 8 }),
        Animated.spring(podiumAnim1, { toValue: 1, useNativeDriver: true, tension: 80, friction: 8 }),
        Animated.spring(podiumAnim3, { toValue: 1, useNativeDriver: true, tension: 80, friction: 8 }),
      ]).start();
    }
  }, [sorted.length > 0]);

  const onRefresh = async () => {
    setRefreshing(true);
    await query.refetch();
    setRefreshing(false);
  };

  const weekLabel = query.data
    ? getWeekLabel(query.data.startDate, query.data.endDate)
    : "This Week";

  const CATEGORIES: { key: Category; label: string; emoji: string }[] = [
    { key: "score", label: "Overall", emoji: "🏆" },
    { key: "revenue", label: "Revenue", emoji: "💰" },
    { key: "referrals", label: "Referrals", emoji: "🔗" },
    { key: "upsells", label: "Upsells", emoji: "⬆️" },
  ];

  return (
    <ScreenContainer containerClassName="bg-background">
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* ── Hero Header ── */}
        <LinearGradient
          colors={["#0a2744", "#0a7ea4"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroGradient}
        >
          <Text style={styles.heroEmoji}>🏆</Text>
          <Text style={styles.heroTitle}>Weekly Leaderboard</Text>
          <Text style={styles.heroSubtitle}>{weekLabel}</Text>
          <Text style={styles.heroTagline}>Who's taking the top spot this week?</Text>
        </LinearGradient>

        {/* ── Category Tabs ── */}
        <View style={styles.categoryRow}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={[
                styles.categoryBtn,
                {
                  backgroundColor: category === c.key ? "#0a7ea4" : colors.surface,
                  borderColor: category === c.key ? "#0a7ea4" : colors.border,
                },
              ]}
              onPress={() => setCategory(c.key)}
              activeOpacity={0.8}
            >
              <Text style={styles.categoryEmoji}>{c.emoji}</Text>
              <Text
                style={[
                  styles.categoryLabel,
                  { color: category === c.key ? "#fff" : colors.foreground },
                ]}
              >
                {c.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Loading ── */}
        {query.isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0a7ea4" />
            <Text style={[styles.loadingText, { color: colors.muted }]}>Loading leaderboard...</Text>
          </View>
        )}

        {/* ── Empty ── */}
        {!query.isLoading && sorted.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>📊</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No data yet this week</Text>
            <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
              Performance records will appear here once team members log jobs.
            </Text>
          </View>
        )}

        {/* ── Podium ── */}
        {!query.isLoading && top3.length > 0 && (
          <View style={styles.podiumContainer}>
            {/* Arrange: 2nd | 1st | 3rd */}
            <View style={styles.podiumRow}>
              {top3[1] ? (
                <PodiumCard
                  detailer={top3[1]}
                  rank={2}
                  category={category}
                  animValue={podiumAnim2}
                />
              ) : <View style={{ flex: 1 }} />}

              {top3[0] ? (
                <PodiumCard
                  detailer={top3[0]}
                  rank={1}
                  category={category}
                  animValue={podiumAnim1}
                />
              ) : <View style={{ flex: 1 }} />}

              {top3[2] ? (
                <PodiumCard
                  detailer={top3[2]}
                  rank={3}
                  category={category}
                  animValue={podiumAnim3}
                />
              ) : <View style={{ flex: 1 }} />}
            </View>
          </View>
        )}

        {/* ── Score Legend ── */}
        {!query.isLoading && sorted.length > 0 && (
          <View style={[styles.legendCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.legendTitle, { color: colors.muted }]}>HOW SCORES ARE CALCULATED</Text>
            <View style={styles.legendRow}>
              <Text style={styles.legendItem}>💰 $1 Revenue = 1 pt</Text>
              <Text style={styles.legendItem}>⬆️ $1 Upsell = 1 pt</Text>
              <Text style={styles.legendItem}>🔗 1 Referral = 200 pts</Text>
            </View>
          </View>
        )}

        {/* ── Full Rankings ── */}
        {!query.isLoading && sorted.length > 0 && (
          <View style={styles.rankingsSection}>
            <Text style={[styles.rankingsSectionTitle, { color: colors.foreground }]}>
              Full Rankings
            </Text>
            {sorted.map((d, i) => (
              <RankRow
                key={d.employeeId}
                detailer={d}
                rank={i + 1}
                category={category}
                isTop={i < 3}
                delay={i * 60}
              />
            ))}
          </View>
        )}

        {/* ── Motivational Footer ── */}
        {!query.isLoading && sorted.length > 0 && (
          <View style={styles.motivationCard}>
            <Text style={styles.motivationEmoji}>🔥</Text>
            <Text style={styles.motivationText}>
              Keep grinding — the leaderboard resets every Monday morning!
            </Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 40,
  },
  heroGradient: {
    paddingTop: 28,
    paddingBottom: 32,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  heroEmoji: {
    fontSize: 44,
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: 0.5,
  },
  heroSubtitle: {
    fontSize: 13,
    color: "rgba(255,255,255,0.75)",
    marginTop: 4,
    fontWeight: "600",
  },
  heroTagline: {
    fontSize: 14,
    color: "rgba(255,255,255,0.6)",
    marginTop: 6,
    fontStyle: "italic",
  },
  categoryRow: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  categoryBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    gap: 2,
  },
  categoryEmoji: {
    fontSize: 16,
  },
  categoryLabel: {
    fontSize: 10,
    fontWeight: "700",
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: 60,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 60,
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyEmoji: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  podiumContainer: {
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  podiumRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 8,
  },
  podiumWrapper: {
    flex: 1,
    alignItems: "center",
    maxWidth: (SCREEN_WIDTH - 28 - 16) / 3,
  },
  crown: {
    fontSize: 24,
    marginBottom: 2,
  },
  podiumAvatarRing: {
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  podiumAvatarInner: {
    alignItems: "center",
    justifyContent: "center",
  },
  podiumAvatarText: {
    fontWeight: "900",
  },
  podiumName: {
    color: "#fff",
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 2,
  },
  podiumStat: {
    fontWeight: "900",
    textAlign: "center",
  },
  podiumStatLabel: {
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
    marginBottom: 6,
  },
  podiumBlock: {
    width: "100%",
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 10,
  },
  podiumRankText: {
    fontSize: 20,
    fontWeight: "900",
  },
  legendCard: {
    marginHorizontal: 14,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  legendTitle: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  legendItem: {
    fontSize: 12,
    color: "#aaa",
    fontWeight: "500",
  },
  rankingsSection: {
    paddingHorizontal: 14,
    marginTop: 16,
  },
  rankingsSectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 12,
  },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  rankBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  rankBadgeText: {
    fontSize: 14,
    fontWeight: "800",
  },
  rowAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  rowAvatarText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  rowName: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 3,
  },
  rowStats: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  rowStatChip: {
    fontSize: 11,
    fontWeight: "500",
  },
  rowPrimaryStat: {
    fontSize: 15,
    fontWeight: "900",
    minWidth: 60,
    textAlign: "right",
  },
  motivationCard: {
    marginHorizontal: 14,
    marginTop: 20,
    borderRadius: 12,
    backgroundColor: "#0a7ea415",
    borderWidth: 1,
    borderColor: "#0a7ea430",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  motivationEmoji: {
    fontSize: 24,
  },
  motivationText: {
    flex: 1,
    fontSize: 13,
    color: "#0a7ea4",
    fontWeight: "600",
    lineHeight: 18,
  },
});
