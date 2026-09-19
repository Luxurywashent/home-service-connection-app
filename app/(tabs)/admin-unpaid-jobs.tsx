import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  ScrollView,
  TextInput,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import { CompanyCollectPayment } from "@/components/company-collect-payment";
import { getJobSyncCompanyUnpaidJobs } from "@/lib/jobsync-mobile-api";
import { useJobSyncSync } from "@/lib/jobsync-sync-context";
import {
  COMPANY_LEGACY_FALLTHROUGH_BLOCKED,
  allowsLegacyJobAuthority,
  canonicalJobId,
  companyCanonicalListState,
  companyCanonicalReadError,
  resolveCompanyJobAuthority,
  unpaidJobFromCanonical,
  usesCompanyJobAuthority,
} from "@/lib/jobsync-company-authority";

// ─── Types ───────────────────────────────────────────────────────────────────
type UnpaidJob = {
  jobId: string;
  date: string | null;
  timeSlot: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  vehicleType: string | null;
  packageType: string | null;
  totalPrice: string | null;
  customPrice: string | null;
  depositAmount: string | null;
  discountAmount: string | null;
  status: string;
  assignedTo: string | null;
  notes: string | null;
  location: string | null;
  balanceDue: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatMoney(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  return `$${v.toFixed(2)}`;
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d + "T12:00:00");
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function statusColor(status: string): string {
  switch (status) {
    case "completed": return "#22C55E";
    case "in_progress": return "#F59E0B";
    case "confirmed": return "#3B82F6";
    default: return "#9CA3AF";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "completed": return "Completed";
    case "in_progress": return "In Progress";
    case "confirmed": return "Confirmed";
    default: return status;
  }
}

// ─── Job Detail Modal ─────────────────────────────────────────────────────────
function JobDetailModal({
  job,
  visible,
  onClose,
  onMarkedPaid,
  companyMode = false,
  companyToken,
  companyRole,
  onCompanyRefresh,
}: {
  job: UnpaidJob | null;
  visible: boolean;
  onClose: () => void;
  onMarkedPaid: () => void;
  companyMode?: boolean;
  companyToken?: string | null;
  companyRole?: string;
  onCompanyRefresh?: () => Promise<void> | void;
}) {
  const colors = useColors();
  const reconcileMutation = trpc.jobs.reconcileFromStripe.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        Alert.alert("✅ Reconciled from Stripe", `Payment of $${(data as any).total?.toFixed(2)} was found in Stripe and recorded. This job will be removed from the unpaid list.`);
        onMarkedPaid();
        onClose();
      } else {
        Alert.alert("Not Found in Stripe", (data as any).reason ?? "No succeeded payment found for this job in Stripe. Use 'Mark as Paid' to record it manually.");
      }
    },
    onError: (err) => {
      Alert.alert("Stripe Error", "Could not check Stripe: " + (err.message ?? "Unknown error"));
    },
  });

  const markPaidMutation = trpc.jobs.markPaid.useMutation({
    onSuccess: () => {
      Alert.alert("✅ Marked as Paid", "This job has been recorded as paid and removed from the unpaid list.");
      onMarkedPaid();
      onClose();
    },
    onError: (err) => {
      Alert.alert("Error", "Could not mark job as paid: " + (err.message ?? "Unknown error"));
    },
  });
  const [showMarkPaidSheet, setShowMarkPaidSheet] = useState(false);
  const [markPaidMethod, setMarkPaidMethod] = useState<"credit_debit" | "cash" | "check" | "other">("cash");
  const [markPaidNote, setMarkPaidNote] = useState("");
  const [sendingReceipt, setSendingReceipt] = useState(false);
  const sendReceiptMutation = trpc.jobs.sendReceipt.useMutation();

  if (!job) return null;

  const PAY_METHODS: { id: "credit_debit" | "cash" | "check" | "other"; label: string; emoji: string }[] = [
    { id: "cash", label: "Cash", emoji: "💵" },
    { id: "credit_debit", label: "Card", emoji: "💳" },
    { id: "check", label: "Check", emoji: "📝" },
    { id: "other", label: "Other", emoji: "🔄" },
  ];

  const confirmMarkPaid = () => {
    Alert.alert(
      "Mark as Paid",
      `Record ${formatMoney(job.balanceDue)} payment via ${PAY_METHODS.find(m => m.id === markPaidMethod)?.label ?? markPaidMethod} for ${job.customerName ?? "this customer"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () => {
            markPaidMutation.mutate({
              jobId: job.jobId,
              method: markPaidMethod,
              total: job.balanceDue,
              referenceNote: markPaidNote.trim() || undefined,
            });
          },
        },
      ]
    );
  };

  const callCustomer = () => {
    const phone = job.customerPhone?.replace(/\D/g, "");
    if (!phone) return Alert.alert("No phone", "This job has no customer phone number.");
    Linking.openURL(`tel:${phone}`);
  };

  const textCustomer = () => {
    const phone = job.customerPhone?.replace(/\D/g, "");
    if (!phone) return Alert.alert("No phone", "This job has no customer phone number.");
    const msg = encodeURIComponent(
      `Hi ${job.customerName?.split(" ")[0] ?? "there"}, this is Home Service Connection. We wanted to follow up regarding your recent service on ${formatDate(job.date)}. Your balance due is ${formatMoney(job.balanceDue)}. Please contact us to settle your balance. Thank you!`
    );
    Linking.openURL(`sms:${phone}?body=${msg}`);
  };

  const emailCustomer = () => {
    if (!job.customerEmail) return Alert.alert("No email", "This job has no customer email.");
    const subject = encodeURIComponent("Balance Due — Home Service Connection");
    const body = encodeURIComponent(
      `Hi ${job.customerName?.split(" ")[0] ?? "there"},\n\nThank you for choosing Home Service Connection! We noticed there is an outstanding balance of ${formatMoney(job.balanceDue)} for your service on ${formatDate(job.date)}.\n\nPlease reach out to arrange payment at your earliest convenience.\n\nThank you,\nHome Service Connection`
    );
    Linking.openURL(`mailto:${job.customerEmail}?subject=${subject}&body=${body}`);
  };

  const openMaps = () => {
    const addr = job.customerAddress ?? job.location;
    if (!addr) return;
    Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(addr)}`);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Job Details</Text>
          <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn} activeOpacity={0.7}>
            <Text style={[styles.modalCloseTxt, { color: colors.primary }]}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalScroll} showsVerticalScrollIndicator={false}>
          {/* Balance Due Hero */}
          <View style={styles.balanceHero}>
            <Text style={styles.balanceHeroLabel}>BALANCE DUE</Text>
            <Text style={styles.balanceHeroAmount}>{formatMoney(job.balanceDue)}</Text>
            <View style={[styles.statusPill, { backgroundColor: statusColor(job.status) + "22", borderColor: statusColor(job.status) }]}>
              <Text style={[styles.statusPillText, { color: statusColor(job.status) }]}>{statusLabel(job.status)}</Text>
            </View>
          </View>

          {/* Customer Info */}
          <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.infoCardTitle, { color: colors.muted }]}>CUSTOMER</Text>
            <Text style={[styles.infoCardValue, { color: colors.foreground }]}>{job.customerName ?? "Unknown"}</Text>
            {job.customerPhone && (
              <Text style={[styles.infoCardSub, { color: colors.muted }]}>📞 {job.customerPhone}</Text>
            )}
            {job.customerEmail && (
              <Text style={[styles.infoCardSub, { color: colors.muted }]}>✉️ {job.customerEmail}</Text>
            )}
            {(job.customerAddress || job.location) && (
              <TouchableOpacity onPress={openMaps} activeOpacity={0.7}>
                <Text style={[styles.infoCardSub, { color: colors.primary }]}>
                  📍 {job.customerAddress ?? job.location}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Job Info */}
          <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.infoCardTitle, { color: colors.muted }]}>JOB INFO</Text>
            <View style={styles.infoRow}>
              <Text style={[styles.infoRowLabel, { color: colors.muted }]}>Date</Text>
              <Text style={[styles.infoRowValue, { color: colors.foreground }]}>{formatDate(job.date)}</Text>
            </View>
            {job.timeSlot && (
              <View style={styles.infoRow}>
                <Text style={[styles.infoRowLabel, { color: colors.muted }]}>Time</Text>
                <Text style={[styles.infoRowValue, { color: colors.foreground }]}>{job.timeSlot}</Text>
              </View>
            )}
            {job.vehicleType && (
              <View style={styles.infoRow}>
                <Text style={[styles.infoRowLabel, { color: colors.muted }]}>Vehicle</Text>
                <Text style={[styles.infoRowValue, { color: colors.foreground }]}>{job.vehicleType}</Text>
              </View>
            )}
            {job.packageType && (
              <View style={styles.infoRow}>
                <Text style={[styles.infoRowLabel, { color: colors.muted }]}>Package</Text>
                <Text style={[styles.infoRowValue, { color: colors.foreground }]}>{job.packageType}</Text>
              </View>
            )}
            {job.assignedTo && (
              <View style={styles.infoRow}>
                <Text style={[styles.infoRowLabel, { color: colors.muted }]}>Detailer</Text>
                <Text style={[styles.infoRowValue, { color: colors.foreground }]}>{job.assignedTo}</Text>
              </View>
            )}
          </View>

          {/* Payment Breakdown */}
          <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.infoCardTitle, { color: colors.muted }]}>PAYMENT BREAKDOWN</Text>
            <View style={styles.infoRow}>
              <Text style={[styles.infoRowLabel, { color: colors.muted }]}>Job Total</Text>
              <Text style={[styles.infoRowValue, { color: colors.foreground }]}>{formatMoney(job.totalPrice ?? job.customPrice)}</Text>
            </View>
            {parseFloat(job.depositAmount ?? "0") > 0 && (
              <View style={styles.infoRow}>
                <Text style={[styles.infoRowLabel, { color: colors.muted }]}>Deposit Paid</Text>
                <Text style={[styles.infoRowValue, { color: "#22C55E" }]}>- {formatMoney(job.depositAmount)}</Text>
              </View>
            )}
            {parseFloat(job.discountAmount ?? "0") > 0 && (
              <View style={styles.infoRow}>
                <Text style={[styles.infoRowLabel, { color: colors.muted }]}>Discount</Text>
                <Text style={[styles.infoRowValue, { color: "#22C55E" }]}>- {formatMoney(job.discountAmount)}</Text>
              </View>
            )}
            <View style={[styles.infoRow, styles.infoRowTotal]}>
              <Text style={[styles.infoRowLabel, { color: colors.foreground, fontWeight: "700" }]}>Balance Due</Text>
              <Text style={[styles.infoRowValue, { color: "#EF4444", fontWeight: "900", fontSize: 18 }]}>{formatMoney(job.balanceDue)}</Text>
            </View>
          </View>

          {/* Notes */}
          {job.notes ? (
            <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.infoCardTitle, { color: colors.muted }]}>NOTES</Text>
              <Text style={[styles.infoCardValue, { color: colors.foreground, fontWeight: "400", fontSize: 14 }]}>{job.notes}</Text>
            </View>
          ) : null}

          {/* Mark as Paid */}
          <Text style={[styles.actionsTitle, { color: colors.foreground }]}>Record Payment</Text>
          {companyMode ? (
            companyToken && job && canonicalJobId(job.jobId) ? (
              <CompanyCollectPayment
                token={companyToken}
                jobId={canonicalJobId(job.jobId)!}
                role={companyRole || "technician"}
                authority="company"
                amount={Number((job as UnpaidJob & { amount?: number }).amount ?? job.balanceDue)}
                paidTotal={Number((job as UnpaidJob & { paidTotal?: number }).paidTotal || 0)}
                balance={job.balanceDue}
                paymentStatus={(job as UnpaidJob & { paymentStatus?: string }).paymentStatus || job.status}
                onCanonicalRefresh={onCompanyRefresh}
              />
            ) : (
              <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.infoCardValue, { color: colors.foreground, fontWeight: "600", fontSize: 14 }]}>
                  Card, Apple Pay, Tap to Pay, and local mark-paid stay disabled.
                </Text>
              </View>
            )
          ) : (
          <>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: "#7C3AED" }]}
            onPress={() => reconcileMutation.mutate({ jobId: job.jobId })}
            activeOpacity={0.85}
            disabled={reconcileMutation.isPending}
          >
            <Text style={styles.actionBtnText}>
              {reconcileMutation.isPending ? "🔄  Checking Stripe..." : "🔍  Check Stripe for Payment"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: "#16a34a" }]}
            onPress={() => setShowMarkPaidSheet(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.actionBtnText}>✅  Mark as Paid — {formatMoney(job.balanceDue)}</Text>
          </TouchableOpacity>

          {showMarkPaidSheet && (
            <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600", marginBottom: 10, letterSpacing: 0.5 }}>PAYMENT METHOD</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                {PAY_METHODS.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={[{
                      flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center",
                      borderWidth: 1.5,
                      backgroundColor: markPaidMethod === m.id ? "#16a34a18" : colors.background,
                      borderColor: markPaidMethod === m.id ? "#16a34a" : colors.border,
                    }]}
                    onPress={() => setMarkPaidMethod(m.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontSize: 18 }}>{m.emoji}</Text>
                    <Text style={{ color: markPaidMethod === m.id ? "#16a34a" : colors.muted, fontSize: 11, marginTop: 2 }}>{m.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, color: colors.foreground, fontSize: 14, marginBottom: 12 }}
                placeholder="Reference note (optional)"
                placeholderTextColor={colors.muted}
                value={markPaidNote}
                onChangeText={setMarkPaidNote}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: "#16a34a", marginBottom: 0 }]}
                onPress={confirmMarkPaid}
                activeOpacity={0.85}
                disabled={markPaidMutation.isPending}
              >
                <Text style={styles.actionBtnText}>
                  {markPaidMutation.isPending ? "Saving..." : `✅  Confirm ${formatMoney(job.balanceDue)} Paid`}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Send Receipt */}
          {job.customerEmail && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: "#6366F1", opacity: sendingReceipt ? 0.6 : 1 }]}
              onPress={async () => {
                setSendingReceipt(true);
                try {
                  await sendReceiptMutation.mutateAsync({ jobId: job.jobId });
                  Alert.alert("Receipt Sent ✅", `Payment receipt emailed to ${job.customerEmail}.`);
                } catch (err: any) {
                  Alert.alert("Error", err.message ?? "Failed to send receipt");
                } finally {
                  setSendingReceipt(false);
                }
              }}
              activeOpacity={0.85}
              disabled={sendingReceipt}
            >
              <Text style={styles.actionBtnText}>
                {sendingReceipt ? "Sending Receipt..." : "🧾  Send Receipt to Customer"}
              </Text>
            </TouchableOpacity>
          )}
          </>
          )}

          {/* Follow-Up Actions */}
          <Text style={[styles.actionsTitle, { color: colors.foreground }]}>Follow Up</Text>

          {job.customerPhone && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#22C55E" }]} onPress={callCustomer} activeOpacity={0.85}>
              <Text style={styles.actionBtnText}>📞  Call {job.customerName?.split(" ")[0] ?? "Customer"}</Text>
            </TouchableOpacity>
          )}

          {job.customerPhone && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#3B82F6" }]} onPress={textCustomer} activeOpacity={0.85}>
              <Text style={styles.actionBtnText}>💬  Send Payment Reminder Text</Text>
            </TouchableOpacity>
          )}

          {job.customerEmail && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#8B5CF6" }]} onPress={emailCustomer} activeOpacity={0.85}>
              <Text style={styles.actionBtnText}>✉️  Send Payment Reminder Email</Text>
            </TouchableOpacity>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Job Row Card ─────────────────────────────────────────────────────────────
function JobCard({
  job,
  onPress,
  onCall,
}: {
  job: UnpaidJob;
  onPress: () => void;
  onCall: () => void;
}) {
  const colors = useColors();
  const isOverdue = job.date ? new Date(job.date + "T23:59:59") < new Date() : false;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: isOverdue ? "#EF444440" : colors.border,
          borderLeftColor: isOverdue ? "#EF4444" : statusColor(job.status),
        },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {/* Top row */}
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>
            {job.customerName ?? "Unknown Customer"}
          </Text>
          <Text style={[styles.cardSub, { color: colors.muted }]} numberOfLines={1}>
            {formatDate(job.date)}{job.timeSlot ? `  ·  ${job.timeSlot.split(" - ")[0]}` : ""}
          </Text>
        </View>
        <View style={styles.cardRight}>
          <Text style={[styles.cardBalance, { color: isOverdue ? "#EF4444" : "#F59E0B" }]}>
            {formatMoney(job.balanceDue)}
          </Text>
          <Text style={[styles.cardBalanceLabel, { color: colors.muted }]}>due</Text>
        </View>
      </View>

      {/* Bottom row */}
      <View style={styles.cardBottom}>
        <View style={styles.cardChips}>
          {job.vehicleType && (
            <View style={[styles.chip, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[styles.chipText, { color: colors.muted }]}>{job.vehicleType}</Text>
            </View>
          )}
          {job.packageType && (
            <View style={[styles.chip, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[styles.chipText, { color: colors.muted }]}>{job.packageType}</Text>
            </View>
          )}
          <View style={[styles.chip, { backgroundColor: statusColor(job.status) + "18", borderColor: statusColor(job.status) + "44" }]}>
            <Text style={[styles.chipText, { color: statusColor(job.status) }]}>{statusLabel(job.status)}</Text>
          </View>
          {isOverdue && (
            <View style={[styles.chip, { backgroundColor: "#EF444418", borderColor: "#EF444444" }]}>
              <Text style={[styles.chipText, { color: "#EF4444" }]}>Overdue</Text>
            </View>
          )}
        </View>

        {/* Quick call button */}
        {job.customerPhone && (
          <TouchableOpacity
            style={styles.quickCallBtn}
            onPress={onCall}
            activeOpacity={0.8}
          >
            <Text style={styles.quickCallText}>📞</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminUnpaidJobsScreen() {
  const colors = useColors();
  const { session: jobSyncSession, isLoading: jobSyncLoading } = useJobSyncAuth();
  const { revision: companySyncRevision, refreshCompanyData, invalidateCanonicalSurfaces } = useJobSyncSync();
  const companyAuthority = resolveCompanyJobAuthority({ session: jobSyncSession, sessionLoading: jobSyncLoading });
  const isCompany = usesCompanyJobAuthority(companyAuthority);
  const allowLegacy = allowsLegacyJobAuthority(companyAuthority);
  const [selectedJob, setSelectedJob] = useState<UnpaidJob | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [companyJobs, setCompanyJobs] = useState<UnpaidJob[]>([]);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);

  const query = trpc.jobs.getUnpaid.useQuery({ includeInProgress: true }, { enabled: allowLegacy });
  const jobs: UnpaidJob[] = isCompany ? companyJobs : (query.data?.jobs ?? []) as UnpaidJob[];
  const companyListState = companyCanonicalListState({
    loading: companyLoading || companyAuthority === "unknown",
    error: companyError,
    itemCount: jobs.length,
  });

  const loadCompanyUnpaid = useCallback(async () => {
    if (!isCompany) return;
    if (!jobSyncSession?.token) {
      setCompanyJobs([]);
      setCompanyError(COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
      return;
    }
    setCompanyLoading(true);
    try {
      const rows = await getJobSyncCompanyUnpaidJobs(jobSyncSession.token);
      setCompanyJobs(rows.map(unpaidJobFromCanonical));
      setCompanyError(null);
    } catch (error) {
      setCompanyJobs([]);
      setCompanyError(companyCanonicalReadError(error));
    } finally {
      setCompanyLoading(false);
    }
  }, [isCompany, jobSyncSession?.token]);

  useEffect(() => {
    void loadCompanyUnpaid();
  }, [companySyncRevision, loadCompanyUnpaid]);

  const onRefresh = async () => {
    setRefreshing(true);
    if (isCompany) await loadCompanyUnpaid();
    else if (allowLegacy) await query.refetch();
    setRefreshing(false);
  };

  const filtered = jobs.filter((j) => {
    if (filterStatus !== "all" && j.status !== filterStatus) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        (j.customerName ?? "").toLowerCase().includes(q) ||
        (j.customerPhone ?? "").includes(q) ||
        (j.customerAddress ?? "").toLowerCase().includes(q) ||
        (j.location ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalOwed = filtered.reduce((s, j) => s + j.balanceDue, 0);

  const quickCall = useCallback((job: UnpaidJob) => {
    const phone = job.customerPhone?.replace(/\D/g, "");
    if (!phone) return Alert.alert("No phone", "This job has no customer phone number.");
    Linking.openURL(`tel:${phone}`);
  }, []);

  const STATUS_FILTERS: { key: string; label: string }[] = isCompany
    ? [
        { key: "all", label: "All" },
        { key: "unpaid", label: "Unpaid" },
        { key: "partial", label: "Partial" },
      ]
    : [
        { key: "all", label: "All" },
        { key: "completed", label: "Completed" },
        { key: "in_progress", label: "In Progress" },
        { key: "confirmed", label: "Confirmed" },
      ];

  return (
    <ScreenContainer containerClassName="bg-background">
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Unpaid Jobs</Text>
            <Text style={[styles.headerSub, { color: colors.muted }]}>
              {filtered.length} job{filtered.length !== 1 ? "s" : ""}  ·  {formatMoney(totalOwed)} outstanding
            </Text>
          </View>
          <View style={[styles.totalBadge, { backgroundColor: "#EF444418", borderColor: "#EF444440" }]}>
            <Text style={[styles.totalBadgeText, { color: "#EF4444" }]}>{formatMoney(totalOwed)}</Text>
          </View>
        </View>

        {/* Search */}
        <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ color: colors.muted, fontSize: 16 }}>🔍</Text>
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search by name, phone, address..."
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")} activeOpacity={0.7}>
              <Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Status filter tabs */}
        <View style={styles.filterRow}>
          {STATUS_FILTERS.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.filterTab,
                {
                  backgroundColor: filterStatus === f.key ? "#0a7ea4" : colors.surface,
                  borderColor: filterStatus === f.key ? "#0a7ea4" : colors.border,
                },
              ]}
              onPress={() => setFilterStatus(f.key)}
              activeOpacity={0.8}
            >
              <Text style={[styles.filterTabText, { color: filterStatus === f.key ? "#fff" : colors.foreground }]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {isCompany && companyListState === "error" ? (
        <View style={styles.centered}>
          <Text style={[styles.emptySub, { color: colors.muted, textAlign: "center", paddingHorizontal: 24 }]}>{companyError}</Text>
        </View>
      ) : null}

      {/* Loading */}
      {(isCompany ? companyListState === "loading" : query.isLoading) && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0a7ea4" />
          <Text style={[styles.loadingText, { color: colors.muted }]}>Loading unpaid jobs...</Text>
        </View>
      )}

      {/* Empty */}
      {!(isCompany ? companyListState === "loading" || companyListState === "error" : query.isLoading) && filtered.length === 0 && (
        <View style={styles.centered}>
          <Text style={styles.emptyEmoji}>🎉</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {jobs.length === 0 ? "No unpaid jobs!" : "No matches"}
          </Text>
          <Text style={[styles.emptySub, { color: colors.muted }]}>
            {jobs.length === 0
              ? "All jobs with a price set have been paid."
              : "Try adjusting your search or filter."}
          </Text>
        </View>
      )}

      {/* List */}
      {!(isCompany ? companyListState === "loading" || companyListState === "error" : query.isLoading) && filtered.length > 0 && (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={filtered}
          keyExtractor={(j) => j.jobId}
          renderItem={({ item }) => (
            <JobCard
              job={item}
              onPress={() => setSelectedJob(item)}
              onCall={() => quickCall(item)}
            />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0a7ea4" />}
        />
      )}

      {/* Detail Modal */}
      <JobDetailModal
        job={selectedJob}
        visible={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        onMarkedPaid={() => { setSelectedJob(null); if (isCompany) void loadCompanyUnpaid(); else query.refetch(); }}
        companyMode={!allowLegacy}
        companyToken={jobSyncSession?.token}
        companyRole={jobSyncSession?.user.role}
        onCompanyRefresh={async () => {
          invalidateCanonicalSurfaces();
          await refreshCompanyData({ force: true });
          await loadCompanyUnpaid();
        }}
      />
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
  },
  headerSub: {
    fontSize: 13,
    marginTop: 2,
  },
  totalBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  totalBadgeText: {
    fontSize: 16,
    fontWeight: "900",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  filterRow: {
    flexDirection: "row",
    gap: 6,
  },
  filterTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  filterTabText: {
    fontSize: 11,
    fontWeight: "700",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 32,
  },
  loadingText: {
    fontSize: 14,
  },
  emptyEmoji: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  emptySub: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  list: {
    padding: 14,
    gap: 10,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 4,
    padding: 14,
    gap: 10,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  cardName: {
    fontSize: 15,
    fontWeight: "700",
  },
  cardSub: {
    fontSize: 12,
    marginTop: 2,
  },
  cardRight: {
    alignItems: "flex-end",
  },
  cardBalance: {
    fontSize: 18,
    fontWeight: "900",
  },
  cardBalanceLabel: {
    fontSize: 10,
    fontWeight: "600",
  },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    flex: 1,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 10,
    fontWeight: "600",
  },
  quickCallBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#22C55E",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  quickCallText: {
    fontSize: 18,
  },
  // Modal
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalCloseTxt: {
    fontSize: 16,
    fontWeight: "600",
  },
  modalScroll: {
    padding: 20,
    gap: 14,
  },
  balanceHero: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 6,
  },
  balanceHeroLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1.2,
  },
  balanceHeroAmount: {
    fontSize: 48,
    fontWeight: "900",
    color: "#EF4444",
  },
  statusPill: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  infoCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 6,
    marginBottom: 4,
  },
  infoCardTitle: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  infoCardValue: {
    fontSize: 16,
    fontWeight: "600",
  },
  infoCardSub: {
    fontSize: 13,
    lineHeight: 20,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  infoRowTotal: {
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    marginTop: 4,
    paddingTop: 8,
  },
  infoRowLabel: {
    fontSize: 13,
  },
  infoRowValue: {
    fontSize: 14,
    fontWeight: "600",
  },
  actionsTitle: {
    fontSize: 16,
    fontWeight: "800",
    marginTop: 8,
    marginBottom: 4,
  },
  actionBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  actionBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});
