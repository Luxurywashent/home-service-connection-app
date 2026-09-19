import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";

import { CompanyAuthorityLoading, CompanyAuthorityMessage } from "@/components/company-authority-state";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import {
  COMPANY_FINANCIAL_LEGACY_FALLTHROUGH_BLOCKED,
  companyCanonicalReadError,
  resolveCompanyFinanceDisplay,
} from "@/lib/jobsync-company-authority";
import { getJobSyncCompanyFinance, type JobSyncCompanyFinanceSummary } from "@/lib/jobsync-mobile-api";
import { useJobSyncSync } from "@/lib/jobsync-sync-context";

function formatMoney(value: number | null) {
  if (value == null) return "Unavailable";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function Metric({ label, value, definition }: { label: string; value: number | null; definition?: string }) {
  const colors = useColors();
  return (
    <View style={{
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
      flex: 1,
      minWidth: "47%",
      padding: 14,
    }}>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "800", marginTop: 6 }}>{formatMoney(value)}</Text>
      {definition ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>{definition}</Text> : null}
    </View>
  );
}

export function CompanyFinancePanel({ token }: { token: string }) {
  const colors = useColors();
  const { revision } = useJobSyncSync();
  const [finance, setFinance] = useState<JobSyncCompanyFinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setFinance(await getJobSyncCompanyFinance(token));
      setError(null);
    } catch (refreshError) {
      setFinance(null);
      setError(companyCanonicalReadError(refreshError));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh, revision]);

  const display = resolveCompanyFinanceDisplay({
    mode: "company",
    finance,
    error,
    loading,
  });

  return (
    <ScreenContainer edges={["left", "right"]} className="flex-1">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
            tintColor={colors.primary}
          />
        }
      >
        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
          <Text style={{ color: colors.foreground, fontSize: 24, fontWeight: "800" }}>Finance</Text>
          <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
            Canonical Home Service Connected FinanceService projection. Local ledger writes, balance-sheet math, and Tap to Pay settings stay unmounted.
          </Text>
          {display.state === "ready" && finance?.reportingMonth ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>
              Reporting month {finance.reportingMonth}{finance.reportingTimezone ? ` · ${finance.reportingTimezone}` : ""}
            </Text>
          ) : null}
        </View>

        {display.state === "loading" ? (
          <CompanyAuthorityLoading message="Loading Company Finance…" />
        ) : display.state === "error" ? (
          <CompanyAuthorityMessage
            title="Company Finance is unavailable"
            detail={error ?? COMPANY_FINANCIAL_LEGACY_FALLTHROUGH_BLOCKED}
          />
        ) : finance ? (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 16 }}>
              <Metric label="Ledger income" value={finance.income} definition={finance.definitions.income} />
              <Metric label="Ledger expenses" value={finance.expenses} definition={finance.definitions.expenses} />
              <Metric label="Net cash movement" value={finance.netCashMovement} definition={finance.definitions.netCashMovement} />
              <Metric label="Collected" value={finance.collected} definition={finance.definitions.collected} />
              <Metric label="Outstanding" value={finance.outstanding} definition={finance.definitions.outstanding} />
              <Metric label="Booked revenue" value={finance.bookedRevenue} definition={finance.definitions.bookedRevenue} />
              <Metric label="Billed total" value={finance.billedTotal} />
              <Metric label="Collected total" value={finance.collectedTotal} />
              <Metric label="Open balance" value={finance.openBalance} />
              <Metric label="Past due" value={finance.pastDueBalance} />
            </View>

            {finance.invoiceCount != null ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginHorizontal: 16, marginTop: 12 }}>
                {finance.invoiceCount} canonical job invoice{finance.invoiceCount === 1 ? "" : "s"}
              </Text>
            ) : null}

            <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
              <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700", marginBottom: 10 }}>Recent transactions</Text>
              {finance.transactions.length === 0 ? (
                <CompanyAuthorityMessage
                  title="No finance transactions"
                  detail="This empty list came from Home Service Connected FinanceService, not a local zero."
                />
              ) : (
                finance.transactions.map((row) => (
                  <View
                    key={row.id}
                    style={{
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: 12,
                      borderWidth: 1,
                      marginBottom: 8,
                      padding: 14,
                    }}
                  >
                    <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700" }}>
                      {row.category} · {row.type}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                      {row.date ?? "No date"}{row.description ? ` · ${row.description}` : ""}
                    </Text>
                    <Text style={{ color: row.type === "expense" ? colors.warning : colors.success, fontSize: 16, fontWeight: "800", marginTop: 8 }}>
                      {formatMoney(row.amount)}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </>
        ) : (
          <CompanyAuthorityMessage
            title="Company Finance is unavailable"
            detail={COMPANY_FINANCIAL_LEGACY_FALLTHROUGH_BLOCKED}
          />
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
