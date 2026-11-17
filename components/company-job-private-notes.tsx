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
  TextInput,
  type TextInputProps,
  TouchableOpacity,
  View,
} from "react-native";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import {
  canReadCompanyJobPrivateNotes,
  canEditCompanyJobPrivateNotes,
  companyJobPrivateNotesScope,
  formatCompanyJobPrivateNotes,
  validCompanyJobPrivateNoteInput,
  COMPANY_PRIVATE_NOTES_EDIT_UNAVAILABLE,
  type CompanyJobPrivateNotesDetail,
} from "@/lib/company-job-private-notes";
import {
  companyJobPrivateNotesWriteBlocked,
  createCompanyJobPrivateNotesController,
  type CompanyJobPrivateNotesWriter,
} from "@/lib/company-job-private-notes-api";
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
  /** Exact 2818bb72 manager PATCH adapter; must forward the fourth expectedUpdatedAt argument. */
  writePrivateNotes?: CompanyJobPrivateNotesWriter;
  onInputFocus?: TextInputProps["onFocus"];
  onInputBlur?: TextInputProps["onBlur"];
};

/** Internal detail only; editing requires the explicit authorized bearer REST adapter. */
export function CompanyJobPrivateNotes(props: CompanyJobPrivateNotesProps) {
  const colors = useJobSheetColors();
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [lifecycle, setLifecycle] = useState(0);
  const scope = companyJobPrivateNotesScope(props.session, props.jobId);
  const actorScope = companyJobPrivateNotesScope(props.job.actor, props.jobId);
  const parentCurrent = props.isCurrent();
  const capturedVersion = props.job.detail?.updatedAt;
  const capturedNote = props.job.detail?.privateNotes;
  const capturedAssignment = props.job.detail?.assignedUserId;
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
    () => ({
      marker,
      detail: props.job.detail,
      writer: props.writePrivateNotes,
    }),
    [marker, props.job.detail, props.writePrivateNotes],
  );
  const [editor, setEditor] = useState<{
    identity: object;
    value: string;
    controller: ReturnType<typeof createCompanyJobPrivateNotesController>;
  } | null>(null);
  const editorBinding = useRef(editor);
  const epoch = useRef({ identity });
  const live = useRef({ props, focused, active, mounted: true });
  useLayoutEffect(() => {
    live.current = { props, focused, active, mounted: live.current.mounted };
    epoch.current.identity = identity;
    editorBinding.current = editor?.identity === identity ? editor : null;
  });
  const lock = useRef<object | null>(null);
  const [feedback, setFeedback] = useState<{
    identity: object;
    loading: boolean;
    error: boolean;
    message?: string;
  } | null>(null);
  useEffect(() => {
    const lifecycleEpoch = epoch.current;
    live.current.mounted = true;
    const subscription = AppState.addEventListener("change", (next) => {
      // Invalidate synchronously, even if active -> background -> active happens before render.
      lifecycleEpoch.identity = {
        marker: "invalidated",
        detail: null,
        writer: undefined,
      };
      live.current.active = next === "active";
      editorBinding.current = null;
      setEditor(null);
      setLifecycle((value) => value + 1);
      setActive(next === "active");
    });
    return () => {
      live.current.mounted = false;
      lifecycleEpoch.identity = {
        marker: "invalidated",
        detail: null,
        writer: undefined,
      };
      subscription.remove();
    };
  }, []);
  useFocusEffect(
    useCallback(
      () => () => {
        live.current.focused = false;
        epoch.current.identity = {
          marker: "invalidated",
          detail: null,
          writer: undefined,
        };
        editorBinding.current = null;
        setEditor(null);
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
      now.props.writePrivateNotes === props.writePrivateNotes &&
      now.props.job.detail?.updatedAt === capturedVersion &&
      now.props.job.detail?.privateNotes === capturedNote &&
      now.props.job.detail?.assignedUserId === capturedAssignment &&
      !now.props.job.loading &&
      !now.props.job.pending
    );
  };
  const makeController = () => {
    if (
      !props.session ||
      !props.jobId ||
      !props.job.detail ||
      !props.writePrivateNotes
    )
      return null;
    return createCompanyJobPrivateNotesController({
      session: props.session,
      jobId: props.jobId,
      detail: props.job.detail,
      write: props.writePrivateNotes,
      isCurrent: current,
    });
  };
  const beginEdit = () => {
    if (
      lock.current ||
      !current() ||
      !canEditCompanyJobPrivateNotes(props.session, props.jobId, props.job) ||
      companyJobPrivateNotesWriteBlocked(props.session, props.jobId)
    )
      return;
    const controller = makeController();
    if (!controller) return;
    // Plain text is copied byte-for-byte. Structured legacy records remain read-only.
    setEditor({
      identity,
      value: props.job.detail!.privateNotes ?? "",
      controller,
    });
    setFeedback(null);
  };
  const save = async () => {
    if (
      lock.current ||
      !current() ||
      editor?.identity !== identity ||
      !editor ||
      editorBinding.current !== editor ||
      !validCompanyJobPrivateNoteInput(editor.value) ||
      !canEditCompanyJobPrivateNotes(props.session, props.jobId, props.job)
    )
      return;
    const ticket = {};
    lock.current = ticket;
    setFeedback({ identity, loading: true, error: false });
    try {
      const result = await editor.controller.save(editor.value);
      if (!current()) return;
      editorBinding.current = null;
      setEditor(null);
      setFeedback({
        identity,
        loading: false,
        error: result.status !== "saved",
        message: result.message,
      });
      // Never publish submitted text optimistically. Parent refresh uses canonical bearer detail only.
      if (result.status === "saved") {
        try {
          await (props.onRefresh ? props.onRefresh() : props.job.refresh());
        } catch {
          if (current())
            setFeedback({
              identity,
              loading: false,
              error: true,
              message:
                "Private notes were verified, but the displayed Job could not refresh. Refresh before editing.",
            });
        }
      }
    } finally {
      if (lock.current === ticket) lock.current = null;
    }
  };
  const refresh = async () => {
    if (lock.current || !current()) return;
    const ticket = {};
    lock.current = ticket;
    editorBinding.current = null;
    setEditor(null);
    setFeedback({ identity, loading: true, error: false });
    try {
      // Reconcile uncertain writes with fresh signed membership + canonical detail, never another PATCH.
      const controller = makeController();
      if (controller && !(await controller.refresh()))
        throw new Error("Private notes could not be verified.");
      if (!current()) return;
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
  const editing = editor?.identity === identity ? editor : null;
  const writeBlocked = companyJobPrivateNotesWriteBlocked(
    props.session,
    props.jobId,
  );
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
      ? (local?.message ??
        "Private notes could not be verified. Refresh to retry.")
      : text === null
        ? "Private notes are unavailable. Refresh Job detail to check."
        : text || "No private notes.";
  const editable =
    !busy &&
    !failed &&
    !writeBlocked &&
    Boolean(props.writePrivateNotes) &&
    canEditCompanyJobPrivateNotes(props.session, props.jobId, props.job);
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
      {editing ? (
        <>
          <TextInput
            testID="company-job-private-notes-editor"
            accessibilityLabel="Edit internal Company private notes"
            value={editing.value}
            multiline
            maxLength={4000}
            textAlignVertical="top"
            editable={!busy}
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            onFocus={props.onInputFocus}
            onBlur={props.onInputBlur}
            onChangeText={(value) => {
              if (
                !current() ||
                lock.current ||
                editorBinding.current !== editing ||
                !validCompanyJobPrivateNoteInput(value)
              )
                return;
              setEditor((prior) =>
                prior?.identity === identity ? { ...prior, value } : prior,
              );
            }}
            style={[
              styles.editor,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
          />
          <View style={styles.actions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Cancel private notes edit"
              disabled={busy}
              accessibilityState={{ disabled: busy }}
              onPress={() => {
                if (!current() || lock.current) return;
                editorBinding.current = null;
                setEditor(null);
              }}
              style={styles.refresh}
            >
              <Text style={[styles.refreshText, { color: colors.muted }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Save private job notes"
              disabled={!editable}
              accessibilityState={{ disabled: !editable }}
              onPress={() => {
                void save();
              }}
              style={styles.refresh}
            >
              <Text style={[styles.refreshText, { color: colors.primary }]}>
                Save
              </Text>
            </TouchableOpacity>
          </View>
        </>
      ) : editable ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Edit private job notes"
          onPress={beginEdit}
          style={styles.editAction}
        >
          <Text style={[styles.refreshText, { color: colors.primary }]}>
            Edit
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={[styles.privacy, { color: colors.muted }]}>
          {!props.writePrivateNotes
            ? COMPANY_PRIVATE_NOTES_EDIT_UNAVAILABLE
            : writeBlocked
              ? "An earlier save is pending or unconfirmed. Refresh and review before editing; do not resend blindly."
              : "Read-only private notes. Editing requires verified Company manager access and plain-text notes."}
        </Text>
      )}
      {local?.message && !local.error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.privacy, { color: colors.muted }]}
        >
          {local.message}
        </Text>
      ) : null}
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
  editor: {
    minHeight: 86,
    maxHeight: 180,
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    fontSize: 13,
    lineHeight: 19,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  editAction: {
    alignSelf: "flex-end",
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
});
