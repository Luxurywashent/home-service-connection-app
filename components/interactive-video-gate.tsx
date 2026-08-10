import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { TrainingVideoPlayer } from "@/components/training-video-player";
import { useColors } from "@/hooks/use-colors";

interface InteractiveVideoGateProps {
  videoUrl: string;
  /** A unique key for this video — typically moduleId or moduleId+stepIndex */
  watchKey: string;
  /** Title shown above the video (module name or step title) */
  title: string;
  /** Optional step number badge — omit for module-level intro */
  stepNumber?: number;
  accentColor?: string;
  accentBgColor?: string;
  onContinue: () => void;
  onSkip: () => void;
  /** Optional exit handler — shows an ✕ button in the top-right corner */
  onExit?: () => void;
  scrollRef?: React.RefObject<ScrollView | null>;
}

const WATCH_PREFIX = "training_video_watched_";

/**
 * Full-screen video gate.
 * - First watch: no Skip button — user must tap "I've Watched" to continue.
 * - Repeat visits: Skip button is shown so returning detailers can proceed quickly.
 * Watch state is persisted in AsyncStorage keyed by `watchKey`.
 */
export function InteractiveVideoGate({
  videoUrl,
  watchKey,
  title,
  stepNumber,
  accentColor = "#3B82F6",
  accentBgColor = "#DBEAFE",
  onContinue,
  onSkip,
  onExit,
  scrollRef,
}: InteractiveVideoGateProps) {
  const colors = useColors();
  const [hasWatchedBefore, setHasWatchedBefore] = useState<boolean | null>(null);

  // Check AsyncStorage on mount
  useEffect(() => {
    const key = `${WATCH_PREFIX}${watchKey}`;
    AsyncStorage.getItem(key)
      .then((val) => setHasWatchedBefore(val === "yes"))
      .catch(() => setHasWatchedBefore(false));
  }, [watchKey]);

  // Mark as watched when user taps "I've Watched"
  const handleContinue = () => {
    const key = `${WATCH_PREFIX}${watchKey}`;
    AsyncStorage.setItem(key, "yes").catch(() => {});
    onContinue();
  };

  if (hasWatchedBefore === null) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={accentColor} />
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Badge row with optional exit button */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16, marginTop: 4 }}>
        <View
          style={{
            backgroundColor: accentBgColor,
            borderRadius: 20,
            paddingHorizontal: 12,
            paddingVertical: 5,
            borderWidth: 1.5,
            borderColor: `${accentColor}60`,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "800", color: accentColor }}>
            {stepNumber != null ? `▶  STEP ${stepNumber} — WATCH BEFORE YOU BEGIN` : "▶  MODULE INTRO VIDEO"}
          </Text>
        </View>
        {onExit && (
          <Pressable
            onPress={onExit}
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: "rgba(0,0,0,0.15)",
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ fontSize: 16, color: accentColor, fontWeight: "700", lineHeight: 18 }}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Title row */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
        {stepNumber != null && (
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: accentBgColor,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "800", color: accentColor }}>
              {stepNumber}
            </Text>
          </View>
        )}
        <Text
          style={{
            fontSize: 20,
            fontWeight: "800",
            color: colors.foreground,
            flex: 1,
          }}
        >
          {title}
        </Text>
      </View>

      {/* Instruction card */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 14,
          padding: 16,
          marginBottom: 20,
          borderWidth: 1,
          borderColor: colors.border,
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <Text style={{ fontSize: 24 }}>🎬</Text>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "700",
              color: colors.foreground,
              marginBottom: 4,
            }}
          >
            Training Video Required
          </Text>
          <Text style={{ fontSize: 13, color: colors.muted, lineHeight: 20 }}>
            Watch the full video before continuing. This ensures you have the visual context needed to complete the training correctly.
          </Text>
        </View>
      </View>

      {/* Video player */}
      <View style={{ marginBottom: 24 }}>
        <TrainingVideoPlayer videoUrl={videoUrl} title={title} />
      </View>

      {/* Continue button */}
      <Pressable
        onPress={handleContinue}
        style={({ pressed }) => ({
          backgroundColor: accentColor,
          paddingVertical: 16,
          borderRadius: 14,
          alignItems: "center",
          opacity: pressed ? 0.85 : 1,
          marginBottom: 12,
        })}
      >
        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
          {stepNumber != null ? "I've Watched — Continue to Step →" : "I've Watched — Start Training →"}
        </Text>
      </Pressable>


    </ScrollView>
  );
}
