import { useState, useMemo } from "react";
import { Text, View, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";

function getEfficiencyColor(eff: number, colors: any) {
  if (eff >= 80) return colors.success;
  if (eff >= 70) return colors.warning;
  return colors.error;
}

export default function HistoryScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const [tab, setTab] = useState<"daily" | "weekly">("daily");

  const { data: history, isLoading } = trpc.performance.getHistory.useQuery(
    { employeeId: employee?.employeeId ?? "", limit: 60 },
    { enabled: !!employee }
  );

  const weeklyData = useMemo(() => {
    if (!history || history.length === 0) return [];
    const weeks: Record<string, any[]> = {};
    for (const entry of history) {
      const d = new Date(entry.date + "T12:00:00");
      const day = d.getDay();
      const mon = new Date(d);
      mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      const key = mon.toISOString().split("T")[0];
      if (!weeks[key]) weeks[key] = [];
      weeks[key].push(entry);
    }
    return Object.entries(weeks).map(([weekStart, entries]) => {
      const endDate = new Date(weekStart + "T12:00:00");
      endDate.setDate(endDate.getDate() + 6);
      return {
        weekStart,
        weekEnd: endDate.toISOString().split("T")[0],
        revenue: entries.reduce((s, e) => s + Number(e.revenueProduced ?? 0), 0),
        hours: entries.reduce((s, e) => s + Number(e.hoursWorked ?? 0), 0),
        // Efficiency: total revenue / total hours / $100 target (weighted rate)
        efficiency: entries.reduce((s, e) => s + Number(e.hoursWorked ?? 0), 0) > 0
          ? (entries.reduce((s, e) => s + Number(e.revenueProduced ?? 0), 0) /
             entries.reduce((s, e) => s + Number(e.hoursWorked ?? 0), 0)) / 100 * 100
          : 0,
        upsells: entries.reduce((s, e) => s + Number(e.upsells ?? 0), 0),
        tips: entries.reduce((s, e) => s + Number(e.tips ?? 0), 0),
        days: entries.length,
      };
    }).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  }, [history]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  return (
    <ScreenContainer edges={["left", "right"]} className="px-5">
      <View style={{ marginTop: 8, marginBottom: 16 }}>
        <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>History</Text>
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: "row", backgroundColor: colors.surface, borderRadius: 12, padding: 4, marginBottom: 16 }}>
        {(["daily", "weekly"] as const).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            activeOpacity={0.7}
            style={{
              flex: 1, paddingVertical: 10, borderRadius: 10,
              backgroundColor: tab === t ? colors.primary : "transparent",
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "600", color: tab === t ? "#FFF" : colors.muted }}>
              {t === "daily" ? "Daily" : "Weekly"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
      ) : tab === "daily" ? (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={history ?? []}
          keyExtractor={(item) => item.recordId}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={{ alignItems: "center", marginTop: 60 }}>
              <Text style={{ fontSize: 16, color: colors.muted }}>No performance data yet</Text>
            </View>
          }
          renderItem={({ item }) => {
            const eff = Number(item.efficiencyPercent ?? 0);
            return (
              <View style={{
                backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 10,
                borderWidth: 1, borderColor: colors.border,
              }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{formatDate(item.date)}</Text>
                  <Text style={{ fontSize: 22, fontWeight: "900", color: getEfficiencyColor(eff, colors) }}>
                    {eff.toFixed(1)}%
                  </Text>
                </View>
                <View style={{ flexDirection: "row", gap: 16 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>Revenue</Text>
                    <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>${Number(item.revenueProduced ?? 0).toFixed(0)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>Hours</Text>
                    <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{Number(item.hoursWorked ?? 0).toFixed(1)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>Bonus</Text>
                    <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>${Number(item.upsells ?? 0).toFixed(0)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>Tips</Text>
                    <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>${Number(item.tips ?? 0).toFixed(0)}</Text>
                  </View>
                </View>
              </View>
            );
          }}
        />
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={weeklyData}
          keyExtractor={(item) => item.weekStart}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={{ alignItems: "center", marginTop: 60 }}>
              <Text style={{ fontSize: 16, color: colors.muted }}>No weekly data yet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={{
              backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 10,
              borderWidth: 1, borderColor: colors.border,
            }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>
                  {formatDate(item.weekStart)} - {formatDate(item.weekEnd)}
                </Text>
                <Text style={{ fontSize: 22, fontWeight: "900", color: getEfficiencyColor(item.efficiency, colors) }}>
                  {item.efficiency.toFixed(1)}%
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 16 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>Revenue</Text>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>${item.revenue.toFixed(0)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>Hours</Text>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{item.hours.toFixed(1)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>Bonus</Text>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>${item.upsells.toFixed(0)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>Tips</Text>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>${item.tips.toFixed(0)}</Text>
                </View>
              </View>
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 8 }}>{item.days} day(s) tracked</Text>
            </View>
          )}
        />
      )}
    </ScreenContainer>
  );
}
