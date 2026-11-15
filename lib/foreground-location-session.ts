import * as Location from "expo-location";
import { AppState, Platform, type AppStateStatus } from "react-native";

type SharingSession = {
  key: string;
  onReady: (isCurrent: () => boolean) => Promise<void>;
  onLocation: (location: Location.LocationObject) => void;
  onStarted: () => void;
  permissionGranted: boolean;
  ready: boolean;
  pending: Promise<void> | null;
};

type PositionResult =
  | { status: "available"; location: Location.LocationObject }
  | { status: "unavailable" | "cancelled" };

/** Owns only local GPS resources. Pausing never ends a sharing session or writes to the server. */
export function createForegroundLocationSession() {
  let mounted = false;
  let appState: AppStateStatus = AppState.currentState;
  let epoch = 0;
  let session: SharingSession | null = null;
  let watcher: Location.LocationSubscription | null = null;
  let listener: { remove(): void } | null = null;

  const canUseLocation = () => mounted && (
    Platform.OS !== "android" || (appState === "active" && AppState.currentState === "active")
  );
  const isCurrent = (value: SharingSession) => mounted && session === value;
  const pause = () => {
    // Also invalidates callbacks and pending position/watch results across a background/resume cycle.
    epoch += 1;
    watcher?.remove();
    watcher = null;
  };
  const captureForegroundGuard = () => {
    const startedEpoch = epoch;
    return () => canUseLocation() && epoch === startedEpoch;
  };

  const run = (value: SharingSession): Promise<void> => {
    if (!isCurrent(value) || !canUseLocation() || watcher) return Promise.resolve();
    // Serialize permission, token preparation and native watch creation, including resume races.
    if (value.pending) return value.pending;
    const startedEpoch = epoch;
    value.pending = (async () => {
      if (!value.permissionGranted) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!isCurrent(value)) return;
        if (status !== "granted") {
          session = null;
          return;
        }
        value.permissionGranted = true;
      }
      if (!isCurrent(value) || !canUseLocation()) return;
      if (!value.ready) {
        // Prepare the existing user-started session only once; resume never creates another token.
        value.ready = true;
        await value.onReady(() => isCurrent(value));
      }
      if (!isCurrent(value) || !canUseLocation()) return;
      const watchEpoch = epoch;
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
        (location) => {
          if (isCurrent(value) && canUseLocation() && epoch === watchEpoch) {
            value.onLocation(location);
          }
        },
      );
      if (!isCurrent(value) || !canUseLocation() || epoch !== watchEpoch) {
        subscription.remove();
        return;
      }
      watcher = subscription;
      value.onStarted();
    })().catch((error) => {
      // A permission error must require another explicit user start, not a prompt on resume.
      if (!value.permissionGranted && isCurrent(value)) session = null;
      console.warn("[Tracking] Foreground location sharing failed:", error);
    }).finally(() => {
      value.pending = null;
      // A resume may have happened while a native promise was pending. Retry only that lifecycle
      // transition, not a failed watch (which could otherwise cause an unbounded retry loop).
      if (epoch !== startedEpoch && isCurrent(value) && canUseLocation() && !watcher) {
        void run(value);
      }
    });
    return value.pending;
  };

  return {
    mount() {
      if (mounted) return;
      mounted = true;
      appState = AppState.currentState;
      if (Platform.OS === "android") {
        listener = AppState.addEventListener("change", (nextState) => {
          appState = nextState;
          if (nextState !== "active") pause();
          else if (session) void run(session);
        });
      }
    },
    dispose() {
      mounted = false;
      session = null;
      pause();
      listener?.remove();
      listener = null;
    },
    start(options: Pick<SharingSession, "key" | "onReady" | "onLocation" | "onStarted">) {
      if (!canUseLocation()) return Promise.resolve();
      if (session?.key === options.key) return run(session);
      pause();
      session = { ...options, permissionGranted: false, ready: false, pending: null };
      return run(session);
    },
    stop() {
      session = null;
      pause();
    },
    captureForegroundGuard,
    async getCurrentPosition(): Promise<PositionResult> {
      const isAllowed = captureForegroundGuard();
      if (!isAllowed()) return { status: "cancelled" };
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!isAllowed()) return { status: "cancelled" };
        if (status !== "granted") return { status: "unavailable" };
        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        return isAllowed() ? { status: "available", location } : { status: "cancelled" };
      } catch {
        return { status: isAllowed() ? "unavailable" : "cancelled" };
      }
    },
  };
}
