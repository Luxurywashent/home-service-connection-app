import React, { useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import type { HomeServiceConnectedPriceBookService } from "@/lib/jobsync-mobile-api";

export function companyBookingPrice(service: HomeServiceConnectedPriceBookService, rateKey = ""): number | undefined {
  if (rateKey && Number.isFinite(service.vehiclePrices[rateKey])) return service.vehiclePrices[rateKey];
  if (service.basePrice === 0 && Object.values(service.vehiclePrices).some((price) => Number.isFinite(price) && price > 0)) return undefined;
  return Number.isFinite(service.basePrice) && service.basePrice! >= 0 ? service.basePrice : undefined;
}
export function companyBookingDuration(service: HomeServiceConnectedPriceBookService): string {
  const minutes = service.defaultDurationMinutes;
  return typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0 ? `${minutes} min` : "Duration confirmed on save";
}
export function CompanyBookingServiceCard({ service, selected, rateKey, onPress, disabled = false, showDescription = false }: {
  service: HomeServiceConnectedPriceBookService; selected: boolean; rateKey?: string; onPress: () => void; disabled?: boolean; showDescription?: boolean;
}) {
  const colors = useJobSheetColors();
  const amount = companyBookingPrice(service, rateKey);
  const hasRates = Object.values(service.vehiclePrices).some((price) => Number.isFinite(price) && price > 0);
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={service.name} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    style={[styles.serviceCard, { backgroundColor: colors.background, borderColor: selected ? colors.primary : colors.border }]}>
    <View style={styles.serviceCopy}>
      <Text style={[styles.serviceName, { color: colors.foreground }]}>{service.name}</Text>
      {showDescription && Boolean(service.description) && <Text style={[styles.detail, { color: colors.muted }]}>{service.description}</Text>}
      <Text style={[styles.detail, { color: colors.muted }]}>{companyBookingDuration(service)}</Text>
    </View>
    <Text style={[styles.price, { color: colors.primary }]}>{amount === undefined ? hasRates ? "Select rate" : "Price on save" : `$${amount.toFixed(2)}`}</Text>
  </TouchableOpacity>;
}

/** Presentation-only selection. A cancelled search cannot change the booking draft. */
export function CompanyBookingServicePicker({ services, selectedId, loading, hasLoaded, error, disabled, isCurrent, onClose, onConfirm, onRefresh }: {
  services: HomeServiceConnectedPriceBookService[]; selectedId: string; loading: boolean; hasLoaded: boolean; error: string | null;
  disabled: boolean; isCurrent: () => boolean; onClose: () => void; onConfirm: (serviceId: string) => void; onRefresh: () => void;
}) {
  const colors = useJobSheetColors();
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState(selectedId);
  const normalized = query.trim().toLowerCase();
  const matches = services.filter((service) => !normalized || [service.name, service.description, ...service.features].some((value) => value.toLowerCase().includes(normalized)));
  const ready = !disabled && !loading && hasLoaded && !error && services.some((service) => service.serviceId === choice);
  const close = () => { if (isCurrent()) onClose(); };
  return <View accessibilityViewIsModal testID="company-booking-pricebook-overlay" style={[styles.overlay, { backgroundColor: colors.surface }]}>
    <View style={styles.header}>
      <View style={styles.serviceCopy}><Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Choose Service</Text><Text style={[styles.detail, { color: colors.primary }]}>Company Price Book</Text></View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close service picker" onPress={close} style={styles.close}><Text style={[styles.closeText, { color: colors.muted }]}>×</Text></TouchableOpacity>
    </View>
    <TextInput accessibilityLabel="Search Price Book services" placeholder="Search Price Book services…" placeholderTextColor={colors.muted} value={query}
      onChangeText={(next) => { if (isCurrent() && !disabled) setQuery(next); }} editable={!disabled} autoCapitalize="none" returnKeyType="search"
      style={[styles.search, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} />
    {loading && <ActivityIndicator accessibilityLabel="Loading Company Price Book" color={colors.primary} />}
    {error && <Text accessibilityRole="alert" style={[styles.detail, { color: colors.error }]}>{error}</Text>}
    <FlatList testID="company-booking-pricebook-list" style={styles.list} contentContainerStyle={styles.listContent} data={matches} keyExtractor={(service) => service.serviceId}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" renderItem={({ item }) => <CompanyBookingServiceCard service={item} selected={choice === item.serviceId} disabled={disabled || loading || !hasLoaded || Boolean(error)} showDescription
        onPress={() => { if (isCurrent() && !disabled && !loading && hasLoaded && !error) setChoice(item.serviceId); }} />}
      ListEmptyComponent={hasLoaded && !loading && !error ? <Text style={[styles.detail, { color: colors.muted }]}>{services.length ? "No matching services. Try another search." : "No active services in this Company Price Book."}</Text> : null} />
    {error && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Reload Services" disabled={disabled || loading} onPress={() => { if (isCurrent() && !disabled && !loading) onRefresh(); }} style={[styles.button, { borderColor: colors.border }]}><Text style={[styles.buttonText, { color: colors.foreground }]}>Reload Services</Text></TouchableOpacity>}
    <View style={styles.footer}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel service selection" onPress={close} style={[styles.button, styles.flex, { borderColor: colors.border }]}><Text style={[styles.buttonText, { color: colors.foreground }]}>Cancel</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add selected service" accessibilityState={{ disabled: !ready }} disabled={!ready} onPress={() => { if (isCurrent() && ready) onConfirm(choice); }} style={[styles.button, styles.flex, { borderColor: colors.primary, backgroundColor: colors.primary, opacity: ready ? 1 : 0.45 }]}><Text style={[styles.buttonText, styles.white]}>Add Service</Text></TouchableOpacity>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12, zIndex: 2 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 }, title: { fontSize: 22, lineHeight: 29, fontWeight: "800" },
  close: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }, closeText: { fontSize: 30, lineHeight: 36 },
  search: { minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, lineHeight: 21 },
  list: { flex: 1, minHeight: 0 }, listContent: { gap: 10, paddingBottom: 8 },
  serviceCard: { minHeight: 64, borderRadius: 12, borderWidth: 1, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  serviceCopy: { flex: 1, minWidth: 0, gap: 3 }, serviceName: { fontSize: 16, lineHeight: 22, fontWeight: "700" }, detail: { fontSize: 13, lineHeight: 19 },
  price: { fontSize: 15, lineHeight: 21, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  footer: { flexDirection: "row", gap: 10 }, button: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 16, lineHeight: 22, fontWeight: "600" }, flex: { flex: 1 }, white: { color: "#fff" },
});
