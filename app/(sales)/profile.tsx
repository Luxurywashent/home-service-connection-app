import React from "react";
import {
  View, Text, ScrollView, TouchableOpacity, Alert, Platform, Image,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export default function SalesProfileScreen() {
  const colors = useColors();
  const router = useRouter();
  const { employee, logout } = useEmployeeAuth();
  const logoutMutation = trpc.auth.logout.useMutation();

  const handleLogout = () => {
    if (Platform.OS === "web") {
      // Web: skip Alert, log out directly
      logoutMutation.mutateAsync().catch(() => {});
      logout().then(() => router.replace("/login"));
      return;
    }
    Alert.alert(
      "Sign Out",
      "Are you sure you want to sign out?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out",
          style: "destructive",
          onPress: async () => {
            if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            try { await logoutMutation.mutateAsync(); } catch {}
            await logout();
            router.replace("/login");
          },
        },
      ]
    );
  };

  const name = employee?.fullName ?? "Sales Rep";
  const role = employee?.role ?? "sales";

  return (
    <ScreenContainer edges={["left", "right"]} className="flex-1 px-0">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Header */}
        <View style={{
          paddingHorizontal: 20, paddingTop: 24, paddingBottom: 32,
          backgroundColor: "#1E3A8A",
          alignItems: "center",
        }}>
          {/* Avatar */}
          {employee?.profilePhotoUrl ? (
            <Image
              source={{ uri: employee.profilePhotoUrl }}
              style={{ width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: "rgba(255,255,255,0.3)" }}
            />
          ) : (
            <View style={{
              width: 80, height: 80, borderRadius: 40,
              backgroundColor: "rgba(255,255,255,0.2)",
              alignItems: "center", justifyContent: "center",
              borderWidth: 3, borderColor: "rgba(255,255,255,0.3)",
            }}>
              <Text style={{ fontSize: 28, fontWeight: "900", color: "#fff" }}>
                {getInitials(name)}
              </Text>
            </View>
          )}
          <Text style={{ fontSize: 22, fontWeight: "900", color: "#fff", marginTop: 12 }}>{name}</Text>
          <View style={{
            backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10,
            paddingHorizontal: 12, paddingVertical: 4, marginTop: 6,
          }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.9)", textTransform: "uppercase", letterSpacing: 0.8 }}>
              Sales Representative
            </Text>
          </View>
        </View>

        {/* Account Info */}
        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>
            Account
          </Text>
          <View style={{
            backgroundColor: colors.surface, borderRadius: 14,
            borderWidth: 1, borderColor: colors.border, overflow: "hidden",
          }}>
            <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Name</Text>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{name}</Text>
            </View>
            <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Employee ID</Text>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{employee?.employeeId ?? "—"}</Text>
            </View>
            <View style={{ padding: 14 }}>
              <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Role</Text>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground, textTransform: "capitalize" }}>{role}</Text>
            </View>
          </View>
        </View>

        {/* Sign Out */}
        <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
          <TouchableOpacity
            onPress={handleLogout}
            style={{
              backgroundColor: "#FEF2F2",
              borderRadius: 14, paddingVertical: 16,
              alignItems: "center",
              borderWidth: 1, borderColor: "#FECACA",
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "800", color: "#DC2626" }}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
