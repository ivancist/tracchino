import { Hono } from "hono";
import type { Created, Portion } from "../../shared/api";
import { portionInput } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { notFound, parseBody, parseId } from "../http";

/** /api/products/:id/portions — a product's saved servings. */
export const productPortionRoutes = new Hono<AppEnv>()
  .get("/:id/portions", async (c) => {
    const { results } = await c.env.DB.prepare(
      "select id, product_id as productId, name, amount from portions where product_id = ? order by amount, name",
    )
      .bind(parseId(c))
      .all<Portion>();
    return c.json(results);
  })
  .post("/:id/portions", async (c) => {
    const productId = parseId(c);
    const input = await parseBody(c, portionInput);
    const product = await c.env.DB.prepare("select id from products where id = ?").bind(productId).first();
    if (!product) throw notFound("Prodotto non trovato");
    const row = await c.env.DB.prepare("insert into portions (product_id, name, amount) values (?, ?, ?) returning id")
      .bind(productId, input.name, input.amount)
      .first<{ id: number }>();
    return c.json<Created>({ id: row!.id }, 201);
  });

/** /api/portions/:id — rename/resize or delete. Diary entries keep their grams (the portion link is cleared). */
export const portionRoutes = new Hono<AppEnv>()
  .patch("/:id", async (c) => {
    const id = parseId(c);
    const input = await parseBody(c, portionInput);
    const row = await c.env.DB.prepare("update portions set name = ?, amount = ? where id = ? returning id")
      .bind(input.name, input.amount, id)
      .first();
    if (!row) throw notFound("Porzione non trovata");
    return c.json<Created>({ id });
  })
  .delete("/:id", async (c) => {
    const id = parseId(c);
    const db = c.env.DB;
    // Entries keep their grams and drop the whole portion reference (the FK only clears portion_id).
    const [, deleted] = await db.batch<{ id: number }>([
      db.prepare("update diary_entries set portion_qty = null where portion_id = ?").bind(id),
      db.prepare("delete from portions where id = ? returning id").bind(id),
    ]);
    if (!deleted!.results.length) throw notFound("Porzione non trovata");
    return c.body(null, 204);
  });
