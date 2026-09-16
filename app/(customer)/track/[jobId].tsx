import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Animated,
  Platform,
  ScrollView,
  Modal,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { useCustomerAuth } from "@/lib/customer-context";
import { trpc } from "@/lib/trpc";

// Lazy-load MapView only on native platforms to avoid web crashes
let MapView: any = null;
let Marker: any = null;
let Polyline: any = null;
let PROVIDER_DEFAULT: any = null;
if (Platform.OS !== "web") {
  const maps = require("react-native-maps");
  MapView = maps.default;
  Marker = maps.Marker;
  Polyline = maps.Polyline;
  PROVIDER_DEFAULT = maps.PROVIDER_DEFAULT;
}

// ─── Luxury Wash brand colors ────────────────────────────────────────────────
const BRAND_BLUE = "#0057FF";
const BRAND_DARK = "#0A0A0A";

// ─── Format seconds → "X min" or "X hr Y min" (placeholder, real one below) ──
// (removed client-side OSRM fetch — now using server-side getRoute endpoint)

// ─── Format seconds → "X min" or "X hr Y min" ────────────────────────────────
function formatETA(seconds: number): string {
  if (seconds < 60) return "< 1 min";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs} hr ${rem} min` : `${hrs} hr`;
}

// ─── Pulse animation for the van marker ──────────────────────────────────────
function PulseRing() {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.8, duration: 1200, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0, duration: 1200, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.6, duration: 0, useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View
      style={[
        styles.pulseRing,
        { transform: [{ scale }], opacity },
      ]}
    />
  );
}

// ─── Arrived overlay ─────────────────────────────────────────────────────────
function ArrivedOverlay({ detailerName, onClose }: { detailerName?: string; onClose: () => void }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 6, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.arrivedOverlay, { opacity: fadeAnim }]}>
      <Animated.View style={[styles.arrivedCard, { transform: [{ scale: scaleAnim }] }]}>
        <View style={styles.arrivedIconWrap}>
          <MaterialIcons name="check-circle" size={56} color="#22C55E" />
        </View>
        <Text style={styles.arrivedTitle}>Your Detailer Has Arrived!</Text>
        {detailerName ? (
          <Text style={styles.arrivedSubtitle}>{firstName(detailerName)} is at your location</Text>
        ) : null}
        <Text style={styles.arrivedNote}>
          They will begin your detail shortly. Please ensure your vehicle is accessible.
        </Text>
        <TouchableOpacity style={styles.arrivedBtn} onPress={onClose}>
          <Text style={styles.arrivedBtnText}>Got It</Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

// ─── Chat Modal (job-specific messaging) ────────────────────────────────────
interface ChatMessage {
  id: number;
  bookingRef: string;
  senderType: string;
  senderId: string;
  senderName: string | null;
  message: string;
  createdAt: string | Date;
  readAt: string | Date | null;
}

function TrackChatModal({
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

  const listQuery = trpc.messaging.list.useQuery(
    { bookingRef, limit: 100 },
    { enabled: visible && !!bookingRef, refetchInterval: 30000 }
  );
  const markReadMutation = trpc.messaging.markRead.useMutation();
  const sendMutation = trpc.messaging.send.useMutation({
    onSuccess: () => {
      utils.messaging.list.invalidate({ bookingRef });
    },
  });

  useEffect(() => {
    if (visible && bookingRef) {
      markReadMutation.mutate({ bookingRef, readerType: "customer" });
    }
  }, [visible, bookingRef]);

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

  const messages: ChatMessage[] = listQuery.data?.messages ?? [];
  const windowOpen = listQuery.data?.windowOpen ?? false;

  const renderMessage = ({ item }: { item: ChatMessage }) => {
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
        <View style={chatStyles.header}>
          <View style={chatStyles.headerLeft}>
            <View style={chatStyles.detailerAvatar}>
              <MaterialIcons name="directions-car" size={18} color="#fff" />
            </View>
            <View>
              <Text style={chatStyles.headerTitle}>Your Detailer</Text>
              <Text style={chatStyles.headerSub}>{windowOpen ? "● Active" : "● Chat closed"}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} style={chatStyles.closeBtn} activeOpacity={0.7}>
            <MaterialIcons name="close" size={22} color="#1A1A1A" />
          </TouchableOpacity>
        </View>
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
        <View style={chatStyles.inputBar}>
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

const chatStyles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: Platform.OS === "ios" ? 56 : 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6", backgroundColor: "#fff" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  detailerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#0057FF", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 15, fontWeight: "700", color: "#1A1A1A" },
  headerSub: { fontSize: 12, color: "#6B7280", marginTop: 1 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  msgRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 10 },
  msgRowLeft: { justifyContent: "flex-start" },
  msgRowRight: { justifyContent: "flex-end" },
  avatarCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#6B7280", alignItems: "center", justifyContent: "center", marginRight: 6 },
  bubble: { maxWidth: "72%", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMe: { backgroundColor: "#0057FF", borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: "#F3F4F6", borderBottomLeftRadius: 4 },
  bubbleTextMe: { color: "#fff", fontSize: 14, lineHeight: 20 },
  bubbleTextThem: { color: "#1A1A1A", fontSize: 14, lineHeight: 20 },
  timeText: { fontSize: 10, marginTop: 3 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6", gap: 8 },
  input: { flex: 1, minHeight: 40, maxHeight: 100, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14, color: "#1A1A1A", backgroundColor: "#FAFAFA" },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#0057FF", alignItems: "center", justifyContent: "center" },
  sendBtnDisabled: { backgroundColor: "#D1D5DB" },
});

// ─── Extract first name only ────────────────────────────────────────────────
function firstName(fullName?: string | null): string {
  if (!fullName) return "";
  return fullName.trim().split(/\s+/)[0];
}

// ─── Main tracking screen ─────────────────────────────────────────────────────
export default function CustomerTrackScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { customer } = useCustomerAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const [showArrived, setShowArrived] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const prevArrivedRef = useRef(false);
  // Track whether we've done the initial map fit (only fit once)
  const hasInitialFitRef = useRef(false);
  // Animated coordinate for smooth van marker movement
  const vanCoordRef = useRef<any>(null);

  const customerId = (customer as any)?.id ?? (customer as any)?.customerId ?? "";
  const customerName = [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || "Customer";
  // bookingRef: strip portal_ prefix if present, or use jobId directly
  const bookingRef = (jobId ?? "").replace(/^portal_/, "");

  // Route state — resolved via server-side getRoute (handles geocoding + OSRM)
  const [routeKey, setRouteKey] = useState("");

  // Poll every 5 seconds
  const trackQuery = trpc.location.getByJobId.useQuery(
    { jobId: jobId ?? "" },
    {
      enabled: !!jobId,
      refetchInterval: 30000,
      refetchIntervalInBackground: false,
    }
  );

  const data = trackQuery.data;
  const isLoading = trackQuery.isLoading;
  const arrived = data?.arrived ?? false;
  const token = data?.token;
  const location = data?.location;

  // Detailer coordinates
  const vanLat = location ? parseFloat(String(location.lat)) : null;
  const vanLng = location ? parseFloat(String(location.lng)) : null;
  const hasVanPos = vanLat !== null && vanLng !== null && !isNaN(vanLat) && !isNaN(vanLng);

  // Customer destination coordinates (may be null for old tokens)
  const destLat = token?.customerLat ? parseFloat(String(token.customerLat)) : null;
  const destLng = token?.customerLng ? parseFloat(String(token.customerLng)) : null;
  const hasDestPos = destLat !== null && destLng !== null && !isNaN(destLat) && !isNaN(destLng);
  const customerAddress = token?.customerAddress ?? undefined;

  // Update routeKey when van moves meaningfully (>~11m) to trigger re-fetch
  useEffect(() => {
    if (!hasVanPos || arrived) return;
    const newKey = `${vanLat!.toFixed(4)},${vanLng!.toFixed(4)}`;
    setRouteKey(prev => prev.startsWith(newKey) ? prev : newKey);
  }, [hasVanPos, arrived, vanLat, vanLng]);

  // Server-side route query: geocodes address if needed, fetches OSRM road route
  const routeQuery = trpc.location.getRoute.useQuery(
    {
      fromLat: vanLat ?? 0,
      fromLng: vanLng ?? 0,
      ...(hasDestPos ? { toLat: destLat!, toLng: destLng! } : { toAddress: customerAddress }),
    },
    {
      enabled: hasVanPos && !arrived && (hasDestPos || !!customerAddress),
      staleTime: 30_000,
      refetchInterval: 60_000,
    }
  );
  const routeCoords = routeQuery.data?.coords ?? [];
  const etaSec = routeQuery.data?.durationSec ?? null;
  // Resolved destination from server (used for map fitting when token had no lat/lng)
  const resolvedDestLat = routeQuery.data?.destLat ?? destLat;
  const resolvedDestLng = routeQuery.data?.destLng ?? destLng;
  const hasResolvedDest = resolvedDestLat !== null && resolvedDestLng !== null;

  // Show arrived overlay once when arrived becomes true
  useEffect(() => {
    if (arrived && !prevArrivedRef.current) {
      setShowArrived(true);
    }
    prevArrivedRef.current = arrived;
  }, [arrived]);

  // Initial map fit: only once when we first get both van + destination positions
  useEffect(() => {
    if (!mapRef.current || hasInitialFitRef.current) return;
    if (hasVanPos && hasResolvedDest) {
      hasInitialFitRef.current = true;
      mapRef.current.fitToCoordinates(
        [
          { latitude: vanLat!, longitude: vanLng! },
          { latitude: resolvedDestLat!, longitude: resolvedDestLng! },
        ],
        { edgePadding: { top: 120, right: 80, bottom: 280, left: 80 }, animated: true }
      );
    } else if (hasVanPos) {
      hasInitialFitRef.current = true;
      mapRef.current.animateToRegion({
        latitude: vanLat!,
        longitude: vanLng!,
        latitudeDelta: 0.008,
        longitudeDelta: 0.008,
      }, 600);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVanPos, hasResolvedDest]);

  // Smooth van marker movement on every coordinate update (after initial fit)
  useEffect(() => {
    if (!hasVanPos || !hasInitialFitRef.current) return;
    if (vanCoordRef.current?.animateCoordinate) {
      vanCoordRef.current.animateCoordinate(
        { latitude: vanLat!, longitude: vanLng! },
        500 // 500ms smooth transition
      );
    }
  }, [hasVanPos, vanLat, vanLng]);

  // ── No data / not found ──────────────────────────────────────────────────
  if (!isLoading && !data) {
    return (
      <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-[#0A0A0A]">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Track Your Detailer</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyState}>
          <MaterialIcons name="location-off" size={64} color="#374151" />
          <Text style={styles.emptyTitle}>Tracking Not Available</Text>
          <Text style={styles.emptySubtitle}>
            The detailer hasn't started sharing their location yet. Check back when your appointment is closer.
          </Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.back()}>
            <Text style={styles.emptyBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-[#0A0A0A]">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Track Your Detailer</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color={BRAND_BLUE} />
          <Text style={[styles.emptySubtitle, { marginTop: 16 }]}>Loading tracking data…</Text>
        </View>
      </ScreenContainer>
    );
  }

  // ── Map view ──────────────────────────────────────────────────────────────
  const initialRegion = hasVanPos
    ? { latitude: vanLat!, longitude: vanLng!, latitudeDelta: 0.008, longitudeDelta: 0.008 }
    : hasResolvedDest
    ? { latitude: resolvedDestLat!, longitude: resolvedDestLng!, latitudeDelta: 0.008, longitudeDelta: 0.008 }
    : { latitude: 30.5, longitude: -86.5, latitudeDelta: 0.5, longitudeDelta: 0.5 };

  return (
    <View style={styles.container}>
      {/* Full-screen map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={initialRegion}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {/* Van marker — ref enables animateCoordinate for smooth movement */}
        {hasVanPos && !arrived && (
          <Marker
            ref={vanCoordRef}
            coordinate={{ latitude: vanLat!, longitude: vanLng! }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <Image
              source={{ uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/yNVJZJaaPmkGnGpU.png" }}
              style={styles.vanMarkerImage}
              resizeMode="contain"
            />
          </Marker>
        )}

        {/* Destination marker — use server-resolved coords if token had no lat/lng */}
        {hasResolvedDest && (
          <Marker
            coordinate={{ latitude: resolvedDestLat!, longitude: resolvedDestLng! }}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
          >
            <View style={styles.destMarkerWrap}>
              <View style={styles.destMarkerPin}>
                <MaterialIcons name="home" size={18} color="#FFFFFF" />
              </View>
              <View style={styles.destMarkerStem} />
            </View>
          </Marker>
        )}

        {/* Road-following route polyline (blue) */}
        {routeCoords.length > 1 && !arrived && (
          <Polyline
            coordinates={routeCoords}
            strokeColor={BRAND_BLUE}
            strokeWidth={4}
          />
        )}
        {/* No fallback line — wait for real road route to load */}
      </MapView>

      {/* Top header overlay */}
      <View style={styles.headerOverlay}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtnOverlay}>
          <MaterialIcons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerOverlayCenter}>
          <Text style={styles.headerOverlayTitle}>Track Your Detailer</Text>
        </View>
        {/* Chat button — always show so customer can message detailer */}
        <TouchableOpacity
          onPress={() => setChatOpen(true)}
          style={styles.backBtnOverlay}
          activeOpacity={0.8}
        >
          <MaterialIcons name="chat" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Bottom status card */}
      <View style={[styles.statusCard, Platform.OS === "android" && insets.bottom > 0 ? { paddingBottom: insets.bottom + 20 } : {}]}>
        {arrived ? (
          // Arrived state
          <View style={styles.statusRow}>
            <View style={[styles.statusIconWrap, { backgroundColor: "#D1FAE5" }]}>
              <MaterialIcons name="check-circle" size={28} color="#059669" />
            </View>
            <View style={styles.statusTextWrap}>
              <Text style={styles.statusLabel}>Arrived</Text>
              <Text style={styles.statusSub}>
                {token?.detailerName
                  ? `${firstName(token.detailerName)} is at your location`
                  : "Your detailer is at your location"}
              </Text>
            </View>
          </View>
        ) : (
          // En-route state
          <View style={styles.statusRow}>
            <View style={[styles.statusIconWrap, { backgroundColor: "#DBEAFE" }]}>
              <MaterialIcons name="directions-car" size={28} color={BRAND_BLUE} />
            </View>
            <View style={styles.statusTextWrap}>
              <Text style={styles.statusLabel}>On the Way</Text>
              <Text style={styles.statusSub}>
                {token?.detailerName
                  ? `${firstName(token.detailerName)} is heading to you`
                  : "Your detailer is heading to you"}
              </Text>
            </View>
            <View style={styles.liveChip}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          </View>
        )}

        {/* ETA row */}
        {!arrived && etaSec !== null && (
          <View style={styles.etaRow}>
            <MaterialIcons name="schedule" size={16} color={BRAND_BLUE} />
            <Text style={styles.etaLabel}>Estimated arrival:</Text>
            <Text style={styles.etaValue}>{formatETA(etaSec)}</Text>
          </View>
        )}

        {/* Address row */}
        {token?.customerAddress ? (
          <View style={styles.addressRow}>
            <MaterialIcons name="place" size={16} color="#6B7280" />
            <Text style={styles.addressText} numberOfLines={1}>
              {token.customerAddress}
            </Text>
          </View>
        ) : null}

        {/* Refresh hint */}
        {!arrived && (
          <Text style={styles.refreshHint}>Location updates every 30 seconds</Text>
        )}
      </View>

      {/* Arrived overlay */}
      {showArrived && (
        <ArrivedOverlay
          detailerName={token?.detailerName ?? undefined}
          onClose={() => setShowArrived(false)}
        />
      )}

      {/* Chat modal */}
      <TrackChatModal
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        bookingRef={bookingRef}
        customerId={customerId}
        customerName={customerName}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BRAND_DARK,
  },
  // ── Header (non-map screens) ──────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1E3A5F",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1A1A2E",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  // ── Header overlay on map ────────────────────────────────────────────────
  headerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Platform.OS === "ios" ? 56 : 40,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(10,10,10,0.75)",
  },
  backBtnOverlay: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerOverlayCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerOverlayTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  // ── Van marker ────────────────────────────────────────────────────────────
  vanMarkerWrap: {
    width: 80,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: BRAND_BLUE,
  },
  vanMarkerCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    overflow: "hidden",
    backgroundColor: BRAND_BLUE,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 6,
  },
  vanMarkerImage: {
    width: 120,
    height: 60,
  },
  // ── Destination marker ────────────────────────────────────────────────────
  destMarkerWrap: {
    alignItems: "center",
  },
  destMarkerPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 6,
  },
  destMarkerStem: {
    width: 3,
    height: 10,
    backgroundColor: "#DC2626",
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  // ── Status card ───────────────────────────────────────────────────────────
  statusCard: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 12,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  statusIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  statusTextWrap: {
    flex: 1,
  },
  statusLabel: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
  },
  statusSub: {
    fontSize: 13,
    color: "#6B7280",
    marginTop: 2,
  },
  liveChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEE2E2",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#DC2626",
  },
  // ── ETA row ───────────────────────────────────────────────────────────────
  etaRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginTop: 12,
    backgroundColor: "#EFF6FF",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  etaLabel: {
    fontSize: 13,
    color: "#374151",
    flex: 1,
  },
  etaValue: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: BRAND_BLUE,
  },
  liveText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#DC2626",
    letterSpacing: 0.5,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 14,
    backgroundColor: "#F9FAFB",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  addressText: {
    flex: 1,
    fontSize: 13,
    color: "#374151",
  },
  refreshHint: {
    fontSize: 11,
    color: "#9CA3AF",
    textAlign: "center",
    marginTop: 12,
  },
  // ── Empty / loading states ────────────────────────────────────────────────
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#9CA3AF",
    textAlign: "center",
    lineHeight: 22,
  },
  emptyBtn: {
    backgroundColor: BRAND_BLUE,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
  },
  emptyBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  // ── Arrived overlay ───────────────────────────────────────────────────────
  arrivedOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  arrivedCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 28,
    marginHorizontal: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 16,
  },
  arrivedIconWrap: {
    marginBottom: 16,
  },
  arrivedTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
    marginBottom: 8,
  },
  arrivedSubtitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#059669",
    textAlign: "center",
    marginBottom: 8,
  },
  arrivedNote: {
    fontSize: 13,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  arrivedBtn: {
    backgroundColor: "#059669",
    paddingHorizontal: 36,
    paddingVertical: 14,
    borderRadius: 12,
    width: "100%",
    alignItems: "center",
  },
  arrivedBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
