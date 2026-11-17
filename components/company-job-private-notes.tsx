import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFocusEffect, useIsFocused } from "expo-router";
import {
  ActivityIndicator,
  AppState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import {
  canReadCompanyJobPrivateNotes,
  companyJobPrivateNotesScope,
  formatCompanyJobPrivateNotes,
  COMPANY_PRIVATE_NOTES_EDIT_UNAVAILABLE,
  type CompanyJobPrivateNotesDetail,
} from "@/lib/company-job-private-notes";
import type { JobSyncNativeSession } from "@/lib/jobsync-mobile-api";

export type CompanyJobPrivateNotesProps = {
  session: JobSyncNativeSession | null;
  /** Explicitly Company-provenanced selected Job ID, not a legacy/local Job. */
  jobId: number | null;
  job: {
    detail: CompanyJobPrivateNotesDetail | null;
    actor: JobSyncNativeSession | null;
    loading: boolean;
    pending: boolean;
    error: string | null;
    refresh: () => void | Promise<void>;
  };
  /** Parent screen/session/selected-job generation guard. Required; never default to true. */
  isCurrent: () => boolean;
  onRefresh?: () => void | Promise<void>;
};

/** Internal detail only. No editor until an authorized bearer REST edit contract exists. */
export function CompanyJobPrivateNotes(props: CompanyJobPrivateNotesProps) {
  const colors = useJobSheetColors();
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [lifecycle, setLifecycle] = useState(0);
  const scope = companyJobPrivateNotesScope(props.session, props.jobId);
  const actorScope = companyJobPrivateNotesScope(props.job.actor, props.jobId);
  const parentCurrent = props.isCurrent();
  const marker = JSON.stringify([
    scope,
    actorScope,
    focused,
    active,
    lifecycle,
    parentCurrent,
    props.job.loading,
    props.job.pending,
    props.job.error,
    props.job.detail?.id,
    props.job.detail?.companyId,
    props.job.detail?.assignedUserId,
    props.job.detail?.updatedAt,
    props.job.detail?.privateNotes,
  ]);
  const identity = useMemo(
    () => ({ marker, detail: props.job.detail }),
    [marker, props.job.detail],
  );
  const epoch = useRef({ identity });
  const live = useRef({ props, focused, active, mounted: true });
  useLayoutEffect(() => {
    live.current = { props, focused, active, mounted: live.current.mounted };
    epoch.current.identity = identity;
  });
  const lock = useRef<object | null>(null);
  const [feedback, setFeedback] = useState<{
    identity: object;
    loading: boolean;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    const lifecycleEpoch = epoch.current;
    live.current.mounted = true;
    const subscription = AppState.addEventListener("change", (next) => {
      // Invalidate synchronously, even if active -> background -> active happens before render.
      lifecycleEpoch.identity = { marker: "invalidated", detail: null };
      live.current.active = next === "active";
      setLifecycle((value) => value + 1);
      setActive(next === "active");
    });
    return () => {
      live.current.mounted = false;
      lifecycleEpoch.identity = { marker: "invalidated", detail: null };
      subscription.remove();
    };
  }, []);
  useFocusEffect(
    useCallback(
      () => () => {
        live.current.focused = false;
        epoch.current.identity = { marker: "invalidated", detail: null };
        setLifecycle((value) => value + 1);
      },
      [],
    ),
  );

  const current = () => {
    const now = live.current;
    return (
      now.mounted &&
      now.focused &&
      now.active &&
      AppState.currentState === "active" &&
      now.props.isCurrent() &&
      Boolean(scope) &&
      epoch.current.identity === identity &&
      companyJobPrivateNotesScope(now.props.session, now.props.jobId) ===
        scope &&
      companyJobPrivateNotesScope(now.props.job.actor, now.props.jobId) ===
        actorScope &&
      now.props.job.detail === props.job.detail &&
      !now.props.job.loading &&
      !now.props.job.pending
    );
  };
  const refresh = async () => {
    if (lock.current || !current()) return;
    const ticket = {};
    lock.current = ticket;
    setFeedback({ identity, loading: true, error: false });
    try {
      // Reuse the parent's signed session + canonical bearer detail refresh. No alternate transport.
      await (props.onRefresh ? props.onRefresh() : props.job.refresh());
      if (current()) setFeedback({ identity, loading: false, error: false });
    } catch {
      if (current()) setFeedback({ identity, loading: false, error: true });
    } finally {
      if (lock.current === ticket) lock.current = null;
    }
  };

  if (
    !scope ||
    !focused ||
    !active ||
    AppState.currentState !== "active" ||
    !parentCurrent
  )
    return null;
  // Stale or unauthorized detail cannot expose even a read-only note. Initial/failed reads show no text.
  if (
    (props.job.actor && actorScope !== scope) ||
    (props.job.detail &&
      !canReadCompanyJobPrivateNotes(props.session, props.jobId, {
        ...props.job,
        loading: false,
        pending: false,
        error: null,
      }))
  )
    return null;
  const local = feedback?.identity === identity ? feedback : null;
  const busy =
    props.job.loading || props.job.pending || Boolean(local?.loading);
  const failed = Boolean(props.job.error || local?.error);
  const readable =
    !busy &&
    !failed &&
    canReadCompanyJobPrivateNotes(props.session, props.jobId, props.job);
  const value = readable ? props.job.detail?.privateNotes : undefined;
  const text =
    typeof value === "string" || value === null
      ? formatCompanyJobPrivateNotes(value)
      : null;
  const hint = busy
    ? "Loading private notes…"
    : failed
      ? "Private notes could not be verified. Refresh to retry."
      : text === null
        ? "Private notes are unavailable. Refresh Job detail to check."
        : text || "No private notes.";
  return (
    <View
      testID="company-job-private-notes"
      style={[
        styles.card,
        { backgroundColor: colors.background, borderColor: colors.border },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Private Notes
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Refresh private job notes"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          activeOpacity={0.7}
          onPress={() => {
            void refresh();
          }}
          style={styles.refresh}
        >
          <Text style={[styles.refreshText, { color: colors.primary }]}>
            Refresh
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.privacy, { color: colors.muted }]}>
        Internal Company only · Not customer-visible
      </Text>
      {busy ? (
        <ActivityIndicator
          size="small"
          color={colors.primary}
          accessibilityLabel="Loading private job notes"
        />
      ) : null}
      <Text
        testID="company-job-private-notes-body"
        accessibilityRole={failed ? "alert" : undefined}
        selectable={readable && text !== null}
        style={[
          styles.body,
          {
            color: failed
              ? colors.error
              : text
                ? colors.foreground
                : colors.muted,
          },
        ]}
      >
        {hint}
      </Text>
      <Text style={[styles.privacy, { color: colors.muted }]}>
        {COMPANY_PRIVATE_NOTES_EDIT_UNAVAILABLE}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginBottom: 8,
    gap: 6,
    minWidth: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  title: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  refresh: { paddingHorizontal: 4, paddingVertical: 6 },
  refreshText: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
  body: { fontSize: 13, lineHeight: 19 },
  privacy: { fontSize: 11, lineHeight: 16 },
});
