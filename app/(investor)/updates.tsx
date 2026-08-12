import React from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { router, useLocalSearchParams } from "expo-router";

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  business_progress:  { label: "Business Progress", color: "#3B82F6" },
  fleet_expansion:    { label: "Fleet Expansion", color: "#8B5CF6" },
  revenue_milestone:  { label: "Revenue Milestone", color: "#22C55E" },
  repayment_update:   { label: "Repayment Update", color: "#F59E0B" },
  important_notice:   { label: "Important Notice", color: "#EF4444" },
  general:            { label: "General", color: "#6B7280" },
};

export default function InvestorUpdatesScreen() {
  const colors = useColors();
  const { token } = useLocalSearchParams<{ token: string }>();

  const updates = trpc.investor.getUpdates.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.replace("/(investor)/dashboard" as any)} style={styles.back}>
          <Text style={[styles.backText, { color: colors.primary }]}>← Back</Text>
        </TouchableOpacity>

        <Text style={[styles.title, { color: colors.foreground }]}>📢 Investor Updates</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          Latest news and updates from Home Service Connection.
        </Text>

        {updates.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : !updates.data?.length ? (
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>No updates yet. Check back soon.</Text>
          </View>
        ) : (
          updates.data.map((u: any) => {
            const cat = CATEGORY_LABELS[u.category] ?? { label: u.category ?? "General", color: "#6B7280" };
            return (
              <View
                key={u.updateId}
                style={[styles.updateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={styles.updateHeader}>
                  <View style={[styles.catBadge, { backgroundColor: cat.color + "20", borderColor: cat.color }]}>
                    <Text style={[styles.catText, { color: cat.color }]}>{cat.label}</Text>
                  </View>
                  <Text style={[styles.updateDate, { color: colors.muted }]}>
                    {new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </Text>
                </View>
                <Text style={[styles.updateTitle, { color: colors.foreground }]}>{u.title}</Text>
                <Text style={[styles.updateBody, { color: colors.muted }]}>{u.body}</Text>
                {u.createdBy ? (
                  <Text style={[styles.postedBy, { color: colors.muted }]}>— {u.createdBy}</Text>
                ) : null}
              </View>
            );
          })
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
  updateCard: { borderRadius: 14, borderWidth: 1, padding: 18, marginBottom: 14 },
  updateHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  catBadge: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  catText: { fontSize: 11, fontWeight: "700" },
  updateDate: { fontSize: 12 },
  updateTitle: { fontSize: 17, fontWeight: "700", marginBottom: 8 },
  updateBody: { fontSize: 14, lineHeight: 21, marginBottom: 8 },
  postedBy: { fontSize: 12, fontStyle: "italic" },
});
