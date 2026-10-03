import { describe, expect, it } from "vitest";
import { MEALS as DB_MEALS } from "../../db/schema";
import { costCents, groupRecentMeals, mealKey, MEALS, nutrientsFor, portionAmount, sumKnown, sumNutrients, unitCost, type Purchase } from "../../shared/diary";

const banana = { kcal100: 89, protein100: 1.1, fat100: 0.3, carbs100: 22.8, sugars100: null, saturatedFat100: 0.1, fiber100: 2.6, salt100: 0.01 };

describe("nutrientsFor", () => {
  it("scales per-100 values to the amount eaten; unknown stays null", () => {
    const n = nutrientsFor(banana, 120);
    expect(n.kcal).toBeCloseTo(106.8, 10); // 89 × 1.2
    expect(n.protein).toBeCloseTo(1.32, 10);
    expect(n.fat).toBeCloseTo(0.36, 10);
    expect(n.carbs).toBeCloseTo(27.36, 10);
    expect(n.sugars).toBeNull();
    expect(n.fiber).toBeCloseTo(3.12, 10); // 2.6 × 1.2
    expect(n.saturatedFat).toBeCloseTo(0.12, 10);
    expect(n.salt).toBeCloseTo(0.012, 10); // 0.01 × 1.2
  });
});

describe("sums", () => {
  it("adds known values and counts the missing ones", () => {
    expect(sumKnown([100, null, 50])).toEqual({ value: 150, missing: 1 });
    expect(sumKnown([null, null])).toEqual({ value: null, missing: 2 }); // unknown, not 0
    expect(sumKnown([])).toEqual({ value: null, missing: 0 });
    const t = sumNutrients([nutrientsFor(banana, 100), nutrientsFor({ ...banana, sugars100: 12 }, 50)]);
    expect(t.kcal).toEqual({ value: 133.5, missing: 0 }); // 89 + 44.5
    expect(t.sugars).toEqual({ value: 6, missing: 1 });
  });
});

describe("unitCost", () => {
  const pasta = { unit: "g" as const, packageAmount: 500, avgPieceAmount: null };
  const buy = (date: string, paidCents: number, pieces: number | null, amount: number | null = null): Purchase => ({ date, paidCents, pieces, amount });
  const pastaBuys = [buy("2026-05-01", 99, 1), buy("2026-09-01", 89, 1), buy("2026-09-20", 198, 2)];

  it("average: Σ paid / Σ grams over the last 90 days (May is outside the window)", () => {
    const c = unitCost(pastaBuys, pasta, "2026-10-01", "average");
    expect(c).toEqual({ paidCents: 287, amount: 1500, source: "average", purchases: 2, estimated: false });
    expect(costCents(c, 80)).toBe(15); // 80 × 287 / 1500 = 15.31
  });

  it("last: the latest purchase on or before the day", () => {
    const c = unitCost(pastaBuys, pasta, "2026-10-01", "last");
    expect(c).toEqual({ paidCents: 198, amount: 1000, source: "last", purchases: 1, estimated: false });
    expect(costCents(c, 80)).toBe(16); // 80 × 198 / 1000 = 15.84
    // Purchases after the diary day are ignored when an earlier one exists
    expect(unitCost(pastaBuys, pasta, "2026-09-10", "last")).toMatchObject({ paidCents: 89, amount: 500 });
  });

  it("window boundary: a purchase exactly N days before counts, N + 1 doesn't", () => {
    const buys = [buy("2026-07-03", 100, 1), buy("2026-07-02", 300, 1)]; // 90 and 91 days before 2026-10-01
    expect(unitCost(buys, pasta, "2026-10-01", "average")).toMatchObject({ paidCents: 100, purchases: 1, source: "average" });
    expect(unitCost(buys, pasta, "2026-10-01", "average", 91)).toMatchObject({ paidCents: 400, purchases: 2 });
    // Across a year boundary: 2025-12-31 is 1 day before 2026-01-01
    expect(unitCost([buy("2025-12-31", 50, 1)], pasta, "2026-01-01", "average", 1)).toMatchObject({ paidCents: 50, source: "average" });
  });

  it("a fully discounted purchase costs 0 (known), not n.d.", () => {
    const c = unitCost([buy("2026-09-30", 0, 1)], pasta, "2026-10-01", "average");
    expect(costCents(c, 100)).toBe(0);
  });

  it("average falls back to the last price when the window is empty", () => {
    // Window 2026-05-17…2026-08-15 has no purchase → last on or before: 2026-05-01
    expect(unitCost(pastaBuys, pasta, "2026-08-15", "average")).toMatchObject({ paidCents: 99, amount: 500, source: "last" });
    // A day before any purchase: the earliest one
    expect(unitCost(pastaBuys, pasta, "2026-01-01", "average")).toMatchObject({ paidCents: 99, source: "last" });
  });

  it("flags estimated quantities (pieces × average weight)", () => {
    const bananas = { unit: "g" as const, packageAmount: null, avgPieceAmount: 120 };
    const c = unitCost([buy("2026-09-28", 179, 6), buy("2026-09-30", 169, null, 850)], bananas, "2026-10-01", "average");
    // 6 × 120 = 720 g estimated + 850 g weighed
    expect(c).toEqual({ paidCents: 348, amount: 1570, source: "average", purchases: 2, estimated: true });
    expect(costCents(c, 120)).toBe(27); // 120 × 348 / 1570 = 26.6
  });

  it("never bought, or bought without a usable quantity → null (n.d.), never 0", () => {
    const loose = { unit: "g" as const, packageAmount: null, avgPieceAmount: null };
    expect(unitCost([], pasta, "2026-10-01", "average")).toBeNull();
    expect(unitCost([buy("2026-09-30", 250, 2)], loose, "2026-10-01", "average")).toBeNull();
    expect(costCents(null, 100)).toBeNull();
  });

  it("skips lines without quantity but uses the others", () => {
    const loose = { unit: "g" as const, packageAmount: null, avgPieceAmount: null };
    expect(unitCost([buy("2026-09-30", 250, 2), buy("2026-09-29", 300, null, 1000)], loose, "2026-10-01", "average")).toMatchObject({
      paidCents: 300,
      amount: 1000,
      purchases: 1,
    });
  });
});

describe("portions", () => {
  it("portion × quantity, rounded to the gram", () => {
    expect(portionAmount(120, 1.5)).toBe(180);
    expect(portionAmount(33, 2.5)).toBe(83); // 82.5 → 83
  });
  it("meals match the database constraint", () => {
    expect(MEALS).toEqual(DB_MEALS);
  });
});

describe("recent meals", () => {
  const item = (date: string, productId: number, amount: number, portionId: number | null = null, portionQty: number | null = null) => ({
    date,
    productId,
    amount,
    portionId,
    portionQty,
  });

  it("the key ignores entry order but not quantities or portions", () => {
    expect(mealKey([item("d", 1, 80), item("d", 2, 120)])).toBe(mealKey([item("d", 2, 120), item("d", 1, 80)]));
    expect(mealKey([item("d", 1, 80)])).not.toBe(mealKey([item("d", 1, 90)]));
    expect(mealKey([item("d", 1, 120, 7, 1)])).not.toBe(mealKey([item("d", 1, 120)]));
  });

  it("merges identical meals, newest first, and limits the list", () => {
    const rows = [
      // Same breakfast on 3 days (entered in different orders), a different one on 2026-10-02
      item("2026-10-03", 1, 200), item("2026-10-03", 2, 30),
      item("2026-10-02", 1, 200), item("2026-10-02", 3, 40),
      item("2026-10-01", 2, 30), item("2026-10-01", 1, 200),
      item("2026-09-30", 1, 200), item("2026-09-30", 2, 30),
      item("2026-09-01", 4, 10),
    ];
    const groups = groupRecentMeals(rows, 10);
    expect(groups.map((g) => g.dates)).toEqual([["2026-10-03", "2026-10-01", "2026-09-30"], ["2026-10-02"], ["2026-09-01"]]);
    expect(groups[0]!.items.map((i) => i.productId)).toEqual([1, 2]); // the newest occurrence's entries
    expect(groupRecentMeals(rows, 2)).toHaveLength(2);
    expect(groupRecentMeals([], 5)).toEqual([]);
  });
});
