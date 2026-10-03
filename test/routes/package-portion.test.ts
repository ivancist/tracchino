import { beforeEach, describe, expect, it } from "vitest";
import type { Portion } from "../../shared/api";
import { createTestApi } from "../helpers/api";
import { resetDb } from "../helpers/db";

let api: Awaited<ReturnType<typeof createTestApi>>;

beforeEach(async () => {
  await resetDb();
  api = await createTestApi();
});

const portions = async (productId: number) =>
  (await api.get<Portion[]>(`/api/products/${productId}/portions`)).body.map((p) => [p.name, p.amount]);

describe("'Pezzo' portion and average piece weight are the same thing", () => {
  const product = async (id: number) => (await api.get<{ avgPieceAmount: number | null }>(`/api/products/${id}`)).body.avgPieceAmount;

  it("a piece weight on the product creates the 'Pezzo' portion, and follows it while in step", async () => {
    const id = await api.product({ name: "Banane", unit: "g", avgPieceAmount: 120 });
    expect(await portions(id)).toEqual([["Pezzo", 120]]);
    await api.patch(`/api/products/${id}`, { name: "Banane", unit: "g", avgPieceAmount: 130 });
    expect(await portions(id)).toEqual([["Pezzo", 130]]);
    // Packaged and by the piece (eggs in a box of 6): both portions
    const eggs = await api.product({ name: "Uova", unit: "g", packageAmount: 390, avgPieceAmount: 65 });
    expect(await portions(eggs)).toEqual([["Pezzo", 65], ["Confezione", 390]]);
  });

  it("a 'Pezzo' portion made by hand sets the product's piece weight (what the owner did for bananas and eggs)", async () => {
    const id = await api.product({ name: "Zucchine", unit: "g" });
    const { body } = await api.post<{ id: number }>(`/api/products/${id}/portions`, { name: "Pezzo", amount: 150 });
    expect(await product(id)).toBe(150);
    expect((await api.patch(`/api/portions/${body.id}`, { name: "1 pezzo", amount: 160 })).status).toBe(200);
    expect(await product(id)).toBe(160);
    // Other portions don't touch it
    await api.post(`/api/products/${id}/portions`, { name: "Piatto", amount: 300 });
    expect(await product(id)).toBe(160);
  });
});

describe("default 'Confezione' portion", () => {
  it("is created with a packaged product (g or ml), not for loose or per-piece products", async () => {
    expect(await portions(await api.product({ name: "Passata", unit: "g", packageAmount: 700 }))).toEqual([["Confezione", 700]]);
    expect(await portions(await api.product({ name: "Latte", unit: "ml", packageAmount: 1000 }))).toEqual([["Confezione", 1000]]);
    expect(await portions(await api.product({ name: "Banane", unit: "g" }))).toEqual([]);
    expect(await portions(await api.product({ name: "Lattuga", unit: "pz", packageAmount: 300 }))).toEqual([]);
  });

  it("is added when a package size is set later, and follows size changes while it matches the old size", async () => {
    const id = await api.product({ name: "Ceci", unit: "g" });
    expect(await portions(id)).toEqual([]);
    expect((await api.patch(`/api/products/${id}`, { name: "Ceci", unit: "g", packageAmount: 400 })).status).toBe(200);
    expect(await portions(id)).toEqual([["Confezione", 400]]);
    // 400 → 240 (drained weight): the portion was in sync, it follows
    await api.patch(`/api/products/${id}`, { name: "Ceci", unit: "g", packageAmount: 240 });
    expect(await portions(id)).toEqual([["Confezione", 240]]);
    // A rename alone changes nothing
    await api.patch(`/api/products/${id}`, { name: "Ceci lessati", unit: "g", packageAmount: 240 });
    expect(await portions(id)).toEqual([["Confezione", 240]]);
  });

  it("never duplicates nor overrides one made by hand", async () => {
    const id = await api.product({ name: "Tonno", unit: "g" });
    const own = await api.post<{ id: number }>(`/api/products/${id}/portions`, { name: "confezione ", amount: 104 }); // drained tuna
    expect(own.status).toBe(201);
    await api.patch(`/api/products/${id}`, { name: "Tonno", unit: "g", packageAmount: 160 });
    expect(await portions(id)).toEqual([["confezione", 104]]);
    // Resized by hand, so it no longer matches the package: a later size change leaves it alone
    await api.patch(`/api/products/${id}`, { name: "Tonno", unit: "g", packageAmount: 80 });
    expect(await portions(id)).toEqual([["confezione", 104]]);
  });

  it("is not recreated after being deleted, unless the package size changes", async () => {
    const id = await api.product({ name: "Pasta", unit: "g", packageAmount: 500 });
    const [portion] = (await api.get<Portion[]>(`/api/products/${id}/portions`)).body;
    expect((await api.del(`/api/portions/${portion!.id}`)).status).toBe(204);
    await api.patch(`/api/products/${id}`, { name: "Pasta di semola", unit: "g", packageAmount: 500 });
    expect(await portions(id)).toEqual([]);
    await api.patch(`/api/products/${id}`, { name: "Pasta di semola", unit: "g", packageAmount: 1000 });
    expect(await portions(id)).toEqual([["Confezione", 1000]]);
  });
});
