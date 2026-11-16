import React, { act } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM } from "./helpers/company-photo-test-dom";
import { useCompanyCreationRecovery } from "../hooks/use-company-creation-recovery";
import type { JobSyncNativeSession } from "../lib/jobsync-mobile-api";
const mocks = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock("../lib/company-create-job", () => ({
  companyCreateJobAllowed: (session: any) => Boolean(session?.portal === "company" && session.token && session.company?.id && ["owner", "dispatcher"].includes(session.user.role)),
  createCompanyJobController: (input: any) => {
    const controller = { restore: vi.fn().mockResolvedValue(false), detach: vi.fn() };
    mocks.calls.push({ input, controller }); return controller;
  },
}));
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
function session(companyId = 9): JobSyncNativeSession { return { token: "startup-fixture-only", portal: "company", user: { id: 12, name: "Owner", email: null, role: "owner" }, company: { id: companyId, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } }; }
function Harness({ actor, loading = false }: { actor: JobSyncNativeSession | null; loading?: boolean }) { useCompanyCreationRecovery(actor, loading); return null; }
let root: ReturnType<typeof createRoot>;
beforeEach(() => { mocks.calls = []; const doc = installPhotoTestDOM(); const container = doc.createElement("main"); doc.body.appendChild(container); root = createRoot(container); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Live requests forbidden"))); });
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function render(actor: JobSyncNativeSession | null, loading = false) { await act(async () => root.render(<Harness actor={actor} loading={loading} />)); }
describe("creation attempt startup recovery", () => {
  it("is mounted in the existing auth provider without deleting recovery data on logout", () => {
    const source = readFileSync("lib/jobsync-auth-context.tsx", "utf8");
    expect(source).toContain("useCompanyCreationRecovery(session, isLoading)");
    const logout = source.slice(source.indexOf("const logout ="), source.indexOf("const refreshSession ="));
    expect(logout).toContain("applySession(null)"); expect(logout).not.toMatch(/companyCreationStore|remove.*attempt|clear.*recovery/i);
  });
  it("restores only a ready signed Company manager and never treats startup as calendar success", async () => {
    await render(session(), true); await render(null); const technician = session(); technician.user.role = "technician"; await render(technician);
    expect(mocks.calls).toHaveLength(0); const actor = session(); await render(actor);
    expect(mocks.calls).toHaveLength(1); const call = mocks.calls[0]; expect(call.controller.restore).toHaveBeenCalledTimes(1);
    expect(call.input.session).toBe(actor); expect(call.input.isCurrent()).toBe(true); expect(await call.input.verifyAssignment("jobsync-12")).toBe(false);
    expect(call.input.onCreated({ id: 91 }, "America/Chicago")).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it("logout isolates in-memory callbacks but preserves the attempt for subsequent signed login", async () => {
    const actor = session(); await render(actor); const first = mocks.calls[0]; await render(null);
    expect(first.input.isCurrent()).toBe(false); expect(first.controller.detach).toHaveBeenCalledTimes(1);
    await render({ ...actor, token: "fresh-login-fixture" }); expect(mocks.calls).toHaveLength(2);
    expect(mocks.calls[1].controller.restore).toHaveBeenCalledTimes(1); expect(mocks.calls[1].input.session.company.id).toBe(9);
  });
  it("Company switching, pending session, and role revocation cancel old scope publication", async () => {
    await render(session()); const first = mocks.calls[0]; await render(session(10));
    expect(first.input.isCurrent()).toBe(false); expect(mocks.calls[1].input.session.company.id).toBe(10);
    const second = mocks.calls[1]; const demoted = session(10); demoted.user.role = "technician"; await render(demoted);
    expect(second.input.isCurrent()).toBe(false); expect(mocks.calls).toHaveLength(2);
    await render(session(10), true); expect(mocks.calls).toHaveLength(2);
  });
  it("unmount invalidates retained startup callbacks and never sends creation", async () => {
    await render(session()); const call = mocks.calls[0]; await act(async () => root.unmount());
    expect(call.input.isCurrent()).toBe(false); expect(call.controller.detach).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  });
});
