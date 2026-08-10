import React, { useRef, useState } from "react";
import { Modal, View, Text, Pressable, ActivityIndicator, Alert } from "react-native";
import { useColors } from "@/hooks/use-colors";
import * as Haptics from "expo-haptics";

interface SignatureModalProps {
  visible: boolean;
  notificationTitle: string;
  onClose: () => void;
  onSave: (signatureData: string) => Promise<void>;
  isLoading: boolean;
}

export function SignatureModal({
  visible,
  notificationTitle,
  onClose,
  onSave,
  isLoading,
}: SignatureModalProps) {
  const colors = useColors();
  const canvasRef = useRef<any>(null);
  const [hasSignature, setHasSignature] = useState(false);

  const handleClear = () => {
    if (canvasRef.current) {
      canvasRef.current.clearSignature();
      setHasSignature(false);
    }
  };

  const handleSave = async () => {
    if (!hasSignature) {
      Alert.alert("Error", "Please provide a signature");
      return;
    }

    try {
      if (canvasRef.current) {
        const signatureData = await canvasRef.current.readSignature();
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await onSave(signatureData);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to save signature";
      Alert.alert("Error", errorMessage);
    }
  };

  const handleSignatureChange = (isEmpty: boolean) => {
    setHasSignature(!isEmpty);
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
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontWeight: "600",
                color: colors.foreground,
                marginBottom: 4,
              }}
            >
              Acknowledge Notification
            </Text>
            <Text style={{ fontSize: 14, color: colors.muted }}>
              {notificationTitle}
            </Text>
          </View>

          {/* Content */}
          <View style={{ flex: 1, paddingHorizontal: 20, paddingVertical: 16 }}>
            <Text
              style={{
                fontSize: 14,
                color: colors.foreground,
                marginBottom: 12,
                fontWeight: "500",
              }}
            >
              Please sign below to acknowledge this notification:
            </Text>

            {/* Signature Canvas */}
            <View
              style={{
                flex: 1,
                borderWidth: 2,
                borderColor: colors.border,
                borderRadius: 12,
                marginBottom: 16,
                backgroundColor: colors.surface,
                overflow: "hidden",
              }}
            >
              <SignatureCanvas
                ref={canvasRef}
                onOK={handleSignatureChange}
                onEmpty={() => setHasSignature(false)}
                descriptionText=""
                clearText="Clear"
                confirmText="Confirm"
                webStyle={`
                  .m-signature-pad--body {
                    border: none;
                  }
                  .m-signature-pad {
                    box-shadow: none;
                  }
                `}
              />
            </View>

            {/* Info Text */}
            <Text
              style={{
                fontSize: 12,
                color: colors.muted,
                marginBottom: 16,
                fontStyle: "italic",
              }}
            >
              Your signature confirms that you have read and understood this notification.
            </Text>
          </View>

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
              onPress={handleClear}
              disabled={isLoading || !hasSignature}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: colors.surface,
                opacity: pressed || isLoading || !hasSignature ? 0.6 : 1,
              })}
            >
              <Text
                style={{
                  textAlign: "center",
                  fontWeight: "600",
                  color: colors.foreground,
                }}
              >
                Clear
              </Text>
            </Pressable>

            <Pressable
              onPress={onClose}
              disabled={isLoading}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: colors.border,
                opacity: pressed || isLoading ? 0.6 : 1,
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
              disabled={isLoading || !hasSignature}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: colors.primary,
                opacity: pressed || isLoading || !hasSignature ? 0.6 : 1,
              })}
            >
              {isLoading ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <Text
                  style={{
                    textAlign: "center",
                    fontWeight: "600",
                    color: colors.background,
                  }}
                >
                  Confirm & Sign
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Signature canvas component with proper ref forwarding
const SignatureCanvas = React.forwardRef<any, any>((props, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    contextRef.current = ctx;
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#000000";
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const startDrawing = (e: MouseEvent | TouchEvent) => {
      if (!contextRef.current) return;
      isDrawing.current = true;
      const rect = canvas.getBoundingClientRect();
      const x =
        (e instanceof MouseEvent ? e.clientX : e.touches[0].clientX) - rect.left;
      const y =
        (e instanceof MouseEvent ? e.clientY : e.touches[0].clientY) - rect.top;
      contextRef.current.beginPath();
      contextRef.current.moveTo(x, y);
      props.onOK?.(false);
    };

    const draw = (e: MouseEvent | TouchEvent) => {
      if (!isDrawing.current || !contextRef.current) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x =
        (e instanceof MouseEvent ? e.clientX : e.touches[0].clientX) - rect.left;
      const y =
        (e instanceof MouseEvent ? e.clientY : e.touches[0].clientY) - rect.top;
      contextRef.current.lineTo(x, y);
      contextRef.current.stroke();
    };

    const stopDrawing = () => {
      if (!contextRef.current) return;
      isDrawing.current = false;
      contextRef.current.closePath();
    };

    canvas.addEventListener("mousedown", startDrawing);
    canvas.addEventListener("mousemove", draw);
    canvas.addEventListener("mouseup", stopDrawing);
    canvas.addEventListener("mouseleave", stopDrawing);
    canvas.addEventListener("touchstart", startDrawing, { passive: false });
    canvas.addEventListener("touchmove", draw, { passive: false });
    canvas.addEventListener("touchend", stopDrawing);
    canvas.addEventListener("touchcancel", stopDrawing);

    return () => {
      canvas.removeEventListener("mousedown", startDrawing);
      canvas.removeEventListener("mousemove", draw);
      canvas.removeEventListener("mouseup", stopDrawing);
      canvas.removeEventListener("mouseleave", stopDrawing);
      canvas.removeEventListener("touchstart", startDrawing);
      canvas.removeEventListener("touchmove", draw);
      canvas.removeEventListener("touchend", stopDrawing);
      canvas.removeEventListener("touchcancel", stopDrawing);
    };
  }, [props]);

  React.useImperativeHandle(ref, () => ({
    clearSignature: () => {
      const canvas = canvasRef.current;
      if (canvas && contextRef.current) {
        contextRef.current.clearRect(0, 0, canvas.width, canvas.height);
        contextRef.current.fillStyle = "white";
        contextRef.current.fillRect(0, 0, canvas.width, canvas.height);
        props.onEmpty?.();
      }
    },
    readSignature: async () => {
      const canvas = canvasRef.current;
      if (canvas) {
        return canvas.toDataURL("image/png");
      }
      return null;
    },
  }));

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "100%",
        cursor: "crosshair",
        backgroundColor: "white",
        display: "block",
        touchAction: "none",
      }}
    />
  );
});

SignatureCanvas.displayName = "SignatureCanvas";
