import { describe, expect, it } from "vitest";
import { applyPurchases, type ListEntry } from "../../shared/shopping";

const YOGURT_A = 1;
const YOGURT_B = 2;
const TUNA = 3;
const GROUP_YOGURT = 10;
const item = (id: number, productId: number | null, packages: number | null, groupId: number | null = null): ListEntry => ({ id, productId, groupId, packages });

describe("applyPurchases", () => {
  it("removes an item when enough packages are bought", () => {
    expect(applyPurchases([item(1, TUNA, 2)], [{ productId: TUNA, groupId: null, packages: 2 }])).toEqual({ deleted: [1], updated: [] });
  });

  it("decreases an item when fewer packages are bought; a line without a count is one package", () => {
    expect(applyPurchases([item(1, TUNA, 3)], [{ productId: TUNA, groupId: null, packages: null }])).toEqual({ deleted: [], updated: [{ id: 1, packages: 2 }] });
  });

  it("adds up the lines of the same product on the receipt", () => {
    const bought = [
      { productId: TUNA, groupId: null, packages: 1 },
      { productId: TUNA, groupId: null, packages: 1 },
    ];
    expect(applyPurchases([item(1, TUNA, 2)], bought).deleted).toEqual([1]);
  });

  it("an item without a package count goes with any purchase", () => {
    expect(applyPurchases([item(1, TUNA, null)], [{ productId: TUNA, groupId: null, packages: 1 }]).deleted).toEqual([1]);
  });

  it("another brand in the same group satisfies the item; the same product comes first", () => {
    const list = [item(1, YOGURT_A, 1, GROUP_YOGURT), item(2, YOGURT_B, 1, GROUP_YOGURT)];
    // Bought 1 × brand B: brand B's own item goes, brand A's stays
    expect(applyPurchases(list, [{ productId: YOGURT_B, groupId: GROUP_YOGURT, packages: 1 }])).toEqual({ deleted: [2], updated: [] });
    // Bought 2 × brand B: both go (the leftover package covers brand A)
    expect(applyPurchases(list, [{ productId: YOGURT_B, groupId: GROUP_YOGURT, packages: 2 }]).deleted.sort()).toEqual([1, 2]);
  });

  it("never touches free-text items, other products, or products without a group", () => {
    const list = [item(1, null, 1), item(2, TUNA, 1), item(3, YOGURT_A, 1, null)];
    expect(applyPurchases(list, [{ productId: YOGURT_B, groupId: null, packages: 5 }])).toEqual({ deleted: [], updated: [] });
  });
});
