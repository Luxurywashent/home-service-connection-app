import React, { useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Modal, ScrollView, ActivityIndicator, Alert,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { router } from "expo-router";

type Inquiry = {
  id: number;
  inquiryId: string;
  fullName: string;
  email: string;
  phone?: string | null;
  investmentInterest?: string | null;
  message?: string | null;
  status: "new" | "contacted" | "qualified" | "closed";
  adminNotes?: string | null;
  createdAt: Date | string;
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  new:       { bg: "#EFF6FF", text: "#1D4ED8" },
  contacted: { bg: "#FEF9C3", text: "#854D0E" },
  qualified: { bg: "#F0FDF4", text: "#166534" },
  closed:    { bg: "#F3F4F6", text: "#374151" },
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  closed: "Closed",
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? { bg: "#F3F4F6", text: "#374151" };
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>
        {STATUS_LABELS[status] ?? status}
      </Text>
    </View>
  );
}

function DetailModal({
  inquiry,
  visible,
  onClose,
  onSaved,
}: {
  inquiry: Inquiry;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<Inquiry["status"]>(inquiry.status);
  const [adminNotes, setAdminNotes] = useState(inquiry.adminNotes ?? "");

  const updateMutation = trpc.investor.adminUpdateInquiryStatus.useMutation({
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const handleSave = () => {
    updateMutation.mutate({ inquiryId: inquiry.inquiryId, status, adminNotes });
  };

  const formatDate = (d: Date | string) => {
    const date = typeof d === "string" ? new Date(d) : d;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Inquiry Details</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Contact Info */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact Information</Text>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Name</Text>
              <Text style={styles.infoValue}>{inquiry.fullName}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{inquiry.email}</Text>
            </View>
            {inquiry.phone ? (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Phone</Text>
                <Text style={styles.infoValue}>{inquiry.phone}</Text>
              </View>
            ) : null}
            {inquiry.investmentInterest ? (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Investment Range</Text>
                <Text style={styles.infoValue}>{inquiry.investmentInterest}</Text>
              </View>
            ) : null}
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Submitted</Text>
              <Text style={styles.infoValue}>{formatDate(inquiry.createdAt)}</Text>
            </View>
          </View>

          {/* Message */}
          {inquiry.message ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Message</Text>
              <View style={styles.messageBox}>
                <Text style={styles.messageText}>{inquiry.message}</Text>
              </View>
            </View>
          ) : null}

          {/* Status */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Status</Text>
            <View style={styles.statusRow}>
              {(["new", "contacted", "qualified", "closed"] as Inquiry["status"][]).map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.statusChip, status === s && styles.statusChipActive]}
                  onPress={() => setStatus(s)}
                >
                  <Text style={[styles.statusChipText, status === s && styles.statusChipTextActive]}>
                    {STATUS_LABELS[s]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Admin Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Admin Notes</Text>
            <TextInput
              style={styles.notesInput}
              value={adminNotes}
              onChangeText={setAdminNotes}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              placeholder="Add internal notes about this inquiry..."
              placeholderTextColor="#9CA3AF"
            />
          </View>

          {/* Save */}
          <TouchableOpacity
            style={[styles.saveButton, updateMutation.isPending && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function AdminInvestorInquiriesScreen() {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);

  const { data: inquiries = [], isLoading, refetch } = trpc.investor.adminListInquiries.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });

  const filtered = (inquiries as Inquiry[]).filter((inq) => {
    const matchesSearch =
      !search ||
      inq.fullName.toLowerCase().includes(search.toLowerCase()) ||
      inq.email.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === "all" || inq.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const formatDate = (d: Date | string) => {
    const date = typeof d === "string" ? new Date(d) : d;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const renderItem = ({ item }: { item: Inquiry }) => (
    <TouchableOpacity style={styles.card} onPress={() => setSelectedInquiry(item)}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardName}>{item.fullName}</Text>
        <StatusBadge status={item.status} />
      </View>
      <Text style={styles.cardEmail}>{item.email}</Text>
      {item.phone ? <Text style={styles.cardPhone}>{item.phone}</Text> : null}
      {item.investmentInterest ? (
        <Text style={styles.cardInterest}>💰 {item.investmentInterest}</Text>
      ) : null}
      {item.message ? (
        <Text style={styles.cardMessage} numberOfLines={2}>{item.message}</Text>
      ) : null}
      <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
    </TouchableOpacity>
  );

  return (
    <ScreenContainer className="bg-background">
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Investor Inquiries</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{(inquiries as Inquiry[]).length}</Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or email..."
          placeholderTextColor="#9CA3AF"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Filter Chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {["all", "new", "contacted", "qualified", "closed"].map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.filterChip, filterStatus === s && styles.filterChipActive]}
            onPress={() => setFilterStatus(s)}
          >
            <Text style={[styles.filterChipText, filterStatus === s && styles.filterChipTextActive]}>
              {s === "all" ? "All" : STATUS_LABELS[s]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#7C3AED" />
          <Text style={styles.loadingText}>Loading inquiries...</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📬</Text>
          <Text style={styles.emptyTitle}>No Inquiries Yet</Text>
          <Text style={styles.emptySubtitle}>
            {search || filterStatus !== "all"
              ? "No inquiries match your current filters."
              : "Investor inquiries submitted via the pitch page will appear here."}
          </Text>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={filtered}
          keyExtractor={(item) => item.inquiryId}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isLoading}
        />
      )}

      {/* Detail Modal */}
      {selectedInquiry && (
        <DetailModal
          inquiry={selectedInquiry}
          visible={!!selectedInquiry}
          onClose={() => setSelectedInquiry(null)}
          onSaved={() => { refetch(); setSelectedInquiry(null); }}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  backButton: { padding: 4 },
  backText: { fontSize: 22, color: "#7C3AED" },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: "700", color: "#111827" },
  countBadge: { backgroundColor: "#7C3AED", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  countText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  searchContainer: { paddingHorizontal: 16, paddingBottom: 8 },
  searchInput: {
    backgroundColor: "#F3F4F6", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: "#111827", borderWidth: 1, borderColor: "#E5E7EB",
  },

  filterScroll: { maxHeight: 44 },
  filterContent: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB",
  },
  filterChipActive: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  filterChipText: { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  filterChipTextActive: { color: "#fff" },

  listContent: { padding: 16, gap: 12 },

  card: {
    backgroundColor: "#fff", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "#E5E7EB",
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  cardName: { fontSize: 16, fontWeight: "700", color: "#111827", flex: 1, marginRight: 8 },
  cardEmail: { fontSize: 14, color: "#6B7280", marginBottom: 2 },
  cardPhone: { fontSize: 14, color: "#6B7280", marginBottom: 2 },
  cardInterest: { fontSize: 13, color: "#7C3AED", fontWeight: "600", marginTop: 4 },
  cardMessage: { fontSize: 13, color: "#9CA3AF", marginTop: 6, lineHeight: 18 },
  cardDate: { fontSize: 12, color: "#D1D5DB", marginTop: 8 },

  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 12, fontWeight: "700" },

  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: "#6B7280", fontSize: 15 },

  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: "#111827", marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: "#6B7280", textAlign: "center", lineHeight: 20 },

  // Modal
  modalContainer: { flex: 1, backgroundColor: "#fff" },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB",
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
  closeButton: { padding: 4 },
  closeText: { fontSize: 18, color: "#6B7280" },
  modalBody: { flex: 1 },

  section: { paddingHorizontal: 20, paddingTop: 20 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#7C3AED", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },

  infoRow: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  infoLabel: { width: 140, fontSize: 14, color: "#6B7280", fontWeight: "500" },
  infoValue: { flex: 1, fontSize: 14, color: "#111827", fontWeight: "500" },

  messageBox: { backgroundColor: "#F9FAFB", borderRadius: 10, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  messageText: { fontSize: 14, color: "#374151", lineHeight: 20 },

  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB",
  },
  statusChipActive: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  statusChipText: { fontSize: 14, fontWeight: "600", color: "#6B7280" },
  statusChipTextActive: { color: "#fff" },

  notesInput: {
    backgroundColor: "#F9FAFB", borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: "#E5E7EB", fontSize: 14, color: "#111827",
    minHeight: 100,
  },

  saveButton: {
    backgroundColor: "#7C3AED", marginHorizontal: 20, marginTop: 24,
    paddingVertical: 16, borderRadius: 30, alignItems: "center",
  },
  saveButtonDisabled: { opacity: 0.7 },
  saveButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
