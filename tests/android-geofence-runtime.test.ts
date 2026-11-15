import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: { OS: "android" },
  location: {
    requestForegroundPermissionsAsync: vi.fn(),
    requestBackgroundPermissionsAsync: vi.fn(),
    startGeofencingAsync: vi.fn(),
    stopGeofencingAsync: vi.fn(),
    hasStartedGeofencingAsync: vi.fn(),
    LocationGeofencingEventType: { Enter: 1, Exit: 2 },
  },
  tasks: {
    defineTask: vi.fn(),
    isTaskRegisteredAsync: vi.fn(),
    unregisterTaskAsync: vi.fn(),
  },
}));
vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("expo-location", () => mocks.location);
vi.mock("expo-task-manager/build/TaskManager", () => mocks.tasks);

import {
  cleanupAndroidGeofencing, defineGeofenceTask, GEOFENCE_TASK_NAME,
  isGeofencingActive, startGeofencing, stopGeofencing,
} from "../lib/geofence-task";

const zones = [{ zoneId: "zone-1", name: "Depot", latitude: 30, longitude: -86, radiusMeters: 400 }];
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.platform.OS = "android";
  mocks.location.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  mocks.location.requestBackgroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  mocks.location.hasStartedGeofencingAsync.mockResolvedValue(true);
  mocks.tasks.isTaskRegisteredAsync.mockResolvedValue(false);
});

describe("Android geofence release guard", () => {
  it("does not define a task, request permissions, start monitoring or report active via indirect helpers", async () => {
    const mutate = vi.fn();
    defineGeofenceTask(mutate);
    await startGeofencing(zones, "employee-1", "Test Employee");
    expect(await isGeofencingActive()).toBe(false);
    expect(mocks.tasks.defineTask).not.toHaveBeenCalled();
    expect(mocks.location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mocks.location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mocks.location.startGeofencingAsync).not.toHaveBeenCalled();
    expect(mocks.location.hasStartedGeofencingAsync).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("rejects Android events even if a callback was previously obtained on iOS", async () => {
    mocks.platform.OS = "ios";
    const mutate = vi.fn();
    defineGeofenceTask(mutate);
    const callback = mocks.tasks.defineTask.mock.calls[0][1];
    mocks.platform.OS = "android";
    await callback({ data: { eventType: 1, region: { identifier: "zone-1", latitude: 30, longitude: -86 } } });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("cleans up a legacy registration with stop and unregister only", async () => {
    mocks.tasks.isTaskRegisteredAsync.mockResolvedValue(true);
    await cleanupAndroidGeofencing();
    expect(mocks.location.stopGeofencingAsync).toHaveBeenCalledWith(GEOFENCE_TASK_NAME);
    expect(mocks.tasks.unregisterTaskAsync).toHaveBeenCalledWith(GEOFENCE_TASK_NAME);
    expect(mocks.tasks.defineTask).not.toHaveBeenCalled();
    expect(mocks.location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mocks.location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mocks.location.startGeofencingAsync).not.toHaveBeenCalled();
  });

  it("falls back to unregister if native stop fails without asking for permission", async () => {
    mocks.tasks.isTaskRegisteredAsync.mockResolvedValue(true);
    mocks.location.stopGeofencingAsync.mockRejectedValue(new Error("old native registration"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await cleanupAndroidGeofencing();
      expect(mocks.tasks.unregisterTaskAsync).toHaveBeenCalledWith(GEOFENCE_TASK_NAME);
      expect(mocks.location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
  });

  it("does not unregister unrelated tasks or stop absent registrations", async () => {
    await cleanupAndroidGeofencing();
    expect(mocks.location.stopGeofencingAsync).not.toHaveBeenCalled();
    expect(mocks.tasks.unregisterTaskAsync).not.toHaveBeenCalled();
    expect(mocks.tasks.isTaskRegisteredAsync.mock.calls.every(([name]) => name === GEOFENCE_TASK_NAME)).toBe(true);
  });
});

describe("existing iOS and web geofence behavior", () => {
  it("retains iOS foreground/background permission requests, monitoring and enter/exit events", async () => {
    mocks.platform.OS = "ios";
    const mutate = vi.fn().mockResolvedValue(undefined);
    defineGeofenceTask(mutate);
    await startGeofencing(zones, "employee-1", "Test Employee");
    expect(mocks.location.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(mocks.location.requestBackgroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(mocks.location.startGeofencingAsync).toHaveBeenCalledWith(GEOFENCE_TASK_NAME, [{
      identifier: "zone-1", latitude: 30, longitude: -86, radius: 400, notifyOnEnter: true, notifyOnExit: true,
    }]);
    const callback = mocks.tasks.defineTask.mock.calls[0][1];
    for (const eventType of [1, 2]) {
      await callback({ data: { eventType, region: { identifier: "zone-1", latitude: 30, longitude: -86 } } });
    }
    expect(mutate.mock.calls.map(([data]) => data.eventType)).toEqual(["enter", "exit"]);
    expect(mutate.mock.calls[0][0]).toMatchObject({ employeeId: "employee-1", fullName: "Test Employee", zoneId: "zone-1" });
    expect(await isGeofencingActive()).toBe(true);
    await cleanupAndroidGeofencing();
    expect(mocks.tasks.unregisterTaskAsync).not.toHaveBeenCalled();
  });

  it("retains iOS permission-denied short circuit and stop behavior", async () => {
    mocks.platform.OS = "ios";
    mocks.location.requestForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await startGeofencing(zones, "employee-1", "Test Employee");
      expect(mocks.location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
      expect(mocks.location.startGeofencingAsync).not.toHaveBeenCalled();
      mocks.tasks.isTaskRegisteredAsync.mockResolvedValue(true);
      await stopGeofencing();
      expect(mocks.location.stopGeofencingAsync).toHaveBeenCalledWith(GEOFENCE_TASK_NAME);
    } finally { warning.mockRestore(); }
  });

  it("retains the web no-op behavior", async () => {
    mocks.platform.OS = "web";
    defineGeofenceTask(vi.fn());
    await startGeofencing(zones, "employee-1", "Test Employee");
    await stopGeofencing();
    await cleanupAndroidGeofencing();
    expect(await isGeofencingActive()).toBe(false);
    for (const fn of Object.values(mocks.tasks)) expect(fn).not.toHaveBeenCalled();
    expect(mocks.location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mocks.location.startGeofencingAsync).not.toHaveBeenCalled();
  });
});

describe("minimal runtime integration guards", () => {
  it("separates Android stop-only root initialization from background callback initialization", () => {
    const root = source("app/_layout.tsx");
    const initialization = root.slice(root.indexOf('// Register background geofence task'), root.indexOf('const DEFAULT_WEB_INSETS'));
    expect(initialization).toContain('if (Platform.OS === "android")');
    const androidBranch = initialization.split('} else if')[0];
    expect(androidBranch).toContain('cleanupAndroidGeofencing()');
    expect(androidBranch).not.toContain('defineGeofenceTask(');
    expect(androidBranch).not.toContain('fetch(');
    expect(initialization).toContain('} else if ((Platform.OS as string) !== "web")');
  });

  it("disables Android auto-zone queries and the tab effect", () => {
    const tabs = source("app/(tabs)/_layout.tsx");
    expect(tabs).toContain('enabled: !!employee && !isAdmin && Platform.OS !== "web" && Platform.OS !== "android"');
    expect(tabs).toContain('if (!employeeId || isAdmin || Platform.OS === "web" || Platform.OS === "android") return;');
  });

  it("wires Schedule mount/unmount, guarded uploads and explicit stop without changing status call sites", () => {
    const schedule = source("app/(tabs)/schedule.tsx");
    expect(schedule).toContain('locationSession.mount()');
    expect(schedule).toContain('return () => locationSession.dispose()');
    expect(schedule).not.toContain('Location.watchPositionAsync');
    expect(schedule).not.toContain('setLocationWatcher');
    expect(schedule).toContain('onLocation: (loc) =>');
    expect(schedule).toContain('if (!isAllowed() || result.status === "cancelled") return;');
    expect(schedule).toContain('if (jobId) expireTokensMutation.mutate({ jobId });');
    expect(schedule).toContain('void startLocationSharing(updatedJob);');
    expect(schedule).toContain('stopLocationSharing(job.id);');
    const lifecycle = source("lib/foreground-location-session.ts");
    for (const forbidden of ['stopLocationSharing', 'mutate(', 'fetch(', 'requestBackground', 'TaskManager']) {
      expect(lifecycle).not.toContain(forbidden);
    }
  });
});
