import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { getApiBaseUrl } from "@/constants/oauth";
import {
  View, Text, FlatList, TouchableOpacity, TextInput, KeyboardAvoidingView,
  Platform, ActivityIndicator, Alert, Modal, ScrollView, Switch, RefreshControl,
  StyleSheet, Dimensions, Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { MaterialIcons } from "@expo/vector-icons";
// WebView removed — using ScrollView+Text to avoid native module crash in Expo Go
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";

// ─── Types ────────────────────────────────────────────────────────────────────
interface PhoneLine {
  id: number;
  line_name: string;
  phone_number: string;
  twilio_sid: string | null;
  color: string;
  ai_receptionist_enabled: number;
  forward_to_employees: number;
  is_active: number;
}

interface InboxItem {
  id: number;
  line_id: number;
  from_number: string;
  to_number: string;
  body: string;
  direction: "inbound" | "outbound";
  created_at: string;
  line_name: string;
  line_color: string;
  unread_count: number;
}

interface Message {
  id: number;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  body: string;
  created_at: string;
  sent_by_name: string | null;
}

interface CallLog {
  id: number;
  line_id: number;
  caller_number: string;
  duration_seconds: number;
  call_status: string;
  answered_by_employee_id: string | null;
  answered_by_name: string | null;
  recording_url: string | null;
  created_at: string;
  line_name: string;
  line_color: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatPhone(num: string) {
  const d = num.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return num;
}

function timeAgo(dateStr: string | null | undefined) {
  if (!dateStr) return "";
  const ts = new Date(dateStr).getTime();
  if (isNaN(ts)) return "";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDuration(secs: number) {
  if (!secs) return "0:00";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function callStatusIcon(status: string) {
  switch (status) {
    case "completed": return "✅";
    case "no-answer": return "📵";
    case "busy": return "🔴";
    case "failed": return "❌";
    default: return "📞";
  }
}

// ─── SMS Thread View ──────────────────────────────────────────────────────────
function ThreadView({
  contactNumber, lineId, lineName, lineColor, onBack, employeeId, colors,
}: {
  contactNumber: string; lineId: number; lineName: string; lineColor: string;
  onBack: () => void; employeeId: string; colors: ReturnType<typeof useColors>;
}) {
  const [messageText, setMessageText] = useState("");
  const flatListRef = useRef<FlatList>(null);

  const { data: messages = [], refetch, isLoading } = trpc.phone.getThread.useQuery(
    { contactNumber, lineId },
    { refetchInterval: 30000 }
  );

  const sendMutation = trpc.phone.sendSms.useMutation({
    onSuccess: () => { setMessageText(""); refetch(); },
    onError: (e) => Alert.alert("Send Failed", e.message),
  });

  const handleSend = useCallback(() => {
    const body = messageText.trim();
    if (!body) return;
    sendMutation.mutate({ lineId, toNumber: contactNumber, body, employeeId });
  }, [messageText, lineId, contactNumber, employeeId]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      {/* Header */}
      <View style={[styles.threadHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={{ color: colors.primary, fontSize: 16 }}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={[styles.threadContact, { color: colors.foreground }]}>{formatPhone(contactNumber)}</Text>
          <View style={styles.lineTag}>
            <View style={[styles.lineDot, { backgroundColor: lineColor }]} />
            <Text style={[styles.lineTagText, { color: colors.muted }]}>{lineName}</Text>
          </View>
        </View>
      </View>

      {/* Messages */}
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          ref={flatListRef}
          data={messages as Message[]}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const isOut = item.direction === "outbound";
            return (
              <View style={[styles.bubbleRow, isOut ? styles.bubbleRowOut : styles.bubbleRowIn]}>
                <View style={[styles.bubble, isOut ? [styles.bubbleOut, { backgroundColor: lineColor }] : [styles.bubbleIn, { backgroundColor: colors.surface }]]}>
                  <Text style={[styles.bubbleText, { color: isOut ? "#fff" : colors.foreground }]}>{item.body}</Text>
                  <Text style={[styles.bubbleMeta, { color: isOut ? "rgba(255,255,255,0.7)" : colors.muted }]}>
                    {isOut && item.sent_by_name ? `${item.sent_by_name} · ` : ""}{timeAgo(item.created_at)}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Input */}
      <View style={[styles.inputRow, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <TextInput
          style={[styles.messageInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
          value={messageText}
          onChangeText={setMessageText}
          placeholder="Type a message..."
          placeholderTextColor={colors.muted}
          multiline
          returnKeyType="default"
        />
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: lineColor, opacity: sendMutation.isPending ? 0.6 : 1 }]}
          onPress={handleSend}
          disabled={sendMutation.isPending}
        >
          {sendMutation.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>↑</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminCommunicationsScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const employeeId = employee?.employeeId ?? "admin";

  const params = useLocalSearchParams<{ tab?: string; customerId?: string }>();
  const [activeTab, setActiveTab] = useState<"messages" | "calls" | "emails" | "portal">(
    (params.tab as any) === "portal" ? "portal" : "messages"
  );
  const [selectedPortalCustomerId, setSelectedPortalCustomerId] = useState<string | null>(
    params.customerId ?? null
  );
  const [portalReplyText, setPortalReplyText] = useState("");
  const [portalUploading, setPortalUploading] = useState(false);
  const portalFlatListRef = useRef<FlatList>(null);
  // Compose new portal message
  const [composeModalVisible, setComposeModalVisible] = useState(false);
  const [composeSearch, setComposeSearch] = useState("");
  const [composeText, setComposeText] = useState("");
  const [composeSelectedCustomer, setComposeSelectedCustomer] = useState<{ customerId: string; name: string; phone: string; email: string } | null>(null);
  const [emailSearch, setEmailSearch] = useState("");
  const [portalSearch, setPortalSearch] = useState("");
  const [selectedEmailLog, setSelectedEmailLog] = useState<{ subject: string; to: string; customerName?: string | null; sentAt?: Date | null; body?: string | null; type?: string } | null>(null);
  const [showMissedOnly, setShowMissedOnly] = useState(false);
  const [selectedLineFilter, setSelectedLineFilter] = useState<number | undefined>(undefined);
  const [selectedThread, setSelectedThread] = useState<{ contactNumber: string; lineId: number; lineName: string; lineColor: string } | null>(null);
  const [playingRecordingId, setPlayingRecordingId] = useState<number | null>(null);
  const [speakerOn, setSpeakerOn] = useState(true);
  const audioPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  // Set up audio mode for playback in silent mode (speaker by default)
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldRouteThroughEarpiece: false }).catch(() => {});
    return () => {
      audioPlayerRef.current?.remove();
    };
  }, []);
  const handleToggleSpeaker = useCallback(async () => {
    const newSpeaker = !speakerOn;
    setSpeakerOn(newSpeaker);
    await setAudioModeAsync({ playsInSilentMode: true, shouldRouteThroughEarpiece: !newSpeaker }).catch(() => {});
  }, [speakerOn]);

  const handlePlayRecording = useCallback(async (item: CallLog) => {
    if (!item.recording_url) return;
    // Stop current playback if same item
    if (playingRecordingId === item.id) {
      audioPlayerRef.current?.pause();
      setPlayingRecordingId(null);
      return;
    }
    // Stop any existing player
    audioPlayerRef.current?.remove();
    audioPlayerRef.current = null;
    setPlayingRecordingId(item.id);
    try {
      const apiBase = getApiBaseUrl();
      const proxyUrl = `${apiBase}/api/phone/recording-proxy?url=${encodeURIComponent(item.recording_url)}`;
      const player = createAudioPlayer({ uri: proxyUrl });
      audioPlayerRef.current = player;
      player.play();
      // Auto-clear playing state when done
      const checkDone = setInterval(() => {
        if (player.currentTime > 0 && !player.playing) {
          setPlayingRecordingId(null);
          clearInterval(checkDone);
        }
      }, 500);
    } catch (err) {
      console.error("[Recording] Playback error:", err);
      setPlayingRecordingId(null);
    }
  }, [playingRecordingId]);

  const { data: lines = [] } = trpc.phone.listLines.useQuery(undefined, { refetchInterval: 30000 });
  const { data: inbox = [], refetch: refetchInbox, isLoading: inboxLoading } = trpc.phone.getInbox.useQuery(
    { lineId: selectedLineFilter, limit: 50 },
    { refetchInterval: 60000 }
  );
  const { data: callLogs = [], refetch: refetchCalls, isLoading: callsLoading } = trpc.phone.getCallLogs.useQuery(
    { lineId: selectedLineFilter, limit: 50 },
    { enabled: activeTab === "calls", refetchInterval: activeTab === "calls" ? 15000 : false }
  );
  const { data: emailLogs = [], refetch: refetchEmails, isLoading: emailsLoading } = trpc.emailLogs.list.useQuery(
    { limit: 200 },
    { enabled: activeTab === "emails" }
  );
  const filteredEmailLogs = useMemo(() => {
    const q = emailSearch.toLowerCase();
    if (!q) return emailLogs;
    return emailLogs.filter((log) =>
      log.to.toLowerCase().includes(q) ||
      (log.customerName ?? "").toLowerCase().includes(q) ||
      (log.bookingRef ?? "").toLowerCase().includes(q) ||
      log.subject.toLowerCase().includes(q)
    );
  }, [emailLogs, emailSearch]);

  const { data: unreadData } = trpc.phone.getUnreadCount.useQuery(undefined, { refetchInterval: 30000 });
  const { data: portalUnreadData, refetch: refetchPortalUnread } = trpc.portalInbox.unreadCount.useQuery(undefined, { refetchInterval: 30000 });
// @ts-ignore
  const portalUnreadCount = portalUnreadData?.count ?? 0;
// @ts-ignore
  const markAllPortalReadMutation = trpc.portalInbox.markAllRead?.useMutation({
    onSuccess: () => refetchPortalUnread(),
  });
  const { data: portalThreads = [], refetch: refetchPortalThreads, isLoading: portalThreadsLoading } = trpc.portalInbox.listThreads.useQuery(
    undefined,
    { enabled: activeTab === "portal" || !!selectedPortalCustomerId, refetchInterval: activeTab === "portal" ? 20000 : false }
  );
  const { data: portalThread = [], refetch: refetchPortalThread, isLoading: portalThreadLoading } = trpc.portalInbox.getThread.useQuery(
    { customerId: selectedPortalCustomerId ?? "" },
    { enabled: !!selectedPortalCustomerId, refetchInterval: selectedPortalCustomerId ? 15000 : false }
  );
  const portalReplyMutation = trpc.portalInbox.reply.useMutation({
    onSuccess: () => { setPortalReplyText(""); refetchPortalThread(); setTimeout(() => portalFlatListRef.current?.scrollToEnd({ animated: true }), 200); },
    onError: (e: any) => Alert.alert("Send Failed", e.message),
  });
  // Customer search for compose modal
  const { data: allCustomers = [] } = trpc.customers.listAll.useQuery(
    { search: composeSearch },
    { enabled: composeModalVisible && composeSearch.length >= 2, staleTime: 5000 }
  );
  const composeSendMutation = trpc.portalInbox.reply.useMutation({
    onSuccess: () => {
      setComposeModalVisible(false);
      setComposeSearch("");
      setComposeText("");
      setComposeSelectedCustomer(null);
      refetchPortalThreads();
      // Open the thread we just started
      if (composeSelectedCustomer) {
        setSelectedPortalCustomerId(composeSelectedCustomer.customerId);
      }
    },
    onError: (e: any) => Alert.alert("Send Failed", e.message),
  });
  const [lastCallsViewedAt, setLastCallsViewedAt] = useState<string | null>(null);
  const selectedPortalCustomer = (portalThreads as any[]).find((t: any) => String(t.customerId) === String(selectedPortalCustomerId)) ?? null;

  const filteredPortalThreads = useMemo(() => {
    const q = portalSearch.toLowerCase().trim();
    if (!q) return portalThreads as any[];
    const qDigits = q.replace(/\D/g, '');
    return (portalThreads as any[]).filter((t: any) =>
      (t.customerName ?? '').toLowerCase().includes(q) ||
      (qDigits.length > 0 && (t.phone ?? '').replace(/\D/g, '').includes(qDigits)) ||
      (t.email ?? '').toLowerCase().includes(q) ||
      (t.city ?? '').toLowerCase().includes(q)
    );
  }, [portalThreads, portalSearch]);

  const filteredCallLogs = useMemo(() => {
    const logs = callLogs as CallLog[];
    if (showMissedOnly) return logs.filter(l => l.call_status === "no-answer" || l.call_status === "busy");
    return logs;
  }, [callLogs, showMissedOnly]);

  // Deep-link: if params change (e.g. navigated from dashboard banner), switch to portal tab and open thread
  useEffect(() => {
    if (params.tab === "portal" && params.customerId) {
      setActiveTab("portal");
      setSelectedPortalCustomerId(params.customerId);
    }
  }, [params.tab, params.customerId]);
  const { data: missedCallData } = trpc.phone.getMissedCallCount.useQuery(
    { since: lastCallsViewedAt ?? undefined },
    { refetchInterval: 30000 }
  );
  const missedCallCount = missedCallData?.count ?? 0;

  // Load last-viewed timestamp from storage on mount
  useEffect(() => {
    AsyncStorage.getItem("calls_last_viewed_at").then((val) => {
      if (val) setLastCallsViewedAt(val);
    });
  }, []);

  // When user switches to calls tab, mark as seen
  useEffect(() => {
    if (activeTab === "calls") {
      const now = new Date().toISOString();
      setLastCallsViewedAt(now);
      AsyncStorage.setItem("calls_last_viewed_at", now);
    }
  }, [activeTab]);

  const unreadCount = unreadData?.count ?? 0;

  // If a thread is selected, show the thread view
  if (selectedThread) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <ThreadView
          contactNumber={selectedThread.contactNumber}
          lineId={selectedThread.lineId}
          lineName={selectedThread.lineName}
          lineColor={selectedThread.lineColor}
          onBack={() => { setSelectedThread(null); refetchInbox(); }}
          employeeId={employeeId}
          colors={colors}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["left", "right"]}>
      {/* Tab Bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[{ backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.border, flexGrow: 0 }]}>
        <View style={{ flexDirection: "row" }}>
          {(["messages", "calls", "emails", "portal"] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabItem, activeTab === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
              onPress={() => {
                setActiveTab(tab);
                if (tab === "portal" && portalUnreadCount > 0) {
                  markAllPortalReadMutation.mutate();
                }
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={[styles.tabText, { color: activeTab === tab ? colors.primary : colors.muted }]}>
                  {tab === "messages" ? `Messages${unreadCount > 0 ? ` (${unreadCount})` : ""}` : tab === "calls" ? `Call Log${missedCallCount > 0 && activeTab !== "calls" ? ` (${missedCallCount})` : ""}` : tab === "portal" ? `Portal${portalUnreadCount > 0 ? ` (${portalUnreadCount})` : ""}` : "Emails"}
                </Text>
                {tab === "calls" && missedCallCount > 0 && activeTab !== "calls" && (
                  <View style={{ backgroundColor: colors.error, borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
                    <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{missedCallCount > 99 ? "99+" : missedCallCount}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Line filter chips — only shown when lines are loaded and on messages/calls tab */}
      {(activeTab === "messages" || activeTab === "calls") && lines.length > 0 && (
        <View style={{ backgroundColor: colors.background, borderBottomWidth: 0.5, borderBottomColor: colors.border, flexGrow: 0 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, gap: 8 }}>
            <TouchableOpacity
              style={[styles.lineFilterChip, { backgroundColor: selectedLineFilter === undefined ? colors.primary : colors.surface, borderColor: colors.border }]}
              onPress={() => setSelectedLineFilter(undefined)}
            >
              <Text style={{ color: selectedLineFilter === undefined ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "600" }}>All Lines</Text>
            </TouchableOpacity>
            {(lines as PhoneLine[]).map((line) => (
              <TouchableOpacity
                key={line.id}
                style={[styles.lineFilterChip, { backgroundColor: selectedLineFilter === line.id ? line.color : colors.surface, borderColor: line.color }]}
                onPress={() => setSelectedLineFilter(selectedLineFilter === line.id ? undefined : line.id)}
              >
                <View style={[styles.lineDot, { backgroundColor: line.color }]} />
                <Text style={{ color: selectedLineFilter === line.id ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "500" }}>{line.line_name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      {/* Missed filter — shown on calls tab */}
      {activeTab === "calls" && (
        <View style={{ backgroundColor: colors.background, borderBottomWidth: 0.5, borderBottomColor: colors.border, flexGrow: 0 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
            <TouchableOpacity
              style={[styles.lineFilterChip, { backgroundColor: !showMissedOnly ? colors.primary : colors.surface, borderColor: colors.border }]}
              onPress={() => setShowMissedOnly(false)}
            >
              <Text style={{ color: !showMissedOnly ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "600" }}>All Calls</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.lineFilterChip, { backgroundColor: showMissedOnly ? colors.error : colors.surface, borderColor: showMissedOnly ? colors.error : colors.border }]}
              onPress={() => setShowMissedOnly(true)}
            >
              <Text style={{ color: showMissedOnly ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "600" }}>📵 Missed</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {/* Messages Tab */}
      {activeTab === "messages" && (
        <View style={{ flex: 1 }}>
          {inboxLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
          ) : (inbox as InboxItem[]).length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={{ fontSize: 40 }}>💬</Text>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Messages Yet</Text>
              <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
                {lines.length === 0
                  ? "Add your phone lines in the Receptionist tab to get started."
                  : "Messages from your Twilio numbers will appear here."}
              </Text>
            </View>
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={inbox as InboxItem[]}
              keyExtractor={(item) => `${item.line_id}-${item.from_number}`}
              refreshControl={<RefreshControl refreshing={inboxLoading} onRefresh={refetchInbox} tintColor={colors.primary} />}
              renderItem={({ item }) => {
                const isInbound = item.direction === "inbound";
                const contactNum = isInbound ? item.from_number : item.to_number;
                return (
                  <TouchableOpacity
                    style={[styles.inboxRow, { borderBottomColor: colors.border }]}
                    onPress={() => setSelectedThread({ contactNumber: contactNum, lineId: item.line_id, lineName: item.line_name, lineColor: item.line_color })}
                  >
                    {/* Avatar */}
                    <View style={[styles.avatar, { backgroundColor: item.line_color + "22" }]}>
                      <Text style={{ fontSize: 18 }}>💬</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={styles.inboxRowTop}>
                        <Text style={[styles.inboxContact, { color: colors.foreground }]}>{formatPhone(contactNum)}</Text>
                        <Text style={[styles.inboxTime, { color: colors.muted }]}>{timeAgo(item.created_at)}</Text>
                      </View>
                      <View style={styles.inboxRowMid}>
                        <View style={[styles.lineTag, { marginRight: 6 }]}>
                          <View style={[styles.lineDot, { backgroundColor: item.line_color }]} />
                          <Text style={[styles.lineTagText, { color: item.line_color }]}>{item.line_name}</Text>
                        </View>
                        {item.unread_count > 0 && (
                          <View style={[styles.unreadDot, { backgroundColor: colors.primary }]}>
                            <Text style={styles.unreadDotText}>{item.unread_count}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.inboxPreview, { color: colors.muted }]} numberOfLines={1}>
                        {isInbound ? "" : "You: "}{item.body}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      )}

      {/* Call Log Tab */}
      {activeTab === "calls" && (
        <View style={{ flex: 1 }}>
          {callsLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
          ) : filteredCallLogs.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={{ fontSize: 40 }}>📞</Text>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Calls Yet</Text>
              <Text style={[styles.emptySubtitle, { color: colors.muted }]}>Inbound and outbound calls will be logged here.</Text>
            </View>
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={filteredCallLogs}
              keyExtractor={(item) => String(item.id)}
              refreshControl={<RefreshControl refreshing={callsLoading} onRefresh={refetchCalls} tintColor={colors.primary} />}
              renderItem={({ item }) => (
                <View style={[styles.callRow, { borderBottomColor: colors.border }]}>
                  <View style={[styles.callIcon, { backgroundColor: item.line_color + "22" }]}>
                    <Text style={{ fontSize: 20 }}>{callStatusIcon(item.call_status)}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={styles.inboxRowTop}>
                      <Text style={[styles.inboxContact, { color: colors.foreground }]}>{formatPhone(item.caller_number)}</Text>
                      <Text style={[styles.inboxTime, { color: colors.muted }]}>{timeAgo(item.created_at)}</Text>
                    </View>
                    <View style={styles.callMeta}>
                      <View style={[styles.lineTag, { marginRight: 8 }]}>
                        <View style={[styles.lineDot, { backgroundColor: item.line_color }]} />
                        <Text style={[styles.lineTagText, { color: item.line_color }]}>{item.line_name}</Text>
                      </View>
                      <Text style={[styles.callDuration, { color: colors.muted }]}>
                        {formatDuration(item.duration_seconds)}
                        {item.answered_by_name ? ` · 👤 ${item.answered_by_name}` : item.call_status === "no-answer" ? " · No answer" : ""}
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                      {item.recording_url ? (
                        <>
                          <TouchableOpacity
                            onPress={() => handlePlayRecording(item)}
                            activeOpacity={0.7}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 6,
                              backgroundColor: playingRecordingId === item.id ? colors.primary + "22" : colors.surface,
                              borderRadius: 8,
                              paddingHorizontal: 10,
                              paddingVertical: 5,
                              borderWidth: 1,
                              borderColor: playingRecordingId === item.id ? colors.primary : colors.border,
                            }}
                          >
                            <Text style={{ fontSize: 13 }}>{playingRecordingId === item.id ? "⏸" : "▶"}</Text>
                            <Text style={{ fontSize: 12, fontWeight: "600", color: playingRecordingId === item.id ? colors.primary : colors.muted }}>
                              {playingRecordingId === item.id ? "Playing..." : "Play Recording"}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={handleToggleSpeaker}
                            activeOpacity={0.7}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 4,
                              backgroundColor: speakerOn ? colors.primary + "22" : colors.surface,
                              borderRadius: 8,
                              paddingHorizontal: 10,
                              paddingVertical: 5,
                              borderWidth: 1,
                              borderColor: speakerOn ? colors.primary : colors.border,
                            }}
                          >
                            <Text style={{ fontSize: 13 }}>{speakerOn ? "🔊" : "🔈"}</Text>
                            <Text style={{ fontSize: 12, fontWeight: "600", color: speakerOn ? colors.primary : colors.muted }}>
                              {speakerOn ? "Speaker" : "Earpiece"}
                            </Text>
                          </TouchableOpacity>
                        </>
                      ) : null}
                      {(item.call_status === "no-answer" || item.call_status === "busy") && (
                        <TouchableOpacity
                          onPress={() => Linking.openURL(`tel:${item.caller_number}`)}
                          activeOpacity={0.7}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                            backgroundColor: colors.success + "22",
                            borderRadius: 8,
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderWidth: 1,
                            borderColor: colors.success,
                          }}
                        >
                          <Text style={{ fontSize: 13 }}>📞</Text>
                          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.success }}>Call Back</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              )}
            />
          )}
        </View>
      )}

      {/* Emails Tab */}
      {activeTab === "emails" && (
        <View style={{ flex: 1 }}>
          {/* Search */}
          <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
            <TextInput
              value={emailSearch}
              onChangeText={setEmailSearch}
              placeholder="Search by name, email, or subject..."
              placeholderTextColor={colors.muted}
              style={{
                backgroundColor: colors.surface,
                color: colors.foreground,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 9,
                fontSize: 14,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            />
          </View>

          {/* Stats row */}
          <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingVertical: 10, gap: 10, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
            <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "700" }}>{emailLogs.length}</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Total Sent</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.primary, fontSize: 20, fontWeight: "700" }}>{emailLogs.filter((l) => l.type === "booking_confirmation").length}</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Bookings</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.warning, fontSize: 20, fontWeight: "700" }}>{emailLogs.filter((l) => l.type === "notification").length}</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Alerts</Text>
            </View>
          </View>

          {emailsLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
          ) : filteredEmailLogs.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={{ fontSize: 40 }}>✉️</Text>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                {emailSearch ? "No emails match your search." : "No emails sent yet."}
              </Text>
            </View>
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={filteredEmailLogs}
              keyExtractor={(item) => item.logId}
              refreshControl={<RefreshControl refreshing={emailsLoading} onRefresh={refetchEmails} tintColor={colors.primary} />}
              contentContainerStyle={{ paddingBottom: 32 }}
              renderItem={({ item }) => {
                const typeColor = item.type === "booking_confirmation" ? colors.primary : item.type === "notification" ? colors.warning : item.type === "review_request" ? colors.success : colors.muted;
                const typeLabel = item.type === "booking_confirmation" ? "Booking" : item.type === "notification" ? "Notification" : item.type === "review_request" ? "Review" : "Other";
                const sentDate = item.sentAt ? new Date(item.sentAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "—";
                return (
                  <TouchableOpacity
                    activeOpacity={0.75}
                    onPress={() => setSelectedEmailLog(item)}
                    style={{ paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: colors.border, borderLeftWidth: 3, borderLeftColor: item.status === "failed" ? colors.error : typeColor }}
                  >
                    {/* Row 1: badges + date */}
                    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
                      <View style={{ backgroundColor: typeColor + "22", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 }}>
                        <Text style={{ color: typeColor, fontSize: 11, fontWeight: "700" }}>{typeLabel}</Text>
                      </View>
                      {item.status === "failed" && (
                        <View style={{ backgroundColor: colors.error + "22", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 }}>
                          <Text style={{ color: colors.error, fontSize: 11, fontWeight: "700" }}>Failed</Text>
                        </View>
                      )}
                      <Text style={{ color: colors.muted, fontSize: 11, flex: 1, textAlign: "right" }}>{sentDate}</Text>
                    </View>
                    {/* Row 2: Customer name */}
                    {item.customerName ? (
                      <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700", marginBottom: 2 }}>{item.customerName}</Text>
                    ) : null}
                    {/* Row 3: To address */}
                    <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 6 }} numberOfLines={1}>{item.to}</Text>
                    {/* Row 4: Subject */}
                    <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }} numberOfLines={2}>{item.subject}</Text>
                    {/* Row 5: Booking ref */}
                    {item.bookingRef ? (
                      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>Ref: {item.bookingRef}</Text>
                    ) : null}
                    {/* Tap hint */}
                    <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>Tap to view email ›</Text>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      )}

      {/* Portal Messages Tab */}
      {activeTab === "portal" && !selectedPortalCustomerId && (
        <View style={{ flex: 1 }}>
          {/* Search bar + Compose button */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, height: 38 }}>
              <Text style={{ color: colors.muted, fontSize: 15, marginRight: 6 }}>🔍</Text>
              <TextInput
                value={portalSearch}
                onChangeText={setPortalSearch}
                placeholder="Search by name, phone, or city…"
                placeholderTextColor={colors.muted}
                style={{ flex: 1, color: colors.foreground, fontSize: 14 }}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>
            <TouchableOpacity
              onPress={() => { setComposeSearch(""); setComposeText(""); setComposeSelectedCustomer(null); setComposeModalVisible(true); }}
              style={{ backgroundColor: colors.primary, borderRadius: 10, width: 38, height: 38, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700", lineHeight: 24 }}>✏️</Text>
            </TouchableOpacity>
          </View>
          {portalThreadsLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
          ) : filteredPortalThreads.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={{ fontSize: 40 }}>💬</Text>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{portalSearch ? "No results" : "No Portal Messages"}</Text>
              <Text style={[styles.emptySubtitle, { color: colors.muted }]}>{portalSearch ? `No threads match "${portalSearch}"` : "When customers message you from their portal, threads will appear here."}</Text>
            </View>
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={filteredPortalThreads}
              keyExtractor={(item) => String(item.customerId)}
              refreshControl={<RefreshControl refreshing={portalThreadsLoading} onRefresh={refetchPortalThreads} tintColor={colors.primary} />}
              renderItem={({ item }) => {
                const hasUnread = item.unreadCount > 0;
                return (
                  <TouchableOpacity
                    style={[styles.inboxRow, { borderBottomColor: colors.border, paddingLeft: 0 }]}
                    onPress={() => setSelectedPortalCustomerId(String(item.customerId))}
                  >
                    {/* Blue left accent bar for unread */}
                    <View style={{ width: 4, alignSelf: "stretch", backgroundColor: hasUnread ? colors.primary : "transparent", borderRadius: 2, marginRight: 12 }} />
                    <View style={[styles.avatar, { backgroundColor: colors.primary + "22" }]}>
                      <Text style={{ fontSize: 18 }}>👤</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={styles.inboxRowTop}>
                        <Text style={[styles.inboxContact, { color: colors.foreground, fontWeight: hasUnread ? "700" : "600" }]} numberOfLines={1}>{item.customerName}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          {hasUnread && (
                            <View style={{ backgroundColor: "#EF4444", borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
                              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text>
                            </View>
                          )}
                          <Text style={[styles.inboxTime, { color: colors.muted }]}>{timeAgo(item.latestAt)}</Text>
                        </View>
                      </View>
                      <Text style={[styles.inboxPreview, { color: hasUnread ? colors.foreground : colors.muted, fontWeight: hasUnread ? "600" : "400" }]} numberOfLines={1}>
                        {item.latestDirection === "outbound" ? "You: " : ""}{item.latestBody}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      )}

      {/* Portal Thread View */}
      {activeTab === "portal" && !!selectedPortalCustomerId && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={120}>
          {/* Header */}
          <View style={[styles.threadHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => { setSelectedPortalCustomerId(null); refetchPortalThreads(); }} style={styles.backBtn}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>← Back</Text>
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={[styles.threadContact, { color: colors.foreground }]}>{selectedPortalCustomer?.customerName ?? "Customer"}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{selectedPortalCustomer?.phone ?? ""}</Text>
              {!!selectedPortalCustomer?.city && (
                <Text style={{ color: colors.muted, fontSize: 12 }}>{selectedPortalCustomer.city}</Text>
              )}
            </View>
          </View>
          {/* Messages */}
          {portalThreadLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              ref={portalFlatListRef}
              data={portalThread as any[]}
              keyExtractor={(item) => String(item.id)}
              style={{ backgroundColor: colors.background }}
              contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
              onContentSizeChange={() => portalFlatListRef.current?.scrollToEnd({ animated: false })}
              renderItem={({ item }) => {
                const isOut = item.direction === "outbound";
                return (
                  <View style={[styles.bubbleRow, isOut ? styles.bubbleRowOut : styles.bubbleRowIn]}>
                    <View style={[styles.bubble, isOut ? [styles.bubbleOut, { backgroundColor: colors.primary }] : [styles.bubbleIn, { backgroundColor: colors.surface }]]}>
                      {!isOut && item.sentByName && (
                        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700", marginBottom: 2 }}>{item.sentByName}</Text>
                      )}
                      {item.imageUrl && (
                        <Image source={{ uri: item.imageUrl }} style={{ width: 200, height: 150, borderRadius: 12, marginBottom: 6, marginTop: 2 }} resizeMode="cover" />
                      )}
                      {item.body && item.body !== "\ud83d\udcf7 Image" && (
                        <Text style={[styles.bubbleText, { color: isOut ? "#fff" : colors.foreground }]}>{item.body}</Text>
                      )}
                      <Text style={[styles.bubbleMeta, { color: isOut ? "rgba(255,255,255,0.7)" : colors.muted }]}>{timeAgo(item.createdAt)}</Text>
                    </View>
                  </View>
                );
              }}
            />
          )}
          {/* Reply Input */}
          <View style={[styles.inputRow, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
            <TextInput
              style={[styles.messageInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              value={portalReplyText}
              onChangeText={setPortalReplyText}
              placeholder="Reply to customer..."
              placeholderTextColor={colors.muted}
              multiline
              returnKeyType="default"
            />
            {/* Image picker button */}
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: portalUploading ? 0.4 : 1 }]}
              onPress={async () => {
                try {
                  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 0.7 });
                  if (result.canceled || !result.assets?.[0]) return;
                  const asset = result.assets[0];
                  setPortalUploading(true);
                  const formData = new FormData();
                  const uri = asset.uri;
                  const filename = uri.split("/").pop() || `photo-${Date.now()}.jpg`;
                  const type = asset.mimeType || "image/jpeg";
                  formData.append("file", { uri, name: filename, type } as any);
                  const apiBase = getApiBaseUrl();
                  const response = await fetch(`${apiBase}/api/upload`, { method: "POST", body: formData, headers: { "Content-Type": "multipart/form-data" } });
                  const data = await response.json();
                  if (!data.url) throw new Error("Upload failed");
                  if (selectedPortalCustomerId) {
                    portalReplyMutation.mutate({ customerId: String(selectedPortalCustomerId), body: portalReplyText.trim() || "[Image]", imageUrl: data.url, employeeId, employeeName: employee?.fullName ?? "Team" });
                  }
                } catch (e: any) {
                  Alert.alert("Upload Failed", e.message ?? "Could not upload image");
                } finally {
                  setPortalUploading(false);
                }
              }}
              disabled={portalUploading || portalReplyMutation.isPending}
            >
              {portalUploading ? <ActivityIndicator size="small" color={colors.primary} /> : <MaterialIcons name="image" size={22} color={colors.muted} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: colors.primary, opacity: portalReplyMutation.isPending || !portalReplyText.trim() ? 0.5 : 1 }]}
              onPress={() => {
                const body = portalReplyText.trim();
                if (!body || !selectedPortalCustomerId) return;
                portalReplyMutation.mutate({ customerId: String(selectedPortalCustomerId), body, employeeId, employeeName: employee?.fullName ?? "Team" });
              }}
              disabled={portalReplyMutation.isPending || !portalReplyText.trim()}
            >
              {portalReplyMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MaterialIcons name="arrow-upward" size={20} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Compose New Portal Message Modal */}
      <Modal
        visible={composeModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setComposeModalVisible(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
            <TouchableOpacity onPress={() => setComposeModalVisible(false)} style={{ paddingRight: 16 }}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: colors.foreground }}>New Portal Message</Text>
            <TouchableOpacity
              onPress={() => {
                if (!composeSelectedCustomer || !composeText.trim()) return;
                composeSendMutation.mutate({
                  customerId: composeSelectedCustomer.customerId,
                  body: composeText.trim(),
                  employeeId,
                  employeeName: employee?.fullName ?? "Team",
                });
              }}
              disabled={!composeSelectedCustomer || !composeText.trim() || composeSendMutation.isPending}
              style={{ opacity: !composeSelectedCustomer || !composeText.trim() ? 0.4 : 1 }}
            >
              <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "700" }}>Send</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {/* To: field */}
            <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
              <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "700", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>To</Text>
              {composeSelectedCustomer ? (
                <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.primary + "18", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.primary + "40" }}>
                  <Text style={{ flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "600" }}>
                    {composeSelectedCustomer.name}
                    {composeSelectedCustomer.phone ? <Text style={{ color: colors.muted, fontWeight: "400" }}>  {composeSelectedCustomer.phone}</Text> : null}
                  </Text>
                  <TouchableOpacity onPress={() => setComposeSelectedCustomer(null)}>
                    <Text style={{ color: colors.muted, fontSize: 18, fontWeight: "700" }}>×</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: colors.border }}>
                  <TextInput
                    value={composeSearch}
                    onChangeText={setComposeSearch}
                    placeholder="Search customer by name, phone, or email…"
                    placeholderTextColor={colors.muted}
                    style={{ flex: 1, color: colors.foreground, fontSize: 14 }}
                    autoFocus
                    returnKeyType="search"
                    clearButtonMode="while-editing"
                  />
                </View>
              )}
            </View>

            {/* Customer search results */}
            {!composeSelectedCustomer && composeSearch.length >= 2 && (
              <View style={{ marginHorizontal: 16, marginTop: 8, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
                {(allCustomers as any[]).slice(0, 8).map((c: any, i: number) => (
                  <TouchableOpacity
                    key={c.customerId ?? c.customer_id ?? i}
                    onPress={() => setComposeSelectedCustomer({
                      customerId: String(c.customerId ?? c.customer_id),
                      name: c.fullName || `${c.firstName ?? c.first_name ?? ''} ${c.lastName ?? c.last_name ?? ''}`.trim() || c.name || 'Unknown',
                      phone: c.phone ?? '',
                      email: c.email ?? '',
                    })}
                    style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: i < Math.min((allCustomers as any[]).length, 8) - 1 ? 0.5 : 0, borderBottomColor: colors.border }}
                  >
                    <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>
                      {c.fullName || `${c.firstName ?? c.first_name ?? ''} ${c.lastName ?? c.last_name ?? ''}`.trim() || c.name || 'Unknown'}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>
                      {[c.phone, c.email, c.city].filter(Boolean).join(' · ')}
                    </Text>
                  </TouchableOpacity>
                ))}
                {(allCustomers as any[]).length === 0 && (
                  <View style={{ padding: 16, alignItems: "center" }}>
                    <Text style={{ color: colors.muted, fontSize: 14 }}>No customers found</Text>
                  </View>
                )}
              </View>
            )}

            {/* Message body */}
            {composeSelectedCustomer && (
              <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
                <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "700", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Message</Text>
                <TextInput
                  value={composeText}
                  onChangeText={setComposeText}
                  placeholder="Type your message to the customer…"
                  placeholderTextColor={colors.muted}
                  multiline
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: composeText ? colors.primary : colors.border,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 15,
                    color: colors.foreground,
                    minHeight: 120,
                    textAlignVertical: "top",
                  }}
                  autoFocus
                />
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>
                  📲 The customer will receive a push notification and see your message in their portal.
                </Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Email Detail Modal */}
      <Modal
        visible={!!selectedEmailLog}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedEmailLog(null)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          {/* Modal Header */}
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }} numberOfLines={2}>{selectedEmailLog?.subject}</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                To: {selectedEmailLog?.to}{selectedEmailLog?.sentAt ? ` · ${new Date(selectedEmailLog.sentAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}` : ""}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setSelectedEmailLog(null)}
              style={{ marginLeft: 12, backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: colors.border }}
            >
              <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>Close</Text>
            </TouchableOpacity>
          </View>
          {/* Email Body */}
          {selectedEmailLog?.body ? (
            <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16 }}>
              <Text selectable style={{ color: colors.foreground, fontSize: 13, lineHeight: 20, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>
                {selectedEmailLog.body.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()}
              </Text>
            </ScrollView>
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>✉️</Text>
              <Text style={{ color: colors.muted, fontSize: 15, textAlign: "center" }}>Email body not available for this entry.</Text>
            </View>
          )}
        </View>
      </Modal>
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 0.5 },
  headerTitle: { fontSize: 17, fontWeight: "600", flex: 1 },
  unreadBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  unreadBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  tabBar: { flexDirection: "row", borderBottomWidth: 0.5 },
  tabItem: { alignItems: "center", paddingVertical: 12, paddingHorizontal: 18, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabText: { fontSize: 14, fontWeight: "600", whiteSpace: "nowrap" } as any,
  lineFilterScroll: { maxHeight: 52, flexGrow: 0 },
  lineFilterChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, gap: 6 },
  inboxRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  inboxRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
  inboxContact: { fontSize: 15, fontWeight: "600" },
  inboxTime: { fontSize: 12 },
  inboxRowMid: { flexDirection: "row", alignItems: "center", marginBottom: 3 },
  inboxPreview: { fontSize: 13 },
  lineTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  lineDot: { width: 8, height: 8, borderRadius: 4 },
  lineTagText: { fontSize: 12, fontWeight: "500" },
  unreadDot: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  unreadDotText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  callRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  callIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  callMeta: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  callDuration: { fontSize: 12 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  emptySubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  // Thread
  threadHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5 },
  backBtn: { paddingRight: 8 },
  threadContact: { fontSize: 16, fontWeight: "700" },
  bubbleRow: { marginBottom: 8 },
  bubbleRowOut: { alignItems: "flex-end" },
  bubbleRowIn: { alignItems: "flex-start" },
  bubble: { maxWidth: "78%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleOut: { borderBottomRightRadius: 4 },
  bubbleIn: { borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleMeta: { fontSize: 11, marginTop: 4 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", padding: 14, paddingBottom: 18, borderTopWidth: 0.5, gap: 10 },
  messageInput: { flex: 1, borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, maxHeight: 120, minHeight: 48 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
