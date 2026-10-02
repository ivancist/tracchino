import { Hono } from "hono";
import type { AppEnv } from "../app";
import type { MeResponse } from "../../shared/api";

export const meRoutes = new Hono<AppEnv>().get("/", async (c) => {
  // Also proves the D1 binding works end to end.
  const row = await c.env.DB.prepare("select 1 as ok").first<{ ok: number }>();
  const body: MeResponse = { email: c.get("userEmail"), db: row?.ok === 1 ? "ok" : "error" };
  return c.json(body);
});
