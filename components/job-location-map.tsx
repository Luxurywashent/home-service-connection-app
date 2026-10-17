import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Platform, Text, TouchableOpacity, View } from "react-native";
import * as Location from "expo-location";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";

export type JobLocationMapProps = {
  address: string;
  height?: number;
};

type Coordinates = {
  latitude: number;
  longitude: number;
};

const DEFAULT_REGION: Region = {
  latitude: 30.4213,
  longitude: -87.2169,
  latitudeDelta: 0.35,
  longitudeDelta: 0.35,
};

function mapSearchUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * Native Google map for job details.
 *
 * The former header was an unactionable Street View Static API image. It could
 * fail silently when that separate Google API was disabled or restricted. This
 * component relies on the Maps SDK already compiled into the iOS/Android app,
 * resolves the job address locally, and always leaves an explicit Maps fallback.
 */
export function JobLocationMap({ address, height = 320 }: JobLocationMapProps) {
  const normalizedAddress = address.trim();
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [isResolving, setIsResolving] = useState(Boolean(normalizedAddress));
  const [failedToResolve, setFailedToResolve] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    if (!normalizedAddress) {
      void Promise.resolve().then(() => {
        if (!isCurrent) return;
        setCoordinates(null);
        setIsResolving(false);
        setFailedToResolve(true);
      });
      return () => {
        isCurrent = false;
      };
    }

    void Promise.resolve()
      .then(() => {
        if (!isCurrent) return null;
        setCoordinates(null);
        setIsResolving(true);
        setFailedToResolve(false);
        return Location.geocodeAsync(normalizedAddress);
      })
      .then((results) => {
        if (!isCurrent) return;
        if (!results) return;
        const first = results[0];
        if (!first) {
          setFailedToResolve(true);
          return;
        }
        setCoordinates({ latitude: first.latitude, longitude: first.longitude });
      })
      .catch(() => {
        if (isCurrent) setFailedToResolve(true);
      })
      .finally(() => {
        if (isCurrent) setIsResolving(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [normalizedAddress]);

  const region = useMemo<Region>(() => {
    if (!coordinates) return DEFAULT_REGION;
    return {
      ...coordinates,
      latitudeDelta: 0.012,
      longitudeDelta: 0.012,
    };
  }, [coordinates]);

  const openInGoogleMaps = () => {
    void Linking.openURL(mapSearchUrl(normalizedAddress));
  };

  return (
    <View style={{ height, position: "relative", backgroundColor: "#0C1B32" }}>
      {Platform.OS === "web" ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={{ color: "#C7D2E4", fontSize: 14, textAlign: "center" }}>
            Interactive Google Maps are available in the mobile app.
          </Text>
        </View>
      ) : coordinates ? (
        <MapView
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          region={region}
          mapType="hybrid"
          rotateEnabled={false}
          pitchEnabled={false}
          showsCompass={false}
          showsMyLocationButton={false}
          showsBuildings
        >
          <Marker coordinate={coordinates} title="Job location" description={normalizedAddress} pinColor="#2563EB" />
        </MapView>
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28 }}>
          {isResolving ? (
            <>
              <ActivityIndicator size="large" color="#60A5FA" />
              <Text style={{ color: "#DCE8F8", marginTop: 12, fontSize: 14 }}>Loading job location…</Text>
            </>
          ) : (
            <>
              <Text style={{ color: "#DCE8F8", fontSize: 16, fontWeight: "700", textAlign: "center" }}>
                Map preview unavailable
              </Text>
              <Text style={{ color: "#A8BAD2", marginTop: 6, fontSize: 13, textAlign: "center" }}>
                {failedToResolve ? "The job address could not be located in the map preview." : "No job address is available."}
              </Text>
            </>
          )}
        </View>
      )}

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Open job location in Google Maps"
        onPress={openInGoogleMaps}
        style={{
          position: "absolute",
          right: 14,
          bottom: 14,
          backgroundColor: "rgba(3, 15, 33, 0.90)",
          borderColor: "rgba(147, 197, 253, 0.70)",
          borderWidth: 1,
          borderRadius: 18,
          paddingHorizontal: 14,
          paddingVertical: 9,
          shadowColor: "#000",
          shadowOpacity: 0.28,
          shadowRadius: 5,
          shadowOffset: { width: 0, height: 2 },
          elevation: 5,
        }}
      >
        <Text style={{ color: "#BFDBFE", fontSize: 13, fontWeight: "700" }}>Open in Google Maps ↗</Text>
      </TouchableOpacity>
    </View>
  );
}
