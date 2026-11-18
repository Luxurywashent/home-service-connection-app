import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createCompanyInvoiceOperationController,
  type CompanyInvoiceOperationTransport,
} from "../lib/company-job-invoice-operation-controller";
import {
  captureCompanyInvoiceOperationIntent,
  companyInvoiceOperationBody,
  normalizeCompanyInvoiceOperationLookup,
  normalizeCompanyInvoiceOperationReceipt,
  type CompanyInvoiceOperationContext,
} from "../lib/company-job-invoice-operation";
import {
  copyCompanyInvoiceOperationRecord,
  createCompanyInvoiceOperationStore,
  newCompanyInvoiceOperationRecord,
  updateCompanyInvoiceOperationRecord,
} from "../lib/company-job-invoice-operation-storage";
import { COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY } from "../lib/company-job-invoice-recipient";
import {
  backend,
  backendRevision,
  extractB29,
  invoiceB29Harness,
} from "./fixtures/company-invoice-b29-source";
vi.mock("expo-crypto", () => ({ randomUUID: () => webcrypto.randomUUID() }));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
const deny = () => {
  throw new Error("DENIED live invoice network/provider/SQL");
};
beforeAll(async () => {
  vi.stubGlobal("fetch", deny);
  for (const module of ["node:http", "node:https", "node:net", "node:tls"]) {
    const value = await import(module);
    for (const name of ["request", "get", "connect", "createConnection"])
      if (typeof value.default[name] === "function")
        vi.spyOn(value.default, name).mockImplementation(deny);
  }
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const current = () => true;
function context(
  resend = false,
  recipientEmail?: string,
  operationKey?: string,
): CompanyInvoiceOperationContext {
  return {
    session: {
      token: "synthetic-memory-only",
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
    originalCustomerId: 41,
    onFileRecipientEmail: "on-file@example.test",
    ...(operationKey ? { operationKey } : {}),
  };
}
function nativeFixture(data = new Map<string, string>()) {
  const adapter = {
    getItemAsync: vi.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      if (value.length > 1800) throw new Error("Native chunk limit");
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
function isolated(h = invoiceB29Harness(), native = nativeFixture()) {
  const transport: CompanyInvoiceOperationTransport = {
    send: vi.fn(async (_token, _job, body) => {
      const response = await h.send(body);
      if (response.code !== 200)
        throw Object.assign(new Error("Synthetic route rejection"), {
          status: response.code,
          code: response.payload.error?.code,
        });
      return response.payload;
    }),
    lookup: vi.fn(async (_token, job, key) => {
      const response = await h.lookup(key, job);
      if (response.code !== 200)
        throw Object.assign(new Error("Synthetic GET rejection"), {
          status: response.code,
        });
      return response.payload;
    }),
  };
  const controller = createCompanyInvoiceOperationController({
    store: native.store,
    isolatedTransport: transport,
  });
  return { h, native, transport, controller };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function request(
  h: ReturnType<typeof invoiceB29Harness>,
  key: string,
  recipientEmail = "on-file@example.test",
  kind = "initial",
) {
  return {
    company: h.company,
    purpose: "job_invoice",
    entityType: "job",
    entityId: 12,
    customerId: 41,
    recipientEmail,
    fallbackSenderName: "Synthetic",
    subject: "Synthetic",
    html: "<p>Synthetic</p>",
    compatibility: { deliveryType: "invoice", jobId: 12 },
    intent: { kind, logicalSendKey: key },
  };
}
function barrier(h: ReturnType<typeof invoiceB29Harness>) {
  const gate = deferred<void>();
  let count = 0;
  h.beforeInsert.hook = async () => {
    count++;
    if (count === 2) gate.resolve();
    await gate.promise;
  };
}
function privateResult(
  value: Awaited<
    ReturnType<
      ReturnType<typeof createCompanyInvoiceOperationController>["send"]
    >
  >,
) {
  expect(value.actualRecipient).toBeNull();
  expect(value.communicationId).toBeNull();
  expect(value.lookup).toBeNull();
  expect(value.isDelivered).toBe(false);
}

describe("Exact b29 registered contract and isolated source boundaries", () => {
  it("pins final source and executes actual registered invoice paths (never /invoice/send)", () => {
    expect(backendRevision).toBe("b29f99b5ea9581a1c5a62271cc5bd979f83df345");
    const routes: [string, string, unknown][] = [];
    const app = new Proxy(
      {},
      {
        get:
          (_target, verb: string) =>
          (path: string, ...handlers: unknown[]) =>
            routes.push([verb, path, handlers.at(-1)]),
      },
    );
    const treeSource = readFileSync(backend + "mobileOperations.ts", "utf8");
    const identifiers = [
      ...treeSource.matchAll(
        /app\.(?:get|post|put|patch|delete)\([^\n]+,\s*(\w+)\);/g,
      ),
    ].map((m) => m[1]);
    const injected: Record<string, unknown> = Object.fromEntries(
      identifiers.map((name) => [name, () => undefined]),
    );
    injected.BASE = "/api/mobile/v1";
    const registration = extractB29(
      backend + "mobileOperations.ts",
      ["registerMobileOperationalRoutes"],
      injected,
    );
    registration.registerMobileOperationalRoutes(app);
    expect(routes.map(([verb, path]) => `${verb} ${path}`)).toContain(
      "post /api/mobile/v1/jobs/:jobId/invoice",
    );
    expect(routes.map(([verb, path]) => `${verb} ${path}`)).toContain(
      "get /api/mobile/v1/jobs/:jobId/invoice-operation",
    );
    expect(routes.some(([, path]) => path.includes("invoice/send"))).toBe(
      false,
    );
  });
  it("GET returns exactly 12 persisted fields and POST exactly unchanged acknowledgment fields", async () => {
    const h = invoiceB29Harness();
    const sent = await h.send({ operationKey: "job-invoice" });
    expect(sent.code).toBe(200);
    const lookup = (await h.lookup("job-invoice")).payload;
    expect(Object.keys(lookup).sort()).toEqual(
      [
        "companyId",
        "jobId",
        "customerId",
        "operationKey",
        "intentKind",
        "communicationId",
        "recipientEmail",
        "status",
        "communicationState",
        "providerDispatchState",
        "providerMessageId",
        "attemptCount",
      ].sort(),
    );
    expect(
      normalizeCompanyInvoiceOperationLookup(lookup, "job-invoice", {
        companyId: 9,
        jobId: 12,
        customerId: 41,
        recipientEmail: "on-file@example.test",
        intentKind: "initial",
      }),
    ).toMatchObject({
      status: "provider_accepted",
      customerId: 41,
      intentKind: "initial",
    });
    expect(Object.keys(sent.payload).sort()).toEqual(
      [
        "success",
        "operationKey",
        "deliveryId",
        "communicationId",
        "providerMessageId",
        "status",
        "communicationState",
        "publicUrl",
        "sentTo",
        "channel",
      ].sort(),
    );
    expect(
      normalizeCompanyInvoiceOperationReceipt(sent.payload, "job-invoice")
        .recipientEmail,
    ).toBe(h.rows[0].recipient_email);
    expect(h.provider.send.mock.calls[0][0].to).toEqual([
      lookup.recipientEmail,
    ]);
    expect(h.history[0].recipient_email).toBe(lookup.recipientEmail);
  });
  it.each(["technician", "admin", "developer"])(
    "source-auth STUB still denies %s at actual route manager guard before SQL/provider",
    async (role) => {
      const h = invoiceB29Harness(role);
      expect((await h.send()).code).toBe(403);
      expect((await h.lookup("job-invoice")).code).toBe(403);
      expect(h.db.execute).not.toHaveBeenCalled();
      expect(h.provider.send).not.toHaveBeenCalled();
    },
  );
  it.each(["owner", "dispatcher"])(
    "actual %s handler retains payments gate, Company and Customer boundaries",
    async (role) => {
      const disabled = invoiceB29Harness(role, 9, false);
      expect((await disabled.send()).code).toBe(403);
      expect(disabled.db.execute).not.toHaveBeenCalled();
      const foreign = invoiceB29Harness(role, 99);
      expect((await foreign.send()).code).toBe(404);
      expect((await foreign.lookup("job-invoice")).payload.status).toBe(
        "not_found",
      );
      expect(foreign.provider.send).not.toHaveBeenCalled();
      const h = invoiceB29Harness(role);
      h.customer.company_id = 99;
      expect((await h.send()).code).toBe(404);
      expect(h.rows).toHaveLength(0);
    },
  );
  it.each([
    { amount: 1 },
    { customerId: 41 },
    { recipientPhone: "fake" },
    { operationKey: "short" },
    { resend: "true" },
    { method: "sms", recipientEmail: "x@example.test" },
  ])("strict actual DTO rejects %j", async (body) => {
    const h = invoiceB29Harness();
    expect((await h.send(body)).code).toBe(400);
    expect(h.db.execute).not.toHaveBeenCalled();
    expect(h.provider.send).not.toHaveBeenCalled();
  });
  it("on-file no-key email and SMS retain historical route semantics (SMS seam not recovery proof)", async () => {
    const h = invoiceB29Harness();
    const email = await h.send();
    expect(email.payload.sentTo).toBe("on-file@example.test");
    const sms = await h.send({ method: "sms" });
    expect(sms.code).toBe(200);
    expect(sms.payload.sentTo).toBe("customer phone on file");
    expect(sms.payload.channel).toBe("sms");
    expect(
      COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.alternateRecipientSendingEnabled,
    ).toBe(false);
    expect(
      COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.smsRestartSafeRecovery,
    ).toBe(false);
  });
  it("old eight-field GET, missing/extra proof and guessed delivered states are not current recovery", async () => {
    const h = invoiceB29Harness();
    await h.send();
    const raw = (await h.lookup("job-invoice")).payload;
    const old = { ...raw };
    for (const field of ["companyId", "jobId", "customerId", "intentKind"])
      delete old[field];
    for (const invalid of [
      old,
      { ...raw, customerId: null },
      { ...raw, intentKind: null },
      { ...raw, delivered: true },
      { ...raw, status: "delivered" },
    ])
      expect(() =>
        normalizeCompanyInvoiceOperationLookup(invalid, "job-invoice"),
      ).toThrow();
  });
});

describe("Actual reserve/dispatch direct and INSERT races with canonical identity", () => {
  it.each(["recipient", "Customer", "kind"])(
    "same-key direct %s collision is 409, no provider or winner payload",
    async (field) => {
      const h = invoiceB29Harness();
      await h.comm.reserveCompanyTransactionalEmail(
        h.db,
        request(h, "same-key-001"),
      );
      if (field === "Customer") {
        h.job.customer_id = 43;
        h.customer.id = 43;
      }
      const response = await h.send({
        operationKey: "same-key-001",
        recipientEmail:
          field === "recipient" ? "other@example.test" : "on-file@example.test",
        resend: field === "kind",
      });
      expect(response.code).toBe(409);
      expect(response.payload.communicationId).toBeUndefined();
      expect(response.payload.sentTo).toBeUndefined();
      expect(h.provider.send).not.toHaveBeenCalled();
      expect(h.rows).toHaveLength(1);
    },
  );
  it("distinct-key direct active collision is 409 without winner payload or provider", async () => {
    const h = invoiceB29Harness();
    await h.comm.reserveCompanyTransactionalEmail(
      h.db,
      request(h, "winner-key-1"),
    );
    const loser = await h.send({ operationKey: "loser-key-01" });
    expect(loser.code).toBe(409);
    expect(loser.payload.communicationId).toBeUndefined();
    expect(h.provider.send).not.toHaveBeenCalled();
  });
  it.each(["recipient", "Customer", "kind", "distinct-key"])(
    "forced INSERT race %s rejects incompatible loser before any dispatch",
    async (field) => {
      const h = invoiceB29Harness("owner", 9, true, { concurrent: true });
      barrier(h);
      const a = request(h, "race-key-001");
      const b = {
        ...a,
        ...(field === "recipient"
          ? { recipientEmail: "other@example.test" }
          : {}),
        ...(field === "Customer" ? { customerId: 43 } : {}),
        ...(field === "kind"
          ? { intent: { kind: "resend", logicalSendKey: "race-key-001" } }
          : {}),
        ...(field === "distinct-key"
          ? { intent: { kind: "initial", logicalSendKey: "race-key-002" } }
          : {}),
      };
      // Customer compatibility guard on INSERT winner is independently exercised;
      // recipient resolution uses canonical 41 until both requests reach INSERT.
      if (field === "Customer") {
        const original = h.db.execute.getMockImplementation()!;
        h.db.execute.mockImplementation(async (sql: string, p: unknown[]) => {
          if (/SELECT id, customer_id FROM fs_jobs/.test(sql))
            return [[{ id: 12, customer_id: 43 }]];
          if (
            /SELECT id, first_name, last_name, email FROM fs_customers/.test(
              sql,
            )
          )
            return [[{ ...h.customer, id: 43 }]];
          return original(sql, p);
        });
        a.customerId = 43;
        b.customerId = 41;
        // Alternate canonical identity deterministically per resolution call.
        let read = 0;
        h.db.execute.mockImplementation(async (sql: string, p: unknown[]) => {
          if (/SELECT id, customer_id FROM fs_jobs/.test(sql))
            return [[{ id: 12, customer_id: ++read === 1 ? 43 : 41 }]];
          if (
            /SELECT id, first_name, last_name, email FROM fs_customers/.test(
              sql,
            )
          )
            return [[{ ...h.customer, id: p[0] }]];
          return original(sql, p);
        });
      }
      const settled = await Promise.allSettled([
        h.comm.reserveCompanyTransactionalEmail(h.db, a),
        h.comm.reserveCompanyTransactionalEmail(h.db, b),
      ]);
      expect(settled.filter((v) => v.status === "fulfilled")).toHaveLength(1);
      const failure = settled.find(
        (v) => v.status === "rejected",
      ) as PromiseRejectedResult;
      expect(failure.reason.code).toBe("CONFLICT");
      expect(failure.reason.communicationId).toBeUndefined();
      expect(h.rows).toHaveLength(1);
      expect(h.provider.send).not.toHaveBeenCalled();
    },
  );
  it("same-key/same-intent INSERT winners share immutable identity and atomic dispatch makes one provider call", async () => {
    const h = invoiceB29Harness("owner", 9, true, { concurrent: true });
    barrier(h);
    const input = request(h, "race-same-01");
    const [a, b] = await Promise.all([
      h.comm.reserveCompanyTransactionalEmail(h.db, input),
      h.comm.reserveCompanyTransactionalEmail(h.db, input),
    ]);
    expect(a.communicationId).toBe(b.communicationId);
    expect(a.recipientEmail).toBe(b.recipientEmail);
    expect(a.logicalSendKey).toBe(b.logicalSendKey);
    expect(a.intentKind).toBe(b.intentKind);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    await Promise.allSettled([
      h.comm.dispatchReservedCompanyTransactionalEmail(h.db, input, a),
      h.comm.dispatchReservedCompanyTransactionalEmail(h.db, input, b),
    ]);
    expect(h.rows).toHaveLength(1);
    expect(h.provider.send).toHaveBeenCalledTimes(1);
    expect((await h.lookup("race-same-01")).payload).toMatchObject({
      customerId: 41,
      intentKind: "initial",
      status: "provider_accepted",
      attemptCount: 1,
    });
  });
  it("distinct-key concurrent actual POST yields one success and one conflict, no foreign winner payload", async () => {
    const h = invoiceB29Harness("owner", 9, true, { concurrent: true });
    barrier(h);
    const responses = await Promise.all([
      h.send({ operationKey: "post-race-1" }),
      h.send({ operationKey: "post-race-2" }),
    ]);
    expect(responses.map((r) => r.code).sort()).toEqual([200, 409]);
    const loser = responses.find((r) => r.code === 409)!;
    expect(loser.payload.communicationId).toBeUndefined();
    expect(loser.payload.sentTo).toBeUndefined();
    expect(h.provider.send).toHaveBeenCalledTimes(1);
    expect(h.rows).toHaveLength(1);
  });
  it("same-key accepted replay checks immutable winner and changed recipient/kind conflicts without another provider call", async () => {
    const h = invoiceB29Harness();
    const a = await h.send({ operationKey: "replay-key-1" });
    const b = await h.send({ operationKey: "replay-key-1" });
    expect(b.payload.communicationId).toBe(a.payload.communicationId);
    expect(
      (
        await h.send({
          operationKey: "replay-key-1",
          recipientEmail: "other@example.test",
        })
      ).code,
    ).toBe(409);
    expect(
      (await h.send({ operationKey: "replay-key-1", resend: true })).code,
    ).toBe(409);
    expect(h.provider.send).toHaveBeenCalledTimes(1);
  });
});

describe("Original anchored durable controller recovery, no repeated POST", () => {
  it("captures original Customer/effective recipient/kind before await with no new wire fields or token persistence", async () => {
    const c = context();
    const captured = captureCompanyInvoiceOperationIntent(c);
    (c as any).originalCustomerId = 99;
    (c as any).onFileRecipientEmail = "changed@example.test";
    expect(captured.originalEvidence).toEqual({
      customerId: 41,
      recipientEmail: "on-file@example.test",
      intentKind: "initial",
    });
    expect(Object.isFrozen(captured.originalEvidence)).toBe(true);
    expect(companyInvoiceOperationBody(captured, "job-invoice")).toEqual({
      method: "email",
      resend: false,
      operationKey: "job-invoice",
    });
    const x = isolated();
    expect((await x.controller.send(context(), current)).state).toBe(
      "completed",
    );
    expect([...x.native.data.values()].join("")).not.toContain(
      "synthetic-memory-only",
    );
  });
  it("missing fresh original Customer/effective recipient holds before journal or POST", async () => {
    const x = isolated();
    const c = context();
    delete (c as any).originalCustomerId;
    expect((await x.controller.send(c, current)).state).toBe("uncertain");
    expect(x.native.data.size).toBe(0);
    expect(x.transport.send).not.toHaveBeenCalled();
    expect(() =>
      captureCompanyInvoiceOperationIntent({
        ...context(),
        onFileRecipientEmail: undefined,
      }),
    ).toThrow("original on-file");
  });
  it.each(["before receipt journaling", "after receipt journaling"])(
    "response loss %s recovers exact original after restart, no repeated POST or current-Customer substitution",
    async (mode) => {
      const x = isolated();
      const originalSend = x.transport.send;
      if (mode === "before receipt journaling")
        x.transport.send = vi.fn(async (...args) => {
          await originalSend(args[0], args[1], args[2]);
          throw new Error("Lost entire POST acknowledgment");
        });
      else
        x.transport.lookup = vi.fn(async (_t, job, key) => {
          const response = await x.h.lookup(key, job);
          if (response.payload.status !== "not_found")
            throw new Error("Lost GET after receipt journal");
          return response.payload;
        });
      const first = await x.controller.send(context(), current);
      expect(["uncertain", "temporarily_unavailable"]).toContain(first.state);
      privateResult(first);
      const saved = await x.native.store.read(9, 42, 12);
      expect(saved?.originalEvidence?.customerId).toBe(41);
      expect(saved?.receiptIdentity !== null).toBe(
        mode === "after receipt journaling",
      );
      x.h.job.customer_id = 99;
      x.h.customer.id = 99;
      x.h.customer.email = "changed@example.test";
      const restarted = isolated(x.h, nativeFixture(x.native.data));
      const c = {
        ...context(),
        originalCustomerId: 99,
        onFileRecipientEmail: "changed@example.test",
      };
      const recovered = await restarted.controller.recover(c, current);
      expect(recovered.state).toBe("completed");
      expect(recovered.actualRecipient).toBe("on-file@example.test");
      expect(recovered.lookup?.customerId).toBe(41);
      expect(recovered.isDelivered).toBe(false);
      expect((await restarted.controller.send(c, current)).state).toBe(
        "completed",
      );
      expect(restarted.transport.send).not.toHaveBeenCalled();
      expect(x.h.provider.send).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    "companyId",
    "jobId",
    "customerId",
    "operationKey",
    "recipientEmail",
    "intentKind",
  ])(
    "lost acknowledgment wrong original %s is sticky conflict with no foreign payload or repeated POST",
    async (field) => {
      const x = isolated();
      const send = x.transport.send;
      x.transport.send = vi.fn(async (...args) => {
        await send(args[0], args[1], args[2]);
        throw new Error("Lost ack");
      });
      await x.controller.send(context(), current);
      x.transport.lookup = vi.fn(async () => ({
        ...(await x.h.lookup("job-invoice")).payload,
        [field]:
          field === "recipientEmail"
            ? "foreign@example.test"
            : field === "operationKey"
              ? "foreign-key-1"
              : field === "intentKind"
                ? "resend"
                : 99,
      }));
      const recovered = await x.controller.recover(context(), current);
      expect(recovered.state).toBe("conflict");
      privateResult(recovered);
      expect((await x.native.store.read(9, 42, 12))?.lookup).toBeNull();
      x.transport.lookup = vi.fn(
        async () => (await x.h.lookup("job-invoice")).payload,
      );
      expect((await x.controller.send(context(), current)).state).toBe(
        "conflict",
      );
      expect(x.h.provider.send).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["unknown", "acceptance persistence interruption"])(
    "actual %s remains held and cannot authorize a distinct-key resend",
    async (mode) => {
      const x = isolated();
      if (mode === "unknown") x.h.setProviderMode("unknown");
      else x.h.interruptAcceptance();
      expect((await x.controller.send(context(), current)).state).toBe(
        "conflict",
      );
      expect(
        (
          await x.controller.send(
            context(true, undefined, "explicit-resend-1"),
            current,
          )
        ).state,
      ).toBe("conflict");
      expect(x.h.provider.send).toHaveBeenCalledTimes(1);
      expect(x.h.rows[0].provider_dispatch_state).toBe("provider_unknown");
    },
  );
  it.each(["not_found", "temporarily_unavailable"])(
    "post-loss %s retains original journal and does not repeat POST",
    async (status) => {
      const durable: any = {};
      const x = isolated(invoiceB29Harness("owner", 9, true, durable));
      x.transport.send = vi.fn(async () => {
        throw new Error("Lost before backend");
      });
      await x.controller.send(context(), current);
      if (status === "temporarily_unavailable")
        durable.lookupUnavailable = true;
      for (let i = 0; i < 2; i++)
        expect((await x.controller.send(context(), current)).state).toBe(
          status,
        );
      expect(x.transport.send).toHaveBeenCalledTimes(1);
      expect((await x.native.store.read(9, 42, 12))?.phase).toBe("uncertain");
    },
  );
  it("accepted is not delivered; actual delivered ledger GET is delivered, unknown provider state still takes precedence", async () => {
    const x = isolated();
    const first = await x.controller.send(context(), current);
    expect(first.state).toBe("completed");
    expect(first.isDelivered).toBe(false);
    x.h.rows[0].state = "delivered";
    const delivered = await x.controller.recover(context(), current);
    expect(delivered.isDelivered).toBe(true);
    expect(delivered.actualRecipient).toBe("on-file@example.test");
    x.h.rows[0].provider_dispatch_state = "provider_unknown";
    const unknown = await x.controller.recover(context(), current);
    expect(unknown.state).toBe("unknown");
    expect(unknown.isDelivered).toBe(false);
    expect(
      (
        await x.controller.send(
          context(true, undefined, "no-unknown-resend"),
          current,
        )
      ).state,
    ).toBe("unknown");
    expect(x.h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("new resend requires explicit authorized choice and distinct captured key; captured resend restart is GET-only", async () => {
    const x = isolated();
    await x.controller.send(context(), current);
    expect((await x.controller.send(context(true), current)).state).toBe(
      "completed",
    );
    expect(x.h.provider.send).toHaveBeenCalledTimes(1);
    const resend = context(true, "resend@example.test", "explicit-resend-01");
    const sent = await x.controller.send(resend, current);
    expect(sent.state).toBe("completed");
    expect(sent.lookup?.intentKind).toBe("resend");
    expect(sent.actualRecipient).toBe("resend@example.test");
    expect(x.h.rows).toHaveLength(2);
    const restarted = isolated(x.h, nativeFixture(x.native.data));
    expect((await restarted.controller.send(resend, current)).state).toBe(
      "completed",
    );
    expect(restarted.transport.send).not.toHaveBeenCalled();
    expect(x.h.provider.send).toHaveBeenCalledTimes(2);
  });
  it.each(["kind", "recipient", "key"])(
    "same captured key cannot change local %s to authorize resend or recovery",
    async (field) => {
      const x = isolated();
      await x.controller.send(context(), current);
      const c =
        field === "kind"
          ? context(true, undefined, "job-invoice")
          : field === "recipient"
            ? context(false, "other@example.test", "job-invoice")
            : context(false, undefined, "different-key-01");
      const value = await x.controller.recover(c, current);
      expect(value.state).toBe("conflict");
      privateResult(value);
      expect(x.h.provider.send).toHaveBeenCalledTimes(1);
    },
  );
  it("new preflight never adopts pre-existing winner even with fully matching original intent", async () => {
    const x = isolated();
    await x.h.send();
    const value = await x.controller.send(context(), current);
    expect(value.state).toBe("conflict");
    privateResult(value);
    expect(x.transport.send).not.toHaveBeenCalled();
    expect((await x.native.store.read(9, 42, 12))?.lookup).toBeNull();
  });
  it.each(["prepared", "uncertain", "verified"])(
    "legacy unanchored %s journal is preserved read-only held, never silently cleared or upgraded",
    async (phase) => {
      const x = isolated();
      await x.h.send();
      const raw = (await x.h.lookup("job-invoice")).payload;
      for (const field of ["companyId", "jobId", "customerId", "intentKind"])
        delete raw[field];
      const c = context();
      delete (c as any).originalCustomerId;
      let legacy = newCompanyInvoiceOperationRecord(
        captureCompanyInvoiceOperationIntent(c),
        "job-invoice",
      );
      if (phase !== "prepared")
        legacy = updateCompanyInvoiceOperationRecord(legacy, {
          phase: phase as "uncertain" | "verified",
          ...(phase === "verified" ? { lookup: raw } : {}),
        });
      await x.native.store.compareAndSwap(null, legacy);
      const bytes = new Map(x.native.data);
      const value = await x.controller.send(context(), current);
      expect(value.state).toBe("uncertain");
      privateResult(value);
      expect(x.native.data).toEqual(bytes);
      expect(x.transport.send).not.toHaveBeenCalled();
      expect(
        copyCompanyInvoiceOperationRecord(legacy).originalEvidence,
      ).toBeUndefined();
    },
  );
  it("prepared restart cannot POST even when GET says not_found", async () => {
    const x = isolated();
    await x.native.store.compareAndSwap(
      null,
      newCompanyInvoiceOperationRecord(
        captureCompanyInvoiceOperationIntent(context()),
        "job-invoice",
      ),
    );
    expect((await x.controller.send(context(), current)).state).toBe(
      "not_found",
    );
    expect(x.transport.send).not.toHaveBeenCalled();
  });
  it("CAS cannot mutate original evidence or upgrade legacy journal with current Customer", async () => {
    const x = isolated();
    const original = newCompanyInvoiceOperationRecord(
      captureCompanyInvoiceOperationIntent(context()),
      "job-invoice",
    );
    await x.native.store.compareAndSwap(null, original);
    expect(() =>
      x.native.store.compareAndSwap(original, {
        ...original,
        phase: "uncertain",
        originalEvidence: { ...original.originalEvidence!, customerId: 99 },
      }),
    ).toThrow();
    const legacy = { ...original };
    delete (legacy as any).originalEvidence;
    expect(() =>
      x.native.store.compareAndSwap(legacy, {
        ...original,
        phase: "uncertain",
      }),
    ).toThrow();
  });
  it.each(["Company", "Job", "actor", "role"])(
    "foreign journal %s never leaks or reads provider identity",
    async (field) => {
      const x = isolated();
      const record = newCompanyInvoiceOperationRecord(
        captureCompanyInvoiceOperationIntent(context()),
        "job-invoice",
      );
      const foreign = {
        ...record,
        [field === "Company"
          ? "companyId"
          : field === "Job"
            ? "jobId"
            : field === "actor"
              ? "userId"
              : "role"]: field === "role" ? "dispatcher" : 99,
      };
      const controller = createCompanyInvoiceOperationController({
        store: { read: async () => foreign as any, compareAndSwap: deny },
        isolatedTransport: x.transport,
      });
      const value = await controller.recover(context(), current);
      expect(value.state).toBe("conflict");
      privateResult(value);
      expect(x.transport.lookup).not.toHaveBeenCalled();
    },
  );
  it.each(["preflight", "POST", "GET", "GET rejection"])(
    "stale %s continuation exposes no identity and sends no additional request",
    async (stage) => {
      const x = isolated();
      let fresh = true;
      const entered = deferred<void>();
      const release = deferred<void>();
      if (stage === "preflight")
        x.transport.lookup = vi.fn(async () => {
          entered.resolve();
          await release.promise;
          return (await x.h.lookup("job-invoice")).payload;
        });
      else if (stage === "POST") {
        const send = x.transport.send;
        x.transport.send = vi.fn(async (...args) => {
          const raw = await send(args[0], args[1], args[2]);
          entered.resolve();
          await release.promise;
          return raw;
        });
      } else {
        const lookup = x.transport.lookup;
        x.transport.lookup = vi.fn(async (...args) => {
          const raw = await lookup(args[0], args[1], args[2]);
          if ((raw as any).status !== "not_found") {
            entered.resolve();
            await release.promise;
            if (stage === "GET rejection")
              throw new Error("Synthetic rejection");
          }
          return raw;
        });
      }
      const pending = x.controller.send(context(), () => fresh);
      await entered.promise;
      fresh = false;
      release.resolve();
      const value = await pending;
      expect(value.state).toBe("stale");
      privateResult(value);
      expect(value.operationKey).toBeNull();
      expect(x.h.provider.send.mock.calls.length).toBe(
        stage === "preflight" ? 0 : 1,
      );
    },
  );
  it("false production gate blocks installed HTTP transport before storage or I/O", async () => {
    const x = isolated();
    const controller = createCompanyInvoiceOperationController({
      store: x.native.store,
      transport: { send: deny, lookup: deny },
    });
    expect((await controller.send(context(), current)).state).toBe("blocked");
    expect(x.native.data.size).toBe(0);
  });
  it("ASCII case-insensitive SQL key alias cannot substitute canonical persisted key", async () => {
    const h = invoiceB29Harness();
    const first = await h.send({ operationKey: "Case-Key-001" });
    const alias = await h.send({ operationKey: "case-key-001" });
    expect(alias.payload.communicationId).toBe(first.payload.communicationId);
    const actual = (await h.lookup("case-key-001")).payload;
    expect(actual.operationKey).toBe("Case-Key-001");
    expect(() =>
      normalizeCompanyInvoiceOperationLookup(actual, "case-key-001"),
    ).toThrow("scope or key");
    expect(h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("completely lost explicit resend acknowledgment recovers original recipient/kind/key after restart", async () => {
    const x = isolated();
    await x.controller.send(context(), current);
    const send = x.transport.send;
    x.transport.send = vi.fn(async (token, job, body) => {
      await send(token, job, body);
      throw new Error("Lost resend acknowledgment");
    });
    const c = context(true, "resend-original@example.test", "resend-lost-01");
    expect((await x.controller.send(c, current)).state).toBe("uncertain");
    const restarted = isolated(x.h, nativeFixture(x.native.data));
    const value = await restarted.controller.recover(c, current);
    expect(value.state).toBe("completed");
    expect(value.lookup).toMatchObject({
      operationKey: "resend-lost-01",
      intentKind: "resend",
      customerId: 41,
      recipientEmail: "resend-original@example.test",
    });
    expect((await restarted.controller.send(c, current)).state).toBe(
      "completed",
    );
    expect(restarted.transport.send).not.toHaveBeenCalled();
    expect(x.h.provider.send).toHaveBeenCalledTimes(2);
  });
  it.each(["before dispatch marker", "before receipt manifest"])(
    "journal interruption %s retains protected pointer and never repeats POST after restart",
    async (stage) => {
      const x = isolated();
      const set = x.native.adapter.setItemAsync.getMockImplementation()!;
      let manifests = 0;
      x.native.adapter.setItemAsync.mockImplementation(async (key, value) => {
        if (
          key.endsWith(".manifest") &&
          ++manifests === (stage === "before dispatch marker" ? 2 : 3)
        )
          throw new Error("Synthetic manifest interruption");
        return set(key, value);
      });
      await expect(x.controller.send(context(), current)).rejects.toThrow(
        "manifest interruption",
      );
      const saved = await x.native.store.read(9, 42, 12);
      expect(saved?.phase).toBe(
        stage === "before dispatch marker" ? "prepared" : "uncertain",
      );
      expect(saved?.receiptIdentity).toBeNull();
      const restarted = isolated(x.h, nativeFixture(x.native.data));
      expect((await restarted.controller.send(context(), current)).state).toBe(
        stage === "before dispatch marker" ? "not_found" : "completed",
      );
      expect(restarted.transport.send).not.toHaveBeenCalled();
      expect(x.h.provider.send.mock.calls.length).toBe(
        stage === "before dispatch marker" ? 0 : 1,
      );
    },
  );
  it("malformed GET and legacy contradictory GET are held without rewriting legacy evidence", async () => {
    const x = isolated();
    const c = context();
    delete (c as any).originalCustomerId;
    const legacy = updateCompanyInvoiceOperationRecord(
      newCompanyInvoiceOperationRecord(
        captureCompanyInvoiceOperationIntent(c),
        "job-invoice",
      ),
      { phase: "uncertain" },
    );
    await x.native.store.compareAndSwap(null, legacy);
    const before = new Map(x.native.data);
    x.transport.lookup = vi.fn(async () => ({ unexpected: "not proof" }));
    expect((await x.controller.recover(context(), current)).state).toBe(
      "uncertain",
    );
    x.transport.lookup = vi.fn(async () => ({
      error: { code: "CONFLICT" },
      communicationId: 999,
      recipientEmail: "foreign@example.test",
    }));
    const value = await x.controller.recover(context(), current);
    expect(value.state).toBe("conflict");
    privateResult(value);
    expect(x.native.data).toEqual(before);
    expect(x.transport.send).not.toHaveBeenCalled();
  });
  it("definitive provider failure is recoverable GET-only, next send needs explicit distinct resend", async () => {
    const x = isolated();
    x.h.setProviderMode("rejected");
    expect((await x.controller.send(context(), current)).state).toBe(
      "uncertain",
    );
    expect((await x.controller.recover(context(), current)).state).toBe(
      "failed",
    );
    expect((await x.controller.send(context(), current)).state).toBe("failed");
    expect(x.h.provider.send).toHaveBeenCalledTimes(1);
    x.h.setProviderMode("accepted");
    expect(
      (
        await x.controller.send(
          context(true, undefined, "failed-explicit-resend"),
          current,
        )
      ).state,
    ).toBe("completed");
    expect(x.h.provider.send).toHaveBeenCalledTimes(2);
  });
  it.each(["key", "recipient", "communication"])(
    "acknowledgment %s contradiction is conflict and never exposes winner",
    async (field) => {
      const x = isolated();
      const send = x.transport.send;
      x.transport.send = vi.fn(async (token, job, body) => ({
        ...((await send(token, job, body)) as object),
        ...(field === "key"
          ? { operationKey: "foreign-key-01" }
          : field === "recipient"
            ? { sentTo: "foreign@example.test" }
            : { communicationId: 999 }),
      }));
      const value = await x.controller.send(context(), current);
      expect(value.state).toBe("conflict");
      privateResult(value);
      expect((await x.controller.send(context(), current)).state).toBe(
        "conflict",
      );
      expect(x.h.provider.send).toHaveBeenCalledTimes(1);
    },
  );
  it("stale durable commit retains recovery pointer but exposes no identity or dispatch", async () => {
    const x = isolated();
    let fresh = true;
    const set = x.native.adapter.setItemAsync.getMockImplementation()!;
    x.native.adapter.setItemAsync.mockImplementation(async (key, value) => {
      await set(key, value);
      if (key.endsWith(".manifest")) fresh = false;
    });
    const value = await x.controller.send(context(), () => fresh);
    expect(value.state).toBe("stale");
    privateResult(value);
    expect(value.operationKey).toBeNull();
    expect((await x.native.store.read(9, 42, 12))?.phase).toBe("prepared");
    expect(x.transport.send).not.toHaveBeenCalled();
    expect(x.transport.lookup).not.toHaveBeenCalled();
  });
  it("concurrent controller callback is busy while first preflight remains active", async () => {
    const x = isolated();
    const entered = deferred<void>();
    const release = deferred<void>();
    x.transport.lookup = vi.fn(async () => {
      entered.resolve();
      await release.promise;
      return (await x.h.lookup("job-invoice")).payload;
    });
    const pending = x.controller.send(context(), current);
    await entered.promise;
    expect((await x.controller.send(context(), current)).state).toBe("busy");
    release.resolve();
    expect((await pending).state).toBe("completed");
    expect(x.h.provider.send).toHaveBeenCalledTimes(1);
  });
});
