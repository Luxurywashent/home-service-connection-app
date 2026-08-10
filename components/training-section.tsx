import { Text, View, Pressable } from "react-native";
import { useRouter } from "expo-router";

const TRAINING_CARDS = [
  {
    id: "van",
    title: "Van Training",
    description: "Setup, organization, and equipment care",
    emoji: "🚐",
    color: "#F59E0B",
  },
  {
    id: "exterior",
    title: "Exterior Detailing",
    description: "Wash, decontamination, paint protection",
    emoji: "🚗",
    color: "#3B82F6",
  },
  {
    id: "interior",
    title: "Interior Detailing",
    description: "Deep clean, upholstery, windows & trim",
    emoji: "💺",
    color: "#8B5CF6",
  },
];

interface TrainingSectionProps {
  colors: any;
}

export function TrainingSection({ colors }: TrainingSectionProps) {
  const router = useRouter();

  return (
    <View style={{ marginBottom: 24 }}>
      {/* Section Header */}
      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground, marginBottom: 4 }}>
          📚 Training Modules
        </Text>
        <Text style={{ fontSize: 13, color: colors.muted }}>
          Tap a module to start training
        </Text>
      </View>

      {/* Module Cards */}
      <View style={{ gap: 12 }}>
        {TRAINING_CARDS.map((card) => (
          <Pressable
            key={card.id}
            onPress={() => router.push("/training")}
            style={({ pressed }) => ({
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
          >
            <View
              style={{
                backgroundColor: card.color,
                borderRadius: 16,
                padding: 16,
                overflow: "hidden",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.15,
                shadowRadius: 8,
                elevation: 5,
              }}
            >
              {/* Decorative circle */}
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: -20,
                  right: -20,
                  width: 100,
                  height: 100,
                  borderRadius: 50,
                  backgroundColor: "rgba(255,255,255,0.1)",
                }}
              />

              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                {/* Icon */}
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 12,
                    backgroundColor: "rgba(255,255,255,0.2)",
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 2,
                    borderColor: "rgba(255,255,255,0.3)",
                  }}
                >
                  <Text style={{ fontSize: 28 }}>{card.emoji}</Text>
                </View>

                {/* Text */}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: "#FFFFFF", marginBottom: 4 }}>
                    {card.title}
                  </Text>
                  <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", lineHeight: 16 }} numberOfLines={1}>
                    {card.description}
                  </Text>
                </View>

                {/* Arrow */}
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: "rgba(255,255,255,0.2)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: 18, color: "#FFFFFF" }}>→</Text>
                </View>
              </View>
            </View>
          </Pressable>
        ))}
      </View>

      {/* View All Button */}
      <Pressable
        onPress={() => router.push("/training")}
        style={({ pressed }) => ({
          opacity: pressed ? 0.8 : 1,
          marginTop: 16,
        })}
      >
        <View
          style={{
            backgroundColor: colors.primary,
            borderRadius: 12,
            paddingVertical: 12,
            paddingHorizontal: 16,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: "700", color: "#FFFFFF" }}>
            View All Training Modules →
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
