import React, { useState, useMemo } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Modal, FlatList,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

const DETAILERS = ["All", "Casey", "Lamont", "Michael", "Cameron", "Gabe", "Giovanni"];

export default function AdminInspectionsScreen() {
  const colors = useColors();
  const [filterDetailer, setFilterDetailer] = useState("All");
  const [filterResult, setFilterResult] = useState<"all" | "pass" | "fail">("all");
  const [selectedInspection, setSelectedInspection] = useState<any | null>(null);

  const { data: allInspections = [], isLoading, refetch } = trpc.ops.listInspections.useQuery({ limit: 200 });
  const { data: allItems = [] } = trpc.ops.listInspectionItems.useQuery(
    { inspectionId: selectedInspection?.inspectionId ?? "" },
    { enabled: !!selectedInspection }
  );

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = allInspections.length;
    if (total === 0) return { total: 0, passCount: 0, failCount: 0, passPct: 0 };
    const passCount = allInspections.filter((i: any) => i.overallPass === 1).length;
    const failCount = total - passCount;
    const passPct = Math.round((passCount / total) * 100);
    return { total, passCount, failCount, passPct };
  }, [allInspections]);

  // ── Per-detailer stats ─────────────────────────────────────────────────────
  const detailerStats = useMemo(() => {
    const map: Record<string, { total: number; pass: number }> = {};
    for (const insp of allInspections as any[]) {
      const name = insp.detailerName ?? "Unknown";
      if (!map[name]) map[name] = { total: 0, pass: 0 };
      map[name].total++;
      if (insp.overallPass === 1) map[name].pass++;
    }
    return Object.entries(map)
      .map(([name, s]) => ({ name, ...s, pct: Math.round((s.pass / s.total) * 100) }))
      .sort((a, b) => b.total - a.total);
  }, [allInspections]);

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return (allInspections as any[]).filter((i) => {
      if (filterDetailer !== "All" && i.detailerName !== filterDetailer) return false;
      if (filterResult === "pass" && i.overallPass !== 1) return false;
      if (filterResult === "fail" && i.overallPass === 1) return false;
      return true;
    });
  }, [allInspections, filterDetailer, filterResult]);

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Page title */}
        <View style={{ padding: 16, paddingBottom: 4 }}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>Inspection Reports</Text>
          <Text style={[styles.pageSub, { color: colors.muted }]}>Job site inspection history & stats</Text>
        </View>

        {/* ── Overall stats card ── */}
        <View style={[styles.statsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.statsTitle, { color: colors.foreground }]}>Job Site Report</Text>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>{stats.total}</Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>Total</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: "#16A34A" }]}>{stats.passPct}%</Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>Pass Rate</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: "#16A34A" }]}>{stats.passCount}</Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>Passed</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: stats.failCount > 0 ? "#EF4444" : colors.muted }]}>{stats.failCount}</Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>Failed</Text>
            </View>
          </View>
        </View>

        {/* ── Per-detailer breakdown ── */}
        {detailerStats.length > 0 && (
          <View style={{ marginHorizontal: 16, marginTop: 16 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>By Team Member</Text>
            {detailerStats.map((d) => (
              <View key={d.name} style={[styles.detailerRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.detailerName, { color: colors.foreground }]}>{d.name}</Text>
                <View style={styles.detailerRight}>
                  <Text style={[styles.detailerPct, { color: d.pct >= 90 ? "#16A34A" : d.pct >= 70 ? "#F59E0B" : "#EF4444" }]}>
                    {d.pct}%
                  </Text>
                  <Text style={[styles.detailerCount, { color: colors.muted }]}>{d.pass}/{d.total}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── Filters ── */}
        <View style={{ marginHorizontal: 16, marginTop: 20 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Inspection History</Text>

          {/* Result filter */}
          <View style={styles.filterRow}>
            {(["all", "pass", "fail"] as const).map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.filterChip, { borderColor: colors.border, backgroundColor: filterResult === f ? "#0a7ea4" : colors.surface }]}
                onPress={() => setFilterResult(f)}
              >
                <Text style={{ color: filterResult === f ? "#fff" : colors.muted, fontSize: 13, fontWeight: "600", textTransform: "capitalize" }}>
                  {f === "all" ? "All" : f === "pass" ? "✅ Pass" : "⚠️ Fail"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Detailer filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {DETAILERS.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.filterChip, { borderColor: colors.border, backgroundColor: filterDetailer === d ? "#0a7ea4" : colors.surface }]}
                  onPress={() => setFilterDetailer(d)}
                >
                  <Text style={{ color: filterDetailer === d ? "#fff" : colors.muted, fontSize: 13, fontWeight: "600" }}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* List */}
          {isLoading ? (
            <ActivityIndicator color="#0a7ea4" style={{ marginTop: 20 }} />
          ) : filtered.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.muted }]}>No inspections found.</Text>
          ) : (
            filtered.map((insp: any) => (
              <TouchableOpacity
                key={insp.inspectionId}
                style={[styles.inspCard, { backgroundColor: colors.surface, borderColor: insp.overallPass === 1 ? colors.border : "#EF444440" }]}
                onPress={() => setSelectedInspection(insp)}
                activeOpacity={0.7}
              >
                <View style={styles.inspCardHeader}>
                  <Text style={[styles.inspDetailer, { color: colors.foreground }]}>{insp.detailerName ?? "Unknown"}</Text>
                  <View style={[styles.inspBadge, { backgroundColor: insp.overallPass === 1 ? "#F0FDF4" : "#FEF2F2" }]}>
                    <Text style={{ color: insp.overallPass === 1 ? "#16A34A" : "#DC2626", fontSize: 12, fontWeight: "700" }}>
                      {insp.overallPass === 1 ? "✅ Pass" : "⚠️ Fail"}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.inspMeta, { color: colors.muted }]}>
                  {new Date(insp.inspectedAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                  {" · "}
                  {new Date(insp.inspectedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </Text>
                {insp.jobAddress ? (
                  <Text style={[styles.inspAddr, { color: colors.muted }]}>📍 {insp.jobAddress}</Text>
                ) : null}
                {insp.opsManagerName ? (
                  <Text style={[styles.inspAddr, { color: colors.muted }]}>Inspector: {insp.opsManagerName}</Text>
                ) : null}
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>

      {/* ── Inspection detail modal ── */}
      <Modal visible={!!selectedInspection} animationType="slide" transparent onRequestClose={() => setSelectedInspection(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
            <View style={styles.modalHandle} />
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
              {selectedInspection && (
                <>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <Text style={[styles.modalTitle, { color: colors.foreground }]}>Inspection Detail</Text>
                    <TouchableOpacity onPress={() => setSelectedInspection(null)}>
                      <Text style={{ color: "#0a7ea4", fontSize: 15, fontWeight: "600" }}>Close</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={[styles.detailBanner, { backgroundColor: selectedInspection.overallPass === 1 ? "#F0FDF4" : "#FEF2F2" }]}>
                    <Text style={{ fontSize: 32, marginBottom: 4 }}>{selectedInspection.overallPass === 1 ? "✅" : "⚠️"}</Text>
                    <Text style={[styles.detailStatus, { color: selectedInspection.overallPass === 1 ? "#16A34A" : "#DC2626" }]}>
                      {selectedInspection.overallPass === 1 ? "Passed" : "Failed"}
                    </Text>
                    <Text style={{ color: "#6B7280", fontSize: 13, marginTop: 2 }}>
                      {selectedInspection.detailerName}
                    </Text>
                    <Text style={{ color: "#9CA3AF", fontSize: 12, marginTop: 2 }}>
                      {new Date(selectedInspection.inspectedAt).toLocaleString()}
                    </Text>
                  </View>

                  {selectedInspection.jobAddress ? (
                    <Text style={[styles.detailMeta, { color: colors.muted }]}>📍 {selectedInspection.jobAddress}</Text>
                  ) : null}
                  {selectedInspection.opsManagerName ? (
                    <Text style={[styles.detailMeta, { color: colors.muted }]}>Inspector: {selectedInspection.opsManagerName}</Text>
                  ) : null}
                  {selectedInspection.notes ? (
                    <View style={[styles.notesBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{selectedInspection.notes}</Text>
                    </View>
                  ) : null}

                  <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 16 }]}>Checklist Items</Text>
                  {(allItems as any[]).length === 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 13 }}>No item details available.</Text>
                  ) : (
                    (allItems as any[]).map((item: any) => (
                      <View key={item.itemId} style={[styles.itemRow, { borderBottomColor: colors.border, backgroundColor: item.passed ? "transparent" : "#FEF2F220" }]}>
                        <View style={[styles.itemDot, { backgroundColor: item.passed ? "#22C55E" : "#EF4444" }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.itemLabel, { color: colors.foreground }]}>{item.checkLabel}</Text>
                          {!item.passed && item.notes ? (
                            <Text style={{ color: "#DC2626", fontSize: 12, marginTop: 2 }}>{item.notes}</Text>
                          ) : null}
                        </View>
                        <Text style={{ color: item.passed ? "#16A34A" : "#EF4444", fontSize: 12, fontWeight: "700" }}>
                          {item.passed ? "Pass" : "Fail"}
                        </Text>
                      </View>
                    ))
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  pageTitle: { fontSize: 22, fontWeight: "700" },
  pageSub: { fontSize: 13, marginTop: 2 },
  statsCard: { marginHorizontal: 16, marginTop: 12, borderRadius: 14, borderWidth: 1, padding: 16 },
  statsTitle: { fontSize: 14, fontWeight: "700", marginBottom: 12 },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: { fontSize: 11, marginTop: 2 },
  statDivider: { width: 1, height: 36, marginHorizontal: 4 },
  sectionTitle: { fontSize: 15, fontWeight: "700", marginBottom: 8 },
  detailerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  detailerName: { fontSize: 14, fontWeight: "600" },
  detailerRight: { alignItems: "flex-end" },
  detailerPct: { fontSize: 18, fontWeight: "800" },
  detailerCount: { fontSize: 11, marginTop: 1 },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  emptyText: { textAlign: "center", marginTop: 24, fontSize: 14 },
  inspCard: { borderWidth: 1.5, borderRadius: 12, padding: 14, marginBottom: 10 },
  inspCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  inspDetailer: { fontSize: 15, fontWeight: "700" },
  inspBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  inspMeta: { fontSize: 12, marginTop: 2 },
  inspAddr: { fontSize: 12, marginTop: 2 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%", minHeight: "60%" },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginTop: 10 },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  detailBanner: { borderRadius: 14, padding: 20, alignItems: "center", marginBottom: 12 },
  detailStatus: { fontSize: 20, fontWeight: "800" },
  detailMeta: { fontSize: 13, marginBottom: 4 },
  notesBox: { borderRadius: 10, borderWidth: 1, padding: 12, marginTop: 8 },
  itemRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10, borderBottomWidth: 1, gap: 10 },
  itemDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0 },
  itemLabel: { fontSize: 13, lineHeight: 18, flex: 1 },
});
