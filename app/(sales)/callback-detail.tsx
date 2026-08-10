import { useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Alert, TextInput,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

type CallbackStatus = "scheduled" | "completed" | "missed" | "cancelled" | "rescheduled";

const STATUS_CONFIG: Record<CallbackStatus, { label: string; color: string; bg: string }> = {
  scheduled:   { label: "Scheduled",   color: "#1D4ED8", bg: "#DBEAFE" },
  completed:   { label: "Completed",   color: "#15803D", bg: "#DCFCE7" },
  missed:      { label: "Missed",      color: "#B91C1C", bg: "#FEE2E2" },
  cancelled:   { label: "Cancelled",   color: "#6B7280", bg: "#F3F4F6" },
  rescheduled: { label: "Rescheduled", color: "#92400E", bg: "#FEF3C7" },
};

function formatCallbackTime(isoString: string, timezone: string): string {
  const dt = new Date(isoString);
  return dt.toLocaleString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: timezone,
  });
}

export default function CallbackDetail() {
  const colors = useColors();
  const router = useRouter();
  const { callbackId } = useLocalSearchParams<{ callbackId: string }>();
  const [outcome, setOutcome] = useState("");
  const [updating, setUpdating] = useState(false);

  const { data: callback, refetch, isLoading } = trpc.salesCallback.getById.useQuery(
    { callbackId: callbackId ?? "" },
    { enabled: !!callbackId },
  );

  const updateMutation = trpc.salesCallback.updateStatus.useMutation();

  const handleUpdateStatus = async (newStatus: CallbackStatus) => {
    if (!callback) return;
    setUpdating(true);
    try {
      await updateMutation.mutateAsync({
        callbackId: callback.callbackId,
        status: newStatus,
        completedAt: newStatus === "completed" ? new Date().toISOString() : undefined,
        outcome: outcome.trim() || undefined,
      });
      await refetch();
      Alert.alert("Updated", `Callback marked as ${STATUS_CONFIG[newStatus].label}`);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to update status");
    } finally {
      setUpdating(false);
    }
  };

  const styles = StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, gap: 12 },
    backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: colors.border },
    title: { fontSize: 20, fontWeight: "800", color: colors.foreground },
    card: { marginHorizontal: 16, marginBottom: 14, backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border },
    cardTitle: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
    row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
    rowLabel: { fontSize: 13, color: colors.muted },
    rowValue: { fontSize: 13, fontWeight: "600", color: colors.foreground, flex: 1, textAlign: "right" },
    statusBadge: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
    statusText: { fontSize: 12, fontWeight: "700" },
    actionBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", borderWidth: 1 },
    actionRow: { flexDirection: "row", gap: 8, marginHorizontal: 16, marginBottom: 14 },
    input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.foreground, minHeight: 80, textAlignVertical: "top" },
  });

  if (isLoading) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 80 }} />
      </ScreenContainer>
    );
  }

  if (!callback) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Text style={{ fontSize: 18, color: colors.foreground }}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Callback Not Found</Text>
        </View>
      </ScreenContainer>
    );
  }

  const cfg = STATUS_CONFIG[callback.status as CallbackStatus] ?? STATUS_CONFIG.scheduled;
  const scheduledStr = callback.scheduledAt as unknown as string;
  const isScheduled = callback.status === "scheduled";

  return (
    <ScreenContainer edges={["left", "right"]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={{ fontSize: 18, color: colors.foreground }}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Callback Detail</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Status */}
        <View style={[styles.card, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}>
          <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>
            {callback.prospectFirstName} {callback.prospectLastName}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
            <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
        </View>

        {/* Contact Info */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Contact Information</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Phone</Text>
            <Text style={styles.rowValue}>{callback.prospectPhone}</Text>
          </View>
          {callback.prospectEmail ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Email</Text>
              <Text style={styles.rowValue}>{callback.prospectEmail}</Text>
            </View>
          ) : null}
        </View>

        {/* Scheduling */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Scheduled Callback</Text>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>
            {formatCallbackTime(scheduledStr, callback.timezone)}
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>{callback.timezone}</Text>
        </View>

        {/* GHL Status */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>SMS Status</Text>
          {callback.ghlTriggered === "yes" ? (
            <Text style={{ fontSize: 14, color: "#15803D", fontWeight: "600" }}>✓ Automated SMS sent to prospect</Text>
          ) : callback.ghlTriggered === "failed" ? (
            <Text style={{ fontSize: 14, color: "#B91C1C", fontWeight: "600" }}>⚠ SMS failed to send — check GHL webhook</Text>
          ) : (
            <Text style={{ fontSize: 14, color: colors.muted }}>SMS not yet triggered</Text>
          )}
          {callback.ghlTriggeredAt ? (
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
              Sent: {new Date(callback.ghlTriggeredAt as unknown as string).toLocaleString()}
            </Text>
          ) : null}
        </View>

        {/* Notes */}
        {callback.notes ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Notes</Text>
            <Text style={{ fontSize: 14, color: colors.foreground, lineHeight: 20 }}>{callback.notes}</Text>
          </View>
        ) : null}

        {/* Outcome (if completed) */}
        {callback.outcome ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Outcome</Text>
            <Text style={{ fontSize: 14, color: colors.foreground, lineHeight: 20 }}>{callback.outcome}</Text>
          </View>
        ) : null}

        {/* Actions (only if scheduled) */}
        {isScheduled ? (
          <>
            <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>Outcome Notes (optional)</Text>
              <TextInput
                style={styles.input}
                value={outcome}
                onChangeText={setOutcome}
                placeholder="What happened on the call? Next steps?"
                placeholderTextColor={colors.muted}
                multiline
              />
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: "#DCFCE7", borderColor: "#15803D" }]}
                onPress={() => handleUpdateStatus("completed")}
                disabled={updating}
                activeOpacity={0.8}
              >
                {updating ? <ActivityIndicator color="#15803D" size="small" /> : (
                  <Text style={{ color: "#15803D", fontWeight: "700", fontSize: 13 }}>✓ Completed</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: "#FEE2E2", borderColor: "#B91C1C" }]}
                onPress={() => handleUpdateStatus("missed")}
                disabled={updating}
                activeOpacity={0.8}
              >
                <Text style={{ color: "#B91C1C", fontWeight: "700", fontSize: 13 }}>✗ Missed</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: "#FEF3C7", borderColor: "#92400E" }]}
                onPress={() => {
                  Alert.alert("Reschedule", "To reschedule, cancel this callback and create a new one.", [
                    { text: "Cancel this callback", style: "destructive", onPress: () => handleUpdateStatus("cancelled") },
                    { text: "Keep it", style: "cancel" },
                  ]);
                }}
                disabled={updating}
                activeOpacity={0.8}
              >
                <Text style={{ color: "#92400E", fontWeight: "700", fontSize: 13 }}>↻ Reschedule</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
