import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View, Text, FlatList, TextInput, TouchableOpacity, Modal,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, ScrollView, Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";

// ─── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES = ["All", "General", "Detail Talk", "Q & A", "Wins", "Announcements"] as const;
type Category = typeof CATEGORIES[number];

function randomId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|avi|webm|mkv)(\?|$)/i.test(url);
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name, size = 40, color }: { name: string; size?: number; color: string }) {
  const initials = name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
}

// ─── Image Lightbox ──────────────────────────────────────────────────────────
function ImageLightbox({ urls, startIndex, onClose }: { urls: string[]; startIndex: number; onClose: () => void }) {
  const [current, setCurrent] = useState(startIndex);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="fade" transparent presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center", alignItems: "center" }}>
        {/* Close button */}
        <TouchableOpacity
          onPress={onClose}
          style={{ position: "absolute", top: insets.top + 12, right: 16, zIndex: 10, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, padding: 8 }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>✕</Text>
        </TouchableOpacity>
        {/* Counter */}
        {urls.length > 1 && (
          <Text style={{ position: "absolute", top: insets.top + 16, left: 0, right: 0, textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 13, zIndex: 10 }}>
            {current + 1} / {urls.length}
          </Text>
        )}
        {/* Image */}
        <Image
          source={{ uri: urls[current] }}
          style={{ width: "100%", height: "80%" }}
          resizeMode="contain"
        />
        {/* Prev / Next arrows */}
        {urls.length > 1 && (
          <View style={{ flexDirection: "row", gap: 32, marginTop: 16 }}>
            <TouchableOpacity
              onPress={() => setCurrent(c => Math.max(0, c - 1))}
              disabled={current === 0}
              style={{ backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 24, paddingVertical: 10, paddingHorizontal: 20, opacity: current === 0 ? 0.3 : 1 }}
            >
              <Text style={{ color: "#fff", fontSize: 18 }}>‹</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setCurrent(c => Math.min(urls.length - 1, c + 1))}
              disabled={current === urls.length - 1}
              style={{ backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 24, paddingVertical: 10, paddingHorizontal: 20, opacity: current === urls.length - 1 ? 0.3 : 1 }}
            >
              <Text style={{ color: "#fff", fontSize: 18 }}>›</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─── Media Thumbnail Strip ────────────────────────────────────────────────────
function MediaStrip({ urls, compact = false, onImagePress }: { urls: string[]; compact?: boolean; onImagePress?: (index: number) => void }) {
  if (!urls || urls.length === 0) return null;
  const size = compact ? 72 : 100;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: 14, marginBottom: 10 }}>
      {urls.map((url, i) => (
        <TouchableOpacity
          key={i}
          style={[styles.mediaThumbnail, { width: size, height: size, marginRight: 8 }]}
          onPress={() => !isVideoUrl(url) && onImagePress?.(i)}
          activeOpacity={isVideoUrl(url) ? 1 : 0.8}
          disabled={isVideoUrl(url)}
        >
          {isVideoUrl(url) ? (
            <View style={[styles.videoThumb, { width: size, height: size }]}>
              <Text style={styles.videoPlayIcon}>▶</Text>
            </View>
          ) : (
            <>
              <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: 8 }} resizeMode="cover" />
              {onImagePress && (
                <View style={{ position: "absolute", bottom: 4, right: 4, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 }}>
                  <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700" }}>🔍</Text>
                </View>
              )}
            </>
          )}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ─── Post Card ────────────────────────────────────────────────────────────────
interface PostCardProps {
  post: any;
  isLiked: boolean;
  isAdmin: boolean;
  currentEmployeeId: string;
  onLike: () => void;
  onPress: () => void;
  onDelete: () => void;
  onPin: () => void;
  colors: any;
}

function PostCard({ post, isLiked, isAdmin, currentEmployeeId, onLike, onPress, onDelete, onPin, colors }: PostCardProps) {
  const isOwn = post.authorId === currentEmployeeId;
  const canDelete = isAdmin || isOwn;
  let mediaUrls: string[] = [];
  try { mediaUrls = JSON.parse(post.mediaUrls ?? "[]"); } catch { mediaUrls = []; }

  return (
    <TouchableOpacity
      style={[styles.postCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {/* Pinned banner */}
      {post.isPinned === 1 && (
        <View style={[styles.pinnedBanner, { backgroundColor: colors.primary + "18" }]}>
          <Text style={[styles.pinnedText, { color: colors.primary }]}>📌 Pinned</Text>
        </View>
      )}
      {/* Header */}
      <View style={styles.postHeader}>
        <Avatar name={post.authorName} size={38} color={colors.primary} />
        <View style={styles.postMeta}>
          <Text style={[styles.authorName, { color: colors.foreground }]}>{post.authorName}</Text>
          <View style={styles.metaRow}>
            <Text style={[styles.metaTime, { color: colors.muted }]}>{timeAgo(post.createdAt)}</Text>
            {post.category && post.category !== "General" && (
              <>
                <Text style={[styles.metaDot, { color: colors.muted }]}> · </Text>
                <Text style={[styles.metaCategory, { color: colors.primary }]}>{post.category}</Text>
              </>
            )}
          </View>
        </View>
        {(canDelete || isAdmin) && (
          <View style={styles.postActions}>
            {isAdmin && (
              <TouchableOpacity onPress={onPin} style={styles.actionBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ fontSize: 14, color: post.isPinned === 1 ? colors.primary : colors.muted }}>📌</Text>
              </TouchableOpacity>
            )}
            {canDelete && (
              <TouchableOpacity onPress={onDelete} style={styles.actionBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ fontSize: 14, color: colors.error }}>🗑</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
      {/* Title */}
      <Text style={[styles.postTitle, { color: colors.foreground }]}>{post.title}</Text>
      {/* Body preview */}
      <Text style={[styles.postBody, { color: colors.muted }]} numberOfLines={3}>{post.body}</Text>
      {/* Media thumbnails */}
      {mediaUrls.length > 0 && <MediaStrip urls={mediaUrls} compact />}
      {/* Footer */}
      <View style={[styles.postFooter, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={styles.footerBtn}
          onPress={onLike}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.footerBtnText, { color: isLiked ? colors.primary : colors.muted }]}>
            {isLiked ? "👍" : "👍"} {post.likeCount ?? 0}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.footerBtn} onPress={onPress}>
          <Text style={[styles.footerBtnText, { color: colors.muted }]}>
            💬 {post.commentCount ?? 0} {post.commentCount === 1 ? "comment" : "comments"}
          </Text>
        </TouchableOpacity>
        {mediaUrls.length > 0 && (
          <Text style={[styles.footerBtnText, { color: colors.muted }]}>
            🖼 {mediaUrls.length}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Post Detail Modal ────────────────────────────────────────────────────────
interface PostDetailProps {
  post: any;
  isLiked: boolean;
  isAdmin: boolean;
  currentEmployeeId: string;
  currentFullName: string;
  onLike: () => void;
  onClose: () => void;
  colors: any;
}

function PostDetailModal({ post, isLiked, isAdmin, currentEmployeeId, currentFullName, onLike, onClose, colors }: PostDetailProps) {
  const insets = useSafeAreaInsets();
  const [commentText, setCommentText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const utils = trpc.useUtils();

  let mediaUrls: string[] = [];
  try { mediaUrls = JSON.parse(post.mediaUrls ?? "[]"); } catch { mediaUrls = []; }

  const commentsQuery = trpc.community.listComments.useQuery(
    { postId: post.postId },
    { refetchInterval: 30000, refetchOnWindowFocus: false },
  );
  const createCommentMutation = trpc.community.createComment.useMutation({
    onSuccess: () => utils.community.listComments.invalidate({ postId: post.postId }),
  });
  const deleteCommentMutation = trpc.community.deleteComment.useMutation({
    onSuccess: () => utils.community.listComments.invalidate({ postId: post.postId }),
  });

  const sendComment = async () => {
    if (!commentText.trim()) return;
    setIsSending(true);
    try {
      await createCommentMutation.mutateAsync({
        commentId: randomId("CMT"),
        postId: post.postId,
        authorId: currentEmployeeId,
        authorName: currentFullName,
        body: commentText.trim(),
      });
      setCommentText("");
      utils.community.listPosts.invalidate();
    } finally {
      setIsSending(false);
    }
  };

  const deleteComment = (commentId: string) => {
    Alert.alert("Delete Comment", "Remove this comment?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: () => {
          deleteCommentMutation.mutate({ commentId, postId: post.postId });
          utils.community.listPosts.invalidate();
        },
      },
    ]);
  };

  const comments = commentsQuery.data ?? [];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.detailContainer, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
        {/* Header */}
        <View style={[styles.detailHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn}>
            <Text style={[styles.backBtnText, { color: colors.primary }]}>← Back</Text>
          </TouchableOpacity>
          <Text style={[styles.detailHeaderTitle, { color: colors.foreground }]}>Post</Text>
          <View style={{ width: 60 }} />
        </View>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={insets.bottom + 60}
        >
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
            {/* Post content */}
            <View style={[styles.detailPostCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.postHeader}>
                <Avatar name={post.authorName} size={42} color={colors.primary} />
                <View style={styles.postMeta}>
                  <Text style={[styles.authorName, { color: colors.foreground }]}>{post.authorName}</Text>
                  <View style={styles.metaRow}>
                    <Text style={[styles.metaTime, { color: colors.muted }]}>{timeAgo(post.createdAt)}</Text>
                    {post.category && post.category !== "General" && (
                      <>
                        <Text style={[styles.metaDot, { color: colors.muted }]}> · </Text>
                        <Text style={[styles.metaCategory, { color: colors.primary }]}>{post.category}</Text>
                      </>
                    )}
                  </View>
                </View>
              </View>
              <Text style={[styles.postTitle, { color: colors.foreground, marginTop: 12 }]}>{post.title}</Text>
              <Text style={[styles.detailBody, { color: colors.foreground }]}>{post.body}</Text>
              {/* Media in detail view */}
              {mediaUrls.length > 0 && (
                <View style={{ marginTop: 12 }}>
                  <MediaStrip urls={mediaUrls} compact={false} onImagePress={(i) => setLightboxIndex(i)} />
                </View>
              )}
              {/* Image lightbox */}
              {lightboxIndex !== null && (
                <ImageLightbox
                  urls={mediaUrls.filter(u => !isVideoUrl(u))}
                  startIndex={lightboxIndex}
                  onClose={() => setLightboxIndex(null)}
                />
              )}
              {/* Like button */}
              <View style={[styles.postFooter, { borderTopColor: colors.border, marginTop: 12 }]}>
                <TouchableOpacity style={styles.footerBtn} onPress={onLike}>
                  <Text style={[styles.footerBtnText, { color: isLiked ? colors.primary : colors.muted }]}>
                    👍 {post.likeCount ?? 0} {isLiked ? "Liked" : "Like"}
                  </Text>
                </TouchableOpacity>
                <Text style={[styles.footerBtnText, { color: colors.muted }]}>
                  💬 {comments.length} {comments.length === 1 ? "comment" : "comments"}
                </Text>
              </View>
            </View>

            {/* Comments */}
            <Text style={[styles.commentsHeader, { color: colors.foreground }]}>Comments</Text>
            {commentsQuery.isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
            ) : comments.length === 0 ? (
              <Text style={[styles.noComments, { color: colors.muted }]}>No comments yet. Be the first!</Text>
            ) : (
              comments.map((c: any) => (
                <View key={c.commentId} style={[styles.commentCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.commentHeader}>
                    <Avatar name={c.authorName} size={30} color={colors.primary} />
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={[styles.commentAuthor, { color: colors.foreground }]}>{c.authorName}</Text>
                      <Text style={[styles.commentTime, { color: colors.muted }]}>{timeAgo(c.createdAt)}</Text>
                    </View>
                    {(isAdmin || c.authorId === currentEmployeeId) && (
                      <TouchableOpacity onPress={() => deleteComment(c.commentId)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={{ color: colors.error, fontSize: 13 }}>🗑</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={[styles.commentBody, { color: colors.foreground }]}>{c.body}</Text>
                </View>
              ))
            )}
          </ScrollView>

          {/* Comment input */}
          <View style={[styles.commentInputBar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + 8 }]}>
            <TextInput
              style={[styles.commentInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder="Add a comment…"
              placeholderTextColor={colors.muted}
              value={commentText}
              onChangeText={setCommentText}
              multiline
              maxLength={500}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: commentText.trim() ? colors.primary : colors.border }]}
              onPress={sendComment}
              disabled={!commentText.trim() || isSending}
            >
              {isSending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.sendBtnText}>Post</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Create Post Modal ────────────────────────────────────────────────────────
interface CreatePostProps {
  visible: boolean;
  authorId: string;
  authorName: string;
  isAdmin: boolean;
  onClose: () => void;
  onCreated: () => void;
  colors: any;
}

function CreatePostModal({ visible, authorId, authorName, isAdmin, onClose, onCreated, colors }: CreatePostProps) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<Category>("General");
  const [isSaving, setIsSaving] = useState(false);
  const [mediaAssets, setMediaAssets] = useState<Array<{ uri: string; mimeType: string; isVideo: boolean }>>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const createPostMutation = trpc.community.createPost.useMutation({
    onSuccess: () => {
      onCreated();
      setTitle("");
      setBody("");
      setCategory("General");
      setMediaAssets([]);
    },
  });
  const uploadMediaMutation = trpc.community.uploadMedia.useMutation();

  const pickMedia = async (fromCamera: boolean, mediaType: "photo" | "video" | "all") => {
    if (fromCamera) {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Camera access is required to take photos or videos.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: mediaType === "photo" ? ImagePicker.MediaTypeOptions.Images
          : mediaType === "video" ? ImagePicker.MediaTypeOptions.Videos
          : ImagePicker.MediaTypeOptions.All,
        quality: 0.8,
        videoMaxDuration: 60,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setMediaAssets(prev => [...prev, {
          uri: asset.uri,
          mimeType: asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg"),
          isVideo: asset.type === "video",
        }]);
      }
    } else {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: mediaType === "photo" ? ImagePicker.MediaTypeOptions.Images
          : mediaType === "video" ? ImagePicker.MediaTypeOptions.Videos
          : ImagePicker.MediaTypeOptions.All,
        allowsMultipleSelection: true,
        quality: 0.8,
        videoMaxDuration: 60,
      });
      if (!result.canceled) {
        const newAssets = result.assets.map(asset => ({
          uri: asset.uri,
          mimeType: asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg"),
          isVideo: asset.type === "video",
        }));
        setMediaAssets(prev => [...prev, ...newAssets]);
      }
    }
  };

  const removeMedia = (index: number) => {
    setMediaAssets(prev => prev.filter((_, i) => i !== index));
  };

  const submit = async () => {
    if (!title.trim() || !body.trim()) {
      Alert.alert("Missing fields", "Please add a title and body.");
      return;
    }
    setIsSaving(true);
    try {
      // Upload all media to S3 first
      let uploadedUrls: string[] = [];
      if (mediaAssets.length > 0) {
        setUploadingMedia(true);
        for (const asset of mediaAssets) {
          const response = await fetch(asset.uri);
          const blob = await response.blob();
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve) => {
            reader.onloadend = () => {
              const result = reader.result as string;
              resolve(result.split(",")[1]);
            };
            reader.readAsDataURL(blob);
          });
          const result = await uploadMediaMutation.mutateAsync({
            base64,
            mimeType: asset.mimeType,
          });
          uploadedUrls.push(result.url);
        }
        setUploadingMedia(false);
      }

      await createPostMutation.mutateAsync({
        postId: randomId("POST"),
        authorId,
        authorName,
        title: title.trim(),
        body: body.trim(),
        category,
        mediaUrls: uploadedUrls.length > 0 ? uploadedUrls : undefined,
      });
    } finally {
      setIsSaving(false);
      setUploadingMedia(false);
    }
  };

  const postCategories = isAdmin
    ? CATEGORIES.filter((c) => c !== "All")
    : CATEGORIES.filter((c) => c !== "All" && c !== "Announcements");

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.createContainer, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
        <View style={[styles.createHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn}>
            <Text style={[styles.backBtnText, { color: colors.muted }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.createTitle, { color: colors.foreground }]}>New Post</Text>
          <TouchableOpacity
            onPress={submit}
            disabled={isSaving || !title.trim() || !body.trim()}
            style={[styles.postBtn, { backgroundColor: title.trim() && body.trim() ? colors.primary : colors.border }]}
          >
            {isSaving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.postBtnText}>Post</Text>
            )}
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            {/* Category pills */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              {postCategories.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.categoryPill,
                    { borderColor: colors.border, backgroundColor: category === cat ? colors.primary : colors.surface },
                  ]}
                  onPress={() => setCategory(cat)}
                >
                  <Text style={[styles.categoryPillText, { color: category === cat ? "#fff" : colors.muted }]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {/* Title */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>Title</Text>
            <TextInput
              style={[styles.titleInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
              placeholder="What's this about?"
              placeholderTextColor={colors.muted}
              value={title}
              onChangeText={setTitle}
              maxLength={120}
              returnKeyType="next"
            />
            {/* Body */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>Body</Text>
            <TextInput
              style={[styles.bodyInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
              placeholder="Share something with the team…"
              placeholderTextColor={colors.muted}
              value={body}
              onChangeText={setBody}
              multiline
              maxLength={2000}
              textAlignVertical="top"
            />

            {/* Media section */}
            <Text style={[styles.fieldLabel, { color: colors.muted, marginTop: 16 }]}>Media (optional)</Text>
            {/* Media picker buttons */}
            <View style={styles.mediaPickerRow}>
              <TouchableOpacity
                style={[styles.mediaPickerBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => Alert.alert("Add Photo", "Choose source", [
                  { text: "Camera", onPress: () => pickMedia(true, "photo") },
                  { text: "Library", onPress: () => pickMedia(false, "photo") },
                  { text: "Cancel", style: "cancel" },
                ])}
              >
                <Text style={[styles.mediaPickerBtnText, { color: colors.foreground }]}>📷 Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.mediaPickerBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => Alert.alert("Add Video", "Choose source", [
                  { text: "Camera", onPress: () => pickMedia(true, "video") },
                  { text: "Library", onPress: () => pickMedia(false, "video") },
                  { text: "Cancel", style: "cancel" },
                ])}
              >
                <Text style={[styles.mediaPickerBtnText, { color: colors.foreground }]}>🎥 Video</Text>
              </TouchableOpacity>
            </View>

            {/* Media preview */}
            {mediaAssets.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                {mediaAssets.map((asset, i) => (
                  <View key={i} style={styles.mediaPreviewItem}>
                    {asset.isVideo ? (
                      <View style={styles.videoPreviewThumb}>
                        <Text style={styles.videoPlayIcon}>▶</Text>
                        <Text style={{ color: "#fff", fontSize: 10, marginTop: 2 }}>Video</Text>
                      </View>
                    ) : (
                      <Image source={{ uri: asset.uri }} style={styles.imagePreviewThumb} resizeMode="cover" />
                    )}
                    <TouchableOpacity
                      style={styles.removeMediaBtn}
                      onPress={() => removeMedia(i)}
                    >
                      <Text style={styles.removeMediaBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            {uploadingMedia && (
              <View style={styles.uploadingRow}>
                <ActivityIndicator color={colors.primary} size="small" />
                <Text style={[styles.uploadingText, { color: colors.muted }]}>Uploading media…</Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Main Community Screen ────────────────────────────────────────────────────
export default function CommunityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { employee } = useEmployeeAuth();
  const isAdmin = employee?.role === "admin" || employee?.role === "operations_manager";

  const [activeCategory, setActiveCategory] = useState<Category>("All");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedPost, setSelectedPost] = useState<any>(null);

  const utils = trpc.useUtils();

  const postsQuery = trpc.community.listPosts.useQuery(
    { category: activeCategory === "All" ? undefined : activeCategory },
    { refetchInterval: 30000, refetchOnWindowFocus: false },
  );
  const myLikesQuery = trpc.community.getMyLikes.useQuery(
    { employeeId: employee?.employeeId ?? "" },
    { enabled: !!employee?.employeeId },
  );

  const markSeenMutation = trpc.chat.markSeen.useMutation();
  // Mark community as seen when the screen mounts or new posts load
  useEffect(() => {
    if (employee?.employeeId) {
      markSeenMutation.mutate({ employeeId: employee.employeeId, channelKey: 'community' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.employeeId, postsQuery.data?.length]);

  const likePostMutation = trpc.community.likePost.useMutation({
    onSuccess: () => {
      utils.community.listPosts.invalidate();
      utils.community.getMyLikes.invalidate({ employeeId: employee?.employeeId ?? "" });
    },
  });
  const deletePostMutation = trpc.community.deletePost.useMutation({
    onSuccess: () => utils.community.listPosts.invalidate(),
  });
  const pinPostMutation = trpc.community.pinPost.useMutation({
    onSuccess: () => utils.community.listPosts.invalidate(),
  });

  const myLikes = new Set(myLikesQuery.data ?? []);
  const posts = postsQuery.data ?? [];

  const handleLike = useCallback((post: any) => {
    if (!employee) return;
    const liked = !myLikes.has(post.postId);
    likePostMutation.mutate({ postId: post.postId, employeeId: employee.employeeId, liked });
  }, [employee, myLikes, likePostMutation]);

  const handleDelete = useCallback((post: any) => {
    Alert.alert("Delete Post", "Are you sure you want to delete this post?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: () => deletePostMutation.mutate({ postId: post.postId }),
      },
    ]);
  }, [deletePostMutation]);

  const handlePin = useCallback((post: any) => {
    pinPostMutation.mutate({ postId: post.postId, isPinned: post.isPinned !== 1 });
  }, [pinPostMutation]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Write something bar */}
      <TouchableOpacity
        style={[styles.writeBar, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => setShowCreate(true)}
        activeOpacity={0.8}
      >
        <Avatar name={employee?.fullName ?? "?"} size={34} color={colors.primary} />
        <Text style={[styles.writePlaceholder, { color: colors.muted }]}>Write something…</Text>
        <Text style={{ fontSize: 16, marginLeft: 4 }}>📷</Text>
        <Text style={{ fontSize: 16, marginLeft: 4 }}>🎥</Text>
      </TouchableOpacity>

      {/* Category filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.categoryBar, { borderBottomColor: colors.border }]}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
      >
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[
              styles.categoryChip,
              {
                backgroundColor: activeCategory === cat ? colors.primary : colors.surface,
                borderColor: activeCategory === cat ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setActiveCategory(cat)}
          >
            <Text style={[styles.categoryChipText, { color: activeCategory === cat ? "#fff" : colors.muted }]}>
              {cat}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Post feed */}
      {postsQuery.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : posts.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>📝</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No posts yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.muted }]}>Be the first to post something!</Text>
          <TouchableOpacity
            style={[styles.emptyCreateBtn, { backgroundColor: colors.primary }]}
            onPress={() => setShowCreate(true)}
          >
            <Text style={styles.emptyCreateBtnText}>Create Post</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={posts}
          keyExtractor={(item) => item.postId}
          contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 80 }}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              isLiked={myLikes.has(item.postId)}
              isAdmin={isAdmin}
              currentEmployeeId={employee?.employeeId ?? ""}
              onLike={() => handleLike(item)}
              onPress={() => setSelectedPost(item)}
              onDelete={() => handleDelete(item)}
              onPin={() => handlePin(item)}
              colors={colors}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          onRefresh={() => {
            utils.community.listPosts.invalidate();
            utils.community.getMyLikes.invalidate({ employeeId: employee?.employeeId ?? "" });
          }}
          refreshing={postsQuery.isFetching && !postsQuery.isLoading}
        />
      )}

      {/* Floating create button */}
      {posts.length > 0 && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: colors.primary, bottom: insets.bottom + 80 }]}
          onPress={() => setShowCreate(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      )}

      {/* Create post modal */}
      {showCreate && employee && (
        <CreatePostModal
          visible={showCreate}
          authorId={employee.employeeId}
          authorName={employee.fullName}
          isAdmin={isAdmin}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            utils.community.listPosts.invalidate();
          }}
          colors={colors}
        />
      )}

      {/* Post detail modal */}
      {selectedPost && employee && (
        <PostDetailModal
          post={selectedPost}
          isLiked={myLikes.has(selectedPost.postId)}
          isAdmin={isAdmin}
          currentEmployeeId={employee.employeeId}
          currentFullName={employee.fullName}
          onLike={() => handleLike(selectedPost)}
          onClose={() => setSelectedPost(null)}
          colors={colors}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontWeight: "700" },
  // Write bar
  writeBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 12, marginTop: 10, marginBottom: 4,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 24, borderWidth: 1,
  },
  writePlaceholder: { fontSize: 14, flex: 1 },
  // Category bar
  categoryBar: { borderBottomWidth: 0.5, flexGrow: 0, minHeight: 48 },
  categoryChip: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1.5, marginRight: 10,
  },
  categoryChipText: { fontSize: 14, fontWeight: "600" },
  // Post card
  postCard: {
    borderRadius: 14, borderWidth: 1,
    overflow: "hidden",
  },
  pinnedBanner: { paddingHorizontal: 14, paddingVertical: 5 },
  pinnedText: { fontSize: 12, fontWeight: "600" },
  postHeader: { flexDirection: "row", alignItems: "flex-start", padding: 12, paddingBottom: 6 },
  postMeta: { flex: 1, marginLeft: 10 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  authorName: { fontSize: 14, fontWeight: "700" },
  metaTime: { fontSize: 12 },
  metaDot: { fontSize: 12 },
  metaCategory: { fontSize: 12, fontWeight: "600" },
  postActions: { flexDirection: "row", gap: 4 },
  actionBtn: { padding: 4 },
  postTitle: { fontSize: 16, fontWeight: "700", paddingHorizontal: 14, marginBottom: 6 },
  postBody: { fontSize: 14, lineHeight: 20, paddingHorizontal: 14, paddingBottom: 10 },
  postFooter: {
    flexDirection: "row", alignItems: "center", gap: 16,
    paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 0.5,
  },
  footerBtn: { flexDirection: "row", alignItems: "center" },
  footerBtnText: { fontSize: 13, fontWeight: "500" },
  // Media thumbnails
  mediaThumbnail: { borderRadius: 8, overflow: "hidden" },
  videoThumb: {
    backgroundColor: "#1a1a2e", borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },
  videoPlayIcon: { fontSize: 24, color: "#fff" },
  // FAB
  fab: {
    position: "absolute", right: 20,
    width: 52, height: 52, borderRadius: 26,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4,
    elevation: 4,
  },
  fabText: { color: "#fff", fontSize: 26, lineHeight: 30, fontWeight: "700" },
  // Empty state
  emptyTitle: { fontSize: 18, fontWeight: "700", marginBottom: 6 },
  emptySubtitle: { fontSize: 14, textAlign: "center", marginBottom: 20 },
  emptyCreateBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  emptyCreateBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  // Post detail
  detailContainer: { flex: 1 },
  detailHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5,
  },
  backBtn: { width: 60 },
  backBtnText: { fontSize: 15, fontWeight: "600" },
  detailHeaderTitle: { fontSize: 16, fontWeight: "700" },
  detailPostCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 20 },
  detailBody: { fontSize: 15, lineHeight: 22, marginTop: 8 },
  commentsHeader: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  noComments: { fontSize: 14, textAlign: "center", marginTop: 8 },
  commentCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 10 },
  commentHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  commentAuthor: { fontSize: 13, fontWeight: "700" },
  commentTime: { fontSize: 11, marginTop: 1 },
  commentBody: { fontSize: 14, lineHeight: 20 },
  commentInputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 0.5,
  },
  commentInput: {
    flex: 1, borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    fontSize: 14, maxHeight: 100,
  },
  sendBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  sendBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  // Create post
  createContainer: { flex: 1 },
  createHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5,
  },
  createTitle: { fontSize: 16, fontWeight: "700" },
  postBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20 },
  postBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  fieldLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  categoryPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, marginRight: 8 },
  categoryPillText: { fontSize: 13, fontWeight: "500" },
  titleInput: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, marginBottom: 16,
  },
  bodyInput: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, minHeight: 160, lineHeight: 22,
  },
  // Media picker
  mediaPickerRow: { flexDirection: "row", gap: 10, marginBottom: 4 },
  mediaPickerBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  mediaPickerBtnText: { fontSize: 14, fontWeight: "600" },
  mediaPreviewItem: { marginRight: 10, position: "relative" },
  imagePreviewThumb: { width: 80, height: 80, borderRadius: 8 },
  videoPreviewThumb: {
    width: 80, height: 80, borderRadius: 8,
    backgroundColor: "#1a1a2e",
    alignItems: "center", justifyContent: "center",
  },
  removeMediaBtn: {
    position: "absolute", top: -6, right: -6,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: "#ef4444",
    alignItems: "center", justifyContent: "center",
  },
  removeMediaBtnText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  uploadingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  uploadingText: { fontSize: 13 },
});
