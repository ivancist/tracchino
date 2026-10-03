import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { PantryItem, ShoppingListItem } from "../../shared/api";
import { addDays, todayRome } from "../../shared/dates";
import { createTestApi } from "../helpers/api";
import { resetDb } from "../helpers/db";

let api: Awaited<ReturnType<typeof createTestApi>>;
let storeId: number;
let tuna: number;
let yogurtA: number;
let yogurtB: number;

beforeEach(async () => {
  await resetDb();
  api = await createTestApi();
  storeId = await api.store();
  const group = (await api.post<{ id: number }>("/api/groups", { name: "Yogurt" })).body.id;
  tuna = await api.product({ name: "Tonno", unit: "g", packageAmount: 112 });
  yogurtA = await api.product({ name: "Yogurt greco", brand: "A", unit: "g", packageAmount: 1000, groupId: group });
  yogurtB = await api.product({ name: "Yogurt greco", brand: "B", unit: "g", packageAmount: 500, groupId: group });
});

const list = async () => (await api.get<ShoppingListItem[]>("/api/shopping-list")).body.map((i) => [i.name, i.brand, i.packages]);

describe("/api/shopping-list", () => {
  it("adds products and free-text items; the same product twice adds up", async () => {
    expect((await api.post("/api/shopping-list", { productId: tuna, packages: 2 })).status).toBe(201);
    expect((await api.post("/api/shopping-list", { name: "Candele" })).status).toBe(201);
    expect((await api.post("/api/shopping-list", { productId: tuna, packages: 1 })).status).toBe(200);
    expect(await list()).toEqual([
      ["Tonno", null, 3],
      ["Candele", null, null],
    ]);
  });

  it("changes the packages and removes items", async () => {
    const { id } = (await api.post<{ id: number }>("/api/shopping-list", { productId: tuna })).body;
    expect((await api.patch(`/api/shopping-list/${id}`, { packages: 4 })).status).toBe(200);
    expect(await list()).toEqual([["Tonno", null, 4]]);
    expect((await api.del(`/api/shopping-list/${id}`)).status).toBe(204);
    expect(await list()).toEqual([]);
    expect((await api.del(`/api/shopping-list/${id}`)).status).toBe(404);
    expect((await api.patch(`/api/shopping-list/${id}`, { packages: 1 })).status).toBe(404);
  });

  it.each([
    ["nothing to buy", {}],
    ["blank name", { name: "   " }],
    ["zero packages", { productId: 1, packages: 0 }],
    ["fractional packages", { productId: 1, packages: 1.5 }],
    ["too many packages", { productId: 1, packages: 100 }],
    ["product id as text", { productId: "1" }],
  ])("rejects %s with 400", async (_name, body) => {
    expect((await api.post("/api/shopping-list", body)).status).toBe(400);
  });

  it("404 for an unknown product, 400 for a bad update", async () => {
    expect((await api.post("/api/shopping-list", { productId: 9999 })).status).toBe(404);
    const { id } = (await api.post<{ id: number }>("/api/shopping-list", { productId: tuna })).body;
    expect((await api.patch(`/api/shopping-list/${id}`, { packages: -1 })).status).toBe(400);
    expect((await api.patch("/api/shopping-list/abc", { packages: 1 })).status).toBe(400);
  });

  it("a new receipt takes what was bought off the list: same product, else same group; free text stays", async () => {
    await api.post("/api/shopping-list", { productId: tuna, packages: 2 });
    await api.post("/api/shopping-list", { productId: yogurtA, packages: 1 });
    await api.post("/api/shopping-list", { name: "Candele" });
    await api.receipt({
      storeId,
      date: "2026-10-04",
      items: [
        { productId: tuna, priceFullCents: 119, packages: 1 },
        { productId: yogurtB, priceFullCents: 250 }, // another brand of yogurt, 1 package
      ],
    });
    expect(await list()).toEqual([
      ["Tonno", null, 1],
      ["Candele", null, null],
    ]);

    // Editing a saved receipt doesn't touch the list again
    const saved = (await api.get<{ id: number }[]>("/api/receipts")).body[0]!.id;
    const put = await api.put(`/api/receipts/${saved}`, { storeId, date: "2026-10-04", items: [{ productId: tuna, priceFullCents: 238, packages: 2 }] });
    expect(put.status).toBe(200);
    expect(await list()).toEqual([
      ["Tonno", null, 1],
      ["Candele", null, null],
    ]);
  });

  it("merging products moves their list items; both on the list → one row, packages added up", async () => {
    await api.post("/api/shopping-list", { productId: yogurtB, packages: 2 });
    expect((await api.post(`/api/products/${yogurtB}/merge`, { intoId: yogurtA })).status).toBe(200);
    expect(await list()).toEqual([["Yogurt greco", "A", 2]]);

    const yogurtC = await api.product({ name: "Yogurt bianco", unit: "g", packageAmount: 500 });
    await api.post("/api/shopping-list", { productId: yogurtC, packages: 3 });
    expect((await api.post(`/api/products/${yogurtC}/merge`, { intoId: yogurtA })).status).toBe(200);
    expect(await list()).toEqual([["Yogurt greco", "A", 5]]);
  });

  it("deleting a product removes its list items", async () => {
    const candle = await api.product({ name: "Candela", unit: "pz" });
    await api.post("/api/shopping-list", { productId: candle });
    expect((await api.del(`/api/products/${candle}`)).status).toBe(204);
    expect(await list()).toEqual([]);
  });
});

describe("/api/pantry", () => {
  const today = todayRome();
  const day = (n: number) => addDays(today, n);

  it("yogurt: 1 kg bought, 200 g a day for 4 days → 200 g left, runs out tomorrow, 6 packages a month", async () => {
    await api.receipt({ storeId, date: day(-4), items: [{ productId: yogurtA, priceFullCents: 440, packages: 1 }] });
    for (const d of [-3, -2, -1, 0]) await api.post("/api/diary", { date: day(d), meal: "colazione", productId: yogurtA, amount: 200 });
    await api.post("/api/diary", { date: day(-4), meal: "pranzo", productId: tuna, amount: 224 }); // logged day, before yogurt was first eaten

    const items = (await api.get<PantryItem[]>("/api/pantry")).body;
    const yogurt = items.find((i) => i.productId === yogurtA)!;
    expect(yogurt).toMatchObject({
      rate: { perDay: 200, typicalDay: 200, days: 4, eatenDays: 4 },
      stock: { amount: 200, estimated: false, since: day(-4), corrected: false },
      forecast: { daysLeft: 1, runOutDate: day(1), urgency: "soon" },
      suggestedPackages: 1,
      packageEveryDays: 5,
      packagesPerMonth: 6,
      costPerMonthCents: 2640, // 6000 g × 4,40 €/kg
      inList: false,
    });

    // Tuna eaten but never bought in the app: consumption known, stock and cost unknown (not 0)
    const t = items.find((i) => i.productId === tuna)!;
    expect(t).toMatchObject({ stock: null, forecast: null, costPerMonthCents: null, suggestedPackages: 2 });
    // Soonest to run out first, unknown stock last
    expect(items.map((i) => i.productId)).toEqual([yogurtA, tuna]);
  });

  it("tuna bought and eaten the same day: finished and suggested (2 cans), even with 1 logged day", async () => {
    await api.receipt({ storeId, date: day(0), items: [{ productId: tuna, priceFullCents: 238, packages: 2 }] });
    await api.post("/api/diary", { date: day(0), meal: "pranzo", productId: tuna, amount: 224 });
    const [t] = (await api.get<PantryItem[]>("/api/pantry")).body;
    expect(t).toMatchObject({ rate: { days: 1 }, stock: { amount: 0 }, forecast: { daysLeft: 0, runOutDate: day(0), urgency: "finished" }, suggestedPackages: 2 });
    expect(t).toMatchObject({ packagesPerMonth: null, costPerMonthCents: null }); // one meal: no monthly projection
  });

  it("cost mode 'last' uses the latest price; no package size → no packages", async () => {
    const bananas = await api.product({ name: "Banane", unit: "g", avgPieceAmount: 120 });
    await api.receipt({ storeId, date: day(-9), items: [{ productId: bananas, priceFullCents: 200, amount: 1000 }] });
    await api.receipt({ storeId, date: day(-5), items: [{ productId: bananas, priceFullCents: 300, amount: 1000 }] });
    for (const d of [-4, -3, -2]) await api.post("/api/diary", { date: day(d), meal: "snack", productId: bananas, amount: 100 });
    const get = async (q: string) => (await api.get<PantryItem[]>(`/api/pantry${q}`)).body.find((i) => i.productId === bananas)!;
    // 100 g/day × 30 = 3 kg: average (500 c / 2 kg) → 750; last (300 c / 1 kg) → 900
    expect(await get("")).toMatchObject({ costPerMonthCents: 750, stock: { amount: 1700 } });
    expect(await get("?costMode=last")).toMatchObject({ costPerMonthCents: 900, suggestedPackages: null, packagesPerMonth: null, packageEveryDays: null });
  });

  it("no forecast nor monthly use from fewer than 3 logged days", async () => {
    await api.receipt({ storeId, date: day(-1), items: [{ productId: tuna, priceFullCents: 119, packages: 1 }] });
    await api.post("/api/diary", { date: day(-1), meal: "pranzo", productId: tuna, amount: 100 });
    await api.post("/api/diary", { date: day(0), meal: "colazione", productId: yogurtA, amount: 200 }); // today: only breakfast so far
    const t = (await api.get<PantryItem[]>("/api/pantry")).body.find((i) => i.productId === tuna);
    // Today isn't over (no lunch nor dinner) and had no tuna: 1 day
    expect(t).toMatchObject({ rate: { days: 1 }, stock: { amount: 12 }, forecast: null, packagesPerMonth: null, costPerMonthCents: null });
    // Lunch and dinner logged: today is a full day → 2
    await api.post("/api/diary", { date: day(0), meal: "pranzo", productId: yogurtA, amount: 100 });
    await api.post("/api/diary", { date: day(0), meal: "cena", productId: yogurtA, amount: 100 });
    const t2 = (await api.get<PantryItem[]>("/api/pantry")).body.find((i) => i.productId === tuna);
    expect(t2?.rate).toMatchObject({ days: 2, typicalMeal: 100 });
  });

  it("flags products already on the list, and validates its query", async () => {
    await api.post("/api/diary", { date: day(0), meal: "colazione", productId: yogurtA, amount: 200 });
    await api.post("/api/shopping-list", { productId: yogurtA });
    expect((await api.get<PantryItem[]>("/api/pantry")).body[0]).toMatchObject({ productId: yogurtA, inList: true });
    expect((await api.get("/api/pantry?costMode=nope")).status).toBe(400);
    expect((await api.get("/api/pantry?windowDays=0")).status).toBe(400);
  });

  it("a stock correction restarts the count; diary entries created after it still count", async () => {
    await api.receipt({ storeId, date: day(-4), items: [{ productId: yogurtA, priceFullCents: 440, packages: 1 }] });
    for (const d of [-3, -2, -1]) await api.post("/api/diary", { date: day(d), meal: "colazione", productId: yogurtA, amount: 200 });
    // Shared yogurt: only 100 g left, not 400
    expect((await api.post(`/api/pantry/${yogurtA}/stock`, { amount: 100 })).status).toBe(201);
    let y = (await api.get<PantryItem[]>("/api/pantry")).body.find((i) => i.productId === yogurtA)!;
    expect(y.stock).toEqual({ amount: 100, estimated: false, since: day(0), corrected: true });
    expect(y.forecast).toMatchObject({ urgency: "soon", runOutDate: day(0) }); // 100 g at 200 g/day: today
    // Today's breakfast, logged after the correction, is taken off it
    await api.post("/api/diary", { date: day(0), meal: "colazione", productId: yogurtA, amount: 200 });
    y = (await api.get<PantryItem[]>("/api/pantry")).body.find((i) => i.productId === yogurtA)!;
    expect(y.stock?.amount).toBe(0);
    expect(y.forecast?.urgency).toBe("finished");
    // The latest correction wins
    await api.post(`/api/pantry/${yogurtA}/stock`, { amount: 1000 });
    y = (await api.get<PantryItem[]>("/api/pantry")).body.find((i) => i.productId === yogurtA)!;
    expect(y.stock?.amount).toBe(1000);
    // Older corrections are not kept
    const { results } = await env.DB.prepare("select amount from stock_adjustments where product_id = ?").bind(yogurtA).all();
    expect(results).toEqual([{ amount: 1000 }]);
  });

  it("a product marked finished shows up even if not eaten lately: suggested, 1 package", async () => {
    expect((await api.post(`/api/pantry/${tuna}/stock`, { amount: 0 })).status).toBe(201);
    const [t] = (await api.get<PantryItem[]>("/api/pantry")).body;
    expect(t).toMatchObject({ productId: tuna, rate: null, stock: { amount: 0, corrected: true }, forecast: { urgency: "finished" }, suggestedPackages: 1 });
  });

  it.each([
    ["negative", { amount: -1 }],
    ["fractional", { amount: 1.5 }],
    ["missing", {}],
    ["as text", { amount: "100" }],
  ])("rejects a %s stock correction with 400", async (_name, body) => {
    expect((await api.post(`/api/pantry/${tuna}/stock`, body)).status).toBe(400);
  });

  it("404 when correcting the stock of an unknown product; a deleted product takes its corrections with it", async () => {
    expect((await api.post("/api/pantry/9999/stock", { amount: 1 })).status).toBe(404);
    const p = await api.product({ name: "Usa e getta", unit: "g" });
    await api.post(`/api/pantry/${p}/stock`, { amount: 10 });
    expect((await api.del(`/api/products/${p}`)).status).toBe(204);
    expect((await api.get<PantryItem[]>("/api/pantry")).body).toEqual([]);
  });

  it("bought but not eaten yet: still in the pantry with its stock (beans: 2 × 240 g → 480 g) and last price", async () => {
    const beans = await api.product({ name: "Fagioli", unit: "g", packageAmount: 240 });
    await api.receipt({ storeId, date: day(-5), items: [{ productId: beans, priceFullCents: 118, packages: 2 }] });
    const b = (await api.get<PantryItem[]>("/api/pantry")).body.find((i) => i.productId === beans)!;
    expect(b).toMatchObject({ rate: null, stock: { amount: 480, estimated: false }, forecast: null, inList: false });
    expect(b.lastPurchase).toEqual({ date: day(-5), paidCents: 118, packages: 2, pieces: null, amount: null });
  });

  it("by the piece: 4 bananas × 120 g bought, 2 eaten → 240 g (the weight comes from the 'Pezzo' portion)", async () => {
    const bananas = await api.product({ name: "Banane", unit: "g" });
    await api.post(`/api/products/${bananas}/portions`, { name: "Pezzo", amount: 120 });
    await api.receipt({ storeId, date: day(-2), items: [{ productId: bananas, priceFullCents: 47, pieces: 4 }] });
    await api.post("/api/diary", { date: day(-1), meal: "snack", productId: bananas, amount: 240 });
    const b = (await api.get<PantryItem[]>("/api/pantry")).body.find((i) => i.productId === bananas)!;
    expect(b).toMatchObject({ avgPieceAmount: 120, stock: { amount: 240, estimated: true } });
  });

  it("ignores products not eaten in the last 30 days", async () => {
    await api.post("/api/diary", { date: day(-30), meal: "colazione", productId: yogurtA, amount: 200 });
    expect((await api.get<PantryItem[]>("/api/pantry")).body).toEqual([]);
  });
});
