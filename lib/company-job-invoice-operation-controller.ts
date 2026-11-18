import { assertCompanyVerifiedContractRelease } from "./company-verified-contract-release";
import {
  captureCompanyInvoiceOperationIntent,
  companyInvoiceOperationBody,
  companyInvoiceOperationTerminal,
  isCompanyInvoiceOperationConflict,
  normalizeCompanyInvoiceOperationLookup,
  normalizeCompanyInvoiceOperationReceipt,
  type CompanyInvoiceOperationBody,
  type CompanyInvoiceOperationContext,
  type CompanyInvoiceOperationIntent,
  type CompanyInvoiceOperationLookup,
} from "./company-job-invoice-operation";
import {
  companyInvoiceOperationStore,
  newCompanyInvoiceOperationRecord,
  updateCompanyInvoiceOperationRecord,
  type CompanyInvoiceOperationRecord,
  type CompanyInvoiceOperationStore,
} from "./company-job-invoice-operation-storage";

export interface CompanyInvoiceOperationTransport {
  send(
    token: string,
    jobId: number,
    body: CompanyInvoiceOperationBody,
  ): Promise<unknown>;
  lookup(token: string, jobId: number, operationKey: string): Promise<unknown>;
}
export type CompanyInvoiceOperationResult = Readonly<{
  state:
    | "blocked"
    | "busy"
    | "stale"
    | "not_found"
    | "temporarily_unavailable"
    | "uncertain"
    | "conflict"
    | "completed"
    | "failed"
    | "queued"
    | "provider_started"
    | "unknown";
  operationKey: string | null;
  actualRecipient: string | null;
  communicationId: number | null;
  lookup: CompanyInvoiceOperationLookup | null;
  isDelivered: boolean;
  message: string;
}>;
export type CompanyInvoiceOperationControllerOptions = {
  store?: CompanyInvoiceOperationStore;
  /** Production adapters require the separately authorized shared release gate. */
  transport?: CompanyInvoiceOperationTransport;
  /** Explicit OFFLINE seam. Never install an HTTP adapter in this property. */
  isolatedTransport?: CompanyInvoiceOperationTransport;
};
const messages = {
  blocked:
    "Invoice operation recovery is awaiting verified backend deployment. No new request was submitted.",
  busy: "An invoice operation is already active.",
  stale:
    "Invoice sheet or signed Company identity changed. Reopen the Job to recover the operation.",
  not_found:
    "No persisted operation was found for this key. This does not prove an earlier request had no effect. No invoice was resent.",
  temporarily_unavailable:
    "Invoice status is temporarily unavailable. Keep this operation key and recover with GET only.",
  uncertain:
    "The original invoice intent or outcome cannot be verified. Keep this journal and recover with GET only; do not send again.",
  conflict:
    "Persisted invoice scope, original intent or communication identity conflicts with this request. Do not send again; review Company communication history.",
  completed:
    "The persisted invoice operation was accepted by the provider. This is not proof of delivery.",
  failed:
    "The persisted invoice operation failed. Another send requires a separate explicit authorized resend choice.",
  queued: "The invoice operation is queued. Do not send again.",
  provider_started:
    "The provider send has started; the final outcome is not verified. Do not send again.",
  unknown:
    "The provider outcome is unknown. Do not send again; review Company communication history.",
};
function result(
  state: CompanyInvoiceOperationResult["state"],
  record: CompanyInvoiceOperationRecord | null = null,
): CompanyInvoiceOperationResult {
  const anchored =
    record?.originalEvidence != null &&
    record.phase === "verified" &&
    ["completed", "failed", "queued", "provider_started", "unknown"].includes(
      state,
    );
  const lookup = anchored ? (record?.lookup ?? null) : null;
  const delivered = state === "completed" && lookup?.status === "delivered";
  return Object.freeze({
    state,
    operationKey: state === "stale" ? null : (record?.operationKey ?? null),
    actualRecipient: lookup?.recipientEmail ?? null,
    communicationId: lookup?.communicationId ?? null,
    lookup,
    isDelivered: delivered,
    message: delivered
      ? "The backend confirmed invoice delivery to the persisted recipient."
      : messages[state],
  });
}
class StaleInvoiceCallback extends Error {}
/**
 * Manager-screen lifetime lock. No POST retry exists, including after a restart,
 * prepared journal, unavailable/not_found/unknown lookup or acknowledgment loss.
 * b29 original evidence comes from the protected journal, NEVER current Customer.
 */
export function createCompanyInvoiceOperationController(
  options: CompanyInvoiceOperationControllerOptions = {},
) {
  const store = options.store ?? companyInvoiceOperationStore;
  const active = new Set<string>();
  function transport(): CompanyInvoiceOperationTransport | null {
    if (options.isolatedTransport) return options.isolatedTransport;
    assertCompanyVerifiedContractRelease("invoice");
    return options.transport ?? null;
  }
  async function run(
    context: CompanyInvoiceOperationContext,
    isCurrent: (intent: CompanyInvoiceOperationIntent) => boolean,
    mode: "send" | "recover",
  ): Promise<CompanyInvoiceOperationResult> {
    const intent = captureCompanyInvoiceOperationIntent(context);
    const explicitKey = intent.operationKey;
    const check = () => {
      if (!isCurrent(intent)) throw new StaleInvoiceCallback();
    };
    if (!isCurrent(intent)) return result("stale");
    let api: CompanyInvoiceOperationTransport | null;
    try {
      api = transport();
    } catch {
      return result("blocked");
    }
    if (!api) return result("blocked");
    const actor = `${intent.companyId}:${intent.userId}:${intent.jobId}`;
    if (active.has(actor)) return result("busy");
    active.add(actor);
    let record: CompanyInvoiceOperationRecord | null = null;
    async function persist(next: CompanyInvoiceOperationRecord) {
      check();
      if (!(await store.compareAndSwap(record, next)))
        throw new Error(
          "Invoice recovery identity changed concurrently. Do not send again.",
        );
      record = next;
      check();
    }
    async function holdConflict(): Promise<CompanyInvoiceOperationResult> {
      if (record?.originalEvidence && record.phase !== "conflict")
        await persist(
          updateCompanyInvoiceOperationRecord(record, { phase: "conflict" }),
        );
      return result("conflict", record);
    }
    async function recoverRecord(): Promise<CompanyInvoiceOperationResult> {
      if (!record) return result("not_found");
      const original = record;
      let lookup: CompanyInvoiceOperationLookup;
      let raw: unknown;
      try {
        check();
        raw = await api!.lookup(
          intent.token,
          original.jobId,
          original.operationKey,
        );
        check();
      } catch (error) {
        if (error instanceof StaleInvoiceCallback) throw error;
        check();
        if (isCompanyInvoiceOperationConflict(error))
          return await holdConflict();
        if (original.phase === "conflict") return result("conflict", record);
        return result("temporarily_unavailable", record);
      }
      try {
        lookup = normalizeCompanyInvoiceOperationLookup(
          raw,
          original.operationKey,
          {
            companyId: original.companyId,
            jobId: original.jobId,
            ...(original.originalEvidence ?? {}),
          },
        );
      } catch (error) {
        if (error instanceof StaleInvoiceCallback) throw error;
        check();
        if (isCompanyInvoiceOperationConflict(error))
          return await holdConflict();
        if (original.phase === "conflict") return result("conflict", record);
        return result("uncertain", record);
      }
      if (original.phase === "conflict") return result("conflict", record);
      if (
        lookup.status === "not_found" ||
        lookup.status === "temporarily_unavailable"
      )
        return result(lookup.status, record);
      if (!original.originalEvidence) return result("uncertain", record);
      // A prepared pointer never reached our dispatch marker; it cannot adopt a
      // pre-existing winner, even with the same recipient and original intent.
      if (
        original.phase === "prepared" ||
        (original.requestedRecipient !== null &&
          original.requestedRecipient !== lookup.recipientEmail) ||
        (original.lookup?.communicationId != null &&
          (original.lookup.communicationId !== lookup.communicationId ||
            original.lookup.recipientEmail !== lookup.recipientEmail)) ||
        (original.receiptIdentity !== null &&
          (original.receiptIdentity.communicationId !==
            lookup.communicationId ||
            original.receiptIdentity.recipientEmail !== lookup.recipientEmail))
      )
        return await holdConflict();
      // Historical journals cannot acquire missing original Customer/intent from
      // current detail or GET. Retain them unchanged and read-only held.
      await persist(
        updateCompanyInvoiceOperationRecord(original, {
          phase: "verified",
          lookup,
        }),
      );
      return result(
        lookup.status === "provider_accepted" || lookup.status === "delivered"
          ? "completed"
          : lookup.status,
        record,
      );
    }
    try {
      record = await store.read(intent.companyId, intent.userId, intent.jobId);
      check();
      if (
        record &&
        (record.companyId !== intent.companyId ||
          record.userId !== intent.userId ||
          record.jobId !== intent.jobId)
      )
        return result("conflict");
      if (record && record.role !== intent.role)
        return result("conflict", record);
      if (
        record &&
        explicitKey !== null &&
        ((mode === "recover" && explicitKey !== record.operationKey) ||
          (explicitKey === record.operationKey &&
            (record.resend !== intent.options.resend ||
              record.requestedRecipient !==
                (intent.options.recipientEmail ?? null))) ||
          (mode === "send" &&
            !intent.options.resend &&
            explicitKey !== record.operationKey))
      )
        return await holdConflict();
      if (mode === "recover") return await recoverRecord();
      if (intent.options.resend && explicitKey === null)
        return record ? await recoverRecord() : result("uncertain");
      const desiredKey = explicitKey ?? "job-invoice";
      if (record) {
        if (
          record.operationKey === desiredKey &&
          (record.resend !== intent.options.resend ||
            record.requestedRecipient !==
              (intent.options.recipientEmail ?? null))
        )
          return await holdConflict();
        const recovered = await recoverRecord();
        check();
        if (
          !intent.options.resend ||
          record.operationKey === desiredKey ||
          !record.originalEvidence ||
          !record.lookup ||
          !companyInvoiceOperationTerminal(record.lookup) ||
          !["completed", "failed"].includes(recovered.state)
        )
          return recovered;
      } else if (intent.options.resend) {
        return result("uncertain");
      }
      // Missing fresh original Customer/effective recipient must never create an
      // unanchored journal or submit POST. Existing legacy workflows are separate.
      if (!intent.originalEvidence) return result("uncertain", record);
      await persist(newCompanyInvoiceOperationRecord(intent, desiredKey));
      let before: CompanyInvoiceOperationLookup;
      try {
        check();
        const raw = await api.lookup(intent.token, intent.jobId, desiredKey);
        check();
        before = normalizeCompanyInvoiceOperationLookup(raw, desiredKey, {
          companyId: intent.companyId,
          jobId: intent.jobId,
        });
      } catch (error) {
        if (error instanceof StaleInvoiceCallback) throw error;
        check();
        if (isCompanyInvoiceOperationConflict(error))
          return await holdConflict();
        return result("temporarily_unavailable", record);
      }
      if (before.status === "temporarily_unavailable")
        return result("temporarily_unavailable", record);
      if (before.status !== "not_found") return await holdConflict();
      await persist(
        updateCompanyInvoiceOperationRecord(record!, { phase: "uncertain" }),
      );
      check(); // Original immutable evidence + dispatch marker durable BEFORE POST.
      let receipt;
      try {
        const raw = await api.send(
          intent.token,
          intent.jobId,
          companyInvoiceOperationBody(intent, desiredKey),
        );
        check();
        if (isCompanyInvoiceOperationConflict(raw)) return await holdConflict();
        receipt = normalizeCompanyInvoiceOperationReceipt(raw, desiredKey);
      } catch (error) {
        if (error instanceof StaleInvoiceCallback) throw error;
        check();
        if (isCompanyInvoiceOperationConflict(error))
          return await holdConflict();
        return result("uncertain", record);
      }
      if (receipt.recipientEmail !== record!.originalEvidence!.recipientEmail)
        return await holdConflict();
      await persist(
        updateCompanyInvoiceOperationRecord(record!, {
          receiptIdentity: {
            communicationId: receipt.communicationId,
            recipientEmail: receipt.recipientEmail,
          },
        }),
      );
      return await recoverRecord();
    } catch (error) {
      if (error instanceof StaleInvoiceCallback) return result("stale");
      throw error;
    } finally {
      active.delete(actor);
    }
  }
  return Object.freeze({
    send: (
      context: CompanyInvoiceOperationContext,
      isCurrent: (intent: CompanyInvoiceOperationIntent) => boolean,
    ) => run(context, isCurrent, "send"),
    recover: (
      context: CompanyInvoiceOperationContext,
      isCurrent: (intent: CompanyInvoiceOperationIntent) => boolean,
    ) => run(context, isCurrent, "recover"),
  });
}
