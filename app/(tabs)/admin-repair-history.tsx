import { useState, useMemo } from "react";
import {
  View, Text, FlatList, ActivityIndicator, TextInput,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  open: "#EF4444",
  in_progress: "#F59E0B",
  resolved: "#22C55E",
};
const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
};
const PRIORITY_COLORS: Record<string, string> = {
  high: "#EF4444",
  medium: "#F59E0B",
  low: "#22C55E",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

// ─── Repair Card ──────────────────────────────────────────────────────────────
function RepairHistoryCard({ item, colors }: { item: any; colors: any }) {
  const statusColor = STATUS_COLORS[item.status] ?? colors.muted;
  const priorityColor = PRIORITY_COLORS[item.priority] ?? colors.muted;

  return (
    <View style={{
      backgroundColor: colors.surface, borderRadius: 14, padding: 14,
      borderWidth: 1, borderColor: colors.border, marginBottom: 10,
    }}>
      {/* Top row: van + status */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>
          🚐 {item.vanName || item.vanId}
        </Text>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <View style={{ backgroundColor: priorityColor + "20", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
            <Text style={{ color: priorityColor, fontSize: 10, fontWeight: "700", textTransform: "uppercase" }}>
              {item.priority}
            </Text>
          </View>
          <View style={{ backgroundColor: statusColor + "20", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
            <Text style={{ color: statusColor, fontSize: 10, fontWeight: "700" }}>
              {STATUS_LABELS[item.status] ?? item.status}
            </Text>
          </View>
        </View>
      </View>

      {/* Equipment + sub-issue */}
      <Text style={{ fontSize: 14, color: colors.foreground, marginBottom: 2 }}>
        🔧 {item.equipmentName}{item.subIssue ? ` — ${item.subIssue}` : ""}
      </Text>

      {/* Detailer */}
      <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 2 }}>
        👤 {item.employeeName || item.employeeId}
      </Text>

      {/* Notes */}
      {item.notes ? (
        <Text style={{ fontSize: 12, color: colors.muted, fontStyle: "italic", marginBottom: 4 }}>
          "{item.notes}"
        </Text>
      ) : null}

      {/* Dates */}
      <View style={{ marginTop: 6, gap: 2 }}>
        <Text style={{ fontSize: 11, color: colors.muted }}>Submitted: {formatDate(item.createdAt)}</Text>
        {item.resolvedAt ? (
          <Text style={{ fontSize: 11, color: colors.success }}>
            ✓ Resolved: {formatDate(item.resolvedAt)}{item.resolvedBy ? ` by ${item.resolvedBy}` : ""}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Summary Stats ────────────────────────────────────────────────────────────
function SummaryBar({ orders, colors }: { orders: any[]; colors: any }) {
  const open = orders.filter((o) => o.status === "open").length;
  const inProgress = orders.filter((o) => o.status === "in_progress").length;
  const resolved = orders.filter((o) => o.status === "resolved").length;
  const highPriority = orders.filter((o) => o.priority === "high").length;

  return (
    <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 }}>
      {[
        { label: "Open", value: open, color: "#EF4444" },
        { label: "In Progress", value: inProgress, color: "#F59E0B" },
        { label: "Resolved", value: resolved, color: "#22C55E" },
        { label: "High Priority", value: highPriority, color: "#EF4444" },
      ].map((stat) => (
        <View key={stat.label} style={{
          flex: 1, backgroundColor: colors.surface, borderRadius: 10, padding: 10,
          alignItems: "center", borderWidth: 1, borderColor: colors.border,
        }}>
          <Text style={{ fontSize: 18, fontWeight: "800", color: stat.color }}>{stat.value}</Text>
          <Text style={{ fontSize: 9, color: colors.muted, textAlign: "center", marginTop: 2 }} numberOfLines={2}>{stat.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminRepairHistoryScreen() {
  const colors = useColors();
  const [searchText, setSearchText] = useState("");

  const { data: orders = [], isLoading } = trpc.fleet.listRepairOrders.useQuery(
    { status: "all" },
    { refetchOnMount: true },
  );

  const filtered = useMemo(() => {
    const all = orders as any[];
    if (!searchText.trim()) return all;
    const q = searchText.toLowerCase();
    return all.filter((o) =>
      (o.vanName || o.vanId || "").toLowerCase().includes(q) ||
      (o.employeeName || o.employeeId || "").toLowerCase().includes(q) ||
      (o.equipmentName || "").toLowerCase().includes(q) ||
      (o.subIssue || "").toLowerCase().includes(q)
    );
  }, [orders, searchText]);

  return (
    <ScreenContainer edges={["left", "right"]}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 }}>
        <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground }}>📋 Repair History</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>
          {filtered.length} record{filtered.length !== 1 ? "s" : ""}
        </Text>
      </View>

      {/* Search */}
      <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search by van, detailer, equipment..."
          placeholderTextColor={colors.muted}
          style={{
            backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14,
            paddingVertical: 10, borderWidth: 1, borderColor: colors.border,
            color: colors.foreground, fontSize: 14,
          }}
        />
      </View>

      {/* Summary */}
      {!isLoading && filtered.length > 0 && <SummaryBar orders={filtered} colors={colors} />}

      {/* List */}
      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Text style={{ fontSize: 36 }}>📋</Text>
          <Text style={{ color: colors.muted, fontSize: 15 }}>No repair records found</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>No repair records yet</Text>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={filtered}
          keyExtractor={(item) => item.repairId}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          renderItem={({ item }) => <RepairHistoryCard item={item} colors={colors} />}
        />
      )}
    </ScreenContainer>
  );
}
