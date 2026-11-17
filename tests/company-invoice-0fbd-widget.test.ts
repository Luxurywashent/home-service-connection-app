import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { normalizeCompanyJobInvoiceRecipientEmail, captureCompanyJobInvoiceIntent, createCompanyJobInvoiceOptions, assertCompanyJobInvoiceJob, assertCompanyJobInvoiceSession } from "../lib/company-job-invoice-intent";
import { COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY, validateCompanyJobInvoiceRecipientReceipt, createCompanyJobInvoiceAttemptGuard } from "../lib/company-job-invoice-recipient";

function componentHarness() {
  const file = "/home/ubuntu/home-service-connection-app/components/company-job-invoice-recipient.tsx";
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "CompanyJobInvoiceRecipient");
  if (!component) throw new Error("Missing authoritative invoice component");
  const effects: (() => void | (() => void))[] = [];
  const refs: any[] = [];
  let cursor = 0;
  const context = vm.createContext({
    React: { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) },
    useRef: (value: any) => refs[cursor++] ?? (refs[cursor - 1] = { current: value }),
    useLayoutEffect: (effect: () => void) => effect(),
    useEffect: (effect: () => void | (() => void)) => effects.push(effect),
    useJobSheetColors: () => ({ foreground: "black", muted: "gray", warning: "orange" }),
    AppState: { currentState: "active" }, Text: "Text", View: "View", TextInput: "TextInput", TouchableOpacity: "TouchableOpacity", styles: {},
    normalizeCompanyJobInvoiceRecipientEmail,
    fetch: () => { throw new Error("DENIED network"); }, require: () => { throw new Error("DENIED imports"); }, process: { env: {} },
  });
  vm.runInContext(ts.transpileModule(component.getText(tree).replace(/^export\s+/, ""), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText, context);
  const nodes = (node: any): any[] => !node || typeof node !== "object" ? [] : [node, ...(node.props?.children.flat(Infinity) ?? []).flatMap(nodes)];
  const render = (props: any) => { cursor = 0; return context.CompanyJobInvoiceRecipient(props); };
  return { context, effects, render, nodes };
}

function intent(resend = false, method: "email" | "sms" = "email") {
  return captureCompanyJobInvoiceIntent({ token: "synthetic", portal: "company", company: { id: 9 }, user: { id: 42, role: "owner" } }, { id: 12, companyId: 9 }, createCompanyJobInvoiceOptions(method, resend));
}
function receipt(extra: Record<string, unknown> = {}) {
  return { success: true, publicUrl: "https://synthetic.invalid/invoice/opaque", channel: "email", communicationState: "provider_accepted", sentTo: "actual@example.test", ...extra };
}

describe("0fbd controlled recipient and unchanged authority fences", () => {
  it.each(["", "draft@example.test"])("canonical default change never copies or replaces controlled value %j", value => {
    const h = componentHarness(); const onChange = vi.fn();
    const props = { method: "email", value, disabled: false, isCurrent: () => true, onChange, defaultEmail: "canonical@example.test", sendingUnavailableReason: COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.reason };
    h.render(props); const tree = h.render({ ...props, defaultEmail: "changed@example.test" });
    expect(h.nodes(tree).find(n => n.type === "TextInput").props.value).toBe(value);
    const text = h.nodes(tree).filter(n => n.type === "Text").flatMap(n => n.props.children).join(" ");
    expect(text).toContain("changed@example.test"); expect(text).toContain("no authenticated mobile"); expect(text).toContain("Blank still uses the contact on file");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("reset uses omitted on-file recipient and forwards current focus/blur", () => {
    const h = componentHarness(); const onChange = vi.fn(); const onInputFocus = vi.fn(); const onInputBlur = vi.fn();
    const tree = h.render({ method: "email", value: "draft@example.test", disabled: false, isCurrent: () => true, onChange, onInputFocus, onInputBlur });
    const input = h.nodes(tree).find(n => n.type === "TextInput");
    input.props.onFocus("focus"); input.props.onBlur("blur"); h.nodes(tree).find(n => n.type === "TouchableOpacity").props.onPress();
    expect(onInputFocus).toHaveBeenCalledWith("focus"); expect(onInputBlur).toHaveBeenCalledWith("blur"); expect(onChange).toHaveBeenCalledWith("");
    expect(createCompanyJobInvoiceOptions("email", false, onChange.mock.calls[0][0])).not.toHaveProperty("recipientEmail");
  });
  it.each(["busy", "background", "unmounted", "new props", "changed authority"])("%s blocks late draft/reset/focus/blur callbacks", kind => {
    const h = componentHarness(); const onChange = vi.fn(); const onInputFocus = vi.fn(); const onInputBlur = vi.fn(); let authorized = true;
    const props = { method: "email", value: "draft@example.test", disabled: kind === "busy", isCurrent: () => authorized, onChange, onInputFocus, onInputBlur };
    const tree = h.render(props);
    if (kind === "background") h.context.AppState.currentState = "background";
    if (kind === "changed authority") authorized = false;
    if (kind === "new props") h.render({ ...props, value: "other@example.test" });
    if (kind === "unmounted") { const cleanup = h.effects[0](); if (cleanup) cleanup(); }
    const input = h.nodes(tree).find(n => n.type === "TextInput"); input.props.onChangeText("late@example.test"); input.props.onFocus("late"); input.props.onBlur("late");
    h.nodes(tree).find(n => n.type === "TouchableOpacity").props.onPress();
    expect(onChange).not.toHaveBeenCalled(); expect(onInputFocus).not.toHaveBeenCalled(); expect(onInputBlur).not.toHaveBeenCalled();
  });
  it("SMS has no override input", () => {
    const h = componentHarness(); const tree = h.render({ method: "sms", value: "", disabled: false, isCurrent: () => true, onChange: vi.fn() });
    expect(h.nodes(tree).some(n => n.type === "TextInput")).toBe(false);
  });
});

describe("0fbd receipt does not invent delivery or runtime revision certification", () => {
  it.each(["queued", "sending", "provider_accepted", "failed", "bounced", "complained", "suppressed", "cancelled"])("%s is not delivery despite compatibility sent/isDelivered true", state => {
    const result = validateCompanyJobInvoiceRecipientReceipt(intent(), receipt({ communicationState: state, status: "sent", isDelivered: true }));
    expect(result.communicationState).toBe(state); expect(result.isDelivered).toBe(false); expect(result.acknowledgedRecipient).toBe("actual@example.test");
    expect(result.recipientVerified).toBe(false); expect(result.actualRecipient).toBeNull();
  });
  it.each([null, "unsupported", 1, undefined])("invalid ledger %j cannot fall back to delivered", communicationState => {
    const result = validateCompanyJobInvoiceRecipientReceipt(intent(), receipt({ communicationState, status: "delivered", isDelivered: true }));
    expect(result.communicationState).toBeNull(); expect(result.isDelivered).toBe(false);
  });
  it.each([null, undefined, "", "invalid", "customer phone on file", 1])("invalid email ack %j is not success", sentTo => {
    expect(() => validateCompanyJobInvoiceRecipientReceipt(intent(), receipt({ sentTo }))).toThrow("valid invoice recipient");
  });
  it("only canonical delivered confirms delivery; SMS cannot invent a destination", () => {
    expect(validateCompanyJobInvoiceRecipientReceipt(intent(), receipt({ communicationState: "delivered" })).isDelivered).toBe(true);
    expect(validateCompanyJobInvoiceRecipientReceipt(intent(false, "sms"), receipt({ channel: "sms", sentTo: "customer phone on file" })).acknowledgedRecipient).toBeNull();
  });
});

describe("Existing Company/session/Job and single-screen locks", () => {
  it.each(["technician", "admin", "developer"])("%s cannot capture Company invoice", role => {
    expect(() => captureCompanyJobInvoiceIntent({ token: "synthetic", portal: "company", company: { id: 9 }, user: { id: 42, role } }, { id: 12, companyId: 9 }, createCompanyJobInvoiceOptions())).toThrow("signed manager");
  });
  it("changed token/actor/role/Company/Job identities are rejected", () => {
    const i = intent(); const session = { token: "synthetic", portal: "company", company: { id: 9 }, user: { id: 42, role: "owner" } };
    for (const fresh of [{ ...session, token: "rotated" }, { ...session, company: { id: 99 } }, { ...session, user: { id: 43, role: "owner" } }, { ...session, user: { id: 42, role: "dispatcher" } }]) expect(() => assertCompanyJobInvoiceSession(i, fresh)).toThrow("identity changed");
    for (const detail of [{ id: 13, companyId: 9 }, { id: 12, companyId: 99 }]) expect(() => assertCompanyJobInvoiceJob(i, detail)).toThrow("originating");
  });
  it.each(["uncertain", "not_dispatched"] as const)("dispatch finish %s cannot unlock unknown or resend", outcome => {
    const guard = createCompanyJobInvoiceAttemptGuard(); const attempt = guard.begin(intent()); guard.markDispatched(attempt); guard.finish(attempt, outcome);
    expect(() => guard.begin(intent())).toThrow("unknown"); expect(() => guard.begin(intent(true))).toThrow("unknown");
  });
  it("old callback cannot release newer active attempt", () => {
    const guard = createCompanyJobInvoiceAttemptGuard(); const first = guard.begin(intent()); guard.finish(first, "not_dispatched"); const second = guard.begin(intent());
    guard.finish(first, "acknowledged"); expect(() => guard.markDispatched(first)).toThrow("no longer current"); expect(() => guard.begin(intent(true))).toThrow("pending"); guard.markDispatched(second);
  });
});
