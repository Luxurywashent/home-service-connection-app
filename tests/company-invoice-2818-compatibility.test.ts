import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  assertCompanyJobInvoiceJob,
  assertCompanyJobInvoiceSession,
  captureCompanyJobInvoiceIntent,
  createCompanyJobInvoiceOptions,
  normalizeCompanyJobInvoiceRecipientEmail,
  normalizeCompanyJobInvoiceSentTo,
} from "../lib/company-job-invoice-intent";

const backend =
  "/home/ubuntu/hsc-mobile-backend-compatibility-2818bb72-20261117/backend-source-2818bb72/server/";
const mobile = "/home/ubuntu/home-service-connection-app/";
const deny = () => {
  throw new Error("DENIED unconfigured network/import/provider/SQL");
};
beforeAll(async () => {
  vi.stubGlobal("fetch", deny);
  for (const module of ["node:http", "node:https", "node:net", "node:tls"]) {
    const value = await import(module);
    for (const name of ["request", "get", "connect", "createConnection"]) {
      if (typeof value.default[name] === "function")
        vi.spyOn(value.default, name).mockImplementation(deny);
    }
  }
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Extract actual declarations, not reimplementations or source-regex assertions.
// All imports, environment, network, SQL, token generation and provider creation
// are denied unless a named fake seam below is explicitly supplied.
function extract(file: string, names: string[], inject: Record<string, any>) {
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const nodes = tree.statements.filter(
    (node) =>
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      names.includes(node.name?.getText(tree) ?? ""),
  );
  expect(nodes).toHaveLength(names.length);
  const code = ts.transpileModule(
    nodes
      .map((node) => node.getText(tree).replace(/^export\s+/, ""))
      .join("\n"),
    {
      fileName: file,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
        jsx: ts.JsxEmit.React,
      },
    },
  ).outputText;
  const context = vm.createContext({
    ...inject,
    fetch: deny,
    require: deny,
    process: { env: Object.freeze({}) },
  });
  vm.runInContext(code, context, { timeout: 2000, filename: file });
  return context;
}
const errors = extract(
  backend + "domainErrors.ts",
  ["DomainError", "domainHttpStatus", "domainMobileCode"],
  {},
);
const DomainError = vm.runInContext("DomainError", errors);
const emailErrors = extract(
  backend + "emailAdapter.ts",
  ["EmailAdapterError"],
  {},
);
const EmailAdapterError = vm.runInContext("EmailAdapterError", emailErrors);
class MobileAuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const companyFunctions = extract(
  backend + "companyContext.ts",
  [
    "isCompanyRole",
    "isManagerRole",
    "permissionsForRole",
    "normalizeCompanyTimezone",
    "createCompanyContext",
    "companyContextFromMobile",
    "requireManager",
  ],
  {
    DomainError,
    DEFAULT_COMPANY_TIMEZONE: "America/Chicago",
    isSupportedCompanyTimezone: (value: string) => value === "America/Chicago",
  },
);
const stateNames = [
  "queued",
  "sending",
  "provider_accepted",
  "delivered",
  "failed",
  "bounced",
  "complained",
  "suppressed",
  "cancelled",
];
const dispatchNames = [
  "legacy_unknown",
  "queued",
  "pre_provider",
  "provider_started",
  "provider_accepted",
  "provider_rejected",
  "provider_unknown",
];

function harness(role = "owner", companyId = 9, payments = true) {
  const rows: any[] = [];
  const history: any[] = [];
  const audits: any[] = [];
  const customer: any = {
    id: 41,
    company_id: 9,
    first_name: "Synthetic",
    last_name: "Customer",
    email: "on-file@example.test",
  };
  let providerMode = "accepted";
  let uuid = 0;
  let interruptAcceptance = false;
  const provider = {
    send: vi.fn(async (_input: any) => {
      if (providerMode === "unknown")
        throw new Error("Synthetic lost response");
      if (providerMode === "rejected")
        throw new EmailAdapterError("Synthetic definitive rejection", {
          code: "REJECTED",
          retryable: false,
          definitive: true,
        });
      return {
        providerMessageId: `synthetic-${provider.send.mock.calls.length}`,
      };
    }),
  };
  const company = companyFunctions.companyContextFromMobile(
    { accountId: 42, role },
    companyId,
  );
  const db: any = {
    execute: vi.fn(async (raw: string, p: any[] = []) => {
      const sql = raw.replace(/\s+/g, " ").trim();
      if (sql.startsWith("SELECT") && sql.includes("FROM fs_jobs"))
        return [
          p[0] === 12 && p[1] === 9
            ? [
                {
                  id: 12,
                  customer_id: 41,
                  amount: 100,
                  title: "Synthetic Invoice",
                  public_token: "synthetic-existing",
                },
              ]
            : [],
        ];
      if (sql.startsWith("SELECT") && sql.includes("FROM fs_customers"))
        return [
          p[0] === 41 && p[1] === customer.company_id ? [{ ...customer }] : [],
        ];
      if (sql.startsWith("SELECT") && sql.includes("FROM companies"))
        return [p[0] === 9 ? [{ id: 9, name: "Synthetic Company" }] : []];
      if (
        sql.startsWith("SELECT") &&
        sql.includes("FROM fs_company_communications")
      ) {
        let selected = rows.filter(
          (r) =>
            r.company_id === p[0] &&
            r.purpose === p[1] &&
            r.entity_type === p[2] &&
            r.entity_id === p[3],
        );
        if (sql.includes("logical_send_key = ?"))
          selected = selected.filter((r) => r.logical_send_key === p[4]);
        else if (sql.includes("provider_dispatch_state IN"))
          selected = selected.filter(
            (r) =>
              ["provider_started", "provider_unknown"].includes(
                r.provider_dispatch_state,
              ) ||
              (r.provider_dispatch_state === "legacy_unknown" &&
                ["queued", "sending", "failed"].includes(r.state)),
          );
        else if (sql.includes("state IN ('queued', 'sending')"))
          selected = selected.filter((r) =>
            ["queued", "sending"].includes(r.state),
          );
        else deny();
        return [
          selected
            .slice()
            .sort((a, b) => b.id - a.id)
            .slice(0, 1)
            .map((r) => ({ ...r })),
        ];
      }
      if (sql.startsWith("INSERT INTO fs_company_communications")) {
        const duplicate = rows.some(
          (r) =>
            r.company_id === p[0] &&
            r.purpose === p[1] &&
            r.entity_type === p[2] &&
            r.entity_id === p[3] &&
            (r.logical_send_key === p[12] ||
              ["queued", "sending"].includes(r.state)),
        );
        if (duplicate)
          throw Object.assign(
            new Error("Synthetic DB unique logical/active key"),
            { code: "ER_DUP_ENTRY" },
          );
        const row = {
          id: rows.length + 1,
          company_id: p[0],
          purpose: p[1],
          entity_type: p[2],
          entity_id: p[3],
          customer_id: p[4],
          recipient_email: p[5],
          recipient_name: p[6],
          sender_name: p[7],
          sender_email: p[8],
          reply_to_email: p[9],
          subject: p[10],
          body_html: p[11],
          logical_send_key: p[12],
          intent_kind: p[13],
          state: "queued",
          provider_dispatch_state: "queued",
          attempt_count: 0,
          provider_message_id: null,
          legacy_email_delivery_id: null,
        };
        rows.push(row);
        return [{ insertId: row.id }];
      }
      if (sql.startsWith("INSERT INTO fs_company_email_deliveries")) {
        history.push({
          id: history.length + 1,
          company_id: p[0],
          recipient_email: p[4],
          status: "queued",
        });
        return [{ insertId: history.length }];
      }
      if (sql.startsWith("INSERT INTO fs_audit_logs")) {
        audits.push({ action: p[2], details: JSON.parse(p[5]) });
        return [{ insertId: audits.length }];
      }
      if (sql.startsWith("UPDATE fs_company_email_deliveries")) {
        const row = history.find((r) => r.id === p[1] && r.company_id === p[2]);
        if (row)
          row.status = sql.includes("status = 'sent'") ? "sent" : "failed";
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (sql.startsWith("UPDATE fs_company_communications")) {
        if (sql.includes("SET body_html =")) {
          const row = rows.find(
            (r) =>
              r.id === p[1] &&
              r.company_id === p[2] &&
              ["queued", "failed", "sending"].includes(r.state),
          );
          if (row) row.body_html = p[0];
          return [{ affectedRows: row ? 1 : 0 }];
        }
        if (sql.includes("SET legacy_email_delivery_id =")) {
          const row = rows.find(
            (r) =>
              r.id === p[1] &&
              r.company_id === p[2] &&
              r.legacy_email_delivery_id === null,
          );
          if (row) row.legacy_email_delivery_id = p[0];
          return [{ affectedRows: row ? 1 : 0 }];
        }
        if (
          sql.includes(
            "SET state = 'sending', provider_dispatch_state = 'pre_provider'",
          )
        ) {
          const row = rows.find(
            (r) =>
              r.id === p[0] &&
              r.company_id === p[1] &&
              ((r.state === "queued" &&
                r.provider_dispatch_state === "queued") ||
                (r.state === "failed" &&
                  ["pre_provider", "provider_rejected"].includes(
                    r.provider_dispatch_state,
                  ))),
          );
          if (row) {
            row.state = "sending";
            row.provider_dispatch_state = "pre_provider";
            row.attempt_count += 1;
          }
          return [{ affectedRows: row ? 1 : 0 }];
        }
        if (sql.includes("SET provider_dispatch_state = 'provider_started'")) {
          const row = rows.find(
            (r) =>
              r.id === p[0] &&
              r.company_id === p[1] &&
              r.state === "sending" &&
              r.provider_dispatch_state === "pre_provider",
          );
          if (row) row.provider_dispatch_state = "provider_started";
          return [{ affectedRows: row ? 1 : 0 }];
        }
        if (sql.includes("SET state = 'provider_accepted'")) {
          if (interruptAcceptance)
            throw new Error("Synthetic persistence interruption");
          const row = rows.find(
            (r) =>
              r.id === p[1] &&
              r.company_id === p[2] &&
              r.state === "sending" &&
              r.provider_dispatch_state === "provider_started",
          );
          if (row) {
            row.state = "provider_accepted";
            row.provider_dispatch_state = "provider_accepted";
            row.provider_message_id = p[0];
          }
          return [{ affectedRows: row ? 1 : 0 }];
        }
        if (sql.includes("provider_dispatch_state = 'provider_unknown'")) {
          const row = rows.find(
            (r) =>
              r.id === p[1] &&
              r.company_id === p[2] &&
              r.state === "sending" &&
              r.provider_dispatch_state === "provider_started",
          );
          if (row) {
            row.provider_dispatch_state = "provider_unknown";
            row.last_error_code = "AMBIGUOUS_PROVIDER_OUTCOME";
          }
          return [{ affectedRows: row ? 1 : 0 }];
        }
        if (sql.includes("SET state = ?, provider_dispatch_state = ?")) {
          const row = rows.find(
            (r) =>
              r.id === p[5] &&
              r.company_id === p[6] &&
              r.state === "sending" &&
              r.provider_dispatch_state === p[7],
          );
          if (row) {
            row.state = p[0];
            row.provider_dispatch_state = p[1];
            row.last_error_code = p[3];
          }
          return [{ affectedRows: row ? 1 : 0 }];
        }
      }
      throw new Error("DENIED SQL: " + sql);
    }),
  };
  let snapshot: any;
  const connection = {
    ...db,
    beginTransaction: vi.fn(async () => {
      snapshot = structuredClone(rows);
    }),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {
      rows.splice(0, rows.length, ...snapshot);
    }),
    release: vi.fn(),
  };
  db.getConnection = vi.fn(async () => connection);
  const comm = extract(
    backend + "companyCommunicationService.ts",
    [
      "toNumber",
      "normalizeEmail",
      "isDuplicate",
      "asState",
      "asProviderDispatchState",
      "mapCommunicationRow",
      "withTransaction",
      "writeCommunicationAuditLog",
      "logicalIntent",
      "assertRequestAuthority",
      "resolveOwnedCommunicationRecipient",
      "findCommunication",
      "findActiveCommunication",
      "findUnsafeProviderHistory",
      "insertCommunicationIntent",
      "claimCommunication",
      "markProviderDispatchStarted",
      "markProviderAccepted",
      "markKnownFailure",
      "markAmbiguousProviderOutcome",
      "reusedResult",
      "persistCommunicationBody",
      "ensureLegacyDeliveryProjection",
      "reserveCompanyTransactionalEmail",
      "dispatchReservedCompanyTransactionalEmail",
    ],
    {
      DomainError,
      EmailAdapterError,
      requireManager: companyFunctions.requireManager,
      CANONICAL_COMMUNICATION_STATES: stateNames,
      PROVIDER_DISPATCH_STATES: dispatchNames,
      EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      randomUUID: () => `synthetic-${++uuid}`,
      resolveCompanyEmailIdentity: async () => ({
        senderName: "Synthetic Company",
        senderEmail: "billing@example.test",
        replyToEmail: null,
      }),
      PLATFORM_TRANSACTIONAL_FROM: "fake@example.test",
      createResendEmailAdapter: () => provider,
      escapeHtml: (value: string) => value,
    },
  );
  const service = extract(
    backend + "paymentService.ts",
    ["loadOwnedJob", "escapeEmailHtml", "sendJobInvoice", "sendJobInvoiceSms"],
    {
      DomainError,
      requireManager: companyFunctions.requireManager,
      EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      toNumber: Number,
      getJobPaymentBalance: async () => ({
        jobTotal: 100,
        paid: 25,
        balance: 75,
      }),
      ensureJobPublicToken: vi.fn(async () => "synthetic-token"),
      publicOrigin: () => "https://synthetic.invalid",
      publicInvoiceUrl: () => "https://synthetic.invalid/invoice/opaque",
      emailAdapterFromLegacyMailer: deny,
      reserveCompanyTransactionalEmail: comm.reserveCompanyTransactionalEmail,
      dispatchReservedCompanyTransactionalEmail:
        comm.dispatchReservedCompanyTransactionalEmail,
      writeCompanyAuditLog: async (_db: any, audit: any) => {
        audits.push(audit);
      },
      redactPublicToken: () => "redacted",
      sendCompanyTransactionalSms: vi.fn(async (_db: any, request: any) => ({
        state: "provider_accepted",
        communicationId: 1,
        request,
      })),
    },
  );
  const route = extract(
    backend + "mobileOperations.ts",
    [
      "mobileErrorStatus",
      "mobileTrpcError",
      "operationalError",
      "mobileCompany",
      "requireManager",
      "sendInvoice",
    ],
    {
      z,
      DomainError,
      MobileAuthError,
      domainHttpStatus: errors.domainHttpStatus,
      domainMobileCode: errors.domainMobileCode,
      managerRoles: new Set(["owner", "dispatcher"]),
      requireMobileCompany: async () => ({
        claims: { accountId: 42, role },
        companyId,
        db,
      }),
      companyContextFromMobile: companyFunctions.companyContextFromMobile,
      loadCompanyTimezone: deny,
      requireMobileFeature: () => {
        if (!payments)
          throw new MobileAuthError(403, "Synthetic payments disabled");
      },
      readMobileFeatureAccess: async () => ({ payments }),
      mobileRequestOrigin: () => "https://synthetic.invalid",
      sendJobInvoice: service.sendJobInvoice,
      sendJobInvoiceSms: service.sendJobInvoiceSms,
    },
  );
  async function send(body: any = {}) {
    const response = {
      code: 200,
      payload: null as any,
      status(code: number) {
        this.code = code;
        return this;
      },
      json(payload: any) {
        this.payload = payload;
        return this;
      },
    };
    await route.sendInvoice({ params: { jobId: "12" }, body }, response);
    return response;
  }
  return {
    rows,
    history,
    audits,
    customer,
    provider,
    db,
    connection,
    service,
    comm,
    company,
    send,
    setProviderMode: (mode: string) => {
      providerMode = mode;
    },
    interruptAcceptance: () => {
      interruptAcceptance = true;
    },
  };
}

function session(role = "owner") {
  return {
    token: "synthetic-invoice-token",
    portal: "company",
    company: { id: 9 },
    user: { id: 42, role },
  };
}
function intent(recipientEmail?: string) {
  return captureCompanyJobInvoiceIntent(
    session(),
    { id: "12", companyId: 9 },
    createCompanyJobInvoiceOptions("email", false, recipientEmail),
  );
}

function adapter(requestJson: (...args: any[]) => Promise<any>, candidate = false) {
  const file = mobile + "lib/jobsync-mobile-api.ts";
  const source = readFileSync(file, "utf8");
  if (candidate) expect(source).toContain("createCompanyJobInvoiceOptions");
  return extract(file, [
    "asRecord", "firstString", "validCompanyJobId", "createJobSyncBearerHeaders",
    "requireJobSyncMutationToken", "JobSyncApiError", "invoiceCommunicationState",
    "sendJobSyncCompanyJobInvoice",
  ], {
    requestJson, INVOICE_COMMUNICATION_STATES: new Set(stateNames),
    createCompanyJobInvoiceOptions, normalizeCompanyJobInvoiceSentTo,
  });
}

describe("2818 invoice immutable client contract", () => {
  it.each([undefined, "", "  "])(
    "default on-file input %j omits recipient and resets resend false",
    (value) => {
      expect(createCompanyJobInvoiceOptions("email", false, value)).toEqual({
        method: "email",
        resend: false,
      });
      expect(createCompanyJobInvoiceOptions()).toEqual({
        method: "email",
        resend: false,
      });
    },
  );
  it("captures normalized optional email before await and freezes it without profile/amount fields", async () => {
    const s = session();
    const job = { id: "12", companyId: 9 };
    const draft: any = {
      method: "email",
      resend: true,
      recipientEmail: " Bill+Invoice@Example.Test ",
      amount: 1,
      overridePhone: "+15550000000",
    };
    const saved = captureCompanyJobInvoiceIntent(s, job, draft);
    await Promise.resolve();
    draft.recipientEmail = "foreign@example.test";
    draft.resend = false;
    s.company.id = 99;
    job.id = "13";
    expect(saved.options).toEqual({
      method: "email",
      resend: true,
      recipientEmail: "bill+invoice@example.test",
    });
    expect(saved.companyId).toBe(9);
    expect(saved.jobId).toBe(12);
    expect(Object.isFrozen(saved)).toBe(true);
    expect(Object.isFrozen(saved.options)).toBe(true);
  });
  it.each([
    null,
    1,
    {},
    "invalid",
    "a@localhost",
    "a b@example.test",
    "x\n@example.test",
    "a".repeat(310) + "@example.test",
  ])("rejects invalid recipient %j", (value) => {
    expect(() => normalizeCompanyJobInvoiceRecipientEmail(value)).toThrow(
      "valid invoice recipient",
    );
  });
  it("SMS cannot capture an email override; blank is omitted", () => {
    expect(() =>
      createCompanyJobInvoiceOptions("sms", true, "bill@example.test"),
    ).toThrow("only supported");
    expect(createCompanyJobInvoiceOptions("sms", true, " ")).toEqual({
      method: "sms",
      resend: true,
    });
  });
  it.each(["owner", "dispatcher"])("preserves signed %s preflight", (role) => {
    const s = session(role);
    const i = captureCompanyJobInvoiceIntent(
      s,
      { id: 12, companyId: 9 },
      createCompanyJobInvoiceOptions(),
    );
    expect(() => assertCompanyJobInvoiceSession(i, s)).not.toThrow();
    expect(() =>
      assertCompanyJobInvoiceJob(i, { id: 12, companyId: 9 }),
    ).not.toThrow();
  });
  it.each(["technician", "admin", "developer"])(
    "denies captured %s",
    (role) => {
      expect(() =>
        captureCompanyJobInvoiceIntent(
          session(role),
          { id: 12, companyId: 9 },
          createCompanyJobInvoiceOptions(),
        ),
      ).toThrow("signed manager");
    },
  );
  it("changed token, Company, actor, role or canonical Job cannot bypass capture guards", () => {
    const i = intent();
    for (const s of [
      { ...session(), token: "rotated" },
      { ...session(), company: { id: 99 } },
      { ...session(), user: { id: 43, role: "owner" } },
      session("dispatcher"),
    ])
      expect(() => assertCompanyJobInvoiceSession(i, s)).toThrow(
        "identity changed",
      );
    for (const j of [
      { id: 13, companyId: 9 },
      { id: 12, companyId: 99 },
      { id: 12 },
    ])
      expect(() => assertCompanyJobInvoiceJob(i, j)).toThrow("originating");
  });
  it.each([null, "", "customer phone on file", "invalid", 1])(
    "malformed receipt destination %j remains unknown",
    (value) => {
      expect(normalizeCompanyJobInvoiceSentTo(value, "email")).toBeNull();
    },
  );
  it("normalizes valid email receipt without treating SMS label as exact phone", () => {
    expect(
      normalizeCompanyJobInvoiceSentTo(" BILL@Example.Test ", "email"),
    ).toBe("bill@example.test");
    expect(
      normalizeCompanyJobInvoiceSentTo("customer phone on file", "sms"),
    ).toBeNull();
  });
});

describe("Exact unpublished 2818 mobile parser, reservation, provider and audit", () => {
  it.each([undefined, false, true])(
    "default email resend %j uses persisted on-file destination everywhere",
    async (resend) => {
      const h = harness();
      const result = await h.send(
        resend === undefined ? {} : { method: "email", resend },
      );
      expect(result.code).toBe(200);
      expect(result.payload.sentTo).toBe("on-file@example.test");
      expect(h.rows[0].recipient_email).toBe(result.payload.sentTo);
      expect(h.history[0].recipient_email).toBe(result.payload.sentTo);
      expect(h.provider.send.mock.calls[0][0].to).toEqual([
        result.payload.sentTo,
      ]);
      expect(
        h.audits.find((a) => a.action === "job.invoice_sent").details
          .recipientEmail,
      ).toBe(result.payload.sentTo);
      expect(h.rows[0].intent_kind).toBe(resend ? "resend" : "initial");
      expect(h.connection.beginTransaction).toHaveBeenCalled();
      expect(h.connection.commit).toHaveBeenCalled();
      expect(result.payload.communicationState).toBe("provider_accepted");
      expect(result.payload.communicationState).not.toBe("delivered");
      expect(h.provider.send.mock.calls[0][0].html).toContain("75.00");
    },
  );
  it.each(["owner", "dispatcher"])(
    "authorized %s override matches reservation/provider/history/audit/ack and leaves profile unchanged",
    async (role) => {
      const h = harness(role);
      const result = await h.send({
        method: "email",
        recipientEmail: " Bill@Example.Test ",
      });
      expect(result.code).toBe(200);
      expect(result.payload.sentTo).toBe("bill@example.test");
      expect(h.rows[0].recipient_email).toBe("bill@example.test");
      expect(h.provider.send.mock.calls[0][0].to).toEqual([
        "bill@example.test",
      ]);
      expect(h.history[0].recipient_email).toBe("bill@example.test");
      expect(
        h.audits.find((a) => a.action === "job.invoice_sent").details
          .recipientEmail,
      ).toBe("bill@example.test");
      expect(h.customer.email).toBe("on-file@example.test");
      expect(
        h.db.execute.mock.calls.some(([sql]: [string]) =>
          /UPDATE fs_customers/.test(sql),
        ),
      ).toBe(false);
    },
  );
  it("initial duplicate with unchanged effective recipient reuses one reservation/provider call", async () => {
    const h = harness();
    const first = await h.send({ recipientEmail: "bill@example.test" });
    const duplicate = await h.send({
      recipientEmail: "BILL@example.test",
      resend: false,
    });
    expect(first.code).toBe(200);
    expect(duplicate.payload.communicationId).toBe(
      first.payload.communicationId,
    );
    expect(duplicate.payload.sentTo).toBe(first.payload.sentTo);
    expect(h.rows).toHaveLength(1);
    expect(h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("explicit resend captures new normalized recipient everywhere", async () => {
    const h = harness();
    await h.send();
    h.customer.email = "changed@example.test";
    const resend = await h.send({
      resend: true,
      recipientEmail: " New-Bill@Example.Test ",
    });
    expect(resend.code).toBe(200);
    expect(h.rows).toHaveLength(2);
    expect(h.rows[1].intent_kind).toBe("resend");
    expect(h.rows[1].recipient_email).toBe("new-bill@example.test");
    expect(h.provider.send.mock.calls[1][0].to).toEqual([
      "new-bill@example.test",
    ]);
    expect(h.history[1].recipient_email).toBe(resend.payload.sentTo);
    expect(
      h.audits.filter((a) => a.action === "job.invoice_sent")[1].details
        .recipientEmail,
    ).toBe(resend.payload.sentTo);
    expect(h.customer.email).toBe("changed@example.test");
  });
  it.each(["technician"])(
    "denies %s before SQL/reservation/provider",
    async (role) => {
      const h = harness(role);
      expect((await h.send({ recipientEmail: "bill@example.test" })).code).toBe(
        403,
      );
      expect(h.db.execute).not.toHaveBeenCalled();
      expect(h.provider.send).not.toHaveBeenCalled();
    },
  );
  it("denies a foreign Company Job and foreign customer before reservation/provider", async () => {
    const foreign = harness("owner", 99);
    expect(
      (await foreign.send({ recipientEmail: "bill@example.test" })).code,
    ).toBe(404);
    expect(foreign.rows).toHaveLength(0);
    expect(foreign.provider.send).not.toHaveBeenCalled();
    const customer = harness();
    customer.customer.company_id = 99;
    expect(
      (await customer.send({ recipientEmail: "bill@example.test" })).code,
    ).toBe(404);
    expect(customer.rows).toHaveLength(0);
  });
  it("communication boundary rejects a mismatched customer identity", async () => {
    const h = harness();
    await expect(
      h.comm.reserveCompanyTransactionalEmail(h.db, {
        company: h.company,
        purpose: "job_invoice",
        entityType: "job",
        entityId: 12,
        customerId: 999,
        recipientEmail: "bill@example.test",
        subject: "Synthetic",
        fallbackSenderName: "Synthetic",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.rows).toHaveLength(0);
    expect(h.provider.send).not.toHaveBeenCalled();
  });
  it("feature gate remains authoritative and does not enable native payments", async () => {
    const h = harness("owner", 9, false);
    expect((await h.send()).code).toBe(403);
    expect(h.db.execute).not.toHaveBeenCalled();
  });
  it.each([
    "",
    " ",
    "invalid",
    "a@localhost",
    null,
    1,
    "a".repeat(310) + "@example.test",
  ])(
    "parser rejects invalid/empty recipient %j before SQL",
    async (recipientEmail) => {
      const h = harness();
      expect((await h.send({ recipientEmail })).code).toBe(400);
      expect(h.db.execute).not.toHaveBeenCalled();
      expect(h.provider.send).not.toHaveBeenCalled();
    },
  );
  it.each([
    { method: "sms", recipientEmail: "bill@example.test" },
    { recipientPhone: "+15550000000" },
    { amount: 1 },
    { overrideEmail: "bill@example.test" },
    { resend: "true" },
  ])("strict parser rejects unsupported request %j", async (body) => {
    const h = harness();
    expect((await h.send(body)).code).toBe(400);
    expect(h.db.execute).not.toHaveBeenCalled();
    expect(h.provider.send).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "SMS resend %j preserves on-file-only response semantics",
    async (resend) => {
      const h = harness();
      const result = await h.send({ method: "sms", resend });
      expect(result.code).toBe(200);
      expect(result.payload.sentTo).toBe("customer phone on file");
      expect(result.payload.channel).toBe("sms");
      expect(h.provider.send).not.toHaveBeenCalled();
      // SMS service seam only; no claim of SMS provider destination acceptance.
    },
  );
  it.each(["unknown", "persistence interruption"])(
    "ambiguous %s blocks same initial and explicit resend, no provider retry",
    async (mode) => {
      const h = harness();
      if (mode === "unknown") h.setProviderMode("unknown");
      else h.interruptAcceptance();
      expect((await h.send()).code).toBe(409);
      expect(h.rows[0].provider_dispatch_state).toBe("provider_unknown");
      expect((await h.send()).code).toBe(409);
      expect(
        (await h.send({ resend: true, recipientEmail: "other@example.test" }))
          .code,
      ).toBe(409);
      expect(h.provider.send).toHaveBeenCalledTimes(1);
      expect(h.rows).toHaveLength(1);
    },
  );
  it("definitive provider rejection persists failed and never acknowledges sent", async () => {
    const h = harness();
    h.setProviderMode("rejected");
    const result = await h.send({ recipientEmail: "bill@example.test" });
    expect(result.code).toBe(400);
    expect(result.payload.success).toBeUndefined();
    expect(h.rows[0].state).toBe("failed");
    expect(h.rows[0].recipient_email).toBe("bill@example.test");
    expect(h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("ambiguous explicit resend retains its captured recipient and blocks another resend", async () => {
    const h = harness();
    expect((await h.send()).code).toBe(200);
    h.setProviderMode("unknown");
    expect(
      (await h.send({ resend: true, recipientEmail: "resend@example.test" }))
        .code,
    ).toBe(409);
    expect(h.rows[1].recipient_email).toBe("resend@example.test");
    expect(h.rows[1].provider_dispatch_state).toBe("provider_unknown");
    expect(
      (await h.send({ resend: true, recipientEmail: "other@example.test" }))
        .code,
    ).toBe(409);
    expect(h.rows).toHaveLength(2);
    expect(h.provider.send).toHaveBeenCalledTimes(2);
  });

  // These are active acceptance gates, deliberately NOT expected-failure or
  // defect-reproduction assertions. Backend remains read-only when they fail.
  it("ACCEPTANCE: initial reuse after on-file contact change retains original communication and recipient without another send", async () => {
    const h = harness();
    const first = await h.send();
    h.customer.email = "changed@example.test";
    const second = await h.send({ resend: false });
    expect(second.payload.communicationId).toBe(first.payload.communicationId);
    expect(second.payload.sentTo).toBe(first.payload.sentTo);
    expect(h.provider.send).toHaveBeenCalledTimes(1);
    expect(h.rows).toHaveLength(1);
  });
  it("ACCEPTANCE: changing override without explicit resend cannot create a second initial send", async () => {
    const h = harness();
    const first = await h.send({ recipientEmail: "first@example.test" });
    const second = await h.send({
      recipientEmail: "second@example.test",
      resend: false,
    });
    expect(second.payload.communicationId).toBe(first.payload.communicationId);
    expect(second.payload.sentTo).toBe(first.payload.sentTo);
    expect(h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("ACCEPTANCE: active reservation collision acknowledges/audits actual persisted recipient, not the newly requested destination", async () => {
    const h = harness();
    const reservation = await h.comm.reserveCompanyTransactionalEmail(h.db, {
      company: h.company,
      purpose: "job_invoice",
      entityType: "job",
      entityId: 12,
      customerId: 41,
      recipientEmail: "persisted@example.test",
      fallbackSenderName: "Synthetic",
      subject: "Synthetic",
      html: "<p>Synthetic</p>",
      intent: {
        kind: "initial",
        logicalSendKey: "job-invoice:persisted@example.test",
      },
    });
    expect(reservation.created).toBe(true);
    const result = await h.send({ recipientEmail: "requested@example.test" });
    // Provider and history already demonstrably use persisted@example.test.
    expect(h.provider.send.mock.calls[0][0].to).toEqual([
      h.rows[0].recipient_email,
    ]);
    expect(h.history[0].recipient_email).toBe(h.rows[0].recipient_email);
    expect(result.payload.sentTo).toBe(h.rows[0].recipient_email);
    expect(
      h.audits.find((a) => a.action === "job.invoice_sent").details
        .recipientEmail,
    ).toBe(h.rows[0].recipient_email);
  });
  it("ACCEPTANCE: explicit resend collision preserves persisted destination in provider, audit and acknowledgment", async () => {
    const h = harness();
    await h.comm.reserveCompanyTransactionalEmail(h.db, {
      company: h.company,
      purpose: "job_invoice",
      entityType: "job",
      entityId: 12,
      customerId: 41,
      recipientEmail: "persisted@example.test",
      fallbackSenderName: "Synthetic",
      subject: "Synthetic",
      html: "<p>Synthetic</p>",
      intent: {
        kind: "initial",
        logicalSendKey: "job-invoice:persisted@example.test",
      },
    });
    const result = await h.send({
      resend: true,
      recipientEmail: "resend@example.test",
    });
    expect(h.rows).toHaveLength(1);
    expect(h.provider.send.mock.calls[0][0].to).toEqual([
      h.rows[0].recipient_email,
    ]);
    const agreement = {
      reservation: h.rows[0].recipient_email,
      provider: h.provider.send.mock.calls[0][0].to[0],
      audit: h.audits.find((a) => a.action === "job.invoice_sent").details
        .recipientEmail,
      acknowledgment: result.payload.sentTo,
    };
    expect(new Set(Object.values(agreement)).size).toBe(1);
  });
});

describe("Actual integrated mobile adapter and exact returned receipt projection", () => {
  it("current adapter on-file sends once through exact backend and preserves truthful state", async () => {
    const h = harness();
    const transport = vi.fn(
      async (_path: string, init: any) =>
        (await h.send(JSON.parse(init.body))).payload,
    );
    const result = await adapter(transport).sendJobSyncCompanyJobInvoice(
      "synthetic",
      12,
      createCompanyJobInvoiceOptions(),
    );
    expect(result.communicationState).toBe("provider_accepted");
    expect(result.isDelivered).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("ACCEPTANCE/PARENT: actual adapter forwards captured recipientEmail to the existing mobile route", async () => {
    const h = harness();
    const transport = vi.fn(
      async (_path: string, init: any) =>
        (await h.send(JSON.parse(init.body))).payload,
    );
    await adapter(transport).sendJobSyncCompanyJobInvoice(
      "synthetic",
      12,
      createCompanyJobInvoiceOptions("email", true, "bill@example.test"),
    );
    expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual({
      method: "email",
      resend: true,
      recipientEmail: "bill@example.test",
    });
    expect(h.rows[0].recipient_email).toBe("bill@example.test");
  });
  it("integrated request projection round-trips immutable email through actual route/reservation/provider", async () => {
    const h = harness();
    const captured = intent("Bill@Example.Test");
    const transport = vi.fn(async (path: string, init: any) => {
      expect(path).toBe("/api/mobile/v1/jobs/12/invoice");
      expect(init.headers.Authorization).toBe("Bearer synthetic-invoice-token");
      return (await h.send(JSON.parse(init.body))).payload;
    });
    const result = await adapter(transport, true).sendJobSyncCompanyJobInvoice(
      captured.token,
      captured.jobId,
      captured.options,
    );
    expect(result.isDelivered).toBe(false);
    expect(h.rows[0].recipient_email).toBe("bill@example.test");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(["timeout", "HTTP 409", "unknown provider"])(
    "%s performs one POST and no automatic retry",
    async (message) => {
      const transport = vi.fn().mockRejectedValue(new Error(message));
      await expect(
        adapter(transport, true).sendJobSyncCompanyJobInvoice(
          "synthetic",
          12,
          createCompanyJobInvoiceOptions("email", true, "bill@example.test"),
        ),
      ).rejects.toThrow(message);
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["queued", "sending", "failed", "suppressed", "provider_accepted"])(
    "%s never claims delivered",
    async (communicationState) => {
      const result = await adapter(
        vi.fn().mockResolvedValue({
          success: true,
          publicUrl: "synthetic",
          communicationState,
          status: "sent",
        }),
      ).sendJobSyncCompanyJobInvoice(
        "synthetic",
        12,
        createCompanyJobInvoiceOptions(),
      );
      expect(result.isDelivered).toBe(false);
      expect(result.status).toBe(communicationState);
    },
  );
  it("ACCEPTANCE/PARENT: actual response projection retains returned receipt destination", async () => {
    const result = await adapter(
      vi.fn().mockResolvedValue({
        success: true,
        publicUrl: "synthetic",
        communicationState: "provider_accepted",
        channel: "email",
        sentTo: "bill@example.test",
        communicationId: 1,
      }),
    ).sendJobSyncCompanyJobInvoice(
      "synthetic",
      12,
      createCompanyJobInvoiceOptions(),
    );
    expect(result.sentTo).toBe("bill@example.test");
  });
});

// Execute the existing screen callback with only the documented capture edit
// in memory. Parent integration remains pending and is not a UI acceptance claim.
function parentCandidate(overrides: Record<string, any> = {}) {
  const file = mobile + "app/(tabs)/admin-schedule.tsx";
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(tree) === "onPress" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
        ?.getText(tree)
        .includes("sendJobSyncCompanyJobInvoice")
    )
      callback = node.initializer.expression;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!callback) throw new Error("Missing actual parent invoice callback");
  let body = callback.getText(tree);
  const anchor = "createCompanyJobInvoiceOptions(invoiceMethod, invoiceResend)";
  if (body.includes(anchor))
    body = body.replace(
      anchor,
      "createCompanyJobInvoiceOptions(invoiceMethod, invoiceResend, invoiceMethod === 'email' ? companyInvoiceRecipientEmail : undefined)",
    );
  const current = { value: true };
  const context: any = {
    invoiceLockRef: { current: false },
    isCurrentInvoice: () => current.value,
    companyJobMode: true,
    isJobSyncCompany: true,
    jobSyncLoading: false,
    jobSyncSession: session(),
    selectedJob: { id: "12", companyId: 9 },
    positiveJobSyncId: Number,
    invoiceMethod: "email",
    invoiceResend: true,
    companyInvoiceRecipientEmail: "Bill@Example.Test",
    getJobSyncMobileSession: vi.fn().mockResolvedValue(session()),
    getJobSyncCompanyJobDetail: vi
      .fn()
      .mockResolvedValue({ id: 12, companyId: 9 }),
    sendJobSyncCompanyJobInvoice: vi
      .fn()
      .mockResolvedValue({
        communicationState: "provider_accepted",
        publicUrl: "synthetic",
      }),
    setInvoiceSending: vi.fn(),
    setInvoiceSentUrl: vi.fn(),
    setCompanyInvoiceStatus: vi.fn(),
    Alert: { alert: vi.fn() },
    fetch: vi.fn(deny),
    captureCompanyJobInvoiceIntent,
    createCompanyJobInvoiceOptions,
    assertCompanyJobInvoiceSession,
    assertCompanyJobInvoiceJob,
    ...overrides,
  };
  const sandbox = vm.createContext(context);
  vm.runInContext(
    ts.transpileModule(`this.send = (${body});`, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    }).outputText,
    sandbox,
  );
  return { context, current, send: sandbox.send };
}

describe("Parent candidate capture only; real integration pending", () => {
  it("captures override before fresh signed/detail awaits and allows one locked POST", async () => {
    let resolve!: (value: any) => void;
    const wait = new Promise((yes) => {
      resolve = yes;
    });
    const h = parentCandidate({
      getJobSyncMobileSession: vi.fn().mockReturnValue(wait),
    });
    const sending = h.send();
    await h.send();
    h.context.companyInvoiceRecipientEmail = "other@example.test";
    h.context.invoiceResend = false;
    resolve(session());
    await sending;
    expect(h.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledTimes(1);
    expect(h.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledWith(
      "synthetic-invoice-token",
      12,
      { method: "email", resend: true, recipientEmail: "bill@example.test" },
    );
    expect(h.context.fetch).not.toHaveBeenCalled();
  });
  it("stale current guard prevents any signed read or POST", async () => {
    const h = parentCandidate();
    h.current.value = false;
    await h.send();
    expect(h.context.getJobSyncMobileSession).not.toHaveBeenCalled();
    expect(h.context.sendJobSyncCompanyJobInvoice).not.toHaveBeenCalled();
  });
  it("unknown send remains one POST, honest original error and no legacy fallback", async () => {
    const h = parentCandidate({
      sendJobSyncCompanyJobInvoice: vi
        .fn()
        .mockRejectedValue(new Error("Synthetic unknown outcome")),
    });
    await h.send();
    expect(h.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledTimes(1);
    expect(h.context.Alert.alert).toHaveBeenCalledWith(
      "Send Failed",
      "Synthetic unknown outcome",
    );
    expect(h.context.fetch).not.toHaveBeenCalled();
  });
});

// Render the owned input with fake React/RN only; no native device claim.
function inputHarness() {
  const file = mobile + "components/company-job-invoice-recipient.tsx";
  expect(existsSync(file)).toBe(true);
  const effects: (() => void | (() => void))[] = [];
  const refs: any[] = [];
  let cursor = 0;
  const element = (type: any, props: any, ...children: any[]) => ({
    type,
    props: { ...props, children },
  });
  const context = extract(file, ["CompanyJobInvoiceRecipient"], {
    React: { createElement: element },
    useRef: (initial: any) =>
      refs[cursor++] ?? (refs[cursor - 1] = { current: initial }),
    useLayoutEffect: (effect: () => void) => effect(),
    useEffect: (effect: () => void | (() => void)) => {
      effects.push(effect);
    },
    useJobSheetColors: () => ({
      foreground: "black",
      muted: "gray",
      border: "gray",
      surface: "white",
      error: "red",
    }),
    AppState: { currentState: "active" },
    Text: "Text",
    TextInput: "TextInput",
    TouchableOpacity: "TouchableOpacity",
    View: "View",
    styles: {},
    normalizeCompanyJobInvoiceRecipientEmail,
  });
  const find = (node: any, type: string): any => {
    if (!node || typeof node !== "object") return null;
    if (node.type === type) return node;
    for (const child of node.props?.children.flat(Infinity) ?? []) {
      const match = find(child, type);
      if (match) return match;
    }
    return null;
  };
  const render = (props: any) => {
    cursor = 0;
    return context.CompanyJobInvoiceRecipient(props);
  };
  return { context, render, find, effects };
}

describe("Owned recipient input boundaries, not installed/native acceptance", () => {
  it("email input is optional/default-on-file with controlled keyboard and reset", () => {
    const h = inputHarness();
    const onChange = vi.fn();
    const tree = h.render({
      method: "email",
      value: "bill@example.test",
      disabled: false,
      isCurrent: () => true,
      onChange,
    });
    const input = h.find(tree, "TextInput");
    expect(input.props.keyboardType).toBe("email-address");
    expect(input.props.autoCapitalize).toBe("none");
    input.props.onChangeText("new@example.test");
    h.find(tree, "TouchableOpacity").props.onPress();
    expect(onChange.mock.calls).toEqual([["new@example.test"], [""]]);
  });
  it.each([
    "disabled",
    "stale",
    "background",
    "unmounted",
    "retained old props",
  ])("%s callback cannot edit draft", (kind) => {
    const h = inputHarness();
    const onChange = vi.fn();
    const props = {
      method: "email",
      value: "",
      disabled: kind === "disabled",
      isCurrent: () => kind !== "stale",
      onChange,
    };
    const input = h.find(h.render(props), "TextInput");
    if (kind === "background") h.context.AppState.currentState = "background";
    if (kind === "unmounted") {
      const cleanup = h.effects[0]();
      if (cleanup) cleanup();
    }
    if (kind === "retained old props")
      h.render({ ...props, value: "new@example.test" });
    input.props.onChangeText("late@example.test");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("SMS offers no override input", () => {
    const h = inputHarness();
    const tree = h.render({
      method: "sms",
      value: "",
      disabled: false,
      isCurrent: () => true,
      onChange: vi.fn(),
    });
    expect(h.find(tree, "TextInput")).toBeNull();
  });
});
