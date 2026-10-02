import { describe, expect, it } from "vitest";
import { perKiloCents, perPieceCents, resolveAmount, shouldPrefillPrice, unitPrices } from "../../shared/pricing";

const bananas = { unit: "g", packageAmount: null, avgPieceAmount: 120 } as const;
const pasta = { unit: "g", packageAmount: 500, avgPieceAmount: null } as const;
const lettuce = { unit: "pz", packageAmount: null, avgPieceAmount: null } as const;

describe("resolveAmount", () => {
  it("prefers the measured amount", () => {
    expect(resolveAmount({ pieces: 6, amount: 850 }, bananas)).toEqual({ amount: 850, source: "measured" });
  });
  it("uses pieces × package size for packaged products", () => {
    expect(resolveAmount({ pieces: 3, amount: null }, pasta)).toEqual({ amount: 1500, source: "package" });
  });
  it("assumes one package when pieces are missing, flagged as estimated", () => {
    expect(resolveAmount({ pieces: null, amount: null }, pasta)).toEqual({ amount: 500, source: "estimated" });
  });
  it("estimates from the average piece weight", () => {
    expect(resolveAmount({ pieces: 6, amount: null }, bananas)).toEqual({ amount: 720, source: "estimated" });
  });
  it("is unknown without data", () => {
    expect(resolveAmount({ pieces: null, amount: null }, bananas)).toBeNull();
    expect(resolveAmount({ pieces: 2, amount: null }, lettuce)).toBeNull();
  });
});

describe("unit prices", () => {
  it("computes €/kg and €/piece (hand-computed)", () => {
    // 6 bananas, 0.85 kg, 1.99 € − 0.20 € discount = 1.79 € → 2.105882 €/kg ≈ 2.11; 0.298 €/piece ≈ 0.30
    expect(unitPrices({ pieces: 6, amount: 850, priceFullCents: 199, discountCents: 20 }, bananas)).toEqual({
      paidCents: 179,
      perKilo: { cents: 211, source: "measured" },
      perPiece: 30,
    });
  });

  it("marks estimated €/kg", () => {
    // 5 bananas × 120 g = 600 g, 1.50 € → 2.50 €/kg
    expect(unitPrices({ pieces: 5, amount: null, priceFullCents: 150, discountCents: 0 }, bananas).perKilo).toEqual({
      cents: 250,
      source: "estimated",
    });
  });

  it("returns null (not 0) when the quantity is unknown", () => {
    const r = unitPrices({ pieces: null, amount: null, priceFullCents: 99, discountCents: 0 }, lettuce);
    expect(r.perKilo).toBeNull();
    expect(r.perPiece).toBeNull();
  });

  it("rounds half up to the cent", () => {
    expect(perKiloCents(1, 400)).toBe(3); // 2.5 → 3
    expect(perPieceCents(100, 3)).toBe(33);
    expect(perKiloCents(100, 0)).toBeNull();
  });

  it("handles a fully discounted (free) line", () => {
    expect(unitPrices({ pieces: 1, amount: 500, priceFullCents: 120, discountCents: 120 }, pasta)).toEqual({
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
