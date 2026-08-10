/**
 * Detailer - Door Hangers Tab
 * Simplified door hanger photo logger for detailers.
 * Pre-selected to "door_hangers" type — no item type selection needed.
 */
import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  Image,
  ActivityIndicator,
} from "react-native";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";

interface LoggedEntry {
  uri: string;
  latitude: number;
  longitude: number;
  address: string;
  savedAt: string;
}

export default function DetailerDoorHangersScreen() {
  const { employee } = useEmployeeAuth();
  const [loggedEntries, setLoggedEntries] = useState<LoggedEntry[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [locationPermission, requestLocationPermission] = Location.useForegroundPermissions();
  const cachedLocation = useRef<{ latitude: number; longitude: number; address: string; city: string } | null>(null);
  const isFetchingLocation = useRef(false);

  const createEntryMutation = trpc.doorHanger.createEntry.useMutation();
  const uploadPhotoMutation = trpc.doorHanger.uploadPhoto.useMutation();

  // Pre-fetch location on mount
  useEffect(() => {
    (async () => {
      let granted = locationPermission?.granted;
      if (!granted) {
        const result = await requestLocationPermission();
        granted = result.granted;
      }
      if (granted && !cachedLocation.current && !isFetchingLocation.current) {
        isFetchingLocation.current = true;
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const [geo] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
          const address = geo ? `${geo.streetNumber ?? ""} ${geo.street ?? ""}, ${geo.city ?? ""}`.trim() : "Unknown location";
          const city = geo?.city ?? geo?.subregion ?? "Unknown";
          cachedLocation.current = { latitude: loc.coords.latitude, longitude: loc.coords.longitude, address, city };
        } catch {
          // silent — will retry on photo tap
        } finally {
          isFetchingLocation.current = false;
        }
      }
    })();
  }, []);

  const getLocation = async () => {
    if (cachedLocation.current) return cachedLocation.current;
    if (isFetchingLocation.current) {
      await new Promise((r) => setTimeout(r, 1500));
      return cachedLocation.current;
    }
    isFetchingLocation.current = true;
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [geo] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      const address = geo ? `${geo.streetNumber ?? ""} ${geo.street ?? ""}, ${geo.city ?? ""}`.trim() : "Unknown location";
      const city = geo?.city ?? geo?.subregion ?? "Unknown";
      cachedLocation.current = { latitude: loc.coords.latitude, longitude: loc.coords.longitude, address, city };
      return cachedLocation.current;
    } catch {
      return null;
    } finally {
      isFetchingLocation.current = false;
    }
  };

  const handleTakePhoto = async () => {
    if (!employee) return;

    const camPerm = await ImagePicker.requestCameraPermissionsAsync();
    if (!camPerm.granted) {
      Alert.alert("Camera Permission", "Camera access is required to log door hangers.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (!asset.base64) {
      Alert.alert("Photo Error", "Could not read photo data. Please try again.");
      return;
    }

    setIsSaving(true);
    try {
      const location = await getLocation();
      if (!location) {
        Alert.alert("Location Required", "Could not get your location. Please enable location services and try again.");
        setIsSaving(false);
        return;
      }

      // Upload photo — schema: { base64, mimeType, employeeId }
      const uploadResult = await uploadPhotoMutation.mutateAsync({
        base64: asset.base64,
        mimeType: asset.mimeType ?? "image/jpeg",
        employeeId: employee.employeeId,
      });

      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

      // Save entry — schema: { employeeId, date, address, city, outreachType, quantityDistributed, notes?, photoUrls?, latitude?, longitude? }
      await createEntryMutation.mutateAsync({
        employeeId: employee.employeeId,
        date: today,
        address: location.address,
        city: location.city,
        outreachType: "door_hangers",
        quantityDistributed: 1,
        photoUrls: [uploadResult.url],
        latitude: location.latitude,
        longitude: location.longitude,
        notes: "",
      });

      setLoggedEntries((prev) => [
        {
          uri: asset.uri,
          latitude: location.latitude,
          longitude: location.longitude,
          address: location.address,
          savedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
        ...prev,
      ]);

      // Refresh cached location for next photo
      cachedLocation.current = null;
      getLocation();
    } catch (err: any) {
      Alert.alert("Save Failed", err?.message ?? "Could not save entry. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ScreenContainer containerClassName="bg-[#0A0A0A]" safeAreaClassName="bg-[#0A0A0A]">
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#1E3A5F" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ fontSize: 26, fontWeight: "900", color: "#fff" }}>🚪 Door Hangers</Text>
        </View>
        <Text style={{ color: "#6B7280", fontSize: 13, marginTop: 2 }}>
          {loggedEntries.length} logged today
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
        {/* Take Photo Button */}
        <TouchableOpacity
          onPress={handleTakePhoto}
          disabled={isSaving}
          style={{
            backgroundColor: isSaving ? "#1E3A5F" : "#0057FF",
            borderRadius: 14,
            paddingVertical: 18,
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "center",
            gap: 10,
            opacity: isSaving ? 0.7 : 1,
          }}
        >
          {isSaving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={{ fontSize: 20 }}>📸</Text>
          )}
          <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>
            {isSaving ? "Saving…" : "Take Photo"}
          </Text>
        </TouchableOpacity>

        {/* Entries List */}
        {loggedEntries.length === 0 ? (
          <View style={{ alignItems: "center", paddingTop: 48 }}>
            <Text style={{ color: "#4B5563", fontSize: 15, textAlign: "center" }}>
              No entries yet.{"\n"}Tap the button above to take a photo.
            </Text>
          </View>
        ) : (
          loggedEntries.map((entry, idx) => (
            <View
              key={idx}
              style={{
                backgroundColor: "#111827",
                borderRadius: 12,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: "#1E3A5F",
              }}
            >
              <Image
                source={{ uri: entry.uri }}
                style={{ width: "100%", height: 180, resizeMode: "cover" }}
              />
              <View style={{ padding: 12, gap: 4 }}>
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>
                  📍 {entry.address}
                </Text>
                <Text style={{ color: "#6B7280", fontSize: 12 }}>
                  Logged at {entry.savedAt}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
