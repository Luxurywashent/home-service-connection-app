import React, { useState, useMemo } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, StyleSheet, Alert, ActivityIndicator,
  Modal, FlatList,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";

const INSPECTION_CHECKS = [
  { key: "no_trash",       label: "No trash left from the vehicle on the job site" },
  { key: "clean_env",      label: "Clean working environment maintained" },
  { key: "proper_process", label: "Proper detailing process followed (correct steps in order)" },
  { key: "quality",        label: "Quality of work meets standard" },
  { key: "equipment_ok",   label: "All equipment in working order" },
  { key: "professional",   label: "Detailer looking professional (uniform, appearance)" },
  { key: "parked_proper",  label: "Van parked properly" },
  { key: "working_safely", label: "Working safely" },
  { key: "van_stocked",    label: "Van properly stocked with supplies" },
];

function genId() {
  return `insp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatDateTime(dateVal: any): string {
  if (!dateVal) return "—";
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    + " · "
    + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

type Tab = "form" | "history";

export default function OpsInspectionScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();

  const detailersQuery = trpc.employee.listDetailers.useQuery(undefined, { staleTime: 60000 });
  const DETAILERS: string[] = (detailersQuery.data ?? []).map((d: any) => d.fullName).filter(Boolean);

  const [activeTab, setActiveTab] = useState<Tab>("form");
  const [detailerName, setDetailerName] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [jobAddress, setJobAddress] = useState("");
  const [overallNotes, setOverallNotes] = useState("");
  const [checks, setChecks] = useState<Record<string, { passed: boolean; notes: string }>>(
    Object.fromEntries(INSPECTION_CHECKS.map((c) => [c.key, { passed: true, notes: "" }]))
  );
  const [submitted, setSubmitted] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState<any>(null);

  const submitMutation = trpc.ops.submitInspection.useMutation();
  const { data: allInspections = [], refetch: refetchInspections } = trpc.ops.listInspections.useQuery({ limit: 200 });
  const inspectionItemsQuery = trpc.ops.listInspectionItems.useQuery(
    { inspectionId: selectedInspection?.inspectionId ?? "" },
    { enabled: !!selectedInspection?.inspectionId }
  );

  // ── Stats card calculations ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = allInspections.length;
    if (total === 0) return { total: 0, passCount: 0, failCount: 0, passPct: 0 };
    const passCount = allInspections.filter((i: any) => i.overallPass === 1).length;
    const failCount = total - passCount;
    const passPct = Math.round((passCount / total) * 100);
    return { total, passCount, failCount, passPct };
  }, [allInspections]);

  const toggleCheck = (key: string) => {
    setChecks((prev) => ({ ...prev, [key]: { ...prev[key], passed: !prev[key].passed } }));
  };

  const setCheckNote = (key: string, note: string) => {
    setChecks((prev) => ({ ...prev, [key]: { ...prev[key], notes: note } }));
  };

  const allPassed = Object.values(checks).every((c) => c.passed);
  const failCount = Object.values(checks).filter((c) => !c.passed).length;

  const handleSubmit = async () => {
    if (!detailerName.trim()) {
      Alert.alert("Missing Info", "Please select a team member.");
      return;
    }

    const inspectionId = genId();
    const items = INSPECTION_CHECKS.map((c) => ({
      itemId: `${inspectionId}_${c.key}`,
      checkKey: c.key,
      checkLabel: c.label,
      passed: checks[c.key].passed,
      notes: checks[c.key].notes || undefined,
    }));

    try {
      await submitMutation.mutateAsync({
        inspectionId,
        opsManagerId: employee?.employeeId ?? "unknown",
        opsManagerName: employee?.fullName ?? undefined,
        detailerId: detailerName.toLowerCase().replace(/\s+/g, "_"),
        detailerName: detailerName.trim(),
        jobAddress: jobAddress.trim() || undefined,
        inspectedAt: new Date().toISOString(),
        overallPass: allPassed,
        notes: overallNotes.trim() || undefined,
        items,
      });

      setSubmitted(true);
      refetchInspections();
    } catch {
      Alert.alert("Error", "Failed to submit inspection. Please try again.");
    }
  };

  const handleNewInspection = () => {
    setDetailerName("");
    setJobAddress("");
    setOverallNotes("");
    setChecks(Object.fromEntries(INSPECTION_CHECKS.map((c) => [c.key, { passed: true, notes: "" }])));
    setSubmitted(false);
    setActiveTab("form");
  };

  // ── Success screen ─────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <ScreenContainer>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <View style={[styles.successCard, { backgroundColor: allPassed ? "#F0FDF4" : "#FEF2F2" }]}>
            <Text style={styles.successIcon}>{allPassed ? "✅" : "⚠️"}</Text>
            <Text style={[styles.successTitle, { color: allPassed ? "#16A34A" : "#DC2626" }]}>
              {allPassed ? "Inspection Passed" : `${failCount} Item${failCount !== 1 ? "s" : ""} Failed`}
            </Text>
            <Text style={styles.successSub}>Team Member: {detailerName}</Text>
            <Text style={styles.successSub}>Submitted: {new Date().toLocaleTimeString()}</Text>
            <Text style={[styles.successSub, { marginTop: 6, color: "#0a7ea4" }]}>
              📧 Report sent to {detailerName}
            </Text>
            {!allPassed && (
              <View style={styles.failList}>
                {INSPECTION_CHECKS.filter((c) => !checks[c.key].passed).map((c) => (
                  <Text key={c.key} style={styles.failItem}>• {c.label}</Text>
                ))}
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: "#0a7ea4" }]}
            onPress={handleNewInspection}
          >
            <Text style={styles.primaryBtnText}>Start New Inspection</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: 0 }]}
            onPress={() => { setSubmitted(false); setActiveTab("history"); }}
          >
            <Text style={[styles.primaryBtnText, { color: colors.foreground }]}>View History</Text>
          </TouchableOpacity>
        </ScrollView>
      </ScreenContainer>
    );
  }

  // ── Main screen ────────────────────────────────────────────────────────────
  return (
    <ScreenContainer>
      {/* ── Header ── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 0 }}>
        <Text style={[styles.pageTitle, { color: colors.foreground }]}>Job Site Inspection</Text>
        <Text style={[styles.pageSub, { color: colors.muted }]}>Complete all items on arrival</Text>
      </View>

      {/* ── Tabs ── */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "form" && { borderBottomColor: "#0a7ea4", borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("form")}
        >
          <Text style={[styles.tabText, { color: activeTab === "form" ? "#0a7ea4" : colors.muted }]}>New Inspection</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "history" && { borderBottomColor: "#0a7ea4", borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("history")}
        >
          <Text style={[styles.tabText, { color: activeTab === "history" ? "#0a7ea4" : colors.muted }]}>
            History {allInspections.length > 0 ? `(${allInspections.length})` : ""}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Form Tab ── */}
      {activeTab === "form" && (
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
          {/* Stats card */}
          {stats.total > 0 && (
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
          )}

          <View style={{ padding: 16 }}>
            {/* Detailer Info */}
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Team Member Info</Text>
            <TouchableOpacity
              style={[styles.input, styles.dropdownBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => setShowDropdown(true)}
              activeOpacity={0.7}
            >
              <Text style={{ color: detailerName ? colors.foreground : colors.muted, fontSize: 14, flex: 1 }}>
                {detailerName || "Select Team Member *"}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>▼</Text>
            </TouchableOpacity>

            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              placeholder="Job Address (optional)"
              placeholderTextColor={colors.muted}
              value={jobAddress}
              onChangeText={setJobAddress}
            />

            {/* Checklist */}
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 16 }]}>Inspection Checklist</Text>
            <Text style={[styles.sectionSub, { color: colors.muted }]}>Toggle any item that does NOT pass</Text>

            {INSPECTION_CHECKS.map((check) => {
              const item = checks[check.key];
              return (
                <View key={check.key} style={[styles.checkCard, { backgroundColor: colors.surface, borderColor: item.passed ? colors.border : "#EF4444" }]}>
                  <TouchableOpacity style={styles.checkRow} onPress={() => toggleCheck(check.key)} activeOpacity={0.7}>
                    <View style={[styles.checkBox, { backgroundColor: item.passed ? "#22C55E" : "#EF4444" }]}>
                      <Text style={styles.checkBoxText}>{item.passed ? "✓" : "✗"}</Text>
                    </View>
                    <Text style={[styles.checkLabel, { color: colors.foreground }]}>{check.label}</Text>
                  </TouchableOpacity>
                  {!item.passed && (
                    <TextInput
                      style={[styles.noteInput, { backgroundColor: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }]}
                      placeholder="Describe the issue..."
                      placeholderTextColor="#FCA5A5"
                      value={item.notes}
                      onChangeText={(t) => setCheckNote(check.key, t)}
                      multiline
                    />
                  )}
                </View>
              );
            })}

            {/* Overall Notes */}
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 16 }]}>Overall Notes</Text>
            <TextInput
              style={[styles.input, styles.multilineInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              placeholder="Additional observations (optional)"
              placeholderTextColor={colors.muted}
              value={overallNotes}
              onChangeText={setOverallNotes}
              multiline
              numberOfLines={3}
            />

            {/* Status preview */}
            <View style={[styles.statusPreview, { backgroundColor: allPassed ? "#F0FDF4" : "#FEF2F2" }]}>
              <Text style={[styles.statusPreviewText, { color: allPassed ? "#16A34A" : "#DC2626" }]}>
                {allPassed ? "✅ All items passing" : `⚠️ ${failCount} item${failCount !== 1 ? "s" : ""} failing`}
              </Text>
            </View>

            {/* Submit */}
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: "#0a7ea4", opacity: submitMutation.isPending ? 0.6 : 1 }]}
              onPress={handleSubmit}
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Submit Inspection</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* ── History Tab ── */}
      {activeTab === "history" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
          {allInspections.length === 0 ? (
            <View style={{ alignItems: "center", paddingTop: 60 }}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>📋</Text>
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>No inspections yet</Text>
              <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4 }}>Submitted inspections will appear here</Text>
            </View>
          ) : (
            allInspections.map((insp: any) => {
              const passed = insp.overallPass === 1 || insp.overallPass === true;
              return (
                <TouchableOpacity
                  key={insp.inspectionId}
                  style={[styles.historyCard, { backgroundColor: colors.surface, borderColor: passed ? colors.border : "#FECACA" }]}
                  onPress={() => setSelectedInspection(insp)}
                  activeOpacity={0.75}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.historyName, { color: colors.foreground }]}>{insp.detailerName ?? "Unknown"}</Text>
                      {insp.jobAddress ? (
                        <Text style={[styles.historyMeta, { color: colors.muted }]} numberOfLines={1}>📍 {insp.jobAddress}</Text>
                      ) : null}
                      <Text style={[styles.historyTime, { color: colors.muted }]}>🕐 {formatDateTime(insp.inspectedAt)}</Text>
                      {insp.opsManagerName ? (
                        <Text style={[styles.historyMeta, { color: colors.muted }]}>Inspector: {insp.opsManagerName}</Text>
                      ) : null}
                    </View>
                    <View style={[styles.historyBadge, { backgroundColor: passed ? "#F0FDF4" : "#FEF2F2" }]}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: passed ? "#16A34A" : "#DC2626" }}>
                        {passed ? "✅ PASS" : "⚠️ FAIL"}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}

      {/* ── Detailer dropdown modal ── */}
      <Modal visible={showDropdown} transparent animationType="fade" onRequestClose={() => setShowDropdown(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowDropdown(false)}>
          <View style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Select Team Member</Text>
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={DETAILERS}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.modalOption,
                    { borderBottomColor: colors.border },
                    detailerName === item && { backgroundColor: "#0a7ea415" },
                  ]}
                  onPress={() => { setDetailerName(item); setShowDropdown(false); }}
                >
                  <Text style={[styles.modalOptionText, { color: colors.foreground, fontWeight: detailerName === item ? "700" : "400" }]}>
                    {item}
                  </Text>
                  {detailerName === item && <Text style={{ color: "#0a7ea4", fontWeight: "700" }}>✓</Text>}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Inspection Detail Modal ── */}
      <Modal
        visible={!!selectedInspection}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedInspection(null)}
      >
        <View style={styles.detailModalOverlay}>
          <View style={[styles.detailModalSheet, { backgroundColor: colors.background }]}>
            {selectedInspection && (
              <>
                <View style={[styles.detailHeader, { borderBottomColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.detailTitle, { color: colors.foreground }]}>
                      {selectedInspection.detailerName ?? "Unknown"}
                    </Text>
                    <Text style={[styles.detailTime, { color: colors.muted }]}>
                      {formatDateTime(selectedInspection.inspectedAt)}
                    </Text>
                    {selectedInspection.jobAddress ? (
                      <Text style={[styles.detailTime, { color: colors.muted }]}>📍 {selectedInspection.jobAddress}</Text>
                    ) : null}
                    {selectedInspection.opsManagerName ? (
                      <Text style={[styles.detailTime, { color: colors.muted }]}>Inspector: {selectedInspection.opsManagerName}</Text>
                    ) : null}
                  </View>
                  <View style={[styles.historyBadge, {
                    backgroundColor: (selectedInspection.overallPass === 1 || selectedInspection.overallPass === true) ? "#F0FDF4" : "#FEF2F2"
                  }]}>
                    <Text style={{
                      fontSize: 12, fontWeight: "700",
                      color: (selectedInspection.overallPass === 1 || selectedInspection.overallPass === true) ? "#16A34A" : "#DC2626"
                    }}>
                      {(selectedInspection.overallPass === 1 || selectedInspection.overallPass === true) ? "✅ PASS" : "⚠️ FAIL"}
                    </Text>
                  </View>
                </View>

                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
                  {inspectionItemsQuery.isLoading ? (
                    <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
                  ) : inspectionItemsQuery.data && inspectionItemsQuery.data.length > 0 ? (
                    <>
                      <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 10 }]}>Checklist Results</Text>
                      {inspectionItemsQuery.data.map((item: any) => (
                        <View key={item.itemId} style={[styles.detailItem, {
                          backgroundColor: colors.surface,
                          borderColor: (item.passed === 1 || item.passed === true) ? colors.border : "#FECACA",
                        }]}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                            <View style={[styles.checkBox, {
                              backgroundColor: (item.passed === 1 || item.passed === true) ? "#22C55E" : "#EF4444",
                              width: 24, height: 24
                            }]}>
                              <Text style={[styles.checkBoxText, { fontSize: 12 }]}>
                                {(item.passed === 1 || item.passed === true) ? "✓" : "✗"}
                              </Text>
                            </View>
                            <Text style={[styles.checkLabel, { color: colors.foreground, fontSize: 13 }]}>{item.checkLabel}</Text>
                          </View>
                          {item.notes ? (
                            <Text style={{ fontSize: 12, color: "#DC2626", marginTop: 6, marginLeft: 34 }}>
                              Note: {item.notes}
                            </Text>
                          ) : null}
                        </View>
                      ))}
                    </>
                  ) : (
                    <Text style={{ color: colors.muted, textAlign: "center", marginTop: 24 }}>No checklist items found.</Text>
                  )}

                  {selectedInspection.notes ? (
                    <View style={{ marginTop: 16 }}>
                      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Overall Notes</Text>
                      <View style={[styles.notesBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 20 }}>{selectedInspection.notes}</Text>
                      </View>
                    </View>
                  ) : null}
                </ScrollView>

                <View style={{ padding: 16, paddingBottom: 24 }}>
                  <TouchableOpacity
                    style={[styles.primaryBtn, { backgroundColor: "#0a7ea4" }]}
                    onPress={() => setSelectedInspection(null)}
                  >
                    <Text style={styles.primaryBtnText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  pageTitle: { fontSize: 22, fontWeight: "700" },
  pageSub: { fontSize: 13, marginTop: 2, marginBottom: 8 },
  // Tabs
  tabBar: { flexDirection: "row", borderBottomWidth: 1, marginTop: 4 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 10 },
  tabText: { fontSize: 14, fontWeight: "600" },
  // Stats
  statsCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  statsTitle: { fontSize: 14, fontWeight: "700", marginBottom: 12 },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: { fontSize: 11, marginTop: 2 },
  statDivider: { width: 1, height: 36, marginHorizontal: 4 },
  // Form
  sectionTitle: { fontSize: 15, fontWeight: "700", marginBottom: 8 },
  sectionSub: { fontSize: 12, marginBottom: 10, marginTop: -4 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    marginBottom: 10,
  },
  dropdownBtn: { flexDirection: "row", alignItems: "center" },
  multilineInput: { minHeight: 80, textAlignVertical: "top" },
  checkCard: { borderWidth: 1.5, borderRadius: 10, marginBottom: 8, overflow: "hidden" },
  checkRow: { flexDirection: "row", alignItems: "center", padding: 12, gap: 10 },
  checkBox: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  checkBoxText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  checkLabel: { flex: 1, fontSize: 13, lineHeight: 18 },
  noteInput: { borderTopWidth: 1, padding: 10, fontSize: 13, minHeight: 50, textAlignVertical: "top" },
  statusPreview: { borderRadius: 10, padding: 12, alignItems: "center", marginBottom: 16 },
  statusPreviewText: { fontSize: 14, fontWeight: "700" },
  primaryBtn: { borderRadius: 12, padding: 16, alignItems: "center", marginBottom: 8 },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  // Success
  successCard: { borderRadius: 16, padding: 24, alignItems: "center", marginBottom: 24 },
  successIcon: { fontSize: 48, marginBottom: 8 },
  successTitle: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  successSub: { fontSize: 14, color: "#6B7280", marginTop: 2 },
  failList: { marginTop: 12, alignSelf: "stretch" },
  failItem: { fontSize: 13, color: "#DC2626", marginBottom: 4 },
  // History list
  historyCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  historyName: { fontSize: 15, fontWeight: "700", marginBottom: 2 },
  historyMeta: { fontSize: 12, marginTop: 2 },
  historyTime: { fontSize: 12, marginTop: 3 },
  historyBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignItems: "center", justifyContent: "center", marginLeft: 10 },
  // Detail modal
  detailModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  detailModalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "90%", flex: 0, minHeight: "60%" },
  detailHeader: { flexDirection: "row", alignItems: "flex-start", padding: 16, borderBottomWidth: 1 },
  detailTitle: { fontSize: 17, fontWeight: "700" },
  detailTime: { fontSize: 12, marginTop: 3 },
  detailItem: { borderWidth: 1.5, borderRadius: 10, padding: 12, marginBottom: 8 },
  notesBox: { borderWidth: 1, borderRadius: 10, padding: 12 },
  // Dropdown modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "60%" },
  modalTitle: { fontSize: 17, fontWeight: "700", marginBottom: 12 },
  modalOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1 },
  modalOptionText: { fontSize: 16 },
});
