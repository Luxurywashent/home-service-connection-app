import { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { useCustomerAuth } from "@/lib/customer-context";
import { useBooking } from "@/lib/booking-context";
import { trpc } from "@/lib/trpc";
import { MaterialIcons } from "@expo/vector-icons";
import { StepIndicator } from "./vehicle";

// Parse "123 Main St, City, ST 12345" or "123 Main St, Unit 4B, City, ST 12345" into parts
function parseAddressString(addr: string): { street: string; unit?: string; city: string; state: string; zip: string } | null {
  const parts = addr.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  // Last part: "FL 32578" or "FL"
  const lastPart = parts[parts.length - 1];
  const stateZipMatch = lastPart.match(/^([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?$/);
  if (!stateZipMatch) return null;
  const state = stateZipMatch[1].toUpperCase();
  const zip = stateZipMatch[2] ?? '';
  // Second-to-last: city
  const city = parts[parts.length - 2];
  if (!city) return null;
  // Everything before city is street (and possibly unit)
  const streetParts = parts.slice(0, parts.length - 2);
  if (streetParts.length === 0) return null;
  const street = streetParts[0];
  const unit = streetParts.length > 1 ? streetParts.slice(1).join(', ') : undefined;
  return { street, unit, city, state, zip };
}

// ─── Service city detection ───────────────────────────────────────────────────
// Static fallback keywords used before the DB data loads.
// IMPORTANT: city values must match the admin schedule slugs exactly.
const STATIC_CITY_KEYWORDS: { keywords: string[]; city: string }[] = [
  { keywords: ["pensacola", "gulf breeze", "pace", "milton", "navarre", "cantonment", "ferry pass", "ensley", "brent", "warrington", "brownsville"], city: "pensacola" },
  { keywords: ["destin", "miramar beach", "sandestin", "santa rosa beach", "inlet beach", "seacrest", "rosemary beach", "watersound", "30a", "freeport", "shalimar"], city: "destin" },
  { keywords: ["fort walton beach", "fort walton", "ftw", "ft walton", "wright", "mary esther", "hurlburt", "eglin"], city: "fwb" },
  { keywords: ["niceville", "bluewater bay", "valparaiso", "john sims", "racetrack"], city: "niceville" },
  { keywords: ["crestview", "baker", "laurel hill", "holt", "milligan", "mossy head"], city: "crestview" },
];

/** Normalise any city string to the admin schedule slug.
 *  Handles both display names ("Fort Walton Beach") and already-slugged values ("fwb"). */
export function normalizeCityToSlug(city: string): string {
  const lower = city.toLowerCase().trim();
  if (lower === "fort walton beach" || lower === "fort walton" || lower === "ftw" || lower === "ft walton") return "fwb";
  if (lower === "pensacola") return "pensacola";
  if (lower === "destin") return "destin";
  if (lower === "niceville") return "niceville";
  if (lower === "crestview") return "crestview";
  // Already a slug or unknown — return as-is lowercased
  return lower;
}

function buildDetector(grouped: Record<string, string[]> | null) {
  return function detectCity(address: string): string {
    const lower = address.toLowerCase();
    // 1. Check DB subsidiary cities first (admin-managed)
    if (grouped) {
      for (const [parentCity, subs] of Object.entries(grouped)) {
        for (const sub of subs) {
          if (lower.includes(sub.toLowerCase())) return normalizeCityToSlug(parentCity);
        }
        // Also check if the address directly contains the parent city name
        if (lower.includes(parentCity.toLowerCase())) return normalizeCityToSlug(parentCity);
      }
    }
    // 2. Fall back to static keywords (already returns slugs)
    for (const { keywords, city } of STATIC_CITY_KEYWORDS) {
      if (keywords.some((kw) => lower.includes(kw))) return city;
    }
    // 3. Try to extract city from address string (e.g. "123 Main St, Niceville, FL 32578")
    const parts = address.split(",").map((p) => p.trim());
    if (parts.length >= 2) {
      const candidate = parts[1].replace(/\s+\d{5}.*$/, "").trim();
      if (candidate) return normalizeCityToSlug(candidate);
    }
    return "";
  };
}

export default function BookLocationStep() {
  const router = useRouter();
  const { token } = useCustomerAuth();
  const { booking, setAddress } = useBooking();
  const [mode, setMode] = useState<"saved" | "new">("saved");
  const [fullAddress, setFullAddress] = useState("");
  const [unit, setUnit] = useState("");
  const [detectedCity, setDetectedCity] = useState("");
  const [saving, setSaving] = useState(false);

  const addAddressMutation = trpc.customer.addAddress.useMutation();

  // Fetch live subsidiary cities from DB for dynamic city detection
  const subsGroupedQuery = trpc.subsidiaryCities.listGrouped.useQuery();
  const detectCity = buildDetector(subsGroupedQuery.data ?? null);

  const addressesQuery = trpc.customer.listAddresses.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  function handleSelectSaved(a: any) {
    setAddress({
      addressId: a.addressId,
      label: a.label,
      fullAddress: `${a.street}${a.unit ? ` ${a.unit}` : ""}, ${a.city}, ${a.state} ${a.zip}`,
      city: a.city,
    });
    router.push("/(customer)/book/datetime" as any);
  }

  function handleSelectAutocomplete(addr: string) {
    setFullAddress(addr);
    const city = detectCity(addr);
    setDetectedCity(city);
  }

  function handleAddressChange(text: string) {
    setFullAddress(text);
    if (text.length > 8) {
      const city = detectCity(text);
      setDetectedCity(city);
    } else {
      setDetectedCity("");
    }
  }

  async function handleNewAddress() {
    if (!fullAddress.trim()) return;
    const resolvedCity = detectedCity || detectCity(fullAddress);
    const addressWithUnit = unit.trim()
      ? `${fullAddress.trim()}, ${unit.trim()}`
      : fullAddress.trim();

    // Try to save address to profile immediately
    if (token) {
      try {
        setSaving(true);
        // Build the full string for parsing: "street, [unit,] city, STATE zip"
        let parsed = parseAddressString(addressWithUnit);
        // Resilient fallback: if strict parse fails, extract what we can from the address
        if (!parsed || !parsed.state || !parsed.city) {
          const parts = addressWithUnit.split(',').map((p: string) => p.trim()).filter(Boolean);
          const street = parts[0] ?? addressWithUnit.trim();
          const fallbackCity = resolvedCity || detectCity(addressWithUnit) || '';
          if (street && fallbackCity) {
            parsed = { street, city: fallbackCity, state: 'FL', zip: '00000', unit: unit.trim() || undefined };
          }
        }
        if (parsed && parsed.city) {
          // Check if already saved by fetching current addresses
          const existing = await addressesQuery.refetch();
          const alreadySaved = existing.data?.some(
            (a: any) => a.street.toLowerCase().trim() === parsed!.street.toLowerCase().trim() &&
                 a.city.toLowerCase().trim() === parsed!.city.toLowerCase().trim()
          );
          if (!alreadySaved) {
            const savedAddr = await addAddressMutation.mutateAsync({
              token,
              label: 'Service Location',
              street: parsed.street,
              unit: parsed.unit || unit.trim() || undefined,
              city: parsed.city,
              state: parsed.state || 'FL',
              zip: parsed.zip || '00000',
              isDefault: (existing.data?.length ?? 0) === 0,
            });
            // Use the saved address ID so future bookings link to it
            setAddress({
              addressId: savedAddr.addressId,
              label: 'Service Location',
              fullAddress: addressWithUnit,
              city: resolvedCity || parsed.city,
            });
            router.push('/(customer)/book/datetime' as any);
            return;
          }
        }
      } catch (e) {
        // Save failed silently — still continue with booking
        console.warn('[Location] Failed to save address to profile:', e);
      } finally {
        setSaving(false);
      }
    }

    setAddress({
      label: 'Service Location',
      fullAddress: addressWithUnit,
      city: resolvedCity,
    });
    router.push('/(customer)/book/datetime' as any);
  }

  const canContinue = fullAddress.trim().length > 5;

  return (
    <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Service Location</Text>
        <View style={{ width: 24 }} />
      </View>

      <StepIndicator current={4} total={5} />

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>Where should we come?</Text>
        <Text style={styles.sectionSub}>We come to you — home, work, or anywhere in our service area.</Text>

        {/* Toggle - show only for authenticated users */}
        {token && (
        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === "saved" && styles.modeBtnActive]}
            onPress={() => setMode("saved")}
            activeOpacity={0.8}
          >
            <Text style={[styles.modeBtnText, mode === "saved" && styles.modeBtnTextActive]}>Saved Addresses</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === "new" && styles.modeBtnActive]}
            onPress={() => setMode("new")}
            activeOpacity={0.8}
          >
            <Text style={[styles.modeBtnText, mode === "new" && styles.modeBtnTextActive]}>Enter New</Text>
          </TouchableOpacity>
        </View>
        )}

        {token && mode === "saved" ? (
          <>
            {addressesQuery.isLoading ? (
              <ActivityIndicator size="small" color="#1A1A1A" style={{ marginTop: 24 }} />
            ) : addressesQuery.data?.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialIcons name="location-on" size={40} color="#E5E7EB" />
                <Text style={styles.emptyText}>No saved addresses.</Text>
                <TouchableOpacity onPress={() => setMode("new")}>
                  <Text style={styles.emptyLink}>Enter a new address →</Text>
                </TouchableOpacity>
              </View>
            ) : (
              addressesQuery.data?.map((a) => (
                <TouchableOpacity
                  key={a.addressId}
                  style={styles.addressCard}
                  onPress={() => handleSelectSaved(a)}
                  activeOpacity={0.85}
                >
                  <View style={styles.addressIcon}>
                    <MaterialIcons name="place" size={20} color="#1A1A1A" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.addressLabel}>{a.label}</Text>
                    <Text style={styles.addressFull}>
                      {a.street}{a.unit ? ` ${a.unit}` : ""}, {a.city}, {a.state} {a.zip}
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color="#9CA3AF" />
                </TouchableOpacity>
              ))
            )}
          </>
        ) : (
          <>
            <Text style={styles.fieldLabel}>Street Address</Text>
            <AddressAutocomplete
              value={fullAddress}
              onChangeText={handleAddressChange}
              onSelectAddress={handleSelectAutocomplete}
              placeholder="Start typing your address..."
              style={{ marginBottom: 16, zIndex: 999 }}
            />

            <View style={{ marginBottom: 16 }}>
              <Text style={styles.fieldLabel}>Unit / Apt (optional)</Text>
              <TextInput
                value={unit}
                onChangeText={setUnit}
                placeholder="Apt 4B"
                placeholderTextColor="#9CA3AF"
                style={styles.input}
                returnKeyType="done"
              />
            </View>

            {/* Auto-detected city indicator */}
            {detectedCity ? (
              <View style={styles.cityDetectedRow}>
                <MaterialIcons name="location-on" size={16} color="#059669" />
                <Text style={styles.cityDetectedText}>
                  Service city: <Text style={{ fontWeight: "700" }}>{detectedCity}</Text>
                </Text>
              </View>
            ) : fullAddress.length > 8 ? (
              <View style={styles.cityDetectedRow}>
                <MaterialIcons name="info-outline" size={16} color="#F59E0B" />
                <Text style={[styles.cityDetectedText, { color: "#92400E" }]}>
                  Please include your city in the address (e.g. Niceville, FL)
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.continueBtn, (!canContinue || saving) && { opacity: 0.5 }]}
              onPress={handleNewAddress}
              disabled={!canContinue || saving}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.continueBtnText}>Continue</Text>
                  <MaterialIcons name="arrow-forward" size={18} color="#FFFFFF" />
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#1A1A1A" },
  sectionTitle: { fontSize: 22, fontWeight: "800", color: "#1A1A1A", marginBottom: 4 },
  sectionSub: { fontSize: 13, color: "#9CA3AF", marginBottom: 20 },
  modeToggle: { flexDirection: "row", backgroundColor: "#F5F5F5", borderRadius: 12, padding: 4, marginBottom: 20 },
  modeBtn: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 10 },
  modeBtnActive: { backgroundColor: "#FFFFFF", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  modeBtnText: { fontSize: 14, fontWeight: "600", color: "#9CA3AF" },
  modeBtnTextActive: { color: "#1A1A1A" },
  emptyState: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 15, color: "#9CA3AF" },
  emptyLink: { fontSize: 14, fontWeight: "600", color: "#1A1A1A" },
  addressCard: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 14, borderWidth: 1, borderColor: "#F0F0F0", marginBottom: 10, backgroundColor: "#FFFFFF", gap: 12 },
  addressIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#F5F5F5", justifyContent: "center", alignItems: "center" },
  addressLabel: { fontSize: 15, fontWeight: "700", color: "#1A1A1A" },
  addressFull: { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  input: { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: "#1A1A1A" },
  cityDetectedRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#ECFDF5", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16, borderWidth: 1, borderColor: "#A7F3D0" },
  cityDetectedText: { fontSize: 13, color: "#065F46", flex: 1 },
  continueBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#1A1A1A", borderRadius: 100, paddingVertical: 16, marginTop: 8 },
  continueBtnText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
});
