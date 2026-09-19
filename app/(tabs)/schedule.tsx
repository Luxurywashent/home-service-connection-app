import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Constants from "expo-constants";
import { useLocalSearchParams } from "expo-router";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Linking,
  ActivityIndicator,
  Dimensions,
  Switch,
  RefreshControl,
  AppState,
  FlatList,
  type AppStateStatus,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView as GHScrollView } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
  withTiming,
} from "react-native-reanimated";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "react-native";
import Svg, { Rect, Text as SvgText, G, Path } from "react-native-svg";
import { ScreenContainer } from "@/components/screen-container";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { useColors } from "@/hooks/use-colors";
import { useCompanyPriceBook } from "@/hooks/use-company-price-book";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import { getJobSyncCompanyJobs, getJobSyncCompanyMembers, updateJobSyncCompanyJobStatus, type JobSyncCompanyMember } from "@/lib/jobsync-mobile-api";
import {
  allowsLegacyJobAuthority,
  canonicalJobId,
  COMPANY_LEGACY_FALLTHROUGH_BLOCKED,
  companyCanonicalReadError,
  companyScheduleCheckoutMounted,
  mapCanonicalJobToScheduleFields,
  nextCanonicalJobStatus,
  resolveCompanyJobAuthority,
  usesCompanyJobAuthority,
} from "@/lib/jobsync-company-authority";
import { CompanyCollectPayment } from "@/components/company-collect-payment";
import { COMPANY_SCHEDULE_HALF_HOUR_SLOTS, COMPANY_SCHEDULE_START_HOUR, companyScheduleInitialOffset, companyScheduleSlotIndex } from "@/lib/jobsync-schedule-window";
import { useJobSyncSync } from "@/lib/jobsync-sync-context";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { NavigationMapModal } from "@/components/navigation-map-modal";

// ─── Service Catalog ──────────────────────────────────────────────────────────

type VehicleType = "sedan" | "suv" | "xl_suv_van" | "truck" | "rv_20_29" | "rv_30_39" | "rv_40_plus";

const VEHICLE_TYPES: { id: VehicleType; label: string; emoji: string; group?: "rv" }[] = [
  { id: "sedan", label: "Sedan", emoji: "🚗" },
  { id: "suv", label: "SUV", emoji: "🚙" },
  { id: "xl_suv_van", label: "XL SUV / Van", emoji: "🚐" },
  { id: "truck", label: "Truck", emoji: "🛻" },
  { id: "rv_20_29", label: "RV 20ft–29ft", emoji: "🚐", group: "rv" },
  { id: "rv_30_39", label: "RV 30ft–39ft", emoji: "🚌", group: "rv" },
  { id: "rv_40_plus", label: "RV 40ft+", emoji: "🚎", group: "rv" },
];

const RV_VEHICLE_IDS = new Set<VehicleType>(["rv_20_29", "rv_30_39", "rv_40_plus"]);
function isRvVehicle(v: VehicleType | null): boolean { return v !== null && RV_VEHICLE_IDS.has(v); }

interface PackageDef {
  id: string;
  title: string;
  emoji: string;
  tagline: string;
  features: string[];
  basePrice: Partial<Record<VehicleType, number>>;
  isRv?: boolean; // true for RV-specific services
}

const PACKAGES: PackageDef[] = [
  {
    id: "basic",
    title: "Basic Detail",
    emoji: "🚗",
    tagline: "Best for vehicle less than 2 years old or detailed in the last 60 Days",
    features: [
      "Exterior Hand Wash",
      "Debug Front End",
      "Wheels, Tires, Wheel Wells",
      "Door Jambs",
      "Basic Interior Wipe Down",
      "Vacuum Seats & Carpets",
      "Cup Holders",
      "Windows Inside/Out",
      "Tire Dressing",
    ],
    basePrice: { sedan: 200, suv: 225, xl_suv_van: 250, truck: 225 },
  },
  {
    id: "full",
    title: "Full Detail",
    emoji: "🧼",
    tagline: "Best for vehicles that don't have stains or detailed in the last 90 Days",
    features: [
      "Everything In Basic +",
      "Gas Cap",
      "Tar Removal",
      "90 Day Paint Protectant",
      "Inside Barrel Of Wheels",
      "Deep Interior Cleaning",
      "Leather Cleaning",
      "Headliner",
    ],
    basePrice: { sedan: 300, suv: 325, xl_suv_van: 375, truck: 325 },
  },
  {
    id: "luxury",
    title: "Luxury Detail",
    emoji: "✨",
    tagline: "Best for vehicles that need a deep cleaning or have not been cleaned in 90+ Days",
    features: [
      "Everything in the Full Detail +",
      "Engine Bay",
      "Exhaust Tips",
      "6 Month Paint Sealant",
      "Deep Leather Cleaning",
      "Between Seats & Console",
      "Shampoo Seats & Carpets",
      "Gas/Brake Pedal",
    ],
    basePrice: { sedan: 400, suv: 450, xl_suv_van: 500, truck: 450 },
  },
  {
    id: "interior",
    title: "Interior Detail",
    emoji: "🪑",
    tagline: "Deep Interior Cleaning",
    features: [
      "Deep Interior Cleaning",
      "Vacuum Seats & Carpets",
      "Carpet/Seat Shampoo",
      "Dash/Console/Doors Cleaned",
      "Cup Holders",
      "Deep Leather Cleaning",
      "Between Seats & Console",
      "Headliner",
      "Gas/Brake Pedal",
      "Windows Interior",
    ],
    basePrice: { sedan: 250, suv: 275, xl_suv_van: 325, truck: 275 },
  },
  {
    id: "exterior",
    title: "Exterior Detail",
    emoji: "🛡️",
    tagline: "Thorough Exterior Clean & Protect",
    features: [
      "Exterior Hand Wash",
      "Debug Front End",
      "Gas Cap",
      "Wheels, Tires, Wheel Wells",
      "Exhaust Tips",
      "90 Day Paint Protectant",
    ],
    basePrice: { sedan: 200, suv: 225, xl_suv_van: 250, truck: 225 },
  },
];

/**
 * Parse selectedAddons from DB — handles both JSON arrays (e.g. ["ozone","clay_bar"])
 * and plain comma-separated human-readable strings (e.g. "Deep Interior Cleaning, Ozone").
 * Returns an array of addon IDs that match entries in ADDONS.
 */
function parseAddonIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  // Website addon ID aliases (booking website uses different IDs than admin)
  const addonAliases: Record<string, string> = {
    paint_enhancement: "one_step_paint",
    one_step_paint_enhancement: "one_step_paint",
    rain_x_treatment: "rain_x",
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
  // Try JSON array first
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed
      .filter((x: any) => typeof x === "string")
      .map((x: string) => addonAliases[x.toLowerCase()] ?? addonAliases[x] ?? x);
  } catch { /* not JSON */ }
  // Fall back: comma-separated human-readable names or hyphenated slugs — map to IDs
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

/** Map a human-readable package name or short key (from DB packageType) to a local package ID. */
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
  const firstWord = lower.split("_")[0];
  // Direct ID match (e.g. "luxury", "full", "basic")
  const idMatch = PACKAGES.find(p => p.id === lower || p.id === firstWord);
  if (idMatch) return `pb_${idMatch.id}`;
  // Exact title match (e.g. "Luxury Detail")
  const exact = PACKAGES.find(p => p.title.toLowerCase() === lower);
  if (exact) return `pb_${exact.id}`;
  // Partial match (e.g. "luxury" in "luxury detail")
  const partial = PACKAGES.find(p => lower.includes(p.id) || p.title.toLowerCase().split(" ")[0] === lower.split(" ")[0]);
  if (partial) return `pb_${partial.id}`;
  return undefined;
}

/** Normalize Zapier vehicle type values to app VehicleType IDs. */
function resolveVehicleType(raw?: string | null): VehicleType | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Already a valid app ID
  const valid: VehicleType[] = ["sedan", "suv", "xl_suv_van", "truck", "rv_20_29", "rv_30_39", "rv_40_plus"];
  if (valid.includes(raw as VehicleType)) return raw as VehicleType;
  // Zapier / website short names
  if (lower === "small" || lower === "compact") return "sedan";
  if (lower === "midsize" || lower === "mid") return "sedan";
  if (lower === "suv" || lower === "crossover") return "suv";
  if (lower === "xlsuv" || lower === "xlsuvan" || lower === "van" || lower === "minivan") return "xl_suv_van";
  if (lower === "truck" || lower === "pickup") return "truck";
  if (lower.startsWith("rv")) return "rv_20_29";
  // Fuzzy: first word match
  const firstWord = lower.replace(/[^a-z]/g, "");
  if (firstWord.includes("sedan") || firstWord.includes("car") || firstWord.includes("coupe") || firstWord.includes("hatch")) return "sedan";
  if (firstWord.includes("suv") || firstWord.includes("sport")) return "suv";
  if (firstWord.includes("van") || firstWord.includes("xl")) return "xl_suv_van";
  if (firstWord.includes("truck") || firstWord.includes("pick")) return "truck";
  return undefined;
}

interface AddonDef {
  id: string;
  title: string;
  emoji: string;
  price: number;
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

// ─── Types ────────────────────────────────────────────────────────────────────

type JobStatus = "scheduled" | "on_my_way" | "arrived" | "started" | "finished";
type PaymentMethod = "credit_debit" | "apple_pay" | "tap_to_pay" | "cash" | "check" | "other";

interface PaymentRecord {
  method: PaymentMethod;
  subtotal: number;
  tipAmount: number;
  total: number;
  paidAt: string;
  signatureData?: string;
  cardLast4?: string;
  referenceNote?: string;
  paymentIntentId?: string;
  refundedAt?: string;
  refundId?: string;
}

interface Job {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  vehicleType?: VehicleType;
  packageId?: string;
  addonIds?: string[];
  addonQtys?: Record<string, number>; // addonId -> quantity
  serviceTitle: string;
  serviceDescription: string;
  price: number;
  startHour: number;
  endHour: number;
  dayIndex: number;
  weekOffset: number;
  status: JobStatus;
  notes?: string;
  photos?: string[];              // local device URIs (not yet uploaded)
  photoUrls?: string[];           // S3 URLs uploaded to server
  videoUrls?: string[];           // S3 video URLs uploaded to server
  payment?: PaymentRecord;
  createdAt: string;
  location?: string; // city slug: crestview | niceville | destin | fwb
  isOnlineBooking?: boolean; // true if created from Zapier webhook
  bookingId?: string; // reference to online_bookings table
  // Upsells added by detailer after job starts
  upsellIds?: string[]; // addon IDs upsold on this job
  upsellQtys?: Record<string, number>; // addonId -> quantity
  upsellTotal?: number; // total dollar value of upsells
  upsellBonus?: number; // 40% of upsellTotal credited to detailer
  basePrice?: number; // original price before any upsells (set on first upsell save, never changes)
  detailerName?: string; // name of the detailer assigned to this job
  travelStartedAt?: string; // ISO timestamp when ON MY WAY was tapped
  arrivedAt?: string;       // ISO timestamp when ARRIVED was tapped (travel ends)
  jobStartedAt?: string;    // ISO timestamp when job timer started (= arrivedAt)
  jobFinishedAt?: string;   // ISO timestamp when FINISH was tapped
  // Vehicle inspection
  inspection?: VehicleInspection;
  // Enhanced job detail fields
  tags?: string[];                    // array of tag strings
  privateNotes?: PrivateNote[];       // per-author notes (JSON array)
  leadSource?: string;                // auto-populated: "Online Booking", "Admin — Manual"
  taxAmount?: number;                 // tax dollar amount
  discountCode?: string;              // discount code applied
  discountAmount?: number;            // discount dollar amount
  depositAmount?: number;              // deposit received
  additionalVehicles?: AdditionalVehicle[]; // extra vehicles on same job
  vehicleColor?: string;   // color of primary vehicle
  vehicleYear?: string;    // year of primary vehicle
  vehicleMake?: string;    // make of primary vehicle
  vehicleModel?: string;   // model of primary vehicle
  // Recommended services for next visit
  recommendedIds?: string[]; // addon IDs recommended by detailer after job
  isNewCustomer?: boolean;  // first-time customer flag set by admin at booking
  customerId?: string;      // customer portal customer ID (for portal-booked jobs)
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

type InspRating = "good" | "fair" | "poor" | "na";

interface VehicleInspection {
  completedAt: string;
  inspectedBy: string;
  ratings: Record<string, InspRating>; // categoryId -> rating
  exteriorZones: string[]; // tapped exterior zone IDs
  interiorZones: string[]; // tapped interior zone IDs
  notes?: string;
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

// ─── Vehicle Inspection Config ────────────────────────────────────────────────

const INSP_CATEGORIES = [
  { id: "paint",    label: "Paint Condition",  emoji: "🎨", desc: "Check paint finish, oxidation, swirl marks, and fading." },
  { id: "wheels",   label: "Wheels & Tires",   emoji: "🔵", desc: "Inspect wheel finish, brake dust buildup, and tire sidewalls." },
  { id: "glass",    label: "Glass & Windows",  emoji: "😪", desc: "Check for chips, cracks, and visibility issues on all glass." },
  { id: "water",    label: "Hard Water Spots", emoji: "💧", desc: "Identify mineral deposits on paint, glass, and chrome." },
  { id: "damage",   label: "Scratches & Damage", emoji: "⚠️", desc: "Document any existing scratches, dents, or body damage." },
];

const RATING_OPTIONS: { id: InspRating; label: string; emoji: string; color: string }[] = [
  { id: "good", label: "Good", emoji: "✅", color: "#22C55E" },
  { id: "fair", label: "Fair", emoji: "⚠️", color: "#F59E0B" },
  { id: "poor", label: "Poor", emoji: "❌", color: "#EF4444" },
  { id: "na",   label: "N/A",  emoji: "—",  color: "#6B7280" },
];

// Exterior zones as % of image (1696w × 2528h)
// top/left/w/h are percentages of the displayed image container
const EXTERIOR_ZONES = [
  { id: "front_bumper", label: "Front Bumper", top: 2,  left: 24, w: 52, h: 7  },
  { id: "hood",         label: "Hood",         top: 9,  left: 20, w: 60, h: 17 },
  { id: "windshield",   label: "Windshield",   top: 26, left: 20, w: 60, h: 13 },
  { id: "driver_door",  label: "Driver Door",  top: 39, left: 2,  w: 18, h: 24 },
  { id: "roof",         label: "Roof",         top: 39, left: 20, w: 60, h: 24 },
  { id: "pass_door",    label: "Pass Door",    top: 39, left: 80, w: 18, h: 24 },
  { id: "rear_glass",   label: "Rear Glass",   top: 63, left: 20, w: 60, h: 13 },
  { id: "trunk",        label: "Trunk",        top: 76, left: 20, w: 60, h: 16 },
  { id: "rear_bumper",  label: "Rear Bumper",  top: 92, left: 24, w: 52, h: 7  },
];

const INTERIOR_ZONES = [
  // Image: 1056×1408px — zones as % of image dimensions
  { id: "dashboard",       label: "Dashboard",       top: 8,  left: 12, w: 76, h: 9  },
  { id: "front_floor_l",   label: "Front Floor Left", top: 17, left: 12, w: 30, h: 12 },
  { id: "front_floor_r",   label: "Front Floor Right",top: 17, left: 58, w: 30, h: 12 },
  { id: "front_left_seat", label: "Front Left Seat",  top: 29, left: 12, w: 28, h: 19 },
  { id: "center_console",  label: "Center Console",   top: 29, left: 40, w: 20, h: 19 },
  { id: "front_right_seat",label: "Front Right Seat", top: 29, left: 60, w: 28, h: 19 },
  { id: "left_door",       label: "Left Door Panel",  top: 17, left: 2,  w: 10, h: 56 },
  { id: "right_door",      label: "Right Door Panel", top: 17, left: 88, w: 10, h: 56 },
  { id: "rear_floor",      label: "Rear Floor",       top: 48, left: 12, w: 76, h: 8  },
  { id: "rear_left_seat",  label: "Rear Left Seat",   top: 56, left: 12, w: 24, h: 20 },
  { id: "rear_center_seat",label: "Rear Center Seat", top: 56, left: 36, w: 28, h: 20 },
  { id: "rear_right_seat", label: "Rear Right Seat",  top: 56, left: 64, w: 24, h: 20 },
  { id: "trunk_cargo",     label: "Trunk/Cargo",      top: 80, left: 10, w: 80, h: 14 },
];

// ─── Location Config ──────────────────────────────────────────────────────────

const LOCATIONS = [
  { slug: "crestview",  label: "Crestview",         capacity: 3 },
  { slug: "niceville",  label: "Niceville",          capacity: 2 },
  { slug: "destin",     label: "Destin",             capacity: 1 },
  { slug: "fwb",        label: "Fort Walton Beach",  capacity: 1 },
  { slug: "pensacola",  label: "Pensacola",          capacity: 1 },
] as const;

type LocationSlug = typeof LOCATIONS[number]["slug"];

// Map an employee city string to a location slug
function cityToSlug(city: string): LocationSlug {
  const c = city.toLowerCase().trim();
  if (c.includes("fort walton") || c === "fwb") return "fwb";
  if (c.includes("destin")) return "destin";
  if (c.includes("niceville")) return "niceville";
  if (c.includes("pensacola")) return "pensacola";
  if (c.includes("crestview")) return "crestview";
  return "crestview"; // fallback
}

const APP_API_BASE = "https://luxwashapp-n2wveyqg.manus.space";

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEK_DAYS_SHORT = ["M", "T", "W", "T", "F", "S", "S"];
const WEEK_DAYS_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Half-hour slots across the full day. The visible grid opens at 8 AM, but
// authoritative early and late Company Jobs remain reachable by scrolling.
const SCHEDULE_START_HOUR = COMPANY_SCHEDULE_START_HOUR;
const HOURS = COMPANY_SCHEDULE_HALF_HOUR_SLOTS;
const SLOT_HEIGHT = 32; // half height since slots are 30min now
const TIME_COL_WIDTH = 68;

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

const hourToSlotIndex = companyScheduleSlotIndex;

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
 * Using "T12:00:00" (local noon) ensures the date resolves to the correct local day
 * regardless of timezone offset.
 */
function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr + "T12:00:00");
}

function formatElapsed(startIso: string | undefined): string {
  if (!startIso) return "0:00";
  const secs = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const STATUS_LABELS: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  on_my_way: "On My Way",
  arrived: "Arrived",
  started: "In Progress",
  finished: "Finished",
};

const STATUS_NEXT: Record<JobStatus, JobStatus | null> = {
  scheduled: "on_my_way",
  on_my_way: "arrived",
  arrived: "finished",
  started: "finished",
  finished: null,
};

const STATUS_COLOR: Record<JobStatus, string> = {
  scheduled: "#3B82F6",
  on_my_way: "#F59E0B",
  arrived: "#8B5CF6",
  started: "#10B981",
  finished: "#6B7280",
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  credit_debit: "Credit / Debit Card",
  apple_pay: "Apple Pay",
  tap_to_pay: "Tap to Pay on iPhone",
  cash: "Cash",
  check: "Check",
  other: "Other",
};

const PAYMENT_METHOD_ICONS: Record<PaymentMethod, string> = {
  credit_debit: "💳",
  apple_pay: "🍎",
  tap_to_pay: "📲",
  cash: "💵",
  check: "📝",
  other: "🔖",
};

const TIP_PRESETS = [
  { label: "15%", pct: 0.15 },
  { label: "18%", pct: 0.18 },
  { label: "20%", pct: 0.20 },
  { label: "25%", pct: 0.25 },
];

function openGoogleMaps(address: string) {
  const encoded = encodeURIComponent(address);
  const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`;
  const mapsAppUrl = Platform.OS === "ios"
    ? `comgooglemaps://?daddr=${encoded}&directionsmode=driving`
    : `google.navigation:q=${encoded}`;
  if (Platform.OS !== "web") {
    Linking.canOpenURL(mapsAppUrl)
      .then((ok) => Linking.openURL(ok ? mapsAppUrl : googleUrl))
      .catch(() => Linking.openURL(googleUrl));
  } else {
    Linking.openURL(googleUrl);
  }
}

// ─── Service Wizard ───────────────────────────────────────────────────────────

type WizardStep = "vehicle" | "package" | "addons";

interface ServiceWizardProps {
  onSelect: (serviceTitle: string, serviceDescription: string, price: number, vehicleType: VehicleType, packageId: string, addonIds: string[]) => void;
  onCancel: () => void;
  packages: PackageDef[];
  isCompanySession: boolean;
  isLoadingPriceBook: boolean;
  priceBookError: string | null;
}

function ServiceWizard({ onSelect, onCancel, packages, isCompanySession, isLoadingPriceBook, priceBookError }: ServiceWizardProps) {
  const colors = useColors();
  const [step, setStep] = useState<WizardStep>("vehicle");
  const [vehicle, setVehicle] = useState<VehicleType | null>(null);
  const [pkg, setPkg] = useState<PackageDef | null>(null);
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set());
  const [rvSealantFeet, setRvSealantFeet] = useState<string>("");
  // Filter packages to match the selected vehicle group
  const filteredPackages = packages.filter((p) =>
    isRvVehicle(vehicle) ? p.isRv : !p.isRv
  );

  const toggleAddon = (id: string) => {
    setSelectedAddons((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addonTotal = ADDONS.filter((a) => selectedAddons.has(a.id)).reduce((s, a) => s + a.price, 0);
  const packagePrice = pkg && vehicle ? (pkg.basePrice[vehicle] ?? 0) : 0;
  const rvSealantFt = parseInt(rvSealantFeet) || 0;
  const rvSealantTotal = rvSealantFt * 15;
  const total = packagePrice + addonTotal + rvSealantTotal;

  const handleConfirm = () => {
    if (!vehicle || !pkg) return;
    const addonList = ADDONS.filter((a) => selectedAddons.has(a.id));
    const addonNames = addonList.map((a) => a.title).join(", ");
    const sealantLabel = rvSealantFt > 0 ? ` + Sealant (${rvSealantFt}ft)` : "";
    const title = pkg.title + (addonList.length > 0 ? ` + ${addonList.length} Add-on${addonList.length > 1 ? "s" : ""}` : "") + sealantLabel;
    const desc = pkg.tagline + (addonNames ? `\nAdd-ons: ${addonNames}` : "") + (rvSealantFt > 0 ? `\nRV Paint Sealant: ${rvSealantFt}ft ($${rvSealantTotal})` : "");
    onSelect(title, desc, total, vehicle, pkg.id, Array.from(selectedAddons));
  };

  // Step 1: Vehicle
  if (step === "vehicle") {
    const regularTypes = VEHICLE_TYPES.filter((v) => !v.group);
    const rvTypes = VEHICLE_TYPES.filter((v) => v.group === "rv");
    return (
      <View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <Text style={[wz.title, { color: colors.foreground }]}>What type of vehicle?</Text>
          <TouchableOpacity onPress={onCancel}><Text style={{ color: colors.muted, fontSize: 22 }}>✕</Text></TouchableOpacity>
        </View>
        {regularTypes.map((v) => (
          <TouchableOpacity
            key={v.id}
            onPress={() => { setVehicle(v.id); setStep("package"); }}
            style={[wz.vehicleCard, { backgroundColor: colors.background, borderColor: colors.border }]}
            activeOpacity={0.75}
          >
            <Text style={wz.vehicleEmoji}>{v.emoji}</Text>
            <Text style={[wz.vehicleLabel, { color: colors.foreground }]}>{v.label}</Text>
            <Text style={{ color: colors.muted, fontSize: 20 }}>›</Text>
          </TouchableOpacity>
        ))}
        {/* RV section */}
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600", marginTop: 14, marginBottom: 6, letterSpacing: 0.8 }}>RV SERVICES</Text>
        {rvTypes.map((v) => (
          <TouchableOpacity
            key={v.id}
            onPress={() => { setVehicle(v.id); setStep("package"); }}
            style={[wz.vehicleCard, { backgroundColor: colors.background, borderColor: colors.border }]}
            activeOpacity={0.75}
          >
            <Text style={wz.vehicleEmoji}>{v.emoji}</Text>
            <Text style={[wz.vehicleLabel, { color: colors.foreground }]}>{v.label}</Text>
            <Text style={{ color: colors.muted, fontSize: 20 }}>›</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  // Step 2: Package
  if (step === "package") {
    return (
      <View>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 10 }}>
          <TouchableOpacity onPress={() => setStep("vehicle")}><Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text></TouchableOpacity>
          <Text style={[wz.title, { color: colors.foreground, flex: 1 }]}>Choose Your Package</Text>
        </View>
        <Text style={[wz.vehicleChip, { backgroundColor: colors.primary + "22", color: colors.primary }]}>
          {VEHICLE_TYPES.find((v) => v.id === vehicle)?.emoji} {VEHICLE_TYPES.find((v) => v.id === vehicle)?.label}
        </Text>
        {filteredPackages.map((p) => {
          const price = vehicle ? (p.basePrice[vehicle] ?? 0) : 0;
          const selected = pkg?.id === p.id;
          return (
            <TouchableOpacity
              key={p.id}
              onPress={() => { setPkg(p); setStep("addons"); }}
              style={[wz.pkgCard, { backgroundColor: colors.background, borderColor: selected ? colors.primary : colors.border, borderWidth: selected ? 2 : 1 }]}
              activeOpacity={0.8}
            >
              <Text style={wz.pkgEmoji}>{p.emoji}</Text>
              <Text style={[wz.pkgTitle, { color: colors.foreground }]}>{p.title}</Text>
              <Text style={[wz.pkgTagline, { color: colors.muted }]}>{p.tagline}</Text>
              {p.features.map((f) => (
                <View key={f} style={wz.featureRow}>
                  <View style={[wz.featureDot, { backgroundColor: colors.primary }]} />
                  <Text style={[wz.featureText, { color: colors.foreground }]}>{f}</Text>
                </View>
              ))}
              <Text style={[wz.pkgPrice, { color: colors.primary }]}>${price.toFixed(2)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  // Step 3: Confirm the selected service. Legacy sessions can still add local add-ons.
  const isRvJob = vehicle ? isRvVehicle(vehicle) : false;
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 10 }}>
        <TouchableOpacity onPress={() => setStep("package")}><Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text></TouchableOpacity>
        <Text style={[wz.title, { color: colors.foreground, flex: 1 }]}>{isCompanySession ? "Review Service" : "Choose Your Add-Ons"}</Text>
      </View>
      <View style={[wz.summaryRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={{ color: colors.foreground, fontWeight: "600" }}>{pkg?.title}</Text>
        <Text style={{ color: colors.primary, fontWeight: "700" }}>${packagePrice.toFixed(2)}</Text>
      </View>
      {/* RV Paint Sealant footage input — only shown for RV jobs */}
      {isRvJob && !isCompanySession && (
        <View style={{ borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: rvSealantFt > 0 ? 2 : 1, borderColor: rvSealantFt > 0 ? colors.primary : colors.border, backgroundColor: rvSealantFt > 0 ? colors.primary + "12" : colors.surface }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
            <Text style={{ fontSize: 22, marginRight: 10 }}>🎨</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15 }}>RV Paint Sealant</Text>
              <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 12 }}>$15 per foot{rvSealantFt > 0 ? ` · ${rvSealantFt}ft = $${rvSealantTotal}` : ""}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600" }}>RV Length (ft):</Text>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.background }}>
              <TextInput
                value={rvSealantFeet}
                onChangeText={(v) => setRvSealantFeet(v.replace(/[^0-9]/g, ""))}
                placeholder="Enter footage…"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                style={{ flex: 1, color: colors.foreground, fontSize: 16, fontWeight: "600" }}
              />
              {rvSealantFt > 0 && (
                <TouchableOpacity onPress={() => setRvSealantFeet("")}>
                  <Text style={{ color: colors.muted, fontSize: 16, paddingLeft: 6 }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      )}
      {/* Standard add-ons — hidden for RV jobs */}
      {!isRvJob && !isCompanySession && (
        <View style={wz.addonGrid}>
          {ADDONS.map((a) => {
            const sel = selectedAddons.has(a.id);
            return (
              <TouchableOpacity
                key={a.id}
                onPress={() => toggleAddon(a.id)}
                style={[wz.addonCard, { backgroundColor: sel ? colors.primary + "18" : colors.background, borderColor: sel ? colors.primary : colors.border, borderWidth: sel ? 2 : 1 }]}
                activeOpacity={0.75}
              >
                <Text style={wz.addonEmoji}>{a.emoji}</Text>
                <Text style={[wz.addonTitle, { color: colors.foreground }]} numberOfLines={2}>{a.title}</Text>
                <Text style={[wz.addonPrice, { color: colors.primary }]}>${a.price.toFixed(2)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      <View style={[wz.totalBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Total</Text>
          <Text style={{ color: colors.primary, fontSize: 24, fontWeight: "800" }}>${total.toFixed(2)}</Text>
        </View>
        <TouchableOpacity
          onPress={handleConfirm}
          style={[wz.confirmBtn, { backgroundColor: colors.primary }]}
          activeOpacity={0.85}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
            {isCompanySession ? "Use Service" : (selectedAddons.size > 0 || rvSealantFt > 0) ? `Add ${selectedAddons.size + (rvSealantFt > 0 ? 1 : 0)} Add-on${selectedAddons.size + (rvSealantFt > 0 ? 1 : 0) > 1 ? "s" : ""}` : "No Add-ons"} →
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const wz = StyleSheet.create({
  title: { fontSize: 20, fontWeight: "700" },
  vehicleCard: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, padding: 18, marginBottom: 12, gap: 14 },
  vehicleEmoji: { fontSize: 28, width: 40, textAlign: "center" },
  vehicleLabel: { flex: 1, fontSize: 18, fontWeight: "600" },
  vehicleChip: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, fontWeight: "600", fontSize: 14, marginBottom: 14 },
  pkgCard: { borderRadius: 16, padding: 18, marginBottom: 14, alignItems: "center" },
  pkgEmoji: { fontSize: 36, marginBottom: 8 },
  pkgTitle: { fontSize: 20, fontWeight: "700", marginBottom: 6 },
  pkgTagline: { fontSize: 13, textAlign: "center", marginBottom: 14, lineHeight: 18 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 5, alignSelf: "flex-start" },
  featureDot: { width: 7, height: 7, borderRadius: 4 },
  featureText: { fontSize: 14 },
  pkgPrice: { fontSize: 28, fontWeight: "800", marginTop: 14 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 14 },
  addonGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  addonCard: { width: "47%", borderRadius: 14, padding: 14, alignItems: "center", minHeight: 110 },
  addonEmoji: { fontSize: 30, marginBottom: 6 },
  addonTitle: { fontSize: 13, fontWeight: "600", textAlign: "center", marginBottom: 4 },
  addonPrice: { fontSize: 16, fontWeight: "700" },
  totalBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 8 },
  confirmBtn: { borderRadius: 14, paddingHorizontal: 20, paddingVertical: 14 },
});

// ─── Signature Canvas (web only) ─────────────────────────────────────────────

interface SignatureCanvasRef {
  clearSignature: () => void;
  readSignature: () => Promise<string | null>;
}

type SigPoint = { x: number; y: number };
type SigPath = SigPoint[];

// React Native SVG + PanResponder-based signature pad (works on iOS, Android, and web)
// Design: committed strokes live in `paths` state; the in-progress stroke lives in
// `livePath` state. Both are updated via setState (no forceUpdate) so React batches
// them cleanly and the panResponder — created once with empty deps — never re-creates.
const SignatureCanvas = React.memo(React.forwardRef<SignatureCanvasRef, { onDraw: () => void; onClear: () => void; onDrawStart?: () => void; onDrawEnd?: () => void }>(
  ({ onDraw, onClear, onDrawStart, onDrawEnd }, ref) => {
    // committed strokes (each released stroke)
    const [paths, setPaths] = useState<SigPath[]>([]);
    // the stroke currently being drawn
    const [livePath, setLivePath] = useState<SigPath>([]);
    const { PanResponder: PR } = require("react-native");

    // Store callbacks in refs so panResponder is only created once and never re-created
    // when parent re-renders (which would wipe the drawn paths)
    const onDrawRef = useRef(onDraw);
    const onClearRef = useRef(onClear);
    const onDrawStartRef = useRef(onDrawStart);
    const onDrawEndRef = useRef(onDrawEnd);
    useEffect(() => { onDrawRef.current = onDraw; }, [onDraw]);
    useEffect(() => { onClearRef.current = onClear; }, [onClear]);
    useEffect(() => { onDrawStartRef.current = onDrawStart; }, [onDrawStart]);
    useEffect(() => { onDrawEndRef.current = onDrawEnd; }, [onDrawEnd]);

    const panResponder = React.useMemo(() =>
      PR.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e: { nativeEvent: { locationX: number; locationY: number } }) => {
          const pt = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
          setLivePath([pt]);
          onDrawRef.current();
          onDrawStartRef.current?.();
        },
        onPanResponderMove: (e: { nativeEvent: { locationX: number; locationY: number } }) => {
          const pt = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
          setLivePath(prev => [...prev, pt]);
        },
        onPanResponderRelease: () => {
          // commit live path into paths, clear live
          setLivePath(prev => {
            if (prev.length > 0) {
              setPaths(p => [...p, prev]);
            }
            return [];
          });
          onDrawEndRef.current?.();
        },
        onPanResponderTerminate: () => {
          // commit whatever we have so strokes aren't lost on termination
          setLivePath(prev => {
            if (prev.length > 0) {
              setPaths(p => [...p, prev]);
            }
            return [];
          });
          onDrawEndRef.current?.();
        },
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    , []);

    // paths ref for readSignature (always up-to-date without closure staleness)
    const pathsRef = useRef<SigPath[]>([]);
    useEffect(() => { pathsRef.current = paths; }, [paths]);

    React.useImperativeHandle(ref, () => ({
      clearSignature: () => { setPaths([]); setLivePath([]); onClearRef.current(); },
      readSignature: async () => {
        const allPaths = pathsRef.current;
        if (allPaths.length === 0) return null;
        const pathData = allPaths.map(pts =>
          pts.length < 2 ? "" :
          `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ")
        ).filter(Boolean).join(" ");
        const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><path d="${pathData}" stroke="#000" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        return `data:image/svg+xml;base64,${btoa(svgStr)}`;
      },
    }));

    const toPathD = (pts: SigPoint[]) => {
      if (pts.length < 2) return "";
      return `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");
    };

    const allPaths = [...paths, livePath];

    return (
      <View style={{ flex: 1, backgroundColor: "#fff", borderRadius: 8, overflow: "hidden" }} {...panResponder.panHandlers}>
        <Svg width="100%" height="100%">
          {allPaths.map((pts, i) => {
            const d = toPathD(pts);
            if (!d) return null;
            return <Path key={i} d={d} stroke="#000" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
          })}
        </Svg>
      </View>
    );
  }
));

// ─── Checkout Modal ───────────────────────────────────────────────────────────

type CheckoutStep = "method" | "card_entry" | "card_on_file" | "apple_pay" | "tap_to_pay" | "reference" | "tip" | "signature" | "card_on_file_confirm" | "result";
type PaymentResult = { success: boolean; message: string; paymentIntentId?: string; };

function CheckoutModal({ visible, job, onClose, onComplete }: {
  visible: boolean; job: Job; onClose: () => void; onComplete: (p: PaymentRecord) => void;
}) {
  const colors = useColors();
  const [step, setStep] = useState<CheckoutStep>("method");
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [cardNumber, setCardNumber] = useState(""); const [cardExpiry, setCardExpiry] = useState(""); const [cardCvc, setCardCvc] = useState("");
  const [cardComplete, setCardComplete] = useState(false); // Stripe CardField complete state
  const [cardLast4, setCardLast4] = useState("");
  const [stripePaymentMethodId, setStripePaymentMethodId] = useState<string | null>(null);
  const [referenceNote, setReferenceNote] = useState("");
  const [selectedTipPct, setSelectedTipPct] = useState<number | null>(null);
  const [customTipStr, setCustomTipStr] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null);
  const [scrollLocked, setScrollLocked] = useState(false);
  const sigRef = useRef<SignatureCanvasRef>(null);
  // Hard lock ref — survives re-renders and blocks concurrent STPPaymentHandler calls
  const paymentInFlightRef = useRef(false);
  const createPaymentIntent = trpc.stripe.createPaymentIntent.useMutation();
  const scanCardMutation = trpc.stripe.scanCard.useMutation();
  const chargeCardOnFileMutation = trpc.savedCards.chargeCard.useMutation();
  const generateTipLinkMutation = trpc.savedCards.generateTipLink.useMutation();
  const [isScanning, setIsScanning] = useState(false);
  // Derive customerKey from job phone/email to look up saved cards
  const jobCustomerKey = (() => {
    const np = job.phone ? job.phone.replace(/\D/g, "").slice(-10) : null;
    if (np && np.length === 10) return `phone:${np}`;
    if (job.email) return `email:${job.email.toLowerCase()}`;
    return null;
  })();
  const savedCardsQuery = trpc.savedCards.list.useQuery(
    { customerKey: jobCustomerKey! },
    { enabled: !!jobCustomerKey && visible, staleTime: 30_000 }
  );
  const savedCard = savedCardsQuery.data?.find((c: any) => c.isDefault) ?? savedCardsQuery.data?.[0] ?? null;
  const [paymentIntentId, setPaymentIntentId] = useState<string | undefined>(undefined);
  const [isCardOnFile, setIsCardOnFile] = useState(false);

  const subtotal = Math.max(0, (job.price ?? 0) + (job.upsellTotal ?? 0) - (job.discountAmount ?? 0));
  const tipAmount = selectedTipPct === null ? 0 : selectedTipPct === -1 ? (parseFloat(customTipStr) || 0) : Math.round(subtotal * selectedTipPct * 100) / 100;
  const total = subtotal + tipAmount;

  useEffect(() => {
    if (visible) { setStep("method"); setMethod(null); setCardNumber(""); setCardExpiry(""); setCardCvc(""); setCardComplete(false); setCardLast4(""); setReferenceNote(""); setSelectedTipPct(null); setCustomTipStr(""); setHasSignature(false); setIsProcessing(false); setPaymentResult(null); setIsCardOnFile(false); }
  }, [visible]);

  const fmtCard = (t: string) => t.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
  const fmtExp = (t: string) => { const d = t.replace(/\D/g, "").slice(0, 4); return d.length >= 3 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };

  // Card: card_entry → tip → signature. Cash/check/other: reference (or skip) → signature directly (no tip step)
  const handleMethodSelect = (m: PaymentMethod) => {
    if (m === "credit_debit" || m === "apple_pay" || m === "tap_to_pay") {
      Alert.alert("Payments unavailable", "Card, Apple Pay, and Tap to Pay have been disabled in this Home Service Connection copy.");
      setMethod(null);
      return;
    }
    setMethod(m);
    if (m === "check" || m === "other") setStep("reference");
    else setStep("signature"); // cash
  };
  const handleCardNext = async () => {
    if (Platform.OS === "web") {
      // Web fallback: validate plain text inputs
      if (cardNumber.replace(/\s/g, "").length < 13) { Alert.alert("Invalid Card", "Please enter a valid card number."); return; }
      if (cardExpiry.length < 5) { Alert.alert("Invalid Expiry", "Please enter MM/YY."); return; }
      if (cardCvc.length < 3) { Alert.alert("Invalid CVC", "Please enter a valid CVC."); return; }
    } else {
      if (!cardComplete) { Alert.alert("Incomplete Card", "Please complete all card fields."); return; }
      Alert.alert("Card payments unavailable", "Card processing has been disabled in this copy.");
      setMethod(null);
      setStep("method");
      return;
    }
    setStep("tip"); // card only — after card entry always goes to tip
  };

  const handleConfirm = async () => {
    if (!hasSignature) { Alert.alert("Signature Required", "Please sign before confirming."); return; }
    setIsProcessing(true);
    try {
      const signatureData = await sigRef.current?.readSignature();
      if (method === "tap_to_pay") {
        // Tap to Pay — payment already captured by TapToPayCheckout component
        const signatureData = await sigRef.current?.readSignature();
        if (Platform.OS !== "web") await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPaymentResult({ success: true, message: "Tap to Pay approved", paymentIntentId: paymentIntentId });
        setStep("result");
        onComplete({ method: "tap_to_pay", subtotal, tipAmount, total, paidAt: new Date().toISOString(), signatureData: signatureData ?? undefined, paymentIntentId: paymentIntentId });
        return;
      } else if (method === "credit_debit" || method === "apple_pay") {
        setPaymentResult({ success: false, message: "Card and Apple Pay processing are disabled in this copy." });
        setStep("result");
        return;
      } else {
        // Cash / Check / Other / Web card (no real charge)
        if (Platform.OS !== "web") await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const digits = cardNumber.replace(/\s/g, "");
        setPaymentResult({ success: true, message: method === "cash" ? "Cash payment recorded" : method === "check" ? "Check payment recorded" : "Payment recorded" });
        setStep("result");
        onComplete({ method: method!, subtotal, tipAmount, total, paidAt: new Date().toISOString(), signatureData: signatureData ?? undefined, cardLast4: undefined, referenceNote: referenceNote.trim() || undefined });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to process. Please try again.";
      setPaymentResult({ success: false, message: msg });
      setStep("result");
    } finally { setIsProcessing(false); }
  };

  const renderMethod = () => (
    <View>
      <Text style={[co.sheetTitle, { color: colors.foreground }]}>Checkout</Text>
      <Text style={[co.sheetSubtitle, { color: colors.muted }]}>{job.firstName} {job.lastName} · {job.serviceTitle}</Text>
      <View style={[co.totalBox, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" }]}>
        <Text style={[co.totalLabel, { color: colors.muted }]}>Service Total</Text>
        <Text style={[co.totalAmount, { color: colors.primary }]}>${subtotal.toFixed(2)}</Text>
      </View>
      <Text style={[co.sectionLabel, { color: colors.muted }]}>SELECT PAYMENT METHOD</Text>
      {/* Card on File — shown first if customer has a saved card */}
      {savedCard && (
        <TouchableOpacity onPress={() => setStep("card_on_file")} style={[co.methodRow, { backgroundColor: "#059669" + "18", borderColor: "#059669" + "40" }]} activeOpacity={0.75}>
          <Text style={co.methodIcon}>💳</Text>
          <View style={{ flex: 1 }}>
            <Text style={[co.methodLabel, { color: colors.foreground }]}>Charge Card on File</Text>
            <Text style={{ fontSize: 11, color: "#059669", marginTop: 1 }}>
              {savedCard.cardBrand ? savedCard.cardBrand.charAt(0).toUpperCase() + savedCard.cardBrand.slice(1) : "Card"} ending in {savedCard.cardLast4}
            </Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
        </TouchableOpacity>
      )}
      {/* Tap to Pay — primary option */}
      {Platform.OS === "ios" && (
        <TouchableOpacity onPress={() => handleMethodSelect("tap_to_pay")} style={[co.methodRow, { backgroundColor: "#8B5CF618", borderColor: "#8B5CF640" }]} activeOpacity={0.75}>
          <Text style={co.methodIcon}>📲</Text>
          <View style={{ flex: 1 }}>
            <Text style={[co.methodLabel, { color: colors.foreground }]}>Tap to Pay on iPhone</Text>
            <Text style={{ fontSize: 11, color: "#8B5CF6", marginTop: 1 }}>Customer taps card or phone — no reader needed</Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
        </TouchableOpacity>
      )}
      {/* Manual Card Entry — card only */}
      <TouchableOpacity onPress={() => handleMethodSelect("credit_debit")} style={[co.methodRow, { backgroundColor: colors.surface, borderColor: colors.border }]} activeOpacity={0.75}>
        <Text style={co.methodIcon}>💳</Text>
        <View style={{ flex: 1 }}>
          <Text style={[co.methodLabel, { color: colors.foreground }]}>Manual Card Entry</Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>Type in card number manually</Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
      </TouchableOpacity>
    </View>
  );

  const handleScanCard = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert("Camera Permission", "Please allow camera access to scan cards."); return; }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsEditing: false });
      if (result.canceled || !result.assets?.[0]) return;
      setIsScanning(true);
      const asset = result.assets[0];
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const ext = (asset.uri.split('.').pop() || 'jpeg').toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
      const scanned = await scanCardMutation.mutateAsync({ imageBase64: base64, mimeType });
      if (scanned.cardNumber) setCardNumber(scanned.cardNumber);
      if (scanned.expiry) setCardExpiry(scanned.expiry);
      if (!scanned.cardNumber && !scanned.expiry) Alert.alert("Scan Failed", "Could not read the card. Please enter the details manually.");
    } catch {
      Alert.alert("Scan Error", "Could not scan the card. Please enter details manually.");
    } finally {
      setIsScanning(false);
    }
  };
  const renderCard = () => {
    return (
      <View>
        <TouchableOpacity onPress={() => setStep("method")} style={co.backBtn}><Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text></TouchableOpacity>
        <Text style={[co.sheetTitle, { color: colors.foreground }]}>Credit or Debit Card</Text>
        <Text style={[co.sheetSubtitle, { color: colors.muted }]}>Total: <Text style={{ color: colors.primary, fontWeight: "700" }}>${subtotal.toFixed(2)}</Text></Text>
        {/* Scan Card button removed — Stripe CardField has built-in native card scanning via the camera icon in the card number field */}
        <View style={[co.cardBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <>
              <Text style={[co.inputLabel, { color: colors.muted }]}>Card Number</Text>
              <TextInput value={cardNumber} onChangeText={(t) => setCardNumber(fmtCard(t))} placeholder="1234 5678 9012 3456" placeholderTextColor={colors.muted} keyboardType="number-pad" maxLength={19} style={[co.cardInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}><Text style={[co.inputLabel, { color: colors.muted }]}>Expiry</Text><TextInput value={cardExpiry} onChangeText={(t) => setCardExpiry(fmtExp(t))} placeholder="MM/YY" placeholderTextColor={colors.muted} keyboardType="number-pad" maxLength={5} style={[co.cardInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} /></View>
                <View style={{ flex: 1 }}><Text style={[co.inputLabel, { color: colors.muted }]}>CVC</Text><TextInput value={cardCvc} onChangeText={(t) => setCardCvc(t.replace(/\D/g, "").slice(0, 4))} placeholder="123" placeholderTextColor={colors.muted} keyboardType="number-pad" maxLength={4} secureTextEntry style={[co.cardInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} /></View>
              </View>
          </>
        </View>
        <TouchableOpacity onPress={handleCardNext} style={[co.primaryBtn, { backgroundColor: colors.primary }]} activeOpacity={0.8}><Text style={co.primaryBtnText}>Confirm Charge  ·  ${subtotal.toFixed(2)} →</Text></TouchableOpacity>
      </View>
    );
  };

  const renderApplePay = () => {
    return (
      <View>
        <TouchableOpacity onPress={() => setStep("method")} style={co.backBtn}><Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text></TouchableOpacity>
        <Text style={[co.sheetTitle, { color: colors.foreground }]}>Apple Pay</Text>
        <Text style={[co.sheetSubtitle, { color: colors.muted }]}>{job.firstName} {job.lastName} · {job.serviceTitle}</Text>
        <View style={[co.totalBox, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" }]}>
          <Text style={[co.totalLabel, { color: colors.muted }]}>Total to Charge</Text>
          <Text style={[co.totalAmount, { color: colors.primary }]}>${total.toFixed(2)}</Text>
          {tipAmount > 0 && <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Service ${subtotal.toFixed(2)} + Tip ${tipAmount.toFixed(2)}</Text>}
        </View>
        <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center", marginBottom: 20, lineHeight: 19 }}>Hand the phone to the customer to authenticate with Face ID or Touch ID.</Text>
        <TouchableOpacity onPress={() => setStep("method")} style={[co.primaryBtn, { backgroundColor: colors.muted }]} activeOpacity={0.8}>
          <Text style={co.primaryBtnText}>Apple Pay is disabled</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderTapToPay = () => (
    <View style={{ gap: 12 }}>
      <Text style={[co.sheetTitle, { color: colors.foreground }]}>Tap to Pay unavailable</Text>
      <Text style={[co.sheetSubtitle, { color: colors.muted }]}>Tap to Pay has been disabled in this copy while Stripe is disconnected.</Text>
      <TouchableOpacity onPress={() => setStep("method")} style={[co.primaryBtn, { backgroundColor: colors.muted }]}>
        <Text style={co.primaryBtnText}>Back to payment methods</Text>
      </TouchableOpacity>
    </View>
  );
  const renderCardOnFile = () => (
    <View>
      <TouchableOpacity onPress={() => setStep("method")} style={co.backBtn}><Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text></TouchableOpacity>
      <Text style={[co.sheetTitle, { color: colors.foreground }]}>Charge Card on File</Text>
      <Text style={[co.sheetSubtitle, { color: colors.muted }]}>{job.firstName} {job.lastName}</Text>
      {savedCard && (
        <View style={[co.cardBox, { backgroundColor: "#059669" + "12", borderColor: "#059669" + "40", marginBottom: 16 }]}>
          <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 16 }}>
            {savedCard.cardBrand ? savedCard.cardBrand.charAt(0).toUpperCase() + savedCard.cardBrand.slice(1) : "Card"} •••• {savedCard.cardLast4}
          </Text>
          {savedCard.cardExpMonth && savedCard.cardExpYear && (
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>Expires {savedCard.cardExpMonth}/{savedCard.cardExpYear}</Text>
          )}
        </View>
      )}
      <View style={[co.totalBox, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" }]}>
        <Text style={[co.totalLabel, { color: colors.muted }]}>Service Total</Text>
        <Text style={[co.totalAmount, { color: colors.primary }]}>${subtotal.toFixed(2)}</Text>
      </View>
      <TouchableOpacity
        onPress={() => { setIsCardOnFile(true); setStep("card_on_file_confirm"); }}
        style={[co.primaryBtn, { backgroundColor: "#059669", marginTop: 8 }]}
        activeOpacity={0.8}
      >
        <Text style={co.primaryBtnText}>Confirm Charge  ·  ${subtotal.toFixed(2)} →</Text>
      </TouchableOpacity>
    </View>
  );
  const renderReference = () => (
    <View>
      <TouchableOpacity onPress={() => setStep("method")} style={co.backBtn}><Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text></TouchableOpacity>
      <Text style={[co.sheetTitle, { color: colors.foreground }]}>{method === "check" ? "Check Details" : "Payment Reference"}</Text>
      <Text style={[co.sheetSubtitle, { color: colors.muted }]}>Total: <Text style={{ color: colors.primary, fontWeight: "700" }}>${subtotal.toFixed(2)}</Text></Text>
      <Text style={[co.inputLabel, { color: colors.muted, marginTop: 16 }]}>{method === "check" ? "Check Number (optional)" : "Reference / Note (optional)"}</Text>
      <TextInput value={referenceNote} onChangeText={setReferenceNote} placeholder={method === "check" ? "e.g. 1042" : "e.g. Invoice #123"} placeholderTextColor={colors.muted} style={[co.cardInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
      <TouchableOpacity onPress={() => setStep("tip")} style={[co.primaryBtn, { backgroundColor: colors.primary, marginTop: 8 }]} activeOpacity={0.8}><Text style={co.primaryBtnText}>Confirm Charge  ·  ${subtotal.toFixed(2)} →</Text></TouchableOpacity>
    </View>
  );

  const renderTip = () => {
    const isCustom = selectedTipPct === -1;
    return (
      <View>
        <TouchableOpacity onPress={() => { if (isCardOnFile) { setIsCardOnFile(false); setStep("card_on_file"); } else { setStep(method === "credit_debit" ? "card_entry" : (method === "check" || method === "other") ? "reference" : "method"); } }} style={co.backBtn}><Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text></TouchableOpacity>
        <Text style={[co.sheetTitle, { color: colors.foreground }]}>Add a Tip</Text>
        <View style={[co.tipSummaryBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.muted }]}>Service</Text><Text style={[co.tipSummaryValue, { color: colors.foreground }]}>${subtotal.toFixed(2)}</Text></View>
          <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.muted }]}>Tip</Text><Text style={[co.tipSummaryValue, { color: tipAmount > 0 ? "#22C55E" : colors.muted }]}>{tipAmount > 0 ? `+$${tipAmount.toFixed(2)}` : "—"}</Text></View>
          <View style={[co.tipDivider, { backgroundColor: colors.border }]} />
          <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.foreground, fontWeight: "700", fontSize: 16 }]}>Total</Text><Text style={[co.tipSummaryValue, { color: colors.primary, fontWeight: "800", fontSize: 20 }]}>${total.toFixed(2)}</Text></View>
        </View>
        <Text style={[co.sectionLabel, { color: colors.muted, marginTop: 4 }]}>SELECT TIP AMOUNT</Text>
        <View style={co.tipPresetRow}>
          {TIP_PRESETS.map((p) => { const sel = selectedTipPct === p.pct; const amt = Math.round(subtotal * p.pct * 100) / 100; return (
            <TouchableOpacity key={p.label} onPress={() => { setSelectedTipPct(p.pct); setCustomTipStr(""); }} style={[co.tipPresetBtn, { backgroundColor: sel ? colors.primary : colors.surface, borderColor: sel ? colors.primary : colors.border }]} activeOpacity={0.75}>
              <Text style={[co.tipPresetPct, { color: sel ? "#fff" : colors.foreground }]}>{p.label}</Text>
              <Text style={[co.tipPresetAmt, { color: sel ? "rgba(255,255,255,0.8)" : colors.muted }]}>${amt.toFixed(2)}</Text>
            </TouchableOpacity>
          ); })}
        </View>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <TouchableOpacity onPress={() => { setSelectedTipPct(null); setCustomTipStr(""); }} style={[co.tipAltBtn, { backgroundColor: selectedTipPct === null ? colors.surface : colors.background, borderColor: selectedTipPct === null ? colors.foreground : colors.border }]} activeOpacity={0.75}><Text style={[{ fontWeight: "600", fontSize: 14 }, { color: selectedTipPct === null ? colors.foreground : colors.muted }]}>No Tip</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setSelectedTipPct(-1)} style={[co.tipAltBtn, { flex: 2, backgroundColor: isCustom ? colors.surface : colors.background, borderColor: isCustom ? colors.foreground : colors.border }]} activeOpacity={0.75}><Text style={[{ fontWeight: "600", fontSize: 14 }, { color: isCustom ? colors.foreground : colors.muted }]}>Custom</Text></TouchableOpacity>
        </View>
        {isCustom && (
          <View style={{ marginTop: 12 }}>
            <Text style={[co.inputLabel, { color: colors.muted }]}>Custom Tip Amount ($)</Text>
            <TextInput value={customTipStr} onChangeText={(t) => setCustomTipStr(t.replace(/[^0-9.]/g, ""))} placeholder="0.00" placeholderTextColor={colors.muted} keyboardType="decimal-pad" autoFocus style={[co.cardInput, { color: colors.foreground, borderColor: colors.primary, backgroundColor: colors.background, fontSize: 20, textAlign: "center" }]} />
          </View>
        )}
        <TouchableOpacity onPress={() => { if (isCardOnFile) { setStep("card_on_file_confirm"); } else if (method === "apple_pay") { setStep("apple_pay"); } else { setStep("signature"); } }} style={[co.primaryBtn, { backgroundColor: colors.primary, marginTop: 20 }]} activeOpacity={0.8}><Text style={co.primaryBtnText}>{isCardOnFile ? `Confirm Charge  ·  $${total.toFixed(2)} →` : method === "apple_pay" ? `Pay with Apple Pay  ·  $${total.toFixed(2)} →` : tipAmount > 0 ? `Continue  ·  Total $${total.toFixed(2)} →` : "Continue to Signature →"}</Text></TouchableOpacity>
      </View>
    );
  };

  const renderCardOnFileConfirm = () => (
    <View>
      <TouchableOpacity onPress={() => setStep("card_on_file")} style={co.backBtn}><Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text></TouchableOpacity>
      <Text style={[co.sheetTitle, { color: colors.foreground }]}>Confirm Charge</Text>
      <Text style={[co.sheetSubtitle, { color: colors.muted }]}>{job.firstName} {job.lastName}</Text>
      {savedCard && (
        <View style={[co.cardBox, { backgroundColor: "#059669" + "12", borderColor: "#059669" + "40", marginBottom: 16 }]}>
          <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 16 }}>
            {savedCard.cardBrand ? savedCard.cardBrand.charAt(0).toUpperCase() + savedCard.cardBrand.slice(1) : "Card"} •••• {savedCard.cardLast4}
          </Text>
          {savedCard.cardExpMonth && savedCard.cardExpYear && (
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>Expires {savedCard.cardExpMonth}/{savedCard.cardExpYear}</Text>
          )}
        </View>
      )}
      <View style={[co.receiptBox, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 8 }]}>
        <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.muted }]}>Service Total</Text><Text style={[co.tipSummaryValue, { color: colors.foreground }]}>${subtotal.toFixed(2)}</Text></View>
        <View style={[co.tipDivider, { backgroundColor: colors.border }]} />
        <View style={co.tipSummaryRow}><Text style={[{ fontWeight: "700", fontSize: 15 }, { color: colors.foreground }]}>Total to Charge</Text><Text style={[{ fontWeight: "800", fontSize: 18 }, { color: colors.primary }]}>${subtotal.toFixed(2)}</Text></View>
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center", marginBottom: 16 }}>A "Leave a Tip" email will be sent to the customer after charging.</Text>
      <TouchableOpacity
        onPress={async () => {
          if (!savedCard) return;
          setIsProcessing(true);
          try {
            const result = await chargeCardOnFileMutation.mutateAsync({
              stripeCustomerId: savedCard.stripeCustomerId,
              stripePaymentMethodId: savedCard.stripePaymentMethodId,
              amountCents: Math.round(subtotal * 100),
              description: `${job.firstName} ${job.lastName} - ${job.serviceTitle}`,
            });
            if (Platform.OS !== "web") await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setPaymentResult({ success: true, message: "Card charged successfully", paymentIntentId: result.paymentIntentId });
            setStep("result");
            onComplete({ method: "credit_debit", subtotal, tipAmount: 0, total: subtotal, paidAt: new Date().toISOString(), cardLast4: savedCard.cardLast4 ?? undefined, paymentIntentId: result.paymentIntentId });
            // Send tip email if customer has an email on file
            if (job.email) {
              generateTipLinkMutation.mutate({
                jobId: job.id,
                customerName: `${job.firstName} ${job.lastName}`.trim(),
                customerEmail: job.email,
                detailerName: job.detailerName ?? "",
                serviceTitle: job.serviceTitle ?? "",
                serviceTotal: subtotal,
                stripeCustomerId: savedCard.stripeCustomerId,
                stripePaymentMethodId: savedCard.stripePaymentMethodId,
                cardLast4: savedCard.cardLast4 ?? undefined,
                cardBrand: savedCard.cardBrand ?? undefined,
              });
            }
          } catch (e: unknown) {
            if (Platform.OS !== "web") await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            const msg = e instanceof Error ? e.message : "Card charge failed. Please try another method.";
            setPaymentResult({ success: false, message: msg });
            setStep("result");
          } finally { setIsProcessing(false); }
        }}
        disabled={isProcessing}
        style={[co.primaryBtn, { backgroundColor: "#059669", marginTop: 8 }]}
        activeOpacity={0.8}
      >
        {isProcessing
          ? <ActivityIndicator color="#fff" size="small" />
          : <Text style={co.primaryBtnText}>✓ Charge ${total.toFixed(2)}</Text>
        }
      </TouchableOpacity>
    </View>
  );

  const renderSignature = () => (
    <View>
      <TouchableOpacity onPress={() => setStep(method === "credit_debit" ? "tip" : method === "check" || method === "other" ? "reference" : "method")} style={co.backBtn}><Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text></TouchableOpacity>
      <Text style={[co.sheetTitle, { color: colors.foreground }]}>Customer Signature</Text>
      <View style={[co.receiptBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.muted }]}>{PAYMENT_METHOD_ICONS[method!]} {PAYMENT_METHOD_LABELS[method!]}{method === "credit_debit" && cardNumber ? ` ···· ${cardNumber.replace(/\s/g, "").slice(-4)}` : ""}</Text><Text style={[co.tipSummaryLabel, { color: colors.muted }]}>${subtotal.toFixed(2)}</Text></View>
        {tipAmount > 0 && <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.muted }]}>Tip</Text><Text style={[co.tipSummaryLabel, { color: "#22C55E" }]}>+${tipAmount.toFixed(2)}</Text></View>}
        <View style={[co.tipDivider, { backgroundColor: colors.border }]} />
        <View style={co.tipSummaryRow}><Text style={[{ fontWeight: "700", fontSize: 15 }, { color: colors.foreground }]}>Total Charged</Text><Text style={[{ fontWeight: "800", fontSize: 18 }, { color: colors.primary }]}>${total.toFixed(2)}</Text></View>
      </View>
      <Text style={[co.sigInstructions, { color: colors.foreground, marginTop: 14 }]}>Sign below to authorize payment:</Text>
      <View style={[co.sigBox, { borderColor: hasSignature ? colors.primary : colors.border }]}>
        <SignatureCanvas ref={sigRef} onDraw={() => setHasSignature(true)} onClear={() => setHasSignature(false)} onDrawStart={() => setScrollLocked(true)} onDrawEnd={() => setScrollLocked(false)} />
        {!hasSignature && <View style={co.sigPlaceholder} pointerEvents="none"><Text style={{ color: "#aaa", fontSize: 14 }}>Sign here</Text></View>}
      </View>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
        <TouchableOpacity onPress={() => { sigRef.current?.clearSignature(); setHasSignature(false); }} style={[co.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.surface }]} activeOpacity={0.75}><Text style={{ color: colors.foreground, fontWeight: "600" }}>Clear</Text></TouchableOpacity>
        <TouchableOpacity onPress={handleConfirm} disabled={!hasSignature || isProcessing} style={[co.primaryBtn, { flex: 2, backgroundColor: "#22C55E", opacity: hasSignature && !isProcessing ? 1 : 0.4 }]} activeOpacity={0.8}>
          {isProcessing ? <ActivityIndicator color="#fff" /> : <Text style={co.primaryBtnText}>✓ Confirm Payment</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderResult = () => {
    const success = paymentResult?.success ?? false;
    const iconColor = success ? "#22C55E" : colors.error;
    const title = success ? "Payment Approved" : "Payment Declined";
    const subtitle = paymentResult?.message ?? "";
    return (
      <View style={{ alignItems: "center", paddingVertical: 32 }}>
        {/* Large prominent icon */}
        <View style={[
          co.resultIconCircle,
          { backgroundColor: iconColor + "22", borderColor: iconColor, width: 100, height: 100, borderRadius: 50, borderWidth: 3 }
        ]}>
          <Text style={{ fontSize: 52, color: iconColor, fontWeight: "800" }}>{success ? "✓" : "✕"}</Text>
        </View>
        <Text style={[co.resultTitle, { color: colors.foreground, marginTop: 20, fontSize: 26, fontWeight: "800" }]}>{title}</Text>
        {success && (
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6, gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#22C55E" }} />
            <Text style={{ color: "#22C55E", fontSize: 14, fontWeight: "700" }}>Card charged successfully</Text>
          </View>
        )}
        <Text style={[co.resultSubtitle, { color: colors.muted, marginTop: 6 }]}>{subtitle}</Text>
        {success && (
          <View style={[co.receiptBox, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 20, width: "100%" }]}>
            <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.muted }]}>Service</Text><Text style={[co.tipSummaryValue, { color: colors.foreground }]}>${subtotal.toFixed(2)}</Text></View>
            {tipAmount > 0 && <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.muted }]}>Tip</Text><Text style={[co.tipSummaryValue, { color: "#22C55E" }]}>+${tipAmount.toFixed(2)}</Text></View>}
            <View style={[co.tipDivider, { backgroundColor: colors.border }]} />
            <View style={co.tipSummaryRow}>
              <Text style={[{ fontWeight: "700", fontSize: 16 }, { color: colors.foreground }]}>Total Charged</Text>
              <Text style={[{ fontWeight: "900", fontSize: 22 }, { color: "#22C55E" }]}>${total.toFixed(2)}</Text>
            </View>
            <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.muted }]}>Method</Text><Text style={[co.tipSummaryValue, { color: colors.foreground }]}>{PAYMENT_METHOD_ICONS[method!]} {PAYMENT_METHOD_LABELS[method!]}</Text></View>
          </View>
        )}
        <TouchableOpacity
          onPress={success ? onClose : () => { setStep("method"); setPaymentResult(null); paymentInFlightRef.current = false; }}
          style={[co.primaryBtn, { backgroundColor: success ? "#22C55E" : colors.primary, marginTop: 24, width: "100%", height: 56 }]}
          activeOpacity={0.8}
        >
          <Text style={[co.primaryBtnText, { fontSize: 17 }]}>{success ? "✓ Done" : "Try Again"}</Text>
        </TouchableOpacity>
        {!success && (
          <TouchableOpacity onPress={() => { setStep("method"); setPaymentResult(null); paymentInFlightRef.current = false; }} style={{ marginTop: 12, paddingVertical: 10 }}>
            <Text style={{ color: colors.muted, fontSize: 14 }}>Choose a different payment method</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={co.overlay}>
          <View style={[co.sheet, { backgroundColor: colors.surface }]}>
            {step !== "result" && !isProcessing && <TouchableOpacity onPress={onClose} style={co.closeBtn}><Text style={{ color: colors.muted, fontSize: 22 }}>✕</Text></TouchableOpacity>}
            {/* Processing overlay — blocks all taps while payment is in-flight */}
            {isProcessing && (
              <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center", gap: 16 }}>
                <ActivityIndicator size="large" color="#22C55E" />
                <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>Processing Payment...</Text>
                <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 13, textAlign: "center", paddingHorizontal: 32 }}>Please wait. Do not tap again.</Text>
              </View>
            )}
            {/* Signature step: rendered outside ScrollView so the canvas never scrolls while drawing */}
            {step === "signature" ? (
              <View style={{ paddingBottom: 24 }}>{renderSignature()}</View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
                {step === "method" && renderMethod()}
                {step === "card_entry" && renderCard()}
                {step === "card_on_file" && renderCardOnFile()}
                {step === "apple_pay" && renderApplePay()}
                {step === "tap_to_pay" && renderTapToPay()}
                {step === "reference" && renderReference()}
                {step === "tip" && renderTip()}
                {step === "card_on_file_confirm" && renderCardOnFileConfirm()}
                {step === "result" && renderResult()}
              </ScrollView>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const co = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 48, maxHeight: "94%" },
  closeBtn: { position: "absolute", top: 18, right: 20, zIndex: 10, padding: 4 },
  backBtn: { marginBottom: 8, paddingVertical: 4 },
  sheetTitle: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  sheetSubtitle: { fontSize: 14, marginBottom: 20 },
  sectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 12 },
  totalBox: { borderRadius: 14, borderWidth: 1, padding: 16, alignItems: "center", marginBottom: 24 },
  totalLabel: { fontSize: 13, fontWeight: "500", marginBottom: 4 },
  totalAmount: { fontSize: 36, fontWeight: "800" },
  methodRow: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 10, gap: 14 },
  methodIcon: { fontSize: 24, width: 36, textAlign: "center" },
  methodLabel: { flex: 1, fontSize: 16, fontWeight: "600" },
  cardBox: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 20 },
  inputLabel: { fontSize: 12, fontWeight: "600", marginBottom: 6, letterSpacing: 0.5 },
  cardInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 12 },
  demoNotice: { borderRadius: 8, borderWidth: 1, padding: 10, alignItems: "center", marginTop: 4 },
  primaryBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  secondaryBtn: { flex: 1, borderRadius: 14, borderWidth: 1, paddingVertical: 15, alignItems: "center", justifyContent: "center" },
  tipSummaryBox: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 20 },
  tipSummaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: 3 },
  tipSummaryLabel: { fontSize: 14 },
  tipSummaryValue: { fontSize: 15, fontWeight: "600" },
  tipDivider: { height: 1, marginVertical: 8 },
  tipPresetRow: { flexDirection: "row", gap: 10, marginBottom: 0 },
  tipPresetBtn: { flex: 1, borderRadius: 14, borderWidth: 1.5, paddingVertical: 14, alignItems: "center" },
  tipPresetPct: { fontSize: 17, fontWeight: "700" },
  tipPresetAmt: { fontSize: 12, marginTop: 2 },
  tipAltBtn: { flex: 1, borderRadius: 14, borderWidth: 1.5, paddingVertical: 14, alignItems: "center" },
  receiptBox: { borderRadius: 14, borderWidth: 1, padding: 14 },
  sigInstructions: { fontSize: 14, fontWeight: "500", marginBottom: 12 },
  sigBox: { height: 200, borderRadius: 14, borderWidth: 2, overflow: "hidden", position: "relative", backgroundColor: "#fff" },
  sigPlaceholder: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "center" },
  resultIconCircle: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  resultTitle: { fontSize: 26, fontWeight: "800", textAlign: "center" },
  resultSubtitle: { fontSize: 15, textAlign: "center", paddingHorizontal: 16 },
});

// ─── Job Block (draggable) ────────────────────────────────────────────────────

function JobBlock({
  job,
  top,
  height,
  left,
  width,
  onPress,
  onMove,
  slotHeight,
  hours,
  canDrag = true,
}: {
  job: Job;
  top: number;
  height: number;
  left: number;
  width: number;
  onPress: () => void;
  onMove: (newStartHour: number) => void;
  slotHeight: number;
  hours: number[];
  canDrag?: boolean;
}) {
  // Live tick for timer badge on card
  const [cardTick, setCardTick] = useState(0);
  useEffect(() => {
    const active = (job.status === "on_my_way" || job.status === "arrived") && !job.jobFinishedAt;
    if (!active) return;
    const id = setInterval(() => setCardTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [job.status, job.id]);

  const liveTimerLabel = (() => {
    if (job.status === "on_my_way" && job.travelStartedAt) return `🚚 ${formatElapsed(job.travelStartedAt)}`;
    if (job.status === "arrived" && job.jobStartedAt) return `⏱ ${formatElapsed(job.jobStartedAt)}`;
    return null;
  })();

  // Use simple TouchableOpacity for tap — GestureDetector Exclusive(pan, tap)
  // was blocking taps on native because activateAfterLongPress(500) on pan
  // holds the gesture system in "began" state, preventing the tap from firing.
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={{
        position: "absolute",
        top,
        left,
        width,
        height,
        zIndex: 10,
        backgroundColor: STATUS_COLOR[job.status],
        borderRadius: 8,
        padding: 6,
        overflow: "hidden",
        borderWidth: (job.status === "finished" && !job.payment && (job.price ?? 0) > 0) ? 2.5 : 1,
        borderColor: (job.status === "finished" && !job.payment && (job.price ?? 0) > 0) ? "#EF4444" : "rgba(255,255,255,0.45)",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Text style={jb.name} numberOfLines={1}>{job.firstName} {job.lastName}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {job.isNewCustomer && (
            <View style={{ backgroundColor: "#F59E0B", borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
              <Text style={{ color: "#fff", fontSize: 8, fontWeight: "800" }}>NEW</Text>
            </View>
          )}
          {job.payment && <Text style={jb.paid}>✓</Text>}
        </View>
      </View>
      <Text style={jb.service} numberOfLines={1}>{job.serviceTitle}</Text>
      {height >= 48 && <Text style={jb.time}>{formatHour(job.startHour)} – {formatHour(job.endHour)}</Text>}
      {height >= 64 && <Text style={jb.price}>${Math.max(0, (job.price ?? 0) + (job.upsellTotal ?? 0) - (job.discountAmount ?? 0)).toFixed(2)}</Text>}
      {height >= 80 && job.address ? <Text style={jb.address} numberOfLines={1}>{job.address}</Text> : null}
      {liveTimerLabel && cardTick >= 0 && (
        <Text style={{ color: "rgba(255,255,255,0.95)", fontSize: 10, fontWeight: "700", marginTop: 2, fontVariant: ["tabular-nums"] }}>{liveTimerLabel}</Text>
      )}
    </TouchableOpacity>
  );
}

const jb = StyleSheet.create({
  name: { color: "#fff", fontSize: 12, fontWeight: "700", flex: 1 },
  paid: { color: "#fff", fontSize: 11, fontWeight: "700" },
  service: { color: "rgba(255,255,255,0.85)", fontSize: 11 },
  time: { color: "rgba(255,255,255,0.75)", fontSize: 10, marginTop: 2 },
  price: { color: "rgba(255,255,255,0.75)", fontSize: 10 },
  address: { color: "rgba(255,255,255,0.65)", fontSize: 9, marginTop: 1 },
});

// ─── Admin Dispatch Board ────────────────────────────────────────────────────
// Multi-column view: one column per detailer at the selected location.
// Falls back to a single full-width column when only one detailer is present.
// Job cards use plain TouchableOpacity — no gesture competition, guaranteed tappable.

const DETAILER_COLORS = [
  "#3B82F6", // blue
  "#8B5CF6", // purple
  "#10B981", // green
  "#F59E0B", // amber
  "#EF4444", // red
  "#EC4899", // pink
  "#06B6D4", // cyan
  "#F97316", // orange
];

function AdminDispatchBoard({
  jobs,
  weekOffset,
  dayIndex,
  detailers,
  onJobPress,
  onCreateJob,
  onSwipeLeft,
  onSwipeRight,
}: {
  jobs: Job[];
  weekOffset: number;
  dayIndex: number;
  detailers: { employeeId: string; fullName: string }[];
  onJobPress: (job: Job) => void;
  onCreateJob: (startHour: number, endHour: number, detailerId?: string) => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}) {
  const colors = useColors();
  const screenWidth = Dimensions.get("window").width;
  const gridHeight = HOURS.length * SLOT_HEIGHT;

  // Filter jobs for this day
  const dayJobs = jobs.filter((j) => j.dayIndex === dayIndex && j.weekOffset === weekOffset);

  // Only real members passed from the active Company receive schedule columns.
  const columns = detailers;
  const numCols = columns.length;

  // Column width: fill screen if 1 col, else fixed 200px so user can scroll horizontally
  const singleCol = numCols === 1;
  const colWidth = singleCol ? screenWidth - TIME_COL_WIDTH : 200;

  // Swipe detector (PanResponder) for day navigation — only fires on clear horizontal swipes
  const { PanResponder: PR } = require("react-native");
  const swipePanResponder = React.useMemo(() =>
    PR.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_: any, gs: any) => Math.abs(gs.dx) > 20 && Math.abs(gs.dy) < 15,
      onPanResponderRelease: (_: any, gs: any) => {
        if (Math.abs(gs.dx) > 50 && Math.abs(gs.dy) < 30) {
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          if (gs.dx > 0 && onSwipeRight) onSwipeRight();
          else if (gs.dx < 0 && onSwipeLeft) onSwipeLeft();
        }
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  , [onSwipeLeft, onSwipeRight]);

  // Get jobs for a specific detailer column
  const getColJobs = (detailerId: string, colIndex: number) => {
    return dayJobs.filter((j) => {
      if (!j.detailerName) return colIndex === 0; // unassigned jobs show in first column only
      // Match by employeeId (new) or by name string (legacy)
      if (j.detailerName === detailerId) return true;
      const det = columns.find((c) => c.employeeId === detailerId);
      if (det) {
        const dn = j.detailerName.toLowerCase();
        const fn = det.fullName.toLowerCase();
        if (dn === fn || fn.startsWith(dn) || dn === fn.split(" ")[0]) return true;
      }
      return false;
    });
  };

  if (detailers.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
        <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "800", textAlign: "center" }}>No team members yet</Text>
        <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, textAlign: "center" }}>
          Add a team member to this Company before assigning work on the calendar.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }} {...swipePanResponder.panHandlers}>
      {/* Column headers row */}
      <View style={{ flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        {/* Time column spacer */}
        <View style={{ width: TIME_COL_WIDTH }} />
        {/* Detailer name headers */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={!singleCol} style={{ flex: 1 }}>
          <View style={{ flexDirection: "row" }}>
            {columns.map((det, idx) => (
              <View
                key={det.employeeId}
                style={{
                  width: colWidth,
                  paddingVertical: 8,
                  paddingHorizontal: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  borderLeftWidth: idx > 0 ? StyleSheet.hairlineWidth : 0,
                  borderLeftColor: colors.border,
                }}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: DETAILER_COLORS[idx % DETAILER_COLORS.length] }} />
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                  {det.fullName.split(" ")[0]}
                </Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginLeft: "auto" }}>
                  {getColJobs(det.employeeId, idx).length} job{getColJobs(det.employeeId, idx).length !== 1 ? "s" : ""}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Timeline grid — time column fixed, detailer columns scroll horizontally together */}
      <ScrollView
        style={{ flex: 1 }}
        contentOffset={{ x: 0, y: companyScheduleInitialOffset(SLOT_HEIGHT) }}
        contentContainerStyle={{ paddingBottom: 40 }}
        nestedScrollEnabled
      >
        <View style={{ flexDirection: "row" }}>
          {/* Fixed time column */}
          <View style={{ width: TIME_COL_WIDTH }}>
            {HOURS.map((hour, idx) => (
              <View
                key={hour}
                style={{
                  height: SLOT_HEIGHT,
                  justifyContent: "flex-start",
                  paddingTop: 4,
                  paddingRight: 8,
                  alignItems: "flex-end",
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "500", color: colors.muted }}>{formatHour(hour)}</Text>
              </View>
            ))}
          </View>

          {/* Horizontally scrollable detailer columns */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEnabled={!singleCol}
            style={{ flex: 1 }}
          >
            <View style={{ flexDirection: "row" }}>
              {columns.map((det, colIdx) => {
                const colJobs = getColJobs(det.employeeId, colIdx);
                const colColor = DETAILER_COLORS[colIdx % DETAILER_COLORS.length];
                // Build occupied hour set for this column
                const occupied = new Set<number>();
                for (const job of colJobs) {
                  const si = hourToSlotIndex(job.startHour);
                  const ei = hourToSlotIndex(job.endHour);
                  for (let h = si; h < Math.max(si + 1, ei); h++) occupied.add(h);
                }
                return (
                  <View
                    key={det.employeeId}
                    style={{
                      width: colWidth,
                      position: "relative",
                      borderLeftWidth: colIdx > 0 ? StyleSheet.hairlineWidth : StyleSheet.hairlineWidth,
                      borderLeftColor: colors.border,
                    }}
                  >
                    {/* Hour slot rows */}
                    {HOURS.map((hour, idx) => (
                      <TouchableOpacity
                        key={hour}
                        style={{
                          height: SLOT_HEIGHT,
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: colors.border,
                          backgroundColor: occupied.has(idx) ? "transparent" : "transparent",
                        }}
                        activeOpacity={0.5}
                        delayLongPress={500}
                        onLongPress={() => {
                          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          const endHour = HOURS[Math.min(idx + 2, HOURS.length - 1)];
                          onCreateJob(hour, endHour, det.employeeId);
                        }}
                      />
                    ))}

                    {/* Job cards — absolutely positioned, guaranteed tappable */}
                    {colJobs.map((job) => {
                      const startIdx = hourToSlotIndex(job.startHour);
                      const endIdx = hourToSlotIndex(job.endHour);
                      const top = startIdx * SLOT_HEIGHT + 2;
                      const height = Math.max(
                        SLOT_HEIGHT - 4,
                        (Math.max(startIdx + 1, endIdx) - startIdx) * SLOT_HEIGHT - 4
                      );
                      return (
                        <TouchableOpacity
                          key={job.id}
                          activeOpacity={0.75}
                          onPress={() => onJobPress(job)}
                          style={{
                            position: "absolute",
                            top,
                            left: 3,
                            right: 3,
                            height,
                            zIndex: 10,
                            backgroundColor: STATUS_COLOR[job.status],
                            borderRadius: 8,
                            padding: 6,
                            overflow: "hidden",
                            borderWidth: (job.status === "finished" && !job.payment) ? 2.5 : 1,
                            borderColor: (job.status === "finished" && !job.payment) ? "#EF4444" : "rgba(255,255,255,0.35)",
                            shadowColor: "#000",
                            shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: 0.12,
                            shadowRadius: 4,
                            elevation: 3,
                          }}
                        >
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700", flex: 1 }} numberOfLines={1}>
                              {job.firstName} {job.lastName}
                            </Text>
                            {job.payment && <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>✓</Text>}
                          </View>
                          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 11 }} numberOfLines={1}>{job.serviceTitle}</Text>
                          {height >= 48 && (
                            <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 10, marginTop: 2 }}>
                              {formatHour(job.startHour)} – {formatHour(job.endHour)}
                            </Text>
                          )}
                          {height >= 64 && (
                            <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 10 }}>${((job.price ?? 0) + (job.upsellTotal ?? 0)).toFixed(2)}</Text>
                          )}
                          {/* Edit button — always visible at bottom-right of card */}
                          <TouchableOpacity
                            onPress={() => onJobPress(job)}
                            style={{
                              position: "absolute",
                              bottom: 4,
                              right: 4,
                              backgroundColor: "rgba(255,255,255,0.22)",
                              borderRadius: 6,
                              paddingHorizontal: 7,
                              paddingVertical: 3,
                              borderWidth: 1,
                              borderColor: "rgba(255,255,255,0.35)",
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>Edit</Text>
                          </TouchableOpacity>
                          {/* Colored left accent bar per detailer */}
                          <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: colColor, borderTopLeftRadius: 8, borderBottomLeftRadius: 8 }} />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Day Timeline ─────────────────────────────────────────────────────────────

function DayTimeline({
  jobs,
  weekOffset,
  dayIndex,
  onCreateJob,
  onMoveJob,
  onJobPress,
  onSwipeLeft,
  onSwipeRight,
  canDrag = true,
  onRefresh,
  refreshing = false,
}: {
  jobs: Job[];
  weekOffset: number;
  dayIndex: number;
  onCreateJob: (startHour: number, endHour: number) => void;
  onMoveJob: (jobId: string, newStartHour: number) => void;
  onJobPress: (job: Job) => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  canDrag?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const colors = useColors();
  const screenWidth = Dimensions.get("window").width;
  const contentWidth = screenWidth - TIME_COL_WIDTH;

  const scrollOffsetY = useSharedValue(0);

  const dayJobs = jobs.filter((j) => j.dayIndex === dayIndex && j.weekOffset === weekOffset);

  const commitCreate = useCallback((startHour: number, endHour: number) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onCreateJob(startHour, endHour);
  }, [onCreateJob]);

  const commitMove = useCallback((jobId: string, newStartHour: number) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onMoveJob(jobId, newStartHour);
  }, [onMoveJob]);

  // Ghost overlay removed — job creation now uses TouchableOpacity onLongPress on empty slots

  // Total grid height for absolute positioning
  const gridHeight = HOURS.length * SLOT_HEIGHT;

  // Build a set of occupied hour indices for quick lookup
  const occupiedHours = new Set<number>();
  for (const job of dayJobs) {
    const si = hourToSlotIndex(job.startHour);
    const ei = hourToSlotIndex(job.endHour);
    for (let h = si; h < Math.max(si + 1, ei); h++) occupiedHours.add(h);
  }

  // ── Swipe detector for changing days ──
  // Use PanResponder instead of horizontal paging ScrollView to avoid blocking taps on job cards.
  // Only activates on clear horizontal swipes (dx > 50, dy < 30).
  const { PanResponder: PR } = require("react-native");
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);

  const swipePanResponder = React.useMemo(() =>
    PR.create({
      onStartShouldSetPanResponder: () => false, // don't capture on touch start
      onMoveShouldSetPanResponder: (_: any, gestureState: any) => {
        // Only capture if it's a clear horizontal swipe (dx > 20, dy < 15)
        const dx = Math.abs(gestureState.dx);
        const dy = Math.abs(gestureState.dy);
        return dx > 20 && dy < 15;
      },
      onPanResponderGrant: (e: any) => {
        swipeStartX.current = e.nativeEvent.pageX;
        swipeStartY.current = e.nativeEvent.pageY;
      },
      onPanResponderRelease: (e: any, gestureState: any) => {
        const dx = gestureState.dx;
        const dy = Math.abs(gestureState.dy);
        // Require dx > 50 and dy < 30 for a valid swipe
        if (Math.abs(dx) > 50 && dy < 30) {
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          if (dx > 0 && onSwipeRight) {
            onSwipeRight(); // swiped right = previous day
          } else if (dx < 0 && onSwipeLeft) {
            onSwipeLeft(); // swiped left = next day
          }
        }
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  , [onSwipeLeft, onSwipeRight]);

  // Render the timeline grid content
  const renderTimelineContent = () => (
    <ScrollView
      style={{ flex: 1 }}
      contentOffset={{ x: 0, y: companyScheduleInitialOffset(SLOT_HEIGHT) }}
      onScroll={(e) => { scrollOffsetY.value = e.nativeEvent.contentOffset.y; }}
      scrollEventThrottle={16}
      contentContainerStyle={{ paddingBottom: 40 }}
      nestedScrollEnabled
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        ) : undefined
      }
    >
      <View
        style={{ position: "relative", height: gridHeight }}
      >
        {/* Hour grid lines with tappable empty slots for creating jobs */}
        {HOURS.map((hour, idx) => {
          const isOccupied = occupiedHours.has(idx);
          return (
            <View key={hour} style={[tl.row, { borderBottomColor: colors.border, height: SLOT_HEIGHT, position: "absolute", top: idx * SLOT_HEIGHT, left: 0, right: 0, flexDirection: "row" }]}>
              <View style={[tl.timeCell, { width: TIME_COL_WIDTH }]}>
                <Text style={[tl.timeText, { color: colors.muted }]} numberOfLines={1}>{formatHour(hour)}</Text>
              </View>
              {!isOccupied ? (
                <TouchableOpacity
                  style={[tl.contentCell, { borderLeftColor: colors.border, width: contentWidth }]}
                  activeOpacity={0.6}
                  delayLongPress={500}
                  onLongPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    const endHour = HOURS[Math.min(idx + 2, HOURS.length - 1)];
                    commitCreate(hour, endHour);
                  }}
                />
              ) : (
                <View style={[tl.contentCell, { borderLeftColor: colors.border, width: contentWidth }]} />
              )}
            </View>
          );
        })}

        {/* Job cards — receive taps directly (no background gesture layer blocking them) */}
        {dayJobs.map((job) => {
          const startIdx = hourToSlotIndex(job.startHour);
          const endIdx = hourToSlotIndex(job.endHour);
          const top = startIdx * SLOT_HEIGHT + 2;
          const height = Math.max(SLOT_HEIGHT - 4, (Math.max(startIdx + 1, endIdx) - startIdx) * SLOT_HEIGHT - 4);

          return (
            <JobBlock
              key={job.id}
              job={job}
              top={top}
              height={height}
              left={TIME_COL_WIDTH + 4}
              width={contentWidth - 8}
              onPress={() => onJobPress(job)}
              onMove={(newStartHour) => commitMove(job.id, newStartHour)}
              slotHeight={SLOT_HEIGHT}
              hours={HOURS}
              canDrag={canDrag}
            />
          );
        })}


      </View>
    </ScrollView>
  );

  return (
    <View style={{ flex: 1 }} {...swipePanResponder.panHandlers}>
      {renderTimelineContent()}
    </View>
  );
}

const tl = StyleSheet.create({
  row: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  timeCell: { justifyContent: "flex-start", paddingTop: 4, paddingRight: 8, alignItems: "flex-end" },
  timeText: { fontSize: 11, fontWeight: "500" },
  contentCell: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth },
});

// ─── Private Notes Card Component ───────────────────────────────────────────

function PrivateNotesCard({
  job,
  currentEmployeeId,
  currentEmployeeName,
  currentRole,
  onNotesChange,
}: {
  job: Job;
  currentEmployeeId: string;
  currentEmployeeName: string;
  currentRole: string;
  onNotesChange: (notes: PrivateNote[]) => void;
}) {
  const colors = useColors();
  const { session: jobSyncSession } = useJobSyncAuth();
  const [newNoteText, setNewNoteText] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);

  const notes: PrivateNote[] = job.privateNotes ?? [];
  const isAdmin = ["admin", "office", "operations_manager"].includes(currentRole);

  // Private-note mutations still target the legacy local endpoint. Keep them
  // unavailable to Company sessions until the HSC notes contract is published.
  if (jobSyncSession?.portal === "company") return null;

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
      const updated = notes.map((n) => n.id === noteId ? { ...n, text, updatedAt: new Date().toISOString() } : n);
      onNotesChange(updated);
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
    <View style={[s.detailCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <Text style={{ fontSize: 16 }}>📄</Text>
        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>Private Notes</Text>
        <View style={{ backgroundColor: colors.surface, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "600" }}>INTERNAL</Text>
        </View>
      </View>

      {notes.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 12 }}>No notes yet. Be the first to add one.</Text>
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
                    <Text style={{ color: colors.muted, fontSize: 11 }}>{new Date(note.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}{note.updatedAt !== note.createdAt ? " (edited)" : ""}</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {canEdit && !isEditing && (
                      <TouchableOpacity onPress={() => { setEditingNoteId(note.id); setEditText(note.text); }} activeOpacity={0.7}>
                        <Text style={{ color: colors.primary, fontSize: 12 }}>Edit</Text>
                      </TouchableOpacity>
                    )}
                    {canDelete && (
                      <TouchableOpacity onPress={() => deleteNote(note.id)} activeOpacity={0.7}>
                        <Text style={{ color: colors.error, fontSize: 12 }}>Delete</Text>
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

      {/* Add new note input */}
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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ScheduleScreen() {
  const colors = useColors();
  const { employee, loading: authLoading } = useEmployeeAuth();
  const { session: jobSyncSession, isLoading: jobSyncLoading } = useJobSyncAuth();
  const { revision: jobSyncRevision, refreshCompanyData, invalidateCanonicalSurfaces } = useJobSyncSync();
  const companyAuthority = resolveCompanyJobAuthority({ session: jobSyncSession, sessionLoading: jobSyncLoading });
  const isJobSyncCompany = usesCompanyJobAuthority(companyAuthority);
  const allowLegacyJobAuthority = allowsLegacyJobAuthority(companyAuthority);
  const companyPriceBook = useCompanyPriceBook();
  const { highlightJobId } = useLocalSearchParams<{ highlightJobId?: string }>();
  const highlightJobHandledRef = useRef<string | null>(null);
  const utils = trpc.useUtils();
  // Price book loaded early so syncServerJobs closure can reference it
  const { data: localPriceBookEarly } = trpc.pricebook.list.useQuery(undefined, { enabled: allowLegacyJobAuthority, staleTime: 60_000 });
  const _pbDataEarly = isJobSyncCompany ? companyPriceBook.services : localPriceBookEarly;
  const _schedPackages: PackageDef[] = _pbDataEarly && _pbDataEarly.length > 0
    ? _pbDataEarly.map((s) => {
        const vp = s.vehiclePrices as Record<string, number>;
        const isRv = s.serviceId.startsWith('pb_rv') ||
          ((vp.rv_20_29 ?? 0) > 0 || (vp.rv_30_39 ?? 0) > 0 || (vp.rv_40_plus ?? 0) > 0);
        return {
          id: s.serviceId,
          title: s.name,
          emoji: s.emoji,
          tagline: s.description || '',
          features: s.features,
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
    : isJobSyncCompany ? [] : PACKAGES;
  const performanceUpsertMutation = trpc.performance.upsert.useMutation();
  // Server-side job sync mutations
  const jobUpsertMutation = trpc.jobs.upsert.useMutation();
  const jobDeleteMutation = trpc.jobs.delete.useMutation();
  const jobStatusMutation = trpc.jobs.updateStatus.useMutation();
  const jobSavePaymentMutation = trpc.jobs.savePayment.useMutation({
    onError: (err) => {
      // Payment went through Stripe but the record failed to save — alert immediately
      Alert.alert(
        "⚠️ Payment Record Error",
        "The payment was collected but could not be saved to the server. Please screenshot this job and notify your admin immediately so it can be manually recorded.\n\nError: " + (err.message ?? "Unknown error"),
        [{ text: "OK" }]
      );
    },
  });
  const stampTimestampMutation = trpc.jobs.stampTimestamp.useMutation();
  const jobMetaMutation = trpc.jobs.updateMeta.useMutation();
  const portalBookingStatusMutation = trpc.customer.updatePortalBookingStatus.useMutation();
  const portalBookingPaymentMutation = trpc.customer.savePortalBookingPayment.useMutation();
  const lateArrivalMutation = trpc.phone.sendLateArrivalNotification.useMutation();
  const [showLateSheet, setShowLateSheet] = useState(false);
  const [lateSheetJob, setLateSheetJob] = useState<Job | null>(null);
  const [lateDelayMinutes, setLateDelayMinutes] = useState(30);
  const [lateCustomMinutes, setLateCustomMinutes] = useState('');
  const [lateNotifiedJobIds, setLateNotifiedJobIds] = useState<Set<string>>(new Set());
  const [navVisible, setNavVisible] = useState(false);
  const [navJob, setNavJob] = useState<Job | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(todayDayIndex());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [companyJobsError, setCompanyJobsError] = useState<string | null>(null);
  const [companyCalendarMembers, setCompanyCalendarMembers] = useState<JobSyncCompanyMember[]>([]);
  const [companyCalendarMembersLoading, setCompanyCalendarMembersLoading] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<LocationSlug>(() => {
    // Will be overridden by employee city in useEffect below
    return "crestview";
  });
  const [isSyncingBookings, setIsSyncingBookings] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isJobSyncCompany || !jobSyncSession?.token || !jobSyncSession.company?.id) {
      setCompanyCalendarMembers([]);
      setCompanyCalendarMembersLoading(false);
      return () => { cancelled = true; };
    }
    setCompanyCalendarMembersLoading(true);
    getJobSyncCompanyMembers(jobSyncSession.token, jobSyncSession.company.id)
      .then((roster) => {
        if (!cancelled) setCompanyCalendarMembers(roster.members);
      })
      .catch(() => {
        if (!cancelled) setCompanyCalendarMembers([]);
      })
      .finally(() => {
        if (!cancelled) setCompanyCalendarMembersLoading(false);
      });
    return () => { cancelled = true; };
  }, [isJobSyncCompany, jobSyncSession?.token, jobSyncSession?.company?.id, jobSyncRevision]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showServiceWizard, setShowServiceWizard] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const lateHistoryQ = trpc.phone.getLateArrivalHistory.useQuery(
    { jobId: selectedJob?.id },
    { enabled: !!selectedJob?.id, staleTime: 30000, refetchOnWindowFocus: false }
  );
  // ─── Reward Redemption (detailer view) ───────────────────────────────────────
  const pendingRedemptionsQ = trpc.referral.getPendingForCustomer.useQuery(
    { customerId: selectedJob?.customerId ?? "" },
    { enabled: !!selectedJob?.customerId, staleTime: 30000, refetchOnWindowFocus: false }
  );
  const fulfillRedemptionMutation = trpc.referral.fulfillRedemption.useMutation({
    onSuccess: () => {
      utils.referral.getPendingForCustomer.invalidate({ customerId: selectedJob?.customerId ?? "" });
    },
  });
  const [showCheckout, setShowCheckout] = useState(false);
  const checkoutJobRef = useRef<Job | null>(null); // keeps job data alive after detail modal closes
  const jobsRef = useRef<Job[]>([]); // always-current jobs for use in nav callbacks
  const [isRefunding, setIsRefunding] = useState(false);
  const refundPaymentMutation = trpc.stripe.refundPayment.useMutation();

  useEffect(() => {
    if (!allowLegacyJobAuthority) {
      setShowCheckout(false);
    }
  }, [allowLegacyJobAuthority]);

  // Upsell state
  const [showUpsellPanel, setShowUpsellPanel] = useState(false);
  const [upsellIds, setUpsellIds] = useState<string[]>([]);
  const [upsellQtys, setUpsellQtys] = useState<Record<string, number>>({});
  const [savingUpsells, setSavingUpsells] = useState(false);
  const [customUpsellName, setCustomUpsellName] = useState("");
  const [customUpsellPrice, setCustomUpsellPrice] = useState("");

  // Recommendations state
  const [showRecsPanel, setShowRecsPanel] = useState(false);
  const [pendingRecIds, setPendingRecIds] = useState<string[]>([]);
  const [savingRecs, setSavingRecs] = useState(false);

  // ─── Edit Services State ─────────────────────────────────────────────────────
  const [showEditServicesSheet, setShowEditServicesSheet] = useState(false);
  // editVehicles mirrors [primary, ...additionalVehicles] while the sheet is open
  const [editVehicles, setEditVehicles] = useState<AdditionalVehicle[]>([]);
  const [savingEditServices, setSavingEditServices] = useState(false);

  // ─── Location Sharing State ──────────────────────────────────────────────────
  const locationUpsertMutation = trpc.location.upsert.useMutation();
  const locationDeactivateMutation = trpc.location.deactivate.useMutation();
  const createTokenMutation = trpc.location.createToken.useMutation();
  const expireTokensMutation = trpc.location.expireTokens.useMutation();
  const [locationWatcher, setLocationWatcher] = useState<Location.LocationSubscription | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [trackingToken, setTrackingToken] = useState<string | null>(null);

  // ─── Messaging State ──────────────────────────────────────────────────────────
  const [showChatModal, setShowChatModal] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const chatFlatRef = useRef<FlatList>(null);
  const chatBookingRef = selectedJob?.bookingId ?? "";
  const chatIsPortalJob = !!(selectedJob?.bookingId && (
    selectedJob.bookingId.startsWith("bk_") ||
    selectedJob.bookingId.startsWith("portal_bk_")
  ));
  // Messaging window: on_my_way / on_the_way / en_route / arrived / started / in_progress
  const chatWindowStatus: string = selectedJob?.status ?? "";
  const chatWindowOpen = useMemo(() => {
    if (!chatIsPortalJob) return false;
    // Valid schedule_jobs statuses: pending | confirmed | in_progress | completed | cancelled
    return (
      chatWindowStatus === "confirmed" ||
      chatWindowStatus === "in_progress"
    );
  }, [chatIsPortalJob, chatWindowStatus]);

  const chatListQuery = trpc.messaging.list.useQuery(
    { bookingRef: chatBookingRef, limit: 100 },
    { enabled: showChatModal && !!chatBookingRef, refetchInterval: 30000 }
  );
  const chatMarkReadMutation = trpc.messaging.markRead.useMutation();
  const chatSendMutation = trpc.messaging.send.useMutation({
    onSuccess: () => {
      utils.messaging.list.invalidate({ bookingRef: chatBookingRef });
      utils.messaging.unreadCount.invalidate({ bookingRef: chatBookingRef, readerType: "detailer" });
    },
  });
  const chatUnreadQuery = trpc.messaging.unreadCount.useQuery(
    { bookingRef: chatBookingRef, readerType: "detailer" },
    { enabled: chatWindowOpen && !!chatBookingRef, refetchInterval: 30000 }
  );
  const chatUnreadCount = chatUnreadQuery.data?.count ?? 0;

  // ─── Camera Session State ─────────────────────────────────────────────────────
  const [showCameraSession, setShowCameraSession] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<"back" | "front">("back");
  const [cameraSessionPhotos, setCameraSessionPhotos] = useState<string[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const uploadPhotoMutation = trpc.jobs.uploadPhoto.useMutation();
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Helper: upload a local URI to S3 and return the S3 URL
  const uploadPhotoToS3 = async (jobId: string, uri: string): Promise<string> => {
    let base64: string;
    if (Platform.OS === "web") {
      // Web: use FileReader (fetch + blob approach)
      const response = await fetch(uri);
      const blob = await response.blob();
      const reader = new FileReader();
      base64 = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const r = reader.result as string;
          resolve(r.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } else {
      // Native (iOS/Android): resolve ph:// URIs from iOS photo library before reading
      let readableUri = uri;
      if (uri.startsWith("ph://")) {
        // Use the URI directly - expo-image-picker already provides a readable URI
        readableUri = uri;
      }
      base64 = await FileSystem.readAsStringAsync(readableUri, { encoding: FileSystem.EncodingType.Base64 });
    }
    const result = await uploadPhotoMutation.mutateAsync({ jobId, base64, mimeType: "image/jpeg" });
    return result.url;
  };

  // Live timer tick — updates every second when a job is in progress
  const [timerTick, setTimerTick] = useState(0);
  useEffect(() => {
    const active = selectedJob && (selectedJob.status === "on_my_way" || selectedJob.status === "arrived") && !selectedJob.jobFinishedAt;
    if (!active) return;
    const id = setInterval(() => setTimerTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [selectedJob?.status, selectedJob?.id]);

  // Vehicle inspection state
  const [showInspectionModal, setShowInspectionModal] = useState(false);
  const [inspViewMode, setInspViewMode] = useState<"form" | "report">("form");
  const [inspRatings, setInspRatings] = useState<Record<string, InspRating>>({});
  const [inspExteriorZones, setInspExteriorZones] = useState<string[]>([]);
  const [inspInteriorZones, setInspInteriorZones] = useState<string[]>([]);
  const [inspDiagramTab, setInspDiagramTab] = useState<"exterior" | "interior">("exterior");
  const [inspNotes, setInspNotes] = useState("");
  // Enhanced job detail state
  const [showCustomerHistory, setShowCustomerHistory] = useState(true);
  const [customerHistoryJobs, setCustomerHistoryJobs] = useState<any[]>([]);
  const [customerHistoryLoading, setCustomerHistoryLoading] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [editingPrivateNotes, setEditingPrivateNotes] = useState(false);
  const [privateNotesInput, setPrivateNotesInput] = useState("");
  const [editingTax, setEditingTax] = useState(false);
  const [taxInput, setTaxInput] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);

  // Address location photos (detailer view — can add, cannot delete)
  const [addrPhotos, setAddrPhotos] = useState<any[]>([]);
  const [viewingAddrPhoto, setViewingAddrPhoto] = useState<string | null>(null);
  const [addrPhotoUploading, setAddrPhotoUploading] = useState(false);
  const uploadAddrPhotoMutation = trpc.jobs.uploadAddressPhoto.useMutation();

  const handleAddAddrPhoto = async () => {
    if (!selectedJob) return;
    if (addrPhotos.length >= 2) { Alert.alert("Limit Reached", "Maximum 2 photos per address."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.7 });
    if (result.canceled || !result.assets[0]?.base64) return;
    setAddrPhotoUploading(true);
    try {
      const asset = result.assets[0];
      const addressKey = selectedJob.address.trim().toLowerCase().replace(/\s+/g, "-");
      const res = await uploadAddrPhotoMutation.mutateAsync({ addressKey, base64: asset.base64!, mimeType: asset.mimeType ?? "image/jpeg", uploadedBy: employee?.fullName, uploadedByRole: "detailer" });
      if (res.success && res.photos) setAddrPhotos(res.photos);
    } catch (e: any) { Alert.alert("Upload Failed", e.message ?? "Could not upload photo."); }
    setAddrPhotoUploading(false);
  };

  // Auto-load customer history whenever a job is selected
  useEffect(() => {
    setCustomerHistoryJobs([]);
    setAddrPhotos([]);
    if (!isJobSyncCompany && selectedJob && (selectedJob.phone || selectedJob.email)) {
      loadCustomerHistory(selectedJob);
    }
    if (!isJobSyncCompany && selectedJob?.address) {
      const addressKey = selectedJob.address.trim().toLowerCase().replace(/\s+/g, "-");
      utils.jobs.getAddressPhotos.fetch({ addressKey }).then((photos: any[]) => setAddrPhotos(photos)).catch(() => {});
    }
    // Live-refresh photo URLs from the server whenever a job detail panel is opened.
    // This ensures photos uploaded from another device (or a previous session) are always visible.
    if (!isJobSyncCompany && selectedJob?.id) {
      const jobId = selectedJob.id;
      utils.jobs.getPhotos.fetch({ jobId })
        .then(({ urls }: { urls: string[] }) => {
          if (!urls || urls.length === 0) return;
          setSelectedJob((prev) => {
            if (!prev || prev.id !== jobId) return prev;
            const merged = Array.from(new Set([...urls, ...(prev.photoUrls ?? []), ...(prev.photos ?? [])].filter(Boolean)));
            const mergedUrls = merged.filter((p) => p.startsWith('http'));
            if (JSON.stringify(mergedUrls) === JSON.stringify(prev.photoUrls ?? [])) return prev;
            return { ...prev, photoUrls: mergedUrls };
          });
          setJobs((prev) => prev.map((j) => {
            if (j.id !== jobId) return j;
            const merged = Array.from(new Set([...urls, ...(j.photoUrls ?? [])].filter(Boolean)));
            return JSON.stringify(merged) === JSON.stringify(j.photoUrls ?? []) ? j : { ...j, photoUrls: merged };
          }));
        })
        .catch(() => { /* ignore — offline or job not in DB yet */ });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJob?.id]);

  // Mark messages read when chat modal opens
  useEffect(() => {
    if (showChatModal && chatBookingRef) {
      chatMarkReadMutation.mutate({ bookingRef: chatBookingRef, readerType: "detailer" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showChatModal, chatBookingRef]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatListQuery.data?.messages?.length) {
      setTimeout(() => chatFlatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [chatListQuery.data?.messages?.length]);

  const handleChatSend = useCallback(() => {
    const trimmed = chatMessage.trim();
    if (!trimmed || chatSendMutation.isPending || !chatBookingRef) return;
    chatSendMutation.mutate({
      bookingRef: chatBookingRef,
      senderType: "detailer",
      senderId: employee?.employeeId ?? employee?.fullName ?? "detailer",
      senderName: employee?.fullName ?? "Detailer",
      message: trimmed,
    });
    setChatMessage("");
  }, [chatMessage, chatBookingRef, chatSendMutation, employee]);

  const openInspection = (job: Job) => {
    if (job.inspection) {
      // Show completed report
      setInspRatings(job.inspection.ratings ?? {});
      setInspExteriorZones(job.inspection.exteriorZones ?? []);
      setInspInteriorZones(job.inspection.interiorZones ?? []);
      setInspNotes(job.inspection.notes ?? "");
      setInspViewMode("report");
    } else {
      // Fresh form
      setInspRatings({});
      setInspExteriorZones([]);
      setInspInteriorZones([]);
      setInspNotes("");
      setInspViewMode("form");
    }
    setInspDiagramTab("exterior");
    setShowInspectionModal(true);
  };

  const saveInspection = () => {
    if (!selectedJob) return;
    const inspection: VehicleInspection = {
      completedAt: new Date().toISOString(),
      inspectedBy: employee?.fullName ?? "Unknown",
      ratings: inspRatings,
      exteriorZones: inspExteriorZones,
      interiorZones: inspInteriorZones,
      notes: inspNotes.trim() || undefined,
    };
    const updatedJob = { ...selectedJob, inspection };
    persistJobs(jobs.map((j) => j.id === selectedJob.id ? updatedJob : j));
    setSelectedJob(updatedJob);
    setInspViewMode("report");
  };

  // Form fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [serviceTitle, setServiceTitle] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [price, setPrice] = useState("");
  const [startHour, setStartHour] = useState(8);
  const [endHour, setEndHour] = useState(9);
  const [notes, setNotes] = useState("");
  const [vehicleType, setVehicleType] = useState<VehicleType | undefined>();
  const [packageId, setPackageId] = useState<string | undefined>();
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [addonQtys, setAddonQtys] = useState<Record<string, number>>({});
  // Detailer assignment for admin-created jobs
  const [assignedDetailerId, setAssignedDetailerId] = useState<string | undefined>();
  const [notifyCustomer, setNotifyCustomer] = useState(true);

  // Per-employee storage key: prevents detailer A from seeing detailer B's cached jobs
  // Admins share one cache (no suffix); detailers get their own isolated cache.
  const STORAGE_KEY = `${STORAGE_KEY_BASE}_${employee?.employeeId || 'anon'}`;
  const storageKeyRef = useRef(STORAGE_KEY);
  storageKeyRef.current = STORAGE_KEY;

  useEffect(() => {
    if (authLoading || !employee?.employeeId) return; // Wait until we know WHO is logged in
    if (!allowLegacyJobAuthority) return;
    const key = `${STORAGE_KEY_BASE}_${employee.employeeId}`;
    AsyncStorage.getItem(key).then((raw) => {
      if (raw) { try { const parsed = JSON.parse(raw); jobsRef.current = parsed; setJobs(parsed); } catch {} }
    });
    // Also clear the old shared cache key so stale data doesn't persist
    AsyncStorage.removeItem('tlw_schedule_jobs_v8').catch(() => {});
  }, [allowLegacyJobAuthority, authLoading, employee?.employeeId]);

  // Keep jobsRef in sync with jobs state for use in nav callbacks
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  const persistJobs = (updated: Job[]) => {
    jobsRef.current = updated;
    setJobs(updated);
    if (allowLegacyJobAuthority) {
      AsyncStorage.setItem(storageKeyRef.current, JSON.stringify(updated));
    }
  };

  // Helper: convert a Job to the server upsert payload
  const jobToServerPayload = (job: Job) => {
    const jobDate = getWeekDates(job.weekOffset)[job.dayIndex];
    const dateStr = localDateStr(jobDate);
    return {
      jobId: job.id,
      location: job.location ?? selectedLocation,
      date: dateStr,
      timeSlot: `${formatHour(job.startHour)} - ${formatHour(job.endHour)}`,
      startHour: job.startHour,
      endHour: job.endHour,
      customerName: `${job.firstName} ${job.lastName}`.trim(),
      customerPhone: job.phone || undefined,
      customerEmail: job.email || undefined,
      vehicleType: job.vehicleType || undefined,
      packageType: job.packageId || undefined,
      serviceDescription: job.serviceDescription || undefined,
      selectedAddons: job.addonIds?.length ? JSON.stringify(job.addonIds) : undefined,
      totalPrice: Math.max(0, job.price - (job.discountAmount ?? 0)),
      tips: job.payment?.tipAmount ?? 0,
      upsellTotal: job.upsellTotal ?? 0,
      // Use detailerName (stored as employeeId) as assignedTo for proper per-detailer filtering
      // For admin-created jobs: detailerName = selected detailer's employeeId
      // For detailer-created jobs: detailerName = detailer's own employeeId
      assignedTo: job.detailerName || employee?.employeeId || undefined,
      status: (job.status === "finished" ? "completed" : job.status === "started" ? "in_progress" : "confirmed") as "confirmed" | "in_progress" | "completed" | "cancelled" | "pending",
      source: "manual" as const,
      notes: job.notes || undefined,
      customerAddress: job.address || undefined,
      createdBy: employee?.employeeId || undefined,
      recommendedServices: job.recommendedIds?.length ? JSON.stringify(job.recommendedIds) : undefined,
      additionalVehicles: job.additionalVehicles?.length ? JSON.stringify(job.additionalVehicles) : undefined,
    };
  };

  // Sync a single job to server (fire-and-forget, never blocks UI)
  const syncJobToServer = (job: Job) => {
    if (!allowLegacyJobAuthority) return;
    if (job.isOnlineBooking) return; // online bookings are already in DB
    // notifyCustomer: false — re-syncs (status updates, moves) should never send confirmation emails
    jobUpsertMutation.mutate({ ...jobToServerPayload(job), notifyCustomer: false });
  };

  // Sync all manual jobs to server (used on initial load to catch up)
  const syncAllManualJobsToServer = (allJobs: Job[]) => {
    if (!allowLegacyJobAuthority) return;
    const manual = allJobs.filter((j) => !j.isOnlineBooking);
    manual.forEach((job) => {
      // notifyCustomer: false — bulk re-syncs should never trigger emails
      jobUpsertMutation.mutate({ ...jobToServerPayload(job), notifyCustomer: false });
    });
  };

  const weekDates = getWeekDates(weekOffset);
  const selectedDate = weekDates[selectedDay];

  // Sync server jobs (both manual + online) for the selected location into local state
  const syncServerJobs = async (location: LocationSlug, emp = employee) => {
    if (!allowLegacyJobAuthority) {
      if (!isJobSyncCompany || !jobSyncSession?.token) {
        setJobs([]);
        setCompanyJobsError(COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
        return;
      }
      try {
        const today = new Date();
        const start = new Date(today); start.setDate(today.getDate() - 365);
        const end = new Date(today); end.setDate(today.getDate() + 365);
        const companyJobs = await getJobSyncCompanyJobs(jobSyncSession.token, { start: start.toISOString(), end: end.toISOString() });
        const mappedCompanyJobs: Job[] = companyJobs.map((job) => ({
          ...mapCanonicalJobToScheduleFields(job, location),
          location: (job.city ? cityToSlug(job.city) : location) as LocationSlug,
        }) as Job);
        setCompanyJobsError(null);
        setJobs(mappedCompanyJobs);
      } catch (error) {
        setJobs([]);
        setCompanyJobsError(companyCanonicalReadError(error));
      }
      return;
    }
    try {
      const today = new Date();
      // No lookback limit — fetch all historical and future jobs
      const startDate = "2020-01-01";
      const toDate = new Date(today);
      toDate.setDate(today.getDate() + 60); // 60 days ahead
      const endDate = localDateStr(toDate);
      // Detailers only fetch their own jobs; admins/managers fetch all jobs for the location
      const isAdminSync = emp?.role === "admin" || emp?.role === "operations_manager" || emp?.role === "office";
      // If not admin and no employee session yet, skip — we'll retry when employee loads
      if (!isAdminSync && !emp?.employeeId) return;
      const serverJobs = await utils.jobs.listByLocation.fetch({
        location,
        startDate,
        endDate,
        assignedTo: isAdminSync ? undefined : (emp?.employeeId || undefined),
      });
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
        // Parse customerName back to firstName/lastName
        const nameParts = (sj.customerName || "").split(" ");
        const fName = nameParts[0] || "";
        const lName = nameParts.slice(1).join(" ") || "";
        const isOnline = sj.source === "online";
        return {
          id: sj.jobId,
          bookingId: sj.onlineBookingId || undefined,
          isOnlineBooking: isOnline,
          location: sj.location,
          firstName: fName,
          lastName: lName,
          email: sj.customerEmail || "",
          phone: sj.customerPhone || "",
          address: sj.customerAddress || "",
          serviceTitle: (() => {
            if (!sj.packageType) return "Detail Service";
            // Look up human-readable name from dynamic price book
            const pkg = _schedPackages.find((p) => p.id === sj.packageType);
            if (pkg) return pkg.title;
            // Look up in static PACKAGES (handles short keys like "luxury", "full", "basic")
            const staticPkg = PACKAGES.find((p) => p.id === sj.packageType.toLowerCase() || p.title.toLowerCase() === sj.packageType.toLowerCase());
            if (staticPkg) return staticPkg.title;
            // Handle legacy short names stored before price book migration
            const legacyMap: Record<string, string> = {
              interior: "Interior Detail", exterior: "Exterior Detail",
              luxury: "Luxury Detail", full: "Full Detail", basic: "Basic Detail",
              vip: "VIP",
            };
            const legacyKey = sj.packageType.toLowerCase().replace(/[^a-z]/g, "");
            if (legacyMap[legacyKey]) return legacyMap[legacyKey];
            // pb_ IDs not in price book → generic fallback
            return sj.packageType.startsWith("pb_") ? "Detail Service" : sj.packageType;
          })(),
          serviceDescription: sj.serviceDescription || "",
          price: sj.customPrice != null ? parseFloat(String(sj.customPrice)) : parseFloat(sj.totalPrice || "0"),
          startHour: sj.startHour != null ? parseFloat(String(sj.startHour)) : 8,
          endHour: sj.endHour != null ? parseFloat(String(sj.endHour)) : 10,
          dayIndex: dayOfWeek,
          weekOffset: wOffset,
          status: (sj.status === "completed" ? "finished" : sj.status === "in_progress" ? "started" : sj.status === "cancelled" ? "cancelled" : "scheduled") as JobStatus,
          _rawStatus: sj.status,
          notes: sj.notes || undefined,
              detailerName: sj.assignedTo || undefined,
              recommendedIds: sj.recommendedServices ? (() => { try { return JSON.parse(sj.recommendedServices); } catch { return []; } })() : undefined,
          vehicleType: resolveVehicleType(sj.vehicleType),
          vehicleColor: sj.vehicleColor || undefined,
          vehicleYear: sj.vehicleYear || undefined,
          vehicleMake: sj.vehicleMake || undefined,
          vehicleModel: sj.vehicleModel || undefined,
          packageId: resolvePackageId(sj.packageType) || (sj.packageType && !sj.packageType.startsWith("pb_") ? sj.packageType : undefined),
          addonIds: parseAddonIds(sj.selectedAddons),
          tags: sj.tags ? (() => { try { return JSON.parse(sj.tags); } catch { return []; } })() : [],
          privateNotes: sj.privateNotes ? (() => { try { const p = JSON.parse(sj.privateNotes); return Array.isArray(p) ? p : undefined; } catch { return undefined; } })() : undefined,
          leadSource: sj.leadSource || (isOnline ? (sj.source === "portal" ? "Portal Booking" : "Website Booking") : "Admin — Manual"),
          taxAmount: sj.taxAmount ? parseFloat(sj.taxAmount) : 0,
          discountCode: sj.discountCode || undefined,
          discountAmount: sj.discountAmount ? parseFloat(sj.discountAmount) : 0,
          depositAmount: sj.depositAmount ? parseFloat(sj.depositAmount) : 0,
          upsellTotal: sj.upsellTotal ? parseFloat(String(sj.upsellTotal)) : 0,
          upsellIds: sj.upsellIds ? (() => { try { return JSON.parse(sj.upsellIds); } catch { return []; } })() : [],
          upsellQtys: sj.upsellQtys ? (() => { try { return JSON.parse(sj.upsellQtys); } catch { return {}; } })() : {},
          additionalVehicles: sj.additionalVehicles ? (() => { try { return JSON.parse(sj.additionalVehicles); } catch { return []; } })() : [],
          photoUrls: sj.photoUrls ? (() => { try { const p = JSON.parse(sj.photoUrls); return Array.isArray(p) ? p : []; } catch { return []; } })() : [],
          onMyWayAt: sj.onMyWayAt ? String(sj.onMyWayAt) : null,
          arrivedAt: sj.arrivedAt ? String(sj.arrivedAt) : null,
          finishedAt: sj.finishedAt ? String(sj.finishedAt) : null,
          createdAt: sj.createdAt ? new Date(sj.createdAt).toISOString() : new Date().toISOString(),
          // Map server payment fields so paid jobs show correctly (no red ring)
          payment: sj.paymentMethod && sj.paymentPaidAt ? {
            method: sj.paymentMethod as any,
            subtotal: parseFloat(sj.paymentSubtotal || sj.totalPrice || "0"),
            tipAmount: parseFloat(sj.paymentTip || "0"),
            total: parseFloat(sj.paymentTotal || sj.totalPrice || "0"),
            paidAt: sj.paymentPaidAt,
            paymentIntentId: sj.paymentIntentId || undefined,
          } : undefined,
          isNewCustomer: sj.isNewCustomer === 1 || (sj.isNewCustomer as any) === true,
        } as Job;
      });
      // Also fetch customer portal bookings for this location
      let customerPortalJobs: Job[] = [];
      try {
        const portalBookings = await utils.customer.listByLocation.fetch({
          location,
          startDate,
          endDate,
          // Detailers only see their own assigned portal bookings; admins see all
          assignedTo: isAdminSync ? undefined : (emp?.employeeId || undefined),
        });
        customerPortalJobs = (portalBookings || []).map((cb: any) => {
          const bookingDate = parseLocalDate(cb.scheduledDate);
          // Mon-based day index: 0=Mon…6=Sun
          const dayOfWeek = (bookingDate.getDay() + 6) % 7;
          const todayMonday2 = new Date();
          todayMonday2.setDate(todayMonday2.getDate() - (todayMonday2.getDay() + 6) % 7);
          todayMonday2.setHours(0, 0, 0, 0);
          const bookingMonday2 = new Date(bookingDate);
          bookingMonday2.setDate(bookingDate.getDate() - dayOfWeek);
          bookingMonday2.setHours(0, 0, 0, 0);
          const diffMs2 = bookingMonday2.getTime() - todayMonday2.getTime();
          const wOffset2 = Math.round(diffMs2 / (7 * 24 * 60 * 60 * 1000));
          // Parse time slot to startHour/endHour from full range string e.g. "8:00 AM – 12:00 PM"
          const parseHrFromStr = (t: string): number => {
            const mm = t.trim().match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
            if (!mm) return 8;
            let hh = parseInt(mm[1], 10);
            const mn = mm[2] ? parseInt(mm[2], 10) : 0;
            if (mm[3].toUpperCase() === "PM" && hh !== 12) hh += 12;
            if (mm[3].toUpperCase() === "AM" && hh === 12) hh = 0;
            return hh + (mn >= 30 ? 0.5 : 0);
          };
          const timeParts2 = (cb.scheduledTime || "8:00 AM").split(/[\u2013\-]/).map((s: string) => s.trim());
          const startHr = parseHrFromStr(timeParts2[0] ?? "8:00 AM");
          const endHrFromSlot = timeParts2[1] ? parseHrFromStr(timeParts2[1]) : Math.min(startHr + 2, 17);
          const addons: string[] = (() => { try { return JSON.parse(cb.addons || "[]"); } catch { return []; } })();
          return {
            id: `portal_${cb.bookingRef}`,
            bookingId: cb.bookingRef,
            isOnlineBooking: true,
            location,
            firstName: cb.customerFirstName || "",
            lastName: cb.customerLastName || "App Booking",
            email: cb.customerEmail || "",
            phone: cb.customerPhone || "",
            address: cb.addressLabel || cb.city || "",
            serviceTitle: cb.packageName || "Detail Service",
            serviceDescription: addons.join(", "),
            price: parseFloat(cb.total || "0"),
            startHour: startHr,
            endHour: endHrFromSlot,
            dayIndex: dayOfWeek,
            weekOffset: wOffset2,
            status: (cb.status === "completed" ? "finished" : cb.status === "in_progress" ? "started" : "scheduled") as JobStatus,
            notes: cb.notes || undefined,
            vehicleType: resolveVehicleType(cb.vehicleType),
            vehicleLabel: cb.vehicleLabel || undefined,
            packageId: cb.packageId || undefined,
            addonIds: addons,
            tags: [],
            leadSource: "Client App",
            taxAmount: 0,
            discountAmount: 0,
            depositAmount: 0,
            upsellTotal: 0,
            additionalVehicles: [],
            createdAt: cb.createdAt ? new Date(cb.createdAt).toISOString() : new Date().toISOString(),
            customerId: cb.customerId || undefined,
            // Use assignedEmployeeId so the job shows in the correct detailer column
            // If null/unassigned, detailerName is undefined → shows in first column
            detailerName: cb.assignedEmployeeId || undefined,
          } as Job;
        });
      } catch (portalErr) {
        // Customer portal bookings unavailable — continue with staff jobs only
        console.warn('[syncServerJobs] portal bookings fetch failed:', portalErr);
      }

      // Merge server jobs with local state — preserve local status if it is more advanced than server
      // Status advancement order: scheduled < started < on_my_way < arrived < finished
      const STATUS_RANK: Record<string, number> = { scheduled: 0, started: 1, on_my_way: 2, arrived: 3, finished: 4 };
      // Build the full set of server-returned IDs in the outer scope so the
      // setSelectedJob callback (outside setJobs) can reference it.
      // Filter out cancelled jobs — they must not appear on the detailer calendar
      const activeMappedJobs = mappedJobs.filter((j: any) => (j as any)._rawStatus !== 'cancelled');
      const allNewJobsOuter = [...activeMappedJobs];
      customerPortalJobs.forEach((pj) => {
        if (!allNewJobsOuter.find((j) => j.id === pj.id)) allNewJobsOuter.push(pj);
      });
      const syncedJobIds = new Set(allNewJobsOuter.map((j) => j.id));
      setJobs((prev) => {
        const otherLocJobs = prev.filter((j) => j.location && j.location.toLowerCase() !== location.toLowerCase());
        // Build lookup of existing local jobs for this location
        const localMap = new Map(prev.filter((j) => !j.location || j.location.toLowerCase() === location.toLowerCase()).map((j) => [j.id, j]));
        // Merge staff jobs + customer portal jobs, deduplicating by id
        const allNewJobs = [...activeMappedJobs];
        customerPortalJobs.forEach((pj) => {
          if (!allNewJobs.find((j) => j.id === pj.id)) allNewJobs.push(pj);
        });
        // Build a set of all IDs returned by the server for this sync window
        const serverJobIds = new Set(allNewJobs.map((j) => j.id));
        // For each server job, preserve local status/timestamps if local is more advanced
        const mergedNewJobs = allNewJobs.map((sj) => {
          const local = localMap.get(sj.id);
          if (!local) return sj;
          const serverRank = STATUS_RANK[sj.status] ?? 0;
          const localRank = STATUS_RANK[local.status] ?? 0;
          // Merge photos: combine server S3 URLs + local URIs (pending upload), deduplicate
          const mergedPhotos = Array.from(new Set([
            ...(sj.photoUrls ?? []),
            ...(local.photoUrls ?? []),
            ...(local.photos ?? []),
          ])).filter(p => p && p.length > 0);
          const mergedPhotoUrls = mergedPhotos.filter(p => p.startsWith('http'));
          const mergedLocalPhotos = mergedPhotos;
          // Merge videos similarly
          const mergedVideoUrls = Array.from(new Set([
            ...(sj.videoUrls ?? []),
            ...(local.videoUrls ?? []),
          ])).filter(v => v && v.length > 0);
          if (localRank > serverRank) {
            // Local is ahead of server — keep local status and timestamps
            return {
              ...sj,
              status: local.status,
              payment: local.payment ?? sj.payment,
              jobStartedAt: local.jobStartedAt,
              jobFinishedAt: local.jobFinishedAt,
              travelStartedAt: local.travelStartedAt,
              arrivedAt: local.arrivedAt,
              photos: mergedLocalPhotos,
              photoUrls: mergedPhotoUrls,
              videoUrls: mergedVideoUrls,
            };
          }
          // Server is equal or ahead — use server data but preserve photos and payment
          return { ...sj, payment: sj.payment ?? local.payment, photos: mergedLocalPhotos, photoUrls: mergedPhotoUrls, videoUrls: mergedVideoUrls };
        });
        // Carry over locally-created jobs (13-digit timestamp IDs) that the server doesn't
        // know about yet (e.g. created offline). All other local jobs that fall inside the sync
        // window but were NOT returned by the server have been deleted or reassigned away from
        // this detailer — drop them so the screen immediately reflects admin changes.
        const isLocalOnlyJob = (id: string) => /^\d{13}$/.test(id); // Date.now() = 13-digit number
        const localOnlyJobs = Array.from(localMap.values()).filter(
          (j) => isLocalOnlyJob(j.id) && !serverJobIds.has(j.id)
        );
        // Helper: reconstruct a job's date string from its dayIndex + weekOffset
        const jobDateStr = (j: Job): string => {
          try {
            const d = getWeekDates(j.weekOffset)[j.dayIndex];
            return localDateStr(d);
          } catch { return ""; }
        };
        // Keep local jobs that are OUTSIDE the sync window (very old history or far future)
        // so we don't accidentally erase historical records. Jobs inside the window that the
        // server didn't return were deleted or reassigned — they must be dropped.
        const outsideWindowJobs = Array.from(localMap.values()).filter((j) => {
          if (isLocalOnlyJob(j.id)) return false; // already handled above
          if (serverJobIds.has(j.id)) return false; // already in mergedNewJobs
          const d = jobDateStr(j);
          return d < startDate || d > endDate; // outside sync window → keep
        });
        // Remove any previously-cached cancelled jobs so they don't linger after a cancel
        const merged = [...otherLocJobs, ...mergedNewJobs, ...localOnlyJobs, ...outsideWindowJobs]
          .filter((j: any) => (j as any)._rawStatus !== 'cancelled' && j.status !== 'cancelled');
        AsyncStorage.setItem(storageKeyRef.current, JSON.stringify(merged));
        return merged;
      });
      // If the currently-open job was deleted or reassigned away, close its detail panel
      // so the detailer isn't staring at a ghost job.
      setSelectedJob((prev) => {
        if (!prev) return null;
        const stillExists = syncedJobIds.has(prev.id) || isLocalOnlyJobCheck(prev.id);
        return stillExists ? prev : null;
      });
    } catch {
      // Fail silently — offline mode still works from AsyncStorage
    }
  };
  // Helper used inside the setSelectedJob callback above (must be a stable reference)
  const isLocalOnlyJobCheck = (id: string) => /^\d{13}$/.test(id);

  // Sync online bookings from the server for the selected location
  const syncOnlineBookings = async (location: LocationSlug) => {
    if (!allowLegacyJobAuthority) return;
    setIsSyncingBookings(true);
    try {
      // Detailers must NOT use the unfiltered /api/booking/list endpoint — it returns ALL
      // bookings for the location regardless of assignedTo, which would pollute their local
      // cache with other detailers' jobs. Detailers get their jobs via syncServerJobs which
      // correctly filters by assignedTo (employeeId).
      const isAdminUser = employee?.role === "admin" || employee?.role === "operations_manager" || employee?.role === "office";
      if (!isAdminUser) {
        // For detailers, just re-run the proper server sync and return
        await syncServerJobs(location, employee);
        return;
      }
      const today = new Date();
      const fromDate = new Date(today);
      fromDate.setDate(today.getDate() - 7); // sync past week + future
      const fromStr = localDateStr(fromDate);
      const url = `${APP_API_BASE}/api/booking/availability?location=${location}&date=${fromStr}`;
      // Fetch all bookings for this location from the server
      const resp = await fetch(`${APP_API_BASE}/api/booking/list?location=${location}&from=${fromStr}`);
      if (!resp.ok) return;
      const data = await resp.json();
      // Filter out cancelled/abandoned bookings — they should never appear on the calendar
      const activeBookings = (data.bookings || []).filter((b: any) => {
        const status = (b.status ?? "").toLowerCase();
        if (status === "abandoned" || status === "closed" || status === "cancelled") return false;
        if ((b.bookingId ?? "").startsWith("ABANDONED-")) return false;
        return true;
      });
      const serverBookings: Job[] = activeBookings.map((b: any) => {
        // Convert server booking to local Job format
        const bookingDate = parseLocalDate(b.bookingDate);
        // Mon-based day index: 0=Mon…6=Sun
        const dayOfWeek = (bookingDate.getDay() + 6) % 7;
        // Calculate weekOffset relative to current Monday-anchored week
        const todayDate = new Date();
        const todayMonday = new Date(todayDate);
        todayMonday.setDate(todayDate.getDate() - (todayDate.getDay() + 6) % 7);
        todayMonday.setHours(0, 0, 0, 0);
        const bookingMonday = new Date(bookingDate);
        bookingMonday.setDate(bookingDate.getDate() - dayOfWeek);
        bookingMonday.setHours(0, 0, 0, 0);
        const diffMs = bookingMonday.getTime() - todayMonday.getTime();
        const wOffset = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
        return {
          id: `online_${b.bookingId}`,
          bookingId: b.bookingId,
          isOnlineBooking: true,
          location: b.location,
          firstName: b.firstName,
          lastName: b.lastName,
          email: b.email || "",
          phone: b.phone || "",
          address: [b.streetAddress, b.unit, b.city, b.state, b.zipCode].filter(Boolean).join(", "),
          serviceTitle: (() => {
            const pkg = b.packageType ? _schedPackages.find((p) => p.id === b.packageType) : undefined;
            const pkgName = pkg ? pkg.title : (b.packageType && !b.packageType.startsWith("pb_") ? b.packageType : null);
            return [pkgName, b.vehicleType].filter(Boolean).join(" — ") || "Online Booking";
          })(),
          serviceDescription: b.selectedAddons || "",
          addonIds: parseAddonIds(b.selectedAddons),
          price: parseFloat(b.finalTotal || b.totalPrice || "0"),
          startHour: b.startHour != null ? parseFloat(String(b.startHour)) : 8,
          endHour: b.endHour != null ? parseFloat(String(b.endHour)) : 10,
          dayIndex: dayOfWeek,
          weekOffset: wOffset,
          status: (b.status === "completed" ? "finished" : b.status === "in_progress" ? "started" : "scheduled") as JobStatus,
          createdAt: b.createdAt,
          packageId: b.packageId || resolvePackageId(b.packageType) || undefined,
          vehicleType: resolveVehicleType(b.vehicleType),
          tags: [],
          taxAmount: 0,
          discountAmount: 0,
          depositAmount: 0,
          upsellTotal: 0,
          additionalVehicles: [],
        } as Job;
      });
      // Merge: keep manual jobs, replace/add online ones — preserve local status if more advanced
      const STATUS_RANK_OB: Record<string, number> = { scheduled: 0, started: 1, on_my_way: 2, arrived: 3, finished: 4 };
      setJobs((prev) => {
        const manual = prev.filter((j) => !j.isOnlineBooking || j.location?.toLowerCase() !== location.toLowerCase());
        const localOnlineMap = new Map(prev.filter((j) => j.isOnlineBooking && j.location?.toLowerCase() === location.toLowerCase()).map((j) => [j.id, j]));
        const mergedOnline = serverBookings.map((sb) => {
          const local = localOnlineMap.get(sb.id);
          if (!local) return sb;
          const serverRank = STATUS_RANK_OB[sb.status] ?? 0;
          const localRank = STATUS_RANK_OB[local.status] ?? 0;
          if (localRank > serverRank) {
            return { ...sb, status: local.status, payment: local.payment ?? sb.payment, jobStartedAt: local.jobStartedAt, jobFinishedAt: local.jobFinishedAt, travelStartedAt: local.travelStartedAt, arrivedAt: local.arrivedAt };
          }
          return { ...sb, payment: sb.payment ?? local.payment };
        });
        const merged = [...manual, ...mergedOnline];
        AsyncStorage.setItem(storageKeyRef.current, JSON.stringify(merged));
        return merged;
      });
    } catch (e) {
      // Fail silently — offline mode still works
    } finally {
      setIsSyncingBookings(false);
    }
  };

  // Single reliable sync effect: fires when auth loads or employee changes
  // Directly computes the correct location slug and syncs — no two-step chain
  useEffect(() => {
    if (authLoading) return; // wait for session to load from AsyncStorage
    const slug: LocationSlug = (employee?.city && employee.role === "detailer")
      ? cityToSlug(employee.city)
      : selectedLocation;
    // Update location picker for detailers (UI only, doesn't re-trigger sync)
    if (slug !== selectedLocation) {
      setSelectedLocation(slug);
    }
    // Pass employee explicitly so syncServerJobs never reads a stale closure value
    syncServerJobs(slug, employee);
  }, [authLoading, employee?.employeeId, jobSyncRevision]);
  // Also sync whenever admin manually changes the selected location
  useEffect(() => {
    if (!authLoading && (employee?.role === "admin" || employee?.role === "operations_manager" || employee?.role === "office")) {
      syncServerJobs(selectedLocation, employee);
    }
  }, [selectedLocation]);

  // ── Auto-refresh: 30-second polling for detailers ──────────────────────────
  // Silently re-syncs every 30 seconds while the screen is mounted.
  // Keeps detailers' schedules up to date without manual pull-to-refresh.
  useEffect(() => {
    if (authLoading || !employee?.employeeId) return;
    const isDetailer = employee.role === "detailer";
    const isAdmin = employee.role === "admin" || employee.role === "operations_manager";
    if (!isDetailer && !isAdmin) return;
    const slug: LocationSlug = isDetailer
      ? (employee.city ? cityToSlug(employee.city) : selectedLocation)
      : selectedLocation;
    const intervalMs = isDetailer ? 10_000 : 15_000; // detailers: 10s, admins: 15s
    const intervalId = setInterval(() => {
      syncServerJobs(slug, employee);
    }, intervalMs);
    return () => clearInterval(intervalId);
  }, [authLoading, employee?.employeeId, employee?.role, employee?.city, selectedLocation]);

  // ── Auto-refresh: app comes back to foreground ────────────────────────────
  // Immediately re-syncs when the detailer switches back to the app.
  useEffect(() => {
    if (authLoading || !employee?.employeeId) return;
    const isDetailer = employee.role === "detailer";
    if (!isDetailer) return;
    const slug: LocationSlug = employee.city ? cityToSlug(employee.city) : selectedLocation;
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "active") {
        syncServerJobs(slug, employee);
      }
    });
    return () => subscription.remove();
  }, [authLoading, employee?.employeeId, employee?.role, employee?.city, selectedLocation]);


  // ── Deep link: open specific job from push notification tap ──────────────
  useEffect(() => {
    if (!highlightJobId || highlightJobHandledRef.current === highlightJobId) return;
    // Search in already-loaded jobs first
    const match = jobs.find((j) => j.id === highlightJobId || j.bookingId === highlightJobId);
    if (match) {
      highlightJobHandledRef.current = highlightJobId;
      setWeekOffset(match.weekOffset);
      setSelectedDay(match.dayIndex);
      setSelectedJob(match);
      return;
    }
    // Job not in local cache yet — fetch from server
    if (!allowLegacyJobAuthority) return;
    const fetchAndOpen = async () => {
      try {
        const res = await fetch(`${APP_API_BASE}/api/booking/job/${encodeURIComponent(highlightJobId)}`);
        if (!res.ok) return;
        const sj = await res.json();
        if (!sj?.jobId) return;
        const bookingDate = parseLocalDate(sj.date);
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
          isOnlineBooking: sj.source === "online",
          bookingId: sj.onlineBookingId || sj.bookingId || undefined,
          location: sj.location,
          firstName: nameParts[0] || "",
          lastName: nameParts.slice(1).join(" ") || "",
          email: sj.customerEmail || "",
          phone: sj.customerPhone || "",
          address: sj.customerAddress || "",
          serviceTitle: (() => {
            const pkg = _schedPackages.find((p) => p.id === sj.packageType);
            return pkg ? pkg.title : (sj.serviceDescription || sj.packageType || "Detail Service");
          })(),
          serviceDescription: sj.serviceDescription || "",
          price: sj.customPrice != null ? parseFloat(String(sj.customPrice)) : parseFloat(sj.totalPrice || "0"),
          startHour: sj.startHour != null ? parseFloat(String(sj.startHour)) : 8,
          endHour: sj.endHour != null ? parseFloat(String(sj.endHour)) : 10,
          dayIndex: dayOfWeek,
          weekOffset: wOffset,
          status: (sj.status === "completed" ? "finished" : sj.status === "in_progress" ? "started" : "scheduled") as JobStatus,
          notes: sj.notes || undefined,
          vehicleType: resolveVehicleType(sj.vehicleType),
          packageId: resolvePackageId(sj.packageType) || undefined,
          addonIds: parseAddonIds(sj.selectedAddons),
          tags: [],
          taxAmount: 0,
          discountAmount: 0,
          depositAmount: 0,
          upsellTotal: 0,
          additionalVehicles: [],
          createdAt: sj.createdAt ? new Date(sj.createdAt).toISOString() : new Date().toISOString(),
        } as Job;
        highlightJobHandledRef.current = highlightJobId;
        setWeekOffset(wOffset);
        setSelectedDay(dayOfWeek);
        setSelectedJob(job);
      } catch {
        // Silently fail — job may not exist yet
      }
    };
    fetchAndOpen();
  }, [highlightJobId, jobs, isJobSyncCompany]);

  // Pull-to-refresh handler for detailer view
  const handleRefresh = useCallback(async () => {
    if (!employee?.employeeId) return;
    setIsRefreshing(true);
    const slug: LocationSlug = employee.city ? cityToSlug(employee.city) : selectedLocation;
    await syncServerJobs(slug, employee);
    setIsRefreshing(false);
  }, [employee, selectedLocation]);

  const openAdd = (sh = 8, eh = 9) => {
    setFirstName(""); setLastName(""); setEmail(""); setPhone("");
    setAddress(""); setServiceTitle(""); setServiceDescription("");
    setPrice(""); setStartHour(sh); setEndHour(eh); setNotes("");
    setVehicleType(undefined); setPackageId(undefined); setAddonIds([]); setAddonQtys({});
    setAssignedDetailerId(undefined);
    setNotifyCustomer(true);
    setShowAddModal(true);
  };

  const PACKAGE_DURATIONS: Record<string, number> = { basic: 2, full: 3, luxury: 4, interior: 2, exterior: 2 };
  const handleServiceWizardSelect = (
    title: string, desc: string, p: number,
    vt: VehicleType, pkgId: string, addons: string[]
  ) => {
    setServiceTitle(title);
    setServiceDescription(desc);
    setPrice(p.toString());
    setVehicleType(vt);
    setPackageId(pkgId);
    setAddonIds(addons);
    // Auto-set end time based on package duration
    const dur = PACKAGE_DURATIONS[pkgId] ?? 2;
    setEndHour(startHour + dur);
    setShowServiceWizard(false);
  };

  const saveJob = () => {
    if (!allowLegacyJobAuthority) {
      Alert.alert("Use Company Add Job", isJobSyncCompany ? "Company Jobs must be created from the Price Book Add Job flow." : COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
      return;
    }
    if (!firstName.trim() || !lastName.trim() || !address.trim()) return;
    const resolvedTitle = serviceTitle.trim() || (packageId ? (PACKAGES.find(p => p.id === packageId)?.title ?? "Detail Service") : "Detail Service");
    const newJob: Job = {
      id: Date.now().toString(),
      firstName: firstName.trim(), lastName: lastName.trim(),
      email: email.trim(), phone: phone.trim(), address: address.trim(),
      vehicleType, packageId, addonIds, addonQtys,
      serviceTitle: resolvedTitle, serviceDescription: serviceDescription.trim(),
      price: parseFloat(price) || 0,
      startHour, endHour, dayIndex: selectedDay, weekOffset,
      status: "scheduled",
      notes: notes.trim() || undefined,
      createdAt: new Date().toISOString(),
      location: selectedLocation,
      leadSource: "Admin — Manual",
      // Auto-tag the detailer who created this job
      detailerName: (employee?.role === "admin" || employee?.role === "operations_manager" || employee?.role === "office")
        ? (assignedDetailerId ?? undefined)  // admin uses detailer picker
        : employee?.employeeId ?? undefined,  // detailer self-assigns by employeeId
    };
    persistJobs([...jobs, newJob]);
    // Sync to server DB — pass notifyCustomer flag so confirmation email is sent (or suppressed)
    if (newJob.isOnlineBooking) {
      // online bookings already handled by portal
    } else {
      jobUpsertMutation.mutate({ ...jobToServerPayload(newJob), notifyCustomer });
    }
    setShowAddModal(false);
  };

  // Start GPS location sharing and create a customer tracking token
  const startLocationSharing = async (job: Job) => {
    if (!employee) return;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;
    // Create tracking token for the customer
    try {
      const address = job.address || "";
      const result = await createTokenMutation.mutateAsync({
        employeeId: employee.employeeId,
        jobId: job.id,
        customerAddress: address || undefined,
        customerName: `${job.firstName} ${job.lastName}`.trim() || undefined,
        detailerName: employee.fullName,
      });
      setTrackingToken(result.token);
    } catch (e) {
      console.warn("[Tracking] Failed to create token:", e);
    }
    // Start watching position every 5s / 10m (matches Uber/DoorDash cadence)
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
      (loc) => {
        locationUpsertMutation.mutate({
          employeeId: employee.employeeId,
          fullName: employee.fullName,
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          jobId: job.id,
          customerAddress: job.address || undefined,
          status: "on_my_way",
        });
      }
    );
    setLocationWatcher(sub);
    setIsSharing(true);
  };

  // Stop GPS sharing — push a final 'arrived' location update so pin stays on fleet map
  const stopLocationSharing = (jobId?: string) => {
    if (locationWatcher) { locationWatcher.remove(); setLocationWatcher(null); }
    setIsSharing(false);
    setTrackingToken(null);
    if (employee) {
      if (Platform.OS !== "web") {
        // Push current GPS with 'arrived' status so pin stays visible and up-to-date
        (async () => {
          try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === "granted") {
              const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
              locationUpsertMutation.mutate({
                employeeId: employee.employeeId,
                fullName: employee.fullName,
                lat: loc.coords.latitude,
                lng: loc.coords.longitude,
                status: "arrived",
              });
            } else {
              locationDeactivateMutation.mutate({ employeeId: employee.employeeId });
            }
          } catch (_) {
            locationDeactivateMutation.mutate({ employeeId: employee.employeeId });
          }
        })();
      } else {
        locationDeactivateMutation.mutate({ employeeId: employee.employeeId });
      }
    }
    if (jobId) expireTokensMutation.mutate({ jobId });
  };

  const advanceStatus = (job: Job) => {
    if (!allowLegacyJobAuthority) {
      const jobId = canonicalJobId(job.id);
      const nextStatus = nextCanonicalJobStatus((job as Job & { _rawStatus?: string })._rawStatus);
      if (!isJobSyncCompany || !jobId || !nextStatus || !jobSyncSession?.token) {
        Alert.alert("Status unavailable", COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
        return;
      }
      void updateJobSyncCompanyJobStatus(jobSyncSession.token, jobId, { status: nextStatus })
        .then(() => syncServerJobs(selectedLocation, employee))
        .catch((error) => {
          Alert.alert("Status not updated", error instanceof Error ? error.message : COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
        });
      return;
    }
    const next = STATUS_NEXT[job.status];
    if (!next) return;
    const now = new Date().toISOString();
    const timestamps: Partial<Job> = {};
    if (next === "on_my_way") { timestamps.travelStartedAt = now; startLocationSharing(job); stampTimestampMutation.mutate({ jobId: job.id, field: "onMyWayAt", timestamp: now }); setNavJob(job); }
    if (next === "arrived")   { timestamps.arrivedAt = now; timestamps.jobStartedAt = now; stopLocationSharing(job.id); stampTimestampMutation.mutate({ jobId: job.id, field: "arrivedAt", timestamp: now }); }
    if (next === "finished")  { timestamps.jobFinishedAt = now; if (!job.jobStartedAt) timestamps.jobStartedAt = now; stopLocationSharing(job.id); stampTimestampMutation.mutate({ jobId: job.id, field: "finishedAt", timestamp: now }); }
    const updatedJob = { ...job, status: next, ...timestamps };
    const updated = jobs.map((j) => j.id === job.id ? updatedJob : j);
    persistJobs(updated);
    if (next === "on_my_way") {
      // Close job detail modal first — iOS cannot show two Modals simultaneously.
      // After dismiss animation, open the navigation modal.
      setSelectedJob(null);
      setShowUpsellPanel(false);
      setUpsellIds([]);
      setUpsellQtys({});
      setTimeout(() => setNavVisible(true), 400);
    } else {
      setSelectedJob(updatedJob);
    }
    // Sync status to server DB
    // Update schedule_jobs for any job with a real DB ID.
    // NOTE: online_ jobs ARE in schedule_jobs (mirrored from online_bookings) — include them.
    // Only portal_ bookings use a separate path (portalBookingStatusMutation).
    if (!job.id.startsWith("portal_")) {
      const serverStatus = next === "finished" ? "completed" : next === "started" ? "in_progress" : "confirmed";
      jobStatusMutation.mutate({ jobId: job.id, status: serverStatus as "confirmed" | "in_progress" | "completed" | "cancelled" | "pending" });
    }
    // For portal bookings (id starts with "portal_"), also update the customer_bookings status
    // so the customer sees the live status in their portal
    if (job.id.startsWith("portal_") && job.bookingId) {
      const portalStatus =
        next === "on_my_way" ? "en_route" :
        next === "arrived"   ? "arrived" :
        next === "started"   ? "in_progress" :
        next === "finished"  ? "completed" : "confirmed";
      portalBookingStatusMutation.mutate({ bookingRef: job.bookingId, status: portalStatus as any });
      // Also update schedule_jobs status so push notifications and review emails fire for portal bookings.
      // The schedule_jobs mirror record shares the same portal_ job ID.
      const serverStatus = next === "finished" ? "completed" : next === "started" ? "in_progress" : next === "arrived" ? "in_progress" : "confirmed";
      jobStatusMutation.mutate({ jobId: job.id, status: serverStatus as "confirmed" | "in_progress" | "completed" | "cancelled" | "pending" });
    }
  };

  const deleteJob = (id: string) => {
    if (!allowLegacyJobAuthority) {
      const jobId = canonicalJobId(id);
      if (!isJobSyncCompany || !jobId || !jobSyncSession?.token) {
        Alert.alert("Delete unavailable", COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
        return;
      }
      Alert.alert("Cancel Job", "Cancel this Company Job? This uses the same Job record as the web application.", [
        { text: "Keep", style: "cancel" },
        { text: "Cancel Job", style: "destructive", onPress: () => {
          void updateJobSyncCompanyJobStatus(jobSyncSession.token, jobId, { status: "cancelled" })
            .then(() => {
              setSelectedJob(null);
              return syncServerJobs(selectedLocation, employee);
            })
            .catch((error) => {
              Alert.alert("Job not cancelled", error instanceof Error ? error.message : COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
            });
        }},
      ]);
      return;
    }
    const jobToDelete = jobs.find((j) => j.id === id);
    Alert.alert("Delete Job", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete Permanently", style: "destructive", onPress: () => {
        persistJobs(jobs.filter((j) => j.id !== id));
        setSelectedJob(null);
        setShowUpsellPanel(false);
        setUpsellIds([]);
        setUpsellQtys({});
        // Always call jobDeleteMutation — the server handles both portal_ prefixed and regular IDs:
        // it deletes from schedule_jobs AND cancels the linked customer_bookings record in one call.
        jobDeleteMutation.mutate({ jobId: id });
      }},
    ]);
  };

  // ─── Enhanced Job Detail Helpers ────────────────────────────────────────────

  const loadCustomerHistory = async (job: Job) => {
    if (!allowLegacyJobAuthority) return;
    if (!job.phone && !job.email) return;
    setCustomerHistoryLoading(true);
    try {
      const url = `${APP_API_BASE}/api/trpc/jobs.customerHistory?input=${encodeURIComponent(JSON.stringify({ phone: job.phone || undefined, email: job.email || undefined, excludeJobId: job.id }))}`;
      const resp = await fetch(url);
      const data = await resp.json();
      // tRPC v11 wraps response data in .result.data.json
      const jobs = data?.result?.data?.json ?? data?.result?.data ?? [];
      setCustomerHistoryJobs(jobs);
    } catch {
      setCustomerHistoryJobs([]);
    } finally {
      setCustomerHistoryLoading(false);
    }
  };

  const saveJobTags = async (job: Job, newTags: string[]) => {
    if (!allowLegacyJobAuthority) return;
    setSavingMeta(true);
    const tagsJson = JSON.stringify(newTags);
    persistJobs(jobs.map((j) => j.id === job.id ? { ...j, tags: newTags } : j));
    setSelectedJob((prev) => prev ? { ...prev, tags: newTags } : prev);
    try {
      await jobMetaMutation.mutateAsync({ jobId: job.id, tags: tagsJson });
    } catch { /* fail silently */ } finally { setSavingMeta(false); }
  };

  // savePrivateNotes removed — now handled by PrivateNotesCard component (per-author notes)

  const saveTaxAmount = async (job: Job, taxAmt: number) => {
    if (!allowLegacyJobAuthority) return;
    setSavingMeta(true);
    persistJobs(jobs.map((j) => j.id === job.id ? { ...j, taxAmount: taxAmt } : j));
    setSelectedJob((prev) => prev ? { ...prev, taxAmount: taxAmt } : prev);
    try {
      await jobMetaMutation.mutateAsync({ jobId: job.id, taxAmount: taxAmt.toFixed(2) });
    } catch { /* fail silently */ } finally { setSavingMeta(false); }
  };

  // Open the in-app continuous camera session
  const openCameraSession = async () => {
    if (!selectedJob) return;
    // If permission status is not yet determined, or not granted, always call
    // requestCameraPermission() which triggers the native iOS/Android dialog.
    // Only show our custom alert if the user has explicitly denied it already.
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        // Only show the alert if the user actively denied (canAskAgain = false means
        // they denied and checked "don't ask again", so guide them to Settings).
        if (!result.canAskAgain) {
          Alert.alert(
            "Camera Access Denied",
            "Please enable camera access in Settings > Privacy > Camera to take job photos.",
            [{ text: "OK" }]
          );
        }
        // If canAskAgain is true the native dialog was dismissed — just return silently.
        return;
      }
    }
    setCameraSessionPhotos([]);
    setShowCameraSession(true);
  };

  // Called when user taps the shutter button — captures photo and immediately adds to job
  const capturePhoto = async () => {
    if (!cameraRef.current || isCapturing || !selectedJob) return;
    setIsCapturing(true);
    const jobId = selectedJob.id;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, skipProcessing: false });
      if (!photo?.uri) return;
      const newUri = photo.uri;
      // Immediately append to session preview strip
      setCameraSessionPhotos((prev) => [...prev, newUri]);
      // Immediately append local URI to job photos for instant preview
      setSelectedJob((prev) => {
        if (!prev) return prev;
        const updatedPhotos = [...(prev.photos ?? []), newUri];
        const updated = jobsRef.current.map((j) => j.id === prev.id ? { ...j, photos: updatedPhotos } : j);
        persistJobs(updated);
        return { ...prev, photos: updatedPhotos };
      });
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Upload to S3 in background and replace local URI with S3 URL
      try {
        const s3Url = await uploadPhotoToS3(jobId, newUri);
        // Persist to jobsRef first so it survives even if the modal was closed
        const updatedJobs = jobsRef.current.map((j) => {
          if (j.id !== jobId) return j;
          const updatedPhotos = (j.photos ?? []).map((p) => p === newUri ? s3Url : p);
          const updatedPhotoUrls = [...new Set([...(j.photoUrls ?? []), s3Url])];
          return { ...j, photos: updatedPhotos, photoUrls: updatedPhotoUrls };
        });
        persistJobs(updatedJobs);
        setSelectedJob((prev) => {
          if (!prev || prev.id !== jobId) return prev;
          const updatedPhotos = (prev.photos ?? []).map((p) => p === newUri ? s3Url : p);
          const updatedPhotoUrls = [...new Set([...(prev.photoUrls ?? []), s3Url])];
          return { ...prev, photos: updatedPhotos, photoUrls: updatedPhotoUrls };
        });
      } catch (uploadErr: any) {
        // Upload failed — notify detailer so they can retry
        console.error('[capturePhoto] Upload failed:', uploadErr?.message);
        Alert.alert('Photo Upload Failed', 'The photo was captured but could not be saved to the server. Please try again or check your connection.');
      }
    } catch {
      // Ignore capture errors silently
    } finally {
      setIsCapturing(false);
    }
  };

  // Close camera session — photos are already saved to the job
  const closeCameraSession = () => {
    setShowCameraSession(false);
    setCameraSessionPhotos([]);
  };

  // Library picker — uploads to S3 for persistence
  const addPhotoFromLibrary = async () => {
    if (!selectedJob) return;
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsMultipleSelection: true, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (result.canceled) return;
    const newUris = result.assets.map((a) => a.uri);
    // Show local URIs immediately
    const updatedPhotos = [...(selectedJob.photos ?? []), ...newUris];
    const updated = jobsRef.current.map((j) => j.id === selectedJob.id ? { ...j, photos: updatedPhotos } : j);
    persistJobs(updated);
    setSelectedJob({ ...selectedJob, photos: updatedPhotos });
    // Upload each to S3 in background
    const jobId = selectedJob.id;
    setUploadingPhoto(true);
    try {
      const s3Urls = await Promise.all(newUris.map((uri) => uploadPhotoToS3(jobId, uri)));
      setSelectedJob((prev) => {
        if (!prev) return prev;
        let photos = [...(prev.photos ?? [])];
        newUris.forEach((uri, i) => {
          const idx = photos.indexOf(uri);
          if (idx !== -1) photos[idx] = s3Urls[i];
        });
        const photoUrls = [...(prev.photoUrls ?? []), ...s3Urls];
        const updatedJobs = jobsRef.current.map((j) => j.id === prev.id ? { ...j, photos, photoUrls } : j);
        persistJobs(updatedJobs);
        return { ...prev, photos, photoUrls };
      });
    } catch (uploadErr: any) {
      console.error('[addPhotoFromLibrary] Upload failed:', uploadErr?.message);
      Alert.alert('Photo Upload Failed', 'One or more photos could not be saved to the server. Please try again.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // ─── Video upload ─────────────────────────────────────────────────────────────
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const uploadVideoMutation = trpc.jobs.uploadVideo.useMutation();

  const addVideoFromLibrary = async () => {
    if (!selectedJob) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsMultipleSelection: false,
      videoMaxDuration: 120,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploadingVideo(true);
    try {
      let base64: string;
      if (Platform.OS === "web") {
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        const reader = new FileReader();
        base64 = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => {
            const r = reader.result as string;
            resolve(r.split(",")[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      }
      const mimeType = asset.mimeType ?? "video/mp4";
      const result2 = await uploadVideoMutation.mutateAsync({ jobId: selectedJob.id, base64, mimeType });
      const updatedVideoUrls = result2.urls;
      const updated = jobs.map((j) => j.id === selectedJob.id ? { ...j, videoUrls: updatedVideoUrls } : j);
      persistJobs(updated);
      setSelectedJob({ ...selectedJob, videoUrls: updatedVideoUrls });
    } catch (e) {
      Alert.alert("Upload failed", "Could not upload video. Please try again.");
    } finally {
      setUploadingVideo(false);
    }
  };

  const deleteVideoMutation = trpc.jobs.deleteVideo.useMutation();

  const deleteVideo = (url: string) => {
    if (!selectedJob) return;
    Alert.alert("Delete Video", "Remove this video?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await deleteVideoMutation.mutateAsync({ jobId: selectedJob.id, url });
          const updatedVideoUrls = (selectedJob.videoUrls ?? []).filter((v) => v !== url);
          const updated = jobs.map((j) => j.id === selectedJob.id ? { ...j, videoUrls: updatedVideoUrls } : j);
          persistJobs(updated);
          setSelectedJob({ ...selectedJob, videoUrls: updatedVideoUrls });
        } catch {}
      }},
    ]);
  };

  const deletePhoto = (uri: string) => {
    if (!selectedJob) return;
    Alert.alert("Delete Photo", "Remove this photo?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => {
        const updatedPhotos = (selectedJob.photos ?? []).filter((p) => p !== uri);
        const updated = jobs.map((j) => j.id === selectedJob.id ? { ...j, photos: updatedPhotos } : j);
        persistJobs(updated);
        setSelectedJob({ ...selectedJob, photos: updatedPhotos });
      }},
    ]);
  };

  const handlePaymentComplete = (payment: PaymentRecord) => {
    if (!allowLegacyJobAuthority) {
      Alert.alert("Payments unavailable", COMPANY_LEGACY_FALLTHROUGH_BLOCKED);
      setShowCheckout(false);
      return;
    }
    // selectedJob may be null if the detail modal was dismissed before checkout opened (iOS modal stacking fix)
    const job = selectedJob ?? checkoutJobRef.current;
    if (!job) return;
    const updated = jobs.map((j) => j.id === job.id ? { ...j, payment, status: "finished" as JobStatus } : j);
    persistJobs(updated);
    const updatedJob = { ...job, payment, status: "finished" as JobStatus };
    setShowCheckout(false);
    // Sync completed status + tips to server DB
    // Always update schedule_jobs for jobs that have a real DB ID (not portal_ or online_ prefix).
    // isOnlineBooking=true but id=sj.jobId means the job IS in schedule_jobs and tips must be saved there.
    // online_ jobs ARE in schedule_jobs — only portal_ uses a separate path
    const hasDbJobId = !job.id.startsWith("portal_");
    if (hasDbJobId) {
      jobStatusMutation.mutate({ jobId: job.id, status: "completed", tips: payment.tipAmount, upsellTotal: updatedJob.upsellTotal ?? 0 });
      // Save full payment record to schedule_jobs so the card shows as paid and the red ring disappears
      jobSavePaymentMutation.mutate({
        jobId: job.id,
        method: payment.method,
        subtotal: payment.subtotal,
        tipAmount: payment.tipAmount,
        total: payment.total,
        paidAt: payment.paidAt,
        paymentIntentId: payment.paymentIntentId,
        referenceNote: payment.referenceNote,
      });
    }
    // For portal_ jobs: save payment to customer_bookings so the customer sees it as paid
    if (job.id.startsWith("portal_") && job.bookingId) {
      portalBookingPaymentMutation.mutate({
        bookingRef: job.bookingId,
        paymentMethod: payment.method,
        paymentIntentId: payment.paymentIntentId ?? null,
        paymentTotal: payment.total.toFixed(2),
        paymentPaidAt: payment.paidAt,
      });
    }
    // Push revenue + tips to daily performance record so dashboard updates automatically
    if (employee && allowLegacyJobAuthority) {
      const jobDate = getWeekDates(job.weekOffset)[job.dayIndex];
      const dateStr = localDateStr(jobDate);
      // Use the same record ID format as syncPerformanceFromJobs on the server (underscores, no dashes in date)
      // so tips merge into the same record as revenue instead of creating a duplicate.
      const recordId = `PERF_${employee.employeeId}_${dateStr.replace(/-/g, '')}`;
      // Fetch existing performance for that day to add on top
      fetch(
        `${APP_API_BASE}/api/trpc/performance.getByDate?input=${encodeURIComponent(JSON.stringify({ employeeId: employee.employeeId, date: dateStr }))}`
      ).then((r) => r.json()).then((existingPerf) => {
        // tRPC response format: { result: { data: { json: [...] } } }
        const perfRows = existingPerf?.result?.data?.json ?? existingPerf?.result?.data ?? [];
        const existingRevenue = Number(Array.isArray(perfRows) ? (perfRows[0]?.revenueProduced ?? 0) : 0);
        const existingTips = Number(Array.isArray(perfRows) ? (perfRows[0]?.tips ?? 0) : 0);
        const existingUpsells = Number(Array.isArray(perfRows) ? (perfRows[0]?.upsells ?? 0) : 0);
        // Revenue = actual collected amount (base + upsell total - discount). Upsell bonus = per-employee % of upsell only.
        const fullJobRevenue = Math.max(0, updatedJob.price - (updatedJob.discountAmount ?? 0)); // price includes upsellTotal; subtract discount
        const empUpsellRate = (employee?.upsellBonusPct ?? 40) / 100;
        const upsellBonusForJob = (updatedJob.upsellTotal ?? 0) * empUpsellRate;
        performanceUpsertMutation.mutate({
          recordId,
          date: dateStr,
          employeeId: employee.employeeId,
          fullName: employee.fullName,
          city: employee.city ?? undefined,
          revenueProduced: (existingRevenue + fullJobRevenue).toFixed(2),
          tips: (existingTips + payment.tipAmount).toFixed(2),
          upsells: (existingUpsells + upsellBonusForJob).toFixed(2), // 40% bonus of upsells
        });
        utils.performance.getDateRange.invalidate();
      }).catch(() => {
        // Fail silently — performance update is best-effort
      });
    }
    Alert.alert("Payment Complete ✓", `${PAYMENT_METHOD_LABELS[payment.method]} · $${payment.total.toFixed(2)}${payment.tipAmount > 0 ? ` (incl. $${payment.tipAmount.toFixed(2)} tip)` : ""}\nJob marked as finished.`, [{ text: "OK" }]);
  };

  // ─── Refund Handler ─────────────────────────────────────────────────────────
  const handleRefund = async () => {
    if (!allowLegacyJobAuthority || !selectedJob?.payment) return;
    const { payment } = selectedJob;
    const amountStr = payment.total.toFixed(2);
    Alert.alert(
      "Issue Refund",
      `Refund $${amountStr} to this customer?${payment.method !== "credit_debit" ? "\n\nNote: This was a ${PAYMENT_METHOD_LABELS[payment.method]} payment — record the manual refund separately." : ""}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Refund $" + amountStr,
          style: "destructive",
          onPress: async () => {
            setIsRefunding(true);
            try {
              const piId = payment.paymentIntentId;
              if (payment.method === "credit_debit" && piId && !piId.startsWith("expo-go") && !piId.startsWith("web-")) {
                // Real Stripe refund
                const result = await refundPaymentMutation.mutateAsync({
                  paymentIntentId: piId,
                  reason: "requested_by_customer",
                });
                const refundedPayment: PaymentRecord = { ...payment, refundedAt: new Date().toISOString(), refundId: result.refundId };
                const updated = jobs.map((j) => j.id === selectedJob.id ? { ...j, payment: refundedPayment } : j);
                persistJobs(updated);
                setSelectedJob({ ...selectedJob, payment: refundedPayment });
                Alert.alert("Refund Issued ✓", `$${amountStr} refunded via Stripe.\nRefund ID: ${result.refundId}`);
              } else {
                // Cash / check / manual — just mark as refunded locally
                const refundedPayment: PaymentRecord = { ...payment, refundedAt: new Date().toISOString(), refundId: "manual" };
                const updated = jobs.map((j) => j.id === selectedJob.id ? { ...j, payment: refundedPayment } : j);
                persistJobs(updated);
                setSelectedJob({ ...selectedJob, payment: refundedPayment });
                Alert.alert("Refund Recorded", `$${amountStr} refund recorded. Please issue the physical refund manually.`);
              }
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : "Refund failed";
              Alert.alert("Refund Failed", msg);
            } finally {
              setIsRefunding(false);
            }
          },
        },
      ]
    );
  };

  // ─── Upsell Save Handler ─────────────────────────────────────────────────────
  const saveUpsells = async () => {
    if (!selectedJob || !employee) return;
    setSavingUpsells(true);
    try {
      // Calculate totals from catalog addons
      const catalogTotal = upsellIds.reduce((sum, id) => {
        const ad = ADDONS.find((a) => a.id === id);
        if (!ad) return sum;
        return sum + ad.price * (upsellQtys[id] ?? 1);
      }, 0);
      // Add custom upsell if provided
      const customTotal = customUpsellName.trim() && parseFloat(customUpsellPrice) > 0
        ? parseFloat(customUpsellPrice)
        : 0;
      const total = catalogTotal + customTotal;
      const empUpsellBonusRate = (employee?.upsellBonusPct ?? 40) / 100;
      const bonus = total * empUpsellBonusRate;

      // Preserve the original base price (before any upsells) so we can always restore it.
      // On first save, basePrice = current price. On subsequent saves, use stored basePrice.
      const basePrice = selectedJob.basePrice ?? selectedJob.price;
      // Update job record locally — REPLACE upsell total (not accumulate)
      const updatedJob: Job = {
        ...selectedJob,
        price: basePrice, // always restore to base price; Line Items card adds upsellTotal on top
        basePrice,
        upsellIds,
        upsellQtys,
        upsellTotal: total, // replace, not accumulate
        upsellBonus: bonus,
      };
      const updatedJobs = jobs.map((j) => j.id === selectedJob.id ? updatedJob : j);
      persistJobs(updatedJobs);
      setSelectedJob(updatedJob);

      // Sync full job to DB (creates/updates the row, including upsellTotal and totalPrice)
      // This ensures the job exists in the DB even if it was only in AsyncStorage before.
      syncJobToServer(updatedJob);
      // Also update status + upsellTotal via the status mutation so syncPerformanceFromJobs fires
      jobStatusMutation.mutate({
        jobId: updatedJob.id,
        status: updatedJob.status === 'finished' ? 'completed' : 'in_progress',
        upsellTotal: updatedJob.upsellTotal ?? 0,
        upsellIds: updatedJob.upsellIds ?? [],
        upsellQtys: updatedJob.upsellQtys ?? {},
      });
      // syncPerformanceFromJobs runs server-side after updateScheduleJobStatus,
      // so no need to manually upsert PERF- record here — just invalidate the cache
      utils.performance.getDateRange.invalidate();
      // Reset upsell state
      setUpsellIds([]);
      setUpsellQtys({});
      setCustomUpsellName("");
      setCustomUpsellPrice("");
      setShowUpsellPanel(false);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const alertMsg = total > 0
        ? `Upsell total: $${total.toFixed(2)}`
        : "All upsells removed from this job.";
      Alert.alert(total > 0 ? "Upsells Saved! 🎉" : "Upsells Removed", alertMsg, [{ text: "OK" }]);
    } catch (e) {
      Alert.alert("Error", "Failed to save upsells. Please try again.");
    } finally {
      setSavingUpsells(false);
    }
  };
  // ─────────────────────────────────────────────────────────────────────────────

  // ─── Save Recommendations ────────────────────────────────────────────────────
  const saveRecommendations = async () => {
    if (!selectedJob) return;
    setSavingRecs(true);
    try {
      const updatedJob: Job = { ...selectedJob, recommendedIds: pendingRecIds };
      const updatedJobs = jobs.map((j) => j.id === selectedJob.id ? updatedJob : j);
      persistJobs(updatedJobs);
      setSelectedJob(updatedJob);
      // Sync to server
      syncJobToServer(updatedJob);
      setShowRecsPanel(false);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert("Error", "Failed to save recommendations. Please try again.");
    } finally {
      setSavingRecs(false);
    }
  };
  // ─────────────────────────────────────────────────────────────────────────────

  const handleMoveJob = useCallback((jobId: string, newStartHour: number) => {
    setJobs((prev) => {
      const job = prev.find((j) => j.id === jobId);
      if (!job) return prev;
      const duration = Math.max(1, job.endHour - job.startHour);
      const newEndHour = Math.min(newStartHour + duration, HOURS[HOURS.length - 1] + 1);
      const updated = prev.map((j) => j.id === jobId ? { ...j, startHour: newStartHour, endHour: newEndHour } : j);
      AsyncStorage.setItem(storageKeyRef.current, JSON.stringify(updated));
      // Sync moved job to server (fire-and-forget)
      if (!job.isOnlineBooking) {
        jobUpsertMutation.mutate({
          jobId: job.id,
          location: job.location ?? "crestview",
          date: localDateStr(getWeekDates(job.weekOffset)[job.dayIndex]),
          startHour: newStartHour,
          endHour: newEndHour,
          timeSlot: `${formatHour(newStartHour)} - ${formatHour(newEndHour)}`,
        });
      }
      return updated;
    });
  }, [jobUpsertMutation]);

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
  // serviceTitle is set automatically when a package is selected; allow save even if skipped
  const isFormValid = firstName.trim() && lastName.trim() && address.trim();

  // Dot indicators for week strip
  const myJobSlug = employee?.city ? cityToSlug(employee.city) : "crestview";
  const isAdminRole = employee?.role === "admin" || employee?.role === "operations_manager" || employee?.role === "office";
  const isCompanyCalendarManager = isJobSyncCompany && (jobSyncSession?.user.role === "owner" || jobSyncSession?.user.role === "dispatcher");
  const { data: detailerList, isLoading: detailersLoading } = trpc.employee.listDetailers.useQuery(undefined, { enabled: isAdminRole && allowLegacyJobAuthority, staleTime: 300000 });
  // Price book for New Job form
  const { data: localPbData } = trpc.pricebook.list.useQuery(undefined, { enabled: allowLegacyJobAuthority, staleTime: 60_000 });
  const pbData = isJobSyncCompany ? companyPriceBook.services : localPbData;
  const allJobPackages: PackageDef[] = pbData && pbData.length > 0
    ? pbData.map((s) => {
        const vp = s.vehiclePrices as Record<string, number>;
        const isRv = s.serviceId.startsWith("pb_rv") ||
          ((vp.rv_20_29 ?? 0) > 0 || (vp.rv_30_39 ?? 0) > 0 || (vp.rv_40_plus ?? 0) > 0);
        return {
          id: s.serviceId,
          title: s.name,
          emoji: s.emoji,
          tagline: s.description || "",
          features: s.features,
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
    : isJobSyncCompany ? [] : PACKAGES;
  const myName = employee?.fullName?.toLowerCase() ?? "";
  const myId = employee?.employeeId ?? "";
  const visibleJobs = jobs.filter((j) => {
    if (isAdminRole) return !j.location || j.location.toLowerCase() === selectedLocation.toLowerCase();
    // Detailer view: only show jobs explicitly assigned to this detailer.
    // Jobs with no detailerName are NOT shown to detailers — they belong to other detailers
    // or are unassigned admin jobs. This prevents stale/other-detailer jobs from leaking
    // into a detailer's schedule via AsyncStorage.
    if (!j.detailerName) return false;
    const dn = j.detailerName.toLowerCase();
    // Match by employeeId (new jobs) OR by name string (legacy jobs)
    if (myId && (dn === myId.toLowerCase() || j.detailerName === myId)) return true;
    if (dn === myName || dn === myName.split(" ")[0] || myName.startsWith(dn)) return true;
    return false;
  });
  const jobsByDay = weekDates.map((_, i) => visibleJobs.some((j) => j.dayIndex === i && j.weekOffset === weekOffset));

  return (
    <View style={{ flex: 1 }}>
    <ScreenContainer edges={["left", "right"]} containerClassName="bg-background">
        {/* Header */}
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <Text style={[s.title, { color: colors.foreground }]}>Schedule</Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            {isSyncingBookings
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <TouchableOpacity
                  onPress={() => syncOnlineBookings(selectedLocation)}
                  style={[s.todayBtn, { borderColor: colors.border }]}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 15, color: colors.muted }}>↻</Text>
                </TouchableOpacity>
            }
            <TouchableOpacity onPress={goToToday} style={[s.todayBtn, { borderColor: colors.primary }]}>
              <Text style={[s.todayBtnText, { color: colors.primary }]}>Today</Text>
            </TouchableOpacity>
            {isAdminRole && (
              <TouchableOpacity onPress={() => openAdd(8, 9)} style={[s.addBtn, { backgroundColor: colors.primary }]}>
                <Text style={s.addBtnText}>+</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {isJobSyncCompany && companyJobsError ? (
          <Text style={{ color: colors.muted, fontSize: 13, paddingHorizontal: 16, paddingVertical: 8 }}>{companyJobsError}</Text>
        ) : null}

        {/* Location Selector — only shown for admins; detailers see their own city label */}
        {(employee?.role === "admin" || employee?.role === "operations_manager" || employee?.role === "office") && allowLegacyJobAuthority ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
            contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: "row" }}
          >
            {LOCATIONS.map((loc) => {
              const isSelected = selectedLocation === loc.slug;
              return (
                <TouchableOpacity
                  key={loc.slug}
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedLocation(loc.slug);
                  }}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 7,
                    borderRadius: 20,
                    backgroundColor: isSelected ? colors.primary : colors.surface,
                    borderWidth: 1,
                    borderColor: isSelected ? colors.primary : colors.border,
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={{ fontSize: 13, fontWeight: isSelected ? "700" : "500", color: isSelected ? "#fff" : colors.foreground }}>
                    {loc.label}
                  </Text>
                  {loc.capacity > 1 && (
                    <Text style={{ fontSize: 10, color: isSelected ? "rgba(255,255,255,0.75)" : colors.muted, textAlign: "center", marginTop: 1 }}>
                      {loc.capacity} vans
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        {/* Week Strip — swipe left/right to change weeks */}
        <GestureDetector gesture={weekSwipeGesture}>
        <View style={[s.weekStrip, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => setWeekOffset((w) => w - 1)} style={s.weekArrow}>
            <Text style={{ color: colors.primary, fontSize: 20 }}>‹</Text>
          </TouchableOpacity>
          {WEEK_DAYS_SHORT.map((d, i) => {
            const date = weekDates[i];
            const isToday = weekOffset === 0 && i === todayDayIndex();
            const isSelected = i === selectedDay;
            const hasDot = jobsByDay[i];
            return (
              <TouchableOpacity key={i} onPress={() => setSelectedDay(i)} style={s.weekDayCell}>
                <Text style={[s.weekDayName, { color: isSelected ? colors.primary : colors.muted }]}>{d}</Text>
                <View style={[s.weekDayNumCircle, {
                  backgroundColor: isSelected ? colors.primary : "transparent",
                  borderWidth: isToday && !isSelected ? 1.5 : 0,
                  borderColor: colors.primary,
                }]}>
                  <Text style={[s.weekDayNum, { color: isSelected ? "#fff" : isToday ? colors.primary : colors.foreground }]}>
                    {date.getDate()}
                  </Text>
                </View>
                {hasDot && !isSelected && (
                  <View style={[s.dayDot, { backgroundColor: colors.primary }]} />
                )}
              </TouchableOpacity>
            );
          })}
                    <TouchableOpacity onPress={() => setWeekOffset((w) => w + 1)} style={s.weekArrow}>
            <Text style={{ color: colors.primary, fontSize: 20 }}>›</Text>
          </TouchableOpacity>
        </View>
        </GestureDetector>
        {/* Day Label with swipe arrows */}
        <View style={[s.dayLabel, { borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
          <TouchableOpacity
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (selectedDay > 0) {
                setSelectedDay(selectedDay - 1);
              } else {
                setWeekOffset((w) => w - 1);
                setSelectedDay(6);
              }
            }}
            style={{ padding: 8 }}
            activeOpacity={0.6}
          >
            <Text style={{ color: colors.primary, fontSize: 22, fontWeight: "600" }}>‹</Text>
          </TouchableOpacity>
          <Text style={[s.dayLabelText, { color: colors.foreground }]}>{formatFullDate(selectedDate)}</Text>
          <TouchableOpacity
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (selectedDay < 6) {
                setSelectedDay(selectedDay + 1);
              } else {
                setWeekOffset((w) => w + 1);
                setSelectedDay(0);
              }
            }}
            style={{ padding: 8 }}
            activeOpacity={0.6}
          >
            <Text style={{ color: colors.primary, fontSize: 22, fontWeight: "600" }}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Timeline */}
        {isAdminRole || isCompanyCalendarManager ? (
          // Show a loading spinner until detailerList is available so jobs never
          // flicker into the wrong column before the real column order arrives.
          detailersLoading || (!isJobSyncCompany && !detailerList) || (isJobSyncCompany && companyCalendarMembersLoading) ? (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
          // Admin: multi-column dispatch board — one column per detailer at this location
          <AdminDispatchBoard
            jobs={isJobSyncCompany ? jobs : jobs.filter((j) => !j.location || j.location.toLowerCase() === selectedLocation.toLowerCase())}
            weekOffset={weekOffset}
            dayIndex={selectedDay}
            detailers={
              isJobSyncCompany
                ? companyCalendarMembers
                    .filter((member) => member.isActive && member.calendarEligible)
                    .map((member) => ({ employeeId: String(member.id), fullName: member.city ? `${member.name} · ${member.city}` : member.name }))
                : (detailerList as any[] | undefined ?? []).filter((d: any) =>
                    d.city ? cityToSlug(d.city) === selectedLocation : true
                  ).map((d: any) => ({ employeeId: d.employeeId, fullName: d.fullName }))
            }
            onJobPress={(job) => setSelectedJob(job)}
            onCreateJob={(sh, eh, detailerId) => {
              openAdd(sh, eh);
              if (detailerId) setAssignedDetailerId(detailerId);
            }}
            onSwipeLeft={() => {
              if (selectedDay < 6) setSelectedDay(selectedDay + 1);
              else { setWeekOffset((w) => w + 1); setSelectedDay(0); }
            }}
            onSwipeRight={() => {
              if (selectedDay > 0) setSelectedDay(selectedDay - 1);
              else { setWeekOffset((w) => w - 1); setSelectedDay(6); }
            }}
          />
          )
        ) : (
          // Detailer: single-column personal timeline
          <DayTimeline
            jobs={(() => {
              const mySlug = employee?.city ? cityToSlug(employee.city) : "crestview";
              const myId = employee?.employeeId ?? "";
              const myName = employee?.fullName?.toLowerCase() ?? "";
              return jobs.filter((j) => {
                if (j.detailerName && myId && j.detailerName === myId) return true;
                if (j.detailerName && myName) {
                  const dn = j.detailerName.toLowerCase();
                  if (dn === myName || dn === myName.split(" ")[0] || myName.startsWith(dn)) return true;
                }
                if (!j.detailerName && j.location) return j.location.toLowerCase() === mySlug.toLowerCase();
                if (!j.detailerName && !j.location) return true;
                return false;
              });
            })()}
            weekOffset={weekOffset}
            dayIndex={selectedDay}
            onCreateJob={(sh, eh) => openAdd(sh, eh)}
            onMoveJob={handleMoveJob}
            onJobPress={(job) => setSelectedJob(job)}
            onSwipeLeft={() => {
              if (selectedDay < 6) setSelectedDay(selectedDay + 1);
              else { setWeekOffset((w) => w + 1); setSelectedDay(0); }
            }}
            onSwipeRight={() => {
              if (selectedDay > 0) setSelectedDay(selectedDay - 1);
              else { setWeekOffset((w) => w - 1); setSelectedDay(6); }
            }}
            canDrag={false}
            onRefresh={handleRefresh}
            refreshing={isRefreshing}
          />
        )}

      </ScreenContainer>

      {/* Job Detail Modal - rendered outside ScreenContainer to prevent z-index conflicts */}
      <Modal visible={!!selectedJob} animationType="slide" transparent={false} onRequestClose={() => { setSelectedJob(null); setShowUpsellPanel(false); setUpsellIds([]); setUpsellQtys({}); }}>
          <View style={{ flex: 1, backgroundColor: colors.surface }}>
            <View style={{ flex: 1 }}>
              {selectedJob && (
                <>
                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* ─── Street View Hero ─── */}
                  {selectedJob.address ? (
                    <View style={{ position: "relative", height: 320, marginBottom: 0 }}>
                     <Image
                         source={{ uri: `https://maps.googleapis.com/maps/api/streetview?size=800x400&location=${encodeURIComponent(selectedJob.address)}&fov=90&pitch=10&key=${(Constants.expoConfig?.extra?.googleMapsApiKey as string) || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || ""}` }}
                         style={{ width: "100%", height: 320 }}
                         resizeMode="cover"
                       />
                      {/* Gradient overlay for readability */}
                      <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 60 }} />
                      {/* Close button */}
                      <TouchableOpacity
                        onPress={() => { setSelectedJob(null); setShowUpsellPanel(false); setUpsellIds([]); setUpsellQtys({}); }}
                        style={{ position: "absolute", top: 52, right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 6, elevation: 6 }}
                      >
                        <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700" }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 56, marginBottom: 4 }}>
                      <Text style={[s.modalTitle, { color: colors.foreground }]}>Job Details</Text>
                      <TouchableOpacity onPress={() => { setSelectedJob(null); setShowUpsellPanel(false); setUpsellIds([]); setUpsellQtys({}); }}><Text style={{ color: colors.muted, fontSize: 24 }}>✕</Text></TouchableOpacity>
                    </View>
                  )}
                  <View style={{ paddingTop: selectedJob.address ? 12 : 0 }}>

                  <View style={[s.detailCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    {selectedJob.isOnlineBooking && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.primary + "18", borderRadius: 8, borderWidth: 1, borderColor: colors.primary + "40", alignSelf: "flex-start" }}>
                        <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "700" }}>🌐 Online Booking</Text>
                        {selectedJob.location && <Text style={{ fontSize: 11, color: colors.muted }}>· {LOCATIONS.find(l => l.slug === selectedJob.location)?.label || selectedJob.location}</Text>}
                      </View>
                    )}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 }}>
                      <View style={[s.statusDot, { backgroundColor: STATUS_COLOR[selectedJob.status] }]} />
                      <Text style={[s.sectionTitle, { color: colors.foreground }]}>{STATUS_LABELS[selectedJob.status]}</Text>
                      {selectedJob.payment ? (
                        <View style={[s.paidBadgeLarge, { backgroundColor: "#22C55E22", borderColor: "#22C55E55" }]}>
                          <Text style={{ color: "#22C55E", fontWeight: "700", fontSize: 12 }}>✓ PAID</Text>
                        </View>
                      ) : (
                        <View style={[s.paidBadgeLarge, { backgroundColor: "#EF444422", borderColor: "#EF444455" }]}>
                          <Text style={{ color: "#EF4444", fontWeight: "700", fontSize: 12 }}>UNPAID</Text>
                        </View>
                      )}
                    </View>
                    {/* Live timer display — always show once travel has started */}
                    {(selectedJob.travelStartedAt) && (
                      <View style={{ flexDirection: "row", gap: 10, marginBottom: 12, justifyContent: "center" }}>
                        {selectedJob.travelStartedAt && (
                          <View style={{ backgroundColor: "#F59E0B22", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, alignItems: "center", borderWidth: 1, borderColor: "#F59E0B55" }}>
                            <Text style={{ color: "#F59E0B", fontSize: 10, fontWeight: "700", letterSpacing: 1 }}>🚚 TRAVEL</Text>
                            <Text style={{ color: "#F59E0B", fontSize: 20, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
                              {timerTick >= 0 && (selectedJob.arrivedAt
                                ? (() => { const secs = Math.floor((new Date(selectedJob.arrivedAt!).getTime() - new Date(selectedJob.travelStartedAt!).getTime()) / 1000); const h = Math.floor(secs / 3600); const m = Math.floor((secs % 3600) / 60); const s = secs % 60; return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`; })()
                                : formatElapsed(selectedJob.travelStartedAt))}
                            </Text>
                            <Text style={{ color: "#F59E0B", fontSize: 9, opacity: 0.8 }}>{selectedJob.arrivedAt ? "DONE" : "LIVE"}</Text>
                          </View>
                        )}
                        {selectedJob.jobStartedAt && (
                          <View style={{ backgroundColor: "#10B98122", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, alignItems: "center", borderWidth: 1, borderColor: "#10B98155" }}>
                            <Text style={{ color: "#10B981", fontSize: 10, fontWeight: "700", letterSpacing: 1 }}>▶️ JOB TIME</Text>
                            <Text style={{ color: "#10B981", fontSize: 20, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
                              {selectedJob.jobFinishedAt
                                ? (() => { const secs = Math.floor((new Date(selectedJob.jobFinishedAt).getTime() - new Date(selectedJob.jobStartedAt!).getTime()) / 1000); const h = Math.floor(secs / 3600); const m = Math.floor((secs % 3600) / 60); const s = secs % 60; return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`; })()
                                : (timerTick >= 0 ? formatElapsed(selectedJob.jobStartedAt) : "0:00")}
                            </Text>
                            <Text style={{ color: "#10B981", fontSize: 9, opacity: 0.8 }}>{selectedJob.jobFinishedAt ? "DONE" : "LIVE"}</Text>
                          </View>
                        )}
                      </View>
                    )}
                    {/* 3-step status buttons: ON MY WAY → ARRIVED → FINISH */}
                    <View style={{ flexDirection: "row", justifyContent: "space-around", alignItems: "center" }}>
                      {([
                        { label: "ON MY WAY", emoji: "🚚", activeStatus: "on_my_way" as JobStatus, requiredStatus: "scheduled" as JobStatus },
                        { label: "ARRIVED",   emoji: "📍", activeStatus: "arrived"   as JobStatus, requiredStatus: "on_my_way" as JobStatus },
                        { label: "FINISH",    emoji: "⏹️", activeStatus: "finished"  as JobStatus, requiredStatus: "arrived"   as JobStatus },
                      ] as { label: string; emoji: string; activeStatus: JobStatus; requiredStatus: JobStatus }[]).map(({ label, emoji, activeStatus, requiredStatus }) => (
                        <TouchableOpacity key={label} onPress={() => {
                          if (selectedJob.status !== requiredStatus) return;
                          if (activeStatus === "arrived") {
                            Alert.alert(
                              "Mark as Arrived?",
                              "Only tap Arrived when you are physically at the customer location.",
                              [
                                { text: "Not Yet", style: "cancel" },
                                { text: "Yes, I've Arrived", style: "default", onPress: () => advanceStatus(selectedJob) },
                              ]
                            );
                          } else {
                            advanceStatus(selectedJob);
                          }
                        }} style={{ alignItems: "center", opacity: selectedJob.status === requiredStatus ? 1 : 0.35 }}>
                          <View style={[s.statusIconCircle, { backgroundColor: selectedJob.status === activeStatus ? STATUS_COLOR[activeStatus] : colors.surface, borderColor: selectedJob.status === activeStatus ? STATUS_COLOR[activeStatus] : colors.border }]}>
                            <Text style={{ fontSize: 22 }}>{emoji}</Text>
                          </View>
                          <Text style={[s.statusIconLabel, { color: STATUS_COLOR[activeStatus], fontSize: 9 }]}>{label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {/* Running Late button — shown for all active today jobs */}
                    {selectedJob.status !== "finished" && (
                      <TouchableOpacity
                        onPress={() => { setLateSheetJob(selectedJob); setLateDelayMinutes(30); setLateCustomMinutes(''); setShowLateSheet(true); }}
                        style={{
                          flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                          backgroundColor: lateNotifiedJobIds.has(selectedJob.id) ? "#22C55E22" : "#EF444422",
                          borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16,
                          borderWidth: 1, borderColor: lateNotifiedJobIds.has(selectedJob.id) ? "#22C55E" : "#EF4444",
                          marginTop: 4,
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 18 }}>{lateNotifiedJobIds.has(selectedJob.id) ? "✓" : "🔴"}</Text>
                        <Text style={{ fontSize: 14, fontWeight: "700", color: lateNotifiedJobIds.has(selectedJob.id) ? "#22C55E" : "#EF4444" }}>
                          {lateNotifiedJobIds.has(selectedJob.id) ? "Customer Notified · Update ETA" : "Running Late? Notify Customer"}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {/* Running Late History */}
                    {(lateHistoryQ.data && lateHistoryQ.data.length > 0) && (
                      <View style={{ marginTop: 8, backgroundColor: "#EF444410", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#EF444430" }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: "#EF4444", letterSpacing: 0.8, marginBottom: 8 }}>🔴 RUNNING LATE HISTORY</Text>
                        {(lateHistoryQ.data as any[]).map((h: any, i: number) => (
                          <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 4, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: "#EF444430" }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13, color: "#EF4444", fontWeight: "600" }}>+{h.delay_minutes} min delay · ETA {h.new_eta}</Text>
                              <Text style={{ fontSize: 11, color: "#EF444499", marginTop: 1 }}>Sent by {h.detailer_name}</Text>
                            </View>
                            <Text style={{ fontSize: 11, color: "#EF444499", marginLeft: 8 }}>{new Date(h.sent_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {allowLegacyJobAuthority ? !selectedJob.payment ? (
                      <TouchableOpacity
                        onPress={() => {
                          checkoutJobRef.current = selectedJob;
                          // Close job detail first — iOS cannot stack two modals reliably
                          setSelectedJob(null);
                          setShowUpsellPanel(false);
                          setUpsellIds([]);
                          setUpsellQtys({});
                          setTimeout(() => setShowCheckout(true), 350);
                        }}
                        style={[s.payBtn, { backgroundColor: "#22C55E" }]}
                        activeOpacity={0.8}
                      >
                        <Text style={s.payBtnText}>💳  Collect Payment  ·  ${Math.max(0, (selectedJob.price ?? 0) + (selectedJob.upsellTotal ?? 0) - (selectedJob.discountAmount ?? 0)).toFixed(2)}</Text>
                      </TouchableOpacity>
                    ) : (
                      <View>
                        <View style={[s.paymentSummary, { backgroundColor: selectedJob.payment.refundedAt ? "#EF444418" : "#22C55E18", borderColor: selectedJob.payment.refundedAt ? "#EF444444" : "#22C55E44" }]}>
                          {selectedJob.payment.refundedAt ? (
                            <Text style={{ color: "#EF4444", fontWeight: "700", fontSize: 14 }}>↩ Refunded — ${selectedJob.payment.total.toFixed(2)}</Text>
                          ) : (
                            <Text style={{ color: "#22C55E", fontWeight: "700", fontSize: 14 }}>✓ Payment Received — ${selectedJob.payment.total.toFixed(2)}</Text>
                          )}
                          <Text style={{ color: selectedJob.payment.refundedAt ? "#EF4444" : "#22C55E", fontSize: 12, marginTop: 2 }}>{PAYMENT_METHOD_ICONS[selectedJob.payment.method]} {PAYMENT_METHOD_LABELS[selectedJob.payment.method]}{selectedJob.payment.cardLast4 ? ` ···· ${selectedJob.payment.cardLast4}` : ""}</Text>
                          {selectedJob.payment.tipAmount > 0 && <Text style={{ color: selectedJob.payment.refundedAt ? "#EF4444" : "#22C55E", fontSize: 12, marginTop: 1 }}>Service ${selectedJob.payment.subtotal.toFixed(2)} + Tip ${selectedJob.payment.tipAmount.toFixed(2)}</Text>}
                          <Text style={{ color: selectedJob.payment.refundedAt ? "#EF4444" : "#22C55E", fontSize: 11, marginTop: 2, opacity: 0.8 }}>{new Date(selectedJob.payment.paidAt).toLocaleString("en-US", { timeZone: "America/Chicago", month: "numeric", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</Text>
                          {selectedJob.payment.refundedAt && (
                            <Text style={{ color: "#EF4444", fontSize: 11, marginTop: 2, opacity: 0.8 }}>Refunded {new Date(selectedJob.payment.refundedAt).toLocaleString("en-US", { timeZone: "America/Chicago", month: "numeric", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</Text>
                          )}
                        </View>
                        {isAdminRole && !selectedJob.payment.refundedAt && (
                          <TouchableOpacity
                            onPress={handleRefund}
                            disabled={isRefunding}
                            style={{ marginTop: 8, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: "#EF444444", backgroundColor: "#EF444412", alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }}
                            activeOpacity={0.75}
                          >
                            {isRefunding ? (
                              <ActivityIndicator size="small" color="#EF4444" />
                            ) : (
                              <Text style={{ color: "#EF4444", fontWeight: "600", fontSize: 14 }}>↩  Issue Refund</Text>
                            )}
                          </TouchableOpacity>
                        )}
                      </View>
                    ) : (
                      {isJobSyncCompany && jobSyncSession?.token && canonicalJobId(selectedJob.id) ? (
                        <CompanyCollectPayment
                          token={jobSyncSession.token}
                          jobId={canonicalJobId(selectedJob.id)!}
                          role={jobSyncSession.user.role}
                          authority={companyAuthority}
                          amount={selectedJob.price}
                          paidTotal={Number((selectedJob as Job & { paidTotal?: number }).paidTotal || 0)}
                          balance={Number((selectedJob as Job & { balance?: number }).balance ?? selectedJob.price) || 0}
                          paymentStatus={(selectedJob as Job & { paymentStatus?: string }).paymentStatus}
                          jobStatus={(selectedJob as Job & { _rawStatus?: string })._rawStatus}
                          onCanonicalRefresh={async () => {
                            invalidateCanonicalSurfaces();
                            await refreshCompanyData({ force: true });
                          }}
                        />
                      ) : (
                        <View style={[s.paymentSummary, { backgroundColor: "#0a7ea418", borderColor: "#0a7ea444" }]}>
                          <Text style={{ color: "#0a7ea4", fontWeight: "700", fontSize: 14 }}>
                            {(selectedJob as Job & { paymentStatus?: string }).paymentStatus === "paid" ? "Paid" : (selectedJob as Job & { paymentStatus?: string }).paymentStatus === "partial" ? "Partially paid" : "Unpaid"} — ${(Number((selectedJob as Job & { balance?: number }).balance ?? selectedJob.price) || 0).toFixed(2)} due
                          </Text>
                          <Text style={{ color: "#0a7ea4", fontSize: 12, marginTop: 2 }}>
                            Amount ${(selectedJob.price ?? 0).toFixed(2)} · Paid ${Number((selectedJob as Job & { paidTotal?: number }).paidTotal || 0).toFixed(2)}
                          </Text>
                          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>Card collection is disabled for Company Jobs.</Text>
                        </View>
                      )}
                    )}
                  </View>

                  {/* ─── Customer Card ─── */}
                  <View style={[s.detailCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Text style={[s.sectionLabel, { color: colors.muted }]}>CUSTOMER</Text>
                    {/* Name row with action buttons */}
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <Text style={[s.detailValue, { color: colors.foreground }]}>{selectedJob.firstName} {selectedJob.lastName}</Text>
                        {selectedJob.isNewCustomer && (
                          <View style={{ backgroundColor: "#F59E0B", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                            <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>⭐ FIRST TIME CUSTOMER</Text>
                          </View>
                        )}
                      </View>
                      {selectedJob.phone ? (
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <TouchableOpacity onPress={() => Linking.openURL(`sms:${selectedJob.phone}`)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#34C75922", borderWidth: 1, borderColor: "#34C75944", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ fontSize: 16 }}>💬</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => Linking.openURL(`tel:${selectedJob.phone}`)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary + "22", borderWidth: 1, borderColor: colors.primary + "44", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ fontSize: 16 }}>📞</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                    {/* Address row with navigate button */}
                    {selectedJob.address ? (
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <Text style={[s.detailSub, { color: colors.muted, flex: 1, marginRight: 8 }]}>📍 {selectedJob.address}</Text>
                        <TouchableOpacity onPress={() => openGoogleMaps(selectedJob.address)} style={[s.gpsBtn, { backgroundColor: colors.primary }]}>
                          <Text style={s.gpsBtnText}>🗺 Navigate</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                    {selectedJob.phone ? <Text style={[s.detailSub, { color: colors.muted }]}>📞 {selectedJob.phone}</Text> : null}
                    {selectedJob.email ? <Text style={[s.detailSub, { color: colors.muted, marginTop: 2 }]}>✉️ {selectedJob.email}</Text> : null}
                    {/* ── Pending Reward Redemptions (detailer view) ── */}
                    {!isAdminRole && selectedJob.customerId && (pendingRedemptionsQ.data ?? []).length > 0 && (
                      <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                        <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700", marginBottom: 8, letterSpacing: 0.3 }}>🎁 PENDING REWARDS</Text>
                        {(pendingRedemptionsQ.data as any[]).map((r: any) => (
                          <TouchableOpacity
                            key={r.redemptionId}
                            onPress={() => {
                              Alert.alert(
                                "Fulfill Reward?",
                                `Mark "${r.tierName}" as fulfilled for ${selectedJob.firstName} ${selectedJob.lastName}?`,
                                [
                                  { text: "Not Yet", style: "cancel" },
                                  {
                                    text: "Yes, Fulfilled",
                                    style: "default",
                                    onPress: () => {
                                      fulfillRedemptionMutation.mutate({
                                        redemptionId: r.redemptionId,
                                        fulfilledBy: employee?.fullName ?? "Team Member",
                                        fulfilledByEmployeeId: employee?.employeeId ?? "",
                                      });
                                    },
                                  },
                                ]
                              );
                            }}
                            activeOpacity={0.75}
                            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#22C55E18", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1.5, borderColor: "#22C55E55", marginBottom: 8 }}
                          >
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                              <Text style={{ fontSize: 18 }}>🎁</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: "#22C55E", fontWeight: "700", fontSize: 14 }}>{r.tierName}</Text>
                                <Text style={{ color: "#22C55E", fontSize: 11, opacity: 0.8, marginTop: 1 }}>Tap to confirm fulfillment</Text>
                              </View>
                            </View>
                            {fulfillRedemptionMutation.isPending ? (
                              <ActivityIndicator size="small" color="#22C55E" />
                            ) : (
                              <Text style={{ color: "#22C55E", fontSize: 18, fontWeight: "700" }}>✓</Text>
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    {/* ── In-App Messaging (portal jobs only, when window is open) ── */}
                    {chatIsPortalJob && (chatWindowOpen || (chatListQuery.data?.messages?.length ?? 0) > 0) && (
                      <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                        <TouchableOpacity
                          onPress={() => setShowChatModal(true)}
                          style={{
                            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                            backgroundColor: chatWindowOpen ? "#EFF6FF" : colors.surface,
                            borderRadius: 12, padding: 14,
                            borderWidth: 1.5, borderColor: chatWindowOpen ? "#BFDBFE" : colors.border,
                          }}
                          activeOpacity={0.8}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                            <Text style={{ fontSize: 20 }}>💬</Text>
                            <View>
                              <Text style={{ fontSize: 14, fontWeight: "700", color: chatWindowOpen ? "#1E40AF" : colors.foreground }}>
                                {chatWindowOpen ? "Chat with Customer" : "Message History"}
                              </Text>
                              <Text style={{ fontSize: 12, color: chatWindowOpen ? "#3B82F6" : colors.muted, marginTop: 1 }}>
                                {chatWindowOpen ? "Chat is active" : "Chat closed"}
                              </Text>
                            </View>
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            {chatUnreadCount > 0 && (
                              <View style={{ backgroundColor: "#EF4444", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
                                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "900" }}>{chatUnreadCount}</Text>
                              </View>
                            )}
                            <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
                          </View>
                        </TouchableOpacity>
                      </View>
                    )}
                    {/* ── Location Photos (detailer view) ── */}
                    <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>📸 Location Photos</Text>
                        {addrPhotos.length < 2 && (
                          <TouchableOpacity
                            onPress={handleAddAddrPhoto}
                            style={{ backgroundColor: colors.primary + "22", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}
                          >
                            {addrPhotoUploading ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>+ Add</Text>}
                          </TouchableOpacity>
                        )}
                      </View>
                      {addrPhotos.length === 0 ? (
                        <Text style={{ color: colors.muted, fontSize: 12, fontStyle: "italic" }}>No location photos for this address yet.</Text>
                      ) : (
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          {addrPhotos.map((photo: any) => (
                            <TouchableOpacity key={photo.photoId} onPress={() => setViewingAddrPhoto(photo.photoUrl)}>
                              <Image source={{ uri: photo.photoUrl }} style={{ width: 100, height: 100, borderRadius: 8, backgroundColor: colors.surface }} resizeMode="cover" />
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>

                    {/* Customer History row */}
                    <TouchableOpacity
                      onPress={() => setShowCustomerHistory(prev => !prev)}
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: 16 }}>🕐</Text>
                        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>Customer History</Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {customerHistoryLoading ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <Text style={{ color: colors.muted, fontSize: 14 }}>{customerHistoryJobs.length > 0 ? customerHistoryJobs.length : ""}</Text>
                        )}
                        <Text style={{ color: colors.muted, fontSize: 18 }}>{showCustomerHistory ? "∧" : ">"}</Text>
                      </View>
                    </TouchableOpacity>
                    {showCustomerHistory && (
                      <View style={{ marginTop: 8, gap: 6 }}>
                        {customerHistoryLoading ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : customerHistoryJobs.length === 0 ? (
                          <Text style={{ color: colors.muted, fontSize: 13 }}>No previous jobs found for this customer.</Text>
                        ) : (
                          customerHistoryJobs.map((hj: any, idx: number) => (
                            <View key={idx} style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.border }}>
                              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                                <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{hj.packageType || hj.serviceDescription || "Detail Service"}</Text>
                                <Text style={{ color: colors.muted, fontSize: 12 }}>{hj.date}</Text>
                              </View>
                              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{hj.vehicleType ? `${hj.vehicleType}` : ""}{hj.vehicleYear ? ` ${hj.vehicleYear}` : ""}{hj.vehicleMake ? ` ${hj.vehicleMake}` : ""}{hj.vehicleModel ? ` ${hj.vehicleModel}` : ""}</Text>
                              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                                <Text style={{ color: hj.status === "completed" ? "#22C55E" : colors.muted, fontSize: 12, fontWeight: "600" }}>{hj.status?.toUpperCase()}</Text>
                                <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }}>${parseFloat(hj.totalPrice || "0").toFixed(2)}</Text>
                              </View>
                            </View>
                          ))
                        )}
                      </View>
                    )}
                  </View>

                  {/* ─── Job Schedule Card ─── */}
                  <View style={[s.detailCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
                      <Text style={{ fontSize: 16 }}>📅</Text>
                      <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>Job Schedule</Text>
                    </View>
                    {(() => {
                      const jobDate = getWeekDates(selectedJob.weekOffset)[selectedJob.dayIndex];
                      const dateStr = jobDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit" });
                      const fromTime = formatHour(selectedJob.startHour);
                      const toTime = formatHour(selectedJob.endHour);
                      return (
                        <View style={{ gap: 6 }}>
                          <View style={{ flexDirection: "row", alignItems: "center" }}>
                            <Text style={{ color: colors.muted, fontSize: 14, width: 40 }}>From</Text>
                            <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", flex: 1 }}>{dateStr}</Text>
                            <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{fromTime}</Text>
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center" }}>
                            <Text style={{ color: colors.muted, fontSize: 14, width: 40 }}>To</Text>
                            <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", flex: 1 }}>{dateStr}</Text>
                            <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{toTime}</Text>
                          </View>
                        </View>
                      );
                    })()}
                  </View>

                  {/* ─── Vehicles & Services Card ─── */}
                  {(() => {
                    const allVehicles: AdditionalVehicle[] = [
                      ...(selectedJob.vehicleType ? [{
                        vehicleType: selectedJob.vehicleType as VehicleType,
                        packageId: selectedJob.packageId ?? "",
                        addonIds: selectedJob.addonIds ?? [],
                        addonQtys: selectedJob.addonQtys ?? {},
                        price: selectedJob.price ?? 0,
                        vehicleColor: selectedJob.vehicleColor,
                        vehicleYear: selectedJob.vehicleYear,
                        vehicleMake: selectedJob.vehicleMake,
                        vehicleModel: selectedJob.vehicleModel,
                      }] : []),
                      ...(selectedJob.additionalVehicles ?? []),
                    ];
                    const totalVehicles = allVehicles.length;
                    return (
                      <View style={[s.detailCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                        {/* Header row with Edit button */}
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
                          <Text style={{ fontSize: 16 }}>🚗</Text>
                          <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700", flex: 1 }}>Vehicles & Services</Text>
                          {totalVehicles > 1 && (
                            <View style={{ backgroundColor: colors.primary + "22", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginRight: 6 }}>
                              <Text style={{ color: colors.primary, fontSize: 11, fontWeight: "700" }}>{totalVehicles} vehicles</Text>
                            </View>
                          )}
                          <TouchableOpacity
                            onPress={() => {
                              // Snapshot current vehicles into edit state
                              setEditVehicles(allVehicles.length > 0 ? allVehicles : [{ vehicleType: "sedan", packageId: "", addonIds: [], addonQtys: {}, price: 0 }]);
                              setShowEditServicesSheet(true);
                            }}
                            style={{ backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 }}
                            activeOpacity={0.75}
                          >
                            <Text style={{ color: "#FFF", fontSize: 13, fontWeight: "700" }}>Edit</Text>
                          </TouchableOpacity>
                        </View>

                        {/* Read-only vehicle cards */}
                        {allVehicles.map((av, idx) => {
                          const vt = VEHICLE_TYPES.find((v) => v.id === av.vehicleType);
                          const resolvedPkgId = resolvePackageId(av.packageId) || av.packageId;
                          const pkg = allJobPackages.find((p) => p.id === resolvedPkgId);
                          // Per-vehicle display price: prefer pkg.basePrice (source of truth for what that
                          // package costs) so VIP ($0) and other packages show their correct individual price.
                          // Fall back to av.price only when there is no matching package (e.g. custom service).
                          const pkgBasePrice = pkg && av.vehicleType ? (pkg.basePrice as Record<string, number>)[av.vehicleType] ?? 0 : undefined;
                          const pkgPrice = pkgBasePrice !== undefined ? pkgBasePrice : (av.price ?? 0);
                          return (
                            <View key={idx} style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 8 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                <Text style={{ fontSize: 20 }}>{vt?.emoji ?? "🚗"}</Text>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700" }}>
                                    {[av.vehicleYear, av.vehicleMake, av.vehicleModel].filter(Boolean).join(" ") || vt?.label || (idx === 0 ? "Vehicle" : `Vehicle ${idx + 1}`)}
                                  </Text>
                                  {av.vehicleColor ? <Text style={{ color: colors.muted, fontSize: 12 }}>{av.vehicleColor}</Text> : null}
                                </View>
                              </View>
                              {pkg ? (
                                <View style={{ marginBottom: 6 }}>
                                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                                    <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14 }}>{pkg.emoji} {pkg.title}</Text>
                                    <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 14 }}>${pkgPrice.toFixed(2)}</Text>
                                  </View>
                                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: 6 }}>Qty 1 @ ${pkgPrice.toFixed(2)}/Each</Text>
                                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>This package includes:</Text>
                                  {pkg.features.map((f, i) => (
                                    <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 3 }}>
                                      <Text style={{ color: colors.primary, fontSize: 13, marginRight: 6, marginTop: 1 }}>•</Text>
                                      <Text style={{ color: colors.foreground, fontSize: 13, flex: 1, lineHeight: 18 }}>{f}</Text>
                                    </View>
                                  ))}
                                </View>
                              ) : (
                                <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", marginBottom: 6 }}>
                                  {idx === 0 ? (selectedJob.serviceTitle || "Detail Service") : "Detail Service"}
                                </Text>
                              )}
                              {(av.addonIds ?? []).length > 0 && (
                                <View style={{ marginTop: 4 }}>
                                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 4 }}>ADD-ONS</Text>
                                  {(av.addonIds ?? []).map((adId: string) => {
                                    const ad = ADDONS.find((a) => a.id === adId);
                                    if (!ad) return null;
                                    const qty = av.addonQtys?.[adId] ?? 1;
                                    return (
                                      <View key={adId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3 }}>
                                        <Text style={{ color: colors.foreground, fontSize: 13 }}>{ad.emoji} {ad.title}{qty > 1 ? ` × ${qty}` : ""}</Text>
                                        <Text style={{ color: colors.foreground, fontSize: 13 }}>${(ad.price * qty).toFixed(2)}</Text>
                                      </View>
                                    );
                                  })}
                                </View>
                              )}
                            </View>
                          );
                        })}
                        {allVehicles.length === 0 && (
                          <Text style={{ color: colors.muted, fontSize: 14 }}>{selectedJob.serviceTitle || "Detail Service"}</Text>
                        )}
                      </View>
                    );
                  })()}

                  {/* ─── Upsells Section ─── always visible so detailers can add upsells at any stage */}
                  <View style={[s.detailCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <Text style={[s.sectionLabel, { color: colors.muted }]}>UPSELLS</Text>
                        <TouchableOpacity
                          onPress={() => {
                            // Pre-populate with existing upsells if any
                            setUpsellIds(selectedJob.upsellIds ?? []);
                            setUpsellQtys(selectedJob.upsellQtys ?? {});
                            setShowUpsellPanel(true);
                          }}
                          activeOpacity={0.75}
                          style={{ backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 }}
                        >
                          <Text style={{ color: "#FFF", fontSize: 13, fontWeight: "700" }}>
                            {selectedJob.upsellIds && selectedJob.upsellIds.length > 0 ? "Edit Upsells" : "+ Add Upsells"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {selectedJob.upsellIds && selectedJob.upsellIds.length > 0 ? (
                        <>
                          {selectedJob.upsellIds.map((id) => {
                            const ad = ADDONS.find((a) => a.id === id);
                            if (!ad) return null;
                            const qty = selectedJob.upsellQtys?.[id] ?? 1;
                            return (
                              <View key={id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                                <Text style={{ color: colors.foreground, fontSize: 13 }}>{ad.emoji} {ad.title}{qty > 1 ? ` × ${qty}` : ""}</Text>
                                <Text style={{ color: colors.foreground, fontSize: 13 }}>${(ad.price * qty).toFixed(2)}</Text>
                              </View>
                            );
                          })}
                          <View style={[s.divider, { backgroundColor: colors.border, marginTop: 8 }]} />
                          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                            <Text style={{ color: colors.muted, fontSize: 13 }}>Upsell Total</Text>
                            <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>${(selectedJob.upsellTotal ?? 0).toFixed(2)}</Text>
                          </View>

                          {/* Sync button: pushes upsellTotal to DB so dashboard bonus reflects correctly */}
                          <TouchableOpacity
                            onPress={() => {
                              syncJobToServer(selectedJob);
                              jobStatusMutation.mutate({
                                jobId: selectedJob.id,
                                status: selectedJob.status === 'finished' ? 'completed' : 'in_progress',
                                upsellTotal: selectedJob.upsellTotal ?? 0,
                                upsellIds: selectedJob.upsellIds ?? [],
                                upsellQtys: selectedJob.upsellQtys ?? {},
                              });
                              utils.performance.getDateRange.invalidate();
                            }}
                            activeOpacity={0.75}
                            style={{ marginTop: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 6, alignItems: 'center' }}
                          >
                            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>↑ Sync upsells to dashboard</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <Text style={{ color: colors.muted, fontSize: 13 }}>No upsells added yet. Tap + Add Upsells to add extras to this job.</Text>
                      )}
                  </View>

                  {/* ─── Line Items Card ─── */}
                    {(() => {
                    const serviceTotal = selectedJob.price ?? 0;
                    const upsellAmt = selectedJob.upsellTotal ?? 0;
                    const subtotal = serviceTotal + upsellAmt;
                    const discount = selectedJob.discountAmount ?? 0;
                    const tax = selectedJob.taxAmount ?? 0;
                    const deposit = selectedJob.depositAmount ?? 0;
                    const total = subtotal - discount + tax;
                    const balanceDue = total - deposit;
                    return (
                      <View style={[s.detailCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
                          <Text style={{ fontSize: 16 }}>💳</Text>
                          <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>Line Items</Text>
                        </View>

                        {/* Service Total (base price — never changes) */}
                        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                          <Text style={{ color: colors.foreground, fontSize: 14 }}>Service Total</Text>
                          <Text style={{ color: colors.foreground, fontSize: 14 }}>${serviceTotal.toFixed(2)}</Text>
                        </View>

                        {/* Upsells (separate line, only shown when > 0) */}
                        {upsellAmt > 0 && (
                          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                            <Text style={{ color: colors.foreground, fontSize: 14 }}>Upsells</Text>
                            <Text style={{ color: colors.foreground, fontSize: 14 }}>+${upsellAmt.toFixed(2)}</Text>
                          </View>
                        )}

                        {/* Subtotal = Service + Upsells */}
                        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700" }}>Subtotal</Text>
                          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700" }}>${subtotal.toFixed(2)}</Text>
                        </View>

                        {/* Discount (read-only for detailer) */}
                        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                          <View>
                            <Text style={{ color: colors.foreground, fontSize: 14 }}>Discount</Text>
                            {selectedJob.discountCode ? <Text style={{ color: colors.muted, fontSize: 12 }}>{selectedJob.discountCode}</Text> : null}
                          </View>
                          <Text style={{ color: discount > 0 ? "#EF4444" : colors.muted, fontSize: 14, fontWeight: "600" }}>{discount > 0 ? `-$${discount.toFixed(2)}` : "$0.00"}</Text>
                        </View>

                        {/* Tax */}
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                          <Text style={{ color: colors.foreground, fontSize: 14 }}>Tax</Text>
                          {editingTax ? (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <TextInput
                                value={taxInput}
                                onChangeText={setTaxInput}
                                keyboardType="decimal-pad"
                                style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, color: colors.foreground, fontSize: 14, minWidth: 80, textAlign: "right" }}
                                placeholder="0.00"
                                placeholderTextColor={colors.muted}
                                returnKeyType="done"
                                onSubmitEditing={() => { const val = parseFloat(taxInput) || 0; saveTaxAmount(selectedJob, val); setEditingTax(false); }}
                                autoFocus
                              />
                              <TouchableOpacity onPress={() => { const val = parseFloat(taxInput) || 0; saveTaxAmount(selectedJob, val); setEditingTax(false); }} style={{ backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                                <Text style={{ color: "#FFF", fontSize: 13, fontWeight: "600" }}>Save</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <TouchableOpacity onPress={() => { setTaxInput((tax).toFixed(2)); setEditingTax(true); }} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Text style={{ color: colors.foreground, fontSize: 14 }}>${tax.toFixed(2)}</Text>
                              <Text style={{ color: colors.primary, fontSize: 12 }}>✏️</Text>
                            </TouchableOpacity>
                          )}
                        </View>

                        {/* Tip */}
                        {selectedJob.payment?.tipAmount ? (
                          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                            <Text style={{ color: colors.foreground, fontSize: 14 }}>Tip</Text>
                            <Text style={{ color: "#22C55E", fontSize: 14, fontWeight: "600" }}>+${selectedJob.payment.tipAmount.toFixed(2)}</Text>
                          </View>
                        ) : null}

                        {/* Total */}
                        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                          <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "800" }}>Total</Text>
                          <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "800" }}>${total.toFixed(2)}</Text>
                        </View>

                        {/* Deposit (read-only for detailer) */}
                        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: deposit > 0 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
                          <Text style={{ color: colors.foreground, fontSize: 14 }}>Deposit</Text>
                          <Text style={{ color: deposit > 0 ? colors.success : colors.muted, fontSize: 14, fontWeight: "600" }}>{deposit > 0 ? `-$${deposit.toFixed(2)}` : "$0.00"}</Text>
                        </View>

                        {/* Balance Due */}
                        {deposit > 0 ? (
                          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, marginTop: 2, backgroundColor: balanceDue <= 0 ? "#22C55E11" : colors.surface, borderRadius: 8, paddingHorizontal: 8 }}>
                            <Text style={{ color: balanceDue <= 0 ? "#22C55E" : colors.foreground, fontSize: 14, fontWeight: "700" }}>{balanceDue <= 0 ? "✓ Paid in Full" : "Balance Due"}</Text>
                            <Text style={{ color: balanceDue <= 0 ? "#22C55E" : colors.primary, fontSize: 14, fontWeight: "700" }}>${Math.max(0, balanceDue).toFixed(2)}</Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  })()}

                  {selectedJob.notes ? (
                    <View style={[s.detailCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <Text style={[s.sectionLabel, { color: colors.muted }]}>NOTES</Text>
                      <Text style={[s.detailSub, { color: colors.foreground }]}>{selectedJob.notes}</Text>
                    </View>
                  ) : null}

                  {/* ─── Private Notes Card ─── */}
                  {(() => {
                    const hasNotes = (selectedJob.privateNotes ?? []).length > 0;
                    return hasNotes ? (
                      <PrivateNotesCard
                        job={selectedJob}
                        currentEmployeeId={employee?.employeeId ?? ""}
                        currentEmployeeName={employee?.fullName ?? ""}
                        currentRole={employee?.role ?? "detailer"}
                        onNotesChange={(notes: PrivateNote[]) => {
                          // Filter out __new__ placeholder before persisting
                          const realNotes = notes.filter((n) => n.id !== "__new__");
                          setSelectedJob((prev) => prev ? { ...prev, privateNotes: realNotes } : prev);
                          // Also update the jobs array and persist to AsyncStorage so notes survive refresh
                          persistJobs(jobs.map((j) => j.id === selectedJob.id ? { ...j, privateNotes: realNotes } : j));
                        }}
                      />
                    ) : (
                      <View style={[s.detailCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                        <TouchableOpacity
                          onPress={() => {
                            // Open private notes by temporarily injecting a placeholder note to trigger the card
                            setSelectedJob((prev) => prev ? { ...prev, privateNotes: [{ id: "__new__", text: "", authorId: employee?.employeeId ?? "", authorName: employee?.fullName ?? "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] } : prev);
                          }}
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
                  {/* ─── Before & After Photos ─── */}
                  <View style={[s.detailCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <Text style={[s.sectionLabel, { color: colors.muted }]}>BEFORE & AFTER PHOTOS</Text>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <TouchableOpacity onPress={openCameraSession} style={[s.photoAddBtn, { backgroundColor: colors.primary }]}><Text style={s.photoAddBtnText}>📷 Camera</Text></TouchableOpacity>
                        <TouchableOpacity onPress={addPhotoFromLibrary} style={[s.photoAddBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}><Text style={[s.photoAddBtnText, { color: colors.foreground }]}>🖼 Library</Text></TouchableOpacity>
                      </View>
                    </View>
                    {(() => {
                      // Display all photos: S3 URLs + local device URIs (both uploaded and pending upload)
                      const displayPhotos = Array.from(new Set([...(selectedJob.photoUrls ?? []), ...(selectedJob.photos ?? [])]));
                      // Remove duplicates and filter out empty strings
                      const uniquePhotos = Array.from(new Set(displayPhotos.filter(p => p && p.length > 0)));
                      return uniquePhotos.length === 0 ? (
                        <View style={[s.emptyPhotos, { borderColor: colors.border }]}><Text style={{ color: colors.muted, fontSize: 13 }}>No before & after photos yet.</Text></View>
                      ) : (
                        <View style={s.photoGrid}>
                          {uniquePhotos.map((uri) => (
                            <TouchableOpacity key={uri} onLongPress={() => deletePhoto(uri)} style={s.photoThumb}>
                              <Image source={{ uri }} style={s.photoImg} resizeMode="cover" />
                            </TouchableOpacity>
                          ))}
                        </View>
                      );
                    })()}
                    <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>Long-press a photo to delete it.</Text>

                    {/* ─── Videos ─── */}
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14, marginBottom: 8 }}>
                      <Text style={[s.sectionLabel, { color: colors.muted }]}>VIDEOS</Text>
                      <TouchableOpacity
                        onPress={addVideoFromLibrary}
                        disabled={uploadingVideo}
                        style={[s.photoAddBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
                      >
                        {uploadingVideo ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <Text style={[s.photoAddBtnText, { color: colors.foreground }]}>🎥 Add Video</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                    {(selectedJob.videoUrls ?? []).length === 0 ? (
                      <View style={[s.emptyPhotos, { borderColor: colors.border }]}><Text style={{ color: colors.muted, fontSize: 13 }}>No videos yet.</Text></View>
                    ) : (
                      <View style={s.photoGrid}>
                        {(selectedJob.videoUrls ?? []).map((url) => (
                          <TouchableOpacity key={url} onLongPress={() => deleteVideo(url)} style={s.photoThumb}>
                            <View style={[s.photoImg, { backgroundColor: "#1a1a2e", alignItems: "center", justifyContent: "center" }]}>
                              <Text style={{ fontSize: 28, color: "#fff" }}>▶</Text>
                              <Text style={{ color: "#aaa", fontSize: 10, marginTop: 2 }}>Video</Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    {(selectedJob.videoUrls ?? []).length > 0 && (
                      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>Long-press a video to delete it.</Text>
                    )}
                  </View>

                  {/* ─── Vehicle Inspection Section ─── */}
                  {(() => {
                    const hasInspection = !!selectedJob.inspection;
                    return hasInspection ? (
                      <View style={[s.detailCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                          <Text style={[s.sectionLabel, { color: colors.muted }]}>🔍 VEHICLE INSPECTION</Text>
                          <TouchableOpacity
                            onPress={() => openInspection(selectedJob)}
                            style={{ backgroundColor: "#10B981", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 }}
                            activeOpacity={0.75}
                          >
                            <Text style={{ color: "#FFF", fontSize: 13, fontWeight: "700" }}>✓ View / Edit</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={{ gap: 4 }}>
                          {(() => {
                            const poorItems = INSP_CATEGORIES.filter(c => selectedJob.inspection!.ratings[c.id] === "poor");
                            const allZones = [...(selectedJob.inspection!.exteriorZones ?? []), ...(selectedJob.inspection!.interiorZones ?? [])];
                            const hasDamage = poorItems.length > 0 || allZones.length > 0;
                            return (
                              <>
                                {hasDamage ? (
                                  <Text style={{ color: "#EF4444", fontSize: 12 }}>⚠️ Needs Attention — {poorItems.length} poor rating{poorItems.length !== 1 ? "s" : ""}{allZones.length > 0 ? `, ${allZones.length} damage zone${allZones.length !== 1 ? "s" : ""}` : ""}</Text>
                                ) : (
                                  <Text style={{ color: "#10B981", fontSize: 12 }}>✓ All items rated Good or N/A</Text>
                                )}
                                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>By {selectedJob.inspection!.inspectedBy} · {new Date(selectedJob.inspection!.completedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</Text>
                              </>
                            );
                          })()}
                        </View>
                      </View>
                    ) : (
                      <View style={[s.detailCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                        <TouchableOpacity
                          onPress={() => openInspection(selectedJob)}
                          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                          activeOpacity={0.7}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Text style={{ fontSize: 16 }}>🔍</Text>
                            <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>Vehicle Inspection</Text>
                          </View>
                          <Text style={{ color: colors.primary, fontSize: 22, fontWeight: "300" }}>+</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })()}
                  {/* ─── Lead Source Card ─── */}
                  {selectedJob.leadSource ? (
                    <View style={[s.detailCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ fontSize: 16 }}>🎯</Text>
                          <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>Lead Source</Text>
                        </View>
                        <View style={{ backgroundColor: selectedJob.leadSource === "Portal Booking" ? "#06B6D422" : selectedJob.leadSource === "Website Booking" ? "#0EA5E922" : colors.surface, borderWidth: 1, borderColor: selectedJob.leadSource === "Portal Booking" ? "#06B6D466" : selectedJob.leadSource === "Website Booking" ? "#0EA5E966" : colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 }}>
                          <Text style={{ color: selectedJob.leadSource === "Portal Booking" ? "#06B6D4" : selectedJob.leadSource === "Website Booking" ? "#0EA5E9" : colors.muted, fontSize: 13, fontWeight: "600" }}>{selectedJob.leadSource}</Text>
                        </View>
                      </View>
                    </View>
                  ) : null}

                  {/* ─── Job Tags Card ─── */}
                  <View style={[s.detailCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: 16 }}>🏷️</Text>
                        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>Job Tags</Text>
                      </View>
                      <TouchableOpacity onPress={() => setEditingTags(!editingTags)} style={{ backgroundColor: editingTags ? colors.surface : colors.primary + "22", borderWidth: 1, borderColor: editingTags ? colors.border : colors.primary, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 }}>
                        <Text style={{ color: editingTags ? colors.muted : colors.primary, fontSize: 12, fontWeight: "600" }}>{editingTags ? "Done" : "+ Add"}</Text>
                      </TouchableOpacity>
                    </View>
                    {/* Tag chips */}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: editingTags ? 10 : 0 }}>
                      {(selectedJob.tags ?? []).map((tag, i) => (
                        <TouchableOpacity
                          key={i}
                          onPress={() => editingTags ? saveJobTags(selectedJob, (selectedJob.tags ?? []).filter((_, ti) => ti !== i)) : undefined}
                          style={{ backgroundColor: colors.primary + "22", borderWidth: 1, borderColor: colors.primary + "66", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 4 }}
                        >
                          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>{tag}</Text>
                          {editingTags ? <Text style={{ color: colors.primary, fontSize: 12 }}>×</Text> : null}
                        </TouchableOpacity>
                      ))}
                      {(selectedJob.tags ?? []).length === 0 && !editingTags && (
                        <Text style={{ color: colors.muted, fontSize: 13 }}>No tags yet. Tap + Add to label this job.</Text>
                      )}
                    </View>
                    {editingTags && (
                      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                        <TextInput
                          value={tagInput}
                          onChangeText={setTagInput}
                          placeholder="Type a tag and press Add"
                          placeholderTextColor={colors.muted}
                          style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: colors.foreground, fontSize: 14 }}
                          returnKeyType="done"
                          onSubmitEditing={() => {
                            const trimmed = tagInput.trim();
                            if (trimmed && !(selectedJob.tags ?? []).includes(trimmed)) {
                              saveJobTags(selectedJob, [...(selectedJob.tags ?? []), trimmed]);
                            }
                            setTagInput("");
                          }}
                        />
                        <TouchableOpacity
                          onPress={() => {
                            const trimmed = tagInput.trim();
                            if (trimmed && !(selectedJob.tags ?? []).includes(trimmed)) {
                              saveJobTags(selectedJob, [...(selectedJob.tags ?? []), trimmed]);
                            }
                            setTagInput("");
                          }}
                          style={{ backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 }}
                        >
                          <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 14 }}>Add</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>

                  {/* ─── Recommended Services Section ─── */}
                  <View style={[s.detailCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <View>
                        <Text style={[s.sectionLabel, { color: colors.muted }]}>RECOMMENDED FOR NEXT VISIT</Text>
                        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Services to suggest to the customer</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => {
                          setPendingRecIds(selectedJob.recommendedIds ?? []);
                          setShowRecsPanel(true);
                        }}
                        activeOpacity={0.75}
                        style={{ backgroundColor: "#8B5CF6", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 }}
                      >
                        <Text style={{ color: "#FFF", fontSize: 13, fontWeight: "700" }}>
                          {selectedJob.recommendedIds && selectedJob.recommendedIds.length > 0 ? "Edit" : "+ Add"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {selectedJob.recommendedIds && selectedJob.recommendedIds.length > 0 ? (
                      <View style={{ gap: 6 }}>
                        {selectedJob.recommendedIds.map((id) => {
                          const ad = ADDONS.find((a) => a.id === id);
                          if (!ad) return null;
                          return (
                            <View key={id} style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(139,92,246,0.08)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                              <Text style={{ fontSize: 18 }}>{ad.emoji}</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{ad.title}</Text>
                                <Text style={{ color: colors.muted, fontSize: 11 }}>${ad.price.toFixed(2)}</Text>
                              </View>
                              <View style={{ backgroundColor: "#8B5CF6", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                                <Text style={{ color: "#FFF", fontSize: 10, fontWeight: "700" }}>RECOMMENDED</Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ) : (
                      <Text style={{ color: colors.muted, fontSize: 13 }}>No recommendations yet. Tap + Add to suggest services for the next visit.</Text>
                    )}
                  </View>

                  {/* Delete Job removed — admin-only action */}
                  </View>{/* end paddingHorizontal wrapper */}
                </ScrollView>

                {/* Inline Inspection Panel - slides up inside the Job Detail Modal */}
                {showInspectionModal && (
                  <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0, zIndex: 100 }}>
                    {/* Dim overlay */}
                    <TouchableOpacity
                      activeOpacity={1}
                      onPress={() => setShowInspectionModal(false)}
                      style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" }}
                    />
                    {/* Panel */}
                    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0 }}>
                      <View style={{ flex: 1, backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, marginTop: 60, overflow: "hidden" }}>
                        {/* Header */}
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: 20, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                          <View>
                            <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>🔍 Vehicle Inspection</Text>
                            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>{selectedJob.firstName} {selectedJob.lastName} · {VEHICLE_TYPES.find(v => v.id === selectedJob.vehicleType)?.label ?? "Vehicle"}</Text>
                          </View>
                          <TouchableOpacity onPress={() => setShowInspectionModal(false)} style={{ padding: 4 }}>
                            <Text style={{ color: colors.muted, fontSize: 26 }}>✕</Text>
                          </TouchableOpacity>
                        </View>

                        {inspViewMode === "report" ? (
                          /* ─── COMPLETED REPORT VIEW ─── */
                          <>
                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.background }}>
                              <View>
                                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>Completed Report</Text>
                                <Text style={{ fontSize: 12, color: colors.muted }}>By {selectedJob.inspection?.inspectedBy} · {selectedJob.inspection ? new Date(selectedJob.inspection.completedAt).toLocaleString([], { month: "numeric", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</Text>
                              </View>
                              {(() => {
                                const hasPoor = INSP_CATEGORIES.some(c => selectedJob.inspection?.ratings[c.id] === "poor");
                                const hasZones = (selectedJob.inspection?.exteriorZones?.length ?? 0) + (selectedJob.inspection?.interiorZones?.length ?? 0) > 0;
                                return (hasPoor || hasZones) ? (
                                  <View style={{ backgroundColor: "#EF444420", borderColor: "#EF4444", borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
                                    <Text style={{ color: "#EF4444", fontWeight: "700", fontSize: 12 }}>Needs Attention</Text>
                                  </View>
                                ) : (
                                  <View style={{ backgroundColor: "#22C55E20", borderColor: "#22C55E", borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
                                    <Text style={{ color: "#22C55E", fontWeight: "700", fontSize: 12 }}>✓ All Good</Text>
                                  </View>
                                );
                              })()}
                            </View>
                            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 120 }}>
                              {INSP_CATEGORIES.map((cat) => {
                                const rating = selectedJob.inspection?.ratings[cat.id];
                                const rOpt = RATING_OPTIONS.find(r => r.id === rating);
                                const isDamage = cat.id === "damage";
                                const allZones = [...(selectedJob.inspection?.exteriorZones ?? []), ...(selectedJob.inspection?.interiorZones ?? [])];
                                return (
                                  <View key={cat.id} style={{ backgroundColor: colors.background, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border }}>
                                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                                      <View style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: 12 }}>
                                        <Text style={{ fontSize: 26 }}>{cat.emoji}</Text>
                                        <View style={{ flex: 1 }}>
                                          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{cat.label}</Text>
                                          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{cat.desc}</Text>
                                        </View>
                                      </View>
                                      {rOpt ? (
                                        <View style={{ backgroundColor: rOpt.color + "25", borderColor: rOpt.color, borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 4 }}>
                                          <Text style={{ fontSize: 13 }}>{rOpt.emoji}</Text>
                                          <Text style={{ color: rOpt.color, fontWeight: "700", fontSize: 13 }}>{rOpt.label}</Text>
                                        </View>
                                      ) : (
                                        <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
                                          <Text style={{ color: colors.muted, fontSize: 12 }}>Not rated</Text>
                                        </View>
                                      )}
                                    </View>
                                    {isDamage && allZones.length > 0 && (
                                      <View style={{ marginTop: 10 }}>
                                        <Text style={[s.sectionLabel, { color: colors.muted, fontSize: 10, marginBottom: 6 }]}>DAMAGE LOCATIONS</Text>
                                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                                          {allZones.map(zid => {
                                            const zone = [...EXTERIOR_ZONES, ...INTERIOR_ZONES].find(z => z.id === zid);
                                            return zone ? (
                                              <View key={zid} style={{ backgroundColor: "#EF444420", borderColor: "#EF4444", borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                                                <Text style={{ color: "#EF4444", fontSize: 12, fontWeight: "600" }}>{zone.label}</Text>
                                              </View>
                                            ) : null;
                                          })}
                                        </View>
                                      </View>
                                    )}
                                  </View>
                                );
                              })}
                              <View style={{ backgroundColor: colors.background, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 }}>
                                  <Text style={{ fontSize: 22 }}>📋</Text>
                                  <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Overall Notes</Text>
                                </View>
                                <Text style={{ fontSize: 13, color: selectedJob.inspection?.notes ? colors.foreground : colors.muted, fontStyle: selectedJob.inspection?.notes ? "normal" : "italic" }}>
                                  {selectedJob.inspection?.notes || "No additional notes."}
                                </Text>
                              </View>
                            </ScrollView>
                            {/* Footer */}
                            <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", gap: 12, padding: 20, paddingBottom: 36, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                              <TouchableOpacity
                                onPress={() => setInspViewMode("form")}
                                activeOpacity={0.8}
                                style={{ flex: 1, backgroundColor: colors.background, borderRadius: 14, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: colors.border }}
                              >
                                <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>✏️ Edit</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => setShowInspectionModal(false)}
                                activeOpacity={0.8}
                                style={{ flex: 2, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: "center" }}
                              >
                                <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>Done</Text>
                              </TouchableOpacity>
                            </View>
                          </>
                        ) : (
                          /* ─── FORM VIEW ─── */
                          <>
                            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
                              {/* Category Ratings */}
                              {INSP_CATEGORIES.map((cat) => {
                                const current = inspRatings[cat.id];
                                const isDamage = cat.id === "damage";
                                return (
                                  <View key={cat.id} style={{ backgroundColor: colors.background, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: current === "poor" ? "#EF4444" : colors.border }}>
                                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                                      <Text style={{ fontSize: 26 }}>{cat.emoji}</Text>
                                      <View style={{ flex: 1 }}>
                                        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{cat.label}</Text>
                                        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{cat.desc}</Text>
                                      </View>
                                    </View>
                                    {/* Rating buttons */}
                                    <View style={{ flexDirection: "row", gap: 8 }}>
                                      {RATING_OPTIONS.map((opt) => {
                                        const sel = current === opt.id;
                                        return (
                                          <TouchableOpacity
                                            key={opt.id}
                                            onPress={() => setInspRatings(prev => ({ ...prev, [cat.id]: opt.id }))}
                                            activeOpacity={0.7}
                                            style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", borderWidth: sel ? 2 : 1,
                                              backgroundColor: sel ? opt.color + "25" : colors.surface,
                                              borderColor: sel ? opt.color : colors.border }}
                                          >
                                            <Text style={{ fontSize: 16 }}>{opt.emoji}</Text>
                                            <Text style={{ fontSize: 11, fontWeight: sel ? "700" : "500", color: sel ? opt.color : colors.muted, marginTop: 2 }}>{opt.label}</Text>
                                          </TouchableOpacity>
                                        );
                                      })}
                                    </View>
                                    {/* Damage zone diagram — only for the damage category */}
                                    {isDamage && current === "poor" && (
                                      <View style={{ marginTop: 14 }}>
                                        <Text style={[s.sectionLabel, { color: colors.muted, marginBottom: 8 }]}>TAP TO MARK DAMAGE LOCATION</Text>
                                        {/* Exterior / Interior toggle */}
                                        <View style={{ flexDirection: "row", backgroundColor: colors.surface, borderRadius: 12, padding: 3, marginBottom: 10 }}>
                                          <TouchableOpacity
                                            onPress={() => setInspDiagramTab("exterior")}
                                            activeOpacity={0.8}
                                            style={{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center", backgroundColor: inspDiagramTab === "exterior" ? colors.primary : "transparent" }}
                                          >
                                            <Text style={{ color: inspDiagramTab === "exterior" ? "#FFF" : colors.muted, fontWeight: "700", fontSize: 13 }}>🚗 Exterior</Text>
                                          </TouchableOpacity>
                                          <TouchableOpacity
                                            onPress={() => setInspDiagramTab("interior")}
                                            activeOpacity={0.8}
                                            style={{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center", backgroundColor: inspDiagramTab === "interior" ? colors.primary : "transparent" }}
                                          >
                                            <Text style={{ color: inspDiagramTab === "interior" ? "#FFF" : colors.muted, fontWeight: "700", fontSize: 13 }}>🪑 Interior</Text>
                                          </TouchableOpacity>
                                        </View>
                                        {/* Zone count */}
                                        {(() => {
                                          const activeZones = inspDiagramTab === "exterior" ? inspExteriorZones : inspInteriorZones;
                                          return <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center", marginBottom: 8 }}>Tap zones to mark damage · {activeZones.length} zone{activeZones.length !== 1 ? "s" : ""} selected</Text>;
                                        })()}
                                        {/* Car Diagram with image + tappable zones */}
                                        {(() => {
                                          const zones = inspDiagramTab === "exterior" ? EXTERIOR_ZONES : INTERIOR_ZONES;
                                          const activeZones = inspDiagramTab === "exterior" ? inspExteriorZones : inspInteriorZones;
                                          const setActiveZones = inspDiagramTab === "exterior" ? setInspExteriorZones : setInspInteriorZones;
                                          // Exterior: 1696×2528 (ratio 1:1.491) | Interior: 1056×1408 (ratio 1:1.333)
                                          const imgW = Dimensions.get("window").width - 72;
                                          const imgH = inspDiagramTab === "exterior" ? imgW * (2528 / 1696) : imgW * (1408 / 1056);
                                          return (
                                            <View style={{ borderRadius: 12, overflow: "hidden", backgroundColor: "#F5F6F8" }}>
                                              {/* Background car image */}
                                              {inspDiagramTab === "exterior" ? (
                                                <Image
                                                  source={{ uri: "https://d2xsxph8kpxj0f.cloudfront.net/310519663471903126/n2wVeYQgKmefAVwyN2KSSe/car-topdown_14c2b731.png" }}
                                                  style={{ width: imgW, height: imgH }}
                                                  resizeMode="contain"
                                                />
                                              ) : (
                                                <Image
                                                  source={{ uri: "https://d2xsxph8kpxj0f.cloudfront.net/310519663471903126/n2wVeYQgKmefAVwyN2KSSe/interior-diagram-v2-9Yh7dGZT4HRkKM24c38jSo.png" }}
                                                  style={{ width: imgW, height: imgH }}
                                                  resizeMode="contain"
                                                />
                                              )}
                                              {/* Absolute-positioned tappable zones */}
                                              <View style={{ position: "absolute", top: 0, left: 0, width: imgW, height: imgH }}>
                                                {zones.map((zone) => {
                                                  const sel = activeZones.includes(zone.id);
                                                  const zTop  = (zone.top  / 100) * imgH;
                                                  const zLeft = (zone.left / 100) * imgW;
                                                  const zW    = (zone.w    / 100) * imgW;
                                                  const zH    = (zone.h    / 100) * imgH;
                                                  return (
                                                    <TouchableOpacity
                                                      key={zone.id}
                                                      activeOpacity={0.7}
                                                      onPress={() => {
                                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                                        setActiveZones(prev => sel ? prev.filter(id => id !== zone.id) : [...prev, zone.id]);
                                                      }}
                                                      style={{
                                                        position: "absolute",
                                                        top: zTop,
                                                        left: zLeft,
                                                        width: zW,
                                                        height: zH,
                                                        backgroundColor: sel ? "rgba(239,68,68,0.28)" : "rgba(0,0,0,0)",
                                                        borderRadius: 6,
                                                        borderWidth: sel ? 2 : 1,
                                                        borderColor: sel ? "#EF4444" : "rgba(0,0,0,0)",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                      }}
                                                    >
                                                      {sel && (
                                                        <Text style={{ color: "#EF4444", fontSize: 9, fontWeight: "800", textAlign: "center", letterSpacing: 0.3 }}>
                                                          {zone.label.toUpperCase()}
                                                        </Text>
                                                      )}
                                                    </TouchableOpacity>
                                                  );
                                                })}
                                              </View>
                                            </View>
                                          );
                                        })()}
                                      </View>
                                    )}
                                  </View>
                                );
                              })}
                              {/* Overall Notes */}
                              <View style={{ backgroundColor: colors.background, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border }}>
                                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>📋 Overall Notes (optional)</Text>
                                <TextInput
                                  value={inspNotes}
                                  onChangeText={setInspNotes}
                                  placeholder="Additional notes (optional)..."
                                  placeholderTextColor={colors.muted}
                                  multiline
                                  numberOfLines={3}
                                  returnKeyType="done"
                                  style={{ color: colors.foreground, fontSize: 14, minHeight: 60, textAlignVertical: "top" }}
                                />
                              </View>
                            </ScrollView>
                            {/* Save button */}
                            <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 20, paddingBottom: 36, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                              <TouchableOpacity
                                onPress={saveInspection}
                                activeOpacity={0.8}
                                style={{ backgroundColor: "#10B981", borderRadius: 14, paddingVertical: 14, alignItems: "center" }}
                              >
                                <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>✓ Save Inspection</Text>
                              </TouchableOpacity>
                            </View>
                          </>
                        )}
                      </View>
                    </KeyboardAvoidingView>
                  </View>
                )}

                {/* Inline Upsell Panel - slides up inside the Job Detail Modal, no stacked Modals */}
                {showUpsellPanel && (
                  <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0, zIndex: 100 }}>
                    {/* Dim overlay */}
                    <TouchableOpacity
                      activeOpacity={1}
                      onPress={() => setShowUpsellPanel(false)}
                      style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" }}
                    />
                    {/* Panel */}
                    <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, maxHeight: "90%" }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                        <View>
                          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>Add Upsells</Text>

                        </View>
                        <TouchableOpacity onPress={() => setShowUpsellPanel(false)}>
                          <Text style={{ color: colors.muted, fontSize: 24 }}>✕</Text>
                        </TouchableOpacity>
                      </View>

                      <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
                        {/* Custom Upsell Input — at top for quick access */}
                        <View style={{ marginBottom: 16, padding: 14, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
                          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700", marginBottom: 10 }}>✏️ Custom Upsell</Text>
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            <TextInput
                              value={customUpsellName}
                              onChangeText={setCustomUpsellName}
                              placeholder="Service name..."
                              placeholderTextColor={colors.muted}
                              style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: colors.foreground, backgroundColor: colors.background, fontSize: 14 }}
                              returnKeyType="next"
                            />
                            <TextInput
                              value={customUpsellPrice}
                              onChangeText={setCustomUpsellPrice}
                              placeholder="$0.00"
                              placeholderTextColor={colors.muted}
                              keyboardType="decimal-pad"
                              style={{ width: 80, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: colors.foreground, backgroundColor: colors.background, fontSize: 14 }}
                              returnKeyType="done"
                            />
                          </View>
                        </View>

                        {ADDONS.map((ad) => {
                          const selected = upsellIds.includes(ad.id);
                          const qty = upsellQtys[ad.id] ?? 1;
                          return (
                            <View key={ad.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                              <TouchableOpacity
                                onPress={() => {
                                  if (selected) {
                                    setUpsellIds((prev) => prev.filter((id) => id !== ad.id));
                                    setUpsellQtys((prev) => { const next = { ...prev }; delete next[ad.id]; return next; });
                                  } else {
                                    setUpsellIds((prev) => [...prev, ad.id]);
                                    setUpsellQtys((prev) => ({ ...prev, [ad.id]: 1 }));
                                  }
                                }}
                                style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : "transparent", justifyContent: "center", alignItems: "center", marginRight: 12 }}
                              >
                                {selected && <Text style={{ color: "#FFF", fontSize: 14, fontWeight: "700" }}>✓</Text>}
                              </TouchableOpacity>
                              <Text style={{ fontSize: 15, marginRight: 6 }}>{ad.emoji}</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{ad.title}</Text>
                                <Text style={{ color: colors.muted, fontSize: 12 }}>${ad.price.toFixed(2)} each</Text>
                              </View>
                              {selected && (
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                  <TouchableOpacity
                                    onPress={() => setUpsellQtys((prev) => ({ ...prev, [ad.id]: Math.max(1, (prev[ad.id] ?? 1) - 1) }))}
                                    style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, justifyContent: "center", alignItems: "center" }}
                                  >
                                    <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>−</Text>
                                  </TouchableOpacity>
                                  <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600", minWidth: 20, textAlign: "center" }}>{qty}</Text>
                                  <TouchableOpacity
                                    onPress={() => setUpsellQtys((prev) => ({ ...prev, [ad.id]: (prev[ad.id] ?? 1) + 1 }))}
                                    style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, justifyContent: "center", alignItems: "center" }}
                                  >
                                    <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>+</Text>
                                  </TouchableOpacity>
                                  <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", minWidth: 52, textAlign: "right" }}>${(ad.price * qty).toFixed(2)}</Text>
                                </View>
                              )}
                            </View>
                          );
                        })}

                        {/* Custom Upsell Input moved to top */}

                        {/* Totals summary */}
                        {(() => {
                          const catalogTotal = upsellIds.reduce((sum, id) => {
                            const ad = ADDONS.find((a) => a.id === id);
                            return sum + (ad ? ad.price * (upsellQtys[id] ?? 1) : 0);
                          }, 0);
                          const customTotal = customUpsellName.trim() && parseFloat(customUpsellPrice) > 0 ? parseFloat(customUpsellPrice) : 0;
                          const total = catalogTotal + customTotal;
                          const empBonusRate = (employee?.upsellBonusPct ?? 40) / 100;
                          const bonus = total * empBonusRate;
                          const hasAny = upsellIds.length > 0 || customTotal > 0;
                          if (!hasAny) return null;
                          return (
                            <View style={{ marginTop: 12, padding: 14, backgroundColor: colors.success + "15", borderRadius: 12, borderWidth: 1, borderColor: colors.success + "40" }}>
                              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                                <Text style={{ color: colors.muted, fontSize: 13 }}>Upsell Total (added to job)</Text>
                                <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>+${total.toFixed(2)}</Text>
                              </View>

                            </View>
                          );
                        })()}

                        <TouchableOpacity
                          onPress={saveUpsells}
                          disabled={savingUpsells}
                          activeOpacity={0.8}
                          style={{ marginTop: 16, marginBottom: 8, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: "center", opacity: savingUpsells ? 0.6 : 1 }}
                        >
                          <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>
                            {savingUpsells ? "Saving..." : upsellIds.length === 0 && !(customUpsellName.trim() && parseFloat(customUpsellPrice) > 0) ? "Remove All Upsells" : "Save Upsells"}
                          </Text>
                        </TouchableOpacity>
                      </ScrollView>
                    </View>
                  </View>
                )}

                {/* ─── Recommendations Panel ─── */}
                {showRecsPanel && (
                  <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0, zIndex: 100 }}>
                    {/* Dim overlay */}
                    <TouchableOpacity
                      activeOpacity={1}
                      onPress={() => setShowRecsPanel(false)}
                      style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" }}
                    />
                    {/* Panel */}
                    <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, maxHeight: "90%" }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                        <View>
                          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>Recommend Services</Text>
                          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>Select add-ons to recommend for the next visit</Text>
                        </View>
                        <TouchableOpacity onPress={() => setShowRecsPanel(false)}>
                          <Text style={{ color: colors.muted, fontSize: 24 }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                      <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 380 }}>
                        {ADDONS.map((ad) => {
                          const selected = pendingRecIds.includes(ad.id);
                          return (
                            <TouchableOpacity
                              key={ad.id}
                              onPress={() => {
                                if (selected) {
                                  setPendingRecIds((prev) => prev.filter((id) => id !== ad.id));
                                } else {
                                  setPendingRecIds((prev) => [...prev, ad.id]);
                                }
                              }}
                              activeOpacity={0.75}
                              style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 12 }}
                            >
                              <View style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: selected ? "#8B5CF6" : colors.border, backgroundColor: selected ? "#8B5CF6" : "transparent", alignItems: "center", justifyContent: "center" }}>
                                {selected && <Text style={{ color: "#FFF", fontSize: 14, fontWeight: "800" }}>✓</Text>}
                              </View>
                              <Text style={{ fontSize: 20 }}>{ad.emoji}</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{ad.title}</Text>
                                <Text style={{ color: colors.muted, fontSize: 12 }}>${ad.price.toFixed(2)}</Text>
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                      {pendingRecIds.length > 0 && (
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                          <Text style={{ color: colors.muted, fontSize: 13 }}>{pendingRecIds.length} service{pendingRecIds.length !== 1 ? "s" : ""} selected</Text>
                        </View>
                      )}
                      <TouchableOpacity
                        onPress={saveRecommendations}
                        disabled={savingRecs}
                        activeOpacity={0.8}
                        style={{ marginTop: 16, backgroundColor: pendingRecIds.length === 0 ? colors.muted : "#8B5CF6", borderRadius: 14, paddingVertical: 14, alignItems: "center" }}
                      >
                        <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>
                          {savingRecs ? "Saving..." : pendingRecIds.length === 0 ? "Clear Recommendations" : `Save ${pendingRecIds.length} Recommendation${pendingRecIds.length !== 1 ? "s" : ""}`}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* ─── Camera Session Overlay ─── */}
                {/* Rendered inside the job detail modal to avoid iOS stacked-modal limitation.
                    iOS cannot present a second Modal on top of a transparent/pageSheet Modal,
                    so we use an absolutely-positioned View that covers the entire sheet. */}
                {showCameraSession && (
                  <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, backgroundColor: "#000" }}>
                    <CameraView
                      ref={cameraRef}
                      style={{ flex: 1 }}
                      facing={cameraFacing}
                    />
                    {/* Header: Close + Flip */}
                    <View style={{
                      position: "absolute", top: 0, left: 0, right: 0,
                      paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12,
                      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                      backgroundColor: "rgba(0,0,0,0.5)",
                    }}>
                      <TouchableOpacity
                        onPress={closeCameraSession}
                        style={{ backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 22, paddingHorizontal: 16, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 6 }}
                      >
                        <Text style={{ color: "#fff", fontSize: 18, lineHeight: 20 }}>✕</Text>
                        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 15 }}>
                          {cameraSessionPhotos.length > 0 ? `Done (${cameraSessionPhotos.length})` : "Close"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setCameraFacing((f) => f === "back" ? "front" : "back")}
                        style={{ backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 22, paddingHorizontal: 16, paddingVertical: 9 }}
                      >
                        <Text style={{ color: "#fff", fontSize: 15 }}>🔄 Flip</Text>
                      </TouchableOpacity>
                    </View>
                    {/* Thumbnail strip */}
                    {cameraSessionPhotos.length > 0 && (
                      <View style={{ position: "absolute", bottom: 148, left: 0, right: 0, paddingHorizontal: 12 }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                          {cameraSessionPhotos.map((uri, idx) => (
                            <Image key={idx} source={{ uri }} style={{ width: 64, height: 64, borderRadius: 10, borderWidth: 2, borderColor: "rgba(255,255,255,0.7)" }} resizeMode="cover" />
                          ))}
                        </ScrollView>
                      </View>
                    )}
                    {/* Shutter button */}
                    <View style={{ position: "absolute", bottom: 52, left: 0, right: 0, alignItems: "center" }}>
                      <TouchableOpacity
                        onPress={capturePhoto}
                        disabled={isCapturing}
                        style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: isCapturing ? "rgba(255,255,255,0.5)" : "#fff", borderWidth: 5, borderColor: "rgba(255,255,255,0.35)", alignItems: "center", justifyContent: "center" }}
                      >
                        {isCapturing && <ActivityIndicator color="#000" size="small" />}
                      </TouchableOpacity>
                      <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: 8 }}>Tap to capture</Text>
                    </View>
                  </View>
                )}
                {/* Late Arrival Inline Overlay — avoids iOS nested-modal issue */}
                {showLateSheet && (
                  <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)", zIndex: 999 }}>
                    <View style={{ backgroundColor: "#1e2022", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                        <Text style={{ fontSize: 18, fontWeight: "700", color: "#ECEDEE" }}>⚠️  Running Late</Text>
                        <TouchableOpacity onPress={() => setShowLateSheet(false)}>
                          <Text style={{ color: "#9BA1A6", fontSize: 22 }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={{ fontSize: 13, color: "#9BA1A6", marginBottom: 16 }}>
                        How long are you running behind? A push notification and email will be sent to {lateSheetJob?.firstName} {lateSheetJob?.lastName}.
                      </Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
                        {[15, 30, 45, 60].map((mins) => (
                          <TouchableOpacity
                            key={mins}
                            onPress={() => { setLateDelayMinutes(mins); setLateCustomMinutes(""); }}
                            style={{
                              paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5,
                              backgroundColor: lateDelayMinutes === mins && !lateCustomMinutes ? "#EF444422" : "#151718",
                              borderColor: lateDelayMinutes === mins && !lateCustomMinutes ? "#EF4444" : "#334155",
                            }}
                          >
                            <Text style={{ fontWeight: "700", color: lateDelayMinutes === mins && !lateCustomMinutes ? "#EF4444" : "#ECEDEE" }}>
                              +{mins === 60 ? "1 hr" : `${mins} min`}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 20 }}>
                        <Text style={{ color: "#9BA1A6", fontSize: 13 }}>Custom:</Text>
                        <TextInput
                          value={lateCustomMinutes}
                          onChangeText={(v) => { setLateCustomMinutes(v); if (v) setLateDelayMinutes(Number(v) || 30); }}
                          keyboardType="number-pad"
                          placeholder="e.g. 20"
                          placeholderTextColor="#9BA1A6"
                          returnKeyType="done"
                          style={{ flex: 1, borderWidth: 1, borderColor: "#334155", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: "#ECEDEE", backgroundColor: "#151718", fontSize: 14 }}
                        />
                        <Text style={{ color: "#9BA1A6", fontSize: 13 }}>min</Text>
                      </View>

                      <TouchableOpacity
                        onPress={async () => {
                          if (!lateSheetJob) return;
                          const delay = lateCustomMinutes ? (Number(lateCustomMinutes) || 30) : lateDelayMinutes;
                          const scheduledHour = lateSheetJob.startHour;
                          const hh = String(Math.floor(scheduledHour)).padStart(2, "0");
                          const mm = String(Math.round((scheduledHour % 1) * 60)).padStart(2, "0");
                          try {
                            await lateArrivalMutation.mutateAsync({
                              jobId: lateSheetJob.id,
                              customerPhone: lateSheetJob.phone,
                              customerEmail: lateSheetJob.email || undefined,
                              customerName: `${lateSheetJob.firstName} ${lateSheetJob.lastName}`,
                              detailerName: employee?.fullName ?? "Your detailer",
                              employeeId: employee?.employeeId ?? "",
                              delayMinutes: delay,
                              scheduledTime: `${hh}:${mm}`,
                            });
                            setLateNotifiedJobIds((prev) => new Set([...prev, lateSheetJob.id]));
                            setShowLateSheet(false);
                            Alert.alert("✅ Sent", `${lateSheetJob.firstName} has been notified about the delay.`);
                          } catch (err: any) {
                            Alert.alert("Error", err?.message ?? "Failed to send notification");
                          }
                        }}
                        disabled={lateArrivalMutation.isPending}
                        style={{ backgroundColor: "#EF4444", borderRadius: 14, paddingVertical: 14, alignItems: "center", opacity: lateArrivalMutation.isPending ? 0.6 : 1 }}
                        activeOpacity={0.8}
                      >
                        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
                          {lateArrivalMutation.isPending ? "Sending..." : "🔔  Notify Customer"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
                </>
              )}
            </View>
          </View>

          {/* ─── In-App Chat — rendered INSIDE job detail Modal to avoid iOS two-modal limitation ─── */}
          {showChatModal && (
            <KeyboardAvoidingView
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.background, zIndex: 999 }}
              behavior={Platform.OS === "ios" ? "padding" : "height"}
              keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
            >
              {/* Chat Header */}
              <View style={{
                flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                paddingHorizontal: 16, paddingTop: Platform.OS === "ios" ? 56 : 12, paddingBottom: 14,
                borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
                backgroundColor: colors.background,
              }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 18 }}>👤</Text>
                  </View>
                  <View>
                    <Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground }}>
                      {selectedJob ? `${selectedJob.firstName} ${selectedJob.lastName}` : "Customer"}
                    </Text>
                    <Text style={{ fontSize: 12, color: chatWindowOpen ? "#22C55E" : colors.muted, marginTop: 1 }}>
                      {chatWindowOpen ? "● Chat Active" : "● Chat Closed"}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => setShowChatModal(false)}
                  style={{ width: 36, height: 36, justifyContent: "center", alignItems: "center" }}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: colors.muted, fontSize: 22, fontWeight: "700" }}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Messages */}
              {chatListQuery.isLoading ? (
                <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : (chatListQuery.data?.messages?.length ?? 0) === 0 ? (
                <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32 }}>
                  <Text style={{ fontSize: 40, marginBottom: 12 }}>💬</Text>
                  <Text style={{ color: colors.muted, fontSize: 15, textAlign: "center" }}>
                    No messages yet.{"\n"}{chatWindowOpen ? "Start the conversation!" : "Chat window is not open."}
                  </Text>
                </View>
              ) : (
                <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
                  ref={chatFlatRef}
                  data={chatListQuery.data?.messages ?? []}
                  keyExtractor={(m: any) => String(m.id)}
                  renderItem={({ item }: { item: any }) => {
                    const isMe = item.senderType === "detailer";
                    const time = new Date(item.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                    return (
                      <View style={[{ flexDirection: "row", alignItems: "flex-end", marginBottom: 12 }, isMe ? { justifyContent: "flex-end" } : { justifyContent: "flex-start" }]}>
                        {!isMe && (
                          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center", marginRight: 8, marginBottom: 2 }}>
                            <Text style={{ color: "#fff", fontSize: 12 }}>👤</Text>
                          </View>
                        )}
                        <View style={[
                          { maxWidth: "75%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
                          isMe ? { backgroundColor: colors.primary, borderBottomRightRadius: 4 } : { backgroundColor: colors.surface, borderBottomLeftRadius: 4 }
                        ]}>
                          <Text style={{ fontSize: 15, color: isMe ? "#fff" : colors.foreground, lineHeight: 21 }}>{item.message}</Text>
                          <Text style={{ fontSize: 10, marginTop: 4, textAlign: "right", color: isMe ? "rgba(255,255,255,0.7)" : colors.muted }}>{time}</Text>
                        </View>
                      </View>
                    );
                  }}
                  contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
                  showsVerticalScrollIndicator={false}
                />
              )}

              {/* Input */}
              <View style={{
                flexDirection: "row", alignItems: "flex-end", gap: 10,
                paddingHorizontal: 16, paddingVertical: 12,
                borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
                backgroundColor: colors.background,
              }}>
                <TextInput
                  style={{
                    flex: 1, minHeight: 42, maxHeight: 120,
                    backgroundColor: colors.surface, borderRadius: 21,
                    paddingHorizontal: 16, paddingVertical: 10,
                    fontSize: 15, color: colors.foreground,
                  }}
                  value={chatMessage}
                  onChangeText={setChatMessage}
                  placeholder={chatWindowOpen ? "Message customer…" : "Chat is no longer active"}
                  placeholderTextColor={colors.muted}
                  multiline
                  maxLength={500}
                  editable={chatWindowOpen}
                  returnKeyType="send"
                  onSubmitEditing={handleChatSend}
                />
                <TouchableOpacity
                  style={[
                    { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
                    (!chatMessage.trim() || !chatWindowOpen) && { backgroundColor: colors.border },
                  ]}
                  onPress={handleChatSend}
                  disabled={!chatMessage.trim() || !chatWindowOpen || chatSendMutation.isPending}
                  activeOpacity={0.8}
                >
                  {chatSendMutation.isPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={{ color: "#fff", fontSize: 18 }}>➤</Text>
                  )}
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          )}

      </Modal>
      {/* Add Job Modal - rendered outside ScreenContainer to prevent z-index conflicts */}
      <Modal visible={showAddModal} animationType="slide" transparent onRequestClose={() => setShowAddModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
            <View style={s.modalOverlay}>
              <View style={[s.addSheet, { backgroundColor: colors.surface }]}>
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <View>
                      <Text style={[s.modalTitle, { color: colors.foreground }]}>New Job</Text>
                      <Text style={[s.modalSubtitle, { color: colors.muted }]}>
                        {formatFullDate(selectedDate)} · {formatHour(startHour)}–{formatHour(endHour)}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => setShowAddModal(false)}><Text style={{ color: colors.muted, fontSize: 24 }}>✕</Text></TouchableOpacity>
                  </View>

                  <Text style={[s.sectionLabel, { color: colors.muted }]}>CUSTOMER</Text>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TextInput value={firstName} onChangeText={setFirstName} placeholder="First Name *" placeholderTextColor={colors.muted} style={[s.input, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
                    <TextInput value={lastName} onChangeText={setLastName} placeholder="Last Name *" placeholderTextColor={colors.muted} style={[s.input, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
                  </View>
                  <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={colors.muted} keyboardType="email-address" autoCapitalize="none" style={[s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
                  <TextInput value={phone} onChangeText={setPhone} placeholder="Phone" placeholderTextColor={colors.muted} keyboardType="phone-pad" style={[s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
                   <AddressAutocomplete
                     value={address}
                     onChangeText={setAddress}
                     onSelectAddress={setAddress}
                     placeholder="Address *"
                     style={{ marginBottom: 10, zIndex: 999 }}
                   />

                  <Text style={[s.sectionLabel, { color: colors.muted, marginTop: 8 }]}>VEHICLE TYPE</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                    {VEHICLE_TYPES.filter((v) => !v.group).map((v) => {
                      const sel = vehicleType === v.id;
                      return (
                        <TouchableOpacity
                          key={v.id}
                          onPress={() => {
                            setVehicleType(v.id);
                            setPackageId(undefined);
                            setAddonIds([]);
                            setServiceTitle("");
                            setServiceDescription("");
                            setPrice("");
                          }}
                          style={[
                            s.vehicleChip,
                            { backgroundColor: sel ? colors.primary : colors.surface, borderColor: sel ? colors.primary : colors.border }
                          ]}
                          activeOpacity={0.75}
                        >
                          <Text style={{ fontSize: 18 }}>{v.emoji}</Text>
                          <Text style={{ color: sel ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13, marginLeft: 6 }}>{v.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={[s.sectionLabel, { color: colors.muted, marginTop: 6, marginBottom: 4 }]}>RV</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                    {VEHICLE_TYPES.filter((v) => v.group === "rv").map((v) => {
                      const sel = vehicleType === v.id;
                      return (
                        <TouchableOpacity
                          key={v.id}
                          onPress={() => {
                            setVehicleType(v.id);
                            setPackageId(undefined);
                            setAddonIds([]);
                            setServiceTitle("");
                            setServiceDescription("");
                            setPrice("");
                          }}
                          style={[
                            s.vehicleChip,
                            { backgroundColor: sel ? colors.primary : colors.surface, borderColor: sel ? colors.primary : colors.border }
                          ]}
                          activeOpacity={0.75}
                        >
                          <Text style={{ fontSize: 18 }}>{v.emoji}</Text>
                          <Text style={{ color: sel ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13, marginLeft: 6 }}>{v.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {vehicleType && (
                    <>
                      <Text style={[s.sectionLabel, { color: colors.muted }]}>PACKAGE</Text>
                      {allJobPackages.filter((p) => isRvVehicle(vehicleType) ? p.isRv : !p.isRv).length === 0 && (
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
                      {allJobPackages.filter((p) => isRvVehicle(vehicleType) ? p.isRv : !p.isRv).map((p) => {
                        const pkgPrice = (p.basePrice[vehicleType] ?? 0);
                        const sel = packageId === p.id;
                        return (
                          <TouchableOpacity
                            key={p.id}
                            onPress={() => {
                              setPackageId(p.id);
                              setAddonIds([]);
                              const addonTotal = 0;
                              setServiceTitle(p.title);
                              setServiceDescription(p.tagline);
                              setPrice((pkgPrice + addonTotal).toString());
                            }}
                            style={[
                              s.pkgRow,
                              { backgroundColor: sel ? colors.primary + "15" : colors.surface, borderColor: sel ? colors.primary : colors.border, borderWidth: sel ? 2 : 1 }
                            ]}
                            activeOpacity={0.8}
                          >
                            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                              <Text style={{ fontSize: 20, marginRight: 8 }}>{p.emoji}</Text>
                              <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15, flex: 1 }}>{p.title}</Text>
                              <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 16 }}>${pkgPrice.toFixed(2)}</Text>
                            </View>
                            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17, marginLeft: 28 }}>{p.tagline}</Text>
                            {sel && (
                              <View style={{ marginTop: 8, marginLeft: 28 }}>
                                {p.features.map((f) => (
                                  <View key={f} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
                                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
                                    <Text style={{ color: colors.foreground, fontSize: 13 }}>{f}</Text>
                                  </View>
                                ))}
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  )}

                  {!isJobSyncCompany && vehicleType && packageId && (
                    <>
                      <Text style={[s.sectionLabel, { color: colors.muted, marginTop: 4 }]}>ADD-ONS (OPTIONAL)</Text>
                      {ADDONS.map((a) => {
                        const qty = addonQtys[a.id] ?? 0;
                        const recalc = (newQtys: Record<string, number>) => {
                          const pkg = allJobPackages.find((p) => p.id === packageId);
                          if (!pkg) return;
                          const pkgPrice = (pkg.basePrice[vehicleType] ?? 0);
                          const addonsTotal = ADDONS.reduce((s, ad) => s + ad.price * (newQtys[ad.id] ?? 0), 0);
                          const totalQty = Object.values(newQtys).reduce((s, q) => s + q, 0);
                          setServiceTitle(pkg.title + (totalQty > 0 ? ` + ${totalQty} Add-on${totalQty > 1 ? "s" : ""}` : ""));
                          setPrice((pkgPrice + addonsTotal).toString());
                          setAddonIds(ADDONS.filter((ad) => (newQtys[ad.id] ?? 0) > 0).map((ad) => ad.id));
                        };
                        return (
                          <View key={a.id} style={[s.addonRow, { backgroundColor: qty > 0 ? colors.primary + "10" : colors.surface, borderColor: qty > 0 ? colors.primary : colors.border, borderWidth: qty > 0 ? 1.5 : 1 }]}>
                            <Text style={{ fontSize: 20, marginRight: 8 }}>{a.emoji}</Text>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 13 }}>{a.title}</Text>
                              <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 12 }}>${a.price}{qty > 1 ? ` × ${qty} = $${(a.price * qty).toFixed(0)}` : ""}</Text>
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <TouchableOpacity
                                onPress={() => {
                                  const newQty = Math.max(0, qty - 1);
                                  const newQtys = { ...addonQtys, [a.id]: newQty };
                                  if (newQty === 0) delete newQtys[a.id];
                                  setAddonQtys(newQtys);
                                  recalc(newQtys);
                                }}
                                style={[s.qtyBtn, { borderColor: colors.border, opacity: qty === 0 ? 0.3 : 1 }]}
                                disabled={qty === 0}
                              >
                                <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>−</Text>
                              </TouchableOpacity>
                              <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14, minWidth: 18, textAlign: "center" }}>{qty}</Text>
                              <TouchableOpacity
                                onPress={() => {
                                  const newQty = qty + 1;
                                  const newQtys = { ...addonQtys, [a.id]: newQty };
                                  setAddonQtys(newQtys);
                                  recalc(newQtys);
                                }}
                                style={[s.qtyBtn, { borderColor: colors.border }]}
                              >
                                <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "700" }}>+</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })}
                      {addonIds.length > 0 && (
                        <View style={[s.priceSummaryRow, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "44", marginTop: 8 }]}>
                          <Text style={{ color: colors.foreground, fontWeight: "600" }}>Total</Text>
                          <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 18 }}>${price}</Text>
                        </View>
                      )}
                    </>
                  )}

                  <Text style={[s.sectionLabel, { color: colors.muted, marginTop: 12 }]}>TIME SLOT</Text>
                  {isAdminRole ? (
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.fieldLabel, { color: colors.muted }]}>Start</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <TouchableOpacity onPress={() => setStartHour((h) => Math.max(8, h - 0.5))} style={[s.hourBtn, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>−</Text></TouchableOpacity>
                          <Text style={{ color: colors.foreground, fontSize: 13, flex: 1, textAlign: "center" }}>{formatHour(startHour)}</Text>
                          <TouchableOpacity onPress={() => setStartHour((h) => Math.min(16.5, h + 0.5))} style={[s.hourBtn, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>+</Text></TouchableOpacity>
                        </View>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.fieldLabel, { color: colors.muted }]}>End</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <TouchableOpacity onPress={() => setEndHour((h) => Math.max(startHour + 0.5, h - 0.5))} style={[s.hourBtn, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>−</Text></TouchableOpacity>
                          <Text style={{ color: colors.foreground, fontSize: 13, flex: 1, textAlign: "center" }}>{formatHour(endHour)}</Text>
                          <TouchableOpacity onPress={() => setEndHour((h) => Math.min(17, h + 0.5))} style={[s.hourBtn, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>+</Text></TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  ) : (
                    <View style={{ backgroundColor: colors.surface, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600", textAlign: "center" }}>
                        {formatHour(startHour)} – {formatHour(endHour)}
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 4 }}>Time set by admin</Text>
                    </View>
                  )}

                  {/* Detailer Picker — only shown for admins */}
                  {isAdminRole && detailerList && detailerList.length > 0 && (
                    <>
                      <Text style={[s.sectionLabel, { color: colors.muted, marginTop: 12 }]}>ASSIGN TEAM MEMBER</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <TouchableOpacity
                            onPress={() => setAssignedDetailerId(undefined)}
                            activeOpacity={0.75}
                            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: !assignedDetailerId ? colors.primary : colors.surface, borderWidth: 1, borderColor: !assignedDetailerId ? colors.primary : colors.border }}
                          >
                            <Text style={{ fontSize: 13, fontWeight: "600", color: !assignedDetailerId ? "#FFF" : colors.muted }}>Unassigned</Text>
                          </TouchableOpacity>
                          {(detailerList as any[]).filter((d: any) => d.city ? cityToSlug(d.city) === selectedLocation : true).map((d: any) => (
                            <TouchableOpacity
                              key={d.employeeId}
                              onPress={() => setAssignedDetailerId(d.employeeId)}
                              activeOpacity={0.75}
                              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: assignedDetailerId === d.employeeId ? colors.primary : colors.surface, borderWidth: 1, borderColor: assignedDetailerId === d.employeeId ? colors.primary : colors.border }}
                            >
                              <Text style={{ fontSize: 13, fontWeight: "600", color: assignedDetailerId === d.employeeId ? "#FFF" : colors.foreground }}>{d.fullName?.split(" ")[0] ?? d.fullName}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView>
                    </>
                  )}

                  <Text style={[s.sectionLabel, { color: colors.muted, marginTop: 12 }]}>NOTES (OPTIONAL)</Text>
                  <TextInput value={notes} onChangeText={setNotes} placeholder="Special instructions..." placeholderTextColor={colors.muted} multiline numberOfLines={2} style={[s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, minHeight: 56 }]} />

                  {/* Notify Customer toggle */}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 4, marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>Notify customer</Text>
                      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                        {notifyCustomer ? "Confirmation email will be sent" : "No email will be sent"}
                      </Text>
                    </View>
                    <Switch
                      value={notifyCustomer}
                      onValueChange={setNotifyCustomer}
                      trackColor={{ false: colors.border, true: "#0057FF" }}
                      thumbColor={"#ffffff"}
                      ios_backgroundColor={colors.border}
                    />
                  </View>

                  <View style={{ flexDirection: "row", gap: 12, marginTop: 16, marginBottom: 8 }}>
                    <TouchableOpacity onPress={() => setShowAddModal(false)} style={[s.modalBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}><Text style={{ color: colors.foreground, fontWeight: "600" }}>Cancel</Text></TouchableOpacity>
                    <TouchableOpacity onPress={saveJob} style={[s.modalBtn, { backgroundColor: colors.primary, opacity: isFormValid ? 1 : 0.4 }]} disabled={!isFormValid}><Text style={{ color: "#fff", fontWeight: "600" }}>Save Job</Text></TouchableOpacity>
                  </View>
                </ScrollView>
              </View>
            </View>
          </KeyboardAvoidingView>
      </Modal>

      {/* Checkout Modal - rendered at root level to avoid iOS nested-modal issue */}
      {companyScheduleCheckoutMounted({ authority: companyAuthority, showCheckout }) && (checkoutJobRef.current ?? selectedJob) && (
        <CheckoutModal
          visible={showCheckout}
          job={(checkoutJobRef.current ?? selectedJob)!}
          onClose={() => {
            setShowCheckout(false);
            // Re-open the job detail so the user can go back after cancelling
            if (checkoutJobRef.current) {
              setTimeout(() => {
                setSelectedJob(checkoutJobRef.current);
                checkoutJobRef.current = null;
              }, 300);
            }
          }}
          onComplete={(p) => {
            handlePaymentComplete(p);
            checkoutJobRef.current = null;
          }}
        />
      )}

      {/* In-app navigation modal */}
      <NavigationMapModal
        visible={navVisible}
        destination={navJob?.address ?? ""}
        jobName={navJob ? `${navJob.firstName} ${navJob.lastName}`.trim() : undefined}
        apiKey={process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""}
        jobId={navJob?.id}
        detailerName={employee?.fullName ?? undefined}
        onArrive={() => {
          setNavVisible(false);
          const jobId = navJob?.id;
          setNavJob(null);
          if (jobId) {
            const now = new Date().toISOString();
            // Use jobsRef to get the latest job state (navJob snapshot may be stale)
            const liveJob = jobsRef.current.find((j) => j.id === jobId) ?? navJob!;
            const timestamps: Partial<Job> = { arrivedAt: now, jobStartedAt: now };
            stopLocationSharing(jobId);
            stampTimestampMutation.mutate({ jobId, field: "arrivedAt", timestamp: now });
            const updatedJob = { ...liveJob, status: "arrived" as JobStatus, ...timestamps };
            const updated = jobsRef.current.map((j) => j.id === jobId ? updatedJob : j);
            persistJobs(updated);
            // online_ jobs ARE in schedule_jobs — only portal_ uses a separate path
            if (!jobId.startsWith("portal_")) {
              jobStatusMutation.mutate({ jobId, status: "confirmed" });
            }
            if (jobId.startsWith("portal_") && liveJob.bookingId) {
              portalBookingStatusMutation.mutate({ bookingRef: liveJob.bookingId, status: "arrived" as any });
            }
            // Reopen job detail after nav modal has fully dismissed
            setTimeout(() => setSelectedJob(updatedJob), 350);
          }
        }}
        onClose={() => {
          const jobId = navJob?.id;
          const liveJob = jobId ? jobsRef.current.find((j) => j.id === jobId) ?? navJob : null;
          // Ask detailer if they've arrived before closing navigation
          Alert.alert(
            "Close Navigation",
            "Have you arrived at the customer's location?",
            [
              {
                text: "Not Yet",
                style: "cancel",
                onPress: () => {
                  // Just close the nav modal — keep location sharing running
                  setNavVisible(false);
                  setNavJob(null);
                  if (liveJob) setTimeout(() => setSelectedJob(liveJob), 350);
                },
              },
              {
                text: "Yes, Arrived",
                onPress: () => {
                  setNavVisible(false);
                  setNavJob(null);
                  if (jobId && liveJob) {
                    const now = new Date().toISOString();
                    const timestamps: Partial<Job> = { arrivedAt: now, jobStartedAt: now };
                    stopLocationSharing(jobId);
                    stampTimestampMutation.mutate({ jobId, field: "arrivedAt", timestamp: now });
                    const updatedJob = { ...liveJob, status: "arrived" as JobStatus, ...timestamps };
                    const updated = jobsRef.current.map((j) => j.id === jobId ? updatedJob : j);
                    persistJobs(updated);
                    if (!jobId.startsWith("portal_")) {
                      jobStatusMutation.mutate({ jobId, status: "confirmed" });
                    }
                    if (jobId.startsWith("portal_") && liveJob.bookingId) {
                      portalBookingStatusMutation.mutate({ bookingRef: liveJob.bookingId, status: "arrived" as any });
                    }
                    setTimeout(() => setSelectedJob(updatedJob), 350);
                  }
                },
              },
            ]
          );
        }}
      />

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

      {/* ─── Edit Services Bottom Sheet ─── */}
      <Modal
        visible={showEditServicesSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEditServicesSheet(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={[s.modalOverlay, { justifyContent: "flex-end" }]}>
            <View style={[s.addSheet, { backgroundColor: colors.background, maxHeight: "92%" }]}>
              {/* Sheet header */}
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
                <Text style={[s.modalTitle, { color: colors.foreground, flex: 1 }]}>Edit Vehicles & Services</Text>
                <TouchableOpacity onPress={() => setShowEditServicesSheet(false)} style={{ padding: 4 }}>
                  <Text style={{ color: colors.muted, fontSize: 22, fontWeight: "700" }}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {editVehicles.map((ev, evIdx) => {
                  const evVt = VEHICLE_TYPES.find((v) => v.id === ev.vehicleType);
                  const evPkgs = isRvVehicle(ev.vehicleType as VehicleType) ? allJobPackages.filter((p) => p.isRv) : allJobPackages.filter((p) => !p.isRv);
                  return (
                    <View key={evIdx} style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 14 }}>
                      {/* Vehicle header row */}
                      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
                        <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15, flex: 1 }}>
                          {evVt?.emoji ?? "🚗"} Vehicle {evIdx + 1}
                        </Text>
                        {editVehicles.length > 1 && (
                          <TouchableOpacity
                            onPress={() => setEditVehicles((prev) => prev.filter((_, i) => i !== evIdx))}
                            style={{ backgroundColor: colors.error + "22", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}
                            activeOpacity={0.75}
                          >
                            <Text style={{ color: colors.error, fontSize: 13, fontWeight: "700" }}>Remove</Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Vehicle type chips */}
                      <Text style={[s.sectionLabel, { color: colors.muted, marginBottom: 6 }]}>Vehicle Type</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                        {VEHICLE_TYPES.filter((v) => !v.group).map((v) => {
                          const sel = ev.vehicleType === v.id;
                          return (
                            <TouchableOpacity
                              key={v.id}
                              onPress={() => setEditVehicles((prev) => prev.map((x, i) => i === evIdx ? { ...x, vehicleType: v.id as VehicleType, packageId: "", addonIds: [], addonQtys: {}, price: 0 } : x))}
                              style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : colors.surface }}
                              activeOpacity={0.75}
                            >
                              <Text style={{ fontSize: 14 }}>{v.emoji}</Text>
                              <Text style={{ color: sel ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 12, marginLeft: 5 }}>{v.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <Text style={[s.sectionLabel, { color: colors.muted, marginBottom: 6 }]}>RV</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                        {VEHICLE_TYPES.filter((v) => v.group === "rv").map((v) => {
                          const sel = ev.vehicleType === v.id;
                          return (
                            <TouchableOpacity
                              key={v.id}
                              onPress={() => setEditVehicles((prev) => prev.map((x, i) => i === evIdx ? { ...x, vehicleType: v.id as VehicleType, packageId: "", addonIds: [], addonQtys: {}, price: 0 } : x))}
                              style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : colors.surface }}
                              activeOpacity={0.75}
                            >
                              <Text style={{ fontSize: 14 }}>{v.emoji}</Text>
                              <Text style={{ color: sel ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 12, marginLeft: 5 }}>{v.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {/* Package selection */}
                      {ev.vehicleType ? (
                        <>
                          <Text style={[s.sectionLabel, { color: colors.muted, marginBottom: 6 }]}>Package</Text>
                          {evPkgs.map((p) => {
                            const pkgPrice = (p.basePrice as Partial<Record<VehicleType, number>>)[ev.vehicleType as VehicleType] ?? 0;
                            const sel = ev.packageId === p.id;
                            return (
                              <TouchableOpacity
                                key={p.id}
                                onPress={() => setEditVehicles((prev) => prev.map((x, i) => i === evIdx ? { ...x, packageId: p.id, price: pkgPrice } : x))}
                                style={{ borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: sel ? 2 : 1, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary + "15" : colors.background }}
                                activeOpacity={0.8}
                              >
                                <View style={{ flexDirection: "row", alignItems: "center" }}>
                                  <Text style={{ fontSize: 16, marginRight: 8 }}>{p.emoji}</Text>
                                  <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 13, flex: 1 }}>{p.title}</Text>
                                  <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 14 }}>${pkgPrice}</Text>
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                        </>
                      ) : null}

                      {/* Add-ons */}
                      {ev.vehicleType ? (
                        <>
                          <Text style={[s.sectionLabel, { color: colors.muted, marginTop: 8, marginBottom: 6 }]}>Add-Ons</Text>
                          {ADDONS.map((ad) => {
                            const selected = (ev.addonIds ?? []).includes(ad.id);
                            const qty = ev.addonQtys?.[ad.id] ?? 1;
                            return (
                              <View key={ad.id} style={{ flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + "10" : colors.background, padding: 10, marginBottom: 6 }}>
                                <TouchableOpacity
                                  onPress={() => {
                                    setEditVehicles((prev) => prev.map((x, i) => {
                                      if (i !== evIdx) return x;
                                      const newIds = selected ? (x.addonIds ?? []).filter((id) => id !== ad.id) : [...(x.addonIds ?? []), ad.id];
                                      const newQtys = { ...(x.addonQtys ?? {}) };
                                      if (!selected) newQtys[ad.id] = 1;
                                      else delete newQtys[ad.id];
                                      return { ...x, addonIds: newIds, addonQtys: newQtys };
                                    }));
                                  }}
                                  style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
                                  activeOpacity={0.75}
                                >
                                  <Text style={{ fontSize: 16, marginRight: 8 }}>{ad.emoji}</Text>
                                  <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 13, flex: 1 }}>{ad.title}</Text>
                                  <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>+${ad.price}</Text>
                                </TouchableOpacity>
                                {selected && (
                                  <View style={{ flexDirection: "row", alignItems: "center", marginLeft: 8, gap: 6 }}>
                                    <TouchableOpacity
                                      onPress={() => setEditVehicles((prev) => prev.map((x, i) => {
                                        if (i !== evIdx) return x;
                                        const newQtys = { ...(x.addonQtys ?? {}) };
                                        if ((newQtys[ad.id] ?? 1) <= 1) {
                                          const newIds = (x.addonIds ?? []).filter((id) => id !== ad.id);
                                          delete newQtys[ad.id];
                                          return { ...x, addonIds: newIds, addonQtys: newQtys };
                                        }
                                        newQtys[ad.id] = (newQtys[ad.id] ?? 1) - 1;
                                        return { ...x, addonQtys: newQtys };
                                      }))}
                                      style={[s.qtyBtn, { borderColor: colors.border }]}
                                    >
                                      <Text style={{ color: colors.foreground, fontWeight: "700" }}>−</Text>
                                    </TouchableOpacity>
                                    <Text style={{ color: colors.foreground, fontWeight: "700", minWidth: 16, textAlign: "center" }}>{qty}</Text>
                                    <TouchableOpacity
                                      onPress={() => setEditVehicles((prev) => prev.map((x, i) => {
                                        if (i !== evIdx) return x;
                                        const newQtys = { ...(x.addonQtys ?? {}), [ad.id]: (x.addonQtys?.[ad.id] ?? 1) + 1 };
                                        return { ...x, addonQtys: newQtys };
                                      }))}
                                      style={[s.qtyBtn, { borderColor: colors.border }]}
                                    >
                                      <Text style={{ color: colors.foreground, fontWeight: "700" }}>+</Text>
                                    </TouchableOpacity>
                                  </View>
                                )}
                              </View>
                            );
                          })}
                        </>
                      ) : null}

                      {/* Vehicle subtotal */}
                      {ev.price > 0 && (
                        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 4 }}>
                          <Text style={{ color: colors.muted, fontSize: 13 }}>Vehicle {evIdx + 1} subtotal</Text>
                          <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>
                            ${(ev.price + (ev.addonIds ?? []).reduce((s, id) => s + (ADDONS.find((a) => a.id === id)?.price ?? 0) * (ev.addonQtys?.[id] ?? 1), 0)).toFixed(2)}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })}

                {/* Add Another Vehicle */}
                <TouchableOpacity
                  onPress={() => setEditVehicles((prev) => [...prev, { vehicleType: "sedan" as VehicleType, packageId: "", addonIds: [], addonQtys: {}, price: 0 }])}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 12, paddingVertical: 12, marginBottom: 16, backgroundColor: colors.primary + "0D" }}
                  activeOpacity={0.75}
                >
                  <Text style={{ color: colors.primary, fontSize: 18, fontWeight: "700" }}>+</Text>
                  <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>Add Another Vehicle</Text>
                </TouchableOpacity>

                {/* Running total */}
                {editVehicles.length > 0 && (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.primary + "44", backgroundColor: colors.primary + "12", padding: 14, marginBottom: 16 }}>
                    <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14 }}>
                      Total ({editVehicles.length} vehicle{editVehicles.length !== 1 ? "s" : ""})
                    </Text>
                    <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 17 }}>
                      ${editVehicles.reduce((sum, ev) => {
                        const addonSum = (ev.addonIds ?? []).reduce((s, id) => s + (ADDONS.find((a) => a.id === id)?.price ?? 0) * (ev.addonQtys?.[id] ?? 1), 0);
                        return sum + ev.price + addonSum;
                      }, 0).toFixed(2)}
                    </Text>
                  </View>
                )}

                {/* Action buttons */}
                <View style={{ flexDirection: "row", gap: 12, marginBottom: 8 }}>
                  <TouchableOpacity
                    onPress={() => setShowEditServicesSheet(false)}
                    style={[s.modalBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
                  >
                    <Text style={{ color: colors.foreground, fontWeight: "600" }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={async () => {
                      if (!selectedJob || savingEditServices) return;
                      setSavingEditServices(true);
                      try {
                        // Separate primary vehicle (index 0) from additional vehicles
                        const [primary, ...rest] = editVehicles;
                        const primaryAddonSum = (primary?.addonIds ?? []).reduce((s, id) => s + (ADDONS.find((a) => a.id === id)?.price ?? 0) * (primary?.addonQtys?.[id] ?? 1), 0);
                        const primaryTotal = (primary?.price ?? 0) + primaryAddonSum;
                        const extraTotal = rest.reduce((sum, ev) => {
                          const addonSum = (ev.addonIds ?? []).reduce((s, id) => s + (ADDONS.find((a) => a.id === id)?.price ?? 0) * (ev.addonQtys?.[id] ?? 1), 0);
                          return sum + ev.price + addonSum;
                        }, 0);
                        const newTotal = primaryTotal + extraTotal;
                        const updatedJob: Job = {
                          ...selectedJob,
                          vehicleType: primary?.vehicleType ?? selectedJob.vehicleType,
                          packageId: primary?.packageId ?? selectedJob.packageId,
                          addonIds: primary?.addonIds ?? [],
                          addonQtys: primary?.addonQtys ?? {},
                          price: newTotal,
                          basePrice: newTotal,
                          additionalVehicles: rest.length > 0 ? rest : undefined,
                        };
                        const updatedJobs = jobs.map((j) => j.id === selectedJob.id ? updatedJob : j);
                        persistJobs(updatedJobs);
                        setSelectedJob(updatedJob);
                        syncJobToServer(updatedJob);
                        setShowEditServicesSheet(false);
                        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        Alert.alert("Services Updated", `${editVehicles.length} vehicle${editVehicles.length !== 1 ? "s" : ""} · $${newTotal.toFixed(2)} total`, [{ text: "OK" }]);
                      } catch {
                        Alert.alert("Error", "Failed to save. Please try again.");
                      } finally {
                        setSavingEditServices(false);
                      }
                    }}
                    style={[s.modalBtn, { backgroundColor: colors.primary, opacity: savingEditServices ? 0.6 : 1 }]}
                    disabled={savingEditServices}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700" }}>{savingEditServices ? "Saving..." : "Save Services"}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>


    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 20, fontWeight: "700" },
  todayBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, borderWidth: 1.5 },
  todayBtnText: { fontWeight: "600", fontSize: 14 },
  addBtn: { width: 34, height: 34, borderRadius: 17, justifyContent: "center", alignItems: "center" },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 22, lineHeight: 26 },
  weekStrip: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  weekArrow: { paddingHorizontal: 8 },
  weekDayCell: { flex: 1, alignItems: "center" },
  weekDayName: { fontSize: 11, fontWeight: "600", letterSpacing: 0.2, marginBottom: 4 },
  weekDayNumCircle: { width: 30, height: 30, borderRadius: 15, justifyContent: "center", alignItems: "center" },
  weekDayNum: { fontSize: 15, fontWeight: "700" },
  dayDot: { width: 5, height: 5, borderRadius: 3, marginTop: 3 },
  dayLabel: { paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  dayLabelText: { fontSize: 14, fontWeight: "500" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  detailSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40, maxHeight: "90%", overflow: "hidden" },
  addSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, maxHeight: "92%" },
  modalTitle: { fontSize: 20, fontWeight: "700" },
  modalSubtitle: { fontSize: 12, marginTop: 2 },
  sectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 8, textTransform: "uppercase" },
  fieldLabel: { fontSize: 12, fontWeight: "500", marginBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: "700" },
  detailCard: { borderRadius: 0, borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 0, borderRightWidth: 0, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 8, gap: 4 },
  detailValue: { fontSize: 16, fontWeight: "600" },
  detailSub: { fontSize: 14, lineHeight: 20 },
  divider: { height: 1, marginVertical: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  deleteBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 8 },
  gpsBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginLeft: 8, flexShrink: 0 },
  gpsBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 10 },
  hourBtn: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, justifyContent: "center", alignItems: "center" },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  statusIconCircle: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, justifyContent: "center", alignItems: "center", marginBottom: 6 },
  statusIconLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  photoAddBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16 },
  photoAddBtnText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  emptyPhotos: { borderWidth: 1, borderStyle: "dashed", borderRadius: 10, paddingVertical: 20, alignItems: "center" },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoThumb: { width: 90, height: 90, borderRadius: 8, overflow: "hidden" },
  photoImg: { width: 90, height: 90 },
  payBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  payBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  paymentSummary: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 14 },
  paidBadgeLarge: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  selectServiceBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center", marginBottom: 8 },
  serviceSelected: { borderRadius: 14, borderWidth: 1.5, padding: 14, flexDirection: "row", alignItems: "center", marginBottom: 8 },
  changeServiceBtn: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  vehicleChip: { flexDirection: "row", alignItems: "center", borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 8 },
  pkgRow: { borderRadius: 14, padding: 14, marginBottom: 10 },
  addonChip: { flexDirection: "row", alignItems: "center", borderRadius: 12, padding: 10, width: "47%" },
  addonRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, padding: 12, marginBottom: 8 },
  qtyBtn: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, justifyContent: "center", alignItems: "center" },
  priceSummaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
});
