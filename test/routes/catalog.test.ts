import { beforeEach, describe, expect, it } from "vitest";
import type { Chain, Product, ProductGroup, Store } from "../../shared/api";
import { createTestApi } from "../helpers/api";
import { resetDb } from "../helpers/db";

const api = await createTestApi();
beforeEach(resetDb);

describe("chains", () => {
  it("creates, lists with store counts, renames and deletes", async () => {
    const id = await api.chain("Esselunga");
    await api.store({ chainId: id, name: "Milano" });
    await api.store({ chainId: id, name: "Monza" });
    expect((await api.get<Chain[]>("/api/chains")).body).toEqual([{ id, name: "Esselunga", storeCount: 2 }]);

    expect((await api.patch(`/api/chains/${id}`, { name: "Esselunga SpA" })).status).toBe(200);
    expect((await api.get<Chain[]>("/api/chains")).body[0]!.name).toBe("Esselunga SpA");
  });

  it("validates input (400) and trims names", async () => {
    expect((await api.post("/api/chains", { name: "   " })).status).toBe(400);
    expect((await api.post("/api/chains", {})).status).toBe(400);
    expect((await api.call("POST", "/api/chains", undefined, { rawBody: "{not json" })).status).toBe(400);
    await api.post("/api/chains", { name: "  Coop  " });
    expect((await api.get<Chain[]>("/api/chains")).body[0]!.name).toBe("Coop");
  });

  it("rejects duplicates (409) and deleting a chain with stores (409)", async () => {
    const id = await api.chain("Lidl");
    expect((await api.post("/api/chains", { name: "Lidl" })).status).toBe(409);
    await api.store({ chainId: id });
    expect((await api.del(`/api/chains/${id}`)).body).toMatchObject({ error: "in_use" });
  });

  it("returns 404 for unknown ids and 400 for malformed ids", async () => {
    expect((await api.patch("/api/chains/999", { name: "X" })).status).toBe(404);
    expect((await api.del("/api/chains/999")).status).toBe(404);
    expect((await api.del("/api/chains/abc")).status).toBe(400);
    expect((await api.del("/api/chains/-1")).status).toBe(400);
  });
});

describe("stores", () => {
  it("lists stores with chain name, most recently used first", async () => {
    const chainId = await api.chain("Esselunga");
    const old = await api.store({ chainId, name: "A" });
    const recent = await api.store({ chainId, name: "B", vatNumber: "IT00000000000" });
    const unused = await api.store({ chainId, name: "C" });
    const productId = await api.product();
    const item = { productId, priceFullCents: 100 };
    await api.receipt({ storeId: old, date: "2026-09-01", items: [item] });
    await api.receipt({ storeId: recent, date: "2026-10-01", items: [item] });

    const stores = (await api.get<Store[]>("/api/stores")).body;
    expect(stores.map((s) => s.id)).toEqual([recent, old, unused]);
    expect(stores[0]).toMatchObject({ chainName: "Esselunga", vatNumber: "IT00000000000", receiptCount: 1, lastReceiptDate: "2026-10-01" });
    expect(stores[2]).toMatchObject({ receiptCount: 0, lastReceiptDate: null, address: null });
  });

  it("enforces unique name per chain and a valid chain", async () => {
    const chainId = await api.chain();
    await api.store({ chainId, name: "Centro" });
    expect((await api.post("/api/stores", { chainId, name: "Centro" })).status).toBe(409);
    expect((await api.post("/api/stores", { chainId: 999, name: "X" })).status).toBe(409);
  });

  it("returns the last price per product at a store", async () => {
    const storeId = await api.store();
    const otherStore = await api.store();
    const a = await api.product({ name: "A" });
    const b = await api.product({ name: "B" });
    await api.receipt({ storeId, date: "2026-09-01", items: [{ productId: a, priceFullCents: 100 }] });
    await api.receipt({
      storeId,
      date: "2026-09-15",
      items: [
        { productId: a, priceFullCents: 120, discountCents: 10, packages: 2, pieces: 6 },
        { productId: b, priceFullCents: 300, amount: 750 },
      ],
    });
    await api.receipt({ storeId: otherStore, date: "2026-09-30", items: [{ productId: a, priceFullCents: 999 }] });

    const prices = (await api.get<{ productId: number }[]>(`/api/stores/${storeId}/last-prices`)).body;
    expect(prices.sort((x, y) => x.productId - y.productId)).toEqual([
      { productId: a, priceFullCents: 120, discountCents: 10, packages: 2, pieces: 6, amount: null, date: "2026-09-15" },
      { productId: b, priceFullCents: 300, discountCents: 0, packages: null, pieces: null, amount: 750, date: "2026-09-15" },
    ]);
  });
});

describe("product groups", () => {
  it("counts products and unlinks them when deleted", async () => {
    const groupId = (await api.post<{ id: number }>("/api/groups", { name: "Banane" })).body.id;
    const productId = await api.product({ name: "Banane Chiquita", groupId });
    expect((await api.get<ProductGroup[]>("/api/groups")).body).toEqual([{ id: groupId, name: "Banane", productCount: 1 }]);
    expect((await api.get<Product>(`/api/products/${productId}`)).body.groupName).toBe("Banane");

    expect((await api.del(`/api/groups/${groupId}`)).status).toBe(204);
    expect((await api.get<Product>(`/api/products/${productId}`)).body).toMatchObject({ groupId: null, groupName: null });
  });
});

describe("products", () => {
  it("creates with defaults null (not 0) and reports purchase stats", async () => {
    const id = await api.product({ name: "Pasta", brand: "", unit: "g", packageAmount: 500 });
    const product = (await api.get<Product>(`/api/products/${id}`)).body;
    expect(product).toMatchObject({ name: "Pasta", brand: null, packageAmount: 500, avgPieceAmount: null, kcal100: null, purchaseCount: 0, lastPurchaseDate: null });

    const storeId = await api.store();
    await api.receipt({ storeId, date: "2026-09-02", items: [{ productId: id, priceFullCents: 89 }] });
    await api.receipt({ storeId, date: "2026-09-20", items: [{ productId: id, priceFullCents: 95 }] });
    expect((await api.get<Product>(`/api/products/${id}`)).body).toMatchObject({ purchaseCount: 2, lastPurchaseDate: "2026-09-20" });
  });

  it("validates unit, sizes and nutrition ranges", async () => {
    expect((await api.post("/api/products", { name: "X", unit: "kg" })).status).toBe(400);
    expect((await api.post("/api/products", { name: "X", unit: "g", packageAmount: 0 })).status).toBe(400);
    expect((await api.post("/api/products", { name: "X", unit: "g", protein100: 120 })).status).toBe(400);
    expect((await api.post("/api/products", { name: "X", unit: "g", packageAmount: 2.5 })).status).toBe(400);
  });

  it("rejects duplicate barcodes", async () => {
    await api.product({ name: "A", barcode: "8001234567897" });
    expect((await api.post("/api/products", { name: "B", unit: "g", barcode: "8001234567897" })).status).toBe(409);
  });

  it("refuses to delete a product used in receipts (409), allows deleting an unused one", async () => {
    const used = await api.product({ name: "Usato" });
    const unused = await api.product({ name: "Non usato" });
    await api.receipt({ storeId: await api.store(), items: [{ productId: used, priceFullCents: 100 }] });
    expect((await api.del(`/api/products/${used}`)).status).toBe(409);
    expect((await api.del(`/api/products/${unused}`)).status).toBe(204);
  });

  it("merges a duplicate into another product atomically", async () => {
    const chainId = await api.chain("Esselunga");
    const storeId = await api.store({ chainId });
    const keep = await api.product({ name: "Banane Chiquita", avgPieceAmount: 120 });
    const dup = await api.product({ name: "Banane chiq.", brand: "Chiquita", barcode: "96385074", kcal100: 89, protein100: 1.1 });
    await api.receipt({ storeId, items: [{ productId: dup, priceFullCents: 199 }, { productId: keep, priceFullCents: 189 }] });

    expect((await api.post(`/api/products/${dup}/merge`, { intoId: keep })).status).toBe(200);

    expect((await api.get(`/api/products/${dup}`)).status).toBe(404);
    const merged = (await api.get<Product>(`/api/products/${keep}`)).body;
    expect(merged).toMatchObject({
      name: "Banane Chiquita", // target name kept
      brand: "Chiquita", // filled from source
      barcode: "96385074", // moved from source
      avgPieceAmount: 120,
      kcal100: 89,
      protein100: 1.1,
      purchaseCount: 2, // receipt lines re-pointed
    });
  });

  it("merge rejects self-merge and unknown products", async () => {
    const id = await api.product();
    expect((await api.post(`/api/products/${id}/merge`, { intoId: id })).status).toBe(400);
    expect((await api.post(`/api/products/${id}/merge`, { intoId: 999 })).status).toBe(404);
  });
});
