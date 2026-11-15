import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AndroidConfig, type AndroidManifest, type ConfigPlugin, type ExportedConfig } from "expo/config-plugins";
import config from "../app.config";
import eas from "../eas.json";

const withAndroidForegroundMedia = require("../plugins/with-android-foreground-media") as ConfigPlugin;
const { stripAndroidBackgroundMedia } = require("../plugins/with-android-foreground-media") as {
  stripAndroidBackgroundMedia: (manifest: AndroidManifest) => AndroidManifest;
};
const withAudio = require("expo-audio/app.plugin.js").default as ConfigPlugin;
const withVideo = require("expo-video/app.plugin.js").default as ConfigPlugin<{
  supportsBackgroundPlayback: boolean;
  supportsPictureInPicture: boolean;
}>;
const cleanupPlugin = "./plugins/with-android-foreground-media";
const mediaPermissions = [
  "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
  "android.permission.FOREGROUND_SERVICE",
];
const mediaServices = [
  "expo.modules.audio.service.AudioControlsService",
  "expo.modules.video.playbackService.ExpoVideoPlaybackService",
];
const foregroundPermissions = [
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.CAMERA",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.INTERNET",
];
const pluginNames = config.plugins?.map((plugin) => Array.isArray(plugin) ? plugin[0] : plugin) ?? [];
const permission = (name: string) => ({ $: { "android:name": name } });
const service = (name: string, type: string) => ({
  $: { "android:name": name, "android:exported": "false" as const, "android:foregroundServiceType": type },
});

function makeManifest(): AndroidManifest {
  return {
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      queries: [],
      application: [{
        $: { "android:name": ".MainApplication" },
        activity: [{
          $: { "android:name": ".MainActivity" },
          "intent-filter": [{ action: [{ $: { "android:name": "android.intent.action.MAIN" } }] }],
        }],
      }],
    },
  };
}

async function runManifestMod(composed: ExportedConfig, manifest = makeManifest()) {
  const mod = composed.mods?.android?.manifest;
  expect(mod).toBeTypeOf("function");
  const result = await mod!({
    ...composed,
    modResults: manifest,
    modRawConfig: composed,
    modRequest: {
      projectRoot: process.cwd(),
      platformProjectRoot: path.join(process.cwd(), "android"),
      platform: "android",
      modName: "manifest",
      introspect: true,
    },
  });
  return result.modResults;
}

function composeMediaPlugins(cleanup: boolean): ExportedConfig {
  let composed: ExportedConfig = {
    name: "Home Service Connection",
    slug: "home-service-connection",
    android: { permissions: ["POST_NOTIFICATIONS"] },
  };
  if (cleanup) composed = withAndroidForegroundMedia(composed);
  composed = withAudio(composed);
  composed = withVideo(composed, { supportsBackgroundPlayback: false, supportsPictureInPicture: false });
  return composed;
}

describe("Android foreground-only media manifest filtering", () => {
  it("removes only the exact media permissions and both stale playback services", () => {
    const manifest = makeManifest();
    manifest.manifest["uses-permission"] = [...mediaPermissions, ...foregroundPermissions].map(permission);
    manifest.manifest.application![0].service = mediaServices.map((name) => service(name, "mediaPlayback"));
    const result = stripAndroidBackgroundMedia(manifest);
    expect(result).toBe(manifest);
    expect(result.manifest["uses-permission"]).toEqual(foregroundPermissions.map(permission));
    expect(result.manifest.application![0].service).toEqual([]);
  });

  it("preserves unrelated permissions, activities, metadata, services and LocationTaskService verbatim", () => {
    const manifest = makeManifest();
    manifest.manifest["uses-permission"] = [
      ...foregroundPermissions.map(permission),
      permission("android.permission.FOREGROUND_SERVICE_MICROPHONE"),
      permission("android.permission.FOREGROUND_SERVICE_LOCATION"),
      { $: { "android:name": "android.permission.ACCESS_BACKGROUND_LOCATION", "tools:node": "remove" } },
      { $: { "android:name": "android.permission.FOREGROUND_SERVICE_LOCATION", "tools:node": "remove" } },
    ];
    manifest.manifest.application![0].service = [
      service("expo.modules.location.services.LocationTaskService", "location"),
      service("expo.modules.audio.service.AudioRecordingService", "microphone"),
      service("com.example.OtherMediaService", "mediaPlayback"),
    ];
    manifest.manifest.application![0]["meta-data"] = [{ $: { "android:name": "example", "android:value": "unchanged" } }];
    const before = structuredClone(manifest);
    expect(stripAndroidBackgroundMedia(manifest)).toEqual(before);
  });

  it("preserves tools:node removal safeguards while eliminating duplicate active declarations", () => {
    const manifest = makeManifest();
    manifest.manifest["uses-permission"] = mediaPermissions.flatMap((name) => [
      permission(name),
      { $: { "android:name": name, "tools:node": "remove" } },
      permission(name),
    ]);
    expect(stripAndroidBackgroundMedia(manifest).manifest["uses-permission"]).toEqual(
      mediaPermissions.map((name) => ({ $: { "android:name": name, "tools:node": "remove" } })),
    );
  });

  it("also filters sdk-23 permission declarations without dropping unrelated permissions", () => {
    const manifest = makeManifest();
    manifest.manifest["uses-permission-sdk-23"] = [...mediaPermissions, ...foregroundPermissions].map(permission);
    expect(stripAndroidBackgroundMedia(manifest).manifest["uses-permission-sdk-23"]).toEqual(foregroundPermissions.map(permission));
  });

  it("is idempotent and tolerates absent permissions, applications and services", () => {
    const manifest = makeManifest();
    const before = structuredClone(manifest);
    expect(stripAndroidBackgroundMedia(manifest)).toEqual(before);
    expect(stripAndroidBackgroundMedia(manifest)).toEqual(before);
    delete manifest.manifest.application;
    const withoutApplication = structuredClone(manifest);
    expect(stripAndroidBackgroundMedia(manifest)).toEqual(withoutApplication);
  });

  it("filters duplicate media services across applications but leaves similarly named services", () => {
    const manifest = makeManifest();
    manifest.manifest.application!.push({ $: { "android:name": "com.example.OtherApplication" } });
    for (const application of manifest.manifest.application!) {
      application.service = [
        ...mediaServices.flatMap((name) => [service(name, "mediaPlayback"), service(name, "mediaPlayback")]),
        service(`${mediaServices[0]}Other`, "mediaPlayback"),
      ];
    }
    stripAndroidBackgroundMedia(manifest);
    for (const application of manifest.manifest.application!) {
      expect(application.service).toEqual([service(`${mediaServices[0]}Other`, "mediaPlayback")]);
    }
    const filtered = structuredClone(manifest);
    expect(stripAndroidBackgroundMedia(manifest)).toEqual(filtered);
  });
});

describe("Android media config plugin ordering and platform isolation", () => {
  it("registers cleanup exactly once and before upstream plugins because manifest mods run in reverse", () => {
    expect(pluginNames.filter((name) => name === cleanupPlugin)).toHaveLength(1);
    expect(pluginNames[0]).toBe(cleanupPlugin);
    expect(pluginNames.indexOf(cleanupPlugin)).toBeLessThan(pluginNames.indexOf("expo-audio"));
    expect(pluginNames.indexOf(cleanupPlugin)).toBeLessThan(pluginNames.indexOf("expo-video"));
  });

  it("really strips the installed expo-audio default additions after upstream mods execute", async () => {
    const baseline = await runManifestMod(composeMediaPlugins(false));
    expect(baseline.manifest.application![0].service?.map((item) => item.$["android:name"])).toContain(mediaServices[0]);
    for (const name of mediaPermissions) expect(baseline.manifest["uses-permission"]).toContainEqual(permission(name));

    const fixture = makeManifest();
    fixture.manifest.application![0].service = [
      service(mediaServices[1], "mediaPlayback"),
      service("expo.modules.location.services.LocationTaskService", "location"),
    ];
    const result = await runManifestMod(composeMediaPlugins(true), fixture);
    expect(result.manifest.application![0].service).toEqual([
      service("expo.modules.location.services.LocationTaskService", "location"),
    ]);
    for (const name of mediaPermissions) expect(result.manifest["uses-permission"]).not.toContainEqual(permission(name));
    expect(result.manifest["uses-permission"]).toContainEqual(permission("android.permission.RECORD_AUDIO"));
    expect(result.manifest["uses-permission"]).toContainEqual(permission("android.permission.MODIFY_AUDIO_SETTINGS"));
  });

  it("retains media and existing GPS merger removal markers with installed Expo permission safeguards", async () => {
    const composed = AndroidConfig.Permissions.withBlockedPermissions(
      composeMediaPlugins(true), config.android!.blockedPermissions!,
    );
    const result = await runManifestMod(composed);
    for (const name of config.android!.blockedPermissions!) {
      expect(result.manifest["uses-permission"]).toContainEqual({ $: { "android:name": name, "tools:node": "remove" } });
      expect(result.manifest["uses-permission"]).not.toContainEqual(permission(name));
    }
    expect(result.manifest.application![0].service).toEqual([]);
  });

  it("adds only an Android manifest mod and does not register or replace any iOS mod", () => {
    const iosInfo = { UIBackgroundModes: ["fetch", "audio"], NSMicrophoneUsageDescription: "unchanged" };
    const input: ExportedConfig = { name: "test", slug: "test", ios: { infoPlist: iosInfo } };
    const output = withAndroidForegroundMedia(input) as ExportedConfig;
    expect(Object.keys(output.mods!)).toEqual(["android"]);
    expect(Object.keys(output.mods!.android!)).toEqual(["manifest"]);
    expect(output.ios?.infoPlist).toBe(iosInfo);
    const withExistingIos = composeMediaPlugins(false);
    const existingIosMods = withExistingIos.mods!.ios;
    withAndroidForegroundMedia(withExistingIos);
    expect(withExistingIos.mods!.ios).toBe(existingIosMods);
  });

  it("keeps bare expo-audio defaults, video foreground options and the original explicit iOS config", () => {
    expect(config.plugins).toContain("expo-audio");
    expect(config.plugins?.filter((plugin) => Array.isArray(plugin) && plugin[0] === "expo-audio")).toEqual([]);
    expect(config.plugins).toContainEqual(["expo-video", { supportsBackgroundPlayback: false, supportsPictureInPicture: false }]);
    expect(config.ios).toEqual({
      version: "1.0.1",
      supportsTablet: true,
      bundleIdentifier: "com.homeserviceconnection.mobile",
      infoPlist: { ITSAppUsesNonExemptEncryption: false },
    });
  });

  it("blocks only the four unused media/location service permissions and keeps foreground permissions available", () => {
    expect(config.android?.blockedPermissions).toEqual([
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.FOREGROUND_SERVICE_LOCATION",
      ...mediaPermissions,
    ]);
    for (const name of foregroundPermissions) expect(config.android?.blockedPermissions).not.toContain(name);
    expect(config.android?.permissions).toEqual(["POST_NOTIFICATIONS"]);
  });

  it("keeps the local plugin source restricted to withAndroidManifest with no iOS, runtime, or filesystem mods", () => {
    const source = readFileSync(path.join(process.cwd(), "plugins/with-android-foreground-media.js"), "utf8");
    expect(source).toContain("withAndroidManifest(config");
    expect(source).not.toMatch(/withInfoPlist|withEntitlementsPlist|withXcodeProject|withDangerousMod|withAppBuildGradle|withBaseMod|withMod\(/);
    expect(source).not.toMatch(/require\(["'](?:node:fs|fs|react-native|expo-audio|expo-video)["']\)|config\.ios\s*=/);
    for (const name of [...mediaPermissions, ...mediaServices]) expect(source).toContain(name);
  });

  it("preserves store identities, Expo project identity and fixed production API targets", () => {
    expect(config.name).toBe("Home Service Connection");
    expect(config.android?.package).toBe("com.homeserviceconnected");
    expect(config.ios?.bundleIdentifier).toBe("com.homeserviceconnection.mobile");
    expect(config.slug).toBe("home-service-connection");
    expect(config.owner).toBe("lilmerge4");
    expect(config.scheme).toBe("homeserviceconnection");
    expect(config.extra?.eas?.projectId).toBe("e6614385-618a-460d-a650-06ae63b97563");
    expect(eas.build.production.env.EXPO_PUBLIC_API_BASE_URL).toBe("https://jobwash-veysiubh.manus.space");
    expect(eas.build.production.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL).toBe("https://jobwash-veysiubh.manus.space");
  });
});
