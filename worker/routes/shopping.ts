import { Hono } from "hono";
import type { Created, PantryItem, ShoppingListItem } from "../../shared/api";
import { addDays, todayRome } from "../../shared/dates";
import { unitCost, type Purchase } from "../../shared/diary";
import {
  CONSUMPTION_WINDOW_DAYS,
  consumptionRate,
  estimateStock,
  forecast,
  isReliable,
  monthlyUse,
  suggestedPackages,
  type PantryConsumption,
} from "../../shared/pantry";
import type { ProductQuantityInfo } from "../../shared/pricing";
import { applyPurchases, type BoughtLine, type ListEntry } from "../../shared/shopping";
import { pantryQuery, shoppingItemInput, shoppingItemUpdate } from "../../shared/schemas";
import type { ProductUnit } from "../../shared/types";
import type { AppEnv } from "../app";
import { HttpError, notFound, parseBody, parseId, parseQuery } from "../http";

const MAX_LIST_ITEMS = 500;

const LIST_SELECT = `
  select s.id, s.product_id as productId, coalesce(p.name, s.name) as name, p.brand, p.unit,
         p.package_amount as packageAmount, s.packages
    from shopping_list_items s left join products p on p.id = s.product_id`;

/**
 * Statements that take a new receipt's lines off the shopping list (same product, else same group). The list is read
 * just before the receipt's batch and the resulting writes run inside it (single user: no concurrent edits to lose).
 */
export async function shoppingListStatements(d1: D1Database, items: { productId: number; packages: number | null }[]) {
  if (items.length === 0) return [];
  const [list, groups] = await d1.batch<unknown>([
    d1.prepare(
      `select s.id, s.product_id as productId, p.group_id as groupId, s.packages
         from shopping_list_items s left join products p on p.id = s.product_id
        order by s.id`,
    ),
    d1
      .prepare("select id, group_id as groupId from products where id in (select value from json_each(?))")
      .bind(JSON.stringify(items.map((i) => i.productId))),
  ]);
  const groupOf = new Map((groups!.results as { id: number; groupId: number | null }[]).map((g) => [g.id, g.groupId]));
  const bought: BoughtLine[] = items.map((i) => ({ productId: i.productId, groupId: groupOf.get(i.productId) ?? null, packages: i.packages }));
  const { deleted, updated } = applyPurchases(list!.results as ListEntry[], bought);
  return [
    ...deleted.map((id) => d1.prepare("delete from shopping_list_items where id = ?").bind(id)),
    ...updated.map((u) => d1.prepare("update shopping_list_items set packages = ? where id = ?").bind(u.packages, u.id)),
  ];
}

/** /api/shopping-list — what the owner chose to buy. */
export const shoppingListRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { results } = await c.env.DB.prepare(`${LIST_SELECT} order by s.id`).all<ShoppingListItem>();
    return c.json(results);
  })
  .post("/", async (c) => {
    const input = await parseBody(c, shoppingItemInput);
    const d1 = c.env.DB;
    if (input.productId != null) {
      const product = await d1.prepare("select id from products where id = ?").bind(input.productId).first();
      if (!product) throw notFound("Prodotto non trovato");
      // Already on the list: the packages add up instead of a second row.
      const existing = await d1
        .prepare("select id, packages from shopping_list_items where product_id = ? order by id limit 1")
        .bind(input.productId)
        .first<{ id: number; packages: number | null }>();
      if (existing) {
        const packages = existing.packages == null && input.packages == null ? null : Math.min(99, (existing.packages ?? 1) + (input.packages ?? 1));
        await d1.prepare("update shopping_list_items set packages = ? where id = ?").bind(packages, existing.id).run();
        return c.json<Created>({ id: existing.id });
      }
    }
    const count = await d1.prepare("select count(*) as n from shopping_list_items").first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_LIST_ITEMS) {
      throw new HttpError(409, { error: "conflict", message: `La lista ha già ${MAX_LIST_ITEMS} voci: spunta quelle comprate` });
    }
    const row = await d1
      .prepare("insert into shopping_list_items (product_id, name, packages) values (?, ?, ?) returning id")
      .bind(input.productId, input.productId != null ? null : input.name, input.packages)
      .first<{ id: number }>();
    return c.json<Created>({ id: row!.id }, 201);
  })
  .patch("/:id", async (c) => {
    const id = parseId(c);
    const { packages } = await parseBody(c, shoppingItemUpdate);
    const row = await c.env.DB.prepare("update shopping_list_items set packages = ? where id = ? returning id").bind(packages, id).first();
    if (!row) throw notFound("Voce non trovata");
    return c.json<Created>({ id });
  })
  .delete("/:id", async (c) => {
    const id = parseId(c);
    const row = await c.env.DB.prepare("delete from shopping_list_items where id = ? returning id").bind(id).first();
    if (!row) throw notFound("Voce non trovata");
    return c.body(null, 204);
  });

type ProductRow = ProductQuantityInfo & { id: number; name: string; brand: string | null; unit: ProductUnit };

/** /api/pantry — stock, forecast and monthly use of every product eaten in the last 30 days. */
export const pantryRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const { costMode, windowDays } = parseQuery(c, pantryQuery);
  const today = todayRome();
  const from = addDays(today, -(CONSUMPTION_WINDOW_DAYS - 1));
  const d1 = c.env.DB;
  const [products, diary, logged, purchases, list] = await d1.batch<unknown>([
    d1
      .prepare(
        `select id, name, brand, unit, package_amount as packageAmount, avg_piece_amount as avgPieceAmount from products
          where id in (select distinct product_id from diary_entries where date between ?1 and ?2)`,
      )
      .bind(from, today),
    // Every entry of those products: stock counts consumption since the first purchase, which may be older.
    d1
      .prepare(
        `select product_id as productId, date, amount from diary_entries
          where date <= ?2 and product_id in (select distinct product_id from diary_entries where date between ?1 and ?2)`,
      )
      .bind(from, today),
    d1.prepare("select distinct date from diary_entries where date between ? and ?").bind(from, today),
    d1
      .prepare(
        `select ri.product_id as productId, r.date, ri.price_paid_cents as paidCents, ri.packages, ri.pieces, ri.amount
           from receipt_items ri join receipts r on r.id = ri.receipt_id
          where ri.product_id in (select distinct product_id from diary_entries where date between ?1 and ?2)`,
      )
      .bind(from, today),
    d1.prepare("select distinct product_id as productId from shopping_list_items where product_id is not null"),
  ]);

  const loggedDays = (logged!.results as { date: string }[]).map((r) => r.date);
  const inList = new Set((list!.results as { productId: number }[]).map((r) => r.productId));
  const eatenBy = new Map<number, PantryConsumption[]>();
  for (const e of diary!.results as (PantryConsumption & { productId: number })[]) eatenBy.set(e.productId, [...(eatenBy.get(e.productId) ?? []), e]);
  const boughtBy = new Map<number, Purchase[]>();
  for (const p of purchases!.results as (Purchase & { productId: number })[]) boughtBy.set(p.productId, [...(boughtBy.get(p.productId) ?? []), p]);

  const items: PantryItem[] = (products!.results as ProductRow[]).flatMap((p) => {
    const eaten = eatenBy.get(p.id) ?? [];
    const bought = boughtBy.get(p.id) ?? [];
    const rate = consumptionRate(eaten, loggedDays, today);
    if (!rate) return [];
    const stock = estimateStock(bought, eaten, p, today);
    const cost = unitCost(bought, p, today, costMode, windowDays);
    const reliable = isReliable(rate);
    const use = reliable ? monthlyUse(rate, p.packageAmount, cost) : { packageEveryDays: null, packagesPerMonth: null, costPerMonthCents: null };
    return [
      {
        productId: p.id,
        name: p.name,
        brand: p.brand,
        unit: p.unit,
        packageAmount: p.packageAmount,
        perDay: rate.perDay,
        typicalDay: rate.typicalDay,
        rateDays: rate.days,
        stock,
        // No stock left is "finished" even when the rate is too young to forecast (tuna bought and eaten the same day).
        forecast: !stock ? null : reliable || stock.amount <= 0 ? forecast(stock.amount, rate, today) : null,
        suggestedPackages: suggestedPackages(rate, p.packageAmount),
        ...use,
        costEstimated: cost?.estimated ?? false,
        inList: inList.has(p.id),
      },
    ];
  });
  // Soonest to run out first; unknown stock last.
  items.sort((a, b) => (a.forecast?.daysLeft ?? Infinity) - (b.forecast?.daysLeft ?? Infinity) || a.name.localeCompare(b.name, "it"));
  return c.json(items);
});
