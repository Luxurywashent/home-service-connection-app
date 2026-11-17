import { createHash } from "node:crypto";
// New focused exact0fbd invoice durability fixtures. Historical acceptance bodies/files are untouched.
// Backend declarations run in a denied-I/O VM with an isolated SQL/adapter fixture only.
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { captureCompanyJobInvoiceIntent, createCompanyJobInvoiceOptions } from "../lib/company-job-invoice-intent";
import { COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY, assertCompanyJobInvoiceRecipientCapability, createCompanyJobInvoiceAttemptGuard, validateCompanyJobInvoiceRecipientReceipt } from "../lib/company-job-invoice-recipient";
const sourceHashes = new Map<string,string>();
const extractedDeclarations: any[] = [];
const gateHarnesses: any[] = [];
const gateEvidence: any[] = [];
const backend =
  "/home/ubuntu/hsc-mobile-0fbd-final-integration-20261117/backend-source-0fbd3b67/server/";
const backendRevision = "0fbd3b673eaadb0a1e646c2003b806d439c87088";
const deny = () => {
  throw new Error("DENIED unconfigured network/import/provider/SQL");
};
beforeAll(async () => {
  for (const [file, hash] of Object.entries({
    "paymentService.ts": "0a6aa9dcbea661a83348a966867021623e0354eb0a4a93218250f4964dd9383d",
    "companyCommunicationService.ts": "0b9654ad88949df3217f811ae7c5a9721c9ff2760e5f7db54bce4ac9de74124c",
    "mobileOperations.ts": "8aec14141fca91a26c0120427d16b7a195b262771ca0b87814dcecc64601d928",
  })) expect(createHash("sha256").update(readFileSync(backend + file)).digest("hex")).toBe(hash);
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
  sourceHashes.set(file, createHash("sha256").update(source).digest("hex"));
  extractedDeclarations.push({ file, names });
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
  const responses: any[] = [];
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
  let interruptUnknown = false;
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
          if (interruptUnknown) throw new Error("Synthetic unknown marker persistence interruption");
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
    responses.push(structuredClone(response.payload));
    return response;
  }
  gateHarnesses.push({rows,history,audits,customer,provider,db,connection,responses});
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
    interruptUnknown: () => { interruptUnknown = true; },
  };
}


afterEach(() => { gateEvidence.push({ test: expect.getState().currentTestName, fixtures: gateHarnesses.splice(0).map(h => ({ responses: h.responses, rows: structuredClone(h.rows), history: structuredClone(h.history), audits: structuredClone(h.audits), customer: structuredClone(h.customer), providerCalls: h.provider.send.mock.calls, sql: h.db.execute.mock.calls, transactions: { begin: h.connection.beginTransaction.mock.calls.length, commit: h.connection.commit.mock.calls.length, rollback: h.connection.rollback.mock.calls.length } })) }); });
afterAll(() => writeFileSync("/home/ubuntu/hsc-mobile-0fbd-final-integration-20261117/invoice-focused-runtime.json", JSON.stringify({ backendRevision, sourceHashes: Object.fromEntries(sourceHashes), extractedDeclarations, tests: gateEvidence }, null, 2) + "\n"));


function captured(resend = false, recipientEmail?: string) {
  return captureCompanyJobInvoiceIntent(
    { token: "synthetic-invoice-token", portal: "company", company: { id: 9 }, user: { id: 42, role: "owner" } },
    { id: 12, companyId: 9 }, createCompanyJobInvoiceOptions("email", resend, recipientEmail),
  );
}
function baseRequest(h: ReturnType<typeof harness>) {
  return { company: h.company, purpose: "job_invoice", entityType: "job", entityId: 12,
    customerId: 41, recipientEmail: "persisted@example.test", fallbackSenderName: "Synthetic", subject: "Synthetic",
    html: "<p>Synthetic</p>", intent: { kind: "initial", logicalSendKey: "job-invoice" } };
}
async function canonical(h: ReturnType<typeof harness>) {
  const calls = h.provider.send.mock.calls.length;
  const rows = await h.comm.listCompanyCommunications(h.db, h.company, 100);
  expect(h.provider.send.mock.calls.length).toBe(calls);
  return rows;
}
function agreement(h: ReturnType<typeof harness>, result: any, index = 0) {
  const row = h.rows[index];
  expect(result.payload.sentTo).toBe(row.recipient_email);
  expect(result.payload.communicationId).toBe(row.id);
  expect(h.provider.send.mock.calls[index][0].to).toEqual([row.recipient_email]);
  expect(h.history[index].recipient_email).toBe(row.recipient_email);
  expect(h.audits.filter(a => a.action === "job.invoice_sent")[index].details.recipientEmail).toBe(row.recipient_email);
}

describe("Exact0fbd initial identity and actual persisted recipient", () => {
  it.each(["on-file", "alternate"])("%s contact change after initial keeps durable identity across fresh backend runtime", async kind => {
    const h = harness();
    const first = await h.send(kind === "alternate" ? { recipientEmail: "FIRST@Example.Test" } : {});
    h.customer.email = "changed@example.test";
    const restarted = harness("owner", 9, true, h);
    const reused = await restarted.send(kind === "alternate" ? { recipientEmail: "second@example.test", resend: false } : { resend: false });
    expect(first.code).toBe(200); expect(reused.code).toBe(200);
    expect(reused.payload.sentTo).toBe(first.payload.sentTo);
    expect(reused.payload.communicationId).toBe(first.payload.communicationId);
    expect(h.rows).toHaveLength(1); expect(h.rows[0].logical_send_key).toBe("job-invoice");
    expect(h.provider.send).toHaveBeenCalledTimes(1); expect(restarted.provider.send).not.toHaveBeenCalled();
    agreement(h, first);
    expect(h.connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(h.connection.commit).toHaveBeenCalledTimes(1); expect(h.connection.release).toHaveBeenCalledTimes(1);
    expect((await canonical(restarted))[0]).toMatchObject({ id: first.payload.communicationId, logicalSendKey: "job-invoice", recipientEmail: first.payload.sentTo, state: "provider_accepted", providerDispatchState: "provider_accepted" });
  });
  it.each([false, true])("active initial/resend=%j collision retains recipient in all effect and ack fields", async resend => {
    const h = harness(); const reservation = await h.comm.reserveCompanyTransactionalEmail(h.db, baseRequest(h));
    expect(h.provider.send).not.toHaveBeenCalled(); expect(h.history).toHaveLength(0);
    const result = await h.send({ recipientEmail: "requested@example.test", resend });
    expect(result.code).toBe(200); expect(h.rows).toHaveLength(1);
    expect(result.payload.communicationId).toBe(reservation.communicationId); agreement(h, result);
    expect(h.customer.email).toBe("on-file@example.test");
    expect(h.db.execute.mock.calls.some(([sql]: [string]) => /UPDATE fs_customers/.test(sql))).toBe(false);
  });
  it("returned email fields include a durable ID but no logical key, dispatch-state or replay identity", async () => {
    const h = harness(); const result = await h.send({ recipientEmail: " Bill@Example.Test " });
    expect(Object.keys(result.payload).sort()).toEqual(["success", "deliveryId", "communicationId", "providerMessageId", "status", "communicationState", "publicUrl", "sentTo", "channel"].sort());
    expect(result.payload).toMatchObject({ success: true, deliveryId: 1, communicationId: 1, providerMessageId: "synthetic-1", status: "sent", communicationState: "provider_accepted", sentTo: "bill@example.test", channel: "email" });
    const receipt = validateCompanyJobInvoiceRecipientReceipt(captured(false, "bill@example.test"), result.payload);
    expect(receipt.communicationState).toBe("provider_accepted"); expect(receipt.isDelivered).toBe(false);
    expect(receipt.recipientVerified).toBe(false); expect(receipt.actualRecipient).toBeNull();
    agreement(h, result);
  });
  it("explicit acknowledged resend captures new recipient with a distinct server identity", async () => {
    const h = harness(); await h.send(); const sent = await h.send({ resend: true, recipientEmail: " New@Example.Test " });
    expect(sent.code).toBe(200); expect(h.rows).toHaveLength(2);
    expect(h.rows[1]).toMatchObject({ logical_send_key: "resend:synthetic-1", intent_kind: "resend", recipient_email: "new@example.test" });
    agreement(h, sent, 1);
  });
  it.each(["owner", "dispatcher"])("signed %s passes exact on-file send authority", async role => {
    const h = harness(role); const result = await h.send();
    expect(result.code).toBe(200); agreement(h, result);
  });
  it("technician, foreign Company Job and disabled payments cannot reach invoice provider", async () => {
    for (const h of [harness("technician"), harness("owner", 99), harness("owner", 9, false)]) {
      const result = await h.send({ recipientEmail: "alternate@example.test" });
      expect([403, 404]).toContain(result.code); expect(h.rows).toHaveLength(0); expect(h.provider.send).not.toHaveBeenCalled();
    }
  });
  it("definitive rejection persists failed and never fabricates a successful acknowledgment", async () => {
    const h = harness(); h.setProviderMode("rejected"); const result = await h.send({ recipientEmail: "rejected@example.test" });
    expect(result.code).toBe(400); expect(result.payload.success).toBeUndefined();
    expect(h.rows[0]).toMatchObject({ state: "failed", provider_dispatch_state: "provider_rejected", recipient_email: "rejected@example.test" });
    expect(h.provider.send).toHaveBeenCalledTimes(1);
  });
});

describe("Exact0fbd lost-response and app/backend restart contract gaps", () => {
  it("lost accepted initial response still has one durable send; replay POST is not a permissible read", async () => {
    const h = harness(); await h.send({ recipientEmail: "first@example.test" }); // Client receives no result.
    const restarted = harness("owner", 9, true, h);
    const result = await restarted.send({ resend: false, recipientEmail: "changed@example.test" });
    expect(result.payload.communicationId).toBe(1); expect(result.payload.sentTo).toBe("first@example.test");
    expect(h.rows).toHaveLength(1); expect(restarted.provider.send).not.toHaveBeenCalled();
  });
  it("lost accepted explicit resend cannot be replayed: same POST creates another server identity/send", async () => {
    const h = harness(); await h.send(); const request = { resend: true, recipientEmail: "resend@example.test" };
    await h.send(request); // Completed provider/SQL effect, client response lost.
    const restarted = harness("owner", 9, true, h);
    const replay = await restarted.send(request); // Fixture proof only; app must NEVER perform this recovery.
    expect(replay.code).toBe(200); expect(h.rows).toHaveLength(3);
    expect(h.rows[2].id).not.toBe(h.rows[1].id); expect(h.rows[2].logical_send_key).not.toBe(h.rows[1].logical_send_key);
    expect(restarted.provider.send).toHaveBeenCalledTimes(1);
    expect((await canonical(restarted)).filter((r: any) => r.intentKind === "resend")).toHaveLength(2);
  });
  it("queued reservation survives restart but POST dispatches it, proving POST cannot be a status check", async () => {
    const h = harness(); const reservation = await h.comm.reserveCompanyTransactionalEmail(h.db, baseRequest(h));
    const restarted = harness("owner", 9, true, h);
    expect((await canonical(restarted))[0]).toMatchObject({ id: reservation.communicationId, state: "queued", providerDispatchState: "queued" });
    expect(restarted.provider.send).not.toHaveBeenCalled();
    const result = await restarted.send(); // Isolated proof, not implemented as recovery.
    expect(result.payload.communicationState).toBe("provider_accepted"); expect(restarted.provider.send).toHaveBeenCalledTimes(1);
  });
  it.each(["provider timeout", "acceptance persistence loss", "both persistence markers lost"])("%s holds unknown/provider-started across restart and blocks initial plus resend", async mode => {
    const h = harness(); if (mode === "provider timeout") h.setProviderMode("unknown"); else h.interruptAcceptance();
    if (mode === "both persistence markers lost") h.interruptUnknown();
    const result = await h.send({ recipientEmail: "held@example.test" });
    expect(result.code).toBe(409); expect(result.payload.success).toBeUndefined();
    expect(h.rows[0].provider_dispatch_state).toBe(mode === "both persistence markers lost" ? "provider_started" : "provider_unknown");
    const restarted = harness("owner", 9, true, h);
    expect((await restarted.send()).code).toBe(409);
    expect((await restarted.send({ resend: true, recipientEmail: "other@example.test" })).code).toBe(409);
    expect(h.rows).toHaveLength(1); expect(restarted.provider.send).not.toHaveBeenCalled(); expect(h.provider.send).toHaveBeenCalledTimes(1);
    expect((await canonical(restarted))[0].recipientEmail).toBe("held@example.test");
  });
  it("lost explicit resend unknown response holds its recipient; old initial acknowledgment is not its recovery", async () => {
    const h = harness(); await h.send(); h.setProviderMode("unknown");
    expect((await h.send({ resend: true, recipientEmail: "held-resend@example.test" })).code).toBe(409);
    const restarted = harness("owner", 9, true, h);
    expect((await restarted.send({ resend: true, recipientEmail: "other@example.test" })).code).toBe(409);
    expect(h.rows).toHaveLength(2); expect(h.rows[1].recipient_email).toBe("held-resend@example.test"); expect(restarted.provider.send).not.toHaveBeenCalled();
    const initial = await restarted.send({ resend: false });
    expect(initial.payload.communicationId).toBe(h.rows[0].id); expect(initial.payload.communicationId).not.toBe(h.rows[1].id);
  });
  it("memory-only guard loses uncertainty on restart; alternate capability remains blocked", () => {
    const guard = createCompanyJobInvoiceAttemptGuard(); const attempt = guard.begin(captured());
    guard.markDispatched(attempt); guard.finish(attempt, "uncertain");
    expect(() => guard.begin(captured(true))).toThrow("unknown");
    expect(() => createCompanyJobInvoiceAttemptGuard().begin(captured(true))).not.toThrow();
    expect(() => assertCompanyJobInvoiceRecipientCapability(captured(true, "alternate@example.test"))).toThrow("lost response");
  });
  it.each(["operationKey", "logicalSendKey", "communicationId", "intent", "recipientPhone"])("strict send schema rejects invented recovery field %s before SQL", async field => {
    const h = harness(); const result = await h.send({ [field]: "synthetic" });
    expect(result.code).toBe(400); expect(h.db.execute).not.toHaveBeenCalled(); expect(h.provider.send).not.toHaveBeenCalled();
  });
});

function registeredRoutes() {
  const file = backend + "mobileOperations.ts"; const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const registration = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "registerMobileOperationalRoutes");
  if (!registration) throw new Error("Missing authoritative route registration");
  const inject: Record<string, unknown> = { mobileOpenApi: {} };
  function visit(n: ts.Node) { if (ts.isCallExpression(n)) for (const arg of n.arguments) if (ts.isIdentifier(arg)) inject[arg.text] = deny; ts.forEachChild(n, visit); }
  visit(registration);
  const ctx = extract(file, ["BASE", "registerMobileOperationalRoutes"], inject);
  const routes: { method: string; path: string; handler: any }[] = [];
  const app = Object.fromEntries(["get", "post", "patch", "delete", "use"].map(method => [method, (path: string, handler: any) => routes.push({ method, path, handler })]));
  ctx.registerMobileOperationalRoutes(app); return routes;
}

describe("Actually registered mobile readback availability, not guessed endpoints", () => {
  it("only finance-list GET and send POST exist; no invoice/communication history/status/recovery route", () => {
    const routes = registeredRoutes();
    expect(routes.filter(r => /invoice|communication/.test(r.path)).map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "get", path: "/api/mobile/v1/invoices" }, { method: "post", path: "/api/mobile/v1/jobs/:jobId/invoice" },
    ]);
    expect(routes.some(r => r.path === "/api/mobile/v1/jobs/:jobId/native-payment/status")).toBe(true); // Different subsystem.
    expect(routes.some(r => r.path === "/api/mobile/v1/jobs/operations/:operationKey")).toBe(true); // Job creation only.
  });
  it("GET invoice finance list reads no communication rows and returns no send identity/state/recipient", async () => {
    const sql: string[] = [];
    const ctx = extract(backend + "paymentService.ts", ["listJobInvoices"], { toNumber: Number, paymentState: (total: number, paid: number) => ({ total, paid, balance: total-paid, status: "unpaid" }) });
    const result = await ctx.listJobInvoices({ execute: async (query: string) => {
      sql.push(query); return [[{ id: 12, customer_id: 41, customer_name: "Synthetic", amount: 100, paid_total: 25 }]];
    } }, { companyId: 9 });
    expect(sql).toHaveLength(1); expect(sql[0]).not.toContain("fs_company_communications");
    expect(Object.keys(result[0]).sort()).toEqual(["id", "customerId", "customerName", "title", "serviceName", "status", "paymentStatus", "scheduledStartAt", "total", "paid", "balance"].sort());
  });
  it("canonical Job invoiceSentAt is a legacy sent timestamp, not logical-send readback", () => {
    const file = backend + "jobService.ts"; const tree = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const fn = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "getJobDetail");
    expect(fn).toBeDefined(); const body = fn!.getText(tree);
    expect(body).toContain("SELECT sent_at FROM fs_company_email_deliveries"); expect(body).toContain("invoiceSentAt:");
    expect(body).not.toContain("purpose = 'job_invoice'"); expect(body).not.toContain("invoiceCommunicationId");
  });
  it("web tenant RPC cannot authenticate a mobile bearer token without the Company web session cookie", async () => {
    const ctx = extract(backend + "fieldServiceRouter.ts", ["getCompanySession"], { SESSION_COOKIE: "company-session", SUPPORT_SESSION_COOKIE: "support-session", parseCookies: deny, verifyCompanySessionToken: deny, getDb: deny });
    expect(await ctx.getCompanySession({ cookies: {}, headers: { authorization: "Bearer synthetic" } })).toBeNull();
  });
});

function recoveryFixture(state: string, dispatch: string, stale: boolean, role = "owner", companyId = 9) {
  const row = { id: 77, company_id: 9, state, provider_dispatch_state: dispatch, logical_send_key: "job-invoice", recipient_email: "held@example.test" };
  const audit: any[] = [];
  const db = { execute: vi.fn(async (raw: string, p: any[]) => {
    const sql = raw.replace(/\s+/g, " ").trim();
    if (sql.startsWith("SELECT")) return [p[0] === row.id && p[1] === row.company_id ? [{ ...row }] : []];
    if (sql.startsWith("UPDATE fs_company_communications")) {
      expect(sql).toContain("last_attempt_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)");
      const match = p[0] === row.id && p[1] === row.company_id && row.state === "sending" && row.provider_dispatch_state === "pre_provider" && stale;
      if (match) { row.state = "queued"; row.provider_dispatch_state = "queued"; } return [{ affectedRows: match ? 1 : 0 }];
    }
    if (sql.startsWith("INSERT INTO fs_audit_logs")) { audit.push(JSON.parse(p[5])); return [{ insertId: 1 }]; } return deny();
  }) };
  const comm = extract(backend + "companyCommunicationService.ts", ["toNumber", "asState", "asProviderDispatchState", "mapCommunicationRow", "findCommunicationById", "writeCommunicationAuditLog", "requeueStrandedPreProviderCompanyCommunication"], {
    DomainError, requireManager: companyFunctions.requireManager, CANONICAL_COMMUNICATION_STATES: stateNames, PROVIDER_DISPATCH_STATES: dispatchNames, createResendEmailAdapter: deny,
  });
  return { row, db, audit, requeue: () => comm.requeueStrandedPreProviderCompanyCommunication(db, companyFunctions.companyContextFromMobile({ accountId: 42, role }, companyId), 77) };
}

describe("Actual web-only manual recovery is narrowly pre-provider, never a send", () => {
  it("stale pre-provider requeues existing identity only, with no provider activity", async () => {
    const h = recoveryFixture("sending", "pre_provider", true); const result = await h.requeue();
    expect(result).toEqual({ success: true, communicationId: 77, state: "queued" });
    expect(h.row.logical_send_key).toBe("job-invoice"); expect(h.row.recipient_email).toBe("held@example.test");
    expect(h.audit[0]).toMatchObject({ communicationId: 77, priorDispatchState: "pre_provider" });
  });
  it.each([
    ["sending", "pre_provider", false], ["sending", "provider_started", true], ["sending", "provider_unknown", true],
    ["sending", "legacy_unknown", true], ["queued", "queued", true], ["provider_accepted", "provider_accepted", true],
  ] as const)("state=%s dispatch=%s stale=%s cannot requeue", async (state, dispatch, stale) => {
    const h = recoveryFixture(state, dispatch, stale); await expect(h.requeue()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.row.state).toBe(state); expect(h.row.provider_dispatch_state).toBe(dispatch); expect(h.audit).toHaveLength(0);
  });
  it("foreign Company and technician cannot recover a communication", async () => {
    const foreign = recoveryFixture("sending", "pre_provider", true, "owner", 99); await expect(foreign.requeue()).rejects.toMatchObject({ code: "NOT_FOUND" });
    const tech = recoveryFixture("sending", "pre_provider", true, "technician"); await expect(tech.requeue()).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(tech.db.execute).not.toHaveBeenCalled();
  });
});

describe("Candidate capability evidence does not enable alternate sends", () => {
  it("records verified positives separately from absent restart recovery", () => {
    expect(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY).toMatchObject({ backendRevision: "0fbd3b673eaadb0a1e646c2003b806d439c87088", wireOverrideSupported: true, stableInitialReservation: true, persistedRecipientAcknowledgment: true, durableCommunicationIdentity: true, providerUnknownHeldWithoutAutomaticResend: true, clientOperationKeySupported: false, explicitResendReplaySafe: false, authenticatedInvoiceReadbackAvailable: false, restartSafeUncertainOperationRecovery: false, alternateRecipientSendingEnabled: false });
    expect(Object.isFrozen(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY)).toBe(true);
    for (const resend of [false, true]) expect(() => assertCompanyJobInvoiceRecipientCapability(captured(resend, "alternate@example.test"))).toThrow("no authenticated mobile");
  });
  it.each(["email", "sms"] as const)("blank %s on-file initial and explicit resend stay permitted", method => {
    for (const resend of [false, true]) {
      const intent = captureCompanyJobInvoiceIntent({ token: "synthetic", portal: "company", company: { id: 9 }, user: { id: 42, role: "dispatcher" } }, { id: 12, companyId: 9 }, createCompanyJobInvoiceOptions(method, resend, " "));
      expect(() => assertCompanyJobInvoiceRecipientCapability(intent)).not.toThrow();
    }
  });
});
