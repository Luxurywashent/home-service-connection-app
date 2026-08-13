import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";

import { ScreenContainer } from "@/components/screen-container";
import type { JobSyncPortal } from "@/lib/jobsync-portal";

const portalOptions: {
  portal: JobSyncPortal;
  icon: "business" | "admin-panel-settings";
  title: string;
  description: string;
  note: string;
}[] = [
  {
    portal: "company",
    icon: "business",
    title: "Company Sign In",
    description: "Open your private Company workspace.",
    note: "Use the same JobSync email and password already assigned to your Company account.",
  },
  {
    portal: "platform",
    icon: "admin-panel-settings",
    title: "Platform Admin",
    description: "Manage Companies, plans, and platform operations.",
    note: "Use separate platform-owner credentials. Company credentials do not grant platform access.",
  },
];

export default function LoginScreen() {
  const router = useRouter();

  const openPortal = (portal: JobSyncPortal) => {
    router.push({ pathname: "/portal" as any, params: { portal } });
  };

  return (
    <ScreenContainer edges={["bottom", "left", "right"]} containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.scrollContent} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.container}>
          <View style={styles.logoSection}>
            <View style={styles.logoBox}>
              <Image source={require("../assets/images/icon.png")} style={styles.logoImage} resizeMode="contain" />
            </View>
            <Text style={styles.appName}>Home Service Connection</Text>
            <Text style={styles.appSubtitle}>Choose the workspace you need to access</Text>
          </View>

          <View style={styles.portalStack}>
            {portalOptions.map((option) => (
              <Pressable
                key={option.portal}
                accessibilityRole="button"
                accessibilityHint={`Open the ${option.title} portal`}
                onPress={() => openPortal(option.portal)}
                style={({ pressed }) => [styles.portalCard, pressed && styles.portalCardPressed]}
              >
                <View style={styles.portalIcon}>
                  <MaterialIcons color="#7DB1FF" name={option.icon} size={26} />
                </View>
                <View style={styles.portalCopy}>
                  <Text style={styles.portalTitle}>{option.title}</Text>
                  <Text style={styles.portalDescription}>{option.description}</Text>
                </View>
                <MaterialIcons color="#8FA3C1" name="chevron-right" size={25} />
              </Pressable>
            ))}
          </View>

          <View style={styles.integrationNotice}>
            <MaterialIcons color="#52D3B8" name="verified-user" size={19} />
            <View style={styles.integrationCopy}>
              <Text style={styles.integrationTitle}>Connected to your JobSync platform</Text>
              <Text style={styles.integrationText}>
                Your login and Company context stay with the JobSync system. Company membership determines the correct workspace automatically.
              </Text>
            </View>
          </View>

          <Text style={styles.helpText}>
            Company sign-in uses your existing JobSync credentials. If you need access, contact your platform administrator to confirm your Company account.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingBottom: 28, paddingTop: 56 },
  container: { flex: 1, maxWidth: 480, paddingHorizontal: 24, width: "100%", alignSelf: "center" },
  logoSection: { alignItems: "center", marginBottom: 30 },
  logoBox: { alignItems: "center", backgroundColor: "#102038", borderColor: "#243754", borderRadius: 24, borderWidth: 1, height: 88, justifyContent: "center", marginBottom: 16, width: 88 },
  logoImage: { height: 72, width: 72 },
  appName: { color: "#F6F8FC", fontSize: 25, fontWeight: "800", textAlign: "center" },
  appSubtitle: { color: "#94A3B8", fontSize: 15, marginTop: 7, textAlign: "center" },
  portalStack: { gap: 12 },
  portalCard: { alignItems: "center", backgroundColor: "#102038", borderColor: "#243754", borderRadius: 18, borderWidth: 1, flexDirection: "row", minHeight: 112, padding: 16 },
  portalCardPressed: { backgroundColor: "#14294B", borderColor: "#4D8DFF", opacity: 0.96, transform: [{ scale: 0.985 }] },
  portalIcon: { alignItems: "center", backgroundColor: "#17345E", borderRadius: 15, height: 54, justifyContent: "center", marginRight: 14, width: 54 },
  portalCopy: { flex: 1, paddingRight: 8 },
  portalTitle: { color: "#F6F8FC", fontSize: 17, fontWeight: "800" },
  portalDescription: { color: "#B2C1D6", fontSize: 13, lineHeight: 19, marginTop: 4 },
  integrationNotice: { alignItems: "flex-start", backgroundColor: "#0E2730", borderColor: "#1F4E55", borderRadius: 14, borderWidth: 1, flexDirection: "row", marginTop: 24, padding: 15 },
  integrationCopy: { flex: 1, marginLeft: 11 },
  integrationTitle: { color: "#D5F7EE", fontSize: 13, fontWeight: "800", marginBottom: 4 },
  integrationText: { color: "#A9C8C1", fontSize: 12.5, lineHeight: 18 },
  helpText: { color: "#8FA3C1", fontSize: 12.5, lineHeight: 19, marginHorizontal: 12, marginTop: 20, textAlign: "center" },
});
