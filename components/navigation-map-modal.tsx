/**
 * NavigationMapModal — Google Maps-style in-app navigation for detailers.
 *
 * Features:
 * - Heading-up map: rotates to face direction of travel
 * - Van stays centered in the lower third of the screen
 * - Turn-by-turn instruction banner at the top (teal card like Google Maps)
 * - Remaining route polyline only (trims behind van)
 * - Speed display (mph) at bottom left
 * - ETA + distance summary at the bottom
 * - "I've Arrived" button
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { trpc } from "@/lib/trpc";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LatLng {
  latitude: number;
  longitude: number;
}

interface Step {
  instruction: string;
  distance: string;
  duration: string;
  distanceMeters: number;
  maneuver: string;       // e.g. "turn-left", "turn-right", "straight", "merge"
  endLocation: LatLng;
}

interface RouteData {
  polyline: LatLng[];
  steps: Step[];
  totalDistance: string;
  totalDuration: string;
  totalDurationSec: number;
  destinationLatLng: LatLng;
}

interface Props {
  visible: boolean;
  destination: string;
  jobName?: string;
  apiKey: string;
  onArrive: () => void;
  onClose: () => void;
  jobId?: string;
  detailerName?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<b>/g, "").replace(/<\/b>/g, "")
    .replace(/<div[^>]*>/g, " ").replace(/<\/div>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();
}

function decodePolyline(encoded: string): LatLng[] {
  const poly: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    poly.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return poly;
}

function distanceBetween(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const sin2 =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(sin2), Math.sqrt(1 - sin2));
}

/** Find the closest point index on the polyline to a given position */
function closestPolylineIndex(pos: LatLng, polyline: LatLng[]): number {
  let minDist = Infinity;
  let minIdx = 0;
  for (let i = 0; i < polyline.length; i++) {
    const d = distanceBetween(pos, polyline[i]);
    if (d < minDist) { minDist = d; minIdx = i; }
  }
  return minIdx;
}

/** Maneuver string → arrow character */
function maneuverArrow(maneuver: string): string {
  if (!maneuver) return "↑";
  if (maneuver.includes("turn-left") || maneuver === "left") return "←";
  if (maneuver.includes("turn-right") || maneuver === "right") return "→";
  if (maneuver.includes("slight-left") || maneuver === "keep-left") return "↖";
  if (maneuver.includes("slight-right") || maneuver === "keep-right") return "↗";
  if (maneuver.includes("uturn")) return "↩";
  if (maneuver.includes("merge") || maneuver.includes("ramp") || maneuver.includes("fork")) return "⬆";
  if (maneuver.includes("roundabout")) return "↻";
  return "↑";
}

function formatETA(sec: number): string {
  if (sec < 60) return "< 1 min";
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs} hr ${rem} min` : `${hrs} hr`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function NavigationMapModal({
  visible,
  destination,
  jobName,
  apiKey,
  onArrive,
  onClose,
  jobId,
  detailerName,
}: Props) {
  useKeepAwake();

  const mapRef = useRef<MapView>(null);
  const watcherRef = useRef<Location.LocationSubscription | null>(null);
  const etaSentRef = useRef<boolean>(false);
  const lastBearingRef = useRef<number>(0);
  const mapReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendEtaMutation = trpc.jobs.sendEtaNotification.useMutation();

  // Delay MapView mount until after the modal slide animation (~400ms) to prevent
  // a native iOS crash caused by Google Maps SDK initializing during a view transition.
  const [mapMounted, setMapMounted] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteData | null>(null);
  const routeRef = useRef<RouteData | null>(null); // always-current ref for location callbacks
  const [remainingPolyline, setRemainingPolyline] = useState<LatLng[]>([]);
  const remainingPolylineRef = useRef<LatLng[]>([]); // always-current ref for distance calc
  const [currentPos, setCurrentPos] = useState<LatLng | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const stepIndexRef = useRef(0);
  const [etaSec, setEtaSec] = useState<number>(0);
  const [distanceMi, setDistanceMi] = useState<string>("—");
  const [speedMph, setSpeedMph] = useState<number>(0);

  // ── Fetch route ─────────────────────────────────────────────────────────────
  const fetchRoute = useCallback(
    async (origin: LatLng) => {
      try {
        const originStr = `${origin.latitude},${origin.longitude}`;
        const destStr = encodeURIComponent(destination);
        const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originStr}&destination=${destStr}&mode=driving&key=${apiKey}`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.status !== "OK" || !json.routes?.length) {
          setError("Could not find a route. Check the job address.");
          setLoading(false);
          return;
        }
        const leg = json.routes[0].legs[0];
        const steps: Step[] = leg.steps.map((s: any) => ({
          instruction: stripHtml(s.html_instructions),
          distance: s.distance.text,
          duration: s.duration.text,
          distanceMeters: s.distance.value,
          maneuver: s.maneuver ?? "",
          endLocation: { latitude: s.end_location.lat, longitude: s.end_location.lng },
        }));
        const polyline = decodePolyline(json.routes[0].overview_polyline.points);
        const destLatLng: LatLng = {
          latitude: leg.end_location.lat,
          longitude: leg.end_location.lng,
        };
        const routeData: RouteData = {
          polyline,
          steps,
          totalDistance: leg.distance.text,
          totalDuration: leg.duration.text,
          totalDurationSec: leg.duration.value,
          destinationLatLng: destLatLng,
        };
        setRoute(routeData);
        routeRef.current = routeData;
        setRemainingPolyline(polyline);
        remainingPolylineRef.current = polyline;
        setEtaSec(leg.duration.value);
        setDistanceMi(leg.distance.text);
        setStepIndex(0);
        stepIndexRef.current = 0;
        setLoading(false);

        // Send ETA SMS once
        if (jobId && detailerName && !etaSentRef.current) {
          etaSentRef.current = true;
          sendEtaMutation.mutate({
            jobId,
            etaMinutes: Math.ceil(leg.duration.value / 60),
            detailerFirstName: detailerName.split(" ")[0],
          });
        }

        // Initial camera: heading-up, van in lower third
        setTimeout(() => {
          if (mapRef.current) {
            mapRef.current.animateCamera(
              {
                center: origin,
                heading: lastBearingRef.current,
                pitch: 45,
                zoom: 17,
                altitude: 500,
              },
              { duration: 800 }
            );
          }
        }, 400);
      } catch {
        setError("Navigation unavailable. Check your connection.");
        setLoading(false);
      }
    },
    [destination, apiKey]
  );

  // Mount the map only after the modal slide animation completes
  useEffect(() => {
    if (visible) {
      mapReadyTimerRef.current = setTimeout(() => setMapMounted(true), 450);
    } else {
      if (mapReadyTimerRef.current) clearTimeout(mapReadyTimerRef.current);
      setMapMounted(false);
    }
    return () => {
      if (mapReadyTimerRef.current) clearTimeout(mapReadyTimerRef.current);
    };
  }, [visible]);

  // ── Location watch ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setError(null);
    setRoute(null);
    setRemainingPolyline([]);
    etaSentRef.current = false;
    setStepIndex(0);
    setSpeedMph(0);

    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setError("Location permission required for navigation.");
        setLoading(false);
        return;
      }

      const initial = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      const pos: LatLng = {
        latitude: initial.coords.latitude,
        longitude: initial.coords.longitude,
      };
      if (initial.coords.heading != null && initial.coords.heading >= 0) {
        lastBearingRef.current = initial.coords.heading;
      }
      if (!cancelled) {
        setCurrentPos(pos);
        await fetchRoute(pos);
      }

      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 8,
          timeInterval: 2000,
        },
        (loc) => {
          if (cancelled) return;
          const newPos: LatLng = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          };
          const bearing = (loc.coords.heading != null && loc.coords.heading >= 0)
            ? loc.coords.heading
            : lastBearingRef.current;
          lastBearingRef.current = bearing;

          // Speed in mph
          const mps = loc.coords.speed ?? 0;
          setSpeedMph(Math.round(mps * 2.23694));

          setCurrentPos(newPos);

          // Trim remaining polyline to ahead of van
          const trimmedPolyline = (() => {
            const prev = remainingPolylineRef.current;
            if (!prev.length) return prev;
            const idx = closestPolylineIndex(newPos, prev);
            return prev.slice(idx);
          })();
          remainingPolylineRef.current = trimmedPolyline;
          setRemainingPolyline(trimmedPolyline);

          // Advance step if within 25m of step end (uses routeRef — never stale)
          const currentRoute = routeRef.current;
          if (currentRoute) {
            const currentStepIdx = stepIndexRef.current;
            const step = currentRoute.steps[currentStepIdx];
            if (step) {
              const dist = distanceBetween(newPos, step.endLocation);
              if (dist < 25 && currentStepIdx < currentRoute.steps.length - 1) {
                if (Platform.OS !== "web") {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                }
                const next = currentStepIdx + 1;
                stepIndexRef.current = next;
                setStepIndex(next);
              }
            }

            // Recalculate ETA from remaining steps
            const remaining = currentRoute.steps.slice(stepIndexRef.current);
            const secs = remaining.reduce((acc, s) => {
              const m = s.duration.match(/(\d+)\s*min/);
              const h = s.duration.match(/(\d+)\s*hour/);
              return acc + (h ? parseInt(h[1]) * 3600 : 0) + (m ? parseInt(m[1]) * 60 : 0);
            }, 0);
            if (secs > 0) setEtaSec(secs);

            // Recalculate remaining distance from trimmed polyline
            let totalMeters = 0;
            for (let i = 1; i < trimmedPolyline.length; i++) {
              totalMeters += distanceBetween(trimmedPolyline[i - 1], trimmedPolyline[i]);
            }
            const miles = totalMeters / 1609.344;
            setDistanceMi(miles >= 10 ? `${miles.toFixed(0)} mi` : `${miles.toFixed(1)} mi`);
          }

          // Animate camera: heading-up, van centered lower third
          if (mapRef.current) {
            mapRef.current.animateCamera(
              {
                center: newPos,
                heading: bearing,
                pitch: 50,
                zoom: 17,
                altitude: 400,
              },
              { duration: 600 }
            );
          }
        }
      );
      watcherRef.current = sub;
    })();

    return () => {
      cancelled = true;
      watcherRef.current?.remove();
      watcherRef.current = null;
    };
  }, [visible]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleArrive = () => {
    watcherRef.current?.remove();
    watcherRef.current = null;
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    onArrive();
  };

  const handleClose = () => {
    watcherRef.current?.remove();
    watcherRef.current = null;
    onClose();
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const currentStep = route?.steps[stepIndex];
  const nextStep = route?.steps[stepIndex + 1];
  const isLastStep = route ? stepIndex >= route.steps.length - 1 : false;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {/* ── Map ── */}
        {Platform.OS !== "web" ? (
          mapMounted ? (
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            provider={PROVIDER_GOOGLE}
            showsUserLocation={false}
            showsMyLocationButton={false}
            showsCompass={false}
            showsTraffic
            rotateEnabled
            pitchEnabled
            initialRegion={
              currentPos
                ? {
                    latitude: currentPos.latitude,
                    longitude: currentPos.longitude,
                    latitudeDelta: 0.015,
                    longitudeDelta: 0.015,
                  }
                : { latitude: 30.4, longitude: -86.5, latitudeDelta: 0.5, longitudeDelta: 0.5 }
            }
          >
            {/* Remaining route polyline */}
            {remainingPolyline.length > 1 && (
              <>
                {/* Shadow/border */}
                <Polyline
                  coordinates={remainingPolyline}
                  strokeColor="#0041CC"
                  strokeWidth={9}
                  lineCap="round"
                  lineJoin="round"
                />
                {/* Main blue route */}
                <Polyline
                  coordinates={remainingPolyline}
                  strokeColor="#1A73E8"
                  strokeWidth={6}
                  lineCap="round"
                  lineJoin="round"
                />
              </>
            )}
            {/* Van marker */}
            {currentPos && (
              <Marker coordinate={currentPos} anchor={{ x: 0.5, y: 0.5 }} flat>
                <View style={styles.vanMarker}>
                  <Text style={styles.vanMarkerText}>🚐</Text>
                </View>
              </Marker>
            )}
            {/* Destination marker */}
            {route && (
              <Marker
                coordinate={route.destinationLatLng}
                title={jobName ?? "Destination"}
                description={destination}
                pinColor="#EF4444"
              />
            )}
          </MapView>
          ) : null
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.webFallback]}>
            <Text style={styles.webFallbackText}>
              In-app navigation is available on iOS and Android.
            </Text>
          </View>
        )}

        {/* ── Turn-by-turn banner (top, Google Maps style) ── */}
        {!loading && !error && currentStep && (
          <View style={styles.turnBanner}>
            <View style={styles.turnBannerMain}>
              <View style={styles.turnArrowBox}>
                <Text style={styles.turnArrowText}>
                  {maneuverArrow(currentStep.maneuver)}
                </Text>
              </View>
              <View style={styles.turnTextCol}>
                <Text style={styles.turnDistance}>{currentStep.distance}</Text>
                <Text style={styles.turnInstruction} numberOfLines={2}>
                  {currentStep.instruction}
                </Text>
              </View>
            </View>
            {nextStep && (
              <View style={styles.thenRow}>
                <Text style={styles.thenLabel}>Then</Text>
                <Text style={styles.thenArrow}>{maneuverArrow(nextStep.maneuver)}</Text>
                <Text style={styles.thenInstruction} numberOfLines={1}>
                  {nextStep.instruction}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Loading / error overlay */}
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color="#1A73E8" size="large" />
            <Text style={styles.loadingText}>Getting route…</Text>
          </View>
        )}
        {error && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={handleClose} style={styles.errorCloseBtn}>
              <Text style={styles.errorCloseBtnText}>Close</Text>
            </Pressable>
          </View>
        )}

        {/* ── Speed display (bottom left) ── */}
        {!loading && !error && (
          <View style={styles.speedBox}>
            <Text style={styles.speedValue}>{speedMph}</Text>
            <Text style={styles.speedUnit}>mph</Text>
          </View>
        )}

        {/* ── Close button (top right) ── */}
        <Pressable
          onPress={handleClose}
          style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.closeBtnText}>✕</Text>
        </Pressable>

        {/* ── Bottom summary card ── */}
        {!loading && !error && (
          <View style={styles.bottomCard}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{formatETA(etaSec)}</Text>
                <Text style={styles.summaryLabel}>ETA</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{distanceMi}</Text>
                <Text style={styles.summaryLabel}>Distance</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>
                  {route ? `${stepIndex + 1}/${route.steps.length}` : "—"}
                </Text>
                <Text style={styles.summaryLabel}>Step</Text>
              </View>
            </View>

            <Pressable
              onPress={handleArrive}
              style={({ pressed }) => [
                styles.arrivedBtn,
                pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
              ]}
            >
              <Text style={styles.arrivedBtnText}>📍  I've Arrived</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  webFallback: {
    backgroundColor: "#1C1C1E",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  webFallbackText: {
    color: "#9BA1A6",
    fontSize: 16,
    textAlign: "center",
  },

  // Van marker
  vanMarker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#1A73E8",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 8,
  },
  vanMarkerText: {
    fontSize: 24,
  },

  // Turn-by-turn banner (Google Maps teal style)
  turnBanner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "#1B6B5A",
    paddingTop: 52,
    paddingBottom: 12,
    paddingHorizontal: 16,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 16,
  },
  turnBannerMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  turnArrowBox: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  turnArrowText: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "800",
  },
  turnTextCol: {
    flex: 1,
    gap: 2,
  },
  turnDistance: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    fontWeight: "600",
  },
  turnInstruction: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 28,
  },
  thenRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 6,
  },
  thenLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontWeight: "600",
  },
  thenArrow: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  thenInstruction: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    flex: 1,
  },

  // Loading / error
  loadingOverlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    color: "#fff",
    fontSize: 15,
  },
  errorOverlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  errorText: {
    color: "#F87171",
    fontSize: 15,
    textAlign: "center",
  },
  errorCloseBtn: {
    backgroundColor: "#374151",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  errorCloseBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },

  // Close button
  closeBtn: {
    position: "absolute",
    top: 52,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  closeBtnText: {
    color: "#111",
    fontSize: 14,
    fontWeight: "700",
  },

  // Speed box (bottom left, like Google Maps)
  speedBox: {
    position: "absolute",
    bottom: 200,
    left: 16,
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
    minWidth: 52,
  },
  speedValue: {
    color: "#111",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 26,
  },
  speedUnit: {
    color: "#6b7280",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
  },

  // Bottom summary card
  bottomCard: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#1C1C1E",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 36,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 20,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2C2C2E",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  summaryValue: {
    color: "#ECEDEE",
    fontSize: 16,
    fontWeight: "700",
  },
  summaryLabel: {
    color: "#9BA1A6",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryDivider: {
    width: 1,
    height: 32,
    backgroundColor: "#3C3C3E",
  },
  arrivedBtn: {
    backgroundColor: "#22C55E",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  arrivedBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
});
