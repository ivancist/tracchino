import { describe, expect, it } from "vitest";
import type { PantryItem } from "../../shared/api";
import { lastPriceText, leftText, stockText } from "../../shared/pantry-text";

const item = (over: Partial<PantryItem>): PantryItem => ({
  productId: 1,
  name: "X",
  brand: null,
  unit: "g",
  packageAmount: null,
  avgPieceAmount: null,
  lastPurchase: null,
  rate: null,
  stock: null,
  forecast: null,
  suggestedPackages: null,
  packageEveryDays: null,
  packagesPerMonth: null,
  costPerMonthCents: null,
  costEstimated: false,
  inList: false,
  ...over,
});
const stock = (amount: number, estimated = false) => ({ amount, estimated, since: "2026-10-01", corrected: false });
const eur = (s: string) => s.replace(/\u00a0/g, " "); // Intl puts a no-break space before €

describe("leftText", () => {
  it("counts pieces for products bought by the piece (bananas 120 g, eggs 65 g)", () => {
    expect(leftText(item({ avgPieceAmount: 120, stock: stock(240, true) }))).toBe("≈ 2 pz (240 g)");
    expect(leftText(item({ avgPieceAmount: 65, stock: stock(195, true) }))).toBe("≈ 3 pz (195 g)");
    expect(leftText(item({ avgPieceAmount: 120, stock: stock(120, true) }))).toBe("≈ 1 pz (120 g)");
    expect(leftText(item({ avgPieceAmount: 120, stock: stock(40, true) }))).toBe("meno di 1 pz (40 g)");
  });

  it("stays in grams for packaged products, even with pieces inside (carrots 500 g)", () => {
    expect(leftText(item({ packageAmount: 240, stock: stock(480) }))).toBe("480 g");
    expect(leftText(item({ packageAmount: 500, avgPieceAmount: 80, stock: stock(500) }))).toBe("500 g");
    expect(leftText(item({ packageAmount: 1000, stock: stock(1500, true) }))).toBe("≈ 1,5 kg");
  });

  it("finished and unknown stock", () => {
    expect(stockText(item({ stock: stock(0) }))).toBe("Finito");
    expect(stockText(item({}))).toMatch(/^Scorta sconosciuta/);
  });
});

describe("lastPriceText", () => {
  const last = (paidCents: number, packages: number | null, pieces: number | null = null, amount: number | null = null) => ({
    date: "2026-09-29",
    paidCents,
    packages,
    pieces,
    amount,
  });

  it("per package for packaged products: beans 2 × 240 g for 1,18 € → 0,59 € a conf.", () => {
    expect(eur(lastPriceText(item({ packageAmount: 240, lastPurchase: last(118, 2) }))!)).toBe("0,59 € a conf.");
    expect(eur(lastPriceText(item({ packageAmount: 1000, lastPurchase: last(440, 1) }))!)).toBe("4,40 € a conf.");
  });

  it("per piece, else per kg; nothing when never bought", () => {
    expect(eur(lastPriceText(item({ avgPieceAmount: 120, lastPurchase: last(47, 1, 4) }))!)).toBe("0,12 €/pz");
    expect(eur(lastPriceText(item({ lastPurchase: last(199, 1, null, 270) }))!)).toBe("7,37 €/kg");
    expect(lastPriceText(item({}))).toBeNull();
  });
});
