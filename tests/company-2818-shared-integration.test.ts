import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  updateJobSyncCompanyJobAddress, updateJobSyncCompanyJobPrivateNotes,
  sendJobSyncCompanyJobInvoice, normalizeJobSyncCompanyJobDetail,
} from "../lib/jobsync-mobile-api";

const TOKEN = "offline-2818-shared-adapter";
const V0 = "2026-11-17T12:00:00.000Z";
const V1 = "2026-11-17T12:00:01.000Z";
const address = () => ({ addressLine1: "New street", city: "Returned city", region: null, postalCode: null, expectedUpdatedAt: V0 });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const stub = (body: unknown, status = 200) => {
  const mock = vi.fn().mockResolvedValue(response(body, status)); vi.stubGlobal("fetch", mock); return mock;
};
const wire = () => ({ id: 12, companyId: 9, customerId: 7, assignedUserId: null, status: "scheduled",
  amount: 24, updatedAt: V0, addressLine1: "Saved street", address_line1: "Saved street", city: "Saved city",
  region: null, postal_code: null, photos: [], internal_notes: "Internal only", customer_notification_enabled: 1,
  lineItems: [{ id: 1, priceBookItemId: 5, name: "Returned service", quantity: 1, unitPrice: 24, lineTotal: 24, sortOrder: 4 }],
  subtotalAmount: 24, discountAmount: 0, taxAmount: 0, taxRateBps: 0, totalAmount: 24, discountKind: null, discountCode: null,
  tax_amount: 0, tax_rate_bps: 0,
});
beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live services forbidden"))));
afterEach(() => vi.unstubAllGlobals());

describe("connected existing bearer adapters against exact unpublished 2818 shapes", () => {
  it("sends complete immutable address and expected version once and retains the exact acknowledgment", async () => {
    const ack = { job: { id: 12, updatedAt: V1 }, address: { addressLine1: "New street", city: "Returned city", region: null, postalCode: null }, updatedAt: V1 };
    const mock = stub(ack); const draft = address();
    const pending = updateJobSyncCompanyJobAddress(TOKEN, 12, draft); draft.addressLine1 = "Changed while awaiting";
    expect(await pending).toEqual(ack); expect(mock).toHaveBeenCalledOnce();
    const [url, init] = mock.mock.calls[0]; expect(new URL(url).pathname).toBe("/api/mobile/v1/company/jobs/12/address");
    expect(init.method).toBe("PATCH"); expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body)).toEqual(address()); expect(init).not.toHaveProperty("credentials");
  });
  it.each([null, undefined, "", "2026-02-30T12:00:00Z", "not-a-version"])('blocks invalid address version before HTTP: %#', async version => {
    await expect(updateJobSyncCompanyJobAddress(TOKEN, 12, { ...address(), expectedUpdatedAt: version } as any)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409, 500])("never retries or downgrades address HTTP %s", async status => {
    const mock = stub({ error: { code: "CONFLICT", message: "Unsafe provider details" } }, status);
    await expect(updateJobSyncCompanyJobAddress(TOKEN, 12, address())).rejects.toThrow(); expect(mock).toHaveBeenCalledOnce();
  });
  it("passes the private editor's fourth captured version without trimming private text", async () => {
    const note = "  Private text\n  "; const ack = { success: true, jobId: 12, privateNotes: note, updatedAt: V1 }; const mock = stub(ack);
    expect(await updateJobSyncCompanyJobPrivateNotes(TOKEN, 12, note, V0)).toEqual(ack);
    expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ privateNotes: note, expectedUpdatedAt: V0 }); expect(mock).toHaveBeenCalledOnce();
  });
  it("normalizes captured invoice email and preserves only the returned receipt destination", async () => {
    const mock = stub({ success: true, publicUrl: "https://example.test/invoice", status: "sent", communicationState: "provider_accepted", sentTo: "Reported@Example.test" });
    const result = await sendJobSyncCompanyJobInvoice(TOKEN, 12, { method: "email", resend: true, recipientEmail: " Captured@Example.test " });
    expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ method: "email", resend: true, recipientEmail: "captured@example.test" });
    expect(result.sentTo).toBe("reported@example.test"); expect(result.status).toBe("provider_accepted"); expect(result.isDelivered).toBe(false);
  });
  it("does not fabricate an invoice destination from the draft or a sent compatibility alias", async () => {
    stub({ success: true, publicUrl: "https://example.test/invoice", status: "sent" });
    const result = await sendJobSyncCompanyJobInvoice(TOKEN, 12, { method: "email", recipientEmail: "captured@example.test" });
    expect(result.sentTo).toBeNull(); expect(result.status).toBeNull(); expect(result.isDelivered).toBe(false);
  });
  it("does not send unsupported SMS recipient overrides", async () => {
    await expect(sendJobSyncCompanyJobInvoice(TOKEN, 12, { method: "sms", recipientEmail: "captured@example.test" })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("canonical detail normalization and retained fail-closed screen boundaries", () => {
  it("keeps complete saved address separate from customer details and retains canonical version bytes", () => {
    const detail = normalizeJobSyncCompanyJobDetail({ job: wire() }, 12, 9)!;
    expect(detail.serviceAddress).toEqual({ addressLine1: "Saved street", city: "Saved city", region: null, postalCode: null });
    expect(detail.updatedAt).toBe(V0); expect(detail.privateNotes).toBe("Internal only");
  });
  it("does not infer a complete saved address from a list/customer-profile address", () => {
    const row: any = wire(); delete row.region; delete row.postal_code; row.customer_address = "Must not substitute";
    expect(normalizeJobSyncCompanyJobDetail({ job: row }, 12, 9)?.serviceAddress).toBeUndefined();
  });
  it("sanitizes latest confirmation failure without claiming current appointment failure or exposing private/provider text", () => {
    const row = { ...wire(), confirmationCommunication: { status: "failed", communicationId: 55, recipientEmail: "private@example.test", reason: "provider_rejected", errorCode: "REJECTED", errorMessage: "Unsafe provider private text" } };
    const detail = normalizeJobSyncCompanyJobDetail({ job: row }, 12, 9)!;
    expect(detail.confirmationCommunication).toEqual({ status: "unknown", recordStatus: "failed", communicationId: 55, reason: "appointment_binding_unavailable" });
    expect(JSON.stringify(detail.confirmationCommunication)).not.toMatch(/private@example|Unsafe provider/);
  });
  it("requires actual explicit stored OFF before accepting no-row booking suppression", () => {
    const outcome = { status: "suppressed", communicationId: null, recipientEmail: null, reason: "operator_opted_out", errorCode: null, errorMessage: null };
    expect(normalizeJobSyncCompanyJobDetail({ job: { ...wire(), customer_notification_enabled: 0, confirmationCommunication: outcome } }, 12, 9)?.confirmationCommunication?.status).toBe("suppressed");
    expect(normalizeJobSyncCompanyJobDetail({ job: { ...wire(), customer_notification_enabled: null, confirmationCommunication: outcome } }, 12, 9)?.confirmationCommunication?.status).toBe("unknown");
  });
  it.each([null, undefined])("does not treat projected historic tax zero as known without stored evidence: %#", stored => {
    const detail = normalizeJobSyncCompanyJobDetail({ job: { ...wire(), tax_amount: stored, tax_rate_bps: stored } }, 12, 9)!;
    expect(detail.pricing?.taxAmount).toBeNull(); expect(detail.pricing?.taxRateBps).toBeNull(); expect(detail.pricing?.totalAmount).toBe(24);
  });
  it("keeps unsupported Company address/recipient controls unavailable rather than routing to legacy mutations", () => {
    const source = readFileSync(new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url), "utf8");
    expect(source).toContain("Service address editing is unavailable for Company Jobs.");
    expect(source).toContain("!companyJobMode && isCurrentLegacyAddressEntry()");
    expect(source).not.toContain("<CompanyJobInvoiceRecipient"); expect(source).not.toContain("<CompanyJobAddressEditor");
  });
});
