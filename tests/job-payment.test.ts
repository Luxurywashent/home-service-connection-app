import { describe, expect, it } from "vitest";

import { calculateJobCollectionAmount, shouldShowCollectPayment } from "../lib/job-payment";

describe("job payment action", () => {
  it("offers collection for unpaid and refunded jobs", () => {
    expect(shouldShowCollectPayment(undefined)).toBe(true);
    expect(shouldShowCollectPayment({ refundedAt: "2026-10-04T01:00:00.000Z" })).toBe(true);
  });

  it("hides collection after a non-refunded payment", () => {
    expect(shouldShowCollectPayment({})).toBe(false);
  });

  it("calculates a non-negative amount due", () => {
    expect(calculateJobCollectionAmount(125, 30, 10)).toBe(145);
    expect(calculateJobCollectionAmount(20, 0, 30)).toBe(0);
  });
});
