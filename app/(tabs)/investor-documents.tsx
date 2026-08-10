import React from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Linking, StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { router, useLocalSearchParams } from "expo-router";

const DOC_TYPE_LABELS: Record<string, string> = {
  agreement: "📋 Agreement",
  promissory_note: "📝 Promissory Note",
  receipt: "🧾 Receipt",
  statement: "📊 Statement",
  tax_document: "🏛️ Tax Document",
  company_update: "📢 Company Update",
  other: "📎 Document",
};

export default function InvestorDocumentsScreen() {
  const colors = useColors();
  const { token } = useLocalSearchParams<{ token: string }>();

  const docs = trpc.investor.getDocuments.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  const openDoc = async (url: string) => {
    if (url) await Linking.openURL(url);
  };

  return (
    <ScreenContainer edges={["left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={[styles.backText, { color: colors.primary }]}>← Back</Text>
        </TouchableOpacity>

        <Text style={[styles.title, { color: colors.foreground }]}>📄 Documents</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          Your agreements, statements, and tax documents.
        </Text>

        {docs.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : !docs.data?.length ? (
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>No documents available yet.</Text>
          </View>
        ) : (
          docs.data.map((doc: any) => (
            <TouchableOpacity
              key={doc.documentId}
              style={[styles.docCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => doc.fileUrl && openDoc(doc.fileUrl)}
              activeOpacity={0.8}
            >
              <Text style={[styles.docType, { color: colors.muted }]}>
                {DOC_TYPE_LABELS[doc.documentType] ?? "📎 Document"}
              </Text>
              <Text style={[styles.docTitle, { color: colors.foreground }]}>{doc.documentTitle}</Text>
              <Text style={[styles.docDate, { color: colors.muted }]}>
                {new Date(doc.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </Text>
              {doc.fileUrl ? (
                <Text style={[styles.openLink, { color: colors.primary }]}>Open Document →</Text>
              ) : (
                <Text style={[styles.openLink, { color: colors.muted }]}>Not available</Text>
              )}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  back: { marginBottom: 16 },
  backText: { fontSize: 15, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  subtitle: { fontSize: 14, marginBottom: 24 },
  empty: { borderRadius: 12, borderWidth: 1, padding: 24, alignItems: "center" },
  emptyText: { fontSize: 14 },
  docCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  docType: { fontSize: 12, marginBottom: 4 },
  docTitle: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  docDate: { fontSize: 12, marginBottom: 10 },
  openLink: { fontSize: 13, fontWeight: "600" },
});
