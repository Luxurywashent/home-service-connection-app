import { useState } from "react";
import { Text, View, FlatList, TouchableOpacity, ActivityIndicator, Modal, ScrollView } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  qc_issue: { label: "QC Issue", color: "#EF4444" },
  write_up: { label: "Write-Up", color: "#DC2626" },
  missed_step: { label: "Missed Step", color: "#F59E0B" },
  coaching_note: { label: "Coaching", color: "#2563EB" },
  time_off_update: { label: "Time Off", color: "#22C55E" },
  company_announcement: { label: "Announcement", color: "#6B7280" },
  repair_request: { label: "Repair Request", color: "#F59E0B" },
};

export default function AlertsScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const [selectedNotif, setSelectedNotif] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"all" | "writeups">("all");
  const utils = trpc.useUtils();

  const { data: notifs, isLoading } = trpc.notifications.getForEmployee.useQuery(
    { employeeId: employee?.employeeId ?? "" },
    { enabled: !!employee }
  );

  const markReadMutation = trpc.notifications.markRead.useMutation({
    onSuccess: () => utils.notifications.getForEmployee.invalidate(),
  });
  const markAckMutation = trpc.notifications.markAcknowledged.useMutation({
    onSuccess: () => {
      utils.notifications.getForEmployee.invalidate();
      if (selectedNotif) setSelectedNotif({ ...selectedNotif, status: "acknowledged" });
    },
  });

  const handleOpen = async (notif: any) => {
    setSelectedNotif(notif);
    if (notif.status === "unread") {
      markReadMutation.mutate({ notificationId: notif.notificationId, employeeId: employee?.employeeId ?? "" });
    }
  };

  const handleAcknowledge = () => {
    if (!selectedNotif) return;
    markAckMutation.mutate({ notificationId: selectedNotif.notificationId, employeeId: employee?.employeeId ?? "" });
  };

  const allNotifs = notifs ?? [];
  const writeUps = allNotifs.filter((n) => n.notificationType === "write_up");
  const unreadCount = allNotifs.filter((n) => n.status === "unread").length;
  const unreadWriteUps = writeUps.filter((n) => n.status === "unread").length;

  const displayNotifs = activeTab === "writeups" ? writeUps : allNotifs;

  const getTimeAgo = (date: Date | string | null) => {
    if (!date) return "";
    const now = new Date();
    const d = new Date(date);
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <ScreenContainer edges={["left", "right"]} className="px-5">
      {/* Header */}
      <View style={{ marginTop: 8, marginBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>Alerts</Text>
          {unreadCount > 0 && (
            <View style={{ backgroundColor: colors.error, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "700" }}>{unreadCount} new</Text>
            </View>
          )}
        </View>
      </View>

      {/* Tab Switcher */}
      <View style={{
        flexDirection: "row", backgroundColor: colors.surface, borderRadius: 10,
        padding: 3, marginBottom: 14, borderWidth: 1, borderColor: colors.border,
      }}>
        <TouchableOpacity
          onPress={() => setActiveTab("all")}
          style={{
            flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center",
            backgroundColor: activeTab === "all" ? colors.primary : "transparent",
          }}
        >
          <Text style={{ color: activeTab === "all" ? "#fff" : colors.muted, fontSize: 13, fontWeight: "700" }}>
            All Alerts {unreadCount > 0 ? `(${unreadCount})` : ""}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveTab("writeups")}
          style={{
            flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center",
            backgroundColor: activeTab === "writeups" ? colors.error : "transparent",
          }}
        >
          <Text style={{ color: activeTab === "writeups" ? "#fff" : colors.muted, fontSize: 13, fontWeight: "700" }}>
            Write-Ups {unreadWriteUps > 0 ? `(${unreadWriteUps})` : writeUps.length > 0 ? `(${writeUps.length})` : ""}
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={displayNotifs}
          keyExtractor={(item) => item.notificationId}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={{ alignItems: "center", marginTop: 60 }}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>{activeTab === "writeups" ? "📋" : "🔔"}</Text>
              <Text style={{ fontSize: 16, color: colors.muted, textAlign: "center" }}>
                {activeTab === "writeups" ? "No write-ups on record" : "No alerts yet"}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const config = TYPE_CONFIG[item.notificationType] ?? { label: item.notificationType, color: colors.muted };
            const isUnread = item.status === "unread";
            const isWriteUp = item.notificationType === "write_up";
            return (
              <TouchableOpacity
                onPress={() => handleOpen(item)}
                activeOpacity={0.7}
                style={{
                  backgroundColor: isUnread ? (isWriteUp ? "#DC262608" : colors.primary + "08") : colors.surface,
                  borderRadius: 14,
                  padding: 16,
                  marginBottom: 10,
                  borderWidth: isWriteUp ? 1.5 : 1,
                  borderColor: isUnread ? (isWriteUp ? "#DC2626" + "40" : colors.primary + "30") : colors.border,
                  borderLeftWidth: 4,
                  borderLeftColor: config.color,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={{ backgroundColor: config.color + "20", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: config.color }}>{config.label}</Text>
                    </View>
                    {isWriteUp && item.status !== "acknowledged" && (
                      <View style={{ backgroundColor: colors.error + "20", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: colors.error }}>ACTION REQUIRED</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{getTimeAgo(item.createdAt)}</Text>
                </View>
                <Text style={{ fontSize: 15, fontWeight: isUnread ? "700" : "600", color: colors.foreground }} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.message && (
                  <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4 }} numberOfLines={2}>
                    {item.message}
                  </Text>
                )}
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8, gap: 8 }}>
                  <View style={{
                    width: 8, height: 8, borderRadius: 4,
                    backgroundColor: item.status === "unread" ? colors.primary : item.status === "acknowledged" ? colors.success : colors.muted,
                  }} />
                  <Text style={{ fontSize: 11, color: colors.muted, textTransform: "capitalize" }}>{item.status}</Text>
                  {item.requiresAcknowledgment === "yes" && item.status !== "acknowledged" && (
                    <Text style={{ fontSize: 11, color: colors.error, fontWeight: "600" }}>⚠ Requires Acknowledgment</Text>
                  )}
                  {item.status === "acknowledged" && (
                    <Text style={{ fontSize: 11, color: colors.success, fontWeight: "600" }}>✓ Acknowledged</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Detail Modal */}
      <Modal visible={!!selectedNotif} animationType="slide" presentationStyle="pageSheet">
        {selectedNotif && (
          <ScreenContainer edges={["bottom", "left", "right"]} className="px-5">
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ marginTop: 12 }}>
                <TouchableOpacity onPress={() => setSelectedNotif(null)} activeOpacity={0.7} style={{ paddingVertical: 8 }}>
                  <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>← Back</Text>
                </TouchableOpacity>

                <View style={{ marginTop: 16 }}>
                  <View style={{
                    backgroundColor: (TYPE_CONFIG[selectedNotif.notificationType]?.color ?? colors.muted) + "20",
                    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: "flex-start", marginBottom: 12,
                  }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: TYPE_CONFIG[selectedNotif.notificationType]?.color ?? colors.muted }}>
                      {TYPE_CONFIG[selectedNotif.notificationType]?.label ?? selectedNotif.notificationType}
                    </Text>
                  </View>

                  <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground, marginBottom: 8 }}>
                    {selectedNotif.title}
                  </Text>

                  <View style={{ flexDirection: "row", gap: 16, marginBottom: 20 }}>
                    <Text style={{ fontSize: 13, color: colors.muted }}>From: {selectedNotif.createdBy ?? "Management"}</Text>
                    <Text style={{ fontSize: 13, color: colors.muted }}>{getTimeAgo(selectedNotif.createdAt)}</Text>
                  </View>

                  {selectedNotif.message ? (
                    <Text style={{ fontSize: 15, color: colors.foreground, lineHeight: 24 }}>
                      {selectedNotif.message}
                    </Text>
                  ) : null}

                  {/* Write-up specific info box */}
                  {selectedNotif.notificationType === "write_up" && (
                    <View style={{
                      backgroundColor: colors.error + "10",
                      borderRadius: 12, padding: 16, marginTop: 20,
                      borderWidth: 1, borderColor: colors.error + "30",
                    }}>
                      <Text style={{ color: colors.error, fontSize: 14, fontWeight: "700", marginBottom: 4 }}>
                        📋 Formal Write-Up
                      </Text>
                      <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 20 }}>
                        This is an official write-up from management. You must acknowledge this notice. Write-ups are recorded in your personnel history and may affect your bonus eligibility.
                      </Text>
                    </View>
                  )}

                  {selectedNotif.requiresAcknowledgment === "yes" && selectedNotif.status !== "acknowledged" && (
                    <TouchableOpacity
                      onPress={handleAcknowledge}
                      activeOpacity={0.8}
                      disabled={markAckMutation.isPending}
                      style={{
                        backgroundColor: colors.primary,
                        borderRadius: 12,
                        paddingVertical: 16,
                        alignItems: "center",
                        marginTop: 32,
                      }}
                    >
                      <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>
                        {markAckMutation.isPending ? "Acknowledging..." : "I Acknowledge This Notice"}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {selectedNotif.status === "acknowledged" && (
                    <View style={{
                      backgroundColor: colors.success + "15",
                      borderRadius: 12,
                      padding: 16,
                      alignItems: "center",
                      marginTop: 32,
                    }}>
                      <Text style={{ color: colors.success, fontSize: 14, fontWeight: "600" }}>✓ Acknowledged</Text>
                    </View>
                  )}
                </View>
              </View>
            </ScrollView>
          </ScreenContainer>
        )}
      </Modal>
    </ScreenContainer>
  );
}
