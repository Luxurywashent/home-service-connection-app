import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { Linking } from "react-native";
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://luxurywashonwheels.app";
const formatCurrency = (n: number | string) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (d: Date | string) => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

interface LoanDetailModalProps {
  visible: boolean;
  loan: any;
  onClose: () => void;
  onRefresh: () => void;
}

export default function LoanDetailModal({
  visible,
  loan,
  onClose,
  onRefresh,
}: LoanDetailModalProps) {
  const colors = useColors();
  const [loanDetail, setLoanDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");

  const { data: detail, isLoading } = trpc.loans.getLoanDetail.useQuery({
    loanId: loan.loanId,
  });

  const recordPaymentMutation = trpc.loans.recordPayment.useMutation();
  const sendContractMutation = trpc.loans.sendContractForSignature.useMutation({
    onSuccess: () => {
      Alert.alert("✅ Contract Sent", `The loan agreement has been sent to ${loan.borrowerEmail} for signature.`);
      onRefresh();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to send contract. Please try again.");
    },
  });

  const sendReminderMutation = trpc.loans.sendPaymentReminder.useMutation({
    onSuccess: () => { Alert.alert("✅ Reminder Sent", "The payment reminder email has been sent to the lender."); },
    onError: (err) => { Alert.alert("Error", err.message || "Failed to send reminder."); },
  });

  function handleSendReminder() {
    const nextPayment = loanDetail?.nextPayment;
    if (!nextPayment) { Alert.alert("No Upcoming Payment", "There are no upcoming payments to send a reminder for."); return; }
    Alert.alert("Send Payment Reminder", `Send a celebratory payment reminder to ${loan.borrowerEmail}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Send", onPress: () => sendReminderMutation.mutate({ loanId: loan.loanId, scheduleId: nextPayment.scheduleId }) },
    ]);
  }

  function handleViewSignedContract() {
    Linking.openURL(`${API_BASE}/sign-loan-contract/${loan.loanId}`);
  }

  function handleSendContract() {
    Alert.alert(
      "Send Contract",
      `Send the loan agreement to ${loan.borrowerEmail} for signature?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send",
          onPress: () => sendContractMutation.mutate({ loanId: loan.loanId }),
        },
      ]
    );
  }

  useEffect(() => {
    if (detail) {
      setLoanDetail(detail);
      setLoading(false);
    }
  }, [detail]);

  const handleRecordPayment = async () => {
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
      Alert.alert("Error", "Please enter valid payment amount");
      return;
    }

    const nextPayment = loanDetail?.nextPayment;
    if (!nextPayment) {
      Alert.alert("Error", "No pending payments");
      return;
    }

    try {
      await recordPaymentMutation.mutateAsync({
        loanId: loan.loanId,
        scheduleId: nextPayment.scheduleId,
        amountPaid: parseFloat(paymentAmount),
        paidDate: new Date(paymentDate),
        paymentMethod,
      });

      Alert.alert("Success", "Payment recorded successfully");
      setShowPaymentForm(false);
      setPaymentAmount("");
      onRefresh();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to record payment");
    }
  };

  if (loading || !loanDetail) {
    return (
      <Modal visible={visible} animationType="slide" transparent={true}>
        <View className="flex-1 bg-black/50 justify-center items-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </Modal>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "#22C55E";
      case "completed":
        return "#3B82F6";
      case "pending_signature":
        return "#F59E0B";
      case "draft":
        return "#9CA3AF";
      default:
        return colors.muted;
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View className="flex-1 bg-black/50">
        <View
          className="flex-1 bg-background rounded-t-3xl mt-12"
          style={{ backgroundColor: colors.background }}
        >
          {/* Header */}
          <View className="flex-row justify-between items-center p-4 border-b border-border">
            <Text className="text-xl font-bold text-foreground">Loan Details</Text>
            <TouchableOpacity onPress={onClose}>
              <Text className="text-2xl text-foreground">✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1 p-4">
            {/* Borrower Info */}
            <View className="bg-surface rounded-lg p-4 mb-4">
              <Text className="text-lg font-semibold text-foreground mb-2">
                {loanDetail.contract.borrowerName}
              </Text>
              <Text className="text-sm text-muted mb-1">{loanDetail.contract.borrowerEmail}</Text>
              {loanDetail.contract.borrowerPhone && (
                <Text className="text-sm text-muted">{loanDetail.contract.borrowerPhone}</Text>
              )}
            </View>

            {/* Status */}
            <View className="flex-row items-center gap-2 mb-4">
              <View
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: getStatusColor(loanDetail.contract.status) }}
              />
              <Text className="text-sm font-semibold text-foreground">
                {loanDetail.contract.status.toUpperCase()}
              </Text>
            </View>

            {/* Loan Summary */}
            <View className="bg-surface rounded-lg p-4 mb-4">
              <Text className="text-lg font-semibold text-foreground mb-3">Loan Summary</Text>

              <View className="flex-row justify-between mb-3">
                <Text className="text-sm text-muted">Principal</Text>
                <Text className="text-sm font-semibold text-foreground">
                  {formatCurrency(Number(loanDetail.contract.principalAmount))}
                </Text>
              </View>

              <View className="flex-row justify-between mb-3">
                <Text className="text-sm text-muted">Total Repayment</Text>
                <Text className="text-sm font-semibold text-foreground">
                  {formatCurrency(Number(loanDetail.contract.totalRepaymentAmount))}
                </Text>
              </View>

              <View className="flex-row justify-between mb-3">
                <Text className="text-sm text-muted">Interest</Text>
                <Text className="text-sm font-semibold text-foreground">
                  {formatCurrency(
                    Number(loanDetail.contract.totalRepaymentAmount) -
                      Number(loanDetail.contract.principalAmount)
                  )}
                </Text>
              </View>

              <View className="flex-row justify-between mb-3">
                <Text className="text-sm text-muted">Total Paid</Text>
                <Text className="text-sm font-semibold text-foreground">
                  {formatCurrency(loanDetail.totalPaid)}
                </Text>
              </View>

              <View className="flex-row justify-between">
                <Text className="text-sm text-muted">Remaining Balance</Text>
                <Text className="text-sm font-semibold text-foreground">
                  {formatCurrency(loanDetail.remainingBalance)}
                </Text>
              </View>
            </View>

            {/* Progress */}
            <View className="bg-surface rounded-lg p-4 mb-4">
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm font-semibold text-foreground">Progress</Text>
                <Text className="text-sm font-semibold text-primary">
                  {loanDetail.completionPercentage.toFixed(1)}%
                </Text>
              </View>
              <View className="w-full h-2 bg-border rounded-full overflow-hidden">
                <View
                  className="h-full bg-primary"
                  style={{ width: `${loanDetail.completionPercentage}%` }}
                />
              </View>
            </View>

            {/* Payment Schedule */}
            <View className="bg-surface rounded-lg p-4 mb-4">
              <Text className="text-lg font-semibold text-foreground mb-3">Payment Schedule</Text>
              <Text className="text-sm text-muted mb-2">
                {loanDetail.contract.numberOfPayments} payments of{" "}
                {formatCurrency(
                  Number(loanDetail.contract.totalRepaymentAmount) /
                    loanDetail.contract.numberOfPayments
                )}{" "}
                ({loanDetail.contract.paymentFrequency})
              </Text>

              {loanDetail.nextPayment && (
                <View className="bg-primary/10 rounded-lg p-3 mt-3">
                  <Text className="text-sm font-semibold text-foreground mb-1">Next Payment</Text>
                  <Text className="text-sm text-muted">
                    Payment {loanDetail.nextPayment.paymentNumber} of{" "}
                    {loanDetail.contract.numberOfPayments}
                  </Text>
                  <Text className="text-sm text-muted">
                    Due: {formatDate(new Date(loanDetail.nextPayment.dueDate))}
                  </Text>
                  <Text className="text-sm font-semibold text-foreground mt-2">
                    {formatCurrency(Number(loanDetail.nextPayment.amountDue))}
                  </Text>
                </View>
              )}
            </View>

            {/* Payment History */}
            {loanDetail.payments.length > 0 && (
              <View className="bg-surface rounded-lg p-4 mb-4">
                <Text className="text-lg font-semibold text-foreground mb-3">Payment History</Text>
                {loanDetail.payments.map((payment: any, index: number) => (
                  <View key={index} className="flex-row justify-between mb-2 pb-2 border-b border-border">
                    <View>
                      <Text className="text-sm font-semibold text-foreground">
                        Payment {payment.paymentNumber}
                      </Text>
                      <Text className="text-xs text-muted">
                        {formatDate(new Date(payment.createdAt))}
                      </Text>
                    </View>
                    <Text className="text-sm font-semibold text-foreground">
                      {formatCurrency(Number(payment.amountPaid))}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          {/* Action Buttons */}
          <View className="flex-row gap-3 p-4 border-t border-border">
            {loanDetail.nextPayment && !showPaymentForm && (
              <TouchableOpacity
                onPress={() => setShowPaymentForm(true)}
                className="flex-1 py-3 px-4 rounded-lg bg-primary"
              >
                <Text className="text-center font-semibold text-white">Record Payment</Text>
              </TouchableOpacity>
            )}

            {(loanDetail.contract.status === "draft" || loanDetail.contract.status === "pending_signature") && !showPaymentForm && (
              <TouchableOpacity
                onPress={handleSendContract}
                disabled={sendContractMutation.isPending}
                className="flex-1 py-3 px-4 rounded-lg"
                style={{ backgroundColor: "#7C3AED" }}
              >
                {sendContractMutation.isPending ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <Text className="text-center font-semibold text-white">
                    {loanDetail.contract.status === "pending_signature" ? "Resend Contract" : "Send Contract"}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={onClose}
              className="flex-1 py-3 px-4 rounded-lg bg-surface border border-border"
            >
              <Text className="text-center font-semibold text-foreground">Close</Text>
            </TouchableOpacity>
          </View>

          {/* Secondary action buttons */}
          {!showPaymentForm && (
            <View className="flex-row gap-3 px-4 pb-4">
              {loanDetail.contract.status === "active" && (
                <TouchableOpacity onPress={handleViewSignedContract}
                  className="flex-1 py-2 px-3 rounded-lg" style={{ backgroundColor: "#059669" }}>
                  <Text className="text-center text-sm font-semibold text-white">📄 View Contract</Text>
                </TouchableOpacity>
              )}
              {loanDetail.nextPayment && (
                <TouchableOpacity onPress={handleSendReminder} disabled={sendReminderMutation.isPending}
                  className="flex-1 py-2 px-3 rounded-lg" style={{ backgroundColor: "#F59E0B" }}>
                  {sendReminderMutation.isPending ? <ActivityIndicator color="white" size="small" /> :
                    <Text className="text-center text-sm font-semibold text-white">🎉 Send Reminder</Text>}
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Payment Form */}
          {showPaymentForm && (
            <View className="p-4 border-t border-border bg-surface">
              <Text className="text-lg font-semibold text-foreground mb-3">Record Payment</Text>

              <Text className="text-sm text-muted mb-1">Amount *</Text>
              <TextInput
                placeholder={formatCurrency(
                  Number(loanDetail.nextPayment?.amountDue || 0)
                )}
                value={paymentAmount}
                onChangeText={setPaymentAmount}
                keyboardType="decimal-pad"
                className="bg-background border border-border rounded-lg p-3 mb-3 text-foreground"
              />

              <Text className="text-sm text-muted mb-1">Date</Text>
              <TextInput
                placeholder="YYYY-MM-DD"
                value={paymentDate}
                onChangeText={setPaymentDate}
                className="bg-background border border-border rounded-lg p-3 mb-3 text-foreground"
              />

              <Text className="text-sm text-muted mb-1">Method</Text>
              <View className="flex-row gap-2 mb-4">
                {["bank_transfer", "check", "cash"].map((method) => (
                  <TouchableOpacity
                    key={method}
                    onPress={() => setPaymentMethod(method)}
                    className={`flex-1 py-2 px-3 rounded-lg ${
                      paymentMethod === method
                        ? "bg-primary"
                        : "bg-background border border-border"
                    }`}
                  >
                    <Text
                      className={`text-center text-sm font-semibold ${
                        paymentMethod === method ? "text-white" : "text-foreground"
                      }`}
                    >
                      {method.replace("_", " ")}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View className="flex-row gap-2">
                <TouchableOpacity
                  onPress={() => setShowPaymentForm(false)}
                  className="flex-1 py-2 px-4 rounded-lg bg-background border border-border"
                >
                  <Text className="text-center font-semibold text-foreground">Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleRecordPayment}
                  disabled={recordPaymentMutation.isPending}
                  className="flex-1 py-2 px-4 rounded-lg bg-primary"
                >
                  {recordPaymentMutation.isPending ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-center font-semibold text-white">Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
