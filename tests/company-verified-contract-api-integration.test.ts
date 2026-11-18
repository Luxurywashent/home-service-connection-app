import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as shared from "../lib/jobsync-mobile-api";
import {
  companyJobRecurrenceCalendarDates,
  normalizeCompanyJobRecurrenceReceipt,
  verifyCompanyJobDurableRecurrenceReadback,
  type CompanyJobDurableRecurrenceReadback,
  type CompanyJobRecurrenceInput,
  type CompanyJobSavedSeries,
} from "../lib/company-job-recurrence";
import {
  createCompanyJobController,
  type CompanyCreateJobTransport,
} from "../lib/company-create-job";
import { createCompanyCreationStore } from "../lib/company-job-creation-storage";
import {
  companyCalendarSlot,
  companyCalendarWeekPosition,
} from "../lib/company-calendar";
import {
  COMPANY_VERIFIED_CONTRACT_RELEASE,
  companyInvoiceOperationReleaseReady,
  companyRecurrenceReleaseReady,
} from "../lib/company-verified-contract-release";
import {
  authority,
  fixture,
  response,
} from "./recurrence-fixtures/verified-source-fixture";
import { invoice164bHarness } from "./fixtures/company-invoice-164b-source";

const gate = vi.hoisted(() => ({ isolatedPositive: false }));
vi.mock("../lib/company-verified-contract-release", async (original) => {
  const actual =
    await original<typeof import("../lib/company-verified-contract-release")>();
  return {
    ...actual,
    assertCompanyVerifiedContractRelease: (kind: "recurrence" | "invoice") => {
      if (!gate.isolatedPositive)
        return actual.assertCompanyVerifiedContractRelease(kind);
      // Only this test's explicit positive seam, never a deployment/environment switch.
      if (
        process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL !==
        "https://fixture.invalid"
      )
        throw new Error("Isolated positive adapter requires fixture.invalid");
    },
  };
});
vi.mock("expo-crypto", () => ({
  randomUUID,
  digestStringAsync: async (_algorithm: string, text: string) =>
    createHash("sha256").update(text).digest("hex"),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
}));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

const root = "/home/ubuntu/home-service-connection-app";
const evidenceRoot = "/home/ubuntu/hsc-mobile-verified-contracts-20261117";
const token = "offline-verified-contract-bearer";
const wire = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;
type Row = Record<string, any>;
const recurrence: CompanyJobRecurrenceInput = {
  type: "weekly",
  term: "1_month",
  dayOfWeek: 2,
  startDate: "2026-11-30",
};
const base: shared.JobSyncCompanyJobCreateInput = {
  customerId: 41,
  priceBookServiceId: 71,
  scheduledStartAt: "2026-12-01T15:00:00.000Z",
  operationKey: "hsc-offline-shared-create-001",
  notifyCustomer: false,
};
const lines = [
  { priceBookItemId: 71, quantity: 2 },
  { priceBookItemId: 72, quantity: 1 },
];
const recurring = { ...base, lineItems: lines, recurrence };
const denied = () => {
  throw new Error("DENIED unconfigured real HTTP/provider/SQL");
};
beforeEach(() => {
  gate.isolatedPositive = false;
  vi.stubEnv("EXPO_PUBLIC_JOBSYNC_API_BASE_URL", "https://fixture.invalid");
  vi.stubGlobal("fetch", vi.fn(denied));
});
afterEach(() => {
  gate.isolatedPositive = false;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Direct global fetch -> exact archived route declarations -> JSON raw response.
 * No response augmentation, network fallback, real SQL or real provider exists. */
function recurrenceHttp(fake = fixture()) {
  const rawResponses: unknown[] = [];
  const http = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      expect(u.origin).toBe("https://fixture.invalid");
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
      const res = response();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (
        u.pathname === "/api/mobile/v1/company/jobs" &&
        init?.method === "POST"
      )
        await fake.routes.createJob({ body }, res);
      else if (
        u.pathname === "/api/mobile/v1/company/jobs/quote" &&
        init?.method === "POST"
      )
        await fake.routes.quoteJob({ body }, res);
      else if (
        /^\/api\/mobile\/v1\/company\/jobs\/\d+\/recurrence$/.test(
          u.pathname,
        ) &&
        init?.method === "GET"
      )
        await fake.routes.jobRecurrenceSeries(
          { params: { jobId: u.pathname.split("/").at(-2) } },
          res,
        );
      else if (
        u.pathname.startsWith("/api/mobile/v1/company/jobs/operations/") &&
        init?.method === "GET"
      )
        await fake.routes.jobCreationOperation(
          {
            params: {
              operationKey: decodeURIComponent(u.pathname.split("/").at(-1)!),
            },
          },
          res,
        );
      else denied();
      const raw = wire(res.body);
      rawResponses.push(raw);
      return new Response(JSON.stringify(raw), { status: res.statusCode });
    },
  );
  vi.stubGlobal("fetch", http);
  return { fake, http, rawResponses };
}
function invoiceHttp(h = invoice164bHarness()) {
  const rawResponses: Row[] = [];
  const http = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      expect(u.origin).toBe("https://fixture.invalid");
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
      let res;
      if (
        u.pathname === "/api/mobile/v1/jobs/12/invoice" &&
        init?.method === "POST"
      )
        res = await h.send(JSON.parse(String(init.body)));
      else if (
        u.pathname === "/api/mobile/v1/jobs/12/invoice-operation" &&
        init?.method === "GET"
      )
        res = await h.lookup(u.searchParams.get("operationKey")!);
      else denied();
      const raw = wire<Row>(res!.payload);
      rawResponses.push(raw);
      return new Response(JSON.stringify(raw), { status: res!.code });
    },
  );
  vi.stubGlobal("fetch", http);
  return { h, http, rawResponses };
}
function request(http: ReturnType<typeof recurrenceHttp>["http"], index = 0) {
  const [url, init] = http.mock.calls[index];
  return {
    url: String(url),
    init: init!,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  };
}
function ackHeaders(init: RequestInit, method: string) {
  expect(init).toMatchObject({
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
  });
  expect(init.signal).toBeInstanceOf(AbortSignal);
}

/** The supplied recurrence-focused SQL fake only returns {id} for this legacy
 * Price Book query and parses the multi-line INSERT. Supply its missing legacy
 * data seams, not a fabricated backend response or recurrence authority. */
function legacySqlFixture() {
  const fake = fixture();
  const execute = fake.db.execute as ReturnType<typeof vi.fn>;
  const original = execute.getMockImplementation()!;
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (
      sql.startsWith("SELECT id, name, base_price") &&
      sql.includes("FROM fs_price_book WHERE id")
    ) {
      expect(params).toEqual([71, 9]);
      return [
        [
          {
            id: 71,
            name: "First",
            base_price: 100,
            default_duration_minutes: 60,
          },
        ],
      ];
    }
    if (
      sql.startsWith("INSERT INTO fs_job_line_items") &&
      sql.endsWith("VALUES (?, ?, ?, ?, 1, ?, ?, 0)")
    ) {
      fake
        .state()
        .lineItems.push({
          id: 601,
          company_id: params[0],
          job_id: params[1],
          price_book_item_id: params[2],
          name: params[3],
          quantity: 1,
          unit_price: params[4],
          total_price: params[5],
          sort_order: 0,
        });
      return [[]];
    }
    return original(sql, params);
  });
  return fake;
}

describe("default release gate blocks contract-dependent adapters before any GET/POST", () => {
  it("both release capabilities are false and immutable; environment flags do not enable them", () => {
    vi.stubEnv("EXPO_PUBLIC_COMPANY_RECURRENCE_ENABLED", "true");
    vi.stubEnv("EXPO_PUBLIC_COMPANY_INVOICE_OPERATIONS_ENABLED", "true");
    expect(Object.isFrozen(COMPANY_VERIFIED_CONTRACT_RELEASE)).toBe(true);
    expect(companyRecurrenceReleaseReady()).toBe(false);
    expect(companyInvoiceOperationReleaseReady()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["valid", "invalid-identity"])(
    "recurrence GET %s blocks even before validation/I/O",
    async (kind) => {
      await expect(
        shared.getJobSyncCompanyJobRecurrence(
          kind === "valid" ? token : "",
          kind === "valid" ? 9 : 0,
          kind === "valid" ? 501 : 0,
        ),
      ).rejects.toThrow(/awaiting verified backend deployment/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each([recurrence, undefined, {}, { ...recurrence, term: "invented" }])(
    "explicit recurrence body %j never downgrades to single creation",
    async (value) => {
      const input = {
        ...base,
        recurrence: value,
      } as unknown as shared.JobSyncCompanyJobCreateInput;
      expect(() => shared.createJobSyncCompanyJobPayload(input)).toThrow(
        /awaiting verified backend deployment/,
      );
      await expect(
        shared.createJobSyncCompanyJob(token, 9, input),
      ).rejects.toThrow(/awaiting verified backend deployment/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each(["send-valid", "send-invalid", "lookup-valid", "lookup-invalid"])(
    "invoice %s blocks before every read/write",
    async (kind) => {
      const valid = kind.endsWith("valid") && !kind.endsWith("invalid");
      const action = kind.startsWith("send")
        ? shared.sendJobSyncCompanyInvoiceOperation(
            valid ? token : "",
            valid ? 12 : 0,
            {
              method: "email",
              resend: false,
              operationKey: valid ? "job-invoice" : "bad",
            },
          )
        : shared.getJobSyncCompanyInvoiceOperation(
            valid ? token : "",
            valid ? 12 : 0,
            valid ? "job-invoice" : "bad",
          );
      await expect(action).rejects.toThrow(
        /awaiting verified backend deployment/,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

describe("actual shared CREATE payload and raw receipt integration, no downgrade/retry", () => {
  it.each(["legacy-single", "multi-service", "new-customer"])(
    "preserves %s ordinary One appointment and notify false through exact backend",
    async (kind) => {
      const h = recurrenceHttp(
        kind === "multi-service" ? fixture() : legacySqlFixture(),
      );
      const input =
        kind === "legacy-single"
          ? { ...base }
          : kind === "multi-service"
            ? { ...base, lineItems: wire<typeof lines>(lines) }
            : {
                newCustomer: {
                  firstName: "Casey",
                  lastName: "Example",
                  email: "new@example.test",
                },
                priceBookServiceId: 71,
                scheduledStartAt: base.scheduledStartAt,
                operationKey: base.operationKey,
                notifyCustomer: false,
              };
      const result = await shared.createJobSyncCompanyJob(token, 9, input);
      const sent = request(h.http);
      expect(sent.url).toBe(
        "https://fixture.invalid/api/mobile/v1/company/jobs",
      );
      expect(sent.body).toEqual(input);
      expect(sent.body.notifyCustomer).toBe(false);
      expect(sent.body).not.toHaveProperty("recurrence");
      expect(sent.body).not.toHaveProperty("scheduledEndAt");
      ackHeaders(sent.init, "POST");
      expect(result).toMatchObject({
        id: 501,
        companyId: 9,
        operation: { key: base.operationKey, state: "saved", replayed: false },
      });
      expect(result).not.toHaveProperty("recurrence");
      expect(result).not.toHaveProperty("photos");
      expect(h.http).toHaveBeenCalledTimes(1);
      expect(h.fake.state().rules).toHaveLength(0);
      expect(h.fake.booking).not.toHaveBeenCalled();
      if (kind === "multi-service")
        expect(h.fake.state().lineItems).toHaveLength(2);
      if (kind === "new-customer") expect(result.customerId).toBe(42);
    },
  );
  it("explicit isolated positive recurrence copies exact wire keys and receives metadata only, not a verified series", async () => {
    gate.isolatedPositive = true;
    const h = recurrenceHttp();
    const input = wire<typeof recurring>(recurring);
    const payload = shared.createJobSyncCompanyJobPayload(input);
    input.recurrence.startDate = "2026-12-08";
    input.lineItems[0].quantity = 99;
    expect(payload.recurrence).toEqual(recurrence);
    expect(payload.lineItems).toEqual(lines);
    const result = await shared.createJobSyncCompanyJob(token, 9, recurring);
    expect(request(h.http).body).toEqual(recurring);
    expect(Object.keys(request(h.http).body).sort()).toEqual([
      "customerId",
      "lineItems",
      "notifyCustomer",
      "operationKey",
      "priceBookServiceId",
      "recurrence",
      "scheduledStartAt",
    ]);
    expect(result.recurrence).toEqual(
      (h.rawResponses[0] as Row).job.recurrence,
    );
    expect(result.recurrence?.count).toBe(5);
    expect(result.recurrence).not.toHaveProperty("operationKey");
    expect(result).not.toHaveProperty("savedSeries");
    expect(h.http).toHaveBeenCalledTimes(1);
    expect(h.fake.state().rules[0]).not.toHaveProperty("operation_key");
  });
  it.each(["no-operation-key", "manual-end", "unknown-recurrence-field"])(
    "isolated recurring %s is rejected before POST",
    async (kind) => {
      gate.isolatedPositive = true;
      const input: Row = wire(recurring);
      if (kind === "no-operation-key") delete input.operationKey;
      if (kind === "manual-end")
        input.scheduledEndAt = "2026-12-01T16:00:00.000Z";
      if (kind === "unknown-recurrence-field") input.recurrence.clientCount = 5;
      await expect(
        shared.createJobSyncCompanyJob(
          token,
          9,
          input as shared.JobSyncCompanyJobCreateInput,
        ),
      ).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    "missing-recurrence",
    "wrong-count",
    "wrong-anchor",
    "wrong-term",
    "wrong-customer",
    "wrong-operation",
    "unknown-envelope",
  ])(
    "raw CREATE %s cannot become verified success and never retries",
    async (kind) => {
      gate.isolatedPositive = true;
      const h = recurrenceHttp();
      const original = h.http.getMockImplementation()!;
      h.http.mockImplementationOnce(async (...args) => {
        const exact = await original(...args);
        const raw = (await exact.json()) as Row;
        if (kind === "missing-recurrence") delete raw.job.recurrence;
        if (kind === "wrong-count") raw.job.recurrence.count += 1;
        if (kind === "wrong-anchor")
          raw.job.recurrence.occurrenceJobIds[0] = 999;
        if (kind === "wrong-term") raw.job.recurrence.term = "1_year";
        if (kind === "wrong-customer") raw.job.customerId = 999;
        if (kind === "wrong-operation") raw.operation.key = "wrong-operation";
        if (kind === "unknown-envelope") raw.echo = "not-authority";
        return new Response(JSON.stringify(raw), { status: exact.status });
      });
      await expect(
        shared.createJobSyncCompanyJob(token, 9, recurring),
      ).rejects.toThrow();
      expect(h.http).toHaveBeenCalledTimes(1);
      expect(h.fake.state().jobs).toHaveLength(5);
    },
  );
});

describe("exact recurrence GET returns incomplete canonical facts without manufacturing authority", () => {
  it("normalizes the exact unwrapped raw response, retaining null provenance and the backend pricing defect", async () => {
    gate.isolatedPositive = true;
    const h = recurrenceHttp();
    await shared.createJobSyncCompanyJob(token, 9, recurring);
    const read = (await shared.getJobSyncCompanyJobRecurrence(
      token,
      9,
      501,
    )) as CompanyJobDurableRecurrenceReadback;
    expect(request(h.http, 1).url).toBe(
      "https://fixture.invalid/api/mobile/v1/company/jobs/501/recurrence",
    );
    ackHeaders(request(h.http, 1).init, "GET");
    expect(read).toEqual(h.rawResponses[1]);
    expect(read.recurrence).toMatchObject({
      operationKey: null,
      requestedTerm: null,
      creationTimezone: null,
      anchorJobId: 501,
    });
    expect(read.recurrence).not.toHaveProperty("startDate");
    expect(read.pricing.subtotal).toBe(0);
    expect(() =>
      verifyCompanyJobDurableRecurrenceReadback(read, {
        companyId: 9,
        customerId: 41,
        jobId: 501,
        operationKey: base.operationKey!,
        recurrence,
        timezone: "America/Chicago",
        scheduledStartAt: base.scheduledStartAt,
        pricing: { subtotalAmount: 250, discountAmount: 0, totalAmount: 260 },
      }),
    ).toThrow(/original request remains locked/);
    expect(Object.isFrozen(read)).toBe(true);
    expect(read.occurrences.every(Object.isFrozen)).toBe(true);
    expect(h.http).toHaveBeenCalledTimes(2);
  });
  it("gapped rows and wrong sibling customer remain visible as incomplete, never repaired", async () => {
    gate.isolatedPositive = true;
    const h = recurrenceHttp();
    await shared.createJobSyncCompanyJob(token, 9, recurring);
    h.fake.state().jobs.splice(1, 1);
    h.fake.state().jobs[1].customer_id = 42;
    const read = (await shared.getJobSyncCompanyJobRecurrence(
      token,
      9,
      501,
    )) as CompanyJobDurableRecurrenceReadback;
    expect(read).toEqual(h.rawResponses[1]);
    expect(read.verification).toMatchObject({
      complete: false,
      actualOccurrenceCount: 4,
      missingOccurrenceNumbers: [1],
    });
    expect(read.occurrences[1].customerId).toBe(42);
    expect(read.recurrence.operationKey).toBeNull();
  });
  it.each(["wrapped", "unknown-field", "invalid-row-time", "wrong-company"])(
    "raw recurrence %s is rejected with only one GET",
    async (kind) => {
      gate.isolatedPositive = true;
      const h = recurrenceHttp();
      await shared.createJobSyncCompanyJob(token, 9, recurring);
      const original = h.http.getMockImplementation()!;
      h.http.mockImplementationOnce(async (...args) => {
        const exact = await original(...args);
        const raw = (await exact.json()) as Row;
        if (kind === "wrapped")
          return new Response(JSON.stringify({ series: raw }));
        if (kind === "unknown-field")
          raw.recurrence.startDate = recurrence.startDate;
        if (kind === "invalid-row-time")
          raw.occurrences[0].scheduledStartAt = "2026-02-30T15:00:00Z";
        if (kind === "wrong-company") raw.companyId = 10;
        return new Response(JSON.stringify(raw));
      });
      await expect(
        shared.getJobSyncCompanyJobRecurrence(token, 9, 501),
      ).rejects.toThrow();
      expect(h.http).toHaveBeenCalledTimes(2);
    },
  );
  it.each(["token", "company", "job"])(
    "isolated recurrence invalid %s dispatches nothing",
    async (kind) => {
      gate.isolatedPositive = true;
      await expect(
        shared.getJobSyncCompanyJobRecurrence(
          kind === "token" ? "" : token,
          kind === "company" ? 0 : 9,
          kind === "job" ? 0 : 501,
        ),
      ).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

describe("new shared invoice operation transport against exact 164b raw POST/GET", () => {
  it.each([undefined, " Alternate@Example.test "])(
    "preserves initial recipient policy and exact email operation keys: %s",
    async (recipientEmail) => {
      gate.isolatedPositive = true;
      const f = invoiceHttp();
      const body = {
        method: "email" as const,
        resend: false,
        operationKey: "job-invoice",
        ...(recipientEmail ? { recipientEmail } : {}),
      };
      const result = await shared.sendJobSyncCompanyInvoiceOperation(
        token,
        12,
        body,
      );
      expect(result).toEqual(f.rawResponses[0]);
      const sent = request(f.http);
      expect(sent.url).toBe(
        "https://fixture.invalid/api/mobile/v1/jobs/12/invoice",
      );
      expect(sent.body).toEqual({
        method: "email",
        resend: false,
        operationKey: "job-invoice",
        ...(recipientEmail ? { recipientEmail: "alternate@example.test" } : {}),
      });
      ackHeaders(sent.init, "POST");
      const lookup = await shared.getJobSyncCompanyInvoiceOperation(
        token,
        12,
        "job-invoice",
      );
      expect(lookup).toEqual(f.rawResponses[1]);
      expect(lookup).toMatchObject({
        status: "provider_accepted",
        communicationId: 1,
        recipientEmail: recipientEmail
          ? "alternate@example.test"
          : "on-file@example.test",
      });
      expect(lookup).not.toHaveProperty("delivered");
      expect(request(f.http, 1).url).toBe(
        "https://fixture.invalid/api/mobile/v1/jobs/12/invoice-operation?operationKey=job-invoice",
      );
      ackHeaders(request(f.http, 1).init, "GET");
      expect(f.http).toHaveBeenCalledTimes(2);
      expect(f.h.provider.send).toHaveBeenCalledTimes(1); // Fake provider only.
    },
  );
  it("resend retains its captured explicit key and lookup percent-encodes the colon", async () => {
    gate.isolatedPositive = true;
    const f = invoiceHttp();
    await shared.sendJobSyncCompanyInvoiceOperation(token, 12, {
      method: "email",
      resend: false,
      operationKey: "job-invoice",
    });
    const operationKey = "hsc-invoice:captured-001";
    await shared.sendJobSyncCompanyInvoiceOperation(token, 12, {
      method: "email",
      resend: true,
      operationKey,
      recipientEmail: "second@example.test",
    });
    expect(request(f.http, 1).body).toEqual({
      method: "email",
      resend: true,
      operationKey,
      recipientEmail: "second@example.test",
    });
    await shared.getJobSyncCompanyInvoiceOperation(token, 12, operationKey);
    expect(request(f.http, 2).url).toBe(
      `https://fixture.invalid/api/mobile/v1/jobs/12/invoice-operation?operationKey=${encodeURIComponent(operationKey)}`,
    );
    expect(f.h.rows).toHaveLength(2);
    expect(f.h.rows[1].logical_send_key).toBe(operationKey);
  });
  it.each(["not_found", "temporarily_unavailable", "unknown"])(
    "raw %s lookup is honest non-effectful recovery, not permission to resend",
    async (kind) => {
      gate.isolatedPositive = true;
      const f = invoiceHttp(
        kind === "temporarily_unavailable"
          ? invoice164bHarness("owner", 9, true, { lookupUnavailable: true })
          : undefined,
      );
      if (kind === "unknown") {
        f.h.setProviderMode("unknown");
        const raw = await f.h.send({
          method: "email",
          resend: false,
          operationKey: "job-invoice",
        });
        expect(raw.code).toBe(409);
      }
      const result = await shared.getJobSyncCompanyInvoiceOperation(
        token,
        12,
        "job-invoice",
      );
      expect(result).toEqual(f.rawResponses[0]);
      expect(result).toMatchObject({ status: kind });
      expect(f.http).toHaveBeenCalledTimes(1);
      expect(request(f.http).init.method).toBe("GET");
      if (kind !== "unknown") expect(f.h.provider.send).not.toHaveBeenCalled();
    },
  );
  it.each([
    "missing-key",
    "wrong-key",
    "unknown-field",
    "invalid-recipient",
    "invalid-link",
    "invalid-id",
  ])(
    "raw invoice receipt %s is guarded before returning and never retries",
    async (kind) => {
      gate.isolatedPositive = true;
      const f = invoiceHttp();
      const original = f.http.getMockImplementation()!;
      f.http.mockImplementationOnce(async (...args) => {
        const exact = await original(...args);
        const raw = (await exact.json()) as Row;
        if (kind === "missing-key") delete raw.operationKey;
        if (kind === "wrong-key") raw.operationKey = "wrong-key";
        if (kind === "unknown-field") raw.delivered = true;
        if (kind === "invalid-recipient") raw.sentTo = "invalid";
        if (kind === "invalid-link")
          raw.publicUrl = "http://fixture.invalid/invoice";
        if (kind === "invalid-id") raw.communicationId = 0;
        return new Response(JSON.stringify(raw));
      });
      await expect(
        shared.sendJobSyncCompanyInvoiceOperation(token, 12, {
          method: "email",
          resend: false,
          operationKey: "job-invoice",
        }),
      ).rejects.toThrow();
      expect(f.http).toHaveBeenCalledTimes(1);
      expect(f.h.provider.send).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    "wrong-key",
    "unknown-field",
    "false-status",
    "absent-identity",
    "invalid-attempts",
  ])("raw invoice lookup %s is rejected without POST", async (kind) => {
    gate.isolatedPositive = true;
    const f = invoiceHttp();
    await f.h.send({ operationKey: "job-invoice" });
    const original = f.http.getMockImplementation()!;
    f.http.mockImplementationOnce(async (...args) => {
      const exact = await original(...args);
      const raw = (await exact.json()) as Row;
      if (kind === "wrong-key") raw.operationKey = "wrong-key";
      if (kind === "unknown-field") raw.echo = "untrusted";
      if (kind === "false-status") raw.status = "delivered";
      if (kind === "absent-identity") raw.communicationId = null;
      if (kind === "invalid-attempts") raw.attemptCount = -1;
      return new Response(JSON.stringify(raw));
    });
    await expect(
      shared.getJobSyncCompanyInvoiceOperation(token, 12, "job-invoice"),
    ).rejects.toThrow();
    expect(f.http).toHaveBeenCalledTimes(1);
    expect(request(f.http).init.method).toBe("GET");
    expect(f.h.provider.send).toHaveBeenCalledTimes(1);
  });
  it.each([
    "unknown-field",
    "sms",
    "invalid-email",
    "invalid-key",
    "invalid-token",
    "invalid-job",
  ])("isolated invoice input %s fails before any GET/POST", async (kind) => {
    gate.isolatedPositive = true;
    const body: Row = {
      method: "email",
      resend: false,
      operationKey: "job-invoice",
    };
    if (kind === "unknown-field") body.companyId = 10;
    if (kind === "sms") body.method = "sms";
    if (kind === "invalid-email") body.recipientEmail = "bad";
    if (kind === "invalid-key") body.operationKey = "key?injection";
    const bearer = kind === "invalid-token" ? "" : token;
    const jobId = kind === "invalid-job" ? 0 : 12;
    await expect(
      shared.sendJobSyncCompanyInvoiceOperation(
        bearer,
        jobId,
        body as import("../lib/company-job-invoice-operation").CompanyInvoiceOperationBody,
      ),
    ).rejects.toThrow();
    if (["invalid-key", "invalid-token", "invalid-job"].includes(kind))
      await expect(
        shared.getJobSyncCompanyInvoiceOperation(
          bearer,
          jobId,
          body.operationKey,
        ),
      ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

/** Execute actual screen function bodies, not source-regex assertions or copies. */
function screenCode(file: string) {
  const source = readFileSync(`${root}/${file}`, "utf8");
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const admin = file.includes("admin-schedule");
  const name = admin ? "syncCompanyJobs" : "syncServerJobs";
  const declarations = found.filter(
    (node) =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name,
  );
  expect(declarations).toHaveLength(1);
  const callbacks = found.filter(
    (node): node is ts.JsxAttribute =>
      ts.isJsxAttribute(node) &&
      node.name.getText(tree) === "onCreated" &&
      !!node.initializer &&
      node.initializer.getText(tree).includes(name),
  );
  expect(callbacks).toHaveLength(1);
  const expression = (callbacks[0].initializer as ts.JsxExpression).expression!;
  return `const ${declarations[0].getText(tree)}; globalThis.loader = ${name}; globalThis.created = (${expression.getText(tree)});`;
}
async function canonicalRows() {
  const fake = fixture({ timezone: "Australia/Lord_Howe" });
  const create = response();
  const input = { ...recurring, scheduledStartAt: "2026-11-30T22:00:00.000Z" };
  await fake.routes.createJob({ body: input }, create);
  expect(create.statusCode).toBe(201);
  const raw = wire<Row>(create.body);
  const receipt = normalizeCompanyJobRecurrenceReceipt(
    raw.job.recurrence,
    recurrence,
    501,
  );
  const rows = await Promise.all(
    receipt.occurrenceJobIds.map(async (id) => {
      const detail = shared.normalizeJobSyncCompanyJobDetail(
        {
          job: wire(await fake.service.getJobDetail(fake.db, authority(), id)),
        },
        id,
        9,
      );
      expect(detail).not.toBeNull();
      return detail!;
    }),
  );
  // CALLBACK PRECONDITION ONLY. The added identity/intent below is assumed input
  // to the callback, NOT backend proof, NOT output of a series verifier. There is
  // no actual backend-created verified series available in this archive.
  const assumedAlreadyVerifiedSeries: CompanyJobSavedSeries = {
    ...receipt,
    companyId: 9,
    customerId: 41,
    jobId: 501,
    operationKey: base.operationKey!,
    recurrence,
  };
  return { rows, assumedAlreadyVerifiedSeries };
}
function screenHarness(file: string, rows: shared.JobSyncCompanyJobDetail[]) {
  const state: Row = {
    jobs: [{ id: "baseline" }],
    error: null,
    timezone: null,
    weekOffset: 17,
    selectedDay: 6,
  };
  const set = (key: string) =>
    vi.fn((value: any) => {
      state[key] = typeof value === "function" ? value(state[key]) : value;
    });
  const settings = { id: 9, timezone: "Australia/Lord_Howe" };
  const list = vi.fn(async () => wire(rows));
  const current = vi.fn(() => true);
  const context = vm.createContext({
    jobSyncSession: { token, company: { id: 9 } },
    jobSyncLoading: false,
    authLoading: false,
    isJobSyncCompany: true,
    employee: null,
    selectedLocation: "crestview",
    selectedCity: "crestview",
    cityToSlug: (city: string) => city,
    captureScreenAction: () => current,
    captureLegacyAction: denied,
    companyScheduleSessionRef: { current: token },
    scheduleReadEpochRef: { current: 0 },
    legacyMediaSessionRef: { current: { focusGeneration: 0 } },
    calendarScopeRef: { current: { key: "fixture-scope", generation: 0 } },
    calendarScopeKey: "fixture-scope",
    companyCalendarReadEpochRef: { current: 0 },
    managementActionRef: { current: { mounted: true, focused: true } },
    canonicalCalendarScopeRef: { current: null },
    canonicalCalendarKey: "fixture-canonical",
    getJobSyncCompanyJobs: list,
    getJobSyncCompanySettings: vi.fn(async () => ({ ...settings })),
    companyCalendarSlot,
    companyCalendarWeekPosition,
    isCurrentCompanyAdd: current,
    setJobs: set("jobs"),
    setSelectedJob: vi.fn(),
    setIsSyncing: vi.fn(),
    setCompanyCalendarError: set("error"),
    setCompanyTimezone: set("timezone"),
    setWeekOffset: set("weekOffset"),
    setSelectedDay: set("selectedDay"),
    Date,
    Intl,
    Error,
    fetch: denied,
    require: denied,
    process: { env: Object.freeze({}) },
  });
  const js = ts.transpileModule(screenCode(file), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  vm.runInContext(js, context, { timeout: 2000 });
  return {
    state,
    settings,
    list,
    current,
    context,
    created: context.created as (
      detail: shared.JobSyncCompanyJobDetail,
      timezone: string,
      series?: CompanyJobSavedSeries,
    ) => Promise<boolean>,
  };
}
for (const file of [
  "app/(tabs)/admin-schedule.tsx",
  "app/(tabs)/schedule.tsx",
]) {
  describe(`${file}: actual callback/loader conditional all-occurrence validation, NOT series proof`, () => {
    it("every canonical row loads/maps correct Company days ONLY under the assumed already-verified-series callback precondition", async () => {
      const { rows, assumedAlreadyVerifiedSeries: series } =
        await canonicalRows();
      const h = screenHarness(file, rows);
      expect(await h.created(rows[0], series.timezone, series)).toBe(true);
      expect(h.state.jobs).toHaveLength(5);
      expect(h.list).toHaveBeenCalledWith(token);
      const dates = companyJobRecurrenceCalendarDates(series);
      expect(dates[0]).toBe("2026-12-01");
      expect(rows[0].scheduledStartAt!.slice(0, 10)).toBe("2026-11-30");
      for (const row of rows) {
        const slot = companyCalendarSlot(
          row.scheduledStartAt,
          row.scheduledEndAt,
          series.timezone,
        )!;
        const position = companyCalendarWeekPosition(
          slot.date,
          new Date(),
          series.timezone,
        );
        const mapped = h.state.jobs.find(
          (job: Row) => job.id === String(row.id),
        );
        expect(mapped).toMatchObject({
          customerId: "41",
          companyId: 9,
          startHour: slot.startHour,
          endHour: slot.endHour,
          ...position,
        });
        if (file.includes("admin-schedule"))
          expect(mapped.companyDate).toBe(slot.date);
        expect(dates).toContain(slot.date);
      }
      expect(h.state.weekOffset).toBe(h.state.jobs[0].weekOffset);
      expect(h.state.selectedDay).toBe(h.state.jobs[0].dayIndex);
      expect(fetch).not.toHaveBeenCalled();
    });
    it.each([
      "first-only",
      "sibling-start",
      "sibling-end",
      "sibling-customer",
      "anchor-version",
      "timezone",
      "foreign-series",
      "stale-after-list",
    ])(
      "%s rejects callback visibility without navigation/write",
      async (kind) => {
        const { rows, assumedAlreadyVerifiedSeries: original } =
          await canonicalRows();
        const series = wire<CompanyJobSavedSeries>(original);
        const h = screenHarness(file, rows);
        const candidates = wire<shared.JobSyncCompanyJobDetail[]>(rows);
        if (kind === "first-only") candidates.splice(1);
        if (kind === "sibling-start")
          candidates[1].scheduledStartAt = "2026-12-08T23:00:00.000Z";
        if (kind === "sibling-end")
          candidates[1].scheduledEndAt = "2026-12-09T02:00:00.000Z";
        if (kind === "sibling-customer") candidates[1].customerId = 42;
        if (kind === "anchor-version")
          candidates[0].updatedAt = "2026-11-17T12:01:00.000Z";
        if (kind === "timezone") h.settings.timezone = "America/Chicago";
        if (kind === "foreign-series") series.companyId = 10;
        h.list.mockImplementation(async () => {
          if (kind === "stale-after-list") h.current.mockReturnValue(false);
          return candidates;
        });
        expect(await h.created(rows[0], original.timezone, series)).toBe(false);
        expect(h.state.jobs).toEqual([{ id: "baseline" }]);
        expect(h.state.weekOffset).toBe(17);
        expect(h.state.selectedDay).toBe(6);
        expect(fetch).not.toHaveBeenCalled();
      },
    );
    it("ordinary two-argument callback still validates just its single accepted Job; omission is NOT series proof", async () => {
      const { rows, assumedAlreadyVerifiedSeries: series } =
        await canonicalRows();
      const h = screenHarness(file, [rows[0]]);
      expect(await h.created(rows[0], series.timezone)).toBe(true);
      expect(h.state.jobs).toHaveLength(1);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
}

describe("actual sheet callback forwarding and controller cannot certify archived recurring creation", () => {
  it("AST-extracted sheet function retains ordinary two arguments and forwards third series only if supplied/current", async () => {
    const file = `${root}/components/company-create-job-sheet.tsx`;
    const source = readFileSync(file, "utf8");
    const tree = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const callbacks: ts.PropertyAssignment[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(tree) === "onCreated"
      )
        callbacks.push(node);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    expect(callbacks).toHaveLength(1);
    const target = vi.fn(async () => true),
      current = vi.fn(() => true);
    const context = vm.createContext({
      current,
      live: { current: { props: { onCreated: target } } },
    });
    vm.runInContext(
      ts.transpileModule(
        `globalThis.callback = (${callbacks[0].initializer.getText(tree)});`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
      ).outputText,
      context,
    );
    const { rows, assumedAlreadyVerifiedSeries: series } =
      await canonicalRows();
    await context.callback(rows[0], series.timezone);
    expect(target.mock.calls[0]).toEqual([rows[0], series.timezone]);
    await context.callback(rows[0], series.timezone, series);
    expect(target.mock.calls[1]).toEqual([rows[0], series.timezone, series]);
    current.mockReturnValue(false);
    expect(context.callback(rows[0], series.timezone, series)).toBe(false);
    expect(target).toHaveBeenCalledTimes(2);
  });
  it("real controller plus shared raw CREATE/operation/recurrence adapters holds saved record, never publishes series/calls calendar/removes/resends", async () => {
    gate.isolatedPositive = true;
    const h = recurrenceHttp();
    const session: shared.JobSyncNativeSession = {
      token,
      portal: "company",
      user: { id: 818181, role: "owner", name: "Owner", email: null },
      company: {
        id: 9,
        name: "Fixture",
        slug: "fixture",
        logoUrl: null,
        primaryColor: null,
        accentColor: null,
      },
    };
    const data = new Map<string, string>();
    const store = createCompanyCreationStore({
      platform: "ios",
      secureStore: {
        getItemAsync: vi.fn(async (key: string) => data.get(key) ?? null),
        setItemAsync: vi.fn(async (key: string, text: string) => {
          data.set(key, text);
        }),
        deleteItemAsync: vi.fn(async (key: string) => {
          data.delete(key);
        }),
      },
    });
    const remove = vi.spyOn(store, "remove");
    const detail: CompanyCreateJobTransport["detail"] = async (
      _bearer,
      id,
      companyId,
    ) => {
      const normalized = shared.normalizeJobSyncCompanyJobDetail(
        {
          job: wire(
            await h.fake.service.getJobDetail(h.fake.db, authority(), id),
          ),
        },
        id,
        companyId,
      );
      if (!normalized)
        throw new Error("Exact archived detail failed normalization");
      return normalized;
    };
    const transport: CompanyCreateJobTransport = {
      recurrenceEnvironment: "isolated-fixture",
      session: vi.fn(async () => session),
      settings: vi.fn(async () => ({
        id: 9,
        name: "Fixture",
        timezone: "America/Chicago",
      })),
      priceBook: vi.fn(
        async () =>
          [
            { serviceId: "71", basePrice: 100, vehiclePrices: {} },
            { serviceId: "72", basePrice: 50, vehiclePrices: {} },
          ] as Awaited<ReturnType<CompanyCreateJobTransport["priceBook"]>>,
      ),
      customer: vi.fn(async () => ({ id: 41, companyId: 9 })),
      detail,
      jobs: vi.fn(denied),
      quote: shared.quoteJobSyncCompanyJob,
      create: shared.createJobSyncCompanyJob,
      operation: shared.getJobSyncCompanyJobCreationOperation,
      recurrenceReadback: shared.getJobSyncCompanyJobRecurrence,
    };
    const onCreated = vi.fn(async () => true);
    const controller = createCompanyJobController({
      session,
      transport,
      store,
      isCurrent: () => true,
      verifyAssignment: async () => true,
      onCreated,
      onState: vi.fn(),
      newOperationKey: () => "hsc-offline-controller-001",
    });
    expect(
      await controller.submit({
        customerId: 41,
        lineItems: wire<typeof lines>(lines),
        date: recurrence.startDate,
        startHour: 9,
        recurrence,
        notifyCustomer: false,
      }),
    ).toBe(false);
    expect(controller.getState()).toMatchObject({ phase: "saved", jobId: 501 });
    expect(controller.getState()).not.toHaveProperty("savedSeries");
    expect(controller.getState().detailError).toMatch(
      /original request remains locked/,
    );
    expect(await store.read(9, session.user.id)).toMatchObject({
      phase: "saved",
      jobId: 501,
      operationKey: "hsc-offline-controller-001",
      recurrenceRuleId: 301,
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(
      h.http.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/company/jobs") && init?.method === "POST",
      ),
    ).toHaveLength(1);
    const readStart = h.http.mock.calls.length;
    expect(await controller.reconcile()).toBe(false);
    expect(h.http.mock.calls.slice(readStart).length).toBeGreaterThan(0);
    expect(
      h.http.mock.calls
        .slice(readStart)
        .every(([, init]) => init?.method === "GET"),
    ).toBe(true);
    expect(onCreated).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(controller.getState()).not.toHaveProperty("savedSeries");
    controller.detach();
  });
});

describe("complete shared API named surface retention", () => {
  function names(source: string) {
    const tree = ts.createSourceFile(
      "api.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const exported = new Set<string>();
    for (const node of tree.statements) {
      if (
        ts.isExportDeclaration(node) &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
      )
        for (const item of node.exportClause.elements)
          exported.add(item.name.text);
      if (
        ts.canHaveModifiers(node) &&
        ts
          .getModifiers(node)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        if (
          "name" in node &&
          node.name &&
          ts.isIdentifier(node.name as ts.Node)
        )
          exported.add((node.name as ts.Identifier).text);
        if (ts.isVariableStatement(node))
          for (const declaration of node.declarationList.declarations)
            if (ts.isIdentifier(declaration.name))
              exported.add(declaration.name.text);
      }
    }
    return [...exported].sort();
  }
  it("all 144 baseline named exports survive alongside exactly three adapter additions", () => {
    const baseSha = readFileSync(`${evidenceRoot}/base-sha.txt`, "utf8").trim();
    const before = names(
      execFileSync("git", ["show", `${baseSha}:lib/jobsync-mobile-api.ts`], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    const after = names(
      readFileSync(`${root}/lib/jobsync-mobile-api.ts`, "utf8"),
    );
    expect(before).toHaveLength(144);
    expect(before.filter((name) => !after.includes(name))).toEqual([]);
    expect(after.filter((name) => !before.includes(name))).toEqual([
      "getJobSyncCompanyInvoiceOperation",
      "getJobSyncCompanyJobRecurrence",
      "sendJobSyncCompanyInvoiceOperation",
    ]);
    expect(after).toHaveLength(147);
  });
});
