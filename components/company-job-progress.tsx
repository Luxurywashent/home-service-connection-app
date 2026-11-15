import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { companyDurationMs, companyFieldworkBlockReason, nextCompanyFieldStatus } from "@/lib/company-job-fieldwork";
import type { JobSyncNativeSession, JobSyncFieldStatus } from "@/lib/jobsync-mobile-api";
import type { useCompanyJob } from "@/hooks/use-company-job";

type Props = { session: JobSyncNativeSession | null; job: ReturnType<typeof useCompanyJob>; timezone?: string | null; onRefresh?: () => void | Promise<void> };
const actions: { label: string; target: JobSyncFieldStatus }[] = [
  { label: "ON MY WAY", target: "en_route" }, { label: "ARRIVED", target: "on_site" }, { label: "FINISH", target: "completed" },
];
function formatInstant(value: string | null, timezone?: string | null) {
  if (!value) return "Unknown";
  if (!timezone) return `${value} (server time; Company timezone unavailable)`;
  try { return new Date(value).toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return value; }
}
function formatDuration(value: number | null) {
  return value === null ? "Unknown" : `${Math.round(value / 60000)} min`;
}
export function CompanyJobProgress({ job, timezone, onRefresh }: Props) {
  const colors = useColors();
  const detail = job.detail;
  const reason = companyFieldworkBlockReason(job.actor, detail);
  const next = detail ? nextCompanyFieldStatus(detail.status) : null;
  const press = (target: JobSyncFieldStatus) => {
    if (reason || job.loading || job.pending || next !== target) return;
    if (target === "on_site") {
      Alert.alert("Mark as Arrived?", "Only tap Arrived when you are physically at the customer location.", [
        { text: "Not Yet", style: "cancel" },
        { text: "Yes, I've Arrived", onPress: () => { void job.advance(target); } },
      ]);
    } else { void job.advance(target); }
  };
  return <View style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
    <Text style={[styles.heading, { color: colors.foreground }]}>Job Progress</Text>
    <Text style={{ color: colors.muted }}>Backend status: {detail?.status ?? (job.loading ? "Loading" : "Unavailable")}</Text>
    <View style={styles.row}>{actions.map(({ label, target }) => {
      const disabled = Boolean(reason || job.loading || job.pending || next !== target);
      return <TouchableOpacity key={target} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => press(target)} style={[styles.action, { backgroundColor: colors.primary, opacity: disabled ? 0.35 : 1 }]}>
        <Text style={styles.actionText}>{label}</Text>
      </TouchableOpacity>;
    })}</View>
    {job.loading || job.pending ? <ActivityIndicator color={colors.primary} /> : null}
    {reason ? <Text style={{ color: colors.muted }}>{reason}</Text> : null}
    {job.error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{job.error}</Text> : null}
    {job.success ? <Text style={{ color: colors.success }}>{job.success}</Text> : null}
    <TouchableOpacity disabled={job.pending || job.loading} onPress={() => { void (onRefresh ? onRefresh() : job.refresh()); }} style={styles.refresh}><Text style={{ color: colors.primary }}>Refresh Job</Text></TouchableOpacity>
    {[
      ["On My Way", detail?.enRouteAt ?? null], ["Arrived / Started", detail?.onSiteAt ?? null], ["Finished", detail?.completedAt ?? null],
    ].map(([label, value]) => <View key={label} style={styles.milestone}><Text style={{ color: colors.foreground }}>{label}</Text><Text style={{ color: colors.muted }}>{formatInstant(value, timezone)}</Text></View>)}
    <Text style={{ color: colors.muted }}>Drive Time: {formatDuration(companyDurationMs(detail?.enRouteAt ?? null, detail?.onSiteAt ?? null))}</Text>
    <Text style={{ color: colors.muted }}>Job Time: {formatDuration(companyDurationMs(detail?.onSiteAt ?? null, detail?.completedAt ?? null))}</Text>
    <Text style={{ color: colors.muted, fontSize: 11 }}>Job milestones use server time. Company clock-in, clock-out and breaks remain separate.</Text>
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 16, borderTopWidth: 1, borderBottomWidth: 1, marginVertical: 8, gap: 8 },
  heading: { fontSize: 15, fontWeight: "700" }, row: { flexDirection: "row", gap: 8 },
  action: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  actionText: { fontSize: 10, fontWeight: "700", color: "#fff" }, refresh: { paddingVertical: 8 }, milestone: { gap: 2 },
});
