import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

const TYPE_LABELS: Record<string, string> = {
  booking_confirmation: "Booking",
  notification: "Notification",
  review_request: "Review",
  other: "Other",
};

const TYPE_COLORS: Record<string, string> = {
  booking_confirmation: "#0057FF",
  notification: "#F59E0B",
  review_request: "#22C55E",
  other: "#6B7280",
};

function formatDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function AdminEmailLogScreen() {
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const { data: logs = [], isLoading, refetch } = trpc.emailLogs.list.useQuery({ limit: 200 });
  const { data: counts } = trpc.emailLogs.counts.useQuery();

  const filtered = logs.filter((log) => {
    const q = search.toLowerCase();
    return (
      !q ||
      log.to.toLowerCase().includes(q) ||
      (log.customerName ?? "").toLowerCase().includes(q) ||
      (log.bookingRef ?? "").toLowerCase().includes(q) ||
      log.subject.toLowerCase().includes(q)
    );
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <ScreenContainer containerClassName="bg-[#0A0A0A]" safeAreaClassName="bg-[#0A0A0A]">
      {/* Header */}
      <View className="px-5 pt-4 pb-3 border-b border-[#1E3A5F]">
        <Text className="text-white text-2xl font-bold">Email Log</Text>
        <Text className="text-[#6B7280] text-sm mt-0.5">All outgoing emails from Luxury Wash On Wheels</Text>
      </View>

      {/* Search */}
      <View className="px-4 py-3 border-b border-[#1E3A5F]">
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name, email, or subject..."
          placeholderTextColor="#4B5563"
          style={{
            backgroundColor: "#111827",
            color: "#fff",
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 10,
            fontSize: 14,
            borderWidth: 1,
            borderColor: "#1E3A5F",
          }}
        />
      </View>

      {/* Stats row */}
      <View className="flex-row px-4 py-2 gap-3 border-b border-[#1E3A5F]">
        <View className="flex-1 bg-[#111827] rounded-xl p-3 items-center border border-[#1E3A5F]">
          <Text className="text-white text-xl font-bold">{counts?.total ?? logs.length}</Text>
          <Text className="text-[#6B7280] text-xs mt-0.5">Total Sent</Text>
        </View>
        <View className="flex-1 bg-[#111827] rounded-xl p-3 items-center border border-[#1E3A5F]">
          <Text className="text-[#0057FF] text-xl font-bold">
            {counts?.bookings ?? logs.filter((l) => l.type === "booking_confirmation").length}
          </Text>
          <Text className="text-[#6B7280] text-xs mt-0.5">Bookings</Text>
        </View>
        <View className="flex-1 bg-[#111827] rounded-xl p-3 items-center border border-[#1E3A5F]">
          <Text className="text-[#F59E0B] text-xl font-bold">
            {counts?.alerts ?? logs.filter((l) => l.type === "notification").length}
          </Text>
          <Text className="text-[#6B7280] text-xs mt-0.5">Alerts</Text>
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0057FF" size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-[#4B5563] text-base text-center">
            {search ? "No emails match your search." : "No emails have been sent yet."}
          </Text>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={filtered}
          keyExtractor={(item) => item.logId}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#0057FF" />
          }
          contentContainerStyle={{ paddingBottom: 32 }}
          renderItem={({ item }) => (
            <View
              style={{
                marginHorizontal: 16,
                marginTop: 12,
                backgroundColor: "#111827",
                borderRadius: 14,
                padding: 14,
                borderWidth: 1,
                borderColor: item.status === "failed" ? "#EF4444" : "#1E3A5F",
              }}
            >
              {/* Top row: type badge + status + date */}
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 }}>
                <View
                  style={{
                    backgroundColor: TYPE_COLORS[item.type] + "22",
                    borderRadius: 20,
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                  }}
                >
                  <Text style={{ color: TYPE_COLORS[item.type], fontSize: 11, fontWeight: "700" }}>
                    {TYPE_LABELS[item.type] ?? item.type}
                  </Text>
                </View>
                {item.status === "failed" && (
                  <View style={{ backgroundColor: "#EF444422", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ color: "#EF4444", fontSize: 11, fontWeight: "700" }}>Failed</Text>
                  </View>
                )}
                <Text style={{ color: "#4B5563", fontSize: 11, marginLeft: "auto" }}>
                  {formatDate(item.sentAt)}
                </Text>
              </View>

              {/* Customer name */}
              {item.customerName ? (
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 2 }}>
                  {item.customerName}
                </Text>
              ) : null}

              {/* To address */}
              <Text style={{ color: "#9CA3AF", fontSize: 13, marginBottom: 4 }}>{item.to}</Text>

              {/* Subject */}
              <Text style={{ color: "#D1D5DB", fontSize: 13, lineHeight: 18 }} numberOfLines={2}>
                {item.subject}
              </Text>

              {/* Booking ref */}
              {item.bookingRef ? (
                <Text style={{ color: "#4B5563", fontSize: 11, marginTop: 6 }}>
                  Ref: {item.bookingRef}
                </Text>
              ) : null}
            </View>
          )}
        />
      )}
    </ScreenContainer>
  );
}
