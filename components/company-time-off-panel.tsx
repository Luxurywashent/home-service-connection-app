import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";

import { CalendarPicker } from "@/components/calendar-picker";
import { CompanyAuthorityLoading, CompanyAuthorityMessage, companyTimeListState } from "@/components/company-authority-state";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useJobSyncSync } from "@/lib/jobsync-sync-context";
import {
  COMPANY_TIME_OFF_LEGACY_FALLTHROUGH_BLOCKED,
  companyCanonicalReadError,
} from "@/lib/jobsync-company-authority";
import {
  createHomeServiceConnectedTimeOff,
  getHomeServiceConnectedTimeOff,
  reviewHomeServiceConnectedTimeOff,
  type HomeServiceConnectedTimeOffRequest,
  type HomeServiceConnectedTimeOffRequestType,
} from "@/lib/jobsync-mobile-api";

const STATUS_COLORS: Record<string, string> = {
  pending: "#F59E0B",
  approved: "#22C55E",
  denied: "#EF4444",
};

const REQUEST_TYPES: { id: HomeServiceConnectedTimeOffRequestType; label: string }[] = [
  { id: "vacation", label: "Vacation" },
  { id: "sick", label: "Sick" },
  { id: "personal", label: "Personal" },
  { id: "other", label: "Other" },
];

function daysInclusive(start: string, end: string) {
  const startDate = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "-";
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function tomorrowStr() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function CompanyTimeOffPanel({
  token,
  mode,
}: {
  token: string;
  mode: "request" | "review";
}) {
  const colors = useColors();
  const { revision } = useJobSyncSync();
  const [requests, setRequests] = useState<HomeServiceConnectedTimeOffRequest[]>([]);
  const [canReview, setCanReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "approved" | "denied" | "all">("pending");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [requestType, setRequestType] = useState<HomeServiceConnectedTimeOffRequestType>("vacation");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [activeCalendar, setActiveCalendar] = useState<"start" | "end" | null>(null);
  const [selected, setSelected] = useState<HomeServiceConnectedTimeOffRequest | null>(null);
  const [reviewerNote, setReviewerNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getHomeServiceConnectedTimeOff(token);
      setRequests(list.requests);
      setCanReview(list.canReview);
      setError(null);
    } catch (refreshError) {
      setRequests([]);
      setCanReview(false);
      setError(companyCanonicalReadError(refreshError));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh, revision]);

  const hoursRequested = useMemo(() => {
    if (!startDate || !endDate) return 8;
    return daysInclusive(startDate, endDate) * 8;
  }, [endDate, startDate]);

  const visible = mode === "review"
    ? requests.filter((request) => filter === "all" || request.status === filter)
    : requests;
  const listState = companyTimeListState({ loading, error, itemCount: visible.length });

  const submitRequest = async () => {
    if (!startDate || !endDate) return;
    setSubmitting(true);
    setSubmitError("");
    setSubmitSuccess("");
    try {
      await createHomeServiceConnectedTimeOff(token, {
        startDate,
        endDate,
        hoursRequested,
        requestType,
        reason,
      });
      setStartDate("");
      setEndDate("");
      setReason("");
      setSubmitSuccess("Request submitted to Home Service Connected.");
      await refresh();
    } catch (requestError) {
      setSubmitError(companyCanonicalReadError(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  const decide = async (status: "approved" | "denied") => {
    if (!selected) return;
    setReviewing(true);
    setReviewMessage("");
    try {
      const result = await reviewHomeServiceConnectedTimeOff(token, selected.id, {
        status,
        reviewerNote,
      });
      const coverage = result.approved
        ? ` Coverage updated for ${result.coveredCount} scheduled job(s); ${result.inFieldCount} in-field job(s) stayed assigned.`
        : "";
      setReviewMessage(`${status === "approved" ? "Approved" : "Denied"} through Home Service Connected.${coverage}`);
      setSelected(null);
      setReviewerNote("");
      await refresh();
    } catch (reviewError) {
      setReviewMessage(companyCanonicalReadError(reviewError));
    } finally {
      setReviewing(false);
    }
  };

  return (
    <ScreenContainer edges={["left", "right"]} className="px-5">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ marginBottom: 16, marginTop: 8 }}>
          <Text style={{ color: colors.foreground, fontSize: 24, fontWeight: "800" }}>
            {mode === "review" ? "Time Off" : "Request Time Off"}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
            Requests, approvals, and denials use Home Service Connected. Schedule coverage stays on the canonical Time Off authority.
          </Text>
        </View>

        {mode === "request" ? (
          <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, gap: 12, marginBottom: 20, padding: 16 }}>
            <TouchableOpacity accessibilityRole="button" onPress={() => setActiveCalendar("start")} style={{ paddingVertical: 4 }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Start date</Text>
              <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>{startDate ? formatDate(startDate) : "Select start date"}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" onPress={() => setActiveCalendar("end")} style={{ paddingVertical: 4 }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>End date</Text>
              <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>{endDate ? formatDate(endDate) : "Select end date"}</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {REQUEST_TYPES.map((type) => (
                <TouchableOpacity
                  key={type.id}
                  accessibilityRole="button"
                  onPress={() => setRequestType(type.id)}
                  style={{
                    backgroundColor: requestType === type.id ? colors.primary : colors.background,
                    borderColor: requestType === type.id ? colors.primary : colors.border,
                    borderRadius: 16,
                    borderWidth: 1,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                  }}
                >
                  <Text style={{ color: requestType === type.id ? "#FFFFFF" : colors.foreground, fontSize: 12, fontWeight: "700" }}>{type.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{hoursRequested} hours requested · overlap and coverage are enforced by the server</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Reason (optional)"
              placeholderTextColor={colors.muted}
              style={{ backgroundColor: colors.background, borderColor: colors.border, borderRadius: 12, borderWidth: 1, color: colors.foreground, minHeight: 72, padding: 12 }}
              multiline
            />
            {submitError ? <Text style={{ color: colors.error, fontSize: 13 }}>{submitError}</Text> : null}
            {submitSuccess ? <Text style={{ color: colors.success, fontSize: 13 }}>{submitSuccess}</Text> : null}
            <TouchableOpacity
              accessibilityRole="button"
              disabled={submitting || !startDate || !endDate}
              onPress={() => void submitRequest()}
              style={{
                alignItems: "center",
                backgroundColor: colors.primary,
                borderRadius: 12,
                opacity: submitting || !startDate || !endDate ? 0.6 : 1,
                paddingVertical: 14,
              }}
            >
              {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "800" }}>Submit request</Text>}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {(["pending", "approved", "denied", "all"] as const).map((value) => (
              <TouchableOpacity
                key={value}
                accessibilityRole="button"
                onPress={() => setFilter(value)}
                style={{
                  backgroundColor: filter === value ? colors.primary : colors.surface,
                  borderColor: filter === value ? colors.primary : colors.border,
                  borderRadius: 16,
                  borderWidth: 1,
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                }}
              >
                <Text style={{ color: filter === value ? "#FFFFFF" : colors.muted, fontSize: 12, fontWeight: "600", textTransform: "capitalize" }}>{value}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {reviewMessage ? <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 12 }}>{reviewMessage}</Text> : null}

        {listState === "loading" ? (
          <CompanyAuthorityLoading message="Loading Company Time Off…" />
        ) : listState === "error" ? (
          <CompanyAuthorityMessage title="Company Time Off is unavailable" detail={error ?? COMPANY_TIME_OFF_LEGACY_FALLTHROUGH_BLOCKED} />
        ) : listState === "empty" ? (
          <CompanyAuthorityMessage
            title={mode === "review" ? "No requests in this filter" : "No Time Off requests"}
            detail="This empty list came from Home Service Connected, not a local time-off table."
          />
        ) : (
          <View style={{ gap: 10 }}>
            {visible.map((request) => {
              const statusColor = STATUS_COLORS[request.status] ?? colors.muted;
              return (
                <TouchableOpacity
                  key={request.id}
                  accessibilityRole="button"
                  disabled={mode !== "review" || !canReview || request.status !== "pending"}
                  onPress={() => {
                    setSelected(request);
                    setReviewerNote("");
                  }}
                  style={{
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderLeftColor: statusColor,
                    borderLeftWidth: 4,
                    borderRadius: 14,
                    borderWidth: 1,
                    padding: 16,
                  }}
                >
                  <View style={{ alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                    <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>{request.memberName}</Text>
                    <Text style={{ color: statusColor, fontSize: 11, fontWeight: "700", textTransform: "capitalize" }}>{request.status}</Text>
                  </View>
                  <Text style={{ color: colors.foreground, fontSize: 13 }}>
                    {formatDate(request.startDate)} - {formatDate(request.endDate)}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                    {request.hoursRequested} hrs · {request.requestType}
                  </Text>
                  {request.reason ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{request.reason}</Text> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {activeCalendar ? (
        <View style={{ marginTop: 8 }}>
          <CalendarPicker
            selectedDate={activeCalendar === "start" ? startDate : endDate}
            minDate={activeCalendar === "end" && startDate ? startDate : tomorrowStr()}
            onSelectDate={(dateStr) => {
              if (activeCalendar === "start") {
                setStartDate(dateStr);
                if (endDate && endDate < dateStr) setEndDate("");
                setActiveCalendar("end");
                return;
              }
              setEndDate(dateStr);
              setActiveCalendar(null);
            }}
          />
        </View>
      ) : null}

      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet">
        {selected ? (
          <ScreenContainer edges={["bottom", "left", "right"]} className="px-5">
            <ScrollView showsVerticalScrollIndicator={false}>
              <TouchableOpacity accessibilityRole="button" onPress={() => setSelected(null)} style={{ paddingVertical: 12 }}>
                <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "600" }}>Close</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.foreground, fontSize: 22, fontWeight: "800" }}>{selected.memberName}</Text>
              <Text style={{ color: colors.muted, fontSize: 14, marginTop: 8 }}>
                {formatDate(selected.startDate)} - {formatDate(selected.endDate)}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: 8 }}>
                Approval uses the same Home Service Connected coverage authority as web Time Off. Mobile does not calculate schedule conflicts.
              </Text>
              <TextInput
                value={reviewerNote}
                onChangeText={setReviewerNote}
                placeholder="Reviewer note (optional)"
                placeholderTextColor={colors.muted}
                style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, color: colors.foreground, marginTop: 16, minHeight: 80, padding: 12 }}
                multiline
              />
              <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={reviewing}
                  onPress={() => void decide("denied")}
                  style={{ alignItems: "center", backgroundColor: colors.error, borderRadius: 12, flex: 1, opacity: reviewing ? 0.6 : 1, paddingVertical: 14 }}
                >
                  <Text style={{ color: "#FFFFFF", fontWeight: "800" }}>Deny</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={reviewing}
                  onPress={() => void decide("approved")}
                  style={{ alignItems: "center", backgroundColor: colors.success, borderRadius: 12, flex: 1, opacity: reviewing ? 0.6 : 1, paddingVertical: 14 }}
                >
                  <Text style={{ color: "#FFFFFF", fontWeight: "800" }}>Approve</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </ScreenContainer>
        ) : null}
      </Modal>
    </ScreenContainer>
  );
}
