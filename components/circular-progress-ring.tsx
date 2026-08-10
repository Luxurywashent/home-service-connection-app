import React from "react";
import { View, Text } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useColors } from "@/hooks/use-colors";

interface CircularProgressRingProps {
  current: number;
  goal: number;
  label: string;
  size?: number;
  strokeWidth?: number;
}

export function CircularProgressRing({
  current,
  goal,
  label,
  size = 140,
  strokeWidth = 8,
}: CircularProgressRingProps) {
  const colors = useColors();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percentage = Math.min((current / goal) * 100, 100);
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <View className="items-center gap-2">
      <View style={{ width: size, height: size, justifyContent: "center", alignItems: "center" }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Background circle */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colors.border}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Progress circle */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colors.primary}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        {/* Center text */}
        <View className="absolute items-center">
          <Text className="text-2xl font-bold text-foreground">{current}</Text>
          <Text className="text-xs text-muted">of {goal}</Text>
        </View>
      </View>
      <Text className="text-sm font-semibold text-foreground text-center">{label}</Text>
      <Text className="text-xs text-muted">{percentage.toFixed(0)}% complete</Text>
    </View>
  );
}
