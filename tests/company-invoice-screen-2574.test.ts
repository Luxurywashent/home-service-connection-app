import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  assertCompanyJobInvoiceJob,
  assertCompanyJobInvoiceSession,
  captureCompanyJobInvoiceIntent,
  createCompanyJobInvoiceOptions,
} from "../lib/company-job-invoice-intent";
import { createCompanyJobInvoiceAttemptGuard, validateCompanyJobInvoiceRecipientReceipt } from "../lib/company-job-invoice-recipient";

const session = () => ({ token: "synthetic-screen", portal: "company", company: { id: 9 }, user: { id: 42, role: "owner" } });
const receipt = () => ({ success: true, channel: "email", publicUrl: "https://synthetic.invalid/invoice/opaque", communicationState: "provider_accepted", sentTo: "on-file@example.test" });
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((yes) => { resolve = yes; });
  return { resolve, promise };
}

/**
 * Execute the installed invoice callback with isolated screen and network bindings.
 * No proposed source insertions or production-screen rewrite. Actual mounted JSX
 * and lifecycle acceptance are covered by the connected screen test suite.
 */
function installedScreenClosure(overrides: Record<string, any> = {}) {
  const file = "/home/ubuntu/home-service-connection-app/app/(tabs)/admin-schedule.tsx";
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === "onPress" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression?.getText(tree).includes("sendJobSyncCompanyJobInvoice")) callback = node.initializer.expression;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!callback) throw new Error("Missing actual authoritative invoice closure");
  const body = callback.getText(tree);
  if (!body.includes("companyInvoiceAttemptGuardRef") || !body.includes("validateCompanyJobInvoiceRecipientReceipt")) throw new Error("Required installed invoice integration is absent");
  const current = { value: true };
  const context: any = {
    invoiceLockRef: { current: false }, managementActionRef: { current: { mounted: true } }, isCurrentInvoice: () => current.value,
    companyInvoiceAttemptGuardRef: { current: createCompanyJobInvoiceAttemptGuard() },
    companyJobMode: true, isJobSyncCompany: true, jobSyncLoading: false,
    jobSyncSession: session(), selectedJob: { id: "12", companyId: 9 }, positiveJobSyncId: Number,
    invoiceMethod: "email", invoiceResend: false, companyInvoiceRecipientEmail: "",
    getJobSyncMobileSession: vi.fn().mockResolvedValue(session()),
    getJobSyncCompanyJobDetail: vi.fn().mockResolvedValue({ id: 12, companyId: 9 }),
    sendJobSyncCompanyJobInvoice: vi.fn().mockResolvedValue(receipt()),
    setInvoiceSending: vi.fn(), setInvoiceSentUrl: vi.fn(), setCompanyInvoiceStatus: vi.fn(), setCompanyInvoiceAcknowledgedRecipient: vi.fn(),
    captureCompanyJobInvoiceIntent, createCompanyJobInvoiceOptions, assertCompanyJobInvoiceSession, assertCompanyJobInvoiceJob, validateCompanyJobInvoiceRecipientReceipt,
    Alert: { alert: vi.fn() }, fetch: vi.fn(() => { throw new Error("DENIED live I/O"); }), ...overrides,
  };
  const sandbox = vm.createContext(context);
  vm.runInContext(ts.transpileModule(`this.send = (${body});`, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText, sandbox);
  return { context, current, send: sandbox.send };
}

describe("Installed guarded invoice closure with isolated canonical collaborators", () => {
  it("one synchronous locked POST and actual acknowledged email projection", async () => {
    const h = installedScreenClosure();
    await Promise.all([h.send(), h.send()]);
    expect(h.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledTimes(1);
    expect(h.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledWith("synthetic-screen", 12, { method: "email", resend: false });
    expect(h.context.setCompanyInvoiceAcknowledgedRecipient).toHaveBeenCalledWith("on-file@example.test");
    expect(h.context.fetch).not.toHaveBeenCalled();
  });
  it("reopening sheet does not erase attempted initial; only explicit resend may send again", async () => {
    const h = installedScreenClosure(); await h.send(); await h.send();
    expect(h.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledTimes(1);
    h.context.invoiceResend = true; await h.send();
    expect(h.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledTimes(2);
  });
  it("target-failing alternate recipient is visible but no signed read or POST occurs", async () => {
    const h = installedScreenClosure({ companyInvoiceRecipientEmail: "alternate@example.test" }); await h.send();
    expect(h.context.getJobSyncMobileSession).not.toHaveBeenCalled();
    expect(h.context.sendJobSyncCompanyJobInvoice).not.toHaveBeenCalled();
    expect(h.context.Alert.alert).toHaveBeenCalledWith("Send Failed", expect.stringContaining("not passed"));
  });
  it("draft edits during signed refresh cannot alter frozen captured options", async () => {
    const wait = deferred();
    const h = installedScreenClosure({ getJobSyncMobileSession: vi.fn().mockReturnValue(wait.promise) });
    const pending = h.send(); h.context.invoiceResend = true; h.context.companyInvoiceRecipientEmail = "late@example.test";
    wait.resolve(session()); await pending;
    expect(h.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledWith("synthetic-screen", 12, { method: "email", resend: false });
  });
  it("preflight identity change prevents POST while preserving captured session and tenant checks", async () => {
    const h = installedScreenClosure({ getJobSyncMobileSession: vi.fn().mockResolvedValue({ ...session(), token: "rotated" }) });
    await h.send(); expect(h.context.sendJobSyncCompanyJobInvoice).not.toHaveBeenCalled(); expect(h.context.fetch).not.toHaveBeenCalled();
  });
  it("stale response never populates reopened sheet; acknowledged attempt is still remembered", async () => {
    const wait = deferred();
    const h = installedScreenClosure({ sendJobSyncCompanyJobInvoice: vi.fn().mockReturnValue(wait.promise) });
    const pending = h.send(); for (let i = 0; i < 8; i++) await Promise.resolve();
    h.current.value = false; wait.resolve(receipt()); await pending;
    expect(h.context.setCompanyInvoiceAcknowledgedRecipient).not.toHaveBeenCalled();
    expect(h.context.setInvoiceSentUrl).not.toHaveBeenCalledWith(receipt().publicUrl);
    h.current.value = true; await h.send();
    expect(h.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledTimes(1);
  });
  it("uncertain POST cannot be retried or bypassed with explicit resend", async () => {
    const h = installedScreenClosure({ sendJobSyncCompanyJobInvoice: vi.fn().mockRejectedValue(new Error("Synthetic timeout")) });
    await h.send(); h.context.invoiceResend = true; await h.send();
    expect(h.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledTimes(1);
    expect(h.context.fetch).not.toHaveBeenCalled();
  });
  it("invalid recipient acknowledgment stays uncertain and does not populate success", async () => {
    const h = installedScreenClosure({ sendJobSyncCompanyJobInvoice: vi.fn().mockResolvedValue({ ...receipt(), sentTo: null }) });
    await h.send(); await h.send();
    expect(h.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledTimes(1);
    expect(h.context.setInvoiceSentUrl).not.toHaveBeenCalledWith(receipt().publicUrl);
    expect(h.context.setCompanyInvoiceAcknowledgedRecipient).not.toHaveBeenCalled();
  });
});
