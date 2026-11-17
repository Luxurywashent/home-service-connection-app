import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { z } from "zod";

// This suite reads the exact authorized snapshot. It never imports a screen,
// backend service, native module, SQL pool, or application HTTP transport.
const backendRoot = "/home/ubuntu/hsc-mobile-final-phase2-20261116/backend-source-f3576bcb";
const mobileSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const backendSource = (path: string) => readFileSync(`${backendRoot}/${path}`, "utf8");
const technician = mobileSource("app/(tabs)/schedule.tsx");
const administrator = mobileSource("app/(tabs)/admin-schedule.tsx");
const routes = backendSource("server/mobileOperations.ts");

function declaration(source: string, name: string): string {
  const ast = ts.createSourceFile("offline-source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = node;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!found) throw new Error(`Missing inspected source declaration: ${name}`);
  return ts.isVariableDeclaration(found) ? `const ${found.getText(ast)};` : found.getText(ast).replace(/^export\s+/, "");
}

// Only named source declarations are evaluated in memory with explicit offline
// injections. No imports, service starts, files emitted, or application build.
function extract<T>(source: string, names: string[], context: Record<string, unknown>, result: string): T {
  const code = ts.transpileModule(names.map((name) => declaration(source, name)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(context), `${code}\nreturn ${result};`)(...Object.values(context)) as T;
}

type FixtureJob = { id: string; companyId?: number; tags: string[] };
type GuardRef = { current: { mounted: boolean; focused: boolean; key: string; generation: number; companyMode: boolean } };
function technicianFixture(overrides: Record<string, unknown> = {}) {
  const job: FixtureJob = { id: "offline-job", tags: ["existing"] };
  const ref: GuardRef = { current: { mounted: true, focused: true, key: "offline-scope", generation: 3, companyMode: false } };
  const writes = vi.fn().mockResolvedValue({ success: true });
  const persist = vi.fn(); const selected = vi.fn(); const saving = vi.fn();
  const locks = { current: new Set<string>() };
  const context = {
    legacyMediaSessionRef: ref, actionKey: "offline-scope", actionGeneration: 3,
    companyJobMode: false, legacyTokenIdentity: "offline-token", scheduleLegacyTokenIdentity: () => "offline-token",
    authLoading: false, jobSyncLoading: false, employee: { employeeId: "offline-actor", role: "detailer", sessionSource: "legacy" },
    jobSyncSession: null, selectedJob: job, jobs: [job], legacyWriteLocksRef: locks,
    jobMetaMutation: { mutateAsync: writes }, persistJobs: persist, setSelectedJob: selected, setSavingMeta: saving,
    ...overrides,
  };
  const save = extract<(job: FixtureJob, tags: string[]) => Promise<void>>(technician,
    ["captureScreenAction", "captureLegacyAction", "claimLegacyWrite", "saveJobTags"], context, "saveJobTags");
  return { job, ref, writes, persist, selected, saving, locks, save };
}

function adminFixture(overrides: Record<string, unknown> = {}) {
  const job: FixtureJob = { id: "offline-job", tags: ["existing"] };
  const ref: GuardRef = { current: { mounted: true, focused: true, key: "offline-scope", generation: 3, companyMode: false } };
  const sheet = { current: 4 };
  const writes = vi.fn().mockResolvedValue({ success: true });
  const jobs = vi.fn(); const selected = vi.fn(); const input = vi.fn();
  const context = {
    managementActionRef: ref, managementActionKey: "offline-scope", calendarScopeRef: { current: { generation: 3, key: "offline-calendar" } },
    calendarScopeKey: "offline-calendar", sheetEpochRef: sheet, currentEmployee: { employeeId: "offline-manager", role: "admin" },
    employeeLoading: false, legacyTokenReady: true, legacyToken: "offline-token", Platform: { OS: "web" },
    LegacyAuth: { getSessionToken: vi.fn().mockRejectedValue(new Error("Credentials forbidden")) },
    jobMetaMutation: { mutateAsync: writes }, setJobs: jobs, setSelectedJob: selected, setAdminTagInput: input,
    ...overrides,
  };
  const actions = extract<{ add: (job: FixtureJob, tag: string) => Promise<void>; remove: (job: FixtureJob, tag: string) => Promise<void> }>(administrator,
    ["captureLegacyJobAction", "renderedLegacyAction", "adminAddTag", "adminRemoveTag"], context, "({ add: adminAddTag, remove: adminRemoveTag })");
  return { job, ref, sheet, writes, jobs, selected, input, ...actions };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live HTTP forbidden in offline tag fixtures"))));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("f3576bcb Company Job tag contract is still absent (read-only source)", () => {
  it("registers canonical Company Job routes but no Job tag or generic metadata write", () => {
    const registrations = [...routes.matchAll(/app\.(get|post|patch|put|delete)\(`\$\{BASE\}([^`]+)`/g)].map((match) => ({ method: match[1], path: match[2] }));
    expect(registrations).toContainEqual({ method: "get", path: "/company/jobs/:jobId" });
    expect(registrations).toContainEqual({ method: "patch", path: "/company/jobs/:jobId/private-notes" });
    const jobRoutes = registrations.filter((route) => /^\/(company\/)?jobs(?:\/|$)/.test(route.path));
    expect(jobRoutes.length).toBeGreaterThan(10);
    expect(jobRoutes.filter((route) => /tags?|meta/i.test(route.path))).toEqual([]);
    expect(jobRoutes.some((route) => route.method === "patch" && /^\/(company\/)?jobs\/:jobId$/.test(route.path))).toBe(false);
  });
  it.each([
    { label: "empty array", tags: [] },
    { label: "tag array", tags: ["offline-tag"] },
    { label: "tag string", tags: "offline-tag" },
  ])("strict Company Job create schema rejects $label tags rather than accepting a false contract", ({ tags }) => {
    const schema = extract<z.ZodType>(routes, ["mobileJobCreateSchema"], { z }, "mobileJobCreateSchema");
    const input = { customerId: 71, priceBookServiceId: 17, scheduledStartAt: "2026-11-17T15:00:00.000Z" };
    expect(schema.safeParse(input).success).toBe(true);
    const parsed = schema.safeParse({ ...input, tags });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unrecognized_keys", keys: ["tags"] })]));
  });
  it("canonical Job service, DTO and Company jobRouter do not define Job tags", () => {
    const service = backendSource("server/jobService.ts");
    const dto = backendSource("server/mobileCompanyJobDto.ts");
    const router = declaration(backendSource("server/fieldServiceRouter.ts"), "jobRouter");
    for (const source of [service, dto, router]) expect(source).not.toMatch(/\btags\b|fs_job_tags|updateMeta/);
    expect(service).toContain("technicianScopeSql(company)");
    expect(service).toContain("WHERE j.id = ? AND j.company_id = ?${tech.clause}");
  });
  it("available tags are manager-authorized customer profile tags, not Job tags", () => {
    const customerUpdate = declaration(routes, "updateCustomer");
    const service = declaration(backendSource("server/customerService.ts"), "updateCustomerProfile");
    expect(customerUpdate).toContain("tags: z.string().trim().max(1000).nullable().optional()");
    expect(customerUpdate).toContain("await updateCustomerProfile(db, company,");
    expect(service).toContain("requireManager(company)");
    expect(service).toContain('UPDATE fs_customers SET ${updates.join(", ")} WHERE id = ? AND company_id = ?');
    expect(service).not.toContain("fs_jobs");
    const migration = backendSource("migrations/20261023_customer_extended_profile_fields.sql");
    expect(migration).toContain("ALTER TABLE fs_customers");
    expect(migration).toContain("ADD COLUMN tags TEXT NULL");
    expect(backendSource("server/mobileCompanyCustomerDto.ts")).toContain("tags: asNullableString(source.tags)");
  });
  it("the backend compatibility test explicitly preserves the missing Job-tag persistence model", () => {
    const compatibility = backendSource("server/hscQaPhase2Compatibility.test.ts");
    expect(compatibility).toContain("does not invent a Job-tag persistence model or weaken technician scoping");
    expect(compatibility).toContain('expect(mobile).not.toContain("fs_job_tags")');
  });
  it("legacy jobs.updateMeta is a separate scheduleJobs write, not Company authorization", () => {
    const legacy = mobileSource("server/routers.ts");
    expect(legacy).toContain("updateMeta: publicProcedure");
    expect(legacy).toContain("await db.updateJobMeta(input.jobId,");
    const storage = declaration(mobileSource("server/db.ts"), "updateJobMeta");
    expect(storage).toContain("scheduleJobs");
    expect(storage).not.toContain("fs_jobs");
  });
});

describe("actual technician tag helper cannot write a Company Job through legacy metadata", () => {
  it.each([
    ["Company mode", { companyJobMode: true }],
    ["signed Company session", { jobSyncSession: { token: "offline-company", portal: "company", company: { id: 9 }, user: { id: 41, role: "technician" } } }],
    ["Company employee", { employee: { employeeId: "offline-actor", companyId: 9 } }],
    ["JobSync employee", { employee: { employeeId: "offline-actor", sessionSource: "jobsync" } }],
    ["session loading", { jobSyncLoading: true }],
    ["auth loading", { authLoading: true }],
    ["credential changed", { scheduleLegacyTokenIdentity: () => "replacement-offline-token" }],
    ["different selected Job", { selectedJob: { id: "other-offline-job" } }],
  ] as const)("rejects %s before local projection and remote writes", async (_name, overrides) => {
    const fixture = technicianFixture(overrides); await fixture.save(fixture.job, ["offline-tag"]);
    expect(fixture.writes).not.toHaveBeenCalled(); expect(fixture.persist).not.toHaveBeenCalled();
    expect(fixture.selected).not.toHaveBeenCalled(); expect(fixture.saving).not.toHaveBeenCalled(); expect(fixture.locks.current.size).toBe(0);
  });
  it("rejects a Company-provenanced Job even with a legacy-looking actor", async () => {
    const fixture = technicianFixture(); await fixture.save({ ...fixture.job, companyId: 9 }, ["offline-tag"]);
    expect(fixture.writes).not.toHaveBeenCalled(); expect(fixture.persist).not.toHaveBeenCalled();
  });
  it.each(["companyMode", "focused", "mounted", "key", "generation"] as const)("retained source helper rejects a changed live %s boundary", async (boundary) => {
    const fixture = technicianFixture();
    if (boundary === "companyMode") fixture.ref.current.companyMode = true;
    else if (boundary === "focused" || boundary === "mounted") fixture.ref.current[boundary] = false;
    else if (boundary === "key") fixture.ref.current.key = "replacement-scope";
    else fixture.ref.current.generation++;
    await fixture.save(fixture.job, ["offline-tag"]);
    expect(fixture.writes).not.toHaveBeenCalled(); expect(fixture.persist).not.toHaveBeenCalled();
  });
  it("preserves one legacy write, synchronous duplicate protection and no blind retry after failure", async () => {
    const fixture = technicianFixture(); let settle: () => void = () => undefined;
    fixture.writes.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { settle = () => reject(new Error("Offline unconfirmed fixture")); }));
    const pending = fixture.save(fixture.job, ["existing", "offline-tag"]);
    await fixture.save(fixture.job, ["existing", "offline-tag"]);
    expect(fixture.writes).toHaveBeenCalledTimes(1);
    expect(fixture.writes).toHaveBeenCalledWith({ jobId: fixture.job.id, tags: '["existing","offline-tag"]' });
    settle(); await pending;
    expect(fixture.writes).toHaveBeenCalledTimes(1); expect(fixture.locks.current.size).toBe(0);
  });
});

describe("actual admin add/remove helpers reject Company Jobs before any legacy write", () => {
  it.each(["add", "remove"] as const)("%s rejects Company provenance and Company live mode", async (action) => {
    const fixture = adminFixture();
    await fixture[action]({ ...fixture.job, companyId: 9 }, "offline-tag");
    fixture.ref.current.companyMode = true; await fixture[action](fixture.job, "offline-tag");
    expect(fixture.writes).not.toHaveBeenCalled(); expect(fixture.jobs).not.toHaveBeenCalled();
    expect(fixture.selected).not.toHaveBeenCalled(); expect(fixture.input).not.toHaveBeenCalled();
  });
  it.each(["focused", "mounted", "key", "generation", "sheet"] as const)("rejects stale %s on both retained tag actions", async (boundary) => {
    const fixture = adminFixture();
    if (boundary === "focused" || boundary === "mounted") fixture.ref.current[boundary] = false;
    else if (boundary === "key") fixture.ref.current.key = "replacement-scope";
    else if (boundary === "generation") fixture.ref.current.generation++;
    else fixture.sheet.current++;
    await fixture.add(fixture.job, "offline-tag"); await fixture.remove(fixture.job, "existing");
    expect(fixture.writes).not.toHaveBeenCalled(); expect(fixture.jobs).not.toHaveBeenCalled();
  });
  it("preserves original authorized legacy add/remove payloads, without claiming Company functionality", async () => {
    const fixture = adminFixture();
    await fixture.add(fixture.job, " offline-tag "); await fixture.remove(fixture.job, "existing");
    expect(fixture.writes.mock.calls).toEqual([
      [{ jobId: fixture.job.id, tags: '["existing","offline-tag"]' }],
      [{ jobId: fixture.job.id, tags: "[]" }],
    ]);
  });
});

describe("existing compact tag controls and keyboard hookups remain contract-limited", () => {
  it("technician card remains legacy-only and uses existing guarded add/remove paths", () => {
    expect(technician).toContain("{!companyJobMode && <View ref={detailTagRef}");
    expect(technician).toContain("if (captureLegacyAction(selectedJob)()) setEditingTags(!editingTags)");
    expect(technician).toContain("onFocus={detailInputFocus}"); expect(technician).toContain("onBlur={detailInputBlur}");
    expect(technician).toContain("saveJobTags(selectedJob, [...(selectedJob.tags ?? []), trimmed])");
  });
  it("legacy admin card keeps its guarded actions while keyboard currentness branches for Company mode", () => {
    expect(administrator).toContain("<View ref={detailTagRef} collapsable={false}");
    expect(administrator).toContain("onSubmitEditing={() => adminAddTag(selectedJob, adminTagInput)}");
    expect(administrator).toContain("onPress={() => adminRemoveTag(selectedJob, tag)}");
    expect(administrator).toContain("isCurrent: companyJobMode ? isCurrentCompanyJobOperation : renderedLegacyAction");
    expect(administrator).toContain("scopeKey: companyJobMode ? companyJobOperationScope : managementActionKey");
    expect(administrator).toContain("{!companyJobMode && <View ref={detailTagRef}");
    expect(administrator).toContain("onFocus={detailInputFocus} onBlur={detailInputBlur} value={adminTagInput}");
  });
  it("retains bounded modal scrolling and AppState-aware keyboard handling, without adding a Company field", () => {
    for (const source of [technician, administrator]) {
      expect(source).toContain("ref={detailScrollRef} {...detailScrollProps} automaticallyAdjustKeyboardInsets={false}");
      expect(source).toContain('keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"');
      expect(source).toContain("<CompanyJobKeyboardBoundary");
    }
    const keyboard = mobileSource("lib/company-job-keyboard.ts");
    expect(keyboard).toContain('AppState.addEventListener("change"');
    expect(keyboard).toContain("!live.current.foreground || !live.current.isCurrent()");
    const sheet = mobileSource("components/company-create-job-sheet.tsx");
    expect(sheet).not.toMatch(/\btagInput\b|\badminTagInput\b|\bJob Tags\b|\btags:/);
  });
});
