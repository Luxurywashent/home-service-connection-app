import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { CompanyAuthorityLoading, CompanyAuthorityMessage } from "@/components/company-authority-state";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import {
  COMPANY_FINANCIAL_LEGACY_FALLTHROUGH_BLOCKED,
  COMPANY_PAYMENT_CONTROLS,
  companyCanonicalReadError,
} from "@/lib/jobsync-company-authority";
import {
  getJobSyncCompanyCustomer,
  updateJobSyncCompanyCustomer,
  type JobSyncCompanyCustomerDetail,
} from "@/lib/jobsync-mobile-api";

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

function EditField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const colors = useColors();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.4, marginBottom: 6, textTransform: "uppercase" }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          color: colors.foreground,
          fontSize: 15,
          paddingHorizontal: 14,
          paddingVertical: 12,
        }}
      />
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

type EditForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  region: string;
  postalCode: string;
};

function toEditForm(customer: JobSyncCompanyCustomerDetail): EditForm {
  return {
    firstName: customer.firstName ?? "",
    lastName: customer.lastName ?? "",
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    addressLine1: customer.addressLine1 ?? "",
    city: customer.city ?? "",
    region: customer.region ?? "",
    postalCode: customer.postalCode ?? "",
  };
}

export function CompanyCustomerProfilePanel({ token }: { token: string }) {
  const colors = useColors();
  const { session } = useJobSyncAuth();
  const params = useLocalSearchParams<{ customerId?: string }>();
  const customerId = Number(params.customerId);
  const validId = Number.isSafeInteger(customerId) && customerId > 0;
  const canEdit = session?.user?.role === "owner" || session?.user?.role === "dispatcher";
  const [customer, setCustomer] = useState<JobSyncCompanyCustomerDetail | null>(null);
  const [loading, setLoading] = useState(validId);
  const [error, setError] = useState<string | null>(validId ? null : "A valid Home Service Connected customer is required.");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!validId) {
      setCustomer(null);
      setLoading(false);
      setError("A valid Home Service Connected customer is required.");
      return;
    }
    setLoading(true);
    try {
      const next = await getJobSyncCompanyCustomer(token, customerId);
      setCustomer(next);
      setForm(toEditForm(next));
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

  const save = useCallback(async () => {
    if (!form || !validId) return;
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setSaveError("First name and last name are required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateJobSyncCompanyCustomer(token, customerId, {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        addressLine1: form.addressLine1,
        city: form.city,
        region: form.region,
        postalCode: form.postalCode,
      });
      setCustomer(updated);
      setForm(toEditForm(updated));
      setEditing(false);
    } catch (updateError) {
      setSaveError(companyCanonicalReadError(updateError));
    } finally {
      setSaving(false);
    }
  }, [customerId, form, token, validId]);

  return (
    <ScreenContainer edges={["left", "right"]} className="flex-1">
      <ScrollView contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 16, paddingTop: 16 }}>
        <View style={{ alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
          <Text style={{ color: colors.foreground, fontSize: 24, fontWeight: "800" }}>Customer</Text>
          {canEdit && customer && !loading && !error ? (
            <TouchableOpacity
              onPress={() => {
                if (editing) {
                  setForm(toEditForm(customer));
                  setSaveError(null);
                }
                setEditing((current) => !current);
              }}
              style={{
                backgroundColor: editing ? colors.surface : colors.primary,
                borderColor: colors.border,
                borderRadius: 10,
                borderWidth: editing ? 1 : 0,
                paddingHorizontal: 14,
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: editing ? colors.foreground : "#FFF", fontSize: 13, fontWeight: "700" }}>
                {editing ? "Cancel" : "Edit"}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
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
        ) : editing && form ? (
          <>
            <EditField label="First name" value={form.firstName} onChange={(firstName) => setForm({ ...form, firstName })} />
            <EditField label="Last name" value={form.lastName} onChange={(lastName) => setForm({ ...form, lastName })} />
            <EditField label="Phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
            <EditField label="Email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
            <EditField label="Address" value={form.addressLine1} onChange={(addressLine1) => setForm({ ...form, addressLine1 })} />
            <EditField label="City" value={form.city} onChange={(city) => setForm({ ...form, city })} />
            <EditField label="Region" value={form.region} onChange={(region) => setForm({ ...form, region })} />
            <EditField label="Postal code" value={form.postalCode} onChange={(postalCode) => setForm({ ...form, postalCode })} />
            {saveError ? (
              <Text style={{ color: colors.error, fontSize: 13, marginBottom: 10 }}>{saveError}</Text>
            ) : null}
            <TouchableOpacity
              onPress={() => { void save(); }}
              disabled={saving}
              style={{
                alignItems: "center",
                backgroundColor: colors.primary,
                borderRadius: 12,
                marginBottom: 16,
                opacity: saving ? 0.7 : 1,
                paddingVertical: 14,
              }}
            >
              {saving ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={{ color: "#FFF", fontSize: 15, fontWeight: "700" }}>Save to Home Service Connected</Text>
              )}
            </TouchableOpacity>
          </>
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
