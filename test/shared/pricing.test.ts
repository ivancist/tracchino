import { describe, expect, it } from "vitest";
import { perKiloCents, perPackageCents, perPieceCents, resolveAmount, shouldPrefillPrice, totalPieces, unitPrices } from "../../shared/pricing";

const bananas = { unit: "g", packageAmount: null, avgPieceAmount: 120 } as const;
const pasta = { unit: "g", packageAmount: 500, avgPieceAmount: null } as const;
const carrots = { unit: "g", packageAmount: 500, avgPieceAmount: null } as const;
const eggs = { unit: "g", packageAmount: null, avgPieceAmount: 65 } as const;
const lettuce = { unit: "pz", packageAmount: null, avgPieceAmount: null } as const;
const q = (packages: number | null, pieces: number | null, amount: number | null = null) => ({ packages, pieces, amount });

describe("totalPieces", () => {
  it("is pieces per package × packages; a missing package count is one package", () => {
    expect(totalPieces(q(2, 6))).toBe(12); // 2 packs of 6 eggs
    expect(totalPieces(q(null, 6))).toBe(6);
    expect(totalPieces(q(1, 6))).toBe(6);
    expect(totalPieces(q(3, null))).toBeNull(); // 3 jars of passata: packages, not pieces
  });
});

describe("resolveAmount", () => {
  it("prefers the measured amount", () => {
    expect(resolveAmount(q(null, 6, 850), bananas)).toEqual({ amount: 850, source: "measured" });
  });
  it("uses packages × package size for packaged products", () => {
    expect(resolveAmount(q(3, null), pasta)).toEqual({ amount: 1500, source: "package" });
  });
  it("never multiplies the package size by the pieces inside it", () => {
    // 1 bag of carrots, 500 g, with 6 carrots inside: 500 g, not 3 kg
    expect(resolveAmount(q(1, 6), carrots)).toEqual({ amount: 500, source: "package" });
    expect(resolveAmount(q(2, 6), carrots)).toEqual({ amount: 1000, source: "package" });
  });
  it("assumes one package when the package count is missing, flagged as estimated", () => {
    expect(resolveAmount(q(null, null), pasta)).toEqual({ amount: 500, source: "estimated" });
    expect(resolveAmount(q(null, 6), carrots)).toEqual({ amount: 500, source: "estimated" });
  });
  it("estimates from the average piece weight × total pieces", () => {
    expect(resolveAmount(q(null, 6), bananas)).toEqual({ amount: 720, source: "estimated" });
    expect(resolveAmount(q(2, 6), eggs)).toEqual({ amount: 780, source: "estimated" }); // 12 eggs × 65 g
  });
  it("is unknown without data", () => {
    expect(resolveAmount(q(null, null), bananas)).toBeNull();
    expect(resolveAmount(q(1, null), bananas)).toBeNull(); // one bunch: how many bananas is unknown
    expect(resolveAmount(q(null, 2), lettuce)).toBeNull();
  });
});

describe("unit prices", () => {
  it("computes €/kg and €/piece (hand-computed)", () => {
    // 6 bananas, 0.85 kg, 1.99 € − 0.20 € discount = 1.79 € → 2.105882 €/kg ≈ 2.11; 0.298 €/piece ≈ 0.30
    expect(unitPrices({ ...q(null, 6, 850), priceFullCents: 199, discountCents: 20 }, bananas)).toEqual({
      paidCents: 179,
      perKilo: { cents: 211, source: "measured" },
      perPiece: 30,
    });
  });

  it("prices each piece over all packages", () => {
    // 2 packs of 6 eggs, 3.98 € → 12 eggs → 0.3317 € ≈ 0.33 €/egg
    expect(unitPrices({ ...q(2, 6), priceFullCents: 398, discountCents: 0 }, eggs).perPiece).toBe(33);
    // 2 jars of passata (no pieces): no price per piece
    expect(unitPrices({ ...q(2, null), priceFullCents: 170, discountCents: 0 }, pasta).perPiece).toBeNull();
  });

  it("marks estimated €/kg", () => {
    // 5 bananas × 120 g = 600 g, 1.50 € → 2.50 €/kg
    expect(unitPrices({ ...q(null, 5), priceFullCents: 150, discountCents: 0 }, bananas).perKilo).toEqual({
      cents: 250,
      source: "estimated",
    });
  });

  it("returns null (not 0) when the quantity is unknown", () => {
    const r = unitPrices({ ...q(null, null), priceFullCents: 99, discountCents: 0 }, lettuce);
    expect(r.perKilo).toBeNull();
    expect(r.perPiece).toBeNull();
  });

  it("prices each package only when more than one was bought", () => {
    expect(perPackageCents(170, 2)).toBe(85); // 2 jars of passata
    expect(perPackageCents(100, 3)).toBe(33);
    expect(perPackageCents(85, 1)).toBeNull(); // one package: the line price already says it
    expect(perPackageCents(85, null)).toBeNull();
  });

  it("rounds half up to the cent", () => {
    expect(perKiloCents(1, 400)).toBe(3); // 2.5 → 3
    expect(perPieceCents(100, 3)).toBe(33);
    expect(perKiloCents(100, 0)).toBeNull();
  });

  it("handles a fully discounted (free) line", () => {
    expect(unitPrices({ ...q(1, 1, 500), priceFullCents: 120, discountCents: 120 }, pasta)).toEqual({
      paidCents: 0,
      perKilo: { cents: 0, source: "measured" },
      perPiece: 0,
    });
  });
});

describe("shouldPrefillPrice", () => {
  it("prefills only packaged products", () => {
    expect(shouldPrefillPrice(pasta)).toBe(true);
    expect(shouldPrefillPrice(bananas)).toBe(false); // loose, by weight
    expect(shouldPrefillPrice(lettuce)).toBe(false); // per piece, e.g. eggs in packs of 6 or 12
  });
});
