import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialIcons } from "@expo/vector-icons";

const { width: SW, height: SH } = Dimensions.get("window");

export const ONBOARDING_DONE_KEY = "customer_onboarding_v1_done";

// ─── Step definitions ─────────────────────────────────────────────────────────
// Each step describes WHERE to highlight (as a fraction of screen) and what to say.
// Positions are calculated at render time based on screen size so they work on all devices.

export type OnboardingStep = {
  id: string;
  title: string;
  message: string;
  // Where to place the spotlight circle (center x/y as 0-1 fractions of screen)
  spotX: number;
  spotY: number;
  spotRadius: number;
  // Where the tooltip card appears: "top" | "bottom" | "center"
  tooltipPosition: "top" | "bottom" | "center";
  // Arrow direction pointing FROM tooltip TO spotlight
  arrowDirection: "up" | "down" | "left" | "right";
};

// Tab bar is ~80px from bottom on most devices
const TAB_Y = 0.93; // fraction of screen height where tab bar icons sit

export const WALKTHROUGH_STEPS: OnboardingStep[] = [
  {
    id: "profile_tab",
    title: "Set Up Your Profile",
    message: "Let's get your account ready. Tap the Profile tab to add your address and vehicle.",
    spotX: 1.0,       // rightmost tab (Profile is 5th of 5)
    spotY: TAB_Y,
    spotRadius: 36,
    tooltipPosition: "top",
    arrowDirection: "down",
  },
  {
    id: "add_address",
    title: "Save Your Address",
    message: "Tap 'My Addresses' to save your home or work address — we come to you!",
    spotX: 0.5,
    spotY: 0.52,
    spotRadius: 44,
    tooltipPosition: "bottom",
    arrowDirection: "up",
  },
  {
    id: "add_vehicle",
    title: "Add Your Vehicle",
    message: "Tap 'My Vehicles' to add your car so we know exactly what we're detailing.",
    spotX: 0.5,
    spotY: 0.45,
    spotRadius: 44,
    tooltipPosition: "bottom",
    arrowDirection: "up",
  },
  {
    id: "messages_tab",
    title: "Message Our Team",
    message: "Have a question? Tap Messages anytime to reach us directly — we respond fast.",
    spotX: 0.6,       // Messages is 3rd of 5 tabs
    spotY: TAB_Y,
    spotRadius: 36,
    tooltipPosition: "top",
    arrowDirection: "down",
  },
  {
    id: "book_tab",
    title: "Book Your First Detail",
    message: "You're all set! Tap Bookings then the + button to schedule your first detail.",
    spotX: 0.3,       // Bookings is 2nd of 5 tabs
    spotY: TAB_Y,
    spotRadius: 36,
    tooltipPosition: "top",
    arrowDirection: "down",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────
interface Props {
  visible: boolean;
  onComplete: () => void;
}

export function OnboardingWalkthrough({ visible, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const arrowAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const current = WALKTHROUGH_STEPS[step];
  const isLast = step === WALKTHROUGH_STEPS.length - 1;

  // Fade in on mount / step change
  useEffect(() => {
    if (!visible) return;
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [visible, step]);

  // Pulsing glow around spotlight
  useEffect(() => {
    if (!visible) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [visible, step]);

  // Bouncing arrow
  useEffect(() => {
    if (!visible) return;
    const bounce = Animated.loop(
      Animated.sequence([
        Animated.timing(arrowAnim, { toValue: 10, duration: 500, useNativeDriver: true }),
        Animated.timing(arrowAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
      ])
    );
    bounce.start();
    return () => bounce.stop();
  }, [visible, step]);

  function handleNext() {
    if (isLast) {
      onComplete();
    } else {
      setStep((s) => s + 1);
    }
  }

  async function handleSkip() {
    await AsyncStorage.setItem(ONBOARDING_DONE_KEY, "1");
    onComplete();
  }

  if (!visible || !current) return null;

  const cx = current.spotX * SW;
  const cy = current.spotY * SH;
  const r = current.spotRadius;

  // Arrow translation based on direction
  const arrowTranslate =
    current.arrowDirection === "down" || current.arrowDirection === "up"
      ? { translateY: arrowAnim }
      : { translateX: arrowAnim };

  // Tooltip vertical position
  const tooltipTop =
    current.tooltipPosition === "top"
      ? cy - r - 200
      : current.tooltipPosition === "bottom"
      ? cy + r + 20
      : SH / 2 - 80;

  // Arrow icon
  const arrowIcon =
    current.arrowDirection === "down"
      ? "arrow-downward"
      : current.arrowDirection === "up"
      ? "arrow-upward"
      : current.arrowDirection === "left"
      ? "arrow-back"
      : "arrow-forward";

  // Arrow position relative to tooltip
  const arrowOnTop = current.arrowDirection === "down"; // arrow appears below tooltip pointing down
  const arrowOnBottom = current.arrowDirection === "up"; // arrow appears below tooltip pointing up

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        {/* Dark overlay — rendered as 4 rectangles around the spotlight */}
        {/* Top */}
        <View style={[styles.overlay, { top: 0, left: 0, right: 0, height: Math.max(0, cy - r) }]} />
        {/* Bottom */}
        <View style={[styles.overlay, { top: cy + r, left: 0, right: 0, bottom: 0 }]} />
        {/* Left */}
        <View style={[styles.overlay, { top: cy - r, left: 0, width: Math.max(0, cx - r), height: r * 2 }]} />
        {/* Right */}
        <View style={[styles.overlay, { top: cy - r, left: cx + r, right: 0, height: r * 2 }]} />

        {/* Pulsing glow ring */}
        <Animated.View
          style={[
            styles.glowRing,
            {
              width: r * 2 + 16,
              height: r * 2 + 16,
              borderRadius: r + 8,
              left: cx - r - 8,
              top: cy - r - 8,
              transform: [{ scale: pulseAnim }],
            },
          ]}
        />

        {/* Spotlight circle cutout (transparent) */}
        <View
          style={[
            styles.spotlight,
            {
              width: r * 2,
              height: r * 2,
              borderRadius: r,
              left: cx - r,
              top: cy - r,
            },
          ]}
        />

        {/* Tooltip card */}
        <View
          style={[
            styles.tooltip,
            {
              top: Math.max(60, Math.min(tooltipTop, SH - 220)),
              left: 20,
              right: 20,
            },
          ]}
        >
          {/* Step dots */}
          <View style={styles.dotsRow}>
            {WALKTHROUGH_STEPS.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === step && styles.dotActive]}
              />
            ))}
          </View>

          <Text style={styles.tooltipTitle}>{current.title}</Text>
          <Text style={styles.tooltipMessage}>{current.message}</Text>

          {/* Arrow below tooltip (pointing toward spotlight below) */}
          {arrowOnBottom && (
            <Animated.View style={[styles.arrowWrap, { transform: [arrowTranslate] }]}>
              <MaterialIcons name={arrowIcon} size={32} color="#0057FF" />
            </Animated.View>
          )}

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} activeOpacity={0.7}>
              <Text style={styles.skipText}>Skip Tour</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.nextBtn} onPress={handleNext} activeOpacity={0.85}>
              <Text style={styles.nextText}>{isLast ? "Got it!" : "Next"}</Text>
              {!isLast && <MaterialIcons name="arrow-forward" size={16} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>

        {/* Arrow above tooltip (pointing toward spotlight above) */}
        {arrowOnTop && (
          <Animated.View
            style={[
              styles.arrowAbove,
              {
                top: Math.max(60, Math.min(tooltipTop, SH - 220)) - 40,
                left: SW / 2 - 16,
                transform: [arrowTranslate],
              },
            ]}
          >
            <MaterialIcons name={arrowIcon} size={32} color="#0057FF" />
          </Animated.View>
        )}
      </Animated.View>
    </Modal>
  );
}

// ─── Hook: check if walkthrough should show ───────────────────────────────────
export function useOnboardingWalkthrough() {
  const [show, setShow] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_DONE_KEY).then((val) => {
      if (!val) setShow(true);
      setChecked(true);
    });
  }, []);

  async function complete() {
    await AsyncStorage.setItem(ONBOARDING_DONE_KEY, "1");
    setShow(false);
  }

  return { show: checked && show, complete };
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
  },
  overlay: {
    position: "absolute",
    backgroundColor: "rgba(0,0,0,0.82)",
  },
  glowRing: {
    position: "absolute",
    borderWidth: 2.5,
    borderColor: "#0057FF",
    backgroundColor: "transparent",
  },
  spotlight: {
    position: "absolute",
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.25)",
  },
  tooltip: {
    position: "absolute",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 20,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 12,
    justifyContent: "center",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#E5E7EB",
  },
  dotActive: {
    backgroundColor: "#0057FF",
    width: 20,
  },
  tooltipTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0A0A0A",
    marginBottom: 8,
    textAlign: "center",
  },
  tooltipMessage: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 16,
  },
  arrowWrap: {
    alignItems: "center",
    marginBottom: 8,
  },
  arrowAbove: {
    position: "absolute",
    alignItems: "center",
  },
  btnRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  skipBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  skipText: {
    fontSize: 14,
    color: "#9CA3AF",
    fontWeight: "600",
  },
  nextBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#0057FF",
    borderRadius: 100,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  nextText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
