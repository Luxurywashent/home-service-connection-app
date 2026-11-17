import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useFocusEffect, useIsFocused } from "expo-router";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import { companyDurationMs, companyFieldworkBlockReason, companyFieldworkErrorHint, companyJobActorBlockReason, companyJobSessionKey, nextCompanyFieldStatus } from "@/lib/company-job-fieldwork";
import type { JobSyncNativeSession, JobSyncFieldStatus } from "@/lib/jobsync-mobile-api";
import type { useCompanyJob } from "@/hooks/use-company-job";

type Props = {
  session: JobSyncNativeSession | null;
  job: ReturnType<typeof useCompanyJob>;
  timezone?: string | null;
  onRefresh?: () => void | Promise<void>;
};
const actions: { label: string; icon: string; color: string; target: JobSyncFieldStatus }[] = [
  { label: "ON MY WAY", icon: "🚚", color: "#F59E0B", target: "en_route" },
  { label: "ARRIVED", icon: "▶️", color: "#10B981", target: "on_site" },
  { label: "FINISH", icon: "⏹️", color: "#6B7280", target: "completed" },
];
function compactBlockHint(reason: string, status?: string) {
  if (reason.includes("fresh signed")) return "Refresh your Company session to continue.";
  if (reason.includes("identity") || reason.includes("current Company's Job")) return "Company identity changed. Refresh your session and job.";
  if (reason.includes("signed role")) return "This role cannot update progress.";
  if (reason.includes("currently assigned")) return "Backend requires assignment. Ask a Company admin to update.";
  if (reason.includes("Job version")) return "Refresh this job before updating progress.";
  if (reason.includes("terminal")) return status === "completed" ? "Job finished." : "Job cancelled.";
  return "No progress action is available for this job.";
}
export function CompanyJobProgress({ session, job, onRefresh }: Props) {
  const colors = useJobSheetColors();
  const focused = useIsFocused();
  const detail = job.detail;
  const scope = companyJobSessionKey(session, detail?.id ?? null);
  const actorScope = companyJobSessionKey(job.actor, detail?.id ?? null);
  const live = useRef({ session, job, scope, focused, mounted: true });
  const confirmation = useRef<object | null>(null);
  const busy = job.loading || job.pending;
  const identity = useMemo(() => ({ scope, actorScope, focused, detail, busy }), [scope, actorScope, focused, detail, busy]);
  const epoch = useRef<{ identity: object | null }>({ identity: null });
  const lock = useRef(false);
  useLayoutEffect(() => {
    const committedEpoch = epoch.current;
    live.current.mounted = true;
    return () => { live.current.mounted = false; confirmation.current = null; committedEpoch.identity = {}; };
  }, []);
  useLayoutEffect(() => {
    live.current = { session, job, scope, focused, mounted: live.current.mounted };
    if (epoch.current.identity !== identity) {
      epoch.current.identity = identity;
      confirmation.current = null;
    }
  });
  useFocusEffect(useCallback(() => {
    return () => { live.current.focused = false; confirmation.current = null; epoch.current.identity = {}; };
  }, []));
  const reason = companyJobActorBlockReason(session, job.actor) || companyFieldworkBlockReason(session, detail) || companyFieldworkBlockReason(job.actor, detail);
  const next = detail ? nextCompanyFieldStatus(detail.status) : null;
  const current = (target?: JobSyncFieldStatus) => {
    const now = live.current;
    return now.mounted && now.focused && Boolean(scope) && now.scope === scope && epoch.current.identity === identity && now.job.detail === detail && !now.job.loading && !now.job.pending
      && (!target || (!companyJobActorBlockReason(now.session, now.job.actor) && !companyFieldworkBlockReason(now.session, now.job.detail) && !companyFieldworkBlockReason(now.job.actor, now.job.detail) && nextCompanyFieldStatus(now.job.detail!.status) === target));
  };
  const advance = (target: JobSyncFieldStatus) => {
    if (lock.current || !current(target)) return;
    lock.current = true;
    void job.advance(target).finally(() => { lock.current = false; });
  };
  const press = (target: JobSyncFieldStatus) => {
    if (lock.current || !current(target)) return;
    if (target === "on_site") {
      if (confirmation.current) return;
      const ticket = {};
      confirmation.current = ticket;
      Alert.alert("Mark as Arrived?", "Only tap Arrived when you are physically at the customer location. Arrived starts the Job and records the backend Start time.", [
        { text: "Not Yet", style: "cancel", onPress: () => { if (confirmation.current === ticket) confirmation.current = null; } },
        { text: "Yes, I've Arrived", onPress: () => {
          if (confirmation.current !== ticket || !current(target)) return;
          confirmation.current = null;
          advance(target);
        } },
      ], { onDismiss: () => { if (confirmation.current === ticket) confirmation.current = null; } });
    } else advance(target);
  };
  // Durations require both canonical timestamps. No local running clock or placeholder zero.
  const driveTime = companyDurationMs(detail?.enRouteAt ?? null, detail?.onSiteAt ?? null);
  const jobTime = companyDurationMs(detail?.onSiteAt ?? null, detail?.completedAt ?? null);
  const hint = job.error ? companyFieldworkErrorHint(job.error)
    : job.loading ? "Loading progress…" : job.pending ? "Updating progress…"
    : reason ? compactBlockHint(reason, detail?.status) : job.success ? "Progress updated." : null;
  const showRefresh = Boolean(reason || job.error || job.loading);
  return <View style={styles.inline}>
    <View style={styles.row}>{actions.map(({ label, icon, color, target }) => {
      const disabled = Boolean(!focused || reason || job.loading || job.pending || next !== target);
      const active = detail?.status === target;
      return <TouchableOpacity key={target} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={target === "on_site" ? "Start the Job by marking arrival at the customer location." : undefined} accessibilityState={{ disabled }} disabled={disabled} onPress={() => press(target)} activeOpacity={0.7} style={[styles.action, { opacity: disabled ? 0.35 : 1 }]}>
        <View style={[styles.circle, { backgroundColor: active ? color : colors.surface, borderColor: active ? color : colors.border }]}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
        <Text style={[styles.label, { color }]}>{label}</Text>
      </TouchableOpacity>;
    })}</View>
    {driveTime !== null || jobTime !== null ? <View style={styles.times}>
      {driveTime !== null ? <Text style={[styles.time, { color: "#F59E0B" }]}>Drive Time: {Math.round(driveTime / 60000)} min</Text> : null}
      {jobTime !== null ? <Text style={[styles.time, { color: "#10B981" }]}>Job Time: {Math.round(jobTime / 60000)} min</Text> : null}
    </View> : null}
    {hint || showRefresh ? <View style={styles.feedback}>
      {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      {hint ? <Text accessibilityRole={job.error ? "alert" : undefined} style={[styles.hint, { color: job.error ? colors.error : job.success && !reason && !busy ? colors.success : colors.muted }]}>{hint}</Text> : null}
      {showRefresh ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh job progress" accessibilityState={{ disabled: !focused || job.pending || job.loading }} disabled={!focused || job.pending || job.loading} onPress={() => { if (current()) void (onRefresh ? onRefresh() : job.refresh()); }} style={styles.refresh}>
        <Text style={[styles.refreshText, { color: colors.primary }]}>Refresh</Text>
      </TouchableOpacity> : null}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  inline: { gap: 8 },
  row: { flexDirection: "row", justifyContent: "space-around", alignItems: "center" },
  action: { alignItems: "center" },
  circle: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, justifyContent: "center", alignItems: "center", marginBottom: 6 },
  icon: { fontSize: 22, lineHeight: 30 },
  label: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  times: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 16 },
  time: { fontSize: 11, lineHeight: 16, fontWeight: "600", fontVariant: ["tabular-nums"] },
  feedback: { flexDirection: "row", alignItems: "center", gap: 6 },
  hint: { flex: 1, fontSize: 11, lineHeight: 16 },
  refresh: { paddingVertical: 4, paddingHorizontal: 4 },
  refreshText: { fontSize: 11, fontWeight: "600" },
});
