import { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { useBooking, type BookingAddon } from "@/lib/booking-context";
import { MaterialIcons } from "@expo/vector-icons";
import { StepIndicator } from "./vehicle";

// ─── Standard add-ons (cars, SUVs, trucks, vans) ─────────────────────────────
const STANDARD_ADDONS = [
  { id: "rain_x",              name: "Rain-X Treatment",          price: 10,  description: "Repels rain on windshield for better visibility." },
  { id: "paint_sealant",       name: "Paint Sealant",             price: 50,  description: "Seals and protects your paint from UV and contaminants." },
  { id: "clay_bar",            name: "Clay Bar",                  price: 50,  description: "Removes bonded contaminants for a silky-smooth finish." },
  { id: "leather_conditioning",name: "Leather Conditioning",      price: 40,  description: "Conditions and protects leather seats from cracking." },
  { id: "leather_cleaning",    name: "Leather Cleaning",          price: 30,  description: "Deep cleans leather surfaces to remove grime and stains." },
  { id: "ozone",               name: "Ozone Treatment",           price: 100, description: "Eliminates odors, bacteria, and allergens from the cabin." },
  { id: "shampoo_seats_carpets",name: "Shampoo Seats & Carpets", price: 75,  description: "Deep shampoo for both seats and all carpet areas." },
  { id: "pet_hair_removal",    name: "Pet Hair Removal",          price: 40,  description: "Thorough removal of pet hair from all interior surfaces." },
  { id: "paint_enhancement",   name: "One Step Paint Enhancement",price: 250, description: "Machine polish to remove light scratches and swirl marks." },
  { id: "shampoo_seats_only",  name: "Shampoo Seats Only",        price: 50,  description: "Deep shampoo treatment for seats only." },
  { id: "engine_bay",          name: "Engine Bay Cleaning",       price: 30,  description: "Degreases and cleans the engine bay area." },
  { id: "deep_interior",       name: "Deep Interior Cleaning",    price: 75,  description: "Extra attention to all interior crevices and hard-to-reach areas." },
  { id: "shampoo_carpet_only", name: "Shampoo Carpet Only",       price: 50,  description: "Deep shampoo treatment for carpets only." },
];

// ─── RV-specific add-ons ──────────────────────────────────────────────────────
// rv_rain_x: $20 flat
// rv_paint_sealant: $15 per foot (requires rvLengthFt)
// wheel_polishing: $50 per wheel (user picks wheel count)

export default function BookAddonsStep() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { booking, setAddons } = useBooking();
  const isRV = booking.vehicle?.vehicleType === "rv";
  const rvLength = booking.vehicle?.rvLengthFt ?? 0;

  // Standard add-on selection state
  const [selected, setSelected] = useState<Set<string>>(new Set(booking.addons.map(a => a.id)));

  // RV add-on states
  const [rvRainXSelected, setRvRainXSelected] = useState(
    booking.addons.some(a => a.id === "rv_rain_x")
  );
  const [rvSealantSelected, setRvSealantSelected] = useState(
    booking.addons.some(a => a.id === "rv_paint_sealant")
  );
  const [rvWheelSelected, setRvWheelSelected] = useState(
    booking.addons.some(a => a.id === "rv_wheel_polishing")
  );
  const [wheelCount, setWheelCount] = useState<number>(() => {
    const existing = booking.addons.find(a => a.id === "rv_wheel_polishing");
    if (existing) return Math.round(existing.price / 50);
    return 4;
  });

  const rainXPrice = rvRainXSelected ? 20 : 0;
  const sealantPrice = rvSealantSelected ? rvLength * 15 : 0;
  const wheelPrice = rvWheelSelected ? wheelCount * 50 : 0;
  const rvAddonsTotal = rainXPrice + sealantPrice + wheelPrice;

  function toggleAddon(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleContinue() {
    let selectedAddons: BookingAddon[];
    if (isRV) {
      selectedAddons = [];
      if (rvRainXSelected) {
        selectedAddons.push({
          id: "rv_rain_x",
          name: "Rain-X Treatment",
          price: 20,
        });
      }
      if (rvSealantSelected) {
        selectedAddons.push({
          id: "rv_paint_sealant",
          name: `Paint Sealant (${rvLength} ft)`,
          price: rvLength * 15,
        });
      }
      if (rvWheelSelected) {
        selectedAddons.push({
          id: "rv_wheel_polishing",
          name: `Wheel Polishing (${wheelCount} wheels)`,
          price: wheelCount * 50,
        });
      }
    } else {
      selectedAddons = STANDARD_ADDONS
        .filter(a => selected.has(a.id))
        .map(a => ({ id: a.id, name: a.name, price: a.price }));
    }
    setAddons(selectedAddons);
    router.push("/(customer)/book/location" as any);
  }

  const standardTotal = STANDARD_ADDONS.filter(a => selected.has(a.id)).reduce((s, a) => s + a.price, 0);
  const pkgPrice = booking.pkg?.price ?? 0;
  const totalSoFar = pkgPrice + (isRV ? rvAddonsTotal : standardTotal);

  return (
    <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add-On Services</Text>
        <View style={{ width: 24 }} />
      </View>

      <StepIndicator current={3} total={5} />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 160 }}>
        <Text style={styles.sectionTitle}>Enhance your detail</Text>
        <Text style={styles.sectionSub}>
          Select any add-ons to include with your {booking.pkg?.name}.
        </Text>

        {isRV ? (
          // ── RV Add-Ons ──────────────────────────────────────────────────────
          <>
            {/* Rain-X Treatment */}
            <TouchableOpacity
              style={[styles.addonCard, rvRainXSelected && styles.addonCardSelected]}
              onPress={() => setRvRainXSelected(v => !v)}
              activeOpacity={0.85}
            >
              <View style={[styles.checkbox, rvRainXSelected && styles.checkboxSelected]}>
                {rvRainXSelected && <MaterialIcons name="check" size={14} color="#FFFFFF" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.addonName, rvRainXSelected && styles.addonNameSelected]}>
                  Rain-X Treatment
                </Text>
                <Text style={styles.addonDesc}>
                  Repels rain on windshield and glass for better visibility.
                </Text>
              </View>
              <Text style={[styles.addonPrice, rvRainXSelected && styles.addonPriceSelected]}>
                +$20
              </Text>
            </TouchableOpacity>

            {/* Paint Sealant */}
            <TouchableOpacity
              style={[styles.addonCard, rvSealantSelected && styles.addonCardSelected]}
              onPress={() => setRvSealantSelected(v => !v)}
              activeOpacity={0.85}
            >
              <View style={[styles.checkbox, rvSealantSelected && styles.checkboxSelected]}>
                {rvSealantSelected && <MaterialIcons name="check" size={14} color="#FFFFFF" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.addonName, rvSealantSelected && styles.addonNameSelected]}>
                  Paint Sealant
                </Text>
                <Text style={styles.addonDesc}>
                  Hydrophobic sealant applied to the full exterior. Priced at $15 per foot.
                </Text>
                {rvSealantSelected && rvLength > 0 && (
                  <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>
                    {rvLength} ft × $15 = ${rvLength * 15}
                  </Text>
                )}
              </View>
              <Text style={[styles.addonPrice, rvSealantSelected && styles.addonPriceSelected]}>
                {rvLength > 0 ? `+$${rvLength * 15}` : "+$15/ft"}
              </Text>
            </TouchableOpacity>

            {/* Wheel Polishing */}
            <TouchableOpacity
              style={[styles.addonCard, rvWheelSelected && styles.addonCardSelected]}
              onPress={() => setRvWheelSelected(v => !v)}
              activeOpacity={0.85}
            >
              <View style={[styles.checkbox, rvWheelSelected && styles.checkboxSelected]}>
                {rvWheelSelected && <MaterialIcons name="check" size={14} color="#FFFFFF" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.addonName, rvWheelSelected && styles.addonNameSelected]}>
                  Wheel Polishing
                </Text>
                <Text style={styles.addonDesc}>
                  Deep polish and shine for each wheel. $50 per wheel.
                </Text>
                {rvWheelSelected && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 }}>
                    <Text style={{ fontSize: 13, color: "#374151", fontWeight: "600" }}>Wheels:</Text>
                    <TouchableOpacity
                      onPress={() => setWheelCount(c => Math.max(1, c - 1))}
                      style={styles.counterBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons name="remove" size={16} color="#1A1A1A" />
                    </TouchableOpacity>
                    <Text style={{ fontSize: 16, fontWeight: "800", color: "#1A1A1A", minWidth: 24, textAlign: "center" }}>
                      {wheelCount}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setWheelCount(c => Math.min(20, c + 1))}
                      style={styles.counterBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons name="add" size={16} color="#1A1A1A" />
                    </TouchableOpacity>
                    <Text style={{ fontSize: 12, color: "#6B7280", marginLeft: 4 }}>
                      = ${wheelCount * 50}
                    </Text>
                  </View>
                )}
              </View>
              {!rvWheelSelected && (
                <Text style={styles.addonPrice}>+$50/wheel</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          // ── Standard Add-Ons ────────────────────────────────────────────────
          STANDARD_ADDONS.map((addon) => {
            const isSelected = selected.has(addon.id);
            return (
              <TouchableOpacity
                key={addon.id}
                style={[styles.addonCard, isSelected && styles.addonCardSelected]}
                onPress={() => toggleAddon(addon.id)}
                activeOpacity={0.85}
              >
                <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                  {isSelected && <MaterialIcons name="check" size={14} color="#FFFFFF" />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.addonName, isSelected && styles.addonNameSelected]}>{addon.name}</Text>
                  <Text style={styles.addonDesc}>{addon.description}</Text>
                </View>
                <Text style={[styles.addonPrice, isSelected && styles.addonPriceSelected]}>+${addon.price}</Text>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Sticky bottom bar */}
      <View style={[styles.bottomBar, { paddingBottom: Platform.OS === "android" ? Math.max(insets.bottom + 16, 36) : 36 }]}>
        <View>
          <Text style={styles.totalLabel}>Total so far</Text>
          <Text style={styles.totalAmount}>${totalSoFar}</Text>
        </View>
        <TouchableOpacity style={styles.continueBtn} onPress={handleContinue} activeOpacity={0.85}>
          <Text style={styles.continueBtnText}>Continue</Text>
          <MaterialIcons name="arrow-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#1A1A1A" },
  sectionTitle: { fontSize: 22, fontWeight: "800", color: "#1A1A1A", marginBottom: 4 },
  sectionSub: { fontSize: 13, color: "#9CA3AF", marginBottom: 20 },
  addonCard: { flexDirection: "row", alignItems: "flex-start", padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#F0F0F0", marginBottom: 10, backgroundColor: "#FFFFFF", gap: 12 },
  addonCardSelected: { borderColor: "#1A1A1A", backgroundColor: "#FAFAFA" },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: "#D1D5DB", justifyContent: "center", alignItems: "center", marginTop: 1 },
  checkboxSelected: { backgroundColor: "#1A1A1A", borderColor: "#1A1A1A" },
  addonName: { fontSize: 15, fontWeight: "700", color: "#374151", marginBottom: 3 },
  addonNameSelected: { color: "#1A1A1A" },
  addonDesc: { fontSize: 12, color: "#9CA3AF", lineHeight: 17 },
  addonPrice: { fontSize: 15, fontWeight: "700", color: "#6B7280", marginTop: 1 },
  addonPriceSelected: { color: "#1A1A1A" },
  counterBtn: { width: 28, height: 28, borderRadius: 8, borderWidth: 1.5, borderColor: "#D1D5DB", justifyContent: "center", alignItems: "center", backgroundColor: "#F9FAFB" },
  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: "#F0F0F0" },
  totalLabel: { fontSize: 12, color: "#9CA3AF" },
  totalAmount: { fontSize: 22, fontWeight: "900", color: "#1A1A1A" },
  continueBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#1A1A1A", paddingHorizontal: 24, paddingVertical: 14, borderRadius: 100 },
  continueBtnText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
});
