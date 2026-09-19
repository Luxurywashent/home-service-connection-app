import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";

import { CompanyAuthorityLoading, CompanyAuthorityMessage, companyTimeListState } from "@/components/company-authority-state";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useJobSyncSync } from "@/lib/jobsync-sync-context";
import {
  COMPANY_TIMEKEEPING_LEGACY_FALLTHROUGH_BLOCKED,
  companyCanonicalReadError,
} from "@/lib/jobsync-company-authority";
import {
  getHomeServiceConnectedTeamTimeSummary,
  getHomeServiceConnectedTimesheets,
  sumHomeServiceConnectedTimesheetHours,
  type HomeServiceConnectedTeamTimeMember,
  type HomeServiceConnectedTimesheetRecord,
  type JobSyncCompanyRole,
} from "@/lib/jobsync-mobile-api";

function weekRange(weekOffset = 0) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + weekOffset * 7);
  monday.setHours(12, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const ymd = (value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const dayOfMonth = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${dayOfMonth}`;
  };
  return { start: ymd(monday), end: ymd(sunday), monday, sunday };
}

function formatClockTime(value: string | null) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatDateLabel(dateStr: string) {
  if (!dateStr) return "Unknown date";
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function canManageCompanyTimesheets(role: string | undefined) {
  return role === "owner" || role === "dispatcher";
}

export function CompanyTimesheetPanel({
  token,
  role,
  showTeam = false,
  showTimeOffLink = true,
}: {
  token: string;
  role?: JobSyncCompanyRole | string;
  showTeam?: boolean;
  showTimeOffLink?: boolean;
}) {
  const colors = useColors();
  const router = useRouter();
  const { revision } = useJobSyncSync();
  const manager = showTeam && canManageCompanyTimesheets(role);
  const [weekOffset, setWeekOffset] = useState(0);
  const [memberId, setMemberId] = useState<number | null>(null);
  const [records, setRecords] = useState<HomeServiceConnectedTimesheetRecord[]>([]);
  const [team, setTeam] = useState<HomeServiceConnectedTeamTimeMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const week = useMemo(() => weekRange(weekOffset), [weekOffset]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextRecords = await getHomeServiceConnectedTimesheets(token, {
        start: week.start,
        end: week.end,
        ...(manager && memberId ? { memberId } : {}),
      });
      setRecords(nextRecords);
      if (manager) {
        setTeam(await getHomeServiceConnectedTeamTimeSummary(token));
      } else {
        setTeam([]);
      }
      setError(null);
    } catch (refreshError) {
      setRecords([]);
      setTeam([]);
      setError(companyCanonicalReadError(refreshError));
    } finally {
      setLoading(false);
    }
  }, [manager, memberId, token, week.end, week.start]);

  useEffect(() => {
    void refresh();
  }, [refresh, revision]);

  const listState = companyTimeListState({ loading, error, itemCount: records.length });
  const totalHours = sumHomeServiceConnectedTimesheetHours(records);
  const selectedMember = team.find((member) => member.id === memberId);

  return (
    <ScreenContainer className="px-0" edges={["left", "right"]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 }}>
          <Text style={{ color: colors.foreground, fontSize: 28, fontWeight: "800" }}>Timesheet</Text>
          <Text style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
            Hours come from Home Service Connected clock records. Company mode does not keep a second timesheet ledger.
          </Text>
        </View>

        {showTimeOffLink ? (
          <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => router.push("/(tabs)/request-off")}
              style={{
                alignItems: "center",
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: 16,
                borderWidth: 1,
                flexDirection: "row",
                gap: 14,
                padding: 16,
              }}
            >
              <Text style={{ fontSize: 22 }}>🗓️</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>Request Time Off</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Uses canonical Home Service Connected Time Off</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 20 }}>›</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
          <View style={{ alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
            <TouchableOpacity accessibilityRole="button" onPress={() => setWeekOffset((value) => value - 1)} style={{ padding: 8 }}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>← Previous</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600" }}>
              {week.monday.toLocaleDateString()} - {week.sunday.toLocaleDateString()}
            </Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => setWeekOffset((value) => value + 1)} style={{ padding: 8 }}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>Next →</Text>
            </TouchableOpacity>
          </View>
          <View style={{ backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}30`, borderRadius: 16, borderWidth: 1, padding: 20 }}>
            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" }}>Weekly Hours</Text>
            <Text style={{ color: colors.primary, fontSize: 40, fontWeight: "800" }}>{listState === "error" ? "—" : totalHours.toFixed(2)}</Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
              {selectedMember ? `${selectedMember.name} · canonical clock records` : "canonical clock records"}
            </Text>
          </View>
        </View>

        {manager ? (
          <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700", marginBottom: 8, textTransform: "uppercase" }}>Team</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => setMemberId(null)}
                style={{
                  backgroundColor: memberId === null ? colors.primary : colors.surface,
                  borderColor: memberId === null ? colors.primary : colors.border,
                  borderRadius: 16,
                  borderWidth: 1,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                }}
              >
                <Text style={{ color: memberId === null ? "#FFFFFF" : colors.foreground, fontSize: 12, fontWeight: "700" }}>Me</Text>
              </TouchableOpacity>
              {team.map((member) => (
                <TouchableOpacity
                  key={member.id}
                  accessibilityRole="button"
                  onPress={() => setMemberId(member.id)}
                  style={{
                    backgroundColor: memberId === member.id ? colors.primary : colors.surface,
                    borderColor: memberId === member.id ? colors.primary : colors.border,
                    borderRadius: 16,
                    borderWidth: 1,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                  }}
                >
                  <Text style={{ color: memberId === member.id ? "#FFFFFF" : colors.foreground, fontSize: 12, fontWeight: "700" }}>
                    {member.name}{member.clockedIn ? " · in" : ""}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 10 }}>
              Time edits and approvals stay on the Home Service Connected Timesheets screen. Mobile Company mode does not create a second edit rule set.
            </Text>
          </View>
        ) : null}

        {listState === "loading" ? (
          <CompanyAuthorityLoading message="Loading Company timesheets…" />
        ) : listState === "error" ? (
          <CompanyAuthorityMessage title="Company timesheets are unavailable" detail={error ?? COMPANY_TIMEKEEPING_LEGACY_FALLTHROUGH_BLOCKED} />
        ) : listState === "empty" ? (
          <CompanyAuthorityMessage title="No clock records for this week" detail="This empty list came from Home Service Connected, not a local timesheet table." />
        ) : (
          <View style={{ gap: 12, paddingHorizontal: 20 }}>
            {records.map((record) => (
              <View
                key={record.id}
                style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, padding: 16 }}
              >
                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700", marginBottom: 10, textTransform: "uppercase" }}>
                  {formatDateLabel(record.date)} · {record.memberName}
                </Text>
                <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Clock In</Text>
                    <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "700" }}>{formatClockTime(record.clockIn)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Clock Out</Text>
                    <Text style={{ color: record.clockOut ? colors.success : colors.warning, fontSize: 14, fontWeight: "700" }}>
                      {formatClockTime(record.clockOut)}
                    </Text>
                  </View>
                </View>
                <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700" }}>
                  {(record.totalHours ?? 0).toFixed(2)} hrs
                </Text>
                {record.breakStart ? (
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
                    Break {formatClockTime(record.breakStart)}{record.breakEnd ? ` – ${formatClockTime(record.breakEnd)}` : " · active"}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
