import React, { useState, useMemo } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  Modal, FlatList, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { StyleSheet } from "react-native";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LineItem { description: string; quantity: string; unitPrice: string }
type InvoiceStatus = "draft" | "sent" | "paid" | "partial" | "void";

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: "#687076",
  sent: "#0a7ea4",
  paid: "#22C55E",
  partial: "#F59E0B",
  void: "#EF4444",
};

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  partial: "Partial",
  void: "Void",
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminInvoicesScreen() {
  const colors = useColors();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);

  const { data: invoices = [], refetch, isLoading } = trpc.standaloneInvoices.list.useQuery({ search });

  const filtered = useMemo(() => {
    if (!search.trim()) return invoices;
    const q = search.toLowerCase();
    return invoices.filter((inv: any) =>
      inv.customerName?.toLowerCase().includes(q) ||
      inv.invoiceNumber?.toLowerCase().includes(q)
    );
  }, [invoices, search]);

  return (
    <ScreenContainer edges={["left", "right"]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Invoices</Text>
        <TouchableOpacity
          style={[styles.newBtn, { backgroundColor: colors.primary }]}
          onPress={() => setShowCreate(true)}
        >
          <Text style={styles.newBtnText}>+ New Invoice</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={[styles.searchRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={{ color: colors.muted, marginRight: 8 }}>🔍</Text>
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Search by name or invoice #"
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: colors.muted, fontSize: 15 }}>No invoices yet</Text>
          <TouchableOpacity
            style={[styles.newBtn, { backgroundColor: colors.primary, marginTop: 16 }]}
            onPress={() => setShowCreate(true)}
          >
            <Text style={styles.newBtnText}>Create First Invoice</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={filtered}
          keyExtractor={(item: any) => item.invoiceId}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => (
            <InvoiceCard invoice={item} colors={colors} onPress={() => setSelectedInvoice(item)} />
          )}
        />
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateInvoiceModal
          colors={colors}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refetch(); }}
        />
      )}

      {/* Detail Modal */}
      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
          colors={colors}
          onClose={() => setSelectedInvoice(null)}
          onUpdated={() => { setSelectedInvoice(null); refetch(); }}
        />
      )}
    </ScreenContainer>
  );
}

// ─── Invoice Card ─────────────────────────────────────────────────────────────
function InvoiceCard({ invoice, colors, onPress }: { invoice: any; colors: any; onPress: () => void }) {
  const status = invoice.status as InvoiceStatus;
  const total = parseFloat(invoice.totalAmount ?? "0");
  const paid = parseFloat(invoice.amountPaid ?? "0");
  const due = Math.max(0, total - paid);

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onPress}
    >
      <View style={styles.cardRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardName, { color: colors.foreground }]}>{invoice.customerName}</Text>
          <Text style={[styles.cardNum, { color: colors.muted }]}>{invoice.invoiceNumber}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[styles.cardAmount, { color: colors.foreground }]}>${total.toFixed(2)}</Text>
          <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[status] + "22" }]}>
            <Text style={[styles.statusText, { color: STATUS_COLORS[status] }]}>
              {STATUS_LABELS[status]}
            </Text>
          </View>
        </View>
      </View>
      {status === "partial" && (
        <Text style={[styles.dueText, { color: colors.warning }]}>
          ${due.toFixed(2)} remaining
        </Text>
      )}
      {invoice.dueDate && (
        <Text style={[styles.dueText, { color: colors.muted }]}>Due: {invoice.dueDate}</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Create Invoice Modal ─────────────────────────────────────────────────────
function CreateInvoiceModal({ colors, onClose, onCreated }: {
  colors: any; onClose: () => void; onCreated: () => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: "1", unitPrice: "" },
  ]);

  const createMutation = trpc.standaloneInvoices.create.useMutation();
  const sendMutation = trpc.standaloneInvoices.send.useMutation();

  const subtotal = lineItems.reduce((s, li) => {
    const qty = parseFloat(li.quantity) || 0;
    const price = parseFloat(li.unitPrice) || 0;
    return s + qty * price;
  }, 0);
  const discount = parseFloat(discountAmount) || 0;
  const total = Math.max(0, subtotal - discount);

  const addLine = () => setLineItems(prev => [...prev, { description: "", quantity: "1", unitPrice: "" }]);
  const removeLine = (i: number) => setLineItems(prev => prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof LineItem, val: string) => {
    setLineItems(prev => prev.map((li, idx) => idx === i ? { ...li, [field]: val } : li));
  };

  const handleSave = async (sendAfter?: "email" | "sms") => {
    if (!customerName.trim()) { Alert.alert("Required", "Customer name is required."); return; }
    const validLines = lineItems.filter(li => li.description.trim() && parseFloat(li.unitPrice) > 0);
    if (validLines.length === 0) { Alert.alert("Required", "Add at least one line item with a description and price."); return; }

    try {
      const result: any = await createMutation.mutateAsync({
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        notes: notes.trim() || undefined,
        dueDate: dueDate.trim() || undefined,
        discountAmount: discount > 0 ? discount : undefined,
        lineItems: validLines.map(li => ({
          description: li.description.trim(),
          quantity: parseFloat(li.quantity) || 1,
          unitPrice: parseFloat(li.unitPrice) || 0,
        })),
      });
      if (sendAfter && result?.invoiceId) {
        try {
          await sendMutation.mutateAsync({
            invoiceId: result.invoiceId,
            method: sendAfter,
            overrideEmail: sendAfter === 'email' ? customerEmail.trim() || undefined : undefined,
            overridePhone: sendAfter === 'sms' ? customerPhone.trim() || undefined : undefined,
          });
          Alert.alert('Sent!', `Invoice created and sent via ${sendAfter === 'email' ? 'email' : 'SMS'}.`);
        } catch (sendErr: any) {
          Alert.alert('Created', `Invoice saved but send failed: ${sendErr.message}`);
        }
      }
      onCreated();
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to create invoice");
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          {/* Modal Header */}
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>New Invoice</Text>
            <TouchableOpacity onPress={() => handleSave()} disabled={createMutation.isPending}>
              <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "600" }}>
                {createMutation.isPending ? "Saving..." : "Save"}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
            {/* Customer Info */}
            <SectionHeader title="CUSTOMER" colors={colors} />
            <LabeledInput label="Name *" value={customerName} onChangeText={setCustomerName} placeholder="Customer full name" colors={colors} />
            <LabeledInput label="Email" value={customerEmail} onChangeText={setCustomerEmail} placeholder="customer@email.com" colors={colors} keyboardType="email-address" />
            <LabeledInput label="Phone" value={customerPhone} onChangeText={setCustomerPhone} placeholder="(850) 555-0000" colors={colors} keyboardType="phone-pad" />

            {/* Line Items */}
            <SectionHeader title="LINE ITEMS" colors={colors} />
            {lineItems.map((li, i) => (
              <View key={i} style={[styles.lineItemRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <TextInput
                  style={[styles.lineDesc, { color: colors.foreground, borderBottomColor: colors.border }]}
                  placeholder="Description"
                  placeholderTextColor={colors.muted}
                  value={li.description}
                  onChangeText={v => updateLine(i, "description", v)}
                />
                <View style={styles.lineAmounts}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.lineLabel, { color: colors.muted }]}>QTY</Text>
                    <TextInput
                      style={[styles.lineInput, { color: colors.foreground, borderColor: colors.border }]}
                      value={li.quantity}
                      onChangeText={v => updateLine(i, "quantity", v)}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={{ flex: 2 }}>
                    <Text style={[styles.lineLabel, { color: colors.muted }]}>UNIT PRICE</Text>
                    <TextInput
                      style={[styles.lineInput, { color: colors.foreground, borderColor: colors.border }]}
                      value={li.unitPrice}
                      onChangeText={v => updateLine(i, "unitPrice", v)}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={colors.muted}
                    />
                  </View>
                  <View style={{ flex: 1, alignItems: "flex-end", justifyContent: "flex-end" }}>
                    <Text style={[styles.lineTotal, { color: colors.foreground }]}>
                      ${((parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0)).toFixed(2)}
                    </Text>
                    {lineItems.length > 1 && (
                      <TouchableOpacity onPress={() => removeLine(i)} style={{ marginTop: 4 }}>
                        <Text style={{ color: colors.error, fontSize: 12 }}>Remove</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            ))}
            <TouchableOpacity
              style={[styles.addLineBtn, { borderColor: colors.primary }]}
              onPress={addLine}
            >
              <Text style={{ color: colors.primary, fontWeight: "600" }}>+ Add Line Item</Text>
            </TouchableOpacity>

            {/* Totals */}
            <View style={[styles.totalsBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TotalRow label="Subtotal" value={`$${subtotal.toFixed(2)}`} colors={colors} />
              <View style={styles.discountRow}>
                <Text style={[styles.totalLabel, { color: colors.muted }]}>Discount</Text>
                <View style={[styles.discountInput, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.muted }}>$</Text>
                  <TextInput
                    style={[{ color: colors.foreground, minWidth: 60, textAlign: "right" }]}
                    value={discountAmount}
                    onChangeText={setDiscountAmount}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={colors.muted}
                  />
                </View>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <TotalRow label="TOTAL" value={`$${total.toFixed(2)}`} colors={colors} bold />
            </View>

            {/* Options */}
            <SectionHeader title="OPTIONS" colors={colors} />
            <LabeledInput label="Due Date" value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" colors={colors} />
            <LabeledInput label="Notes" value={notes} onChangeText={setNotes} placeholder="Internal notes (not shown to customer)" colors={colors} multiline />

            {/* Action Buttons */}
            <View style={{ gap: 12, paddingBottom: 40 }}>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: colors.primary }]}
                onPress={() => handleSave()}
                disabled={createMutation.isPending}
              >
                <Text style={styles.actionBtnText}>
                  {createMutation.isPending ? "Saving..." : "💾 Save as Draft"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: "#22C55E" }]}
                onPress={() => handleSave("email")}
                disabled={createMutation.isPending}
              >
                <Text style={styles.actionBtnText}>📧 Save & Send via Email</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: "#6366F1" }]}
                onPress={() => handleSave("sms")}
                disabled={createMutation.isPending}
              >
                <Text style={styles.actionBtnText}>💬 Save & Send via SMS</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Invoice Detail Modal ─────────────────────────────────────────────────────
function InvoiceDetailModal({ invoice: initialInvoice, colors, onClose, onUpdated }: {
  invoice: any; colors: any; onClose: () => void; onUpdated: () => void;
}) {
  const [showSendModal, setShowSendModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [sendingReceipt, setSendingReceipt] = useState(false);

  // Live-fetch so balance always reflects latest DB state (e.g. paid via link)
  const { data: liveInvoice, refetch: refetchInvoice } = trpc.standaloneInvoices.getById.useQuery(
    { invoiceId: initialInvoice.invoiceId },
    { refetchOnMount: true, refetchOnWindowFocus: true }
  );
  const invoice = liveInvoice ?? initialInvoice;

  const status = invoice.status as InvoiceStatus;
  const total = parseFloat(invoice.totalAmount ?? "0");
  const paid = parseFloat(invoice.amountPaid ?? "0");
  const due = Math.max(0, total - paid);

  const updateMutation = trpc.standaloneInvoices.updateStatus.useMutation();
  const sendReceiptMutation = trpc.standaloneInvoices.sendReceipt.useMutation();

  const handleSendReceipt = async () => {
    if (!invoice.customerEmail) {
      Alert.alert("No Email", "This invoice has no customer email on file.");
      return;
    }
    setSendingReceipt(true);
    try {
      await sendReceiptMutation.mutateAsync({ invoiceId: invoice.invoiceId });
      Alert.alert("Receipt Sent!", `A payment receipt was emailed to ${invoice.customerEmail}.`);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to send receipt");
    } finally {
      setSendingReceipt(false);
    }
  };

  const handleVoid = () => {
    Alert.alert("Void Invoice", "Mark this invoice as void?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Void", style: "destructive",
        onPress: async () => {
          await updateMutation.mutateAsync({ invoiceId: invoice.invoiceId, status: "void" });
          onUpdated();
        },
      },
    ]);
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet">
      <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: colors.primary, fontSize: 16 }}>Close</Text>
          </TouchableOpacity>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Invoice</Text>
          <TouchableOpacity onPress={handleVoid}>
            <Text style={{ color: colors.error, fontSize: 14 }}>Void</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          {/* Status Badge */}
          <View style={[styles.statusBadgeLarge, { backgroundColor: STATUS_COLORS[status] + "22" }]}>
            <Text style={[styles.statusTextLarge, { color: STATUS_COLORS[status] }]}>
              {STATUS_LABELS[status].toUpperCase()}
            </Text>
          </View>

          {/* Invoice Info */}
          <View style={[styles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <InfoRow label="Invoice #" value={invoice.invoiceNumber} colors={colors} />
            <InfoRow label="Customer" value={invoice.customerName} colors={colors} />
            {invoice.customerEmail && <InfoRow label="Email" value={invoice.customerEmail} colors={colors} />}
            {invoice.customerPhone && <InfoRow label="Phone" value={invoice.customerPhone} colors={colors} />}
            {invoice.dueDate && <InfoRow label="Due Date" value={invoice.dueDate} colors={colors} />}
          </View>

          {/* Line Items */}
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>LINE ITEMS</Text>
          <View style={[styles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {(invoice.lineItems ?? []).map((li: any, i: number) => (
              <View key={i} style={[styles.lineDetailRow, i > 0 && { borderTopColor: colors.border, borderTopWidth: 0.5 }]}>
                <Text style={[{ flex: 1, color: colors.foreground, fontSize: 14 }]}>{li.description}</Text>
                <Text style={[{ color: colors.muted, fontSize: 13, marginRight: 8 }]}>
                  {parseFloat(li.quantity)} × ${parseFloat(li.unitPrice).toFixed(2)}
                </Text>
                <Text style={[{ color: colors.foreground, fontSize: 14, fontWeight: "600" }]}>
                  ${parseFloat(li.lineTotal).toFixed(2)}
                </Text>
              </View>
            ))}
          </View>

          {/* Totals */}
          <View style={[styles.totalsBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TotalRow label="Subtotal" value={`$${parseFloat(invoice.subtotal ?? "0").toFixed(2)}`} colors={colors} />
            {parseFloat(invoice.discountAmount ?? "0") > 0 && (
              <TotalRow label="Discount" value={`-$${parseFloat(invoice.discountAmount).toFixed(2)}`} colors={colors} />
            )}
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <TotalRow label="TOTAL" value={`$${total.toFixed(2)}`} colors={colors} bold />
            {paid > 0 && <TotalRow label="Paid" value={`$${paid.toFixed(2)}`} colors={colors} />}
            {due > 0 && <TotalRow label="AMOUNT DUE" value={`$${due.toFixed(2)}`} colors={colors} bold />}
          </View>

          {invoice.notes && (
            <Text style={[styles.notesText, { color: colors.muted, borderColor: colors.border }]}>
              {invoice.notes}
            </Text>
          )}

          {/* Actions */}
          <View style={{ gap: 12, paddingBottom: 40 }}>
            {status !== "paid" && status !== "void" && (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.primary }]}
                  onPress={() => setShowSendModal(true)}
                >
                  <Text style={styles.actionBtnText}>📤 Send Invoice</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: "#22C55E" }]}
                  onPress={() => setShowPayModal(true)}
                >
                  <Text style={styles.actionBtnText}>💵 Record Payment</Text>
                </TouchableOpacity>
              </>
            )}
            {(status === "paid" || status === "partial") && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: "#6366F1", opacity: sendingReceipt ? 0.6 : 1 }]}
                onPress={handleSendReceipt}
                disabled={sendingReceipt}
              >
                <Text style={styles.actionBtnText}>
                  {sendingReceipt ? "Sending..." : "🧾 Send Receipt to Customer"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </View>

      {showSendModal && (
        <SendInvoiceModal
          invoice={invoice}
          colors={colors}
          onClose={() => setShowSendModal(false)}
          onSent={() => { setShowSendModal(false); onUpdated(); }}
        />
      )}

      {showPayModal && (
        <RecordPaymentModal
          invoice={invoice}
          colors={colors}
          onClose={() => setShowPayModal(false)}
          onPaid={() => { setShowPayModal(false); refetchInvoice(); onUpdated(); }}
        />
      )}
    </Modal>
  );
}

// ─── Send Invoice Modal ───────────────────────────────────────────────────────
function SendInvoiceModal({ invoice, colors, onClose, onSent }: {
  invoice: any; colors: any; onClose: () => void; onSent: () => void;
}) {
  const [method, setMethod] = useState<"email" | "sms">("email");
  const [overrideEmail, setOverrideEmail] = useState(invoice.customerEmail ?? "");
  const [overridePhone, setOverridePhone] = useState(invoice.customerPhone ?? "");
  const sendMutation = trpc.standaloneInvoices.send.useMutation();

  const handleSend = async () => {
    try {
      await sendMutation.mutateAsync({
        invoiceId: invoice.invoiceId,
        method,
        overrideEmail: method === "email" ? overrideEmail : undefined,
        overridePhone: method === "sms" ? overridePhone : undefined,
      });
      Alert.alert("Sent!", `Invoice sent via ${method === "email" ? "email" : "SMS"}.`);
      onSent();
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to send invoice");
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="formSheet">
      <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: colors.primary }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Send Invoice</Text>
          <View style={{ width: 50 }} />
        </View>
        <View style={{ padding: 20, gap: 16 }}>
          {/* Method Toggle */}
          <View style={[styles.methodToggle, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {(["email", "sms"] as const).map(m => (
              <TouchableOpacity
                key={m}
                style={[styles.methodBtn, method === m && { backgroundColor: colors.primary }]}
                onPress={() => setMethod(m)}
              >
                <Text style={{ color: method === m ? "#fff" : colors.muted, fontWeight: "600" }}>
                  {m === "email" ? "📧 Email" : "💬 SMS"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {method === "email" ? (
            <LabeledInput label="Email Address" value={overrideEmail} onChangeText={setOverrideEmail} placeholder="customer@email.com" colors={colors} keyboardType="email-address" />
          ) : (
            <LabeledInput label="Phone Number" value={overridePhone} onChangeText={setOverridePhone} placeholder="(850) 555-0000" colors={colors} keyboardType="phone-pad" />
          )}

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.primary, marginTop: 8 }]}
            onPress={handleSend}
            disabled={sendMutation.isPending}
          >
            <Text style={styles.actionBtnText}>
              {sendMutation.isPending ? "Sending..." : `Send via ${method === "email" ? "Email" : "SMS"}`}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Record Payment Modal ─────────────────────────────────────────────────────
function RecordPaymentModal({ invoice, colors, onClose, onPaid }: {
  invoice: any; colors: any; onClose: () => void; onPaid: () => void;
}) {
  const total = parseFloat(invoice.totalAmount ?? "0");
  const alreadyPaid = parseFloat(invoice.amountPaid ?? "0");
  const due = Math.max(0, total - alreadyPaid);
  const [amount, setAmount] = useState(due.toFixed(2));
  const [method, setMethod] = useState("Cash");
  const [note, setNote] = useState("");
  const updateMutation = trpc.standaloneInvoices.updateStatus.useMutation();

  const PAYMENT_METHODS = ["Cash", "Card", "Zelle", "Venmo", "CashApp", "Check", "Other"];

  const handleRecord = async () => {
    const paid = parseFloat(amount) || 0;
    if (paid <= 0) { Alert.alert("Invalid", "Enter a payment amount."); return; }
    const newPaid = alreadyPaid + paid;
    const newStatus = newPaid >= total ? "paid" : "partial";
    try {
      await updateMutation.mutateAsync({
        invoiceId: invoice.invoiceId,
        status: newStatus,
        amountPaid: newPaid,
        paymentMethod: method,
        paymentNote: note.trim() || undefined,
      });
      Alert.alert("Recorded!", `Payment of $${paid.toFixed(2)} recorded.`);
      onPaid();
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to record payment");
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="formSheet">
      <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: colors.primary }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Record Payment</Text>
          <View style={{ width: 50 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <Text style={[{ color: colors.muted, textAlign: "center" }]}>
            Amount due: <Text style={{ color: colors.foreground, fontWeight: "700" }}>${due.toFixed(2)}</Text>
          </Text>

          <LabeledInput
            label="Amount Received"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            colors={colors}
            keyboardType="decimal-pad"
          />

          <Text style={[styles.fieldLabel, { color: colors.muted }]}>PAYMENT METHOD</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {PAYMENT_METHODS.map(m => (
                <TouchableOpacity
                  key={m}
                  style={[styles.methodChip, {
                    backgroundColor: method === m ? colors.primary : colors.surface,
                    borderColor: method === m ? colors.primary : colors.border,
                  }]}
                  onPress={() => setMethod(m)}
                >
                  <Text style={{ color: method === m ? "#fff" : colors.foreground, fontSize: 13 }}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <LabeledInput label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. Paid in full" colors={colors} />

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: "#22C55E", marginTop: 8 }]}
            onPress={handleRecord}
            disabled={updateMutation.isPending}
          >
            <Text style={styles.actionBtnText}>
              {updateMutation.isPending ? "Recording..." : "✓ Record Payment"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Small Helpers ────────────────────────────────────────────────────────────
function SectionHeader({ title, colors }: { title: string; colors: any }) {
  return <Text style={[styles.sectionTitle, { color: colors.muted }]}>{title}</Text>;
}

function LabeledInput({ label, value, onChangeText, placeholder, colors, keyboardType, multiline }: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; colors: any; keyboardType?: any; multiline?: boolean;
}) {
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>{label.toUpperCase()}</Text>
      <TextInput
        style={[styles.fieldInput, {
          color: colors.foreground,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          height: multiline ? 80 : undefined,
          textAlignVertical: multiline ? "top" : undefined,
        }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize="none"
      />
    </View>
  );
}

function TotalRow({ label, value, colors, bold }: { label: string; value: string; colors: any; bold?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, { color: bold ? colors.foreground : colors.muted, fontWeight: bold ? "700" : "400" }]}>{label}</Text>
      <Text style={[styles.totalValue, { color: bold ? colors.primary : colors.foreground, fontWeight: bold ? "700" : "400" }]}>{value}</Text>
    </View>
  );
}

function InfoRow({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  headerTitle: { fontSize: 22, fontWeight: "700" },
  newBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  newBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  searchRow: { flexDirection: "row", alignItems: "center", margin: 16, padding: 12, borderRadius: 12, borderWidth: 0.5 },
  searchInput: { flex: 1, fontSize: 15 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: 14, padding: 16, borderWidth: 0.5 },
  cardRow: { flexDirection: "row", alignItems: "flex-start" },
  cardName: { fontSize: 16, fontWeight: "600", marginBottom: 2 },
  cardNum: { fontSize: 12 },
  cardAmount: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: "700" },
  statusBadgeLarge: { alignSelf: "center", paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
  statusTextLarge: { fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  dueText: { fontSize: 12, marginTop: 6 },
  modalContainer: { flex: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  modalTitle: { fontSize: 17, fontWeight: "600" },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  fieldLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.5, marginBottom: 6 },
  fieldInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15 },
  lineItemRow: { borderRadius: 12, padding: 12, borderWidth: 0.5, gap: 10 },
  lineDesc: { fontSize: 15, paddingBottom: 8, borderBottomWidth: 0.5 },
  lineAmounts: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  lineLabel: { fontSize: 10, fontWeight: "600", marginBottom: 4 },
  lineInput: { borderWidth: 1, borderRadius: 8, padding: 8, fontSize: 14, textAlign: "right" },
  lineTotal: { fontSize: 15, fontWeight: "600", textAlign: "right" },
  addLineBtn: { borderWidth: 1.5, borderRadius: 12, padding: 12, alignItems: "center", borderStyle: "dashed" },
  totalsBox: { borderRadius: 14, padding: 16, borderWidth: 0.5, gap: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { fontSize: 14 },
  totalValue: { fontSize: 16 },
  discountRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  discountInput: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  divider: { height: 0.5, marginVertical: 4 },
  actionBtn: { borderRadius: 14, padding: 16, alignItems: "center" },
  actionBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  infoBox: { borderRadius: 14, padding: 16, borderWidth: 0.5, gap: 10 },
  infoRow: { flexDirection: "row", justifyContent: "space-between" },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 13, fontWeight: "600", textAlign: "right", flex: 1, marginLeft: 16 },
  lineDetailRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 8 },
  notesText: { fontSize: 13, padding: 12, borderWidth: 0.5, borderRadius: 10, lineHeight: 20 },
  methodToggle: { flexDirection: "row", borderRadius: 12, borderWidth: 0.5, overflow: "hidden" },
  methodBtn: { flex: 1, padding: 12, alignItems: "center" },
  methodChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
});
