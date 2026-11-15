import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { CompanyPhotoDraft } from "@/components/company-photo-draft";
import {
  companyPhotoScope,
  currentCompanyGallery,
  currentCompanyPhotos,
  sameCompanyPhoto,
} from "@/lib/company-photo-view";
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
  >;
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

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
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
}: {
  photo: JobSyncJobPhoto;
  preview?: boolean;
  isCurrent: () => boolean;
  onRetry: () => void;
  onPreview?: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const mounted = useMounted();
  const live = useRef(isCurrent);
  live.current = isCurrent;
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
  const scope = companyPhotoScope(props.session, props.jobId);
  // Keying by signed identity resets all errors, locks and child-image callbacks on a context change.
  return (
    <ScopedCompanyJobPhotos
      key={scope ?? "unavailable"}
      {...props}
      scope={scope}
    />
  );
}

function ScopedCompanyJobPhotos(
  props: GalleryProps & { scope: string | null },
) {
  const colors = useColors();
  const mounted = useMounted();
  const live = useRef(props);
  live.current = props;
  const current = () =>
    mounted.current &&
    Boolean(props.scope) &&
    companyPhotoScope(live.current.session, live.current.jobId) === props.scope;
  const { refreshing, error, refresh } = usePhotoRefresh(props, current);
  const photos = currentCompanyPhotos(props);
  const canUse = (photo: JobSyncJobPhoto) =>
    current() &&
    !refreshing &&
    sameCompanyPhoto(currentCompanyPhotos(live.current), photo);
  const busy = props.job.loading || props.job.pending || refreshing;
  const authoritative = !busy && currentCompanyGallery(props) !== null;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.background, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.heading, { color: colors.foreground }]}>
        BEFORE & AFTER PHOTOS ({busy ? "…" : photos.length})
      </Text>
      <CompanyPhotoDraft
        session={props.session}
        jobId={props.jobId}
        job={{ ...props.job, loading: props.job.loading || refreshing }}
      />
      {busy ? (
        <ActivityIndicator
          accessibilityLabel="Refreshing Company Job photos"
          color={colors.primary}
        />
      ) : null}
      {props.job.error || error ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {props.job.error || error}
        </Text>
      ) : null}
      {!busy && !photos.length ? (
        <Text style={{ color: colors.muted }}>
          {authoritative
            ? "No server photos for this Job."
            : "Server gallery unavailable. Refresh Job to retry."}
        </Text>
      ) : null}
      <FlatList
        data={busy ? [] : photos}
        horizontal
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
            />
          </View>
        )}
      />
      {photos.length && !busy ? (
        <Text style={[styles.help, { color: colors.muted }]}>
          {IMAGE_ERROR} Tap a photo for an in-sheet preview. Deletion is
          unavailable until the backend connection is verified.
        </Text>
      ) : null}
      <TouchableOpacity
        disabled={!props.scope || busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: !props.scope || busy }}
        onPress={() => {
          void refresh();
        }}
        style={styles.refresh}
      >
        <Text style={{ color: colors.primary }}>
          {refreshing ? "Refreshing Job photos…" : "Refresh photos"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/** Render last inside the existing Job sheet/Modal; never stack another iOS Modal. */
export function CompanyJobPhotoPreview(props: PreviewProps) {
  const scope = companyPhotoScope(props.session, props.jobId);
  const selection = props.photo;
  const photos = currentCompanyPhotos(props);
  const photo =
    selection && selection.scope === scope
      ? photos.find(
          (item) =>
            item.id === selection.photoId &&
            item.imageUrl === selection.imageUrl,
        )
      : null;
  const valid = Boolean(photo && scope);
  // Invalid selections are also cleared in the parent so a later gallery cannot resurrect them.
  useEffect(() => {
    if (selection && !valid) props.onClose();
  }, [selection, valid, props.onClose]);
  if (!photo || !scope) return null;
  return (
    <ScopedCompanyJobPhotoPreview
      key={`${scope}:${photo.id}:${photo.imageUrl}`}
      {...props}
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
  live.current = props;
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
    padding: 16,
    marginVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    gap: 10,
  },
  heading: { fontSize: 13, fontWeight: "700" },
  help: { fontSize: 12 },
  row: { flexDirection: "row", gap: 8 },
  button: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    opacity: 0.35,
  },
  buttonText: { color: "#fff", fontWeight: "700" },
  grid: { gap: 8 },
  thumbnail: { width: 100, height: 100 },
  thumb: { width: 100, height: 100, borderRadius: 8 },
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
