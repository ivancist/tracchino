import { env } from "cloudflare:workers";

/**
 * Storage is shared between tests in a file: wipe all user tables (and autoincrement counters).
 * Tables are read from sqlite_master so new migrations are covered automatically;
 * deferring foreign keys lets them be emptied in any order.
 */
export async function resetDb() {
  const { results } = await env.DB.prepare(
    `select name from sqlite_master
      where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%' and name != 'd1_migrations'`,
  ).all<{ name: string }>();
  await env.DB.batch([
    env.DB.prepare("PRAGMA defer_foreign_keys = on"),
    ...results.map(({ name }) => env.DB.prepare(`delete from "${name}"`)),
    env.DB.prepare("delete from sqlite_sequence"),
  ]);
}
