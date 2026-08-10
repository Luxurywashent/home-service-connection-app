import {
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useState, useMemo, useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { AddJobModal } from "@/components/add-job-modal";

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

function fmtDateLong(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    completed: "#22c55e",
    confirmed: "#0a7ea4",
    scheduled: "#0a7ea4",
    in_progress: "#f59e0b",
    cancelled: "#ef4444",
    pending: "#64748b",
  };
  return map[status] ?? "#64748b";
}

type TabKey = "profile" | "jobs" | "attachments" | "estimates" | "notes";

export default function AdminCustomerProfileScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const router = useRouter();

  // Params passed from the list screen
  const params = useLocalSearchParams<{
    fullName: string;
    phone?: string;
    email?: string;
    customerId?: string;
    address?: string;
    city?: string;
    lifetimeValue?: string;
    jobCount?: string;
    lastServiceDate?: string;
    firstServiceDate?: string;
  }>();

  const [activeTab, setActiveTab] = useState<TabKey>("profile");
  const [showAddJobModal, setShowAddJobModal] = useState(false);
  const [selectedJob, setSelectedJob] = useState<any | null>(null);
  const [noteText, setNoteText] = useState("");
  const [localNotes, setLocalNotes] = useState<{ id: string; text: string; createdAt: string }[]>([]);
  const [newEstVehYear, setNewEstVehYear] = useState("");
  const [newEstVehMake, setNewEstVehMake] = useState("");
  const [newEstVehModel, setNewEstVehModel] = useState("");
  const [newEstVehColor, setNewEstVehColor] = useState("");
  const [newEstNotes, setNewEstNotes] = useState("");
  const [newEstLines, setNewEstLines] = useState<{ description: string; qty: string; unitPrice: string }[]>([{ description: "", qty: "1", unitPrice: "" }]);
  const [showEstForm, setShowEstForm] = useState(false);
  const [savingEst, setSavingEst] = useState(false);

  // Map geocoding state
  const [mapCoords, setMapCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mapLoading, setMapLoading] = useState(false);

  const fullAddress = [params.address, params.city].filter(Boolean).join(", ");

  useEffect(() => {
    if (!fullAddress || Platform.OS === "web") return;
    setMapLoading(true);
    const encoded = encodeURIComponent(fullAddress);
    fetch(`https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`, {
      headers: { "User-Agent": "LuxuryWashApp/1.0" },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && data[0]) {
          setMapCoords({
            latitude: parseFloat(data[0].lat),
            longitude: parseFloat(data[0].lon),
          });
        }
      })
      .catch(() => {})
      .finally(() => setMapLoading(false));
  }, [fullAddress]);

  const { data: attachmentsData, isLoading: attachmentsLoading, refetch: refetchAttachments } = trpc.attachments.listForCustomer.useQuery({
    customerName: params.fullName ?? "",
    customerPhone: params.phone ?? null,
    customerEmail: params.email ?? null,
  });

  const { data: estimatesData, isLoading: estimatesLoading, refetch: refetchEstimates } = trpc.estimates.listForCustomer.useQuery({
    customerName: params.fullName ?? "",
    customerPhone: params.phone ?? null,
    customerEmail: params.email ?? null,
  });

  const createEstimateMutation = trpc.estimates.create.useMutation({
    onSuccess: () => { refetchEstimates(); setShowEstForm(false); setSavingEst(false); },
    onError: (e) => { Alert.alert("Error", e.message); setSavingEst(false); },
  });

  const deleteEstimateMutation = trpc.estimates.delete.useMutation({
    onSuccess: () => refetchEstimates(),
  });

  const { data: jobsData, isLoading: jobsLoading, refetch: refetchJobs } = trpc.customers.getJobs.useQuery({
    phone: params.phone ?? null,
    email: params.email ?? null,
    name: params.fullName ?? "",
    customerId: params.customerId ?? null,
  });

  // Merge schedule jobs and online bookings from getCustomerJobs response
  const scheduleJobsList = (jobsData as any)?.scheduleJobsList ?? [];
  const onlineBookingsList = ((jobsData as any)?.onlineBookingsList ?? []).map((b: any) => ({
    jobId: b.bookingId ?? `ob_${b.id}`,
    date: b.bookingDate ?? "",
    timeSlot: b.timeSlot ?? "",
    packageType: b.packageType ?? "",
    vehicleYear: "",
    vehicleMake: "",
    vehicleModel: b.vehicleType ?? "",
    vehicleColor: "",
    assignedTo: "",
    totalPrice: String(b.finalTotal ?? b.totalPrice ?? "0"),
    status: b.status ?? "confirmed",
    customerAddress: [b.streetAddress, b.city, b.state].filter(Boolean).join(", "),
    source: "online" as const,
  }));
  // Deduplicate: suppress schedule_jobs that are mirrors of portal bookings.
  // A portal booking mirrors into schedule_jobs with jobId = portal_<bookingRef>.
  const onlineRefs = new Set<string>(
    onlineBookingsList.map((b: any) => b.jobId).filter(Boolean)
  );
  const onlineDateTimeKeys = new Set<string>(
    onlineBookingsList.map((b: any) => `${b.date ?? ''}|${b.timeSlot ?? ''}|${(b.packageType ?? '').toLowerCase().trim()}`)
  );
  const filteredScheduleJobs = scheduleJobsList.filter((j: any) => {
    const jid = (j.jobId ?? '') as string;
    const oid = (j.onlineBookingId ?? '') as string;
    const refFromJobId = jid.startsWith('portal_') ? jid.replace(/^portal_/, '') : null;
    if (refFromJobId && onlineRefs.has(refFromJobId)) return false;
    if (oid && onlineRefs.has(oid)) return false;
    const key = `${j.date ?? ''}|${j.timeSlot ?? ''}|${(j.packageType ?? '').toLowerCase().trim()}`;
    if (onlineDateTimeKeys.has(key)) return false;
    return true;
  });
  const allJobs = [...filteredScheduleJobs, ...onlineBookingsList].sort((a: any, b: any) =>
    (b.date ?? "").localeCompare(a.date ?? "")
  );
  const today = new Date().toISOString().split("T")[0];

  // Only completed jobs count toward the total jobs count and LTV displayed on the profile
  const completedJobs = useMemo(
    () => allJobs.filter((j) => j.status === "completed"),
    [allJobs]
  );

  const upcomingJobs = useMemo(
    () =>
      allJobs
        .filter((j) => j.date && j.date >= today && j.status !== "cancelled")
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    [allJobs, today]
  );

  const pastJobs = useMemo(
    () =>
      allJobs
        .filter((j) => !j.date || j.date < today || j.status === "cancelled")
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    [allJobs, today]
  );

  // Unique vehicles
  const vehicles = useMemo(() => {
    const map: Record<string, { label: string; color?: string; count: number }> = {};
    allJobs.forEach((j) => {
      const key = [j.vehicleYear, j.vehicleMake, j.vehicleModel].filter(Boolean).join(" ");
      if (!key) return;
      if (!map[key]) map[key] = { label: key, color: j.vehicleColor ?? undefined, count: 0 };
      map[key].count++;
    });
    return Object.values(map);
  }, [allJobs]);

  const handleBack = () => {
    if ((Platform.OS as string) !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.replace("/(tabs)/admin-customers" as any);
  };

  const handleTab = (tab: TabKey) => {
    if ((Platform.OS as string) !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTab(tab);
  };

  const handleSaveEstimate = () => {
    const lineItems = newEstLines
      .filter((l) => l.description.trim())
      .map((l) => ({
        description: l.description.trim(),
        qty: parseFloat(l.qty) || 1,
        unitPrice: parseFloat(l.unitPrice) || 0,
        total: (parseFloat(l.qty) || 1) * (parseFloat(l.unitPrice) || 0),
      }));
    if (!lineItems.length) { Alert.alert("Error", "Add at least one line item"); return; }
    const subtotal = lineItems.reduce((s, l) => s + l.total, 0);
    setSavingEst(true);
    createEstimateMutation.mutate({
      estimateId: "EST-" + Date.now() + "-" + Math.random().toString(36).substring(2, 8),
      customerName: params.fullName ?? "",
      customerPhone: params.phone ?? null,
      customerEmail: params.email ?? null,
      customerAddress: params.address ?? null,
      vehicleYear: newEstVehYear.trim() || null,
      vehicleMake: newEstVehMake.trim() || null,
      vehicleModel: newEstVehModel.trim() || null,
      vehicleColor: newEstVehColor.trim() || null,
      lineItems,
      subtotal,
      total: subtotal,
      notes: newEstNotes.trim() || null,
      createdBy: "Admin",
    });
  };

  const handleSaveNote = () => {
    if (!noteText.trim()) return;
    setLocalNotes((prev) => [
      { id: Date.now().toString(), text: noteText.trim(), createdAt: new Date().toISOString() },
      ...prev,
    ]);
    setNoteText("");
  };

  // Derive jobCount and LTV from all non-cancelled jobs (live, not from passed params which may be stale)
  // Fall back to params when query returns empty (e.g. no DB match) to avoid showing 0 incorrectly
  const liveJobCount = allJobs.filter(j => j.status !== "cancelled").length;
  const liveLtv = allJobs.filter(j => j.status !== "cancelled").reduce((sum, j) => sum + (parseFloat(String(j.totalPrice ?? "0")) || 0), 0);
  const paramJobCount = parseInt(params.jobCount ?? "0") || 0;
  const paramLtv = parseFloat(params.lifetimeValue ?? "0") || 0;
  // Use live data if available (query done and returned results), otherwise fall back to params
  const derivedJobCount = jobsLoading ? paramJobCount : (liveJobCount > 0 ? liveJobCount : paramJobCount);
  const derivedLtv = jobsLoading ? paramLtv : (liveLtv > 0 ? liveLtv : paramLtv);
  const lv = fmtCurrency(String(derivedLtv));
  const jobCount = derivedJobCount;

  // ── Cancel / Delete Job ──
  const cancelJobMutation = trpc.jobs.cancel.useMutation({
    onSuccess: () => { refetchJobs(); setSelectedJob(null); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const deleteJobMutation = trpc.jobs.delete.useMutation({
    onSuccess: () => { refetchJobs(); setSelectedJob(null); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const deleteRecurringSeriesMutation = trpc.jobs.deleteRecurringSeries.useMutation({
    onSuccess: () => { refetchJobs(); setSelectedJob(null); },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const handleCancelJob = (job: any) => {
    Alert.alert(
      "Cancel Job",
      `Mark this job as cancelled? It will remain visible in history with a Cancelled badge.`,
      [
        { text: "Dismiss", style: "cancel" },
        {
          text: "Cancel Job",
          style: "destructive",
          onPress: () => cancelJobMutation.mutate({
            jobId: job.jobId ?? job.id,
            customerName: job.customerName ?? undefined,
            location: job.location ?? undefined,
            dateStr: job.date ?? undefined,
            timeSlot: job.timeSlot ?? undefined,
          }),
        },
      ]
    );
  };

  const handleDeleteJob = (job: any) => {
    const isRecurring = !!(job.recurrenceParentId || job.recurrenceRule);
    if (isRecurring) {
      Alert.alert(
        "Delete Recurring Job",
        "Permanently remove this job from all views? This cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "This Job Only",
            style: "destructive",
            onPress: () => deleteJobMutation.mutate({
              jobId: job.jobId ?? job.id,
              customerName: job.customerName ?? undefined,
              location: job.location ?? undefined,
              dateStr: job.date ?? undefined,
              timeSlot: job.timeSlot ?? undefined,
            }),
          },
          {
            text: "This & All Future",
            style: "destructive",
            onPress: () => deleteRecurringSeriesMutation.mutate({
              recurrenceParentId: job.recurrenceParentId ?? (job.jobId ?? job.id),
              mode: "future",
              fromDate: job.date,
            }),
          },
        ]
      );
    } else {
      Alert.alert(
        "Delete Job",
        `Permanently remove this job for ${job.customerName ?? params.fullName}? This cannot be undone and will remove it from the customer portal and detailer schedule.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete Permanently",
            style: "destructive",
                        onPress: () => deleteJobMutation.mutate({
              jobId: job.jobId ?? job.id,
              customerName: job.customerName ?? undefined,
              location: job.location ?? undefined,
              dateStr: job.date ?? undefined,
              timeSlot: job.timeSlot ?? undefined,
            }),
          },
        ]
      );
    }
  };
  // Card modal state
  // Card state removed — cards are managed via customer portal (Stripe SetupIntent flow)

  // Customer key for saved cards
  const customerKey = params.email
    ? `email:${params.email.toLowerCase()}`
    : params.phone
    ? `phone:${params.phone}`
    : `name:${(params.fullName ?? "").toLowerCase().trim()}`;

  const { data: pbServices = [] } = trpc.pricebook.list.useQuery(undefined, { staleTime: 300000 });
  const resolvePackageName = (packageType: string | null | undefined): string => {
    if (!packageType) return "Service";
    // Try pricebook lookup first (camelCase serviceId from tRPC)
    const pb = (pbServices as any[]).find((s: any) => s.serviceId === packageType || s.service_id === packageType);
    if (pb) return pb.name ?? pb.title ?? packageType;
    // Hardcoded fallback for known package IDs that may not be in pricebook cache yet
    const knownIds: Record<string, string> = {
      pb_luxury: "Luxury Detail",
      pb_full: "Full Detail",
      pb_basic: "Basic Detail",
      pb_interior: "Interior Detail",
      pb_exterior: "Exterior Detail",
      pb_rv_wash: "RV Wash",
      pb_rv_maintenance: "RV Maintenance",
      pb_rv_paint_sealant: "RV Paint Sealant",
      pb_mpn0yohe0qes: "VIP",
      pb_mpssufsvme94: "Maintenance Program",
      pb_mpws9prd5cu1: "VIP Renewal",
    };
    if (knownIds[packageType]) return knownIds[packageType];
    // Generic pb_ slug fallback
    if (packageType.startsWith("pb_")) {
      const slug = packageType.slice(3).replace(/_/g, " ");
      return slug.charAt(0).toUpperCase() + slug.slice(1);
    }
    // Legacy non-pb_ values
    const legacyMap: Record<string, string> = {
      luxury: "Luxury Detail",
      full: "Full Detail",
      basic: "Basic Detail",
      interior: "Interior Detail",
      exterior: "Exterior Detail",
      VIP: "VIP",
      vip: "VIP",
      maintenance: "Maintenance Program",
    };
    return legacyMap[packageType] ?? packageType;
  };
  const { data: savedCards, refetch: refetchCards } = trpc.savedCards.list.useQuery({ customerKey });
  const deleteCardMutation = trpc.savedCards.delete.useMutation({ onSuccess: () => refetchCards() });
  const setDefaultMutation = trpc.savedCards.setDefault.useMutation({ onSuccess: () => refetchCards() });

  // ── Do Not Service ──
  const [showDnsModal, setShowDnsModal] = useState(false);
  const [dnsReason, setDnsReason] = useState("");
  const { data: dnsData, refetch: refetchDns } = trpc.customers.checkDoNotService.useQuery({ customerKey });
  const isDoNotService = dnsData?.doNotService ?? false;
  const setDoNotServiceMutation = trpc.customers.setDoNotService.useMutation({
    onSuccess: () => { refetchDns(); setShowDnsModal(false); setDnsReason(""); },
    onError: (e) => Alert.alert("Error", e.message),
  });

  // ── Send Portal Access ──
  const [sendingPortalAccess, setSendingPortalAccess] = useState(false);
  const sendPortalAccessMutation = trpc.customer.adminSendPortalAccess.useMutation({
    onSuccess: (data) => {
      setSendingPortalAccess(false);
      if ((Platform.OS as string) !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Email Sent ✅", `A portal access setup link has been sent to ${data.email}. They can click it to set their password and log in.`);
    },
    onError: (e) => { setSendingPortalAccess(false); Alert.alert("Error", e.message); },
  });
  const handleSendPortalAccess = () => {
    if (!params.customerId) { Alert.alert("Error", "Customer ID not available. Please reload this profile."); return; }
    if (!params.email) { Alert.alert("No Email", "This customer has no email address on file. Add one first using Edit Contact Info."); return; }
    Alert.alert(
      "Send Portal Access",
      `Send a portal account setup link to ${params.email}? They can click it to set their password and access their bookings online.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Send Email", onPress: () => { setSendingPortalAccess(true); sendPortalAccessMutation.mutate({ customerId: params.customerId ?? customerKey, email: params.email ?? undefined, phone: params.phone ?? undefined }); } },
      ]
    );
  };

  // ── Delete Customer ──
  const deleteCustomerMutation = trpc.customers.adminDelete.useMutation({
    onSuccess: () => router.back(),
    onError: (e) => Alert.alert("Error", e.message),
  });
  const handleDeleteCustomer = () => {
    Alert.alert(
      "Delete Customer",
      `Permanently delete ALL records for ${params.fullName ?? "this customer"}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Forever",
          style: "destructive",
          onPress: () => deleteCustomerMutation.mutate({
            customerKey,
            phone: params.phone ?? null,
            email: params.email ?? null,
            name: params.fullName ?? "",
          }),
        },
      ]
    );
  };

  // ── Edit Contact Info ──
  const [showEditContactModal, setShowEditContactModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [savingContact, setSavingContact] = useState(false);

  const updateContactMutation = trpc.customers.updateContactInfo.useMutation({
    onSuccess: () => {
      setSavingContact(false);
      setShowEditContactModal(false);
      if ((Platform.OS as string) !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved", "Contact information updated. Changes will appear on all jobs and records for this customer.");
    },
    onError: (e) => { setSavingContact(false); Alert.alert("Error", e.message); },
  });

  const handleOpenEditContact = () => {
    setEditName(params.fullName ?? "");
    setEditPhone(params.phone ?? "");
    setEditEmail(params.email ?? "");
    setEditAddress(params.address ?? "");
    setShowEditContactModal(true);
  };

  const handleSaveContact = () => {
    const name = editName.trim();
    if (!name) { Alert.alert("Required", "Name cannot be empty."); return; }
    setSavingContact(true);
    updateContactMutation.mutate({
      phone: params.phone ?? null,
      email: params.email ?? null,
      name: params.fullName ?? "",
      newName: name,
      newPhone: editPhone.trim() || null,
      newEmail: editEmail.trim() || null,
      newAddress: editAddress.trim() || null,
    });
  };

  // ── Charge Card on File ──
  const [showChargeModal, setShowChargeModal] = useState(false);
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargingCard, setChargingCard] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const sendJobReceiptMutation = trpc.jobs.sendReceipt.useMutation();
  const [sendingJobReceipt, setSendingJobReceipt] = useState(false);
  const chargeCardMutation = trpc.savedCards.chargeCard.useMutation({
    onSuccess: (data) => {
      setChargingCard(false);
      setShowChargeModal(false);
      setChargeAmount("");
      if ((Platform.OS as string) !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Payment Successful ✅", `Card charged ${fmtCurrency(parseFloat(chargeAmount) || 0)} successfully.\n\nPayment ID: ${data.paymentIntentId?.slice(-8) ?? "—"}`);
      refetchJobs();
    },
    onError: (e) => { setChargingCard(false); Alert.alert("Charge Failed", e.message); },
  });

  const handleChargeCard = () => {
    const cards = (savedCards as any[]) ?? [];
    if (cards.length === 0) {
      Alert.alert("No Card on File", "This customer has no saved cards. Use \"Send Portal Access\" so they can add a card.");
      return;
    }
    // Pre-fill amount from job total if not already set
    if (!chargeAmount && selectedJob?.totalPrice) {
      setChargeAmount(String(parseFloat(String(selectedJob.totalPrice)).toFixed(2)));
    }
    // Default to the first card
    const defaultCard = cards.find((c: any) => c.isDefault) ?? cards[0];
    setSelectedCardId(defaultCard?.stripePaymentMethodId ?? null);
    setShowChargeModal(true);
  };

  const handleConfirmCharge = () => {
    const cards = (savedCards as any[]) ?? [];
    const card = cards.find((c: any) => c.stripePaymentMethodId === selectedCardId) ?? cards[0];
    if (!card) { Alert.alert("No Card Selected"); return; }
    const amountDollars = parseFloat(chargeAmount);
    if (!amountDollars || amountDollars <= 0) { Alert.alert("Invalid Amount", "Enter a valid charge amount."); return; }
    const amountCents = Math.round(amountDollars * 100);
    Alert.alert(
      "Confirm Charge",
      `Charge ${fmtCurrency(amountDollars)} to ${card.brand?.toUpperCase() ?? "card"} ending in ${card.last4 ?? "????"} for ${params.fullName ?? "this customer"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Charge",
          style: "default",
          onPress: () => {
            setChargingCard(true);
            chargeCardMutation.mutate({
              stripeCustomerId: card.stripeCustomerId,
              stripePaymentMethodId: card.stripePaymentMethodId,
              amountCents,
              description: `Admin charge — ${selectedJob?.packageType ?? "Service"} for ${params.fullName ?? "customer"} (Job ${selectedJob?.jobId ?? ""})`,
            });
          },
        },
      ]
    );
  };

  // ── Live-refresh photos from server whenever a job detail modal is opened ──
  const utils = trpc.useUtils();
  useEffect(() => {
    if (!selectedJob?.jobId) return;
    const jobId = selectedJob.jobId;
    utils.jobs.getPhotos.fetch({ jobId })
      .then(({ urls }) => {
        if (!urls || urls.length === 0) return;
        setSelectedJob((prev: any) => {
          if (!prev || prev.jobId !== jobId) return prev;
          return { ...prev, photoUrls: JSON.stringify(urls) };
        });
      })
      .catch(() => { /* offline or job not found — keep cached data */ });
  }, [selectedJob?.jobId]);

  // ── Admin Add Card on File ──
  const [showAdminAddCardModal, setShowAdminAddCardModal] = useState(false);
  const [adminCardName, setAdminCardName] = useState("");
  const [adminCardNumber, setAdminCardNumber] = useState("");
  const [adminCardExpiry, setAdminCardExpiry] = useState("");
  const [adminCardCvc, setAdminCardCvc] = useState("");
  const [adminCardComplete, setAdminCardComplete] = useState(false);
  const [adminCardSaving, setAdminCardSaving] = useState(false);

  const adminCreateSetupIntentMutation = trpc.savedCards.createSetupIntent.useMutation();
  const adminSaveCardMutation = trpc.savedCards.saveCard.useMutation({
    onSuccess: () => {
      refetchCards();
      setShowAdminAddCardModal(false);
      setAdminCardName(""); setAdminCardNumber(""); setAdminCardExpiry(""); setAdminCardCvc(""); setAdminCardComplete(false);
      if ((Platform.OS as string) !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Card Saved ✅", `Card saved on file for ${params.fullName ?? "this customer"}.`);
    },
    onError: (e) => { setAdminCardSaving(false); Alert.alert("Error", e.message ?? "Could not save card."); },
  });

  const formatCardNumber = (t: string) => {
    const digits = t.replace(/\D/g, "").slice(0, 16);
    return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
  };
  const formatExpiry = (t: string) => {
    const digits = t.replace(/\D/g, "").slice(0, 4);
    if (digits.length > 2) return digits.slice(0, 2) + "/" + digits.slice(2);
    return digits;
  };

  const handleAdminSaveCard = async () => {
    const _constMod = await import("expo-constants");
    const Constants = (_constMod as any).default ?? _constMod;
    const isExpoGo = Constants?.appOwnership === "expo";
    const isNative = Platform.OS !== "web" && !isExpoGo;
    if (isNative) {
      if (!adminCardComplete) { Alert.alert("Incomplete Card", "Please complete all card fields."); return; }
    } else {
      const rawNum = adminCardNumber.replace(/\s/g, "");
      if (rawNum.length < 13) { Alert.alert("Invalid Card", "Please enter a valid card number."); return; }
      if (!adminCardExpiry.match(/^\d{2}\/\d{2}$/)) { Alert.alert("Invalid Expiry", "Please enter expiry as MM/YY."); return; }
      if (adminCardCvc.length < 3) { Alert.alert("Invalid CVC", "Please enter a valid CVC."); return; }
    }
    if (!adminCardName.trim()) { Alert.alert("Missing Name", "Please enter the name on the card."); return; }
    setAdminCardSaving(true);
    try {
      const setupResult = await adminCreateSetupIntentMutation.mutateAsync({
        customerKey,
        customerName: adminCardName.trim(),
        customerEmail: params.email ?? undefined,
      });
      let stripePaymentMethodId: string | null = null;
      let cardLast4: string | null = null;
      let cardBrand: string | null = null;
      if (isNative) {
        try {
          const stripeModule = require("@stripe/stripe-react-native");
          const { confirmSetupIntent, createPaymentMethod } = stripeModule;
          const { paymentMethod, error: pmError } = await createPaymentMethod({ paymentMethodType: "Card" });
          if (pmError) throw new Error(pmError.message);
          stripePaymentMethodId = paymentMethod?.id ?? null;
          cardLast4 = paymentMethod?.card?.last4 ?? null;
          cardBrand = paymentMethod?.card?.brand ?? null;
          if (setupResult.clientSecret && stripePaymentMethodId) {
            await confirmSetupIntent(setupResult.clientSecret, { paymentMethodType: "Card", paymentMethodData: { paymentMethodId: stripePaymentMethodId } });
          }
        } catch (e: any) { throw new Error(e?.message ?? "Could not tokenize card."); }
      } else {
        const rawNum = adminCardNumber.replace(/\s/g, "");
        cardLast4 = rawNum.slice(-4);
        stripePaymentMethodId = `manual_${Date.now()}`;
      }
      if (!stripePaymentMethodId) throw new Error("Could not get payment method.");
      await adminSaveCardMutation.mutateAsync({
        customerKey,
        customerName: adminCardName.trim(),
        customerEmail: params.email ?? undefined,
        customerPhone: params.phone ?? undefined,
        stripeCustomerId: setupResult.stripeCustomerId,
        stripePaymentMethodId,
        ...(cardLast4 ? { cardLast4 } : {}),
        ...(cardBrand ? { cardBrand } : {}),
      });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save card. Please try again.");
    } finally {
      setAdminCardSaving(false);
    }
  };

  const handleOpenCardModal = () => {
    setAdminCardName(params.fullName ?? "");
    setAdminCardNumber(""); setAdminCardExpiry(""); setAdminCardCvc(""); setAdminCardComplete(false);
    setShowAdminAddCardModal(true);
  };
  const firstDate = fmtDate(params.firstServiceDate);
  const lastDate = fmtDate(params.lastServiceDate);

  return (
    <ScreenContainer edges={["left", "right"]} className="flex-1">
      {/* Back button */}
      <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.7}>
        <Text style={styles.backBtnText}>← All Customers</Text>
      </TouchableOpacity>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(params.fullName ?? "?").charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName}>{params.fullName ?? "—"}</Text>
          <Text style={styles.headerSub}>
            {jobCount} job{jobCount !== 1 ? "s" : ""} · Customer since {firstDate}
          </Text>
        </View>
        {/* Create Job shortcut — top-right corner */}
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowAddJobModal(true);
          }}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 8, elevation: 4 }}
          activeOpacity={0.8}
        >
          <Text style={{ color: "#fff", fontSize: 24, fontWeight: "300", lineHeight: 28, marginTop: -1 }}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Next Upcoming Appointment Banner */}
      {upcomingJobs.length > 0 && (() => {
        const next = upcomingJobs[0];
        return (
          <View style={styles.nextApptBanner}>
            <View style={styles.nextApptLeft}>
              <Text style={styles.nextApptLabel}>NEXT APPOINTMENT</Text>
              <Text style={styles.nextApptDate}>{fmtDateLong(next.date)}</Text>
              {next.timeSlot ? <Text style={styles.nextApptTime}>{next.timeSlot}</Text> : null}
            </View>
            <View style={styles.nextApptRight}>
              <Text style={styles.nextApptService} numberOfLines={2}>{resolvePackageName(next.packageType)}</Text>
              <View style={[styles.statusPill, { backgroundColor: statusColor(next.status) + "22", marginTop: 4 }]}>
                <Text style={[styles.statusText, { color: statusColor(next.status) }]}>{next.status.replace("_", " ")}</Text>
              </View>
            </View>
          </View>
        );
      })()}

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderBottomWidth: 1, borderBottomColor: colors.border, marginHorizontal: 16, flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ flexGrow: 0 }}>
        <View style={{ flexDirection: "row" }}>
          {(["profile", "jobs", "attachments", "estimates", "notes"] as TabKey[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabItem, activeTab === tab && styles.tabItemActive]}
              onPress={() => handleTab(tab)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === "jobs" && allJobs.length > 0 ? ` (${allJobs.length})` : ""}
                {tab === "estimates" && (estimatesData?.length ?? 0) > 0 ? ` (${estimatesData?.length})` : ""}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Tab Content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {activeTab === "profile" && (
          <>
            {/* Map */}
            {fullAddress && (Platform.OS as string) !== "web" && (
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>Location</Text>
                  <TouchableOpacity
                    onPress={() => {
                      const q = encodeURIComponent(fullAddress);
                      const url = Platform.OS === "ios"
                        ? `maps://?q=${q}`
                        : `geo:0,0?q=${q}`;
                      Linking.openURL(url);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>Open in Maps</Text>
                  </TouchableOpacity>
                </View>
                {mapLoading ? (
                  <View style={{ height: 180, justifyContent: "center", alignItems: "center" }}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>Loading map...</Text>
                  </View>
                ) : mapCoords ? (
                  <MapView
              provider={(Platform.OS as string) !== "web" ? PROVIDER_GOOGLE : undefined}
                    style={{ width: "100%", height: 180, borderRadius: 10, overflow: "hidden" }}
                    initialRegion={{
                      latitude: mapCoords.latitude,
                      longitude: mapCoords.longitude,
                      latitudeDelta: 0.01,
                      longitudeDelta: 0.01,
                    }}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    pitchEnabled={false}
                    rotateEnabled={false}
                    pointerEvents="none"
                  >
                    <Marker
                      coordinate={mapCoords}
                      title={params.fullName ?? "Customer"}
                      description={fullAddress}
                    />
                  </MapView>
                ) : (
                  <View style={{ height: 60, justifyContent: "center", alignItems: "center" }}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>Could not load map for this address</Text>
                  </View>
                )}
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 8 }}>{fullAddress}</Text>
              </View>
            )}

            {/* Summary Card */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Summary</Text>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>LAST SERVICE</Text>
                  <Text style={styles.summaryValue}>{lastDate}</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>CUSTOMER SINCE</Text>
                  <Text style={styles.summaryValue}>{firstDate}</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>LIFETIME VALUE</Text>
                  <Text style={[styles.summaryValue, { color: colors.success, fontSize: 20 }]}>{lv}</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>TOTAL JOBS</Text>
                  <Text style={styles.summaryValue}>{jobCount}</Text>
                </View>
              </View>
            </View>

            {/* Contact Info */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>Contact Info</Text>
                <TouchableOpacity
                  onPress={handleOpenEditContact}
                  style={{ backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 }}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>✏️ Edit</Text>
                </TouchableOpacity>
              </View>
              {params.phone ? (
                <TouchableOpacity
                  style={styles.contactRow}
                  onPress={() => Linking.openURL(`tel:${params.phone}`)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.contactIcon}>📞</Text>
                  <View>
                    <Text style={styles.contactLabel}>PHONE</Text>
                    <Text style={[styles.contactValue, { color: colors.primary }]}>{params.phone}</Text>
                  </View>
                </TouchableOpacity>
              ) : null}
              {params.email ? (
                <TouchableOpacity
                  style={styles.contactRow}
                  onPress={() => Linking.openURL(`mailto:${params.email}`)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.contactIcon}>✉️</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contactLabel}>EMAIL</Text>
                    <Text style={[styles.contactValue, { color: colors.primary }]} numberOfLines={1}>{params.email}</Text>
                  </View>
                </TouchableOpacity>
              ) : null}
              {params.address ? (
                <View style={styles.contactRow}>
                  <Text style={styles.contactIcon}>📍</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contactLabel}>ADDRESS</Text>
                    <Text style={styles.contactValue}>{params.address}</Text>
                  </View>
                </View>
              ) : null}
              {!params.phone && !params.email && !params.address ? (
                <Text style={styles.noData}>No contact info on file</Text>
              ) : null}
            </View>

            {/* Upcoming Appointments */}
            {upcomingJobs.length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>Upcoming Appointments</Text>
                  <Text style={styles.cardSubtitle}>Next {Math.min(upcomingJobs.length, 5)} of {upcomingJobs.length}</Text>
                </View>
                {upcomingJobs.slice(0, 5).map((job) => (
                  <TouchableOpacity key={job.jobId} style={styles.apptRow} onPress={() => setSelectedJob(job)} activeOpacity={0.75}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.apptDate}>{fmtDateLong(job.date)}</Text>
                      <Text style={styles.apptService}>{resolvePackageName(job.packageType)}</Text>
                      {job.timeSlot ? <Text style={styles.apptTime}>{job.timeSlot}</Text> : null}
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: statusColor(job.status) + "22" }]}>
                      <Text style={[styles.statusText, { color: statusColor(job.status) }]}>
                        {job.status.replace("_", " ")}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Vehicles */}
            {vehicles.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Vehicles</Text>
                {vehicles.map((v) => (
                  <View key={v.label} style={styles.vehicleRow}>
                    <Text style={styles.vehicleLabel}>
                      {v.label}{v.color ? ` (${v.color})` : ""}
                    </Text>
                    <Text style={styles.vehicleCount}>{v.count} service{v.count !== 1 ? "s" : ""}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Do Not Service Banner */}
            {isDoNotService && (
              <View style={{ backgroundColor: "#EF444422", borderWidth: 1.5, borderColor: "#EF4444", borderRadius: 14, padding: 14, marginBottom: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ fontSize: 20 }}>🚫</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#EF4444", fontWeight: "800", fontSize: 14 }}>Do Not Service</Text>
                  <Text style={{ color: "#EF4444", fontSize: 12, marginTop: 2, opacity: 0.8 }}>This customer is blocked from booking appointments.</Text>
                </View>
              </View>
            )}

            {/* Payment Method */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>💳 Payment Method</Text>
                <TouchableOpacity
                  onPress={handleOpenCardModal}
                  style={{ backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 }}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>+ Add Card</Text>
                </TouchableOpacity>
              </View>

              {(savedCards ?? []).length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 20 }}>
                  <Text style={{ fontSize: 32, marginBottom: 8 }}>💳</Text>
                  <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14, marginBottom: 4 }}>No Cards Saved</Text>
                  <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center", lineHeight: 18 }}>
                    Tap "+ Add Card" to save a card on file for this customer.
                  </Text>
                </View>
              ) : (
                (savedCards ?? []).map((card) => (
                  <View key={card.methodId} style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.background, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: card.isDefault ? colors.primary + "66" : colors.border }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14, textTransform: "capitalize" }}>
                          {card.cardBrand ?? "Card"}
                        </Text>
                        {card.isDefault === 1 && (
                          <View style={{ backgroundColor: colors.primary + "22", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                            <Text style={{ color: colors.primary, fontSize: 10, fontWeight: "700" }}>DEFAULT</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>
                        {"•••• •••• •••• "}{card.cardLast4 ?? "????"}{" · "}{card.cardExpMonth}/{card.cardExpYear}
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {card.isDefault !== 1 && (
                        <TouchableOpacity
                          onPress={() => setDefaultMutation.mutate({ customerKey, methodId: card.methodId })}
                          style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primary + "22" }}
                          activeOpacity={0.7}
                        >
                          <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "600" }}>Default</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onPress={() => Alert.alert("Remove Card", `Remove the ${card.cardBrand} ending in ${card.cardLast4}?`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Remove", style: "destructive", onPress: () => deleteCardMutation.mutate({ methodId: card.methodId, stripePaymentMethodId: card.stripePaymentMethodId }) },
                        ])}
                        style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#EF444422" }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: "#EF4444", fontSize: 12, fontWeight: "600" }}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>
            {/* Admin Actions */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Admin Actions</Text>

              {/* Create Job shortcut */}
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowAddJobModal(true);
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: colors.primary + "18", borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.primary + "44" }}
                activeOpacity={0.75}
              >
                <Text style={{ fontSize: 20 }}>📅</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", fontSize: 14, color: colors.primary }}>Create Job</Text>
                  <Text style={{ fontSize: 12, color: colors.primary, opacity: 0.75, marginTop: 2 }}>Schedule a new job for this customer</Text>
                </View>
                <Text style={{ color: colors.primary, fontSize: 18 }}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  if (isDoNotService) {
                    Alert.alert(
                      "Remove Do Not Service",
                      `Allow ${params.fullName ?? "this customer"} to book appointments again?`,
                      [
                        { text: "Cancel", style: "cancel" },
                        { text: "Remove Flag", onPress: () => setDoNotServiceMutation.mutate({ customerKey, remove: true }) },
                      ]
                    );
                  } else {
                    setDnsReason("");
                    setShowDnsModal(true);
                  }
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: isDoNotService ? "#22C55E22" : "#EF444422", borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: isDoNotService ? "#22C55E66" : "#EF444466" }}
                activeOpacity={0.75}
              >
                <Text style={{ fontSize: 20 }}>{isDoNotService ? "✅" : "🚫"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", fontSize: 14, color: isDoNotService ? "#22C55E" : "#EF4444" }}>
                    {isDoNotService ? "Remove Do Not Service" : "Mark Do Not Service"}
                  </Text>
                  <Text style={{ fontSize: 12, color: isDoNotService ? "#22C55E" : "#EF4444", opacity: 0.8, marginTop: 2 }}>
                    {isDoNotService ? "Re-enable booking for this customer" : "Block this customer from booking"}
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Send Portal Access */}
              {params.email ? (
                <TouchableOpacity
                  onPress={handleSendPortalAccess}
                  disabled={sendingPortalAccess}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: "#0a7ea422", borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: "#0a7ea466", opacity: sendingPortalAccess ? 0.6 : 1 }}
                  activeOpacity={0.75}
                >
                  <Text style={{ fontSize: 20 }}>🔑</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: 14, color: "#0a7ea4" }}>
                      {sendingPortalAccess ? "Sending..." : "Send Portal Access"}
                    </Text>
                    <Text style={{ fontSize: 12, color: "#0a7ea4", opacity: 0.75, marginTop: 2 }}>Email a login setup link to {params.email}</Text>
                  </View>
                  <Text style={{ color: "#0a7ea4", fontSize: 18 }}>›</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                onPress={handleDeleteCustomer}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: "#EF444411", borderRadius: 12, borderWidth: 1, borderColor: "#EF444433" }}
                activeOpacity={0.75}
              >
                <Text style={{ fontSize: 20 }}>🗑️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", fontSize: 14, color: "#EF4444" }}>Delete Customer</Text>
                  <Text style={{ fontSize: 12, color: "#EF4444", opacity: 0.7, marginTop: 2 }}>Permanently remove all jobs and records</Text>
                </View>
              </TouchableOpacity>
            </View>
          </>
        )}

        {activeTab === "jobs" && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>{allJobs.length} Jobs</Text>
              <Text style={[styles.cardSubtitle, { color: colors.success, fontWeight: "700" }]}>{lv} total</Text>
            </View>
            {jobsLoading ? (
              <Text style={styles.noData}>Loading jobs...</Text>
            ) : allJobs.length === 0 ? (
              <Text style={styles.noData}>No jobs found</Text>
            ) : (
              allJobs.map((job) => {
                const vehicle = [job.vehicleYear, job.vehicleMake, job.vehicleModel].filter(Boolean).join(" ");
                return (
                  <TouchableOpacity key={job.jobId} style={styles.jobCard} onPress={() => setSelectedJob(job)} activeOpacity={0.75}>
                    <View style={styles.jobCardTop}>
                      <Text style={styles.jobDate}>{fmtDate(job.date)}</Text>
                      <View style={[styles.statusPill, { backgroundColor: statusColor(job.status) + "22" }]}>
                        <Text style={[styles.statusText, { color: statusColor(job.status) }]}>
                          {job.status.replace("_", " ")}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.jobService}>{resolvePackageName(job.packageType)}</Text>
                    {vehicle ? (
                      <Text style={styles.jobVehicle}>
                        {vehicle}{job.vehicleColor ? ` (${job.vehicleColor})` : ""}
                      </Text>
                    ) : null}
                    <View style={styles.jobCardBottom}>
                      <Text style={styles.jobDetailer}>{job.assignedTo ?? "Unassigned"}</Text>
                      <Text style={styles.jobPrice}>{fmtCurrency(job.totalPrice)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}

        {activeTab === "attachments" && (() => {
          // Extract before/after photos from completed jobs, grouped by date
          const jobPhotos: { date: string; photos: string[]; jobId: string; packageType: string }[] = [];
          for (const j of allJobs) {
            const raw = (j as any).photoUrls;
            if (!raw) continue;
            let urls: string[] = [];
            try { urls = JSON.parse(raw); } catch { continue; }
            if (urls.length > 0) {
              jobPhotos.push({ date: j.date ?? "", photos: urls, jobId: (j as any).jobId ?? "", packageType: (j as any).packageType ?? "" });
            }
          }
          jobPhotos.sort((a, b) => b.date.localeCompare(a.date));
          const totalJobPhotos = jobPhotos.reduce((sum, g) => sum + g.photos.length, 0);
          const totalCount = totalJobPhotos + (attachmentsData?.length ?? 0);

          const formatJobDate = (dateStr: string) => {
            if (!dateStr) return "Unknown date";
            const d = new Date(dateStr + "T12:00:00");
            return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
          };

          return (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Attachments ({totalCount})</Text>
              {jobsLoading && attachmentsLoading ? (
                <Text style={styles.noData}>Loading...</Text>
              ) : totalCount === 0 ? (
                <Text style={styles.noData}>No attachments yet.</Text>
              ) : (
                <View style={{ gap: 16 }}>
                  {/* Job Photos grouped by date */}
                  {jobPhotos.map((group) => (
                    <View key={group.jobId + group.date} style={{ gap: 8 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>
                          {formatJobDate(group.date)}
                        </Text>
                        <Text style={{ fontSize: 11, color: colors.muted }}>
                          {group.packageType} · {group.photos.length} photo{group.photos.length !== 1 ? "s" : ""}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {group.photos.map((url, idx) => (
                          <TouchableOpacity
                            key={`${group.jobId}-${idx}`}
                            onPress={() => Linking.openURL(url)}
                            activeOpacity={0.8}
                            style={{ width: 100, height: 80, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}
                          >
                            <Image source={{ uri: url }} style={{ width: 100, height: 80 }} resizeMode="cover" />
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  ))}

                  {/* Manual attachments (uploaded separately) */}
                  {(attachmentsData?.length ?? 0) > 0 && (
                    <View style={{ gap: 8 }}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>Uploaded Files</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                        {attachmentsData!.map((a) => {
                          const isImg = (a.mimeType ?? "").startsWith("image/");
                          return (
                            <TouchableOpacity
                              key={a.attachmentId}
                              onPress={() => Linking.openURL(a.fileUrl)}
                              activeOpacity={0.8}
                              style={{ width: 100, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}
                            >
                              {isImg ? (
                                <Image source={{ uri: a.fileUrl }} style={{ width: 100, height: 80 }} resizeMode="cover" />
                              ) : (
                                <View style={{ width: 100, height: 80, justifyContent: "center", alignItems: "center", backgroundColor: colors.surface }}>
                                  <Text style={{ fontSize: 28 }}>📄</Text>
                                </View>
                              )}
                              <View style={{ padding: 6 }}>
                                <Text style={{ fontSize: 10, color: colors.muted }} numberOfLines={1}>{a.fileName}</Text>
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>
          );
        })()}

        {activeTab === "estimates" && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Estimates</Text>
              <TouchableOpacity
                style={[styles.saveNoteBtn, { marginBottom: 0, paddingVertical: 6, paddingHorizontal: 14 }]}
                onPress={() => setShowEstForm((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.saveNoteBtnText}>{showEstForm ? "Cancel" : "+ New"}</Text>
              </TouchableOpacity>
            </View>

            {showEstForm && (
              <View style={{ marginBottom: 16, padding: 14, backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
                <Text style={[styles.cardTitle, { marginBottom: 10 }]}>New Estimate</Text>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                  <TextInput style={[styles.noteInput, { flex: 1, marginBottom: 0 }]} placeholder="Year" placeholderTextColor={colors.muted} value={newEstVehYear} onChangeText={setNewEstVehYear} />
                  <TextInput style={[styles.noteInput, { flex: 2, marginBottom: 0 }]} placeholder="Make" placeholderTextColor={colors.muted} value={newEstVehMake} onChangeText={setNewEstVehMake} />
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                  <TextInput style={[styles.noteInput, { flex: 2, marginBottom: 0 }]} placeholder="Model" placeholderTextColor={colors.muted} value={newEstVehModel} onChangeText={setNewEstVehModel} />
                  <TextInput style={[styles.noteInput, { flex: 1, marginBottom: 0 }]} placeholder="Color" placeholderTextColor={colors.muted} value={newEstVehColor} onChangeText={setNewEstVehColor} />
                </View>
                <Text style={[styles.summaryLabel, { marginBottom: 6 }]}>LINE ITEMS</Text>
                {newEstLines.map((line, i) => (
                  <View key={i} style={{ flexDirection: "row", gap: 6, marginBottom: 6 }}>
                    <TextInput style={[styles.noteInput, { flex: 3, marginBottom: 0 }]} placeholder="Description" placeholderTextColor={colors.muted} value={line.description} onChangeText={(v) => setNewEstLines((ls) => ls.map((l, j) => j === i ? { ...l, description: v } : l))} />
                    <TextInput style={[styles.noteInput, { flex: 1, marginBottom: 0 }]} placeholder="$" placeholderTextColor={colors.muted} keyboardType="decimal-pad" value={line.unitPrice} onChangeText={(v) => setNewEstLines((ls) => ls.map((l, j) => j === i ? { ...l, unitPrice: v } : l))} />
                    {newEstLines.length > 1 && (
                      <TouchableOpacity onPress={() => setNewEstLines((ls) => ls.filter((_, j) => j !== i))} style={{ justifyContent: "center", paddingHorizontal: 4 }}>
                        <Text style={{ color: colors.error, fontSize: 18 }}>×</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                <TouchableOpacity onPress={() => setNewEstLines((ls) => [...ls, { description: "", qty: "1", unitPrice: "" }])} style={{ marginBottom: 10 }}>
                  <Text style={{ color: colors.primary, fontSize: 13 }}>+ Add line</Text>
                </TouchableOpacity>
                <View style={{ alignItems: "flex-end", marginBottom: 10 }}>
                  <Text style={{ fontSize: 16, fontWeight: "800", color: colors.success }}>
                    Total: {fmtCurrency(newEstLines.reduce((s, l) => s + (parseFloat(l.qty) || 1) * (parseFloat(l.unitPrice) || 0), 0))}
                  </Text>
                </View>
                <TextInput style={[styles.noteInput, { marginBottom: 10 }]} placeholder="Notes for customer (optional)" placeholderTextColor={colors.muted} value={newEstNotes} onChangeText={setNewEstNotes} multiline />
                <TouchableOpacity
                  style={[styles.saveNoteBtn, savingEst && { opacity: 0.5 }]}
                  onPress={handleSaveEstimate}
                  disabled={savingEst}
                  activeOpacity={0.7}
                >
                  <Text style={styles.saveNoteBtnText}>{savingEst ? "Saving..." : "Save Estimate"}</Text>
                </TouchableOpacity>
              </View>
            )}

            {estimatesLoading ? (
              <Text style={styles.noData}>Loading...</Text>
            ) : !estimatesData?.length ? (
              <Text style={styles.noData}>No estimates yet. Tap + New to create one.</Text>
            ) : (
              estimatesData.map((e) => {
                const statusColors: Record<string, string> = { draft: colors.muted, sent: colors.primary, viewed: "#a78bfa", accepted: colors.success, declined: colors.error, expired: colors.warning };
                const sc = statusColors[e.status] ?? colors.muted;
                return (
                  <View key={e.estimateId} style={{ padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 10, marginBottom: 10, backgroundColor: colors.background }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <Text style={{ fontWeight: "700", fontSize: 14, color: colors.foreground }}>Estimate #{e.estimateNumber}</Text>
                      <View style={{ backgroundColor: sc + "22", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 }}>
                        <Text style={{ color: sc, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>{e.status}</Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>{fmtDate(e.createdAt?.toString())}</Text>
                    <Text style={{ fontSize: 18, fontWeight: "800", color: colors.success, marginBottom: 10 }}>{fmtCurrency(e.total)}</Text>
                    {e.status === "draft" && (
                      <TouchableOpacity
                        onPress={() => Alert.alert("Delete Estimate", "Are you sure?", [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => deleteEstimateMutation.mutate({ estimateId: e.estimateId }) },
                        ])}
                        style={{ alignSelf: "flex-start" }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: colors.error, fontSize: 13 }}>Delete</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}

        {activeTab === "notes" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Private Notes</Text>
            <TextInput
              style={styles.noteInput}
              placeholder="Add a note about this customer..."
              placeholderTextColor={colors.muted}
              value={noteText}
              onChangeText={setNoteText}
              multiline
              numberOfLines={3}
              returnKeyType="default"
            />
            <TouchableOpacity
              style={[styles.saveNoteBtn, !noteText.trim() && { opacity: 0.4 }]}
              onPress={handleSaveNote}
              activeOpacity={0.7}
              disabled={!noteText.trim()}
            >
              <Text style={styles.saveNoteBtnText}>Save Note</Text>
            </TouchableOpacity>
            {localNotes.length === 0 ? (
              <Text style={[styles.noData, { marginTop: 16 }]}>No notes yet. Add the first note above.</Text>
            ) : (
              localNotes.map((n) => (
                <View key={n.id} style={styles.noteCard}>
                  <Text style={styles.noteText}>{n.text}</Text>
                  <Text style={styles.noteDate}>
                    {new Date(n.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
              ))
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Add Job Modal ── */}
      <AddJobModal
        visible={showAddJobModal}
        onClose={() => setShowAddJobModal(false)}
        onSaved={() => setShowAddJobModal(false)}
        prefill={{
          firstName: (params.fullName ?? "").trim().split(" ")[0] ?? "",
          lastName: (params.fullName ?? "").trim().split(" ").slice(1).join(" "),
          phone: params.phone ?? "",
          email: params.email ?? "",
          address: params.address ?? "",
        }}
      />

      {/* ── Do Not Service Modal ── */}
      <Modal
        visible={showDnsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDnsModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 24, width: "100%", maxWidth: 360, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 20, elevation: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: "800", color: "#EF4444", marginBottom: 4 }}>🚫 Do Not Service</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 20, lineHeight: 18 }}>
              {params.fullName ?? "This customer"} will be blocked from booking appointments. Add a reason (optional).
            </Text>
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 6, letterSpacing: 0.5 }}>REASON (OPTIONAL)</Text>
            <TextInput
              style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 15, color: colors.foreground, marginBottom: 24, minHeight: 80, textAlignVertical: "top" }}
              placeholder="e.g. No-show, rude behavior, chargeback..."
              placeholderTextColor={colors.muted}
              value={dnsReason}
              onChangeText={setDnsReason}
              multiline
            />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <TouchableOpacity
                onPress={() => setShowDnsModal(false)}
                style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.border, alignItems: "center" }}
                activeOpacity={0.7}
              >
                <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setDoNotServiceMutation.mutate({
                  customerKey,
                  fullName: params.fullName ?? undefined,
                  phone: params.phone ?? null,
                  email: params.email ?? null,
                  reason: dnsReason.trim() || undefined,
                  addedBy: "Admin",
                })}
                disabled={setDoNotServiceMutation.isPending}
                style={{ flex: 2, padding: 14, borderRadius: 12, backgroundColor: "#EF4444", alignItems: "center", opacity: setDoNotServiceMutation.isPending ? 0.6 : 1 }}
                activeOpacity={0.8}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{setDoNotServiceMutation.isPending ? "Saving..." : "Confirm"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Job Detail Modal ── */}
      <Modal
        visible={!!selectedJob}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedJob(null)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: "90%" }}>
            {/* Handle bar */}
            <View style={{ width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: "center", marginBottom: 20 }} />

            {/* Header */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground }}>{resolvePackageName(selectedJob?.packageType)}</Text>
                <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>{fmtDateLong(selectedJob?.date)}</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: statusColor(selectedJob?.status ?? "") + "22" }]}>
                <Text style={[styles.statusText, { color: statusColor(selectedJob?.status ?? "") }]}>
                  {(selectedJob?.status ?? "").replace("_", " ")}
                </Text>
              </View>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Time */}
              {selectedJob?.timeSlot ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ fontSize: 14, color: colors.muted }}>Time</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{selectedJob.timeSlot}</Text>
                </View>
              ) : null}

              {/* Vehicle */}
              {[selectedJob?.vehicleYear, selectedJob?.vehicleMake, selectedJob?.vehicleModel].filter(Boolean).length > 0 ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ fontSize: 14, color: colors.muted }}>Vehicle</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, textAlign: "right", flex: 1, marginLeft: 16 }}>
                    {[selectedJob?.vehicleYear, selectedJob?.vehicleMake, selectedJob?.vehicleModel].filter(Boolean).join(" ")}
                    {selectedJob?.vehicleColor ? ` (${selectedJob.vehicleColor})` : ""}
                  </Text>
                </View>
              ) : null}

              {/* Detailer */}
              {selectedJob?.assignedTo ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ fontSize: 14, color: colors.muted }}>Detailer</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{selectedJob.assignedTo}</Text>
                </View>
              ) : null}

              {/* Location */}
              {selectedJob?.location ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ fontSize: 14, color: colors.muted }}>Location</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, textTransform: "capitalize" }}>{selectedJob.location}</Text>
                </View>
              ) : null}

              {/* Address */}
              {selectedJob?.customerAddress ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ fontSize: 14, color: colors.muted }}>Address</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, textAlign: "right", flex: 1, marginLeft: 16 }}>{selectedJob.customerAddress}</Text>
                </View>
              ) : null}

              {/* Add-ons */}
              {(() => {
                try {
                  const addons = selectedJob?.selectedAddons ? JSON.parse(selectedJob.selectedAddons) : [];
                  if (addons.length > 0) return (
                    <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <Text style={{ fontSize: 14, color: colors.muted, marginBottom: 6 }}>Add-ons</Text>
                      {addons.map((a: any, i: number) => (
                        <Text key={i} style={{ fontSize: 13, color: colors.foreground, marginBottom: 2 }}>• {typeof a === "string" ? a : (a.name ?? a.id ?? JSON.stringify(a))}</Text>
                      ))}
                    </View>
                  );
                } catch {}
                return null;
              })()}

              {/* Pricing breakdown */}
              <View style={{ marginTop: 16, backgroundColor: colors.background, borderRadius: 14, padding: 16 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, letterSpacing: 0.5, marginBottom: 12 }}>PRICING</Text>
                {parseFloat(String(selectedJob?.discountAmount ?? "0")) > 0 ? (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                    <Text style={{ fontSize: 14, color: colors.muted }}>Discount{selectedJob?.discountCode ? ` (${selectedJob.discountCode})` : ""}</Text>
                    <Text style={{ fontSize: 14, color: "#22c55e" }}>-{fmtCurrency(selectedJob?.discountAmount)}</Text>
                  </View>
                ) : null}
                {parseFloat(String(selectedJob?.taxAmount ?? "0")) > 0 ? (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                    <Text style={{ fontSize: 14, color: colors.muted }}>Tax</Text>
                    <Text style={{ fontSize: 14, color: colors.foreground }}>{fmtCurrency(selectedJob?.taxAmount)}</Text>
                  </View>
                ) : null}
                {parseFloat(String(selectedJob?.tips ?? "0")) > 0 ? (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                    <Text style={{ fontSize: 14, color: colors.muted }}>Tip</Text>
                    <Text style={{ fontSize: 14, color: colors.foreground }}>{fmtCurrency(selectedJob?.tips)}</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4 }}>
                  <Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground }}>Total</Text>
                  <Text style={{ fontSize: 16, fontWeight: "800", color: colors.primary }}>{fmtCurrency(selectedJob?.totalPrice)}</Text>
                </View>
                {selectedJob?.paymentMethod ? (
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 6, textAlign: "right" }}>Paid via {selectedJob.paymentMethod.replace("_", " ")}</Text>
                ) : null}
                {/* Charge Card button — only show if job is not already paid */}
                {!selectedJob?.paymentMethod && (
                  <TouchableOpacity
                    onPress={handleChargeCard}
                    style={{ marginTop: 14, padding: 14, backgroundColor: "#22c55e15", borderRadius: 14, alignItems: "center", borderWidth: 1, borderColor: "#22c55e40" }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontSize: 14, fontWeight: "700", color: "#22c55e" }}>💳 Charge Card on File</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Notes */}
              {selectedJob?.notes ? (
                <View style={{ marginTop: 16 }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, letterSpacing: 0.5, marginBottom: 6 }}>NOTES</Text>
                  <Text style={{ fontSize: 14, color: colors.foreground, lineHeight: 20 }}>{selectedJob.notes}</Text>
                </View>
              ) : null}

              {/* Lead source */}
              {selectedJob?.leadSource ? (
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 16, textAlign: "center" }}>Source: {selectedJob.leadSource}</Text>
              ) : null}

              {/* Photos — always fetch fresh from server when job opens */}
              {(() => {
                let photos: string[] = [];
                try {
                  const raw = selectedJob?.photoUrls;
                  if (Array.isArray(raw)) photos = raw;
                  else if (typeof raw === "string" && raw.trim().startsWith("[")) photos = JSON.parse(raw);
                } catch {}
                if (photos.length > 0) return (
                  <View style={{ marginTop: 20 }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, letterSpacing: 0.5, marginBottom: 10 }}>BEFORE & AFTER PHOTOS ({photos.length})</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        {photos.map((url: string, i: number) => (
                          <TouchableOpacity key={`${url}-${i}`} onPress={() => Linking.openURL(url)} activeOpacity={0.85}>
                            <Image
                              source={{ uri: url }}
                              style={{ width: 110, height: 85, borderRadius: 10, backgroundColor: colors.border }}
                              resizeMode="cover"
                            />
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                );
                return null;
              })()}

              {/* Videos */}
              {(() => {
                try {
                  const videos = selectedJob?.videoUrls ? JSON.parse(selectedJob.videoUrls) : [];
                  if (videos.length > 0) return (
                    <View style={{ marginTop: 16 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, letterSpacing: 0.5, marginBottom: 10 }}>VIDEOS</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={{ flexDirection: "row", gap: 10 }}>
                          {videos.map((url: string, i: number) => (
                            <TouchableOpacity
                              key={i}
                              onPress={() => Linking.openURL(url)}
                              activeOpacity={0.85}
                              style={{ width: 110, height: 85, borderRadius: 10, backgroundColor: colors.border, justifyContent: "center", alignItems: "center" }}
                            >
                              <Text style={{ fontSize: 28 }}>▶️</Text>
                              <Text style={{ fontSize: 10, color: colors.muted, marginTop: 4 }}>Video {i + 1}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView>
                    </View>
                  );
                } catch {}
                return null;
              })()}

              <View style={{ height: 16 }} />
            </ScrollView>

            {/* Action buttons */}
            {/* Send Receipt — only when job has a recorded payment and customer has email */}
            {selectedJob?.paymentMethod && selectedJob?.email && (
              <TouchableOpacity
                onPress={async () => {
                  setSendingJobReceipt(true);
                  try {
                    await sendJobReceiptMutation.mutateAsync({ jobId: String(selectedJob.id) });
                    Alert.alert("Receipt Sent ✅", `Payment receipt emailed to ${selectedJob.email}.`);
                  } catch (err: any) {
                    Alert.alert("Error", err.message ?? "Failed to send receipt");
                  } finally {
                    setSendingJobReceipt(false);
                  }
                }}
                style={{ padding: 14, backgroundColor: "#6366F115", borderRadius: 14, alignItems: "center", marginTop: 12, borderWidth: 1, borderColor: "#6366F140", opacity: sendingJobReceipt ? 0.6 : 1 }}
                activeOpacity={0.8}
                disabled={sendingJobReceipt}
              >
                <Text style={{ fontSize: 14, fontWeight: "700", color: "#6366F1" }}>
                  {sendingJobReceipt ? "Sending Receipt..." : "🧾 Send Receipt to Customer"}
                </Text>
              </TouchableOpacity>
            )}
            {/* Cancel Job — marks as cancelled, stays in history */}
            {!selectedJob?.recurrenceParentId && (
              <TouchableOpacity
                onPress={() => handleCancelJob(selectedJob)}
                style={{ padding: 14, backgroundColor: "#F59E0B15", borderRadius: 14, alignItems: "center", marginTop: 12, borderWidth: 1, borderColor: "#F59E0B40" }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 14, fontWeight: "700", color: "#F59E0B" }}>🚫 Cancel Job</Text>
              </TouchableOpacity>
            )}
            {/* Delete Job — permanently removes from all views */}
            <TouchableOpacity
              onPress={() => handleDeleteJob(selectedJob)}
              style={{ padding: 14, backgroundColor: "#EF444415", borderRadius: 14, alignItems: "center", marginTop: 8, borderWidth: 1, borderColor: "#EF444440" }}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 14, fontWeight: "700", color: "#EF4444" }}>🗑 Delete Job</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
              <TouchableOpacity
                onPress={() => setSelectedJob(null)}
                style={{ flex: 1, padding: 16, backgroundColor: colors.border, borderRadius: 14, alignItems: "center" }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const job = selectedJob;
                  setSelectedJob(null);
                  setTimeout(() => {
                    setShowAddJobModal(true);
                  }, 300);
                }}
                style={{ flex: 2, padding: 16, backgroundColor: colors.primary, borderRadius: 14, alignItems: "center" }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>🔄 Rebook</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Charge Card Modal ── */}
      <Modal
        visible={showChargeModal}
        transparent
        animationType="slide"
        onRequestClose={() => { if (!chargingCard) setShowChargeModal(false); }}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
            <View style={{ width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: "center", marginBottom: 20 }} />
            <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground, marginBottom: 4 }}>💳 Charge Card on File</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 20 }}>{params.fullName ?? "Customer"}</Text>

            {/* Card selector */}
            {((savedCards as any[]) ?? []).length > 1 && (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, letterSpacing: 0.5, marginBottom: 8 }}>SELECT CARD</Text>
                {((savedCards as any[]) ?? []).map((card: any) => (
                  <TouchableOpacity
                    key={card.stripePaymentMethodId}
                    onPress={() => setSelectedCardId(card.stripePaymentMethodId)}
                    style={{ flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, marginBottom: 8, borderWidth: 2, borderColor: selectedCardId === card.stripePaymentMethodId ? colors.primary : colors.border, backgroundColor: colors.background }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontSize: 16, marginRight: 10 }}>💳</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{card.brand?.toUpperCase() ?? "Card"} •••• {card.last4 ?? "????"}</Text>
                      <Text style={{ fontSize: 12, color: colors.muted }}>Expires {card.expMonth}/{card.expYear}{card.isDefault ? " · Default" : ""}</Text>
                    </View>
                    {selectedCardId === card.stripePaymentMethodId && <Text style={{ color: colors.primary, fontWeight: "700" }}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {((savedCards as any[]) ?? []).length === 1 && (() => {
              const card = (savedCards as any[])[0];
              return (
                <View style={{ flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
                  <Text style={{ fontSize: 16, marginRight: 10 }}>💳</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{card.brand?.toUpperCase() ?? "Card"} •••• {card.last4 ?? "????"}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>Expires {card.expMonth}/{card.expYear}</Text>
                  </View>
                </View>
              );
            })()}

            {/* Amount input */}
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, letterSpacing: 0.5, marginBottom: 8 }}>AMOUNT</Text>
            <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, marginBottom: 24 }}>
              <Text style={{ fontSize: 18, color: colors.muted, marginRight: 4 }}>$</Text>
              <TextInput
                value={chargeAmount}
                onChangeText={setChargeAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.muted}
                style={{ flex: 1, fontSize: 24, fontWeight: "700", color: colors.foreground, paddingVertical: 14 }}
                returnKeyType="done"
                editable={!chargingCard}
              />
            </View>

            {/* Buttons */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                onPress={() => { if (!chargingCard) { setShowChargeModal(false); setChargeAmount(""); } }}
                style={{ flex: 1, padding: 16, backgroundColor: colors.border, borderRadius: 14, alignItems: "center" }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleConfirmCharge}
                style={{ flex: 2, padding: 16, backgroundColor: chargingCard ? "#22c55e80" : "#22c55e", borderRadius: 14, alignItems: "center" }}
                activeOpacity={0.8}
                disabled={chargingCard}
              >
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>{chargingCard ? "Processing..." : "Charge Card"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Edit Contact Info Modal ── */}
      <Modal
        visible={showEditContactModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEditContactModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
            {/* Handle bar */}
            <View style={{ width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: "center", marginBottom: 20 }} />

            <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground, marginBottom: 4 }}>Edit Contact Info</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 24, lineHeight: 18 }}>Changes will update all jobs and records for this customer.</Text>

            {/* Name */}
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 6, letterSpacing: 0.5 }}>FULL NAME</Text>
            <TextInput
              style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 15, color: colors.foreground, marginBottom: 14 }}
              placeholder="Full name"
              placeholderTextColor={colors.muted}
              value={editName}
              onChangeText={setEditName}
              autoCapitalize="words"
              returnKeyType="next"
            />

            {/* Phone */}
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 6, letterSpacing: 0.5 }}>PHONE</Text>
            <TextInput
              style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 15, color: colors.foreground, marginBottom: 14 }}
              placeholder="Phone number"
              placeholderTextColor={colors.muted}
              value={editPhone}
              onChangeText={setEditPhone}
              keyboardType="phone-pad"
              returnKeyType="next"
            />

            {/* Email */}
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 6, letterSpacing: 0.5 }}>EMAIL</Text>
            <TextInput
              style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 15, color: colors.foreground, marginBottom: 14 }}
              placeholder="Email address"
              placeholderTextColor={colors.muted}
              value={editEmail}
              onChangeText={setEditEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              returnKeyType="next"
            />

            {/* Address */}
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 6, letterSpacing: 0.5 }}>ADDRESS</Text>
            <TextInput
              style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 15, color: colors.foreground, marginBottom: 24 }}
              placeholder="Street address"
              placeholderTextColor={colors.muted}
              value={editAddress}
              onChangeText={setEditAddress}
              autoCapitalize="words"
              returnKeyType="done"
            />

            {/* Buttons */}
            <View style={{ flexDirection: "row", gap: 12 }}>
              <TouchableOpacity
                onPress={() => setShowEditContactModal(false)}
                style={{ flex: 1, padding: 16, borderRadius: 14, backgroundColor: colors.border, alignItems: "center" }}
                activeOpacity={0.7}
              >
                <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveContact}
                disabled={savingContact}
                style={{ flex: 2, padding: 16, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", opacity: savingContact ? 0.6 : 1 }}
                activeOpacity={0.8}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{savingContact ? "Saving..." : "Save Changes"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── Admin Add Card on File Modal ─────────────────────────────────────────── */}
      <Modal
        visible={showAdminAddCardModal}
        transparent
        animationType="slide"
        onRequestClose={() => { if (!adminCardSaving) setShowAdminAddCardModal(false); }}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
            <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground, marginBottom: 4 }}>💳 Add Card on File</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 20 }}>Saving card for {params.fullName ?? "customer"}</Text>

            {/* Cardholder Name */}
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 6 }}>Name on Card</Text>
            <TextInput
              value={adminCardName}
              onChangeText={setAdminCardName}
              placeholder="Full name"
              placeholderTextColor={colors.muted}
              style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 15, color: colors.foreground, marginBottom: 14 }}
              editable={!adminCardSaving}
              returnKeyType="next"
            />

            {/* Card Fields — Stripe native or manual fallback */}
            {(() => {
              const Constants = require("expo-constants").default ?? require("expo-constants");
              const isExpoGo = Constants?.appOwnership === "expo";
              const isNative = Platform.OS !== "web" && !isExpoGo;
              let StripeCardField: any = null;
              if (isNative) { try { StripeCardField = require("@stripe/stripe-react-native").CardField ?? null; } catch {} }
              if (isNative && StripeCardField) {
                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 6 }}>Card Details</Text>
                    <StripeCardField
                      onCardChange={(d: any) => setAdminCardComplete(d.complete)}
                      style={{ height: 50, marginBottom: 4 }}
                      cardStyle={{ backgroundColor: colors.background, textColor: colors.foreground, placeholderColor: colors.muted, borderColor: colors.border, borderWidth: 1, borderRadius: 10 }}
                    />
                  </View>
                );
              }
              return (
                <View>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 6 }}>Card Number</Text>
                  <TextInput
                    value={adminCardNumber}
                    onChangeText={(t) => { setAdminCardNumber(formatCardNumber(t)); setAdminCardComplete(t.replace(/\s/g, "").length >= 13); }}
                    placeholder="1234 5678 9012 3456"
                    placeholderTextColor={colors.muted}
                    keyboardType="numeric"
                    style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 15, color: colors.foreground, marginBottom: 10 }}
                    maxLength={19}
                    editable={!adminCardSaving}
                    returnKeyType="next"
                  />
                  <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 6 }}>Expiry (MM/YY)</Text>
                      <TextInput
                        value={adminCardExpiry}
                        onChangeText={(t) => setAdminCardExpiry(formatExpiry(t))}
                        placeholder="MM/YY"
                        placeholderTextColor={colors.muted}
                        keyboardType="numeric"
                        style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 15, color: colors.foreground }}
                        maxLength={5}
                        editable={!adminCardSaving}
                        returnKeyType="next"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 6 }}>CVC</Text>
                      <TextInput
                        value={adminCardCvc}
                        onChangeText={(t) => setAdminCardCvc(t.replace(/\D/g, "").slice(0, 4))}
                        placeholder="123"
                        placeholderTextColor={colors.muted}
                        keyboardType="numeric"
                        style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 15, color: colors.foreground }}
                        maxLength={4}
                        editable={!adminCardSaving}
                        returnKeyType="done"
                        secureTextEntry
                      />
                    </View>
                  </View>
                </View>
              );
            })()}

            {/* Buttons */}
            <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
              <TouchableOpacity
                onPress={() => { if (!adminCardSaving) setShowAdminAddCardModal(false); }}
                style={{ flex: 1, padding: 16, borderRadius: 14, backgroundColor: colors.border, alignItems: "center" }}
                activeOpacity={0.7}
              >
                <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleAdminSaveCard}
                disabled={adminCardSaving}
                style={{ flex: 2, padding: 16, borderRadius: 14, backgroundColor: adminCardSaving ? colors.primary + "80" : colors.primary, alignItems: "center" }}
                activeOpacity={0.8}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{adminCardSaving ? "Saving..." : "Save Card"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    backBtn: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 4,
    },
    backBtnText: {
      fontSize: 13,
      color: colors.primary,
      fontWeight: "600",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    avatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.primary + "22",
      justifyContent: "center",
      alignItems: "center",
    },
    avatarText: {
      fontSize: 22,
      fontWeight: "800",
      color: colors.primary,
    },
    headerName: {
      fontSize: 20,
      fontWeight: "800",
      color: colors.foreground,
    },
    headerSub: {
      fontSize: 12,
      color: colors.muted,
      marginTop: 2,
    },
    tabBar: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      marginHorizontal: 16,
    },
    nextApptBanner: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginHorizontal: 16,
      marginBottom: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: colors.primary + "18",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.primary + "44",
    },
    nextApptLeft: {
      flex: 1,
    },
    nextApptRight: {
      alignItems: "flex-end",
      maxWidth: "50%",
    },
    nextApptLabel: {
      fontSize: 9,
      fontWeight: "800",
      color: colors.primary,
      letterSpacing: 0.8,
      marginBottom: 2,
    },
    nextApptDate: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.foreground,
    },
    nextApptTime: {
      fontSize: 12,
      color: colors.muted,
      marginTop: 1,
    },
    nextApptService: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.foreground,
      textAlign: "right",
    },
    tabItem: {
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderBottomWidth: 2,
      borderBottomColor: "transparent",
    },
    tabItemActive: {
      borderBottomColor: colors.primary,
    },
    tabText: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.muted,
    },
    tabTextActive: {
      color: colors.primary,
    },
    scrollContent: {
      padding: 16,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 14,
    },
    cardTitle: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.foreground,
      marginBottom: 12,
    },
    cardHeaderRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    cardSubtitle: {
      fontSize: 12,
      color: colors.muted,
    },
    summaryGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
    },
    summaryItem: {
      width: "47%",
    },
    summaryLabel: {
      fontSize: 10,
      color: colors.muted,
      fontWeight: "700",
      letterSpacing: 0.5,
      marginBottom: 3,
    },
    summaryValue: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.foreground,
    },
    contactRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    contactIcon: {
      fontSize: 18,
    },
    contactLabel: {
      fontSize: 10,
      color: colors.muted,
      fontWeight: "700",
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    contactValue: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.foreground,
    },
    noData: {
      fontSize: 13,
      color: colors.muted,
      fontStyle: "italic",
    },
    apptRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 8,
    },
    apptDate: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.foreground,
    },
    apptService: {
      fontSize: 12,
      color: colors.muted,
      marginTop: 1,
    },
    apptTime: {
      fontSize: 11,
      color: colors.muted,
    },
    statusPill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 20,
    },
    statusText: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "capitalize",
    },
    vehicleRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    vehicleLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.foreground,
    },
    vehicleCount: {
      fontSize: 12,
      color: colors.muted,
    },
    jobCard: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingVertical: 12,
    },
    jobCardTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 4,
    },
    jobDate: {
      fontSize: 12,
      color: colors.muted,
      fontWeight: "600",
    },
    jobService: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.foreground,
      marginBottom: 2,
    },
    jobVehicle: {
      fontSize: 12,
      color: colors.muted,
      marginBottom: 4,
    },
    jobCardBottom: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    jobDetailer: {
      fontSize: 12,
      color: colors.muted,
    },
    jobPrice: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.success,
    },
    noteInput: {
      backgroundColor: colors.background,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      color: colors.foreground,
      fontSize: 14,
      minHeight: 80,
      textAlignVertical: "top",
      marginBottom: 10,
    },
    saveNoteBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: "center",
      marginBottom: 16,
    },
    saveNoteBtnText: {
      color: "#fff",
      fontWeight: "700",
      fontSize: 14,
    },
    noteCard: {
      backgroundColor: colors.background,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      marginBottom: 8,
    },
    noteText: {
      fontSize: 13,
      color: colors.foreground,
      marginBottom: 6,
    },
    noteDate: {
      fontSize: 11,
      color: colors.muted,
    },
  });
}
