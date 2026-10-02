import { asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Chain, Created } from "../../shared/api";
import { chainInput } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { getDb, schema } from "../db";
import { notFound, parseBody, parseId } from "../http";

const { chains, stores } = schema;

export const chainRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows: Chain[] = await getDb(c.env)
      .select({ id: chains.id, name: chains.name, storeCount: count(stores.id) })
      .from(chains)
      .leftJoin(stores, eq(stores.chainId, chains.id))
      .groupBy(chains.id)
      .orderBy(asc(chains.name));
    return c.json(rows);
  })
  .post("/", async (c) => {
    const input = await parseBody(c, chainInput);
    const [row] = await getDb(c.env).insert(chains).values(input).returning({ id: chains.id });
    return c.json<Created>({ id: row!.id }, 201);
  })
  .patch("/:id", async (c) => {
    const id = parseId(c);
    const input = await parseBody(c, chainInput);
    const [row] = await getDb(c.env).update(chains).set(input).where(eq(chains.id, id)).returning({ id: chains.id });
    if (!row) throw notFound("Catena non trovata");
    return c.json<Created>({ id });
  })
  .delete("/:id", async (c) => {
    const id = parseId(c);
    const [row] = await getDb(c.env).delete(chains).where(eq(chains.id, id)).returning({ id: chains.id });
    if (!row) throw notFound("Catena non trovata");
    return c.body(null, 204);
  });
