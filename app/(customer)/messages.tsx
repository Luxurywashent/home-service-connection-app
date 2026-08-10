import React, { useState, useRef, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView,
  Platform, ActivityIndicator, StyleSheet, Alert, Image, ScrollView,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { useCustomerAuth } from "@/lib/customer-context";
import { useFocusEffect, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { getApiBaseUrl } from "@/constants/oauth";
import Svg, { Path } from "react-native-svg";
import { Modal } from "react-native";

// Luxury Wash Icon Component
function LuxuryWashIcon({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 12c0-1.5 1-2.5 2-3v-1c0-1 .5-2 1.5-2h1V4h2v2h4V4h2v2h1c1 0 1.5 1 1.5 2v1c1 .5 2 1.5 2 3v6c0 .5-.5 1-1 1H5c-.5 0-1-.5-1-1v-6z"
        fill="#0a7ea4"
      />
    </Svg>
  );
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Static demo messages shown blurred in the background for guests
const DEMO_MESSAGES = [
  { id: 1, isOut: false, body: "Hi! I wanted to ask about the premium detail package.", time: "2d ago" },
  { id: 2, isOut: true, name: "Luxury Wash", body: "Of course! Our premium package includes a full interior & exterior detail, ceramic coating prep, and tire shine. Would you like to book?", time: "2d ago" },
  { id: 3, isOut: false, body: "Yes, I'd love to! Can I get a Saturday appointment?", time: "2d ago" },
  { id: 4, isOut: true, name: "Luxury Wash", body: "Absolutely! We have availability this Saturday at 10am or 2pm. Which works best for you?", time: "1d ago" },
  { id: 5, isOut: false, body: "10am works perfectly, thank you!", time: "1d ago" },
  { id: 6, isOut: true, name: "Luxury Wash", body: "Great! You're all set for Saturday at 10am. We'll send a reminder the night before. 🚗✨", time: "1d ago" },
  { id: 7, isOut: false, body: "Amazing, can't wait!", time: "23h ago" },
];

export default function CustomerMessagesScreen() {
  const colors = useColors();
  const { token } = useCustomerAuth();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [messageText, setMessageText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  // When the messages screen comes into focus, invalidate the unread badge count
  // so the red dot disappears immediately (getMessages already marks them read server-side)
  useFocusEffect(
    useCallback(() => {
      if (token) {
        utils.customer.unreadCount.invalidate({ token });
      }
    }, [token, utils])
  );

  const { data: messages = [], refetch, isLoading } = trpc.customer.getMessages.useQuery(
    { token: token ?? "" },
    { enabled: !!token, refetchInterval: 60000 }
  );

  const sendMutation = trpc.customer.sendMessage.useMutation({
    onSuccess: () => {
      setMessageText("");
      refetch();
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 200);
    },
    onError: (e) => Alert.alert("Send Failed", e.message),
  });

  const handleSend = useCallback(() => {
    const body = messageText.trim();
    if (!body || !token) return;
    sendMutation.mutate({ token, body });
  }, [messageText, token]);

  const handlePickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploading(true);

      // Upload to server
      const formData = new FormData();
      const uri = asset.uri;
      const filename = uri.split("/").pop() || `photo-${Date.now()}.jpg`;
      const type = asset.mimeType || "image/jpeg";
      formData.append("file", { uri, name: filename, type } as any);

      const apiBase = getApiBaseUrl();
      const response = await fetch(`${apiBase}/api/upload`, {
        method: "POST",
        body: formData,
        headers: { "Content-Type": "multipart/form-data" },
      });
      const data = await response.json();
      if (!data.url) throw new Error("Upload failed");

      // Send as a message with image
      if (token) {
        sendMutation.mutate({ token, body: messageText.trim() || "📷 Image", imageUrl: data.url });
      }
    } catch (e: any) {
      Alert.alert("Upload Failed", e.message ?? "Could not upload image");
    } finally {
      setUploading(false);
    }
  };

  // ── Guest view: blurred demo messages + sign-in overlay ──────────────────
  if (!token) {
    return (
      <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
        <StatusBar style="dark" />

        {/* Header */}
        <View style={[styles.header, { backgroundColor: "#FFFFFF", borderBottomColor: "#E5E7EB" }]}>
          <View style={[styles.avatarSmall, { backgroundColor: "#0a7ea422" }]}>
            <LuxuryWashIcon size={24} />
          </View>
          <View style={{ marginLeft: 10 }}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Luxury Wash On Wheels</Text>
            <Text style={[styles.headerSub, { color: colors.muted }]}>We typically reply within a few hours</Text>
          </View>
        </View>

        {/* Demo messages (non-interactive, blurred) */}
        <View style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
            scrollEnabled={false}
            pointerEvents="none"
          >
            {DEMO_MESSAGES.map((msg) => (
              <View
                key={msg.id}
                style={[styles.bubbleRow, msg.isOut ? styles.bubbleRowOut : styles.bubbleRowIn]}
              >
                {!msg.isOut && (
                  <View style={[styles.avatarTiny, { backgroundColor: "#0a7ea422" }]}>
                    <LuxuryWashIcon size={16} />
                  </View>
                )}
                <View
                  style={[
                    styles.bubble,
                    msg.isOut
                      ? [styles.bubbleOut, { backgroundColor: colors.primary }]
                      : [styles.bubbleIn, { backgroundColor: colors.surface }],
                  ]}
                >
                  {!msg.isOut && msg.name && (
                    <Text style={[styles.senderName, { color: colors.primary }]}>{msg.name}</Text>
                  )}
                  <Text style={[styles.bubbleText, { color: msg.isOut ? "#fff" : colors.foreground }]}>
                    {msg.body}
                  </Text>
                  <Text style={[styles.bubbleMeta, { color: msg.isOut ? "rgba(255,255,255,0.65)" : colors.muted }]}>
                    {msg.time}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>

          {/* Blur layer */}
          <View
            style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(255,255,255,0.6)' }]}
            pointerEvents="none"
          />

          {/* Sign-in overlay */}
          <View style={styles.guestOverlay}>
            <View style={styles.guestCard}>
              <Text style={styles.guestIcon}>💬</Text>
              <Text style={styles.guestTitle}>Sign In to Message Us</Text>
              <Text style={styles.guestSub}>
                Create an account to chat directly with our team about your booking, service questions, or anything else.
              </Text>
              <TouchableOpacity
                style={styles.signInBtn}
                onPress={() => router.push("/login")}
                activeOpacity={0.85}
              >
                <Text style={styles.signInBtnText}>Sign In / Create Account</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  // ── Authenticated view ────────────────────────────────────────────────────
  return (
    <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
      <StatusBar style="dark" />
      {/* Header */}
      <View style={[styles.header, { backgroundColor: "#FFFFFF", borderBottomColor: "#E5E7EB" }]}>
        <View style={[styles.avatarSmall, { backgroundColor: "#0a7ea422" }]}>
          <Text style={{ fontSize: 20 }}>🚗</Text>
        </View>
        <View style={{ marginLeft: 10 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Luxury Wash On Wheels</Text>
          <Text style={[styles.headerSub, { color: colors.muted }]}>We typically reply within a few hours</Text>
        </View>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={120}
      >
        {isLoading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
        ) : messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>💬</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Start a Conversation</Text>
            <Text style={[styles.emptySub, { color: colors.muted }]}>
              Have a question about your booking or service? Send us a message and we'll get back to you shortly.
            </Text>
          </View>
        ) : (
          <FlatList
            windowSize={5}
            maxToRenderPerBatch={8}
            initialNumToRender={10}
            ref={flatListRef}
            data={messages as any[]}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => {
              const isOut = item.direction === "inbound"; // customer sent = right side
              return (
                <View style={[styles.bubbleRow, isOut ? styles.bubbleRowOut : styles.bubbleRowIn]}>
                  {!isOut && (
                    <View style={[styles.avatarTiny, { backgroundColor: "#0a7ea422" }]}>
                      <Text style={{ fontSize: 12 }}>🚗</Text>
                    </View>
                  )}
                  <View style={[
                    styles.bubble,
                    isOut
                      ? [styles.bubbleOut, { backgroundColor: colors.primary }]
                      : [styles.bubbleIn, { backgroundColor: colors.surface }],
                  ]}>
                    {!isOut && item.sentByName && (
                      <Text style={[styles.senderName, { color: colors.primary }]}>{item.sentByName}</Text>
                    )}
                    {/* Image attachment */}
                    {item.imageUrl && (
                      <TouchableOpacity
                        onPress={() => setSelectedImageUrl(item.imageUrl)}
                        activeOpacity={0.8}
                      >
                        <Image
                          source={{ uri: item.imageUrl }}
                          style={styles.messageImage}
                          resizeMode="cover"
                        />
                      </TouchableOpacity>
                    )}
                    {/* Only show body text if it's not just the default image placeholder */}
                    {item.body && item.body !== "📷 Image" && (
                      <Text style={[styles.bubbleText, { color: isOut ? "#fff" : colors.foreground }]}>
                        {item.body}
                      </Text>
                    )}
                    <Text style={[styles.bubbleMeta, { color: isOut ? "rgba(255,255,255,0.65)" : colors.muted }]}>
                      {timeAgo(item.createdAt)}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        )}

        {/* Input */}
        <View style={[styles.inputRow, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          {/* Image picker button */}
          <TouchableOpacity
            style={[styles.imageBtn, { opacity: uploading ? 0.4 : 1 }]}
            onPress={handlePickImage}
            disabled={uploading || sendMutation.isPending}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={{ fontSize: 22 }}>📷</Text>
            )}
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
            value={messageText}
            onChangeText={setMessageText}
            placeholder="Type a message..."
            placeholderTextColor={colors.muted}
            multiline
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: colors.primary, opacity: sendMutation.isPending || !messageText.trim() ? 0.5 : 1 }]}
            onPress={handleSend}
            disabled={sendMutation.isPending || !messageText.trim()}
          >
            {sendMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 18 }}>↑</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Full-screen image viewer modal */}
      <Modal
        visible={!!selectedImageUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedImageUrl(null)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center", alignItems: "center" }}>
          {selectedImageUrl && (
            <TouchableOpacity
              style={{ flex: 1, justifyContent: "center", alignItems: "center", width: "100%" }}
              onPress={() => setSelectedImageUrl(null)}
              activeOpacity={1}
            >
              <Image
                source={{ uri: selectedImageUrl }}
                style={{ width: "90%", height: "80%", resizeMode: "contain" }}
              />
            </TouchableOpacity>
          )}
          {/* Close button */}
          <TouchableOpacity
            style={{
              position: "absolute",
              top: 50,
              right: 20,
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: "rgba(255,255,255,0.2)",
              justifyContent: "center",
              alignItems: "center",
            }}
            onPress={() => setSelectedImageUrl(null)}
          >
            <Text style={{ fontSize: 24, color: "#fff", fontWeight: "bold" }}>✕</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  headerTitle: { fontSize: 15, fontWeight: "700" },
  headerSub: { fontSize: 12, marginTop: 1 },
  avatarSmall: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarTiny: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", marginRight: 6, alignSelf: "flex-end" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyTitle: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  emptySub: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  bubbleRow: { flexDirection: "row", marginBottom: 10, alignItems: "flex-end" },
  bubbleRowOut: { justifyContent: "flex-end" },
  bubbleRowIn: { justifyContent: "flex-start" },
  bubble: { maxWidth: "78%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleOut: { borderBottomRightRadius: 4 },
  bubbleIn: { borderBottomLeftRadius: 4 },
  senderName: { fontSize: 11, fontWeight: "700", marginBottom: 2 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleMeta: { fontSize: 11, marginTop: 4, textAlign: "right" },
  messageImage: { width: 200, height: 150, borderRadius: 12, marginBottom: 6, marginTop: 2 },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 14,
    paddingBottom: 18,
    borderTopWidth: 0.5,
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    maxHeight: 120,
    minHeight: 48,
  },
  imageBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  // Guest overlay styles
  guestOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  guestCard: {
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
    width: "100%",
    maxWidth: 340,
  },
  guestIcon: { fontSize: 44, marginBottom: 16 },
  guestTitle: { fontSize: 20, fontWeight: "700", color: "#11181C", textAlign: "center", marginBottom: 10 },
  guestSub: { fontSize: 14, color: "#687076", textAlign: "center", lineHeight: 21, marginBottom: 24 },
  signInBtn: {
    backgroundColor: "#0057FF",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
    width: "100%",
    alignItems: "center",
  },
  signInBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
