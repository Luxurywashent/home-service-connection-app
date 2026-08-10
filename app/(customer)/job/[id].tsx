import { useLocalSearchParams, useRouter } from "expo-router";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Image,
  Modal, TextInput, FlatList, KeyboardAvoidingView, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { ScreenContainer } from "@/components/screen-container";
import { useCustomerAuth } from "@/lib/customer-context";
import { trpc } from "@/lib/trpc";
import { MaterialIcons } from "@expo/vector-icons";
import { useState, useRef, useEffect, useCallback } from "react";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  pending:     { label: "Pending",     color: "#D97706", bg: "#FEF3C7", icon: "schedule" },
  confirmed:   { label: "Confirmed",   color: "#059669", bg: "#D1FAE5", icon: "check-circle" },
  en_route:    { label: "On the Way",  color: "#2563EB", bg: "#DBEAFE", icon: "directions-car" },
  on_the_way:  { label: "On the Way",  color: "#2563EB", bg: "#DBEAFE", icon: "directions-car" },
  arrived:     { label: "Arrived",     color: "#7C3AED", bg: "#EDE9FE", icon: "place" },
  in_progress: { label: "In Progress", color: "#0891B2", bg: "#CFFAFE", icon: "autorenew" },
  completed:   { label: "Completed",   color: "#059669", bg: "#D1FAE5", icon: "check-circle" },
  cancelled:   { label: "Cancelled",   color: "#DC2626", bg: "#FEE2E2", icon: "cancel" },
};

const SOURCE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  portal:   { label: "Portal Booking",  color: "#1D4ED8", bg: "#DBEAFE" },
  schedule: { label: "Admin Scheduled", color: "#6D28D9", bg: "#EDE9FE" },
  online:   { label: "Online Booking",  color: "#065F46", bg: "#D1FAE5" },
};

interface Message {
  id: number;
  bookingRef: string;
  senderType: string;
  senderId: string;
  senderName: string | null;
  message: string;
  createdAt: string | Date;
  readAt: string | Date | null;
}

function ChatModal({
  visible,
  onClose,
  bookingRef,
  customerId,
  customerName,
}: {
  visible: boolean;
  onClose: () => void;
  bookingRef: string;
  customerId: string;
  customerName: string;
}) {
  const [text, setText] = useState("");
  const flatRef = useRef<FlatList>(null);
  const utils = trpc.useUtils();
  const insets = useSafeAreaInsets();

  const listQuery = trpc.messaging.list.useQuery(
    { bookingRef, limit: 100 },
    { enabled: visible && !!bookingRef, refetchInterval: 30000 }
  );
  const markReadMutation = trpc.messaging.markRead.useMutation();
  const sendMutation = trpc.messaging.send.useMutation({
    onSuccess: () => {
      utils.messaging.list.invalidate({ bookingRef });
      utils.messaging.unreadCount.invalidate({ bookingRef, readerType: "customer" });
    },
  });

  // Mark messages as read when modal opens
  useEffect(() => {
    if (visible && bookingRef) {
      markReadMutation.mutate({ bookingRef, readerType: "customer" });
    }
  }, [visible, bookingRef]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (listQuery.data?.messages?.length) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [listQuery.data?.messages?.length]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate({
      bookingRef,
      senderType: "customer",
      senderId: customerId,
      senderName: customerName,
      message: trimmed,
    });
    setText("");
  }, [text, bookingRef, customerId, customerName, sendMutation]);

  const messages: Message[] = listQuery.data?.messages ?? [];
  const windowOpen = listQuery.data?.windowOpen ?? false;

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.senderType === "customer";
    const time = new Date(item.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return (
      <View style={[chatStyles.msgRow, isMe ? chatStyles.msgRowRight : chatStyles.msgRowLeft]}>
        {!isMe && (
          <View style={chatStyles.avatarCircle}>
            <MaterialIcons name="person" size={14} color="#fff" />
          </View>
        )}
        <View style={[chatStyles.bubble, isMe ? chatStyles.bubbleMe : chatStyles.bubbleThem]}>
          <Text style={isMe ? chatStyles.bubbleTextMe : chatStyles.bubbleTextThem}>{item.message}</Text>
          <Text style={[chatStyles.timeText, isMe ? { color: "rgba(255,255,255,0.7)" } : { color: "#9CA3AF" }]}>{time}</Text>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: "#fff" }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
      >
        {/* Header */}
        <View style={chatStyles.header}>
          <View style={chatStyles.headerLeft}>
            <View style={chatStyles.detailerAvatar}>
              <MaterialIcons name="directions-car" size={18} color="#fff" />
            </View>
            <View>
              <Text style={chatStyles.headerTitle}>Your Detailer</Text>
              <Text style={chatStyles.headerSub}>
                {windowOpen ? "● Active" : "● Chat closed"}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} style={chatStyles.closeBtn} activeOpacity={0.7}>
            <MaterialIcons name="close" size={22} color="#1A1A1A" />
          </TouchableOpacity>
        </View>

        {/* Messages */}
        {listQuery.isLoading ? (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <ActivityIndicator size="small" color="#1A1A1A" />
          </View>
        ) : messages.length === 0 ? (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32 }}>
            <MaterialIcons name="chat-bubble-outline" size={48} color="#E5E7EB" />
            <Text style={{ marginTop: 12, color: "#9CA3AF", fontSize: 15, textAlign: "center" }}>
              No messages yet.{"\n"}Say hi to your detailer!
            </Text>
          </View>
        ) : (
          <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
            ref={flatRef}
            data={messages}
            keyExtractor={(m) => String(m.id)}
            renderItem={renderMessage}
            contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Input */}
        <View style={[chatStyles.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TextInput
            style={chatStyles.input}
            value={text}
            onChangeText={setText}
            placeholder={windowOpen ? "Message your detailer…" : "Chat is no longer active"}
            placeholderTextColor="#9CA3AF"
            multiline
            maxLength={500}
            editable={windowOpen}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            style={[chatStyles.sendBtn, (!text.trim() || !windowOpen) && chatStyles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim() || !windowOpen || sendMutation.isPending}
            activeOpacity={0.8}
          >
            {sendMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialIcons name="send" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function CustomerJobDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, customer } = useCustomerAuth();
  const [chatOpen, setChatOpen] = useState(false);

  const jobsQuery = trpc.customer.allJobs.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  const job = (jobsQuery.data ?? []).find((j) => j.id === id);

  // Determine booking ref for messaging
  const bookingRef = (job as any)?.bookingRef ?? id ?? "";

  // Check unread count (only when window might be open)
  const messagingStatus = job?.status ?? "";
  const canHaveMessages =
    messagingStatus === "on_the_way" ||
    messagingStatus === "en_route" ||
    messagingStatus === "in_progress" ||
    messagingStatus === "completed";

  const unreadQuery = trpc.messaging.unreadCount.useQuery(
    { bookingRef, readerType: "customer" },
    { enabled: canHaveMessages && !!bookingRef, refetchInterval: 30000 }
  );

  // Check if messaging window is open
  const windowQuery = trpc.messaging.list.useQuery(
    { bookingRef, limit: 1 },
    { enabled: canHaveMessages && !!bookingRef, refetchInterval: 30000 }
  );
  const windowOpen = windowQuery.data?.windowOpen ?? false;
  const unreadCount = unreadQuery.data?.count ?? 0;

  if (jobsQuery.isLoading) {
    return (
      <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
        <ActivityIndicator size="large" color="#1A1A1A" style={{ marginTop: 80 }} />
      </ScreenContainer>
    );
  }

  if (!job) {
    return (
      <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Job Details</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.notFound}>
          <MaterialIcons name="search-off" size={48} color="#E5E7EB" />
          <Text style={styles.notFoundText}>Job not found</Text>
          <TouchableOpacity style={styles.backLink} onPress={() => router.back()} activeOpacity={0.8}>
            <Text style={styles.backLinkText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  const status = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending;
  const source = SOURCE_CONFIG[job.source] ?? SOURCE_CONFIG.portal;
  const addons: string[] = Array.isArray(job.addons) ? job.addons : [];
  const isUpcoming = job.date >= new Date().toISOString().split("T")[0] &&
    job.status !== "completed" && job.status !== "cancelled";

  function handleReBook() {
    const params = new URLSearchParams();
    if (job?.vehicleType) params.set("vehicleType", job.vehicleType);
    if (job?.packageName) params.set("packageName", job.packageName);
    router.push(`/(customer)/book/vehicle?${params.toString()}` as any);
  }

  const streetViewAddr = job.addressLabel || "";
  const googleMapsApiKey = (Constants.expoConfig?.extra?.googleMapsApiKey as string) || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";
  const customerId = (customer as any)?.id ?? (customer as any)?.customerId ?? "";
  const customerName = [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || "Customer";

  return (
    <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
      {/* Street View Hero — shown when address is available */}
      {streetViewAddr ? (
        <View style={{ position: "relative" }}>
          <Image
            source={{ uri: `https://maps.googleapis.com/maps/api/streetview?size=800x400&location=${encodeURIComponent(streetViewAddr)}&fov=90&pitch=10&key=${googleMapsApiKey}` }}
            style={{ width: "100%", height: 220 }}
            resizeMode="cover"
          />
          {/* Back button overlay */}
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ position: "absolute", top: 12, left: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}
            activeOpacity={0.8}
          >
            <MaterialIcons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          {/* Chat button overlay (when window open) */}
          {windowOpen && (
            <TouchableOpacity
              onPress={() => setChatOpen(true)}
              style={{ position: "absolute", top: 12, right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}
              activeOpacity={0.8}
            >
              <MaterialIcons name="chat" size={22} color="#fff" />
              {unreadCount > 0 && (
                <View style={{ position: "absolute", top: 4, right: 4, width: 16, height: 16, borderRadius: 8, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#fff", fontSize: 9, fontWeight: "900" }}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>
      ) : (
        /* Standard header when no address */
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Job Details</Text>
          {windowOpen ? (
            <TouchableOpacity
              onPress={() => setChatOpen(true)}
              style={[styles.chatHeaderBtn]}
              activeOpacity={0.8}
            >
              <MaterialIcons name="chat" size={22} color="#1A1A1A" />
              {unreadCount > 0 && (
                <View style={styles.unreadDot}>
                  <Text style={styles.unreadDotText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>

        {/* Late Arrival ETA Banner */}
        {!!(job as any).lateEta && (
          <View style={{
            backgroundColor: "#FEF3C7",
            borderWidth: 1.5,
            borderColor: "#F59E0B",
            borderRadius: 14,
            padding: 14,
            marginBottom: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}>
            <MaterialIcons name="access-time" size={22} color="#D97706" />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "800", color: "#92400E", marginBottom: 2 }}>
                ⚠️ Your detailer is running late
              </Text>
              <Text style={{ fontSize: 14, color: "#78350F" }}>
                New estimated arrival: <Text style={{ fontWeight: "700" }}>{(job as any).lateEta}</Text>
              </Text>
            </View>
          </View>
        )}

        {/* Messaging Banner — shown when window is open */}
        {windowOpen && (
          <TouchableOpacity
            style={styles.chatBanner}
            onPress={() => setChatOpen(true)}
            activeOpacity={0.85}
          >
            <View style={styles.chatBannerLeft}>
              <MaterialIcons name="chat" size={20} color="#2563EB" />
              <View>
                <Text style={styles.chatBannerTitle}>Message Your Detailer</Text>
                <Text style={styles.chatBannerSub}>Chat is active right now</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
                </View>
              )}
              <MaterialIcons name="chevron-right" size={20} color="#2563EB" />
            </View>
          </TouchableOpacity>
        )}

        {/* Status + Source badges */}
        <View style={styles.badgesRow}>
          <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
            <MaterialIcons name={status.icon as any} size={16} color={status.color} />
            <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
          </View>
          <View style={[styles.sourceBadge, { backgroundColor: source.bg }]}>
            <Text style={[styles.sourceText, { color: source.color }]}>{source.label}</Text>
          </View>
        </View>

        {/* Package name */}
        <Text style={styles.packageName}>{job.packageName || "Detail Service"}</Text>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Detail rows */}
        <DetailRow icon="directions-car" label="Vehicle" value={job.vehicleLabel || job.vehicleType || "—"} />
        <DetailRow icon="event" label="Date" value={formatDate(job.date)} />
        {!!job.time && <DetailRow icon="schedule" label="Time" value={job.time} />}
        {!!job.city && <DetailRow icon="location-city" label="City" value={job.city} />}
        {!!job.addressLabel && <DetailRow icon="place" label="Address" value={job.addressLabel} />}
        {!!job.notes && <DetailRow icon="notes" label="Notes" value={job.notes} />}

        {/* Add-ons */}
        {addons.length > 0 && (
          <View style={styles.addonsSection}>
            <Text style={styles.sectionLabel}>Add-ons</Text>
            <View style={styles.addonsGrid}>
              {addons.map((a: string, idx: number) => (
                <View key={`${a}_${idx}`} style={styles.addonChip}>
                  <MaterialIcons name="check" size={12} color="#059669" />
                  <Text style={styles.addonChipText}>{typeof a === "string" ? a.replace(/_/g, " ") : a}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Total */}
        {job.total > 0 && (
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Total</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {!!(job as any).paymentPaidAt ? (
                <View style={{ backgroundColor: "#22C55E", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>PAID</Text>
                </View>
              ) : (
                <View style={{ backgroundColor: "#FEE2E2", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: "#EF4444", fontSize: 13, fontWeight: "700" }}>UNPAID</Text>
                </View>
              )}
              <Text style={(job as any).paymentPaidAt ? { color: "#22C55E", fontWeight: "900", fontSize: 28 } : { color: "#EF4444", fontWeight: "900", fontSize: 28 }}>
                ${Number((job as any).paymentTotal ?? job.total).toFixed(2)}
              </Text>
            </View>
          </View>
        )}

        {/* Pay with Card on File — shown for unpaid upcoming jobs */}
        {isUpcoming && !(job as any).paymentPaidAt && job.total > 0 && job.status !== "cancelled" && (
          <TouchableOpacity
            style={{ backgroundColor: "#22C55E", borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12 }}
            onPress={() => router.push(`/(customer)/bookings` as any)}
            activeOpacity={0.85}
          >
            <MaterialIcons name="credit-card" size={20} color="#FFFFFF" />
            <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>Pay Now</Text>
          </TouchableOpacity>
        )}

        {/* GPS Tracker for en_route portal bookings */}
        {(job.status === "en_route" || job.status === "on_the_way") && job.source === "portal" && (
          <TouchableOpacity
            style={styles.trackBtn}
            onPress={() => router.push(`/(customer)/track/${job.id}` as any)}
            activeOpacity={0.85}
          >
            <MaterialIcons name="my-location" size={18} color="#FFFFFF" />
            <Text style={styles.trackBtnText}>Track Your Detailer</Text>
          </TouchableOpacity>
        )}

        {/* Re-Book button (for past / completed jobs) */}
        {!isUpcoming && (
          <View style={styles.rebookSection}>
            <Text style={styles.rebookHint}>Loved this service? Book it again!</Text>
            <TouchableOpacity style={styles.rebookBtn} onPress={handleReBook} activeOpacity={0.85}>
              <MaterialIcons name="refresh" size={18} color="#FFFFFF" />
              <Text style={styles.rebookBtnText}>Book Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Book a new service button for upcoming jobs */}
        {isUpcoming && (
          <TouchableOpacity
            style={styles.newBookingBtn}
            onPress={() => router.push("/(customer)/book/vehicle" as any)}
            activeOpacity={0.85}
          >
            <MaterialIcons name="add" size={18} color="#1A1A1A" />
            <Text style={styles.newBookingBtnText}>Book Another Service</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Chat Modal */}
      {chatOpen && (
        <ChatModal
          visible={chatOpen}
          onClose={() => setChatOpen(false)}
          bookingRef={bookingRef}
          customerId={customerId}
          customerName={customerName}
        />
      )}
    </ScreenContainer>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIconWrap}>
        <MaterialIcons name={icon as any} size={18} color="#6B7280" />
      </View>
      <View style={styles.detailContent}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: "#F0F0F0",
  },
  backBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#1A1A1A" },
  chatHeaderBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center", position: "relative" },
  unreadDot: { position: "absolute", top: 4, right: 4, width: 16, height: 16, borderRadius: 8, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center" },
  unreadDotText: { color: "#fff", fontSize: 9, fontWeight: "900" },

  notFound: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  notFoundText: { fontSize: 16, color: "#9CA3AF", fontWeight: "500" },
  backLink: { backgroundColor: "#1A1A1A", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 100, marginTop: 8 },
  backLinkText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },

  chatBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#EFF6FF", borderWidth: 1.5, borderColor: "#BFDBFE",
    borderRadius: 14, padding: 14, marginBottom: 16,
  },
  chatBannerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  chatBannerTitle: { fontSize: 14, fontWeight: "700", color: "#1E40AF" },
  chatBannerSub: { fontSize: 12, color: "#3B82F6", marginTop: 1 },
  unreadBadge: { backgroundColor: "#EF4444", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  unreadBadgeText: { color: "#fff", fontSize: 11, fontWeight: "900" },

  badgesRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100 },
  statusText: { fontSize: 13, fontWeight: "700" },
  sourceBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100 },
  sourceText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },

  packageName: { fontSize: 26, fontWeight: "900", color: "#1A1A1A", marginBottom: 16 },
  divider: { height: 1, backgroundColor: "#F0F0F0", marginBottom: 20 },

  detailRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 16 },
  detailIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F5F5F5", justifyContent: "center", alignItems: "center", marginRight: 12 },
  detailContent: { flex: 1 },
  detailLabel: { fontSize: 12, fontWeight: "600", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  detailValue: { fontSize: 15, fontWeight: "600", color: "#1A1A1A" },

  addonsSection: { marginTop: 4, marginBottom: 16 },
  sectionLabel: { fontSize: 12, fontWeight: "600", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  addonsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  addonChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100 },
  addonChipText: { fontSize: 13, color: "#065F46", fontWeight: "600", textTransform: "capitalize" },

  totalCard: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "#F9FAFB", borderRadius: 14, padding: 18,
    borderWidth: 1, borderColor: "#E5E7EB", marginTop: 8, marginBottom: 20,
  },
  totalLabel: { fontSize: 16, color: "#6B7280", fontWeight: "600" },
  totalAmount: { fontSize: 28, fontWeight: "900", color: "#1A1A1A" },

  trackBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#2563EB", borderRadius: 14, paddingVertical: 16, marginBottom: 16,
  },
  trackBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },

  rebookSection: { alignItems: "center", marginTop: 8 },
  rebookHint: { fontSize: 14, color: "#9CA3AF", marginBottom: 12 },
  rebookBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#1A1A1A", borderRadius: 100, paddingHorizontal: 28, paddingVertical: 14,
  },
  rebookBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },

  newBookingBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderWidth: 1.5, borderColor: "#1A1A1A", borderRadius: 100, paddingVertical: 14, marginTop: 8,
  },
  newBookingBtnText: { fontSize: 15, fontWeight: "700", color: "#1A1A1A" },
});

const chatStyles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: Platform.OS === "ios" ? 16 : 12, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: "#F0F0F0",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  detailerAvatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "#1A1A1A",
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 16, fontWeight: "800", color: "#1A1A1A" },
  headerSub: { fontSize: 12, color: "#22C55E", marginTop: 1 },
  closeBtn: { width: 36, height: 36, justifyContent: "center", alignItems: "center" },

  msgRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 12 },
  msgRowLeft: { justifyContent: "flex-start" },
  msgRowRight: { justifyContent: "flex-end" },
  avatarCircle: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: "#6B7280",
    alignItems: "center", justifyContent: "center", marginRight: 8, marginBottom: 2,
  },
  bubble: {
    maxWidth: "75%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10,
  },
  bubbleMe: { backgroundColor: "#1A1A1A", borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: "#F3F4F6", borderBottomLeftRadius: 4 },
  bubbleTextMe: { fontSize: 15, color: "#fff", lineHeight: 21 },
  bubbleTextThem: { fontSize: 15, color: "#1A1A1A", lineHeight: 21 },
  timeText: { fontSize: 10, marginTop: 4, textAlign: "right" },

  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: "#F0F0F0",
    backgroundColor: "#fff",
  },
  input: {
    flex: 1, minHeight: 42, maxHeight: 120,
    backgroundColor: "#F3F4F6", borderRadius: 21,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, color: "#1A1A1A",
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: "#1A1A1A", alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: "#D1D5DB" },
});
