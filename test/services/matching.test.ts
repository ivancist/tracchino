import { describe, expect, it } from "vitest";
import { decide, findCandidates, matchStore, titleCase, type Alias, type CatalogProduct } from "../../worker/services/matching";

const products: CatalogProduct[] = [
  { id: 1, name: "Banane Chiquita", brand: null },
  { id: 2, name: "Banane", brand: "Coop" },
  { id: 3, name: "Latte parzialmente scremato", brand: "Granarolo" },
  { id: 4, name: "Uova fresche", brand: null },
  { id: 5, name: "Spaghetti n.5", brand: "Barilla" },
];
const ESSELUNGA = 10;
const COOP = 20;
const aliases: Alias[] = [
  { chainId: ESSELUNGA, rawTextNorm: "BAN.CHIQ", productId: 1 },
  { chainId: COOP, rawTextNorm: "LATTE PS GRANAR", productId: 3 },
];

describe("findCandidates", () => {
  it("uses the chain's exact alias, whatever the spelling on the receipt", () => {
    const r = findCandidates("Ban. Chiq.  A", ESSELUNGA, products, aliases);
    expect(r).toMatchObject({ rawTextNorm: "BAN.CHIQ", aliasProductId: 1 });
  });

  it("does not use another chain's alias as exact, but ranks it high", () => {
    const r = findCandidates("LATTE PS GRANAR", ESSELUNGA, products, aliases);
    expect(r.aliasProductId).toBeNull();
    expect(r.candidates[0]).toEqual({ productId: 3, score: 0.9 });
  });

  it("finds abbreviations by token prefixes", () => {
    const r = findCandidates("SPAGH.BARILLA N5", ESSELUNGA, products, aliases);
    expect(r.candidates[0]?.productId).toBe(5);
    const eggs = findCandidates("UOVA FRESCHE 6P", ESSELUNGA, products, aliases);
    expect(eggs.candidates[0]?.productId).toBe(4);
  });

  it("returns no candidates for unrelated text", () => {
    expect(findCandidates("DETERSIVO PIATTI", ESSELUNGA, products, aliases).candidates).toEqual([]);
  });
});

describe("decide", () => {
  const found = (raw: string) => findCandidates(raw, ESSELUNGA, products, aliases);

  it("alias → green, automatic", () => {
    expect(decide(found("BAN.CHIQ."), undefined)).toMatchObject({ status: "alias", productId: 1 });
  });

  it("AI agrees with the best text match → yellow, preselected", () => {
    const f = found("SPAGH.BARILLA N5");
    expect(decide(f, { index: 0, productId: 5, newName: null, confidence: 0.9 })).toMatchObject({ status: "proposed", productId: 5 });
  });

  it("AI disagrees → red, AI's choice preselected", () => {
    const f = found("BANANE");
    const top = f.candidates[0]!.productId;
    const other = f.candidates.find((c) => c.productId !== top)!.productId;
    expect(decide(f, { index: 0, productId: other, newName: null, confidence: 0.6 })).toMatchObject({ status: "uncertain", productId: other });
  });

  it("AI says new product → red with AI's suggested name", () => {
    expect(decide(found("DETERSIVO PIATTI"), { index: 0, productId: null, newName: "Detersivo piatti", confidence: 0.8 })).toEqual(
      expect.objectContaining({ status: "none", productId: null, suggestedName: "Detersivo piatti" }),
    );
  });

  it("without AI: proposes only a clear winner, falls back to a readable name", () => {
    expect(decide(found("UOVA FRESCHE 6P"), undefined)).toMatchObject({ productId: 4 });
    expect(decide(found("DETERSIVO PIATTI"), undefined)).toMatchObject({ status: "none", suggestedName: "Detersivo Piatti" });
    // "Banane" matches two products closely: never auto-proposed
    expect(decide(found("BANANE"), undefined).status).toBe("uncertain");
  });

  it("titleCase", () => {
    expect(titleCase("BAN.CHIQ")).toBe("Ban Chiq");
  });
});

describe("matchStore", () => {
  const stores = [
    { id: 1, chainId: ESSELUNGA, chainName: "Esselunga", name: "Viale Piave", vatNumber: "IT 04916380159" },
    { id: 2, chainId: ESSELUNGA, chainName: "Esselunga", name: "Monza", vatNumber: null },
    { id: 3, chainId: COOP, chainName: "Coop", name: "Centro", vatNumber: null },
  ];
  it("matches by VAT number first (digits only)", () => {
    expect(matchStore({ name: "Qualcosa", vatNumber: "04916380159" }, stores)).toEqual({ storeId: 1, chainId: ESSELUNGA, status: "vat" });
  });
  it("falls back to the chain name, picking its first (most recently used) store", () => {
    expect(matchStore({ name: "ESSELUNGA S.P.A.", vatNumber: null }, stores)).toEqual({ storeId: 1, chainId: ESSELUNGA, status: "chain" });
    expect(matchStore({ name: "Coop Lombardia", vatNumber: null }, stores)).toMatchObject({ storeId: 3, status: "chain" });
  });
  it("returns none for an unknown store", () => {
    expect(matchStore({ name: "Carrefour", vatNumber: "123" }, stores)).toEqual({ storeId: null, chainId: null, status: "none" });
  });
});
