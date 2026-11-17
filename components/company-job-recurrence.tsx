import React, { useLayoutEffect, useRef } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import { companyJobRecurrenceUnavailableMessage, type CompanyJobRecurrenceInput } from "@/lib/company-job-recurrence";

export type CompanyJobRecurrenceSelection = Omit<CompanyJobRecurrenceInput, "startDate">;
export type CompanyJobRecurrenceProps = {
  value: CompanyJobRecurrenceSelection | null;
  weekday: number;
  disabled: boolean;
  isCurrent: () => boolean;
  onChange: (value: CompanyJobRecurrenceSelection | null) => void;
};
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const frequencies: { label: string; type: CompanyJobRecurrenceInput["type"] | null }[] = [
  { label: "One appointment", type: null }, { label: "Weekly", type: "weekly" },
  { label: "Biweekly", type: "biweekly" }, { label: "Monthly by date", type: "monthly_date" },
  { label: "Monthly by ordinal weekday", type: "monthly_ordinal" },
];
const terms: { label: string; term: CompanyJobRecurrenceInput["term"] }[] = [
  { label: "1 month", term: "1_month" }, { label: "3 months", term: "3_months" },
  { label: "6 months", term: "6_months" }, { label: "1 year", term: "1_year" }, { label: "Ongoing", term: "never_ends" },
];
const ordinals: { label: string; ordinal: NonNullable<CompanyJobRecurrenceInput["ordinal"]> }[] = [
  { label: "First", ordinal: 1 }, { label: "Second", ordinal: 2 }, { label: "Third", ordinal: 3 },
  { label: "Fourth", ordinal: 4 }, { label: "Last", ordinal: -1 },
];
/** Controlled addition to the shared form, not a separate booking screen. */
export function CompanyJobRecurrence(props: CompanyJobRecurrenceProps) {
  const colors = useJobSheetColors();
  const committed = useRef<CompanyJobRecurrenceProps | null>(null);
  useLayoutEffect(() => { committed.current = props; return () => { committed.current = null; }; }, [props]);
  const change = (value: CompanyJobRecurrenceSelection | null) => {
    if (committed.current === props && !props.disabled && props.isCurrent()) props.onChange(value);
  };
  const option = (label: string, selected: boolean, action: () => void) => <TouchableOpacity
    accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled: props.disabled }}
    disabled={props.disabled} onPress={() => { if (committed.current === props && !props.disabled && props.isCurrent()) action(); }}
    style={[styles.option, { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border }]}>
    <Text style={[styles.optionText, { color: selected ? colors.primary : colors.foreground }]}>{label}</Text>
  </TouchableOpacity>;
  return <View testID="company-job-recurrence" style={styles.section}>
    <Text style={[styles.label, { color: colors.muted }]}>REPEAT</Text>
    <FlatList horizontal data={frequencies} keyExtractor={row => row.type ?? "once"} keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag" contentContainerStyle={styles.choices} renderItem={({ item }) => option(item.label,
        props.value?.type === item.type || (!props.value && item.type === null), () => {
          if (props.value?.type === item.type || (!props.value && item.type === null)) return;
          change(item.type ? { type: item.type, term: props.value?.term ?? "3_months",
            ...(item.type !== "monthly_date" ? { dayOfWeek: props.value?.dayOfWeek ?? props.weekday } : {}),
            ...(item.type === "monthly_ordinal" ? { ordinal: props.value?.ordinal ?? 1 } : {}) } : null);
        })} />
    {props.value && <>
      {props.value.type === "monthly_date" ? <Text style={[styles.note, { color: colors.muted }]}>Repeats on the selected Company date each month; short months use their last date.</Text> : <>
        <Text style={[styles.label, { color: colors.muted }]}>WEEKDAY</Text>
        <FlatList horizontal data={weekdays} keyExtractor={row => row} keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag" contentContainerStyle={styles.choices} renderItem={({ item, index }) => option(item,
            props.value?.dayOfWeek === index, () => change({ ...props.value!, dayOfWeek: index }))} />
      </>}
      {props.value.type === "monthly_ordinal" && <>
        <Text style={[styles.label, { color: colors.muted }]}>MONTHLY OCCURRENCE</Text>
        <FlatList horizontal data={ordinals} keyExtractor={row => String(row.ordinal)} keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag" contentContainerStyle={styles.choices} renderItem={({ item }) => option(item.label,
            props.value?.ordinal === item.ordinal, () => change({ ...props.value!, ordinal: item.ordinal }))} />
      </>}
      <Text style={[styles.label, { color: colors.muted }]}>TERM</Text>
      <FlatList horizontal data={terms} keyExtractor={row => row.term} keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag" contentContainerStyle={styles.choices} renderItem={({ item }) => option(item.label,
          props.value?.term === item.term, () => change({ ...props.value!, term: item.term }))} />
      <Text accessibilityRole="alert" testID="company-job-recurrence-unavailable" style={[styles.note, { color: colors.error }]}>{companyJobRecurrenceUnavailableMessage}</Text>
      <Text style={[styles.note, { color: colors.muted }]}>{props.disabled ? "The original submitted recurrence is locked. Draft controls do not describe a recovered series." : "Recurrence starts on the first matching date on or after the selected Company date. Ongoing does not mean an unlimited number of appointments is already saved."}</Text>
    </>}
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: 6 }, label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7 },
  choices: { gap: 8 }, option: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 },
  optionText: { fontSize: 12, fontWeight: "600" }, note: { fontSize: 12, lineHeight: 17 },
});
