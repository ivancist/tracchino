import { Hono } from "hono";
import type { Context } from "hono";
import type { DietAnalysis, ProductAnalysis, SimulationResult } from "../../shared/api";
import {
  consumptionVsPurchases,
  dietSummary,
  nutrientValue,
  simulate,
  type CostLookup,
  type DiaryRow,
  type PurchaseRow,
} from "../../shared/analysis";
import { todayRome } from "../../shared/dates";
import { unitCost, type CostMode, type Purchase, type UnitCost } from "../../shared/diary";
import type { Nutrition } from "../../shared/nutrition";
import type { ProductQuantityInfo } from "../../shared/pricing";
import { analysisQuery, simulateQuery } from "../../shared/schemas";
import type { ProductUnit } from "../../shared/types";
import type { AppEnv } from "../app";
import { HttpError, parseQuery } from "../http";

const MAX_DAYS = 3700;

type ProductRow = Nutrition & ProductQuantityInfo & { id: number; name: string; brand: string | null; unit: ProductUnit };

/** Period: as asked, else from the first diary entry (or today) to today. */
async function period(c: Context<AppEnv>, query: { from?: string; to?: string }) {
  const to = query.to ?? todayRome();
  const first = await c.env.DB.prepare("select min(date) as first from diary_entries").first<{ first: string | null }>();
  const firstDiaryDate = first?.first ?? null;
  const from = query.from ?? (firstDiaryDate && firstDiaryDate <= to ? firstDiaryDate : to);
  if (from > to) throw new HttpError(400, { error: "invalid_input", message: "La data iniziale è dopo quella finale" });
  if (Date.parse(to) - Date.parse(from) > MAX_DAYS * 86_400_000) {
    throw new HttpError(400, { error: "invalid_input", message: "Periodo troppo lungo" });
  }
  return { from, to, firstDiaryDate };
}

/** Products, every purchase of them (any date: the cost window may start before the period) and a memoized cost. */
async function loadCatalog(db: D1Database, productIds: number[], costMode: CostMode, windowDays: number) {
  const ids = JSON.stringify(productIds);
  const [products, purchases] = await db.batch<unknown>([
    db.prepare(
      `select id, name, brand, unit, package_amount as packageAmount, avg_piece_amount as avgPieceAmount,
              kcal_100 as kcal100, protein_100 as protein100, fat_100 as fat100, carbs_100 as carbs100, sugars_100 as sugars100,
              saturated_fat_100 as saturatedFat100, fiber_100 as fiber100
         from products where id in (select value from json_each(?))`,
    ).bind(ids),
    db.prepare(
      `select ri.product_id as productId, r.date, ri.price_paid_cents as paidCents, ri.pieces, ri.amount
         from receipt_items ri join receipts r on r.id = ri.receipt_id
        where ri.product_id in (select value from json_each(?))`,
    ).bind(ids),
  ]);
  const byId = new Map((products!.results as ProductRow[]).map((p) => [p.id, p]));
  // Grouped once: the cost is asked for every (product, day) pair of the period.
  const byProduct = new Map<number, Purchase[]>();
  for (const p of purchases!.results as (Purchase & { productId: number })[]) {
    byProduct.set(p.productId, [...(byProduct.get(p.productId) ?? []), p]);
  }
  const memo = new Map<string, UnitCost | null>();
  const cost: CostLookup = (productId, date) => {
    const key = `${productId}:${date}`;
    if (!memo.has(key)) {
      const p = byId.get(productId);
      memo.set(key, p ? unitCost(byProduct.get(productId) ?? [], p, date, costMode, windowDays) : null);
    }
    return memo.get(key)!;
  };
  return { byId, cost, nutrition: (id: number) => byId.get(id) ?? null };
}

async function diaryRows(db: D1Database, from: string, to: string) {
  const { results } = await db
    .prepare("select date, product_id as productId, amount from diary_entries where date between ? and ? order by date, id")
    .bind(from, to)
    .all<DiaryRow>();
  return results;
}

export const analysisRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const query = parseQuery(c, analysisQuery);
    const { from, to, firstDiaryDate } = await period(c, query);
    const db = c.env.DB;
    const rows = await diaryRows(db, from, to);
    const { results: boughtInPeriod } = await db
      .prepare(
        `select ri.product_id as productId, r.date, ri.pieces, ri.amount
           from receipt_items ri join receipts r on r.id = ri.receipt_id where r.date between ? and ?`,
      )
      .bind(from, to)
      .all<PurchaseRow>();
    const ids = [...new Set([...rows.map((r) => r.productId), ...boughtInPeriod.map((p) => p.productId)])];
    const catalog = await loadCatalog(db, ids, query.costMode, query.windowDays);

    const products: ProductAnalysis[] = consumptionVsPurchases(rows, boughtInPeriod, (id) => catalog.byId.get(id) ?? null)
      .map((r) => {
        const p = catalog.byId.get(r.productId)!;
        const cost = catalog.cost(r.productId, to);
        return { ...r, name: p.name, brand: p.brand, unit: p.unit, ...nutrientValue(p, cost), costEstimated: cost?.estimated ?? false };
      })
      .sort((a, b) => b.eatenAmount - a.eatenAmount || b.boughtAmount - a.boughtAmount || a.name.localeCompare(b.name));

    const body: DietAnalysis = { from, to, firstDiaryDate, summary: dietSummary(rows, catalog.nutrition, catalog.cost), products };
    return c.json(body);
  })
  .get("/simulate", async (c) => {
    const query = parseQuery(c, simulateQuery);
    const { from, to } = await period(c, query);
    const rows = await diaryRows(c.env.DB, from, to);
    const catalog = await loadCatalog(c.env.DB, [query.fromProduct, query.toProduct], query.costMode, query.windowDays);
    const a = catalog.byId.get(query.fromProduct);
    const b = catalog.byId.get(query.toProduct);
    if (!a || !b) throw new HttpError(400, { error: "invalid_input", message: "Prodotto inesistente" });
    // Grams and millilitres don't swap one for one (same rule as merging products). "pz" products are eaten in grams.
    const measure = (u: ProductUnit) => (u === "ml" ? "ml" : "g");
    if (measure(a.unit) !== measure(b.unit)) {
      throw new HttpError(400, { error: "invalid_input", message: "Un prodotto si misura in grammi e l'altro in millilitri" });
    }
    const change = { fromProductId: query.fromProduct, toProductId: query.toProduct, factor: query.factor };
    const body: SimulationResult = {
      ...simulate(rows, change, catalog.nutrition, catalog.cost),
      from,
      to,
      loggedDays: new Set(rows.map((r) => r.date)).size,
    };
    return c.json(body);
  });
