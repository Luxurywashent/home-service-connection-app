import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  Image,
  ActivityIndicator,
  Linking,
  Platform,
} from "react-native";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";

type ItemType = "door_hangers" | "business_cards" | "yard_signs" | "table_toppers";

interface LoggedEntry {
  uri: string;
  latitude: number;
  longitude: number;
  address: string;
  itemType: ItemType;
  savedAt: string;
}

const ITEM_TYPES: { type: ItemType; label: string; emoji: string }[] = [
  { type: "door_hangers", label: "Door Hangers", emoji: "🚪" },
  { type: "business_cards", label: "Business Cards", emoji: "💼" },
  { type: "yard_signs", label: "Yard Signs", emoji: "🏷️" },
  { type: "table_toppers", label: "Table Toppers", emoji: "📋" },
];

export default function PhotoLogger() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const [selectedItemType, setSelectedItemType] = useState<ItemType | null>(null);
  const [loggedEntries, setLoggedEntries] = useState<LoggedEntry[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [locationPermission, requestLocationPermission] = Location.useForegroundPermissions();
  const cachedLocation = useRef<{ latitude: number; longitude: number; address: string } | null>(null);
  const isFetchingLocation = useRef(false);

  const createEntryMutation = trpc.doorHanger.createEntry.useMutation();
  const uploadPhotoMutation = trpc.doorHanger.uploadPhoto.useMutation();

  // On mount: request permissions and pre-fetch location
  useEffect(() => {
    (async () => {
      let granted = locationPermission?.granted;
      if (!granted) {
        const result = await requestLocationPermission();
        granted = result.granted;
        if (!granted && !result.canAskAgain) {
          Alert.alert(
            "Location Access Required",
            "Please enable location access in Settings so your entries can be geo-tagged.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Open Settings",
                onPress: () => {
                  if (Platform.OS === "ios") {
                    Linking.openURL("app-settings:");
                  } else {
                    Linking.openSettings();
                  }
                },
              },
            ]
          );
        }
      }
      if (granted) {
        prefetchLocation();
      }
    })();
  }, []);

  const prefetchLocation = async () => {
    if (isFetchingLocation.current) return;
    isFetchingLocation.current = true;
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = loc.coords;
      let address = "Unknown location";
      try {
        const geo = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (geo.length > 0) {
          const { streetNumber, street, city, region, postalCode } = geo[0];
          address = [streetNumber, street, city, region, postalCode].filter(Boolean).join(" ");
        }
      } catch {}
      cachedLocation.current = { latitude, longitude, address };
    } catch (err) {
      console.warn("Location prefetch failed:", err);
    } finally {
      isFetchingLocation.current = false;
    }
  };

  const getLocation = async (): Promise<{ latitude: number; longitude: number; address: string }> => {
    if (cachedLocation.current) {
      const loc = cachedLocation.current;
      prefetchLocation();
      return loc;
    }
    try {
      const loc = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      if (loc && (loc as any).coords) {
        const { latitude, longitude } = (loc as any).coords;
        let address = "Unknown location";
        try {
          const geo = await Promise.race([
            Location.reverseGeocodeAsync({ latitude, longitude }),
            new Promise<[]>((resolve) => setTimeout(() => resolve([]), 4000)),
          ]);
          if ((geo as any).length > 0) {
            const { streetNumber, street, city, region, postalCode } = (geo as any)[0];
            address = [streetNumber, street, city, region, postalCode].filter(Boolean).join(" ");
          }
        } catch {}
        return { latitude, longitude, address };
      }
    } catch (err) {
      console.warn("Location error:", err);
    }
    return { latitude: 0, longitude: 0, address: "Location unavailable" };
  };

  const saveEntry = async (uri: string, itemType: ItemType) => {
    if (!employee?.employeeId) {
      Alert.alert("Not Logged In", "Please log in to log entries.");
      return;
    }

    setIsSaving(true);
    const safetyTimer = setTimeout(() => setIsSaving(false), 20000);
    try {
      const locationData = await getLocation();
      const today = new Date().toISOString().split("T")[0];

      // Upload photo to S3 so it's accessible from any device
      let publicPhotoUrl = uri;
      try {
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const uploadResult = await uploadPhotoMutation.mutateAsync({
          base64,
          mimeType: "image/jpeg",
          employeeId: employee.employeeId,
        });
        publicPhotoUrl = uploadResult.url;
      } catch (uploadErr) {
        console.warn("Photo upload to S3 failed, saving local URI as fallback:", uploadErr);
      }

      await Promise.race([
        createEntryMutation.mutateAsync({
          employeeId: employee.employeeId,
          date: today,
          address: locationData.address,
          city: employee.city || "Unknown",
          outreachType: itemType,
          quantityDistributed: 1,
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          photoUrls: [publicPhotoUrl],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Save timed out — check your connection")), 15000)
        ),
      ]);

      const entry: LoggedEntry = {
        uri,
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        address: locationData.address,
        itemType,
        savedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setLoggedEntries((prev) => [entry, ...prev]);
    } catch (err: any) {
      console.error("Save error:", err);
      Alert.alert("Save Failed", err?.message || "Could not save entry. Please try again.");
    } finally {
      clearTimeout(safetyTimer);
      setIsSaving(false);
    }
  };

  const handleTakePhoto = async () => {
    if (!selectedItemType) return;

    // Request camera permission
    const cameraPermResult = await ImagePicker.requestCameraPermissionsAsync();
    if (!cameraPermResult.granted) {
      Alert.alert(
        "Camera Permission Required",
        "Please allow camera access in your phone's Settings to take photos.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open Settings",
            onPress: () => {
              if (Platform.OS === "ios") {
                Linking.openURL("app-settings:");
              } else {
                Linking.openSettings();
              }
            },
          },
        ]
      );
      return;
    }

    // Request media library permission (needed to save photos on iOS)
    const mediaPermResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!mediaPermResult.granted) {
      Alert.alert(
        "Photos Permission Required",
        "Please allow access to Photos in your phone's Settings so photos can be saved.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open Settings",
            onPress: () => {
              if (Platform.OS === "ios") {
                Linking.openURL("app-settings:");
              } else {
                Linking.openSettings();
              }
            },
          },
        ]
      );
      return;
    }

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsEditing: false,
      });

      if (!result.canceled && result.assets.length > 0) {
        const uri = result.assets[0].uri;
        await saveEntry(uri, selectedItemType);
      }
    } catch (err) {
      console.error("Camera error:", err);
      Alert.alert("Camera Error", "Could not open camera. Please try again.");
    }
  };

  const getLabel = (type: ItemType) => ITEM_TYPES.find((t) => t.type === type)?.label ?? type;

  // ── Item Type Selector ──
  if (selectedItemType === null) {
    return (
      <ScreenContainer edges={["left", "right"]} className="p-5">
        <Text style={{ fontSize: 24, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>
          Log Items
        </Text>
        <Text style={{ color: colors.muted, marginBottom: 24, fontSize: 14 }}>
          Select item type to start logging.
        </Text>

        <View style={{ gap: 12 }}>
          {ITEM_TYPES.map((item) => (
            <TouchableOpacity
              key={item.type}
              onPress={() => setSelectedItemType(item.type)}
              style={{
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 14,
                padding: 18,
                flexDirection: "row",
                alignItems: "center",
                gap: 14,
              }}
            >
              <Text style={{ fontSize: 30 }}>{item.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 16 }}>
                  {item.label}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>
                  Tap to select
                </Text>
              </View>
              <Text style={{ color: colors.primary, fontSize: 20 }}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScreenContainer>
    );
  }

  // ── Logging Screen ──
  return (
    <ScreenContainer edges={["left", "right"]} className="flex-1">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <View>
            <Text style={{ fontSize: 22, fontWeight: "700", color: colors.foreground }}>
              {ITEM_TYPES.find((t) => t.type === selectedItemType)?.emoji}{" "}
              {getLabel(selectedItemType)}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>
              {loggedEntries.length} logged today
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => { setSelectedItemType(null); setLoggedEntries([]); }}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 10,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ color: colors.muted, fontWeight: "600" }}>← Back</Text>
          </TouchableOpacity>
        </View>

        {/* Saving indicator */}
        {isSaving && (
          <View style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: colors.surface,
            borderRadius: 10,
            padding: 14,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: colors.primary,
          }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ color: colors.primary, fontWeight: "600" }}>
              Saving entry with location...
            </Text>
          </View>
        )}

        {/* Take Photo button */}
        <TouchableOpacity
          onPress={handleTakePhoto}
          disabled={isSaving}
          style={{
            backgroundColor: colors.primary,
            borderRadius: 14,
            padding: 18,
            alignItems: "center",
            marginBottom: 16,
            opacity: isSaving ? 0.6 : 1,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
            📷 {loggedEntries.length > 0 ? "Take Another Photo" : "Take Photo"}
          </Text>
        </TouchableOpacity>

        {/* Back to Items button */}
        <TouchableOpacity
          onPress={() => { setSelectedItemType(null); setLoggedEntries([]); }}
          disabled={isSaving}
          style={{
            backgroundColor: colors.surface,
            borderRadius: 14,
            padding: 14,
            alignItems: "center",
            marginBottom: 24,
            borderWidth: 1,
            borderColor: colors.border,
            opacity: isSaving ? 0.6 : 1,
          }}
        >
          <Text style={{ color: colors.muted, fontWeight: "600", fontSize: 14 }}>
            ← Back to Items
          </Text>
        </TouchableOpacity>

        {/* Logged entries list */}
        {loggedEntries.length > 0 && (
          <>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginBottom: 12 }}>
              ✅ Logged This Session
            </Text>
            {loggedEntries.map((entry, index) => (
              <View
                key={index}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: 12,
                  marginBottom: 12,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                {entry.uri ? (
                  <Image
                    source={{ uri: entry.uri }}
                    style={{ width: "100%", height: 180 }}
                    resizeMode="cover"
                    onError={() => console.log("Image failed to load:", entry.uri)}
                  />
                ) : (
                  <View style={{ width: "100%", height: 180, backgroundColor: colors.border, justifyContent: "center", alignItems: "center" }}>
                    <Text style={{ color: colors.muted }}>📷 Photo saved</Text>
                  </View>
                )}
                <View style={{ padding: 12 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontWeight: "600", color: colors.foreground, fontSize: 14 }}>
                      {getLabel(entry.itemType)}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{entry.savedAt}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }} numberOfLines={2}>
                    📍 {entry.latitude !== 0 ? entry.address : "Location unavailable"}
                  </Text>
                  {entry.latitude !== 0 && (
                    <Text style={{ color: colors.success, fontSize: 11, marginTop: 2 }}>
                      ✓ GPS: {entry.latitude.toFixed(5)}, {entry.longitude.toFixed(5)}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </>
        )}

        {/* Empty state */}
        {loggedEntries.length === 0 && !isSaving && (
          <View style={{ alignItems: "center", paddingVertical: 32 }}>
            <Text style={{ color: colors.muted, fontSize: 15, textAlign: "center" }}>
              No entries yet.{"\n"}Tap the button above to take a photo.
            </Text>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
