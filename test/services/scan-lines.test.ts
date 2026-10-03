import { describe, expect, it } from "vitest";
import type { ExtractedLine } from "../../worker/services/ai/types";
import { attachQuantityLines, fixQuantities, mergeDuplicateLines, prepareLines, type ReviewLine } from "../../worker/services/scan-lines";

const line = (rawText: string, priceCents: number, extra: Partial<ExtractedLine> = {}): ExtractedLine => ({
  kind: "product",
  rawText,
  priceCents,
  discountCents: 0,
  quantity: null,
  unitPriceCents: null,
  amountGrams: null,
  ...extra,
});
const qty = (quantity: number, unitPriceCents: number | null, priceCents = 0) =>
  line(`${quantity} PZ x`, priceCents, { kind: "quantity", quantity, unitPriceCents });
const review = (rawText: string, priceCents: number, extra: Partial<ReviewLine> = {}): ReviewLine => ({
  rawText,
  priceCents,
  discountCents: 0,
  packages: 1,
  pieces: null,
  amountGrams: null,
  ...extra,
});
/** [text, price, discount, packages, pieces, grams] */
const brief = (lines: ReviewLine[]) => lines.map((l) => [l.rawText, l.priceCents, l.discountCents, l.packages, l.pieces, l.amountGrams]);

describe("attachQuantityLines", () => {
  it("gives a quantity row to the product below when the amount adds up (Eurospin layout)", () => {
    const out = attachQuantityLines([line("TONNO", 119), qty(2, 199), line("SGOMBRI", 398), line("TORTIGLIONI", 85)]);
    expect(out.map((l) => [l.rawText, l.priceCents, l.quantity])).toEqual([["TONNO", 119, null], ["SGOMBRI", 398, 2], ["TORTIGLIONI", 85, null]]);
  });

  it("falls back to the product above, and drops a row that adds up nowhere", () => {
    expect(attachQuantityLines([line("SGOMBRI", 398), qty(2, 199), line("TONNO", 119)]).map((l) => l.quantity)).toEqual([2, null]);
    expect(attachQuantityLines([line("A", 100), qty(2, 199), line("B", 119)]).map((l) => l.quantity)).toEqual([null, null]);
  });

  it("without a unit price goes below; an amount printed on the quantity row moves to its product", () => {
    expect(attachQuantityLines([line("A", 100), qty(3, null), line("B", 270)]).map((l) => l.quantity)).toEqual([null, 3]);
    const moved = attachQuantityLines([qty(2, 129, 258), line("YOGURT", 0)]);
    expect(moved.map((l) => [l.rawText, l.priceCents, l.quantity])).toEqual([["YOGURT", 258, 2]]);
  });

  it("never overwrites a quantity a product already has", () => {
    expect(attachQuantityLines([qty(2, 100), line("YOGURT 3 X 0,79", 237, { quantity: 3, unitPriceCents: 79 })]).map((l) => l.quantity)).toEqual([3]);
  });
});

describe("fixQuantities", () => {
  it("keeps a quantity whose unit price adds up, or that has no unit price", () => {
    expect(fixQuantities([line("SGOMBRI", 398, { quantity: 2, unitPriceCents: 199 })])[0]!.quantity).toBe(2);
    expect(fixQuantities([line("YOGURT", 158, { quantity: 2 })])[0]!.quantity).toBe(2);
  });

  it("moves a quantity on the wrong line to the neighbour it adds up to", () => {
    const out = fixQuantities([line("TONNO", 119, { quantity: 2, unitPriceCents: 199 }), line("SGOMBRI", 398)]);
    expect(out.map((l) => l.quantity)).toEqual([null, 2]);
  });

  it("drops a quantity that adds up nowhere", () => {
    expect(fixQuantities([line("X", 100, { quantity: 3, unitPriceCents: 199 })])[0]!.quantity).toBeNull();
  });
});

describe("prepareLines", () => {
  it("one package per printed item unless a quantity says otherwise; pieces only from the printed text", () => {
    const out = prepareLines([line("TONNO NATURALE 160", 119), qty(2, 199), line("SGOMBRI GR.NAT.120", 398), line("UOVA A TERRA XL 6P", 199)]);
    expect(brief(out)).toEqual([
      ["TONNO NATURALE 160", 119, 0, 1, null, null],
      ["SGOMBRI GR.NAT.120", 398, 0, 2, null, null], // 2 packages, not 2 pieces
      ["UOVA A TERRA XL 6P", 199, 0, 1, 6, null], // 1 package of 6 pieces
    ]);
  });
});

describe("mergeDuplicateLines", () => {
  it("merges identical lines, consecutive or not, into the first one: packages add up", () => {
    const out = mergeDuplicateLines([review("PASSATA POMOD. 700", 85), review("CECI 400g", 49), review("CECI 400g", 49), review("PASSATA POMOD. 700", 85)]);
    expect(brief(out)).toEqual([
      ["PASSATA POMOD. 700", 170, 0, 2, null, null],
      ["CECI 400g", 98, 0, 2, null, null],
    ]);
  });

  it("two packs of 6 eggs are 2 packages of 6 pieces, not 12 packages or 12 pieces per pack", () => {
    expect(brief(mergeDuplicateLines([review("UOVA 6P", 199, { pieces: 6 }), review("UOVA 6P", 199, { pieces: 6, discountCents: 50 })]))).toEqual([
      ["UOVA 6P", 398, 50, 2, 6, null],
    ]);
  });

  it("adds a quantity row's packages to a single line of the same item", () => {
    expect(mergeDuplicateLines([review("SGOMBRI", 398, { packages: 2 }), review("SGOMBRI", 199)])[0]!.packages).toBe(3);
  });

  it("compares the normalised text (punctuation, case, trailing VAT code)", () => {
    expect(mergeDuplicateLines([review("Passata pomod. 700", 85), review("PASSATA POMOD.700 A", 85)])).toHaveLength(1);
    expect(mergeDuplicateLines([review("PISELLI MEDI 400g", 89), review("PISELLI FINI 400g", 59)])).toHaveLength(2);
  });

  it("merges weighed lines by adding grams, and never mixes weighed and unweighed lines", () => {
    expect(brief(mergeDuplicateLines([review("BANANE", 120, { amountGrams: 600 }), review("BANANE", 90, { amountGrams: 450 })]))).toEqual([
      ["BANANE", 210, 0, 2, null, 1050],
    ]);
    expect(brief(mergeDuplicateLines([review("BANANE", 120, { amountGrams: 600 }), review("BANANE", 47), review("BANANE", 47)]))).toEqual([
      ["BANANE", 120, 0, 1, null, 600],
      ["BANANE", 94, 0, 2, null, null],
    ]);
  });

  it("does not modify its input", () => {
    const input = [review("CECI", 49), review("CECI", 49)];
    mergeDuplicateLines(input);
    expect(input.map((l) => [l.priceCents, l.packages])).toEqual([[49, 1], [49, 1]]);
  });
});
