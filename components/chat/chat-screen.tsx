import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, Platform, KeyboardAvoidingView, Modal,
  StyleSheet, Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import { trpc } from "@/lib/trpc";
import PttScreen, { InlinePttButton, VoiceBubble } from "@/components/chat/ptt-screen";
import CommunityScreen from "@/components/chat/community-screen";
import { CompanyChatScreen } from "@/components/chat/company-chat-screen";
import { useLocalSearchParams } from "expo-router";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  messageId: string;
  employeeId: string;
  fullName: string;
  profilePhotoUrl?: string | null;
  messageText?: string | null;
  imageUrl?: string | null;
  audioUrl?: string | null;
  durationSeconds?: number | null;
  createdAt: Date;
  channel: string;
  recipientId?: string | null;
}

interface TeamMember {
  employeeId: string;
  fullName: string;
  role: string;
  profilePhotoUrl?: string | null;
}

// ─── Group channel config ─────────────────────────────────────────────────────

const GROUP_CHANNELS = [
  { key: "general", label: "General", emoji: "💬", description: "All team members" },
  { key: "admin", label: "Admin", emoji: "🏢", description: "Admin & management" },
  { key: "detailers", label: "Detailers", emoji: "🚗", description: "Detailer team" },
  { key: "sales", label: "Sales", emoji: "📊", description: "Sales team" },
  { key: "door_hangers", label: "Door Hangers", emoji: "🚪", description: "Door hanger reps" },
] as const;

// ─── Conversation Screen ──────────────────────────────────────────────────────

interface ConversationProps {
  title: string;
  subtitle?: string;
  channel: string;
  recipientId?: string;
  recipientName?: string;
  currentEmployeeId: string;
  currentFullName: string;
  onBack: () => void;
}

function ConversationScreen({
  title, subtitle, channel, recipientId, currentEmployeeId, currentFullName, onBack,
}: ConversationProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);

  const channelQuery = trpc.chat.getChannelMessages.useQuery(
    { channel, limit: 60 },
    { enabled: channel !== "dm", refetchInterval: 60000, refetchOnWindowFocus: false },
  );
  const dmQuery = trpc.chat.getDmMessages.useQuery(
    { employeeIdA: currentEmployeeId, employeeIdB: recipientId ?? "", limit: 60 },
    { enabled: channel === "dm" && !!recipientId, refetchInterval: 60000, refetchOnWindowFocus: false },
  );

  const rawMessages = channel === "dm" ? dmQuery.data : channelQuery.data;
  const isLoading = channel === "dm" ? dmQuery.isLoading : channelQuery.isLoading;

  const messages: ChatMessage[] = useMemo(() => {
    if (!rawMessages) return [];
    return rawMessages.map((m: any) => ({
      ...m,
      createdAt: new Date(m.createdAt),
    }));
  }, [rawMessages]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

  const sendMessageMutation = trpc.chat.sendMessage.useMutation();
  const sendVoiceMutation = trpc.chat.sendVoiceMessage.useMutation();
  const markSeenMutation = trpc.chat.markSeen.useMutation();
  const utils = trpc.useUtils();
  const [isSendingVoice, setIsSendingVoice] = useState(false);

  // Mark channel as seen when conversation opens and whenever new messages arrive
  const channelKey = channel === 'dm' && recipientId ? `dm:${recipientId}` : channel;
  useEffect(() => {
    if (currentEmployeeId) {
      markSeenMutation.mutate(
        { employeeId: currentEmployeeId, channelKey },
        {
          onSuccess: () => {
            // Immediately invalidate the unread count so the banner clears right away
            utils.chat.getUnreadCount.invalidate({ employeeId: currentEmployeeId });
          },
        }
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEmployeeId, channelKey, messages.length]);

  const handleVoiceSend = useCallback(async (uri: string, durationSeconds: number) => {
    setIsSendingVoice(true);
    try {
      const base64 = await (await import("expo-file-system/legacy")).readAsStringAsync(uri, {
        encoding: (await import("expo-file-system/legacy")).EncodingType.Base64,
      });
      await sendVoiceMutation.mutateAsync({
        employeeId: currentEmployeeId,
        fullName: currentFullName,
        audioBase64: base64,
        mimeType: "audio/m4a",
        durationSeconds,
        channel: channel === "dm" ? "dm" : channel,
        recipientId: recipientId ?? undefined,
      });
      if (channel === "dm") {
        dmQuery.refetch();
      } else {
        channelQuery.refetch();
      }
    } catch (e) {
      console.error("Voice send error:", e);
    } finally {
      setIsSendingVoice(false);
    }
  }, [currentEmployeeId, currentFullName, channel, recipientId, sendVoiceMutation, dmQuery, channelQuery]);

  const handleSend = useCallback(async () => {
    const text = messageText.trim();
    if (!text || isSending) return;
    setIsSending(true);
    setMessageText("");
    try {
      await sendMessageMutation.mutateAsync({
        employeeId: currentEmployeeId,
        fullName: currentFullName,
        messageText: text,
        channel,
        recipientId: recipientId ?? undefined,
      });
      if (channel === "dm") {
        dmQuery.refetch();
      } else {
        channelQuery.refetch();
      }
    } finally {
      setIsSending(false);
    }
  }, [messageText, isSending, currentEmployeeId, currentFullName, channel, recipientId]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isMe = item.employeeId === currentEmployeeId;
    return (
      <View style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowOther]}>
        {!isMe && (
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>
              {item.fullName.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={[
          styles.bubble,
          isMe
            ? [styles.bubbleMe, { backgroundColor: colors.primary }]
            : [styles.bubbleOther, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }],
        ]}>
          {!isMe && (
            <Text style={[styles.senderName, { color: colors.primary }]}>{item.fullName}</Text>
          )}
          {item.audioUrl ? (
            <VoiceBubble
              message={{ messageId: item.messageId, employeeId: item.employeeId, fullName: item.fullName, audioUrl: item.audioUrl, durationSeconds: (item as any).durationSeconds ?? null, createdAt: item.createdAt }}
              isMe={isMe}
            />
          ) : item.messageText ? (
            <Text style={[styles.msgText, { color: isMe ? "#fff" : colors.foreground }]}>
              {item.messageText}
            </Text>
          ) : null}
          <Text style={[styles.msgTime, { color: isMe ? "rgba(255,255,255,0.7)" : colors.muted }]}>
            {formatTime(item.createdAt)}
          </Text>
        </View>
      </View>
    );
  }, [currentEmployeeId, colors]);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.convHeader, { paddingTop: 8, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={[styles.backArrow, { color: colors.primary }]}>←</Text>
        </TouchableOpacity>
        <View style={styles.convHeaderInfo}>
          <Text style={[styles.convTitle, { color: colors.foreground }]} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={[styles.convSubtitle, { color: colors.muted }]}>{subtitle}</Text> : null}
        </View>
      </View>

      {/* Messages */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.messageId}
          renderItem={renderMessage}
          contentContainerStyle={styles.msgList}
          ListEmptyComponent={
            <View style={styles.emptyMsg}>
              <Text style={[styles.emptyMsgText, { color: colors.muted }]}>No messages yet. Say hello!</Text>
            </View>
          }
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Input */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={insets.bottom + 60}>
        <View style={[styles.inputBar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
            value={messageText}
            onChangeText={setMessageText}
            placeholder="Type a message..."
            placeholderTextColor={colors.muted}
            multiline
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={!messageText.trim() || isSending}
            style={[styles.sendBtn, { backgroundColor: messageText.trim() ? colors.primary : colors.border }]}
            activeOpacity={0.8}
          >
            {isSending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.sendBtnText}>↑</Text>
            )}
          </TouchableOpacity>
          <InlinePttButton onSend={handleVoiceSend} isSending={isSendingVoice} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── New DM Picker Modal ──────────────────────────────────────────────────────

interface NewDmModalProps {
  visible: boolean;
  members: TeamMember[];
  currentEmployeeId: string;
  onSelect: (member: TeamMember) => void;
  onClose: () => void;
}

function NewDmModal({ visible, members, currentEmployeeId, onSelect, onClose }: NewDmModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return members.filter(
      (m) => m.employeeId !== currentEmployeeId && m.fullName.toLowerCase().includes(q),
    );
  }, [members, currentEmployeeId, search]);

  const roleLabel = (role: string) => {
    const map: Record<string, string> = {
      admin: "Admin", detailer: "Detailer", office: "Office",
      operations_manager: "Ops Manager", door_hanger_rep: "Door Hanger", sales: "Sales",
    };
    return map[role] ?? role;
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <View style={[styles.dmPickerHeader, { paddingTop: 8, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <Text style={[styles.dmPickerTitle, { color: colors.foreground }]}>New Message</Text>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Text style={[styles.dmPickerClose, { color: colors.primary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.searchBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TextInput
            style={[styles.searchInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
            value={search}
            onChangeText={setSearch}
            placeholder="Search team members..."
            placeholderTextColor={colors.muted}
            autoFocus
          />
        </View>
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={filtered}
          keyExtractor={(item) => item.employeeId}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.memberRow, { borderBottomColor: colors.border }]}
              onPress={() => { onSelect(item); setSearch(""); }}
              activeOpacity={0.7}
            >
              <View style={[styles.memberAvatar, { backgroundColor: colors.primary }]}>
                <Text style={styles.avatarText}>{item.fullName.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.memberInfo}>
                <Text style={[styles.memberName, { color: colors.foreground }]}>{item.fullName}</Text>
                <Text style={[styles.memberRole, { color: colors.muted }]}>{roleLabel(item.role)}</Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyMsg}>
              <Text style={[styles.emptyMsgText, { color: colors.muted }]}>No team members found</Text>
            </View>
          }
        />
      </View>
    </Modal>
  );
}

// ─── Main Chat Screen ─────────────────────────────────────────────────────────

type View_ = "inbox" | "conversation";

export default function ChatScreen() {
  const { session } = useJobSyncAuth();
  if (session?.portal === "company" && session.company) {
    return <CompanyChatScreen token={session.token} companyId={session.company.id} userId={session.user.id} userName={session.user.name} role={session.user.role} />;
  }
  return <LegacyChatScreen />;
}

function LegacyChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { employee } = useEmployeeAuth();
  const params = useLocalSearchParams<{ openChannel?: string; openSenderId?: string; openSenderName?: string; openTab?: string }>();

  const [activeTab, setActiveTab] = useState<"groups" | "dms" | "community">("community");
  const [view, setView] = useState<View_>("inbox");
  const [activeConversation, setActiveConversation] = useState<ConversationProps | null>(null);
  const [showNewDm, setShowNewDm] = useState(false);
  const deepLinkHandled = useRef(false);

  const teamMembersQuery = trpc.chat.getTeamMembers.useQuery(undefined, { staleTime: 60_000 });
  const dmConvsQuery = trpc.chat.getDmConversations.useQuery(
    { employeeId: employee?.employeeId ?? "" },
    { enabled: !!employee?.employeeId, refetchInterval: 30000, refetchOnWindowFocus: false },
  );

  const teamMembers: TeamMember[] = useMemo(() => teamMembersQuery.data ?? [], [teamMembersQuery.data]);

  const dmConversations = useMemo(() => {
    if (!dmConvsQuery.data || !employee) return [];
    return dmConvsQuery.data.map((msg: any) => {
      const otherId = msg.employeeId === employee.employeeId ? msg.recipientId : msg.employeeId;
      const otherName = msg.employeeId === employee.employeeId
        ? (teamMembers.find((m) => m.employeeId === msg.recipientId)?.fullName ?? msg.recipientId)
        : msg.fullName;
      return {
        otherId,
        otherName,
        lastMessage: msg.messageText ?? "📷 Image",
        lastAt: new Date(msg.createdAt),
        unreadCount: msg.unreadCount ?? 0,
      };
    });
  }, [dmConvsQuery.data, employee, teamMembers]);

  const formatDmTime = (date: Date) => {
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const y = String(date.getFullYear()).slice(2);
    const h = date.getHours();
    const min = String(date.getMinutes()).padStart(2, "0");
    const period = h >= 12 ? "PM" : "AM";
    const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${m}/${d}/${y} ${hr}:${min} ${period}`;
  };

  // Handle deep-link from push notification tap
  useEffect(() => {
    if (deepLinkHandled.current) return;
    if (!employee) return;
    const { openChannel, openSenderId, openSenderName, openTab } = params;
    if (!openChannel && !openSenderId) return;
    deepLinkHandled.current = true;

    if (openChannel === 'dm' && openSenderId) {
      // Open a specific DM conversation
      const name = openSenderName ?? openSenderId;
      setActiveTab('dms');
      setActiveConversation({
        title: name,
        subtitle: 'Direct message',
        channel: 'dm',
        recipientId: openSenderId,
        currentEmployeeId: employee.employeeId,
        currentFullName: employee.fullName,
        onBack: () => setView('inbox'),
      });
      setView('conversation');
    } else if (openChannel && openChannel !== 'dm') {
      // Open a group channel
      const ch = GROUP_CHANNELS.find(c => c.key === openChannel);
      if (ch) {
        setActiveTab('groups');
        setActiveConversation({
          title: ch.label,
          subtitle: ch.description,
          channel: ch.key,
          currentEmployeeId: employee.employeeId,
          currentFullName: employee.fullName,
          onBack: () => setView('inbox'),
        });
        setView('conversation');
      }
    } else if (openTab === 'community') {
      setActiveTab('community');
    }
  }, [params, employee]);

  const openGroupChannel = useCallback((ch: typeof GROUP_CHANNELS[number]) => {
    if (!employee) return;
    setActiveConversation({
      title: ch.label,
      subtitle: ch.description,
      channel: ch.key,
      currentEmployeeId: employee.employeeId,
      currentFullName: employee.fullName,
      onBack: () => setView("inbox"),
    });
    setView("conversation");
  }, [employee]);

  const openDm = useCallback((otherId: string, otherName: string) => {
    if (!employee) return;
    setActiveConversation({
      title: otherName,
      subtitle: "Direct message",
      channel: "dm",
      recipientId: otherId,
      currentEmployeeId: employee.employeeId,
      currentFullName: employee.fullName,
      onBack: () => setView("inbox"),
    });
    setView("conversation");
  }, [employee]);

  if (view === "conversation" && activeConversation) {
    return <ConversationScreen {...activeConversation} onBack={() => setView("inbox")} />;
  }

  return (
    <ScreenContainer edges={["left", "right"]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Team Chat</Text>
        {activeTab === "dms" && (
          <TouchableOpacity onPress={() => setShowNewDm(true)} activeOpacity={0.7} style={[styles.newDmBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.newDmBtnText}>+ New</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      <View style={[styles.tabBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        {(["groups", "dms", "community"] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, { color: activeTab === tab ? colors.primary : colors.muted }]}>
              {tab === "groups" ? "Groups" : tab === "dms" ? "Direct" : "Community"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {activeTab === "community" ? (
        <CommunityScreen />
      ) : activeTab === "groups" ? (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={GROUP_CHANNELS}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.channelRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => openGroupChannel(item)}
              activeOpacity={0.75}
            >
              <View style={[styles.channelEmoji]}>
                <Text style={styles.channelEmojiText}>{item.emoji}</Text>
              </View>
              <View style={styles.channelInfo}>
                <Text style={[styles.channelName, { color: colors.foreground }]}>{item.label}</Text>
                <Text style={[styles.channelDesc, { color: colors.muted }]}>{item.description}</Text>
              </View>
              <Text style={[styles.chevron, { color: colors.muted }]}>›</Text>
            </TouchableOpacity>
          )}
        />
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={dmConversations}
          keyExtractor={(item) => item.otherId ?? ""}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyMsg}>
              <Text style={[styles.emptyMsgText, { color: colors.muted }]}>No direct messages yet.</Text>
              <TouchableOpacity onPress={() => setShowNewDm(true)} style={[styles.startDmBtn, { backgroundColor: colors.primary }]} activeOpacity={0.8}>
                <Text style={styles.startDmBtnText}>Start a conversation</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.dmRow, { backgroundColor: colors.surface, borderColor: item.unreadCount > 0 ? colors.primary : colors.border }]}
              onPress={() => openDm(item.otherId ?? "", item.otherName)}
              activeOpacity={0.75}
            >
              <View style={{ position: "relative" }}>
                <View style={[styles.memberAvatar, { backgroundColor: colors.primary }]}>
                  <Text style={styles.avatarText}>{item.otherName.charAt(0).toUpperCase()}</Text>
                </View>
                {item.unreadCount > 0 && (
                  <View style={{
                    position: "absolute", top: -4, right: -4,
                    backgroundColor: "#EF4444", borderRadius: 10,
                    minWidth: 18, height: 18, alignItems: "center", justifyContent: "center",
                    paddingHorizontal: 4, borderWidth: 1.5, borderColor: colors.surface,
                  }}>
                    <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>
                      {item.unreadCount > 99 ? "99+" : String(item.unreadCount)}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.dmInfo}>
                <Text style={[styles.memberName, { color: colors.foreground, fontWeight: item.unreadCount > 0 ? "700" : "600" }]}>{item.otherName}</Text>
                <Text style={[styles.dmLastMsg, { color: item.unreadCount > 0 ? colors.foreground : colors.muted, fontWeight: item.unreadCount > 0 ? "500" : "400" }]} numberOfLines={1}>{item.lastMessage}</Text>
              </View>
              <Text style={[styles.dmTime, { color: item.unreadCount > 0 ? colors.primary : colors.muted, fontWeight: item.unreadCount > 0 ? "600" : "400", fontSize: 11 }]}>
                {formatDmTime(item.lastAt)}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* New DM picker */}
      <NewDmModal
        visible={showNewDm}
        members={teamMembers}
        currentEmployeeId={employee?.employeeId ?? ""}
        onSelect={(member) => {
          setShowNewDm(false);
          openDm(member.employeeId, member.fullName);
        }}
        onClose={() => setShowNewDm(false)}
      />
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5 },
  headerTitle: { fontSize: 22, fontWeight: "700" },
  newDmBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  newDmBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  tabBar: { flexDirection: "row", borderBottomWidth: 0.5 },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabText: { fontSize: 14, fontWeight: "600" },
  listContent: { padding: 12, gap: 8 },
  channelRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1, gap: 12 },
  channelEmoji: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(10,126,164,0.12)" },
  channelEmojiText: { fontSize: 22 },
  channelInfo: { flex: 1 },
  channelName: { fontSize: 16, fontWeight: "600" },
  channelDesc: { fontSize: 13, marginTop: 2 },
  chevron: { fontSize: 22, fontWeight: "300" },
  dmRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 1, gap: 12 },
  dmInfo: { flex: 1 },
  dmLastMsg: { fontSize: 13, marginTop: 2 },
  dmTime: { fontSize: 12 },
  emptyMsg: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyMsgText: { fontSize: 15 },
  startDmBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  startDmBtnText: { color: "#fff", fontWeight: "600" },
  // Conversation
  convHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 0.5, gap: 8 },
  backBtn: { padding: 8 },
  backArrow: { fontSize: 26, fontWeight: "300" },
  convHeaderInfo: { flex: 1 },
  convTitle: { fontSize: 17, fontWeight: "700" },
  convSubtitle: { fontSize: 13, marginTop: 1 },
  msgList: { padding: 12, gap: 8, paddingBottom: 16 },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 4 },
  msgRowMe: { justifyContent: "flex-end" },
  msgRowOther: { justifyContent: "flex-start" },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  memberAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  bubble: { maxWidth: "75%", padding: 10, borderRadius: 16 },
  bubbleMe: { borderBottomRightRadius: 4 },
  bubbleOther: { borderBottomLeftRadius: 4 },
  senderName: { fontSize: 12, fontWeight: "600", marginBottom: 3 },
  msgText: { fontSize: 15, lineHeight: 21 },
  msgTime: { fontSize: 11, marginTop: 4, textAlign: "right" },
  inputBar: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 0.5, gap: 8 },
  input: { flex: 1, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  sendBtnText: { color: "#fff", fontSize: 20, fontWeight: "700" },
  // DM picker
  dmPickerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5 },
  dmPickerTitle: { fontSize: 18, fontWeight: "700" },
  dmPickerClose: { fontSize: 16, fontWeight: "500" },
  searchBar: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 0.5 },
  searchInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 },
  memberRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, gap: 12 },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 16, fontWeight: "600" },
  memberRole: { fontSize: 13, marginTop: 2 },
});
