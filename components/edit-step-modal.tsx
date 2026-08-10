import { Modal, View, Text, TextInput, Pressable, ScrollView, Alert } from "react-native";
import { useState, useEffect } from "react";
import { useColors } from "@/hooks/use-colors";
import { cn } from "@/lib/utils";
import * as Haptics from "expo-haptics";

interface EditStepModalProps {
  visible: boolean;
  step: any;
  onClose: () => void;
  onSave: (data: {
    title: string;
    description: string;
    imageUrl: string | null;
    warnings: string | null;
    tips: string | null;
  }) => Promise<void>;
  isLoading: boolean;
}

export function EditStepModal({
  visible,
  step,
  onClose,
  onSave,
  isLoading,
}: EditStepModalProps) {
  const colors = useColors();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [warnings, setWarnings] = useState("");
  const [tips, setTips] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (step) {
      setTitle(step.title || "");
      setDescription(step.description || "");
      setImageUrl(step.imageUrl || "");
      setWarnings(step.warnings || "");
      setTips(step.tips || "");
      setError("");
    }
  }, [step, visible]);

  const handleSave = async () => {
    if (!title.trim()) {
      setError("Step title is required");
      return;
    }

    if (!description.trim()) {
      setError("Step description is required");
      return;
    }

    try {
      setError("");
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await onSave({
        title: title.trim(),
        description: description.trim(),
        imageUrl: imageUrl.trim() || null,
        warnings: warnings.trim() || null,
        tips: tips.trim() || null,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save step";
      setError(errorMessage);
      Alert.alert("Error", errorMessage);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: "rgba(0, 0, 0, 0.5)" }}>
        <View
          style={{
            flex: 1,
            marginTop: 50,
            backgroundColor: colors.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <View
            style={{
              paddingHorizontal: 20,
              paddingVertical: 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontWeight: "600",
                color: colors.foreground,
              }}
            >
              Edit Step
            </Text>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={{ fontSize: 24, color: colors.primary }}>✕</Text>
            </Pressable>
          </View>

          {/* Content */}
          <ScrollView
            style={{ flex: 1, paddingHorizontal: 20, paddingVertical: 16 }}
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            {/* Error Message */}
            {error && (
              <View
                style={{
                  backgroundColor: colors.error + "20",
                  borderWidth: 1,
                  borderColor: colors.error,
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 16,
                }}
              >
                <Text style={{ color: colors.error, fontSize: 14 }}>
                  {error}
                </Text>
              </View>
            )}

            {/* Title Field */}
            <View style={{ marginBottom: 16 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: colors.foreground,
                  marginBottom: 8,
                }}
              >
                Step Title *
              </Text>
              <TextInput
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                  fontSize: 14,
                }}
                placeholder="Enter step title"
                placeholderTextColor={colors.muted}
                value={title}
                onChangeText={setTitle}
                editable={!isLoading}
              />
            </View>

            {/* Description Field */}
            <View style={{ marginBottom: 16 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: colors.foreground,
                  marginBottom: 8,
                }}
              >
                Description *
              </Text>
              <TextInput
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                  fontSize: 14,
                  minHeight: 100,
                  textAlignVertical: "top",
                }}
                placeholder="Enter step description"
                placeholderTextColor={colors.muted}
                value={description}
                onChangeText={setDescription}
                multiline={true}
                numberOfLines={4}
                editable={!isLoading}
              />
            </View>

            {/* Image URL Field */}
            <View style={{ marginBottom: 16 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: colors.foreground,
                  marginBottom: 8,
                }}
              >
                Image URL (Optional)
              </Text>
              <TextInput
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                  fontSize: 14,
                }}
                placeholder="https://example.com/image.jpg"
                placeholderTextColor={colors.muted}
                value={imageUrl}
                onChangeText={setImageUrl}
                editable={!isLoading}
              />
            </View>

            {/* Warnings Field */}
            <View style={{ marginBottom: 16 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: colors.foreground,
                  marginBottom: 8,
                }}
              >
                Warnings (Optional)
              </Text>
              <TextInput
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                  fontSize: 14,
                  minHeight: 80,
                  textAlignVertical: "top",
                }}
                placeholder="Enter any warnings for this step"
                placeholderTextColor={colors.muted}
                value={warnings}
                onChangeText={setWarnings}
                multiline={true}
                numberOfLines={3}
                editable={!isLoading}
              />
            </View>

            {/* Tips Field */}
            <View style={{ marginBottom: 16 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: colors.foreground,
                  marginBottom: 8,
                }}
              >
                Tips (Optional)
              </Text>
              <TextInput
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                  fontSize: 14,
                  minHeight: 80,
                  textAlignVertical: "top",
                }}
                placeholder="Enter helpful tips for this step"
                placeholderTextColor={colors.muted}
                value={tips}
                onChangeText={setTips}
                multiline={true}
                numberOfLines={3}
                editable={!isLoading}
              />
            </View>
          </ScrollView>

          {/* Footer Buttons */}
          <View
            style={{
              flexDirection: "row",
              gap: 12,
              paddingHorizontal: 20,
              paddingVertical: 16,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <Pressable
              onPress={onClose}
              disabled={isLoading}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: colors.surface,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  textAlign: "center",
                  fontWeight: "600",
                  color: colors.foreground,
                }}
              >
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={isLoading}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: colors.primary,
                opacity: pressed || isLoading ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  textAlign: "center",
                  fontWeight: "600",
                  color: colors.background,
                }}
              >
                {isLoading ? "Saving..." : "Save Changes"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
