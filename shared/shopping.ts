// Shopping list (phase 7): what a saved receipt takes off the list.

export type ListEntry = { id: number; productId: number | null; groupId: number | null; packages: number | null };
export type BoughtLine = { productId: number; groupId: number | null; packages: number | null };

/**
 * Items a new receipt satisfies. Each bought product takes packages off the list items of the same product first, then
 * off items of another product in the same group (another brand of yogurt); what is left over moves on to the next item.
 * An item without a package count goes with any purchase. Free-text items are never touched.
 * Returns the items to delete and the new package counts of the ones partly bought.
 */
export function applyPurchases(list: readonly ListEntry[], bought: readonly BoughtLine[]) {
  const remaining = new Map(list.map((i) => [i.id, i.packages]));
  const done = new Set<number>();

  const perProduct = new Map<number, BoughtLine & { packages: number }>();
  for (const b of bought) {
    const prev = perProduct.get(b.productId);
    perProduct.set(b.productId, { ...b, packages: (prev?.packages ?? 0) + (b.packages ?? 1) });
  }

  for (const b of perProduct.values()) {
    const candidates = [
      ...list.filter((i) => i.productId === b.productId),
      ...list.filter((i) => i.productId != null && i.productId !== b.productId && b.groupId != null && i.groupId === b.groupId),
    ];
    let left = b.packages;
    for (const item of candidates) {
      if (left <= 0) break;
      if (done.has(item.id)) continue;
      const want = remaining.get(item.id) ?? null;
      if (want == null || want <= left) {
        done.add(item.id);
        left -= want ?? left;
      } else {
        remaining.set(item.id, want - left);
        left = 0;
      }
    }
  }

  return {
    deleted: [...done],
    updated: list.filter((i) => !done.has(i.id) && remaining.get(i.id) !== i.packages).map((i) => ({ id: i.id, packages: remaining.get(i.id)! })),
  };
}
