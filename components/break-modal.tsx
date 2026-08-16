import { View, Text, TouchableOpacity, Modal, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useState } from "react";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";
import * as Location from "expo-location";

interface BreakType {
  id: "morning_15min" | "afternoon_15min" | "lunch_30min";
  label: string;
  duration: string;
  icon: string;
  description: string;
}

const BREAK_TYPES: BreakType[] = [
  {
    id: "morning_15min",
    label: "Morning Break",
    duration: "15 min",
    icon: "☀️",
    description: "Morning coffee break",
  },
  {
    id: "lunch_30min",
    label: "Lunch Break",
    duration: "30 min",
    icon: "🍽️",
    description: "Lunch time",
  },
  {
    id: "afternoon_15min",
    label: "Afternoon Break",
    duration: "15 min",
    icon: "🌤️",
    description: "Afternoon break",
  },
];

interface BreakModalProps {
  visible: boolean;
  onClose: () => void;
}

export function BreakModal({ visible, onClose }: BreakModalProps) {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const [selectedBreak, setSelectedBreak] = useState<"morning_15min" | "afternoon_15min" | "lunch_30min" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createBreakMutation = trpc.timesheet.createBreakNotification.useMutation();

  const handleStartBreak = async () => {
    if (!selectedBreak || !employee?.employeeId) return;

    setIsSubmitting(true);
    try {
      // Capture GPS when starting break
      let startLat: number | undefined;
      let startLng: number | undefined;
      if (Platform.OS !== "web") {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === "granted") {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            startLat = loc.coords.latitude;
            startLng = loc.coords.longitude;
          }
        } catch (locErr) {
          console.warn("Break start location capture failed:", locErr);
        }
      }
      await createBreakMutation.mutateAsync({
        employeeId: employee.employeeId,
        fullName: employee.fullName || "Employee",
        breakType: selectedBreak,
        ...(startLat != null && startLng != null ? { startLat, startLng } : {}),
      });

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      // Mark break as taken
      // The break will be recorded in the database
      setSelectedBreak(null);
      onClose();
    } catch (error) {
      console.error("Start break error:", error);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      {/* Overlay */}
      <TouchableOpacity
        style={{
          flex: 1,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          justifyContent: "flex-end",
        }}
        activeOpacity={1}
        onPress={onClose}
      >
        {/* Modal Content */}
        <TouchableOpacity
          activeOpacity={1}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 20,
            paddingVertical: 24,
            paddingBottom: 40,
          }}
        >
          {/* Header */}
          <View style={{ marginBottom: 24 }}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground }}>
              Select Break Type
            </Text>
            <Text style={{ fontSize: 14, color: colors.muted, marginTop: 4 }}>
              Choose the type of break you're taking
            </Text>
          </View>

          {/* Break Options */}
          <View style={{ gap: 12, marginBottom: 24 }}>
            {BREAK_TYPES.map((breakType) => (
              <TouchableOpacity
                key={breakType.id}
                onPress={() => {
                  setSelectedBreak(breakType.id);
                  if (Platform.OS !== "web") {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }
                }}
                style={{
                  backgroundColor: selectedBreak === breakType.id ? colors.primary + "20" : colors.background,
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 2,
                  borderColor: selectedBreak === breakType.id ? colors.primary : colors.border,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <Text style={{ fontSize: 24 }}>{breakType.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>
                    {breakType.label}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                    {breakType.description} • {breakType.duration}
                  </Text>
                </View>
                {selectedBreak === breakType.id && (
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: colors.primary,
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontSize: 14, color: "#FFF" }}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* Action Buttons */}
          <View style={{ gap: 12, flexDirection: "row" }}>
            <TouchableOpacity
              onPress={onClose}
              disabled={isSubmitting}
              style={{
                flex: 1,
                backgroundColor: colors.border,
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: "center",
                opacity: isSubmitting ? 0.6 : 1,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>
                Cancel
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleStartBreak}
              disabled={!selectedBreak || isSubmitting}
              style={{
                flex: 1,
                backgroundColor: selectedBreak ? colors.primary : colors.muted,
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: "center",
                opacity: (!selectedBreak || isSubmitting) ? 0.6 : 1,
              }}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={{ fontSize: 14, fontWeight: "600", color: "#FFF" }}>
                  Start Break
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}
