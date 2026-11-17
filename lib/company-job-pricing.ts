/** Mobile pricing contracts verified against unpublished 2818bb72; no client pricing formulas. */
export type JobSyncCompanyJobLineInput = {
  priceBookItemId: number;
  quantity: number;
  vehiclePriceKey?: string | null;
};
export type JobSyncCompanyJobDiscountInput = { kind: "flat" | "percent"; value: number; code?: string };
export type JobSyncCompanyJobQuoteInput = {
  lineItems: JobSyncCompanyJobLineInput[];
  discount?: JobSyncCompanyJobDiscountInput;
};
export type JobSyncCompanyJobQuote = {
  lines: {
    priceBookItemId: number; name: string; quantity: number; unitPrice: number; lineTotal: number;
    durationMinutes: number; taxable: boolean; vehiclePriceKey: string | null;
  }[];
  subtotal: number;
  discount: number;
  discountKind: "flat" | "percent" | null;
  discountCode: string | null;
  taxableSubtotal: number;
  taxRateBps: number;
  tax: number;
  total: number;
  totalDurationMinutes: number;
  recurrence: null;
  persistence: { taxStored: true; note: string };
};
export type JobSyncCompanyJobPricing = {
  lineItems: {
    id: number; priceBookItemId: number | null; name: string; quantity: number;
    unitPrice: number; lineTotal: number; sortOrder: number;
  }[];
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number | null;
  taxRateBps: number | null;
  discountKind: "flat" | "percent" | null;
  discountCode: string | null;
  totalAmount: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)) ? value as Record<string, unknown> : null;
}
function onlyFields(row: Record<string, unknown>, fields: readonly string[]) {
  return Reflect.ownKeys(row).every(key => typeof key === "string" && fields.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(row, key)!, "value"));
}
function denseArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && Reflect.ownKeys(value).length === value.length + 1
    && Reflect.ownKeys(value).every(key => key === "length" || (typeof key === "string"
      && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")));
}
function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function money(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}
function taxRate(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10000;
}
function discountKind(value: unknown): value is "flat" | "percent" | null {
  return value === null || value === "flat" || value === "percent";
}
function discountCode(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value === value.trim() && value.length > 0 && value.length <= 80);
}

/** Copies and freezes every line and the array synchronously; never silently drops fields. */
export function normalizeCompanyJobLineItems(value: unknown): JobSyncCompanyJobLineInput[] {
  if (!denseArray(value) || value.length < 1 || value.length > 50) throw new Error("Choose between 1 and 50 Price Book services.");
  const seen = new Set<number>();
  const lines = value.map(raw => {
    const line = record(raw);
    if (!line || !onlyFields(line, ["priceBookItemId", "quantity", "vehiclePriceKey"])
      || !positiveId(line.priceBookItemId) || seen.has(line.priceBookItemId)
      || typeof line.quantity !== "number" || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 100) {
      throw new Error("Each Price Book service may appear once with a whole quantity from 1 to 100.");
    }
    seen.add(line.priceBookItemId);
    const result: JobSyncCompanyJobLineInput = { priceBookItemId: line.priceBookItemId, quantity: line.quantity };
    if (line.vehiclePriceKey !== undefined) {
      if (line.vehiclePriceKey !== null && (typeof line.vehiclePriceKey !== "string" || !line.vehiclePriceKey.trim()
        || line.vehiclePriceKey.trim().length > 64)) throw new Error("Choose a valid Price Book service rate.");
      result.vehiclePriceKey = line.vehiclePriceKey === null ? null : line.vehiclePriceKey.trim();
    }
    return Object.freeze(result);
  });
  return Object.freeze(lines) as JobSyncCompanyJobLineInput[];
}

/** Strict bounded discount intent, not an amount calculator. Blank optional codes remain intent. */
export function normalizeCompanyJobDiscount(value: unknown): JobSyncCompanyJobDiscountInput {
  const row = record(value);
  if (!row || !onlyFields(row, ["kind", "value", "code"]) || (row.kind !== "flat" && row.kind !== "percent")
    || !money(row.value) || row.value > 999999999 || (row.kind === "percent" && row.value > 100)
    || (row.code !== undefined && (typeof row.code !== "string" || row.code.trim().length > 80))) {
    throw new Error("Choose a valid flat or percent discount and optional code.");
  }
  return Object.freeze({ kind: row.kind, value: row.value, ...(row.code !== undefined ? { code: (row.code as string).trim() } : {}) });
}

/** Phase 2B quote bodies contain ONLY these fields; no customer, schedule, totals, or recurrence. */
export function normalizeCompanyJobQuoteInput(value: unknown): JobSyncCompanyJobQuoteInput {
  const row = record(value);
  if (!row || !onlyFields(row, ["lineItems", "discount"])) throw new Error("Company Job quote fields could not be verified.");
  return Object.freeze({ lineItems: normalizeCompanyJobLineItems(row.lineItems),
    ...(row.discount !== undefined ? { discount: normalizeCompanyJobDiscount(row.discount) } : {}) });
}

/** Validates a direct quote against captured intent, including injected mocked transports. */
export function normalizeCompanyJobQuote(value: unknown, input: JobSyncCompanyJobQuoteInput): JobSyncCompanyJobQuote | null {
  let bound: JobSyncCompanyJobQuoteInput;
  try { bound = normalizeCompanyJobQuoteInput(input); } catch { return null; }
  const row = record(value);
  const fields = ["lines", "subtotal", "discount", "discountKind", "discountCode", "taxableSubtotal", "taxRateBps", "tax", "total", "totalDurationMinutes", "recurrence", "persistence"];
  if (!row || !onlyFields(row, fields) || fields.some(field => !Object.hasOwn(row, field))
    || !denseArray(row.lines) || row.lines.length !== bound.lineItems.length
    || ![row.subtotal, row.discount, row.taxableSubtotal, row.tax, row.total].every(money)
    || !taxRate(row.taxRateBps) || !positiveId(row.totalDurationMinutes)
    || !discountKind(row.discountKind) || !discountCode(row.discountCode) || row.recurrence !== null
    || row.discountKind !== (bound.discount?.kind ?? null) || row.discountCode !== (bound.discount?.code || null)
    || (row.discount as number) > (row.subtotal as number) || (row.taxableSubtotal as number) > (row.subtotal as number)
    || (!bound.discount && row.discount !== 0)) return null;
  const persistence = record(row.persistence);
  if (!persistence || !onlyFields(persistence, ["taxStored", "note"]) || persistence.taxStored !== true
    || typeof persistence.note !== "string" || !persistence.note.trim()) return null;
  const lines: JobSyncCompanyJobQuote["lines"] = [];
  for (let index = 0; index < row.lines.length; index++) {
    const line = record(row.lines[index]);
    const expected = bound.lineItems[index];
    if (!line || !onlyFields(line, ["priceBookItemId", "name", "quantity", "unitPrice", "lineTotal", "durationMinutes", "taxable", "vehiclePriceKey"])
      || line.priceBookItemId !== expected.priceBookItemId || line.quantity !== expected.quantity
      || line.vehiclePriceKey !== (expected.vehiclePriceKey ?? null) || typeof line.name !== "string"
      || !money(line.unitPrice) || !money(line.lineTotal) || !positiveId(line.durationMinutes) || typeof line.taxable !== "boolean") return null;
    lines.push(Object.freeze({ priceBookItemId: expected.priceBookItemId, quantity: expected.quantity,
      name: line.name, unitPrice: line.unitPrice, lineTotal: line.lineTotal, durationMinutes: line.durationMinutes,
      taxable: line.taxable, vehiclePriceKey: line.vehiclePriceKey as string | null }));
  }
  return Object.freeze({ lines: Object.freeze(lines) as JobSyncCompanyJobQuote["lines"], subtotal: row.subtotal as number,
    discount: row.discount as number, discountKind: row.discountKind, discountCode: row.discountCode,
    taxableSubtotal: row.taxableSubtotal as number, taxRateBps: row.taxRateBps, tax: row.tax as number, total: row.total as number,
    totalDurationMinutes: row.totalDurationMinutes, recurrence: null,
    persistence: Object.freeze({ taxStored: true as const, note: persistence.note }) });
}

/** 2818 detail/create retain stored snake-case columns via SELECT j.*; not a new wire field. */
function persistedTaxValue(
  row: Record<string, unknown>, field: "taxAmount" | "taxRateBps", storedField: "tax_amount" | "tax_rate_bps",
  validate: (value: unknown) => value is number, requireStoredTaxEvidence: boolean,
): number | null | undefined {
  const canonical = row[field];
  if (!Object.hasOwn(row, storedField)) return requireStoredTaxEvidence ? null : canonical as number | null | undefined ?? null;
  const stored = row[storedField];
  // The backend currently projects these unavailable values as zero. Do not repeat that claim.
  if (stored === null || stored === undefined) return null;
  const numeric = typeof stored === "string" && /^\d+(?:\.\d+)?$/.test(stored) ? Number(stored) : stored;
  if (!validate(numeric) || (canonical !== null && canonical !== undefined && canonical !== numeric)) return undefined;
  // Never fill a missing canonical value from a storage alias or calculate an amount.
  return canonical as number | null | undefined ?? null;
}

/**
 * Read ONLY canonical root pricing. undefined = legacy absent; null = present malformed.
 * Missing/null tax fields are unavailable, not synthesized zero. Stored null overrides false canonical zero.
 * Parent adapters must require stored evidence for 2818 detail/create/replay: its DTO has no availability flag.
 * Default remains compatible with normalized pricing and pre-existing canonical-only fixtures.
 */
export function normalizeCompanyJobPricing(value: unknown, options: { requireStoredTaxEvidence?: boolean } = {}): JobSyncCompanyJobPricing | null | undefined {
  const row = record(value);
  if (!row) return null;
  const fields = ["lineItems", "subtotalAmount", "discountAmount", "taxAmount", "taxRateBps", "discountKind", "discountCode"];
  if (!fields.some(field => Object.hasOwn(row, field))) return undefined;
  if (!denseArray(row.lineItems) || !money(row.subtotalAmount) || !money(row.discountAmount) || !money(row.amount)
    || row.discountAmount > row.subtotalAmount
    || (row.taxAmount !== undefined && row.taxAmount !== null && !money(row.taxAmount))
    || (row.taxRateBps !== undefined && row.taxRateBps !== null && !taxRate(row.taxRateBps))
    || (row.discountKind !== undefined && !discountKind(row.discountKind))
    || (row.discountCode !== undefined && !discountCode(row.discountCode))) return null;
  const taxAmount = persistedTaxValue(row, "taxAmount", "tax_amount", money, options.requireStoredTaxEvidence === true);
  const taxRateBps = persistedTaxValue(row, "taxRateBps", "tax_rate_bps", taxRate, options.requireStoredTaxEvidence === true);
  if (taxAmount === undefined || taxRateBps === undefined) return null;
  const seen = new Set<number>();
  const lines: JobSyncCompanyJobPricing["lineItems"] = [];
  for (const raw of row.lineItems) {
    const line = record(raw);
    if (!line || !positiveId(line.id) || seen.has(line.id)
      || (line.priceBookItemId !== null && !positiveId(line.priceBookItemId)) || typeof line.name !== "string"
      || typeof line.quantity !== "number" || !Number.isFinite(line.quantity) || line.quantity <= 0
      || !money(line.unitPrice) || !money(line.lineTotal) || typeof line.sortOrder !== "number"
      || !Number.isSafeInteger(line.sortOrder) || line.sortOrder < 0
      || (lines.length > 0 && line.sortOrder < lines[lines.length - 1].sortOrder)) return null;
    seen.add(line.id);
    lines.push(Object.freeze({ id: line.id, priceBookItemId: line.priceBookItemId as number | null, name: line.name,
      quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal, sortOrder: line.sortOrder }));
  }
  return Object.freeze({ lineItems: Object.freeze(lines) as JobSyncCompanyJobPricing["lineItems"],
    subtotalAmount: row.subtotalAmount, discountAmount: row.discountAmount, taxAmount, taxRateBps,
    discountKind: row.discountKind as JobSyncCompanyJobPricing["discountKind"] | undefined ?? null,
    discountCode: row.discountCode as string | null | undefined ?? null, totalAmount: row.amount });
}

/** Exact line order/quantity and complete persisted tax evidence, never a quote-price lock. */
export function companyJobPricingMatchesInput(pricing: JobSyncCompanyJobPricing | undefined, input: JobSyncCompanyJobQuoteInput): boolean {
  try {
    const source = record(pricing);
    if (!source || !Object.hasOwn(source, "discountKind") || !Object.hasOwn(source, "discountCode")) return false;
    const bound = normalizeCompanyJobQuoteInput(input);
    const verified = normalizeCompanyJobPricing({ ...source, amount: source.totalAmount });
    if (!verified || verified.taxAmount === null || verified.taxRateBps === null || verified.lineItems.length !== bound.lineItems.length
      || verified.discountKind !== (bound.discount?.kind ?? null) || verified.discountCode !== (bound.discount?.code || null)) return false;
    return verified.lineItems.every((line, index) => line.priceBookItemId === bound.lineItems[index].priceBookItemId
      && line.quantity === bound.lineItems[index].quantity);
  } catch { return false; }
}
