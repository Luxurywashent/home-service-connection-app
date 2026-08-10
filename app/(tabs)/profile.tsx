import { useState } from "react";
import { Text, View, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Platform } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import { useRouter } from "expo-router";

export default function ProfileScreen() {
  const colors = useColors();
  const { employee, logout, isAdmin } = useEmployeeAuth();
  const router = useRouter();
  const [showPinReset, setShowPinReset] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinSuccess, setPinSuccess] = useState(false);

  const resetPinMutation = trpc.employee.resetPin.useMutation();

  // Van assignment (detailers only)
  const { data: vanAssignment, isLoading: vanLoading } = trpc.fleet.getVanAssignment.useQuery(
    { employeeId: employee?.employeeId ?? "" },
    { enabled: !!employee?.employeeId && employee?.role === "detailer" }
  );

  const handleResetPin = async () => {
    if (newPin.length < 4) { setPinError("PIN must be at least 4 digits"); return; }
    if (newPin !== confirmPin) { setPinError("PINs do not match"); return; }
    setPinError("");
    try {
      await resetPinMutation.mutateAsync({ employeeId: employee?.employeeId ?? "", newPin });
      setPinSuccess(true);
      setNewPin("");
      setConfirmPin("");
      setTimeout(() => { setPinSuccess(false); setShowPinReset(false); }, 2000);
    } catch {
      setPinError("Failed to reset PIN");
    }
  };

  const handleLogout = () => {
    if (Platform.OS === "web") {
      logout().then(() => router.replace("/login"));
    } else {
      Alert.alert("Sign Out", "Are you sure you want to sign out?", [
        { text: "Cancel", style: "cancel" },
        { text: "Sign Out", style: "destructive", onPress: () => logout().then(() => router.replace("/login")) },
      ]);
    }
  };

  const roleLabel = (role: string) => {
    switch (role) {
      case "detailer": return "Detailer";
      case "admin": return "Admin";
      case "office": return "Office";
      case "operations_manager": return "Operations Manager";
      default: return role;
    }
  };

  return (
    <ScreenContainer edges={["left", "right"]} className="px-5">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ marginTop: 8, marginBottom: 24 }}>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>Profile</Text>
        </View>

        {/* Avatar + Name */}
        <View style={{ alignItems: "center", marginBottom: 28 }}>
          <View style={{
            width: 80, height: 80, borderRadius: 40,
            backgroundColor: colors.primary,
            justifyContent: "center", alignItems: "center", marginBottom: 12,
          }}>
            <Text style={{ fontSize: 28, fontWeight: "800", color: "#FFF" }}>
              {employee?.fullName?.split(" ").map(n => n[0]).join("").substring(0, 2) ?? "?"}
            </Text>
          </View>
          <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground }}>{employee?.fullName}</Text>
          <View style={{
            backgroundColor: colors.primary + "15",
            paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, marginTop: 6,
          }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>{roleLabel(employee?.role ?? "")}</Text>
          </View>
        </View>

        {/* Van Assignment (detailers only) */}
        {employee?.role === "detailer" && (
          <View style={{
            backgroundColor: vanAssignment ? colors.primary + "12" : colors.surface,
            borderRadius: 16, padding: 16, marginBottom: 20,
            borderWidth: 1.5,
            borderColor: vanAssignment ? colors.primary + "50" : colors.border,
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: vanAssignment ? 12 : 0 }}>
              <Text style={{ fontSize: 22 }}>🚐</Text>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Assigned Van</Text>
              {vanLoading && <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: "auto" }} />}
            </View>
            {!vanLoading && !vanAssignment && (
              <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>No van assigned yet. Contact your admin.</Text>
            )}
            {vanAssignment && (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>{vanAssignment.vanName ?? vanAssignment.vanId}</Text>
                  </View>
                  <View style={{ backgroundColor: colors.primary + "25", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "700" }}>
                      {vanAssignment.shift === "shift1" ? "1st Shift" : "2nd Shift"}
                    </Text>
                  </View>
                </View>
                {vanAssignment.assignedAt && (
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    Assigned {new Date(vanAssignment.assignedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* Info Cards */}
        <View style={{ gap: 12, marginBottom: 28 }}>
          <InfoRow label="Team Member ID" value={employee?.employeeId ?? "-"} colors={colors} />
          <InfoRow label="Email" value={employee?.email ?? "-"} colors={colors} />
          <InfoRow label="City" value={employee?.city ?? "-"} colors={colors} />
          <InfoRow label="Phone" value={employee?.phoneNumber ?? "-"} colors={colors} />
          <InfoRow label="Hire Date" value={employee?.hireDate ?? "-"} colors={colors} />
        </View>

        {/* Reset PIN */}
        <TouchableOpacity
          onPress={() => setShowPinReset(!showPinReset)}
          activeOpacity={0.7}
          style={{
            backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 12,
            borderWidth: 1, borderColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>
            {showPinReset ? "Cancel PIN Reset" : "Reset PIN"}
          </Text>
        </TouchableOpacity>

        {showPinReset && (
          <View style={{
            backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 12,
            borderWidth: 1, borderColor: colors.border, gap: 12,
          }}>
            <TextInput
              value={newPin}
              onChangeText={(t) => setNewPin(t.replace(/[^0-9]/g, "").substring(0, 6))}
              placeholder="New PIN (4-6 digits)"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              style={{
                backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
                borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16,
                color: colors.foreground, letterSpacing: 6,
              }}
            />
            <TextInput
              value={confirmPin}
              onChangeText={(t) => setConfirmPin(t.replace(/[^0-9]/g, "").substring(0, 6))}
              placeholder="Confirm PIN"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={handleResetPin}
              style={{
                backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
                borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16,
                color: colors.foreground, letterSpacing: 6,
              }}
            />
            {pinError ? <Text style={{ color: colors.error, fontSize: 13 }}>{pinError}</Text> : null}
            {pinSuccess && <Text style={{ color: colors.success, fontSize: 13, fontWeight: "600" }}>PIN updated successfully!</Text>}
            <TouchableOpacity
              onPress={handleResetPin}
              disabled={resetPinMutation.isPending}
              activeOpacity={0.8}
              style={{ backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: "center" }}
            >
              {resetPinMutation.isPending ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={{ color: "#FFF", fontSize: 15, fontWeight: "600" }}>Update PIN</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Logout */}
        <TouchableOpacity
          onPress={handleLogout}
          activeOpacity={0.8}
          style={{
            backgroundColor: colors.error + "10",
            borderRadius: 14, paddingVertical: 16, alignItems: "center",
            borderWidth: 1, borderColor: colors.error + "30",
            marginTop: 8,
          }}
        >
          <Text style={{ color: colors.error, fontSize: 16, fontWeight: "700" }}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}

function InfoRow({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={{
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
      backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
      borderWidth: 1, borderColor: colors.border,
    }}>
      <Text style={{ fontSize: 13, color: colors.muted }}>{label}</Text>
      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{value}</Text>
    </View>
  );
}
