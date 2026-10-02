import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";

const db = () => env.DB;

async function seed() {
  await resetDb();
  await db().batch([
    db().prepare("insert into chains (id, name) values (1, 'Esselunga')"),
    db().prepare("insert into stores (id, chain_id, name) values (1, 1, 'Esselunga Milano')"),
    db().prepare("insert into products (id, name, unit) values (1, 'Banane Chiquita', 'g')"),
    db().prepare("insert into receipts (id, store_id, date) values (1, 1, '2026-10-01')"),
  ]);
}

const insertItem = (full: number, discount: number, paid: number, extra = "") =>
  db()
    .prepare(
      `insert into receipt_items (receipt_id, product_id, price_full_cents, discount_cents, price_paid_cents${extra ? ", pieces" : ""})
       values (1, 1, ?, ?, ?${extra ? `, ${extra}` : ""})`,
    )
    .bind(full, discount, paid)
    .run();

describe("schema constraints", () => {
  beforeEach(seed);

  it("accepts a consistent receipt item", async () => {
    await expect(insertItem(189, 20, 169)).resolves.toBeTruthy();
  });

  it("rejects price_paid != full - discount", async () => {
    await expect(insertItem(189, 20, 189)).rejects.toThrow(/CHECK/);
  });

  it("rejects negative discounts", async () => {
    await expect(insertItem(189, -10, 199)).rejects.toThrow(/CHECK/);
  });

  it("rejects zero pieces", async () => {
    await expect(insertItem(189, 0, 189, "0")).rejects.toThrow(/CHECK/);
  });

  it("enforces foreign keys", async () => {
    await expect(
      db().prepare("insert into receipts (store_id, date) values (999, '2026-10-01')").run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("rejects unknown units and meals", async () => {
    await expect(db().prepare("insert into products (name, unit) values ('X', 'kg')").run()).rejects.toThrow(/CHECK/);
    await expect(
      db().prepare("insert into diary_entries (date, meal, product_id, amount) values ('2026-10-01', 'merenda', 1, 100)").run(),
    ).rejects.toThrow(/CHECK/);
  });

  it("keeps aliases unique per chain", async () => {
    const add = () =>
      db()
        .prepare("insert into product_aliases (chain_id, raw_text_norm, product_id, last_seen) values (1, 'BAN.CHIQ.', 1, '2026-10-01')")
        .run();
    await add();
    await expect(add()).rejects.toThrow(/UNIQUE/);
  });

  it("cascades receipt deletion to its items", async () => {
    await insertItem(189, 0, 189);
    await db().prepare("delete from receipts where id = 1").run();
    const row = await db().prepare("select count(*) as n from receipt_items").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("fills created_at automatically", async () => {
    const row = await db().prepare("select created_at from receipts where id = 1").first<{ created_at: number }>();
    expect(row?.created_at).toBeGreaterThan(Date.UTC(2026, 0, 1));
  });
});
