import { View, Text, ScrollView, Pressable, Image, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const CATEGORY_LABELS: Record<string, string> = {
  tool: "🔧 Tools",
  chemical: "🧴 Chemicals",
  towel: "🧤 Towels & Pads",
};

const CATEGORY_ORDER = ["tool", "chemical", "towel"];

interface ModuleToolsScreenProps {
  moduleKey: string;
  moduleName: string;
  onContinue: () => void;
  onExit: () => void;
}

export function ModuleToolsScreen({ moduleKey, moduleName, onContinue, onExit }: ModuleToolsScreenProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const toolsQuery = trpc.training.getModuleTools.useQuery({ moduleKey }, { staleTime: 5 * 60 * 1000 });
  const tools: any[] = (toolsQuery.data || []) as any[];

  const grouped = CATEGORY_ORDER.reduce<Record<string, any[]>>((acc, cat) => {
    const items = tools.filter(t => t.category === cat);
    if (items.length > 0) acc[cat] = items;
    return acc;
  }, {});

  const hasTools = tools.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingTop: Math.max(insets.top, 12),
        paddingBottom: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: colors.border,
      }}>
        <Pressable
          onPress={onExit}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8, marginRight: 8 })}
        >
          <Text style={{ fontSize: 22, color: colors.primary }}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>{moduleName}</Text>
          <Text style={{ fontSize: 11, color: colors.muted }}>Step 1 of 3 — Tools & Products</Text>
        </View>
        {/* Progress pill */}
        <View style={{ backgroundColor: colors.primary + "20", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 }}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: colors.primary }}>📋 Prep</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={{ height: 3, backgroundColor: colors.border }}>
        <View style={{ height: 3, width: "33%", backgroundColor: colors.primary }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Title */}
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground, marginBottom: 4 }}>
          Tools & Products
        </Text>
        <Text style={{ fontSize: 14, color: colors.muted, marginBottom: 24, lineHeight: 20 }}>
          Review the tools, chemicals, and towels you'll need before starting this module.
        </Text>

        {toolsQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 40 }} />
        ) : !hasTools ? (
          <View style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 24,
            alignItems: "center",
            marginBottom: 24,
          }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🔧</Text>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>No tools listed yet</Text>
            <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center" }}>
              An admin can add tools, chemicals, and towels for this module from the Training Admin screen.
            </Text>
          </View>
        ) : (
          Object.entries(grouped).map(([category, items]) => (
            <View key={category} style={{ marginBottom: 28 }}>
              {/* Category header */}
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
                {CATEGORY_LABELS[category] || category}
              </Text>
              {/* 2-column grid */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {items.map((tool: any) => (
                  <View
                    key={tool.id}
                    style={{
                      width: "47%",
                      backgroundColor: colors.surface,
                      borderRadius: 14,
                      overflow: "hidden",
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    {tool.photoUrl ? (
                      <Image
                        source={{ uri: tool.photoUrl }}
                        style={{ width: "100%", height: 110, resizeMode: "cover" }}
                      />
                    ) : (
                      <View style={{ width: "100%", height: 110, backgroundColor: colors.border + "60", alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ fontSize: 36 }}>
                          {category === "chemical" ? "🧴" : category === "towel" ? "🧤" : "🔧"}
                        </Text>
                      </View>
                    )}
                    <View style={{ padding: 10 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground, lineHeight: 18 }} numberOfLines={2}>
                        {tool.name}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ))
        )}

        {/* Continue button */}
        <Pressable
          onPress={() => {
            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onContinue();
          }}
          style={({ pressed }) => ({
            backgroundColor: colors.primary,
            borderRadius: 14,
            paddingVertical: 16,
            alignItems: "center",
            marginTop: 8,
            opacity: pressed ? 0.85 : 1,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
            I'm Ready — Start Training →
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
