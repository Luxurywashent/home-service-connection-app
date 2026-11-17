import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import { useIsFocused } from "expo-router";
import { CompanyPhotoDraft } from "@/components/company-photo-draft";
import {
  companyPhotoScope,
  currentCompanyGallery,
  currentCompanyPhotos,
  sameCompanyPhoto,
  canDeleteCompanyPhoto,
} from "@/lib/company-photo-view";
import { useCompanyPhotoOperation } from "@/lib/company-photo-operation";
import { useCompanyPhotoBatch } from "@/lib/company-photo-batch";
import type {
  JobSyncJobPhoto,
  JobSyncNativeSession,
} from "@/lib/jobsync-mobile-api";
import type { useCompanyJob } from "@/hooks/use-company-job";

/** Memory-only selection, not persisted media. Scope includes the complete signed session. */
export type CompanyPhotoSelection = {
  scope: string;
  photoId: number;
  imageUrl: string;
};
type PhotoJobProps = {
  session: JobSyncNativeSession | null;
  /** The same explicitly Company-provenanced Job ID supplied to useCompanyJob. */
  jobId: number | null;
  job: Pick<
    ReturnType<typeof useCompanyJob>,
    "detail" | "loading" | "pending" | "error" | "refresh"
  > & Partial<Pick<ReturnType<typeof useCompanyJob>, "verifiedPhotoDetail" | "acceptVerifiedDetail">>;
  /** Must refresh canonical bearer Job detail; never an Image reload or legacy media read. */
  onRefresh?: () => void | Promise<void>;
};
type GalleryProps = PhotoJobProps & {
  onPreview: (photo: CompanyPhotoSelection) => void;
};
type PreviewProps = PhotoJobProps & {
  photo: CompanyPhotoSelection | null;
  onClose: () => void;
};

const IMAGE_ERROR =
  "Photo could not load. Its signed link may have expired. Refresh Job photos to retry; JobSync must renew expired links.";

function photoProps<T extends PhotoJobProps>(props: T): T {
  return props.job.verifiedPhotoDetail && !props.job.loading && !props.job.pending
    ? { ...props, job: { ...props.job, detail: props.job.verifiedPhotoDetail, error: null } }
    : props;
}

function useMounted() {
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

function usePhotoRefresh(props: PhotoJobProps, isCurrent: () => boolean) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useMounted();
  const refresh = async () => {
    if (
      !mounted.current ||
      !isCurrent() ||
      lock.current ||
      props.job.pending ||
      props.job.loading
    )
      return;
    lock.current = true;
    setRefreshing(true);
    setError(null);
    try {
      // No URL rewriting, signature synthesis, cookies, cache-busting or mutation fallback.
      if (props.onRefresh) await props.onRefresh();
      else await props.job.refresh();
    } catch {
      if (mounted.current && isCurrent())
        setError("Could not refresh Company Job photos. Retry when connected.");
    } finally {
      lock.current = false;
      if (mounted.current && isCurrent()) setRefreshing(false);
    }
  };
  return { refreshing, error, refresh };
}

/** Scoped native image state; URL changes remount this child, discarding old callbacks. */
function CompanyPhotoImage({
  photo,
  preview = false,
  isCurrent,
  onRetry,
  onPreview,
  onLongPress,
}: {
  photo: JobSyncJobPhoto;
  preview?: boolean;
  isCurrent: () => boolean;
  onRetry: () => void;
  onPreview?: () => void;
  onLongPress?: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const mounted = useMounted();
  const live = useRef(isCurrent);
  useLayoutEffect(() => { live.current = isCurrent; }, [isCurrent]);
  const update = (next: typeof status) => {
    if (mounted.current && live.current()) setStatus(next);
  };
  const image = (
    <Image
      accessibilityLabel={photo.caption || "Company Job photo"}
      source={{ uri: photo.imageUrl }}
      style={preview ? styles.imageFill : styles.thumb}
      resizeMode={preview ? "contain" : "cover"}
      onLoadStart={() => update("loading")}
      onLoad={() => update("loaded")}
      onError={() => update("error")}
    />
  );
  return (
    <View style={preview ? styles.fullImage : styles.thumbnail}>
      {status !== "error" ? (
        onPreview ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={photo.caption || "Preview Job photo"}
            onPress={onPreview}
            onLongPress={onLongPress}
            activeOpacity={0.85}
          >
            {image}
          </TouchableOpacity>
        ) : (
          image
        )
      ) : null}
      {status === "loading" ? (
        <ActivityIndicator
          accessibilityLabel="Loading Job photo"
          style={styles.imageLoading}
          color={preview ? "#fff" : undefined}
        />
      ) : null}
      {status === "error" ? (
        <View style={styles.imageError}>
          <Text
            accessibilityRole="alert"
            style={preview ? styles.previewMessage : styles.errorText}
          >
            {preview ? IMAGE_ERROR : "Photo unavailable"}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Refresh Job photos to retry"
            onPress={onRetry}
            style={styles.retry}
          >
            <Text style={preview ? styles.previewMessage : styles.retryText}>
              Refresh to retry
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

export function CompanyJobPhotos(props: GalleryProps) {
  const focused = useIsFocused();
  const scope = companyPhotoScope(props.session, props.jobId);
  // Keying by signed identity resets all errors, locks and child-image callbacks on a context change.
  return (
    <ScopedCompanyJobPhotos
      key={`${scope ?? "unavailable"}:${focused}`}
      {...props}
      scope={scope}
    />
  );
}

function createPhotoReadStore() {
  let snapshot: PhotoJobProps["job"] | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    publish: (job: typeof snapshot) => {
      if (snapshot === job) return;
      snapshot = job;
      listeners.forEach((listener) => listener());
    },
  };
}

function usePhotoConfirmationIdentity(detail: PhotoJobProps["job"]["detail"], focused: boolean, blocked: boolean, pending: boolean, refreshing: boolean, available: boolean) {
  return useMemo(() => ({ detail, focused, blocked, pending, refreshing, available }), [detail, focused, blocked, pending, refreshing, available]);
}

function ScopedCompanyJobPhotos(
  props: GalleryProps & { scope: string | null },
) {
  const colors = useJobSheetColors();
  const mounted = useMounted();
  const live = useRef(props);
  useLayoutEffect(() => { live.current = props; }, [props]);
  const current = () =>
    mounted.current &&
    Boolean(props.scope) &&
    companyPhotoScope(live.current.session, live.current.jobId) === props.scope;
  const { refreshing, error, refresh } = usePhotoRefresh(props, current);
  const sharedProps = photoProps(props);
  // The helper deliberately rejects private detail when a parent read is unavailable. During its
  // own reconciliation only, retain the accessible pre-refresh input so its independent verified
  // readback can be handed to the parent even if that parent's progress read failed. This input is
  // never rendered as a fallback gallery and cannot authorize a new operation while pending.
  const readStore = useMemo(() => createPhotoReadStore(), []);
  const ownRead = useSyncExternalStore(readStore.subscribe, readStore.getSnapshot, readStore.getSnapshot);
  const sameAccess = !sharedProps.job.detail || (sharedProps.job.detail.id === props.jobId && sharedProps.job.detail.companyId === props.session?.company?.id && (props.session?.user.role !== "technician" || sharedProps.job.detail.assignedUserId === props.session.user.id));
  const readbackInput = ownRead && sameAccess && !sharedProps.job.pending
    ? { ...sharedProps, job: ownRead } : sharedProps;
  const reconcilePhotos = async () => {
    if (!current()) return;
    if (currentCompanyGallery(sharedProps) !== null) readStore.publish(sharedProps.job);
    await (props.onRefresh ? props.onRefresh() : props.job.refresh());
  };
  const removal = useCompanyPhotoOperation({ ...readbackInput, onRefresh: reconcilePhotos });
  const batch = useCompanyPhotoBatch({ ...readbackInput, onRefresh: reconcilePhotos });
  const [operationKind, setOperationKind] = useState<"upload" | "remove">("upload");
  const selectedOperation = operationKind === "upload" ? batch : removal;
  const operation = { ...selectedOperation, pending: batch.pending || removal.pending, blocked: selectedOperation.blocked || batch.pending || removal.pending, remove: removal.remove };
  const { acceptVerifiedDetail } = props.job;
  const { scope } = props;
  const deliveredDetail = useRef<typeof operation.detail>(null);
  useLayoutEffect(() => {
    if (operation.detail && !operation.pending && current()) {
      if (deliveredDetail.current !== operation.detail) {
        deliveredDetail.current = operation.detail;
        acceptVerifiedDetail?.(operation.detail, scope!);
      }
      readStore.publish(null);
    } else if (!operation.pending) { deliveredDetail.current = null; readStore.publish(null); }
  });
  const canonicalProps = operation.detail ? { ...sharedProps, job: { ...sharedProps.job, detail: operation.detail, error: null } } : sharedProps;
  const photos = operation.focused ? currentCompanyPhotos(canonicalProps) : [];
  const { detail: canonicalDetail } = canonicalProps.job;
  const { focused: operationFocused, blocked: operationBlocked, pending: operationPending } = operation;
  const confirmationIdentity = usePhotoConfirmationIdentity(canonicalDetail, operationFocused, operationBlocked, operationPending, refreshing, currentCompanyGallery(canonicalProps) !== null);
  const [confirmation, setConfirmation] = useState<{ photoId: number; identity: typeof confirmationIdentity } | null>(null);
  const removeLock = useRef(false);
  const canonicalLive = useRef({ props: canonicalProps, focused: operation.focused, blocked: operation.blocked, pending: operation.pending, refreshing });
  useLayoutEffect(() => { canonicalLive.current = { props: canonicalProps, focused: operation.focused, blocked: operation.blocked, pending: operation.pending, refreshing }; });
  const canRemove = (photoId: number) => current() && canonicalLive.current.focused && !canonicalLive.current.blocked && !canonicalLive.current.pending && !canonicalLive.current.refreshing && Platform.OS !== "web" && canDeleteCompanyPhoto(canonicalLive.current.props, photoId);
  const canRenderRemoval = (photoId: number) => Boolean(props.scope) && operation.focused && !operation.blocked && !operation.pending && !refreshing && Platform.OS !== "web" && canDeleteCompanyPhoto(canonicalProps, photoId);
  const validConfirmation = confirmation && confirmation.identity === confirmationIdentity && canRenderRemoval(confirmation.photoId) ? confirmation : null;
  const confirmationRef = useRef(validConfirmation);
  useLayoutEffect(() => { confirmationRef.current = validConfirmation; }, [validConfirmation]);
  const canUse = (photo: JobSyncJobPhoto) =>
    current() &&
    canonicalLive.current.focused &&
    !canonicalLive.current.pending &&
    !canonicalLive.current.refreshing &&
    sameCompanyPhoto(currentCompanyPhotos(canonicalLive.current.props), photo);
  const busy = props.job.loading || props.job.pending || refreshing || operation.pending;
  const authoritative = operation.focused && !busy && currentCompanyGallery(canonicalProps) !== null;
  const persistedIds = canonicalProps.job.detail?.persistedPhotoIds;
  const completeIds = authoritative && Array.isArray(persistedIds);
  const trulyEmpty = completeIds && persistedIds.length === 0;
  const hiddenPhotos = completeIds && persistedIds.length > photos.length;
  const showRemovalHelp = Boolean(props.scope) && operation.focused && !operation.blocked && !busy && Platform.OS !== "web" && photos.some((photo) => canDeleteCompanyPhoto(canonicalProps, photo.id));
  const requestRemoval = (photoId: number) => {
    if (canRemove(photoId))
      setConfirmation({ photoId, identity: confirmationIdentity });
  };
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.background, borderColor: colors.border },
      ]}
    >
      <CompanyPhotoDraft
        headerLabel={`BEFORE & AFTER PHOTOS (${busy ? "…" : completeIds ? persistedIds.length : photos.length || "unavailable"})`}
        session={props.session}
        jobId={props.jobId}
        job={{ ...canonicalProps.job, loading: busy || operation.blocked || !operation.focused }}
        onRefresh={props.onRefresh ?? props.job.refresh}
        onUpload={async (draft) => { setOperationKind("upload"); const result = await batch.upload([{ ...draft, assetKeys: [`uri:${draft.uri}`] }]); return !result.stopped; }}
        onUploadBatch={(drafts) => { setOperationKind("upload"); return batch.upload(drafts); }}
        operationPending={operation.pending}
      />
      {busy ? (
        <ActivityIndicator
          accessibilityLabel="Refreshing Company Job photos"
          color={colors.primary}
        />
      ) : null}
      {batch.pending && batch.progress ? <Text accessibilityLiveRegion="polite" style={[styles.help, { color: colors.muted }]}>Uploading photo {batch.progress.index} of {batch.progress.total} · {batch.progress.confirmed} confirmed</Text> : null}
      {operation.message ? <Text style={[styles.help, { color: colors.muted }]}>{operation.message}</Text> : null}
      {operation.error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{operation.error}</Text> : null}
      {canonicalProps.job.error || error ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {canonicalProps.job.error || error}
        </Text>
      ) : null}
      {!busy && !photos.length ? (
        <View style={[styles.emptyPhotos, { borderColor: colors.border }]}>
          <Text style={[styles.emptyText, { color: colors.muted }]}>
            {trulyEmpty
              ? "No before & after photos yet."
              : hiddenPhotos
                ? "Stored photo images are unavailable. Refresh photos to retry."
                : "Photos unavailable. Refresh photos to retry."}
          </Text>
        </View>
      ) : null}
      {!busy && photos.length > 0 && hiddenPhotos ? <Text style={[styles.help, { color: colors.muted }]}>Some photo images are unavailable. Refresh photos to retry.</Text> : null}
      <FlatList
        data={busy ? [] : photos}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(photo) => `${photo.id}:${photo.imageUrl}`}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <View>
            <CompanyPhotoImage
              photo={item}
              isCurrent={() => canUse(item)}
              onRetry={() => {
                if (canUse(item)) void refresh();
              }}
              onPreview={() => {
                if (canUse(item))
                  props.onPreview({
                    scope: props.scope!,
                    photoId: item.id,
                    imageUrl: item.imageUrl,
                  });
              }}
              onLongPress={() => requestRemoval(item.id)}
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Remove Job photo ${item.id}`}
              accessibilityState={{ disabled: !canRenderRemoval(item.id) }}
              disabled={!canRenderRemoval(item.id)}
              onPress={() => requestRemoval(item.id)}
              style={styles.remove}
            ><Text style={[styles.actionText, { color: colors.error, opacity: canRenderRemoval(item.id) ? 1 : 0.35 }]}>Remove</Text></TouchableOpacity>
          </View>
        )}
      />
      {validConfirmation ? <View style={styles.confirmation}>
        <Text style={{ color: colors.foreground }}>Remove this photo from this Job? Stored media erasure is not guaranteed.</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel photo removal" onPress={() => setConfirmation(null)}><Text style={{ color: colors.primary }}>Cancel</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Confirm remove photo from Job" onPress={() => {
          if (removeLock.current || !validConfirmation || confirmationRef.current !== validConfirmation || !canRemove(validConfirmation.photoId)) return;
          confirmationRef.current = null;
          removeLock.current = true;
          const photoId = validConfirmation.photoId;
          setConfirmation(null);
          setOperationKind("remove");
          void operation.remove(photoId).finally(() => { removeLock.current = false; });
        }}><Text style={{ color: colors.error }}>Remove from Job</Text></TouchableOpacity>
      </View> : null}
      <View style={styles.footer}>
        {showRemovalHelp ? (
          <Text style={[styles.help, styles.footerHelp, { color: colors.muted }]}>
            Long-press a photo to delete it.
          </Text>
        ) : null}
        <TouchableOpacity
          disabled={!props.scope || busy || !operation.focused}
          accessibilityRole="button"
          accessibilityLabel="Refresh photos"
          accessibilityState={{ disabled: !props.scope || busy || !operation.focused }}
          onPress={() => {
            if (!busy && operation.focused) void refresh();
          }}
          style={styles.refreshPhotos}
        >
          <Text style={[styles.actionText, { color: colors.primary }]}>
            {refreshing ? "Refreshing Job photos…" : "Refresh photos"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Render last inside the existing Job sheet/Modal; never stack another iOS Modal. */
export function CompanyJobPhotoPreview(props: PreviewProps) {
  const focused = useIsFocused();
  const scope = companyPhotoScope(props.session, props.jobId);
  const selection = props.photo;
  const canonicalProps = photoProps(props);
  const photos = currentCompanyPhotos(canonicalProps);
  const photo =
    focused && selection && selection.scope === scope
      ? photos.find(
          (item) =>
            item.id === selection.photoId &&
            item.imageUrl === selection.imageUrl,
        )
      : null;
  const valid = Boolean(photo && scope);
  // Invalid selections are also cleared in the parent so a later gallery cannot resurrect them.
  const { onClose } = props;
  useEffect(() => {
    if (selection && !valid) onClose();
  }, [selection, valid, onClose]);
  if (!photo || !scope) return null;
  return (
    <ScopedCompanyJobPhotoPreview
      key={`${scope}:${photo.id}:${photo.imageUrl}`}
      {...canonicalProps}
      currentPhoto={photo}
      scope={scope}
    />
  );
}

function ScopedCompanyJobPhotoPreview(
  props: PreviewProps & { currentPhoto: JobSyncJobPhoto; scope: string },
) {
  const mounted = useMounted();
  const live = useRef(props);
  useLayoutEffect(() => { live.current = props; }, [props]);
  const current = () =>
    mounted.current &&
    companyPhotoScope(live.current.session, live.current.jobId) ===
      props.scope &&
    live.current.photo?.scope === props.scope &&
    live.current.photo?.photoId === props.currentPhoto.id &&
    live.current.photo?.imageUrl === props.currentPhoto.imageUrl &&
    sameCompanyPhoto(currentCompanyPhotos(live.current), props.currentPhoto);
  const { refreshing, error, refresh } = usePhotoRefresh(props, current);
  const retry = () => {
    if (!current() || refreshing) return;
    // Start the authoritative read before dismissal unmounts this view. Never reopen from its late result.
    void refresh();
    props.onClose();
  };
  return (
    <View style={styles.preview}>
      <CompanyPhotoImage
        photo={props.currentPhoto}
        preview
        isCurrent={current}
        onRetry={retry}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.previewMessage}>
          {error}
        </Text>
      ) : null}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Close photo preview"
        onPress={() => {
          if (current()) props.onClose();
        }}
        style={styles.refresh}
      >
        <Text style={styles.close}>Close photo preview</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginBottom: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    gap: 10,
  },
  help: { fontSize: 11, lineHeight: 15 },
  emptyPhotos: { borderWidth: 1, borderStyle: "dashed", borderRadius: 10, paddingVertical: 20, paddingHorizontal: 12, alignItems: "center" },
  emptyText: { fontSize: 13, lineHeight: 18, textAlign: "center" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  footerHelp: { flex: 1 },
  refreshPhotos: { paddingVertical: 4, marginLeft: "auto" },
  remove: { paddingVertical: 6, alignItems: "center" },
  actionText: { fontSize: 11, lineHeight: 15 },
  confirmation: { gap: 10, paddingVertical: 10 },
  grid: { gap: 8 },
  thumbnail: { width: 90, height: 90 },
  thumb: { width: 90, height: 90, borderRadius: 8 },
  imageLoading: { position: "absolute", top: "40%", left: "40%" },
  imageError: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
    gap: 4,
  },
  errorText: { color: "#b42318", fontSize: 12, textAlign: "center" },
  retryText: { color: "#2563eb", fontSize: 12, textAlign: "center" },
  retry: { padding: 8 },
  refresh: { paddingVertical: 10 },
  preview: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.95)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  fullImage: { width: "95%", height: "80%" },
  imageFill: { width: "100%", height: "100%" },
  previewMessage: {
    color: "#fff",
    textAlign: "center",
    fontSize: 14,
    paddingHorizontal: 16,
  },
  close: { color: "#fff", marginTop: 14, fontSize: 14 },
});
