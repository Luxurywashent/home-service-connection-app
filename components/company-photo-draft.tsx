import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useIsFocused } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useColors } from "@/hooks/use-colors";
import {
  COMPANY_PHOTO_DRAFT_BACKEND_PENDING,
  COMPANY_PHOTO_DRAFT_LABEL,
  LocalPhotoDraftError,
  companyPhotoDraftScope,
  prepareCompanyPhotoDraft,
  type CompanyPhotoDraftInput,
  type LocalPhotoDraft,
} from "@/lib/company-photo-draft";
import { useCompanyPhotoOperation } from "@/lib/company-photo-operation";

type Source = "Camera" | "Library";
type Identity = { scope: string | null; focused: boolean };
type DraftState = {
  identity: Identity;
  generation: number;
  source: Source;
  draft: LocalPhotoDraft | null;
  pending: boolean;
  error: string | null;
  notice: string | null;
  imageStatus: "loading" | "loaded" | "error";
};

/** Memory-only preview in the existing Job sheet. Never adds media to canonical Job detail. */
export function CompanyPhotoDraft(props: CompanyPhotoDraftInput) {
  const colors = useColors();
  const focused = useIsFocused();
  const ownOperation = useCompanyPhotoOperation({ ...props, onRefresh: props.onRefresh ?? (() => undefined) });
  const sending = props.onUpload ? Boolean(props.operationPending) : ownOperation.pending;
  const scope = companyPhotoDraftScope(props);
  const mounted = useRef(true);
  const live = useRef({ props, focused, scope });
  live.current = { props, focused, scope };
  const identityRef = useRef<Identity>({ scope, focused });
  const generation = useRef(0);
  const pendingLock = useRef(false);
  // Invalidate synchronously during render: old previews never flash before an effect,
  // and returning to a previous Job/focus state cannot resurrect them.
  if (
    identityRef.current.scope !== scope ||
    identityRef.current.focused !== focused
  ) {
    identityRef.current = { scope, focused };
    generation.current++;
    pendingLock.current = false;
  }
  const identity = identityRef.current;
  const [state, setState] = useState<DraftState | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      pendingLock.current = false;
    };
  }, []);
  const current = (expectedGeneration?: number) =>
    mounted.current &&
    identityRef.current === identity &&
    Boolean(identity.scope) &&
    live.current.focused &&
    companyPhotoDraftScope(live.current.props) === identity.scope &&
    (expectedGeneration === undefined ||
      generation.current === expectedGeneration);
  const visible =
    scope &&
    focused &&
    state?.identity === identity &&
    state.generation === generation.current
      ? state
      : null;
  const busy = Boolean(visible?.pending);
  const disabled = !scope || !focused || busy || sending || (!props.onUpload && ownOperation.blocked);

  const pick = async (source: Source) => {
    if (!current() || disabled || pendingLock.current) return;
    pendingLock.current = true; // Protect repeated native taps before React commits.
    const operation = ++generation.current;
    const initial: DraftState = {
      identity,
      generation: operation,
      source,
      draft: null,
      pending: true,
      error: null,
      notice: null,
      imageStatus: "loading",
    };
    setState(initial);
    let stage: "permission" | "picker" | "file" = "permission";
    try {
      const permission =
        source === "Camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!current(operation)) return;
      if (!permission.granted) {
        setState({
          ...initial,
          pending: false,
          error: `${source} permission was denied. Allow access in device Settings if needed, then retry.`,
        });
        return;
      }
      stage = "picker";
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        allowsEditing: false,
        base64: false,
        exif: false,
      };
      const result =
        source === "Camera"
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      if (!current(operation)) return;
      if (result.canceled) {
        setState({
          ...initial,
          pending: false,
          notice: `${source} cancelled. No local draft was created.`,
        });
        return;
      }
      if (!result.assets || result.assets.length !== 1)
        throw new LocalPhotoDraftError(
          "Select one still photo to prepare a local draft. Retry Camera or Library.",
        );
      stage = "file";
      const draft = await prepareCompanyPhotoDraft(
        result.assets[0],
        async (uri) => {
          if (!current(operation))
            throw new LocalPhotoDraftError(
              "Photo selection is no longer current.",
            );
          return FileSystem.getInfoAsync(uri);
        },
      );
      if (!current(operation)) return;
      setState({ ...initial, pending: false, draft });
    } catch (error) {
      if (!current(operation)) return;
      const message =
        error instanceof LocalPhotoDraftError
          ? error.message
          : stage === "permission"
            ? `Could not request ${source.toLowerCase()} permission. Retry when ready.`
            : stage === "picker"
              ? `Could not open ${source.toLowerCase()}. Retry when ready.`
              : "Could not prepare this local photo. Choose another photo and retry.";
      setState({ ...initial, pending: false, error: message });
    } finally {
      // A response from the previous scope/operation must not unlock a new picker.
      if (current(operation)) pendingLock.current = false;
    }
  };
  const updateImage = (imageStatus: DraftState["imageStatus"]) => {
    if (!visible?.draft || !current(visible.generation)) return;
    setState({ ...visible, imageStatus });
  };
  const upload = () => {
    if (!visible?.draft || disabled || pendingLock.current || !current(visible.generation)) return;
    pendingLock.current = true;
    const draft = { ...visible.draft }; // Operation owns this snapshot, never resurrect the preview.
    generation.current++;
    setState(null);
    void (props.onUpload ?? ownOperation.upload)(draft).finally(() => {
      if (mounted.current && identityRef.current === identity) pendingLock.current = false;
    });
  };
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {(["Camera", "Library"] as const).map((source) => (
          <TouchableOpacity
            key={source}
            accessibilityRole="button"
            accessibilityLabel={source}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => {
              void pick(source);
            }}
            style={[
              styles.button,
              { backgroundColor: colors.primary, opacity: disabled ? 0.35 : 1 },
            ]}
          >
            <Text style={styles.buttonText}>{source}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={[styles.help, { color: colors.muted }]}>
        {COMPANY_PHOTO_DRAFT_BACKEND_PENDING}
      </Text>
      <Text style={[styles.help, { color: colors.muted }]}>
        Still JPEG, PNG or WebP files only, up to 15 MiB. HEIC and video are not supported.
      </Text>
      {!scope ? (
        <Text style={[styles.help, { color: colors.muted }]}>
          Refresh an authorized Company Job before preparing a local draft.
        </Text>
      ) : null}
      {busy ? (
        <ActivityIndicator
          accessibilityLabel="Preparing local photo draft"
          color={colors.primary}
        />
      ) : null}
      {!props.onUpload && ownOperation.pending ? <ActivityIndicator accessibilityLabel="Sending Company Job photo" color={colors.primary} /> : null}
      {!props.onUpload && ownOperation.message ? <Text style={{ color: colors.muted }}>{ownOperation.message}</Text> : null}
      {!props.onUpload && ownOperation.error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{ownOperation.error}</Text> : null}
      {visible?.notice ? (
        <Text style={{ color: colors.muted }}>{visible.notice}</Text>
      ) : null}
      {visible?.error ? (
        <View>
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {visible.error}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Retry ${visible.source}`}
            onPress={() => {
              void pick(visible.source);
            }}
          >
            <Text style={{ color: colors.primary }}>
              Retry {visible.source}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {visible?.draft ? (
        <View style={styles.preview}>
          <Text style={{ color: colors.foreground }}>
            {COMPANY_PHOTO_DRAFT_LABEL}
          </Text>
          {visible.imageStatus !== "error" ? (
            <Image
              key={`${visible.generation}:${visible.draft.uri}`}
              accessibilityLabel="Local draft photo preview"
              source={{ uri: visible.draft.uri }}
              resizeMode="contain"
              style={styles.image}
              onLoadStart={() => updateImage("loading")}
              onLoad={() => updateImage("loaded")}
              onError={() => updateImage("error")}
            />
          ) : (
            <View>
              <Text accessibilityRole="alert" style={{ color: colors.error }}>
                Local photo preview could not load. Discard it or choose another
                photo.
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Retry ${visible.source}`}
                onPress={() => {
                  void pick(visible.source);
                }}
              >
                <Text style={{ color: colors.primary }}>
                  Retry {visible.source}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          {visible.imageStatus === "loading" ? (
            <ActivityIndicator
              accessibilityLabel="Loading local draft preview"
              color={colors.primary}
            />
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Discard local draft"
            onPress={() => {
              if (sending || !current(visible.generation)) return;
              generation.current++;
              setState(null); // Release the in-memory preview only; never delete a library/camera file.
            }}
          >
            <Text style={{ color: colors.primary }}>Discard local draft</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Upload local draft"
            accessibilityState={{ disabled, busy: sending }}
            onPress={upload}
            style={[
              styles.button,
              { backgroundColor: colors.primary, opacity: disabled ? 0.35 : 1 },
            ]}
          >
            <Text style={styles.buttonText}>{sending ? "Sending photo…" : "Upload"}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 10 },
  row: { flexDirection: "row", gap: 8 },
  button: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  buttonText: { color: "#fff", fontWeight: "700" },
  help: { fontSize: 12 },
  preview: { gap: 10 },
  image: { width: "100%", height: 200, borderRadius: 8 },
});
