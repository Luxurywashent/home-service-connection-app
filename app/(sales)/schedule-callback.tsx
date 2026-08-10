import { useState, useCallback, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Alert, Platform, Modal, FlatList,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";

function getCallbacksRoute(isAdmin: boolean, isSalesRep: boolean): string {
  if (isAdmin) return "/(tabs)/admin-callbacks";
  if (isSalesRep) return "/(sales)/callbacks";
  return "/(tabs)/schedule";
}

const TIMEZONES = [
  { label: "Central (CST/CDT)", value: "America/Chicago" },
  { label: "Eastern (EST/EDT)", value: "America/New_York" },
  { label: "Mountain (MST/MDT)", value: "America/Denver" },
  { label: "Pacific (PST/PDT)", value: "America/Los_Angeles" },
];

function generateId(): string {
  return `CB_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
}

function buildIso(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  const tzDate = new Date(`${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}`);
  const offsetMs = date.getTime() - tzDate.getTime();
  return new Date(date.getTime() + offsetMs).toISOString();
}

function formatDateDisplay(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatTimeDisplay(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function getInitialDate(): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30);
  const mins = Math.ceil(d.getMinutes() / 15) * 15;
  d.setMinutes(mins % 60);
  if (mins >= 60) d.setHours(d.getHours() + 1);
  d.setSeconds(0, 0);
  return d;
}

// Parse a full customer name into first/last
function parseName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export default function ScheduleCallback() {
  const colors = useColors();
  const router = useRouter();
  const { employee, isAdmin, isSalesRep } = useEmployeeAuth();

  // Customer search
  const [customerSearch, setCustomerSearch] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [customerSelected, setCustomerSelected] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Form fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date>(getInitialDate());
  const [timezone, setTimezone] = useState("America/Chicago");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Picker visibility
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const isIOS = Platform.OS === "ios";

  // Customer search query — only runs when debouncedSearch has 2+ chars
  const { data: customerResults, isFetching: searchLoading } = trpc.customers.listAll.useQuery(
    { search: debouncedSearch },
    { enabled: debouncedSearch.length >= 2 },
  );

  const scheduleMutation = trpc.salesCallback.schedule.useMutation();

  const handleSearchChange = useCallback((text: string) => {
    setCustomerSearch(text);
    setCustomerSelected(false);
    setShowSuggestions(text.length >= 2);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(text);
    }, 300);
  }, []);

  const handleSelectCustomer = useCallback((customer: { customerName: string; customerPhone: string | null; customerEmail: string | null }) => {
    const { first, last } = parseName(customer.customerName ?? "");
    setFirstName(first);
    setLastName(last);
    setPhone(customer.customerPhone ?? "");
    setEmail(customer.customerEmail ?? "");
    setCustomerSearch(customer.customerName ?? "");
    setCustomerSelected(true);
    setShowSuggestions(false);
  }, []);

  const handleClearCustomer = useCallback(() => {
    setCustomerSearch("");
    setCustomerSelected(false);
    setFirstName("");
    setLastName("");
    setPhone("");
    setEmail("");
    setDebouncedSearch("");
  }, []);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!firstName.trim()) errs.firstName = "First name is required";
    if (!lastName.trim()) errs.lastName = "Last name is required";
    if (!phone.trim() || phone.replace(/\D/g, "").length < 10) errs.phone = "Valid phone number required";
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Invalid email format";
    if (selectedDate <= new Date()) errs.date = "Scheduled time must be in the future";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    if (!employee) return;
    setSubmitting(true);
    try {
      const scheduledAt = buildIso(selectedDate, timezone);
      await scheduleMutation.mutateAsync({
        callbackId: generateId(),
        assignedTo: employee.employeeId,
        assignedToName: employee.fullName,
        prospectFirstName: firstName.trim(),
        prospectLastName: lastName.trim(),
        prospectPhone: phone.trim(),
        prospectEmail: email.trim() || undefined,
        scheduledAt,
        timezone,
        notes: notes.trim() || undefined,
        createdBy: employee.employeeId,
      });
      const postRoute = getCallbacksRoute(isAdmin, isSalesRep);
      Alert.alert(
        "Callback Scheduled!",
        `Your callback with ${firstName} ${lastName} is set for ${formatDateDisplay(selectedDate)} at ${formatTimeDisplay(selectedDate)}.`,
        [{ text: "OK", onPress: () => router.replace(postRoute as any) }],
      );
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to schedule callback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const styles = StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, gap: 12 },
    backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: colors.border },
    title: { fontSize: 20, fontWeight: "800", color: colors.foreground },
    section: { paddingHorizontal: 16, marginBottom: 20 },
    sectionTitle: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
    row: { flexDirection: "row", gap: 10 },
    fieldWrap: { marginBottom: 12, flex: 1 },
    label: { fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 5 },
    input: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
      fontSize: 15, color: colors.foreground,
    },
    inputError: { borderColor: colors.error },
    errorText: { fontSize: 11, color: colors.error, marginTop: 3 },
    pickerBtn: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13,
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    },
    pickerBtnError: { borderColor: colors.error },
    pickerBtnText: { fontSize: 15, color: colors.foreground, fontWeight: "500" },
    pickerChevron: { fontSize: 14, color: colors.muted },
    tzRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
    tzBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    tzBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    tzText: { fontSize: 12, color: colors.muted, fontWeight: "600" },
    tzTextActive: { color: "#FFF" },
    submitBtn: {
      marginHorizontal: 16, marginBottom: 32, backgroundColor: colors.primary,
      borderRadius: 14, paddingVertical: 16, alignItems: "center",
    },
    submitText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
    // iOS inline picker modal
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 },
    modalHeader: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
    modalDoneBtn: { paddingHorizontal: 12, paddingVertical: 6 },
    modalDoneText: { fontSize: 16, color: colors.primary, fontWeight: "600" },
    // Customer search
    searchWrap: { position: "relative", marginBottom: 4 },
    searchInputRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
    searchInput: { flex: 1, fontSize: 15, color: colors.foreground },
    searchClear: { paddingLeft: 8 },
    searchClearText: { fontSize: 18, color: colors.muted },
    suggestionsBox: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: 10, marginTop: 4, overflow: "hidden",
      shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 4,
    },
    suggestionItem: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    suggestionName: { fontSize: 15, fontWeight: "600", color: colors.foreground },
    suggestionSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
    selectedBadge: { flexDirection: "row", alignItems: "center", backgroundColor: colors.primary + "22", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 12, gap: 6 },
    selectedBadgeText: { fontSize: 13, color: colors.primary, fontWeight: "600", flex: 1 },
    selectedBadgeClear: { fontSize: 13, color: colors.primary, fontWeight: "700" },
  });

  // Map server results (fullName/phone/email) to the shape expected by handleSelectCustomer
  // Remove the redundant client-side name filter — the server already applied the search.
  const suggestions: Array<{ customerName: string; customerPhone: string | null; customerEmail: string | null }> = customerResults
    ? Array.from(
        new Map(
          customerResults
            .filter(c => (c as any).fullName || (c as any).customerName)
            .map(c => {
              const name = (c as any).fullName ?? (c as any).customerName ?? "";
              const phone = (c as any).phone ?? (c as any).customerPhone ?? null;
              const email = (c as any).email ?? (c as any).customerEmail ?? null;
              return [name.toLowerCase(), { customerName: name, customerPhone: phone, customerEmail: email }];
            })
        ).values()
      ).slice(0, 8)
    : [];

  return (
    <ScreenContainer edges={["left", "right"]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace(getCallbacksRoute(isAdmin, isSalesRep) as any)} activeOpacity={0.7}>
          <Text style={{ fontSize: 18, color: colors.foreground }}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Schedule Callback</Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>

        {/* Customer Search */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Search Existing Customer</Text>
          <Text style={[styles.label, { marginBottom: 8 }]}>Type a name to auto-fill their info</Text>

          {customerSelected ? (
            <View style={styles.selectedBadge}>
              <Text style={styles.selectedBadgeText}>✓ {customerSearch}</Text>
              <TouchableOpacity onPress={handleClearCustomer} activeOpacity={0.7}>
                <Text style={styles.selectedBadgeClear}>✕ Clear</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.searchWrap}>
              <View style={styles.searchInputRow}>
                <TextInput
                  style={styles.searchInput}
                  value={customerSearch}
                  onChangeText={handleSearchChange}
                  placeholder="Search by customer name..."
                  placeholderTextColor={colors.muted}
                  autoCapitalize="words"
                  returnKeyType="search"
                />
                {searchLoading && <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 8 }} />}
                {customerSearch.length > 0 && !searchLoading && (
                  <TouchableOpacity style={styles.searchClear} onPress={handleClearCustomer} activeOpacity={0.7}>
                    <Text style={styles.searchClearText}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>

              {showSuggestions && suggestions.length > 0 && (
                <View style={styles.suggestionsBox}>
                  <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
                    data={suggestions}
                    keyExtractor={(item, i) => `${item.customerName}-${i}`}
                    scrollEnabled={false}
                    renderItem={({ item, index }) => (
                      <TouchableOpacity
                        style={[styles.suggestionItem, index === suggestions.length - 1 && { borderBottomWidth: 0 }]}
                        onPress={() => handleSelectCustomer(item as any)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.suggestionName}>{item.customerName}</Text>
                        <Text style={styles.suggestionSub}>
                          {[item.customerPhone, item.customerEmail].filter(Boolean).join(" · ") || "No contact info"}
                        </Text>
                      </TouchableOpacity>
                    )}
                  />
                </View>
              )}

              {showSuggestions && !searchLoading && suggestions.length === 0 && debouncedSearch.length >= 2 && (
                <View style={[styles.suggestionsBox, { padding: 14 }]}>
                  <Text style={[styles.suggestionSub, { textAlign: "center" }]}>No customers found — fill in details below</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Prospect Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prospect Information</Text>
          <View style={styles.row}>
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>First Name *</Text>
              <TextInput
                style={[styles.input, errors.firstName && styles.inputError]}
                value={firstName} onChangeText={setFirstName}
                placeholder="First name" placeholderTextColor={colors.muted}
                autoCapitalize="words" returnKeyType="next"
              />
              {errors.firstName ? <Text style={styles.errorText}>{errors.firstName}</Text> : null}
            </View>
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Last Name *</Text>
              <TextInput
                style={[styles.input, errors.lastName && styles.inputError]}
                value={lastName} onChangeText={setLastName}
                placeholder="Last name" placeholderTextColor={colors.muted}
                autoCapitalize="words" returnKeyType="next"
              />
              {errors.lastName ? <Text style={styles.errorText}>{errors.lastName}</Text> : null}
            </View>
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Phone Number *</Text>
            <TextInput
              style={[styles.input, errors.phone && styles.inputError]}
              value={phone} onChangeText={setPhone}
              placeholder="(555) 555-5555" placeholderTextColor={colors.muted}
              keyboardType="phone-pad" returnKeyType="next"
            />
            {errors.phone ? <Text style={styles.errorText}>{errors.phone}</Text> : null}
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Email (optional)</Text>
            <TextInput
              style={[styles.input, errors.email && styles.inputError]}
              value={email} onChangeText={setEmail}
              placeholder="prospect@email.com" placeholderTextColor={colors.muted}
              keyboardType="email-address" autoCapitalize="none" returnKeyType="next"
            />
            {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
          </View>
        </View>

        {/* Scheduling */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Callback Date & Time</Text>

          <View style={styles.row}>
            {/* Date picker */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Date *</Text>
              <TouchableOpacity
                style={[styles.pickerBtn, errors.date && styles.pickerBtnError]}
                onPress={() => { setShowTimePicker(false); setShowDatePicker(true); }}
                activeOpacity={0.8}
              >
                <Text style={styles.pickerBtnText}>{formatDateDisplay(selectedDate)}</Text>
                <Text style={styles.pickerChevron}>▼</Text>
              </TouchableOpacity>
              {errors.date ? <Text style={styles.errorText}>{errors.date}</Text> : null}
            </View>
          </View>

          {/* Time picker */}
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Time *</Text>
            <TouchableOpacity
              style={[styles.pickerBtn, errors.time && styles.pickerBtnError]}
              onPress={() => { setShowDatePicker(false); setShowTimePicker(true); }}
              activeOpacity={0.8}
            >
              <Text style={styles.pickerBtnText}>{formatTimeDisplay(selectedDate)}</Text>
              <Text style={styles.pickerChevron}>▼</Text>
            </TouchableOpacity>
            {errors.time ? <Text style={styles.errorText}>{errors.time}</Text> : null}
          </View>

          {/* iOS Date Picker Modal */}
          {isIOS && showDatePicker && (
            <Modal transparent animationType="slide" visible={showDatePicker}>
              <View style={styles.modalOverlay}>
                <View style={styles.modalSheet}>
                  <View style={styles.modalHeader}>
                    <TouchableOpacity style={styles.modalDoneBtn} onPress={() => setShowDatePicker(false)}>
                      <Text style={styles.modalDoneText}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={selectedDate}
                    mode="date"
                    display="inline"
                    minimumDate={new Date()}
                    onChange={(_event, date) => {
                      if (date) {
                        const updated = new Date(selectedDate);
                        updated.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                        setSelectedDate(updated);
                      }
                    }}
                    style={{ marginHorizontal: 8 }}
                  />
                </View>
              </View>
            </Modal>
          )}

          {/* Android Date Picker */}
          {!isIOS && showDatePicker && (
            <DateTimePicker
              value={selectedDate}
              mode="date"
              display="default"
              minimumDate={new Date()}
              onChange={(_event, date) => {
                setShowDatePicker(false);
                if (date) {
                  const updated = new Date(selectedDate);
                  updated.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                  setSelectedDate(updated);
                }
              }}
            />
          )}

          {/* iOS Time Picker Modal */}
          {isIOS && showTimePicker && (
            <Modal transparent animationType="slide" visible={showTimePicker}>
              <View style={styles.modalOverlay}>
                <View style={styles.modalSheet}>
                  <View style={styles.modalHeader}>
                    <TouchableOpacity style={styles.modalDoneBtn} onPress={() => setShowTimePicker(false)}>
                      <Text style={styles.modalDoneText}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={selectedDate}
                    mode="time"
                    display="spinner"
                    minuteInterval={15}
                    onChange={(_event, date) => {
                      if (date) {
                        const updated = new Date(selectedDate);
                        updated.setHours(date.getHours(), date.getMinutes(), 0, 0);
                        setSelectedDate(updated);
                      }
                    }}
                  />
                </View>
              </View>
            </Modal>
          )}

          {/* Android Time Picker */}
          {!isIOS && showTimePicker && (
            <DateTimePicker
              value={selectedDate}
              mode="time"
              display="default"
              minuteInterval={15}
              onChange={(_event, date) => {
                setShowTimePicker(false);
                if (date) {
                  const updated = new Date(selectedDate);
                  updated.setHours(date.getHours(), date.getMinutes(), 0, 0);
                  setSelectedDate(updated);
                }
              }}
            />
          )}

          <Text style={styles.label}>Timezone</Text>
          <View style={styles.tzRow}>
            {TIMEZONES.map(tz => (
              <TouchableOpacity
                key={tz.value}
                style={[styles.tzBtn, timezone === tz.value && styles.tzBtnActive]}
                onPress={() => setTimezone(tz.value)}
                activeOpacity={0.8}
              >
                <Text style={[styles.tzText, timezone === tz.value && styles.tzTextActive]}>{tz.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Notes */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Conversation Notes</Text>
          <TextInput
            style={[styles.input, { minHeight: 100, textAlignVertical: "top" }]}
            value={notes} onChangeText={setNotes}
            placeholder="Key points from initial conversation, prospect's interests, objections, etc."
            placeholderTextColor={colors.muted}
            multiline numberOfLines={4}
          />
        </View>

        {/* Submit */}
        <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting} activeOpacity={0.85}>
          {submitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.submitText}>Schedule Callback</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}
