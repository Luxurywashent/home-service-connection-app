import { View, Text } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";

export function TimecardDisplay() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();

  const breaksQuery = trpc.timesheet.getTodayBreaks.useQuery(
    { employeeId: employee?.employeeId || "" },
    { enabled: !!employee?.employeeId, refetchInterval: 60000, refetchOnWindowFocus: false }
  );

  const breaks = breaksQuery.data ?? [];
  const takenBreaks = breaks.filter((b) => b.status === "taken").length;
  const totalBreaks = breaks.length;

  const breakStatusColor = (status: string) => {
    switch (status) {
      case "taken":
        return colors.success;
      case "pending":
        return colors.warning;
      case "skipped":
        return colors.error;
      default:
        return colors.muted;
    }
  };

  return (
    <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Today's Breaks
      </Text>
      
      {breaks.length === 0 ? (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 12,
            padding: 16,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 14, color: colors.muted }}>
            No breaks scheduled yet
          </Text>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {breaks.map((breakRecord) => (
            <View
              key={breakRecord.breakId}
              style={{
                backgroundColor: colors.surface,
                borderRadius: 12,
                padding: 12,
                borderWidth: 1,
                borderColor: colors.border,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>
                  {breakRecord.breakType === "morning_15min"
                    ? "Morning Break"
                    : breakRecord.breakType === "lunch_30min"
                    ? "Lunch Break"
                    : "Afternoon Break"}
                </Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                  {breakRecord.durationMinutes} minutes
                </Text>
              </View>
              <View
                style={{
                  backgroundColor: breakStatusColor(breakRecord.status) + "20",
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 8,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "600",
                    color: breakStatusColor(breakRecord.status),
                    textTransform: "capitalize",
                  }}
                >
                  {breakRecord.status}
                </Text>
              </View>
            </View>
          ))}
          {totalBreaks > 0 && (
            <View
              style={{
                backgroundColor: colors.primary + "10",
                borderRadius: 12,
                padding: 12,
                borderWidth: 1,
                borderColor: colors.primary + "30",
                marginTop: 8,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>
                {takenBreaks} of {totalBreaks} breaks taken
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
