/**
 * Background Geofencing Task
 *
 * This module registers a background task that fires when a detailer's device
 * enters or exits a defined geofence zone. It logs the event to the server,
 * which then notifies all admins via in-app notification.
 *
 * Usage:
 *   1. Call `startGeofencing(zones, employeeId, fullName)` when the detailer logs in.
 *   2. Call `stopGeofencing()` when the detailer logs out.
 *
 * Note: Background geofencing only works on physical iOS/Android devices.
 *       It is silently skipped on web and simulators.
 */
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager/build/TaskManager";
import { Platform } from "react-native";

export const GEOFENCE_TASK_NAME = "LW_GEOFENCE_TASK";

// Store employee info for use inside the background task
let _employeeId = "";
let _fullName = "";

/** Register the background task definition (call this at app root level, outside any component) */
export function defineGeofenceTask(trpcMutate: (data: {
  eventId: string; employeeId: string; fullName?: string;
  zoneId: string; zoneName?: string; eventType: "enter" | "exit";
  latitude?: number; longitude?: number;
}) => Promise<void>) {
  if (Platform.OS === "web") return;

  TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }: any) => {
    if (error) { console.warn("[Geofence] Task error:", error.message); return; }
    if (!data) return;

    const { eventType, region } = data as {
      eventType: Location.LocationGeofencingEventType;
      region: Location.LocationRegion & { identifier: string };
    };

    const type = eventType === Location.LocationGeofencingEventType.Enter ? "enter" : "exit";
    const eventId = `GEO-${region.identifier}-${_employeeId}-${Date.now()}`;

    try {
      await trpcMutate({
        eventId,
        employeeId: _employeeId,
        fullName: _fullName || undefined,
        zoneId: region.identifier,
        zoneName: (region as any).zoneName ?? region.identifier,
        eventType: type,
        latitude: region.latitude,
        longitude: region.longitude,
      });
    } catch (e) {
      console.warn("[Geofence] Failed to log event:", e);
    }
  });
}

export type GeofenceZoneInput = {
  zoneId: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

/** Start monitoring all active geofence zones */
export async function startGeofencing(
  zones: GeofenceZoneInput[],
  employeeId: string,
  fullName: string,
): Promise<void> {
  if (Platform.OS === "web") return;
  if (zones.length === 0) return;

  _employeeId = employeeId;
  _fullName = fullName;

  // First request foreground permission (required before background on iOS)
  try {
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== "granted") {
      console.warn("[Geofence] Foreground location permission not granted — skipping geofencing.");
      return;
    }
  } catch (e) {
    console.warn("[Geofence] Foreground permission request failed — skipping geofencing.", e);
    return;
  }

  // Then request background permission (may not be available in Expo Go)
  try {
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    if (bgStatus !== "granted") {
      console.warn("[Geofence] Background location permission not granted — skipping geofencing.");
      return;
    }
  } catch (e) {
    // In Expo Go, NSLocationAlwaysAndWhenInUseUsageDescription is not set — silently skip
    console.warn("[Geofence] Background permission unavailable (Expo Go?) — skipping geofencing.", e);
    return;
  }

  const regions: Location.LocationRegion[] = zones.map((z) => ({
    identifier: z.zoneId,
    latitude: z.latitude,
    longitude: z.longitude,
    radius: z.radiusMeters,
    notifyOnEnter: true,
    notifyOnExit: true,
  }));

  try {
    await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, regions);
    console.log(`[Geofence] Monitoring ${zones.length} zone(s).`);
  } catch (e) {
    console.warn("[Geofence] startGeofencingAsync failed:", e);
  }
}

/** Stop monitoring all geofence zones */
export async function stopGeofencing(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK_NAME);
    if (isRegistered) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
      console.log("[Geofence] Stopped monitoring.");
    }
  } catch (e) {
    console.warn("[Geofence] stopGeofencingAsync failed:", e);
  }
}

/** Check if geofencing is currently active */
export async function isGeofencingActive(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    return await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
  } catch {
    return false;
  }
}
