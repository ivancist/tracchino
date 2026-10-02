---
name: db-migration
description: Safely change the Tracchino D1 schema with Drizzle — edit schema, generate migration, review SQL, apply locally, test, and only then apply remotely. Use whenever a table, column, index or constraint changes.
---

# DB migration (D1 + Drizzle)

## Rules
- Never edit a migration that has already been applied (locally committed or remote). Create a new one.
- Money columns are integer cents (`*_cents`), quantities integer g/ml, dates `text` ISO. Nullable when the value can be unknown.
- SQLite limits: `ALTER TABLE` cannot drop/alter most constraints. Drizzle may generate a table-rebuild (create new → copy → drop → rename). Review it carefully: data must be copied and foreign keys preserved.
- **D1 always enforces foreign keys**: `PRAGMA foreign_keys=OFF` (what drizzle-kit emits for rebuilds) is ignored. Replace it with `PRAGMA defer_foreign_keys = on;` at the start and `... = off;` at the end of the migration.
- **Rebuilding a parent table is dangerous on D1**: `DROP TABLE receipts` runs an implicit `DELETE`, which fires `ON DELETE CASCADE` on children (e.g. wipes `receipt_items`). Once real data exists, never rebuild a table that others reference with CASCADE — prefer additive changes (new column, new index, app-level validation) or a hand-written migration that also copies/rebuilds the children. Always test on a copy: export remote → import into local D1 → apply → compare row counts.
- Add indexes for columns used in filters/joins of stats queries (e.g. `receipts.date`, `receipt_items.product_id`, `diary_entries.date`, `product_aliases(chain_id, raw_text_norm)` unique).

## Steps
1. Edit the schema in `/db/schema.ts` (and related Zod schemas in `/shared`).
2. `docker compose exec dev npm run db:generate` → read the generated SQL in `/db/migrations/` line by line.
   - Destructive statement (DROP, rebuild)? Confirm data is preserved; if data loss is possible, stop and ask the user.
3. `docker compose exec dev npm run db:migrate:local`
4. `docker compose exec dev npm test` — integration tests must pass on the migrated local DB.
5. Back up remote before applying: `docker compose exec dev npx wrangler d1 export <db-name> --remote --output=backups/<date>-pre-<migration>.sql` (the `backups/` dir is gitignored).
6. Ask the user before `docker compose exec dev npm run db:migrate:remote` — it changes production data.
7. After remote apply, run a quick read query through the API (or `docker compose exec dev npx wrangler d1 execute --remote --command "SELECT count(*) FROM ..."`) to confirm.
