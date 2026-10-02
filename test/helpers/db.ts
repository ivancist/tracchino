import { env } from "cloudflare:workers";

// Children before parents, so foreign keys never block the cleanup.
const TABLES = [
  "diary_entries",
  "portions",
  "receipt_items",
  "receipts",
  "product_aliases",
  "products",
  "product_groups",
  "stores",
  "chains",
];

/** Storage is shared between tests in a file: wipe all data (and autoincrement counters). */
export async function resetDb() {
  await env.DB.batch([
    ...TABLES.map((t) => env.DB.prepare(`delete from ${t}`)),
    env.DB.prepare("delete from sqlite_sequence"),
  ]);
}
