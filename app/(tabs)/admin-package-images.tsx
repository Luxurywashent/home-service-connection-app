import { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, Image, TextInput,
  StyleSheet, Alert, ActivityIndicator, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { MaterialIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

const PACKAGE_LIST = [
  { id: "basic_detail",    name: "Basic Detail",    fallback: "https://d2xsxph8kpxj0f.cloudfront.net/310519663471903126/n2wVeYQgKmefAVwyN2KSSe/package-basic-PwG3fxrSDyA739KJLMDHT6.webp" },
  { id: "full_detail",     name: "Full Detail",     fallback: "https://d2xsxph8kpxj0f.cloudfront.net/310519663471903126/n2wVeYQgKmefAVwyN2KSSe/package-full-LVMhQhooy5LLFKtSMxfnxN.webp" },
  { id: "interior_detail", name: "Interior Detail", fallback: "https://d2xsxph8kpxj0f.cloudfront.net/310519663471903126/n2wVeYQgKmefAVwyN2KSSe/package-interior-cFXnNmVXNUEVshGA3QnJNf.webp" },
  { id: "exterior_detail", name: "Exterior Detail", fallback: "https://d2xsxph8kpxj0f.cloudfront.net/310519663471903126/n2wVeYQgKmefAVwyN2KSSe/package-exterior-Xy6zMQpD4exokp7wnhdzNr.webp" },
  { id: "luxury_detail",   name: "Luxury Detail",   fallback: "https://d2xsxph8kpxj0f.cloudfront.net/310519663471903126/n2wVeYQgKmefAVwyN2KSSe/package-luxury-BSq3Hjc6MUMYSkUQSPfgnS.webp" },
  { id: "rv_wash_small",   name: "RV Wash (20–29 ft)", fallback: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/GtJlZGCjIcVEwngv.jpeg" },
  { id: "rv_wash_medium",  name: "RV Wash (30–39 ft)", fallback: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/GtJlZGCjIcVEwngv.jpeg" },
  { id: "rv_wash_large",   name: "RV Wash (40 ft+)",   fallback: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/GtJlZGCjIcVEwngv.jpeg" },
];

type Pkg = (typeof PACKAGE_LIST)[0];

export default function AdminPackageImagesScreen() {
  const { data: remoteImages, refetch, isLoading } = trpc.packages.getImages.useQuery();

  const updateMutation = trpc.packages.updateImage.useMutation({
    onSuccess: () => { refetch(); closeModal(); Alert.alert("Saved", "Package image updated."); },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const uploadMutation = trpc.packages.uploadImage.useMutation({
    onSuccess: () => { refetch(); closeModal(); Alert.alert("Saved", "Package image updated."); },
    onError: (err) => Alert.alert("Upload failed", err.message),
  });

  const [editingPkg, setEditingPkg] = useState<Pkg | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [previewUri, setPreviewUri] = useState<string | null>(null); // local file URI for preview
  const [pickedBase64, setPickedBase64] = useState<string | null>(null);
  const [pickedMime, setPickedMime] = useState<string>("image/jpeg");
  const [tab, setTab] = useState<"upload" | "url">("upload");

  function openEdit(pkg: Pkg) {
    setEditingPkg(pkg);
    setUrlInput(remoteImages?.[pkg.id] ?? pkg.fallback);
    setPreviewUri(null);
    setPickedBase64(null);
    setPickedMime("image/jpeg");
    setTab("upload");
  }

  function closeModal() {
    setEditingPkg(null);
    setPreviewUri(null);
    setPickedBase64(null);
    setUrlInput("");
  }

  async function handlePickFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow access to your photo library in Settings.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.85,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPreviewUri(asset.uri);
      setPickedBase64(asset.base64 ?? null);
      setPickedMime(asset.mimeType ?? "image/jpeg");
    }
  }

  async function handleTakePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow camera access in Settings.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.85,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPreviewUri(asset.uri);
      setPickedBase64(asset.base64 ?? null);
      setPickedMime(asset.mimeType ?? "image/jpeg");
    }
  }

  function handleSave() {
    if (!editingPkg) return;

    if (tab === "upload") {
      if (!pickedBase64) {
        Alert.alert("No photo selected", "Please pick a photo from your library or take one with the camera.");
        return;
      }
      uploadMutation.mutate({ packageId: editingPkg.id, base64: pickedBase64, mimeType: pickedMime });
    } else {
      const trimmed = urlInput.trim();
      if (!trimmed.startsWith("http")) {
        Alert.alert("Invalid URL", "Please enter a valid image URL starting with https://");
        return;
      }
      updateMutation.mutate({ packageId: editingPkg.id, imageUrl: trimmed });
    }
  }

  const isBusy = uploadMutation.isPending || updateMutation.isPending;

  return (
    <ScreenContainer className="bg-white">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Package Images</Text>
        <Text style={styles.headerSub}>Tap a package to swap its photo — changes go live instantly</Text>
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#1A1A1A" /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {PACKAGE_LIST.map((pkg) => {
            const imageUrl = remoteImages?.[pkg.id] ?? pkg.fallback;
            return (
              <TouchableOpacity key={pkg.id} style={styles.card} onPress={() => openEdit(pkg)} activeOpacity={0.85}>
                <Image source={{ uri: imageUrl }} style={styles.thumb} resizeMode="cover" />
                <View style={styles.cardInfo}>
                  <Text style={styles.pkgName}>{pkg.name}</Text>
                  <Text style={styles.pkgUrl} numberOfLines={1}>{imageUrl}</Text>
                </View>
                <MaterialIcons name="edit" size={20} color="#6B7280" />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Edit modal */}
      <Modal visible={!!editingPkg} animationType="slide" transparent presentationStyle="overFullScreen">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Update Image</Text>
            <Text style={styles.modalPkg}>{editingPkg?.name}</Text>

            {/* Tab switcher */}
            <View style={styles.tabRow}>
              <TouchableOpacity
                style={[styles.tabBtn, tab === "upload" && styles.tabBtnActive]}
                onPress={() => setTab("upload")}
              >
                <Text style={[styles.tabText, tab === "upload" && styles.tabTextActive]}>📷 Upload Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, tab === "url" && styles.tabBtnActive]}
                onPress={() => setTab("url")}
              >
                <Text style={[styles.tabText, tab === "url" && styles.tabTextActive]}>🔗 Paste URL</Text>
              </TouchableOpacity>
            </View>

            {tab === "upload" ? (
              <View>
                {/* Preview */}
                {previewUri ? (
                  <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="cover" />
                ) : (
                  <View style={[styles.previewImage, styles.previewPlaceholder]}>
                    <MaterialIcons name="add-photo-alternate" size={40} color="#9CA3AF" />
                    <Text style={styles.placeholderText}>No photo selected</Text>
                  </View>
                )}

                {/* Pick buttons */}
                <View style={styles.pickRow}>
                  <TouchableOpacity style={styles.pickBtn} onPress={handlePickFromLibrary} activeOpacity={0.8}>
                    <MaterialIcons name="photo-library" size={20} color="#1A1A1A" />
                    <Text style={styles.pickBtnText}>Camera Roll</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.pickBtn} onPress={handleTakePhoto} activeOpacity={0.8}>
                    <MaterialIcons name="camera-alt" size={20} color="#1A1A1A" />
                    <Text style={styles.pickBtnText}>Take Photo</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View>
                {urlInput.startsWith("http") && (
                  <Image source={{ uri: urlInput }} style={styles.previewImage} resizeMode="cover" />
                )}
                <Text style={styles.inputLabel}>Image URL</Text>
                <TextInput
                  style={styles.urlInput}
                  value={urlInput}
                  onChangeText={setUrlInput}
                  placeholder="https://example.com/image.jpg"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="done"
                />
                <Text style={styles.hint}>Paste any public image URL (JPG, PNG, WebP).</Text>
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={closeModal} disabled={isBusy}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, isBusy && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={isBusy}
              >
                {isBusy
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.saveText}>{tab === "upload" ? "Upload & Save" : "Save URL"}</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" },
  headerTitle: { fontSize: 22, fontWeight: "800", color: "#1A1A1A" },
  headerSub: { fontSize: 13, color: "#6B7280", marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#FAFAFA", borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: "#F0F0F0", gap: 12 },
  thumb: { width: 64, height: 48, borderRadius: 8, backgroundColor: "#E5E7EB" },
  cardInfo: { flex: 1 },
  pkgName: { fontSize: 14, fontWeight: "700", color: "#1A1A1A" },
  pkgUrl: { fontSize: 11, color: "#9CA3AF", marginTop: 2 },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 18, fontWeight: "800", color: "#1A1A1A", marginBottom: 2 },
  modalPkg: { fontSize: 14, color: "#6B7280", marginBottom: 14 },
  tabRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: "#E5E7EB", alignItems: "center" },
  tabBtnActive: { backgroundColor: "#1A1A1A", borderColor: "#1A1A1A" },
  tabText: { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  tabTextActive: { color: "#fff" },
  previewImage: { width: "100%", height: 160, borderRadius: 12, marginBottom: 14, backgroundColor: "#F3F4F6" },
  previewPlaceholder: { alignItems: "center", justifyContent: "center" },
  placeholderText: { fontSize: 13, color: "#9CA3AF", marginTop: 8 },
  pickRow: { flexDirection: "row", gap: 10, marginBottom: 4 },
  pickBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#FAFAFA" },
  pickBtnText: { fontSize: 14, fontWeight: "600", color: "#1A1A1A" },
  inputLabel: { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  urlInput: { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12, fontSize: 13, color: "#1A1A1A", backgroundColor: "#FAFAFA", marginBottom: 8 },
  hint: { fontSize: 12, color: "#9CA3AF", lineHeight: 17, marginBottom: 16 },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: "#E5E7EB", alignItems: "center" },
  cancelText: { fontSize: 15, fontWeight: "600", color: "#374151" },
  saveBtn: { flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: "#1A1A1A", alignItems: "center" },
  saveText: { fontSize: 15, fontWeight: "700", color: "#fff" },
});
