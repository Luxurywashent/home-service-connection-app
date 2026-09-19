import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { CompanyAuthorityLoading, CompanyAuthorityMessage } from "@/components/company-authority-state";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import {
  COMPANY_FINANCIAL_LEGACY_FALLTHROUGH_BLOCKED,
  COMPANY_PAYMENT_CONTROLS,
  companyCanonicalReadError,
} from "@/lib/jobsync-company-authority";
import { getJobSyncCompanyCustomer, type JobSyncCompanyCustomerDetail } from "@/lib/jobsync-mobile-api";

function Field({ label, value }: { label: string; value?: string | null }) {
  const colors = useColors();
  return (
    <View style={{
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
      marginBottom: 10,
      padding: 14,
    }}>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600", marginTop: 4 }}>{value?.trim() ? value : "—"}</Text>
    </View>
  );
}

function LimitedNotice({ title, detail }: { title: string; detail: string }) {
  const colors = useColors();
  return (
    <View style={{
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
      marginBottom: 10,
      padding: 14,
    }}>
      <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700" }}>{title}</Text>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>{detail}</Text>
    </View>
  );
}

export function CompanyCustomerProfilePanel({ token }: { token: string }) {
  const colors = useColors();
  const params = useLocalSearchParams<{ customerId?: string }>();
  const customerId = Number(params.customerId);
  const validId = Number.isSafeInteger(customerId) && customerId > 0;
  const [customer, setCustomer] = useState<JobSyncCompanyCustomerDetail | null>(null);
  const [loading, setLoading] = useState(validId);
  const [error, setError] = useState<string | null>(validId ? null : "A valid Home Service Connected customer is required.");

  const refresh = useCallback(async () => {
    if (!validId) {
      setCustomer(null);
      setLoading(false);
      setError("A valid Home Service Connected customer is required.");
      return;
    }
    setLoading(true);
    try {
      setCustomer(await getJobSyncCompanyCustomer(token, customerId));
      setError(null);
    } catch (refreshError) {
      setCustomer(null);
      setError(companyCanonicalReadError(refreshError));
    } finally {
      setLoading(false);
    }
  }, [customerId, token, validId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <ScreenContainer edges={["left", "right"]} className="flex-1">
      <ScrollView contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 16, paddingTop: 16 }}>
        <Text style={{ color: colors.foreground, fontSize: 24, fontWeight: "800" }}>Customer</Text>
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 16, marginTop: 4 }}>
          Canonical Home Service Connected profile. Local saved cards, Stripe, estimates, receipts, and payment actions stay unmounted.
        </Text>

        {loading ? (
          <CompanyAuthorityLoading message="Loading Company customer…" />
        ) : error || !customer ? (
          <CompanyAuthorityMessage
            title="Company customer profile is unavailable"
            detail={error ?? COMPANY_FINANCIAL_LEGACY_FALLTHROUGH_BLOCKED}
          />
        ) : (
          <>
            <Field label="Name" value={customer.name} />
            <Field label="Phone" value={customer.phone} />
            <Field label="Email" value={customer.email} />
            <Field label="Address" value={[customer.addressLine1, customer.city, customer.region, customer.postalCode].filter(Boolean).join(", ")} />
            <Field label="Vehicle" value={[customer.vehicleYear, customer.vehicleMake, customer.vehicleModel, customer.vehicleType].filter(Boolean).join(" ")} />
            <Field label="Preferred contact" value={customer.preferredContact} />
            <Field label="Do not service" value={customer.doNotService == null ? "Unavailable" : customer.doNotService ? "Yes" : "No"} />

            <LimitedNotice
              title="Jobs and lifetime value"
              detail="Company mode does not load local Luxury Wash jobs or invent lifetime value. Use Invoices and Unpaid Jobs for canonical balances."
            />
            <LimitedNotice
              title="Saved cards"
              detail={COMPANY_PAYMENT_CONTROLS.savedCardCharging ? "Saved cards are enabled." : "Saved cards, charging, and SetupIntents are disabled for Company mode."}
            />
            <LimitedNotice
              title="Estimates"
              detail="Local Luxury Wash estimate CRUD is not available in Company mode."
            />
            <LimitedNotice
              title="Receipts and local payments"
              detail="Local receipts, mark paid, Stripe reconciliation, and refunds stay on the Luxury Wash path only."
            />
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
