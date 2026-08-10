/**
 * Detailer EOD Checklist Screen
 * - 3 required steps: Trash Removed, Chemicals Stocked, Towels Stocked
 * - Each step requires a photo upload before it can be marked complete
 * - Submit button is ONLY enabled when all 3 photos are server-confirmed (not just local previews)
 * - If upload fails, the step shows a persistent "Upload Failed — Tap to Retry" state
 */
import {
  ActivityIndicator, Alert, Image, Platform, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { useState, useCallback } from "react";
import * as ImagePicker from "expo-image-picker";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";
import * as Haptics from "expo-haptics";

const STEPS = [
  { key: "back_photo" as const, label: "Back of Van", icon: "📸", desc: "Take a photo of the back of the van showing the cargo area." },
  { key: "driver_side_photo" as const, label: "Driver Side", icon: "📸", desc: "Take a photo of the driver side of the van." },
  { key: "passenger_side_photo" as const, label: "Passenger Side", icon: "📸", desc: "Take a photo of the passenger side of the van." },
  { key: "driver_area" as const, label: "Driver Area", icon: "🪑", desc: "Take a photo showing the driver area is clean and organized." },
  { key: "box_photo" as const, label: "Box Photo", icon: "📦", desc: "Take a photo of the equipment box showing all items are properly stored." },
  { key: "chemicals_stocked" as const, label: "Chemicals Fully Stocked", icon: "🧴", desc: "Take a photo showing all chemical bottles are full and properly stored." },
  { key: "towels_stocked" as const, label: "Towels Fully Stocked", icon: "🧺", desc: "Take a photo showing all towels are clean, folded, and fully stocked." },
];

const STATUS_LABELS: Record<string, string> = {
  pending: "In Progress",
  submitted: "Submitted — Awaiting Review",
  approved: "Approved ✅",
  violated: "Violation ⚠️",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#F59E0B",
  submitted: "#3B82F6",
  approved: "#22C55E",
  violated: "#EF4444",
};

// Per-step upload state
type StepUploadState = "idle" | "uploading" | "failed";

export default function EodChecklistScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { employee } = useEmployeeAuth();
  const [submitting, setSubmitting] = useState(false);

  // Local preview URIs — shown while uploading so the photo appears immediately
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  // Pending base64 payloads — kept in memory so we can retry without re-taking the photo
  const [pendingUploads, setPendingUploads] = useState<Record<string, { uri: string; base64: string }>>({});
  // Per-step upload state: idle | uploading | failed
  const [uploadStates, setUploadStates] = useState<Record<string, StepUploadState>>({});

  const todayQuery = trpc.eodChecklist.getToday.useQuery(
    { employeeId: employee?.employeeId ?? "", fullName: employee?.fullName ?? undefined },
    { enabled: !!employee?.employeeId },
  );
  const uploadPhotoMut = trpc.eodChecklist.uploadPhoto.useMutation();
  const submitStepMut = trpc.eodChecklist.submitStep.useMutation();
  const submitMut = trpc.eodChecklist.submit.useMutation();

  const checklist = (todayQuery.data as any)?.checklist;
  const items: any[] = (todayQuery.data as any)?.items ?? [];

  const getItem = (key: string) => items.find((i) => i.stepKey === key);

  // A step is server-confirmed only if the server has a photoUrl
  const isServerConfirmed = (key: string) => !!getItem(key)?.photoUrl;
  // All 3 must be server-confirmed before submit is allowed
  const allServerConfirmed = STEPS.every((s) => isServerConfirmed(s.key));
  const serverConfirmedCount = STEPS.filter((s) => isServerConfirmed(s.key)).length;
  const isLocked = checklist?.status === "submitted" || checklist?.status === "approved" || checklist?.status === "violated";

  const doUpload = useCallback(async (stepKey: string, uri: string, base64: string) => {
    if (!checklist?.checklistId) return;
    setUploadStates((prev) => ({ ...prev, [stepKey]: "uploading" }));
    try {
      const res = await uploadPhotoMut.mutateAsync({
        base64,
        mimeType: "image/jpeg",
        employeeId: employee?.employeeId ?? "unknown",
        stepKey,
      });
      const photoKey = res.key ?? res.url;
      await submitStepMut.mutateAsync({
        checklistId: checklist.checklistId,
        stepKey: stepKey as any,
        photoUrl: photoKey,
      });
      // Upload succeeded — clear pending and mark idle
      setPendingUploads((prev) => { const n = { ...prev }; delete n[stepKey]; return n; });
      setUploadStates((prev) => ({ ...prev, [stepKey]: "idle" }));
      await todayQuery.refetch();
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Upload failed — keep local preview and pending payload so detailer can retry
      setUploadStates((prev) => ({ ...prev, [stepKey]: "failed" }));
    }
  }, [checklist, employee, uploadPhotoMut, submitStepMut, todayQuery]);

  const handlePickPhoto = useCallback(async (stepKey: string) => {
    if (isLocked) return;
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Camera access is needed to complete this step.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const { uri, base64 } = result.assets[0];
      if (!base64) {
        Alert.alert("Photo Error", "Could not read photo data. Please retake the photo.");
        return;
      }
      // Show local preview immediately
      setLocalPreviews((prev) => ({ ...prev, [stepKey]: uri }));
      // Store pending payload for retry
      setPendingUploads((prev) => ({ ...prev, [stepKey]: { uri, base64 } }));
      await doUpload(stepKey, uri, base64);
    }
  }, [isLocked, doUpload]);

  const handleRetry = useCallback(async (stepKey: string) => {
    const pending = pendingUploads[stepKey];
    if (!pending) {
      // No pending payload — ask them to retake the photo
      await handlePickPhoto(stepKey);
      return;
    }
    await doUpload(stepKey, pending.uri, pending.base64);
  }, [pendingUploads, doUpload, handlePickPhoto]);

  const handleSubmit = useCallback(async () => {
    // Double-check all photos are server-confirmed before submitting
    if (!allServerConfirmed) {
      const failedSteps = STEPS.filter((s) => !isServerConfirmed(s.key)).map((s) => s.label);
      Alert.alert(
        "Photos Not Uploaded",
        `The following photos haven't finished uploading yet:\n\n${failedSteps.join("\n")}\n\nPlease tap "Retry Upload" on each step and wait for it to confirm before submitting.`,
      );
      return;
    }
    Alert.alert(
      "Submit Checklist",
      "Are you sure you want to submit your end-of-day checklist? You cannot make changes after submitting.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit",
          onPress: async () => {
            setSubmitting(true);
            try {
              await submitMut.mutateAsync({
                checklistId: checklist.checklistId,
                employeeId: employee?.employeeId ?? "",
                fullName: employee?.fullName ?? undefined,
              });
              await todayQuery.refetch();
              if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (err: any) {
              Alert.alert("Error", err?.message ?? "Failed to submit checklist.");
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  }, [allServerConfirmed, checklist, employee, submitMut, todayQuery]);

  if (todayQuery.isLoading) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  const statusColor = STATUS_COLORS[checklist?.status ?? "pending"] ?? colors.muted;
  const statusLabel = STATUS_LABELS[checklist?.status ?? "pending"] ?? "In Progress";

  return (
    <ScreenContainer edges={["left", "right"]} className="flex-1">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>End-of-Day Checklist</Text>
          <Text style={styles.subtitle}>All 7 photos must upload successfully before you can submit.</Text>
        </View>

        {/* Status banner */}
        <View style={[styles.statusBanner, { backgroundColor: statusColor + "22", borderColor: statusColor + "44" }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          {checklist?.reviewNote ? (
            <Text style={[styles.statusNote, { color: statusColor }]}>Note: {checklist.reviewNote}</Text>
          ) : null}
        </View>

        {/* Steps */}
        {STEPS.map((step, idx) => {
          const item = getItem(step.key);
          const serverUrl = item?.photoUrl;
          const localUrl = localPreviews[step.key];
          const uploadState = uploadStates[step.key] ?? "idle";
          const isUploading = uploadState === "uploading";
          const isFailed = uploadState === "failed";
          const isConfirmed = !!serverUrl;
          // Show photo area if we have a local preview or server URL
          const displayUrl = serverUrl || localUrl;

          return (
            <View key={step.key} style={[styles.stepCard, isConfirmed && styles.stepCardDone, isFailed && styles.stepCardFailed]}>
              {/* Step number & icon */}
              <View style={styles.stepHeader}>
                <View style={[styles.stepNum, { backgroundColor: isConfirmed ? colors.success : isFailed ? "#EF4444" : colors.primary }]}>
                  <Text style={styles.stepNumText}>{isConfirmed ? "✓" : isFailed ? "!" : String(idx + 1)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepLabel}>{step.icon} {step.label}</Text>
                  <Text style={styles.stepDesc}>{step.desc}</Text>
                </View>
              </View>

              {/* Photo area */}
              {displayUrl ? (
                <View style={styles.photoWrap}>
                  <View style={{ position: "relative" }}>
                    <Image source={{ uri: displayUrl }} style={styles.photo} resizeMode="cover" />
                    {/* Uploading overlay */}
                    {isUploading && (
                      <View style={styles.uploadingOverlay}>
                        <ActivityIndicator color="#fff" size="large" />
                        <Text style={styles.uploadingText}>Uploading…</Text>
                      </View>
                    )}
                    {/* Failed overlay */}
                    {isFailed && (
                      <View style={styles.failedOverlay}>
                        <Text style={styles.failedIcon}>⚠️</Text>
                        <Text style={styles.failedText}>Upload failed — poor signal?</Text>
                      </View>
                    )}
                    {/* Server confirmed badge */}
                    {isConfirmed && (
                      <View style={styles.confirmedBadge}>
                        <Text style={styles.confirmedBadgeText}>✓ Uploaded</Text>
                      </View>
                    )}
                  </View>
                  {/* Retry button if failed */}
                  {isFailed && !isLocked && (
                    <TouchableOpacity style={styles.retryBtn} onPress={() => handleRetry(step.key)}>
                      <Text style={styles.retryBtnText}>🔄 Retry Upload</Text>
                    </TouchableOpacity>
                  )}
                  {/* Retake button if confirmed */}
                  {isConfirmed && !isLocked && (
                    <TouchableOpacity style={styles.retakeBtn} onPress={() => handlePickPhoto(step.key)}>
                      <Text style={styles.retakeBtnText}>Retake Photo</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.uploadBtn, (isLocked || isUploading) && styles.uploadBtnDisabled]}
                  onPress={() => handlePickPhoto(step.key)}
                  disabled={isLocked || isUploading}
                >
                  {isUploading ? (
                    <>
                      <ActivityIndicator color={colors.primary} size="small" />
                      <Text style={styles.uploadText}>Uploading…</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.uploadIcon}>📷</Text>
                      <Text style={styles.uploadText}>Tap to take photo</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {/* Submit button — only enabled when all 3 are server-confirmed */}
        {!isLocked && (
          <TouchableOpacity
            style={[styles.submitBtn, (!allServerConfirmed || submitting) && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!allServerConfirmed || submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.submitBtnText}>
                {allServerConfirmed ? "Submit Checklist ✅" : `Waiting for uploads (${serverConfirmedCount}/${STEPS.length})`}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {/* Violation warning */}
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            ⚠️ Failure to complete this checklist is a violation and will result in point deductions. All photos are reviewed by your manager.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    scroll: { padding: 16, paddingBottom: 48 },
    header: { marginBottom: 16 },
    title: { fontSize: 24, fontWeight: "800", color: colors.foreground },
    subtitle: { fontSize: 14, color: colors.muted, marginTop: 4 },
    statusBanner: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 16, alignItems: "center" },
    statusText: { fontSize: 15, fontWeight: "700" },
    statusNote: { fontSize: 13, marginTop: 4, textAlign: "center" },
    stepCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 14 },
    stepCardDone: { borderColor: colors.success + "66" },
    stepCardFailed: { borderColor: "#EF444466" },
    stepHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 },
    stepNum: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    stepNumText: { color: "#fff", fontWeight: "800", fontSize: 15 },
    stepLabel: { fontSize: 15, fontWeight: "700", color: colors.foreground },
    stepDesc: { fontSize: 12, color: colors.muted, marginTop: 3, lineHeight: 18 },
    photoWrap: { gap: 10 },
    photo: { width: "100%", height: 200, borderRadius: 12, backgroundColor: colors.border },
    uploadingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 8 },
    uploadingText: { color: "#fff", fontSize: 14, fontWeight: "700" },
    failedOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(239,68,68,0.7)", borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 6 },
    failedIcon: { fontSize: 28 },
    failedText: { color: "#fff", fontSize: 13, fontWeight: "700", textAlign: "center", paddingHorizontal: 12 },
    confirmedBadge: { position: "absolute", top: 8, right: 8, backgroundColor: colors.success, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
    confirmedBadgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
    retakeBtn: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, alignItems: "center" },
    retakeBtnText: { fontSize: 13, fontWeight: "600", color: colors.muted },
    retryBtn: { backgroundColor: "#EF444415", borderRadius: 10, borderWidth: 1, borderColor: "#EF444466", paddingVertical: 12, alignItems: "center" },
    retryBtnText: { fontSize: 14, fontWeight: "700", color: "#EF4444" },
    uploadBtn: { backgroundColor: colors.primary + "15", borderRadius: 12, borderWidth: 2, borderColor: colors.primary + "44", borderStyle: "dashed", paddingVertical: 32, alignItems: "center", gap: 8 },
    uploadBtnDisabled: { opacity: 0.4 },
    uploadIcon: { fontSize: 32 },
    uploadText: { fontSize: 14, fontWeight: "600", color: colors.primary },
    submitBtn: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 8, marginBottom: 16 },
    submitBtnDisabled: { opacity: 0.5 },
    submitBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
    warningBox: { backgroundColor: colors.warning + "15", borderRadius: 12, borderWidth: 1, borderColor: colors.warning + "44", padding: 14 },
    warningText: { fontSize: 13, color: colors.warning, lineHeight: 20, textAlign: "center" },
  });
}
