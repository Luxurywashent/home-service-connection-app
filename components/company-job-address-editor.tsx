import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useIsFocused } from "expo-router";
import { ActivityIndicator, AppState, StyleSheet, Text, TextInput, type TextInputProps, TouchableOpacity, View } from "react-native";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import {
  companyJobAddressScope, companyJobAddressWriteBlocked, createCompanyJobAddressController,
  COMPANY_JOB_ADDRESS_CONTRACT, companyJobAddressVersionAvailable,
  normalizeCompanyJobAddress, type CompanyJobAddressApi, type CompanyJobAddressDetail,
  type CompanyJobAddressDraft, type CompanyJobAddressWriter,
} from "@/lib/company-job-address";
import type { JobSyncNativeSession } from "@/lib/jobsync-mobile-api";

export type CompanyJobAddressEditorProps = {
  session: JobSyncNativeSession | null;
  /** Parent must derive this from selected Job Company provenance, never a legacy ID. */
  jobId: number | null;
  job: { detail: CompanyJobAddressDetail | null; actor: JobSyncNativeSession | null; loading: boolean; pending: boolean; error: string | null };
  isCurrent: () => boolean;
  /** Explicit manager-only mounting capability; defaults to the verified 2574fb8d contract. */
  addressContract?: typeof COMPANY_JOB_ADDRESS_CONTRACT;
  writeAddress?: CompanyJobAddressWriter;
  /** Validate canonical list/selected-row projection without replacing the baseline while this callback runs. */
  onVerified: (detail: CompanyJobAddressDetail, isCurrent: () => boolean) => Promise<boolean>;
  /** Publish only the returned canonical detail after verification (never submitted draft). */
  onSaved: (detail: CompanyJobAddressDetail) => void;
  api?: CompanyJobAddressApi;
  onInputFocus?: TextInputProps["onFocus"];
  onInputBlur?: TextInputProps["onBlur"];
};

function AddressAction(props: { label: string; onPress: () => void; disabled: boolean; primary: string; muted: string }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={props.label} disabled={props.disabled}
    accessibilityState={{ disabled: props.disabled }} onPress={props.onPress} style={styles.action}>
    <Text style={{ color: props.disabled ? props.muted : props.primary, fontSize: 12 }}>{props.label}</Text>
  </TouchableOpacity>;
}

/** Manager-only Job snapshot editor; parent keeps contact/map and separate legacy-only editor unchanged. */
export function CompanyJobAddressEditor(props: CompanyJobAddressEditorProps) {
  const colors = useJobSheetColors();
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [lifecycle, setLifecycle] = useState(0);
  const scope = companyJobAddressScope(props.session);
  const marker = JSON.stringify([scope, companyJobAddressScope(props.job.actor), props.jobId,
    props.job.detail?.id, props.job.detail?.companyId, props.job.detail?.customerId, props.job.detail?.updatedAt,
    props.job.detail?.serviceAddress, props.addressContract, focused, active, lifecycle, props.job.loading, props.job.pending, props.job.error]);
  const capturedVersion = props.job.detail?.updatedAt;
  const capturedAddress = JSON.stringify(props.job.detail?.serviceAddress);
  const capturedJob = JSON.stringify([props.job.detail?.id, props.job.detail?.companyId, props.job.detail?.customerId,
    props.job.detail?.addressLine1, props.job.detail?.city]);
  const identity = useMemo(() => ({ marker, detail: props.job.detail, writer: props.writeAddress, verified: props.onVerified, saved: props.onSaved, api: props.api, parent: props.isCurrent }),
    [marker, props.job.detail, props.writeAddress, props.onVerified, props.onSaved, props.api, props.isCurrent]);
  const [editor, setEditor] = useState<{ identity: object; draft: CompanyJobAddressDraft; controller: ReturnType<typeof createCompanyJobAddressController> } | null>(null);
  const [feedback, setFeedback] = useState<{ identity: object; busy: boolean; message: string } | null>(null);
  const epoch = useRef<object>(identity);
  const binding = useRef(editor);
  const lock = useRef(false);
  const live = useRef({ props, focused, active, mounted: true });
  useLayoutEffect(() => {
    live.current = { props, focused, active, mounted: live.current.mounted };
    epoch.current = identity;
    binding.current = editor?.identity === identity ? editor : null;
  });
  useEffect(() => {
    const state = live.current;
    state.mounted = true;
    const subscription = AppState.addEventListener("change", (next) => {
      epoch.current = {}; live.current.active = next === "active"; binding.current = null;
      setEditor(null); setLifecycle((value) => value + 1); setActive(next === "active");
    });
    return () => { live.current.mounted = false; epoch.current = {}; binding.current = null; subscription.remove(); };
  }, []);
  useFocusEffect(useCallback(() => () => {
    live.current.focused = false; epoch.current = {}; binding.current = null;
    setEditor(null); setLifecycle((value) => value + 1);
  }, []));
  const current = () => {
    const now = live.current;
    return now.mounted && now.focused && now.active && AppState.currentState === "active"
      && now.props.isCurrent() && Boolean(scope) && epoch.current === identity
      && companyJobAddressScope(now.props.session) === scope && companyJobAddressScope(now.props.job.actor) === scope
      && now.props.jobId === props.jobId && now.props.job.detail === props.job.detail
      && now.props.writeAddress === props.writeAddress && now.props.onVerified === props.onVerified
      && now.props.onSaved === props.onSaved && now.props.api === props.api
      && now.props.isCurrent === props.isCurrent
      && now.props.addressContract === props.addressContract
      && now.props.job.detail?.updatedAt === capturedVersion && JSON.stringify(now.props.job.detail?.serviceAddress) === capturedAddress
      && JSON.stringify([now.props.job.detail?.id, now.props.job.detail?.companyId, now.props.job.detail?.customerId,
        now.props.job.detail?.addressLine1, now.props.job.detail?.city]) === capturedJob
      && !now.props.job.loading && !now.props.job.pending && !now.props.job.error;
  };
  const detail = props.job.detail;
  const address = normalizeCompanyJobAddress(detail?.serviceAddress);
  const valid = Boolean(scope && companyJobAddressScope(props.job.actor) === scope && props.jobId && detail
    && detail.id === props.jobId && detail.companyId === props.session?.company?.id && address
    && detail.addressLine1 === address.addressLine1 && detail.city === address.city);
  const contract = props.addressContract ?? COMPANY_JOB_ADDRESS_CONTRACT;
  const connected = Boolean(props.writeAddress && contract === COMPANY_JOB_ADDRESS_CONTRACT);
  const versionAvailable = companyJobAddressVersionAvailable(detail?.updatedAt);
  const makeController = () => props.session && valid && detail && props.writeAddress ? createCompanyJobAddressController({
    session: props.session, baseline: detail, write: props.writeAddress, isCurrent: current, api: props.api, onVerified: props.onVerified,
  }) : null;
  const begin = () => {
    if (lock.current || !current() || !valid || !connected || !versionAvailable || companyJobAddressWriteBlocked(props.session, props.jobId!)) return;
    const controller = makeController();
    if (!controller || !address) return;
    setEditor({ identity, controller, draft: { addressLine1: address.addressLine1 ?? "", addressLine2: "", city: address.city ?? "", region: address.region ?? "", postalCode: address.postalCode ?? "" } });
    setFeedback(null);
  };
  const save = async () => {
    if (lock.current || !current() || !editor || editor.identity !== identity || binding.current !== editor) return;
    lock.current = true;
    setFeedback({ identity, busy: true, message: "Saving Job service address…" });
    try {
      const result = await editor.controller.save(editor.draft);
      if (!current()) return;
      binding.current = null; setEditor(null);
      setFeedback({ identity, busy: false, message: result.message });
      if (result.status === "saved" && result.detail) props.onSaved(result.detail);
    } finally { lock.current = false; }
  };
  const refresh = async () => {
    if (lock.current || !current() || !connected) return;
    const controller = makeController();
    if (!controller) return;
    lock.current = true; binding.current = null; setEditor(null);
    setFeedback({ identity, busy: true, message: "Reviewing canonical Job address…" });
    try {
      const fresh = await controller.refresh();
      if (!current()) return;
      setFeedback({ identity, busy: false, message: fresh ? "Current Job address reviewed. Open a new edit to make a change." : "Job address could not be reviewed. Do not resend blindly." });
      if (fresh) props.onSaved(fresh);
    } finally { lock.current = false; }
  };
  if (!scope || !focused || !active || !props.isCurrent() || !valid) return null;
  const local = feedback?.identity === identity ? feedback : null;
  const editing = editor?.identity === identity ? editor : null;
  const busy = props.job.loading || props.job.pending || Boolean(local?.busy);
  const blocked = companyJobAddressWriteBlocked(props.session, props.jobId!);
  const editable = !busy && !props.job.error && !blocked && connected && versionAvailable;
  return <View testID="company-job-address-editor" style={[styles.card, { borderColor: colors.border, backgroundColor: colors.background }]}>
    <Text style={[styles.title, { color: colors.foreground }]}>Job Service Address</Text>
    <Text style={[styles.hint, { color: colors.muted }]}>Changes this Job only, not the customer profile or other appointments.</Text>
    {busy ? <ActivityIndicator accessibilityLabel="Saving or reviewing Job address" color={colors.primary} /> : null}
    {local?.message ? <Text accessibilityRole="alert" style={[styles.hint, { color: colors.muted }]}>{local.message}</Text> : null}
    {editing ? <>
      <TextInput accessibilityLabel="Address line 2 (unavailable)" value={editing.draft.addressLine2 ?? ""} editable={false}
        placeholder="Address line 2 — not supported by this backend" placeholderTextColor={colors.muted}
        style={[styles.input, { borderColor: colors.border, color: colors.muted }]} />
      {([ ["addressLine1", "Street address", 255], ["city", "City", 96], ["region", "State or region", 96], ["postalCode", "Postal code", 24] ] as const).map(([field, label, maxLength]) =>
        <TextInput key={field} accessibilityLabel={label} value={editing.draft[field]} maxLength={maxLength} editable={!busy}
          placeholder={label} placeholderTextColor={colors.muted} autoComplete="off" autoCorrect={false}
          onFocus={props.onInputFocus} onBlur={props.onInputBlur}
          onChangeText={(value) => {
            if (!current() || lock.current || binding.current !== editing) return;
            setEditor((old) => old?.identity === identity ? { ...old, draft: { ...old.draft, [field]: value } } : old);
          }} style={[styles.input, { borderColor: colors.border, color: colors.foreground }]} />)}
      <View style={styles.actions}>
        <AddressAction label="Cancel address edit" disabled={busy} primary={colors.primary} muted={colors.muted}
          onPress={() => { if (current() && !lock.current) { binding.current = null; setEditor(null); } }} />
        <AddressAction label="Save Job address" disabled={!editable} primary={colors.primary} muted={colors.muted} onPress={() => { void save(); }} />
      </View>
    </> : editable ? <AddressAction label="Edit Job address" disabled={busy} primary={colors.primary} muted={colors.muted} onPress={begin} /> : null}
    <Text style={[styles.hint, { color: colors.muted }]}>The verified backend cannot save address line 2. No line 2 value will be sent or silently discarded.</Text>
    {!connected ? <Text style={[styles.hint, { color: colors.muted }]}>Service address editing is unavailable until the authorized backend is connected.</Text> : null}
    {!versionAvailable ? <Text accessibilityRole="alert" style={[styles.hint, { color: colors.muted }]}>The Job version is unavailable. Refresh and review before editing.</Text> : null}
    {blocked && !busy ? <Text accessibilityRole="alert" style={[styles.hint, { color: colors.muted }]}>An earlier address save is pending or unconfirmed. Refresh and review; do not resend blindly.</Text> : null}
    {connected ? <AddressAction label="Refresh and review Job address" disabled={busy} primary={colors.primary} muted={colors.muted} onPress={() => { void refresh(); }} /> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { borderTopWidth: 1, borderBottomWidth: 1, paddingHorizontal: 20, paddingVertical: 14, gap: 8, marginBottom: 8, minWidth: 0 },
  title: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  hint: { fontSize: 12, lineHeight: 18 },
  input: { borderWidth: 1, borderRadius: 6, padding: 10, minHeight: 44, fontSize: 13 },
  action: { paddingVertical: 12, paddingHorizontal: 4, minHeight: 44 },
  actions: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 16 },
});
