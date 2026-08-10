import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { MaterialIcons } from "@expo/vector-icons";

export default function GuestBookingLookupScreen() {
  const router = useRouter();
  const [bookingRef, setBookingRef] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const lookupMutation = trpc.customer.lookupGuestBooking.useQuery(
    { email: "", bookingRef: bookingRef.trim() },
    { enabled: false }
  );

  async function handleLookup() {
    if (!bookingRef.trim()) {
      Alert.alert("Missing Reference", "Please enter your booking reference number.");
      return;
    }

    setLoading(true);
    try {
      const data = await lookupMutation.refetch();
      if (data.data) {
        setResult(data.data);
      } else {
        Alert.alert(
          "Booking Not Found",
          "We couldn't find a booking with that email and reference number. Please check and try again."
        );
        setResult(null);
      }
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Something went wrong. Please try again.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }

  function getStatusColor(status: string) {
    switch (status) {
      case "completed":
        return "#059669";
      case "cancelled":
        return "#DC2626";
      case "confirmed":
      case "en_route":
      case "in_progress":
        return "#0a7ea4";
      default:
        return "#6B7280";
    }
  }

  function getStatusLabel(status: string) {
    return status
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  return (
    <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Track Your Booking</Text>
            <View style={{ width: 24 }} />
          </View>

          <View style={styles.container}>
            {!result ? (
              <>
                {/* Info Section */}
                <View style={styles.infoSection}>
                  <MaterialIcons name="search" size={48} color="#0a7ea4" />
                  <Text style={styles.infoTitle}>Find Your Booking</Text>
                  <Text style={styles.infoSubtitle}>
                    Enter your booking reference number to check your booking status.
                  </Text>
                </View>

                {/* Form Section */}
                <View style={styles.formSection}>
                  <View style={styles.formGroup}>
                    <Text style={styles.label}>Booking Reference</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g., bk17862026944916d404dda"
                      placeholderTextColor="#9CA3AF"
                      value={bookingRef}
                      onChangeText={setBookingRef}
                      autoCapitalize="none"
                      editable={!loading}
                    />
                    <Text style={styles.hint}>
                      You received this in your confirmation email
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[styles.lookupBtn, loading && styles.lookupBtnDisabled]}
                    onPress={handleLookup}
                    disabled={loading}
                    activeOpacity={0.85}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <>
                        <MaterialIcons name="search" size={20} color="#FFFFFF" />
                        <Text style={styles.lookupBtnText}>Look Up Booking</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                {/* Result Section */}
                <View style={styles.resultSection}>
                  <View style={styles.successIcon}>
                    <MaterialIcons name="check-circle" size={48} color="#059669" />
                  </View>

                  <Text style={styles.resultTitle}>Booking Found</Text>

                  {/* Status Badge */}
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: getStatusColor(result.status) + "20", borderColor: getStatusColor(result.status) },
                    ]}
                  >
                    <Text style={[styles.statusBadgeText, { color: getStatusColor(result.status) }]}>
                      {getStatusLabel(result.status)}
                    </Text>
                  </View>

                  {/* Booking Details */}
                  <View style={styles.detailsCard}>
                    <DetailRow icon="directions-car" label="Vehicle" value={result.vehicleLabel} />
                    <DetailRow icon="local-offer" label="Service" value={result.packageName} />
                    <DetailRow icon="event" label="Date" value={formatDate(result.scheduledDate)} />
                    <DetailRow icon="schedule" label="Time" value={result.scheduledTime} />
                    <DetailRow icon="location-on" label="Location" value={result.city} />
                    <DetailRow icon="attach-money" label="Total" value={`$${result.total.toFixed(2)}`} />
                  </View>

                  {/* Reference Box */}
                  <View style={styles.refBox}>
                    <Text style={styles.refLabel}>Booking Reference</Text>
                    <Text style={styles.refValue}>{result.bookingRef}</Text>
                  </View>

                  {/* Info Card */}
                  <View style={styles.infoCard}>
                    <MaterialIcons name="info" size={18} color="#0a7ea4" />
                    <Text style={styles.infoCardText}>
                      {result.status === "completed"
                        ? "Your booking has been completed. Thank you for choosing Luxury Wash On Wheels!"
                        : result.status === "cancelled"
                        ? "This booking has been cancelled."
                        : "We'll send you updates about your booking via email. Check your inbox for confirmation details."}
                    </Text>
                  </View>

                  {/* Action Buttons */}
                  <TouchableOpacity
                    style={styles.newSearchBtn}
                    onPress={() => {
                      setResult(null);
                      setBookingRef("");
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.newSearchBtnText}>Search Another Booking</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.homeBtn}
                    onPress={() => router.replace("/(customer)/home" as any)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.homeBtnText}>Back to Home</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailRowLeft}>
        <MaterialIcons name={icon as any} size={18} color="#6B7280" />
        <Text style={styles.detailLabel}>{label}</Text>
      </View>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1A1A1A",
  },
  container: {
    flex: 1,
    padding: 20,
    paddingBottom: 40,
  },
  infoSection: {
    alignItems: "center",
    marginBottom: 32,
    marginTop: 20,
  },
  infoTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#1A1A1A",
    marginTop: 16,
    marginBottom: 8,
  },
  infoSubtitle: {
    fontSize: 15,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 22,
  },
  formSection: {
    marginBottom: 24,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1A1A1A",
  },
  hint: {
    fontSize: 12,
    color: "#9CA3AF",
    marginTop: 6,
  },
  lookupBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#0a7ea4",
    borderRadius: 100,
    paddingVertical: 16,
    paddingHorizontal: 40,
    marginTop: 8,
  },
  lookupBtnDisabled: {
    opacity: 0.6,
  },
  lookupBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  resultSection: {
    alignItems: "center",
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#D1FAE5",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  resultTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#1A1A1A",
    marginBottom: 16,
  },
  statusBadge: {
    borderRadius: 100,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1.5,
    marginBottom: 24,
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  detailsCard: {
    width: "100%",
    backgroundColor: "#F9FAFB",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    gap: 12,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  detailRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6B7280",
  },
  detailValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1A1A1A",
    textAlign: "right",
    flex: 1,
  },
  refBox: {
    width: "100%",
    backgroundColor: "#F5F5F5",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 20,
  },
  refLabel: {
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  refValue: {
    fontSize: 16,
    fontWeight: "800",
    color: "#1A1A1A",
    marginTop: 4,
  },
  infoCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "#F0F9FF",
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: "#0a7ea4",
  },
  infoCardText: {
    flex: 1,
    fontSize: 13,
    color: "#0c5a7a",
    lineHeight: 19,
  },
  newSearchBtn: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#0a7ea4",
    borderRadius: 100,
    paddingVertical: 14,
    paddingHorizontal: 40,
    alignItems: "center",
    marginBottom: 12,
  },
  newSearchBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0a7ea4",
  },
  homeBtn: {
    paddingVertical: 12,
  },
  homeBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6B7280",
    textAlign: "center",
  },
});
