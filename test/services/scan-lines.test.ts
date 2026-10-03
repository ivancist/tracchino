import { describe, expect, it } from "vitest";
import type { ExtractedLine } from "../../worker/services/ai/types";
import { attachQuantityLines, fixPieces, mergeDuplicateLines } from "../../worker/services/scan-lines";

const line = (rawText: string, priceCents: number, extra: Partial<ExtractedLine> = {}): ExtractedLine => ({
  kind: "product",
  rawText,
  priceCents,
  discountCents: 0,
  pieces: null,
  unitPriceCents: null,
  amountGrams: null,
  ...extra,
});
const brief = (lines: ExtractedLine[]) => lines.map((l) => [l.rawText, l.priceCents, l.discountCents, l.pieces, l.amountGrams]);

const qty = (pieces: number, unitPriceCents: number | null, priceCents = 0) =>
  line(`${pieces} PZ x`, priceCents, { kind: "quantity", pieces, unitPriceCents });

describe("attachQuantityLines", () => {
  it("gives a quantity row to the product below when the amount adds up (Eurospin layout)", () => {
    const out = attachQuantityLines([line("TONNO", 119), qty(2, 199), line("SGOMBRI", 398), line("TORTIGLIONI", 85)]);
    expect(brief(out)).toEqual([["TONNO", 119, 0, null, null], ["SGOMBRI", 398, 0, 2, null], ["TORTIGLIONI", 85, 0, null, null]]);
  });

  it("falls back to the product above, and drops a row that adds up nowhere", () => {
    expect(attachQuantityLines([line("SGOMBRI", 398), qty(2, 199), line("TONNO", 119)]).map((l) => l.pieces)).toEqual([2, null]);
    expect(attachQuantityLines([line("A", 100), qty(2, 199), line("B", 119)]).map((l) => l.pieces)).toEqual([null, null]);
  });

  it("without a unit price goes below; an amount printed on the quantity row moves to its product", () => {
    expect(attachQuantityLines([line("A", 100), qty(3, null), line("B", 270)]).map((l) => l.pieces)).toEqual([null, 3]);
    expect(brief(attachQuantityLines([qty(2, 129, 258), line("YOGURT", 0)]))).toEqual([["YOGURT", 258, 0, 2, null]]);
  });

  it("never overwrites pieces a product already has", () => {
    expect(attachQuantityLines([qty(2, 100), line("UOVA 6P", 200, { pieces: 6 })]).map((l) => l.pieces)).toEqual([6]);
  });
});

describe("fixPieces", () => {
  it("keeps pieces whose unit price adds up", () => {
    expect(brief(fixPieces([line("SGOMBRI", 398, { pieces: 2, unitPriceCents: 199 })]))).toEqual([["SGOMBRI", 398, 0, 2, null]]);
  });

  it("moves pieces to the next line when that is the one they add up to (quantity line printed above)", () => {
    const out = fixPieces([line("TONNO", 119, { pieces: 2, unitPriceCents: 199 }), line("SGOMBRI", 398)]);
    expect(brief(out)).toEqual([["TONNO", 119, 0, null, null], ["SGOMBRI", 398, 0, 2, null]]);
    expect(out[1]!.unitPriceCents).toBe(199);
  });

  it("falls back to the previous line, and never steals pieces from a line that has its own", () => {
    expect(brief(fixPieces([line("A", 398), line("B", 119, { pieces: 2, unitPriceCents: 199 })])).map((l) => l[3])).toEqual([2, null]);
    const taken = fixPieces([line("A", 119, { pieces: 2, unitPriceCents: 199 }), line("B", 398, { pieces: 3 })]);
    expect(taken.map((l) => l.pieces)).toEqual([null, 3]);
  });

  it("drops pieces that add up nowhere, then reads pieces printed in the text", () => {
    expect(fixPieces([line("X", 100, { pieces: 3, unitPriceCents: 199 })])[0]!.pieces).toBeNull();
    expect(fixPieces([line("UOVA 6P", 199, { pieces: 6, unitPriceCents: 199 })])[0]!.pieces).toBe(6);
    expect(fixPieces([line("UOVA 6P", 199)])[0]!.pieces).toBe(6);
    expect(fixPieces([line("CECI", 49, { pieces: 1 })])[0]!.pieces).toBe(1); // no unit price → trusted
  });
});

describe("mergeDuplicateLines", () => {
  it("merges identical lines, consecutive or not, into the first one", () => {
    const out = mergeDuplicateLines([line("PASSATA POMOD. 700", 85), line("CECI 400g", 49), line("CECI 400g", 49), line("PASSATA POMOD. 700", 85)]);
    expect(brief(out)).toEqual([
      ["PASSATA POMOD. 700", 170, 0, 2, null],
      ["CECI 400g", 98, 0, 2, null],
    ]);
  });

  it("compares the normalised text (punctuation, case, trailing VAT code)", () => {
    expect(mergeDuplicateLines([line("Passata pomod. 700", 85), line("PASSATA POMOD.700 A", 85)])).toHaveLength(1);
    expect(mergeDuplicateLines([line("PISELLI MEDI 400g", 89), line("PISELLI FINI 400g", 59)])).toHaveLength(2);
  });

  it("adds up pieces, a line without pieces counting as one, and discounts", () => {
    expect(brief(mergeDuplicateLines([line("UOVA 6P", 199, { pieces: 6 }), line("UOVA 6P", 199, { pieces: 6, discountCents: 50 })]))).toEqual([
      ["UOVA 6P", 398, 50, 12, null],
    ]);
    expect(mergeDuplicateLines([line("SGOMBRI", 398, { pieces: 2 }), line("SGOMBRI", 199)])[0]!.pieces).toBe(3);
  });

  it("merges weighed lines by adding grams, and never mixes weighed and unweighed lines", () => {
    expect(brief(mergeDuplicateLines([line("BANANE", 120, { amountGrams: 600 }), line("BANANE", 90, { amountGrams: 450 })]))).toEqual([
      ["BANANE", 210, 0, null, 1050],
    ]);
    expect(brief(mergeDuplicateLines([line("BANANE", 120, { amountGrams: 600 }), line("BANANE", 47), line("BANANE", 47)]))).toEqual([
      ["BANANE", 120, 0, null, 600],
      ["BANANE", 94, 0, 2, null],
    ]);
  });

  it("does not modify its input", () => {
    const input = [line("CECI", 49), line("CECI", 49)];
    mergeDuplicateLines(input);
    expect(input.map((l) => l.priceCents)).toEqual([49, 49]);
  });
});
