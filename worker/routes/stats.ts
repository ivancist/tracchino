import { Hono } from "hono";
import type { PriceStats, PurchaseRow, SpendingStats, TopProduct } from "../../shared/api";
import { todayRome } from "../../shared/dates";
import { periodQuery, topProductsQuery } from "../../shared/schemas";
import { avgIntervalDays, priceStatsByStore, purchaseFrequency, summarizeSpending } from "../../shared/stats";
import type { AppEnv } from "../app";
import { notFound, parseId, parseQuery } from "../http";

/** Spans longer than this are rejected: the per-day series would get pointlessly large. */
const MAX_DAYS = 3700;
/** Price history analysed per product/group (newest first): years of weekly purchases. */
const MAX_PURCHASES = 5000;

const tooLong = (from?: string, to?: string) => !!from && !!to && Date.parse(to) - Date.parse(from) > MAX_DAYS * 86_400_000;

const PURCHASES_SELECT = `
  select ri.receipt_id as receiptId, ri.product_id as productId, p.name as productName,
         p.unit, p.package_amount as packageAmount, p.avg_piece_amount as avgPieceAmount,
         r.date, r.store_id as storeId, s.name as storeName, ch.name as chainName,
         ri.packages, ri.pieces, ri.amount, ri.price_full_cents as priceFullCents, ri.discount_cents as discountCents,
         ri.price_paid_cents as pricePaidCents
    from receipt_items ri
    join receipts r on r.id = ri.receipt_id
    join stores s on s.id = r.store_id
    join chains ch on ch.id = s.chain_id
    join products p on p.id = ri.product_id`;

/** Rank on the unit most purchases use (a group could mix kg, l and pieces): one metric, never blended. */
function priceStats(purchases: PurchaseRow[]): PriceStats {
  const count = (u: string) => purchases.filter((p) => p.unit === u).length;
  const top = (["g", "ml", "pz"] as const).reduce((a, b) => (count(b) > count(a) ? b : a));
  const metric = top === "pz" ? "piece" : "kilo";
  const volume = top === "ml";
  return {
    metric,
    volume,
    truncated: purchases.length >= MAX_PURCHASES,
    frequency: purchaseFrequency(purchases.map((p) => p.date)),
    byStore: priceStatsByStore(purchases, { metric, volume }),
    purchases,
  };
}

export const statsRoutes = new Hono<AppEnv>()
  /** Spending per day / ISO week over a period (default: first receipt → today), zeros included. */
  .get("/spending", async (c) => {
    const query = parseQuery(c, periodQuery);
    const bounds = await c.env.DB.prepare(
      "select min(r.date) as first, coalesce(sum(ri.price_paid_cents), 0) as total from receipts r left join receipt_items ri on ri.receipt_id = r.id",
    ).first<{ first: string | null; total: number }>();
    const today = todayRome();
    const to = query.to ?? today;
    const from = query.from ?? (bounds?.first && bounds.first <= to ? bounds.first : to);
    if (tooLong(from, to)) {
      return c.json({ error: "invalid_input", message: "Periodo troppo lungo" }, 400);
    }

    const { results } = await c.env.DB.prepare(
      `select r.date, sum(ri.price_paid_cents) as totalCents
         from receipts r join receipt_items ri on ri.receipt_id = r.id
        where r.date between ? and ?
        group by r.date`,
    )
      .bind(from, to)
      .all<{ date: string; totalCents: number }>();

    const body: SpendingStats = {
      ...summarizeSpending(new Map(results.map((r) => [r.date, r.totalCents])), from, to),
      allTimeTotalCents: bounds?.total ?? 0,
      firstReceiptDate: bounds?.first ?? null,
    };
    return c.json(body);
  })
  /** Products ranked by money spent in the period, with purchase frequency. */
  .get("/top-products", async (c) => {
    const { from, to, limit } = parseQuery(c, topProductsQuery);
    if (tooLong(from, to)) return c.json({ error: "invalid_input", message: "Periodo troppo lungo" }, 400);
    const { results } = await c.env.DB.prepare(
      `select p.id as productId, p.name, p.brand, sum(ri.price_paid_cents) as totalCents, count(*) as purchases,
              count(distinct r.date) as days, min(r.date) as firstDate, max(r.date) as lastDate
         from receipt_items ri
         join receipts r on r.id = ri.receipt_id
         join products p on p.id = ri.product_id
        where (?1 is null or r.date >= ?1) and (?2 is null or r.date <= ?2)
        group by p.id
        order by totalCents desc, purchases desc
        limit ?3`,
    )
      .bind(from ?? null, to ?? null, limit)
      .all<Omit<TopProduct, "avgIntervalDays"> & { firstDate: string; lastDate: string }>();
    const body: TopProduct[] = results.map(({ firstDate, lastDate, ...row }) => ({
      ...row,
      avgIntervalDays: avgIntervalDays(firstDate, lastDate, row.days),
    }));
    return c.json(body);
  })
  /** Price history and store comparison for one product. */
  .get("/products/:id", async (c) => {
    const id = parseId(c);
    const exists = await c.env.DB.prepare("select 1 from products where id = ?").bind(id).first();
    if (!exists) throw notFound("Prodotto non trovato");
    const { results } = await c.env.DB.prepare(`${PURCHASES_SELECT} where ri.product_id = ? order by r.date desc, r.id desc limit ?`)
      .bind(id, MAX_PURCHASES)
      .all<PurchaseRow>();
    return c.json(priceStats(results));
  })
  /** Same, across every product of a group (e.g. all bananas, any brand). */
  .get("/groups/:id", async (c) => {
    const id = parseId(c);
    const exists = await c.env.DB.prepare("select 1 from product_groups where id = ?").bind(id).first();
    if (!exists) throw notFound("Gruppo non trovato");
    const { results } = await c.env.DB.prepare(`${PURCHASES_SELECT} where p.group_id = ? order by r.date desc, r.id desc limit ?`)
      .bind(id, MAX_PURCHASES)
      .all<PurchaseRow>();
    return c.json(priceStats(results));
  });
