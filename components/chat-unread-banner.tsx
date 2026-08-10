/**
 * ChatUnreadBanner
 *
 * A slim, persistent banner that appears below the top navigation bar whenever
 * the logged-in employee has unread chat messages. It polls every 30 seconds
 * and disappears automatically when the count drops to zero.
 *
 * Tapping the banner navigates directly to the Chat screen.
 */
import React, { useCallback } from "react";
import { Pressable, Text, View, StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useColors } from "@/hooks/use-colors";

export function ChatUnreadBanner() {
  const { employee } = useEmployeeAuth();
  const colors = useColors();
  const router = useRouter();

  const utils = trpc.useUtils();

  const unreadQuery = trpc.chat.getUnreadCount.useQuery(
    { employeeId: employee?.employeeId ?? "" },
    {
      enabled: !!employee?.employeeId,
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
      staleTime: 5_000,
    },
  );

  const data = unreadQuery.data;
  const total = data?.total ?? 0;

  const handlePress = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push("/chat" as any);
    // Refetch after a short delay so the banner clears once chat marks messages as seen
    setTimeout(() => {
      if (employee?.employeeId) {
        utils.chat.getUnreadCount.invalidate({ employeeId: employee.employeeId });
      }
    }, 2000);
  }, [router, utils, employee]);

  if (!employee || total === 0) return null;

  // Build a short label describing what's unread
  const parts: string[] = [];
  if (data?.hasDm) parts.push("DM");
  if (data?.hasGroup) parts.push("group");
  if (data?.hasCommunity) parts.push("community");
  const typeLabel = parts.length > 0 ? ` in ${parts.join(", ")}` : "";
  const countLabel = total === 1 ? "1 unread message" : `${total} unread messages`;

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.banner,
        { backgroundColor: "#0057FF", opacity: pressed ? 0.85 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${countLabel}${typeLabel}. Tap to open chat.`}
    >
      <View style={styles.inner}>
        <Text style={styles.icon}>💬</Text>
        <Text style={styles.text} numberOfLines={1}>
          {countLabel}{typeLabel} — tap to view
        </Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{total > 99 ? "99+" : total}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    width: "100%",
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  icon: {
    fontSize: 14,
  },
  text: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
    letterSpacing: 0.1,
  },
  badge: {
    backgroundColor: "#fff",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0057FF",
  },
});
