import { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";

const DEFAULT_HOURLY_RATE = 17;
const DEFAULT_UPSELL_BONUS_PCT = 40;
const TAX_RATE = 0.1665;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function formatCurrency(n: number): string {
  return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
}

// Generate last N weekly pay periods (Mon–Sun), most recent first
function generatePayPeriods(count: number) {
  const periods: { label: string; startDate: string; endDate: string }[] = [];
  const today = new Date();
  const baseMonday = getWeekStart(today);
  const baseMondayMs = baseMonday.getTime();

  for (let i = 0; i < count; i++) {
    // Compute each week start independently from the base to avoid mutation drift
    const start = new Date(baseMondayMs - i * 7 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);

    const startStr = localDateStr(start);
    const endStr = localDateStr(end);
    const label = `${formatDate(startStr)} – ${formatDate(endStr)}`;
    periods.push({ label, startDate: startStr, endDate: endStr });
  }
  return periods;
}

// ─── PaystubCard ──────────────────────────────────────────────────────────────

interface PaystubCardProps {
  period: { label: string; startDate: string; endDate: string };
  employeeId: string;
  hourlyRate: number;
  upsellBonusPct: number;
  isExpanded: boolean;
  onToggle: () => void;
}

function PaystubCard({ period, employeeId, hourlyRate, upsellBonusPct, isExpanded, onToggle }: PaystubCardProps) {
  const colors = useColors();

  const hoursQuery = trpc.timesheet.getWeeklyHours.useQuery(
    { employeeId, startDate: period.startDate, endDate: period.endDate },
    { enabled: isExpanded }
  );

  const perfQuery = trpc.performance.getDateRange.useQuery(
    { employeeId, startDate: period.startDate, endDate: period.endDate },
    { enabled: isExpanded }
  );

  const summary = useMemo(() => {
    if (!isExpanded || hoursQuery.isLoading || perfQuery.isLoading) return null;

    const totalHours = hoursQuery.data?.totalHours ?? 0;
    const perfRows = perfQuery.data ?? [];

    const totalUpsellBonus = perfRows.reduce((sum, r) => sum + Number(r.upsells ?? 0), 0);
    const totalTips = perfRows.reduce((sum, r) => sum + Number(r.tips ?? 0), 0);

    const grossPay = totalHours * hourlyRate + totalUpsellBonus + totalTips;
    const taxAmount = grossPay * TAX_RATE;
    const netPay = grossPay - taxAmount;

    // Group daily hours by date to avoid duplicate keys (multiple clock sessions per day)
    const rawDailyHours = hoursQuery.data?.dailyHours ?? [];
    const dailyMap = new Map<string, number>();
    for (const d of rawDailyHours) {
      dailyMap.set(d.date, (dailyMap.get(d.date) ?? 0) + d.hours);
    }
    const dailyHours = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, hours]) => ({ date, hours }));

    return {
      totalHours,
      basePay: totalHours * hourlyRate,
      upsellBonus: totalUpsellBonus,
      tips: totalTips,
      grossPay,
      taxAmount,
      netPay,
      dailyHours,
    };
  }, [isExpanded, hoursQuery.data, perfQuery.data, hoursQuery.isLoading, perfQuery.isLoading]);

  const isLoading = isExpanded && (hoursQuery.isLoading || perfQuery.isLoading);

  return (
    <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header row */}
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.75}
        style={s.cardHeader}
      >
        <View style={{ flex: 1 }}>
          <Text style={[s.periodLabel, { color: colors.foreground }]}>{period.label}</Text>
          {summary && (
            <Text style={[s.netPayPreview, { color: colors.primary }]}>
              Net: {formatCurrency(summary.netPay)}
            </Text>
          )}
        </View>
        <Text style={[s.chevron, { color: colors.muted }]}>{isExpanded ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {/* Expanded detail */}
      {isExpanded && (
        <View style={[s.detail, { borderTopColor: colors.border }]}>
          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
          ) : summary ? (
            <>
              {/* Earnings breakdown */}
              <Text style={[s.sectionTitle, { color: colors.muted }]}>EARNINGS</Text>
              <Row label={`Base Pay (${summary.totalHours.toFixed(1)} hrs × $${hourlyRate.toFixed(2)}/hr)`} value={formatCurrency(summary.basePay)} color={colors.foreground} />
              <Row label={`Upsell Bonus (${upsellBonusPct.toFixed(0)}%)`} value={formatCurrency(summary.upsellBonus)} color={colors.success} />
              <Row label="Tips" value={formatCurrency(summary.tips)} color={colors.success} />
              <View style={[s.divider, { backgroundColor: colors.border }]} />
              <Row label="Gross Pay" value={formatCurrency(summary.grossPay)} color={colors.foreground} bold />
              <Row label={`Estimated Tax (${(TAX_RATE * 100).toFixed(2)}%)`} value={`-${formatCurrency(summary.taxAmount)}`} color={colors.error} />
              <View style={[s.divider, { backgroundColor: colors.border }]} />
              <Row label="Estimated Net Pay" value={formatCurrency(summary.netPay)} color={colors.primary} bold large />

              {/* Hours by day */}
              {summary.dailyHours.length > 0 && (
                <>
                  <Text style={[s.sectionTitle, { color: colors.muted, marginTop: 16 }]}>HOURS BY DAY</Text>
                  {summary.dailyHours.map((d: { date: string; hours: number }) => (
                    <Row
                      key={d.date}
                      label={formatDate(d.date)}
                      value={`${d.hours.toFixed(2)} hrs`}
                      color={colors.foreground}
                    />
                  ))}
                </>
              )}

              <Text style={[s.disclaimer, { color: colors.muted }]}>
                * Estimated net pay based on internal records. Actual paycheck may differ based on deductions, benefits, and payroll processing.
              </Text>
            </>
          ) : (
            <Text style={[s.emptyText, { color: colors.muted }]}>No data for this period.</Text>
          )}
        </View>
      )}
    </View>
  );
}

function Row({ label, value, color, bold, large }: { label: string; value: string; color: string; bold?: boolean; large?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, { color: "#9BA1A6" }, bold && s.bold]}>{label}</Text>
      <Text style={[s.rowValue, { color }, bold && s.bold, large && s.large]}>{value}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PayrollScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  const payPeriods = useMemo(() => generatePayPeriods(12), []);

  if (!employee) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["left", "right"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Header */}
        <View style={s.header}>
          <Text style={[s.title, { color: colors.foreground }]}>💰 Payroll</Text>
          <Text style={[s.subtitle, { color: colors.muted }]}>
            Your estimated earnings by pay period
          </Text>
        </View>

        {/* Pay rate info */}
        <View style={[s.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[s.infoText, { color: colors.muted }]}>
            Base rate: <Text style={{ color: colors.foreground, fontWeight: "700" }}>${(employee?.hourlyRate ?? DEFAULT_HOURLY_RATE).toFixed(2)}/hr</Text>
            {"  ·  "}Upsell bonus: <Text style={{ color: colors.success, fontWeight: "700" }}>{(employee?.upsellBonusPct ?? DEFAULT_UPSELL_BONUS_PCT).toFixed(0)}%</Text>
            {"  ·  "}Tax est.: <Text style={{ color: colors.error, fontWeight: "700" }}>{(TAX_RATE * 100).toFixed(2)}%</Text>
          </Text>
        </View>

        {/* Pay stubs list */}
        {payPeriods.map((period, i) => (
          <PaystubCard
            key={`period-${i}-${period.startDate}`}
            period={period}
            employeeId={employee.employeeId}
            hourlyRate={employee.hourlyRate ?? DEFAULT_HOURLY_RATE}
            upsellBonusPct={employee.upsellBonusPct ?? DEFAULT_UPSELL_BONUS_PCT}
            isExpanded={expandedIndex === i}
            onToggle={() => setExpandedIndex(expandedIndex === i ? null : i)}
          />
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
  },
  infoCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  infoText: {
    fontSize: 13,
    textAlign: "center",
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  periodLabel: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  netPayPreview: {
    fontSize: 13,
    fontWeight: "700",
  },
  chevron: {
    fontSize: 12,
    marginLeft: 8,
  },
  detail: {
    borderTopWidth: 1,
    padding: 16,
    paddingTop: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
  },
  rowLabel: {
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  rowValue: {
    fontSize: 13,
    fontWeight: "600",
  },
  bold: {
    fontWeight: "700",
  },
  large: {
    fontSize: 18,
  },
  divider: {
    height: 1,
    marginVertical: 8,
  },
  disclaimer: {
    fontSize: 11,
    marginTop: 14,
    lineHeight: 16,
    fontStyle: "italic",
  },
  emptyText: {
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 16,
  },
});
