import { asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Created, ProductGroup } from "../../shared/api";
import { groupInput } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { getDb, schema } from "../db";
import { notFound, parseBody, parseId } from "../http";

const { productGroups, products } = schema;

export const groupRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows: ProductGroup[] = await getDb(c.env)
      .select({ id: productGroups.id, name: productGroups.name, productCount: count(products.id) })
      .from(productGroups)
      .leftJoin(products, eq(products.groupId, productGroups.id))
      .groupBy(productGroups.id)
      .orderBy(asc(productGroups.name));
    return c.json(rows);
  })
  .post("/", async (c) => {
    const input = await parseBody(c, groupInput);
    const [row] = await getDb(c.env).insert(productGroups).values(input).returning({ id: productGroups.id });
    return c.json<Created>({ id: row!.id }, 201);
  })
  .patch("/:id", async (c) => {
    const id = parseId(c);
    const input = await parseBody(c, groupInput);
    const [row] = await getDb(c.env)
      .update(productGroups)
      .set(input)
      .where(eq(productGroups.id, id))
      .returning({ id: productGroups.id });
    if (!row) throw notFound("Gruppo non trovato");
    return c.json<Created>({ id });
  })
  .delete("/:id", async (c) => {
    // Products in the group keep existing (group_id → NULL).
    const id = parseId(c);
    const [row] = await getDb(c.env).delete(productGroups).where(eq(productGroups.id, id)).returning({ id: productGroups.id });
    if (!row) throw notFound("Gruppo non trovato");
    return c.body(null, 204);
  });
