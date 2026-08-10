import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  TextInput,
  StyleSheet,
  Alert,
  Modal,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useColors } from "@/hooks/use-colors";
import * as Haptics from "expo-haptics";

// ─── Types ────────────────────────────────────────────────────────────────────

type QcRecord = {
  id: number;
  qcId: string;
  jobId: string;
  jobDate: string;
  customerName: string | null;
  customerPhone: string | null;
  detailerName: string | null;
  city: string | null;
  packageType: string | null;
  calledAt: string | Date | null;
  callConfirmed: number;
  callOutcome: string | null;
  twilioCallSid: string | null;
  callDurationSeconds: number | null;
  status: "pending" | "pass" | "fail";
  feedback: string | null;
  reviewedBy: string | null;
  reviewedById: string | null;
};

type TodayJob = {
  jobId: string;
  date: string;
  customerName: string;
  customerPhone: string;
  detailerName: string;
  city: string;
  packageType: string;
  timeSlot: string;
  qc: QcRecord | null;
};

type Tab = "today" | "history";
type CallOutcome = "satisfied" | "issue_reported" | "no_answer" | "voicemail";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTodayDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
}

function formatTime(dt: string | Date | null): string {
  if (!dt) return "";
  const d = typeof dt === "string" ? new Date(dt) : dt;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string): string {
  const [y, m, day] = dateStr.split("-");
  const d = new Date(Number(y), Number(m) - 1, Number(day));
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

const OUTCOME_OPTIONS: { key: CallOutcome; label: string; emoji: string; color: string; bg: string }[] = [
  { key: "satisfied",      label: "Satisfied",      emoji: "😊", color: "#15803D", bg: "#DCFCE7" },
  { key: "issue_reported", label: "Issue Reported", emoji: "⚠️", color: "#92400E", bg: "#FEF3C7" },
  { key: "no_answer",      label: "No Answer",      emoji: "📵", color: "#6B7280", bg: "#F3F4F6" },
  { key: "voicemail",      label: "Left Voicemail", emoji: "📬", color: "#1D4ED8", bg: "#DBEAFE" },
];

// ─── Masked Call Modal ────────────────────────────────────────────────────────

function MaskedCallModal({
  visible, item, defaultPhone, onClose, onConfirm, isLoading,
}: {
  visible: boolean;
  item: TodayJob | null;
  defaultPhone: string;
  onClose: () => void;
  onConfirm: (callerPhone: string) => void;
  isLoading: boolean;
}) {
  const colors = useColors();
  const [phone, setPhone] = useState(defaultPhone);

  React.useEffect(() => {
    if (visible) setPhone(defaultPhone);
  }, [visible, defaultPhone]);

  if (!item) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>📞 QC Call — Masked</Text>
            <Text style={[styles.modalSub, { color: colors.muted }]}>
              Twilio will call your phone first, then connect you to the customer.
              The customer will see{" "}
              <Text style={{ fontWeight: "700", color: colors.foreground }}>(850) 367-8586</Text>
              {" "}— not your personal number.
            </Text>

            <View style={[styles.customerBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[styles.customerBoxLabel, { color: colors.muted }]}>CALLING CUSTOMER</Text>
              <Text style={[styles.customerBoxName, { color: colors.foreground }]}>
                {item.customerName || "Unknown Customer"}
              </Text>
              <Text style={[styles.customerBoxPhone, { color: "#2563EB" }]}>
                {item.customerPhone ? formatPhone(item.customerPhone) : "No phone on file"}
              </Text>
            </View>

            <Text style={[styles.inputLabel, { color: colors.muted }]}>
              YOUR PHONE NUMBER (we'll call this first)
            </Text>
            <TextInput
              style={[styles.phoneInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              value={phone}
              onChangeText={setPhone}
              placeholder="(850) 000-0000"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              returnKeyType="done"
            />

            <View style={styles.modalBtns}>
              <Pressable
                style={({ pressed }) => [styles.cancelBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                onPress={onClose}
              >
                <Text style={[styles.cancelBtnText, { color: colors.muted }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.initiateBtn, { opacity: pressed || isLoading ? 0.7 : 1 }]}
                onPress={() => onConfirm(phone)}
                disabled={isLoading}
              >
                {isLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.initiateBtnText}>Initiate Call</Text>
                }
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Job Card ─────────────────────────────────────────────────────────────────

function JobQcCard({
  item, onCallPressed, onPassFail, onFeedbackSave, onOutcomeSelect,
}: {
  item: TodayJob;
  onCallPressed: (item: TodayJob) => void;
  onPassFail: (item: TodayJob, status: "pass" | "fail") => void;
  onFeedbackSave: (item: TodayJob, feedback: string) => void;
  onOutcomeSelect: (item: TodayJob, outcome: CallOutcome) => void;
}) {
  const colors = useColors();
  const qc = item.qc;
  const isCalled = !!qc?.callConfirmed;
  const status = qc?.status ?? "pending";
  const [feedbackText, setFeedbackText] = useState(qc?.feedback ?? "");
  const [feedbackDirty, setFeedbackDirty] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const statusBg = status === "pass" ? "#DCFCE7" : status === "fail" ? "#FEE2E2" : isCalled ? "#FEF9C3" : "#F3F4F6";
  const statusTextColor = status === "pass" ? "#15803D" : status === "fail" ? "#B91C1C" : isCalled ? "#92400E" : "#6B7280";
  const statusLabel = status === "pass" ? "PASSED" : status === "fail" ? "FAILED" : isCalled ? "CALLED — PENDING" : "NOT CALLED";
  const cityDisplay = item.city ? item.city.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "";

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        onPress={() => setExpanded(e => !e)}
        style={({ pressed }) => [styles.cardHeader, pressed && { opacity: 0.7 }]}
      >
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text style={[styles.customerName, { color: colors.foreground }]}>
              {item.customerName || "Unknown Customer"}
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
              <Text style={[styles.statusBadgeText, { color: statusTextColor }]}>{statusLabel}</Text>
            </View>
          </View>
          <Text style={[styles.subText, { color: colors.muted }]}>
            {item.detailerName ? `Detailer: ${item.detailerName}` : "No detailer assigned"}
            {cityDisplay ? `  •  ${cityDisplay}` : ""}
          </Text>
          {item.packageType ? <Text style={[styles.subText, { color: colors.muted }]}>{item.packageType}</Text> : null}
        </View>
        <Text style={{ color: colors.muted, fontSize: 18 }}>{expanded ? "▲" : "▼"}</Text>
      </Pressable>

      {expanded && (
        <View style={styles.cardBody}>
          {/* Phone + called-at row */}
          <View style={styles.phoneRow}>
            <Text style={[styles.phoneText, { color: colors.foreground }]}>
              {item.customerPhone ? formatPhone(item.customerPhone) : "No phone on file"}
            </Text>
            {isCalled && qc?.calledAt && (
              <Text style={[styles.calledAtText, { color: colors.muted }]}>
                Called at {formatTime(qc.calledAt)}
              </Text>
            )}
          </View>

          {/* Masked badge */}
          {isCalled && qc?.twilioCallSid && (
            <View style={[styles.maskedBadge, { backgroundColor: "#EFF6FF" }]}>
              <Text style={{ color: "#1D4ED8", fontSize: 12, fontWeight: "600" }}>
                🔒 Masked via (850) 367-8586
              </Text>
            </View>
          )}

          {/* Call button */}
          {!isCalled ? (
            <Pressable
              style={({ pressed }) => [styles.callBtn, { backgroundColor: "#2563EB", opacity: pressed ? 0.8 : 1 }]}
              onPress={() => onCallPressed(item)}
            >
              <Text style={styles.callBtnText}>📞  Call Customer (Masked)</Text>
            </Pressable>
          ) : (
            <View style={styles.calledConfirmed}>
              <Text style={{ color: "#15803D", fontWeight: "700", fontSize: 13 }}>✓ Call logged</Text>
            </View>
          )}

          {/* Outcome selector */}
          {isCalled && (
            <View style={styles.outcomeSection}>
              <Text style={[styles.sectionLabel, { color: colors.muted }]}>CALL OUTCOME</Text>
              <View style={styles.outcomeGrid}>
                {OUTCOME_OPTIONS.map(opt => {
                  const isSelected = qc?.callOutcome === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      style={({ pressed }) => [
                        styles.outcomeBtn,
                        { backgroundColor: isSelected ? opt.bg : colors.background, borderColor: isSelected ? opt.color : colors.border, opacity: pressed ? 0.7 : 1 },
                      ]}
                      onPress={() => onOutcomeSelect(item, opt.key)}
                    >
                      <Text style={{ fontSize: 16 }}>{opt.emoji}</Text>
                      <Text style={[styles.outcomeBtnText, { color: isSelected ? opt.color : colors.muted }]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* Pass / Fail */}
          {isCalled && (
            <View style={styles.passFail}>
              <Pressable
                style={({ pressed }) => [styles.passBtn, status === "pass" && styles.passActive, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => onPassFail(item, "pass")}
              >
                <Text style={styles.passBtnText}>✓  Pass</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.failBtn, status === "fail" && styles.failActive, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => onPassFail(item, "fail")}
              >
                <Text style={styles.failBtnText}>✗  Fail</Text>
              </Pressable>
            </View>
          )}

          {/* Feedback */}
          {isCalled && (
            <View style={styles.feedbackSection}>
              <Text style={[styles.sectionLabel, { color: colors.muted }]}>Customer Feedback / Notes</Text>
              <TextInput
                style={[styles.feedbackInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Enter notes from the call..."
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={3}
                value={feedbackText}
                onChangeText={t => { setFeedbackText(t); setFeedbackDirty(true); }}
                returnKeyType="done"
              />
              {feedbackDirty && (
                <Pressable
                  style={({ pressed }) => [styles.saveFeedbackBtn, { opacity: pressed ? 0.8 : 1 }]}
                  onPress={() => { onFeedbackSave(item, feedbackText); setFeedbackDirty(false); }}
                >
                  <Text style={styles.saveFeedbackText}>Save Notes</Text>
                </Pressable>
              )}
              {!feedbackDirty && qc?.feedback ? (
                <Text style={[styles.savedNote, { color: colors.muted }]}>Saved: {qc.feedback}</Text>
              ) : null}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── History Card ─────────────────────────────────────────────────────────────

function HistoryCard({ record, colors }: { record: QcRecord; colors: ReturnType<typeof useColors> }) {
  const [expanded, setExpanded] = useState(false);
  const statusBg = record.status === "pass" ? "#DCFCE7" : record.status === "fail" ? "#FEE2E2" : "#F3F4F6";
  const statusTextColor = record.status === "pass" ? "#15803D" : record.status === "fail" ? "#B91C1C" : "#6B7280";
  const outcome = OUTCOME_OPTIONS.find(o => o.key === record.callOutcome);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        onPress={() => setExpanded(e => !e)}
        style={({ pressed }) => [styles.cardHeader, pressed && { opacity: 0.7 }]}
      >
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text style={[styles.customerName, { color: colors.foreground }]}>
              {record.customerName || "Unknown"}
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
              <Text style={[styles.statusBadgeText, { color: statusTextColor }]}>
                {record.status === "pass" ? "PASSED" : record.status === "fail" ? "FAILED" : "PENDING"}
              </Text>
            </View>
            {outcome && (
              <View style={[styles.statusBadge, { backgroundColor: outcome.bg }]}>
                <Text style={[styles.statusBadgeText, { color: outcome.color }]}>
                  {outcome.emoji} {outcome.label}
                </Text>
              </View>
            )}
          </View>
          <Text style={[styles.subText, { color: colors.muted }]}>
            {formatDate(record.jobDate)}{record.detailerName ? `  •  ${record.detailerName}` : ""}
          </Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 18 }}>{expanded ? "▲" : "▼"}</Text>
      </Pressable>
      {expanded && (
        <View style={styles.cardBody}>
          {record.customerPhone ? <Text style={[styles.subText, { color: colors.foreground }]}>📞 {formatPhone(record.customerPhone)}</Text> : null}
          {record.city ? <Text style={[styles.subText, { color: colors.muted }]}>📍 {record.city.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</Text> : null}
          {record.calledAt ? <Text style={[styles.subText, { color: colors.muted }]}>Called at {formatTime(record.calledAt)}</Text> : null}
          {record.twilioCallSid ? <Text style={[styles.subText, { color: "#1D4ED8" }]}>🔒 Masked call via (850) 367-8586</Text> : null}
          {record.callDurationSeconds ? <Text style={[styles.subText, { color: colors.muted }]}>Duration: {Math.floor(record.callDurationSeconds / 60)}m {record.callDurationSeconds % 60}s</Text> : null}
          {record.feedback ? (
            <View style={[styles.feedbackSection, { marginTop: 8 }]}>
              <Text style={[styles.sectionLabel, { color: colors.muted }]}>Feedback</Text>
              <Text style={[styles.subText, { color: colors.foreground }]}>{record.feedback}</Text>
            </View>
          ) : null}
          {record.reviewedBy ? <Text style={[styles.subText, { color: colors.muted, marginTop: 4 }]}>Reviewed by {record.reviewedBy}</Text> : null}
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function OpsQcScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [callModalItem, setCallModalItem] = useState<TodayJob | null>(null);
  const today = getTodayDate();

  const todayQuery = trpc.ops.qcGetTodayJobs.useQuery({ date: today }, { refetchInterval: 30000 });
  const historyQuery = trpc.ops.qcListHistory.useQuery({ limit: 200 }, { enabled: activeTab === "history" });

  const utils = trpc.useUtils();
  const logCallMut = trpc.ops.qcLogCall.useMutation({
    onSuccess: (data) => {
      utils.ops.qcGetTodayJobs.invalidate();
      if (data.maskedCall) {
        Alert.alert(
          "📞 Call Initiated",
          "Your phone will ring shortly. Pick up and you'll be connected to the customer. They'll see the business number.",
          [{ text: "Got it" }]
        );
      }
    },
    onError: (err) => Alert.alert("Call Error", err.message || "Failed to initiate call."),
  });
  const saveResultMut = trpc.ops.qcSaveResult.useMutation({
    onSuccess: () => { utils.ops.qcGetTodayJobs.invalidate(); utils.ops.qcListHistory.invalidate(); },
  });
  const updateOutcomeMut = trpc.ops.qcUpdateOutcome.useMutation({
    onSuccess: () => utils.ops.qcGetTodayJobs.invalidate(),
  });

  const jobs: TodayJob[] = (todayQuery.data as TodayJob[]) ?? [];
  const stats = useMemo(() => {
    let passed = 0, failed = 0, called = 0, pending = 0;
    for (const j of jobs) {
      if (j.qc?.status === "pass") passed++;
      else if (j.qc?.status === "fail") failed++;
      else if (j.qc?.callConfirmed) called++;
      else pending++;
    }
    return { passed, failed, called, pending };
  }, [jobs]);

  const handleCallPressed = useCallback((item: TodayJob) => {
    setCallModalItem(item);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const handleInitiateCall = useCallback((callerPhone: string) => {
    if (!callModalItem) return;
    const phone = callerPhone.replace(/\D/g, "");
    if (phone.length < 10) { Alert.alert("Invalid Phone", "Please enter a valid 10-digit phone number."); return; }
    logCallMut.mutate({
      jobId: callModalItem.jobId, jobDate: callModalItem.date,
      customerName: callModalItem.customerName, customerPhone: callModalItem.customerPhone,
      detailerName: callModalItem.detailerName, city: callModalItem.city, packageType: callModalItem.packageType,
      reviewedBy: employee?.fullName ?? undefined, reviewedById: employee?.employeeId ?? undefined,
      callerPhone,
    });
    setCallModalItem(null);
  }, [callModalItem, employee, logCallMut]);

  const handlePassFail = useCallback((item: TodayJob, status: "pass" | "fail") => {
    saveResultMut.mutate({
      jobId: item.jobId, jobDate: item.date, status,
      feedback: item.qc?.feedback ?? undefined,
      customerName: item.customerName, customerPhone: item.customerPhone,
      detailerName: item.detailerName, city: item.city, packageType: item.packageType,
      reviewedBy: employee?.fullName ?? undefined, reviewedById: employee?.employeeId ?? undefined,
    });
    if (Platform.OS !== "web") {
      if (status === "pass") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [employee, saveResultMut]);

  const handleFeedbackSave = useCallback((item: TodayJob, feedback: string) => {
    saveResultMut.mutate({
      jobId: item.jobId, jobDate: item.date,
      status: (item.qc?.status as "pass" | "fail") ?? "pending",
      feedback,
      customerName: item.customerName, customerPhone: item.customerPhone,
      detailerName: item.detailerName, city: item.city, packageType: item.packageType,
      reviewedBy: employee?.fullName ?? undefined, reviewedById: employee?.employeeId ?? undefined,
    });
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [employee, saveResultMut]);

  const handleOutcomeSelect = useCallback((item: TodayJob, outcome: CallOutcome) => {
    updateOutcomeMut.mutate({ jobId: item.jobId, outcome });
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [updateOutcomeMut]);

  const historyByDate = useMemo(() => {
    const records = (historyQuery.data as QcRecord[]) ?? [];
    const groups: { date: string; items: QcRecord[] }[] = [];
    const seen = new Map<string, QcRecord[]>();
    for (const r of records) {
      if (!seen.has(r.jobDate)) { seen.set(r.jobDate, []); groups.push({ date: r.jobDate, items: seen.get(r.jobDate)! }); }
      seen.get(r.jobDate)!.push(r);
    }
    return groups;
  }, [historyQuery.data]);

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Quality Control</Text>
          <Text style={[styles.headerSub, { color: colors.muted }]}>{formatDate(today)}</Text>
        </View>
        <View style={[styles.maskedPill, { backgroundColor: "#EFF6FF" }]}>
          <Text style={{ color: "#1D4ED8", fontSize: 11, fontWeight: "700" }}>🔒 Masked Calling ON</Text>
        </View>
      </View>

      {/* Tab bar */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
        {(["today", "history"] as Tab[]).map(tab => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={({ pressed }) => [
              styles.tabBtn,
              activeTab === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.tabBtnText, { color: activeTab === tab ? colors.primary : colors.muted }]}>
              {tab === "today" ? "Today" : "History"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* TODAY TAB */}
      {activeTab === "today" && (
        <>
          <View style={[styles.statsBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            {[
              { num: stats.passed, label: "Passed",  color: "#22C55E" },
              { num: stats.failed, label: "Failed",  color: "#EF4444" },
              { num: stats.called, label: "Called",  color: "#F59E0B" },
              { num: stats.pending, label: "Pending", color: colors.muted },
            ].map((s, i) => (
              <React.Fragment key={s.label}>
                {i > 0 && <View style={[styles.statDivider, { backgroundColor: colors.border }]} />}
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: s.color }]}>{s.num}</Text>
                  <Text style={[styles.statLabel, { color: colors.muted }]}>{s.label}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>

          {todayQuery.isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={[styles.emptyText, { color: colors.muted }]}>Loading jobs...</Text>
            </View>
          ) : jobs.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={[styles.emptyText, { color: colors.muted }]}>No completed jobs for today yet.</Text>
              <Text style={[styles.emptySubText, { color: colors.muted }]}>Jobs appear here once a detailer marks them finished.</Text>
            </View>
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={jobs}
              keyExtractor={item => item.jobId}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <JobQcCard
                  item={item}
                  onCallPressed={handleCallPressed}
                  onPassFail={handlePassFail}
                  onFeedbackSave={handleFeedbackSave}
                  onOutcomeSelect={handleOutcomeSelect}
                />
              )}
            />
          )}
        </>
      )}

      {/* HISTORY TAB */}
      {activeTab === "history" && (
        historyQuery.isLoading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
        ) : historyByDate.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyIcon}>🗂️</Text>
            <Text style={[styles.emptyText, { color: colors.muted }]}>No QC history yet.</Text>
          </View>
        ) : (
          <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
            data={historyByDate}
            keyExtractor={g => g.date}
            contentContainerStyle={styles.list}
            renderItem={({ item: group }) => (
              <View>
                <View style={[styles.dateGroupHeader, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.dateGroupText, { color: colors.muted }]}>{formatDate(group.date)}</Text>
                  <Text style={[styles.dateGroupCount, { color: colors.muted }]}>
                    {group.items.filter(r => r.status === "pass").length} passed · {group.items.filter(r => r.status === "fail").length} failed
                  </Text>
                </View>
                {group.items.map(record => (
                  <HistoryCard key={record.qcId} record={record} colors={colors} />
                ))}
              </View>
            )}
          />
        )
      )}

      <MaskedCallModal
        visible={!!callModalItem}
        item={callModalItem}
        defaultPhone={employee?.phoneNumber ?? ""}
        onClose={() => setCallModalItem(null)}
        onConfirm={handleInitiateCall}
        isLoading={logCallMut.isPending}
      />
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5 },
  headerTitle: { fontSize: 22, fontWeight: "700" },
  headerSub: { fontSize: 13, marginTop: 2 },
  maskedPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  tabBar: { flexDirection: "row", borderBottomWidth: 0.5 },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabBtnText: { fontSize: 14, fontWeight: "600" },
  statsBar: { flexDirection: "row", paddingVertical: 12, borderBottomWidth: 0.5 },
  statItem: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 22, fontWeight: "700" },
  statLabel: { fontSize: 11, marginTop: 2 },
  statDivider: { width: 0.5, marginVertical: 4 },
  list: { padding: 12, paddingBottom: 32 },
  card: { borderRadius: 12, borderWidth: 1, marginBottom: 10, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 8 },
  cardBody: { paddingHorizontal: 14, paddingBottom: 14 },
  customerName: { fontSize: 15, fontWeight: "700" },
  subText: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusBadgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  phoneRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  phoneText: { fontSize: 14, fontWeight: "600" },
  calledAtText: { fontSize: 12 },
  maskedBadge: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, marginBottom: 10, alignSelf: "flex-start" },
  callBtn: { borderRadius: 10, paddingVertical: 12, alignItems: "center", marginBottom: 10 },
  callBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  calledConfirmed: { backgroundColor: "#DCFCE7", borderRadius: 8, paddingVertical: 8, alignItems: "center", marginBottom: 10 },
  outcomeSection: { marginBottom: 10 },
  outcomeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  outcomeBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  outcomeBtnText: { fontSize: 12, fontWeight: "600" },
  passFail: { flexDirection: "row", gap: 10, marginBottom: 10 },
  passBtn: { flex: 1, backgroundColor: "#DCFCE7", borderRadius: 10, paddingVertical: 12, alignItems: "center", borderWidth: 1.5, borderColor: "#86EFAC" },
  passActive: { backgroundColor: "#22C55E", borderColor: "#16A34A" },
  passBtnText: { color: "#15803D", fontWeight: "700", fontSize: 14 },
  failBtn: { flex: 1, backgroundColor: "#FEE2E2", borderRadius: 10, paddingVertical: 12, alignItems: "center", borderWidth: 1.5, borderColor: "#FCA5A5" },
  failActive: { backgroundColor: "#EF4444", borderColor: "#DC2626" },
  failBtnText: { color: "#B91C1C", fontWeight: "700", fontSize: 14 },
  feedbackSection: { marginTop: 4 },
  sectionLabel: { fontSize: 12, fontWeight: "600", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  feedbackInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14, minHeight: 72, textAlignVertical: "top" },
  saveFeedbackBtn: { marginTop: 8, backgroundColor: "#2563EB", borderRadius: 8, paddingVertical: 8, alignItems: "center" },
  saveFeedbackText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  savedNote: { fontSize: 12, marginTop: 6, fontStyle: "italic" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: "600", textAlign: "center", marginBottom: 6 },
  emptySubText: { fontSize: 13, textAlign: "center", lineHeight: 18 },
  dateGroupHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 4, paddingVertical: 8, marginBottom: 4 },
  dateGroupText: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  dateGroupCount: { fontSize: 12 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  modalSub: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  customerBox: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 16 },
  customerBoxLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5, marginBottom: 4 },
  customerBoxName: { fontSize: 16, fontWeight: "700", marginBottom: 2 },
  customerBoxPhone: { fontSize: 15, fontWeight: "600" },
  inputLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 6 },
  phoneInput: { borderWidth: 1, borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 20 },
  modalBtns: { flexDirection: "row", gap: 12 },
  cancelBtn: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  cancelBtnText: { fontSize: 15, fontWeight: "600" },
  initiateBtn: { flex: 2, backgroundColor: "#2563EB", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  initiateBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
