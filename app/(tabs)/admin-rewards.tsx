import { useState } from "react";
import {
  Text, View, ScrollView, TouchableOpacity, TextInput,
  Modal, ActivityIndicator, Alert, StyleSheet, Switch,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";

type Tab = "tiers" | "redemptions";

interface TierForm {
  name: string;
  description: string;
  pointCost: string;
  sortOrder: string;
  isActive: boolean;
}

const EMPTY_FORM: TierForm = { name: "", description: "", pointCost: "", sortOrder: "0", isActive: true };

export default function AdminRewardsScreen() {
  const colors = useColors();
  const [activeTab, setActiveTab] = useState<Tab>("tiers");
  const [showForm, setShowForm] = useState(false);
  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [form, setForm] = useState<TierForm>(EMPTY_FORM);

  const utils = trpc.useUtils();
  const { data: tiers = [], isLoading: tiersLoading } = trpc.referral.getAllRewardTiers.useQuery();
  const { data: pending = [], isLoading: pendingLoading } = trpc.referral.getPendingRedemptions.useQuery();

  const createTier = trpc.referral.createRewardTier.useMutation({
    onSuccess: () => { utils.referral.getAllRewardTiers.invalidate(); setShowForm(false); setForm(EMPTY_FORM); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const updateTier = trpc.referral.updateRewardTier.useMutation({
    onSuccess: () => { utils.referral.getAllRewardTiers.invalidate(); setShowForm(false); setEditingTierId(null); setForm(EMPTY_FORM); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const deleteTier = trpc.referral.deleteRewardTier.useMutation({
    onSuccess: () => utils.referral.getAllRewardTiers.invalidate(),
    onError: (e) => Alert.alert("Error", e.message),
  });
  const applyRedemption = trpc.referral.applyRedemption.useMutation({
    onSuccess: () => utils.referral.getPendingRedemptions.invalidate(),
    onError: (e) => Alert.alert("Error", e.message),
  });

  function openCreate() {
    setEditingTierId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function openEdit(tier: typeof tiers[0]) {
    setEditingTierId(tier.tierId);
    setForm({
      name: tier.name,
      description: tier.description ?? "",
      pointCost: String(tier.pointCost),
      sortOrder: String(tier.sortOrder),
      isActive: tier.isActive === "yes",
    });
    setShowForm(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleSave() {
    const cost = parseInt(form.pointCost, 10);
    if (!form.name.trim()) return Alert.alert("Validation", "Reward name is required.");
    if (isNaN(cost) || cost <= 0) return Alert.alert("Validation", "Point cost must be a positive number.");
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      pointCost: cost,
      sortOrder: parseInt(form.sortOrder, 10) || 0,
    };
    if (editingTierId) {
      updateTier.mutate({ tierId: editingTierId, ...payload, isActive: form.isActive ? "yes" : "no" });
    } else {
      createTier.mutate(payload);
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function handleDelete(tierId: string, name: string) {
    Alert.alert("Delete Reward", `Delete "${name}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteTier.mutate({ tierId }) },
    ]);
  }

  function handleApply(redemptionId: string, tierName: string, customerName: string) {
    Alert.alert("Mark as Applied", `Confirm you've applied "${tierName}" for ${customerName}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm", onPress: () => {
          applyRedemption.mutate({ redemptionId });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      },
    ]);
  }

  const s = styles(colors);

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Rewards Program</Text>
        {activeTab === "tiers" && (
          <TouchableOpacity style={s.addBtn} onPress={openCreate}>
            <Text style={s.addBtnText}>+ Add Reward</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      <View style={s.tabBar}>
        {(["tiers", "redemptions"] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[s.tab, activeTab === t && s.tabActive]}
            onPress={() => { setActiveTab(t); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <Text style={[s.tabText, activeTab === t && s.tabTextActive]}>
              {t === "tiers" ? "Reward Tiers" : `Pending (${pending.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {activeTab === "tiers" ? (
        tiersLoading ? (
          <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        ) : tiers.length === 0 ? (
          <View style={s.center}>
            <Text style={s.emptyIcon}>🎁</Text>
            <Text style={s.emptyTitle}>No Reward Tiers Yet</Text>
            <Text style={s.emptyText}>Tap "+ Add Reward" to create your first redeemable reward.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} style={{ flex: 1 }}>
            {tiers.map((tier) => (
              <View key={tier.tierId} style={s.card}>
                <View style={s.cardRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={s.cardName}>{tier.name}</Text>
                      {tier.isActive === "no" && (
                        <View style={s.inactiveBadge}><Text style={s.inactiveBadgeText}>Inactive</Text></View>
                      )}
                    </View>
                    {tier.description ? <Text style={s.cardDesc}>{tier.description}</Text> : null}
                    <Text style={s.cardCost}>🏆 {tier.pointCost.toLocaleString()} pts</Text>
                  </View>
                  <View style={{ gap: 8 }}>
                    <TouchableOpacity style={s.editBtn} onPress={() => openEdit(tier)}>
                      <Text style={s.editBtnText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.deleteBtn} onPress={() => handleDelete(tier.tierId, tier.name)}>
                      <Text style={s.deleteBtnText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>
        )
      ) : (
        pendingLoading ? (
          <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        ) : pending.length === 0 ? (
          <View style={s.center}>
            <Text style={s.emptyIcon}>✅</Text>
            <Text style={s.emptyTitle}>No Pending Redemptions</Text>
            <Text style={s.emptyText}>When customers redeem points, they'll appear here for you to apply.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} style={{ flex: 1 }}>
            {pending.map((r) => (
              <View key={r.redemptionId} style={s.card}>
                <View style={s.cardRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardName}>{r.tierName}</Text>
                    <Text style={s.cardDesc}>Customer ID: {r.customerId.slice(0, 12)}...</Text>
                    <Text style={s.cardCost}>🏆 {r.pointsSpent.toLocaleString()} pts used</Text>
                    <Text style={s.cardDate}>{new Date(r.createdAt).toLocaleDateString()}</Text>
                  </View>
                  <TouchableOpacity
                    style={s.applyBtn}
                    onPress={() => handleApply(r.redemptionId, r.tierName, r.customerId.slice(0, 8))}
                  >
                    <Text style={s.applyBtnText}>Mark Applied</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        )
      )}

      {/* Create/Edit Modal */}
      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowForm(false)}>
        <View style={[s.modal, { backgroundColor: colors.background }]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{editingTierId ? "Edit Reward" : "New Reward Tier"}</Text>
            <TouchableOpacity onPress={() => setShowForm(false)}>
              <Text style={[s.cancelText, { color: colors.primary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
            <Text style={s.label}>Reward Name *</Text>
            <TextInput
              style={[s.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface }]}
              placeholder="e.g., Free Tire Shine"
              placeholderTextColor={colors.muted}
              value={form.name}
              onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
            />

            <Text style={s.label}>Description</Text>
            <TextInput
              style={[s.input, s.textArea, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface }]}
              placeholder="What the customer receives..."
              placeholderTextColor={colors.muted}
              value={form.description}
              onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
              multiline
              numberOfLines={3}
            />

            <Text style={s.label}>Point Cost *</Text>
            <TextInput
              style={[s.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface }]}
              placeholder="e.g., 500"
              placeholderTextColor={colors.muted}
              value={form.pointCost}
              onChangeText={(v) => setForm((f) => ({ ...f, pointCost: v.replace(/[^0-9]/g, '') }))}
              keyboardType="numeric"
            />

            <Text style={s.label}>Sort Order (lower = first)</Text>
            <TextInput
              style={[s.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface }]}
              placeholder="0"
              placeholderTextColor={colors.muted}
              value={form.sortOrder}
              onChangeText={(v) => setForm((f) => ({ ...f, sortOrder: v.replace(/[^0-9]/g, '') }))}
              keyboardType="numeric"
            />

            {editingTierId && (
              <View style={s.switchRow}>
                <Text style={[s.label, { marginBottom: 0 }]}>Active</Text>
                <Switch
                  value={form.isActive}
                  onValueChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                  trackColor={{ true: colors.primary }}
                />
              </View>
            )}

            <TouchableOpacity
              style={[s.saveBtn, { backgroundColor: colors.primary }]}
              onPress={handleSave}
              disabled={createTier.isPending || updateTier.isPending}
            >
              {(createTier.isPending || updateTier.isPending) ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.saveBtnText}>{editingTierId ? "Save Changes" : "Create Reward"}</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function styles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
    title: { fontSize: 22, fontWeight: "700", color: colors.foreground },
    addBtn: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
    addBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
    tabBar: { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 4 },
    tab: { flex: 1, height: 36, justifyContent: "center", alignItems: "center", borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabText: { fontSize: 13, fontWeight: "600", color: colors.muted },
    tabTextActive: { color: "#fff" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
    emptyIcon: { fontSize: 48, marginBottom: 12 },
    emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.foreground, marginBottom: 6 },
    emptyText: { fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 20 },
    card: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
    cardRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    cardName: { fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 2 },
    cardDesc: { fontSize: 13, color: colors.muted, marginBottom: 4, lineHeight: 18 },
    cardCost: { fontSize: 14, fontWeight: "600", color: colors.primary },
    cardDate: { fontSize: 12, color: colors.muted, marginTop: 2 },
    inactiveBadge: { backgroundColor: colors.error + "22", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
    inactiveBadgeText: { fontSize: 11, color: colors.error, fontWeight: "600" },
    editBtn: { backgroundColor: colors.primary + "22", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
    editBtnText: { color: colors.primary, fontWeight: "600", fontSize: 13 },
    deleteBtn: { backgroundColor: colors.error + "22", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
    deleteBtnText: { color: colors.error, fontWeight: "600", fontSize: 13 },
    applyBtn: { backgroundColor: colors.success + "22", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, justifyContent: "center" },
    applyBtnText: { color: colors.success, fontWeight: "600", fontSize: 13 },
    modal: { flex: 1 },
    modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
    modalTitle: { fontSize: 18, fontWeight: "700", color: colors.foreground },
    cancelText: { fontSize: 16, fontWeight: "500" },
    label: { fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6, marginTop: 16 },
    input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
    textArea: { height: 80, textAlignVertical: "top" },
    switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20, paddingVertical: 4 },
    saveBtn: { marginTop: 28, paddingVertical: 16, borderRadius: 14, alignItems: "center" },
    saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  });
}
