import { useState, useMemo, useCallback } from "react";
import { Text, View, TouchableOpacity, StyleSheet } from "react-native";

// CalendarPicker uses explicit hardcoded colors so it renders correctly
// in any container (white modals, dark modals, etc.) without relying on
// theme CSS variables that can be inconsistent across modal presentations.
const C = {
  bg: "#FFFFFF",
  border: "#E5E7EB",
  header: "#111827",
  navBg: "#F3F4F6",
  navText: "#0066FF",
  weekday: "#6B7280",
  day: "#111827",
  dayOther: "#D1D5DB",
  dayDisabled: "#E5E7EB",
  todayBg: "rgba(0,102,255,0.08)",
  todayText: "#0066FF",
  selectedBg: "#0066FF",
  selectedText: "#FFFFFF",
  rangeBg: "rgba(0,102,255,0.12)",
  rangeText: "#0066FF",
};

const DAYS_OF_WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateStr(str: string): { year: number; month: number; day: number } | null {
  const parts = str.split("-");
  if (parts.length !== 3) return null;
  return { year: parseInt(parts[0], 10), month: parseInt(parts[1], 10) - 1, day: parseInt(parts[2], 10) };
}

interface CalendarPickerProps {
  selectedDate?: string;
  onSelectDate: (dateStr: string) => void;
  minDate?: string;
  rangeStart?: string;
  rangeEnd?: string;
}

export function CalendarPicker({
  selectedDate,
  onSelectDate,
  minDate,
  rangeStart,
  rangeEnd,
}: CalendarPickerProps) {
  const today = new Date();
  const todayStr = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  const initial = selectedDate ? parseDateStr(selectedDate) : null;
  const [view, setView] = useState<{ year: number; month: number }>({
    year: initial?.year ?? today.getFullYear(),
    month: initial?.month ?? today.getMonth(),
  });
  const viewYear = view.year;
  const viewMonth = view.month;

  const goToPrev = useCallback(() => {
    setView(({ year, month }) => {
      if (month === 0) return { year: year - 1, month: 11 };
      return { year, month: month - 1 };
    });
  }, []);

  const goToNext = useCallback(() => {
    setView(({ year, month }) => {
      if (month === 11) return { year: year + 1, month: 0 };
      return { year, month: month + 1 };
    });
  }, []);

  const calendarDays = useMemo(() => {
    const jsFirstDay = new Date(viewYear, viewMonth, 1).getDay();
    const firstDay = (jsFirstDay + 6) % 7; // 0=Mon
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const cells: { day: number; dateStr: string; isCurrentMonth: boolean }[] = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const m = viewMonth === 0 ? 11 : viewMonth - 1;
      const y = viewMonth === 0 ? viewYear - 1 : viewYear;
      cells.push({ day: d, dateStr: toDateStr(y, m, d), isCurrentMonth: false });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, dateStr: toDateStr(viewYear, viewMonth, d), isCurrentMonth: true });
    }

    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const m = viewMonth === 11 ? 0 : viewMonth + 1;
      const y = viewMonth === 11 ? viewYear + 1 : viewYear;
      cells.push({ day: d, dateStr: toDateStr(y, m, d), isCurrentMonth: false });
    }

    return cells;
  }, [viewYear, viewMonth]);

  const isDisabled = (dateStr: string) => {
    if (minDate && dateStr < minDate) return true;
    return false;
  };

  const isInRange = (dateStr: string) => {
    if (!rangeStart || !rangeEnd) return false;
    return dateStr >= rangeStart && dateStr <= rangeEnd;
  };

  const isRangeStart = (dateStr: string) => rangeStart === dateStr;
  const isRangeEnd = (dateStr: string) => rangeEnd === dateStr;

  return (
    <View style={styles.container}>
      {/* Month/Year Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goToPrev} activeOpacity={0.7} style={styles.navBtn}>
          <Text style={styles.navText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthLabel}>
          {MONTH_NAMES[viewMonth]} {viewYear}
        </Text>
        <TouchableOpacity onPress={goToNext} activeOpacity={0.7} style={styles.navBtn}>
          <Text style={styles.navText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Day of Week Labels */}
      <View style={styles.weekRow}>
        {DAYS_OF_WEEK.map((d) => (
          <View key={d} style={styles.dayCell}>
            <Text style={styles.weekdayText}>{d}</Text>
          </View>
        ))}
      </View>

      {/* Calendar Grid */}
      <View style={styles.grid}>
        {calendarDays.map((cell, idx) => {
          const disabled = isDisabled(cell.dateStr);
          const selected = cell.dateStr === selectedDate;
          const isToday = cell.dateStr === todayStr;
          const inRange = isInRange(cell.dateStr);
          const isStart = isRangeStart(cell.dateStr);
          const isEnd = isRangeEnd(cell.dateStr);

          let bgColor = "transparent";
          let textColor: string;
          let fontWeight: "400" | "600" | "700" = "400";

          if (!cell.isCurrentMonth) {
            textColor = C.dayOther;
          } else if (disabled) {
            textColor = C.dayDisabled;
          } else if (selected || isStart || isEnd) {
            bgColor = C.selectedBg;
            textColor = C.selectedText;
            fontWeight = "700";
          } else if (inRange) {
            bgColor = C.rangeBg;
            textColor = C.rangeText;
            fontWeight = "600";
          } else if (isToday) {
            bgColor = C.todayBg;
            textColor = C.todayText;
            fontWeight = "700";
          } else {
            textColor = C.day;
          }

          return (
            <TouchableOpacity
              key={`${cell.dateStr}-${idx}`}
              onPress={() => {
                if (!disabled && cell.isCurrentMonth) {
                  onSelectDate(cell.dateStr);
                }
              }}
              disabled={disabled || !cell.isCurrentMonth}
              activeOpacity={0.6}
              style={[
                styles.dayCell,
                {
                  backgroundColor: bgColor,
                  borderRadius: selected || isStart || isEnd ? 20 : inRange ? 0 : 20,
                },
              ]}
            >
              <Text style={{ fontSize: 14, fontWeight, color: textColor }}>
                {cell.day}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    backgroundColor: C.bg,
    borderColor: C.border,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: C.navBg,
  },
  navText: {
    fontSize: 20,
    color: C.navText,
    fontWeight: "700",
    lineHeight: 24,
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: C.header,
  },
  weekRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  weekdayText: {
    fontSize: 12,
    fontWeight: "600",
    color: C.weekday,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: "14.28%",
    aspectRatio: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
