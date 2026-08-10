/**
 * TTPTosModal
 *
 * Admin-only modal for accepting Stripe Terminal / Tap to Pay Terms & Conditions.
 * Non-admin users see a "contact your admin" message instead.
 *
 * Apple requirements addressed:
 *  - 3.5: Clear action to accept TTP Terms and Conditions
 *  - 3.8: T&C must only be accepted by admin/authorized user
 *  - 3.8.1: Show message to unauthorized users to contact admin
 */
import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useColors } from "@/hooks/use-colors";

interface TTPTosModalProps {
  visible: boolean;
  isAdmin: boolean;
  onAccept: () => Promise<void>;
  onDecline: () => void;
}

export function TTPTosModal({ visible, isAdmin, onAccept, onDecline }: TTPTosModalProps) {
  const colors = useColors();
  const [accepting, setAccepting] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await onAccept();
    } finally {
      setAccepting(false);
    }
  };

  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const isAtBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 40;
    if (isAtBottom) setScrolledToBottom(true);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Tap to Pay on iPhone
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.muted }]}>
            Terms & Conditions
          </Text>
        </View>

        {isAdmin ? (
          <>
            {/* TOS Content */}
            <ScrollView
              style={styles.scrollArea}
              onScroll={handleScroll}
              scrollEventThrottle={100}
              showsVerticalScrollIndicator
            >
              <Text style={[styles.tosSection, { color: colors.foreground }]}>
                Stripe Terminal — Tap to Pay on iPhone
              </Text>
              <Text style={[styles.tosBody, { color: colors.muted }]}>
                By enabling Tap to Pay on iPhone, you agree to Stripe's Terminal Terms of Service and the following conditions:
              </Text>

              <Text style={[styles.tosHeading, { color: colors.foreground }]}>1. Eligibility</Text>
              <Text style={[styles.tosBody, { color: colors.muted }]}>
                Tap to Pay on iPhone requires an iPhone XS or later running iOS 17.6 or later. Your Stripe account must be in good standing and approved for Terminal usage.
              </Text>

              <Text style={[styles.tosHeading, { color: colors.foreground }]}>2. Data Security</Text>
              <Text style={[styles.tosBody, { color: colors.muted }]}>
                All payment data is encrypted end-to-end by Stripe. No card data is stored on this device. Luxury Wash On Wheels and Stripe comply with PCI DSS requirements.
              </Text>

              <Text style={[styles.tosHeading, { color: colors.foreground }]}>3. Transaction Limits</Text>
              <Text style={[styles.tosBody, { color: colors.muted }]}>
                Tap to Pay on iPhone supports contactless payments up to the contactless limit set by the card network (typically $250 for US transactions). Higher amounts may require PIN entry on the customer's device.
              </Text>

              <Text style={[styles.tosHeading, { color: colors.foreground }]}>4. Accepted Payment Methods</Text>
              <Text style={[styles.tosBody, { color: colors.muted }]}>
                Tap to Pay on iPhone accepts contactless credit and debit cards (Visa, Mastercard, American Express, Discover) and digital wallets (Apple Pay, Google Pay, Samsung Pay).
              </Text>

              <Text style={[styles.tosHeading, { color: colors.foreground }]}>5. Refunds & Disputes</Text>
              <Text style={[styles.tosBody, { color: colors.muted }]}>
                All refunds and dispute resolutions are handled through your Stripe dashboard. Luxury Wash On Wheels is responsible for resolving customer disputes in accordance with Stripe's dispute policy.
              </Text>

              <Text style={[styles.tosHeading, { color: colors.foreground }]}>6. Stripe Terminal Terms</Text>
              <Text style={[styles.tosBody, { color: colors.muted }]}>
                This feature is powered by Stripe Terminal. By accepting these terms, you also agree to Stripe's Terminal Terms of Service available at stripe.com/terminal/legal.
              </Text>

              <TouchableOpacity
                onPress={() => Linking.openURL("https://stripe.com/terminal/legal")}
                style={styles.linkRow}
              >
                <Text style={[styles.linkText, { color: "#8B5CF6" }]}>
                  View Full Stripe Terminal Terms →
                </Text>
              </TouchableOpacity>

              <View style={{ height: 40 }} />
            </ScrollView>

            {/* Action buttons */}
            <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
              {!scrolledToBottom && (
                <Text style={[styles.scrollHint, { color: colors.muted }]}>
                  Scroll to read all terms before accepting
                </Text>
              )}
              <TouchableOpacity
                style={[
                  styles.acceptBtn,
                  { backgroundColor: scrolledToBottom ? "#8B5CF6" : "#8B5CF640" },
                ]}
                onPress={handleAccept}
                disabled={!scrolledToBottom || accepting}
                activeOpacity={0.85}
              >
                {accepting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.acceptBtnText}>
                    I Accept — Enable Tap to Pay
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.declineBtn}
                onPress={onDecline}
                activeOpacity={0.7}
              >
                <Text style={[styles.declineBtnText, { color: colors.muted }]}>
                  Not Now
                </Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          /* Non-admin view */
          <View style={styles.notAdminContainer}>
            <Text style={{ fontSize: 56, textAlign: "center", marginBottom: 20 }}>🔒</Text>
            <Text style={[styles.notAdminTitle, { color: colors.foreground }]}>
              Admin Access Required
            </Text>
            <Text style={[styles.notAdminBody, { color: colors.muted }]}>
              Tap to Pay on iPhone must be set up by an admin or manager. Please contact your administrator to enable this feature.
            </Text>
            <TouchableOpacity
              style={[styles.declineBtn, { marginTop: 32 }]}
              onPress={onDecline}
              activeOpacity={0.7}
            >
              <Text style={[styles.declineBtnText, { color: "#8B5CF6" }]}>
                Got It
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 0.5,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 14,
  },
  scrollArea: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  tosSection: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 8,
  },
  tosHeading: {
    fontSize: 15,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 6,
  },
  tosBody: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 4,
  },
  linkRow: {
    marginTop: 16,
    paddingVertical: 8,
  },
  linkText: {
    fontSize: 14,
    fontWeight: "600",
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
    borderTopWidth: 0.5,
    gap: 10,
  },
  scrollHint: {
    fontSize: 12,
    textAlign: "center",
    marginBottom: 4,
  },
  acceptBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  acceptBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  declineBtn: {
    paddingVertical: 12,
    alignItems: "center",
  },
  declineBtnText: {
    fontSize: 15,
    fontWeight: "500",
  },
  notAdminContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  notAdminTitle: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 12,
  },
  notAdminBody: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
});
