import { Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { LinearGradient } from "expo-linear-gradient";

export interface HeroCardProps {
  title: string;
  value: string | number;
  unit?: string;
  subtitle?: string;
  status?: "excellent" | "good" | "needs-improvement";
  icon?: string;
}

export function HeroCard({
  title,
  value,
  unit,
  subtitle,
  status = "good",
  icon = "✨",
}: HeroCardProps) {
  const colors = useColors();

  const statusConfig = {
    excellent: {
      colors: ["#00B341", "#00D14F"],
      label: "Excellent",
      bgColor: colors.success,
    },
    good: {
      colors: ["#0066FF", "#0052CC"],
      label: "Good",
      bgColor: colors.primary,
    },
    "needs-improvement": {
      colors: ["#FF3B30", "#FF1F0A"],
      label: "Needs Improvement",
      bgColor: colors.error,
    },
  };

  const config = statusConfig[status];

  return (
    <LinearGradient
      colors={config.colors as any}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        borderRadius: 20,
        padding: 24,
        marginBottom: 20,
        overflow: "hidden",
      }}
    >
      {/* Background accent */}
      <View
        style={{
          position: "absolute",
          top: -40,
          right: -40,
          width: 120,
          height: 120,
          borderRadius: 60,
          backgroundColor: "rgba(255, 255, 255, 0.1)",
        }}
      />

      {/* Content */}
      <View style={{ position: "relative", zIndex: 1 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: "rgba(255, 255, 255, 0.8)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {title}
          </Text>
          <Text style={{ fontSize: 28 }}>{icon}</Text>
        </View>

        {/* Value */}
        <View style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <Text style={{ fontSize: 56, fontWeight: "800", color: "#FFFFFF" }}>
              {value}
            </Text>
            {unit && <Text style={{ fontSize: 18, fontWeight: "600", color: "rgba(255, 255, 255, 0.8)" }}>{unit}</Text>}
          </View>
        </View>

        {/* Status badge */}
        <View
          style={{
            alignSelf: "flex-start",
            paddingHorizontal: 12,
            paddingVertical: 6,
            backgroundColor: "rgba(255, 255, 255, 0.2)",
            borderRadius: 20,
            borderWidth: 1,
            borderColor: "rgba(255, 255, 255, 0.3)",
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: "#FFFFFF" }}>
            {config.label}
          </Text>
        </View>

        {/* Subtitle */}
        {subtitle && (
          <Text style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.7)", marginTop: 12 }}>
            {subtitle}
          </Text>
        )}
      </View>
    </LinearGradient>
  );
}
