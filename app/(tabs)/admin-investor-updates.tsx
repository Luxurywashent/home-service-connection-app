import React, { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Alert, StyleSheet, KeyboardAvoidingView, Platform,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { router } from "expo-router";

const CATEGORIES = [
  { id: "business_progress", label: "Business Progress" },
  { id: "fleet_expansion", label: "Fleet Expansion" },
  { id: "revenue_milestone", label: "Revenue Milestone" },
  { id: "repayment_update", label: "Repayment Update" },
  { id: "important_notice", label: "Important Notice" },
  { id: "general", label: "General" },
];

export default function AdminInvestorUpdatesScreen() {
  const colors = useColors();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("general");
  const [saving, setSaving] = useState(false);

  const updates = trpc.investor.adminListUpdates.useQuery();
  const postMutation = trpc.investor.adminPostUpdate.useMutation();
  const deleteMutation = trpc.investor.adminDeleteUpdate.useMutation();
  const utils = trpc.useUtils();

  const handlePost = async () => {
    if (!title.trim() || !body.trim()) {
      Alert.alert("Required", "Title and body are required.");
      return;
    }
    setSaving(true);
    try {
      await postMutation.mutateAsync({ title: title.trim(), body: body.trim(), category: category as any, adminName: "Admin" });
      setTitle("");
      setBody("");
      setCategory("general");
      utils.investor.adminListUpdates.invalidate();
      Alert.alert("Posted", "Update sent to all investors.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to post.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (updateId: string) => {
    Alert.alert("Delete Update", "Remove this update for all investors?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await deleteMutation.mutateAsync({ updateId });
          utils.investor.adminListUpdates.invalidate();
        } catch (e: any) { Alert.alert("Error", e?.message); }
      }},
    ]);
  };

  return (
    <ScreenContainer edges={["left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back}>
            <Text style={[styles.backText, { color: colors.primary }]}>← Investors</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>📢 Post Update</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>Updates are visible to all investors.</Text>

          {/* Form */}
          <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.muted }]}>CATEGORY</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.catBtn, category === c.id && { backgroundColor: colors.primary }]}
                  onPress={() => setCategory(c.id)}
                >
                  <Text style={{ color: category === c.id ? "#fff" : colors.muted, fontSize: 13, fontWeight: "600" }}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={[styles.label, { color: colors.muted }]}>TITLE</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              placeholder="e.g. Q1 Revenue Milestone Reached"
              placeholderTextColor={colors.muted}
              value={title}
              onChangeText={setTitle}
              returnKeyType="next"
            />

            <Text style={[styles.label, { color: colors.muted }]}>MESSAGE</Text>
            <TextInput
              style={[styles.textarea, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              placeholder="Write your update for investors..."
              placeholderTextColor={colors.muted}
              value={body}
              onChangeText={setBody}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />

            <TouchableOpacity
              style={[styles.postBtn, { backgroundColor: colors.primary }, saving && { opacity: 0.7 }]}
              onPress={handlePost}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.postBtnText}>Post Update</Text>}
            </TouchableOpacity>
          </View>

          {/* Past Updates */}
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Posted Updates</Text>
          {updates.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : !updates.data?.length ? (
            <Text style={[styles.emptyText, { color: colors.muted }]}>No updates posted yet.</Text>
          ) : (
            updates.data.map((u: any) => (
              <View key={u.updateId} style={[styles.updateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.updateHeader}>
                  <Text style={[styles.updateTitle, { color: colors.foreground }]}>{u.title}</Text>
                  <TouchableOpacity onPress={() => handleDelete(u.updateId)}>
                    <Text style={{ color: colors.error, fontSize: 13, fontWeight: "600" }}>Delete</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.updateCat, { color: colors.muted }]}>{u.category?.replace("_", " ")} · {new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</Text>
                <Text style={[styles.updateBody, { color: colors.muted }]} numberOfLines={3}>{u.body}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  back: { marginBottom: 16 },
  backText: { fontSize: 15, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  subtitle: { fontSize: 14, marginBottom: 20, color: "#888" },
  formCard: { borderRadius: 14, borderWidth: 1, padding: 18, marginBottom: 28 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 6, marginTop: 8 },
  catBtn: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, marginRight: 8, backgroundColor: "#33333340" },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 4 },
  textarea: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 120, marginBottom: 4 },
  postBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  postBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  emptyText: { fontSize: 14, textAlign: "center", marginTop: 10 },
  updateCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  updateHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  updateTitle: { fontSize: 15, fontWeight: "700", flex: 1, marginRight: 8 },
  updateCat: { fontSize: 12, marginBottom: 6, textTransform: "capitalize" },
  updateBody: { fontSize: 13, lineHeight: 18 },
});
