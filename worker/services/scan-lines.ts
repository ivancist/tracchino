// Deterministic clean-up of the lines a model read from a receipt, before matching.
import { normalizeRawText, piecesHint } from "../../shared/receipt-text";
import type { ExtractedLine } from "./ai/types";

/** A line as shown on the review screen: packages bought, pieces in each package (printed, e.g. "UOVA 6P"). */
export type ReviewLine = {
  rawText: string;
  priceCents: number;
  discountCents: number;
  packages: number;
  pieces: number | null;
  amountGrams: number | null;
};

/**
 * A printed quantity row ("2 PZ x 1,99 EUR/PZ") is transcribed by the model as its own line (kind "quantity") and attached
 * here to its product: the one below (where Italian receipts print it), else the one above, and only if quantity × unit
 * price is that product's amount. Without a unit price it goes to the product below. A row that fits nowhere is dropped.
 * Returns product lines only.
 */
export function attachQuantityLines(lines: ExtractedLine[]): ExtractedLine[] {
  const out = lines.map((l) => ({ ...l }));
  const isProduct = (l: ExtractedLine | undefined): l is ExtractedLine => l?.kind === "product";
  out.forEach((q, i) => {
    if (q.kind !== "quantity" || q.quantity == null) return;
    const below = out.slice(i + 1).find(isProduct);
    const above = out.slice(0, i).reverse().find(isProduct);
    const free = (p: ExtractedLine | undefined): p is ExtractedLine => p != null && p.quantity == null;
    const owner =
      q.unitPriceCents == null
        ? [below].find(free)
        : [below, above].find((p) => free(p) && (p.priceCents || q.priceCents) === q.quantity! * q.unitPriceCents!);
    if (!owner) return;
    owner.quantity = q.quantity;
    owner.unitPriceCents = q.unitPriceCents;
    owner.priceCents ||= q.priceCents; // a few chains print the amount on the quantity row
  });
  return out.filter(isProduct);
}

/**
 * A quantity on a product line must add up with its unit price (the model may still put a quantity row on the wrong
 * neighbour): if not, it moves to the adjacent line it adds up to, or is dropped. A quantity without a unit price is kept.
 */
export function fixQuantities(lines: ExtractedLine[]): ExtractedLine[] {
  const out = lines.map((l) => ({ ...l }));
  for (let i = 0; i < out.length; i++) {
    const l = out[i]!;
    if (l.quantity == null || l.unitPriceCents == null) continue;
    const total = l.quantity * l.unitPriceCents;
    if (total === l.priceCents) continue;
    const owner = [out[i + 1], out[i - 1]].find((n) => n && n.quantity == null && n.priceCents === total);
    if (owner) {
      owner.quantity = l.quantity;
      owner.unitPriceCents = l.unitPriceCents;
    }
    l.quantity = null;
    l.unitPriceCents = null;
  }
  return out;
}

/**
 * Model lines → review lines, one per printed item: quantity rows attached and checked. Every printed item is at least
 * one package ("2 PZ x" → 2); pieces per package come from the text only ("UOVA 6P" → 6), never from a quantity row.
 */
export function prepareLines(lines: ExtractedLine[]): ReviewLine[] {
  return fixQuantities(attachQuantityLines(lines)).map((l) => ({
    rawText: l.rawText,
    priceCents: l.priceCents,
    discountCents: l.discountCents,
    packages: l.quantity ?? 1,
    pieces: piecesHint(l.rawText),
    amountGrams: l.amountGrams,
  }));
}

/**
 * The same printed item scanned twice is one purchase of 2 packages: lines with the same normalised text are merged
 * into the first one, consecutive or not. Prices, discounts and packages add up; pieces per package stay as they are
 * ("UOVA 6P" twice → 2 packages of 6). Weighed lines merge only with weighed lines (grams add up).
 */
export function mergeDuplicateLines(lines: ReviewLine[]): ReviewLine[] {
  const out: ReviewLine[] = [];
  const byKey = new Map<string, ReviewLine[]>();
  for (const line of lines) {
    const key = normalizeRawText(line.rawText);
    const same = byKey.get(key) ?? [];
    const target = same.find((t) => (t.amountGrams == null) === (line.amountGrams == null) && t.pieces === line.pieces);
    if (!target) {
      const copy = { ...line };
      out.push(copy);
      byKey.set(key, [...same, copy]);
      continue;
    }
    target.priceCents += line.priceCents;
    target.discountCents += line.discountCents;
    target.packages += line.packages;
    if (target.amountGrams != null) target.amountGrams += line.amountGrams!;
  }
  return out;
}
