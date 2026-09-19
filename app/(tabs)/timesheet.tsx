import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { CompanyAuthorityLoading } from "@/components/company-authority-state";
import { CompanyTimesheetPanel } from "@/components/company-timesheet-panel";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import {
  allowsLegacyTimekeepingAuthority,
  resolveCompanyTimekeepingAuthority,
  usesCompanyTimekeepingAuthority,
} from "@/lib/jobsync-company-authority";
import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { useRouter } from "expo-router";

function getWeekDates(weekOffset: number = 0) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + weekOffset * 7);
  
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  
  return {
    start: monday.toISOString().split("T")[0],
    end: sunday.toISOString().split("T")[0],
    monday,
    sunday,
  };
}

function formatTime(date: Date | string) {
  if (!date) return "--:--";
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export default function TimesheetScreen() {
  const { session, isLoading: jobSyncLoading } = useJobSyncAuth();
  const authority = resolveCompanyTimekeepingAuthority({ session, sessionLoading: jobSyncLoading });
  if (authority === "unknown") {
    return <CompanyAuthorityLoading message="Confirming Company identity before Timesheets…" />;
  }
  if (usesCompanyTimekeepingAuthority(authority) && session?.token) {
    return <CompanyTimesheetPanel token={session.token} role={session.user.role} />;
  }
  if (!allowsLegacyTimekeepingAuthority(authority)) {
    return <CompanyAuthorityLoading message="Confirming Company identity before Timesheets…" />;
  }
  return <LegacyTimesheetScreen />;
}

function LegacyTimesheetScreen() {
  const colors = useColors();
  const router = useRouter();
  const { employee } = useEmployeeAuth();
  const [weekOffset, setWeekOffset] = useState(0);
  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  const weeklyLogsQuery = trpc.timesheet.getWeeklyLogs.useQuery(
    {
      employeeId: employee?.employeeId || "",
      startDate: weekDates.start,
      endDate: weekDates.end,
    },
    { enabled: !!employee?.employeeId }
  );

  const weeklyHoursQuery = trpc.timesheet.getWeeklyHours.useQuery(
    {
      employeeId: employee?.employeeId || "",
      startDate: weekDates.start,
      endDate: weekDates.end,
    },
    { enabled: !!employee?.employeeId }
  );

  const logs = (weeklyLogsQuery.data as any)?.logs ?? [];
  const breaks = (weeklyLogsQuery.data as any)?.breaks ?? [];
  const totalHours = (weeklyHoursQuery.data as any)?.totalHours ?? 0;

  const groupedByDate = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    logs.forEach((log: any) => {
      if (!grouped[log.date]) grouped[log.date] = [];
      grouped[log.date].push(log);
    });
    return grouped;
  }, [logs]);

  const isLoading = weeklyLogsQuery.isLoading || weeklyHoursQuery.isLoading;

  return (
    <ScreenContainer className="px-0" edges={["left", "right"]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 }}>
          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.foreground }}>
            Timesheet
          </Text>
        </View>

        {/* Time Off Request Card */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <TouchableOpacity
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/(tabs)/request-off");
            }}
            style={{
              backgroundColor: colors.surface,
              borderRadius: 16,
              padding: 16,
              flexDirection: "row",
              alignItems: "center",
              borderWidth: 1,
              borderColor: colors.border,
              gap: 14,
            }}
          >
            <View style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              backgroundColor: colors.primary + "22",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <Text style={{ fontSize: 22 }}>🗓️</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground, marginBottom: 2 }}>
                Request Time Off
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>
                Submit a time-off request for approval
              </Text>
            </View>
            <Text style={{ fontSize: 20, color: colors.muted }}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Week Navigation */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <TouchableOpacity
              onPress={() => {
                setWeekOffset(weekOffset - 1);
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              style={{ padding: 8 }}
            >
              <Text style={{ fontSize: 18, color: colors.primary }}>← Previous</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>
              {weekDates.monday.toLocaleDateString()} - {weekDates.sunday.toLocaleDateString()}
            </Text>
            <TouchableOpacity
              onPress={() => {
                setWeekOffset(weekOffset + 1);
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              style={{ padding: 8 }}
            >
              <Text style={{ fontSize: 18, color: colors.primary }}>Next →</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Weekly Hours Summary */}
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
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Weekly Hours
            </Text>
            <Text style={{ fontSize: 40, fontWeight: "800", color: colors.primary }}>
              {totalHours.toFixed(2)}
            </Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 8 }}>
              hours worked this week
            </Text>
          </View>
        </View>

        {/* Daily Logs */}
        {isLoading ? (
          <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 40 }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : Object.keys(groupedByDate).length === 0 ? (
          <View style={{ paddingHorizontal: 20 }}>
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: 12,
                padding: 20,
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 14, color: colors.muted }}>
                No clock records for this week
              </Text>
            </View>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 20, gap: 16 }}>
            {Object.entries(groupedByDate)
              .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
              .map(([date, dayLogs]) => (
                <View key={date}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase" }}>
                    {formatDate(date)}
                  </Text>

                  {dayLogs.map((log: any) => (
                    <View
                      key={log.recordId}
                      style={{
                        backgroundColor: colors.surface,
                        borderRadius: 12,
                        padding: 16,
                        borderWidth: 1,
                        borderColor: colors.border,
                        marginBottom: 12,
                      }}
                    >
                      {/* Clock In/Out Times */}
                      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Clock In</Text>
                          <View
                            style={{
                              backgroundColor: colors.primary + "15",
                              borderRadius: 8,
                              padding: 8,
                            }}
                          >
                            <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 13 }}>
                              {formatTime(log.clockInTime)}
                            </Text>
                          </View>
                        </View>

                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Clock Out</Text>
                          <View
                            style={{
                              backgroundColor: log.clockOutTime ? colors.success + "15" : colors.warning + "15",
                              borderRadius: 8,
                              padding: 8,
                            }}
                          >
                            <Text style={{ color: log.clockOutTime ? colors.success : colors.warning, fontWeight: "600", fontSize: 13 }}>
                              {formatTime(log.clockOutTime)}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* Hours Worked */}
                      <View style={{ paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
                        <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Hours Worked</Text>
                        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>
                          {Number(log.totalHours || 0).toFixed(2)} hrs
                        </Text>
                      </View>

                      {/* Breaks for this day */}
                      {breaks.filter((b: any) => b.date === date).length > 0 && (
                        <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
                          <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 8, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 }}>Breaks</Text>
                          {breaks
                            .filter((b: any) => b.date === date)
                            .map((breakRecord: any) => {
                              // Detect auto clock-in: break ended at exactly the scheduled duration after start
                              const isAutoClocked = (() => {
                                if (!breakRecord.breakStartTime || !breakRecord.breakEndTime) return false;
                                const start = new Date(breakRecord.breakStartTime).getTime();
                                const end = new Date(breakRecord.breakEndTime).getTime();
                                const diffMins = Math.round((end - start) / 60000);
                                return diffMins === breakRecord.durationMinutes;
                              })();
                              return (
                              <View
                                key={breakRecord.breakId}
                                style={{
                                  paddingVertical: 8,
                                  borderBottomWidth: StyleSheet.hairlineWidth,
                                  borderBottomColor: colors.border,
                                }}
                              >
                                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>
                                    {breakRecord.breakType === "morning_15min"
                                      ? "Morning Break"
                                      : breakRecord.breakType === "lunch_30min"
                                      ? "Lunch Break"
                                      : "Afternoon Break"}{" "}
                                    <Text style={{ fontSize: 11, color: colors.muted, fontWeight: "400" }}>({breakRecord.durationMinutes}m)</Text>
                                  </Text>
                                  <View
                                    style={{
                                      backgroundColor:
                                        breakRecord.status === "taken"
                                          ? colors.success + "20"
                                          : breakRecord.status === "pending"
                                          ? colors.warning + "20"
                                          : colors.error + "20",
                                      paddingHorizontal: 8,
                                      paddingVertical: 3,
                                      borderRadius: 6,
                                    }}
                                  >
                                    <Text
                                      style={{
                                        fontSize: 10,
                                        fontWeight: "600",
                                        color:
                                          breakRecord.status === "taken"
                                            ? colors.success
                                            : breakRecord.status === "pending"
                                            ? colors.warning
                                            : colors.error,
                                        textTransform: "capitalize",
                                      }}
                                    >
                                      {breakRecord.status}
                                    </Text>
                                  </View>
                                </View>
                                {breakRecord.breakStartTime && (
                                  <View style={{ flexDirection: "row", gap: 16 }}>
                                    <Text style={{ fontSize: 11, color: colors.muted }}>
                                      Start: <Text style={{ color: colors.foreground, fontWeight: "600" }}>{formatTime(breakRecord.breakStartTime)}</Text>
                                    </Text>
                                    {breakRecord.breakEndTime ? (
                                      <Text style={{ fontSize: 11, color: colors.muted }}>
                                        End: <Text style={{ color: isAutoClocked ? colors.warning : colors.foreground, fontWeight: "600" }}>{formatTime(breakRecord.breakEndTime)}</Text>
                                        {isAutoClocked && <Text style={{ fontSize: 10, color: colors.warning }}> (Auto clocked in)</Text>}
                                      </Text>
                                    ) : (
                                      <Text style={{ fontSize: 11, color: colors.warning, fontWeight: "600" }}>Still on break</Text>
                                    )}
                                  </View>
                                )}
                              </View>
                            );
                            })}
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
