import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Created, LastPrice, Store } from "../../shared/api";
import { lastPricesQuery, storeInput } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { getDb, schema } from "../db";
import { notFound, parseBody, parseId, parseQuery } from "../http";

const { stores } = schema;

export const storeRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { results } = await c.env.DB.prepare(
      `select s.id, s.chain_id as chainId, ch.name as chainName, s.name, s.address, s.vat_number as vatNumber,
              count(r.id) as receiptCount, max(r.date) as lastReceiptDate
         from stores s
         join chains ch on ch.id = s.chain_id
         left join receipts r on r.store_id = s.id
        group by s.id
        order by lastReceiptDate is null, lastReceiptDate desc, ch.name, s.name`,
    ).all<Store>();
    return c.json(results);
  })
  .post("/", async (c) => {
    const input = await parseBody(c, storeInput);
    const [row] = await getDb(c.env).insert(stores).values(input).returning({ id: stores.id });
    return c.json<Created>({ id: row!.id }, 201);
  })
  .patch("/:id", async (c) => {
    const id = parseId(c);
    const input = await parseBody(c, storeInput);
    const [row] = await getDb(c.env).update(stores).set(input).where(eq(stores.id, id)).returning({ id: stores.id });
    if (!row) throw notFound("Negozio non trovato");
    return c.json<Created>({ id });
  })
  .delete("/:id", async (c) => {
    const id = parseId(c);
    const [row] = await getDb(c.env).delete(stores).where(eq(stores.id, id)).returning({ id: stores.id });
    if (!row) throw notFound("Negozio non trovato");
    return c.body(null, 204);
  })
  // Most recent line per product bought at this store: prefills the price in a receipt.
  // `excludeReceipt` leaves out the receipt being edited, so it doesn't show its own price as "last time".
  .get("/:id/last-prices", async (c) => {
    const id = parseId(c);
    const { excludeReceipt } = parseQuery(c, lastPricesQuery);
    const { results } = await c.env.DB.prepare(
      `select productId, priceFullCents, discountCents, packages, pieces, amount, date from (
         select ri.product_id as productId, ri.price_full_cents as priceFullCents, ri.discount_cents as discountCents,
                ri.packages, ri.pieces, ri.amount, r.date,
                row_number() over (partition by ri.product_id order by r.date desc, r.id desc, ri.id desc) as rn
           from receipt_items ri
           join receipts r on r.id = ri.receipt_id
          where r.store_id = ?1 and r.id != coalesce(?2, -1)
       ) where rn = 1`,
    )
      .bind(id, excludeReceipt ?? null)
      .all<LastPrice>();
    return c.json(results);
  });
