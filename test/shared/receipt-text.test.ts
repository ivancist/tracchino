import { describe, expect, it } from "vitest";
import { normalizeRawText, piecesHint } from "../../shared/receipt-text";

describe("normalizeRawText", () => {
  it.each([
    ["BAN.CHIQ.", "BAN.CHIQ"],
    ["Ban. Chiq.", "BAN.CHIQ"],
    ["  BAN.CHIQ.   A ", "BAN.CHIQ"],
    ["BAN.CHIQ. 1,79", "BAN.CHIQ"],
    ["BAN.CHIQ. 1,79 A", "BAN.CHIQ"],
    ["BAN.CHIQ 10%", "BAN.CHIQ"],
    ["PASTA BARILLA N.5 500G", "PASTA BARILLA N.5 500G"],
    ["CAFFÈ D'ORZO", "CAFFE D ORZO"],
    ["LATTE PS  1L *", "LATTE PS 1L"],
    ["UOVA FRESCHE 6P", "UOVA FRESCHE 6P"],
    ["BAN.CHIQ. 1.79", "BAN.CHIQ"],
    // Whole numbers at the end are sizes (often truncated), never prices
    ["FAGIOLI BIANCHI 40", "FAGIOLI BIANCHI 40"],
    ["PASSATA POMOD. 700", "PASSATA POMOD.700"],
    ["SALE IODATO FINO 1", "SALE IODATO FINO 1"],
  ])("%j → %j", (raw, norm) => {
    expect(normalizeRawText(raw)).toBe(norm);
  });

  it("maps spelling variants of the same line to one key", () => {
    const variants = ["BAN.CHIQ.", "ban.chiq", "Ban. Chiq. A", "BAN.CHIQ.  1,79"];
    expect(new Set(variants.map(normalizeRawText)).size).toBe(1);
    // Real case: two scans of the same Eurospin receipt, read with and without the space
    expect(normalizeRawText("SGOMBRI GR.NAT. 120")).toBe(normalizeRawText("SGOMBRI GR.NAT.120"));
  });

  it("keeps meaningful numbers inside the text", () => {
    expect(normalizeRawText("YOGURT 2X125G")).toBe("YOGURT 2X125G");
    expect(normalizeRawText("ACQUA 6X1.5L")).toBe("ACQUA 6X1.5L");
  });
});

describe("piecesHint", () => {
  it.each([
    ["UOVA FRESCHE 6P", 6],
    ["UOVA 12 PZ", 12],
    ["UOVA CAT.A 6 PEZZI", 6],
    ["YOGURT X4", 4],
    ["BAN.CHIQ.", null],
    ["PASTA 500G", null],
    ["LATTE 1L", null],
  ])("%j → %j", (raw, n) => {
    expect(piecesHint(raw)).toBe(n);
  });
});
