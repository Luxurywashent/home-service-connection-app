import { describe, expect, it } from "vitest";
import config from "../app.config";

const locationPlugin = config.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "expo-location",
) as [string, Record<string, unknown>];

describe("Android foreground-only location release configuration", () => {
  it("does not enable Android background location or a location foreground service", () => {
    expect(locationPlugin[1].isAndroidBackgroundLocationEnabled).toBe(false);
    expect(locationPlugin[1].isAndroidForegroundServiceEnabled).toBe(false);
  });

  it("blocks background-location and location-service permissions from manifest merging", () => {
    expect(config.android?.blockedPermissions).toContain("android.permission.ACCESS_BACKGROUND_LOCATION");
    expect(config.android?.blockedPermissions).toContain("android.permission.FOREGROUND_SERVICE_LOCATION");
    expect(config.android?.permissions).not.toContain("android.permission.ACCESS_BACKGROUND_LOCATION");
  });

  it("does not block foreground fine/coarse location or unrelated notification permissions", () => {
    expect(config.android?.blockedPermissions).not.toContain("android.permission.ACCESS_FINE_LOCATION");
    expect(config.android?.blockedPermissions).not.toContain("android.permission.ACCESS_COARSE_LOCATION");
    expect(config.android?.permissions).toContain("POST_NOTIFICATIONS");
  });

  it("preserves the existing iOS permission text and background configuration", () => {
    expect(locationPlugin[1].locationAlwaysAndWhenInUsePermission).toBe(
      "Allow Home Service Connection to access your location in the background for service-area alerts.",
    );
    expect(locationPlugin[1].locationWhenInUsePermission).toBe(
      "Allow Home Service Connection to access your location so customers can track service arrival.",
    );
    expect(locationPlugin[1].isIosBackgroundLocationEnabled).toBeUndefined();
    expect(config.ios?.bundleIdentifier).toBe("com.homeserviceconnection.mobile");
  });
});
