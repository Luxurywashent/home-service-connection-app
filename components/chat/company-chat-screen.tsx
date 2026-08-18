import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import {
  createHomeServiceConnectedChatGroup,
  getHomeServiceConnectedChatGroups,
  getHomeServiceConnectedGroupMessages,
  getJobSyncCompanyMembers,
  sendHomeServiceConnectedGroupMessage,
  type HomeServiceConnectedChatGroup,
  type HomeServiceConnectedChatMessage,
} from "@/lib/jobsync-mobile-api";

type Props = {
  token: string;
  companyId: number;
  userId: number;
  userName: string;
  role: string;
};

export function CompanyChatScreen({ token, companyId, userId, userName, role }: Props) {
  const colors = useColors();
  const [groups, setGroups] = useState<HomeServiceConnectedChatGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<HomeServiceConnectedChatGroup | null>(null);

  const canManageGroups = role === "owner" || role === "dispatcher";

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setGroups(await getHomeServiceConnectedChatGroups(token));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Team Chat groups.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (selectedGroup) {
    return <CompanyGroupConversation token={token} userId={userId} userName={userName} group={selectedGroup} onBack={() => setSelectedGroup(null)} />;
  }

  return (
    <ScreenContainer edges={["left", "right"]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Team Chat</Text>
        {canManageGroups ? (
          <TouchableOpacity style={[styles.newGroupButton, { backgroundColor: colors.primary }]} onPress={() => setCreating(true)}>
            <Text style={styles.newGroupText}>+ New Group</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={[styles.sectionIntro, { color: colors.muted }]}>Company groups</Text>
      {loading ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : null}
      {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}
      {!loading ? (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={loading}
          onRefresh={() => { setLoading(true); void refresh(); }}
          ListEmptyComponent={<Text style={[styles.empty, { color: colors.muted }]}>No groups yet. {canManageGroups ? "Create the first group for your Company." : "Ask a Company Admin to create a group."}</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={[styles.groupRow, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => setSelectedGroup(item)}>
              <View style={[styles.emojiCircle, { backgroundColor: colors.background }]}><Text style={styles.emoji}>{item.emoji}</Text></View>
              <View style={styles.groupBody}>
                <Text style={[styles.groupName, { color: colors.foreground }]}>{item.name}</Text>
                <Text style={[styles.groupDescription, { color: colors.muted }]} numberOfLines={1}>{item.description || `${item.memberIds.length || "Company"} members`}</Text>
              </View>
              <Text style={[styles.chevron, { color: colors.muted }]}>›</Text>
            </TouchableOpacity>
          )}
        />
      ) : null}
      <NewGroupModal
        visible={creating}
        token={token}
        companyId={companyId}
        onClose={() => setCreating(false)}
        onCreated={async () => { setCreating(false); setLoading(true); await refresh(); }}
      />
    </ScreenContainer>
  );
}

function NewGroupModal({ visible, token, companyId, onClose, onCreated }: { visible: boolean; token: string; companyId: number; onClose: () => void; onCreated: () => Promise<void> }) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("💬");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async () => {
    try {
      setSaving(true); setError(null);
      const roster = await getJobSyncCompanyMembers(token, companyId);
      await createHomeServiceConnectedChatGroup(token, { name, description, emoji, memberIds: roster.members.map((member) => String(member.id)) });
      setName(""); setDescription(""); setEmoji("💬");
      await onCreated();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create the group.");
    } finally { setSaving(false); }
  }, [companyId, description, emoji, name, onCreated, token]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScreenContainer edges={["top", "bottom", "left", "right"]} className="p-5">
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose}><Text style={[styles.modalCancel, { color: colors.primary }]}>Cancel</Text></TouchableOpacity>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>New Group</Text>
          <View style={{ width: 50 }} />
        </View>
        <Text style={[styles.fieldLabel, { color: colors.muted }]}>GROUP NAME</Text>
        <TextInput value={name} onChangeText={setName} placeholder="e.g. Field Operations" placeholderTextColor={colors.muted} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]} />
        <Text style={[styles.fieldLabel, { color: colors.muted }]}>DESCRIPTION</Text>
        <TextInput value={description} onChangeText={setDescription} placeholder="Who should use this group?" placeholderTextColor={colors.muted} multiline style={[styles.input, styles.descriptionInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]} />
        <Text style={[styles.fieldLabel, { color: colors.muted }]}>ICON</Text>
        <TextInput value={emoji} onChangeText={setEmoji} maxLength={4} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]} />
        <Text style={[styles.helper, { color: colors.muted }]}>New groups include all active Company team members. Membership can be adjusted in Company group settings.</Text>
        {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}
        <TouchableOpacity disabled={saving || !name.trim()} onPress={() => void create()} style={[styles.createButton, { backgroundColor: colors.primary, opacity: saving || !name.trim() ? 0.6 : 1 }]}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.createButtonText}>Create Group</Text>}
        </TouchableOpacity>
      </ScreenContainer>
    </Modal>
  );
}

function CompanyGroupConversation({ token, userId, userName, group, onBack }: { token: string; userId: number; userName: string; group: HomeServiceConnectedChatGroup; onBack: () => void }) {
  const colors = useColors();
  const [messages, setMessages] = useState<HomeServiceConnectedChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setError(null); setMessages(await getHomeServiceConnectedGroupMessages(token, group.id)); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load group messages."); }
    finally { setLoading(false); }
  }, [group.id, token]);
  useEffect(() => { void refresh(); }, [refresh]);
  const send = useCallback(async () => {
    if (!text.trim() || sending) return;
    try { setSending(true); await sendHomeServiceConnectedGroupMessage(token, group.id, text); setText(""); await refresh(); }
    catch (sendError) { setError(sendError instanceof Error ? sendError.message : "Unable to send message."); }
    finally { setSending(false); }
  }, [group.id, refresh, sending, text, token]);
  const rendered = useMemo(() => messages.map((message) => ({ ...message, mine: String(message.senderId) === String(userId) || message.senderName === userName })), [messages, userId, userName]);
  return (
    <ScreenContainer edges={["left", "right"]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}><TouchableOpacity onPress={onBack}><Text style={[styles.modalCancel, { color: colors.primary }]}>‹ Back</Text></TouchableOpacity><Text style={[styles.headerTitle, { color: colors.foreground }]}>{group.emoji} {group.name}</Text><View style={{ width: 50 }} /></View>
      {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}
      {loading ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : <FlatList data={rendered} keyExtractor={(item) => item.id} contentContainerStyle={styles.messages} renderItem={({ item }) => <View style={[styles.messageBubble, { alignSelf: item.mine ? "flex-end" : "flex-start", backgroundColor: item.mine ? colors.primary : colors.surface }]}><Text style={[styles.messageSender, { color: item.mine ? "#fff" : colors.muted }]}>{item.mine ? "You" : item.senderName}</Text><Text style={[styles.messageText, { color: item.mine ? "#fff" : colors.foreground }]}>{item.text}</Text></View>} />}
      <View style={[styles.composer, { borderTopColor: colors.border }]}><TextInput value={text} onChangeText={setText} placeholder="Message group" placeholderTextColor={colors.muted} style={[styles.composerInput, { color: colors.foreground, backgroundColor: colors.surface }]} /><TouchableOpacity disabled={sending || !text.trim()} onPress={() => void send()} style={[styles.sendButton, { backgroundColor: colors.primary, opacity: sending || !text.trim() ? 0.6 : 1 }]}><Text style={styles.sendText}>Send</Text></TouchableOpacity></View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14 },
  headerTitle: { fontSize: 22, fontWeight: "800" }, newGroupButton: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }, newGroupText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  sectionIntro: { fontSize: 14, fontWeight: "700", paddingHorizontal: 20, paddingTop: 16, textTransform: "uppercase" }, loader: { marginTop: 36 }, list: { padding: 20, gap: 12 },
  groupRow: { alignItems: "center", borderRadius: 18, borderWidth: 1, flexDirection: "row", minHeight: 92, padding: 14 }, emojiCircle: { alignItems: "center", borderRadius: 28, height: 56, justifyContent: "center", marginRight: 14, width: 56 }, emoji: { fontSize: 27 }, groupBody: { flex: 1 }, groupName: { fontSize: 19, fontWeight: "800" }, groupDescription: { fontSize: 14, marginTop: 3 }, chevron: { fontSize: 30, fontWeight: "300" },
  empty: { fontSize: 15, lineHeight: 22, paddingHorizontal: 24, paddingTop: 40, textAlign: "center" }, error: { fontSize: 13, lineHeight: 18, padding: 14, textAlign: "center" },
  modalHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 28 }, modalTitle: { fontSize: 21, fontWeight: "800" }, modalCancel: { fontSize: 15, fontWeight: "700" }, fieldLabel: { fontSize: 12, fontWeight: "800", marginBottom: 8, marginTop: 18 }, input: { borderRadius: 12, borderWidth: 1, fontSize: 16, minHeight: 52, paddingHorizontal: 14 }, descriptionInput: { minHeight: 90, paddingTop: 12, textAlignVertical: "top" }, helper: { fontSize: 13, lineHeight: 19, marginTop: 16 }, createButton: { alignItems: "center", borderRadius: 12, marginTop: 28, minHeight: 52, justifyContent: "center" }, createButtonText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  messages: { gap: 10, padding: 16 }, messageBubble: { borderRadius: 16, maxWidth: "82%", padding: 12 }, messageSender: { fontSize: 11, fontWeight: "800", marginBottom: 4 }, messageText: { fontSize: 15, lineHeight: 20 }, composer: { borderTopWidth: 1, flexDirection: "row", gap: 8, padding: 12 }, composerInput: { borderRadius: 20, flex: 1, minHeight: 42, paddingHorizontal: 14 }, sendButton: { alignItems: "center", borderRadius: 20, justifyContent: "center", paddingHorizontal: 16 }, sendText: { color: "#fff", fontWeight: "800" },
});
