import { Pressable, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export interface PremiumButtonProps {
  onPress?: () => void;
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "large" | "medium" | "small";
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  loading?: boolean;
}

export function PremiumButton({
  onPress,
  label,
  variant = "primary",
  size = "large",
  disabled = false,
  fullWidth = false,
  icon,
  loading = false,
}: PremiumButtonProps) {
  const colors = useColors();

  const sizeStyles = {
    large: { paddingVertical: 14, paddingHorizontal: 16, fontSize: 16 },
    medium: { paddingVertical: 10, paddingHorizontal: 12, fontSize: 14 },
    small: { paddingVertical: 8, paddingHorizontal: 10, fontSize: 12 },
  };

  const variantStyles: Record<string, any> = {
    primary: {
      backgroundColor: disabled ? colors.border : colors.primary,
      borderWidth: 0,
      borderColor: "transparent",
      textColor: "#FFFFFF",
    },
    secondary: {
      backgroundColor: "transparent",
      borderWidth: 2,
      borderColor: colors.primary,
      textColor: colors.primary,
    },
    ghost: {
      backgroundColor: "transparent",
      borderWidth: 0,
      borderColor: "transparent",
      textColor: colors.primary,
    },
  };

  const style = sizeStyles[size];
  const variant_style = variantStyles[variant];

  const handlePress = () => {
    if (!disabled && !loading && onPress) {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      onPress();
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          width: fullWidth ? "100%" : "auto",
          opacity: disabled ? 0.5 : pressed ? 0.9 : 1,
          transform: [{ scale: pressed && !disabled ? 0.97 : 1 }],
        },
      ]}
    >
      <View
        style={{
          backgroundColor: variant_style.backgroundColor,
          borderWidth: variant_style.borderWidth,
          borderColor: variant_style.borderColor,
          borderRadius: 12,
          paddingVertical: style.paddingVertical,
          paddingHorizontal: style.paddingHorizontal,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {icon && !loading && <View>{icon}</View>}
        {loading && (
          <View style={{ width: 16, height: 16 }}>
            {/* Placeholder for loading spinner */}
          </View>
        )}
        <Text
          style={{
            fontSize: style.fontSize,
            fontWeight: "600",
            color: variant_style.textColor,
          }}
        >
          {loading ? "Loading..." : label}
        </Text>
      </View>
    </Pressable>
  );
}
