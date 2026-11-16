import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

// Deliberately outside application source: no server import, database, native storage,
// notification, wallet, crypto-key generation, or real HTTP transport is permitted.
const requireFixture = createRequire(import.meta.url);
const fixture = requireFixture("/home/ubuntu/hsc-consolidated-repair-20261116/fixtures/company-create-source-harness.cjs");
const oldBackend = fixture.backend(fixture.OLD_DIR);
const c0Backend = fixture.backend(fixture.BASELINE_DIR);
const finalDir = process.env.HSC_REPAIR_BACKEND_DIR;
const finalBackend = finalDir ? fixture.backend(finalDir) : null;
const KEY = "hsc-job-contract-fixture-original-0001";
const START = "2026-11-20T15:00:00.000Z";
const END = "2026-11-20T17:00:00.000Z";
const TOKEN = "offline-fixture-bearer-never-live";
const customer = { firstName: "Casey", lastName: "Example", email: "casey@example.test" };
const signed = () => ({ token: TOKEN, portal: "company", user: { id: 801, role: "owner", name: "Fixture owner", email: null },
  company: { id: 9, name: "Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } });
function input(mode = "existing", assigned: number | null = 81) {
  return { ...(mode === "new" ? { newCustomer: { ...customer } } : { customerId: 41 }), priceBookServiceId: 71,
    assignedUserId: assigned, scheduledStartAt: START, scheduledEndAt: END, operationKey: KEY, addressLine1: "100 Example Street" };
}
function rawDetail(assigned: number | null = 81) {
  // Controlled committed-detail fixture; not evidence of any production Job.
  return { id: "91", company_id: 9, customer_id: "41", assigned_user_id: assigned, title: "Service visit", service_name: "Service visit",
    status: "scheduled", scheduled_start_at: START, scheduled_end_at: END, updated_at: START, address_line1: "100 Example Street",
    city: "Example", amount: "125", paidTotal: 0, refundTotal: 0, appliedEstimateCredit: 0, balance: 125,
    payment_status: "unpaid", customer_name: "Casey Example", technicianName: assigned ? "Taylor Example" : null, photos: [] };
}
function created(replayed = false, key = KEY) { return { id: 91, priceBookServiceId: 71, operationKey: key, operationState: "saved", replayed }; }
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
function runtime(version: string, fetch: any) { return fixture.mobile(version, fetch, fixture.protectedStorageModule()); }
function singleResponse(value: unknown, status = 201) {
  const fetch = vi.fn(async (_url: string, _init: any) => response(value, status)); return { fetch, ...runtime("current", fetch) };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function spin() { for (let i = 0; i < 160; i++) await Promise.resolve(); }
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Global network fallback forbidden"); })));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function controllerHarness(version: string, options: any = {}) {
  const actor = signed(); const store = fixture.memoryStore(); const failures: string[] = []; const calls: any[] = [];
  let operationState = "saved"; let revoked = false; let active = true; let postBody: any;
  const detailRow = { ...rawDetail(), ...oldBackend.projector(rawDetail()), photos: [] };
  let detailFailure = false; let profileMismatch = false; let calendarFailure = false;
  const calendar = deferred<Response>();
  let holdCalendar = options.holdCalendar ?? false;
  let postWait: ReturnType<typeof deferred<Response>> | null = options.delayPost ? deferred<Response>() : null;
  const operationWait = options.delayOperation ? deferred<Response>() : null;
  const fetch = vi.fn(async (url: string, init: any) => {
    const path = new URL(url).pathname;
    const call = { method: init.method, path, ...(init.body ? { body: JSON.parse(init.body) } : {}) }; calls.push(call);
    if (new URL(url).origin !== "https://fixture.invalid" || init.headers.Authorization !== `Bearer ${TOKEN}` || init.cache !== "no-store") {
      failures.push(`Unexpected transport: ${url}`); throw new Error("Fixture origin/bearer/cache contract violated");
    }
    if (path === "/api/mobile/v1/auth/session" && init.method === "GET") return revoked
      ? response({ error: { code: "UNAUTHORIZED", message: "Fixture session expired" } }, 401) : response(actor);
    if (path === "/api/mobile/v1/company/settings" && init.method === "GET") return response({ company: { id: 9, name: "Fixture Company", timezone: "America/Chicago" } });
    if (path === "/api/mobile/v1/price-book" && init.method === "GET") return response({ services: [{ id: 71, name: "Service visit", basePrice: 125, vehiclePrices: {}, isActive: true }] });
    if (path === "/api/mobile/v1/customers/41" && init.method === "GET") return response({ customer: { id: 41, companyId: 9,
      ...customer, ...(profileMismatch ? { firstName: "Other" } : {}) } });
    if (path === "/api/mobile/v1/company/jobs" && init.method === "POST") {
      postBody = call.body;
      if (store.value(actor)?.operationKey !== postBody.operationKey) { failures.push("POST before durable reservation"); throw new Error("POST before reservation"); }
      if (postWait) return postWait.promise;
      if (options.postFailure === "timeout") return new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("Fixture transport aborted"), { name: "AbortError" })), { once: true });
      });
      if (options.postFailure === "lost") throw new Error("Controlled response loss after dispatch; outcome not asserted");
      const ack = (options.backend ?? oldBackend).response(rawDetail(), created(Boolean(options.replayed), postBody.operationKey));
      return response(ack.body, ack.status);
    }
    if (path === `/api/mobile/v1/company/jobs/operations/${KEY}` && init.method === "GET") {
      if (operationWait) return operationWait.promise;
      if (options.lookupFailure) return response({ error: { code: "UNAVAILABLE", message: "Fixture status unavailable" } }, 503);
      return response({ operation: { key: KEY, state: operationState, jobId: operationState === "saved" ? 91 : null,
        ...(operationState === "rejected" ? { rejectionCode: "BAD_REQUEST", rejectionMessage: "Controlled fixture rejection; original production outcome unknown." } : {}) } });
    }
    if (path === "/api/mobile/v1/jobs/91" && init.method === "GET") return detailFailure
      ? response({ error: { message: "Fixture detail unavailable" } }, 503) : response({ job: detailRow });
    if (path === "/api/mobile/v1/company/jobs" && init.method === "GET") {
      if (calendarFailure) return response({ error: { message: "Fixture calendar unavailable" } }, 503);
      return holdCalendar ? calendar.promise : response({ jobs: [detailRow], page: { nextCursor: null } });
    }
    failures.push(`Unconfigured request: ${init.method} ${path}`); throw new Error(failures.at(-1));
  });
  const rt = runtime(version, fetch);
  const onCreated = vi.fn(async (detail: any, timezone: string) => {
    expect(detail).toMatchObject({ id: 91, companyId: 9, customerId: 41, amount: 125, scheduledStartAt: START, scheduledEndAt: END });
    expect(timezone).toBe("America/Chicago");
    const jobs = await rt.api.getJobSyncCompanyJobs(TOKEN, { start: START, end: END });
    return jobs.some((job: any) => job.id === detail.id);
  });
  const onState = vi.fn(); const newOperationKey = vi.fn(() => KEY);
  const makeController = () => rt.controller.createCompanyJobController({ session: actor, isCurrent: () => active,
    store, newOperationKey, onState, onCreated, verifyAssignment: vi.fn(async () => true) });
  const controller = makeController();
  const draft = (mode = "new") => ({ ...(mode === "new" ? { newCustomer: { ...customer } } : { customerId: 41 }),
    serviceId: "71", assignedEmployeeId: "jobsync-81", date: "2026-11-20", startHour: 9, endHour: 11, addressLine1: "100 Example Street" });
  return { actor, store, rt, fetch, calls, failures, controller, makeController, draft, onState, onCreated, newOperationKey,
    post: () => calls.filter(call => call.method === "POST"), postBody: () => postBody,
    setOperation: (value: string) => { operationState = value; }, revoke: () => { revoked = true; }, stale: () => { active = false; },
    failDetail: () => { detailFailure = true; }, mismatchProfile: () => { profileMismatch = true; },
    finishOperation: () => operationWait!.resolve(response({ operation: { key: KEY, state: "saved", jobId: 91 } })),
    failCalendar: () => { calendarFailure = true; }, finishCalendar: () => { holdCalendar = false; calendar.resolve(response({ jobs: [detailRow], page: { nextCursor: null } })); },
    finishPost: () => { const ack = oldBackend.response(rawDetail(), created(false, postBody.operationKey)); postWait!.resolve(response(ack.body, ack.status)); },
  };
}

it("uses actual pure projector and actual backend response statements, not caller-added Company JSON", () => {
  expect(oldBackend.projector(rawDetail())).not.toHaveProperty("companyId");
  expect(oldBackend.projector(rawDetail())).not.toHaveProperty("company_id");
  expect(oldBackend.projector(rawDetail())).toMatchObject({ id: 91, customerId: 41, amount: 125, assignedUserId: 81 });
  expect(oldBackend.identity.responseStatement).toContain("...projectMobileCompanyJob(detail)");
  expect(c0Backend.identity.responseStatement).toContain("...detail");
  expect(oldBackend.hasSignedCompanyId).toBe(false);
});

describe("current multi-service preserved against actual c0 CREATE expression", () => {
  for (const mode of ["existing", "new"]) for (const replayed of [false, true]) {
    it(`${mode} ${replayed ? "replay200" : "saved201"} keeps existing service/discount fixture without client pricing`, async () => {
      const existing = fixture.existingMultiServiceFixture(); const canonical = existing.job(); const request = existing.input();
      if (mode === "new") { delete request.customerId; request.newCustomer = { firstName: "Casey", lastName: "Example" }; }
      const { companyId, ...row } = canonical;
      const ack = c0Backend.response({ ...row, company_id: companyId }, { ...created(replayed), operationKey: request.operationKey });
      const h = singleResponse(ack.body, ack.status);
      const result = await h.api.createJobSyncCompanyJob(TOKEN, 9, request);
      expect(result.pricing).toEqual({ lineItems: canonical.lineItems, subtotalAmount: canonical.subtotalAmount, discountAmount: canonical.discountAmount,
        taxAmount: canonical.taxAmount, taxRateBps: canonical.taxRateBps, discountKind: canonical.discountKind, discountCode: canonical.discountCode, totalAmount: canonical.amount });
      expect(result.operation).toEqual({ key: request.operationKey, state: "saved", replayed });
      expect(JSON.parse(h.fetch.mock.calls[0][1].body)).toEqual({ ...request,
        lineItems: [{ priceBookItemId: 71, quantity: 2, vehiclePriceKey: "standard" }, { priceBookItemId: 72, quantity: 1 }], discount: { kind: "percent", value: 10, code: "SAVE" } });
      expect(h.fetch).toHaveBeenCalledOnce();
    });
  }
});

for (const version of ["shipped", "current"]) {
  describe(`${version}: actual caacf CREATE before fix`, () => {
    for (const mode of ["existing", "new"]) for (const replayed of [false, true]) for (const assigned of [81, null]) {
      it(`${mode}, ${replayed ? "replay200" : "saved201"}, assigned=${assigned}: ${mode === "new" ? "reproduces rejection" : "accepts"}`, async () => {
        const ack = oldBackend.response(rawDetail(assigned), created(replayed));
        const fetch = vi.fn(async (_url: string, _init: any) => response(ack.body, ack.status)); const rt = runtime(version, fetch);
        const saving = rt.api.createJobSyncCompanyJob(TOKEN, 9, input(mode, assigned));
        if (mode === "new") await expect(saving).rejects.toMatchObject({ code: "INVALID_CREATE_RESPONSE" });
        else expect(await saving).toMatchObject({ id: 91, companyId: 9, customerId: 41, priceBookServiceId: 71,
          operation: { key: KEY, state: "saved", replayed } });
        expect(fetch).toHaveBeenCalledOnce(); expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input(mode, assigned));
      });
    }
    it("actual c0 detail-superset snake Company ID has version-dependent new-customer compatibility", async () => {
      const ack = c0Backend.response(rawDetail(), created());
      const fetch = vi.fn(async () => response(ack.body, ack.status)); const rt = runtime(version, fetch);
      expect(ack.body.job).toMatchObject({ company_id: 9 }); expect(ack.body.job).not.toHaveProperty("companyId");
      const saving = rt.api.createJobSyncCompanyJob(TOKEN, 9, input("new"));
      if (version === "shipped") await expect(saving).rejects.toMatchObject({ code: "INVALID_CREATE_RESPONSE" });
      else expect(await saving).toMatchObject({ id: 91, companyId: 9 });
      expect(fetch).toHaveBeenCalledOnce();
    });
    it("legacy unkeyed existing-customer request body remains unchanged and client-only overrides omitted", async () => {
      const { operationKey, ...legacy } = input(); const ack = oldBackend.response(rawDetail(), { id: 91, priceBookServiceId: 71 });
      const fetch = vi.fn(async (_url: string, _init: any) => response(ack.body, ack.status)); const rt = runtime(version, fetch);
      expect(await rt.api.createJobSyncCompanyJob(TOKEN, 9, { ...legacy, amount: 1, companyId: 99, notifyCustomer: false })).toMatchObject({ id: 91, amount: 125 });
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(legacy); expect(fetch).toHaveBeenCalledOnce();
    });
    it.each(["key", "state", "replayed", "missingOperation", "extraEnvelope", "customer", "service", "assignment", "start", "amount"])("corrupted keyed %s acknowledgment rejects with one dispatch", async field => {
      const ack = oldBackend.response(rawDetail(), created());
      if (field === "key") ack.body.operation.key = `${KEY}-other`;
      if (field === "state") ack.body.operation.state = "pending";
      if (field === "replayed") ack.body.operation.replayed = "false";
      if (field === "missingOperation") delete ack.body.operation;
      if (field === "extraEnvelope") ack.body.unexpected = true;
      if (field === "customer") ack.body.job.customerId = 42;
      if (field === "service") ack.body.job.priceBookServiceId = 72;
      if (field === "assignment") ack.body.job.assignedUserId = 82;
      if (field === "start") ack.body.job.scheduledStartAt = "2026-11-21T15:00:00.000Z";
      if (field === "amount") ack.body.job.amount = "125";
      const fetch = vi.fn(async () => response(ack.body, ack.status)); const rt = runtime(version, fetch);
      await expect(rt.api.createJobSyncCompanyJob(TOKEN, 9, input())).rejects.toMatchObject({ code: "INVALID_CREATE_RESPONSE" });
      expect(fetch).toHaveBeenCalledOnce();
    });
    it.each([10, null, 0, "wrong"])("wrong/null Company ack %j cannot relax request binding or resend", async companyId => {
      const ack = oldBackend.response(rawDetail(), created()); ack.body.job.companyId = companyId; // Negative wire corruption, NOT the final success fixture.
      const fetch = vi.fn(async () => response(ack.body, ack.status)); const rt = runtime(version, fetch);
      await expect(rt.api.createJobSyncCompanyJob(TOKEN, 9, input("new"))).rejects.toMatchObject({ code: "INVALID_CREATE_RESPONSE" });
      expect(fetch).toHaveBeenCalledOnce();
    });
  });

  describe(`${version}: real controller + real API GET-only recovery`, () => {
    it.each(["incomplete201", "timeout", "lost"])("%s -> saved operation/detail/profile -> awaited calendar, one creation POST", async failure => {
      if (failure === "timeout") vi.useFakeTimers();
      const h = controllerHarness(version, { postFailure: failure, holdCalendar: true });
      const saving = h.controller.submit(h.draft()); await spin();
      if (failure === "timeout") await vi.advanceTimersByTimeAsync(20_000);
      expect(await saving).toBe(false); expect(h.controller.getState()).toMatchObject({ phase: "uncertain", jobId: null });
      expect(h.controller.getState().message).toContain("Do not resend");
      if (failure === "timeout") expect(h.controller.getState().detailError).toContain("too long");
      const retained = h.store.value(h.actor); expect(retained).toMatchObject({ phase: "uncertain", operationKey: KEY, jobId: null });
      expect(h.post()).toHaveLength(1); expect(h.newOperationKey).toHaveBeenCalledOnce();
      // This is the same GET-only reconciliation the sheet invokes after ambiguity.
      const recovery = h.controller.reconcile(); await spin();
      expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 91, reconciling: true });
      expect(h.store.value(h.actor)).toMatchObject({ operationKey: KEY, phase: "saved", jobId: 91, resolvedCustomerId: 41 });
      expect(h.store.events.some((event: any) => event.kind === "remove")).toBe(false);
      expect(await h.controller.submit(h.draft())).toBe(false); expect(h.onCreated).toHaveBeenCalledOnce();
      expect(h.calls).toEqual(expect.arrayContaining([
        { method: "GET", path: `/api/mobile/v1/company/jobs/operations/${KEY}` },
        { method: "GET", path: "/api/mobile/v1/jobs/91" }, { method: "GET", path: "/api/mobile/v1/customers/41" },
        { method: "GET", path: "/api/mobile/v1/company/jobs" },
      ]));
      h.finishCalendar(); expect(await recovery).toBe(true);
      expect(h.controller.getState()).toMatchObject({ phase: "succeeded", jobId: 91 }); expect(h.store.value(h.actor)).toBeNull();
      expect(h.post()).toHaveLength(1); expect(h.failures).toEqual([]); h.controller.detach();
    });
    it.each(["pending", "unknown", "rejected", "lookup503"])("%s GET holds original intent, no automatic resubmit/removal/new key", async state => {
      const h = controllerHarness(version, { lookupFailure: state === "lookup503" }); await h.controller.submit(h.draft());
      const original = h.store.value(h.actor); h.setOperation(state === "lookup503" ? "unknown" : state);
      await h.controller.reconcile(); await h.controller.restore();
      // Rejected permits only a deliberate corrected future intent; do NOT invoke that action here.
      if (state !== "rejected") expect(await h.controller.submit(h.draft())).toBe(false);
      expect(h.controller.getState().phase).toBe(state === "pending" ? "pending" : state === "rejected" ? "rejected" : "uncertain");
      expect(h.store.value(h.actor)).toMatchObject({ operationKey: original.operationKey, payload: original.payload, jobId: null });
      expect(h.post()).toHaveLength(1); expect(h.newOperationKey).toHaveBeenCalledOnce(); expect(h.onCreated).not.toHaveBeenCalled();
      expect(h.store.events.some((event: any) => event.kind === "remove")).toBe(false); expect(h.failures).toEqual([]); h.controller.detach();
    });
    it("duplicate taps and close/reopen preserve the original key and immutable payload", async () => {
      const h = controllerHarness(version); await Promise.all([h.controller.submit(h.draft()), h.controller.submit(h.draft())]);
      const original = h.store.value(h.actor); h.controller.detach(); h.setOperation("unknown");
      const reopened = h.makeController(); await reopened.restore(); await reopened.submit({ ...h.draft(), privateNotes: "Changed after reopening" });
      expect(h.store.value(h.actor)).toMatchObject({ operationKey: KEY, payload: original.payload }); expect(h.post()).toHaveLength(1);
      expect(h.newOperationKey).toHaveBeenCalledOnce(); expect(h.failures).toEqual([]); reopened.detach();
    });
    it.each(["detail", "profile", "calendar"])("saved GET with %s failure retains canonical saved ID and no second POST", async failure => {
      const h = controllerHarness(version); await h.controller.submit(h.draft());
      if (failure === "detail") h.failDetail(); if (failure === "profile") h.mismatchProfile(); if (failure === "calendar") h.failCalendar();
      expect(await h.controller.reconcile()).toBe(false); expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 91 });
      expect(h.store.value(h.actor)).toMatchObject({ phase: "saved", jobId: 91, operationKey: KEY });
      await h.controller.submit(h.draft()); expect(h.post()).toHaveLength(1);
      expect(h.store.events.some((event: any) => event.kind === "remove")).toBe(false); expect(h.failures).toEqual([]); h.controller.detach();
    });
    it("revoked scope suppresses recovery callbacks and preserves origin attempt", async () => {
      const h = controllerHarness(version); await h.controller.submit(h.draft()); const original = h.store.value(h.actor); h.revoke();
      expect(await h.controller.reconcile()).toBe(false); expect(await h.controller.submit(h.draft())).toBe(false);
      expect(h.onCreated).not.toHaveBeenCalled(); expect(h.store.value(h.actor)).toEqual(original); expect(h.post()).toHaveLength(1);
      expect(h.calls.some(call => call.path.includes("/operations/"))).toBe(false); expect(h.failures).toEqual([]); h.controller.detach();
    });
    it("session expiry during delayed saved-operation GET settles origin without callbacks or saved metadata publication", async () => {
      const h = controllerHarness(version, { delayOperation: true }); await h.controller.submit(h.draft());
      const recovery = h.controller.reconcile(); await spin(); expect(h.calls.some(call => call.path.includes("/operations/"))).toBe(true);
      const published = h.onState.mock.calls.length; h.revoke(); h.finishOperation(); expect(await recovery).toBe(false);
      expect(h.store.value(h.actor)).toMatchObject({ phase: "saved", operationKey: KEY, jobId: 91 });
      expect(h.onState.mock.calls.slice(published).some(([state]) => state.jobId === 91)).toBe(false);
      expect(h.onCreated).not.toHaveBeenCalled(); expect(h.post()).toHaveLength(1);
      expect(h.calls.some(call => call.path === "/api/mobile/v1/jobs/91")).toBe(false);
      expect(h.store.events.some((event: any) => event.kind === "remove")).toBe(false); expect(h.failures).toEqual([]); h.controller.detach();
    });
    it("expired view during delayed POST ignores callbacks, settles only original durable scope", async () => {
      const h = controllerHarness(version, { delayPost: true }); const saving = h.controller.submit(h.draft("existing")); await spin();
      expect(h.post()).toHaveLength(1); h.stale(); h.controller.detach(); const published = h.onState.mock.calls.length;
      h.finishPost(); expect(await saving).toBe(false);
      expect(h.store.value(h.actor)).toMatchObject({ phase: "saved", operationKey: KEY, jobId: 91 });
      expect(h.onState.mock.calls).toHaveLength(published); expect(h.onCreated).not.toHaveBeenCalled(); expect(h.post()).toHaveLength(1);
      expect(h.store.events.some((event: any) => event.kind === "remove")).toBe(false); expect(h.failures).toEqual([]);
    });
  });
}

// Explicit env is the final-patch gate; absent env is visibly pending, not a fabricated success.
describe.skipIf(!finalBackend)("FINAL actual patched backend CREATE cross-version compatibility (HSC_REPAIR_BACKEND_DIR)", () => {
  it("adds exact numeric signed-context companyId AFTER projector, preserving keyed operation envelope", () => {
    finalBackend.assertSignedCompanyId();
    const ack = finalBackend.response(rawDetail(), created(), { companyId: 9 });
    expect(ack.body.job.companyId).toBe(9); expect(typeof ack.body.job.companyId).toBe("number");
    expect(Object.keys(ack.body).sort()).toEqual(["job", "operation"]);
    expect(ack.body.operation).toEqual({ key: KEY, state: "saved", replayed: false });
  });
  for (const version of ["shipped", "current"]) for (const mode of ["existing", "new"]) for (const replayed of [false, true]) {
    it(`${version} ${mode} ${replayed ? "replay" : "saved"} accepts actual final CREATE expression`, async () => {
      finalBackend.assertSignedCompanyId();
      const ack = finalBackend.response(rawDetail(), created(replayed), { companyId: 9 });
      const fetch = vi.fn(async (_url: string, _init: any) => response(ack.body, ack.status)); const rt = runtime(version, fetch);
      expect(await rt.api.createJobSyncCompanyJob(TOKEN, 9, input(mode))).toMatchObject({ id: 91, companyId: 9, customerId: 41,
        operation: { key: KEY, state: "saved", replayed } });
      expect(fetch).toHaveBeenCalledOnce(); expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input(mode));
    });
  }
  for (const version of ["shipped", "current"]) it(`${version} rejects another Company's actual signed-context acknowledgment`, async () => {
    const ack = finalBackend.response(rawDetail(), created(), { companyId: 10 });
    expect(ack.body.job.companyId).toBe(10);
    const fetch = vi.fn(async () => response(ack.body, ack.status)); const rt = runtime(version, fetch);
    await expect(rt.api.createJobSyncCompanyJob(TOKEN, 9, input("new"))).rejects.toMatchObject({ code: "INVALID_CREATE_RESPONSE" }); expect(fetch).toHaveBeenCalledOnce();
  });
  for (const version of ["shipped", "current"]) for (const mode of ["existing", "new"]) {
    it(`${version} ${mode} actual final ack -> canonical detail/profile/awaited real API calendar, one POST`, async () => {
      finalBackend.assertSignedCompanyId();
      const h = controllerHarness(version, { backend: finalBackend, holdCalendar: true });
      const saving = h.controller.submit(h.draft(mode)); await spin();
      // Direct CREATE acknowledgment is saved-but-busy; reconciling is a recovery-GET flag.
      expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 91 });
      expect(h.controller.isBusy()).toBe(true);
      expect(h.store.value(h.actor)).toMatchObject({ operationKey: KEY, phase: "saved", jobId: 91 });
      expect(h.store.events.some((event: any) => event.kind === "remove")).toBe(false);
      expect(await h.controller.submit(h.draft(mode))).toBe(false); h.finishCalendar(); expect(await saving).toBe(true);
      expect(h.controller.getState()).toMatchObject({ phase: "succeeded", jobId: 91 }); expect(h.store.value(h.actor)).toBeNull();
      expect(h.post()).toHaveLength(1); expect(h.failures).toEqual([]); h.controller.detach();
    });
    it(`${version} ${mode} actual final ack + failed canonical detail stays saved, never uncertain or resubmitted`, async () => {
      finalBackend.assertSignedCompanyId(); const h = controllerHarness(version, { backend: finalBackend }); h.failDetail();
      expect(await h.controller.submit(h.draft(mode))).toBe(false); expect(h.controller.getState()).toMatchObject({ phase: "saved", jobId: 91 });
      expect(h.store.value(h.actor)).toMatchObject({ operationKey: KEY, phase: "saved", jobId: 91 });
      await h.controller.submit(h.draft(mode)); expect(h.post()).toHaveLength(1); expect(h.onCreated).not.toHaveBeenCalled();
      expect(h.store.events.some((event: any) => event.kind === "remove")).toBe(false); expect(h.failures).toEqual([]); h.controller.detach();
    });
  }
  it("current multi-service intent retains exact existing fixture services/discount/pricing through actual final CREATE", async () => {
    finalBackend.assertSignedCompanyId();
    const existing = fixture.existingMultiServiceFixture(); const request = existing.input(); const canonical = existing.job();
    const ack = finalBackend.response({ ...canonical, company_id: 9 }, { ...created(), operationKey: request.operationKey }, { companyId: 9 });
    const h = singleResponse(ack.body, ack.status);
    const result = await h.api.createJobSyncCompanyJob(TOKEN, 9, request);
    expect(result.pricing).toEqual({ lineItems: canonical.lineItems, subtotalAmount: canonical.subtotalAmount, discountAmount: canonical.discountAmount,
      taxAmount: canonical.taxAmount, taxRateBps: canonical.taxRateBps, discountKind: canonical.discountKind, discountCode: canonical.discountCode, totalAmount: canonical.amount });
    expect(JSON.parse(h.fetch.mock.calls[0][1].body)).toEqual({ ...request,
      lineItems: [{ priceBookItemId: 71, quantity: 2, vehiclePriceKey: "standard" }, { priceBookItemId: 72, quantity: 1 }], discount: { kind: "percent", value: 10, code: "SAVE" } });
    expect(h.fetch).toHaveBeenCalledOnce();
  });
});
