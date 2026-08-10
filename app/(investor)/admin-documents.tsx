import React from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet, Linking, Alert } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { router } from "expo-router";

const DOC_ICONS: Record<string, string> = {
  agreement: "📄",
  promissory_note: "📝",
  receipt: "🧾",
  statement: "📊",
  tax_document: "🏛️",
  company_update: "📢",
  other: "📁",
};

export default function AdminDocumentsScreen() {
  const colors = useColors();
  const investors = trpc.investor.adminListInvestors.useQuery();
  const utils = trpc.useUtils();

  const deleteDoc = trpc.investor.adminDeleteDocument.useMutation({
    onSuccess: () => utils.investor.adminListInvestors.invalidate(),
  });

  // Flatten all documents from all investors
  const allDocs: any[] = [];
  (investors.data ?? []).forEach((inv: any) => {
    (inv.documents ?? []).forEach((d: any) => {
      allDocs.push({ ...d, investorName: `${inv.firstName} ${inv.lastName}` });
    });
  });

  allDocs.sort((a, b) => new Date(b.uploadedAt ?? b.createdAt).getTime() - new Date(a.uploadedAt ?? a.createdAt).getTime());

  const handleDelete = (docId: string, title: string) => {
    Alert.alert("Delete Document", `Delete "${title}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteDoc.mutate({ documentId: docId }) },
    ]);
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.replace("/(investor)/admin-home" as any)} style={styles.back}>
          <Text style={[styles.backText, { color: colors.primary }]}>← Dashboard</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>📁 Documents</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>All investor documents</Text>
        <View style={[styles.hint, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.hintText, { color: colors.muted }]}>
            To upload documents for a specific investor, go to Investors → Manage → Docs tab.
          </Text>
        </View>

        {investors.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : !allDocs.length ? (
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>No documents uploaded yet.</Text>
          </View>
        ) : (
          allDocs.map((d: any) => (
            <View key={d.documentId} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Text style={styles.docIcon}>{DOC_ICONS[d.documentType] ?? "📁"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.docTitle, { color: colors.foreground }]} numberOfLines={1}>{d.documentTitle}</Text>
                  <Text style={[styles.investorName, { color: colors.primary }]}>{d.investorName}</Text>
                </View>
                <View style={[styles.typeBadge, { backgroundColor: colors.border }]}>
                  <Text style={[styles.typeText, { color: colors.muted }]}>{d.documentType?.replace(/_/g, " ")}</Text>
                </View>
              </View>
              <View style={styles.cardFooter}>
                <Text style={[styles.date, { color: colors.muted }]}>
                  {d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                </Text>
                <View style={styles.actions}>
                  {d.fileUrl ? (
                    <TouchableOpacity onPress={() => Linking.openURL(d.fileUrl)} style={[styles.actionBtn, { backgroundColor: colors.primary + "20" }]}>
                      <Text style={[styles.actionText, { color: colors.primary }]}>View</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity onPress={() => handleDelete(d.documentId, d.documentTitle)} style={[styles.actionBtn, { backgroundColor: "#EF444420" }]}>
                    <Text style={[styles.actionText, { color: "#EF4444" }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  back: { marginBottom: 12, alignSelf: "flex-start" },
  backText: { fontSize: 15, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2, marginBottom: 12 },
  hint: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 16 },
  hintText: { fontSize: 12, lineHeight: 17 },
  empty: { borderRadius: 12, borderWidth: 1, padding: 24, alignItems: "center" },
  emptyText: { fontSize: 14 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
  docIcon: { fontSize: 24, marginTop: 2 },
  docTitle: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
  investorName: { fontSize: 12, fontWeight: "600" },
  typeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  typeText: { fontSize: 10, fontWeight: "600", textTransform: "capitalize" },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  date: { fontSize: 12 },
  actions: { flexDirection: "row", gap: 8 },
  actionBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  actionText: { fontSize: 12, fontWeight: "700" },
});
