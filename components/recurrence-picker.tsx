import { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import { useColors } from "@/hooks/use-colors";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RecurrenceType = "none" | "weekly" | "biweekly" | "monthly_date" | "monthly_ordinal";

export interface RecurrenceRule {
  type: RecurrenceType;
  /** 0=Sun, 1=Mon, … 6=Sat — used for weekly, biweekly, monthly_ordinal */
  dayOfWeek?: number;
  /** 1=first, 2=second, 3=third, 4=fourth, -1=last — used for monthly_ordinal */
  ordinal?: number;
  /** YYYY-MM-DD end date (inclusive) — omitted when neverEnds is true */
  endDate?: string;
  /** When true: creates 13 jobs at a time, auto-spawns next when each completes */
  neverEnds?: boolean;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDINAL_LABELS: Record<number, string> = {
  1: "1st",
  2: "2nd",
  3: "3rd",
  4: "4th",
  [-1]: "Last",
};

export function recurrenceLabel(rule: RecurrenceRule | null): string {
  if (!rule || rule.type === "none") return "Does not repeat";
  if (rule.neverEnds) {
    const day = rule.dayOfWeek !== undefined ? DAY_FULL[rule.dayOfWeek] : "";
    if (rule.type === "weekly") return `Weekly on ${day} · Never ends`;
    if (rule.type === "biweekly") return `Every 2 weeks on ${day} · Never ends`;
    if (rule.type === "monthly_date") return `Monthly (same date) · Never ends`;
    if (rule.type === "monthly_ordinal") {
      const ord = rule.ordinal !== undefined ? ORDINAL_LABELS[rule.ordinal] ?? "" : "";
      return `Monthly on the ${ord} ${day} · Never ends`;
    }
  }
  const day = rule.dayOfWeek !== undefined ? DAY_FULL[rule.dayOfWeek] : "";
  if (rule.type === "weekly") return `Weekly on ${day}`;
  if (rule.type === "biweekly") return `Every 2 weeks on ${day}`;
  if (rule.type === "monthly_date") return `Monthly (same date)`;
  if (rule.type === "monthly_ordinal") {
    const ord = rule.ordinal !== undefined ? ORDINAL_LABELS[rule.ordinal] ?? "" : "";
    return `Monthly on the ${ord} ${day}`;
  }
  return "Does not repeat";
}

// ─── Generate dates from a recurrence rule ────────────────────────────────────

export function generateRecurringDates(
  startDateStr: string,
  rule: RecurrenceRule,
  maxInstances = 52
): string[] {
  if (rule.type === "none") return [];
  const dates: string[] = [];
  const start = new Date(startDateStr + "T12:00:00");
  const end = rule.endDate ? new Date(rule.endDate + "T23:59:59") : null;

  let current = new Date(start);
  // Advance to first occurrence AFTER start
  if (rule.type === "weekly" || rule.type === "biweekly") {
    const targetDow = rule.dayOfWeek ?? start.getDay();
    const diff = (targetDow - current.getDay() + 7) % 7;
    current.setDate(current.getDate() + (diff === 0 ? (rule.type === "biweekly" ? 14 : 7) : diff));
  } else if (rule.type === "monthly_date") {
    current.setMonth(current.getMonth() + 1);
  } else if (rule.type === "monthly_ordinal") {
    current = nextOrdinalDate(current, rule.dayOfWeek ?? start.getDay(), rule.ordinal ?? 1, true);
  }

  for (let i = 0; i < maxInstances; i++) {
    if (end && current > end) break;
    dates.push(toDateStr(current));
    if (rule.type === "weekly") {
      current.setDate(current.getDate() + 7);
    } else if (rule.type === "biweekly") {
      current.setDate(current.getDate() + 14);
    } else if (rule.type === "monthly_date") {
      current.setMonth(current.getMonth() + 1);
    } else if (rule.type === "monthly_ordinal") {
      current.setMonth(current.getMonth() + 1);
      current = nextOrdinalDate(current, rule.dayOfWeek ?? start.getDay(), rule.ordinal ?? 1, false);
    }
  }
  return dates;
}

function nextOrdinalDate(from: Date, dow: number, ordinal: number, skipCurrent: boolean): Date {
  const d = new Date(from);
  d.setDate(1);
  if (skipCurrent) d.setMonth(d.getMonth() + 1);
  // Find all occurrences of dow in this month
  const occurrences: Date[] = [];
  const month = d.getMonth();
  const tmp = new Date(d);
  while (tmp.getMonth() === month) {
    if (tmp.getDay() === dow) occurrences.push(new Date(tmp));
    tmp.setDate(tmp.getDate() + 1);
  }
  if (ordinal === -1) return occurrences[occurrences.length - 1] ?? d;
  return occurrences[(ordinal - 1) % occurrences.length] ?? d;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  rule: RecurrenceRule | null;
  baseDate: string; // YYYY-MM-DD — the date of the first job
  onConfirm: (rule: RecurrenceRule) => void;
  onCancel: () => void;
}

export function RecurrencePicker({ visible, rule, baseDate, onConfirm, onCancel }: Props) {
  const colors = useColors();
  const baseDow = new Date((baseDate || "2026-01-01") + "T12:00:00").getDay();

  const [type, setType] = useState<RecurrenceType>(rule?.type ?? "none");
  const [dayOfWeek, setDayOfWeek] = useState<number>(rule?.dayOfWeek ?? baseDow);
  const [ordinal, setOrdinal] = useState<number>(rule?.ordinal ?? 1);
  const [endDate, setEndDate] = useState<string>(rule?.endDate ?? "");
  const [endPreset, setEndPreset] = useState<string>(rule?.endDate ? "custom" : "6m");
  const [neverEnds, setNeverEnds] = useState<boolean>(rule?.neverEnds ?? false);

  // Reset state when opened
  useEffect(() => {
    if (visible) {
      setType(rule?.type ?? "none");
      setDayOfWeek(rule?.dayOfWeek ?? baseDow);
      setOrdinal(rule?.ordinal ?? 1);
      setEndDate(rule?.endDate ?? "");
      setEndPreset(rule?.endDate ? "custom" : "6m");
      setNeverEnds(rule?.neverEnds ?? false);
    }
  }, [visible]);

  const resolvedEndDate = (): string => {
    const base = new Date((baseDate || "2026-01-01") + "T12:00:00");
    if (endPreset === "1m") { base.setMonth(base.getMonth() + 1); return toDateStr(base); }
    if (endPreset === "3m") { base.setMonth(base.getMonth() + 3); return toDateStr(base); }
    if (endPreset === "6m") { base.setMonth(base.getMonth() + 6); return toDateStr(base); }
    if (endPreset === "1y") { base.setFullYear(base.getFullYear() + 1); return toDateStr(base); }
    return endDate;
  };

  const handleConfirm = () => {
    const r: RecurrenceRule = { type };
    if (type !== "none" && type !== "monthly_date") r.dayOfWeek = dayOfWeek;
    if (type === "monthly_ordinal") r.ordinal = ordinal;
    if (type !== "none") {
      if (neverEnds) {
        r.neverEnds = true;
        // No endDate — server will generate 13 jobs and auto-spawn on completion
      } else {
        r.endDate = resolvedEndDate();
      }
    }
    onConfirm(r);
  };

  const s = makeStyles(colors);

  const typeOptions: { label: string; value: RecurrenceType; sub?: string }[] = [
    { label: "Does not repeat", value: "none" },
    { label: "Weekly", value: "weekly", sub: "Same day every week" },
    { label: "Bi-Weekly", value: "biweekly", sub: "Every 2 weeks" },
    { label: "Monthly (same date)", value: "monthly_date", sub: "e.g. every 5th of the month" },
    { label: "Monthly (by day)", value: "monthly_ordinal", sub: "e.g. 1st Monday, 3rd Friday" },
  ];

  if (!visible) return null;

  return (
    // Absolute overlay — works inside another Modal on iOS
    <View style={[s.overlay, { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }]}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onCancel} />
      <View style={s.sheet}>
          <View style={s.header}>
            <TouchableOpacity onPress={onCancel}>
              <Text style={s.cancelBtn}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.title}>Recurrence</Text>
            <TouchableOpacity onPress={handleConfirm}>
              <Text style={s.doneBtn}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            {/* Type selection */}
            <Text style={s.sectionLabel}>REPEAT</Text>
            <View style={s.card}>
              {typeOptions.map((opt, idx) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[s.row, idx < typeOptions.length - 1 && s.rowBorder]}
                  onPress={() => setType(opt.value)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.rowLabel, type === opt.value && { color: colors.primary }]}>{opt.label}</Text>
                    {opt.sub ? <Text style={s.rowSub}>{opt.sub}</Text> : null}
                  </View>
                  {type === opt.value && (
                    <Text style={{ color: colors.primary, fontSize: 18 }}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Day of week picker (weekly, biweekly, monthly_ordinal) */}
            {(type === "weekly" || type === "biweekly" || type === "monthly_ordinal") && (
              <>
                <Text style={s.sectionLabel}>DAY OF WEEK</Text>
                <View style={s.dayRow}>
                  {DAY_NAMES.map((d, i) => (
                    <TouchableOpacity
                      key={d}
                      style={[s.dayBtn, dayOfWeek === i && { backgroundColor: colors.primary }]}
                      onPress={() => setDayOfWeek(i)}
                      activeOpacity={0.75}
                    >
                      <Text style={[s.dayBtnText, dayOfWeek === i && { color: "#fff" }]}>{d}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Ordinal picker (monthly_ordinal) */}
            {type === "monthly_ordinal" && (
              <>
                <Text style={s.sectionLabel}>WHICH OCCURRENCE</Text>
                <View style={s.card}>
                  {([1, 2, 3, 4, -1] as number[]).map((ord, idx, arr) => (
                    <TouchableOpacity
                      key={ord}
                      style={[s.row, idx < arr.length - 1 && s.rowBorder]}
                      onPress={() => setOrdinal(ord)}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.rowLabel, ordinal === ord && { color: colors.primary }]}>
                        {ORDINAL_LABELS[ord]} {DAY_FULL[dayOfWeek]}
                      </Text>
                      {ordinal === ord && <Text style={{ color: colors.primary, fontSize: 18 }}>✓</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* End date */}
            {type !== "none" && (
              <>
                <Text style={s.sectionLabel}>END AFTER</Text>
                <View style={s.card}>
                  {[
                    { label: "1 month", value: "1m" },
                    { label: "3 months", value: "3m" },
                    { label: "6 months", value: "6m" },
                    { label: "1 year", value: "1y" },
                  ].map((opt, idx, arr) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[s.row, idx < arr.length - 1 && s.rowBorder, neverEnds && { opacity: 0.4 }]}
                      onPress={() => { setNeverEnds(false); setEndPreset(opt.value); }}
                      activeOpacity={0.7}
                      disabled={neverEnds}
                    >
                      <Text style={[s.rowLabel, !neverEnds && endPreset === opt.value && { color: colors.primary }]}>{opt.label}</Text>
                      {!neverEnds && endPreset === opt.value && <Text style={{ color: colors.primary, fontSize: 18 }}>✓</Text>}
                    </TouchableOpacity>
                  ))}
                  {/* Divider */}
                  <View style={s.rowBorder} />
                  {/* Never Ends option */}
                  <TouchableOpacity
                    style={s.row}
                    onPress={() => setNeverEnds(v => !v)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[s.rowLabel, neverEnds && { color: colors.primary }]}>Never ends</Text>
                      <Text style={s.rowSub}>Creates 13 jobs at a time · auto-renews on completion</Text>
                    </View>
                    {neverEnds && <Text style={{ color: colors.primary, fontSize: 18 }}>✓</Text>}
                  </TouchableOpacity>
                </View>

                {/* Preview */}
                <Text style={s.sectionLabel}>PREVIEW</Text>
                <View style={[s.card, { paddingHorizontal: 16, paddingVertical: 12 }]}>
                  <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 20 }}>
                    {recurrenceLabel({ type, dayOfWeek, ordinal, endDate: neverEnds ? undefined : resolvedEndDate(), neverEnds })}
                    {"\n"}
                    {neverEnds ? (
                      <Text style={{ color: colors.muted }}>13 jobs created · next spawned when each completes</Text>
                    ) : (
                      <Text style={{ color: colors.muted }}>Ends {resolvedEndDate() || "—"}</Text>
                    )}
                  </Text>
                </View>
              </>
            )}
          </ScrollView>
        </View>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    overlay: {
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: "90%",
      paddingBottom: Platform.OS === "ios" ? 34 : 16,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    title: {
      fontSize: 17,
      fontWeight: "600",
      color: colors.foreground,
    },
    cancelBtn: {
      fontSize: 16,
      color: colors.muted,
    },
    doneBtn: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.primary,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.muted,
      letterSpacing: 0.5,
      marginTop: 20,
      marginBottom: 6,
      marginHorizontal: 20,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      marginHorizontal: 16,
      overflow: "hidden",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 13,
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowLabel: {
      fontSize: 16,
      color: colors.foreground,
    },
    rowSub: {
      fontSize: 12,
      color: colors.muted,
      marginTop: 2,
    },
    dayRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginHorizontal: 16,
      gap: 6,
    },
    dayBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: "center",
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    dayBtnText: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.foreground,
    },
  });
}
