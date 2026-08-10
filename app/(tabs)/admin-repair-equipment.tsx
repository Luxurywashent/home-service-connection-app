import { useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, Modal, ScrollView, KeyboardAvoidingView, Platform,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

// ─── Types ────────────────────────────────────────────────────────────────────
interface EquipmentItem {
  equipmentId: string;
  name: string;
  category?: string | null;
  subIssues?: string[];
  isActive?: boolean;
  sortOrder?: number;
}

// ─── Sub-Issue Editor ─────────────────────────────────────────────────────────
function SubIssueEditor({
  subIssues,
  onChange,
  colors,
}: {
  subIssues: string[];
  onChange: (v: string[]) => void;
  colors: any;
}) {
  const [newIssue, setNewIssue] = useState("");
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Sub-Issues (optional)
      </Text>
      {subIssues.map((issue, idx) => (
        <View key={idx} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.foreground, fontSize: 14 }}>{issue}</Text>
          </View>
          <TouchableOpacity
            onPress={() => onChange(subIssues.filter((_, i) => i !== idx))}
            style={{ backgroundColor: colors.error + "20", borderRadius: 8, padding: 8 }}
          >
            <Text style={{ color: colors.error, fontSize: 14, fontWeight: "700" }}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          value={newIssue}
          onChangeText={setNewIssue}
          placeholder="Add sub-issue..."
          placeholderTextColor={colors.muted}
          style={{
            flex: 1, backgroundColor: colors.surface, borderRadius: 8,
            paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1,
            borderColor: colors.border, color: colors.foreground, fontSize: 14,
          }}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (newIssue.trim()) { onChange([...subIssues, newIssue.trim()]); setNewIssue(""); }
          }}
        />
        <TouchableOpacity
          onPress={() => { if (newIssue.trim()) { onChange([...subIssues, newIssue.trim()]); setNewIssue(""); } }}
          style={{ backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 14, justifyContent: "center" }}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Add / Edit Modal ─────────────────────────────────────────────────────────
function EquipmentModal({
  visible,
  onClose,
  colors,
  editing,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  colors: any;
  editing: EquipmentItem | null;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [subIssues, setSubIssues] = useState<string[]>(editing?.subIssues ?? []);

  // Reset when editing changes
  const resetForm = (item: EquipmentItem | null) => {
    setName(item?.name ?? "");
    setCategory(item?.category ?? "");
    setSubIssues(item?.subIssues ?? []);
  };

  const addMutation = trpc.fleet.addRepairEquipment.useMutation({
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const updateMutation = trpc.fleet.updateRepairEquipment.useMutation({
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const handleSave = () => {
    if (!name.trim()) { Alert.alert("Name required"); return; }
    if (editing) {
      updateMutation.mutate({ equipmentId: editing.equipmentId, name: name.trim(), category: category.trim() || undefined, subIssues });
    } else {
      addMutation.mutate({ name: name.trim(), category: category.trim() || undefined, subIssues });
    }
  };

  const isPending = addMutation.isPending || updateMutation.isPending;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, maxHeight: "85%" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>
                {editing ? "Edit Equipment" : "Add Equipment"}
              </Text>
              <TouchableOpacity onPress={onClose}>
                <Text style={{ fontSize: 20, color: colors.muted }}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
              <View style={{ gap: 16 }}>
                {/* Name */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Equipment Name *</Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="e.g. Pressure Washer"
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14,
                      paddingVertical: 12, borderWidth: 1, borderColor: colors.border,
                      color: colors.foreground, fontSize: 15,
                    }}
                  />
                </View>

                {/* Category */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Category (optional)</Text>
                  <TextInput
                    value={category}
                    onChangeText={setCategory}
                    placeholder="e.g. Cleaning Equipment"
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14,
                      paddingVertical: 12, borderWidth: 1, borderColor: colors.border,
                      color: colors.foreground, fontSize: 15,
                    }}
                  />
                </View>

                {/* Sub-Issues */}
                <SubIssueEditor subIssues={subIssues} onChange={setSubIssues} colors={colors} />
              </View>
            </ScrollView>

            <TouchableOpacity
              onPress={handleSave}
              disabled={isPending}
              style={{
                marginTop: 20, backgroundColor: colors.primary, borderRadius: 12,
                paddingVertical: 14, alignItems: "center",
                opacity: isPending ? 0.6 : 1,
              }}
            >
              {isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
                  {editing ? "Save Changes" : "Add Equipment"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminRepairEquipmentScreen() {
  const colors = useColors();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<EquipmentItem | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const { data: equipment = [], refetch, isLoading } = trpc.fleet.listRepairEquipment.useQuery();
  const deleteMutation = trpc.fleet.deleteRepairEquipment.useMutation({
    onSuccess: () => refetch(),
    onError: (e) => Alert.alert("Error", e.message),
  });
  const updateMutation = trpc.fleet.updateRepairEquipment.useMutation({
    onSuccess: () => refetch(),
    onError: (e) => Alert.alert("Error", e.message),
  });

  const allEquipment = equipment as EquipmentItem[];
  const displayed = showInactive ? allEquipment : allEquipment.filter((e) => e.isActive !== false);

  const handleDeactivate = (item: EquipmentItem) => {
    Alert.alert(
      "Deactivate Equipment",
      `Deactivate "${item.name}"? It will no longer appear in repair requests.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Deactivate", style: "destructive",
          onPress: () => deleteMutation.mutate({ equipmentId: item.equipmentId }),
        },
      ]
    );
  };

  const handleReactivate = (item: EquipmentItem) => {
    updateMutation.mutate({ equipmentId: item.equipmentId, isActive: true });
  };

  return (
    <ScreenContainer edges={["left", "right"]}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View>
          <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>🔧 Equipment List</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>
            {displayed.length} item{displayed.length !== 1 ? "s" : ""}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => { setEditing(null); setShowModal(true); }}
          style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 6 }}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* Show inactive toggle */}
      <TouchableOpacity
        onPress={() => setShowInactive(!showInactive)}
        style={{ marginHorizontal: 16, marginBottom: 12, flexDirection: "row", alignItems: "center", gap: 8 }}
      >
        <View style={{
          width: 20, height: 20, borderRadius: 4, borderWidth: 1.5,
          borderColor: showInactive ? colors.primary : colors.border,
          backgroundColor: showInactive ? colors.primary : "transparent",
          alignItems: "center", justifyContent: "center",
        }}>
          {showInactive && <Text style={{ color: "#fff", fontSize: 12, fontWeight: "800" }}>✓</Text>}
        </View>
        <Text style={{ color: colors.muted, fontSize: 13 }}>Show deactivated items</Text>
      </TouchableOpacity>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : displayed.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Text style={{ fontSize: 40 }}>🔧</Text>
          <Text style={{ color: colors.muted, fontSize: 15 }}>No equipment items yet</Text>
          <TouchableOpacity
            onPress={() => { setEditing(null); setShowModal(true); }}
            style={{ marginTop: 8, backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>Add First Item</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={displayed}
          keyExtractor={(item) => item.equipmentId}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 10 }}
          renderItem={({ item }) => (
            <View style={{
              backgroundColor: colors.surface, borderRadius: 14, padding: 14,
              borderWidth: 1, borderColor: item.isActive === false ? colors.border + "60" : colors.border,
              opacity: item.isActive === false ? 0.6 : 1,
            }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{item.name}</Text>
                    {item.isActive === false && (
                      <View style={{ backgroundColor: colors.error + "20", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: colors.error, fontSize: 10, fontWeight: "700" }}>INACTIVE</Text>
                      </View>
                    )}
                  </View>
                  {item.category ? (
                    <Text style={{ fontSize: 12, color: colors.muted }}>{item.category}</Text>
                  ) : null}
                  {item.subIssues && item.subIssues.length > 0 && (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                      {item.subIssues.map((si, idx) => (
                        <View key={idx} style={{ backgroundColor: colors.primary + "15", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ color: colors.primary, fontSize: 11, fontWeight: "600" }}>{si}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                <View style={{ flexDirection: "row", gap: 8, marginLeft: 8 }}>
                  <TouchableOpacity
                    onPress={() => { setEditing(item); setShowModal(true); }}
                    style={{ backgroundColor: colors.primary + "20", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                  >
                    <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>Edit</Text>
                  </TouchableOpacity>
                  {item.isActive === false ? (
                    <TouchableOpacity
                      onPress={() => handleReactivate(item)}
                      style={{ backgroundColor: colors.success + "20", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                    >
                      <Text style={{ color: colors.success, fontSize: 12, fontWeight: "700" }}>Restore</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={() => handleDeactivate(item)}
                      style={{ backgroundColor: colors.error + "15", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                    >
                      <Text style={{ color: colors.error, fontSize: 12, fontWeight: "700" }}>Off</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          )}
        />
      )}

      <EquipmentModal
        visible={showModal}
        onClose={() => { setShowModal(false); setEditing(null); }}
        colors={colors}
        editing={editing}
        onSuccess={() => refetch()}
      />
    </ScreenContainer>
  );
}
