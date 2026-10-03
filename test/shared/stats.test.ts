import { describe, expect, it } from "vitest";
import { addDays, eachDay, isoWeek, weekStart } from "../../shared/dates";
import { mean, median, priceStatsByStore, purchaseFrequency, summarizeSpending, type PurchaseLine } from "../../shared/stats";

describe("mean / median", () => {
  it("odd count", () => {
    expect(median([500, 0, 1200])).toBe(500);
    expect(mean([500, 0, 1200])).toBe(567); // 1700 / 3 = 566.67
  });
  it("even count: average of the two middle values", () => {
    expect(median([0, 0, 300, 1000])).toBe(150);
    expect(median([1, 2])).toBe(2); // 1.5 rounds half up
  });
  it("is null (not 0) without data", () => {
    expect(mean([])).toBeNull();
    expect(median([])).toBeNull();
  });
});

describe("ISO weeks and dates", () => {
  it.each([
    ["2026-10-02", "2026-09-28"], // Friday → Monday
    ["2026-09-28", "2026-09-28"], // Monday
    ["2026-10-04", "2026-09-28"], // Sunday
    ["2027-01-01", "2026-12-28"], // across the year
    ["2026-03-01", "2026-02-23"], // across the month (non-leap February)
  ])("weekStart(%s) = %s", (d, monday) => expect(weekStart(d)).toBe(monday));

  it("numbers weeks per ISO-8601 (week-year of the Thursday)", () => {
    expect(isoWeek("2026-01-01")).toEqual({ year: 2026, week: 1 }); // Thursday
    expect(isoWeek("2026-12-31")).toEqual({ year: 2026, week: 53 });
    expect(isoWeek("2027-01-03")).toEqual({ year: 2026, week: 53 }); // Sunday
    expect(isoWeek("2027-01-04")).toEqual({ year: 2027, week: 1 });
    expect(isoWeek("2025-12-29")).toEqual({ year: 2026, week: 1 }); // Monday of week 1 of 2026
  });

  it("iterates days across DST changes without skipping or repeating", () => {
    // Europe/Rome switches on 2026-03-29 and 2026-10-25; dates are pure calendar days (UTC math)
    expect(eachDay("2026-10-24", "2026-10-26")).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(eachDay("2026-10-02", "2026-10-01")).toEqual([]);
  });
});

describe("summarizeSpending (fixture, hand-computed)", () => {
  // Period: Thu 2026-12-24 → Sun 2027-01-10 (18 days), crossing the year.
  // ISO weeks: 21–27 Dec (partial: starts before 24), 28 Dec–3 Jan (complete), 4–10 Jan (complete).
  const byDate = new Map([
    ["2026-12-24", 3000], // partial week
    ["2026-12-29", 1250],
    ["2027-01-02", 750], // same week as 29 Dec → week total 2000
    ["2027-01-05", 4500], // week total 4500
  ]);
  const s = summarizeSpending(byDate, "2026-12-24", "2027-01-10");

  it("fills every calendar day, 0 where nothing was bought", () => {
    expect(s.days).toHaveLength(18);
    expect(s.days.filter((d) => d.totalCents === 0)).toHaveLength(14);
    expect(s.totalCents).toBe(9500);
  });

  it("daily mean and median include zero days", () => {
    // 9500 / 18 = 527.78 → 528; 18 values, 14 zeros → both middle values are 0
    expect(s.daily).toEqual({ mean: 528, median: 0, count: 18 });
  });

  it("weekly stats use every week of the period, partial ones included (owner's choice)", () => {
    expect(s.weeks.map((w) => [w.weekStart, w.totalCents, w.complete])).toEqual([
      ["2026-12-21", 3000, false],
      ["2026-12-28", 2000, true],
      ["2027-01-04", 4500, true],
    ]);
    // all weeks: 3000, 2000, 4500 → mean 9500 / 3 = 3166.67 → 3167, median 3000; 1 partial
    expect(s.weekly).toEqual({ mean: 3167, median: 3000, count: 3, partial: 1 });
  });

  it("handles a period with no purchases and a single day", () => {
    const empty = summarizeSpending(new Map(), "2026-10-01", "2026-10-01");
    expect(empty.daily).toEqual({ mean: 0, median: 0, count: 1 });
    expect(empty.weekly).toEqual({ mean: 0, median: 0, count: 1, partial: 1 });
  });

  it("odd number of days with a non-zero median", () => {
    // Mon 5 → Fri 9 Oct 2026: 100, 0, 300, 0, 200 → sorted 0 0 100 200 300 → median 100, mean 600/5 = 120
    const odd = summarizeSpending(
      new Map([["2026-10-05", 100], ["2026-10-07", 300], ["2026-10-09", 200]]),
      "2026-10-05",
      "2026-10-09",
    );
    expect(odd.daily).toEqual({ mean: 120, median: 100, count: 5 });
    expect(odd.weekly).toEqual({ mean: 600, median: 600, count: 1, partial: 1 }); // Mon–Fri: week cut at Sunday
  });
});

describe("priceStatsByStore (estimated quantities)", () => {
  const bananas = { unit: "g", packageAmount: null, avgPieceAmount: 120 } as const;
  const line = (storeId: number, date: string, pricePaidCents: number, pieces: number | null, amount: number | null, product: { unit: "g" | "pz"; packageAmount: number | null; avgPieceAmount: number | null } = bananas): PurchaseLine => ({
    ...product,
    date,
    storeId,
    storeName: `S${storeId}`,
    chainName: storeId === 1 ? "Esselunga" : "Lidl",
    packages: null,
    pieces,
    amount,
    pricePaidCents,
  });

  const stats = priceStatsByStore(
    [
      // Esselunga: 1.79 € for 850 g (6 pz) + 1.50 € for 5 pz (≈ 600 g) → 329 / 1450 g = 2.2690 €/kg ≈ 2.27, estimated
      //            per piece: 329 / 11 = 29.9 → 30
      line(1, "2026-09-01", 179, 6, 850),
      line(1, "2026-09-15", 150, 5, null),
      // Lidl: 1.29 € for 700 g → 1.8429 €/kg ≈ 1.84, measured; no pieces
      line(2, "2026-09-10", 129, null, 700),
    ],
    { metric: "kilo", volume: false },
  );

  it("sorts cheapest €/kg first and weights by quantity (not an average of unit prices)", () => {
    expect(stats.map((s) => s.chainName)).toEqual(["Lidl", "Esselunga"]);
    expect(stats[0]).toMatchObject({ perKilo: { cents: 184, estimated: false, lines: 1 }, perPiece: null, purchases: 1 });
    expect(stats[1]).toMatchObject({
      perKilo: { cents: 227, estimated: true, lines: 2 },
      perPiece: { cents: 30, lines: 2 },
      purchases: 2,
      lastDate: "2026-09-15",
      lastPaidCents: 150,
    });
  });

  it("counts pieces over every package: 2 packs of 6 eggs are 12 eggs", () => {
    const eggs = { unit: "g", packageAmount: null, avgPieceAmount: null } as const;
    const r = priceStatsByStore(
      [
        // Store 1: 2 packs × 6 for 3.98 € → 398 / 12 = 33.2 → 33 c/egg; store 2: 1 pack × 10 for 3.50 € → 35 c/egg
        { ...line(1, "2026-09-01", 398, 6, null, eggs), packages: 2 },
        { ...line(2, "2026-09-01", 350, 10, null, eggs), packages: 1 },
      ],
      { metric: "piece", volume: false },
    );
    expect(r.map((s) => [s.storeId, s.perPiece?.cents])).toEqual([
      [1, 33],
      [2, 35],
    ]);
  });

  it("puts stores without a comparable unit price last", () => {
    const lettuce = { unit: "pz", packageAmount: null, avgPieceAmount: null } as const;
    const r = priceStatsByStore([line(1, "2026-09-01", 99, null, null, lettuce), line(2, "2026-09-01", 120, 2, null, lettuce)], {
      metric: "piece",
      volume: false,
    });
    expect(r.map((s) => [s.storeId, s.perPiece?.cents ?? null])).toEqual([
      [2, 60],
      [1, null],
    ]);
  });
});

describe("priceStatsByStore never blends metrics", () => {
  const base = { storeName: "S", chainName: "C", packages: null as number | null, pieces: null as number | null };
  it("ignores volume lines when ranking by €/kg (group mixing g and ml)", () => {
    const r = priceStatsByStore(
      [
        { ...base, unit: "g", packageAmount: null, avgPieceAmount: null, date: "2026-09-01", storeId: 1, amount: 1000, pricePaidCents: 300 },
        { ...base, unit: "ml", packageAmount: null, avgPieceAmount: null, date: "2026-09-01", storeId: 2, amount: 1000, pricePaidCents: 100 },
      ],
      { metric: "kilo", volume: false },
    );
    // store 2 only sold a volume product: no €/kg, so its 1,00 €/l doesn't make it "cheaper"
    expect(r.map((x) => [x.storeId, x.perKilo?.cents ?? null])).toEqual([
      [1, 300],
      [2, null],
    ]);
  });
  it("ranks by €/piece without falling back to €/kg", () => {
    const r = priceStatsByStore(
      [
        { ...base, unit: "pz", packageAmount: null, avgPieceAmount: 60, date: "2026-09-01", storeId: 1, pieces: null, amount: 600, pricePaidCents: 100 },
        { ...base, unit: "pz", packageAmount: null, avgPieceAmount: 60, date: "2026-09-01", storeId: 2, pieces: 12, amount: null, pricePaidCents: 360 },
      ],
      { metric: "piece", volume: false },
    );
    // store 1 has only €/kg (no pieces): it must not outrank store 2's 0,30 €/pz
    expect(r.map((x) => x.storeId)).toEqual([2, 1]);
  });
});

describe("purchaseFrequency", () => {
  it("averages the gap between distinct purchase days", () => {
    // days 1, 8, 22 Sep → gaps 7 and 14 → 10.5
    expect(purchaseFrequency(["2026-09-08", "2026-09-01", "2026-09-22", "2026-09-22"])).toEqual({
      purchases: 4,
      days: 3,
      firstDate: "2026-09-01",
      lastDate: "2026-09-22",
      avgIntervalDays: 10.5,
    });
  });
  it("has no interval with a single day", () => {
    expect(purchaseFrequency(["2026-09-01"]).avgIntervalDays).toBeNull();
    expect(purchaseFrequency([]).firstDate).toBeNull();
  });
});
