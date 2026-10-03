import { describe, expect, it } from "vitest";
import { eachDay } from "../../shared/dates";
import type { UnitCost } from "../../shared/diary";
import { consumptionRate, estimateStock, forecast, isReliable, monthlyUse, suggestedPackages, type PantryConsumption } from "../../shared/pantry";

// The owner's real data (2026-09-29 → 2026-10-03): one Eurospin receipt on 29/9, breakfasts from 30/9.
const TODAY = "2026-10-03";
const LOGGED = eachDay("2026-09-29", TODAY); // diary logged every day
const pkg = (packageAmount: number) => ({ unit: "g" as const, packageAmount, avgPieceAmount: null });
const buy = (date: string, packages: number | null = 1) => ({ date, packages, pieces: null, amount: null });
const daily = (amount: number, from = "2026-09-30", to = TODAY): PantryConsumption[] => eachDay(from, to).map((date) => ({ date, amount }));
const cost = (paidCents: number, amount: number): UnitCost => ({ paidCents, amount, source: "average", purchases: 1, estimated: false });

describe("estimateStock", () => {
  it("yogurt: 1 kg bought, 4 × 200 g eaten → 200 g left", () => {
    expect(estimateStock([buy("2026-09-29")], daily(200), pkg(1000), TODAY)).toEqual({ amount: 200, estimated: false, since: "2026-09-29", corrected: false });
  });

  it("chia 150 − 4 × 15 = 90 g; oats 500 − 4 × 50 = 300 g", () => {
    expect(estimateStock([buy("2026-09-29")], daily(15), pkg(150), TODAY)?.amount).toBe(90);
    expect(estimateStock([buy("2026-09-29")], daily(50), pkg(500), TODAY)?.amount).toBe(300);
  });

  it("tuna: 2 cans of 112 g bought and eaten the same day → 0 (purchase first)", () => {
    const s = estimateStock([buy("2026-09-29"), buy("2026-09-29")], [{ date: "2026-09-29", amount: 224 }], pkg(112), TODAY);
    expect(s?.amount).toBe(0);
  });

  it("never goes below 0: eating more than bought means unknown older stock", () => {
    // 100 g bought, 150 g eaten (→ 0, not −50), then 100 g bought → 100 g
    const s = estimateStock([buy("2026-09-01"), buy("2026-09-03")], [{ date: "2026-09-02", amount: 150 }], pkg(100), TODAY);
    expect(s?.amount).toBe(100);
  });

  it("ignores consumption before the first purchase in the app, and anything after today", () => {
    const eaten = [{ date: "2026-09-20", amount: 400 }, { date: "2026-09-30", amount: 100 }, { date: "2026-10-04", amount: 100 }];
    expect(estimateStock([buy("2026-09-29")], eaten, pkg(500), TODAY)?.amount).toBe(400);
  });

  it("is unknown when never bought or when a purchase has no known quantity", () => {
    expect(estimateStock([], daily(50), pkg(454), TODAY)).toBeNull(); // peanut butter: never bought in the app
    const loose = { unit: "g" as const, packageAmount: null, avgPieceAmount: null };
    expect(estimateStock([buy("2026-09-29")], [], loose, TODAY)).toBeNull(); // bananas without weight
  });

  it("a correction restarts the count: yogurt shared, 400 g left on 1/10 after breakfast → 400 − 200 − 200 = 0", () => {
    const eaten = daily(200).map((c, i) => ({ ...c, createdAt: i })); // createdAt order within the day
    // Correction made on 1/10 after that day's breakfast (createdAt 1 < 5): only 2/10 and 3/10 count
    expect(estimateStock([buy("2026-09-29")], eaten, pkg(1000), TODAY, { date: "2026-10-01", amount: 400, createdAt: 5 })).toEqual({
      amount: 0,
      estimated: false,
      since: "2026-10-01",
      corrected: true,
    });
    // Made before that breakfast (createdAt 0 < 1): 1/10 counts too → 400 − 600, never below 0
    expect(estimateStock([buy("2026-09-29")], eaten, pkg(1000), TODAY, { date: "2026-10-01", amount: 400, createdAt: 0.5 })?.amount).toBe(0);
    expect(estimateStock([buy("2026-09-29")], eaten, pkg(1000), TODAY, { date: "2026-10-01", amount: 700, createdAt: 0.5 })?.amount).toBe(100);
  });

  it("a correction works without purchases in the app, and later purchases add up", () => {
    // Peanut butter never bought here: "I have 300 g" on 30/9, 50 g eaten on each of 4 days, then a 454 g jar on 2/10
    const eaten = daily(50).map((c) => ({ ...c, createdAt: 10 }));
    const adj = { date: "2026-09-30", amount: 300, createdAt: 1 };
    expect(estimateStock([], eaten, pkg(454), TODAY, adj)?.amount).toBe(100);
    expect(estimateStock([{ ...buy("2026-10-02"), createdAt: 20 }], eaten, pkg(454), TODAY, adj)?.amount).toBe(554);
    // A purchase before the correction is already in the corrected amount, even with an unknown quantity
    const loose = { unit: "g" as const, packageAmount: null, avgPieceAmount: null };
    expect(estimateStock([buy("2026-09-29")], [], loose, TODAY, { date: "2026-09-30", amount: 80, createdAt: 1 })?.amount).toBe(80);
  });

  it("flags an assumed package count as estimated", () => {
    expect(estimateStock([buy("2026-09-29", null)], [], pkg(500), TODAY)).toMatchObject({ amount: 500, estimated: true });
  });
});

describe("consumptionRate", () => {
  it("divides by the logged days since the product was first eaten (yogurt 800 g / 4 days = 200, not 800 / 5)", () => {
    expect(consumptionRate(daily(200), LOGGED, TODAY)).toEqual({ perDay: 200, typicalDay: 200, typicalMeal: 200, days: 4, eatenDays: 4 });
  });

  it("days without a diary don't count", () => {
    // Eaten 100 g on 1/10 and 3/10; 2/10 not logged → 200 g / 2 days
    const r = consumptionRate([{ date: "2026-10-01", amount: 100 }, { date: "2026-10-03", amount: 100 }], ["2026-10-01", "2026-10-03"], TODAY);
    expect(r?.perDay).toBe(100);
    // A logged day without the product does count: 200 g / 3 days
    expect(consumptionRate([{ date: "2026-10-01", amount: 100 }, { date: "2026-10-03", amount: 100 }], LOGGED, TODAY)?.perDay).toBeCloseTo(66.667, 3);
  });

  it("typical day is the median of the days it was eaten (several entries on a day add up)", () => {
    const r = consumptionRate(
      [
        { date: "2026-10-01", amount: 112 },
        { date: "2026-10-01", amount: 112 },
        { date: "2026-10-02", amount: 112 },
        { date: "2026-10-03", amount: 336 },
      ],
      LOGGED,
      TODAY,
    );
    expect(r?.typicalDay).toBe(224); // days: 224, 112, 336 → median 224
  });

  it("needs at least 3 logged days to be reliable (one meal of tuna today is not 224 g a day)", () => {
    expect(isReliable(consumptionRate([{ date: TODAY, amount: 224 }], LOGGED, TODAY)!)).toBe(false); // 1 day
    expect(isReliable(consumptionRate([{ date: "2026-10-01", amount: 224 }], LOGGED, TODAY)!)).toBe(false); // 1/10, 2/10 (today not over)
    expect(isReliable(consumptionRate([{ date: "2026-09-30", amount: 224 }], LOGGED, TODAY)!)).toBe(true); // 30/9, 1/10, 2/10
    // The owner's tuna, eaten on 29/9: 224 g over 29/9…2/10 = 56 g/day (today, not over yet and without tuna, doesn't count)
    expect(consumptionRate([{ date: "2026-09-29", amount: 224 }], LOGGED, TODAY)).toEqual({ perDay: 56, typicalDay: 224, typicalMeal: 224, days: 4, eatenDays: 1 });
    // Once today's main meals are logged it counts: 224 g / 5 days
    expect(consumptionRate([{ date: "2026-09-29", amount: 224 }], LOGGED, TODAY, 30, true)?.perDay).toBe(44.8);
  });

  it("rice: 100 g at a meal on 3 of the 4 finished days → 100 g a meal; today counts only when over or when eaten", () => {
    const rice = [
      { date: "2026-09-29", amount: 100, meal: "pranzo" },
      { date: "2026-10-01", amount: 100, meal: "cena" },
      { date: "2026-10-02", amount: 100, meal: "pranzo" },
    ];
    // Before dinner today: 29/9…2/10 → 300 g / 4 days; each meal with rice had 100 g
    expect(consumptionRate(rice, LOGGED, TODAY)).toMatchObject({ perDay: 75, typicalMeal: 100, days: 4, eatenDays: 3 });
    // Rice at dinner: today counts (eaten) → 400 g / 5 days, 4 days of 5
    const dinner = [...rice, { date: TODAY, amount: 100, meal: "cena" }];
    expect(consumptionRate(dinner, LOGGED, TODAY)).toMatchObject({ perDay: 80, typicalMeal: 100, days: 5, eatenDays: 4 });
    // Day over without rice (breakfast, lunch, dinner logged): today counts → 300 g / 5 days
    expect(consumptionRate(rice, LOGGED, TODAY, 30, true)).toMatchObject({ perDay: 60, days: 5, eatenDays: 3 });
  });

  it("a meal sums its entries; the typical meal is the median of meals that had the product", () => {
    const r = consumptionRate(
      [
        { date: "2026-10-01", amount: 50, meal: "pranzo" },
        { date: "2026-10-01", amount: 50, meal: "pranzo" }, // same lunch: 100 g
        { date: "2026-10-01", amount: 30, meal: "cena" },
        { date: "2026-10-02", amount: 120, meal: "pranzo" },
      ],
      LOGGED,
      TODAY,
    );
    expect(r?.typicalMeal).toBe(100); // meals: 100, 30, 120 → median 100
    expect(r?.typicalDay).toBe(125); // days: 130, 120 → 125
  });

  it("only the last 30 days count; nothing eaten in them → null", () => {
    const old = [{ date: "2026-09-03", amount: 500 }]; // 30 days before 3/10: outside (window is 4/9…3/10)
    expect(consumptionRate(old, LOGGED, TODAY)).toBeNull();
    expect(consumptionRate([{ date: "2026-09-04", amount: 300 }], ["2026-09-04", TODAY], TODAY)?.perDay).toBe(300); // today not over: 1 day
    expect(consumptionRate([{ date: "2026-09-04", amount: 300 }], ["2026-09-04", TODAY], TODAY, 30, true)?.perDay).toBe(150);
  });
});

describe("forecast and suggestions", () => {
  const rate = (perDay: number, typicalDay = perDay) => ({ perDay, typicalDay, typicalMeal: typicalDay, days: 4, eatenDays: 4 });

  it("yogurt 200 g at 200 g/day runs out tomorrow: urgent", () => {
    expect(forecast(200, rate(200), TODAY)).toEqual({ daysLeft: 1, runOutDate: "2026-10-04", urgency: "soon" });
  });

  it("chia 90 g at 15 g/day and oats 300 g at 50 g/day: 6 days, this week (5 days after the yogurt)", () => {
    expect(forecast(90, rate(15), TODAY)).toEqual({ daysLeft: 6, runOutDate: "2026-10-09", urgency: "week" });
    expect(forecast(300, rate(50), TODAY)).toEqual({ daysLeft: 6, runOutDate: "2026-10-09", urgency: "week" });
  });

  it("finished at 0; nothing to suggest beyond 7 days; boundaries", () => {
    expect(forecast(0, rate(44.8), TODAY).urgency).toBe("finished");
    expect(forecast(1700, rate(60), TODAY).urgency).toBeNull(); // rice: 28.3 days
    expect(forecast(100, rate(50), TODAY).urgency).toBe("soon"); // exactly 2 days
    expect(forecast(350, rate(50), TODAY).urgency).toBe("week"); // exactly 7 days
    expect(forecast(351, rate(50), TODAY).urgency).toBeNull();
  });

  it("suggests the packages of a typical day: tuna 224 g / 112 g → 2; yogurt → 1; none without a package size", () => {
    expect(suggestedPackages(rate(44.8, 224), 112)).toBe(2);
    expect(suggestedPackages(rate(200), 1000)).toBe(1);
    expect(suggestedPackages(rate(150, 225), 112)).toBe(3); // 2.01 cans → 3
    expect(suggestedPackages(rate(120), null)).toBeNull();
  });
});

describe("monthlyUse", () => {
  it("yogurt: 1 package every 5 days, 6 a month, 6 kg × 4,40 €/kg = 26,40 €", () => {
    expect(monthlyUse({ perDay: 200, typicalDay: 200, typicalMeal: 200, days: 4, eatenDays: 4 }, 1000, cost(440, 1000))).toEqual({
      packageEveryDays: 5,
      packagesPerMonth: 6,
      costPerMonthCents: 2640,
    });
  });

  it("chia: every 10 days, 3 a month, 450 g × 1,99 € / 150 g = 5,97 €", () => {
    expect(monthlyUse({ perDay: 15, typicalDay: 15, typicalMeal: 15, days: 4, eatenDays: 4 }, 150, cost(199, 150))).toEqual({
      packageEveryDays: 10,
      packagesPerMonth: 3,
      costPerMonthCents: 597,
    });
  });

  it("unknown cost stays null (never bought), never 0; no package → only the cost", () => {
    expect(monthlyUse({ perDay: 50, typicalDay: 50, typicalMeal: 50, days: 4, eatenDays: 4 }, 454, null)).toMatchObject({ costPerMonthCents: null, packagesPerMonth: 3.303964757709251 });
    expect(monthlyUse({ perDay: 120, typicalDay: 120, typicalMeal: 120, days: 2, eatenDays: 2 }, null, cost(47, 480))).toEqual({
      packageEveryDays: null,
      packagesPerMonth: null,
      costPerMonthCents: 353, // 3600 g × 47 / 480 = 352.5 → 353
    });
  });
});
