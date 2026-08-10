import { View, Text, TouchableOpacity, Modal, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/use-colors";

export interface SuggestedCity {
  city: string;
  percentBooked: number;
  jobCount: number;
  totalMinutes: number;
  startingAddress: string;
}

interface DoorHangerSuggestionModalProps {
  visible: boolean;
  suggestedCity: SuggestedCity | null;
  isLoading: boolean;
  onDismiss: () => void;
}

export function DoorHangerSuggestionModal({
  visible,
  suggestedCity,
  isLoading,
  onDismiss,
}: DoorHangerSuggestionModalProps) {
  const colors = useColors();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          justifyContent: "center",
          alignItems: "center",
          padding: 20,
        }}
      >
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 20,
            padding: 24,
            width: "100%",
            maxWidth: 320,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            gap: 16,
          }}
        >
          {isLoading ? (
            <>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "700",
                  color: colors.foreground,
                }}
              >
                Finding best location...
              </Text>
            </>
          ) : suggestedCity ? (
            <>
              <Text style={{ fontSize: 40 }}>📍</Text>
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: "700",
                  color: colors.foreground,
                  textAlign: "center",
                }}
              >
                Suggested Location
              </Text>
              <View
                style={{
                  backgroundColor: colors.background,
                  borderRadius: 14,
                  padding: 16,
                  width: "100%",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Text
                  style={{
                    fontSize: 28,
                    fontWeight: "900",
                    color: colors.primary,
                  }}
                >
                  {suggestedCity.city}
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    color: colors.muted,
                    textAlign: "center",
                  }}
                >
                  {suggestedCity.percentBooked}% booked this week
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.muted,
                    textAlign: "center",
                  }}
                >
                  {suggestedCity.jobCount} scheduled jobs
                </Text>
              </View>
              <View
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: 12,
                  padding: 12,
                  width: "100%",
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    color: colors.muted,
                    marginBottom: 4,
                  }}
                >
                  Starting Address
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color: colors.foreground,
                  }}
                  numberOfLines={2}
                >
                  {suggestedCity.startingAddress}
                </Text>
              </View>
              <Text
                style={{
                  fontSize: 13,
                  color: colors.muted,
                  textAlign: "center",
                  lineHeight: 18,
                }}
              >
                This city has the most availability for door hangers this week.
              </Text>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 40 }}>⚠️</Text>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "700",
                  color: colors.foreground,
                  textAlign: "center",
                }}
              >
                No data available
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: colors.muted,
                  textAlign: "center",
                }}
              >
                Schedule some jobs first to see suggestions.
              </Text>
            </>
          )}

          <TouchableOpacity
            onPress={onDismiss}
            style={{
              backgroundColor: colors.primary,
              borderRadius: 12,
              paddingVertical: 12,
              paddingHorizontal: 24,
              width: "100%",
              alignItems: "center",
              marginTop: 8,
            }}
          >
            <Text
              style={{
                color: "#fff",
                fontWeight: "700",
                fontSize: 14,
              }}
            >
              Got it, let's go!
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
