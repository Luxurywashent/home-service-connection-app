import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useColors } from "@/hooks/use-colors";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import { getJobSyncCompanyCustomers } from "@/lib/jobsync-mobile-api";
import { customerContactUrl, findJobCustomerPhone } from "@/lib/customer-contact";

type ContactResult = { key: string; status: "ready" | "error"; phone: string | null };

type Props = {
  customerId?: string | number | null;
  phone?: string | null;
  requireCompanyProfile: boolean;
  jobSheet?: boolean;
};

export function CustomerContactActions({ customerId, phone, requireCompanyProfile, jobSheet = false }: Props) {
  const themeColors = useColors();
  const jobSheetColors = useJobSheetColors();
  const colors = jobSheet ? jobSheetColors : themeColors;
  const { session } = useJobSyncAuth();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ContactResult | null>(null);
  const [opening, setOpening] = useState(false);
  const isCompany = requireCompanyProfile || session?.portal === "company";
  const token = session?.portal === "company" ? session.token : null;
  const companyId = session?.portal === "company" ? session.company?.id : null;
  const userId = session?.user.id;
  const key = JSON.stringify([companyId, userId, token, customerId, attempt]);
  const validCustomerId = Number.isSafeInteger(Number(customerId)) && Number(customerId) > 0;

  useEffect(() => {
    if (!isCompany || !token || !companyId || !validCustomerId) return;
    let cancelled = false;
    // Read the same Company-scoped customer profiles used by customer lookup.
    // Contact failure must not clear or interrupt the Schedule itself.
    getJobSyncCompanyCustomers(token)
      .then((customers) => {
        if (!cancelled) setResult({ key, status: "ready", phone: findJobCustomerPhone(customers, customerId) });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, status: "error", phone: null });
      });
    return () => { cancelled = true; };
  }, [isCompany, token, companyId, validCustomerId, customerId, key]);

  // Never reuse contact details from a previous Company, user, job, or token.
  const currentResult = result?.key === key ? result : null;
  const loading = isCompany && !!token && !!companyId && validCustomerId && !currentResult;
  const resolvedPhone = isCompany ? currentResult?.phone : phone;
  const canCall = !!customerContactUrl("call", resolvedPhone);
  const canMessage = !!customerContactUrl("message", resolvedPhone);

  const openContact = async (action: "call" | "message") => {
    const url = customerContactUrl(action, resolvedPhone);
    if (!url || opening) return;
    setOpening(true);
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        action === "call" ? "Unable to open phone app" : "Unable to open messages",
        `This device could not open ${action === "call" ? "the dialer" : "the message composer"}. You can use the customer's profile number: ${resolvedPhone}`,
      );
    } finally {
      setOpening(false);
    }
  };

  const unavailable = currentResult?.status === "error"
    ? "Could not load the customer's profile phone number."
    : isCompany && !validCustomerId
      ? "This job is not linked to a customer profile."
      : resolvedPhone && !canCall
        ? "The customer's phone number is not in a supported format."
        : "No phone number on this customer's profile.";

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.note, { color: colors.muted }]}>Loading customer phone…</Text>
        </View>
      ) : (
        <Text selectable style={[styles.note, { color: colors.muted }]}>{canCall ? (jobSheet ? `Customer phone: ${resolvedPhone}` : resolvedPhone) : unavailable}</Text>
      )}
      <View style={styles.actions}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Call customer"
          accessibilityState={{ disabled: !canCall || opening }}
          disabled={!canCall || opening}
          onPress={() => void openContact("call")}
          style={[styles.button, jobSheet && styles.jobButton, { borderColor: colors.primary, backgroundColor: jobSheet ? colors.primary : colors.primary + "18", opacity: canCall && !opening ? 1 : 0.45 }]}
        >
          <MaterialIcons name="call" size={18} color={jobSheet ? "#fff" : colors.primary} />
          <Text style={[styles.label, { color: jobSheet ? "#fff" : colors.primary }]}>{jobSheet ? "Call Customer" : "Call"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Message customer"
          accessibilityState={{ disabled: !canMessage || opening }}
          disabled={!canMessage || opening}
          onPress={() => void openContact("message")}
          style={[styles.button, jobSheet && styles.jobButton, { borderColor: jobSheet ? "#10906b" : colors.primary, backgroundColor: jobSheet ? "#10906b" : colors.primary + "18", opacity: canMessage && !opening ? 1 : 0.45 }]}
        >
          <MaterialIcons name="chat-bubble-outline" size={18} color={jobSheet ? "#fff" : colors.primary} />
          <Text style={[styles.label, { color: jobSheet ? "#fff" : colors.primary }]}>{jobSheet ? "Message Customer" : "Message"}</Text>
        </TouchableOpacity>
        {isCompany && currentResult?.status === "error" && (
          <TouchableOpacity accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)} style={styles.retry}>
            <Text style={[styles.label, { color: colors.primary }]}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 4, marginBottom: 10, gap: 8 },
  loading: { flexDirection: "row", alignItems: "center", gap: 8 },
  note: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderRadius: 10, minHeight: 44, paddingHorizontal: 16 },
  jobButton: { flex: 1, minWidth: 140, paddingHorizontal: 10, borderRadius: 10 },
  label: { fontSize: 14, fontWeight: "700" },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
});
