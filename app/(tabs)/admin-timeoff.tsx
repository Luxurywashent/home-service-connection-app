import { useState } from "react";
import { Text, View, FlatList, TouchableOpacity, ActivityIndicator, Modal, TextInput, ScrollView } from "react-native";
import { CompanyAuthorityLoading } from "@/components/company-authority-state";
import { CompanyTimeOffPanel } from "@/components/company-time-off-panel";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import {
  allowsLegacyTimeOffAuthority,
  resolveCompanyTimeOffAuthority,
  usesCompanyTimeOffAuthority,
} from "@/lib/jobsync-company-authority";
import { trpc } from "@/lib/trpc";

const STATUS_COLORS: Record<string, string> = { pending: "#F59E0B", approved: "#22C55E", denied: "#EF4444" };

export default function AdminTimeOffScreen() {
  const { session, isLoading: jobSyncLoading } = useJobSyncAuth();
  const authority = resolveCompanyTimeOffAuthority({ session, sessionLoading: jobSyncLoading });
  if (authority === "unknown") {
    return <CompanyAuthorityLoading message="Confirming Company identity before Time Off…" />;
  }
  if (usesCompanyTimeOffAuthority(authority) && session?.token) {
    return <CompanyTimeOffPanel token={session.token} mode="review" />;
  }
  if (!allowsLegacyTimeOffAuthority(authority)) {
    return <CompanyAuthorityLoading message="Confirming Company identity before Time Off…" />;
  }
  return <LegacyAdminTimeOffScreen />;
}

function LegacyAdminTimeOffScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<"pending" | "approved" | "denied" | "all">("pending");
  const [selectedReq, setSelectedReq] = useState<any>(null);
  const [managerNote, setManagerNote] = useState("");
  const [processing, setProcessing] = useState(false);

  const { data: allRequests, isLoading } = trpc.timeOff.getAll.useQuery();
  const updateMutation = trpc.timeOff.updateStatus.useMutation({
    onSuccess: () => {
      utils.timeOff.getAll.invalidate();
      utils.timeOff.getPendingCount.invalidate();
      utils.alerts.getSummary.invalidate();
      setSelectedReq(null);
      setManagerNote("");
    },
  });

  const filteredRequests = (allRequests ?? []).filter((r) => filter === "all" || r.status === filter);
  const pendingCount = (allRequests ?? []).filter((r) => r.status === "pending").length;

  const handleDecision = async (status: "approved" | "denied") => {
    if (!selectedReq || !employee) return;
    setProcessing(true);
    try {
      await updateMutation.mutateAsync({
        requestId: selectedReq.requestId,
        status,
        decidedBy: employee.fullName ?? employee.employeeId,
        managerNote: managerNote.trim() || undefined,
        employeeId: selectedReq.employeeId,
        employeeName: selectedReq.fullName,
        startDate: selectedReq.startDate ?? undefined,
        endDate: selectedReq.endDate ?? undefined,
      });
    } catch (e) {
      console.log("Update error:", e);
    } finally {
      setProcessing(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <ScreenContainer edges={["left", "right"]} className="px-5">
      <View style={{ marginTop: 8, marginBottom: 16 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>Time Off</Text>
          {pendingCount > 0 && (
            <View style={{ backgroundColor: colors.warning, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "700" }}>{pendingCount} pending</Text>
            </View>
          )}
        </View>
      </View>

      {/* Filter */}
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {(["pending", "approved", "denied", "all"] as const).map((f) => (
          <TouchableOpacity
            key={f}
            onPress={() => setFilter(f)}
            activeOpacity={0.7}
            style={{
              paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16,
              backgroundColor: filter === f ? colors.primary : colors.surface,
              borderWidth: 1, borderColor: filter === f ? colors.primary : colors.border,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "600", color: filter === f ? "#FFF" : colors.muted, textTransform: "capitalize" }}>
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={filteredRequests}
          keyExtractor={(item) => item.requestId}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={{ alignItems: "center", marginTop: 60 }}>
              <Text style={{ fontSize: 16, color: colors.muted }}>No requests found</Text>
            </View>
          }
          renderItem={({ item }) => {
            const statusColor = STATUS_COLORS[item.status] ?? colors.muted;
            return (
              <TouchableOpacity
                onPress={() => { setSelectedReq(item); setManagerNote(""); }}
                activeOpacity={0.7}
                style={{
                  backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 10,
                  borderWidth: 1, borderColor: colors.border,
                  borderLeftWidth: 4, borderLeftColor: statusColor,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{item.fullName ?? item.employeeId}</Text>
                  <View style={{ backgroundColor: statusColor + "20", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: statusColor, textTransform: "capitalize" }}>{item.status}</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 13, color: colors.foreground }}>
                  {formatDate(item.startDate)} - {formatDate(item.endDate)}
                </Text>
                <View style={{ flexDirection: "row", gap: 16, marginTop: 4 }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>{item.totalDaysRequested} day(s)</Text>
                  <Text style={{ fontSize: 12, color: colors.muted }}>{item.daysNoticeGiven} days notice</Text>
                  <Text style={{ fontSize: 12, color: item.policyValid === "yes" ? colors.success : colors.error, fontWeight: "600" }}>
                    {item.policyValid === "yes" ? "Policy ✓" : "Policy ✗"}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Decision Modal */}
      <Modal visible={!!selectedReq} animationType="slide" presentationStyle="pageSheet">
        {selectedReq && (
          <ScreenContainer edges={["bottom", "left", "right"]} className="px-5">
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ marginTop: 12 }}>
                <TouchableOpacity onPress={() => setSelectedReq(null)} activeOpacity={0.7} style={{ paddingVertical: 8 }}>
                  <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>Close</Text>
                </TouchableOpacity>

                <View style={{ marginTop: 16 }}>
                  <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground, marginBottom: 4 }}>
                    {selectedReq.fullName ?? selectedReq.employeeId}
                  </Text>
                  <Text style={{ fontSize: 14, color: colors.muted, marginBottom: 20 }}>Time Off Request</Text>

                  <View style={{ gap: 8, marginBottom: 24 }}>
                    <InfoRow label="Dates" value={`${formatDate(selectedReq.startDate)} - ${formatDate(selectedReq.endDate)}`} colors={colors} />
                    <InfoRow label="Total Days" value={String(selectedReq.totalDaysRequested)} colors={colors} />
                    <InfoRow label="Notice Given" value={`${selectedReq.daysNoticeGiven} days`} colors={colors} />
                    <InfoRow label="Policy" value={selectedReq.policyValid === "yes" ? "Meets requirements" : "Does not meet requirements"} colors={colors} />
                    {selectedReq.reason && <InfoRow label="Reason" value={selectedReq.reason} colors={colors} />}
                  </View>

                  {/* Policy Validation Display */}
                  <View style={{
                    backgroundColor: selectedReq.policyValid === "yes" ? colors.success + "10" : colors.error + "10",
                    borderRadius: 12, padding: 14, marginBottom: 20,
                    borderWidth: 1, borderColor: selectedReq.policyValid === "yes" ? colors.success + "30" : colors.error + "30",
                  }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: selectedReq.policyValid === "yes" ? colors.success : colors.error }}>
                      {selectedReq.policyMessage ?? (selectedReq.policyValid === "yes" ? "Meets policy" : "Does not meet policy")}
                    </Text>
                  </View>

                  {selectedReq.status === "pending" ? (
                    <>
                      <View style={{ marginBottom: 16 }}>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          Manager Note (optional)
                        </Text>
                        <TextInput
                          value={managerNote}
                          onChangeText={setManagerNote}
                          placeholder="Add a note..."
                          placeholderTextColor={colors.muted}
                          multiline
                          numberOfLines={3}
                          textAlignVertical="top"
                          style={{
                            backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                            borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
                            color: colors.foreground, minHeight: 80,
                          }}
                        />
                      </View>

                      <View style={{ flexDirection: "row", gap: 12 }}>
                        <TouchableOpacity
                          onPress={() => handleDecision("denied")}
                          disabled={processing}
                          activeOpacity={0.8}
                          style={{
                            flex: 1, backgroundColor: colors.error + "15", borderRadius: 12,
                            paddingVertical: 16, alignItems: "center",
                            borderWidth: 1, borderColor: colors.error + "30",
                          }}
                        >
                          <Text style={{ color: colors.error, fontSize: 16, fontWeight: "700" }}>Deny</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDecision("approved")}
                          disabled={processing}
                          activeOpacity={0.8}
                          style={{
                            flex: 1, backgroundColor: colors.success, borderRadius: 12,
                            paddingVertical: 16, alignItems: "center",
                          }}
                        >
                          {processing ? (
                            <ActivityIndicator color="#FFF" />
                          ) : (
                            <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>Approve</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <View style={{
                      backgroundColor: (STATUS_COLORS[selectedReq.status] ?? colors.muted) + "15",
                      borderRadius: 12, padding: 16, alignItems: "center",
                    }}>
                      <Text style={{ color: STATUS_COLORS[selectedReq.status] ?? colors.muted, fontSize: 14, fontWeight: "600", textTransform: "capitalize" }}>
                        {selectedReq.status}
                      </Text>
                      {selectedReq.decidedBy && (
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>By: {selectedReq.decidedBy}</Text>
                      )}
                      {selectedReq.managerNote && (
                        <Text style={{ color: colors.foreground, fontSize: 13, marginTop: 8, textAlign: "center" }}>{selectedReq.managerNote}</Text>
                      )}
                    </View>
                  )}
                </View>
              </View>
            </ScrollView>
          </ScreenContainer>
        )}
      </Modal>
    </ScreenContainer>
  );
}

function InfoRow({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={{
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
      backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
      borderWidth: 1, borderColor: colors.border,
    }}>
      <Text style={{ fontSize: 13, color: colors.muted, flex: 1 }}>{label}</Text>
      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, flex: 2, textAlign: "right" }}>{value}</Text>
    </View>
  );
}
