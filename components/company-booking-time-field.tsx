import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";

/** Values stay in Company wall time; native pickers are owned by the booking form. */
export function CompanyBookingTimeField({ label, accessibilityLabel, value, type, placeholder, disabled, isCurrent, onChange, onPick }: {
  label: string; accessibilityLabel: string; value: string; type: "date" | "time"; placeholder?: string;
  disabled: boolean; isCurrent: () => boolean; onChange: (value: string) => void; onPick: () => void;
}) {
  const colors = useJobSheetColors();
  return <View style={[styles.field, type === "date" && styles.dateField]}>
    <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
    {Platform.OS === "web" ? React.createElement("input", {
      type, value, disabled, "aria-label": accessibilityLabel, step: type === "time" ? 60 : undefined,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => { if (isCurrent() && !disabled) onChange(event.target.value); },
      style: { width: "100%", minWidth: 0, minHeight: 44, boxSizing: "border-box", padding: "8px", borderRadius: 10, border: `1px solid ${colors.border}`, backgroundColor: colors.background, color: colors.foreground, fontSize: 14, fontFamily: "inherit", colorScheme: colors.background === "#101319" ? "dark" : "light" },
    }) : <TouchableOpacity accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }} disabled={disabled}
      onPress={() => { if (isCurrent() && !disabled) onPick(); }} style={[styles.button, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <Text style={[styles.value, { color: colors.primary }]}>{value || placeholder || "Choose"}</Text>
    </TouchableOpacity>}
  </View>;
}
const styles = StyleSheet.create({
  field: { flex: 1, minWidth: 100, maxWidth: "100%", gap: 4 }, dateField: { flex: 1.4, minWidth: 136 }, label: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  button: { minHeight: 44, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 10, borderWidth: 1, justifyContent: "center" },
  value: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
});
