import { Tabs, usePathname, useRouter } from "expo-router";
import { View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import { useEffect, useMemo } from "react";
import { TopNavMenu } from "@/components/ui/top-nav-menu";
import { useEmployeePush } from "@/hooks/use-employee-push";
import { isMobileFeatureDisabled, mobileRoleHome, resolveMobileNavigationSession } from "@/lib/technician-features";

function SalesPushRegistration() {
  useEmployeePush();
  return null;
}

export default function SalesLayout() {
  const colors = useColors();
  const { employee, isAuthenticated, loading, login: establishNativeRole } = useEmployeeAuth();
  const { session: jobSyncSession, isLoading: jobSyncLoading } = useJobSyncAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { nativeEmployee, hasMatchingCompanySession, role: currentRole, isReady, hasLegacySalesSession } =
    useMemo(() => resolveMobileNavigationSession({ employee, session: jobSyncSession, loading, jobSyncLoading, isAuthenticated, allowLegacySales: true }),
      [employee, isAuthenticated, jobSyncLoading, jobSyncSession, loading]);
  const isDisabledRoute = isMobileFeatureDisabled(currentRole, pathname, "sales");

  useEffect(() => {
    if (loading || jobSyncLoading || !nativeEmployee || hasMatchingCompanySession) return;
    establishNativeRole(nativeEmployee, true).catch(() => {});
  }, [establishNativeRole, hasMatchingCompanySession, jobSyncLoading, loading, nativeEmployee]);

  useEffect(() => {
    if (loading || jobSyncLoading) return;
    if (jobSyncSession?.portal === "platform") {
      router.replace("/platform-dashboard");
      return;
    }
    if (!nativeEmployee && !hasLegacySalesSession) router.replace("/login");
  }, [hasLegacySalesSession, jobSyncLoading, jobSyncSession?.portal, loading, nativeEmployee, router]);

  useEffect(() => {
    if (isReady && isDisabledRoute) router.replace(mobileRoleHome(currentRole));
  }, [currentRole, isDisabledRoute, isReady, router]);

  if (!isReady || isDisabledRoute) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopNavMenu />
      <SalesPushRegistration />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: "none" },
        }}
      >
        <Tabs.Screen name="dashboard" options={{ href: isMobileFeatureDisabled(currentRole, "/(sales)/dashboard") ? null : undefined }} />
        <Tabs.Screen name="book" />
        <Tabs.Screen name="callbacks" />
        <Tabs.Screen name="customers" />
        <Tabs.Screen name="log-entry" options={{ href: isMobileFeatureDisabled(currentRole, "/(sales)/log-entry") ? null : undefined }} />
        <Tabs.Screen name="dh-history" options={{ href: isMobileFeatureDisabled(currentRole, "/(sales)/dh-history") ? null : undefined }} />
        <Tabs.Screen name="dh-map" options={{ href: isMobileFeatureDisabled(currentRole, "/(sales)/dh-map") ? null : undefined }} />
        <Tabs.Screen name="timesheet" />
        <Tabs.Screen name="request-off" options={{ href: null }} />
        <Tabs.Screen name="chat" />
        <Tabs.Screen name="training" options={{ href: isMobileFeatureDisabled(currentRole, "/(sales)/training") ? null : undefined }} />
        <Tabs.Screen name="profile" />
        <Tabs.Screen name="notifications" options={{ href: isMobileFeatureDisabled(currentRole, "/(sales)/notifications") ? null : undefined }} />
        {/* Stack-only screens — hidden from nav */}
        <Tabs.Screen name="door-hangers" options={{ href: null }} />
        <Tabs.Screen name="callback-detail" options={{ href: null }} />
        <Tabs.Screen name="schedule-callback" options={{ href: null }} />
      </Tabs>
    </View>
  );
}
