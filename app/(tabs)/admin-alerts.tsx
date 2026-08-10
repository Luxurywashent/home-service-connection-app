import { useState } from "react";
import { Text, View, FlatList, TouchableOpacity, ActivityIndicator, Modal, TextInput, ScrollView, Alert, Linking, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  qc_issue: { label: "QC Issue", color: "#EF4444" },
  write_up: { label: "Write-Up", color: "#EF4444" },
  missed_step: { label: "Missed Step", color: "#F59E0B" },
  coaching_note: { label: "Coaching", color: "#2563EB" },
  time_off_update: { label: "Time Off", color: "#22C55E" },
  company_announcement: { label: "Announcement", color: "#6B7280" },
  repair_request: { label: "Repair Request", color: "#F59E0B" },
};

const NOTIF_TYPES = [
  { value: "qc_issue", label: "QC Issue" },
  { value: "write_up", label: "Write-Up" },
  { value: "missed_step", label: "Missed Step" },
  { value: "coaching_note", label: "Coaching Note" },
  { value: "company_announcement", label: "Company Announcement" },
] as const;

const DEFAULT_ZOOM_LINK = "https://us06web.zoom.us/j/82859954621?pwd=nAdoG0O7RjHIdews7Tpcaltyb1aXDj.1";

export default function AdminAlertsScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedNotif, setSelectedNotif] = useState<any>(null);
  const [filter, setFilter] = useState<"all" | "unacknowledged" | "writeups" | "meetings">("all");

  // Company Meetings state
  const [showMeetingForm, setShowMeetingForm] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<any>(null);
  const [mtgTitle, setMtgTitle] = useState("");
  const [mtgDescription, setMtgDescription] = useState("");
  const [mtgDate, setMtgDate] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [mtgTime, setMtgTime] = useState("09:00");
  const [mtgZoomLink, setMtgZoomLink] = useState(DEFAULT_ZOOM_LINK);
  const [mtgIsRecurring, setMtgIsRecurring] = useState(false);
  const [mtgRecurringDay, setMtgRecurringDay] = useState("Monday");
  const [savingMeeting, setSavingMeeting] = useState(false);

  // Create form state — now supports multiple team members
  const [targetEmployeeIds, setTargetEmployeeIds] = useState<string[]>([]);
  const [notifType, setNotifType] = useState<string>("coaching_note");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [requiresAck, setRequiresAck] = useState(false);
  const [sendEmailToggle, setSendEmailToggle] = useState(false);
  const [creating, setCreating] = useState(false);

   const { data: allNotifs, isLoading } = trpc.notifications.getAll.useQuery();
  const { data: unackNotifs } = trpc.notifications.getUnacknowledgedCritical.useQuery();
  const { data: allWriteUps, isLoading: writeUpsLoading } = trpc.points.getAllWriteUps.useQuery();
  const { data: detailers } = trpc.employee.listDetailers.useQuery();
  const createMutation = trpc.notifications.create.useMutation();

  // Company Meetings
  const { data: companyMeetingsData, isLoading: meetingsLoading } = trpc.companyMeetings.getAll.useQuery();
  const createMeetingMutation = trpc.companyMeetings.create.useMutation({
    onSuccess: () => { utils.companyMeetings.getAll.invalidate(); utils.companyMeetings.getUpcoming.invalidate(); resetMeetingForm(); setShowMeetingForm(false); },
  });
  const updateMeetingMutation = trpc.companyMeetings.update.useMutation({
    onSuccess: () => { utils.companyMeetings.getAll.invalidate(); utils.companyMeetings.getUpcoming.invalidate(); resetMeetingForm(); setShowMeetingForm(false); },
  });
  const deleteMeetingMutation = trpc.companyMeetings.delete.useMutation({
    onSuccess: () => { utils.companyMeetings.getAll.invalidate(); utils.companyMeetings.getUpcoming.invalidate(); },
  });
  const markReadMutation = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.getAll.invalidate();
      utils.notifications.getUnacknowledgedCritical.invalidate();
      utils.alerts.getSummary.invalidate();
    },
  });
  const markAllReadMutation = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.getAll.invalidate();
      utils.notifications.getUnacknowledgedCritical.invalidate();
      utils.alerts.getSummary.invalidate();
    },
  });
  // System-internal types are sent to employees only and should not appear in the admin alerts list
  const SYSTEM_TYPES = new Set(["clock_check_5pm", "clock_alert", "callback_reminder", "ai_booking", "job_transfer", "missed_call"]);
  const adminNotifs = (allNotifs ?? []).filter((n) => !SYSTEM_TYPES.has(n.notificationType));
  const unreadCount = adminNotifs.filter((n) => n.status === "unread").length;
  const displayNotifs = filter === "unacknowledged" ? (unackNotifs ?? []).filter((n) => !SYSTEM_TYPES.has(n.notificationType)) : filter === "writeups" ? [] : adminNotifs;
  const writeUpsCount = allWriteUps?.length ?? 0;
  const unackWriteUps = allWriteUps?.filter((w: any) => w.status !== "acknowledged").length ?? 0;

  const toggleEmployee = (empId: string) => {
    setTargetEmployeeIds((prev) =>
      prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId]
    );
  };

  const selectAll = () => {
    if (!detailers) return;
    if (targetEmployeeIds.length === detailers.length) {
      setTargetEmployeeIds([]);
    } else {
      setTargetEmployeeIds(detailers.map((d) => d.employeeId));
    }
  };

  const resetMeetingForm = () => {
    setEditingMeeting(null);
    setMtgTitle("");
    setMtgDescription("");
    setMtgDate("");
    setMtgTime("09:00");
    setMtgZoomLink(DEFAULT_ZOOM_LINK);
    setMtgIsRecurring(false);
    setMtgRecurringDay("Monday");
  };

  const openMeetingEdit = (meeting: any) => {
    setEditingMeeting(meeting);
    setMtgTitle(meeting.title);
    setMtgDescription(meeting.description ?? "");
    setMtgDate(meeting.meetingDate);
    setMtgTime(meeting.meetingTime);
    setMtgZoomLink(meeting.zoomLink ?? DEFAULT_ZOOM_LINK);
    setMtgIsRecurring(meeting.isRecurring === "yes");
    setMtgRecurringDay(meeting.recurringDay ?? "Monday");
    setShowMeetingForm(true);
  };

  const handleSaveMeeting = async () => {
    if (!mtgTitle.trim() || !mtgDate.trim() || !mtgTime.trim()) return;
    setSavingMeeting(true);
    try {
      if (editingMeeting) {
        await updateMeetingMutation.mutateAsync({
          meetingId: editingMeeting.meetingId,
          title: mtgTitle.trim(),
          description: mtgDescription.trim() || undefined,
          meetingDate: mtgDate.trim(),
          meetingTime: mtgTime.trim(),
          zoomLink: mtgZoomLink.trim() || undefined,
          isRecurring: mtgIsRecurring ? "yes" : "no",
          recurringDay: mtgIsRecurring ? mtgRecurringDay : undefined,
        });
      } else {
        await createMeetingMutation.mutateAsync({
          title: mtgTitle.trim(),
          description: mtgDescription.trim() || undefined,
          meetingDate: mtgDate.trim(),
          meetingTime: mtgTime.trim(),
          zoomLink: mtgZoomLink.trim() || undefined,
          isRecurring: mtgIsRecurring ? "yes" : "no",
          recurringDay: mtgIsRecurring ? mtgRecurringDay : undefined,
          createdBy: employee?.fullName ?? employee?.employeeId,
        });
      }
    } catch (e) {
      console.log("Save meeting error:", e);
    } finally {
      setSavingMeeting(false);
    }
  };

  const handleDeleteMeeting = (meeting: any) => {
    Alert.alert("Delete Meeting", `Permanently delete "${meeting.title}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMeetingMutation.mutate({ meetingId: meeting.meetingId }) },
    ]);
  };

  const handleCancelMeeting = (meeting: any) => {
    Alert.alert(
      "Cancel Meeting",
      `Cancel "${meeting.title}"? Team members will see it marked as cancelled.`,
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Cancel Meeting",
          style: "destructive",
          onPress: () => updateMeetingMutation.mutate({ meetingId: meeting.meetingId, status: "cancelled" }),
        },
      ]
    );
  };

  const handleRestoreMeeting = (meeting: any) => {
    Alert.alert(
      "Restore Meeting",
      `Restore "${meeting.title}" as an upcoming meeting?`,
      [
        { text: "No", style: "cancel" },
        {
          text: "Restore",
          onPress: () => updateMeetingMutation.mutate({ meetingId: meeting.meetingId, status: "upcoming" }),
        },
      ]
    );
  };

  const formatMeetingDate = (dateStr: string, timeStr: string) => {
    try {
      const d = new Date(`${dateStr}T${timeStr}:00`);
      return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) + " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    } catch { return `${dateStr} ${timeStr}`; }
  };

  const resetForm = () => {
    setTargetEmployeeIds([]);
    setNotifType("coaching_note");
    setTitle("");
    setMessage("");
    setRequiresAck(false);
    setSendEmailToggle(false);
  };

  const handleCreate = async () => {
    if (targetEmployeeIds.length === 0 || !title.trim()) return;
    setCreating(true);
    try {
      // Create a separate notification for each selected team member
      for (const empId of targetEmployeeIds) {
        const targetEmp = detailers?.find((d) => d.employeeId === empId);
        await createMutation.mutateAsync({
          notificationId: `NOTIF-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
          employeeId: empId,
          fullName: targetEmp?.fullName,
          notificationType: notifType as any,
          title: title.trim(),
          message: message.trim() || undefined,
          createdBy: employee?.fullName ?? employee?.employeeId,
          requiresAcknowledgment: requiresAck ? "yes" : "no",
          sendEmail: sendEmailToggle,
        });
      }
      utils.notifications.getAll.invalidate();
      utils.notifications.getUnacknowledgedCritical.invalidate();
      utils.alerts.getSummary.invalidate();
      resetForm();
      setShowCreate(false);
    } catch (e) {
      console.log("Create notification error:", e);
    } finally {
      setCreating(false);
    }
  };

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
      <View style={{ marginTop: 8, marginBottom: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>Alerts</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {unreadCount > 0 && (
              <TouchableOpacity
                onPress={() => markAllReadMutation.mutate()}
                activeOpacity={0.7}
                disabled={markAllReadMutation.isPending}
                style={{ backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "700" }}>✓ All Read</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => setShowCreate(true)}
              activeOpacity={0.7}
              style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}
            >
              <Text style={{ color: "#FFF", fontSize: 13, fontWeight: "700" }}>+ New</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Filter tabs */}
      <View style={{ marginBottom: 14, flexShrink: 0 }}>
        <View style={{ flexDirection: "row", backgroundColor: colors.surface, borderRadius: 12, padding: 3, borderWidth: 1, borderColor: colors.border, gap: 2, overflow: "hidden", alignSelf: "flex-start", height: 42 }}>
          {(["all", "unacknowledged", "writeups", "meetings"] as const).map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              activeOpacity={0.7}
              style={{
                height: 34, paddingHorizontal: 14, borderRadius: 9,
                backgroundColor: filter === f ? (f === "writeups" ? colors.error : f === "meetings" ? "#7C3AED" : colors.primary) : "transparent",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: "700", color: filter === f ? "#FFF" : colors.muted, lineHeight: 14 }}>
                {f === "all" ? "All" : f === "unacknowledged" ? "Unack'd" : f === "writeups" ? `Write-Ups${writeUpsCount > 0 ? ` (${writeUpsCount})` : ""}` : "Meetings"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      {filter === "meetings" ? (
        meetingsLoading ? (
          <ActivityIndicator size="large" color="#7C3AED" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
            data={companyMeetingsData ?? []}
            keyExtractor={(item: any) => item.meetingId}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 40 }}
            ListHeaderComponent={
              <TouchableOpacity
                onPress={() => { resetMeetingForm(); setShowMeetingForm(true); }}
                activeOpacity={0.8}
                style={{ backgroundColor: "#7C3AED", borderRadius: 12, paddingVertical: 14, alignItems: "center", marginBottom: 16 }}
              >
                <Text style={{ color: "#FFF", fontSize: 15, fontWeight: "700" }}>+ Schedule Meeting</Text>
              </TouchableOpacity>
            }
            ListEmptyComponent={
              <View style={{ alignItems: "center", marginTop: 60 }}>
                <Text style={{ fontSize: 40, marginBottom: 12 }}>📅</Text>
                <Text style={{ fontSize: 16, color: colors.muted }}>No meetings scheduled yet</Text>
                <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center" }}>Tap "Schedule Meeting" to add your first company meeting</Text>
              </View>
            }
            renderItem={({ item }: { item: any }) => {
              const isPast = item.meetingDate < new Date().toISOString().slice(0, 10);
              const isCancelled = item.status === "cancelled";
              return (
                <View style={{
                  backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 10,
                  borderWidth: 1, borderColor: isCancelled ? colors.error + "40" : isPast ? colors.border : "#7C3AED40",
                  borderLeftWidth: 4, borderLeftColor: isCancelled ? colors.error : isPast ? colors.muted : "#7C3AED",
                  opacity: isCancelled || isPast ? 0.7 : 1,
                }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        {item.isRecurring === "yes" && (
                          <View style={{ backgroundColor: "#7C3AED20", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                            <Text style={{ color: "#7C3AED", fontSize: 10, fontWeight: "700" }}>RECURRING</Text>
                          </View>
                        )}
                        {isCancelled && (
                          <View style={{ backgroundColor: colors.error + "20", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                            <Text style={{ color: colors.error, fontSize: 10, fontWeight: "700" }}>CANCELLED</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>{item.title}</Text>
                      <Text style={{ color: "#7C3AED", fontSize: 13, marginTop: 3, fontWeight: "600" }}>{formatMeetingDate(item.meetingDate, item.meetingTime)}</Text>
                      {item.isRecurring === "yes" && item.recurringDay && (
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Every {item.recurringDay}</Text>
                      )}
                      {item.description ? (
                        <Text style={{ color: colors.muted, fontSize: 13, marginTop: 6 }} numberOfLines={2}>{item.description}</Text>
                      ) : null}
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                    {item.zoomLink ? (
                      <TouchableOpacity
                        onPress={() => Linking.openURL(item.zoomLink)}
                        activeOpacity={0.7}
                        style={{ flex: 1, backgroundColor: "#2D8CFF20", borderRadius: 8, paddingVertical: 8, alignItems: "center", borderWidth: 1, borderColor: "#2D8CFF40" }}
                      >
                        <Text style={{ color: "#2D8CFF", fontSize: 13, fontWeight: "700" }}>🎥 Join Zoom</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      onPress={() => openMeetingEdit(item)}
                      activeOpacity={0.7}
                      style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 8, paddingVertical: 8, alignItems: "center", borderWidth: 1, borderColor: colors.border }}
                    >
                      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>Edit</Text>
                    </TouchableOpacity>
                    {isCancelled ? (
                      <TouchableOpacity
                        onPress={() => handleRestoreMeeting(item)}
                        activeOpacity={0.7}
                        style={{ backgroundColor: colors.success + "15", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, alignItems: "center", borderWidth: 1, borderColor: colors.success + "30" }}
                      >
                        <Text style={{ color: colors.success, fontSize: 13, fontWeight: "600" }}>Restore</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        onPress={() => handleCancelMeeting(item)}
                        activeOpacity={0.7}
                        style={{ backgroundColor: colors.warning + "15", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, alignItems: "center", borderWidth: 1, borderColor: colors.warning + "30" }}
                      >
                        <Text style={{ color: colors.warning, fontSize: 13, fontWeight: "600" }}>Cancel</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => handleDeleteMeeting(item)}
                      activeOpacity={0.7}
                      style={{ backgroundColor: colors.error + "15", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, alignItems: "center", borderWidth: 1, borderColor: colors.error + "30" }}
                    >
                      <Text style={{ color: colors.error, fontSize: 13, fontWeight: "600" }}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
          />
        )
      ) : filter === "writeups" ? (
        writeUpsLoading ? (
          <ActivityIndicator size="large" color={colors.error} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
            data={allWriteUps ?? []}
            keyExtractor={(item: any) => item.notificationId}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 40 }}
            ListHeaderComponent={
              unackWriteUps > 0 ? (
                <View style={{ backgroundColor: colors.error + "15", borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: colors.error + "30" }}>
                  <Text style={{ color: colors.error, fontSize: 13, fontWeight: "700" }}>⚠ {unackWriteUps} write-up{unackWriteUps !== 1 ? "s" : ""} pending acknowledgment</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={{ alignItems: "center", marginTop: 60 }}>
                <Text style={{ fontSize: 40, marginBottom: 12 }}>📋</Text>
                <Text style={{ fontSize: 16, color: colors.muted }}>No write-ups issued yet</Text>
              </View>
            }
            renderItem={({ item }: { item: any }) => (
              <View style={{
                backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10,
                borderWidth: 1.5, borderColor: item.status !== "acknowledged" ? colors.error + "50" : colors.border,
                borderLeftWidth: 4, borderLeftColor: item.status !== "acknowledged" ? colors.error : colors.success,
              }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>{item.fullName}</Text>
                    <Text style={{ color: colors.foreground, fontSize: 14, marginTop: 2 }}>{item.title}</Text>
                  </View>
                  <View style={{
                    backgroundColor: item.status !== "acknowledged" ? colors.error + "20" : colors.success + "20",
                    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginLeft: 8,
                  }}>
                    <Text style={{ color: item.status !== "acknowledged" ? colors.error : colors.success, fontSize: 11, fontWeight: "700" }}>
                      {item.status !== "acknowledged" ? "PENDING" : "ACKNOWLEDGED"}
                    </Text>
                  </View>
                </View>
                {item.message ? (
                  <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 6 }} numberOfLines={2}>{item.message}</Text>
                ) : null}
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>By: {item.createdBy ?? "Admin"}</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{getTimeAgo(item.createdAt)}</Text>
                </View>
              </View>
            )}
          />
        )
      ) : isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={displayNotifs}
          keyExtractor={(item) => item.notificationId}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={{ alignItems: "center", marginTop: 60 }}>
              <Text style={{ fontSize: 16, color: colors.muted }}>No notifications</Text>
            </View>
          }
          renderItem={({ item }) => {
            const config = TYPE_CONFIG[item.notificationType] ?? { label: item.notificationType, color: colors.muted };
            return (
              <TouchableOpacity
                onPress={() => setSelectedNotif(item)}
                activeOpacity={0.7}
                style={{
                  backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 10,
                  borderWidth: 1, borderColor: colors.border,
                  borderLeftWidth: 4, borderLeftColor: config.color,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <View style={{ backgroundColor: config.color + "20", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: config.color }}>{config.label}</Text>
                    </View>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>{item.fullName ?? item.employeeId}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{getTimeAgo(item.createdAt)}</Text>
                </View>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{item.title}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6, gap: 8, justifyContent: "space-between" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{
                      width: 8, height: 8, borderRadius: 4,
                      backgroundColor: item.status === "unread" ? colors.primary : item.status === "acknowledged" ? colors.success : colors.muted,
                    }} />
                    <Text style={{ fontSize: 11, color: colors.muted, textTransform: "capitalize" }}>{item.status}</Text>
                    {item.requiresAcknowledgment === "yes" && item.status !== "acknowledged" && (
                      <Text style={{ fontSize: 11, color: colors.error, fontWeight: "600" }}>Needs Ack</Text>
                    )}
                  </View>
                  {item.status === "unread" && (
                    <TouchableOpacity
                      onPress={(e) => { e.stopPropagation?.(); markReadMutation.mutate({ notificationId: item.notificationId, employeeId: item.employeeId }); }}
                      activeOpacity={0.7}
                      style={{ backgroundColor: colors.primary + "20", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}
                    >
                      <Text style={{ fontSize: 11, color: colors.primary, fontWeight: "700" }}>Mark Read</Text>
                    </TouchableOpacity>
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
            <View style={{ marginTop: 12 }}>
              <TouchableOpacity onPress={() => setSelectedNotif(null)} activeOpacity={0.7} style={{ paddingVertical: 8 }}>
                <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>Close</Text>
              </TouchableOpacity>
              <View style={{ marginTop: 16 }}>
                <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "600", marginBottom: 4 }}>To: {selectedNotif.fullName ?? selectedNotif.employeeId}</Text>
                <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground, marginBottom: 8 }}>{selectedNotif.title}</Text>
                <View style={{ flexDirection: "row", gap: 16, marginBottom: 20 }}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>From: {selectedNotif.createdBy ?? "Admin"}</Text>
                  <Text style={{ fontSize: 13, color: colors.muted }}>Status: {selectedNotif.status}</Text>
                </View>
                <Text style={{ fontSize: 15, color: colors.foreground, lineHeight: 24 }}>{selectedNotif.message}</Text>
              </View>
            </View>
          </ScreenContainer>
        )}
      </Modal>

      {/* Create Modal */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet">
        <ScreenContainer edges={["bottom", "left", "right"]} className="px-5">
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <TouchableOpacity onPress={() => { resetForm(); setShowCreate(false); }} activeOpacity={0.7}>
                  <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>Cancel</Text>
                </TouchableOpacity>
                <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>New Notification</Text>
                <View style={{ width: 60 }} />
              </View>

              <View style={{ gap: 14, marginTop: 24 }}>
                {/* Multi-Select Team Member Picker */}
                <View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Team Members ({targetEmployeeIds.length} selected)
                    </Text>
                    <TouchableOpacity onPress={selectAll} activeOpacity={0.7}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>
                        {detailers && targetEmployeeIds.length === detailers.length ? "Deselect All" : "Select All"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {(detailers ?? []).map((d) => {
                      const isSelected = targetEmployeeIds.includes(d.employeeId);
                      return (
                        <TouchableOpacity
                          key={d.employeeId}
                          onPress={() => toggleEmployee(d.employeeId)}
                          activeOpacity={0.7}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                            paddingHorizontal: 14,
                            paddingVertical: 8,
                            borderRadius: 10,
                            backgroundColor: isSelected ? colors.primary : colors.surface,
                            borderWidth: 1,
                            borderColor: isSelected ? colors.primary : colors.border,
                          }}
                        >
                          <View style={{
                            width: 18, height: 18, borderRadius: 4,
                            backgroundColor: isSelected ? "#FFF" : "transparent",
                            borderWidth: 2, borderColor: isSelected ? "#FFF" : colors.muted,
                            justifyContent: "center", alignItems: "center",
                          }}>
                            {isSelected && <Text style={{ color: colors.primary, fontSize: 11, fontWeight: "900" }}>✓</Text>}
                          </View>
                          <Text style={{
                            fontSize: 13, fontWeight: "600",
                            color: isSelected ? "#FFF" : colors.foreground,
                          }}>{d.fullName}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Type Picker */}
                <View>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Type</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {NOTIF_TYPES.map((t) => (
                      <TouchableOpacity
                        key={t.value}
                        onPress={() => setNotifType(t.value)}
                        activeOpacity={0.7}
                        style={{
                          paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
                          backgroundColor: notifType === t.value ? (TYPE_CONFIG[t.value]?.color ?? colors.primary) : colors.surface,
                          borderWidth: 1, borderColor: notifType === t.value ? (TYPE_CONFIG[t.value]?.color ?? colors.primary) : colors.border,
                        }}
                      >
                        <Text style={{
                          fontSize: 13, fontWeight: "600",
                          color: notifType === t.value ? "#FFF" : colors.foreground,
                        }}>{t.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Title</Text>
                  <TextInput
                    value={title}
                    onChangeText={setTitle}
                    placeholder="Notification title"
                    placeholderTextColor={colors.muted}
                    returnKeyType="next"
                    style={{
                      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                      borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.foreground,
                    }}
                  />
                </View>

                <View>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Message</Text>
                  <TextInput
                    value={message}
                    onChangeText={setMessage}
                    placeholder="Detailed message"
                    placeholderTextColor={colors.muted}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                    style={{
                      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                      borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
                      color: colors.foreground, minHeight: 100,
                    }}
                  />
                </View>

                <TouchableOpacity
                  onPress={() => setRequiresAck(!requiresAck)}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 10,
                    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
                    borderWidth: 1, borderColor: colors.border,
                  }}
                >
                  <View style={{
                    width: 22, height: 22, borderRadius: 6,
                    backgroundColor: requiresAck ? colors.primary : "transparent",
                    borderWidth: 2, borderColor: requiresAck ? colors.primary : colors.muted,
                    justifyContent: "center", alignItems: "center",
                  }}>
                    {requiresAck && <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "800" }}>✓</Text>}
                  </View>
                  <Text style={{ fontSize: 14, color: colors.foreground }}>Requires Acknowledgment</Text>
                </TouchableOpacity>

                {/* Email toggle */}
                <TouchableOpacity
                  onPress={() => setSendEmailToggle(!sendEmailToggle)}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 10,
                    backgroundColor: sendEmailToggle ? "#0057FF10" : colors.surface,
                    borderRadius: 12, padding: 14,
                    borderWidth: 1, borderColor: sendEmailToggle ? "#0057FF40" : colors.border,
                  }}
                >
                  <View style={{
                    width: 22, height: 22, borderRadius: 6,
                    backgroundColor: sendEmailToggle ? "#0057FF" : "transparent",
                    borderWidth: 2, borderColor: sendEmailToggle ? "#0057FF" : colors.muted,
                    justifyContent: "center", alignItems: "center",
                  }}>
                    {sendEmailToggle && <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "800" }}>✓</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "600" }}>Also send via Email</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>Sends a Gmail to the team member's email address on file</Text>
                  </View>
                </TouchableOpacity>

                {/* Send summary */}
                {targetEmployeeIds.length > 1 && (
                  <View style={{
                    backgroundColor: colors.primary + "10",
                    borderRadius: 10,
                    padding: 12,
                    borderWidth: 1,
                    borderColor: colors.primary + "30",
                  }}>
                    <Text style={{ fontSize: 13, color: colors.primary, textAlign: "center" }}>
                      This will send {targetEmployeeIds.length} separate notifications — one to each selected team member.
                    </Text>
                  </View>
                )}

                <TouchableOpacity
                  onPress={handleCreate}
                  disabled={creating || targetEmployeeIds.length === 0 || !title.trim()}
                  activeOpacity={0.8}
                  style={{
                    backgroundColor: targetEmployeeIds.length > 0 && title.trim() ? colors.primary : colors.border,
                    borderRadius: 12, paddingVertical: 16, alignItems: "center",
                    opacity: creating ? 0.7 : 1, marginTop: 8, marginBottom: 40,
                  }}
                >
                  {creating ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>
                      {targetEmployeeIds.length > 1
                        ? `Send to ${targetEmployeeIds.length} Team Members`
                        : "Send Notification"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </ScreenContainer>
      </Modal>
      {/* Meeting Form Modal */}
      <Modal visible={showMeetingForm} animationType="slide" presentationStyle="pageSheet">
        <ScreenContainer edges={["bottom", "left", "right"]} className="px-5">
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <TouchableOpacity onPress={() => { resetMeetingForm(); setShowMeetingForm(false); }} activeOpacity={0.7}>
                  <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>Cancel</Text>
                </TouchableOpacity>
                <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>
                  {editingMeeting ? "Edit Meeting" : "Schedule Meeting"}
                </Text>
                <View style={{ width: 60 }} />
              </View>
              <View style={{ gap: 16 }}>
                {/* Title */}
                <View>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Meeting Title *</Text>
                  <TextInput
                    value={mtgTitle}
                    onChangeText={setMtgTitle}
                    placeholder="e.g. Weekly Team Zoom"
                    placeholderTextColor={colors.muted}
                    returnKeyType="next"
                    style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 14, fontSize: 15, color: colors.foreground, borderWidth: 1, borderColor: colors.border }}
                  />
                </View>
                {/* Description */}
                <View>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Description (Optional)</Text>
                  <TextInput
                    value={mtgDescription}
                    onChangeText={setMtgDescription}
                    placeholder="Agenda, topics, or notes..."
                    placeholderTextColor={colors.muted}
                    multiline
                    numberOfLines={3}
                    style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 14, fontSize: 15, color: colors.foreground, borderWidth: 1, borderColor: colors.border, minHeight: 80, textAlignVertical: "top" }}
                  />
                </View>
                {/* Date — calendar picker */}
                <View>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Date *</Text>
                  <TouchableOpacity
                    onPress={() => setShowDatePicker(true)}
                    activeOpacity={0.7}
                    style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                  >
                    <Text style={{ fontSize: 15, color: mtgDate ? colors.foreground : colors.muted }}>
                      {mtgDate ? new Date(mtgDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" }) : "Select a date"}
                    </Text>
                    <Text style={{ fontSize: 18 }}>📅</Text>
                  </TouchableOpacity>
                  {showDatePicker && (
                    <DateTimePicker
                      value={mtgDate ? new Date(mtgDate + "T12:00:00") : new Date()}
                      mode="date"
                      display={Platform.OS === "ios" ? "inline" : "default"}
                      minimumDate={new Date()}
                      onChange={(_, selectedDate) => {
                        if (Platform.OS === "android") setShowDatePicker(false);
                        if (selectedDate) {
                          const y = selectedDate.getFullYear();
                          const m = String(selectedDate.getMonth() + 1).padStart(2, "0");
                          const d = String(selectedDate.getDate()).padStart(2, "0");
                          setMtgDate(`${y}-${m}-${d}`);
                        }
                      }}
                    />
                  )}
                  {showDatePicker && Platform.OS === "ios" && (
                    <TouchableOpacity
                      onPress={() => setShowDatePicker(false)}
                      activeOpacity={0.8}
                      style={{ marginTop: 8, backgroundColor: "#7C3AED", borderRadius: 10, padding: 12, alignItems: "center" }}
                    >
                      <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 15 }}>Done</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {/* Time */}
                <View>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Time * (HH:MM, 24-hour CST)</Text>
                  <TextInput
                    value={mtgTime}
                    onChangeText={setMtgTime}
                    placeholder="09:00"
                    placeholderTextColor={colors.muted}
                    returnKeyType="next"
                    style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 14, fontSize: 15, color: colors.foreground, borderWidth: 1, borderColor: colors.border }}
                  />
                </View>
                {/* Zoom Link */}
                <View>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Zoom Link (Optional)</Text>
                  <TextInput
                    value={mtgZoomLink}
                    onChangeText={setMtgZoomLink}
                    placeholder="https://zoom.us/j/..."
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    keyboardType="url"
                    returnKeyType="done"
                    style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 14, fontSize: 15, color: colors.foreground, borderWidth: 1, borderColor: colors.border }}
                  />
                </View>
                {/* Recurring toggle */}
                <TouchableOpacity
                  onPress={() => setMtgIsRecurring((v) => !v)}
                  activeOpacity={0.7}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surface, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.border }}
                >
                  <Text style={{ fontSize: 15, color: colors.foreground, fontWeight: "600" }}>Recurring Meeting</Text>
                  <View style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: mtgIsRecurring ? "#7C3AED" : colors.border, justifyContent: "center", paddingHorizontal: 2 }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#FFF", alignSelf: mtgIsRecurring ? "flex-end" : "flex-start" }} />
                  </View>
                </TouchableOpacity>
                {mtgIsRecurring && (
                  <View>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Recurring Day</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => (
                        <TouchableOpacity
                          key={day}
                          onPress={() => setMtgRecurringDay(day)}
                          activeOpacity={0.7}
                          style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: mtgRecurringDay === day ? "#7C3AED" : colors.surface, borderWidth: 1, borderColor: mtgRecurringDay === day ? "#7C3AED" : colors.border }}
                        >
                          <Text style={{ color: mtgRecurringDay === day ? "#FFF" : colors.foreground, fontSize: 13, fontWeight: "600" }}>{day.slice(0, 3)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
                <TouchableOpacity
                  onPress={handleSaveMeeting}
                  disabled={savingMeeting || !mtgTitle.trim() || !mtgDate.trim() || !mtgTime.trim()}
                  activeOpacity={0.8}
                  style={{
                    backgroundColor: mtgTitle.trim() && mtgDate.trim() && mtgTime.trim() ? "#7C3AED" : colors.border,
                    borderRadius: 12, paddingVertical: 16, alignItems: "center",
                    opacity: savingMeeting ? 0.7 : 1, marginTop: 8, marginBottom: 40,
                  }}
                >
                  {savingMeeting ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>
                      {editingMeeting ? "Save Changes" : "Schedule Meeting"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </ScreenContainer>
      </Modal>
    </ScreenContainer>
  );
}
