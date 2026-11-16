import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useIsFocused } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { useCompanyPriceBook } from "@/hooks/use-company-price-book";
import { useCompanyFieldworkCalendar } from "@/hooks/use-company-fieldwork-calendar";
import { getJobSyncCompanyCustomers, getJobSyncCompanySettings, getJobSyncMobileSession,
  normalizeCompanyJobNewCustomer, type JobSyncCompanyNewCustomer,
  type JobSyncCompanyCustomer, type JobSyncCompanyJobDetail, type JobSyncNativeSession } from "@/lib/jobsync-mobile-api";
import { companyCreateJobAllowed, companyCreateJobRateKeys, companyCreateJobScope, createCompanyJobController,
  type CompanyCreateJobState } from "@/lib/company-create-job";
import { parseCompanyJobCustomerPrefill, verifyCompanyJobCustomerPrefill,
  type CompanyJobCustomerPrefill } from "@/lib/company-job-customer-prefill";

export type CompanyCreateJobSheetProps = {
  visible: boolean;
  session: JobSyncNativeSession | null;
  initialDate: string;
  initialStartHour?: number;
  initialEndHour?: number;
  customerPrefill?: CompanyJobCustomerPrefill | null;
  /** Profiles may perform a guarded deferred navigation/close after confirmation. */
  closeOnSuccess?: boolean;
  isCurrent: () => boolean;
  onClose: () => void;
  onCreated: (detail: JobSyncCompanyJobDetail, timezone: string) => boolean | void | Promise<boolean | void>;
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
  const prefillKey = props.customerPrefill ? `${props.customerPrefill.companyId}:${props.customerPrefill.customerId}` : "none";
  return <CompanyCreateJobForm key={`${companyCreateJobScope(props.session)}:${prefillKey}`} {...props} session={props.session} />;
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
  const [state, setState] = useState<CompanyCreateJobState>({ phase: "restoring", jobId: null, message: "Checking saved creation attempts…" });
  const [customers, setCustomers] = useState<JobSyncCompanyCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [customerListError, setCustomerListError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<JobSyncCompanyCustomer | null>(null);
  const [customerMode, setCustomerMode] = useState<"existing" | "new">("existing");
  const customerModeRef = useRef<"existing" | "new">("existing");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const customerRequest = useRef(0);
  const customerChoiceTouched = useRef(false);
  const prefillResolved = useRef(false);
  const prefillCustomerId = props.customerPrefill?.customerId;
  const prefillCompanyId = props.customerPrefill?.companyId;
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
  const invalidateCustomerRequest = useCallback(() => { customerRequest.current++; }, []);
  const controllerRef = useRef<ReturnType<typeof createCompanyJobController> | null>(null);
  useLayoutEffect(() => {
    const committedLive = live.current;
    committedLive.mounted = true;
    let successCloseRequested = false;
    const controller = createCompanyJobController({ session: props.session, isCurrent: current,
      verifyAssignment: (employeeId) => live.current.candidates.verifyAssignment(employeeId),
      onState: (next) => {
        if (!current()) return;
        setState(next);
        if (next.phase === "succeeded" && !successCloseRequested && live.current.props.closeOnSuccess !== false) {
          successCloseRequested = true;
          live.current.props.onClose();
        }
      },
      onCreated: (detail, zone) => current() ? live.current.props.onCreated(detail, zone) : false,
    });
    controllerRef.current = controller; setState(controller.getState());
    void controller.restore();
    return () => { committedLive.mounted = false; invalidateCustomerRequest(); controller.detach(); controllerRef.current = null; };
  }, [props.session, current, invalidateCustomerRequest]);
  const selectCustomer = useCallback(async (candidate: CompanyJobCustomerPrefill, manual: boolean, originCurrent: () => boolean = () => true) => {
    if (!current() || customerModeRef.current !== "existing") return;
    if (manual) customerChoiceTouched.current = true;
    const request = ++customerRequest.current;
    const allowed = () => current() && originCurrent() && customerModeRef.current === "existing" && customerRequest.current === request;
    setCustomerLoading(true); setCustomerError(null); setSelectedCustomer(null);
    try {
      const customer = await verifyCompanyJobCustomerPrefill(live.current.props.session, candidate, allowed);
      if (!customer || !allowed()) return;
      prefillResolved.current = true;
      setSelectedCustomer(customer); setQuery("");
      setAddress(customer.addressLine1 || ""); setCity(customer.city || "");
      const detail = customer as JobSyncCompanyCustomer & { region?: string | null; postalCode?: string | null };
      setRegion(detail.region || ""); setPostalCode(detail.postalCode || "");
    } catch (error) {
      if (allowed()) setCustomerError(error instanceof Error ? error.message : "Could not verify the selected Company customer. Select again or refresh.");
    } finally { if (allowed()) setCustomerLoading(false); }
  }, [current]);
  useEffect(() => {
    let alive = true;
    const allowed = () => alive && current();
    void (async () => {
      await Promise.resolve();
      if (!allowed()) return;
      void refreshPriceBook();
      customerRequest.current++; setCustomerLoading(false);
      setLoading(true); setLoadError(null); setCustomerListError(null); setCustomers([]); setTimezone(null);
      try {
        const signed = await getJobSyncMobileSession(props.session.token);
        if (!allowed()) return;
        if (!companyCreateJobAllowed(signed) || companyCreateJobScope(signed) !== companyCreateJobScope(props.session)) throw new Error("Your Company sign-in changed. Reopen Add Job.");
        // Company settings are mandatory in BOTH modes. A failed existing list
        // search is separate and must not masquerade as new-customer failure.
        const settings = await getJobSyncCompanySettings(signed.token, { requireTimezone: true });
        if (!allowed()) return;
        if (settings.id !== props.session.company!.id || !settings.timezone.trim()) throw new Error("Company calendar settings are unavailable.");
        new Intl.DateTimeFormat("en-US", { timeZone: settings.timezone }).format();
        setTimezone(settings.timezone);
        try {
          const rows = await getJobSyncCompanyCustomers(signed.token);
          if (!allowed()) return;
          setCustomers(rows);
        } catch {
          if (allowed()) setCustomerListError("Existing Company customer search is unavailable. Refresh to select an existing customer.");
        }
        if (!allowed()) return;
        const verified = await getJobSyncMobileSession(props.session.token);
        if (!allowed()) return;
        if (!companyCreateJobAllowed(verified) || companyCreateJobScope(verified) !== companyCreateJobScope(props.session)) throw new Error("Your Company sign-in changed. Reopen Add Job.");
        setLoading(false);
        if (customerModeRef.current === "existing" && (prefillCustomerId !== undefined || prefillCompanyId !== undefined) && !customerChoiceTouched.current && !prefillResolved.current) {
          const prefill = parseCompanyJobCustomerPrefill(prefillCustomerId, prefillCompanyId);
          if (!prefill) setCustomerError("This customer link is invalid. Select an existing customer from this Company.");
          else await selectCustomer(prefill, false, allowed);
        }
      } catch (error) {
        if (allowed()) { setLoading(false); setLoadError(error instanceof Error ? error.message : "Company customer and schedule settings are unavailable."); }
      }
    })();
    return () => { alive = false; };
  }, [refreshKey, props.session, prefillCustomerId, prefillCompanyId, refreshPriceBook, current, selectCustomer]);
  const service = priceBook.services.find((row) => row.serviceId === serviceId);
  const rates = service ? companyCreateJobRateKeys(service) : [];
  const customerId = selectedCustomer?.id ?? null;
  const busy = state.phase === "restoring" || state.phase === "validating" || state.phase === "submitting" || Boolean(state.reconciling);
  const locked = busy || ["uncertain", "pending", "conflict", "saved", "succeeded"].includes(state.phase);
  const serviceBase = (service as (typeof service & { basePrice?: number }))?.basePrice;
  const requireRate = serviceBase !== undefined && serviceBase <= 0 && rates.length > 0;
  const newCustomerFields = { firstName, lastName, email, phone, addressLine1: address, city, region, postalCode };
  const newCustomerErrors: Partial<Record<keyof JobSyncCompanyNewCustomer, string>> = {};
  if (customerMode === "new") for (const name of Object.keys(newCustomerFields) as (keyof JobSyncCompanyNewCustomer)[]) {
    try { normalizeCompanyJobNewCustomer({ firstName: "Validation", lastName: "Only", [name]: newCustomerFields[name] }); }
    catch (error) { newCustomerErrors[name] = error instanceof Error ? error.message : "Check this customer field."; }
  }
  const customerReady = customerMode === "existing" ? !customerListError && !customerLoading && !customerError && Boolean(selectedCustomer) : !Object.keys(newCustomerErrors).length;
  const canSave = !locked && !loading && !loadError && customerReady && Boolean(timezone && service)
    && priceBook.hasLoaded && !priceBook.isLoading && !priceBook.error && (!requireRate || Boolean(rateKey))
    && Number.isFinite(parseTime(start)) && (!end.trim() || Number.isFinite(parseTime(end)))
    && (!assignee || (!candidates.loading && !candidates.error && candidates.members.some((row) => row.employeeId === assignee)));
  const close = () => { if (current()) live.current.props.onClose(); };
  const changeCustomerMode = (mode: "existing" | "new") => {
    if (!current() || locked || mode === customerMode) return;
    customerModeRef.current = mode; invalidateCustomerRequest(); customerChoiceTouched.current = true;
    setCustomerMode(mode); setSelectedCustomer(null); setQuery(""); setCustomerLoading(false); setCustomerError(null);
    setFirstName(""); setLastName(""); setEmail(""); setPhone("");
    // Clear customer-owned address/contact; keep service/rate/assignment/schedule.
    setAddress(""); setCity(""); setRegion(""); setPostalCode("");
  };
  const save = () => {
    if (!canSave || !current() || customerModeRef.current !== customerMode || (customerMode === "existing" && !customerId)) return;
    const controller = controllerRef.current;
    if (!controller) return;
    const selector = customerMode === "new" ? { newCustomer: normalizeCompanyJobNewCustomer(newCustomerFields) } : { customerId: customerId! };
    void controller.submit({ ...selector, serviceId, assignedEmployeeId: assignee,
      vehiclePriceKey: rateKey || undefined, date, startHour: parseTime(start), endHour: end.trim() ? parseTime(end) : undefined,
      addressLine1: address, city, region, postalCode, serviceNotes: notes, privateNotes }).then(async (saved) => {
      // One authenticated GET-only check after an ambiguous response; never
      // resend, re-key, or drive a retained controller after close/scope change.
      if (!saved && current() && controllerRef.current === controller
        && ["uncertain", "pending", "conflict"].includes(controller.getState().phase)) await controller.reconcile();
    });
  };
  const retryReads = () => { if (current() && !locked) { setRefreshKey((value) => value + 1); void priceBook.refresh(); } };
  const inputStyle = [styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }];
  const label = (text: string) => <Text style={[styles.label, { color: colors.muted }]}>{text}</Text>;
  const field = (name: string, value: string, setValue: (value: string) => void, placeholder?: string, multiline = false) => <View style={styles.field}>{label(name)}<TextInput accessibilityLabel={name} value={value} onChangeText={(next) => { if (current() && !locked) setValue(next); }} editable={!locked} placeholder={placeholder} placeholderTextColor={colors.muted} style={inputStyle} multiline={multiline} autoCapitalize="none" /></View>;
  const customerFeedback = (name: keyof JobSyncCompanyNewCustomer) => newCustomerErrors[name] ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{newCustomerErrors[name]}</Text> : null;
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
          <Text style={[styles.note, { color: colors.muted }]}>Create one service for an existing or new Company customer. Prices come from your Company Price Book.</Text>
          {loading && <ActivityIndicator accessibilityLabel="Loading Company form" color={colors.primary} />}
          {loadError && <Text accessibilityRole="alert" style={{ color: colors.error }}>{loadError}</Text>}
          <View style={styles.row}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Existing Customer" accessibilityState={{ selected: customerMode === "existing", disabled: locked }} disabled={locked} onPress={() => changeCustomerMode("existing")} style={[styles.option, { borderColor: customerMode === "existing" ? colors.primary : colors.border }]}><Text style={{ color: customerMode === "existing" ? colors.primary : colors.foreground }}>Existing Customer</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="New Customer" accessibilityState={{ selected: customerMode === "new", disabled: locked }} disabled={locked} onPress={() => changeCustomerMode("new")} style={[styles.option, { borderColor: customerMode === "new" ? colors.primary : colors.border }]}><Text style={{ color: customerMode === "new" ? colors.primary : colors.foreground }}>New Customer</Text></TouchableOpacity>
          </View>
          {customerMode === "existing" ? <>
          {customerListError && <Text accessibilityRole="alert" style={{ color: colors.error }}>{customerListError}</Text>}
          <View style={styles.field}>{label("Find Company customer")}<TextInput accessibilityLabel="Find Company customer" value={query} onChangeText={(next) => {
            if (!current() || locked) return;
            customerChoiceTouched.current = true; invalidateCustomerRequest();
            setQuery(next); setSelectedCustomer(null); setCustomerLoading(false); setCustomerError(null);
          }} editable={!locked} placeholder="Name, email, phone or address" placeholderTextColor={colors.muted} style={inputStyle} autoCapitalize="none" /></View>
          <FlatList scrollEnabled={false} data={matches} keyExtractor={(row) => String(row.id)} renderItem={({ item }) => option(`${item.name} · ${item.phone || item.email || item.addressLine1 || `Customer ${item.id}`}`, customerId === item.id, () => {
            void selectCustomer({ customerId: item.id, companyId: props.session.company!.id }, true);
          })} />
          {selectedCustomer && <Text style={[styles.selected, { color: colors.primary }]}>Selected customer: {selectedCustomer.name}</Text>}
          {selectedCustomer && <Text style={[styles.note, { color: colors.muted }]}>{[selectedCustomer.phone, selectedCustomer.email].filter(Boolean).join(" · ") || "No contact information on this customer profile."}</Text>}
          {customerLoading && <ActivityIndicator accessibilityLabel="Verifying Company customer" color={colors.primary} />}
          {customerError && <Text accessibilityRole="alert" style={{ color: colors.error }}>{customerError}</Text>}
          {!selectedCustomer && !loading && !customerListError && normalizedQuery.length >= 2 && !matches.length && <Text style={{ color: colors.muted }}>No matching customer in the loaded Company list. Select an existing customer or choose New Customer.</Text>}
          </> : <>
            {field("First name (required)", firstName, setFirstName)}{customerFeedback("firstName")}
            {field("Last name (required)", lastName, setLastName)}{customerFeedback("lastName")}
            {field("Email (optional)", email, setEmail)}{customerFeedback("email")}
            {field("Phone (optional)", phone, setPhone)}{customerFeedback("phone")}
            <Text style={[styles.note, { color: colors.muted }]}>The service address below also becomes the new customer&apos;s address. Customer and Job save together in one request.</Text>
          </>}
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
          {field("Service address", address, setAddress)}{customerFeedback("addressLine1")}{field("City", city, setCity)}{customerFeedback("city")}{field("Region / state", region, setRegion)}{customerFeedback("region")}{field("Postal code", postalCode, setPostalCode)}{customerFeedback("postalCode")}
          {field("Service notes", notes, setNotes, undefined, true)}{field("Private notes", privateNotes, setPrivateNotes, undefined, true)}
          <Text style={[styles.note, { color: colors.muted }]}>Customer confirmations follow Company server policy. Recurrence, custom prices, discounts, extra services and notification choices are not available in this form.</Text>
          {state.message && <Text accessibilityRole="alert" style={[styles.note, { color: ["error", "uncertain", "conflict", "rejected"].includes(state.phase) ? colors.error : colors.muted }]}>{state.message}{state.jobId ? ` Job #${state.jobId}.` : ""}</Text>}
          {state.phase === "rejected" && <Text style={[styles.note, { color: colors.muted }]}>The original request was rejected. Review and correct the form, then deliberately save a new Job request.</Text>}
          {busy && <ActivityIndicator accessibilityLabel={state.phase === "restoring" ? "Checking previous creation request" : state.reconciling ? "Checking original Job status and calendar" : "Saving Company Job"} color={colors.primary} />}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save Company Job" accessibilityState={{ disabled: !canSave }} disabled={!canSave} onPress={save} style={[styles.primary, { backgroundColor: colors.primary, opacity: canSave ? 1 : 0.45 }]}><Text style={styles.primaryText}>{state.phase === "restoring" ? "Checking…" : state.reconciling ? "Refreshing…" : busy ? "Saving…" : state.phase === "rejected" ? "Save corrected Job" : "Save Job"}</Text></TouchableOpacity>
          {["uncertain", "pending", "conflict", "saved"].includes(state.phase) ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh saved Job without resending" disabled={busy} onPress={() => { if (current()) void controllerRef.current?.reconcile(); }} style={[styles.option, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>{state.phase === "saved" ? "Refresh Company calendar" : "Check original request status (read only)"}</Text></TouchableOpacity> : !locked && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh Company form" onPress={retryReads} style={[styles.option, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>Refresh Company form</Text></TouchableOpacity>}
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
