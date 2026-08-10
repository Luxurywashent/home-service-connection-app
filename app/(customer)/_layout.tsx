import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform, View, Text, StyleSheet, AppState } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { trpc } from "@/lib/trpc";
import { useCustomerAuth } from "@/lib/customer-context";
import { useEffect, useRef } from "react";
import Constants from "expo-constants";

function MessageTabIcon({ color }: { color: string }) {
  const { token } = useCustomerAuth();
  const { data } = trpc.customer.unreadCount.useQuery(
    { token: token ?? "" },
    { enabled: !!token, refetchInterval: 30000 }
  );
  const count = data?.count ?? 0;
  return (
    <View>
      <IconSymbol size={26} name="message.fill" color={color} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: -4,
    right: -8,
    backgroundColor: "#EF4444",
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
});

function useCustomerActivityTracking() {
  const { customer } = useCustomerAuth();
  const startSession = trpc.customerActivity.startSession.useMutation();
  const endSession = trpc.customerActivity.endSession.useMutation();
  const sessionIdRef = useRef<string | null>(null);
  const sessionStartRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!customer?.customerId) return;
    // Start session when customer portal mounts
    const appVersion = Constants.expoConfig?.version ?? "1.0.0";
    const devicePlatform = Platform.OS;
    startSession.mutate(
      { customerId: customer.customerId, source: "portal_app", devicePlatform, appVersion },
      { onSuccess: (data) => { sessionIdRef.current = data.sessionId; sessionStartRef.current = Date.now(); } }
    );

    // End session when app goes to background
    const sub = AppState.addEventListener("change", (state) => {
      if ((state === "background" || state === "inactive") && sessionIdRef.current) {
        const durationSeconds = Math.round((Date.now() - sessionStartRef.current) / 1000);
        endSession.mutate({ sessionId: sessionIdRef.current, durationSeconds });
        sessionIdRef.current = null;
      } else if (state === "active" && customer?.customerId) {
        // New session when app comes back to foreground
        startSession.mutate(
          { customerId: customer.customerId, source: "portal_app", devicePlatform, appVersion },
          { onSuccess: (data) => { sessionIdRef.current = data.sessionId; sessionStartRef.current = Date.now(); } }
        );
      }
    });

    return () => {
      sub.remove();
      // End session on unmount
      if (sessionIdRef.current) {
        const durationSeconds = Math.round((Date.now() - sessionStartRef.current) / 1000);
        endSession.mutate({ sessionId: sessionIdRef.current, durationSeconds });
      }
    };
  }, [customer?.customerId]);
}

export default function CustomerTabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { token } = useCustomerAuth();
  const isGuest = !token;
  // Android (edge-to-edge): insets.bottom = nav bar height, add 8px extra breathing room.
  // iOS: let the system manage height naturally — only set paddingBottom to the safe area inset.
  // Web: fixed small padding.
  const androidBottomPadding = Math.max(insets.bottom + 8, 24);
  const tabBarStyle = Platform.OS === "android"
    ? {
        paddingTop: 8,
        paddingBottom: androidBottomPadding,
        height: 56 + androidBottomPadding,
        backgroundColor: "#0A0A0A",
        borderTopColor: "#1E3A5F",
        borderTopWidth: 1,
      }
    : Platform.OS === "ios"
    ? {
        paddingTop: 8,
        backgroundColor: "#0A0A0A",
        borderTopColor: "#1E3A5F",
        borderTopWidth: 1,
      }
    : {
        paddingTop: 8,
        paddingBottom: 12,
        backgroundColor: "#0A0A0A",
        borderTopColor: "#1E3A5F",
        borderTopWidth: 1,
      };
  useCustomerActivityTracking();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#0057FF",
        tabBarInactiveTintColor: "#6B7280",
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: "Bookings",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarIcon: ({ color }) => <MessageTabIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="vip"
        options={{
          title: "VIP",
          tabBarLabel: ({ focused }) => (
            <Text style={{ fontSize: 11, fontWeight: focused ? "800" : "600", color: focused ? "#F5C518" : "#C9A227", marginTop: -2 }}>VIP</Text>
          ),
          tabBarIcon: ({ focused }) => (
            <View style={focused ? {
              backgroundColor: "rgba(245,197,24,0.15)",
              borderRadius: 14,
              padding: 4,
              marginTop: -2,
            } : { padding: 4, marginTop: -2 }}>
              <IconSymbol size={26} name="star.fill" color={focused ? "#F5C518" : "#C9A227"} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={isGuest ? {
          href: null,
          tabBarItemStyle: { display: "none", width: 0, height: 0, overflow: "hidden" },
        } : {
          title: "Profile",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="person.fill" color={color} />,
        }}
      />
      {/* Hide the book sub-folder from appearing as a tab */}
      <Tabs.Screen
        name="book"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
      {/* Hide the job detail sub-folder from appearing as a tab */}
      <Tabs.Screen
        name="job"
        options={{
          href: null,
          tabBarItemStyle: { display: "none", width: 0, height: 0, overflow: "hidden" },
        }}
      />
      {/* Hide the tracking screen from appearing as a tab */}
      <Tabs.Screen
        name="track"
        options={{
          href: null,
        }}
      />
      {/* Hide the review screen from appearing as a tab */}
      <Tabs.Screen
        name="review"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
