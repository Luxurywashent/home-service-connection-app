import React from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { useCustomerAuth } from "@/lib/customer-context";

/**
 * CustomerMessageBanner — shows a tappable banner when the customer has unread portal messages.
 * Drop this near the top of any customer portal screen.
 */
export function CustomerMessageBanner() {
  const colors = useColors();
  const router = useRouter();
  const { token } = useCustomerAuth();

  const { data } = trpc.customer.unreadCount.useQuery(
    { token: token ?? "" },
    { enabled: !!token, refetchInterval: 30000 }
  );
  const count = data?.count ?? 0;

  if (!count) return null;

  return (
    <Pressable
      onPress={() => router.push("/(customer)/messages")}
      style={({ pressed }) => ({
        backgroundColor: colors.primary + "18",
        borderRadius: 12,
        padding: 14,
        marginHorizontal: 20,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: colors.primary + "40",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={{ backgroundColor: "#EF4444", borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
        <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{count > 99 ? "99+" : count}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "700" }}>
          {count === 1 ? "1 new message from us" : `${count} new messages from us`}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>Tap to view your messages</Text>
      </View>
      <Text style={{ color: colors.primary, fontSize: 16 }}>›</Text>
    </Pressable>
  );
}
