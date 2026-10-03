// Deterministic clean-up of the lines a model read from a receipt, before matching.
import { normalizeRawText, piecesHint } from "../../shared/receipt-text";
import type { ExtractedLine } from "./ai/types";

/**
 * A printed quantity row ("2 PZ x 1,99 EUR/PZ") is transcribed by the model as its own line (kind "quantity") and attached
 * here to its product: the one below (where Italian receipts print it), else the one above, and only if pieces × unit price
 * is that product's amount. Without a unit price it goes to the product below. A row that fits nowhere is dropped.
 * Returns product lines only.
 */
export function attachQuantityLines(lines: ExtractedLine[]): ExtractedLine[] {
  const out = lines.map((l) => ({ ...l }));
  const isProduct = (l: ExtractedLine | undefined): l is ExtractedLine => l?.kind === "product";
  out.forEach((q, i) => {
    if (q.kind !== "quantity" || q.pieces == null) return;
    const below = out.slice(i + 1).find(isProduct);
    const above = out.slice(0, i).reverse().find(isProduct);
    const free = (p: ExtractedLine | undefined): p is ExtractedLine => p != null && p.pieces == null;
    const owner =
      q.unitPriceCents == null
        ? [below].find(free)
        : [below, above].find((p) => free(p) && (p.priceCents || q.priceCents) === q.pieces! * q.unitPriceCents!);
    if (!owner) return;
    owner.pieces = q.pieces;
    owner.unitPriceCents = q.unitPriceCents;
    owner.priceCents ||= q.priceCents; // a few chains print the amount on the quantity row
  });
  return out.filter(isProduct);
}

/**
 * Pieces on a product line must add up with their unit price (the model may still put a quantity row's pieces on the wrong
 * neighbour): if not, they move to the adjacent line they add up to, or are dropped. Pieces without a unit price are kept;
 * pieces printed in the text ("UOVA 6P") are then filled in by `piecesHint`.
 */
export function fixPieces(lines: ExtractedLine[]): ExtractedLine[] {
  const out = lines.map((l) => ({ ...l }));
  for (let i = 0; i < out.length; i++) {
    const l = out[i]!;
    if (l.pieces == null || l.unitPriceCents == null) continue;
    const total = l.pieces * l.unitPriceCents;
    if (total === l.priceCents) continue;
    const owner = [out[i + 1], out[i - 1]].find((n) => n && n.pieces == null && n.priceCents === total);
    if (owner) {
      owner.pieces = l.pieces;
      owner.unitPriceCents = l.unitPriceCents;
    }
    l.pieces = null;
    l.unitPriceCents = null;
  }
  return out.map((l) => ({ ...l, pieces: l.pieces ?? piecesHint(l.rawText) }));
}

/** Model lines → review lines before merging: quantity rows attached, pieces checked. */
export const prepareLines = (lines: ExtractedLine[]) => fixPieces(attachQuantityLines(lines));

/**
 * The same printed item scanned twice is one purchase of 2: lines with the same normalised text are merged into the first
 * one (prices and discounts added up), consecutive or not. Pieces add up, a line without pieces counting as one
 * ("CECI 400g" twice → 2; "UOVA 6P" twice → 12). Weighed lines merge only with weighed lines (grams add up).
 */
export function mergeDuplicateLines(lines: ExtractedLine[]): ExtractedLine[] {
  const out: ExtractedLine[] = [];
  const byKey = new Map<string, ExtractedLine[]>();
  for (const line of lines) {
    const key = normalizeRawText(line.rawText);
    const same = byKey.get(key) ?? [];
    const target = same.find((t) => (t.amountGrams == null) === (line.amountGrams == null));
    if (!target) {
      const copy = { ...line };
      out.push(copy);
      byKey.set(key, [...same, copy]);
      continue;
    }
    target.priceCents += line.priceCents;
    target.discountCents += line.discountCents;
    if (target.amountGrams != null) {
      target.amountGrams += line.amountGrams!;
      target.pieces = target.pieces != null && line.pieces != null ? target.pieces + line.pieces : null;
    } else {
      target.pieces = (target.pieces ?? 1) + (line.pieces ?? 1);
    }
    target.unitPriceCents = target.unitPriceCents === line.unitPriceCents ? target.unitPriceCents : null;
  }
  return out;
}
