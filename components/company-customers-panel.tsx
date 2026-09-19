import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

import { CompanyAuthorityLoading, CompanyAuthorityMessage } from "@/components/company-authority-state";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import {
  COMPANY_FINANCIAL_LEGACY_FALLTHROUGH_BLOCKED,
  companyCanonicalListState,
  companyCanonicalReadError,
} from "@/lib/jobsync-company-authority";
import { getJobSyncCompanyCustomers, type JobSyncCompanyCustomer } from "@/lib/jobsync-mobile-api";
import { useJobSyncSync } from "@/lib/jobsync-sync-context";

function contactLine(customer: JobSyncCompanyCustomer) {
  return customer.phone ?? customer.email ?? customer.addressLine1 ?? customer.city ?? "No contact info";
}

export function CompanyCustomersPanel({ token }: { token: string }) {
  const colors = useColors();
  const router = useRouter();
  const { revision } = useJobSyncSync();
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<JobSyncCompanyCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setCustomers(await getJobSyncCompanyCustomers(token));
      setError(null);
    } catch (refreshError) {
      setCustomers([]);
      setError(companyCanonicalReadError(refreshError));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh, revision]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = search.replace(/\D/g, "");
    const list = q
      ? customers.filter((customer) => {
          return (
            customer.name.toLowerCase().includes(q) ||
            (customer.phone && customer.phone.replace(/\D/g, "").includes(digits)) ||
            (customer.email && customer.email.toLowerCase().includes(q)) ||
            (customer.addressLine1 && customer.addressLine1.toLowerCase().includes(q)) ||
            (customer.city && customer.city.toLowerCase().includes(q))
          );
        })
      : customers;
    return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [customers, search]);

  const listState = companyCanonicalListState({ loading, error, itemCount: customers.length });

  const openDetail = useCallback((customer: JobSyncCompanyCustomer) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/(tabs)/admin-customer-profile" as any,
      params: {
        customerId: String(customer.id),
        fullName: customer.name,
        phone: customer.phone ?? "",
        email: customer.email ?? "",
        address: customer.addressLine1 ?? "",
        city: customer.city ?? "",
      },
    });
  }, [router]);

  return (
    <ScreenContainer edges={["left", "right"]} className="flex-1">
      <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <Text style={{ color: colors.foreground, fontSize: 24, fontWeight: "800" }}>Customers</Text>
        <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
          Home Service Connected customers. Lifetime value and local Luxury Wash records stay off this list.
        </Text>
      </View>

      <View style={{
        alignItems: "center",
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderRadius: 12,
        borderWidth: 1,
        flexDirection: "row",
        marginBottom: 12,
        marginHorizontal: 16,
        paddingHorizontal: 12,
      }}>
        <Text style={{ fontSize: 16, marginRight: 8 }}>🔍</Text>
        <TextInput
          style={{ color: colors.foreground, flex: 1, fontSize: 14, height: 44 }}
          placeholder="Search by name, phone, email..."
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {listState === "ready" ? (
        <View style={{
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          marginBottom: 12,
          marginHorizontal: 16,
          padding: 12,
        }}>
          <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "800" }}>{customers.length}</Text>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Canonical customers</Text>
        </View>
      ) : null}

      {search.trim() && listState === "ready" ? (
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8, marginHorizontal: 16 }}>
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </Text>
      ) : null}

      {listState === "loading" ? (
        <CompanyAuthorityLoading message="Loading Company customers…" />
      ) : listState === "error" ? (
        <CompanyAuthorityMessage
          title="Company customers are unavailable"
          detail={error ?? COMPANY_FINANCIAL_LEGACY_FALLTHROUGH_BLOCKED}
        />
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 16 }}
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
          ListEmptyComponent={
            <CompanyAuthorityMessage
              title={search.trim() ? "No customers match your search" : "No Company customers"}
              detail="This empty list came from Home Service Connected, not the local Luxury Wash customer table."
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={{
                alignItems: "center",
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: 12,
                borderWidth: 1,
                flexDirection: "row",
                gap: 12,
                marginBottom: 8,
                padding: 12,
              }}
              onPress={() => openDetail(item)}
              activeOpacity={0.7}
            >
              <View style={{
                alignItems: "center",
                backgroundColor: `${colors.primary}22`,
                borderRadius: 22,
                height: 44,
                justifyContent: "center",
                width: 44,
              }}>
                <Text style={{ color: colors.primary, fontSize: 18, fontWeight: "700" }}>
                  {item.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>{item.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{contactLine(item)}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 20 }}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </ScreenContainer>
  );
}
