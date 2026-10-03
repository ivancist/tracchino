import { describe, expect, it } from "vitest";
import { consumptionVsPurchases, dietSummary, nutrientValue, simulate, type CostLookup, type DiaryRow } from "../../shared/analysis";
import type { UnitCost } from "../../shared/diary";
import type { Nutrition } from "../../shared/nutrition";

// Fixture diary, every expected value computed by hand in the comments.
const PASTA = 1;
const RISO = 2;
const BANANA = 3;
const OLIO = 4;
const nutrition: Record<number, Nutrition> = {
  [PASTA]: { kcal100: 359, protein100: 12.5, fat100: 2, carbs100: 71, sugars100: 3.5, saturatedFat100: 0.4, fiber100: 3, salt100: 0.01 },
  [RISO]: { kcal100: 350, protein100: 7, fat100: 0.6, carbs100: 78, sugars100: 0.2, saturatedFat100: 0.2, fiber100: 1.4, salt100: 0.02 },
  [BANANA]: { kcal100: 89, protein100: 1.1, fat100: 0.3, carbs100: 22.8, sugars100: null, saturatedFat100: null, fiber100: 2.6, salt100: null },
  [OLIO]: { kcal100: 822, protein100: null, fat100: null, carbs100: null, sugars100: null, saturatedFat100: null, fiber100: null, salt100: null },
};
const unit = (paidCents: number, amount: number, estimated = false): UnitCost => ({ paidCents, amount, source: "average", purchases: 1, estimated });
const costs: Record<number, UnitCost | null> = {
  [PASTA]: unit(287, 1500),
  [RISO]: unit(449, 2000),
  [BANANA]: unit(179, 720, true),
  [OLIO]: null, // never bought
};
const nut = (id: number) => nutrition[id] ?? null;
const cost: CostLookup = (id) => costs[id] ?? null;
const diary: DiaryRow[] = [
  { date: "2026-10-01", productId: PASTA, amount: 80 },
  { date: "2026-10-01", productId: BANANA, amount: 120 },
  { date: "2026-10-02", productId: PASTA, amount: 100 },
  { date: "2026-10-02", productId: OLIO, amount: 10 },
];

describe("dietSummary", () => {
  it("daily totals and means over logged days only", () => {
    const s = dietSummary(diary, nut, cost);
    // Day 1: pasta 80 g → 80 × 287 / 1500 = 15.31 → 15; banana 120 g → 120 × 179 / 720 = 29.83 → 30
    // Day 2: pasta 100 g → 19.13 → 19; oil unknown
    expect(s.days.map((d) => [d.date, d.entries, d.cost])).toEqual([
      ["2026-10-01", 2, { value: 45, missing: 0 }],
      ["2026-10-02", 2, { value: 19, missing: 1 }],
    ]);
    expect(s.dailyMean.cost).toBe(32); // (45 + 19) / 2
    expect(s.weeklyCostEstimate).toBe(224);
    expect(s.entriesWithoutCost).toBe(1);
    // Per 100 kcal only over entries with both values: (15 + 30 + 19) cents / (287.2 + 106.8 + 359) kcal
    expect(s.costPer100Kcal).toBeCloseTo((64 * 100) / 753, 10);
    // kcal: 287.2 + 106.8 = 394; 359 + 82.2 = 441.2 → mean 417.6
    expect(s.days[0]!.kcal.value).toBeCloseTo(394, 10);
    expect(s.dailyMean.kcal).toBeCloseTo(417.6, 10);
  });

  it("no diary → nothing known, not zero", () => {
    const s = dietSummary([], nut, cost);
    expect(s).toEqual({
      days: [],
      dailyMean: { cost: null, kcal: null, protein: null, fat: null, saturatedFat: null, carbs: null, sugars: null, fiber: null, salt: null },
      weeklyCostEstimate: null,
      costPer100Kcal: null,
      entriesWithoutCost: 0,
    });
  });
});

describe("nutrientValue", () => {
  it("cents per 100 kcal and per 10 g of protein, unrounded", () => {
    // Pasta: 287 × 100 × 100 / (1500 × 359) = 5.3296…; 287 × 10 × 100 / (1500 × 12.5) = 15.3066…
    const p = nutrientValue(nutrition[PASTA]!, costs[PASTA]!);
    expect(p.per100KcalCents).toBeCloseTo(2_870_000 / 538_500, 10);
    expect(p.per10gProteinCents).toBeCloseTo(287_000 / 18_750, 10);
    // Bananas: 179 × 10000 / (720 × 89) = 27.93…; 179 × 1000 / (720 × 1.1) = 226.01…
    const b = nutrientValue(nutrition[BANANA]!, costs[BANANA]!);
    expect(b.per100KcalCents).toBeCloseTo(1_790_000 / 64_080, 10);
    expect(b.per10gProteinCents).toBeCloseTo(179_000 / 792, 10);
    // Unknown cost or nutrient, or 0 kcal (water) → null
    expect(nutrientValue(nutrition[OLIO]!, null)).toEqual({ per100KcalCents: null, per10gProteinCents: null });
    expect(nutrientValue({ ...nutrition[OLIO]! }, unit(500, 1000)).per10gProteinCents).toBeNull();
    expect(nutrientValue({ kcal100: 0, protein100: 0, fat100: 0, carbs100: 0, sugars100: 0, saturatedFat100: 0, fiber100: 0, salt100: null }, unit(30, 1500))).toEqual({
      per100KcalCents: null,
      per10gProteinCents: null,
    });
  });
});

describe("simulate", () => {
  it("replacing A with A changes nothing", () => {
    const s = simulate(diary, { fromProductId: PASTA, toProductId: PASTA, factor: 1 }, nut, cost);
    expect(s.affectedEntries).toBe(2);
    expect(s.delta).toEqual({ cost: 0, kcal: 0, protein: 0, fat: 0, saturatedFat: 0, carbs: 0, sugars: 0, fiber: 0, salt: 0 });
  });

  it("pasta → rice, same grams", () => {
    const s = simulate(diary, { fromProductId: PASTA, toProductId: RISO, factor: 1 }, nut, cost);
    // Cost: 15 + 19 = 34 → rice 80 × 449 / 2000 = 17.96 → 18, 100 → 22.45 → 22: 40, +6
    expect(s.before.cost).toBe(34);
    expect(s.after.cost).toBe(40);
    expect(s.delta.cost).toBe(6);
    // kcal: 287.2 + 359 = 646.2 → 280 + 350 = 630: −16.2; protein 10 + 12.5 = 22.5 → 5.6 + 7 = 12.6: −9.9
    expect(s.delta.kcal).toBeCloseTo(-16.2, 10);
    expect(s.delta.protein).toBeCloseTo(-9.9, 10);
    expect(s.delta.sugars).toBeCloseTo(0.36 - 6.3, 10);
    // Fibre: pasta 2.4 + 3 = 5.4 g → rice 1.12 + 1.4 = 2.52 g: −2.88
    expect(s.delta.fiber).toBeCloseTo(-2.88, 10);
    // Salt: pasta 0.008 + 0.01 = 0.018 g → rice 0.016 + 0.02 = 0.036 g: +0.018
    expect(s.delta.salt).toBeCloseTo(0.018, 10);
    expect(s.affectedDays).toBe(2);
  });

  it("pasta → rice, 1.5× the grams", () => {
    const s = simulate(diary, { fromProductId: PASTA, toProductId: RISO, factor: 1.5 }, nut, cost);
    // 120 g → 26.94 → 27, 150 g → 33.68 → 34: 61, +27; kcal 420 + 525 = 945: +298.8
    expect(s.delta.cost).toBe(27);
    expect(s.delta.kcal).toBeCloseTo(298.8, 10);
  });

  it("same product, half the grams", () => {
    const s = simulate(diary, { fromProductId: PASTA, toProductId: PASTA, factor: 0.5 }, nut, cost);
    // 40 g → 7.65 → 8, 50 g → 9.57 → 10: 18, −16; kcal 143.6 + 179.5 = 323.1: −323.1
    expect(s.delta.cost).toBe(-16);
    expect(s.delta.kcal).toBeCloseTo(-323.1, 10);
  });

  it("a small factor never rounds an entry down to 0 g", () => {
    const s = simulate([{ date: "2026-10-01", productId: PASTA, amount: 1 }], { fromProductId: PASTA, toProductId: PASTA, factor: 0.4 }, nut, cost);
    expect(s.after.kcal).toBeCloseTo(3.59, 10); // 1 g, not 0
  });

  it("unknown values make the difference unknown, never 0", () => {
    const toOil = simulate(diary, { fromProductId: BANANA, toProductId: OLIO, factor: 1 }, nut, cost);
    expect(toOil.delta.cost).toBeNull(); // oil never bought
    expect(toOil.delta.kcal).toBeCloseTo(986.4 - 106.8, 10);
    expect(toOil.delta.protein).toBeNull();
    const fromOil = simulate(diary, { fromProductId: OLIO, toProductId: BANANA, factor: 1 }, nut, cost);
    expect(fromOil.before.cost).toBeNull();
    expect(fromOil.delta.cost).toBeNull();
  });

  it("a product never eaten in the period affects nothing", () => {
    const s = simulate(diary, { fromProductId: RISO, toProductId: PASTA, factor: 1 }, nut, cost);
    expect(s).toMatchObject({ affectedEntries: 0, affectedDays: 0, delta: { cost: 0, kcal: 0 } });
  });
});

describe("consumptionVsPurchases", () => {
  it("eaten vs bought per product", () => {
    const info = (id: number) =>
      ({
        [PASTA]: { unit: "g" as const, packageAmount: 500, avgPieceAmount: null },
        [RISO]: { unit: "g" as const, packageAmount: 2000, avgPieceAmount: null },
        [BANANA]: { unit: "g" as const, packageAmount: null, avgPieceAmount: 120 },
        [OLIO]: { unit: "ml" as const, packageAmount: null, avgPieceAmount: null },
      })[id] ?? null;
    const rows = consumptionVsPurchases(
      diary,
      [
        { productId: PASTA, date: "2026-09-20", packages: 1, pieces: null, amount: null }, // 500 g
        { productId: PASTA, date: "2026-09-28", packages: 2, pieces: null, amount: null }, // 1000 g
        { productId: BANANA, date: "2026-09-28", packages: null, pieces: 6, amount: null }, // ≈ 720 g
        { productId: OLIO, date: "2026-09-28", packages: 1, pieces: null, amount: null }, // unknown
        { productId: RISO, date: "2026-09-29", packages: 1, pieces: null, amount: null }, // 2000 g
      ],
      info,
    );
    const by = Object.fromEntries(rows.map((r) => [r.productId, r]));
    expect(by[PASTA]).toEqual({
      productId: PASTA,
      eatenAmount: 180,
      eatenEntries: 2,
      eatenDays: 2,
      boughtAmount: 1500,
      boughtLines: 2,
      boughtDays: 2,
      boughtUnknown: 0,
      boughtEstimated: false,
    });
    expect(by[BANANA]).toMatchObject({ eatenAmount: 120, eatenDays: 1, boughtAmount: 720, boughtEstimated: true });
    expect(by[OLIO]).toMatchObject({ eatenAmount: 10, boughtAmount: 0, boughtLines: 1, boughtUnknown: 1 });
    expect(by[RISO]).toMatchObject({ eatenAmount: 0, eatenEntries: 0, eatenDays: 0, boughtAmount: 2000 });
  });
});
