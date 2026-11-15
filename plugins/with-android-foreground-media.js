const { withAndroidManifest } = require("expo/config-plugins");

const BACKGROUND_MEDIA_PERMISSIONS = new Set([
  "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
  "android.permission.FOREGROUND_SERVICE",
]);
const BACKGROUND_MEDIA_SERVICES = new Set([
  "expo.modules.audio.service.AudioControlsService",
  "expo.modules.video.playbackService.ExpoVideoPlaybackService",
]);

/**
 * Remove only unused Android background-media declarations. Keep tools:node
 * removal markers from android.blockedPermissions to protect manifest merging.
 * Foreground playback/recording permissions and the location service are intact.
 * @param {import("expo/config-plugins").AndroidManifest} androidManifest
 * @returns {import("expo/config-plugins").AndroidManifest}
 */
function stripAndroidBackgroundMedia(androidManifest) {
  const manifest = androidManifest.manifest;
  for (const key of ["uses-permission", "uses-permission-sdk-23"]) {
    if (manifest[key]) {
      manifest[key] = manifest[key].filter(
        (permission) =>
          !BACKGROUND_MEDIA_PERMISSIONS.has(permission.$["android:name"]) ||
          permission.$["tools:node"] === "remove",
      );
    }
  }
  for (const application of manifest.application ?? []) {
    if (application.service) {
      application.service = application.service.filter(
        (service) => !BACKGROUND_MEDIA_SERVICES.has(service.$["android:name"]),
      );
    }
  }
  return androidManifest;
}

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withAndroidForegroundMedia = (config) =>
  withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = stripAndroidBackgroundMedia(modConfig.modResults);
    return modConfig;
  });

module.exports = withAndroidForegroundMedia;
module.exports.stripAndroidBackgroundMedia = stripAndroidBackgroundMedia;
