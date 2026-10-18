import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";

import { shouldPublishCompanyLocation, shouldUseBackgroundCompanyLocation } from "@/lib/company-location-policy";
import { getHomeServiceConnectedTimeState, publishJobSyncCompanyLocation } from "@/lib/jobsync-mobile-api";
import { LocationDisclosureModal, hasAcceptedLocationDisclosure, markLocationDisclosureAccepted } from "@/components/location-disclosure-modal";

const COMPANY_LOCATION_TASK = "HSC_COMPANY_LOCATION_TASK";
const TOKEN_KEY = "hsc_jobsync_mobile_bearer_v1";
const PUBLISH_INTERVAL_MS = 2 * 60 * 1000;
let foregroundPermissionRequested = false;

if (Platform.OS !== "web") {
  try {
    TaskManager.defineTask(COMPANY_LOCATION_TASK, async ({ data, error }) => {
      if (error || !data) return;
      const locations = (data as { locations?: Array<{ coords: { latitude: number; longitude: number; accuracy?: number | null } }> }).locations;
      const latest = locations?.[locations.length - 1];
      if (!latest) return;
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (!token) return;
      await publishJobSyncCompanyLocation(token, {
        latitude: latest.coords.latitude,
        longitude: latest.coords.longitude,
        ...(typeof latest.coords.accuracy === "number" ? { accuracyMeters: latest.coords.accuracy } : {}),
      }).catch(() => undefined);
    });
  } catch {
    // Native task registration is unavailable in this runtime.
  }
}

async function stopBackgroundUpdates() {
  if (Platform.OS === "web") return;
  const started = await Location.hasStartedLocationUpdatesAsync(COMPANY_LOCATION_TASK).catch(() => false);
  if (started) await Location.stopLocationUpdatesAsync(COMPANY_LOCATION_TASK).catch(() => undefined);
}

export function CompanyLocationPublisher({ token, role }: { token: string; role?: string }) {
  const [disclosureVisible, setDisclosureVisible] = useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = useState(false);

  useEffect(() => {
    if (role !== "technician") return;
    let cancelled = false;
    void hasAcceptedLocationDisclosure().then((accepted) => {
      if (!cancelled) setDisclosureAccepted(accepted);
    });
    return () => { cancelled = true; };
  }, [role]);

  useEffect(() => {
    if (role !== "technician") return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const publishForeground = async (clockedIn: boolean) => {
      const foreground = await Location.getForegroundPermissionsAsync();
      const appActive = AppState.currentState === "active";
      if (!shouldPublishCompanyLocation({
        role,
        clockedIn,
        disclosureAccepted,
        foregroundGranted: foreground.status === "granted",
        appActive,
      })) return;
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (cancelled) return;
      await publishJobSyncCompanyLocation(token, {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        ...(typeof position.coords.accuracy === "number" ? { accuracyMeters: position.coords.accuracy } : {}),
      });
    };

    const syncTracking = async () => {
      let clockedIn = false;
      try {
        const time = await getHomeServiceConnectedTimeState(token);
        clockedIn = time.isClockedIn;
      } catch {
        clockedIn = false;
      }
      if (cancelled) return;
      if (clockedIn && !disclosureAccepted) {
        const accepted = await hasAcceptedLocationDisclosure();
        if (!accepted) {
          setDisclosureVisible(true);
          await stopBackgroundUpdates();
          return;
        }
        setDisclosureAccepted(true);
      }
      if (!clockedIn || !disclosureAccepted) {
        await stopBackgroundUpdates();
        return;
      }
      const foreground = await Location.getForegroundPermissionsAsync();
      if (foreground.status !== "granted") {
        if (foregroundPermissionRequested) {
          await stopBackgroundUpdates();
          return;
        }
        foregroundPermissionRequested = true;
        const requested = await Location.requestForegroundPermissionsAsync();
        if (requested.status !== "granted") {
          await stopBackgroundUpdates();
          return;
        }
      }
      const background = Platform.OS === "web" ? { status: "denied" as const } : await Location.getBackgroundPermissionsAsync();
      if (shouldUseBackgroundCompanyLocation({
        role,
        clockedIn,
        disclosureAccepted,
        backgroundAlreadyGranted: background.status === "granted",
      })) {
        const started = await Location.hasStartedLocationUpdatesAsync(COMPANY_LOCATION_TASK).catch(() => false);
        if (!started) {
          await Location.startLocationUpdatesAsync(COMPANY_LOCATION_TASK, {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: PUBLISH_INTERVAL_MS,
            distanceInterval: 50,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: "On shift",
              notificationBody: "Sharing your location with dispatch while you are clocked in.",
            },
          }).catch(() => undefined);
        }
      } else {
        await stopBackgroundUpdates();
      }
      await publishForeground(clockedIn).catch(() => undefined);
    };

    void syncTracking();
    timer = setInterval(() => { void syncTracking(); }, PUBLISH_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", () => { void syncTracking(); });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      subscription.remove();
    };
  }, [disclosureAccepted, role, token]);

  if (role !== "technician") return null;
  return (
    <LocationDisclosureModal
      visible={disclosureVisible}
      onAccept={() => {
        void markLocationDisclosureAccepted().then(() => {
          setDisclosureAccepted(true);
          setDisclosureVisible(false);
        });
      }}
      onDecline={() => setDisclosureVisible(false)}
    />
  );
}
