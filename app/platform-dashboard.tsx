import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";

import { ScreenContainer } from "@/components/screen-container";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";

export default function PlatformDashboard() {
  const router = useRouter();
  const { session, logout } = useJobSyncAuth();

  const handleSignOut = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <ScreenContainer className="p-6" edges={["top", "bottom", "left", "right"]}>
      <View style={styles.header}>
        <View style={styles.icon}><MaterialIcons color="#7DB1FF" name="admin-panel-settings" size={29} /></View>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>Native platform workspace</Text>
          <Text style={styles.title}>Platform Admin</Text>
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.welcome}>Welcome, {session?.user.name || "Platform administrator"}</Text>
        <Text style={styles.body}>You are signed in to Home Service Connection with your JobSync platform-admin account.</Text>
        <View style={styles.detailRow}><Text style={styles.detailLabel}>Platform role</Text><Text style={styles.detailValue}>{session?.user.role?.replaceAll("_", " ") || "platform admin"}</Text></View>
        <View style={styles.detailRow}><Text style={styles.detailLabel}>Administrator ID</Text><Text style={styles.detailValue}>{session?.user.memberId || "—"}</Text></View>
      </View>
      <View style={styles.notice}><MaterialIcons color="#52D3B8" name="verified-user" size={19} /><Text style={styles.noticeText}>This is a native app session. Your JobSync password and remote session cookie are not stored on this device.</Text></View>
      <Pressable accessibilityRole="button" onPress={handleSignOut} style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}><Text style={styles.signOutText}>Sign out</Text></Pressable>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", flexDirection: "row", marginBottom: 28, marginTop: 14 },
  icon: { alignItems: "center", backgroundColor: "#17345E", borderRadius: 18, height: 60, justifyContent: "center", width: 60 },
  headerCopy: { marginLeft: 14 },
  eyebrow: { color: "#94A3B8", fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  title: { color: "#F6F8FC", fontSize: 26, fontWeight: "800", marginTop: 3 },
  card: { backgroundColor: "#102038", borderColor: "#243754", borderRadius: 18, borderWidth: 1, padding: 20 },
  welcome: { color: "#F6F8FC", fontSize: 19, fontWeight: "800" },
  body: { color: "#B2C1D6", fontSize: 14, lineHeight: 21, marginBottom: 18, marginTop: 8 },
  detailRow: { borderTopColor: "#243754", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 13 },
  detailLabel: { color: "#8FA3C1", fontSize: 13 },
  detailValue: { color: "#E6EDF8", fontSize: 13, fontWeight: "700", maxWidth: "55%", textAlign: "right", textTransform: "capitalize" },
  notice: { alignItems: "flex-start", backgroundColor: "#0E2730", borderColor: "#1F4E55", borderRadius: 14, borderWidth: 1, flexDirection: "row", marginTop: 18, padding: 15 },
  noticeText: { color: "#B5D9D0", flex: 1, fontSize: 12.5, lineHeight: 18, marginLeft: 10 },
  signOut: { alignItems: "center", borderColor: "#355178", borderRadius: 14, borderWidth: 1, marginTop: 24, paddingVertical: 15 },
  signOutText: { color: "#BFD4F3", fontSize: 15, fontWeight: "800" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
