import React, { useRef, useEffect, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Linking,
  Clipboard,
  Alert,
  Dimensions,
  Platform,
} from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import * as Haptics from "expo-haptics";

const REVIEW_VIDEO_URL =
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/yZPWjzzAkKdwFsJe.mp4";

const SCREEN_W = Dimensions.get("window").width;

// City → Google review link map (mirrors server/email.ts)
const CITY_REVIEW_LINKS: Record<string, string> = {
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

function getReviewLink(city?: string | null): string {
  const key = (city ?? "").toLowerCase().trim();
  return CITY_REVIEW_LINKS[key] ?? CITY_REVIEW_LINKS["crestview"];
}

function buildCopyText(detailerName: string, city: string): string {
  const first = detailerName?.split(" ")[0] || "my detailer";
  const cityLabel = city
    ? city
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    : "my area";
  return `I just had an amazing mobile detailing experience with Luxury Wash On Wheels in ${cityLabel}! ${first} did a fantastic job — my car looks brand new. If you're looking for professional mobile detailing in ${cityLabel}, I highly recommend them. 5 stars all the way! ⭐⭐⭐⭐⭐`;
}

export interface ReviewOverlayProps {
  visible: boolean;
  city?: string | null;
  detailerName?: string | null;
  onDismiss: () => void;
}

export function ReviewOverlay({
  visible,
  city,
  detailerName,
  onDismiss,
}: ReviewOverlayProps) {
  const reviewLink = getReviewLink(city);
  const copyText = buildCopyText(detailerName ?? "", city ?? "");

  const player = useVideoPlayer(REVIEW_VIDEO_URL, (p) => {
    p.loop = false;
    p.muted = false;
    p.volume = 1.0;
  });

  // Auto-play when overlay becomes visible
  useEffect(() => {
    if (visible) {
      try {
        player.replay();
        player.play();
      } catch {}
    } else {
      try {
        player.pause();
      } catch {}
    }
  }, [visible]);

  const handleOpenReview = useCallback(async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    try {
      await Linking.openURL(reviewLink);
    } catch {
      Alert.alert("Could not open link", "Please visit Google to leave your review.");
    }
  }, [reviewLink]);

  const handleCopy = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    Clipboard.setString(copyText);
    Alert.alert("Copied!", "Review text copied to clipboard. Paste it into Google after clicking the review button above.");
  }, [copyText]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Stars header */}
          <View style={styles.header}>
            <Text style={styles.stars}>⭐⭐⭐⭐⭐</Text>
            <Text style={styles.headerTitle}>Your Detail is Complete!</Text>
            <Text style={styles.headerSub}>
              We hope you love the results. Would you take 30 seconds to share your experience?
            </Text>
          </View>

          {/* Video */}
          <View style={styles.videoWrapper}>
            <VideoView
              player={player}
              style={styles.video}
              allowsFullscreen
              allowsPictureInPicture={false}
              contentFit="cover"
              nativeControls
            />
          </View>

          {/* CTA */}
          <View style={styles.ctaSection}>
            <TouchableOpacity
              style={styles.reviewBtn}
              onPress={handleOpenReview}
              activeOpacity={0.85}
            >
              <Text style={styles.reviewBtnText}>⭐ Leave a Google Review</Text>
            </TouchableOpacity>

            {/* Copy-paste section */}
            <View style={styles.copyBox}>
              <Text style={styles.copyLabel}>
                Don't have time to write your own review?
              </Text>
              <Text style={styles.copyHint}>
                Tap the button below to copy a pre-written review — then paste it directly into Google!
              </Text>
              <View style={styles.copyTextBox}>
                <Text style={styles.copyTextContent}>{copyText}</Text>
              </View>
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={handleCopy}
                activeOpacity={0.8}
              >
                <Text style={styles.copyBtnText}>📋 Copy Review Text</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>

        {/* Dismiss */}
        <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss} activeOpacity={0.7}>
          <Text style={styles.dismissText}>No thanks, maybe later</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0A0A",
  },
  scroll: {
    paddingBottom: 24,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 24,
    alignItems: "center",
    backgroundColor: "#0A0A0A",
  },
  stars: {
    fontSize: 36,
    marginBottom: 12,
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  headerSub: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  videoWrapper: {
    width: SCREEN_W,
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
    overflow: "hidden",
  },
  video: {
    width: "100%",
    height: "100%",
  },
  ctaSection: {
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  reviewBtn: {
    backgroundColor: "#F5C518",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 24,
    shadowColor: "#F5C518",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  reviewBtnText: {
    color: "#0A0A0A",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  copyBox: {
    backgroundColor: "#1A1A1A",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  copyLabel: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 6,
    textAlign: "center",
  },
  copyHint: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 16,
  },
  copyTextBox: {
    backgroundColor: "#111",
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  copyTextContent: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    lineHeight: 20,
  },
  copyBtn: {
    backgroundColor: "#1E3A5F",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(0,87,255,0.4)",
  },
  copyBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  dismissBtn: {
    paddingVertical: 18,
    alignItems: "center",
    backgroundColor: "#0A0A0A",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  dismissText: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 14,
    fontWeight: "500",
  },
});
