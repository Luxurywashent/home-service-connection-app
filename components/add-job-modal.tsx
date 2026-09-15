/**
 * AddJobModal — reusable "New Job" bottom-sheet modal.
 *
 * Pulls packages live from the price book (trpc.pricebook.list).
 * Supports multi-vehicle, RV types, add-ons, custom price override,
 * discount, recurrence, detailer assignment, and job notes.
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/use-colors";
import { useCompanyPriceBook } from "@/hooks/use-company-price-book";
import { trpc } from "@/lib/trpc";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { RecurrencePicker, recurrenceLabel, type RecurrenceRule } from "@/components/recurrence-picker";
import { CalendarPicker } from "@/components/calendar-picker";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import { getJobSyncCompanyMembers } from "@/lib/jobsync-mobile-api";

// ─── Types ────────────────────────────────────────────────────────────────────

type VehicleType = "sedan" | "suv" | "xl_suv_van" | "truck" | "rv_20_29" | "rv_30_39" | "rv_40_plus";

const VEHICLE_TYPES: { id: VehicleType; label: string; emoji: string; group?: "rv" }[] = [
  { id: "sedan",      label: "Sedan",       emoji: "🚗" },
  { id: "suv",        label: "SUV",         emoji: "🚙" },
  { id: "xl_suv_van", label: "XL SUV / Van",emoji: "🚐" },
  { id: "truck",      label: "Truck",       emoji: "🛻" },
  { id: "rv_20_29",   label: "RV 20–29ft",  emoji: "🚌", group: "rv" },
  { id: "rv_30_39",   label: "RV 30–39ft",  emoji: "🚌", group: "rv" },
  { id: "rv_40_plus", label: "RV 40ft+",    emoji: "🚌", group: "rv" },
];

function isRvVehicle(vt: VehicleType | undefined): boolean {
  return vt === "rv_20_29" || vt === "rv_30_39" || vt === "rv_40_plus";
}

interface PackageDef {
  id: string; title: string; emoji: string; tagline: string;
  features: string[]; isRv?: boolean;
  basePrice: Partial<Record<VehicleType, number>>;
}
interface AddonDef { id: string; title: string; emoji: string; price: number; }
interface AdditionalVehicle {
  vehicleType: VehicleType; packageId: string;
  addonIds: string[]; addonQtys: Record<string, number>; price: number;
}

// Fallback packages used only when price book is empty
const PACKAGES_FALLBACK: PackageDef[] = [
  { id: "basic",    title: "Basic Detail",    emoji: "🚗", tagline: "Best for vehicle less than 2 years old or detailed in the last 60 Days",   features: ["Exterior Hand Wash","Debug Front End","Wheels, Tires, Wheel Wells","Door Jambs","Basic Interior Wipe Down","Vacuum Seats & Carpets","Cup Holders","Windows Inside/Out","Tire Dressing"], basePrice: { sedan: 200, suv: 225, xl_suv_van: 250, truck: 225 } },
  { id: "full",     title: "Full Detail",     emoji: "🧼", tagline: "Best for vehicles that don't have stains or detailed in the last 90 Days",  features: ["Everything In Basic +","Gas Cap","Tar Removal","90 Day Paint Protectant","Inside Barrel Of Wheels","Deep Interior Cleaning","Leather Cleaning","Headliner"], basePrice: { sedan: 300, suv: 325, xl_suv_van: 375, truck: 325 } },
  { id: "luxury",   title: "Luxury Detail",   emoji: "✨", tagline: "Best for vehicles that need a deep cleaning or have not been cleaned in 90+ Days", features: ["Everything in the Full Detail +","Engine Bay","Exhaust Tips","6 Month Paint Sealant","Deep Leather Cleaning","Between Seats & Console","Shampoo Seats & Carpets","Gas/Brake Pedal"], basePrice: { sedan: 400, suv: 450, xl_suv_van: 500, truck: 450 } },
  { id: "interior", title: "Interior Detail", emoji: "🪑", tagline: "Deep Interior Cleaning", features: ["Deep Interior Cleaning","Vacuum Seats & Carpets","Carpet/Seat Shampoo","Dash/Console/Doors Cleaned","Cup Holders","Deep Leather Cleaning","Between Seats & Console","Headliner","Gas/Brake Pedal","Windows Interior"], basePrice: { sedan: 250, suv: 275, xl_suv_van: 325, truck: 275 } },
  { id: "exterior", title: "Exterior Detail", emoji: "🛡️", tagline: "Thorough Exterior Clean & Protect", features: ["Exterior Hand Wash","Debug Front End","Gas Cap","Wheels, Tires, Wheel Wells","Exhaust Tips","90 Day Paint Protectant"], basePrice: { sedan: 200, suv: 225, xl_suv_van: 250, truck: 225 } },
];

const ADDONS: AddonDef[] = [
  { id: "rain_x",              title: "Rain-X",                    emoji: "🌧️", price: 10  },
  { id: "paint_sealant",       title: "Paint Sealant",             emoji: "🧴", price: 50  },
  { id: "clay_bar",            title: "Clay Bar",                  emoji: "🧱", price: 50  },
  { id: "leather_conditioning",title: "Leather Conditioning",      emoji: "💧", price: 40  },
  { id: "leather_cleaning",    title: "Leather Cleaning",          emoji: "🪑", price: 30  },
  { id: "ozone",               title: "Ozone",                     emoji: "🔵", price: 100 },
  { id: "shampoo_seats_carpets",title:"Shampoo Seats & Carpets",   emoji: "🧽", price: 75  },
  { id: "pet_hair_removal",    title: "Pet Hair Removal",          emoji: "🐾", price: 40  },
  { id: "one_step_paint",      title: "One Step Paint Enhancement",emoji: "🚘", price: 250 },
  { id: "shampoo_seats_only",  title: "Shampoo Seats (ONLY)",      emoji: "💺", price: 50  },
  { id: "engine_bay",          title: "Engine Bay Cleaning",       emoji: "🔧", price: 30  },
  { id: "deep_interior",       title: "Deep Interior Cleaning",    emoji: "🕐", price: 75  },
  { id: "shampoo_carpet_only", title: "Shampoo Carpet (ONLY)",     emoji: "🪣", price: 50  },
];

const CITY_LIST = [
  { slug: "crestview", label: "Crestview" },
  { slug: "niceville", label: "Niceville" },
  { slug: "destin",    label: "Destin"    },
  { slug: "fwb",       label: "Fort Walton Beach" },
  { slug: "pensacola", label: "Pensacola" },
] as const;

type CitySlug = typeof CITY_LIST[number]["slug"];

const DETAILER_COLORS = ["#0a7ea4","#7c3aed","#e11d48","#16a34a","#ea580c","#0891b2"];
type DetailerEntry = { name: string; color: string; employeeId: string; shift?: "first" | "second" };
const FALLBACK_DETAILERS: Record<string, DetailerEntry[]> = {
  crestview: [{ name: "Michael", color: "#0a7ea4", employeeId: "DET_MICHAEL", shift: "first" }, { name: "Cameron", color: "#7c3aed", employeeId: "DET_CAMERON", shift: "first" }],
  niceville: [{ name: "Lamont",  color: "#0a7ea4", employeeId: "DET_LAMONT",  shift: "first" }],
  destin:    [{ name: "Giovanni",color: "#0a7ea4", employeeId: "DET_GIOVANNI_V2", shift: "first" }],
  fwb:       [{ name: "Gabe",    color: "#0a7ea4", employeeId: "DET_GABE",    shift: "first" }],
  pensacola: [{ name: "Terry",   color: "#0a7ea4", employeeId: "DET_TERRY",   shift: "first" }],
};

function isDetailerOnShift(det: DetailerEntry, dayOfWeek: number): boolean {
  if (!det.shift) return true;
  if (det.shift === "first")  return [1, 2, 3, 4].includes(dayOfWeek);
  if (det.shift === "second") return [5, 6, 0].includes(dayOfWeek);
  return true;
}

const APP_API_BASE = "https://luxwashapp-n2wveyqg.manus.space";
const PICK_HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 7 AM – 9 PM

function formatHour(h: number) {
  if (h === 0) return "12 AM";
  if (h === 12) return "Noon";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── CustomerSearchField ──────────────────────────────────────────────────────

function CustomerSearchField({
  colors,
  value,
  onChange,
  showDropdown,
  setShowDropdown,
  onSelect,
}: {
  colors: any;
  value: string;
  onChange: (v: string) => void;
  showDropdown: boolean;
  setShowDropdown: (v: boolean) => void;
  onSelect: (c: { fullName: string; phone: string | null; email: string | null; address: string | null }) => void;
}) {
  const [query, setQuery] = React.useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchTerm, setSearchTerm] = React.useState("");

  const { data: results = [] } = trpc.customers.listAll.useQuery(
    { search: searchTerm },
    { enabled: searchTerm.length >= 2, staleTime: 10_000 }
  );

  const handleChange = (text: string) => {
    setQuery(text);
    onChange(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (text.length >= 2) {
      timerRef.current = setTimeout(() => {
        setSearchTerm(text);
        setShowDropdown(true);
      }, 300);
    } else {
      setShowDropdown(false);
    }
  };

  return (
    <View style={{ marginBottom: 8, zIndex: 1000 }}>
      <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.primary, borderRadius: 10, backgroundColor: colors.background, paddingHorizontal: 12, paddingVertical: 2 }}>
        <Text style={{ fontSize: 16, marginRight: 8 }}>🔍</Text>
        <TextInput
          value={query}
          onChangeText={handleChange}
          placeholder="Search existing customer..."
          placeholderTextColor={colors.muted}
          style={{ flex: 1, padding: 10, color: colors.foreground, fontSize: 14 }}
          returnKeyType="search"
          autoCapitalize="words"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => { setQuery(""); onChange(""); setShowDropdown(false); }} style={{ padding: 4 }}>
            <Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
      {showDropdown && (results as any[]).length > 0 && (
        <View style={{ position: "absolute", top: 50, left: 0, right: 0, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, maxHeight: 200, overflow: "hidden", elevation: 8, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}>
          <ScrollView keyboardShouldPersistTaps="always" nestedScrollEnabled>
            {(results as any[]).slice(0, 8).map((c: any, i: number) => (
              <TouchableOpacity
                key={c.customerId || i}
                onPress={() => { setQuery(c.fullName); onSelect(c); }}
                style={{ paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: i < Math.min((results as any[]).length, 8) - 1 ? 0.5 : 0, borderBottomColor: colors.border }}
                activeOpacity={0.7}
              >
                <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 14 }}>{c.fullName}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>
                  {[c.phone, c.email].filter(Boolean).join(" · ")}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ─── TimeDropdown ─────────────────────────────────────────────────────────────

function TimeDropdown({
  colors,
  label,
  value,
  onChange,
  minHour,
  blockedHours,
}: {
  colors: any;
  label: string;
  value: number;
  onChange: (h: number) => void;
  minHour?: number;
  blockedHours?: Set<number>;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, backgroundColor: colors.background, alignItems: "center" }}
        activeOpacity={0.75}
      >
        <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
        <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700", marginTop: 2 }}>{formatHour(value)}</Text>
      </TouchableOpacity>
      {open && (
        <View style={{ position: "absolute", top: 58, left: 0, right: 0, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, maxHeight: 200, overflow: "hidden", elevation: 10, zIndex: 100 }}>
          <ScrollView nestedScrollEnabled>
            {PICK_HOURS.filter((h) => minHour === undefined || h > minHour).map((h) => {
              const blocked = blockedHours?.has(h);
              return (
                <TouchableOpacity
                  key={h}
                  onPress={() => { onChange(h); setOpen(false); }}
                  style={{ paddingVertical: 10, paddingHorizontal: 14, backgroundColor: h === value ? colors.primary + "20" : "transparent" }}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: blocked ? "#DC2626" : h === value ? colors.primary : colors.foreground, fontWeight: h === value ? "700" : "400", fontSize: 14 }}>
                    {formatHour(h)}{blocked ? " ⚠️" : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AddJobModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
  prefill?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AddJobModal({ visible, onClose, onSaved, prefill }: AddJobModalProps) {
  const colors = useColors();
  const { employee: currentEmployee } = useEmployeeAuth();
  const { session: jobSyncSession } = useJobSyncAuth();
  const isJobSyncCompany = jobSyncSession?.portal === "company";
  const companyPriceBook = useCompanyPriceBook();

  // Company sessions use only their active Home Service Connected Price Book.
  const { data: localPbServices = [] } = trpc.pricebook.list.useQuery(undefined, { enabled: !isJobSyncCompany, staleTime: 60_000 });
  const pbServices = isJobSyncCompany ? companyPriceBook.services : localPbServices;
  const allJobPackages: PackageDef[] = pbServices.length > 0
    ? pbServices.map((s: any) => {
        const vp = (s.vehiclePrices ?? {}) as Record<string, number>;
        const isRv = s.serviceId?.startsWith("pb_rv") ||
          ((vp.rv_20_29 ?? 0) > 0 || (vp.rv_30_39 ?? 0) > 0 || (vp.rv_40_plus ?? 0) > 0);
        return {
          id: s.serviceId,
          title: s.name,
          emoji: s.emoji ?? "🚗",
          tagline: s.description ?? "",
          features: s.features ?? [],
          isRv,
          basePrice: {
            sedan: vp.sedan ?? 0,
            suv: vp.suv ?? 0,
            xl_suv_van: vp.xl_suv_van ?? 0,
            truck: vp.truck ?? 0,
            rv_20_29: vp.rv_20_29 ?? 0,
            rv_30_39: vp.rv_30_39 ?? 0,
            rv_40_plus: vp.rv_40_plus ?? 0,
          } as Partial<Record<VehicleType, number>>,
        };
      })
    : isJobSyncCompany ? [] : PACKAGES_FALLBACK;

  const rvPackages = allJobPackages.filter((p) => p.isRv);
  const standardPackages = allJobPackages.filter((p) => !p.isRv);

  // ── Customer fields ──
  const [firstName, setFirstName] = useState(prefill?.firstName ?? "");
  const [lastName,  setLastName]  = useState(prefill?.lastName  ?? "");
  const [phone,     setPhone]     = useState(prefill?.phone     ?? "");
  const [email,     setEmail]     = useState(prefill?.email     ?? "");
  const [address,   setAddress]   = useState(prefill?.address   ?? "");
  const [customerSearch,     setCustomerSearch]     = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  // ── Date / City ──
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedCity, setSelectedCity] = useState<CitySlug>(
    (prefill?.city as CitySlug) ?? "crestview"
  );
  const [showCityPicker, setShowCityPicker] = useState(false);

  // ── Primary Vehicle / Package / Addons ──
  const [vehicleType, setVehicleType] = useState<VehicleType | undefined>(undefined);
  const [packageId,   setPackageId]   = useState<string | undefined>(undefined);
  const [addonIds,    setAddonIds]    = useState<string[]>([]);
  const [addonQtys,   setAddonQtys]   = useState<Record<string, number>>({});
  const [addonsExpanded, setAddonsExpanded] = useState(false);
  const [price, setPrice] = useState("");
  const [priceOverridden, setPriceOverridden] = useState(false);
  const [showPriceInput, setShowPriceInput] = useState(false);

  // ── Additional Vehicles ──
  const [extraVehicles, setExtraVehicles] = useState<AdditionalVehicle[]>([]);

  // ── Discount ──
  const [discountType, setDiscountType] = useState<"fixed" | "percent">("fixed");
  const [discountInput, setDiscountInput] = useState("");
  const [showDiscountRow, setShowDiscountRow] = useState(false);

  // ── Notes ──
  const [jobNotes, setJobNotes] = useState("");
  const [showNotesInput, setShowNotesInput] = useState(false);

  // ── Time ──
  const [startHour, setStartHour] = useState(8);
  const [endHour,   setEndHour]   = useState(10);

  // ── Detailer ──
  const [detailer, setDetailer] = useState("");
  const [detailers, setDetailers] = useState<DetailerEntry[]>(
    FALLBACK_DETAILERS["crestview"]
  );

  // ── Recurrence ──
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule | null>(null);
  const [showRecurrencePicker, setShowRecurrencePicker] = useState(false);

  // ── Notify customer ──
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  // ── Payment ──
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);

  // ── Detailer availability ──
  const { data: existingJobsForDate } = trpc.jobs.listByLocation.useQuery(
    { location: selectedCity, startDate: selectedDate, endDate: selectedDate },
    { enabled: !!selectedDate && !!selectedCity }
  );

  const blockedHoursByDetailer = React.useMemo(() => {
    const map: Record<string, Set<number>> = {};
    if (selectedDate) {
      const dow = new Date(selectedDate + "T12:00:00").getDay();
      for (const det of detailers) {
        if (!isDetailerOnShift(det, dow)) {
          if (!map[det.name]) map[det.name] = new Set();
          for (let h = 8; h < 17; h++) map[det.name].add(h);
        }
      }
    }
    if (!existingJobsForDate) return map;
    for (const job of existingJobsForDate) {
      if (!job.assignedTo || job.status === "cancelled") continue;
      const jStart = Number(job.startHour ?? 0);
      const jEnd = Number(job.endHour ?? 24);
      const name = job.assignedTo;
      if (!map[name]) map[name] = new Set();
      for (let h = jStart; h < jEnd; h++) map[name].add(h);
    }
    return map;
  }, [existingJobsForDate, detailers, selectedDate]);

  const currentBlockedHours = React.useMemo(
    () => blockedHoursByDetailer[detailer] ?? new Set<number>(),
    [blockedHoursByDetailer, detailer]
  );

  const detailerHasJobsToday = React.useMemo(() => {
    const result: Record<string, number> = {};
    if (!existingJobsForDate) return result;
    for (const det of detailers) {
      const blocked = blockedHoursByDetailer[det.name];
      result[det.name] = blocked ? blocked.size : 0;
    }
    return result;
  }, [existingJobsForDate, detailers, blockedHoursByDetailer]);

  // ── Saving ──
  const [saving, setSaving] = useState(false);
  const jobUpsertMutation = trpc.jobs.upsert.useMutation();
  const jobCreateRecurringMutation = trpc.jobs.createRecurring.useMutation();

  // ── Reset on open ──
  useEffect(() => {
    if (visible) {
      setFirstName(prefill?.firstName ?? "");
      setLastName(prefill?.lastName   ?? "");
      setPhone(prefill?.phone         ?? "");
      setEmail(prefill?.email         ?? "");
      setAddress(prefill?.address     ?? "");
      setSelectedCity((prefill?.city as CitySlug) ?? "crestview");
      setCustomerSearch("");
      setShowCustomerDropdown(false);
      setSelectedDate(todayStr());
      setShowDatePicker(false);
      setVehicleType(undefined);
      setPackageId(undefined);
      setAddonIds([]);
      setAddonQtys({});
      setAddonsExpanded(false);
      setPrice("");
      setPriceOverridden(false);
      setShowPriceInput(false);
      setExtraVehicles([]);
      setDiscountType("fixed");
      setDiscountInput("");
      setShowDiscountRow(false);
      setJobNotes("");
      setShowNotesInput(false);
      setPaymentMethod(null);
      setStartHour(8);
      setEndHour(10);
      setRecurrenceRule(null);
      setShowRecurrencePicker(false);
      setNotifyCustomer(true);
      setSaving(false);
    }
  }, [visible]);

  // ── Fetch detailers when city changes ──
  useEffect(() => {
    const fetchDetailers = async () => {
      if (isJobSyncCompany && jobSyncSession?.company) {
        try {
          const roster = await getJobSyncCompanyMembers(jobSyncSession.token, jobSyncSession.company.id);
          const entries = roster.members
            .filter((member) => member.calendarEligible)
            .map((member, index) => ({
              employeeId: String(member.id),
              name: member.name,
              color: DETAILER_COLORS[index % DETAILER_COLORS.length],
            }));
          setDetailers(entries);
          setDetailer(entries[0]?.name ?? "");
        } catch {
          // Never substitute a Luxury Wash roster for a Company session.
          setDetailers([]);
          setDetailer("");
        }
        return;
      }
      try {
        const res = await fetch(`${APP_API_BASE}/api/booking/detailers?location=${selectedCity}`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.detailers) && data.detailers.length > 0) {
          const entries = data.detailers.map((d: { employeeId: string; fullName: string; shift?: string }, idx: number) => ({
            employeeId: d.employeeId,
            name: d.fullName.split(" ")[0],
            color: DETAILER_COLORS[idx % DETAILER_COLORS.length],
            shift: d.shift === "shift2" ? "second" : "first",
          }));
          setDetailers(entries);
          setDetailer(entries[0]?.name ?? "");
        } else {
          const fb = FALLBACK_DETAILERS[selectedCity] ?? [];
          setDetailers(fb);
          setDetailer(fb[0]?.name ?? "");
        }
      } catch {
        const fb = FALLBACK_DETAILERS[selectedCity] ?? [];
        setDetailers(fb);
        setDetailer(fb[0]?.name ?? "");
      }
    };
    fetchDetailers();
  }, [isJobSyncCompany, jobSyncSession, selectedCity]);

  const cityLabel = CITY_LIST.find((c) => c.slug === selectedCity)?.label ?? selectedCity;

  // ── Price helpers ──
  const recalcPrice = (
    pkgId: string | undefined,
    vt: VehicleType | undefined,
    qtys: Record<string, number>,
    override: boolean
  ) => {
    if (override || !pkgId || !vt) return;
    const pkg = allJobPackages.find((p) => p.id === pkgId);
    if (!pkg) return;
    const base = (pkg.basePrice as Partial<Record<VehicleType, number>>)[vt] ?? 0;
    const addonsTotal = ADDONS.reduce((s, ad) => s + ad.price * (qtys[ad.id] ?? 0), 0);
    setPrice((base + addonsTotal).toString());
  };

  const extraTotal = extraVehicles.reduce((s, v) => s + v.price, 0);
  const basePrice = parseFloat(price) || 0;
  const discountVal = parseFloat(discountInput) || 0;
  const computedDiscount = discountType === "percent"
    ? Math.round((discountVal / 100) * (basePrice + extraTotal) * 100) / 100
    : discountVal;
  const grandTotal = Math.max(0, basePrice + extraTotal - computedDiscount);

  // ── Save ──
  const handleSave = async () => {
    if (!firstName.trim() || !lastName.trim() || !address.trim()) return;
    setSaving(true);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const resolvedTitle = packageId
      ? (allJobPackages.find((p) => p.id === packageId)?.title ?? "Detail Service")
      : "Detail Service";
    const customPriceOverride = priceOverridden ? basePrice : undefined;
    const discountAmountFinal = computedDiscount > 0 ? computedDiscount : undefined;
    const discountCodeFinal = undefined;

    const basePayload = {
      location: selectedCity,
      date: selectedDate,
      timeSlot: `${formatHour(startHour)} - ${formatHour(endHour)}`,
      startHour,
      endHour,
      customerName: `${firstName.trim()} ${lastName.trim()}`.trim(),
      customerPhone: phone.trim() || undefined,
      customerEmail: email.trim() || undefined,
      vehicleType: vehicleType || undefined,
      packageType: packageId || undefined,
      serviceDescription: resolvedTitle,
      selectedAddons: addonIds.length ? JSON.stringify(addonIds) : undefined,
      totalPrice: grandTotal,
      customPrice: customPriceOverride,
      discountAmount: discountAmountFinal,
      discountCode: discountCodeFinal,
      assignedTo: detailer || undefined,
      customerAddress: address.trim(),
      additionalVehicles: extraVehicles.length > 0 ? JSON.stringify(extraVehicles) : undefined,
      notes: jobNotes.trim() || undefined,
      paymentMethod: paymentMethod ?? undefined,
      status: "confirmed" as const,
      source: "manual" as const,
      createdBy: currentEmployee?.employeeId || undefined,
    };

    try {
      if (recurrenceRule && recurrenceRule.type !== "none") {
        const res = await jobCreateRecurringMutation.mutateAsync({
          ...basePayload,
          recurrenceRule: recurrenceRule as any,
        });
        Alert.alert("Recurring Jobs Created", `${res.count} job${res.count === 1 ? "" : "s"} scheduled.`);
      } else {
        await jobUpsertMutation.mutateAsync({ ...basePayload, jobId: Date.now().toString(), notifyCustomer });
        Alert.alert("Job Saved", `Job for ${firstName} ${lastName} on ${selectedDate} has been saved.`);
      }
      onSaved?.();
      onClose();
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Failed to save job. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const canSave = firstName.trim().length > 0 && lastName.trim().length > 0 && address.trim().length > 0 && !saving;

  // ── Packages to show for primary vehicle ──
  const packagesToShow = vehicleType
    ? (isRvVehicle(vehicleType) ? rvPackages : standardPackages)
    : [];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, maxHeight: "94%" }}>

            {/* Header */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <View>
                <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>New Job</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{cityLabel} · {selectedDate}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
                <Text style={{ color: colors.muted, fontSize: 24 }}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* ── Date ── */}
              <Text style={[s.sectionLabel, { color: colors.muted }]}>Date</Text>
              <TouchableOpacity
                onPress={() => setShowDatePicker((v) => !v)}
                style={[s.rowBtn, { borderColor: colors.border, backgroundColor: colors.background, marginBottom: showDatePicker ? 8 : 16 }]}
                activeOpacity={0.75}
              >
                <Text style={{ color: colors.foreground, fontSize: 15 }}>{selectedDate}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{showDatePicker ? "▲" : "▼"}</Text>
              </TouchableOpacity>
              {showDatePicker && (
                <View style={{ marginBottom: 16 }}>
                  <CalendarPicker
                    selectedDate={selectedDate}
                    onSelectDate={(d) => { setSelectedDate(d); setShowDatePicker(false); }}
                    minDate={todayStr()}
                  />
                </View>
              )}

              {/* ── City ── */}
              <Text style={[s.sectionLabel, { color: colors.muted }]}>Location</Text>
              <TouchableOpacity
                onPress={() => setShowCityPicker((v) => !v)}
                style={[s.rowBtn, { borderColor: colors.border, backgroundColor: colors.background, marginBottom: showCityPicker ? 8 : 16 }]}
                activeOpacity={0.75}
              >
                <Text style={{ color: colors.foreground, fontSize: 15 }}>{cityLabel}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{showCityPicker ? "▲" : "▼"}</Text>
              </TouchableOpacity>
              {showCityPicker && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                  {CITY_LIST.map((c) => {
                    const sel = selectedCity === c.slug;
                    return (
                      <TouchableOpacity
                        key={c.slug}
                        onPress={() => { setSelectedCity(c.slug); setShowCityPicker(false); }}
                        style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : colors.surface }}
                        activeOpacity={0.75}
                      >
                        <Text style={{ color: sel ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13 }}>{c.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* ── Customer ── */}
              <Text style={[s.sectionLabel, { color: colors.muted }]}>Customer</Text>
              <CustomerSearchField
                colors={colors}
                value={customerSearch}
                onChange={setCustomerSearch}
                showDropdown={showCustomerDropdown}
                setShowDropdown={setShowCustomerDropdown}
                onSelect={(c) => {
                  const parts = (c.fullName || "").split(" ");
                  setFirstName(parts[0] || "");
                  setLastName(parts.slice(1).join(" ") || "");
                  setPhone(c.phone || "");
                  setEmail(c.email || "");
                  setAddress(c.address || "");
                  setCustomerSearch(c.fullName || "");
                  setShowCustomerDropdown(false);
                }}
              />
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
                <TextInput
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First Name *"
                  placeholderTextColor={colors.muted}
                  style={[s.input, { flex: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground }]}
                />
                <TextInput
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last Name *"
                  placeholderTextColor={colors.muted}
                  style={[s.input, { flex: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground }]}
                />
              </View>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="Phone"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                style={[s.input, { borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground, marginBottom: 8 }]}
              />
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor={colors.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                style={[s.input, { borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground, marginBottom: 8 }]}
              />
              <AddressAutocomplete
                value={address}
                onChangeText={setAddress}
                onSelectAddress={setAddress}
                placeholder="Address *"
                style={{ marginBottom: 16, zIndex: 999 }}
              />

              {/* ── Vehicle Type ── */}
              <Text style={[s.sectionLabel, { color: colors.muted }]}>Vehicle Type</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                {VEHICLE_TYPES.filter((v) => !v.group).map((v) => {
                  const sel = vehicleType === v.id;
                  return (
                    <TouchableOpacity
                      key={v.id}
                      onPress={() => { setVehicleType(v.id); setPackageId(undefined); setAddonIds([]); setAddonQtys({}); setPrice(""); setPriceOverridden(false); }}
                      style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : colors.surface }}
                      activeOpacity={0.75}
                    >
                      <Text style={{ fontSize: 16 }}>{v.emoji}</Text>
                      <Text style={{ color: sel ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13, marginLeft: 6 }}>{v.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {/* RV types */}
              <Text style={[s.subLabel, { color: colors.muted }]}>RV</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                {VEHICLE_TYPES.filter((v) => v.group === "rv").map((v) => {
                  const sel = vehicleType === v.id;
                  return (
                    <TouchableOpacity
                      key={v.id}
                      onPress={() => { setVehicleType(v.id); setPackageId(undefined); setAddonIds([]); setAddonQtys({}); setPrice(""); setPriceOverridden(false); }}
                      style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : colors.surface }}
                      activeOpacity={0.75}
                    >
                      <Text style={{ fontSize: 16 }}>{v.emoji}</Text>
                      <Text style={{ color: sel ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13, marginLeft: 6 }}>{v.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* ── Package ── */}
              {vehicleType && (
                <>
                  <Text style={[s.sectionLabel, { color: colors.muted }]}>Package</Text>
                  {packagesToShow.length === 0 && (
                    <Text style={{ color: isJobSyncCompany && companyPriceBook.error ? colors.error : colors.muted, fontSize: 13, marginBottom: 12 }}>
                      {isJobSyncCompany && companyPriceBook.isLoading
                        ? "Loading your Company Price Book…"
                        : isJobSyncCompany && companyPriceBook.error
                          ? companyPriceBook.error
                          : isJobSyncCompany
                            ? "No active service is available for this vehicle type. Add or activate a service in the web Price Book."
                            : "No packages available for this vehicle type."}
                    </Text>
                  )}
                  {packagesToShow.map((p) => {
                    const pkgPrice = (p.basePrice as Partial<Record<VehicleType, number>>)[vehicleType] ?? 0;
                    const sel = packageId === p.id;
                    return (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => {
                          setPackageId(p.id);
                          setAddonIds([]); setAddonQtys({});
                          setPriceOverridden(false);
                          setShowPriceInput(false);
                          setPrice(pkgPrice.toString());
                        }}
                        style={{ borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: sel ? 2 : 1, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary + "15" : colors.background }}
                        activeOpacity={0.8}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
                          <Text style={{ fontSize: 18, marginRight: 8 }}>{p.emoji}</Text>
                          <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14, flex: 1 }}>{p.title}</Text>
                          <TouchableOpacity
                            onPress={(e) => {
                              e.stopPropagation();
                              if (!sel) { setPackageId(p.id); setAddonIds([]); setAddonQtys({}); setPrice(pkgPrice.toString()); }
                              setPriceOverridden(true); setShowPriceInput(true);
                            }}
                            style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: priceOverridden && sel ? colors.warning + "30" : "transparent" }}
                            activeOpacity={0.7}
                          >
                            <Text style={{ color: priceOverridden && sel ? colors.warning : colors.primary, fontWeight: "800", fontSize: 15 }}>
                              {priceOverridden && sel ? `$${price || pkgPrice} ✏️` : `$${pkgPrice}`}
                            </Text>
                          </TouchableOpacity>
                        </View>
                        <Text style={{ color: colors.muted, fontSize: 11, marginLeft: 26 }}>{p.tagline}</Text>
                        {sel && p.features.map((f) => (
                          <View key={f} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3, marginLeft: 26 }}>
                            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary }} />
                            <Text style={{ color: colors.foreground, fontSize: 12 }}>{f}</Text>
                          </View>
                        ))}
                      </TouchableOpacity>
                    );
                  })}
                </>
              )}

              {/* Static add-ons are retained only for legacy sessions. */}
              {!isJobSyncCompany && vehicleType && packageId && (
                <>
                  <TouchableOpacity
                    onPress={() => setAddonsExpanded((e) => !e)}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: addonIds.length > 0 ? colors.primary : colors.border, borderRadius: 10, padding: 12, backgroundColor: addonIds.length > 0 ? colors.primary + "10" : colors.surface, marginBottom: addonsExpanded ? 10 : 16, marginTop: 4 }}
                    activeOpacity={0.75}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: 16 }}>✨</Text>
                      <Text style={{ color: addonIds.length > 0 ? colors.primary : colors.foreground, fontWeight: "600", fontSize: 14 }}>
                        {addonIds.length > 0 ? `Add-Ons (${addonIds.length} selected)` : "Add Add-Ons (Optional)"}
                      </Text>
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 16 }}>{addonsExpanded ? "▲" : "▼"}</Text>
                  </TouchableOpacity>
                  {addonsExpanded && ADDONS.map((a) => {
                    const qty = addonQtys[a.id] ?? 0;
                    const handleQtyChange = (newQty: number) => {
                      const newQtys = { ...addonQtys, [a.id]: newQty };
                      if (newQty === 0) delete newQtys[a.id];
                      setAddonQtys(newQtys);
                      setAddonIds(ADDONS.filter((ad) => (newQtys[ad.id] ?? 0) > 0).map((ad) => ad.id));
                      recalcPrice(packageId, vehicleType, newQtys, priceOverridden);
                    };
                    return (
                      <View key={a.id} style={{ flexDirection: "row", alignItems: "center", borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: qty > 0 ? 1.5 : 1, borderColor: qty > 0 ? colors.primary : colors.border, backgroundColor: qty > 0 ? colors.primary + "10" : colors.surface }}>
                        <Text style={{ fontSize: 18, marginRight: 8 }}>{a.emoji}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 13 }}>{a.title}</Text>
                          <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 11 }}>${a.price}{qty > 1 ? ` × ${qty} = $${(a.price * qty).toFixed(0)}` : ""}</Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <TouchableOpacity onPress={() => handleQtyChange(Math.max(0, qty - 1))} style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: colors.border, justifyContent: "center", alignItems: "center", opacity: qty === 0 ? 0.3 : 1 }} disabled={qty === 0}><Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>−</Text></TouchableOpacity>
                          <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 13, minWidth: 16, textAlign: "center" }}>{qty}</Text>
                          <TouchableOpacity onPress={() => handleQtyChange(qty + 1)} style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: colors.border, justifyContent: "center", alignItems: "center" }}><Text style={{ color: colors.primary, fontSize: 15, fontWeight: "700" }}>+</Text></TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </>
              )}

              {/* ── Additional Vehicles ── */}
              {vehicleType && packageId && (
                <>
                  {extraVehicles.map((ev, evIdx) => (
                    <View key={evIdx} style={{ borderWidth: 1, borderColor: colors.primary + "44", borderRadius: 14, padding: 14, marginBottom: 14, backgroundColor: colors.primary + "08" }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>Vehicle {evIdx + 2}</Text>
                        <TouchableOpacity onPress={() => setExtraVehicles((prev) => prev.filter((_, i) => i !== evIdx))} style={{ padding: 4 }}>
                          <Text style={{ color: colors.error, fontSize: 18, fontWeight: "700" }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={[s.subLabel, { color: colors.muted }]}>Vehicle Type</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                        {VEHICLE_TYPES.filter((v) => !v.group).map((v) => {
                          const sel = ev.vehicleType === v.id;
                          return (
                            <TouchableOpacity key={v.id} onPress={() => setExtraVehicles((prev) => prev.map((x, i) => i === evIdx ? { ...x, vehicleType: v.id, packageId: "", addonIds: [], addonQtys: {}, price: 0 } : x))} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : colors.surface }} activeOpacity={0.75}>
                              <Text style={{ fontSize: 14 }}>{v.emoji}</Text>
                              <Text style={{ color: sel ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 12, marginLeft: 5 }}>{v.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <Text style={[s.subLabel, { color: colors.muted }]}>RV</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                        {VEHICLE_TYPES.filter((v) => v.group === "rv").map((v) => {
                          const sel = ev.vehicleType === v.id;
                          return (
                            <TouchableOpacity key={v.id} onPress={() => setExtraVehicles((prev) => prev.map((x, i) => i === evIdx ? { ...x, vehicleType: v.id, packageId: "", addonIds: [], addonQtys: {}, price: 0 } : x))} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : colors.surface }} activeOpacity={0.75}>
                              <Text style={{ fontSize: 14 }}>{v.emoji}</Text>
                              <Text style={{ color: sel ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 12, marginLeft: 5 }}>{v.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      {ev.vehicleType ? (() => {
                        const evPkgs = isRvVehicle(ev.vehicleType as VehicleType) ? rvPackages : standardPackages;
                        return (
                          <>
                            <Text style={[s.subLabel, { color: colors.muted }]}>Package</Text>
                            {evPkgs.map((p) => {
                              const pkgPrice = (p.basePrice as Partial<Record<VehicleType, number>>)[ev.vehicleType as VehicleType] ?? 0;
                              const sel = ev.packageId === p.id;
                              return (
                                <TouchableOpacity key={p.id} onPress={() => setExtraVehicles((prev) => prev.map((x, i) => i === evIdx ? { ...x, packageId: p.id, price: pkgPrice } : x))} style={{ borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: sel ? 2 : 1, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary + "15" : colors.background }} activeOpacity={0.8}>
                                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                                    <Text style={{ fontSize: 16, marginRight: 8 }}>{p.emoji}</Text>
                                    <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 13, flex: 1 }}>{p.title}</Text>
                                    <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 14 }}>${pkgPrice}</Text>
                                  </View>
                                </TouchableOpacity>
                              );
                            })}
                          </>
                        );
                      })() : null}
                      {ev.price > 0 && (
                        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 4 }}>
                          <Text style={{ color: colors.muted, fontSize: 13 }}>Vehicle {evIdx + 2} subtotal</Text>
                          <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>${ev.price.toFixed(2)}</Text>
                        </View>
                      )}
                    </View>
                  ))}

                  {/* Add Another Vehicle */}
                  <TouchableOpacity
                    onPress={() => setExtraVehicles((prev) => [...prev, { vehicleType: "sedan", packageId: "", addonIds: [], addonQtys: {}, price: 0 }])}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 12, paddingVertical: 12, marginBottom: 16, backgroundColor: colors.primary + "0D" }}
                    activeOpacity={0.75}
                  >
                    <Text style={{ color: colors.primary, fontSize: 18, fontWeight: "700" }}>+</Text>
                    <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>Add Another Vehicle</Text>
                  </TouchableOpacity>

                  {/* Running total */}
                  {extraVehicles.length > 0 && basePrice > 0 && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.primary + "44", backgroundColor: colors.primary + "12", padding: 14, marginBottom: 16 }}>
                      <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14 }}>Total ({1 + extraVehicles.length} vehicles)</Text>
                      <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 17 }}>${(basePrice + extraTotal).toFixed(2)}</Text>
                    </View>
                  )}
                </>
              )}

              {/* ── Custom Price Override ── */}
              {packageId && vehicleType && (
                <View style={{ marginBottom: 16 }}>
                  {showPriceInput ? (
                    <View style={{ borderWidth: 2, borderColor: colors.warning, borderRadius: 12, padding: 14, backgroundColor: colors.warning + "10" }}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: colors.warning, marginBottom: 8, letterSpacing: 0.5 }}>CUSTOM PRICE OVERRIDE</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.warning }}>$</Text>
                        <TextInput
                          style={{ flex: 1, fontSize: 28, fontWeight: "800", color: colors.foreground, borderBottomWidth: 2, borderBottomColor: colors.warning, paddingVertical: 4 }}
                          value={price}
                          onChangeText={(v) => { setPrice(v.replace(/[^0-9.]/g, "")); setPriceOverridden(true); }}
                          keyboardType="decimal-pad"
                          autoFocus
                          selectTextOnFocus
                          returnKeyType="done"
                          onSubmitEditing={() => setShowPriceInput(false)}
                          placeholder="0"
                          placeholderTextColor={colors.muted}
                        />
                        <TouchableOpacity onPress={() => setShowPriceInput(false)} style={{ backgroundColor: colors.warning, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 }} activeOpacity={0.8}>
                          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Done</Text>
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity
                        onPress={() => {
                          const pkg = allJobPackages.find((p) => p.id === packageId);
                          if (pkg && vehicleType) {
                            const addonsTotal = ADDONS.reduce((s, ad) => s + ad.price * (addonQtys[ad.id] ?? 0), 0);
                            setPrice(((pkg.basePrice as Partial<Record<VehicleType, number>>)[vehicleType]! + addonsTotal).toString());
                          }
                          setPriceOverridden(false);
                          setShowPriceInput(false);
                        }}
                        style={{ marginTop: 10, alignSelf: "flex-start" }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: colors.muted, fontSize: 12, textDecorationLine: "underline" }}>Reset to package price</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => { setPriceOverridden(true); setShowPriceInput(true); }}
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: priceOverridden ? 2 : 1, borderColor: priceOverridden ? colors.warning : colors.border, borderRadius: 12, padding: 14, backgroundColor: priceOverridden ? colors.warning + "10" : colors.background }}
                      activeOpacity={0.8}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={{ fontSize: 16 }}>💰</Text>
                        <View>
                          <Text style={{ fontSize: 11, fontWeight: "700", color: priceOverridden ? colors.warning : colors.muted, letterSpacing: 0.5 }}>
                            {priceOverridden ? "CUSTOM PRICE" : "TOTAL PRICE"}
                          </Text>
                          <Text style={{ fontSize: 22, fontWeight: "800", color: priceOverridden ? colors.warning : colors.foreground }}>
                            ${price || "0"}
                          </Text>
                        </View>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 4 }}>
                        <Text style={{ fontSize: 13, color: priceOverridden ? colors.warning : colors.primary, fontWeight: "700" }}>✏️ Edit</Text>
                        {priceOverridden && <Text style={{ fontSize: 10, color: colors.warning, fontWeight: "600" }}>OVERRIDDEN</Text>}
                      </View>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* ── Discount ── */}
              {packageId && vehicleType && (
                <>
                  <TouchableOpacity
                    onPress={() => setShowDiscountRow((v) => !v)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: showDiscountRow ? 8 : 16 }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 14 }}>🏷️</Text>
                    <Text style={{ color: computedDiscount > 0 ? colors.success : colors.primary, fontWeight: "600", fontSize: 14 }}>
                      {computedDiscount > 0 ? `Discount: −$${computedDiscount.toFixed(2)}` : "Add Discount (Optional)"}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{showDiscountRow ? "▲" : "▼"}</Text>
                  </TouchableOpacity>
                  {showDiscountRow && (
                    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginBottom: 16, backgroundColor: colors.surface }}>
                      <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
                        {(["fixed", "percent"] as const).map((t) => (
                          <TouchableOpacity
                            key={t}
                            onPress={() => setDiscountType(t)}
                            style={{ flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: discountType === t ? colors.primary : colors.border, backgroundColor: discountType === t ? colors.primary + "15" : colors.background, alignItems: "center" }}
                            activeOpacity={0.75}
                          >
                            <Text style={{ color: discountType === t ? colors.primary : colors.foreground, fontWeight: "700", fontSize: 13 }}>
                              {t === "fixed" ? "$ Fixed" : "% Percent"}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>{discountType === "fixed" ? "$" : "%"}</Text>
                        <TextInput
                          value={discountInput}
                          onChangeText={(v) => setDiscountInput(v.replace(/[^0-9.]/g, ""))}
                          placeholder="0"
                          placeholderTextColor={colors.muted}
                          keyboardType="decimal-pad"
                          returnKeyType="done"
                          style={[s.input, { flex: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground }]}
                        />
                        {computedDiscount > 0 && (
                          <Text style={{ color: colors.success, fontWeight: "700", fontSize: 15 }}>−${computedDiscount.toFixed(2)}</Text>
                        )}
                      </View>
                    </View>
                  )}
                </>
              )}

              {/* ── Grand Total ── */}
              {packageId && vehicleType && (
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 12, borderWidth: 1.5, borderColor: colors.primary + "55", backgroundColor: colors.primary + "0A", padding: 14, marginBottom: 16 }}>
                  <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15 }}>
                    Grand Total{computedDiscount > 0 ? " (after discount)" : ""}
                  </Text>
                  <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 20 }}>${grandTotal.toFixed(2)}</Text>
                </View>
              )}

              {/* ── Time ── */}
              {packageId && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={[s.sectionLabel, { color: colors.muted }]}>Time</Text>
                  {currentBlockedHours.size > 0 && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FEF2F2", borderRadius: 8, padding: 8, marginBottom: 8 }}>
                      <Text style={{ fontSize: 13 }}>⚠️</Text>
                      <Text style={{ fontSize: 12, color: "#DC2626", flex: 1 }}>
                        {detailer} already has a job during some of these hours. Red slots are unavailable.
                      </Text>
                    </View>
                  )}
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TimeDropdown colors={colors} label="Start Time" value={startHour} onChange={setStartHour} blockedHours={currentBlockedHours} />
                    <TimeDropdown colors={colors} label="End Time" value={endHour} onChange={setEndHour} minHour={startHour} blockedHours={currentBlockedHours} />
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 8, gap: 6 }}>
                    <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>{formatHour(startHour)}</Text>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>→</Text>
                    <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>{formatHour(endHour)}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>({endHour - startHour}h)</Text>
                  </View>
                </View>
              )}

              {/* ── Recurrence ── */}
              <Text style={[s.sectionLabel, { color: colors.muted }]}>Recurrence</Text>
              <TouchableOpacity
                onPress={() => setShowRecurrencePicker(true)}
                style={[s.rowBtn, { borderColor: recurrenceRule && recurrenceRule.type !== "none" ? colors.primary : colors.border, backgroundColor: colors.background, marginBottom: 16 }]}
                activeOpacity={0.75}
              >
                <Text style={{ color: recurrenceRule && recurrenceRule.type !== "none" ? colors.primary : colors.muted, fontSize: 15 }}>
                  {recurrenceRule ? recurrenceLabel(recurrenceRule) : "Does not repeat"}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>›</Text>
              </TouchableOpacity>

              {/* ── Detailer ── */}
              {detailers.length > 1 && (
                <>
                  <Text style={[s.sectionLabel, { color: colors.muted }]}>Assign Detailer</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                    {detailers.map((det) => {
                      const dow = selectedDate ? new Date(selectedDate + "T12:00:00").getDay() : -1;
                      const offShift = dow >= 0 && !isDetailerOnShift(det, dow);
                      const busyHours = offShift ? 0 : (detailerHasJobsToday[det.name] ?? 0);
                      const isBusy = !offShift && busyHours > 0;
                      return (
                        <TouchableOpacity
                          key={det.name}
                          onPress={() => { if (!offShift) setDetailer(det.name); }}
                          disabled={offShift}
                          style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 2,
                            borderColor: offShift ? "#94a3b8" : detailer === det.name ? det.color : isBusy ? "#F87171" : colors.border,
                            backgroundColor: offShift ? "#F1F5F9" : detailer === det.name ? det.color + "18" : isBusy ? "#FEF2F2" : colors.surface,
                            alignItems: "center", opacity: offShift ? 0.55 : 1 }}
                        >
                          <Text style={{ color: offShift ? "#94a3b8" : detailer === det.name ? det.color : isBusy ? "#DC2626" : colors.foreground, fontWeight: "700", fontSize: 14 }}>{det.name}</Text>
                          {offShift && <Text style={{ fontSize: 10, color: "#94a3b8", fontWeight: "600", marginTop: 2 }}>Off Shift</Text>}
                          {!offShift && isBusy && <Text style={{ fontSize: 10, color: "#DC2626", fontWeight: "600", marginTop: 2 }}>Booked {busyHours}h</Text>}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {/* ── Notes ── */}
              <TouchableOpacity
                onPress={() => setShowNotesInput((v) => !v)}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: showNotesInput ? 8 : 16 }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 14 }}>📝</Text>
                <Text style={{ color: jobNotes.trim() ? colors.foreground : colors.primary, fontWeight: "600", fontSize: 14 }}>
                  {jobNotes.trim() ? "Notes added" : "Add Job Notes (Optional)"}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{showNotesInput ? "▲" : "▼"}</Text>
              </TouchableOpacity>
              {showNotesInput && (
                <TextInput
                  value={jobNotes}
                  onChangeText={setJobNotes}
                  placeholder="Any special instructions, gate codes, pet info, etc."
                  placeholderTextColor={colors.muted}
                  multiline
                  numberOfLines={3}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, backgroundColor: colors.background, marginBottom: 16, minHeight: 72, textAlignVertical: "top" }}
                />
              )}

              {/* ── Payment Method ── */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 14, marginBottom: 8 }}>💳 Payment</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {[null, "cash", "card", "check", "zelle", "venmo"].map((method) => (
                    <TouchableOpacity
                      key={method ?? "unpaid"}
                      onPress={() => setPaymentMethod(method)}
                      activeOpacity={0.7}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 20,
                        borderWidth: 1.5,
                        borderColor: paymentMethod === method ? (method ? colors.success : colors.border) : colors.border,
                        backgroundColor: paymentMethod === method ? (method ? colors.success + "22" : colors.surface) : colors.surface,
                      }}
                    >
                      <Text style={{ color: paymentMethod === method ? (method ? colors.success : colors.foreground) : colors.muted, fontWeight: "600", fontSize: 13 }}>
                        {method === null ? "Unpaid" : method === "cash" ? "💵 Cash" : method === "card" ? "💳 Card" : method === "check" ? "📝 Check" : method === "zelle" ? "⚡ Zelle" : "📱 Venmo"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              {/* ── Notify Customer ── */}
              <TouchableOpacity
                onPress={() => setNotifyCustomer((v) => !v)}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20 }}
                activeOpacity={0.7}
              >
                <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: notifyCustomer ? colors.primary : colors.border, backgroundColor: notifyCustomer ? colors.primary : "transparent", justifyContent: "center", alignItems: "center" }}>
                  {notifyCustomer && <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>✓</Text>}
                </View>
                <Text style={{ color: colors.foreground, fontSize: 14 }}>Notify customer via SMS/email</Text>
              </TouchableOpacity>

              {/* ── Buttons ── */}
              <View style={{ flexDirection: "row", gap: 12, marginTop: 8, marginBottom: 8 }}>
                <TouchableOpacity
                  onPress={onClose}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
                >
                  <Text style={{ color: colors.foreground, fontWeight: "600" }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSave}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", opacity: canSave ? 1 : 0.4 }}
                  disabled={!canSave}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <Text style={{ color: "#FFF", fontWeight: "700" }}>Save Job</Text>
                  )}
                </TouchableOpacity>
              </View>

            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Recurrence Picker overlay */}
      <RecurrencePicker
        visible={showRecurrencePicker}
        rule={recurrenceRule}
        baseDate={selectedDate}
        onConfirm={(rule) => { setRecurrenceRule(rule); setShowRecurrencePicker(false); }}
        onCancel={() => setShowRecurrencePicker(false)}
      />
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  subLabel: {
    fontSize: 10,
    fontWeight: "600",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  rowBtn: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
});
