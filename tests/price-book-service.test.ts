import { describe, expect, it } from "vitest";

import {
  formatPriceBookServiceRate,
  getPriceBookServiceStartingPrice,
} from "../lib/price-book-service";

describe("Price Book service-first rates", () => {
  it("uses the lowest active configured service rate as the starting job price", () => {
    expect(
      getPriceBookServiceStartingPrice({
        sedan: 180,
        suv: 220,
        xl_suv_van: 260,
        truck: 240,
      }),
    ).toBe(180);
  });

  it("ignores empty, zero, and invalid rate values", () => {
    expect(
      getPriceBookServiceStartingPrice({
        sedan: 0,
        suv: null,
        truck: Number.NaN,
        rv_20_29: 325,
      }),
    ).toBe(325);
  });

  it("does not invent a price for an unpriced service", () => {
    expect(getPriceBookServiceStartingPrice({ sedan: 0, suv: 0 })).toBe(0);
    expect(formatPriceBookServiceRate({ sedan: 0, suv: 0 })).toBe("Price not set");
  });

  it("uses service-first wording for visible Price Book rates", () => {
    expect(formatPriceBookServiceRate({ sedan: 150, suv: 175 })).toBe("From $150.00");
  });
});
