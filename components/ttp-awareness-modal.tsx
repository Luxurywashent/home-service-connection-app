/**
 * TTPAwarenessModal
 *
 * One-time full-screen modal that introduces Tap to Pay on iPhone to the user.
 * Shown once per install to eligible (admin) users.
 *
 * Apple requirement 3.1, 3.2, 3.3:
 * - Highly visible, discoverable communication about TTP
 * - Full-screen modal (splash screen) for TTP
 * - Show to all eligible users at least once
 */
import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
} from "react-native";
import { useColors } from "@/hooks/use-colors";

const { width } = Dimensions.get("window");

interface TTPAwarenessModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSetUpNow: () => void;
}

export function TTPAwarenessModal({ visible, onDismiss, onSetUpNow }: TTPAwarenessModalProps) {
  const colors = useColors();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
    >
      <View style={[styles.container, { backgroundColor: "#0a0a0a" }]}>
        {/* Background gradient effect */}
        <View style={styles.bgGlow} />

        {/* Icon */}
        <View style={styles.iconContainer}>
          <Text style={styles.mainIcon}>📲</Text>
          <View style={styles.iconBadge}>
            <Text style={styles.iconBadgeText}>NEW</Text>
          </View>
        </View>

        {/* Headline */}
        <Text style={styles.headline}>Accept Payments{"\n"}Without a Reader</Text>
        <Text style={styles.subheadline}>
          Tap to Pay on iPhone is now available. Customers can tap their card, Apple Pay, or Google Pay directly on your iPhone — no hardware needed.
        </Text>

        {/* Feature bullets */}
        <View style={styles.featureList}>
          {[
            { icon: "💳", text: "Contactless cards — Visa, Mastercard, Amex, Discover" },
            { icon: "📱", text: "Apple Pay, Google Pay, Samsung Pay" },
            { icon: "🔒", text: "Secured by Stripe — PCI compliant" },
            { icon: "⚡", text: "No extra hardware or monthly fees" },
          ].map((item, i) => (
            <View key={i} style={styles.featureRow}>
              <Text style={styles.featureIcon}>{item.icon}</Text>
              <Text style={styles.featureText}>{item.text}</Text>
            </View>
          ))}
        </View>

        {/* Requirement note */}
        <Text style={styles.requirementNote}>
          Requires iPhone XS or later · iOS 17.6+
        </Text>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={onSetUpNow}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>Set Up Tap to Pay →</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={onDismiss}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryBtnText}>Maybe Later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingTop: 60,
    paddingBottom: 48,
  },
  bgGlow: {
    position: "absolute",
    top: "20%",
    left: "50%",
    width: 300,
    height: 300,
    marginLeft: -150,
    borderRadius: 150,
    backgroundColor: "#8B5CF620",
  },
  iconContainer: {
    position: "relative",
    marginBottom: 28,
  },
  mainIcon: {
    fontSize: 80,
    textAlign: "center",
  },
  iconBadge: {
    position: "absolute",
    top: 0,
    right: -8,
    backgroundColor: "#8B5CF6",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  iconBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  headline: {
    fontSize: 32,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
    lineHeight: 40,
    marginBottom: 14,
  },
  subheadline: {
    fontSize: 15,
    color: "#9CA3AF",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  featureList: {
    width: "100%",
    gap: 12,
    marginBottom: 20,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#ffffff0a",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  featureIcon: {
    fontSize: 22,
  },
  featureText: {
    fontSize: 14,
    color: "#E5E7EB",
    flex: 1,
    lineHeight: 20,
  },
  requirementNote: {
    fontSize: 12,
    color: "#6B7280",
    textAlign: "center",
    marginBottom: 28,
  },
  actions: {
    width: "100%",
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: "#8B5CF6",
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  secondaryBtn: {
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryBtnText: {
    color: "#6B7280",
    fontSize: 15,
    fontWeight: "500",
  },
});
