import { costCents, NUTRIENTS, nutrientsFor, sumKnown, type Nutrient, type Total, type UnitCost } from "./diary";
import type { Nutrition } from "./nutrition";
import { resolveAmount, type ProductQuantityInfo } from "./pricing";

// Diet analysis and "what if" simulations (PLAN Fase 6). Pure functions over diary rows, product nutrition and a
// cost lookup (the same per-gram cost as the diary), tested with hand-computed values.

export type DiaryRow = { date: string; productId: number; amount: number };
/** Cost per g/ml of a product on a day (null = unknown). */
export type CostLookup = (productId: number, date: string) => UnitCost | null;
/** Nutrition per 100 g/ml (null when the product is unknown). */
export type NutritionLookup = (productId: number) => Nutrition | null;

export type Measure = Nutrient | "cost";
export const MEASURES: readonly Measure[] = ["cost", ...NUTRIENTS];

function entryValues(row: DiaryRow, amount: number, productId: number, nutrition: NutritionLookup, cost: CostLookup) {
  const n = nutrition(productId);
  const nutrients = n ? nutrientsFor(n, amount) : { kcal: null, protein: null, fat: null, carbs: null, sugars: null };
  return { ...nutrients, cost: costCents(cost(productId, row.date), amount) } as Record<Measure, number | null>;
}

export type DietDay = { date: string; entries: number } & Record<Measure, Total>;

export type DietSummary = {
  /** Days with at least one diary entry, oldest first. Days not logged are not days at zero cost. */
  days: DietDay[];
  /** Mean over logged days of each day's known total; null when no day has the value. */
  dailyMean: Record<Measure, number | null>;
  /** 7 × the daily mean: an estimate, since not every day may be logged. */
  weeklyCostEstimate: number | null;
  /** Cents per 100 kcal of the diet, over entries that have both a cost and kcal (never mixing populations). */
  costPer100Kcal: number | null;
  /** Entries whose cost is unknown (never bought, or no purchase with a known quantity). */
  entriesWithoutCost: number;
};

export function dietSummary(rows: readonly DiaryRow[], nutrition: NutritionLookup, cost: CostLookup): DietSummary {
  const byDate = new Map<string, Record<Measure, number | null>[]>();
  let pairedCost = 0;
  let pairedKcal = 0;
  for (const row of rows) {
    const values = entryValues(row, row.amount, row.productId, nutrition, cost);
    const list = byDate.get(row.date) ?? [];
    list.push(values);
    byDate.set(row.date, list);
    if (values.cost != null && values.kcal != null) {
      pairedCost += values.cost;
      pairedKcal += values.kcal;
    }
  }
  const days: DietDay[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({
      date,
      entries: list.length,
      ...(Object.fromEntries(MEASURES.map((m) => [m, sumKnown(list.map((v) => v[m]))])) as Record<Measure, Total>),
    }));
  const dailyMean = Object.fromEntries(
    MEASURES.map((m) => {
      const known = days.map((d) => d[m].value).filter((v): v is number => v != null);
      return [m, known.length ? known.reduce((s, v) => s + v, 0) / known.length : null];
    }),
  ) as Record<Measure, number | null>;
  return {
    days,
    dailyMean,
    weeklyCostEstimate: dailyMean.cost != null ? dailyMean.cost * 7 : null,
    costPer100Kcal: pairedKcal > 0 ? (pairedCost * 100) / pairedKcal : null,
    entriesWithoutCost: days.reduce((s, d) => s + d.cost.missing, 0),
  };
}

/**
 * Cents (unrounded: cheap staples cost fractions of a cent per 100 kcal) to get 100 kcal and 10 g of protein from a
 * product; null when the cost or the nutrient is unknown or 0. A derived value, formatted only at the UI edge.
 */
export function nutrientValue(n: Nutrition, cost: UnitCost | null): { per100KcalCents: number | null; per10gProteinCents: number | null } {
  // grams for 100 kcal = 100 × 100 / kcal100; grams for 10 g protein = 10 × 100 / protein100
  const per = (per100: number | null, target: number) =>
    cost && per100 ? (cost.paidCents * target * 100) / (cost.amount * per100) : null;
  return { per100KcalCents: per(n.kcal100, 100), per10gProteinCents: per(n.protein100, 10) };
}

export type PurchaseRow = { productId: number; date: string; pieces: number | null; amount: number | null };

export type ConsumptionRow = {
  productId: number;
  eatenAmount: number;
  eatenEntries: number;
  eatenDays: number;
  /** g/ml bought in the period, from lines with a known (or estimated) quantity. */
  boughtAmount: number;
  boughtLines: number;
  /** Distinct days with a purchase: how often it's bought. */
  boughtDays: number;
  /** Lines whose quantity is unknown: boughtAmount is a lower bound when > 0. */
  boughtUnknown: number;
  boughtEstimated: boolean;
};

/** Per product: how much was eaten vs bought in the same period (products appearing in either). */
export function consumptionVsPurchases(
  diary: readonly DiaryRow[],
  purchases: readonly PurchaseRow[],
  quantityInfo: (productId: number) => ProductQuantityInfo | null,
): ConsumptionRow[] {
  const rows = new Map<number, ConsumptionRow & { days: Set<string>; buyDays: Set<string> }>();
  const row = (productId: number) => {
    let r = rows.get(productId);
    if (!r) {
      r = {
        productId,
        eatenAmount: 0,
        eatenEntries: 0,
        eatenDays: 0,
        boughtAmount: 0,
        boughtLines: 0,
        boughtDays: 0,
        boughtUnknown: 0,
        boughtEstimated: false,
        days: new Set(),
        buyDays: new Set(),
      };
      rows.set(productId, r);
    }
    return r;
  };
  for (const d of diary) {
    const r = row(d.productId);
    r.eatenAmount += d.amount;
    r.eatenEntries++;
    r.days.add(d.date);
  }
  for (const p of purchases) {
    const r = row(p.productId);
    r.boughtLines++;
    r.buyDays.add(p.date);
    const info = quantityInfo(p.productId);
    const q = info ? resolveAmount(p, info) : null;
    if (!q) r.boughtUnknown++;
    else {
      r.boughtAmount += q.amount;
      if (q.source === "estimated") r.boughtEstimated = true;
    }
  }
  return [...rows.values()].map(({ days, buyDays, ...r }) => ({ ...r, eatenDays: days.size, boughtDays: buyDays.size }));
}

/** Replace product A with B (B may be A: then only the quantity changes) and scale its amounts by `factor`. */
export type Change = { fromProductId: number; toProductId: number; factor: number };

export type Simulation = {
  affectedEntries: number;
  affectedDays: number;
  /** Over the affected entries only. A measure is null when any affected entry lacks it. */
  before: Record<Measure, number | null>;
  after: Record<Measure, number | null>;
  delta: Record<Measure, number | null>;
};

export function simulate(rows: readonly DiaryRow[], change: Change, nutrition: NutritionLookup, cost: CostLookup): Simulation {
  const affected = rows.filter((r) => r.productId === change.fromProductId);
  const total = (values: Record<Measure, number | null>[]) =>
    Object.fromEntries(
      MEASURES.map((m) => [m, values.every((v) => v[m] != null) ? values.reduce((s, v) => s + v[m]!, 0) : null]),
    ) as Record<Measure, number | null>;
  const before = total(affected.map((r) => entryValues(r, r.amount, r.productId, nutrition, cost)));
  // At least 1 g: a positive factor never turns an entry into "ate nothing".
  const after = total(
    affected.map((r) => entryValues(r, Math.max(1, Math.round(r.amount * change.factor)), change.toProductId, nutrition, cost)),
  );
  const delta = Object.fromEntries(
    MEASURES.map((m) => [m, before[m] != null && after[m] != null ? after[m]! - before[m]! : null]),
  ) as Record<Measure, number | null>;
  return { affectedEntries: affected.length, affectedDays: new Set(affected.map((r) => r.date)).size, before, after, delta };
}
