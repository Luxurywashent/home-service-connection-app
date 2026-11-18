import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  captureCompanyJobInvoiceIntent,
  createCompanyJobInvoiceOptions,
  normalizeCompanyJobInvoiceRecipientEmail,
} from "../lib/company-job-invoice-intent";
import {
  assertCompanyJobInvoiceRecipientCapability,
  COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY,
  createCompanyJobInvoiceAttemptGuard,
  validateCompanyJobInvoiceRecipientReceipt,
} from "../lib/company-job-invoice-recipient";

function intent(resend = false, method: "email" | "sms" = "email", recipientEmail?: string, jobId = 12) {
  return captureCompanyJobInvoiceIntent(
    { token: "synthetic-policy", portal: "company", company: { id: 9 }, user: { id: 42, role: "owner" } },
    { id: jobId, companyId: 9 },
    createCompanyJobInvoiceOptions(method, resend, recipientEmail),
  );
}
function receipt(extra: Record<string, unknown> = {}) {
  return { success: true, channel: "email", publicUrl: "https://synthetic.invalid/invoice/opaque", communicationState: "provider_accepted", sentTo: "actual@example.test", ...extra };
}

describe("Currentfc3 source support with fail-closed alternate recipient policy (historical filename retained)", () => {
  it("records final source support without declaring safe recovery or enabling alternate sending", () => {
    expect(Object.isFrozen(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY)).toBe(true);
    expect(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.backendRevision).toBe("fc3bcaa78c6288b705339bd69e2fe1539c779546");
    expect(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.wireOverrideSupported).toBe(true);
    expect(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.alternateRecipientSendingEnabled).toBe(false);
    expect(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.stableInitialReservation).toBe(true);
    expect(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.persistedRecipientAcknowledgment).toBe(true);
    expect(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.clientOperationKeySupported).toBe(true);
    expect(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.authenticatedInvoiceReadbackAvailable).toBe(true);
    expect(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.explicitResendReplaySafe).toBe(false);
    expect(COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.restartSafeUncertainOperationRecovery).toBe(false);
  });
  it.each([false, true])("blocks alternate email with explicit resend %j instead of dropping it", (resend) => {
    expect(() => assertCompanyJobInvoiceRecipientCapability(intent(resend, "email", "alternate@example.test"))).toThrow("unavailable");
  });
  it.each(["email", "sms"] as const)("preserves existing %s on-file invoices", (method) => {
    expect(() => assertCompanyJobInvoiceRecipientCapability(intent(false, method))).not.toThrow();
  });
});

describe("Captured single-attempt protection across same screen sheet resets", () => {
  it("blocks duplicate initial after successful send even when a fresh sheet captures fresh options", () => {
    const guard = createCompanyJobInvoiceAttemptGuard();
    const attempt = guard.begin(intent());
    guard.markDispatched(attempt);
    const acknowledged = validateCompanyJobInvoiceRecipientReceipt(attempt.intent, receipt());
    expect(acknowledged.acknowledgedRecipient).toBe("actual@example.test");
    guard.finish(attempt, "acknowledged");
    expect(() => guard.begin(intent())).toThrow("explicit resend");
    const explicit = guard.begin(intent(true));
    guard.markDispatched(explicit);
    guard.finish(explicit, "acknowledged");
    expect(() => guard.begin(intent())).toThrow("explicit resend");
  });
  it("pending first action synchronously blocks both initial and resend", () => {
    const guard = createCompanyJobInvoiceAttemptGuard();
    guard.begin(intent());
    expect(() => guard.begin(intent())).toThrow("pending");
    expect(() => guard.begin(intent(true))).toThrow("pending");
  });
  it.each(["uncertain", "not_dispatched"] as const)("POST timeout cannot be cleared by finish %s or bypassed by resend", (outcome) => {
    const guard = createCompanyJobInvoiceAttemptGuard();
    const attempt = guard.begin(intent());
    guard.markDispatched(attempt);
    guard.finish(attempt, outcome);
    expect(() => guard.begin(intent())).toThrow("unknown");
    expect(() => guard.begin(intent(true))).toThrow("unknown");
  });
  it("preflight cancelled before POST may start again without an explicit resend", () => {
    const guard = createCompanyJobInvoiceAttemptGuard();
    const attempt = guard.begin(intent());
    guard.finish(attempt, "not_dispatched");
    expect(() => guard.begin(intent())).not.toThrow();
  });
  it("late old cancellation cannot release the newer active attempt", () => {
    const guard = createCompanyJobInvoiceAttemptGuard();
    const first = guard.begin(intent());
    guard.finish(first, "not_dispatched");
    const second = guard.begin(intent());
    guard.finish(first, "acknowledged");
    expect(() => guard.markDispatched(first)).toThrow("no longer current");
    expect(() => guard.begin(intent(true))).toThrow("pending");
    guard.markDispatched(second);
  });
  it("isolates separate Jobs and channels but never includes the mutable draft recipient in the key", () => {
    const guard = createCompanyJobInvoiceAttemptGuard();
    guard.begin(intent());
    expect(() => guard.begin(intent(false, "email", undefined, 13))).not.toThrow();
    expect(() => guard.begin(intent(false, "sms"))).not.toThrow();
    expect(() => guard.begin(intent(false, "email", "new@example.test"))).toThrow("unavailable");
  });
});

describe("Truthful acknowledgment, no invented actual recipient or delivery", () => {
  it("backend receipt email is shown as acknowledged only; target collision instability stays unverified", () => {
    const result = validateCompanyJobInvoiceRecipientReceipt(intent(), receipt());
    expect(result.acknowledgedRecipient).toBe("actual@example.test");
    expect(result.actualRecipient).toBeNull();
    expect(result.recipientVerified).toBe(false);
    expect(result.isDelivered).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it("does not reject a valid receipt just because reused persisted recipient differs from captured override", () => {
    const result = validateCompanyJobInvoiceRecipientReceipt(intent(true, "email", "requested@example.test"), receipt());
    expect(result.acknowledgedRecipient).toBe("actual@example.test");
    expect(result.actualRecipient).toBeNull();
  });
  it.each([undefined, null, "", "invalid", "customer phone on file", 1])("missing/invalid email %j cannot be optimistic success", (sentTo) => {
    expect(() => validateCompanyJobInvoiceRecipientReceipt(intent(), receipt({ sentTo }))).toThrow("valid invoice recipient");
  });
  it.each([
    null, {}, receipt({ success: false }), receipt({ channel: "sms" }),
    receipt({ channel: undefined }), receipt({ publicUrl: " " }), receipt({ publicUrl: null }),
  ])("rejects malformed/mismatched acknowledgment %j without another send", (value) => {
    expect(() => validateCompanyJobInvoiceRecipientReceipt(intent(), value)).toThrow("did not confirm");
  });
  it.each(["queued", "sending", "provider_accepted", "failed", "bounced", "complained", "suppressed", "cancelled"])("state %s is not customer delivery", (communicationState) => {
    const result = validateCompanyJobInvoiceRecipientReceipt(intent(), receipt({ communicationState, status: "sent", isDelivered: true }));
    expect(result.communicationState).toBe(communicationState);
    expect(result.isDelivered).toBe(false);
  });
  it.each([null, "future", 1])("present invalid state %j never falls back to delivered", (communicationState) => {
    const result = validateCompanyJobInvoiceRecipientReceipt(intent(), receipt({ communicationState, status: "delivered" }));
    expect(result.communicationState).toBeNull();
    expect(result.isDelivered).toBe(false);
  });
  it.each(["sent", "delivered"])("email compatibility %s without ledger does not prove delivery", (status) => {
    const result = validateCompanyJobInvoiceRecipientReceipt(intent(), receipt({ communicationState: undefined, status }));
    expect(result.communicationState).toBeNull();
    expect(result.isDelivered).toBe(false);
  });
  it("canonical delivered alone acknowledges delivery", () => {
    expect(validateCompanyJobInvoiceRecipientReceipt(intent(), receipt({ communicationState: "delivered" })).isDelivered).toBe(true);
  });
  it("SMS retains on-file label semantics rather than inventing a phone number", () => {
    const result = validateCompanyJobInvoiceRecipientReceipt(intent(false, "sms"), receipt({ channel: "sms", sentTo: "customer phone on file" }));
    expect(result.acknowledgedRecipient).toBeNull();
    expect(result.actualRecipient).toBeNull();
  });
});

// Execute the actual controlled React component with minimal React/RN seams;
// no native render, network, API or provider imports are permitted.
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

describe("Actual recipient control default/alternate context and stale callbacks", () => {
  it("displays canonical on-file email without copying it into the optional override and explains unavailable sending", () => {
    const h = componentHarness();
    const onChange = vi.fn();
    const tree = h.render({ method: "email", value: "", disabled: false, isCurrent: () => true, onChange, defaultEmail: "canonical@example.test", sendingUnavailableReason: COMPANY_JOB_INVOICE_RECIPIENT_CAPABILITY.reason });
    const input = h.nodes(tree).find((node) => node.type === "TextInput");
    expect(input.props.value).toBe("");
    expect(input.props.returnKeyType).toBe("done");
    expect(input.props.keyboardType).toBe("email-address");
    const text = h.nodes(tree).filter((node) => node.type === "Text").flatMap((node) => node.props.children).join(" ");
    expect(text).toContain("canonical@example.test");
    expect(text).toContain("unavailable");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("alternate email reset means omitted recipient/default; focus callbacks retain parent keyboard guards", () => {
    const h = componentHarness();
    const onChange = vi.fn(); const onInputFocus = vi.fn(); const onInputBlur = vi.fn();
    const tree = h.render({ method: "email", value: "alternate@example.test", disabled: false, isCurrent: () => true, onChange, onInputFocus, onInputBlur });
    const input = h.nodes(tree).find((node) => node.type === "TextInput");
    input.props.onFocus("focus"); input.props.onBlur("blur");
    h.nodes(tree).find((node) => node.type === "TouchableOpacity").props.onPress();
    expect(onChange).toHaveBeenCalledWith("");
    expect(createCompanyJobInvoiceOptions("email", false, onChange.mock.calls[0][0])).not.toHaveProperty("recipientEmail");
    expect(onInputFocus).toHaveBeenCalledWith("focus");
    expect(onInputBlur).toHaveBeenCalledWith("blur");
  });
  it.each(["disabled", "background", "unmounted", "old props", "stale sheet"])("%s cannot mutate/reset/focus the controlled draft", (kind) => {
    const h = componentHarness(); const onChange = vi.fn(); const onInputFocus = vi.fn();
    const props = { method: "email", value: "alternate@example.test", disabled: kind === "disabled", isCurrent: () => kind !== "stale sheet", onChange, onInputFocus };
    const tree = h.render(props);
    if (kind === "background") h.context.AppState.currentState = "background";
    if (kind === "old props") h.render({ ...props, value: "new@example.test" });
    if (kind === "unmounted") { const cleanup = h.effects[0](); if (cleanup) cleanup(); }
    const input = h.nodes(tree).find((node) => node.type === "TextInput");
    input.props.onChangeText("late@example.test"); input.props.onFocus("late");
    h.nodes(tree).find((node) => node.type === "TouchableOpacity").props.onPress();
    expect(onChange).not.toHaveBeenCalled(); expect(onInputFocus).not.toHaveBeenCalled();
  });
  it("SMS does not expose email/phone override input", () => {
    const h = componentHarness();
    const tree = h.render({ method: "sms", value: "", disabled: false, isCurrent: () => true, onChange: vi.fn() });
    expect(h.nodes(tree).some((node) => node.type === "TextInput")).toBe(false);
  });
});
