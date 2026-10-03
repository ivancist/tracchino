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
    expect(estimateStock([buy("2026-09-29")], daily(200), pkg(1000), TODAY)).toEqual({ amount: 200, estimated: false, since: "2026-09-29" });
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

  it("flags an assumed package count as estimated", () => {
    expect(estimateStock([buy("2026-09-29", null)], [], pkg(500), TODAY)).toMatchObject({ amount: 500, estimated: true });
  });
});

describe("consumptionRate", () => {
  it("divides by the logged days since the product was first eaten (yogurt 800 g / 4 days = 200, not 800 / 5)", () => {
    expect(consumptionRate(daily(200), LOGGED, TODAY)).toEqual({ perDay: 200, typicalDay: 200, days: 4 });
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
    expect(isReliable(consumptionRate([{ date: "2026-10-02", amount: 224 }], LOGGED, TODAY)!)).toBe(false); // 2 days
    expect(isReliable(consumptionRate([{ date: "2026-10-01", amount: 224 }], LOGGED, TODAY)!)).toBe(true); // 3 days
    // The owner's tuna, eaten on 29/9: 224 g over 5 logged days = 44.8 g/day
    expect(consumptionRate([{ date: "2026-09-29", amount: 224 }], LOGGED, TODAY)).toEqual({ perDay: 44.8, typicalDay: 224, days: 5 });
  });

  it("only the last 30 days count; nothing eaten in them → null", () => {
    const old = [{ date: "2026-09-03", amount: 500 }]; // 30 days before 3/10: outside (window is 4/9…3/10)
    expect(consumptionRate(old, LOGGED, TODAY)).toBeNull();
    expect(consumptionRate([{ date: "2026-09-04", amount: 300 }], ["2026-09-04", TODAY], TODAY)?.perDay).toBe(150);
  });
});

describe("forecast and suggestions", () => {
  const rate = (perDay: number, typicalDay = perDay) => ({ perDay, typicalDay, days: 4 });

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
    expect(monthlyUse({ perDay: 200, typicalDay: 200, days: 4 }, 1000, cost(440, 1000))).toEqual({
      packageEveryDays: 5,
      packagesPerMonth: 6,
      costPerMonthCents: 2640,
    });
  });

  it("chia: every 10 days, 3 a month, 450 g × 1,99 € / 150 g = 5,97 €", () => {
    expect(monthlyUse({ perDay: 15, typicalDay: 15, days: 4 }, 150, cost(199, 150))).toEqual({
      packageEveryDays: 10,
      packagesPerMonth: 3,
      costPerMonthCents: 597,
    });
  });

  it("unknown cost stays null (never bought), never 0; no package → only the cost", () => {
    expect(monthlyUse({ perDay: 50, typicalDay: 50, days: 4 }, 454, null)).toMatchObject({ costPerMonthCents: null, packagesPerMonth: 3.303964757709251 });
    expect(monthlyUse({ perDay: 120, typicalDay: 120, days: 2 }, null, cost(47, 480))).toEqual({
      packageEveryDays: null,
      packagesPerMonth: null,
      costPerMonthCents: 353, // 3600 g × 47 / 480 = 352.5 → 353
    });
  });
});
