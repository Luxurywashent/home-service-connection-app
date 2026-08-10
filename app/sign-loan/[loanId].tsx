import React, { useState, useRef } from "react";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, View, Text, TouchableOpacity, Alert } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

export default function SignLoanScreen() {
  const { loanId } = useLocalSearchParams();
  const [isDrawing, setIsDrawing] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: loan, isLoading } = trpc.loans.getLoanDetail.useQuery(
    { loanId: loanId as string },
    { enabled: !!loanId }
  );

  const markSignedMutation = trpc.loans.markContractSigned.useMutation();

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    setIsDrawing(true);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000";
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    if (canvasRef.current) {
      setSignatureData(canvasRef.current.toDataURL());
    }
  };

  const clearSignature = () => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
    setSignatureData(null);
  };

  const handleSubmit = async () => {
    if (!signatureData) {
      Alert.alert("Error", "Please sign the contract before submitting");
      return;
    }

    if (!loanId) {
      Alert.alert("Error", "Loan ID not found");
      return;
    }

    setIsSubmitting(true);
    try {
      // In production, upload signature to storage and get URL
      // For now, we'll use the data URL directly
      await markSignedMutation.mutateAsync({
        loanId: loanId as string,
        signedContractUrl: signatureData,
      });

      Alert.alert("Success", "Contract signed successfully! A copy has been sent to your email.");
    } catch (error) {
      Alert.alert("Error", "Failed to submit signature. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <ScreenContainer>
        <View className="flex-1 items-center justify-center">
          <Text className="text-lg text-muted">Loading contract...</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!loan) {
    return (
      <ScreenContainer>
        <View className="flex-1 items-center justify-center">
          <Text className="text-lg text-error">Contract not found</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="p-4">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="gap-6">
          {/* Header */}
          <View className="items-center gap-2">
            <Text className="text-3xl font-bold text-foreground">Sign Loan Agreement</Text>
            <Text className="text-sm text-muted">Loan ID: {loan.contract.loanId}</Text>
          </View>

          {/* Loan Details */}
          <View className="bg-surface rounded-lg p-4 gap-3">
            <View className="flex-row justify-between">
              <Text className="text-sm text-muted">Borrower:</Text>
              <Text className="text-sm font-semibold text-foreground">{loan.contract.borrowerName}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-sm text-muted">Principal:</Text>
              <Text className="text-sm font-semibold text-foreground">
                ${Number(loan.contract.principalAmount).toLocaleString()}
              </Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-sm text-muted">Total Repayment:</Text>
              <Text className="text-sm font-semibold text-foreground">
                ${Number(loan.contract.totalRepaymentAmount).toLocaleString()}
              </Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-sm text-muted">Payments:</Text>
              <Text className="text-sm font-semibold text-foreground">{loan.contract.numberOfPayments}</Text>
            </View>
          </View>

          {/* Signature Canvas */}
          <View className="gap-2">
            <Text className="text-sm font-semibold text-foreground">Your Signature</Text>
            <View className="border-2 border-border rounded-lg overflow-hidden bg-white">
              <canvas
                ref={canvasRef}
                width={300}
                height={150}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                style={{
                  cursor: "crosshair",
                  display: "block",
                  width: "100%",
                  height: 150,
                }}
              />
            </View>
            <Text className="text-xs text-muted text-center">Draw your signature above</Text>
          </View>

          {/* Signature Status */}
          {signatureData && (
            <View className="bg-success/10 border border-success rounded-lg p-3">
              <Text className="text-sm text-success font-semibold">✓ Signature captured</Text>
            </View>
          )}

          {/* Action Buttons */}
          <View className="gap-3">
            <TouchableOpacity
              className="bg-primary rounded-lg py-3 px-4 items-center"
              onPress={handleSubmit}
              disabled={isSubmitting || !signatureData}
            >
              <Text className="text-white font-semibold">
                {isSubmitting ? "Submitting..." : "Sign & Submit"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="bg-surface border border-border rounded-lg py-3 px-4 items-center"
              onPress={clearSignature}
              disabled={isSubmitting}
            >
              <Text className="text-foreground font-semibold">Clear Signature</Text>
            </TouchableOpacity>
          </View>

          {/* Terms */}
          <View className="bg-surface rounded-lg p-4 gap-2">
            <Text className="text-xs font-semibold text-foreground mb-2">Terms & Conditions</Text>
            <Text className="text-xs text-muted leading-relaxed">
              By signing this agreement, you acknowledge that you have read and agree to the terms
              of this loan contract. This agreement is legally binding.
            </Text>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
