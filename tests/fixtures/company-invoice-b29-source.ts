import { createHash } from "node:crypto";
// Final b29 actual declarations; SQL/provider are isolated in-memory only.
// Backend declarations run in a denied-I/O VM with an isolated SQL/adapter fixture only.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, vi } from "vitest";
import { z } from "zod";
const sourceHashes = new Map<string, string>();
const extractedDeclarations: any[] = [];
const allowedSql = new Set<string>([
  "SELECT id, customer_id FROM fs_jobs WHERE id = ? AND company_id = ? LIMIT 1",
  "SELECT id, customer_id, amount, status, title, public_token FROM fs_jobs WHERE id = ? AND company_id = ? LIMIT 1",
]);
const sameSqlKey = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();
export const backend =
  "/home/ubuntu/hsc-mobile-b29-final-compatibility-20261117/backend-source-b29f99b5/server/";
export const backendRevision = "b29f99b5ea9581a1c5a62271cc5bd979f83df345";
const deny = () => {
  throw new Error("DENIED unconfigured network/import/provider/SQL");
};
for (const [file, hash] of Object.entries({
  "paymentService.ts":
    "b33a7d66b1ecc1407010eed0cd8954b6c0e84552cb391e68ac428fbd1825ab08",
  "companyContext.ts":
    "27213c90b093982f066834aab7e8a7d0c51869d74fcc7499e98a88ae0e3d07b6",
  "domainErrors.ts":
    "de66f0169c7b79c9970031175dde25c008f68bc140fc6059f60c69e5d7e6e737",
  "emailAdapter.ts":
    "f623d7a8e1d6af355c9e800a65ab563609009d3f805d4cffb874739a8be1ef5a",
  "mobileAuth.ts":
    "3e68208a4b0a159a9289e8d6be2fd9c35f3e4aff85eea5a1c8c3373714178429",
  "companyCommunicationService.ts":
    "c00c228a48976431458ee3f55a1019a601b07573ca32ef523e8d6642bfce989d",
  "mobileOperations.ts":
    "8dc78c0388ab9e167d757a19bc668ce6ff2486e9e632d69ab3808742585930ae",
}))
  expect(
    createHash("sha256")
      .update(readFileSync(backend + file))
      .digest("hex"),
  ).toBe(hash);
for (const [file, hash] of Object.entries({
  "20260922_company_communications_outbox.sql":
    "008cc336d5f283790cb99a14048b5169513ad17ee9d98b17dced04194d14435b",
  "20260923_company_communications_provider_dispatch_state.sql":
    "a6c447237cc2614f87905f1bd0dc5d255409e54e07e61f963deab5d464c92bc1",
}))
  expect(
    createHash("sha256")
      .update(readFileSync(backend + "../migrations/" + file))
      .digest("hex"),
  ).toBe(hash);
// Extract actual declarations, not reimplementations or source-regex assertions.
// All imports, environment, network, SQL, token generation and provider creation
// are denied unless a named fake seam below is explicitly supplied.
export function extractB29(
  file: string,
  names: string[],
  inject: Record<string, any>,
) {
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
      ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
        names.includes(node.name?.getText(tree) ?? "")) ||
      (ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((declaration) =>
          names.includes(declaration.name.getText(tree)),
        )),
  );
  expect(nodes).toHaveLength(names.length);
  const collectSql = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.text.replace(/\s+/g, " ").trim();
      if (/^(SELECT|INSERT|UPDATE) /.test(text)) allowedSql.add(text);
    }
    ts.forEachChild(node, collectSql);
  };
  nodes.forEach(collectSql);
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
const errors = extractB29(
  backend + "domainErrors.ts",
  ["DomainError", "domainHttpStatus", "domainMobileCode"],
  {},
);
const DomainError = vm.runInContext("DomainError", errors);
const emailErrors = extractB29(
  backend + "emailAdapter.ts",
  ["EmailAdapterError"],
  {},
);
const EmailAdapterError = vm.runInContext("EmailAdapterError", emailErrors);
export class MobileAuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const companyFunctions = extractB29(
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

export function invoiceB29Harness(
  role = "owner",
  companyId = 9,
  payments = true,
  durable?: any,
) {
  const responses: any[] = [];
  const beforeInsert = { hook: null as null | (() => Promise<void>) };
  const job = durable?.job ?? {
    id: 12,
    company_id: 9,
    customer_id: 41,
    amount: 100,
    title: "Synthetic Invoice",
    public_token: "synthetic-existing",
  };
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
      const started = rows.filter(
        (row) =>
          row.state === "sending" &&
          row.provider_dispatch_state === "provider_started" &&
          _input.to[0] === row.recipient_email,
      );
      expect(started).toHaveLength(1);
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
    {
      accountId: 42,
      role: ["owner", "dispatcher", "technician"].includes(role)
        ? role
        : "technician",
    },
    companyId,
  );
  const db: any = {
    execute: vi.fn(async (raw: string, p: any[] = []) => {
      const sql = raw.replace(/\s+/g, " ").trim();
      if (!allowedSql.has(sql) || (sql.match(/\?/g)?.length ?? 0) !== p.length)
        throw new Error("DENIED unconfigured SQL shape/parameters: " + sql);
      if (
        sql.startsWith("SELECT") &&
        sql.includes("FROM fs_company_communications c INNER JOIN fs_jobs")
      ) {
        if (durable?.lookupUnavailable)
          throw new Error("Synthetic lookup unavailable");
        return [
          rows
            .filter(
              (r) =>
                r.company_id === p[0] &&
                r.entity_id === p[1] &&
                p[1] === job.id &&
                r.company_id === job.company_id &&
                r.purpose === "job_invoice" &&
                r.entity_type === "job" &&
                sameSqlKey(r.logical_send_key, p[2]),
            )
            .map((r) => ({ ...r })),
        ];
      }
      if (sql.startsWith("SELECT") && sql.includes("FROM fs_jobs"))
        return [p[0] === job.id && p[1] === job.company_id ? [{ ...job }] : []];
      if (sql.startsWith("SELECT") && sql.includes("FROM fs_customers"))
        return [
          p[0] === customer.id && p[1] === customer.company_id
            ? [{ ...customer }]
            : [],
        ];
      if (sql.startsWith("SELECT") && sql.includes("FROM companies"))
        return [p[0] === 9 ? [{ id: 9, name: "Synthetic Company" }] : []];
      if (
        sql.startsWith("SELECT") &&
        sql.includes("FROM fs_company_communications")
      ) {
        if (sql.includes("ORDER BY created_at DESC, id DESC")) {
          return [
            rows
              .filter((r) => r.company_id === p[0])
              .slice()
              .sort((a, b) => b.id - a.id)
              .map((r) => ({ ...r, channel: "email", provider: "resend" })),
          ];
        }
        let selected = rows.filter(
          (r) =>
            r.company_id === p[0] &&
            r.purpose === p[1] &&
            r.entity_type === p[2] &&
            r.entity_id === p[3],
        );
        if (sql.includes("logical_send_key = ?"))
          selected = selected.filter((r) =>
            sameSqlKey(r.logical_send_key, p[4]),
          );
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
        if (beforeInsert.hook) await beforeInsert.hook();
        const duplicate = rows.some(
          (r) =>
            r.company_id === p[0] &&
            r.purpose === p[1] &&
            r.entity_type === p[2] &&
            r.entity_id === p[3] &&
            (sameSqlKey(r.logical_send_key, p[12]) ||
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
          if (interruptUnknown)
            throw new Error(
              "Synthetic unknown marker persistence interruption",
            );
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
  if (!durable?.concurrent) db.getConnection = vi.fn(async () => connection);
  const comm = extractB29(
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
      "getCompanyInvoiceOperation",
      "findCommunication",
      "assertCommunicationReplayCompatible",
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
  const service = extractB29(
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
  const route = extractB29(
    backend + "mobileOperations.ts",
    [
      "mobileErrorStatus",
      "mobileTrpcError",
      "operationalError",
      "mobileCompany",
      "requireManager",
      "sendInvoice",
      "invoiceOperation",
    ],
    {
      z,
      DomainError,
      MobileAuthError,
      domainHttpStatus: errors.domainHttpStatus,
      domainMobileCode: errors.domainMobileCode,
      managerRoles: new Set(["owner", "dispatcher"]),
      // Explicit source-auth STUB: route manager checks execute, JWT not claimed.
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
      getCompanyInvoiceOperation: comm.getCompanyInvoiceOperation,
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
  async function lookup(operationKey: string, jobId = 12) {
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
    await route.invoiceOperation(
      { params: { jobId: String(jobId) }, query: { operationKey } },
      response,
    );
    return response;
  }
  return {
    rows,
    job,
    beforeInsert,
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
    lookup,
    route,
    setProviderMode: (mode: string) => {
      providerMode = mode;
    },
    interruptAcceptance: () => {
      interruptAcceptance = true;
    },
    interruptUnknown: () => {
      interruptUnknown = true;
    },
  };
}
