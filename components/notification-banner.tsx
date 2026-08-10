import React, { useState } from "react";
import { View, Text, TouchableOpacity, Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/use-colors";

export interface NotificationBannerProps {
  notificationId: string;
  title: string;
  message: string;
  requiresAcknowledgment: "yes" | "no";
  notificationType: "qc_issue" | "write_up" | "missed_step" | "coaching_note" | "time_off_update" | "company_announcement" | "repair_request";
  onDismiss: (notificationId: string) => void;
  onAcknowledge: (notificationId: string) => void;
}

export function NotificationBanner({
  notificationId,
  title,
  message,
  requiresAcknowledgment,
  notificationType,
  onDismiss,
  onAcknowledge,
}: NotificationBannerProps) {
  const colors = useColors();
  const [isLoading, setIsLoading] = useState(false);

  // Determine banner color based on notification type
  const getNotificationColor = () => {
    switch (notificationType) {
      case "qc_issue":
      case "write_up":
      case "missed_step":
        return colors.error;
      case "coaching_note":
        return colors.warning;
      case "time_off_update":
      case "company_announcement":
        return colors.primary;
      case "repair_request":
        return "#F59E0B";
      default:
        return colors.primary;
    }
  };

  const handleDismiss = async () => {
    setIsLoading(true);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    try {
      onDismiss(notificationId);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAcknowledge = async () => {
    setIsLoading(true);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    try {
      onAcknowledge(notificationId);
    } finally {
      setIsLoading(false);
    }
  };

  const notificationColor = getNotificationColor();

  return (
    <View
      style={{
        marginHorizontal: 20,
        marginBottom: 16,
        borderLeftWidth: 4,
        borderLeftColor: notificationColor,
        backgroundColor: notificationColor + "15",
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: notificationColor + "30",
      }}
    >
      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>
        {title}
      </Text>
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12, lineHeight: 18 }}>
        {message}
      </Text>

      <View style={{ flexDirection: "row", gap: 8 }}>
        {requiresAcknowledgment === "no" ? (
          <TouchableOpacity
            onPress={handleDismiss}
            disabled={isLoading}
            style={{ flex: 1 }}
          >
            <View
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 8,
                backgroundColor: colors.border,
                alignItems: "center",
              }}
            >
              <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>
                {isLoading ? "Dismissing..." : "Dismiss"}
              </Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleAcknowledge}
            disabled={isLoading}
            style={{ flex: 1 }}
          >
            <View
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 8,
                backgroundColor: notificationColor,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "600" }}>
                {isLoading ? "Acknowledging..." : "Acknowledge"}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
