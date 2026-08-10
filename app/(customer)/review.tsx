import React, { useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Linking,
  Share,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { ScreenContainer } from "@/components/screen-container";
import { VideoView, useVideoPlayer } from "expo-video";
import * as Haptics from "expo-haptics";

// ─── Video URL ────────────────────────────────────────────────────────────────
const FOLLOWUP_VIDEO_URL =
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/BCrhkfnHPnkWulkj.mp4";

// ─── Google Review URLs by city ───────────────────────────────────────────────
const GOOGLE_REVIEW_URLS: Record<string, string> = {
  crestview:
    "https://search.google.com/local/writereview?placeid=ChIJ03fG3g1zkYgRN-BztFseQjs&source=g.page.m.nr._&laa=nmx-review-solicitation-recommendation-card",
  destin:
    "https://search.google.com/local/writereview?placeid=ChIJmRYS9IhDkYgRJr2ZnvdfM4o&source=g.page.m.nr._&laa=nmx-review-solicitation-recommendation-card",
  "fort walton beach":
    "https://search.google.com/local/writereview?placeid=ChIJe2R3X1eZCwMRylxFjIm-WiM&source=g.page.m.nr._&laa=nmx-review-solicitation-recommendation-card",
  fwb:
    "https://search.google.com/local/writereview?placeid=ChIJe2R3X1eZCwMRylxFjIm-WiM&source=g.page.m.nr._&laa=nmx-review-solicitation-recommendation-card",
  niceville:
    "https://search.google.com/local/writereview?placeid=ChIJ6TIb439pkYgRSJD2B2z-p3c&source=g.page.m.nr._&laa=nmx-review-solicitation-recommendation-card",
  pensacola:
    "https://search.google.com/local/writereview?placeid=ChIJqeErDLkNkYgRY3GW05fBktM&source=g.page.m.np._&laa=nmx-review-solicitation-promoted-recommendation-card",
};

const DEFAULT_REVIEW_URL =
  "https://search.google.com/local/writereview?placeid=ChIJqeErDLkNkYgRY3GW05fBktM&source=g.page.m.np._&laa=nmx-review-solicitation-promoted-recommendation-card";

function getReviewUrl(city?: string): string {
  if (!city) return DEFAULT_REVIEW_URL;
  const lower = city.toLowerCase().trim();
  for (const key of Object.keys(GOOGLE_REVIEW_URLS)) {
    if (lower.includes(key)) return GOOGLE_REVIEW_URLS[key];
  }
  return DEFAULT_REVIEW_URL;
}

// ─── Review copy text ─────────────────────────────────────────────────────────
const REVIEW_COPY = `I had an amazing experience with Luxury Wash On Wheels! My car looks absolutely incredible — the attention to detail was outstanding. The team was professional, on time, and went above and beyond. Highly recommend to anyone looking for a premium mobile detailing service!`;

export default function CustomerReviewScreen() {
  const router = useRouter();
  const { city, detailerName, jobId } = useLocalSearchParams<{
    city?: string;
    detailerName?: string;
    jobId?: string;
  }>();

  const [isPlaying, setIsPlaying] = useState(false);
  const [copied, setCopied] = useState(false);

  const player = useVideoPlayer(FOLLOWUP_VIDEO_URL, (p) => {
    p.loop = false;
    p.muted = false;
  });

  const reviewUrl = getReviewUrl(city);

  const handlePlayPause = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
    } else {
      player.play();
      setIsPlaying(true);
    }
  }, [isPlaying, player]);

  const handleGoogleReview = useCallback(async () => {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    await Linking.openURL(reviewUrl);
  }, [reviewUrl]);

  const handleCopyReview = useCallback(async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    try {
      // Use Share API as clipboard fallback (expo-clipboard not in template)
      await Share.share({ message: REVIEW_COPY });
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // ignore
    }
  }, []);

  const firstName = detailerName ? detailerName.split(" ")[0] : null;

  return (
    <ScreenContainer containerClassName="bg-[#0A0A0A]" safeAreaClassName="bg-[#0A0A0A]">
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <MaterialIcons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Hero text */}
        <View style={styles.heroSection}>
          <Text style={styles.heroEmoji}>✨</Text>
          <Text style={styles.heroTitle}>Your Detail is Complete!</Text>
          <Text style={styles.heroSub}>
            {firstName
              ? `${firstName} left your car looking its best.`
              : "Your car is looking its best."}
            {"\n"}We'd love to hear what you think!
          </Text>
        </View>

        {/* Video player */}
        <View style={styles.videoCard}>
          <View style={styles.videoWrapper}>
            <VideoView
              player={player}
              style={styles.video}
              contentFit="cover"
              nativeControls={false}
            />
            {/* Play/pause overlay */}
            {!isPlaying && (
              <TouchableOpacity
                style={styles.playOverlay}
                onPress={handlePlayPause}
                activeOpacity={0.9}
              >
                <View style={styles.playBtn}>
                  <MaterialIcons name="play-arrow" size={36} color="#FFFFFF" />
                </View>
                <Text style={styles.playHint}>Watch Our Thank You Message</Text>
              </TouchableOpacity>
            )}
            {isPlaying && (
              <TouchableOpacity
                style={styles.pauseOverlay}
                onPress={handlePlayPause}
                activeOpacity={0.9}
              />
            )}
          </View>
        </View>

        {/* Stars */}
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((i) => (
            <MaterialIcons key={i} name="star" size={36} color="#F5C518" />
          ))}
        </View>
        <Text style={styles.starsLabel}>How did we do?</Text>

        {/* Google Review button */}
        <TouchableOpacity
          style={styles.reviewBtn}
          onPress={handleGoogleReview}
          activeOpacity={0.85}
        >
          <View style={styles.reviewBtnInner}>
            <MaterialIcons name="star-rate" size={22} color="#FFFFFF" />
            <Text style={styles.reviewBtnText}>Leave a Google Review</Text>
            <MaterialIcons name="open-in-new" size={16} color="rgba(255,255,255,0.7)" />
          </View>
        </TouchableOpacity>

        {/* Copy review text */}
        <View style={styles.copyCard}>
          <Text style={styles.copyCardTitle}>Need inspiration? Copy this review:</Text>
          <Text style={styles.copyCardText}>{REVIEW_COPY}</Text>
          <TouchableOpacity
            style={[styles.copyBtn, copied && styles.copyBtnDone]}
            onPress={handleCopyReview}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name={copied ? "check" : "content-copy"}
              size={16}
              color={copied ? "#22C55E" : "#6B7280"}
            />
            <Text style={[styles.copyBtnText, copied && { color: "#22C55E" }]}>
              {copied ? "Copied!" : "Copy & Share"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Thank you note */}
        <View style={styles.thankYouCard}>
          <Text style={styles.thankYouText}>
            Thank you for choosing{"\n"}
            <Text style={styles.thankYouBrand}>Luxury Wash On Wheels</Text>
          </Text>
          <Text style={styles.thankYouSub}>
            Your review helps us grow and serve more customers in your community. 🙏
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 32,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroSection: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 20,
  },
  heroEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
    letterSpacing: -0.5,
  },
  heroSub: {
    fontSize: 15,
    color: "#9CA3AF",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 22,
  },
  videoCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#1A1A1A",
    marginBottom: 24,
  },
  videoWrapper: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
    position: "relative",
  },
  video: {
    width: "100%",
    height: "100%",
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    gap: 10,
  },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(0,87,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  playHint: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  pauseOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  starsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 4,
    marginBottom: 6,
  },
  starsLabel: {
    textAlign: "center",
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 20,
  },
  reviewBtn: {
    marginHorizontal: 16,
    borderRadius: 16,
    backgroundColor: "#0057FF",
    marginBottom: 16,
    shadowColor: "#0057FF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  reviewBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  reviewBtnText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
    flex: 1,
    textAlign: "center",
  },
  copyCard: {
    marginHorizontal: 16,
    borderRadius: 14,
    backgroundColor: "#1A1A1A",
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#2A2A2A",
  },
  copyCardTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  copyCardText: {
    fontSize: 14,
    color: "#D1D5DB",
    lineHeight: 21,
    marginBottom: 12,
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "#2A2A2A",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  copyBtnDone: {
    backgroundColor: "rgba(34,197,94,0.1)",
  },
  copyBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6B7280",
  },
  thankYouCard: {
    marginHorizontal: 16,
    borderRadius: 14,
    backgroundColor: "rgba(0,87,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(0,87,255,0.2)",
    padding: 20,
    alignItems: "center",
  },
  thankYouText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 8,
  },
  thankYouBrand: {
    color: "#0057FF",
  },
  thankYouSub: {
    fontSize: 13,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 19,
  },
});
