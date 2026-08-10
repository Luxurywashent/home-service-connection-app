import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  FlatList,
  Alert,
  Modal,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
const formatCurrency = (n: number | string) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (d: Date | string) => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

import LoanFormModal from "@/components/loan-form-modal";
import LoanDetailModal from "@/components/loan-detail-modal";

interface Loan {
  id: number;
  loanId: string;
  borrowerName: string;
  borrowerEmail: string;
  borrowerPhone?: string;
  principalAmount: number;
  totalRepaymentAmount: number;
  numberOfPayments: number;
  paymentFrequency: string;
  status: string;
  createdAt: Date;
}

export default function AdminLoansScreen() {
  const colors = useColors();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [filteredLoans, setFilteredLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Fetch loans
  const { data: loansData, isLoading, refetch } = trpc.loans.adminListLoans.useQuery({
    status: statusFilter || undefined,
    search: searchText || undefined,
  });

  useEffect(() => {
    if (loansData) {
      setLoans(loansData as any);
      setFilteredLoans(loansData as any);
      setLoading(false);
    }
  }, [loansData]);

  // Filter loans based on search
  useEffect(() => {
    let filtered = loans;

    if (searchText) {
      filtered = filtered.filter(
        (loan) =>
          loan.borrowerName.toLowerCase().includes(searchText.toLowerCase()) ||
          loan.borrowerEmail.toLowerCase().includes(searchText.toLowerCase())
      );
    }

    if (statusFilter) {
      filtered = filtered.filter((loan) => loan.status === statusFilter);
    }

    setFilteredLoans(filtered);
  }, [searchText, statusFilter, loans]);

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
      case "cancelled":
        return "#EF4444";
      default:
        return colors.muted;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "pending_signature":
        return "Pending Signature";
      case "draft":
        return "Draft";
      default:
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  };

  const handleLoanCreated = () => {
    setShowCreateModal(false);
    refetch();
  };

  const handleViewDetails = (loan: Loan) => {
    setSelectedLoan(loan);
    setShowDetailModal(true);
  };

  if (loading) {
    return (
      <ScreenContainer className="justify-center items-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="bg-background flex-1">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} className="p-4">
        {/* Header */}
        <View className="mb-6">
          <Text className="text-3xl font-bold text-foreground mb-2">Loans</Text>
          <Text className="text-base text-muted">Manage all loan contracts</Text>
        </View>

        {/* Create Loan Button */}
        <TouchableOpacity
          onPress={() => setShowCreateModal(true)}
          className="bg-primary rounded-lg p-4 mb-6"
        >
          <Text className="text-white font-semibold text-center">+ Create New Loan</Text>
        </TouchableOpacity>

        {/* Search Bar */}
        <TextInput
          placeholder="Search by name or email..."
          value={searchText}
          onChangeText={setSearchText}
          className="bg-surface border border-border rounded-lg p-3 mb-4 text-foreground"
          placeholderTextColor={colors.muted}
        />

        {/* Status Filter */}
        <View className="flex-row gap-2 mb-6 flex-wrap">
          <TouchableOpacity
            onPress={() => setStatusFilter(null)}
            className={`px-4 py-2 rounded-full ${
              statusFilter === null ? "bg-primary" : "bg-surface border border-border"
            }`}
          >
            <Text className={statusFilter === null ? "text-white font-semibold" : "text-foreground"}>
              All
            </Text>
          </TouchableOpacity>

          {["draft", "pending_signature", "active", "completed"].map((status) => (
            <TouchableOpacity
              key={status}
              onPress={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded-full ${
                statusFilter === status ? "bg-primary" : "bg-surface border border-border"
              }`}
            >
              <Text className={statusFilter === status ? "text-white font-semibold" : "text-foreground"}>
                {getStatusLabel(status)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Loans List */}
        {filteredLoans.length === 0 ? (
          <View className="items-center justify-center py-12">
            <Text className="text-muted text-center">No loans found</Text>
          </View>
        ) : (
          <FlatList
            data={filteredLoans}
            keyExtractor={(item) => item.loanId}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => handleViewDetails(item)}
                className="bg-surface border border-border rounded-lg p-4 mb-3"
              >
                <View className="flex-row justify-between items-start mb-3">
                  <View className="flex-1">
                    <Text className="text-lg font-semibold text-foreground">{item.borrowerName}</Text>
                    <Text className="text-sm text-muted">{item.borrowerEmail}</Text>
                  </View>
                  <View
                    className="px-3 py-1 rounded-full"
                    style={{ backgroundColor: getStatusColor(item.status) }}
                  >
                    <Text className="text-white text-xs font-semibold">
                      {getStatusLabel(item.status)}
                    </Text>
                  </View>
                </View>

                <View className="flex-row justify-between mb-2">
                  <View>
                    <Text className="text-xs text-muted mb-1">Principal</Text>
                    <Text className="text-sm font-semibold text-foreground">
                      {formatCurrency(item.principalAmount)}
                    </Text>
                  </View>
                  <View>
                    <Text className="text-xs text-muted mb-1">Total Repayment</Text>
                    <Text className="text-sm font-semibold text-foreground">
                      {formatCurrency(item.totalRepaymentAmount)}
                    </Text>
                  </View>
                  <View>
                    <Text className="text-xs text-muted mb-1">Payments</Text>
                    <Text className="text-sm font-semibold text-foreground">{item.numberOfPayments}</Text>
                  </View>
                </View>

                <View className="flex-row justify-between items-center">
                  <Text className="text-xs text-muted">
                    {item.paymentFrequency.charAt(0).toUpperCase() + item.paymentFrequency.slice(1)}
                  </Text>
                  <Text className="text-xs text-muted">{formatDate(new Date(item.createdAt))}</Text>
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </ScrollView>

      {/* Create Loan Modal */}
      {showCreateModal && (
        <LoanFormModal
          visible={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleLoanCreated}
        />
      )}

      {/* Loan Detail Modal */}
      {showDetailModal && selectedLoan && (
        <LoanDetailModal
          visible={showDetailModal}
          loan={selectedLoan}
          onClose={() => setShowDetailModal(false)}
          onRefresh={() => refetch()}
        />
      )}
    </ScreenContainer>
  );
}
