import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, StyleSheet, RefreshControl, Animated,
  Switch, Modal, Alert,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { getApiBaseUrl } from "@/constants/oauth";
import { trpc } from "@/lib/trpc";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";

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
interface ReceptionistStatus {
  twilioConfigured: boolean;
  openAIConfigured: boolean;
  activeCalls: number;
  phoneNumber: string | null;
  ready: boolean;
}
interface CallLog {
  id: number;
  callId: string;
  callSid: string | null;
  callerNumber: string | null;
  callerName: string | null;
  outcome: "booked" | "inquiry" | "no_booking" | "failed";
  bookingId: string | null;
  summary: string | null;
  durationSeconds: number | null;
  transcript: string | null;
  recordingUrl: string | null;
  createdAt: string;
}
interface TestMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}
type CallState = "idle" | "ringing" | "active" | "ended";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const API_BASE = getApiBaseUrl();
const OUTCOME_COLORS: Record<string, string> = {
  booked: "#22C55E",
  inquiry: "#F59E0B",
  no_booking: "#6B7280",
  failed: "#EF4444",
};
const OUTCOME_LABELS: Record<string, string> = {
  booked: "Booked",
  inquiry: "Inquiry",
  no_booking: "No Booking",
  failed: "Failed",
};
function formatPhone(phone: string | null): string {
  if (!phone) return "Unknown";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return phone;
}
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
function CompanyReceptionistUnavailable() {
  const colors = useColors();
  return (
    <ScreenContainer className="items-center justify-center px-6">
      <Text style={{ color: colors.foreground, fontSize: 22, fontWeight: "700", textAlign: "center" }}>Receptionist is not available in Home Service Connected yet</Text>
      <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 12, textAlign: "center" }}>This legacy feature has no verified Home Service Connected API contract. Your Company data will not be sent to the legacy service.</Text>
    </ScreenContainer>
  );
}

export default function AdminReceptionistScreen() {
  const { session } = useJobSyncAuth();
  return session?.portal === "company" ? <CompanyReceptionistUnavailable /> : <AdminReceptionistLegacyScreen />;
}

function AdminReceptionistLegacyScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const [activeTab, setActiveTab] = useState<"status" | "calls" | "test" | "training">("status");

  // Training tab state
  const [knowledgeEntries, setKnowledgeEntries] = useState<any[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any | null>(null);
  const [newCategory, setNewCategory] = useState("services");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [savingEntry, setSavingEntry] = useState(false);
  const [status, setStatus] = useState<ReceptionistStatus | null>(null);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Test call state
  const [callState, setCallState] = useState<CallState>("idle");
  const [testInput, setTestInput] = useState("");
  const [testMessages, setTestMessages] = useState<TestMessage[]>([]);
  const [testHistory, setTestHistory] = useState<{ role: string; content: string }[]>([]);
  const [testLoading, setTestLoading] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [expandedCallId, setExpandedCallId] = useState<number | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStartTimeRef = useRef<number>(0);
  const ringAnim = useRef(new Animated.Value(1)).current;
  const ringAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const router = useRouter();
  const [playingCallId, setPlayingCallId] = useState<number | null>(null);
  const audioRef = useRef<any>(null);
  const [configuringWebhook, setConfiguringWebhook] = useState(false);
  // Phone Lines state
  const [lineModalVisible, setLineModalVisible] = useState(false);
  const [editingLine, setEditingLine] = useState<PhoneLine | null>(null);
  const { data: phoneLines = [], refetch: refetchLines } = trpc.phone.listLines.useQuery(undefined, { refetchInterval: 30000 });
  const upsertLineMutation = trpc.phone.upsertLine.useMutation({
    onSuccess: () => { refetchLines(); setLineModalVisible(false); setEditingLine(null); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const toggleAIMutation = trpc.phone.toggleAI.useMutation({ onSuccess: () => refetchLines() });
  const deleteLineMutation = trpc.phone.deleteLine.useMutation({
    onSuccess: () => refetchLines(),
    onError: (e) => Alert.alert("Error", e.message),
  });
  const handleDeleteLine = useCallback((line: PhoneLine) => {
    Alert.alert("Remove Line", `Remove "${line.line_name}" from the app? This won't cancel your Twilio number.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => deleteLineMutation.mutate({ lineId: line.id }) },
    ]);
  }, [deleteLineMutation]);

  // Pre-compute grouped knowledge entries to avoid for...of in JSX (React Compiler compatibility)
  const groupedKnowledge = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    knowledgeEntries.forEach((e) => {
      if (!grouped[e.category]) grouped[e.category] = [];
      grouped[e.category].push(e);
    });
    return Object.entries(grouped);
  }, [knowledgeEntries]);

  const fetchKnowledge = useCallback(async () => {
    setKnowledgeLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/trpc/aiKnowledge.list`, {
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const json = await res.json() as any;
      setKnowledgeEntries(json?.result?.data?.json ?? []);
    } catch { /* ignore */ } finally {
      setKnowledgeLoading(false);
    }
  }, []);

  const saveKnowledgeEntry = useCallback(async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    setSavingEntry(true);
    try {
      const isEdit = !!editingEntry;
      const url = isEdit
        ? `${API_BASE}/api/trpc/aiKnowledge.update`
        : `${API_BASE}/api/trpc/aiKnowledge.create`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ json: isEdit
          ? { entryId: editingEntry.entryId, title: newTitle.trim(), content: newContent.trim(), category: newCategory }
          : { category: newCategory, title: newTitle.trim(), content: newContent.trim() }
        }),
      });
      setShowAddEntry(false);
      setEditingEntry(null);
      setNewTitle("");
      setNewContent("");
      setNewCategory("services");
      await fetchKnowledge();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch { /* ignore */ } finally {
      setSavingEntry(false);
    }
  }, [newTitle, newContent, newCategory, editingEntry, fetchKnowledge]);

  const deleteKnowledgeEntry = useCallback(async (entryId: string) => {
    try {
      await fetch(`${API_BASE}/api/trpc/aiKnowledge.delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ json: { entryId } }),
      });
      await fetchKnowledge();
    } catch { /* ignore */ }
  }, [fetchKnowledge]);

  const toggleKnowledgeActive = useCallback(async (entry: any) => {
    try {
      await fetch(`${API_BASE}/api/trpc/aiKnowledge.update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ json: { entryId: entry.entryId, isActive: entry.isActive ? 0 : 1 } }),
      });
      await fetchKnowledge();
    } catch { /* ignore */ }
  }, [fetchKnowledge]);
  const [webhookResult, setWebhookResult] = useState<{ success: boolean; message: string } | null>(null);

  const configureWebhook = useCallback(async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setConfiguringWebhook(true);
    setWebhookResult(null);
    try {
      // Use the production domain if available, otherwise fall back to API base
      const baseUrl = "https://luxwashapp-n2wveyqg.manus.space";
      const res = await fetch(`${API_BASE}/api/receptionist/configure-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookBaseUrl: baseUrl }),
      });
      const data = await res.json() as any;
      if (data.success) {
        setWebhookResult({ success: true, message: data.message ?? "Webhook configured successfully!" });
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setWebhookResult({ success: false, message: data.error ?? "Failed to configure webhook" });
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (e: any) {
      setWebhookResult({ success: false, message: e.message ?? "Network error" });
    } finally {
      setConfiguringWebhook(false);
    }
  }, []);

  const playRecording = useCallback(async (call: CallLog) => {
    if (!call.recordingUrl) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Stop current playback if tapping same call
    if (playingCallId === call.id) {
      try { audioRef.current?.pause(); } catch (_) {}
      audioRef.current = null;
      setPlayingCallId(null);
      return;
    }
    // Stop any previous playback
    try { audioRef.current?.pause(); } catch (_) {}
    audioRef.current = null;
    setPlayingCallId(call.id);
    try {
      const { createAudioPlayer, setAudioModeAsync: setMode } = await import("expo-audio");
      if (Platform.OS !== "web") {
        await setMode({ playsInSilentMode: true }).catch(() => {});
      }
      const player = createAudioPlayer({ uri: call.recordingUrl });
      audioRef.current = player;
      player.play();
      // Poll for completion
      const checkDone = setInterval(() => {
        if (!player.playing) {
          clearInterval(checkDone);
          try { player.remove(); } catch (_) {}
          audioRef.current = null;
          setPlayingCallId(null);
        }
      }, 800);
    } catch (e) {
      console.warn("Playback error:", e);
      setPlayingCallId(null);
    }
  }, [playingCallId]);

  const openBookingInSchedule = useCallback((bookingId: string) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/(tabs)/admin-schedule", params: { highlightBookingId: bookingId } });
  }, [router]);

  // Ring animation
  useEffect(() => {
    if (callState === "ringing") {
      ringAnimRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(ringAnim, { toValue: 1.18, duration: 450, useNativeDriver: true }),
          Animated.timing(ringAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
        ])
      );
      ringAnimRef.current.start();
    } else {
      ringAnimRef.current?.stop();
      ringAnim.setValue(1);
    }
  }, [callState, ringAnim]);

  // Call timer
  useEffect(() => {
    if (callState === "active") {
      callStartTimeRef.current = Date.now();
      callTimerRef.current = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
      }, 1000);
    } else {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
      if (callState === "idle") setCallDuration(0);
    }
    return () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    };
  }, [callState]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/receptionist/status`);
      if (res.ok) setStatus(await res.json());
    } catch (e) {
      console.warn("[Receptionist] Status fetch error:", e);
    }
  }, []);

  const fetchCalls = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/receptionist/calls`);
      if (res.ok) {
        const data = await res.json();
        setCallLogs(data.calls ?? []);
      }
    } catch (e) {
      console.warn("[Receptionist] Calls fetch error:", e);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStatus(), fetchCalls()]);
    setLoading(false);
  }, [fetchStatus, fetchCalls]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchStatus(), fetchCalls(), fetchKnowledge()]);
    setRefreshing(false);
  }, [fetchStatus, fetchCalls, fetchKnowledge]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (activeTab === "training") fetchKnowledge(); }, [activeTab, fetchKnowledge]);

  // TTS helper
  const speakText = useCallback((text: string) => {
    if (Platform.OS === "web") return;
    Speech.stop();
    setIsSpeaking(true);
    Speech.speak(text, {
      rate: 0.95,
      pitch: 1.0,
      language: "en-US",
      onDone: () => setIsSpeaking(false),
      onStopped: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    });
  }, []);

  // Start test call
  const startTestCall = useCallback(async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCallState("ringing");
    setTestMessages([]);
    setTestHistory([]);
    setTestInput("");
    // Simulate 2-second ring then answer
    await new Promise<void>((res) => setTimeout(res, 2000));
    setCallState("active");
    const greeting = "Thank you for calling Home Service Connection! This is Lexi, your AI assistant. How can I help you today?";
    const aiGreeting: TestMessage = { role: "assistant", content: greeting, timestamp: new Date() };
    setTestMessages([aiGreeting]);
    setTestHistory([{ role: "assistant", content: greeting }]);
    speakText(greeting);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [speakText]);

  // Send message during call
  const sendTestMessage = useCallback(async () => {
    const msg = testInput.trim();
    if (!msg || testLoading || callState !== "active") return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const userMsg: TestMessage = { role: "user", content: msg, timestamp: new Date() };
    const newMessages = [...testMessages, userMsg];
    setTestMessages(newMessages);
    setTestInput("");
    setTestLoading(true);
    Speech.stop();
    setIsSpeaking(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      const res = await fetch(`${API_BASE}/api/receptionist/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history: testHistory }),
      });
      const data = await res.json();
      const aiText = res.ok
        ? data.response
        : (data.error ?? "Something went wrong. Make sure your OpenAI API key is configured.");
      const aiMsg: TestMessage = { role: "assistant", content: aiText, timestamp: new Date() };
      setTestMessages([...newMessages, aiMsg]);
      if (res.ok) setTestHistory(data.messages.slice(1));
      speakText(aiText);
    } catch {
      setTestMessages([...newMessages, {
        role: "assistant",
        content: "Connection error. Make sure the server is running.",
        timestamp: new Date(),
      }]);
    } finally {
      setTestLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [testInput, testMessages, testHistory, testLoading, callState, speakText]);

  // End call and save to log
  const endTestCall = useCallback(async () => {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Speech.stop();
    setIsSpeaking(false);
    const duration = Math.floor((Date.now() - callStartTimeRef.current) / 1000);
    setCallState("ended");
    const transcript = testMessages
      .map((m) => `${m.role === "user" ? "Customer" : "AI Lexi"}: ${m.content}`)
      .join("\n");
    const hasBooked = testMessages.some(
      (m) => m.role === "assistant" && /confirm|booked|scheduled|appointment/i.test(m.content)
    );
    const outcome = hasBooked ? "booked" : testMessages.length > 1 ? "inquiry" : "no_booking";
    try {
      await fetch(`${API_BASE}/api/receptionist/log-test-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerNumber: "+18501234567",
          callerName: "Test Call (Admin)",
          outcome,
          summary: testMessages.length > 1
            ? `Test call — ${testMessages.length} exchanges. ${hasBooked ? "Booking confirmed." : "No booking made."}`
            : "Test call ended without conversation.",
          durationSeconds: duration,
          transcript,
          recordingUrl: null,
        }),
      });
      await fetchCalls();
    } catch (e) {
      console.warn("Could not save test call log:", e);
    }
    setTimeout(() => { setCallState("idle"); setCallDuration(0); }, 3000);
  }, [testMessages, fetchCalls]);

  if (loading) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.muted }]}>Loading receptionist...</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["left", "right"]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>AI Receptionist</Text>
          {status?.ready && (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          onPress={onRefresh}
          style={[styles.refreshBtn, { backgroundColor: colors.surface }]}
          activeOpacity={0.7}
        >
          <Text style={[styles.refreshBtnText, { color: colors.foreground }]}>↻</Text>
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
        {(["status", "calls", "test", "training"] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={[styles.tab, activeTab === tab && { borderBottomWidth: 2, borderBottomColor: colors.primary }]}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, { color: activeTab === tab ? colors.primary : colors.muted }]}>
              {tab === "status" ? "Status" : tab === "calls" ? `Calls (${callLogs.length})` : tab === "test" ? "Test Call" : "Training"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Status Tab ── */}
      {activeTab === "status" && (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          <View style={styles.statusGrid}>
            <StatusCard label="Twilio" value={status?.twilioConfigured ? "Connected" : "Not Set"} ok={status?.twilioConfigured ?? false} colors={colors} />
            <StatusCard label="OpenAI" value={status?.openAIConfigured ? "Connected" : "Not Set"} ok={status?.openAIConfigured ?? false} colors={colors} />
          </View>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardLabel, { color: colors.muted }]}>Active Calls</Text>
            <Text style={[styles.cardValueLarge, { color: colors.foreground }]}>{status?.activeCalls ?? 0}</Text>
          </View>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardLabel, { color: colors.muted }]}>Total Calls Logged</Text>
            <Text style={[styles.cardValue, { color: colors.foreground }]}>{callLogs.length}</Text>
          </View>
          {!status?.ready && (
            <View style={[styles.setupCard, { backgroundColor: "#F59E0B15", borderColor: "#F59E0B40" }]}>
              <Text style={[styles.setupTitle, { color: colors.foreground }]}>Setup Required</Text>
              <Text style={[styles.setupText, { color: colors.muted }]}>
                Add these environment variables to activate the AI receptionist:
              </Text>
              <SetupStep done={status?.twilioConfigured ?? false} label="TWILIO_ACCOUNT_SID" hint="From twilio.com → Console Dashboard" colors={colors} />
              <SetupStep done={status?.twilioConfigured ?? false} label="TWILIO_AUTH_TOKEN" hint="From twilio.com → Console Dashboard" colors={colors} />
              <SetupStep done={status?.twilioConfigured ?? false} label="TWILIO_PHONE_NUMBER" hint="Your Twilio number (e.g. +18501234567)" colors={colors} />
              <SetupStep done={status?.openAIConfigured ?? false} label="OPENAI_API_KEY" hint="From platform.openai.com → API Keys" colors={colors} />
              <Text style={[styles.setupFooter, { color: colors.muted }]}>
                {"After adding keys, set your Twilio webhook URL to:\nhttps://luxwashapp-n2wveyqg.manus.space/api/receptionist/call"}
              </Text>
            </View>
          )}
          {status?.ready && (
            <View style={[styles.setupCard, { backgroundColor: "#22C55E15", borderColor: "#22C55E40" }]}>
              <Text style={[styles.setupTitle, { color: "#22C55E" }]}>✓ Receptionist is Active</Text>
              <Text style={[styles.setupText, { color: colors.muted }]}>
                {"Customers calling "}
                <Text style={{ color: colors.foreground, fontWeight: "600" }}>{formatPhone(status.phoneNumber)}</Text>
                {" will be greeted by the AI and can book appointments directly into your schedule."}
              </Text>
              <View style={{ marginTop: 12, padding: 10, borderRadius: 8, backgroundColor: colors.background }}>
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Webhook URL</Text>
                <Text style={{ fontSize: 12, color: colors.primary, fontFamily: "monospace" }} numberOfLines={2}>
                  https://luxwashapp-n2wveyqg.manus.space/api/receptionist/call
                </Text>
              </View>
              <TouchableOpacity
                onPress={configureWebhook}
                disabled={configuringWebhook}
                style={[styles.webhookBtn, { backgroundColor: configuringWebhook ? colors.border : "#22C55E", marginTop: 12 }]}
                activeOpacity={0.8}
              >
                {configuringWebhook ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>🔗 Activate Live Phone Line</Text>
                )}
              </TouchableOpacity>
              {webhookResult && (
                <View style={[styles.webhookResult, { backgroundColor: webhookResult.success ? "#22C55E20" : "#EF444420", borderColor: webhookResult.success ? "#22C55E60" : "#EF444460" }]}>
                  <Text style={{ color: webhookResult.success ? "#22C55E" : "#EF4444", fontSize: 13, fontWeight: "600" }}>
                    {webhookResult.success ? "✓ " : "✗ "}{webhookResult.message}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* ── Phone Lines Section ── */}
          <View style={{ marginTop: 8 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Phone Lines</Text>
              <TouchableOpacity
                style={{ backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 }}
                onPress={() => { setEditingLine(null); setLineModalVisible(true); }}
                activeOpacity={0.8}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>+ Add Line</Text>
              </TouchableOpacity>
            </View>
            {(phoneLines as PhoneLine[]).length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 24, gap: 8 }}>
                <Text style={{ fontSize: 32 }}>📲</Text>
                <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15 }}>No Lines Configured</Text>
                <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center", lineHeight: 18 }}>
                  Add your Twilio phone numbers. You can port your existing Grasshopper numbers to Twilio to keep the same numbers.
                </Text>
              </View>
            ) : (
              (phoneLines as PhoneLine[]).map((line) => (
                <View key={line.id} style={[styles.lineCard, { backgroundColor: colors.surface, borderColor: line.color }]}>
                  <View style={styles.lineCardHeader}>
                    <View style={[styles.lineColorBar, { backgroundColor: line.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.lineNameText, { color: colors.foreground }]}>{line.line_name}</Text>
                      <Text style={[styles.lineNumberText, { color: colors.muted }]}>{formatPhone(line.phone_number)}</Text>
                    </View>
                    <TouchableOpacity onPress={() => { setEditingLine(line); setLineModalVisible(true); }} style={styles.editBtn}>
                      <Text style={{ color: colors.primary, fontSize: 13 }}>Edit</Text>
                    </TouchableOpacity>
                  </View>
                  {/* AI Toggle */}
                  <View style={[styles.lineToggleRow, { borderTopColor: colors.border }]}>
                    <View>
                      <Text style={[styles.lineToggleLabel, { color: colors.foreground }]}>AI Receptionist</Text>
                      <Text style={[styles.lineToggleSub, { color: colors.muted }]}>
                        {line.ai_receptionist_enabled ? "ON — AI handles inbound calls & texts" : "OFF — Calls ring your team directly"}
                      </Text>
                    </View>
                    <Switch
                      value={line.ai_receptionist_enabled === 1}
                      onValueChange={(val) => toggleAIMutation.mutate({ lineId: line.id, enabled: val })}
                      trackColor={{ true: line.color }}
                    />
                  </View>
                  {/* Simultaneous Ring */}
                  <View style={[styles.lineToggleRow, { borderTopColor: colors.border }]}>
                    <View>
                      <Text style={[styles.lineToggleLabel, { color: colors.foreground }]}>Simultaneous Ring</Text>
                      <Text style={[styles.lineToggleSub, { color: colors.muted }]}>
                        {line.forward_to_employees ? "Rings all active employees at once" : "Disabled"}
                      </Text>
                    </View>
                    <View style={[styles.lineStatusPill, { backgroundColor: line.forward_to_employees ? colors.success + "22" : colors.border }]}>
                      <Text style={{ color: line.forward_to_employees ? colors.success : colors.muted, fontSize: 12, fontWeight: "600" }}>
                        {line.forward_to_employees ? "Active" : "Off"}
                      </Text>
                    </View>
                  </View>
                  {/* Delete */}
                  <TouchableOpacity style={styles.removeLineBtn} onPress={() => handleDeleteLine(line)}>
                    <Text style={{ color: colors.error, fontSize: 13 }}>Remove Line</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
            {/* Setup Instructions */}
            <View style={[styles.lineInfoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.lineInfoTitle, { color: colors.foreground }]}>How to Set Up Twilio</Text>
              <Text style={[styles.lineInfoText, { color: colors.muted }]}>
                1. Go to Settings → Secrets and add your TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.{"\n\n"}
                2. Add each phone line above with the exact number as it appears in Twilio (e.g. +18505551234).{"\n\n"}
                3. In your Twilio console, set each number's webhook URL to:{"\n"}
                <Text style={{ color: colors.primary }}>{"{"}your-api-url{"}"}/api/phone/sms</Text> for SMS{"\n"}
                <Text style={{ color: colors.primary }}>{"{"}your-api-url{"}"}/api/phone/voice</Text> for Voice{"\n\n"}
                4. To port your Grasshopper numbers, submit a port request in Twilio's console — it typically takes 2–4 weeks.
              </Text>
            </View>
          </View>
        </ScrollView>
      )}

      {/* ── Calls Tab ── */}
      {activeTab === "calls" && (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {callLogs.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📞</Text>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No calls yet</Text>
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                Use the Test Call tab to simulate a call, or wait for real customer calls once live.
              </Text>
            </View>
          ) : (
            callLogs.map((call) => (
              <TouchableOpacity
                key={call.id}
                activeOpacity={0.8}
                onPress={() => setExpandedCallId(expandedCallId === call.id ? null : call.id)}
                style={[styles.callCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                {/* ── Header row ── */}
                <View style={styles.callCardHeader}>
                  <View style={styles.callCardLeft}>
                    <View style={styles.callerRow}>
                      <View style={[styles.callerAvatar, { backgroundColor: `${OUTCOME_COLORS[call.outcome]}25` }]}>
                        <Text style={{ fontSize: 18 }}>{call.outcome === "booked" ? "📅" : call.outcome === "inquiry" ? "❓" : call.outcome === "failed" ? "❌" : "📞"}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.callPhone, { color: colors.foreground }]}>
                          {call.callerName ?? formatPhone(call.callerNumber)}
                        </Text>
                        <Text style={[styles.callTime, { color: colors.muted }]}>
                          {formatPhone(call.callerNumber)} · {timeAgo(call.createdAt)}{call.durationSeconds ? ` · ${formatDuration(call.durationSeconds)}` : ""}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.callCardRight}>
                    <View style={[styles.outcomeBadge, { backgroundColor: `${OUTCOME_COLORS[call.outcome]}20` }]}>
                      <Text style={[styles.outcomeBadgeText, { color: OUTCOME_COLORS[call.outcome] }]}>
                        {OUTCOME_LABELS[call.outcome]}
                      </Text>
                    </View>
                    <Text style={[styles.expandArrow, { color: colors.muted }]}>
                      {expandedCallId === call.id ? "▲" : "▼"}
                    </Text>
                  </View>
                </View>

                {/* ── Summary ── */}
                {call.summary && (
                  <Text
                    style={[styles.callSummary, { color: colors.muted }]}
                    numberOfLines={expandedCallId === call.id ? undefined : 2}
                  >
                    {call.summary}
                  </Text>
                )}

                {/* ── Booking link (always visible if booked) ── */}
                {call.bookingId && (
                  <TouchableOpacity
                    onPress={() => openBookingInSchedule(call.bookingId!)}
                    activeOpacity={0.7}
                    style={[styles.bookingLinkBtn, { backgroundColor: `${colors.primary}15`, borderColor: `${colors.primary}40` }]}
                  >
                    <Text style={{ fontSize: 14 }}>📋</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.bookingLinkLabel, { color: colors.primary }]}>View Job in Schedule</Text>
                      <Text style={[styles.bookingLinkId, { color: colors.muted }]}>Booking ID: {call.bookingId}</Text>
                    </View>
                    <Text style={[styles.bookingLinkArrow, { color: colors.primary }]}>›</Text>
                  </TouchableOpacity>
                )}

                {/* ── Expanded: Recording player ── */}
                {expandedCallId === call.id && call.recordingUrl && (
                  <TouchableOpacity
                    onPress={() => playRecording(call)}
                    activeOpacity={0.8}
                    style={[styles.recordingPlayer, {
                      backgroundColor: playingCallId === call.id ? `${colors.primary}20` : colors.background,
                      borderColor: playingCallId === call.id ? colors.primary : colors.border,
                    }]}
                  >
                    <View style={[styles.playBtn, { backgroundColor: playingCallId === call.id ? colors.primary : colors.surface, borderColor: colors.border }]}>
                      <Text style={styles.playBtnIcon}>{playingCallId === call.id ? "⏸" : "▶"}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.recordingTitle, { color: colors.foreground }]}>
                        {playingCallId === call.id ? "Playing recording..." : "Call Recording"}
                      </Text>
                      <Text style={[styles.recordingDuration, { color: colors.muted }]}>
                        {call.durationSeconds ? formatDuration(call.durationSeconds) : "Tap to play"}
                      </Text>
                    </View>
                    {playingCallId === call.id && (
                      <ActivityIndicator size="small" color={colors.primary} />
                    )}
                  </TouchableOpacity>
                )}

                {/* ── Expanded: Transcript ── */}
                {expandedCallId === call.id && call.transcript && (
                  <View style={[styles.transcriptBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Text style={[styles.transcriptLabel, { color: colors.muted }]}>📝 TRANSCRIPT</Text>
                    {call.transcript.split("\n").filter(Boolean).map((line, i) => {
                      const isAI = line.startsWith("AI Lexi:");
                      const isCustomer = line.startsWith("Customer:");
                      return (
                        <View key={i} style={[styles.transcriptLine, isAI && styles.transcriptLineAI, isCustomer && styles.transcriptLineCustomer]}>
                          <Text style={[
                            styles.transcriptText,
                            { color: isAI ? colors.primary : isCustomer ? colors.foreground : colors.muted },
                            isAI && { fontWeight: "600" },
                          ]}>
                            {line}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {expandedCallId === call.id && !call.transcript && !call.recordingUrl && (
                  <Text style={[styles.noTranscript, { color: colors.muted }]}>
                    No transcript available for this call.
                  </Text>
                )}
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      {/* ── Test Call Tab ── */}
      {activeTab === "test" && (
        <View style={styles.testContainer}>

          {/* Idle */}
          {callState === "idle" && (
            <View style={styles.testIdleContainer}>
              <Text style={{ fontSize: 64 }}>📱</Text>
              <Text style={[styles.testIdleTitle, { color: colors.foreground }]}>Test Call Simulator</Text>
              <Text style={[styles.testIdleSubtitle, { color: colors.muted }]}>
                Tap the button to simulate a customer calling in. The AI will answer, speak its responses out loud, and save a call log with transcript when you hang up.
              </Text>
              {!status?.openAIConfigured && (
                <View style={[styles.testWarning, { backgroundColor: "#F59E0B15", borderColor: "#F59E0B40" }]}>
                  <Text style={[styles.testWarningText, { color: "#F59E0B" }]}>
                    OpenAI API key not configured yet. The AI will respond with an error message, but you can still test the call flow and see how the log looks.
                  </Text>
                </View>
              )}
              <TouchableOpacity
                onPress={startTestCall}
                activeOpacity={0.85}
                style={[styles.callBtn, { backgroundColor: "#22C55E" }]}
              >
                <Text style={styles.callBtnIcon}>📞</Text>
                <Text style={styles.callBtnText}>Start Test Call</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Ringing */}
          {callState === "ringing" && (
            <View style={styles.testIdleContainer}>
              <Animated.View
                style={[styles.ringCircle, { transform: [{ scale: ringAnim }], borderColor: "#22C55E" }]}
              >
                <Text style={styles.ringIcon}>📞</Text>
              </Animated.View>
              <Text style={[styles.testIdleTitle, { color: colors.foreground }]}>Calling...</Text>
              <Text style={[styles.testIdleSubtitle, { color: colors.muted }]}>AI Receptionist is answering</Text>
            </View>
          )}

          {/* Active call */}
          {callState === "active" && (
            <>
              <View style={[styles.activeCallBar, { backgroundColor: "#22C55E15", borderBottomColor: "#22C55E40" }]}>
                <View style={styles.activeCallLeft}>
                  <View style={styles.activeDot} />
                  <Text style={[styles.activeCallLabel, { color: "#22C55E" }]}>
                    LIVE · {formatDuration(callDuration)}
                  </Text>
                </View>
                {isSpeaking && (
                  <Text style={[styles.speakingLabel, { color: "#22C55E" }]}>🔊 AI Speaking...</Text>
                )}
                <TouchableOpacity onPress={endTestCall} activeOpacity={0.8} style={styles.hangupBtn}>
                  <Text style={styles.hangupBtnText}>End Call</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                ref={scrollRef}
                style={styles.testMessages}
                contentContainerStyle={styles.testMessagesContent}
              >
                {testMessages.map((msg, i) => (
                  <View
                    key={i}
                    style={[styles.bubbleRow, msg.role === "user" && { justifyContent: "flex-end" }]}
                  >
                    {msg.role === "assistant" && (
                      <View style={[styles.avatarCircle, { backgroundColor: colors.primary }]}>
                        <Text style={styles.avatarText}>AI</Text>
                      </View>
                    )}
                    <View style={[
                      styles.testBubble,
                      msg.role === "user"
                        ? [styles.testBubbleUser, { backgroundColor: colors.primary }]
                        : [styles.testBubbleAI, { backgroundColor: colors.surface, borderColor: colors.border }],
                    ]}>
                      <Text style={[
                        styles.testBubbleText,
                        { color: msg.role === "user" ? "#fff" : colors.foreground },
                      ]}>
                        {msg.content}
                      </Text>
                      <Text style={[
                        styles.bubbleTime,
                        { color: msg.role === "user" ? "rgba(255,255,255,0.6)" : colors.muted },
                      ]}>
                        {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    </View>
                    {msg.role === "user" && (
                      <View style={[styles.avatarCircle, { backgroundColor: colors.border }]}>
                        <Text style={[styles.avatarText, { color: colors.foreground }]}>You</Text>
                      </View>
                    )}
                  </View>
                ))}
                {testLoading && (
                  <View style={styles.bubbleRow}>
                    <View style={[styles.avatarCircle, { backgroundColor: colors.primary }]}>
                      <Text style={styles.avatarText}>AI</Text>
                    </View>
                    <View style={[styles.testBubble, styles.testBubbleAI, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <ActivityIndicator size="small" color={colors.primary} />
                    </View>
                  </View>
                )}
              </ScrollView>

              <View style={[styles.testInputBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
                <TextInput
                  style={[styles.testInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                  placeholder="Speak as the customer..."
                  placeholderTextColor={colors.muted}
                  value={testInput}
                  onChangeText={setTestInput}
                  returnKeyType="send"
                  onSubmitEditing={sendTestMessage}
                  multiline={false}
                  editable={!testLoading}
                />
                <TouchableOpacity
                  onPress={sendTestMessage}
                  activeOpacity={0.7}
                  style={[styles.sendBtn, { backgroundColor: testInput.trim() && !testLoading ? colors.primary : colors.border }]}
                >
                  {testLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.sendBtnText}>→</Text>
                  }
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* Ended */}
          {callState === "ended" && (
            <View style={styles.testIdleContainer}>
              <Text style={{ fontSize: 64 }}>📵</Text>
              <Text style={[styles.testIdleTitle, { color: colors.foreground }]}>Call Ended</Text>
              <Text style={[styles.testIdleSubtitle, { color: colors.muted }]}>
                {"Duration: " + formatDuration(callDuration) + "\nSaving call log..."}
              </Text>
              <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
            </View>
          )}
        </View>
      )}

      {/* ── Training Tab ── */}
      {activeTab === "training" && (
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 }]}>
          {/* Header */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.testIdleTitle, { color: colors.foreground, fontSize: 18, textAlign: "left" }]}>AI Knowledge Base</Text>
              <Text style={[styles.testIdleSubtitle, { color: colors.muted, fontSize: 12, textAlign: "left", marginTop: 2 }]}>
                Add information the AI uses during calls — services, pricing, FAQs, policies.
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => { setEditingEntry(null); setNewTitle(""); setNewContent(""); setNewCategory("services"); setShowAddEntry(true); }}
              style={{ backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginLeft: 12 }}
              activeOpacity={0.8}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>+ Add</Text>
            </TouchableOpacity>
          </View>

          {/* Add/Edit form */}
          {showAddEntry && (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, gap: 10, marginBottom: 4 }]}>
              <Text style={[styles.cardLabel, { color: colors.muted }]}>{editingEntry ? "EDIT ENTRY" : "NEW ENTRY"}</Text>
              {/* Category chips */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {["services", "pricing", "faq", "policies", "hours", "other"].map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    onPress={() => setNewCategory(cat)}
                    style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: newCategory === cat ? colors.primary : colors.border }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 11, fontWeight: "600", color: newCategory === cat ? "#fff" : colors.foreground, textTransform: "capitalize" }}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                placeholder="Title (e.g. Full Detail Package)"
                placeholderTextColor={colors.muted}
                value={newTitle}
                onChangeText={setNewTitle}
                style={{ backgroundColor: colors.background, color: colors.foreground, borderRadius: 10, padding: 12, fontSize: 14, borderWidth: 1, borderColor: colors.border }}
                returnKeyType="next"
              />
              <TextInput
                placeholder="Content (e.g. Includes interior + exterior detail, takes 3-4 hours, priced at $250+)"
                placeholderTextColor={colors.muted}
                value={newContent}
                onChangeText={setNewContent}
                multiline
                numberOfLines={4}
                style={{ backgroundColor: colors.background, color: colors.foreground, borderRadius: 10, padding: 12, fontSize: 14, borderWidth: 1, borderColor: colors.border, minHeight: 90, textAlignVertical: "top" }}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  onPress={() => { setShowAddEntry(false); setEditingEntry(null); }}
                  style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: colors.border, alignItems: "center" }}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: colors.foreground, fontWeight: "600" }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={saveKnowledgeEntry}
                  disabled={savingEntry || !newTitle.trim() || !newContent.trim()}
                  style={{ flex: 2, padding: 12, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center", opacity: savingEntry || !newTitle.trim() || !newContent.trim() ? 0.5 : 1 }}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: "#fff", fontWeight: "700" }}>{savingEntry ? "Saving..." : "Save Entry"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Loading */}
          {knowledgeLoading && <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />}

          {/* Empty state */}
          {!knowledgeLoading && knowledgeEntries.length === 0 && !showAddEntry && (
            <View style={[styles.emptyState, { marginTop: 20 }]}>
              <Text style={styles.emptyIcon}>🧠</Text>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Knowledge Yet</Text>
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                Tap "+ Add" to teach the AI about your services, pricing, and policies.
              </Text>
            </View>
          )}

          {/* Grouped entries */}
          {!knowledgeLoading && groupedKnowledge.map(([cat, items]) => (
            <View key={cat} style={{ marginBottom: 8 }}>
              <Text style={[styles.cardLabel, { color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }]}>{cat}</Text>
              {items.map((entry: any) => (
                <View key={entry.entryId} style={[styles.card, { backgroundColor: colors.surface, borderColor: entry.isActive ? colors.border : colors.border + "60", marginBottom: 8, opacity: entry.isActive ? 1 : 0.55 }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14, flex: 1, marginRight: 8 }}>{entry.title}</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <TouchableOpacity onPress={() => toggleKnowledgeActive(entry)} activeOpacity={0.7}>
                        <Text style={{ fontSize: 16 }}>{entry.isActive ? "✅" : "⬜"}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => { setEditingEntry(entry); setNewTitle(entry.title); setNewContent(entry.content); setNewCategory(entry.category); setShowAddEntry(true); }} activeOpacity={0.7}>
                        <Text style={{ fontSize: 15, color: colors.primary }}>✏️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteKnowledgeEntry(entry.entryId)} activeOpacity={0.7}>
                        <Text style={{ fontSize: 15, color: "#EF4444" }}>🗑</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 4 }}>{entry.content}</Text>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
      {/* LineModal */}
      <LineModal
        visible={lineModalVisible}
        line={editingLine}
        onClose={() => { setLineModalVisible(false); setEditingLine(null); }}
        onSave={(data) => upsertLineMutation.mutate(data)}
        colors={colors}
      />
    </ScreenContainer>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatusCard({ label, value, ok, colors }: { label: string; value: string; ok: boolean; colors: any }) {
  return (
    <View style={[styles.statusCard, { backgroundColor: colors.surface, borderColor: ok ? "#22C55E40" : "#EF444440" }]}>
      <View style={[styles.statusDot, { backgroundColor: ok ? "#22C55E" : "#EF4444" }]} />
      <Text style={[styles.statusCardLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.statusCardValue, { color: ok ? "#22C55E" : "#EF4444" }]}>{value}</Text>
    </View>
  );
}
function SetupStep({ done, label, hint, colors }: { done: boolean; label: string; hint: string; colors: any }) {
  return (
    <View style={styles.setupStep}>
      <Text style={{ fontSize: 16, marginRight: 8 }}>{done ? "✅" : "⬜"}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.setupStepLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.setupStepHint, { color: colors.muted }]}>{hint}</Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontSize: 14 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 22, fontWeight: "700" },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: "#22C55E20" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22C55E" },
  liveText: { fontSize: 10, fontWeight: "700", color: "#22C55E", letterSpacing: 0.5 },
  refreshBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  refreshBtnText: { fontSize: 18, fontWeight: "600" },
  tabBar: { flexDirection: "row", borderBottomWidth: 0.5 },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabText: { fontSize: 13, fontWeight: "600" },
  scrollContent: { padding: 16, gap: 12 },
  statusGrid: { flexDirection: "row", gap: 12 },
  statusCard: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 14, gap: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 4 },
  statusCardLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  statusCardValue: { fontSize: 13, fontWeight: "700" },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 4 },
  cardLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  cardValue: { fontSize: 18, fontWeight: "700" },
  cardValueLarge: { fontSize: 36, fontWeight: "800" },
  setupCard: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 10 },
  setupTitle: { fontSize: 16, fontWeight: "700" },
  setupText: { fontSize: 13, lineHeight: 20 },
  setupStep: { flexDirection: "row", alignItems: "flex-start", gap: 4, paddingVertical: 4 },
  setupStepLabel: { fontSize: 13, fontWeight: "600", fontFamily: "monospace" },
  setupStepHint: { fontSize: 11, marginTop: 1 },
  setupFooter: { fontSize: 11, lineHeight: 18, marginTop: 4 },
  emptyState: { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptyText: { fontSize: 14, textAlign: "center", lineHeight: 20, paddingHorizontal: 24 },
  callCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 8 },
  callCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  callCardLeft: { gap: 2, flex: 1 },
  callCardRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  callPhone: { fontSize: 15, fontWeight: "600" },
  callTime: { fontSize: 12 },
  outcomeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  outcomeBadgeText: { fontSize: 11, fontWeight: "700" },
  expandArrow: { fontSize: 10, fontWeight: "700" },
  callSummary: { fontSize: 13, lineHeight: 18 },
  callBookingId: { fontSize: 12, fontWeight: "600" },
  transcriptBox: { borderRadius: 8, borderWidth: 1, padding: 10, gap: 6, marginTop: 4 },
  webhookBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  webhookResult: { marginTop: 10, padding: 10, borderRadius: 8, borderWidth: 1 },
  transcriptLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  transcriptText: { fontSize: 12, lineHeight: 18 },
  recordingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, borderTopWidth: 0.5, marginTop: 4 },
  recordingLabel: { fontSize: 13, fontWeight: "600" },
  noTranscript: { fontSize: 12, fontStyle: "italic", marginTop: 4 },
  testContainer: { flex: 1 },
  testIdleContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 },
  testIdleTitle: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  testIdleSubtitle: { fontSize: 14, textAlign: "center", lineHeight: 22 },
  testWarning: { borderRadius: 10, borderWidth: 1, padding: 12, marginTop: 4 },
  testWarningText: { fontSize: 13, lineHeight: 18, textAlign: "center" },
  callBtn: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 32, paddingVertical: 16, borderRadius: 50, marginTop: 8 },
  callBtnIcon: { fontSize: 24 },
  callBtnText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  ringCircle: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  ringIcon: { fontSize: 44 },
  activeCallBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  activeCallLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#22C55E" },
  activeCallLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  speakingLabel: { fontSize: 12, fontWeight: "600" },
  hangupBtn: { backgroundColor: "#EF4444", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  hangupBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  testMessages: { flex: 1 },
  testMessagesContent: { padding: 16, gap: 10 },
  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  avatarCircle: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  avatarText: { color: "#fff", fontSize: 9, fontWeight: "700" },
  testBubble: { maxWidth: "78%", borderRadius: 16, padding: 12, borderWidth: 1, gap: 4 },
  testBubbleUser: { alignSelf: "flex-end", borderWidth: 0 },
  testBubbleAI: { alignSelf: "flex-start" },
  testBubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTime: { fontSize: 10 },
  testInputBar: { flexDirection: "row", alignItems: "center", padding: 12, borderTopWidth: 0.5, gap: 8 },
  testInput: { flex: 1, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14, minHeight: 38 },
  sendBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  sendBtnText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  // Call card new styles
  callerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  callerAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  bookingLinkBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 10, borderWidth: 1, padding: 10, marginTop: 4 },
  bookingLinkLabel: { fontSize: 13, fontWeight: "700" },
  bookingLinkId: { fontSize: 11, marginTop: 1 },
  bookingLinkArrow: { fontSize: 20, fontWeight: "300" },
  recordingPlayer: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 10, borderWidth: 1, padding: 12, marginTop: 4 },
  playBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  playBtnIcon: { fontSize: 16 },
  recordingTitle: { fontSize: 14, fontWeight: "600" },
  recordingDuration: { fontSize: 12, marginTop: 2 },
  transcriptLine: { paddingVertical: 3 },
  transcriptLineAI: { paddingLeft: 4, borderLeftWidth: 2, borderLeftColor: "#0a7ea440" },
  transcriptLineCustomer: { paddingLeft: 4 },
  // Phone Lines styles
  lineCard: { borderRadius: 12, borderWidth: 1.5, marginBottom: 16, overflow: "hidden" },
  lineCardHeader: { flexDirection: "row", alignItems: "center", padding: 14 },
  lineColorBar: { width: 4, height: 40, borderRadius: 2, marginRight: 12 },
  lineNameText: { fontSize: 16, fontWeight: "700" },
  lineNumberText: { fontSize: 13, marginTop: 2 },
  editBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  lineToggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 0.5 },
  lineToggleLabel: { fontSize: 14, fontWeight: "600" },
  lineToggleSub: { fontSize: 12, marginTop: 2 },
  lineStatusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  removeLineBtn: { paddingHorizontal: 14, paddingVertical: 10, alignItems: "flex-end" },
  lineInfoBox: { borderRadius: 12, borderWidth: 1, padding: 16, marginTop: 8, marginBottom: 24 },
  lineInfoTitle: { fontSize: 15, fontWeight: "700", marginBottom: 8 },
  lineInfoText: { fontSize: 13, lineHeight: 20 },
  // LineModal styles
  lineModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  lineModalBox: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  lineModalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 20 },
  lineFieldLabel: { fontSize: 12, fontWeight: "600", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  lineInput: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 16 },
  lineColorRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  lineColorDot: { width: 30, height: 30, borderRadius: 15 },
  lineToggleRowModal: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  lineModalButtons: { flexDirection: "row", gap: 12, marginTop: 8 },
  lineCancelBtn: { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 14, alignItems: "center" },
  lineSaveBtn: { flex: 2, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
});

// ─── LineModal Component ────────────────────────────────────────────────────────────────────
function LineModal({
  visible, line, onClose, onSave, colors,
}: {
  visible: boolean;
  line: PhoneLine | null;
  onClose: () => void;
  onSave: (data: { id?: number; lineName: string; phoneNumber: string; twilioSid?: string; color: string; aiReceptionistEnabled: boolean; forwardToEmployees: boolean }) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const LINE_COLORS = ["#0a7ea4", "#7c3aed", "#059669", "#dc2626", "#d97706", "#db2777", "#0891b2", "#65a30d"];
  const [lineName, setLineName] = useState(line?.line_name ?? "");
  const [phoneNumber, setPhoneNumber] = useState(line?.phone_number ?? "");
  const [twilioSid, setTwilioSid] = useState(line?.twilio_sid ?? "");
  const [selectedColor, setSelectedColor] = useState(line?.color ?? LINE_COLORS[0]);
  const [aiEnabled, setAiEnabled] = useState(line ? line.ai_receptionist_enabled === 1 : false);
  const [forwardToEmp, setForwardToEmp] = useState(line ? line.forward_to_employees === 1 : true);
  React.useEffect(() => {
    if (visible) {
      setLineName(line?.line_name ?? "");
      setPhoneNumber(line?.phone_number ?? "");
      setTwilioSid(line?.twilio_sid ?? "");
      setSelectedColor(line?.color ?? LINE_COLORS[0]);
      setAiEnabled(line ? line.ai_receptionist_enabled === 1 : false);
      setForwardToEmp(line ? line.forward_to_employees === 1 : true);
    }
  }, [visible, line]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.lineModalOverlay}>
        <View style={[styles.lineModalBox, { backgroundColor: colors.surface }]}>
          <Text style={[styles.lineModalTitle, { color: colors.foreground }]}>
            {line ? "Edit Line" : "Add Phone Line"}
          </Text>
          <Text style={[styles.lineFieldLabel, { color: colors.muted }]}>Line Name</Text>
          <TextInput
            style={[styles.lineInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
            value={lineName}
            onChangeText={setLineName}
            placeholder="e.g. Main Line, Fleet Line"
            placeholderTextColor={colors.muted}
            returnKeyType="next"
          />
          <Text style={[styles.lineFieldLabel, { color: colors.muted }]}>Phone Number</Text>
          <TextInput
            style={[styles.lineInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder="+18505551234"
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            returnKeyType="next"
          />
          <Text style={[styles.lineFieldLabel, { color: colors.muted }]}>Twilio Phone SID (optional)</Text>
          <TextInput
            style={[styles.lineInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
            value={twilioSid}
            onChangeText={setTwilioSid}
            placeholder="PNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            placeholderTextColor={colors.muted}
            returnKeyType="done"
          />
          <Text style={[styles.lineFieldLabel, { color: colors.muted }]}>Line Color</Text>
          <View style={styles.lineColorRow}>
            {LINE_COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.lineColorDot, { backgroundColor: c, borderWidth: selectedColor === c ? 3 : 0, borderColor: colors.foreground }]}
                onPress={() => setSelectedColor(c)}
              />
            ))}
          </View>
          <View style={styles.lineToggleRowModal}>
            <Text style={[styles.lineToggleLabel, { color: colors.foreground }]}>AI Receptionist</Text>
            <Switch value={aiEnabled} onValueChange={setAiEnabled} trackColor={{ true: colors.primary }} />
          </View>
          <View style={styles.lineToggleRowModal}>
            <Text style={[styles.lineToggleLabel, { color: colors.foreground }]}>Ring All Employees</Text>
            <Switch value={forwardToEmp} onValueChange={setForwardToEmp} trackColor={{ true: colors.primary }} />
          </View>
          <View style={styles.lineModalButtons}>
            <TouchableOpacity style={[styles.lineCancelBtn, { borderColor: colors.border }]} onPress={onClose}>
              <Text style={{ color: colors.muted }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.lineSaveBtn, { backgroundColor: selectedColor }]}
              onPress={() => {
                if (!lineName.trim() || !phoneNumber.trim()) {
                  Alert.alert("Required", "Line name and phone number are required.");
                  return;
                }
                onSave({ id: line?.id, lineName: lineName.trim(), phoneNumber: phoneNumber.trim(), twilioSid: twilioSid.trim() || undefined, color: selectedColor, aiReceptionistEnabled: aiEnabled, forwardToEmployees: forwardToEmp });
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "600" }}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
