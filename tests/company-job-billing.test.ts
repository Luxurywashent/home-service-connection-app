import { describe, expect, it } from "vitest";

import {
  getCompanyJobBillingState,
  normalizeCompanyJobBillingAmount,
  normalizeCompanyJobPaymentStatus,
} from "../lib/company-job-billing";
import type { JobSyncMobileJob } from "../lib/jobsync-mobile-api";

// Existing minimal fixtures remain valid: finance is optional in the public DTO type.
const legacyFixture: JobSyncMobileJob = {
  id: 47, customerId: 17, assignedUserId: null, title: "Existing Job", serviceName: "Service",
  status: "completed", scheduledStartAt: null, scheduledEndAt: null, updatedAt: null,
  addressLine1: null, city: null, amount: 200, customerName: "Customer", assignedName: null,
};

describe("canonical Company Job billing state", () => {
  it.each([
    { name: "paid", balance: 0, paymentStatus: "paid", isPaid: true, canCollect: false },
    { name: "partial", balance: 150.25, paymentStatus: "partial", isPaid: false, canCollect: true },
    { name: "unpaid", balance: 200, paymentStatus: "unpaid", isPaid: false, canCollect: true },
    { name: "refund reopened", balance: 50, paymentStatus: "partial", isPaid: false, canCollect: true },
    { name: "fully refunded", balance: 200, paymentStatus: "unpaid", isPaid: false, canCollect: true },
    { name: "estimate-credit settled", balance: 0, paymentStatus: "paid", isPaid: true, canCollect: false },
    { name: "estimate-credit partial", balance: 120.5, paymentStatus: "partial", isPaid: false, canCollect: true },
  ])("uses canonical balance and status for $name", ({ balance, paymentStatus, isPaid, canCollect }) => {
    expect(getCompanyJobBillingState({ balance, paymentStatus })).toEqual({ balance, paymentStatus, isPaid, canCollect });
  });

  it("preserves decimal-dollar values and accepts numeric wire strings without cent conversion", () => {
    expect(getCompanyJobBillingState({ balance: " 150.25 ", paymentStatus: " partial " })).toEqual({ balance: 150.25, paymentStatus: "partial", isPaid: false, canCollect: true });
    expect(getCompanyJobBillingState({ balance: "0.00", paymentStatus: "paid" })).toEqual({ balance: 0, paymentStatus: "paid", isPaid: true, canCollect: false });
  });

  it("does not fabricate paid/unpaid state or a PaymentRecord from legacy fixture or absent finance", () => {
    expect(getCompanyJobBillingState(legacyFixture)).toEqual({ balance: null, paymentStatus: null, isPaid: null, canCollect: false });
    expect(getCompanyJobBillingState({})).toEqual({ balance: null, paymentStatus: null, isPaid: null, canCollect: false });
    expect(getCompanyJobBillingState({ balance: null, paymentStatus: null })).toEqual({ balance: null, paymentStatus: null, isPaid: null, canCollect: false });
    expect(Object.keys(getCompanyJobBillingState({ balance: 0, paymentStatus: "paid" })).sort()).toEqual(["balance", "canCollect", "isPaid", "paymentStatus"]);
  });

  it.each([undefined, null, "", " ", "bad", "0x10", "1e2", true, false, [], [0], {}, NaN, Infinity, -Infinity, -1, "-0.01"])("keeps invalid/negative money unknown: %s", (balance) => {
    expect(normalizeCompanyJobBillingAmount(balance)).toBeNull();
    expect(getCompanyJobBillingState({ balance, paymentStatus: "paid" })).toEqual({ balance: null, paymentStatus: "paid", isPaid: null, canCollect: false });
  });

  it.each([undefined, null, "", " ", "unknown", "refunded", "partially_refunded", "failed", "PAID", true, 0, {}, []])("does not authorize collection or claim paid for unknown/malformed status: %s", (paymentStatus) => {
    expect(normalizeCompanyJobPaymentStatus(paymentStatus)).toBeNull();
    for (const balance of [0, 200]) {
      expect(getCompanyJobBillingState({ balance, paymentStatus })).toEqual({ balance, paymentStatus: null, isPaid: null, canCollect: false });
    }
  });

  it.each([
    { balance: 20, paymentStatus: "paid" },
    { balance: 0, paymentStatus: "partial" },
    { balance: 0, paymentStatus: "unpaid" },
  ])("fails closed on contradictory canonical state: %o", ({ balance, paymentStatus }) => {
    expect(getCompanyJobBillingState({ balance, paymentStatus })).toEqual({ balance, paymentStatus, isPaid: null, canCollect: false });
  });

  it("does not change or mutate canonical input", () => {
    const input = Object.freeze({ balance: 50.75, paymentStatus: "partial", paidTotal: 149.25, refundTotal: 10, appliedEstimateCredit: 25 });
    expect(getCompanyJobBillingState(input)).toEqual({ balance: 50.75, paymentStatus: "partial", isPaid: false, canCollect: true });
    expect(input.paidTotal).toBe(149.25);
    expect(input.refundTotal).toBe(10);
    expect(input.appliedEstimateCredit).toBe(25);
  });
});
