import React from "react";
import { Modal, Text, TouchableOpacity, View } from "react-native";

export interface PaymentRecord {
  method: "cash" | "check" | "other" | "credit_debit" | "tap_to_pay";
  subtotal: number;
  tipAmount: number;
  total: number;
  paidAt: string;
  paymentIntentId?: string;
  signatureDataUrl?: string;
  referenceNote?: string;
}

interface Job {
  id: string;
  firstName: string;
  lastName: string;
  price: number;
  serviceTitle: string;
}

export function AdminCheckoutModal({ visible, job, onClose }: {
  visible: boolean;
  job: Job;
  customerPhone?: string | null;
  customerEmail?: string | null;
  onClose: () => void;
  onComplete: (payment: PaymentRecord) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 }}>
        <View style={{ backgroundColor: "#ffffff", borderRadius: 16, padding: 24, gap: 14 }}>
          <Text style={{ fontSize: 20, fontWeight: "700", color: "#14213d" }}>Payments are disabled</Text>
          <Text style={{ fontSize: 15, lineHeight: 22, color: "#475569" }}>
            Stripe, card processing, Apple Pay, and Tap to Pay are disconnected in this Home Service Connection copy. No payment was created for {job.firstName} {job.lastName}.
          </Text>
          <TouchableOpacity onPress={onClose} style={{ backgroundColor: "#1d4ed8", borderRadius: 10, paddingVertical: 13, alignItems: "center" }}>
            <Text style={{ color: "#ffffff", fontWeight: "700" }}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
