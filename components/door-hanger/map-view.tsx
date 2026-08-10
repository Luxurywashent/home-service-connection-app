import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  ScrollView,
  Platform,
  Modal,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";

type OutreachType = "door_hangers" | "business_cards" | "yard_signs" | "table_toppers";

interface EntryLocation {
  id: string;
  entryId: string;
  latitude: number;
  longitude: number;
  address: string;
  outreachType: OutreachType;
  photoUrls: string[];
  employeeName: string;
  createdAt: string;
}

const TYPE_CONFIG: Record<OutreachType, { label: string; color: string; emoji: string }> = {
  door_hangers: { label: "Door Hanger", color: "#2563EB", emoji: "🚪" },
  business_cards: { label: "Business Card", color: "#16A34A", emoji: "💼" },
  yard_signs: { label: "Yard Sign", color: "#EA580C", emoji: "🏷️" },
  table_toppers: { label: "Table Topper", color: "#9333EA", emoji: "📋" },
};

const ALL_TYPES: OutreachType[] = ["door_hangers", "business_cards", "yard_signs", "table_toppers"];

// Stable empty array so tRPC default doesn't create a new reference each render
const EMPTY_ENTRIES: any[] = [];

// Default to Dallas, TX if no entries
const DEFAULT_REGION = {
  latitude: 32.7767,
  longitude: -96.797,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

export default function DoorHangerMapView() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const employeeId = employee?.employeeId ?? "";
  const employeeName = employee?.fullName ?? "Team Member";

  const mapRef = useRef<MapView>(null);
  const [entries, setEntries] = useState<EntryLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<EntryLocation | null>(null);
  const [userRegion, setUserRegion] = useState(DEFAULT_REGION);
  const hasFittedRef = useRef(false);

  // Filter state — all types active by default
  const [activeFilters, setActiveFilters] = useState<Set<OutreachType>>(new Set(ALL_TYPES));
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);

  // Use stable empty array to avoid render loop from default value
  const { data: rawEntries, refetch, isRefetching } = trpc.doorHanger.getEntries.useQuery(
    { employeeId },
    { enabled: !!employeeId },
  );
  const doorHangerEntries = rawEntries ?? EMPTY_ENTRIES;

  // Get user location for default map center (only used when no entries exist)
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setUserRegion({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          });
        }
      } catch {}
    })();
  }, []);

  // Map raw entries to EntryLocation — only re-runs when doorHangerEntries reference changes
  useEffect(() => {
    const mapped = doorHangerEntries
      .filter((e: any) => e.latitude && e.longitude)
      .map((e: any) => {
        let photoUrls: string[] = [];
        if (e.photoUrls) {
          try { photoUrls = JSON.parse(e.photoUrls); } catch {}
        }
        return {
          id: String(e.id),
          entryId: e.entryId,
          latitude: Number(e.latitude),
          longitude: Number(e.longitude),
          address: e.address || "Unknown location",
          outreachType: (e.outreachType as OutreachType) || "door_hangers",
          photoUrls,
          employeeName,
          createdAt: e.createdAt,
        } as EntryLocation;
      });
    setEntries(mapped);
    setIsLoading(false);
    if (mapped.length > 0 && !hasFittedRef.current) {
      hasFittedRef.current = true;
      setTimeout(() => fitToPins(mapped), 600);
    }
  // employeeName is a primitive string — safe dependency
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doorHangerEntries, employeeName]);

  const visibleEntries = useMemo(
    () => entries.filter((e) => activeFilters.has(e.outreachType)),
    [entries, activeFilters],
  );

  const toggleFilter = (type: OutreachType) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size === 1) return prev; // keep at least one
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const fitToPins = (pinEntries: EntryLocation[] = entries) => {
    if (pinEntries.length === 0 || !mapRef.current) return;
    const coords = pinEntries.map((e) => ({ latitude: e.latitude, longitude: e.longitude }));
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 140, right: 80, bottom: 160, left: 80 },
      animated: true,
    });
  };

  const getMapRegion = () => {
    if (entries.length === 0) return userRegion;
    if (entries.length === 1) {
      return {
        latitude: entries[0].latitude,
        longitude: entries[0].longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      };
    }
    const lats = entries.map((e) => e.latitude);
    const lngs = entries.map((e) => e.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.02),
      longitudeDelta: Math.max((maxLng - minLng) * 1.4, 0.02),
    };
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return dateStr;
    }
  };

  // Summary label for the filter button
  const filterLabel = useMemo(() => {
    if (activeFilters.size === ALL_TYPES.length) return "All Types";
    if (activeFilters.size === 1) {
      const type = [...activeFilters][0];
      return TYPE_CONFIG[type].label;
    }
    return `${activeFilters.size} Types`;
  }, [activeFilters]);

  if (isLoading) {
    return (
      <ScreenContainer edges={["left", "right"]} className="justify-center items-center">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.muted, marginTop: 12 }}>Loading map...</Text>
      </ScreenContainer>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Map takes full screen */}
      <MapView
        ref={mapRef}
        provider={Platform.OS !== "web" ? PROVIDER_GOOGLE : undefined}
        style={{ flex: 1 }}
        initialRegion={getMapRegion()}
        showsUserLocation
        showsMyLocationButton
        onPress={() => setSelectedEntry(null)}
      >
        {visibleEntries.map((entry) => {
          const config = TYPE_CONFIG[entry.outreachType] || TYPE_CONFIG.door_hangers;
          return (
            <Marker
              key={entry.id}
              coordinate={{ latitude: entry.latitude, longitude: entry.longitude }}
              pinColor={config.color}
              onPress={(e) => {
                e.stopPropagation?.();
                setSelectedEntry(entry);
              }}
            />
          );
        })}
      </MapView>

      {/* Header overlay */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          backgroundColor: "rgba(0,0,0,0.55)",
          paddingTop: 52,
          paddingHorizontal: 16,
          paddingBottom: 12,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>
          Team Map
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, marginTop: 2 }}>
          {visibleEntries.length} of {entries.length} {entries.length === 1 ? "entry" : "entries"} shown
        </Text>
      </View>

      {/* Left overlay buttons */}
      <View style={{ position: "absolute", top: 108, left: 12, gap: 8 }}>
        {/* Refresh button */}
        <TouchableOpacity
          onPress={async () => {
            hasFittedRef.current = false;
            await refetch();
          }}
          style={{
            backgroundColor: "rgba(255,255,255,0.93)",
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          {isRefetching ? (
            <ActivityIndicator size="small" color="#333" />
          ) : (
            <Text style={{ fontSize: 13, color: "#333", fontWeight: "600" }}>🔄 Refresh</Text>
          )}
        </TouchableOpacity>

        {/* Fit all pins button */}
        {entries.length > 0 && (
          <TouchableOpacity
            onPress={() => fitToPins(visibleEntries)}
            style={{
              backgroundColor: "rgba(255,255,255,0.93)",
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Text style={{ fontSize: 13, color: "#333", fontWeight: "600" }}>📍 Fit Pins</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter dropdown button — top right */}
      <TouchableOpacity
        onPress={() => setFilterDropdownOpen(true)}
        style={{
          position: "absolute",
          top: 108,
          right: 12,
          backgroundColor: "rgba(255,255,255,0.95)",
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.12,
          shadowRadius: 4,
          elevation: 4,
        }}
      >
        <Text style={{ fontSize: 13, color: "#333", fontWeight: "600" }}>🔽 {filterLabel}</Text>
      </TouchableOpacity>

      {/* Filter dropdown modal */}
      <Modal
        visible={filterDropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterDropdownOpen(false)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }}
          activeOpacity={1}
          onPress={() => setFilterDropdownOpen(false)}
        >
          <View
            style={{
              position: "absolute",
              top: 160,
              right: 12,
              backgroundColor: "#fff",
              borderRadius: 14,
              paddingVertical: 8,
              minWidth: 200,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.18,
              shadowRadius: 10,
              elevation: 8,
            }}
          >
            {/* Header row */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#333" }}>Filter by Type</Text>
              <TouchableOpacity onPress={() => setActiveFilters(new Set(ALL_TYPES))}>
                <Text style={{ fontSize: 12, color: "#2563EB", fontWeight: "600" }}>All</Text>
              </TouchableOpacity>
            </View>

            {/* Type rows */}
            {(Object.entries(TYPE_CONFIG) as [OutreachType, typeof TYPE_CONFIG[OutreachType]][]).map(([type, cfg]) => {
              const isActive = activeFilters.has(type);
              const count = entries.filter((e) => e.outreachType === type).length;
              return (
                <TouchableOpacity
                  key={type}
                  onPress={() => toggleFilter(type)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 14,
                    paddingVertical: 11,
                    gap: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: "#f5f5f5",
                  }}
                >
                  {/* Checkbox */}
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 5,
                      borderWidth: 2,
                      borderColor: isActive ? cfg.color : "#ccc",
                      backgroundColor: isActive ? cfg.color : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {isActive && <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>✓</Text>}
                  </View>

                  {/* Color dot + label */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: cfg.color }} />
                    <Text style={{ fontSize: 14, color: "#222", fontWeight: isActive ? "600" : "400" }}>{cfg.label}</Text>
                  </View>

                  {/* Count badge */}
                  <View style={{ backgroundColor: count > 0 ? `${cfg.color}20` : "#f0f0f0", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 12, color: count > 0 ? cfg.color : "#aaa", fontWeight: "700" }}>{count}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* Done button */}
            <TouchableOpacity
              onPress={() => setFilterDropdownOpen(false)}
              style={{
                marginHorizontal: 14,
                marginTop: 8,
                marginBottom: 8,
                backgroundColor: "#2563EB",
                borderRadius: 10,
                paddingVertical: 10,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Empty state overlay */}
      {entries.length === 0 && (
        <View
          style={{
            position: "absolute",
            bottom: 120,
            left: 24,
            right: 24,
            backgroundColor: "rgba(255,255,255,0.95)",
            borderRadius: 14,
            padding: 20,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "600", color: "#333", marginBottom: 6 }}>
            No entries on map yet
          </Text>
          <Text style={{ fontSize: 13, color: "#666", textAlign: "center" }}>
            Log items with the camera to see them appear as pins here.
          </Text>
        </View>
      )}

      {/* Bottom sheet for selected entry */}
      {selectedEntry && (
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: colors.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: -3 },
            shadowOpacity: 0.15,
            shadowRadius: 8,
            elevation: 8,
            maxHeight: 420,
          }}
        >
          {/* Drag handle */}
          <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
            {/* Header row */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <View
                    style={{
                      backgroundColor: TYPE_CONFIG[selectedEntry.outreachType]?.color || "#2563EB",
                      borderRadius: 6,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
                      {TYPE_CONFIG[selectedEntry.outreachType]?.emoji}{" "}
                      {TYPE_CONFIG[selectedEntry.outreachType]?.label}
                    </Text>
                  </View>
                </View>
                <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "600" }} numberOfLines={2}>
                  📍 {selectedEntry.address}
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 3 }}>
                  {selectedEntry.employeeName} · {formatDate(selectedEntry.createdAt)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setSelectedEntry(null)}
                style={{
                  marginLeft: 12,
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: colors.border,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700" }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Photo thumbnail */}
            {selectedEntry.photoUrls.length > 0 && (
              <Image
                source={{ uri: selectedEntry.photoUrls[0] }}
                style={{
                  width: "100%",
                  height: 180,
                  borderRadius: 12,
                  backgroundColor: colors.border,
                }}
                resizeMode="cover"
              />
            )}

            {selectedEntry.photoUrls.length === 0 && (
              <View
                style={{
                  width: "100%",
                  height: 80,
                  borderRadius: 12,
                  backgroundColor: colors.border,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: colors.muted, fontSize: 13 }}>No photo available</Text>
              </View>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
