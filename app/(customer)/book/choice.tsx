import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

export default function BookChoiceStep() {
  const router = useRouter();

  const handleSignIn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/login" as any);
  };

  const handleContinueAsGuest = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/(customer)/book/vehicle" as any);
  };

  return (
    <ScreenContainer className="p-6">
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Ready to Book?</Text>
          <Text style={styles.subtitle}>Sign in to your account or continue as a guest</Text>
        </View>

        {/* Sign In Card */}
        <TouchableOpacity
          style={styles.card}
          onPress={handleSignIn}
          activeOpacity={0.85}
        >
          <View style={styles.cardContent}>
            <View style={styles.cardIcon}>
              <MaterialIcons name="login" size={28} color="#0057FF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Sign In</Text>
              <Text style={styles.cardDescription}>
                Access your bookings, saved vehicles, and account settings
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color="#9CA3AF" />
          </View>
        </TouchableOpacity>

        {/* Continue as Guest Card */}
        <TouchableOpacity
          style={styles.card}
          onPress={handleContinueAsGuest}
          activeOpacity={0.85}
        >
          <View style={styles.cardContent}>
            <View style={styles.cardIcon}>
              <MaterialIcons name="person-outline" size={28} color="#059669" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Continue as Guest</Text>
              <Text style={styles.cardDescription}>
                Book now without an account. We'll send confirmation to your email.
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color="#9CA3AF" />
          </View>
        </TouchableOpacity>

        {/* Info Note */}
        <View style={styles.infoBox}>
          <MaterialIcons name="info" size={16} color="#0369A1" />
          <Text style={styles.infoText}>
            You can create an account anytime after booking to track your service history.
          </Text>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    gap: 24,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1A1A1A",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#6B7280",
    lineHeight: 22,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    overflow: "hidden",
  },
  cardContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  cardIcon: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: "#F3F4F6",
    justifyContent: "center",
    alignItems: "center",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 13,
    color: "#6B7280",
    lineHeight: 18,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#F0F9FF",
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  infoText: {
    fontSize: 12,
    color: "#0369A1",
    flex: 1,
    lineHeight: 16,
  },
});
