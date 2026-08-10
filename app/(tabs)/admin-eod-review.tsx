/**
 * Admin EOD Checklist Review Screen
 * - Pick a date to view all submitted checklists
 * - See each detailer's 3 steps with photos
 * - Approve or mark as violation (with optional note)
 */
import {
  ActivityIndicator, Alert, FlatList, Image, Modal,
  RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import { useState, useCallback } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

const STEP_LABELS: Record<string, { label: string; icon: string }> = {
  trash_removed: { label: "Trash Removed", icon: "🗑️" },
  chemicals_stocked: { label: "Chemicals Stocked", icon: "🧴" },
  towels_stocked: { label: "Towels Stocked", icon: "🧺" },
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#F59E0B",
  submitted: "#3B82F6",
  approved: "#22C55E",
  violated: "#EF4444",
};

type ChecklistItem = {
  itemId: string;
  checklistId: string;
  stepKey: "trash_removed" | "chemicals_stocked" | "towels_stocked";
  photoUrl?: string | null;
  completedAt?: string | null;
};

type Checklist = {
  checklistId: string;
  employeeId: string;
  fullName?: string | null;
  date: string;
  status: "pending" | "submitted" | "approved" | "violated";
  submittedAt?: string | null;
  reviewNote?: string | null;
  reviewedBy?: string | null;
};

type Entry = { checklist: Checklist; items: ChecklistItem[] };

function todayStr() {
  // Use device local date (not UTC) so the date matches what the detailer sees
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function AdminEodReviewScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { employee } = useEmployeeAuth();
  const [date, setDate] = useState(todayStr());
  const [reviewEntry, setReviewEntry] = useState<Entry | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const listQuery = trpc.eodChecklist.listByDate.useQuery({ date });
  const reviewMut = trpc.eodChecklist.review.useMutation();

  const entries: Entry[] = (listQuery.data ?? []) as Entry[];

  const handleReview = useCallback(async (status: "approved" | "violated") => {
    if (!reviewEntry) return;
    setReviewSaving(true);
    try {
      await reviewMut.mutateAsync({
        checklistId: reviewEntry.checklist.checklistId,
        status,
        reviewedBy: employee?.fullName ?? employee?.employeeId ?? "Admin",
        reviewNote: reviewNote.trim() || undefined,
        employeeId: reviewEntry.checklist.employeeId,
        employeeName: reviewEntry.checklist.fullName ?? undefined,
        pointsDeducted: status === "violated" ? 5 : 0,
      });
      await listQuery.refetch();
      setReviewEntry(null);
      setReviewNote("");
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(
          status === "approved"
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Error,
        );
      }
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Failed to save review.");
    } finally {
      setReviewSaving(false);
    }
  }, [reviewEntry, reviewNote, employee, reviewMut, listQuery]);

  const fmtTime = (ts?: string | null) => {
    if (!ts) return "—";
    try { return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
    catch { return ts; }
  };

  // Date navigation helpers
  const shiftDate = (days: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  };

  return (
    <ScreenContainer edges={["left", "right"]} className="flex-1">
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>EOD Review</Text>
      </View>

      {/* Date picker row */}
      <View style={styles.dateRow}>
        <TouchableOpacity style={styles.dateArrow} onPress={() => shiftDate(-1)}>
          <Text style={styles.dateArrowText}>‹</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.dateInput}
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.muted}
          returnKeyType="done"
        />
        <TouchableOpacity style={styles.dateArrow} onPress={() => shiftDate(1)}>
          <Text style={styles.dateArrowText}>›</Text>
        </TouchableOpacity>
      </View>

      {listQuery.isLoading ? (
        <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={entries}
          keyExtractor={(e) => e.checklist.checklistId}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={listQuery.isRefetching} onRefresh={listQuery.refetch} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyText}>No checklists submitted for {date}.</Text>
            </View>
          }
          renderItem={({ item: entry }) => {
            const completedCount = entry.items.filter((i) => i.photoUrl).length;
            const statusColor = STATUS_COLORS[entry.checklist.status] ?? colors.muted;
            return (
              <TouchableOpacity
                style={styles.entryCard}
                onPress={() => { setReviewEntry(entry); setReviewNote(entry.checklist.reviewNote ?? ""); }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={styles.entryName}>{entry.checklist.fullName ?? entry.checklist.employeeId}</Text>
                  <View style={[styles.statusPill, { backgroundColor: statusColor + "22" }]}>
                    <Text style={[styles.statusText, { color: statusColor }]}>
                      {entry.checklist.status.charAt(0).toUpperCase() + entry.checklist.status.slice(1)}
                    </Text>
                  </View>
                </View>
                <Text style={styles.entrySub}>
                  {completedCount}/3 steps completed · Submitted {fmtTime(entry.checklist.submittedAt as any)}
                </Text>
                {/* Step thumbnails */}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  {(["trash_removed", "chemicals_stocked", "towels_stocked"] as const).map((key) => {
                    const item = entry.items.find((i) => i.stepKey === key);
                    const info = STEP_LABELS[key];
                    return (
                      <View key={key} style={styles.thumbWrap}>
                        {item?.photoUrl ? (
                          <TouchableOpacity onPress={() => setPhotoPreview(item.photoUrl!)}>
                            <Image
                              source={{ uri: item.photoUrl }}
                              style={styles.thumb}
                              onError={() => console.warn("[EOD] Failed to load thumb:", item.photoUrl)}
                            />
                          </TouchableOpacity>
                        ) : (
                          <View style={[styles.thumb, styles.thumbEmpty]}>
                            <Text style={{ fontSize: 18 }}>{info.icon}</Text>
                          </View>
                        )}
                        <Text style={styles.thumbLabel}>{info.label.split(" ")[0]}</Text>
                      </View>
                    );
                  })}
                </View>
                {entry.checklist.status === "submitted" && (
                  <Text style={[styles.reviewHint, { color: colors.primary }]}>Tap to review →</Text>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Review Modal */}
      <Modal visible={!!reviewEntry} transparent animationType="slide" onRequestClose={() => setReviewEntry(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>
                {reviewEntry?.checklist.fullName ?? reviewEntry?.checklist.employeeId}
              </Text>
              <Text style={styles.modalSub}>EOD Checklist · {reviewEntry?.checklist.date}</Text>

              {/* Steps */}
              {(["trash_removed", "chemicals_stocked", "towels_stocked"] as const).map((key) => {
                const item = reviewEntry?.items.find((i) => i.stepKey === key);
                const info = STEP_LABELS[key];
                return (
                  <View key={key} style={styles.stepRow}>
                    <Text style={styles.stepIcon}>{info.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stepLabel}>{info.label}</Text>
                      {item?.photoUrl ? (
                        <TouchableOpacity onPress={() => setPhotoPreview(item.photoUrl!)}>
                          <Image
                            source={{ uri: item.photoUrl }}
                            style={styles.stepPhoto}
                            onError={() => console.warn("[EOD] Failed to load step photo:", item.photoUrl)}
                          />
                          <Text style={[styles.stepSub, { color: colors.primary }]}>Tap to enlarge</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={[styles.stepSub, { color: colors.error }]}>No photo submitted</Text>
                      )}
                    </View>
                    <Text style={{ fontSize: 18 }}>{item?.photoUrl ? "✅" : "❌"}</Text>
                  </View>
                );
              })}

              {/* Note */}
              <Text style={styles.noteLabel}>Review Note (optional)</Text>
              <TextInput
                style={styles.noteInput}
                placeholder="Add a note..."
                placeholderTextColor={colors.muted}
                value={reviewNote}
                onChangeText={setReviewNote}
                multiline
                numberOfLines={3}
              />

              {/* Actions */}
              {reviewEntry?.checklist.status === "submitted" ? (
                <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.success + "22", flex: 1 }]}
                    onPress={() => handleReview("approved")}
                    disabled={reviewSaving}
                  >
                    {reviewSaving ? <ActivityIndicator color={colors.success} size="small" /> : (
                      <Text style={[styles.actionBtnText, { color: colors.success }]}>✅ Approve</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.error + "22", flex: 1 }]}
                    onPress={() => handleReview("violated")}
                    disabled={reviewSaving}
                  >
                    {reviewSaving ? <ActivityIndicator color={colors.error} size="small" /> : (
                      <Text style={[styles.actionBtnText, { color: colors.error }]}>⚠️ Violation</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={[styles.statusPill, { backgroundColor: STATUS_COLORS[reviewEntry?.checklist.status ?? "pending"] + "22", alignSelf: "center", marginTop: 16, paddingHorizontal: 20, paddingVertical: 10 }]}>
                  <Text style={[styles.statusText, { color: STATUS_COLORS[reviewEntry?.checklist.status ?? "pending"], fontSize: 15 }]}>
                    {(reviewEntry?.checklist.status ?? "").charAt(0).toUpperCase() + (reviewEntry?.checklist.status ?? "").slice(1)}
                  </Text>
                </View>
              )}

              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.surface, marginTop: 10 }]} onPress={() => setReviewEntry(null)}>
                <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Close</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Photo Preview Modal */}
      <Modal visible={!!photoPreview} transparent animationType="fade" onRequestClose={() => setPhotoPreview(null)}>
        <TouchableOpacity style={styles.photoOverlay} onPress={() => setPhotoPreview(null)} activeOpacity={1}>
          {photoPreview && <Image source={{ uri: photoPreview }} style={styles.photoFull} resizeMode="contain" />}
          <Text style={styles.photoClose}>Tap to close</Text>
        </TouchableOpacity>
      </Modal>
    </ScreenContainer>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
    headerTitle: { fontSize: 22, fontWeight: "800", color: colors.foreground },
    dateRow: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 12, gap: 8 },
    dateArrow: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
    dateArrowText: { fontSize: 22, color: colors.foreground, lineHeight: 28 },
    dateInput: { flex: 1, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: colors.foreground, textAlign: "center" },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    listContent: { padding: 16, paddingBottom: 40 },
    entryCard: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
    entryName: { fontSize: 16, fontWeight: "700", color: colors.foreground },
    entrySub: { fontSize: 12, color: colors.muted, marginTop: 3 },
    statusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    statusText: { fontSize: 12, fontWeight: "700" },
    thumbWrap: { flex: 1, alignItems: "center", gap: 4 },
    thumb: { width: "100%", aspectRatio: 1, borderRadius: 8 },
    thumbEmpty: { backgroundColor: colors.border, alignItems: "center", justifyContent: "center" },
    thumbLabel: { fontSize: 10, color: colors.muted, textAlign: "center" },
    reviewHint: { fontSize: 12, fontWeight: "600", marginTop: 8, textAlign: "right" },
    emptyWrap: { alignItems: "center", paddingVertical: 60 },
    emptyIcon: { fontSize: 40, marginBottom: 12 },
    emptyText: { fontSize: 14, color: colors.muted, textAlign: "center" },
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
    modalCard: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: "90%" },
    modalTitle: { fontSize: 20, fontWeight: "800", color: colors.foreground },
    modalSub: { fontSize: 13, color: colors.muted, marginBottom: 16 },
    stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14, backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border },
    stepIcon: { fontSize: 24, marginTop: 2 },
    stepLabel: { fontSize: 14, fontWeight: "700", color: colors.foreground, marginBottom: 6 },
    stepPhoto: { width: "100%", height: 120, borderRadius: 8, backgroundColor: colors.border },
    stepSub: { fontSize: 12, color: colors.muted, marginTop: 4 },
    noteLabel: { fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6, marginTop: 8 },
    noteInput: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.foreground, minHeight: 80, textAlignVertical: "top" },
    actionBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
    actionBtnText: { fontSize: 15, fontWeight: "700" },
    photoOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
    photoFull: { width: "95%", height: "80%" },
    photoClose: { color: "rgba(255,255,255,0.6)", marginTop: 16, fontSize: 14 },
  });
}
