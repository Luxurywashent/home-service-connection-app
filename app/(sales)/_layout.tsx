import { Tabs, useRouter } from "expo-router";
import { View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useEffect } from "react";
import { TopNavMenu } from "@/components/ui/top-nav-menu";
import { useEmployeePush } from "@/hooks/use-employee-push";

export default function SalesLayout() {
  const colors = useColors();
  const { isAuthenticated, loading } = useEmployeeAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [loading, isAuthenticated]);

  useEmployeePush();

  if (loading || !isAuthenticated) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopNavMenu />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: "none" },
        }}
      >
        <Tabs.Screen name="dashboard" />
        <Tabs.Screen name="book" />
        <Tabs.Screen name="callbacks" />
        <Tabs.Screen name="customers" />
        <Tabs.Screen name="log-entry" />
        <Tabs.Screen name="dh-history" />
        <Tabs.Screen name="dh-map" />
        <Tabs.Screen name="timesheet" />
        <Tabs.Screen name="request-off" options={{ href: null }} />
        <Tabs.Screen name="chat" />
        <Tabs.Screen name="training" />
        <Tabs.Screen name="profile" />
        <Tabs.Screen name="notifications" />
        {/* Stack-only screens — hidden from nav */}
        <Tabs.Screen name="door-hangers" options={{ href: null }} />
        <Tabs.Screen name="callback-detail" options={{ href: null }} />
        <Tabs.Screen name="schedule-callback" options={{ href: null }} />
      </Tabs>
    </View>
  );
}
