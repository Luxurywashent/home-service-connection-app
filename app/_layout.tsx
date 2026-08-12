import "@/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { AppState, AppStateStatus, Platform } from "react-native";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider } from "@/lib/theme-provider";
import { LocationProvider } from "@/lib/location-context";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";

import { trpc, createTRPCClient } from "@/lib/trpc";
import { initManusRuntime, subscribeSafeAreaInsets } from "@/lib/_core/manus-runtime";
import { AuthProvider } from "@/lib/auth-context";
import { CustomerProvider } from "@/lib/customer-context";
import { InvestorAuthProvider } from "@/lib/investor-auth";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform as RNPlatform } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useEmployeePush } from "@/hooks/use-employee-push";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useCustomerAuth } from "@/lib/customer-context";

// Register background geofence task at module level (required by expo-task-manager)
// Must be called outside any component, at the top level of the entry file
if ((Platform.OS as string) !== "web") {
  // Lazy import to avoid issues on web
  import("@/lib/geofence-task").then(({ defineGeofenceTask }) => {
    // The logEvent mutation is called from within the task via a direct fetch
    // since tRPC hooks can't be used in background tasks
    defineGeofenceTask(async (data) => {
      try {
        const apiBase = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:3000";
        await fetch(`${apiBase}/trpc/geofence.logEvent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ json: data }),
        });
      } catch (e) {
        console.warn("[Geofence] Failed to log event from background task:", e);
      }
    });
  }).catch(() => {});
}

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const unstable_settings = {
  anchor: "(tabs)",
};

// Inner component that has access to auth context for push registration
function AppInner() {
  useEmployeePush();
  return null;
}

// Customer notification router — handles review/completion push taps
function CustomerNotificationRouter() {
  const { customer } = useCustomerAuth();
  const router = useRouter();
  useEffect(() => {
    if (!customer) return;
    const handleTap = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as Record<string, string | undefined>;
      if (!data) return;
      if (data.screen === 'review') {
        const params: Record<string, string> = {};
        if (data.jobId) params.jobId = data.jobId;
        if (data.city) params.city = data.city;
        if (data.detailerName) params.detailerName = data.detailerName;
        router.push({ pathname: '/(customer)/review', params } as any);
      } else if (data.screen === 'messages') {
        // Navigate directly to the customer portal messages tab
        router.push('/(customer)/messages' as any);
      }
    };
    const sub = Notifications.addNotificationResponseReceivedListener(handleTap);
    // Handle cold-start tap
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleTap(response);
        Notifications.clearLastNotificationResponseAsync();
      }
    });
    return () => sub.remove();
  }, [customer]);
  return null;
}

// Role-aware notification router — must be inside AuthProvider to read employee role
function NotificationRouter() {
  const { employee } = useEmployeeAuth();
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS === "web") return;

    const isSales = employee?.role === 'sales' || employee?.role === 'door_hanger_rep';
    const isAdmin = employee?.role === 'admin';
    const isOps = employee?.role === 'operations_manager';
    const handleRoleNotificationTap = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as Record<string, string | undefined>;
      if (!data) return;
      const screen = data.screen;

      if (screen === 'new_bookings') {
        // New job booked — open Recently Booked Jobs list (admin/ops only)
        if (isAdmin || isOps) {
          router.push('/(tabs)/admin-recently-booked' as any);
        }
      } else if (screen === 'job_detail' && data.jobId) {
        // Job assigned / rescheduled
        if (isAdmin || isOps) {
          router.push({ pathname: '/(tabs)/admin-schedule', params: { highlightBookingId: data.jobId } } as any);
        } else {
          router.push({ pathname: '/(tabs)/schedule', params: { highlightBookingId: data.jobId } } as any);
        }
      } else if (screen === 'team-chat') {
        const params: Record<string, string> = {};
        if (data.channel) params.openChannel = data.channel;
        if (data.senderId) params.openSenderId = data.senderId;
        if (data.senderName) params.openSenderName = data.senderName;
        if (data.tab) params.openTab = data.tab;
        if (isSales) {
          router.push({ pathname: '/(sales)/chat', params } as any);
        } else {
          router.push({ pathname: '/(tabs)/chat', params } as any);
        }
      } else if (screen === 'callbacks') {
        if (isSales) {
          router.push('/(sales)/callbacks' as any);
        } else {
          router.push('/(tabs)/admin-callbacks' as any);
        }
      } else if (screen === 'portal-inbox') {
        const params: Record<string, string> = {};
        if (data.customerId) params.openCustomerId = data.customerId;
        router.push({ pathname: '/(tabs)/admin-communications', params } as any);
      } else if (screen === 'payments') {
        router.push('/(tabs)/admin-finance' as any);
      } else if (screen === 'schedule') {
        if (data.jobId) {
          router.push({ pathname: '/(tabs)/admin-schedule', params: { highlightBookingId: data.jobId } } as any);
        } else {
          router.push('/(tabs)/admin-schedule' as any);
        }
      }
    };
    const sub = Notifications.addNotificationResponseReceivedListener(handleRoleNotificationTap);
    // Also handle cold-start taps
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleRoleNotificationTap(response);
        Notifications.clearLastNotificationResponseAsync();
      }
    });
    return () => sub.remove();
  }, [employee?.role]);
  return null;
}

export default function RootLayout() {
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;

  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);

  // Initialize Manus runtime for cookie injection from parent container
  useEffect(() => {
    initManusRuntime();
  }, []);

  const router = useRouter();

  // Handle deep links — intercept reset-password URLs and navigate to the correct screen
  // This is needed because Expo Router on web/native can't render custom scheme URLs directly
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const handleUrl = (event: { url: string }) => {
      const url = event.url;
      if (!url) return;
      try {
        const parsed = Linking.parse(url);
        // manus20260331174054://reset-password?token=xxx
        if (parsed.path === 'reset-password' && parsed.queryParams?.token) {
          router.push({ pathname: '/reset-password', params: { token: String(parsed.queryParams.token) } } as any);
        }
      } catch (e) {
        // ignore parse errors
      }
    };
    // Handle URL when app is already open (foreground)
    const sub = Linking.addEventListener('url', handleUrl);
    // Handle cold-start URL (app opened from deep link)
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });
    return () => sub.remove();
  }, [router]);

  // Initialize notifications
  useEffect(() => {
    // Set notification handler
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    // Request permissions on native platforms
    if ((Platform.OS as string) !== "web") {
      (async () => {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== "granted") {
          await Notifications.requestPermissionsAsync();
        }
        // Clear the app icon badge count on launch
        await Notifications.setBadgeCountAsync(0);
      })();
    }

    // Notification routing is handled by NotificationRouter (inside AuthProvider)
    // which has access to employee role for role-aware deep linking.
    // No duplicate listener needed here.
  }, []);

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setInsets(metrics.insets);
    setFrame(metrics.frame);
  }, []);

  useEffect(() => {
    if ((Platform.OS as string) !== "web") return;
    const unsubscribe = subscribeSafeAreaInsets(handleSafeAreaUpdate);
    return () => unsubscribe();
  }, [handleSafeAreaUpdate]);

  // Create clients once and reuse them
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Disable automatic refetching on window focus for mobile
            refetchOnWindowFocus: false,
            // Retry failed requests 3 times before showing empty data
            retry: 3,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
            // Consider data fresh for 30 seconds — ensures screens refresh quickly
            staleTime: 30 * 1000,
            // Keep cached data in memory for 1 hour
            gcTime: 60 * 60 * 1000,
            // Refetch when network reconnects (important for mobile)
            refetchOnReconnect: true,
            // Show cached data immediately while refetching in background
            placeholderData: (prev: any) => prev,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => createTRPCClient());

  // ── Auto cache-bust: silently clear stale job cache when server version changes ──
  // The server exposes /api/cache-version. We store the last-seen version in AsyncStorage.
  // On startup and every time the app comes to the foreground, we check the server version.
  // If it changed, we wipe the schedule job caches and invalidate all TanStack Query data
  // so every device gets fresh data automatically — no logout required.
  const CACHE_VERSION_KEY = "tlw_cache_version";
  const SCHEDULE_CACHE_PREFIX = "tlw_schedule_jobs_v9";
  const checkAndBustCache = useCallback(async () => {
    try {
      const apiBase = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:3000";
      const res = await fetch(`${apiBase}/api/cache-version`, { cache: "no-store" });
      if (!res.ok) return;
      const { version } = await res.json();
      const stored = await AsyncStorage.getItem(CACHE_VERSION_KEY);
      if (stored === version) return; // nothing changed
      // Version bumped — clear all schedule job caches for all employees
      const allKeys = await AsyncStorage.getAllKeys();
      const jobCacheKeys = allKeys.filter((k) => k.startsWith(SCHEDULE_CACHE_PREFIX));
      if (jobCacheKeys.length > 0) {
        await AsyncStorage.multiRemove(jobCacheKeys);
      }
      // Also clear legacy v8 key
      await AsyncStorage.removeItem("tlw_schedule_jobs_v8").catch(() => {});
      // Wipe TanStack Query in-memory cache so all screens re-fetch
      queryClient.clear();
      // Save new version so we don't clear again until next bump
      await AsyncStorage.setItem(CACHE_VERSION_KEY, version);
    } catch {
      // Fail silently — offline or server unreachable
    }
  }, [queryClient]);

  // Run cache check on mount
  useEffect(() => {
    if (Platform.OS === "web") return;
    checkAndBustCache();
  }, [checkAndBustCache]);

  // Refetch all active queries when app comes back to foreground (e.g. after lunch break)
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const wasBackground = appStateRef.current === "background" || appStateRef.current === "inactive";
      const isNowActive = nextState === "active";
      if (wasBackground && isNowActive) {
        // Check for cache version bump first, then refetch stale queries
        checkAndBustCache().then(() => queryClient.invalidateQueries());
        // Clear the app icon badge whenever the user opens the app
        Notifications.setBadgeCountAsync(0);
      }
      appStateRef.current = nextState;
    });
    return () => subscription.remove();
  }, [queryClient, checkAndBustCache]);

  // Ensure minimum 8px padding for top and bottom on mobile
  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? { insets: initialInsets, frame: initialFrame };
    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 16),
        bottom: Math.max(metrics.insets.bottom, 12),
      },
    };
  }, [initialInsets, initialFrame]);

  const content = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {/* Default to hiding native headers so raw route segments don't appear (e.g. "(tabs)", "products/[id]"). */}
          {/* If a screen needs the native header, explicitly enable it and set a human title via Stack.Screen options. */}
          {/* in order for ios apps tab switching to work properly, use presentation: "fullScreenModal" for login page, whenever you decide to use presentation: "modal*/}
          <AuthProvider>
          <InvestorAuthProvider>
          <CustomerProvider>
            <NotificationRouter />
            <CustomerNotificationRouter />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="(customer)" options={{ presentation: "card", gestureEnabled: false }} />
              <Stack.Screen name="login" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
              <Stack.Screen name="investor-pitch" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="investor-login" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="investor-inquiry" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="(investor)" options={{ presentation: "card", gestureEnabled: false }} />
              <Stack.Screen name="signup" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="reset-password" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="oauth/callback" />
            </Stack>
          </CustomerProvider>
          </InvestorAuthProvider>
          </AuthProvider>
          <StatusBar style="auto" />
        </QueryClientProvider>
      </trpc.Provider>
    </GestureHandlerRootView>
  );

  const shouldOverrideSafeArea = Platform.OS === "web";

  if (shouldOverrideSafeArea) {
    return (
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>
          <SafeAreaFrameContext.Provider value={frame}>
            <SafeAreaInsetsContext.Provider value={insets}>
              {content}
            </SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  return (
    <LocationProvider>
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>{content}</SafeAreaProvider>
      </ThemeProvider>
    </LocationProvider>
  );
}
