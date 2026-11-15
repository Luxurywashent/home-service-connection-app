import React from "react";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { renderToStaticMarkup } = require("react-dom/server") as { renderToStaticMarkup: (node: React.ReactNode) => string };

const fixture = vi.hoisted(() => ({
  colors: { background: "#07111F", surface: "#102038", border: "#243754", foreground: "#f6f8fc", muted: "#94a3b8", primary: "#4d8dff", success: "#52d3b8", error: "#f06a6a", warning: "#f2b84b" },
  session: null as any,
}));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => fixture.colors }));
vi.mock("@/lib/jobsync-auth-context", () => ({ useJobSyncAuth: () => ({ session: fixture.session }) }));
vi.mock("@/lib/jobsync-mobile-api", () => ({ getJobSyncCompanyCustomers: vi.fn() }));
vi.mock("@expo/vector-icons/MaterialIcons", () => ({ default: ({ name }: any) => React.createElement("span", null, name) }));
vi.mock("react-native", () => {
  const host = (tag: string) => ({ children, disabled, style, accessibilityLabel }: any) => React.createElement(tag, { disabled, "aria-label": accessibilityLabel, "data-style": JSON.stringify(style) }, children);
  return { View: host("div"), Text: host("span"), TouchableOpacity: host("button"), ActivityIndicator: host("i"), StyleSheet: { create: (x: any) => x, hairlineWidth: 1 }, Alert: { alert: vi.fn() }, Linking: { openURL: vi.fn() } };
});
import { useJobSheetColors } from "../hooks/use-job-sheet-colors";
import { CompanyJobLineItems } from "../components/company-job-line-items";
import { CustomerContactActions } from "../components/customer-contact-actions";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function jobModal(path: string) {
  const text = source(path);
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  expect(ts.transpileModule(text, { fileName: path, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX } }).diagnostics).toEqual([]);
  const matches: ts.JsxElement[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === "Modal" && node.getText(sf).includes("CompanyJobProgress")) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sf);
  expect(matches).toHaveLength(1);
  return { text, modal: matches[0].getText(sf), outside: text.slice(0, matches[0].getStart(sf)) + text.slice(matches[0].end) };
}

beforeEach(() => { fixture.colors.background = "#07111F"; fixture.session = null; });
describe("original Job Detail sheet restoration", () => {
  for (const path of ["app/(tabs)/schedule.tsx", "app/(tabs)/admin-schedule.tsx"]) {
    it(`${path}: renders shared circular progress before Customer with the existing job/session context`, () => {
      const { modal } = jobModal(path);
      const progress = modal.indexOf("<CompanyJobProgress");
      const customer = modal.indexOf("CUSTOMER");
      expect(progress).toBeGreaterThan(0);
      expect(progress).toBeLessThan(customer);
      expect(modal).toContain("session={jobSyncSession} job={companyJob} timezone={companyTimezone} onRefresh={refreshCompanyJob}");
      expect(modal).toContain("<CompanyJobLineItems amount={selectedJob.price} balance={selectedJob.balance} paymentStatus={selectedJob.paymentStatus}");
      expect(modal).toContain("requireCompanyProfile={isJobSyncCompany} jobSheet");
      expect(modal).not.toContain("Server balance:");
      expect(modal).not.toContain("Backend status:");
    });
    it(`${path}: confines reference colors to the Job Detail modal`, () => {
      const { modal, outside } = jobModal(path);
      expect(modal).toContain("jobSheetColors.background");
      expect(modal).not.toMatch(/\bcolors\./);
      expect(outside).not.toContain("jobSheetColors.");
      expect(outside).toContain("const colors = useColors()");
    });
  }
  it("keeps the established dark sheet palette separate from the global palette", () => {
    const colors = useJobSheetColors();
    expect(colors).toMatchObject({ background: "#101319", surface: "#1c2028", border: "#2e333c", primary: "#0068ff" });
    expect(fixture.colors.background).toBe("#07111F");
    expect(colors.success).toBe(fixture.colors.success);
  });
  it("leaves light preferences untouched", () => {
    fixture.colors.background = "#ffffff";
    expect(useJobSheetColors()).toBe(fixture.colors);
  });
  it("shows the original concise totals using canonical balance rather than inferred payment math", () => {
    const html = renderToStaticMarkup(<CompanyJobLineItems amount={200} balance={123} paymentStatus="partial" paidTotal={70} appliedEstimateCredit={10} />);
    expect(html).toContain("Line Items");
    expect(html).toContain("Job Total");
    expect(html).toContain("Balance Due");
    expect(html).toContain("$123.00");
    expect(html).not.toContain("$120.00");
    expect(html).not.toContain("Server balance");
  });
  it("does not invent a zero balance for missing or malformed billing data", () => {
    for (const balance of [undefined, NaN, -1]) {
      const html = renderToStaticMarkup(<CompanyJobLineItems amount={200} balance={balance} paymentStatus="unpaid" />);
      expect(html).toContain("Unavailable");
      expect(html).not.toContain("Paid in Full");
      expect(html).not.toContain("$0.00");
    }
  });
  it("only shows Paid in Full when status and zero balance agree", () => {
    expect(renderToStaticMarkup(<CompanyJobLineItems amount={200} balance={0} paymentStatus="paid" />)).toContain("Paid in Full");
    expect(renderToStaticMarkup(<CompanyJobLineItems amount={200} balance={200} paymentStatus="paid" />)).not.toContain("Paid in Full");
  });
  it("restores job-sheet contact labels and keeps unavailable phone actions disabled", () => {
    const ready = renderToStaticMarkup(<CustomerContactActions phone="+1 202 555 0101" requireCompanyProfile={false} jobSheet />);
    expect(ready).toContain("Call Customer");
    expect(ready).toContain("Message Customer");
    expect(ready).toContain("Customer phone:");
    expect(ready).not.toContain('disabled=""');
    const missing = renderToStaticMarkup(<CustomerContactActions requireCompanyProfile={false} jobSheet />);
    expect(missing.match(/disabled=""/g)).toHaveLength(2);
    expect(missing).toContain("No phone number");
  });
  it("never uses the legacy phone fallback for a Company contact", () => {
    const html = renderToStaticMarkup(<CustomerContactActions phone="+1 202 555 0101" customerId="52" requireCompanyProfile jobSheet />);
    expect(html).not.toContain("202 555 0101");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
