export type PriceBookRateMap = Record<string, number | undefined | null>;

/**
 * Returns the lowest configured positive rate for a Price Book service.
 *
 * Legacy Price Book records can still contain several vehicle-based rates. The
 * mobile service-first New Job flow treats the lowest active rate as the
 * starting rate and keeps the existing per-job price override available.
 */
export function getPriceBookServiceStartingPrice(
  rates: PriceBookRateMap | null | undefined,
): number {
  if (!rates) return 0;
  const configuredRates = Object.values(rates).filter(
    (rate): rate is number =>
      typeof rate === "number" && Number.isFinite(rate) && rate > 0,
  );
  return configuredRates.length > 0 ? Math.min(...configuredRates) : 0;
}

/** Shows a transparent price label without exposing legacy vehicle categories. */
export function formatPriceBookServiceRate(
  rates: PriceBookRateMap | null | undefined,
): string {
  const startingPrice = getPriceBookServiceStartingPrice(rates);
  return startingPrice > 0
    ? `From $${startingPrice.toFixed(2)}`
    : "Price not set";
}
