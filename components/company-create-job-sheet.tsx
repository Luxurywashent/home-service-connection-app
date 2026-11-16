import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useIsFocused } from "expo-router";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import { CompanyBookingServiceCard, CompanyBookingServicePicker, companyBookingPrice, companyBookingDuration } from "./company-booking-service-picker";
import { CompanyBookingTimeField } from "./company-booking-time-field";
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
  const colors = useJobSheetColors();
  const [refreshKey, setRefreshKey] = useState(0);
  const priceBook = useCompanyPriceBook();
  const candidates = useCompanyFieldworkCalendar(props.session, refreshKey);
  const live = useRef({ props, candidates, mounted: false, closing: false });
  useLayoutEffect(() => { live.current.props = props; live.current.candidates = candidates; }, [props, candidates]);
  const current = useCallback(() => live.current.mounted && !live.current.closing && live.current.props.visible && live.current.props.isCurrent(), []);
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
  const [moreDetails, setMoreDetails] = useState(false);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
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
      setFirstName(customer.firstName || ""); setLastName(customer.lastName || "");
      setEmail(customer.email || ""); setPhone(customer.phone || "");
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
  const close = () => { if (current()) { live.current.closing = true; invalidateCustomerRequest(); live.current.props.onClose(); } };
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
  const field = (name: string, value: string, setValue: (value: string) => void, options: { paired?: boolean; readonly?: boolean; multiline?: boolean; keyboard?: "phone-pad" | "email-address"; feedback?: keyof JobSyncCompanyNewCustomer; displayLabel?: string } = {}) => <View style={[styles.field, options.paired && styles.pairedField]}>
    {label(options.displayLabel || name)}<TextInput accessibilityLabel={name} value={value} onChangeText={(next) => { if (current() && !locked && !options.readonly) setValue(next); }} editable={!locked && !options.readonly}
      placeholder={options.readonly ? "—" : undefined} placeholderTextColor={colors.muted} style={[...inputStyle, options.multiline && styles.multiline]} multiline={options.multiline} keyboardType={options.keyboard}
      autoCapitalize={options.keyboard === "email-address" ? "none" : "sentences"} returnKeyType="done" />
    {options.feedback && customerMode === "new" && newCustomerErrors[options.feedback] && Boolean(value.trim()) && <Text accessibilityRole="alert" style={[styles.note, { color: colors.error }]}>{newCustomerErrors[options.feedback]}</Text>}
  </View>;
  const option = (name: string, selected: boolean, action: () => void) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ selected, disabled: locked }} disabled={locked} onPress={() => { if (current() && !locked) action(); }} style={[styles.option, { borderColor: selected ? colors.primary : colors.border, backgroundColor: colors.surface }]}><Text style={[styles.optionText, { color: selected ? colors.primary : colors.foreground }]}>{name}</Text></TouchableOpacity>;
  const normalizedQuery = query.trim().toLowerCase();
  const matches = normalizedQuery.length < 2 ? [] : customers.filter((row) => [row.name, row.email, row.phone, row.addressLine1, row.city].some((value) => value?.toLowerCase().includes(normalizedQuery))).slice(0, 10);
  const clearCustomer = (next = "") => {
    if (!current() || locked) return;
    customerChoiceTouched.current = true; invalidateCustomerRequest(); setQuery(next); setSelectedCustomer(null); setCustomerLoading(false); setCustomerError(null);
    setFirstName(""); setLastName(""); setPhone(""); setEmail(""); setAddress(""); setCity(""); setRegion(""); setPostalCode("");
  };
  const openServicePicker = () => { if (current() && !locked) setServicePickerOpen(true); };
  const selectedAmount = service ? companyBookingPrice(service, rateKey) : undefined;
  const pickerValue = () => {
    const [year, month, day] = date.split("-").map(Number);
    const wallHour = picker === "end" ? parseTime(end) : parseTime(start);
    return new Date(Number.isFinite(year) ? year : 2026, (month || 1) - 1, day || 1, Number.isFinite(wallHour) ? Math.floor(wallHour) : 9, Number.isFinite(wallHour) ? Math.round((wallHour % 1) * 60) : 0);
  };
  return <Modal visible transparent animationType="slide" onRequestClose={() => { if (servicePickerOpen && current()) setServicePickerOpen(false); else close(); }}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined} style={styles.backdrop}>
      <View testID="company-booking-sheet" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View accessibilityElementsHidden={servicePickerOpen} importantForAccessibility={servicePickerOpen ? "no-hide-descendants" : "auto"} style={styles.main}>
        <View style={styles.header}><Text style={[styles.title, { color: colors.foreground }]}>New Job</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close Add Job" onPress={close} style={styles.close}><Text style={[styles.closeText, { color: colors.muted }]}>×</Text></TouchableOpacity></View>
        <ScrollView testID="company-booking-main-scroll" style={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.content}>
          <View testID="company-booking-time-row" style={styles.timeRow}>
            <CompanyBookingTimeField label="Date" accessibilityLabel="Company date" type="date" value={date} disabled={locked} isCurrent={current} onChange={setDate} onPick={() => setPicker("date")} />
            <CompanyBookingTimeField label="Start" accessibilityLabel="Start time" type="time" value={start} disabled={locked} isCurrent={current} onChange={setStart} onPick={() => setPicker("start")} />
            <CompanyBookingTimeField label="End (optional)" accessibilityLabel="End time (optional)" type="time" value={end} placeholder="Auto" disabled={locked} isCurrent={current} onChange={setEnd} onPick={() => setPicker("end")} />
          </View>
          <Text style={[styles.note, { color: colors.muted }]}>{timezone || "Verifying timezone…"}</Text>
          {picker && Platform.OS !== "web" && <View>
            <DateTimePicker value={pickerValue()} mode={picker === "date" ? "date" : "time"} is24Hour onChange={(_event, value) => {
              const target = picker; setPicker(null); if (_event.type === "dismissed" || !value || !current() || locked) return;
              if (target === "date") setDate(`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`);
              else (target === "start" ? setStart : setEnd)(timeText(value.getHours() + value.getMinutes() / 60));
            }} />
            {picker === "end" && option("Use service duration", false, () => { setEnd(""); setPicker(null); })}
          </View>}
          {loading && <ActivityIndicator accessibilityLabel="Loading Company form" color={colors.primary} />}
          {loadError && <Text accessibilityRole="alert" style={{ color: colors.error }}>{loadError}</Text>}
          {label("CUSTOMER")}
          {customerMode === "existing" && <>
          {customerListError && <Text accessibilityRole="alert" style={{ color: colors.error }}>{customerListError}</Text>}
          <View style={styles.searchRow}><TextInput accessibilityLabel="Find Company customer" value={selectedCustomer ? selectedCustomer.name : query} onChangeText={clearCustomer} editable={!locked} placeholder="Search name, phone, email or address…" placeholderTextColor={colors.muted} style={[...inputStyle, styles.flex]} autoCapitalize="none" returnKeyType="search" />
            {(query || selectedCustomer) && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear customer selection" disabled={locked} onPress={() => clearCustomer()} style={styles.close}><Text style={[styles.closeText, { color: colors.muted }]}>×</Text></TouchableOpacity>}
          </View>
          {matches.length > 0 && !selectedCustomer && <FlatList testID="company-booking-customer-results" nestedScrollEnabled style={[styles.customerResults, { borderColor: colors.border, backgroundColor: colors.surface }]} data={matches} keyExtractor={(row) => String(row.id)} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" renderItem={({ item }) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={[item.name, item.phone || item.email || item.addressLine1].filter(Boolean).join(" · ")} disabled={locked} onPress={() => { if (current() && !locked) void selectCustomer({ customerId: item.id, companyId: props.session.company!.id }, true); }} style={[styles.customerResult, { borderColor: colors.border }]}>
            <Text style={[styles.selected, { color: colors.foreground }]}>{item.name}</Text>
            {Boolean(item.phone || item.email) && <Text style={[styles.note, { color: colors.muted }]}>{[item.phone, item.email].filter(Boolean).join(" · ")}</Text>}
            {Boolean(item.addressLine1) && <Text style={[styles.note, { color: colors.muted }]}>{[item.addressLine1, item.city].filter(Boolean).join(", ")}</Text>}
          </TouchableOpacity>} />}
          {customerLoading && <ActivityIndicator accessibilityLabel="Verifying Company customer" color={colors.primary} />}
          {customerError && <Text accessibilityRole="alert" style={{ color: colors.error }}>{customerError}</Text>}
          {!selectedCustomer && !loading && !customerListError && normalizedQuery.length >= 2 && !matches.length && <Text style={[styles.note, { color: colors.muted }]}>No matching customer. Try another search or turn on New Customer.</Text>}
          </>}
          <View testID="company-booking-name-pair" style={styles.pair}>
            {field(customerMode === "new" ? "First name (required)" : "First name", firstName, setFirstName, { paired: true, readonly: customerMode === "existing", feedback: "firstName", displayLabel: customerMode === "new" ? "First name *" : "First name" })}
            {field(customerMode === "new" ? "Last name (required)" : "Last name", lastName, setLastName, { paired: true, readonly: customerMode === "existing", feedback: "lastName", displayLabel: customerMode === "new" ? "Last name *" : "Last name" })}
          </View>
          {customerMode === "new" && (!firstName.trim() || !lastName.trim()) && <Text accessibilityRole="alert" style={[styles.note, { color: colors.error }]}>{[!firstName.trim() && newCustomerErrors.firstName, !lastName.trim() && newCustomerErrors.lastName].filter(Boolean).join(" ")}</Text>}
          <View testID="company-booking-contact-pair" style={styles.pair}>
            {field("Phone (optional)", phone, setPhone, { paired: true, readonly: customerMode === "existing", keyboard: "phone-pad", feedback: "phone" })}
            {field("Email (optional)", email, setEmail, { paired: true, readonly: customerMode === "existing", keyboard: "email-address", feedback: "email" })}
          </View>
          {field("Service address", address, setAddress, { feedback: "addressLine1" })}
          {label("SERVICES")}
          {priceBook.isLoading && <ActivityIndicator accessibilityLabel="Loading Company Price Book" color={colors.primary} />}
          {priceBook.error && <Text accessibilityRole="alert" style={{ color: colors.error }}>{priceBook.error}</Text>}
          {priceBook.hasLoaded && !priceBook.isLoading && !priceBook.error && priceBook.services.length === 0 && <Text style={{ color: colors.muted }}>No active services in this Company Price Book.</Text>}
          {service ? <CompanyBookingServiceCard service={service} selected rateKey={rateKey} disabled={locked} onPress={openServicePicker} /> : option("Choose Service", false, () => setServicePickerOpen(true))}
          {requireRate && <View style={styles.field}>{label("Service rate (required)")}<FlatList style={styles.rateResults} nestedScrollEnabled data={rates} keyExtractor={(key) => key} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" renderItem={({ item, index }) => option(`Service rate ${index + 1} · $${service!.vehiclePrices[item].toFixed(2)}`, rateKey === item, () => setRateKey(item))} /></View>}
          {label("ASSIGN TECHNICIAN")}
          {candidates.loading && <ActivityIndicator accessibilityLabel="Loading assignment candidates" color={colors.primary} />}
          {candidates.error && <Text style={{ color: colors.error }}>{candidates.error}</Text>}
          <FlatList horizontal data={[...candidates.members, { employeeId: "", name: "Unassigned" }]} keyExtractor={(row) => row.employeeId || "unassigned"} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.chips} renderItem={({ item }) => option(item.name, item.employeeId ? assignee === item.employeeId : !assignee, () => setAssignee(item.employeeId || undefined))} />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="More Details" accessibilityState={{ expanded: moreDetails }} onPress={() => { if (current()) setMoreDetails((value) => !value); }} style={[styles.disclosure, { borderColor: colors.border }]}><Text style={[styles.selected, { color: colors.foreground }]}>More Details</Text><Text style={{ color: colors.muted }}>{moreDetails ? "−" : "+"}</Text></TouchableOpacity>
          {moreDetails && <View style={styles.details}>
            <View style={styles.pair}>{field("City", city, setCity, { paired: true, feedback: "city" })}{field("Region / state", region, setRegion, { paired: true, feedback: "region" })}</View>
            {field("Postal code", postalCode, setPostalCode, { feedback: "postalCode" })}
            {field("Service notes", notes, setNotes, { multiline: true })}{field("Private notes", privateNotes, setPrivateNotes, { multiline: true })}
          </View>}
          <View style={[styles.toggleRow, { borderColor: colors.border }]}>
            <View style={styles.flex}><Text style={[styles.selected, { color: colors.foreground }]}>New Customer</Text><Text style={[styles.note, { color: colors.muted }]}>Turn on for first-time customers</Text></View>
            <TouchableOpacity accessibilityRole="switch" accessibilityLabel="New Customer" accessibilityState={{ checked: customerMode === "new", disabled: locked }} disabled={locked} onPress={() => changeCustomerMode(customerMode === "new" ? "existing" : "new")} style={styles.toggleTarget}><View style={[styles.toggleTrack, { backgroundColor: customerMode === "new" ? colors.primary : colors.border, alignItems: customerMode === "new" ? "flex-end" : "flex-start" }]}><View style={styles.toggleThumb} /></View></TouchableOpacity>
            {customerMode === "new" && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Existing Customer" disabled={locked} onPress={() => changeCustomerMode("existing")} style={styles.existingAction}><Text style={[styles.note, { color: colors.primary }]}>Find existing</Text></TouchableOpacity>}
          </View>
          <View style={[styles.toggleRow, { borderColor: colors.border }]}><View style={styles.flex}><Text style={[styles.selected, { color: colors.foreground }]}>Notify customer</Text><Text style={[styles.note, { color: colors.muted }]}>Unavailable in this form</Text></View><TouchableOpacity accessibilityRole="switch" accessibilityLabel="Notify customer unavailable" accessibilityState={{ checked: false, disabled: true }} disabled style={styles.toggleTarget}><View style={[styles.toggleTrack, { backgroundColor: colors.border }]}><View style={styles.toggleThumb} /></View></TouchableOpacity></View>
          {state.message && <Text accessibilityRole="alert" style={[styles.note, { color: ["error", "uncertain", "conflict", "rejected"].includes(state.phase) ? colors.error : colors.muted }]}>{state.message}</Text>}
          {state.detailError && <Text accessibilityRole="alert" style={[styles.note, { color: colors.error }]}>{state.detailError}</Text>}
          {state.phase === "rejected" && <Text style={[styles.note, { color: colors.muted }]}>Review and correct the form, then save a new request.</Text>}
          {busy && <ActivityIndicator accessibilityLabel={state.phase === "restoring" ? "Checking previous creation request" : state.reconciling ? "Checking original Job status and calendar" : "Saving Company Job"} color={colors.primary} />}
          {["uncertain", "pending", "conflict", "saved"].includes(state.phase) ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh saved Job without resending" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => { if (current()) void controllerRef.current?.reconcile(); }} style={[styles.option, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>{state.phase === "saved" ? "Refresh calendar" : "Check saved status"}</Text></TouchableOpacity> : !locked && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh Company form" onPress={retryReads} style={styles.refresh}><Text style={[styles.note, { color: colors.primary }]}>Refresh form</Text></TouchableOpacity>}
        </ScrollView>
        <View style={[styles.footer, { borderColor: colors.border }]}>
          {service && <View style={styles.total}><Text style={[styles.selected, { color: colors.foreground }]}>Service price {selectedAmount === undefined ? "confirmed on save" : `$${selectedAmount.toFixed(2)}`}</Text><Text style={[styles.note, { color: colors.muted }]}>{companyBookingDuration(service)}</Text></View>}
          <View style={styles.pair}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel Add Job" onPress={close} style={[styles.cancel, { borderColor: colors.border }]}><Text style={[styles.footerText, { color: colors.foreground }]}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save Company Job" accessibilityState={{ disabled: !canSave }} disabled={!canSave} onPress={save} style={[styles.primary, { backgroundColor: colors.primary, opacity: canSave ? 1 : 0.45 }]}><Text style={styles.primaryText}>{state.phase === "restoring" ? "Checking…" : state.reconciling ? "Refreshing…" : busy ? "Saving…" : state.phase === "rejected" ? "Save corrected Job" : "Save Job"}</Text></TouchableOpacity>
          </View>
        </View>
        </View>
        {servicePickerOpen && <CompanyBookingServicePicker services={priceBook.services} selectedId={serviceId} loading={priceBook.isLoading} hasLoaded={priceBook.hasLoaded} error={priceBook.error} disabled={locked} isCurrent={current}
          onClose={() => { if (current()) setServicePickerOpen(false); }} onRefresh={retryReads} onConfirm={(id) => { if (current() && !locked && priceBook.hasLoaded && !priceBook.isLoading && !priceBook.error && priceBook.services.some((row) => row.serviceId === id)) { if (id !== serviceId) { setServiceId(id); setRateKey(""); } setServicePickerOpen(false); } }} />}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  card: { borderTopLeftRadius: 20, borderTopRightRadius: 20, height: "92%", maxHeight: "92%", width: "100%", maxWidth: 640, alignSelf: "center", overflow: "hidden" },
  main: { flex: 1, minHeight: 0, paddingHorizontal: 18 }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 10, paddingBottom: 6 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "800" }, close: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }, closeText: { fontSize: 27, lineHeight: 34 },
  scroll: { flex: 1, minHeight: 0 }, content: { gap: 10, paddingBottom: 10 }, field: { minWidth: 0, flexShrink: 0, gap: 4 }, pairedField: { flex: 1 }, label: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  input: { minHeight: 44, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 10, fontSize: 15, lineHeight: 21 }, multiline: { minHeight: 72, textAlignVertical: "top" },
  option: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, justifyContent: "center" }, optionText: { fontSize: 14, lineHeight: 20, fontWeight: "600" }, note: { fontSize: 13, lineHeight: 19 },
  timeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  selected: { fontSize: 15, lineHeight: 21, fontWeight: "600" }, pair: { flexDirection: "row", gap: 10 }, flex: { flex: 1, minWidth: 0 }, searchRow: { flexDirection: "row", alignItems: "center" },
  customerResults: { maxHeight: 220, borderWidth: 1, borderRadius: 10 }, customerResult: { minHeight: 60, gap: 3, padding: 12, borderBottomWidth: 1 }, rateResults: { maxHeight: 160 }, chips: { gap: 8, paddingBottom: 2 },
  disclosure: { minHeight: 44, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, paddingVertical: 10 }, details: { gap: 10 },
  toggleRow: { minHeight: 58, borderTopWidth: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8 }, toggleTarget: { minWidth: 54, minHeight: 44, justifyContent: "center" },
  toggleTrack: { width: 50, height: 30, borderRadius: 20, padding: 3 }, toggleThumb: { width: 24, height: 24, borderRadius: 14, backgroundColor: "#fff" }, existingAction: { minHeight: 44, justifyContent: "center" },
  refresh: { minHeight: 44, justifyContent: "center", alignItems: "center" }, footer: { paddingTop: 10, paddingBottom: 28, gap: 10, borderTopWidth: 1 }, total: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  cancel: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, padding: 12, justifyContent: "center", alignItems: "center" }, footerText: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  primary: { flex: 1, minHeight: 48, borderRadius: 12, padding: 12, justifyContent: "center", alignItems: "center" }, primaryText: { color: "#fff", fontSize: 16, lineHeight: 22, fontWeight: "700", textAlign: "center" },
});
