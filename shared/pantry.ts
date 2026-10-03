// Pantry forecast (phase 7): stock = purchases recorded in the app − diary consumption; how fast it goes; when to buy.
import { addDays } from "./dates";
import { costCents, type UnitCost } from "./diary";
import { resolveAmount, type ItemQuantity, type ProductQuantityInfo } from "./pricing";

/** Consumption rate window, in days up to today included. */
export const CONSUMPTION_WINDOW_DAYS = 30;
/** "Per month" means 30 days. */
export const DAYS_PER_MONTH = 30;
/** Suggest a product when it runs out within this many days. */
export const SUGGEST_WITHIN_DAYS = 7;
export const URGENT_WITHIN_DAYS = 2;
/** A rate from fewer logged days is too unreliable to forecast or project a month (one meal of tuna ≠ 224 g a day). */
export const MIN_RATE_DAYS = 3;

export type PantryPurchase = ItemQuantity & { date: string };
export type PantryConsumption = { date: string; amount: number };

export type Stock = {
  /** Grams/ml left. */
  amount: number;
  /** Some purchase quantity was estimated (no package count, or pieces × average weight). */
  estimated: boolean;
  /** First purchase recorded in the app: consumption before it is ignored (it came from older, unknown stock). */
  since: string;
};

/**
 * Stock on `today`: every purchase from the first one recorded in the app, minus what the diary says was eaten since.
 * Purchases come before consumption on the same day. Stock never goes below 0: eating more than was bought means
 * there was other, unknown stock. null when never bought, or when a purchase has an unknown quantity.
 */
export function estimateStock(
  purchases: readonly PantryPurchase[],
  consumption: readonly PantryConsumption[],
  product: ProductQuantityInfo,
  today: string,
): Stock | null {
  const bought = purchases.filter((p) => p.date <= today).map((p) => ({ date: p.date, q: resolveAmount(p, product) }));
  if (bought.length === 0 || bought.some((b) => b.q == null)) return null;
  const since = bought.reduce((min, b) => (b.date < min ? b.date : min), bought[0]!.date);

  const events = [
    ...bought.map((b) => ({ date: b.date, order: 0, delta: b.q!.amount })),
    ...consumption.filter((c) => c.date >= since && c.date <= today).map((c) => ({ date: c.date, order: 1, delta: -c.amount })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  let amount = 0;
  for (const e of events) amount = Math.max(0, amount + e.delta);
  return { amount, estimated: bought.some((b) => b.q!.source === "estimated"), since };
}

export type Rate = {
  /** Grams/ml eaten per logged day. */
  perDay: number;
  /** Median grams/ml eaten on a day the product was eaten (e.g. tuna: 2 cans at a time). */
  typicalDay: number;
  /** Logged days the rate is computed on. */
  days: number;
};

/**
 * Consumption over the last CONSUMPTION_WINDOW_DAYS: grams eaten / diary days logged since the product was first eaten
 * in the window (yogurt 4 × 200 g on 4 logged days → 200 g/day). Days without a diary don't count, as in the diet
 * analysis. null when not eaten in the window.
 */
export function consumptionRate(
  consumption: readonly PantryConsumption[],
  loggedDays: readonly string[],
  today: string,
  windowDays: number = CONSUMPTION_WINDOW_DAYS,
): Rate | null {
  const from = addDays(today, -(windowDays - 1));
  const eaten = consumption.filter((c) => c.date >= from && c.date <= today);
  if (eaten.length === 0) return null;
  const first = eaten.reduce((min, c) => (c.date < min ? c.date : min), eaten[0]!.date);
  const days = new Set([...loggedDays.filter((d) => d >= first && d <= today), ...eaten.map((c) => c.date)]).size;

  const byDay = new Map<string, number>();
  for (const c of eaten) byDay.set(c.date, (byDay.get(c.date) ?? 0) + c.amount);
  const sorted = [...byDay.values()].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const typicalDay = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;

  return { perDay: eaten.reduce((s, c) => s + c.amount, 0) / days, typicalDay, days };
}

export const isReliable = (rate: Rate) => rate.days >= MIN_RATE_DAYS;

export type Urgency = "finished" | "soon" | "week";

export type Forecast = {
  /** Days the stock lasts at the current rate (fractional). */
  daysLeft: number;
  /** Day it runs out: today + whole days left (200 g at 200 g/day → tomorrow). */
  runOutDate: string;
  /** finished: no stock; soon: within URGENT_WITHIN_DAYS; week: within SUGGEST_WITHIN_DAYS; null: later. */
  urgency: Urgency | null;
};

export function forecast(stock: number, rate: Rate, today: string): Forecast {
  const daysLeft = stock / rate.perDay;
  const urgency: Urgency | null =
    stock <= 0 ? "finished" : daysLeft <= URGENT_WITHIN_DAYS ? "soon" : daysLeft <= SUGGEST_WITHIN_DAYS ? "week" : null;
  return { daysLeft, runOutDate: addDays(today, Math.floor(daysLeft)), urgency };
}

/** Packages to suggest: enough for a typical day of eating it (tuna 224 g / 112 g → 2), at least 1. null without a package size. */
export function suggestedPackages(rate: Rate, packageAmount: number | null): number | null {
  return packageAmount ? Math.max(1, Math.ceil(rate.typicalDay / packageAmount)) : null;
}

export type MonthlyUse = {
  /** "1 package every N days". null without a package size. */
  packageEveryDays: number | null;
  packagesPerMonth: number | null;
  /** Rate × 30 days at the diary's cost per gram, rounded once. null when the cost is unknown (never bought). */
  costPerMonthCents: number | null;
};

export function monthlyUse(rate: Rate, packageAmount: number | null, cost: UnitCost | null): MonthlyUse {
  return {
    packageEveryDays: packageAmount ? packageAmount / rate.perDay : null,
    packagesPerMonth: packageAmount ? (rate.perDay * DAYS_PER_MONTH) / packageAmount : null,
    costPerMonthCents: costCents(cost, rate.perDay * DAYS_PER_MONTH),
  };
}
