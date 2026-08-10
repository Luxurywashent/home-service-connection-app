import React from "react";
import {
  View, Text, FlatList, TouchableOpacity, Alert, ActivityIndicator,
  RefreshControl, ScrollView, Pressable, SafeAreaView, Modal,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PhotoLogger from "@/components/door-hanger/photo-logger";
import History from "@/components/door-hanger/history";
import MapView from "@/components/door-hanger/map-view";

type CallbackStatus = "scheduled" | "completed" | "missed" | "cancelled" | "rescheduled";
type FilterType = "all" | "upcoming" | "completed" | "missed";
type ViewType = "callbacks" | "door-hangers";

const STATUS_CONFIG: Record<CallbackStatus, { label: string; color: string; bg: string }> = {
  scheduled:   { label: "Scheduled",   color: "#1D4ED8", bg: "#DBEAFE" },
  completed:   { label: "Completed",   color: "#15803D", bg: "#DCFCE7" },
  missed:      { label: "Missed",      color: "#B91C1C", bg: "#FEE2E2" },
  cancelled:   { label: "Cancelled",   color: "#6B7280", bg: "#F3F4F6" },
  rescheduled: { label: "Rescheduled", color: "#92400E", bg: "#FEF3C7" },
};

interface Stats {
  doorHangers: number;
  businessCards: number;
  yardSigns: number;
  tableToppers: number;
  totalEntries: number;
}

interface Goals {
  dailyDoorHangerGoal?: number;
  dailyBusinessCardGoal?: number;
  dailyYardSignGoal?: number;
  dailyTableTopperGoal?: number;
}

function formatCallbackTime(isoString: string, timezone: string): string {
  try {
    const dt = new Date(isoString);
    if (isNaN(dt.getTime())) return "Unknown time";
    return dt.toLocaleString("en-US", {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
      timeZone: timezone,
    });
  } catch {
    return isoString;
  }
}

function isPast(isoString: string): boolean {
  try {
    return new Date(isoString) < new Date();
  } catch {
    return false;
  }
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function SalesTeamTab() {
  const colors = useColors();
  const router = useRouter();
  const { employee, logout, isSalesRep, isDoorHangerRep } = useEmployeeAuth();
  const insets = useSafeAreaInsets();
  const [activeView, setActiveView] = React.useState<ViewType>("callbacks");
  const [refreshing, setRefreshing] = React.useState(false);
  const [filter, setFilter] = React.useState<FilterType>("all");
  const [doorHangerStats, setDoorHangerStats] = React.useState<Stats | null>(null);
  const [doorHangerGoals, setDoorHangerGoals] = React.useState<Goals | null>(null);
  const [isLoadingDoorHanger, setIsLoadingDoorHanger] = React.useState(true);
  const [showDoorHangerModal, setShowDoorHangerModal] = React.useState(false);
  const [doorHangerModalTab, setDoorHangerModalTab] = React.useState<"log" | "history" | "map">("log");

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => { logout(); router.replace("/login"); } },
    ]);
  };

  // Sales Callbacks Data
  const { data: callbacks = [], refetch: refetchCallbacks, isLoading: isLoadingCallbacks } = trpc.salesCallback.listMine.useQuery(
    { employeeId: employee?.employeeId ?? "" },
    { enabled: !!employee?.employeeId, refetchOnMount: true },
  );

  // Door Hanger Data
  const getStats = trpc.doorHanger.getStats.useQuery({} as any);
  const getGoals = trpc.doorHanger.getGoals.useQuery({} as any);

  // Load door hanger data
  React.useEffect(() => {
    if (getStats.data || getGoals.data || getStats.isError || getGoals.isError) {
      const defaultStats: Stats = { doorHangers: 0, businessCards: 0, yardSigns: 0, tableToppers: 0, totalEntries: 0 };
      const statsData = getStats.data as any;
      if (statsData && !statsData.tableToppers) {
        statsData.tableToppers = 0;
      }
      setDoorHangerStats(statsData || defaultStats);
      setDoorHangerGoals(getGoals.data || { dailyDoorHangerGoal: 50, dailyBusinessCardGoal: 20, dailyYardSignGoal: 2, dailyTableTopperGoal: 5 });
      setIsLoadingDoorHanger(false);
    }
  }, [getStats.data, getStats.isError, getGoals.data, getGoals.isError]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetchCallbacks();
    await getStats.refetch();
    await getGoals.refetch();
    setRefreshing(false);
  };

  // Sales filtering
  const upcoming = React.useMemo(() =>
    callbacks.filter(c => c.status === "scheduled" && !isPast(c.scheduledAt as unknown as string)),
    [callbacks]
  );
  const completed = React.useMemo(() => callbacks.filter(c => c.status === "completed"), [callbacks]);
  const missed = React.useMemo(() => callbacks.filter(c => c.status === "missed"), [callbacks]);

  const displayed = React.useMemo(() => {
    switch (filter) {
      case "upcoming": return upcoming;
      case "completed": return completed;
      case "missed": return missed;
      default: return callbacks;
    }
  }, [filter, callbacks, upcoming, completed, missed]);

  // Render Callbacks View
  const renderCallbacksView = () => (
    <View className="flex-1">
      <View className="px-4 py-3 border-b border-border">
        <Text className="text-2xl font-bold text-foreground mb-1">Scheduled Callbacks</Text>
        <Text className="text-sm text-muted">Manage your customer follow-ups</Text>
      </View>

      <View className="px-4 py-3 flex-row gap-2 border-b border-border overflow-x-auto">
        {(["all", "upcoming", "completed", "missed"] as FilterType[]).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={({ pressed }) => [
              {
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 20,
                backgroundColor: filter === f ? colors.primary : colors.surface,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text className={cn("text-sm font-semibold", filter === f ? "text-white" : "text-foreground")}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
        data={displayed}
        keyExtractor={(item) => item.id.toString()}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <View className="px-4 py-3 border-b border-border">
            <View className="flex-row justify-between items-start mb-2">
              <View className="flex-1">
                <Text className="text-lg font-semibold text-foreground">{(item as any).prospectFirstName} {(item as any).prospectLastName}</Text>
                <Text className="text-sm text-muted">{(item as any).prospectPhone || "No phone"}</Text>
              </View>
              <View
                style={{
                  backgroundColor: STATUS_CONFIG[item.status as CallbackStatus].bg,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 4,
                }}
              >
                <Text
                  style={{ color: STATUS_CONFIG[item.status as CallbackStatus].color }}
                  className="text-xs font-semibold"
                >
                  {STATUS_CONFIG[item.status as CallbackStatus].label}
                </Text>
              </View>
            </View>
            <Text className="text-sm text-muted mb-2">{(item as any).location || "Unknown location"}</Text>
            <Text className="text-xs text-muted">
              {formatCallbackTime(item.scheduledAt as unknown as string, (employee as any)?.timezone || "America/Chicago")}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <View className="flex-1 justify-center items-center py-8">
            <Text className="text-lg text-muted">No callbacks found</Text>
          </View>
        }
      />
    </View>
  );

  // Render Door Hangers View
  const renderDoorHangersView = () => {
    const doorHangerPercent = Math.min(((doorHangerStats?.doorHangers || 0) / (doorHangerGoals?.dailyDoorHangerGoal || 50)) * 100, 100);
    const businessCardPercent = Math.min(((doorHangerStats?.businessCards || 0) / (doorHangerGoals?.dailyBusinessCardGoal || 20)) * 100, 100);
    const yardSignPercent = Math.min(((doorHangerStats?.yardSigns || 0) / (doorHangerGoals?.dailyYardSignGoal || 2)) * 100, 100);
    const tableTopperPercent = Math.min(((doorHangerStats?.tableToppers || 0) / (doorHangerGoals?.dailyTableTopperGoal || 5)) * 100, 100);

    return (
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <View className="px-4 py-6 gap-6">
          <View>
            <Text className="text-2xl font-bold text-foreground mb-1">{getGreeting()}, {(employee as any)?.firstName || "Team Member"}!</Text>
            <Text className="text-base text-muted">Track your daily door hanger distribution</Text>
          </View>

          {/* Door Hangers */}
          <View className="bg-surface rounded-lg p-4 border border-border">
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-lg font-semibold text-foreground">Door Hangers</Text>
              <Text className="text-sm font-bold text-primary">{doorHangerStats?.doorHangers || 0}/{doorHangerGoals?.dailyDoorHangerGoal || 50}</Text>
            </View>
            <View className="w-full bg-border rounded-full h-2 overflow-hidden">
              <View
                style={{ width: `${doorHangerPercent}%`, backgroundColor: doorHangerPercent >= 100 ? colors.success : colors.primary }}
                className="h-full"
              />
            </View>
          </View>

          {/* Business Cards */}
          <View className="bg-surface rounded-lg p-4 border border-border">
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-lg font-semibold text-foreground">Business Cards</Text>
              <Text className="text-sm font-bold text-primary">{doorHangerStats?.businessCards || 0}/{doorHangerGoals?.dailyBusinessCardGoal || 20}</Text>
            </View>
            <View className="w-full bg-border rounded-full h-2 overflow-hidden">
              <View
                style={{ width: `${businessCardPercent}%`, backgroundColor: businessCardPercent >= 100 ? colors.success : colors.primary }}
                className="h-full"
              />
            </View>
          </View>

          {/* Yard Signs */}
          <View className="bg-surface rounded-lg p-4 border border-border">
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-lg font-semibold text-foreground">Yard Signs</Text>
              <Text className="text-sm font-bold text-primary">{doorHangerStats?.yardSigns || 0}/{doorHangerGoals?.dailyYardSignGoal || 2}</Text>
            </View>
            <View className="w-full bg-border rounded-full h-2 overflow-hidden">
              <View
                style={{ width: `${yardSignPercent}%`, backgroundColor: yardSignPercent >= 100 ? colors.success : colors.primary }}
                className="h-full"
              />
            </View>
          </View>

          {/* Table Toppers */}
          <View className="bg-surface rounded-lg p-4 border border-border">
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-lg font-semibold text-foreground">Table Toppers</Text>
              <Text className="text-sm font-bold text-primary">{doorHangerStats?.tableToppers || 0}/{doorHangerGoals?.dailyTableTopperGoal || 5}</Text>
            </View>
            <View className="w-full bg-border rounded-full h-2 overflow-hidden">
              <View
                style={{ width: `${tableTopperPercent}%`, backgroundColor: tableTopperPercent >= 100 ? colors.success : colors.primary }}
                className="h-full"
              />
            </View>
          </View>

          {/* Action Buttons */}
          <TouchableOpacity
            onPress={() => { setShowDoorHangerModal(true); setDoorHangerModalTab("log"); }}
            className="mt-4 p-4 bg-primary rounded-lg"
          >
            <Text className="text-center text-white font-semibold">+ Log Entry</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => { setShowDoorHangerModal(true); setDoorHangerModalTab("history"); }}
            className="p-4 bg-surface rounded-lg border border-border"
          >
            <Text className="text-center text-foreground font-semibold">View History</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  };

  // Render Door Hanger Modal Content
  const renderDoorHangerModalContent = () => {
    switch (doorHangerModalTab) {
      case "log":
        return <PhotoLogger />;
      case "history":
        return <History />;
      case "map":
        return <MapView />;
      default:
        return null;
    }
  };

  // Bottom menu bar height
  const bottomMenuHeight = 70 + insets.bottom;

  return (
    <ScreenContainer className="flex-1" edges={["left", "right"]}>
      <View className="flex-1">
        {activeView === "callbacks" ? renderCallbacksView() : renderDoorHangersView()}
      </View>

      {/* Bottom Menu Bar */}
      <View
        style={{
          height: bottomMenuHeight,
          paddingBottom: insets.bottom,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.background,
          flexDirection: "row",
        }}
      >
        <Pressable
          onPress={() => setActiveView("callbacks")}
          style={({ pressed }) => [
            {
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
              opacity: pressed ? 0.7 : 1,
              borderBottomWidth: activeView === "callbacks" ? 3 : 0,
              borderBottomColor: activeView === "callbacks" ? colors.primary : "transparent",
            },
          ]}
        >
          <Text className={cn("text-center font-semibold text-sm", activeView === "callbacks" ? "text-primary" : "text-muted")}>
            📞 Callbacks
          </Text>
        </Pressable>

        <View style={{ width: 1, backgroundColor: colors.border }} />

        <Pressable
          onPress={() => setActiveView("door-hangers")}
          style={({ pressed }) => [
            {
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
              opacity: pressed ? 0.7 : 1,
              borderBottomWidth: activeView === "door-hangers" ? 3 : 0,
              borderBottomColor: activeView === "door-hangers" ? colors.primary : "transparent",
            },
          ]}
        >
          <Text className={cn("text-center font-semibold text-sm", activeView === "door-hangers" ? "text-primary" : "text-muted")}>
            🏠 Door Hangers
          </Text>
        </Pressable>
      </View>

      {/* Door Hanger Modal Overlay */}
      <Modal
        visible={showDoorHangerModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowDoorHangerModal(false)}
      >
        <ScreenContainer className="flex-1" edges={["left", "right"]}>
          {/* Modal Header */}
          <View className="px-4 py-4 border-b border-border flex-row justify-between items-center">
            <Text className="text-xl font-bold text-foreground">
              {doorHangerModalTab === "log" ? "Log Items" : doorHangerModalTab === "history" ? "History" : "Map"}
            </Text>
            <TouchableOpacity onPress={() => setShowDoorHangerModal(false)} className="p-2">
              <Text className="text-2xl text-muted">✕</Text>
            </TouchableOpacity>
          </View>

          {/* Modal Content */}
          <View className="flex-1">
            {renderDoorHangerModalContent()}
          </View>

          {/* Modal Tab Navigation */}
          <View className="flex-row border-t border-border bg-surface" style={{ paddingBottom: insets.bottom }}>
            <Pressable
              onPress={() => setDoorHangerModalTab("log")}
              style={({ pressed }) => [{ flex: 1, padding: 12, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text className={cn("text-center font-semibold text-sm", doorHangerModalTab === "log" ? "text-primary" : "text-muted")}>
                📷 Log
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setDoorHangerModalTab("history")}
              style={({ pressed }) => [{ flex: 1, padding: 12, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text className={cn("text-center font-semibold text-sm", doorHangerModalTab === "history" ? "text-primary" : "text-muted")}>
                📋 History
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setDoorHangerModalTab("map")}
              style={({ pressed }) => [{ flex: 1, padding: 12, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text className={cn("text-center font-semibold text-sm", doorHangerModalTab === "map" ? "text-primary" : "text-muted")}>
                🗺️ Map
              </Text>
            </Pressable>
          </View>
        </ScreenContainer>
      </Modal>
    </ScreenContainer>
  );
}
