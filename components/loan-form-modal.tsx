import React, { useState } from "react";
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Pressable,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

interface LoanFormModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function LoanFormModal({ visible, onClose, onSuccess }: LoanFormModalProps) {
  const colors = useColors();
  const [borrowerName, setBorrowerName] = useState("");
  const [borrowerEmail, setBorrowerEmail] = useState("");
  const [borrowerPhone, setBorrowerPhone] = useState("");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [totalRepaymentAmount, setTotalRepaymentAmount] = useState("");
  const [numberOfPayments, setNumberOfPayments] = useState("");
  const [paymentFrequency, setPaymentFrequency] = useState<"weekly" | "biweekly" | "monthly">(
    "weekly"
  );
  const [paymentDayOfWeek, setPaymentDayOfWeek] = useState<number | null>(5); // Friday
  const [paymentDayOfMonth, setPaymentDayOfMonth] = useState("1");
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);

  const createLoanMutation = trpc.loans.createLoan.useMutation();

  const handleCreateLoan = async () => {
    // Validation
    if (!borrowerName.trim()) {
      Alert.alert("Error", "Please enter borrower name");
      return;
    }
    if (!borrowerEmail.trim()) {
      Alert.alert("Error", "Please enter borrower email");
      return;
    }
    if (!principalAmount || parseFloat(principalAmount) <= 0) {
      Alert.alert("Error", "Please enter valid principal amount");
      return;
    }
    if (!totalRepaymentAmount || parseFloat(totalRepaymentAmount) <= 0) {
      Alert.alert("Error", "Please enter valid total repayment amount");
      return;
    }
    if (parseFloat(totalRepaymentAmount) <= parseFloat(principalAmount)) {
      Alert.alert("Error", "Total repayment must be greater than principal");
      return;
    }
    if (!numberOfPayments || parseInt(numberOfPayments) <= 0) {
      Alert.alert("Error", "Please enter valid number of payments");
      return;
    }

    try {
      await createLoanMutation.mutateAsync({
        borrowerName: borrowerName.trim(),
        borrowerEmail: borrowerEmail.trim(),
        borrowerPhone: borrowerPhone.trim() || undefined,
        principalAmount: parseFloat(principalAmount),
        totalRepaymentAmount: parseFloat(totalRepaymentAmount),
        numberOfPayments: parseInt(numberOfPayments),
        paymentFrequency,
        paymentDayOfWeek:
          paymentFrequency === "weekly" || paymentFrequency === "biweekly"
            ? paymentDayOfWeek || 5
            : undefined,
        paymentDayOfMonth:
          paymentFrequency === "monthly" ? paymentDayOfMonth : undefined,
        startDate: new Date(startDate),
      });

      Alert.alert("Success", "Loan created successfully");
      onSuccess();
      onClose();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to create loan");
    }
  };

  const daysOfWeek = [
    { label: "Sunday", value: 0 },
    { label: "Monday", value: 1 },
    { label: "Tuesday", value: 2 },
    { label: "Wednesday", value: 3 },
    { label: "Thursday", value: 4 },
    { label: "Friday", value: 5 },
    { label: "Saturday", value: 6 },
  ];

  const monthlyOptions = [
    { label: "1st", value: "1" },
    { label: "15th", value: "15" },
    { label: "First Thursday", value: "first_thursday" },
    { label: "Last Thursday", value: "last_thursday" },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View className="flex-1 bg-black/50">
        <View
          className="flex-1 bg-background rounded-t-3xl mt-12"
          style={{ backgroundColor: colors.background }}
        >
          {/* Header */}
          <View className="flex-row justify-between items-center p-4 border-b border-border">
            <Text className="text-xl font-bold text-foreground">Create New Loan</Text>
            <TouchableOpacity onPress={onClose}>
              <Text className="text-2xl text-foreground">✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1 p-4">
            {/* Borrower Info */}
            <Text className="text-lg font-semibold text-foreground mb-3">Borrower Information</Text>

            <Text className="text-sm text-muted mb-1">Name *</Text>
            <TextInput
              placeholder="Borrower name"
              value={borrowerName}
              onChangeText={setBorrowerName}
              className="bg-surface border border-border rounded-lg p-3 mb-3 text-foreground"
              placeholderTextColor={colors.muted}
            />

            <Text className="text-sm text-muted mb-1">Email *</Text>
            <TextInput
              placeholder="Borrower email"
              value={borrowerEmail}
              onChangeText={setBorrowerEmail}
              keyboardType="email-address"
              className="bg-surface border border-border rounded-lg p-3 mb-3 text-foreground"
              placeholderTextColor={colors.muted}
            />

            <Text className="text-sm text-muted mb-1">Phone</Text>
            <TextInput
              placeholder="Borrower phone (optional)"
              value={borrowerPhone}
              onChangeText={setBorrowerPhone}
              keyboardType="phone-pad"
              className="bg-surface border border-border rounded-lg p-3 mb-6 text-foreground"
              placeholderTextColor={colors.muted}
            />

            {/* Loan Terms */}
            <Text className="text-lg font-semibold text-foreground mb-3">Loan Terms</Text>

            <Text className="text-sm text-muted mb-1">Principal Amount *</Text>
            <TextInput
              placeholder="$0.00"
              value={principalAmount}
              onChangeText={setPrincipalAmount}
              keyboardType="decimal-pad"
              className="bg-surface border border-border rounded-lg p-3 mb-3 text-foreground"
              placeholderTextColor={colors.muted}
            />

            <Text className="text-sm text-muted mb-1">Total Repayment Amount *</Text>
            <TextInput
              placeholder="$0.00"
              value={totalRepaymentAmount}
              onChangeText={setTotalRepaymentAmount}
              keyboardType="decimal-pad"
              className="bg-surface border border-border rounded-lg p-3 mb-3 text-foreground"
              placeholderTextColor={colors.muted}
            />

            <Text className="text-sm text-muted mb-1">Number of Payments *</Text>
            <TextInput
              placeholder="10"
              value={numberOfPayments}
              onChangeText={setNumberOfPayments}
              keyboardType="number-pad"
              className="bg-surface border border-border rounded-lg p-3 mb-3 text-foreground"
              placeholderTextColor={colors.muted}
            />

            {/* Payment Schedule */}
            <Text className="text-lg font-semibold text-foreground mb-3 mt-4">Payment Schedule</Text>

            <Text className="text-sm text-muted mb-1">Payment Frequency *</Text>
            <View className="flex-row gap-2 mb-4">
              {(["weekly", "biweekly", "monthly"] as const).map((freq) => (
                <TouchableOpacity
                  key={freq}
                  onPress={() => setPaymentFrequency(freq)}
                  className={cn(
                    "flex-1 py-2 px-3 rounded-lg",
                    paymentFrequency === freq
                      ? "bg-primary"
                      : "bg-surface border border-border"
                  )}
                >
                  <Text
                    className={cn(
                      "text-center font-semibold text-sm",
                      paymentFrequency === freq ? "text-white" : "text-foreground"
                    )}
                  >
                    {freq === "biweekly" ? "Bi-weekly" : freq.charAt(0).toUpperCase() + freq.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Day of Week Selection */}
            {(paymentFrequency === "weekly" || paymentFrequency === "biweekly") && (
              <>
                <Text className="text-sm text-muted mb-2">Payment Day</Text>
                <View className="flex-row flex-wrap gap-2 mb-4">
                  {daysOfWeek.map((day) => (
                    <TouchableOpacity
                      key={day.value}
                      onPress={() => setPaymentDayOfWeek(day.value)}
                      className={cn(
                        "py-2 px-3 rounded-lg",
                        paymentDayOfWeek === day.value
                          ? "bg-primary"
                          : "bg-surface border border-border"
                      )}
                    >
                      <Text
                        className={cn(
                          "text-sm font-semibold",
                          paymentDayOfWeek === day.value ? "text-white" : "text-foreground"
                        )}
                      >
                        {day.label.slice(0, 3)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Day of Month Selection */}
            {paymentFrequency === "monthly" && (
              <>
                <Text className="text-sm text-muted mb-2">Payment Day of Month</Text>
                <View className="flex-row flex-wrap gap-2 mb-4">
                  {monthlyOptions.map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      onPress={() => setPaymentDayOfMonth(option.value)}
                      className={cn(
                        "py-2 px-3 rounded-lg",
                        paymentDayOfMonth === option.value
                          ? "bg-primary"
                          : "bg-surface border border-border"
                      )}
                    >
                      <Text
                        className={cn(
                          "text-sm font-semibold",
                          paymentDayOfMonth === option.value ? "text-white" : "text-foreground"
                        )}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text className="text-sm text-muted mb-1">Start Date</Text>
            <TextInput
              placeholder="YYYY-MM-DD"
              value={startDate}
              onChangeText={setStartDate}
              className="bg-surface border border-border rounded-lg p-3 mb-6 text-foreground"
              placeholderTextColor={colors.muted}
            />
          </ScrollView>

          {/* Action Buttons */}
          <View className="flex-row gap-3 p-4 border-t border-border">
            <TouchableOpacity
              onPress={onClose}
              className="flex-1 py-3 px-4 rounded-lg bg-surface border border-border"
            >
              <Text className="text-center font-semibold text-foreground">Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleCreateLoan}
              disabled={createLoanMutation.isPending}
              className="flex-1 py-3 px-4 rounded-lg bg-primary"
            >
              {createLoanMutation.isPending ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-center font-semibold text-white">Create Loan</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
