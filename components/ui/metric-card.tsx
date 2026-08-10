import { Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";

export interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: string;
  trend?: {
    value: number;
    direction: "up" | "down";
  };
  color?: "primary" | "success" | "warning" | "error" | "accent";
}

export function MetricCard({
  label,
  value,
  unit,
  icon,
  trend,
  color = "primary",
}: MetricCardProps) {
  const colors = useColors();

  const colorMap = {
    primary: colors.primary,
    success: colors.success,
    warning: colors.warning,
    error: colors.error,
    accent: "#FFB800",
  };

  const accentColor = colorMap[color];

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
        minHeight: 110,
        justifyContent: "space-between",
      }}
    >
      {/* Header with label and trend */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Text style={{ fontSize: 12, fontWeight: "500", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {label}
        </Text>
        {trend && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 4,
              backgroundColor: trend.direction === "up" ? colors.success + "15" : colors.error + "15",
              borderRadius: 6,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "600", color: trend.direction === "up" ? colors.success : colors.error }}>
              {trend.direction === "up" ? "↑" : "↓"} {Math.abs(trend.value)}%
            </Text>
          </View>
        )}
      </View>

      {/* Value section */}
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        {icon && <Text style={{ fontSize: 24 }}>{icon}</Text>}
        <Text style={{ fontSize: 28, fontWeight: "700", color: accentColor }}>
          {value}
        </Text>
        {unit && <Text style={{ fontSize: 14, fontWeight: "500", color: colors.muted }}>{unit}</Text>}
      </View>
    </View>
  );
}
