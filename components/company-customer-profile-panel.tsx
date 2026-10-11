import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

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
  getJobSyncCompanyJobs,
  type JobSyncMobileJob,
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

type ProfileTab = "profile" | "jobs" | "attachments" | "estimates" | "notes";

function formatProfileDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatProfileTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function profileJobStatus(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

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
  const router = useRouter();
  const { session } = useJobSyncAuth();
  const params = useLocalSearchParams<{ customerId?: string }>();
  const customerId = Number(params.customerId);
  const validId = Number.isSafeInteger(customerId) && customerId > 0;
  const canEdit = session?.user?.role === "owner" || session?.user?.role === "dispatcher";
  const [customer, setCustomer] = useState<JobSyncCompanyCustomerDetail | null>(null);
  const [jobs, setJobs] = useState<JobSyncMobileJob[]>([]);
  const [activeTab, setActiveTab] = useState<ProfileTab>("profile");
  const [loading, setLoading] = useState(validId);
  const [jobsLoading, setJobsLoading] = useState(validId);
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
    setJobsLoading(true);
    try {
      const [next, allJobs] = await Promise.all([
        getJobSyncCompanyCustomer(token, customerId),
        getJobSyncCompanyJobs(token),
      ]);
      setCustomer(next);
      setJobs(allJobs.filter((job) => job.customerId === customerId));
      setForm(toEditForm(next));
      setError(null);
    } catch (refreshError) {
      setCustomer(null);
      setJobs([]);
      setError(companyCanonicalReadError(refreshError));
    } finally {
      setLoading(false);
      setJobsLoading(false);
    }
  }, [customerId, token, validId]);

  const nextAppointment = useMemo(() => jobs
    .filter((job) => job.scheduledStartAt && !["completed", "cancelled"].includes(job.status))
    .sort((a, b) => String(a.scheduledStartAt).localeCompare(String(b.scheduledStartAt)))[0], [jobs]);
  const lifetimeValue = useMemo(() => jobs.reduce((sum, job) => sum + Number(job.amount || 0), 0), [jobs]);
  const address = [customer?.addressLine1, customer?.city, customer?.region, customer?.postalCode].filter(Boolean).join(", ");

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
      <ScrollView contentContainerStyle={{ paddingBottom: 48, paddingHorizontal: 16, paddingTop: 10 }}>
        {loading ? <CompanyAuthorityLoading message="Loading Company customer…" /> : error || !customer ? (
          <CompanyAuthorityMessage title="Company customer profile is unavailable" detail={error ?? COMPANY_FINANCIAL_LEGACY_FALLTHROUGH_BLOCKED} />
        ) : (
          <>
            <TouchableOpacity onPress={() => router.back()} style={{ paddingVertical: 8 }}>
              <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "700" }}>← All Customers</Text>
            </TouchableOpacity>
            <View style={{ alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 12, marginTop: 8 }}>
              <View style={{ alignItems: "center", flexDirection: "row", flex: 1, gap: 12 }}>
                <View style={{ alignItems: "center", backgroundColor: colors.primary + "22", borderRadius: 40, height: 64, justifyContent: "center", width: 64 }}><Text style={{ color: colors.primary, fontSize: 28, fontWeight: "800" }}>{customer.firstName.charAt(0).toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}><Text style={{ color: colors.foreground, fontSize: 24, fontWeight: "800" }}>{customer.name}</Text><Text style={{ color: colors.muted, fontSize: 14 }}>{jobs.length} job{jobs.length === 1 ? "" : "s"} · Customer since {formatProfileDate(jobs[jobs.length - 1]?.scheduledStartAt)}</Text></View>
              </View>
              {canEdit && <TouchableOpacity accessibilityRole="button" onPress={() => router.push({ pathname: "/(tabs)/admin-schedule", params: { prefillCustomerId: String(customer.id), prefillFirst: customer.firstName, prefillLast: customer.lastName, prefillPhone: customer.phone ?? "", prefillEmail: customer.email ?? "", prefillAddress: address } } as any)} style={{ alignItems: "center", backgroundColor: colors.primary, borderRadius: 32, height: 56, justifyContent: "center", width: 56 }}><Text style={{ color: "#FFF", fontSize: 30, fontWeight: "300" }}>+</Text></TouchableOpacity>}
            </View>
            {nextAppointment && <View style={{ backgroundColor: colors.primary + "14", borderColor: colors.primary, borderRadius: 14, borderWidth: 1, marginBottom: 14, padding: 14 }}><View style={{ flexDirection: "row", justifyContent: "space-between" }}><View><Text style={{ color: colors.primary, fontSize: 11, fontWeight: "800", letterSpacing: 1 }}>NEXT APPOINTMENT</Text><Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "800", marginTop: 4 }}>{formatProfileDate(nextAppointment.scheduledStartAt)}</Text><Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>{formatProfileTime(nextAppointment.scheduledStartAt)}{nextAppointment.scheduledEndAt ? ` – ${formatProfileTime(nextAppointment.scheduledEndAt)}` : ""}</Text></View><View style={{ alignItems: "flex-end" }}><Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "800" }}>{nextAppointment.serviceName || nextAppointment.title}</Text><Text style={{ backgroundColor: colors.primary + "22", borderRadius: 12, color: colors.primary, fontSize: 12, fontWeight: "700", marginTop: 8, paddingHorizontal: 10, paddingVertical: 5 }}>{profileJobStatus(nextAppointment.status)}</Text></View></View></View>}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderBottomColor: colors.border, borderBottomWidth: 1, marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16 }}>
              {(["profile", "jobs", "attachments", "estimates", "notes"] as ProfileTab[]).map((tab) => <TouchableOpacity key={tab} onPress={() => setActiveTab(tab)} style={{ borderBottomColor: activeTab === tab ? colors.primary : "transparent", borderBottomWidth: 3, paddingHorizontal: 16, paddingVertical: 13 }}><Text style={{ color: activeTab === tab ? colors.primary : colors.muted, fontSize: 16, fontWeight: "700" }}>{tab === "jobs" ? `Jobs (${jobs.length})` : tab.charAt(0).toUpperCase() + tab.slice(1)}</Text></TouchableOpacity>)}
            </ScrollView>

            {activeTab === "profile" && (editing && form ? <View style={{ paddingTop: 16 }}>
              <EditField label="First name" value={form.firstName} onChange={(firstName) => setForm({ ...form, firstName })} /><EditField label="Last name" value={form.lastName} onChange={(lastName) => setForm({ ...form, lastName })} /><EditField label="Phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} /><EditField label="Email" value={form.email} onChange={(email) => setForm({ ...form, email })} /><EditField label="Address" value={form.addressLine1} onChange={(addressLine1) => setForm({ ...form, addressLine1 })} /><EditField label="City" value={form.city} onChange={(city) => setForm({ ...form, city })} /><EditField label="Region" value={form.region} onChange={(region) => setForm({ ...form, region })} /><EditField label="Postal code" value={form.postalCode} onChange={(postalCode) => setForm({ ...form, postalCode })} />{saveError && <Text style={{ color: colors.error, marginBottom: 10 }}>{saveError}</Text>}<TouchableOpacity onPress={() => void save()} disabled={saving} style={{ alignItems: "center", backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14 }}>{saving ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "700" }}>Save customer</Text>}</TouchableOpacity>
            </View> : <View style={{ paddingTop: 16 }}>
              <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, marginBottom: 14, padding: 16 }}><Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "800", marginBottom: 14 }}>Summary</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}><View style={{ minWidth: "42%" }}><Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700" }}>LAST SERVICE</Text><Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700", marginTop: 5 }}>{formatProfileDate(jobs[jobs.length - 1]?.scheduledStartAt)}</Text></View><View style={{ minWidth: "42%" }}><Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700" }}>CUSTOMER SINCE</Text><Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700", marginTop: 5 }}>{formatProfileDate(jobs[jobs.length - 1]?.scheduledStartAt)}</Text></View><View style={{ minWidth: "42%" }}><Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700" }}>LIFETIME VALUE</Text><Text style={{ color: colors.success, fontSize: 22, fontWeight: "800", marginTop: 5 }}>${lifetimeValue.toFixed(2)}</Text></View><View style={{ minWidth: "42%" }}><Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700" }}>TOTAL JOBS</Text><Text style={{ color: colors.foreground, fontSize: 22, fontWeight: "800", marginTop: 5 }}>{jobs.length}</Text></View></View></View>
              <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, marginBottom: 14, padding: 16 }}><View style={{ alignItems: "center", flexDirection: "row", justifyContent: "space-between" }}><Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "800" }}>Contact Info</Text>{canEdit && <TouchableOpacity onPress={() => setEditing(true)} style={{ backgroundColor: colors.primary, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 }}><Text style={{ color: "#FFF", fontWeight: "700" }}>✏️ Edit</Text></TouchableOpacity>}</View><Field label="Phone" value={customer.phone} /><Field label="Email" value={customer.email} /><Field label="Address" value={address} /><TouchableOpacity disabled={!address} onPress={() => { if (address) void Linking.openURL(`https://maps.apple.com/?address=${encodeURIComponent(address)}`); }}><Text style={{ color: colors.primary, fontWeight: "700", marginTop: -4 }}>Open in Maps</Text></TouchableOpacity></View>
              <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, padding: 16 }}><View style={{ alignItems: "center", flexDirection: "row", justifyContent: "space-between" }}><Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "800" }}>Payment Method</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{COMPANY_PAYMENT_CONTROLS.savedCardCharging ? "Available" : "Not connected"}</Text></View><Text style={{ color: colors.muted, fontSize: 13, marginTop: 8 }}>{COMPANY_PAYMENT_CONTROLS.savedCardCharging ? "Add a card on file for faster future payments." : "Card-on-file setup is not connected for this Company yet."}</Text></View>
            </View>)}
            {activeTab === "jobs" && <View style={{ paddingTop: 16 }}><View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, padding: 16 }}>{jobsLoading ? <ActivityIndicator color={colors.primary} /> : jobs.length === 0 ? <Text style={{ color: colors.muted }}>No jobs yet.</Text> : jobs.map((job) => <TouchableOpacity key={job.id} onPress={() => router.push({ pathname: "/(tabs)/admin-schedule", params: { highlightBookingId: String(job.id) } } as any)} style={{ borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 14 }}><View style={{ flexDirection: "row", justifyContent: "space-between" }}><View><Text style={{ color: colors.muted, fontSize: 13 }}>{formatProfileDate(job.scheduledStartAt)}</Text><Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "800", marginTop: 4 }}>{job.serviceName || job.title || "Service"}</Text><Text style={{ color: colors.muted, marginTop: 3 }}>{job.assignedName || "Unassigned"}</Text></View><View style={{ alignItems: "flex-end" }}><Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>{profileJobStatus(job.status)}</Text><Text style={{ color: colors.success, fontSize: 16, fontWeight: "800", marginTop: 14 }}>${Number(job.amount || 0).toFixed(2)}</Text></View></View></TouchableOpacity>)}</View></View>}
            {activeTab === "attachments" && <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, marginTop: 16, padding: 16 }}><Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "800" }}>Attachments (0)</Text><Text style={{ color: colors.muted, fontSize: 14, fontStyle: "italic", marginTop: 14 }}>No attachments yet.</Text></View>}
            {activeTab === "estimates" && <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, marginTop: 16, padding: 16 }}><Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "800" }}>Estimates</Text><Text style={{ color: colors.muted, fontSize: 14, marginTop: 14 }}>No estimates are available for this customer.</Text></View>}
            {activeTab === "notes" && <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, marginTop: 16, padding: 16 }}><Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "800" }}>Notes</Text><Text style={{ color: colors.muted, fontSize: 14, marginTop: 14 }}>No notes yet.</Text></View>}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
