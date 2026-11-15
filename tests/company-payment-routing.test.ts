import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const admin = readFileSync(new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url), "utf8");
const technician = readFileSync(new URL("../app/(tabs)/schedule.tsx", import.meta.url), "utf8");
const controller = readFileSync(new URL("../lib/company-job-checkout.ts", import.meta.url), "utf8");
const component = readFileSync(new URL("../components/company-job-checkout.tsx", import.meta.url), "utf8");
const adminCompany = admin.slice(admin.indexOf("{selectedJob && companyJobMode && <CompanyJobCheckout"), admin.indexOf("{selectedJob && !companyJobMode && (\n          <AdminCheckoutModal"));
const techStart = technician.indexOf("&& showCheckout && companyJobMode && <CompanyJobCheckout");
const technicianCompany = technician.slice(techStart, technician.indexOf("&& showCheckout && !companyJobMode && (", techStart));

describe("Company card checkout route isolation", () => {
  it("replaces only Company admin checkout and retains the legacy modal behind a separate negative guard", () => {
    expect(adminCompany.length).toBeGreaterThan(500);
    expect(adminCompany).toContain('presentation="overlay"');
    expect(adminCompany).toContain("session={jobSyncSession}");
    expect(adminCompany).toContain("jobId={positiveJobSyncId(selectedJob.id)}");
    expect(admin).toContain("{selectedJob && !companyJobMode && (\n          <AdminCheckoutModal");
  });
  it("routes technician-view Company Jobs to the shared dialog, never the copied card checkout", () => {
    expect(technicianCompany.length).toBeGreaterThan(500);
    expect(technicianCompany).toContain("session={jobSyncSession}");
    expect(technicianCompany).toContain("jobId={positiveJobSyncId(checkoutDisplayJob.id)}");
    expect(technician).toContain("&& showCheckout && !companyJobMode && (\n        <CheckoutModal");
  });
  it.each([adminCompany, technicianCompany])("contains no legacy completion or locally manufactured paid records", (section) => {
    for (const forbidden of ["onComplete", "handlePaymentComplete", "jobSavePaymentMutation", "jobStatusMutation", "paymentIntentId", "tipAmount", "trpc", "fetch(", "performance.getDateRange"]) expect(section).not.toContain(forbidden);
    expect(section).toContain("onVerifiedDetail");
    expect(section).toContain("detail.companyId");
    expect(section).toContain("detail.balance");
    expect(section).toContain("detail.paymentStatus");
  });
  it("retains admin sheet, checkout, focus and session generation boundaries for verified readback", () => {
    for (const guard of ["managementActionRef.current.mounted", "managementActionRef.current.focused", "checkoutEpochRef.current", "sheetEpochRef.current", "invoiceSessionRef.current.key", "invoiceSessionRef.current.generation"]) expect(adminCompany).toContain(guard);
  });
  it("retains technician captured-origin and Company/job checks after detail closes", () => {
    for (const guard of ["checkoutRenderOrigin !== checkoutScopeRef.current", "checkoutRenderOrigin?.isCurrent()", "job.companyId !== detail.companyId", "detail.id !== positiveJobSyncId(job.id)"]) expect(technicianCompany).toContain(guard);
    expect(technicianCompany).toContain("checkoutJobRef.current = { ...job, ...fields }");
  });
  it("uses provider-hosted entry instead of raw card forms, native credentials, or manual paid API", () => {
    expect(component).toContain("WebBrowser.openBrowserAsync");
    expect(component).toContain("Card details are entered securely in Stripe checkout");
    for (const forbidden of ["CardField", "TextInput", "cardNumber", "Card on File", "savedCards", "paymentIntentId", "TapToPayCheckout", "StripeProvider", "onComplete"]) expect(component).not.toContain(forbidden);
    expect(controller).not.toContain("/payments");
    expect(controller).not.toContain("updateJobSyncCompanyJobStatus");
  });
  it("refreshes canonical status after browser return and Android foregrounding", () => {
    expect(controller.indexOf("const after = await fresh()")).toBeGreaterThan(controller.indexOf("await input.openBrowser(checkout.url)"));
    expect(component).toContain('AppState.addEventListener("change"');
    expect(component).toContain('next === "active" && controller.hasCheckout()');
  });
});
