/**
 * TTPSettingsPanel
 *
 * Admin settings panel for managing Tap to Pay on iPhone.
 * Shows current status, allows enabling/disabling, and provides re-education access.
 *
 * Apple requirements addressed:
 *  - 3.6: Allow enabling TTP from Settings (outside checkout flow)
 *  - 4.3: Provide merchant education in Settings or Help section
 */
import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Platform,
  Alert,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useTTP } from "@/lib/ttp-context";
import { TTPTosModal } from "@/components/ttp-tos-modal";
import { TTPEducationScreens } from "@/components/ttp-education-screens";

interface TTPSettingsPanelProps {
  isAdmin: boolean;
}

export function TTPSettingsPanel({ isAdmin }: TTPSettingsPanelProps) {
  const colors = useColors();
  const { tosAccepted, ttpAvailable, acceptTos, resetTtp, markEducationShown } = useTTP();
  const [showTos, setShowTos] = useState(false);
  const [showEducation, setShowEducation] = useState(false);

  const handleToggle = (value: boolean) => {
    if (value && !tosAccepted) {
      setShowTos(true);
    } else if (!value && tosAccepted) {
      Alert.alert(
        "Disable Tap to Pay?",
        "You can re-enable it anytime from settings.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Disable",
            style: "destructive",
            onPress: () => resetTtp(),
          },
        ]
      );
    }
  };

  if (!ttpAvailable) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tap to Pay on iPhone</Text>
        <Text style={[styles.unavailableText, { color: colors.muted }]}>
          Tap to Pay is only available on iOS devices (iPhone XS or later with iOS 17.6+).
        </Text>
      </View>
    );
  }

  return (
    <>
      <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tap to Pay on iPhone</Text>

        {/* Status row */}
        <View style={[styles.row, { borderBottomColor: colors.border }]}>
          <View style={styles.rowLeft}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Enable Tap to Pay</Text>
            <Text style={[styles.rowDesc, { color: colors.muted }]}>
              {tosAccepted
                ? "Active — customers can tap to pay"
                : "Accept contactless cards without hardware"}
            </Text>
          </View>
          <Switch
            value={tosAccepted}
            onValueChange={handleToggle}
            trackColor={{ false: colors.border, true: "#8B5CF6" }}
            thumbColor="#fff"
            disabled={!isAdmin}
          />
        </View>

        {/* Status badge */}
        <View style={styles.statusRow}>
          <View style={[styles.statusBadge, { backgroundColor: tosAccepted ? "#22C55E20" : "#6B728020" }]}>
            <View style={[styles.statusDot, { backgroundColor: tosAccepted ? "#22C55E" : "#6B7280" }]} />
            <Text style={[styles.statusText, { color: tosAccepted ? "#22C55E" : "#6B7280" }]}>
              {tosAccepted ? "Active" : "Not Set Up"}
            </Text>
          </View>
        </View>

        {/* Education / Help */}
        {tosAccepted && (
          <TouchableOpacity
            style={[styles.helpRow, { borderTopColor: colors.border }]}
            onPress={() => setShowEducation(true)}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 18 }}>📚</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.helpTitle, { color: colors.foreground }]}>How to Accept Payments</Text>
              <Text style={[styles.helpDesc, { color: colors.muted }]}>
                View the guide for contactless cards and Apple Pay
              </Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
          </TouchableOpacity>
        )}

        {/* Accepted by note */}
        {tosAccepted && (
          <Text style={[styles.acceptedNote, { color: colors.muted }]}>
            Terms & Conditions accepted · Powered by Stripe Terminal
          </Text>
        )}

        {/* Non-admin notice */}
        {!isAdmin && (
          <Text style={[styles.notAdminNote, { color: colors.muted }]}>
            Contact your admin to enable or configure Tap to Pay.
          </Text>
        )}
      </View>

      <TTPTosModal
        visible={showTos}
        isAdmin={isAdmin}
        onAccept={async () => {
          await acceptTos();
          setShowTos(false);
          setShowEducation(true);
        }}
        onDecline={() => setShowTos(false)}
      />

      <TTPEducationScreens
        visible={showEducation}
        onComplete={() => {
          markEducationShown();
          setShowEducation(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  rowLeft: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 2,
  },
  rowDesc: {
    fontSize: 12,
    lineHeight: 17,
  },
  statusRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
  helpRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 0.5,
  },
  helpTitle: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 1,
  },
  helpDesc: {
    fontSize: 12,
  },
  acceptedNote: {
    fontSize: 11,
    paddingHorizontal: 16,
    paddingBottom: 12,
    lineHeight: 16,
  },
  notAdminNote: {
    fontSize: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    lineHeight: 18,
    fontStyle: "italic",
  },
  unavailableText: {
    fontSize: 13,
    paddingHorizontal: 16,
    paddingBottom: 14,
    lineHeight: 19,
  },
});
