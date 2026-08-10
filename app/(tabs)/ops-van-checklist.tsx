import React, { useState, useMemo, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator, Modal,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";

// ─── Detailer list is loaded dynamically from the server ─────────────────────

// ─── Default Van Sections ─────────────────────────────────────────────────────
const DEFAULT_VAN_SECTIONS: { category: string; items: string[] }[] = [
  {
    category: "Products & Chemicals",
    items: [
      "Bead Maker", "Brake Buster", "Acid", "Degreaser", "Glass Cleaner",
      "Interior Cleaner", "Soap", "Pink Dressing", "Tire Dressing",
      "Paint Sealant", "Uno (Polish)", "Bug Off", "Hand Sanitizer",
      "LVP Leather Lotion", "Metal Polish", "Iron Remover", "Trim Dye",
      "Solvent", "White Dressing", "Alumabrite", "Sap Remover",
    ],
  },
  {
    category: "Microfibers & Towels",
    items: [
      "Blue Drying Towels", "Orange/Red/Green Microfiber Towels Royal",
      "Blue/Green Wash Mitts", "Purple Wax Towels", "Grey Drying Towels",
      "Premium Wash Mitts", "Clay Mitt", "Scrub Ninja", "Barrel Blade",
      "Bug Sponge Blue/Yellow", "Applicator Pads (Round/Square)",
      "Green Polish Pad", "Mitt On Stick Wash Mitt", "Aprons",
      "Tire Applicator Pad", "Window Polishing Towels", "Window Cleaning Towels",
      "All Purpose Towels", "Dressing Towels", "Wax Towels",
      "Applicator Towels", "Drying Towels", "Royal Blue Towels",
    ],
  },
  {
    category: "Brushes",
    items: [
      "Analon (Pet Hair)", "Black Handle Brush", "Leather Brush",
      "Detail Brushes", "Drill Brush", "Blue Detail Brush",
      "Green Wheel Brushes", "Tooth Brush", "Carpet Brush", "Tire Brush",
    ],
  },
  {
    category: "Equipment",
    items: [
      "Fire Extinguisher", "Ozone Machine", "DA Buffer & Pad", "Extractor",
      "Pressure Washer Hose", "Pressure Washer Reel", "Vacuum Hose Reel (Cox)",
      "Air Hose Reel", "Pressure Washer Pump", "Generator", "Dressing Gun",
      "Air Compressor", "Water Tank",
    ],
  },
  {
    category: "Tools",
    items: [
      "Barrel Blade", "Clock", "Crevice Tool (Vacuum)", "Buffer Holder",
      "Foam Cannon", "Button System", "Grit Guard", "TDS Meter", "Knee Pad",
      "Phone Mount", "Jumper Cables", "Garden Hose", "O-Ring Pick",
      "Plastic Razors", "O-Ring Kit", "Tornador", "Pressure Washer Gun",
      "Tire Dressing Applicator", "Platform Ladder", "Drill (Dewalt)",
      "Extension Pole", "Extension Cord", "Air Hose", "0000 Steel Wool",
      "Towel Bins", "Air/Water Filter", "Vacuum Elbow", "Plumbing & Clamps",
      "Pliers", "Screwdriver", "Vacuum Bags", "Vacuum Tools",
    ],
  },
  {
    category: "Plastics & Containers",
    items: [
      "Gallon Bottles", "½ Gallon Bottles", "16 oz Bottles", "32 oz Bottles",
      "4 oz Bottles", "Triggers", "Spouts", "Lids",
    ],
  },
  {
    category: "Supplies & Safety",
    items: [
      "5 Gal Buckets", "First Aid Kit", "Gloves", "Personal Item Bags",
      "Trash Bags", "SM Ziplock", "O-Rings", "5 Gal Wash Bucket",
      "5 Gal Wheel Bucket",
    ],
  },
  {
    category: "Water System",
    items: ["Carbon Filter", "Sediment Filter", "55-60 Gal Water Tank"],
  },
];

function genId() {
  return `van_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " at " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
  );
}

export default function OpsVanChecklistScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();

  const [view, setView] = useState<"form" | "history" | "compare">("form");
  const [selectedDetailer, setSelectedDetailer] = useState("");
  const [showDetailerPicker, setShowDetailerPicker] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(
    Object.fromEntries(DEFAULT_VAN_SECTIONS.map((s) => [s.category, true]))
  );
  const [showAddModal, setShowAddModal] = useState(false);
  const [addCategory, setAddCategory] = useState("");
  const [addItemName, setAddItemName] = useState("");
  const [compareChecklistId, setCompareChecklistId] = useState<string | null>(null);
  const [compareChecklistId2, setCompareChecklistId2] = useState<string | null>(null);

  // Server queries
  const customItemsQuery = trpc.ops.getVanCustomItems.useQuery(undefined, { staleTime: 30000 });
  const customItems: any[] = customItemsQuery.data ?? [];

  // Load active detailers dynamically from the server
  const detailersQuery = trpc.employee.listDetailers.useQuery(undefined, { staleTime: 60000 });
  const DETAILERS: string[] = (detailersQuery.data ?? []).map((d: any) => d.fullName).filter(Boolean);

  const effectiveSections = useMemo(() => {
    const addedByCategory: Record<string, string[]> = {};
    const removedSet = new Set<string>();
    for (const ci of customItems) {
      const key = `${ci.category}::${ci.itemName}`;
      if (ci.action === "add") {
        if (!addedByCategory[ci.category]) addedByCategory[ci.category] = [];
        addedByCategory[ci.category].push(ci.itemName);
      } else {
        removedSet.add(key);
      }
    }
    const sections = DEFAULT_VAN_SECTIONS.map((s) => ({
      category: s.category,
      items: s.items.filter((i) => !removedSet.has(`${s.category}::${i}`)),
    }));
    for (const [cat, items] of Object.entries(addedByCategory)) {
      const existing = sections.find((s) => s.category === cat);
      if (existing) {
        for (const item of items) {
          if (!existing.items.includes(item)) existing.items.push(item);
        }
      } else {
        sections.push({ category: cat, items });
      }
    }
    return sections.filter((s) => s.items.length > 0);
  }, [customItems]);

  const buildInitialState = useCallback(() => {
    const state: Record<string, boolean> = {};
    for (const section of effectiveSections) {
      for (const item of section.items) {
        state[`${section.category}::${item}`] = true;
      }
    }
    return state;
  }, [effectiveSections]);

  const [itemState, setItemState] = useState<Record<string, boolean>>(() => {
    const state: Record<string, boolean> = {};
    for (const section of DEFAULT_VAN_SECTIONS) {
      for (const item of section.items) {
        state[`${section.category}::${item}`] = true;
      }
    }
    return state;
  });

  const syncedItemState = useMemo(() => {
    const next = { ...itemState };
    for (const section of effectiveSections) {
      for (const item of section.items) {
        const key = `${section.category}::${item}`;
        if (!(key in next)) next[key] = true;
      }
    }
    return next;
  }, [effectiveSections, itemState]);

  const submitMutation = trpc.ops.submitVanChecklist.useMutation();
  const manageItemMutation = trpc.ops.manageVanChecklistItem.useMutation({
    onSuccess: () => customItemsQuery.refetch(),
  });

  const historyQuery = trpc.ops.listVanChecklistsByDetailer.useQuery(
    { detailerId: selectedDetailer.toLowerCase().replace(/\s+/g, "_") },
    { enabled: !!selectedDetailer && view === "history", staleTime: 30000 }
  );
  const history: any[] = historyQuery.data ?? [];

  const compareQuery1 = trpc.ops.getVanChecklistItems.useQuery(
    { checklistId: compareChecklistId! },
    { enabled: !!compareChecklistId }
  );
  const compareQuery2 = trpc.ops.getVanChecklistItems.useQuery(
    { checklistId: compareChecklistId2! },
    { enabled: !!compareChecklistId2 }
  );

  const totalItems = Object.keys(syncedItemState).length;
  const missingCount = Object.values(syncedItemState).filter((v) => !v).length;
  const allPresent = missingCount === 0;

  const toggleItem = (key: string) => setItemState((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleSection = (cat: string) =>
    setExpandedSections((prev) => ({ ...prev, [cat]: !prev[cat] }));

  const handleSubmit = async () => {
    if (!selectedDetailer) {
      Alert.alert("Missing Info", "Please select a team member.");
      return;
    }
    const checklistId = genId();
    const items = effectiveSections.flatMap((section) =>
      section.items.map((item) => ({
        itemId: `${checklistId}_${section.category}_${item}`.replace(/\s+/g, "_").slice(0, 80),
        category: section.category,
        itemName: item,
        present: syncedItemState[`${section.category}::${item}`] ?? true,
      }))
    );
    try {
      await submitMutation.mutateAsync({
        checklistId,
        opsManagerId: employee?.employeeId ?? "unknown",
        opsManagerName: employee?.fullName ?? undefined,
        detailerId: selectedDetailer.toLowerCase().replace(/\s+/g, "_"),
        detailerName: selectedDetailer,
        submittedAt: new Date().toISOString(),
        allItemsPresent: allPresent,
        notes: notes.trim() || undefined,
        items,
      });
      setSubmitted(true);
    } catch {
      Alert.alert("Error", "Failed to submit checklist. Please try again.");
    }
  };

  const handleNewChecklist = () => {
    setSelectedDetailer("");
    setNotes("");
    setItemState(buildInitialState());
    setSubmitted(false);
    setView("form");
  };

  const handleAddItem = async () => {
    if (!addItemName.trim() || !addCategory) return;
    await manageItemMutation.mutateAsync({
      category: addCategory,
      itemName: addItemName.trim(),
      action: "add",
    });
    setAddItemName("");
    setShowAddModal(false);
  };

  const handleRemoveItem = (category: string, itemName: string) => {
    Alert.alert(
      "Remove Item",
      `Remove "${itemName}" from the master checklist?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            manageItemMutation.mutateAsync({ category, itemName, action: "remove" }),
        },
      ]
    );
  };

  // ── Submitted screen ────────────────────────────────────────────────────────
  if (submitted) {
    const missingItems = effectiveSections.flatMap((s) =>
      s.items
        .filter((i) => !syncedItemState[`${s.category}::${i}`])
        .map((i) => ({ cat: s.category, item: i }))
    );
    return (
      <ScreenContainer>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <View
            style={[
              styles.successCard,
              { backgroundColor: allPresent ? "#F0FDF4" : "#FEF2F2" },
            ]}
          >
            <Text style={styles.successIcon}>{allPresent ? "✅" : "⚠️"}</Text>
            <Text
              style={[
                styles.successTitle,
                { color: allPresent ? "#16A34A" : "#DC2626" },
              ]}
            >
              {allPresent
                ? "Van Fully Stocked"
                : `${missingCount} Item${missingCount !== 1 ? "s" : ""} Missing`}
            </Text>
            <Text style={styles.successSub}>Team Member: {selectedDetailer}</Text>
            <Text style={styles.successSub}>
              Checked: {formatDateTime(new Date().toISOString())}
            </Text>
            {missingItems.length > 0 && (
              <View style={styles.missingList}>
                <Text style={styles.missingTitle}>Missing Items:</Text>
                {missingItems.map(({ cat, item }) => (
                  <Text key={`${cat}::${item}`} style={styles.missingItem}>
                    • {item} ({cat})
                  </Text>
                ))}
              </View>
            )}
          </View>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: "#0a7ea4" }]}
            onPress={handleNewChecklist}
          >
            <Text style={styles.primaryBtnText}>Start New Checklist</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              {
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                marginTop: 4,
              },
            ]}
            onPress={() => {
              setView("history");
              setSubmitted(false);
            }}
          >
            <Text style={[styles.primaryBtnText, { color: colors.foreground }]}>
              View History for {selectedDetailer}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </ScreenContainer>
    );
  }

  // ── History view ────────────────────────────────────────────────────────────
  if (view === "history") {
    return (
      <ScreenContainer>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginBottom: 16,
              gap: 10,
            }}
          >
            <TouchableOpacity onPress={() => setView("form")} style={{ padding: 4 }}>
              <Text style={{ fontSize: 22, color: colors.primary }}>←</Text>
            </TouchableOpacity>
            <Text
              style={{
                fontSize: 20,
                fontWeight: "800",
                color: colors.foreground,
                flex: 1,
              }}
            >
              {selectedDetailer} — Check History
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.dropdownBtn,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            onPress={() => setShowDetailerPicker(true)}
          >
            <Text
              style={{
                color: selectedDetailer ? colors.foreground : colors.muted,
                fontSize: 14,
              }}
            >
              {selectedDetailer || "Select Team Member"}
            </Text>
            <Text style={{ color: colors.muted }}>▾</Text>
          </TouchableOpacity>

          {historyQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : history.length === 0 ? (
            <Text
              style={{ color: colors.muted, textAlign: "center", marginTop: 40 }}
            >
              No checks recorded yet for {selectedDetailer}.
            </Text>
          ) : (
            <>
              {history.length >= 2 && (
                <View
                  style={[
                    styles.compareHint,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    Tap two checks to compare them side by side.
                  </Text>
                </View>
              )}
              {history.map((c: any) => {
                const isSelected1 = compareChecklistId === c.checklistId;
                const isSelected2 = compareChecklistId2 === c.checklistId;
                const isSelected = isSelected1 || isSelected2;
                return (
                  <TouchableOpacity
                    key={c.checklistId}
                    style={[
                      styles.historyCard,
                      {
                        backgroundColor: isSelected
                          ? isSelected1
                            ? "#EFF6FF"
                            : "#F0FDF4"
                          : colors.surface,
                        borderColor: isSelected
                          ? isSelected1
                            ? "#3B82F6"
                            : "#22C55E"
                          : colors.border,
                      },
                    ]}
                    onPress={() => {
                      if (!compareChecklistId) {
                        setCompareChecklistId(c.checklistId);
                      } else if (compareChecklistId === c.checklistId) {
                        setCompareChecklistId(null);
                        setCompareChecklistId2(null);
                      } else if (!compareChecklistId2) {
                        setCompareChecklistId2(c.checklistId);
                      } else {
                        setCompareChecklistId(c.checklistId);
                        setCompareChecklistId2(null);
                      }
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: colors.foreground,
                          }}
                        >
                          {formatDateTime(c.submittedAt)}
                        </Text>
                        <Text
                          style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}
                        >
                          Checked by: {c.opsManagerName || "Unknown"}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.statusBadge,
                          {
                            backgroundColor: c.allItemsPresent
                              ? "#DCFCE7"
                              : "#FEE2E2",
                          },
                        ]}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: "700",
                            color: c.allItemsPresent ? "#16A34A" : "#DC2626",
                          }}
                        >
                          {c.allItemsPresent ? "✅ Full" : "⚠️ Missing"}
                        </Text>
                      </View>
                    </View>
                    {isSelected && (
                      <Text
                        style={{
                          fontSize: 11,
                          color: isSelected1 ? "#3B82F6" : "#22C55E",
                          marginTop: 4,
                        }}
                      >
                        {isSelected1 ? "Selected as Check 1" : "Selected as Check 2"}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
              {compareChecklistId && compareChecklistId2 && (
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: "#0a7ea4", marginTop: 8 }]}
                  onPress={() => setView("compare")}
                >
                  <Text style={styles.primaryBtnText}>Compare Selected Checks →</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>

        <Modal visible={showDetailerPicker} transparent animationType="slide">
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowDetailerPicker(false)}
          >
            <View style={[styles.pickerSheet, { backgroundColor: colors.surface }]}>
              <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
                Select Team Member
              </Text>
              {DETAILERS.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.pickerItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setSelectedDetailer(d);
                    setShowDetailerPicker(false);
                    setCompareChecklistId(null);
                    setCompareChecklistId2(null);
                  }}
                >
                  <Text
                    style={{
                      fontSize: 16,
                      color:
                        d === selectedDetailer ? colors.primary : colors.foreground,
                      fontWeight: d === selectedDetailer ? "700" : "400",
                    }}
                  >
                    {d}
                  </Text>
                  {d === selectedDetailer && (
                    <Text style={{ color: colors.primary }}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>
      </ScreenContainer>
    );
  }

  // ── Compare view ────────────────────────────────────────────────────────────
  if (view === "compare") {
    const items1: any[] = compareQuery1.data ?? [];
    const items2: any[] = compareQuery2.data ?? [];
    const check1 = history.find((c: any) => c.checklistId === compareChecklistId);
    const check2 = history.find((c: any) => c.checklistId === compareChecklistId2);

    const allItemKeys = new Set([
      ...items1.map((i: any) => `${i.category}::${i.itemName}`),
      ...items2.map((i: any) => `${i.category}::${i.itemName}`),
    ]);

    const compareCategories: Record<
      string,
      { itemName: string; present1: boolean | null; present2: boolean | null }[]
    > = {};
    for (const key of allItemKeys) {
      const colonIdx = key.indexOf("::");
      const cat = key.slice(0, colonIdx);
      const itemName = key.slice(colonIdx + 2);
      const i1 = items1.find(
        (i: any) => i.category === cat && i.itemName === itemName
      );
      const i2 = items2.find(
        (i: any) => i.category === cat && i.itemName === itemName
      );
      if (!compareCategories[cat]) compareCategories[cat] = [];
      compareCategories[cat].push({
        itemName,
        present1: i1 ? !!i1.present : null,
        present2: i2 ? !!i2.present : null,
      });
    }

    const changedCount = Object.values(compareCategories)
      .flat()
      .filter(
        (r) =>
          r.present1 !== null && r.present2 !== null && r.present1 !== r.present2
      ).length;

    return (
      <ScreenContainer>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginBottom: 12,
              gap: 10,
            }}
          >
            <TouchableOpacity
              onPress={() => setView("history")}
              style={{ padding: 4 }}
            >
              <Text style={{ fontSize: 22, color: colors.primary }}>←</Text>
            </TouchableOpacity>
            <Text
              style={{
                fontSize: 18,
                fontWeight: "800",
                color: colors.foreground,
                flex: 1,
              }}
            >
              Comparison — {selectedDetailer}
            </Text>
          </View>

          <View
            style={[
              styles.compareHeader,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: "#3B82F6" }}>
                CHECK 1
              </Text>
              <Text style={{ fontSize: 12, color: colors.foreground }}>
                {check1 ? formatDateTime(check1.submittedAt) : "—"}
              </Text>
            </View>
            <View
              style={{
                width: 1,
                backgroundColor: colors.border,
                marginHorizontal: 8,
              }}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: "#22C55E" }}>
                CHECK 2
              </Text>
              <Text style={{ fontSize: 12, color: colors.foreground }}>
                {check2 ? formatDateTime(check2.submittedAt) : "—"}
              </Text>
            </View>
          </View>

          {changedCount > 0 && (
            <View style={[styles.changedBanner, { backgroundColor: "#FEF3C7" }]}>
              <Text
                style={{ color: "#92400E", fontSize: 13, fontWeight: "700" }}
              >
                ⚠️ {changedCount} item{changedCount !== 1 ? "s" : ""} changed
                between checks
              </Text>
            </View>
          )}
          {changedCount === 0 && items1.length > 0 && items2.length > 0 && (
            <View style={[styles.changedBanner, { backgroundColor: "#F0FDF4" }]}>
              <Text
                style={{ color: "#16A34A", fontSize: 13, fontWeight: "700" }}
              >
                ✅ No changes between checks
              </Text>
            </View>
          )}

          {compareQuery1.isLoading || compareQuery2.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            Object.entries(compareCategories).map(([cat, rows]) => (
              <View key={cat} style={{ marginBottom: 12 }}>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "700",
                    color: colors.muted,
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {cat}
                </Text>
                {rows.map((row) => {
                  const changed =
                    row.present1 !== null &&
                    row.present2 !== null &&
                    row.present1 !== row.present2;
                  return (
                    <View
                      key={row.itemName}
                      style={[
                        styles.compareRow,
                        {
                          backgroundColor: changed ? "#FFFBEB" : colors.surface,
                          borderColor: changed ? "#FCD34D" : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={{ flex: 1, fontSize: 13, color: colors.foreground }}
                      >
                        {row.itemName}
                      </Text>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <View
                          style={[
                            styles.compareCell,
                            {
                              backgroundColor:
                                row.present1 === false ? "#FEE2E2" : "#DCFCE7",
                            },
                          ]}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              color:
                                row.present1 === false ? "#DC2626" : "#16A34A",
                              fontWeight: "700",
                            }}
                          >
                            {row.present1 === null
                              ? "—"
                              : row.present1
                              ? "✓"
                              : "✗"}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.compareCell,
                            {
                              backgroundColor:
                                row.present2 === false ? "#FEE2E2" : "#DCFCE7",
                            },
                          ]}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              color:
                                row.present2 === false ? "#DC2626" : "#16A34A",
                              fontWeight: "700",
                            }}
                          >
                            {row.present2 === null
                              ? "—"
                              : row.present2
                              ? "✓"
                              : "✗"}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>
      </ScreenContainer>
    );
  }

  // ── Main form ───────────────────────────────────────────────────────────────
  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={[styles.header, { backgroundColor: "#0a0a0a" }]}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <View>
              <Text style={styles.headerTitle}>Van Checklist</Text>
              <Text style={styles.headerSub}>
                {totalItems} items · tap to mark missing
              </Text>
            </View>
            {selectedDetailer ? (
              <TouchableOpacity
                style={[styles.historyBtn, { borderColor: "#334155" }]}
                onPress={() => setView("history")}
              >
                <Text style={{ color: "#9BA1A6", fontSize: 12 }}>History</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={{ padding: 16 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Team Member
          </Text>
          <TouchableOpacity
            style={[
              styles.dropdownBtn,
              {
                backgroundColor: colors.surface,
                borderColor: selectedDetailer ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setShowDetailerPicker(true)}
          >
            <Text
              style={{
                color: selectedDetailer ? colors.foreground : colors.muted,
                fontSize: 14,
              }}
            >
              {selectedDetailer || "Select Team Member *"}
            </Text>
            <Text style={{ color: colors.muted }}>▾</Text>
          </TouchableOpacity>

          <View
            style={[
              styles.statusBar,
              { backgroundColor: allPresent ? "#F0FDF4" : "#FEF2F2" },
            ]}
          >
            <Text
              style={[
                styles.statusBarText,
                { color: allPresent ? "#16A34A" : "#DC2626" },
              ]}
            >
              {allPresent
                ? `✅ All ${totalItems} items present`
                : `⚠️ ${missingCount} item${missingCount !== 1 ? "s" : ""} missing`}
            </Text>
          </View>

          {effectiveSections.map((section) => {
            const sectionMissing = section.items.filter(
              (i) => !syncedItemState[`${section.category}::${i}`]
            ).length;
            const expanded = expandedSections[section.category] ?? true;

            return (
              <View key={section.category} style={{ marginBottom: 12 }}>
                <TouchableOpacity
                  style={[
                    styles.sectionHeader,
                    {
                      backgroundColor:
                        sectionMissing > 0 ? "#FEF2F2" : colors.surface,
                      borderColor:
                        sectionMissing > 0 ? "#FECACA" : colors.border,
                    },
                  ]}
                  onPress={() => toggleSection(section.category)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.sectionHeaderText,
                      {
                        color:
                          sectionMissing > 0 ? "#DC2626" : colors.foreground,
                      },
                    ]}
                  >
                    {expanded ? "▾" : "▸"} {section.category}
                  </Text>
                  <View
                    style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                  >
                    <Text
                      style={[
                        styles.sectionCount,
                        {
                          color:
                            sectionMissing > 0 ? "#DC2626" : colors.muted,
                        },
                      ]}
                    >
                      {sectionMissing > 0
                        ? `${sectionMissing} missing`
                        : `${section.items.length} items`}
                    </Text>
                    <TouchableOpacity
                      onPress={() => {
                        setAddCategory(section.category);
                        setShowAddModal(true);
                      }}
                      style={{ padding: 4 }}
                    >
                      <Text
                        style={{
                          color: colors.primary,
                          fontSize: 18,
                          fontWeight: "700",
                        }}
                      >
                        +
                      </Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>

                {expanded &&
                  section.items.map((item) => {
                    const key = `${section.category}::${item}`;
                    const present = syncedItemState[key] ?? true;
                    const isCustomAdded = customItems.some(
                      (ci) =>
                        ci.category === section.category &&
                        ci.itemName === item &&
                        ci.action === "add"
                    );
                    return (
                      <View
                        key={key}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          marginLeft: 8,
                          marginBottom: 4,
                        }}
                      >
                        <TouchableOpacity
                          style={[
                            styles.itemRow,
                            {
                              flex: 1,
                              backgroundColor: present
                                ? colors.surface
                                : "#FEF2F2",
                              borderColor: present ? colors.border : "#FECACA",
                            },
                          ]}
                          onPress={() => toggleItem(key)}
                          activeOpacity={0.7}
                        >
                          <View
                            style={[
                              styles.itemCheck,
                              {
                                backgroundColor: present
                                  ? "#22C55E"
                                  : "#EF4444",
                              },
                            ]}
                          >
                            <Text style={styles.itemCheckText}>
                              {present ? "✓" : "✗"}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.itemName,
                              {
                                color: present ? colors.foreground : "#DC2626",
                              },
                            ]}
                          >
                            {item}
                          </Text>
                          {isCustomAdded && (
                            <Text
                              style={{
                                fontSize: 10,
                                color: colors.primary,
                                marginLeft: 4,
                              }}
                            >
                              +
                            </Text>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() =>
                            handleRemoveItem(section.category, item)
                          }
                          style={{ padding: 8, marginLeft: 4 }}
                        >
                          <Text style={{ color: "#EF4444", fontSize: 18 }}>
                            −
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
              </View>
            );
          })}

          <Text
            style={[
              styles.sectionTitle,
              { color: colors.foreground, marginTop: 8 },
            ]}
          >
            Notes
          </Text>
          <TextInput
            style={[
              styles.input,
              styles.multilineInput,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                color: colors.foreground,
              },
            ]}
            placeholder="Additional notes (optional)"
            placeholderTextColor={colors.muted}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
          />

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              {
                backgroundColor: "#0a7ea4",
                opacity: submitMutation.isPending ? 0.6 : 1,
              },
            ]}
            onPress={handleSubmit}
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Submit Checklist</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Detailer picker */}
      <Modal visible={showDetailerPicker} transparent animationType="slide">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowDetailerPicker(false)}
        >
          <View style={[styles.pickerSheet, { backgroundColor: colors.surface }]}>
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
              Select Team Member
            </Text>
            {DETAILERS.map((d) => (
              <TouchableOpacity
                key={d}
                style={[styles.pickerItem, { borderBottomColor: colors.border }]}
                onPress={() => {
                  setSelectedDetailer(d);
                  setShowDetailerPicker(false);
                }}
              >
                <Text
                  style={{
                    fontSize: 16,
                    color:
                      d === selectedDetailer ? colors.primary : colors.foreground,
                    fontWeight: d === selectedDetailer ? "700" : "400",
                  }}
                >
                  {d}
                </Text>
                {d === selectedDetailer && (
                  <Text style={{ color: colors.primary }}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Add item modal */}
      <Modal visible={showAddModal} transparent animationType="slide">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowAddModal(false)}
        >
          <View
            style={[styles.pickerSheet, { backgroundColor: colors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
              Add Item to {addCategory}
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.foreground,
                  marginBottom: 12,
                },
              ]}
              placeholder="Item name"
              placeholderTextColor={colors.muted}
              value={addItemName}
              onChangeText={setAddItemName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleAddItem}
            />
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: "#0a7ea4",
                  opacity: manageItemMutation.isPending ? 0.6 : 1,
                },
              ]}
              onPress={handleAddItem}
              disabled={manageItemMutation.isPending}
            >
              {manageItemMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Add Item</Text>
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { padding: 20, paddingTop: 16 },
  headerTitle: { fontSize: 22, fontWeight: "700", color: "#fff" },
  headerSub: { fontSize: 13, color: "#9BA1A6", marginTop: 2 },
  historyBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  sectionTitle: { fontSize: 15, fontWeight: "700", marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, marginBottom: 10 },
  multilineInput: { minHeight: 80, textAlignVertical: "top" },
  dropdownBtn: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  statusBar: { borderRadius: 10, padding: 12, alignItems: "center", marginBottom: 16 },
  statusBarText: { fontSize: 14, fontWeight: "700" },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 4,
  },
  sectionHeaderText: { fontSize: 14, fontWeight: "700" },
  sectionCount: { fontSize: 12 },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    paddingLeft: 12,
    borderWidth: 1,
    borderRadius: 8,
    gap: 10,
  },
  itemCheck: {
    width: 24,
    height: 24,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  itemCheckText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  itemName: { flex: 1, fontSize: 13 },
  primaryBtn: { borderRadius: 12, padding: 16, alignItems: "center", marginBottom: 8 },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  successCard: { borderRadius: 16, padding: 24, alignItems: "center", marginBottom: 20 },
  successIcon: { fontSize: 40, marginBottom: 8 },
  successTitle: { fontSize: 20, fontWeight: "800", marginBottom: 4 },
  successSub: { fontSize: 13, color: "#687076", marginTop: 2 },
  missingList: {
    marginTop: 12,
    width: "100%",
    backgroundColor: "#FEE2E2",
    borderRadius: 10,
    padding: 12,
  },
  missingTitle: { fontSize: 13, fontWeight: "700", color: "#DC2626", marginBottom: 6 },
  missingItem: { fontSize: 12, color: "#DC2626", marginBottom: 2 },
  historyCard: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 8 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  compareHint: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 10 },
  compareHeader: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  changedBanner: { borderRadius: 10, padding: 10, marginBottom: 10 },
  compareRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 4,
  },
  compareCell: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  pickerTitle: { fontSize: 17, fontWeight: "700", marginBottom: 16 },
  pickerItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
