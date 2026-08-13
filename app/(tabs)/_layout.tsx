import { Tabs, useRouter } from "expo-router";
import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Platform, View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { getNativeEmployeeSession, useJobSyncAuth } from "@/lib/jobsync-auth-context";
import { useEffect, useMemo } from "react";
import { TopNavMenu } from "@/components/ui/top-nav-menu";
import { trpc } from "@/lib/trpc";
import { startGeofencing, stopGeofencing } from "@/lib/geofence-task";

function InboxTabIcon({ color }: { color: string }) {
  const { data } = trpc.portalInbox.unreadCount.useQuery(undefined, { refetchInterval: 30000 });
  const count = data?.count ?? 0;
  return (
    <View>
      <IconSymbol size={24} name="message.fill" color={color} />
      {count > 0 && (
        <View style={adminStyles.badge}>
          <Text style={adminStyles.badgeText}>{count > 99 ? "99+" : count}</Text>
        </View>
      )}
    </View>
  );
}

const adminStyles = StyleSheet.create({
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

export default function TabLayout() {
  const colors = useColors();
  const { employee, isAuthenticated, isAdmin, isOpsManager, loading, login: establishNativeRole } = useEmployeeAuth();
  const { session: jobSyncSession, isLoading: jobSyncLoading } = useJobSyncAuth();
  const router = useRouter();
  const employeeId = employee?.employeeId;
  const employeeName = employee?.fullName ?? "";
  const nativeJobSyncEmployee = useMemo(
    () => jobSyncSession ? getNativeEmployeeSession(jobSyncSession) : null,
    [jobSyncSession],
  );
  const hasMatchingCompanySession = Boolean(
    nativeJobSyncEmployee &&
    employee?.sessionSource === "jobsync" &&
    employee.employeeId === nativeJobSyncEmployee.employeeId &&
    employee.companyId === nativeJobSyncEmployee.companyId,
  );

  useEffect(() => {
    if (!nativeJobSyncEmployee || hasMatchingCompanySession) return;
    establishNativeRole(nativeJobSyncEmployee, true).catch(() => {});
  }, [establishNativeRole, hasMatchingCompanySession, nativeJobSyncEmployee]);

  useEffect(() => {
    if (loading || jobSyncLoading) return;
    if (jobSyncSession?.portal === "platform") {
      router.replace("/platform-dashboard");
      return;
    }
    if (!nativeJobSyncEmployee) router.replace("/login");
  }, [jobSyncLoading, jobSyncSession?.portal, loading, nativeJobSyncEmployee, router]);

  // Auto-start geofencing for detailers when they log in
  const zonesQuery = trpc.geofence.listZones.useQuery(undefined, {
    enabled: !!employee && !isAdmin && Platform.OS !== "web",
    staleTime: 5 * 60 * 1000,
  });
  useEffect(() => {
    if (!employeeId || isAdmin || Platform.OS === "web") return;
    const zones = (zonesQuery.data ?? []) as any[];
    const activeZones = zones.filter((z: any) => z.isActive === 1 && z.latitude && z.longitude);
    if (activeZones.length === 0) return;
    startGeofencing(
      activeZones.map((z: any) => ({
        zoneId: z.zoneId,
        name: z.name,
        latitude: z.latitude,
        longitude: z.longitude,
        radiusMeters: z.radiusMeters ?? 402,
      })),
      employeeId,
      employeeName,
    );
    return () => { stopGeofencing(); };
  }, [employeeId, employeeName, isAdmin, zonesQuery.data]);

  if (loading || jobSyncLoading || !isAuthenticated || !hasMatchingCompanySession) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopNavMenu />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.primary,
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarStyle: {
            display: "none", // Hide bottom tab bar - using top navigation instead
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "600",
          },
        }}
      >
        {/* Detailer Tabs */}
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="chart.bar.fill" color={color} />,
            href: isAdmin ? null : "/(tabs)",
          }}
        />
        <Tabs.Screen
          name="schedule"
          options={{
            title: "Schedule",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="calendar.badge.clock" color={color} />,
            href: isAdmin ? null : "/(tabs)/schedule",
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{
            title: "Team Chat",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="message.fill" color={color} />,
            href: "/(tabs)/chat",
          }}
        />
        <Tabs.Screen
          name="notifications"
          options={{
            title: "Alerts",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="bell.fill" color={color} />,
            href: isAdmin ? null : "/(tabs)/notifications",
          }}
        />
        <Tabs.Screen
          name="payroll"
          options={{
            title: "Payroll",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="dollarsign.circle.fill" color={color} />,
            href: isAdmin ? null : "/(tabs)/payroll",
          }}
        />
        <Tabs.Screen
          name="training"
          options={{
            title: "Training",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="book.fill" color={color} />,
            href: isAdmin ? null : "/(tabs)/training" as any,
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: "History",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="clock.fill" color={color} />,
            href: isAdmin ? null : "/(tabs)/history",
          }}
        />
        <Tabs.Screen
          name="request-off"
          options={{
            title: "Request Off",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="calendar.badge.clock" color={color} />,
            href: (isAdmin || isOpsManager) ? null : "/(tabs)/request-off",
          }}
        />
        <Tabs.Screen
          name="repair-request"
          options={{
            title: "Repairs",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="wrench.fill" color={color} />,
            href: isAdmin ? null : "/(tabs)/repair-request",
          }}
        />
        <Tabs.Screen
          name="expenses"
          options={{
            title: "Expenses",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="creditcard.fill" color={color} />,
            href: isAdmin ? null : "/(tabs)/expenses",
          }}
        />
        <Tabs.Screen
          name="door-hangers"
          options={{
            title: "Door Hangers",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="tag.fill" color={color} />,
            href: isAdmin ? null : "/(tabs)/door-hangers",
          }}
        />
        <Tabs.Screen
          name="detailer-referral"
          options={{
            title: "Referrals",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="person.badge.plus" color={color} />,
            href: employee?.role === "detailer" ? "/(tabs)/detailer-referral" : null,
          }}
        />
        <Tabs.Screen
          name="admin-repair-equipment"
          options={{
            title: "Equipment List",
            href: null,
          }}
        />
        <Tabs.Screen
          name="admin-repair-history"
          options={{
            title: "Repair Log",
            href: null,
          }}
        />
        <Tabs.Screen
          name="admin-van-assignments"
          options={{
            title: "Van Assignments",
            href: null,
          }}
        />
        <Tabs.Screen
          name="timesheet"
          options={{
            title: "Timesheet",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="clock.fill" color={color} />,
            href: (isAdmin || isOpsManager) ? null : "/(tabs)/timesheet",
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="person.fill" color={color} />,
            href: isAdmin ? null : "/(tabs)/profile",
          }}
        />

        {/* Admin Tabs */}
        <Tabs.Screen
          name="admin-dashboard"
          options={{
            title: "Team",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="chart.bar.fill" color={color} />,
            href: isAdmin ? "/(tabs)/admin-dashboard" : null,
          }}
        />
        <Tabs.Screen
          name="admin-alerts"
          options={{
            title: "Alerts",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="bell.fill" color={color} />,
            href: isAdmin ? "/(tabs)/admin-alerts" : null,
          }}
        />
        <Tabs.Screen
          name="admin-employees"
          options={{
            title: "Team",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="person.2.fill" color={color} />,
            href: isAdmin ? "/(tabs)/admin-employees" : null,
          }}
        />
        <Tabs.Screen
          name="admin-points"
          options={{
            title: "Points",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="star.fill" color={color} />,
            href: isAdmin ? "/(tabs)/admin-points" : null,
          }}
        />
        <Tabs.Screen
          name="admin-entry"
          options={{
            title: "Log Data",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="square.and.pencil" color={color} />,
            href: null, // Removed: auto-efficiency from schedule jobs replaces manual data entry
          }}
        />
        <Tabs.Screen
          name="admin-quiz"
          options={{
            title: "Bonus",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="book.fill" color={color} />,
            href: isAdmin ? "/(tabs)/admin-quiz" : null,
          }}
        />
        <Tabs.Screen
          name="admin-timeoff"
          options={{
            title: "Time Off",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="calendar.badge.clock" color={color} />,
            href: (isAdmin || isOpsManager) ? "/(tabs)/admin-timeoff" : null,
          }}
        />
        <Tabs.Screen
          name="admin-door-hangers"
          options={{
            title: "Door Hangers",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="house.fill" color={color} />,
            href: isAdmin ? "/(tabs)/admin-door-hangers" : null,
          }}
        />
        <Tabs.Screen
          name="admin-training"
          options={{
            title: "Training",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="book.fill" color={color} />,
            href: isAdmin ? "/(tabs)/admin-training" : null,
          }}
        />
        <Tabs.Screen
          name="admin-leaderboard"
          options={{
            title: "Leaderboard",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="trophy.fill" color={color} />,
            href: isAdmin ? "/(tabs)/admin-leaderboard" : null,
          }}
        />
        <Tabs.Screen
          name="admin-unpaid-jobs"
          options={{
            title: "Unpaid",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name={"exclamationmark.dollar" as any} color={color} />,
            href: isAdmin ? "/(tabs)/admin-unpaid-jobs" : null,
          }}
        />
        <Tabs.Screen
          name="admin-timesheet"
          options={{
            title: "Timesheet",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="clock.fill" color={color} />,
            href: null,
          }}
        />
        <Tabs.Screen
          name="sales-team"
          options={{
            title: "Sales",
            href: null, // Removed: sales reps use /(sales) layout instead
          }}
        />

        <Tabs.Screen
          name="admin-schedule"
          options={{
            title: "Schedule",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="calendar.badge.clock" color={color} />,
            href: isAdmin ? ("/(tabs)/admin-schedule" as any) : null,
          }}
        />
        <Tabs.Screen
          name="admin-callbacks"
          options={{
            title: "Sales Calls",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="phone.fill" color={color} />,
            href: isAdmin ? ("/(tabs)/admin-callbacks" as any) : null,
          }}
        />
        <Tabs.Screen
          name="admin-fleet-map"
          options={{
            title: "Fleet Map",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="map.fill" color={color} />,
            href: isAdmin ? ("/(tabs)/admin-fleet-map" as any) : null,
          }}
        />
        <Tabs.Screen
          name="admin-ai-coach"
          options={{
            title: "AI Coach",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="sparkles" color={color} />,
            href: isAdmin ? ("/(tabs)/admin-ai-coach" as any) : null,
          }}
        />
        <Tabs.Screen
          name="admin-receptionist"
          options={{
            title: "Receptionist",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="phone.fill" color={color} />,
            href: isAdmin ? ("/(tabs)/admin-receptionist" as any) : null,
          }}
        />
        <Tabs.Screen
          name="admin-chat"
          options={{
            title: "Team Chat",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="message.fill" color={color} />,
            href: isAdmin ? ("/(tabs)/admin-chat" as any) : null,
          }}
        />
        <Tabs.Screen
          name="admin-customers"
          options={{
            title: "Customers",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="person.2.fill" color={color} />,
            href: (isAdmin || isOpsManager) ? ("/(tabs)/admin-customers" as any) : null,
          }}
        />
        <Tabs.Screen
          name="admin-customer-profile"
          options={{
            title: "Customer Profile",
            href: null,
          }}
        />
        <Tabs.Screen
          name="admin-inventory"
          options={{
            title: "Inventory",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="archivebox.fill" color={color} />,
            href: isAdmin ? ("/(tabs)/admin-inventory" as any) : null,
          }}
        />
        <Tabs.Screen
          name="admin-finance"
          options={{
            title: "Finance",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="dollarsign.circle.fill" color={color} />,
            href: isAdmin ? ("/(tabs)/admin-finance" as any) : null,
          }}
        />
        {/* Phase C: Booking Pipeline */}
        <Tabs.Screen
          name="admin-pipeline"
          options={{
            title: "Pipeline",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="list.bullet.rectangle.fill" color={color} />,
            href: isAdmin ? ("/(tabs)/admin-pipeline" as any) : null,
          }}
        />
        <Tabs.Screen
          name="admin-communications"
          options={{
            title: "Inbox",
            tabBarIcon: ({ color }) => <InboxTabIcon color={color} />,
            href: isAdmin ? ("/(tabs)/admin-communications" as any) : null,
          }}
        />
        {/* Geofence & EOD Checklist */}
        <Tabs.Screen
          name="admin-geofence"
          options={{
            title: "Geofence",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="location.fill" color={color} />,
            href: isAdmin ? ("/(tabs)/admin-geofence" as any) : null,
          }}
        />
        <Tabs.Screen
          name="admin-eod-review"
          options={{
            title: "EOD Review",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="checkmark.circle.fill" color={color} />,
            href: isAdmin ? ("/(tabs)/admin-eod-review" as any) : null,
          }}
        />
        <Tabs.Screen
          name="eod-checklist"
          options={{
            title: "EOD Check",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="checkmark.circle.fill" color={color} />,
            href: !isAdmin ? ("/(tabs)/eod-checklist" as any) : null,
          }}
        />
        {/* Ops Manager Screens */}
        <Tabs.Screen
          name="ops-dashboard"
          options={{
            title: "Dashboard",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="chart.bar.fill" color={color} />,
            href: isOpsManager ? ("/(tabs)/ops-dashboard" as any) : null,
          }}
        />
        <Tabs.Screen
          name="ops-punctuality"
          options={{
            title: "Punctuality",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="clock.fill" color={color} />,
            href: isOpsManager ? ("/(tabs)/ops-punctuality" as any) : null,
          }}
        />
        <Tabs.Screen
          name="ops-inspection"
          options={{
            title: "Site Inspect",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="checkmark.seal.fill" color={color} />,
            href: isOpsManager ? ("/(tabs)/ops-inspection" as any) : null,
          }}
        />
        <Tabs.Screen
          name="ops-van-checklist"
          options={{
            title: "Van Checklist",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="car.fill" color={color} />,
            href: isOpsManager ? ("/(tabs)/ops-van-checklist" as any) : null,
          }}
        />
        <Tabs.Screen
          name="ops-qc"
          options={{
            title: "QC",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name={"clipboard.list.fill" as any} color={color} />,
            href: (isAdmin || isOpsManager) ? ("/(tabs)/ops-qc" as any) : null,
          }}
        />
        <Tabs.Screen
          name="ops-door-hangers"
          options={{
            title: "Door Hangers",
            tabBarIcon: ({ color }) => <IconSymbol size={24} name="tag.fill" color={color} />,
            href: isOpsManager ? ("/(tabs)/ops-door-hangers" as any) : null,
          }}
        />
        {/* Admin Locations */}
        <Tabs.Screen
          name="admin-locations"
          options={{
            title: "Locations",
            href: null,
          }}
        />
        <Tabs.Screen
          name="admin-rewards"
          options={{
            title: "Rewards",
            href: isAdmin ? ("/(tabs)/admin-rewards" as any) : null,
          }}
        />
        <Tabs.Screen
          name="admin-reporting"
          options={{
            title: "Reporting",
            href: isAdmin ? ("/(tabs)/admin-reporting" as any) : null,
          }}
        />
        <Tabs.Screen
          name="admin-efficiency"
          options={{
            title: "Efficiency",
            href: isAdmin ? ("/(tabs)/admin-efficiency" as any) : null,
          }}
        />
        <Tabs.Screen
          name="admin-inspections"
          options={{
            title: "Inspections",
            href: isAdmin ? ("/(tabs)/admin-inspections" as any) : null,
          }}
        />
        <Tabs.Screen
          name="admin-pricebook"
          options={{
            title: "Price Book",
            href: isAdmin ? ("/(tabs)/admin-pricebook" as any) : null,
          }}
        />
        {/* Investor Portal Screens */}
        <Tabs.Screen
          name="admin-investor-inquiries"
          options={{
            title: "Inquiries",
            href: isAdmin ? ("/(tabs)/admin-investor-inquiries" as any) : null,
          }}
        />
        <Tabs.Screen
          name="admin-package-images"
          options={{
            title: "Package Images",
            href: isAdmin ? ("/(tabs)/admin-package-images" as any) : null,
          }}
        />
      </Tabs>
    </View>
  );
}
