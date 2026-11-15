import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { COMPANY_PHOTO_MUTATIONS_PENDING } from "@/lib/company-job-fieldwork";
import type { useCompanyJob } from "@/hooks/use-company-job";

export function CompanyJobPhotos({ job, onPreview }: { job: ReturnType<typeof useCompanyJob>; onPreview: (url: string) => void }) {
  const colors = useColors();
  const photos = job.detail?.photos ?? [];
  return <View style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
    <Text style={[styles.heading, { color: colors.foreground }]}>BEFORE & AFTER PHOTOS ({photos.length})</Text>
    <View style={styles.row}>{["Camera", "Library"].map((label) => <TouchableOpacity key={label} disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.buttonText}>{label}</Text></TouchableOpacity>)}</View>
    <Text style={{ color: colors.muted, fontSize: 12 }}>{COMPANY_PHOTO_MUTATIONS_PENDING}</Text>
    {job.loading ? <ActivityIndicator color={colors.primary} /> : job.error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{job.error}</Text> : null}
    {!job.loading && !photos.length ? <Text style={{ color: colors.muted }}>{job.detail ? "No server photos for this Job." : "Server gallery unavailable. Refresh Job to retry."}</Text> : null}
    <FlatList data={photos} horizontal keyExtractor={(photo) => String(photo.id)} contentContainerStyle={styles.grid} renderItem={({ item }) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={item.caption ?? "Preview Job photo"} onPress={() => onPreview(item.imageUrl)}><Image source={{ uri: item.imageUrl }} style={styles.thumb} resizeMode="cover" /></TouchableOpacity>} />
    {photos.length ? <Text style={{ color: colors.muted, fontSize: 11 }}>Tap to preview. Deletion is unavailable until the backend connection is verified.</Text> : null}
    <TouchableOpacity disabled={job.pending || job.loading} onPress={() => { void job.refresh(); }}><Text style={{ color: colors.primary }}>Refresh photos</Text></TouchableOpacity>
  </View>;
}
/** Render last inside the existing job Modal; no stacked iOS Modal. */
export function CompanyJobPhotoPreview({ url, onClose }: { url: string | null; onClose: () => void }) {
  if (!url) return null;
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close photo preview" onPress={onClose} activeOpacity={1} style={styles.preview}>
    <Image source={{ uri: url }} style={styles.fullImage} resizeMode="contain" />
    <Text style={styles.close}>Tap to close</Text>
  </TouchableOpacity>;
}
const styles = StyleSheet.create({
  card: { padding: 16, marginVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, gap: 10 }, heading: { fontSize: 13, fontWeight: "700" },
  row: { flexDirection: "row", gap: 8 }, button: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, opacity: 0.35 }, buttonText: { color: "#fff", fontWeight: "700" },
  grid: { gap: 8 }, thumb: { width: 90, height: 90, borderRadius: 8 },
  preview: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.95)", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  fullImage: { width: "95%", height: "80%" }, close: { color: "#fff", marginTop: 14, fontSize: 14 },
});
