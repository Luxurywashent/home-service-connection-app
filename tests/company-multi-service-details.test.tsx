import React from "react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { CompanyJobLineItems } from "../components/company-job-line-items";
import type { JobSyncCompanyJobPricing } from "../lib/jobsync-mobile-api";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup: (node: React.ReactNode) => string };
vi.mock("@/hooks/use-job-sheet-colors", () => ({ useJobSheetColors: () => ({ background: "#101319", surface: "#1c2028", foreground: "#f8fafc", muted: "#a5a9b2", primary: "#0068ff", border: "#2e333c", success: "#22c55e", error: "#ef4444" }) }));
vi.mock("react-native", () => {
  const host = (name: string) => {
    const Host = ({ children, testID, accessibilityLabel, accessibilityRole }: any) => React.createElement(name, { "data-testid": testID, "aria-label": accessibilityLabel, role: accessibilityRole }, children);
    Host.displayName = name;
    return Host;
  };
  return { View: host("div"), Text: host("span"), StyleSheet: { create: (x: any) => x, hairlineWidth: 1 } };
});
const pricing: JobSyncCompanyJobPricing = {
  lineItems: [
    { id: 801, priceBookItemId: 1105, name: "Sample Window Cleaning", quantity: 1, unitPrice: 249.5, lineTotal: 249.5, sortOrder: 0 },
    { id: 802, priceBookItemId: 1106, name: "Sample Gutter Cleaning", quantity: 2, unitPrice: 100, lineTotal: 200, sortOrder: 1 },
  ],
  subtotalAmount: 449.5, discountAmount: 44.95, taxAmount: 33.38, taxRateBps: 825,
  discountKind: "percent", discountCode: "SAMPLE10", totalAmount: 437.93,
};
const display = (props: Partial<React.ComponentProps<typeof CompanyJobLineItems>> = {}) => renderToStaticMarkup(<CompanyJobLineItems amount={437.93} balance={237.93} paymentStatus="partial" pricing={pricing} {...props} />);
describe("persisted multi-service Job detail presentation", () => {
  it("displays every persisted service, quantities, unit prices and server line totals", () => {
    const html = display();
    expect(html).toContain("Sample Window Cleaning"); expect(html).toContain("Sample Gutter Cleaning");
    expect(html).toContain("Quantity 2"); expect(html).toContain("Unit price $100.00");
    expect(html).toContain("$249.50"); expect(html).toContain("$200.00");
    expect(html).toContain("company-persisted-service-801"); expect(html).toContain("company-persisted-service-802");
  });
  it("shows authoritative subtotal, discount, tax, total and canonical balance without deriving payment values", () => {
    const html = display({ amount: 999, paidTotal: 200 });
    for (const value of ["Subtotal", "$449.50", "Discount (percentage)", "SAMPLE10", "$44.95", "Tax", "$33.38", "$437.93", "$237.93"]) expect(html).toContain(value);
    expect(html).not.toContain("$999.00"); expect(html).not.toContain("$799.00");
  });
  it("does not present stale persisted rows while detail is loading or unavailable", () => {
    const loading = display({ pricingLoading: true }); expect(loading).toContain("Loading saved service details"); expect(loading).not.toContain("Sample Gutter Cleaning");
    const error = display({ pricingError: "Refresh this Job." }); expect(error).toContain("Refresh this Job."); expect(error).not.toContain("Sample Gutter Cleaning");
  });
  it("preserves historical single-service presentation without fabricating a tax breakdown", () => {
    const html = display({ pricing: undefined }); expect(html).toContain("Service Total"); expect(html).toContain("$437.93");
    expect(html).not.toContain("Subtotal"); expect(html).not.toContain("Tax"); expect(html).not.toContain("Sample Gutter Cleaning");
  });
  it("marks missing historical tax unavailable instead of inferring a zero tax", () => {
    const html = display({ pricing: { ...pricing, taxAmount: null, taxRateBps: null } });
    expect(html).toContain("Tax"); expect(html).toContain("Unavailable"); expect(html).not.toContain("$0.00");
  });
  it("shows a server flat discount code and keeps unknown payment balance unavailable", () => {
    const html = display({ balance: undefined, pricing: { ...pricing, discountKind: "flat", discountCode: "SAMPLE-FLAT" } });
    expect(html).toContain("Discount (flat)"); expect(html).toContain("SAMPLE-FLAT"); expect(html).toContain("Balance Due"); expect(html).toContain("Unavailable");
  });
  for (const path of ["app/(tabs)/schedule.tsx", "app/(tabs)/admin-schedule.tsx"]) {
    it(`${path} passes only fresh same-Job same-Company scoped detail pricing`, () => {
      const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      expect(source).toContain("pricing={!companyJob.loading && !companyJob.pending && !companyJob.error && companyJob.detail?.id === companyPhotoJobId && companyJob.detail?.companyId === jobSyncSession?.company?.id ? companyJob.detail?.pricing : null}");
      expect(source).toContain("pricingLoading={companyJob.loading || companyJob.pending}");
    });
  }
});
