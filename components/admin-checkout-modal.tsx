/**
 * AdminCheckoutModal
 * Reusable payment checkout modal for the admin/ops schedule screen.
 * Mirrors the CheckoutModal in schedule.tsx exactly — uses real Stripe CardField
 * and TapToPayCheckout so Admin and Ops can collect payments the same way Detailers do.
 */

import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import Constants from "expo-constants";
import { useColors } from "@/hooks/use-colors";
import { processStripeCardPayment } from "@/lib/stripe-payment";
import { trpc } from "@/lib/trpc";
import { TapToPayCheckout } from "@/components/tap-to-pay-checkout";

// ─── Types ────────────────────────────────────────────────────────────────────

type PaymentMethod = "credit_debit" | "cash" | "check" | "other" | "tap_to_pay";
type CheckoutStep = "method" | "card_entry" | "tap_to_pay" | "reference" | "tip" | "signature" | "result";

export interface PaymentRecord {
  method: PaymentMethod;
  subtotal: number;
  tipAmount: number;
  total: number;
  paidAt: string;
  paymentIntentId?: string;
  signatureDataUrl?: string;
  referenceNote?: string;
}

interface Job {
  id: string;
  firstName: string;
  lastName: string;
  price: number;
  serviceTitle: string;
  taxAmount?: number;
  discountAmount?: number;
  depositAmount?: number;
  upsellTotal?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  tap_to_pay: "Tap to Pay on iPhone",
  credit_debit: "Credit / Debit Card",
  cash: "Cash",
  check: "Check",
  other: "Other",
};

const PAYMENT_METHOD_ICONS: Record<PaymentMethod, string> = {
  tap_to_pay: "📲",
  credit_debit: "💳",
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

// ─── Signature Canvas ─────────────────────────────────────────────────────────

interface SignatureCanvasRef {
  clearSignature: () => void;
  readSignature: () => Promise<string | undefined>;
}

interface Point { x: number; y: number; }

const SignatureCanvas = React.forwardRef<SignatureCanvasRef, {
  onDraw?: () => void;
  onClear?: () => void;
  onDrawStart?: () => void;
  onDrawEnd?: () => void;
}>(({ onDraw, onClear, onDrawStart, onDrawEnd }, ref) => {
  const [paths, setPaths] = useState<Point[][]>([]);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);
  const svgRef = useRef<any>(null);

  React.useImperativeHandle(ref, () => ({
    clearSignature: () => { setPaths([]); setCurrentPath([]); onClear?.(); },
    readSignature: async () => {
      if (paths.length === 0 && currentPath.length === 0) return undefined;
      return "signature-captured";
    },
  }));

  const toPathD = (pts: Point[]) => {
    if (pts.length < 2) return "";
    return `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");
  };

  const allPaths = [...paths, currentPath];

  return (
    <View
      style={{ flex: 1, backgroundColor: "#fff", borderRadius: 8, overflow: "hidden" }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => {
        const { locationX, locationY } = e.nativeEvent;
        setCurrentPath([{ x: locationX, y: locationY }]);
        onDrawStart?.();
      }}
      onResponderMove={(e) => {
        const { locationX, locationY } = e.nativeEvent;
        setCurrentPath(prev => [...prev, { x: locationX, y: locationY }]);
        onDraw?.();
      }}
      onResponderRelease={() => {
        if (currentPath.length > 0) {
          setPaths(prev => [...prev, currentPath]);
          setCurrentPath([]);
        }
        onDrawEnd?.();
      }}
    >
      <Svg width="100%" height="100%">
        {allPaths.map((pts, i) => {
          const d = toPathD(pts);
          if (!d) return null;
          return <Path key={i} d={d} stroke="#000" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
        })}
      </Svg>
    </View>
  );
});

// ─── AdminCheckoutModal ───────────────────────────────────────────────────────

export function AdminCheckoutModal({
  visible,
  job,
  onClose,
  onComplete,
  customerPhone,
  customerEmail,
}: {
  visible: boolean;
  job: Job;
  onClose: () => void;
  onComplete: (p: PaymentRecord) => void;
  customerPhone?: string | null;
  customerEmail?: string | null;
}) {
  const colors = useColors();
  const [step, setStep] = useState<CheckoutStep>("method");
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  // Card entry state
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [cardComplete, setCardComplete] = useState(false);
  const [cardLast4, setCardLast4] = useState("");
  const [stripePaymentMethodId, setStripePaymentMethodId] = useState<string | null>(null);
  // Other state
  const [referenceNote, setReferenceNote] = useState("");
  const [selectedTipPct, setSelectedTipPct] = useState<number | null>(null);
  const [customTipStr, setCustomTipStr] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const [scrollLocked, setScrollLocked] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentResult, setPaymentResult] = useState<{ success: boolean; message: string; paymentIntentId?: string } | null>(null);
  const [tapToPayIntentId, setTapToPayIntentId] = useState<string | undefined>(undefined);
  const sigRef = useRef<SignatureCanvasRef>(null);

  const createPaymentIntentMutation = trpc.stripe.createPaymentIntent.useMutation();

  // Save card on file toggle
  const [saveCardOnFile, setSaveCardOnFile] = useState(false);
  const [cardholderName, setCardholderName] = useState("");
  const createSetupIntentMutation = trpc.savedCards.createSetupIntent.useMutation();
  const saveCardMutation = trpc.savedCards.saveCard.useMutation();

  // Derive customerKey from phone or email (same logic used across the app)
  const customerKey = (() => {
    const phone = customerPhone ?? job.firstName; // fallback
    const digits = (customerPhone ?? "").replace(/\D/g, "");
    const last10 = digits.slice(-10);
    if (last10.length === 10) return `phone:${last10}`;
    if (customerEmail) return `email:${customerEmail.toLowerCase().trim()}`;
    return `phone:${(customerPhone ?? "").replace(/\D/g, "")}`;
  })();

  const subtotal = (() => {
    const base = (job.price ?? 0) + (job.upsellTotal ?? 0);
    const tax = job.taxAmount ?? 0;
    const discount = job.discountAmount ?? 0;
    const deposit = job.depositAmount ?? 0;
    return Math.max(0, base + tax - discount - deposit);
  })();

  const tipAmount = (() => {
    if (selectedTipPct === null) return 0;
    if (selectedTipPct === -1) return Math.max(0, parseFloat(customTipStr) || 0);
    return Math.round(subtotal * selectedTipPct * 100) / 100;
  })();

  const total = subtotal + tipAmount;

  const fmtCard = (t: string) => t.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
  const fmtExp = (t: string) => { const d = t.replace(/\D/g, "").slice(0, 4); return d.length >= 3 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setStep("method");
      setMethod(null);
      setCardNumber(""); setCardExpiry(""); setCardCvc("");
      setCardComplete(false); setCardLast4(""); setStripePaymentMethodId(null);
      setReferenceNote("");
      setSelectedTipPct(null); setCustomTipStr("");
      setHasSignature(false);
      setIsProcessing(false);
      setPaymentResult(null);
      setTapToPayIntentId(undefined);
      setSaveCardOnFile(false);
      setCardholderName(`${job.firstName} ${job.lastName}`.trim());
    }
  }, [visible]);

  const handleClose = () => {
    setStep("method");
    setMethod(null);
    setCardNumber(""); setCardExpiry(""); setCardCvc("");
    setCardComplete(false); setCardLast4(""); setStripePaymentMethodId(null);
    setReferenceNote("");
    setSelectedTipPct(null); setCustomTipStr("");
    setHasSignature(false);
    setPaymentResult(null);
    setIsProcessing(false);
    setTapToPayIntentId(undefined);
    onClose();
  };

  const handleMethodSelect = (m: PaymentMethod) => {
    setMethod(m);
    if (m === "credit_debit") setStep("card_entry");
    else if (m === "tap_to_pay") setStep("tap_to_pay");
    else if (m === "check" || m === "other") setStep("reference");
    else setStep("signature"); // cash
  };

  const handleCardNext = async () => {
    if (Platform.OS === "web") {
      if (cardNumber.replace(/\s/g, "").length < 13) { Alert.alert("Invalid Card", "Please enter a valid card number."); return; }
      if (cardExpiry.length < 5) { Alert.alert("Invalid Expiry", "Please enter MM/YY."); return; }
      if (cardCvc.length < 3) { Alert.alert("Invalid CVC", "Please enter a valid CVC."); return; }
    } else {
      if (!cardComplete) { Alert.alert("Incomplete Card", "Please complete all card fields."); return; }
      // Create payment method NOW while CardField is still mounted
      try {
        const isExpoGo = Constants.appOwnership === "expo";
        if (!isExpoGo) {
          const { createPaymentMethod } = require("@stripe/stripe-react-native");
          const { paymentMethod, error } = await createPaymentMethod({ paymentMethodType: "Card" });
          if (error) {
            Alert.alert("Card Error", error.message || "Could not read card details. Please try again.");
            return;
          }
          if (paymentMethod?.id) setStripePaymentMethodId(paymentMethod.id);
          if (paymentMethod?.card?.last4) setCardLast4(paymentMethod.card.last4);
        }
      } catch { /* ignore — will fall back to confirmPayment without paymentMethodId */ }
    }
    setStep("tip");
  };

  const handleConfirm = async () => {
    if (!hasSignature) { Alert.alert("Signature Required", "Please sign before confirming."); return; }
    setIsProcessing(true);
    try {
      const sigDataUrl = await sigRef.current?.readSignature();

      if (method === "tap_to_pay") {
        // Payment already captured by TapToPayCheckout — just record it
        setPaymentResult({ success: true, message: "Tap to Pay approved", paymentIntentId: tapToPayIntentId });
        setStep("result");
        onComplete({ method: "tap_to_pay", subtotal, tipAmount, total, paidAt: new Date().toISOString(), signatureDataUrl: sigDataUrl ?? undefined, paymentIntentId: tapToPayIntentId });
        return;
      }

      if (method === "credit_debit") {
        const intentResult = await createPaymentIntentMutation.mutateAsync({
          amountCents: Math.round(total * 100),
          description: `${job.serviceTitle} - ${job.firstName} ${job.lastName}`,
        });
        if (intentResult.demo) {
          setPaymentResult({ success: true, message: "Demo payment approved" });
          setStep("result");
          const digits = cardNumber.replace(/\s/g, "");
          onComplete({ method: method!, subtotal, tipAmount, total, paidAt: new Date().toISOString(), signatureDataUrl: sigDataUrl ?? undefined, referenceNote: referenceNote || undefined });
          return;
        }
        const stripeResult = await processStripeCardPayment(intentResult.clientSecret, stripePaymentMethodId ?? "");
        if (!stripeResult.success) {
          setPaymentResult({ success: false, message: stripeResult.errorMessage ?? "Card payment failed" });
          setStep("result");
          setIsProcessing(false);
          return;
        }
        // Save card on file if toggle is on and we have a real Stripe PM id
        if (saveCardOnFile && stripePaymentMethodId && !stripePaymentMethodId.startsWith("manual_")) {
          try {
            const setupResult = await createSetupIntentMutation.mutateAsync({
              customerKey,
              customerName: cardholderName.trim() || `${job.firstName} ${job.lastName}`,
              customerEmail: customerEmail ?? undefined,
            });
            await saveCardMutation.mutateAsync({
              customerKey,
              customerName: cardholderName.trim() || `${job.firstName} ${job.lastName}`,
              customerEmail: customerEmail ?? undefined,
              customerPhone: customerPhone ?? undefined,
              stripeCustomerId: setupResult.stripeCustomerId,
              stripePaymentMethodId,
              ...(cardLast4 ? { cardLast4 } : {}),
            });
          } catch {
            // Non-fatal — payment succeeded, card save failed silently
          }
        }
        setPaymentResult({ success: true, message: "Payment approved", paymentIntentId: stripeResult.paymentIntentId });
        setStep("result");
        onComplete({ method: method!, subtotal, tipAmount, total, paidAt: new Date().toISOString(), signatureDataUrl: sigDataUrl ?? undefined, paymentIntentId: stripeResult.paymentIntentId, referenceNote: referenceNote || undefined });
        return;
      }

      // Cash / Check / Other
      setPaymentResult({ success: true, message: method === "cash" ? "Cash payment recorded" : method === "check" ? "Check payment recorded" : "Payment recorded successfully." });
      setStep("result");
      onComplete({ method: method!, subtotal, tipAmount, total, paidAt: new Date().toISOString(), signatureDataUrl: sigDataUrl ?? undefined, referenceNote: referenceNote || undefined });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setPaymentResult({ success: false, message: msg });
      setStep("result");
    } finally {
      setIsProcessing(false);
    }
  };

  // ─── Render Steps ─────────────────────────────────────────────────────────

  const renderMethod = () => (
    <View>
      <Text style={[co.sheetTitle, { color: colors.foreground }]}>Collect Payment</Text>
      <Text style={[co.sheetSubtitle, { color: colors.muted }]}>{job.firstName} {job.lastName} · {job.serviceTitle}</Text>
      <View style={[co.totalBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[co.totalLabel, { color: colors.muted }]}>Amount Due</Text>
        <Text style={[co.totalAmount, { color: colors.primary }]}>${subtotal.toFixed(2)}</Text>
      </View>
      <Text style={[co.sectionLabel, { color: colors.muted }]}>SELECT PAYMENT METHOD</Text>
      {/* Tap to Pay — iOS only */}
      {Platform.OS === "ios" && (
        <TouchableOpacity
          onPress={() => handleMethodSelect("tap_to_pay")}
          style={[co.methodRow, { backgroundColor: "#8B5CF618", borderColor: "#8B5CF640" }]}
          activeOpacity={0.75}
        >
          <Text style={co.methodIcon}>📲</Text>
          <View style={{ flex: 1 }}>
            <Text style={[co.methodLabel, { color: colors.foreground }]}>Tap to Pay on iPhone</Text>
            <Text style={{ fontSize: 11, color: "#8B5CF6", marginTop: 1 }}>Customer taps card or phone — no reader needed</Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
        </TouchableOpacity>
      )}
      {(["credit_debit", "cash", "check", "other"] as PaymentMethod[]).map((m) => (
        <TouchableOpacity
          key={m}
          onPress={() => handleMethodSelect(m)}
          style={[co.methodRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
          activeOpacity={0.75}
        >
          <Text style={co.methodIcon}>{PAYMENT_METHOD_ICONS[m]}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[co.methodLabel, { color: colors.foreground }]}>{PAYMENT_METHOD_LABELS[m]}</Text>
            {m === "credit_debit" && <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>Type in card number manually</Text>}
          </View>
          <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderTapToPay = () => (
    <TapToPayCheckout
      amountCents={Math.round(total * 100)}
      jobId={job.id}
      customerName={`${job.firstName} ${job.lastName}`}
      serviceTitle={job.serviceTitle}
      onSuccess={(paymentIntentId) => {
        setTapToPayIntentId(paymentIntentId);
        setStep("tip");
      }}
      onCancel={() => setStep("method")}
    />
  );

  const renderCard = () => {
    const isExpoGo = Constants.appOwnership === "expo";
    const isNative = Platform.OS !== "web" && !isExpoGo;
    let StripeCardField: React.ComponentType<{
      onCardChange: (details: { complete: boolean; last4?: string }) => void;
      style?: object;
      cardStyle?: object;
    }> | null = null;
    if (isNative) {
      try {
        const stripeModule = require("@stripe/stripe-react-native");
        StripeCardField = stripeModule.CardField ?? null;
      } catch { /* ignore if module not linked */ }
    }
    return (
      <View>
        <TouchableOpacity onPress={() => setStep("method")} style={co.backBtn}>
          <Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[co.sheetTitle, { color: colors.foreground }]}>Credit or Debit Card</Text>
        <Text style={[co.sheetSubtitle, { color: colors.muted }]}>Total: <Text style={{ color: colors.primary, fontWeight: "700" }}>${subtotal.toFixed(2)}</Text></Text>
        <View style={[co.cardBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {isNative && StripeCardField ? (
            <>
              <Text style={[co.inputLabel, { color: colors.muted }]}>Card Details</Text>
              <StripeCardField
                onCardChange={(details) => {
                  setCardComplete(details.complete);
                  if (details.last4) setCardLast4(details.last4);
                }}
                style={{ height: 50, marginBottom: 12 }}
                cardStyle={{ backgroundColor: colors.background, textColor: colors.foreground, placeholderColor: colors.muted, borderColor: colors.border, borderWidth: 1, borderRadius: 10 }}
              />
            </>
          ) : (
            <>
              <Text style={[co.inputLabel, { color: colors.muted }]}>Card Number</Text>
              <TextInput
                value={cardNumber}
                onChangeText={(t) => setCardNumber(fmtCard(t))}
                placeholder="1234 5678 9012 3456"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                maxLength={19}
                style={[co.cardInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[co.inputLabel, { color: colors.muted }]}>Expiry</Text>
                  <TextInput
                    value={cardExpiry}
                    onChangeText={(t) => setCardExpiry(fmtExp(t))}
                    placeholder="MM/YY"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    maxLength={5}
                    style={[co.cardInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[co.inputLabel, { color: colors.muted }]}>CVC</Text>
                  <TextInput
                    value={cardCvc}
                    onChangeText={(t) => setCardCvc(t.replace(/\D/g, "").slice(0, 4))}
                    placeholder="123"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    maxLength={4}
                    secureTextEntry
                    style={[co.cardInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                  />
                </View>
              </View>
            </>
          )}
        </View>
        {/* Save card on file toggle */}
        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginTop: 8, borderWidth: 1, borderColor: saveCardOnFile ? colors.primary + "66" : colors.border }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>Save card on file</Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>Charge this card for future jobs without re-entering</Text>
          </View>
          <TouchableOpacity
            onPress={() => setSaveCardOnFile(v => !v)}
            style={{ width: 48, height: 28, borderRadius: 14, backgroundColor: saveCardOnFile ? colors.primary : colors.border, justifyContent: "center", paddingHorizontal: 2 }}
            activeOpacity={0.8}
          >
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "#fff", alignSelf: saveCardOnFile ? "flex-end" : "flex-start", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 2, elevation: 2 }} />
          </TouchableOpacity>
        </View>
        {saveCardOnFile && (
          <View style={{ marginTop: 10 }}>
            <Text style={[co.inputLabel, { color: colors.muted }]}>Name on Card</Text>
            <TextInput
              value={cardholderName}
              onChangeText={setCardholderName}
              placeholder="Full name"
              placeholderTextColor={colors.muted}
              style={[co.cardInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              returnKeyType="done"
            />
          </View>
        )}
        <TouchableOpacity
          onPress={handleCardNext}
          style={[co.primaryBtn, { backgroundColor: colors.primary, marginTop: 8 }]}
          activeOpacity={0.8}
        >
          <Text style={co.primaryBtnText}>Continue to Tip →</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderReference = () => (
    <View>
      <TouchableOpacity onPress={() => setStep("method")} style={co.backBtn}>
        <Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={[co.sheetTitle, { color: colors.foreground }]}>{method === "check" ? "Check Details" : "Payment Reference"}</Text>
      <Text style={[co.sheetSubtitle, { color: colors.muted }]}>Total: <Text style={{ color: colors.primary, fontWeight: "700" }}>${subtotal.toFixed(2)}</Text></Text>
      <Text style={[co.inputLabel, { color: colors.muted, marginTop: 16 }]}>{method === "check" ? "Check Number (optional)" : "Reference / Note (optional)"}</Text>
      <TextInput
        value={referenceNote}
        onChangeText={setReferenceNote}
        placeholder={method === "check" ? "e.g. 1042" : "e.g. Invoice #123"}
        placeholderTextColor={colors.muted}
        style={[co.cardInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
      />
      <TouchableOpacity onPress={() => setStep("tip")} style={[co.primaryBtn, { backgroundColor: colors.primary, marginTop: 8 }]} activeOpacity={0.8}>
        <Text style={co.primaryBtnText}>Continue to Tip →</Text>
      </TouchableOpacity>
    </View>
  );

  const renderTip = () => {
    const isCustom = selectedTipPct === -1;
    return (
      <View>
        <TouchableOpacity
          onPress={() => setStep(method === "credit_debit" ? "card_entry" : (method === "check" || method === "other") ? "reference" : method === "tap_to_pay" ? "method" : "method")}
          style={co.backBtn}
        >
          <Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[co.sheetTitle, { color: colors.foreground }]}>Add a Tip</Text>
        <View style={[co.tipSummaryBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.muted }]}>Service</Text><Text style={[co.tipSummaryValue, { color: colors.foreground }]}>${subtotal.toFixed(2)}</Text></View>
          <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.muted }]}>Tip</Text><Text style={[co.tipSummaryValue, { color: tipAmount > 0 ? "#22C55E" : colors.muted }]}>{tipAmount > 0 ? `+$${tipAmount.toFixed(2)}` : "—"}</Text></View>
          <View style={[co.tipDivider, { backgroundColor: colors.border }]} />
          <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.foreground, fontWeight: "700", fontSize: 16 }]}>Total</Text><Text style={[co.tipSummaryValue, { color: colors.primary, fontWeight: "800", fontSize: 20 }]}>${total.toFixed(2)}</Text></View>
        </View>
        <Text style={[co.sectionLabel, { color: colors.muted, marginTop: 4 }]}>SELECT TIP AMOUNT</Text>
        <View style={co.tipPresetRow}>
          {TIP_PRESETS.map((p) => {
            const sel = selectedTipPct === p.pct;
            const amt = Math.round(subtotal * p.pct * 100) / 100;
            return (
              <TouchableOpacity
                key={p.label}
                onPress={() => { setSelectedTipPct(p.pct); setCustomTipStr(""); }}
                style={[co.tipPresetBtn, { backgroundColor: sel ? colors.primary : colors.surface, borderColor: sel ? colors.primary : colors.border }]}
                activeOpacity={0.75}
              >
                <Text style={[co.tipPresetPct, { color: sel ? "#fff" : colors.foreground }]}>{p.label}</Text>
                <Text style={[co.tipPresetAmt, { color: sel ? "rgba(255,255,255,0.8)" : colors.muted }]}>${amt.toFixed(2)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <TouchableOpacity
            onPress={() => { setSelectedTipPct(null); setCustomTipStr(""); }}
            style={[co.tipAltBtn, { backgroundColor: selectedTipPct === null ? colors.surface : colors.background, borderColor: selectedTipPct === null ? colors.foreground : colors.border }]}
            activeOpacity={0.75}
          >
            <Text style={[{ fontWeight: "600", fontSize: 14 }, { color: selectedTipPct === null ? colors.foreground : colors.muted }]}>No Tip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setSelectedTipPct(-1)}
            style={[co.tipAltBtn, { flex: 2, backgroundColor: isCustom ? colors.surface : colors.background, borderColor: isCustom ? colors.foreground : colors.border }]}
            activeOpacity={0.75}
          >
            <Text style={[{ fontWeight: "600", fontSize: 14 }, { color: isCustom ? colors.foreground : colors.muted }]}>Custom</Text>
          </TouchableOpacity>
        </View>
        {isCustom && (
          <View style={{ marginTop: 12 }}>
            <Text style={[co.inputLabel, { color: colors.muted }]}>Custom Tip Amount ($)</Text>
            <TextInput
              value={customTipStr}
              onChangeText={(t) => setCustomTipStr(t.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              autoFocus
              style={[co.cardInput, { color: colors.foreground, borderColor: colors.primary, backgroundColor: colors.background, fontSize: 20, textAlign: "center" }]}
            />
          </View>
        )}
        <TouchableOpacity onPress={() => setStep("signature")} style={[co.primaryBtn, { backgroundColor: colors.primary, marginTop: 20 }]} activeOpacity={0.8}>
          <Text style={co.primaryBtnText}>{tipAmount > 0 ? `Continue  ·  Total $${total.toFixed(2)} →` : "Continue to Signature →"}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderSignature = () => (
    <View>
      <TouchableOpacity onPress={() => setStep(method === "credit_debit" || method === "tap_to_pay" ? "tip" : method === "check" || method === "other" ? "reference" : "method")} style={co.backBtn}>
        <Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={[co.sheetTitle, { color: colors.foreground }]}>Customer Signature</Text>
      <View style={[co.receiptBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={co.tipSummaryRow}>
          <Text style={[co.tipSummaryLabel, { color: colors.muted }]}>{PAYMENT_METHOD_ICONS[method!]} {PAYMENT_METHOD_LABELS[method!]}{method === "credit_debit" && cardLast4 ? ` ···· ${cardLast4}` : ""}</Text>
          <Text style={[co.tipSummaryLabel, { color: colors.muted }]}>${subtotal.toFixed(2)}</Text>
        </View>
        {tipAmount > 0 && <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.muted }]}>Tip</Text><Text style={[co.tipSummaryLabel, { color: "#22C55E" }]}>+${tipAmount.toFixed(2)}</Text></View>}
        <View style={[co.tipDivider, { backgroundColor: colors.border }]} />
        <View style={co.tipSummaryRow}>
          <Text style={[{ fontWeight: "700", fontSize: 15 }, { color: colors.foreground }]}>Total Charged</Text>
          <Text style={[{ fontWeight: "800", fontSize: 18 }, { color: colors.primary }]}>${total.toFixed(2)}</Text>
        </View>
      </View>
      <Text style={[co.sigInstructions, { color: colors.foreground, marginTop: 14 }]}>Sign below to authorize payment:</Text>
      <View style={[co.sigBox, { borderColor: hasSignature ? colors.primary : colors.border }]}>
        <SignatureCanvas
          ref={sigRef}
          onDraw={() => setHasSignature(true)}
          onClear={() => setHasSignature(false)}
          onDrawStart={() => setScrollLocked(true)}
          onDrawEnd={() => setScrollLocked(false)}
        />
        {!hasSignature && (
          <View style={co.sigPlaceholder} pointerEvents="none">
            <Text style={{ color: "#aaa", fontSize: 14 }}>Sign here</Text>
          </View>
        )}
      </View>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
        <TouchableOpacity
          onPress={() => { sigRef.current?.clearSignature(); setHasSignature(false); }}
          style={[co.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
          activeOpacity={0.75}
        >
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleConfirm}
          disabled={!hasSignature || isProcessing}
          style={[co.primaryBtn, { flex: 2, backgroundColor: "#22C55E", opacity: hasSignature && !isProcessing ? 1 : 0.4 }]}
          activeOpacity={0.8}
        >
          {isProcessing ? <ActivityIndicator color="#fff" /> : <Text style={co.primaryBtnText}>✓ Confirm Payment</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderResult = () => {
    const success = paymentResult?.success ?? false;
    const iconColor = success ? "#22C55E" : "#EF4444";
    const title = success ? "Payment Approved" : "Payment Declined";
    const subtitle = paymentResult?.message ?? "";
    return (
      <View style={{ alignItems: "center", paddingVertical: 32 }}>
        <View style={[co.resultIconCircle, { backgroundColor: iconColor + "22", borderColor: iconColor }]}>
          <Text style={{ fontSize: 48, color: iconColor, fontWeight: "800" }}>{success ? "✓" : "✕"}</Text>
        </View>
        <Text style={[co.resultTitle, { color: colors.foreground, marginTop: 20 }]}>{title}</Text>
        <Text style={[co.resultSubtitle, { color: colors.muted, marginTop: 8 }]}>{subtitle}</Text>
        {success && (
          <View style={[co.receiptBox, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 24, width: "100%" }]}>
            <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.muted }]}>Service</Text><Text style={[co.tipSummaryValue, { color: colors.foreground }]}>${subtotal.toFixed(2)}</Text></View>
            {tipAmount > 0 && <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.muted }]}>Tip</Text><Text style={[co.tipSummaryValue, { color: "#22C55E" }]}>+${tipAmount.toFixed(2)}</Text></View>}
            <View style={[co.tipDivider, { backgroundColor: colors.border }]} />
            <View style={co.tipSummaryRow}><Text style={[{ fontWeight: "700", fontSize: 15 }, { color: colors.foreground }]}>Total Charged</Text><Text style={[{ fontWeight: "800", fontSize: 18 }, { color: colors.primary }]}>${total.toFixed(2)}</Text></View>
            <View style={co.tipSummaryRow}><Text style={[co.tipSummaryLabel, { color: colors.muted }]}>Method</Text><Text style={[co.tipSummaryValue, { color: colors.foreground }]}>{PAYMENT_METHOD_ICONS[method!]} {PAYMENT_METHOD_LABELS[method!]}</Text></View>
          </View>
        )}
        <TouchableOpacity
          onPress={success ? handleClose : () => { setStep("method"); setPaymentResult(null); }}
          style={[co.primaryBtn, { backgroundColor: success ? "#22C55E" : colors.primary, marginTop: 24, width: "100%" }]}
          activeOpacity={0.8}
        >
          <Text style={co.primaryBtnText}>{success ? "Done" : "Try Again"}</Text>
        </TouchableOpacity>
        {!success && (
          <TouchableOpacity onPress={() => { setStep("method"); setPaymentResult(null); }} style={{ marginTop: 12, paddingVertical: 10 }}>
            <Text style={{ color: colors.muted, fontSize: 14 }}>Choose a different payment method</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (!visible) return null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={[StyleSheet.absoluteFillObject, { zIndex: 999 }]} pointerEvents="box-none">
      <View style={co.overlay}>
        <View style={[co.sheet, { backgroundColor: colors.surface }]}>
          {step !== "result" && (
            <TouchableOpacity onPress={handleClose} style={co.closeBtn}>
              <Text style={{ color: colors.muted, fontSize: 22 }}>✕</Text>
            </TouchableOpacity>
          )}
          {/* Signature step: outside ScrollView so the canvas never scrolls while drawing */}
          {step === "signature" ? (
            <View style={{ paddingBottom: 24 }}>{renderSignature()}</View>
          ) : step === "tap_to_pay" ? (
            // TapToPayCheckout manages its own layout
            <View style={{ paddingBottom: 24 }}>{renderTapToPay()}</View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              scrollEnabled={!scrollLocked}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              {step === "method" && renderMethod()}
              {step === "card_entry" && renderCard()}
              {step === "reference" && renderReference()}
              {step === "tip" && renderTip()}
              {step === "result" && renderResult()}
            </ScrollView>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
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
  methodLabel: { fontSize: 16, fontWeight: "600" },
  cardBox: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 20 },
  inputLabel: { fontSize: 12, fontWeight: "600", marginBottom: 6, letterSpacing: 0.5 },
  cardInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 12 },
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
