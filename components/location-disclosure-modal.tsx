import { Modal, View, Text, TouchableOpacity, ScrollView } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const LOCATION_DISCLOSURE_ACCEPTED_KEY = "location_disclosure_accepted_v1";

export async function hasAcceptedLocationDisclosure(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(LOCATION_DISCLOSURE_ACCEPTED_KEY);
    return val === "true";
  } catch {
    return false;
  }
}

export async function markLocationDisclosureAccepted(): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCATION_DISCLOSURE_ACCEPTED_KEY, "true");
  } catch { /* non-fatal */ }
}

interface LocationDisclosureModalProps {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function LocationDisclosureModal({ visible, onAccept, onDecline }: LocationDisclosureModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: "#0a7ea4", justifyContent: "center", alignItems: "center", padding: 24 }}>
        {/* Icon */}
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(255,255,255,0.2)", justifyContent: "center", alignItems: "center", marginBottom: 24 }}>
          <Text style={{ fontSize: 40 }}>📍</Text>
        </View>

        {/* Headline */}
        <Text style={{ fontSize: 26, fontWeight: "800", color: "#FFFFFF", textAlign: "center", marginBottom: 8 }}>
          Location Access Required
        </Text>
        <Text style={{ fontSize: 15, color: "rgba(255,255,255,0.85)", textAlign: "center", marginBottom: 28, lineHeight: 22 }}>
          Luxury Wash On Wheels needs access to your location while you are clocked in.
        </Text>

        {/* Disclosure card */}
        <View style={{ backgroundColor: "#FFFFFF", borderRadius: 16, padding: 20, width: "100%", marginBottom: 28 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: "#11181C", marginBottom: 12 }}>
            How your location is used:
          </Text>

          <View style={{ gap: 10 }}>
            {[
              { icon: "🗺️", text: "Your real-time location is shared with dispatch so jobs can be assigned to the nearest available team member." },
              { icon: "⏱️", text: "Location is recorded when you clock in and clock out to verify your work site." },
              { icon: "📋", text: "Your position is updated every 2 minutes while clocked in to keep the fleet map current." },
              { icon: "🔒", text: "Location data is only visible to authorized Luxury Wash On Wheels managers and is never sold or shared with third parties." },
              { icon: "⛔", text: "Location tracking stops automatically when you clock out." },
            ].map((item, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                <Text style={{ fontSize: 18, marginTop: 1 }}>{item.icon}</Text>
                <Text style={{ flex: 1, fontSize: 13, color: "#374151", lineHeight: 19 }}>{item.text}</Text>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: "#E5E7EB" }}>
            <Text style={{ fontSize: 12, color: "#6B7280", lineHeight: 17 }}>
              By tapping <Text style={{ fontWeight: "700" }}>Allow & Clock In</Text>, you consent to location collection as described above. You can withdraw consent at any time by contacting your manager.
            </Text>
          </View>
        </View>

        {/* Buttons */}
        <TouchableOpacity
          onPress={onAccept}
          style={{ backgroundColor: "#FFFFFF", borderRadius: 12, paddingVertical: 16, paddingHorizontal: 32, width: "100%", alignItems: "center", marginBottom: 12 }}
        >
          <Text style={{ fontSize: 16, fontWeight: "700", color: "#0a7ea4" }}>
            Allow &amp; Clock In
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onDecline}
          style={{ paddingVertical: 12, paddingHorizontal: 32, width: "100%", alignItems: "center" }}
        >
          <Text style={{ fontSize: 14, fontWeight: "500", color: "rgba(255,255,255,0.75)" }}>
            Not Now
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}
