import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import { useRouter } from "expo-router";

type AccountSettingsTab = "account" | "work" | "security";

const SETTINGS_TABS = [
  { id: "account" as const, label: "Account", icon: "person-outline" as const },
  { id: "work" as const, label: "Work", icon: "work-outline" as const },
  { id: "security" as const, label: "Security", icon: "lock-outline" as const },
];

export default function ProfileScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const { employee, logout } = useEmployeeAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AccountSettingsTab>("account");
  const [showPinReset, setShowPinReset] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinSuccess, setPinSuccess] = useState(false);

  const resetPinMutation = trpc.employee.resetPin.useMutation();
  const isDetailer = employee?.role === "detailer";
  const isWide = width >= 760;

  const { data: vanAssignment, isLoading: vanLoading } = trpc.fleet.getVanAssignment.useQuery(
    { employeeId: employee?.employeeId ?? "" },
    { enabled: !!employee?.employeeId && isDetailer },
  );

  const handleResetPin = async () => {
    if (newPin.length < 4) {
      setPinError("PIN must be at least 4 digits.");
      return;
    }
    if (newPin !== confirmPin) {
      setPinError("PINs do not match.");
      return;
    }

    setPinError("");
    try {
      await resetPinMutation.mutateAsync({ employeeId: employee?.employeeId ?? "", newPin });
      setPinSuccess(true);
      setNewPin("");
      setConfirmPin("");
      setTimeout(() => {
        setPinSuccess(false);
        setShowPinReset(false);
      }, 2000);
    } catch {
      setPinError("Unable to update your PIN. Please try again.");
    }
  };

  const handleLogout = () => {
    if (Platform.OS === "web") {
      logout().then(() => router.replace("/login"));
      return;
    }

    Alert.alert("Sign Out", "Are you sure you want to sign out of this device?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => logout().then(() => router.replace("/login")) },
    ]);
  };

  const role = roleLabel(employee?.role ?? "");
  const initials = getInitials(employee?.fullName);

  return (
    <ScreenContainer edges={["left", "right"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={[styles.page, { maxWidth: isWide ? 980 : undefined }]}>
          <View style={[styles.pageHeader, { borderBottomColor: colors.border }]}>
            <View>
              <Text style={[styles.pageTitle, { color: colors.foreground }]}>Account Settings</Text>
              <Text style={[styles.pageSubtitle, { color: colors.muted }]}>Manage your profile, work details, and account security.</Text>
            </View>
            <View style={[styles.headerIcon, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "38" }]}>
              <MaterialIcons name="settings" size={22} color={colors.primary} />
            </View>
          </View>

          <View style={[styles.tabBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {SETTINGS_TABS.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <TouchableOpacity
                  key={tab.id}
                  onPress={() => setActiveTab(tab.id)}
                  activeOpacity={0.8}
                  style={[styles.tabButton, selected && { backgroundColor: colors.primary }]}
                >
                  <MaterialIcons name={tab.icon} size={18} color={selected ? "#FFFFFF" : colors.muted} />
                  <Text style={[styles.tabLabel, { color: selected ? "#FFFFFF" : colors.muted }]}>{tab.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {activeTab === "account" && (
            <>
              <View style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                  <Text style={styles.avatarText}>{initials}</Text>
                </View>
                <View style={styles.profileCopy}>
                  <Text style={[styles.profileName, { color: colors.foreground }]}>{employee?.fullName ?? "Team Member"}</Text>
                  <Text style={[styles.profileDescription, { color: colors.muted }]}>Your account is connected to your Home Service Connection Company workspace.</Text>
                  <View style={[styles.roleBadge, { backgroundColor: colors.primary + "18" }]}>
                    <MaterialIcons name="verified-user" size={14} color={colors.primary} />
                    <Text style={[styles.roleText, { color: colors.primary }]}>{role}</Text>
                  </View>
                </View>
              </View>

              <SettingsSectionHeader
                title="Personal Details"
                description="Your Company profile information"
                colors={colors}
              />
              <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={isWide ? styles.detailGridWide : styles.detailGrid}>
                  <DetailCell label="Full Name" value={employee?.fullName} icon="person-outline" colors={colors} />
                  <DetailCell label="Email" value={employee?.email} icon="mail-outline" colors={colors} />
                  <DetailCell label="Team Member ID" value={employee?.employeeId} icon="badge" colors={colors} />
                  <DetailCell label="Role" value={role} icon="assignment-ind" colors={colors} />
                  <DetailCell label="Phone" value={employee?.phoneNumber} icon="phone" colors={colors} />
                  <DetailCell label="Service Area" value={employee?.city} icon="location-on" colors={colors} />
                  <DetailCell label="Hire Date" value={employee?.hireDate} icon="event" colors={colors} />
                </View>
              </View>
            </>
          )}

          {activeTab === "work" && (
            <>
              <SettingsSectionHeader
                title="Work Assignment"
                description="Details managed by your Company administrator"
                colors={colors}
              />
              <View style={[styles.assignmentCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={[styles.assignmentIcon, { backgroundColor: colors.primary + "18" }]}>
                  <MaterialIcons name="directions-car" size={24} color={colors.primary} />
                </View>
                <View style={styles.assignmentCopy}>
                  <Text style={[styles.assignmentTitle, { color: colors.foreground }]}>Assigned Vehicle</Text>
                  {vanLoading ? (
                    <View style={styles.assignmentLoading}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={[styles.assignmentText, { color: colors.muted }]}>Loading assignment…</Text>
                    </View>
                  ) : vanAssignment ? (
                    <>
                      <Text style={[styles.assignmentValue, { color: colors.foreground }]}>{vanAssignment.vanName ?? vanAssignment.vanId}</Text>
                      <Text style={[styles.assignmentText, { color: colors.muted }]}> {vanAssignment.shift === "shift1" ? "First shift" : "Second shift"}{vanAssignment.assignedAt ? ` · assigned ${formatDate(vanAssignment.assignedAt)}` : ""}</Text>
                    </>
                  ) : (
                    <Text style={[styles.assignmentText, { color: colors.muted }]}>
                      {isDetailer ? "No vehicle is assigned yet. Contact your Company administrator." : "Vehicle assignments are shown for technicians."}
                    </Text>
                  )}
                </View>
              </View>

              <View style={[styles.infoNotice, { backgroundColor: colors.primary + "0D", borderColor: colors.primary + "30" }]}>
                <MaterialIcons name="info-outline" size={18} color={colors.primary} />
                <Text style={[styles.infoNoticeText, { color: colors.muted }]}>Company administrators manage work assignments and team details from the Company workspace.</Text>
              </View>
            </>
          )}

          {activeTab === "security" && (
            <>
              <SettingsSectionHeader
                title="Security"
                description="Keep your sign-in PIN private and up to date"
                colors={colors}
              />
              <View style={[styles.securityCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={[styles.securityIcon, { backgroundColor: colors.primary + "18" }]}>
                  <MaterialIcons name="lock-outline" size={24} color={colors.primary} />
                </View>
                <View style={styles.securityCopy}>
                  <Text style={[styles.securityTitle, { color: colors.foreground }]}>Change PIN</Text>
                  <Text style={[styles.securityDescription, { color: colors.muted }]}>Use a unique 4–6 digit PIN for your mobile access.</Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setShowPinReset((visible) => !visible);
                    setPinError("");
                    setPinSuccess(false);
                  }}
                  activeOpacity={0.8}
                  style={[styles.outlineButton, { borderColor: colors.primary }]}
                >
                  <Text style={[styles.outlineButtonText, { color: colors.primary }]}>{showPinReset ? "Cancel" : "Change"}</Text>
                </TouchableOpacity>
              </View>

              {showPinReset && (
                <View style={[styles.pinForm, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.formTitle, { color: colors.foreground }]}>Create a new PIN</Text>
                  <Text style={[styles.formDescription, { color: colors.muted }]}>Enter the same 4–6 digit PIN twice to confirm it.</Text>
                  <TextInput
                    value={newPin}
                    onChangeText={(text) => setNewPin(text.replace(/[^0-9]/g, "").substring(0, 6))}
                    placeholder="New PIN"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={6}
                    style={[styles.pinInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  />
                  <TextInput
                    value={confirmPin}
                    onChangeText={(text) => setConfirmPin(text.replace(/[^0-9]/g, "").substring(0, 6))}
                    placeholder="Confirm new PIN"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={6}
                    returnKeyType="done"
                    onSubmitEditing={handleResetPin}
                    style={[styles.pinInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  />
                  {pinError ? <Text style={[styles.feedbackText, { color: colors.error }]}>{pinError}</Text> : null}
                  {pinSuccess ? <Text style={[styles.feedbackText, { color: colors.success }]}>PIN updated successfully.</Text> : null}
                  <TouchableOpacity
                    onPress={handleResetPin}
                    disabled={resetPinMutation.isPending}
                    activeOpacity={0.85}
                    style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: resetPinMutation.isPending ? 0.65 : 1 }]}
                  >
                    {resetPinMutation.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Save New PIN</Text>}
                  </TouchableOpacity>
                </View>
              )}

              <View style={[styles.signOutCard, { backgroundColor: colors.error + "0D", borderColor: colors.error + "35" }]}>
                <View style={styles.signOutCopy}>
                  <Text style={[styles.signOutTitle, { color: colors.foreground }]}>Sign out of this device</Text>
                  <Text style={[styles.signOutDescription, { color: colors.muted }]}>You can sign back in with your Company credentials anytime.</Text>
                </View>
                <TouchableOpacity onPress={handleLogout} activeOpacity={0.8} style={[styles.signOutButton, { borderColor: colors.error }]}>
                  <Text style={[styles.signOutButtonText, { color: colors.error }]}>Sign Out</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function SettingsSectionHeader({ title, description, colors }: { title: string; description: string; colors: any }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.sectionDescription, { color: colors.muted }]}>{description}</Text>
    </View>
  );
}

function DetailCell({ label, value, icon, colors }: { label: string; value?: string | null; icon: React.ComponentProps<typeof MaterialIcons>["name"]; colors: any }) {
  return (
    <View style={[styles.detailCell, { borderColor: colors.border }]}>
      <View style={[styles.detailIcon, { backgroundColor: colors.primary + "12" }]}>
        <MaterialIcons name={icon} size={17} color={colors.primary} />
      </View>
      <View style={styles.detailCopy}>
        <Text style={[styles.detailLabel, { color: colors.muted }]}>{label}</Text>
        <Text style={[styles.detailValue, { color: colors.foreground }]} numberOfLines={2}>{value?.trim() || "Not provided"}</Text>
      </View>
    </View>
  );
}

function roleLabel(role: string) {
  switch (role) {
    case "detailer":
      return "Technician";
    case "admin":
      return "Company Admin";
    case "office":
      return "Office";
    case "operations_manager":
      return "Operations Manager";
    default:
      return role || "Team Member";
  }
}

function getInitials(name?: string | null) {
  const initials = name?.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2);
  return initials?.toUpperCase() || "?";
}

function formatDate(date?: string | null) {
  if (!date) return "";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 44,
  },
  page: {
    width: "100%",
    alignSelf: "center",
  },
  pageHeader: {
    paddingTop: 16,
    paddingBottom: 18,
    marginBottom: 16,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  pageTitle: {
    fontSize: 25,
    lineHeight: 31,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    maxWidth: 560,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  tabBar: {
    flexDirection: "row",
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    marginBottom: 20,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 6,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  profileCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
  },
  profileCopy: {
    flex: 1,
  },
  profileName: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "800",
  },
  profileDescription: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  roleBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginTop: 10,
  },
  roleText: {
    fontSize: 12,
    fontWeight: "700",
  },
  sectionHeader: {
    marginTop: 26,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "800",
  },
  sectionDescription: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  detailCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 4,
  },
  detailGrid: {
    flexDirection: "column",
  },
  detailGridWide: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  detailCell: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  detailCopy: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.45,
  },
  detailValue: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "600",
    marginTop: 1,
  },
  assignmentCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  assignmentIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  assignmentCopy: {
    flex: 1,
  },
  assignmentTitle: {
    fontSize: 15,
    fontWeight: "800",
  },
  assignmentValue: {
    fontSize: 16,
    fontWeight: "700",
    marginTop: 3,
  },
  assignmentText: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  assignmentLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 5,
  },
  infoNotice: {
    flexDirection: "row",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginTop: 12,
  },
  infoNoticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  securityCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  securityIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  securityCopy: {
    flex: 1,
  },
  securityTitle: {
    fontSize: 15,
    fontWeight: "800",
  },
  securityDescription: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  outlineButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  outlineButtonText: {
    fontSize: 13,
    fontWeight: "800",
  },
  pinForm: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginTop: 12,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  formDescription: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
    marginBottom: 14,
  },
  pinInput: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    marginBottom: 10,
    fontSize: 16,
    letterSpacing: 5,
  },
  feedbackText: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 10,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  signOutCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 22,
  },
  signOutCopy: {
    flex: 1,
  },
  signOutTitle: {
    fontSize: 15,
    fontWeight: "800",
  },
  signOutDescription: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  signOutButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutButtonText: {
    fontSize: 13,
    fontWeight: "800",
  },
});
