import { assertCompanyVerifiedContractRelease } from "./company-verified-contract-release";
import {
  captureCompanyInvoiceOperationIntent,
  companyInvoiceOperationBody,
  companyInvoiceOperationTerminal,
  normalizeCompanyInvoiceOperationLookup,
  isCompanyInvoiceOperationConflict,
  normalizeCompanyInvoiceOperationReceipt,
  normalizeCompanyInvoiceOperationKey,
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
    "The invoice outcome is uncertain. Do not send again; recover this operation with GET only.",
  conflict:
    "Persisted invoice recipient or communication identity conflicts with this request. Do not send again; review Company communication history.",
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
  return Object.freeze({
    state,
    operationKey: record?.operationKey ?? null,
    // A conflict is not proof that either identity belongs to this request.
    // Keep any old journal proof internally, but never expose it as this send.
    actualRecipient:
      state === "conflict" ? null : (record?.lookup?.recipientEmail ?? null),
    communicationId:
      state === "conflict" ? null : (record?.lookup?.communicationId ?? null),
    lookup: state === "conflict" ? null : (record?.lookup ?? null),
    isDelivered:
      state === "completed" && record?.lookup?.status === "delivered",
    message:
      record?.lookup?.status === "delivered" && state === "completed"
        ? "The backend confirmed invoice delivery to the persisted recipient."
        : messages[state],
  });
}
class StaleInvoiceCallback extends Error {}
/**
 * Keep at manager-screen lifetime. Every async continuation rejects a stale
 * layout-committed token/Company/user/role/Job/sheet/focus capture. No POST retry
 * exists, even after a not_found lookup or process restart of a prepared record.
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
    const explicitKey =
      context.operationKey === undefined
        ? null
        : normalizeCompanyInvoiceOperationKey(context.operationKey);
    const check = () => {
      if (!isCurrent(intent)) throw new StaleInvoiceCallback();
    };
    check(); // Scope captured/checked before operation-key generation or storage.
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
      const previous = record;
      if (!(await store.compareAndSwap(previous, next)))
        throw new Error(
          "Invoice recovery identity changed concurrently. Do not send again.",
        );
      record = next;
      check();
    }
    async function holdConflict(): Promise<CompanyInvoiceOperationResult> {
      if (record && record.phase !== "conflict")
        await persist(
          updateCompanyInvoiceOperationRecord(record, { phase: "conflict" }),
        );
      return result("conflict", record);
    }
    async function recoverRecord(): Promise<CompanyInvoiceOperationResult> {
      if (!record) return result("not_found");
      const original = record;
      let raw: unknown;
      try {
        check();
        raw = await api!.lookup(
          intent.token,
          intent.jobId,
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
      let lookup: CompanyInvoiceOperationLookup;
      try {
        lookup = normalizeCompanyInvoiceOperationLookup(
          raw,
          original.operationKey,
        );
      } catch (error) {
        if (isCompanyInvoiceOperationConflict(error))
          return await holdConflict();
        if (original.phase === "conflict") return result("conflict", record);
        return result("uncertain", record);
      }
      if (original.phase === "conflict") return result("conflict", record);
      // A successful echoed POST key with no corresponding persisted GET key
      // cannot authorize the receipt's communication (including fc3 insert races).
      if (
        lookup.status === "not_found" &&
        original.receiptIdentity !== null &&
        original.lookup === null
      )
        return await holdConflict();
      if (
        lookup.status === "temporarily_unavailable" ||
        lookup.status === "not_found"
      )
        return result(lookup.status, record);
      const mismatch =
        original.phase === "prepared" ||
        (original.requestedRecipient !== null &&
          original.requestedRecipient !== lookup.recipientEmail) ||
        (original.lookup?.communicationId != null &&
          (original.lookup.communicationId !== lookup.communicationId ||
            original.lookup.recipientEmail !== lookup.recipientEmail)) ||
        (original.receiptIdentity !== null &&
          (original.receiptIdentity.communicationId !==
            lookup.communicationId ||
            original.receiptIdentity.recipientEmail !== lookup.recipientEmail));
      if (mismatch) return await holdConflict();
      await persist(
        updateCompanyInvoiceOperationRecord(original, {
          phase: "verified",
          lookup,
        }),
      );
      const state =
        lookup.status === "provider_accepted" || lookup.status === "delivered"
          ? "completed"
          : lookup.status;
      return result(state, record);
    }
    try {
      record = await store.read(intent.companyId, intent.userId, intent.jobId);
      check();
      if (record && record.role !== intent.role)
        return result("conflict", record);
      if (mode === "recover") return await recoverRecord();
      // A new resend requires an explicit key captured ONCE by the user's
      // authorized new-resend action. Never generate one inside Send: a restarted
      // callback must reconcile the stored operation, not invent another resend.
      if (intent.options.resend && explicitKey === null)
        return record ? await recoverRecord() : result("uncertain");
      const desiredKey = explicitKey ?? "job-invoice";
      if (record) {
        // GET has no intent-kind proof. A reused key cannot become a different
        // send/resend or recipient choice, even if the recipient stayed the same.
        if (
          record.operationKey === desiredKey &&
          (record.resend !== intent.options.resend ||
            record.requestedRecipient !==
              (intent.options.recipientEmail ?? null))
        )
          return await holdConflict();
        const recovered = await recoverRecord();
        check();
        // Existing initial, same captured resend, any uncertain/unknown or
        // recipient conflict are GET-only. Never clear a pointer on not_found.
        if (
          !intent.options.resend ||
          record.operationKey === desiredKey ||
          recovered.state === "conflict" ||
          !record.lookup ||
          !companyInvoiceOperationTerminal(record.lookup) ||
          !["completed", "failed"].includes(recovered.state)
        )
          return recovered;
      } else if (intent.options.resend) {
        return result("uncertain"); // No local prior verified operation to authorize a new resend.
      }
      const prepared = newCompanyInvoiceOperationRecord(intent, desiredKey);
      await persist(prepared);
      // Initial preflight also detects earlier legacy/default operation with this
      // key. Only a brand-new explicitly authorized operation can write after
      // absence; recovery of a prepared/uncertain pointer never takes this path.
      let before: CompanyInvoiceOperationLookup;
      try {
        check();
        before = normalizeCompanyInvoiceOperationLookup(
          await api.lookup(intent.token, intent.jobId, desiredKey),
          desiredKey,
        );
        check();
      } catch (error) {
        if (error instanceof StaleInvoiceCallback) throw error;
        check();
        if (isCompanyInvoiceOperationConflict(error))
          return await holdConflict();
        return result("temporarily_unavailable", record);
      }
      // A newly prepared local pointer cannot claim a pre-existing operation,
      // even when its recipient matches: fc3 GET omits requested intent-kind.
      if (before.status === "temporarily_unavailable")
        return result("temporarily_unavailable", record);
      if (before.status !== "not_found") return await holdConflict();
      await persist(
        updateCompanyInvoiceOperationRecord(record!, { phase: "uncertain" }),
      );
      check(); // The durable uncertain marker is committed BEFORE dispatch.
      let receipt;
      try {
        const raw = await api.send(
          intent.token,
          intent.jobId,
          companyInvoiceOperationBody(intent, desiredKey),
        );
        check();
        receipt = normalizeCompanyInvoiceOperationReceipt(raw, desiredKey);
      } catch (error) {
        if (error instanceof StaleInvoiceCallback) throw error;
        check();
        if (isCompanyInvoiceOperationConflict(error))
          return await holdConflict();
        return result("uncertain", record); // No automatic resend or POST-as-status.
      }
      if (
        record!.requestedRecipient !== null &&
        receipt.recipientEmail !== record!.requestedRecipient
      )
        return await holdConflict();
      await persist(
        updateCompanyInvoiceOperationRecord(record!, {
          receiptIdentity: {
            communicationId: receipt.communicationId,
            recipientEmail: receipt.recipientEmail,
          },
        }),
      );
      // fc3 rejects different-key active collisions, but same-key reuse and the
      // duplicate-insert race still require independent GET identity agreement.
      return await recoverRecord();
    } catch (error) {
      if (error instanceof StaleInvoiceCallback) return result("stale", record);
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
