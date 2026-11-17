import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { normalizeJobSyncCompanyJobDetail } from "../lib/jobsync-mobile-api";

const requireLocal = createRequire(import.meta.url);
const ts: typeof import("typescript") = requireLocal("typescript");
const file = "/home/ubuntu/hsc-mobile-final-phase2-20261116/backend-source-f3576bcb/server/mobileOperations.ts";
const source = readFileSync(file, "utf8");
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = ["jobDetail", "assertMobileJobPhotoAccess", "uploadJobPhoto"];
const declarations = names.map(name => {
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  if (!node) throw new Error(`Exact pinned backend function missing: ${name}`);
  return node.getText(ast);
});
const js = ts.transpileModule(`${declarations.join("\n")}\nexport { jobDetail, uploadJobPhoto };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file,
}).outputText;
class FixtureDomainError extends Error { constructor(public code: string, message: string) { super(message); } }
type StoredPhoto = { id: number; company_id: number; job_id: number; uploaded_by_user_id: number;
  storage_key: string; image_url: string; caption: string | null; category: string; display_order: number; created_at: string };
function fixture(role = "owner", assignedUserId: number | null = 99) {
  const company = { companyId: 9, userId: 42, role, permissions: { canManageJobs: role !== "technician" } };
  const photos: StoredPhoto[] = []; const events: unknown[] = []; const queries: { sql: string; params: unknown[] }[] = [];
  const db = { execute: vi.fn(async (sql: string, params: unknown[]) => {
    queries.push({ sql, params });
    if (sql.startsWith("INSERT INTO fs_job_photos")) {
      expect(params).toHaveLength(8); expect(sql).toContain("caption, category, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      const [company_id, job_id, uploaded_by_user_id, storage_key, image_url, caption, category, display_order] = params;
      const id = photos.length + 1;
      photos.push({ id, company_id: Number(company_id), job_id: Number(job_id), uploaded_by_user_id: Number(uploaded_by_user_id),
        storage_key: String(storage_key), image_url: String(image_url), caption: caption as string | null,
        category: String(category), display_order: Number(display_order), created_at: "2026-11-17T04:00:00Z" });
      return [{ insertId: id }];
    }
    if (sql.startsWith("INSERT INTO fs_job_events")) { events.push(params); return [{ affectedRows: 1 }]; }
    if (sql.startsWith("SELECT id, image_url, caption, category, display_order")) {
      expect(sql).toContain("ORDER BY display_order ASC, created_at DESC, id DESC");
      expect(params).toEqual([9, 12]);
      return [photos.filter(item => item.company_id === 9 && item.job_id === 12)
        .sort((a, b) => a.display_order - b.display_order || b.created_at.localeCompare(a.created_at) || b.id - a.id)];
    }
    throw new Error(`Unknown SQL is forbidden in offline fixture: ${sql}`);
  }) };
  const canonicalDetail = { id: 12, companyId: 9, assignedUserId, status: "scheduled", photos: [] };
  const storagePut = vi.fn(async (key: string, bytes: Buffer, contentType: string) => {
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255])); expect(contentType).toBe("image/jpeg");
    return { key, url: `https://fixture.invalid/api/storage/${key}` };
  });
  let randomId = 0;
  const bindings = {
    z, COMPANY_LOGO_TYPES: ["image/jpeg", "image/png", "image/webp"], DomainError: FixtureDomainError,
    mobileCompany: async () => ({ company, db }),
    getJobDetail: async (_db: unknown, incomingCompany: typeof company, jobId: number) => {
      if (incomingCompany.companyId !== 9 || jobId !== 12) throw new FixtureDomainError("NOT_FOUND", "Not found");
      return canonicalDetail;
    },
    decodeCompanyImage: (base64: string) => ({ bytes: Buffer.from(base64, "base64"), extension: "jpg" }),
    storagePut, randomBytes: (size: number) => Buffer.alloc(size, ++randomId),
    signedStorageUrlFromStoredUrl: (url: string) => `${url}?expires=300&signature=mock-renewed`,
    projectMobileCompanyJob: (detail: typeof canonicalDetail) => ({ id: detail.id, companyId: detail.companyId, status: detail.status, assignedUserId: detail.assignedUserId }),
    iso: (value: string) => value,
    operationalError: (res: ReturnType<typeof output>, error: unknown) => res.status(error instanceof FixtureDomainError && error.code === "NOT_FOUND" ? 404 : 400).json({ error: { code: error instanceof FixtureDomainError ? error.code : "BAD_REQUEST" } }),
  };
  const module = { exports: {} as { uploadJobPhoto: (req: unknown, res: ReturnType<typeof output>) => Promise<unknown>; jobDetail: (req: unknown, res: ReturnType<typeof output>) => Promise<unknown> } };
  const forbidden = () => { throw new Error("Real network or module import forbidden"); };
  compileFunction(js, ["exports", "module", "require", "fetch", "process", ...Object.keys(bindings)], { filename: file })(
    module.exports, module, forbidden, forbidden, { env: {} }, ...Object.values(bindings));
  return { ...module.exports, photos, events, queries, storagePut, company };
}
function output() {
  const result = { code: 200, body: null as any, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  return result;
}
const bytes = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(509)]).toString("base64");
async function upload(server: ReturnType<typeof fixture>, metadata: Record<string, unknown> = {}) {
  const res = output(); await server.uploadJobPhoto({ params: { jobId: "12" }, body: { contentType: "image/jpeg", base64: bytes, ...metadata } }, res); return res;
}
async function refresh(server: ReturnType<typeof fixture>) {
  const res = output(); await server.jobDetail({ params: { jobId: "12" } }, res); return res;
}

describe("exact f3576bcb photo handlers — in-memory SQL and mocked storage, never a live backend", () => {
  it.each(["before", "after", "damage", "other"])("stores and returns %s metadata through new signed detail reads", async category => {
    const server = fixture(); const result = await upload(server, { category, displayOrder: 8 });
    expect(result.code).toBe(201); expect(result.body.photo).toMatchObject({ id: 1, category, displayOrder: 8, caption: null, uploadedByUserId: 42 });
    expect(server.photos[0]).toMatchObject({ company_id: 9, job_id: 12, category, display_order: 8 });
    for (let index = 0; index < 2; index++) {
      const readback = await refresh(server); const normalized = normalizeJobSyncCompanyJobDetail(readback.body, 12, 9);
      expect(normalized?.photos[0]).toMatchObject({ id: 1, category, displayOrder: 8 });
      expect(normalized?.photos[0].imageUrl).toContain("signature=mock-renewed");
    }
    expect(server.storagePut).toHaveBeenCalledOnce(); expect(server.events).toHaveLength(1);
  });
  it("keeps existing storage/caption independent and returns canonical display-order and tie order", async () => {
    const server = fixture(); await upload(server, { category: "after", displayOrder: 2, caption: "  Existing caption  " });
    await upload(server, { category: "before", displayOrder: 1 }); await upload(server, { category: "damage", displayOrder: 2 });
    const result = await refresh(server); const detail = normalizeJobSyncCompanyJobDetail(result.body, 12, 9)!;
    expect(detail.photos.map(photo => photo.id)).toEqual([2, 3, 1]);
    expect(detail.photos[2]).toMatchObject({ category: "after", displayOrder: 2, caption: "Existing caption" });
    expect(server.storagePut).toHaveBeenCalledTimes(3); expect(server.events).toHaveLength(3);
  });
  it("preserves exact backend omitted-metadata defaults without inferring Job phase", async () => {
    const server = fixture(); expect((await upload(server)).body.photo).toMatchObject({ category: "other", displayOrder: 0 });
    expect((await refresh(server)).body.job.photos[0]).toMatchObject({ category: "other", displayOrder: 0 });
  });
  it.each([{ category: "Before" }, { category: "unknown" }, { category: null }, { displayOrder: -1 }, { displayOrder: 1.5 },
    { displayOrder: 100001 }, { displayOrder: "1" }])("rejects invalid metadata before mocked storage or SQL INSERT: %#", async metadata => {
    const server = fixture(); expect((await upload(server, metadata)).code).toBe(400);
    expect(server.storagePut).not.toHaveBeenCalled(); expect(server.photos).toHaveLength(0); expect(server.events).toHaveLength(0);
  });
  it("retains independent assigned-technician photo authority", async () => {
    const assigned = fixture("technician", 42); expect((await upload(assigned, { category: "before", displayOrder: 1 })).code).toBe(201);
    const unassigned = fixture("technician", null); expect((await upload(unassigned, { category: "before", displayOrder: 1 })).code).toBe(404);
    expect(unassigned.storagePut).not.toHaveBeenCalled(); expect(unassigned.photos).toHaveLength(0);
  });
});
