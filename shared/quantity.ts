import type { ProductUnit } from "./types";

const NUM = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 });

/**
 * Parses a quantity into integer grams/millilitres: "500" → 500, "1,2 kg" → 1200, "1.5l" → 1500, "330 ml" → 330.
 * A bare number is grams/ml. The suffix must match the unit family (kg/g for weight, l/ml/cl for volume).
 * Returns null for empty, zero, negative or malformed input.
 */
export function parseAmount(input: string, unit: ProductUnit): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (s === "") return null;
  const m = /^(\d+(?:[.,]\d+)?)(kg|g|l|ml|cl)?$/.exec(s);
  if (!m) return null;

  const value = Number(m[1]!.replace(",", "."));
  const suffix = m[2];
  const factor: Record<string, number> = { kg: 1000, g: 1, l: 1000, ml: 1, cl: 10 };

  if (suffix) {
    const isWeight = suffix === "kg" || suffix === "g";
    if (unit === "ml" && isWeight) return null;
    if (unit === "g" && !isWeight) return null;
  }
  const amount = Math.round(value * (suffix ? factor[suffix]! : 1));
  return amount > 0 && Number.isSafeInteger(amount) ? amount : null;
}

/** 1200 g → "1,2 kg", 500 g → "500 g", 1500 ml → "1,5 l". Pieces-only products use grams. */
export function formatAmount(amount: number, unit: ProductUnit): string {
  const volume = unit === "ml";
  if (amount >= 1000) return `${NUM.format(amount / 1000)} ${volume ? "l" : "kg"}`;
  return `${NUM.format(amount)} ${volume ? "ml" : "g"}`;
}

/** "2 conf. × 6 pz", "2 conf.", "6 pz" (one package is not worth saying); "" when nothing is known. */
export function formatPackagesPieces(q: { packages: number | null; pieces: number | null }): string {
  const packages = q.packages != null && q.packages > 1 ? `${q.packages} conf.` : null;
  const pieces = q.pieces != null ? `${q.pieces} pz` : null;
  return [packages, pieces].filter(Boolean).join(" × ");
}

/** Suffix for a price per 1000 g/ml, appended to a formatted price: "2,11 €" + "/kg". */
export function perKiloSuffix(unit: ProductUnit): string {
  return unit === "ml" ? "/l" : "/kg";
}
