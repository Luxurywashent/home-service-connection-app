/**
 * Push-to-Talk (Walkie-Talkie) Screen
 *
 * Hold the big button to record. Release to send.
 * Incoming messages auto-play with a chirp sound.
 * Works like a Nextel walkie-talkie channel for the whole team.
 */

import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from "react";
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator,
  StyleSheet, Platform, Pressable, Alert, PanResponder, Animated,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import {
  useAudioRecorder,
  useAudioRecorderState,
  useAudioPlayer,
  useAudioPlayerStatus,
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  RecordingPresets,
} from "expo-audio";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";

// ─── Types ────────────────────────────────────────────────────────────────────

interface VoiceMessage {
  messageId: string;
  employeeId: string;
  fullName: string;
  audioUrl: string;
  durationSeconds: number | null;
  createdAt: Date;
}

// ─── Voice Message Bubble ─────────────────────────────────────────────────────

export function VoiceBubble({
  message,
  isMe,
}: {
  message: VoiceMessage;
  isMe: boolean;
}) {
  const colors = useColors();
  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);

  const handlePlay = useCallback(async () => {
    try {
      if (isPlaying) {
        playerRef.current?.pause();
        setIsPlaying(false);
        return;
      }
      // Clean up previous player
      playerRef.current?.remove();
      const p = createAudioPlayer({ uri: message.audioUrl });
      playerRef.current = p;
      p.addListener("playbackStatusUpdate", (status: any) => {
        if (status.didJustFinish || (!status.isLoaded && !status.isBuffering)) {
          setIsPlaying(false);
        }
      });
      p.play();
      setIsPlaying(true);
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e) {
      setIsPlaying(false);
    }
  }, [message.audioUrl, isPlaying]);

  useEffect(() => {
    return () => {
      playerRef.current?.remove();
    };
  }, []);

  const dur = message.durationSeconds ?? 0;
  const durLabel = dur > 0 ? `${dur}s` : "Voice";

  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <View style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowOther]}>
      {!isMe && (
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={styles.avatarText}>
            {message.fullName.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <View
        style={[
          styles.voiceBubble,
          isMe
            ? [styles.bubbleMe, { backgroundColor: colors.primary }]
            : [styles.bubbleOther, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }],
        ]}
      >
        {!isMe && (
          <Text style={[styles.senderName, { color: colors.primary }]}>
            {message.fullName}
          </Text>
        )}
        <View style={styles.voiceRow}>
          <TouchableOpacity
            onPress={handlePlay}
            style={[styles.playBtn, { backgroundColor: isMe ? "rgba(255,255,255,0.25)" : colors.primary }]}
            activeOpacity={0.8}
          >
            <Text style={[styles.playIcon, { color: isMe ? "#fff" : "#fff" }]}>
              {isPlaying ? "⏸" : "▶"}
            </Text>
          </TouchableOpacity>
          {/* Waveform bars (decorative) */}
          <View style={styles.waveform}>
            {[4, 8, 12, 6, 14, 10, 5, 9, 13, 7, 11, 6, 8, 4].map((h, i) => (
              <View
                key={i}
                style={[
                  styles.waveBar,
                  {
                    height: h,
                    backgroundColor: isMe
                      ? isPlaying ? "#fff" : "rgba(255,255,255,0.6)"
                      : isPlaying ? colors.primary : colors.muted,
                  },
                ]}
              />
            ))}
          </View>
          <Text style={[styles.durLabel, { color: isMe ? "rgba(255,255,255,0.85)" : colors.muted }]}>
            {durLabel}
          </Text>
        </View>
        <Text style={[styles.msgTime, { color: isMe ? "rgba(255,255,255,0.7)" : colors.muted }]}>
          {formatTime(message.createdAt)}
        </Text>
      </View>
    </View>
  );
}

// ─── PTT Button ───────────────────────────────────────────────────────────────

interface PttButtonProps {
  onSend: (uri: string, durationSeconds: number) => Promise<void>;
  isSending: boolean;
}

export function PttButton({ onSend, isSending }: PttButtonProps) {
  const colors = useColors();
  const [isRecording, setIsRecording] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const startTimeRef = useRef<number>(0);
  const isRecordingRef = useRef(false);
  const chirpStartPlayer = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);

  useEffect(() => {
    (async () => {
      const { granted } = await requestRecordingPermissionsAsync();
      setHasPermission(granted);
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });
    })();
    return () => {
      chirpStartPlayer.current?.remove();
    };
  }, []);

  const playChirp = useCallback(() => {
    try {
      const p = createAudioPlayer(require("@/assets/sounds/nextel-chirp.mp3"));
      p.play();
      setTimeout(() => p.remove(), 1000);
    } catch (_) {}
  }, []);

  const startRecording = useCallback(async () => {
    if (!hasPermission) {
      Alert.alert("Microphone Permission", "Please allow microphone access to use Luxury Talk.");
      return;
    }
    if (isSending || isRecordingRef.current) return;
    try {
      playChirp();
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      startTimeRef.current = Date.now();
      isRecordingRef.current = true;
      setIsRecording(true);
      Animated.spring(scaleAnim, { toValue: 1.08, useNativeDriver: true, speed: 20 }).start();
    } catch (e) {
      console.error("PTT record start error:", e);
    }
  }, [hasPermission, isSending, audioRecorder, playChirp, scaleAnim]);

  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setIsRecording(false);
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 20 }).start();
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      const durationMs = Date.now() - startTimeRef.current;
      const durationSeconds = Math.round(durationMs / 1000);
      if (!uri || durationSeconds < 1) return;
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await onSend(uri, durationSeconds);
    } catch (e) {
      console.error("PTT record stop error:", e);
    }
  }, [audioRecorder, onSend, scaleAnim]);

  // Use refs so PanResponder always calls the latest callback version
  const startRecordingRef = useRef(startRecording);
  const stopRecordingRef = useRef(stopRecording);
  useEffect(() => { startRecordingRef.current = startRecording; }, [startRecording]);
  useEffect(() => { stopRecordingRef.current = stopRecording; }, [stopRecording]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { startRecordingRef.current(); },
      onPanResponderRelease: () => { stopRecordingRef.current(); },
      onPanResponderTerminate: () => { stopRecordingRef.current(); },
    })
  ).current;

  if (hasPermission === false) {
    return (
      <View style={styles.pttPermDenied}>
        <Text style={{ color: "#fff", textAlign: "center", fontSize: 13 }}>
          Microphone permission denied.{"\n"}Enable it in Settings to use Luxury Talk.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.pttContainer}>
      {isRecording && (
        <View style={styles.recordingIndicator}>
          <View style={[styles.recordingDot, { backgroundColor: "#EF4444" }]} />
          <Text style={[styles.recordingLabel, { color: "#EF4444" }]}>Recording…</Text>
        </View>
      )}
      <Animated.View
        {...(isSending ? {} : panResponder.panHandlers)}
        style={[
          styles.pttBtn,
          {
            backgroundColor: isRecording ? "#EF4444" : isSending ? colors.border : colors.primary,
            shadowColor: isRecording ? "#EF4444" : colors.primary,
            shadowOpacity: isRecording ? 0.5 : 0.25,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {isSending ? (
          <ActivityIndicator color="#fff" size="large" />
        ) : (
          <>
            <Text style={styles.pttIcon}>{isRecording ? "🎙" : "📡"}</Text>
            <Text style={styles.pttLabel}>
              {isRecording ? "Release to Send" : "Hold to Talk"}
            </Text>
          </>
        )}
      </Animated.View>
      <Text style={[styles.pttHint, { color: colors.muted }]}>
        {isRecording
          ? "Speak now — release when done"
          : "Hold the button and speak to your team"}
      </Text>
    </View>
  );
}

// ─── Main PTT Screen ──────────────────────────────────────────────────────────

export default function PttScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { employee } = useEmployeeAuth();
  const flatListRef = useRef<FlatList>(null);
  const [isSending, setIsSending] = useState(false);
  const lastMessageIdRef = useRef<string | null>(null);

  const pttQuery = trpc.chat.getPttMessages.useQuery(
    { limit: 40 },
    { refetchInterval: 60000, refetchOnWindowFocus: false },
  );

  const sendVoiceMutation = trpc.chat.sendVoiceMessage.useMutation();
  const markSeenMutation = trpc.chat.markSeen.useMutation();

  // Mark ptt channel as seen when screen is viewed
  useEffect(() => {
    if (employee?.employeeId) {
      markSeenMutation.mutate({ employeeId: employee.employeeId, channelKey: 'ptt' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.employeeId, pttQuery.data?.length]);

  const messages: VoiceMessage[] = useMemo(() => {
    if (!pttQuery.data) return [];
    return pttQuery.data
      .filter((m: any) => m.audioUrl)
      .map((m: any) => ({
        ...m,
        createdAt: new Date(m.createdAt),
      }));
  }, [pttQuery.data]);

  // Auto-play new incoming messages (not from self)
  const receiveChirpRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const autoPlayRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);

  useEffect(() => {
    if (messages.length === 0) return;
    const latest = messages[messages.length - 1];
    if (latest.messageId === lastMessageIdRef.current) return;
    lastMessageIdRef.current = latest.messageId;

    // Only auto-play if message is from someone else and recent (< 10s old)
    const age = Date.now() - latest.createdAt.getTime();
    if (latest.employeeId !== employee?.employeeId && age < 10000) {
      // Play receive chirp then the voice message
      try {
        receiveChirpRef.current?.remove();
        const chirp = createAudioPlayer(require("@/assets/sounds/nextel-chirp.mp3"));
        receiveChirpRef.current = chirp;
        chirp.play();
        setTimeout(() => {
          chirp.remove();
          autoPlayRef.current?.remove();
          const p = createAudioPlayer({ uri: latest.audioUrl });
          autoPlayRef.current = p;
          p.play();
        }, 600);
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch (_) {}
    }
  }, [messages, employee?.employeeId]);

  useEffect(() => {
    return () => {
      receiveChirpRef.current?.remove();
      autoPlayRef.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 150);
    }
  }, [messages.length]);

  const handleSend = useCallback(async (uri: string, durationSeconds: number) => {
    if (!employee) return;
    setIsSending(true);
    try {
      // Read file as base64
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await sendVoiceMutation.mutateAsync({
        employeeId: employee.employeeId,
        fullName: employee.fullName,
        audioBase64: base64,
        mimeType: "audio/m4a",
        durationSeconds,
        channel: "ptt",
      });
      pttQuery.refetch();
    } catch (e) {
      console.error("PTT send error:", e);
      Alert.alert("Send Failed", "Could not send voice message. Please try again.");
    } finally {
      setIsSending(false);
    }
  }, [employee, sendVoiceMutation, pttQuery]);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: 8, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.onlineIndicator, { backgroundColor: "#22C55E" }]} />
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Luxury Talk</Text>
        </View>
        <Text style={[styles.headerSub, { color: colors.muted }]}>All team members</Text>
      </View>

      {/* Message list */}
      {pttQuery.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.muted }]}>Loading channel…</Text>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.messageId}
          contentContainerStyle={[styles.msgList, { paddingBottom: 12 }]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📡</Text>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                Channel is quiet
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
                Hold the button below to send a voice message to your whole team
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <VoiceBubble
              message={item}
              isMe={item.employeeId === employee?.employeeId}
            />
          )}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
        />
      )}

      {/* PTT Button */}
      <View style={[styles.pttFooter, { paddingBottom: insets.bottom + 16, backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <PttButton onSend={handleSend} isSending={isSending} />
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  loadingText: { fontSize: 14 },

  // Header
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  onlineIndicator: { width: 10, height: 10, borderRadius: 5 },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  headerSub: { fontSize: 13 },

  // Messages
  msgList: { padding: 12, gap: 8 },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 4 },
  msgRowMe: { justifyContent: "flex-end" },
  msgRowOther: { justifyContent: "flex-start" },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  voiceBubble: { maxWidth: "78%", padding: 10, borderRadius: 16 },
  bubbleMe: { borderBottomRightRadius: 4 },
  bubbleOther: { borderBottomLeftRadius: 4 },
  senderName: { fontSize: 12, fontWeight: "600", marginBottom: 6 },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  playBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },
  playIcon: { fontSize: 14 },
  waveform: { flexDirection: "row", alignItems: "center", gap: 2, flex: 1 },
  waveBar: { width: 3, borderRadius: 2 },
  durLabel: { fontSize: 12, minWidth: 24 },
  msgTime: { fontSize: 11, marginTop: 4, textAlign: "right" },

  // Empty state
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, paddingHorizontal: 32, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  emptySubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20 },

  // PTT footer
  pttFooter: { borderTopWidth: 0.5, paddingTop: 16 },
  pttContainer: { alignItems: "center", gap: 12, paddingHorizontal: 24 },
  recordingIndicator: { flexDirection: "row", alignItems: "center", gap: 6 },
  recordingDot: { width: 10, height: 10, borderRadius: 5 },
  recordingLabel: { fontSize: 14, fontWeight: "600" },
  pttBtn: {
    width: 120, height: 120, borderRadius: 60,
    alignItems: "center", justifyContent: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 8,
    gap: 4,
  },
  pttIcon: { fontSize: 36 },
  pttLabel: { color: "#fff", fontSize: 12, fontWeight: "700", textAlign: "center" },
  pttHint: { fontSize: 13, textAlign: "center" },
  pttPermDenied: {
    padding: 16, borderRadius: 12, backgroundColor: "#EF4444",
    margin: 16, alignItems: "center",
  },
});

// ─── Compact Inline PTT Button (for DM/Group chat input bar) ─────────────────
interface InlinePttButtonProps {
  onSend: (uri: string, durationSeconds: number) => Promise<void>;
  isSending: boolean;
}

export function InlinePttButton({ onSend, isSending }: InlinePttButtonProps) {
  const colors = useColors();
  const [isRecording, setIsRecording] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const startTimeRef = useRef<number>(0);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  useEffect(() => {
    (async () => {
      const { granted } = await requestRecordingPermissionsAsync();
      setHasPermission(granted);
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    })();
  }, []);

  const playChirp = useCallback(() => {
    try {
      const p = createAudioPlayer(require("@/assets/sounds/nextel-chirp.mp3"));
      p.play();
      setTimeout(() => p.remove(), 1000);
    } catch (_) {}
  }, []);

  const handlePressIn = useCallback(async () => {
    if (!hasPermission) {
      Alert.alert("Microphone Permission", "Please allow microphone access to use Luxury Talk.");
      return;
    }
    if (isSending) return;
    try {
      playChirp();
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      startTimeRef.current = Date.now();
      setIsRecording(true);
    } catch (e) {
      console.error("Inline PTT start error:", e);
    }
  }, [hasPermission, isSending, audioRecorder, playChirp]);

  const handlePressOut = useCallback(async () => {
    if (!isRecording) return;
    try {
      await audioRecorder.stop();
      setIsRecording(false);
      const uri = audioRecorder.uri;
      const durationSeconds = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
      if (!uri) return;
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await onSend(uri, durationSeconds);
    } catch (e) {
      console.error("Inline PTT stop error:", e);
      setIsRecording(false);
    }
  }, [isRecording, audioRecorder, onSend]);

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={isSending}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: isRecording ? "#EF4444" : isSending ? colors.border : colors.primary,
        transform: [{ scale: isRecording ? 1.1 : pressed ? 0.93 : 1 }],
      })}
    >
      <Text style={{ fontSize: 18 }}>{isRecording ? "🎙" : "📡"}</Text>
    </Pressable>
  );
}
