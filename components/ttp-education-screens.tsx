/**
 * TTPEducationScreens
 *
 * Multi-page educational walkthrough shown after T&C acceptance.
 * Teaches the merchant how to accept payments with Tap to Pay.
 *
 * Apple requirements addressed:
 *  - 4.2: Display educational screens after T&C acceptance
 *  - 4.5: Education shows how to accept contactless cards
 *  - 4.6: Education shows how to accept Apple Pay and digital wallets
 */
import React, { useState, useRef } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Dimensions,
  Animated,
} from "react-native";
import { useColors } from "@/hooks/use-colors";

const { width } = Dimensions.get("window");

interface EducationPage {
  icon: string;
  title: string;
  description: string;
  steps?: string[];
  tip?: string;
}

const PAGES: EducationPage[] = [
  {
    icon: "🎉",
    title: "Tap to Pay is Ready!",
    description: "You've enabled Tap to Pay on iPhone. Here's a quick guide to help you get the most out of it.",
  },
  {
    icon: "💳",
    title: "Accepting Contactless Cards",
    description: "Customers can tap any contactless-enabled credit or debit card directly on your iPhone.",
    steps: [
      "Open the checkout screen and select Tap to Pay",
      "Ask the customer to hold their card near the top of your iPhone",
      "Wait for the confirmation chime and checkmark",
      "The payment is captured automatically",
    ],
    tip: "Works with Visa, Mastercard, Amex, and Discover contactless cards.",
  },
  {
    icon: "📱",
    title: "Accepting Apple Pay & Digital Wallets",
    description: "Customers can also pay using Apple Pay, Google Pay, or Samsung Pay — even faster than a physical card.",
    steps: [
      "Open the checkout screen and select Tap to Pay",
      "Ask the customer to hold their iPhone or Apple Watch near yours",
      "The customer authenticates with Face ID or Touch ID on their device",
      "Payment is complete instantly",
    ],
    tip: "Digital wallets are the fastest and most secure payment method.",
  },
  {
    icon: "📍",
    title: "Best Practices",
    description: "A few tips to ensure every transaction goes smoothly.",
    steps: [
      "Hold your iPhone steady — don't move it while the customer taps",
      "The NFC reader is at the top of your iPhone",
      "If a tap fails, ask the customer to try again or use a different card",
      "Ensure your iPhone has a strong signal or Wi-Fi connection",
    ],
    tip: "Most transactions complete in under 2 seconds.",
  },
  {
    icon: "✅",
    title: "You're All Set!",
    description: "Tap to Pay on iPhone is now active. You can start accepting contactless payments right away from the checkout screen.",
    tip: "You can manage Tap to Pay settings anytime from the admin settings menu.",
  },
];

interface TTPEducationScreensProps {
  visible: boolean;
  onComplete: () => void;
}

export function TTPEducationScreens({ visible, onComplete }: TTPEducationScreensProps) {
  const colors = useColors();
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const goNext = () => {
    if (page < PAGES.length - 1) {
      const next = page + 1;
      setPage(next);
      scrollRef.current?.scrollTo({ x: next * width, animated: true });
    } else {
      onComplete();
    }
  };

  const goPrev = () => {
    if (page > 0) {
      const prev = page - 1;
      setPage(prev);
      scrollRef.current?.scrollTo({ x: prev * width, animated: true });
    }
  };

  const current = PAGES[page]!;
  const isLast = page === PAGES.length - 1;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
    >
      <View style={[styles.container, { backgroundColor: "#0a0a0a" }]}>
        {/* Progress dots */}
        <View style={styles.dotsRow}>
          {PAGES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: i === page ? "#8B5CF6" : "#374151" },
                i === page && styles.dotActive,
              ]}
            />
          ))}
        </View>

        {/* Page content */}
        <View style={styles.content}>
          <Text style={styles.pageIcon}>{current.icon}</Text>
          <Text style={styles.pageTitle}>{current.title}</Text>
          <Text style={styles.pageDesc}>{current.description}</Text>

          {current.steps && (
            <View style={styles.stepsContainer}>
              {current.steps.map((step, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.stepText, { color: "#E5E7EB" }]}>{step}</Text>
                </View>
              ))}
            </View>
          )}

          {current.tip && (
            <View style={styles.tipBox}>
              <Text style={styles.tipIcon}>💡</Text>
              <Text style={styles.tipText}>{current.tip}</Text>
            </View>
          )}
        </View>

        {/* Navigation */}
        <View style={styles.navRow}>
          {page > 0 ? (
            <TouchableOpacity style={styles.backBtn} onPress={goPrev} activeOpacity={0.7}>
              <Text style={styles.backBtnText}>‹ Back</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.backBtn} />
          )}

          <TouchableOpacity
            style={[styles.nextBtn, { backgroundColor: isLast ? "#22C55E" : "#8B5CF6" }]}
            onPress={goNext}
            activeOpacity={0.85}
          >
            <Text style={styles.nextBtnText}>
              {isLast ? "Start Accepting Payments →" : "Next →"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Skip */}
        {!isLast && (
          <TouchableOpacity style={styles.skipBtn} onPress={onComplete} activeOpacity={0.6}>
            <Text style={styles.skipText}>Skip Tutorial</Text>
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingBottom: 48,
    paddingHorizontal: 28,
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 40,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 24,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pageIcon: {
    fontSize: 72,
    textAlign: "center",
    marginBottom: 24,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
    marginBottom: 12,
    lineHeight: 36,
  },
  pageDesc: {
    fontSize: 15,
    color: "#9CA3AF",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  stepsContainer: {
    width: "100%",
    gap: 10,
    marginBottom: 20,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "#ffffff08",
    borderRadius: 12,
    padding: 14,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#8B5CF6",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumberText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  stepText: {
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  tipBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#8B5CF615",
    borderRadius: 12,
    padding: 14,
    width: "100%",
  },
  tipIcon: {
    fontSize: 18,
  },
  tipText: {
    fontSize: 13,
    color: "#C4B5FD",
    lineHeight: 19,
    flex: 1,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 24,
  },
  backBtn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    minWidth: 80,
  },
  backBtnText: {
    color: "#6B7280",
    fontSize: 15,
    fontWeight: "500",
  },
  nextBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  nextBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  skipBtn: {
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
  },
  skipText: {
    color: "#4B5563",
    fontSize: 14,
  },
});
