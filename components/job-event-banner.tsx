/**
 * JobEventBanner
 *
 * A slim, persistent banner that appears below the top navigation bar whenever
 * there are unseen job events (created, cancelled, rescheduled).
 * Polls every 30 seconds and disappears automatically when all events are seen.
 *
 * Tapping navigates to the Schedule screen and marks all events as seen.
 */
import React, { useCallback } from "react";
import { Pressable, Text, View, StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";

export function JobEventBanner() {
  const { employee } = useEmployeeAuth();
  const router = useRouter();
  const utils = trpc.useUtils();

  const { data: unseenEvents, refetch } = trpc.jobs.getUnseenEvents.useQuery(
    { employeeId: employee?.employeeId ?? "" },
    {
      enabled: !!employee?.employeeId,
      refetchInterval: 60_000,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      gcTime: 60_000,
    }
  );

  const markSeenMutation = trpc.jobs.markEventsSeen.useMutation({
    onSuccess: () => {
      refetch();
      utils.jobs.getUnseenEvents.invalidate({ employeeId: employee?.employeeId ?? "" });
    },
  });

  const unseenCount = unseenEvents?.length ?? 0;
  const latestEvent = unseenEvents?.[0];

  const handlePress = useCallback(() => {
    if (!employee?.employeeId || !unseenEvents?.length) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    markSeenMutation.mutate({
      employeeId: employee.employeeId,
      eventIds: unseenEvents.map((e: any) => e.id),
    });
    if (unseenCount === 1 && latestEvent?.jobId) {
      // Single job — deep link directly to that job's detail
      router.push({ pathname: '/(tabs)/schedule', params: { highlightJobId: latestEvent.jobId } } as any);
    } else {
      // Multiple jobs — open schedule so detailer can see all their jobs
      router.push("/(tabs)/schedule" as any);
    }
  }, [employee, unseenEvents, unseenCount, latestEvent, markSeenMutation, router]);

  if (!employee || unseenCount === 0) return null;

  // Build a short summary of the most recent event
  const eventEmoji =
    latestEvent?.eventType === "created"
      ? "📋"
      : latestEvent?.eventType === "cancelled"
      ? "❌"
      : "🔄";
  const eventLabel =
    latestEvent?.eventType === "created"
      ? "New job added"
      : latestEvent?.eventType === "cancelled"
      ? "Job cancelled"
      : "Job rescheduled";
  const customerLabel = latestEvent?.customerName
    ? ` — ${latestEvent.customerName}`
    : "";
  const bannerText =
    unseenCount === 1
      ? `${eventEmoji} ${eventLabel}${customerLabel}`
      : `${eventEmoji} ${unseenCount} job updates — tap to view`;

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.banner,
        { opacity: pressed ? 0.85 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${bannerText}. Tap to open schedule.`}
    >
      <View style={styles.inner}>
        <Text style={styles.text} numberOfLines={1}>
          {bannerText}
        </Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unseenCount > 99 ? "99+" : unseenCount}</Text>
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
    backgroundColor: "#1d4ed8",
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
    color: "#1d4ed8",
  },
});
