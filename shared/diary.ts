import { addDays } from "./dates";
import type { Nutrition } from "./nutrition";
import { resolveAmount, type ProductQuantityInfo } from "./pricing";

// Food diary maths (PLAN Fase 5). Pure functions, tested with hand-computed values.
// Missing data stays null: an unknown nutrient or cost is never counted as 0.

export const MEALS = ["colazione", "pranzo", "cena", "snack"] as const;
export type Meal = (typeof MEALS)[number];
export const MEAL_LABELS: Record<Meal, string> = { colazione: "Colazione", pranzo: "Pranzo", cena: "Cena", snack: "Spuntini" };

export const NUTRIENTS = ["kcal", "protein", "fat", "saturatedFat", "carbs", "sugars", "fiber", "salt"] as const;
export type Nutrient = (typeof NUTRIENTS)[number];
export type Nutrients = Record<Nutrient, number | null>;

const PER_100: Record<Nutrient, keyof Nutrition> = {
  kcal: "kcal100",
  protein: "protein100",
  fat: "fat100",
  carbs: "carbs100",
  sugars: "sugars100",
  saturatedFat: "saturatedFat100",
  fiber: "fiber100",
  salt: "salt100",
};

/** Nutrients in `amount` g/ml of a product whose values are per 100 g/ml. */
export function nutrientsFor(per100: Nutrition, amount: number): Nutrients {
  const out = {} as Nutrients;
  for (const n of NUTRIENTS) {
    const v = per100[PER_100[n]];
    out[n] = v == null ? null : (v * amount) / 100;
  }
  return out;
}

/** Sum of the known values, and how many entries didn't have one. All unknown → null. */
export type Total = { value: number | null; missing: number };

export function sumKnown(values: readonly (number | null)[]): Total {
  const known = values.filter((v): v is number => v != null);
  return { value: known.length ? known.reduce((s, v) => s + v, 0) : null, missing: values.length - known.length };
}

export function sumNutrients(list: readonly Nutrients[]): Record<Nutrient, Total> {
  return Object.fromEntries(NUTRIENTS.map((n) => [n, sumKnown(list.map((x) => x[n]))])) as Record<Nutrient, Total>;
}

/** A receipt line of the product, raw (prices in cents, quantities as typed). */
export type Purchase = { date: string; paidCents: number; packages: number | null; pieces: number | null; amount: number | null };

/**
 * `average`: Σ paid / Σ quantity over the purchases of the last COST_WINDOW_DAYS up to the diary day, falling
 * back to the last price when there are none in the window. `last`: the most recent purchase up to that day.
 */
export type CostMode = "average" | "last";
export const COST_MODES: readonly CostMode[] = ["average", "last"];
export const COST_WINDOW_DAYS = 90;
/** Windows offered in the UI (days). */
export const COST_WINDOWS = [30, 90, 180, 365] as const;

/** Cost per g/ml as a ratio of raw integers (paid cents over grams), never a rounded unit price. */
export type UnitCost = {
  paidCents: number;
  amount: number;
  source: "average" | "last";
  /** Purchases the cost comes from. */
  purchases: number;
  /** Some quantity was estimated (pieces × average weight, or a package count assumed). */
  estimated: boolean;
};

/**
 * Cost per g/ml of a product on `onDate`. Purchases with unknown quantity can't give a cost per gram and are
 * skipped; null when no purchase is usable (never bought → "n.d.", not free). "Last" prefers the latest purchase
 * on or before the day; for a day before the first purchase, the earliest one.
 */
export function unitCost(
  purchases: readonly Purchase[],
  product: ProductQuantityInfo,
  onDate: string,
  mode: CostMode,
  windowDays: number = COST_WINDOW_DAYS,
): UnitCost | null {
  const usable = purchases
    .map((p) => ({ ...p, q: resolveAmount(p, product) }))
    .filter((p): p is typeof p & { q: NonNullable<typeof p.q> } => p.q != null && p.q.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date)); // stable: same-day lines keep their order
  if (usable.length === 0) return null;

  if (mode === "average") {
    const from = addDays(onDate, -windowDays);
    const recent = usable.filter((p) => p.date >= from && p.date <= onDate);
    if (recent.length > 0) {
      return {
        paidCents: recent.reduce((s, p) => s + p.paidCents, 0),
        amount: recent.reduce((s, p) => s + p.q.amount, 0),
        source: "average",
        purchases: recent.length,
        estimated: recent.some((p) => p.q.source === "estimated"),
      };
    }
  }
  const last = usable.filter((p) => p.date <= onDate).at(-1) ?? usable[0]!;
  return { paidCents: last.paidCents, amount: last.q.amount, source: "last", purchases: 1, estimated: last.q.source === "estimated" };
}

/** Cost in cents of eating `amount` g/ml, rounded once at the end. */
export function costCents(cost: UnitCost | null, amount: number): number | null {
  return cost ? Math.round((amount * cost.paidCents) / cost.amount) : null;
}

/** Portion × quantity → grams, rounded to the gram (stored amounts are integers). */
export function portionAmount(portionGrams: number, qty: number): number {
  return Math.round(portionGrams * qty);
}

/**
 * Grams of one portion as it was when a saved entry was recorded (its grams / its quantity). Editing a past entry
 * with the same portion uses this, so resizing "1 vasetto" later never rewrites history.
 */
export function savedPortionGrams(entry: { amount: number; portionQty: number | null }): number | null {
  return entry.portionQty ? entry.amount / entry.portionQty : null;
}

/** One item of a past meal, as needed to repeat it. */
export type MealItem = { productId: number; amount: number; portionId: number | null; portionQty: number | null };

/** Same products in the same quantities → same key, whatever the order they were entered in. */
export function mealKey(items: readonly MealItem[]): string {
  return items
    .map((i) => `${i.productId}:${i.amount}:${i.portionId ?? ""}:${i.portionQty ?? ""}`)
    .sort()
    .join("|");
}

/**
 * Past meals of one kind, newest first, identical ones merged (with every date they were eaten on): the usual
 * breakfast shows once, "eaten on 12 days", instead of twelve copies. Rows: newest date first.
 */
export function groupRecentMeals<T extends MealItem & { date: string }>(rows: readonly T[], limit: number): { dates: string[]; items: T[] }[] {
  const byDate = new Map<string, T[]>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  const groups = new Map<string, { dates: string[]; items: T[] }>();
  for (const [date, items] of [...byDate.entries()].sort(([a], [b]) => b.localeCompare(a))) {
    const key = mealKey(items);
    const group = groups.get(key);
    if (group) group.dates.push(date);
    else groups.set(key, { dates: [date], items });
  }
  return [...groups.values()].slice(0, limit);
}
