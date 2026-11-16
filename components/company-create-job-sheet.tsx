import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useIsFocused } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { useCompanyPriceBook } from "@/hooks/use-company-price-book";
import { useCompanyFieldworkCalendar } from "@/hooks/use-company-fieldwork-calendar";
import { getJobSyncCompanyCustomers, getJobSyncCompanySettings, getJobSyncMobileSession,
  type JobSyncCompanyCustomer, type JobSyncCompanyJobDetail, type JobSyncNativeSession } from "@/lib/jobsync-mobile-api";
import { companyCreateJobAllowed, companyCreateJobRateKeys, companyCreateJobScope, createCompanyJobController,
  type CompanyCreateJobState } from "@/lib/company-create-job";

export type CompanyCreateJobSheetProps = {
  visible: boolean;
  session: JobSyncNativeSession | null;
  initialDate: string;
  initialStartHour?: number;
  initialEndHour?: number;
  isCurrent: () => boolean;
  onClose: () => void;
  onCreated: (detail: JobSyncCompanyJobDetail, timezone: string) => void;
};
export function CompanyCreateJobSheet(props: CompanyCreateJobSheetProps) {
  const focused = useIsFocused();
  const [currentAllowed, setCurrentAllowed] = useState(false);
  useLayoutEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setCurrentAllowed(props.isCurrent()); });
    return () => { active = false; };
  }, [props]);
  if (!props.visible || !focused || !companyCreateJobAllowed(props.session) || !currentAllowed) return null;
  return <CompanyCreateJobForm key={companyCreateJobScope(props.session)} {...props} session={props.session} />;
}
const timeText = (hour: number) => `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;
function parseTime(value: string) {
  if (!/^\d{1,2}:\d{2}$/.test(value.trim())) return NaN;
  const [hour, minute] = value.trim().split(":").map(Number);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return NaN;
  return hour + minute / 60;
}
function CompanyCreateJobForm(props: CompanyCreateJobSheetProps & { session: JobSyncNativeSession }) {
  const colors = useColors();
  const [refreshKey, setRefreshKey] = useState(0);
  const priceBook = useCompanyPriceBook();
  const candidates = useCompanyFieldworkCalendar(props.session, refreshKey);
  const live = useRef({ props, candidates, mounted: false });
  useLayoutEffect(() => { live.current.props = props; live.current.candidates = candidates; }, [props, candidates]);
  const current = useCallback(() => live.current.mounted && live.current.props.visible && live.current.props.isCurrent(), []);
  const refreshPriceBook = priceBook.refresh;
  const [state, setState] = useState<CompanyCreateJobState>({ phase: "ready", jobId: null, message: null });
  const [customers, setCustomers] = useState<JobSyncCompanyCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [rateKey, setRateKey] = useState("");
  const [assignee, setAssignee] = useState<string | undefined>();
  const [date, setDate] = useState(props.initialDate);
  const [start, setStart] = useState(timeText(props.initialStartHour ?? 9));
  const [end, setEnd] = useState(props.initialEndHour === undefined ? "" : timeText(props.initialEndHour));
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [notes, setNotes] = useState("");
  const [privateNotes, setPrivateNotes] = useState("");
  const [picker, setPicker] = useState<"date" | "start" | "end" | null>(null);
  const controllerRef = useRef<ReturnType<typeof createCompanyJobController> | null>(null);
  useLayoutEffect(() => {
    const committedLive = live.current;
    committedLive.mounted = true;
    const controller = createCompanyJobController({ session: props.session, isCurrent: current,
      verifyAssignment: (employeeId) => live.current.candidates.verifyAssignment(employeeId),
      onState: setState,
      onCreated: (detail, zone) => { if (current()) live.current.props.onCreated(detail, zone); },
    });
    controllerRef.current = controller; setState(controller.getState());
    return () => { committedLive.mounted = false; controller.detach(); controllerRef.current = null; };
  }, [props.session, current]);
  useEffect(() => {
    let alive = true;
    const allowed = () => alive && current();
    void (async () => {
      await Promise.resolve();
      if (!allowed()) return;
      void refreshPriceBook();
      setLoading(true); setLoadError(null); setCustomers([]); setTimezone(null);
      try {
        const signed = await getJobSyncMobileSession(props.session.token);
        if (!allowed()) return;
        if (!companyCreateJobAllowed(signed) || companyCreateJobScope(signed) !== companyCreateJobScope(props.session)) throw new Error("Your Company sign-in changed. Reopen Add Job.");
        const rows = await getJobSyncCompanyCustomers(signed.token);
        if (!allowed()) return;
        const settings = await getJobSyncCompanySettings(signed.token, { requireTimezone: true });
        if (!allowed()) return;
        if (settings.id !== props.session.company!.id || !settings.timezone.trim()) throw new Error("Company calendar settings are unavailable.");
        new Intl.DateTimeFormat("en-US", { timeZone: settings.timezone }).format();
        setCustomers(rows); setTimezone(settings.timezone); setLoading(false);
      } catch (error) {
        if (allowed()) { setLoading(false); setLoadError(error instanceof Error ? error.message : "Company customer and schedule settings are unavailable."); }
      }
    })();
    return () => { alive = false; };
  }, [refreshKey, props.session, refreshPriceBook, current]);
  const service = priceBook.services.find((row) => row.serviceId === serviceId);
  const rates = service ? companyCreateJobRateKeys(service) : [];
  const selectedCustomer = customers.find((row) => row.id === customerId);
  const busy = state.phase === "validating" || state.phase === "submitting";
  const locked = busy || ["uncertain", "saved", "succeeded"].includes(state.phase);
  const serviceBase = (service as (typeof service & { basePrice?: number }))?.basePrice;
  const requireRate = serviceBase !== undefined && serviceBase <= 0 && rates.length > 0;
  const canSave = !locked && !loading && !loadError && Boolean(timezone && selectedCustomer && service)
    && priceBook.hasLoaded && !priceBook.isLoading && !priceBook.error && (!requireRate || Boolean(rateKey))
    && Number.isFinite(parseTime(start)) && (!end.trim() || Number.isFinite(parseTime(end)))
    && (!assignee || (!candidates.loading && !candidates.error && candidates.members.some((row) => row.employeeId === assignee)));
  const close = () => { if (current()) live.current.props.onClose(); };
  const save = () => {
    if (!canSave || !current() || !customerId) return;
    void controllerRef.current?.submit({ customerId, serviceId, assignedEmployeeId: assignee,
      vehiclePriceKey: rateKey || undefined, date, startHour: parseTime(start), endHour: end.trim() ? parseTime(end) : undefined,
      addressLine1: address, city, region, postalCode, serviceNotes: notes, privateNotes });
  };
  const retryReads = () => { if (current() && !locked) { setRefreshKey((value) => value + 1); void priceBook.refresh(); } };
  const inputStyle = [styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }];
  const label = (text: string) => <Text style={[styles.label, { color: colors.muted }]}>{text}</Text>;
  const field = (name: string, value: string, setValue: (value: string) => void, placeholder?: string, multiline = false) => <View style={styles.field}>{label(name)}<TextInput accessibilityLabel={name} value={value} onChangeText={(next) => { if (current() && !locked) setValue(next); }} editable={!locked} placeholder={placeholder} placeholderTextColor={colors.muted} style={inputStyle} multiline={multiline} autoCapitalize="none" /></View>;
  const option = (name: string, selected: boolean, action: () => void) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ selected, disabled: locked }} disabled={locked} onPress={() => { if (current() && !locked) action(); }} style={[styles.option, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.background : colors.surface }]}><Text style={{ color: selected ? colors.primary : colors.foreground }}>{name}</Text></TouchableOpacity>;
  const normalizedQuery = query.trim().toLowerCase();
  const matches = normalizedQuery.length < 2 ? [] : customers.filter((row) => [row.name, row.email, row.phone, row.addressLine1, row.city].some((value) => value?.toLowerCase().includes(normalizedQuery))).slice(0, 10);
  const pickerValue = () => {
    const [year, month, day] = date.split("-").map(Number);
    const wallHour = picker === "end" ? parseTime(end) : parseTime(start);
    return new Date(Number.isFinite(year) ? year : 2026, (month || 1) - 1, day || 1, Number.isFinite(wallHour) ? Math.floor(wallHour) : 9, Number.isFinite(wallHour) ? Math.round((wallHour % 1) * 60) : 0);
  };
  return <Modal visible transparent animationType="slide" onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.backdrop}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.header}><Text style={[styles.title, { color: colors.foreground }]}>New Job</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close Add Job" onPress={close} style={styles.close}><Text style={[styles.closeText, { color: colors.muted }]}>×</Text></TouchableOpacity></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Text style={[styles.note, { color: colors.muted }]}>Create one service for an existing Company customer. Prices come from your Company Price Book.</Text>
          {loading && <ActivityIndicator accessibilityLabel="Loading Company form" color={colors.primary} />}
          {loadError && <Text accessibilityRole="alert" style={{ color: colors.error }}>{loadError}</Text>}
          {field("Find Company customer", query, (next) => { setQuery(next); setCustomerId(null); }, "Name, email, phone or address")}
          <FlatList scrollEnabled={false} data={matches} keyExtractor={(row) => String(row.id)} renderItem={({ item }) => option(`${item.name} · ${item.phone || item.email || item.addressLine1 || `Customer ${item.id}`}`, customerId === item.id, () => {
            setCustomerId(item.id); setQuery(""); setAddress(item.addressLine1 || ""); setCity(item.city || "");
            const detail = item as JobSyncCompanyCustomer & { region?: string | null; postalCode?: string | null };
            setRegion(detail.region || ""); setPostalCode(detail.postalCode || "");
          })} />
          {selectedCustomer && <Text style={[styles.selected, { color: colors.primary }]}>Selected customer: {selectedCustomer.name}</Text>}
          {!selectedCustomer && !loading && normalizedQuery.length >= 2 && !matches.length && <Text style={{ color: colors.muted }}>No matching customer in the loaded Company list. Select an existing customer; new-customer creation is not available here.</Text>}
          {label("Price Book service")}
          {priceBook.isLoading && <ActivityIndicator accessibilityLabel="Loading Company Price Book" color={colors.primary} />}
          {priceBook.error && <Text accessibilityRole="alert" style={{ color: colors.error }}>{priceBook.error}</Text>}
          {priceBook.hasLoaded && !priceBook.isLoading && !priceBook.error && priceBook.services.length === 0 && <Text style={{ color: colors.muted }}>No active services in this Company Price Book.</Text>}
          <FlatList scrollEnabled={false} data={priceBook.services} keyExtractor={(row) => row.serviceId} renderItem={({ item }) => option(item.name, item.serviceId === serviceId, () => { setServiceId(item.serviceId); setRateKey(""); })} />
          {service && <Text style={[styles.note, { color: colors.muted }]}>{serviceBase !== undefined ? `Saved base price: $${serviceBase.toFixed(2)}. ` : ""}Final price is confirmed by the server.{serviceBase === 0 && !rates.length ? " A service requiring an undisclosed custom rate cannot be created until that rate is available in mobile." : ""}</Text>}
          {requireRate && <View style={styles.field}>{label("Choose service rate (required)")}<FlatList scrollEnabled={false} data={rates} keyExtractor={(key) => key} renderItem={({ item }) => option(`${item.replace(/_/g, " ")} · $${service!.vehiclePrices[item].toFixed(2)}`, rateKey === item, () => setRateKey(item))} /></View>}
          {label("Assign Team Member")}
          {option("Unassigned", !assignee, () => setAssignee(undefined))}
          {candidates.loading && <ActivityIndicator accessibilityLabel="Loading assignment candidates" color={colors.primary} />}
          {candidates.error && <Text style={{ color: colors.error }}>{candidates.error}</Text>}
          <FlatList scrollEnabled={false} data={candidates.members} keyExtractor={(row) => row.employeeId} renderItem={({ item }) => option(item.name, assignee === item.employeeId, () => setAssignee(item.employeeId))} />
          <Text style={[styles.note, { color: colors.muted }]}>Company timezone: {timezone || "verifying…"}. Times below use this timezone, not your device timezone.</Text>
          {field("Company date", date, setDate, "YYYY-MM-DD")}
          {field("Start time", start, setStart, "HH:MM (24-hour)")}
          {field("End time (optional)", end, setEnd, "HH:MM; blank uses service duration")}
          {Platform.OS !== "web" && !locked && <View style={styles.row}>{option("Pick date", false, () => setPicker("date"))}{option("Pick start", false, () => setPicker("start"))}{option("Pick end", false, () => setPicker("end"))}</View>}
          {picker && Platform.OS !== "web" && <DateTimePicker value={pickerValue()} mode={picker === "date" ? "date" : "time"} is24Hour onChange={(_event, value) => {
            const target = picker; setPicker(null); if (!value || !current() || locked) return;
            if (target === "date") setDate(`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`);
            else (target === "start" ? setStart : setEnd)(timeText(value.getHours() + value.getMinutes() / 60));
          }} />}
          {field("Service address", address, setAddress)}{field("City", city, setCity)}{field("Region / state", region, setRegion)}{field("Postal code", postalCode, setPostalCode)}
          {field("Service notes", notes, setNotes, undefined, true)}{field("Private notes", privateNotes, setPrivateNotes, undefined, true)}
          <Text style={[styles.note, { color: colors.muted }]}>Customer confirmations follow Company server policy. Recurrence, custom prices, discounts, extra services and notification choices are not available in this form.</Text>
          {state.message && <Text accessibilityRole="alert" style={[styles.note, { color: state.phase === "error" || state.phase === "uncertain" ? colors.error : colors.muted }]}>{state.message}{state.jobId ? ` Job #${state.jobId}.` : ""}</Text>}
          {busy && <ActivityIndicator accessibilityLabel="Saving Company Job" color={colors.primary} />}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save Company Job" accessibilityState={{ disabled: !canSave }} disabled={!canSave} onPress={save} style={[styles.primary, { backgroundColor: colors.primary, opacity: canSave ? 1 : 0.45 }]}><Text style={styles.primaryText}>{busy ? "Saving…" : "Save Job"}</Text></TouchableOpacity>
          {["uncertain", "saved"].includes(state.phase) ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh saved Job without resending" disabled={busy} onPress={() => { if (current()) void controllerRef.current?.reconcile(); }} style={[styles.option, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>Refresh saved Job / calendar records (read only)</Text></TouchableOpacity> : !locked && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh Company form" onPress={retryReads} style={[styles.option, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>Refresh Company form</Text></TouchableOpacity>}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  card: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, maxHeight: "90%", width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "800" }, close: { padding: 8 }, closeText: { fontSize: 27, lineHeight: 30 },
  content: { gap: 12, paddingBottom: 12 }, field: { gap: 6 }, label: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  input: { borderRadius: 10, borderWidth: 1, padding: 12, fontSize: 15, lineHeight: 21 },
  option: { borderWidth: 1, borderRadius: 10, padding: 12, marginVertical: 3 }, note: { fontSize: 13, lineHeight: 19 },
  selected: { fontSize: 14, lineHeight: 20, fontWeight: "600" }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  primary: { borderRadius: 12, paddingVertical: 15, alignItems: "center" }, primaryText: { color: "#fff", fontSize: 16, lineHeight: 22, fontWeight: "700" },
});
