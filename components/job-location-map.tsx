import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";

import { useColors } from "@/hooks/use-colors";

export function JobLocationMap({ address, height = 320 }: { address?: string | null; height?: number }) {
  const colors = useColors();
  const [region, setRegion] = useState<Region | null>(null);
  const [loading, setLoading] = useState(Boolean(address?.trim()));

  useEffect(() => {
    let cancelled = false;
    const value = address?.trim();
    if (!value) {
      setRegion(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    Location.geocodeAsync(value)
      .then((matches) => {
        if (cancelled) return;
        const first = matches[0];
        if (!first) {
          setRegion(null);
          return;
        }
        setRegion({
          latitude: first.latitude,
          longitude: first.longitude,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        });
      })
      .catch(() => {
        if (!cancelled) setRegion(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!address?.trim()) {
    return (
      <View style={[styles.fallback, { backgroundColor: colors.surface, borderColor: colors.border, height }]}>
        <Text style={{ color: colors.muted, fontSize: 14, fontWeight: "600" }}>No service address available</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.fallback, { backgroundColor: colors.surface, borderColor: colors.border, height }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.muted, fontSize: 13, marginTop: 8 }}>Loading map…</Text>
      </View>
    );
  }

  if (!region) {
    return (
      <View style={[styles.fallback, { backgroundColor: colors.surface, borderColor: colors.border, height }]}>
        <Text style={{ color: colors.muted, fontSize: 14, fontWeight: "600" }}>Map unavailable for this address</Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6, textAlign: "center" }}>{address}</Text>
      </View>
    );
  }

  return (
    <MapView
      provider={PROVIDER_GOOGLE}
      style={{ height, width: "100%" }}
      initialRegion={region}
      region={region}
      showsCompass
      showsScale
      loadingEnabled
      mapType="standard"
    >
      <Marker coordinate={region} title="Service address" description={address} />
    </MapView>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
});
