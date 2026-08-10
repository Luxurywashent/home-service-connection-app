import { useState, useEffect } from "react";
import {
  ScrollView,
  Text,
  View,
  FlatList,
  ActivityIndicator,
  Image,
  TouchableOpacity,
  Modal,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";

type OutreachType = "door_hangers" | "business_cards" | "yard_signs" | "table_toppers";

const TYPE_CONFIG: Record<OutreachType, { label: string; emoji: string; color: string }> = {
  door_hangers: { label: "Door Hanger", emoji: "🚪", color: "#2563EB" },
  business_cards: { label: "Business Card", emoji: "💼", color: "#16A34A" },
  yard_signs: { label: "Yard Sign", emoji: "🏷", color: "#EA580C" },
  table_toppers: { label: "Table Topper", emoji: "📋", color: "#9333EA" },
};

// Safely convert any value to a display date string
function safeDate(val: unknown): string {
  try {
    if (!val) return "Unknown date";
    const d = val instanceof Date ? val : new Date(String(val));
    if (isNaN(d.getTime())) return "Unknown date";
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Unknown date";
  }
}

// Safely parse photo URL array from a JSON string or array
function parsePhotos(raw: unknown): string[] {
  try {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x: unknown) => typeof x === "string") : [];
    }
    return [];
  } catch {
    return [];
  }
}

// Pre-compute all display strings for a row — nothing raw touches JSX
interface RowViewModel {
  key: string;
  typeLabel: string;
  typeEmoji: string;
  typeColor: string;
  dateText: string;
  addressText: string;
  hasGps: boolean;
  photos: string[];
}

function buildViewModel(item: Record<string, unknown>): RowViewModel {
  const outreachType = String(item.outreachType ?? "door_hangers") as OutreachType;
  const cfg = TYPE_CONFIG[outreachType] ?? TYPE_CONFIG.door_hangers;
  const rawDate = item.createdAt ?? item.date ?? null;
  const rawAddr = item.address;
  const lat = typeof item.latitude === "number" ? item.latitude : null;

  return {
    key: String(item.entryId ?? item.id ?? Math.random()),
    typeLabel: cfg.label,
    typeEmoji: cfg.emoji,
    typeColor: cfg.color,
    dateText: safeDate(rawDate),
    addressText: rawAddr && String(rawAddr).trim() ? String(rawAddr) : "Location unavailable",
    hasGps: lat !== null && lat !== 0,
    photos: parsePhotos(item.photoUrls),
  };
}

export default function DoorHangerHistoryScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const [entries, setEntries] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fullscreenPhoto, setFullscreenPhoto] = useState<string | null>(null);

  const { data, isLoading: queryLoading, refetch, isRefetching } = trpc.doorHanger.getEntries.useQuery(
    { employeeId: employee?.employeeId ?? "" },
    { enabled: !!employee?.employeeId }
  );

  useEffect(() => {
    if (data !== undefined || !queryLoading) {
      setEntries(Array.isArray(data) ? (data as Record<string, unknown>[]) : []);
      setIsLoading(false);
    }
  }, [data, queryLoading]);

  // Totals by type
  const totals: Record<string, number> = {};
  for (const entry of entries) {
    const t = String(entry.outreachType ?? "door_hangers");
    const q = typeof entry.quantityDistributed === "number" ? entry.quantityDistributed : 1;
    totals[t] = (totals[t] ?? 0) + q;
  }

  if (isLoading) {
    return (
      <ScreenContainer edges={["left", "right"]} className="items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["left", "right"]} className="flex-1">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <Text style={{ fontSize: 26, fontWeight: "700", color: colors.foreground }}>
            Your History
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              backgroundColor: colors.surface,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            {isRefetching ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600" }}>Refresh</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Totals Summary */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 14,
            padding: 16,
            marginBottom: 20,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 12 }}>
            TOTAL LOGGED
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {(Object.entries(TYPE_CONFIG) as [OutreachType, (typeof TYPE_CONFIG)[OutreachType]][]).map(([type, cfg]) => (
              <View
                key={type}
                style={{
                  flex: 1,
                  minWidth: "45%",
                  backgroundColor: colors.background,
                  borderRadius: 10,
                  padding: 12,
                  borderLeftWidth: 3,
                  borderLeftColor: cfg.color,
                }}
              >
                <Text style={{ fontSize: 13, color: colors.muted }}>
                  {cfg.emoji + " " + cfg.label}
                </Text>
                <Text style={{ fontSize: 22, fontWeight: "700", color: cfg.color, marginTop: 2 }}>
                  {String(totals[type] ?? 0)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Entries List */}
        <Text style={{ fontSize: 17, fontWeight: "600", color: colors.foreground, marginBottom: 12 }}>
          Recent Entries
        </Text>

        {entries.length === 0 ? (
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 14,
              padding: 24,
              alignItems: "center",
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ color: colors.muted, textAlign: "center", fontSize: 15 }}>
              {"No entries yet.\nStart logging items with the camera."}
            </Text>
          </View>
        ) : (
          <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
            scrollEnabled={false}
            data={entries}
            keyExtractor={(item) => String(item.entryId ?? item.id ?? Math.random())}
            renderItem={({ item }) => {
              // Pre-compute ALL display values — nothing raw touches JSX
              const vm = buildViewModel(item);
              return (
                <View
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: 14,
                    marginBottom: 12,
                    overflow: "hidden",
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  {/* Photo thumbnail */}
                  {vm.photos.length > 0 ? (
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => setFullscreenPhoto(vm.photos[0])}
                    >
                      <Image
                        source={{ uri: vm.photos[0] }}
                        style={{ width: "100%", height: 160 }}
                        resizeMode="cover"
                      />
                      {vm.photos.length > 1 && (
                        <View
                          style={{
                            position: "absolute",
                            bottom: 8,
                            right: 8,
                            backgroundColor: "rgba(0,0,0,0.6)",
                            borderRadius: 8,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                          }}
                        >
                          <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>
                            {"+" + String(vm.photos.length - 1) + " more"}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <View
                      style={{
                        width: "100%",
                        height: 60,
                        backgroundColor: colors.border,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ color: colors.muted, fontSize: 12 }}>No photo</Text>
                    </View>
                  )}

                  {/* Entry details */}
                  <View style={{ padding: 12 }}>
                    {/* Type badge + date */}
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <View
                        style={{
                          backgroundColor: vm.typeColor,
                          borderRadius: 6,
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                        }}
                      >
                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
                          {vm.typeEmoji + " " + vm.typeLabel}
                        </Text>
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>
                        {vm.dateText}
                      </Text>
                    </View>

                    {/* Address */}
                    <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "500" }} numberOfLines={2}>
                      {"📍 " + vm.addressText}
                    </Text>

                    {/* GPS indicator */}
                    {vm.hasGps && (
                      <Text style={{ color: colors.success, fontSize: 11, marginTop: 4 }}>
                        {"✓ GPS tagged"}
                      </Text>
                    )}
                  </View>
                </View>
              );
            }}
          />
        )}
      </ScrollView>

      {/* Fullscreen photo modal */}
      <Modal visible={!!fullscreenPhoto} transparent animationType="fade">
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center", alignItems: "center" }}
          activeOpacity={1}
          onPress={() => setFullscreenPhoto(null)}
        >
          {fullscreenPhoto ? (
            <Image
              source={{ uri: fullscreenPhoto }}
              style={{ width: "95%", height: "75%", borderRadius: 12 }}
              resizeMode="contain"
            />
          ) : null}
          <Text style={{ color: "rgba(255,255,255,0.6)", marginTop: 16, fontSize: 14 }}>
            Tap anywhere to close
          </Text>
        </TouchableOpacity>
      </Modal>
    </ScreenContainer>
  );
}
