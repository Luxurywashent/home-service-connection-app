import React from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { router } from "expo-router";

const ACTION_ICONS: Record<string, string> = {
  login: "🔐",
  create_investor: "👤",
  update_investor: "✏️",
  create_investment: "💰",
  update_investment: "📝",
  record_payment: "💵",
  update_payment: "🔄",
  upload_document: "📄",
  post_update: "📢",
  support_request: "🆘",
  respond_support: "💬",
};

export default function AdminAuditLogScreen() {
  const colors = useColors();
  const auditLog = trpc.investor.adminGetAuditLog.useQuery({ limit: 100 });

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.replace("/(investor)/admin-home" as any)} style={styles.back}>
          <Text style={[styles.backText, { color: colors.primary }]}>← Dashboard</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>🕐 Audit Log</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>Last 100 actions in the investor portal</Text>

        {auditLog.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : !auditLog.data?.length ? (
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>No activity recorded yet.</Text>
          </View>
        ) : (
          auditLog.data.map((entry: any, idx: number) => (
            <View key={entry.logId ?? idx} style={[styles.entry, { borderBottomColor: colors.border }]}>
              <Text style={styles.entryIcon}>{ACTION_ICONS[entry.actionType] ?? "📋"}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.entryAction, { color: colors.foreground }]}>
                  {entry.actionType?.replace(/_/g, " ")}
                </Text>
                <Text style={[styles.entryActor, { color: colors.primary }]}>{entry.actorName}</Text>
                {entry.recordType && entry.recordId ? (
                  <Text style={[styles.entryRecord, { color: colors.muted }]}>
                    {entry.recordType} · {entry.recordId.slice(0, 16)}{entry.recordId.length > 16 ? "…" : ""}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.entryDate, { color: colors.muted }]}>
                {entry.createdAt
                  ? new Date(entry.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  : ""}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  back: { marginBottom: 12, alignSelf: "flex-start" },
  backText: { fontSize: 15, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2, marginBottom: 20 },
  empty: { borderRadius: 12, borderWidth: 1, padding: 24, alignItems: "center" },
  emptyText: { fontSize: 14 },
  entry: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 12, borderBottomWidth: 0.5 },
  entryIcon: { fontSize: 20, marginTop: 1 },
  entryAction: { fontSize: 14, fontWeight: "600", textTransform: "capitalize", marginBottom: 2 },
  entryActor: { fontSize: 12, fontWeight: "600", marginBottom: 1 },
  entryRecord: { fontSize: 11 },
  entryDate: { fontSize: 11, marginTop: 2 },
});
