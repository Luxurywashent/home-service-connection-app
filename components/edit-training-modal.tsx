import React, { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/use-colors";

export interface EditTrainingModalProps {
  visible: boolean;
  module: {
    moduleId: string;
    name: string;
    description: string | null;
    icon: string | null;
    videoUrl: string | null;
  } | null;
  onClose: () => void;
  onSave: (data: { name: string; description: string; icon: string; videoUrl: string }) => Promise<void>;
  isLoading?: boolean;
}

export function EditTrainingModal({
  visible,
  module,
  onClose,
  onSave,
  isLoading = false,
}: EditTrainingModalProps) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (module && visible) {
      setName(module.name || "");
      setDescription(module.description || "");
      setIcon(module.icon || "");
      setVideoUrl(module.videoUrl || "");
    }
  }, [module, visible]);

  const handleSave = async () => {
    if (!name.trim()) {
      alert("Module name is required");
      return;
    }

    setIsSaving(true);
    try {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      await onSave({
        name: name.trim(),
        description: description.trim(),
        icon: icon.trim(),
        videoUrl: videoUrl.trim(),
      });
      onClose();
    } catch (error) {
      console.error("Error saving module:", error);
      alert("Failed to save module. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (!isSaving && !isLoading) {
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
        <View
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 20,
            maxHeight: "90%",
          }}
        >
          {/* Header */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground }}>
              Edit Training Module
            </Text>
            <TouchableOpacity onPress={handleClose} disabled={isSaving || isLoading}>
              <Text style={{ fontSize: 24, color: colors.muted }}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: "80%" }}>
            {/* Module Name */}
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>
                Module Name *
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Enter module name"
                placeholderTextColor={colors.muted}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 14,
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                }}
                editable={!isSaving && !isLoading}
              />
            </View>

            {/* Description */}
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>
                Description
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Enter module description"
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={4}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 14,
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                  textAlignVertical: "top",
                }}
                editable={!isSaving && !isLoading}
              />
            </View>

            {/* Icon */}
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>
                Icon Emoji
              </Text>
              <TextInput
                value={icon}
                onChangeText={setIcon}
                placeholder="e.g., 🚗 or 🔧"
                placeholderTextColor={colors.muted}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 14,
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                }}
                editable={!isSaving && !isLoading}
              />
            </View>

            {/* Loom Video URL */}
            <View style={{ marginBottom: 20 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>
                Loom Video URL
              </Text>
              <TextInput
                value={videoUrl}
                onChangeText={setVideoUrl}
                placeholder="https://www.loom.com/embed/..."
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                multiline
                numberOfLines={3}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 12,
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                  textAlignVertical: "top",
                }}
                editable={!isSaving && !isLoading}
              />
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>
                Paste the full Loom embed URL here
              </Text>
            </View>
          </ScrollView>

          {/* Action Buttons */}
          <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
            <TouchableOpacity
              onPress={handleClose}
              disabled={isSaving || isLoading}
              style={{ flex: 1 }}
            >
              <View
                style={{
                  paddingVertical: 12,
                  borderRadius: 8,
                  backgroundColor: colors.border,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>
                  Cancel
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSave}
              disabled={isSaving || isLoading}
              style={{ flex: 1 }}
            >
              <View
                style={{
                  paddingVertical: 12,
                  borderRadius: 8,
                  backgroundColor: isSaving || isLoading ? colors.muted : colors.primary,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#FFF", fontSize: 14, fontWeight: "600" }}>
                  {isSaving || isLoading ? "Saving..." : "Save Changes"}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
