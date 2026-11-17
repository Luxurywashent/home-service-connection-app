import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createJobSyncCompanyJob,
  createJobSyncCompanyJobPayload,
  getJobSyncCompanyJobCreationOperation,
  JobSyncApiError,
  type JobSyncCompanyJobCreateInput,
  type JobSyncCompanyJobCreationOperation,
} from "../lib/jobsync-mobile-api";

const TOKEN = "mock-company-bearer";
const COMPANY = 9;
const KEY = "mobile-job-operation-123";
const input: JobSyncCompanyJobCreateInput = {
  customerId: 41,
  priceBookServiceId: 71,
  assignedUserId: 81,
  scheduledStartAt: "2026-11-20T15:00:00.000Z",
  scheduledEndAt: "2026-11-20T17:00:00.000Z",
  addressLine1: " 100 Example Street ",
};
const keyed = { ...input, operationKey: KEY };
const job = {
  id: 91, customerId: 41, priceBookServiceId: 71, assignedUserId: 81,
  title: "Service visit", serviceName: "Service visit", status: "scheduled",
  scheduledStartAt: input.scheduledStartAt, scheduledEndAt: input.scheduledEndAt,
  updatedAt: input.scheduledStartAt, addressLine1: "100 Example Street", city: "Example",
  amount: 125, customerName: "Casey Example", assignedName: "Taylor Example",
};
const acknowledgment = { key: KEY, state: "saved", replayed: false };
const saved: JobSyncCompanyJobCreationOperation = {
  key: KEY, state: "saved", jobId: 91, rejectionCode: null, rejectionMessage: null,
  createdAt: "2026-11-15T20:00:00.000Z", updatedAt: "2026-11-15T20:00:01.000Z",
};
const INVALID_LOOKUP = { name: "JobSyncApiError", status: null, code: "INVALID_RESPONSE" };
const INVALID_CREATE = { name: "JobSyncApiError", status: null, code: "INVALID_CREATE_RESPONSE" };

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}
function mockResponse(payload: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(response(payload, status));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
function lookup(key = KEY) { return getJobSyncCompanyJobCreationOperation(TOKEN, COMPANY, key); }

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Company creation operation-key payload", () => {
  it("preserves explicit booking-confirmation OFF and the trimmed operation key in the strict allowlist", async () => {
    const fetch = mockResponse({ job, operation: acknowledgment }, 201);
    const result = await createJobSyncCompanyJob(TOKEN, COMPANY, {
      ...input, operationKey: `  ${KEY}  `, vehiclePriceKey: " standard ", serviceNotes: " note ", privateNotes: " private ",
      city: " Example ", region: " FL ", postalCode: " 32500 ",
      companyId: 77, userId: 88, amount: 1, notifyCustomer: false, recurrence: {},
      operation: { key: "fake-key" }, operation_key: "snake-key", jobId: 22,
    } as JobSyncCompanyJobCreateInput);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/mobile\/v1\/company\/jobs$/);
    expect(init).toMatchObject({ method: "POST", cache: "no-store", headers: {
      Authorization: `Bearer ${TOKEN}`, Accept: "application/json", "Content-Type": "application/json",
    } });
    expect(JSON.parse(init.body)).toEqual({
      ...input, addressLine1: "100 Example Street", operationKey: KEY, vehiclePriceKey: "standard",
      serviceNotes: "note", privateNotes: "private", city: "Example", region: "FL", postalCode: "32500",
      notifyCustomer: false,
    });
    expect(result).toMatchObject({ id: 91, companyId: COMPANY, priceBookServiceId: 71, operation: acknowledgment });
    expect(result).not.toHaveProperty("photos");
  });

  it("captures immutable explicit OFF through ambiguous POST and exact-key GET-only recovery", async () => {
    const original = { ...input, operationKey: KEY, notifyCustomer: false };
    const payload = createJobSyncCompanyJobPayload(original);
    expect(Object.isFrozen(payload)).toBe(true);
    expect(payload).toMatchObject({ operationKey: KEY, notifyCustomer: false });
    expect(() => { payload.notifyCustomer = true; }).toThrow(TypeError);
    const lost = new Error("Connection lost after Job save");
    const fetch = vi.fn().mockRejectedValueOnce(lost).mockResolvedValueOnce(response({ operation: saved }));
    vi.stubGlobal("fetch", fetch);
    const submission = createJobSyncCompanyJob(TOKEN, COMPANY, payload);
    original.notifyCustomer = true;
    await expect(submission).rejects.toBe(lost);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(payload);
    expect(JSON.parse(fetch.mock.calls[0][1].body).notifyCustomer).toBe(false);
    expect(await lookup()).toEqual(saved);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual(["POST", "GET"]);
    expect(fetch.mock.calls[1][0]).toMatch(new RegExp(`/operations/${KEY}$`));
    expect(fetch.mock.calls[1][1]).not.toHaveProperty("body");
    expect(payload.notifyCustomer).toBe(false);
    expect(original.notifyCustomer).toBe(true);
  });

  it("retains explicit ON while old omitted preferences remain absent", () => {
    expect(createJobSyncCompanyJobPayload({ ...keyed, notifyCustomer: true })).toHaveProperty("notifyCustomer", true);
    expect(createJobSyncCompanyJobPayload(keyed)).not.toHaveProperty("notifyCustomer");
    expect(createJobSyncCompanyJobPayload({ ...keyed, notifyCustomer: undefined })).not.toHaveProperty("notifyCustomer");
  });

  it.each([null, "false", "true", 0, 1, {}, []])("rejects nonboolean preference %j before POST without omission or downgrade", async notifyCustomer => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const invalid = { ...keyed, notifyCustomer } as unknown as JobSyncCompanyJobCreateInput;
    expect(() => createJobSyncCompanyJobPayload(invalid)).toThrow("Notify customer must be on or off.");
    await expect(createJobSyncCompanyJob(TOKEN, COMPANY, invalid)).rejects.toThrow("Notify customer must be on or off.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([8, 128])("accepts exact trimmed key boundary length %s", length => {
    expect(createJobSyncCompanyJobPayload({ ...input, operationKey: `  ${"k".repeat(length)}  ` }).operationKey).toBe("k".repeat(length));
  });

  it("omits missing/undefined keys, preserving explicit unassignment and optional fields", () => {
    const result = createJobSyncCompanyJobPayload({ ...input, operationKey: undefined, assignedUserId: null, vehiclePriceKey: null });
    expect(result).not.toHaveProperty("operationKey");
    expect(result).toMatchObject({ assignedUserId: null, vehiclePriceKey: null });
    expect(createJobSyncCompanyJobPayload(input)).not.toHaveProperty("operationKey");
  });

  it.each([null, true, 12345678, {}, [], "", "   ", "1234567", "k".repeat(129), "a\u0000bcdefgh", "a\nbcdefgh", "a\u007fbcdefgh", "abcdefg\ud800"])(
    "rejects unsafe/malformed supplied key %j before any request", async operationKey => {
      const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
      expect(() => createJobSyncCompanyJobPayload({ ...input, operationKey } as any)).toThrow(/operation key/);
      await expect(createJobSyncCompanyJob(TOKEN, COMPANY, { ...input, operationKey } as any)).rejects.toThrow(/operation key/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("does not mutate the caller's input while trimming the key and address", () => {
    const original = Object.freeze({ ...input, operationKey: `  ${KEY}  ` });
    expect(createJobSyncCompanyJobPayload(original)).toMatchObject({ operationKey: KEY, addressLine1: "100 Example Street" });
    expect(original.operationKey).toBe(`  ${KEY}  `);
    expect(original.addressLine1).toBe(input.addressLine1);
  });
});

describe("strict keyed Company create acknowledgment", () => {
  it.each([undefined, null])("keeps old no-key clients compatible with operation %j", async operation => {
    const fetch = mockResponse({ job, ...(operation === undefined ? {} : { operation }) }, 201);
    const result = await createJobSyncCompanyJob(TOKEN, COMPANY, input);
    expect(result).toMatchObject({ id: 91, companyId: COMPANY, priceBookServiceId: 71 });
    expect(result).not.toHaveProperty("operation");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("operationKey");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("preserves real null Price Book service ID on a saved replay, never filling from submitted input", async () => {
    const operation = { ...acknowledgment, replayed: true };
    const fetch = mockResponse({ job: { ...job, priceBookServiceId: null }, operation }, 200);
    const result = await createJobSyncCompanyJob(TOKEN, COMPANY, keyed);
    expect(result.priceBookServiceId).toBeNull();
    expect(result).toMatchObject({ id: 91, operation });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("accepts a replay with a truthful matching positive service ID without treating it as a recovery instruction", async () => {
    const operation = { ...acknowledgment, replayed: true };
    const fetch = mockResponse({ job, operation }, 200);
    expect(await createJobSyncCompanyJob(TOKEN, COMPANY, keyed)).toMatchObject({ priceBookServiceId: 71, operation });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    undefined, null, [], "saved", {},
    { ...acknowledgment, key: "other-operation-key" },
    { ...acknowledgment, key: ` ${KEY} ` },
    { ...acknowledgment, key: KEY.toUpperCase() },
    { ...acknowledgment, operationKey: KEY, key: undefined },
    { ...acknowledgment, state: "pending" },
    { ...acknowledgment, state: "rejected" },
    { ...acknowledgment, state: "unknown" },
    { ...acknowledgment, state: "Saved" },
    { ...acknowledgment, state: undefined },
    { ...acknowledgment, replayed: undefined },
    { ...acknowledgment, replayed: "false" },
    { ...acknowledgment, replayed: 0 },
    { ...acknowledgment, jobId: 91 },
  ])("rejects malformed/mismatched operation acknowledgment %j without retry or lookup", async operation => {
    const fetch = mockResponse({ job, operation }, 201);
    await expect(createJobSyncCompanyJob(TOKEN, COMPANY, keyed)).rejects.toMatchObject(INVALID_CREATE);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { id: 0 }, { id: -1 }, { id: 1.5 }, { id: Number.MAX_SAFE_INTEGER + 1 }, { id: "91" },
    { customerId: 42 }, { customerId: "41" }, { priceBookServiceId: 72 }, { priceBookServiceId: "71" },
    { priceBookServiceId: undefined }, { priceBookServiceId: null },
    { assignedUserId: 82 }, { assignedUserId: "81" }, { assignedUserId: 0 }, { assignedUserId: undefined },
    { companyId: 10 }, { company_id: 10 }, { companyId: null },
    { companyId: COMPANY, company_id: 10 }, { companyId: 10, company_id: COMPANY },
    { scheduledStartAt: "2026-11-21T15:00:00.000Z" },
    { scheduledEndAt: "2026-11-20T18:00:00.000Z" },
    { amount: "125" }, { amount: null }, { amount: -1 },
  ])("rejects malformed/mismatched keyed canonical Job %j", async patch => {
    const fetch = mockResponse({ job: { ...job, ...patch }, operation: acknowledgment }, 201);
    await expect(createJobSyncCompanyJob(TOKEN, COMPANY, keyed)).rejects.toMatchObject(INVALID_CREATE);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("checks explicit unassignment against the raw canonical response", async () => {
    const fetch = mockResponse({ job: { ...job, assignedUserId: null }, operation: acknowledgment }, 201);
    expect(await createJobSyncCompanyJob(TOKEN, COMPANY, { ...keyed, assignedUserId: null })).toMatchObject({ assignedUserId: null });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("requires null canonical assignment when the keyed request omits a technician", async () => {
    const { assignedUserId: _assigned, ...unassigned } = keyed;
    const fetch = mockResponse({ job: { ...job, assignedUserId: null }, operation: acknowledgment }, 201);
    expect(await createJobSyncCompanyJob(TOKEN, COMPANY, unassigned)).toMatchObject({ assignedUserId: null });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects a phantom technician in a keyed request that omitted assignment", async () => {
    const { assignedUserId: _assigned, ...unassigned } = keyed;
    const fetch = mockResponse({ job, operation: acknowledgment }, 201);
    await expect(createJobSyncCompanyJob(TOKEN, COMPANY, unassigned)).rejects.toMatchObject(INVALID_CREATE);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([null, [], { data: { job, operation: acknowledgment } }, { job }, { job, operation: acknowledgment, error: { code: "BAD_REQUEST" } }])(
    "rejects malformed/ambiguous keyed envelope %j", async payload => {
      const fetch = mockResponse(payload, 201);
      await expect(createJobSyncCompanyJob(TOKEN, COMPANY, keyed)).rejects.toMatchObject(INVALID_CREATE);
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([202, 206])("rejects unsupported HTTP acknowledgment %s", async status => {
    const fetch = mockResponse({ job, operation: acknowledgment }, status);
    await expect(createJobSyncCompanyJob(TOKEN, COMPANY, keyed)).rejects.toMatchObject({ code: "INVALID_RESPONSE", status });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("Company creation operation lookup", () => {
  it("GETs the encoded exact trimmed key once using bearer scope, no body, query, or Company override", async () => {
    const key = "mobile/a?b#c%& +雪";
    const fetch = mockResponse({ operation: { ...saved, key } });
    expect(await lookup(`  ${key}  `)).toEqual({ ...saved, key });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(new RegExp(`/api/mobile/v1/company/jobs/operations/${encodeURIComponent(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    expect(init).toMatchObject({ method: "GET", cache: "no-store", headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" } });
    expect(init).not.toHaveProperty("body");
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(new URL(url).search).toBe("");
  });

  it.each([8, 128])("supports lookup key boundary %s without altering bytes", async length => {
    const key = "k".repeat(length);
    const fetch = mockResponse({ operation: { key, state: "unknown", jobId: null } });
    expect(await lookup(` ${key} `)).toMatchObject({ key, state: "unknown", jobId: null });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("projects the exact minimal unknown envelope without a phantom saved ID or rejection", async () => {
    const fetch = mockResponse({ operation: { key: KEY, state: "unknown", jobId: null } });
    expect(await lookup()).toEqual({ key: KEY, state: "unknown", jobId: null, rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("accepts a known pending operation without manufacturing a saved/rejected outcome", async () => {
    mockResponse({ operation: { ...saved, state: "pending", jobId: null } });
    expect(await lookup()).toEqual({ ...saved, state: "pending", jobId: null });
  });

  it("preserves null timestamps from the backend", async () => {
    mockResponse({ operation: { ...saved, createdAt: null, updatedAt: null } });
    expect(await lookup()).toEqual({ ...saved, createdAt: null, updatedAt: null });
  });

  it.each(["BAD_REQUEST", "NOT_FOUND", "CONFLICT", "PRECONDITION_FAILED"])("accepts authoritative rejection with supported persisted reason %s", async rejectionCode => {
    const operation = { ...saved, state: "rejected", jobId: null, rejectionCode, rejectionMessage: "Original validation rejected this Job." };
    mockResponse({ operation });
    expect(await lookup()).toEqual(operation);
  });

  it.each(["saved", "pending", "rejected", "unknown"])("requires exact echoed key for state %s", async state => {
    const operation = { ...saved, state, jobId: state === "saved" ? 91 : null, key: "different-company-operation" };
    const fetch = mockResponse({ operation });
    await expect(lookup()).rejects.toMatchObject(INVALID_LOOKUP);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { key: undefined }, { key: ` ${KEY} ` }, { key: KEY.toUpperCase() }, { key: 12345678 },
    { state: undefined }, { state: "Saved" }, { state: "succeeded" }, { state: "failed" }, { state: "processing" },
    { state: 1 }, { state: { saved: true } },
    { jobId: null }, { jobId: undefined }, { jobId: 0 }, { jobId: -1 }, { jobId: 1.5 }, { jobId: "91" },
    { jobId: Number.MAX_SAFE_INTEGER + 1 },
    { rejectionCode: "BAD_REQUEST" }, { rejectionMessage: "Rejected" },
    { createdAt: "invalid" }, { updatedAt: 1234 }, { createdAt: "2026-02-30T00:00:00Z" },
    { operationKey: KEY }, { status: "saved" }, { id: 91 }, { companyId: 10 }, { job: { id: 91 } }, { payloadFingerprint: "private" },
  ])("rejects malformed/unsupported operation fields %j instead of coercion", async patch => {
    const fetch = mockResponse({ operation: { ...saved, ...patch } });
    await expect(lookup()).rejects.toMatchObject(INVALID_LOOKUP);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["pending", "rejected", "unknown"])("rejects any phantom Job ID on %s", async state => {
    const fetch = mockResponse({ operation: { ...saved, state, jobId: 91, rejectionCode: state === "rejected" ? "BAD_REQUEST" : null, rejectionMessage: state === "rejected" ? "Rejected" : null } });
    await expect(lookup()).rejects.toMatchObject(INVALID_LOOKUP);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([undefined, 0, "", "0"])("requires literal null for non-saved Job ID %j", async jobId => {
    const fetch = mockResponse({ operation: { ...saved, state: "pending", jobId } });
    await expect(lookup()).rejects.toMatchObject(INVALID_LOOKUP);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { rejectionCode: null }, { rejectionCode: undefined }, { rejectionCode: "UNAUTHORIZED" }, { rejectionCode: "FORBIDDEN" },
    { rejectionCode: "OTHER" }, { rejectionCode: 400 }, { rejectionCode: "bad_request" },
    { rejectionMessage: undefined }, { rejectionMessage: null }, { rejectionMessage: "" }, { rejectionMessage: "   " }, { rejectionMessage: 123 },
  ])("rejects malformed/unauthenticated rejection reason %j", async patch => {
    const fetch = mockResponse({ operation: { ...saved, state: "rejected", jobId: null, rejectionCode: "BAD_REQUEST", rejectionMessage: "Rejected", ...patch } });
    await expect(lookup()).rejects.toMatchObject(INVALID_LOOKUP);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    null, [], {}, { operation: null }, { operation: [] }, { operation: "saved" },
    { data: { operation: saved } }, { job: { id: 91 } },
    { operation: saved, error: { code: "BAD_REQUEST" } }, { operation: saved, companyId: 10 },
  ])("rejects unsupported lookup envelopes %j", async payload => {
    const fetch = mockResponse(payload);
    await expect(lookup()).rejects.toMatchObject(INVALID_LOOKUP);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([201, 202, 206])("requires exact lookup HTTP200, not %s", async status => {
    const fetch = mockResponse({ operation: saved }, status);
    await expect(lookup()).rejects.toMatchObject({ name: "JobSyncApiError", status, code: "INVALID_RESPONSE" });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("Company creation recovery local scope and no-retry errors", () => {
  it.each(["", "   ", "token with spaces", "token\n", "token\u007f", null, undefined, 123])("rejects invalid bearer %j before POST or lookup", async token => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(createJobSyncCompanyJob(token as any, COMPANY, keyed)).rejects.toThrow(/current Company session/);
    await expect(getJobSyncCompanyJobCreationOperation(token as any, COMPANY, KEY)).rejects.toThrow(/current Company session/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, null, undefined, "9"])("rejects invalid Company scope %j before POST or lookup", async companyId => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(createJobSyncCompanyJob(TOKEN, companyId as any, keyed)).rejects.toThrow(/current Company session/);
    await expect(getJobSyncCompanyJobCreationOperation(TOKEN, companyId as any, KEY)).rejects.toThrow(/current Company session/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([null, true, 12345678, {}, [], "", "1234567", "k".repeat(129), "a\u0000bcdefgh", "abcdefg\ud800"])("rejects invalid lookup key %j without requesting another operation", async key => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(lookup(key as any)).rejects.toThrow(/operation key/);
    expect(fetch).not.toHaveBeenCalled();
  });

  const errors = [
    [400, "BAD_REQUEST", "A response handler failed after Job save."],
    [401, "UNAUTHORIZED", "A current Company session is required."],
    [403, "FORBIDDEN", "Only Company owners or dispatchers can perform this action."],
    [404, "NOT_FOUND", "Not found."],
    [409, "CONFLICT", "This Job creation operation key was already used with a different payload."],
    // Exact-source mapping: PRECONDITION_FAILED becomes HTTP409 mobile CONFLICT.
    [409, "CONFLICT", "The original Job creation request is still pending. Do not retry it with a new operation key."],
    [412, "PRECONDITION_FAILED", "Alternate deployment pending response."],
    [429, "RATE_LIMITED", "Too many requests."],
    [500, "INTERNAL_SERVER_ERROR", "Operation unavailable."],
    [503, "UNAVAILABLE", "Operation unavailable."],
  ] as const;

  it.each(errors)("preserves POST error %s %s without classifying rejection, retrying or automatic GET", async (status, code, message) => {
    const fetch = mockResponse({ error: { code, message } }, status);
    await expect(createJobSyncCompanyJob(TOKEN, COMPANY, keyed)).rejects.toMatchObject({ name: "JobSyncApiError", status, code, message });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].method).toBe("POST");
  });

  it.each(errors)("preserves lookup error %s %s without synthesizing rejected/unknown", async (status, code, message) => {
    const fetch = mockResponse({ error: { code, message } }, status);
    await expect(lookup()).rejects.toMatchObject({ name: "JobSyncApiError", status, code, message });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].method).toBe("GET");
  });

  it.each(["POST", "GET"])("preserves %s network ambiguity with exactly one request", async method => {
    const error = new Error("Connection lost after transmission");
    const fetch = vi.fn().mockRejectedValue(error); vi.stubGlobal("fetch", fetch);
    await expect(method === "POST" ? createJobSyncCompanyJob(TOKEN, COMPANY, keyed) : lookup()).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["POST", "GET"])("rejects malformed successful %s JSON defensively without retry", async method => {
    const fetch = vi.fn().mockResolvedValue(new Response("not-json", { status: method === "POST" ? 201 : 200 })); vi.stubGlobal("fetch", fetch);
    await expect(method === "POST" ? createJobSyncCompanyJob(TOKEN, COMPANY, keyed) : lookup()).rejects.toMatchObject(method === "POST" ? INVALID_CREATE : INVALID_LOOKUP);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("preserves malformed HTTP-error status without converting lookup failure to unknown", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("not-json", { status: 502 })); vi.stubGlobal("fetch", fetch);
    await expect(lookup()).rejects.toMatchObject({ name: "JobSyncApiError", status: 502, code: null });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["POST", "GET"])("normalizes %s AbortError to TIMEOUT without retry", async method => {
    const error = new Error("Aborted"); error.name = "AbortError";
    const fetch = vi.fn().mockRejectedValue(error); vi.stubGlobal("fetch", fetch);
    await expect(method === "POST" ? createJobSyncCompanyJob(TOKEN, COMPANY, keyed) : lookup()).rejects.toMatchObject({ name: "JobSyncApiError", status: null, code: "TIMEOUT" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("aborts a timed-out lookup and clears the timer without follow-up traffic", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => { const error = new Error("Aborted"); error.name = "AbortError"; reject(error); });
    })); vi.stubGlobal("fetch", fetch);
    const assertion = expect(lookup()).rejects.toMatchObject({ name: "JobSyncApiError", status: null, code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("malformed lookup errors retain the standard error class", async () => {
    mockResponse({ operation: { ...saved, state: "completed" } });
    await expect(lookup()).rejects.toBeInstanceOf(JobSyncApiError);
  });
});
