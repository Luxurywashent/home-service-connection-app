import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFocusEffect, useIsFocused } from "expo-router";
import {
  ActivityIndicator, AppState, StyleSheet, Text, TextInput,
  type TextInputProps, TouchableOpacity, View,
} from "react-native";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import type { JobSyncCompanyJobDetail, JobSyncNativeSession } from "@/lib/jobsync-mobile-api";

/** Structural view of the injected hook; no transport, cache, legacy Job or suggestion catalog. */
export type CompanyJobTagsModel = {
  tags: {
    id: number; jobId: number; displayName: string; normalizedName: string;
    createdBy: number; createdAt: string | null; updatedAt: string | null;
  }[] | null;
  actor: JobSyncNativeSession | null;
  detail: Pick<JobSyncCompanyJobDetail, "id" | "companyId" | "assignedUserId"> | null;
  loading: boolean;
  pending: boolean;
  error: string | null;
  success: string | null;
  reviewRequired: boolean;
  refresh: () => Promise<void>;
  review: () => Promise<void>;
  add: (name: string) => Promise<boolean>;
  remove: (tagId: number) => Promise<boolean>;
};

export type CompanyJobTagsProps = {
  session: JobSyncNativeSession | null;
  /** Only a Company-provenanced canonical Job ID. */
  jobId: number | null;
  model: CompanyJobTagsModel;
  /** Captured committed parent Company Job operation guard and epoch. Both are required. */
  isCurrent: () => boolean;
  operationScopeKey: string;
  variant?: "schedule" | "admin";
  readOnly?: boolean;
  cardRef?: React.Ref<View>;
  onInputFocus?: TextInputProps["onFocus"];
  onInputBlur?: TextInputProps["onBlur"];
};

const positiveId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const sessionKey = (session: JobSyncNativeSession | null, jobId: number | null) => {
  if (!session || session.portal !== "company" || !session.token?.trim()
    || !positiveId(session.company?.id) || !positiveId(session.user.id) || !positiveId(jobId)
    || !["owner", "dispatcher", "technician"].includes(session.user.role)) return null;
  return JSON.stringify([session.token, session.company.id, session.user.id, session.user.role, jobId]);
};
const hasAccess = (props: CompanyJobTagsProps) => {
  const scope = sessionKey(props.session, props.jobId);
  const detail = props.model.detail;
  return Boolean(scope && sessionKey(props.model.actor, props.jobId) === scope && detail
    && detail.id === props.jobId && detail.companyId === props.session?.company?.id);
};
// Mirrors only the declared service name rules; DB equality and persistence remain controller authority.
const tagName = (value: unknown) => {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name || name.length > 64 || Array.from(name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  return { name, normalizedName: name.toLocaleLowerCase("en-US") };
};

/** Existing compact Job Tags slot. Hook/controller owns all freshness, writes, readback and uncertainty. */
export function CompanyJobTags({ cardRef, ...props }: CompanyJobTagsProps) {
  const colors = useJobSheetColors();
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [lifecycle, setLifecycle] = useState(0);
  const scope = sessionKey(props.session, props.jobId);
  const parentCurrent = props.isCurrent();
  const actorScope = sessionKey(props.model.actor, props.jobId);
  const detailId = props.model.detail?.id;
  const companyId = props.model.detail?.companyId;
  const assignment = props.model.detail?.assignedUserId;
  const marker = JSON.stringify([scope, props.operationScopeKey, focused, active, lifecycle, parentCurrent,
    props.variant, props.readOnly, props.model.detail?.id, props.model.detail?.companyId,
    props.model.detail?.assignedUserId, sessionKey(props.model.actor, props.jobId)]);
  const { add, remove, refresh, review } = props.model;
  const [identity, setIdentity] = useState({ marker });
  if (identity.marker !== marker) setIdentity({ marker });
  const committed = useRef<object | null>(identity);
  const live = useRef({ props, mounted: true, focused, active });
  const [editor, setEditor] = useState<{ identity: object; value: string } | null>(null);
  const editorBinding = useRef(editor);
  const lock = useRef<object | null>(null);
  const [feedback, setFeedback] = useState<{ identity: object; busy: boolean; error: string | null } | null>(null);
  const [localReview, setLocalReview] = useState<object | null>(null);
  const reviewBarrier = useRef<object | null>(null);
  useLayoutEffect(() => {
    committed.current = identity;
    live.current = { props, mounted: live.current.mounted, focused, active };
    editorBinding.current = editor?.identity === identity ? editor : null;
  });
  useEffect(() => {
    const binding = live.current;
    binding.mounted = true;
    const subscription = AppState.addEventListener("change", (next) => {
      committed.current = null;
      live.current.active = next === "active";
      editorBinding.current = null;
      setEditor(null);
      setLifecycle((value) => value + 1);
      setActive(next === "active");
    });
    return () => {
      live.current.mounted = false;
      committed.current = null;
      editorBinding.current = null;
      subscription.remove();
    };
  }, []);
  useFocusEffect(useCallback(() => () => {
    live.current.focused = false;
    committed.current = null;
    editorBinding.current = null;
    setEditor(null);
    setLifecycle((value) => value + 1);
  }, []));

  const current = () => {
    const now = live.current;
    return now.mounted && now.focused && now.active && AppState.currentState === "active"
      && now.props.isCurrent() && Boolean(scope) && committed.current === identity
      && sessionKey(now.props.session, now.props.jobId) === scope
      && sessionKey(now.props.model.actor, now.props.jobId) === actorScope
      && now.props.model.detail?.id === detailId
      && now.props.model.detail?.companyId === companyId
      && now.props.model.detail?.assignedUserId === assignment
      && now.props.operationScopeKey === props.operationScopeKey;
  };
  const collection = JSON.stringify(props.model.tags);
  const writable = () => current() && hasAccess(props) && !live.current.props.readOnly
    && reviewBarrier.current !== identity
    && !live.current.props.model.loading && !live.current.props.model.pending
    && !live.current.props.model.reviewRequired && !live.current.props.model.error
    && live.current.props.model.tags !== null && JSON.stringify(live.current.props.model.tags) === collection;
  const editing = editor?.identity === identity ? editor : null;
  const inline = props.variant === "admin";
  const visibleEditor = inline || Boolean(editing);
  const draft = editing?.value ?? "";
  const candidate = tagName(draft);
  const duplicate = Boolean(candidate && props.model.tags?.some((tag) => tag.normalizedName === candidate.normalizedName));
  const local = feedback?.identity === identity ? feedback : null;
  const busy = props.model.loading || props.model.pending || Boolean(local?.busy);
  const reviewRequired = props.model.reviewRequired || localReview === identity;
  const editable = hasAccess(props) && !props.readOnly && props.model.tags !== null
    && !busy && !reviewRequired && !props.model.error;

  const change = (value: string) => {
    if (!writable() || lock.current || typeof value !== "string") return;
    if (!inline && (!editing || editorBinding.current !== editing)) return;
    const next = { identity, value };
    editorBinding.current = next;
    setEditor(next);
  };
  const toggle = () => {
    if (!writable() || lock.current) return;
    if (editing) {
      if (editorBinding.current !== editing) return;
      editorBinding.current = null;
      setEditor(null);
    } else {
      const next = { identity, value: "" };
      editorBinding.current = next;
      setEditor(next);
    }
  };
  const run = async (action: () => Promise<unknown>, clearDraft = false, mutation = false) => {
    if (lock.current || !current()) return;
    const ticket = {};
    lock.current = ticket;
    setFeedback({ identity, busy: true, error: null });
    try {
      const confirmed = await action();
      if (!current()) return;
      // Never add/remove a chip locally. Only the injected canonical collection is rendered.
      if (confirmed === true && clearDraft && editorBinding.current === editing) {
        const next = { identity, value: "" };
        editorBinding.current = next;
        setEditor(next);
      }
      setFeedback({ identity, busy: false, error: null });
    } catch {
      if (current()) {
        if (mutation) {
          reviewBarrier.current = identity;
          setLocalReview(identity);
        }
        setFeedback({ identity, busy: false, error:
          "Tags could not be confirmed. Refresh and review the current tags before trying again." });
      }
    } finally {
      if (lock.current === ticket) lock.current = null;
    }
  };
  const submit = () => {
    if (!writable() || lock.current || !editing || editorBinding.current !== editing || !candidate || duplicate) return;
    void run(() => add(candidate.name), true, true);
  };
  const removeTag = (tagId: number) => {
    if (!writable() || lock.current || (!inline && (!editing || editorBinding.current !== editing))
      || !positiveId(tagId) || !live.current.props.model.tags?.some((tag) => tag.id === tagId && tag.jobId === props.jobId)) return;
    void run(() => remove(tagId), false, true);
  };
  const reload = (acknowledge: boolean) => {
    if (!current() || lock.current || live.current.props.model.loading || live.current.props.model.pending) return;
    editorBinding.current = null;
    setEditor(null);
    void run(async () => {
      await (acknowledge ? review() : refresh());
      if (acknowledge && current() && hasAccess(props) && live.current.props.model.tags !== null
        && !live.current.props.model.error && !live.current.props.model.reviewRequired
        && !live.current.props.model.loading && !live.current.props.model.pending) {
        reviewBarrier.current = null;
        setLocalReview(null);
      }
    });
  };

  if (!scope || !focused || !active || AppState.currentState !== "active" || !parentCurrent) return null;
  const allowed = hasAccess(props);
  const readable = allowed && props.model.tags !== null;
  const error = props.model.error || local?.error;
  const hint = busy ? "Loading job tags…"
    : error || (!readable ? "Job tags are not verified. Refresh to check availability and access." : null);
  const removeEnabled = editable && (inline || Boolean(editing));
  const addEnabled = editable && Boolean(candidate) && !duplicate;
  return (
    <View ref={cardRef} collapsable={false} testID="company-job-tags"
      style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Job Tags</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh job tags"
            accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => reload(false)}
            activeOpacity={0.7} style={styles.refresh}>
            <Text style={[styles.refreshText, { color: colors.primary }]}>Refresh</Text>
          </TouchableOpacity>
          {!inline && editable ? <TouchableOpacity accessibilityRole="button"
            accessibilityLabel={editing ? "Done editing job tags" : "Edit job tags"}
            onPress={toggle} activeOpacity={0.7} style={[styles.toggle, {
              backgroundColor: editing ? colors.surface : colors.primary + "22",
              borderColor: editing ? colors.border : colors.primary,
            }]}>
            <Text style={[styles.toggleText, { color: editing ? colors.muted : colors.primary }]}>{editing ? "Done" : "+ Add"}</Text>
          </TouchableOpacity> : null}
        </View>
      </View>
      {busy ? <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Loading job tags" /> : null}
      {hint ? <Text accessibilityRole={error ? "alert" : undefined}
        style={[styles.hint, { color: error ? colors.error : colors.muted }]}>{hint}</Text> : null}
      {readable ? <View style={styles.chips}>
        {props.model.tags!.map((tag) => <TouchableOpacity key={tag.id}
          accessibilityRole={removeEnabled ? "button" : undefined}
          accessibilityLabel={removeEnabled ? `Remove job tag ${tag.displayName}` : `Job tag ${tag.displayName}`}
          accessibilityState={{ disabled: !removeEnabled }} disabled={!removeEnabled}
          onPress={() => removeTag(tag.id)} activeOpacity={0.7}
          style={[styles.chip, inline && styles.adminChip, { backgroundColor: colors.primary + "22", borderColor: colors.primary + "66" }]}>
          <Text style={[styles.chipText, { color: colors.primary }]}>{tag.displayName}</Text>
          {removeEnabled ? <Text accessible={false} style={[styles.removeText, { color: colors.primary }]}>×</Text> : null}
        </TouchableOpacity>)}
        {props.model.tags!.length === 0 ? <Text style={[styles.hint, { color: colors.muted }]}>
          {editable && !inline && !editing ? "No tags yet. Tap + Add to label this job." : "No tags yet."}
        </Text> : null}
      </View> : null}
      {visibleEditor && allowed && !props.readOnly && props.model.tags !== null && !reviewRequired ? <>
        <View style={styles.inputRow}>
          <TextInput testID="company-job-tags-input" accessibilityLabel="New job tag" value={draft}
            editable={editable} onChangeText={change} onFocus={props.onInputFocus} onBlur={props.onInputBlur}
            placeholder={inline ? "Add tag..." : "Type a tag and press Add"} placeholderTextColor={colors.muted}
            autoCorrect={false} autoComplete="off" returnKeyType="done" onSubmitEditing={submit}
            style={[styles.input, inline && styles.adminInput, { color: colors.foreground, borderColor: colors.border }]} />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add job tag"
            accessibilityState={{ disabled: !addEnabled }} disabled={!addEnabled} onPress={submit}
            activeOpacity={0.7} style={[styles.add, inline && styles.adminAdd, { backgroundColor: colors.primary }, !addEnabled && styles.disabled]}>
            <Text style={styles.addText}>Add</Text>
          </TouchableOpacity>
        </View>
        {draft && (!candidate || duplicate) ? <Text accessibilityRole="alert" style={[styles.hint, { color: colors.error }]}>
          {duplicate ? "That tag already exists on this Job." : "Enter a tag of 64 characters or fewer after normalization, without unsupported control characters."}
        </Text> : null}
      </> : null}
      {reviewRequired ? <>
        <Text accessibilityRole="alert" style={[styles.hint, { color: colors.muted }]}>A change is pending or unconfirmed. Review the current tags before retrying; no change will be resent.</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh and review job tags"
          disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => reload(true)} activeOpacity={0.7} style={styles.review}>
          <Text style={[styles.refreshText, { color: colors.primary }]}>Refresh &amp; review</Text>
        </TouchableOpacity>
      </> : props.readOnly && readable ? <Text style={[styles.hint, { color: colors.muted }]}>Read-only job tags.</Text> : null}
      {props.model.success && readable && !busy && !error && !reviewRequired ?
        <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: colors.muted }]}>{props.model.success}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderTopWidth: 1, borderBottomWidth: 1, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 8, gap: 8, minWidth: 0 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: "700", flexShrink: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  toggle: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  toggleText: { fontSize: 12, lineHeight: 17, fontWeight: "600" },
  refresh: { paddingVertical: 6, paddingHorizontal: 4 },
  refreshText: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
  hint: { fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%" },
  adminChip: { borderWidth: 0, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 13, lineHeight: 18, fontWeight: "600", flexShrink: 1 },
  removeText: { fontSize: 12, lineHeight: 17 },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, lineHeight: 20 },
  adminInput: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  add: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, justifyContent: "center" },
  adminAdd: { borderRadius: 8, paddingVertical: 6 },
  addText: { color: "#fff", fontWeight: "700", fontSize: 14, lineHeight: 20 },
  disabled: { opacity: 0.5 },
  review: { alignSelf: "flex-start", paddingVertical: 6 },
});
