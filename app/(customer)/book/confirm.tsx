import { useState, useRef, useEffect } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, TextInput, KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { useCustomerAuth } from "@/lib/customer-context";
import { useBooking } from "@/lib/booking-context";
import { trpc } from "@/lib/trpc";
import { MaterialIcons } from "@expo/vector-icons";

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function BookConfirmStep() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token, customer } = useCustomerAuth();
  const {
    booking, total, subtotal, referralDiscount, promoDiscount,
    setPromoCode, setReferralCode, resetBooking, setGuestInfo,
  } = useBooking();

  // ── Referral code state ──
  const [referralInput, setReferralInput] = useState("");
  const [referralApplied, setReferralApplied] = useState(false);
  const [referralError, setReferralError] = useState("");
  const [referralValidating, setReferralValidating] = useState(false);

  // ── Promo code state ──
  const [promoInput, setPromoInput] = useState("");
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoError, setPromoError] = useState("");
  const [promoValidating, setPromoValidating] = useState(false);

  // ── Booking submission ──
  const [submitting, setSubmitting] = useState(false);

  // Guard against setState after unmount (router.replace navigates away before finally runs)
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // ── Utils (for imperative queries) ──
  const utils = trpc.useUtils();

  // ── Mutations ──
  const validatePromoMutation = trpc.promotions.validateCode.useMutation();
  const promoteAbandonedCart = trpc.pipeline.promoteAbandonedCart.useMutation();
  const completeCart = trpc.abandonedCarts.complete.useMutation();

  function onBookingSuccess(bookingRef: string) {
    const abandonedId = booking.abandonedBookingId;
    const pkgName = booking.pkg?.name;
    const bookingDate = booking.scheduledDate;
    const bookingTotal = String(total);
    const dateParam = encodeURIComponent(booking.scheduledDate ?? "");
    const timeParam = encodeURIComponent(booking.scheduledTime ?? "");
    const serviceParam = encodeURIComponent(booking.pkg?.name ?? "Detail Service");
    const addressParam = encodeURIComponent(booking.address?.fullAddress ?? "");
    const isGuestParam = !token ? "true" : "false";
    router.replace(`/(customer)/book/success?ref=${bookingRef}&date=${dateParam}&time=${timeParam}&service=${serviceParam}&address=${addressParam}&isGuest=${isGuestParam}` as any);
    setTimeout(() => {
      resetBooking();
      if (abandonedId) {
        try {
          promoteAbandonedCart.mutate({ abandonedBookingId: abandonedId, packageType: pkgName, bookingDate, totalPrice: bookingTotal });
          completeCart.mutate({ cartId: `cart_${abandonedId}` });
        } catch (_) {}
      }
    }, 500);
  }

  const createBookingMutation = trpc.customer.createBooking.useMutation({
    onSuccess: (data) => onBookingSuccess(data.bookingRef),
    onError: (err) => {
      setSubmitting(false);
      Alert.alert("Booking Failed", err.message || "Something went wrong. Please try again.");
    },
  });

  const createGuestBookingMutation = trpc.customer.createGuestBooking.useMutation({
    onSuccess: (data) => onBookingSuccess(data.bookingRef),
    onError: (err) => {
      setSubmitting(false);
      Alert.alert("Booking Failed", err.message || "Something went wrong. Please try again.");
    },
  });

  // ── Referral code validation ──
  async function handleApplyReferral() {
    const code = referralInput.trim().toUpperCase();
    if (!code) return;
    setReferralValidating(true);
    setReferralError("");
    try {
      const res = await utils.referral.validateCode.fetch({ code });
      if (res?.valid) {
        setReferralCode(code);
        setReferralApplied(true);
        setReferralError("");
      } else {
        setReferralError("Invalid referral code. Please check and try again.");
        setReferralCode(null);
        setReferralApplied(false);
      }
    } catch {
      setReferralError("Could not validate referral code. Try again.");
    } finally {
      setReferralValidating(false);
    }
  }

  function handleRemoveReferral() {
    setReferralCode(null);
    setReferralApplied(false);
    setReferralInput("");
    setReferralError("");
  }

  // ── Promo code validation ──
  async function handleApplyPromo() {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setPromoValidating(true);
    setPromoError("");
    try {
      const result = await validatePromoMutation.mutateAsync({ code, subtotal: subtotal ?? 0 });
      if (result.valid) {
        setPromoCode(code, result.discountAmount ?? 0);
        setPromoApplied(true);
        setPromoError("");
      } else {
        setPromoError(result.message ?? "Invalid promo code.");
        setPromoCode(null, 0);
        setPromoApplied(false);
      }
    } catch {
      setPromoError("Could not validate promo code. Try again.");
    } finally {
      setPromoValidating(false);
    }
  }

  function handleRemovePromo() {
    setPromoCode(null, 0);
    setPromoApplied(false);
    setPromoInput("");
    setPromoError("");
  }

  // ── Final booking submission ──
  async function handleConfirm() {
    if (!booking.vehicle || !booking.pkg || !booking.address || !booking.scheduledDate || !booking.scheduledTime) {
      Alert.alert("Missing Info", "Please complete all booking steps.");
      return;
    }

    // ── Guest flow ──
    if (!token) {
      const guestInfo = booking.guestInfo;
      if (!guestInfo) {
        Alert.alert("Missing Info", "Please go back and fill in your contact information on the vehicle step.");
        return;
      }
      const fn = guestInfo.firstName.trim();
      const ln = guestInfo.lastName.trim();
      const em = guestInfo.email.trim().toLowerCase();
      const ph = guestInfo.phone.trim();
      if (!fn || !ln) { Alert.alert("Missing Info", "Please enter your first and last name."); return; }
      if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { Alert.alert("Invalid Email", "Please enter a valid email address."); return; }
      if (!ph || ph.replace(/\D/g, "").length < 7) { Alert.alert("Invalid Phone", "Please enter a valid phone number."); return; }
      setSubmitting(true);
      try {
        const veh = booking.vehicle;
        const addonIds = Array.isArray(booking.addons) ? booking.addons.map((a) => a.id) : [];
        // Parse year/make/model from vehicle label (e.g. "2022 Toyota Camry")
        const labelParts = veh.label.split(" ");
        const vehicleYear = labelParts[0] ?? veh.year ?? "";
        const vehicleMake = labelParts[1] ?? veh.make ?? "";
        const vehicleModel = labelParts.slice(2).join(" ") || veh.model || "";
        await createGuestBookingMutation.mutateAsync({
          firstName: fn,
          lastName: ln,
          email: em,
          phone: ph,
          vehicleYear,
          vehicleMake,
          vehicleModel,
          vehicleType: veh.vehicleType as any,
          vehicleColor: veh.color ?? undefined,
          vehicleLabel: veh.label,
          packageId: booking.pkg.id,
          packageName: booking.pkg.name,
          addons: addonIds,
          addressLabel: booking.address.fullAddress,
          city: booking.address.city,
          scheduledDate: booking.scheduledDate,
          scheduledTime: booking.scheduledTime,
          subtotal: booking.pkg.price ?? 0,
          total,
          discountCode: booking.promoCode ?? undefined,
          discountAmount: promoDiscount > 0 ? promoDiscount : undefined,
          notes: undefined,
        });
      } catch (err: any) {
        if (!err?.message?.includes("Booking Failed")) {
          Alert.alert("Booking Failed", err?.message || "Something went wrong. Please try again.");
        }
        if (isMounted.current) setSubmitting(false);
      }
      return;
    }

    // ── Authenticated flow ──
    setSubmitting(true);
    try {
      const addonIds = Array.isArray(booking.addons) ? booking.addons.map((a) => a.id) : [];
      await createBookingMutation.mutateAsync({
        token,
        vehicleId: booking.vehicle.vehicleId,
        vehicleType: booking.vehicle.vehicleType as any,
        vehicleLabel: booking.vehicle.label,
        packageId: booking.pkg.id,
        packageName: booking.pkg.name,
        addons: addonIds,
        addressId: booking.address.addressId,
        addressLabel: booking.address.fullAddress,
        city: booking.address.city,
        scheduledDate: booking.scheduledDate,
        scheduledTime: booking.scheduledTime,
        subtotal: booking.pkg.price ?? 0,
        total,
        referralCode: booking.referralCode ?? undefined,
        discountCode: booking.promoCode ?? undefined,
        discountAmount: promoDiscount > 0 ? promoDiscount : undefined,
        depositAmount: 0,
        depositPaymentIntentId: undefined,
      });
    } catch (err: any) {
      if (!err?.message?.includes("Booking Failed")) {
        Alert.alert("Booking Failed", err?.message || "Something went wrong. Please try again.");
      }
      if (isMounted.current) setSubmitting(false);
    }
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  return (
    <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review & Confirm</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 180 }}>
          <Text style={styles.sectionTitle}>Order Summary</Text>
          <Text style={styles.sectionSub}>Review your booking before confirming.</Text>

          {/* Vehicle */}
          <SummarySection icon="directions-car" title="Vehicle">
            <Text style={styles.summaryValue}>{booking.vehicle?.label}</Text>
            <Text style={styles.summaryMeta}>
              {booking.vehicle?.vehicleType?.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              {booking.vehicle?.color ? ` · ${booking.vehicle.color}` : ""}
            </Text>
          </SummarySection>

          {/* Package */}
          <SummarySection icon="local-offer" title="Package">
            <View style={styles.priceRow}>
              <Text style={styles.summaryValue}>{booking.pkg?.name}</Text>
              <Text style={styles.summaryPrice}>${booking.pkg?.price}</Text>
            </View>
          </SummarySection>

          {/* Add-ons */}
          {booking.addons.length > 0 && (
            <SummarySection icon="add-circle" title="Add-Ons">
              {booking.addons.map((a) => (
                <View key={a.id} style={styles.priceRow}>
                  <Text style={styles.summaryMeta}>{a.name}</Text>
                  <Text style={styles.summaryMeta}>+${a.price}</Text>
                </View>
              ))}
            </SummarySection>
          )}

          {/* Location */}
          <SummarySection icon="place" title="Location">
            <Text style={styles.summaryValue}>{booking.address?.label}</Text>
            <Text style={styles.summaryMeta}>{booking.address?.fullAddress}</Text>
          </SummarySection>

          {/* Date & Time */}
          <SummarySection icon="event" title="Date & Time">
            <Text style={styles.summaryValue}>{booking.scheduledDate ? formatDate(booking.scheduledDate) : ""}</Text>
            <Text style={styles.summaryMeta}>{booking.scheduledTime}</Text>
          </SummarySection>

          {/* ── Referral Code (authenticated only) ── */}
          {!!token && (
            <View style={styles.promoSection}>
              <View style={styles.summarySectionHeader}>
                <MaterialIcons name="people" size={16} color="#9CA3AF" />
                <Text style={styles.summarySectionTitle}>Referral Code</Text>
              </View>
              {referralApplied ? (
                <View style={styles.promoAppliedRow}>
                  <View style={styles.promoAppliedBadge}>
                    <MaterialIcons name="check-circle" size={16} color="#059669" />
                    <Text style={styles.promoAppliedText}>{booking.referralCode} — 10% off applied!</Text>
                  </View>
                  <TouchableOpacity onPress={handleRemoveReferral}>
                    <Text style={styles.promoRemoveText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={styles.promoInputRow}>
                    <TextInput
                      value={referralInput}
                      onChangeText={(t) => setReferralInput(t.toUpperCase())}
                      placeholder="Enter referral code"
                      placeholderTextColor="#9CA3AF"
                      autoCapitalize="characters"
                      style={[styles.promoInput, referralError ? styles.promoInputError : null]}
                      returnKeyType="done"
                      onSubmitEditing={handleApplyReferral}
                    />
                    <TouchableOpacity
                      style={styles.promoApplyBtn}
                      onPress={handleApplyReferral}
                      disabled={referralValidating || !referralInput.trim()}
                      activeOpacity={0.85}
                    >
                      {referralValidating ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.promoApplyBtnText}>Apply</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  {referralError ? <Text style={styles.promoErrorText}>{referralError}</Text> : null}
                </>
              )}
            </View>
          )}

          {/* ── Promo Code ── */}
          <View style={styles.promoSection}>
            <View style={styles.summarySectionHeader}>
              <MaterialIcons name="local-offer" size={16} color="#9CA3AF" />
              <Text style={styles.summarySectionTitle}>Promo Code</Text>
            </View>
            {promoApplied ? (
              <View style={styles.promoAppliedRow}>
                <View style={styles.promoAppliedBadge}>
                  <MaterialIcons name="check-circle" size={16} color="#059669" />
                  <Text style={styles.promoAppliedText}>{booking.promoCode} — ${promoDiscount.toFixed(2)} off!</Text>
                </View>
                <TouchableOpacity onPress={handleRemovePromo}>
                  <Text style={styles.promoRemoveText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.promoInputRow}>
                  <TextInput
                    value={promoInput}
                    onChangeText={(t) => setPromoInput(t.toUpperCase())}
                    placeholder="Enter promo code"
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="characters"
                    style={[styles.promoInput, promoError ? styles.promoInputError : null]}
                    returnKeyType="done"
                    onSubmitEditing={handleApplyPromo}
                  />
                  <TouchableOpacity
                    style={styles.promoApplyBtn}
                    onPress={handleApplyPromo}
                    disabled={promoValidating || !promoInput.trim()}
                    activeOpacity={0.85}
                  >
                    {promoValidating ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.promoApplyBtnText}>Apply</Text>
                    )}
                  </TouchableOpacity>
                </View>
                {promoError ? <Text style={styles.promoErrorText}>{promoError}</Text> : null}
              </>
            )}
          </View>

          {/* Discount rows */}
          {referralDiscount > 0 && (
            <View style={styles.discountRow}>
              <Text style={styles.discountLabel}>Referral Discount (10%)</Text>
              <Text style={styles.discountAmount}>−${referralDiscount.toFixed(2)}</Text>
            </View>
          )}
          {promoDiscount > 0 && (
            <View style={styles.discountRow}>
              <Text style={styles.discountLabel}>Promo: {booking.promoCode}</Text>
              <Text style={styles.discountAmount}>−${promoDiscount.toFixed(2)}</Text>
            </View>
          )}

          {/* Total */}
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>${total.toFixed(2)}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Confirm button */}
      <View style={[styles.bottomBar, { paddingBottom: Platform.OS === "android" ? Math.max(insets.bottom + 16, 36) : 36 }]}>
        <TouchableOpacity
          style={[styles.confirmBtn, submitting && styles.confirmBtnDisabled]}
          onPress={handleConfirm}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <MaterialIcons name="check-circle" size={20} color="#FFFFFF" />
              <Text style={styles.confirmBtnText}>Confirm Booking</Text>
            </>
          )}
        </TouchableOpacity>
        <Text style={styles.confirmNote}>We'll send your booking confirmation to your email.</Text>
      </View>
    </ScreenContainer>
  );
}

function SummarySection({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.summarySection}>
      <View style={styles.summarySectionHeader}>
        <MaterialIcons name={icon as any} size={16} color="#9CA3AF" />
        <Text style={styles.summarySectionTitle}>{title}</Text>
      </View>
      <View style={{ paddingLeft: 24 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#1A1A1A" },
  sectionTitle: { fontSize: 22, fontWeight: "800", color: "#1A1A1A", marginBottom: 4 },
  sectionSub: { fontSize: 13, color: "#9CA3AF", marginBottom: 24 },
  summarySection: { marginBottom: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" },
  summarySectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  summarySectionTitle: { fontSize: 12, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5 },
  summaryValue: { fontSize: 16, fontWeight: "700", color: "#1A1A1A", marginBottom: 2 },
  summaryMeta: { fontSize: 13, color: "#6B7280", marginBottom: 2 },
  priceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
  summaryPrice: { fontSize: 16, fontWeight: "700", color: "#1A1A1A" },
  // Promo code
  promoSection: { marginBottom: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" },
  promoInputRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 24 },
  promoInput: { flex: 1, borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: "#1A1A1A", backgroundColor: "#FAFAFA", letterSpacing: 1 },
  promoInputError: { borderColor: "#EF4444" },
  promoApplyBtn: { backgroundColor: "#1A1A1A", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11 },
  promoApplyBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  promoAppliedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 24 },
  promoAppliedBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#D1FAE5", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  promoAppliedText: { fontSize: 14, fontWeight: "600", color: "#059669" },
  promoRemoveText: { fontSize: 13, color: "#EF4444", fontWeight: "600" },
  promoErrorText: { fontSize: 12, color: "#EF4444", marginTop: 6, paddingLeft: 24 },
  // Discounts
  discountRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#D1FAE5", borderRadius: 10, padding: 12, marginBottom: 12 },
  discountLabel: { fontSize: 14, fontWeight: "600", color: "#059669" },
  discountAmount: { fontSize: 14, fontWeight: "700", color: "#059669" },
  // Total
  totalCard: { backgroundColor: "#1A1A1A", borderRadius: 16, padding: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  totalLabel: { fontSize: 14, color: "#9CA3AF" },
  totalAmount: { fontSize: 28, fontWeight: "900", color: "#FFFFFF" },
  // Bottom bar
  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: "#F0F0F0" },
  confirmBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#1A1A1A", borderRadius: 100, paddingVertical: 16 },
  confirmBtnDisabled: { backgroundColor: "#9CA3AF" },
  confirmBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  confirmNote: { fontSize: 12, color: "#9CA3AF", textAlign: "center", marginTop: 10 },
});
