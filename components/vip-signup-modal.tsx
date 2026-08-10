/**
 * VipSignupModal
 * Self-serve VIP / Maintenance program signup for logged-in customers.
 *
 * Steps:
 *   1. Plan selection (Maintenance / VIP / VIP Elite)
 *   2. Personal info + vehicle details (pre-filled from auth)
 *   3. Scheduling preferences
 *   4. Contract preview + e-signature
 *   5. Payment (saved card on file OR new card entry)
 */

import React, { useState, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { MaterialIcons } from "@expo/vector-icons";
import { trpc } from "@/lib/trpc";

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = "https://luxwashapp-n2wveyqg.manus.space";

const PLAN_PRICES: Record<PlanType, number> = {
  maintenance: 1500,
  vip: 1200,
  vip_elite: 1600,
};

// VIP Elite pricing by credit count
const ELITE_PRICES: Record<number, number> = { 6: 900, 12: 1600 };
const ELITE_MONTHLY: Record<number, string> = { 6: "$150/mo", 12: "$133/mo" };

// Monthly equivalent for display
const PLAN_MONTHLY: Record<PlanType, string> = {
  maintenance: "$125/mo",
  vip: "$100/mo",
  vip_elite: "$133/mo",
};

const WEEK_LABELS = ["1st", "2nd", "3rd", "4th", "Last"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ─── Types ────────────────────────────────────────────────────────────────────

type PlanType = "maintenance" | "vip" | "vip_elite";
type Step = "plan" | "info" | "schedule" | "contract" | "payment" | "success";

interface CustomerInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleColor: string;
}

interface SchedulePrefs {
  scheduleWeek: number | null;
  scheduleDay: number | null;
  eliteScheduleMode: "auto" | "credits";
  eliteCreditCount: 6 | 12;
}

// ─── Signature Canvas ─────────────────────────────────────────────────────────

interface SigRef {
  clear: () => void;
  hasSignature: () => boolean;
}

interface Point { x: number; y: number; }

const SignatureCanvas = React.forwardRef<SigRef, { onSign?: () => void }>(
  ({ onSign }, ref) => {
    const [paths, setPaths] = useState<Point[][]>([]);
    const [current, setCurrent] = useState<Point[]>([]);

    React.useImperativeHandle(ref, () => ({
      clear: () => { setPaths([]); setCurrent([]); },
      hasSignature: () => paths.length > 0,
    }));

    const toD = (pts: Point[]) => {
      if (pts.length < 2) return "";
      return `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");
    };

    const all = [...paths, current];

    return (
      <View
        style={{ flex: 1, backgroundColor: "#F9FAFB", borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB" }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => {
          const { locationX, locationY } = e.nativeEvent;
          setCurrent([{ x: locationX, y: locationY }]);
        }}
        onResponderMove={(e) => {
          const { locationX, locationY } = e.nativeEvent;
          setCurrent(prev => [...prev, { x: locationX, y: locationY }]);
          onSign?.();
        }}
        onResponderRelease={() => {
          if (current.length > 0) {
            setPaths(prev => [...prev, current]);
            setCurrent([]);
          }
        }}
      >
        <Svg width="100%" height="100%">
          {all.map((pts, i) => {
            const d = toD(pts);
            if (!d) return null;
            return <Path key={i} d={d} stroke="#1A1A1A" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
          })}
        </Svg>
        {paths.length === 0 && current.length === 0 && (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#9CA3AF", fontSize: 14 }}>Sign here with your finger</Text>
          </View>
        )}
      </View>
    );
  }
);

// ─── Plan definitions ─────────────────────────────────────────────────────────

const PLANS = {
  maintenance: {
    icon: "🔧",
    title: "Maintenance Program",
    badge: "STANDARD",
    color: "#059669",
    price: PLAN_PRICES.maintenance,
    perMonth: 125,
    tagline: "Consistent professional detailing on a recurring schedule. Clean car, zero effort — every single time.",
    bullets: [
      "Monthly full detail service \u2014 recurring until canceled",
      "Same day every month \u2014 no rescheduling needed",
      "Cancel anytime with 7 days notice",
      "Priority scheduling \u2014 first access to slots",
      "$125/month \u2014 billed monthly to card on file",
      "Exterior wash, interior vacuum & wipe-down",
      "Windows, mirrors, and tire shine included",
    ],
    note: "Month-to-month subscription. Cancel anytime. Your car is serviced on the same day every month.",
  },
  vip: {
    icon: "⭐",
    title: "VIP Program",
    badge: "PREMIUM",
    color: "#7C3AED",
    price: PLAN_PRICES.vip,
    perMonth: 100,
    tagline: "Full detail service plus rotating premium add-ons every visit. The ultimate hands-off car care experience.",
    bullets: [
      "12 monthly full detail services",
      "Paint Sealant on visits 1 & 7",
      "Leather Deep Clean on visits 1, 5 & 9",
      "Leather Conditioning on visits 1 & 7",
      "Shampoo treatments as needed",
      "Priority scheduling — first access to slots",
      "We set all your appointment dates",
      "Annual contract, one upfront payment",
    ],
    note: "Premium add-ons rotate automatically — you never have to ask. Your car gets the full treatment every year.",
  },
  vip_elite: {
    icon: "👑",
    title: "VIP Elite Program",
    badge: "ELITE",
    color: "#0a7ea4",
    price: PLAN_PRICES.vip_elite,
    perMonth: 133,
    tagline: "The pinnacle of car care. 2 Luxury Details + 10 Basic Details — use them anytime, in any order you choose.",
    bullets: [
      "12 total services over 12 months",
      "2 Full Luxury Details (deep clean, clay bar, polish, sealant) — use anytime",
      "10 Basic Details (exterior wash, interior clean, windows, tires) — use anytime",
      "Mix & match — schedule your Luxury or Basic Detail whenever you want",
      "Priority scheduling — first access to slots",
      "Option: have us pre-schedule all appointments",
      "Option: self-schedule at your convenience",
      "Annual contract, one upfront payment",
    ],
    note: "You decide when to use your Luxury Details and when to use your Basic Details — total flexibility, all year long.",
  },
} as const;

// ─── Contract Data Builder ────────────────────────────────────────────────────

interface ContractData {
  planTitle: string;
  planColor: string;
  programType: PlanType;
  today: string;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  vehicle: string;
  billingNote: string;
  services: { label: string; count?: number; description: string }[];
  serviceChecklist: string[];
  scheduleDesc: string;
  cancellationPolicy: string[];
  earlyTermination: string[];
  liability: string[];
  terms: string[];
}

function buildContractData(
  plan: PlanType,
  info: CustomerInfo,
  prefs: SchedulePrefs,
  today: string
): ContractData {
  const p = PLANS[plan];

  const scheduleDesc = plan === "vip_elite"
    ? prefs.eliteScheduleMode === "auto"
      ? "Luxury Wash On Wheels will auto-schedule all 12 appointments. Customer will be notified of each appointment date."
      : "Customer will use the Credit System in their VIP Elite portal to book all 12 appointments at any time, any day. Each booking uses 1 credit (12 credits total)."
    : (prefs.scheduleWeek !== null && prefs.scheduleDay !== null)
      ? `All 12 visits will be scheduled on the ${WEEK_LABELS[prefs.scheduleWeek - 1]} ${DAY_FULL[prefs.scheduleDay]} of each month.`
      : "Luxury Wash On Wheels will reach out to schedule each monthly appointment.";

  // Standard service checklist (same for all plans — every visit)
  const serviceChecklist: string[] = [
    "Hand wash / debug front end & mirrors",
    "Clean gas cap",
    "Remove surface spots",
    "Clean door and trunk jambs & clean front rims",
    "Clean wheels & wheel wells",
    "Dress tires",
    "Wipe down leather",
    "Vacuum interior",
    "Wipe down dash, console, and door panels",
    "Clean windows (inside & out)",
  ];

  const services: ContractData["services"] = plan === "vip_elite"
    ? [
        { label: "Luxury Detail", count: 2, description: "Full premium service — deep clean, clay bar treatment, machine polish, paint sealant, leather conditioning. Use anytime." },
        { label: "Basic Detail", count: 10, description: "Standard full detail service — exterior wash, interior clean, windows, tires. Use anytime." },
      ]
    : plan === "vip"
    ? [
        { label: "Full Detail Service", count: 12, description: "Complete exterior and interior detail — once per month for 12 months." },
        { label: "Paint Sealant", description: "Included on visits 1 & 7." },
        { label: "Leather Deep Clean", description: "Included on visits 1, 5 & 9." },
        { label: "Leather Conditioning", description: "Included on visits 1 & 7." },
        { label: "Shampoo", description: "Included when needed." },
      ]
    : [
        { label: "Monthly Full Detail", description: "Recurring full detail service each month. Continues until canceled with proper notice." },
      ];

  const billingNote = plan === "maintenance"
    ? "$125.00/month — billed monthly to card on file"
    : `$${PLANS[plan].price.toLocaleString()}.00 — full payment due upfront upon signing`;

  // Cancellation & rescheduling policy (same for all plans)
  const cancellationPolicy: string[] = [
    "Clients may cancel or reschedule an appointment at least 12 hours before the scheduled time.",
    "Cancellations or no-shows within 12 hours of the appointment will result in forfeiture of that visit, with no refund or makeup.",
  ];

  // Early termination — differs by plan
  const earlyTermination: string[] = plan === "maintenance"
    ? [
        "The Maintenance Program operates on a month-to-month basis. Client may cancel at any time by providing 7 days written notice before the next scheduled service date.",
        "Failure to provide 7 days notice will result in one additional month's charge being applied before the agreement is terminated.",
        "Luxury Wash On Wheels also reserves the right to cancel the agreement due to client misconduct or vehicle safety concerns.",
      ]
    : [
        "Client may terminate this agreement early by submitting a 30-day written notice AND paying a 50% penalty of remaining services at time of cancellation.",
        "Luxury Wash On Wheels also reserves the right to cancel the agreement due to client misconduct or vehicle safety concerns.",
      ];

  // Liability
  const liability: string[] = [
    "Luxury Wash On Wheels is not liable for pre-existing vehicle damage.",
    "Luxury Wash On Wheels is not liable for delays caused by weather or unsafe work environments.",
    "The client agrees to provide access to the vehicle and ensure it is safe and legally parked during service.",
  ];

  const terms: string[] = plan === "maintenance"
    ? [
        "This is a month-to-month service agreement. Service continues each month until the customer cancels with proper written notice.",
        "Monthly charge of $125.00 will be automatically billed to the card on file each month.",
        "No refunds for the current billing month once the service visit has been completed.",
        "Missed appointments due to customer unavailability do not carry over to the following month.",
        "Customer agrees to provide reasonable access to the vehicle on scheduled service dates.",
        "This document represents the full agreement between both parties. Amendments must be made in writing and signed by both parties.",
        "This agreement is non-transferable.",
      ]
    : [
        plan === "vip_elite"
          ? "This agreement covers 12 detail credits (2 Luxury + 10 Basic) valid for 12 months from the service start date."
          : "This agreement covers 12 monthly service visits over a 12-month period beginning on the service start date.",
        "Full payment is due upfront upon signing this agreement.",
        "Payments are non-refundable except under the early termination terms outlined above.",
        "Missed appointments due to customer unavailability do not extend the contract period.",
        "Customer agrees to provide reasonable access to the vehicle on scheduled service dates.",
        "This document represents the full agreement between both parties. Amendments must be made in writing and signed by both parties.",
        "This agreement is non-transferable.",
      ];

  return {
    planTitle: p.title,
    planColor: p.color,
    programType: plan,
    today,
    customerName: `${info.firstName} ${info.lastName}`,
    email: info.email,
    phone: info.phone || "—",
    address: info.address || "—",
    city: info.city || "—",
    vehicle: [info.vehicleYear, info.vehicleMake, info.vehicleModel, info.vehicleColor].filter(Boolean).join(" "),
    billingNote,
    services,
    serviceChecklist,
    scheduleDesc,
    cancellationPolicy,
    earlyTermination,
    liability,
    terms,
  };
}

// ─── Contract Renderer (modern styled component) ─────────────────────────────

function ContractView({ data }: { data: ContractData }) {
  const Divider = () => <View style={{ height: 1, backgroundColor: "#E5E7EB", marginVertical: 14 }} />;

  const SectionHeader = ({ title }: { title: string }) => (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 13, fontWeight: "800", color: "#111827", letterSpacing: 0.5, textTransform: "uppercase" }}>{title}</Text>
      <View style={{ height: 2, backgroundColor: data.planColor, width: 32, marginTop: 4, borderRadius: 2 }} />
    </View>
  );

  const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
      <Text style={{ fontSize: 13, color: "#6B7280", flex: 1 }}>{label}</Text>
      <Text style={{ fontSize: 13, color: "#111827", fontWeight: "600", flex: 2, textAlign: "right" }}>{value}</Text>
    </View>
  );

  return (
    <View>
      {/* Header */}
      <View style={{ alignItems: "center", marginBottom: 18 }}>
        <Text style={{ fontSize: 18, fontWeight: "800", color: "#111827", textAlign: "center" }}>Service Agreement</Text>
        <Text style={{ fontSize: 13, color: data.planColor, fontWeight: "700", marginTop: 2 }}>Luxury Wash On Wheels</Text>
        <Text style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>Contract Date: {data.today}</Text>
      </View>

      <Divider />

      {/* Program */}
      <SectionHeader title="Program" />
      <View style={{ backgroundColor: data.planColor + "18", borderRadius: 10, padding: 12, marginBottom: 4 }}>
        <Text style={{ fontSize: 15, fontWeight: "800", color: data.planColor }}>{data.planTitle}</Text>
        <Text style={{ fontSize: 13, color: "#374151", marginTop: 4, fontWeight: "600" }}>{data.billingNote}</Text>
      </View>

      <Divider />

      {/* Customer Info */}
      <SectionHeader title="Customer Information" />
      <InfoRow label="Name" value={data.customerName} />
      <InfoRow label="Email" value={data.email} />
      <InfoRow label="Phone" value={data.phone} />
      <InfoRow label="Address" value={data.address} />
      <InfoRow label="City" value={data.city} />

      <Divider />

      {/* Vehicle */}
      <SectionHeader title="Vehicle" />
      <Text style={{ fontSize: 14, color: "#111827", fontWeight: "600" }}>{data.vehicle || "—"}</Text>

      <Divider />

      {/* Services */}
      <SectionHeader title="1. Services Provided" />
      {data.services.map((svc, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
          {svc.count !== undefined && (
            <View style={{ backgroundColor: data.planColor, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, minWidth: 28, alignItems: "center" }}>
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "800" }}>×{svc.count}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: "#111827" }}>{svc.label}</Text>
            <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 2, lineHeight: 17 }}>{svc.description}</Text>
          </View>
        </View>
      ))}

      {/* Service Checklist — every visit */}
      <Divider />
      <SectionHeader title="Every Visit Includes" />
      {data.serviceChecklist.map((item, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 5, alignItems: "flex-start" }}>
          <Text style={{ fontSize: 12, color: data.planColor, fontWeight: "800", marginTop: 1 }}>•</Text>
          <Text style={{ fontSize: 13, color: "#374151", lineHeight: 19, flex: 1 }}>{item}</Text>
        </View>
      ))}
      <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 6, fontStyle: "italic" }}>Maximum time on job: 1 hour per visit.</Text>

      <Divider />

      {/* Scheduling */}
      <SectionHeader title="2. Service Schedule" />
      <Text style={{ fontSize: 13, color: "#374151", lineHeight: 20 }}>{data.scheduleDesc}</Text>

      <Divider />

      {/* Payment Terms */}
      <SectionHeader title="3. Payment Terms" />
      {data.programType === "maintenance" ? (
        <View>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}><Text style={{ fontSize: 13, color: data.planColor, fontWeight: "800" }}>•</Text><Text style={{ fontSize: 13, color: "#374151", lineHeight: 19, flex: 1 }}>Monthly charge: <Text style={{ fontWeight: "700" }}>$125.00/month</Text> — billed automatically to card on file.</Text></View>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}><Text style={{ fontSize: 13, color: data.planColor, fontWeight: "800" }}>•</Text><Text style={{ fontSize: 13, color: "#374151", lineHeight: 19, flex: 1 }}>No refunds for the current billing month once the service visit has been completed.</Text></View>
        </View>
      ) : (
        <View>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}><Text style={{ fontSize: 13, color: data.planColor, fontWeight: "800" }}>•</Text><Text style={{ fontSize: 13, color: "#374151", lineHeight: 19, flex: 1 }}>Total amount due: <Text style={{ fontWeight: "700" }}>{data.billingNote.split(" — ")[0]}</Text></Text></View>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}><Text style={{ fontSize: 13, color: data.planColor, fontWeight: "800" }}>•</Text><Text style={{ fontSize: 13, color: "#374151", lineHeight: 19, flex: 1 }}>Full payment is due upfront upon signing this agreement.</Text></View>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}><Text style={{ fontSize: 13, color: data.planColor, fontWeight: "800" }}>•</Text><Text style={{ fontSize: 13, color: "#374151", lineHeight: 19, flex: 1 }}>Payments are non-refundable except under the early termination terms below.</Text></View>
        </View>
      )}

      <Divider />

      {/* Cancellation & Rescheduling */}
      <SectionHeader title="4. Cancellation & Rescheduling" />
      {data.cancellationPolicy.map((item, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
          <Text style={{ fontSize: 13, color: data.planColor, fontWeight: "800" }}>•</Text>
          <Text style={{ fontSize: 13, color: "#374151", lineHeight: 19, flex: 1 }}>{item}</Text>
        </View>
      ))}

      <Divider />

      {/* Early Termination */}
      <SectionHeader title="5. Early Termination" />
      {data.earlyTermination.map((item, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
          <Text style={{ fontSize: 13, color: data.planColor, fontWeight: "800" }}>•</Text>
          <Text style={{ fontSize: 13, color: "#374151", lineHeight: 19, flex: 1 }}>{item}</Text>
        </View>
      ))}

      <Divider />

      {/* Liability */}
      <SectionHeader title="6. Liability & Limitations" />
      {data.liability.map((item, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
          <Text style={{ fontSize: 13, color: data.planColor, fontWeight: "800" }}>•</Text>
          <Text style={{ fontSize: 13, color: "#374151", lineHeight: 19, flex: 1 }}>{item}</Text>
        </View>
      ))}

      <Divider />

      {/* Entire Agreement / Terms */}
      <SectionHeader title="7. Entire Agreement" />
      {data.terms.map((term, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
          <Text style={{ fontSize: 13, color: data.planColor, fontWeight: "800", minWidth: 18 }}>{i + 1}.</Text>
          <Text style={{ fontSize: 13, color: "#374151", lineHeight: 19, flex: 1 }}>{term}</Text>
        </View>
      ))}

      <Divider />

      {/* Signature lines */}
      <Text style={{ fontSize: 12, color: "#6B7280", lineHeight: 18, marginBottom: 12 }}>
        By signing below, the customer agrees to all terms and conditions of this {data.planTitle} agreement.
      </Text>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
        <View style={{ flex: 1, marginRight: 16 }}>
          <View style={{ borderBottomWidth: 1, borderBottomColor: "#9CA3AF", marginBottom: 4, height: 24 }} />
          <Text style={{ fontSize: 11, color: "#9CA3AF" }}>Customer Signature</Text>
        </View>
        <View style={{ width: 90 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#374151", height: 24, lineHeight: 24 }}>{data.today}</Text>
          <Text style={{ fontSize: 11, color: "#9CA3AF" }}>Date</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
        <View style={{ flex: 1, marginRight: 16 }}>
          <View style={{ borderBottomWidth: 1, borderBottomColor: "#9CA3AF", marginBottom: 4, height: 24 }} />
          <Text style={{ fontSize: 11, color: "#9CA3AF" }}>Luxury Wash On Wheels</Text>
        </View>
        <View style={{ width: 90 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#374151", height: 24, lineHeight: 24 }}>{data.today}</Text>
          <Text style={{ fontSize: 11, color: "#9CA3AF" }}>Date</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface VipSignupModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultInfo?: Partial<CustomerInfo>;
  customerKey?: string;
}

export function VipSignupModal({
  visible,
  onClose,
  onSuccess,
  defaultInfo,
  customerKey,
}: VipSignupModalProps) {
  const [step, setStep] = useState<Step>("plan");
  const [selectedPlan, setSelectedPlan] = useState<PlanType | null>(null);

  const [info, setInfo] = useState<CustomerInfo>({
    firstName: defaultInfo?.firstName ?? "",
    lastName: defaultInfo?.lastName ?? "",
    email: defaultInfo?.email ?? "",
    phone: defaultInfo?.phone ?? "",
    address: "",
    city: "",
    vehicleYear: "",
    vehicleMake: "",
    vehicleModel: "",
    vehicleColor: "",
  });

  const [prefs, setPrefs] = useState<SchedulePrefs>({
    scheduleWeek: null,
    scheduleDay: null,
    eliteScheduleMode: "auto",
    eliteCreditCount: 12,
  });

  const [hasSigned, setHasSigned] = useState(false);
  const [showSigModal, setShowSigModal] = useState(false);
  const sigRef = useRef<SigRef>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [cardName, setCardName] = useState(`${defaultInfo?.firstName ?? ""} ${defaultInfo?.lastName ?? ""}`.trim());
  const [cardComplete, setCardComplete] = useState(false);
  const [useCardOnFile, setUseCardOnFile] = useState(true);

  const savedCardsQuery = trpc.savedCards.list.useQuery(
    { customerKey: customerKey ?? "" },
    { enabled: !!customerKey }
  );
  const savedCard = savedCardsQuery.data?.find((c: any) => c.isDefault) ?? savedCardsQuery.data?.[0] ?? null;
  const chargeCardMutation = trpc.savedCards.chargeCard.useMutation();
  const createPaymentIntentMutation = trpc.stripe.createPaymentIntent.useMutation();
  const createSetupIntentMutation = trpc.savedCards.createSetupIntent.useMutation();
  const saveCardMutation = trpc.savedCards.saveCard.useMutation();

  const plan = selectedPlan ? PLANS[selectedPlan] : null;
  const today = new Date().toISOString().split("T")[0];

  function resetModal() {
    setStep("plan");
    setSelectedPlan(null);
    setHasSigned(false);
    setIsSubmitting(false);
    setCardNumber("");
    setCardExpiry("");
    setCardCvc("");
    setCardComplete(false);
    setUseCardOnFile(true);
    setPrefs({ scheduleWeek: null, scheduleDay: null, eliteScheduleMode: "auto", eliteCreditCount: 12 });
    sigRef.current?.clear();
  }

  function handleClose() {
    resetModal();
    onClose();
  }

  function selectPlan(p: PlanType) {
    setSelectedPlan(p);
    setInfo({
      firstName: defaultInfo?.firstName ?? "",
      lastName: defaultInfo?.lastName ?? "",
      email: defaultInfo?.email ?? "",
      phone: defaultInfo?.phone ?? "",
      address: "",
      city: "",
      vehicleYear: "",
      vehicleMake: "",
      vehicleModel: "",
      vehicleColor: "",
    });
    setStep("info");
  }

  function validateInfo(): string | null {
    if (!info.firstName.trim() || !info.lastName.trim()) return "Please enter your full name.";
    if (!info.email.trim() || !/^[^@]+@[^@]+\.[^@]+$/.test(info.email)) return "Please enter a valid email address.";
    // Vehicle not required for VIP Elite (any vehicle can be used)
    if (selectedPlan !== 'vip_elite' && (!info.vehicleYear.trim() || !info.vehicleMake.trim() || !info.vehicleModel.trim())) return "Please enter your vehicle year, make, and model.";
    if (!info.city.trim()) return "Please enter your city.";
    return null;
  }

  function goToSchedule() {
    const err = validateInfo();
    if (err) { Alert.alert("Missing Info", err); return; }
    setStep("schedule");
  }

  async function createContract(): Promise<boolean> {
    if (!selectedPlan) return false;
    try {
      const vehicleDesc = selectedPlan === 'vip_elite'
        ? 'Any Vehicle'
        : [info.vehicleYear, info.vehicleMake, info.vehicleModel, info.vehicleColor].filter(Boolean).join(" ");

      const elitePrice = ELITE_PRICES[prefs.eliteCreditCount] ?? 1600;

      const body: Record<string, unknown> = {
        customerName: `${info.firstName} ${info.lastName}`.trim(),
        customerEmail: info.email,
        customerPhone: info.phone || null,
        customerAddress: info.address || null,
        vehicleDescription: vehicleDesc,
        city: info.city,
        startDate: today,
        serviceStartDate: today,
        totalPrice: selectedPlan === 'vip_elite' ? elitePrice : PLAN_PRICES[selectedPlan],
        repName: "Luxury Wash On Wheels",
        notes: selectedPlan === "vip_elite"
          ? `Customer self-signup via portal. ${prefs.eliteCreditCount} credits. Schedule mode: ${prefs.eliteScheduleMode === "auto" ? "Auto-schedule" : "Credit system (customer books via portal)"}.`
          : "Customer self-signup via portal.",
        scheduleWeek: prefs.scheduleWeek,
        scheduleDay: prefs.scheduleDay,
        frequency: "monthly",
        programType: selectedPlan,
        creditCount: selectedPlan === 'vip_elite' ? prefs.eliteCreditCount : undefined,
        autoCreateJobs: selectedPlan !== "vip_elite" || prefs.eliteScheduleMode === "auto",
      };

      const resp = await fetch(`${API_BASE}/api/vip/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error ?? "Failed to create contract");
      return true;
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not create contract. Please try again.");
      return false;
    }
  }

  async function handlePayWithCardOnFile() {
    if (!selectedPlan || !savedCard) return;
    setIsSubmitting(true);
    try {
      const ok = await createContract();
      if (!ok) return;
      const chargeAmountCents = selectedPlan === "maintenance"
        ? 12500
        : selectedPlan === 'vip_elite'
          ? (ELITE_PRICES[prefs.eliteCreditCount] ?? 1600) * 100
          : PLAN_PRICES[selectedPlan] * 100;
      const chargeResult = await chargeCardMutation.mutateAsync({
        stripeCustomerId: savedCard.stripeCustomerId,
        stripePaymentMethodId: savedCard.stripePaymentMethodId,
        amountCents: chargeAmountCents,
        description: selectedPlan === "maintenance"
          ? `Maintenance Program — First Month — ${info.firstName} ${info.lastName} — ${info.vehicleYear} ${info.vehicleMake} ${info.vehicleModel}`
          : selectedPlan === 'vip_elite'
            ? `VIP Elite Program (${prefs.eliteCreditCount} Credits) — ${info.firstName} ${info.lastName}`
            : `${plan?.title} — ${info.firstName} ${info.lastName} — ${info.vehicleYear} ${info.vehicleMake} ${info.vehicleModel}`,
      });
      if (chargeResult.success) {
        setStep("success");
        onSuccess();
      } else {
        Alert.alert("Payment Failed", "Could not charge your card on file. Please try a different payment method.");
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Payment failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePayWithNewCard() {
    if (!selectedPlan) return;

    const _constMod = await import("expo-constants");
    const Constants = (_constMod as any).default ?? _constMod;
    const isExpoGo = Constants?.appOwnership === "expo";
    const isNative = Platform.OS !== "web" && !isExpoGo;

    if (isNative && !cardComplete) {
      Alert.alert("Incomplete Card", "Please complete all card fields.");
      return;
    }
    if (!isNative) {
      const rawNum = cardNumber.replace(/\s/g, "");
      if (rawNum.length < 13) { Alert.alert("Invalid Card", "Please enter a valid card number."); return; }
      if (!cardExpiry.match(/^\d{2}\/\d{2}$/)) { Alert.alert("Invalid Expiry", "Please enter expiry as MM/YY."); return; }
      if (cardCvc.length < 3) { Alert.alert("Invalid CVC", "Please enter a valid CVC."); return; }
    }
    if (!cardName.trim()) { Alert.alert("Missing Name", "Please enter the name on the card."); return; }

    setIsSubmitting(true);
    try {
      const ok = await createContract();
      if (!ok) return;

      const newCardAmountCents = selectedPlan === "maintenance" ? 12500 : PLAN_PRICES[selectedPlan] * 100;
      const intentResult = await createPaymentIntentMutation.mutateAsync({
        amountCents: newCardAmountCents,
        currency: "usd",
        description: `${plan?.title} — ${info.firstName} ${info.lastName}`,
      });

      if (isNative) {
        const { confirmPayment } = require("@stripe/stripe-react-native");
        const { error } = await confirmPayment(intentResult.clientSecret, {
          paymentMethodType: "Card",
          paymentMethodData: { billingDetails: { name: cardName } },
        });
        if (error) throw new Error(error.message);
      }

      // Try to save card on file for future use
      if (customerKey) {
        try {
          const setupResult = await createSetupIntentMutation.mutateAsync({
            customerKey,
            customerName: cardName,
            customerEmail: info.email,
          });
          if (isNative) {
            const { createPaymentMethod, confirmSetupIntent } = require("@stripe/stripe-react-native");
            const { paymentMethod } = await createPaymentMethod({ paymentMethodType: "Card" });
            if (paymentMethod && setupResult.clientSecret) {
              await confirmSetupIntent(setupResult.clientSecret, {
                paymentMethodType: "Card",
                paymentMethodData: { paymentMethodId: paymentMethod.id },
              });
              await saveCardMutation.mutateAsync({
                customerKey,
                customerName: cardName,
                customerEmail: info.email,
                stripeCustomerId: setupResult.stripeCustomerId,
                stripePaymentMethodId: paymentMethod.id,
                // cardLast4: paymentMethod.card?.last4,
                // cardBrand: paymentMethod.card?.brand,
              });
            }
          }
        } catch {
          // Non-fatal
        }
      }

      setStep("success");
      onSuccess();
    } catch (e: any) {
      Alert.alert("Payment Failed", e?.message ?? "Could not process payment. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function formatCardNumber(text: string) {
    const raw = text.replace(/\D/g, "").slice(0, 16);
    return raw.replace(/(.{4})/g, "$1 ").trim();
  }
  function formatExpiry(text: string) {
    const raw = text.replace(/\D/g, "").slice(0, 4);
    if (raw.length >= 3) return raw.slice(0, 2) + "/" + raw.slice(2);
    return raw;
  }

  // ── Render steps ─────────────────────────────────────────────────────────────

  const renderPlanStep = () => (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={ss.stepTitle}>Choose Your Program</Text>
      <Text style={ss.stepSub}>All programs include 12 monthly visits. Select the level of service that fits your lifestyle.</Text>

      {(["vip_elite", "vip", "maintenance"] as PlanType[]).map((pt) => {
        const p = PLANS[pt];
        return (
          <TouchableOpacity
            key={pt}
            activeOpacity={0.88}
            onPress={() => selectPlan(pt)}
            style={[ss.planCard, { borderColor: p.color }]}
          >
            <View style={[ss.planHeader, { backgroundColor: p.color }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 22 }}>{p.icon}</Text>
                <Text style={ss.planTitle}>{p.title}</Text>
                <View style={ss.planBadge}>
                  <Text style={ss.planBadgeText}>{p.badge}</Text>
                </View>
              </View>
              <View style={{ marginTop: 8, flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                {pt === "maintenance" ? (
                  <>
                    <Text style={ss.planPrice}>$125</Text>
                    <Text style={ss.planPriceLabel}>/month</Text>
                  </>
                ) : (
                  <>
                    <Text style={ss.planPrice}>${p.price.toLocaleString()}</Text>
                    <Text style={ss.planPriceLabel}>/year</Text>
                    <Text style={ss.planPriceMonthly}>({PLAN_MONTHLY[pt]})</Text>
                  </>
                )}
              </View>
              <Text style={ss.planTagline}>{p.tagline}</Text>
            </View>
            <View style={ss.planBody}>
              {p.bullets.map((b) => (
                <View key={b} style={ss.bulletRow}>
                  <MaterialIcons name="check-circle" size={16} color={p.color} />
                  <Text style={ss.bulletText}>{b}</Text>
                </View>
              ))}
              {p.note ? (
                <View style={[ss.noteBox, { borderColor: p.color + "40", backgroundColor: p.color + "0A" }]}>
                  <Text style={[ss.noteText, { color: p.color }]}>💡 {p.note}</Text>
                </View>
              ) : null}
              <TouchableOpacity
                onPress={() => selectPlan(pt)}
                activeOpacity={0.85}
                style={[ss.selectBtn, { backgroundColor: p.color }]}
              >
                <Text style={ss.selectBtnText}>Sign Up — {p.title}</Text>
                <MaterialIcons name="arrow-forward" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        );
      })}

      <Text style={{ color: "#9CA3AF", fontSize: 12, textAlign: "center", marginTop: 8 }}>
        Questions? Call us: 850-517-7874
      </Text>
    </ScrollView>
  );

  const renderInfoStep = () => (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={ss.stepTitle}>Your Information</Text>
        <Text style={ss.stepSub}>Confirm your details. This information will appear on your contract.</Text>

        <Text style={ss.sectionLabel}>PERSONAL INFO</Text>
        <View style={ss.row}>
          <View style={{ flex: 1 }}>
            <Text style={ss.fieldLabel}>First Name *</Text>
            <TextInput value={info.firstName} onChangeText={v => setInfo(i => ({ ...i, firstName: v }))} style={ss.input} placeholder="First name" placeholderTextColor="#9CA3AF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={ss.fieldLabel}>Last Name *</Text>
            <TextInput value={info.lastName} onChangeText={v => setInfo(i => ({ ...i, lastName: v }))} style={ss.input} placeholder="Last name" placeholderTextColor="#9CA3AF" />
          </View>
        </View>

        <Text style={ss.fieldLabel}>Email Address *</Text>
        <TextInput value={info.email} onChangeText={v => setInfo(i => ({ ...i, email: v }))} style={ss.input} placeholder="your@email.com" placeholderTextColor="#9CA3AF" keyboardType="email-address" autoCapitalize="none" />

        <Text style={ss.fieldLabel}>Phone Number</Text>
        <TextInput value={info.phone} onChangeText={v => setInfo(i => ({ ...i, phone: v }))} style={ss.input} placeholder="(850) 000-0000" placeholderTextColor="#9CA3AF" keyboardType="phone-pad" />

        <Text style={ss.fieldLabel}>Street Address</Text>
        <TextInput value={info.address} onChangeText={v => setInfo(i => ({ ...i, address: v }))} style={ss.input} placeholder="123 Main St" placeholderTextColor="#9CA3AF" />

        <Text style={ss.fieldLabel}>City *</Text>
        <TextInput value={info.city} onChangeText={v => setInfo(i => ({ ...i, city: v }))} style={ss.input} placeholder="e.g. Crestview, Niceville, Destin" placeholderTextColor="#9CA3AF" />

        {selectedPlan !== 'vip_elite' && (
          <>
            <Text style={[ss.sectionLabel, { marginTop: 20 }]}>VEHICLE DETAILS</Text>
            <View style={ss.row}>
              <View style={{ flex: 1 }}>
                <Text style={ss.fieldLabel}>Year *</Text>
                <TextInput value={info.vehicleYear} onChangeText={v => setInfo(i => ({ ...i, vehicleYear: v }))} style={ss.input} placeholder="2022" placeholderTextColor="#9CA3AF" keyboardType="numeric" maxLength={4} />
              </View>
              <View style={{ flex: 1.5 }}>
                <Text style={ss.fieldLabel}>Make *</Text>
                <TextInput value={info.vehicleMake} onChangeText={v => setInfo(i => ({ ...i, vehicleMake: v }))} style={ss.input} placeholder="Toyota" placeholderTextColor="#9CA3AF" />
              </View>
            </View>
            <View style={ss.row}>
              <View style={{ flex: 1.5 }}>
                <Text style={ss.fieldLabel}>Model *</Text>
                <TextInput value={info.vehicleModel} onChangeText={v => setInfo(i => ({ ...i, vehicleModel: v }))} style={ss.input} placeholder="Camry" placeholderTextColor="#9CA3AF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ss.fieldLabel}>Color</Text>
                <TextInput value={info.vehicleColor} onChangeText={v => setInfo(i => ({ ...i, vehicleColor: v }))} style={ss.input} placeholder="Silver" placeholderTextColor="#9CA3AF" />
              </View>
            </View>
          </>
        )}
        {selectedPlan === 'vip_elite' && (
          <View style={{ marginTop: 16, padding: 12, backgroundColor: '#F0F9FF', borderRadius: 10, borderWidth: 1, borderColor: '#BAE6FD' }}>
            <Text style={{ fontSize: 13, color: '#0369A1', fontWeight: '600' }}>
              ℹ️ VIP Elite credits can be used on any vehicle — no vehicle lock-in required.
            </Text>
          </View>
        )}

        <TouchableOpacity onPress={goToSchedule} style={ss.primaryBtn} activeOpacity={0.85}>
          <Text style={ss.primaryBtnText}>Continue to Scheduling</Text>
          <MaterialIcons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderScheduleStep = () => {
    const isElite = selectedPlan === "vip_elite";
    const p = plan!;
    return (
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={ss.stepTitle}>Scheduling Preferences</Text>
        <Text style={ss.stepSub}>
          {isElite
            ? "Choose how you'd like your VIP Elite appointments to be managed."
            : "Choose which day of the month your service will be scheduled. We'll lock in all 12 visits for you."}
        </Text>

        {isElite ? (
          <View style={{ gap: 12, marginBottom: 20 }}>
            {/* Credit Package Selector */}
            <Text style={[ss.fieldLabel, { marginBottom: 4 }]}>Credit Package</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
              {([6, 12] as const).map(count => {
                const isSelected = prefs.eliteCreditCount === count;
                const luxCount = count === 6 ? 1 : 2;
                const basicCount = count === 6 ? 5 : 10;
                return (
                  <TouchableOpacity key={count} onPress={() => setPrefs(prev => ({ ...prev, eliteCreditCount: count }))} activeOpacity={0.85}
                    style={[{
                      flex: 1, borderRadius: 12, borderWidth: 2, padding: 14, alignItems: 'center',
                      borderColor: isSelected ? p.color : '#E5E7EB',
                      backgroundColor: isSelected ? p.color + '08' : '#F9FAFB',
                    }]}>
                    <Text style={{ fontSize: 22, fontWeight: '900', color: isSelected ? p.color : '#374151' }}>{count}</Text>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: isSelected ? p.color : '#6B7280', marginTop: 2 }}>Credits</Text>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: isSelected ? p.color : '#374151', marginTop: 6 }}>${ELITE_PRICES[count]}</Text>
                    <Text style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>{ELITE_MONTHLY[count]}</Text>
                    <Text style={{ fontSize: 9, color: '#9CA3AF', marginTop: 4, textAlign: 'center' }}>{luxCount} Luxury + {basicCount} Basic</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Auto-Schedule option */}
            <TouchableOpacity onPress={() => setPrefs(prev => ({ ...prev, eliteScheduleMode: "auto" }))} activeOpacity={0.85}
              style={[ss.scheduleOptionCard, prefs.eliteScheduleMode === "auto" && { borderColor: p.color, backgroundColor: p.color + "08" }]}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                <View style={[ss.radioCircle, prefs.eliteScheduleMode === "auto" && { borderColor: p.color, backgroundColor: p.color }]}>
                  {prefs.eliteScheduleMode === "auto" && <View style={ss.radioDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[ss.scheduleOptionTitle, prefs.eliteScheduleMode === "auto" && { color: p.color }]}>👑 Auto-Schedule — We handle everything</Text>
                  <Text style={ss.scheduleOptionDesc}>Our team pre-schedules all 12 appointments for you and notifies you of each date. Zero effort, zero planning.</Text>
                </View>
              </View>
            </TouchableOpacity>

            {/* Credit System option */}
            <TouchableOpacity onPress={() => setPrefs(prev => ({ ...prev, eliteScheduleMode: "credits" }))} activeOpacity={0.85}
              style={[ss.scheduleOptionCard, prefs.eliteScheduleMode === "credits" && { borderColor: p.color, backgroundColor: p.color + "08" }]}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                <View style={[ss.radioCircle, prefs.eliteScheduleMode === "credits" && { borderColor: p.color, backgroundColor: p.color }]}>
                  {prefs.eliteScheduleMode === "credits" && <View style={ss.radioDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[ss.scheduleOptionTitle, prefs.eliteScheduleMode === "credits" && { color: p.color }]}>🎟️ Credit System — Book on your schedule</Text>
                  <Text style={ss.scheduleOptionDesc}>You receive {prefs.eliteCreditCount} service credits in your VIP Elite portal. Use them to book any appointment, any day, any time — at your convenience. Each booking uses 1 credit.</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {[`${prefs.eliteCreditCount} credits loaded at signup`, "Book any day, any time", "No fixed schedule", "Use portal to redeem"].map(tag => (
                      <View key={tag} style={{ backgroundColor: p.color + "18", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: p.color + "40" }}>
                        <Text style={{ fontSize: 11, color: p.color, fontWeight: "700" }}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ marginBottom: 20 }}>
            <Text style={ss.sectionLabel}>WEEK OF MONTH</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {WEEK_LABELS.map((label, i) => {
                const v = i + 1;
                const sel = prefs.scheduleWeek === v;
                return (
                  <TouchableOpacity key={v} onPress={() => setPrefs(prev => ({ ...prev, scheduleWeek: sel ? null : v }))}
                    style={[ss.chip, sel && { backgroundColor: p.color, borderColor: p.color }]} activeOpacity={0.8}>
                    <Text style={[ss.chipText, sel && { color: "#fff" }]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={ss.sectionLabel}>DAY OF WEEK</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {DAY_LABELS.map((label, i) => {
                const sel = prefs.scheduleDay === i;
                return (
                  <TouchableOpacity key={i} onPress={() => setPrefs(prev => ({ ...prev, scheduleDay: sel ? null : i }))}
                    style={[ss.chip, sel && { backgroundColor: p.color, borderColor: p.color }]} activeOpacity={0.8}>
                    <Text style={[ss.chipText, sel && { color: "#fff" }]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {prefs.scheduleWeek !== null && prefs.scheduleDay !== null ? (
              <View style={[ss.infoBox, { borderColor: p.color + "60", backgroundColor: p.color + "0A" }]}>
                <Text style={{ color: p.color, fontWeight: "700", fontSize: 13 }}>
                  ✅ All 12 visits will be scheduled on the {WEEK_LABELS[prefs.scheduleWeek - 1]} {DAY_FULL[prefs.scheduleDay]} of each month.
                </Text>
              </View>
            ) : (
              <View style={[ss.infoBox, { borderColor: "#9CA3AF", backgroundColor: "#F9FAFB" }]}>
                <Text style={{ color: "#6B7280", fontSize: 13 }}>
                  💡 You can skip this and our team will reach out to set your schedule after signup.
                </Text>
              </View>
            )}
          </View>
        )}

        <TouchableOpacity onPress={() => setStep("contract")} style={[ss.primaryBtn, { backgroundColor: p.color }]} activeOpacity={0.85}>
          <Text style={ss.primaryBtnText}>Review Contract</Text>
          <MaterialIcons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
      </ScrollView>
    );
  };

  const renderContractStep = () => {
    const p = plan!;
    const contractData = selectedPlan ? buildContractData(selectedPlan, info, prefs, today) : null;
    return (
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={ss.stepTitle}>Review & Sign</Text>
        <Text style={ss.stepSub}>Read your contract carefully, then sign below to proceed to payment.</Text>

        <View style={ss.contractBox}>
          {contractData && <ContractView data={contractData} />}
        </View>

        <Text style={[ss.sectionLabel, { marginTop: 20 }]}>YOUR SIGNATURE</Text>
        <Text style={{ color: "#6B7280", fontSize: 13, marginBottom: 12 }}>
          By signing, you agree to the terms of this contract.
        </Text>

        {hasSigned ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <MaterialIcons name="check-circle" size={24} color="#16A34A" />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700", color: "#16A34A", fontSize: 14 }}>Contract Signed</Text>
              <Text style={{ color: "#6B7280", fontSize: 12, marginTop: 2 }}>Tap below to re-sign if needed</Text>
            </View>
            <TouchableOpacity onPress={() => { sigRef.current?.clear(); setHasSigned(false); }} style={{ paddingVertical: 4, paddingHorizontal: 10 }}>
              <Text style={{ color: "#9CA3AF", fontSize: 12 }}>Re-sign</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setShowSigModal(true)}
            style={[ss.primaryBtn, { backgroundColor: "#F9FAFB", borderWidth: 1.5, borderColor: p.color, marginBottom: 12 }]}
            activeOpacity={0.85}
          >
            <MaterialIcons name="edit" size={18} color={p.color} />
            <Text style={[ss.primaryBtnText, { color: p.color }]}>Tap to Sign Contract</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={() => {
            if (!hasSigned) {
              Alert.alert("Signature Required", "Please sign the contract before continuing.");
              return;
            }
            setStep("payment");
          }}
          style={[ss.primaryBtn, { backgroundColor: p.color, opacity: hasSigned ? 1 : 0.5 }]}
          activeOpacity={0.85}
        >
          <Text style={ss.primaryBtnText}>Signed — Proceed to Payment</Text>
          <MaterialIcons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>

        {/* ── Signature Overlay Modal ── */}
        <Modal visible={showSigModal} animationType="slide" transparent presentationStyle="overFullScreen" onRequestClose={() => setShowSigModal(false)}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
            <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" }}>
                <Text style={{ fontSize: 17, fontWeight: "800", color: "#1A1A1A" }}>Sign Your Contract</Text>
                <TouchableOpacity onPress={() => setShowSigModal(false)} style={{ padding: 4 }}>
                  <MaterialIcons name="close" size={22} color="#6B7280" />
                </TouchableOpacity>
              </View>
              <Text style={{ color: "#6B7280", fontSize: 13, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 }}>
                Draw your signature below using your finger.
              </Text>
              <View style={{ height: 200, marginHorizontal: 20, marginBottom: 8 }}>
                <SignatureCanvas ref={sigRef} onSign={() => {}} />
              </View>
              <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 20, marginTop: 4 }}>
                <TouchableOpacity
                  onPress={() => { sigRef.current?.clear(); }}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: "#E5E7EB", alignItems: "center" }}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: "#6B7280", fontWeight: "600", fontSize: 15 }}>Clear</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    if (!sigRef.current?.hasSignature()) {
                      Alert.alert("Signature Required", "Please draw your signature before confirming.");
                      return;
                    }
                    setHasSigned(true);
                    setShowSigModal(false);
                  }}
                  style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: p.color, alignItems: "center" }}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Confirm Signature</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    );
  };

  const renderPaymentStep = () => {
    const p = plan!;
    const price = PLAN_PRICES[selectedPlan!];

    const _constMod = require("expo-constants");
    const Constants = _constMod.default ?? _constMod;
    const isExpoGo = Constants?.appOwnership === "expo";
    const isNative = Platform.OS !== "web" && !isExpoGo;
    let StripeCardField: React.ComponentType<{ onCardChange: (d: { complete: boolean }) => void; style?: object; cardStyle?: object }> | null = null;
    if (isNative) {
      try {
        const m = require("@stripe/stripe-react-native");
        StripeCardField = m.CardField ?? null;
      } catch { /* ignore */ }
    }

    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          <Text style={ss.stepTitle}>Payment</Text>

          <View style={[ss.summaryBox, { borderColor: p.color + "40" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Text style={{ fontSize: 20 }}>{p.icon}</Text>
              <Text style={{ fontWeight: "800", fontSize: 15, color: "#1A1A1A" }}>{p.title}</Text>
            </View>
            <Text style={{ color: "#6B7280", fontSize: 13, marginBottom: 4 }}>
              {info.vehicleYear} {info.vehicleMake} {info.vehicleModel}
            </Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#E5E7EB" }}>
              <Text style={{ color: "#6B7280", fontSize: 14 }}>
                {selectedPlan === "maintenance" ? "Monthly billing (12 months)" : "Annual Program (12 visits)"}
              </Text>
              <Text style={{ fontWeight: "800", fontSize: 16, color: "#1A1A1A" }}>
                {selectedPlan === "maintenance" ? "$125/mo" : `$${price.toLocaleString()}`}
              </Text>
            </View>
          </View>

          {savedCard && (
            <View style={{ marginBottom: 16 }}>
              <Text style={ss.sectionLabel}>PAYMENT METHOD</Text>
              <TouchableOpacity onPress={() => setUseCardOnFile(true)} activeOpacity={0.85}
                style={[ss.paymentOption, useCardOnFile && { borderColor: p.color, backgroundColor: p.color + "08" }]}>
                <View style={[ss.radioCircle, useCardOnFile && { borderColor: p.color, backgroundColor: p.color }]}>
                  {useCardOnFile && <View style={ss.radioDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[ss.scheduleOptionTitle, useCardOnFile && { color: p.color }]}>💳 Card on file</Text>
                  <Text style={ss.scheduleOptionDesc}>{savedCard.cardBrand?.toUpperCase() ?? "Card"} ending in {savedCard.cardLast4}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setUseCardOnFile(false)} activeOpacity={0.85}
                style={[ss.paymentOption, !useCardOnFile && { borderColor: p.color, backgroundColor: p.color + "08" }]}>
                <View style={[ss.radioCircle, !useCardOnFile && { borderColor: p.color, backgroundColor: p.color }]}>
                  {!useCardOnFile && <View style={ss.radioDot} />}
                </View>
                <Text style={[ss.scheduleOptionTitle, !useCardOnFile && { color: p.color }]}>➕ Use a different card</Text>
              </TouchableOpacity>
            </View>
          )}

          {(!savedCard || !useCardOnFile) && (
            <View style={{ marginBottom: 16 }}>
              {!savedCard && <Text style={ss.sectionLabel}>CARD DETAILS</Text>}
              <Text style={ss.fieldLabel}>Name on Card</Text>
              <TextInput value={cardName} onChangeText={setCardName} style={ss.input} placeholder="Full name" placeholderTextColor="#9CA3AF" />
              {isNative && StripeCardField ? (
                <View>
                  <Text style={ss.fieldLabel}>Card Details</Text>
                  <StripeCardField
                    onCardChange={(d) => setCardComplete(d.complete)}
                    style={{ height: 50, marginBottom: 12 }}
                    cardStyle={{ backgroundColor: "#F9FAFB", textColor: "#1A1A1A", placeholderColor: "#9CA3AF", borderColor: "#E5E7EB", borderWidth: 1, borderRadius: 10 }}
                  />
                </View>
              ) : (
                <View>
                  <Text style={ss.fieldLabel}>Card Number</Text>
                  <TextInput value={cardNumber} onChangeText={(t) => { setCardNumber(formatCardNumber(t)); setCardComplete(t.replace(/\s/g, "").length >= 13); }} style={ss.input} placeholder="1234 5678 9012 3456" placeholderTextColor="#9CA3AF" keyboardType="numeric" maxLength={19} />
                  <View style={ss.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={ss.fieldLabel}>Expiry (MM/YY)</Text>
                      <TextInput value={cardExpiry} onChangeText={(t) => setCardExpiry(formatExpiry(t))} style={ss.input} placeholder="MM/YY" placeholderTextColor="#9CA3AF" keyboardType="numeric" maxLength={5} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={ss.fieldLabel}>CVC</Text>
                      <TextInput value={cardCvc} onChangeText={(t) => setCardCvc(t.replace(/\D/g, "").slice(0, 4))} style={ss.input} placeholder="123" placeholderTextColor="#9CA3AF" keyboardType="numeric" maxLength={4} secureTextEntry />
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}

          <TouchableOpacity
            onPress={savedCard && useCardOnFile ? handlePayWithCardOnFile : handlePayWithNewCard}
            disabled={isSubmitting}
            activeOpacity={0.85}
            style={[ss.primaryBtn, { backgroundColor: p.color, opacity: isSubmitting ? 0.6 : 1 }]}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialIcons name="lock" size={18} color="#fff" />
                <Text style={ss.primaryBtnText}>
                  {selectedPlan === "maintenance" ? "Enroll — $125/mo" : `Pay $${price.toLocaleString()} & Enroll`}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={{ color: "#9CA3AF", fontSize: 11, textAlign: "center", marginTop: 10 }}>
            🔒 Secured by Stripe. Your card details are never stored on our servers.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  };

  const renderSuccessStep = () => {
    const p = plan!;
    const weekLabel = prefs.scheduleWeek !== null ? WEEK_LABELS[prefs.scheduleWeek - 1] : "";
    const dayLabel = prefs.scheduleDay !== null ? DAY_FULL[prefs.scheduleDay] : "";
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: p.color + "20", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
          <Text style={{ fontSize: 40 }}>{p.icon}</Text>
        </View>
        <Text style={{ fontSize: 26, fontWeight: "900", color: "#1A1A1A", textAlign: "center", marginBottom: 10 }}>
          Welcome to {p.title}!
        </Text>
        <Text style={{ color: "#6B7280", fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 32 }}>
          {selectedPlan === "maintenance" ? "Your monthly subscription is active. Your first service visit will be scheduled shortly." : "Your contract has been created and your first year of service is confirmed."}
          {"\n\n"}
          {selectedPlan === "vip_elite" && prefs.eliteScheduleMode === "auto"
            ? "Our team will reach out shortly to auto-schedule all 12 of your appointments."
            : selectedPlan === "vip_elite"
              ? "Your 12 service credits are ready in your VIP Elite portal. Book any appointment, any day, any time — each booking uses 1 credit."
              : (prefs.scheduleWeek !== null && prefs.scheduleDay !== null)
                ? `All 12 visits are scheduled on the ${weekLabel} ${dayLabel} of each month. Check your VIP tab to see your full schedule.`
                : "Our team will reach out shortly to confirm your recurring appointment schedule."}
        </Text>
        <TouchableOpacity onPress={handleClose} style={[ss.primaryBtn, { backgroundColor: p.color, width: "100%" }]} activeOpacity={0.85}>
          <Text style={ss.primaryBtnText}>View My {p.title}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const STEP_LABELS: Record<Step, string> = {
    plan: "Choose Program",
    info: "Your Info",
    schedule: "Scheduling",
    contract: "Sign Contract",
    payment: "Payment",
    success: "Enrolled!",
  };

  const STEP_ORDER: Step[] = ["plan", "info", "schedule", "contract", "payment", "success"];
  const stepIndex = STEP_ORDER.indexOf(step);
  const canGoBack = step !== "plan" && step !== "success";

  function goBack() {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) setStep(STEP_ORDER[idx - 1]);
  }

  const planColor = selectedPlan ? PLANS[selectedPlan].color : "#0057FF";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={ss.container}>
        <View style={ss.header}>
          {canGoBack ? (
            <TouchableOpacity onPress={goBack} style={ss.headerBtn}>
              <MaterialIcons name="arrow-back" size={22} color="#1A1A1A" />
            </TouchableOpacity>
          ) : (
            <View style={ss.headerBtn} />
          )}
          <Text style={ss.headerTitle}>{STEP_LABELS[step]}</Text>
          <TouchableOpacity onPress={handleClose} style={ss.headerBtn}>
            <MaterialIcons name="close" size={22} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {step !== "success" && (
          <View style={ss.progressRow}>
            {STEP_ORDER.slice(0, -1).map((s, i) => (
              <View key={s} style={[ss.progressDot, i <= stepIndex && { backgroundColor: planColor }]} />
            ))}
          </View>
        )}

        <View style={{ flex: 1 }}>
          {step === "plan" && renderPlanStep()}
          {step === "info" && renderInfoStep()}
          {step === "schedule" && renderScheduleStep()}
          {step === "contract" && renderContractStep()}
          {step === "payment" && renderPaymentStep()}
          {step === "success" && renderSuccessStep()}
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  headerBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 16, fontWeight: "700", color: "#1A1A1A" },
  progressRow: { flexDirection: "row", gap: 6, paddingHorizontal: 20, paddingVertical: 10, justifyContent: "center" },
  progressDot: { width: 28, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB" },
  stepTitle: { fontSize: 22, fontWeight: "900", color: "#1A1A1A", marginBottom: 6 },
  stepSub: { fontSize: 14, color: "#6B7280", lineHeight: 20, marginBottom: 20 },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: "#9CA3AF", letterSpacing: 1.5, marginBottom: 8 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: "#1A1A1A", marginBottom: 12 },
  row: { flexDirection: "row", gap: 10 },
  primaryBtn: { backgroundColor: "#0057FF", borderRadius: 14, paddingVertical: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 8 },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  planCard: { borderRadius: 18, overflow: "hidden", borderWidth: 2, marginBottom: 20 },
  planHeader: { padding: 16 },
  planTitle: { color: "#fff", fontSize: 18, fontWeight: "900", flex: 1 },
  planBadge: { backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 100, paddingHorizontal: 10, paddingVertical: 3 },
  planBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  planPrice: { color: "#fff", fontSize: 28, fontWeight: "900" },
  planPriceLabel: { color: "rgba(255,255,255,0.75)", fontSize: 14, fontWeight: "600" },
  planPriceMonthly: { color: "rgba(255,255,255,0.65)", fontSize: 13 },
  planTagline: { color: "rgba(255,255,255,0.85)", fontSize: 13, lineHeight: 19, marginTop: 6 },
  planBody: { backgroundColor: "#FAFAFA", padding: 16, gap: 8 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bulletText: { color: "#374151", fontSize: 13, flex: 1, lineHeight: 19 },
  noteBox: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 4 },
  noteText: { fontSize: 12, lineHeight: 18, fontWeight: "600" },
  selectBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 8 },
  selectBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  scheduleOptionCard: { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 14, padding: 16, backgroundColor: "#FAFAFA" },
  scheduleOptionTitle: { fontSize: 14, fontWeight: "700", color: "#1A1A1A", marginBottom: 4 },
  scheduleOptionDesc: { fontSize: 13, color: "#6B7280", lineHeight: 18 },
  radioCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center", marginTop: 1 },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#fff" },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  chipText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  infoBox: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 4 },
  contractBox: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 16, padding: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  summaryBox: { borderWidth: 1.5, borderRadius: 14, padding: 16, marginBottom: 20, backgroundColor: "#FAFAFA" },
  paymentOption: { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FAFAFA" },
});
