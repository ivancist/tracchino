import { beforeEach, describe, expect, it } from "vitest";
import type { DietAnalysis, SimulationResult } from "../../shared/api";
import { todayRome } from "../../shared/dates";
import { createTestApi } from "../helpers/api";
import { resetDb } from "../helpers/db";

let api: Awaited<ReturnType<typeof createTestApi>>;
let pasta: number;
let riso: number;
let banana: number;
let olio: number;
const PERIOD = "from=2026-10-01&to=2026-10-02";

beforeEach(async () => {
  await resetDb();
  api = await createTestApi();
  const storeId = await api.store();
  pasta = await api.product({ name: "Spaghetti", unit: "g", packageAmount: 500, kcal100: 359, protein100: 12.5, fat100: 2, carbs100: 71, sugars100: 3.5 });
  riso = await api.product({ name: "Riso", unit: "g", packageAmount: 2000, kcal100: 350, protein100: 7, fat100: 0.6, carbs100: 78, sugars100: 0.2 });
  banana = await api.product({ name: "Banane", unit: "g", avgPieceAmount: 120, kcal100: 89, protein100: 1.1, fat100: 0.3, carbs100: 22.8 });
  olio = await api.product({ name: "Olio", unit: "ml", kcal100: 822 }); // never bought
  // Pasta 287 cents / 1500 g, rice 449 / 2000 g, bananas 179 / ≈ 720 g
  await api.receipt({ storeId, date: "2026-09-20", items: [{ productId: pasta, priceFullCents: 89, packages: 1 }] });
  await api.receipt({
    storeId,
    date: "2026-09-28",
    items: [
      { productId: pasta, priceFullCents: 198, packages: 2 },
      { productId: riso, priceFullCents: 449, packages: 1 },
      { productId: banana, priceFullCents: 179, pieces: 6 },
    ],
  });
  for (const [date, productId, amount] of [
    ["2026-10-01", pasta, 80],
    ["2026-10-01", banana, 120],
    ["2026-10-02", pasta, 100],
    ["2026-10-02", olio, 10],
  ] as const) {
    expect((await api.post("/api/diary", { date, meal: "pranzo", productId, amount })).status).toBe(201);
  }
});

describe("GET /api/analysis", () => {
  it("diet cost over logged days and per-product value, from real receipts and diary", async () => {
    const { status, body } = await api.get<DietAnalysis>(`/api/analysis?${PERIOD}`);
    expect(status).toBe(200);
    // Day 1: 15 + 30 cents; day 2: 19 + oil unknown → mean 32, weekly 224
    expect(body.summary.days.map((d) => [d.date, d.cost])).toEqual([
      ["2026-10-01", { value: 45, missing: 0 }],
      ["2026-10-02", { value: 19, missing: 1 }],
    ]);
    expect(body.summary.dailyMean.cost).toBe(32);
    expect(body.summary.weeklyCostEstimate).toBe(224);
    expect(body.summary.entriesWithoutCost).toBe(1);

    const p = Object.fromEntries(body.products.map((x) => [x.name, x]));
    expect(p.Spaghetti).toMatchObject({ eatenAmount: 180, eatenDays: 2, boughtAmount: 0, boughtDays: 0 });
    expect(p.Spaghetti!.per100KcalCents).toBeCloseTo(5.33, 2);
    expect(p.Spaghetti!.per10gProteinCents).toBeCloseTo(15.31, 2);
    expect(p.Banane).toMatchObject({ costEstimated: true });
    expect(p.Banane!.per100KcalCents).toBeCloseTo(27.93, 2);
    expect(p.Olio).toMatchObject({ per100KcalCents: null, per10gProteinCents: null });
    expect(p.Riso).toBeUndefined(); // neither eaten nor bought in the period
  });

  it("cost mode 'last' uses the latest purchase (pasta: 198 cents / 1000 g)", async () => {
    const { body } = await api.get<DietAnalysis>(`/api/analysis?${PERIOD}&costMode=last`);
    // Day 1: pasta 80 × 0.198 = 15.84 → 16, bananas 30; day 2: pasta 19.8 → 20 → mean (46 + 20) / 2 = 33
    expect(body.summary.dailyMean.cost).toBe(33);
  });

  it("empty diary: nothing to analyse", async () => {
    await resetDb();
    const { body } = await api.get<DietAnalysis>("/api/analysis");
    expect(body.firstDiaryDate).toBeNull();
    expect(body.summary.days).toEqual([]);
    expect(body.summary.dailyMean.cost).toBeNull();
  });

  it("purchases in the period count as bought", async () => {
    const { body } = await api.get<DietAnalysis>("/api/analysis?from=2026-09-01&to=2026-10-02");
    const p = Object.fromEntries(body.products.map((x) => [x.name, x]));
    expect(p.Spaghetti).toMatchObject({ eatenAmount: 180, boughtAmount: 1500, boughtLines: 2, boughtDays: 2 });
    expect(p.Riso).toMatchObject({ eatenAmount: 0, boughtAmount: 2000 });
  });

  it("defaults to the first diary day; validates the period", async () => {
    const { body } = await api.get<DietAnalysis>("/api/analysis?to=2026-10-05");
    expect(body).toMatchObject({ from: "2026-10-01", to: "2026-10-05", firstDiaryDate: "2026-10-01" });
    expect((await api.get("/api/analysis?from=2026-10-05&to=2026-10-01")).status).toBe(400);
    expect((await api.get("/api/analysis?from=2999-01-01")).status).toBe(400); // after the default "to" (today)
    expect((await api.get("/api/analysis?from=2000-01-01&to=2026-10-01")).status).toBe(400);
    expect((await api.get("/api/analysis?from=ieri")).status).toBe(400);
    expect((await api.get("/api/analysis?costMode=cheap")).status).toBe(400);
  });
});

describe("today in progress", () => {
  const today = todayRome();
  const period = `from=${today}&to=${today}`; // only today: the fixtures above are on past days

  it("is left out of the diet until breakfast, lunch and dinner are logged", async () => {
    await api.post("/api/diary", { date: today, meal: "colazione", productId: banana, amount: 120 }); // 106.8 kcal so far
    let a = (await api.get<DietAnalysis>(`/api/analysis?${period}`)).body;
    expect(a.todayExcluded).toBe(true);
    expect(a.summary.days).toEqual([]);
    expect(a.summary.dailyMean.kcal).toBeNull(); // unknown, not a 106.8 kcal day
    expect((await api.get<SimulationResult>(`/api/analysis/simulate?${period}&fromProduct=${pasta}&toProduct=${pasta}`)).body).toMatchObject({
      loggedDays: 0,
      todayExcluded: true,
    });

    await api.post("/api/diary", { date: today, meal: "pranzo", productId: pasta, amount: 100 }); // 359
    await api.post("/api/diary", { date: today, meal: "cena", productId: riso, amount: 100 }); // 350
    a = (await api.get<DietAnalysis>(`/api/analysis?${period}`)).body;
    expect(a.todayExcluded).toBe(false);
    expect(a.summary.days).toHaveLength(1);
    expect(a.summary.dailyMean.kcal!).toBeCloseTo(815.8, 5); // 106.8 + 359 + 350
  });

  it("a past period is never affected", async () => {
    expect((await api.get<DietAnalysis>(`/api/analysis?${PERIOD}`)).body.todayExcluded).toBe(false);
  });
});

describe("GET /api/analysis/simulate", () => {
  const sim = async (q: string) => (await api.get<SimulationResult>(`/api/analysis/simulate?${PERIOD}&${q}`)).body;

  it("replacing A with A changes nothing", async () => {
    const s = await sim(`fromProduct=${pasta}&toProduct=${pasta}`);
    expect(s).toMatchObject({ affectedEntries: 2, affectedDays: 2, loggedDays: 2 });
    // Saturated fat and fibre aren't set on these products: unknown, not 0
    expect(s.delta).toEqual({ cost: 0, kcal: 0, protein: 0, fat: 0, saturatedFat: null, carbs: 0, sugars: 0, fiber: null, salt: null });
  });

  it("pasta → rice: +6 cents, −16.2 kcal; at 1.5×: +27 cents", async () => {
    const s = await sim(`fromProduct=${pasta}&toProduct=${riso}`);
    expect(s.before.cost).toBe(34);
    expect(s.after.cost).toBe(40);
    expect(s.delta.kcal).toBeCloseTo(-16.2, 10);
    expect((await sim(`fromProduct=${pasta}&toProduct=${riso}&factor=1.5`)).delta.cost).toBe(27);
  });

  it("unknown cost → unknown difference", async () => {
    const ceci = await api.product({ name: "Ceci", unit: "g", kcal100: 120 }); // never bought
    expect((await sim(`fromProduct=${banana}&toProduct=${ceci}`)).delta.cost).toBeNull();
  });

  it("400 on invalid input", async () => {
    for (const q of [
      `fromProduct=${pasta}`,
      `fromProduct=${pasta}&toProduct=9999`,
      `fromProduct=${pasta}&toProduct=${riso}&factor=0`,
      `fromProduct=${pasta}&toProduct=${riso}&factor=10.01`,
      `fromProduct=x&toProduct=${riso}`,
      `fromProduct=${pasta}&toProduct=${olio}`, // grams vs millilitres
    ]) {
      expect((await api.get(`/api/analysis/simulate?${PERIOD}&${q}`)).status, q).toBe(400);
    }
  });

  it("401 without Access", async () => {
    expect((await api.call("GET", `/api/analysis?${PERIOD}`, undefined, { auth: false })).status).toBe(401);
    expect((await api.call("GET", `/api/analysis/simulate?${PERIOD}&fromProduct=1&toProduct=1`, undefined, { auth: false })).status).toBe(401);
  });
});
