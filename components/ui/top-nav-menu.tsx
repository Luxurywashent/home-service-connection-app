import { Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { ChatUnreadBanner } from "@/components/chat-unread-banner";
import { JobEventBanner } from "@/components/job-event-banner";
import { useColors } from "@/hooks/use-colors";
import { useRouter, usePathname } from "expo-router";
import { useState } from "react";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import { Platform } from "react-native";
import { trpc } from "@/lib/trpc";
import { HeaderClockStatus } from "@/components/header-clock-status";

export interface TopNavMenuProps {
  onMenuToggle?: (isOpen: boolean) => void;
}

interface MenuItem {
  label: string;
  icon: string;
  route: string;
}

// ─── Admin menu — all features ────────────────────────────────────────────────
const ADMIN_ALL_ITEMS: MenuItem[] = [
  { label: "Dashboard",    icon: "👥",  route: "/admin-dashboard" },
  { label: "Schedule",     icon: "📅",  route: "/admin-schedule" },
  { label: "Fleet",        icon: "🚐",  route: "/admin-fleet-map" },
  { label: "Team Chat",    icon: "💬",  route: "/chat" },
  { label: "Timesheets",   icon: "⏱️",  route: "/admin-timesheet" },
  { label: "AI Coach",     icon: "🤖",  route: "/admin-ai-coach" },
  { label: "Finance",      icon: "💵",  route: "/admin-finance" },
  { label: "Invoices",     icon: "🧾",  route: "/admin-invoices" },
  { label: "Unpaid Jobs",  icon: "💸",  route: "/admin-unpaid-jobs" },
  { label: "Customers",    icon: "👤",  route: "/admin-customers" },
  { label: "Receptionist", icon: "📞",  route: "/admin-receptionist" },
  { label: "Sales Calls",  icon: "📱",  route: "/admin-callbacks" },
  { label: "Training",     icon: "📚",  route: "/admin-training" },
  { label: "Time Off",     icon: "🌴",  route: "/admin-timeoff" },
  { label: "Door Hangers", icon: "🚪",  route: "/admin-door-hangers" },
  { label: "Team Members", icon: "🪪",  route: "/admin-employees" },
  { label: "Inventory",    icon: "📦",  route: "/admin-inventory" },
  { label: "Bonus",        icon: "🎯",  route: "/admin-quiz" },
  { label: "Alerts",       icon: "🔔",  route: "/admin-alerts" },
  { label: "Equip. List",  icon: "🛠️",  route: "/admin-repair-equipment" },
  { label: "Repair Log",   icon: "📋",  route: "/admin-repair-history" },
  { label: "Pipeline",     icon: "📊",  route: "/admin-pipeline" },
  { label: "Inbox", icon: "📲",  route: "/admin-communications" },
  { label: "Geofence",      icon: "📡",  route: "/admin-geofence" },
  { label: "EOD Review",    icon: "✅",  route: "/admin-eod-review" },
  { label: "Locations",     icon: "📍",  route: "/admin-locations" },
  { label: "Promotions",    icon: "🎉",  route: "/admin-promotions" },
  { label: "Rewards",       icon: "🏆",  route: "/admin-rewards" },
  { label: "Reporting",     icon: "📈",  route: "/admin-reporting" },
  { label: "Price Book",    icon: "💰",  route: "/admin-pricebook" },
  { label: "Accountability", icon: "📌",  route: "/admin-points" },
  { label: "Efficiency",     icon: "⚡",  route: "/admin-efficiency" },
  { label: "QC",             icon: "✅",  route: "/ops-qc" },
];

const DETAILER_ITEMS: MenuItem[] = [
  { label: "Home",       icon: "🏠", route: "/" },
  { label: "Schedule",   icon: "📅", route: "/schedule" },
  { label: "Team Chat",  icon: "💬", route: "/chat" },
  { label: "Alerts",     icon: "🔔", route: "/notifications" },
  { label: "Payroll",    icon: "💰", route: "/payroll" },
  { label: "Training",   icon: "📚", route: "/training" },
  { label: "Repairs",    icon: "🔧", route: "/repair-request" },
  { label: "Expenses",   icon: "🧾", route: "/expenses" },
  { label: "EOD Check",  icon: "✅", route: "/eod-checklist" },
  { label: "Timesheet",  icon: "⏱️", route: "/timesheet" },
  { label: "Door Hangers", icon: "🚪", route: "/door-hangers" },
  { label: "Profile",    icon: "👤", route: "/profile" },
];

const OPS_MANAGER_ITEMS: MenuItem[] = [
  { label: "Dashboard",     icon: "📊", route: "/ops-dashboard" },
  { label: "Punctuality",   icon: "⏰", route: "/ops-punctuality" },
  { label: "Site Inspect",  icon: "🔍", route: "/ops-inspection" },
  { label: "Van Checklist", icon: "🚐", route: "/ops-van-checklist" },
  { label: "Fleet Map",     icon: "🗺️", route: "/admin-fleet-map" },
  { label: "Schedule",      icon: "📅", route: "/admin-schedule" },
  { label: "Timesheets",    icon: "⏱️", route: "/admin-timesheet" },
  { label: "Training",      icon: "📚", route: "/admin-training" },
  { label: "Door Hangers",  icon: "🚪", route: "/admin-door-hangers" },
  { label: "Customers",    icon: "👤", route: "/admin-customers" },
  { label: "Team Members",  icon: "👥", route: "/admin-employees" },
  { label: "Inventory",     icon: "📦", route: "/admin-inventory" },
  { label: "Alerts",        icon: "🔔", route: "/admin-alerts" },
  { label: "Equipment",     icon: "🔧", route: "/admin-repair-equipment" },
  { label: "Repair Log",    icon: "🛠️", route: "/admin-repair-history" },
  { label: "Inbox",         icon: "📲", route: "/admin-communications" },
  { label: "EOD",           icon: "📋", route: "/admin-eod-review" },
  { label: "Team Chat",     icon: "💬", route: "/chat" },
  { label: "Time Off",      icon: "🌴", route: "/admin-timeoff" },
  { label: "Expenses",      icon: "🧾", route: "/expenses" },
  { label: "Request Off",   icon: "📆", route: "/request-off" },
    { label: "Accountability", icon: "📌",  route: "/admin-points" },
  { label: "QC",             icon: "✅",  route: "/ops-qc" },
];
const SALES_ITEMS: MenuItem[] = [
  { label: "Dashboard",  icon: "📊", route: "/(sales)/dashboard" },
  { label: "Book",       icon: "📅", route: "/(sales)/book" },
  { label: "Callbacks",  icon: "📞", route: "/(sales)/callbacks" },
  { label: "Customers",  icon: "👤", route: "/(sales)/customers" },
  { label: "Log Entry",  icon: "📷", route: "/(sales)/log-entry" },
  { label: "DH History", icon: "🗂️", route: "/(sales)/dh-history" },
  { label: "DH Map",     icon: "🗺️", route: "/(sales)/dh-map" },
  { label: "Timesheet",  icon: "⏱️", route: "/(sales)/timesheet" },
  { label: "Team Chat",  icon: "💬", route: "/(sales)/chat" },
  { label: "Training",   icon: "📚", route: "/(sales)/training" },
  { label: "Profile",    icon: "👤", route: "/(sales)/profile" },
  { label: "Alerts",     icon: "🔔", route: "/(sales)/notifications" },
  { label: "Inbox",      icon: "📲", route: "/admin-communications" },
  { label: "Receptionist", icon: "📞", route: "/admin-receptionist" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function TopNavMenu({ onMenuToggle }: TopNavMenuProps) {
  const colors = useColors();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { logout, isAdmin, isOpsManager, isSalesRep, employee: currentEmployee } = useEmployeeAuth();
  const { logout: logoutJobSync, session: jobSyncSession } = useJobSyncAuth();
  const [isOpen, setIsOpen] = useState(false);
  const logoutMutation = trpc.auth.logout.useMutation();
  const signedInCompanyName = jobSyncSession?.portal === "company"
    ? (jobSyncSession.company?.name ?? "Home Service Connection")
    : "Home Service Connection";

  const allItems = isOpsManager ? OPS_MANAGER_ITEMS : isAdmin ? ADMIN_ALL_ITEMS : isSalesRep ? SALES_ITEMS : DETAILER_ITEMS;
  const { data: chatUnread } = trpc.chat.getUnreadCount.useQuery(
    { employeeId: currentEmployee?.employeeId ?? "" },
    { enabled: !!currentEmployee?.employeeId, refetchInterval: 15_000, staleTime: 5_000 }
  );
  const chatUnreadTotal = chatUnread?.total ?? 0;
  const { data: openRepairCount = 0 } = trpc.fleet.countOpenRepairs.useQuery(
    undefined,
    { refetchInterval: 60000 }
  );

  // Determine active route label for center display
  const currentPage = allItems.find((item) =>
    isAdmin
      ? pathname.includes(item.route.replace("/", ""))
      : pathname === item.route || pathname.startsWith(item.route + "/") || pathname.includes(item.route.replace(/^\/(sales)\//, ""))
  ) || allItems[0];

  const haptic = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const toggleMenu = () => {
    haptic();
    const next = !isOpen;
    setIsOpen(next);
    onMenuToggle?.(next);
  };

  const navigate = (route: string) => {
    haptic();
    router.push(route as any);
    setIsOpen(false);
  };

  const handleLogout = async () => {
    haptic();
    setIsOpen(false);
    try {
      await logoutMutation.mutateAsync();
    } catch (e) {
      console.warn("Legacy API logout failed; clearing device sessions anyway.", e);
    } finally {
      await Promise.allSettled([logout(), logoutJobSync()]);
      router.replace("/login");
    }
  };

  const isRouteActive = (route: string) =>
    pathname === route ||
    (route !== "/" && pathname.includes(route.replace("/", "")));

  return (
    <View style={{ backgroundColor: "#07111F" }}>
      {/* ── Top Navigation Bar ── */}
      <View
        style={{
          backgroundColor: "#07111F",
          borderBottomWidth: 1,
          borderBottomColor: "#243754",
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: 0,
          paddingHorizontal: 12,
        }}
      >
        {/* Row 1: Logo | Page Title | Clock + Menu */}
        <View style={{ flexDirection: "row", alignItems: "center", paddingBottom: 10 }}>
          {/* Logo */}
          <View style={{ minWidth: 128, maxWidth: 148 }}>
            <Text style={{ fontSize: 17, fontWeight: "900", color: "#52D3B8" }}>HSC</Text>
            <Text style={{ fontSize: 12, fontWeight: "800", color: "#C7D5EA", marginTop: 2 }} numberOfLines={1}>
              {signedInCompanyName}
            </Text>
          </View>

          {/* Current page label */}
          <Text
            style={{
              flex: 1,
              fontSize: 14,
              fontWeight: "700",
              color: "#fff",
              textAlign: "center",
            }}
            numberOfLines={1}
          >
            {currentPage?.label || ""}
          </Text>

          {/* Clock + Menu button */}
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center", minWidth: 52, justifyContent: "flex-end" }}>
            <HeaderClockStatus />
            <Pressable
              onPress={toggleMenu}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.95 : 1 }],
              })}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  backgroundColor: isOpen ? "#4D8DFF" : "#102038",
                  borderWidth: 1,
                  borderColor: isOpen ? "#4D8DFF" : "#243754",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 18, color: "#fff" }}>{isOpen ? "✕" : "☰"}</Text>
              </View>
            </Pressable>
          </View>
        </View>

        {/* ── Unread Chat Banner ── */}
        <View style={{ marginHorizontal: -12 }}>
          <ChatUnreadBanner />
        </View>

        {/* ── Job Event Banner ── */}
        <View style={{ marginHorizontal: -12 }}>
          <JobEventBanner />
        </View>
      </View>

      {/* ── Full-screen More grid modal ── */}
      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)" }}
          onPress={() => setIsOpen(false)}
        >
          <View
            style={{
              flex: 1,
              paddingTop: insets.top + 70,
              paddingBottom: insets.bottom + 20,
              paddingHorizontal: 16,
            }}
          >
            {/* Header */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <Text style={{ fontSize: 22, fontWeight: "800", color: "#fff" }}>
                {isOpsManager ? "Ops Manager" : isAdmin ? "All Features" : isSalesRep ? "Sales Menu" : "Menu"}
              </Text>
              <Pressable
                onPress={() => setIsOpen(false)}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.7 : 1,
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: "#1A1A1A",
                  borderWidth: 1,
                  borderColor: "#2A2A2A",
                  justifyContent: "center",
                  alignItems: "center",
                })}
              >
                <Text style={{ fontSize: 16, color: "#fff" }}>✕</Text>
              </Pressable>
            </View>

            {/* Grid — 4 columns */}
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {allItems.map((item) => {
                  const active = isRouteActive(item.route);
                  return (
                    <Pressable
                      key={item.route}
                      onPress={() => navigate(item.route)}
                      style={({ pressed }) => ({
                        opacity: pressed ? 0.75 : 1,
                        width: "22.5%",
                        aspectRatio: 0.9,
                      })}
                    >
                      <View
                        style={{
                          flex: 1,
                          borderRadius: 14,
                        backgroundColor: active ? "#4D8DFF" : "#102038",
                          borderWidth: 1,
                        borderColor: active ? "#4D8DFF" : "#243754",
                          justifyContent: "center",
                          alignItems: "center",
                          padding: 8,
                          gap: 5,
                          // Solid shadow for depth
                          shadowColor: "#000",
                          shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: 0.4,
                          shadowRadius: 4,
                          elevation: 4,
                        }}
                      >
                        <View style={{ position: "relative" }}>
                          <Text style={{ fontSize: 26 }}>{item.icon}</Text>
                          {(item.route === "/chat" || item.route === "/(sales)/chat") && chatUnreadTotal > 0 && (
                            <View style={{
                              position: "absolute", top: -4, right: -6,
                              backgroundColor: "#EF4444", borderRadius: 8,
                              minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
                            }}>
                              <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800" }}>{chatUnreadTotal > 99 ? "99+" : chatUnreadTotal}</Text>
                            </View>
                          )}
                          {((item.route === "/admin-fleet-map" && isAdmin) || (item.route === "/repair-request" && !isAdmin)) && openRepairCount > 0 && (
                            <View style={{
                              position: "absolute", top: -4, right: -6,
                              backgroundColor: "#EF4444", borderRadius: 8,
                              minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
                            }}>
                              <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800" }}>{openRepairCount}</Text>
                            </View>
                          )}
                        </View>
                        <Text
                          style={{
                            fontSize: 10,
                            fontWeight: "700",
                            color: active ? "#fff" : "#E5E7EB",
                            textAlign: "center",
                            lineHeight: 13,
                          }}
                          numberOfLines={2}
                        >
                          {item.label}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {/* Logout */}
              <Pressable
                onPress={handleLogout}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.7 : 1,
                  marginTop: 20,
                  borderRadius: 14,
                  backgroundColor: "#1C1C1E",
                  borderWidth: 1,
                  borderColor: "#3F1515",
                  paddingVertical: 14,
                  paddingHorizontal: 20,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                })}
              >
                <Text style={{ fontSize: 20 }}>🚪</Text>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#F87171" }}>
                  Logout
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
