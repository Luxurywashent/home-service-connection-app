// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

// Bundle ID format: space.manus.<project_name_dots>.<timestamp>
// e.g., "my-app" created at 2024-01-15 10:30:45 -> "space.manus.my.app.t20240115103045"
// Bundle ID can only contain letters, numbers, and dots
// Android requires each dot-separated segment to start with a letter
const rawBundleId = "space.manus.team.luxury.wash.t20260331174054";
const bundleId =
  rawBundleId
    .replace(/[-_]/g, ".") // Replace hyphens/underscores with dots
    .replace(/[^a-zA-Z0-9.]/g, "") // Remove invalid chars
    .replace(/\.+/g, ".") // Collapse consecutive dots
    .replace(/^\.+|\.+$/g, "") // Trim leading/trailing dots
    .toLowerCase()
    .split(".")
    .map((segment) => {
      // Android requires each segment to start with a letter
      // Prefix with 'x' if segment starts with a digit
      return /^[a-zA-Z]/.test(segment) ? segment : "x" + segment;
    })
    .join(".") || "space.manus.app";
// Extract timestamp from bundle ID and prefix with "manus" for deep link scheme
// e.g., "space.manus.my.app.t20240115103045" -> "manus20240115103045"
const timestamp = bundleId.split(".").pop()?.replace(/^t/, "") ?? "";
const schemeFromBundleId = `manus${timestamp}`;

const env = {
  // App branding - update these values directly (do not use env vars)
  appName: "Home Service Connection",
  appSlug: "team-luxury-wash",
  // S3 URL of the app logo - set this to the URL returned by generate_image when creating custom logo
  // Leave empty to use the default icon from assets/images/icon.png
  logoUrl: "/manus-storage/hearthline-crm-icon_9e1dc1f0.png",
  scheme: schemeFromBundleId,
  iosBundleId: bundleId,
  androidPackage: bundleId,
};

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
  version: "1.26.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  runtimeVersion: "1.24.0",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    buildNumber: "110",
    bundleIdentifier: env.iosBundleId,
    config: {
      googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
    },
    "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false,
        "NSBluetoothAlwaysUsageDescription": "$(PRODUCT_NAME) uses Bluetooth for nearby payment terminal connectivity.",
        "NSBluetoothPeripheralUsageDescription": "$(PRODUCT_NAME) uses Bluetooth for nearby payment terminal connectivity."
      },
    // entitlements: {
    //   "com.apple.developer.proximity-reader.payment.acceptance": true,
    // },
    // NOTE: Tap to Pay entitlement temporarily disabled.
    // Re-enable once provisioning profile is regenerated on developer.apple.com
    // to include com.apple.developer.proximity-reader.payment.acceptance.
  },
  android: {
    config: {
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
      },
    },
    adaptiveIcon: {
      backgroundColor: "#07111F",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: env.androidPackage,
    permissions: ["POST_NOTIFICATIONS"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: env.scheme,
            host: "*",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-calendar",
      {
        calendarPermission: "Allow $(PRODUCT_NAME) to access your calendar to add appointment reminders.",
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/images/icon.png",
        color: "#4D8DFF",
        sounds: [],
      },
    ],
    [
      "expo-image-picker",
      {
        "photosPermission": "Allow $(PRODUCT_NAME) to access your photos to set a vehicle profile picture.",
        "cameraPermission": "Allow $(PRODUCT_NAME) to use the camera to take a vehicle photo."
      }
    ],
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission: "Allow Home Service Connection to access your location in the background for service-area alerts.",
        locationWhenInUsePermission: "Allow Home Service Connection to access your location so customers can track service arrival.",
        isAndroidBackgroundLocationEnabled: true,
      },
    ],
    [
      "expo-camera",
      {
        "cameraPermission": "Allow Home Service Connection to access your camera to take job photos."
      }
    ],

    [
      "expo-video",
      {
        supportsBackgroundPlayback: false,
        supportsPictureInPicture: false,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 380,
        resizeMode: "contain",
        backgroundColor: "#07111F",
        dark: {
          backgroundColor: "#07111F",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 26,
        },
      },
    ],
    // NOTE: @stripe/stripe-terminal-react-native plugin intentionally excluded.
    // The beta SDK (0.0.1-beta.30) injects TerminalApplicationDelegate.onCreate() into
    // Android's MainApplication.kt which crashes the app on launch on Android.
    // Tap to Pay is iOS-only — the module is loaded dynamically at runtime only on iOS
    // in components/tap-to-pay-checkout.tsx. No plugin needed for iOS-only native modules
    // when using dynamic require() guards.
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    projectId: "adfde9c0-02c1-4a12-8e86-e75b79a4edcf",
    googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
    eas: {
      projectId: "adfde9c0-02c1-4a12-8e86-e75b79a4edcf",
    },
  },
};

export default config;
