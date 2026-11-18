import { webcrypto } from "node:crypto";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createCompanyInvoiceOperationController,
  type CompanyInvoiceOperationTransport,
} from "../lib/company-job-invoice-operation-controller";
import {
  captureCompanyInvoiceOperationIntent,
  COMPANY_INVOICE_OPERATION_REVISION,
  CompanyInvoiceOperationConflictError,
  isCompanyInvoiceOperationConflict,
  normalizeCompanyInvoiceOperationLookup,
  normalizeCompanyInvoiceOperationReceipt,
  type CompanyInvoiceOperationContext,
} from "../lib/company-job-invoice-operation";
import {
  createCompanyInvoiceOperationStore,
  newCompanyInvoiceOperationRecord,
  updateCompanyInvoiceOperationRecord,
} from "../lib/company-job-invoice-operation-storage";
import { isCurrentCompanyInvoiceOperationIntent } from "../lib/company-job-invoice-operation-lifecycle";
import { COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY } from "../lib/company-job-invoice-recipient";
import { COMPANY_VERIFIED_CONTRACT_RELEASE } from "../lib/company-verified-contract-release";
import {
  backendRevision,
  invoiceC24Harness,
  invoiceC24JwtHarness,
} from "./fixtures/company-invoice-c24-source";

vi.mock("expo-crypto", () => ({ randomUUID: () => webcrypto.randomUUID() }));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
beforeAll(() =>
  vi.stubGlobal("fetch", () => {
    throw new Error("DENIED real HTTP");
  }),
);
afterAll(() => vi.unstubAllGlobals());
const current = () => true;
function context(
  resend = false,
  recipientEmail?: string,
  operationKey?: string,
): CompanyInvoiceOperationContext {
  return {
    session: {
      token: "synthetic-token-never-stored",
      portal: "company",
      company: { id: 9 },
      user: { id: 42, role: "owner" },
    },
    job: { id: 12, companyId: 9 },
    options: {
      method: "email",
      resend,
      ...(recipientEmail ? { recipientEmail } : {}),
    },
    lifetime: { sheetEpoch: 1, focusEpoch: 1 },
    ...(operationKey ? { operationKey } : {}),
  };
}
function native(data = new Map<string, string>()) {
  const adapter = {
    getItemAsync: vi.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  };
  return {
    data,
    adapter,
    store: createCompanyInvoiceOperationStore({
      platform: "ios",
      secureStore: adapter,
    }),
  };
}
function isolated(h = invoiceC24Harness(), journal = native()) {
  const transport: CompanyInvoiceOperationTransport = {
    send: vi.fn(async (_token, _job, body) => {
      const response = await h.send(body);
      if (response.code !== 200)
        throw Object.assign(
          new Error("Synthetic route rejection; payload not exposed"),
          {
            status: response.code,
            code: response.payload.error.code,
          },
        );
      return response.payload;
    }),
    lookup: vi.fn(async (_token, job, key) => {
      const response = await h.lookup(key, job);
      if (response.code !== 200)
        throw Object.assign(new Error("Synthetic GET rejection"), {
          status: response.code,
          code: response.payload.error.code,
        });
      return response.payload;
    }),
  };
  return {
    h,
    journal,
    transport,
    controller: createCompanyInvoiceOperationController({
      store: journal.store,
      isolatedTransport: transport,
    }),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function request(
  h: ReturnType<typeof invoiceC24Harness>,
  key: string,
  kind = "initial",
  recipient = "on-file@example.test",
  customerId = 41,
) {
  return {
    company: h.company,
    purpose: "job_invoice",
    entityType: "job",
    entityId: 12,
    customerId,
    recipientEmail: recipient,
    fallbackSenderName: "Synthetic",
    subject: "Invoice",
    html: "<p>Invoice</p>",
    intent: { kind, logicalSendKey: key },
    compatibility: { deliveryType: "invoice", jobId: 12 },
  };
}
function absent(key = "job-invoice") {
  return {
    operationKey: key,
    communicationId: null,
    recipientEmail: null,
    status: "not_found",
    communicationState: null,
    providerDispatchState: null,
    providerMessageId: null,
    attemptCount: null,
  };
}
function noIdentity(value: {
  actualRecipient: string | null;
  communicationId: number | null;
  lookup: unknown;
  isDelivered: boolean;
}) {
  expect(value).toMatchObject({
    actualRecipient: null,
    communicationId: null,
    lookup: null,
    isDelivered: false,
  });
}

describe("exact c24 persisted contract and repaired collision behavior (source auth STUB)", () => {
  it("pins the verified revision and reports capabilities without activating production", () => {
    expect(COMPANY_INVOICE_OPERATION_REVISION).toBe(backendRevision);
    expect(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY).toMatchObject({
      backendRevision,
      clientOperationKeySupported: true,
      explicitResendReplaySafe: true,
      authenticatedInvoiceReadbackAvailable: true,
      alternateRecipientSendingEnabled: false,
      restartSafeUncertainOperationRecovery: false,
    });
    expect(COMPANY_VERIFIED_CONTRACT_RELEASE).toMatchObject({
      recurrenceDeployed: false,
      recurrenceMigrationVerified: false,
      invoiceOperationsDeployed: false,
    });
  });
  it.each([undefined, "Alternate@Example.test"])(
    "same-key same-intent replay retains canonical ID and persisted recipient: %s",
    async (recipient) => {
      const h = invoiceC24Harness();
      const body = {
        method: "email",
        resend: false,
        operationKey: "job-invoice",
        ...(recipient ? { recipientEmail: recipient } : {}),
      };
      const first = await h.send(body);
      const replay = await h.send(body);
      expect(first.code).toBe(200);
      expect(replay.code).toBe(200);
      expect(replay.payload).toMatchObject({
        operationKey: "job-invoice",
        communicationId: first.payload.communicationId,
        sentTo: recipient?.toLowerCase() ?? "on-file@example.test",
      });
      const lookup = normalizeCompanyInvoiceOperationLookup(
        (await h.lookup("job-invoice")).payload,
        "job-invoice",
      );
      expect(lookup).toMatchObject({
        communicationId: first.payload.communicationId,
        recipientEmail: replay.payload.sentTo,
        status: "provider_accepted",
        attemptCount: 1,
      });
      expect(Object.keys(lookup).sort()).toEqual(Object.keys(absent()).sort());
      expect(h.provider.send).toHaveBeenCalledTimes(1);
      expect(h.rows).toHaveLength(1);
    },
  );
  it.each(["recipient", "customer", "intent"])(
    "same-key changed %s is conflict before another provider call",
    async (change) => {
      const durable: any = {};
      const h = invoiceC24Harness("owner", 9, true, durable);
      await h.send({ operationKey: "job-invoice" });
      if (change === "customer") {
        durable.jobCustomerId = 55;
        h.customer.id = 55;
      }
      const response = await h.send({
        operationKey: "job-invoice",
        resend: change === "intent",
        ...(change === "recipient"
          ? { recipientEmail: "other@example.test" }
          : {}),
      });
      expect(response.code).toBe(409);
      expect(response.payload.error.code).toBe("CONFLICT");
      expect(response.payload.communicationId).toBeUndefined();
      expect(response.payload.sentTo).toBeUndefined();
      expect(h.provider.send).toHaveBeenCalledTimes(1);
      expect(h.rows).toHaveLength(1);
    },
  );
  it("changed on-file email is checked, not silently substituted for an old canonical recipient", async () => {
    const h = invoiceC24Harness();
    const first = await h.send(); // Existing no-key route remains supported.
    h.customer.email = "new-on-file@example.test";
    expect((await h.send()).code).toBe(409);
    const lookup = (await h.lookup("job-invoice")).payload;
    expect(lookup.recipientEmail).toBe(first.payload.sentTo);
    expect(h.provider.send).toHaveBeenCalledTimes(1);
  });
  it.each(["queued", "sending"])(
    "direct distinct-key %s collision has no provider call or foreign payload",
    async (state) => {
      const h = invoiceC24Harness();
      await h.comm.reserveCompanyTransactionalEmail(
        h.db,
        request(h, "foreign-operation", "initial", "foreign@example.test"),
      );
      Object.assign(h.rows[0], {
        state,
        provider_dispatch_state:
          state === "queued" ? "queued" : "provider_started",
      });
      const response = await h.send({
        operationKey: "requested-operation",
        recipientEmail: "requested@example.test",
      });
      expect(response.code).toBe(409);
      expect(response.payload.error.code).toBe("CONFLICT");
      expect(JSON.stringify(response.payload)).not.toContain(
        "foreign@example.test",
      );
      expect(response.payload.communicationId).toBeUndefined();
      expect((await h.lookup("requested-operation")).payload).toEqual(
        absent("requested-operation"),
      );
      expect(h.provider.send).not.toHaveBeenCalled();
    },
  );
  it.each(["same", "different"])(
    "unique-INSERT distinct-key fallback repair rejects %s-recipient raced winner",
    async (recipient) => {
      const h = invoiceC24Harness();
      h.beforeInsert(async () => {
        h.beforeInsert(null);
        await h.comm.reserveCompanyTransactionalEmail(
          h.db,
          request(
            h,
            "winner-operation",
            "initial",
            recipient === "same"
              ? "requested@example.test"
              : "foreign@example.test",
          ),
        );
      });
      const response = await h.send({
        operationKey: "loser-operation",
        recipientEmail: "requested@example.test",
      });
      expect(response.code).toBe(409); // Old fallback would reuse + dispatch the winner.
      expect(response.payload.error.code).toBe("CONFLICT");
      expect(JSON.stringify(response.payload)).not.toContain(
        "foreign@example.test",
      );
      expect(response.payload.communicationId).toBeUndefined();
      expect(h.rows).toHaveLength(1);
      expect(h.rows[0].logical_send_key).toBe("winner-operation");
      expect(h.provider.send).not.toHaveBeenCalled();
      expect(
        h.connections.some((c) => c.rollback.mock.calls.length === 1),
      ).toBe(true);
      expect((await h.lookup("loser-operation")).payload.status).toBe(
        "not_found",
      );
      const winner = await h.send({
        operationKey: "winner-operation",
        recipientEmail: h.rows[0].recipient_email,
      });
      expect(winner.code).toBe(200);
      expect(winner.payload.communicationId).toBe(h.rows[0].id);
      expect(h.provider.send).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["recipient", "customer", "intent"])(
    "unique-INSERT same-key fallback checks raced %s before dispatch",
    async (change) => {
      const h = invoiceC24Harness();
      h.beforeInsert(async () => {
        h.beforeInsert(null);
        await h.comm.reserveCompanyTransactionalEmail(
          h.db,
          request(
            h,
            "job-invoice",
            change === "intent" ? "resend" : "initial",
            change === "recipient"
              ? "foreign@example.test"
              : "on-file@example.test",
          ),
        );
        if (change === "customer") h.rows[0].customer_id = 99;
      });
      const response = await h.send({ operationKey: "job-invoice" });
      expect(response.code).toBe(409);
      expect(response.payload.error.code).toBe("CONFLICT");
      expect(response.payload.communicationId).toBeUndefined();
      expect(h.provider.send).not.toHaveBeenCalled();
      expect(h.rows).toHaveLength(1);
    },
  );
  it("two same-key same-intent INSERT contenders resolve the same canonical reservation and claim once", async () => {
    const h = invoiceC24Harness();
    const barrier = deferred<void>();
    let entrants = 0;
    h.beforeInsert(async () => {
      if (++entrants === 2) barrier.resolve();
      await barrier.promise;
    });
    const input = request(h, "race-same-key");
    const [a, b] = await Promise.all([
      h.comm.reserveCompanyTransactionalEmail(h.db, input),
      h.comm.reserveCompanyTransactionalEmail(h.db, input),
    ]);
    expect(entrants).toBe(2);
    expect(a.communicationId).toBe(b.communicationId);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    const outcomes = await Promise.allSettled([
      h.comm.dispatchReservedCompanyTransactionalEmail(h.db, input, a),
      h.comm.dispatchReservedCompanyTransactionalEmail(h.db, input, b),
    ]);
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(
      true,
    );
    expect(h.rows).toHaveLength(1);
    expect(h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("explicit resend is replay safe only for its captured key and exact intent", async () => {
    const h = invoiceC24Harness();
    await h.send();
    const body = {
      operationKey: "explicit-resend-key",
      resend: true,
      recipientEmail: "second@example.test",
    };
    const first = await h.send(body);
    const replay = await h.send(body);
    expect(first.code).toBe(200);
    expect(replay.payload.communicationId).toBe(first.payload.communicationId);
    expect((await h.send({ ...body, resend: false })).code).toBe(409);
    expect(h.rows).toHaveLength(2);
    expect(h.rows[1]).toMatchObject({
      intent_kind: "resend",
      recipient_email: "second@example.test",
    });
    expect(h.provider.send).toHaveBeenCalledTimes(2);
  });
  it.each(["initial", "resend"])(
    "unique-INSERT %s winner cannot be adopted by opposite intent under same key",
    async (winnerKind) => {
      const h = invoiceC24Harness();
      h.beforeInsert(async () => {
        h.beforeInsert(null);
        await h.comm.reserveCompanyTransactionalEmail(
          h.db,
          request(h, "collision-same-key", winnerKind),
        );
      });
      const response = await h.send({
        operationKey: "collision-same-key",
        resend: winnerKind === "initial",
      });
      expect(response.code).toBe(409);
      expect(response.payload.communicationId).toBeUndefined();
      expect(h.rows[0].intent_kind).toBe(winnerKind);
      expect(h.provider.send).not.toHaveBeenCalled();
    },
  );
  it.each(["unknown", "acceptance-write-lost", "unknown-write-lost"])(
    "GET reflects %s provider boundary without another POST",
    async (failure) => {
      const h = invoiceC24Harness();
      if (failure !== "acceptance-write-lost") h.setProviderMode("unknown");
      if (failure === "acceptance-write-lost") h.interruptAcceptance();
      if (failure === "unknown-write-lost") h.interruptUnknown();
      expect((await h.send({ operationKey: "job-invoice" })).code).not.toBe(
        200,
      );
      const lookup = normalizeCompanyInvoiceOperationLookup(
        (await h.lookup("job-invoice")).payload,
        "job-invoice",
      );
      expect(lookup.status).toBe(
        failure === "unknown-write-lost" ? "provider_started" : "unknown",
      );
      expect(lookup.recipientEmail).toBe("on-file@example.test");
      expect(lookup.communicationId).toBe(1);
      expect(
        (await h.send({ operationKey: "new-resend-key", resend: true })).code,
      ).toBe(409);
      expect(h.provider.send).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["technician", "dispatcher", "foreign-company", "payments-off"])(
    "source-route Company scope/manager/payments checks: %s (not JWT proof)",
    async (scenario) => {
      const h = invoiceC24Harness(
        scenario === "technician"
          ? "technician"
          : scenario === "dispatcher"
            ? "dispatcher"
            : "owner",
        scenario === "foreign-company" ? 88 : 9,
        scenario !== "payments-off",
      );
      const response = await h.send({ operationKey: "job-invoice" });
      expect(response.code).toBe(
        scenario === "dispatcher"
          ? 200
          : scenario === "foreign-company"
            ? 404
            : 403,
      );
      const get = await h.lookup("job-invoice");
      expect(get.code).toBe(
        scenario === "technician" || scenario === "payments-off" ? 403 : 200,
      );
      if (scenario === "foreign-company")
        expect(get.payload.status).toBe("not_found");
      if (scenario !== "dispatcher")
        expect(h.provider.send).not.toHaveBeenCalled();
    },
  );
  it("GET is email-only and the unchanged SMS route does not forward an explicit operation key", async () => {
    const h = invoiceC24Harness();
    const sms = await h.send({
      method: "sms",
      operationKey: "sms-key-not-forwarded",
    });
    expect(sms.code).toBe(200);
    expect(sms.payload.operationKey).toBe("job-invoice");
    expect((await h.lookup("sms-key-not-forwarded")).payload.status).toBe(
      "not_found",
    );
    const f = isolated(h);
    await expect(
      f.controller.send(
        { ...context(), options: { method: "sms", resend: false } },
        current,
      ),
    ).rejects.toThrow("no verified SMS");
    expect(f.transport.send).not.toHaveBeenCalled();
  });
});

describe("mobile anchored recovery, durable holds, and no foreign identity adoption", () => {
  it("initial send requires persisted POST identity plus independent GET; same-key repeats are GET-only", async () => {
    const f = isolated();
    const sent = await f.controller.send(
      context(false, "confirmed@example.test"),
      current,
    );
    expect(sent).toMatchObject({
      state: "completed",
      communicationId: 1,
      actualRecipient: "confirmed@example.test",
      isDelivered: false,
    });
    const repeated = await f.controller.send(
      context(false, "confirmed@example.test"),
      current,
    );
    expect(repeated.communicationId).toBe(sent.communicationId);
    expect(f.transport.send).toHaveBeenCalledTimes(1);
    expect(await f.journal.store.read(9, 42, 12)).toMatchObject({
      phase: "verified",
      receiptIdentity: { communicationId: 1 },
      lookup: { communicationId: 1 },
    });
    expect([...f.journal.data.values()].join("")).not.toContain(
      "synthetic-token-never-stored",
    );
  });
  it("fresh keyed resend replaces only a verified terminal pointer; repeated choice never generates another key", async () => {
    const f = isolated();
    await f.controller.send(context(), current);
    const choice = context(
      true,
      "resend@example.test",
      "user-captured-resend-key",
    );
    expect((await f.controller.send(choice, current)).state).toBe("completed");
    expect((await f.controller.send(choice, current)).state).toBe("completed");
    expect(f.h.provider.send).toHaveBeenCalledTimes(2);
    expect((await f.journal.store.read(9, 42, 12))?.operationKey).toBe(
      choice.operationKey,
    );
  });
  it.each([
    "recipient",
    "initial-resend",
    "different-initial-key",
    "different-recovery-key",
  ])(
    "changed captured %s creates a sticky no-leak conflict",
    async (change) => {
      const f = isolated();
      await f.controller.send(
        context(false, "confirmed@example.test"),
        current,
      );
      const altered =
        change === "recipient"
          ? context(false, "other@example.test", "job-invoice")
          : change === "initial-resend"
            ? context(true, "confirmed@example.test", "job-invoice")
            : context(false, "confirmed@example.test", "foreign-key");
      const value =
        change === "different-recovery-key"
          ? await f.controller.recover(altered, current)
          : await f.controller.send(altered, current);
      expect(value.state).toBe("conflict");
      noIdentity(value);
      expect((await f.journal.store.read(9, 42, 12))?.phase).toBe("conflict");
      f.transport.lookup = vi.fn(async () => absent());
      const unavailable = await f.controller.recover(context(), current);
      expect(unavailable.state).toBe("conflict");
      noIdentity(unavailable);
      f.transport.lookup = vi.fn(async () => {
        throw new Error("GET unavailable");
      });
      expect((await f.controller.recover(context(), current)).state).toBe(
        "conflict",
      );
      expect(f.transport.send).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["recipient", "id", "key"])(
    "contradicting GET %s never replaces the durable identity or leaks it",
    async (change) => {
      const f = isolated();
      await f.controller.send(context(), current);
      const old = await f.journal.store.read(9, 42, 12);
      const lookup = {
        ...old!.lookup!,
        ...(change === "recipient"
          ? { recipientEmail: "foreign@example.test" }
          : change === "id"
            ? { communicationId: 77 }
            : { operationKey: "foreign-key" }),
      };
      f.transport.lookup = vi.fn(async () => lookup);
      const value = await f.controller.recover(context(), current);
      expect(value.state).toBe("conflict");
      noIdentity(value);
      const saved = await f.journal.store.read(9, 42, 12);
      expect(saved!.lookup).toEqual(old!.lookup);
      expect(saved!.receiptIdentity).toEqual(old!.receiptIdentity);
      expect(f.transport.send).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["same", "different", "resend"])(
    "fresh journal cannot adopt a pre-existing %s-recipient/intent key without immutable GET proof",
    async (scenario) => {
      const h = invoiceC24Harness();
      await h.send({
        operationKey: "job-invoice",
        resend: scenario === "resend",
        recipientEmail:
          scenario === "different"
            ? "foreign@example.test"
            : "requested@example.test",
      });
      const f = isolated(h);
      const value = await f.controller.send(
        context(false, "requested@example.test"),
        current,
      );
      expect(value.state).toBe("conflict");
      noIdentity(value);
      expect(f.transport.send).not.toHaveBeenCalled();
      expect((await f.journal.store.read(9, 42, 12))?.lookup).toBeNull();
      expect((await f.controller.recover(context(), current)).state).toBe(
        "conflict",
      );
    },
  );
  it("repaired backend 409 survives GET not_found and restart without any foreign identity or resend", async () => {
    const h = invoiceC24Harness();
    await h.comm.reserveCompanyTransactionalEmail(
      h.db,
      request(h, "foreign-operation", "initial", "foreign@example.test"),
    );
    const f = isolated(h);
    const first = await f.controller.send(context(), current);
    expect(first.state).toBe("conflict");
    noIdentity(first);
    const restarted = createCompanyInvoiceOperationController({
      store: native(f.journal.data).store,
      isolatedTransport: f.transport,
    });
    const again = await restarted.recover(context(), current);
    expect(again.state).toBe("conflict");
    noIdentity(again);
    expect((await f.journal.store.read(9, 42, 12))?.operationKey).toBe(
      "job-invoice",
    );
    expect(f.transport.send).toHaveBeenCalledTimes(1);
    expect(h.provider.send).not.toHaveBeenCalled();
  });
  it.each(["recipient", "key", "missing-GET"])(
    "contradicting POST %s never authorizes or exposes a foreign acknowledgment",
    async (change) => {
      const f = isolated();
      const send = f.transport.send;
      f.transport.send = vi.fn(async (token, job, body) => {
        const raw = (await send(token, job, body)) as Record<string, unknown>;
        if (change === "missing-GET")
          f.transport.lookup = vi.fn(async () => absent());
        return {
          ...raw,
          ...(change === "recipient"
            ? { sentTo: "foreign@example.test" }
            : change === "key"
              ? { operationKey: "foreign-key" }
              : {}),
        };
      });
      const value = await f.controller.send(
        context(false, "requested@example.test"),
        current,
      );
      expect(value.state).toBe("conflict");
      noIdentity(value);
      const saved = await f.journal.store.read(9, 42, 12);
      expect(saved!.lookup).toBeNull();
      if (change !== "missing-GET") expect(saved!.receiptIdentity).toBeNull();
      await f.controller.recover(context(), current);
      expect(f.transport.send).toHaveBeenCalledTimes(1);
    },
  );
  it("HTTP lost before any acknowledgment has no immutable intent anchor and remains held despite GET acceptance", async () => {
    const f = isolated();
    const send = f.transport.send;
    f.transport.send = vi.fn(async (token, job, body) => {
      await send(token, job, body);
      throw new Error("lost response");
    });
    expect((await f.controller.send(context(), current)).state).toBe(
      "uncertain",
    );
    expect((await f.h.lookup("job-invoice")).payload.status).toBe(
      "provider_accepted",
    );
    const restarted = createCompanyInvoiceOperationController({
      store: native(f.journal.data).store,
      isolatedTransport: f.transport,
    });
    const recovered = await restarted.recover(context(), current);
    expect(recovered.state).toBe("uncertain");
    noIdentity(recovered);
    await restarted.send(context(), current);
    await restarted.send(
      context(true, undefined, "do-not-auto-resend-key"),
      current,
    );
    expect(f.transport.send).toHaveBeenCalledTimes(1);
    expect((await f.journal.store.read(9, 42, 12))?.phase).toBe("uncertain");
  });
  it("lost same-key 409 cannot masquerade as a successful different-intent winner through GET", async () => {
    const f = isolated();
    f.h.beforeInsert(async () => {
      f.h.beforeInsert(null);
      await f.h.comm.reserveCompanyTransactionalEmail(
        f.h.db,
        request(f.h, "job-invoice", "resend"),
      );
      Object.assign(f.h.rows[0], {
        state: "provider_accepted",
        provider_dispatch_state: "provider_accepted",
      });
    });
    const send = f.transport.send;
    f.transport.send = vi.fn(async (token, job, body) => {
      try {
        return await send(token, job, body);
      } catch {
        throw new Error("HTTP conflict response lost");
      }
    });
    expect((await f.controller.send(context(), current)).state).toBe(
      "uncertain",
    );
    const recovered = await f.controller.recover(context(), current);
    expect(recovered.state).toBe("uncertain");
    noIdentity(recovered);
    expect(f.h.provider.send).not.toHaveBeenCalled();
  });
  it("journaled POST acknowledgment survives lost GET and restart; actual recipient is from independent GET", async () => {
    const f = isolated();
    const lookup = f.transport.lookup;
    let calls = 0;
    f.transport.lookup = vi.fn(async (token, job, key) => {
      if (++calls > 1) throw new Error("GET response lost");
      return lookup(token, job, key);
    });
    expect(
      (
        await f.controller.send(
          context(false, "persisted@example.test"),
          current,
        )
      ).state,
    ).toBe("temporarily_unavailable");
    expect(await f.journal.store.read(9, 42, 12)).toMatchObject({
      receiptIdentity: {
        communicationId: 1,
        recipientEmail: "persisted@example.test",
      },
      lookup: null,
    });
    f.transport.lookup = lookup;
    const restarted = createCompanyInvoiceOperationController({
      store: native(f.journal.data).store,
      isolatedTransport: f.transport,
    });
    const recovered = await restarted.recover(context(), current);
    expect(recovered).toMatchObject({
      state: "completed",
      actualRecipient: "persisted@example.test",
      communicationId: 1,
      isDelivered: false,
    });
    expect(f.transport.send).toHaveBeenCalledTimes(1);
  });
  it("legacy GET-only verified journal is held without adopting its recipient or authorizing resend", async () => {
    const f = isolated();
    await f.h.send();
    const prepared = newCompanyInvoiceOperationRecord(
      captureCompanyInvoiceOperationIntent(context()),
      "job-invoice",
    );
    await f.journal.store.compareAndSwap(null, prepared);
    const legacy = updateCompanyInvoiceOperationRecord(prepared, {
      phase: "verified",
      lookup: (await f.h.lookup("job-invoice")).payload,
    });
    await f.journal.store.compareAndSwap(prepared, legacy);
    const recovered = await f.controller.recover(context(), current);
    expect(recovered.state).toBe("uncertain");
    noIdentity(recovered);
    expect(
      (
        await f.controller.send(
          context(true, undefined, "new-key-held"),
          current,
        )
      ).state,
    ).toBe("uncertain");
    expect(f.transport.send).not.toHaveBeenCalled();
    expect((await f.journal.store.read(9, 42, 12))?.operationKey).toBe(
      "job-invoice",
    );
  });
  it.each([
    "unknown",
    "provider_started",
    "not_found",
    "temporarily_unavailable",
  ])(
    "anchored %s GET stays held without POST retry or pointer clearing",
    async (status) => {
      const f = isolated();
      await f.controller.send(context(), current);
      const old = await f.journal.store.read(9, 42, 12);
      if (status === "unknown" || status === "provider_started")
        Object.assign(f.h.rows[0], {
          state: "sending",
          provider_dispatch_state:
            status === "unknown" ? "provider_unknown" : "provider_started",
        });
      else f.transport.lookup = vi.fn(async () => ({ ...absent(), status }));
      expect((await f.controller.recover(context(), current)).state).toBe(
        status,
      );
      expect(
        (
          await f.controller.send(
            context(true, undefined, "explicit-new-key"),
            current,
          )
        ).state,
      ).toBe(status);
      expect((await f.journal.store.read(9, 42, 12))?.operationKey).toBe(
        old!.operationKey,
      );
      expect(f.transport.send).toHaveBeenCalledTimes(1);
    },
  );
  it("delivery requires actual delivered GET rather than sent/provider accepted acknowledgment", async () => {
    const f = isolated();
    expect((await f.controller.send(context(), current)).isDelivered).toBe(
      false,
    );
    f.h.rows[0].state = "delivered";
    expect((await f.controller.recover(context(), current)).isDelivered).toBe(
      true,
    );
  });
  it("prepared journal after process death never POSTs or adopts a discovered operation", async () => {
    const f = isolated();
    const prepared = newCompanyInvoiceOperationRecord(
      captureCompanyInvoiceOperationIntent(context()),
      "job-invoice",
    );
    await f.journal.store.compareAndSwap(null, prepared);
    expect((await f.controller.send(context(), current)).state).toBe(
      "not_found",
    );
    await f.h.send();
    expect((await f.controller.recover(context(), current)).state).toBe(
      "conflict",
    );
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it("captured callbacks reject concrete token/scope/options/lifetime changes before POST", async () => {
    const f = isolated();
    const entered = deferred<void>();
    const wait = deferred<unknown>();
    f.transport.lookup = vi.fn(async () => {
      entered.resolve();
      return wait.promise;
    });
    const start = context();
    const live = {
      mounted: true,
      focused: true,
      appActive: true,
      context: start,
    };
    const pending = f.controller.send(start, (intent) =>
      isCurrentCompanyInvoiceOperationIntent(intent, live),
    );
    await entered.promise;
    live.context = {
      ...start,
      session: { ...start.session!, token: "replacement-token" },
      lifetime: { sheetEpoch: 2, focusEpoch: 2 },
      options: {
        method: "email",
        resend: true,
        recipientEmail: "edited@example.test",
      },
    };
    wait.resolve(absent());
    const value = await pending;
    expect(value.state).toBe("stale");
    noIdentity(value);
    expect(f.transport.send).not.toHaveBeenCalled();
  });
  it.each([
    "company",
    "user",
    "role",
    "job",
    "recipient",
    "resend",
    "key",
    "sheet",
    "focus",
    "unmount",
    "background",
    "blur",
  ])(
    "captured preflight rejects a concrete stale %s callback without sending",
    async (field) => {
      const f = isolated();
      const entered = deferred<void>();
      const wait = deferred<unknown>();
      f.transport.lookup = vi.fn(async () => {
        entered.resolve();
        return wait.promise;
      });
      const start = context();
      const changed = context();
      const live = {
        mounted: true,
        focused: true,
        appActive: true,
        context: start,
      };
      const pending = f.controller.send(start, (intent) =>
        isCurrentCompanyInvoiceOperationIntent(intent, live),
      );
      await entered.promise;
      if (field === "company") changed.session!.company!.id = 88;
      if (field === "user") changed.session!.user.id = 99;
      if (field === "role") changed.session!.user.role = "dispatcher";
      if (field === "job") changed.job!.id = 13;
      live.context = {
        ...changed,
        ...(field === "recipient"
          ? {
              options: {
                ...changed.options,
                recipientEmail: "edited@example.test",
              },
            }
          : {}),
        ...(field === "resend"
          ? { options: { ...changed.options, resend: true } }
          : {}),
        ...(field === "key" ? { operationKey: "edited-operation-key" } : {}),
        ...(field === "sheet"
          ? { lifetime: { sheetEpoch: 2, focusEpoch: 1 } }
          : {}),
        ...(field === "focus"
          ? { lifetime: { sheetEpoch: 1, focusEpoch: 2 } }
          : {}),
      };
      if (field === "unmount") live.mounted = false;
      if (field === "background") live.appActive = false;
      if (field === "blur") live.focused = false;
      wait.resolve(absent());
      const value = await pending;
      expect(value.state).toBe("stale");
      noIdentity(value);
      expect(f.transport.send).not.toHaveBeenCalled();
    },
  );
  it("stale after POST retains durable uncertain marker and reveals no receipt identity", async () => {
    const f = isolated();
    const entered = deferred<void>();
    const wait = deferred<void>();
    const send = f.transport.send;
    let live = true;
    f.transport.send = vi.fn(async (token, job, body) => {
      const raw = await send(token, job, body);
      entered.resolve();
      await wait.promise;
      return raw;
    });
    const pending = f.controller.send(context(), () => live);
    await entered.promise;
    live = false;
    wait.resolve();
    const value = await pending;
    expect(value.state).toBe("stale");
    noIdentity(value);
    expect(await f.journal.store.read(9, 42, 12)).toMatchObject({
      phase: "uncertain",
      receiptIdentity: null,
      lookup: null,
    });
  });
  it("two controllers and a duplicate tap share journal CAS with at most one dispatch", async () => {
    const f = isolated();
    const second = createCompanyInvoiceOperationController({
      store: f.journal.store,
      isolatedTransport: f.transport,
    });
    const outcomes = await Promise.allSettled([
      f.controller.send(context(), current),
      f.controller.send(context(), current),
      second.send(context(), current),
    ]);
    expect(
      outcomes.some(
        (o) => o.status === "fulfilled" && o.value.state === "busy",
      ),
    ).toBe(true);
    expect(f.transport.send).toHaveBeenCalledTimes(1);
    expect(f.h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("production transport is blocked before protected storage or network use", async () => {
    const f = isolated();
    const production = createCompanyInvoiceOperationController({
      store: f.journal.store,
      transport: f.transport,
    });
    expect((await production.send(context(), current)).state).toBe("blocked");
    expect((await production.recover(context(), current)).state).toBe(
      "blocked",
    );
    expect(f.journal.adapter.getItemAsync).not.toHaveBeenCalled();
    expect(f.transport.send).not.toHaveBeenCalled();
    expect(f.transport.lookup).not.toHaveBeenCalled();
  });
  it("a foreign store scope is rejected without revealing any recorded identity", async () => {
    const f = isolated();
    await f.controller.send(context(), current);
    const row = await f.journal.store.read(9, 42, 12);
    const foreign = createCompanyInvoiceOperationController({
      isolatedTransport: f.transport,
      store: {
        read: async () => ({ ...row!, companyId: 88 }),
        compareAndSwap: vi.fn(),
      },
    });
    const value = await foreign.recover(context(), current);
    expect(value.state).toBe("conflict");
    noIdentity(value);
    expect(value.operationKey).toBeNull();
  });
  it("same-key update never clears sticky conflict or replaces receipt identity", async () => {
    const f = isolated();
    await f.controller.send(context(), current);
    const record = (await f.journal.store.read(9, 42, 12))!;
    const conflict = updateCompanyInvoiceOperationRecord(record, {
      phase: "conflict",
    });
    await f.journal.store.compareAndSwap(record, conflict);
    expect(() =>
      f.journal.store.compareAndSwap(
        conflict,
        updateCompanyInvoiceOperationRecord(conflict, { phase: "verified" }),
      ),
    ).toThrow();
  });
});

describe("strict exact DTOs and independent REAL JWT source checks (fake membership SQL, no HTTP)", () => {
  it("foreign key is typed conflict even on malformed DTO; error text cannot expose foreign data", () => {
    for (const normalize of [
      normalizeCompanyInvoiceOperationLookup,
      normalizeCompanyInvoiceOperationReceipt,
    ]) {
      expect(() =>
        normalize(
          {
            operationKey: "foreign-key",
            recipientEmail: "foreign@example.test",
            communicationId: 77,
          },
          "job-invoice",
        ),
      ).toThrow(CompanyInvoiceOperationConflictError);
    }
    expect(
      isCompanyInvoiceOperationConflict({ status: 409, code: "CONFLICT" }),
    ).toBe(true);
    expect(
      isCompanyInvoiceOperationConflict({ status: 400, code: "CONFLICT" }),
    ).toBe(false);
    expect(new CompanyInvoiceOperationConflictError().message).not.toContain(
      "foreign@example.test",
    );
  });
  it("strict lookup rejects extra/missing fields, populated absence and inconsistent provider states", () => {
    expect(() =>
      normalizeCompanyInvoiceOperationLookup(
        { ...absent(), customerId: 41 },
        "job-invoice",
      ),
    ).toThrow();
    expect(() =>
      normalizeCompanyInvoiceOperationLookup(
        { ...absent(), communicationId: 77 },
        "job-invoice",
      ),
    ).toThrow(CompanyInvoiceOperationConflictError);
    expect(() =>
      normalizeCompanyInvoiceOperationLookup(
        {
          ...absent(),
          status: "delivered",
          communicationId: 1,
          recipientEmail: "a@example.test",
          communicationState: "delivered",
          providerDispatchState: "provider_unknown",
          attemptCount: 1,
        },
        "job-invoice",
      ),
    ).toThrow();
    expect(() =>
      normalizeCompanyInvoiceOperationReceipt(
        { success: true, status: "sent" },
        "job-invoice",
      ),
    ).toThrow();
  });
  async function token(
    overrides: Record<string, unknown> = {},
    secret = "field-service-development-secret-change-me",
    audience = "hsc-mobile",
    expiry = "1h",
  ) {
    return new SignJWT({
      kind: "mobile_company",
      accountType: "company",
      accountId: 42,
      companyId: 9,
      role: "owner",
      name: "Synthetic",
      ...overrides,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiry)
      .sign(new TextEncoder().encode(secret));
  }
  it("actual jose verifies token and actual requireMobileCompany uses live membership role, not JWT owner snapshot", async () => {
    const h = await invoiceC24JwtHarness({ liveRole: "technician" });
    const signed = await token();
    const required = await h.auth.requireMobileCompany({
      header: () => `Bearer ${signed}`,
    });
    expect(required.companyId).toBe(9);
    expect(required.claims.role).toBe("technician");
    expect(h.db.execute).toHaveBeenCalledWith(
      expect.stringContaining("cu.is_active = 1"),
      [42, 9],
    );
    const sourceRoute = invoiceC24Harness(
      required.claims.role,
      required.companyId,
    );
    expect((await sourceRoute.send()).code).toBe(403);
    expect((await sourceRoute.lookup("job-invoice")).code).toBe(403);
  });
  it.each([
    "wrong-signature",
    "wrong-audience",
    "expired",
    "wrong-kind",
    "platform",
    "inactive",
    "revoked",
    "no-bearer",
  ])("actual JWT/Company authorization rejects %s", async (failure) => {
    const h = await invoiceC24JwtHarness({
      active: failure !== "inactive",
      revoked: failure === "revoked",
    });
    const signed = await token(
      failure === "wrong-kind"
        ? { kind: "mobile_platform_admin" }
        : failure === "platform"
          ? { accountType: "platform_admin", kind: "mobile_platform_admin" }
          : {},
      failure === "wrong-signature" ? "wrong-secret" : undefined,
      failure === "wrong-audience" ? "other-audience" : undefined,
      failure === "expired" ? "-1s" : undefined,
    );
    await expect(
      h.auth.requireMobileCompany({
        header: () => (failure === "no-bearer" ? "" : `Bearer ${signed}`),
      }),
    ).rejects.toThrow();
  });
});
