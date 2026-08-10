import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from "react-native";
import { trpc } from "@/lib/trpc";
const formatCurrency = (n: number | string) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (d: Date | string) => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

interface LoanDetailModalProps {
  loanId: string;
  onClose: () => void;
}

export function LoanDetailModal({ loanId, onClose }: LoanDetailModalProps) {
  const { data: loan, isLoading, refetch } = trpc.loans.getLoanDetail.useQuery({
    loanId,
  });

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");

  const sendContractMutation = trpc.loans.sendContractForSignature.useMutation();
  const recordPaymentMutation = trpc.loans.recordPayment.useMutation();

  const handleSendContract = async () => {
    try {
      await sendContractMutation.mutateAsync({ loanId });
      Alert.alert("Success", "Contract sent to borrower for signature");
      refetch();
    } catch (error) {
      Alert.alert("Error", "Failed to send contract");
    }
  };

  const handleRecordPayment = async () => {
    if (!paymentAmount || !paymentDate) {
      Alert.alert("Error", "Please fill in all payment details");
      return;
    }

// @ts-ignore
    try {
// @ts-ignore
      await recordPaymentMutation.mutateAsync({
        loanId,
        amountPaid: Number(paymentAmount),
        paidDate: new Date(paymentDate),
        paymentMethod,
      });
      Alert.alert("Success", "Payment recorded successfully");
      setShowPaymentForm(false);
      setPaymentAmount("");
      refetch();
    } catch (error) {
      Alert.alert("Error", "Failed to record payment");
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#007bff" />
      </View>
    );
  }

  if (!loan) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-lg text-error">Loan not found</Text>
      </View>
    );
  }

  const paymentPercentage = ((loan as any).totalPaymentsMade / Number(loan.contract.totalRepaymentAmount)) * 100;

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="p-4 gap-6">
        {/* Header */}
        <View className="gap-2">
          <Text className="text-2xl font-bold text-foreground">{loan.contract.borrowerName}</Text>
          <Text className="text-sm text-muted">Loan ID: {loan.contract.loanId}</Text>
          <View className="flex-row items-center gap-2 mt-2">
            <View
              className={`px-3 py-1 rounded-full ${
                loan.contract.status === "active"
                  ? "bg-success/20"
                  : loan.contract.status === "pending_signature"
                    ? "bg-warning/20"
                    : "bg-error/20"
              }`}
            >
              <Text
                className={`text-xs font-semibold ${
                  loan.contract.status === "active"
                    ? "text-success"
                    : loan.contract.status === "pending_signature"
                      ? "text-warning"
                      : "text-error"
                }`}
              >
                {loan.contract.status.replace("_", " ").toUpperCase()}
              </Text>
            </View>
          </View>
        </View>

        {/* Loan Terms */}
        <View className="bg-surface rounded-lg p-4 gap-3">
          <Text className="text-sm font-semibold text-foreground mb-2">Loan Terms</Text>
          <View className="flex-row justify-between">
            <Text className="text-sm text-muted">Principal:</Text>
            <Text className="text-sm font-semibold text-foreground">
              {formatCurrency(Number(loan.contract.principalAmount))}
            </Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-muted">Total Repayment:</Text>
            <Text className="text-sm font-semibold text-foreground">
              {formatCurrency(Number(loan.contract.totalRepaymentAmount))}
            </Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-muted">Interest:</Text>
            <Text className="text-sm font-semibold text-foreground">
              {formatCurrency(
                Number(loan.contract.totalRepaymentAmount) - Number(loan.contract.principalAmount)
              )}
            </Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-muted">Payment Frequency:</Text>
            <Text className="text-sm font-semibold text-foreground">{loan.contract.paymentFrequency}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-muted">Payments:</Text>
            <Text className="text-sm font-semibold text-foreground">{loan.contract.numberOfPayments}</Text>
          </View>
        </View>

        {/* Payment Progress */}
        <View className="bg-surface rounded-lg p-4 gap-3">
          <View className="flex-row justify-between items-center mb-2">
            <Text className="text-sm font-semibold text-foreground">Payment Progress</Text>
            <Text className="text-xs text-muted">{Math.round(paymentPercentage)}%</Text>
          </View>
          <View className="h-2 bg-border rounded-full overflow-hidden">
            <View
              className="h-full bg-success"
              style={{ width: `${Math.min(paymentPercentage, 100)}%` }}
            />
          </View>
          <View className="flex-row justify-between mt-2">
            <Text className="text-xs text-muted">
              Paid: {formatCurrency((loan as any).totalPaymentsMade)}
            </Text>
            <Text className="text-xs text-muted">
              Remaining: {formatCurrency(Number(loan.contract.totalRepaymentAmount) - Number((loan as any).totalPaymentsMade))}
            </Text>
          </View>
        </View>

        {/* Payment Schedule */}
        <View className="bg-surface rounded-lg p-4 gap-3">
          <Text className="text-sm font-semibold text-foreground mb-2">Upcoming Payments</Text>
          {loan.schedule
            .filter((p) => p.status === "scheduled")
            .slice(0, 3)
            .map((payment) => (
              <View key={payment.scheduleId} className="flex-row justify-between py-2 border-b border-border last:border-b-0">
                <View className="gap-1">
                  <Text className="text-xs font-semibold text-foreground">
                    Payment {payment.paymentNumber}
                  </Text>
                  <Text className="text-xs text-muted">{formatDate(payment.dueDate)}</Text>
                </View>
                <Text className="text-sm font-semibold text-foreground">
                  {formatCurrency(Number(payment.amountDue))}
                </Text>
              </View>
            ))}
        </View>

        {/* Action Buttons */}
        <View className="gap-3">
          {/* Send Contract Button */}
          {loan.contract.status === "draft" && (
            <TouchableOpacity
              className="bg-primary rounded-lg py-3 px-4 items-center"
              onPress={handleSendContract}
              disabled={sendContractMutation.isPending}
            >
              <Text className="text-white font-semibold">
                {sendContractMutation.isPending ? "Sending..." : "Send Contract for Signature"}
              </Text>
            </TouchableOpacity>
          )}

          {/* Record Payment Button */}
          {loan.contract.status === "active" && (
            <TouchableOpacity
              className="bg-success rounded-lg py-3 px-4 items-center"
              onPress={() => setShowPaymentForm(!showPaymentForm)}
            >
              <Text className="text-white font-semibold">
                {showPaymentForm ? "Cancel" : "Record Payment"}
              </Text>
            </TouchableOpacity>
          )}

          {/* Close Button */}
          <TouchableOpacity
            className="bg-surface border border-border rounded-lg py-3 px-4 items-center"
            onPress={onClose}
          >
            <Text className="text-foreground font-semibold">Close</Text>
          </TouchableOpacity>
        </View>

        {/* Payment Form */}
        {showPaymentForm && (
          <View className="bg-surface border border-border rounded-lg p-4 gap-3">
            <Text className="text-sm font-semibold text-foreground">Record Payment</Text>

            <View className="gap-2">
              <Text className="text-xs font-semibold text-muted">Amount</Text>
              <View className="border border-border rounded-lg px-3 py-2">
                <Text className="text-sm text-foreground">$</Text>
                {/* In a real app, use TextInput */}
              </View>
            </View>

            <View className="gap-2">
              <Text className="text-xs font-semibold text-muted">Payment Date</Text>
              <View className="border border-border rounded-lg px-3 py-2">
                <Text className="text-sm text-foreground">{paymentDate}</Text>
              </View>
            </View>

            <View className="gap-2">
              <Text className="text-xs font-semibold text-muted">Payment Method</Text>
              <View className="border border-border rounded-lg px-3 py-2">
                <Text className="text-sm text-foreground">{paymentMethod}</Text>
              </View>
            </View>

            <TouchableOpacity
              className="bg-success rounded-lg py-3 px-4 items-center mt-2"
              onPress={handleRecordPayment}
              disabled={recordPaymentMutation.isPending}
            >
              <Text className="text-white font-semibold">
                {recordPaymentMutation.isPending ? "Recording..." : "Record Payment"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
