import { beforeEach, describe, expect, it } from "vitest";
import type { PriceStats, SpendingStats, TopProduct } from "../../shared/api";
import { createTestApi } from "../helpers/api";
import { resetDb } from "../helpers/db";

const api = await createTestApi();

let esselunga: number;
let lidl: number;
let banChiquita: number;
let banLidl: number;
let pasta: number;
let groupId: number;

beforeEach(async () => {
  await resetDb();
  esselunga = await api.store({ chainId: await api.chain("Esselunga"), name: "Centro" });
  lidl = await api.store({ chainId: await api.chain("Lidl"), name: "Viale" });
  groupId = (await api.post<{ id: number }>("/api/groups", { name: "Banane" })).body.id;
  banChiquita = await api.product({ name: "Banane Chiquita", unit: "g", avgPieceAmount: 120, groupId });
  banLidl = await api.product({ name: "Banane Lidl", unit: "g", groupId });
  pasta = await api.product({ name: "Spaghetti", unit: "g", packageAmount: 500 });

  // Hand-computed fixture
  await api.receipt({ storeId: esselunga, date: "2026-09-01", items: [
    { productId: banChiquita, priceFullCents: 199, discountCents: 20, pieces: 6, amount: 850 }, // 179
    { productId: pasta, priceFullCents: 89, packages: 1 }, // 89
  ] }); // day total 268
  await api.receipt({ storeId: lidl, date: "2026-09-03", items: [{ productId: banLidl, priceFullCents: 129, amount: 700 }] }); // 129
  await api.receipt({ storeId: esselunga, date: "2026-09-03", items: [{ productId: pasta, priceFullCents: 178, packages: 2 }] }); // 178 → day 307
  await api.receipt({ storeId: esselunga, date: "2026-09-15", items: [{ productId: banChiquita, priceFullCents: 150, pieces: 5 }] }); // 150
});

describe("GET /api/stats/spending", () => {
  it("covers every day of the period, zeros included (hand-computed)", async () => {
    // Period Tue 1 Sep → Mon 14 Sep 2026 = 14 days.
    const s = (await api.get<SpendingStats>("/api/stats/spending?from=2026-09-01&to=2026-09-14")).body;
    expect(s.days).toHaveLength(14);
    expect(s.totalCents).toBe(268 + 307); // 575; the 15 Sep receipt is outside
    expect(s.days.filter((d) => d.totalCents > 0).map((d) => [d.date, d.totalCents])).toEqual([
      ["2026-09-01", 268],
      ["2026-09-03", 307],
    ]);
    // 575 / 14 = 41.07 → 41; 12 zero days → median 0
    expect(s.daily).toEqual({ mean: 41, median: 0, count: 14 });
    // Weeks: 31 Aug–6 Sep (partial: starts before 1 Sep), 7–13 Sep (complete, 0), 14–20 Sep (partial)
    expect(s.weeks.map((w) => [w.weekStart, w.totalCents, w.complete])).toEqual([
      ["2026-08-31", 575, false],
      ["2026-09-07", 0, true],
      ["2026-09-14", 0, false],
    ]);
    // all weeks: 575, 0, 0 → mean 191.67 → 192, median 0; 2 partial (first and last)
    expect(s.weekly).toEqual({ mean: 192, median: 0, count: 3, partial: 2 });
    expect(s.allTimeTotalCents).toBe(725);
    expect(s.firstReceiptDate).toBe("2026-09-01");
  });

  it("defaults to first receipt → given end", async () => {
    const s = (await api.get<SpendingStats>("/api/stats/spending?to=2026-09-15")).body;
    expect([s.from, s.to, s.totalCents, s.days.length]).toEqual(["2026-09-01", "2026-09-15", 725, 15]);
  });

  it("validates the period", async () => {
    expect((await api.get("/api/stats/spending?from=2026-09-10&to=2026-09-01")).status).toBe(400);
    expect((await api.get("/api/stats/spending?from=2026-02-30")).status).toBe(400);
    expect((await api.get("/api/stats/spending?from=1990-01-01&to=2026-01-01")).status).toBe(400);
  });

  it("returns zeros for a period after the last receipt", async () => {
    const s = (await api.get<SpendingStats>("/api/stats/spending?from=2026-09-20&to=2026-09-22")).body;
    expect([s.totalCents, s.daily.mean, s.daily.median, s.allTimeTotalCents]).toEqual([0, 0, 0, 725]);
  });

  it("requires authentication", async () => {
    for (const path of ["/api/stats/spending", "/api/stats/top-products", `/api/stats/products/${pasta}`, `/api/stats/groups/${groupId}`]) {
      expect((await api.call("GET", path, undefined, { auth: false })).status).toBe(401);
    }
  });

  it("works with no data at all", async () => {
    await resetDb();
    const s = (await api.get<SpendingStats>("/api/stats/spending?to=2026-10-02")).body;
    expect([s.from, s.totalCents, s.allTimeTotalCents, s.firstReceiptDate]).toEqual(["2026-10-02", 0, 0, null]);
  });
});

describe("GET /api/stats/top-products", () => {
  it("ranks by money spent, with purchase frequency", async () => {
    const top = (await api.get<TopProduct[]>("/api/stats/top-products")).body;
    // Spaghetti 89+178 = 267 (days 1, 3 Sep → interval 2); Chiquita 179+150 = 329 (1, 15 Sep → 14); Lidl 129
    expect(top.map((t) => [t.name, t.totalCents, t.purchases, t.avgIntervalDays])).toEqual([
      ["Banane Chiquita", 329, 2, 14],
      ["Spaghetti", 267, 2, 2],
      ["Banane Lidl", 129, 1, null],
    ]);
    const sept1to3 = (await api.get<TopProduct[]>("/api/stats/top-products?from=2026-09-01&to=2026-09-03&limit=1")).body;
    expect(sept1to3.map((t) => [t.name, t.totalCents])).toEqual([["Spaghetti", 267]]);
    expect((await api.get("/api/stats/top-products?limit=0")).status).toBe(400);
    expect((await api.get("/api/stats/top-products?limit=101")).status).toBe(400);
    expect((await api.get("/api/stats/top-products?from=1990-01-01&to=2026-01-01")).status).toBe(400);
  });
});

describe("GET /api/stats/products/:id and /groups/:id", () => {
  it("compares stores for a product using raw quantities (estimated flagged)", async () => {
    const s = (await api.get<PriceStats>(`/api/stats/products/${banChiquita}`)).body;
    expect([s.metric, s.volume, s.truncated]).toEqual(["kilo", false, false]);
    expect(s.purchases.map((p) => [p.date, p.pricePaidCents])).toEqual([
      ["2026-09-15", 150],
      ["2026-09-01", 179],
    ]);
    // (179 + 150) / (850 + 5×120) g = 329 / 1450 → 2.27 €/kg, estimated; 329 / 11 pieces → 0.30 €/pz
    expect(s.byStore).toEqual([
      expect.objectContaining({ chainName: "Esselunga", perKilo: { cents: 227, estimated: true, lines: 2 }, perPiece: { cents: 30, lines: 2 } }),
    ]);
    expect(s.frequency).toMatchObject({ purchases: 2, days: 2, avgIntervalDays: 14 });
  });

  it("compares stores across a group's products, cheapest first", async () => {
    const s = (await api.get<PriceStats>(`/api/stats/groups/${groupId}`)).body;
    expect(s.byStore.map((b) => [b.chainName, b.perKilo?.cents])).toEqual([
      ["Lidl", 184], // 129 / 700 g
      ["Esselunga", 227],
    ]);
    expect(new Set(s.purchases.map((p) => p.productName))).toEqual(new Set(["Banane Chiquita", "Banane Lidl"]));
  });

  it("returns 404 for unknown product or group", async () => {
    expect((await api.get("/api/stats/products/999")).status).toBe(404);
    expect((await api.get("/api/stats/groups/999")).status).toBe(404);
  });
});
