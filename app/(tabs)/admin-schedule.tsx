/**
 * Admin Schedule Screen
 * - Company-scoped schedule board
 * - Team lanes are rendered only from authenticated Company data
 * - Empty Companies receive an explicit empty-team state instead of placeholder lanes
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Linking,
  ActivityIndicator,
  Image,
  Switch,
  RefreshControl,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle, runOnJS, withTiming } from "react-native-reanimated";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import { Alert } from "react-native";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { ScreenContainer } from "@/components/screen-container";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { useColors } from "@/hooks/use-colors";
import { useCompanyPriceBook } from "@/hooks/use-company-price-book";
import { trpc } from "@/lib/trpc";
import { AdminCheckoutModal } from "@/components/admin-checkout-modal";
import { RecurrencePicker, recurrenceLabel, type RecurrenceRule } from "@/components/recurrence-picker";
import { CalendarPicker } from "@/components/calendar-picker";
import {
  assignJobSyncCompanyJob,
  createJobSyncCompanyCustomer,
  createJobSyncCompanyJob,
  getJobSyncCompanyCustomers,
  getJobSyncCompanyJobs,
  getJobSyncCompanyMembers,
  rescheduleJobSyncCompanyJob,
  updateJobSyncCompanyJobStatus,
  type JobSyncCompanyCustomer,
} from "@/lib/jobsync-mobile-api";
import {
  allowsLegacyJobAuthority,
  canonicalJobId,
  COMPANY_LEGACY_FALLTHROUGH_BLOCKED,
  companyAssignedUserId,
  companyCanonicalReadError,
  companyScheduleDateTime,
  mapCanonicalJobToScheduleFields,
  resolveCompanyJobAuthority,
  usesCompanyJobAuthority,
} from "@/lib/jobsync-company-authority";
import { useJobSyncSync } from "@/lib/jobsync-sync-context";
import Constants from "expo-constants";

const APP_API_BASE = "https://luxwashapp-n2wveyqg.manus.space";

// ─── Types (shared with schedule.tsx) ─────────────────────────────────────────

type VehicleType = "sedan" | "suv" | "xl_suv_van" | "truck" | "rv_20_29" | "rv_30_39" | "rv_40_plus";

const VEHICLE_TYPES: { id: VehicleType; label: string; emoji: string; group?: "rv" }[] = [
  { id: "sedan", label: "Sedan", emoji: "🚗" },
  { id: "suv", label: "SUV", emoji: "🚙" },
  { id: "xl_suv_van", label: "XL SUV / Van", emoji: "🚐" },
  { id: "truck", label: "Truck", emoji: "🛳" },
  { id: "rv_20_29", label: "RV 20ft–29ft", emoji: "🚌", group: "rv" },
  { id: "rv_30_39", label: "RV 30ft–39ft", emoji: "🚌", group: "rv" },
  { id: "rv_40_plus", label: "RV 40ft+", emoji: "🚎", group: "rv" },
];
const RV_VEHICLE_IDS = new Set<VehicleType>(["rv_20_29", "rv_30_39", "rv_40_plus"]);
function isRvVehicle(v: VehicleType | null | undefined): boolean { return v != null && RV_VEHICLE_IDS.has(v); }

interface PackageDef { id: string; title: string; emoji: string; tagline: string; features: string[]; basePrice: Partial<Record<VehicleType, number>>; isRv?: boolean; }
interface AddonDef { id: string; title: string; emoji: string; price: number; }

const PACKAGES: PackageDef[] = [
  { id: "luxury", title: "Luxury Detail", emoji: "✨", tagline: "Best for vehicles that need a deep cleaning or have not been cleaned in 90+ Days", features: ["Everything in the Full Detail +","Engine Bay","Exhaust Tips","6 Month Paint Sealant","Deep Leather Cleaning","Between Seats & Console","Shampoo Seats & Carpets","Gas/Brake Pedal"], basePrice: { sedan: 400, suv: 450, xl_suv_van: 500, truck: 450 } },
  { id: "full", title: "Full Detail", emoji: "🧼", tagline: "Best for vehicles that don't have stains or detailed in the last 90 Days", features: ["Everything In Basic +","Gas Cap","Tar Removal","90 Day Paint Protectant","Inside Barrel Of Wheels","Deep Interior Cleaning","Leather Cleaning","Headliner"], basePrice: { sedan: 300, suv: 325, xl_suv_van: 375, truck: 325 } },
  { id: "basic", title: "Basic Detail", emoji: "🚗", tagline: "Best for vehicle less than 2 years old or detailed in the last 60 Days", features: ["Exterior Hand Wash","Debug Front End","Wheels, Tires, Wheel Wells","Door Jambs","Basic Interior Wipe Down","Vacuum Seats & Carpets","Cup Holders","Windows Inside/Out","Tire Dressing"], basePrice: { sedan: 200, suv: 225, xl_suv_van: 250, truck: 225 } },
  { id: "interior", title: "Interior Detail", emoji: "🪑", tagline: "Deep Interior Cleaning", features: ["Deep Interior Cleaning","Vacuum Seats & Carpets","Carpet/Seat Shampoo","Dash/Console/Doors Cleaned","Cup Holders","Deep Leather Cleaning","Between Seats & Console","Headliner","Gas/Brake Pedal","Windows Interior"], basePrice: { sedan: 250, suv: 275, xl_suv_van: 325, truck: 275 } },
  { id: "exterior", title: "Exterior Detail", emoji: "🛡️", tagline: "Thorough Exterior Clean & Protect", features: ["Exterior Hand Wash","Debug Front End","Gas Cap","Wheels, Tires, Wheel Wells","Exhaust Tips","90 Day Paint Protectant"], basePrice: { sedan: 200, suv: 225, xl_suv_van: 250, truck: 225 } },
];

/** Map a human-readable package name (from DB packageType) to a local package ID.
 * Handles both exact matches and partial/case-insensitive matches from online bookings.
 */
function resolvePackageId(packageType?: string | null): string | undefined {
  if (!packageType) return undefined;
  // Dynamic price book IDs (pb_xxx) are already valid package IDs — return as-is
  if (packageType.startsWith("pb_")) return packageType;
  const lower = packageType.toLowerCase();
  // Website booking IDs (e.g. "full_detail", "basic_detail") → DB price book IDs ("pb_full", "pb_basic")
  const websiteToDb: Record<string, string> = {
    basic_detail: "pb_basic",
    full_detail: "pb_full",
    interior_detail: "pb_interior",
    exterior_detail: "pb_exterior",
    luxury_detail: "pb_luxury",
    rv_wash_small: "pb_rv_wash",
    rv_wash_medium: "pb_rv_wash",
    rv_wash_large: "pb_rv_wash",
  };
  if (websiteToDb[lower]) return websiteToDb[lower];
  // Try "pb_" + first word (e.g. "full" → "pb_full", "basic" → "pb_basic")
  const firstWord = lower.split("_")[0];
  // Direct ID match against PACKAGES (e.g. "luxury", "full", "basic" from Zapier)
  const idMatch = PACKAGES.find(p => p.id === lower || p.id === firstWord);
  if (idMatch) return `pb_${idMatch.id}`;
  // Exact title match (e.g. "Luxury Detail")
  const exact = PACKAGES.find(p => p.title.toLowerCase() === lower);
  if (exact) return `pb_${exact.id}`;
  // Partial match (e.g. "Basic" matches "Basic Detail")
  const partial = PACKAGES.find(p => lower.includes(p.id) || p.title.toLowerCase().split(" ")[0] === lower.split(" ")[0]);
  if (partial) return `pb_${partial.id}`;
  return undefined;
}

/** Parse selectedAddons from DB — handles JSON arrays, comma-separated slugs, and hyphenated Zapier slugs. */
function parseAddonIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  // Website addon ID aliases (booking website uses different IDs than admin)
  const addonAliases: Record<string, string> = {
    paint_enhancement: "one_step_paint",
    "one_step_paint_enhancement": "one_step_paint",
    "rain_x_treatment": "rain_x",
    "rain-x treatment": "rain_x",
    "rain-x": "rain_x",
    "ozone treatment": "ozone",
    "shampoo seats & carpets": "shampoo_seats_carpets",
    "shampoo seats only": "shampoo_seats_only",
    "shampoo carpet only": "shampoo_carpet_only",
    "pet hair removal": "pet_hair_removal",
    "engine bay cleaning": "engine_bay",
    "deep interior cleaning": "deep_interior",
    "leather conditioning": "leather_conditioning",
    "leather cleaning": "leather_cleaning",
    "paint sealant": "paint_sealant",
    "clay bar": "clay_bar",
    "one step paint enhancement": "one_step_paint",
  };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed
      .filter((x: any) => typeof x === "string")
      .map((x: string) => addonAliases[x.toLowerCase()] ?? addonAliases[x] ?? x);
  } catch { /* not JSON */ }
  const names = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return names.map((name) => {
    if (addonAliases[name]) return addonAliases[name];
    const normalized = name.replace(/-/g, "_").replace(/\s+/g, "_");
    if (addonAliases[normalized]) return addonAliases[normalized];
    const match = ADDONS.find(
      (a) => a.id === normalized || a.id === name ||
             a.title.toLowerCase() === name ||
             name.includes(a.id) || normalized.includes(a.id) ||
             a.title.toLowerCase().includes(name)
    );
    return match?.id ?? normalized;
  });
}

/** Normalize Zapier vehicle type values to app VehicleType IDs. */
function resolveVehicleType(raw?: string | null): VehicleType | undefined {
  if (!raw) return undefined;
  const valid: VehicleType[] = ["sedan", "suv", "xl_suv_van", "truck", "rv_20_29", "rv_30_39", "rv_40_plus"];
  if (valid.includes(raw as VehicleType)) return raw as VehicleType;
  const lower = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (lower === "small" || lower === "compact" || lower === "midsize" || lower === "mid") return "sedan";
  if (lower === "suv" || lower === "crossover") return "suv";
  if (lower === "xlsuv" || lower === "xlsuvan" || lower === "van" || lower === "minivan") return "xl_suv_van";
  if (lower === "truck" || lower === "pickup") return "truck";
  if (lower.startsWith("rv")) return "rv_20_29";
  if (lower.includes("sedan") || lower.includes("car") || lower.includes("coupe") || lower.includes("hatch")) return "sedan";
  if (lower.includes("suv") || lower.includes("sport")) return "suv";
  if (lower.includes("van") || lower.includes("xl")) return "xl_suv_van";
  if (lower.includes("truck") || lower.includes("pick")) return "truck";
  return undefined;
}

const ADDONS: AddonDef[] = [
  { id: "rain_x", title: "Rain-X", emoji: "🌧️", price: 10 },
  { id: "paint_sealant", title: "Paint Sealant", emoji: "🧴", price: 50 },
  { id: "clay_bar", title: "Clay Bar", emoji: "🧱", price: 50 },
  { id: "leather_conditioning", title: "Leather Conditioning", emoji: "💧", price: 40 },
  { id: "leather_cleaning", title: "Leather Cleaning", emoji: "🪑", price: 30 },
  { id: "ozone", title: "Ozone", emoji: "🔵", price: 100 },
  { id: "shampoo_seats_carpets", title: "Shampoo Seats & Carpets", emoji: "🧽", price: 75 },
  { id: "pet_hair_removal", title: "Pet Hair Removal", emoji: "🐾", price: 40 },
  { id: "one_step_paint", title: "One Step Paint Enhancement", emoji: "🚘", price: 250 },
  { id: "shampoo_seats_only", title: "Shampoo Seats (ONLY)", emoji: "💺", price: 50 },
  { id: "engine_bay", title: "Engine Bay Cleaning", emoji: "🔧", price: 30 },
  { id: "deep_interior", title: "Deep Interior Cleaning", emoji: "🕐", price: 75 },
  { id: "shampoo_carpet_only", title: "Shampoo Carpet (ONLY)", emoji: "🪣", price: 50 },
];
type JobStatus = "scheduled" | "on_my_way" | "started" | "finished" | "cancelled" | "completed" | "pending" | "confirmed" | "in_progress";
type PaymentMethod = "credit_debit" | "cash" | "check" | "other" | "tap_to_pay" | "apple_pay";

interface PaymentRecord {
  method: PaymentMethod;
  subtotal: number;
  tipAmount: number;
  total: number;
  paidAt: string;
  paymentIntentId?: string;
  signatureDataUrl?: string;
  referenceNote?: string;
}

interface AdditionalVehicle {
  vehicleType: VehicleType;
  packageId: string;
  addonIds: string[];
  addonQtys: Record<string, number>;
  price: number;
  vehicleColor?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
}

interface Job {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  address: string;
  serviceTitle: string;
  serviceDescription?: string;
  price: number;
  startHour: number;
  endHour: number;
  dayIndex: number;
  weekOffset: number;
  status: JobStatus;
  payment?: PaymentRecord;
  createdAt: string;
  location?: string;
  isOnlineBooking?: boolean;
  bookingId?: string;
  upsellTotal?: number;
  upsellBonus?: number;
  upsellIds?: string[];
  upsellQtys?: Record<string, number>;
  notes?: string;
  // detailer identity
  detailerName?: string;
  assignedTo?: string; // employeeId of assigned detailer
  // booking details
  vehicleType?: VehicleType;
  packageId?: string;
  packageType?: string;
  addonIds?: string[];
  addonQtys?: Record<string, number>;
  vehicleColor?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  additionalVehicles?: AdditionalVehicle[];
  // enhanced detail fields
  tags?: string[];
  privateNotes?: PrivateNote[];
  leadSource?: string;
  taxAmount?: number;
  discountCode?: string;
  discountAmount?: number;
  depositAmount?: number;
  recurrenceParentId?: string;
  // Appointment confirmation
  apptConfirmationStatus?: "pending" | "confirmed" | "no_response";
  apptReminderSent?: number;
  apptConfirmedAt?: string | null;
  apptConfirmMethod?: "email" | "sms" | null;
  // Photos & progress timestamps
  photoUrls?: string[];
  onMyWayAt?: string | null;
  arrivedAt?: string | null;
  finishedAt?: string | null;
  jobFinishedAt?: string | null;
  customPrice?: number; // admin-set per-booking price override
  isNewCustomer?: boolean;
  onlineBookingId?: string | null;
}

const STORAGE_KEY_BASE = "tlw_schedule_jobs_v9"; // v9: per-employee cache key to prevent cross-detailer job leakage

// ─── Private Note type ────────────────────────────────────────────────────────
interface PrivateNote {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Location / Detailer Config ────────────────────────────────────────────────

// Static city list — used only for the dropdown labels and slug list.
// Detailers are fetched dynamically from the server so new hires appear automatically.
const CITY_LIST = [
  { slug: "crestview",  label: "Crestview" },
  { slug: "niceville",  label: "Niceville" },
  { slug: "destin",     label: "Destin" },
  { slug: "fwb",        label: "Fort Walton Beach" },
  { slug: "pensacola",  label: "Pensacola" },
] as const;

type CitySlug = typeof CITY_LIST[number]["slug"];

// Color palette assigned round-robin to detailers in order
const DETAILER_COLORS = ["#0a7ea4", "#7c3aed", "#e11d48", "#16a34a", "#ea580c", "#0891b2"];

interface DetailerEntry { name: string; color: string; employeeId: string; shift?: "first" | "second"; }
interface CityConfig { slug: string; label: string; detailers: DetailerEntry[]; }

// No hardcoded fallback — calendar is fully driven by live DB data
const FALLBACK_DETAILERS: Record<string, DetailerEntry[]> = {};

/** Returns true if the detailer is scheduled to work on the given JS day-of-week (0=Sun…6=Sat).
 *  first shift: Mon–Thu (1,2,3,4)
 *  second shift: Fri–Sun (5,6,0)
 *  No shift set → always available (backward compat for dynamically-loaded detailers). */
function isDetailerOnShift(det: DetailerEntry, dayOfWeek: number): boolean {
  if (!det.shift) return true;
  if (det.shift === "first")  return [1, 2, 3, 4].includes(dayOfWeek);
  if (det.shift === "second") return [5, 6, 0].includes(dayOfWeek);
  return true;
}

// Legacy — kept for the one place that iterates all cities to resolve detailer names
const CITY_CONFIG = CITY_LIST.map((c) => ({ ...c, detailers: FALLBACK_DETAILERS[c.slug] ?? [] }));

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEK_DAYS_SHORT = ["M", "T", "W", "T", "F", "S", "S"];
const WEEK_DAYS_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Half-hour slots: 8:00, 8:30, 9:00, ..., 17:00 (19 slots)
const HOURS = Array.from({ length: 19 }, (_, i) => 8 + i * 0.5); // 8:00 AM – 5:00 PM
const SLOT_HEIGHT = 64; // pixels per HOUR — each 30-min row renders at SLOT_HEIGHT/2 = 32px
const TIME_COL_WIDTH = 52;

const STATUS_COLOR: Record<JobStatus, string> = {
  scheduled: "#94a3b8",
  on_my_way: "#f59e0b",
  started: "#3b82f6",
  finished: "#22c55e",
  pending: "#94a3b8",
  confirmed: "#94a3b8",
  in_progress: "#3b82f6",
  completed: "#22c55e",
  cancelled: "#ef4444",
};

const STATUS_LABELS: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  on_my_way: "On My Way",
  started: "In Progress",
  finished: "Finished",
  pending: "Pending",
  confirmed: "Confirmed",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatHour(h: number) {
  const isHalf = h % 1 !== 0;
  const whole = Math.floor(h);
  const mins = isHalf ? ":30" : ":00";
  if (whole === 0) return `12:00 AM`;
  if (whole === 12 && !isHalf) return "Noon";
  if (whole < 12) return `${whole}${mins} AM`;
  return `${whole - 12 || 12}${mins} PM`;
}

function formatFullDate(d: Date) {
  // WEEK_DAYS_FULL is now Mon-indexed (0=Mon…6=Sun), so convert JS getDay() (0=Sun) to Mon-based
  const monIdx = (d.getDay() + 6) % 7;
  return `${WEEK_DAYS_FULL[monIdx]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function getWeekDates(offset: number): Date[] {
  const today = new Date();
  // Anchor to Monday: JS getDay() 0=Sun, so (getDay()+6)%7 gives 0=Mon
  const monday = new Date(today);
  monday.setDate(today.getDate() - (today.getDay() + 6) % 7 + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function todayDayIndex(): number {
  // Returns 0=Mon, 1=Tue, …, 6=Sun
  return (new Date().getDay() + 6) % 7;
}

/**
 * Convert a Date to a local YYYY-MM-DD string without UTC conversion.
 * Using toISOString() on a local midnight Date shifts the day in negative-offset timezones.
 */
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Parse a YYYY-MM-DD date string as a local calendar date (not UTC).
 * Using "T00:00:00" without a timezone treats the string as UTC in JS,
 * which shifts the date backward in negative-offset timezones.
 * Using "T12:00:00" (local noon) ensures the date resolves to the correct local day.
 */
function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr + "T12:00:00");
}

// ─── Job Block Component (cross-lane draggable for admin) ─────────────────────────

function AdminJobBlock({
  job,
  laneIdx,
  laneCount,
  laneWidth,
  detailerColor,
  onPress,
  onMoveAndReassign,
  onResize,
  gesturesEnabled = true,
}: {
  job: Job;
  laneIdx: number;
  laneCount: number;
  laneWidth: number;
  detailerColor: string;
  onPress: () => void;
  onMoveAndReassign?: (jobId: string, newStartHour: number, newLaneIdx: number) => void;
  onResize?: (jobId: string, newEndHour: number) => void;
  gesturesEnabled?: boolean;
}) {
  const colors = useColors();
  const top = (job.startHour - HOURS[0]) * SLOT_HEIGHT;
  const left = laneIdx * laneWidth;
  const height = Math.max((job.endHour - job.startHour) * SLOT_HEIGHT - 4, 28);
  const statusColor = STATUS_COLOR[job.status];
  const duration = Math.max(1, job.endHour - job.startHour);

  const blockY = useSharedValue(top);
  const blockX = useSharedValue(left);
  const blockH = useSharedValue(height);
  const isDragging = useSharedValue(false);
  const isResizing = useSharedValue(false);
  const startBlockY = useSharedValue(top);
  const startBlockX = useSharedValue(left);
  const startBlockH = useSharedValue(height);
  const hoverLane = useSharedValue(laneIdx);

  useEffect(() => {
    if (!isDragging.value && !isResizing.value) {
      blockY.value = top;
      blockX.value = left;
      blockH.value = height;
    }
  }, [top, left, height]);

  const commitMoveAndReassign = (newStartHour: number, newLane: number) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onMoveAndReassign?.(job.id, newStartHour, newLane);
  };

  const commitResize = (newEndHour: number) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onResize?.(job.id, newEndHour);
  };

  // ── Move gesture (long-press on body) ──
  const pan = Gesture.Pan()
    .enabled(!!onMoveAndReassign && gesturesEnabled)
    .activateAfterLongPress(300)
    .minDistance(4)
    .onStart(() => {
      "worklet";
      isDragging.value = true;
      startBlockY.value = blockY.value;
      startBlockX.value = blockX.value;
    })
    .onUpdate((e) => {
      "worklet";
      const newY = startBlockY.value + e.translationY;
      const maxY = (HOURS[HOURS.length - 1] - HOURS[0] - duration) * SLOT_HEIGHT;
      blockY.value = Math.max(0, Math.min(maxY, newY));

      const newX = startBlockX.value + e.translationX;
      const maxX = (laneCount - 1) * laneWidth;
      blockX.value = Math.max(0, Math.min(maxX, newX));

      const centerX = blockX.value + laneWidth / 2;
      hoverLane.value = Math.min(laneCount - 1, Math.max(0, Math.floor(centerX / laneWidth)));
    })
    .onEnd(() => {
      "worklet";
      // Snap to nearest 30-min slot (SLOT_HEIGHT/2 = 32px per slot)
      const slotIdx = Math.round(blockY.value / (SLOT_HEIGHT / 2));
      const clampedHi = Math.max(0, Math.min(HOURS.length - 1, slotIdx));
      const newLane = hoverLane.value;

      blockY.value = withTiming(clampedHi * (SLOT_HEIGHT / 2) + 2, { duration: 150 });
      blockX.value = withTiming(newLane * laneWidth, { duration: 150 });

      isDragging.value = false;
      hoverLane.value = newLane;

      runOnJS(commitMoveAndReassign)(HOURS[clampedHi], newLane);
    })
    .onFinalize(() => {
      "worklet";
      isDragging.value = false;
      hoverLane.value = laneIdx;
    });

  // ── Resize gesture (drag handle at bottom) ──
  const resizePan = Gesture.Pan()
    .enabled(!!onResize && gesturesEnabled)
    .minDistance(2)
    .onStart(() => {
      "worklet";
      isResizing.value = true;
      startBlockH.value = blockH.value;
    })
    .onUpdate((e) => {
      "worklet";
      const minH = SLOT_HEIGHT / 2 - 4; // minimum 30 minutes (0.5 hour)
      const maxH = (HOURS[HOURS.length - 1] - job.startHour) * SLOT_HEIGHT - 4;
      blockH.value = Math.max(minH, Math.min(maxH, startBlockH.value + e.translationY));
    })
    .onEnd(() => {
      "worklet";
      // Snap to nearest 30-minute increment
      const rawHours = (blockH.value + 4) / SLOT_HEIGHT;
      const snappedHours = Math.max(0.5, Math.round(rawHours * 2) / 2);
      const snappedH = snappedHours * SLOT_HEIGHT - 4;
      blockH.value = withTiming(snappedH, { duration: 120 });
      isResizing.value = false;
      const newEndHour = job.startHour + snappedHours;
      runOnJS(commitResize)(newEndHour);
    })
    .onFinalize(() => {
      "worklet";
      isResizing.value = false;
    });

  // Tap to open job detail (instant — drag is handled by the pan gesture with long-press activation)
  const tap = Gesture.Tap()
    .enabled(gesturesEnabled)
    .maxDuration(500)
    .onEnd((_e, success) => {
      "worklet";
      if (success && !isDragging.value && !isResizing.value) {
        runOnJS(onPress)();
      }
    });

  const composed = Gesture.Exclusive(pan, tap);

  const animStyle = useAnimatedStyle(() => ({
    position: "absolute" as const,
    top: blockY.value,
    left: blockX.value + 2,
    width: laneWidth - 4,
    height: blockH.value,
    zIndex: isDragging.value ? 200 : 10,
    opacity: isDragging.value ? 0.92 : 1,
    transform: [{ scale: isDragging.value ? 1.04 : 1 }],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: isDragging.value ? 12 : 2 },
    shadowOpacity: isDragging.value ? 0.35 : 0.1,
    shadowRadius: isDragging.value ? 16 : 4,
    elevation: isDragging.value ? 14 : 2,
  }));

  const totalHeight = HOURS.length * (SLOT_HEIGHT / 2);
  const hoverHighlightStyle = useAnimatedStyle(() => {
    const active = isDragging.value && hoverLane.value !== laneIdx;
    return {
      position: "absolute" as const,
      top: 0,
      left: hoverLane.value * laneWidth,
      width: laneWidth,
      height: active ? totalHeight : 0,
      backgroundColor: active ? "rgba(255,255,255,0.07)" : "transparent",
      borderWidth: active ? 1.5 : 0,
      borderColor: "rgba(255,255,255,0.3)",
      borderRadius: 4,
      zIndex: 5,
      pointerEvents: "none" as const,
      overflow: "hidden" as const,
    };
  });

  return (
    <>
      {/* Lane drop target highlight */}
      <Animated.View style={hoverHighlightStyle} />

      <GestureDetector gesture={composed}>
        <Animated.View style={[animStyle, {
          backgroundColor: detailerColor + "22",
          borderLeftWidth: 3,
          borderLeftColor: detailerColor,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.25)",
          borderRadius: 6,
          padding: 4,
          overflow: "hidden",
        }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: detailerColor, lineHeight: 14, flex: 1 }} numberOfLines={1}>
              {job.firstName} {job.lastName}
            </Text>
            {job.isNewCustomer && (
              <View style={{ backgroundColor: "#F59E0B", borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 }}>
                <Text style={{ color: "#fff", fontSize: 8, fontWeight: "800" }}>NEW</Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: 10, color: colors.muted, lineHeight: 13 }} numberOfLines={1}>
            {formatHour(job.startHour)}–{formatHour(job.endHour)}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 1 }}>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: statusColor }} />
            <Text style={{ fontSize: 9, color: statusColor, fontWeight: "600" }}>{STATUS_LABELS[job.status]}</Text>
          </View>

          {/* Resize handle at bottom */}
          {!!onResize && (
            <GestureDetector gesture={resizePan}>
              <View style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: detailerColor + "33",
                borderBottomLeftRadius: 6,
                borderBottomRightRadius: 6,
              }}>
                <View style={{ width: 24, height: 3, borderRadius: 2, backgroundColor: detailerColor + "99" }} />
              </View>
            </GestureDetector>
          )}
        </Animated.View>
      </GestureDetector>
    </>
  );
}

// ─── Dual-Lane Timeline ────────────────────────────────────────────────────────

function DualLaneTimeline({
  jobs,
  cityConfig,
  screenWidth,
  onJobPress,
  onMoveAndReassign,
  onResize,
  isAdmin,
  gesturesEnabled = true,
  selectedDayOfWeek = -1,
  onRefresh,
  refreshing = false,
}: {
  jobs: Job[];
  cityConfig: CityConfig;
  screenWidth: number;
  onJobPress: (job: Job) => void;
  onMoveAndReassign?: (jobId: string, newStartHour: number, newLaneIdx: number) => void;
  onResize?: (jobId: string, newEndHour: number) => void;
  isAdmin?: boolean;
  gesturesEnabled?: boolean;
  /** JS day-of-week (0=Sun…6=Sat) for the currently displayed day, used to gray out off-shift lanes */
  selectedDayOfWeek?: number;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const colors = useColors();
  const timelineWidth = screenWidth - 32; // 16px padding each side
  const laneAreaWidth = timelineWidth - TIME_COL_WIDTH;
  // Admin gets an extra Unassigned lane at the end
  const detailerCount = cityConfig.detailers.length;
  const laneCount = isAdmin ? detailerCount + 1 : detailerCount;
  const laneWidth = laneAreaWidth / laneCount;
  const UNASSIGNED_LANE_IDX = detailerCount; // last lane index for unassigned
  const totalHeight = HOURS.length * (SLOT_HEIGHT / 2);

  // Assign jobs to lanes based on detailer name or employeeId (if set)
  // Unassigned jobs go to the Unassigned lane (admin only) or lane 0 (detailer view)
  const getJobLane = (job: Job): number => {
    if (job.detailerName) {
      // Try matching by display name first
      const byName = cityConfig.detailers.findIndex(
        (d) => d.name.toLowerCase() === job.detailerName?.toLowerCase()
      );
      if (byName >= 0) return byName;
      // Try matching by employeeId (online bookings store employeeId in assignedTo)
      const byId = cityConfig.detailers.findIndex(
        (d) => d.employeeId === job.detailerName || d.employeeId === (job as any).assignedTo
      );
      if (byId >= 0) return byId;
    }
    // Unassigned: admin sees Unassigned lane, detailers see lane 0
    return isAdmin ? UNASSIGNED_LANE_IDX : 0;
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={{ flex: 1 }}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#0a7ea4"
            colors={["#0a7ea4"]}
          />
        ) : undefined
      }
    >
      {/* Lane headers */}
      <View style={{ flexDirection: "row", paddingLeft: TIME_COL_WIDTH, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        {cityConfig.detailers.map((det, i) => (
          <View key={i} style={{ width: laneWidth, alignItems: "center", paddingVertical: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: det.color, marginBottom: 3 }} />
            <Text style={{ fontSize: 13, fontWeight: "700", color: det.color }}>{det.name}</Text>
          </View>
        ))}
        {isAdmin && (
          <View style={{ width: laneWidth, alignItems: "center", paddingVertical: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#94a3b8", marginBottom: 3 }} />
            <Text style={{ fontSize: 13, fontWeight: "700", color: "#94a3b8" }}>Unassigned</Text>
          </View>
        )}
      </View>

      {/* Timeline grid */}
      <View style={{ flexDirection: "row" }}>
        {/* Time column */}
        <View style={{ width: TIME_COL_WIDTH }}>
          {HOURS.map((h) => (
            <View key={h} style={{ height: SLOT_HEIGHT / 2, justifyContent: "flex-start", paddingTop: 4, alignItems: "flex-end", paddingRight: 8 }}>
              <Text style={{ fontSize: 10, color: colors.muted }}>{formatHour(h)}</Text>
            </View>
          ))}
        </View>

        {/* Lanes */}
        <View style={{ flex: 1, flexDirection: "row", position: "relative" }}>
          {/* Grid lines */}
          {HOURS.map((h) => (
            <View key={h} style={{ position: "absolute", top: (h - HOURS[0]) * SLOT_HEIGHT, left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
          ))}

          {/* Lane dividers */}
          {Array.from({ length: laneCount - 1 }).map((_, i) => (
            <View
              key={i}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: laneWidth * (i + 1),
                width: StyleSheet.hairlineWidth,
                backgroundColor: i === detailerCount - 1 ? "#94a3b840" : colors.border,
              }}
            />
          ))}
          {/* Unassigned lane background tint (admin only) */}
          {isAdmin && (
            <View style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: laneWidth * UNASSIGNED_LANE_IDX,
              width: laneWidth,
              backgroundColor: "#94a3b808",
            }} />
          )}

          {/* Shift-off overlay: gray out 8 AM–5 PM for detailers not on shift today */}
          {cityConfig.detailers.map((det, i) => {
            if (selectedDayOfWeek < 0 || isDetailerOnShift(det, selectedDayOfWeek)) return null;
            const offStart = 0; // grid starts at 8 AM
            const offEnd   = HOURS.length - 1; // grid ends at 5 PM
            return (
              <View
                key={`shift-off-${i}`}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: offStart * (SLOT_HEIGHT / 2),
                  height: (offEnd - offStart) * (SLOT_HEIGHT / 2),
                  left: laneWidth * i,
                  width: laneWidth,
                  backgroundColor: "rgba(148,163,184,0.22)",
                  borderLeftWidth: 2,
                  borderRightWidth: 2,
                  borderColor: "rgba(148,163,184,0.35)",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <View style={{ backgroundColor: "rgba(148,163,184,0.85)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#fff", textAlign: "center" }}>OFF SHIFT</Text>
                  <Text style={{ fontSize: 9, color: "#fff", textAlign: "center", opacity: 0.9 }}>{det.shift === "first" ? "Fri–Sun" : "Mon–Thu"}</Text>
                </View>
              </View>
            );
          })}
          {/* All job blocks in a single shared layer for cross-lane drag */}
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: totalHeight }}>
            {jobs.map((job) => {
              const lane = getJobLane(job);
              const det = cityConfig.detailers[lane];
              // Unassigned jobs get grey color
              const jobColor = det ? det.color : "#94a3b8";
              return (
                <AdminJobBlock
                  key={job.id}
                  job={job}
                  laneIdx={lane}
                  laneCount={laneCount}
                  laneWidth={laneWidth}
                  detailerColor={jobColor}
                  onPress={() => onJobPress(job)}
                  onMoveAndReassign={onMoveAndReassign}
                  onResize={onResize}
                  gesturesEnabled={gesturesEnabled}
                />
              );
            })}
          </View>

          {/* Invisible height setter */}
          <View style={{ height: totalHeight, width: 1 }} />
        </View>
      </View>
    </ScrollView>
    </GestureHandlerRootView>
  );
}

// ─── Admin Private Notes Card Component ──────────────────────────────────────────────────────────────

function AdminPrivateNotesCard({
  job,
  onNotesChange,
}: {
  job: Job;
  onNotesChange: (notes: PrivateNote[]) => void;
}) {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const { session: jobSyncSession } = useJobSyncAuth();
  const currentEmployeeId = employee?.employeeId ?? "ADMIN";
  const currentEmployeeName = employee?.fullName ?? "Admin";
  const currentRole = employee?.role ?? "admin";
  const isJobSyncCompany = jobSyncSession?.portal === "company";

  const [newNoteText, setNewNoteText] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);

  const notes: PrivateNote[] = job.privateNotes ?? [];
  const isAdmin = ["admin", "office", "operations_manager"].includes(currentRole);

  // Private-note mutations still target the legacy local endpoint. Do not expose
  // this card to Company sessions until an equivalent bearer-authenticated HSC
  // notes contract is published.
  if (isJobSyncCompany) return null;

  const addNote = async () => {
    const text = newNoteText.trim();
    if (!text || !job.id) return;
    // Optimistic update: show the note immediately with a temp ID
    const tempId = `temp_${Date.now()}`;
    const optimisticNote: PrivateNote = {
      id: tempId,
      text,
      authorId: currentEmployeeId,
      authorName: currentEmployeeName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    onNotesChange([...notes, optimisticNote]);
    setNewNoteText("");
    setSaving(true);
    try {
      const resp = await fetch(
        `${APP_API_BASE}/api/trpc/jobs.addPrivateNote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ json: { jobId: job.id, authorId: currentEmployeeId, authorName: currentEmployeeName, text } }),
        }
      );
      const data = await resp.json();
      const note: PrivateNote = data?.result?.data?.note;
      if (note) {
        // Replace the temp note with the real one from the server
        onNotesChange([...notes, note]);
      }
    } catch { /* optimistic note already shown, fail silently */ } finally { setSaving(false); }
  };

  const saveEdit = async (noteId: string) => {
    const text = editText.trim();
    if (!text) return;
    setSaving(true);
    try {
      await fetch(
        `${APP_API_BASE}/api/trpc/jobs.editPrivateNote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ json: { jobId: job.id, noteId, requesterId: currentEmployeeId, newText: text } }),
        }
      );
      onNotesChange(notes.map((n) => n.id === noteId ? { ...n, text, updatedAt: new Date().toISOString() } : n));
      setEditingNoteId(null);
    } catch { /* fail silently */ } finally { setSaving(false); }
  };

  const deleteNote = (noteId: string) => {
    Alert.alert("Delete Note", "Remove this note?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          try {
            await fetch(
              `${APP_API_BASE}/api/trpc/jobs.deletePrivateNote`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ json: { jobId: job.id, noteId, requesterId: currentEmployeeId, requesterRole: currentRole } }),
              }
            );
            onNotesChange(notes.filter((n) => n.id !== noteId));
          } catch { /* fail silently */ }
        },
      },
    ]);
  };

  return (
    <View style={{ backgroundColor: colors.background, borderRadius: 0, borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 0, borderRightWidth: 0, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 8, borderColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <Text style={{ fontSize: 14 }}>📄</Text>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>Private Notes</Text>
        <View style={{ backgroundColor: colors.surface, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "600" }}>INTERNAL</Text>
        </View>
      </View>

      {notes.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 12 }}>No notes yet.</Text>
      ) : (
        <View style={{ gap: 10, marginBottom: 12 }}>
          {notes.map((note) => {
            const isAuthor = note.authorId === currentEmployeeId;
            const canEdit = isAuthor;
            const canDelete = isAuthor || isAdmin;
            const isEditing = editingNoteId === note.id;
            return (
              <View key={note.id} style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.border }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <View>
                    <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{note.authorName}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>{new Date(note.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago" })}{note.updatedAt !== note.createdAt ? " (edited)" : ""}</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {canEdit && !isEditing && (
                      <TouchableOpacity onPress={() => { setEditingNoteId(note.id); setEditText(note.text); }} activeOpacity={0.7}>
                        <Text style={{ color: colors.primary, fontSize: 12 }}>Edit</Text>
                      </TouchableOpacity>
                    )}
                    {canDelete && (
                      <TouchableOpacity onPress={() => deleteNote(note.id)} activeOpacity={0.7}>
                        <Text style={{ color: "#EF4444", fontSize: 12 }}>Delete</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                {isEditing ? (
                  <View style={{ gap: 6 }}>
                    <TextInput
                      value={editText}
                      onChangeText={setEditText}
                      multiline
                      style={{ color: colors.foreground, fontSize: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, minHeight: 60, backgroundColor: colors.background }}
                    />
                    <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
                      <TouchableOpacity onPress={() => setEditingNoteId(null)} activeOpacity={0.7} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
                        <Text style={{ color: colors.muted, fontSize: 13 }}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => saveEdit(note.id)} activeOpacity={0.7} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primary }} disabled={saving}>
                        <Text style={{ color: "#FFF", fontSize: 13, fontWeight: "600" }}>{saving ? "Saving..." : "Save"}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 19 }}>{note.text}</Text>
                )}
              </View>
            );
          })}
        </View>
      )}

      <View style={{ gap: 8 }}>
        <TextInput
          value={newNoteText}
          onChangeText={setNewNoteText}
          placeholder="Add a private note..."
          placeholderTextColor={colors.muted}
          multiline
          returnKeyType="done"
          style={{ color: colors.foreground, fontSize: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, minHeight: 56, backgroundColor: colors.surface }}
        />
        <TouchableOpacity
          onPress={addNote}
          activeOpacity={0.75}
          disabled={!newNoteText.trim() || saving}
          style={{ backgroundColor: newNoteText.trim() ? colors.primary : colors.surface, borderRadius: 10, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: newNoteText.trim() ? colors.primary : colors.border }}
        >
          <Text style={{ color: newNoteText.trim() ? "#FFF" : colors.muted, fontWeight: "600", fontSize: 14 }}>{saving ? "Posting..." : "Post Note"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}


// ─── CustomerSearchField ──────────────────────────────────────────────────────
function CustomerSearchField({
  colors,
  value,
  onChange,
  showDropdown,
  setShowDropdown,
  onSelect,
  companyCustomers,
}: {
  colors: any;
  value: string;
  onChange: (v: string) => void;
  showDropdown: boolean;
  setShowDropdown: (v: boolean) => void;
  onSelect: (c: { id?: number; fullName: string; phone: string | null; email: string | null; address: string | null }) => void;
  companyCustomers?: JobSyncCompanyCustomer[];
}) {
  const [query, setQuery] = React.useState(value);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchTerm, setSearchTerm] = React.useState("");

  const { data: results = [] } = trpc.customers.listAll.useQuery(
    { search: searchTerm },
    { enabled: !companyCustomers && searchTerm.length >= 2, staleTime: 10_000 }
  );
  const visibleResults = companyCustomers
    ? companyCustomers
      .filter((customer) => {
        const normalized = searchTerm.trim().toLowerCase();
        return normalized.length >= 2 && [customer.name, customer.email, customer.phone, customer.addressLine1].some((part) => part?.toLowerCase().includes(normalized));
      })
      .slice(0, 8)
      .map((customer) => ({ id: customer.id, fullName: customer.name, phone: customer.phone, email: customer.email, address: customer.addressLine1 }))
    : results as Array<{ id?: number; fullName: string; phone: string | null; email: string | null; address: string | null }>;

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
      {showDropdown && visibleResults.length > 0 && (
        <View style={{ position: "absolute", top: 50, left: 0, right: 0, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, maxHeight: 200, overflow: "hidden", elevation: 8, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}>
          <ScrollView keyboardShouldPersistTaps="always" nestedScrollEnabled>
            {visibleResults.map((c, i: number) => (
              <TouchableOpacity
                key={c.id || i}
                onPress={() => { setQuery(c.fullName); onSelect(c); }}
                style={{ paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: i < Math.min(results.length, 8) - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}
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

// ─── DropdownTimePicker ───────────────────────────────────────────────────────
// 30-min slots: 8:00, 8:30, ..., 17:00 (19 slots)
const PICK_HOURS = Array.from({ length: 19 }, (_, i) => 8 + i * 0.5); // 8:00 AM – 5:00 PM

function DragTimePicker({
  colors,
  startHour,
  endHour,
  onStartChange,
  onEndChange,
  formatHour,
  blockedHours,
}: {
  colors: any;
  startHour: number;
  endHour: number;
  onStartChange: (h: number) => void;
  onEndChange: (h: number) => void;
  formatHour: (h: number) => string;
  blockedHours?: Set<number>;
}) {
  const [showStart, setShowStart] = React.useState(false);
  const [showEnd, setShowEnd] = React.useState(false);

  const duration = endHour - startHour;
  const durationLabel = duration % 1 !== 0 ? `${Math.floor(duration)}h 30m` : `${duration}h`;

  const TimeDropdown = ({
    visible,
    onClose,
    selected,
    onSelect,
    minHour,
  }: {
    visible: boolean;
    onClose: () => void;
    selected: number;
    onSelect: (h: number) => void;
    minHour?: number;
  }) => (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} activeOpacity={1} onPress={onClose}>
        <View style={{ position: "absolute", top: "30%", left: 40, right: 40, backgroundColor: colors.surface, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15 }}>Select Time</Text>
            {blockedHours && blockedHours.size > 0 && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error }} />
                <Text style={{ color: colors.muted, fontSize: 11 }}>= Booked</Text>
              </View>
            )}
          </View>
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {PICK_HOURS.map((h) => {
              const isBlocked = blockedHours?.has(h) ?? false;
              const isBelowMin = minHour !== undefined && h <= minHour;
              const disabled = isBlocked || isBelowMin;
              const sel = h === selected;
              return (
                <TouchableOpacity
                  key={h}
                  onPress={() => { if (!disabled) { onSelect(h); onClose(); } }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: 20,
                    paddingVertical: 14,
                    backgroundColor: isBlocked ? colors.error + "18" : sel ? colors.primary + "22" : "transparent",
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                    opacity: isBelowMin ? 0.3 : 1,
                  }}
                  activeOpacity={disabled ? 1 : 0.7}
                >
                  <Text style={{ color: isBlocked ? colors.error : sel ? colors.primary : colors.foreground, fontWeight: sel ? "700" : "400", fontSize: 16, textDecorationLine: isBlocked ? "line-through" : "none" }}>
                    {formatHour(h)}
                  </Text>
                  {isBlocked && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.error }} />
                      <Text style={{ color: colors.error, fontSize: 12, fontWeight: "600" }}>Booked</Text>
                    </View>
                  )}
                  {sel && !isBlocked && <Text style={{ color: colors.primary, fontSize: 18 }}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Time</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {/* Start dropdown */}
        <TouchableOpacity
          onPress={() => setShowStart(true)}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 14 }}
          activeOpacity={0.7}
        >
          <View>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>START</Text>
            <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 16 }}>{formatHour(startHour)}</Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 16 }}>▼</Text>
        </TouchableOpacity>
        {/* End dropdown */}
        <TouchableOpacity
          onPress={() => setShowEnd(true)}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 14 }}
          activeOpacity={0.7}
        >
          <View>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>END</Text>
            <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 16 }}>{formatHour(endHour)}</Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 16 }}>▼</Text>
        </TouchableOpacity>
      </View>
      {/* Duration summary */}
      <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 8, gap: 6 }}>
        <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>{formatHour(startHour)}</Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>→</Text>
        <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>{formatHour(endHour)}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>({durationLabel})</Text>
      </View>
      <TimeDropdown
        visible={showStart}
        onClose={() => setShowStart(false)}
        selected={startHour}
        onSelect={(h) => {
          onStartChange(h);
          if (h >= endHour) {
            const nextEnd = PICK_HOURS.find((e) => e > h && !(blockedHours?.has(e) ?? false));
            if (nextEnd !== undefined) onEndChange(nextEnd);
          }
        }}
      />
      <TimeDropdown
        visible={showEnd}
        onClose={() => setShowEnd(false)}
        selected={endHour}
        onSelect={onEndChange}
        minHour={startHour}
      />
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AdminScheduleScreen() {
  const colors = useColors();
  const utils = trpc.useUtils();
  const { employee: currentEmployee } = useEmployeeAuth();
  const { session: jobSyncSession, isLoading: jobSyncLoading } = useJobSyncAuth();
  const { revision: companySyncRevision } = useJobSyncSync();
  const companyAuthority = resolveCompanyJobAuthority({ session: jobSyncSession, sessionLoading: jobSyncLoading });
  const isJobSyncCompany = usesCompanyJobAuthority(companyAuthority);
  const allowLegacyJobAuthority = allowsLegacyJobAuthority(companyAuthority);
  const companyPriceBook = useCompanyPriceBook();
  const [companyCustomers, setCompanyCustomers] = useState<JobSyncCompanyCustomer[]>([]);
  const [companyCustomersError, setCompanyCustomersError] = useState<string | null>(null);
  const { highlightBookingId, prefillFirst, prefillLast, prefillPhone, prefillEmail, prefillAddress } = useLocalSearchParams<{
    highlightBookingId?: string;
    prefillFirst?: string;
    prefillLast?: string;
    prefillPhone?: string;
    prefillEmail?: string;
    prefillAddress?: string;
  }>();
  const prefillHandledRef = React.useRef<string | null>(null);
  const addModalScrollRef = React.useRef<import('react-native').ScrollView>(null);
  const jobUpsertMutation = trpc.jobs.upsert.useMutation();
  const jobDeleteMutation = trpc.jobs.delete.useMutation();
  const jobCancelMutation = trpc.jobs.cancel.useMutation();
  const jobDeleteRecurringMutation = trpc.jobs.deleteRecurringSeries.useMutation();
  const jobCancelRecurringMutation = trpc.jobs.cancelRecurringSeries.useMutation();
  const jobReassignMutation = trpc.jobs.reassign.useMutation();
  const jobMetaMutation = trpc.jobs.updateMeta.useMutation();
  const jobStatusMutation = trpc.jobs.updateStatus.useMutation();
  // ── Edit Address ──
  const [showEditAddressModal, setShowEditAddressModal] = useState(false);
  const [editAddressDraft, setEditAddressDraft] = useState("");
  const [savingAddress, setSavingAddress] = useState(false);
  const jobSavePaymentMutation = trpc.jobs.savePayment.useMutation({
    onError: (err) => {
      Alert.alert(
        "⚠️ Payment Record Error",
        "The payment was collected but could not be saved to the server. Please manually record this payment in the Unpaid Jobs screen.\n\nError: " + (err.message ?? "Unknown error"),
        [{ text: "OK" }]
      );
    },
  });
  const performanceUpsertMutation = trpc.performance.upsert.useMutation();
  const { data: localPbServices = [] } = trpc.pricebook.list.useQuery(undefined, { enabled: allowLegacyJobAuthority, staleTime: 300000 });
  const pbServices = isJobSyncCompany ? companyPriceBook.services : localPbServices;
  // ── Schedule Blockers ──
  const blockerCreateMutation = trpc.scheduleBlockers.create.useMutation();
  const blockerDeleteMutation = trpc.scheduleBlockers.delete.useMutation();
  const [blockers, setBlockers] = useState<Array<{ id: string; detailerName: string; city: string; date: string; startHour: number; endHour: number; allDay: number; reason: string }>>([]);
  const [showBlockerModal, setShowBlockerModal] = useState(false);
  const [blockerDetailer, setBlockerDetailer] = useState("");
  const [blockerDate, setBlockerDate] = useState("");
  const [blockerAllDay, setBlockerAllDay] = useState(true);
  const [blockerStartHour, setBlockerStartHour] = useState(8);
  const [blockerEndHour, setBlockerEndHour] = useState(17);
  const [blockerReason, setBlockerReason] = useState("Day Off");
  const [showBlockerDatePicker, setShowBlockerDatePicker] = useState(false);
  const [selectedBlocker, setSelectedBlocker] = useState<string | null>(null);
  // Build all packages from price book for the New Job form (falls back to hardcoded PACKAGES if empty)
  // Preferred display order for non-RV packages: Luxury → Full → Basic → Interior → Exterior
  const PREFERRED_ORDER = ["luxury", "full", "basic", "interior", "exterior"];
  function pkgSortKey(id: string): number {
    const normalized = id.replace(/^pb_/, "").replace(/_detail$/, "");
    const idx = PREFERRED_ORDER.findIndex(k => normalized.includes(k));
    return idx === -1 ? 99 : idx;
  }
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
            sedan: vp.sedan ?? s.basePrice ?? 0,
            suv: vp.suv ?? s.basePrice ?? 0,
            xl_suv_van: vp.xl_suv_van ?? s.basePrice ?? 0,
            truck: vp.truck ?? s.basePrice ?? 0,
            rv_20_29: vp.rv_20_29 ?? 0,
            rv_30_39: vp.rv_30_39 ?? 0,
            rv_40_plus: vp.rv_40_plus ?? 0,
          } as Partial<Record<VehicleType, number>>,
        };
      }).sort((a, b) => {
        // RV packages always go last
        if (a.isRv !== b.isRv) return a.isRv ? 1 : -1;
        return pkgSortKey(a.id) - pkgSortKey(b.id);
      })
    : isJobSyncCompany ? [] : PACKAGES;
  const rvPackages = allJobPackages.filter((p) => p.isRv);
  const [showReassignPicker, setShowReassignPicker] = useState(false);
  const [showMoveCityPicker, setShowMoveCityPicker] = useState(false);
  const [movingToCity, setMovingToCity] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showInvoiceSheet, setShowInvoiceSheet] = useState(false);
  // ── Charge Card on File state ──
  const [showChargeModal, setShowChargeModal] = useState(false);
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargingCard, setChargingCard] = useState(false);
  const [selectedChargeCardId, setSelectedChargeCardId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  // Build customerKey from selectedJob for savedCards query
  const scheduleCustomerKey = selectedJob
    ? selectedJob.email
      ? `email:${selectedJob.email.toLowerCase()}`
      : selectedJob.phone
      ? `phone:${selectedJob.phone}`
      : `name:${(selectedJob.firstName + " " + selectedJob.lastName).toLowerCase().trim()}`
    : "";
  const { data: scheduleSavedCards, refetch: refetchScheduleCards } = trpc.savedCards.list.useQuery(
    { customerKey: scheduleCustomerKey },
    { enabled: !!scheduleCustomerKey && showChargeModal }
  );
  const scheduleChargeCardMutation = trpc.savedCards.chargeCard.useMutation({
    onSuccess: (data) => {
      setChargingCard(false);
      setShowChargeModal(false);
      setChargeAmount("");
      if ((Platform.OS as string) !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const amt = parseFloat(chargeAmount) || 0;
      Alert.alert("Payment Successful ✅", `Card charged $${amt.toFixed(2)} successfully.\n\nPayment ID: ${data.paymentIntentId?.slice(-8) ?? "—"}`);
    },
    onError: (e) => { setChargingCard(false); Alert.alert("Charge Failed", e.message); },
  });
  // ── Refund state ──
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const [refundReason, setRefundReason] = useState<"duplicate" | "fraudulent" | "requested_by_customer">("requested_by_customer");
  const [refundLoading, setRefundLoading] = useState(false);
  const refundMutation = trpc.stripe.refundPayment.useMutation();
  const { data: refundHistory = [] } = trpc.stripe.listRefunds.useQuery(
    { jobId: selectedJob?.id },
    { enabled: !!selectedJob?.id && !!selectedJob?.payment?.paymentIntentId }
  );
  const [invoiceMethod, setInvoiceMethod] = useState<"email" | "sms">("email");
  const [invoiceSending, setInvoiceSending] = useState(false);
  const [invoiceSentUrl, setInvoiceSentUrl] = useState<string | null>(null);
  const [invoiceRemainingOnly, setInvoiceRemainingOnly] = useState(false);
  const [invoiceOverrideContact, setInvoiceOverrideContact] = useState<string>("");
  const [sendingJobReceipt, setSendingJobReceipt] = useState(false);
  const sendJobReceiptMutation = trpc.jobs.sendReceipt.useMutation();
  // Enhanced job detail state
  const [adminPrivateNotes, setAdminPrivateNotes] = useState("");
  const [adminEditingNotes, setAdminEditingNotes] = useState(false);
  const [adminTagInput, setAdminTagInput] = useState("");
  const [adminPhotoPreview, setAdminPhotoPreview] = useState<string | null>(null);
  const [adminEditingTax, setAdminEditingTax] = useState(false);
  const [adminTaxInput, setAdminTaxInput] = useState("");
  const [adminEditingDiscount, setAdminEditingDiscount] = useState(false);
  const [adminDiscountInput, setAdminDiscountInput] = useState("");
  const [adminDiscountCodeInput, setAdminDiscountCodeInput] = useState("");
  const [adminDiscountType, setAdminDiscountType] = useState<"fixed" | "percent">("fixed");
  const [adminEditingDeposit, setAdminEditingDeposit] = useState(false);
  const [adminDepositInput, setAdminDepositInput] = useState("");
  const [showCustomerHistory, setShowCustomerHistory] = useState(true);
  // Edit time & date
  const [adminEditingTime, setAdminEditingTime] = useState(false);
  const [adminEditStartHour, setAdminEditStartHour] = useState(8);
  const [adminEditEndHour, setAdminEditEndHour] = useState(10);
  const [adminEditDate, setAdminEditDate] = useState<string>(""); // YYYY-MM-DD
  const [adminRescheduleNotify, setAdminRescheduleNotify] = useState(false); // notify customer on reschedule
  const dateStripScrollRef = useRef<ScrollView>(null);
  // Edit package
  const [adminEditingPackage, setAdminEditingPackage] = useState(false);
  // Edit service price (manual override)
  const [adminEditingPrice, setAdminEditingPrice] = useState(false);
  const [adminPriceInput, setAdminPriceInput] = useState("");
  const [customerHistory, setCustomerHistory] = useState<Job[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [companyJobsError, setCompanyJobsError] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(todayDayIndex());
  const [selectedCity, setSelectedCity] = useState<CitySlug>("crestview");
  const [screenWidth, setScreenWidth] = useState(375);

  // Add Job state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addFirstName, setAddFirstName] = useState("");
  const [addLastName, setAddLastName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addAddress, setAddAddress] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCompanyCustomerId, setSelectedCompanyCustomerId] = useState<number | null>(null);
  const [addonsExpanded, setAddonsExpanded] = useState(false);
  const [addService, setAddService] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [addStartHour, setAddStartHour] = useState(8);
  const [addEndHour, setAddEndHour] = useState(10);
  const [addDetailer, setAddDetailer] = useState("");
  const [addVehicleType, setAddVehicleType] = useState<VehicleType | undefined>(undefined);
  const [addPackageId, setAddPackageId] = useState<string | undefined>(undefined);
  const [addCustomPrice, setAddCustomPrice] = useState<string>(""); // per-booking price override (admin only)
  const [showCustomPriceInput, setShowCustomPriceInput] = useState(false);
  // Custom package (admin-created, not from price book)
  const [addCustomPackageName, setAddCustomPackageName] = useState("");
  const [addCustomPackageDesc, setAddCustomPackageDesc] = useState("");
  const [addCustomPackagePrice, setAddCustomPackagePrice] = useState("");
  const [showCustomPackageForm, setShowCustomPackageForm] = useState(false);
  const [addAddonIds, setAddAddonIds] = useState<string[]>([]);
  const [addAddonQtys, setAddAddonQtys] = useState<Record<string, number>>({});
  const [addRvSealantFeet, setAddRvSealantFeet] = useState<string>("");
  // Additional vehicles for multi-vehicle jobs
  const [addExtraVehicles, setAddExtraVehicles] = useState<AdditionalVehicle[]>([]);
  const [addRecurrenceRule, setAddRecurrenceRule] = useState<RecurrenceRule | null>(null);
  const [showRecurrencePicker, setShowRecurrencePicker] = useState(false);
  const [addNotifyCustomer, setAddNotifyCustomer] = useState(true);
  const [addIsNewCustomer, setAddIsNewCustomer] = useState(false);
  const [addDiscountType, setAddDiscountType] = useState<"fixed" | "percent">("fixed");
  const [addDiscountInput, setAddDiscountInput] = useState("");
  const [addDiscountCode, setAddDiscountCode] = useState("");
  const [addJobDate, setAddJobDate] = useState<string>("");
  const [showAddDatePicker, setShowAddDatePicker] = useState(false);
  const [syncKey, setSyncKey] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  // Dynamic detailers — fetched from server so new hires appear automatically
  const [dynamicDetailers, setDynamicDetailers] = useState<Record<string, DetailerEntry[]>>({});
  const [detailersLoaded, setDetailersLoaded] = useState<Record<string, boolean>>({});
  // Ref always holds latest dynamicDetailers so syncServerJobs closure is never stale
  const dynamicDetailersRef = React.useRef<Record<string, DetailerEntry[]>>({});
  useEffect(() => { dynamicDetailersRef.current = dynamicDetailers; }, [dynamicDetailers]);

  // Add vehicle to existing job
  const [showAddVehicleToJob, setShowAddVehicleToJob] = useState(false);
  const [addVehicleToJobType, setAddVehicleToJobType] = useState<VehicleType | undefined>(undefined);
  const [addVehicleToJobPkgId, setAddVehicleToJobPkgId] = useState<string | undefined>(undefined);
  const [addVehicleToJobAddonIds, setAddVehicleToJobAddonIds] = useState<string[]>([]);
  const [addVehicleToJobAddonQtys, setAddVehicleToJobAddonQtys] = useState<Record<string, number>>({});
  const [addVehicleToJobYear, setAddVehicleToJobYear] = useState("");
  const [addVehicleToJobMake, setAddVehicleToJobMake] = useState("");
  const [addVehicleToJobModel, setAddVehicleToJobModel] = useState("");
  const [addVehicleToJobColor, setAddVehicleToJobColor] = useState("");
  const [addVehicleToJobSaving, setAddVehicleToJobSaving] = useState(false);
  const appendVehicleToJobMutation = trpc.jobs.appendVehicleToJob.useMutation();
  const removeVehicleFromJobMutation = trpc.jobs.removeVehicleFromJob.useMutation();
  const updateAdditionalVehiclePackageMutation = trpc.jobs.updateAdditionalVehiclePackage.useMutation();
  const [editingVehicleIdx, setEditingVehicleIdx] = useState<number | null>(null);

  // Edit Add-ons sheet — for adding/removing addons on an existing job vehicle
  const [showEditAddonsSheet, setShowEditAddonsSheet] = useState(false);
  const [editAddonsVehicleIdx, setEditAddonsVehicleIdx] = useState<number>(-1); // -1 = primary
  const [editAddonsIds, setEditAddonsIds] = useState<string[]>([]);
  const [editAddonsQtys, setEditAddonsQtys] = useState<Record<string, number>>({});
  const [editAddonsSaving, setEditAddonsSaving] = useState(false);
  const updateJobAddonsMutation = trpc.jobs.updateJobAddons.useMutation();

  // Address location photos
  const [addressPhotos, setAddressPhotos] = useState<any[]>([]);
  const [viewingAddrPhoto, setViewingAddrPhoto] = useState<string | null>(null);
  const [addrPhotoUploading, setAddrPhotoUploading] = useState(false);
  const uploadAddrPhotoMutation = trpc.jobs.uploadAddressPhoto.useMutation();
  const deleteAddrPhotoMutation = trpc.jobs.deleteAddressPhoto.useMutation();

  const handleAddAddressPhoto = async () => {
    if (!selectedJob) return;
    if (addressPhotos.length >= 2) { Alert.alert("Limit Reached", "Maximum 2 photos per address."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.7 });
    if (result.canceled || !result.assets[0]?.base64) return;
    setAddrPhotoUploading(true);
    try {
      const asset = result.assets[0];
      const addressKey = selectedJob.address.trim().toLowerCase().replace(/\s+/g, "-");
      const res = await uploadAddrPhotoMutation.mutateAsync({ addressKey, base64: asset.base64!, mimeType: asset.mimeType ?? "image/jpeg", uploadedBy: currentEmployee?.fullName, uploadedByRole: "admin" });
      if (res.success && res.photos) setAddressPhotos(res.photos);
    } catch (e: any) { Alert.alert("Upload Failed", e.message ?? "Could not upload photo."); }
    setAddrPhotoUploading(false);
  };

  const handleDeleteAddressPhoto = (photoId: string) => {
    Alert.alert("Delete Photo", "Remove this location photo?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        await deleteAddrPhotoMutation.mutateAsync({ photoId });
        setAddressPhotos(prev => prev.filter(p => p.photoId !== photoId));
      }},
    ]);
  };

  const forceSync = useCallback(() => {
    // Invalidate tRPC cache so the next fetch bypasses any stale cached response
    utils.jobs.listByLocation.invalidate().catch(() => {});
    setSyncKey((k) => k + 1);
  }, [utils]);

  useEffect(() => {
    let cancelled = false;
    if (!showAddModal || !isJobSyncCompany || !jobSyncSession?.token) {
      if (!isJobSyncCompany) {
        setCompanyCustomers([]);
        setCompanyCustomersError(null);
      }
      return () => { cancelled = true; };
    }
    void getJobSyncCompanyCustomers(jobSyncSession.token)
      .then((customers) => { if (!cancelled) { setCompanyCustomers(customers); setCompanyCustomersError(null); } })
      .catch((error) => { if (!cancelled) setCompanyCustomersError(error instanceof Error ? error.message : "Home Service Connected could not load Company customers."); });
    return () => { cancelled = true; };
  }, [showAddModal, isJobSyncCompany, jobSyncSession?.token]);

  // Fetch blockers for the current week whenever city or week changes
  useEffect(() => {
    const fetchBlockers = async () => {
      const wDates = getWeekDates(weekOffset);
      const fromDate = wDates[0];
      const toDate = wDates[6];
      const startDate = localDateStr(fromDate);
      const endDate = localDateStr(toDate);
      try {
        const data = await utils.scheduleBlockers.list.fetch({ city: selectedCity, startDate, endDate });
        setBlockers(data.map((b) => ({ ...b, startHour: parseFloat(String(b.startHour)), endHour: parseFloat(String(b.endHour)), allDay: Number(b.allDay) })));
      } catch (_) {}
    };
    fetchBlockers();
  }, [selectedCity, syncKey, weekOffset]);

  // Live-refresh photo URLs from the server whenever a job detail panel is opened
  useEffect(() => {
    if (!selectedJob) return;
    const jobId = selectedJob.id;
    utils.jobs.getPhotos.fetch({ jobId })
      .then(({ urls }) => {
        if (!urls || urls.length === 0) return;
        setSelectedJob((prev) => {
          if (!prev || prev.id !== jobId) return prev;
          // Only update if server has more/different photos
          const existing = JSON.stringify(prev.photoUrls ?? []);
          const incoming = JSON.stringify(urls);
          if (existing === incoming) return prev;
          return { ...prev, photoUrls: urls };
        });
        setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, photoUrls: urls } : j));
      })
      .catch(() => { /* ignore — offline or job not found */ });
  }, [selectedJob?.id]);

  // Per-employee storage key: prevents cross-user cache leakage
  const STORAGE_KEY = `${STORAGE_KEY_BASE}_${currentEmployee?.employeeId || 'admin'}`;
  const storageKeyRef = useRef(STORAGE_KEY);
  storageKeyRef.current = STORAGE_KEY;

  useEffect(() => {
    if (!allowLegacyJobAuthority) return;
    const key = `${STORAGE_KEY_BASE}_${currentEmployee?.employeeId || 'admin'}`;
    AsyncStorage.getItem(key).then((raw) => {
      if (raw) { try { setJobs(JSON.parse(raw)); } catch {} }
    });
    // Clear old shared cache key
    AsyncStorage.removeItem('tlw_schedule_jobs_v8').catch(() => {});
  }, [allowLegacyJobAuthority, currentEmployee?.employeeId]);

  // Never hydrate a JobSync Company calendar from the legacy global location
  // endpoint. Its authenticated bearer roster is the single source of truth.
  useEffect(() => {
    if (!isJobSyncCompany) return;
    const token = jobSyncSession?.token;
    const companyId = jobSyncSession?.company?.id;
    if (!token || !companyId) return;
    let cancelled = false;

    setDetailersLoaded((previous) => ({ ...previous, [selectedCity]: false }));
    getJobSyncCompanyMembers(token, companyId)
      .then((roster) => {
        if (cancelled) return;
        const teamLanes: DetailerEntry[] = roster.members.map((member, index) => ({
          employeeId: `jobsync-${member.id}`,
          name: member.name,
          color: DETAILER_COLORS[index % DETAILER_COLORS.length],
        }));
        setDynamicDetailers({ [selectedCity]: teamLanes });
      })
      .catch(() => {
        if (!cancelled) setDynamicDetailers({ [selectedCity]: [] });
      })
      .finally(() => {
        if (!cancelled) setDetailersLoaded((previous) => ({ ...previous, [selectedCity]: true }));
      });

    return () => { cancelled = true; };
  }, [isJobSyncCompany, jobSyncSession?.token, jobSyncSession?.company?.id, selectedCity, syncKey]);

  // Sync all jobs (manual + online) from server DB when city changes or manual refresh
  useEffect(() => {
    if (!allowLegacyJobAuthority) {
      const token = jobSyncSession?.token;
      if (!isJobSyncCompany || !token) {
        setJobs([]);
        setCompanyJobsError(COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
        return;
      }
      const syncCompanyJobs = async () => {
        setIsSyncing(true);
        try {
          const today = new Date();
          const start = new Date(today); start.setDate(today.getDate() - 365);
          const end = new Date(today); end.setDate(today.getDate() + 365);
          const serverJobs = await getJobSyncCompanyJobs(token, { start: start.toISOString(), end: end.toISOString() });
          const mappedJobs = serverJobs.filter((job) => job.status !== "cancelled").map((job) => ({
            ...mapCanonicalJobToScheduleFields(job, selectedCity),
            email: undefined,
          }) as Job);
          setCompanyJobsError(null);
          setJobs(mappedJobs);
        } catch (error) {
          setJobs([]);
          setCompanyJobsError(companyCanonicalReadError(error));
        } finally { setIsSyncing(false); }
      };
      void syncCompanyJobs();
      return;
    }
    const syncServerJobs = async () => {
      setIsSyncing(true);
      try {
        const today = new Date();
        // No lookback limit — fetch all historical and future jobs
        const startDate = "2020-01-01";
        const toDate = new Date(today);
        toDate.setDate(today.getDate() + 365);
        const endDate = localDateStr(toDate);
        const serverJobs = await utils.jobs.listByLocation.fetch({ location: selectedCity, startDate, endDate });
        const mappedJobs: Job[] = serverJobs.map((sj: any) => {
          const bookingDate = parseLocalDate(sj.date);
          // Mon-based day index: 0=Mon…6=Sun
          const dayOfWeek = (bookingDate.getDay() + 6) % 7;
          const todayMonday = new Date();
          todayMonday.setDate(todayMonday.getDate() - (todayMonday.getDay() + 6) % 7);
          todayMonday.setHours(0, 0, 0, 0);
          const bookingMonday = new Date(bookingDate);
          bookingMonday.setDate(bookingDate.getDate() - dayOfWeek);
          bookingMonday.setHours(0, 0, 0, 0);
          const diffMs = bookingMonday.getTime() - todayMonday.getTime();
          const wOffset = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
          const nameParts = (sj.customerName || "").split(" ");
          // Resolve assignedTo (may be employeeId like "DET_LAMONT" or display name like "Lamont")
          // Try to find the matching detailer display name from dynamic detailers
          const allDetailers: DetailerEntry[] = Object.values(dynamicDetailersRef.current).flat();
          let resolvedDetailerName: string | undefined = sj.assignedTo || undefined;
          if (sj.assignedTo) {
            const match = allDetailers.find(
              (d) => d.employeeId === sj.assignedTo || d.name.toLowerCase() === (sj.assignedTo as string).toLowerCase()
            );
            if (match) resolvedDetailerName = match.name;
          }
          return {
            id: sj.jobId,
            isOnlineBooking: (sj as any).source === "online" || (sj as any).source === "portal_app",
            bookingId: sj.bookingId || undefined,
            location: sj.location,
            firstName: nameParts[0] || "",
            lastName: nameParts.slice(1).join(" ") || "",
            email: sj.customerEmail || undefined,
            phone: sj.customerPhone || "",
            address: sj.customerAddress || "",
            serviceTitle: (() => {
              const resolvedPkgId = resolvePackageId(sj.packageType);
              const pkg = resolvedPkgId ? PACKAGES.find(p => p.id === resolvedPkgId) : null;
              return pkg ? pkg.title : (sj.packageType || "Detail Service");
            })(),
            serviceDescription: sj.serviceDescription || "",
            price: sj.customPrice != null ? parseFloat(String(sj.customPrice)) : parseFloat(sj.totalPrice || "0"),
            customPrice: sj.customPrice != null ? parseFloat(String(sj.customPrice)) : undefined,
            startHour: sj.startHour != null ? parseFloat(String(sj.startHour)) : 8,
            endHour: sj.endHour != null ? parseFloat(String(sj.endHour)) : 10,
            dayIndex: dayOfWeek,
            weekOffset: wOffset,
            status: (sj.status === "completed" ? "finished" : sj.status === "in_progress" ? "started" : sj.status === "cancelled" ? "cancelled" : "scheduled") as JobStatus,
            _rawStatus: sj.status,
            notes: sj.notes || undefined,
            detailerName: resolvedDetailerName,
            assignedTo: sj.assignedTo || undefined,
            createdAt: sj.createdAt ? new Date(sj.createdAt).toISOString() : new Date().toISOString(),
            vehicleType: resolveVehicleType(sj.vehicleType),
            packageId: resolvePackageId(sj.packageType) || undefined,
            addonIds: parseAddonIds(sj.selectedAddons),
            addonQtys: sj.addonQtys ? (() => { try { return JSON.parse(sj.addonQtys); } catch { return {}; } })() : {},
            vehicleColor: sj.vehicleColor || undefined,
            vehicleYear: sj.vehicleYear || undefined,
            vehicleMake: sj.vehicleMake || undefined,
            vehicleModel: sj.vehicleModel || undefined,
            additionalVehicles: sj.additionalVehicles ? JSON.parse(sj.additionalVehicles) : undefined,
            tags: sj.tags ? JSON.parse(sj.tags) : undefined,
            privateNotes: sj.privateNotes ? (() => { try { const p = JSON.parse(sj.privateNotes); return Array.isArray(p) ? p : undefined; } catch { return undefined; } })() : undefined,
            leadSource: sj.leadSource || ((sj as any).source === "portal_app" ? "Portal App Booking" : (sj as any).source === "online" ? "Website Booking" : "Admin — Manual"),
            taxAmount: sj.taxAmount ? parseFloat(sj.taxAmount) : undefined,
            discountCode: sj.discountCode || undefined,
            discountAmount: sj.discountAmount ? parseFloat(sj.discountAmount) : undefined,
            depositAmount: sj.depositAmount ? parseFloat(sj.depositAmount) : undefined,
            upsellTotal: sj.upsellTotal ? parseFloat(String(sj.upsellTotal)) : 0,
            upsellIds: sj.upsellIds ? (() => { try { return JSON.parse(sj.upsellIds); } catch { return []; } })() : [],
            upsellQtys: sj.upsellQtys ? (() => { try { return JSON.parse(sj.upsellQtys); } catch { return {}; } })() : {},
            recurrenceParentId: sj.recurrenceParentId || undefined,
            apptConfirmationStatus: (sj.apptConfirmationStatus as any) || "pending",
            apptReminderSent: sj.apptReminderSent ? Number(sj.apptReminderSent) : 0,
            apptConfirmedAt: sj.apptConfirmedAt ? String(sj.apptConfirmedAt) : null,
            apptConfirmMethod: (sj.apptConfirmMethod as any) || null,
            payment: sj.paymentMethod ? {
              method: sj.paymentMethod as any,
              subtotal: parseFloat(sj.paymentSubtotal || "0"),
              tipAmount: parseFloat(sj.paymentTip || "0"),
              total: parseFloat(sj.paymentTotal || "0"),
              paidAt: sj.paymentPaidAt || new Date().toISOString(),
              paymentIntentId: sj.paymentIntentId || undefined,
              signatureDataUrl: sj.paymentSignatureUrl || undefined,
              referenceNote: sj.paymentReferenceNote || undefined,
            } : undefined,
            photoUrls: sj.photoUrls ? (() => { try { const p = JSON.parse(sj.photoUrls); return Array.isArray(p) ? p : undefined; } catch { return undefined; } })() : undefined,
            onMyWayAt: sj.onMyWayAt ? String(sj.onMyWayAt) : null,
            arrivedAt: sj.arrivedAt ? String(sj.arrivedAt) : null,
            finishedAt: sj.finishedAt ? String(sj.finishedAt) : null,
            isNewCustomer: sj.isNewCustomer === 1 || (sj.isNewCustomer as any) === true,
            onlineBookingId: sj.onlineBookingId || null,
          } as Job;
        });
        // Filter out cancelled jobs — they must not appear on the admin calendar
        const activeJobs = mappedJobs.filter((j: any) => (j as any)._rawStatus !== 'cancelled');
        setJobs((prev) => {
          const otherCityJobs = prev.filter((j) => j.location && j.location.toLowerCase() !== selectedCity.toLowerCase());
          // Deduplicate by id — server data takes precedence over cached data
          const newIds = new Set(activeJobs.map((j) => j.id));
          const dedupedOther = otherCityJobs.filter((j) => !newIds.has(j.id));
          // Also purge any previously-cached cancelled jobs for this city
          const cleanedOther = dedupedOther.filter((j: any) => (j as any)._rawStatus !== 'cancelled' && j.status !== 'cancelled');
          const merged = [...cleanedOther, ...activeJobs];
          AsyncStorage.setItem(storageKeyRef.current, JSON.stringify(merged));
          return merged;
        });
      } catch {
        // Fail silently — offline mode still works from AsyncStorage
      } finally {
        setIsSyncing(false);
      }
    };
    syncServerJobs();
  }, [companySyncRevision, isJobSyncCompany, jobSyncSession?.token, selectedCity, syncKey]);

  // Auto-sync when the tab gains focus so phone-booked jobs appear immediately
  useFocusEffect(
    useCallback(() => {
      forceSync();
    }, [])
  );

  // Auto-open add-job modal with prefilled customer data when navigated from customer profile
  useEffect(() => {
    if (!prefillFirst && !prefillLast && !prefillPhone && !prefillEmail && !prefillAddress) return;
    const key = [prefillFirst, prefillLast, prefillPhone, prefillEmail, prefillAddress].join("|");
    if (prefillHandledRef.current === key) return;
    prefillHandledRef.current = key;
    setAddFirstName(prefillFirst ?? "");
    setAddLastName(prefillLast ?? "");
    setAddPhone(prefillPhone ?? "");
    setAddEmail(prefillEmail ?? "");
    setAddAddress(prefillAddress ?? "");
    setAddJobDate(localDateStr(getWeekDates(weekOffset)[selectedDay]));
    setShowAddDatePicker(false);
    setShowAddModal(true);
  }, [prefillFirst, prefillLast, prefillPhone, prefillEmail, prefillAddress]);

  // When navigated from AI Receptionist call log with a bookingId, find and open that job
  const highlightHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightBookingId || highlightHandledRef.current === highlightBookingId) return;
    // Search across all loaded jobs first
    const match = jobs.find((j) => j.id === highlightBookingId || j.bookingId === highlightBookingId);
    if (match) {
      highlightHandledRef.current = highlightBookingId;
      if (match.location && match.location !== selectedCity) setSelectedCity(match.location as any);
      setWeekOffset(match.weekOffset);
      setSelectedDay(match.dayIndex);
      setSelectedJob(match);
      setAdminEditingTime(false);
      setAdminEditingPackage(false);
      setAdminEditingDiscount(false);
      setAdminEditingTax(false);
      setAdminEditingDeposit(false);
      setShowCustomerHistory(false);
      return;
    }
    // Job not in local cache yet — fetch from server by bookingId
    if (!allowLegacyJobAuthority) return;
    const fetchAndOpen = async () => {
      try {
        const res = await fetch(`${APP_API_BASE}/api/booking/job/${encodeURIComponent(highlightBookingId)}`);
        if (!res.ok) return;
        const sj = await res.json();
        if (!sj?.jobId) return;
        const bookingDate = parseLocalDate(sj.date);
        // Mon-based day index: 0=Mon…6=Sun
        const dayOfWeek = (bookingDate.getDay() + 6) % 7;
        const todayMonday = new Date();
        todayMonday.setDate(todayMonday.getDate() - (todayMonday.getDay() + 6) % 7);
        todayMonday.setHours(0, 0, 0, 0);
        const bookingMonday = new Date(bookingDate);
        bookingMonday.setDate(bookingDate.getDate() - dayOfWeek);
        bookingMonday.setHours(0, 0, 0, 0);
        const wOffset = Math.round((bookingMonday.getTime() - todayMonday.getTime()) / (7 * 24 * 60 * 60 * 1000));
        const nameParts = (sj.customerName || "").split(" ");
        const job: Job = {
          id: sj.jobId,
          isOnlineBooking: false,
          bookingId: sj.bookingId || undefined,
          location: sj.location,
          firstName: nameParts[0] || "",
          lastName: nameParts.slice(1).join(" ") || "",
          email: sj.customerEmail || undefined,
          phone: sj.customerPhone || "",
          address: sj.customerAddress || "",
          serviceTitle: sj.packageType || "Detail Service",
          serviceDescription: sj.serviceDescription || "",
          price: sj.customPrice != null ? parseFloat(String(sj.customPrice)) : parseFloat(sj.totalPrice || "0"),
          customPrice: sj.customPrice != null ? parseFloat(String(sj.customPrice)) : undefined,
          startHour: sj.startHour != null ? parseFloat(String(sj.startHour)) : 8,
          endHour: sj.endHour != null ? parseFloat(String(sj.endHour)) : 10,
          dayIndex: dayOfWeek,
          weekOffset: wOffset,
          status: (sj.status === "completed" ? "finished" : sj.status === "in_progress" ? "started" : "scheduled") as JobStatus,
          notes: sj.notes || undefined,
          detailerName: sj.assignedTo || undefined,
          assignedTo: sj.assignedTo || undefined,
          createdAt: sj.createdAt ? new Date(sj.createdAt).toISOString() : new Date().toISOString(),
          vehicleType: resolveVehicleType(sj.vehicleType),
          packageId: resolvePackageId(sj.packageType) || (sj as any).packageId || undefined,
          addonIds: parseAddonIds(sj.selectedAddons),
          leadSource: sj.leadSource || "AI Receptionist",
          tags: sj.tags ? JSON.parse(sj.tags) : undefined,
          photoUrls: sj.photoUrls ? (() => { try { const p = JSON.parse(sj.photoUrls); return Array.isArray(p) ? p : undefined; } catch { return undefined; } })() : undefined,
          onMyWayAt: sj.onMyWayAt ? String(sj.onMyWayAt) : null,
          arrivedAt: sj.arrivedAt ? String(sj.arrivedAt) : null,
          finishedAt: sj.finishedAt ? String(sj.finishedAt) : null,
          isNewCustomer: sj.isNewCustomer === 1 || (sj.isNewCustomer as any) === true,
        } as Job;
        highlightHandledRef.current = highlightBookingId;
        if (sj.location && sj.location !== selectedCity) setSelectedCity(sj.location as any);
        setWeekOffset(wOffset);
        setSelectedDay(dayOfWeek);
        setSelectedJob(job);
        setAdminEditingTime(false);
        setAdminEditingPackage(false);
        setAdminEditingDiscount(false);
        setAdminEditingTax(false);
        setAdminEditingDeposit(false);
        setShowCustomerHistory(false);
      } catch {
        // Silently fail — job may not exist yet
      }
    };
    fetchAndOpen();
  }, [highlightBookingId, jobs, isJobSyncCompany]);

  const persistJobs = useCallback((updated: Job[]) => {
    setJobs(updated);
    if (allowLegacyJobAuthority) {
      AsyncStorage.setItem(storageKeyRef.current, JSON.stringify(updated));
    }
  }, [allowLegacyJobAuthority]);

  const openAdd = () => {
    const cityDets = dynamicDetailers[selectedCity] ?? FALLBACK_DETAILERS[selectedCity] ?? [];
    const dow = selectedDate.getDay();
    // Find the soonest available slot across all on-shift detailers
    let bestDetailer = isJobSyncCompany ? (cityDets[0]?.employeeId ?? "") : (cityDets[0]?.name ?? "");
    let bestStart = 8;
    let bestEnd = 10;
    let foundSlot = false;
    for (const det of cityDets) {
      if (!isDetailerOnShift(det, dow)) continue;
      const blocked = addBlockedHoursByDetailer[det.name] ?? new Set<number>();
      // Find first 2-hour window with no blocked hours
      for (let h = 8; h <= 15; h += 0.5) {
        if (!blocked.has(h) && !blocked.has(h + 0.5) && !blocked.has(h + 1) && !blocked.has(h + 1.5)) {
          if (!foundSlot || h < bestStart) {
            bestDetailer = isJobSyncCompany ? det.employeeId : det.name;
            bestStart = h;
            bestEnd = h + 2;
            foundSlot = true;
          }
          break;
        }
      }
    }
    setAddFirstName(""); setAddLastName(""); setAddPhone(""); setAddEmail(""); setAddAddress("");
    setCustomerSearch(""); setShowCustomerDropdown(false); setAddonsExpanded(false);
    setSelectedCompanyCustomerId(null);
    setAddService(""); setAddPrice(""); setAddStartHour(bestStart); setAddEndHour(bestEnd);
    setAddDetailer(bestDetailer);
    setAddVehicleType(undefined); setAddPackageId(undefined);
    setAddCustomPrice(""); setShowCustomPriceInput(false);
    setAddCustomPackageName(""); setAddCustomPackageDesc(""); setAddCustomPackagePrice(""); setShowCustomPackageForm(false);
    setAddAddonIds([]); setAddAddonQtys({}); setAddRvSealantFeet("");
    setAddExtraVehicles([]);
    setAddRecurrenceRule(null);
    setAddNotifyCustomer(true);
    setAddIsNewCustomer(false);
    setAddDiscountType("fixed"); setAddDiscountInput(""); setAddDiscountCode("");
    setAddJobDate(localDateStr(getWeekDates(weekOffset)[selectedDay]));
    setShowAddDatePicker(false);
    setShowAddModal(true);
  };

  const jobCreateRecurringMutation = trpc.jobs.createRecurring.useMutation();

  const saveAdminJob = async () => {
    if (!addFirstName.trim() || !addLastName.trim() || !addAddress.trim()) return;
    if (!allowLegacyJobAuthority) {
      try {
        if (!isJobSyncCompany || !jobSyncSession?.token) throw new Error(COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
        const priceBookServiceId = Number(addPackageId);
        if (!Number.isSafeInteger(priceBookServiceId) || priceBookServiceId <= 0) throw new Error("Select an active Company Price Book service before creating this Job.");
        if (addAddonIds.length || addExtraVehicles.length || addCustomPrice.trim() || addDiscountInput.trim() || addRecurrenceRule?.type !== "none") {
          throw new Error("Company Jobs currently support one active Price Book service per Job. Configure extra services in the Company Price Book before scheduling.");
        }
        const customer = selectedCompanyCustomerId
          ? { id: selectedCompanyCustomerId }
          : await createJobSyncCompanyCustomer(jobSyncSession.token, {
              firstName: addFirstName,
              lastName: addLastName,
              phone: addPhone,
              email: addEmail,
              addressLine1: addAddress,
              city: CITY_LIST.find((city) => city.slug === selectedCity)?.label ?? selectedCity,
              vehicleType: addVehicleType,
            });
        const dateStr = addJobDate || localDateStr(getWeekDates(weekOffset)[selectedDay]);
        const scheduledStartAt = new Date(`${dateStr}T${String(Math.floor(addStartHour)).padStart(2, "0")}:${addStartHour % 1 ? "30" : "00"}:00`).toISOString();
        const scheduledEndAt = new Date(`${dateStr}T${String(Math.floor(addEndHour)).padStart(2, "0")}:${addEndHour % 1 ? "30" : "00"}:00`).toISOString();
        const assignedUserId = addDetailer.startsWith("jobsync-") ? Number(addDetailer.slice("jobsync-".length)) : undefined;
        const job = await createJobSyncCompanyJob(jobSyncSession.token, {
          customerId: customer.id,
          priceBookServiceId,
          ...(Number.isSafeInteger(assignedUserId) && (assignedUserId ?? 0) > 0 ? { assignedUserId } : {}),
          scheduledStartAt,
          scheduledEndAt,
        });
        setShowAddModal(false);
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        forceSync();
        Alert.alert("Job Saved", `${job.serviceName} was scheduled using the Company Price Book total of $${job.amount.toFixed(2)}.`);
      } catch (error) {
        Alert.alert("Job Not Saved", error instanceof Error ? error.message : "Home Service Connected could not create this Job.");
      }
      return;
    }
    // Warn if any extra vehicle has no package selected (price = 0 and no packageId)
    const unpricedVehicles = addExtraVehicles.filter(v => !v.packageId && v.price === 0);
    if (unpricedVehicles.length > 0) {
      Alert.alert("Missing Package", `${unpricedVehicles.length} additional vehicle(s) have no package selected. Please select a package for each vehicle before saving.`);
      return;
    }
    const resolvedTitle = addService.trim() || (addPackageId ? (allJobPackages.find(p => p.id === addPackageId)?.title ?? "Detail Service") : "Detail Service");
    // Total price = primary vehicle (with optional custom price override) + all additional vehicles
    const extraVehiclesTotal = addExtraVehicles.reduce((sum, v) => sum + v.price, 0);
    const basePrice = addCustomPrice.trim() !== "" ? (parseFloat(addCustomPrice) || 0) : (parseFloat(addPrice) || 0);
    const totalPrice = basePrice + extraVehiclesTotal;
    const customPriceOverride = addCustomPrice.trim() !== "" ? basePrice : undefined;
    // Calculate discount
    const discountInputVal = parseFloat(addDiscountInput) || 0;
    const computedDiscount = addDiscountType === "percent"
      ? Math.round((discountInputVal / 100) * totalPrice * 100) / 100
      : discountInputVal;
    const discountAmountFinal = computedDiscount > 0 ? computedDiscount : undefined;
    const discountCodeFinal = addDiscountCode.trim() || undefined;
    const newJob: Job = {
      id: Date.now().toString(),
      firstName: addFirstName.trim(),
      lastName: addLastName.trim(),
      phone: addPhone.trim(),
      email: addEmail.trim() || undefined,
      address: addAddress.trim(),
      serviceTitle: resolvedTitle,
      price: totalPrice,
      startHour: addStartHour,
      endHour: addEndHour,
      dayIndex: selectedDay,
      weekOffset,
      status: "scheduled",
      createdAt: new Date().toISOString(),
      location: selectedCity,
      detailerName: addDetailer || undefined,
      vehicleType: addVehicleType,
      packageId: addPackageId,
      addonIds: addAddonIds.length > 0 ? addAddonIds : undefined,
      additionalVehicles: addExtraVehicles.length > 0 ? addExtraVehicles : undefined,
      discountAmount: discountAmountFinal,
      discountCode: discountCodeFinal,
    };
    persistJobs([...jobs, newJob]);
    setShowAddModal(false);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Sync to server DB (fire-and-forget)
    const dateStr = addJobDate || localDateStr(getWeekDates(weekOffset)[selectedDay]);

    // If recurring, use createRecurring mutation instead of upsert
    if (addRecurrenceRule && addRecurrenceRule.type !== "none") {
      const basePayload = {
        location: selectedCity,
        date: dateStr,
        timeSlot: `${formatHour(newJob.startHour)} - ${formatHour(newJob.endHour)}`,
        startHour: newJob.startHour,
        endHour: newJob.endHour,
        customerName: `${newJob.firstName} ${newJob.lastName}`.trim(),
        customerPhone: newJob.phone || undefined,
        vehicleType: newJob.vehicleType || undefined,
        packageType: newJob.packageId || undefined,
        serviceDescription: newJob.serviceDescription || undefined,
        selectedAddons: newJob.addonIds?.length ? JSON.stringify(newJob.addonIds) : undefined,
        totalPrice: newJob.price,
        customPrice: customPriceOverride,
        discountAmount: discountAmountFinal,
        discountCode: discountCodeFinal,
        assignedTo: newJob.detailerName || undefined,
        additionalVehicles: newJob.additionalVehicles?.length ? JSON.stringify(newJob.additionalVehicles) : undefined,
        customerAddress: newJob.address || undefined,
        status: "confirmed" as const,
        source: "manual" as const,
        createdBy: currentEmployee?.employeeId || undefined,
        recurrenceRule: addRecurrenceRule as { type: "weekly" | "biweekly" | "monthly_date" | "monthly_ordinal"; dayOfWeek?: number; ordinal?: number; endDate?: string },
      };
      jobCreateRecurringMutation.mutate(basePayload, {
        onSuccess: (res) => {
          Alert.alert("Recurring Jobs Created", `${res.count} job${res.count === 1 ? "" : "s"} scheduled.`);
          // Re-sync from server so all recurring instances appear on the calendar
          forceSync();
        },
      });
      setAddRecurrenceRule(null);
      return;
    }

    jobUpsertMutation.mutate({
      jobId: newJob.id,
      location: selectedCity,
      date: dateStr,
      timeSlot: `${formatHour(newJob.startHour)} - ${formatHour(newJob.endHour)}`,
      startHour: newJob.startHour,
      endHour: newJob.endHour,
      customerName: `${newJob.firstName} ${newJob.lastName}`.trim(),
      customerPhone: newJob.phone || undefined,
      customerEmail: newJob.email || undefined,
      vehicleType: newJob.vehicleType || undefined,
      packageType: newJob.packageId || undefined,
      serviceDescription: newJob.serviceDescription || undefined,
      selectedAddons: newJob.addonIds?.length ? JSON.stringify(newJob.addonIds) : undefined,
      totalPrice: newJob.price,
      customPrice: customPriceOverride,
      discountAmount: discountAmountFinal,
      discountCode: discountCodeFinal,
      assignedTo: newJob.detailerName || undefined,
      additionalVehicles: newJob.additionalVehicles?.length ? JSON.stringify(newJob.additionalVehicles) : undefined,
      customerAddress: newJob.address || undefined,
      status: "confirmed" as const,
      source: "manual" as const,
      createdBy: currentEmployee?.employeeId || undefined,
      notifyCustomer: addNotifyCustomer,
      isNewCustomer: addIsNewCustomer,
    });
  };

  // ─── Admin Job Detail Helpers ────────────────────────────────────────────────

  // adminSavePrivateNotes removed — now handled by PrivateNotesCard component

  const adminAddTag = async (job: Job, tag: string) => {
    if (!allowLegacyJobAuthority) return;
    const trimmed = tag.trim();
    if (!trimmed) return;
    const newTags = [...(job.tags ?? []), trimmed];
    const updated = { ...job, tags: newTags };
    setJobs((prev) => prev.map((j) => j.id === job.id ? updated : j));
    setSelectedJob(updated);
    setAdminTagInput("");
    try { await jobMetaMutation.mutateAsync({ jobId: job.id, tags: JSON.stringify(newTags) }); } catch {}
  };

  const adminRemoveTag = async (job: Job, tag: string) => {
    if (!allowLegacyJobAuthority) return;
    const newTags = (job.tags ?? []).filter((t) => t !== tag);
    const updated = { ...job, tags: newTags };
    setJobs((prev) => prev.map((j) => j.id === job.id ? updated : j));
    setSelectedJob(updated);
    try { await jobMetaMutation.mutateAsync({ jobId: job.id, tags: JSON.stringify(newTags) }); } catch {}
  };

  const adminSaveTax = async (job: Job, taxStr: string) => {
    if (!allowLegacyJobAuthority) return;
    const taxAmount = parseFloat(taxStr) || 0;
    const updated = { ...job, taxAmount };
    setJobs((prev) => prev.map((j) => j.id === job.id ? updated : j));
    setSelectedJob(updated);
    setAdminEditingTax(false);
    try { await jobMetaMutation.mutateAsync({ jobId: job.id, taxAmount: taxAmount.toString() }); } catch {}
  };

  const adminSaveDiscount = async (job: Job, amountStr: string, code: string) => {
    if (!allowLegacyJobAuthority) return;
    const inputVal = parseFloat(amountStr) || 0;
    // If percent mode, convert to dollar amount based on subtotal (price + upsells)
    const subtotalForDiscount = job.price + (job.upsellTotal ?? 0);
    const discountAmount = adminDiscountType === "percent"
      ? Math.round((inputVal / 100) * subtotalForDiscount * 100) / 100
      : inputVal;
    const discountCode = code.trim() || undefined;
    const updated = { ...job, discountAmount, discountCode };
    setJobs((prev) => prev.map((j) => j.id === job.id ? updated : j));
    setSelectedJob(updated);
    setAdminEditingDiscount(false);
    try { await jobMetaMutation.mutateAsync({ jobId: job.id, discountAmount: discountAmount.toString(), discountCode: discountCode ?? null }); } catch {}
  };

  const adminSaveDeposit = async (job: Job, amountStr: string) => {
    if (!allowLegacyJobAuthority) return;
    const depositAmount = parseFloat(amountStr) || 0;
    const updated = { ...job, depositAmount };
    setJobs((prev) => prev.map((j) => j.id === job.id ? updated : j));
    setSelectedJob(updated);
    setAdminEditingDeposit(false);
    try { await jobMetaMutation.mutateAsync({ jobId: job.id, depositAmount: depositAmount.toString() }); } catch {}
  };

  const adminSaveTime = async (job: Job, newStartHour: number, newEndHour: number, newDateStr: string, notifyCustomer = false) => {
    if (newEndHour <= newStartHour) return;
    if (!allowLegacyJobAuthority) {
      const jobId = canonicalJobId(job.id);
      if (!isJobSyncCompany || !jobId || !jobSyncSession?.token) {
        Alert.alert("Reschedule unavailable", COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
        return;
      }
      try {
        await rescheduleJobSyncCompanyJob(jobSyncSession.token, jobId, {
          scheduledStartAt: companyScheduleDateTime(newDateStr, newStartHour),
          scheduledEndAt: companyScheduleDateTime(newDateStr, newEndHour),
        });
        forceSync();
      } catch (error) {
        Alert.alert("Job not rescheduled", error instanceof Error ? error.message : COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
      }
      return;
    }
    // Recalculate weekOffset and dayIndex for the new date
    const newDate = parseLocalDate(newDateStr);
    // Mon-based day index: 0=Mon…6=Sun
    const dayOfWeek = (newDate.getDay() + 6) % 7;
    const todayMonday = new Date();
    todayMonday.setDate(todayMonday.getDate() - (todayMonday.getDay() + 6) % 7);
    todayMonday.setHours(0, 0, 0, 0);
    const newMonday = new Date(newDate);
    newMonday.setDate(newDate.getDate() - dayOfWeek);
    newMonday.setHours(0, 0, 0, 0);
    const newWeekOffset = Math.round((newMonday.getTime() - todayMonday.getTime()) / (7 * 24 * 60 * 60 * 1000));

    // Auto-clear detailer if they are off-shift on the new date
    const cityDets = dynamicDetailers[selectedCity] ?? FALLBACK_DETAILERS[selectedCity] ?? [];
    const assignedDet = job.assignedTo
      ? cityDets.find((d) => d.employeeId === job.assignedTo || d.name === job.assignedTo)
      : undefined;
    const detailerOffShift = assignedDet ? !isDetailerOnShift(assignedDet, dayOfWeek) : false;
    const newAssignedTo = detailerOffShift ? undefined : job.assignedTo;
    const newDetailerName = detailerOffShift ? undefined : job.detailerName;

    if (detailerOffShift) {
      Alert.alert(
        "Detailer Off Shift",
        `${assignedDet?.name ?? "The assigned detailer"} is off on the new date. The job has been unassigned — please reassign to an available detailer.`
      );
    }

    const updated = { ...job, startHour: newStartHour, endHour: newEndHour, weekOffset: newWeekOffset, dayIndex: dayOfWeek, assignedTo: newAssignedTo, detailerName: newDetailerName };
    setJobs((prev) => prev.map((j) => j.id === job.id ? updated : j));
    setSelectedJob(updated);
    setAdminEditingTime(false);
    const timeSlot = `${formatHour(newStartHour)} - ${formatHour(newEndHour)}`;
    try {
      await jobUpsertMutation.mutateAsync({
        jobId: job.id,
        location: job.location ?? selectedCity,
        date: newDateStr,
        timeSlot,
        startHour: newStartHour,
        endHour: newEndHour,
        assignedTo: newAssignedTo ?? "",
        notifyCustomer,
      });
      if (detailerOffShift) {
        jobReassignMutation.mutate({ jobId: job.id, newAssignedTo: "" });
      }
    } catch {}
  };

  const adminSavePackage = async (job: Job, newPackageId: string) => {
    if (!allowLegacyJobAuthority) return;
    const pkg = allJobPackages.find((p) => p.id === newPackageId);
    const vt = (job.vehicleType ?? "sedan") as VehicleType;
    const basePkgPrice = pkg ? (pkg.basePrice[vt] ?? job.price) : job.price;
    // Sum all additional vehicles' prices to get the correct multi-vehicle total
    const additionalVehiclesTotal = (job.additionalVehicles ?? []).reduce((sum, v) => sum + (Number(v.price) || 0), 0);
    const newTotal = (basePkgPrice ?? 0) + additionalVehiclesTotal;
    const updated: Job = { ...job, packageId: newPackageId, serviceTitle: pkg?.title ?? job.serviceTitle, price: newTotal, customPrice: undefined };
    setJobs((prev) => prev.map((j) => j.id === job.id ? updated : j));
    setSelectedJob(updated);
    setAdminEditingPackage(false);
    const jobDate = getWeekDates(job.weekOffset)[job.dayIndex];
    const dateStr = localDateStr(jobDate);
    try {
      await jobUpsertMutation.mutateAsync({
        jobId: job.id,
        location: job.location ?? selectedCity,
        date: dateStr,
        packageType: newPackageId,
        totalPrice: newTotal,
        customPrice: null, // clear any previous custom price override when package changes
      });
    } catch {}
  };

  const adminSavePrice = async (job: Job, newPriceStr: string) => {
    if (!allowLegacyJobAuthority) return;
    const newPrice = parseFloat(newPriceStr);
    if (isNaN(newPrice) || newPrice < 0) return;
    const updated = { ...job, price: newPrice, customPrice: newPrice };
    setJobs((prev) => prev.map((j) => j.id === job.id ? updated : j));
    setSelectedJob(updated);
    setAdminEditingPrice(false);
    const jobDate = getWeekDates(job.weekOffset)[job.dayIndex];
    const dateStr = localDateStr(jobDate);
    try {
      await jobUpsertMutation.mutateAsync({
        jobId: job.id,
        location: job.location ?? selectedCity,
        date: dateStr,
        customPrice: newPrice,
        totalPrice: newPrice,
      });
    } catch {}
  };

  const adminLoadCustomerHistory = async (job: Job) => {
    if (!allowLegacyJobAuthority) return;
    try {
      const url = `${APP_API_BASE}/api/trpc/jobs.customerHistory?input=${encodeURIComponent(JSON.stringify({ phone: job.phone || undefined, email: job.email || undefined, excludeJobId: job.id }))}`;
      const res = await fetch(url);
      const data = await res.json();
      // tRPC v11 wraps response data in .result.data.json
      const items = data?.result?.data?.json ?? data?.result?.data ?? [];
      setCustomerHistory(items.map((sj: any) => ({
        id: sj.jobId, firstName: sj.customerName?.split(" ")[0] || "",
        lastName: sj.customerName?.split(" ").slice(1).join(" ") || "",
        phone: sj.customerPhone || "", email: sj.customerEmail || undefined,
        address: sj.customerAddress || "",
        serviceTitle: sj.packageType || "Detail Service",
        packageId: sj.packageId || resolvePackageId(sj.packageType) || undefined,
        price: parseFloat(sj.totalPrice || "0"),
        startHour: sj.startHour != null ? parseFloat(String(sj.startHour)) : 8, endHour: sj.endHour != null ? parseFloat(String(sj.endHour)) : 10,
        dayIndex: 0, weekOffset: 0,
        status: "finished" as JobStatus,
        createdAt: sj.createdAt ? new Date(sj.createdAt).toISOString() : new Date().toISOString(),
        location: sj.location,
      })));
    } catch { /* fail silently */ }
  };

  // Auto-load customer history whenever a job is selected in admin view
  // (placed after adminLoadCustomerHistory definition so it's in scope)
  useEffect(() => {
    setCustomerHistory([]);
    setAddressPhotos([]);
    if (!isJobSyncCompany && selectedJob && (selectedJob.phone || selectedJob.email)) {
      adminLoadCustomerHistory(selectedJob);
    }
    if (!isJobSyncCompany && selectedJob?.address) {
      const addressKey = selectedJob.address.trim().toLowerCase().replace(/\s+/g, "-");
      utils.jobs.getAddressPhotos.fetch({ addressKey }).then((photos: any[]) => setAddressPhotos(photos)).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJob?.id]);

  const handleMoveAdminJob = useCallback((jobId: string, newStartHour: number, newLaneIdx?: number) => {
    const cityConfig: CityConfig | undefined = { slug: selectedCity, label: CITY_LIST.find(c => c.slug === selectedCity)?.label ?? selectedCity, detailers: dynamicDetailers[selectedCity] ?? FALLBACK_DETAILERS[selectedCity] ?? [] };
    setJobs((prev) => {
      const updated = prev.map((j) => {
        if (j.id !== jobId) return j;
        const duration = Math.max(1, j.endHour - j.startHour);
        const newEndHour = newStartHour + duration;
        // If dropped into a different lane, update detailerName + assignedTo
        let newDetailerName = j.detailerName;
        let newAssignedTo = j.assignedTo;
        if (newLaneIdx !== undefined && cityConfig) {
          const targetDetailer = cityConfig.detailers[newLaneIdx];
          if (targetDetailer) {
            newDetailerName = targetDetailer.name;
            newAssignedTo = targetDetailer.employeeId ?? j.assignedTo;
          } else {
            // Dropped into the Unassigned lane — clear the assignment
            newDetailerName = undefined;
            newAssignedTo = undefined;
          }
        }
        return { ...j, startHour: newStartHour, endHour: newEndHour, detailerName: newDetailerName, assignedTo: newAssignedTo };
      });
      const job = updated.find((j) => j.id === jobId);
      if (job && !allowLegacyJobAuthority) {
        const canonicalId = canonicalJobId(job.id);
        const token = jobSyncSession?.token;
        if (!isJobSyncCompany || !canonicalId || !token) return prev;
        const jobDate = getWeekDates(weekOffset)[job.dayIndex];
        const dateStr = localDateStr(jobDate);
        void Promise.all([
          rescheduleJobSyncCompanyJob(token, canonicalId, {
            scheduledStartAt: companyScheduleDateTime(dateStr, job.startHour),
            scheduledEndAt: companyScheduleDateTime(dateStr, job.endHour),
          }),
          assignJobSyncCompanyJob(token, canonicalId, { assignedUserId: companyAssignedUserId(job.assignedTo) }),
        ]).then(() => forceSync()).catch((error) => {
          Alert.alert("Schedule not updated", error instanceof Error ? error.message : COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
          forceSync();
        });
        return updated;
      }
      if (job) {
        const jobDate = getWeekDates(weekOffset)[job.dayIndex];
        const dateStr = localDateStr(jobDate);
        // Always explicitly reassign so null/empty is persisted correctly (jobUpsertMutation skips undefined fields)
        jobReassignMutation.mutate({ jobId: job.id, newAssignedTo: job.assignedTo ?? "" });
        // Also upsert to update time slot
        jobUpsertMutation.mutate({
          jobId: job.id,
          location: job.location ?? selectedCity,
          date: dateStr,
          timeSlot: `${formatHour(job.startHour)} - ${formatHour(job.endHour)}`,
          startHour: job.startHour,
          endHour: job.endHour,
          customerName: `${job.firstName} ${job.lastName}`.trim(),
          customerPhone: job.phone || undefined,
          vehicleType: job.vehicleType || undefined,
          packageType: job.packageId || undefined,
          serviceDescription: job.serviceDescription || undefined,
          selectedAddons: job.addonIds?.length ? JSON.stringify(job.addonIds) : undefined,
          totalPrice: job.price,
          assignedTo: job.assignedTo ?? "", // empty string = unassigned; reassign mutation above handles the null write
          status: "confirmed" as const,
          source: "manual" as const,
          notifyCustomer: false, // drag-to-move: never re-send confirmation
        });
        // Persist locally
        AsyncStorage.setItem(storageKeyRef.current, JSON.stringify(updated)).catch(() => {});
      }
      return updated;
    });
  }, [weekOffset, selectedCity, jobUpsertMutation, jobReassignMutation, isJobSyncCompany, jobSyncSession?.token]);

  const handleResizeAdminJob = useCallback((jobId: string, newEndHour: number) => {
    setJobs((prev) => {
      const updated = prev.map((j) => {
        if (j.id !== jobId) return j;
        const clampedEnd = Math.max(j.startHour + 1, Math.min(HOURS[HOURS.length - 1], newEndHour));
        return { ...j, endHour: clampedEnd };
      });
      const job = updated.find((j) => j.id === jobId);
      if (job && !allowLegacyJobAuthority) {
        const canonicalId = canonicalJobId(job.id);
        const token = jobSyncSession?.token;
        if (!isJobSyncCompany || !canonicalId || !token) return prev;
        const jobDate = getWeekDates(weekOffset)[job.dayIndex];
        const dateStr = localDateStr(jobDate);
        void rescheduleJobSyncCompanyJob(token, canonicalId, {
          scheduledStartAt: companyScheduleDateTime(dateStr, job.startHour),
          scheduledEndAt: companyScheduleDateTime(dateStr, job.endHour),
        }).then(() => forceSync()).catch((error) => {
          Alert.alert("Schedule not updated", error instanceof Error ? error.message : COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
          forceSync();
        });
        return updated;
      }
      if (job) {
        const jobDate = getWeekDates(weekOffset)[job.dayIndex];
        const dateStr = localDateStr(jobDate);
        jobUpsertMutation.mutate({
          jobId: job.id,
          location: job.location ?? selectedCity,
          date: dateStr,
          timeSlot: `${formatHour(job.startHour)} - ${formatHour(job.endHour)}`,
          startHour: job.startHour,
          endHour: job.endHour,
          customerName: `${job.firstName} ${job.lastName}`.trim(),
          customerPhone: job.phone || undefined,
          vehicleType: job.vehicleType || undefined,
          packageType: job.packageId || undefined,
          serviceDescription: job.serviceDescription || undefined,
          selectedAddons: job.addonIds?.length ? JSON.stringify(job.addonIds) : undefined,
          totalPrice: job.price,
          assignedTo: job.assignedTo || job.detailerName || undefined,
          status: "confirmed" as const,
          source: "manual" as const,
          notifyCustomer: false, // resize: never re-send confirmation
        });
        AsyncStorage.setItem(storageKeyRef.current, JSON.stringify(updated)).catch(() => {});
      }
      return updated;
    });
  }, [weekOffset, selectedCity, jobUpsertMutation, isJobSyncCompany, jobSyncSession?.token]);

  const weekDates = getWeekDates(weekOffset);
  const selectedDate = weekDates[selectedDay];
  // Build runtime cityConfig from dynamic detailers (falls back to static if not yet loaded)
  const cityConfig: CityConfig = {
    slug: selectedCity,
    label: isJobSyncCompany
      ? (jobSyncSession?.company?.name ?? "Company schedule")
      : (CITY_LIST.find((c) => c.slug === selectedCity)?.label ?? selectedCity),
    detailers: dynamicDetailers[selectedCity] ?? FALLBACK_DETAILERS[selectedCity] ?? [],
  };
  const currentScheduleLabel = cityConfig.label;

  // Filter jobs for the selected city and day, deduplicating by id (server data wins)
  const dayJobs = (() => {
    const seen = new Set<string>();
    return jobs.filter((j) => {
      if (
        j.dayIndex !== selectedDay ||
        j.weekOffset !== weekOffset ||
        (j.location && j.location.toLowerCase() !== selectedCity.toLowerCase())
      ) return false;
      if (seen.has(j.id)) return false;
      seen.add(j.id);
      return true;
    });
  })();

  // Compute blocked hours per detailer for the selected date (used in Add Job form)
  const addBlockedHoursByDetailer = React.useMemo(() => {
    const map: Record<string, Set<number>> = {};
    const dow = selectedDate.getDay();
    // First, mark 8–17 as blocked for any detailer not on shift today
    for (const det of cityConfig.detailers) {
      if (!isDetailerOnShift(det, dow)) {
        if (!map[det.employeeId]) map[det.employeeId] = new Set();
        for (let h = 8; h < 17; h++) map[det.employeeId].add(h);
      }
    }
    // Then overlay actual job conflicts
    for (const job of dayJobs) {
      if (!job.detailerName || (job.status as string) === "cancelled") continue;
      const jStart = job.startHour ?? 0;
      const jEnd = job.endHour ?? 24;
      if (!map[job.detailerName]) map[job.detailerName] = new Set();
      for (let h = jStart; h < jEnd; h++) map[job.detailerName].add(h);
    }
    return map;
  }, [dayJobs, cityConfig.detailers, selectedDate]);
  // Blocked hours for the currently selected detailer in the Add Job form
  const addCurrentBlockedHours = React.useMemo(
    () => addBlockedHoursByDetailer[addDetailer] ?? new Set<number>(),
    [addBlockedHoursByDetailer, addDetailer]
  );
  // Dot indicators
  const jobsByDay = weekDates.map((_, i) =>
    jobs.some(
      (j) =>
        j.dayIndex === i &&
        j.weekOffset === weekOffset &&
        (!j.location || j.location.toLowerCase() === selectedCity.toLowerCase())
    )
  );

  const goToToday = () => { setWeekOffset(0); setSelectedDay(todayDayIndex()); };
  // Week swipe gesture — swipe left = next week, swipe right = prev week
  const weekSwipeGesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(40)
    .activeOffsetX([-20, 20])
    .failOffsetY([-25, 25])
    .onEnd((e) => {
      if (Math.abs(e.translationX) < 50) return;
      if (e.translationX < -50) {
        setWeekOffset((w) => w + 1);
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else if (e.translationX > 50) {
        setWeekOffset((w) => w - 1);
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    });

  return (
    <ScreenContainer
      edges={["left", "right"]}
      containerClassName="bg-background"
      onLayout={(e) => setScreenWidth(e.nativeEvent.layout.width)}
    >
      {/* Header */}
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <Text style={[s.title, { color: colors.foreground }]}>Schedule</Text>
        {isJobSyncCompany && companyJobsError ? (
          <Text style={{ color: colors.muted, fontSize: 12, maxWidth: 180 }} numberOfLines={2}>{companyJobsError}</Text>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <TouchableOpacity
            onPress={goToToday}
            style={[s.todayBtn, { borderColor: colors.primary }]}
          >
            <Text style={[s.todayBtnText, { color: colors.primary }]}>Today</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={forceSync}
            disabled={isSyncing}
            style={[s.todayBtn, { borderColor: colors.border, opacity: isSyncing ? 0.5 : 1 }]}
          >
            <Text style={[s.todayBtnText, { color: colors.muted }]}>{isSyncing ? "⏳" : "⟳"}</Text>
          </TouchableOpacity>

          {/* Add Blocker Button */}
          <TouchableOpacity
            disabled={cityConfig.detailers.length === 0}
            onPress={() => {
              setBlockerDate(localDateStr(getWeekDates(weekOffset)[selectedDay]));
              setBlockerDetailer(cityConfig.detailers[0]?.name ?? "");
              setBlockerAllDay(true);
              setBlockerStartHour(8);
              setBlockerEndHour(17);
              setBlockerReason("Day Off");
              setShowBlockerDatePicker(false);
              setShowBlockerModal(true);
            }}
            style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#ef4444", justifyContent: "center", alignItems: "center", opacity: cityConfig.detailers.length === 0 ? 0.35 : 1 }}
          >
            <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>🚫</Text>
          </TouchableOpacity>

          {/* Add Job Button */}
          <TouchableOpacity
            disabled={cityConfig.detailers.length === 0}
            onPress={openAdd}
            style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, justifyContent: "center", alignItems: "center", opacity: cityConfig.detailers.length === 0 ? 0.35 : 1 }}
          >
            <Text style={{ color: "#FFF", fontSize: 22, fontWeight: "300", lineHeight: 28 }}>+</Text>
          </TouchableOpacity>

        </View>
      </View>

      {/* Detailer legend for dual-lane cities */}
      {cityConfig.detailers.length > 1 && (
        <View style={{ flexDirection: "row", gap: 16, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
          {cityConfig.detailers.map((det, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: det.color }} />
              <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600" }}>{det.name}</Text>
            </View>
          ))}
          <Text style={{ fontSize: 12, color: colors.muted, marginLeft: "auto" }}>
            {dayJobs.length} job{dayJobs.length !== 1 ? "s" : ""}
          </Text>
        </View>
      )}

      {/* Week Strip — swipe left/right to change weeks */}
      <GestureDetector gesture={weekSwipeGesture}>
      <View style={[s.weekStrip, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => setWeekOffset((w) => w - 1)} style={s.weekArrow}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </TouchableOpacity>
        {weekDates.map((d, i) => {
          const isSelected = i === selectedDay;
          const isToday = weekOffset === 0 && i === todayDayIndex();
          const hasDot = jobsByDay[i];
          return (
            <TouchableOpacity
              key={i}
              onPress={() => setSelectedDay(i)}
              style={s.weekDayCell}
            >
              <Text style={[s.weekDayName, { color: isSelected ? colors.primary : colors.muted }]}>
                {WEEK_DAYS_SHORT[i]}
              </Text>
              <View
                style={[
                  s.weekDayNumCircle,
                  isSelected && { backgroundColor: colors.primary },
                  isToday && !isSelected && { borderWidth: 1.5, borderColor: colors.primary },
                ]}
              >
                <Text style={[s.weekDayNum, { color: isSelected ? "#FFF" : colors.foreground }]}>
                  {d.getDate()}
                </Text>
              </View>
              {hasDot ? (
                <View style={[s.dayDot, { backgroundColor: colors.primary }]} />
              ) : (
                <View style={[s.dayDot, { backgroundColor: "transparent" }]} />
              )}
            </TouchableOpacity>
          );
        })}
                <TouchableOpacity onPress={() => setWeekOffset((w) => w + 1)} style={s.weekArrow}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>›</Text>
        </TouchableOpacity>
      </View>
      </GestureDetector>
      {/* Day label */}
      <View style={[s.dayLabel, { borderBottomColor: colors.border }]}>
        <Text style={[s.dayLabelText, { color: colors.muted }]}>{formatFullDate(selectedDate)}</Text>
        {cityConfig.detailers.length === 1 && (
          <Text style={{ fontSize: 12, color: colors.muted }}>
            {dayJobs.length} job{dayJobs.length !== 1 ? "s" : ""}
          </Text>
        )}
      </View>

      {/* Loading indicator while fetching detailers from server */}
      {!detailersLoaded[selectedCity] && (
        <View style={{ paddingVertical: 24, alignItems: "center", gap: 8 }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ fontSize: 13, color: colors.muted }}>Loading team members…</Text>
        </View>
      )}

      {/* Day Blockers — shown above timeline */}
      {(() => {
        const dayStr = localDateStr(selectedDate);
        const currentCityLabel = currentScheduleLabel;
        const dayBlockers = blockers.filter((b) => {
          // Normalize date: strip time component in case DB returns a datetime string
          const bDate = b.date ? b.date.slice(0, 10) : "";
          // Normalize city: compare both slug and full label (blockers may be stored either way)
          const bCity = b.city ?? "";
          const cityMatch = bCity === selectedCity || bCity === currentCityLabel || bCity.toLowerCase() === selectedCity.toLowerCase();
          return bDate === dayStr && cityMatch;
        });
        if (dayBlockers.length === 0) return null;
        return (
          <View style={{ paddingHorizontal: 16, paddingVertical: 6, gap: 6 }}>
            {dayBlockers.map((b) => (
              <TouchableOpacity
                key={b.id}
                onPress={() => setSelectedBlocker(b.id)}
                style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#ef444420", borderRadius: 10, borderWidth: 1, borderColor: "#ef4444", paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 16 }}>🚫</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#ef4444" }}>{b.detailerName} — {b.reason}</Text>
                  <Text style={{ fontSize: 11, color: "#ef4444", opacity: 0.8 }}>
                    {b.allDay ? "All Day" : `${formatHour(b.startHour)} – ${formatHour(b.endHour)}`}
                  </Text>
                </View>
                <Text style={{ fontSize: 11, color: "#ef4444", opacity: 0.7 }}>Tap to remove</Text>
              </TouchableOpacity>
            ))}
          </View>
        );
      })()}

      {/* A Company without members must never inherit another Company's schedule lanes. */}
      {cityConfig.detailers.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingBottom: 72 }}>
          <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "800", textAlign: "center" }}>No team members yet</Text>
          <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, textAlign: "center" }}>
            Add team members to this Company before assigning jobs or creating time off.
          </Text>
        </View>
      ) : (
        <DualLaneTimeline
          jobs={dayJobs}
          cityConfig={cityConfig}
          screenWidth={screenWidth}
          onJobPress={(job) => { setSelectedJob(job); setAdminEditingTime(false); setAdminEditingPackage(false); setAdminEditingDiscount(false); setAdminEditingTax(false); setAdminEditingDeposit(false); setAdminEditingPrice(false); setShowCustomerHistory(false); }}
          onMoveAndReassign={handleMoveAdminJob}
          onResize={handleResizeAdminJob}
          isAdmin={true}
          gesturesEnabled={!selectedJob && !showCheckout}
          selectedDayOfWeek={selectedDate.getDay()}
          onRefresh={forceSync}
          refreshing={isSyncing}
        />
      )}

      {/* Job Detail Modal */}
      <Modal visible={!!selectedJob} animationType="slide" transparent={false}>
        <View style={{ flex: 1, backgroundColor: colors.surface }}>
          <View style={{ flex: 1 }}>
            {selectedJob && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* ─── Street View Hero ─── */}
                {selectedJob.address ? (
                  <View style={{ position: "relative", height: 320 }}>
                    <Image
                      source={{ uri: `https://maps.googleapis.com/maps/api/streetview?size=800x400&location=${encodeURIComponent(selectedJob.address)}&fov=90&pitch=10&key=${(Constants.expoConfig?.extra?.googleMapsApiKey as string) || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || ""}` }}
                      style={{ width: "100%", height: 320 }}
                      resizeMode="cover"
                    />
                    {/* Back button */}
                    <TouchableOpacity
                      onPress={() => { setSelectedJob(null); setShowReassignPicker(false); }}
                      style={{ position: "absolute", top: 52, left: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 6, elevation: 6 }}
                    >
                      <Text style={{ color: "#fff", fontSize: 24, fontWeight: "700" }}>‹</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 56, marginBottom: 4 }}>
                    <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground }}>Job Details</Text>
                    <TouchableOpacity onPress={() => { setSelectedJob(null); setShowReassignPicker(false); }}>
                      <Text style={{ color: colors.muted, fontSize: 24 }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <View style={{ paddingTop: selectedJob.address ? 12 : 0 }}>

                {/* Status badge */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: STATUS_COLOR[selectedJob.status] }} />
                  <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 16 }}>{STATUS_LABELS[selectedJob.status]}</Text>
                  {selectedJob.payment && (
                    <View style={{ backgroundColor: "#22C55E22", borderColor: "#22C55E55", borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                      <Text style={{ color: "#22C55E", fontWeight: "700", fontSize: 12 }}>✓ PAID</Text>
                    </View>
                  )}
                  {!selectedJob.payment && (() => {
                    const subtotal = selectedJob.price;
                    const upsells = selectedJob.upsellTotal ?? 0;
                    const discount = selectedJob.discountAmount ?? 0;
                    const tax = selectedJob.taxAmount ?? 0;
                    const deposit = selectedJob.depositAmount ?? 0;
                    const total = subtotal + upsells - discount + tax;
                    const balanceDue = total - deposit;
                    if (balanceDue > 0.01) {
                      return (
                        <View style={{ backgroundColor: "#EF444422", borderColor: "#EF444455", borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                          <Text style={{ color: "#EF4444", fontWeight: "700", fontSize: 12 }}>⚠️ UNPAID</Text>
                        </View>
                      );
                    }
                    return null;
                  })()}
                  {(() => {
                    const isApp2 = (selectedJob as any).source === "portal_app" || selectedJob.onlineBookingId?.startsWith("portal_");
                    const isWeb2 = !isApp2 && selectedJob.isOnlineBooking;
                    if (isApp2) return (
                      <View style={{ backgroundColor: "#8B5CF622", borderColor: "#8B5CF666", borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                        <Text style={{ color: "#8B5CF6", fontWeight: "700", fontSize: 12 }}>📱 App</Text>
                      </View>
                    );
                    if (isWeb2) return (
                      <View style={{ backgroundColor: "#0EA5E922", borderColor: "#0EA5E966", borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                        <Text style={{ color: "#0EA5E9", fontWeight: "700", fontSize: 12 }}>🌐 Website</Text>
                      </View>
                    );
                    return (
                      <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                        <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 12 }}>📋 Admin</Text>
                      </View>
                    );
                  })()}
                  {/* Appointment Confirmation Badge */}
                  {selectedJob.apptConfirmationStatus === "confirmed" && (
                    <View style={{ backgroundColor: "#22C55E22", borderColor: "#22C55E55", borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                      <Text style={{ color: "#22C55E", fontWeight: "700", fontSize: 12 }}>✅ APPT CONFIRMED{selectedJob.apptConfirmMethod ? ` via ${selectedJob.apptConfirmMethod.toUpperCase()}` : ""}</Text>
                    </View>
                  )}
                  {selectedJob.apptConfirmationStatus === "no_response" && (
                    <View style={{ backgroundColor: "#F59E0B22", borderColor: "#F59E0B55", borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                      <Text style={{ color: "#F59E0B", fontWeight: "700", fontSize: 12 }}>⚠️ NO RESPONSE</Text>
                    </View>
                  )}
                  {(!selectedJob.apptConfirmationStatus || selectedJob.apptConfirmationStatus === "pending") && selectedJob.apptReminderSent === 1 && (
                    <View style={{ backgroundColor: "#94A3B822", borderColor: "#94A3B855", borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                      <Text style={{ color: "#94A3B8", fontWeight: "700", fontSize: 12 }}>📨 REMINDER SENT</Text>
                    </View>
                  )}
                </View>
                {/* ── Customer Card ── */}
                <View style={{ backgroundColor: colors.background, borderRadius: 0, borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 0, borderRightWidth: 0, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 8, borderColor: colors.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>{selectedJob.firstName} {selectedJob.lastName}</Text>
                      {selectedJob.email ? <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>✉️ {selectedJob.email}</Text> : null}
                    </View>
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      {selectedJob.phone ? (
                        <>
                          <TouchableOpacity onPress={() => Linking.openURL(`sms:${selectedJob.phone}`)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#007AFF22", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ fontSize: 16 }}>💬</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => Linking.openURL(`tel:${selectedJob.phone}`)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#34C75922", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ fontSize: 16 }}>📞</Text>
                          </TouchableOpacity>
                        </>
                      ) : null}
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <TouchableOpacity
                      onPress={() => selectedJob.address ? Linking.openURL(`https://maps.apple.com/?q=${encodeURIComponent(selectedJob.address)}`) : null}
                      style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 4 }}
                    >
                      <Text style={{ color: colors.muted, fontSize: 13, flex: 1 }}>📍 {selectedJob.address || "No address set"}</Text>
                      {selectedJob.address ? <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>Navigate ›</Text> : null}
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { setEditAddressDraft(selectedJob.address || ""); setShowEditAddressModal(true); }}
                      style={{ padding: 6, borderRadius: 8, backgroundColor: colors.surface }}
                    >
                      <Text style={{ fontSize: 14 }}>✏️</Text>
                    </TouchableOpacity>
                  </View>
                  {/* ── Location Photos ── */}
                  <View style={{ paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>📸 Location Photos</Text>
                      {addressPhotos.length < 2 && (
                        <TouchableOpacity
                          onPress={handleAddAddressPhoto}
                          style={{ backgroundColor: colors.primary + "22", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 4 }}
                        >
                          {addrPhotoUploading ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>+ Add</Text>}
                        </TouchableOpacity>
                      )}
                    </View>
                    {addressPhotos.length === 0 ? (
                      <Text style={{ color: colors.muted, fontSize: 12, fontStyle: "italic" }}>No location photos yet. Add one to help detailers find the property.</Text>
                    ) : (
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        {addressPhotos.map((photo: any) => (
                          <View key={photo.photoId} style={{ position: "relative" }}>
                            <TouchableOpacity onPress={() => setViewingAddrPhoto(photo.photoUrl)}>
                              <Image source={{ uri: photo.photoUrl }} style={{ width: 100, height: 100, borderRadius: 8, backgroundColor: colors.surface }} resizeMode="cover" />
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => handleDeleteAddressPhoto(photo.photoId)}
                              style={{ position: "absolute", top: 4, right: 4, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 10, width: 20, height: 20, alignItems: "center", justifyContent: "center" }}
                            >
                              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>✕</Text>
                            </TouchableOpacity>
                            {photo.caption ? <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2, textAlign: "center", width: 100 }} numberOfLines={1}>{photo.caption}</Text> : null}
                          </View>
                        ))}
                      </View>
                    )}
                  </View>

                  <TouchableOpacity onPress={() => setShowCustomerHistory(prev => !prev)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ fontSize: 14 }}>🕐</Text>
                      <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "500" }}>Customer History</Text>
                      {customerHistory.length > 0 && <View style={{ backgroundColor: colors.primary + "22", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1 }}><Text style={{ color: colors.primary, fontSize: 11, fontWeight: "700" }}>{customerHistory.length}</Text></View>}
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 18 }}>{showCustomerHistory ? "∧" : ">"}</Text>
                  </TouchableOpacity>
                  {showCustomerHistory && (
                    <View style={{ marginTop: 10 }}>
                      {customerHistory.length === 0 ? (
                        <Text style={{ color: colors.muted, fontSize: 13, fontStyle: "italic" }}>No previous jobs found</Text>
                      ) : customerHistory.map((hj, idx) => (
                        <View key={hj.id} style={{ backgroundColor: colors.surface, borderRadius: 8, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: colors.border }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
                            <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", flex: 1 }}>{hj.serviceTitle}</Text>
                            <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "700" }}>${hj.price.toFixed(2)}</Text>
                          </View>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>{hj.createdAt ? new Date(hj.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* ── Job Schedule Card ── */}
                <View style={{ backgroundColor: colors.background, borderRadius: 0, borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 0, borderRightWidth: 0, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 8, borderColor: colors.border }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <Text style={{ fontSize: 16 }}>📅</Text>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Job Schedule</Text>
                  </View>
                  {(() => {
                    const jobDate = getWeekDates(selectedJob.weekOffset)[selectedJob.dayIndex];
                    const dayNames = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
                    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                    const dateStr = `${dayNames[selectedJob.dayIndex]} ${monthNames[jobDate.getMonth()]} ${jobDate.getDate().toString().padStart(2,"0")}`;
                    const fmtH = (h: number) => { const isHalf = h % 1 !== 0; const whole = Math.floor(h); const ampm = whole < 12 ? "a" : "p"; const h12 = whole % 12 || 12; return `${h12}:${isHalf ? "30" : "00"}${ampm}`; };
                    // Build 365-day date strip (180 past + today + 184 future) — no arbitrary lookback limit
                    const dateStrip = Array.from({ length: 365 }, (_, i) => {
                      const d = new Date(); d.setDate(d.getDate() - 180 + i); return localDateStr(d);
                    });
                    return (
                      <>
                        {adminEditingTime ? (
                          <View style={{ gap: 12 }}>
                            {/* Date strip */}
                            <View>
                              <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600", marginBottom: 6 }}>Date</Text>
                              <ScrollView ref={dateStripScrollRef} horizontal showsHorizontalScrollIndicator={false}>
                                <View style={{ flexDirection: "row", gap: 6 }}>
                                  {dateStrip.map((ds) => {
                                    const d = parseLocalDate(ds);
                                    const isSelected = ds === adminEditDate;
                                    const isToday = ds === localDateStr(new Date());
                                    return (
                                      <TouchableOpacity key={ds} onPress={() => setAdminEditDate(ds)}
                                        style={{ alignItems: "center", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: isSelected ? colors.primary : colors.surface, borderWidth: 1, borderColor: isSelected ? colors.primary : isToday ? colors.primary + "60" : colors.border, minWidth: 52 }}>
                                        <Text style={{ color: isSelected ? "#FFF" : colors.muted, fontSize: 11, fontWeight: "600" }}>{dayNames[(d.getDay() + 6) % 7]}</Text>
                                        <Text style={{ color: isSelected ? "#FFF" : colors.foreground, fontSize: 15, fontWeight: "700", marginTop: 2 }}>{d.getDate()}</Text>
                                        <Text style={{ color: isSelected ? "#FFF" : colors.muted, fontSize: 10 }}>{monthNames[d.getMonth()]}</Text>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </View>
                              </ScrollView>
                            </View>
                            {/* Start hour */}
                            <View>
                              <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600", marginBottom: 6 }}>Start Time</Text>
                              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                <View style={{ flexDirection: "row", gap: 6 }}>
                                  {HOURS.slice(0, -1).map((h) => (
                                    <TouchableOpacity key={h} onPress={() => setAdminEditStartHour(h)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: adminEditStartHour === h ? colors.primary : colors.surface, borderWidth: 1, borderColor: adminEditStartHour === h ? colors.primary : colors.border }}>
                                      <Text style={{ color: adminEditStartHour === h ? "#FFF" : colors.foreground, fontSize: 13, fontWeight: "600" }}>{fmtH(h)}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              </ScrollView>
                            </View>
                            {/* End hour */}
                            <View>
                              <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600", marginBottom: 6 }}>End Time</Text>
                              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                <View style={{ flexDirection: "row", gap: 6 }}>
                                  {HOURS.filter((h) => h > adminEditStartHour).map((h) => (
                                    <TouchableOpacity key={h} onPress={() => setAdminEditEndHour(h)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: adminEditEndHour === h ? colors.primary : colors.surface, borderWidth: 1, borderColor: adminEditEndHour === h ? colors.primary : colors.border }}>
                                      <Text style={{ color: adminEditEndHour === h ? "#FFF" : colors.foreground, fontSize: 13, fontWeight: "600" }}>{fmtH(h)}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              </ScrollView>
                            </View>
                            {/* Notify customer toggle */}
                            <TouchableOpacity
                              onPress={() => setAdminRescheduleNotify(v => !v)}
                              activeOpacity={0.8}
                              style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: adminRescheduleNotify ? "#EFF6FF" : colors.surface, borderWidth: 1, borderColor: adminRescheduleNotify ? colors.primary : colors.border, marginTop: 4 }}
                            >
                              <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: adminRescheduleNotify ? colors.primary : colors.border, backgroundColor: adminRescheduleNotify ? colors.primary : "transparent", alignItems: "center", justifyContent: "center" }}>
                                {adminRescheduleNotify && <Text style={{ color: "#fff", fontSize: 12, fontWeight: "900", lineHeight: 14 }}>✓</Text>}
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: adminRescheduleNotify ? colors.primary : colors.foreground, fontSize: 14, fontWeight: "700" }}>Notify customer by email</Text>
                                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>
                                  {adminRescheduleNotify ? "Customer will receive a reschedule confirmation email" : "No email will be sent to the customer"}
                                </Text>
                              </View>
                            </TouchableOpacity>
                            <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
                              <TouchableOpacity onPress={() => setAdminEditingTime(false)} style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
                                <Text style={{ color: colors.muted, fontSize: 14 }}>Cancel</Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => adminSaveTime(selectedJob, adminEditStartHour, adminEditEndHour, adminEditDate, adminRescheduleNotify)} style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8, backgroundColor: colors.primary }}>
                                <Text style={{ color: "#FFF", fontSize: 14, fontWeight: "600" }}>Save</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : (
                          <TouchableOpacity onPress={() => { setAdminEditStartHour(selectedJob.startHour); setAdminEditEndHour(selectedJob.endHour); setAdminEditDate(localDateStr(jobDate)); setAdminRescheduleNotify(false); setAdminEditingTime(true); setTimeout(() => { const ITEM_W = 64 + 6; const todayOffset = Math.max(0, 180 * ITEM_W - 120); dateStripScrollRef.current?.scrollTo({ x: todayOffset, animated: false }); }, 60); }} activeOpacity={0.7}>
                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 }}>
                              <Text style={{ color: colors.muted, fontSize: 15 }}>Date</Text>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>{dateStr}</Text>
                                <Text style={{ color: colors.primary, fontSize: 12 }}>✏️</Text>
                              </View>
                            </View>
                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 }}>
                              <Text style={{ color: colors.muted, fontSize: 15 }}>Start</Text>
                              <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>{fmtH(selectedJob.startHour)}</Text>
                            </View>
                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 }}>
                              <Text style={{ color: colors.muted, fontSize: 15 }}>End</Text>
                              <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>{fmtH(selectedJob.endHour)}</Text>
                            </View>
                          </TouchableOpacity>
                        )}
                      </>
                    );
                  })()}
                  {selectedJob.detailerName ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: cityConfig.detailers.find(d => d.name.toLowerCase() === selectedJob.detailerName?.toLowerCase())?.color ?? colors.primary }} />
                      <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "500" }}>{selectedJob.detailerName}</Text>
                    </View>
                  ) : null}
                </View>

                {/* ── Vehicles & Services Card ── */}
                {(() => {
                  const allVehicles = [
                    ...(selectedJob.vehicleType ? [{ vehicleType: selectedJob.vehicleType, packageId: selectedJob.packageId, addonIds: selectedJob.addonIds ?? [], addonQtys: selectedJob.addonQtys ?? {}, price: selectedJob.price, vehicleColor: selectedJob.vehicleColor, vehicleYear: selectedJob.vehicleYear, vehicleMake: selectedJob.vehicleMake, vehicleModel: selectedJob.vehicleModel }] : []),
                    ...(selectedJob.additionalVehicles ?? []),
                  ];
                  if (allVehicles.length === 0) return (
                    <View style={{ backgroundColor: colors.background, borderRadius: 0, borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 0, borderRightWidth: 0, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 8, borderColor: colors.border }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Service</Text>
                      <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>{selectedJob.serviceTitle}</Text>
                      {selectedJob.serviceDescription ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{selectedJob.serviceDescription}</Text> : null}
                    </View>
                  );
                  return (
                    <View style={{ backgroundColor: colors.background, borderRadius: 0, borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 0, borderRightWidth: 0, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 8, borderColor: colors.border }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                        <Text style={{ fontSize: 16 }}>🚗</Text>
                        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Vehicles & Services</Text>
                        {allVehicles.length > 1 && <View style={{ backgroundColor: colors.primary + "22", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}><Text style={{ color: colors.primary, fontSize: 11, fontWeight: "700" }}>{allVehicles.length} vehicles</Text></View>}
                      </View>
                      {allVehicles.map((av, idx) => {
                        const vt = VEHICLE_TYPES.find(v => v.id === av.vehicleType);
                        const pkg = allJobPackages.find(p => p.id === av.packageId);
                        const addons = (av.addonIds ?? []).map((aid: string) => ADDONS.find(a => a.id === aid)).filter(Boolean);
                        // idx 0 = primary vehicle; idx 1+ = additionalVehicles[idx-1]
                        const isEditingThis = idx === 0 ? adminEditingPackage : editingVehicleIdx === (idx - 1);
                        return (
                          <View key={idx} style={{ marginBottom: idx < allVehicles.length - 1 ? 14 : 0, paddingBottom: idx < allVehicles.length - 1 ? 14 : 0, borderBottomWidth: idx < allVehicles.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
                            {/* Vehicle header row */}
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                              <Text style={{ fontSize: 18 }}>{vt?.emoji ?? "🚗"}</Text>
                              <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700", flex: 1 }}>{[av.vehicleYear, av.vehicleMake, av.vehicleModel].filter(Boolean).join(" ") || vt?.label || "Vehicle"}</Text>
                              {av.vehicleColor ? <View style={{ backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ color: colors.muted, fontSize: 11 }}>{av.vehicleColor}</Text></View> : null}
                              {/* Delete button for additional vehicles only */}
                              {idx > 0 && (
                                <TouchableOpacity
                                  onPress={() => {
                                    Alert.alert("Remove Vehicle", `Remove ${vt?.label ?? "this vehicle"} from the job?`, [
                                      { text: "Cancel", style: "cancel" },
                                      { text: "Remove", style: "destructive", onPress: async () => {
                                        try {
                                          const result = await removeVehicleFromJobMutation.mutateAsync({ jobId: selectedJob.id, vehicleIndex: idx - 1 });
                                          setSelectedJob((prev: any) => prev ? { ...prev, additionalVehicles: result.additionalVehicles, price: result.newTotal } : prev);
                                          setJobs(prev => prev.map(j => j.id === selectedJob.id ? { ...j, additionalVehicles: result.additionalVehicles, price: result.newTotal } : j));
                                        } catch { Alert.alert("Error", "Could not remove vehicle."); }
                                      }},
                                    ]);
                                  }}
                                  style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.error + "18", alignItems: "center", justifyContent: "center" }}
                                  activeOpacity={0.7}
                                >
                                  <Text style={{ fontSize: 14 }}>🗑️</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                            {/* Package — editable for ALL vehicles */}
                            {isEditingThis ? (
                              <View style={{ marginBottom: 8 }}>
                                <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600", marginBottom: 8 }}>Select Package</Text>
                                {allJobPackages.map((p) => {
                                  const currentPkgId = idx === 0 ? selectedJob.packageId : av.packageId;
                                  return (
                                    <TouchableOpacity
                                      key={p.id}
                                      onPress={async () => {
                                        if (idx === 0) {
                                          adminSavePackage(selectedJob, p.id);
                                        } else {
                                          try {
                                            const result = await updateAdditionalVehiclePackageMutation.mutateAsync({ jobId: selectedJob.id, vehicleIndex: idx - 1, packageId: p.id });
                                            setSelectedJob((prev: any) => prev ? { ...prev, additionalVehicles: result.additionalVehicles } : prev);
                                            setJobs(prev => prev.map(j => j.id === selectedJob.id ? { ...j, additionalVehicles: result.additionalVehicles } : j));
                                            setEditingVehicleIdx(null);
                                          } catch { Alert.alert("Error", "Could not update package."); }
                                        }
                                      }}
                                      style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, marginBottom: 6, backgroundColor: (currentPkgId === p.id) ? colors.primary + "22" : colors.surface, borderWidth: 1, borderColor: (currentPkgId === p.id) ? colors.primary : colors.border }}
                                      activeOpacity={0.7}
                                    >
                                      <Text style={{ fontSize: 18 }}>{p.emoji}</Text>
                                      <View style={{ flex: 1 }}>
                                        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700" }}>{p.title}</Text>
                                        <Text style={{ color: colors.muted, fontSize: 12 }}>{p.tagline}</Text>
                                      </View>
                                      {currentPkgId === p.id && <Text style={{ color: colors.primary, fontSize: 16 }}>✓</Text>}
                                    </TouchableOpacity>
                                  );
                                })}
                                <TouchableOpacity
                                  onPress={() => { if (idx === 0) setAdminEditingPackage(false); else setEditingVehicleIdx(null); }}
                                  style={{ alignSelf: "flex-end", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: colors.border, marginTop: 4 }}
                                >
                                  <Text style={{ color: colors.muted, fontSize: 14 }}>Cancel</Text>
                                </TouchableOpacity>
                              </View>
                            ) : pkg ? (
                              <>
                                <TouchableOpacity
                                  onPress={() => { if (idx === 0) setAdminEditingPackage(true); else setEditingVehicleIdx(idx - 1); }}
                                  style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}
                                  activeOpacity={0.7}
                                >
                                  <Text style={{ color: colors.primary, fontSize: 15, fontWeight: "600" }}>{pkg.emoji} {pkg.title}</Text>
                                  <Text style={{ color: colors.primary, fontSize: 11 }}>✏️</Text>
                                </TouchableOpacity>
                                <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 6, fontStyle: "italic" }}>{pkg.tagline}</Text>
                                <View style={{ gap: 2, marginBottom: 6 }}>
                                  {pkg.features.map((f: string, fi: number) => <Text key={fi} style={{ color: colors.muted, fontSize: 13 }}>• {f}</Text>)}
                                </View>
                              </>
                            ) : (
                              <TouchableOpacity
                                onPress={() => { if (idx === 0) setAdminEditingPackage(true); else setEditingVehicleIdx(idx - 1); }}
                                style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}
                                activeOpacity={0.7}
                              >
                                <Text style={{ color: colors.muted, fontSize: 14 }}>No package — </Text>
                                <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "600" }}>Tap to assign ✏️</Text>
                              </TouchableOpacity>
                            )}
                            {addons.length > 0 ? (
                              <View style={{ marginTop: 4 }}>
                                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Add-ons</Text>
                                {addons.map((a: any) => a ? (
                                  <View key={a.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                                    <Text style={{ color: colors.foreground, fontSize: 14 }}>{a.emoji} {a.title}{(av.addonQtys?.[a.id] ?? 1) > 1 ? ` ×${av.addonQtys![a.id]}` : ""}</Text>
                                    <Text style={{ color: colors.muted, fontSize: 14 }}>+${(a.price * (av.addonQtys?.[a.id] ?? 1)).toFixed(2)}</Text>
                                  </View>
                                ) : null)}
                              </View>
                            ) : null}
                            {/* ✨ Edit / Add Add-ons button */}
                            <TouchableOpacity
                              onPress={() => {
                                const currentIds = av.addonIds ?? [];
                                const currentQtys = av.addonQtys ?? {};
                                setEditAddonsVehicleIdx(idx === 0 ? -1 : idx - 1);
                                setEditAddonsIds([...currentIds]);
                                setEditAddonsQtys({ ...currentQtys });
                                setShowEditAddonsSheet(true);
                              }}
                              style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.primary + "55", backgroundColor: colors.primary + "0D" }}
                              activeOpacity={0.7}
                            >
                              <Text style={{ fontSize: 13 }}>✨</Text>
                              <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>
                                {(av.addonIds ?? []).length > 0 ? `Edit Add-ons (${(av.addonIds ?? []).length})` : "+ Add Add-ons"}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                      {/* + Add Vehicle button */}
                      <TouchableOpacity
                        onPress={() => {
                          setAddVehicleToJobType(undefined);
                          setAddVehicleToJobPkgId(undefined);
                          setAddVehicleToJobAddonIds([]);
                          setAddVehicleToJobAddonQtys({});
                          setAddVehicleToJobYear("");
                          setAddVehicleToJobMake("");
                          setAddVehicleToJobModel("");
                          setAddVehicleToJobColor("");
                          setShowAddVehicleToJob(true);
                        }}
                        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 12, paddingVertical: 12, marginTop: 14, backgroundColor: colors.primary + "0D" }}
                        activeOpacity={0.75}
                      >
                        <Text style={{ color: colors.primary, fontSize: 18, fontWeight: "700" }}>+</Text>
                        <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>Add Another Vehicle</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })()}

                {/* ── Line Items Card ── */}
                {(() => {
                  const subtotal = selectedJob.price;
                  const upsells = selectedJob.upsellTotal ?? 0;
                  const discount = selectedJob.discountAmount ?? 0;
                  const tax = selectedJob.taxAmount ?? 0;
                  const deposit = selectedJob.depositAmount ?? 0;
                  const total = subtotal + upsells - discount + tax;
                  const balanceDue = total - deposit;
                  return (
                    <View style={{ backgroundColor: colors.background, borderRadius: 0, borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 0, borderRightWidth: 0, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 8, borderColor: colors.border }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                        <Text style={{ fontSize: 16 }}>🧾</Text>
                        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Line Items</Text>
                      </View>

                      {/* Service Total (editable) */}
                      {adminEditingPrice ? (
                        <View style={{ paddingVertical: 6, borderBottomWidth: upsells > 0 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>Service Total</Text>
                            <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.primary, borderRadius: 6, paddingHorizontal: 8, flex: 1 }}>
                              <Text style={{ color: colors.muted, fontSize: 14 }}>$</Text>
                              <TextInput
                                value={adminPriceInput}
                                onChangeText={setAdminPriceInput}
                                keyboardType="decimal-pad"
                                placeholder="0.00"
                                placeholderTextColor={colors.muted}
                                style={{ flex: 1, paddingVertical: 5, color: colors.foreground, fontSize: 14, textAlign: "right" }}
                                autoFocus
                                returnKeyType="done"
                                onSubmitEditing={() => adminSavePrice(selectedJob, adminPriceInput)}
                              />
                            </View>
                            <TouchableOpacity onPress={() => adminSavePrice(selectedJob, adminPriceInput)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.primary }}>
                              <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "600" }}>Save</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setAdminEditingPrice(false)} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
                              <Text style={{ color: colors.muted, fontSize: 12 }}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <TouchableOpacity
                          onPress={() => { setAdminPriceInput(subtotal.toFixed(2)); setAdminEditingPrice(true); }}
                          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: upsells > 0 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
                          activeOpacity={0.6}
                        >
                          <Text style={{ color: colors.muted, fontSize: 14 }}>Service Total</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Text style={{ color: colors.muted, fontSize: 14 }}>${subtotal.toFixed(2)}</Text>
                            <Text style={{ color: colors.primary, fontSize: 11 }}>✏️</Text>
                          </View>
                        </TouchableOpacity>
                      )}

                      {/* Upsell Items Breakdown */}
                      {upsells > 0 && (() => {
                        const upsellItemIds: string[] = selectedJob.upsellIds ?? [];
                        const upsellItemQtys: Record<string, number> = selectedJob.upsellQtys ?? {};
                        return (
                          <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: 6 }}>
                            {upsellItemIds.length > 0 ? upsellItemIds.map((id) => {
                              const ad = ADDONS.find((a) => a.id === id);
                              if (!ad) return null;
                              const qty = upsellItemQtys[id] ?? 1;
                              return (
                                <View key={id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                                  <Text style={{ color: colors.foreground, fontSize: 13 }}>{ad.emoji} {ad.title}{qty > 1 ? ` × ${qty}` : ""}</Text>
                                  <Text style={{ color: colors.foreground, fontSize: 13 }}>+${(ad.price * qty).toFixed(2)}</Text>
                                </View>
                              );
                            }) : (
                              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                                <Text style={{ color: colors.foreground, fontSize: 13 }}>Upsells</Text>
                                <Text style={{ color: colors.foreground, fontSize: 13 }}>+${upsells.toFixed(2)}</Text>
                              </View>
                            )}
                          </View>
                        );
                      })()}

                      {/* Subtotal */}
                      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>Subtotal</Text>
                        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>${(subtotal + upsells).toFixed(2)}</Text>
                      </View>

                      {/* Discount (always shown, editable) */}
                      <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                        {adminEditingDiscount ? (
                          <View style={{ paddingVertical: 8, gap: 8 }}>
                            <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>Discount</Text>
                            {/* $ / % toggle */}
                            <View style={{ flexDirection: "row", backgroundColor: colors.surface, borderRadius: 8, padding: 2, alignSelf: "flex-start" }}>
                              <TouchableOpacity
                                onPress={() => setAdminDiscountType("fixed")}
                                style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6, backgroundColor: adminDiscountType === "fixed" ? colors.primary : "transparent" }}
                              >
                                <Text style={{ color: adminDiscountType === "fixed" ? "#FFF" : colors.muted, fontSize: 13, fontWeight: "600" }}>$ Off</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => setAdminDiscountType("percent")}
                                style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6, backgroundColor: adminDiscountType === "percent" ? colors.primary : "transparent" }}
                              >
                                <Text style={{ color: adminDiscountType === "percent" ? "#FFF" : colors.muted, fontSize: 13, fontWeight: "600" }}>% Off</Text>
                              </TouchableOpacity>
                            </View>
                            <View style={{ flexDirection: "row", gap: 8 }}>
                              <TextInput
                                value={adminDiscountCodeInput}
                                onChangeText={setAdminDiscountCodeInput}
                                placeholder="Label (e.g. Promo)"
                                placeholderTextColor={colors.muted}
                                style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, color: colors.foreground, fontSize: 13 }}
                                returnKeyType="next"
                              />
                              <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.primary, borderRadius: 6, paddingHorizontal: 8 }}>
                                <Text style={{ color: colors.muted, fontSize: 13, marginRight: 2 }}>{adminDiscountType === "fixed" ? "$" : ""}</Text>
                                <TextInput
                                  value={adminDiscountInput}
                                  onChangeText={setAdminDiscountInput}
                                  keyboardType="decimal-pad"
                                  placeholder={adminDiscountType === "fixed" ? "0.00" : "0"}
                                  placeholderTextColor={colors.muted}
                                  style={{ width: 60, paddingVertical: 5, color: colors.foreground, fontSize: 13, textAlign: "right" }}
                                  returnKeyType="done"
                                  onSubmitEditing={() => adminSaveDiscount(selectedJob, adminDiscountInput, adminDiscountCodeInput)}
                                />
                                <Text style={{ color: colors.muted, fontSize: 13, marginLeft: 2 }}>{adminDiscountType === "percent" ? "%" : ""}</Text>
                              </View>
                            </View>
                            {adminDiscountType === "percent" && parseFloat(adminDiscountInput) > 0 && (
                              <Text style={{ color: colors.muted, fontSize: 12 }}>
                                = ${(Math.round((parseFloat(adminDiscountInput) / 100) * (selectedJob.price + (selectedJob.upsellTotal ?? 0)) * 100) / 100).toFixed(2)} off
                              </Text>
                            )}
                            <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
                              <TouchableOpacity onPress={() => setAdminEditingDiscount(false)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
                                <Text style={{ color: colors.muted, fontSize: 13 }}>Cancel</Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => adminSaveDiscount(selectedJob, adminDiscountInput, adminDiscountCodeInput)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primary }}>
                                <Text style={{ color: "#FFF", fontSize: 13, fontWeight: "600" }}>Save</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : (
                          <TouchableOpacity
                            onPress={() => { setAdminDiscountInput((discount || 0).toFixed(2)); setAdminDiscountCodeInput(selectedJob.discountCode ?? ""); setAdminDiscountType("fixed"); setAdminEditingDiscount(true); }}
                            style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 }}
                            activeOpacity={0.7}
                          >
                            <View>
                              <Text style={{ color: colors.foreground, fontSize: 15 }}>Discount</Text>
                              {selectedJob.discountCode ? <Text style={{ color: colors.muted, fontSize: 13 }}>{selectedJob.discountCode}</Text> : <Text style={{ color: colors.muted, fontSize: 13 }}>Tap to add</Text>}
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Text style={{ color: discount > 0 ? colors.error : colors.muted, fontSize: 15, fontWeight: "600" }}>{discount > 0 ? `-$${discount.toFixed(2)}` : "$0.00"}</Text>
                              <Text style={{ color: colors.primary, fontSize: 11 }}>✏️</Text>
                            </View>
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Tax */}
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                        <Text style={{ color: colors.foreground, fontSize: 15 }}>Tax</Text>
                        {adminEditingTax ? (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <TextInput value={adminTaxInput} onChangeText={setAdminTaxInput} keyboardType="decimal-pad" style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, color: colors.foreground, fontSize: 13, minWidth: 70, textAlign: "right" }} autoFocus returnKeyType="done" onSubmitEditing={() => adminSaveTax(selectedJob, adminTaxInput)} />
                            <TouchableOpacity onPress={() => adminSaveTax(selectedJob, adminTaxInput)}><Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>Save</Text></TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity onPress={() => { setAdminTaxInput(tax.toFixed(2)); setAdminEditingTax(true); }} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>${tax.toFixed(2)}</Text>
                            <Text style={{ color: colors.primary, fontSize: 11 }}>✏️</Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Total */}
                      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                        <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>Total</Text>
                        <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "700" }}>${total.toFixed(2)}</Text>
                      </View>

                      {/* Deposit (always shown, editable) */}
                      <View style={{ borderBottomWidth: deposit > 0 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
                        {adminEditingDeposit ? (
                          <View style={{ paddingVertical: 8, gap: 6 }}>
                            <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>Deposit Received</Text>
                            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                              <TextInput
                                value={adminDepositInput}
                                onChangeText={setAdminDepositInput}
                                keyboardType="decimal-pad"
                                placeholder="0.00"
                                placeholderTextColor={colors.muted}
                                autoFocus
                                style={{ flex: 1, borderWidth: 1, borderColor: colors.primary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, color: colors.foreground, fontSize: 13, textAlign: "right" }}
                                returnKeyType="done"
                                onSubmitEditing={() => adminSaveDeposit(selectedJob, adminDepositInput)}
                              />
                              <TouchableOpacity onPress={() => adminSaveDeposit(selectedJob, adminDepositInput)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primary }}>
                                <Text style={{ color: "#FFF", fontSize: 13, fontWeight: "600" }}>Save</Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => setAdminEditingDeposit(false)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
                                <Text style={{ color: colors.muted, fontSize: 13 }}>Cancel</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : (
                          <TouchableOpacity
                            onPress={() => { setAdminDepositInput((deposit || 0).toFixed(2)); setAdminEditingDeposit(true); }}
                            style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 }}
                            activeOpacity={0.7}
                          >
                            <View>
                              <Text style={{ color: colors.foreground, fontSize: 15 }}>Deposit</Text>
                              {deposit === 0 ? <Text style={{ color: colors.muted, fontSize: 13 }}>Tap to record</Text> : null}
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Text style={{ color: deposit > 0 ? colors.success : colors.muted, fontSize: 15, fontWeight: "600" }}>{deposit > 0 ? `-$${deposit.toFixed(2)}` : "$0.00"}</Text>
                              <Text style={{ color: colors.primary, fontSize: 11 }}>✏️</Text>
                            </View>
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Balance Due (only when deposit > 0) */}
                      {deposit > 0 ? (
                        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, marginTop: 2, backgroundColor: balanceDue <= 0 ? "#22C55E11" : colors.surface, borderRadius: 8, paddingHorizontal: 8 }}>
                          <Text style={{ color: balanceDue <= 0 ? "#22C55E" : colors.foreground, fontSize: 15, fontWeight: "700" }}>{balanceDue <= 0 ? "✓ Paid in Full" : "Balance Due"}</Text>
                          <Text style={{ color: balanceDue <= 0 ? "#22C55E" : colors.primary, fontSize: 15, fontWeight: "700" }}>${Math.max(0, balanceDue).toFixed(2)}</Text>
                        </View>
                      ) : null}

                      {selectedJob.payment ? (() => {
                        const jobTotal = (selectedJob.price ?? 0) + (selectedJob.upsellTotal ?? 0) - (selectedJob.discountAmount ?? 0) - (selectedJob.depositAmount ?? 0) + (selectedJob.taxAmount ?? 0);
                        const paidAmount = selectedJob.payment.total;
                        const remaining = Math.max(0, jobTotal - paidAmount);
                        const isPartial = remaining > 0.01;
                        return (
                          <View style={{ gap: 6, marginTop: 4 }}>
                            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, backgroundColor: isPartial ? "#F59E0B11" : "#22C55E11", borderRadius: 8, paddingHorizontal: 8 }}>
                              <Text style={{ color: isPartial ? "#F59E0B" : "#22C55E", fontSize: 15, fontWeight: "700" }}>{isPartial ? "⚠️ Partial Payment" : "✓ PAID"}</Text>
                              <Text style={{ color: isPartial ? "#F59E0B" : "#22C55E", fontSize: 15, fontWeight: "700" }}>${paidAmount.toFixed(2)} paid</Text>
                            </View>
                            {isPartial && (
                              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, backgroundColor: "#EF444411", borderRadius: 8, paddingHorizontal: 8 }}>
                                <Text style={{ color: "#EF4444", fontSize: 14, fontWeight: "700" }}>Remaining Balance</Text>
                                <Text style={{ color: "#EF4444", fontSize: 14, fontWeight: "700" }}>${remaining.toFixed(2)}</Text>
                              </View>
                            )}
                          </View>
                        );
                      })() : null}
                    </View>
                  );
                })()}

                {/* ── Job Progress Card ── */}
                {(() => {
                  const steps: { key: JobStatus; label: string; emoji: string; ts?: string | null }[] = [
                    { key: "scheduled", label: "Scheduled", emoji: "📅", ts: selectedJob.createdAt },
                    { key: "on_my_way", label: "On My Way", emoji: "🚚", ts: selectedJob.onMyWayAt },
                    { key: "started", label: "Arrived / Started", emoji: "🔧", ts: selectedJob.arrivedAt },
                    { key: "finished", label: "Finished", emoji: "✅", ts: selectedJob.finishedAt ?? selectedJob.jobFinishedAt ?? undefined },
                  ];
                  const statusRank: Record<JobStatus, number> = { scheduled: 0, on_my_way: 1, started: 2, finished: 3, pending: 0, confirmed: 0, in_progress: 2, completed: 3, cancelled: 4 };
                  const currentRank = statusRank[selectedJob.status] ?? 0;

                  // ── Time calculations ──
                  const fmtMins = (ms: number) => {
                    const totalMins = Math.round(ms / 60000);
                    const h = Math.floor(totalMins / 60);
                    const m = totalMins % 60;
                    if (h > 0) return `${h}h ${m}m`;
                    return `${m}m`;
                  };
                  const driveMs = selectedJob.onMyWayAt && selectedJob.arrivedAt
                    ? new Date(selectedJob.arrivedAt).getTime() - new Date(selectedJob.onMyWayAt).getTime()
                    : null;
                  const finishedTs = selectedJob.finishedAt ?? selectedJob.jobFinishedAt;
                  const detailMs = selectedJob.arrivedAt && finishedTs
                    ? new Date(finishedTs).getTime() - new Date(selectedJob.arrivedAt).getTime()
                    : null;
                  const totalMs = driveMs !== null && detailMs !== null ? driveMs + detailMs : null;

                  return (
                    <View style={{ backgroundColor: colors.background, borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 0, borderRightWidth: 0, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 8, borderColor: colors.border }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
                        <Text style={{ fontSize: 16 }}>📊</Text>
                        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Job Progress</Text>
                      </View>
                      <View style={{ flexDirection: "row", gap: 12 }}>
                        {/* Left: timeline */}
                        <View style={{ flex: 1, gap: 0 }}>
                          {steps.map((step, i) => {
                            const stepRank = statusRank[step.key] ?? i;
                            const isCompleted = currentRank > stepRank;
                            const isCurrent = currentRank === stepRank;
                            const isPending = currentRank < stepRank;
                            const dotColor = isCompleted ? "#22C55E" : isCurrent ? colors.primary : colors.border;
                            const lineColor = isCompleted ? "#22C55E" : colors.border;
                            return (
                              <View key={step.key} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                                {/* Timeline spine */}
                                <View style={{ alignItems: "center", width: 18 }}>
                                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: dotColor, alignItems: "center", justifyContent: "center", marginTop: 2 }}>
                                    {isCompleted && <Text style={{ color: "#fff", fontSize: 8, fontWeight: "900" }}>✓</Text>}
                                    {isCurrent && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: "#fff" }} />}
                                  </View>
                                  {i < steps.length - 1 && <View style={{ width: 2, height: 26, backgroundColor: lineColor, marginTop: 2 }} />}
                                </View>
                                {/* Step label */}
                                <View style={{ flex: 1, paddingTop: 0 }}>
                                  <Text style={{ fontSize: 13, fontWeight: isCurrent ? "700" : "500", color: isPending ? colors.muted : colors.foreground }}>
                                    {step.emoji} {step.label}
                                  </Text>
                                  {step.ts && (isCompleted || isCurrent) ? (
                                    <Text style={{ fontSize: 10, color: colors.muted, marginTop: 1, marginBottom: 4 }}>
                                      {(() => { try { const d = new Date(step.ts!); return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Chicago" }); } catch { return step.ts; } })()}
                                    </Text>
                                  ) : <View style={{ height: 4 }} />}
                                </View>
                              </View>
                            );
                          })}
                        </View>

                        {/* Right: time summary */}
                        <View style={{ width: 110, gap: 6, paddingTop: 2 }}>
                          <View style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.border, gap: 6 }}>
                            <View>
                              <Text style={{ fontSize: 9, fontWeight: "700", color: colors.muted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 2 }}>Drive Time</Text>
                              <Text style={{ fontSize: 15, fontWeight: "800", color: driveMs !== null ? colors.primary : colors.muted }}>
                                {driveMs !== null ? fmtMins(driveMs) : "—"}
                              </Text>
                            </View>
                            <View style={{ height: 1, backgroundColor: colors.border }} />
                            <View>
                              <Text style={{ fontSize: 9, fontWeight: "700", color: colors.muted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 2 }}>Detail Time</Text>
                              <Text style={{ fontSize: 15, fontWeight: "800", color: detailMs !== null ? colors.foreground : colors.muted }}>
                                {detailMs !== null ? fmtMins(detailMs) : "—"}
                              </Text>
                            </View>
                            <View style={{ height: 1, backgroundColor: colors.border }} />
                            <View>
                              <Text style={{ fontSize: 9, fontWeight: "700", color: colors.muted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 2 }}>Complete Job</Text>
                              <Text style={{ fontSize: 15, fontWeight: "800", color: totalMs !== null ? "#22C55E" : colors.muted }}>
                                {totalMs !== null ? fmtMins(totalMs) : "—"}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                })()}

                {/* ── Payment Detail Card ── */}
                {selectedJob.payment ? (
                  <View style={{ backgroundColor: colors.background, borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 0, borderRightWidth: 0, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 8, borderColor: colors.border }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                      <Text style={{ fontSize: 16 }}>💳</Text>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Payment</Text>
                      <View style={{ marginLeft: "auto" as any, backgroundColor: "#22C55E22", borderColor: "#22C55E55", borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                        <Text style={{ color: "#22C55E", fontWeight: "700", fontSize: 12 }}>✓ PAID</Text>
                      </View>
                    </View>
                    {([
                      { label: "Method", value: ({ credit_debit: "Credit / Debit", cash: "Cash", check: "Check", other: "Other", tap_to_pay: "Tap to Pay", apple_pay: "Apple Pay" } as Record<string,string>)[selectedJob.payment.method] ?? selectedJob.payment.method },
                      { label: "Subtotal", value: `$${selectedJob.payment.subtotal.toFixed(2)}` },
                      { label: "Tip", value: `$${selectedJob.payment.tipAmount.toFixed(2)}` },
                      { label: "Total", value: `$${selectedJob.payment.total.toFixed(2)}`, bold: true },
                      { label: "Paid At", value: (() => { try { return new Date(selectedJob.payment!.paidAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Chicago" }); } catch { return selectedJob.payment!.paidAt; } })() },
                    ] as { label: string; value: string; bold?: boolean }[]).map((row, i, arr) => (
                      <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: i < arr.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
                        <Text style={{ color: colors.muted, fontSize: 14 }}>{row.label}</Text>
                        <Text style={{ color: row.bold ? "#22C55E" : colors.foreground, fontSize: 14, fontWeight: row.bold ? "700" : "500" }}>{row.value}</Text>
                      </View>
                    ))}
                    {selectedJob.payment.referenceNote ? (
                      <View style={{ marginTop: 8, backgroundColor: colors.surface, borderRadius: 8, padding: 10 }}>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>Note: {selectedJob.payment.referenceNote}</Text>
                      </View>
                    ) : null}

                    {/* Refund history */}
                    {refundHistory.length > 0 && (
                      <View style={{ marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 10 }}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Refunds Issued</Text>
                        {refundHistory.map((r: any) => (
                          <View key={r.refundRecordId} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                            <Text style={{ color: colors.muted, fontSize: 13 }}>{new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {r.issuedBy}</Text>
                            <Text style={{ color: "#EF4444", fontSize: 13, fontWeight: "700" }}>-${(r.amountCents / 100).toFixed(2)}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Issue Refund button — only for card payments with a paymentIntentId */}
                    {selectedJob.payment.paymentIntentId && (
                      <TouchableOpacity
                        onPress={() => { setRefundAmount(""); setRefundNote(""); setRefundReason("requested_by_customer"); setShowRefundModal(true); }}
                        activeOpacity={0.8}
                        style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#EF444418", borderWidth: 1, borderColor: "#EF444455", borderRadius: 10, paddingVertical: 10 }}
                      >
                        <Text style={{ fontSize: 15 }}>↩️</Text>
                        <Text style={{ color: "#EF4444", fontWeight: "700", fontSize: 14 }}>Issue Refund</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}

                {/* ── Refund Modal ── */}
                <Modal visible={showRefundModal} transparent animationType="fade" onRequestClose={() => setShowRefundModal(false)}>
                  <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 24 }}>
                    <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 24, width: "100%", maxWidth: 400 }}>
                      <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>↩️ Issue Refund</Text>
                      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 20 }}>
                        {selectedJob?.firstName} {selectedJob?.lastName} · ${selectedJob?.payment?.total?.toFixed(2) ?? "0.00"} paid
                      </Text>

                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Refund Amount ($)</Text>
                      <TextInput
                        value={refundAmount}
                        onChangeText={setRefundAmount}
                        placeholder={`Max $${selectedJob?.payment?.total?.toFixed(2) ?? "0.00"}`}
                        placeholderTextColor={colors.muted}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: colors.foreground, fontSize: 16, marginBottom: 14, backgroundColor: colors.background }}
                      />

                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Reason</Text>
                      {(["requested_by_customer", "duplicate", "fraudulent"] as const).map((r) => (
                        <TouchableOpacity key={r} onPress={() => setRefundReason(r)} activeOpacity={0.7}
                          style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: refundReason === r ? colors.primary : colors.border, backgroundColor: refundReason === r ? colors.primary : "transparent", alignItems: "center", justifyContent: "center" }}>
                            {refundReason === r && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" }} />}
                          </View>
                          <Text style={{ color: colors.foreground, fontSize: 14 }}>{{ requested_by_customer: "Customer Request", duplicate: "Duplicate Charge", fraudulent: "Fraudulent" }[r]}</Text>
                        </TouchableOpacity>
                      ))}

                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6, marginTop: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Internal Note (optional)</Text>
                      <TextInput
                        value={refundNote}
                        onChangeText={setRefundNote}
                        placeholder="e.g. Customer complained about service quality"
                        placeholderTextColor={colors.muted}
                        multiline
                        returnKeyType="done"
                        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: colors.foreground, fontSize: 14, marginBottom: 20, backgroundColor: colors.background, minHeight: 72, textAlignVertical: "top" }}
                      />

                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <TouchableOpacity onPress={() => setShowRefundModal(false)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 13, alignItems: "center" }}>
                          <Text style={{ color: colors.muted, fontWeight: "600" }}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          disabled={refundLoading || !refundAmount || parseFloat(refundAmount) <= 0}
                          onPress={async () => {
                            if (!selectedJob?.payment?.paymentIntentId) return;
                            const cents = Math.round(parseFloat(refundAmount) * 100);
                            const maxCents = Math.round((selectedJob.payment.total ?? 0) * 100);
                            if (cents > maxCents) {
                              Alert.alert("Invalid Amount", `Refund cannot exceed the original payment of $${selectedJob.payment.total.toFixed(2)}.`);
                              return;
                            }
                            setRefundLoading(true);
                            try {
                              await refundMutation.mutateAsync({
                                paymentIntentId: selectedJob.payment.paymentIntentId!,
                                amountCents: cents,
                                reason: refundReason,
                                adminNote: refundNote || undefined,
                                issuedBy: "admin",
                                jobId: selectedJob.id,
                                customerName: `${selectedJob.firstName ?? ""} ${selectedJob.lastName ?? ""}`.trim() || undefined,
                                customerEmail: selectedJob.email || undefined,
                                customerPhone: selectedJob.phone || undefined,
                              });
                              setShowRefundModal(false);
                              Alert.alert("✅ Refund Issued", `$${parseFloat(refundAmount).toFixed(2)} has been refunded to the customer${selectedJob.email ? " and a confirmation email has been sent" : ""}.`);
                            } catch (err: any) {
                              Alert.alert("Refund Failed", err?.message ?? "An error occurred while processing the refund. Please try again.");
                            } finally {
                              setRefundLoading(false);
                            }
                          }}
                          style={{ flex: 2, backgroundColor: refundLoading || !refundAmount || parseFloat(refundAmount || "0") <= 0 ? "#EF444488" : "#EF4444", borderRadius: 12, paddingVertical: 13, alignItems: "center" }}
                        >
                          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{refundLoading ? "Processing..." : `Refund $${refundAmount || "0.00"}`}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </Modal>

                {/* ── Job Photos Card ── */}
                {(() => {
                  const photos = selectedJob.photoUrls ?? [];
                  if (photos.length === 0) return null;
                  return (
                    <View style={{ backgroundColor: colors.background, borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 0, borderRightWidth: 0, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 8, borderColor: colors.border }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                        <Text style={{ fontSize: 16 }}>📸</Text>
                        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Job Photos</Text>
                        <Text style={{ color: colors.muted, fontSize: 13, marginLeft: 4 }}>({photos.length})</Text>
                      </View>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                        {photos.map((url) => (
                          <TouchableOpacity key={url} onPress={() => setAdminPhotoPreview(url)} activeOpacity={0.85}>
                            <Image source={{ uri: url }} style={{ width: 90, height: 90, borderRadius: 8, backgroundColor: colors.surface }} resizeMode="cover" />
                          </TouchableOpacity>
                        ))}
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 8 }}>Tap a photo to view full screen.</Text>
                    </View>
                  );
                })()}

                {/* ── Private Notes Card ── */}
                {(() => {
                  const hasNotes = (selectedJob.privateNotes ?? []).length > 0;
                  return hasNotes ? (
                    <AdminPrivateNotesCard
                      job={selectedJob}
                      onNotesChange={(notes: PrivateNote[]) => {
                        // Filter out __new__ placeholder before persisting
                        const realNotes = notes.filter((n) => n.id !== "__new__");
                        setSelectedJob((prev) => prev ? { ...prev, privateNotes: realNotes } : prev);
                        // Persist to AsyncStorage so notes survive refresh (persistJobs also calls setJobs)
                        persistJobs(jobs.map((j) => j.id === selectedJob.id ? { ...j, privateNotes: realNotes } : j));
                      }}
                    />
                  ) : (
                    <View style={{ backgroundColor: colors.background, borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 0, borderRightWidth: 0, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 8, borderColor: colors.border }}>
                      <TouchableOpacity
                        onPress={() => setSelectedJob((prev) => prev ? { ...prev, privateNotes: [{ id: "__new__", text: "", authorId: "admin", authorName: "Admin", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] } : prev)}
                        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                        activeOpacity={0.7}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={{ fontSize: 16 }}>📝</Text>
                          <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>Private Notes</Text>
                        </View>
                        <Text style={{ color: colors.primary, fontSize: 22, fontWeight: "300" }}>+</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })()}

                {/* ── Lead Source Row ── */}
                {(() => {
                  const isPortalApp = selectedJob.onlineBookingId?.startsWith("portal_") || (selectedJob as any).source === "portal_app";
                  const isOnline = !isPortalApp && selectedJob.isOnlineBooking;
                  const isAI = selectedJob.leadSource === "AI Receptionist";
                  const label = isPortalApp ? "📱 App" : isOnline ? "🌐 Website" : isAI ? "🤖 AI Receptionist" : "📋 Admin — Manual";
                  const bg = isPortalApp ? "#8B5CF622" : isOnline ? "#0EA5E922" : isAI ? "#7c3aed22" : colors.surface;
                  const border = isPortalApp ? "#8B5CF666" : isOnline ? "#0EA5E966" : isAI ? "#7c3aed66" : colors.border;
                  const textColor = isPortalApp ? "#8B5CF6" : isOnline ? "#0EA5E9" : isAI ? "#7c3aed" : colors.muted;
                  return (
                    <View style={{ backgroundColor: colors.background, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: 16 }}>📡</Text>
                        <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>Lead Source</Text>
                      </View>
                      <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 }}>
                        <Text style={{ color: textColor, fontSize: 14, fontWeight: "600" }}>{label}</Text>
                      </View>
                    </View>
                  );
                })()}

                {/* ── Job Tags Card ── */}
                <View style={{ backgroundColor: colors.background, borderRadius: 0, borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 0, borderRightWidth: 0, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 8, borderColor: colors.border }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <Text style={{ fontSize: 16 }}>🏷️</Text>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Job Tags</Text>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {(selectedJob.tags ?? []).map((tag) => (
                      <TouchableOpacity key={tag} onPress={() => adminRemoveTag(selectedJob, tag)} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primary + "22", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 }}>
                        <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>{tag}</Text>
                        <Text style={{ color: colors.primary, fontSize: 11 }}>✕</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TextInput value={adminTagInput} onChangeText={setAdminTagInput} placeholder="Add tag..." placeholderTextColor={colors.muted} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, color: colors.foreground, fontSize: 14 }} returnKeyType="done" onSubmitEditing={() => adminAddTag(selectedJob, adminTagInput)} />
                    <TouchableOpacity onPress={() => adminAddTag(selectedJob, adminTagInput)} style={{ backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6, justifyContent: "center" }}>
                      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* ── Reassign Section ── */}

                {/* ── Collect Payment Button ── */}
                {!selectedJob.payment && allowLegacyJobAuthority && (
                  <TouchableOpacity
                    onPress={() => setShowCheckout(true)}
                    activeOpacity={0.8}
                    style={{ marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#22C55E18", borderWidth: 1, borderColor: "#22C55E55", borderRadius: 12, paddingVertical: 14 }}
                  >
                    <Text style={{ fontSize: 18 }}>💳</Text>
                    <Text style={{ color: "#22C55E", fontWeight: "700", fontSize: 16 }}>Collect Payment</Text>
                  </TouchableOpacity>
                )}

                {/* ── Send Invoice Button ── */}
                {allowLegacyJobAuthority && (
                <TouchableOpacity
                  onPress={() => {
                    const jobTotal = (selectedJob.price ?? 0) + (selectedJob.upsellTotal ?? 0) - (selectedJob.discountAmount ?? 0) - (selectedJob.depositAmount ?? 0) + (selectedJob.taxAmount ?? 0);
                    const alreadyPaid = selectedJob.payment?.total ?? 0;
                    // If any payment has been recorded, show remaining balance mode automatically
                    const remainingOnly = alreadyPaid > 0.01;
                    setInvoiceMethod("email");
                    setInvoiceSentUrl(null);
                    setInvoiceRemainingOnly(remainingOnly);
                    setInvoiceOverrideContact(selectedJob.email ?? "");
                    setShowInvoiceSheet(true);
                  }}
                  activeOpacity={0.8}
                  style={{ marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#0a7ea418", borderWidth: 1, borderColor: "#0a7ea455", borderRadius: 12, paddingVertical: 14 }}
                >
                  <Text style={{ fontSize: 18 }}>📧</Text>
                  <Text style={{ color: "#0a7ea4", fontWeight: "700", fontSize: 16 }}>Send Invoice</Text>
                </TouchableOpacity>
                )}

                {/* ── Send Receipt Button (only when job has payment recorded) ── */}
                {selectedJob.payment && allowLegacyJobAuthority && (
                  <TouchableOpacity
                    onPress={async () => {
                      if (!selectedJob.email) {
                        Alert.alert("No Email", "This customer has no email on file.");
                        return;
                      }
                      setSendingJobReceipt(true);
                      try {
                        await sendJobReceiptMutation.mutateAsync({ jobId: selectedJob.id });
                        Alert.alert("Receipt Sent ✅", `Payment receipt emailed to ${selectedJob.email}.`);
                      } catch (err: any) {
                        Alert.alert("Error", err.message ?? "Failed to send receipt");
                      } finally {
                        setSendingJobReceipt(false);
                      }
                    }}
                    activeOpacity={0.8}
                    disabled={sendingJobReceipt}
                    style={{ marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#6366F118", borderWidth: 1, borderColor: "#6366F155", borderRadius: 12, paddingVertical: 14, opacity: sendingJobReceipt ? 0.6 : 1 }}
                  >
                    <Text style={{ fontSize: 18 }}>🧾</Text>
                    <Text style={{ color: "#6366F1", fontWeight: "700", fontSize: 16 }}>
                      {sendingJobReceipt ? "Sending Receipt..." : "Send Receipt to Customer"}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* ── Send Remaining Balance Button (only when partial payment exists) ── */}
                {(() => {
                  if (isJobSyncCompany || !selectedJob.payment) return null;
                  const jobTotal = (selectedJob.price ?? 0) + (selectedJob.upsellTotal ?? 0) - (selectedJob.discountAmount ?? 0) - (selectedJob.depositAmount ?? 0) + (selectedJob.taxAmount ?? 0);
                  const remaining = Math.max(0, jobTotal - selectedJob.payment.total);
                  if (remaining <= 0.01) return null;
                  return (
                    <TouchableOpacity
                      onPress={() => {
                        setInvoiceMethod("email");
                        setInvoiceSentUrl(null);
                        setInvoiceRemainingOnly(true);
                        setInvoiceOverrideContact(selectedJob.email ?? "");
                        setShowInvoiceSheet(true);
                      }}
                      activeOpacity={0.8}
                      style={{ marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#EF444418", borderWidth: 1, borderColor: "#EF444455", borderRadius: 12, paddingVertical: 14 }}
                    >
                      <Text style={{ fontSize: 18 }}>💰</Text>
                      <Text style={{ color: "#EF4444", fontWeight: "700", fontSize: 16 }}>Send Remaining Balance (${remaining.toFixed(2)})</Text>
                    </TouchableOpacity>
                  );
                })()}

                {/* Move to City button */}
                <TouchableOpacity
                  onPress={() => setShowMoveCityPicker(true)}
                  activeOpacity={0.8}
                  style={{ marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.primary + "18", borderWidth: 1, borderColor: colors.primary + "55", borderRadius: 12, paddingVertical: 12 }}
                >
                  <Text style={{ fontSize: 16 }}>🏙️</Text>
                  <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 15 }}>Move to City</Text>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>({CITY_LIST.find(c => c.slug === (selectedJob?.location ?? selectedCity))?.label ?? selectedJob?.location ?? selectedCity})</Text>
                </TouchableOpacity>

                {/* Charge Card on File button — only shown when job is unpaid */}
                {!selectedJob?.payment && allowLegacyJobAuthority && (
                  <TouchableOpacity
                    onPress={() => {
                      const cards = (scheduleSavedCards as any[]) ?? [];
                      if (cards.length === 0) {
                        // Trigger query first, then show modal
                        refetchScheduleCards();
                        Alert.alert(
                          "Checking Cards",
                          "Looking up saved cards for this customer...",
                          [{ text: "OK", onPress: () => {
                            const total = (selectedJob.price ?? 0) + (selectedJob.upsellTotal ?? 0) - (selectedJob.discountAmount ?? 0) + (selectedJob.taxAmount ?? 0);
                            setChargeAmount(total.toFixed(2));
                            const defaultCard = (scheduleSavedCards as any[] ?? []).find((c: any) => c.isDefault) ?? (scheduleSavedCards as any[] ?? [])[0];
                            setSelectedChargeCardId(defaultCard?.stripePaymentMethodId ?? null);
                            setShowChargeModal(true);
                          }}]
                        );
                        return;
                      }
                      const total = (selectedJob.price ?? 0) + (selectedJob.upsellTotal ?? 0) - (selectedJob.discountAmount ?? 0) + (selectedJob.taxAmount ?? 0);
                      setChargeAmount(total.toFixed(2));
                      const defaultCard = cards.find((c: any) => c.isDefault) ?? cards[0];
                      setSelectedChargeCardId(defaultCard?.stripePaymentMethodId ?? null);
                      setShowChargeModal(true);
                    }}
                    activeOpacity={0.8}
                    style={{ marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#22c55e15", borderWidth: 1, borderColor: "#22c55e40", borderRadius: 12, paddingVertical: 14 }}
                  >
                    <Text style={{ fontSize: 18 }}>💳</Text>
                    <Text style={{ color: "#22c55e", fontWeight: "700", fontSize: 16 }}>Charge Card on File</Text>
                  </TouchableOpacity>
                )}

                {/* Cancel Job button — marks as cancelled, stays visible in history */}
                {!selectedJob?.recurrenceParentId && (
                  <TouchableOpacity
                    onPress={() => {
                      if (!selectedJob) return;
                      Alert.alert("Cancel Job", "Mark this job as cancelled? It will remain visible in history with a Cancelled badge.", [
                        { text: "Dismiss", style: "cancel" },
                        {
                          text: "Cancel Job",
                          style: "destructive",
                          onPress: async () => {
                            if (!allowLegacyJobAuthority) {
                              const jobId = canonicalJobId(selectedJob.id);
                              if (!isJobSyncCompany || !jobId || !jobSyncSession?.token) {
                                Alert.alert("Cancel unavailable", COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
                                return;
                              }
                              try {
                                await updateJobSyncCompanyJobStatus(jobSyncSession.token, jobId, { status: "cancelled" });
                                setSelectedJob(null);
                                forceSync();
                              } catch (error) {
                                Alert.alert("Job not cancelled", error instanceof Error ? error.message : COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
                              }
                              return;
                            }
                            await jobCancelMutation.mutateAsync({ jobId: selectedJob.id });
                            setJobs(prev => prev.map(j => j.id === selectedJob.id ? { ...j, status: "cancelled" } : j));
                            setSelectedJob(null);
                          },
                        },
                      ]);
                    }}
                    activeOpacity={0.8}
                    style={{ marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.warning + "18", borderWidth: 1, borderColor: colors.warning + "55", borderRadius: 12, paddingVertical: 12 }}
                  >
                    <Text style={{ fontSize: 16 }}>🚫</Text>
                    <Text style={{ color: colors.warning, fontWeight: "700", fontSize: 15 }}>Cancel Job</Text>
                  </TouchableOpacity>
                )}

                {/* Revert to Pending button — only for finished/completed jobs, keeps paid flag */}
                {!isJobSyncCompany && (selectedJob?.status === "finished" || selectedJob?.status === "completed") && (
                  <TouchableOpacity
                    onPress={() => {
                      if (!selectedJob) return;
                      Alert.alert(
                        "Revert to Pending",
                        "This will set the job back to Pending (as if not started). The PAID status and payment record will be kept. The customer portal will show this as an upcoming appointment.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Revert to Pending",
                            onPress: async () => {
                              try {
                                await jobStatusMutation.mutateAsync({
                                  jobId: selectedJob.id,
                                  status: "confirmed" as any,
                                  tips: selectedJob.payment?.tipAmount ?? 0,
                                  upsellTotal: selectedJob.upsellTotal ?? 0,
                                });
                                setJobs(prev => prev.map(j =>
                                  j.id === selectedJob.id ? { ...j, status: "scheduled" as any } : j
                                ));
                                setSelectedJob(prev => prev ? { ...prev, status: "scheduled" as any } : prev);
                                if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                Alert.alert("Reverted ✅", "Job is now Pending. Payment record is preserved.");
                              } catch (e: any) {
                                Alert.alert("Error", e.message ?? "Failed to revert job status.");
                              }
                            },
                          },
                        ]
                      );
                    }}
                    activeOpacity={0.8}
                    style={{ marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#F59E0B18", borderWidth: 1, borderColor: "#F59E0B55", borderRadius: 12, paddingVertical: 12 }}
                  >
                    <Text style={{ fontSize: 16 }}>↩️</Text>
                    <Text style={{ color: "#F59E0B", fontWeight: "700", fontSize: 15 }}>Revert to Pending (Keep Paid)</Text>
                  </TouchableOpacity>
                )}

                {/* Delete Job button — completely removes from all views */}
                {!isJobSyncCompany && <TouchableOpacity
                  onPress={() => {
                    if (!selectedJob) return;
                    if (selectedJob.recurrenceParentId) {
                      // Recurring job — show options
                      Alert.alert(
                        "Delete Recurring Job",
                        "This will permanently remove the job from all views including the customer portal and detailer schedule.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "This Job Only",
                            onPress: async () => {
                              await jobDeleteMutation.mutateAsync({ jobId: selectedJob.id });
                              setJobs(prev => prev.filter(j => j.id !== selectedJob.id));
                              setSelectedJob(null);
                            },
                          },
                          {
                            text: "This & All Future",
                            style: "destructive",
                            onPress: async () => {
                              const jobDate = (() => {
                                const today = new Date();
                const monday = new Date(today);
                monday.setDate(today.getDate() - (today.getDay() + 6) % 7);
                monday.setHours(0, 0, 0, 0);
                const d = new Date(monday);
                d.setDate(monday.getDate() + selectedJob.weekOffset * 7 + selectedJob.dayIndex);
                                return d.toISOString().slice(0, 10);
                              })();
                              await jobDeleteRecurringMutation.mutateAsync({
                                recurrenceParentId: selectedJob.recurrenceParentId!,
                                mode: "future",
                                fromDate: jobDate,
                              });
                              forceSync();
                              setSelectedJob(null);
                            },
                          },
                          {
                            text: "Entire Series",
                            style: "destructive",
                            onPress: async () => {
                              await jobDeleteRecurringMutation.mutateAsync({
                                recurrenceParentId: selectedJob.recurrenceParentId!,
                                mode: "all",
                              });
                              forceSync();
                              setSelectedJob(null);
                            },
                          },
                        ]
                      );
                    } else {
                      Alert.alert("Delete Job", "Permanently remove this job from all views? This cannot be undone and will also remove it from the customer portal and detailer schedule.", [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete Permanently",
                          style: "destructive",
                          onPress: async () => {
                            await jobDeleteMutation.mutateAsync({ jobId: selectedJob.id });
                            setJobs(prev => prev.filter(j => j.id !== selectedJob.id));
                            setSelectedJob(null);
                          },
                        },
                      ]);
                    }
                  }}
                  activeOpacity={0.8}
                  style={{ marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.error + "18", borderWidth: 1, borderColor: colors.error + "55", borderRadius: 12, paddingVertical: 12 }}
                >
                  <Text style={{ fontSize: 16 }}>🗑️</Text>
                  <Text style={{ color: colors.error, fontWeight: "700", fontSize: 15 }}>Delete Job</Text>
                </TouchableOpacity>}
                {/* Cancel Recurring Job button — only shown for recurring jobs */}
                {selectedJob?.recurrenceParentId && (
                  <TouchableOpacity
                    onPress={() => {
                      if (!selectedJob) return;
                      const getJobDate = () => {
                        const today = new Date();
                        const monday = new Date(today);
                        monday.setDate(today.getDate() - (today.getDay() + 6) % 7);
                        monday.setHours(0, 0, 0, 0);
                        const d = new Date(monday);
                        d.setDate(monday.getDate() + selectedJob.weekOffset * 7 + selectedJob.dayIndex);
                        return d.toISOString().slice(0, 10);
                      };
                      Alert.alert(
                        "Cancel Recurring Job",
                        "How would you like to cancel this recurring job?",
                        [
                          { text: "Dismiss", style: "cancel" },
                          {
                            text: "This Job Only",
                            onPress: async () => {
                              await jobCancelRecurringMutation.mutateAsync({
                                recurrenceParentId: selectedJob.recurrenceParentId!,
                                mode: "single",
                                jobId: selectedJob.id,
                              });
                              setJobs(prev => prev.map(j => j.id === selectedJob.id ? { ...j, status: "cancelled" } : j));
                              setSelectedJob(null);
                            },
                          },
                          {
                            text: "This & All Future",
                            style: "destructive",
                            onPress: async () => {
                              const jobDate = getJobDate();
                              await jobCancelRecurringMutation.mutateAsync({
                                recurrenceParentId: selectedJob.recurrenceParentId!,
                                mode: "future",
                                fromDate: jobDate,
                              });
                              forceSync();
                              setSelectedJob(null);
                            },
                          },
                          {
                            text: "Entire Series",
                            style: "destructive",
                            onPress: async () => {
                              await jobCancelRecurringMutation.mutateAsync({
                                recurrenceParentId: selectedJob.recurrenceParentId!,
                                mode: "all",
                              });
                              forceSync();
                              setSelectedJob(null);
                            },
                          },
                        ]
                      );
                    }}
                    activeOpacity={0.8}
                    style={{ marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.warning + "18", borderWidth: 1, borderColor: colors.warning + "55", borderRadius: 12, paddingVertical: 12 }}
                  >
                    <Text style={{ fontSize: 16 }}>🚫</Text>
                    <Text style={{ color: colors.warning, fontWeight: "700", fontSize: 15 }}>Cancel Recurring Job</Text>
                  </TouchableOpacity>
                )}
                {!showReassignPicker ? (
                  <TouchableOpacity
                    onPress={() => setShowReassignPicker(true)}
                    activeOpacity={0.8}
                    style={{ marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.primary + "18", borderWidth: 1, borderColor: colors.primary + "55", borderRadius: 12, paddingVertical: 12 }}
                  >
                    <Text style={{ fontSize: 16 }}>🔄</Text>
                    <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 15 }}>Reassign Team Member</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ marginTop: 14, backgroundColor: colors.background, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Reassign to:</Text>
                      <TouchableOpacity onPress={() => setShowReassignPicker(false)}>
                        <Text style={{ color: colors.muted, fontSize: 18 }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    {cityConfig.detailers.map((d) => (
                      <TouchableOpacity
                        key={d.name}
                        activeOpacity={0.8}
                        onPress={async () => {
                          if (!selectedJob) return;
                          try {
                            await jobReassignMutation.mutateAsync({ jobId: selectedJob.id, newAssignedTo: d.name });
                            // Update local state
                            setJobs(prev => prev.map(j => j.id === selectedJob.id ? { ...j, detailerName: d.name } : j));
                            setSelectedJob({ ...selectedJob, detailerName: d.name });
                            setShowReassignPicker(false);
                          } catch (err) {
                            console.error("Reassign failed:", err);
                          }
                        }}
                        style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, marginBottom: 8,
                          backgroundColor: selectedJob.detailerName === d.name ? d.color + "22" : colors.surface,
                          borderWidth: 1.5, borderColor: selectedJob.detailerName === d.name ? d.color : colors.border }}
                      >
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: d.color }} />
                        <Text style={{ color: colors.foreground, fontWeight: selectedJob.detailerName === d.name ? "700" : "500", fontSize: 15, flex: 1 }}>{d.name}</Text>
                        {selectedJob.detailerName === d.name && <Text style={{ color: d.color, fontSize: 13, fontWeight: "700" }}>✓ Current</Text>}
                      </TouchableOpacity>
                    ))}
                  </View>
                 )}
                </View>{/* end paddingHorizontal wrapper */}
              </ScrollView>
            )}
          </View>
        </View>
        {/* Edit Address Modal */}
        {/* Full-screen Address Photo Viewer */}
        {viewingAddrPhoto && (
          <Modal visible transparent animationType="fade" onRequestClose={() => setViewingAddrPhoto(null)}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center", alignItems: "center" }}>
              <TouchableOpacity onPress={() => setViewingAddrPhoto(null)} style={{ position: "absolute", top: 60, right: 20, zIndex: 10, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700" }}>✕</Text>
              </TouchableOpacity>
              <Image source={{ uri: viewingAddrPhoto }} style={{ width: "92%", height: "70%", borderRadius: 12 }} resizeMode="contain" />
            </View>
          </Modal>
        )}

        {showEditAddressModal && selectedJob && (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 24 }}>
            <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 24, width: "100%" }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, marginBottom: 6 }}>📍 Edit Address</Text>
              <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 16 }}>Changes will reflect on both admin and detailer calendars immediately.</Text>
              <TextInput
                value={editAddressDraft}
                onChangeText={setEditAddressDraft}
                placeholder="Enter full address"
                placeholderTextColor={colors.muted}
                multiline
                style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, fontSize: 14, minHeight: 60, marginBottom: 20 }}
              />
              <View style={{ flexDirection: "row", gap: 12 }}>
                <TouchableOpacity
                  onPress={() => setShowEditAddressModal(false)}
                  style={{ flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
                >
                  <Text style={{ color: colors.foreground, fontWeight: "600" }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    if (!selectedJob || savingAddress) return;
                    setSavingAddress(true);
                    try {
                      await jobMetaMutation.mutateAsync({ jobId: selectedJob.id, customerAddress: editAddressDraft.trim() });
                      // Update local state so the address shows immediately without a refetch
                      setSelectedJob((prev: any) => prev ? { ...prev, address: editAddressDraft.trim() } : prev);
                      setShowEditAddressModal(false);
                    } catch (e) {
                      Alert.alert("Error", "Failed to update address. Please try again.");
                    } finally {
                      setSavingAddress(false);
                    }
                  }}
                  style={{ flex: 1, padding: 14, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center", opacity: savingAddress ? 0.6 : 1 }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700" }}>{savingAddress ? "Saving..." : "Save Address"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Move to City Overlay */}
        {showMoveCityPicker && selectedJob && (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 24 }}>
            <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 24, width: "100%" }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, marginBottom: 6 }}>🏙️ Move to City</Text>
              <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 16 }}>Select the city calendar to move this job to. The job will be removed from the current city and appear in the new one.</Text>
              <View style={{ gap: 8, marginBottom: 20 }}>
                {CITY_LIST.map((city) => {
                  const isCurrent = city.slug === (selectedJob.location ?? selectedCity);
                  return (
                    <TouchableOpacity
                      key={city.slug}
                      onPress={async () => {
                        if (isCurrent || movingToCity) return;
                        setMovingToCity(true);
                        try {
                          // Compute date string from weekOffset + dayIndex
                          const today = new Date();
                          const monday = new Date(today);
                          monday.setDate(today.getDate() - (today.getDay() + 6) % 7);
                          monday.setHours(0, 0, 0, 0);
                          const d = new Date(monday);
                          d.setDate(monday.getDate() + selectedJob.weekOffset * 7 + selectedJob.dayIndex);
                          const dateStr = d.toISOString().slice(0, 10);
                          // Map local UI status back to server enum
                          const statusMap: Record<string, string> = { scheduled: "confirmed", started: "in_progress", finished: "completed" };
                          const serverStatus = statusMap[selectedJob.status] || selectedJob.status;
                          await jobUpsertMutation.mutateAsync({
                            jobId: selectedJob.id,
                            location: city.slug,
                            date: dateStr,
                            timeSlot: `${formatHour(selectedJob.startHour)} - ${formatHour(selectedJob.endHour)}`,
                            startHour: selectedJob.startHour,
                            endHour: selectedJob.endHour,
                            customerName: `${selectedJob.firstName} ${selectedJob.lastName}`.trim(),
                            customerPhone: selectedJob.phone,
                            customerEmail: selectedJob.email,
                            vehicleType: selectedJob.vehicleType,
                            packageType: selectedJob.packageType,
                            totalPrice: selectedJob.price,
                            assignedTo: selectedJob.assignedTo,
                            status: serverStatus as any,
                            customerAddress: selectedJob.address,
                            notifyCustomer: false,
                          });
                          // Update local state
                          setJobs(prev => prev.map(j => j.id === selectedJob.id ? { ...j, location: city.slug } : j));
                          setSelectedJob(prev => prev ? { ...prev, location: city.slug } : prev);
                          setShowMoveCityPicker(false);
                          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                          Alert.alert("Moved!", `Job moved to ${city.label} calendar.`);
                        } catch (e) {
                          Alert.alert("Error", "Failed to move job. Please try again.");
                        } finally {
                          setMovingToCity(false);
                        }
                      }}
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 10, borderWidth: 1.5, borderColor: isCurrent ? colors.primary : colors.border, backgroundColor: isCurrent ? colors.primary + "18" : colors.background }}
                    >
                      <Text style={{ color: isCurrent ? colors.primary : colors.foreground, fontWeight: isCurrent ? "700" : "500", fontSize: 15 }}>{city.label}</Text>
                      {isCurrent && <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>Current</Text>}
                      {movingToCity && !isCurrent && <ActivityIndicator size="small" color={colors.primary} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                onPress={() => setShowMoveCityPicker(false)}
                style={{ padding: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
              >
                <Text style={{ color: colors.foreground, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Add Another Vehicle Modal — rendered inside the job detail Modal */}
        {showAddVehicleToJob && selectedJob && (() => {
          const isRvSelected = isRvVehicle(addVehicleToJobType);
          const packagesToShow = isRvSelected
            ? rvPackages
            : allJobPackages.filter((p) => !p.isRv);
          const addonsTotal = ADDONS.reduce((s, a) => s + a.price * (addVehicleToJobAddonQtys[a.id] ?? 0), 0);
          const selectedPkg = packagesToShow.find((p) => p.id === addVehicleToJobPkgId);
          const pkgBasePrice = addVehicleToJobType && selectedPkg
            ? ((selectedPkg.basePrice as Partial<Record<VehicleType, number>>)[addVehicleToJobType] ?? 0)
            : 0;
          const vehicleTotal = pkgBasePrice + addonsTotal;
          return (
            <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
              <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
                <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "88%" }}>
                  {/* Header */}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                    <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>🚗 Add Another Vehicle</Text>
                    <TouchableOpacity onPress={() => setShowAddVehicleToJob(false)} style={{ padding: 4 }}>
                      <Text style={{ color: colors.muted, fontSize: 22 }}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={{ padding: 20 }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

                    {/* Vehicle Type */}
                    <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.6 }}>Vehicle Type</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                      {VEHICLE_TYPES.filter(v => !v.group).map((v) => {
                        const sel = addVehicleToJobType === v.id;
                        return (
                          <TouchableOpacity
                            key={v.id}
                            onPress={() => { setAddVehicleToJobType(v.id); setAddVehicleToJobPkgId(undefined); setAddVehicleToJobAddonIds([]); setAddVehicleToJobAddonQtys({}); }}
                            style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : colors.surface }}
                            activeOpacity={0.75}
                          >
                            <Text style={{ fontSize: 16 }}>{v.emoji}</Text>
                            <Text style={{ color: sel ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13, marginLeft: 6 }}>{v.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 6, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.6 }}>RV Services</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                      {VEHICLE_TYPES.filter(v => v.group === "rv").map((v) => {
                        const sel = addVehicleToJobType === v.id;
                        return (
                          <TouchableOpacity
                            key={v.id}
                            onPress={() => { setAddVehicleToJobType(v.id); setAddVehicleToJobPkgId(undefined); setAddVehicleToJobAddonIds([]); setAddVehicleToJobAddonQtys({}); }}
                            style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : colors.surface }}
                            activeOpacity={0.75}
                          >
                            <Text style={{ fontSize: 16 }}>{v.emoji}</Text>
                            <Text style={{ color: sel ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13, marginLeft: 6 }}>{v.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {/* Package Picker */}
                    {addVehicleToJobType && (
                      <>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.6 }}>Package</Text>
                        {packagesToShow.map((p) => {
                          const pkgPrice = (p.basePrice as Partial<Record<VehicleType, number>>)[addVehicleToJobType!] ?? 0;
                          const sel = addVehicleToJobPkgId === p.id;
                          return (
                            <TouchableOpacity
                              key={p.id}
                              onPress={() => { setAddVehicleToJobPkgId(p.id); setAddVehicleToJobAddonIds([]); setAddVehicleToJobAddonQtys({}); }}
                              style={{ borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: sel ? 2 : 1, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary + "15" : colors.background }}
                              activeOpacity={0.8}
                            >
                              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
                                <Text style={{ fontSize: 18, marginRight: 8 }}>{p.emoji}</Text>
                                <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14, flex: 1 }}>{p.title}</Text>
                                <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 15 }}>${pkgPrice}</Text>
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

                    {/* Add-ons */}
                    {addVehicleToJobType && addVehicleToJobPkgId && (
                      <>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 8, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.6 }}>Add-Ons (Optional)</Text>
                        {!isRvSelected && ADDONS.map((a) => {
                          const qty = addVehicleToJobAddonQtys[a.id] ?? 0;
                          return (
                            <View key={a.id} style={{ flexDirection: "row", alignItems: "center", borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: qty > 0 ? 1.5 : 1, borderColor: qty > 0 ? colors.primary : colors.border, backgroundColor: qty > 0 ? colors.primary + "10" : colors.surface }}>
                              <Text style={{ fontSize: 18, marginRight: 8 }}>{a.emoji}</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 13 }}>{a.title}</Text>
                                <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 11 }}>${a.price}{qty > 1 ? ` × ${qty} = $${(a.price * qty).toFixed(0)}` : ""}</Text>
                              </View>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                <TouchableOpacity
                                  onPress={() => {
                                    const nq = Math.max(0, qty - 1);
                                    const newQtys = { ...addVehicleToJobAddonQtys, [a.id]: nq };
                                    if (nq === 0) delete newQtys[a.id];
                                    setAddVehicleToJobAddonQtys(newQtys);
                                    setAddVehicleToJobAddonIds(ADDONS.filter(ad => (newQtys[ad.id] ?? 0) > 0).map(ad => ad.id));
                                  }}
                                  style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: colors.border, justifyContent: "center", alignItems: "center", opacity: qty === 0 ? 0.3 : 1 }}
                                  disabled={qty === 0}
                                >
                                  <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>−</Text>
                                </TouchableOpacity>
                                <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 13, minWidth: 16, textAlign: "center" }}>{qty}</Text>
                                <TouchableOpacity
                                  onPress={() => {
                                    const nq = qty + 1;
                                    const newQtys = { ...addVehicleToJobAddonQtys, [a.id]: nq };
                                    setAddVehicleToJobAddonQtys(newQtys);
                                    setAddVehicleToJobAddonIds(ADDONS.filter(ad => (newQtys[ad.id] ?? 0) > 0).map(ad => ad.id));
                                  }}
                                  style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: colors.border, justifyContent: "center", alignItems: "center" }}
                                >
                                  <Text style={{ color: colors.primary, fontSize: 15, fontWeight: "700" }}>+</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        })}
                        {addonsTotal > 0 && (
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.primary + "44", backgroundColor: colors.primary + "12", padding: 14, marginTop: 4, marginBottom: 8 }}>
                            <Text style={{ color: colors.foreground, fontWeight: "600" }}>Add-ons Total</Text>
                            <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 17 }}>${addonsTotal.toFixed(0)}</Text>
                          </View>
                        )}
                      </>
                    )}

                    {/* Vehicle Details (optional) */}
                    {addVehicleToJobType && addVehicleToJobPkgId && (
                      <>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 8, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.6 }}>Vehicle Details (Optional)</Text>
                        <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "600", marginBottom: 4 }}>Year</Text>
                            <TextInput
                              value={addVehicleToJobYear}
                              onChangeText={setAddVehicleToJobYear}
                              placeholder="2022"
                              placeholderTextColor={colors.muted}
                              keyboardType="number-pad"
                              maxLength={4}
                              returnKeyType="next"
                              style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, fontSize: 14 }}
                            />
                          </View>
                          <View style={{ flex: 2 }}>
                            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "600", marginBottom: 4 }}>Make</Text>
                            <TextInput
                              value={addVehicleToJobMake}
                              onChangeText={setAddVehicleToJobMake}
                              placeholder="Toyota"
                              placeholderTextColor={colors.muted}
                              returnKeyType="next"
                              style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, fontSize: 14 }}
                            />
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
                          <View style={{ flex: 2 }}>
                            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "600", marginBottom: 4 }}>Model</Text>
                            <TextInput
                              value={addVehicleToJobModel}
                              onChangeText={setAddVehicleToJobModel}
                              placeholder="Camry"
                              placeholderTextColor={colors.muted}
                              returnKeyType="next"
                              style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, fontSize: 14 }}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "600", marginBottom: 4 }}>Color</Text>
                            <TextInput
                              value={addVehicleToJobColor}
                              onChangeText={setAddVehicleToJobColor}
                              placeholder="White"
                              placeholderTextColor={colors.muted}
                              returnKeyType="done"
                              style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, fontSize: 14 }}
                            />
                          </View>
                        </View>
                      </>
                    )}

                    {/* Price Summary + Save */}
                    {addVehicleToJobType && addVehicleToJobPkgId && (
                      <View style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.primary + "44", backgroundColor: colors.primary + "08", padding: 16, marginTop: 8, marginBottom: 8 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                          <Text style={{ color: colors.muted, fontSize: 13 }}>Package</Text>
                          <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 13 }}>${pkgBasePrice}</Text>
                        </View>
                        {addonsTotal > 0 && (
                          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                            <Text style={{ color: colors.muted, fontSize: 13 }}>Add-ons</Text>
                            <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 13 }}>+${addonsTotal}</Text>
                          </View>
                        )}
                        <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 8, marginTop: 4 }}>
                          <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15 }}>Vehicle Total</Text>
                          <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 17 }}>${vehicleTotal}</Text>
                        </View>
                      </View>
                    )}

                    {/* Action Buttons */}
                    <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
                      <TouchableOpacity
                        onPress={() => setShowAddVehicleToJob(false)}
                        style={{ flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
                        activeOpacity={0.8}
                      >
                        <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 15 }}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={async () => {
                          if (!addVehicleToJobType || !addVehicleToJobPkgId || !selectedJob) return;
                          setAddVehicleToJobSaving(true);
                          try {
                            const result = await appendVehicleToJobMutation.mutateAsync({
                              jobId: selectedJob.id,
                              vehicleType: addVehicleToJobType,
                              packageId: addVehicleToJobPkgId,
                              addonIds: addVehicleToJobAddonIds,
                              addonQtys: addVehicleToJobAddonQtys,
                              vehicleYear: addVehicleToJobYear || undefined,
                              vehicleMake: addVehicleToJobMake || undefined,
                              vehicleModel: addVehicleToJobModel || undefined,
                              vehicleColor: addVehicleToJobColor || undefined,
                              price: vehicleTotal,
                            });
                            // Update local state immediately so the new vehicle shows without a refetch
                            if (result.success) {
                              setSelectedJob((prev: any) => prev ? {
                                ...prev,
                                additionalVehicles: result.additionalVehicles,
                                price: result.newTotal,
                              } : prev);
                              setJobs(prev => prev.map(j => j.id === selectedJob.id ? { ...j, price: result.newTotal, additionalVehicles: result.additionalVehicles } : j));
                              forceSync();
                            }
                            setShowAddVehicleToJob(false);
                          } catch (err: any) {
                            Alert.alert("Error", err.message ?? "Could not add vehicle. Please try again.");
                          } finally {
                            setAddVehicleToJobSaving(false);
                          }
                        }}
                        disabled={!addVehicleToJobType || !addVehicleToJobPkgId || addVehicleToJobSaving}
                        style={{ flex: 2, padding: 14, borderRadius: 12, backgroundColor: (!addVehicleToJobType || !addVehicleToJobPkgId || addVehicleToJobSaving) ? colors.muted : colors.primary, alignItems: "center" }}
                        activeOpacity={0.8}
                      >
                        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
                          {addVehicleToJobSaving ? "Saving…" : `Add Vehicle${vehicleTotal > 0 ? ` · $${vehicleTotal}` : ""}`}
                        </Text>
                      </TouchableOpacity>
                    </View>

                  </ScrollView>
                </View>
              </KeyboardAvoidingView>
            </View>
          );
        })()}

        {/* ✨ Edit Add-ons Sheet */}
        {showEditAddonsSheet && selectedJob && (() => {
          const isRvJob = isRvVehicle(selectedJob.vehicleType);
          return (
            <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
              <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
                <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "88%" }}>
                  {/* Header */}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                    <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>✨ Add-ons</Text>
                    <TouchableOpacity onPress={() => setShowEditAddonsSheet(false)} style={{ padding: 4 }}>
                      <Text style={{ color: colors.muted, fontSize: 22 }}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={{ padding: 20 }} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
                    <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 16 }}>
                      Select add-ons for this vehicle. Changes will update the job total.
                    </Text>

                    {isRvJob ? (
                      <Text style={{ color: colors.muted, fontSize: 14, textAlign: "center", paddingVertical: 24 }}>Add-ons are not available for RV jobs.</Text>
                    ) : (
                      ADDONS.map((a) => {
                        const qty = editAddonsQtys[a.id] ?? 0;
                        return (
                          <View key={a.id} style={{ flexDirection: "row", alignItems: "center", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: qty > 0 ? 1.5 : 1, borderColor: qty > 0 ? colors.primary : colors.border, backgroundColor: qty > 0 ? colors.primary + "10" : colors.surface }}>
                            <Text style={{ fontSize: 20, marginRight: 10 }}>{a.emoji}</Text>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 14 }}>{a.title}</Text>
                              <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 12 }}>${a.price}{qty > 1 ? ` × ${qty} = $${(a.price * qty).toFixed(0)}` : ""}</Text>
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <TouchableOpacity
                                onPress={() => {
                                  const nq = Math.max(0, qty - 1);
                                  const newQtys = { ...editAddonsQtys, [a.id]: nq };
                                  if (nq === 0) delete newQtys[a.id];
                                  setEditAddonsQtys(newQtys);
                                  setEditAddonsIds(ADDONS.filter(ad => (newQtys[ad.id] ?? 0) > 0).map(ad => ad.id));
                                }}
                                disabled={qty === 0}
                                style={{ width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: colors.border, justifyContent: "center", alignItems: "center", opacity: qty === 0 ? 0.3 : 1 }}
                              >
                                <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>−</Text>
                              </TouchableOpacity>
                              <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14, minWidth: 18, textAlign: "center" }}>{qty}</Text>
                              <TouchableOpacity
                                onPress={() => {
                                  const nq = qty + 1;
                                  const newQtys = { ...editAddonsQtys, [a.id]: nq };
                                  setEditAddonsQtys(newQtys);
                                  setEditAddonsIds(ADDONS.filter(ad => (newQtys[ad.id] ?? 0) > 0).map(ad => ad.id));
                                }}
                                style={{ width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: colors.border, justifyContent: "center", alignItems: "center" }}
                              >
                                <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "700" }}>+</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })
                    )}

                    {editAddonsIds.length > 0 && (
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.primary + "44", backgroundColor: colors.primary + "12", padding: 14, marginTop: 4, marginBottom: 8 }}>
                        <Text style={{ color: colors.foreground, fontWeight: "600" }}>Add-ons Total</Text>
                        <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 17 }}>${ADDONS.reduce((s, ad) => s + ad.price * (editAddonsQtys[ad.id] ?? 0), 0).toFixed(0)}</Text>
                      </View>
                    )}

                    {/* Save / Cancel */}
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                      <TouchableOpacity
                        onPress={() => setShowEditAddonsSheet(false)}
                        style={{ flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
                        activeOpacity={0.8}
                      >
                        <Text style={{ color: colors.foreground, fontWeight: "600" }}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={async () => {
                          if (editAddonsSaving) return;
                          setEditAddonsSaving(true);
                          try {
                            // Calculate old addon total from the vehicle's current addons
                            const vehicleIdx = editAddonsVehicleIdx;
                            let oldIds: string[] = [];
                            let oldQtys: Record<string, number> = {};
                            if (vehicleIdx === -1) {
                              oldIds = selectedJob.addonIds ?? [];
                              oldQtys = selectedJob.addonQtys ?? {};
                            } else {
                              const av = (selectedJob.additionalVehicles ?? [])[vehicleIdx];
                              oldIds = av?.addonIds ?? [];
                              oldQtys = av?.addonQtys ?? {};
                            }
                            const oldTotal = ADDONS.reduce((s, a) => s + a.price * (oldQtys[a.id] ?? 0), 0);
                            const newTotal = ADDONS.reduce((s, a) => s + a.price * (editAddonsQtys[a.id] ?? 0), 0);
                            const delta = newTotal - oldTotal;
                            const result = await updateJobAddonsMutation.mutateAsync({
                              jobId: selectedJob.id,
                              vehicleIndex: vehicleIdx,
                              addonIds: editAddonsIds,
                              addonQtys: editAddonsQtys,
                              addonPriceDelta: delta,
                            });
                            if (result.success) {
                              if (vehicleIdx === -1) {
                                setSelectedJob((prev: any) => prev ? {
                                  ...prev,
                                  addonIds: editAddonsIds,
                                  addonQtys: editAddonsQtys,
                                  price: result.newTotal,
                                } : prev);
                                setJobs(prev => prev.map(j => j.id === selectedJob.id ? { ...j, addonIds: editAddonsIds, addonQtys: editAddonsQtys, price: result.newTotal } : j));
                              } else {
                                setSelectedJob((prev: any) => prev ? {
                                  ...prev,
                                  additionalVehicles: result.additionalVehicles,
                                  price: result.newTotal,
                                } : prev);
                                setJobs(prev => prev.map(j => j.id === selectedJob.id ? { ...j, additionalVehicles: result.additionalVehicles, price: result.newTotal } : j));
                              }
                              forceSync();
                              setShowEditAddonsSheet(false);
                            }
                          } catch (err: any) {
                            Alert.alert("Error", err.message ?? "Could not save add-ons. Please try again.");
                          } finally {
                            setEditAddonsSaving(false);
                          }
                        }}
                        disabled={editAddonsSaving}
                        style={{ flex: 2, padding: 14, borderRadius: 12, backgroundColor: editAddonsSaving ? colors.muted : colors.primary, alignItems: "center" }}
                        activeOpacity={0.8}
                      >
                        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
                          {editAddonsSaving ? "Saving…" : `Save Add-ons${editAddonsIds.length > 0 ? ` (${editAddonsIds.length})` : ""}`}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </ScrollView>
                </View>
              </KeyboardAvoidingView>
            </View>
          );
        })()}

        {/* Invoice Sheet — rendered inside the job detail Modal so it layers on top correctly */}
        {showInvoiceSheet && selectedJob && (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
            <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 }}>
              {/* Header */}
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>📧 Send Invoice</Text>
                <TouchableOpacity onPress={() => setShowInvoiceSheet(false)}>
                  <Text style={{ color: colors.muted, fontSize: 24 }}>✕</Text>
                </TouchableOpacity>
              </View>

              {invoiceSentUrl ? (
                <View style={{ alignItems: "center", paddingVertical: 24, gap: 12 }}>
                  <Text style={{ fontSize: 48 }}>✅</Text>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>Invoice Sent!</Text>
                  <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center" }}>
                    The customer will receive a secure payment link to pay online.
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowInvoiceSheet(false)}
                    style={{ marginTop: 8, backgroundColor: colors.primary, borderRadius: 50, paddingVertical: 12, paddingHorizontal: 32 }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Done</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {/* Invoice preview */}
                  <View style={{ backgroundColor: colors.background, borderRadius: 12, padding: 16, marginBottom: 20, gap: 8 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ color: colors.muted, fontSize: 13 }}>Customer</Text>
                      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{selectedJob.firstName} {selectedJob.lastName}</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ color: colors.muted, fontSize: 13 }}>Service</Text>
                      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{selectedJob.packageId ? selectedJob.packageId.replace(/_/g, " ") : (selectedJob.packageType ?? "Detail")}</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ color: colors.muted, fontSize: 13 }}>Date</Text>
                      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{localDateStr(getWeekDates(selectedJob.weekOffset)[selectedJob.dayIndex])}</Text>
                    </View>
                    <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
                    {selectedJob.payment && (
                      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                        <Text style={{ color: colors.muted, fontSize: 13 }}>Previously Paid</Text>
                        <Text style={{ color: "#22C55E", fontSize: 13, fontWeight: "600" }}>-${selectedJob.payment.total.toFixed(2)}</Text>
                      </View>
                    )}
                    {(() => {
                      const jobTotal = (selectedJob.price ?? 0) + (selectedJob.upsellTotal ?? 0) - (selectedJob.discountAmount ?? 0) - (selectedJob.depositAmount ?? 0) + (selectedJob.taxAmount ?? 0);
                      const alreadyPaid = selectedJob.payment?.total ?? 0;
                      const balanceDue = Math.max(0, jobTotal - alreadyPaid);
                      const isPaidInFull = alreadyPaid >= jobTotal - 0.01;
                      return (
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                          <Text style={{ color: isPaidInFull ? "#22C55E" : colors.foreground, fontSize: 15, fontWeight: "700" }}>
                            {alreadyPaid > 0.01 ? (isPaidInFull ? "✓ Paid in Full" : "Remaining Balance") : "Amount Due"}
                          </Text>
                          <Text style={{ color: isPaidInFull ? "#22C55E" : (alreadyPaid > 0.01 ? "#EF4444" : "#0a7ea4"), fontSize: 18, fontWeight: "800" }}>
                            ${balanceDue.toFixed(2)}
                          </Text>
                        </View>
                      );
                    })()}
                  </View>

                  {/* Delivery method picker */}
                  <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>Send Via</Text>
                  <View style={{ flexDirection: "row", gap: 10, marginBottom: 20 }}>
                    {(["email", "sms"] as const).map(m => (
                      <TouchableOpacity
                        key={m}
                        onPress={() => setInvoiceMethod(m)}
                        style={[
                          { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14, borderWidth: 2 },
                          invoiceMethod === m
                            ? { backgroundColor: "#0a7ea418", borderColor: "#0a7ea4" }
                            : { backgroundColor: colors.background, borderColor: colors.border },
                        ]}
                      >
                        <Text style={{ fontSize: 18 }}>{m === "email" ? "📧" : "💬"}</Text>
                        <Text style={{ fontWeight: "600", fontSize: 15, color: invoiceMethod === m ? "#0a7ea4" : colors.foreground }}>
                          {m === "email" ? "Email" : "Text (SMS)"}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Contact info — editable */}
                  <View style={{ marginBottom: 20 }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
                      {invoiceMethod === "email" ? "Send to Email" : "Send to Phone"}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderWidth: 1.5, borderColor: "#0a7ea4", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 4 }}>
                      <Text style={{ fontSize: 16, marginRight: 8 }}>{invoiceMethod === "email" ? "✉️" : "📱"}</Text>
                      <TextInput
                        value={invoiceOverrideContact}
                        onChangeText={setInvoiceOverrideContact}
                        placeholder={invoiceMethod === "email" ? "customer@email.com" : "+1 (555) 000-0000"}
                        placeholderTextColor={colors.muted}
                        keyboardType={invoiceMethod === "email" ? "email-address" : "phone-pad"}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="done"
                        style={{ flex: 1, color: colors.foreground, fontSize: 15, paddingVertical: 12 }}
                      />
                      <TouchableOpacity onPress={() => setInvoiceOverrideContact("")} style={{ padding: 4 }}>
                        <Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 11, marginTop: 5, marginLeft: 2 }}>Tap to edit — defaults to customer's {invoiceMethod === "email" ? "email on file" : "phone on file"}</Text>
                  </View>

                  {/* Send button */}
                    <TouchableOpacity
                    onPress={async () => {
                      if (isJobSyncCompany) {
                        Alert.alert("Invoice unavailable", "Company invoice delivery will be available after the Home Service Connected billing contract is published.");
                        return;
                      }
                      setInvoiceSending(true);
                      try {
                        const resp = await fetch(`${APP_API_BASE}/api/invoice/send`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            jobId: selectedJob.id,
                            method: invoiceMethod,
                            discountAmount: selectedJob.discountAmount ?? 0,
                            depositAmount: selectedJob.depositAmount ?? 0,
                            remainingOnly: (selectedJob.payment?.total ?? 0) > 0.01,
                            previouslyPaid: selectedJob.payment?.total ?? 0,
                            overrideEmail: invoiceMethod === "email" ? invoiceOverrideContact : undefined,
                            overridePhone: invoiceMethod === "sms" ? invoiceOverrideContact : undefined,
                          }),
                        });
                        const data = await resp.json();
                        if (!resp.ok) throw new Error(data.error ?? "Failed to send");
                        setInvoiceSentUrl(data.paymentUrl);
                      } catch (err: any) {
                        Alert.alert("Send Failed", err.message ?? "Could not send invoice. Please try again.");
                      } finally {
                        setInvoiceSending(false);
                      }
                    }}
                    disabled={invoiceSending}
                    activeOpacity={0.8}
                    style={{ backgroundColor: invoiceSending ? "#aaa" : "#0a7ea4", borderRadius: 50, paddingVertical: 16, alignItems: "center" }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
                      {invoiceSending ? "Sending…" : invoiceRemainingOnly ? `Send Remaining Balance via ${invoiceMethod === "email" ? "Email" : "Text"}` : `Send Invoice via ${invoiceMethod === "email" ? "Email" : "Text"}`}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )}

        {/* Photo Preview overlay — full-screen tap-to-close */}
        {adminPhotoPreview ? (
          <TouchableOpacity
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.93)", alignItems: "center", justifyContent: "center" }}
            onPress={() => setAdminPhotoPreview(null)}
            activeOpacity={1}
          >
            <Image source={{ uri: adminPhotoPreview }} style={{ width: "95%", height: "80%" }} resizeMode="contain" />
            <Text style={{ color: "rgba(255,255,255,0.55)", marginTop: 14, fontSize: 14 }}>Tap to close</Text>
          </TouchableOpacity>
        ) : null}

        {/* Checkout overlay — rendered inside the job detail Modal to avoid stacked-modal iOS touch issues */}
        {selectedJob && (
          <AdminCheckoutModal
            visible={showCheckout}
            job={selectedJob}
            customerPhone={selectedJob.phone ?? null}
            customerEmail={selectedJob.email ?? null}
            onClose={() => setShowCheckout(false)}
            onComplete={(payment) => {
              const completedJob = selectedJob;
              // Update local UI with payment info but do NOT change status to finished —
              // the detailer must tap Finished themselves to complete the job.
              setJobs(prev => prev.map(j => j.id === completedJob.id ? { ...j, payment } : j));
              setSelectedJob(prev => prev ? { ...prev, payment } : prev);
              setShowCheckout(false);
              // Save tips + upsellTotal to DB (status stays unchanged — detailer controls completion)
              jobStatusMutation.mutate({ jobId: completedJob.id, status: completedJob.status === "finished" ? "completed" : (completedJob.status === "started" ? "in_progress" : "confirmed") as any, tips: payment.tipAmount, upsellTotal: completedJob.upsellTotal ?? 0 });
              // Persist full payment record to DB so it survives app restarts
              jobSavePaymentMutation.mutate({
                jobId: completedJob.id,
                method: payment.method,
                subtotal: payment.subtotal,
                tipAmount: payment.tipAmount,
                total: payment.total,
                paidAt: payment.paidAt,
                paymentIntentId: payment.paymentIntentId,
                signatureDataUrl: payment.signatureDataUrl,
                referenceNote: payment.referenceNote,
              });
              utils.performance.getDateRange.invalidate();
            }}
          />
        )}
      </Modal>

      {/* Add Job Modal */}
      <Modal visible={showAddModal} animationType="slide" transparent onRequestClose={() => { prefillHandledRef.current = null; setShowAddModal(false); }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
            <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, maxHeight: "90%" }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>New Job</Text>
                  <TouchableOpacity
                    onPress={() => setShowAddDatePicker((v) => !v)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 12, color: colors.primary }}>📅 {currentScheduleLabel} · {addJobDate || formatFullDate(selectedDate)}</Text>
                    <Text style={{ fontSize: 10, color: colors.primary }}>{showAddDatePicker ? "▲" : "▼"}</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={() => { prefillHandledRef.current = null; setShowAddModal(false); }}>
                  <Text style={{ color: colors.muted, fontSize: 24 }}>✕</Text>
                </TouchableOpacity>
              </View>
              {showAddDatePicker && (
                <View style={{ marginBottom: 12, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
                  <CalendarPicker
                    selectedDate={addJobDate}
                    onSelectDate={(d) => { setAddJobDate(d); setShowAddDatePicker(false); }}
                    minDate={undefined}
                  />
                </View>
              )}
              <ScrollView
                ref={addModalScrollRef}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              >
                {/* Customer */}
                <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Customer</Text>
                {/* Customer Search */}
                <CustomerSearchField
                  colors={colors}
                  value={customerSearch}
                  onChange={(value) => { setCustomerSearch(value); setSelectedCompanyCustomerId(null); }}
                  showDropdown={showCustomerDropdown}
                  setShowDropdown={setShowCustomerDropdown}
                  onSelect={(c) => {
                    const parts = (c.fullName || "").split(" ");
                    setAddFirstName(parts[0] || "");
                    setAddLastName(parts.slice(1).join(" ") || "");
                    setAddPhone(c.phone || "");
                    setAddEmail(c.email || "");
                    setAddAddress(c.address || "");
                    setCustomerSearch(c.fullName || "");
                    setSelectedCompanyCustomerId(c.id ?? null);
                    setShowCustomerDropdown(false);
                  }}
                  companyCustomers={isJobSyncCompany ? companyCustomers : undefined}
                />
                {isJobSyncCompany && companyCustomersError ? <Text style={{ color: colors.error, fontSize: 12, marginBottom: 8 }}>{companyCustomersError}</Text> : null}
                <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
                  <TextInput value={addFirstName} onChangeText={(value) => { setAddFirstName(value); setSelectedCompanyCustomerId(null); }} placeholder="First Name *" placeholderTextColor={colors.muted} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, backgroundColor: colors.background }} />
                  <TextInput value={addLastName} onChangeText={(value) => { setAddLastName(value); setSelectedCompanyCustomerId(null); }} placeholder="Last Name *" placeholderTextColor={colors.muted} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, backgroundColor: colors.background }} />
                </View>
                <TextInput value={addPhone} onChangeText={(value) => { setAddPhone(value); setSelectedCompanyCustomerId(null); }} placeholder="Phone" placeholderTextColor={colors.muted} keyboardType="phone-pad" style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, backgroundColor: colors.background, marginBottom: 8 }} />
                <TextInput value={addEmail} onChangeText={(value) => { setAddEmail(value); setSelectedCompanyCustomerId(null); }} placeholder="Email" placeholderTextColor={colors.muted} keyboardType="email-address" autoCapitalize="none" style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, backgroundColor: colors.background, marginBottom: 8 }} />
                <AddressAutocomplete
                  value={addAddress}
                  onChangeText={(value) => { setAddAddress(value); setSelectedCompanyCustomerId(null); }}
                  onSelectAddress={(value) => { setAddAddress(value); setSelectedCompanyCustomerId(null); }}
                  placeholder="Address *"
                  style={{ marginBottom: 16, zIndex: 999 }}
                />

                {/* Vehicle Type */}
                <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Vehicle Type</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                  {VEHICLE_TYPES.filter(v => !v.group).map((v) => {
                    const sel = addVehicleType === v.id;
                    return (
                      <TouchableOpacity key={v.id} onPress={() => { setAddVehicleType(v.id); setAddPackageId(undefined); setAddAddonIds([]); setAddAddonQtys({}); setAddService(""); setAddPrice(""); }} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : colors.surface }} activeOpacity={0.75}>
                        <Text style={{ fontSize: 16 }}>{v.emoji}</Text>
                        <Text style={{ color: sel ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13, marginLeft: 6 }}>{v.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 6, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>RV Services</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                  {VEHICLE_TYPES.filter(v => v.group === "rv").map((v) => {
                    const sel = addVehicleType === v.id;
                    return (
                      <TouchableOpacity key={v.id} onPress={() => { setAddVehicleType(v.id); setAddPackageId(undefined); setAddAddonIds([]); setAddAddonQtys({}); setAddService(""); setAddPrice(""); }} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : colors.surface }} activeOpacity={0.75}>
                        <Text style={{ fontSize: 16 }}>{v.emoji}</Text>
                        <Text style={{ color: sel ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13, marginLeft: 6 }}>{v.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Package Picker */}
                {addVehicleType && (() => {
                  const packagesToShow = isRvVehicle(addVehicleType) ? rvPackages : allJobPackages.filter((p) => !p.isRv);
                  return (
                    <>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Package</Text>
                      {packagesToShow.length === 0 && (
                        <Text style={{ color: isJobSyncCompany && companyPriceBook.error ? colors.error : colors.muted, fontSize: 13, marginBottom: 12 }}>
                          {isJobSyncCompany && companyPriceBook.isLoading
                            ? "Loading your Company Price Book…"
                            : isJobSyncCompany && companyPriceBook.error
                              ? companyPriceBook.error
                              : isJobSyncCompany
                                ? "No active service is available for this vehicle type. Add or activate a service in the web Price Book."
                                : "No packages are available for this vehicle type."}
                        </Text>
                      )}
                      {packagesToShow.map((p) => {
                        const pkgPrice = (p.basePrice as Partial<Record<VehicleType, number>>)[addVehicleType] ?? 0;
                        const sel = addPackageId === p.id;
                        // Show override price when set, otherwise show base package price
                        const displayPrice = (sel && addCustomPrice.trim() !== "") ? (parseFloat(addCustomPrice) || pkgPrice) : pkgPrice;
                        return (
                          <TouchableOpacity key={p.id} onPress={() => { setAddPackageId(p.id); setAddAddonIds([]); setAddAddonQtys({}); setAddService(p.title); setAddPrice(pkgPrice.toString()); setAddCustomPrice(""); setShowCustomPriceInput(false); }} style={{ borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: sel ? 2 : 1, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary + "15" : colors.background }} activeOpacity={0.8}>
                            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
                              <Text style={{ fontSize: 18, marginRight: 8 }}>{p.emoji}</Text>
                              <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14, flex: 1 }}>{p.title}</Text>
                              <View style={{ alignItems: "flex-end" }}>
                                {sel && addCustomPrice.trim() !== "" && (
                                  <Text style={{ color: colors.muted, fontSize: 11, textDecorationLine: "line-through" }}>${pkgPrice}</Text>
                                )}
                                <Text style={{ color: (sel && addCustomPrice.trim() !== "") ? colors.warning : colors.primary, fontWeight: "800", fontSize: 15 }}>${displayPrice}</Text>
                              </View>
                            </View>
                            <Text style={{ color: colors.muted, fontSize: 11, marginLeft: 26 }}>{p.tagline}</Text>
                            {sel && p.features.map((f) => (
                              <View key={f} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3, marginLeft: 26 }}>
                                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary }} />
                                <Text style={{ color: colors.foreground, fontSize: 12 }}>{f}</Text>
                              </View>
                            ))}
                            {/* Admin-only price override for this booking */}
                            {sel && (
                              <View style={{ marginTop: 10, marginLeft: 26 }}>
                                {showCustomPriceInput ? (
                                  <View style={{ gap: 8 }}>
                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                      <Text style={{ color: colors.muted, fontSize: 13 }}>Custom Price: $</Text>
                                      <TextInput
                                        value={addCustomPrice}
                                        onChangeText={setAddCustomPrice}
                                        keyboardType="decimal-pad"
                                        placeholder={pkgPrice.toString()}
                                        placeholderTextColor={colors.muted}
                                        style={{ flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "700", borderBottomWidth: 1.5, borderBottomColor: colors.primary, paddingVertical: 2, paddingHorizontal: 4 }}
                                        returnKeyType="done"
                                        onSubmitEditing={() => { if (addCustomPrice.trim() !== "") setShowCustomPriceInput(false); }}
                                        autoFocus
                                      />
                                    </View>
                                    <View style={{ flexDirection: "row", gap: 8 }}>
                                      <TouchableOpacity
                                        onPress={() => { setAddCustomPrice(""); setShowCustomPriceInput(false); }}
                                        style={{ flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.error, alignItems: "center" }}
                                      >
                                        <Text style={{ color: colors.error, fontSize: 13, fontWeight: "600" }}>✕ Reset</Text>
                                      </TouchableOpacity>
                                      <TouchableOpacity
                                        onPress={() => {
                                          const parsed = parseFloat(addCustomPrice);
                                          if (!isNaN(parsed) && parsed > 0) {
                                            setAddCustomPrice(parsed.toString());
                                            setShowCustomPriceInput(false);
                                          }
                                        }}
                                        style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.success, alignItems: "center", opacity: (addCustomPrice.trim() !== "" && !isNaN(parseFloat(addCustomPrice)) && parseFloat(addCustomPrice) > 0) ? 1 : 0.4 }}
                                      >
                                        <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>✓ Confirm</Text>
                                      </TouchableOpacity>
                                    </View>
                                  </View>
                                ) : (
                                  <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); setShowCustomPriceInput(true); }} style={{ flexDirection: "row", alignItems: "center", gap: 6 }} activeOpacity={0.7}>
                                    {addCustomPrice.trim() !== "" ? (
                                      <Text style={{ color: colors.warning, fontSize: 12 }}>✏️ Override: ${parseFloat(addCustomPrice).toFixed(2)} — tap to change</Text>
                                    ) : (
                                      <Text style={{ color: colors.primary, fontSize: 12 }}>✏️ Override price for this booking</Text>
                                    )}
                                  </TouchableOpacity>
                                )}
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                      {/* Local custom services are retained only for legacy sessions. */}
                      {!isJobSyncCompany && (
                      <TouchableOpacity
                        onPress={() => {
                          setAddPackageId(undefined);
                          setAddAddonIds([]); setAddAddonQtys({});
                          setShowCustomPackageForm(true);
                          setAddCustomPrice(""); setShowCustomPriceInput(false);
                        }}
                        style={{ borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: showCustomPackageForm ? 2 : 1, borderColor: showCustomPackageForm ? colors.warning : colors.border, backgroundColor: showCustomPackageForm ? colors.warning + "15" : colors.background }}
                        activeOpacity={0.8}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
                          <Text style={{ fontSize: 18, marginRight: 8 }}>✏️</Text>
                          <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14, flex: 1 }}>Custom Package</Text>
                          <Text style={{ color: colors.warning, fontWeight: "800", fontSize: 13 }}>Enter price →</Text>
                        </View>
                        <Text style={{ color: colors.muted, fontSize: 11, marginLeft: 26 }}>Create a one-time custom service for this booking</Text>
                        {showCustomPackageForm && (
                          <View style={{ marginTop: 12, gap: 10 }}>
                            <View>
                              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "600", textTransform: "uppercase", marginBottom: 4 }}>Service Name *</Text>
                              <TextInput
                                value={addCustomPackageName}
                                onChangeText={(t) => {
                                  setAddCustomPackageName(t);
                                  setAddService(t);
                                }}
                                placeholder="e.g. Paint Correction, Ceramic Coat..."
                                placeholderTextColor={colors.muted}
                                style={{ color: colors.foreground, fontSize: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.surface }}
                                returnKeyType="next"
                              />
                            </View>
                            <View>
                              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "600", textTransform: "uppercase", marginBottom: 4 }}>Description (optional)</Text>
                              <TextInput
                                value={addCustomPackageDesc}
                                onChangeText={setAddCustomPackageDesc}
                                placeholder="Brief description of the service"
                                placeholderTextColor={colors.muted}
                                style={{ color: colors.foreground, fontSize: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.surface }}
                                returnKeyType="next"
                              />
                            </View>
                            <View>
                              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "600", textTransform: "uppercase", marginBottom: 4 }}>Price *</Text>
                              <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, backgroundColor: colors.surface }}>
                                <Text style={{ color: colors.muted, fontSize: 15, marginRight: 4 }}>$</Text>
                                <TextInput
                                  value={addCustomPackagePrice}
                                  onChangeText={(t) => {
                                    setAddCustomPackagePrice(t);
                                    setAddPrice(t);
                                    setAddCustomPrice(t);
                                  }}
                                  placeholder="0.00"
                                  placeholderTextColor={colors.muted}
                                  keyboardType="decimal-pad"
                                  style={{ flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "700", paddingVertical: 8 }}
                                  returnKeyType="done"
                                />
                              </View>
                            </View>
                          </View>
                        )}
                      </TouchableOpacity>
                      )}
                    </>
                  );
                })()}

                {/* Add-ons */}
                {!isJobSyncCompany && addVehicleType && (addPackageId || showCustomPackageForm) && (() => {
                  const isRvJob = isRvVehicle(addVehicleType);
                  const rvSealantFeet = parseInt(addRvSealantFeet) || 0;
                  const rvSealantPrice = rvSealantFeet * 15;
                  const recalcPrice = (newQtys: Record<string, number>, sealantFt: number) => {
                    const addonsTotal = ADDONS.reduce((s, ad) => s + ad.price * (newQtys[ad.id] ?? 0), 0);
                    const sealantTotal = sealantFt * 15;
                    const totalQty = Object.values(newQtys).reduce((s, q) => s + q, 0);
                    const sealantLabel = sealantFt > 0 ? ` + Sealant (${sealantFt}ft)` : "";
                    if (showCustomPackageForm) {
                      // Custom package: base price from custom price field
                      const customBase = parseFloat(addCustomPackagePrice) || 0;
                      const baseName = addCustomPackageName.trim() || "Custom Service";
                      setAddService(baseName + (totalQty > 0 ? ` + ${totalQty} Add-on${totalQty > 1 ? "s" : ""}` : "") + sealantLabel);
                      setAddPrice((customBase + addonsTotal + sealantTotal).toString());
                    } else {
                      const allPkgs = isRvJob ? rvPackages : allJobPackages.filter((p) => !p.isRv);
                      const pkg = allPkgs.find((p) => p.id === addPackageId)!;
                      const pkgPrice = (pkg?.basePrice as Partial<Record<VehicleType, number>>)?.[addVehicleType] ?? 0;
                      setAddService(pkg.title + (totalQty > 0 ? ` + ${totalQty} Add-on${totalQty > 1 ? "s" : ""}` : "") + sealantLabel);
                      setAddPrice((pkgPrice + addonsTotal + sealantTotal).toString());
                    }
                    setAddAddonIds(ADDONS.filter((ad) => (newQtys[ad.id] ?? 0) > 0).map((ad) => ad.id));
                  };
                  const hasAddons = addAddonIds.length > 0 || rvSealantFeet > 0;
                  return (
                    <>
                      <TouchableOpacity
                        onPress={() => setAddonsExpanded(e => !e)}
                        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: hasAddons ? colors.primary : colors.border, borderRadius: 10, padding: 12, backgroundColor: hasAddons ? colors.primary + "10" : colors.surface, marginBottom: addonsExpanded ? 10 : 16, marginTop: 4 }}
                        activeOpacity={0.75}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={{ fontSize: 16 }}>✨</Text>
                          <Text style={{ color: hasAddons ? colors.primary : colors.foreground, fontWeight: "600", fontSize: 14 }}>
                            {hasAddons ? `Add-Ons (${addAddonIds.length + (rvSealantFeet > 0 ? 1 : 0)} selected)` : "Add Add-Ons (Optional)"}
                          </Text>
                        </View>
                        <Text style={{ color: colors.muted, fontSize: 16 }}>{addonsExpanded ? "▲" : "▼"}</Text>
                      </TouchableOpacity>
                      {addonsExpanded && (
                        <>
                          {/* RV Paint Sealant footage input — only shown for RV jobs */}
                          {isRvJob && (
                            <View style={{ borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: rvSealantFeet > 0 ? 1.5 : 1, borderColor: rvSealantFeet > 0 ? colors.primary : colors.border, backgroundColor: rvSealantFeet > 0 ? colors.primary + "10" : colors.surface }}>
                              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                                <Text style={{ fontSize: 18, marginRight: 8 }}>🎨</Text>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 13 }}>RV Paint Sealant</Text>
                                  <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 11 }}>$15 per foot{rvSealantFeet > 0 ? ` · ${rvSealantFeet}ft = $${rvSealantPrice}` : ""}</Text>
                                </View>
                              </View>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                                <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600" }}>RV Length (ft):</Text>
                                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.background }}>
                                  <TextInput
                                    value={addRvSealantFeet}
                                    onChangeText={(v) => {
                                      const clean = v.replace(/[^0-9]/g, "");
                                      setAddRvSealantFeet(clean);
                                      const ft = parseInt(clean) || 0;
                                      recalcPrice(addAddonQtys, ft);
                                    }}
                                    placeholder="0"
                                    placeholderTextColor={colors.muted}
                                    keyboardType="number-pad"
                                    style={{ flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "600" }}
                                  />
                                  {rvSealantFeet > 0 && (
                                    <TouchableOpacity onPress={() => { setAddRvSealantFeet(""); recalcPrice(addAddonQtys, 0); }}>
                                      <Text style={{ color: colors.muted, fontSize: 16, paddingLeft: 6 }}>✕</Text>
                                    </TouchableOpacity>
                                  )}
                                </View>
                              </View>
                            </View>
                          )}
                          {/* Standard add-ons — hidden for RV jobs (not applicable) */}
                          {!isRvJob && ADDONS.map((a) => {
                            const qty = addAddonQtys[a.id] ?? 0;
                            return (
                              <View key={a.id} style={{ flexDirection: "row", alignItems: "center", borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: qty > 0 ? 1.5 : 1, borderColor: qty > 0 ? colors.primary : colors.border, backgroundColor: qty > 0 ? colors.primary + "10" : colors.surface }}>
                                <Text style={{ fontSize: 18, marginRight: 8 }}>{a.emoji}</Text>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 13 }}>{a.title}</Text>
                                  <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 11 }}>${a.price}{qty > 1 ? ` × ${qty} = $${(a.price * qty).toFixed(0)}` : ""}</Text>
                                </View>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                  <TouchableOpacity onPress={() => { const nq = Math.max(0, qty - 1); const newQtys = { ...addAddonQtys, [a.id]: nq }; if (nq === 0) delete newQtys[a.id]; setAddAddonQtys(newQtys); recalcPrice(newQtys, 0); }} style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: colors.border, justifyContent: "center", alignItems: "center", opacity: qty === 0 ? 0.3 : 1 }} disabled={qty === 0}><Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>−</Text></TouchableOpacity>
                                  <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 13, minWidth: 16, textAlign: "center" }}>{qty}</Text>
                                  <TouchableOpacity onPress={() => { const nq = qty + 1; const newQtys = { ...addAddonQtys, [a.id]: nq }; setAddAddonQtys(newQtys); recalcPrice(newQtys, 0); }} style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: colors.border, justifyContent: "center", alignItems: "center" }}><Text style={{ color: colors.primary, fontSize: 15, fontWeight: "700" }}>+</Text></TouchableOpacity>
                                </View>
                              </View>
                            );
                          })}
                          {hasAddons && (
                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.primary + "44", backgroundColor: colors.primary + "12", padding: 14, marginTop: 4, marginBottom: 8 }}>
                              <Text style={{ color: colors.foreground, fontWeight: "600" }}>Add-ons Total</Text>
                              <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 17 }}>${(ADDONS.reduce((s, ad) => s + ad.price * (addAddonQtys[ad.id] ?? 0), 0) + rvSealantPrice).toFixed(0)}</Text>
                            </View>
                          )}
                        </>
                      )}
                    </>
                  );
                })()}

                {/* Additional Vehicles */}
                {addExtraVehicles.length > 0 && addExtraVehicles.map((ev, evIdx) => (
                  <View key={evIdx} style={{ borderWidth: 1, borderColor: colors.primary + "44", borderRadius: 14, padding: 14, marginBottom: 14, backgroundColor: colors.primary + "08" }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>Vehicle {evIdx + 2}</Text>
                      <TouchableOpacity onPress={() => setAddExtraVehicles((prev) => prev.filter((_, i) => i !== evIdx))} style={{ padding: 4 }}>
                        <Text style={{ color: colors.error, fontSize: 18, fontWeight: "700" }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Vehicle Type</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                      {VEHICLE_TYPES.filter(v => !v.group).map((v) => {
                        const sel = ev.vehicleType === v.id;
                        return (
                          <TouchableOpacity key={v.id} onPress={() => setAddExtraVehicles((prev) => prev.map((x, i) => {
                            if (i !== evIdx) return x;
                            // If a non-RV package is already selected, keep it and recalculate price for new vehicle type
                            const pkg = x.packageId ? allJobPackages.find(p => p.id === x.packageId) : null;
                            const newPrice = pkg ? ((pkg.basePrice as Partial<Record<VehicleType, number>>)[v.id as VehicleType] ?? 0) : 0;
                            return { ...x, vehicleType: v.id, packageId: pkg ? x.packageId : "", addonIds: [], addonQtys: {}, price: newPrice };
                          }))} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : colors.surface }} activeOpacity={0.75}>
                            <Text style={{ fontSize: 14 }}>{v.emoji}</Text>
                            <Text style={{ color: sel ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 12, marginLeft: 5 }}>{v.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 6, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>RV</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                      {VEHICLE_TYPES.filter(v => v.group === "rv").map((v) => {
                        const sel = ev.vehicleType === v.id;
                        return (
                          <TouchableOpacity key={v.id} onPress={() => setAddExtraVehicles((prev) => prev.map((x, i) => i === evIdx ? { ...x, vehicleType: v.id, packageId: "", addonIds: [], addonQtys: {}, price: 0 } : x))} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : colors.surface }} activeOpacity={0.75}>
                            <Text style={{ fontSize: 14 }}>{v.emoji}</Text>
                            <Text style={{ color: sel ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 12, marginLeft: 5 }}>{v.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {ev.vehicleType ? (() => {
                      const evPkgs = isRvVehicle(ev.vehicleType as VehicleType) ? rvPackages : allJobPackages.filter((p) => !p.isRv);
                      return (
                        <>
                          <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Package</Text>
                          {evPkgs.map((p) => {
                            const pkgPrice = (p.basePrice as Partial<Record<VehicleType, number>>)[ev.vehicleType as VehicleType] ?? 0;
                            const sel = ev.packageId === p.id;
                            return (
                              <TouchableOpacity key={p.id} onPress={() => setAddExtraVehicles((prev) => prev.map((x, i) => i === evIdx ? { ...x, packageId: p.id, price: pkgPrice } : x))} style={{ borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: sel ? 2 : 1, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary + "15" : colors.background }} activeOpacity={0.8}>
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

                {/* Add Vehicle Button */}
                <TouchableOpacity
                  onPress={() => setAddExtraVehicles((prev) => [...prev, { vehicleType: "sedan", packageId: "", addonIds: [], addonQtys: {}, price: 0 }])}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 12, paddingVertical: 12, marginBottom: 16, backgroundColor: colors.primary + "0D" }}
                  activeOpacity={0.75}
                >
                  <Text style={{ color: colors.primary, fontSize: 18, fontWeight: "700" }}>+</Text>
                  <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>Add Another Vehicle</Text>
                </TouchableOpacity>

                {/* Running total if extra vehicles selected */}
                {addExtraVehicles.length > 0 && parseFloat(addPrice) > 0 && (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.primary + "44", backgroundColor: colors.primary + "12", padding: 14, marginBottom: 16 }}>
                    <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14 }}>Total ({1 + addExtraVehicles.length} vehicles)</Text>
                    <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 17 }}>${((parseFloat(addPrice) || 0) + addExtraVehicles.reduce((s, v) => s + v.price, 0)).toFixed(2)}</Text>
                  </View>
                )}

                {addPackageId && (
                  <>
                    {addCurrentBlockedHours.size > 0 && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FEF2F2", borderRadius: 8, padding: 8, marginBottom: 8 }}>
                        <Text style={{ fontSize: 13 }}>⚠️</Text>
                        <Text style={{ fontSize: 12, color: "#DC2626", flex: 1 }}>
                          {addDetailer} already has jobs during some hours today. Grayed-out slots marked "Booked" are unavailable.
                        </Text>
                      </View>
                    )}
                    <DragTimePicker
                      colors={colors}
                      startHour={addStartHour}
                      endHour={addEndHour}
                      onStartChange={setAddStartHour}
                      onEndChange={setAddEndHour}
                      formatHour={formatHour}
                      blockedHours={addCurrentBlockedHours}
                    />
                  </>
                )}

                {/* Recurrence */}
                <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Recurrence</Text>
                <TouchableOpacity
                  onPress={() => setShowRecurrencePicker(true)}
                  style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1, borderColor: addRecurrenceRule && addRecurrenceRule.type !== "none" ? colors.primary : colors.border, borderRadius: 10, padding: 12, backgroundColor: colors.background, marginBottom: 16 }}
                  activeOpacity={0.75}
                >
                  <Text style={{ color: addRecurrenceRule && addRecurrenceRule.type !== "none" ? colors.primary : colors.muted, fontSize: 15 }}>
                    {addRecurrenceRule ? recurrenceLabel(addRecurrenceRule) : "Does not repeat"}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>›</Text>
                </TouchableOpacity>

                {/* Detailer picker for multi-detailer cities */}
                {cityConfig.detailers.length > 1 && (
                  <>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Assign Detailer</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                      {cityConfig.detailers.map((det) => {
                        const dow = selectedDate.getDay();
                        const offShift = !isDetailerOnShift(det, dow);
                        const busyHours = offShift ? 0 : (addBlockedHoursByDetailer[det.employeeId]?.size ?? 0);
                        const isBusy = !offShift && busyHours > 0;
                        return (
                          <TouchableOpacity
                            key={det.employeeId}
                            onPress={() => { if (!offShift) setAddDetailer(det.employeeId); }}
                            disabled={offShift}
                            style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 2,
                              borderColor: offShift ? "#94a3b8" : addDetailer === det.employeeId ? det.color : isBusy ? "#F87171" : colors.border,
                              backgroundColor: offShift ? "#F1F5F9" : addDetailer === det.employeeId ? det.color + "18" : isBusy ? "#FEF2F2" : colors.surface,
                              alignItems: "center", opacity: offShift ? 0.55 : 1 }}
                          >
                            <Text style={{ color: offShift ? "#94a3b8" : addDetailer === det.employeeId ? det.color : isBusy ? "#DC2626" : colors.foreground, fontWeight: "700", fontSize: 14 }}>{det.name}</Text>
                            {offShift && (
                              <Text style={{ fontSize: 10, color: "#94a3b8", fontWeight: "600", marginTop: 2 }}>Off Shift</Text>
                            )}
                            {!offShift && isBusy && (
                              <Text style={{ fontSize: 10, color: "#DC2626", fontWeight: "600", marginTop: 2 }}>Booked {busyHours}h</Text>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}

                {/* Discount section */}
                <View style={{ paddingVertical: 14, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: colors.border, marginBottom: 4 }}>
                  <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginBottom: 10 }}>Discount</Text>
                  {/* Type toggle */}
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
                    <TouchableOpacity
                      onPress={() => setAddDiscountType("fixed")}
                      style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: addDiscountType === "fixed" ? colors.primary : colors.surface, borderWidth: 1, borderColor: addDiscountType === "fixed" ? colors.primary : colors.border }}
                      activeOpacity={0.8}
                    >
                      <Text style={{ color: addDiscountType === "fixed" ? "#FFF" : colors.muted, fontWeight: "600", fontSize: 13 }}>$ Off</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setAddDiscountType("percent")}
                      style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: addDiscountType === "percent" ? colors.primary : colors.surface, borderWidth: 1, borderColor: addDiscountType === "percent" ? colors.primary : colors.border }}
                      activeOpacity={0.8}
                    >
                      <Text style={{ color: addDiscountType === "percent" ? "#FFF" : colors.muted, fontWeight: "600", fontSize: 13 }}>% Off</Text>
                    </TouchableOpacity>
                  </View>
                  {/* Discount code + amount row */}
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, textTransform: "uppercase", marginBottom: 4 }}>Code (optional)</Text>
                      <TextInput
                        value={addDiscountCode}
                        onChangeText={setAddDiscountCode}
                        placeholder="e.g. SUMMER20"
                        placeholderTextColor={colors.muted}
                        autoCapitalize="characters"
                        returnKeyType="next"
                        style={{ color: colors.foreground, fontSize: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.surface }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, textTransform: "uppercase", marginBottom: 4 }}>{addDiscountType === "fixed" ? "Amount ($)" : "Percent (%)"}</Text>
                      <TextInput
                        value={addDiscountInput}
                        onChangeText={setAddDiscountInput}
                        placeholder={addDiscountType === "fixed" ? "0.00" : "0"}
                        placeholderTextColor={colors.muted}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        style={{ color: colors.foreground, fontSize: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.surface }}
                      />
                    </View>
                  </View>
                  {/* Live preview */}
                  {parseFloat(addDiscountInput) > 0 && (() => {
                    const baseP = addCustomPrice.trim() !== "" ? (parseFloat(addCustomPrice) || 0) : (parseFloat(addPrice) || 0);
                    const totalP = baseP + addExtraVehicles.reduce((s, v) => s + v.price, 0);
                    const discAmt = addDiscountType === "percent"
                      ? Math.round((parseFloat(addDiscountInput) / 100) * totalP * 100) / 100
                      : parseFloat(addDiscountInput) || 0;
                    return (
                      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                        <Text style={{ color: colors.muted, fontSize: 13 }}>After discount</Text>
                        <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>${Math.max(0, totalP - discAmt).toFixed(2)} <Text style={{ color: colors.error, fontWeight: "600", fontSize: 12 }}>(-${discAmt.toFixed(2)})</Text></Text>
                      </View>
                    );
                  })()}
                </View>

                {/* New Customer toggle */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 4, marginBottom: 0, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>New Customer</Text>
                      {addIsNewCustomer && (
                        <View style={{ backgroundColor: "#F59E0B", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                          <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>⭐ FIRST TIME</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                      {addIsNewCustomer ? "Detailers will see a first-time badge on this job" : "Toggle on for first-time customers"}
                    </Text>
                  </View>
                  <Switch
                    value={addIsNewCustomer}
                    onValueChange={setAddIsNewCustomer}
                    trackColor={{ false: colors.border, true: "#F59E0B" }}
                    thumbColor={"#ffffff"}
                    ios_backgroundColor={colors.border}
                  />
                </View>
                {/* Notify Customer toggle */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 4, marginBottom: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>Notify customer</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                      {addNotifyCustomer ? "Confirmation email will be sent" : "No email will be sent"}
                    </Text>
                  </View>
                  <Switch
                    value={addNotifyCustomer}
                    onValueChange={setAddNotifyCustomer}
                    trackColor={{ false: colors.border, true: "#0057FF" }}
                    thumbColor={"#ffffff"}
                    ios_backgroundColor={colors.border}
                  />
                </View>

                {/* Live Job Total Summary */}
                {(() => {
                  const baseP = addCustomPrice.trim() !== "" ? (parseFloat(addCustomPrice) || 0) : (parseFloat(addPrice) || 0);
                  const extraP = addExtraVehicles.reduce((s, v) => s + v.price, 0);
                  const totalP = baseP + extraP;
                  const discAmt = (() => {
                    const d = parseFloat(addDiscountInput) || 0;
                    if (d <= 0) return 0;
                    return addDiscountType === "percent" ? Math.round((d / 100) * totalP * 100) / 100 : d;
                  })();
                  const finalP = Math.max(0, totalP - discAmt);
                  if (totalP <= 0) return null;
                  return (
                    <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: addCustomPrice.trim() !== "" ? colors.warning : colors.border }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ fontSize: 13, color: colors.muted, fontWeight: "600" }}>JOB TOTAL</Text>
                        <View style={{ alignItems: "flex-end" }}>
                          {addCustomPrice.trim() !== "" && addPrice.trim() !== "" && parseFloat(addPrice) !== parseFloat(addCustomPrice) && (
                            <Text style={{ fontSize: 12, color: colors.muted, textDecorationLine: "line-through" }}>${parseFloat(addPrice).toFixed(2)}{extraP > 0 ? ` + $${extraP.toFixed(2)}` : ""}</Text>
                          )}
                          <Text style={{ fontSize: 20, fontWeight: "800", color: addCustomPrice.trim() !== "" ? colors.warning : colors.foreground }}>
                            ${finalP.toFixed(2)}
                          </Text>
                          {addCustomPrice.trim() !== "" && (
                            <Text style={{ fontSize: 11, color: colors.warning, marginTop: 1 }}>Custom price applied ✓</Text>
                          )}
                          {discAmt > 0 && (
                            <Text style={{ fontSize: 11, color: colors.error, marginTop: 1 }}>Discount: -${discAmt.toFixed(2)}</Text>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })()}

                <View style={{ flexDirection: "row", gap: 12, marginTop: 8, marginBottom: 8 }}>
                  <TouchableOpacity onPress={() => { prefillHandledRef.current = null; setShowAddModal(false); }} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}>
                    <Text style={{ color: colors.foreground, fontWeight: "600" }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={saveAdminJob}
                    style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", opacity: (addFirstName.trim() && addLastName.trim() && addAddress.trim()) ? 1 : 0.4 }}
                    disabled={!(addFirstName.trim() && addLastName.trim() && addAddress.trim())}
                  >
                    <Text style={{ color: "#FFF", fontWeight: "700" }}>Save Job</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>

        {/* Recurrence Picker — absolute overlay inside this Modal */}
        <RecurrencePicker
          visible={showRecurrencePicker}
          rule={addRecurrenceRule}
          baseDate={addJobDate || localDateStr(getWeekDates(weekOffset)[selectedDay])}
          onConfirm={(rule) => {
            setAddRecurrenceRule(rule);
            setShowRecurrencePicker(false);
          }}
          onCancel={() => setShowRecurrencePicker(false)}
        />
      </Modal>

      {/* ─── Add Blocker Modal ─────────────────────────────────────────────── */}
      <Modal visible={showBlockerModal} transparent animationType="slide" onRequestClose={() => setShowBlockerModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
            <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 }}>
              {/* Header */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>🚫 Block Schedule</Text>
                <TouchableOpacity onPress={() => setShowBlockerModal(false)}>
                  <Text style={{ fontSize: 24, color: colors.muted, lineHeight: 28 }}>×</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ padding: 20, gap: 16 }} showsVerticalScrollIndicator={false}>

                {/* Detailer Picker */}
                <View>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Team Member</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {cityConfig.detailers.map((det) => {
                      const sel = blockerDetailer === det.name;
                      return (
                        <TouchableOpacity
                          key={det.name}
                          onPress={() => setBlockerDetailer(det.name)}
                          style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: sel ? 2 : 1, borderColor: sel ? det.color : colors.border, backgroundColor: sel ? det.color + "18" : colors.surface }}
                          activeOpacity={0.75}
                        >
                          <Text style={{ color: sel ? det.color : colors.foreground, fontWeight: sel ? "700" : "400", fontSize: 14 }}>{det.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Date Picker */}
                <View>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Date</Text>
                  <TouchableOpacity
                    onPress={() => setShowBlockerDatePicker((v) => !v)}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
                    activeOpacity={0.75}
                  >
                    <Text style={{ fontSize: 15, color: blockerDate ? colors.foreground : colors.muted }}>{blockerDate || "Select a date"}</Text>
                    <Text style={{ fontSize: 14, color: colors.primary }}>{showBlockerDatePicker ? "▲" : "▼"}</Text>
                  </TouchableOpacity>
                  {showBlockerDatePicker && (
                    <View style={{ marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
                      <CalendarPicker
                        selectedDate={blockerDate}
                        onSelectDate={(d) => { setBlockerDate(d); setShowBlockerDatePicker(false); }}
                      />
                    </View>
                  )}
                </View>

                {/* All Day Toggle */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>All Day</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{blockerAllDay ? "Blocks the entire day" : "Select a time range"}</Text>
                  </View>
                  <Switch
                    value={blockerAllDay}
                    onValueChange={(v) => setBlockerAllDay(v)}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>

                {/* Time Range Picker (shown when not all-day) */}
                {!blockerAllDay && (
                  <DragTimePicker
                    colors={colors}
                    startHour={blockerStartHour}
                    endHour={blockerEndHour}
                    onStartChange={(h) => setBlockerStartHour(h)}
                    onEndChange={(h) => setBlockerEndHour(h)}
                    formatHour={formatHour}
                  />
                )}

                {/* Reason */}
                <View>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Reason</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                    {["Day Off", "Event", "Personal", "Sick", "Vacation"].map((r) => {
                      const sel = blockerReason === r;
                      return (
                        <TouchableOpacity
                          key={r}
                          onPress={() => setBlockerReason(r)}
                          style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: sel ? 2 : 1, borderColor: sel ? "#ef4444" : colors.border, backgroundColor: sel ? "#ef444418" : colors.surface }}
                          activeOpacity={0.75}
                        >
                          <Text style={{ color: sel ? "#ef4444" : colors.foreground, fontWeight: sel ? "700" : "400", fontSize: 13 }}>{r}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TextInput
                    value={blockerReason}
                    onChangeText={setBlockerReason}
                    placeholder="Custom reason…"
                    placeholderTextColor={colors.muted}
                    style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.foreground, fontSize: 14 }}
                    returnKeyType="done"
                  />
                </View>

                {/* Save / Cancel */}
                <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                  <TouchableOpacity
                    onPress={() => setShowBlockerModal(false)}
                    style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
                    activeOpacity={0.75}
                  >
                    <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 15 }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      if (!blockerDetailer) { Alert.alert("Select a team member"); return; }
                      if (!blockerDate) { Alert.alert("Select a date"); return; }
                      const id = Date.now().toString();
                      blockerCreateMutation.mutate(
                        { id, detailerName: blockerDetailer, city: selectedCity, date: blockerDate, startHour: blockerAllDay ? 0 : blockerStartHour, endHour: blockerAllDay ? 24 : blockerEndHour, allDay: blockerAllDay, reason: blockerReason || "Day Off", createdBy: currentEmployee?.employeeId || undefined },
                        {
                          onSuccess: () => { setShowBlockerModal(false); forceSync(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); },
                          onError: (e) => Alert.alert("Error", e.message),
                        }
                      );
                    }}
                    disabled={blockerCreateMutation.isPending}
                    style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: "#ef4444", alignItems: "center", opacity: blockerCreateMutation.isPending ? 0.6 : 1 }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 15 }}>{blockerCreateMutation.isPending ? "Saving…" : "🚫 Block Schedule"}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Delete Blocker Confirmation ─────────────────────────────────────── */}
      {selectedBlocker !== null && (() => {
        const b = blockers.find((x) => x.id === selectedBlocker);
        if (!b) return null;
        return (
          <Modal visible={true} transparent animationType="fade" onRequestClose={() => setSelectedBlocker(null)}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 }}>
              <View style={{ backgroundColor: colors.background, borderRadius: 16, padding: 24, width: "100%", maxWidth: 360, gap: 16 }}>
                <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground, textAlign: "center" }}>Remove Schedule Block?</Text>
                <View style={{ backgroundColor: "#ef444418", borderRadius: 10, borderWidth: 1, borderColor: "#ef4444", padding: 14, gap: 4 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: "#ef4444" }}>{b.detailerName} — {b.reason}</Text>
                  <Text style={{ fontSize: 12, color: "#ef4444", opacity: 0.8 }}>{b.date} · {b.allDay ? "All Day" : `${formatHour(b.startHour)} – ${formatHour(b.endHour)}`}</Text>
                </View>
                <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center" }}>This will remove the schedule block. Any existing jobs are not affected.</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => setSelectedBlocker(null)}
                    style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
                    activeOpacity={0.75}
                  >
                    <Text style={{ color: colors.foreground, fontWeight: "600" }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      blockerDeleteMutation.mutate(
                        { id: selectedBlocker },
                        {
                          onSuccess: () => { setSelectedBlocker(null); forceSync(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); },
                          onError: (e) => Alert.alert("Error", e.message),
                        }
                      );
                    }}
                    disabled={blockerDeleteMutation.isPending}
                    style={{ flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: "#ef4444", alignItems: "center", opacity: blockerDeleteMutation.isPending ? 0.6 : 1 }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: "#FFF", fontWeight: "700" }}>{blockerDeleteMutation.isPending ? "Removing…" : "Remove"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        );
      })()}

      {/* ─── Charge Card on File Modal ────────────────────────────────────────────────────────────────────────────────── */}
      <Modal
        visible={showChargeModal}
        transparent
        animationType="slide"
        onRequestClose={() => { if (!chargingCard) setShowChargeModal(false); }}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
            <View style={{ width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: "center", marginBottom: 20 }} />
            <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground, marginBottom: 4 }}>💳 Charge Card on File</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 20 }}>{selectedJob?.firstName} {selectedJob?.lastName}</Text>

            {/* Card selector */}
            {((scheduleSavedCards as any[]) ?? []).length > 1 && (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, letterSpacing: 0.5, marginBottom: 8 }}>SELECT CARD</Text>
                {((scheduleSavedCards as any[]) ?? []).map((card: any) => (
                  <TouchableOpacity
                    key={card.stripePaymentMethodId}
                    onPress={() => setSelectedChargeCardId(card.stripePaymentMethodId)}
                    style={{ flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, marginBottom: 8, borderWidth: 2, borderColor: selectedChargeCardId === card.stripePaymentMethodId ? colors.primary : colors.border, backgroundColor: colors.background }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontSize: 16, marginRight: 10 }}>💳</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{card.brand?.toUpperCase() ?? "Card"} •••• {card.last4 ?? "????"}</Text>
                      <Text style={{ fontSize: 12, color: colors.muted }}>Expires {card.expMonth}/{card.expYear}{card.isDefault ? " · Default" : ""}</Text>
                    </View>
                    {selectedChargeCardId === card.stripePaymentMethodId && <Text style={{ color: colors.primary, fontWeight: "700" }}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {((scheduleSavedCards as any[]) ?? []).length === 1 && (() => {
              const card = (scheduleSavedCards as any[])[0];
              return (
                <View style={{ flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
                  <Text style={{ fontSize: 16, marginRight: 10 }}>💳</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{card.brand?.toUpperCase() ?? "Card"} •••• {card.last4 ?? "????"}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>Expires {card.expMonth}/{card.expYear}</Text>
                  </View>
                </View>
              );
            })()}
            {((scheduleSavedCards as any[]) ?? []).length === 0 && (
              <View style={{ alignItems: "center", paddingVertical: 20, marginBottom: 16 }}>
                <Text style={{ fontSize: 32, marginBottom: 8 }}>💳</Text>
                <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14, marginBottom: 4 }}>No Cards on File</Text>
                <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center", lineHeight: 18 }}>This customer has no saved cards. Use \"Send Portal Access\" so they can add a card.</Text>
              </View>
            )}

            {/* Amount input */}
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, letterSpacing: 0.5, marginBottom: 8 }}>AMOUNT</Text>
            <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, marginBottom: 24 }}>
              <Text style={{ fontSize: 18, color: colors.muted, marginRight: 4 }}>$</Text>
              <TextInput
                value={chargeAmount}
                onChangeText={setChargeAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.muted}
                style={{ flex: 1, fontSize: 24, fontWeight: "700", color: colors.foreground, paddingVertical: 14 }}
                returnKeyType="done"
                editable={!chargingCard}
              />
            </View>

            {/* Buttons */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                onPress={() => { if (!chargingCard) { setShowChargeModal(false); setChargeAmount(""); } }}
                style={{ flex: 1, padding: 16, backgroundColor: colors.border, borderRadius: 14, alignItems: "center" }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const cards = (scheduleSavedCards as any[]) ?? [];
                  const card = cards.find((c: any) => c.stripePaymentMethodId === selectedChargeCardId) ?? cards[0];
                  if (!card) { Alert.alert("No Card Selected", "This customer has no saved cards."); return; }
                  const amountDollars = parseFloat(chargeAmount);
                  if (!amountDollars || amountDollars <= 0) { Alert.alert("Invalid Amount", "Enter a valid charge amount."); return; }
                  const amountCents = Math.round(amountDollars * 100);
                  Alert.alert(
                    "Confirm Charge",
                    `Charge $${amountDollars.toFixed(2)} to ${card.brand?.toUpperCase() ?? "card"} ending in ${card.last4 ?? "????"} for ${selectedJob?.firstName ?? ""} ${selectedJob?.lastName ?? ""}?`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Charge",
                        style: "default",
                        onPress: () => {
                          setChargingCard(true);
                          scheduleChargeCardMutation.mutate({
                            stripeCustomerId: card.stripeCustomerId,
                            stripePaymentMethodId: card.stripePaymentMethodId,
                            amountCents,
                            description: `Admin charge — ${selectedJob?.packageType ?? "Service"} for ${selectedJob?.firstName ?? ""} ${selectedJob?.lastName ?? ""} (Job ${selectedJob?.id ?? ""})`,
                          });
                        },
                      },
                    ]
                  );
                }}
                style={{ flex: 2, padding: 16, backgroundColor: chargingCard ? "#22c55e80" : "#22c55e", borderRadius: 14, alignItems: "center" }}
                activeOpacity={0.8}
                disabled={chargingCard || ((scheduleSavedCards as any[]) ?? []).length === 0}
              >
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>{chargingCard ? "Processing..." : "Charge Card"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 20, fontWeight: "700" },
  todayBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, borderWidth: 1.5 },
  todayBtnText: { fontWeight: "600", fontSize: 14 },
  weekStrip: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  weekArrow: { paddingHorizontal: 8 },
  weekDayCell: { flex: 1, alignItems: "center" },
  weekDayName: { fontSize: 11, fontWeight: "600", letterSpacing: 0.2, marginBottom: 4 },
  weekDayNumCircle: { width: 30, height: 30, borderRadius: 15, justifyContent: "center", alignItems: "center" },
  weekDayNum: { fontSize: 15, fontWeight: "700" },
  dayDot: { width: 5, height: 5, borderRadius: 3, marginTop: 3 },
  dayLabel: { paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  dayLabelText: { fontSize: 14, fontWeight: "500" },
});
