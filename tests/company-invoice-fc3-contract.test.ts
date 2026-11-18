// Positive authority is only actual fc3 declarations; all SQL/provider work is synthetic.
import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createCompanyInvoiceOperationController,
  type CompanyInvoiceOperationTransport,
} from "../lib/company-job-invoice-operation-controller";
import {
  createCompanyInvoiceOperationStore,
  newCompanyInvoiceOperationKey,
  newCompanyInvoiceOperationRecord,
  updateCompanyInvoiceOperationRecord,
  type CompanyInvoiceOperationStore,
} from "../lib/company-job-invoice-operation-storage";
import {
  COMPANY_INVOICE_OPERATION_REVISION,
  captureCompanyInvoiceOperationIntent,
  isCompanyInvoiceOperationConflict,
  normalizeCompanyInvoiceOperationLookup,
  normalizeCompanyInvoiceOperationReceipt,
  type CompanyInvoiceOperationContext,
} from "../lib/company-job-invoice-operation";
import { isCurrentCompanyInvoiceOperationIntent } from "../lib/company-job-invoice-operation-lifecycle";
import { invoiceIndexedDBMock } from "./fixtures/company-invoice-indexeddb";
import {
  backendRevision,
  invoiceFc3Harness,
} from "./fixtures/company-invoice-fc3-source";

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
    throw new Error("DENIED network");
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
      token: "synthetic-token-not-stored",
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
function native() {
  const data = new Map<string, string>();
  const adapter = {
    getItemAsync: vi.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      if (value.length > 1800) throw new Error("native chunk bound");
      data.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  };
  const fresh = () =>
    createCompanyInvoiceOperationStore({
      platform: "ios",
      secureStore: adapter,
    });
  return { data, adapter, fresh, store: fresh() };
}
function browser() {
  const model = invoiceIndexedDBMock();
  const fresh = () =>
    createCompanyInvoiceOperationStore({
      platform: "web",
      indexedDB: model.factory,
      webCrypto: webcrypto as unknown as Crypto,
    });
  return { model, fresh, store: fresh() };
}
function transport(
  h: ReturnType<typeof invoiceFc3Harness>,
): CompanyInvoiceOperationTransport {
  const payload = (r: { code: number; payload: any }) => {
    if (r.code !== 200)
      throw Object.assign(new Error(r.payload.error.message), {
        status: r.code,
        code: r.payload.error.code,
      });
    return r.payload;
  };
  return {
    send: vi.fn(async (_token, jobId, body) =>
      payload(await h.send(body, jobId)),
    ),
    lookup: vi.fn(async (_token, jobId, key) =>
      payload(await h.lookup(key, jobId)),
    ),
  };
}
function isolated(h = invoiceFc3Harness(), store = native().store) {
  const api = transport(h);
  const controller = createCompanyInvoiceOperationController({
    store,
    isolatedTransport: api,
  });
  return { h, store, api, controller };
}
const absent = (operationKey = "job-invoice", status = "not_found") => ({
  operationKey,
  communicationId: null,
  recipientEmail: null,
  status,
  communicationState: null,
  providerDispatchState: null,
  providerMessageId: null,
  attemptCount: null,
});
const populated = (operationKey = "job-invoice") => ({
  operationKey,
  communicationId: 999,
  recipientEmail: "another@example.test",
  status: "provider_accepted",
  communicationState: "provider_accepted",
  providerDispatchState: "provider_accepted",
  providerMessageId: "foreign-provider",
  attemptCount: 1,
});
async function seed(
  store: CompanyInvoiceOperationStore,
  phase: "prepared" | "uncertain" = "uncertain",
  c = context(),
) {
  const r = newCompanyInvoiceOperationRecord(
    captureCompanyInvoiceOperationIntent(c),
    c.operationKey ?? "job-invoice",
  );
  await store.compareAndSwap(
    null,
    phase === "prepared"
      ? r
      : updateCompanyInvoiceOperationRecord(r, { phase }),
  );
}
function sanitized(
  value: Awaited<
    ReturnType<
      ReturnType<typeof createCompanyInvoiceOperationController>["send"]
    >
  >,
) {
  expect(value).toMatchObject({
    state: "conflict",
    actualRecipient: null,
    communicationId: null,
    lookup: null,
    isDelivered: false,
  });
  expect(JSON.stringify(value)).not.toContain("another@example.test");
  expect(JSON.stringify(value)).not.toContain("foreign-provider");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("actual fc3 source DTO and authority", () => {
  it("pins mobile operation and all executed source hashes to exact final metadata", () => {
    expect(COMPANY_INVOICE_OPERATION_REVISION).toBe(backendRevision);
    expect(backendRevision).toBe("fc3bcaa78c6288b705339bd69e2fe1539c779546");
  });
  it.each([undefined, "alternate@example.test"])(
    "initial acknowledgment and independently verified recipient: %s",
    async (email) => {
      const f = isolated();
      const value = await f.controller.send(context(false, email), current);
      expect(value).toMatchObject({
        state: "completed",
        operationKey: "job-invoice",
        communicationId: 1,
        actualRecipient: email ?? "on-file@example.test",
        isDelivered: false,
      });
      expect(f.h.provider.send).toHaveBeenCalledTimes(1);
      expect(f.api.send).toHaveBeenCalledWith(
        "synthetic-token-not-stored",
        12,
        {
          method: "email",
          resend: false,
          operationKey: "job-invoice",
          ...(email ? { recipientEmail: email } : {}),
        },
      );
      const get = await f.h.lookup("job-invoice");
      expect(
        normalizeCompanyInvoiceOperationLookup(get.payload, "job-invoice")
          .communicationId,
      ).toBe(1);
      const post = await f.h.send({ operationKey: "job-invoice" });
      expect(
        normalizeCompanyInvoiceOperationReceipt(post.payload, "job-invoice")
          .recipientEmail,
      ).toBe(email ?? "on-file@example.test");
      expect(f.h.provider.send).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["owner", "dispatcher"])(
    "allows only verified manager role: %s",
    async (role) => {
      const h = invoiceFc3Harness(role);
      expect((await h.send({ operationKey: "job-invoice" })).code).toBe(200);
      expect((await h.lookup("job-invoice")).payload.communicationId).toBe(1);
    },
  );
  it("rejects technician and disabled payments on both routes", async () => {
    for (const h of [
      invoiceFc3Harness("technician"),
      invoiceFc3Harness("owner", 9, false),
    ]) {
      expect((await h.send({ operationKey: "job-invoice" })).code).toBe(403);
      expect((await h.lookup("job-invoice")).code).toBe(403);
      expect(h.provider.send).not.toHaveBeenCalled();
    }
  });
  it("scopes wrong Company and Job: POST404, GET200 not_found with requested key and null id", async () => {
    const foreign = invoiceFc3Harness("owner", 88);
    expect((await foreign.send({ operationKey: "job-invoice" })).code).toBe(
      404,
    );
    expect((await foreign.lookup("job-invoice")).payload).toEqual(absent());
    const h = invoiceFc3Harness();
    await h.send({ operationKey: "job-invoice" });
    expect((await h.send({ operationKey: "job-invoice" }, 99)).code).toBe(404);
    expect((await h.lookup("job-invoice", 99)).payload).toEqual(absent());
    expect(foreign.provider.send).not.toHaveBeenCalled();
    expect(h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("strict body validation rejects wrong method, SMS recipient and invalid keys", async () => {
    const h = invoiceFc3Harness();
    for (const body of [
      { method: "fax" },
      { method: "sms", recipientEmail: "x@example.test" },
      { operationKey: "short" },
      { operationKey: "bad key!" },
      { operationKey: "job-invoice", unknown: true },
    ])
      expect((await h.send(body)).code).toBe(400);
    expect(h.provider.send).not.toHaveBeenCalled();
  });
  it("actual different explicit active-key collision returns HTTP409 CONFLICT, never unpersisted receipt", async () => {
    const h = invoiceFc3Harness();
    await h.send({
      operationKey: "active-original",
      recipientEmail: "another@example.test",
    });
    h.rows[0].state = "sending";
    h.rows[0].provider_dispatch_state = "provider_started";
    const post = await h.send({
      operationKey: "explicit-new-key",
      resend: true,
      recipientEmail: "requested@example.test",
    });
    expect(post.code).toBe(409);
    expect(post.payload).toEqual({
      error: {
        code: "CONFLICT",
        message:
          "This Company Job already has an active invoice operation with a different key.",
      },
    });
    expect((await h.lookup("explicit-new-key")).payload).toEqual(
      absent("explicit-new-key"),
    );
    expect(post.payload.communicationId).toBeUndefined();
    expect(h.provider.send).toHaveBeenCalledTimes(1);
    expect(h.rows).toHaveLength(1);
  });
  it("documents same-key reuse lacks recipient/resend-intent proof, but mobile rejects fresh collision", async () => {
    const h = invoiceFc3Harness();
    await h.send({
      operationKey: "job-invoice",
      recipientEmail: "another@example.test",
    });
    const post = await h.send({
      operationKey: "job-invoice",
      resend: true,
      recipientEmail: "requested@example.test",
    });
    expect(post.payload).toMatchObject({
      operationKey: "job-invoice",
      communicationId: 1,
      sentTo: "another@example.test",
    });
    expect(h.rows[0].intent_kind).toBe("initial");
    const f = isolated(h);
    sanitized(
      await f.controller.send(
        context(false, "requested@example.test"),
        current,
      ),
    );
    expect(await f.store.read(9, 42, 12)).toMatchObject({
      phase: "conflict",
      operationKey: "job-invoice",
      lookup: null,
      receiptIdentity: null,
    });
    expect(f.api.send).not.toHaveBeenCalled();
  });
  it("same recipient still cannot prove a newly prepared default operation owns an existing key", async () => {
    const h = invoiceFc3Harness();
    await h.send({ operationKey: "job-invoice" });
    const f = isolated(h);
    sanitized(await f.controller.send(context(), current));
    expect(f.api.send).not.toHaveBeenCalled();
  });
});

describe("fc3 mobile collision holds and sanitization", () => {
  it.each(["CONFLICT", "OPERATION_CONFLICT"])(
    "typed409 %s durably holds key and hides another operation's error fields",
    async (code) => {
      const f = isolated();
      vi.mocked(f.api.send).mockRejectedValueOnce(
        Object.assign(new Error("another@example.test communicationId999"), {
          status: 409,
          code,
          anotherRecipient: "another@example.test",
          communicationId: 999,
        }),
      );
      const value = await f.controller.send(context(), current);
      sanitized(value);
      expect(await f.store.read(9, 42, 12)).toMatchObject({
        phase: "conflict",
        operationKey: "job-invoice",
        lookup: null,
        receiptIdentity: null,
      });
      const restarted = createCompanyInvoiceOperationController({
        store: f.store,
        isolatedTransport: f.api,
      });
      sanitized(await restarted.recover(context(), current));
      sanitized(
        await restarted.send(
          context(true, undefined, newCompanyInvoiceOperationKey()),
          current,
        ),
      );
      expect(f.api.send).toHaveBeenCalledTimes(1);
    },
  );
  it("actual active default-key collision is held on409 even though GET returns not_found", async () => {
    const h = invoiceFc3Harness();
    await h.send({
      operationKey: "another-active",
      recipientEmail: "another@example.test",
    });
    h.rows[0].state = "queued";
    h.rows[0].provider_dispatch_state = "queued";
    const f = isolated(h);
    sanitized(
      await f.controller.send(
        context(false, "requested@example.test"),
        current,
      ),
    );
    sanitized(await f.controller.recover(context(), current));
    expect(f.api.send).toHaveBeenCalledTimes(1);
    expect(h.provider.send).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    "foreign GET key with unexpected populated fields is conflict, even known prior pointer: %s",
    async (known) => {
      const f = isolated();
      if (known) await f.controller.send(context(), current);
      else await seed(f.store);
      const original = await f.store.read(9, 42, 12);
      vi.mocked(f.api.lookup).mockResolvedValueOnce({
        ...populated("another-key"),
        anotherRecipient: "another@example.test",
        extra: true,
      });
      sanitized(await f.controller.recover(context(), current));
      expect(await f.store.read(9, 42, 12)).toMatchObject({
        phase: "conflict",
        operationKey: "job-invoice",
        lookup: original!.lookup,
        receiptIdentity: original!.receiptIdentity,
      });
      const calls = vi.mocked(f.api.send).mock.calls.length;
      sanitized(await f.controller.send(context(), current));
      expect(f.api.send).toHaveBeenCalledTimes(calls);
    },
  );
  it("not_found with populated foreign identity is rejected as conflict", async () => {
    const f = isolated();
    await seed(f.store);
    vi.mocked(f.api.lookup).mockResolvedValueOnce({
      ...absent(),
      communicationId: 999,
      recipientEmail: "another@example.test",
    });
    sanitized(await f.controller.recover(context(), current));
  });
  it("same-key GET contradicting receipt never exposes/adopts conflicting identity", async () => {
    const f = isolated();
    await f.controller.send(context(), current);
    const original = await f.store.read(9, 42, 12);
    vi.mocked(f.api.lookup).mockResolvedValueOnce(populated());
    sanitized(await f.controller.recover(context(), current));
    expect((await f.store.read(9, 42, 12))!.lookup).toEqual(original!.lookup);
  });
  it("POST acknowledgment for wrong recipient is conflict before receipt is journaled", async () => {
    const f = isolated();
    vi.mocked(f.api.send).mockImplementationOnce(
      async () =>
        (
          await f.h.send({
            operationKey: "job-invoice",
            recipientEmail: "another@example.test",
          })
        ).payload,
    );
    sanitized(
      await f.controller.send(
        context(false, "requested@example.test"),
        current,
      ),
    );
    expect((await f.store.read(9, 42, 12))!.receiptIdentity).toBeNull();
  });
  it("same recipient different resend intent reusing default key is conflict with zero additional write", async () => {
    const f = isolated();
    await f.controller.send(context(false, "same@example.test"), current);
    sanitized(
      await f.controller.send(
        context(true, "same@example.test", "job-invoice"),
        current,
      ),
    );
    expect(f.api.send).toHaveBeenCalledTimes(1);
  });
  it("method intent change to SMS cannot bypass captured email recovery", async () => {
    const f = isolated();
    await f.controller.send(context(), current);
    const c = context(true, undefined, newCompanyInvoiceOperationKey());
    await expect(
      f.controller.send(
        { ...c, options: { ...c.options, method: "sms" } },
        current,
      ),
    ).rejects.toThrow("no verified SMS");
    expect(f.api.send).toHaveBeenCalledTimes(1);
  });
  it("prepared journal restart cannot claim a pre-existing matching recipient operation", async () => {
    const f = isolated();
    await seed(f.store, "prepared");
    await f.h.send({ operationKey: "job-invoice" });
    sanitized(await f.controller.recover(context(), current));
    expect(f.api.send).not.toHaveBeenCalled();
  });
  it("conflict classification never trusts message text or generic404/503 as safe rejection", () => {
    expect(
      isCompanyInvoiceOperationConflict(
        new Error("CONFLICT another@example.test"),
      ),
    ).toBe(false);
    expect(
      isCompanyInvoiceOperationConflict({ status: 404, code: "CONFLICT" }),
    ).toBe(false);
    expect(
      isCompanyInvoiceOperationConflict({ status: 409, code: "CONFLICT" }),
    ).toBe(true);
  });
});

describe("fc3 protected journal uncertainty and explicit resends", () => {
  it.each(["native", "web"])(
    "lost successful POST survives %s restart and recovers only original-key GET",
    async (platform) => {
      const protectedStore = platform === "native" ? native() : browser();
      const f = isolated(invoiceFc3Harness(), protectedStore.store);
      // Execute actual fc3 route once, then simulate transport acknowledgment loss.
      vi.mocked(f.api.send).mockImplementationOnce(
        async (_token, jobId, body) => {
          await f.h.send(body, jobId);
          throw new Error("lost acknowledgment");
        },
      );
      expect(
        (
          await f.controller.send(
            context(false, "private@example.test"),
            current,
          )
        ).state,
      ).toBe("uncertain");
      const held = await protectedStore.fresh().read(9, 42, 12);
      expect(held).toMatchObject({
        phase: "uncertain",
        operationKey: "job-invoice",
        requestedRecipient: "private@example.test",
        lookup: null,
      });
      const recovered = await createCompanyInvoiceOperationController({
        store: protectedStore.fresh(),
        isolatedTransport: f.api,
      }).recover(context(), current);
      expect(recovered).toMatchObject({
        state: "completed",
        actualRecipient: "private@example.test",
        communicationId: 1,
      });
      expect(f.api.send).toHaveBeenCalledTimes(1);
      expect(f.h.provider.send).toHaveBeenCalledTimes(1);
      if (platform === "web") {
        const model = (protectedStore as ReturnType<typeof browser>).model;
        const sealed = model.entries("records")[0][1] as {
          ciphertext: ArrayBuffer;
        };
        expect(new TextDecoder().decode(sealed.ciphertext)).not.toContain(
          "private@example.test",
        );
        expect(
          (model.entries("keys")[0][1] as { key: CryptoKey }).key.extractable,
        ).toBe(false);
      } else {
        const n = protectedStore as ReturnType<typeof native>;
        expect([...n.data.values()].join("")).not.toContain(
          "synthetic-token-not-stored",
        );
        expect(
          n.adapter.setItemAsync.mock.calls.every(
            (call) => call[1].length <= 1800,
          ),
        ).toBe(true);
      }
    },
  );
  it.each(["native", "web"])(
    "typed409 hold survives %s restart and terminal foreign GET cannot unblock resend",
    async (platform) => {
      const protectedStore = platform === "native" ? native() : browser();
      const f = isolated(invoiceFc3Harness(), protectedStore.store);
      vi.mocked(f.api.send).mockRejectedValueOnce({
        status: 409,
        code: "OPERATION_CONFLICT",
        anotherRecipient: "another@example.test",
        communicationId: 999,
      });
      sanitized(await f.controller.send(context(), current));
      vi.mocked(f.api.lookup).mockResolvedValueOnce(populated());
      const restart = createCompanyInvoiceOperationController({
        store: protectedStore.fresh(),
        isolatedTransport: f.api,
      });
      sanitized(
        await restart.send(
          context(true, undefined, newCompanyInvoiceOperationKey()),
          current,
        ),
      );
      expect((await protectedStore.fresh().read(9, 42, 12))!.operationKey).toBe(
        "job-invoice",
      );
      expect(f.api.send).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    "not_found",
    "temporarily_unavailable",
    "network",
    "missing",
    "404",
  ])(
    "lost POST + %s never clears uncertain journal or auto-repeats writes",
    async (mode) => {
      const f = isolated();
      vi.mocked(f.api.send).mockRejectedValueOnce(
        new Error("lost before server response"),
      );
      expect((await f.controller.send(context(), current)).state).toBe(
        "uncertain",
      );
      if (mode === "network" || mode === "404")
        vi.mocked(f.api.lookup).mockRejectedValue({
          status: mode === "404" ? 404 : null,
          code: "NOT_FOUND",
        });
      else
        vi.mocked(f.api.lookup).mockResolvedValue(
          mode === "missing" ? undefined : absent("job-invoice", mode),
        );
      const restart = createCompanyInvoiceOperationController({
        store: f.store,
        isolatedTransport: f.api,
      });
      await restart.recover(context(), current);
      await restart.send(
        context(true, undefined, newCompanyInvoiceOperationKey()),
        current,
      );
      expect(await f.store.read(9, 42, 12)).toMatchObject({
        phase: "uncertain",
        operationKey: "job-invoice",
        lookup: null,
      });
      expect(f.api.send).toHaveBeenCalledTimes(1);
      expect(f.h.provider.send).not.toHaveBeenCalled();
      expect(
        vi
          .mocked(f.api.lookup)
          .mock.calls.every((args) => args[2] === "job-invoice"),
      ).toBe(true);
    },
  );
  it("temporarily unavailable initial preflight is held prepared and later absence is GET-only", async () => {
    const f = isolated();
    vi.mocked(f.api.lookup).mockResolvedValueOnce(
      absent("job-invoice", "temporarily_unavailable"),
    );
    expect((await f.controller.send(context(), current)).state).toBe(
      "temporarily_unavailable",
    );
    expect((await f.controller.send(context(), current)).state).toBe(
      "not_found",
    );
    expect((await f.store.read(9, 42, 12))!.phase).toBe("prepared");
    expect(f.api.send).not.toHaveBeenCalled();
  });
  it("actual provider unknown is409 and unknown GET; mobile retains manual-conflict hold, never retries", async () => {
    const f = isolated();
    f.h.setProviderMode("unknown");
    sanitized(await f.controller.send(context(), current));
    const get = await f.h.lookup("job-invoice");
    expect(get.payload).toMatchObject({
      status: "unknown",
      providerDispatchState: "provider_unknown",
      communicationId: 1,
    });
    sanitized(await f.controller.recover(context(), current));
    sanitized(
      await f.controller.send(
        context(true, undefined, newCompanyInvoiceOperationKey()),
        current,
      ),
    );
    expect(f.h.provider.send).toHaveBeenCalledTimes(1);
    expect((await f.store.read(9, 42, 12))!.phase).toBe("conflict");
  });
  it("lost provider-unknown response remains unknown, not terminal and no explicit resend", async () => {
    const f = isolated();
    f.h.setProviderMode("unknown");
    vi.mocked(f.api.send).mockImplementationOnce(
      async (_token, jobId, body) => {
        await f.h.send(body, jobId);
        throw new Error("lost unknown409");
      },
    );
    expect((await f.controller.send(context(), current)).state).toBe(
      "uncertain",
    );
    expect((await f.controller.recover(context(), current)).state).toBe(
      "unknown",
    );
    expect(
      (
        await f.controller.send(
          context(true, undefined, newCompanyInvoiceOperationKey()),
          current,
        )
      ).state,
    ).toBe("unknown");
    expect(f.h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("positive initial plus two separately captured explicit resends require fresh terminal GET each time", async () => {
    const f = isolated();
    await f.controller.send(context(), current);
    for (const email of ["second@example.test", "third@example.test"]) {
      const choice = context(true, email, newCompanyInvoiceOperationKey());
      const first = await f.controller.send(choice, current);
      expect(first).toMatchObject({
        state: "completed",
        actualRecipient: email,
        operationKey: choice.operationKey,
      });
      expect((await f.controller.send(choice, current)).operationKey).toBe(
        choice.operationKey,
      );
    }
    expect(f.api.send).toHaveBeenCalledTimes(3);
    expect(f.h.rows.map((row) => row.intent_kind)).toEqual([
      "initial",
      "resend",
      "resend",
    ]);
    expect(new Set(f.h.rows.map((row) => row.logical_send_key)).size).toBe(3);
  });
  it("terminal failed GET alone permits a separately captured explicit resend, not keyless repeat", async () => {
    const f = isolated();
    f.h.setProviderMode("rejected");
    expect((await f.controller.send(context(), current)).state).toBe(
      "uncertain",
    );
    expect((await f.controller.recover(context(), current)).state).toBe(
      "failed",
    );
    expect((await f.controller.send(context(true), current)).state).toBe(
      "failed",
    );
    f.h.setProviderMode("accepted");
    expect(
      (
        await f.controller.send(
          context(true, "second@example.test", newCompanyInvoiceOperationKey()),
          current,
        )
      ).state,
    ).toBe("completed");
    expect(f.h.provider.send).toHaveBeenCalledTimes(2);
  });
  it("prior terminal pointer then different explicit active key collision holds the NEW requested key", async () => {
    const f = isolated();
    await f.controller.send(context(), current);
    await f.h.send({
      operationKey: "foreign-active-key",
      resend: true,
      recipientEmail: "another@example.test",
    });
    f.h.rows[1].state = "sending";
    f.h.rows[1].provider_dispatch_state = "provider_started";
    const choice = context(
      true,
      "requested@example.test",
      newCompanyInvoiceOperationKey(),
    );
    sanitized(await f.controller.send(choice, current));
    expect(await f.store.read(9, 42, 12)).toMatchObject({
      operationKey: choice.operationKey,
      phase: "conflict",
      lookup: null,
    });
    sanitized(await f.controller.recover(choice, current));
    expect(f.h.provider.send).toHaveBeenCalledTimes(2);
  });
});

describe("fc3 callbacks remain captured across close and identity changes", () => {
  it.each([
    "close",
    "token",
    "company",
    "user",
    "role",
    "job",
    "sheet",
    "focus",
    "recipient",
    "resend",
    "method",
    "key",
    "inactive",
  ])("delayed POST callback cannot recapture changed %s", async (change) => {
    const f = isolated();
    const original = context(false, "requested@example.test");
    const live = {
      mounted: true,
      focused: true,
      appActive: true,
      context: structuredClone(
        original,
      ) as CompanyInvoiceOperationContext | null,
    };
    const wait = deferred<unknown>();
    const started = deferred<void>();
    vi.mocked(f.api.send).mockImplementationOnce(
      async (_token, jobId, body) => {
        const response = await f.h.send(body, jobId);
        started.resolve();
        await wait.promise;
        return response.payload;
      },
    );
    const pending = f.controller.send(original, (intent) =>
      isCurrentCompanyInvoiceOperationIntent(intent, live),
    );
    await started.promise;
    const next = live.context!;
    if (change === "close") live.context = null;
    if (change === "inactive") live.appActive = false;
    if (change === "token") next.session!.token = "new-token";
    if (change === "company") next.session!.company!.id = 88;
    if (change === "user") next.session!.user.id = 43;
    if (change === "role") next.session!.user.role = "dispatcher";
    if (change === "job") next.job!.id = 13;
    if (change === "sheet")
      live.context = { ...next, lifetime: { ...next.lifetime, sheetEpoch: 2 } };
    if (change === "focus")
      live.context = { ...next, lifetime: { ...next.lifetime, focusEpoch: 2 } };
    if (change === "recipient")
      live.context = {
        ...next,
        options: { ...next.options, recipientEmail: "changed@example.test" },
      };
    if (change === "resend")
      live.context = { ...next, options: { ...next.options, resend: true } };
    if (change === "method")
      live.context = { ...next, options: { ...next.options, method: "sms" } };
    if (change === "key")
      live.context = { ...next, operationKey: "new-explicit-key" };
    wait.resolve(null);
    expect((await pending).state).toBe("stale");
    expect(await f.store.read(9, 42, 12)).toMatchObject({
      phase: "uncertain",
      operationKey: "job-invoice",
      receiptIdentity: null,
    });
    expect(f.api.lookup).toHaveBeenCalledTimes(1);
    expect(f.api.send).toHaveBeenCalledTimes(1);
  });
  it("delayed foreign GET after close cannot change journal to conflict or expose its data", async () => {
    const f = isolated();
    await seed(f.store);
    const wait = deferred<unknown>();
    const started = deferred<void>();
    let mounted = true;
    vi.mocked(f.api.lookup).mockImplementationOnce(async () => {
      started.resolve();
      return wait.promise;
    });
    const pending = f.controller.recover(context(), () => mounted);
    await started.promise;
    mounted = false;
    wait.resolve({ ...populated("foreign-key"), extra: true });
    expect((await pending).state).toBe("stale");
    expect((await f.store.read(9, 42, 12))!.phase).toBe("uncertain");
  });
  it("production closed gate makes zero transport/storage calls", async () => {
    const h = invoiceFc3Harness();
    const api = transport(h);
    const store = { read: vi.fn(), compareAndSwap: vi.fn() };
    const controller = createCompanyInvoiceOperationController({
      store,
      transport: api,
    });
    expect((await controller.send(context(), current)).state).toBe("blocked");
    expect((await controller.recover(context(), current)).state).toBe(
      "blocked",
    );
    expect(store.read).not.toHaveBeenCalled();
    expect(api.send).not.toHaveBeenCalled();
    expect(api.lookup).not.toHaveBeenCalled();
  });
});

describe("fc3 duplicate-insert race cannot authorize an echoed unpersisted key", () => {
  it.each([undefined, "another@example.test"])(
    "actual SQL unique-race fallback is sanitized for on-file/mismatching recipient: %s",
    async (email) => {
      const other = invoiceFc3Harness();
      await other.send({
        operationKey: "another-race-key",
        ...(email ? { recipientEmail: email } : {}),
      });
      const row = structuredClone(other.rows[0]);
      row.state = "queued";
      row.provider_dispatch_state = "queued";
      row.provider_message_id = null;
      row.attempt_count = 0;
      row.legacy_email_delivery_id = null;
      let raced = false;
      const durable = {
        rows: [] as any[],
        history: [] as any[],
        audits: [] as any[],
        beforeInsert(rows: any[]) {
          if (!raced) {
            raced = true;
            rows.push(row);
          }
        },
      };
      const h = invoiceFc3Harness("owner", 9, true, durable);
      const f = isolated(h);
      const value = await f.controller.send(context(), current);
      sanitized(value);
      expect(value.operationKey).toBe("job-invoice");
      expect((await h.lookup("job-invoice")).payload).toEqual(absent());
      expect(h.rows).toHaveLength(1);
      expect(h.rows[0].logical_send_key).toBe("another-race-key");
      expect(h.provider.send).toHaveBeenCalledTimes(1);
      expect(await f.store.read(9, 42, 12)).toMatchObject({
        phase: "conflict",
        operationKey: "job-invoice",
        lookup: null,
      });
      sanitized(await f.controller.recover(context(), current));
      expect(f.api.send).toHaveBeenCalledTimes(1);
    },
  );
  it("acknowledged POST then temporarily unavailable GET exposes no unverified receipt id", async () => {
    const f = isolated();
    const actualLookup = async (_token: string, jobId: number, key: string) =>
      (await f.h.lookup(key, jobId)).payload;
    vi.mocked(f.api.lookup)
      .mockImplementationOnce(actualLookup)
      .mockResolvedValueOnce(absent("job-invoice", "temporarily_unavailable"));
    const value = await f.controller.send(context(), current);
    expect(value).toMatchObject({
      state: "temporarily_unavailable",
      communicationId: null,
      actualRecipient: null,
      lookup: null,
    });
    expect(
      (await f.store.read(9, 42, 12))!.receiptIdentity!.communicationId,
    ).toBe(1);
    expect((await f.controller.recover(context(), current)).state).toBe(
      "completed",
    );
    expect(f.api.send).toHaveBeenCalledTimes(1);
  });
  it("foreign POST key even with unexpected extra identity fields is sanitized conflict", async () => {
    const f = isolated();
    vi.mocked(f.api.send).mockResolvedValueOnce({
      operationKey: "foreign-post-key",
      communicationId: 999,
      sentTo: "another@example.test",
      anotherRecipient: "another@example.test",
    });
    sanitized(await f.controller.send(context(), current));
    expect((await f.store.read(9, 42, 12))!.receiptIdentity).toBeNull();
  });
  it("delivery requires actual delivered GET, not acknowledgment sent label", async () => {
    const f = isolated();
    expect((await f.controller.send(context(), current)).isDelivered).toBe(
      false,
    );
    f.h.rows[0].state = "delivered";
    expect(await f.controller.recover(context(), current)).toMatchObject({
      state: "completed",
      isDelivered: true,
      actualRecipient: "on-file@example.test",
      communicationId: 1,
    });
  });
});

describe("fc3 delayed rejection callback guard", () => {
  it.each(["send", "lookup"])(
    "late rejected %s cannot mutate a closed sheet's journal",
    async (mode) => {
      const f = isolated();
      const started = deferred<void>();
      const wait = deferred<void>();
      let mounted = true;
      if (mode === "lookup") await seed(f.store);
      vi.mocked(
        mode === "send" ? f.api.send : f.api.lookup,
      ).mockImplementationOnce(async () => {
        started.resolve();
        await wait.promise;
        throw Object.assign(new Error("another@example.test"), {
          status: 409,
          code: "OPERATION_CONFLICT",
        });
      });
      const pending =
        mode === "send"
          ? f.controller.send(context(), () => mounted)
          : f.controller.recover(context(), () => mounted);
      await started.promise;
      mounted = false;
      wait.resolve();
      expect((await pending).state).toBe("stale");
      expect((await f.store.read(9, 42, 12))!.phase).toBe("uncertain");
    },
  );
});
