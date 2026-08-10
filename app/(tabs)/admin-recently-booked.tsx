/**
 * Recently Booked Jobs screen
 * Deep-linked from push notifications when a new job is booked.
 * Shows all jobs created in the last 7 days, sorted newest first.
 * Tapping any row opens the full job detail in admin-schedule.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

type Job = {
  jobId: string;
  customerName: string | null;
  date: string | null;
  timeSlot: string | null;
  location: string | null;
  packageType: string | null;
  serviceDescription: string | null;
  assignedTo: string | null;
  totalPrice: string | null;
  customPrice: string | null;
  status: string;
  createdAt: Date | string;
  source: string;
  leadSource: string | null;
  onlineBookingId: string | null;
};

function timeAgo(dateVal: Date | string): string {
  const date = typeof dateVal === "string" ? new Date(dateVal) : dateVal;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return "Yesterday";
  return `${diffDays} days ago`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
}

function formatPrice(job: Job): string {
  const raw = job.customPrice != null ? job.customPrice : job.totalPrice;
  const val = parseFloat(String(raw ?? "0"));
  if (isNaN(val) || val === 0) return "";
  return `$${val.toFixed(2)}`;
}

function statusColor(status: string, colors: ReturnType<typeof useColors>): string {
  switch (status) {
    case "completed": return colors.success ?? "#22C55E";
    case "in_progress": return colors.primary;
    case "cancelled": return colors.error ?? "#EF4444";
    default: return colors.muted;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "confirmed": return "Confirmed";
    case "pending": return "Pending";
    case "in_progress": return "In Progress";
    case "completed": return "Completed";
    case "cancelled": return "Cancelled";
    default: return status;
  }
}

function cityLabel(loc: string | null): string {
  if (!loc) return "";
  return loc.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export default function AdminRecentlyBookedScreen() {
  const colors = useColors();
  const router = useRouter();
  const [days, setDays] = useState(7);

  const { data = [], isLoading, refetch, isFetching } = trpc.jobs.listRecentlyBooked.useQuery(
    { days },
    { staleTime: 30_000 }
  );

  const jobs = data as Job[];

  const handleJobPress = (job: Job) => {
    // Navigate to admin-schedule with the jobId highlighted — opens the full detail modal
    router.push({
      pathname: "/(tabs)/admin-schedule",
      params: { highlightBookingId: job.jobId },
    } as any);
  };

  const renderItem = ({ item }: { item: Job }) => {
    const price = formatPrice(item);
    const pkg = item.packageType || item.serviceDescription || "Detail Service";
    const city = cityLabel(item.location);
    const ago = timeAgo(item.createdAt);
    const dateStr = item.date ? `${formatDate(item.date)}${item.timeSlot ? ` · ${item.timeSlot}` : ""}` : "";

    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => handleJobPress(item)}
        activeOpacity={0.75}
      >
        {/* Header row: customer name + time ago */}
        <View style={styles.cardHeader}>
          <Text style={[styles.customerName, { color: colors.foreground }]} numberOfLines={1}>
            {item.customerName || "Unknown Customer"}
          </Text>
          <Text style={[styles.timeAgo, { color: colors.muted }]}>{ago}</Text>
        </View>

        {/* Package + price row */}
        <View style={styles.cardRow}>
          <Text style={[styles.pkg, { color: colors.primary }]} numberOfLines={1}>{pkg}</Text>
          {price ? (
            <Text style={[styles.price, { color: colors.success ?? "#22C55E" }]}>{price}</Text>
          ) : null}
        </View>

        {/* Date + city + detailer row */}
        <View style={styles.cardRow}>
          {dateStr ? (
            <Text style={[styles.meta, { color: colors.muted }]}>{dateStr}</Text>
          ) : null}
          {city ? (
            <Text style={[styles.meta, { color: colors.muted }]}>{city}</Text>
          ) : null}
          {item.assignedTo ? (
            <Text style={[styles.meta, { color: colors.muted }]}>👤 {item.assignedTo}</Text>
          ) : null}
        </View>

        {/* Status + source badge row */}
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: statusColor(item.status, colors) + "22", borderColor: statusColor(item.status, colors) }]}>
            <Text style={[styles.badgeText, { color: statusColor(item.status, colors) }]}>
              {statusLabel(item.status)}
            </Text>
          </View>
          {(() => {
            const isApp = item.source === "portal_app" || item.onlineBookingId?.startsWith("portal_");
            const isPortal = item.source === "portal";
            const isWebsite = !isApp && !isPortal && (item.source === "online" || item.leadSource?.toLowerCase().includes("online"));
            if (isApp) return (
              <View style={[styles.badge, { backgroundColor: "#8B5CF622", borderColor: "#8B5CF6", marginLeft: 6 }]}>
                <Text style={[styles.badgeText, { color: "#8B5CF6" }]}>📱 App</Text>
              </View>
            );
            if (isPortal) return (
              <View style={[styles.badge, { backgroundColor: "#06B6D422", borderColor: "#06B6D4", marginLeft: 6 }]}>
                <Text style={[styles.badgeText, { color: "#06B6D4" }]}>🔐 Portal</Text>
              </View>
            );
            if (isWebsite) return (
              <View style={[styles.badge, { backgroundColor: "#0EA5E922", borderColor: "#0EA5E9", marginLeft: 6 }]}>
                <Text style={[styles.badgeText, { color: "#0EA5E9" }]}>🌐 Website</Text>
              </View>
            );
            return (
              <View style={[styles.badge, { backgroundColor: colors.surface, borderColor: colors.border, marginLeft: 6 }]}>
                <Text style={[styles.badgeText, { color: colors.muted }]}>Admin</Text>
              </View>
            );
          })()}
          {/* Tap hint */}
          <Text style={[styles.tapHint, { color: colors.muted }]}>Tap to view →</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer edges={["left", "right"]} containerClassName="bg-background">
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[styles.backText, { color: colors.primary }]}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Recently Booked</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Day filter chips */}
      <View style={[styles.filterRow, { borderBottomColor: colors.border }]}>
        {[1, 3, 7, 14, 30].map(d => (
          <TouchableOpacity
            key={d}
            style={[
              styles.chip,
              { borderColor: colors.border, backgroundColor: days === d ? colors.primary : colors.surface },
            ]}
            onPress={() => setDays(d)}
          >
            <Text style={[styles.chipText, { color: days === d ? "#fff" : colors.muted }]}>
              {d === 1 ? "Today" : d === 3 ? "3 days" : d === 7 ? "7 days" : d === 14 ? "14 days" : "30 days"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : jobs.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyIcon]}>📋</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No jobs booked yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
            Jobs booked in the last {days} day{days !== 1 ? "s" : ""} will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={jobs}
          keyExtractor={item => item.jobId}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            <Text style={[styles.count, { color: colors.muted }]}>
              {jobs.length} job{jobs.length !== 1 ? "s" : ""} booked in the last {days} day{days !== 1 ? "s" : ""}
            </Text>
          }
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 60 },
  backText: { fontSize: 17, fontWeight: "500" },
  title: { fontSize: 17, fontWeight: "700" },
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: "600" },
  count: { fontSize: 12, marginBottom: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  card: {
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  customerName: { fontSize: 16, fontWeight: "700", flex: 1, marginRight: 8 },
  timeAgo: { fontSize: 12, fontWeight: "500" },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  pkg: { fontSize: 14, fontWeight: "600", flex: 1 },
  price: { fontSize: 15, fontWeight: "700" },
  meta: { fontSize: 13 },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  badgeText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  tapHint: { fontSize: 12, marginLeft: "auto" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "700", marginBottom: 6 },
  emptySubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20 },
});
