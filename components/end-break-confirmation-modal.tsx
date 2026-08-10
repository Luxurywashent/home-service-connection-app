import { Modal, View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/use-colors";

interface EndBreakConfirmationModalProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function EndBreakConfirmationModal({
  visible,
  onConfirm,
  onCancel,
  isLoading = false,
}: EndBreakConfirmationModalProps) {
  const colors = useColors();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: 16,
        }}
      >
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 24,
            width: "100%",
            maxWidth: 320,
          }}
        >
          <Text
            style={{
              fontSize: 18,
              fontWeight: "700",
              color: colors.foreground,
              marginBottom: 12,
              textAlign: "center",
            }}
          >
            End Break?
          </Text>

          <Text
            style={{
              fontSize: 14,
              color: colors.muted,
              marginBottom: 24,
              textAlign: "center",
              lineHeight: 20,
            }}
          >
            Are you sure you want to end your break now?
          </Text>

          <View style={{ flexDirection: "row", gap: 12 }}>
            <TouchableOpacity
              disabled={isLoading}
              onPress={onCancel}
              style={{
                flex: 1,
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 8,
                backgroundColor: colors.border,
                justifyContent: "center",
                alignItems: "center",
                opacity: isLoading ? 0.6 : 1,
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: colors.foreground,
                }}
              >
                Cancel
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={isLoading}
              onPress={onConfirm}
              style={{
                flex: 1,
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 8,
                backgroundColor: colors.success,
                justifyContent: "center",
                alignItems: "center",
                opacity: isLoading ? 0.6 : 1,
              }}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "600",
                    color: "#FFF",
                  }}
                >
                  End Break
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
