import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  StyleSheet,
  Image,
  Linking,
} from "react-native";
import Constants from "expo-constants";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { CalendarPicker } from "@/components/calendar-picker";

// ─── Types ────────────────────────────────────────────────────────────────────
type PipelineStatus =
  | "abandoned"
  | "pending"
  | "confirmed"
  | "en_route"
  | "in_progress"
  | "completed"
  | "follow_up_sent"
  | "closed"
  | "cancelled";

interface Booking {
  bookingId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  vehicleType: string | null;
  packageType: string | null;
  bookingDate: string;
  timeSlot: string | null;
  location: string;
  status: string;
  assignedTo: string | null;
  preferredDetailerName: string | null;
  pipelineNotes: string | null;
  finalTotal: string | null;
  totalPrice: string | null;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  selectedAddons: string | null;
}

// ─── Stage config ─────────────────────────────────────────────────────────────
const STAGES: { key: PipelineStatus; label: string; color: string; bg: string }[] = [
  { key: "abandoned",      label: "Abandoned Cart", color: "#DC2626", bg: "#FEE2E2" },
  { key: "pending",        label: "Pending",        color: "#F59E0B", bg: "#FEF3C7" },
  { key: "confirmed",      label: "Confirmed",      color: "#3B82F6", bg: "#DBEAFE" },
  { key: "en_route",       label: "En Route",       color: "#8B5CF6", bg: "#EDE9FE" },
  { key: "in_progress",    label: "In Progress",    color: "#F97316", bg: "#FFEDD5" },
  { key: "completed",      label: "Completed",      color: "#10B981", bg: "#D1FAE5" },
  { key: "follow_up_sent", label: "Follow-Up Sent", color: "#6366F1", bg: "#E0E7FF" },
  { key: "closed",         label: "Closed",         color: "#6B7280", bg: "#F3F4F6" },
  { key: "cancelled",      label: "Cancelled",      color: "#EF4444", bg: "#FEE2E2" },
];

const STAGE_MAP = Object.fromEntries(STAGES.map((s) => [s.key, s]));

const DETAILERS = ["Casey", "Lamont", "Michael", "Cameron", "Gabe", "Giovanni"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function todayStr() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function getWeekRange(): { startDate: string; endDate: string } {
  // Mon–Sun work week (Mon = day 1, Sun = day 7)
  const now = new Date(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()) + "T12:00:00");
  const jsDay = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysFromMon = jsDay === 0 ? 6 : jsDay - 1; // Sun counts as 6 days after Mon
  const mon = new Date(now);
  mon.setDate(now.getDate() - daysFromMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
  return { startDate: fmt(mon), endDate: fmt(sun) };
}

function formatDate(dateStr: string) {
  if (!dateStr || dateStr === "TBD") return "TBD";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getServiceIcon(packageType: string | null) {
  if (!packageType) return "🚗";
  const p = packageType.toLowerCase();
  if (p.includes("ceramic")) return "💎";
  if (p.includes("vip")) return "⭐";
  if (p.includes("maintenance")) return "🔄";
  if (p.includes("interior")) return "🪑";
  if (p.includes("exterior")) return "✨";
  if (p.includes("full")) return "🌟";
  return "🚗";
}

// ─── Booking Card ─────────────────────────────────────────────────────────────
function BookingCard({ booking, onPress }: { booking: Booking; onPress: () => void }) {
  const colors = useColors();
  const stage = STAGE_MAP[booking.status as PipelineStatus] ?? STAGE_MAP.confirmed;
  const name = [booking.firstName, booking.lastName].filter(Boolean).join(" ") || "Unknown";
  const price = booking.finalTotal ?? booking.totalPrice ?? null;
  const isAbandoned = booking.status === "abandoned";

  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: stage.color, backgroundColor: colors.surface, borderColor: colors.border }, isAbandoned && styles.abandonedCard]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {isAbandoned && (
        <View style={styles.abandonedBadge}>
          <Text style={styles.abandonedBadgeText}>🛒 Abandoned</Text>
        </View>
      )}
      <View style={styles.cardHeader}>
        <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>{name}</Text>
        {price ? (
          <Text style={[styles.cardPrice, { color: stage.color }]}>${price}</Text>
        ) : null}
      </View>
      <Text style={[styles.cardSub, { color: colors.muted }]} numberOfLines={1}>
        {formatDate(booking.bookingDate)}{booking.timeSlot ? ` · ${booking.timeSlot}` : ""}
      </Text>
      {booking.vehicleType ? (
        <Text style={[styles.cardDetail, { color: colors.muted }]} numberOfLines={1}>{booking.vehicleType}</Text>
      ) : null}
      {booking.packageType ? (
        <Text style={[styles.cardDetail, { color: colors.muted }]} numberOfLines={1}>{booking.packageType}</Text>
      ) : null}
      {booking.phone ? (
        <Text style={[styles.cardDetail, { color: colors.muted }]} numberOfLines={1}>📞 {booking.phone}</Text>
      ) : null}
      {booking.assignedTo || booking.preferredDetailerName ? (
        <Text style={styles.cardAssigned} numberOfLines={1}>
          👤 {booking.preferredDetailerName ?? booking.assignedTo}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

// ─── Lead Card ────────────────────────────────────────────────────────────────
function LeadCard({ lead, onPress }: { lead: Booking; onPress: () => void }) {
  const colors = useColors();
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
  const price = lead.finalTotal ?? lead.totalPrice ?? null;
  const icon = getServiceIcon(lead.packageType);
  const isNew = lead.status === "pending";

  return (
    <TouchableOpacity
      style={[styles.leadCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {/* Service type stripe */}
      <View style={[styles.leadStripe, { backgroundColor: lead.packageType?.toLowerCase().includes("ceramic") ? "#6366F1" : lead.packageType?.toLowerCase().includes("vip") ? "#F59E0B" : "#0EA5E9" }]} />

      <View style={styles.leadCardInner}>
        <View style={styles.leadCardHeader}>
          <View style={styles.leadCardLeft}>
            <Text style={styles.leadIcon}>{icon}</Text>
            <View>
              <Text style={[styles.leadName, { color: colors.foreground }]} numberOfLines={1}>{name}</Text>
              <Text style={[styles.leadService, { color: colors.muted }]} numberOfLines={1}>
                {lead.packageType ?? "Inquiry"} · {capitalize(lead.location)}
              </Text>
            </View>
          </View>
          <View style={styles.leadCardRight}>
            {price ? <Text style={[styles.leadPrice, { color: "#10B981" }]}>${price}</Text> : null}
            {isNew && (
              <View style={styles.newBadge}>
                <Text style={styles.newBadgeText}>NEW</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.leadMeta}>
          {lead.vehicleType ? (
            <Text style={[styles.leadMetaText, { color: colors.muted }]}>🚗 {lead.vehicleType}</Text>
          ) : null}
          {lead.timeSlot && lead.timeSlot !== "TBD" ? (
            <Text style={[styles.leadMetaText, { color: colors.muted }]}>📅 Preferred: {lead.timeSlot}</Text>
          ) : null}
          {lead.phone ? (
            <Text style={[styles.leadMetaText, { color: colors.muted }]}>📞 {lead.phone}</Text>
          ) : null}
        </View>

        {/* Quick action buttons */}
        <View style={styles.leadActions}>
          {lead.phone ? (
            <TouchableOpacity
              style={[styles.leadActionBtn, { backgroundColor: "#10B981" }]}
              onPress={(e) => { e.stopPropagation?.(); Linking.openURL(`tel:${lead.phone}`); }}
            >
              <Text style={styles.leadActionBtnText}>📞 Call</Text>
            </TouchableOpacity>
          ) : null}
          {lead.phone ? (
            <TouchableOpacity
              style={[styles.leadActionBtn, { backgroundColor: "#3B82F6" }]}
              onPress={(e) => { e.stopPropagation?.(); Linking.openURL(`sms:${lead.phone}`); }}
            >
              <Text style={styles.leadActionBtnText}>💬 Text</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.leadActionBtn, { backgroundColor: "#F59E0B" }]}
            onPress={onPress}
          >
            <Text style={styles.leadActionBtnText}>📋 Details</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Stage Column ─────────────────────────────────────────────────────────────
function StageColumn({
  stage,
  bookings,
  onCardPress,
}: {
  stage: typeof STAGES[number];
  bookings: Booking[];
  onCardPress: (b: Booking) => void;
}) {
  return (
    <View style={[styles.column, { borderTopColor: stage.color }]}>
      <View style={[styles.columnHeader, { backgroundColor: stage.bg }]}>
        <Text style={[styles.columnTitle, { color: stage.color }]}>{stage.label}</Text>
        <View style={[styles.badge, { backgroundColor: stage.color }]}>
          <Text style={styles.badgeText}>{bookings.length}</Text>
        </View>
      </View>
      {bookings.length === 0 ? (
        <View style={styles.emptyCol}>
          <Text style={styles.emptyColText}>No bookings</Text>
        </View>
      ) : (
        bookings.map((b) => (
          <BookingCard key={b.bookingId} booking={b} onPress={() => onCardPress(b)} />
        ))
      )}
    </View>
  );
}

// ─── Lead Detail Modal ────────────────────────────────────────────────────────
function LeadDetailModal({
  lead,
  visible,
  onClose,
  onConvert,
  onDismiss,
  refetch,
}: {
  lead: Booking | null;
  visible: boolean;
  onClose: () => void;
  onConvert: (lead: Booking, date: string, time: string, detailer: string, notes: string) => void;
  onDismiss: (lead: Booking, notes: string) => void;
  refetch: () => void;
}) {
  const colors = useColors();
  const [notes, setNotes] = useState("");
  const [convertDate, setConvertDate] = useState("");
  const [convertTime, setConvertTime] = useState("");
  const [selectedDetailer, setSelectedDetailer] = useState("");
  const [showConvertForm, setShowConvertForm] = useState(false);

  React.useEffect(() => {
    if (lead) {
      setNotes(lead.pipelineNotes ?? "");
      setConvertDate(todayStr());
      setConvertTime("");
      setSelectedDetailer("");
      setShowConvertForm(false);
    }
  }, [lead]);

  if (!lead) return null;

  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
  const icon = getServiceIcon(lead.packageType);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modal, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.modalClose}>
            <Text style={[styles.modalCloseText, { color: colors.primary }]}>Close</Text>
          </TouchableOpacity>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Lead Details</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
          {/* Lead Banner */}
          <View style={[styles.leadBanner, { backgroundColor: lead.packageType?.toLowerCase().includes("ceramic") ? "#EDE9FE" : lead.packageType?.toLowerCase().includes("vip") ? "#FEF3C7" : "#E0F2FE" }]}>
            <Text style={styles.leadBannerIcon}>{icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.leadBannerTitle, { color: lead.packageType?.toLowerCase().includes("ceramic") ? "#6366F1" : lead.packageType?.toLowerCase().includes("vip") ? "#B45309" : "#0284C7" }]}>
                {lead.packageType ?? "Service Inquiry"}
              </Text>
              <Text style={[styles.leadBannerSub, { color: colors.muted }]}>
                Lead from {capitalize(lead.location)} · No date scheduled yet
              </Text>
            </View>
          </View>

          {/* Customer Info */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>CUSTOMER</Text>
            <Text style={[styles.infoValue, { color: colors.foreground }]}>{name}</Text>
            {lead.phone ? (
              <TouchableOpacity onPress={() => Linking.openURL(`tel:${lead.phone}`)}>
                <Text style={[styles.infoSub, { color: "#3B82F6" }]}>📞 {lead.phone}</Text>
              </TouchableOpacity>
            ) : null}
            {lead.email ? (
              <TouchableOpacity onPress={() => Linking.openURL(`mailto:${lead.email}`)}>
                <Text style={[styles.infoSub, { color: "#3B82F6" }]}>✉️ {lead.email}</Text>
              </TouchableOpacity>
            ) : null}
            {lead.streetAddress ? (
              <Text style={[styles.infoSub, { color: colors.muted }]}>
                📍 {[lead.streetAddress, lead.city, lead.state, lead.zipCode].filter(Boolean).join(", ")}
              </Text>
            ) : null}
          </View>

          {/* Service Details */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>SERVICE REQUEST</Text>
            {lead.vehicleType ? <InfoRow label="Vehicle" value={lead.vehicleType} colors={colors} /> : null}
            {lead.packageType ? <InfoRow label="Service" value={lead.packageType} colors={colors} /> : null}
            {lead.selectedAddons ? <InfoRow label="Add-ons / Freq." value={lead.selectedAddons} colors={colors} /> : null}
            {(lead.finalTotal ?? lead.totalPrice) ? (
              <InfoRow label="Quoted Price" value={`$${lead.finalTotal ?? lead.totalPrice}`} colors={colors} />
            ) : null}
            {lead.timeSlot && lead.timeSlot !== "TBD" ? (
              <InfoRow label="Preferred Day" value={lead.timeSlot} colors={colors} />
            ) : null}
          </View>

          {/* Quick Contact */}
          {(lead.phone || lead.email) && (
            <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.muted }]}>CONTACT</Text>
              <View style={styles.contactRow}>
                {lead.phone ? (
                  <TouchableOpacity
                    style={[styles.contactBtn, { backgroundColor: "#10B981" }]}
                    onPress={() => Linking.openURL(`tel:${lead.phone}`)}
                  >
                    <Text style={styles.contactBtnText}>📞 Call</Text>
                  </TouchableOpacity>
                ) : null}
                {lead.phone ? (
                  <TouchableOpacity
                    style={[styles.contactBtn, { backgroundColor: "#3B82F6" }]}
                    onPress={() => Linking.openURL(`sms:${lead.phone}`)}
                  >
                    <Text style={styles.contactBtnText}>💬 Text</Text>
                  </TouchableOpacity>
                ) : null}
                {lead.email ? (
                  <TouchableOpacity
                    style={[styles.contactBtn, { backgroundColor: "#6366F1" }]}
                    onPress={() => Linking.openURL(`mailto:${lead.email}`)}
                  >
                    <Text style={styles.contactBtnText}>✉️ Email</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )}

          {/* Notes */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>NOTES</Text>
            <TextInput
              style={[styles.notesInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add follow-up notes..."
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={3}
              returnKeyType="done"
            />
          </View>

          {/* Convert to Booking */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>SCHEDULE THIS LEAD</Text>
            {!showConvertForm ? (
              <TouchableOpacity
                style={[styles.convertBtn, { backgroundColor: "#10B981" }]}
                onPress={() => setShowConvertForm(true)}
              >
                <Text style={styles.convertBtnText}>✅ Convert to Confirmed Booking</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ gap: 10 }}>
                <Text style={[styles.convertLabel, { color: colors.muted }]}>Booking Date (YYYY-MM-DD)</Text>
                <TextInput
                  style={[styles.convertInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                  value={convertDate}
                  onChangeText={setConvertDate}
                  placeholder="2026-06-15"
                  placeholderTextColor={colors.muted}
                  returnKeyType="done"
                />
                <Text style={[styles.convertLabel, { color: colors.muted }]}>Time Slot (optional)</Text>
                <TextInput
                  style={[styles.convertInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                  value={convertTime}
                  onChangeText={setConvertTime}
                  placeholder="9:00 AM"
                  placeholderTextColor={colors.muted}
                  returnKeyType="done"
                />
                <Text style={[styles.convertLabel, { color: colors.muted }]}>Assign Detailer</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                  <View style={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}>
                    {DETAILERS.map((d) => (
                      <TouchableOpacity
                        key={d}
                        style={[styles.detailerChip, { backgroundColor: selectedDetailer === d ? "#3B82F6" : colors.background, borderColor: selectedDetailer === d ? "#3B82F6" : colors.border }]}
                        onPress={() => setSelectedDetailer(d)}
                      >
                        <Text style={[styles.detailerChipText, { color: selectedDetailer === d ? "#fff" : colors.foreground }]}>{d}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
                <TouchableOpacity
                  style={[styles.convertBtn, { backgroundColor: "#10B981" }]}
                  onPress={() => {
                    if (!convertDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
                      Alert.alert("Invalid Date", "Please enter a date in YYYY-MM-DD format.");
                      return;
                    }
                    onConvert(lead, convertDate, convertTime, selectedDetailer, notes);
                  }}
                >
                  <Text style={styles.convertBtnText}>✅ Confirm Booking</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.convertBtn, { backgroundColor: colors.border }]}
                  onPress={() => setShowConvertForm(false)}
                >
                  <Text style={[styles.convertBtnText, { color: colors.muted }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Dismiss Lead */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>DISMISS</Text>
            <TouchableOpacity
              style={[styles.convertBtn, { backgroundColor: "#EF4444" }]}
              onPress={() => {
                Alert.alert("Dismiss Lead", "Mark this lead as closed/not interested?", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Dismiss", style: "destructive", onPress: () => onDismiss(lead, notes) },
                ]);
              }}
            >
              <Text style={styles.convertBtnText}>✗ Mark as Closed</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Booking Detail Modal ─────────────────────────────────────────────────────
function BookingDetailModal({
  booking,
  visible,
  onClose,
  onStageChange,
  onFollowUp,
  onRecovery,
}: {
  booking: Booking | null;
  visible: boolean;
  onClose: () => void;
  onStageChange: (bookingId: string, status: PipelineStatus, notes?: string) => void;
  onFollowUp: (booking: Booking) => void;
  onRecovery: (booking: Booking) => void;
}) {
  const colors = useColors();
  const [notes, setNotes] = useState("");
  const [showStageMenu, setShowStageMenu] = useState(false);

  React.useEffect(() => {
    if (booking) setNotes(booking.pipelineNotes ?? "");
  }, [booking]);

  if (!booking) return null;

  const currentStage = STAGE_MAP[booking.status as PipelineStatus] ?? STAGE_MAP.confirmed;
  const name = [booking.firstName, booking.lastName].filter(Boolean).join(" ") || "Unknown";
  const isAbandoned = booking.status === "abandoned";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modal, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.modalClose}>
            <Text style={[styles.modalCloseText, { color: colors.primary }]}>Close</Text>
          </TouchableOpacity>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Booking Detail</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* ─── Street View Hero ─── */}
        {(() => {
          const addrParts = [booking.streetAddress, booking.city, booking.state, booking.zipCode].filter(Boolean);
          const fullAddr = addrParts.join(', ');
          if (!fullAddr) return null;
          const apiKey = (Constants.expoConfig?.extra?.googleMapsApiKey as string) || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";
          return (
            <Image
              source={{ uri: `https://maps.googleapis.com/maps/api/streetview?size=800x400&location=${encodeURIComponent(fullAddr)}&fov=90&pitch=10&key=${apiKey}` }}
              style={{ width: "100%", height: 220 }}
              resizeMode="cover"
            />
          );
        })()}
        <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
          {/* Abandoned Cart Banner */}
          {isAbandoned && (
            <View style={styles.abandonedBanner}>
              <Text style={styles.abandonedBannerText}>
                🛒 This customer started booking but didn't complete it. Send a recovery SMS to bring them back.
              </Text>
            </View>
          )}

          {/* Customer */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>CUSTOMER</Text>
            <Text style={[styles.infoValue, { color: colors.foreground }]}>{name}</Text>
            {booking.phone ? <Text style={[styles.infoSub, { color: colors.muted }]}>{booking.phone}</Text> : null}
            {booking.email ? <Text style={[styles.infoSub, { color: colors.muted }]}>{booking.email}</Text> : null}
          </View>

          {/* Job Details */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>JOB DETAILS</Text>
            <InfoRow label="Date" value={formatDate(booking.bookingDate)} colors={colors} />
            {booking.timeSlot ? <InfoRow label="Time" value={booking.timeSlot} colors={colors} /> : null}
            <InfoRow label="Location" value={capitalize(booking.location)} colors={colors} />
            {booking.vehicleType ? <InfoRow label="Vehicle" value={booking.vehicleType} colors={colors} /> : null}
            {booking.packageType ? <InfoRow label="Package" value={booking.packageType} colors={colors} /> : null}
            {(booking.finalTotal ?? booking.totalPrice) ? (
              <InfoRow label="Total" value={`$${booking.finalTotal ?? booking.totalPrice}`} colors={colors} />
            ) : null}
            {booking.assignedTo || booking.preferredDetailerName ? (
              <InfoRow label="Detailer" value={booking.preferredDetailerName ?? booking.assignedTo ?? ""} colors={colors} />
            ) : null}
          </View>

          {/* Current Stage */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>PIPELINE STAGE</Text>
            <TouchableOpacity
              style={[styles.stageButton, { backgroundColor: currentStage.bg, borderColor: currentStage.color }]}
              onPress={() => setShowStageMenu(true)}
            >
              <Text style={[styles.stageButtonText, { color: currentStage.color }]}>
                {currentStage.label} ▾
              </Text>
            </TouchableOpacity>

            {showStageMenu && (
              <View style={[styles.stagePicker, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {STAGES.map((s) => (
                  <TouchableOpacity
                    key={s.key}
                    style={[styles.stagePickerItem, booking.status === s.key && { backgroundColor: s.bg }]}
                    onPress={() => {
                      setShowStageMenu(false);
                      onStageChange(booking.bookingId, s.key, notes || undefined);
                    }}
                  >
                    <Text style={[styles.stagePickerText, { color: s.color }]}>{s.label}</Text>
                    {booking.status === s.key && <Text style={{ color: s.color }}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Notes */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>PIPELINE NOTES</Text>
            <TextInput
              style={[styles.notesInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add internal notes..."
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={3}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.saveNotesBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                onStageChange(booking.bookingId, booking.status as PipelineStatus, notes);
                onClose();
              }}
            >
              <Text style={styles.saveNotesBtnText}>Save Notes</Text>
            </TouchableOpacity>
          </View>

          {/* Recovery SMS — for abandoned carts */}
          {isAbandoned && booking.phone ? (
            <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.muted }]}>RECOVERY</Text>
              <TouchableOpacity
                style={[styles.followUpBtn, { backgroundColor: "#DC2626" }]}
                onPress={() => onRecovery(booking)}
              >
                <Text style={styles.followUpBtnText}>📱 Send Recovery SMS</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Follow-up SMS — for completed jobs */}
          {(booking.status === "completed" || booking.status === "follow_up_sent") && booking.phone ? (
            <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.muted }]}>FOLLOW-UP</Text>
              <TouchableOpacity
                style={[styles.followUpBtn, { backgroundColor: booking.status === "follow_up_sent" ? "#9CA3AF" : "#10B981" }]}
                onPress={() => onFollowUp(booking)}
                disabled={booking.status === "follow_up_sent"}
              >
                <Text style={styles.followUpBtnText}>
                  {booking.status === "follow_up_sent" ? "✓ Follow-Up Sent" : "📱 Send Follow-Up SMS"}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function InfoRow({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.infoValue2, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

// ─── Leads Tab ────────────────────────────────────────────────────────────────
function LeadsTab({
  selectedLocation,
  setSelectedLocation,
}: {
  selectedLocation: string | undefined;
  setSelectedLocation: (l: string | undefined) => void;
}) {
  const colors = useColors();
  const [selectedLead, setSelectedLead] = useState<Booking | null>(null);
  const [leadModalVisible, setLeadModalVisible] = useState(false);
  const [serviceFilter, setServiceFilter] = useState<"all" | "maintenance" | "ceramic">("all");

  const { data: leadsRaw, isLoading, refetch } = trpc.pipeline.listLeads.useQuery({
    location: selectedLocation,
  });

  const updateStage = trpc.pipeline.updateStage.useMutation({ onSuccess: () => refetch() });
  const convertLead = trpc.pipeline.convertLeadToBooking.useMutation({
    onSuccess: () => {
      Alert.alert("Booking Confirmed! 🎉", "This lead has been converted to a confirmed booking and moved to the Pipeline.");
      refetch();
      setLeadModalVisible(false);
    },
    onError: () => Alert.alert("Error", "Failed to convert lead. Please try again."),
  });

  const leads = (leadsRaw ?? []) as Booking[];

  const filteredLeads = useMemo(() => {
    if (serviceFilter === "all") return leads;
    return leads.filter((l) => {
      const pkg = (l.packageType ?? "").toLowerCase();
      if (serviceFilter === "ceramic") return pkg.includes("ceramic");
      if (serviceFilter === "maintenance") return pkg.includes("maintenance");
      return true;
    });
  }, [leads, serviceFilter]);

  const maintenanceCount = leads.filter((l) => (l.packageType ?? "").toLowerCase().includes("maintenance")).length;
  const ceramicCount = leads.filter((l) => (l.packageType ?? "").toLowerCase().includes("ceramic")).length;
  const otherCount = leads.length - maintenanceCount - ceramicCount;

  const locations = ["crestview", "niceville", "destin", "fwb", "pensacola"];

  return (
    <View style={{ flex: 1 }}>
      {/* Summary */}
      <View style={[styles.summaryBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <SummaryChip label="Maintenance" count={maintenanceCount} color="#0EA5E9" />
        <SummaryChip label="Ceramic" count={ceramicCount} color="#6366F1" />
        <SummaryChip label="Other" count={otherCount} color="#F59E0B" />
      </View>

      {/* Location Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterRow, { backgroundColor: colors.background, borderBottomColor: colors.border }]}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8, alignItems: "center" }}
      >
        {[undefined, ...locations].map((loc) => (
          <TouchableOpacity
            key={loc ?? "all"}
            style={[styles.filterChip, { backgroundColor: selectedLocation === loc ? colors.primary : colors.surface, borderColor: selectedLocation === loc ? colors.primary : colors.border }]}
            onPress={() => setSelectedLocation(loc)}
          >
            <Text style={[styles.filterChipText, { color: selectedLocation === loc ? "#fff" : colors.foreground }]}>
              {loc ? capitalize(loc === "fwb" ? "Fort Walton" : loc) : "All Locations"}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Service Type Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterRow, { backgroundColor: colors.background, borderBottomColor: colors.border }]}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8, alignItems: "center" }}
      >
        {(["all", "maintenance", "ceramic"] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, {
              backgroundColor: serviceFilter === f ? (f === "ceramic" ? "#6366F1" : f === "maintenance" ? "#0EA5E9" : "#374151") : colors.surface,
              borderColor: serviceFilter === f ? (f === "ceramic" ? "#6366F1" : f === "maintenance" ? "#0EA5E9" : "#374151") : colors.border,
            }]}
            onPress={() => setServiceFilter(f)}
          >
            <Text style={[styles.filterChipText, { color: serviceFilter === f ? "#fff" : colors.foreground }]}>
              {f === "all" ? "All Services" : f === "ceramic" ? "💎 Ceramic" : "🔄 Maintenance"}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Lead List */}
      <ScrollView
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 40 }}
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <Text style={[styles.loadingText, { color: colors.muted }]}>Loading leads...</Text>
          </View>
        ) : filteredLeads.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateIcon}>📬</Text>
            <Text style={[styles.emptyStateTitle, { color: colors.foreground }]}>No leads yet</Text>
            <Text style={[styles.emptyStateSub, { color: colors.muted }]}>
              When customers fill out a Maintenance or Ceramic Coating form on your website, they'll appear here.
            </Text>
          </View>
        ) : (
          filteredLeads.map((lead) => (
            <LeadCard
              key={lead.bookingId}
              lead={lead}
              onPress={() => {
                setSelectedLead(lead);
                setLeadModalVisible(true);
              }}
            />
          ))
        )}
      </ScrollView>

      <LeadDetailModal
        lead={selectedLead}
        visible={leadModalVisible}
        onClose={() => { setLeadModalVisible(false); setSelectedLead(null); }}
        onConvert={(lead, date, time, detailer, notes) => {
          convertLead.mutate({
            bookingId: lead.bookingId,
            bookingDate: date,
            timeSlot: time || undefined,
            assignedTo: detailer || undefined,
            preferredDetailerName: detailer || undefined,
            pipelineNotes: notes || undefined,
          });
        }}
        onDismiss={(lead, notes) => {
          updateStage.mutate({ bookingId: lead.bookingId, status: "closed", pipelineNotes: notes || undefined });
          setLeadModalVisible(false);
          setSelectedLead(null);
        }}
        refetch={refetch}
      />
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminPipelineScreen() {
  const colors = useColors();
  const today = todayStr();

  const [activeTab, setActiveTab] = useState<"pipeline" | "leads" | "conversion">("pipeline");

  // ── Pipeline date range filter ──────────────────────────────────────────────
  const [pipePeriod, setPipePeriod] = useState<"day" | "week" | "month" | "custom">("week");
  const [pipeCustomStart, setPipeCustomStart] = useState<string | null>(null);
  const [pipeCustomEnd, setPipeCustomEnd] = useState<string | null>(null);
  const [showPipeStartPicker, setShowPipeStartPicker] = useState(false);
  const [showPipeEndPicker, setShowPipeEndPicker] = useState(false);

  const getPipeDateRange = (): { startDate: string; endDate: string } => {
    if (pipePeriod === "day") return { startDate: today, endDate: today };
    if (pipePeriod === "week") return getWeekRange();
    if (pipePeriod === "month") {
      const first = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const last = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
      const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
      return { startDate: fmt(first), endDate: fmt(last) };
    }
    if (pipePeriod === "custom" && pipeCustomStart && pipeCustomEnd)
      return { startDate: pipeCustomStart, endDate: pipeCustomEnd };
    // fallback
    return getWeekRange();
  };

  const { startDate, endDate } = getPipeDateRange();
  // ────────────────────────────────────────────────────────────────────────────

  const [selectedLocation, setSelectedLocation] = useState<string | undefined>(undefined);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [activeStageFilter, setActiveStageFilter] = useState<PipelineStatus | "all">("all");

  const { data: bookingsRaw, isLoading, refetch } = trpc.pipeline.list.useQuery({
    startDate,
    endDate,
    location: selectedLocation,
  });

  const { data: leadsCountRaw } = trpc.pipeline.listLeads.useQuery({ location: undefined });
  const leadsCount = (leadsCountRaw ?? []).length;

  const [convPeriod, setConvPeriod] = useState<"day" | "week" | "month" | "all" | "custom">("week");
  const [convCustomStart, setConvCustomStart] = useState<string | null>(null);
  const [convCustomEnd, setConvCustomEnd] = useState<string | null>(null);
  const [showConvStartPicker, setShowConvStartPicker] = useState(false);
  const [showConvEndPicker, setShowConvEndPicker] = useState(false);

  const getConvDateRange = (): { start: Date; end: Date } | null => {
    const now = new Date();
    const startOfDay = (d: Date) => { const r = new Date(d); r.setHours(0,0,0,0); return r; };
    const endOfDay = (d: Date) => { const r = new Date(d); r.setHours(23,59,59,999); return r; };
    if (convPeriod === "day") return { start: startOfDay(now), end: endOfDay(now) };
    if (convPeriod === "week") {
      const mon = new Date(now); mon.setDate(now.getDate() - (now.getDay() + 6) % 7);
      return { start: startOfDay(mon), end: endOfDay(now) };
    }
    if (convPeriod === "month") {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: startOfDay(first), end: endOfDay(now) };
    }
    if (convPeriod === "custom" && convCustomStart && convCustomEnd) {
      return { start: startOfDay(new Date(convCustomStart + "T12:00:00")), end: endOfDay(new Date(convCustomEnd + "T12:00:00")) };
    }
    return null; // "all" — no filter
  };
  const { data: convStats, isLoading: convLoading, refetch: convRefetch } = trpc.pipeline.conversionStats.useQuery(undefined, { staleTime: 60_000 });
  const { data: recoveredList = [] } = trpc.pipeline.recoveredCustomers.useQuery(undefined, { staleTime: 60_000 });
  const filteredRecoveredList = useMemo(() => {
    const range = getConvDateRange();
    if (!range) return recoveredList;
    return recoveredList.filter((item: any) => {
      if (!item.recoveredAt) return false;
      const d = new Date(item.recoveredAt);
      return d >= range.start && d <= range.end;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveredList, convPeriod, convCustomStart, convCustomEnd]);
  const convPeriodData = convPeriod === "day" ? convStats?.today
    : convPeriod === "week" ? convStats?.thisWeek
    : convPeriod === "month" ? convStats?.thisMonth
    : convStats?.allTime;
  const convPeriodLabel = convPeriod === "day" ? "TODAY" : convPeriod === "week" ? "THIS WEEK" : convPeriod === "month" ? "THIS MONTH" : convPeriod === "custom" ? "CUSTOM RANGE" : "ALL TIME";

  const updateStage = trpc.pipeline.updateStage.useMutation({
    onSuccess: () => refetch(),
  });

  const sendFollowUp = trpc.pipeline.sendFollowUpSms.useMutation({
    onSuccess: () => {
      Alert.alert("Sent!", "Follow-up SMS has been sent to the customer.");
      refetch();
    },
    onError: () => Alert.alert("Error", "Failed to send follow-up SMS."),
  });

  const sendRecovery = trpc.pipeline.sendRecoverySms.useMutation({
    onSuccess: () => {
      Alert.alert("Sent!", "Recovery SMS has been sent to the customer.");
      refetch();
    },
    onError: () => Alert.alert("Error", "Failed to send recovery SMS."),
  });

  const bookings = (bookingsRaw ?? []) as Booking[];

  const grouped = useMemo(() => {
    const map: Record<string, Booking[]> = {};
    for (const s of STAGES) map[s.key] = [];
    for (const b of bookings) {
      const key = b.status as PipelineStatus;
      if (map[key]) map[key].push(b);
      else map["confirmed"].push(b);
    }
    return map;
  }, [bookings]);

  const handleStageChange = useCallback((bookingId: string, status: PipelineStatus, notes?: string) => {
    updateStage.mutate({ bookingId, status, pipelineNotes: notes });
    setSelectedBooking((prev) => prev ? { ...prev, status, pipelineNotes: notes ?? prev.pipelineNotes } : prev);
  }, [updateStage]);

  const handleFollowUp = useCallback((booking: Booking) => {
    if (!booking.phone) return;
    Alert.alert(
      "Send Follow-Up SMS",
      `Send a review request + rebooking SMS to ${booking.firstName ?? "the customer"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send",
          onPress: () => sendFollowUp.mutate({
            bookingId: booking.bookingId,
            phone: booking.phone!,
            firstName: booking.firstName ?? "there",
          }),
        },
      ]
    );
  }, [sendFollowUp]);

  const handleRecovery = useCallback((booking: Booking) => {
    if (!booking.phone) return;
    const pkgMsg = booking.packageType ? ` referencing their ${booking.packageType} quote` : "";
    Alert.alert(
      "Send Recovery SMS",
      `Send a personalized recovery SMS to ${booking.firstName ?? "the customer"}${pkgMsg}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send",
          onPress: () => sendRecovery.mutate({
            bookingId: booking.bookingId,
            phone: booking.phone!,
            firstName: booking.firstName ?? "there",
            packageName: booking.packageType ?? undefined,
          }),
        },
      ]
    );
  }, [sendRecovery]);

  const locations = ["crestview", "niceville", "destin", "fwb", "pensacola"];

  const totalAbandoned = grouped["abandoned"]?.length ?? 0;
  const totalActive = (grouped["confirmed"]?.length ?? 0) + (grouped["en_route"]?.length ?? 0) + (grouped["in_progress"]?.length ?? 0);
  const totalCompleted = grouped["completed"]?.length ?? 0;

  return (
    <ScreenContainer edges={["left", "right"]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          {activeTab === "pipeline" ? "Booking Pipeline" : "Leads Inbox"}
        </Text>
        <Text style={[styles.headerSub, { color: colors.muted }]}>
          {activeTab === "pipeline"
            ? `${bookings.length} booking${bookings.length !== 1 ? "s" : ""} · ${startDate} → ${endDate}`
            : `${leadsCount} lead${leadsCount !== 1 ? "s" : ""} awaiting follow-up`}
        </Text>
      </View>

      {/* Tab Bar */}
      <View style={[styles.tabBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "pipeline" && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("pipeline")}
        >
          <Text style={[styles.tabText, { color: activeTab === "pipeline" ? colors.primary : colors.muted }]}>
            📋 Pipeline
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "leads" && { borderBottomColor: "#6366F1", borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("leads")}
        >
          <Text style={[styles.tabText, { color: activeTab === "leads" ? "#6366F1" : colors.muted }]}>
            📬 Leads {leadsCount > 0 ? `(${leadsCount})` : ""}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "conversion" && { borderBottomColor: "#10B981", borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("conversion")}
        >
          <Text style={[styles.tabText, { color: activeTab === "conversion" ? "#10B981" : colors.muted }]}>
            📊 Tracking
          </Text>
        </TouchableOpacity>
      </View>

      {/* ─── Pipeline Tab ─── */}
      {activeTab === "pipeline" && (
        <>
          {/* Summary Bar */}
          <View style={[styles.summaryBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <SummaryChip label="Abandoned" count={totalAbandoned} color="#DC2626" />
            <SummaryChip label="Active" count={totalActive} color="#3B82F6" />
            <SummaryChip label="Done" count={totalCompleted} color="#10B981" />
          </View>

          {/* Date Range Filter */}
          <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.background, gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["day", "week", "month", "custom"] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  onPress={() => { setPipePeriod(p); setShowPipeStartPicker(false); setShowPipeEndPicker(false); }}
                  style={{
                    flex: 1,
                    paddingVertical: 7,
                    borderRadius: 8,
                    alignItems: "center",
                    backgroundColor: pipePeriod === p ? colors.primary : colors.surface,
                    borderWidth: 1,
                    borderColor: pipePeriod === p ? colors.primary : colors.border,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "700", color: pipePeriod === p ? "#fff" : colors.muted }}>
                    {p === "day" ? "Day" : p === "week" ? "Week" : p === "month" ? "Month" : "Custom"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {pipePeriod === "custom" && (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <TouchableOpacity
                    onPress={() => { setShowPipeStartPicker(true); setShowPipeEndPicker(false); }}
                    style={{ flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: showPipeStartPicker ? colors.primary : colors.border, backgroundColor: colors.background }}
                  >
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>FROM</Text>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: pipeCustomStart ? colors.foreground : colors.muted }}>
                      {pipeCustomStart ? new Date(pipeCustomStart + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Select date"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { setShowPipeEndPicker(true); setShowPipeStartPicker(false); }}
                    style={{ flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: showPipeEndPicker ? colors.primary : colors.border, backgroundColor: colors.background }}
                  >
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>TO</Text>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: pipeCustomEnd ? colors.foreground : colors.muted }}>
                      {pipeCustomEnd ? new Date(pipeCustomEnd + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Select date"}
                    </Text>
                  </TouchableOpacity>
                </View>
                {showPipeStartPicker && (
                  <View style={{ borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
                    <CalendarPicker
                      selectedDate={pipeCustomStart ?? undefined}
                      onSelectDate={(d) => { setPipeCustomStart(d); setShowPipeStartPicker(false); }}
                    />
                  </View>
                )}
                {showPipeEndPicker && (
                  <View style={{ borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
                    <CalendarPicker
                      selectedDate={pipeCustomEnd ?? undefined}
                      onSelectDate={(d) => { setPipeCustomEnd(d); setShowPipeEndPicker(false); }}
                    />
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Location Filter */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.filterRow, { backgroundColor: colors.background, borderBottomColor: colors.border }]}
            contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8, alignItems: "center" }}
          >
            {[undefined, ...locations].map((loc) => (
              <TouchableOpacity
                key={loc ?? "all"}
                style={[styles.filterChip, { backgroundColor: selectedLocation === loc ? colors.primary : colors.surface, borderColor: selectedLocation === loc ? colors.primary : colors.border }]}
                onPress={() => setSelectedLocation(loc)}
              >
                <Text style={[styles.filterChipText, { color: selectedLocation === loc ? "#fff" : colors.foreground }]}>
                  {loc ? capitalize(loc === "fwb" ? "Fort Walton" : loc) : "All Locations"}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Stage Filter */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.filterRow, { backgroundColor: colors.background, borderBottomColor: colors.border }]}
            contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8, alignItems: "center" }}
          >
            <TouchableOpacity
              style={[styles.filterChip, { backgroundColor: activeStageFilter === "all" ? "#374151" : colors.surface, borderColor: activeStageFilter === "all" ? "#374151" : colors.border }]}
              onPress={() => setActiveStageFilter("all")}
            >
              <Text style={[styles.filterChipText, { color: activeStageFilter === "all" ? "#fff" : colors.foreground }]}>All Stages</Text>
            </TouchableOpacity>
            {STAGES.map((s) => (
              <TouchableOpacity
                key={s.key}
                style={[styles.filterChip, { backgroundColor: activeStageFilter === s.key ? s.color : colors.surface, borderColor: activeStageFilter === s.key ? s.color : colors.border }]}
                onPress={() => setActiveStageFilter(s.key)}
              >
                <Text style={[styles.filterChipText, { color: activeStageFilter === s.key ? "#fff" : colors.foreground }]}>
                  {s.label} {grouped[s.key]?.length ? `(${grouped[s.key].length})` : ""}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Pipeline Columns */}
          <ScrollView
            refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
          >
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <Text style={[styles.loadingText, { color: colors.muted }]}>Loading pipeline...</Text>
              </View>
            ) : bookings.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateIcon}>📋</Text>
                <Text style={[styles.emptyStateTitle, { color: colors.foreground }]}>No bookings found</Text>
                <Text style={[styles.emptyStateSub, { color: colors.muted }]}>
                  Bookings from all sources will appear here once submitted.
                </Text>
              </View>
            ) : (
              <View style={styles.columnsContainer}>
                {STAGES.filter((s) => activeStageFilter === "all" || s.key === activeStageFilter).map((s) => (
                  <StageColumn
                    key={s.key}
                    stage={s}
                    bookings={grouped[s.key] ?? []}
                    onCardPress={(b) => {
                      setSelectedBooking(b);
                      setModalVisible(true);
                    }}
                  />
                ))}
              </View>
            )}
          </ScrollView>

          {/* Detail Modal */}
          <BookingDetailModal
            booking={selectedBooking}
            visible={modalVisible}
            onClose={() => { setModalVisible(false); setSelectedBooking(null); }}
            onStageChange={handleStageChange}
            onFollowUp={handleFollowUp}
            onRecovery={handleRecovery}
          />
        </>
      )}

      {/* ─── Leads Tab ─── */}
      {activeTab === "leads" && (
        <LeadsTab
          selectedLocation={selectedLocation}
          setSelectedLocation={setSelectedLocation}
        />
      )}

      {/* ─── Conversion Tracking Tab ─── */}
      {activeTab === "conversion" && (
        <ScrollView
          refreshControl={<RefreshControl refreshing={convLoading} onRefresh={convRefetch} />}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
        >
          {/* Period Filter */}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {(["day", "week", "month", "all", "custom"] as const).map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setConvPeriod(p)}
                style={{
                  flex: 1,
                  minWidth: 60,
                  paddingVertical: 9,
                  borderRadius: 10,
                  alignItems: "center",
                  backgroundColor: convPeriod === p ? colors.primary : colors.surface,
                  borderWidth: 1,
                  borderColor: convPeriod === p ? colors.primary : colors.border,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "700", color: convPeriod === p ? "#fff" : colors.muted }}>
                  {p === "day" ? "Day" : p === "week" ? "Week" : p === "month" ? "Month" : p === "all" ? "All" : "Custom"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* Custom date range pickers for top filter */}
          {convPeriod === "custom" && (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <TouchableOpacity
                  onPress={() => { setShowConvStartPicker(true); setShowConvEndPicker(false); }}
                  style={{ flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: showConvStartPicker ? colors.primary : colors.border, backgroundColor: colors.background }}
                >
                  <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 2 }}>FROM</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: convCustomStart ? colors.foreground : colors.muted }}>
                    {convCustomStart ? new Date(convCustomStart + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Select date"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setShowConvEndPicker(true); setShowConvStartPicker(false); }}
                  style={{ flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: showConvEndPicker ? colors.primary : colors.border, backgroundColor: colors.background }}
                >
                  <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 2 }}>TO</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: convCustomEnd ? colors.foreground : colors.muted }}>
                    {convCustomEnd ? new Date(convCustomEnd + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Select date"}
                  </Text>
                </TouchableOpacity>
              </View>
              {showConvStartPicker && (
                <View style={{ borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
                  <CalendarPicker
                    selectedDate={convCustomStart ?? undefined}
                    onSelectDate={(d) => { setConvCustomStart(d); setShowConvStartPicker(false); }}
                  />
                </View>
              )}
              {showConvEndPicker && (
                <View style={{ borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
                  <CalendarPicker
                    selectedDate={convCustomEnd ?? undefined}
                    onSelectDate={(d) => { setConvCustomEnd(d); setShowConvEndPicker(false); }}
                  />
                </View>
              )}
            </View>
          )}

          {/* Stats for selected period */}
          <View style={[styles.convSection, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.convSectionTitle, { color: colors.muted }]}>{convPeriodLabel}</Text>
            <View style={styles.convRow}>
              <View style={[styles.convCard, { borderColor: "#DC2626" }]}>
                <Text style={[styles.convCardValue, { color: "#DC2626" }]}>{convPeriodData?.total ?? "—"}</Text>
                <Text style={[styles.convCardLabel, { color: colors.muted }]}>Abandoned</Text>
              </View>
              <View style={[styles.convCard, { borderColor: "#10B981" }]}>
                <Text style={[styles.convCardValue, { color: "#10B981" }]}>{convPeriodData?.converted ?? "—"}</Text>
                <Text style={[styles.convCardLabel, { color: colors.muted }]}>Recovered</Text>
              </View>
              <View style={[styles.convCard, { borderColor: "#3B82F6" }]}>
                <Text style={[styles.convCardValue, { color: "#3B82F6" }]}>
                  {convPeriodData ? `${convPeriodData.rate}%` : "—"}
                </Text>
                <Text style={[styles.convCardLabel, { color: colors.muted }]}>Rate</Text>
              </View>
            </View>
          </View>

          {/* Week-over-week trend (only visible when week filter is active) */}
          {convPeriod === "week" && convStats && convStats.thisWeek.total > 0 && convStats.lastWeek.total > 0 && (
            <View style={[styles.convSection, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.convSectionTitle, { color: colors.muted }]}>WEEK-OVER-WEEK TREND</Text>
              {(() => {
                const diff = convStats.thisWeek.rate - convStats.lastWeek.rate;
                const isUp = diff >= 0;
                return (
                  <View style={styles.trendRow}>
                    <Text style={[styles.trendArrow, { color: isUp ? "#10B981" : "#DC2626" }]}>
                      {isUp ? "↑" : "↓"}
                    </Text>
                    <Text style={[styles.trendText, { color: isUp ? "#10B981" : "#DC2626" }]}>
                      {Math.abs(diff)}% {isUp ? "improvement" : "decline"} in recovery rate vs last week
                    </Text>
                  </View>
                );
              })()}
            </View>
          )}

          {/* Recovered Customers List */}
          <View style={[styles.convSection, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.convSectionTitle, { color: colors.muted }]}>RECOVERED CUSTOMERS</Text>
            {filteredRecoveredList.length === 0 ? (
              <Text style={[styles.howItWorksText, { color: colors.muted, textAlign: 'center', paddingVertical: 12 }]}>No recovered customers for this period</Text>
            ) : (
              filteredRecoveredList.map((item: any) => {
                const name = `${item.firstName} ${item.lastName}`.trim() || 'Unknown';
                const date = item.recoveredAt ? new Date(item.recoveredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
                const pkg = item.packageType ?? '';
                const price = item.totalPrice ? `$${parseFloat(item.totalPrice).toFixed(2)}` : '';
                return (
                  <View key={item.bookingId} style={[styles.howItWorksRow, { paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.border }]}>
                    <View style={[styles.stepBadge, { backgroundColor: '#10B981' }]}>
                      <Text style={styles.stepBadgeText}>✓</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.howItWorksText, { color: colors.foreground, fontWeight: '600' }]}>{name}</Text>
                      <Text style={[styles.howItWorksText, { color: colors.muted, fontSize: 12 }]}>{[pkg, price, date].filter(Boolean).join(' · ')}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

function SummaryChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <View style={[styles.summaryChip, { borderColor: color }]}>
      <Text style={[styles.summaryCount, { color }]}>{count}</Text>
      <Text style={[styles.summaryLabel, { color }]}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 0.5 },
  headerTitle: { fontSize: 22, fontWeight: "700" },
  headerSub: { fontSize: 13, marginTop: 2 },
  tabBar: { flexDirection: "row", borderBottomWidth: 0.5 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabText: { fontSize: 15, fontWeight: "600" },
  summaryBar: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 12, borderBottomWidth: 0.5 },
  summaryChip: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  summaryCount: { fontSize: 20, fontWeight: "700" },
  summaryLabel: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  filterRow: { borderBottomWidth: 0.5, flexGrow: 0, height: 50 },
  filterChip: { height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  filterChipText: { fontSize: 13, fontWeight: "600", color: "#111827", lineHeight: 17 },
  columnsContainer: { padding: 12, gap: 16 },
  column: { borderTopWidth: 3, borderRadius: 12, overflow: "hidden", backgroundColor: "transparent" },
  columnHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10 },
  columnTitle: { fontSize: 14, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  emptyCol: { padding: 16, alignItems: "center" },
  emptyColText: { color: "#9CA3AF", fontSize: 13 },
  card: { backgroundColor: "transparent", marginHorizontal: 8, marginBottom: 8, borderRadius: 10, padding: 12, borderLeftWidth: 4, borderWidth: 1, borderColor: "rgba(0,0,0,0.08)", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  abandonedCard: { borderStyle: "dashed" },
  abandonedBadge: { backgroundColor: "#FEE2E2", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", marginBottom: 6 },
  abandonedBadgeText: { color: "#DC2626", fontSize: 11, fontWeight: "600" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  cardName: { fontSize: 15, fontWeight: "600", flex: 1 },
  cardPrice: { fontSize: 14, fontWeight: "700", marginLeft: 8 },
  cardSub: { fontSize: 12, marginBottom: 2 },
  cardDetail: { fontSize: 12 },
  cardAssigned: { fontSize: 12, color: "#6366F1", marginTop: 4 },
  // Lead card
  leadCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden", flexDirection: "row", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 3 },
  leadStripe: { width: 5 },
  leadCardInner: { flex: 1, padding: 14 },
  leadCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  leadCardLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  leadCardRight: { alignItems: "flex-end", gap: 4 },
  leadIcon: { fontSize: 28 },
  leadName: { fontSize: 16, fontWeight: "700" },
  leadService: { fontSize: 13, marginTop: 1 },
  leadPrice: { fontSize: 15, fontWeight: "700" },
  newBadge: { backgroundColor: "#10B981", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  newBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  leadMeta: { gap: 3, marginBottom: 10 },
  leadMetaText: { fontSize: 13 },
  leadActions: { flexDirection: "row", gap: 8 },
  leadActionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  leadActionBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  // Lead detail modal
  leadBanner: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, marginBottom: 12 },
  leadBannerIcon: { fontSize: 36 },
  leadBannerTitle: { fontSize: 17, fontWeight: "700" },
  leadBannerSub: { fontSize: 13, marginTop: 2 },
  contactRow: { flexDirection: "row", gap: 10 },
  contactBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  contactBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  convertBtn: { paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  convertBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  convertLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, marginBottom: 2 },
  convertInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 15 },
  detailerChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  detailerChipText: { fontSize: 14, fontWeight: "600" },
  loadingContainer: { padding: 40, alignItems: "center" },
  loadingText: { fontSize: 15 },
  emptyState: { padding: 48, alignItems: "center" },
  emptyStateIcon: { fontSize: 48, marginBottom: 16 },
  emptyStateTitle: { fontSize: 18, fontWeight: "600", marginBottom: 8 },
  emptyStateSub: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  modal: { flex: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  modalClose: { width: 60 },
  modalCloseText: { fontSize: 16 },
  modalTitle: { fontSize: 17, fontWeight: "600" },
  modalBody: { flex: 1, padding: 16 },
  abandonedBanner: { backgroundColor: "#FEE2E2", borderRadius: 10, padding: 12, marginBottom: 12 },
  abandonedBannerText: { color: "#DC2626", fontSize: 13, lineHeight: 18 },
  section: { borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 0.5 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 8 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  infoLabel: { fontSize: 13, flex: 1 },
  infoValue: { fontSize: 16, fontWeight: "600" },
  infoValue2: { fontSize: 13, fontWeight: "500", flex: 2, textAlign: "right" },
  infoSub: { fontSize: 13, marginTop: 2 },
  stageButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, alignSelf: "flex-start" },
  stageButtonText: { fontSize: 15, fontWeight: "600" },
  stagePicker: { marginTop: 8, borderRadius: 10, borderWidth: 0.5, overflow: "hidden" },
  stagePickerItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB" },
  stagePickerText: { fontSize: 14, fontWeight: "500" },
  notesInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14, minHeight: 80, textAlignVertical: "top" },
  saveNotesBtn: { marginTop: 10, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  saveNotesBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  followUpBtn: { paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  followUpBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  // Conversion tracking
  convSection: { borderRadius: 14, padding: 16, borderWidth: 0.5 },
  convSectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 8, textTransform: "uppercase" },
  convSectionSub: { fontSize: 13, lineHeight: 18 },
  convRow: { flexDirection: "row", gap: 10 },
  convCard: { flex: 1, alignItems: "center", paddingVertical: 14, borderRadius: 12, borderWidth: 1.5 },
  convCardValue: { fontSize: 28, fontWeight: "800", lineHeight: 34 },
  convCardLabel: { fontSize: 11, fontWeight: "600", marginTop: 4, letterSpacing: 0.3 },
  trendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  trendArrow: { fontSize: 28, fontWeight: "800", lineHeight: 34 },
  trendText: { fontSize: 14, fontWeight: "600", flex: 1, lineHeight: 20 },
  howItWorksRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  stepBadge: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#0A7EA4", alignItems: "center", justifyContent: "center", marginTop: 1 },
  stepBadgeText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  howItWorksText: { flex: 1, fontSize: 14, lineHeight: 20 },
});
