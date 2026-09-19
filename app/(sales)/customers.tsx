/**
 * Sales Rep — Customers Tab
 * Shows the full customer list with search and lifetime value stats.
 * Tapping a customer opens the admin customer profile screen (read-only context).
 */
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
} from "react-native";
import { useState, useMemo, useCallback } from "react";
import { useRouter } from "expo-router";
import { CompanyCustomersPanel } from "@/components/company-customers-panel";
import { CompanyFinancialGate } from "@/components/company-financial-gate";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Customer {
  customerId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  lifetimeValue: number;
  jobCount: number;
  lastServiceDate: string | null;
  firstServiceDate: string | null;
  source: "online" | "manual" | "both";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtCurrency(val: number | string | null | undefined): string {
  const n = parseFloat(String(val ?? "0")) || 0;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SalesCustomersScreen() {
  return (
    <CompanyFinancialGate
      loadingMessage="Confirming Company identity before Customers…"
      company={(token) => <CompanyCustomersPanel token={token} />}
      legacy={() => <LegacySalesCustomersScreen />}
    />
  );
}

function LegacySalesCustomersScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [search, setSearch] = useState("");
  const router = useRouter();

  const {
    data: customers = [],
    isLoading,
    refetch,
    isRefetching,
  } = trpc.customers.listAll.useQuery({ search: "" });

  const filtered = useMemo(() => {
    const list = search.trim()
      ? (customers as Customer[]).filter((c) => {
          const q = search.toLowerCase();
          const nq = search.replace(/\D/g, "");
          return (
            c.fullName.toLowerCase().includes(q) ||
            (c.phone && c.phone.replace(/\D/g, "").includes(nq)) ||
            (c.email && c.email.toLowerCase().includes(q)) ||
            (c.address && c.address.toLowerCase().includes(q))
          );
        })
      : (customers as Customer[]);
    return [...list].sort((a, b) =>
      a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" })
    );
  }, [customers, search]);

  const totalLifetime = useMemo(
    () => (customers as Customer[]).reduce((s, c) => s + (c.lifetimeValue ?? 0), 0),
    [customers]
  );

  const openDetail = useCallback(
    (customer: Customer) => {
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.push({
        pathname: "/(tabs)/admin-customer-profile" as any,
        params: {
          customerId: customer.customerId,
          fullName: customer.fullName,
          phone: customer.phone ?? "",
          email: customer.email ?? "",
          address: customer.address ?? "",
          city: customer.city ?? "",
          lifetimeValue: String(customer.lifetimeValue ?? 0),
          jobCount: String(customer.jobCount ?? 0),
          lastServiceDate: customer.lastServiceDate ?? "",
          firstServiceDate: customer.firstServiceDate ?? "",
        },
      });
    },
    [router]
  );

  const renderCustomer = useCallback(
    ({ item }: { item: Customer }) => {
      const lv = fmtCurrency(item.lifetimeValue);
      const lastDate = fmtDate(item.lastServiceDate);
      return (
        <TouchableOpacity
          style={styles.row}
          onPress={() => openDetail(item)}
          activeOpacity={0.7}
        >
          <View style={styles.rowAvatar}>
            <Text style={styles.rowAvatarText}>
              {item.fullName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.rowInfo}>
            <Text style={styles.rowName}>{item.fullName}</Text>
            <Text style={styles.rowSub}>
              {item.phone ?? item.email ?? item.address ?? item.city ?? "No contact info"}
            </Text>
            <Text style={styles.rowSub2}>
              Last: {lastDate} · {item.jobCount} job{item.jobCount !== 1 ? "s" : ""}
            </Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={styles.rowLV}>{lv}</Text>
            <Text style={styles.rowLVLabel}>lifetime</Text>
          </View>
        </TouchableOpacity>
      );
    },
    [styles, openDetail]
  );

  return (
    <ScreenContainer edges={["left", "right"]} className="flex-1">
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Customers</Text>
        <Text style={styles.headerSub}>
          {(customers as Customer[]).length.toLocaleString()} records · {fmtCurrency(totalLifetime)} total
        </Text>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, phone, email..."
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{(customers as Customer[]).length}</Text>
          <Text style={styles.statLabel}>Total Customers</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: colors.success }]}>{fmtCurrency(totalLifetime)}</Text>
          <Text style={styles.statLabel}>Total Lifetime Value</Text>
        </View>
      </View>

      {/* Result count */}
      {search.trim() ? (
        <Text style={styles.resultCount}>
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </Text>
      ) : null}

      {/* List */}
      {isLoading ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Loading customers...</Text>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={filtered}
          keyExtractor={(item) => item.customerId}
          renderItem={renderCustomer}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>👤</Text>
              <Text style={styles.emptyText}>
                {search.trim() ? "No customers match your search" : "No customers yet"}
              </Text>
            </View>
          }
        />
      )}
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
    headerTitle: { fontSize: 24, fontWeight: "800", color: colors.foreground },
    headerSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
    searchWrap: {
      flexDirection: "row",
      alignItems: "center",
      marginHorizontal: 16,
      marginBottom: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
    },
    searchIcon: { fontSize: 16, marginRight: 8 },
    searchInput: { flex: 1, height: 44, color: colors.foreground, fontSize: 14 },
    statsRow: { flexDirection: "row", gap: 10, marginHorizontal: 16, marginBottom: 12 },
    statCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
    },
    statValue: { fontSize: 18, fontWeight: "800", color: colors.foreground },
    statLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
    resultCount: { fontSize: 12, color: colors.muted, marginHorizontal: 16, marginBottom: 8 },
    listContent: { paddingHorizontal: 16, paddingBottom: 32 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      marginBottom: 8,
      gap: 12,
    },
    rowAvatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primary + "22",
      justifyContent: "center",
      alignItems: "center",
    },
    rowAvatarText: { fontSize: 18, fontWeight: "700", color: colors.primary },
    rowInfo: { flex: 1 },
    rowName: { fontSize: 15, fontWeight: "700", color: colors.foreground },
    rowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
    rowSub2: { fontSize: 11, color: colors.muted, marginTop: 1 },
    rowRight: { alignItems: "flex-end" },
    rowLV: { fontSize: 14, fontWeight: "800", color: colors.foreground },
    rowLVLabel: { fontSize: 10, color: colors.muted, marginTop: 1 },
    emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 60 },
    emptyIcon: { fontSize: 40, marginBottom: 12 },
    emptyText: { fontSize: 15, color: colors.muted, textAlign: "center" },
  });
}
