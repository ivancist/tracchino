import type { ProductUnit } from "./types";

export type AmountSource = "measured" | "package" | "estimated";

export type ProductQuantityInfo = {
  unit: ProductUnit;
  packageAmount: number | null;
  avgPieceAmount: number | null;
};

/**
 * A receipt line's quantity: `packages` bought (2 jars of passata), `pieces` in each package (eggs 6P) or loose pieces
 * (6 bananas), `amount` grams/ml if weighed. Packages and pieces are different things: 2 packs of 6 eggs = 12 eggs.
 */
export type ItemQuantity = { packages: number | null; pieces: number | null; amount: number | null };

/** Pieces bought in total: pieces × packages (a missing package count is one package). null if pieces are unknown. */
export function totalPieces(item: Pick<ItemQuantity, "packages" | "pieces">): number | null {
  return item.pieces == null ? null : item.pieces * (item.packages ?? 1);
}

/**
 * Grams/ml bought on a line:
 * - `measured`: typed by the user (e.g. weighed bananas)
 * - `package`: packages × declared package size (e.g. 2 × pasta 500 g) — exact
 * - `estimated`: one package assumed when the count is missing, or total pieces × average piece weight (6 bananas × ~120 g)
 * null when unknown.
 */
export function resolveAmount(
  item: ItemQuantity,
  product: ProductQuantityInfo,
): { amount: number; source: AmountSource } | null {
  if (item.amount != null) return { amount: item.amount, source: "measured" };
  if (product.packageAmount != null) {
    // A packaged product with no package count is most likely a single package, but that is a guess.
    return item.packages != null
      ? { amount: item.packages * product.packageAmount, source: "package" }
      : { amount: product.packageAmount, source: "estimated" };
  }
  const pieces = totalPieces(item);
  if (pieces != null && product.avgPieceAmount != null) {
    return { amount: pieces * product.avgPieceAmount, source: "estimated" };
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

/** Price per package in cents, rounded; only when more than one package was bought (otherwise it is the line price). */
export function perPackageCents(paidCents: number, packages: number | null): number | null {
  return packages != null && packages > 1 ? Math.round(paidCents / packages) : null;
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
    perPiece: perPieceCents(paidCents, totalPieces(line)),
  };
}

/**
 * Whether a new line may be prefilled with the last price paid. Only for packaged products (fixed size → stable
 * price). Loose produce (bananas by weight) and per-piece items in varying packs (eggs 6 or 12) change price every
 * time: prefilling would invite saving a stale price. Quantities (packages/pieces/amount) are never prefilled.
 */
export function shouldPrefillPrice(product: Pick<ProductQuantityInfo, "packageAmount">): boolean {
  return product.packageAmount != null;
}
