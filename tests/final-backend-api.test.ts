import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteJobSyncCompanyJobPhoto,
  getJobSyncCompanyJobDetail,
  JobSyncApiError,
  normalizeJobSyncCompanyJobDetail,
  normalizeJobSyncPhotoUrl,
  updateJobSyncCompanyOwnFieldwork,
  uploadJobSyncCompanyJobPhoto,
  type JobSyncJobPhotoUploadInput,
  type JobSyncJobPhotoUploadResponse,
} from "../lib/jobsync-mobile-api";

// All transport is stubbed. These signatures are synthetic bytes, not actual device photos.
const ORIGIN = "https://jobwash-veysiubh.manus.space";
const TOKEN = "mock-company-token";
const RELATIVE = "/manus-storage/companies/9/jobs/47/photos/fixture.jpg?expires=123&signature=AbC%2b%2F%3D&signature=second+value";
const JPEG = Buffer.from([255, 216, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64");
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64");
const WEBP = Buffer.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]).toString("base64");
const INPUT: JobSyncJobPhotoUploadInput = { contentType: "image/jpeg", base64: JPEG };
const PHOTO = { id: 7, imageUrl: RELATIVE, caption: null, uploadedByUserId: 41 };
const INVALID_ACK = { name: "JobSyncApiError", code: "INVALID_RESPONSE" };

function response(payload: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function stubResponse(payload: unknown, status = 200) {
  const fetchSpy = vi.fn().mockResolvedValue(response(payload, status));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  vi.stubEnv("EXPO_PUBLIC_JOBSYNC_API_BASE_URL", ORIGIN);
  // Fail closed if a test forgets to configure its own response; never use live fetch.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unconfigured mock fetch")));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("final backend self-profile API", () => {
  it.each([true, false])("PATCHes only the explicit Boolean override %s and returns raw profile", async (calendarEligibleOverride) => {
    const raw = {
      accountType: "company", user: { id: 41, role: "owner", calendarEligible: calendarEligibleOverride },
      company: { id: 9, name: "Unit" },
    };
    const fetchSpy = stubResponse(raw);
    const result = await updateJobSyncCompanyOwnFieldwork(TOKEN, {
      calendarEligibleOverride, role: "technician", companyId: 99, userId: 99,
      expectedVersion: 1, expectedUpdatedAt: "invented", firstName: "ignored",
    } as any);
    expect(result).toBe(raw);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(`${ORIGIN}/api/mobile/v1/company/profile`, expect.objectContaining({
      method: "PATCH", cache: "no-store", signal: expect.any(AbortSignal),
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ calendarEligibleOverride }),
    }));
  });

  it.each([null, {}, [], { calendarEligibleOverride: null }, { calendarEligibleOverride: "true" }, { calendarEligibleOverride: 1 }])("rejects non-Boolean input locally: %j", async (input) => {
    const fetchSpy = stubResponse(null);
    await expect(updateJobSyncCompanyOwnFieldwork(TOKEN, input as any)).rejects.toThrow("explicit Boolean");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([null, { success: true }, { member: { id: 41, calendarEligible: true } }])("leaves raw identity/role acknowledgment validation to the self helper: %j", async (payload) => {
    stubResponse(payload);
    expect(await updateJobSyncCompanyOwnFieldwork(TOKEN, { calendarEligibleOverride: true })).toBe(payload);
  });
});

describe("final backend single-photo upload API", () => {
  it("POSTs exact fields, accepts 201 photo without createdAt/success, and normalizes only its usable URL", async () => {
    const fetchSpy = stubResponse({ photo: { ...PHOTO, caption: "Before" } }, 201);
    const result: JobSyncJobPhotoUploadResponse = await uploadJobSyncCompanyJobPhoto(TOKEN, 47, {
      ...INPUT, caption: "  Before  ", jobId: 99, companyId: 99, uploadedByUserId: 99,
      mimeType: "image/png", filename: "ignored", expectedUpdatedAt: "invented", success: true,
    } as any);
    expect(result).toEqual({ photo: { ...PHOTO, imageUrl: `${ORIGIN}${RELATIVE}`, caption: "Before" } });
    expect(Object.keys(result.photo).sort()).toEqual(["caption", "id", "imageUrl", "uploadedByUserId"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(`${ORIGIN}/api/mobile/v1/jobs/47/photos`, expect.objectContaining({
      method: "POST", cache: "no-store", signal: expect.any(AbortSignal),
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: "image/jpeg", base64: JPEG, caption: "  Before  " }),
    }));
  });

  it.each([undefined, "", " \n\t "])("keeps optional/blank caption behavior without invented fields: %j", async (caption) => {
    const fetchSpy = stubResponse({ photo: PHOTO }, 201);
    await expect(uploadJobSyncCompanyJobPhoto(TOKEN, 47, { ...INPUT, ...(caption !== undefined ? { caption } : {}) })).resolves.toEqual({ photo: { ...PHOTO, imageUrl: `${ORIGIN}${RELATIVE}` } });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toEqual({ ...INPUT, ...(caption !== undefined ? { caption } : {}) });
    expect(Object.hasOwn(body, "caption")).toBe(caption !== undefined);
  });

  it.each([
    ["image/jpeg", JPEG], ["image/png", PNG], ["image/webp", WEBP],
  ] as const)("checks actual %s signature for raw and truthful data-URI base64", async (contentType, base64) => {
    const fetchSpy = stubResponse({ photo: PHOTO }, 201);
    for (const encoded of [base64, `data:${contentType};base64,${base64}`]) {
      await uploadJobSyncCompanyJobPhoto(TOKEN, 47, { contentType, base64: encoded });
      expect(JSON.parse(fetchSpy.mock.calls.at(-1)![1].body)).toEqual({ contentType, base64: encoded });
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each(["image/jpg", "IMAGE/JPEG", "image/jpeg;charset=utf-8", "image/heic", "image/gif", "application/octet-stream", null, undefined])("rejects unsupported MIME without transport: %s", async (contentType) => {
    const fetchSpy = stubResponse({ photo: PHOTO }, 201);
    await expect(uploadJobSyncCompanyJobPhoto(TOKEN, 47, { ...INPUT, contentType } as any)).rejects.toThrow("JPEG, PNG, or WebP");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    { contentType: "image/jpeg", base64: PNG }, { contentType: "image/png", base64: JPEG },
    { contentType: "image/webp", base64: JPEG }, { contentType: "image/webp", base64: Buffer.from("RIFF0000FAKE").toString("base64") },
    { contentType: "image/jpeg", base64: `data:image/png;base64,${JPEG}` },
    { contentType: "image/jpeg", base64: `arbitrary-prefix,${JPEG}` },
  ])("rejects mismatched bytes or untruthful prefix: %j", async (input) => {
    const fetchSpy = stubResponse({ photo: PHOTO }, 201);
    await expect(uploadJobSyncCompanyJobPhoto(TOKEN, 47, input as any)).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([null, "", JPEG.slice(1), `${JPEG}\n`, ` ${JPEG}`, JPEG.replace("/", "_"), `${JPEG}=`, "AAAAAAAAAAAAA===", "AAAAAAAAAAAAAAAA=", "AAAAAAAAAAAAAB==", "AAAAAAAAAAAAAAA!", "AAAAAAAAAAAAAAA"]) ("rejects malformed/undersized base64 locally: %j", async (base64) => {
    const fetchSpy = stubResponse({ photo: PHOTO }, 201);
    await expect(uploadJobSyncCompanyJobPhoto(TOKEN, 47, { ...INPUT, base64 } as any)).rejects.toThrow("base64");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows backend-compatible unpadded canonical base64 with matching image bytes", async () => {
    stubResponse({ photo: PHOTO }, 201);
    const bytes = Buffer.alloc(13); bytes.set([255, 216, 255]);
    await expect(uploadJobSyncCompanyJobPhoto(TOKEN, 47, { ...INPUT, base64: bytes.toString("base64").replace(/=+$/, "") })).resolves.toHaveProperty("photo.id", 7);
  });

  it("accepts exactly 15 MiB, rejects one decoded byte over and enforces the encoded schema limit", async () => {
    const fetchSpy = stubResponse({ photo: PHOTO }, 201);
    const bytes = Buffer.alloc(15 * 1024 * 1024); bytes.set([255, 216, 255]);
    await expect(uploadJobSyncCompanyJobPhoto(TOKEN, 47, { ...INPUT, base64: bytes.toString("base64") })).resolves.toHaveProperty("photo.id", 7);
    const over = Buffer.concat([bytes, Buffer.from([0])]).toString("base64");
    await expect(uploadJobSyncCompanyJobPhoto(TOKEN, 47, { ...INPUT, base64: over })).rejects.toThrow("15 MiB");
    await expect(uploadJobSyncCompanyJobPhoto(TOKEN, 47, { ...INPUT, base64: "A".repeat(21_000_001) })).rejects.toThrow("base64");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("applies the 1,000-character caption limit after trim, preserving wire input", async () => {
    const caption = "x".repeat(1000);
    const fetchSpy = stubResponse({ photo: { ...PHOTO, caption } }, 201);
    await uploadJobSyncCompanyJobPhoto(TOKEN, 47, { ...INPUT, caption: ` ${caption} ` });
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).caption).toBe(` ${caption} `);
    for (const invalid of ["x".repeat(1001), null, 5, {}, []]) {
      await expect(uploadJobSyncCompanyJobPhoto(TOKEN, 47, { ...INPUT, caption: invalid } as any)).rejects.toThrow("captions");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    null, [], {}, { success: true }, { url: RELATIVE }, { photo: null }, { photo: [] },
    { photo: { ...PHOTO, id: "7" } }, { photo: { ...PHOTO, id: 0 } }, { photo: { ...PHOTO, id: -1 } },
    { photo: { ...PHOTO, id: 1.5 } }, { photo: { ...PHOTO, id: Number.MAX_SAFE_INTEGER + 1 } },
    { photo: { ...PHOTO, uploadedByUserId: "41" } }, { photo: { ...PHOTO, uploadedByUserId: null } },
    { photo: { ...PHOTO, uploadedByUserId: 0 } }, { photo: { ...PHOTO, uploadedByUserId: Number.MAX_SAFE_INTEGER + 1 } },
    { photo: { ...PHOTO, imageUrl: null } }, { photo: { ...PHOTO, imageUrl: "file:///local.jpg" } },
    { photo: { ...PHOTO, imageUrl: "/manus-storage/../secret" } },
    { photo: { id: 7, image_url: RELATIVE, caption: null, uploadedByUserId: 41 } },
    { photo: { id: 7, imageUrl: RELATIVE, uploadedByUserId: 41 } },
    { photo: { ...PHOTO, caption: false } }, { photo: { ...PHOTO, caption: "Wrong caption" } },
  ])("fails closed for invalid upload acknowledgment: %j", async (payload) => {
    const fetchSpy = stubResponse(payload, 201);
    await expect(uploadJobSyncCompanyJobPhoto(TOKEN, 47, INPUT)).rejects.toMatchObject(INVALID_ACK);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects an unreadable JSON acknowledgment instead of inventing success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => { throw new SyntaxError("Malformed JSON"); } }));
    await expect(uploadJobSyncCompanyJobPhoto(TOKEN, 47, INPUT)).rejects.toMatchObject(INVALID_ACK);
  });

  it.each([200, 202, 204])("requires the exact upload status 201, not %s", async (status) => {
    stubResponse({ photo: PHOTO }, status);
    await expect(uploadJobSyncCompanyJobPhoto(TOKEN, 47, INPUT)).rejects.toMatchObject({ ...INVALID_ACK, status });
  });
});

describe("final backend photo delete API", () => {
  it("DELETEs persisted IDs with bearer/no-store and no body or invented version, returning only success:true", async () => {
    const fetchSpy = stubResponse({ success: true });
    await expect(deleteJobSyncCompanyJobPhoto(TOKEN, 47, 7)).resolves.toEqual({ success: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(`${ORIGIN}/api/mobile/v1/jobs/47/photos/7`, expect.objectContaining({
      method: "DELETE", cache: "no-store", signal: expect.any(AbortSignal),
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    }));
    expect(Object.hasOwn(fetchSpy.mock.calls[0][1], "body")).toBe(false);
  });

  it.each([null, [], {}, { success: false }, { success: "true" }, { success: 1 }, { deleted: true }, { photo: PHOTO }])("rejects invalid delete acknowledgment: %j", async (payload) => {
    const fetchSpy = stubResponse(payload);
    await expect(deleteJobSyncCompanyJobPhoto(TOKEN, 47, 7)).rejects.toMatchObject(INVALID_ACK);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("requires status 200 rather than treating 204/empty response as deleted", async () => {
    stubResponse(null, 204);
    await expect(deleteJobSyncCompanyJobPhoto(TOKEN, 47, 7)).rejects.toMatchObject({ ...INVALID_ACK, status: 204 });
  });
});

describe("final backend mutation transport defenses and honest failures", () => {
  const mutations = [
    ["self", () => updateJobSyncCompanyOwnFieldwork(TOKEN, { calendarEligibleOverride: true })],
    ["upload", () => uploadJobSyncCompanyJobPhoto(TOKEN, 47, INPUT)],
    ["delete", () => deleteJobSyncCompanyJobPhoto(TOKEN, 47, 7)],
  ] as const;

  it.each(["", "  ", "token\r\nInjected", "two tokens", null])("rejects invalid bearer tokens before any request: %j", async (token) => {
    const fetchSpy = stubResponse(null);
    await expect(updateJobSyncCompanyOwnFieldwork(token as any, { calendarEligibleOverride: true })).rejects.toThrow("current Company session");
    await expect(uploadJobSyncCompanyJobPhoto(token as any, 47, INPUT)).rejects.toThrow("current Company session");
    await expect(deleteJobSyncCompanyJobPhoto(token as any, 47, 7)).rejects.toThrow("current Company session");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "47", null])("rejects unsafe/non-numeric path IDs locally: %j", async (id) => {
    const fetchSpy = stubResponse(null);
    await expect(uploadJobSyncCompanyJobPhoto(TOKEN, id as any, INPUT)).rejects.toThrow("invalid Job");
    await expect(deleteJobSyncCompanyJobPhoto(TOKEN, id as any, 7)).rejects.toThrow("invalid Job");
    await expect(deleteJobSyncCompanyJobPhoto(TOKEN, 47, id as any)).rejects.toThrow("persisted Job photo identifier");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(mutations)("preserves nested backend status/code/message and never retries %s", async (_name, mutate) => {
    for (const [status, code] of [[400, "BAD_REQUEST"], [401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [404, "NOT_FOUND"], [503, "UNAVAILABLE"]] as const) {
      const fetchSpy = stubResponse({ error: { code, message: "Safe backend denial" } }, status);
      await expect(mutate()).rejects.toMatchObject({ name: "JobSyncApiError", status, code, message: "Safe backend denial" });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    }
  });

  it.each(mutations)("preserves flat Origin errors and non-JSON HTTP errors for %s", async (_name, mutate) => {
    stubResponse({ error: "Untrusted origin." }, 403);
    await expect(mutate()).rejects.toMatchObject({ status: 403, code: null, message: "Untrusted origin." });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 413, json: async () => { throw new SyntaxError("HTML error page"); } }));
    await expect(mutate()).rejects.toMatchObject({ status: 413, code: null });
  });

  it.each(mutations)("does not blind retry an ambiguous network failure for %s", async (_name, mutate) => {
    const error = new TypeError("Network request failed");
    const fetchSpy = vi.fn().mockRejectedValue(error); vi.stubGlobal("fetch", fetchSpy);
    await expect(mutate()).rejects.toBe(error);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each(mutations)("keeps the defensive 20-second abort and TIMEOUT classification for %s", async (_name, mutate) => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const assertion = expect(mutate()).rejects.toMatchObject({ name: "JobSyncApiError", status: null, code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(fetchSpy.mock.calls[0][1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("canonical signed photos from final backend", () => {
  it("reads canonical camelCase photo detail through bearer Job GET without forwarding bearer into image URLs", async () => {
    const createdAt = "2026-11-15T13:00:00.000Z";
    const fetchSpy = stubResponse({ job: { id: 47, company_id: 9, assignedUserId: 41, photos: [{ ...PHOTO, createdAt }] } });
    const detail = await getJobSyncCompanyJobDetail(TOKEN, 47, 9);
    expect(detail.photos).toEqual([{ ...PHOTO, imageUrl: `${ORIGIN}${RELATIVE}`, createdAt }]);
    expect(detail.photos[0].imageUrl).not.toContain(TOKEN);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(`${ORIGIN}/api/mobile/v1/jobs/47`, expect.objectContaining({
      method: "GET", cache: "no-store", headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    }));
  });

  it("prioritizes present canonical camelCase fields even when null/invalid, with only already-supported snake_case compatibility", () => {
    const legacy = "https://legacy.test/fixture.jpg";
    const legacyTime = "2026-11-14T13:00:00.000Z";
    const photos = normalizeJobSyncCompanyJobDetail({ job: { id: 47, company_id: 9, photos: [
      { ...PHOTO, createdAt: "2026-11-15T13:00:00.000Z", image_url: legacy, created_at: legacyTime },
      { ...PHOTO, id: 8, imageUrl: null, image_url: legacy },
      { ...PHOTO, id: 9, imageUrl: "file:///draft.jpg", image_url: legacy },
      { ...PHOTO, id: 10, createdAt: null, created_at: legacyTime },
      { ...PHOTO, id: 11, createdAt: "invalid", created_at: legacyTime },
      { id: 12, image_url: legacy, created_at: legacyTime, caption: null, uploadedByUserId: 41 },
    ], photo_urls: '["https://legacy.test/never-use.jpg"]', localDrafts: [{ uri: "file:///draft.jpg" }] } }, 47, 9)!.photos;
    expect(photos.map((photo) => photo.id)).toEqual([7, 10, 11, 12]);
    expect(photos[0]).toMatchObject({ imageUrl: `${ORIGIN}${RELATIVE}`, createdAt: "2026-11-15T13:00:00.000Z" });
    expect(photos[1].createdAt).toBeNull(); expect(photos[2].createdAt).toBeNull();
    expect(photos[3]).toMatchObject({ imageUrl: legacy, createdAt: legacyTime });
  });

  it("returns authoritative emptiness without merging photo_urls or local drafts, and never invents uploader", () => {
    expect(normalizeJobSyncCompanyJobDetail({ job: { id: 47, photos: [], photo_urls: '["https://legacy.test/never-use.jpg"]' } }, 47, 9)!.photos).toEqual([]);
    const detail = normalizeJobSyncCompanyJobDetail({ job: { id: 47, photos: [{ id: 7, imageUrl: RELATIVE }] } }, 47, 9)!;
    expect(detail.photos[0].uploadedByUserId).toBeNull();
    expect(detail.photos[0].createdAt).toBeNull();
    expect(normalizeJobSyncCompanyJobDetail({ job: { id: 47, company_id: 10, photos: [PHOTO] } }, 47, 9)).toBeNull();
  });

  it("preserves signed query bytes and only inherits the configured HTTPS origin, not its optional base path", () => {
    vi.stubEnv("EXPO_PUBLIC_JOBSYNC_API_BASE_URL", `${ORIGIN}/configured-base`);
    expect(normalizeJobSyncPhotoUrl(RELATIVE)).toBe(`${ORIGIN}${RELATIVE}`);
    expect(normalizeJobSyncPhotoUrl("/api/storage/legacy/fixture.jpg?signature=abc%2bDEF")).toBe(`${ORIGIN}/api/storage/legacy/fixture.jpg?signature=abc%2bDEF`);
    const absolute = "https://unlisted-existing-policy.test/a.jpg?signature=Ab%2b%2F%3D&x=+&x=%20";
    expect(normalizeJobSyncPhotoUrl(absolute)).toBe(absolute);
  });

  it.each(["http://api.test", "https://user:pass@api.test", "not-a-url"])("does not inherit insecure/credential-bearing/invalid configured base %s", (base) => {
    vi.stubEnv("EXPO_PUBLIC_JOBSYNC_API_BASE_URL", base);
    expect(normalizeJobSyncPhotoUrl(RELATIVE)).toBeNull();
  });

  it.each([
    "/manus-storage/", "/manus-storage", "manus-storage/a.jpg", "/manus-storage-other/a.jpg", "/photos/a.jpg",
    "//foreign.test/manus-storage/a.jpg", "/manus-storage//foreign.test/a.jpg", "/manus-storage/a//b.jpg",
    "/manus-storage/../secret", "/manus-storage/./a.jpg", "/manus-storage/%2e%2e/secret",
    "/manus-storage/%252e%252e/secret", "/manus-storage/folder/%2f..%2fsecret", "/manus-storage/%252f..%252fsecret",
    "/manus-storage/\\foreign.test/a.jpg", "/manus-storage/%5ca.jpg", "/manus-storage/%255ca.jpg",
    "/manus-storage/%00.jpg", "/manus-storage/%2500.jpg", "/manus-storage/%7f.jpg", "/manus-storage/%257f.jpg",
    "/manus-storage/%GG.jpg", "/manus-storage/%E0%A4.jpg", "/manus-storage/a.jpg\n", " /manus-storage/a.jpg",
    "/manus-storage/a.jpg?signature=x\r\ny", "/manus-storage/a.jpg?signature=x%0Ay",
    "http://foreign.test/a.jpg", "https://user:pass@cdn.test/a.jpg", "https://cdn.test/a/../b.jpg",
    "https://cdn.test/a/%252e%252e/b.jpg", "data:image/jpeg;base64,AA", "file:///draft.jpg", "javascript:alert(1)", null,
  ])("retains traversal/control/scheme/path defenses for %j", (url) => {
    expect(normalizeJobSyncPhotoUrl(url)).toBeNull();
    expect(normalizeJobSyncCompanyJobDetail({ job: { id: 47, photos: [{ ...PHOTO, imageUrl: url }] } }, 47, 9)!.photos).toEqual([]);
  });

  it("throws the existing invalid-detail error on cross-Company canonical refresh", async () => {
    stubResponse({ job: { id: 47, company_id: 10, photos: [PHOTO] } });
    await expect(getJobSyncCompanyJobDetail(TOKEN, 47, 9)).rejects.toBeInstanceOf(JobSyncApiError);
  });
  it.each([undefined, null, {}, "[]", [null], [{ id: 0 }], [{ id: 7 }, { id: 7 }]])("rejects an unverifiable wire gallery %j rather than proving absence", async (photos) => {
    const job = { id: 47, company_id: 9, photos };
    expect(normalizeJobSyncCompanyJobDetail({ job }, 47, 9)).toBeNull();
    stubResponse({ job });
    await expect(getJobSyncCompanyJobDetail(TOKEN, 47, 9)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("retains persisted IDs when a null or rejected URL cannot render", () => {
    const detail = normalizeJobSyncCompanyJobDetail({ job: { id: 47, company_id: 9, photos: [
      PHOTO, { ...PHOTO, id: 8, imageUrl: null }, { ...PHOTO, id: 9, imageUrl: "file:///not-remote.jpg" },
    ] } }, 47, 9)!;
    expect(detail.photos.map((photo) => photo.id)).toEqual([7]);
    expect(detail.persistedPhotoIds).toEqual([7, 8, 9]);
    expect(normalizeJobSyncCompanyJobDetail({ job: { id: 47, photos: [] } }, 47, 9)?.persistedPhotoIds).toEqual([]);
  });
});
