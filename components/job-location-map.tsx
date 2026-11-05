import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Text, TouchableOpacity, View } from "react-native";
import Constants from "expo-constants";
import { createJobStreetViewHtml, type StreetViewStatus } from "@/lib/job-street-view";
import { StreetViewRenderer } from "./street-view-renderer";

export type JobLocationMapProps = {
  address: string;
  height?: number;
};

/** Google resolves the complete job address and supplies the street-level panorama. */
export function JobLocationMap({ address, height = 320 }: JobLocationMapProps) {
  const normalizedAddress = address.trim();
  const apiKey = (Constants.expoConfig?.extra?.googleMapsApiKey as string) || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";
  // Remount address-specific state when the selected job/config changes.
  return <JobStreetView key={`${normalizedAddress}:${apiKey}`} address={normalizedAddress} apiKey={apiKey} height={height} />;
}

function JobStreetView({ address, apiKey, height }: { address: string; apiKey: string; height: number }) {
  const [status, setStatus] = useState<StreetViewStatus>(address && apiKey ? "loading" : "error");
  const [attempt, setAttempt] = useState(0);
  const html = useMemo(() => createJobStreetViewHtml(address, apiKey), [address, apiKey]);
  const receiveStatus = useCallback((next: StreetViewStatus) => setStatus(next), []);
  const openInGoogleMaps = () => {
    void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`);
  };
  const retry = () => {
    setStatus("loading");
    setAttempt((previous) => previous + 1);
  };
  return (
    <View style={{ height, position: "relative", backgroundColor: "#0C1B32" }}>
      {address && apiKey ? <StreetViewRenderer key={attempt} html={html} onStatus={receiveStatus} /> : null}
      {status === "loading" || status === "error" ? (
        <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: "#0C1B32" }}>
          {status === "loading" ? (
            <>
              <ActivityIndicator size="large" color="#60A5FA" />
              <Text style={{ color: "#DCE8F8", marginTop: 12, fontSize: 14 }}>Loading Street View…</Text>
            </>
          ) : (
            <>
              <Text style={{ color: "#DCE8F8", fontSize: 16, fontWeight: "700", textAlign: "center" }}>Street View unavailable</Text>
              <Text style={{ color: "#A8BAD2", marginTop: 6, fontSize: 13, textAlign: "center" }}>
                {!address ? "No job address is available." : !apiKey ? "Street View is not configured for this app build." : "Unable to load this job location. Retry or open Google Maps."}
              </Text>
              {address && apiKey ? (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry Street View" onPress={retry} style={{ padding: 12, marginTop: 6 }}>
                  <Text style={{ color: "#BFDBFE", fontWeight: "700" }}>Retry</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </View>
      ) : null}
      {status === "map" ? (
        <View pointerEvents="none" style={{ position: "absolute", top: 10, left: 10, right: 10, padding: 8, borderRadius: 8, backgroundColor: "rgba(3,15,33,0.9)" }}>
          <Text style={{ color: "#DCE8F8", fontSize: 12, textAlign: "center" }}>No Street View imagery here. Showing the location map.</Text>
        </View>
      ) : null}
      {address ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open job location in Google Maps"
          onPress={openInGoogleMaps}
          style={{ position: "absolute", right: 14, bottom: 14, backgroundColor: "rgba(3,15,33,0.90)", borderColor: "rgba(147,197,253,0.70)", borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 }}
        >
          <Text style={{ color: "#BFDBFE", fontSize: 13, fontWeight: "700" }}>Open in Google Maps ↗</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
