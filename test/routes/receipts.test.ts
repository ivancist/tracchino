import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReceiptDetail, ReceiptSummary } from "../../shared/api";
import { createTestApi } from "../helpers/api";
import { resetDb } from "../helpers/db";

const api = await createTestApi();

let storeId: number;
let bananas: number;
let pasta: number;
let milk: number;

beforeEach(async () => {
  await resetDb();
  storeId = await api.store({ chainId: await api.chain("Esselunga"), name: "Milano Centro" });
  bananas = await api.product({ name: "Banane Chiquita", unit: "g", avgPieceAmount: 120 });
  pasta = await api.product({ name: "Spaghetti", unit: "g", packageAmount: 500 });
  milk = await api.product({ name: "Latte", unit: "ml", packageAmount: 1000 });
});

const threeLines = () => [
  { productId: bananas, rawText: "BAN.CHIQ.", pieces: 6, amount: 850, priceFullCents: 199, discountCents: 20 },
  { productId: pasta, packages: 2, priceFullCents: 178 },
  { productId: milk, priceFullCents: 149, discountCents: 0 },
];

async function count(table: string) {
  return (await env.DB.prepare(`select count(*) as n from ${table}`).first<{ n: number }>())!.n;
}

describe("create and read", () => {
  it("stores header and lines, computing price_paid and the total (hand-computed: 1.79 + 1.78 + 1.49 = 5.06)", async () => {
    const id = await api.receipt({ storeId, date: "2026-10-01", totalPrintedCents: 506, notes: "  ", items: threeLines() });

    const detail = (await api.get<ReceiptDetail>(`/api/receipts/${id}`)).body;
    expect(detail).toMatchObject({
      id,
      date: "2026-10-01",
      storeName: "Milano Centro",
      chainName: "Esselunga",
      totalCents: 506,
      totalPrintedCents: 506,
      notes: null, // blank → null
      source: "manual",
    });
    expect(detail.items.map((i) => [i.productName, i.pricePaidCents, i.discountCents, i.packages, i.pieces, i.amount, i.rawText])).toEqual([
      ["Banane Chiquita", 179, 20, null, 6, 850, "BAN.CHIQ."],
      ["Spaghetti", 178, 0, 2, null, null, null],
      ["Latte", 149, 0, null, null, null, null],
    ]);
    expect(detail.items[1]).toMatchObject({ unit: "g", packageAmount: 500 });
  });

  it("lists receipts newest first with item count and total, filterable by date", async () => {
    const a = await api.receipt({ storeId, date: "2026-09-01", items: [{ productId: pasta, priceFullCents: 89 }] });
    const b = await api.receipt({ storeId, date: "2026-10-01", items: threeLines() });
    const c = await api.receipt({ storeId, date: "2026-10-01", items: [{ productId: milk, priceFullCents: 149 }] });

    const all = (await api.get<ReceiptSummary[]>("/api/receipts")).body;
    expect(all.map((r) => [r.id, r.itemCount, r.totalCents])).toEqual([
      [c, 1, 149],
      [b, 3, 506],
      [a, 1, 89],
    ]);
    expect(all[0]).not.toHaveProperty("notes");

    const october = (await api.get<ReceiptSummary[]>("/api/receipts?from=2026-10-01&to=2026-10-31")).body;
    expect(october.map((r) => r.id)).toEqual([c, b]);
    expect((await api.get<ReceiptSummary[]>("/api/receipts?limit=1")).body).toHaveLength(1);
    expect((await api.get("/api/receipts?from=2026-02-30")).status).toBe(400);
    expect((await api.get("/api/receipts?limit=0")).status).toBe(400);
  });

  it("returns 404 for an unknown receipt", async () => {
    expect((await api.get("/api/receipts/999")).status).toBe(404);
  });
});

describe("validation", () => {
  it.each([
    ["no lines", { items: [] }],
    ["impossible date", { date: "2026-02-30" }],
    ["discount larger than price", { items: [{ productId: 1, priceFullCents: 100, discountCents: 150 }] }],
    ["negative price", { items: [{ productId: 1, priceFullCents: -1 }] }],
    ["price in euros (float) instead of cents", { items: [{ productId: 1, priceFullCents: 1.89 }] }],
    ["zero pieces", { items: [{ productId: 1, priceFullCents: 100, pieces: 0 }] }],
    ["zero packages", { items: [{ productId: 1, priceFullCents: 100, packages: 0 }] }],
    ["fractional packages", { items: [{ productId: 1, priceFullCents: 100, packages: 1.5 }] }],
  ])("rejects %s with 400 and Zod issues", async (_name, override) => {
    const res = await api.post<{ error: string; issues: unknown[] }>("/api/receipts", {
      storeId,
      date: "2026-10-01",
      items: [{ productId: bananas, priceFullCents: 100 }],
      ...override,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_input");
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("is atomic: an invalid product on the last line creates nothing (409)", async () => {
    const res = await api.post("/api/receipts", {
      storeId,
      date: "2026-10-01",
      items: [...threeLines(), { productId: 9999, priceFullCents: 100 }],
    });
    expect(res.status).toBe(409);
    expect(await count("receipts")).toBe(0);
    expect(await count("receipt_items")).toBe(0);
  });

  it("links lines to the right receipt even after deletions (autoincrement ids are not reused)", async () => {
    const first = await api.receipt({ storeId, items: [{ productId: pasta, priceFullCents: 89 }] });
    await api.del(`/api/receipts/${first}`);
    const second = await api.receipt({ storeId, items: threeLines() });
    expect(second).toBeGreaterThan(first);
    expect((await api.get<ReceiptDetail>(`/api/receipts/${second}`)).body.items).toHaveLength(3);
  });
});

describe("update and delete", () => {
  it("replaces header and lines", async () => {
    const id = await api.receipt({ storeId, date: "2026-10-01", items: threeLines() });
    const res = await api.put(`/api/receipts/${id}`, {
      storeId,
      date: "2026-10-02",
      items: [{ productId: milk, priceFullCents: 159 }],
    });
    expect(res.status).toBe(200);
    const detail = (await api.get<ReceiptDetail>(`/api/receipts/${id}`)).body;
    expect(detail).toMatchObject({ date: "2026-10-02", totalCents: 159 });
    expect(detail.items).toHaveLength(1);
    expect(await count("receipt_items")).toBe(1);
  });

  it("keeps the old lines if the update is invalid (atomic)", async () => {
    const id = await api.receipt({ storeId, items: threeLines() });
    const res = await api.put(`/api/receipts/${id}`, { storeId, date: "2026-10-01", items: [{ productId: 9999, priceFullCents: 1 }] });
    expect(res.status).toBe(409);
    expect((await api.get<ReceiptDetail>(`/api/receipts/${id}`)).body.items).toHaveLength(3);
  });

  it("returns 404 when updating an unknown receipt", async () => {
    expect((await api.put("/api/receipts/999", { storeId, date: "2026-10-01", items: threeLines() })).status).toBe(404);
  });

  it("deletes the receipt and its lines", async () => {
    const id = await api.receipt({ storeId, items: threeLines() });
    expect((await api.del(`/api/receipts/${id}`)).status).toBe(204);
    expect(await count("receipt_items")).toBe(0);
    expect((await api.del(`/api/receipts/${id}`)).status).toBe(404);
  });

  it("refuses to delete a store that has receipts", async () => {
    await api.receipt({ storeId, items: threeLines() });
    expect((await api.del(`/api/stores/${storeId}`)).status).toBe(409);
  });
});

describe("product merge with aliases", () => {
  it("moves the source's aliases to the target", async () => {
    const chainId = (await env.DB.prepare("select chain_id as c from stores where id = ?").bind(storeId).first<{ c: number }>())!.c;
    const dup = await api.product({ name: "Banane (dup)" });
    const alias = (raw: string, productId: number) =>
      env.DB.prepare("insert into product_aliases (chain_id, raw_text_norm, product_id, last_seen) values (?, ?, ?, '2026-10-01')")
        .bind(chainId, raw, productId)
        .run();
    await alias("ban chiq", bananas);
    await alias("banane ch", dup);

    expect((await api.post(`/api/products/${dup}/merge`, { intoId: bananas })).status).toBe(200);
    const { results } = await env.DB.prepare("select raw_text_norm as raw, product_id as p from product_aliases order by raw").all();
    expect(results).toEqual([
      { raw: "ban chiq", p: bananas },
      { raw: "banane ch", p: bananas },
    ]);
  });
});
