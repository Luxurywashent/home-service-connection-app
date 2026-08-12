import React from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { MaterialIcons } from "@expo/vector-icons";
import { useInvestorAuth } from "@/lib/investor-auth";
import { trpc } from "@/lib/trpc";

interface AdminNavCard {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  subtitle: string;
  route: string;
  color: string;
}

const NAV_CARDS: AdminNavCard[] = [
  { icon: "people", title: "Investors", subtitle: "Manage all investor accounts", route: "/(tabs)/admin-investors", color: "#7C3AED" },
  { icon: "trending-up", title: "Investments", subtitle: "View & manage investments", route: "/(tabs)/admin-investors", color: "#059669" },
  { icon: "attach-money", title: "Payments", subtitle: "Record & track payments", route: "/(tabs)/admin-investors", color: "#D97706" },
  { icon: "folder", title: "Documents", subtitle: "Upload & manage documents", route: "/(tabs)/admin-investors", color: "#2563EB" },
  { icon: "campaign", title: "Investor Updates", subtitle: "Post updates to investors", route: "/(tabs)/admin-investor-updates", color: "#0891B2" },
  { icon: "support-agent", title: "Support Requests", subtitle: "Respond to investor inquiries", route: "/(tabs)/admin-investor-support", color: "#DC2626" },
  { icon: "history", title: "Audit Log", subtitle: "View all activity history", route: "/(tabs)/admin-investors", color: "#6B7280" },
];

export default function InvestorAdminHomeScreen() {
  const router = useRouter();
  const { investor, logout } = useInvestorAuth();
  const statsQuery = trpc.investor.adminListInvestors.useQuery(undefined, { retry: false });

  const investors = statsQuery.data ?? [];
  const activeCount = investors.filter((i: any) => i.accountStatus === "active").length;

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out of the Investor Admin Portal?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: async () => {
        await logout();
        router.replace("/(tabs)/investor-login" as any);
      }},
    ]);
  };

  return (
    <ScreenContainer edges={["left", "right"]} className="p-0">
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Investor Admin</Text>
          <Text style={styles.headerSub}>Home Service Connection</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn} activeOpacity={0.7}>
          <MaterialIcons name="logout" size={20} color="#7C3AED" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Welcome */}
        <View style={styles.welcomeCard}>
          <View style={styles.welcomeIcon}>
            <MaterialIcons name="admin-panel-settings" size={28} color="#7C3AED" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.welcomeName}>Welcome, {investor?.firstName}</Text>
            <Text style={styles.welcomeRole}>Investor Admin Portal</Text>
          </View>
        </View>

        {/* Quick Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{investors.length}</Text>
            <Text style={styles.statLabel}>Total Investors</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNum, { color: "#059669" }]}>{activeCount}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNum, { color: "#D97706" }]}>{investors.length - activeCount}</Text>
            <Text style={styles.statLabel}>Other</Text>
          </View>
        </View>

        {/* Nav Cards */}
        <Text style={styles.sectionTitle}>MANAGEMENT</Text>
        <View style={styles.grid}>
          {NAV_CARDS.map((card) => (
            <TouchableOpacity
              key={card.title}
              style={styles.navCard}
              activeOpacity={0.75}
              onPress={() => router.push(card.route as any)}
            >
              <View style={[styles.navIcon, { backgroundColor: card.color + "20" }]}>
                <MaterialIcons name={card.icon} size={26} color={card.color} />
              </View>
              <Text style={styles.navTitle}>{card.title}</Text>
              <Text style={styles.navSub}>{card.subtitle}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: "#334155" },
  headerTitle: { fontSize: 20, fontWeight: "800", color: "#ECEDEE" },
  headerSub: { fontSize: 12, color: "#9BA1A6", marginTop: 1 },
  logoutBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#7C3AED20", justifyContent: "center", alignItems: "center" },
  welcomeCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#1e2022", borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#7C3AED40" },
  welcomeIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#7C3AED20", justifyContent: "center", alignItems: "center" },
  welcomeName: { fontSize: 18, fontWeight: "700", color: "#ECEDEE" },
  welcomeRole: { fontSize: 13, color: "#7C3AED", marginTop: 2 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: "#1e2022", borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 1, borderColor: "#334155" },
  statNum: { fontSize: 24, fontWeight: "800", color: "#ECEDEE" },
  statLabel: { fontSize: 11, color: "#9BA1A6", marginTop: 2 },
  sectionTitle: { fontSize: 11, fontWeight: "700", color: "#9BA1A6", letterSpacing: 1, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  navCard: { width: "47%", backgroundColor: "#1e2022", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#334155" },
  navIcon: { width: 48, height: 48, borderRadius: 12, justifyContent: "center", alignItems: "center", marginBottom: 10 },
  navTitle: { fontSize: 14, fontWeight: "700", color: "#ECEDEE", marginBottom: 3 },
  navSub: { fontSize: 11, color: "#9BA1A6", lineHeight: 15 },
});
