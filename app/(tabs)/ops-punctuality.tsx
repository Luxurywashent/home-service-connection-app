import React, { useState, useMemo } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  StyleSheet, ActivityIndicator,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseHour(slot: string | null | undefined): number | null {
  if (!slot) return null;
  const match = slot.match(/(\d+)(?::(\d+))?\s*(am|pm)/i);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const ampm = match[3].toLowerCase();
  if (ampm === "pm" && h !== 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  return h;
}

function getStatus(job: any): "on_time" | "late" | "no_show" | "upcoming" | "completed" {
  if (job.status === "completed") return "completed";
  const now = new Date();
  const startH = job.startHour ?? parseHour(job.timeSlot);
  if (startH === null) return "upcoming";
  const apptTime = new Date();
  apptTime.setHours(startH, 0, 0, 0);
  const diffMin = (now.getTime() - apptTime.getTime()) / 60000;
  if (job.status === "in_progress" || job.status === "completed") return "on_time";
  if (diffMin > 30) return "no_show";
  if (diffMin > 0) return "late";
  return "upcoming";
}

const STATUS_CONFIG = {
  on_time:  { label: "On Time",   color: "#22C55E", bg: "#F0FDF4" },
  late:     { label: "Late",      color: "#F59E0B", bg: "#FFFBEB" },
  no_show:  { label: "No Check-In", color: "#EF4444", bg: "#FEF2F2" },
  upcoming: { label: "Upcoming",  color: "#6B7280", bg: "#F9FAFB" },
  completed:{ label: "Completed", color: "#0a7ea4", bg: "#EFF6FF" },
};

export default function OpsPunctualityScreen() {
  const colors = useColors();
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [refreshing, setRefreshing] = useState(false);

  const { data: jobs = [], isLoading, refetch } = trpc.ops.getTodayPunctuality.useQuery(
    { date: selectedDate },
    { refetchInterval: 60000 }
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  // Group by detailer
  const byDetailer = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const job of jobs) {
      const key = job.assignedTo ?? "Unassigned";
      if (!map[key]) map[key] = [];
      map[key].push(job);
    }
    return map;
  }, [jobs]);

  const summary = useMemo(() => {
    let onTime = 0, late = 0, noShow = 0, upcoming = 0, completed = 0;
    for (const job of jobs) {
      const s = getStatus(job);
      if (s === "on_time") onTime++;
      else if (s === "late") late++;
      else if (s === "no_show") noShow++;
      else if (s === "upcoming") upcoming++;
      else if (s === "completed") completed++;
    }
    return { onTime, late, noShow, upcoming, completed, total: jobs.length };
  }, [jobs]);

  const formatTime = (slot: string | null | undefined) => slot ?? "TBD";

  return (
    <ScreenContainer>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Header */}
        <View style={[styles.header, { backgroundColor: "#0a0a0a" }]}>
          <Text style={styles.headerTitle}>Appointment Punctuality</Text>
          <Text style={styles.headerDate}>{selectedDate}</Text>
        </View>

        {/* Summary Cards */}
        <View style={styles.summaryRow}>
          {[
            { label: "Total", value: summary.total, color: "#6B7280" },
            { label: "On Time", value: summary.onTime + summary.completed, color: "#22C55E" },
            { label: "Late", value: summary.late, color: "#F59E0B" },
            { label: "No Check-In", value: summary.noShow, color: "#EF4444" },
          ].map((s) => (
            <View key={s.label} style={[styles.summaryCard, { borderTopColor: s.color }]}>
              <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.summaryLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {isLoading && (
          <ActivityIndicator color="#0a7ea4" style={{ marginTop: 40 }} />
        )}

        {!isLoading && jobs.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No jobs scheduled for {selectedDate}</Text>
          </View>
        )}

        {/* Jobs by Detailer */}
        {Object.entries(byDetailer).map(([detailer, detailerJobs]) => (
          <View key={detailer} style={styles.detailerSection}>
            <View style={styles.detailerHeader}>
              <Text style={styles.detailerName}>👤 {detailer}</Text>
              <Text style={styles.detailerCount}>{detailerJobs.length} job{detailerJobs.length !== 1 ? "s" : ""}</Text>
            </View>

            {detailerJobs.map((job) => {
              const status = getStatus(job);
              const cfg = STATUS_CONFIG[status];
              return (
                <View key={job.jobId} style={[styles.jobCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.jobRow}>
                    <View style={styles.jobLeft}>
                      <Text style={[styles.jobTime, { color: colors.foreground }]}>
                        {formatTime(job.timeSlot)}
                      </Text>
                      <Text style={[styles.jobCustomer, { color: colors.foreground }]} numberOfLines={1}>
                        {job.customerName ?? "Customer"}
                      </Text>
                      <Text style={[styles.jobPackage, { color: colors.muted }]} numberOfLines={1}>
                        {job.packageType ?? "Service"} · {job.vehicleType ?? "Vehicle"}
                      </Text>
                      {job.customerAddress ? (
                        <Text style={[styles.jobAddress, { color: colors.muted }]} numberOfLines={1}>
                          📍 {job.customerAddress}
                        </Text>
                      ) : null}
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
                      <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    padding: 20,
    paddingTop: 16,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
  },
  headerDate: {
    fontSize: 14,
    color: "#9BA1A6",
    marginTop: 2,
  },
  summaryRow: {
    flexDirection: "row",
    padding: 12,
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
    borderTopWidth: 3,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: "700",
  },
  summaryLabel: {
    fontSize: 10,
    color: "#6B7280",
    marginTop: 2,
    textAlign: "center",
  },
  detailerSection: {
    marginHorizontal: 12,
    marginBottom: 16,
  },
  detailerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  detailerName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0a7ea4",
  },
  detailerCount: {
    fontSize: 12,
    color: "#6B7280",
  },
  jobCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  jobRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  jobLeft: {
    flex: 1,
    marginRight: 8,
  },
  jobTime: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 2,
  },
  jobCustomer: {
    fontSize: 14,
    fontWeight: "600",
  },
  jobPackage: {
    fontSize: 12,
    marginTop: 2,
  },
  jobAddress: {
    fontSize: 11,
    marginTop: 3,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
  },
  empty: {
    alignItems: "center",
    marginTop: 60,
    padding: 20,
  },
  emptyText: {
    color: "#6B7280",
    fontSize: 15,
    textAlign: "center",
  },
});
