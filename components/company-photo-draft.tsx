import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as NativeRuntime from "react-native";
import { useIsFocused } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import { COMPANY_PHOTO_DRAFT_LABEL, LocalPhotoDraftError, companyPhotoDraftScope, type CompanyPhotoDraftInput } from "@/lib/company-photo-draft";
import { companyPhotoScope } from "@/lib/company-photo-view";
import { companyPhotoBatchLocked, prepareCompanyPhotoBatch, useCompanyPhotoBatch, type CompanyPhotoBatchDraft, type CompanyPhotoBatchResult } from "@/lib/company-photo-batch";

type Source = "Camera" | "Library";
type Identity = { scope: string | null; focused: boolean; foregroundEpoch: number };
type DraftState = {
  identity: Identity; generation: number; source: Source;
  drafts: CompanyPhotoBatchDraft[]; pending: boolean; error: string | null; notice: string | null;
  imageStatus: Record<string, "loading" | "loaded" | "error">;
};
type CompanyPhotoDraftProps = CompanyPhotoDraftInput & {
  headerLabel?: string;
  /** Optional selection category is carried unchanged locally; backend has no category field. */
  category?: CompanyPhotoBatchDraft["category"];
  onUploadBatch?: (drafts: CompanyPhotoBatchDraft[]) => Promise<CompanyPhotoBatchResult>;
};
const appState = "AppState" in NativeRuntime ? NativeRuntime.AppState : undefined;

/** Memory-only previews. Never append local media or upload acknowledgements to Job detail. */
export function CompanyPhotoDraft(props: CompanyPhotoDraftProps) {
  const colors = useJobSheetColors();
  const focused = useIsFocused();
  const ownBatch = useCompanyPhotoBatch({ ...props, onRefresh: props.onRefresh ?? (() => undefined) });
  const external = Boolean(props.onUploadBatch);
  const sending = external ? Boolean(props.operationPending) : ownBatch.pending;
  const scope = companyPhotoDraftScope(props);
  const operationScope = companyPhotoScope(props.session, props.jobId);
  const mounted = useRef(true);
  const live = useRef({ props, focused, scope });
  const [foreground, setForeground] = useState(!appState?.currentState || appState.currentState === "active");
  const [foregroundEpoch, setForegroundEpoch] = useState(0);
  const authority = useMemo(() => ({ scope: operationScope, focused, foregroundEpoch, pending: props.job.pending }), [operationScope, focused, foregroundEpoch, props.job.pending]);
  const identity = useMemo<Identity>(() => ({ scope, focused, foregroundEpoch }), [scope, focused, foregroundEpoch]);
  const authorityRef = useRef(authority);
  const identityRef = useRef(identity);
  const generation = useRef(0);
  const pendingLock = useRef(false);
  const [state, setState] = useState<DraftState | null>(null);
  const [retained, setRetained] = useState<{ authority: typeof authority; selection: DraftState } | null>(null);
  useLayoutEffect(() => {
    live.current = { props, focused, scope };
    authorityRef.current = authority;
    if (identityRef.current !== identity) {
      identityRef.current = identity;
      generation.current++; pendingLock.current = false;
    }
  }, [props, focused, scope, authority, identity]);
  const invalidate = useCallback(() => { generation.current++; pendingLock.current = false; }, []);
  useLayoutEffect(() => {
    mounted.current = true;
    const subscription = appState?.addEventListener("change", (next) => {
      setForeground(next === "active");
      if (next !== "active") {
        authorityRef.current = { ...authorityRef.current };
        invalidate(); setForegroundEpoch((previous) => previous + 1); setRetained(null); setState(null);
      }
    });
    return () => { mounted.current = false; invalidate(); subscription?.remove(); };
  }, [invalidate]);
  const current = useCallback((expectedGeneration?: number) => mounted.current && identityRef.current === identity && Boolean(identity.scope) && live.current.focused && (!appState?.currentState || appState.currentState === "active") && companyPhotoDraftScope(live.current.props) === identity.scope && (expectedGeneration === undefined || generation.current === expectedGeneration), [identity]);
  const visible = useMemo(() => scope && focused && foreground
    ? state?.identity === identity ? state : !sending && retained?.authority === authority ? { ...retained.selection, identity } : null
    : null, [scope, focused, foreground, state, identity, sending, retained, authority]);
  const visibleRef = useRef(visible);
  useLayoutEffect(() => { visibleRef.current = visible; }, [visible]);
  const selectionCurrent = useCallback((selection: DraftState) => current() && visibleRef.current === selection, [current]);
  const busy = Boolean(visible?.pending);
  const disabled = !scope || !focused || !foreground || busy || sending || companyPhotoBatchLocked(props) || (!external && ownBatch.blocked);

  const pick = useCallback(async (source: Source) => {
    if (!current() || disabled || pendingLock.current) return;
    pendingLock.current = true;
    visibleRef.current = null;
    setRetained(null);
    const operation = ++generation.current;
    const initial: DraftState = { identity, generation: operation, source, drafts: [], pending: true, error: null, notice: null, imageStatus: {} };
    setState(initial);
    let stage: "permission" | "picker" | "file" = "permission";
    try {
      const permission = source === "Camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!current(operation)) return;
      if (!permission.granted) { setState({ ...initial, pending: false, error: `${source} permission was denied. Allow access in device Settings if needed, then retry.` }); return; }
      stage = "picker";
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsMultipleSelection: source === "Library", allowsEditing: false, base64: false, exif: false, ...(source === "Library" ? { orderedSelection: true } : {}) };
      const result = source === "Camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (!current(operation)) return;
      if (result.canceled) { setState({ ...initial, pending: false, notice: `${source} cancelled. No local draft was created.` }); return; }
      if (!result.assets?.length || (source === "Camera" && result.assets.length !== 1)) throw new LocalPhotoDraftError(source === "Camera" ? "Select one still photo to prepare a local draft. Retry Camera." : "Select at least one still photo to prepare local drafts. Retry Library.");
      stage = "file";
      const prepared = await prepareCompanyPhotoBatch(result.assets, async (uri) => {
        if (!current(operation)) throw new LocalPhotoDraftError("Photo selection is no longer current.");
        return FileSystem.getInfoAsync(uri);
      }, () => current(operation), props.category);
      if (!current(operation)) return;
      setState({ ...initial, pending: false, drafts: prepared.drafts, error: prepared.errors.length ? `${prepared.errors.length} photo(s) could not be prepared. ${prepared.errors[0]}` : null, notice: prepared.duplicates ? `${prepared.duplicates} repeated selection(s) ignored.` : null });
    } catch (error) {
      if (!current(operation)) return;
      const message = error instanceof LocalPhotoDraftError ? error.message : stage === "permission" ? `Could not request ${source.toLowerCase()} permission. Retry when ready.` : stage === "picker" ? `Could not open ${source.toLowerCase()}. Retry when ready.` : "Could not prepare this local photo. Choose another photo and retry.";
      setState({ ...initial, pending: false, error: message });
    } finally { if (current(operation)) pendingLock.current = false; }
  }, [current, disabled, identity, props.category]);
  const updateImage = useCallback((draft: CompanyPhotoBatchDraft, imageStatus: "loading" | "loaded" | "error") => {
    if (!visible || !selectionCurrent(visible)) return;
    setRetained(null);
    setState((previous) => {
      const selection = previous?.identity === identity ? previous : visible;
      return selection.generation === visible.generation && selection.drafts.includes(draft) ? { ...selection, imageStatus: { ...selection.imageStatus, [draft.uri]: imageStatus } } : previous;
    });
  }, [visible, selectionCurrent, identity]);
  const removeDraft = (draft?: CompanyPhotoBatchDraft) => {
    if (!visible || disabled || pendingLock.current || !selectionCurrent(visible)) return;
    visibleRef.current = null;
    setRetained(null);
    if (draft) setState({ ...visible, drafts: visible.drafts.filter((item) => item !== draft) });
    else { generation.current++; setState(null); }
  };
  const upload = () => {
    if (!visible?.drafts.length || disabled || pendingLock.current || !selectionCurrent(visible)) return;
    pendingLock.current = true;
    visibleRef.current = null;
    const selection = visible;
    const expectedAuthority = authorityRef.current;
    const drafts = visible.drafts.map((draft) => ({ ...draft, assetKeys: [...draft.assetKeys] }));
    generation.current++; setRetained(null); setState(null); // Attempted previews are consumed, never offered as Retry.
    void (props.onUploadBatch ?? ownBatch.upload)(drafts).then((result) => {
      if (!mounted.current || authorityRef.current !== expectedAuthority || !live.current.focused || live.current.props.job.pending || (appState?.currentState && appState.currentState !== "active")) return;
      if (result.remaining.length) {
        setRetained({ authority: expectedAuthority, selection: { ...selection, identity: identityRef.current, generation: generation.current, drafts: result.remaining, pending: false, error: null, notice: `${result.remaining.length} unstarted local draft(s) retained. The attempted photo was not queued again.` } });
      }
    }).catch(() => { /* Transport may have persisted. No preview resurrection or blind retry. */ }).finally(() => { if (mounted.current && authorityRef.current === expectedAuthority) pendingLock.current = false; });
  };
  const preview = (draft: CompanyPhotoBatchDraft, index: number) => {
    const imageStatus = visible?.imageStatus[draft.uri] ?? "loading";
    return <View style={styles.preview}>
      {visible && visible.drafts.length > 1 ? <Text style={{ color: colors.muted }}>Photo {index + 1}{draft.category ? ` · ${draft.category === "before" ? "Before" : "After"}` : ""}</Text> : null}
      {imageStatus !== "error" ? <Image key={`${visible?.generation}:${draft.uri}`} accessibilityLabel="Local draft photo preview" source={{ uri: draft.uri }} resizeMode="contain" style={visible && visible.drafts.length > 1 ? styles.batchImage : styles.image} onLoadStart={() => updateImage(draft, "loading")} onLoad={() => updateImage(draft, "loaded")} onError={() => updateImage(draft, "error")} /> : <View>
        <Text accessibilityRole="alert" style={{ color: colors.error }}>Local photo preview could not load. Discard it or choose another photo.</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Retry ${visible?.source}`} onPress={() => { if (visible) void pick(visible.source); }}><Text style={{ color: colors.primary }}>Retry {visible?.source}</Text></TouchableOpacity>
      </View>}
      {imageStatus === "loading" ? <ActivityIndicator accessibilityLabel="Loading local draft preview" color={colors.primary} /> : null}
      {visible && visible.drafts.length > 1 ? <TouchableOpacity disabled={disabled} accessibilityRole="button" accessibilityLabel={`Remove local draft ${index + 1}`} onPress={() => removeDraft(draft)}><Text style={{ color: colors.primary }}>Remove</Text></TouchableOpacity> : null}
    </View>;
  };
  return <View style={styles.container}>
    <View style={styles.header}>
      {props.headerLabel ? <Text style={[styles.heading, { color: colors.muted }]}>{props.headerLabel}</Text> : null}
      <View style={styles.row}>{(["Camera", "Library"] as const).map((source) => <TouchableOpacity key={source} accessibilityRole="button" accessibilityLabel={source} accessibilityState={{ disabled }} disabled={disabled} onPress={() => { void pick(source); }} style={[styles.captureButton, source === "Library" && styles.libraryButton, { backgroundColor: source === "Camera" ? colors.primary : colors.surface, borderColor: colors.border, opacity: disabled ? 0.35 : 1 }]}><Text style={[styles.captureButtonText, { color: source === "Camera" ? "#fff" : colors.foreground }]}>{source}</Text></TouchableOpacity>)}</View>
    </View>
    {busy ? <ActivityIndicator accessibilityLabel="Preparing local photo draft" color={colors.primary} /> : null}
    {!external && ownBatch.pending ? <ActivityIndicator accessibilityLabel="Sending Company Job photos" color={colors.primary} /> : null}
    {!external && ownBatch.pending && ownBatch.progress ? <Text accessibilityLiveRegion="polite" style={{ color: colors.muted }}>Uploading photo {ownBatch.progress.index} of {ownBatch.progress.total} · {ownBatch.progress.confirmed} confirmed</Text> : null}
    {!external && ownBatch.message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.muted }}>{ownBatch.message}</Text> : null}
    {!external && ownBatch.error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{ownBatch.error}</Text> : null}
    {visible?.notice ? <Text style={{ color: colors.muted }}>{visible.notice}</Text> : null}
    {visible?.error ? <View><Text accessibilityRole="alert" style={{ color: colors.error }}>{visible.error}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Retry ${visible.source}`} onPress={() => { void pick(visible.source); }}><Text style={{ color: colors.primary }}>Retry {visible.source}</Text></TouchableOpacity></View> : null}
    {visible?.drafts.length ? <View style={styles.preview}>
      <Text style={{ color: colors.foreground }}>{COMPANY_PHOTO_DRAFT_LABEL}</Text>
      {visible.drafts.length === 1 ? preview(visible.drafts[0], 0) : <FlatList horizontal data={visible.drafts} keyExtractor={(draft) => draft.uri} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.batchList} renderItem={({ item, index }) => preview(item, index)} />}
      <TouchableOpacity disabled={disabled} accessibilityRole="button" accessibilityLabel="Discard local draft" onPress={() => removeDraft()}><Text style={{ color: colors.primary }}>Discard local draft{visible.drafts.length > 1 ? "s" : ""}</Text></TouchableOpacity>
      <TouchableOpacity disabled={disabled} accessibilityRole="button" accessibilityLabel="Upload local draft" accessibilityState={{ disabled, busy: sending }} onPress={upload} style={[styles.button, { backgroundColor: colors.primary, opacity: disabled ? 0.35 : 1 }]}><Text style={styles.buttonText}>{sending ? "Sending photos…" : visible.drafts.length > 1 ? `Upload ${visible.drafts.length} photos` : "Upload"}</Text></TouchableOpacity>
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  container: { gap: 10 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  heading: { flex: 1, fontSize: 11, lineHeight: 15, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  captureButton: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  libraryButton: { borderWidth: 1 },
  captureButtonText: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  button: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  buttonText: { color: "#fff", fontWeight: "700" },
  preview: { gap: 10 }, image: { width: "100%", height: 200, borderRadius: 8 },
  batchImage: { width: 100, height: 100, borderRadius: 8 }, batchList: { gap: 10 },
});
