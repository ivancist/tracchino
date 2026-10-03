import { beforeEach, describe, expect, it } from "vitest";
import type { DiaryDay, FrequentProduct, PastMeal, Portion } from "../../shared/api";
import { addDays, todayRome } from "../../shared/dates";
import { createTestApi } from "../helpers/api";
import { resetDb } from "../helpers/db";

let api: Awaited<ReturnType<typeof createTestApi>>;
let pasta: number;
let banana: number;
let olio: number;
let storeId: number;
const DAY = "2026-10-01";

beforeEach(async () => {
  await resetDb();
  api = await createTestApi();
  storeId = await api.store();
  pasta = await api.product({ name: "Spaghetti", unit: "g", packageAmount: 500, kcal100: 359, protein100: 12.5, fat100: 2, carbs100: 71, sugars100: 3.5 });
  banana = await api.product({ name: "Banane", unit: "g", avgPieceAmount: 120, kcal100: 89, protein100: 1.1, fat100: 0.3, carbs100: 22.8 });
  olio = await api.product({ name: "Olio", unit: "ml", kcal100: 822 }); // never bought
  // Pasta: 89 + 198 cents for 500 + 1000 g within 90 days; bananas: 179 cents for 6 × ~120 g
  await api.receipt({ storeId, date: "2026-09-01", items: [{ productId: pasta, priceFullCents: 89, pieces: 1 }] });
  await api.receipt({
    storeId,
    date: "2026-09-20",
    items: [
      { productId: pasta, priceFullCents: 218, discountCents: 20, pieces: 2 },
      { productId: banana, priceFullCents: 179, pieces: 6 },
    ],
  });
});

const day = async (query = "") => (await api.get<DiaryDay>(`/api/diary?date=${DAY}${query}`)).body;
const add = (body: Record<string, unknown>) => api.post<{ id: number }>("/api/diary", { date: DAY, meal: "pranzo", ...body });

describe("diary", () => {
  it("computes nutrients and cost per entry and for the day; never-bought stays n.d.", async () => {
    expect((await add({ productId: pasta, amount: 80 })).status).toBe(201);
    expect((await add({ productId: olio, amount: 10, meal: "cena" })).status).toBe(201);
    expect((await add({ productId: banana, amount: 120, meal: "colazione" })).status).toBe(201);

    const d = await day();
    expect(d.entries.map((e) => [e.meal, e.productName])).toEqual([
      ["colazione", "Banane"],
      ["pranzo", "Spaghetti"],
      ["cena", "Olio"],
    ]);
    const [b, p, o] = d.entries;
    // Pasta 80 g: 359 × 0.8 = 287.2 kcal; cost 80 × 287 / 1500 = 15.31 → 15 cents
    expect(p!.nutrients.kcal).toBeCloseTo(287.2, 10);
    expect(p).toMatchObject({ costCents: 15, costSource: "average", costEstimated: false });
    // Bananas 120 g: 179 cents / 720 g estimated → 120 × 179 / 720 = 29.83 → 30
    expect(b).toMatchObject({ costCents: 30, costEstimated: true });
    expect(b!.nutrients.sugars).toBeNull();
    // Oil: never bought → unknown cost, not free
    expect(o).toMatchObject({ costCents: null, costSource: null });
    expect(o!.nutrients.kcal).toBeCloseTo(82.2, 10);

    expect(d.cost).toEqual({ value: 45, missing: 1 });
    expect(d.totals.kcal.value).toBeCloseTo(106.8 + 287.2 + 82.2, 10);
    expect(d.totals.sugars).toMatchObject({ missing: 2 }); // bananas and oil have no sugars value
    expect(d.totals.sugars.value).toBeCloseTo(2.8, 10); // 3.5 × 0.8
  });

  it("cost mode 'last' uses the latest purchase", async () => {
    await add({ productId: pasta, amount: 80 });
    const d = await day("&costMode=last");
    // Last purchase: 198 cents (218 − 20) for 2 × 500 g → 80 × 198 / 1000 = 15.84 → 16
    expect(d.entries[0]).toMatchObject({ costCents: 16, costSource: "last" });
    expect(d.costMode).toBe("last");
  });

  it("portions: saved per product, portion × quantity stored as grams", async () => {
    const created = await api.post<{ id: number }>(`/api/products/${banana}/portions`, { name: "1 banana", amount: 120 });
    expect(created.status).toBe(201);
    const portions = (await api.get<Portion[]>(`/api/products/${banana}/portions`)).body;
    expect(portions).toEqual([{ id: created.body.id, productId: banana, name: "1 banana", amount: 120 }]);

    expect((await add({ productId: banana, portionId: created.body.id, portionQty: 1.5 })).status).toBe(201);
    const [e] = (await day()).entries;
    expect(e).toMatchObject({ amount: 180, portionName: "1 banana", portionQty: 1.5 });

    // A portion of another product is rejected, on create and on edit
    expect((await add({ productId: pasta, portionId: created.body.id, portionQty: 1 })).status).toBe(400);
    const entryId = (await day()).entries[0]!.id;
    expect((await api.patch(`/api/diary/${entryId}`, { date: DAY, meal: "pranzo", productId: pasta, portionId: created.body.id, portionQty: 1 })).status).toBe(400);
    expect((await api.patch(`/api/diary/abc`, { date: DAY, meal: "pranzo", productId: pasta, amount: 1 })).status).toBe(400);

    // Deleting the portion keeps the eaten grams
    expect((await api.del(`/api/portions/${created.body.id}`)).status).toBe(204);
    expect((await day()).entries[0]).toMatchObject({ amount: 180, portionId: null, portionName: null, portionQty: null });
    expect((await api.del(`/api/portions/${created.body.id}`)).status).toBe(404);
  });

  it("a portion can be renamed and resized; past entries keep their grams", async () => {
    const pid = (await api.post<{ id: number }>(`/api/products/${banana}/portions`, { name: "1 banana", amount: 120 })).body.id;
    await add({ productId: banana, portionId: pid, portionQty: 1 });
    expect((await api.patch(`/api/portions/${pid}`, { name: "1 banana grande", amount: 150 })).status).toBe(200);
    expect((await day()).entries[0]).toMatchObject({ amount: 120, portionName: "1 banana grande" });
    // Editing the past entry with the same portion keeps the weight it had (120 g), whatever the portion is today
    const entryId = (await day()).entries[0]!.id;
    const patch = (body: Record<string, unknown>) => api.patch(`/api/diary/${entryId}`, { date: DAY, meal: "cena", productId: banana, ...body });
    expect((await patch({ portionId: pid, portionQty: 1 })).status).toBe(200);
    expect((await day()).entries[0]).toMatchObject({ meal: "cena", amount: 120 });
    expect((await patch({ portionId: pid, portionQty: 2 })).status).toBe(200);
    expect((await day()).entries[0]).toMatchObject({ amount: 240, portionQty: 2 }); // 2 × 120, not 2 × 150
    // Another portion → today's weight of that portion; back to the first one → its weight today
    const half = (await api.post<{ id: number }>(`/api/products/${banana}/portions`, { name: "mezza banana", amount: 60 })).body.id;
    await patch({ portionId: half, portionQty: 1 });
    expect((await day()).entries[0]).toMatchObject({ amount: 60, portionId: half });
    await patch({ portionId: pid, portionQty: 1 });
    expect((await day()).entries[0]).toMatchObject({ amount: 150, portionId: pid });
    // New entries and repeats use today's weight
    await add({ productId: banana, portionId: pid, portionQty: 1, meal: "snack" });
    expect((await day()).entries.find((e) => e.meal === "snack")).toMatchObject({ amount: 150 });
    const past = (await api.get<PastMeal[]>(`/api/diary/meals?meal=snack&before=2026-10-02`)).body;
    expect(past[0]!.items[0]).toMatchObject({ amount: 150, portionAmount: 150 });

    expect((await api.patch(`/api/portions/${pid}`, { name: "x", amount: 0 })).status).toBe(400);
    expect((await api.patch(`/api/portions/9999`, { name: "x", amount: 10 })).status).toBe(404);
  });

  it("windowDays narrows the average (and is validated)", async () => {
    await add({ productId: pasta, amount: 80 });
    // 11 days back from 2026-10-01 (from 2026-09-20): only the 2026-09-20 purchase (198 cents / 1000 g) → 15.84 → 16
    expect((await day("&windowDays=11")).entries[0]).toMatchObject({ costCents: 16, costSource: "average" });
    expect((await day("&windowDays=11")).windowDays).toBe(11);
    expect((await api.get(`/api/diary?date=${DAY}&windowDays=0`)).status).toBe(400);
    expect((await api.get(`/api/diary?date=${DAY}&windowDays=abc`)).status).toBe(400);
  });

  it("merging products carries diary entries and portions to the target", async () => {
    const dup = await api.product({ name: "Banane bio", unit: "g" });
    const pid = (await api.post<{ id: number }>(`/api/products/${dup}/portions`, { name: "1 banana", amount: 120 })).body.id;
    await add({ productId: dup, portionId: pid, portionQty: 2 });
    expect((await api.post(`/api/products/${dup}/merge`, { intoId: banana })).status).toBe(200);
    const [e] = (await day()).entries;
    expect(e).toMatchObject({ productId: banana, amount: 240, portionId: pid });
    expect((await api.get<Portion[]>(`/api/products/${banana}/portions`)).body.map((p) => p.id)).toEqual([pid]);
  });

  it("edits and deletes entries", async () => {
    const { body } = await add({ productId: pasta, amount: 80 });
    expect((await api.patch(`/api/diary/${body.id}`, { date: DAY, meal: "cena", productId: pasta, amount: 100 })).status).toBe(200);
    expect((await day()).entries[0]).toMatchObject({ meal: "cena", amount: 100 });
    expect((await api.del(`/api/diary/${body.id}`)).status).toBe(204);
    expect((await day()).entries).toEqual([]);
    expect((await api.del(`/api/diary/${body.id}`)).status).toBe(404);
    expect((await api.patch(`/api/diary/999`, { date: DAY, meal: "cena", productId: pasta, amount: 1 })).status).toBe(404);
  });

  it("an empty day has unknown totals, not zeros", async () => {
    const d = await day();
    expect(d.cost).toEqual({ value: null, missing: 0 });
    expect(d.totals.kcal).toEqual({ value: null, missing: 0 });
  });

  it("rejects invalid input (400)", async () => {
    const bad: Record<string, unknown>[] = [
      { productId: pasta }, // neither grams nor portion
      { productId: pasta, amount: 80, portionId: 1, portionQty: 1 }, // both
      { productId: pasta, portionId: 1 }, // portion without quantity
      { productId: pasta, amount: 0 },
      { productId: pasta, amount: 80, meal: "merenda" },
      { productId: pasta, amount: 80, date: "2026-02-30" },
      { productId: 9999, amount: 80 }, // unknown product
    ];
    for (const b of bad) expect((await add(b)).status, JSON.stringify(b)).toBe(400);
    expect((await api.get("/api/diary?date=ieri")).status).toBe(400);
    expect((await api.get(`/api/diary?date=${DAY}&costMode=cheap`)).status).toBe(400);
    expect((await api.post(`/api/products/${pasta}/portions`, { name: "", amount: 80 })).status).toBe(400);
    expect((await api.post(`/api/products/9999/portions`, { name: "x", amount: 80 })).status).toBe(404);
  });

  it("a product used in the diary can't be deleted (merge it instead)", async () => {
    await add({ productId: olio, amount: 10 });
    expect((await api.del(`/api/products/${olio}`)).status).toBe(409);
  });

  it("lists recently eaten products, most used first", async () => {
    const today = todayRome();
    for (const amount of [10, 20]) await api.post("/api/diary", { date: today, meal: "cena", productId: olio, amount });
    await api.post("/api/diary", { date: addDays(today, -1), meal: "pranzo", productId: pasta, amount: 80 });
    await api.post("/api/diary", { date: addDays(today, -200), meal: "pranzo", productId: banana, amount: 80 }); // too old
    const f = (await api.get<FrequentProduct[]>("/api/diary/frequent")).body;
    expect(f).toEqual([
      { productId: olio, uses: 2, lastDate: today },
      { productId: pasta, uses: 1, lastDate: addDays(today, -1) },
    ]);
  });

  it("401 without Access", async () => {
    expect((await api.call("GET", `/api/diary?date=${DAY}`, undefined, { auth: false })).status).toBe(401);
    expect((await api.call("POST", "/api/diary", { date: DAY }, { auth: false })).status).toBe(401);
  });
});

describe("repeating past meals", () => {
  const entry = (date: string, meal: string, productId: number, amount: number) => ({ date, meal, productId, amount });

  it("lists past meals of the same kind before the day, identical ones merged", async () => {
    // The usual breakfast on 3 days (different entry order once), a different one on 09-29, a lunch, and one after the day
    const rows = [
      entry("2026-09-30", "colazione", banana, 120), entry("2026-09-30", "colazione", pasta, 80),
      entry("2026-09-29", "colazione", banana, 240),
      entry("2026-09-28", "colazione", pasta, 80), entry("2026-09-28", "colazione", banana, 120),
      entry("2026-09-27", "colazione", banana, 120), entry("2026-09-27", "colazione", pasta, 80),
      entry("2026-09-30", "pranzo", olio, 10),
      entry("2026-10-01", "colazione", olio, 5), // the day itself: not "before"
    ];
    for (const r of rows) expect((await api.post("/api/diary", r)).status).toBe(201);
    const pid = (await api.post<{ id: number }>(`/api/products/${banana}/portions`, { name: "1 banana", amount: 120 })).body.id;
    await api.post("/api/diary", { date: "2026-08-01", meal: "colazione", productId: banana, portionId: pid, portionQty: 1 });

    const { status, body } = await api.get<PastMeal[]>(`/api/diary/meals?meal=colazione&before=${DAY}`);
    expect(status).toBe(200);
    expect(body.map((m) => m.dates)).toEqual([["2026-09-30", "2026-09-28", "2026-09-27"], ["2026-09-29"], ["2026-08-01"]]);
    expect(body[0]!.items.map((i) => [i.productName, i.amount])).toEqual([["Banane", 120], ["Spaghetti", 80]]);
    expect(body[2]!.items[0]).toMatchObject({ portionId: pid, portionName: "1 banana", portionQty: 1, amount: 120, unit: "g" });
    expect((await api.get<PastMeal[]>(`/api/diary/meals?meal=colazione&before=${DAY}&limit=1`)).body).toHaveLength(1);
    expect((await api.get<PastMeal[]>(`/api/diary/meals?meal=snack&before=${DAY}`)).body).toEqual([]);
  });

  it("adds several entries at once", async () => {
    const pid = (await api.post<{ id: number }>(`/api/products/${banana}/portions`, { name: "1 banana", amount: 120 })).body.id;
    const res = await api.post<{ ids: number[] }>("/api/diary/batch", {
      entries: [
        { date: DAY, meal: "colazione", productId: pasta, amount: 80 },
        { date: DAY, meal: "colazione", productId: banana, portionId: pid, portionQty: 2 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.ids).toHaveLength(2);
    expect((await day()).entries.map((e) => [e.productName, e.amount])).toEqual([["Spaghetti", 80], ["Banane", 240]]);
  });

  it("all or nothing: one invalid entry saves none", async () => {
    const other = (await api.post<{ id: number }>(`/api/products/${pasta}/portions`, { name: "1 piatto", amount: 90 })).body.id;
    const res = await api.post("/api/diary/batch", {
      entries: [
        { date: DAY, meal: "pranzo", productId: pasta, amount: 80 },
        { date: DAY, meal: "pranzo", productId: banana, portionId: other, portionQty: 1 }, // portion of another product
      ],
    });
    expect(res.status).toBe(400);
    expect((await day()).entries).toEqual([]);
    expect((await api.post("/api/diary/batch", { entries: [] })).status).toBe(400);
    expect((await api.post("/api/diary/batch", { entries: [{ date: DAY, meal: "pranzo", productId: pasta }] })).status).toBe(400);
    expect((await api.get(`/api/diary/meals?meal=merenda&before=${DAY}`)).status).toBe(400);
    expect((await api.get(`/api/diary/meals?meal=pranzo`)).status).toBe(400);
  });

  it("401 without Access", async () => {
    expect((await api.call("GET", `/api/diary/meals?meal=pranzo&before=${DAY}`, undefined, { auth: false })).status).toBe(401);
    expect((await api.call("POST", "/api/diary/batch", { entries: [] }, { auth: false })).status).toBe(401);
  });
});
