import type { ProductUnit } from "./types";

export type AmountSource = "measured" | "package" | "estimated";

export type ProductQuantityInfo = {
  unit: ProductUnit;
  packageAmount: number | null;
  avgPieceAmount: number | null;
};

export type ItemQuantity = { pieces: number | null; amount: number | null };

/**
 * Grams/ml bought on a line:
 * - `measured`: typed by the user (e.g. weighed bananas)
 * - `package`: pieces × declared package size (e.g. 2 × pasta 500 g) — exact
 * - `estimated`: pieces × average piece weight (e.g. 6 bananas × ~120 g)
 * null when unknown.
 */
export function resolveAmount(
  item: ItemQuantity,
  product: ProductQuantityInfo,
): { amount: number; source: AmountSource } | null {
  if (item.amount != null) return { amount: item.amount, source: "measured" };
  if (product.packageAmount != null) {
    // A packaged product with no piece count is most likely a single package, but that is a guess.
    return item.pieces != null
      ? { amount: item.pieces * product.packageAmount, source: "package" }
      : { amount: product.packageAmount, source: "estimated" };
  }
  if (item.pieces != null && product.avgPieceAmount != null) {
    return { amount: item.pieces * product.avgPieceAmount, source: "estimated" };
  }
  return null;
}

export function pricePaidCents(priceFullCents: number, discountCents: number): number {
  return priceFullCents - discountCents;
}

/** Price per 1000 g/ml in cents, rounded. null if the amount is unknown. */
export function perKiloCents(paidCents: number, amount: number | null): number | null {
  if (amount == null || amount <= 0) return null;
  return Math.round((paidCents * 1000) / amount);
}

/** Price per piece in cents, rounded. null if pieces are unknown. */
export function perPieceCents(paidCents: number, pieces: number | null): number | null {
  if (pieces == null || pieces <= 0) return null;
  return Math.round(paidCents / pieces);
}

export type UnitPrices = {
  paidCents: number;
  perKilo: { cents: number; source: AmountSource } | null;
  perPiece: number | null;
};

/** All derived prices for a receipt line. */
export function unitPrices(
  line: ItemQuantity & { priceFullCents: number; discountCents: number },
  product: ProductQuantityInfo,
): UnitPrices {
  const paidCents = pricePaidCents(line.priceFullCents, line.discountCents);
  const resolved = resolveAmount(line, product);
  const perKilo = resolved ? perKiloCents(paidCents, resolved.amount) : null;
  return {
    paidCents,
    perKilo: perKilo == null || !resolved ? null : { cents: perKilo, source: resolved.source },
    perPiece: perPieceCents(paidCents, line.pieces),
  };
}

/**
 * Whether a new line may be prefilled with the last price paid. Only for packaged products (fixed size → stable
 * price). Loose produce (bananas by weight) and per-piece items in varying packs (eggs 6 or 12) change price every
 * time: prefilling would invite saving a stale price. Quantities (pieces/amount) are never prefilled.
 */
export function shouldPrefillPrice(product: Pick<ProductQuantityInfo, "packageAmount">): boolean {
  return product.packageAmount != null;
}
