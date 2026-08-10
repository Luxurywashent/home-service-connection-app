import { ScrollView, Text, View } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import { useMemo } from "react";

export default function PerformanceScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();

  // Fetch challenge result
  const challengeQuery = trpc.mysteryBonus.getChallenge.useQuery(
    { employeeId: employee?.employeeId || "" },
    { enabled: !!employee?.employeeId }
  );
  const challenge = challengeQuery.data;
  const challengeAttempted = !!(challenge as any)?.alreadyAttempted;
  const challengeWon = (challenge as any)?.attemptResult === "correct";
  const challengeFailed = (challenge as any)?.attemptResult === "incorrect";
  const challengeTitle = (challenge as any)?.challengeTitle ?? "Weekly Challenge";
  const prizeName = (challenge as any)?.prizeName ?? "Mystery Bonus";
  const prizeEmoji = (challenge as any)?.prizeEmoji ?? "🎁";

  // Fetch all performance data
  const performanceQuery = trpc.performance.getHistory.useQuery(
    { employeeId: employee?.employeeId || "", limit: 100 },
    { enabled: !!employee?.employeeId }
  );

  // Calculate performance stats
  const stats = useMemo(() => {
    if (!performanceQuery.data || performanceQuery.data.length === 0) {
      return null;
    }

    const data = performanceQuery.data || [];
    const totalDays = data.length;
    const totalRevenue = data.reduce((sum: number, d: any) => sum + (parseFloat(d.revenueProduced || 0)), 0);
    const totalHours = data.reduce((sum: number, d: any) => sum + (parseFloat(d.hoursWorked || 0)), 0);
    const avgEfficiency = totalDays > 0 ? data.reduce((sum: number, d: any) => sum + (parseFloat(d.efficiencyPercent || 0)), 0) / totalDays : 0;
    const totalBonus = data.reduce((sum: number, d: any) => sum + (parseFloat(d.upsells || 0)), 0);
    const totalTips = data.reduce((sum: number, d: any) => sum + (parseFloat(d.tips || 0)), 0);

    return {
      totalDays,
      totalRevenue: totalRevenue.toFixed(2),
      totalHours: totalHours.toFixed(1),
      avgEfficiency: avgEfficiency.toFixed(1),
      totalBonus: totalBonus.toFixed(2),
      totalTips: totalTips.toFixed(2),
      recentData: data.slice(0, 7), // Last 7 days
    };
  }, [performanceQuery.data]);

  return (
    <ScreenContainer edges={["left", "right"]} className="bg-background">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="p-6 gap-6">
          {/* Header */}
          <View className="gap-2">
            <Text className="text-4xl font-bold text-foreground">Performance</Text>
            <Text className="text-base text-muted">Track your progress and achievements</Text>
          </View>

          {/* Weekly Challenge Result — shown at top when attempted */}
          {challengeAttempted && (
            <View
              style={{
                backgroundColor: challengeWon ? colors.success + "15" : colors.error + "15",
                borderRadius: 16,
                padding: 20,
                borderWidth: 1.5,
                borderColor: challengeWon ? colors.success + "40" : colors.error + "40",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <Text style={{ fontSize: 28 }}>{challengeWon ? "🏆" : "📋"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 2 }}>Weekly Challenge</Text>
                  <Text style={{ fontSize: 16, fontWeight: "800", color: challengeWon ? colors.success : colors.error }}>
                    {challengeWon ? "Challenge Won!" : "Challenge Failed"}
                  </Text>
                </View>
              </View>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, marginBottom: 4 }}>
                {challengeTitle}
              </Text>
              {challengeWon && (
                <View style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 10,
                  backgroundColor: "#F59E0B20",
                  borderRadius: 10,
                  padding: 10,
                }}>
                  <Text style={{ fontSize: 28 }}>{prizeEmoji}</Text>
                  <View>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted }}>Prize Earned</Text>
                    <Text style={{ fontSize: 16, fontWeight: "800", color: "#D97706" }}>{prizeName}</Text>
                  </View>
                </View>
              )}
              {challengeFailed && (
                <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6 }}>
                  Better luck next week — a new challenge drops soon!
                </Text>
              )}
            </View>
          )}

          {/* Loading State */}
          {performanceQuery.isLoading && (
            <View className="items-center justify-center py-12">
              <Text className="text-muted">Loading performance data...</Text>
            </View>
          )}

          {/* Stats Grid */}
          {stats && (
            <>
              {/* Summary Cards */}
              <View className="gap-4">
                {/* Total Revenue */}
                <View
                  className="bg-surface rounded-2xl p-6 border border-border"
                  style={{ borderColor: colors.border }}
                >
                  <Text className="text-sm text-muted mb-2">Total Revenue</Text>
                  <Text className="text-3xl font-bold text-primary">${stats.totalRevenue}</Text>
                  <Text className="text-xs text-muted mt-2">{stats.totalDays} days tracked</Text>
                </View>

                {/* Average Efficiency */}
                <View
                  className="bg-surface rounded-2xl p-6 border border-border"
                  style={{ borderColor: colors.border }}
                >
                  <Text className="text-sm text-muted mb-2">Average Efficiency</Text>
                  <Text className="text-3xl font-bold text-success">{stats.avgEfficiency}%</Text>
                  <Text className="text-xs text-muted mt-2">Across all tracked days</Text>
                </View>

                {/* Hours Worked */}
                <View
                  className="bg-surface rounded-2xl p-6 border border-border"
                  style={{ borderColor: colors.border }}
                >
                  <Text className="text-sm text-muted mb-2">Total Hours</Text>
                  <Text className="text-3xl font-bold text-primary">{stats.totalHours}</Text>
                  <Text className="text-xs text-muted mt-2">hours worked</Text>
                </View>

                {/* Bonus/Upsells */}
                <View
                  className="bg-surface rounded-2xl p-6 border border-border"
                  style={{ borderColor: colors.border }}
                >
                  <Text className="text-sm text-muted mb-2">Total Bonus</Text>
                  <Text className="text-3xl font-bold text-warning">${stats.totalBonus}</Text>
                  <Text className="text-xs text-muted mt-2">from upsells</Text>
                </View>

                {/* Tips */}
                <View
                  className="bg-surface rounded-2xl p-6 border border-border"
                  style={{ borderColor: colors.border }}
                >
                  <Text className="text-sm text-muted mb-2">Total Tips</Text>
                  <Text className="text-3xl font-bold text-success">${stats.totalTips}</Text>
                  <Text className="text-xs text-muted mt-2">from customers</Text>
                </View>
              </View>

              {/* Recent Performance */}
              <View className="gap-4">
                <Text className="text-lg font-semibold text-foreground">Recent Days</Text>
                {stats.recentData.map((day: any, index: number) => (
                  <View
                    key={index}
                    className="bg-surface rounded-xl p-4 border border-border flex-row justify-between items-center"
                    style={{ borderColor: colors.border }}
                  >
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-foreground">{day.date}</Text>
                      <Text className="text-xs text-muted mt-1">
                        ${day.revenueProduced} • {day.hoursWorked}hrs • {day.efficiencyPercent}%
                      </Text>
                    </View>
                    <View
                      className="px-3 py-1 rounded-full"
                      style={{
                        backgroundColor:
                          parseFloat(day.efficiencyPercent) >= 90
                            ? colors.success
                            : parseFloat(day.efficiencyPercent) >= 70
                              ? colors.warning
                              : colors.error,
                      }}
                    >
                      <Text className="text-xs font-semibold text-background">
                        {day.efficiencyPercent}%
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Empty State */}
          {stats === null && !performanceQuery.isLoading && (
            <View className="items-center justify-center py-12">
              <Text className="text-muted">No performance data available yet</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
