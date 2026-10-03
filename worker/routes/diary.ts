import { Hono } from "hono";
import type { Created, DiaryDay, DiaryEntry, FrequentProduct } from "../../shared/api";
import { addDays, todayRome } from "../../shared/dates";
import { costCents, nutrientsFor, portionAmount, sumKnown, sumNutrients, unitCost, type Purchase } from "../../shared/diary";
import { diaryDayQuery, diaryEntryInput } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { HttpError, notFound, parseBody, parseId, parseQuery } from "../http";
import type { ProductUnit } from "../../shared/types";

type EntryRow = Omit<DiaryEntry, "nutrients" | "costCents" | "costSource" | "costEstimated"> & {
  packageAmount: number | null;
  avgPieceAmount: number | null;
  kcal100: number | null;
  protein100: number | null;
  fat100: number | null;
  carbs100: number | null;
  sugars100: number | null;
  saturatedFat100: number | null;
  fiber100: number | null;
  salt100: number | null;
};

/** Grams eaten: typed directly, or the portion (which must belong to the product) × quantity. */
async function resolveEntry(db: D1Database, input: ReturnType<typeof diaryEntryInput.parse>) {
  const product = await db.prepare("select id from products where id = ?").bind(input.productId).first();
  if (!product) throw new HttpError(400, { error: "invalid_input", message: "Prodotto inesistente" });
  if (input.portionId == null) return { ...input, amount: input.amount! };
  const portion = await db
    .prepare("select amount from portions where id = ? and product_id = ?")
    .bind(input.portionId, input.productId)
    .first<{ amount: number }>();
  if (!portion) throw new HttpError(400, { error: "invalid_input", message: "Porzione non valida per questo prodotto" });
  return { ...input, amount: portionAmount(portion.amount, input.portionQty!) };
}

const ENTRY_SELECT = `
  select e.id, e.date, e.meal, e.product_id as productId, p.name as productName, p.brand as productBrand, p.unit,
         e.amount, e.portion_id as portionId, po.name as portionName, e.portion_qty as portionQty,
         p.package_amount as packageAmount, p.avg_piece_amount as avgPieceAmount,
         p.kcal_100 as kcal100, p.protein_100 as protein100, p.fat_100 as fat100, p.carbs_100 as carbs100,
         p.sugars_100 as sugars100, p.saturated_fat_100 as saturatedFat100, p.fiber_100 as fiber100,
         p.salt_100 as salt100
    from diary_entries e
    join products p on p.id = e.product_id
    left join portions po on po.id = e.portion_id`;

const MEAL_ORDER = "case e.meal when 'colazione' then 0 when 'pranzo' then 1 when 'cena' then 2 else 3 end";

export const diaryRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { date, costMode, windowDays } = parseQuery(c, diaryDayQuery);
    const db = c.env.DB;
    const { results: rows } = await db
      .prepare(`${ENTRY_SELECT} where e.date = ? order by ${MEAL_ORDER}, e.id`)
      .bind(date)
      .all<EntryRow>();

    // Every purchase of the products eaten that day; the cost window is applied in TS (small volumes).
    const productIds = [...new Set(rows.map((r) => r.productId))];
    const { results: purchases } = productIds.length
      ? await db
          .prepare(
            `select ri.product_id as productId, r.date, ri.price_full_cents - ri.discount_cents as paidCents,
                    ri.pieces, ri.amount
               from receipt_items ri join receipts r on r.id = ri.receipt_id
              where ri.product_id in (select value from json_each(?))`,
          )
          .bind(JSON.stringify(productIds))
          .all<Purchase & { productId: number }>()
      : { results: [] as (Purchase & { productId: number })[] };

    const costs = new Map(
      productIds.map((id) => {
        const row = rows.find((r) => r.productId === id)!;
        const info = { unit: row.unit as ProductUnit, packageAmount: row.packageAmount, avgPieceAmount: row.avgPieceAmount };
        return [id, unitCost(purchases.filter((p) => p.productId === id), info, date, costMode, windowDays)];
      }),
    );

    const entries: DiaryEntry[] = rows.map(
      ({
        packageAmount: _p,
        avgPieceAmount: _a,
        kcal100,
        protein100,
        fat100,
        carbs100,
        sugars100,
        saturatedFat100,
        fiber100,
        salt100,
        ...row
      }) => {
        const cost = costs.get(row.productId) ?? null;
        return {
          ...row,
          nutrients: nutrientsFor({ kcal100, protein100, fat100, carbs100, sugars100, saturatedFat100, fiber100, salt100 }, row.amount),
          costCents: costCents(cost, row.amount),
          costSource: cost?.source ?? null,
          costEstimated: cost?.estimated ?? false,
        };
      },
    );
    const body: DiaryDay = {
      date,
      costMode,
      windowDays,
      entries,
      totals: sumNutrients(entries.map((e) => e.nutrients)),
      cost: sumKnown(entries.map((e) => e.costCents)),
    };
    return c.json(body);
  })
  .get("/frequent", async (c) => {
    const since = addDays(todayRome(), -90);
    const { results } = await c.env.DB.prepare(
      `select product_id as productId, count(*) as uses, max(date) as lastDate
         from diary_entries where date >= ?
        group by product_id order by uses desc, lastDate desc limit 50`,
    )
      .bind(since)
      .all<FrequentProduct>();
    return c.json(results);
  })
  .post("/", async (c) => {
    const e = await resolveEntry(c.env.DB, await parseBody(c, diaryEntryInput));
    const row = await c.env.DB.prepare(
      `insert into diary_entries (date, meal, product_id, amount, portion_id, portion_qty)
       values (?, ?, ?, ?, ?, ?) returning id`,
    )
      .bind(e.date, e.meal, e.productId, e.amount, e.portionId, e.portionQty)
      .first<{ id: number }>();
    return c.json<Created>({ id: row!.id }, 201);
  })
  .patch("/:id", async (c) => {
    const id = parseId(c);
    const e = await resolveEntry(c.env.DB, await parseBody(c, diaryEntryInput));
    const row = await c.env.DB.prepare(
      `update diary_entries set date = ?, meal = ?, product_id = ?, amount = ?, portion_id = ?, portion_qty = ?
        where id = ? returning id`,
    )
      .bind(e.date, e.meal, e.productId, e.amount, e.portionId, e.portionQty, id)
      .first<{ id: number }>();
    if (!row) throw notFound("Voce del diario non trovata");
    return c.json<Created>({ id });
  })
  .delete("/:id", async (c) => {
    const row = await c.env.DB.prepare("delete from diary_entries where id = ? returning id").bind(parseId(c)).first();
    if (!row) throw notFound("Voce del diario non trovata");
    return c.body(null, 204);
  });

