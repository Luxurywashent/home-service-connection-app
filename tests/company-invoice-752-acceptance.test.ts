// Source-pinned 752 invoice rerun. Original four ACCEPTANCE bodies are copied verbatim.
import { readFileSync, writeFileSync } from "node:fs";
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
import {
  COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY,
  assertCompanyJobInvoiceRecipientCapability,
  createCompanyJobInvoiceAttemptGuard,
  validateCompanyJobInvoiceRecipientReceipt,
} from "../lib/company-job-invoice-recipient";

const backend =
  "/home/ubuntu/hsc-mobile-752ccca3-compatibility-20261117/backend-source-752ccca3/server/";
const backendRevision = "752ccca3edf69ef35ca7b1a470484f3f204f4568";
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
      names.includes(node.name?.getText(tree) ?? "") ||
      (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => names.includes(declaration.name.getText(tree)))),
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

function harness(role = "owner", companyId = 9, payments = true, durable?: any) {
  const rows: any[] = durable?.rows ?? [];
  const history: any[] = durable?.history ?? [];
  const audits: any[] = durable?.audits ?? [];
  const customer: any = durable?.customer ?? {
    id: 41,
    company_id: 9,
    first_name: "Synthetic",
    last_name: "Customer",
    email: "on-file@example.test",
  };
  let providerMode = "accepted";
  let uuid = rows.length;
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
        if (sql.includes("ORDER BY created_at DESC, id DESC")) {
          return [rows.filter((r) => r.company_id === p[0]).slice().sort((a, b) => b.id - a.id).map((r) => ({ ...r, channel: "email", provider: "resend" }))];
        }
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
      "COMPANY_COMMUNICATION_HISTORY_COLUMNS",
      "mapCompanyCommunicationHistoryRow",
      "listCompanyCommunications",
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
describe("2574 invoice immutable client contract", () => {
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

describe("Exact read-only target2574 mobile parser, reservation, provider and audit", () => {
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


describe("752 source pin and blocked mobile capability", () => {
  it("uses the supplied exact revision and requires all recipient gates before enabling", () => {
    const metadata = JSON.parse(readFileSync("/home/ubuntu/hsc-mobile-752ccca3-compatibility-20261117/backend-revision.json", "utf8"));
    expect(metadata.sha).toBe(backendRevision);
    expect(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.backendRevision).toBe(backendRevision);
    expect(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.alternateRecipientSendingEnabled).toBe(false);
    expect(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.stableInitialReservation).toBe(false);
    expect(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.persistedRecipientAcknowledgment).toBe(false);
    expect(Object.isFrozen(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY)).toBe(true);
    expect(() => assertCompanyJobInvoiceRecipientCapability(intent("alternate@example.test"))).toThrow("not passed");
    expect(() => assertCompanyJobInvoiceRecipientCapability(intent())).not.toThrow();
  });
  it("captured alternate/resend/channel never changes after an await or draft mutation", async () => {
    const options: any = { method: "email", resend: true, recipientEmail: " Alternate@Example.Test " };
    const captured = captureCompanyJobInvoiceIntent(session(), { id: 12, companyId: 9 }, options);
    await Promise.resolve();
    options.method = "sms"; options.resend = false; options.recipientEmail = "changed@example.test";
    expect(captured.options).toEqual({ method: "email", resend: true, recipientEmail: "alternate@example.test" });
    expect(Object.isFrozen(captured.options)).toBe(true);
    expect(() => assertCompanyJobInvoiceRecipientCapability(captured)).toThrow("not passed");
  });
});

function request(h: ReturnType<typeof harness>, recipientEmail = "persisted@example.test") {
  return {
    company: h.company, purpose: "job_invoice", entityType: "job", entityId: 12,
    customerId: 41, recipientEmail, fallbackSenderName: "Synthetic",
    subject: "Synthetic", html: "<p>Synthetic</p>",
    intent: { kind: "initial", logicalSendKey: `job-invoice:${recipientEmail}` },
  };
}

describe("752 durable SQL identity and fresh-service restart recovery", () => {
  it("same-recipient lost HTTP response recovery reuses accepted SQL reservation after restart", async () => {
    const firstProcess = harness();
    const lost = await firstProcess.send({ recipientEmail: "persisted@example.test" });
    expect(lost.code).toBe(200);
    expect(firstProcess.rows[0].state).toBe("provider_accepted");
    const restarted = harness("owner", 9, true, firstProcess);
    const recovered = await restarted.send({ recipientEmail: "persisted@example.test", resend: false });
    expect(recovered.code).toBe(200);
    expect(recovered.payload.communicationId).toBe(lost.payload.communicationId);
    expect(recovered.payload.sentTo).toBe("persisted@example.test");
    expect(restarted.provider.send).not.toHaveBeenCalled();
    expect(firstProcess.provider.send).toHaveBeenCalledTimes(1);
    expect(restarted.rows).toHaveLength(1);
  });
  it("on-file lost HTTP response with unchanged contact recovers the same communication after restart", async () => {
    const firstProcess = harness();
    const lost = await firstProcess.send();
    const restarted = harness("owner", 9, true, firstProcess);
    const recovered = await restarted.send();
    expect(recovered.code).toBe(200);
    expect(recovered.payload.communicationId).toBe(lost.payload.communicationId);
    expect(recovered.payload.sentTo).toBe(lost.payload.sentTo);
    expect(restarted.provider.send).not.toHaveBeenCalled();
    expect(restarted.rows).toHaveLength(1);
  });
  it.each(["unknown", "persistence interruption"])("%s survives fresh-service restart and blocks both initial and explicit resend", async (mode) => {
    const firstProcess = harness();
    if (mode === "unknown") firstProcess.setProviderMode("unknown"); else firstProcess.interruptAcceptance();
    expect((await firstProcess.send({ recipientEmail: "persisted@example.test" })).code).toBe(409);
    const restarted = harness("owner", 9, true, firstProcess);
    expect(restarted.rows[0].provider_dispatch_state).toBe("provider_unknown");
    expect((await restarted.send({ recipientEmail: "persisted@example.test" })).code).toBe(409);
    expect((await restarted.send({ resend: true, recipientEmail: "other@example.test" })).code).toBe(409);
    expect(restarted.provider.send).not.toHaveBeenCalled();
    expect(firstProcess.provider.send).toHaveBeenCalledTimes(1);
    expect(restarted.rows).toHaveLength(1);
  });
  it("queued reservation survives restart and dispatches its captured recipient once", async () => {
    const firstProcess = harness();
    const reserved = await firstProcess.comm.reserveCompanyTransactionalEmail(firstProcess.db, request(firstProcess));
    expect(reserved.state).toBe("queued");
    expect(firstProcess.provider.send).not.toHaveBeenCalled();
    const restarted = harness("owner", 9, true, firstProcess);
    const sent = await restarted.send({ recipientEmail: "persisted@example.test" });
    expect(sent.code).toBe(200);
    expect(sent.payload.communicationState).toBe("provider_accepted");
    expect(sent.payload.communicationId).toBe(reserved.communicationId);
    expect(restarted.provider.send.mock.calls[0][0].to).toEqual(["persisted@example.test"]);
    expect(restarted.provider.send).toHaveBeenCalledTimes(1);
    expect(restarted.rows).toHaveLength(1);
  });
  it.each(["pre_provider", "provider_started", "provider_unknown", "legacy_unknown"])("sending/%s is not acknowledged as sent and cannot dispatch again after restart", async (providerDispatchState) => {
    const firstProcess = harness();
    await firstProcess.comm.reserveCompanyTransactionalEmail(firstProcess.db, request(firstProcess));
    firstProcess.rows[0].state = "sending";
    firstProcess.rows[0].provider_dispatch_state = providerDispatchState;
    const restarted = harness("owner", 9, true, firstProcess);
    const result = await restarted.send({ recipientEmail: "persisted@example.test" });
    expect(result.code).toBe(409);
    expect(result.payload.success).toBeUndefined();
    expect(restarted.provider.send).not.toHaveBeenCalled();
    expect(restarted.rows).toHaveLength(1);
  });
  it("ambiguous explicit resend survives restart and blocks another logical resend", async () => {
    const firstProcess = harness();
    await firstProcess.send();
    firstProcess.setProviderMode("unknown");
    expect((await firstProcess.send({ resend: true, recipientEmail: "resend@example.test" })).code).toBe(409);
    const restarted = harness("owner", 9, true, firstProcess);
    expect((await restarted.send({ resend: true, recipientEmail: "other@example.test" })).code).toBe(409);
    expect(restarted.rows[1].recipient_email).toBe("resend@example.test");
    expect(restarted.rows).toHaveLength(2);
    expect(restarted.provider.send).not.toHaveBeenCalled();
    expect(firstProcess.provider.send).toHaveBeenCalledTimes(2);
  });
  it("explicit successful resend uses a separate durable key, current normalized recipient and server amount", async () => {
    const h = harness();
    await h.send();
    const second = await h.send({ resend: true, recipientEmail: "resend@example.test" });
    expect(second.code).toBe(200);
    expect(h.rows[0].logical_send_key).not.toBe(h.rows[1].logical_send_key);
    expect(h.rows[1].logical_send_key).toMatch(/^resend:/);
    expect(h.rows[1].intent_kind).toBe("resend");
    expect(h.rows[1].recipient_email).toBe(second.payload.sentTo);
    expect(h.provider.send.mock.calls[1][0].html).toContain("75.00");
    expect(h.customer.email).toBe("on-file@example.test");
  });
  it("strict mobile parser does not advertise a client operationKey or GET recovery request", async () => {
    const h = harness();
    const result = await h.send({ operationKey: "synthetic-protected-original-key", resend: true });
    expect(result.code).toBe(400);
    expect(h.db.execute).not.toHaveBeenCalled();
    expect(h.provider.send).not.toHaveBeenCalled();
  });
});

describe("752 authoritative internal communication history, not invented mobile GET", () => {
  it("read-only history uses the persisted recipient/key/provider state and no provider calls", async () => {
    const h = harness();
    await h.send({ recipientEmail: "persisted@example.test" });
    h.customer.email = "changed@example.test";
    const rows = await h.comm.listCompanyCommunications(h.db, h.company);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, channel: "email", purpose: "job_invoice", entityType: "job", entityId: 12, recipientEmail: "persisted@example.test", logicalSendKey: "job-invoice:persisted@example.test", intentKind: "initial", state: "provider_accepted", providerDispatchState: "provider_accepted", providerMessageId: "synthetic-1" });
    expect(h.provider.send).toHaveBeenCalledTimes(1);
    const restarted = harness("owner", 9, true, h);
    const readback = await restarted.comm.listCompanyCommunications(restarted.db, restarted.company);
    expect(readback[0]).toEqual(rows[0]);
    expect(restarted.provider.send).not.toHaveBeenCalled();
  });
  it("read-only history preserves durable provider_unknown outcome across restart", async () => {
    const h = harness();
    h.setProviderMode("unknown");
    expect((await h.send()).code).toBe(409);
    const restarted = harness("owner", 9, true, h);
    const rows = await restarted.comm.listCompanyCommunications(restarted.db, restarted.company);
    expect(rows[0].state).toBe("sending");
    expect(rows[0].providerDispatchState).toBe("provider_unknown");
    expect(rows[0].providerMessageId).toBeNull();
    expect(rows[0].lastErrorCode).toBe("AMBIGUOUS_PROVIDER_OUTCOME");
    expect(restarted.provider.send).not.toHaveBeenCalled();
  });
  it("manager and Company scope remains enforced on internal readback", async () => {
    const h = harness();
    await h.send();
    const foreign = harness("owner", 99, true, h);
    expect(await foreign.comm.listCompanyCommunications(foreign.db, foreign.company)).toEqual([]);
    const technician = harness("technician", 9, true, h);
    await expect(technician.comm.listCompanyCommunications(technician.db, technician.company)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(technician.db.execute).not.toHaveBeenCalled();
    expect(technician.provider.send).not.toHaveBeenCalled();
  });
});

describe("752 unchanged fail-closed mobile receipt and in-memory attempt safeguards", () => {
  const receipt = (extra: Record<string, unknown> = {}) => ({ success: true, publicUrl: "https://synthetic.invalid/invoice/opaque", channel: "email", sentTo: "acknowledged@example.test", communicationState: "provider_accepted", ...extra });
  it.each(["queued", "sending", "provider_accepted", "failed", "suppressed", "bounced", "cancelled", "complained"])("%s is not delivered; recipient is acknowledged only, not verified", (communicationState) => {
    const result = validateCompanyJobInvoiceRecipientReceipt(intent(), receipt({ communicationState, isDelivered: true }));
    expect(result.communicationState).toBe(communicationState);
    expect(result.isDelivered).toBe(false);
    expect(result.acknowledgedRecipient).toBe("acknowledged@example.test");
    expect(result.actualRecipient).toBeNull();
    expect(result.recipientVerified).toBe(false);
  });
  it.each([null, "future", 1])("invalid state %j never falls back to delivered alias", (communicationState) => {
    const result = validateCompanyJobInvoiceRecipientReceipt(intent(), receipt({ communicationState, status: "delivered" }));
    expect(result.communicationState).toBeNull();
    expect(result.isDelivered).toBe(false);
  });
  it.each(["uncertain", "not_dispatched"] as const)("dispatched attempt cannot be cleared by %s or fresh sheet options", (outcome) => {
    const guard = createCompanyJobInvoiceAttemptGuard();
    const attempt = guard.begin(intent());
    guard.markDispatched(attempt);
    guard.finish(attempt, outcome);
    expect(() => guard.begin(intent())).toThrow("unknown");
    const resend = captureCompanyJobInvoiceIntent(session(), { id: 12, companyId: 9 }, createCompanyJobInvoiceOptions("email", true));
    expect(() => guard.begin(resend)).toThrow("unknown");
  });
  it("late old cancellation cannot release a newer active attempt", () => {
    const guard = createCompanyJobInvoiceAttemptGuard();
    const old = guard.begin(intent());
    guard.finish(old, "not_dispatched");
    const current = guard.begin(intent());
    guard.finish(old, "acknowledged");
    expect(() => guard.markDispatched(old)).toThrow("no longer current");
    expect(() => guard.begin(intent())).toThrow("pending");
    guard.markDispatched(current);
  });
});

// Supplementary forensic snapshots, not acceptance assertions. Preserve all four
// original failing requirements above; bad effects are never reclassified PASS.
afterAll(async () => {
  const snapshot = (h: ReturnType<typeof harness>, response: any) => ({
    response, rows: structuredClone(h.rows), history: structuredClone(h.history),
    audits: structuredClone(h.audits), providerRecipients: h.provider.send.mock.calls.map(([input]: [any]) => input.to),
  });
  const onfile = harness();
  const onfileFirst = await onfile.send();
  onfile.customer.email = "changed@example.test";
  const onfileSecond = await onfile.send({ resend: false });
  const override = harness();
  const overrideFirst = await override.send({ recipientEmail: "first@example.test" });
  const overrideSecond = await override.send({ recipientEmail: "second@example.test", resend: false });
  const collision = harness();
  await collision.comm.reserveCompanyTransactionalEmail(collision.db, request(collision));
  const collided = await collision.send({ recipientEmail: "requested@example.test" });
  const resendCollision = harness();
  await resendCollision.comm.reserveCompanyTransactionalEmail(resendCollision.db, request(resendCollision));
  const collidedResend = await resendCollision.send({ resend: true, recipientEmail: "resend@example.test" });
  const restartInitial = harness();
  const lostInitial = await restartInitial.send();
  restartInitial.customer.email = "changed@example.test";
  const freshInitial = harness("owner", 9, true, restartInitial);
  const changedRecovery = await freshInitial.send({ resend: false });
  const restartResend = harness();
  const lostResend = await restartResend.send({ resend: true, recipientEmail: "resend@example.test" });
  const freshResend = harness("owner", 9, true, restartResend);
  const repeatedResend = await freshResend.send({ resend: true, recipientEmail: "resend@example.test" });
  const unknownChanged = harness();
  unknownChanged.setProviderMode("unknown");
  await unknownChanged.send();
  unknownChanged.customer.email = "changed@example.test";
  const freshUnknown = harness("owner", 9, true, unknownChanged);
  const unknownRecovery = await freshUnknown.send({ resend: false });
  const traces = {
    backendRevision,
    initialOnfileChanged: { first: onfileFirst, ...snapshot(onfile, onfileSecond) },
    initialOverrideChanged: { first: overrideFirst, ...snapshot(override, overrideSecond) },
    activeCollision: snapshot(collision, collided),
    resendCollision: snapshot(resendCollision, collidedResend),
    restartOnfileChangedAfterLostAcceptedResponse: { first: lostInitial, ...snapshot(freshInitial, changedRecovery) },
    restartSuccessfulResendAfterLostAcceptedResponse: { first: lostResend, ...snapshot(freshResend, repeatedResend) },
    restartUnknownWithChangedOnfile: snapshot(freshUnknown, unknownRecovery),
  };
  writeFileSync("/home/ubuntu/hsc-mobile-752ccca3-compatibility-20261117/invoice-fixtures/wire-restart-traces.json", JSON.stringify(traces, null, 2) + "\n");
});

// Execute the actual controlled React component with minimal React/RN seams;
// no native render, network, API or provider imports are permitted.
function componentHarness() {
  const file = "/home/ubuntu/home-service-connection-app/components/company-job-invoice-recipient.tsx";
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "CompanyJobInvoiceRecipient");
  if (!component) throw new Error("Missing authoritative invoice component");
  const effects: (() => void | (() => void))[] = [];
  const refs: any[] = [];
  let cursor = 0;
  const context = vm.createContext({
    React: { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) },
    useRef: (value: any) => refs[cursor++] ?? (refs[cursor - 1] = { current: value }),
    useLayoutEffect: (effect: () => void) => effect(),
    useEffect: (effect: () => void | (() => void)) => effects.push(effect),
    useJobSheetColors: () => ({ foreground: "black", muted: "gray", warning: "orange" }),
    AppState: { currentState: "active" }, Text: "Text", View: "View", TextInput: "TextInput", TouchableOpacity: "TouchableOpacity", styles: {},
    normalizeCompanyJobInvoiceRecipientEmail,
    fetch: () => { throw new Error("DENIED network"); }, require: () => { throw new Error("DENIED imports"); }, process: { env: {} },
  });
  vm.runInContext(ts.transpileModule(component.getText(tree).replace(/^export\s+/, ""), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText, context);
  const nodes = (node: any): any[] => !node || typeof node !== "object" ? [] : [node, ...(node.props?.children.flat(Infinity) ?? []).flatMap(nodes)];
  const render = (props: any) => { cursor = 0; return context.CompanyJobInvoiceRecipient(props); };
  return { context, effects, render, nodes };
}

describe("Actual recipient control default/alternate context and stale callbacks", () => {
  it("displays canonical on-file email without copying it into the optional override and explains unavailable sending", () => {
    const h = componentHarness();
    const onChange = vi.fn();
    const tree = h.render({ method: "email", value: "", disabled: false, isCurrent: () => true, onChange, defaultEmail: "canonical@example.test", sendingUnavailableReason: COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.reason });
    const input = h.nodes(tree).find((node) => node.type === "TextInput");
    expect(input.props.value).toBe("");
    expect(input.props.returnKeyType).toBe("done");
    expect(input.props.keyboardType).toBe("email-address");
    const text = h.nodes(tree).filter((node) => node.type === "Text").flatMap((node) => node.props.children).join(" ");
    expect(text).toContain("canonical@example.test");
    expect(text).toContain("not passed");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("alternate email reset means omitted recipient/default; focus callbacks retain parent keyboard guards", () => {
    const h = componentHarness();
    const onChange = vi.fn(); const onInputFocus = vi.fn(); const onInputBlur = vi.fn();
    const tree = h.render({ method: "email", value: "alternate@example.test", disabled: false, isCurrent: () => true, onChange, onInputFocus, onInputBlur });
    const input = h.nodes(tree).find((node) => node.type === "TextInput");
    input.props.onFocus("focus"); input.props.onBlur("blur");
    h.nodes(tree).find((node) => node.type === "TouchableOpacity").props.onPress();
    expect(onChange).toHaveBeenCalledWith("");
    expect(createCompanyJobInvoiceOptions("email", false, onChange.mock.calls[0][0])).not.toHaveProperty("recipientEmail");
    expect(onInputFocus).toHaveBeenCalledWith("focus");
    expect(onInputBlur).toHaveBeenCalledWith("blur");
  });
  it.each(["disabled", "background", "unmounted", "old props", "stale sheet"])("%s cannot mutate/reset/focus the controlled draft", (kind) => {
    const h = componentHarness(); const onChange = vi.fn(); const onInputFocus = vi.fn();
    const props = { method: "email", value: "alternate@example.test", disabled: kind === "disabled", isCurrent: () => kind !== "stale sheet", onChange, onInputFocus };
    const tree = h.render(props);
    if (kind === "background") h.context.AppState.currentState = "background";
    if (kind === "old props") h.render({ ...props, value: "new@example.test" });
    if (kind === "unmounted") { const cleanup = h.effects[0](); if (cleanup) cleanup(); }
    const input = h.nodes(tree).find((node) => node.type === "TextInput");
    input.props.onChangeText("late@example.test"); input.props.onFocus("late");
    h.nodes(tree).find((node) => node.type === "TouchableOpacity").props.onPress();
    expect(onChange).not.toHaveBeenCalled(); expect(onInputFocus).not.toHaveBeenCalled();
  });
  it("SMS does not expose email/phone override input", () => {
    const h = componentHarness();
    const tree = h.render({ method: "sms", value: "", disabled: false, isCurrent: () => true, onChange: vi.fn() });
    expect(h.nodes(tree).some((node) => node.type === "TextInput")).toBe(false);
  });
});
