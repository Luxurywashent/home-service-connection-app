import React from "react";
import { Text, TouchableOpacity, View } from "react-native";

export interface TapToPayCheckoutProps {
  amountCents: number;
  jobId: string;
  customerName: string;
  serviceTitle: string;
  onSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
}

export function TapToPayCheckout({ onCancel }: TapToPayCheckoutProps) {
  return (
    <View style={{ padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "700", color: "#14213d" }}>Tap to Pay unavailable</Text>
      <Text style={{ fontSize: 15, lineHeight: 22, color: "#475569" }}>Stripe Terminal is disconnected in this Home Service Connection copy.</Text>
      <TouchableOpacity onPress={onCancel} style={{ backgroundColor: "#64748b", borderRadius: 10, paddingVertical: 12, alignItems: "center" }}>
        <Text style={{ color: "#ffffff", fontWeight: "700" }}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}
