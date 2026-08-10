/**
 * Customer Booking — Package Selection
 *
 * Fully driven by the Price Book API:
 * - Fetches active services from trpc.pricebook.list
 * - Shows each service's image (uploaded in Price Book admin), name, description,
 *   features, and price for the customer's selected vehicle type
 * - Only active services appear (admin toggle controls this)
 * - Subscription/VIP services are filtered out from regular booking
 * - RV bookings show size-tier cards (20-29ft, 30-39ft, 40ft+)
 */
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useBooking, type VehicleType } from "@/lib/booking-context";
import { useCustomerAuth } from "@/lib/customer-context";
import { trpc } from "@/lib/trpc";
import { MaterialIcons } from "@expo/vector-icons";
import { StepIndicator } from "./vehicle";

// ─── Subscription service IDs to hide from regular booking ───────────────────
// These are VIP / Maintenance Program entries that should not appear in the
// standard booking flow (they are booked through the VIP portal instead).
const SUBSCRIPTION_IDS = new Set([
  "pb_mpn0yohe0qes",
  "pb_mpssufsvme94",
  "pb_mpws9prd5cu1",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Map booking context vehicleType to the Price Book vehiclePrices key */
function toPriceKey(vt: VehicleType): string {
  if (vt === "large_suv_van") return "xl_suv_van";
  return vt; // sedan, suv, truck, rv map directly (rv handled separately)
}

/** True if this service is RV-specific (has rv size prices, no standard vehicle price) */
function isRvService(vp: {
  sedan?: number;
  rv_20_29?: number;
  rv_30_39?: number;
  rv_40_plus?: number;
}): boolean {
  const hasRv =
    (vp.rv_20_29 ?? 0) > 0 ||
    (vp.rv_30_39 ?? 0) > 0 ||
    (vp.rv_40_plus ?? 0) > 0;
  const hasStandard = (vp.sedan ?? 0) > 0;
  return hasRv && !hasStandard;
}

// ─── Placeholder image when a service has no photo yet ───────────────────────
const PLACEHOLDER_IMAGE =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663471903126/n2wVeYQgKmefAVwyN2KSSe/package-full-LVMhQhooy5LLFKtSMxfnxN.webp";

export default function BookPackageStep() {
  const router = useRouter();
  const params = useLocalSearchParams<{ ref?: string }>();
  const { booking, setPackage, setAbandonedBookingId, setReferralCode } =
    useBooking();
  const { customer } = useCustomerAuth();

  // ─── Fetch active Price Book services ────────────────────────────────────
  const { data: priceBookServices, isLoading: pbLoading } =
    trpc.pricebook.list.useQuery(undefined, {
      staleTime: 5 * 60 * 1000,
    });

  // Capture referral code from URL param
  useEffect(() => {
    if (params.ref && !booking.referralCode) {
      setReferralCode(params.ref);
    }
  }, [params.ref]);

  const vehicleType = booking.vehicle?.vehicleType ?? "sedan";
  const isRV = vehicleType === "rv";
  const priceKey = toPriceKey(vehicleType);

  // ─── Build card lists from Price Book ────────────────────────────────────
  const { standardCards, rvCards } = useMemo(() => {
    if (!priceBookServices || priceBookServices.length === 0) {
      return { standardCards: [], rvCards: [] };
    }

    const standard: Array<{
      serviceId: string;
      name: string;
      description: string;
      features: string[];
      price: number;
      imageUrl: string | null;
    }> = [];

    const rv: Array<{
      serviceId: string;
      name: string;
      description: string;
      features: string[];
      imageUrl: string | null;
      tiers: Array<{ key: string; label: string; price: number }>;
    }> = [];

    for (const svc of priceBookServices) {
      // Skip subscription / VIP services
      if (SUBSCRIPTION_IDS.has(svc.serviceId)) continue;

      const vp = svc.vehiclePrices;

      if (isRvService(vp)) {
        const tiers = [
          { key: "rv_20_29", label: "20–29 ft", price: vp.rv_20_29 ?? 0 },
          { key: "rv_30_39", label: "30–39 ft", price: vp.rv_30_39 ?? 0 },
          { key: "rv_40_plus", label: "40 ft+", price: vp.rv_40_plus ?? 0 },
        ].filter((t) => t.price > 0);

        if (tiers.length > 0) {
          rv.push({
            serviceId: svc.serviceId,
            name: svc.name,
            description: svc.description,
            features: svc.features,
            imageUrl: svc.imageUrl,
            tiers,
          });
        }
      } else {
        // Standard vehicle service — show only if there's a price for this vehicle type
        const price = (vp as Record<string, number>)[priceKey] ?? 0;
        if (price > 0) {
          standard.push({
            serviceId: svc.serviceId,
            name: svc.name,
            description: svc.description,
            features: svc.features,
            price,
            imageUrl: svc.imageUrl,
          });
        }
      }
    }

    return { standardCards: standard, rvCards: rv };
  }, [priceBookServices, priceKey]);

  // ─── Abandon cart mutation ────────────────────────────────────────────────
  const abandonCartMutation = trpc.pipeline.abandonCart.useMutation({
    onSuccess: (data) => {
      if (data.bookingId) setAbandonedBookingId(data.bookingId);
    },
  });

  function triggerAbandonCart(name: string, price: number) {
    if (!booking.abandonedBookingId && customer) {
      abandonCartMutation.mutate({
        firstName: customer.firstName,
        lastName: customer.lastName ?? "",
        email: customer.email,
        phone: customer.phone ?? "",
        location: (booking.address?.city ?? "unknown").toLowerCase(),
        vehicleType: booking.vehicle
          ? `${booking.vehicle.year} ${booking.vehicle.make} ${booking.vehicle.model}`
          : vehicleType,
        packageName: name,
        source: "portal_app",
        customerId: customer.customerId,
        estimatedTotal: price,
      });
    }
  }

  function handleSelectStandard(
    serviceId: string,
    name: string,
    price: number
  ) {
    setPackage({ id: serviceId, name, price });
    triggerAbandonCart(name, price);
    router.push("/(customer)/book/addons" as any);
  }

  function handleSelectRV(serviceId: string, name: string, price: number) {
    setPackage({ id: serviceId, name, price });
    triggerAbandonCart(name, price);
    router.push("/(customer)/book/addons" as any);
  }

  // ─── Loading state ────────────────────────────────────────────────────────
  if (pbLoading) {
    return (
      <ScreenContainer
        edges={["top", "left", "right"]}
        containerClassName="bg-white"
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Select Package</Text>
          <View style={{ width: 24 }} />
        </View>
        <StepIndicator current={2} total={5} />
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <ActivityIndicator size="large" color="#1A1A1A" />
          <Text style={{ marginTop: 12, fontSize: 14, color: "#6B7280" }}>
            Loading packages…
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  // ─── Empty state ──────────────────────────────────────────────────────────
  const hasCards = isRV ? rvCards.length > 0 : standardCards.length > 0;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <ScreenContainer
      edges={["top", "left", "right"]}
      containerClassName="bg-white"
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Select Package</Text>
        <View style={{ width: 24 }} />
      </View>

      <StepIndicator current={2} total={5} />

      {/* Vehicle pill */}
      <View style={styles.vehiclePill}>
        <MaterialIcons name="directions-car" size={14} color="#6B7280" />
        <Text style={styles.vehiclePillText}>{booking.vehicle?.label}</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      >
        <Text style={styles.sectionTitle}>Choose your package</Text>
        <Text style={styles.sectionSub}>
          {isRV
            ? "Select your RV service"
            : `Prices shown for your ${vehicleType.replace(/_/g, " ")}`}
        </Text>

        {!hasCards ? (
          <View style={styles.emptyState}>
            <MaterialIcons name="inventory" size={48} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>No packages available</Text>
            <Text style={styles.emptyBody}>
              {isRV
                ? "No RV services are currently available. Please contact us directly."
                : "No services are currently available for your vehicle type. Please contact us."}
            </Text>
          </View>
        ) : isRV ? (
          // ─── RV cards ─────────────────────────────────────────────────
          rvCards.map((svc) =>
            svc.tiers.map((tier) => (
              <TouchableOpacity
                key={`${svc.serviceId}_${tier.key}`}
                style={styles.card}
                onPress={() =>
                  handleSelectRV(
                    svc.serviceId,
                    `${svc.name} · ${tier.label}`,
                    tier.price
                  )
                }
                activeOpacity={0.88}
              >
                <Image
                  source={{ uri: svc.imageUrl ?? PLACEHOLDER_IMAGE }}
                  style={styles.cardImage}
                  resizeMode="cover"
                />
                <View style={styles.cardBody}>
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pkgName}>{svc.name}</Text>
                      <Text style={styles.pkgTagline}>
                        {tier.label} motorhome or trailer
                      </Text>
                    </View>
                    <View style={styles.priceBox}>
                      <Text style={styles.price}>${tier.price}</Text>
                    </View>
                  </View>

                  {!!svc.description && (
                    <Text style={styles.pkgDesc}>{svc.description}</Text>
                  )}

                  {svc.features.length > 0 && (
                    <View style={styles.includesList}>
                      {svc.features.map((item) => (
                        <View key={item} style={styles.includeItem}>
                          <MaterialIcons
                            name="check"
                            size={13}
                            color="#059669"
                          />
                          <Text style={styles.includeText}>{item}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  <View style={styles.selectRow}>
                    <Text style={styles.selectText}>Select Package</Text>
                    <MaterialIcons
                      name="arrow-forward"
                      size={16}
                      color="#1A1A1A"
                    />
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )
        ) : (
          // ─── Standard vehicle cards ────────────────────────────────────
          standardCards.map((svc) => (
            <TouchableOpacity
              key={svc.serviceId}
              style={styles.card}
              onPress={() =>
                handleSelectStandard(svc.serviceId, svc.name, svc.price)
              }
              activeOpacity={0.88}
            >
              <Image
                source={{ uri: svc.imageUrl ?? PLACEHOLDER_IMAGE }}
                style={styles.cardImage}
                resizeMode="cover"
              />
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pkgName}>{svc.name}</Text>
                  </View>
                  <View style={styles.priceBox}>
                    <Text style={styles.price}>${svc.price}</Text>
                  </View>
                </View>

                {!!svc.description && (
                  <Text style={styles.pkgDesc}>{svc.description}</Text>
                )}

                {svc.features.length > 0 && (
                  <View style={styles.includesList}>
                    {svc.features.map((item) => (
                      <View key={item} style={styles.includeItem}>
                        <MaterialIcons
                          name="check"
                          size={13}
                          color="#059669"
                        />
                        <Text style={styles.includeText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.selectRow}>
                  <Text style={styles.selectText}>Select Package</Text>
                  <MaterialIcons
                    name="arrow-forward"
                    size={16}
                    color="#1A1A1A"
                  />
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#1A1A1A" },
  vehiclePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: "#F5F5F5",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 100,
    alignSelf: "flex-start",
  },
  vehiclePillText: { fontSize: 13, color: "#6B7280", fontWeight: "500" },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1A1A1A",
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 13,
    color: "#9CA3AF",
    marginBottom: 20,
    textTransform: "capitalize",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 60,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: "#374151" },
  emptyBody: {
    fontSize: 14,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 20,
  },
  card: {
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#F0F0F0",
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardImage: { width: "100%", height: 180 },
  cardBody: { padding: 16 },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  pkgName: { fontSize: 20, fontWeight: "800", color: "#1A1A1A" },
  pkgTagline: { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  priceBox: { alignItems: "flex-end" },
  price: { fontSize: 24, fontWeight: "900", color: "#1A1A1A" },
  pkgDesc: {
    fontSize: 13,
    color: "#6B7280",
    lineHeight: 19,
    marginBottom: 12,
  },
  includesList: { gap: 5, marginBottom: 14 },
  includeItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  includeText: { fontSize: 13, color: "#374151" },
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#F0F0F0",
  },
  selectText: { fontSize: 14, fontWeight: "700", color: "#1A1A1A" },
});
