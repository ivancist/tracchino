import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Product, ReceiptSummary } from "../../shared/api";
import { BASE, createTestApi } from "../helpers/api";
import { resetDb } from "../helpers/db";

const api = await createTestApi();
beforeEach(resetDb);

describe("CSRF guard (state-changing requests)", () => {
  const body = { name: "Coop" };

  it.each([
    ["a foreign Origin", { Origin: "https://evil.example" }],
    ["Sec-Fetch-Site: cross-site", { "Sec-Fetch-Site": "cross-site" }],
    ["Sec-Fetch-Site: same-site (sibling subdomain)", { "Sec-Fetch-Site": "same-site", Origin: "https://other.example.workers.dev" }],
  ])("rejects %s with 403, even with a valid token", async (_name, headers) => {
    const res = await api.call("POST", "/api/chains", body, { headers });
    expect(res.status).toBe(403);
    expect((await api.get<unknown[]>("/api/chains")).body).toHaveLength(0);
  });

  it("allows same-origin browser requests", async () => {
    const res = await api.call("POST", "/api/chains", body, { headers: { Origin: BASE, "Sec-Fetch-Site": "same-origin" } });
    expect(res.status).toBe(201);
  });

  it("applies before auth, also to DELETE", async () => {
    const res = await api.call("DELETE", "/api/chains/1", undefined, { auth: false, headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("does not affect reads", async () => {
    expect((await api.call("GET", "/api/chains", undefined, { headers: { Origin: "https://evil.example" } })).status).toBe(200);
  });

  it("rejects non-JSON bodies (no-preflight 'simple' requests) with 415", async () => {
    const res = await api.call("POST", "/api/chains", undefined, {
      rawBody: JSON.stringify(body),
      headers: { "Content-Type": "text/plain" },
    });
    expect(res.status).toBe(415);
  });

  it("rejects bodies over 256 KB with 413", async () => {
    const res = await api.call("POST", "/api/chains", undefined, { rawBody: JSON.stringify({ name: "x".repeat(300 * 1024) }) });
    expect(res.status).toBe(413);
  });
});

describe("nutrition source on edit", () => {
  const set = (id: number) =>
    env.DB.prepare("update products set kcal_100 = 89, protein_100 = 1.1, nutrition_source = 'off' where id = ?").bind(id).run();
  const source = async (id: number) =>
    (await env.DB.prepare("select nutrition_source as s from products where id = ?").bind(id).first<{ s: string | null }>())!.s;

  it("keeps 'off' when values are unchanged, becomes 'manual' when edited, null when cleared", async () => {
    const id = await api.product({ name: "Banane" });
    await set(id);
    const base = { name: "Banane chiquita", unit: "g", kcal100: 89, protein100: 1.1 };

    await api.patch(`/api/products/${id}`, base); // renamed only
    expect(await source(id)).toBe("off");
    await api.patch(`/api/products/${id}`, { ...base, kcal100: 95 });
    expect(await source(id)).toBe("manual");
    await api.patch(`/api/products/${id}`, { name: "Banane", unit: "g" });
    expect(await source(id)).toBeNull();
  });

  it("returns 404 when editing an unknown product", async () => {
    expect((await api.patch("/api/products/999", { name: "X", unit: "g" })).status).toBe(404);
  });
});

describe("merge across units", () => {
  it("refuses to merge a weight product into a volume one", async () => {
    const grams = await api.product({ name: "Yogurt (g)", unit: "g" });
    const millis = await api.product({ name: "Yogurt (ml)", unit: "ml" });
    const res = await api.post<{ message: string }>(`/api/products/${grams}/merge`, { intoId: millis });
    expect(res.status).toBe(400);
    expect((await api.get<Product>(`/api/products/${grams}`)).status).toBe(200);
  });
});

describe("receipt list pagination", () => {
  it("pages with a (date, id) cursor: every receipt exactly once, newest first", async () => {
    const storeId = await api.store();
    const productId = await api.product();
    const dates = ["2026-09-01", "2026-09-03", "2026-09-03", "2026-09-03", "2026-09-05"];
    const ids: number[] = [];
    for (const date of dates) ids.push(await api.receipt({ storeId, date, items: [{ productId, priceFullCents: 100 }] }));

    const seen: number[] = [];
    let cursor = "";
    for (let page = 0; page < 5; page++) {
      const rows = (await api.get<ReceiptSummary[]>(`/api/receipts?limit=2${cursor}`)).body;
      seen.push(...rows.map((r) => r.id));
      const last = rows.at(-1);
      if (rows.length < 2 || !last) break;
      cursor = `&beforeDate=${last.date}&beforeId=${last.id}`;
    }
    // newest date first; same date → highest id first
    expect(seen).toEqual([ids[4], ids[3], ids[2], ids[1], ids[0]]);
  });

  it("requires beforeDate and beforeId together", async () => {
    expect((await api.get("/api/receipts?beforeDate=2026-09-01")).status).toBe(400);
  });
});

describe("last prices", () => {
  it("can exclude the receipt being edited", async () => {
    const storeId = await api.store();
    const productId = await api.product();
    await api.receipt({ storeId, date: "2026-09-01", items: [{ productId, priceFullCents: 100 }] });
    const editing = await api.receipt({ storeId, date: "2026-09-10", items: [{ productId, priceFullCents: 150 }] });

    const all = (await api.get<{ priceFullCents: number }[]>(`/api/stores/${storeId}/last-prices`)).body;
    expect(all[0]!.priceFullCents).toBe(150);
    const excluding = (await api.get<{ priceFullCents: number }[]>(`/api/stores/${storeId}/last-prices?excludeReceipt=${editing}`)).body;
    expect(excluding[0]!.priceFullCents).toBe(100);
  });
});

describe("receipt id strategy", () => {
  it("receipts stays AUTOINCREMENT (the batch insert reads its id from sqlite_sequence)", async () => {
    const row = await env.DB.prepare("select sql from sqlite_master where type = 'table' and name = 'receipts'").first<{ sql: string }>();
    expect(row!.sql).toMatch(/AUTOINCREMENT/i);
  });
});
